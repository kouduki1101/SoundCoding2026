"""Prepare a local Git snapshot without importing or executing its application code."""

import argparse
import ast
import hashlib
import json
import re
import subprocess
from collections import Counter
from pathlib import Path, PurePosixPath

from code_groove.errors import GrooveError
from code_groove.repository import plan_repository
from code_groove.source import build_index, run_node, sanitize, validate_scope

ROOT = Path(__file__).resolve().parents[1]


def git(repository: Path, *args: str) -> bytes:
    return subprocess.check_output(
        ["git", "--no-replace-objects", "-C", str(repository), *args],
        stderr=subprocess.PIPE,
        timeout=20,
    )


def source_path(path: str) -> bool:
    return (
        path.endswith((".ts", ".tsx", ".py"))
        and not path.endswith(".d.ts")
        and not re.search(r"\.(test|spec)\.tsx?$|(^|/)test_[^/]+\.py$|(^|/)tests/", path)
        and not any(
            part in {"node_modules", "dist", "build", ".venv", "__pycache__"} or part.startswith(".")
            for part in PurePosixPath(path).parts
        )
    )


def assess(
    repository: Path, ref: str = "HEAD", scopes: tuple[str, ...] = (), partitioned: bool = False
) -> tuple[dict, dict]:
    scopes = tuple(validate_scope(scope) for scope in scopes)
    revision = (
        git(repository, "rev-parse", "--verify", "--end-of-options", f"{ref}^{{commit}}").decode().strip()
    )
    if not re.fullmatch(r"[a-f0-9]{40,64}", revision):
        raise ValueError("Cannot pin the repository revision")
    sources, excluded = {}, []
    for entry in git(repository, "ls-tree", "-rlz", revision).split(b"\0"):
        if not entry:
            continue
        header, name = entry.split(b"\t", 1)
        mode, kind, blob, size = header.decode().split()
        path = name.decode("utf-8")
        validate_scope(path)
        if not source_path(path):
            continue
        if mode not in ("100644", "100755") or kind != "blob":
            excluded.append({"path": path, "reason": "link_or_special_file"})
            continue
        if int(size) > 200 * 1024:
            excluded.append({"path": path, "reason": "file_size_limit"})
            continue
        raw = git(repository, "cat-file", "blob", blob)
        try:
            sources[path] = raw.decode("utf-8")
        except UnicodeDecodeError:
            excluded.append({"path": path, "reason": "not_utf8"})
    if sum(len(source.encode()) for source in sources.values()) > 4 * 1024 * 1024:
        raise ValueError("Local inventory exceeds 4 MiB")
    snapshot_id = f"snapshot_{revision[:16]}"
    typescript = run_node("repo-indexer", {"snapshot_id": snapshot_id, "sources": sources})
    units = Counter(unit["primary_span"]["path"] for unit in typescript["units"])
    methods, parse_errors = {}, {file["path"]: file["parse_errors"] for file in typescript["files"]}
    for path, source in sources.items():
        if not path.endswith(".py"):
            continue
        try:
            tree = ast.parse(source, filename=path)
        except (SyntaxError, ValueError, RecursionError):
            parse_errors[path] = 1
            continue
        units[path] = sum(isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) for node in tree.body)
        methods[path] = sum(
            isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
            for parent in ast.walk(tree)
            if isinstance(parent, ast.ClassDef)
            for node in parent.body
        )
    selected = {
        path: source
        for path, source in sources.items()
        if not scopes or any(path == scope or path.startswith(scope + "/") for scope in scopes)
    }
    if not selected:
        raise ValueError("No supported source files in the requested scope")
    missing = [
        scope for scope in scopes if not any(p == scope or p.startswith(scope + "/") for p in selected)
    ]
    if missing:
        raise ValueError("At least one requested scope has no supported source files")
    files = [
        {
            "path": path,
            "lines": len(source.splitlines()),
            "indexed_functions": units[path],
            "class_methods": methods.get(path, 0),
            "unindexed_class_methods": 0,
            "parse_errors": parse_errors.get(path, 0),
            "selected": path in selected,
            "source_sha256": hashlib.sha256(source.encode()).hexdigest(),
        }
        for path, source in sorted(sources.items())
    ]

    def counts(rows: list[dict]) -> dict:
        return {
            "files": len(rows),
            "lines": sum(file["lines"] for file in rows),
            "indexed_functions": sum(
                file["indexed_functions"] + file.get("class_methods", 0) for file in rows
            ),
            "unindexed_class_methods": sum(file["unindexed_class_methods"] for file in rows),
            "parse_errors": sum(file["parse_errors"] for file in rows),
        }

    scope_counts = counts([file for file in files if file["selected"]])
    sanitized = {path: sanitize(source) for path, source in selected.items()}
    rejected = []
    if any(
        not scopes or any(item["path"] == scope or item["path"].startswith(scope + "/") for scope in scopes)
        for item in excluded
    ):
        rejected.append("unsupported_selected_files")
    try:
        index = build_index(snapshot_id, sanitized, repository=partitioned)
    except GrooveError as error:
        rejected.append(error.code)
        index = None
    report = {
        "revision": revision,
        "input": "committed_git_blobs",
        "working_tree_changes_included": False,
        "scope_paths": list(scopes),
        "inventory": counts(files),
        "selected": scope_counts,
        "excluded": excluded,
        "limits": {
            "files": 400 if partitioned else 40,
            "lines": 60000 if partitioned else 6000,
            "bytes": 4 * 1024 * 1024 if partitioned else 1024 * 1024,
            "symbols": 4096 if partitioned else 32,
        },
        "analysis_strategy": "resumable_partitions" if partitioned else "single_scope",
        "static_scope_accepted": not rejected,
        "rejections": rejected,
        "redacted_files": [path for path in selected if sanitized[path] != selected[path]],
        "model_requests": 0,
        "semantic_analysis": "not_run",
        "music": "not_generated",
        "files": files,
    }
    prepared = {"snapshot_id": snapshot_id, "sources": sanitized, "index": index}
    if partitioned and index:
        prepared["repository_plan"] = plan_repository(index, sanitized)
        report["partitions"] = len(prepared["repository_plan"]["chunks"])
        report["implementation_units"] = prepared["repository_plan"]["implementation_units"]
    return report, prepared


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("repository", type=Path)
    parser.add_argument("--ref", default="HEAD")
    parser.add_argument("--scope", action="append", default=[])
    parser.add_argument("--prepare", action="store_true")
    parser.add_argument("--partitioned", action="store_true")
    args = parser.parse_args()
    report, prepared = assess(args.repository.resolve(), args.ref, tuple(args.scope), args.partitioned)
    scope_hash = hashlib.sha256(
        json.dumps({"scopes": report["scope_paths"], "partitioned": args.partitioned}).encode()
    ).hexdigest()[:12]
    output = ROOT / ".local/repository-preflight" / report["revision"] / scope_hash
    if not output.resolve().is_relative_to((ROOT / ".local").resolve()):
        raise ValueError("Output must stay inside the local workspace")
    output.mkdir(parents=True, exist_ok=True)
    (output / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    if args.prepare and report["static_scope_accepted"]:
        (output / "snapshot.json").write_text(
            json.dumps(prepared, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        (output / "import.json").write_text(
            json.dumps(
                {
                    "revision": report["revision"],
                    "label": args.repository.name,
                    "sources": prepared["sources"],
                },
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
    print(json.dumps({key: value for key, value in report.items() if key != "files"}, ensure_ascii=False))
    print(f"Local report: {output / 'report.json'}")
    if args.prepare and not report["static_scope_accepted"]:
        raise SystemExit("Scope rejected; no analysis snapshot was written")


if __name__ == "__main__":
    main()

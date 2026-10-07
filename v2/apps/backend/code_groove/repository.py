"""Bounded repository inventory and resumable semantic partitions, without target execution."""

import hashlib
import json
import math
import re
from collections import Counter
from pathlib import PurePosixPath

from code_groove.errors import GrooveError
from code_groove.incremental import INDEX_VERSION, PROMPT_VERSION
from code_groove.source import EXCLUDED, sanitize, validate_scope

PLAN_VERSION = "repository-partitions-v2"
CHUNK_UNITS = 24


def digest(value: object) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def validate_local_sources(sources: dict[str, str]) -> dict[str, str]:
    if not sources or len(sources) > 500 or sum(len(s.encode()) for s in sources.values()) > 4 * 1024 * 1024:
        raise GrooveError("SCOPE_TOO_LARGE", "取り込みは500ファイル・4 MiB以内です。")
    result = {}
    for path, content in sources.items():
        validate_scope(path)
        if (
            len(path) > 240
            or not path.endswith((".ts", ".tsx", ".py", ".md", ".json", ".toml"))
            or any(p in EXCLUDED or p.startswith(".env") for p in PurePosixPath(path).parts)
            or "credential" in path.lower()
            or "private" in path.lower()
            or path.endswith((".d.ts", ".min.ts", "lock.json"))
            or len(content.encode()) > 200 * 1024
            or "\0" in content
        ):
            raise GrooveError("INVALID_SOURCE", "対象外または上限を超えたファイルを含みます。")
        result[path] = sanitize(content)
    return result


def plan_repository(index: dict, sources: dict[str, str]) -> dict:
    by_id = {u["unit_id"]: u for u in index["units"]}
    if len(by_id) != len(index["units"]):
        raise GrooveError("INVALID_ANALYSIS", "静的索引の識別子が重複しています。")
    aliases = {}
    members: dict[str, list[str]] = {}
    for unit in index["units"]:
        owner = unit
        visited = set()
        while owner.get("parent_unit_id") in by_id:
            if owner["unit_id"] in visited:
                raise GrooveError("INVALID_ANALYSIS", "静的索引の所有関係が循環しています。")
            visited.add(owner["unit_id"])
            owner = by_id[owner["parent_unit_id"]]
        aliases[unit["unit_id"]] = owner["unit_id"]
        members.setdefault(owner["unit_id"], []).append(unit["unit_id"])
    owners = [{**by_id[uid], "member_symbol_ids": ids} for uid, ids in members.items()]
    owners.sort(key=lambda u: (u["primary_span"]["path"], u["primary_span"]["start_line"], u["unit_id"]))
    if not owners:
        raise GrooveError("NO_IMPLEMENTATION", "対応する実装関数が見つかりません。")
    # Dependency fingerprints include transitive imports and repository-wide documents/tests.
    context = {
        p
        for p in sources
        if not re.search(r"\.(ts|tsx|py)$", p) or re.search(r"(^|/)tests?/|\.(test|spec)\.|(^|/)test_", p)
    }
    imports = {f["path"]: {i["path"] for i in f.get("imports", []) if i.get("path")} for f in index["files"]}
    uncertain_paths = {
        f["path"]
        for f in index["files"]
        if any(
            not i["resolved"]
            and i.get("resolution") != "external"
            and (i["module"].startswith(".") or f["path"].endswith(".py"))
            for i in f.get("imports", [])
        )
    }
    batches: list[list[dict]] = []
    for unit in owners:
        directory = str(PurePosixPath(unit["primary_span"]["path"]).parent)
        reads = math.ceil((unit["primary_span"]["end_line"] - unit["primary_span"]["start_line"] + 1) / 160)
        current_reads = (
            sum(
                math.ceil((u["primary_span"]["end_line"] - u["primary_span"]["start_line"] + 1) / 160)
                for u in batches[-1]
            )
            if batches
            else 0
        )
        if (
            not batches
            or len(batches[-1]) >= CHUNK_UNITS
            or current_reads + reads > 18
            or str(PurePosixPath(batches[-1][0]["primary_span"]["path"]).parent) != directory
        ):
            batches.append([])
        batches[-1].append(unit)
    chunks = []
    for batch in batches:
        paths = sorted({u["primary_span"]["path"] for u in batch})
        dependencies = set(paths) | context
        pending = list(paths)
        while pending:
            path = pending.pop()
            for target in imports.get(path, set()):
                if target not in dependencies:
                    dependencies.add(target)
                    pending.append(target)
        uncertain = bool(dependencies & uncertain_paths)
        if uncertain:
            dependencies = set(sources)
        signature = [
            (
                u["primary_span"]["path"],
                u["label"],
                u["primary_span"]["start_line"],
                u["primary_span"]["end_line"],
            )
            for u in batch
        ]
        chunk_id = f"chunk_{digest(signature)[:20]}"
        chunks.append(
            {
                "chunk_id": chunk_id,
                "label": str(PurePosixPath(paths[0]).parent),
                "paths": paths,
                "unit_ids": [u["unit_id"] for u in batch],
                "symbol_count": sum(len(u["member_symbol_ids"]) for u in batch),
                "dependency_paths": sorted(dependencies),
                "dependency_uncertainty": uncertain,
                "fingerprint": digest(
                    {
                        "version": PLAN_VERSION,
                        "index": INDEX_VERSION,
                        "signature": signature,
                        "sources": {p: digest(sources[p]) for p in sorted(dependencies)},
                    }
                ),
            }
        )
    relations = [
        {**r, "caller": aliases[r["caller"]], "callee": aliases.get(r["callee"])} for r in index["relations"]
    ]
    return {
        "version": PLAN_VERSION,
        "eligible_source_files": sum(f["is_source"] for f in index["files"]),
        "source_lines": sum(f["lines"] for f in index["files"] if f["is_source"]),
        "indexed_symbols": len(index["units"]),
        "implementation_units": len(owners),
        "files_without_units": [
            f["path"]
            for f in index["files"]
            if f["is_source"] and f["path"] not in {u["primary_span"]["path"] for u in owners}
        ],
        "owners": owners,
        "relations": relations,
        "chunks": chunks,
        "cache_dependency_uncertainty": bool(uncertain_paths),
        "note": "入れ子の関数は所有元へまとめ、全シンボルを索引に保持。分割結果の責務分類は独立で、全体の健全性は未判定。",
    }


def cached_chunks(plan: dict, analyses: list[dict], model_id: str) -> dict:
    result = {}
    fingerprints = {c["chunk_id"]: c["fingerprint"] for c in plan["chunks"]}
    for analysis in sorted(analyses, key=lambda a: a["created_at"]):
        chunk_id = analysis.get("chunk_id")
        if (
            chunk_id in fingerprints
            and analysis.get("chunk_fingerprint") == fingerprints[chunk_id]
            and analysis.get("prompt_version") == PROMPT_VERSION
            and analysis.get("model_id") == model_id
        ):
            result[chunk_id] = analysis
    return result


def follow_chunk(previous: dict, current: dict, chunk_id: str | None) -> str | None:
    """Keep an accepted edit near its original owners, including multi-partition files."""
    old = next((c for c in previous["chunks"] if c["chunk_id"] == chunk_id), None)
    if not old:
        return None
    old_units = [u for u in previous["owners"] if u["unit_id"] in old["unit_ids"]]
    signatures = {(u["primary_span"]["path"], u["label"]) for u in old_units}
    old_start = min(u["primary_span"]["start_line"] for u in old_units)
    candidates = [c for c in current["chunks"] if set(c["paths"]) & set(old["paths"])]

    def overlap(chunk: dict) -> tuple[int, int]:
        units = [u for u in current["owners"] if u["unit_id"] in chunk["unit_ids"]]
        matched = sum((u["primary_span"]["path"], u["label"]) in signatures for u in units)
        return matched, -abs(min(u["primary_span"]["start_line"] for u in units) - old_start)

    return max(candidates, key=overlap)["chunk_id"] if candidates else None


def select_chunk(snapshot: dict, chunk_id: str) -> dict:
    plan = snapshot["repository_plan"]
    chunk = next((c for c in plan["chunks"] if c["chunk_id"] == chunk_id), None)
    if not chunk:
        raise GrooveError("INVALID_SELECTION", "このスナップショットに検査範囲がありません。")
    selected = set(chunk["unit_ids"])
    units = [
        {
            **{k: v for k, v in u.items() if k not in ("member_symbol_ids", "calls")},
            "indexed_symbol_count": len(u["member_symbol_ids"]),
        }
        for u in plan["owners"]
        if u["unit_id"] in selected
    ]
    paths = set(chunk["paths"])
    relations = [r for r in plan["relations"] if r["caller"] in selected or r["callee"] in selected]
    external = {r["caller"] for r in relations} | {r["callee"] for r in relations if r["callee"]}
    return {
        "files": [f for f in snapshot["index"]["files"] if f["path"] in paths],
        "units": units,
        "relations": relations,
        "scope_note": "今回の分割範囲だけ分類。関連ファイルは読めるが、範囲外の判定や全体健診完了を主張しない。",
        "repository_context": {
            "eligible_source_files": plan["eligible_source_files"],
            "indexed_symbols": plan["indexed_symbols"],
            "implementation_units": plan["implementation_units"],
            "directories": dict(
                Counter(
                    str(PurePosixPath(f["path"]).parent) for f in snapshot["index"]["files"] if f["is_source"]
                )
            ),
            "chunk_id": chunk_id,
            "partition_count": len(plan["chunks"]),
            "related_units": [
                {k: u[k] for k in ("unit_id", "label", "primary_span")}
                for u in plan["owners"]
                if u["unit_id"] in external - selected
            ][:40],
            "related_units_truncated": len(external - selected) > 40,
            "note": plan["note"],
        },
    }


def repository_status(snapshot: dict, analyses: list[dict], model_id: str) -> dict:
    plan = snapshot["repository_plan"]
    cached = cached_chunks(plan, analyses, model_id)
    saved = dict(cached)
    chunk_ids = {c["chunk_id"] for c in plan["chunks"]}
    for analysis in sorted(analyses, key=lambda a: a["created_at"]):
        if analysis.get("snapshot_id") == snapshot["snapshot_id"] and analysis.get("chunk_id") in chunk_ids:
            saved[analysis["chunk_id"]] = analysis
    chunks = []
    for chunk in plan["chunks"]:
        analysis = saved.get(chunk["chunk_id"], {})
        chunks.append(
            {
                **{k: chunk[k] for k in ("chunk_id", "label", "paths", "symbol_count")},
                "units": len(chunk["unit_ids"]),
                "unit_ids": chunk["unit_ids"],
                "owner_units": [
                    {"unit_id": u["unit_id"], "label": u["label"], "span": u["primary_span"]}
                    for u in plan["owners"]
                    if u["unit_id"] in chunk["unit_ids"]
                ],
                "status": "partial"
                if analysis.get("unresolved_units", 0)
                else "analyzed"
                if analysis
                else "pending",
                "analysis_id": analysis.get("analysis_id"),
                "snapshot_id": analysis.get("snapshot_id"),
                "inspected_units": analysis.get("inspected_units", 0),
                "unresolved_units": analysis.get("unresolved_units", 0),
                "cache_compatible": bool(analysis) and analysis == cached.get(chunk["chunk_id"]),
            }
        )
    return {
        "snapshot_id": snapshot["snapshot_id"],
        **{
            k: plan[k]
            for k in (
                "version",
                "eligible_source_files",
                "source_lines",
                "indexed_symbols",
                "implementation_units",
                "files_without_units",
                "note",
                "cache_dependency_uncertainty",
            )
        },
        "analyzed_chunks": len(saved),
        "inspected_units": sum(c["inspected_units"] for c in chunks),
        "pending_units": sum(c["units"] for c in chunks if c["status"] == "pending"),
        "unresolved_units": sum(c["unresolved_units"] for c in chunks),
        "cross_partition_review": "scoped"
        if any(
            a.get("integration_chunk_ids") and a.get("snapshot_id") == snapshot["snapshot_id"]
            for a in analyses
        )
        else "not_run",
        "integrations": [
            {
                "analysis_id": a["analysis_id"],
                "chunk_ids": a["integration_chunk_ids"],
                "inspected_units": a.get("inspected_units", 0),
            }
            for a in analyses
            if a.get("integration_chunk_ids") and a.get("snapshot_id") == snapshot["snapshot_id"]
        ],
        "chunks": chunks,
    }

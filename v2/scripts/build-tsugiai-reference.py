"""Publish only committed, sanitized source text; never import the target code."""

import hashlib
import json
from pathlib import Path

from code_groove.source import sanitize

ROOT = Path(__file__).resolve().parents[1]
REVISION = "35a951488d7b00518e7e73a329d46713cbeacbe8"


def main():
    prepared = ROOT / ".local/repository-preflight" / REVISION / "629dbbb5d73e"
    snapshot = json.loads((prepared / "import.json").read_text(encoding="utf-8"))
    report = json.loads((prepared / "report.json").read_text(encoding="utf-8"))
    recorded = json.loads((ROOT / "fixtures/recorded-live/tsugiai-agents.json").read_text(encoding="utf-8"))
    assert snapshot["revision"] == recorded["case_study"]["revision"] == REVISION
    assert report["input"] == "committed_git_blobs" and not report["working_tree_changes_included"]
    sources = {path: sanitize(source) for path, source in snapshot["sources"].items()}
    assert len(sources) == 51
    assert all(sources[path] == source for path, source in recorded["sources"].items())
    value = {
        "origin": "committed_source_reference",
        "revision": REVISION,
        "repository_url": recorded["case_study"]["repository_url"],
        "license": recorded["case_study"]["license"],
        "semantic_analysis": "not_run",
        "source_lines": report["inventory"]["lines"],
        "indexed_symbols": report["inventory"]["indexed_functions"],
        "sources": sources,
        "source_sha256": {path: hashlib.sha256(source.encode()).hexdigest() for path, source in sources.items()},
    }
    destination = ROOT / "fixtures/repository-reference/tsugiai.json"
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Published {len(sources)} committed reference files; no analysis or target execution")


if __name__ == "__main__":
    main()

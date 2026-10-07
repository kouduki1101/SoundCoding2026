import json
import runpy
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
assess = runpy.run_path(str(ROOT / "scripts/repository-preflight.py"))["assess"]


@pytest.fixture
def repository(tmp_path):
    subprocess.run(["git", "init", "--quiet", str(tmp_path)], check=True, capture_output=True)
    subprocess.run(["git", "-C", str(tmp_path), "config", "user.name", "Test"], check=True)
    subprocess.run(["git", "-C", str(tmp_path), "config", "user.email", "test@example.invalid"], check=True)
    return tmp_path


def commit(repository, sources):
    for path, source in sources.items():
        target = repository / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(source, encoding="utf-8")
    subprocess.run(["git", "-C", str(repository), "add", "."], check=True)
    subprocess.run(["git", "-C", str(repository), "commit", "--quiet", "-m", "Fixture"], check=True)


def test_committed_snapshot_never_executes_application_or_includes_dirty_source(repository):
    commit(
        repository,
        {
            "src/flow.ts": "throw new Error('do not execute');\nexport function run() { return 1; }",
            "package.json": json.dumps({"scripts": {"postinstall": "exit 99"}}),
            ".env": "SECRET_VALUE=not-for-analysis",
        },
    )
    (repository / "src/flow.ts").write_text("uncommitted content", encoding="utf-8")
    first, snapshot = assess(repository)
    second, _ = assess(repository)
    assert first == second
    assert first["static_scope_accepted"] and first["selected"]["indexed_functions"] == 1
    assert set(snapshot["sources"]) == {"src/flow.ts"}
    assert "do not execute" in snapshot["sources"]["src/flow.ts"]
    assert first["working_tree_changes_included"] is False and first["model_requests"] == 0


def test_large_inventory_cannot_be_prepared_as_a_complete_examination(repository):
    commit(
        repository,
        {
            "src/large.ts": "\n".join(f"export function f{i}() {{ return {i}; }}" for i in range(33)),
            "src/small.py": "def run():\n    return 1\n",
        },
    )
    full, _ = assess(repository)
    assert not full["static_scope_accepted"] and "SCOPE_TOO_LARGE" in full["rejections"]
    scoped, snapshot = assess(repository, scopes=("src/small.py",))
    assert scoped["static_scope_accepted"]
    assert scoped["inventory"]["indexed_functions"] == 34
    assert scoped["selected"]["indexed_functions"] == 1
    assert sum(file["selected"] for file in scoped["files"]) == 1
    assert set(snapshot["sources"]) == {"src/small.py"}


def test_indexed_methods_and_git_symlinks_are_disclosed(repository):
    commit(repository, {"src/store.py": "class Store:\n    def save(self):\n        return 1\n"})
    blob = (
        subprocess.check_output(
            ["git", "-C", str(repository), "hash-object", "-w", "--stdin"], input=b"../outside.py"
        )
        .decode()
        .strip()
    )
    subprocess.run(
        ["git", "-C", str(repository), "update-index", "--add", "--cacheinfo", f"120000,{blob},src/link.py"],
        check=True,
    )
    subprocess.run(["git", "-C", str(repository), "commit", "--quiet", "-m", "Link"], check=True)
    report, snapshot = assess(repository)
    assert not report["static_scope_accepted"]
    assert report["selected"]["unindexed_class_methods"] == 0
    assert report["selected"]["indexed_functions"] == 1
    assert "python_class_methods_not_indexed" not in report["rejections"]
    assert report["excluded"] == [{"path": "src/link.py", "reason": "link_or_special_file"}]
    assert "src/link.py" not in snapshot["sources"]


def test_partitioned_preparation_preserves_every_symbol_and_exports_bounded_input(repository):
    commit(
        repository,
        {"src/large.ts": "\n".join(f"export function f{i}() {{ return {i}; }}" for i in range(60))},
    )
    report, snapshot = assess(repository, partitioned=True)
    assert report["static_scope_accepted"] and report["model_requests"] == 0
    assert report["partitions"] == 4
    ids = [uid for chunk in snapshot["repository_plan"]["chunks"] for uid in chunk["unit_ids"]]
    assert len(set(ids)) == len(snapshot["index"]["units"]) == 60


def test_redaction_is_visible_and_invalid_scope_cannot_select_outside_files(repository):
    commit(repository, {"src/run.py": 'api_key = "example-secret"\ndef run():\n    return 1\n'})
    report, snapshot = assess(repository)
    assert report["redacted_files"] == ["src/run.py"]
    assert "example-secret" not in snapshot["sources"]["src/run.py"]
    with pytest.raises(Exception, match="INVALID_SOURCE_URL"):
        assess(repository, scopes=("../outside",))
    with pytest.raises(ValueError, match="requested scope"):
        assess(repository, scopes=("src/run.py", "missing"))

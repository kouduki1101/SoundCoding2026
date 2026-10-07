import io
import tarfile

import pytest
from code_groove.agent import AgentContext, execute_tool
from code_groove.errors import GrooveError
from code_groove.settings import Settings
from code_groove.source import (
    build_index,
    parse_github_url,
    safe_archive,
    sample_snapshot,
    sanitize,
    validate_scope,
)


def repository_archive(files):
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w:gz") as archive:
        for path, text in files.items():
            raw = text.encode()
            item = tarfile.TarInfo("repo/" + path)
            item.size = len(raw)
            archive.addfile(item, io.BytesIO(raw))
    return buffer.getvalue()


@pytest.mark.parametrize(
    "scope",
    ["/src", "../src", "src/../safe", "src//safe", "C:/src", "src\\safe", "src\nunsafe", "src\0unsafe"],
)
def test_scope_rejects_unsafe_paths(scope):
    with pytest.raises(GrooveError):
        validate_scope(scope)


def test_large_repository_scope_is_bounded_and_keeps_shared_context():
    files = {"README.md": "Project boundaries", "pyproject.toml": "[project]\nname='large'"}
    files.update(
        {
            f"other/file{i}.ts": "\n".join(f"export function f{i}_{j}() {{ return {j}; }}" for j in range(5))
            for i in range(60)
        }
    )
    files["src/checkout/pricing.ts"] = "export function price() { return 100; }"
    files["src/checkout/payment.py"] = "def settle():\n    return 100\n"
    archive = repository_archive(files)
    with pytest.raises(GrooveError, match="SCOPE_TOO_LARGE"):
        build_index("snapshot_large", safe_archive(archive))
    sources = safe_archive(archive, "src/checkout/")
    assert set(sources) == {
        "README.md",
        "pyproject.toml",
        "src/checkout/pricing.ts",
        "src/checkout/payment.py",
    }
    index = build_index("snapshot_module", sources)
    assert len(index["units"]) == 2
    assert not any("other/" in f["path"] for f in index["files"])
    with pytest.raises(GrooveError, match="UNSAFE_ARCHIVE"):
        safe_archive(repository_archive({**files, "../outside.ts": ""}), "src/checkout")
    with pytest.raises(GrooveError, match="NOT_FOUND"):
        safe_archive(archive, "not-present")


@pytest.mark.parametrize(
    "url",
    [
        "http://github.com/a/b",
        "https://github.com/a/b?x=y",
        "https://github.com@127.0.0.1/a/b",
        "https://github.com:443/a/b",
        "https://evil.test/a/b",
        "https://github.com/a/b/pull/1",
    ],
)
def test_rejects_untrusted_url(url):
    with pytest.raises(GrooveError):
        parse_github_url(url)


@pytest.mark.parametrize(
    "name,link",
    [
        ("repo/../escape.ts", False),
        ("/absolute.ts", False),
        ("repo/link.ts", True),
        ("repo/C:/key.ts", False),
    ],
)
def test_archive_does_not_allow_traversal_or_links(name, link):
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w:gz") as tar:
        item = tarfile.TarInfo(name)
        item.size = 1
        if link:
            item.type = tarfile.SYMTYPE
            item.linkname = "outside"
        tar.addfile(item, io.BytesIO(b"x"))
    with pytest.raises(GrooveError):
        safe_archive(buffer.getvalue())


def test_sanitization_preserves_lines_and_masks_secrets():
    source = 'const api_key = "AIza' + "a" * 35 + '";\nconst password = "danger";\n'
    projection = sanitize(source)
    assert "danger" not in projection and "AIza" not in projection
    assert projection.count("\n") == source.count("\n")


def test_indexer_parses_without_executing_repository_code():
    index = build_index(
        "snapshot_safe",
        {"src/attack.ts": "throw new Error('must never execute');\nexport function example() { return 1; }"},
    )
    assert index["units"][0]["label"] == "example"


def test_bounded_evidence_and_no_privilege_tool():
    _, sources = sample_snapshot("mixed")
    index = build_index("snapshot_safe", sources)
    ctx = AgentContext(
        Settings(),
        "project_safe",
        "snapshot_safe",
        sources,
        index,
        lambda *_: None,
        lambda: None,
        lambda _: None,
    )
    file = index["files"][0]
    args = {
        "file_id": file["file_id"],
        "start_line": 1,
        "end_line": file["lines"] - 1,
        "purpose": "境界を確認",
    }
    execute_tool(ctx, "read_code", args, "tool_safe")
    execute_tool(ctx, "read_code", args, "tool_safe_2")
    with pytest.raises(GrooveError):
        execute_tool(ctx, "read_code", args, "tool_safe_3")
    with pytest.raises(GrooveError):
        execute_tool(ctx, "shell", {"command": "echo x"}, "tool_safe_4")

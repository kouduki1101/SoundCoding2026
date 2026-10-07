import httpx
import pytest

from code_groove import source
from code_groove.errors import GrooveError

BASE_SHA = "a" * 40
HEAD_SHA = "b" * 40


def mock_github(monkeypatch, status: int = 200, payload: dict | None = None):
    requests = []

    def respond(request: httpx.Request) -> httpx.Response:
        requests.append(str(request.url))
        return httpx.Response(status, json=payload or {})

    original_client = httpx.AsyncClient
    transport = httpx.MockTransport(respond)
    monkeypatch.setattr(
        source.httpx, "AsyncClient", lambda **options: original_client(transport=transport, **options)
    )
    return requests


def test_parse_pull_url_accepts_only_canonical_public_github_path():
    assert source.parse_github_pull_url("https://github.com/Owner/repo/pull/123/") == (
        "Owner",
        "repo",
        123,
    )
    for url in (
        "http://github.com/owner/repo/pull/1",
        "https://github.com:443/owner/repo/pull/1",
        "https://github.com/owner/repo/pull/1?x=1",
        "https://github.com/owner/repo/pull/1?",
        "https://github.com/owner/repo/pull/1;extra",
        "https://github.com/owner/repo/pull/1/files",
        "https://github.com/owner/repo/pull/0",
        "https://github.com/owner/repo/pull/1\n",
        "https://github.com@evil.test/owner/repo/pull/1",
    ):
        with pytest.raises(GrooveError, match="INVALID_SOURCE_URL"):
            source.parse_github_pull_url(url)


@pytest.mark.asyncio
async def test_resolve_public_fork_pull_pins_both_revisions(monkeypatch):
    requests = mock_github(
        monkeypatch,
        payload={
            "base": {"sha": BASE_SHA, "repo": {"full_name": "Owner/repo", "private": False}},
            "head": {"sha": HEAD_SHA, "repo": {"full_name": "Contributor/fork", "private": False}},
        },
    )
    result = await source.resolve_github_pull("https://github.com/Owner/repo/pull/123")
    assert requests == ["https://api.github.com/repos/Owner/repo/pulls/123"]
    assert result == {
        "repository_url": "https://github.com/Owner/repo",
        "pull_number": 123,
        "base_sha": BASE_SHA,
        "head_sha": HEAD_SHA,
        "base_repository_url": "https://github.com/Owner/repo",
        "head_repository_url": "https://github.com/Contributor/fork",
    }


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "payload",
    [
        {"base": {"sha": BASE_SHA, "repo": {"full_name": "other/repo", "private": False}},
         "head": {"sha": HEAD_SHA, "repo": {"full_name": "contributor/fork", "private": False}}},
        {"base": {"sha": BASE_SHA, "repo": {"full_name": "owner/repo", "private": False}},
         "head": {"sha": "main", "repo": {"full_name": "contributor/fork", "private": False}}},
        {"base": {"sha": BASE_SHA, "repo": {"full_name": "owner/repo", "private": False}},
         "head": {"sha": HEAD_SHA, "repo": {"full_name": "contributor/fork", "private": True}}},
    ],
)
async def test_rejects_untrusted_pull_metadata(monkeypatch, payload):
    mock_github(monkeypatch, payload=payload)
    with pytest.raises(GrooveError, match="SOURCE_INVALID"):
        await source.resolve_github_pull("https://github.com/owner/repo/pull/2")


@pytest.mark.asyncio
async def test_rate_limited_pull_lookup_is_retryable(monkeypatch):
    mock_github(monkeypatch, status=429)
    with pytest.raises(GrooveError) as error:
        await source.resolve_github_pull("https://github.com/owner/repo/pull/2")
    assert error.value.code == "SOURCE_RATE_LIMITED"
    assert error.value.retryable

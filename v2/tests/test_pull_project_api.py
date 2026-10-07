from unittest.mock import AsyncMock

from code_groove.app import create_app
from code_groove.settings import Settings
from fastapi.testclient import TestClient

BASE_SHA = "a" * 40
HEAD_SHA = "b" * 40
PR_URL = "https://github.com/owner/repo/pull/12"
PULL = {
    "repository_url": "https://github.com/owner/repo",
    "pull_number": 12,
    "base_sha": BASE_SHA,
    "head_sha": HEAD_SHA,
    "base_repository_url": "https://github.com/owner/repo",
    "head_repository_url": "https://github.com/fork/repo",
}


def client_with_accounts(tmp_path, *, live=True):
    settings = Settings(local_data_dir=tmp_path, enable_live_analysis=live, model_mode="live")
    app = create_app(settings, verifier=lambda token: token)
    for user in ("alice", "bob"):
        app.state.store.put("accounts", user, {"enabled": True})
    return TestClient(app), app.state


def headers(user="alice", key="pull-request-001"):
    return {"Authorization": f"Bearer {user}", "Idempotency-Key": key}


def test_pull_project_pins_head_and_preserves_owned_base_head_metadata(tmp_path, monkeypatch):
    client, state = client_with_accounts(tmp_path)
    resolve = AsyncMock(return_value=PULL)
    monkeypatch.setattr("code_groove.app.resolve_github_pull", resolve)

    created = client.post(
        "/api/v1/projects",
        json={"source": {"kind": "github_public", "url": PR_URL, "scope_path": "src"}},
        headers=headers(),
    )
    assert created.status_code == 202
    resolve.assert_awaited_once_with(PR_URL)
    project_id = created.json()["data"]["project_id"]
    project = state.store.get("projects", project_id)
    assert project["source"]["url"] == PULL["head_repository_url"]
    assert project["source"]["ref"] == HEAD_SHA
    assert project["source"]["scope_path"] == "src"
    assert project["pull_request"] == {**PULL, "url": PR_URL}
    run = state.store.get("runs", created.json()["data"]["run_id"])
    assert run["body"]["source"] == project["source"]
    assert client.get(f"/api/v1/projects/{project_id}", headers=headers()).json()["data"]["pull_request"] == {
        **PULL,
        "url": PR_URL,
    }
    assert client.get(f"/api/v1/projects/{project_id}", headers=headers(user="bob")).status_code == 404


def test_repository_url_keeps_existing_import_path(tmp_path, monkeypatch):
    client, state = client_with_accounts(tmp_path)
    resolve = AsyncMock()
    monkeypatch.setattr("code_groove.app.resolve_github_pull", resolve)
    created = client.post(
        "/api/v1/projects",
        json={"source": {"kind": "github_public", "url": "https://github.com/owner/repo", "ref": "main"}},
        headers=headers(),
    )
    assert created.status_code == 202
    resolve.assert_not_awaited()
    project = state.store.get("projects", created.json()["data"]["project_id"])
    assert project["source"]["url"] == "https://github.com/owner/repo"
    assert project["source"]["ref"] == "main"
    assert "pull_request" not in project


def test_pull_lookup_requires_auth_and_live_analysis_and_disallows_ref(tmp_path, monkeypatch):
    client, _state = client_with_accounts(tmp_path, live=False)
    resolve = AsyncMock(return_value=PULL)
    monkeypatch.setattr("code_groove.app.resolve_github_pull", resolve)
    request = {"source": {"kind": "github_public", "url": PR_URL}}
    assert client.post("/api/v1/projects", json=request).status_code == 401
    assert client.post("/api/v1/projects", json=request, headers=headers()).status_code == 503
    request["source"]["ref"] = HEAD_SHA
    assert client.post("/api/v1/projects", json=request, headers=headers()).status_code == 400
    resolve.assert_not_awaited()

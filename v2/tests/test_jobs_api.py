import time

import pytest
from code_groove.app import create_app
from code_groove.errors import GrooveError
from code_groove.settings import Settings
from code_groove.storage import MetadataStore
from fastapi.testclient import TestClient


@pytest.fixture
def setup(tmp_path):
    settings = Settings(local_data_dir=tmp_path, enable_live_analysis=True, model_mode="live")
    app = create_app(settings, verifier=lambda token: token)
    for user in ("alice", "bob"):
        app.state.store.put("accounts", user, {"enabled": True})
    return TestClient(app), app.state


def create(client, key="request001", user="alice"):
    return client.post(
        "/api/v1/projects",
        json={"source": {"kind": "sample", "sample_id": "mixed"}},
        headers={"Authorization": f"Bearer {user}", "Idempotency-Key": key},
    )


def test_access_expiry_origin_and_worker_separation(setup):
    client, state = setup
    assert client.get("/api/v1/samples/mixed/bundle").status_code == 200
    assert client.get("/api/v1/projects").status_code == 401
    assert client.get("/api/v1/projects", headers={"Authorization": "Bearer outsider"}).status_code == 403
    created = create(client).json()["data"]
    path = f"/api/v1/projects/{created['project_id']}"
    assert client.get(path, headers={"Authorization": "Bearer bob"}).status_code == 404
    state.store.update("projects", created["project_id"], {"expires_at": time.time() - 1})
    assert client.get(path, headers={"Authorization": "Bearer alice"}).status_code == 410
    assert client.post("/internal/tasks/run", json={"run_id": created["run_id"]}).status_code == 404
    assert (
        client.post("/api/v1/projects", json={}, headers={"Origin": "https://evil.example"}).status_code
        == 403
    )


def test_idempotency_single_active_and_cancel_quota(setup):
    client, state = setup
    first = create(client).json()["data"]
    second = create(client).json()["data"]
    assert first["run_id"] == second["run_id"]
    assert len(state.store.list("runs")) == 1
    assert create(client, key="request002").status_code == 429
    assert (
        client.post(
            f"/api/v1/runs/{first['run_id']}/cancel", json={}, headers={"Authorization": "Bearer alice"}
        ).status_code
        == 200
    )
    state.jobs.settle_quota(first["run_id"])
    quota = state.store.list("global_quotas")[0]
    assert quota["reserved_input"] == 0
    assert create(client, key="request003").status_code == 202


def test_tsugiai_recording_adoption_preserves_partition_and_never_runs_model(setup, monkeypatch):
    client, state = setup

    def forbidden(*args, **kwargs):
        raise AssertionError("Recorded replay must not call Gemini")

    monkeypatch.setattr("code_groove.jobs.run_agent", forbidden)
    public = client.get("/api/v1/samples/recorded-tsugiai-agents/bundle").json()["data"]
    assert public["map"]["origin"] == "recorded_live"
    assert public["map"]["coverage"]["inspected_units"] == 9
    assert public["repository"]["pending_units"] == 9
    headers = {"Authorization": "Bearer alice", "Idempotency-Key": "tsugiai-copy-001"}
    copied = client.post("/api/v1/samples/recorded-tsugiai-agents/projects", json={}, headers=headers)
    assert copied.status_code == 201
    ids = copied.json()["data"]
    assert (
        client.post("/api/v1/samples/recorded-tsugiai-agents/projects", json={}, headers=headers).json()[
            "data"
        ]
        == ids
    )
    path = f"/api/v1/projects/{ids['project_id']}"
    bundle = client.get(path + "/bundle", headers=headers).json()["data"]
    status = client.get(path + "/repository", headers=headers).json()["data"]
    assert bundle["map"]["analysis_id"] == ids["analysis_id"]
    assert bundle["score"]["analysis_id"] == ids["analysis_id"]
    assert bundle["score"]["score_hash"] == public["score"]["score_hash"]
    assert bundle["score"]["scenes"][0]["repo"]["notes"] == public["score"]["scenes"][0]["repo"]["notes"]
    assert bundle["partition"] == public["partition"]
    assert bundle["case_study"] == public["case_study"]
    assert bundle["sources"] == public["sources"]
    assert status["analyzed_chunks"] == 1
    assert status["chunks"][0]["analysis_id"] == ids["analysis_id"]
    assert status["pending_units"] == 9
    assert status["cross_partition_review"] == "not_run"
    assert state.store.get("projects", ids["project_id"])["status"] == "partial"
    assert client.get(path + "/bundle", headers={"Authorization": "Bearer bob"}).status_code == 404
    assert state.store.list("runs") == []
    assert state.store.list("daily_quotas") == []


def test_ten_daily_analyses_per_user_preserve_global_token_budget(setup):
    client, state = setup
    assert client.get("/api/v1/config").json()["data"]["daily_analysis_limit"] == 10
    for i in range(10):
        response = create(client, key=f"daily-limit-{i:03d}")
        assert response.status_code == 202
        run_id = response.json()["data"]["run_id"]
        state.store.update("runs", run_id, {"status": "cancelled"})
        state.jobs.settle_quota(run_id)
        assert state.store.list("daily_quotas")[0]["analyses"] == i + 1
    denied = create(client, key="daily-limit-011")
    assert denied.status_code == 429 and denied.json()["error"]["code"] == "DAILY_QUOTA"
    assert len(state.store.list("runs")) == 10
    other = create(client, key="other-user-001", user="bob")
    assert other.status_code == 202
    run_id = other.json()["data"]["run_id"]
    state.store.update("runs", run_id, {"status": "cancelled"})
    state.jobs.settle_quota(run_id)
    state.store.update(
        "global_quotas", state.store.get("runs", run_id)["quota_date"], {"consumed_input": 2700000}
    )
    denied = create(client, key="global-budget-001", user="bob")
    assert denied.status_code == 429 and denied.json()["error"]["code"] == "GLOBAL_QUOTA"
    assert state.store.list("global_quotas")[0]["reserved_input"] == 0


def test_account_activity_is_owned_bounded_and_hides_terminal_runs(setup):
    client, state = setup
    path = "/api/v1/account/activity"
    alice = {"Authorization": "Bearer alice"}
    bob = {"Authorization": "Bearer bob"}
    assert client.get(path).status_code == 401
    assert client.get(path, headers=alice).json()["data"] is None
    created = create(client).json()["data"]
    activity = client.get(path, headers=alice).json()["data"]
    assert activity["run_id"] == created["run_id"]
    assert set(activity) == {"run_id", "project_id", "kind", "status"}
    assert client.get(path, headers=bob).json()["data"] is None
    state.store.update("accounts", "bob", {"active_run_id": created["run_id"]})
    assert client.get(path, headers=bob).json()["data"] is None
    for status in ("completed", "partial", "failed", "cancelled"):
        state.store.update("runs", created["run_id"], {"status": status})
        assert client.get(path, headers=alice).json()["data"] is None
    state.store.update("runs", created["run_id"], {"status": "investigating"})
    assert client.get(path, headers=alice).json()["data"]["status"] == "investigating"
    state.store.update("projects", created["project_id"], {"status": "deleting"})
    assert client.get(path, headers=alice).json()["data"] is None
    state.store.update("projects", created["project_id"], {"status": "queued"})
    state.store.update("runs", created["run_id"], {"expires_at": time.time() - 1})
    assert client.get(path, headers=alice).json()["data"] is None


def test_lease_preserves_consumption_and_stale_worker_cannot_publish(setup):
    client, state = setup
    created = create(client).json()["data"]
    run_id = created["run_id"]
    first = state.jobs.claim(run_id, "first")
    with pytest.raises(GrooveError, match="LEASE_BUSY"):
        state.jobs.claim(run_id, "second")
    state.jobs.mutate(
        run_id, "first", {"input_tokens": 1000, "model_requests": 2, "lease_expires_at": time.time() - 1}
    )
    second = state.jobs.claim(run_id, "second")
    assert second["input_tokens"] == 1000 and second["model_requests"] == 2
    assert second["started_at"] == first["started_at"]
    with pytest.raises(GrooveError, match="LEASE_LOST"):
        state.jobs.mutate(run_id, "first", {"status": "completed"})
    state.jobs.mutate(run_id, "second", {"lease_expires_at": time.time() - 1})
    assert state.jobs.claim(run_id, "third") is None
    assert state.store.get("runs", run_id)["status"] == "failed"


def test_replacement_worker_cannot_restart_run_deadline(setup):
    client, state = setup
    run_id = create(client).json()["data"]["run_id"]
    state.jobs.claim(run_id, "first")
    state.jobs.mutate(
        run_id,
        "first",
        {"started_at": time.time() - 481, "lease_expires_at": time.time() - 1},
    )
    state.jobs.claim(run_id, "replacement")
    with pytest.raises(GrooveError, match="MODEL_TIMEOUT"):
        state.jobs.guard(run_id, "replacement")


def test_delete_hides_immediately_and_removes_artifacts(setup):
    client, state = setup
    created = create(client).json()["data"]
    pid = created["project_id"]
    state.artifacts.put(f"projects/{pid}/snapshot.json.gz", {"source": "sanitized"})
    assert (
        client.delete(f"/api/v1/projects/{pid}", headers={"Authorization": "Bearer alice"}).status_code == 202
    )
    assert (
        client.get(f"/api/v1/runs/{created['run_id']}", headers={"Authorization": "Bearer alice"}).status_code
        == 404
    )
    state.jobs.delete(pid)
    state.jobs.delete(pid)
    assert state.store.get("runs", created["run_id"]) is None
    assert state.store.get("projects", pid)["status"] == "deleted"
    assert state.store.list("global_quotas")[0]["reserved_input"] == 0


def test_immutable_artifact_and_event_resume(setup):
    client, state = setup
    run_id = create(client).json()["data"]["run_id"]
    state.store.append_event(run_id, "progress", {"message": "reading"})
    state.store.append_event(run_id, "progress", {"message": "checked"})
    response = client.get(
        f"/api/v1/runs/{run_id}/events?after_seq=1", headers={"Authorization": "Bearer alice"}
    )
    assert [event["seq"] for event in response.json()["data"]] == [2]
    first = client.get(f"/api/v1/runs/{run_id}/events?limit=1", headers={"Authorization": "Bearer alice"})
    assert [event["seq"] for event in first.json()["data"]] == [1]
    tail = client.get(f"/api/v1/runs/{run_id}/events?after_seq=2", headers={"Authorization": "Bearer alice"})
    assert tail.json()["data"] == []
    state.artifacts.put("projects/p_test/one.json.gz", {"x": 1})
    state.artifacts.put("projects/p_test/one.json.gz", {"x": 1})
    with pytest.raises(GrooveError, match="IMMUTABLE_CONFLICT"):
        state.artifacts.put("projects/p_test/one.json.gz", {"x": 2})


def test_cloud_event_poll_reads_only_requested_document_ids():
    class Document:
        exists = True

        def __init__(self, reference):
            self.reference = reference

        def to_dict(self):
            return {"seq": int(self.reference.rsplit("_", 1)[1])}

    class Database:
        requested = []

        def collection(self, collection):
            assert collection == "run_events"
            return self

        def document(self, identifier):
            return identifier

        def get_all(self, references):
            self.requested = references
            return [Document(reference) for reference in reversed(references)]

    store = MetadataStore.__new__(MetadataStore)
    store.cloud = True
    store.db = Database()
    assert store.events_after("run_mock", 1000, 2, 10000) == [{"seq": 1001}, {"seq": 1002}]
    assert store.db.requested == ["run_mock_001001", "run_mock_001002"]
    assert store.events_after("run_mock", 10000, 100, 10000) == []


def test_chunked_request_cannot_bypass_body_limit(setup):
    client, _state = setup
    response = client.post(
        "/api/v1/projects",
        content=(b"x" * 70000 for _ in range(3)),
        headers={"Content-Type": "application/json"},
    )
    assert response.status_code == 413


def test_unchanged_refresh_reuses_index_and_analysis_without_model_or_ai_quota(setup, monkeypatch):
    import asyncio
    import hashlib
    import json
    from pathlib import Path

    from code_groove.incremental import INDEX_VERSION, PROMPT_VERSION
    from code_groove.source import sample_snapshot

    client, state = setup
    initial = create(client).json()["data"]
    project_id = initial["project_id"]
    state.store.update("runs", initial["run_id"], {"status": "completed"})
    state.jobs.settle_quota(initial["run_id"])
    bundle = json.loads(
        (Path(__file__).resolve().parents[1] / "fixtures/mixed.json").read_text(encoding="utf-8")
    )
    sha, sources = sample_snapshot("mixed")
    snapshot_id = f"snap_{sha[:24]}_{hashlib.sha256(INDEX_VERSION.encode()).hexdigest()[:6]}"
    # A persisted map stands in for a previous completed job; this test never calls Gemini.
    bundle["map"].update(
        analysis_id="cached_analysis",
        model_id=state.jobs.settings.gemini_model,
        prompt_version=PROMPT_VERSION,
    )
    snapshot_key = f"projects/{project_id}/snapshots/{snapshot_id}/snapshot.json.gz"
    artifact_key = f"projects/{project_id}/analyses/cached.json.gz"
    state.artifacts.put(
        snapshot_key,
        {
            "sha": sha,
            "snapshot_id": snapshot_id,
            "sources": sources,
            "index": {"units": [], "files": []},
            "index_version": INDEX_VERSION,
        },
    )
    state.artifacts.put(artifact_key, bundle)
    state.store.put(
        "analyses", "cached_analysis", {"artifact_key": artifact_key, "snapshot_key": snapshot_key}
    )
    state.store.update(
        "projects",
        project_id,
        {"snapshot_key": snapshot_key, "latest_analysis_id": "cached_analysis", "status": "completed"},
    )

    def forbidden(*args, **kwargs):
        raise AssertionError("Unchanged cache must not index code or call Gemini")

    monkeypatch.setattr("code_groove.jobs.build_index", forbidden)
    monkeypatch.setattr("code_groove.jobs.run_agent", forbidden)
    response = client.post(
        f"/api/v1/projects/{project_id}/analyses",
        json={},
        headers={"Authorization": "Bearer alice", "Idempotency-Key": "refresh001"},
    )
    assert response.status_code == 202
    run_id = response.json()["data"]["run_id"]
    asyncio.run(state.jobs.handle(run_id))
    run = state.store.get("runs", run_id)
    assert run["status"] == "completed" and run["result_id"] == "cached_analysis"
    assert run["model_requests"] == run["input_tokens"] == run["output_tokens"] == 0
    assert run["quota_released"]
    quota = state.store.list("daily_quotas")[0]
    assert quota["analyses"] == 1 and quota["refreshes"] == 1 and quota["reserved_input"] == 0

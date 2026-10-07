import asyncio
import time

import pytest
from code_groove.agent import execute_tool
from code_groove.app import create_app
from code_groove.errors import GrooveError
from code_groove.reconciliation import follow_reconciliation, reconciliation_scope
from code_groove.repository import plan_repository
from code_groove.settings import Settings
from code_groove.source import build_index
from fastapi.testclient import TestClient


def snapshot():
    sources = {"a/policy.py": "def store():\n    return 30\n", "b/policy.py": "def web():\n    return 30\n"}
    index = build_index("snap_reconcile", sources, repository=True)
    return {
        "snapshot_id": "snap_reconcile",
        "sha": "a" * 40,
        "sources": sources,
        "index": index,
        "repository_plan": plan_repository(index, sources),
    }


def test_reconciliation_rejects_duplicate_and_outside_units():
    value = snapshot()
    chunks = [c["chunk_id"] for c in value["repository_plan"]["chunks"]]
    units = [u["unit_id"] for u in value["index"]["units"]]
    scope, partition = reconciliation_scope(value, chunks, units)
    assert len(scope["units"]) == 2 and partition["integration_chunk_ids"] == chunks
    for bad in ([units[0], units[0]], [units[0], "unit_outside"], [units[0]]):
        with pytest.raises(GrooveError):
            reconciliation_scope(value, chunks, bad)


def test_approved_snapshot_follows_exact_owners_or_requires_new_selection():
    previous = snapshot()
    sources = {"a/policy.py": "\ndef store():\n    return 21\n", "b/policy.py": "def web():\n    return 21\n"}
    index = build_index("snap_approved", sources, repository=True)
    current = {"index": index, "sources": sources, "repository_plan": plan_repository(index, sources)}
    metadata = {"integration_unit_ids": [u["unit_id"] for u in previous["repository_plan"]["owners"]]}
    chunks, units = follow_reconciliation(previous, current, metadata)
    assert len(chunks) == 2 and set(units) == {u["unit_id"] for u in current["repository_plan"]["owners"]}
    assert set(units).isdisjoint(metadata["integration_unit_ids"])
    current["repository_plan"]["owners"][0]["label"] = "renamed"
    with pytest.raises(GrooveError, match="INVALID_SELECTION"):
        follow_reconciliation(previous, current, metadata)


def test_owned_integration_re_reads_both_scopes_and_consumes_one_analysis(tmp_path, monkeypatch):
    app = create_app(
        Settings(_env_file=None, local_data_dir=tmp_path, enable_live_analysis=True, model_mode="live"),
        verifier=lambda token: token,
    )
    state = app.state
    client = TestClient(app)
    state.store.put("accounts", "alice", {"enabled": True})
    state.store.put("accounts", "bob", {"enabled": True})
    value = snapshot()
    state.artifacts.put("snapshot.json.gz", value)
    state.store.put(
        "projects",
        "p_reconcile",
        {
            "project_id": "p_reconcile",
            "owner_uid": "alice",
            "status": "partial",
            "expires_at": time.time() + 3600,
            "source": {"kind": "local_snapshot"},
            "snapshot_key": "snapshot.json.gz",
            "snapshot_id": value["snapshot_id"],
        },
    )
    chunks = [c["chunk_id"] for c in value["repository_plan"]["chunks"]]
    units = [u["unit_id"] for u in value["index"]["units"]]
    for i, cid in enumerate(chunks):
        key = f"saved_{i}.json.gz"
        state.artifacts.put(
            key,
            {
                "map": {
                    "analysis_id": f"analysis_saved_{i}",
                    "responsibilities": [],
                    "profile": {"unknowns": []},
                }
            },
        )
        state.store.put(
            "analyses",
            f"analysis_saved_{i}",
            {
                "analysis_id": f"analysis_saved_{i}",
                "owner_uid": "alice",
                "project_id": "p_reconcile",
                "chunk_id": cid,
                "snapshot_id": value["snapshot_id"],
                "artifact_key": key,
                "expires_at": time.time() + 3600,
                "created_at": i,
            },
        )
    headers = {"Authorization": "Bearer alice", "Idempotency-Key": "integration-0001"}
    body = {"chunk_ids": chunks, "unit_ids": units}
    endpoint = "/api/v1/projects/p_reconcile/integrations"
    assert (
        client.post(endpoint, json=body, headers={**headers, "Authorization": "Bearer bob"}).status_code
        == 404
    )
    created = client.post(endpoint, json=body, headers=headers)
    assert created.status_code == 202
    run_id = created.json()["data"]["run_id"]

    async def offline_model(ctx):
        assert len(ctx.integration_context) == 2 and ctx.evidence == []
        evidence = []
        for file in ctx.index["files"]:
            evidence += execute_tool(
                ctx,
                "read_code",
                {
                    "file_id": file["file_id"],
                    "start_line": 1,
                    "end_line": 2,
                    "purpose": "Mock fresh shared policy check",
                },
                "tool_mock",
            )["evidence_ids"]
        candidate = {
            "profile": {
                "title": "Mock cross-scope policy",
                "purpose": "offline contract test",
                "assumptions": [],
                "unknowns": ["Runtime and outside scope not checked"],
            },
            "responsibilities": [
                {
                    "responsibility_id": "resp_shared",
                    "label": "policy",
                    "definition": "shared window",
                    "change_reason": "return policy changes",
                    "evidence_ids": evidence,
                    "motif_id": "M0",
                    "display_order": 0,
                }
            ],
            "units": [
                {
                    "unit_id": u["unit_id"],
                    "label": u["label"],
                    "primary_span": u["primary_span"],
                    "member_symbol_ids": [u["unit_id"]],
                    "role": "policy",
                    "review_state": "inspected",
                    "boundary_reason": "Mock fresh read",
                    "evidence_ids": [evidence[i]],
                }
                for i, u in enumerate(ctx.index["units"])
            ],
            "events": [
                {
                    "event_id": f"event_{i}",
                    "concept_key": "window",
                    "label": "window",
                    "meaning": "30 days",
                    "responsibility_id": "resp_shared",
                    "unit_id": u["unit_id"],
                    "semantic_order": i,
                    "kind": "decision",
                    "span": u["primary_span"],
                    "evidence_ids": [evidence[i]],
                    "state": "grounded",
                }
                for i, u in enumerate(ctx.index["units"])
            ],
            "hypotheses": [],
            "review_signals": [],
        }
        return execute_tool(ctx, "submit_analysis", {"candidate": candidate}, "submit_mock")

    monkeypatch.setattr("code_groove.jobs.run_agent", offline_model)
    asyncio.run(state.jobs.handle(run_id))
    run = state.store.get("runs", run_id)
    assert run["status"] == "partial"
    result = client.get("/api/v1/projects/p_reconcile/bundle", headers=headers).json()["data"]
    assert result["map"]["integration_chunk_ids"] == chunks
    assert result["map"]["coverage"]["inspected_units"] == 2
    assert result["partition"]["whole_repository_complete"] is False
    assert state.store.list("daily_quotas")[0]["analyses"] == 1
    status = client.get("/api/v1/projects/p_reconcile/repository", headers=headers).json()["data"]
    assert status["cross_partition_review"] == "scoped"
    assert len(status["integrations"]) == 1

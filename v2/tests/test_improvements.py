import time

import pytest
from code_groove.agent import AgentContext, execute_tool
from code_groove.app import create_app
from code_groove.errors import GrooveError
from code_groove.improvements import apply_edits, source_hash
from code_groove.schemas import AnalysisCandidate, Evidence, ImprovementCandidate
from code_groove.settings import Settings
from fastapi.testclient import TestClient


@pytest.fixture
def workspace(tmp_path):
    app = create_app(
        Settings(local_data_dir=tmp_path, enable_live_analysis=True, model_mode="live"),
        verifier=lambda token: token,
    )
    for user in ("alice", "bob"):
        app.state.store.put("accounts", user, {"enabled": True})
    client = TestClient(app)
    headers = {"Authorization": "Bearer alice", "Idempotency-Key": "sample-copy-001"}
    copied = client.post("/api/v1/samples/recorded-returns-before/projects", json={}, headers=headers)
    assert copied.status_code == 201
    return client, app.state, headers, copied.json()["data"]


def draft(ctx):
    path = "src/store-return.ts"
    file = next(f for f in ctx.index["files"] if f["path"] == path)
    execute_tool(
        ctx,
        "read_code",
        {
            "file_id": file["file_id"],
            "start_line": 1,
            "end_line": len(ctx.sources[path].splitlines()),
            "purpose": "Read the source before drafting",
        },
        "tool_draft_read",
    )
    # A harmless rename keeps the integration focused on the approval boundary.
    return ImprovementCandidate(
        title="読み取りを検討する案",
        rationale="同じ処理を追いやすくする候補",
        tradeoffs="動作の確認が必要",
        verification="テストは実行していません",
        signal_ids=[ctx.base["review_signals"][0]["signal_id"]],
        evidence_ids=[ctx.evidence[0].evidence_id],
        edits=[
            {
                "path": path,
                "before": ctx.sources[path],
                "after": ctx.sources[path]
                .replace("const age =", "const elapsedDays =")
                .replace("age >= 0 && age <= limit", "elapsedDays >= 0 && elapsedDays <= limit"),
            }
        ],
    )


async def create_proposal(workspace, monkeypatch):
    client, state, headers, copied = workspace

    async def agent(ctx):
        candidate = draft(ctx)
        return execute_tool(ctx, "submit_proposal", {"candidate": candidate.model_dump()}, "tool_draft_final")

    monkeypatch.setattr("code_groove.jobs.run_agent", agent)
    base = client.get(f"/api/v1/projects/{copied['project_id']}/bundle", headers=headers).json()["data"]
    signal = next(s for s in base["map"]["review_signals"] if s["verdict"] == "concern")
    response = client.post(
        f"/api/v1/analyses/{copied['analysis_id']}/proposals",
        json={"signal_id": signal["signal_id"]},
        headers={**headers, "Idempotency-Key": "draft-001"},
    )
    assert response.status_code == 202
    run_id = response.json()["data"]["run_id"]
    await state.jobs.handle(run_id)
    run = state.store.get("runs", run_id)
    assert run["status"] == "completed", run
    return run["result_id"], base


@pytest.mark.asyncio
async def test_proposal_is_read_only_and_accept_is_atomic_budgeted_and_idempotent(workspace, monkeypatch):
    client, state, headers, copied = workspace
    proposal_id, base = await create_proposal(workspace, monkeypatch)
    assert state.store.get("projects", copied["project_id"])["latest_analysis_id"] == copied["analysis_id"]
    assert (
        client.get(f"/api/v1/proposals/{proposal_id}", headers={"Authorization": "Bearer bob"}).status_code
        == 404
    )
    proposal = client.get(f"/api/v1/proposals/{proposal_id}", headers=headers).json()["data"]
    assert proposal["status"] == "draft" and "elapsedDays" in proposal["diff"]
    before = client.get(f"/api/v1/projects/{copied['project_id']}/bundle", headers=headers).json()["data"]
    assert before["sources"] == base["sources"]
    path = f"/api/v1/proposals/{proposal_id}/accept"
    accepted = client.post(path, json={}, headers={**headers, "Idempotency-Key": "accept-001"})
    assert accepted.status_code == 202, accepted.json()
    assert (
        client.post(path, json={}, headers={**headers, "Idempotency-Key": "accept-001"}).json()
        == accepted.json()
    )
    assert client.post(path, json={}, headers={**headers, "Idempotency-Key": "accept-002"}).status_code == 429
    assert client.post(f"/api/v1/proposals/{proposal_id}/reject", json={}, headers=headers).status_code == 409
    current = state.store.get("projects", copied["project_id"])
    assert current["latest_analysis_id"] == copied["analysis_id"]
    run_id = accepted.json()["data"]["run_id"]
    assert state.store.get("runs", run_id)["analysis_counted"] is True
    assert state.store.list("daily_quotas")[0]["analyses"] == 1
    assert state.artifacts.get(current["snapshot_key"])["sources"] == base["sources"]


@pytest.mark.asyncio
async def test_rejected_and_stale_proposals_cannot_change_code(workspace, monkeypatch):
    client, state, headers, copied = workspace
    proposal_id, _ = await create_proposal(workspace, monkeypatch)
    state.store.update("projects", copied["project_id"], {"latest_analysis_id": "analysis_newer"})
    assert client.post(f"/api/v1/proposals/{proposal_id}/accept", json={}, headers=headers).status_code == 409
    state.store.update("projects", copied["project_id"], {"latest_analysis_id": copied["analysis_id"]})
    assert client.post(f"/api/v1/proposals/{proposal_id}/reject", json={}, headers=headers).status_code == 200
    assert client.post(f"/api/v1/proposals/{proposal_id}/accept", json={}, headers=headers).status_code == 409
    assert state.store.list("daily_quotas")[0]["analyses"] == 0
    state.store.update("projects", copied["project_id"], {"expires_at": time.time() - 1})
    assert client.get(f"/api/v1/proposals/{proposal_id}", headers=headers).status_code == 410


@pytest.mark.asyncio
@pytest.mark.parametrize("used, expected", [(9, 202), (10, 429)])
async def test_acceptance_analysis_quota_boundary_preserves_draft_on_rejection(
    workspace, monkeypatch, used, expected
):
    client, state, headers, _ = workspace
    proposal_id, _ = await create_proposal(workspace, monkeypatch)
    run = state.store.list("runs")[0]
    state.store.update("daily_quotas", run["quota_id"], {"analyses": used})
    result = client.post(f"/api/v1/proposals/{proposal_id}/accept", json={}, headers=headers)
    assert result.status_code == expected
    if expected == 429:
        assert result.json()["error"]["code"] == "DAILY_QUOTA"
        assert state.store.get("proposals", proposal_id)["status"] == "draft"
        assert len(state.store.list("runs")) == 1
    else:
        assert state.store.get("proposals", proposal_id)["status"] == "accepted"
        assert state.store.list("daily_quotas")[0]["analyses"] == 10


def test_exact_edits_require_read_evidence_and_safe_paths(workspace):
    _, state, _, copied = workspace
    meta = state.store.get("analyses", copied["analysis_id"])
    snapshot = state.artifacts.get(meta["snapshot_key"])
    base = state.artifacts.get(meta["artifact_key"])["map"]
    ctx = AgentContext(
        state.jobs.settings,
        copied["project_id"],
        snapshot["snapshot_id"],
        snapshot["sources"],
        snapshot["index"],
        lambda *_: None,
        lambda: None,
        lambda _: None,
        base=base,
        proposing=True,
    )
    candidate = draft(ctx)
    changed = apply_edits(candidate, ctx.sources, ctx.evidence)
    assert source_hash(changed) != source_hash(ctx.sources)
    large_sources = {**ctx.sources, **{f"context-{i}.md": "x" * 150000 for i in range(4)}}
    assert apply_edits(candidate, large_sources, ctx.evidence)["context-0.md"] == large_sources["context-0.md"]
    for path in (
        "../src/store-return.ts",
        ".github/workflows/deploy.yml",
        "src/.env",
        "tests/check.py",
        "src/test_policy.py",
    ):
        bad = candidate.model_copy(deep=True)
        bad.edits[0].path = path
        with pytest.raises(GrooveError, match="INVALID_PROPOSAL"):
            apply_edits(bad, ctx.sources, ctx.evidence)
    with pytest.raises(GrooveError, match="INVALID_PROPOSAL"):
        apply_edits(candidate, ctx.sources, [])
    bad = candidate.model_copy(deep=True)
    bad.edits[0].before = "missing source"
    with pytest.raises(GrooveError, match="INVALID_PROPOSAL"):
        apply_edits(bad, ctx.sources, ctx.evidence)
    bad = candidate.model_copy(deep=True)
    bad.edits[0].after = "export function broken( {"
    with pytest.raises(GrooveError, match="SOURCE_PARSE_FAILED"):
        execute_tool(ctx, "submit_proposal", {"candidate": bad.model_dump()}, "tool_invalid")


def test_recorded_adoption_keeps_origin_and_static_contracts(workspace):
    client, state, headers, copied = workspace
    assert (
        client.post("/api/v1/samples/recorded-returns-before/projects", json={}, headers=headers).json()[
            "data"
        ]
        == copied
    )
    meta = state.store.get("analyses", copied["analysis_id"])
    stored = state.artifacts.get(meta["artifact_key"])
    from code_groove.validation import validate_candidate

    candidate = AnalysisCandidate.model_validate(
        {k: stored["map"][k] for k in AnalysisCandidate.model_fields if k in stored["map"]}
    )
    validate_candidate(
        candidate,
        state.artifacts.get(meta["snapshot_key"])["index"],
        [Evidence(**e) for e in stored["map"]["evidence"]],
    )
    assert stored["map"]["origin"] == "recorded_live"
    assert state.store.list("runs") == []


@pytest.mark.asyncio
async def test_accepted_snapshot_is_reanalysed_without_overwriting_original(workspace, monkeypatch):
    client, state, headers, copied = workspace
    proposal_id, before = await create_proposal(workspace, monkeypatch)
    accepted = client.post(
        f"/api/v1/proposals/{proposal_id}/accept",
        json={},
        headers={**headers, "Idempotency-Key": "process-001"},
    ).json()["data"]

    async def inspect_changed(ctx):
        assert "const elapsedDays" in ctx.sources["src/store-return.ts"]
        assert ctx.prior_motifs
        value = {k: before["map"][k] for k in AnalysisCandidate.model_fields if k in before["map"]}
        import copy

        value = copy.deepcopy(value)
        by_span = {
            (u["primary_span"]["path"], u["primary_span"]["start_line"], u["primary_span"]["end_line"]): u
            for u in ctx.index["units"]
        }
        aliases = {}
        for unit in value["units"]:
            span = unit["primary_span"]
            target = by_span[(span["path"], span["start_line"], span["end_line"])]
            aliases[unit["unit_id"]] = target["unit_id"]
            unit["unit_id"] = target["unit_id"]
        proofs = {}
        for file in ctx.index["files"]:
            execute_tool(
                ctx,
                "read_code",
                {
                    "file_id": file["file_id"],
                    "start_line": 1,
                    "end_line": file["lines"],
                    "purpose": "Verify accepted source",
                },
                "tool_reanalysis",
            )
            proofs[file["path"]] = ctx.evidence[-1].evidence_id
        old_proofs = {e["evidence_id"]: proofs[e["span"]["path"]] for e in before["map"]["evidence"]}
        for collection in ("responsibilities", "units", "events", "hypotheses", "review_signals"):
            for item in value[collection]:
                item["evidence_ids"] = [old_proofs[e] for e in item["evidence_ids"]]
                if "alternative_evidence_ids" in item:
                    item["alternative_evidence_ids"] = [
                        old_proofs[e] for e in item["alternative_evidence_ids"]
                    ]
                if collection == "events":
                    item["unit_id"] = aliases[item["unit_id"]]
                if collection == "review_signals":
                    item["counter_explanation"] = "Mock fresh counter-explanation check"
                    item["counter_status"] = "rejected"
                    item["unit_ids"] = [aliases[u] for u in item["unit_ids"]]
        return execute_tool(ctx, "submit_analysis", {"candidate": value}, "tool_reanalysis_final")

    monkeypatch.setattr("code_groove.jobs.run_agent", inspect_changed)
    await state.jobs.handle(accepted["run_id"])
    run = state.store.get("runs", accepted["run_id"])
    assert run["status"] == "completed", run
    project = state.store.get("projects", copied["project_id"])
    assert project["previous_analysis_id"] == copied["analysis_id"] and project["working_copy"]
    new = client.get(f"/api/v1/projects/{copied['project_id']}/bundle", headers=headers).json()["data"]
    old = client.get(
        f"/api/v1/projects/{copied['project_id']}/bundle?analysis={copied['analysis_id']}", headers=headers
    ).json()["data"]
    assert old["sources"] == before["sources"]
    assert new["map"]["parent_analysis_id"] == copied["analysis_id"]
    assert new["map"]["origin"] == "live" and new["map"]["review_signals"]
    assert new["trace"]
    assert all(set(e) == {"seq", "type", "timestamp", "payload"} for e in new["trace"])
    # Acceptance does not force removal of a concern, even in a deterministic test.
    assert any(s["verdict"] == "concern" for s in new["map"]["review_signals"])

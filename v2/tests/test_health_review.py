import copy
import json

import pytest
from code_groove.agent import AgentContext, execute_tool
from code_groove.app import create_app
from code_groove.errors import GrooveError
from code_groove.schemas import DesignPattern, InvestigationCandidate
from code_groove.settings import ROOT, Settings
from code_groove.source import build_index
from code_groove.validation import validate_investigation
from fastapi.testclient import TestClient


def fresh_review(base, sources, ctx=None):
    ctx = ctx or AgentContext(
        Settings(),
        base["project_id"],
        base["snapshot_id"],
        sources,
        build_index(base["snapshot_id"], sources),
        lambda *_: None,
        lambda: None,
        lambda _: None,
        base=base,
    )
    signal = copy.deepcopy(next(s for s in base["review_signals"] if s["verdict"] == "concern"))
    paths = {u["primary_span"]["path"] for u in base["units"] if u["unit_id"] in signal["unit_ids"]}
    for path in paths:
        file = next(f for f in ctx.index["files"] if f["path"] == path)
        execute_tool(
            ctx,
            "read_code",
            {
                "file_id": file["file_id"],
                "start_line": 1,
                "end_line": len(sources[path].splitlines()),
                "purpose": "Recheck selected boundary",
            },
            f"read_{len(ctx.evidence)}",
        )
    signal["evidence_ids"] = [e.evidence_id for e in ctx.evidence]
    signal["alternative_evidence_ids"] = signal["evidence_ids"]
    signal["counter_explanation"] = "Mock counter-explanation checked with fresh evidence"
    signal["counter_status"] = "rejected"
    return ctx, InvestigationCandidate(
        review_signals=[signal],
        findings=[
            {
                "finding_id": "finding_health",
                "verdict": "concern",
                "summary": "Future coordination needs a human decision",
                "justification": "Freshly checked the related source boundary",
                "evidence_ids": signal["evidence_ids"],
            }
        ],
        hypotheses=[],
    )


@pytest.mark.asyncio
async def test_fresh_investigation_is_saved_for_reload_without_another_model_run(tmp_path, monkeypatch):
    app = create_app(
        Settings(local_data_dir=tmp_path, enable_live_analysis=True, model_mode="live"),
        verifier=lambda token: token,
    )
    app.state.store.put("accounts", "alice", {"enabled": True})
    client = TestClient(app)
    headers = {"Authorization": "Bearer alice", "Idempotency-Key": "health-resume"}
    copied = client.post("/api/v1/samples/recorded-returns-before/projects", json={}, headers=headers).json()[
        "data"
    ]
    bundle = client.get(f"/api/v1/projects/{copied['project_id']}/bundle", headers=headers).json()["data"]
    event = bundle["map"]["events"][0]
    calls = []

    async def agent(ctx):
        calls.append(ctx)
        _, candidate = fresh_review(ctx.base, ctx.sources, ctx)
        return execute_tool(
            ctx, "submit_investigation", {"candidate": candidate.model_dump(mode="json")}, "submit_health"
        )

    monkeypatch.setattr("code_groove.jobs.run_agent", agent)
    created = client.post(
        f"/api/v1/analyses/{copied['analysis_id']}/investigations",
        json={
            "scene_id": bundle["score"]["scenes"][0]["scene_id"],
            "unit_ids": [event["unit_id"]],
            "event_ids": [event["event_id"]],
            "question": "Check future friction and legitimate boundaries",
        },
        headers={**headers, "Idempotency-Key": "health-inv"},
    ).json()["data"]
    assert app.state.store.get("projects", copied["project_id"])["investigation_run_id"] == created["run_id"]
    await app.state.jobs.handle(created["run_id"])
    run = app.state.store.get("runs", created["run_id"])
    assert run["status"] == "completed", run.get("error")
    project = client.get(f"/api/v1/projects/{copied['project_id']}", headers=headers).json()["data"]
    assert project["latest_investigation_id"] == run["result_id"]
    assert not project["investigation_run_id"]
    assert project["investigation_analysis_id"] == copied["analysis_id"]
    assert (
        client.get(
            f"/api/v1/investigations/{project['latest_investigation_id']}", headers=headers
        ).status_code
        == 200
    )
    assert len(calls) == 1


def test_initial_detection_is_preserved_but_proposal_requires_focused_confirmation(tmp_path):
    settings = Settings(local_data_dir=tmp_path, enable_live_analysis=True, model_mode="live")
    app = create_app(settings, verifier=lambda token: token)
    app.state.store.put("accounts", "alice", {"enabled": True})
    app.state.store.put("accounts", "bob", {"enabled": True})
    client = TestClient(app)
    headers = {"Authorization": "Bearer alice", "Idempotency-Key": "health-copy"}
    copied = client.post("/api/v1/samples/recorded-returns-before/projects", json={}, headers=headers).json()[
        "data"
    ]
    meta = app.state.store.get("analyses", copied["analysis_id"])
    bundle = app.state.artifacts.get(meta["artifact_key"])
    bundle["map"]["analysis_depth"] = "overview"
    meta = {**meta, "artifact_key": "health/overview"}
    app.state.store.update("analyses", copied["analysis_id"], {"artifact_key": meta["artifact_key"]})
    app.state.artifacts.put(meta["artifact_key"], bundle)
    snapshot = app.state.artifacts.get(meta["snapshot_key"])
    ctx, candidate = fresh_review(bundle["map"], snapshot["sources"])
    peers = list(
        {
            u["primary_span"]["path"]: u
            for u in bundle["map"]["units"]
            if u["unit_id"] in candidate.review_signals[0].unit_ids
        }.values()
    )
    candidate.design_patterns = [
        DesignPattern(
            pattern_id="pattern_health",
            label="Checked contract peers",
            kind="domain_rule",
            description="Mock shared rule, not a quality verdict",
            scope_note="Only the freshly read pair is covered",
            peer_unit_ids=[u["unit_id"] for u in peers],
            evidence_ids=[e.evidence_id for e in ctx.evidence],
        )
    ]
    signal_id = candidate.review_signals[0].signal_id
    assert (
        client.post(
            f"/api/v1/analyses/{copied['analysis_id']}/proposals",
            json={"signal_id": signal_id},
            headers=headers,
        ).status_code
        == 409
    )
    assert client.get(f"/api/v1/projects/{copied['project_id']}/bundle", headers=headers).json()["data"][
        "map"
    ]["review_signals"]
    validate_investigation(candidate, ctx.evidence, bundle["map"])
    result = {
        **candidate.model_dump(mode="json"),
        "base_analysis_id": copied["analysis_id"],
        "evidence": [e.model_dump(mode="json") for e in ctx.evidence],
    }
    app.state.artifacts.put("health/result", result)
    app.state.store.put("investigations", "inv_health", {**meta, "artifact_key": "health/result"})
    assert (
        client.post(
            "/api/v1/investigations/inv_health/publish-interpretation",
            json={},
            headers={"Authorization": "Bearer bob"},
        ).status_code
        == 404
    )
    published = client.post(
        "/api/v1/investigations/inv_health/publish-interpretation", json={}, headers=headers
    )
    assert published.status_code == 200, published.text
    next_id = published.json()["data"]["analysis_id"]
    current = client.get(f"/api/v1/projects/{copied['project_id']}/bundle", headers=headers).json()["data"]
    assert current["map"]["analysis_depth"] == "focused"
    assert current["map"]["parent_analysis_id"] == copied["analysis_id"]
    assert current["map"]["design_patterns"][0]["pattern_id"] == "pattern_health"
    assert current["sources"] == snapshot["sources"]
    assert app.state.artifacts.get(meta["artifact_key"])["map"]["analysis_depth"] == "overview"
    assert not app.state.store.list("runs")
    assert (
        client.post(
            "/api/v1/investigations/inv_health/publish-interpretation", json={}, headers=headers
        ).status_code
        == 409
    )
    assert (
        client.post(
            f"/api/v1/analyses/{next_id}/proposals",
            json={"signal_id": signal_id},
            headers={**headers, "Idempotency-Key": "health-proposal"},
        ).status_code
        == 202
    )


def test_focused_signals_require_fresh_covering_reads_and_existing_events():
    bundle = json.loads((ROOT / "fixtures/recorded-live/returns-before.json").read_text(encoding="utf-8"))
    ctx, candidate = fresh_review(bundle["map"], bundle["sources"])
    validate_investigation(candidate, ctx.evidence, bundle["map"])
    stale = copy.deepcopy(candidate)
    stale.review_signals[0].evidence_ids = bundle["map"]["review_signals"][0]["evidence_ids"]
    stale.review_signals[0].alternative_evidence_ids = stale.review_signals[0].evidence_ids
    with pytest.raises(GrooveError, match="INVALID_EVIDENCE"):
        validate_investigation(stale, ctx.evidence, bundle["map"])
    candidate.review_signals[0].event_ids = ["invented_event"]
    with pytest.raises(GrooveError, match="INVALID_ANALYSIS"):
        validate_investigation(candidate, ctx.evidence, bundle["map"])


def test_withdrawn_candidate_cannot_keep_sounding_or_start_a_proposal(tmp_path):
    app = create_app(
        Settings(local_data_dir=tmp_path, enable_live_analysis=True, model_mode="live"),
        verifier=lambda token: token,
    )
    app.state.store.put("accounts", "alice", {"enabled": True})
    client = TestClient(app)
    headers = {"Authorization": "Bearer alice", "Idempotency-Key": "withdraw-copy"}
    copied = client.post("/api/v1/samples/recorded-returns-before/projects", json={}, headers=headers).json()[
        "data"
    ]
    meta = app.state.store.get("analyses", copied["analysis_id"])
    original = app.state.artifacts.get(meta["artifact_key"])
    sources = app.state.artifacts.get(meta["snapshot_key"])["sources"]
    ctx, candidate = fresh_review(original["map"], sources)
    signal_id = candidate.review_signals[0].signal_id
    candidate.review_signals = []
    candidate.replaced_signal_ids = [signal_id]
    candidate.findings[0].verdict = "justified_difference"
    candidate.findings[0].summary = "The checked boundary has a separate operating contract"
    validate_investigation(candidate, ctx.evidence, original["map"])
    with pytest.raises(GrooveError, match="INVALID_EVIDENCE"):
        validate_investigation(candidate, ctx.evidence[:1], original["map"])
    unknown = candidate.model_copy(deep=True)
    unknown.replaced_signal_ids = ["missing_signal"]
    with pytest.raises(GrooveError, match="INVALID_ANALYSIS"):
        validate_investigation(unknown, ctx.evidence, original["map"])
    app.state.artifacts.put(
        "health/withdraw",
        {
            **candidate.model_dump(mode="json"),
            "base_analysis_id": copied["analysis_id"],
            "evidence": [e.model_dump(mode="json") for e in ctx.evidence],
        },
    )
    app.state.store.put("investigations", "inv_withdraw", {**meta, "artifact_key": "health/withdraw"})
    published = client.post(
        "/api/v1/investigations/inv_withdraw/publish-interpretation", json={}, headers=headers
    )
    assert published.status_code == 200, published.text
    current = client.get(f"/api/v1/projects/{copied['project_id']}/bundle", headers=headers).json()["data"]
    assert current["sources"] == sources
    assert signal_id not in {s["signal_id"] for s in current["map"]["review_signals"]}
    assert not any(
        note.get("signal_id") == signal_id
        for scene in current["score"]["scenes"]
        for mode in ("theme", "repo")
        for note in scene[mode]["notes"]
    )
    assert app.state.artifacts.get(meta["artifact_key"])["map"] == original["map"]
    assert (
        client.post(
            f"/api/v1/analyses/{current['map']['analysis_id']}/proposals",
            json={"signal_id": signal_id},
            headers={**headers, "Idempotency-Key": "withdraw-proposal"},
        ).status_code
        == 400
    )
    assert not app.state.store.list("runs")

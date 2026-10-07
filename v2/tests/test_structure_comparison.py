import copy
import json
from datetime import UTC, datetime
from types import SimpleNamespace

import pytest
from code_groove.agent import AgentContext, execute_tool, run_agent
from code_groove.app import create_app
from code_groove.errors import GrooveError
from code_groove.schemas import ComparisonAnswerCandidate, ComparisonExport, ComparisonInvestigationRequest
from code_groove.settings import Settings
from code_groove.source import build_index
from code_groove.structure import structure_data
from fastapi.testclient import TestClient
from google import genai
from google.genai import types


@pytest.fixture
def setup(tmp_path):
    app = create_app(
        Settings(local_data_dir=tmp_path, model_mode="live", enable_live_analysis=True),
        verifier=lambda token: token,
    )
    for user in ("alice", "bob"):
        app.state.store.put("accounts", user, {"enabled": True})
    client = TestClient(app)
    headers = {"Authorization": "Bearer alice", "Idempotency-Key": "structure-copy-001"}
    copied = client.post("/api/v1/samples/recorded-returns-before/projects", json={}, headers=headers).json()[
        "data"
    ]
    meta = app.state.store.get("analyses", copied["analysis_id"])
    # This private temporary fixture adds static units outside every meaning event/scene.
    snapshot = app.state.artifacts.get(meta["snapshot_key"])
    snapshot["sources"]["extra.ts"] = (
        "export function extraA(x: number) { return x + 30; }\nexport function extraB(x: number) { return x + 60; }"
    )
    snapshot["snapshot_id"] = "snap_comparison_mock"
    snapshot["index"] = build_index(snapshot["snapshot_id"], snapshot["sources"])
    snapshot_key = f"projects/{copied['project_id']}/snapshots/snap_comparison_mock/snapshot.json.gz"
    app.state.artifacts.put(snapshot_key, snapshot)
    mock_bundle = app.state.artifacts.get(meta["artifact_key"])
    mock_bundle["map"].update(snapshot_id=snapshot["snapshot_id"], origin="fixture")
    artifact_key = f"projects/{copied['project_id']}/analyses/mock_base/bundle.json.gz"
    app.state.artifacts.put(artifact_key, mock_bundle)
    app.state.store.update(
        "analyses",
        copied["analysis_id"],
        {"snapshot_key": snapshot_key, "snapshot_id": snapshot["snapshot_id"], "artifact_key": artifact_key},
    )
    app.state.store.update(
        "projects",
        copied["project_id"],
        {"snapshot_key": snapshot_key, "snapshot_id": snapshot["snapshot_id"]},
    )
    inventory = structure_data(snapshot)
    units = [u for u in inventory["units"] if u["label"].startswith("extra")]
    comparison = structure_data(snapshot, units[0]["unit_id"], units[1]["unit_id"])["comparison"]
    request = {
        "record_id": "record_test",
        "snapshot_id": snapshot["snapshot_id"],
        "comparison_id": comparison["comparison_id"],
        "unit_a": comparison["a"]["unit_id"],
        "unit_b": comparison["b"]["unit_id"],
        "source_hash_a": comparison["a"]["source_hash"],
        "source_hash_b": comparison["b"]["source_hash"],
        "start_row": 0,
        "end_row": len(comparison["rows"]),
        "expectation": "同じ上限だと思う",
        "observation": "30と60",
        "question": "仕様に応じた違いですか？",
    }
    return client, app.state, headers, copied, snapshot, request


def candidate(ctx):
    return {
        "interpretation": "inconclusive",
        "summary": "Mock: need product policy",
        "reason": "The constants differ",
        "counter_explanation": "Different product contracts could justify both",
        "unknowns": ["product policy"],
        "evidence_ids": [e.evidence_id for e in ctx.evidence],
    }


def fresh_reads(ctx):
    for unit in ctx.index["units"]:
        execute_tool(
            ctx,
            "read_code",
            {
                **{k: unit["primary_span"][k] for k in ("file_id", "start_line", "end_line")},
                "purpose": "Read both static selections afresh",
            },
            "mock_read",
        )


def test_selection_ownership_snapshot_hash_range_and_no_scene_requirement(setup):
    client, state, headers, ids, snapshot, request = setup
    path = f"/api/v1/analyses/{ids['analysis_id']}/comparison-investigations"
    assert (
        client.get(
            path.replace("comparison-investigations", "structure"), headers={"Authorization": "Bearer bob"}
        ).status_code
        == 404
    )
    assert client.post(path, json=request).status_code == 401
    for field, value in [
        ("snapshot_id", "snap_other"),
        ("comparison_id", "comparison_wrong"),
        ("source_hash_a", "0" * 64),
        ("end_row", 9999),
        ("unit_b", request["unit_a"]),
        ("start_row", request["end_row"]),
    ]:
        response = client.post(path, json={**request, field: value}, headers=headers)
        assert response.status_code in (400, 409), response.text
    assert state.store.list("runs") == []
    admitted = client.post(path, json=request, headers=headers)
    assert admitted.status_code == 202, admitted.text
    run = state.store.get("runs", admitted.json()["data"]["run_id"])
    assert (
        run["kind"] == "investigation" and run["reserved_input"] == 160000 and run["reserved_output"] == 20000
    )
    assert "scene_id" not in run["body"] and run["body"]["event_ids"] == []
    assert state.store.get("projects", ids["project_id"])["comparison_run_id"] == run["run_id"]
    assert client.post(path, json=request, headers=headers).json()["data"]["run_id"] == run["run_id"]
    assert client.post(f"/api/v1/runs/{run['run_id']}/cancel", json={}, headers=headers).status_code == 200
    assert state.store.get("runs", run["run_id"])["status"] == "cancelled"
    assert state.store.list("global_quotas")[0]["reserved_input"] == 0


def test_reuses_investigation_quota_global_budget_and_stale_base(setup):
    client, state, headers, ids, _, request = setup
    path = f"/api/v1/analyses/{ids['analysis_id']}/comparison-investigations"
    date = datetime.now(UTC).strftime("%Y-%m-%d")
    quota_id = f"alice_{date}"
    state.store.put("daily_quotas", quota_id, {"investigations": 10})
    response = client.post(path, json=request, headers=headers)
    assert response.status_code == 429 and response.json()["error"]["code"] == "DAILY_QUOTA"
    state.store.put(
        "daily_quotas",
        quota_id,
        {
            "investigations": 0,
            "analyses": 0,
            "reserved_input": 0,
            "reserved_output": 0,
            "consumed_input": 0,
            "consumed_output": 0,
        },
    )
    state.store.put(
        "global_quotas",
        date,
        {"reserved_input": 3000000, "reserved_output": 0, "consumed_input": 0, "consumed_output": 0},
    )
    assert client.post(path, json=request, headers=headers).json()["error"]["code"] == "GLOBAL_QUOTA"
    state.store.update("projects", ids["project_id"], {"latest_analysis_id": "analysis_other"})
    assert client.post(path, json=request, headers=headers).status_code == 409
    assert state.store.list("runs") == []


@pytest.mark.asyncio
async def test_worker_reads_static_non_scene_units_and_keeps_answer_separate(setup, monkeypatch):
    client, state, headers, ids, _, request = setup
    original = copy.deepcopy(
        state.artifacts.get(state.store.get("analyses", ids["analysis_id"])["artifact_key"])
    )

    async def mock_agent(ctx):
        assert ctx.comparing and ctx.investigating
        assert {u["unit_id"] for u in ctx.index["units"]} == {request["unit_a"], request["unit_b"]}
        assert ctx.selection["comparison"]["question"] == request["question"]
        assert ctx.selection["comparison_context"]["rows"]
        fresh_reads(ctx)
        return execute_tool(ctx, "submit_investigation", {"candidate": candidate(ctx)}, "submit_mock")

    monkeypatch.setattr("code_groove.jobs.run_agent", mock_agent)
    response = client.post(
        f"/api/v1/analyses/{ids['analysis_id']}/comparison-investigations", json=request, headers=headers
    )
    run_id = response.json()["data"]["run_id"]
    await state.jobs.handle(run_id)
    run = state.store.get("runs", run_id)
    assert run["status"] == "completed", run
    result = client.get(f"/api/v1/investigations/{run['result_id']}", headers=headers).json()["data"]
    assert result["request"] == request and result["kind"] == "structure_comparison"
    assert len(result["evidence"]) == 2
    assert (
        client.get(
            f"/api/v1/investigations/{run['result_id']}", headers={"Authorization": "Bearer bob"}
        ).status_code
        == 404
    )
    assert (
        client.post(
            f"/api/v1/investigations/{run['result_id']}/publish-interpretation", json={}, headers=headers
        ).status_code
        == 400
    )
    project = state.store.get("projects", ids["project_id"])
    assert project["latest_analysis_id"] == ids["analysis_id"] and "latest_investigation_id" not in project
    assert state.artifacts.get(state.store.get("analyses", ids["analysis_id"])["artifact_key"]) == original
    assert state.store.get("daily_quotas", run["quota_id"])["investigations"] == 1


def test_tool_submit_rejects_missing_fresh_full_reads(setup):
    _, _, _, _, snapshot, request = setup
    index = {
        **snapshot["index"],
        "units": [
            u for u in snapshot["index"]["units"] if u["unit_id"] in (request["unit_a"], request["unit_b"])
        ],
    }
    ctx = AgentContext(
        Settings(),
        "p_mock",
        snapshot["snapshot_id"],
        snapshot["sources"],
        index,
        lambda *_: None,
        lambda: None,
        lambda _: None,
        base={"analysis_id": "analysis_mock"},
        selection={"comparison": request},
    )
    with pytest.raises(GrooveError, match="INVALID_ANALYSIS"):
        execute_tool(ctx, "submit_investigation", {"candidate": candidate(ctx)}, "bad_submit")
    unit = index["units"][0]
    execute_tool(
        ctx,
        "read_code",
        {
            **{k: unit["primary_span"][k] for k in ("file_id", "start_line", "end_line")},
            "purpose": "one only",
        },
        "read_one",
    )
    with pytest.raises(GrooveError, match="INVALID_ANALYSIS"):
        execute_tool(ctx, "submit_investigation", {"candidate": candidate(ctx)}, "bad_submit_2")


def test_public_mock_reads_receipts_and_roundtrip_export_contract(tmp_path):
    app = create_app(Settings(local_data_dir=tmp_path, model_mode="fixture"))
    client = TestClient(app)
    inventory = client.get("/api/v1/comparison-demo/structure").json()["data"]
    unit_a = next(u for u in inventory["units"] if u["label"] == "orderA")["unit_id"]
    unit_b = next(u for u in inventory["units"] if u["label"] == "orderB")["unit_id"]
    data = client.get(f"/api/v1/comparison-demo/structure?unit_a={unit_a}&unit_b={unit_b}").json()["data"]
    comp = data["comparison"]
    request = ComparisonInvestigationRequest(
        record_id="record_mock",
        snapshot_id=comp["a"]["snapshot_id"],
        comparison_id=comp["comparison_id"],
        unit_a=unit_a,
        unit_b=unit_b,
        source_hash_a=comp["a"]["source_hash"],
        source_hash_b=comp["b"]["source_hash"],
        start_row=0,
        end_row=len(comp["rows"]),
        expectation="",
        observation="",
        question="順序の仕様は？",
    )
    answer = client.post(
        "/api/v1/samples/structure-demo/comparison-investigations/mock", json=request.model_dump()
    ).json()["data"]
    assert answer["origin"] == "fixture" and answer["model_id"] == "mock-no-model"
    assert app.state.store.list("runs") == [] and app.state.store.list("daily_quotas") == []
    now = datetime.now(UTC).isoformat()
    export = ComparisonExport(
        material_id="structure-demo-v1",
        code_revision="v1",
        comparison=comp,
        playback=data["playback"],
        agent_context={"origin": "fixture"},
        presentation={"sound_enabled": False},
        record={
            "record_id": "record_mock",
            "expectation": "",
            "observation": "",
            "question": "順序の仕様は？",
            "recognition": "not_recognized",
            "reason_status": "deferred",
            "judgment": "insufficient_context",
            "reason_evidence": "",
            "started_at": now,
            "updated_at": now,
            "ended_at": None,
            "operations": [],
            "answers": [answer],
        },
        exported_at=now,
    )
    assert ComparisonExport.model_validate_json(export.model_dump_json()) == export


class ComparisonClient(genai.Client):
    def __init__(self, ctx):
        self.ctx, self.calls, self.closed = ctx, [], False
        self.test_aio = SimpleNamespace(models=self, aclose=self.aclose)

    @property
    def aio(self):
        return self.test_aio

    @property
    def vertexai(self):
        return False

    async def count_tokens(self, **_kwargs):
        return types.CountTokensResponse(total_tokens=100)

    async def generate_content(self, **kwargs):
        self.calls.append(kwargs)
        if len(self.calls) == 1:
            parts = [
                types.Part(
                    thought_signature=b"mock-signature",
                    function_call=types.FunctionCall(
                        id=f"read-{i}",
                        name="read_code",
                        args={
                            **{k: u["primary_span"][k] for k in ("file_id", "start_line", "end_line")},
                            "purpose": "Compare selected implementations",
                        },
                    ),
                )
                for i, u in enumerate(self.ctx.index["units"])
            ]
        else:
            parts = [
                types.Part(
                    function_call=types.FunctionCall(
                        id="submit-original",
                        name="submit_investigation",
                        args={"candidate": candidate(self.ctx)},
                    )
                )
            ]
        return types.GenerateContentResponse(
            candidates=[types.Candidate(content=types.Content(role="model", parts=parts))],
            usage_metadata=types.GenerateContentResponseUsageMetadata(
                prompt_token_count=100, candidates_token_count=50
            ),
        )

    async def aclose(self):
        self.closed = True


@pytest.mark.asyncio
async def test_comparison_uses_existing_adk_bounded_loop_with_mock_model(setup, monkeypatch):
    _, _, _, _, snapshot, request = setup
    index = {
        **snapshot["index"],
        "units": [
            u for u in snapshot["index"]["units"] if u["unit_id"] in (request["unit_a"], request["unit_b"])
        ],
    }
    ctx = AgentContext(
        Settings(),
        "p_mock",
        snapshot["snapshot_id"],
        snapshot["sources"],
        index,
        lambda *_: None,
        lambda: None,
        lambda _: None,
        base={"analysis_id": "analysis_mock"},
        selection={"comparison": request},
    )
    client = ComparisonClient(ctx)
    monkeypatch.setattr("code_groove.agent.create_model_client", lambda _: client)
    result = await run_agent(ctx)
    assert isinstance(result, ComparisonAnswerCandidate)
    assert client.closed and ctx.model_count == 2 and ctx.tool_count == 3
    assert "two static TypeScript functions" in client.calls[0]["config"].system_instruction
    assert "interpretation" in json.dumps(client.calls[0]["config"].tools[0].model_dump())
    assert len(ctx.evidence) == 2

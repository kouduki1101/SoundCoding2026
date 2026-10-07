import asyncio
import time

import pytest
from code_groove.agent import execute_tool
from code_groove.app import create_app
from code_groove.errors import GrooveError
from code_groove.incremental import PROMPT_VERSION
from code_groove.repository import follow_chunk, plan_repository, repository_status, select_chunk
from code_groove.schemas import Evidence, Span
from code_groove.settings import Settings
from code_groove.source import build_index, sanitize
from code_groove.validation import covers
from fastapi.testclient import TestClient


def test_static_ownership_methods_and_dependency_invalidation():
    sources = {
        "src/flow.ts": "import { policy } from './policy';\nexport function run() { return [1].map(x => policy(x)); }",
        "src/policy.ts": "export function policy(x: number) { return x; }",
        "unrelated/other.ts": "export function other() { return 0; }",
        "service.py": "raise RuntimeError('must never execute')\nclass Service:\n    def start(self):\n        return self.finish()\n    async def finish(self):\n        return 1\n",
    }
    index = build_index("snapshot_full", sources, repository=True)
    assert {u["label"] for u in index["units"]} >= {"Service.start", "Service.finish"}
    assert any(r["name"] == "self.finish" and r["resolved"] for r in index["relations"])
    plan = plan_repository(index, sources)
    assert plan["implementation_units"] == len(index["units"]) - 1
    assert sum(c["symbol_count"] for c in plan["chunks"]) == len(index["units"])
    changed = {**sources, "src/policy.ts": "export function policy(x: number) { return x + 1; }"}
    new_plan = plan_repository(build_index("snapshot_new", changed, repository=True), changed)
    old = {c["label"]: c["fingerprint"] for c in plan["chunks"]}
    new = {c["label"]: c["fingerprint"] for c in new_plan["chunks"]}
    assert old["src"] != new["src"] and old["unrelated"] == new["unrelated"]


def test_long_unit_evidence_must_cover_every_line_without_gaps():
    span = Span(file_id="file_long", path="long.py", start_line=1, end_line=320)

    def proof(start, end):
        return Evidence(
            evidence_id=f"ev_{start}",
            snapshot_id="snap_long",
            span=span.model_copy(update={"start_line": start, "end_line": end}),
            projection_sha256="a" * 64,
            source_kind="code",
            observation="bounded read",
            created_by_tool_event_id="tool_test",
        )

    assert covers([proof(1, 160), proof(161, 320)], span, True)
    assert not covers([proof(1, 160), proof(162, 320)], span, True)
    assert not covers([proof(1, 160)], span, True)
    source = 'password = request.get("password")\ndef receive(password: str):\n    return password\n'
    assert sanitize(source) == source
    assert "literal-secret" not in sanitize('password = "literal-secret"\n')


def test_accepted_edit_follows_original_owners_in_a_file_with_multiple_partitions():
    source = "\n".join(f"def policy{i}():\n    return {i}\n" for i in range(40))
    sources = {"policy.py": source}
    old = plan_repository(build_index("snap_before", sources, repository=True), sources)
    changed = {"policy.py": source.replace("return 39", "value = 39\n    return value")}
    new = plan_repository(build_index("snap_after", changed, repository=True), changed)
    original = old["chunks"][-1]
    selected = follow_chunk(old, new, original["chunk_id"])
    assert selected == new["chunks"][-1]["chunk_id"]
    assert selected != new["chunks"][0]["chunk_id"]
    assert follow_chunk(old, new, "missing") is None


@pytest.fixture
def setup(tmp_path):
    app = create_app(
        Settings(local_data_dir=tmp_path, enable_live_analysis=True, model_mode="live"),
        verifier=lambda token: token,
    )
    for user in ("alice", "bob"):
        app.state.store.put("accounts", user, {"enabled": True})
    return TestClient(app), app.state


def test_import_chunk_save_resume_and_cache_are_owned_and_quota_bounded(setup, monkeypatch):
    client, state = setup
    headers = {"Authorization": "Bearer alice", "Idempotency-Key": "import-test-001"}
    sources = {
        f"module{i}/policy.py": f"def policy():\n    return {i}\n\ndef helper():\n    return {i}\n"
        for i in range(2)
    }
    body = {"revision": "a" * 40, "sources": sources, "label": "Mock repository"}
    assert client.post("/api/v1/projects/import", json=body).status_code == 401
    created = client.post("/api/v1/projects/import", json=body, headers=headers).json()["data"]
    assert client.post("/api/v1/projects/import", json=body, headers=headers).json()["data"] == created
    assert "sources" not in state.store.get("runs", created["run_id"])["body"]
    seen = []

    async def model(ctx):
        seen.append(ctx.index["repository_context"]["chunk_id"])
        assert ctx.repository_index and len(ctx.index["units"]) == 2
        unit = ctx.index["units"][0]
        proof = execute_tool(
            ctx,
            "read_code",
            {
                "file_id": unit["primary_span"]["file_id"],
                "start_line": 1,
                "end_line": 5,
                "purpose": "mock Python ownership read",
            },
            "tool_mock",
        )
        ids = proof["evidence_ids"]
        ctx.model_count += 1
        ctx.input_tokens += 120
        ctx.output_tokens += 30
        ctx.save_usage(
            {
                "model_requests": ctx.model_count,
                "input_tokens": ctx.input_tokens,
                "output_tokens": ctx.output_tokens,
                "tool_calls": ctx.tool_count,
            }
        )
        submission = {
            "candidate": {
                "profile": {
                    "title": "Mock repository",
                    "purpose": "mock ownership",
                    "assumptions": [],
                    "unknowns": ["Other partitions not examined"],
                },
                "responsibilities": [
                    {
                        "responsibility_id": "resp_policy",
                        "label": "policy",
                        "definition": "mock decision",
                        "change_reason": "policy",
                        "evidence_ids": ids,
                        "motif_id": "M0",
                        "display_order": 0,
                    }
                ],
                "units": [
                    {
                        "unit_id": unit["unit_id"],
                        "label": unit["label"],
                        "primary_span": unit["primary_span"],
                        "member_symbol_ids": [unit["unit_id"]],
                        "role": "policy",
                        "review_state": "inspected",
                        "boundary_reason": "mock ownership",
                        "evidence_ids": ids,
                    }
                ],
                "events": [
                    {
                        "event_id": "event_policy",
                        "concept_key": "policy",
                        "label": "policy",
                        "meaning": "mock decision",
                        "responsibility_id": "resp_policy",
                        "unit_id": unit["unit_id"],
                        "semantic_order": 0,
                        "kind": "decision",
                        "span": unit["primary_span"],
                        "evidence_ids": ids,
                        "state": "grounded",
                    }
                ],
                "hypotheses": [],
                "review_signals": [],
            }
        }
        other = ctx.index["units"][1]
        submission["candidate"]["units"].append(
            {
                "unit_id": other["unit_id"],
                "label": other["label"],
                "primary_span": other["primary_span"],
                "member_symbol_ids": [other["unit_id"]],
                "role": "policy",
                "review_state": "unresolved" if len(seen) == 1 else "inspected",
                "boundary_reason": "mock uncertainty resolved only on explicit retry",
                "evidence_ids": ids,
            }
        )
        return execute_tool(ctx, "submit_analysis", submission, "submit_mock")

    monkeypatch.setattr("code_groove.jobs.run_agent", model)
    asyncio.run(state.jobs.handle(created["run_id"]))
    first = state.store.get("runs", created["run_id"])
    assert first["status"] == "partial" and first["model_requests"] == 1
    path = f"/api/v1/projects/{created['project_id']}"
    overview = client.get(path + "/repository", headers=headers).json()["data"]
    assert overview["analyzed_chunks"] == 1 and overview["pending_units"] == 2
    assert overview["unresolved_units"] == 1
    assert overview["cross_partition_review"] == "not_run"
    assert client.get(path + "/repository", headers={"Authorization": "Bearer bob"}).status_code == 404
    assert (
        client.post(path + "/chunks", json={"chunk_id": "chunk_missing"}, headers=headers).status_code == 400
    )
    analyzed = next(c for c in overview["chunks"] if c["analysis_id"])
    saved = client.get(path + "/bundle", headers=headers).json()["data"]
    assert saved["map"]["coverage"]["eligible_source_files"] == 2
    assert len(saved["map"]["coverage"]["excluded_paths"]) == 1
    assert saved["partition"]["whole_repository_complete"] is False
    cached = client.post(
        path + "/chunks",
        json={"chunk_id": analyzed["chunk_id"]},
        headers={**headers, "Idempotency-Key": "cached-chunk-001"},
    ).json()["data"]
    asyncio.run(state.jobs.handle(cached["run_id"]))
    assert state.store.get("runs", cached["run_id"])["model_requests"] == 0
    assert len(seen) == 1 and state.store.list("daily_quotas")[0]["analyses"] == 1
    retried = client.post(
        path + "/chunks",
        json={"chunk_id": analyzed["chunk_id"], "retry_partial": True},
        headers={**headers, "Idempotency-Key": "retry-partial-001"},
    ).json()["data"]
    asyncio.run(state.jobs.handle(retried["run_id"]))
    assert len(seen) == 2 and state.store.list("daily_quotas")[0]["analyses"] == 2
    assert client.get(path + "/repository", headers=headers).json()["data"]["unresolved_units"] == 0
    assert (
        client.post(
            path + "/chunks",
            json={"chunk_id": analyzed["chunk_id"], "retry_partial": True},
            headers={**headers, "Idempotency-Key": "retry-resolved-001"},
        ).status_code
        == 400
    )
    # Seven earlier analyses in this UTC day; the final pending range is the tenth.
    state.store.update(
        "daily_quotas",
        state.store.get("runs", retried["run_id"])["quota_id"],
        {"analyses": 9},
    )
    for i, chunk in enumerate(c for c in overview["chunks"] if c["status"] == "pending"):
        created = client.post(
            path + "/chunks",
            json={"chunk_id": chunk["chunk_id"]},
            headers={**headers, "Idempotency-Key": f"next-chunk-{i:03d}"},
        ).json()["data"]
        asyncio.run(state.jobs.handle(created["run_id"]))
    assert len(seen) == 3 and state.store.list("daily_quotas")[0]["analyses"] == 10
    denied_writes = []
    monkeypatch.setattr(state.artifacts, "put", lambda *args: denied_writes.append(args))
    assert (
        client.post(
            "/api/v1/projects/import", json=body, headers={**headers, "Idempotency-Key": "over-quota-001"}
        ).status_code
        == 429
    )
    assert denied_writes == []
    assert state.store.list("global_quotas")[0]["reserved_input"] == 0


def test_import_rejects_path_secrets_oversized_chunked_body_and_untrusted_index(setup):
    client, _ = setup
    headers = {"Authorization": "Bearer alice", "Idempotency-Key": "import-invalid-001"}
    for path in ("../outside.py", ".env", "vendor/code.py", "credential.json"):
        assert (
            client.post(
                "/api/v1/projects/import",
                json={"revision": "a" * 40, "sources": {path: "secret"}},
                headers=headers,
            ).status_code
            == 400
        )
    assert (
        client.post(
            "/api/v1/projects/import",
            json={"revision": "a" * 40, "sources": {"run.py": "def run(): pass"}, "index": {}},
            headers=headers,
        ).status_code
        == 400
    )
    assert (
        client.post(
            "/api/v1/projects/import",
            content=(b"x" * 1048576 for _ in range(9)),
            headers={**headers, "Content-Type": "application/json"},
        ).status_code
        == 413
    )


def test_partition_cache_does_not_use_stale_prompt_or_model():
    sources = {"run.py": "def run():\n    return 1\n"}
    index = build_index("snap_cache", sources, repository=True)
    plan = plan_repository(index, sources)
    chunk = plan["chunks"][0]
    meta = {
        "chunk_id": chunk["chunk_id"],
        "chunk_fingerprint": chunk["fingerprint"],
        "created_at": time.time(),
        "model_id": "model",
        "prompt_version": PROMPT_VERSION,
        "analysis_id": "analysis_cache",
        "inspected_units": 1,
    }
    snapshot = {"snapshot_id": "snap_cache", "repository_plan": plan, "index": index}
    assert repository_status(snapshot, [meta], "model")["analyzed_chunks"] == 1
    assert repository_status(snapshot, [meta], "other-model")["analyzed_chunks"] == 0
    assert repository_status(snapshot, [{**meta, "prompt_version": "old"}], "model")["analyzed_chunks"] == 0
    assert len(select_chunk(snapshot, chunk["chunk_id"])["units"]) == 1
    with pytest.raises(GrooveError):
        select_chunk(snapshot, "chunk_missing")


def test_same_snapshot_old_agent_result_remains_readable_without_becoming_a_current_cache():
    sources = {"run.py": "def run():\n    return 1\n"}
    index = build_index("snap_history", sources, repository=True)
    plan = plan_repository(index, sources)
    meta = {
        "chunk_id": plan["chunks"][0]["chunk_id"],
        "snapshot_id": "snap_history",
        "created_at": time.time(),
        "prompt_version": "old-agent",
        "model_id": "model",
        "analysis_id": "analysis_saved",
        "inspected_units": 1,
        "unresolved_units": 0,
        "chunk_fingerprint": "old-fingerprint",
    }
    snapshot = {"snapshot_id": "snap_history", "repository_plan": plan, "index": index}
    status = repository_status(snapshot, [meta], "model")
    assert status["analyzed_chunks"] == 1
    assert status["chunks"][0]["analysis_id"] == "analysis_saved"
    assert status["chunks"][0]["cache_compatible"] is False
    assert (
        repository_status({**snapshot, "snapshot_id": "different_source"}, [meta], "model")["analyzed_chunks"]
        == 0
    )

import copy
import json
from pathlib import Path

import pytest
from code_groove.app import current_music
from code_groove.repository import plan_repository, select_chunk
from code_groove.schemas import AnalysisCandidate, Evidence, SemanticMap, Span
from code_groove.settings import Settings
from code_groove.source import build_index, run_node
from code_groove.validation import validate_candidate
from pydantic import ValidationError


def test_span_rejects_unsafe_id_and_extra_fields():
    with pytest.raises(ValidationError):
        Span(file_id="../key", path="src/x.ts", start_line=1, end_line=1)
    with pytest.raises(ValidationError):
        Span(file_id="safe", path="src/x.ts", start_line=1, end_line=1, secret="x")


def test_production_refuses_fixture_and_local_storage():
    with pytest.raises(RuntimeError):
        Settings(environment="production").validate_runtime()


def test_tsugiai_recording_has_valid_source_evidence_and_reproducible_music():
    root = Path(__file__).resolve().parents[1]
    bundle = json.loads((root / "fixtures/recorded-live/tsugiai-agents.json").read_text(encoding="utf-8"))
    semantic = SemanticMap.model_validate(bundle["map"])
    index = build_index(semantic.snapshot_id, bundle["sources"], repository=True)
    snapshot = {
        "snapshot_id": semantic.snapshot_id,
        "index": index,
        "sources": bundle["sources"],
        "repository_plan": plan_repository(index, bundle["sources"]),
    }
    candidate = AnalysisCandidate.model_validate(
        {k: bundle["map"][k] for k in AnalysisCandidate.model_fields if k in bundle["map"]}
    )
    validate_candidate(
        candidate,
        select_chunk(snapshot, bundle["partition"]["chunk_id"]),
        [Evidence(**e) for e in bundle["map"]["evidence"]],
    )
    kit = json.loads(
        (root / "apps/web/public/audio/midnight-jazz-v4/manifest.json").read_text(encoding="utf-8")
    )
    assert run_node("groove-core", {"map": bundle["map"], "kit_hash": kit["kit_hash"]}) == bundle["score"]
    assert semantic.origin == "recorded_live"
    assert semantic.coverage.inspected_units == 9
    assert bundle["partition"]["whole_repository_complete"] is False
    assert "Copyright (c) 2025 TSUGIAI" in (root / "fixtures/licenses/tsugiai-LICENSE.txt").read_text(
        encoding="utf-8"
    )


@pytest.mark.parametrize("previous_version", ["groove-chamber-v5", "groove-chamber-v7"])
def test_saved_grammar_upgrade_preserves_examination_and_never_calls_agent(monkeypatch, previous_version):
    bundle = json.loads(
        (Path(__file__).resolve().parents[1] / "fixtures/recorded-live/checkout-flow.json").read_text(
            encoding="utf-8"
        )
    )
    for scene in bundle["score"]["scenes"]:
        for mode in ("repo", "theme"):
            scene[mode]["grammar_version"] = previous_version
    saved = copy.deepcopy(bundle)

    def forbidden(*args, **kwargs):
        raise AssertionError("Score replay must never call the Agent")

    monkeypatch.setattr("code_groove.jobs.run_agent", forbidden)
    upgraded = current_music(bundle)
    assert bundle == saved
    assert {key: value for key, value in upgraded.items() if key != "score"} == {
        key: value for key, value in saved.items() if key != "score"
    }
    assert all(s["repo"]["grammar_version"] == "groove-chamber-v10" for s in upgraded["score"]["scenes"])
    assert [s["repo"]["notes"] for s in upgraded["score"]["scenes"]] == [
        s["repo"]["notes"] for s in saved["score"]["scenes"]
    ]
    assert current_music(bundle)["score"]["score_hash"] == upgraded["score"]["score_hash"]

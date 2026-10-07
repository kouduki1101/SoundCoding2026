import json
from pathlib import Path

import pytest
from code_groove.errors import GrooveError
from code_groove.schemas import AnalysisCandidate, Evidence, ReviewSignal
from code_groove.validation import validate_candidate

ROOT = Path(__file__).resolve().parents[1]


def case():
    value = json.loads((ROOT / "fixtures/mixed.json").read_text(encoding="utf-8"))["map"]
    candidate = AnalysisCandidate.model_validate(
        {k: value[k] for k in AnalysisCandidate.model_fields if k in value}
    )
    index = {
        "units": [{"unit_id": u["unit_id"], "primary_span": u["primary_span"]} for u in value["units"]],
        "files": [
            {"file_id": u["primary_span"]["file_id"], "path": u["primary_span"]["path"]}
            for u in value["units"]
        ],
        "relations": [],
    }
    return candidate, index, [Evidence(**e) for e in value["evidence"]]


def test_grounded_fixture_and_unknown_evidence_rejection():
    candidate, index, proofs = case()
    validate_candidate(candidate, index, proofs)
    candidate.events[0].evidence_ids = ["invented_evidence"]
    with pytest.raises(GrooveError):
        validate_candidate(candidate, index, proofs)


def test_wrong_owner_and_duplicate_order_rejection():
    candidate, index, proofs = case()
    candidate.events[0].span.start_line = 999
    candidate.events[0].span.end_line = 999
    with pytest.raises(GrooveError):
        validate_candidate(candidate, index, proofs)


def test_audible_signal_cannot_claim_unread_units_or_unrelated_events():
    candidate, index, proofs = case()
    event = candidate.events[0]
    candidate.review_signals = [
        ReviewSignal(
            signal_id="signal_test",
            category="responsibility_mixing",
            verdict="concern",
            label="Multiple judgments",
            explanation="The checked function owns separate changes.",
            alternative="An orchestration boundary was considered.",
            change_scenario="If the documented policy window changes, both decision sites need review.",
            alternative_evidence_ids=[proofs[0].evidence_id],
            unit_ids=[event.unit_id],
            event_ids=[event.event_id],
            evidence_ids=[proofs[0].evidence_id],
        )
    ]
    validate_candidate(candidate, index, proofs)
    candidate.review_signals[0].unit_ids = ["unread_unit"]
    with pytest.raises(GrooveError, match="INVALID_ANALYSIS"):
        validate_candidate(candidate, index, proofs)
    candidate.review_signals[0].unit_ids = [event.unit_id]
    candidate.events[0].state = "unresolved"
    with pytest.raises(GrooveError, match="INVALID_ANALYSIS"):
        validate_candidate(candidate, index, proofs)
    candidate, index, proofs = case()
    candidate.events[1].semantic_order = candidate.events[0].semantic_order
    with pytest.raises(GrooveError):
        validate_candidate(candidate, index, proofs)

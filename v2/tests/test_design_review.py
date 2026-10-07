import copy

import pytest
from code_groove.agent import AgentContext, execute_tool
from code_groove.errors import GrooveError
from code_groove.repository import plan_repository, select_chunk
from code_groove.schemas import AnalysisCandidate, DesignPattern, PatternException, ReviewSignal
from code_groove.settings import Settings
from code_groove.source import build_index
from code_groove.validation import validate_candidate, validate_design_review


def review_context():
    sources = {
        "a/subject.ts": "import { peer } from '../b/reference';\nexport function subject(x: number) { return peer(x) + 1; }",
        "b/reference.ts": "import { policy } from '../c/second';\nexport function peer(x: number) { return policy(x); }",
        "c/second.ts": "export function policy(x: number) { return x; }",
    }
    full = build_index("snap_design", sources, repository=True)
    snapshot = {"index": full, "sources": sources, "repository_plan": plan_repository(full, sources)}
    index = select_chunk(snapshot, snapshot["repository_plan"]["chunks"][0]["chunk_id"])
    ctx = AgentContext(
        Settings(),
        "p_design",
        "snap_design",
        sources,
        index,
        lambda *_: None,
        lambda: None,
        lambda _: None,
        repository_index=full,
    )
    for file in full["files"]:
        execute_tool(
            ctx,
            "read_code",
            {
                "file_id": file["file_id"],
                "start_line": 1,
                "end_line": file["lines"],
                "purpose": "Read peer contracts and intentional boundaries",
            },
            "read_design",
        )
    subject = index["units"][0]
    peers = [u for u in full["units"] if u["unit_id"] != subject["unit_id"]]
    proofs = {e.span.path: e.evidence_id for e in ctx.evidence}
    pattern = DesignPattern(
        pattern_id="pattern_policy",
        label="委譲の境界",
        kind="layer_boundary",
        description="調整関数から計算を委譲する",
        scope_note="読んだ2実装だけの観察。全域は未判定。",
        peer_unit_ids=[u["unit_id"] for u in peers],
        evidence_ids=[proofs[u["primary_span"]["path"]] for u in peers],
    )
    signal = ReviewSignal(
        signal_id="signal_difference",
        category="change_coupling",
        verdict="concern",
        label="委譲先と呼出元の計算",
        explanation="変更理由の共有を確認する候補",
        alternative="契約が異なる可能性を確認した",
        change_scenario="仮に委譲先の返値の契約が変わると両実装を確認する。",
        alternative_evidence_ids=pattern.evidence_ids,
        counter_explanation="Mock: distinct contracts were checked against both peer reads",
        counter_status="rejected",
        unit_ids=[subject["unit_id"]],
        event_ids=["event_subject"],
        evidence_ids=list(proofs.values()),
        comparison={
            "pattern_id": pattern.pattern_id,
                "reference_unit_id": peers[0]["unit_id"],
                "reference_span": peers[0]["primary_span"],
            "reference_evidence_ids": [pattern.evidence_ids[0]],
            "observed_difference": "呼出元にも補正がある",
        },
    )
    candidate = AnalysisCandidate(
        profile={"title": "Mock comparison", "purpose": "bounded review", "assumptions": [], "unknowns": []},
        responsibilities=[
            {
                "responsibility_id": "resp_policy",
                "label": "policy",
                "definition": "policy decision",
                "change_reason": "policy contract",
                "evidence_ids": list(proofs.values()),
                "motif_id": "M0",
                "display_order": 0,
            }
        ],
        units=[
            {
                **{k: subject[k] for k in ("unit_id", "label", "primary_span")},
                "member_symbol_ids": [],
                "role": "policy",
                "review_state": "inspected",
                "boundary_reason": "read boundary",
                "evidence_ids": [proofs[subject["primary_span"]["path"]]],
            }
        ],
        events=[
            {
                "event_id": "event_subject",
                "concept_key": "policy",
                "label": "補正",
                "meaning": "委譲した計算に補正する",
                "responsibility_id": "resp_policy",
                "unit_id": subject["unit_id"],
                "semantic_order": 0,
                "kind": "calculation",
                "span": subject["primary_span"],
                "evidence_ids": [proofs[subject["primary_span"]["path"]]],
                "state": "grounded",
            }
        ],
        hypotheses=[],
        design_patterns=[pattern],
        review_signals=[signal],
    )
    return ctx, candidate, peers


def test_repository_exploration_follows_multiple_hops_beyond_classification_scope():
    ctx, candidate, peers = review_context()
    listed = execute_tool(
        ctx,
        "list_units",
        {
            "scope": "repository",
            "label_query": "PEER",
            "limit": 1,
            "purpose": "Find corresponding implementation",
        },
        "list_peers",
    )
    assert listed["total_matches"] == 1 and listed["units"][0]["in_current_partition"] is False
    relations = execute_tool(
        ctx,
        "inspect_relations",
        {"unit_id": peers[0]["unit_id"], "direction": "callees", "purpose": "Follow the outside peer"},
        "follow_peer",
    )
    assert relations["scope"] == "repository"
    assert any(r["callee"] == peers[1]["unit_id"] and r["resolved"] for r in relations["relations"])
    validate_candidate(candidate, ctx.index, ctx.evidence, ctx.repository_index)
    # Reading external peers never expands classification or marks their partitions complete.
    assert len(candidate.units) == len(ctx.index["units"]) == 1


@pytest.mark.parametrize(
    "invalid",
    [
        "unread_peer",
        "self_comparison",
        "invented_pattern",
        "wrong_reference_proof",
        "wrong_reference_span",
        "human_without_question",
        "exception_as_concern",
    ],
)
def test_comparison_rejects_unsupported_outlier_claims(invalid):
    ctx, candidate, _ = review_context()
    signal, pattern = candidate.review_signals[0], candidate.design_patterns[0]
    if invalid == "unread_peer":
        pattern.evidence_ids.pop()
    elif invalid == "self_comparison":
        signal.comparison.reference_unit_id = signal.unit_ids[0]
    elif invalid == "invented_pattern":
        signal.comparison.pattern_id = "invented_pattern"
    elif invalid == "wrong_reference_proof":
        signal.comparison.reference_evidence_ids = [pattern.evidence_ids[-1]]
    elif invalid == "wrong_reference_span":
        signal.comparison.reference_span.start_line += 1
    elif invalid == "human_without_question":
        signal.human_review_required = True
        signal.verdict = "inconclusive"
    else:
        pattern.exceptions = [
            PatternException(
                unit_id=signal.unit_ids[0], reason="distinct contract", evidence_ids=signal.evidence_ids
            )
        ]
        pattern = DesignPattern.model_validate(pattern.model_dump())
        candidate.design_patterns = [pattern]
    with pytest.raises(GrooveError, match="INVALID_ANALYSIS"):
        validate_candidate(candidate, ctx.index, ctx.evidence, ctx.repository_index)


def test_majority_is_descriptive_and_human_uncertainty_has_a_named_question():
    ctx, candidate, _ = review_context()
    signal = candidate.review_signals[0]
    signal.verdict = "inconclusive"
    signal.human_review_required = True
    signal.human_review_reason = "返値の補正は別の契約として意図されていますか？"
    validate_candidate(candidate, ctx.index, ctx.evidence, ctx.repository_index)
    risk = copy.deepcopy(signal)
    risk.signal_id = "risk_quality"
    risk.category = "implementation_risk"
    risk.review_axis = "quality"
    risk.comparison = None
    risk.verdict = "concern"
    risk.human_review_required = False
    risk.human_review_reason = ""
    risk.event_ids = []
    risk.change_scenario = ""
    risk.alternative_evidence_ids = []
    risk.counter_status = "not_checked"
    risk.counter_explanation = ""
    candidate.review_signals.append(risk)
    validate_candidate(candidate, ctx.index, ctx.evidence, ctx.repository_index)


def test_nested_symbols_do_not_fake_two_independent_pattern_examples():
    ctx, _, peers = review_context()
    index = copy.deepcopy(ctx.repository_index)
    nested = copy.deepcopy(peers[0])
    nested["unit_id"] = "unit_nested"
    index["units"].append(nested)
    pattern = DesignPattern(
        pattern_id="pattern_nested",
        label="invalid sample",
        kind="responsibility",
        description="nested",
        scope_note="not independent",
        peer_unit_ids=[peers[0]["unit_id"], nested["unit_id"]],
        evidence_ids=[e.evidence_id for e in ctx.evidence],
    )
    with pytest.raises(GrooveError, match="INVALID_ANALYSIS"):
        validate_design_review([pattern], [], index, ctx.evidence)

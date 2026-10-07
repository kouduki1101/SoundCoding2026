from typing import Any

from code_groove.errors import GrooveError
from code_groove.schemas import (
    ComparisonAnswerCandidate,
    ComparisonInvestigationRequest,
    Evidence,
    StructureComparison,
    StructurePlaybackPlan,
)
from code_groove.source import run_node


def structure_data(
    snapshot: dict, unit_a: str | None = None, unit_b: str | None = None, markers: bool = False
) -> dict:
    if bool(unit_a) != bool(unit_b) or unit_a and unit_a == unit_b:
        raise GrooveError("INVALID_SELECTION", "同じスナップショットの異なる二関数を選んでください。")
    payload = {"snapshot_id": snapshot["snapshot_id"], "sources": snapshot["sources"]}
    if unit_a:
        payload.update(unit_a=unit_a, unit_b=unit_b, markers=markers)
    try:
        result = run_node("structure", payload)
    except GrooveError as exc:
        raise GrooveError("INVALID_SELECTION", "構文抽出できるTypeScript関数を選んでください。") from exc
    if unit_a:
        StructureComparison.model_validate(result["comparison"])
        StructurePlaybackPlan.model_validate(result["playback"])
    return result


def validate_comparison_request(snapshot: dict, request: ComparisonInvestigationRequest) -> dict:
    if snapshot["snapshot_id"] != request.snapshot_id:
        raise GrooveError("STALE_SNAPSHOT", "記録と同じコード版を選んでください。", 409)
    data = structure_data(snapshot, request.unit_a, request.unit_b)
    comparison = data["comparison"]
    if (
        comparison["comparison_id"] != request.comparison_id
        or comparison["a"]["source_hash"] != request.source_hash_a
        or comparison["b"]["source_hash"] != request.source_hash_b
        or request.end_row > len(comparison["rows"])
        or request.start_row >= request.end_row
        or any(comparison[side]["status"] in ("parse_failed", "out_of_scope") for side in ("a", "b"))
    ):
        raise GrooveError("INVALID_SELECTION", "抽出済みの比較範囲とコード版を指定してください。")
    return comparison


def validate_comparison_answer(
    candidate: ComparisonAnswerCandidate, evidence: list[Evidence], ctx: Any
) -> None:
    request = ComparisonInvestigationRequest.model_validate(ctx.selection["comparison"])
    selected = {request.unit_a, request.unit_b}
    proofs = {p.evidence_id: p for p in evidence}
    if not candidate.evidence_ids or not set(candidate.evidence_ids) <= proofs.keys():
        raise GrooveError("INVALID_ANALYSIS", "今回の読取根拠が必要です。")
    for identifier in selected:
        unit = next(u for u in ctx.index["units"] if u["unit_id"] == identifier)
        span = unit["primary_span"]
        lines: set[int] = set()
        for proof_id in candidate.evidence_ids:
            proof = proofs[proof_id]
            if proof.snapshot_id != request.snapshot_id:
                raise GrooveError("INVALID_ANALYSIS", "同じスナップショットの読取根拠が必要です。")
            if proof.span.path == span["path"] and proof.source_kind == "code":
                lines.update(range(proof.span.start_line, proof.span.end_line + 1))
        if not set(range(span["start_line"], span["end_line"] + 1)) <= lines:
            raise GrooveError("INVALID_ANALYSIS", "選択した両関数の本体を今回読み直してください。")

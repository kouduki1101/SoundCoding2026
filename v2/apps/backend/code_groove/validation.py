from code_groove.errors import GrooveError
from code_groove.schemas import (
    AnalysisCandidate,
    DesignPattern,
    Evidence,
    InvestigationCandidate,
    ReviewSignal,
    Span,
)


def contains(outer: Span, inner: Span) -> bool:
    return (
        outer.file_id == inner.file_id
        and outer.path == inner.path
        and outer.start_line <= inner.start_line <= inner.end_line <= outer.end_line
    )


def covers(proofs: list[Evidence], span: Span, code_only: bool = False) -> bool:
    ranges = sorted(
        (p.span.start_line, p.span.end_line)
        for p in proofs
        if p.span.file_id == span.file_id
        and p.span.path == span.path
        and (not code_only or p.source_kind == "code")
    )
    cursor = span.start_line
    for start, end in ranges:
        if end < cursor:
            continue
        if start > cursor:
            return False
        cursor = max(cursor, end + 1)
        if cursor > span.end_line:
            return True
    return False


def validate_design_review(
    patterns: list[DesignPattern], signals: list[ReviewSignal], index: dict, evidence: list[Evidence]
) -> None:
    units = {u["unit_id"]: u for u in index["units"]}
    proofs = {e.evidence_id: e for e in evidence}
    by_id = {p.pattern_id: p for p in patterns}
    errors = []
    if len(by_id) != len(patterns):
        errors.append("Duplicate design pattern IDs")
    for pattern in patterns:
        if len(set(pattern.peer_unit_ids)) != len(pattern.peer_unit_ids):
            errors.append("Pattern requires distinct peer implementations")
        if any(e not in proofs for e in pattern.evidence_ids):
            errors.append("Pattern requires actual read evidence")
        peer_spans: list[Span] = []
        for uid in pattern.peer_unit_ids:
            unit = units.get(uid)
            if not unit or not covers(
                [proofs[e] for e in pattern.evidence_ids if e in proofs], Span(**unit["primary_span"]), True
            ):
                errors.append("Pattern peers require covering code reads")
            if unit:
                span = Span(**unit["primary_span"])
                if any(
                    other.file_id == span.file_id
                    and other.start_line <= span.end_line
                    and span.start_line <= other.end_line
                    for other in peer_spans
                ):
                    errors.append("Nested or overlapping symbols are not independent pattern peers")
                peer_spans.append(span)
        exception_ids = [e.unit_id for e in pattern.exceptions]
        if len(set(exception_ids)) != len(exception_ids):
            errors.append("Duplicate pattern exceptions")
        for exception in pattern.exceptions:
            unit = units.get(exception.unit_id)
            if (
                exception.unit_id in pattern.peer_unit_ids
                or any(e not in proofs for e in exception.evidence_ids)
                or not unit
                or not covers(
                    [proofs[e] for e in exception.evidence_ids if e in proofs],
                    Span(**unit["primary_span"]),
                    True,
                )
            ):
                errors.append("Pattern exception requires a separate implementation and covering reads")
    for signal in signals:
        if signal.counter_status != "not_checked" and (
            not signal.counter_explanation
            or not signal.alternative_evidence_ids
            or any(e not in proofs for e in signal.alternative_evidence_ids)
        ):
            errors.append("Checked counter-explanation requires an explicit claim and actual read evidence")
        if signal.counter_status == "undetermined" and signal.verdict == "concern":
            errors.append("An unresolved counter-explanation requires an inconclusive verdict")
        if signal.human_review_required and (
            not signal.human_review_reason or signal.verdict != "inconclusive"
        ):
            errors.append("Human review requires an explicit unanswered question and inconclusive verdict")
        if signal.category == "implementation_risk" and signal.review_axis == "coherence":
            errors.append("Implementation risk must be classified separately from coherence")
        comparison = signal.comparison
        if not comparison:
            continue
        compared_pattern = by_id.get(comparison.pattern_id)
        reference = units.get(comparison.reference_unit_id)
        if (
            signal.review_axis != "coherence"
            or not compared_pattern
            or comparison.reference_unit_id not in compared_pattern.peer_unit_ids
            or comparison.reference_unit_id in signal.unit_ids
            or not reference
            or comparison.reference_span.model_dump() != reference["primary_span"]
            or any(
                e not in proofs or e not in compared_pattern.evidence_ids
                for e in comparison.reference_evidence_ids
            )
            or not covers(
                [proofs[e] for e in comparison.reference_evidence_ids if e in proofs],
                Span(**reference["primary_span"]),
                True,
            )
        ):
            errors.append(
                "Comparison requires a distinct, read peer from its observed design compared_pattern"
            )
        if (
            signal.verdict == "concern"
            and compared_pattern
            and any(exception.unit_id in signal.unit_ids for exception in compared_pattern.exceptions)
        ):
            errors.append("A justified compared_pattern exception cannot also be an unexplained deviation")
    if errors:
        raise GrooveError("INVALID_ANALYSIS", "; ".join(errors[:10]))


def validate_candidate(
    candidate: AnalysisCandidate, index: dict, evidence: list[Evidence], repository_index: dict | None = None
) -> None:
    validate_design_review(
        candidate.design_patterns, candidate.review_signals, repository_index or index, evidence
    )
    known_units = {u["unit_id"]: u for u in index["units"]}
    known_files = {f["file_id"]: f for f in index["files"]}
    proofs = {e.evidence_id: e for e in evidence}
    responsibilities = {r.responsibility_id for r in candidate.responsibilities}
    units = {u.unit_id: u for u in candidate.units}
    errors = []
    for values in (candidate.units, candidate.events, candidate.responsibilities):
        id_key = (
            "unit_id"
            if values is candidate.units
            else "event_id"
            if values is candidate.events
            else "responsibility_id"
        )
        if len({getattr(v, id_key) for v in values}) != len(values):
            errors.append("Duplicate IDs")
    if len({r.motif_id for r in candidate.responsibilities}) != len(candidate.responsibilities):
        errors.append("Duplicate motif IDs")
    orders, spans, members = set(), set(), set()
    for unit in candidate.units:
        expected = known_units.get(unit.unit_id)
        if not expected or unit.primary_span.model_dump() != expected["primary_span"]:
            errors.append(f"Unknown or altered unit {unit.unit_id}")
        for member in unit.member_symbol_ids:
            if member == unit.unit_id:
                continue
            target = known_units.get(member)
            callers = {r["caller"] for r in index["relations"] if r.get("callee") == member}
            if member in members or not target or callers != {unit.unit_id}:
                errors.append("Helper must have one confirmed owner")
            members.add(member)
        if unit.review_state == "inspected" and not covers(
            [proofs[e] for e in unit.evidence_ids if e in proofs], unit.primary_span, True
        ):
            errors.append("Inspected unit requires covering read evidence")
    for obj in [*candidate.responsibilities, *candidate.units, *candidate.events, *candidate.hypotheses]:
        if any(e not in proofs for e in obj.model_dump()["evidence_ids"]):
            errors.append("Unknown evidence ID")
    for responsibility in candidate.responsibilities:
        if not any(proofs[e].source_kind == "code" for e in responsibility.evidence_ids if e in proofs):
            errors.append("Responsibility requires code evidence")
    for event in candidate.events:
        owner_unit = units.get(event.unit_id)
        file = known_files.get(event.span.file_id)
        if (
            event.responsibility_id not in responsibilities
            or not owner_unit
            or not file
            or file["path"] != event.span.path
        ):
            errors.append(f"Dangling reference {event.event_id}")
            continue
        allowed = contains(owner_unit.primary_span, event.span)
        for member in owner_unit.member_symbol_ids:
            if member in known_units:
                allowed = allowed or contains(Span(**known_units[member]["primary_span"]), event.span)
        if not allowed:
            errors.append("Event outside its owner")
        if event.state == "grounded" and owner_unit.review_state != "inspected":
            errors.append("Grounded event requires an inspected owner")
        if event.state == "grounded" and not any(
            e in proofs and proofs[e].source_kind == "code" and contains(proofs[e].span, event.span)
            for e in event.evidence_ids
        ):
            errors.append("Grounded event requires covering read_code evidence")
        key = (event.responsibility_id, event.semantic_order)
        if key in orders:
            errors.append("Duplicate semantic order")
        orders.add(key)
        span_key = (event.span.file_id, event.span.start_line, event.span.end_line, event.concept_key)
        if span_key in spans:
            errors.append("Same code decision counted twice")
        spans.add(span_key)
        if sum(e.unit_id == event.unit_id for e in candidate.events) > 24:
            errors.append("Unit exceeds 24 events")
    for signal in candidate.review_signals:
        if (
            not signal.unit_ids
            or not signal.evidence_ids
            or any(u not in units for u in signal.unit_ids)
            or any(e not in {item.event_id for item in candidate.events} for e in signal.event_ids)
            or any(e not in proofs for e in signal.evidence_ids)
        ):
            errors.append("Review signal requires known units, events and read evidence")
        if not any(e in proofs and proofs[e].source_kind == "code" for e in signal.evidence_ids):
            errors.append("Review signal requires code evidence")
        if signal.verdict == "concern" and signal.review_axis == "coherence" and not signal.event_ids:
            errors.append("Audible concern requires a grounded meaning event")
        if (
            signal.verdict == "concern"
            and signal.review_axis == "coherence"
            and (not signal.change_scenario or not signal.alternative_evidence_ids)
        ):
            errors.append(
                "Audible concern requires a concrete change scenario and checked alternative evidence"
            )
        if any(e not in proofs or e not in signal.evidence_ids for e in signal.alternative_evidence_ids):
            errors.append("Alternative evidence must be an actual read included in the signal")
        for unit_id in signal.unit_ids:
            if unit_id in units and not covers(
                [proofs[e] for e in signal.evidence_ids if e in proofs], units[unit_id].primary_span, True
            ):
                errors.append("Review signal requires evidence covering its selected units")
        if any(
            e.event_id in signal.event_ids and (e.state != "grounded" or e.unit_id not in signal.unit_ids)
            for e in candidate.events
        ):
            errors.append("Review signal events must be grounded in its selected units")
    if len({s.signal_id for s in candidate.review_signals}) != len(candidate.review_signals):
        errors.append("Duplicate review signal IDs")
    if errors:
        raise GrooveError("INVALID_ANALYSIS", "; ".join(errors[:10]))


def validate_investigation(
    candidate: InvestigationCandidate,
    evidence: list[Evidence],
    base: dict,
    repository_index: dict | None = None,
) -> None:
    patterns = {p["pattern_id"]: DesignPattern(**p) for p in base.get("design_patterns", [])}
    patterns.update({p.pattern_id: p for p in candidate.design_patterns})
    if len(patterns) > 8:
        raise GrooveError("INVALID_ANALYSIS", "設計パターンは8件以内です。")
    all_proofs = [Evidence(**e) for e in base["evidence"]] + evidence
    index = repository_index or {"units": base["units"]}
    # A new or revised pattern must be established by this investigation's actual reads.
    validate_design_review(candidate.design_patterns, [], index, evidence)
    validate_design_review(list(patterns.values()), candidate.review_signals, index, all_proofs)
    proofs = {e.evidence_id for e in evidence} | {e["evidence_id"] for e in base["evidence"]}
    fresh = {e.evidence_id for e in evidence}
    if not fresh or not any(e.source_kind == "code" for e in evidence):
        raise GrooveError("INVALID_EVIDENCE", "追加調査には新しいコード読取が必要です。")
    for finding in candidate.findings:
        if not finding.evidence_ids or any(e not in proofs for e in finding.evidence_ids):
            raise GrooveError("INVALID_EVIDENCE", "結論に有効な根拠が必要です。")
    if not any(fresh.intersection(f.evidence_ids) for f in candidate.findings):
        raise GrooveError("INVALID_EVIDENCE", "結論には今回読み直した根拠が必要です。")
    prior_signals = {s["signal_id"]: s for s in base.get("review_signals", [])}
    units = {u["unit_id"]: u for u in base["units"]}
    cited = {e for f in candidate.findings for e in f.evidence_ids} | {
        e for s in candidate.review_signals for e in s.evidence_ids
    }
    if len(set(candidate.replaced_signal_ids)) != len(candidate.replaced_signal_ids):
        raise GrooveError("INVALID_ANALYSIS", "更新元の健診候補IDが重複しています。")
    updated_ids = set(candidate.replaced_signal_ids) | {
        s.signal_id for s in candidate.review_signals if s.signal_id in prior_signals
    }
    for sid in updated_ids:
        original = prior_signals.get(sid)
        if not original:
            raise GrooveError("INVALID_ANALYSIS", "更新元の健診候補が見つかりません。")
        for uid in original["unit_ids"]:
            if not covers(
                [e for e in evidence if e.evidence_id in cited], Span(**units[uid]["primary_span"]), True
            ):
                raise GrooveError(
                    "INVALID_EVIDENCE", "候補の更新には元の対象関数すべての新しい読取根拠が必要です。"
                )
    remaining_ids = (prior_signals.keys() - set(candidate.replaced_signal_ids)) | {
        s.signal_id for s in candidate.review_signals
    }
    if len(remaining_ids) > 12:
        raise GrooveError("INVALID_ANALYSIS", "健診候補は12件以内にまとめ、更新元IDを明示してください。")
    for item in candidate.suggested_reclassification:
        original = next((e for e in base["events"] if e["event_id"] == item.event_id), None)
        if (
            not original
            or original["responsibility_id"] != item.from_responsibility_id
            or any(e not in proofs for e in item.evidence_ids)
        ):
            raise GrooveError("INVALID_ANALYSIS", "再分類対象または根拠が不正です。")
    if candidate.review_signals:
        units = {u["unit_id"]: u for u in base["units"]}
        events = {e["event_id"]: e for e in base["events"]}
        if len({s.signal_id for s in candidate.review_signals}) != len(candidate.review_signals):
            raise GrooveError("INVALID_ANALYSIS", "追加調査の解釈IDが重複しています。")
        for signal in candidate.review_signals:
            if (
                not signal.unit_ids
                or (signal.review_axis == "coherence" and not signal.event_ids)
                or any(u not in units for u in signal.unit_ids)
                or any(e not in events for e in signal.event_ids)
                or any(e not in proofs for e in signal.evidence_ids)
                or any(e not in signal.evidence_ids for e in signal.alternative_evidence_ids)
                or (
                    signal.verdict == "concern"
                    and signal.review_axis == "coherence"
                    and (not signal.change_scenario or not signal.alternative_evidence_ids)
                )
            ):
                raise GrooveError(
                    "INVALID_ANALYSIS", "追加解釈には既存の意味イベントと確認した代案が必要です。"
                )
            for uid in signal.unit_ids:
                if not covers(
                    [e for e in evidence if e.evidence_id in signal.evidence_ids],
                    Span(**units[uid]["primary_span"]),
                    True,
                ):
                    raise GrooveError("INVALID_EVIDENCE", "追加解釈の対象関数を今回読み直してください。")
            if any(
                events[e]["unit_id"] not in signal.unit_ids or events[e]["state"] != "grounded"
                for e in signal.event_ids
            ):
                raise GrooveError("INVALID_ANALYSIS", "追加解釈のイベントと対象関数が一致しません。")

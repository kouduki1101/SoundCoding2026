"""Explicit, bounded cross-partition scope. Never merge local role IDs mechanically."""

from code_groove.errors import GrooveError
from code_groove.repository import digest, select_chunk


def reconciliation_scope(snapshot: dict, chunk_ids: list[str], unit_ids: list[str]) -> tuple[dict, dict]:
    plan = snapshot.get("repository_plan", {})
    chunks = {c["chunk_id"]: c for c in plan.get("chunks", [])}
    if (
        not 2 <= len(chunk_ids) <= 4
        or len(set(chunk_ids)) != len(chunk_ids)
        or any(cid not in chunks for cid in chunk_ids)
        or not 2 <= len(unit_ids) <= 32
        or len(set(unit_ids)) != len(unit_ids)
    ):
        raise GrooveError("INVALID_SELECTION", "2–4範囲から、重複のない2–32実装を選んでください。")
    selected = set(unit_ids)
    allowed = {uid for cid in chunk_ids for uid in chunks[cid]["unit_ids"]}
    if not selected <= allowed or any(
        not selected.intersection(chunks[cid]["unit_ids"]) for cid in chunk_ids
    ):
        raise GrooveError("INVALID_SELECTION", "選択した各範囲から実在する実装を指定してください。")
    scopes = [select_chunk(snapshot, cid) for cid in chunk_ids]
    units = [u for s in scopes for u in s["units"] if u["unit_id"] in selected]
    paths = {u["primary_span"]["path"] for u in units}
    fingerprint = digest(
        {"chunks": [chunks[cid]["fingerprint"] for cid in sorted(chunk_ids)], "units": sorted(unit_ids)}
    )
    partition = {
        "chunk_id": f"integration_{fingerprint[:20]}",
        "fingerprint": fingerprint,
        "paths": sorted(paths),
        "integration_chunk_ids": chunk_ids,
        "unit_ids": unit_ids,
    }
    return {
        "files": [f for f in snapshot["index"]["files"] if f["path"] in paths],
        "units": units,
        "relations": [r for r in plan["relations"] if r["caller"] in selected or r["callee"] in selected],
        "repository_context": {
            "chunk_id": partition["chunk_id"],
            "partition_count": len(plan["chunks"]),
            "integration_chunk_ids": chunk_ids,
            "selected_owners": len(units),
            "unselected_owners": plan["implementation_units"] - len(units),
        },
        "scope_note": "選択した複数範囲の実装を新しい根拠で統合調査。選択外・全体の健全性は未判定。",
    }, partition


def follow_reconciliation(previous: dict, current: dict, metadata: dict) -> tuple[list[str], list[str]]:
    """After approved edits, follow exact owner names; never replace a lost owner silently."""
    selected = set(metadata["integration_unit_ids"])
    owners = previous["repository_plan"]["owners"]
    signatures = [(u["primary_span"]["path"], u["label"]) for u in owners if u["unit_id"] in selected]
    if len(signatures) != len(selected):
        raise GrooveError("INVALID_SELECTION", "元の統合範囲を確認できません。実装を選び直してください。")
    unit_ids = []
    for path, label in signatures:
        matches = [
            u["unit_id"]
            for u in current["repository_plan"]["owners"]
            if u["primary_span"]["path"] == path and u["label"] == label
        ]
        if len(matches) != 1:
            raise GrooveError(
                "INVALID_SELECTION", "承認後の所有元が変わりました。統合範囲を選び直してください。"
            )
        unit_ids += matches
    chunk_ids = [
        c["chunk_id"]
        for c in current["repository_plan"]["chunks"]
        if set(c["unit_ids"]).intersection(unit_ids)
    ]
    reconciliation_scope(current, chunk_ids, unit_ids)
    return chunk_ids, unit_ids

import copy
import json
from pathlib import Path

from code_groove.incremental import INDEX_VERSION, PROMPT_VERSION, compatible, reuse_unchanged
from code_groove.source import build_index


def setup_case():
    root = Path(__file__).resolve().parents[1]
    bundle = json.loads((root / "fixtures/recorded-live/returns-after.json").read_text(encoding="utf-8"))
    previous = {
        "sources": bundle["sources"],
        "snapshot_id": bundle["map"]["snapshot_id"],
        "index": build_index(bundle["map"]["snapshot_id"], bundle["sources"]),
        "index_version": INDEX_VERSION,
    }
    return bundle["map"], previous


def test_changed_policy_invalidates_both_callers_but_reuses_receipt():
    base, previous = setup_case()
    sources = {
        **previous["sources"],
        "src/return-policy.ts": previous["sources"]["src/return-policy.ts"].replace(
            "standardDays: 30", "standardDays: 31"
        ),
    }
    current = {
        "sources": sources,
        "snapshot_id": "new_snapshot",
        "index": build_index("new_snapshot", sources),
    }
    cached, proofs, details = reuse_unchanged(base, previous, current)
    assert details["changed_paths"] == ["src/return-policy.ts"]
    assert [u["label"] for u in cached["units"]] == ["renderReturnReceipt"]
    assert details["reused_units"] == 1
    assert all(proof.snapshot_id == "new_snapshot" for proof in proofs)
    assert all(e["unit_id"] == cached["units"][0]["unit_id"] for e in cached["events"])
    assert len(details["impacted_unit_ids"]) == 3


def test_context_change_or_projection_tampering_disables_evidence_reuse():
    base, previous = setup_case()
    sources = {**previous["sources"], "README.md": "Different policy owner."}
    current = {"sources": sources, "snapshot_id": "new", "index": build_index("new", sources)}
    cached, proofs, details = reuse_unchanged(base, previous, current)
    assert not cached["units"] and not proofs and details["context_invalidated"]
    current["sources"] = previous["sources"]
    base = copy.deepcopy(base)
    for proof in base["evidence"]:
        proof["projection_sha256"] = "0" * 64
    _, proofs, _ = reuse_unchanged(base, previous, current)
    assert not proofs


def test_prompt_and_model_are_cache_boundaries():
    assert compatible({"prompt_version": PROMPT_VERSION, "model_id": "model"}, "model")
    assert not compatible({"prompt_version": "older", "model_id": "model"}, "model")
    assert not compatible({"prompt_version": PROMPT_VERSION, "model_id": "older"}, "model")

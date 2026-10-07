import copy
import hashlib

from code_groove.schemas import Evidence

PROMPT_VERSION = "conductor-system-v14-counter-integration"
INDEX_VERSION = "typescript-6-python-3.13-v4-lexical"


def compatible(base: dict, model_id: str) -> bool:
    return base.get("prompt_version") == PROMPT_VERSION and base.get("model_id") == model_id


def reuse_unchanged(base: dict, previous: dict, current: dict) -> tuple[dict, list[Evidence], dict]:
    old_sources, sources = previous["sources"], current["sources"]
    changed = {p for p in old_sources.keys() | sources.keys() if old_sources.get(p) != sources.get(p)}
    indexed = current["index"]
    impacted = {u["unit_id"] for u in indexed["units"] if u["primary_span"]["path"] in changed}
    contextual = any(
        not p.endswith((".ts", ".tsx", ".py"))
        or "/tests/" in f"/{p}"
        or ".test." in p
        or ".spec." in p
        or p.split("/")[-1].startswith("test_")
        for p in changed
    )
    if contextual:
        impacted = {u["unit_id"] for u in indexed["units"]}
    while True:
        expanded = impacted | {r["caller"] for r in indexed["relations"] if r["callee"] in impacted}
        if expanded == impacted:
            break
        impacted = expanded
    by_span = {
        (u["primary_span"]["path"], u["primary_span"]["start_line"], u["primary_span"]["end_line"]): u
        for u in indexed["units"]
    }
    old_impacted = {u["unit_id"] for u in base["units"] if u["primary_span"]["path"] in changed}
    while True:
        expanded = old_impacted | {
            r["caller"] for r in previous["index"]["relations"] if r["callee"] in old_impacted
        }
        if expanded == old_impacted:
            break
        old_impacted = expanded
    for unit in base["units"]:
        if unit["unit_id"] not in old_impacted:
            continue
        span = unit["primary_span"]
        target = by_span.get((span["path"], span["start_line"], span["end_line"]))
        if target:
            impacted.add(target["unit_id"])
    aliases = {}
    for unit in base["units"]:
        span = unit["primary_span"]
        target = by_span.get((span["path"], span["start_line"], span["end_line"]))
        if target and span["path"] not in changed and target["unit_id"] not in impacted:
            aliases[unit["unit_id"]] = target["unit_id"]
    evidence = []
    proof_aliases = {}
    for proof in base["evidence"]:
        span = proof["span"]
        path = span["path"]
        if path not in sources or path in changed or contextual:
            continue
        projection = "\n".join(sources[path].splitlines()[span["start_line"] - 1 : span["end_line"]])
        if hashlib.sha256(projection.encode()).hexdigest() != proof["projection_sha256"]:
            continue
        new = {
            **proof,
            "snapshot_id": current["snapshot_id"],
            "evidence_id": f"cached_{hashlib.sha256(proof['evidence_id'].encode()).hexdigest()[:24]}",
            "created_by_tool_event_id": "cache_verified",
        }
        proof_aliases[proof["evidence_id"]] = new["evidence_id"]
        evidence.append(Evidence(**new))

    def remap(item):
        value = copy.deepcopy(item)
        value["evidence_ids"] = [proof_aliases[e] for e in item["evidence_ids"] if e in proof_aliases]
        if "unit_id" in value:
            value["unit_id"] = aliases[value["unit_id"]]
        if "member_symbol_ids" in value:
            value["member_symbol_ids"] = [aliases[u] for u in value["member_symbol_ids"] if u in aliases]
        return value

    cached = {
        "responsibilities": [remap(r) for r in base["responsibilities"]],
        "units": [remap(u) for u in base["units"] if u["unit_id"] in aliases],
        "events": [
            remap(e)
            for e in base["events"]
            if e["unit_id"] in aliases and all(p in proof_aliases for p in e["evidence_ids"])
        ],
    }
    details = {
        "changed_paths": sorted(changed),
        "impacted_unit_ids": sorted(impacted),
        "reused_units": len(cached["units"]),
        "reused_evidence": len(evidence),
        "context_invalidated": contextual,
        "index_version": INDEX_VERSION,
    }
    return cached, evidence, details

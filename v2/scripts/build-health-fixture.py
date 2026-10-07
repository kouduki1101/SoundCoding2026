"""Build a visibly authored map for the trusted checkout example, without a model."""

import json
from collections import Counter

from code_groove.agent import AgentContext, execute_tool
from code_groove.schemas import SemanticMap
from code_groove.settings import ROOT, Settings
from code_groove.source import build_index, run_node, sample_snapshot
from code_groove.validation import validate_candidate

sha, sources = sample_snapshot("checkout-flow")
snapshot_id = f"snap_{sha[:24]}"
index = build_index(snapshot_id, sources)
ctx = AgentContext(
    Settings(),
    "sample-checkout-flow",
    snapshot_id,
    sources,
    index,
    lambda *_: None,
    lambda: None,
    lambda _: None,
)
proofs = {}
for file in index["files"]:
    if not file["is_source"]:
        continue
    execute_tool(
        ctx,
        "read_code",
        {
            "file_id": file["file_id"],
            "start_line": 1,
            "end_line": len(sources[file["path"]].splitlines()),
            "purpose": "Authored fixture evidence",
        },
        f"read_{len(proofs)}",
    )
    proofs[file["path"]] = ctx.evidence[-1].evidence_id

roles = ["キャンペーン適用", "金額と支払基準", "表示の組み立て", "ポイント付与", "注文の保存"]
units, events, counts = [], [], Counter()
for unit in index["units"]:
    path = unit["primary_span"]["path"]
    name = unit["label"] if "label" in unit else unit["symbol_name"]
    units.append(
        {
            "unit_id": unit["unit_id"],
            "label": name,
            "primary_span": unit["primary_span"],
            "member_symbol_ids": [],
            "role": "other",
            "boundary_reason": "手作業のデモ分類。実モデルによる判断ではありません。",
            "evidence_ids": [proofs[path]],
            "review_state": "inspected",
        }
    )
    source_lines = sources[path].splitlines()
    for line in range(unit["primary_span"]["start_line"], unit["primary_span"]["end_line"] + 1):
        code = source_lines[line - 1]
        r = (
            0
            if any(s in code for s in ("const qualifies", "if (activeCampaign", "campaign.expiresAt >="))
            else 1
            if any(
                s in code for s in ("const savingCents", "discountCents = Math.min", "const appliedSaving")
            )
            else 3
            if "points: Math.floor" in code
            else 4
            if "await store.saveOnce" in code
            else 2
            if any(
                s in code for s in ("return `", "message: `", "lines: [invoiceSummary", "return parts.join")
            )
            else None
        )
        if r is None:
            continue
        events.append(
            {
                "event_id": f"evt_health_{len(events)}",
                "label": roles[r],
                "concept_key": f"role_{r}",
                "meaning": roles[r] + "に関する処理（手作業の分類）",
                "responsibility_id": f"r{r}",
                "unit_id": unit["unit_id"],
                "semantic_order": counts[r],
                "kind": "decision" if r == 0 else "calculation" if r in (1, 3) else "update",
                "span": {**unit["primary_span"], "start_line": line, "end_line": line},
                "evidence_ids": [proofs[path]],
                "state": "grounded",
            }
        )
        counts[r] += 1

semantic = SemanticMap(
    schema_version="1.0",
    analysis_id="analysis_checkout_fixture",
    project_id=ctx.project_id,
    snapshot_id=snapshot_id,
    analysis_depth="overview",
    origin="fixture",
    profile={
        "title": "Checkout / コードの健康診断",
        "purpose": "動く購入機能の全体像を聴き、将来の変更・理解の負担を精密検査する。",
        "assumptions": ["手作業の意味マップ"],
        "unknowns": ["Geminiの実診断ではありません。実解析はログイン後。"],
    },
    responsibilities=[
        {
            "responsibility_id": f"r{r}",
            "label": label,
            "definition": label,
            "change_reason": label + "の契約変更",
            "motif_id": f"M{r}",
            "display_order": r,
            "evidence_ids": [next(e for e in events if e["responsibility_id"] == f"r{r}")["evidence_ids"][0]],
        }
        for r, label in enumerate(roles)
    ],
    units=units,
    events=events,
    hypotheses=[],
    evidence=ctx.evidence,
    coverage={
        "indexed_source_files": sum(f["is_source"] for f in index["files"]),
        "eligible_source_files": sum(f["is_source"] for f in index["files"]),
        "indexed_units": len(units),
        "inspected_units": len(units),
        "unresolved_unit_ids": [],
        "excluded_paths": [],
        "inspected_line_ranges": [e.span.model_dump() for e in ctx.evidence],
    },
    model_id="fixture (no model)",
    prompt_version="fixture-health-v1",
    created_at="2026-10-03T00:00:00Z",
)
validate_candidate(semantic, index, ctx.evidence)
kit = json.loads((ROOT / "apps/web/public/audio/midnight-jazz-v4/manifest.json").read_text())
payload = semantic.model_dump(mode="json")
bundle = {
    "map": payload,
    "score": run_node("groove-core", {"map": payload, "kit_hash": kit["kit_hash"]}),
    "sources": sources,
}
(ROOT / "fixtures/checkout-flow.json").write_text(
    json.dumps(bundle, ensure_ascii=False, indent=2), encoding="utf-8"
)
print(f"Authored fixture: {len(units)} functions / {len(events)} events; zero model calls")

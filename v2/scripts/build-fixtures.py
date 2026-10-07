import hashlib
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SAMPLES = {
    "cohesive": (
        "まとまった返金設計",
        "責務ごとにフレーズがまとまる。",
        [
            (
                "src/refund-policy.ts",
                "isRefundEligible",
                0,
                [
                    ("const withinWindow = daysSincePurchase <= 30;", "購入から30日以内"),
                    ("const refundable = !isFinalSale;", "最終販売品を除外"),
                    ("return withinWindow && refundable && hasReceipt;", "購入証明を確認"),
                ],
            ),
            (
                "src/refund-amount.ts",
                "calculateRefund",
                1,
                [
                    ("const fee = Math.round(price * 0.05);", "手数料を計算"),
                    ("const amount = Math.max(0, price - fee);", "返金額を計算"),
                    ("return Math.min(amount, price);", "上限を購入額に制限"),
                ],
            ),
            (
                "src/notification.ts",
                "buildNotification",
                2,
                [
                    ("const greeting = `Hello, ${customerName}`;", "宛名を決める"),
                    ("const message = `Your refund is ${price} yen.`;", "通知本文を作る"),
                    ("return `${greeting}. ${message}`;", "通知文を組み立てる"),
                ],
            ),
        ],
    ),
    "scattered": (
        "散らばった返金条件",
        "同じ条件が、別の所有単位で演奏される。",
        [
            (
                "src/counter-refund.ts",
                "refundAtCounter",
                0,
                [
                    ("const withinWindow = daysSincePurchase <= 30;", "購入から30日以内"),
                    ("return withinWindow && !isFinalSale && hasReceipt;", "購入証明と商品条件を確認"),
                ],
            ),
            (
                "src/online-refund.ts",
                "refundOnline",
                0,
                [
                    ("const withinWindow = daysSincePurchase <= 30;", "購入から30日以内"),
                    ("return withinWindow && !isFinalSale && hasReceipt;", "購入証明と商品条件を確認"),
                ],
            ),
            (
                "src/refund-amount.ts",
                "calculateRefund",
                1,
                [
                    ("const fee = Math.round(price * 0.05);", "手数料を計算"),
                    ("return Math.max(0, price - fee);", "返金額を計算"),
                ],
            ),
            (
                "src/notification.ts",
                "buildNotification",
                2,
                [
                    ("const greeting = `Hello, ${customerName}`;", "宛名を決める"),
                    ("return `${greeting}. Your refund is ${price} yen.`;", "通知文を組み立てる"),
                ],
            ),
        ],
    ),
    "mixed": (
        "混ざった返金設計",
        "一つの実装に、条件・計算・通知が重なる。",
        [
            (
                "src/refund-service.ts",
                "processRefund",
                -1,
                [
                    ("const withinWindow = daysSincePurchase <= 30;", "購入から30日以内", 0),
                    ("const refundable = !isFinalSale && hasReceipt;", "商品条件と購入証明", 0),
                    ("const eligible = withinWindow && refundable;", "返金可否を決める", 0),
                    ("const fee = Math.round(price * 0.05);", "手数料を計算", 1),
                    ("const amount = eligible ? Math.max(0, price - fee) : 0;", "返金額を計算", 1),
                    ("const greeting = `Hello, ${customerName}`;", "宛名を決める", 2),
                    ("const message = `${greeting}. Your refund is ${amount} yen.`;", "通知本文を作る", 2),
                    ("return { eligible, amount, message };", "返金結果を組み立てる", 2),
                ],
            ),
            (
                "src/refund-preview.ts",
                "previewRefund",
                -1,
                [
                    ("const eligible = daysSincePurchase <= 30 && !isFinalSale;", "購入から30日以内", 0),
                    ("const amount = eligible ? Math.max(0, price - price * 0.05) : 0;", "返金額を計算", 1),
                    ("return `${customerName}: ${amount} yen`;", "通知プレビュー", 2),
                ],
            ),
        ],
    ),
    "justified": (
        "理由のある契約の違い",
        "似た条件でも、法人契約には別の理由がある。",
        [
            (
                "src/consumer-policy.ts",
                "consumerRefund",
                0,
                [("return daysSincePurchase <= 30 && !isFinalSale;", "一般契約は30日以内")],
            ),
            (
                "src/enterprise-policy.ts",
                "enterpriseRefund",
                0,
                [
                    ("const contractedWindow = 90;", "法人契約は90日以内"),
                    ("return daysSincePurchase <= contractedWindow && hasReceipt;", "契約と購入証明を確認"),
                ],
            ),
            (
                "src/refund-amount.ts",
                "calculateRefund",
                1,
                [("return Math.max(0, price - Math.round(price * 0.05));", "返金額を計算")],
            ),
            (
                "src/notification.ts",
                "buildNotification",
                2,
                [("return `${customerName}: ${price} yen refunded`;", "通知文を組み立てる")],
            ),
        ],
    ),
    "orchestrator": (
        "専門処理への委譲",
        "呼び出すだけの調整役は、判断を重複計上しない。",
        [
            (
                "src/refund-policy.ts",
                "isRefundEligible",
                0,
                [("return daysSincePurchase <= 30 && !isFinalSale && hasReceipt;", "購入条件を判定")],
            ),
            (
                "src/refund-amount.ts",
                "calculateRefund",
                1,
                [("return Math.max(0, price - Math.round(price * 0.05));", "返金額を計算")],
            ),
            (
                "src/notification.ts",
                "buildNotification",
                2,
                [("return `${customerName}: ${price} yen refunded`;", "通知文を組み立てる")],
            ),
        ],
    ),
}
labels = ["返金条件", "返金額", "通知内容"]
reasons = [
    "返金可能な契約条件が変わるとき",
    "手数料・返金額の計算規則が変わるとき",
    "顧客への伝え方が変わるとき",
]
kit = json.loads((ROOT / "apps/web/public/audio/midnight-jazz-v4/manifest.json").read_text())
for sample_id, (title, description, definitions) in SAMPLES.items():
    sources, units, events, evidence = {}, [], [], []
    counters = [0, 0, 0]
    for i, (path, name, responsibility, statements) in enumerate(definitions):
        source = (
            f"export function {name}(\n  price: number, daysSincePurchase: number, isFinalSale: boolean,\n  hasReceipt: boolean, customerName: string,\n) {{\n"
            + "\n".join(f"  {s[0]}" for s in statements)
            + "\n}\n"
        )
        sources[path] = source
        file_id, unit_id = f"file_{i}", f"unit_{name}"
        span = {"file_id": file_id, "path": path, "start_line": 1, "end_line": len(source.splitlines())}
        ev_id = f"evidence_{i}"
        evidence.append(
            {
                "evidence_id": ev_id,
                "snapshot_id": f"snapshot_{sample_id}",
                "span": span,
                "projection_sha256": hashlib.sha256(source.encode()).hexdigest(),
                "source_kind": "code",
                "observation": f"{name} の判断・計算の本文（手作業サンプル）",
                "created_by_tool_event_id": f"fixture_{i}",
            }
        )
        units.append(
            {
                "unit_id": unit_id,
                "label": name,
                "primary_span": span,
                "member_symbol_ids": [],
                "role": "policy"
                if responsibility == 0
                else "calculation"
                if responsibility == 1
                else "adapter",
                "review_state": "inspected",
                "boundary_reason": "関数の本文が判断を所有する",
                "evidence_ids": [ev_id],
            }
        )
        for j, statement in enumerate(statements):
            r = responsibility if responsibility >= 0 else statement[2]
            events.append(
                {
                    "event_id": f"event_{i}_{j}",
                    "concept_key": f"r{r}_{statement[1]}",
                    "label": statement[1],
                    "meaning": statement[1],
                    "responsibility_id": f"r{r}",
                    "unit_id": unit_id,
                    "semantic_order": counters[r],
                    "kind": "decision" if r == 0 else "calculation" if r == 1 else "update",
                    "span": {**span, "start_line": j + 5, "end_line": j + 5},
                    "evidence_ids": [ev_id],
                    "state": "grounded",
                }
            )
            counters[r] += 1
    if sample_id == "justified":
        sources["tests/enterprise-policy.test.ts"] = (
            "// Contract: enterprise customers have a 90-day refund window.\nimport { enterpriseRefund } from '../src/enterprise-policy';\n// Boundary examples: 60 days accepted, 91 days rejected.\nexport const examples = [{ days: 60, eligible: true }, { days: 91, eligible: false }];\n"
        )
    if sample_id == "orchestrator":
        sources["src/refund-service.ts"] = (
            "import { isRefundEligible } from './refund-policy';\nimport { calculateRefund } from './refund-amount';\nimport { buildNotification } from './notification';\nexport function processRefund(price: number, days: number, final: boolean, receipt: boolean, name: string) {\n  if (!isRefundEligible(price, days, final, receipt, name)) return null;\n  const amount = calculateRefund(price, days, final, receipt, name);\n  return buildNotification(amount, days, final, receipt, name);\n}\n"
        )
    sources["README.md"] = (
        f"# {title}\n公開サンプルの返金アプリ。返金条件、返金額、通知本文が対象です。\n{description}\n"
    )
    responsibilities = [
        {
            "responsibility_id": f"r{r}",
            "label": labels[r],
            "definition": labels[r] + "を決める独立した判断",
            "change_reason": reasons[r],
            "evidence_ids": [e["evidence_ids"][0] for e in events if e["responsibility_id"] == f"r{r}"][:1],
            "motif_id": f"M{r}",
            "display_order": r,
        }
        for r in range(3)
    ]
    semantic = {
        "schema_version": "1.0",
        "analysis_id": f"analysis_{sample_id}",
        "project_id": f"sample-{sample_id}",
        "snapshot_id": f"snapshot_{sample_id}",
        "origin": "fixture",
        "profile": {
            "title": title,
            "purpose": description,
            "assumptions": ["返金ルールを比較するための小さな手作業サンプル"],
            "unknowns": ["実モデルによる調査は未実施"],
        },
        "responsibilities": responsibilities,
        "units": units,
        "events": events,
        "hypotheses": [],
        "review_signals": [],
        "evidence": evidence,
        "coverage": {
            "indexed_source_files": len(definitions),
            "eligible_source_files": len(definitions),
            "indexed_units": len(units),
            "inspected_units": len(units),
            "unresolved_unit_ids": [],
            "excluded_paths": [],
            "inspected_line_ranges": [e["span"] for e in evidence],
        },
        "model_id": "fixture (no model calls)",
        "prompt_version": "fixture-v1",
        "created_at": "2026-10-02T00:00:00Z",
    }
    result = subprocess.run(
        ["node", str(ROOT / "dist/tools/groove-core.mjs")],
        input=json.dumps({"map": semantic, "kit_hash": kit["kit_hash"]}),
        text=True,
        encoding="utf-8",
        capture_output=True,
        check=True,
    )
    bundle = {"map": semantic, "score": json.loads(result.stdout), "sources": sources, "sample_id": sample_id}
    directory = ROOT / "fixtures/repos" / sample_id
    directory.mkdir(parents=True, exist_ok=True)
    for path, source in sources.items():
        destination = directory / path
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text(source, encoding="utf-8")
    (ROOT / "fixtures" / f"{sample_id}.json").write_text(
        json.dumps(bundle, ensure_ascii=False, indent=2), encoding="utf-8"
    )
print("Five fixture bundles built. Origin: fixture; no model trace or usage.")

import asyncio
import json
import sys
import time
import uuid
from datetime import UTC, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "apps/backend"))
from code_groove.agent import AgentContext, run_agent  # noqa: E402
from code_groove.incremental import PROMPT_VERSION  # noqa: E402
from code_groove.schemas import SemanticMap  # noqa: E402
from code_groove.settings import Settings  # noqa: E402
from code_groove.source import build_index, run_node, sample_snapshot  # noqa: E402


async def main():
    reports = []
    kit = json.loads((ROOT / "apps/web/public/audio/midnight-jazz-v4/manifest.json").read_text())
    for sample_id in sys.argv[1:] or ["scattered", "justified"]:
        started = time.monotonic()
        sha, sources = sample_snapshot(sample_id)
        snapshot_id = f"snap_{sha[:24]}"
        index = build_index(snapshot_id, sources)
        events, usage = [], {}

        def emit(kind, payload, events=events, sample_id=sample_id):
            events.append(
                {
                    "seq": len(events) + 1,
                    "type": kind,
                    "timestamp": datetime.now(UTC).isoformat(),
                    "payload": payload,
                }
            )
            (ROOT / "artifacts" / f"live-{sample_id}-trace.json").write_text(
                json.dumps(events, ensure_ascii=False, indent=2), encoding="utf-8"
            )

        def save(values, usage=usage):
            usage.update(values)

        ctx = AgentContext(
            Settings(model_mode="live", enable_live_analysis=True),
            f"live_{sample_id}",
            snapshot_id,
            sources,
            index,
            emit,
            lambda: None,
            save,
        )
        try:
            candidate = await run_agent(ctx)
            inspected = [u for u in candidate.units if u.review_state == "inspected"]
            semantic = SemanticMap(
                **candidate.model_dump(),
                schema_version="1.0",
                analysis_id=f"analysis_{uuid.uuid4().hex}",
                project_id=ctx.project_id,
                snapshot_id=snapshot_id,
                origin="live",
                evidence=ctx.evidence,
                coverage={
                    "indexed_source_files": sum(f["is_source"] for f in index["files"]),
                    "eligible_source_files": sum(f["is_source"] for f in index["files"]),
                    "indexed_units": len(index["units"]),
                    "inspected_units": len(inspected),
                    "unresolved_unit_ids": [
                        u.unit_id for u in candidate.units if u.review_state != "inspected"
                    ],
                    "excluded_paths": [],
                    "inspected_line_ranges": [e.span.model_dump() for e in ctx.evidence],
                },
                model_id=ctx.settings.gemini_model,
                prompt_version=PROMPT_VERSION,
                created_at=datetime.now(UTC).isoformat(),
            )
            score = run_node(
                "groove-core", {"map": semantic.model_dump(mode="json"), "kit_hash": kit["kit_hash"]}
            )
            bundle = {
                "map": {**semantic.model_dump(mode="json"), "origin": "recorded_live"},
                "score": score,
                "sources": sources,
                "trace": events,
                "usage": usage,
            }
            (ROOT / "artifacts" / f"live-{sample_id}.json").write_text(
                json.dumps(bundle, ensure_ascii=False, indent=2), encoding="utf-8"
            )
            reports.append(
                {
                    "sample": sample_id,
                    "status": "PASS",
                    "duration_seconds": round(time.monotonic() - started, 2),
                    "events": len(candidate.events),
                    "responsibilities": len(candidate.responsibilities),
                    "usage": usage,
                    "tools": [e["payload"]["tool"] for e in events if e["type"] == "tool_completed"],
                }
            )
        except Exception as exc:
            reports.append(
                {
                    "sample": sample_id,
                    "status": "FAIL",
                    "error_type": type(exc).__name__,
                    "error": str(exc),
                    "usage": usage,
                }
            )
            (ROOT / "artifacts" / f"live-{sample_id}-trace.json").write_text(
                json.dumps(events, ensure_ascii=False, indent=2), encoding="utf-8"
            )
        print(json.dumps(reports[-1], ensure_ascii=False))
    previous_path = ROOT / "artifacts/live-agent-cases.json"
    previous = json.loads(previous_path.read_text(encoding="utf-8")) if previous_path.exists() else []
    samples = {report["sample"] for report in reports}
    combined = [report for report in previous if report["sample"] not in samples] + reports
    previous_path.write_text(json.dumps(combined, ensure_ascii=False, indent=2), encoding="utf-8")


asyncio.run(main())

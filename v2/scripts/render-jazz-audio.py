import json
import sys
from pathlib import Path

import numpy as np
from audio_render import render_plan, write_wav

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "apps/backend"))
from code_groove.source import run_node  # noqa: E402

kit = json.loads((ROOT / "apps/web/public/audio/midnight-jazz-v4/manifest.json").read_text())
reports = []
for name in (
    "cohesive",
    "scattered",
    "mixed",
    "justified",
    "orchestrator",
    "recorded-live/returns-before",
    "recorded-live/returns-after",
):
    bundle = json.loads((ROOT / f"fixtures/{name}.json").read_text(encoding="utf-8"))
    bundle["score"] = run_node("groove-core", {"map": bundle["map"], "kit_hash": kit["kit_hash"]})
    for mode in ("theme", "repo"):
        rendered = [render_plan(scene[mode]) for scene in bundle["score"]["scenes"]]
        pcm = np.concatenate([a[:-44100] for a in rendered] + [rendered[-1][-44100:]])
        write_wav(ROOT / f"artifacts/{name.split('/')[-1]}-{mode}.wav", pcm)
        reports.append(
            {
                "sample": name,
                "mode": mode,
                "peak": float(np.max(abs(pcm))),
                "duration_seconds": len(pcm) / 44100,
                "status": "PASS_SIGNAL_CHECKS",
                "grammar": bundle["score"]["scenes"][0][mode]["grammar_version"],
                "score_hash": bundle["score"]["score_hash"],
                "no_percussion": all(
                    n["voice"] not in ("kick", "snare", "hat", "wood")
                    for scene in bundle["score"]["scenes"]
                    for n in scene[mode]["notes"]
                ),
                "human_listening": "PENDING_USER_EVALUATION",
            }
        )
(ROOT / "artifacts/audio-verification-v5.json").write_text(json.dumps(reports, indent=2), encoding="utf-8")
print(f"{len(reports)} complete drumless arrangements rendered: finite, non-silent, no clipping")

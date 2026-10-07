import json
import wave
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
kit = ROOT / "apps/web/public/audio/midnight-jazz-v2"
buffers = {}
for path in kit.glob("*.wav"):
    with wave.open(str(path), "rb") as source:
        buffers[path.stem] = (
            np.frombuffer(source.readframes(source.getnframes()), dtype="<i2").astype(float) / 32768
        )
reports = []
for name in ("cohesive", "scattered", "mixed", "justified", "orchestrator"):
    bundle = json.loads((ROOT / f"fixtures/{name}.json").read_text(encoding="utf-8"))
    for mode in ("theme", "repo"):
        plan = bundle["score"]["scenes"][0][mode]
        pcm = np.zeros((int((plan["total_bars"] * 2.5 + 0.25) * 44100), 2))
        for note in plan["notes"]:
            buffer = buffers[f"{note['voice']}-{note['variant']}"][: int(note["duration_ms"] * 44.1)]
            offset = round(note["tick"] / 768 * 44100)
            panning = np.array([np.sqrt((1 - note["pan"]) / 2), np.sqrt((1 + note["pan"]) / 2)])
            pcm[offset : offset + len(buffer)] += buffer[:, None] * panning * note["velocity"] * 0.45 * 0.3
        peak = float(np.max(abs(pcm)))
        assert np.isfinite(pcm).all() and 0 < peak < 0.95
        destination = ROOT / f"artifacts/{name}-{mode}.wav"
        with wave.open(str(destination), "wb") as output:
            output.setnchannels(2)
            output.setsampwidth(2)
            output.setframerate(44100)
            output.writeframes((pcm * 32767).astype("<i2").tobytes())
        reports.append(
            {
                "sample": name,
                "mode": mode,
                "peak": peak,
                "duration": len(pcm) / 44100,
                "status": "PASS_SIGNAL_CHECKS",
                "listening": "NOT_HUMAN_EVALUATED",
            }
        )
(ROOT / "artifacts/audio-verification.json").write_text(json.dumps(reports, indent=2), encoding="utf-8")
print("10 offline renders verified: non-silent, finite, no clipping. Human listening remains pending.")

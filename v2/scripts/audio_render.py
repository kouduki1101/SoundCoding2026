import json
import wave
from pathlib import Path

import numpy as np

RATE = 44100
ROOT = Path(__file__).resolve().parents[1]


def render_plan(plan: dict, focus_evidence: bool = False) -> np.ndarray:
    directory = ROOT / "apps/web/public/audio" / plan["kit_id"]
    samples = json.loads((directory / "manifest.json").read_text(encoding="utf-8"))["samples"]
    buffers = {}
    pcm = np.zeros((round((plan["total_bars"] * 2.5 + 1) * RATE), 2))
    for note in plan["notes"]:
        if focus_evidence and note["kind"] == "accompaniment":
            continue
        bank = [s for s in samples if s["voice"] == note["voice"]]
        sample = (
            min(bank, key=lambda s: (abs(s["base_midi"] - note["midi"]), s["variant"]))
            if plan["kit_id"] == "midnight-jazz-v4"
            and note["voice"] in ("bass", "piano")
            and note.get("midi") is not None
            else next(s for s in bank if s["variant"] == note["variant"])
        )
        key = f"{sample['voice']}-{sample['variant']}"
        if key not in buffers:
            with wave.open(str(directory / f"{key}.wav")) as source:
                buffers[key] = (
                    np.frombuffer(source.readframes(source.getnframes()), dtype="<i2").astype(float) / 32768
                )
        source = buffers[key]
        base = sample["base_midi"]
        ratio = 2 ** ((note["midi"] - base) / 12) if note.get("midi") is not None else 1
        length = min(round(note["duration_ms"] * RATE / 1000), round(len(source) / ratio))
        buffer = np.interp(np.arange(length) * ratio, np.arange(len(source)), source)
        attack = min(
            round(
                (0.024 if note["voice"] == "bass" else 0.007 if note["voice"] == "piano" else 0.015) * RATE
            ),
            length // 6,
        )
        buffer[:attack] *= np.linspace(0, 1, attack)
        fade = min(
            round((0.16 if note["voice"] == "piano" else 0.12 if note["voice"] == "bass" else 0.09) * RATE),
            length // 3,
        )
        buffer[-fade:] *= np.linspace(1, 0, fade)
        offset = round(note["tick"] / 768 * RATE)
        length = min(length, len(pcm) - offset)
        if length <= 0:
            raise ValueError("Note extends outside score")
        panning = np.array([np.sqrt((1 - note["pan"]) / 2), np.sqrt((1 + note["pan"]) / 2)])
        gain = 0 if note["kind"] == "pulse" else note["velocity"] * 0.45 * 0.3
        pcm[offset : offset + length] += buffer[:length, None] * panning * gain
    assert np.isfinite(pcm).all() and 0 < np.max(abs(pcm)) < 0.95
    return pcm


def write_wav(path: Path, pcm: np.ndarray):
    with wave.open(str(path), "wb") as output:
        output.setnchannels(2)
        output.setsampwidth(2)
        output.setframerate(RATE)
        output.writeframes((pcm * 32767).astype("<i2").tobytes())

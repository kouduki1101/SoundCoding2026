import argparse
import hashlib
import json
import wave
from pathlib import Path

import numpy as np
from scipy.signal import lfilter

ROOT = Path(__file__).resolve().parents[1]
KIT = ROOT / "apps/web/public/audio/paper-studio-v1"
RATE = 44100
SEED = 20261002


def samples(voice, variant):
    lengths = {"kick": 180, "snare": 120, "hat": 45, "wood": 90, "bass": 220}
    t = np.arange(int(RATE * lengths[voice] / 1000)) / RATE
    rng = np.random.default_rng(SEED)
    noise = rng.normal(0, 1, len(t))
    if voice == "kick":
        x = np.sin(2 * np.pi * (50 * t + 100 * 0.025 * (1 - np.exp(-t / 0.025)))) * np.exp(-t * 26)
    elif voice == "snare":
        x = (0.5 * lfilter([1, -1], [1, -0.4], noise) + 0.4 * np.sin(2 * np.pi * 185 * t)) * np.exp(-t * 38)
    elif voice == "hat":
        x = lfilter([1, -1], [1, -0.2], noise) * np.exp(-t * 85)
    elif voice == "wood":
        x = (np.sin(2 * np.pi * 520 * t) + 0.5 * np.sin(2 * np.pi * 830 * t)) * np.exp(-t * 65)
    else:
        x = (np.sin(2 * np.pi * 73.416 * t) + 0.12 * np.sin(2 * np.pi * 220.248 * t)) * np.exp(-t * 13)
    frequency = [500, 700, 950, 1300, 1800, 2500][variant]
    w = 2 * np.pi * frequency / RATE
    alpha = np.sin(w) / (2 * 0.8)
    a = 10 ** (2 / 40)
    x = lfilter(
        [1 + alpha * a, -2 * np.cos(w), 1 - alpha * a], [1 + alpha / a, -2 * np.cos(w), 1 - alpha / a], x
    )
    x -= x.mean()
    fade = min(len(x) // 3, int(RATE * 0.006))
    x[:fade] *= np.linspace(0, 1, fade)
    x[-fade:] *= np.linspace(1, 0, fade)
    x *= 0.55 / max(abs(x))
    return (x * 32767).astype("<i2"), lengths[voice]


parser = argparse.ArgumentParser()
parser.add_argument("--verify", action="store_true")
args = parser.parse_args()
KIT.mkdir(parents=True, exist_ok=True)
entries = []
for voice in ["kick", "snare", "hat", "wood", "bass"]:
    for variant in range(6):
        path = KIT / f"{voice}-{variant}.wav"
        pcm, duration = samples(voice, variant)
        if args.verify:
            with wave.open(str(path), "rb") as wav:
                assert wav.getframerate() == RATE and wav.getnchannels() == 1
                assert wav.readframes(wav.getnframes()) == pcm.tobytes()
        else:
            with wave.open(str(path), "wb") as wav:
                wav.setnchannels(1)
                wav.setsampwidth(2)
                wav.setframerate(RATE)
                wav.writeframes(pcm.tobytes())
        assert pcm[-1] == 0 and np.isfinite(pcm).all() and max(abs(pcm)) < 32767
        entries.append(
            {
                "voice": voice,
                "variant": variant,
                "file": path.name,
                "duration_ms": duration,
                "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
            }
        )
manifest = {
    "kit_id": "paper-studio-v1",
    "seed": SEED,
    "sample_rate": RATE,
    "samples": entries,
    "kit_hash": hashlib.sha256(json.dumps(entries, sort_keys=True).encode()).hexdigest(),
}
if args.verify:
    assert json.loads((KIT / "manifest.json").read_text()) == manifest
else:
    (KIT / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
print(f"Kit {'verified' if args.verify else 'generated'}: 30 authored samples, no clipping")

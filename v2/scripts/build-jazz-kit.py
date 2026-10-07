import argparse
import hashlib
import json
import wave
from pathlib import Path

import numpy as np
from scipy.signal import lfilter

ROOT = Path(__file__).resolve().parents[1]
KIT = ROOT / "apps/web/public/audio/midnight-jazz-v3"
RATE = 44100


def render(voice: str, variant: int) -> np.ndarray:
    duration = {
        "piano": 3.2,
        "vibes": 3.2,
        "bass": 2.0,
        "kick": 0.25,
        "snare": 0.25,
        "hat": 0.18,
        "wood": 0.12,
    }[voice]
    t = np.arange(round(duration * RATE)) / RATE
    noise = np.random.default_rng(20261002 + variant).normal(0, 1, len(t))
    if voice in ("piano", "vibes", "bass"):
        frequency = 65.406391 if voice == "bass" else 261.625565
        decay = 2.6 if voice == "piano" else 1.7 if voice == "vibes" else 3.5
        x = np.sin(2 * np.pi * frequency * t) * np.exp(-decay * t)
        partials = [(2, 0.30), (3, 0.12), (4, 0.045)] if voice != "vibes" else [(3, 0.18), (4, 0.03)]
        for harmonic, strength in partials:
            x += strength * np.sin(2 * np.pi * frequency * harmonic * t) * np.exp(-(decay + harmonic) * t)
        x *= 1 + 0.018 * np.sin(2 * np.pi * (4.5 + variant * 0.1) * t)
    elif voice == "kick":
        x = np.sin(2 * np.pi * (48 * t + 1.2 * (1 - np.exp(-40 * t)))) * np.exp(-24 * t)
    elif voice == "snare":
        x = lfilter([0.025, 0.025], [1, -0.92], noise) * np.exp(-12 * t)
    elif voice == "hat":
        x = lfilter([0.04, -0.04], [1, -0.75], noise) * np.exp(-22 * t)
    else:
        x = np.sin(2 * np.pi * 700 * t) * np.exp(-65 * t)
    x -= x.mean()
    attack = min(round((0.025 if voice in ("piano", "bass") else 0.014) * RATE), len(x) // 4)
    release = min(round(0.05 * RATE), len(x) // 4)
    x[:attack] *= np.linspace(0, 1, attack)
    x[-release:] *= np.linspace(1, 0, release)
    x *= (0.25 if voice in ("snare", "hat", "wood") else 0.48) / np.max(abs(x))
    return (x * 32767).astype("<i2")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--verify", action="store_true")
    args = parser.parse_args()
    KIT.mkdir(parents=True, exist_ok=True)
    entries = []
    for voice in ("piano", "vibes", "bass", "kick", "snare", "hat", "wood"):
        for variant in range(6):
            pcm = render(voice, variant)
            path = KIT / f"{voice}-{variant}.wav"
            if args.verify:
                with wave.open(str(path)) as wav:
                    assert wav.getframerate() == RATE and wav.getnchannels() == 1
                    assert wav.readframes(wav.getnframes()) == pcm.tobytes()
            else:
                with wave.open(str(path), "wb") as wav:
                    wav.setnchannels(1)
                    wav.setsampwidth(2)
                    wav.setframerate(RATE)
                    wav.writeframes(pcm.tobytes())
            assert np.isfinite(pcm).all() and pcm[-1] == 0 and max(abs(pcm)) < 32767
            entries.append(
                {
                    "voice": voice,
                    "variant": variant,
                    "file": path.name,
                    "base_midi": 36 if voice == "bass" else 60,
                    "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                }
            )
    manifest = {
        "kit_id": "midnight-jazz-v3",
        "sample_rate": RATE,
        "samples": entries,
        "kit_hash": hashlib.sha256(json.dumps(entries, sort_keys=True).encode()).hexdigest(),
    }
    target = KIT / "manifest.json"
    if args.verify:
        assert json.loads(target.read_text()) == manifest
    else:
        target.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print("42 deterministic jazz samples verified" if args.verify else "42 jazz samples authored")


if __name__ == "__main__":
    main()

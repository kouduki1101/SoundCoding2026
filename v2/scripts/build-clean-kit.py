"""Build a small self-hosted instrument bank from pinned CC BY 3.0 recordings."""

import argparse
import hashlib
import json
import subprocess
import wave
from pathlib import Path

import numpy as np
from scipy.signal import butter, sosfilt

ROOT = Path(__file__).resolve().parents[1]
KIT = ROOT / "apps/web/public/audio/midnight-jazz-v4"
RATE = 44100


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--verify", action="store_true")
    args = parser.parse_args()
    provenance = json.loads((ROOT / "assets/audio-source/sources.json").read_text(encoding="utf-8"))
    entries = []
    KIT.mkdir(parents=True, exist_ok=True)
    if not args.verify:
        import imageio_ffmpeg

        decoder = imageio_ffmpeg.get_ffmpeg_exe()
    for sample in provenance["samples"]:
        original = ROOT / sample["source"]
        assert hashlib.sha256(original.read_bytes()).hexdigest() == sample["sha256"]
        path = KIT / f"{sample['voice']}-{sample['variant']}.wav"
        if not args.verify:
            raw = subprocess.check_output(
                [
                    decoder,
                    "-v",
                    "error",
                    "-i",
                    str(original),
                    "-f",
                    "f32le",
                    "-ac",
                    "1",
                    "-ar",
                    str(RATE),
                    "pipe:1",
                ]
            )
            x = np.frombuffer(raw, dtype="<f4").astype(float)
            x = x[: round((3.2 if sample["voice"] == "bass" else 5.5) * RATE)]
            x = sosfilt(
                butter(
                    2,
                    [28, 2400 if sample["voice"] == "bass" else 10000],
                    btype="bandpass",
                    fs=RATE,
                    output="sos",
                ),
                x,
            )
            x -= x.mean()
            attack = round((0.016 if sample["voice"] == "bass" else 0.004) * RATE)
            release = round(0.14 * RATE)
            x[:attack] *= np.sin(np.linspace(0, np.pi / 2, attack)) ** 2
            x[-release:] *= np.cos(np.linspace(0, np.pi / 2, release)) ** 2
            x *= 0.42 / max(abs(x))
            with wave.open(str(path), "wb") as out:
                out.setnchannels(1)
                out.setsampwidth(2)
                out.setframerate(RATE)
                out.writeframes((x * 32767).astype("<i2").tobytes())
        entries.append(
            {
                "voice": sample["voice"],
                "variant": sample["variant"],
                "base_midi": sample["base_midi"],
                "file": path.name,
                "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
            }
        )
    legacy = ROOT / "apps/web/public/audio/midnight-jazz-v3"
    for voice in ("vibes", "kick", "snare", "hat", "wood"):
        for variant in range(6):
            path = KIT / f"{voice}-{variant}.wav"
            if not args.verify:
                path.write_bytes((legacy / path.name).read_bytes())
            entries.append(
                {
                    "voice": voice,
                    "variant": variant,
                    "base_midi": 60,
                    "file": path.name,
                    "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                }
            )
    manifest = {
        "kit_id": "midnight-jazz-v4",
        "sample_rate": RATE,
        "samples": entries,
        "kit_hash": hashlib.sha256(json.dumps(entries, sort_keys=True).encode()).hexdigest(),
    }
    report = []
    for entry in entries:
        with wave.open(str(KIT / entry["file"])) as source:
            assert source.getframerate() == RATE and source.getnchannels() == 1
            pcm = np.frombuffer(source.readframes(source.getnframes()), dtype="<i2").astype(float) / 32768
        assert np.isfinite(pcm).all() and pcm[0] == 0 and pcm[-1] == 0 and 0 < max(abs(pcm)) < 0.6
        if entry["voice"] in ("bass", "piano"):
            # The edited recording must enter and leave near silence, not a discontinuity.
            assert max(abs(pcm[:44])) < 0.012 and max(abs(pcm[-44:])) < 0.001
        report.append({"file": entry["file"], "peak": round(float(max(abs(pcm))), 6)})
    target = KIT / "manifest.json"
    if args.verify:
        assert json.loads(target.read_text(encoding="utf-8")) == manifest
    else:
        target.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
        (KIT / "NOTICE.txt").write_text(
            "Recorded bass and piano: tonejs-instruments, edited by Nicholaus P. Brosowsky.\nBass original: Karoryfer; piano original: VSO2.\nhttps://github.com/nbrosowsky/tonejs-instruments\nLicensed CC BY 3.0: https://creativecommons.org/licenses/by/3.0/\nCode Groove edits: mono PCM conversion, filtering, normalization, smooth attack/release, bounded duration.\nVibes and unused percussion: authored by Code Groove (MIT). No percussion is scheduled.\nPinned sources and hashes: assets/audio-source/sources.json in the repository.\n",
            encoding="utf-8",
        )
    print(
        json.dumps(
            {
                "status": "PASS",
                "samples": len(entries),
                "recorded": len(provenance["samples"]),
                "kit_hash": manifest["kit_hash"],
            }
        )
    )


if __name__ == "__main__":
    main()

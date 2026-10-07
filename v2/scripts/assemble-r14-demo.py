"""Compose current UI and fixed-score audio, without models or credentials."""

import hashlib
import json
import subprocess
from pathlib import Path

import imageio_ffmpeg
import numpy as np
from audio_render import RATE, render_plan, write_wav

ROOT = Path(__file__).resolve().parents[1]
CAPTIONS = [
    (
        0,
        20,
        "Code Groove：既存・AI生成コードを引き継ぐ開発者へ。\n責務の配置を聴き、気になった音から根拠のコードへ戻ります。",
    ),
    (
        20,
        32,
        "主デモは店舗とWebの返品教材、5実装の保存済みGemini実解析。\n新しいAI解析ではありません。ログイン・追加AI費用なし。",
    ),
    (32, 46, "固定規則で、同じ責務＋意味キーを同じ音高へ。\n伴奏や繰り返しは品質の判定ではありません。"),
    (
        46,
        60,
        "まず返品期限。店舗とWebの音・コードを選びます。\n音高72は、この保存解釈の同じ意味キーに対応します。",
    ),
    (60, 74, "次は対象商品の判断。双方の根拠行へ戻れます。\nこの音高はAIの解釈を確かめる入口です。"),
    (74, 92, "手数料の判断も同じ音高で対応。\n画面の行番号と保存された読取根拠を確かめます。"),
    (92, 114, "保存された設計案と反証は別表示。\nこの旧解析には反証の確認記録がなく、欠陥とは断定しません。"),
    (
        114,
        134,
        "Tsugiaiは別の実在するAgentコードの保存記録。\n9実装を確認。残り2範囲・Repository全体・実行動作は未検証です。",
    ),
    (
        134,
        161,
        "表示は旧SDKの保存実行記録。現行コードはADKへ移行。\n予算・停止・根拠検証を維持。移行後の実モデル確認は未実施です。",
    ),
    (
        161,
        180,
        "範囲間統合は新規調査の別操作。最大32実装・既存の解析上限内。\n保存再生は再現可能。音が理解を助ける効果は、これから人で検証します。",
    ),
]


def ass_time(seconds):
    return f"0:{int(seconds) // 60:02}:{int(seconds) % 60:02}.{round(seconds % 1 * 100):02}"


def main():
    timing = json.loads((ROOT / "artifacts/demo-r14-timing.json").read_text(encoding="utf-8"))
    assert timing["model_writes"] == 0
    bundle = json.loads((ROOT / "fixtures/recorded-live/returns-before.json").read_text(encoding="utf-8"))
    plan = bundle["score"]["scenes"][0]["repo"]
    assert plan["grammar_version"] == "groove-chamber-v10"
    rendered = render_plan(plan)
    isolated = render_plan({**plan, "notes": [n for n in plan["notes"] if n["kind"] == "data"]})
    pcm = np.zeros((180 * RATE, 2))
    for segment in timing["segments"]:
        start = round(segment["start"] * RATE)
        offset = round(segment["tick"] / 768 * RATE)
        length = min(round(segment["duration"] * RATE), len(rendered) - offset, len(pcm) - start)
        if length > 0:
            material = isolated if segment.get("support_muted") else rendered
            pcm[start : start + length] = material[offset : offset + length]
            fade = min(round(0.02 * RATE), length // 4)
            pcm[start : start + fade] *= np.linspace(0, 1, fade)[:, None]
            pcm[start + length - fade : start + length] *= np.linspace(1, 0, fade)[:, None]
    assert np.isfinite(pcm).all() and 0 < np.max(abs(pcm)) < 0.95
    directory = ROOT / ".local/demo-r14"
    write_wav(directory / "score.wav", pcm)
    captions = """[Script Info]
ScriptType: v4.00+
PlayResX: 1440
PlayResY: 980
[V4+ Styles]
Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding
Style: Default,Yu Gothic,23,&H00FFFFFF,&H000000FF,&H00202636,&H00202636,0,0,0,0,100,100,0,0,1,0,0,2,24,24,12,1
[Events]
Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text
"""
    subtitles = []
    for i, (start, end, caption) in enumerate(CAPTIONS, 1):
        line = caption.replace("\n", r"\N")
        captions += f"Dialogue: 0,{ass_time(start)},{ass_time(end)},Default,,0,0,0,,{line}\n"

        def srt_time(value):
            return f"00:{value // 60:02}:{value % 60:02},000"

        subtitles.append(f"{i}\n{srt_time(start)} --> {srt_time(end)}\n{caption}\n")
    (ROOT / "docs/demo-r14-subtitles.srt").write_text("\n".join(subtitles), encoding="utf-8")
    (directory / "captions.ass").write_text(captions, encoding="utf-8")
    output = ROOT / "artifacts/code-groove-demo-r14.mp4"
    subprocess.run(
        [
            imageio_ffmpeg.get_ffmpeg_exe(),
            "-y",
            "-i",
            ".local/demo-r14/capture.webm",
            "-i",
            ".local/demo-r14/score.wav",
            "-vf",
            "pad=1440:980:0:0:color=0x202636,ass=.local/demo-r14/captions.ass",
            "-map",
            "0:v:0",
            "-map",
            "1:a:0",
            "-t",
            "180",
            "-r",
            "30",
            "-c:v",
            "libx264",
            "-preset",
            "fast",
            "-crf",
            "22",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-b:a",
            "160k",
            "-movflags",
            "+faststart",
            str(output),
        ],
        check=True,
        cwd=ROOT,
        capture_output=True,
    )
    report = {
        "duration_seconds": 180,
        "resolution": "1440x980",
        "grammar": plan["grammar_version"],
        "score_hash": bundle["score"]["score_hash"],
        "new_model_requests": 0,
        "sha256": hashlib.sha256(output.read_bytes()).hexdigest(),
        "pcm_finite": bool(np.isfinite(pcm).all()),
        "pcm_peak": float(np.max(abs(pcm))),
        "human_listening": "not_evaluated",
        "capture": "actual local UI with reconstructed fixed-score audio",
    }
    (ROOT / "artifacts/demo-r14-report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report))


if __name__ == "__main__":
    main()

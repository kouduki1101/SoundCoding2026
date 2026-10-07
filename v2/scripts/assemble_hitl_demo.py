"""Edit a deployed HITL recording and replay saved PCM without model calls."""

import json
import subprocess
from pathlib import Path

import imageio_ffmpeg
import numpy as np
from audio_render import RATE, render_plan, write_wav

ROOT = Path(__file__).resolve().parents[1]


def ass_time(seconds: float) -> str:
    hours, rest = divmod(round(seconds * 100), 360000)
    minutes, rest = divmod(rest, 6000)
    return f"{hours}:{minutes:02}:{rest // 100:02}.{rest % 100:02}"


def srt_time(seconds: float) -> str:
    return "0" + ass_time(seconds).replace(".", ",") + "0"


def main():
    recording = json.loads((ROOT / ".local/deployed-r4-video.json").read_text())
    times = recording["timings"]
    video = Path(recording["video_path"]).resolve()
    before, after = (
        json.loads((ROOT / f".local/deployed-r4-{name}-bundle.json").read_text(encoding="utf-8"))
        for name in ("before", "after")
    )
    ranges = [
        (times["login_complete"] + 0.35, times["requested"], 0),
        (times["requested"], times["proposal_ready"], 0),
        (times["proposal_ready"], times["accepted"], 8),
        (times["accepted"], times["analysis_ready"], 0),
        (times["analysis_ready"], times["after_pause"], 0),
        (times["after_pause"] - 0.1, times["after_pause"], 8),
    ]
    fixed = sum(end - start + hold for i, (start, end, hold) in enumerate(ranges) if i not in (1, 3)) + 20
    waiting = sum(ranges[i][1] - ranges[i][0] for i in (1, 3))
    if fixed >= 180 or waiting <= 0:
        raise ValueError("Unexpected recording timing; review the source before editing")
    factor = min(1, (180 - fixed) / waiting)
    remainder = 180 - fixed - waiting * factor
    filters, segments = [], []
    position = 0.0
    for i, (start, end, hold) in enumerate(ranges):
        speed = factor if i in (1, 3) else 1
        if i == 5:
            hold += remainder
        duration = (end - start) * speed + hold
        filters.append(
            f"[0:v]trim=start={start:.6f}:end={end:.6f},setpts={speed:.9f}*(PTS-STARTPTS),"
            f"fps=30,tpad=stop_mode=clone:stop_duration={hold:.6f},setsar=1[v{i}]"
        )
        segments.append(
            {
                "start": position,
                "duration": duration,
                "source_start": start,
                "source_end": end,
                "speed": speed,
                "hold_seconds": hold,
            }
        )
        position += duration
    filters.append(
        "[1:v]scale=1440:900:force_original_aspect_ratio=decrease,pad=1440:900:(ow-iw)/2:(oh-ih)/2:color=0x202636,setsar=1,fps=30,trim=duration=20,setpts=PTS-STARTPTS[v6]"
    )
    filters.append(
        "".join(f"[v{i}]" for i in range(7))
        + "concat=n=7:v=1:a=0,pad=1440:980:0:0:color=0x202636,subtitles=artifacts/demo-captions.ass[out]"
    )

    pcm = np.zeros((RATE * 180, 2))
    for index, bundle, name, source_offset in [(0, before, "before", 10), (4, after, "after", 0)]:
        segment = segments[index]
        rendered = render_plan(bundle["score"]["scenes"][0]["repo"])
        write_wav(ROOT / f"artifacts/r4-approved-{name}.wav", rendered)
        source_start = max(times[f"{name}_play"], segment["source_start"])
        source_end = min(times[f"{name}_pause"], segment["source_end"])
        start = round((segment["start"] + source_start - segment["source_start"]) * RATE)
        offset = round((source_offset + source_start - times[f"{name}_play"]) * RATE)
        length = min(round((source_end - source_start) * RATE), len(rendered) - offset)
        if length <= 0:
            raise ValueError("Playback range has no audio")
        pcm[start : start + length] += rendered[offset : offset + length]
    if not np.isfinite(pcm).all() or np.max(np.abs(pcm)) >= 0.95:
        raise ValueError("Invalid or clipping demo audio")
    write_wav(ROOT / "artifacts/demo-audio.wav", pcm)

    captions = [
        "[Script Info]",
        "ScriptType: v4.00+",
        "PlayResX: 1440",
        "PlayResY: 980",
        "[V4+ Styles]",
        "Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding",
        "Style: Default,Yu Gothic,22,&H00FFFFFF,&H000000FF,&H00202636,&H00202636,0,0,0,0,100,100,0,0,1,0,0,2,24,24,18,1",
        "[Events]",
        "Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text",
    ]
    texts = [
        "Code Groove：同じ責務の旋律を聴き、音の位置からコード行へ。ドラムは使いません。",
        "本番のGeminiがコードを読み直し、改善案を作成。待機を短縮しています。",
        "生成した差分・理由・確認事項を人がレビュー。閉じるだけでは採用されません。",
        "テストで明示的に採用 → 別スナップショットをGeminiが再診断。待機を短縮しています。",
        "採用後に初めて比較が現れます。同じ責務の旋律を保ち、新しい根拠から応答を再計算。",
        "実際の採用後画面を静止表示。残る懸念も隠さず、音を品質の保証にはしません。",
    ]
    srt = []
    for i, (segment, caption) in enumerate(zip(segments, texts, strict=True), 1):
        start, end = segment["start"], segment["start"] + segment["duration"]
        captions.append(f"Dialogue: 0,{ass_time(start)},{ass_time(end)},Default,,0,0,0,,{caption}")
        srt.append(f"{i}\n{srt_time(start)} --> {srt_time(end)}\n{caption}")
    closing = "Cloud Run + Gemini SDK。承認・所有権・予算を制御し、保存結果の再生にAI費用は不要。"
    captions.append(f"Dialogue: 0,{ass_time(position)},0:03:00.00,Default,,0,0,0,,{closing}")
    srt.append(f"7\n{srt_time(position)} --> 00:03:00,000\n{closing}")
    (ROOT / "artifacts/demo-captions.ass").write_text("\n".join(captions), encoding="utf-8")
    (ROOT / "docs/demo-subtitles.srt").write_text("\n\n".join(srt) + "\n", encoding="utf-8")
    command = [
        imageio_ffmpeg.get_ffmpeg_exe(),
        "-y",
        "-i",
        str(video),
        "-loop",
        "1",
        "-i",
        "artifacts/approval-sequence.png",
        "-i",
        "artifacts/demo-audio.wav",
        "-filter_complex",
        ";".join(filters),
        "-map",
        "[out]",
        "-map",
        "2:a",
        "-c:v",
        "libx264",
        "-preset",
        "fast",
        "-crf",
        "23",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "160k",
        "-t",
        "180",
        "artifacts/code-groove-demo.mp4",
    ]
    subprocess.run(command, cwd=ROOT, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    report = {
        "duration_seconds": 180,
        "recording": "actual deployed Gemini HITL with explicit test approval",
        "login_removed": True,
        "waiting_speed_factor": factor,
        "segments": segments,
        "audio": "same saved score and PCM, reconstructed at actual playback timestamps",
        "new_model_calls_during_edit": 0,
        "youtube_uploaded": False,
    }
    (ROOT / "artifacts/demo-timing.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(
        "Created 180s deployed HITL demo; login removed, waiting shortened, PCM reconstructed, no publication."
    )


if __name__ == "__main__":
    main()

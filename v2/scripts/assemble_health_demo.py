"""Edit actual deployed health workflow; shorten waits only, reconstruct saved PCM."""

import json
import subprocess
from pathlib import Path

import imageio_ffmpeg
import numpy as np
from assemble_hitl_demo import ass_time, srt_time
from audio_render import RATE, render_plan, write_wav

ROOT = Path(__file__).resolve().parents[1]


def main():
    recording = json.loads((ROOT / ".local/deployed-r5-video.json").read_text(encoding="utf-8"))
    times = recording["timings"]
    video_offset = recording.get("video_offset_seconds", 0)
    required = ["requested", "proposal_ready", "accepted", "analysis_ready", "after_pause"]
    if any(k not in times for k in required):
        raise ValueError(
            "The actual workflow did not accept a refactoring; create an observation-only demo instead."
        )
    ranges = [
        (times["login_complete"] + 0.1, times["investigation_requested"], 0),
        (times["investigation_requested"], times["investigation_ready"], 0),
        (times["investigation_ready"], times["requested"], 5),
        (times["requested"], times["proposal_ready"], 0),
        (times["proposal_ready"], times["accepted"], 8),
        (times["accepted"], times["analysis_ready"], 0),
        (times["analysis_ready"], times["after_pause"], 0),
        (times["after_pause"] - 0.1, times["after_pause"], 8),
    ]
    waiting = (1, 3, 5)
    fixed = sum(b - a + h for i, (a, b, h) in enumerate(ranges) if i not in waiting) + 20
    wait_total = sum(ranges[i][1] - ranges[i][0] for i in waiting)
    if fixed >= 180 or wait_total <= 0:
        raise ValueError("Review the source recording timing before editing")
    factor = min(1, (180 - fixed) / wait_total)
    remainder = 180 - fixed - wait_total * factor
    segments, filters, position = [], [], 0.0
    for i, (a, b, hold) in enumerate(ranges):
        speed = factor if i in waiting else 1
        if i == 7:
            hold += remainder
        duration = (b - a) * speed + hold
        filters.append(
            f"[0:v]trim=start={a + video_offset:.6f}:end={b + video_offset:.6f},setpts={speed:.9f}*(PTS-STARTPTS),fps=30,tpad=stop_mode=clone:stop_duration={hold:.6f},setsar=1[v{i}]"
        )
        segments.append(
            {
                "start": position,
                "duration": duration,
                "source_start": a,
                "source_end": b,
                "speed": speed,
                "hold_seconds": hold,
            }
        )
        position += duration
    filters.append(
        "[1:v]scale=1440:900:force_original_aspect_ratio=decrease,pad=1440:900:(ow-iw)/2:(oh-ih)/2:color=0x202636,setsar=1,fps=30,trim=duration=20,setpts=PTS-STARTPTS[v8]"
    )
    filters.append(
        "".join(f"[v{i}]" for i in range(9))
        + "concat=n=9:v=1:a=0,pad=1440:980:0:0:color=0x202636,subtitles=artifacts/demo-captions.ass[out]"
    )
    pcm = np.zeros((RATE * 180, 2))
    passages = [(0, "before"), (2, "focused"), (6, "after")]
    for i, name in passages:
        offset = times[f"{name}_offset_seconds"]
        bundle = json.loads((ROOT / f".local/deployed-r5-{name}-bundle.json").read_text(encoding="utf-8"))
        plans = [scene["repo"] for scene in bundle["score"]["scenes"]]
        whole = {**plans[0], "total_bars": 0, "notes": []}
        for plan in plans:
            whole["notes"].extend(
                {**note, "tick": note["tick"] + whole["total_bars"] * 1920} for note in plan["notes"]
            )
            whole["total_bars"] += plan["total_bars"]
        rendered = render_plan(whole)
        segment = segments[i]
        a, b = (
            max(times[f"{name}_play"], segment["source_start"]),
            min(times[f"{name}_pause"], segment["source_end"]),
        )
        start = round((segment["start"] + a - segment["source_start"]) * RATE)
        source_start = round((offset + a - times[f"{name}_play"]) * RATE)
        length = min(round((b - a) * RATE), len(rendered) - source_start)
        if length <= 0:
            raise ValueError("No actual saved musical passage in the selected range")
        pcm[start : start + length] += rendered[source_start : source_start + length]
    if not np.isfinite(pcm).all() or np.max(np.abs(pcm)) >= 0.95:
        raise ValueError("Nonfinite or clipping PCM")
    write_wav(ROOT / "artifacts/demo-audio.wav", pcm)
    texts = [
        "コードの健康診断：動くコードの責務を聴き、気になった区間を選ぶ。初回の検出は隠しません。",
        "選択から本番Geminiが関連コードを精密検査。正当な境界も調べます。待機のみ短縮。",
        "将来の変更負担・別の説明・根拠を確認。人が演奏への反映を選びます。コードは変わりません。",
        "改善が妥当なら、Geminiに新しい差分案を依頼。自動で直さず、待機のみ短縮。",
        "生成された差分と代償、未実施の確認をレビュー。閉じるだけでは採用されません。",
        "テストで明示的に採用。別スナップショットを独立して再健診。待機のみ短縮。",
        "採用後に初めて聴き比べる。意味が同じ旋律は保持し、変わった配置と残る候補を確認。",
        "実際の採用後画面を静止表示。音は理解の入口であり、正しさや健康の保証ではありません。",
    ]
    if recording.get("resumed_saved_investigation"):
        texts[1] = "完了した本番Gemini精密検査から再開。ここでの検査再実行は0回。保存した根拠・役割を確認。"
        texts[2] = (
            "精密検査で確認した変更負担・正当な境界・M4の再分類を試聴。演奏への反映は済み、コードは未変更。"
        )
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
    subtitles = []
    for i, (segment, caption) in enumerate(zip(segments, texts, strict=True), 1):
        a, b = segment["start"], segment["start"] + segment["duration"]
        captions.append(f"Dialogue: 0,{ass_time(a)},{ass_time(b)},Default,,0,0,0,,{caption}")
        subtitles.append(f"{i}\n{srt_time(a)} --> {srt_time(b)}\n{caption}")
    closing = "Cloud Run + Gemini SDK。全体健診 → 試聴 → 精密検査 → 経過観察か改善。保存再生はAI呼び出し0回。"
    captions.append(f"Dialogue: 0,{ass_time(position)},0:03:00.00,Default,,0,0,0,,{closing}")
    subtitles.append(f"9\n{srt_time(position)} --> 00:03:00,000\n{closing}")
    (ROOT / "artifacts/demo-captions.ass").write_text("\n".join(captions), encoding="utf-8")
    (ROOT / "docs/demo-subtitles.srt").write_text("\n\n".join(subtitles) + "\n", encoding="utf-8")
    subprocess.run(
        [
            imageio_ffmpeg.get_ffmpeg_exe(),
            "-y",
            "-i",
            str((ROOT / recording["video_path"]).resolve()),
            "-loop",
            "1",
            "-i",
            "artifacts/health-sequence.png",
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
            "-movflags",
            "+faststart",
            "artifacts/code-groove-demo.mp4",
        ],
        cwd=ROOT,
        check=True,
        capture_output=True,
    )
    report = {
        "duration_seconds": 180,
        "origin": "actual deployed health browser workflow",
        "model_requests_for_edit": 0,
        "login_omitted": True,
        "video_offset_seconds": video_offset,
        "resumed_saved_investigation": recording.get("resumed_saved_investigation", False),
        "wait_speed_factor": factor,
        "audio": "same saved PCM notes at actual playback timing; no sound speedup",
        "pcm_peak": float(np.max(np.abs(pcm))),
        "segments": segments,
    }
    (ROOT / "artifacts/demo-timing.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report))


if __name__ == "__main__":
    main()

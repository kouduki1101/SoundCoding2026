import { useEffect, useMemo, useState } from 'react';
import { Play, Pause, Square, Repeat2, Volume2 } from 'lucide-react';
import type { ScoreBundle } from '../../../../packages/contracts';
import { useWorkspace } from '../state';
import { engine } from '../audio/engine';
import { playbackPlan } from '../audio/playback';

export function Transport({
  score,
  fileUnits,
  selectedFile,
  partitioned = false,
  onError,
}: {
  score?: ScoreBundle;
  fileUnits?: string[];
  selectedFile?: string;
  partitioned?: boolean;
  onError: (message: string) => void;
}) {
  const ws = useWorkspace();
  const [playing, setPlaying] = useState(false),
    [seconds, setSeconds] = useState(0),
    [loading, setLoading] = useState(false);
  const playbackScene = ws.wholeWork ? 0 : ws.scene;
  const playbackUnits = ws.playbackFile ? fileUnits : undefined;
  const plan = useMemo(
    () => playbackPlan(score, ws.mode, playbackScene, ws.wholeWork, playbackUnits),
    [score, ws.mode, playbackScene, ws.wholeWork, playbackUnits],
  );
  useEffect(() => {
    if (plan) engine.configure(plan);
    else engine.stop();
  }, [plan]);
  useEffect(() => {
    engine.setVolume(ws.volume);
    engine.setLoop(ws.loop);
    engine.setFilters(ws.muted, ws.solo, ws.pulseMuted);
    engine.setInstrumentMutes(ws.instrumentMutes);
    engine.setSupportMuted(ws.focusEvidence);
  }, [ws.volume, ws.loop, ws.muted, ws.solo, ws.pulseMuted, ws.instrumentMutes, ws.focusEvidence]);
  useEffect(() => {
    let frame = 0,
      last = 0;
    const animate = (now: number) => {
      if (now - last > 100) {
        setPlaying(engine.playing);
        setSeconds(engine.tick / 768);
        last = now;
      }
      frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, []);
  async function toggle() {
    if (!plan) return;
    if (engine.playing) engine.pause();
    else {
      setLoading(true);
      ws.set({ following: true });
      try {
        await engine.play();
      } catch {
        onError('音源を読み込めませんでした。再生ボタンで再試行できます。');
      } finally {
        setLoading(false);
      }
    }
  }
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        (e.target as HTMLElement).closest(
          'button,a,input,textarea,select,summary,[contenteditable="true"],.monaco-editor,[role="dialog"]',
        )
      )
        return;
      if (e.code === 'Space') {
        e.preventDefault();
        void toggle();
      } else if (e.code === 'Home') engine.stop();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });
  const clock = (value: number) =>
    `${Math.floor(value / 60)
      .toString()
      .padStart(2, '0')}:${Math.floor(value % 60)
      .toString()
      .padStart(2, '0')}`;
  return (
    <div className="transport">
      <button
        className="play-button"
        data-tour="play"
        aria-label={playing ? 'Pause' : 'Play'}
        disabled={!plan || loading}
        title="Play / Pause · Space"
        onClick={() => void toggle()}
      >
        {playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}
        <span>
          {loading
            ? '読込中'
            : playing
              ? '一時停止'
              : ws.playbackFile
                ? 'ファイルを聴く'
                : ws.wholeWork
                  ? partitioned
                    ? '検査範囲を聴く'
                    : '全体を聴く'
                  : '区間を聴く'}
        </span>
      </button>
      <button
        className="stop-button"
        aria-label="Stop"
        title="最初に戻す · Home"
        onClick={() => engine.stop()}
      >
        <Square size={13} />
      </button>
      <div className="time-display">
        <b>{clock(seconds)}</b>
        <small>/ {clock(plan ? plan.total_bars * 2.5 : 0)}</small>
      </div>
      <select
        className="playback-range"
        aria-label="再生範囲"
        value={ws.playbackFile ? 'file' : 'all'}
        onChange={(e) => {
          engine.stop();
          ws.set({ playbackFile: e.target.value === 'file' ? (selectedFile ?? '') : '', wholeWork: true });
        }}
      >
        <option value="all">{partitioned ? '表示中の検査範囲' : 'リポジトリ全体'}</option>
        <option value="file" disabled={!fileUnits?.length}>
          選択ファイル
          {ws.playbackFile || selectedFile
            ? ` · ${(ws.playbackFile || selectedFile)!.split('/').at(-1)}`
            : ''}
        </option>
      </select>
      <details className="playback-settings">
        <summary>再生設定</summary>
        <div className="settings-popover">
          <div className="volume">
            <Volume2 size={15} />
            <input
              aria-label="音量"
              type="range"
              min="0"
              max="1"
              step=".01"
              value={ws.volume}
              onChange={(e) => ws.set({ volume: Number(e.target.value) })}
            />
          </div>

          <span>聴く範囲</span>
          <button
            aria-pressed={ws.wholeWork}
            onClick={() => ws.set({ wholeWork: !ws.wholeWork, playbackFile: '' })}
          >
            {ws.wholeWork ? (partitioned ? '検査範囲を再生' : '全体を再生') : '選択区間を再生'}
          </button>
          {!ws.wholeWork && (
            <select
              aria-label="再生区間"
              value={ws.scene}
              onChange={(e) => ws.set({ scene: Number(e.target.value) })}
            >
              {score?.scenes.map((scene, i) => (
                <option key={scene.scene_id} value={i}>
                  区間 {i + 1}
                </option>
              ))}
            </select>
          )}
          <button aria-label="Loop" aria-pressed={ws.loop} onClick={() => ws.set({ loop: !ws.loop })}>
            <Repeat2 size={14} />
            繰り返す
          </button>
          <span>伴奏・メロディー</span>
          <button
            aria-pressed={ws.focusEvidence}
            onClick={() => ws.set({ focusEvidence: !ws.focusEvidence })}
          >
            {ws.focusEvidence ? '伴奏を戻す' : '伴奏を消してコードのリズムを聴く'}
          </button>
          <button aria-pressed={ws.showBacking} onClick={() => ws.set({ showBacking: !ws.showBacking })}>
            伴奏トラックを表示
          </button>
          <div className="instrument-settings">
            {[
              ['bass', 'Bass'],
              ['piano', 'Piano'],
              ['vibes', 'Melody'],
            ].map(([voice, label]) => (
              <button
                key={voice}
                aria-pressed={!ws.instrumentMutes.includes(voice)}
                onClick={() =>
                  ws.set({
                    instrumentMutes: ws.instrumentMutes.includes(voice)
                      ? ws.instrumentMutes.filter((v) => v !== voice)
                      : [...ws.instrumentMutes, voice],
                  })
                }
              >
                {label}
              </button>
            ))}
          </div>
          <small>96 BPM · 4/4 · 音はコードから再現可能</small>
          <a href="/audio/midnight-jazz-v4/NOTICE.txt" target="_blank" rel="noreferrer">
            音源・ライセンス
          </a>
        </div>
      </details>
    </div>
  );
}

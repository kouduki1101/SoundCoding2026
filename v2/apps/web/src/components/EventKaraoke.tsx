import { useEffect, useMemo, useState } from 'react';
import type { ScorePlan, ScheduledNote } from '../../../../packages/contracts/ScoreBundle';
import type { Bundle } from '../api';
import { engine } from '../audio/engine';
import { useWorkspace } from '../state';
import { buildEventKaraokeRows } from './eventKaraokeRows';
import '../styles/event-karaoke.css';

const VISIBLE_ROWS = 5;

export function EventKaraoke({
  bundle,
  plan,
  following,
  select,
}: {
  bundle: Bundle;
  plan: ScorePlan;
  following: boolean;
  select: (note: ScheduledNote, seek?: boolean) => void;
}) {
  const eventId = useWorkspace((state) => state.eventId);
  const rows = useMemo(() => buildEventKaraokeRows(bundle, plan), [bundle, plan]);
  const [playback, setPlayback] = useState({ tick: 0, playing: false });

  useEffect(() => {
    let frame = 0;
    let last = 0;
    const update = (now: number) => {
      if (now - last >= 75) {
        const tick = Math.min(plan.total_bars * 1920, engine.tick);
        const playing = engine.playing && engine.getAuditionState() === 'idle';
        setPlayback((previous) =>
          previous.playing !== playing || Math.abs(previous.tick - tick) >= 8 ? { tick, playing } : previous,
        );
        last = now;
      }
      frame = requestAnimationFrame(update);
    };
    frame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frame);
  }, [plan]);

  const playingIndex = rows.findLastIndex((row) => row.startTick <= playback.tick);
  const selectedIndex = rows.reduce(
    (nearest, row, index) =>
      row.eventId === eventId &&
      (nearest < 0 ||
        Math.abs(row.startTick - playback.tick) < Math.abs(rows[nearest].startTick - playback.tick))
        ? index
        : nearest,
    -1,
  );
  const focusIndex =
    following && playback.playing && playingIndex >= 0
      ? playingIndex
      : selectedIndex >= 0
        ? selectedIndex
        : Math.max(0, playingIndex);
  const windowStart = Math.min(Math.max(0, focusIndex - 2), Math.max(0, rows.length - VISIBLE_ROWS));

  return (
    <section className="event-karaoke" aria-label="音と同期するコード行" data-testid="event-karaoke">
      <div className="event-karaoke-heading">
        <strong>コードの歌詞</strong>
        <span>音に結び付いた根拠行 · 行を押すとその音へ</span>
      </div>
      {rows.length ? (
        <div className="event-karaoke-lines">
          {Array.from({ length: VISIBLE_ROWS }, (_, offset) => {
            const index = windowStart + offset;
            const row = rows[index];
            if (!row)
              return <div className="event-karaoke-slot" aria-hidden="true" key={`empty-${offset}`} />;
            const progress =
              !playback.playing || playback.tick <= row.startTick
                ? 0
                : playback.tick >= row.endTick
                  ? 100
                  : ((playback.tick - row.startTick) / (row.endTick - row.startTick)) * 100;
            const isCurrent = playback.playing && index === playingIndex;
            const sourceText = row.sourceLine?.trimStart();
            const repeatedLine =
              index !== focusIndex &&
              rows
                .slice(windowStart, index)
                .some((earlier) => earlier.path === row.path && earlier.line === row.line);
            return (
              <button
                key={row.note.note_id}
                type="button"
                className={`event-karaoke-slot${isCurrent ? ' current' : ''}${index === focusIndex ? ' focus' : ''}`}
                data-event-id={row.eventId}
                data-note-id={row.note.note_id}
                aria-label={`${row.path}:${row.line} ${row.label} の音へ移動`}
                aria-pressed={index === selectedIndex}
                aria-current={isCurrent ? 'true' : undefined}
                title={`${row.path}:${row.line} · ${row.label}`}
                onClick={() => select(row.note)}
              >
                <span className="event-karaoke-location">
                  {row.path.split('/').at(-1)}:{row.line}
                </span>
                <span className="event-karaoke-source">
                  {repeatedLine && sourceText ? (
                    <span className="event-karaoke-repeat">↳ 同じコード行 · {row.label}</span>
                  ) : sourceText ? (
                    <>
                      <code>{sourceText}</code>
                      <code
                        className="event-karaoke-sung"
                        aria-hidden="true"
                        style={{ clipPath: `inset(0 ${100 - progress}% 0 0)` }}
                      >
                        {sourceText}
                      </code>
                    </>
                  ) : (
                    <span className="event-karaoke-unavailable">コード行を表示できません</span>
                  )}
                </span>
                {row.reviewCandidate && <span className="event-karaoke-candidate">要確認</span>}
              </button>
            );
          })}
        </div>
      ) : (
        <p className="event-karaoke-empty">この再生範囲に、根拠コードと結び付いた音はありません。</p>
      )}
    </section>
  );
}

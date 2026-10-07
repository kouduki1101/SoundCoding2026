import { useEffect, useRef, useState } from 'react';
import { Headphones, Play, GitCompareArrows } from 'lucide-react';
import type { ScorePlan, ScheduledNote } from '../../../../packages/contracts/ScoreBundle';
import type { Bundle } from '../api';
import { engine } from '../audio/engine';
import { useWorkspace } from '../state';
import { DemoComparison } from './DemoComparison';
import { ReviewFocus } from './ReviewFocus';
import { focusedExcerpt } from '../audio/excerpts';
import { playbackPlan } from '../audio/playback';
import { useAudition } from '../hooks/useAudition';
import { signalSelection } from '../reviewNavigation';
const motifColors = ['#c7cfff', '#a6ddce', '#aad4ef', '#e4bfde', '#b8debd', '#edc4ae'];
export function Arrangement({
  bundle,
  plan,
  following,
  select,
  compare,
}: {
  bundle: Bundle;
  plan: ScorePlan;
  following: boolean;
  select: (note: ScheduledNote, seek?: boolean) => void;
  compare: () => void;
}) {
  const ws = useWorkspace();
  const auditionState = useAudition();
  const [active, setActive] = useState<ScheduledNote[]>([]),
    [audioError, setAudioError] = useState('');
  const trackHeads = useRef(new Map<string, HTMLDivElement>()),
    trackRows = useRef(new Map<string, HTMLDivElement>()),
    trackContainer = useRef<HTMLDivElement>(null);
  const total = plan.total_bars * 1920;
  const musical = plan.notes.filter((n) => n.kind !== 'pulse' || !ws.pulseMuted);
  function noteColor(note: ScheduledNote) {
    if (!note.event_id) return '#74849c';
    const role = bundle.map.responsibilities.find((r) => r.responsibility_id === note.responsibility_id);
    return motifColors[Number(role?.motif_id.slice(1) ?? 0)];
  }
  const files = [...new Set(bundle.map.units.map((u) => u.primary_span.path))];
  const selectedPath =
    ws.codeSpan?.path ?? bundle.map.units.find((unit) => unit.unit_id === ws.unitId)?.primary_span.path;
  useEffect(() => {
    const container = trackContainer.current;
    if (!container || !selectedPath) return;
    const reveal = () => {
      const row = trackRows.current.get(selectedPath);
      if (!row) return;
      const bounds = row.getBoundingClientRect();
      const viewport = container.getBoundingClientRect();
      if (bounds.top < viewport.top) container.scrollTop += bounds.top - viewport.top;
      else if (bounds.bottom > viewport.bottom) container.scrollTop += bounds.bottom - viewport.bottom;
    };
    reveal();
    const observer = new ResizeObserver(reveal);
    observer.observe(container);
    return () => observer.disconnect();
  }, [selectedPath]);
  useEffect(() => {
    let frame = 0,
      last = 0;
    const animate = (now: number) => {
      const left = `${Math.min(100, (engine.tick / total) * 100)}%`;
      trackHeads.current.forEach((head) => (head.style.left = left));
      if (now - last > 90) {
        const sounding =
          engine.playing && engine.getAuditionState() === 'idle'
            ? musical.filter(
                (n) =>
                  !ws.instrumentMutes.includes(n.voice) &&
                  !(ws.focusEvidence && n.kind === 'accompaniment') &&
                  !(
                    n.responsibility_id &&
                    (ws.muted.includes(n.responsibility_id) ||
                      (ws.solo.length > 0 && !ws.solo.includes(n.responsibility_id)))
                  ) &&
                  n.tick <= engine.tick &&
                  engine.tick < n.tick + n.duration_ms * 0.768,
              )
            : [];
        setActive(sounding);
        const linked =
          sounding.find((n) => n.kind === 'cue') ??
          sounding.find((n) => n.kind === 'data') ??
          sounding.find((n) => n.event_id);
        const selection = useWorkspace.getState();
        if (following && linked && (selection.eventId !== linked.event_id || selection.codeSpan)) {
          select(linked, false);
        }
        last = now;
      }
      frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [plan, following, ws.instrumentMutes, ws.focusEvidence, ws.pulseMuted, ws.muted, ws.solo]);
  async function audition() {
    const eventIds = bundle.map.events
      .filter((item) => item.unit_id === ws.unitId && item.state === 'grounded')
      .map((item) => item.event_id);
    const excerpt = focusedExcerpt(playbackPlan(bundle.score, ws.mode, 0, true) ?? plan, eventIds);
    try {
      setAudioError('');
      await engine.playAudition(excerpt.plan, (note) => {
        if (useWorkspace.getState().following)
          ws.set({ eventId: note.event_id ?? '', codeSpan: null, signalId: ws.signalId });
      });
    } catch {
      setAudioError('音源の読込に失敗しました。');
    }
  }
  const current =
    active.find((n) => n.kind === 'cue') ??
    active.find((n) => n.kind === 'data') ??
    active.find((n) => n.event_id);
  const event = bundle.map.events.find((e) => e.event_id === current?.event_id);
  const supports = [
    { name: 'Bass', voices: ['bass'], detail: '低音の土台' },
    { name: 'Piano', voices: ['piano'], detail: '和音の伴奏' },
  ];
  const groups = [
    ...new Map(
      musical.filter((n) => n.kind === 'cue').map((n) => [`${n.unit_id}:${Math.floor(n.tick / 1920)}`, n]),
    ).values(),
  ];
  const barLabels = Array.from({ length: Math.ceil(plan.total_bars / 4) }, (_, i) => i * 4);
  return (
    <section
      className={`arrangement ${bundle.sample_id === 'recorded-returns-before' ? 'has-comparison-lesson' : ''}`}
      aria-label="ファイルごとのリズム"
    >
      <div className="arrangement-title">
        <span>
          <Headphones size={16} />
          <b>演奏</b>
        </span>
        <ReviewFocus bundle={bundle} plan={plan} />
        <details className="motif-legend workspace-menu">
          <summary>凡例</summary>
          <div>
            <p>
              同じ責務は同じ色・旋律。小さな丸印から保存された説明と根拠を確認できます。反証の確認は欠陥の確定を意味しません。
            </p>
            {bundle.map.responsibilities.map((r) => {
              const note = musical.find(
                (n) => n.kind === 'data' && n.responsibility_id === r.responsibility_id,
              );
              return (
                <button key={r.responsibility_id} disabled={!note} onClick={() => note && select(note)}>
                  <i style={{ background: motifColors[Number(r.motif_id.slice(1))] }} />
                  {r.motif_id} / {r.label}
                </button>
              );
            })}
            <small>低音・和音は共通伴奏です。</small>
          </div>
        </details>
        <div className="arrangement-layout" aria-label="同じ解釈の演奏配置">
          <button
            aria-pressed={ws.mode === 'repo'}
            onClick={() => {
              engine.pause();
              ws.set({ mode: 'repo' });
            }}
          >
            ファイル順
          </button>
          <button
            aria-pressed={ws.mode === 'theme'}
            onClick={() => {
              engine.pause();
              ws.set({ mode: 'theme' });
            }}
          >
            意味で揃える
          </button>
        </div>
        <button
          className="structure-entry"
          aria-label="Agentの説明を二関数で問い直す · 構造を比較して聴く"
          onClick={compare}
        >
          <GitCompareArrows size={14} />
          二関数を比較
        </button>
      </div>
      <div className="arrangement-ruler">
        <span>ファイル</span>
        <div>
          {barLabels.map((bar) => (
            <span key={bar} style={{ left: `${(bar / plan.total_bars) * 100}%` }}>
              {bar + 1}
            </span>
          ))}
        </div>
      </div>
      <DemoComparison
        bundle={bundle}
        plan={plan}
        select={(note) => {
          engine.pause();
          select(note);
        }}
      />
      <div className="arrangement-tracks" ref={trackContainer} data-tour="signal">
        {files.map((file, index) => {
          const phrases = plan.phrases.filter((p) =>
            p.unit_id
              ? bundle.map.units.find((u) => u.unit_id === p.unit_id)?.primary_span.path === file
              : musical.some(
                  (n) =>
                    n.responsibility_id === p.responsibility_id &&
                    bundle.map.units.find((u) => u.unit_id === n.unit_id)?.primary_span.path === file,
                ),
          );
          return (
            <div
              className={`composer-track ${event?.span.path === file ? 'sounding' : ''} ${selectedPath === file ? 'selected-track' : ''}`}
              key={file}
              ref={(element) => {
                if (element) trackRows.current.set(file, element);
                else trackRows.current.delete(file);
              }}
            >
              <div className="composer-track-label">
                <span className="track-number">{String(index + 1).padStart(2, '0')}</span>
                <span>
                  <strong>{file.split('/').at(-1)}</strong>
                  <small>{file.split('/').slice(0, -1).join('/')}</small>
                </span>
                <i
                  className={`activity-led ${active.some((n) => bundle.map.units.find((u) => u.unit_id === n.unit_id)?.primary_span.path === file) ? 'on' : ''}`}
                />
              </div>
              <div
                className="composer-track-lane"
                style={{ backgroundSize: `${100 / plan.total_bars}% 100%` }}
              >
                <div
                  className="tracks-head"
                  ref={(element) => {
                    if (element) trackHeads.current.set(file, element);
                    else trackHeads.current.delete(file);
                  }}
                />
                {phrases.map((phrase) => {
                  const start = phrase.start_bar * 1920,
                    length = phrase.bar_count * 1920;
                  const notes = musical.filter(
                    (n) =>
                      n.event_id &&
                      n.tick >= start &&
                      n.tick < start + length &&
                      bundle.map.units.find((u) => u.unit_id === n.unit_id)?.primary_span.path === file,
                  );
                  const anchor =
                    notes.find((n) => n.kind === 'cue') ?? notes.find((n) => n.kind === 'data') ?? notes[0];
                  if (!anchor) return null;
                  const unit = bundle.map.units.find((u) => u.unit_id === anchor.unit_id)!;
                  const candidate = bundle.map.review_signals?.find(
                    (signal) => signal.verdict === 'concern' && signal.unit_ids.includes(unit.unit_id),
                  );
                  return (
                    <button
                      key={phrase.phrase_id}
                      className={`midi-clip ${ws.unitId === anchor.unit_id ? 'selected' : ''} ${notes.some((n) => n.kind === 'cue') ? 'has-concern' : candidate ? 'has-review-candidate' : ''}`}
                      style={{ left: `${(start / total) * 100}%`, width: `${(length / total) * 100}%` }}
                      title={`${file}:${unit.primary_span.start_line}–${unit.primary_span.end_line}`}
                      onClick={(e) => {
                        const bounds = e.currentTarget.getBoundingClientRect();
                        const tick = e.detail
                          ? start + ((e.clientX - bounds.left) / bounds.width) * length
                          : anchor.tick;
                        const nearest = [...notes].sort(
                          (a, b) => Math.abs(a.tick - tick) - Math.abs(b.tick - tick),
                        )[0];
                        select(nearest ?? anchor);
                      }}
                    >
                      <span className="clip-title">
                        <span className="clip-name">{unit.label}</span>
                        <small>
                          {notes.some((n) => n.kind === 'cue')
                            ? bundle.map.review_signals?.find(
                                (s) => s.signal_id === notes.find((n) => n.kind === 'cue')?.signal_id,
                              )?.category === 'data_flow_opacity'
                              ? '途切れる応答'
                              : '比較した違い'
                            : candidate
                              ? '要確認'
                              : ''}
                        </small>
                      </span>
                      <svg viewBox="0 0 1000 50" preserveAspectRatio="none">
                        {notes.map((note) => (
                          <rect
                            key={note.note_id}
                            data-testid={note.kind === 'data' ? 'data-note' : undefined}
                            x={((note.tick - start) / length) * 1000}
                            y={note.midi != null ? 5 + (84 - note.midi) * 1.1 : 38}
                            width={Math.max(2, ((note.duration_ms * 0.768) / length) * 1000)}
                            height={note.kind === 'data' ? 5 : 3}
                            fill={noteColor(note)}
                            opacity={note.kind === 'accompaniment' ? 0.65 : 1}
                          >
                            <title>
                              {
                                bundle.map.responsibilities.find(
                                  (r) => r.responsibility_id === note.responsibility_id,
                                )?.motif_id
                              }{' '}
                              /{' '}
                              {
                                bundle.map.responsibilities.find(
                                  (r) => r.responsibility_id === note.responsibility_id,
                                )?.label
                              }{' '}
                              · {bundle.map.events.find((e) => e.event_id === note.event_id)?.span.path}:
                              {bundle.map.events.find((e) => e.event_id === note.event_id)?.span.start_line} ·{' '}
                              {note.kind === 'accompaniment'
                                ? '意味の旋律を反復'
                                : note.kind === 'cue'
                                  ? '懸念の応答リズム'
                                  : '意味の打点'}
                            </title>
                          </rect>
                        ))}
                      </svg>
                    </button>
                  );
                })}
                {(bundle.map.review_signals ?? []).flatMap((signal) => {
                  const anchor = musical.find(
                    (note) =>
                      note.kind === 'data' &&
                      signal.event_ids.includes(note.event_id ?? '') &&
                      bundle.map.events.find((item) => item.event_id === note.event_id)?.span.path === file,
                  );
                  return anchor
                    ? [
                        <button
                          key={signal.signal_id}
                          className={`candidate-mark ${ws.signalId === signal.signal_id ? 'selected' : ''}`}
                          data-testid="candidate-mark"
                          style={{ left: `${(anchor.tick / total) * 100}%` }}
                          aria-label={`確認候補：${signal.label}`}
                          title={`確認候補：${signal.label} · 根拠と別の説明を読む`}
                          onClick={() => {
                            engine.pause();
                            ws.set({ ...signalSelection(bundle, signal), following: false });
                          }}
                        />,
                      ]
                    : [];
                })}
                {groups
                  .filter(
                    (n) => bundle.map.units.find((u) => u.unit_id === n.unit_id)?.primary_span.path === file,
                  )
                  .map((n) => (
                    <button
                      key={`cue_${n.note_id}`}
                      className="concern-region"
                      data-testid="cue-note"
                      style={{
                        left: `${((Math.floor(n.tick / 1920) * 1920) / total) * 100}%`,
                        width: `${(1920 / total) * 100}%`,
                      }}
                      aria-label={`${file}:${bundle.map.events.find((e) => e.event_id === n.event_id)!.span.start_line} 懸念のリズム`}
                      onClick={() => select(n)}
                    />
                  ))}
              </div>
            </div>
          );
        })}
      </div>
      {ws.showBacking && (
        <div className="arrangement-backing">
          <div className="backing-heading">
            共通伴奏 <span>楽曲の土台 · コードの判断を表す音ではありません</span>
          </div>
          {supports.map((part) => {
            const notes = musical.filter((n) => !n.event_id && part.voices.includes(n.voice));
            return (
              <div
                className={`backing-track ${ws.focusEvidence || part.voices.every((v) => ws.instrumentMutes.includes(v)) ? 'muted-track' : ''}`}
                key={part.name}
              >
                <div className="composer-track-label">
                  <span>
                    <strong>{part.name}</strong>
                    <small>{part.detail}</small>
                  </span>
                  <button
                    className="track-mute"
                    aria-label={`${part.name}をミュート`}
                    aria-pressed={part.voices.every((v) => ws.instrumentMutes.includes(v))}
                    onClick={() =>
                      ws.set({
                        instrumentMutes: part.voices.every((v) => ws.instrumentMutes.includes(v))
                          ? ws.instrumentMutes.filter((v) => !part.voices.includes(v))
                          : [...new Set([...ws.instrumentMutes, ...part.voices])],
                      })
                    }
                  >
                    M
                  </button>
                  <i
                    className={`activity-led ${active.some((n) => !n.event_id && part.voices.includes(n.voice)) ? 'on' : ''}`}
                  />
                </div>
                <div className="backing-lane">
                  <svg viewBox="0 0 1000 28" preserveAspectRatio="none">
                    {notes.map((note) => (
                      <rect
                        key={note.note_id}
                        x={(note.tick / total) * 1000}
                        y={note.midi != null ? 4 + (72 - note.midi) * 0.3 : 8}
                        width={Math.max(1, ((note.duration_ms * 0.768) / total) * 1000)}
                        height={4}
                        fill="#75849c"
                      />
                    ))}
                  </svg>
                </div>
              </div>
            );
          })}
        </div>
      )}
      <div
        className="composer-now"
        data-sounding-span={
          event ? `${event.span.path}:${event.span.start_line}–${event.span.end_line}` : undefined
        }
      >
        <span role="status" data-testid="audition-status">
          {audioError ||
            (auditionState !== 'idle'
              ? auditionState === 'loading'
                ? '対象の音を準備中 · 再生設定は保持'
                : `対象の旋律だけ試聴中 · ${engine.auditionDurationSeconds}秒の範囲`
              : event
                ? `演奏中 · ${event.label}`
                : active.length
                  ? '発音中：共通伴奏（コード根拠なし）'
                  : '音を選ぶと、下のコードに根拠を表示')}
        </span>
        {auditionState !== 'idle' ? (
          <button className="audition" onClick={() => engine.pause()}>
            試聴を取消
          </button>
        ) : (
          ws.unitId && (
            <button className="audition" data-tour="audition" onClick={() => void audition()}>
              <Play size={12} />
              この区間を聴く
            </button>
          )
        )}
      </div>
    </section>
  );
}

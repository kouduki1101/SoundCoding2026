import { useEffect, useRef, useState } from 'react';
import type { Bundle } from '../api';
import type { ScorePlan, ScheduledNote } from '../../../../packages/contracts/ScoreBundle';
import { engine } from '../audio/engine';
import { useWorkspace } from '../state';

export function DemoComparison({
  bundle,
  plan,
  select,
}: {
  bundle: Bundle;
  plan: ScorePlan;
  select: (note: ScheduledNote) => void;
}) {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const request = useRef(0);
  const [error, setError] = useState('');
  const sampleId = useWorkspace((state) => state.sampleId);
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      request.current++;
      engine.setSupportMuted(useWorkspace.getState().focusEvidence);
    },
    [sampleId],
  );
  if (sampleId !== 'recorded-returns-before') return null;
  const role = bundle.map.responsibilities.find((r) => r.responsibility_id === 'resp_return_policy');
  const pairs = ['check_return_window', 'evaluate_item_eligibility', 'calculate_fee_quote'].map((key) =>
    bundle.map.events.filter((e) => e.concept_key === key && e.responsibility_id === role?.responsibility_id),
  );
  async function listen(note: ScheduledNote) {
    const current = ++request.current;
    clearTimeout(timer.current);
    engine.pause();
    select(note);
    engine.setSupportMuted(true);
    try {
      await engine.play(() => current === request.current);
      if (current !== request.current) return;
      timer.current = setTimeout(
        () => {
          engine.pause();
          engine.setSupportMuted(useWorkspace.getState().focusEvidence);
        },
        Math.min(1200, note.duration_ms + 300),
      );
      setError('');
    } catch {
      if (current !== request.current) return;
      engine.setSupportMuted(useWorkspace.getState().focusEvidence);
      setError('音源を読み込めませんでした。根拠行は音なしでも確認できます。');
    }
  }
  return (
    <section className="demo-comparison" aria-label="音とコードの対応" data-tour="demo-comparison">
      <strong>同じ返品ルールの判断を、店舗とWebで聴く</strong>
      <small>
        教材の保存済み実解析 · 同じ責務＋意味キー → 同じ音高 · 聴き比べは伴奏なし ·
        繰り返しは欠陥の証明ではありません
      </small>
      <div className="demo-pairs">
        {pairs.map((pair, i) => (
          <div key={i}>
            <span>{['返品期限', '対象商品', '手数料'][i]}</span>
            {pair.map((event) => {
              const note = plan.notes.find((n) => n.kind === 'data' && n.event_id === event.event_id);
              return (
                note && (
                  <button
                    key={event.event_id}
                    onClick={() => void listen(note)}
                    title={`${event.span.path}:${event.span.start_line}–${event.span.end_line} / MIDI ${note.midi}`}
                  >
                    {event.span.path.includes('store') ? '店舗' : 'Web'}の音・根拠{' '}
                    <small>
                      {event.span.start_line}–{event.span.end_line}行 / 音高{note.midi}
                    </small>
                  </button>
                )
              );
            })}
          </div>
        ))}
      </div>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}

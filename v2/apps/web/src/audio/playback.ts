import type { ScoreBundle } from '../../../../packages/contracts';
import type { ScorePlan } from '../../../../packages/contracts/ScoreBundle';

export function playbackPlan(
  score: ScoreBundle | undefined,
  mode: 'repo' | 'theme',
  scene: number,
  whole: boolean,
  unitIds?: string[],
): ScorePlan | undefined {
  if (!score?.scenes.length) return undefined;
  if (!whole && !unitIds) return score.scenes[scene]?.[mode];
  const plans = score.scenes.map((s) => s[mode]);
  const result: ScorePlan = { ...plans[0], scene_id: 'whole_work', total_bars: 0, notes: [], phrases: [] };
  for (const plan of plans) {
    const offset = result.total_bars;
    result.notes.push(
      ...plan.notes.map((n) => ({
        ...n,
        note_id: `${plan.scene_id}_${n.note_id}`,
        tick: n.tick + offset * 1920,
      })),
    );
    result.phrases.push(
      ...plan.phrases.map((p) => ({
        ...p,
        phrase_id: `${plan.scene_id}_${p.phrase_id}`,
        start_bar: p.start_bar + offset,
      })),
    );
    result.total_bars += plan.total_bars;
  }
  if (!unitIds) return result;
  const selected = new Set(unitIds);
  const semantic = result.notes.filter((n) => n.unit_id && selected.has(n.unit_id));
  if (!semantic.length) return undefined;
  const bars = new Set(semantic.map((note) => Math.floor(note.tick / 1920)));
  const ordered = [...bars].sort((a, b) => a - b);
  const positions = new Map(ordered.map((bar, index) => [bar, index]));
  const phrases = result.phrases
    .filter((p) => !p.unit_id || selected.has(p.unit_id))
    .flatMap((p) => {
      const kept = ordered.filter((bar) => bar >= p.start_bar && bar < p.start_bar + p.bar_count);
      return kept.length ? [{ ...p, start_bar: positions.get(kept[0])!, bar_count: kept.length }] : [];
    });
  return {
    ...result,
    scene_id: 'selected_file',
    total_bars: ordered.length,
    notes: result.notes
      .filter((n) => positions.has(Math.floor(n.tick / 1920)) && (!n.unit_id || selected.has(n.unit_id)))
      .map((n) => {
        const tick = positions.get(Math.floor(n.tick / 1920))! * 1920 + (n.tick % 1920);
        const phrase = phrases.find(
          (p) => p.start_bar * 1920 <= tick && tick < (p.start_bar + p.bar_count) * 1920,
        );
        const end = (phrase ? phrase.start_bar + phrase.bar_count : ordered.length) * 1920;
        return {
          ...n,
          tick,
          duration_ms: Math.min(n.duration_ms, Math.floor(((end - tick) * 1000) / 768)),
        };
      }),
    phrases,
  };
}

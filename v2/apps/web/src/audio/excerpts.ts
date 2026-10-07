import type { ScorePlan } from '../../../../packages/contracts/ScoreBundle';
import type { SemanticMap } from '../../../../packages/contracts/SemanticMap';

// Keep the recorded melody, dynamics and within-bar timing. Omitted bars are disclosed by callers.
export function focusedExcerpt(plan: ScorePlan, eventIds: string[], maxBars = 4) {
  const selected = new Set(eventIds);
  const notes = plan.notes.filter((note) => note.kind === 'data' && selected.has(note.event_id ?? ''));
  const bars = [...new Set(notes.map((note) => Math.floor(note.tick / 1920)))].sort((a, b) => a - b);
  const kept = bars.slice(0, maxBars);
  const positions = new Map(kept.map((bar, i) => [bar, i]));
  const excerpt: ScorePlan = {
    ...plan,
    scene_id: 'focused_excerpt',
    total_bars: kept.length,
    phrases: [],
    notes: notes.flatMap((note) => {
      const bar = positions.get(Math.floor(note.tick / 1920));
      if (bar === undefined) return [];
      const tick = bar * 1920 + (note.tick % 1920);
      return [
        {
          ...note,
          tick,
          duration_ms: Math.min(note.duration_ms, Math.floor(((kept.length * 1920 - tick) * 1000) / 768)),
        },
      ];
    }),
  };
  return { plan: excerpt, omittedBars: bars.length - kept.length };
}

export function responsibilityComparison(plan: ScorePlan, map: SemanticMap, unitA: string, unitB: string) {
  const side = (unitId: string) => {
    const events = map.events.filter((event) => event.unit_id === unitId && event.state === 'grounded');
    const notes = plan.notes.filter(
      (note) => note.kind === 'data' && events.some((event) => event.event_id === note.event_id),
    );
    const phrase = plan.phrases.find((item) => item.unit_id === unitId);
    const start = phrase?.start_bar ?? Math.floor(Math.min(...notes.map((note) => note.tick)) / 1920);
    const bars =
      phrase?.bar_count ?? Math.ceil(Math.max(...notes.map((note) => note.tick + 1)) / 1920) - start;
    return { events, notes, start, bars };
  };
  const a = side(unitA),
    b = side(unitB);
  if (!a.notes.length || !b.notes.length) return undefined;
  const bars = Math.min(4, Math.max(a.bars, b.bars));
  const build = (selection: typeof a): ScorePlan => ({
    ...plan,
    scene_id: 'responsibility_comparison',
    total_bars: bars,
    phrases: [],
    notes: selection.notes
      .filter((note) => note.tick < (selection.start + bars) * 1920)
      .map((note) => ({
        ...note,
        tick: note.tick - selection.start * 1920,
        duration_ms: Math.min(
          note.duration_ms,
          Math.floor((((selection.start + bars) * 1920 - note.tick) * 1000) / 768),
        ),
      })),
  });
  const key = (event: (typeof a.events)[number]) => `${event.responsibility_id}:${event.concept_key}`;
  const keys = [...new Set([...a.events, ...b.events].map(key))];
  const uncertainKeys = keys.filter(
    (value) =>
      a.events.filter((event) => key(event) === value).length !== 1 ||
      b.events.filter((event) => key(event) === value).length !== 1,
  );
  return {
    a: build(a),
    b: build(b),
    omittedBars: [Math.max(0, a.bars - bars), Math.max(0, b.bars - bars)],
    uncertainKeys,
  };
}

export function sequenceExcerpts(a: ScorePlan, b: ScorePlan): ScorePlan {
  return {
    ...a,
    total_bars: a.total_bars + b.total_bars,
    notes: [
      ...a.notes.map((note) => ({ ...note, note_id: `a_${note.note_id}` })),
      ...b.notes.map((note) => ({
        ...note,
        note_id: `b_${note.note_id}`,
        tick: note.tick + a.total_bars * 1920,
      })),
    ],
  };
}

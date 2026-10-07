import type { SemanticMap } from '../../contracts';
import type { ScorePlan, ScheduledNote } from '../../contracts/ScoreBundle';

export const melody = [
  [72, 76, 79, 81, 79, 76, 74, 72],
  [67, 69, 72, 76, 74, 72, 69, 67],
  [76, 79, 81, 84, 81, 79, 76, 74],
  [69, 72, 74, 79, 76, 74, 72, 69],
  [74, 76, 79, 81, 84, 81, 79, 76],
  [79, 76, 74, 72, 69, 72, 74, 76],
];
const chords = [
  [52, 59, 62, 67],
  [55, 60, 64, 69],
  [53, 60, 64, 69],
  [53, 59, 64, 69],
];
const bassLines = [
  [36, 40, 43, 44],
  [33, 36, 40, 37],
  [38, 41, 45, 42],
  [31, 35, 38, 35],
];
const roleRhythms = [
  [0, 480, 800, 1440],
  [0, 320, 960, 1280],
  [0, 640, 960, 1600],
  [0, 320, 720, 1440],
  [0, 480, 1120, 1440],
  [0, 640, 1120, 1600],
];
const patternRhythms = {
  domain_rule: 0,
  responsibility: 1,
  layer_boundary: 2,
  dependency_direction: 3,
  error_strategy: 4,
  naming: 5,
} as const;

export function arrangeJazz(plan: ScorePlan, map: SemanticMap) {
  const add = (
    id: string,
    tick: number,
    voice: ScheduledNote['voice'],
    midi: number | null,
    velocity: number,
    duration: number,
    extras: Partial<ScheduledNote> = {},
  ) => {
    const phrase = plan.phrases.find(
      (p) => p.start_bar * 1920 <= tick && tick < (p.start_bar + p.bar_count) * 1920,
    );
    const end = (phrase ? phrase.start_bar + phrase.bar_count : plan.total_bars) * 1920;
    plan.notes.push({
      note_id: id,
      kind: 'accompaniment',
      tick,
      voice,
      midi,
      variant: 0,
      velocity,
      duration_ms: Math.min(duration, Math.max(1, Math.floor(((end - tick) * 60 * 1000) / (96 * 480)))),
      pan: voice === 'bass' ? -0.12 : 0.12,
      evidence_ids: [],
      ...extras,
    });
  };
  for (let bar = 0; bar < plan.total_bars; bar++) {
    const start = bar * 1920;
    const harmony = bar % 4;
    for (let beat = 0; beat < 4; beat++) {
      add(
        `bass_${bar}_${beat}`,
        start + beat * 480,
        'bass',
        (bar === plan.total_bars - 1 ? [36, 43, 40, 36] : bassLines[harmony])[beat],
        0.42,
        510,
      );
    }
    for (const step of [0, 10])
      chords[bar === plan.total_bars - 1 ? 0 : harmony].forEach((pitch, i) =>
        add(`chord_${bar}_${step}_${i}`, start + step * 120 + i * 7, 'piano', pitch, 0.19, 1500),
      );
    const phrase = plan.phrases.find((p) => p.start_bar <= bar && bar < p.start_bar + p.bar_count);
    const owners = plan.notes.filter(
      (n) =>
        n.kind === 'data' &&
        (phrase?.unit_id ? n.unit_id === phrase.unit_id : n.responsibility_id === phrase?.responsibility_id),
    );
    const rids = [...new Set(owners.map((n) => n.responsibility_id!))];
    rids.forEach((rid, index) => {
      const responsibility = map.responsibilities.find((r) => r.responsibility_id === rid)!;
      const motif = Number(responsibility.motif_id.slice(1));
      const anchor = owners.find((n) => n.responsibility_id === rid)!;
      const localBar = bar - (phrase?.start_bar ?? 0);
      const designPattern = [...(map.design_patterns ?? [])]
        .sort((a, b) => (a.pattern_id < b.pattern_id ? -1 : a.pattern_id > b.pattern_id ? 1 : 0))
        .find((p) => p.peer_unit_ids.includes(anchor.unit_id!));
      const rhythm = roleRhythms[designPattern ? patternRhythms[designPattern.kind] : motif];
      rhythm.forEach((offset, beat) => {
        const anchors = owners.filter((n) => n.responsibility_id === rid);
        const linked = anchors[(localBar * 4 + beat) % anchors.length] ?? anchor;
        const position = localBar * 4 + beat;
        add(
          `melody_${bar}_${rid}_${beat}`,
          start + offset + index * 40,
          motif % 2 ? 'vibes' : 'piano',
          bar === plan.total_bars - 1 && beat === rhythm.length - 1 ? 72 : melody[motif][position % 8],
          (beat === 0 ? 0.28 : 0.2) / Math.sqrt(rids.length),
          localBar % 4 === 3 && beat === 2 ? 1000 : 620,
          {
            responsibility_id: rid,
            event_id: linked.event_id,
            unit_id: linked.unit_id,
            variant: motif,
            evidence_ids: linked.evidence_ids,
          },
        );
      });
    });
  }
  const responseBars = new Set<number>();
  for (const signal of [...(map.review_signals ?? [])].sort((a, b) =>
    a.signal_id.localeCompare(b.signal_id),
  )) {
    if ((signal.review_axis ?? 'coherence') !== 'coherence' || signal.human_review_required) continue;
    const comparedPattern = signal.comparison
      ? map.design_patterns?.find((p) => p.pattern_id === signal.comparison!.pattern_id)
      : undefined;
    if (!comparedPattern || signal.counter_status !== 'rejected') continue;
    if (signal.verdict !== 'concern') continue;
    for (const phrase of plan.phrases) {
      if (plan.mode === 'repo' && !signal.unit_ids.includes(phrase.unit_id!)) continue;
      const signalEvents = plan.notes.filter(
        (n) =>
          n.kind === 'data' &&
          signal.event_ids.includes(n.event_id!) &&
          n.tick >= phrase.start_bar * 1920 &&
          n.tick < (phrase.start_bar + phrase.bar_count) * 1920,
      );
      const event = signalEvents[0];
      if (!event) continue;
      const bar = phrase.start_bar + (phrase.bar_count > 1 ? 1 : 0);
      if (responseBars.has(bar)) continue;
      responseBars.add(bar);
      const pattern = comparedPattern
        ? roleRhythms[patternRhythms[comparedPattern.kind]].map((offset, i) => offset + (i === 1 ? 160 : 0))
        : signal.category === 'policy_scattering'
          ? [0, 160, 480, 640, 960, 1120, 1440, 1600]
          : signal.category === 'responsibility_mixing'
            ? [0, 320, 720, 1040, 1440, 1680]
            : signal.category === 'data_flow_opacity'
              ? [0, 320, 1120, 1440]
              : [0, 480, 720, 960, 1440];
      {
        const tick = bar * 1920;
        // Replace the decorative repetition here; stacking responses would imply severity.
        plan.notes = plan.notes.filter(
          (n) => !(n.kind === 'accompaniment' && n.event_id && n.tick >= tick && n.tick < tick + 1920),
        );
        pattern.forEach((offset, i) => {
          const sourceEvent = signalEvents[Math.floor(i / 2) % signalEvents.length];
          const motif = Number(
            map.responsibilities
              .find((r) => r.responsibility_id === sourceEvent.responsibility_id)!
              .motif_id.slice(1),
          );
          add(
            `cue_${signal.signal_id}_${phrase.phrase_id}_${bar}_${i}`,
            tick + offset,
            i % 2 ? 'vibes' : 'piano',
            signal.category === 'data_flow_opacity' && i === pattern.length - 1
              ? 71
              : melody[motif][Math.floor(i / 2) % 4],
            i % 2 ? 0.38 : 0.44,
            i % 2 ? 380 : 480,
            {
              kind: 'cue',
              variant: motif,
              signal_id: signal.signal_id,
              event_id: sourceEvent.event_id,
              unit_id: sourceEvent.unit_id,
              responsibility_id: sourceEvent.responsibility_id,
              evidence_ids: [
                ...new Set([...signal.evidence_ids, ...(signal.comparison?.reference_evidence_ids ?? [])]),
              ],
            },
          );
        });
        for (const note of plan.notes)
          if (
            note.kind === 'accompaniment' &&
            note.tick >= tick &&
            note.tick < tick + 1920 &&
            (note.voice === 'piano' || note.voice === 'vibes' || note.voice === 'bass')
          )
            note.velocity *= note.voice === 'bass' ? 0.9 : 0.8;
      }
    }
  }
}

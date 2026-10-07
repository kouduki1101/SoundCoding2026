import type { SemanticMap, ScoreBundle } from '../../contracts';
import type { ScorePlan, ScheduledNote } from '../../contracts/ScoreBundle';
import { arrangeJazz, melody } from './arrangement';

const motifs = [
  [0, 8, 4, 12, 6, 14, 3, 10],
  [0, 8, 7, 12, 3, 14, 5, 10],
  [0, 8, 4, 11, 6, 14, 2, 15],
  [0, 8, 5, 12, 3, 10, 7, 14],
  [0, 8, 4, 13, 6, 11, 2, 15],
  [0, 8, 5, 11, 3, 14, 7, 12],
];
const velocity = [0.58, 0.52, 0.55, 0.48, 0.52, 0.5, 0.48, 0.54];
const duration = [650, 520, 540, 700, 580, 520, 560, 820];
const pan = [-0.25, 0.2, -0.08, 0.3, -0.3, 0.08];
export const grammarVersion = 'groove-chamber-v10' as const;
export const tickSeconds = (tick: number) => ((tick / 480) * 60) / 96;
function occupiedBars(steps: number[]) {
  return new Map(
    [...new Set(steps.map((step) => Math.floor(step / 16)))]
      .sort((a, b) => a - b)
      .map((bar, index) => [bar, index]),
  );
}
export const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(',')}}`;
  return JSON.stringify(value);
};
async function sha256(value: unknown) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(value)));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function compileGroove(map: SemanticMap, kitHash: string): Promise<ScoreBundle> {
  const events = map.events.filter((e) => e.state === 'grounded');
  const ids = new Set(events.map((e) => e.event_id));
  if (ids.size !== events.length) throw new Error('DUPLICATE_EVENT');
  for (const r of map.responsibilities) {
    const orders = events
      .filter((e) => e.responsibility_id === r.responsibility_id)
      .map((e) => e.semantic_order);
    if (new Set(orders).size !== orders.length) throw new Error('DUPLICATE_ORDER');
  }
  if (new Set(map.responsibilities.map((r) => r.motif_id)).size !== map.responsibilities.length)
    throw new Error('DUPLICATE_MOTIF');
  const units = map.units
    .filter((u) => u.review_state !== 'excluded' && events.some((e) => e.unit_id === u.unit_id))
    .sort(
      (a, b) =>
        a.primary_span.path.localeCompare(b.primary_span.path, 'en') ||
        a.primary_span.start_line - b.primary_span.start_line ||
        a.unit_id.localeCompare(b.unit_id, 'en'),
    );
  const responsibilities = [...map.responsibilities].sort((a, b) => a.display_order - b.display_order);
  function layout(unitIds: string[]) {
    const sceneEvents = events.filter((e) => unitIds.includes(e.unit_id));
    const placements = responsibilities.flatMap((responsibility) => {
      const variant = Number(responsibility.motif_id.slice(1));
      const concepts = [
        ...new Set(
          events
            .filter((e) => e.responsibility_id === responsibility.responsibility_id)
            .sort((a, b) => a.semantic_order - b.semantic_order)
            .map((e) => e.concept_key),
        ),
      ];
      return sceneEvents
        .filter((e) => e.responsibility_id === responsibility.responsibility_id)
        .sort((a, b) => a.semantic_order - b.semantic_order)
        .map((event, index) => ({
          event,
          variant,
          slot: concepts.indexOf(event.concept_key) % 8,
          step: Math.floor(index / 8) * 64 + motifs[variant][index % 8] * 4,
        }));
    });
    const unitBars = new Map(
      unitIds.map((id) => [
        id,
        occupiedBars(placements.filter((p) => p.event.unit_id === id).map((p) => p.step)),
      ]),
    );
    const roleBars = new Map(
      responsibilities.map((r) => [
        r.responsibility_id,
        occupiedBars(
          placements.filter((p) => p.event.responsibility_id === r.responsibility_id).map((p) => p.step),
        ),
      ]),
    );
    return {
      placements,
      unitBars,
      roleBars,
      repoBars: [...unitBars.values()].reduce((sum, bars) => sum + bars.size, 0),
      themeBars: [...roleBars.values()].reduce((sum, bars) => sum + bars.size, 0),
    };
  }
  const groups: string[][] = [];
  let group: string[] = [];
  for (const unit of units) {
    const next = [...group, unit.unit_id];
    const plan = layout(next);
    if (plan.repoBars > 32 || plan.themeBars > 32) {
      if (!group.length) throw new Error('UNIT_TOO_DENSE');
      groups.push(group);
      group = [unit.unit_id];
      const single = layout(group);
      if (single.repoBars > 32 || single.themeBars > 32) throw new Error('UNIT_TOO_DENSE');
    } else group = next;
  }
  if (group.length) groups.push(group);
  const scenes = groups.map((unitIds, index) => {
    const { placements, unitBars, roleBars, repoBars, themeBars } = layout(unitIds);
    const sceneId = `scene_${index + 1}`;
    const base = {
      scene_id: sceneId,
      grammar_version: grammarVersion,
      kit_id: 'midnight-jazz-v4' as const,
      kit_hash: kitHash,
      bpm: 96 as const,
      beats_per_bar: 4 as const,
      steps_per_bar: 16 as const,
      ppq: 480 as const,
    };
    const theme: ScorePlan = { ...base, mode: 'theme', total_bars: themeBars, phrases: [], notes: [] };
    const repo: ScorePlan = {
      ...base,
      mode: 'repo',
      total_bars: repoBars,
      phrases: [],
      notes: [],
    };
    let unitStartBar = 0;
    unitIds.forEach((id, i) => {
      const count = unitBars.get(id)!.size;
      repo.phrases.push({
        phrase_id: `repo_${i}`,
        start_bar: unitStartBar,
        bar_count: count,
        label: units.find((u) => u.unit_id === id)!.label,
        unit_id: id,
      });
      unitStartBar += count;
    });
    let startBar = 0;
    responsibilities.forEach((r, ri) => {
      const ordered = placements.filter((p) => p.event.responsibility_id === r.responsibility_id);
      if (!ordered.length) return;
      theme.phrases.push({
        phrase_id: `theme_${ri}`,
        start_bar: startBar,
        bar_count: roleBars.get(r.responsibility_id)!.size,
        label: r.label,
        responsibility_id: r.responsibility_id,
      });
      ordered.forEach(({ event, slot, variant, step }) => {
        if (!event.evidence_ids.length) throw new Error('INVALID_EVIDENCE');
        const bar = Math.floor(step / 16),
          offset = (step % 16) * 120;
        const phrase = repo.phrases.find((p) => p.unit_id === event.unit_id)!;
        const note = {
          note_id: `note_${event.event_id}`,
          kind: 'data' as const,
          event_id: event.event_id,
          responsibility_id: r.responsibility_id,
          unit_id: event.unit_id,
          duration_ms: Math.min(duration[slot], Math.floor(tickSeconds(1920 - offset) * 1000)),
          voice: (variant % 2 ? 'vibes' : 'piano') as ScheduledNote['voice'],
          midi: melody[variant][slot],
          variant,
          velocity: velocity[slot],
          pan: pan[variant],
          evidence_ids: event.evidence_ids,
        };
        theme.notes.push({
          ...note,
          tick: (startBar + roleBars.get(r.responsibility_id)!.get(bar)!) * 1920 + offset,
        });
        repo.notes.push({
          ...note,
          tick: (phrase.start_bar + unitBars.get(event.unit_id)!.get(bar)!) * 1920 + offset,
        });
      });
      startBar += roleBars.get(r.responsibility_id)!.size;
    });
    for (const plan of [theme, repo]) {
      arrangeJazz(plan, map);
      plan.notes.sort((a, b) => a.tick - b.tick || a.note_id.localeCompare(b.note_id));
    }
    return { scene_id: sceneId, unit_ids: unitIds, theme, repo };
  });
  const normalizedEvidence = (ids: string[]) =>
    ids
      .map((id) => {
        const evidence = map.evidence.find((item) => item.evidence_id === id);
        if (!evidence) throw new Error('UNKNOWN_EVIDENCE');
        return { span: evidence.span, projection_sha256: evidence.projection_sha256 };
      })
      .sort((a, b) => {
        const left = canonical(a),
          right = canonical(b);
        return left < right ? -1 : left > right ? 1 : 0;
      });
  const semanticContent = {
    analysis_depth: map.analysis_depth ?? 'focused',
    profile: map.profile,
    responsibilities: map.responsibilities.map((value) => ({
      ...value,
      evidence_ids: normalizedEvidence(value.evidence_ids),
    })),
    units: map.units.map((value) => ({ ...value, evidence_ids: normalizedEvidence(value.evidence_ids) })),
    events: map.events.map((value) => ({ ...value, evidence_ids: normalizedEvidence(value.evidence_ids) })),
    review_signals: (map.review_signals ?? []).map((value) => ({
      ...value,
      review_axis: value.review_axis ?? 'coherence',
      human_review_required: value.human_review_required ?? false,
      human_review_reason: value.human_review_reason ?? '',
      comparison: value.comparison
        ? {
            ...value.comparison,
            reference_evidence_ids: normalizedEvidence(value.comparison.reference_evidence_ids),
          }
        : null,
      evidence_ids: normalizedEvidence(value.evidence_ids),
      alternative_evidence_ids: normalizedEvidence(value.alternative_evidence_ids ?? []),
    })),
    design_patterns: (map.design_patterns ?? []).map((pattern) => ({
      ...pattern,
      evidence_ids: normalizedEvidence(pattern.evidence_ids),
      exceptions: (pattern.exceptions ?? []).map((exception) => ({
        ...exception,
        evidence_ids: normalizedEvidence(exception.evidence_ids),
      })),
    })),
    evidence: map.evidence.map((e) => ({ span: e.span, projection_sha256: e.projection_sha256 })),
  };
  return {
    analysis_id: map.analysis_id,
    score_hash: await sha256({
      semanticContent,
      grammar: grammarVersion,
      kitHash,
      scenes: scenes.map((scene) => ({
        ...scene,
        theme: {
          ...scene.theme,
          notes: scene.theme.notes.map((note) => ({
            ...note,
            evidence_ids: normalizedEvidence(note.evidence_ids),
          })),
        },
        repo: {
          ...scene.repo,
          notes: scene.repo.notes.map((note) => ({
            ...note,
            evidence_ids: normalizedEvidence(note.evidence_ids),
          })),
        },
      })),
    }),
    scenes,
  };
}

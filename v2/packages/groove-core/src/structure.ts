import { createHash } from 'node:crypto';
import type { StructureComparison } from '../../contracts/StructureComparison';
import type { StructurePlaybackPlan, StructureTone } from '../../contracts/StructurePlaybackPlan';

export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b, 'en'))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
export const structureHash = (value: unknown) => createHash('sha256').update(stableJson(value)).digest('hex');
const callPhrases: [number, number][] = [
  [55, 67],
  [67, 55],
  [60, 64],
  [64, 60],
];
const syntaxPitch: Record<string, number[]> = {
  branch: [62],
  loop: [59, 59],
  declaration: [60],
  assignment: [60],
  return: [65],
  throw: [65],
  block: [57],
  function_boundary: [57, 60],
  call: [64],
};

export function compileStructure(comparison: StructureComparison, markers = false): StructurePlaybackPlan {
  const allEvents = [...comparison.a.events, ...comparison.b.events];
  const keys = [...new Set(allEvents.filter((e) => e.call_key).map((e) => e.call_key!))].sort();
  const dictionary = keys.slice(0, 4).map((key, i) => ({
    key,
    identity: allEvents.find((e) => e.call_key === key)!.call_identity!,
    midi: callPhrases[i],
  }));
  const status: StructurePlaybackPlan['status'] =
    keys.length > 4
      ? 'dictionary_overflow'
      : [comparison.a, comparison.b].some((p) => ['parse_failed', 'out_of_scope'].includes(p.status))
        ? 'extraction_unavailable'
        : comparison.rows.length
          ? 'ready'
          : 'empty';
  const segments: StructurePlaybackPlan['segments'] = [];
  if (status === 'ready') {
    for (let start = 0; start < comparison.rows.length; start += 12) {
      const rows = comparison.rows.slice(start, start + 12);
      const sideDuration = rows.length * 480;
      const tones: StructureTone[] = [];
      for (const side of ['A', 'B'] as const) {
        const events = side === 'A' ? comparison.a.events : comparison.b.events;
        rows.forEach((row, i) => {
          const eventId = side === 'A' ? row.a : row.b;
          const event = events.find((e) => e.event_id === eventId);
          const role =
            row.status === 'unsupported' || event?.kind === 'unsupported'
              ? 'unsupported'
              : !event && row.status === 'unknown'
                ? 'unknown'
                : !event
                  ? 'absent'
                  : 'structure';
          // Equal timbre and level: count/timing distinguish information states, never severity.
          const phrase = !event
            ? role === 'unsupported'
              ? [60, 60, 60]
              : role === 'absent'
                ? [60]
                : [60, 60]
            : event.kind === 'unsupported'
              ? [60, 60, 60]
              : event.call_key
                ? dictionary.find((p) => p.key === event.call_key)!.midi
                : syntaxPitch[event.kind];
          const at = i * 480 + (side === 'B' ? sideDuration + 400 : 0);
          phrase.forEach((midi, j) =>
            tones.push({
              at_ms: at + j * 100,
              duration_ms: 85,
              midi,
              side,
              event_id: eventId,
              row_id: row.row_id,
              role,
            }),
          );
          if (event && row.status === 'unknown')
            for (const offset of [300, 370])
              tones.push({
                at_ms: at + offset,
                duration_ms: 55,
                midi: 60,
                side,
                event_id: eventId,
                row_id: row.row_id,
                role: 'unknown',
              });
          if (markers && row.status === 'different')
            tones.push({
              at_ms: at + 350,
              duration_ms: 55,
              midi: 72,
              side,
              event_id: eventId,
              row_id: row.row_id,
              role: 'difference_marker',
            });
        });
      }
      segments.push({
        index: segments.length,
        start_row: start,
        end_row: start + rows.length,
        duration_ms: sideDuration * 2 + 600,
        tones,
      });
    }
  }
  const plan = {
    encoding_version: 'structure-neutral-v1' as const,
    dictionary_version: 'sorted-call-pairs-v1' as const,
    sound_version: 'sine-envelope-v1' as const,
    dictionary_limit: 4 as const,
    dictionary,
    markers,
    status,
    segments,
  };
  return { ...plan, score_hash: structureHash({ comparison, plan }) };
}

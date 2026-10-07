import type { ScorePlan, ScheduledNote } from '../../../../packages/contracts/ScoreBundle';
import type { Bundle } from '../api';

export type EventKaraokeRow = {
  note: ScheduledNote;
  eventId: string;
  label: string;
  path: string;
  line: number;
  sourceLine: string | null;
  startTick: number;
  endTick: number;
  reviewCandidate: boolean;
};

export function buildEventKaraokeRows(bundle: Bundle, plan: ScorePlan): EventKaraokeRow[] {
  const events = new Map(
    bundle.map.events.filter((event) => event.state === 'grounded').map((event) => [event.event_id, event]),
  );
  const sourceLines = new Map<string, string[]>();
  const candidateEvents = new Set(
    (bundle.map.review_signals ?? [])
      .filter((signal) => signal.verdict === 'concern' && signal.evidence_ids.length > 0)
      .flatMap((signal) => signal.event_ids),
  );
  const rows = plan.notes
    .filter((note) => note.kind === 'data' && note.event_id && events.has(note.event_id))
    .sort((a, b) => a.tick - b.tick || a.note_id.localeCompare(b.note_id))
    .map((note) => {
      const event = events.get(note.event_id!)!;
      const path = event.span.path;
      const source = bundle.sources[path];
      if (source !== undefined && !sourceLines.has(path)) sourceLines.set(path, source.split(/\r\n?|\n/));
      const lines = sourceLines.get(path);
      const start = event.span.start_line;
      const last = Math.min(event.span.end_line, lines?.length ?? 0);
      let line = start;
      if (lines && start <= last && !lines[start - 1]?.trim()) {
        for (let i = start + 1; i <= last; i++) {
          if (lines[i - 1]?.trim()) {
            line = i;
            break;
          }
        }
      }
      return {
        note,
        eventId: event.event_id,
        label: event.label,
        path,
        line,
        sourceLine: lines?.[line - 1] ?? null,
        startTick: note.tick,
        endTick: note.tick,
        reviewCandidate: candidateEvents.has(event.event_id),
      };
    });
  rows.forEach((row, index) => {
    const nextTick = rows[index + 1]?.startTick;
    const noteEnd = row.startTick + Math.max(1, row.note.duration_ms * 0.768);
    row.endTick = Math.min(plan.total_bars * 1920, Math.max(noteEnd, nextTick ?? row.startTick + 480));
  });
  return rows;
}

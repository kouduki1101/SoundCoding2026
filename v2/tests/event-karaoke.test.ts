import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Bundle } from '../apps/web/src/api';
import { buildEventKaraokeRows } from '../apps/web/src/components/eventKaraokeRows';
import { playbackPlan } from '../apps/web/src/audio/playback';

const bundle = JSON.parse(readFileSync('fixtures/recorded-live/returns-before.json', 'utf8')) as Bundle;
const plan = playbackPlan(bundle.score, 'repo', 0, true)!;

describe('event karaoke source mapping', () => {
  it('shows the committed source line for each grounded sound, in playback order', () => {
    const rows = buildEventKaraokeRows(bundle, plan);
    expect(rows.length).toBe(plan.notes.filter((note) => note.kind === 'data').length);
    expect(rows.map((row) => row.startTick)).toEqual(
      [...rows.map((row) => row.startTick)].sort((a, b) => a - b),
    );
    for (const row of rows) {
      const event = bundle.map.events.find((item) => item.event_id === row.eventId)!;
      expect(row.line).toBeGreaterThanOrEqual(event.span.start_line);
      expect(row.line).toBeLessThanOrEqual(event.span.end_line);
      expect(row.sourceLine).toBe(bundle.sources[row.path].split(/\r\n?|\n/)[row.line - 1]);
      expect(row.note.event_id).toBe(row.eventId);
    }
  });

  it('does not invent source text or a warning when source or evidence is unavailable', () => {
    const missingSource = structuredClone(bundle);
    const firstPath = buildEventKaraokeRows(bundle, plan)[0].path;
    delete missingSource.sources[firstPath];
    missingSource.map.review_signals = [];
    const rows = buildEventKaraokeRows(missingSource, plan);
    expect(rows.find((row) => row.path === firstPath)?.sourceLine).toBeNull();
    expect(rows.every((row) => !row.reviewCandidate)).toBe(true);
  });
});

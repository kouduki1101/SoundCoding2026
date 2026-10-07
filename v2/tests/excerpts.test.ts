import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { Bundle } from '../apps/web/src/api';
import { focusedExcerpt, responsibilityComparison, sequenceExcerpts } from '../apps/web/src/audio/excerpts';
import { playbackPlan } from '../apps/web/src/audio/playback';

const bundle = JSON.parse(readFileSync('fixtures/recorded-live/returns-before.json', 'utf8')) as Bundle;
const original = playbackPlan(bundle.score, 'repo', 0, true)!;

describe('focused listening keeps the source melody and bounds the excerpt', () => {
  it('removes unrelated events and backing without changing pitch, level or within-bar intervals', () => {
    const eventIds = bundle.map.review_signals![0]!.event_ids;
    const result = focusedExcerpt(original, eventIds);
    expect(result.plan.total_bars).toBeLessThanOrEqual(4);
    expect(result.plan.notes.length).toBeGreaterThan(0);
    for (const note of result.plan.notes) {
      const source = original.notes.find((item) => item.note_id === note.note_id)!;
      expect(note.kind).toBe('data');
      expect(eventIds).toContain(note.event_id);
      expect(note.midi).toBe(source.midi);
      expect(note.velocity).toBe(source.velocity);
      expect(note.voice).toBe(source.voice);
      expect(note.tick % 1920).toBe(source.tick % 1920);
      expect(note.tick + note.duration_ms * 0.768).toBeLessThanOrEqual(result.plan.total_bars * 1920 + 1);
    }
    expect(JSON.parse(JSON.stringify(original))).toEqual(original);
  });
  it('does not invent sound for an uninvestigated event', () => {
    expect(focusedExcerpt(original, ['unknown']).plan.notes).toEqual([]);
  });
  it('uses equal bars and the original responsibility melody for both sides of a small comparison', () => {
    const units = bundle.map.units.filter((unit) => unit.label.startsWith('quote'));
    const result = responsibilityComparison(original, bundle.map, units[0].unit_id, units[1].unit_id)!;
    expect(result.a.total_bars).toBe(result.b.total_bars);
    expect(result.a.bpm).toBe(result.b.bpm);
    for (const plan of [result.a, result.b])
      for (const note of plan.notes) {
        const source = original.notes.find((item) => item.note_id === note.note_id)!;
        expect([note.midi, note.voice, note.velocity, note.pan]).toEqual([
          source.midi,
          source.voice,
          source.velocity,
          source.pan,
        ]);
      }
    const sequence = sequenceExcerpts(result.a, result.b);
    expect(sequence.total_bars).toBe(result.a.total_bars * 2);
    expect(sequence.notes.slice(result.a.notes.length).map((note) => note.tick)).toEqual(
      result.b.notes.map((note) => note.tick + result.a.total_bars * 1920),
    );
    const unresolved = {
      ...bundle.map,
      events: bundle.map.events.map((event) => ({ ...event, state: 'unresolved' as const })),
    };
    expect(
      responsibilityComparison(original, unresolved, units[0].unit_id, units[1].unit_id),
    ).toBeUndefined();
  });
});

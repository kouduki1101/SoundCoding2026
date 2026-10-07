import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { instrumentEnvelope, instrumentSample } from '../packages/groove-core/src/instruments';
import { playbackPlan } from '../apps/web/src/audio/playback';
import type { ScoreBundle } from '../packages/contracts';

const bundle = JSON.parse(readFileSync('fixtures/recorded-live/checkout-flow.json', 'utf8'));
const score = bundle.score as ScoreBundle;
const samples = JSON.parse(
  readFileSync('apps/web/public/audio/midnight-jazz-v4/manifest.json', 'utf8'),
).samples;

describe('recorded instruments and bounded file listening', () => {
  it('uses a close recorded pitch without changing the score or sample bank', () => {
    const saved = JSON.stringify(samples);
    const notes = score.scenes.flatMap((s) => s.repo.notes);
    for (const note of notes) {
      const sample = instrumentSample(note, samples, 'midnight-jazz-v4');
      expect(sample).toBeDefined();
      if (note.midi != null && ['bass', 'piano'].includes(note.voice)) {
        expect(Math.abs(sample!.base_midi - note.midi)).toBeLessThanOrEqual(5);
      }
      const duration = note.duration_ms / 1000;
      const envelope = instrumentEnvelope(note.voice, duration);
      expect(envelope.attack).toBeGreaterThan(0);
      expect(envelope.release).toBeGreaterThan(0);
      expect(envelope.attack + envelope.release).toBeLessThan(duration);
    }
    expect(JSON.stringify(samples)).toBe(saved);
    const legacy = { ...notes[0], voice: 'bass' as const, variant: 4 };
    expect(instrumentSample(legacy, samples, 'midnight-jazz-v3')?.variant).toBe(4);
  });

  it('preserves every selected-code note, removes other files and keeps phrase bounds', () => {
    const saved = JSON.stringify(score);
    const selected = bundle.map.units
      .filter((u: { primary_span: { path: string } }) => u.primary_span.path === 'src/pricing.ts')
      .map((u: { unit_id: string }) => u.unit_id);
    expect(selected.length).toBeGreaterThan(1);
    for (const mode of ['repo', 'theme'] as const) {
      const whole = playbackPlan(score, mode, 0, true)!;
      const file = playbackPlan(score, mode, 0, true, selected)!;
      expect(file.total_bars).toBeLessThan(whole.total_bars);
      const relevant = whole.notes.filter((n) => n.unit_id && selected.includes(n.unit_id));
      expect(file.notes.filter((n) => n.unit_id).map((n) => n.note_id)).toEqual(
        relevant.map((n) => n.note_id),
      );
      expect(file.notes.some((n) => n.kind === 'accompaniment')).toBe(true);
      expect(file.notes.every((n) => n.tick < file.total_bars * 1920)).toBe(true);
      expect(file.phrases.every((p) => p.start_bar + p.bar_count <= file.total_bars)).toBe(true);
      expect(file.notes.every((n) => n.tick + n.duration_ms * 0.768 <= file.total_bars * 1920)).toBe(true);
      for (let bar = 0; bar < file.total_bars; bar++)
        expect(file.notes.some((n) => n.unit_id && Math.floor(n.tick / 1920) === bar)).toBe(true);
      if (mode === 'repo')
        expect(file.total_bars).toBe(
          whole.phrases
            .filter((p) => p.unit_id && selected.includes(p.unit_id))
            .reduce((sum, p) => sum + p.bar_count, 0),
        );
    }
    expect(playbackPlan(score, 'repo', 0, true, [])).toBeUndefined();
    expect(JSON.stringify(score)).toBe(saved);
  });
});

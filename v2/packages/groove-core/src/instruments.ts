import type { ScheduledNote } from '../../contracts/ScoreBundle';

export type KitSample = { voice: string; variant: number; file: string; base_midi: number };
export function instrumentSample(note: ScheduledNote, samples: KitSample[], kit: string) {
  const bank = samples.filter((s) => s.voice === note.voice);
  if (kit === 'midnight-jazz-v4' && note.midi != null && ['bass', 'piano'].includes(note.voice)) {
    return bank.sort(
      (a, b) =>
        Math.abs(a.base_midi - note.midi!) - Math.abs(b.base_midi - note.midi!) || a.variant - b.variant,
    )[0];
  }
  return bank.find((s) => s.variant === note.variant);
}
export function instrumentEnvelope(voice: string, duration: number) {
  return {
    attack: Math.min(voice === 'bass' ? 0.024 : voice === 'piano' ? 0.007 : 0.015, duration / 6),
    release: Math.min(voice === 'piano' ? 0.16 : voice === 'bass' ? 0.12 : 0.09, duration / 3),
  };
}

import type { StructureSegment } from '../../contracts/StructurePlaybackPlan';

export const structureSound = {
  version: 'sine-envelope-v1',
  gain: 0.06,
  attackSeconds: 0.008,
  sampleRate: 24000,
};
export const structureFrequency = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

// Trusted offline synthesis for technical PCM inspection; target code is never evaluated.
export function renderStructurePcm(segment: StructureSegment): Float32Array {
  const { sampleRate, gain, attackSeconds } = structureSound;
  const samples = new Float32Array(Math.ceil((segment.duration_ms * sampleRate) / 1000));
  for (const tone of segment.tones) {
    const start = Math.round((tone.at_ms * sampleRate) / 1000);
    const duration = tone.duration_ms / 1000;
    for (let i = 0; i < Math.ceil(duration * sampleRate); i++) {
      const seconds = i / sampleRate;
      const envelope =
        seconds < attackSeconds
          ? seconds / attackSeconds
          : Math.max(0, (duration - seconds) / (duration - attackSeconds));
      samples[start + i] += Math.sin(2 * Math.PI * structureFrequency(tone.midi) * seconds) * envelope * gain;
    }
  }
  return samples;
}

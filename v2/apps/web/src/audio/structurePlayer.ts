import type { StructureSegment, StructureTone } from '../../../../packages/contracts/StructurePlaybackPlan';
import { structureFrequency, structureSound } from '../../../../packages/groove-core/src/structure-sound';

class StructurePlayer {
  private context?: AudioContext;
  private nodes: OscillatorNode[] = [];
  private timers: ReturnType<typeof setTimeout>[] = [];
  private request = 0;
  stop() {
    this.request++;
    this.nodes.forEach((node) => {
      try {
        node.stop();
      } catch {
        /* Already finished. */
      }
    });
    this.nodes = [];
    this.timers.forEach(clearTimeout);
    this.timers = [];
  }
  async play(
    segment: StructureSegment,
    mode: 'A' | 'B' | 'A→B',
    select: (tone: StructureTone) => void,
    finished: () => void,
  ) {
    this.stop();
    const request = this.request;
    this.context ??= new AudioContext();
    await this.context.resume();
    if (request !== this.request) return false;
    if (this.context.state !== 'running') throw new Error('AUDIO_UNAVAILABLE');
    const tones = segment.tones.filter((t) => mode === 'A→B' || t.side === mode);
    const offset = mode === 'B' ? (segment.end_row - segment.start_row) * 480 + 400 : 0;
    const duration = mode === 'A→B' ? segment.duration_ms : (segment.end_row - segment.start_row) * 480 + 200;
    const start = this.context.currentTime + 0.03;
    for (const tone of tones) {
      const at = start + (tone.at_ms - offset) / 1000;
      const oscillator = this.context.createOscillator();
      const envelope = this.context.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = structureFrequency(tone.midi);
      envelope.gain.setValueAtTime(0, at);
      envelope.gain.linearRampToValueAtTime(structureSound.gain, at + structureSound.attackSeconds);
      envelope.gain.linearRampToValueAtTime(0, at + tone.duration_ms / 1000);
      oscillator.connect(envelope);
      envelope.connect(this.context.destination);
      oscillator.onended = () => {
        oscillator.disconnect();
        envelope.disconnect();
      };
      oscillator.start(at);
      oscillator.stop(at + tone.duration_ms / 1000);
      this.nodes.push(oscillator);
      this.timers.push(
        setTimeout(
          () => {
            if (request === this.request) select(tone);
          },
          tone.at_ms - offset + 30,
        ),
      );
    }
    this.timers.push(
      setTimeout(() => {
        if (request === this.request) {
          this.stop();
          finished();
        }
      }, duration + 30),
    );
    return true;
  }
}
export const structurePlayer = new StructurePlayer();
document.addEventListener('visibilitychange', () => {
  if (document.hidden) structurePlayer.stop();
});

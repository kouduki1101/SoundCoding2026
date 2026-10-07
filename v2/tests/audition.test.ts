import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScorePlan } from '../packages/contracts/ScoreBundle';
import { readFileSync } from 'node:fs';

const transport = vi.hoisted(() => ({
  seconds: 0,
  state: 'paused',
  bpm: { value: 96 },
  loop: false,
  loopStart: 0,
  loopEnd: 0,
  clear: vi.fn(),
  schedule: vi.fn((_callback: (time: number) => void, _seconds: number) => 1),
  start: vi.fn(),
  pause: vi.fn(),
  stop: vi.fn(),
}));
vi.mock('tone', () => ({
  getTransport: () => transport,
  start: vi.fn(async () => {}),
  getDraw: () => ({ schedule: (callback: () => void) => callback() }),
  getContext: () => ({ state: 'running' }),
}));
const original = JSON.parse(readFileSync('fixtures/recorded-live/returns-before.json', 'utf8')).score
  .scenes[0].repo as ScorePlan;
const excerpt = {
  ...original,
  total_bars: 1,
  notes: original.notes.filter((note) => note.kind === 'data').slice(0, 1),
};

describe('temporary audition restoration', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.stubGlobal('document', { addEventListener: vi.fn() });
    transport.seconds = 0;
    transport.schedule.mockClear();
    transport.start.mockClear();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  async function setup() {
    const { engine } = await import('../apps/web/src/audio/engine');
    engine.configure(original);
    engine.setLoop(true);
    engine.seek(1920);
    vi.spyOn(engine, 'load').mockResolvedValue();
    return engine;
  }
  it('restores loop, original plan and playhead after normal completion or cancellation', async () => {
    const engine = await setup();
    for (const cancel of [false, true]) {
      await engine.playAudition(excerpt);
      expect(engine.getAuditionState()).toBe('playing');
      expect(transport.loop).toBe(false);
      if (cancel) engine.pause();
      else await vi.advanceTimersByTimeAsync(3000);
      expect(engine.getAuditionState()).toBe('idle');
      expect(transport.loop).toBe(true);
      expect(engine.tick).toBe(1920);
      expect(transport.loopEnd).toBe(original.total_bars * 2.5);
    }
  });
  it('restores after load failure and does not restart a cancelled pending load', async () => {
    const engine = await setup();
    vi.mocked(engine.load).mockRejectedValueOnce(new Error('load failed'));
    await expect(engine.playAudition(excerpt)).rejects.toThrow('load failed');
    expect(engine.getAuditionState()).toBe('idle');
    expect(transport.loop).toBe(true);
    let complete!: () => void;
    vi.mocked(engine.load).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          complete = resolve;
        }),
    );
    const pending = engine.playAudition(excerpt);
    await vi.advanceTimersByTimeAsync(1);
    engine.pause();
    const starts = transport.start.mock.calls.length;
    complete();
    expect(await pending).toBe(false);
    expect(transport.start).toHaveBeenCalledTimes(starts);
    expect(engine.tick).toBe(1920);
  });
  it('a new plan cancels the audition and prevents its stale end callback restoring the old plan', async () => {
    const engine = await setup();
    await engine.playAudition(excerpt);
    const staleEnd = transport.schedule.mock.calls.at(-1)![0] as unknown as () => void;
    const next = { ...original, total_bars: original.total_bars + 5 };
    engine.configure(next);
    staleEnd();
    await vi.advanceTimersByTimeAsync(4000);
    expect(transport.loopEnd).toBe(next.total_bars * 2.5);
    expect(engine.getAuditionState()).toBe('idle');
  });
  it('does not let a stale completion stop a second audition using the same excerpt', async () => {
    const engine = await setup();
    await engine.playAudition(excerpt);
    const staleEnd = transport.schedule.mock.calls.at(-1)![0];
    await engine.playAudition(excerpt);
    staleEnd(0);
    expect(engine.getAuditionState()).toBe('playing');
    engine.pause();
  });
});

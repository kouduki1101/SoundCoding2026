import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { compileGroove } from './compiler';
import type { SemanticMap } from '../../contracts';

it('overview preserves detected observations and semantic rhythm without verdict-based cues', async () => {
  const { map } = JSON.parse(readFileSync('fixtures/recorded-live/returns-before.json', 'utf8')) as {
    map: SemanticMap;
  };
  map.analysis_depth = 'overview';
  const one = await compileGroove(map, 'health-test');
  const two = await compileGroove(structuredClone(map), 'health-test');
  expect(one.score_hash).toBe(two.score_hash);
  expect(map.review_signals?.some((s) => s.verdict === 'concern')).toBe(true);
  expect(one.scenes.flatMap((s) => s.repo.notes).some((n) => n.kind === 'cue')).toBe(false);
  map.analysis_depth = 'focused';
  const focused = await compileGroove(map, 'health-test');
  expect(focused.score_hash).not.toBe(one.score_hash);
  expect(focused.scenes.flatMap((s) => s.repo.notes).some((n) => n.kind === 'cue')).toBe(false);
  for (const scene of one.scenes) {
    const focusedScene = focused.scenes.find((s) => s.scene_id === scene.scene_id)!;
    expect(scene.repo.notes.filter((n) => n.kind === 'data')).toEqual(
      focusedScene.repo.notes.filter((n) => n.kind === 'data'),
    );
  }
});

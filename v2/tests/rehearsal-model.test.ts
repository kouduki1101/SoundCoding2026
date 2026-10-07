import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Bundle } from '../apps/web/src/api';
import { buildRelationshipDialogue } from '../apps/web/src/audio/relationshipDialogue';
import { sequenceExcerpts } from '../apps/web/src/audio/excerpts';
import { codeExcerpt, rehearsalCases, selectRehearsalLink } from '../apps/web/src/components/rehearsalModel';
import { callRelationships } from '../packages/repo-indexer/src/relationships';

const before = JSON.parse(readFileSync('fixtures/recorded-live/returns-before.json', 'utf8')) as Bundle;
const after = JSON.parse(readFileSync('fixtures/recorded-live/returns-after.json', 'utf8')) as Bundle;

describe('the recorded return rehearsal', () => {
  for (const caseId of ['web', 'store'] as const) {
    it(`finds one grounded call in each take for ${caseId}`, () => {
      const scene = rehearsalCases[caseId];
      const take = (bundle: Bundle, targetName: string) => {
        const caller = bundle.map.units.find((unit) => unit.label === scene.caller)!;
        const target = bundle.map.units.find((unit) => unit.label === targetName)!;
        const relations = callRelationships({
          snapshot_id: bundle.map.snapshot_id,
          sources: bundle.sources,
          unit_span: caller.primary_span,
        });
        const selected = selectRehearsalLink(relations, caller, target);
        expect(selected.status).toBe('ready');
        if (selected.status !== 'ready') throw new Error('Expected the recorded static call');
        const dialogue = buildRelationshipDialogue(
          bundle.map,
          bundle.score,
          relations,
          selected.link.link_id,
        );
        expect(dialogue.status).toBe('ready');
        if (dialogue.status !== 'ready') throw new Error('Expected the recorded dialogue');
        expect(codeExcerpt(bundle.sources, selected.link.call_span)?.lines).toHaveLength(5);
        return { selected, dialogue, relations, caller, target };
      };
      const old = take(before, scene.beforeTarget);
      const current = take(after, scene.afterTarget);
      expect(old.selected.link.name).toBe(scene.beforeTarget);
      expect(current.selected.link.name).toBe(scene.afterTarget);
      expect(old.dialogue.plan.kit_hash).toBe(current.dialogue.plan.kit_hash);
      expect(sequenceExcerpts(old.dialogue.plan, current.dialogue.plan).total_bars).toBe(8);
      expect(old.dialogue.phases[0].activeSpan).toEqual(old.selected.link.call_span);
      expect(current.dialogue.phases[0].activeSpan).toEqual(current.selected.link.call_span);
      expect(
        selectRehearsalLink(
          { ...old.relations, links: [old.selected.link, { ...old.selected.link, link_id: 'another_call' }] },
          old.caller,
          old.target,
        ),
      ).toMatchObject({ status: 'unavailable' });
    });
  }
});

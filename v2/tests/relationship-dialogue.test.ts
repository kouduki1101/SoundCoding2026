import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { Bundle } from '../apps/web/src/api';
import type { CallRelationships, StaticCallLink } from '../packages/contracts/CallRelationships';
import { buildRelationshipDialogue } from '../apps/web/src/audio/relationshipDialogue';

const bundle = JSON.parse(readFileSync('fixtures/recorded-live/returns-before.json', 'utf8')) as Bundle;
const caller = bundle.map.units.find((unit) => unit.label === 'submitStoreReturn')!;
const callee = bundle.map.units.find((unit) => unit.label === 'quoteStoreReturn')!;
const callSpan = { ...caller.primary_span, start_line: 46, end_line: 46 };
const useSpan = { ...caller.primary_span, start_line: 47, end_line: 47 };
const link: StaticCallLink = {
  link_id: 'link_test_quote_store',
  name: 'quoteStoreReturn',
  call_span: callSpan,
  callee_span: callee.primary_span,
  resolution: 'static_definition',
  return_spans: [callee.primary_span],
  result_binding: 'quote',
  use_spans: [useSpan],
  use_status: 'named_references',
  truncated: false,
  limitations: [],
};
const relationships: CallRelationships = {
  snapshot_id: bundle.map.snapshot_id,
  unit_span: caller.primary_span,
  status: 'ready',
  links: [link],
  truncated: false,
  limitations: [],
};

describe('relationship dialogue', () => {
  it('quotes the same grounded target motif in caller and callee voices with source-linked phases', () => {
    const before = JSON.stringify({ map: bundle.map, score: bundle.score, relationships });
    const result = buildRelationshipDialogue(bundle.map, bundle.score, relationships, link.link_id);
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    expect(result.plan.total_bars).toBe(4);
    expect(result.plan.bpm).toBe(96);
    expect(result.plan.notes).toHaveLength(20);
    expect(result.phases.map((phase) => phase.startTick)).toEqual([0, 1920, 3840, 5760]);
    expect(result.phases.map((phase) => phase.activeSpan)).toEqual([
      callSpan,
      callee.primary_span,
      useSpan,
      callSpan,
    ]);
    const melody = (phase: string) =>
      result.plan.notes
        .filter((note) => note.note_id.includes(`_${phase}_caller_`) || note.note_id.includes(`_${phase}_callee_`))
        .filter((note) => phase !== 'together' || note.note_id.includes('_callee_'))
        .map((note) => note.midi);
    expect(melody('quote')).toEqual(melody('answer'));
    expect(melody('receive')).toEqual(melody('answer'));
    expect(result.plan.notes.every((note) => note.event_id == null && note.evidence_ids.length === 0)).toBe(true);
    expect(result.sourceNoteIds).toHaveLength(4);
    expect(buildRelationshipDialogue(bundle.map, bundle.score, relationships, link.link_id)).toEqual(result);
    expect(JSON.stringify({ map: bundle.map, score: bundle.score, relationships })).toBe(before);
  });

  it('does not invent a voice for an unresolved or uninspected relationship', () => {
    const unresolved: CallRelationships = {
      ...relationships,
      links: [{ ...link, resolution: 'unresolved', callee_span: null }],
    };
    expect(buildRelationshipDialogue(bundle.map, bundle.score, unresolved, link.link_id)).toMatchObject({
      status: 'unavailable',
      reason: 'target_unresolved',
    });
    const map = {
      ...bundle.map,
      events: bundle.map.events.map((event) =>
        event.unit_id === callee.unit_id ? { ...event, state: 'unresolved' as const } : event,
      ),
    };
    expect(buildRelationshipDialogue(map, bundle.score, relationships, link.link_id)).toMatchObject({
      status: 'unavailable',
      reason: 'target_unheard',
    });
    expect(
      buildRelationshipDialogue(bundle.map, bundle.score, { ...relationships, snapshot_id: 'other' }, link.link_id),
    ).toMatchObject({ status: 'unavailable', reason: 'snapshot_mismatch' });
  });
});

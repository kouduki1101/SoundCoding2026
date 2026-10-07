import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import type { SemanticMap } from '../../contracts';
import { compileGroove } from './compiler';

function comparisonMap(): SemanticMap {
  const { map } = JSON.parse(readFileSync('fixtures/recorded-live/returns-before.json', 'utf8'));
  map.analysis_depth = 'overview';
  const subject = map.units[0],
    peers = [map.units[1], map.units[3]];
  const referenceProof = map.evidence.find((e: any) => e.span.path === peers[0].primary_span.path);
  const subjectEvent = map.events.find((e: any) => e.unit_id === subject.unit_id);
  map.design_patterns = [
    {
      pattern_id: 'pattern_mock',
      label: 'Mock domain pattern',
      kind: 'domain_rule',
      description: 'Read examples share a rule',
      scope_note: 'Technical test, no semantic accuracy claim',
      peer_unit_ids: peers.map((p: any) => p.unit_id),
      exceptions: [],
      evidence_ids: map.evidence
        .filter((e: any) => peers.some((p: any) => p.primary_span.path === e.span.path))
        .map((e: any) => e.evidence_id),
    },
  ];
  map.review_signals = [
    {
      ...map.review_signals[0],
      signal_id: 'signal_mock',
      category: 'change_coupling',
      verdict: 'concern',
      counter_explanation: 'Mock checked counter-explanation',
      counter_status: 'rejected',
      review_axis: 'coherence',
      human_review_required: false,
      human_review_reason: '',
      unit_ids: [subject.unit_id],
      event_ids: [subjectEvent.event_id],
      evidence_ids: subjectEvent.evidence_ids,
      comparison: {
        pattern_id: 'pattern_mock',
        reference_unit_id: peers[0].unit_id,
        reference_span: peers[0].primary_span,
        reference_evidence_ids: [referenceProof.evidence_id],
        observed_difference: 'Mock checked difference',
      },
    },
  ];
  return map;
}

it('a checked coherence comparison uses a reproducible deviation with source and peer evidence', async () => {
  const map = comparisonMap();
  const one = await compileGroove(map, 'test-kit'),
    two = await compileGroove(structuredClone(map), 'test-kit');
  expect(one).toEqual(two);
  const cues = one.scenes.flatMap((s) => s.repo.notes.filter((n) => n.kind === 'cue'));
  expect(cues).toHaveLength(4);
  expect(cues.map((n) => n.tick % 1920)).toEqual([0, 640, 800, 1440]);
  expect(
    cues.every(
      (n) =>
        n.signal_id === 'signal_mock' &&
        n.event_id &&
        n.evidence_ids.includes(map.review_signals![0]!.comparison!.reference_evidence_ids[0]!),
    ),
  ).toBe(true);
  const clone = structuredClone(map);
  clone.design_patterns = undefined;
  clone.review_signals = [];
  const baseline = await compileGroove(clone, 'test-kit');
  expect(one.scenes.map((s) => s.repo.notes.filter((n) => n.kind === 'data'))).toEqual(
    baseline.scenes.map((s) => s.repo.notes.filter((n) => n.kind === 'data')),
  );
});

it.each(['quality', 'correctness', 'human', 'justified'] as const)(
  'keeps %s separate from a musical concern',
  async (mode) => {
    const map = comparisonMap(),
      signal = map.review_signals![0]!;
    if (mode === 'quality' || mode === 'correctness') {
      signal.review_axis = mode;
      signal.comparison = null;
      signal.category = 'implementation_risk';
      map.analysis_depth = 'focused';
    } else if (mode === 'human') {
      signal.human_review_required = true;
      signal.human_review_reason = 'Owner must confirm the contract';
      signal.verdict = 'inconclusive';
    } else signal.verdict = 'justified';
    const score = await compileGroove(map, 'test-kit');
    expect(score.scenes.flatMap((s) => s.repo.notes).filter((n) => n.kind === 'cue')).toHaveLength(0);
  },
);

it.each(['not_checked', 'supported', 'undetermined'] as const)(
  'does not sound a concern when its counter-explanation is %s',
  async (status) => {
    const map = comparisonMap();
    map.review_signals![0]!.counter_status = status;
    const score = await compileGroove(map, 'test-kit');
    expect(score.scenes.flatMap((s) => s.repo.notes).filter((n) => n.kind === 'cue')).toEqual([]);
    expect(score.scenes.flatMap((s) => s.repo.notes).filter((n) => n.kind === 'data')).toHaveLength(
      map.events.length,
    );
  },
);

it('does not amplify a checked concern when an equivalent signal is repeated', async () => {
  const map = comparisonMap();
  const original = await compileGroove(map, 'test-kit');
  expect(original.scenes.flatMap((s) => s.repo.notes).filter((n) => n.kind === 'cue')).toHaveLength(4);
  map.review_signals = [
    ...map.review_signals!,
    { ...structuredClone(map.review_signals![0]!), signal_id: 'zz_duplicate' },
  ] as SemanticMap['review_signals'];
  const repeated = await compileGroove(map, 'test-kit');
  expect(repeated.scenes.map((s) => s.repo.notes)).toEqual(original.scenes.map((s) => s.repo.notes));
});

it('comparison and pattern hashes use source content instead of read receipt IDs', async () => {
  const map = comparisonMap(),
    clone = structuredClone(map);
  const aliases = new Map(clone.evidence.map((e, i) => [e.evidence_id, `new_receipt_${i}`]));
  const remap = (ids: string[]) => ids.map((id) => aliases.get(id)!);
  clone.evidence.forEach((e) => (e.evidence_id = aliases.get(e.evidence_id)!));
  for (const item of [
    ...clone.events,
    ...clone.units,
    ...clone.responsibilities,
    ...clone.review_signals!,
    ...clone.design_patterns!,
  ])
    item.evidence_ids = remap(item.evidence_ids);
  for (const signal of clone.review_signals!) {
    signal.alternative_evidence_ids = remap(signal.alternative_evidence_ids ?? []);
    signal.comparison!.reference_evidence_ids = remap(signal.comparison!.reference_evidence_ids);
  }
  expect((await compileGroove(map, 'test-kit')).score_hash).toBe(
    (await compileGroove(clone, 'test-kit')).score_hash,
  );
});

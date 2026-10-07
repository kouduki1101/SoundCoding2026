import { describe, expect, it } from 'vitest';
import { indexSnapshot } from './indexer';
import { alignSyntax, compareStructure, extractSyntax } from './structure';
import { compileStructure } from '../../groove-core/src/structure';
import { renderStructurePcm } from '../../groove-core/src/structure-sound';

function pair(a: string, b: string, helpers = '') {
  const input = {
    snapshot_id: 'snap_test',
    sources: { 'test.ts': `${helpers}\nfunction a(x: number) {${a}}\nfunction b(x: number) {${b}}` },
  };
  const index = indexSnapshot(input);
  const ua = index.units.find((u) => u.label === 'a')!,
    ub = index.units.find((u) => u.label === 'b')!;
  return { input, ua, ub, comparison: compareStructure(input, ua.unit_id, ub.unit_id) };
}
describe('syntax comparison preserves source and uncertainty', () => {
  it('removes only trivia, preserving keys, operators, literals and identifiers', () => {
    expect(
      pair('return { amount: x + 30 };', '/* c */ return {amount:x+30};').comparison.rows.every(
        (r) => r.status === 'equal',
      ),
    ).toBe(true);
    for (const [a, b] of [
      ['return { amount };', 'return { total };'],
      ['return x <= 30;', 'return x <= MAX_DAYS;'],
      ['return x + 1;', 'return x - 1;'],
      ['const n = 1;', 'let n = 1;'],
    ])
      expect(pair(a, b).comparison.rows.some((r) => r.status === 'different')).toBe(true);
  });
  it('retains exact offsets, lexical parent, depth, loop and branch membership', () => {
    const { input, comparison } = pair(
      'if (x > 0) { for(let i=0;i<3;i++) { check(x); } } else { throw x; }',
      'return x;',
    );
    const p = comparison.a;
    for (const event of p.events) {
      expect(input.sources['test.ts'].slice(event.location.start_offset, event.location.end_offset)).not.toBe(
        '',
      );
      expect(
        event.parent_id === null ||
          p.events.some((e) => e.event_id === event.parent_id && e.depth < event.depth),
      ).toBe(true);
    }
    expect(p.events.filter((e) => e.kind === 'loop')).toHaveLength(1);
    expect(p.events.filter((e) => e.kind === 'call')).toHaveLength(1);
    expect(p.events.find((e) => e.kind === 'call')!.context).toContain('/then');
    expect(p.events.find((e) => e.kind === 'throw')!.context).toContain('/else');
    const ternary = pair('return x ? check() : save();', 'return x;').comparison.a;
    expect(ternary.events.find((e) => e.label === 'check()')!.context).toContain('/whenTrue');
    expect(ternary.events.find((e) => e.label === 'save()')!.context).toContain('/whenFalse');
  });
  it('keeps callbacks and nested functions separate; never expands helpers', () => {
    const { input, comparison } = pair(
      'const cb = () => { save(); }; function inner() { audit(); } check(cb);',
      'return helper(x);',
      'function helper(x: number) {return x*2;}',
    );
    expect(comparison.a.events.filter((e) => e.kind === 'call').map((e) => e.label)).toEqual(['check(cb)']);
    expect(comparison.a.events.filter((e) => e.kind === 'function_boundary')).toHaveLength(2);
    const nested = indexSnapshot(input).units.find((u) => u.label === 'inner')!;
    expect(extractSyntax(input, nested.unit_id).events.some((e) => e.label === 'audit()')).toBe(true);
    expect(comparison.b.events.filter((e) => e.kind === 'call')).toHaveLength(1);
  });
  it('preserves both orders for inversions and duplicates without forced ambiguous pairing', () => {
    for (const [a, b] of [
      ['check(); save();', 'save(); check();'],
      ['check(); check();', 'check();'],
    ]) {
      const { comparison } = pair(a, b);
      expect(comparison.rows.filter((r) => r.a).map((r) => r.a)).toEqual(
        comparison.a.events.map((e) => e.event_id),
      );
      expect(comparison.rows.filter((r) => r.b).map((r) => r.b)).toEqual(
        comparison.b.events.map((e) => e.event_id),
      );
      expect(comparison.rows.some((r) => r.status === 'unknown')).toBe(true);
    }
  });
  it('distinguishes anchored gaps, unsupported syntax, parse errors and empty bodies', () => {
    expect(
      pair('check(); return x;', 'check(); save(); return x;').comparison.rows.some(
        (r) => r.status === 'absent',
      ),
    ).toBe(true);
    const unsupported = pair('switch(x) { case 1: return 1; }', 'return x;');
    expect(unsupported.comparison.a.status).toBe('unsupported');
    expect(unsupported.comparison.a.diagnostics.length).toBeGreaterThan(0);
    const invalid = pair('return (;', 'return x;');
    expect(invalid.comparison.a.status).toBe('parse_failed');
    expect(compileStructure(invalid.comparison).status).toBe('extraction_unavailable');
    const empty = pair('', '');
    expect(empty.comparison.a.status).toBe('empty');
    expect(compileStructure(empty.comparison).status).toBe('empty');
  });
  it('does not infer equivalent branching or inlining and reports bounds without truncation', () => {
    const comparison = pair('if(x) return 1; return 0;', 'return x ? 1 : 0;').comparison;
    expect(comparison.a.events.map((e) => e.kind)).not.toEqual(comparison.b.events.map((e) => e.kind));
    const long = pair('check();\n'.repeat(170), 'return x;').comparison;
    expect(long.a.status).toBe('out_of_scope');
    expect(long.a.events).toHaveLength(0);
  });
});
describe('neutral syntax music is reproducible and bounded', () => {
  it('renders finite, non-silent, non-clipping deterministic PCM using the browser sound parameters', () => {
    const { comparison } = pair('check(); save(); return 30;', 'save(); check(); return 60;');
    const plan = compileStructure(comparison, true);
    for (const segment of plan.segments) {
      const pcm = renderStructurePcm(segment);
      let peak = 0,
        energy = 0;
      for (const sample of pcm) {
        expect(Number.isFinite(sample)).toBe(true);
        peak = Math.max(peak, Math.abs(sample));
        energy += sample * sample;
      }
      expect(peak).toBeGreaterThan(0);
      expect(peak).toBeLessThan(1);
      expect(energy).toBeGreaterThan(0);
      expect(renderStructurePcm(segment)).toEqual(pcm);
    }
  });
  it('shares four unique phrases stable when A/B reverse; inversions remain audible', () => {
    const { comparison } = pair(
      'check(); save(); notify(); audit();',
      'save(); check(); audit(); notify();',
      'function check() {} function save() {} function notify() {} function audit() {}',
    );
    const plan = compileStructure(comparison);
    expect(plan.dictionary).toEqual(compileStructure(alignSyntax(comparison.b, comparison.a)).dictionary);
    expect(new Set(plan.dictionary.map((p) => p.midi.join(','))).size).toBe(4);
    expect(plan.dictionary.every((p) => p.identity === 'static_target')).toBe(true);
    const sideCalls = (side: 'A' | 'B') =>
      plan.segments.flatMap((s) =>
        s.tones
          .filter(
            (t) =>
              t.side === side &&
              comparison[side.toLowerCase() as 'a' | 'b'].events.some(
                (e) => e.kind === 'call' && e.event_id === t.event_id,
              ) &&
              t.role !== 'unknown',
          )
          .map((t) => t.midi),
      );
    expect(sideCalls('A')).not.toEqual(sideCalls('B'));
    expect(compileStructure(comparison)).toEqual(plan);
  });
  it('preserves common tones with markers; expression fallback explicitly stays uncertain', () => {
    const { comparison } = pair('return check(30);', 'return check(MAX_DAYS);');
    const plain = compileStructure(comparison),
      marked = compileStructure(comparison, true);
    expect(marked.segments.flatMap((s) => s.tones.filter((t) => t.role !== 'difference_marker'))).toEqual(
      plain.segments.flatMap((s) => s.tones),
    );
    expect(plain.dictionary[0].identity).toBe('same_expression');
    expect(plain.score_hash).not.toBe(marked.score_hash);
  });
  it('refuses dictionary overflow without colliding or deleting comparison rows', () => {
    const { comparison } = pair('a1(); a2(); a3(); a4(); a5();', 'return x;');
    const plan = compileStructure(comparison);
    expect(plan.status).toBe('dictionary_overflow');
    expect(plan.segments).toHaveLength(0);
    expect(comparison.rows.length).toBeGreaterThan(5);
  });
  it('covers every row in manual contiguous segments under 15 seconds', () => {
    const { comparison } = pair('check();'.repeat(40), 'check();'.repeat(40));
    const plan = compileStructure(comparison);
    expect(plan.segments.length).toBeGreaterThan(1);
    expect(plan.segments[0].start_row).toBe(0);
    expect(plan.segments.at(-1)!.end_row).toBe(comparison.rows.length);
    plan.segments.forEach((s, i) => {
      expect(s.duration_ms).toBeLessThanOrEqual(15000);
      if (i) expect(s.start_row).toBe(plan.segments[i - 1].end_row);
      expect(s.tones.every((t) => t.at_ms + t.duration_ms < s.duration_ms)).toBe(true);
    });
  });
});

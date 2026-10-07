import { describe, expect, it } from 'vitest';
import { indexSnapshot } from './indexer';
import { callRelationships } from './relationships';

const sources = {
  'policy.ts': `export function decide(x: number) {
  function nested() { return 'nested'; }
  if (x > 0) return { ok: true };
  return { ok: false };
}`,
  'service.ts': `import { decide as policy } from './policy';
export function run(x: number) {
  const result = policy(x);
  if (result.ok) consume(result);
  const other = (() => { const result = 'shadow'; return result; })();
  return result;
}`,
};
const input = { snapshot_id: 'snap_links', sources };
const unit = indexSnapshot(input).units.find((unit) => unit.label === 'run')!;

describe('static call, all returns and result references', () => {
  it('resolves an imported function, retains all return candidates and excludes nested returns/shadowed uses', () => {
    const result = callRelationships({ ...input, unit_span: unit.primary_span });
    const call = result.links.find((link) => link.name === 'policy')!;
    expect(call.resolution).toBe('static_definition');
    expect(call.return_spans.map((span) => span.start_line)).toEqual([3, 4]);
    expect(call.use_spans.map((span) => span.start_line)).toEqual([4, 6]);
    expect(call.result_binding).toBe('result');
    expect(call.limitations.join()).toContain('経路');
  });
  it('keeps dynamic calls, mutable results and duplicate span selections unresolved', () => {
    const dynamic = {
      snapshot_id: 'snap_dynamic',
      sources: {
        'main.ts': `export function run(client: any) { let value = client.lookup(); value = 4; return value; }`,
      },
    };
    const selected = indexSnapshot(dynamic).units[0];
    const result = callRelationships({ ...dynamic, unit_span: selected.primary_span });
    expect(result.links[0].resolution).toBe('unresolved');
    expect(result.links[0].use_status).toBe('unresolved');
    expect(result.links[0].return_spans).toEqual([]);
    expect(() =>
      callRelationships({ ...input, unit_span: { ...unit.primary_span, start_line: 99 } }),
    ).toThrow('INVALID_SELECTION');
  });
  it('discloses bounded call extraction without inventing an executed path', () => {
    const bounded = {
      snapshot_id: 'snap_bounded',
      sources: {
        'main.ts': `export function run() { ${Array.from({ length: 25 }, (_, i) => `unknown${i}();`).join('\n')} }`,
      },
    };
    const result = callRelationships({ ...bounded, unit_span: indexSnapshot(bounded).units[0].primary_span });
    expect(result.links).toHaveLength(24);
    expect(result.truncated).toBe(true);
    expect(result.links.every((link) => link.resolution === 'unresolved')).toBe(true);
  });
});

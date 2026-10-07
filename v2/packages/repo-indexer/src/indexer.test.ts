import { describe, expect, it } from 'vitest';
import { indexSnapshot } from './indexer';

describe('virtual snapshot index', () => {
  it('resolves a renamed local import and keeps external targets unresolved', () => {
    const index = indexSnapshot({
      snapshot_id: 'snap_1',
      sources: {
        'src/policy.ts': 'export function canRefund() { return true; }',
        'src/main.ts':
          "import { canRefund as check } from './policy'; import { charge } from 'unknown-package'; export function main() { return check() && charge(); }",
      },
    });
    const target = index.units.find((unit) => unit.label === 'canRefund')!;
    expect(index.relations.find((relation) => relation.name === 'check')?.callee).toBe(target.unit_id);
    expect(index.relations.find((relation) => relation.name === 'charge')?.resolved).toBe(false);
    expect(
      index.files.find((file) => file.path === 'src/main.ts')?.imports.map((item) => item.resolved),
    ).toEqual([true, false]);
  });
  it('never evaluates source or loads its tsconfig/plugins', () => {
    const index = indexSnapshot({
      snapshot_id: 'snap_safe',
      sources: {
        'unsafe.ts': "throw new Error('MUST_NOT_EXECUTE'); export const policy = () => true;",
        'tsconfig.json': '{"compilerOptions":{"plugins":[{"name":"execute-me"}]}}',
      },
    });
    expect(index.units[0].label).toBe('policy');
    expect(index.units[0].primary_span.path).toBe('unsafe.ts');
  });
});

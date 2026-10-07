import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Bundle } from '../apps/web/src/api';
import type { CallRelationships } from '../packages/contracts/CallRelationships';
import { staticDemoApi, staticDemoAsset } from '../apps/web/src/staticDemoApi';

const directory = 'apps/web/public/demo-data';
const read = <T>(filename: string): T => JSON.parse(readFileSync(`${directory}/${filename}`, 'utf8')) as T;

afterEach(() => vi.unstubAllGlobals());

describe('static demo API', () => {
  it('routes only recorded GET data and never sends writes to a live backend', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ data: { live_enabled: false } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(staticDemoApi('/config')).resolves.toEqual({ live_enabled: false });
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/demo-data/config.json'));
    await expect(staticDemoApi('/projects', {}, 'POST')).rejects.toThrow('保存済みの結果');
    await expect(staticDemoApi('/projects/private/bundle')).rejects.toThrow('保存済みデータ');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(staticDemoAsset('/samples/recorded-returns-before/bundle')?.filename).toBe(
      'recorded-returns-before.bundle.json',
    );
    expect(staticDemoAsset('/samples/recorded-returns-before/relationships?unit_id=../../x')).toBeNull();
  });

  for (const sampleId of ['recorded-returns-before', 'recorded-returns-after']) {
    it(`ships a complete ${sampleId} bundle, relationship set, and structure pairs`, () => {
      const bundle = read<{ data: Bundle }>(`${sampleId}.bundle.json`).data;
      const inventory = read<{
        data: { snapshot_id: string; units: { unit_id: string }[] };
      }>(`${sampleId}.structure.json`).data;
      expect(bundle.map.snapshot_id).toBe(inventory.snapshot_id);
      expect(inventory.units.map((unit) => unit.unit_id)).toEqual(
        bundle.map.units.map((unit) => unit.unit_id),
      );

      for (const unit of bundle.map.units) {
        const asset = staticDemoAsset(`/samples/${sampleId}/relationships?unit_id=${unit.unit_id}`);
        expect(asset).not.toBeNull();
        const relationship = read<{ data: CallRelationships }>(asset!.filename).data;
        expect(relationship.snapshot_id).toBe(bundle.map.snapshot_id);
        expect(relationship.unit_span).toMatchObject(unit.primary_span);
      }

      for (const left of inventory.units) {
        for (const right of inventory.units) {
          if (left.unit_id === right.unit_id) continue;
          for (const markers of [false, true]) {
            const asset = staticDemoAsset(
              `/samples/${sampleId}/structure?unit_a=${left.unit_id}&unit_b=${right.unit_id}&markers=${markers}`,
            );
            expect(asset).not.toBeNull();
            const pair = read<{
              data: { comparison: { a: { unit_id: string }; b: { unit_id: string } }; playback: unknown };
            }>(asset!.filename).data;
            expect(pair.comparison.a.unit_id).toBe(left.unit_id);
            expect(pair.comparison.b.unit_id).toBe(right.unit_id);
            expect(pair.playback).toBeDefined();
          }
        }
      }
    });
  }
});

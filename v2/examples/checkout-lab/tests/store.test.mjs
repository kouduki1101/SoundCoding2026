import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { LocalOrderStore } from '../dist/server.mjs';

test('concurrent checkout retries persist exactly once across server restart', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'checkout-lab-'));
  try {
    const file = join(directory, 'orders.json');
    const store = new LocalOrderStore(file);
    await store.load();
    const record = {
      requestId: 'retry',
      items: [{ sku: 'field-notes', quantity: 2 }],
      invoice: {
        subtotalCents: 4800,
        discountCents: 800,
        deliveryCents: 300,
        totalCents: 4300,
        campaignCode: 'READ',
      },
      reward: null,
    };
    const [one, two] = await Promise.all([store.saveOnce(record), store.saveOnce(record)]);
    assert.equal(one.orderId, two.orderId);
    const restarted = new LocalOrderStore(file);
    await restarted.load();
    assert.equal(restarted.list().length, 1);
    assert.equal((await restarted.saveOnce(record)).orderId, one.orderId);
    await assert.rejects(
      () => restarted.saveOnce({ ...record, items: [{ sku: 'field-notes', quantity: 3 }] }),
      /注文ID/,
    );
  } finally {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(basename(directory).startsWith('checkout-lab-'));
    await rm(directory, { recursive: true, force: true });
  }
});

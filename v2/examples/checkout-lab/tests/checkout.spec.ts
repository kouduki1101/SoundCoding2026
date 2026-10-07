import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

test('real cart calculates offline, confirms on the server and shows a persistent receipt', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('#total')).toHaveText('$27.00');
  await page.getByRole('combobox', { name: 'Field Notesの数量' }).selectOption('2');
  await page.getByRole('combobox', { name: 'Gift Cardの数量' }).selectOption('1');
  await expect(page.locator('#total')).toHaveText('$63.00');
  await expect(page.locator('#discount')).toHaveText('−$8.00');
  await page.context().setOffline(true);
  await page.getByRole('combobox', { name: 'クーポン', exact: true }).selectOption('OLD');
  await expect(page.locator('#total')).toHaveText('$71.00');
  await page.getByRole('button', { name: '注文を確定する' }).click();
  await expect(page.getByRole('status')).toContainText('カートは保持しています');
  await page.context().setOffline(false);
  await page.getByRole('combobox', { name: 'クーポン', exact: true }).selectOption('READ');
  await page.getByRole('button', { name: '注文を確定する' }).click();
  await expect(page.getByRole('status')).toContainText('注文を保存しました · $63.00');
  await expect(page.locator('#orders li').first()).toContainText('40 points');
  await page.reload();
  await expect(page.locator('#orders')).toContainText('$63.00');
  await page.screenshot({
    path: resolve(import.meta.dirname, '../../../artifacts/checkout-lab-r8.png'),
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test('server rejects tampering and cross-origin writes, and retries do not create a second order', async ({
  request,
}) => {
  const order = {
    requestId: randomUUID(),
    items: [{ sku: 'field-notes', quantity: 2 }],
    member: false,
    campaignCode: 'READ',
  };
  const one = await request.post('/api/orders', { data: order });
  expect(one.status()).toBe(200);
  const saved = await one.json();
  expect(saved.totalCents).toBe(4300);
  expect((await (await request.post('/api/orders', { data: order })).json()).orderId).toBe(saved.orderId);
  expect((await request.post('/api/orders', { data: { ...order, member: true } })).status()).toBe(409);
  expect(
    (
      await request.post('/api/orders', {
        data: { ...order, items: [{ sku: 'field-notes', quantity: 2, unitPriceCents: 1 }] },
      })
    ).status(),
  ).toBe(400);
  expect(
    (
      await request.post('/api/orders', { data: order, headers: { Origin: 'https://untrusted.example' } })
    ).status(),
  ).toBe(403);
  expect(
    (
      await request.post('/api/orders', { data: { ...order, items: [{ sku: 'unknown', quantity: 1 }] } })
    ).status(),
  ).toBe(400);
  expect(
    (
      await request.post('/api/orders', { data: { ...order, items: [{ sku: 'gift-card', quantity: 100 }] } })
    ).status(),
  ).toBe(400);
  expect((await request.get('/source/../../.env')).status()).toBe(404);
  const source = await request.get('/source/checkout.ts');
  expect(await source.text()).toBe(
    readFileSync(
      resolve(import.meta.dirname, '../../../fixtures/repos/checkout-flow/src/checkout.ts'),
      'utf8',
    ),
  );
  const headers = source.headers();
  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
});

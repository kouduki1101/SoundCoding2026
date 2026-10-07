import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('code-groove-hide-guide', 'true'));
});

test('call, all return candidates and static result uses remain source-linked and read-only', async ({
  page,
}) => {
  const writes: string[] = [],
    errors: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().includes('/api/v1/')) writes.push(request.url());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/projects/sample-recorded-checkout-flow/inspect');
  await page.getByRole('button', { name: 'checkout.ts', exact: true }).click();
  const panel = page.locator('.call-relationships');
  await panel.locator('summary').click();
  const selector = panel.getByRole('combobox', { name: '呼出箇所', exact: true });
  await expect(selector).toBeVisible();
  const option = selector.locator('option').filter({ hasText: /^quoteInvoice ·/ });
  await selector.selectOption((await option.getAttribute('value'))!);
  const relation = panel.getByTestId('call-relationship');
  await expect(relation).toContainText('相手の静的な定義');
  await expect(relation).toContainText('返却候補 · 1箇所');
  await expect(relation).toContainText('invoice');
  await expect(relation).toContainText('経路・返却値・呼出回数は未確認');
  await relation.getByRole('button', { name: /^返却候補1 ·/ }).click();
  await expect(page.getByTestId('code-location')).toContainText('pricing.ts:26–32');
  await expect(page.locator('.code-highlight')).not.toHaveCount(0);
  await relation.getByRole('button', { name: '関連する意味イベントだけ聴く', exact: true }).click();
  await expect(page.getByTestId('audition-status')).toContainText('試聴中');
  await relation.getByRole('button', { name: '関係の試聴を取消', exact: true }).click();
  const unresolved = selector.locator('option').filter({ hasText: /store.saveOnce ·/ });
  await selector.selectOption((await unresolved.getAttribute('value'))!);
  await expect(relation).toContainText('相手の定義は未解決');
  for (const width of [1440, 980]) {
    await page.setViewportSize({ width, height: 720 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.screenshot({ path: 'artifacts/static-call-relationships-recorded.png' });
  expect(writes).toEqual([]);
  expect(errors).toEqual([]);
});

test('Python relationship inspection uses the saved snapshot without a model call', async ({ page }) => {
  await page.goto('/projects/sample-recorded-tsugiai-agents/inspect');
  const panel = page.locator('.call-relationships');
  await panel.locator('summary').click();
  await expect(panel).toContainText('Pythonの静的定義');
  await expect(panel).toContainText('実行時の流れではありません');
  await expect(panel.getByRole('alert')).toHaveCount(0);
});

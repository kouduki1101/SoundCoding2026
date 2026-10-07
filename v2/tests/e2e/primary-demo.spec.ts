import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

test('recorded rehearsal guides the listener from the changed call to code and a review question without model requests', async ({
  page,
}) => {
  let writes = 0;
  const errors: string[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().includes('/api/v1/')) writes++;
  });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/projects/sample-recorded-returns-before/inspect');
  const rehearsal = page.getByRole('main', { name: '返品レビューのリハーサル' });
  await expect(rehearsal).toBeVisible();
  await expect(rehearsal.getByRole('dialog')).toHaveCount(0);
  await expect(rehearsal.getByRole('button', { name: /前 → 後を聴く/ })).toBeEnabled();
  await expect(rehearsal.getByRole('region', { name: '変更の説明' })).toContainText('quoteWebReturn');
  await expect(rehearsal.getByRole('region', { name: '変更後の根拠コード' })).toContainText('evaluateReturnPolicy');
  await rehearsal.getByRole('button', { name: '店舗返品' }).click();
  await expect(rehearsal.getByRole('region', { name: '変更の説明' })).toContainText('quoteStoreReturn');
  await expect(rehearsal.getByRole('region', { name: '変更前の根拠コード' })).toContainText('store-return.ts');
  await rehearsal.getByRole('textbox', { name: 'レビューの問い' }).fill('共通化後も店舗の例外条件を保持しますか？');
  await expect(rehearsal.getByRole('button', { name: 'Markdownをコピー' })).toBeEnabled();
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1280, height: 720 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(rehearsal).toBeVisible();
    await expect(rehearsal.getByRole('button', { name: /前 → 後を聴く/ })).toBeVisible();
  }
  expect(writes).toBe(0);
  expect(errors).toEqual([]);
});

test('unknown-only analysis preserves its limits and disables playback (mock API)', async ({ page }) => {
  const bundle = JSON.parse(readFileSync('fixtures/recorded-live/returns-before.json', 'utf8'));
  bundle.map.origin = 'fixture';
  bundle.map.profile.title = '模擬の判断保留';
  bundle.map.profile.unknowns = ['この模擬結果では変更理由を確定できません'];
  bundle.map.events = [];
  bundle.map.responsibilities = [];
  bundle.map.review_signals = [];
  bundle.score.scenes = [];
  let writes = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().includes('/api/v1/')) writes++;
  });
  await page.route('**/api/v1/samples/recorded-returns-before/bundle', (route) =>
    route.fulfill({ json: { data: bundle } }),
  );
  await page.goto('/projects/sample-recorded-returns-before/inspect');
  await expect(page.getByRole('heading', { name: '判断を保留しました' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toHaveCount(0);
  await expect(page.locator('.analysis-progress')).toContainText('無音は良い設計を意味しません');
  await expect(page.locator('.analysis-progress')).toContainText('この模擬結果では変更理由を確定できません');
  expect(writes).toBe(0);
});

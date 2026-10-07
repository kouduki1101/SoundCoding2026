import { expect, test } from '@playwright/test';

test('a reviewer hears a grounded before/after connection and keeps a source-linked question', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  let writes = 0;
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    if (request.url().includes('/api/v1/') && request.method() !== 'GET') writes++;
  });
  await page.addInitScript(() => localStorage.setItem('code-groove-hide-guide', 'true'));
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/projects/sample-recorded-returns-before/inspect');
  await expect(page.getByRole('heading', { name: '呼ぶ相手の変化を、耳から確かめる。' })).toBeVisible();
  await expect(page.locator('.rehearsal-source')).toHaveCount(2);
  await expect(page.locator('.rehearsal-source').first()).toContainText('quoteWebReturn');
  await expect(page.locator('.rehearsal-source').last()).toContainText('evaluateReturnPolicy');
  const play = page.getByRole('button', { name: /前 → 後を聴く/ });
  await expect(play).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath('rehearsal-desktop.png'), fullPage: true });

  await play.click();
  await expect(page.locator('.rehearsal-now')).toContainText('変更前');
  await expect(page.locator('.rehearsal-source.is-active')).toContainText('変更前');
  await page.getByRole('button', { name: '停止' }).click();

  await page.getByRole('button', { name: '店舗返品' }).click();
  await expect(page.locator('.rehearsal-flow')).toContainText('quoteStoreReturn');
  await expect(page.locator('.rehearsal-source').first()).toContainText('quoteStoreReturn');
  await expect(play).toBeEnabled();
  await page.getByRole('textbox', { name: 'レビューの問い' }).fill('店舗の例外条件は共通関数にも残っていますか？');
  await page.getByRole('button', { name: 'Markdownをコピー' }).click();
  await expect(page.locator('.rehearsal-question [role="status"]')).toBeVisible();
  expect(writes).toBe(0);
  expect(errors).toEqual([]);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.rehearsal-source')).toHaveCount(2);
  await page.screenshot({ path: testInfo.outputPath('rehearsal-mobile.png'), fullPage: true });
});

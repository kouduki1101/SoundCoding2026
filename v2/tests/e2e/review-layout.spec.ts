import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('code-groove-hide-guide', 'true'));
});

test('central workspace prioritizes the selected source and keeps secondary controls out of the timeline', async ({
  page,
}) => {
  let writes = 0;
  const errors: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().includes('/api/v1/')) writes++;
  });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(
    '/projects/sample-recorded-tsugiai-agents/inspect?scene=1&unit=unit_3f3016ef7d0fb08b&event=evnt_complete_session',
  );
  await expect(page.getByTestId('code-location')).toContainText('tools.py:199–216');
  await expect(page.locator('.monaco-editor')).toBeVisible();
  for (const viewport of [
    { width: 1920, height: 1010 },
    { width: 1440, height: 900 },
    { width: 1280, height: 720 },
    { width: 980, height: 600 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(page.locator('.review-focus-list')).toBeHidden();
    await expect(page.locator('.composer-track.selected-track')).toBeInViewport();
    await expect(page.getByRole('textbox', { name: '選択した範囲への質問' })).toBeInViewport();
    await expect
      .poll(() =>
        page.evaluate(() => {
          const center = document.querySelector('.review-center')!.getBoundingClientRect();
          const editor = document.querySelector('.monaco-editor')!.getBoundingClientRect();
          const selected = document.querySelector('.selected-track')!.getBoundingClientRect();
          const first = document.querySelector('.composer-track')!.getBoundingClientRect();
          const tracks = document.querySelector('.arrangement-tracks')!.getBoundingClientRect();
          return (
            editor.height > center.height * 0.36 &&
            selected.top >= tracks.top - 1 &&
            selected.bottom <= tracks.bottom + 1 &&
            first.top >= tracks.top - 1
          );
        }),
      )
      .toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({
      path: `artifacts/${process.env.E2E_BASE_URL ? 'deployed' : 'local'}-center-r17-${viewport.width}.png`,
    });
  }
  await page.locator('.review-focus summary').click();
  await expect(page.locator('.review-focus-list')).toBeVisible();
  await expect(page.locator('.review-focus-list')).toContainText('反証未確認');
  await page.locator('.review-focus-item').last().getByRole('button', { name: '根拠行' }).click();
  await expect(page.locator('.review-focus-list')).toBeHidden();
  await expect(page.getByTestId('code-location')).toContainText('tools.py:13–17');
  await page.locator('.event-navigation summary').focus();
  await page.keyboard.press('Enter');
  const eventMenu = page.locator('.event-navigation');
  await expect(eventMenu.locator('button').first()).toBeVisible();
  await eventMenu.locator('button').first().focus();
  await page.keyboard.press('Enter');
  await expect(eventMenu.locator('div')).toBeHidden();
  await expect(eventMenu.locator('summary')).toBeFocused();
  await page.locator('.review-focus summary').click();
  await page.locator('.review-focus-item').first().getByRole('button').first().focus();
  await page.keyboard.press('Escape');
  await expect(page.locator('.review-focus-list')).toBeHidden();
  await expect(page.locator('.review-focus summary')).toBeFocused();
  await page.locator('.playback-settings summary').click();
  await page.getByRole('button', { name: '伴奏トラックを表示', exact: true }).click();
  await page.locator('.playback-settings summary').click();
  await expect(page.locator('.arrangement-backing')).toBeVisible();
  expect(
    await page.evaluate(() => {
      const locator = document.querySelector('.composer-now')!.getBoundingClientRect();
      const source = document.querySelector('.code-panel .panel-heading')!.getBoundingClientRect();
      return locator.bottom <= source.top + 1;
    }),
  ).toBe(true);
  await page.getByRole('button', { name: 'ダークモードに切り替え', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByTestId('code-location')).toBeInViewport();
  await page.screenshot({
    path: `artifacts/${process.env.E2E_BASE_URL ? 'deployed' : 'local'}-center-r17-dark-backing.png`,
  });
  expect(writes).toBe(0);
  expect(errors).toEqual([]);
});

import { test, expect } from '@playwright/test';

test('real scoped recording connects notes, source receipts and honest provenance without paid requests', async ({
  page,
}) => {
  const errors: string[] = [];
  let writes = 0;
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().includes('/api/v1/')) writes++;
  });
  await page.goto('/projects/sample-recorded-tsugiai-agents/inspect?scene=1');


  await expect(page.getByTestId('case-provenance')).toContainText('1/3 範囲に保存結果');
  await page.getByTestId('case-provenance').locator('summary').click();
  await expect(page.getByTestId('case-provenance')).toContainText('35a951488d7b');
  await expect(page.getByTestId('case-provenance')).toContainText('実行動作は未検証');
  await expect(page.getByTestId('case-provenance').getByRole('link')).toHaveAttribute(
    'href',
    /35a951488d7b00518e7e73a329d46713cbeacbe8/,
  );
  await page.getByTestId('case-provenance').locator('summary').click();
  await page.getByTestId('data-note').first().click();
  await page.getByTestId('selected-evidence').locator('summary').click();
  await expect(page.getByTestId('selected-evidence')).toContainText('Agentの読取記録 #');
  await page.getByTestId('selected-evidence').getByRole('button').first().click();
  await expect(page.locator('.monaco-editor')).toBeVisible({ timeout: 20000 });
  await expect(page.locator('.code-panel .panel-heading')).toContainText('agents/checkout_agent/agent.py');
  await expect(page.locator('.code-highlight')).not.toHaveCount(0);
  for (const width of [1440, 1280, 980]) {
    await page.setViewportSize({ width, height: width === 980 ? 600 : 900 });
    await expect(page.getByRole('button', { name: '選択箇所の保存された説明を見る' })).toBeInViewport();
    await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeInViewport();
    const bounds = await page.evaluate(() => [
      document.documentElement.scrollWidth,
      innerWidth,
      document.documentElement.scrollHeight,
      innerHeight,
    ]);
    expect(bounds[0]).toBe(bounds[1]);
    expect(bounds[2]).toBe(bounds[3]);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({
    path: process.env.E2E_BASE_URL
      ? 'artifacts/deployed-tsugiai-r17.png'
      : 'artifacts/tsugiai-r17-evidence.png',
  });
  await page.getByRole('button', { name: 'PR / Repositoryを開く', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByTestId('analysis-budget')).toContainText('1ユーザー1日10回');
  await expect(dialog.getByTestId('analysis-budget')).toContainText('日本時間09:00');
  const close = dialog.getByRole('button', { name: '閉じる', exact: true });
  await close.focus();
  await close.press('Shift+Tab');
  await expect(dialog.getByRole('button').last()).toBeFocused();
  await dialog.getByRole('button').last().press('Tab');
  await expect(close).toBeFocused();
  await close.press('Escape');
  await expect(dialog).toHaveCount(0);
  expect(writes).toBe(0);
  expect(errors).toEqual([]);
});

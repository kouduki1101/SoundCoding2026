import { test, expect } from '@playwright/test';

test('recorded Gemini evidence is replayable without sign-in or new model calls', async ({ page }) => {
  let modelRuns = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && /\/api\/v1\//.test(request.url())) modelRuns++;
  });
  await page.goto('/projects/sample-recorded-justified/arrange?scene=1');


  await expect(page.getByTestId('analysis-origin')).toContainText('保存済み実解析');
  await page.getByTestId('data-note').first().click();
  await expect(page.locator('.monaco-editor')).toBeVisible({ timeout: 20000 });
  await expect(page.getByText('Gemini Agent', { exact: true })).toBeVisible();
  await expect(page.locator('.finding-label').filter({ hasText: '理由のある違い' })).toBeVisible();
  await page.locator('.finding .evidence-link').first().click();
  await expect(page.locator('.monaco-editor')).toBeVisible();
  await page.getByText(/Agentの実行記録/).click();
  await expect(page.getByText('read_code', { exact: true }).first()).toBeVisible();
  expect(modelRuns).toBe(0);
});

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';

test.use({ trace: 'off' });
test('reviewer sign-in, saved live source and real investigation', async ({ page }) => {
  test.skip(process.env.E2E_LIVE !== '1', 'Paid deployed flow is explicitly opt-in.');
  const reviewerEmail = process.env.CG_REVIEWER_EMAIL;
  const reviewerSecret = process.env.CG_REVIEWER_PASSWORD_SECRET;
  if (!reviewerEmail || !reviewerSecret) throw new Error('Private reviewer configuration is required.');
  test.setTimeout(240000);
  const deployment = JSON.parse(readFileSync('artifacts/deployed-smoke.json', 'utf8'));
  const password = execFileSync(
    process.platform === 'win32' ? 'gcloud.cmd' : 'gcloud',
    [
      'secrets',
      'versions',
      'access',
      'latest',
      `--secret=${reviewerSecret}`,
      '--project=artful-bonsai-491601-p3',
    ],
    { encoding: 'utf8', shell: process.platform === 'win32' },
  ).trim();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');


  await page.getByRole('button', { name: 'ログイン', exact: true }).click();
  await page.getByLabel('メールアドレス', { exact: true }).fill(reviewerEmail);
  await page.getByLabel('パスワード', { exact: true }).fill(password);
  await page.getByRole('dialog').getByRole('button', { name: 'ログイン', exact: true }).click();
  await expect(page.getByRole('button', { name: 'ログイン', exact: true })).not.toBeVisible();
  await page.goto(`/projects/${deployment.project_id}/arrange?analysis=${deployment.analysis_id}&scene=1`);
  await expect(page.getByTestId('data-note').first()).toBeVisible({ timeout: 30000 });
  await page.getByTestId('data-note').first().click();
  await expect(page.locator('.monaco-editor')).toBeVisible({ timeout: 30000 });
  await expect(page.getByTestId('analysis-origin')).toContainText('実解析');
  await page
    .getByRole('textbox', { name: '選択した範囲への質問' })
    .fill('このフレーズの意味と、設計上の違いが正当化される理由を調べてください。');
  await page.getByRole('button', { name: '質問を送信' }).click();
  await expect(page.locator('.finding')).toBeVisible({ timeout: 180000 });
  await expect(page.locator('.finding .evidence-link').first()).toBeVisible();
  await page.locator('.finding .evidence-link').first().click();
  await page.screenshot({ path: 'artifacts/deployed-live-inspect.png' });
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.screenshot({ path: 'artifacts/deployed-live-arrange.png' });
  expect(errors).toEqual([]);
});

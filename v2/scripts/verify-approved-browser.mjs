import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { URL } from 'node:url';
import { chromium, expect } from '@playwright/test';

const reviewerEmail = process.env.CG_REVIEWER_EMAIL;
  const reviewerSecret = process.env.CG_REVIEWER_PASSWORD_SECRET;
  if (!reviewerEmail || !reviewerSecret) throw new Error('Private reviewer configuration is required.');
const proof = JSON.parse(readFileSync('artifacts/deployed-r4-hitl.json', 'utf8'));
const url = process.env.E2E_BASE_URL ?? 'https://code-groove-web-a5ygiois2a-an.a.run.app';
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
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(15000);
const errors = [],
  posts = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('request', (request) => {
  if (request.method() === 'POST' && request.url().includes('/api/v1/'))
    posts.push(new URL(request.url()).pathname);
});
try {
  await page.goto(`${url}/projects/sample-recorded-returns-before/inspect?scene=1`);
  console.log('Public workspace loaded.');
  await page.getByRole('checkbox', { name: '今後このメッセージを表示しない', exact: true }).check();
  await page.getByRole('button', { name: 'あとで見る', exact: true }).click();
  await page.getByRole('button', { name: 'ログイン', exact: true }).click();
  await page.getByLabel('メールアドレス', { exact: true }).fill(reviewerEmail);
  await page.getByLabel('パスワード', { exact: true }).fill(password);
  await page.getByRole('dialog').getByRole('button', { name: 'ログイン', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  console.log('Reviewer signed in.');
  await page.goto(`${url}/projects/${proof.project_id}/inspect?scene=1&analysis=${proof.after_analysis_id}`);
  await expect(page.getByRole('button', { name: '採用後', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.locator('.monaco-editor')).toBeVisible();
  console.log('Approved source loaded.');
  const trace = page.getByText(`Agentの実行記録 · ${proof.reanalysis.tool_calls}回のツール調査`);
  await expect(trace).toBeVisible();
  await trace.click();
  await expect(page.getByText('read_code', { exact: true }).first()).toBeVisible();
  await page.screenshot({ path: 'artifacts/deployed-r4-final.png' });
  await expect(page.getByText(/追加調査の記録/)).toHaveCount(0);
  await expect(page.getByRole('button', { name: '変更前', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
  expect(posts).toEqual([]);
  writeFileSync(
    'artifacts/deployed-r4-saved-browser.json',
    JSON.stringify(
      {
        status: 'PASS',
        page_errors: errors,
        application_posts: posts,
        initial_tool_calls: proof.reanalysis.tool_calls,
        before_after_available: true,
        new_model_calls: 0,
      },
      null,
      2,
    ),
  );
  console.log('Saved approved work, initial Agent trace and comparison PASS; zero application POSTs.');
} finally {
  await browser.close();
}

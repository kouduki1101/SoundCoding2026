import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('code-groove-hide-guide', 'true'));
});

test('timeline marks open observations, counter state and unknowns without an API write', async ({
  page,
}) => {
  let writes = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().includes('/api/v1/')) writes++;
  });
  await page.goto('/projects/sample-recorded-tsugiai-agents/inspect');
  await page.getByTestId('candidate-mark').first().click();
  const details = page.getByTestId('candidate-details');
  await expect(details).toContainText('観察した違い');
  await expect(details).toContainText('別の説明と確認状態');
  await expect(details).toContainText('未確認事項');
  await expect(details).toContainText('反証未確認');
  await expect(page.getByTestId('code-location')).toBeVisible();
  await expect(page.locator('.monaco-editor .code-highlight')).not.toHaveCount(0);
  expect(writes).toBe(0);
});

test('focus completion and cancellation preserve all playback settings and permit full playback', async ({
  page,
}) => {
  await page.goto('/projects/sample-recorded-tsugiai-agents/inspect');
  await page.getByRole('combobox', { name: '再生範囲', exact: true }).selectOption('file');
  await page.locator('.playback-settings summary').click();
  await page.getByRole('button', { name: 'Loop', exact: true }).click();
  await page.getByRole('button', { name: 'Melody', exact: true }).click();
  await page.getByRole('button', { name: '演奏に追従', exact: true }).click();
  await page.locator('.playback-settings summary').click();
  const settings = () =>
    page.evaluate(() => {
      const state = JSON.parse(localStorage.getItem('code-groove-workspace-v1')!).state;
      return Object.fromEntries(
        [
          'volume',
          'loop',
          'muted',
          'solo',
          'pulseMuted',
          'instrumentMutes',
          'focusEvidence',
          'playbackFile',
          'wholeWork',
          'following',
        ].map((key) => [key, state[key]]),
      );
    });
  const before = await settings();
  for (const cancel of [true, false]) {
    await page.locator('.review-focus summary').click();
    await page.locator('.review-focus-item').last().getByRole('button', { name: '伴奏なしで聴く' }).click();
    await expect(page.getByTestId('audition-status')).toContainText('試聴中');
    expect(await settings()).toEqual(before);
    if (cancel) await page.getByRole('button', { name: '試聴を取消', exact: true }).click();
    await expect(page.getByRole('button', { name: '試聴を取消', exact: true })).toHaveCount(0, {
      timeout: 13000,
    });
    expect(await settings()).toEqual(before);
    await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
  }
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
});

test('audio failure restores configuration; justified, deferred and uninvestigated remain distinct (mock)', async ({
  page,
}) => {
  const bundle = JSON.parse(readFileSync('fixtures/recorded-live/tsugiai-agents.json', 'utf8'));
  bundle.map.origin = 'fixture';
  bundle.map.review_signals[0].verdict = 'justified';
  bundle.map.review_signals[0].counter_status = 'supported';
  bundle.map.review_signals[1].verdict = 'inconclusive';
  bundle.map.review_signals[1].counter_status = 'undetermined';
  await page.route('**/api/v1/samples/recorded-tsugiai-agents/bundle', (route) =>
    route.fulfill({ json: { data: bundle } }),
  );
  await page.route('**/audio/**/manifest.json', (route) =>
    route.fulfill({ status: 503, body: 'unavailable' }),
  );
  await page.goto('/projects/sample-recorded-tsugiai-agents/inspect');
  await page.locator('.review-focus summary').click();
  await expect(page.locator('.review-focus-item').first()).toContainText('理由のある違い');
  await expect(page.locator('.review-focus-item').nth(1)).toContainText('判断保留');
  const before = await page.evaluate(
    () => JSON.parse(localStorage.getItem('code-groove-workspace-v1')!).state,
  );
  await page.locator('.review-focus-item').first().getByRole('button', { name: '伴奏なしで聴く' }).click();
  await expect(page.locator('.review-focus').getByRole('alert')).toContainText('根拠行は音なし');
  const after = await page.evaluate(
    () => JSON.parse(localStorage.getItem('code-groove-workspace-v1')!).state,
  );
  for (const key of ['loop', 'muted', 'solo', 'instrumentMutes', 'focusEvidence', 'volume', 'following'])
    expect(after[key]).toEqual(before[key]);
  await page.locator('.review-focus-item').nth(1).getByRole('button', { name: '根拠行' }).click();
  await expect(page.getByTestId('candidate-details')).toContainText('判断保留');
  await expect(page.locator('.file-scope')).toContainText('解析済み');
});

test('two small implementations compare the recorded responsibility melody with equal range and no writes', async ({
  page,
}) => {
  let writes = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().includes('/api/v1/')) writes++;
  });
  await page.goto('/projects/sample-scattered/inspect');
  await page.getByRole('button', { name: /Agentの説明を二関数で問い直す/ }).click();
  const dialog = page.getByRole('dialog', { name: '構造を比較して聴く' });
  const peer = dialog
    .getByLabel('Bの関数', { exact: true })
    .locator('option')
    .filter({ hasText: /^refundOnline ·/ });
  await dialog.getByLabel('Bの関数', { exact: true }).selectOption((await peer.getAttribute('value'))!);
  const comparison = dialog.getByRole('region', { name: '責務の旋律で比較' });
  await expect(comparison).toContainText('96 BPM');
  await expect(comparison).toContainText('両側とも先頭');
  await expect(comparison).toContainText('対応不明');
  await comparison.getByRole('button', { name: '責務のA→Bを聴く', exact: true }).click();
  await expect(comparison.getByRole('status')).toContainText('責務を試聴中');
  await expect(dialog.locator('.structure-source mark')).not.toHaveCount(0);
  await comparison.getByRole('button', { name: '責務の試聴を取消' }).click();
  await expect(comparison.getByRole('status')).toHaveText('停止中');
  await expect(comparison).toContainText('項目:0件（対応不明）');
  await expect(comparison.getByText('対応不明の箇所を見る', { exact: true })).toHaveCount(0);
  await dialog.getByRole('checkbox', { name: '音を使う', exact: true }).uncheck();
  await expect(comparison.getByRole('button', { name: '責務のAを聴く', exact: true })).toBeDisabled();
  await dialog.locator('.structure-rows button').first().click();
  await expect(dialog.locator('.structure-source mark')).not.toHaveCount(0);
  await page.screenshot({ path: 'artifacts/responsibility-comparison-small-fixture.png' });
  const unmatched = dialog
    .getByLabel('Bの関数', { exact: true })
    .locator('option')
    .filter({ hasText: /^buildNotification ·/ });
  await dialog.getByLabel('Bの関数', { exact: true }).selectOption((await unmatched.getAttribute('value'))!);
  await comparison.getByText('対応不明の箇所を見る', { exact: true }).click();
  await comparison
    .getByRole('button', { name: /行（対応不明）/ })
    .first()
    .click();
  await expect(dialog.locator('.structure-source mark')).not.toHaveCount(0);
  await page.screenshot({ path: 'artifacts/responsibility-comparison-unmatched-fixture.png' });
  expect(writes).toBe(0);
});

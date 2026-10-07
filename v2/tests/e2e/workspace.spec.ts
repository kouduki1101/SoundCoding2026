import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

test('selected-file listening, supporting files and theme switching preserve the workspace', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/projects/sample-recorded-checkout-flow/inspect?scene=1');


  await page.getByRole('button', { name: 'pricing.ts', exact: true }).click();
  async function expectContinuousCodeClips() {
    const clips = await page.locator('.midi-clip').evaluateAll((elements) =>
      elements
        .map((element) => ({
          start: parseFloat((element as HTMLElement).style.left),
          length: parseFloat((element as HTMLElement).style.width),
        }))
        .sort((a, b) => a.start - b.start),
    );
    expect(clips.length).toBeGreaterThan(0);
    let end = 0;
    for (const clip of clips) {
      expect(clip.start).toBeCloseTo(end);
      end += clip.length;
    }
    expect(end).toBeCloseTo(100);
  }
  await expectContinuousCodeClips();
  const fullLength = await page.locator('.time-display small').innerText();
  await page.getByRole('combobox', { name: '再生範囲', exact: true }).selectOption('file');
  await expect(page.locator('.time-display small')).not.toHaveText(fullLength);
  await expectContinuousCodeClips();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  await expect.poll(() => page.locator('.time-display b').innerText()).not.toBe('00:00');
  await page.getByRole('button', { name: 'contracts.ts', exact: true }).click();
  await expect(page.locator('.monaco-editor')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'rewards.ts', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeEnabled();
  await expect(page.locator('.code-panel .panel-heading')).toContainText('rewards.ts');
  await page.getByRole('combobox', { name: '再生範囲', exact: true }).selectOption('all');
  await expect(page.locator('.time-display small')).toHaveText(fullLength);
  await page.getByRole('button', { name: 'ダークモードに切り替え', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.screenshot({ path: 'artifacts/workspace-r14-dark.png' });
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: 'ライトモードに切り替え', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('footer.statusbar')).toHaveCount(0);
  await expect(page.locator('.file-scope summary')).toContainText('解析済み 13/13 実装');
  const width = await page.locator('.review-center').evaluate((e) => e.getBoundingClientRect().width);
  const question = page.getByRole('button', { name: '選択箇所の保存された説明を見る' });
  await question.click();
  await page.getByRole('button', { name: 'Agentを閉じる', exact: true }).click();
  await expect(question).toBeHidden();
  expect(
    await page.locator('.review-center').evaluate((e) => e.getBoundingClientRect().width),
  ).toBeGreaterThan(width + 250);
  await page.getByRole('button', { name: 'Agentを開く', exact: true }).press('Space');
  await expect(page.locator('.saved-answer')).toContainText('新しいモデル呼び出しなし');
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Agentを閉じる', exact: true }).click();
  await page.reload();
  await expect(question).toBeHidden();
  await page.getByRole('button', { name: 'Agentを開く', exact: true }).click();
  await page.getByText('サンプル', { exact: true }).click();
  await expect(page.locator('.sample-menu')).toContainText('対象外');
  const download = await page.request.get('/samples/checkout-lab.zip');
  expect(download.status()).toBe(200);
  expect((await download.body()).subarray(0, 2).toString()).toBe('PK');
  expect(errors).toEqual([]);
});

test('whole-work playback continues when code selection crosses scenes', async ({ page }) => {
  const fixture = JSON.parse(readFileSync('fixtures/recorded-live/returns-before.json', 'utf8'));
  fixture.map.origin = 'fixture';
  const original = fixture.score.scenes[0],
    splitBar = original.repo.phrases[1].start_bar,
    cut = splitBar * 1920;
  fixture.score.scenes = [0, 1].map((index) => {
    const first = index === 0,
      start = first ? 0 : cut;
    const repo = structuredClone(original.repo);
    repo.scene_id = `scene_${index + 1}`;
    repo.total_bars = first ? splitBar : original.repo.total_bars - splitBar;
    repo.notes = repo.notes
      .filter((n: { tick: number }) => (first ? n.tick < cut : n.tick >= cut))
      .map((n: { tick: number }) => ({ ...n, tick: n.tick - start }));
    repo.phrases = repo.phrases
      .filter((p: { start_bar: number }) => (first ? p.start_bar < splitBar : p.start_bar >= splitBar))
      .map((p: { start_bar: number }) => ({ ...p, start_bar: p.start_bar - start / 1920 }));
    return {
      ...original,
      scene_id: repo.scene_id,
      unit_ids: repo.phrases.map((p: { unit_id: string }) => p.unit_id),
      repo,
    };
  });
  await page.route('**/api/v1/samples/recorded-returns-before/bundle', (route) =>
    route.fulfill({ json: { data: fixture } }),
  );
  await page.goto('/projects/sample-recorded-returns-before/inspect?view=score&scene=1');

  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'web-return.ts', exact: true }).click();
  await expect(page.locator('.code-panel .panel-heading')).toContainText('web-return.ts');
  await expect.poll(async () => page.locator('.time-display b').innerText()).not.toBe('00:00');
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
});

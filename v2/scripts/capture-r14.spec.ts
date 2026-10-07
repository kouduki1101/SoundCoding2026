import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

test('record the current saved-analysis demo with zero model writes', async ({ page }) => {
  mkdirSync('.local/demo-r14', { recursive: true });
  const started = Date.now();
  const segments: {
    start: number;
    duration: number;
    tick: number;
    sample: string;
    support_muted?: boolean;
  }[] = [];
  let writes = 0;
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().includes('/api/v1/')) writes++;
  });
  const elapsed = () => (Date.now() - started) / 1000;
  async function at(seconds: number) {
    const wait = seconds - elapsed();
    if (wait > 0) await page.waitForTimeout(wait * 1000);
  }
  await page.goto('/');
  await expect(page.getByRole('dialog')).toBeVisible();
  await at(20);
  await page.getByRole('button', { name: '実画面のデモを見る', exact: true }).click();
  await expect(page.locator('.demo-comparison')).toBeVisible();
  await at(32);
  await page.getByRole('button', { name: '次へ', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  const playStart = elapsed();
  await at(43);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  segments.push({ start: playStart, duration: elapsed() - playStart, tick: 0, sample: 'returns-before' });
  await page.getByRole('button', { name: '次へ', exact: true }).click();
  await at(46);
  await page.getByRole('button', { name: '自分で使ってみる', exact: true }).click();
  const bundle = await (
    await page.request.get('http://127.0.0.1:8080/api/v1/samples/recorded-returns-before/bundle')
  ).json();
  const score = bundle.data.score.scenes[0].repo;
  const events = bundle.data.map.events;
  for (let i = 0; i < 3; i++) {
    const pair = page.locator('.demo-pairs > div').nth(i);
    for (let j = 0; j < 2; j++) {
      await at(48 + i * 14 + j * 6);
      const button = pair.getByRole('button').nth(j);
      const title = await button.getAttribute('title');
      const event = events.find((e: { span: { path: string; start_line: number; end_line: number } }) =>
        title?.startsWith(`${e.span.path}:${e.span.start_line}–${e.span.end_line}`),
      );
      const note = score.notes.find(
        (n: { kind: string; event_id: string }) => n.kind === 'data' && n.event_id === event.event_id,
      );
      const start = elapsed();
      await button.click();
      segments.push({
        start,
        duration: Math.min(1.2, note.duration_ms / 1000 + 0.3),
        tick: note.tick,
        sample: 'returns-before',
        support_muted: true,
      });
      await expect(page.locator('.code-panel .panel-heading')).toContainText(event.span.path);
    }
  }
  await at(92);
  await page.locator('.counter-evidence summary').first().click();
  await page.getByRole('button', { name: '選択箇所の保存された説明を見る' }).click();
  await at(114);
  await page.goto('/projects/sample-recorded-tsugiai-agents/inspect?scene=1');
  await page.getByRole('button', { name: 'あとで見る', exact: true }).click();
  await page.getByTestId('case-provenance').locator('summary').click();
  await at(134);
  await page.getByTestId('case-provenance').locator('summary').click();
  await page.getByText(/Agentの実行記録/).click();
  await at(161);
  await page.getByText(/Agentの実行記録/).click();
  await page.getByText('サンプル', { exact: true }).click();
  await at(180);
  expect(writes).toBe(0);
  writeFileSync(
    'artifacts/demo-r14-timing.json',
    JSON.stringify(
      {
        duration: 180,
        model_writes: writes,
        segments,
        origin: 'recorded_live',
        capture: 'current local UI; fixed-score audio reconstructed',
      },
      null,
      2,
    ),
  );
  const video = page.video()!;
  await page.close();
  await video.saveAs('.local/demo-r14/capture.webm');
});

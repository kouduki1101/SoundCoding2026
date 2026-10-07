import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';

test.use({ trace: 'off', video: { mode: 'on', size: { width: 1440, height: 900 } } });
test('paid deployed Gemini proposal, explicit approval, fresh analysis and preserved base', async ({
  page,
}) => {
  test.skip(process.env.E2E_LIVE_IMPROVEMENT !== '1', 'Paid HITL workflow is explicitly opt-in.');
  const reviewerEmail = process.env.CG_REVIEWER_EMAIL;
  const reviewerSecret = process.env.CG_REVIEWER_PASSWORD_SECRET;
  if (!reviewerEmail || !reviewerSecret) throw new Error('Private reviewer configuration is required.');
  test.setTimeout(720000);
  const started = Date.now();
  const time = () => (Date.now() - started) / 1000;
  const timings: Record<string, number> = {};
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
  const runs: Record<string, any> = {};
  const bundles: any[] = [];
  let created: any, proposed: any, approved: any, proposal: any;
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('response', async (response) => {
    if (!response.ok() || !response.url().includes('/api/v1/')) return;
    const url = new URL(response.url()),
      path = url.pathname.replace('/api/v1', '');
    const data = (await response.json()).data;
    if (/^\/runs\/[^/]+$/.test(path)) runs[data.run_id] = data;
    if (path.endsWith('/bundle') && path.startsWith('/projects/')) bundles.push(data);
    if (path === '/samples/recorded-returns-before/projects') created = data;
    if (/^\/analyses\/[^/]+\/proposals$/.test(path)) proposed = data;
    if (/^\/proposals\/[^/]+\/accept$/.test(path)) approved = data;
    if (/^\/proposals\/[^/]+$/.test(path)) proposal = data;
  });
  await page.goto('/projects/sample-recorded-returns-before/inspect?view=score&scene=1');

  await page.getByRole('button', { name: 'Geminiに改善案を依頼', exact: true }).click();
  await page.getByLabel('メールアドレス', { exact: true }).fill(reviewerEmail);
  await page.getByLabel('パスワード', { exact: true }).fill(password);
  await page.getByRole('dialog').getByRole('button', { name: 'ログイン', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  timings.login_complete = time();
  await page.getByRole('button', { name: 'この区間を聴く', exact: true }).click();
  timings.before_play = time();
  await page.waitForTimeout(20000);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  timings.before_pause = time();
  await page.getByTestId('cue-note').first().click();
  await page.getByRole('button', { name: 'Geminiに改善案を依頼', exact: true }).click();
  timings.requested = time();
  await expect(page.getByRole('button', { name: 'Geminiが改善案を作成中…', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog', { name: '改善案を確認' })).toBeVisible({ timeout: 220000 });
  expect(approved).toBeUndefined();
  timings.proposal_ready = time();
  await expect(page.getByRole('button', { name: '採用後', exact: true })).toHaveCount(0);
  await page.screenshot({ path: 'artifacts/deployed-r4-proposal.png' });
  writeFileSync('.local/deployed-r4-proposal.json', JSON.stringify(proposal, null, 2));
  await page.waitForTimeout(8000);
  await page.getByRole('button', { name: '差分を閉じる', exact: true }).click();
  expect(approved).toBeUndefined();
  await page.getByRole('button', { name: `差分を確認：${proposal.title}`, exact: true }).click();
  await page.getByTestId('accept-proposal').click();
  timings.accepted = time();
  await expect(page.getByRole('heading', { name: '採用した変更を、Geminiが再確認しています' })).toBeVisible();
  await expect(page.getByRole('button', { name: '採用後', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
    { timeout: 520000 },
  );
  await expect(page.locator('.monaco-editor')).toBeVisible();
  const after = bundles.find((b) => b.map.origin === 'live');
  timings.analysis_ready = time();
  expect(after).toBeTruthy();
  await page.getByRole('button', { name: '変更前', exact: true }).click();
  await page.waitForTimeout(5000);
  await expect(page.getByTestId('analysis-origin')).toContainText('保存済み実解析');
  const before = bundles.find((b) => b.map.analysis_id === created.analysis_id);
  expect(before).toBeTruthy();
  expect(after.map.parent_analysis_id).toBe(before.map.analysis_id);
  expect(after.sources).not.toEqual(before.sources);
  const common = before.map.responsibilities.flatMap((r: any) => {
    const match = after.map.responsibilities.find((a: any) => a.responsibility_id === r.responsibility_id);
    return match ? [{ id: r.responsibility_id, before: r.motif_id, after: match.motif_id }] : [];
  });
  expect(common.length).toBeGreaterThan(0);
  expect(common.every((r: any) => r.before === r.after)).toBe(true);
  await page.getByRole('button', { name: '採用後', exact: true }).click();
  await expect(page.getByTestId('analysis-origin')).toContainText('実解析');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  timings.after_play = time();
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  await expect.poll(() => page.locator('.time-display b').innerText()).not.toBe('00:00');
  await page.waitForTimeout(16000);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  timings.after_pause = time();
  await page.screenshot({ path: 'artifacts/deployed-r4-after.png' });
  writeFileSync('.local/deployed-r4-before-bundle.json', JSON.stringify(before, null, 2));
  writeFileSync('.local/deployed-r4-after-bundle.json', JSON.stringify(after, null, 2));
  const summary = (run: any) => ({
    run_id: run.run_id,
    status: run.status,
    model_requests: run.model_requests,
    tool_calls: run.tool_calls,
    input_tokens: run.input_tokens,
    output_tokens: run.output_tokens,
    duration_seconds: Math.round((run.updated_at - run.created_at) * 100) / 100,
  });
  writeFileSync(
    'artifacts/deployed-r4-hitl.json',
    JSON.stringify(
      {
        status: 'PASS',
        project_id: created.project_id,
        before_analysis_id: before.map.analysis_id,
        after_analysis_id: after.map.analysis_id,
        proposal_id: proposal.proposal_id,
        proposal: summary(runs[proposed.run_id]),
        reanalysis: summary(runs[approved.run_id]),
        common_motifs: common,
        changed_files: Object.keys(after.sources).filter((p) => before.sources[p] !== after.sources[p]),
        before_concerns: before.map.review_signals.filter((s: any) => s.verdict === 'concern').length,
        after_signals: after.map.review_signals.map((s: any) => ({
          category: s.category,
          verdict: s.verdict,
          label: s.label,
        })),
        grammar: after.score.scenes[0].repo.grammar_version,
        no_drums: after.score.scenes.every((s: any) =>
          s.repo.notes.every((n: any) => !['kick', 'snare', 'hat', 'wood'].includes(n.voice)),
        ),
        explicit_test_approval: true,
        page_errors: errors,
      },
      null,
      2,
    ),
  );
  expect(errors).toEqual([]);
  const video = page.video()!;
  await page.close();
  await video.saveAs('.local/deployed-r4-browser.webm');
  writeFileSync(
    '.local/deployed-r4-video.json',
    JSON.stringify({ video_path: '.local/deployed-r4-browser.webm', timings }, null, 2),
  );
});

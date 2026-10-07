import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

test('human approval gates source changes and after comparison (mock API, no paid model)', async ({
  page,
}) => {
  const before = JSON.parse(readFileSync('fixtures/recorded-live/returns-before.json', 'utf8'));
  before.map.analysis_id = 'analysis_e2e_before';
  before.map.analysis_depth = 'overview';
  const focused = structuredClone(before);
  focused.map.analysis_id = 'analysis_e2e_focused';
  focused.map.parent_analysis_id = before.map.analysis_id;
  focused.map.analysis_depth = 'focused';
  const after = structuredClone(before);
  after.map.analysis_id = 'analysis_e2e_after';
  after.map.parent_analysis_id = focused.map.analysis_id;
  after.map.analysis_depth = 'focused';
  after.map.origin = 'live';
  after.trace = [
    {
      seq: 1,
      type: 'tool_completed',
      timestamp: '2026-10-03',
      payload: { tool: 'read_code', purpose: '模擬API：採用したソースを読取' },
    },
  ];
  after.sources['src/store-return.ts'] += '\n// E2E mock snapshot\n';
  const proposal = {
    proposal_id: 'proposal_e2e',
    base_analysis_id: focused.map.analysis_id,
    title: 'E2Eの差分案',
    rationale: 'これはUI境界を検証する模擬APIの案です。',
    tradeoffs: '動作保証なし',
    verification: '別途検証が必要',
    diff: '--- a/src/store-return.ts\n+++ b/src/store-return.ts\n@@ -1 +1 @@\n-const previous = 1;\n+const reviewed = 1;',
    status: 'draft',
  };
  let generationPolls = 0,
    analysisPolls = 0,
    approved = false,
    ready = false,
    generated = false,
    reflected = false;
  const calls: string[] = [];
  const jwt = [
    'eyJhbGciOiJub25lIn0',
    Buffer.from(
      JSON.stringify({
        sub: 'e2e-reviewer',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
        aud: 'code-groove-e2e',
      }),
    ).toString('base64url'),
    'e2e',
  ].join('.');
  await page.route('https://identitytoolkit.googleapis.com/**', (route) =>
    route.fulfill({
      json: route.request().url().includes('lookup')
        ? { users: [{ localId: 'e2e-reviewer', email: 'reviewer@example.invalid' }] }
        : {
            idToken: jwt,
            refreshToken: 'e2e-refresh',
            expiresIn: '3600',
            localId: 'e2e-reviewer',
            email: 'reviewer@example.invalid',
            registered: true,
          },
    }),
  );
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url()),
      path = url.pathname.replace('/api/v1', '');
    const post = route.request().method() === 'POST';
    if (post) calls.push(path);
    let data: unknown;
    if (path === '/config')
      data = {
        live_enabled: true,
        model_id: 'test-double',
        firebase: {
          apiKey: 'e2e-firebase-key',
          authDomain: 'code-groove-e2e.firebaseapp.com',
          projectId: 'code-groove-e2e',
          appId: '1:123:web:e2e',
        },
      };
    else if (path === '/samples/recorded-returns-before/bundle') data = before;
    else if (path === '/samples/recorded-returns-before/projects')
      data = { project_id: 'p_e2e', analysis_id: before.map.analysis_id };
    else if (path === '/projects/p_e2e')
      data = {
        run_id: approved ? 'run_e2e_analysis' : '',
        latest_analysis_id: ready
          ? after.map.analysis_id
          : reflected
            ? focused.map.analysis_id
            : before.map.analysis_id,
        previous_analysis_id: ready ? focused.map.analysis_id : undefined,
        latest_proposal_id: generated ? 'proposal_e2e' : undefined,
        working_copy: true,
      };
    else if (path === '/projects/p_e2e/bundle')
      data =
        url.searchParams.get('analysis') === after.map.analysis_id ? after : reflected ? focused : before;
    else if (path === `/analyses/${before.map.analysis_id}/investigations`)
      data = { run_id: 'run_e2e_focus' };
    else if (path === '/runs/run_e2e_focus')
      data = { run_id: 'run_e2e_focus', status: 'completed', result_id: 'inv_e2e' };
    else if (path === '/runs/run_e2e_focus/events') data = [];
    else if (path === '/investigations/inv_e2e')
      data = {
        investigation_id: 'inv_e2e',
        base_analysis_id: before.map.analysis_id,
        findings: [
          {
            finding_id: 'f_mock',
            verdict: 'concern',
            summary: '模擬の精密検査：将来の協調変更を検討',
            justification: 'UIの順序を検証',
            evidence_ids: [],
          },
        ],
        evidence: [],
        review_signals: before.map.review_signals,
        suggested_reclassification: [],
      };
    else if (path === '/investigations/inv_e2e/publish-interpretation') {
      reflected = true;
      data = { analysis_id: focused.map.analysis_id };
    } else if (path === `/analyses/${focused.map.analysis_id}/proposals`)
      data = { run_id: 'run_e2e_proposal' };
    else if (path === '/runs/run_e2e_proposal') {
      generated = ++generationPolls > 1;
      data = {
        run_id: 'run_e2e_proposal',
        status: generated ? 'completed' : 'investigating',
        result_id: generated ? 'proposal_e2e' : undefined,
      };
    } else if (path === '/runs/run_e2e_proposal/events')
      data = [
        {
          seq: 1,
          type: 'progress',
          timestamp: '2026-10-03',
          payload: { message: '模擬API：関連するコードを検討中' },
        },
      ];
    else if (path === '/proposals/proposal_e2e')
      data = { ...proposal, status: approved ? 'accepted' : 'draft' };
    else if (path === '/proposals/proposal_e2e/accept') {
      approved = true;
      data = { run_id: 'run_e2e_analysis' };
    } else if (path === '/runs/run_e2e_analysis') {
      ready = ++analysisPolls > 1;
      data = {
        run_id: 'run_e2e_analysis',
        status: ready ? 'completed' : 'investigating',
        result_id: ready ? after.map.analysis_id : undefined,
      };
    } else if (path === '/runs/run_e2e_analysis/events') data = [];
    else return route.continue();
    await route.fulfill({ json: { data } });
  });
  await page.goto('/projects/sample-recorded-returns-before/inspect?view=score&scene=1');

  await expect(page.getByRole('button', { name: '採用後', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Geminiに改善案を依頼', exact: true })).toHaveCount(0);
  await expect(page.getByText(/初回健診で見つけた点/)).toBeVisible();
  await page.getByRole('button', { name: 'ログイン', exact: true }).click();
  await page.getByLabel('メールアドレス', { exact: true }).fill('reviewer@example.invalid');
  await page.getByLabel('パスワード', { exact: true }).fill('mock-password-only');
  await page.getByRole('dialog').getByRole('button', { name: 'ログイン', exact: true }).click();
  await page.getByRole('button', { name: 'この記録を保存して精密検査', exact: true }).click();
  await page.getByRole('button', { name: 'store-return.ts', exact: true }).click();
  await page.getByRole('textbox', { name: '選択した範囲への質問' }).fill('音の関係と将来の負担を調べて');
  await page.getByRole('button', { name: '質問を送信' }).click();
  await expect(page.getByText('模擬の精密検査：将来の協調変更を検討')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Geminiに改善案を依頼', exact: true })).toHaveCount(0);
  expect(reflected).toBe(false);
  await page.getByRole('button', { name: '調査結果を演奏に反映', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Geminiに改善案を依頼', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Geminiに改善案を依頼', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Geminiが改善案を作成中…', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog', { name: '改善案を確認' })).toBeVisible({ timeout: 15000 });
  expect(approved).toBe(false);
  await expect(page.getByRole('button', { name: '採用後', exact: true })).toHaveCount(0);
  await page.screenshot({ path: 'artifacts/improvement-diff-r14-mock.png' });
  await page.getByRole('button', { name: '差分を閉じる', exact: true }).click();
  expect(approved).toBe(false);
  await page.getByRole('button', { name: '差分を確認：E2Eの差分案', exact: true }).click();
  await page.getByTestId('accept-proposal').click();
  await expect(page.getByRole('heading', { name: '採用した変更を、Geminiが再確認しています' })).toBeVisible();
  await expect(page.getByRole('button', { name: '採用後', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
    { timeout: 15000 },
  );
  await page.getByRole('button', { name: '変更前', exact: true }).click();
  await expect(page.getByTestId('analysis-origin')).toContainText('保存済み実解析');
  await page.getByRole('button', { name: '採用後', exact: true }).click();
  await expect(page.getByTestId('analysis-origin')).toContainText('実解析');
  await expect(page.getByText('Agentの実行記録 · 1回のツール調査')).toBeVisible();
  await expect(page.getByText(/追加調査の記録/)).toHaveCount(0);
  expect(calls).toEqual([
    '/samples/recorded-returns-before/projects',
    `/analyses/${before.map.analysis_id}/investigations`,
    '/investigations/inv_e2e/publish-interpretation',
    `/analyses/${focused.map.analysis_id}/proposals`,
    '/proposals/proposal_e2e/accept',
  ]);
});

import { test, expect } from '@playwright/test';

test('actual Agent actions remain visible across dialogs and samples; indexing is distinct (mock API)', async ({
  page,
}) => {
  let status: string | null = 'indexing';
  let posts = 0;
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
    const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
    if (route.request().method() === 'POST') posts++;
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
    else if (path === '/account/activity')
      data = status ? { run_id: 'run_mock', project_id: 'p_mock', kind: 'investigation', status } : null;
    else if (path === '/runs/run_mock/events')
      data =
        status === 'investigating'
          ? [
              {
                seq: 1,
                timestamp: '2026-10-03',
                type: 'tool_completed',
                payload: {
                  tool: 'read_code',
                  purpose: '模擬記録：境界の別説明を調べる',
                  target: { path: 'src/pricing.ts', start_line: 10 },
                  ok: true,
                },
              },
              {
                seq: 2,
                timestamp: '2026-10-03',
                type: 'hypothesis_recorded',
                payload: {
                  statement: '模擬仮説：判断の所有者が分かれている可能性',
                  evidence_ids: ['ev_mock'],
                },
              },
            ]
          : [];
    else if (path === '/projects') data = [];
    else return route.continue();
    await route.fulfill({ json: { data } });
  });
  await page.goto('/projects/sample-recorded-checkout-flow/inspect?scene=1');

  await page.getByRole('button', { name: 'ログイン', exact: true }).click();
  await page.getByLabel('メールアドレス', { exact: true }).fill('reviewer@example.invalid');
  await page.getByLabel('パスワード', { exact: true }).fill('mock-password-only');
  await page.getByRole('dialog').getByRole('button', { name: 'ログイン', exact: true }).click();
  const activity = page.getByTestId('agent-activity');
  await expect(activity).toContainText('構文からファイル・関数の索引を作成');
  await expect(activity).not.toContainText('Gemini Agentが調査中');
  status = 'investigating';
  await expect(activity).toContainText('Gemini Agentが調査中');
  await expect(activity).toContainText('境界の別説明');
  await expect(activity).toContainText('src/pricing.ts:10');
  await expect(activity).toContainText('判断の所有者が分かれている可能性');
  await page.getByRole('button', { name: 'Agentを閉じる', exact: true }).click();
  await expect(page.locator('.agent-panel')).toBeHidden();
  await expect(activity).toBeInViewport();
  await page.getByRole('button', { name: 'PR / Repositoryを開く', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(activity).toBeInViewport();
  await page.screenshot({ path: 'artifacts/agent-activity-r14-mock.png' });
  await page.getByRole('button', { name: /実解析を再生 · 例外/ }).click();
  await expect(activity).toContainText('Gemini Agentが調査中');
  status = null;
  await expect(activity).toHaveCount(0);
  expect(posts).toBe(0);
});

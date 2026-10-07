import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('code-groove-hide-guide', 'true'));
});

test('production comparison keeps anonymous records usable and hides local-only mock requests', async ({
  page,
}) => {
  let writes = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().includes('/api/v1/')) writes++;
  });
  if (!process.env.E2E_BASE_URL)
    await page.route('**/api/v1/config', async (route) => {
      const response = await route.fetch();
      const value = await response.json();
      value.data.local_mock_enabled = false;
      await route.fulfill({ json: value });
    });
  await page.goto('/projects/sample-recorded-returns-before/inspect?view=score');
  await page.getByRole('button', { name: /Agentの説明を二関数で問い直す/ }).click();
  const dialog = page.getByRole('dialog', { name: '構造を比較して聴く' });
  await dialog.getByRole('textbox', { name: '疑問', exact: true }).fill('この差は意図された仕様ですか？');
  await expect(dialog.getByRole('button', { name: /モック追加調査を試す/ })).toHaveCount(0);
  await expect(
    dialog.getByRole('button', { name: 'この疑問をAgentに追加調査する', exact: true }),
  ).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'ローカルJSONに書き出す', exact: true })).toBeEnabled();
  await expect(dialog).toContainText('追加調査にはログイン');
  expect(writes).toBe(0);
});

test('explicit chat send after authentication adopts the recording and retains the draft (mock API)', async ({
  page,
}) => {
  const bundle = JSON.parse(readFileSync('fixtures/recorded-live/returns-before.json', 'utf8'));
  const owned = structuredClone(bundle);
  owned.map.analysis_id = owned.score.analysis_id = 'analysis_chat_mock';
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
  const writes: { path: string; body: any }[] = [];
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
    if (route.request().method() === 'POST') writes.push({ path, body: route.request().postDataJSON() });
    let data: unknown;
    if (path === '/config')
      data = {
        live_enabled: true,
        model_id: 'mock',
        firebase: {
          apiKey: 'e2e-firebase-key',
          authDomain: 'code-groove-e2e.firebaseapp.com',
          projectId: 'code-groove-e2e',
          appId: '1:123:web:e2e',
        },
      };
    else if (path === '/samples/recorded-returns-before/bundle') data = bundle;
    else if (path === '/samples/recorded-returns-before/projects')
      data = { project_id: 'p_chat_mock', analysis_id: owned.map.analysis_id };
    else if (path === '/projects/p_chat_mock')
      data = { latest_analysis_id: owned.map.analysis_id, run_id: '' };
    else if (path === '/projects/p_chat_mock/bundle') data = owned;
    else if (path === '/analyses/analysis_chat_mock/investigations') data = { run_id: 'run_chat_mock' };
    else if (path === '/runs/run_chat_mock') data = { status: 'cancelled' };
    else if (path === '/account/activity' || path.endsWith('/repository')) data = null;
    else data = [];
    await route.fulfill({ json: { data } });
  });
  await page.goto('/projects/sample-recorded-returns-before/inspect?view=score');
  const draft = 'この責務を分けている仕様上の理由も確認してください。';
  await page.getByRole('textbox', { name: '選択した範囲への質問' }).fill(draft);
  await page.getByRole('button', { name: '質問を送信', exact: true }).click();
  const auth = page.getByRole('dialog', { name: 'ログイン' });
  await auth.getByLabel('メールアドレス', { exact: true }).fill('reviewer@example.invalid');
  await auth.getByLabel('パスワード', { exact: true }).fill('mock-password-only');
  await auth.getByRole('button', { name: 'ログイン', exact: true }).click();
  await expect(auth).toHaveCount(0);
  expect(writes).toEqual([]);
  await page.getByRole('button', { name: '質問を送信', exact: true }).click();
  await expect.poll(() => writes.length).toBe(2);
  expect(writes.map((write) => write.path)).toEqual([
    '/samples/recorded-returns-before/projects',
    '/analyses/analysis_chat_mock/investigations',
  ]);
  expect(writes[1].body.question).toBe(draft);
  await expect(page.getByRole('textbox', { name: '選択した範囲への質問' })).toHaveValue(draft);
});

test('real repository browsing, Agent icon and logged-out chat preserve honest scope and draft', async ({
  page,
}) => {
  let writes = 0;
  const errors: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().includes('/api/v1/')) writes++;
  });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/projects/sample-recorded-tsugiai-agents/inspect');
  await expect(page.getByTestId('repository-scale')).toContainText('51 ファイル');
  await expect(page.locator('.tree-file')).toHaveCount(51);
  const input = page.getByRole('textbox', { name: '選択した範囲への質問' });
  await input.fill('セッションの隔離をどこで確認できますか？');
  await page.getByRole('button', { name: 'AgentWindowを非表示', exact: true }).click();
  await expect(page.locator('#workspace-agent')).toBeHidden();
  await page.getByRole('button', { name: 'AgentWindowを表示', exact: true }).click();
  await expect(input).toHaveValue('セッションの隔離をどこで確認できますか？');
  await page.getByRole('button', { name: '質問を送信', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'ログイン' })).toBeVisible();
  await page.getByRole('button', { name: '閉じる', exact: true }).click();
  await expect(input).toHaveValue('セッションの隔離をどこで確認できますか？');
  await page.locator('.tree-file[title^="agents/main.py"]').click();
  await expect(page.getByTestId('code-location')).toContainText('agents/main.py');
  await expect(page.locator('.reference-code-note')).toContainText('保存済み検査の対象外');
  await expect(page.locator('.monaco-editor')).toContainText('FastAPI');
  await page.locator('.review-focus summary').click();
  await expect(page.locator('.review-focus')).toContainText('反証未確認');
  await page.locator('.review-focus summary').click();
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1280, height: 720 },
    { width: 980, height: 600 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(input).toBeInViewport();
    await expect(page.locator('.review-code')).toBeInViewport();
    await expect(page.locator('.composer-now')).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({
      path: `artifacts/${process.env.E2E_BASE_URL ? 'deployed' : 'demo'}-reference-r17-${viewport.width}.png`,
    });
  }
  expect(writes).toBe(0);
  expect(errors).toEqual([]);
});

test('playback resumes source following after reference selection and highlights actual sounding lines', async ({
  page,
}) => {
  await page.goto('/projects/sample-recorded-tsugiai-agents/inspect');
  await expect(page.locator('.tree-file')).toHaveCount(51);
  await page.locator('.tree-file[title^="agents/main.py"]').click();
  await expect(page.getByRole('button', { name: '演奏に追従', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByRole('button', { name: '演奏に追従', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.locator('.composer-now > span')).toContainText('演奏中');
  await expect
    .poll(async () => {
      const sounding = await page.locator('.composer-now').getAttribute('data-sounding-span');
      const location = await page.getByTestId('code-location').innerText();
      return !!sounding && location === sounding;
    })
    .toBe(true);
  await expect(page.locator('.code-highlight')).not.toHaveCount(0);
  await expect(page.locator('.reference-code-note')).toHaveCount(0);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.locator('.review-focus summary').click();
  await page.locator('.review-focus-item').last().getByRole('button', { name: '伴奏なしで聴く' }).click();
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  const state = await page.evaluate(
    () => JSON.parse(localStorage.getItem('code-groove-workspace-v1')!).state,
  );
  expect(state.focusEvidence).toBe(false);
  expect(state.following).toBe(true);
  await page.screenshot({
    path: process.env.E2E_BASE_URL ? 'artifacts/deployed-follow-r17.png' : 'artifacts/demo-follow-r17.png',
  });
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible({ timeout: 12000 });
});

test('walkthrough spotlight follows button layout changes and viewport resizing', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '使い方', exact: true }).click();
  await page.getByRole('button', { name: '実画面のデモを見る', exact: true }).click();
  await expect(page.getByTestId('repository-scale')).toContainText('51 ファイル');
  await page.getByRole('button', { name: '次へ', exact: true }).click();
  const tracksTarget = async () =>
    page.evaluate(() => {
      const target = document.querySelector('[data-tour="play"]')!.getBoundingClientRect();
      const window = document.querySelector('.spotlight-window')!.getBoundingClientRect();
      return (
        Math.abs(window.left - (target.left - 8)) < 1 &&
        Math.abs(window.top - (target.top - 8)) < 1 &&
        Math.abs(window.width - (target.width + 16)) < 1
      );
    });
  await expect.poll(tracksTarget).toBe(true);
  await page.evaluate(() => {
    (document.querySelector('[data-tour="play"]') as HTMLElement).style.transform = 'translate(30px, 8px)';
  });
  await expect.poll(tracksTarget).toBe(true);
  await page.setViewportSize({ width: 980, height: 600 });
  await expect.poll(tracksTarget).toBe(true);
  await page.getByRole('button', { name: '次へ', exact: true }).click();
  await expect(page.locator('.tour-card')).toContainText('確認したい箇所');
  await expect(page.locator('.review-focus')).toHaveAttribute('open', '');
  await expect
    .poll(() =>
      page.evaluate(() => {
        const content = document.querySelector('[data-tour-content]')!.getBoundingClientRect();
        const spotlight = document.querySelector('.spotlight-window')!.getBoundingClientRect();
        return spotlight.bottom >= content.bottom + 7 && spotlight.left <= content.left - 7;
      }),
    )
    .toBe(true);
  await page.getByRole('button', { name: '自分で使ってみる', exact: true }).click();
  await expect(page.locator('.spotlight-tour')).toHaveCount(0);
});

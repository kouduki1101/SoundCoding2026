import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import Ajv from 'ajv';
import { indexSnapshot } from '../../packages/repo-indexer/src/indexer';
import { compareStructure } from '../../packages/repo-indexer/src/structure';
import { compileStructure } from '../../packages/groove-core/src/structure';

test('saved Agent → optional sound comparison → human question → explicit mock investigation → JSON', async ({
  page,
}) => {
  const errors: string[] = [],
    posts: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().includes('/api/v1/')) posts.push(r.url());
  });
  await page.goto('/projects/sample-recorded-returns-before/inspect?view=score');
  const later = page.getByRole('button', { name: 'あとで見る', exact: true });
  if (await later.isVisible()) await later.click();
  await page.getByRole('button', { name: /Agentの説明を二関数で問い直す/ }).click();
  const dialog = page.getByRole('dialog', { name: '構造を比較して聴く' });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.structure-agent-context')).toContainText('保存済み実解析');
  await expect(dialog.locator('.structure-rows')).toBeVisible();
  await dialog.getByRole('checkbox', { name: '音を使う', exact: true }).uncheck();
  await expect(dialog.getByRole('button', { name: 'A→Bを再生', exact: true })).toBeDisabled();
  await dialog
    .getByRole('textbox', { name: '期待', exact: true })
    .fill('初回説明の役割が同じなら、条件も同じだと思う');
  await dialog.getByRole('textbox', { name: '観察した事実', exact: true }).fill('コードに異なる条件がある');
  await dialog
    .getByRole('textbox', { name: '疑問', exact: true })
    .fill('説明に含まれていない差は、仕様によるものですか？');
  await dialog.getByLabel('差の認識', { exact: true }).selectOption('not_recognized');
  await dialog.getByLabel('理由の確認', { exact: true }).selectOption('deferred');
  await dialog.getByLabel('人の判断', { exact: true }).selectOption('insufficient_context');
  const initialA = await dialog.getByLabel('Aの関数', { exact: true }).inputValue();
  const another = await dialog
    .getByLabel('Aの関数', { exact: true })
    .locator('option')
    .last()
    .getAttribute('value');
  await dialog.getByLabel('Aの関数', { exact: true }).selectOption(another!);
  await dialog.getByLabel('Aの関数', { exact: true }).selectOption(initialA);
  await expect(dialog.getByRole('textbox', { name: '疑問', exact: true })).toHaveValue(
    '説明に含まれていない差は、仕様によるものですか？',
  );
  expect(posts).toHaveLength(0);
  await dialog.getByRole('button', { name: /モック追加調査を試す/ }).click();
  await expect(dialog.locator('.structure-answer')).toContainText('モック回答・実モデル未使用');
  await expect(dialog.getByLabel('理由の確認', { exact: true })).toHaveValue('deferred');
  await expect(dialog.getByLabel('差の認識', { exact: true })).toHaveValue('not_recognized');
  await dialog.getByRole('checkbox', { name: '音を使う', exact: true }).check();
  await expect(dialog).toContainText('呼び出し辞書の上限4種類を超えています');
  await expect(dialog.getByRole('button', { name: 'A→Bを再生', exact: true })).toBeDisabled();
  await dialog.locator('.structure-rows button').first().click();
  await expect(dialog.getByLabel('理由の確認', { exact: true })).toHaveValue('deferred');
  await dialog.getByRole('button', { name: '今回の記録を終了する', exact: true }).click();
  const downloadWait = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'ローカルJSONに書き出す', exact: true }).click();
  const download = await downloadWait;
  const content = JSON.parse(readFileSync((await download.path())!, 'utf8'));
  const validate = new Ajv({ strict: false }).compile(
    JSON.parse(readFileSync('contracts/ComparisonExport.schema.json', 'utf8')),
  );
  expect(validate(content), JSON.stringify(validate.errors)).toBe(true);
  expect(content.agent_context.origin).toBe('recorded_live');
  expect(content.record.answers[0].origin).toBe('fixture');
  expect(content.record.reason_status).toBe('deferred');
  expect(
    content.record.operations.some((o: { operation: string }) => o.operation === 'playback_started'),
  ).toBe(false);
  expect(
    content.record.operations.some((o: { operation: string }) => o.operation === 'code_navigation'),
  ).toBe(true);
  expect(content.record.ended_at).not.toBeNull();
  content.presentation.recording_actor = 'Playwright automation';
  content.presentation.human_evaluation_performed = false;
  expect(validate(content), JSON.stringify(validate.errors)).toBe(true);
  writeFileSync('artifacts/structure-comparison-r15-export-mock.json', JSON.stringify(content, null, 2));
  await dialog.getByRole('button', { name: '比較を閉じる', exact: true }).click();
  await page.reload();

  await page.getByRole('button', { name: /Agentの説明を二関数で問い直す/ }).click();
  await expect(dialog.getByRole('textbox', { name: '疑問', exact: true })).toHaveValue(
    content.record.question,
  );
  await expect(dialog.getByLabel('理由の確認', { exact: true })).toHaveValue('deferred');
  expect(posts).toHaveLength(1);
  expect(posts[0]).toContain('/mock');
  expect(errors).toEqual([]);
});

test('small mock teaching comparisons preserve order, exact code and keyboard controls', async ({ page }) => {
  await page.goto('/projects/sample-recorded-returns-before/inspect?view=score');
  const later = page.getByRole('button', { name: 'あとで見る', exact: true });
  if (await later.isVisible()) await later.click();
  await page.getByRole('button', { name: /Agentの説明を二関数で問い直す/ }).click();
  const dialog = page.getByRole('dialog', { name: '構造を比較して聴く' });
  await dialog.getByLabel('材料', { exact: true }).selectOption('demo');
  await expect(dialog.locator('.structure-agent-context')).toContainText('模擬教材・実解析なし');
  const selectFunction = async (side: string, label: string) => {
    const option = dialog
      .getByLabel(`${side}の関数`, { exact: true })
      .locator('option')
      .filter({ hasText: new RegExp(`^${label} ·`) });
    await dialog
      .getByLabel(`${side}の関数`, { exact: true })
      .selectOption((await option.getAttribute('value'))!);
  };
  for (const [a, b] of [
    ['constantA', 'constantB'],
    ['loopA', 'loopB'],
    ['addedA', 'addedB'],
    ['directA', 'extractedB'],
    ['branchA', 'branchB'],
    ['intendedA', 'intendedB'],
    ['unknownA', 'unknownB'],
    ['orderA', 'orderB'],
  ]) {
    await selectFunction('A', a);
    await selectFunction('B', b);
    await expect(dialog.locator('.structure-source').first()).toContainText(a);
    await expect(dialog.locator('.structure-source').last()).toContainText(b);
  }
  await expect(dialog.locator('.structure-rows')).toContainText('対応不明');
  await dialog.locator('.structure-rows button').first().focus();
  await page.keyboard.press('Enter');
  await expect(dialog.locator('.structure-rows tr[aria-selected=true]')).toHaveCount(1);
  await dialog.getByRole('button', { name: 'Aを再生', exact: true }).click();
  await expect(dialog.getByText('再生中', { exact: true })).toBeVisible();
  await page.waitForTimeout(650);
  await dialog.getByRole('button', { name: '停止', exact: true }).click();
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1280, height: 720 },
    { width: 980, height: 720 },
  ]) {
    await page.setViewportSize(viewport);
    await dialog.locator('.structure-sources').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `artifacts/structure-comparison-r15-mock-${viewport.width}.png` });
  }
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
});

test('audio failure keeps comparison and notes usable (mock sound failure)', async ({ page }) => {
  await page.goto('/projects/sample-recorded-returns-before/inspect?view=score');
  const later = page.getByRole('button', { name: 'あとで見る', exact: true });
  if (await later.isVisible()) await later.click();
  await page.getByRole('button', { name: /Agentの説明を二関数で問い直す/ }).click();
  const dialog = page.getByRole('dialog', { name: '構造を比較して聴く' });
  await dialog.getByLabel('材料', { exact: true }).selectOption('demo');
  for (const [side, label] of [
    ['A', 'constantA'],
    ['B', 'constantB'],
  ]) {
    const option = dialog
      .getByLabel(`${side}の関数`, { exact: true })
      .locator('option')
      .filter({ hasText: new RegExp(`^${label} ·`) });
    await dialog
      .getByLabel(`${side}の関数`, { exact: true })
      .selectOption((await option.getAttribute('value'))!);
  }
  await expect(dialog.getByRole('button', { name: 'Aを再生', exact: true })).toBeEnabled();
  await page.evaluate(() => {
    Object.defineProperty(window, 'AudioContext', {
      value: class {
        constructor() {
          throw new Error('MOCK_AUDIO_FAILURE');
        }
      },
    });
  });
  await dialog.getByRole('button', { name: 'Aを再生', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('コード比較と記録は利用できます');
  await dialog.getByRole('textbox', { name: '疑問', exact: true }).fill('音なしで差の理由を調べたい');
  await expect(dialog.getByLabel('理由の確認', { exact: true })).toHaveValue('not_started');
  await dialog.getByRole('button', { name: /モック追加調査を試す/ }).click();
  await expect(dialog.locator('.structure-answer')).toContainText('モック回答・実モデル未使用');
});

test('authenticated comparison request, cancellation and answer retention use distinct API (mock)', async ({
  page,
}) => {
  const bundle = JSON.parse(readFileSync('fixtures/recorded-live/returns-before.json', 'utf8'));
  bundle.map.origin = 'fixture';
  bundle.map.analysis_id = 'analysis_mock_compare';
  bundle.map.snapshot_id = 'snap_mock_compare';
  bundle.sources['short.ts'] =
    'export function staticA() { return 30; }\nexport function staticB() { return 60; }';
  const input = { snapshot_id: bundle.map.snapshot_id, sources: bundle.sources };
  const inventory = { snapshot_id: input.snapshot_id, units: indexSnapshot(input).units };
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
  const requests: Record<string, any>[] = [];
  let adoptionCalls = 0;
  let status = 'investigating';
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url()),
      path = url.pathname.replace('/api/v1', '');
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
    else if (path.endsWith('/bundle')) data = bundle;
    else if (path.endsWith('/projects') && path.startsWith('/samples/')) {
      adoptionCalls++;
      data = { project_id: 'p_mock', analysis_id: bundle.map.analysis_id };
    } else if (path === '/projects/p_mock') data = { latest_analysis_id: bundle.map.analysis_id, run_id: '' };
    else if (path === '/projects/p_mock/repository') data = null;
    else if (path.endsWith('/structure')) {
      if (!url.searchParams.has('unit_a')) data = inventory;
      else {
        const comparison = compareStructure(
          input,
          url.searchParams.get('unit_a')!,
          url.searchParams.get('unit_b')!,
        );
        data = {
          comparison,
          playback: compileStructure(comparison, url.searchParams.get('markers') === 'true'),
        };
      }
    } else if (path.endsWith('/comparison-investigations')) {
      requests.push(route.request().postDataJSON());
      status = requests.length === 1 ? 'investigating' : 'completed';
      data = { run_id: `run_compare_${requests.length}` };
    } else if (path.endsWith('/cancel')) {
      status = 'cancelled';
      data = { cancel_requested: true };
    } else if (/^\/runs\/run_compare_\d+$/.test(path))
      data = { status, result_id: status === 'completed' ? 'mock_answer' : undefined };
    else if (path === '/investigations/mock_answer')
      data = {
        kind: 'structure_comparison',
        investigation_id: 'mock_answer',
        base_analysis_id: bundle.map.analysis_id,
        origin: 'fixture',
        model_id: 'mock-api-no-model',
        request: requests.at(-1),
        interpretation: 'inconclusive',
        summary: 'モックAPIの比較回答',
        reason: 'UI経路を検証。新規読取検証はバックエンドで別に検査。',
        counter_explanation: '仕様が異なる可能性',
        unknowns: ['実モデル未使用'],
        evidence_ids: [],
        evidence: [],
      };
    else if (path === '/account/activity') data = null;
    else data = [];
    await route.fulfill({ json: { data } });
  });
  await page.goto('/projects/sample-recorded-returns-before/inspect?view=score');

  await page.getByRole('button', { name: 'ログイン', exact: true }).click();
  await page.getByLabel('メールアドレス', { exact: true }).fill('reviewer@example.invalid');
  await page.getByLabel('パスワード', { exact: true }).fill('mock-password-only');
  await page.getByRole('dialog').getByRole('button', { name: 'ログイン', exact: true }).click();
  await page.getByRole('button', { name: /Agentの説明を二関数で問い直す/ }).click();
  const dialog = page.getByRole('dialog', { name: '構造を比較して聴く' });
  for (const [side, label] of [
    ['A', 'staticA'],
    ['B', 'staticB'],
  ]) {
    const option = dialog
      .getByLabel(`${side}の関数`, { exact: true })
      .locator('option')
      .filter({ hasText: new RegExp(`^${label} ·`) });
    await dialog
      .getByLabel(`${side}の関数`, { exact: true })
      .selectOption((await option.getAttribute('value'))!);
  }
  await dialog
    .getByRole('textbox', { name: '疑問', exact: true })
    .fill('Agentが触れていない定数の差は意図的ですか？');
  await dialog.getByLabel('理由の確認', { exact: true }).selectOption('unanswered');
  expect(requests).toHaveLength(0);
  const ask = dialog.getByRole('button', { name: 'この疑問をAgentに追加調査する', exact: true });
  await ask.click();
  await dialog.getByRole('button', { name: '追加調査を取消', exact: true }).click();
  await expect(ask).toBeEnabled();
  await ask.click();
  await expect(dialog.locator('.structure-answer')).toContainText('モックAPIの比較回答');
  expect(requests).toHaveLength(2);
  expect(adoptionCalls).toBe(1);
  expect(requests[1]).not.toHaveProperty('scene_id');
  expect(requests[1].question).toContain('触れていない');
  expect(requests[1].snapshot_id).toBe(input.snapshot_id);
  await expect(dialog.getByLabel('理由の確認', { exact: true })).toHaveValue('unanswered');
  await expect(dialog.getByRole('textbox', { name: '疑問', exact: true })).toHaveValue(requests[1].question);
});

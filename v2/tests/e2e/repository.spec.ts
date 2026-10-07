import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

test('local import, repository coverage, saved playback and explicit continuation (mock APIs)', async ({
  page,
}) => {
  const bundle = JSON.parse(readFileSync('fixtures/mixed.json', 'utf8'));
  bundle.map.analysis_id = 'analysis_partition_a';
  bundle.map.profile.title = '模擬の分割解析';
  bundle.partition = { chunk_id: 'chunk_a', paths: ['src/mixed.ts'], whole_repository_complete: false };
  const repository = {
    snapshot_id: 'snapshot_mock',
    eligible_source_files: 51,
    source_lines: 19541,
    indexed_symbols: 873,
    implementation_units: 281,
    analyzed_chunks: 1,
    inspected_units: 12,
    pending_units: 12,
    unresolved_units: 0,
    files_without_units: ['src/types.ts'],
    cross_partition_review: 'not_run',
    integrations: [] as { analysis_id: string; inspected_units: number }[],
    note: '模擬API。全体は未判定。',
    chunks: [
      {
        chunk_id: 'chunk_a',
        label: 'src/first',
        paths: ['src/first/flow.ts'],
        units: 12,
        symbol_count: 20,
        status: 'analyzed',
        analysis_id: 'analysis_partition_a',
        inspected_units: 12,
        unresolved_units: 0,
        unit_ids: Array.from({ length: 24 }, (_, i) => `unit_a_${i}`),
        owner_units: Array.from({ length: 24 }, (_, i) => ({
          unit_id: `unit_a_${i}`,
          label: `first_${i}`,
          span: { path: 'src/first/flow.ts', start_line: i + 1, end_line: i + 1 },
        })),
      },
      {
        chunk_id: 'chunk_b',
        label: 'src/second',
        paths: ['src/second/flow.ts'],
        units: 12,
        symbol_count: 30,
        status: 'pending',
        inspected_units: 0,
        unresolved_units: 0,
        unit_ids: Array.from({ length: 24 }, (_, i) => `unit_b_${i}`),
        owner_units: Array.from({ length: 24 }, (_, i) => ({
          unit_id: `unit_b_${i}`,
          label: `second_${i}`,
          span: { path: 'src/second/flow.ts', start_line: i + 1, end_line: i + 1 },
        })),
      },
    ],
  };
  let continued = false;
  let integrated = false;
  const posts: string[] = [];
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
    if (route.request().method() === 'POST') posts.push(path);
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
    else if (path === '/account/activity') data = null;
    else if (path === '/projects') data = [];
    else if (path === '/projects/import') {
      expect(route.request().postDataJSON().revision).toBe('a'.repeat(40));
      data = { project_id: 'p_repository', run_id: 'run_import' };
    } else if (path === '/projects/p_repository')
      data = {
        run_id: continued ? 'run_continue' : 'run_import',
        latest_analysis_id: integrated
          ? 'analysis_integrated'
          : continued
            ? 'analysis_partition_b'
            : 'analysis_partition_a',
        source: { kind: 'local_snapshot' },
      };
    else if (path === '/projects/p_repository/bundle')
      data = {
        ...bundle,
        map: {
          ...bundle.map,
          analysis_id: integrated
            ? 'analysis_integrated'
            : continued
              ? 'analysis_partition_b'
              : 'analysis_partition_a',
        },
        repository,
      };
    else if (path === '/projects/p_repository/repository') data = repository;
    else if (path === '/projects/p_repository/chunks') {
      const retryPartial = route.request().postDataJSON().retry_partial === true;
      expect(route.request().postDataJSON()).toEqual({
        chunk_id: 'chunk_b',
        ...(retryPartial ? { retry_partial: true } : {}),
      });
      continued = true;
      repository.analyzed_chunks = 2;
      repository.pending_units = 0;
      repository.unresolved_units = retryPartial ? 0 : 1;
      repository.chunks[1] = {
        ...repository.chunks[1],
        status: retryPartial ? 'analyzed' : 'partial',
        analysis_id: 'analysis_partition_b',
        unresolved_units: retryPartial ? 0 : 1,
        inspected_units: retryPartial ? 12 : 11,
      };
      data = { run_id: 'run_continue' };
    } else if (path === '/projects/p_repository/integrations') {
      expect(route.request().postDataJSON()).toEqual({
        chunk_ids: ['chunk_a', 'chunk_b'],
        unit_ids: [...repository.chunks[0].unit_ids, 'unit_b_0'],
      });
      integrated = true;
      repository.cross_partition_review = 'scoped';
      repository.integrations = [{ analysis_id: 'analysis_integrated', inspected_units: 25 }];
      data = { run_id: 'run_integrated' };
    } else if (
      path === '/runs/run_import' ||
      path === '/runs/run_continue' ||
      path === '/runs/run_integrated'
    )
      data = {
        run_id: path.split('/').at(-1),
        status: 'partial',
        result_id: integrated
          ? 'analysis_integrated'
          : continued
            ? 'analysis_partition_b'
            : 'analysis_partition_a',
      };
    else if (path.endsWith('/events')) data = [];
    else return route.continue();
    await route.fulfill({ json: { data } });
  });
  await page.goto('/projects/sample-mixed/inspect');

  await page.getByRole('button', { name: 'ログイン', exact: true }).click();
  await page.getByLabel('メールアドレス', { exact: true }).fill('reviewer@example.invalid');
  await page.getByLabel('パスワード', { exact: true }).fill('mock-password-only');
  await page.getByRole('dialog').getByRole('button', { name: 'ログイン', exact: true }).click();
  await expect(page.getByRole('button', { name: 'ログイン', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'PR / Repositoryを開く', exact: true }).click();
  await page.getByText('固定したローカルスナップショットを取り込む', { exact: true }).click();
  await page.getByLabel('スナップショットJSON').setInputFiles({
    name: 'import.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({
        revision: 'a'.repeat(40),
        label: 'Mock repository',
        sources: { 'run.py': 'def run(): return 1' },
      }),
    ),
  });
  await expect(page.locator('.refresh-bar')).toContainText('51ファイル · 1/2範囲に保存結果 · 全体は未判定');
  await expect(page.getByLabel('再生範囲').getByRole('option', { name: '表示中の検査範囲' })).toHaveCount(1);
  await page.getByRole('button', { name: '検査範囲と続きを選ぶ' }).click();
  await expect(page.getByRole('dialog')).toContainText('12実装は未検査');
  await expect(page.getByRole('dialog')).toContainText('統合調査も選択した実装のみで、全体の健全性は未判定');
  await page.getByRole('button', { name: '保存結果を開く', exact: true }).click();
  expect(posts).toEqual(['/projects/import']);
  await page.getByRole('button', { name: '検査範囲と続きを選ぶ' }).click();
  await page.getByRole('button', { name: 'この範囲を検査' }).click();
  await expect(page.locator('.refresh-bar')).toContainText('2/2範囲に保存結果 · 全体は未判定');
  await page.getByRole('button', { name: '検査範囲と続きを選ぶ' }).click();
  await expect(page.getByRole('dialog')).toContainText('一部未解決 (1)');
  await page.screenshot({ path: 'artifacts/repository-r14-mock.png' });
  expect(posts).toEqual(['/projects/import', '/projects/p_repository/chunks']);
  await page.getByRole('button', { name: '未解決を再検査', exact: true }).click();
  await page.getByRole('button', { name: '検査範囲と続きを選ぶ' }).click();
  await expect(page.getByRole('dialog')).toContainText('0実装は未解決');
  expect(posts).toEqual([
    '/projects/import',
    '/projects/p_repository/chunks',
    '/projects/p_repository/chunks',
  ]);
  const scope = page.locator('.integration-selection');
  await scope.getByLabel('src/first / 12実装', { exact: true }).check();
  await scope.getByLabel('src/second / 12実装', { exact: true }).check();
  const integrateButton = scope.getByRole('button', { name: '選んだ範囲を新規統合調査' });
  await expect(integrateButton).toBeDisabled();
  await expect(scope.getByRole('alert')).toContainText('32実装を超えています');
  await scope.locator('.integration-owners summary').click();
  const owners = scope.locator('.integration-owners input');
  for (let i = 24; i < 48; i++) await owners.nth(i).uncheck();
  await expect(integrateButton).toBeDisabled();
  await owners.nth(24).check();
  await expect(integrateButton).toBeEnabled();
  await expect(scope).toContainText('新規AI解析1回');
  await integrateButton.click();
  await page.getByRole('button', { name: '検査範囲と続きを選ぶ' }).click();
  await expect(page.getByRole('button', { name: '保存した統合結果 / 25実装' })).toBeVisible();
  expect(posts.at(-1)).toBe('/projects/p_repository/integrations');
  await page.getByRole('button', { name: '閉じる', exact: true }).click();
  await page.setViewportSize({ width: 1280, height: 720 });
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(true);
});

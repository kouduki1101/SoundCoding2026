import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { compileGroove } from '../../packages/groove-core/src/compiler';

test('read comparisons and human review are distinct, source-linked and never start paid work (mock)', async ({
  page,
}) => {
  const bundle = JSON.parse(readFileSync('fixtures/recorded-live/returns-before.json', 'utf8'));
  bundle.map.origin = 'fixture';
  bundle.map.profile.title = '比較UIの模擬検証';
  bundle.map.analysis_depth = 'overview';
  const subject = bundle.map.units[0],
    peers = [bundle.map.units[1], bundle.map.units[3]];
  const reference = bundle.map.evidence.find((e: any) => e.span.path === peers[0].primary_span.path);
  const event = bundle.map.events.find((e: any) => e.unit_id === subject.unit_id);
  bundle.map.design_patterns = [
    {
      pattern_id: 'pattern_mock',
      label: '模擬の設計パターン',
      kind: 'domain_rule',
      description: '読み取った処理の共通ルール',
      scope_note: '比較UIの技術検証用。実際の意味判定ではありません。',
      peer_unit_ids: peers.map((p: any) => p.unit_id),
      evidence_ids: [reference.evidence_id],
      exceptions: [],
    },
  ];
  bundle.map.review_signals = [
    {
      ...bundle.map.review_signals[0],
      signal_id: 'signal_mock',
      review_axis: 'coherence',
      human_review_required: false,
      human_review_reason: '',
      unit_ids: [subject.unit_id],
      event_ids: [event.event_id],
      evidence_ids: event.evidence_ids,
      comparison: {
        pattern_id: 'pattern_mock',
        reference_unit_id: peers[0].unit_id,
        reference_span: peers[0].primary_span,
        reference_evidence_ids: [reference.evidence_id],
        observed_difference: '比較した実装とは判断の配置が異なる（模擬）',
      },
    },
  ];
  // Use the real kit hash; the mock only changes interpretation, never audio assets.
  bundle.map.review_signals[0].counter_explanation = '模擬：別契約という反証を読取根拠で検討';
  bundle.map.review_signals[0].counter_status = 'rejected';
  const kit = JSON.parse(readFileSync('apps/web/public/audio/midnight-jazz-v4/manifest.json', 'utf8'));
  bundle.score = await compileGroove(bundle.map, kit.kit_hash);
  let writes = 0;
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().includes('/api/v1/')) writes++;
  });
  await page.route('**/api/v1/samples/recorded-returns-before/bundle', (route) =>
    route.fulfill({ json: { data: bundle } }),
  );
  await page.goto(
    `/projects/sample-recorded-returns-before/inspect?view=score&unit=${subject.unit_id}&event=${event.event_id}&signal=signal_mock`,
  );

  const comparison = page.getByTestId('design-comparison');
  await expect(comparison).toContainText('比較で確認した違い');
  await expect(comparison).toContainText('160 ticks');
  await expect(page.getByTestId('design-patterns')).toContainText('多数派であることは品質の根拠になりません');
  await comparison.getByRole('button').last().click();
  await expect(page.locator('.monaco-editor')).toBeVisible({ timeout: 20000 });
  await expect(page.locator('.code-panel .panel-heading')).toContainText(reference.span.path);
  await expect(page.locator('.code-highlight')).not.toHaveCount(0);
  for (const width of [1440, 1280, 980]) {
    await page.setViewportSize({ width, height: width === 980 ? 600 : 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: 'artifacts/design-review-r14-mock.png' });
  bundle.map.review_signals[0].verdict = 'inconclusive';
  bundle.map.review_signals[0].human_review_required = true;
  bundle.map.review_signals[0].human_review_reason = 'この差は外部契約の意図ですか？';
  bundle.score = await compileGroove(bundle.map, kit.kit_hash);
  await page.reload();

  await expect(page.getByTestId('human-review')).toContainText('この差は外部契約の意図ですか？');
  await expect(page.getByTestId('cue-note')).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: '選択した範囲への質問' })).toBeVisible();
  await page.getByRole('button', { name: '選択箇所の保存された説明を見る' }).click();
  await expect(page.locator('.saved-answer')).toContainText('新しいモデル呼び出しなし');
  expect(writes).toBe(0);
  expect(errors).toEqual([]);
});

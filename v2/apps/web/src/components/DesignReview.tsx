import { ArrowUpRight } from 'lucide-react';
import type { ReviewSignal, Span } from '../../../../packages/contracts/SemanticMap';
import type { Bundle } from '../api';
import { useWorkspace } from '../state';

export const reviewAxes = {
  coherence: 'Coherence · 設計の一貫性',
  quality: 'Quality · 保守性・設計上の品質',
  correctness: 'Correctness · 動作の正しさ',
};

export function DesignReview({ bundle, signal }: { bundle: Bundle; signal?: ReviewSignal }) {
  const ws = useWorkspace();
  const patterns = (bundle.map.design_patterns ?? []).filter(
    (p) => p.peer_unit_ids.includes(ws.unitId) || p.pattern_id === signal?.comparison?.pattern_id,
  );
  const subject = bundle.map.units.find((u) => signal?.unit_ids.includes(u.unit_id));
  const reference = bundle.map.evidence.find((e) =>
    signal?.comparison?.reference_evidence_ids.includes(e.evidence_id),
  );
  function excerpt(title: string, span: Span) {
    const lines = (bundle.sources[span.path] ?? '').split('\n').slice(span.start_line - 1, span.end_line);
    return (
      <div className="comparison-source">
        <b>{title}</b>
        <button
          className="evidence-link"
          onClick={() =>
            ws.set({ codeSpan: span, screen: 'inspect', signalId: signal?.signal_id ?? '', following: false })
          }
        >
          {span.path}:{span.start_line}–{span.end_line}
          <ArrowUpRight size={14} />
        </button>
        <pre>{lines.slice(0, 10).join('\n').slice(0, 1600)}</pre>
        {lines.length > 10 && <small>冒頭10行 · 行番号を選ぶと読取範囲全体を確認</small>}
      </div>
    );
  }
  return (
    <>
      {signal && <div className="review-axis">{reviewAxes[signal.review_axis ?? 'coherence']}</div>}
      {signal && (signal.human_review_required || signal.verdict === 'inconclusive') && (
        <div className="human-review" data-testid="human-review">
          <b>Human Review Required · 設計意図の確認</b>
          <p>{signal.human_review_reason || signal.alternative}</p>
          <small>判断保留の箇所に懸念のリズムは追加しません。</small>
        </div>
      )}
      {!!patterns.length && (
        <details className="design-patterns" open={!!signal?.comparison} data-testid="design-patterns">
          <summary>確認した設計パターン · {patterns.length}</summary>
          {patterns.map((pattern) => (
            <div key={pattern.pattern_id}>
              <b>{pattern.label}</b>
              <p>{pattern.description}</p>
              <small>{pattern.scope_note}</small>
              <small>比較に使った実装：{pattern.peer_unit_ids.length} 件</small>
              {pattern.evidence_ids.map((id) => {
                const proof = bundle.map.evidence.find((e) => e.evidence_id === id);
                return (
                  proof && (
                    <button
                      key={id}
                      className="evidence-link"
                      onClick={() => ws.set({ codeSpan: proof.span, screen: 'inspect' })}
                    >
                      {proof.span.path}:{proof.span.start_line}–{proof.span.end_line}
                      <ArrowUpRight size={14} />
                    </button>
                  )
                );
              })}
              <p className="limit-note">同じ作り方の観察です。多数派であることは品質の根拠になりません。</p>
              {(pattern.exceptions ?? []).map((exception) => (
                <p key={exception.unit_id}>理由のある例外：{exception.reason}</p>
              ))}
            </div>
          ))}
        </details>
      )}
      {signal?.comparison && subject && reference && (
        <div className="design-comparison" data-testid="design-comparison">
          <b>比較で確認した違い</b>
          <p>{signal.comparison.observed_difference}</p>
          <div className="comparison-sources">
            {excerpt('確認する実装', subject.primary_span)}
            {excerpt('比較した別の実装', signal.comparison.reference_span)}
          </div>
          <small>比較コードは実際の読取記録から表示。違いだけで問題とは断定しません。</small>
          {signal.verdict === 'concern' && signal.review_axis === 'coherence' && (
            <p className="limit-note">
              この比較の音：同種のパターンは同じ伴奏リズム。確認した懸念は2打目を160
              ticks遅らせ、同じ旋律で差を表します。正しさや深刻度の点数ではありません。
            </p>
          )}
        </div>
      )}
    </>
  );
}

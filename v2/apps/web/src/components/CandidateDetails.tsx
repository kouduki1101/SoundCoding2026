import type { ReviewSignal } from '../../../../packages/contracts/SemanticMap';
import type { Bundle } from '../api';
import { counterStatusText, verdictText } from '../reviewNavigation';
import { useWorkspace } from '../state';

export function CandidateDetails({ bundle, signal }: { bundle: Bundle; signal: ReviewSignal }) {
  const ws = useWorkspace();
  const unknowns = [
    ...new Set([
      ...(signal.human_review_required
        ? [signal.human_review_reason || '設計意図は人の確認が必要です。']
        : []),
      ...(signal.counter_status === 'not_checked' ? ['別の説明を確認した記録がありません。'] : []),
      ...(signal.counter_status === 'undetermined' ? ['別の説明の妥当性は判断保留です。'] : []),
      ...(!signal.comparison ? ['対応する別実装との比較は、この記録では未確認です。'] : []),
      ...bundle.map.profile.unknowns,
      '実行時の経路と動作は確認していません。',
    ]),
  ];
  return (
    <article className="candidate-details" data-testid="candidate-details">
      <small>{verdictText[signal.verdict]} · 保存された解釈</small>
      <h3>{signal.label}</h3>
      <b>観察した違い</b>
      <p>{signal.comparison?.observed_difference || '別実装との対応を確認した観察は保存されていません。'}</p>
      <b>Agentの解釈</b>
      <p>{signal.explanation}</p>
      <b>別の説明と確認状態</b>
      <p className="counter-status">{counterStatusText[signal.counter_status ?? 'not_checked']}</p>
      <p>{signal.counter_explanation || '別の説明の内容・確認根拠は未記録です。'}</p>
      {signal.alternative_evidence_ids?.map((id) => {
        const proof = bundle.map.evidence.find((item) => item.evidence_id === id);
        return (
          proof && (
            <button
              key={id}
              className="evidence-link"
              onClick={() => ws.set({ codeSpan: proof.span, signalId: signal.signal_id, following: false })}
            >
              別の説明の根拠 · {proof.span.path}:{proof.span.start_line}–{proof.span.end_line}
            </button>
          )
        );
      })}
      <b>未確認事項</b>
      <ul>
        {unknowns.map((unknown) => (
          <li key={unknown}>{unknown}</li>
        ))}
      </ul>
      <small>観察と反証の確認記録は、欠陥の確定や人の判断を意味しません。</small>
    </article>
  );
}

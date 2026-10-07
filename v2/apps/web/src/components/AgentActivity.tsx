import { LoaderCircle } from 'lucide-react';
import type { TraceEvent } from './AgentPanel';

const toolLabels: Record<string, string> = {
  read_code: 'コードを読む',
  list_units: '検査する実装の一覧を確認',
  inspect_relations: '呼び出し元・関連実装をたどる',
  update_progress: '調査状況を更新',
  search_code: '関連する判断を探す',
  record_hypothesis: '仮説を記録',
  submit_analysis: '健診結果を提出',
  submit_investigation: '調査結果を提出',
  submit_proposal: '差分案を提出',
};
export function AgentActivity({
  status,
  kind,
  events,
  open,
}: {
  status: string;
  kind?: string;
  events: TraceEvent[];
  open?: () => void;
}) {
  const judging = status === 'investigating';
  const actions = events.filter((e) =>
    ['tool_started', 'tool_completed', 'hypothesis_recorded', 'progress'].includes(e.type),
  );
  const latest = actions.findLast((e) => e.type !== 'hypothesis_recorded');
  const hypothesis = actions.findLast((e) => e.type === 'hypothesis_recorded');
  const purpose = latest?.payload.purpose || latest?.payload.message;
  const read = actions.findLast((e) => e.type === 'tool_completed' && e.payload.target?.path);
  const target = read?.payload.target as { path?: string; start_line?: number } | undefined;
  const tool = latest?.payload.tool;
  return (
    <section className="global-agent-activity" data-testid="agent-activity" role="status" aria-live="polite">
      <div>
        <LoaderCircle size={15} className="activity-spinner" />
        <strong>
          {judging
            ? kind === 'proposal'
              ? 'Gemini Agentが差分案を検討中'
              : 'Gemini Agentが調査中'
            : status === 'compiling'
              ? '調査結果を楽譜に変換中'
              : 'コードを準備中'}
        </strong>
        {open && <button onClick={open}>調査を見る</button>}
      </div>
      {judging && (
        <small>
          直近の操作：{toolLabels[String(tool)] || String(tool || 'モデル応答を待っています')}
          {purpose ? ` · ${String(purpose).slice(0, 140)}` : ''}
          {target?.path ? ` · 直近の読取 ${target.path}:${target.start_line ?? 1}` : ''}
        </small>
      )}
      {judging && hypothesis && (
        <small>Agentが記録した仮説：{String(hypothesis.payload.statement).slice(0, 140)}</small>
      )}
      {judging && hypothesis?.payload.counter_question && (
        <small>確かめる別説明：{String(hypothesis.payload.counter_question).slice(0, 120)}</small>
      )}
      {!judging && (
        <small>
          {status === 'indexing'
            ? '構文からファイル・関数の索引を作成。意味の判断はこの後Agentが行います。'
            : status === 'compiling'
              ? 'Agentの解釈を固定のリズム規則へ変換しています。'
              : '取得・待機中。まだモデルの調査は始まっていません。'}
        </small>
      )}
    </section>
  );
}

import { useState } from 'react';
import { ArrowUpRight, Send, ScanLine } from 'lucide-react';
import type { InvestigationResult, SemanticMap } from '../../../../packages/contracts';
import type { Bundle } from '../api';
import { useWorkspace } from '../state';
import { DesignReview, reviewAxes } from './DesignReview';
import { CandidateDetails } from './CandidateDetails';
import { CallRelationshipsPanel } from './CallRelationshipsPanel';
export type TraceEvent = { seq: number; type: string; timestamp: string; payload: Record<string, any> };
const staticDemo = import.meta.env.VITE_STATIC_DEMO === '1';

function EvidenceTrail({ bundle, evidenceIds }: { bundle: Bundle; evidenceIds: string[] }) {
  const ws = useWorkspace();
  const evidence = bundle.map.evidence.filter((proof) => evidenceIds.includes(proof.evidence_id));
  if (!evidence.length) return null;
  return (
    <details className="evidence-trail" key={evidenceIds.join(',')} data-testid="selected-evidence">
      <summary>この音の根拠 · {evidence.length} 件の読取範囲</summary>
      <small>音の意味はGeminiの解釈です。確認したソース行へ戻って判断できます。</small>
      {evidence.map((proof) => {
        const receipt = bundle.trace?.find(
          (e) => e.type === 'tool_completed' && e.payload.evidence_ids?.includes(proof.evidence_id),
        );
        return (
          <div className="evidence-proof" key={proof.evidence_id}>
            <button
              className="evidence-link"
              onClick={() => ws.set({ codeSpan: proof.span, screen: 'inspect' })}
            >
              {proof.span.path}:{proof.span.start_line}–{proof.span.end_line}
              <ArrowUpRight size={14} />
            </button>
            <p>読取の目的：{proof.observation}</p>
            {receipt && (
              <small>
                Agentの読取記録 #{receipt.seq} · {receipt.payload.purpose}
              </small>
            )}
            <small className="proof-hash" title={proof.projection_sha256}>
              確認した内容のSHA-256: {proof.projection_sha256.slice(0, 12)}
            </small>
          </div>
        );
      })}
    </details>
  );
}
export function AgentPanel({
  bundle,
  result,
  events,
  pending,
  investigate,
  publish,
  error,
  activateLive,
  propose,
  proposing = false,
  proposalTitle,
  openProposal,
  cancelProposal,
  question,
  setQuestion,
}: {
  bundle: Bundle;
  result?: InvestigationResult;
  events: TraceEvent[];
  pending: boolean;
  investigate: (question: string) => void;
  publish: () => void;
  error: string;
  activateLive?: () => void;
  propose: (signalId: string) => void;
  proposing?: boolean;
  proposalTitle?: string;
  openProposal: () => void;
  cancelProposal: () => void;
  question: string;
  setQuestion: (value: string) => void;
}) {
  const ws = useWorkspace(),
    [savedExplanation, setSavedExplanation] = useState({ selection: '', text: '' });
  const selectionKey = `${bundle.map.analysis_id}:${ws.unitId}:${ws.eventId}`;
  const savedAnswer = savedExplanation.selection === selectionKey ? savedExplanation.text : '';
  const event = bundle.map.events.find((e) => e.event_id === ws.eventId);
  const unit = bundle.map.units.find((u) => u.unit_id === ws.unitId) ?? bundle.map.units[0];
  const supportingFile =
    !!ws.codeSpan && !bundle.map.units.some((u) => u.primary_span.path === ws.codeSpan?.path);
  const selectedSignal =
    bundle.map.review_signals?.find((s) => s.signal_id === ws.signalId) ??
    (supportingFile
      ? undefined
      : (bundle.map.review_signals?.find((s) => s.event_ids.includes(ws.eventId)) ??
        bundle.map.review_signals?.find((s) => s.unit_ids.includes(unit.unit_id))));
  const fixture = bundle.map.origin === 'fixture';
  const recorded = bundle.map.origin === 'recorded_live' && !!ws.sampleId;
  const overview = bundle.map.analysis_depth === 'overview';
  const role = bundle.map.responsibilities.find((r) => r.responsibility_id === event?.responsibility_id);
  const related = role ? bundle.map.events.filter((e) => e.responsibility_id === role.responsibility_id) : [];
  return (
    <section className="agent-panel">
      <div className="panel-heading">
        <span>
          <button
            className="agent-window-toggle"
            aria-label="AgentWindowを非表示"
            aria-expanded={ws.agentVisible}
            aria-controls="workspace-agent"
            onClick={() => ws.set({ agentVisible: !ws.agentVisible })}
          >
            <ScanLine size={15} />
          </button>{' '}
          {fixture ? 'サンプルの説明' : 'Gemini Agent'}
        </span>
        <span className={`agent-indicator ${pending ? 'working' : ''}`}>
          {fixture
            ? '模擬'
            : proposing
              ? '改善案を作成中'
              : pending
                ? '調査中'
                : bundle.map.origin === 'recorded_live'
                  ? '保存済み'
                  : '実解析'}
        </span>
      </div>
      <div className="agent-content">
        {bundle.case_study && (
          <details className="case-study" data-testid="case-provenance">
            <summary>
              <span className="eyebrow">REAL CODE / SAVED GEMINI REVIEW</span>
              <strong>{bundle.case_study.title}</strong>
              <small>
                {bundle.map.coverage.inspected_units}/{bundle.map.coverage.indexed_units} 実装を確認 ·
                この検査範囲
              </small>
              {bundle.repository && (
                <small>
                  {bundle.repository.analyzed_chunks}/{bundle.repository.chunks.length} 範囲に保存結果 ·
                  残りは未検査
                </small>
              )}
            </summary>
            <p>{bundle.case_study.context}</p>
            <p>{bundle.case_study.scope}</p>
            <p>
              元の{bundle.case_study.repository_source_files}
              実装ファイルのうち、保存済み解析には11ファイルを取り込み。左の全体の参考コードは別表示です。範囲間の統合判定と実行動作は未検証です。
            </p>
            <dl>
              <dt>元コードの確定版</dt>
              <dd>
                <code>{bundle.case_study.revision.slice(0, 12)}</code>
              </dd>
              <dt>解析の記録日</dt>
              <dd>
                {new Date(bundle.case_study.recorded_at).toLocaleDateString('ja-JP', {
                  timeZone: 'Asia/Tokyo',
                })}
              </dd>
              <dt>解析モデル</dt>
              <dd>{bundle.map.model_id}</dd>
              <dt>コードのライセンス</dt>
              <dd>{bundle.case_study.license}</dd>
            </dl>
            <a href={bundle.case_study.repository_url} target="_blank" rel="noreferrer">
              この確定版の元コードを読む ↗
            </a>
          </details>
        )}
        <div className="selected-file">
          {ws.codeSpan?.path ?? event?.span.path ?? unit?.primary_span.path}
        </div>
        {selectedSignal && ws.signalId && <CandidateDetails bundle={bundle} signal={selectedSignal} />}
        {(!selectedSignal || overview) && (
          <>
            <h3>{supportingFile ? '関連資料・型定義' : overview ? 'この音が表す役割' : 'この箇所の判断'}</h3>
            <p>
              {supportingFile
                ? 'このファイルに直接の発音イベントはありません。Agentが実装の意味を判断する際の関連資料として確認できます。'
                : (event?.meaning ?? unit?.boundary_reason)}
            </p>
          </>
        )}
        {!supportingFile && (
          <EvidenceTrail bundle={bundle} evidenceIds={event?.evidence_ids ?? unit.evidence_ids} />
        )}
        <DesignReview bundle={bundle} signal={selectedSignal} />
        <CallRelationshipsPanel bundle={bundle} />
        {overview && role && (
          <div className="motif-map" data-tour="investigate">
            <div className="section-label">
              {role.motif_id} / {role.label}
            </div>
            <p>
              この旋律は {new Set(related.map((e) => e.span.path)).size}{' '}
              ファイルに現れます。配置は事実、良し悪しは設計理由によります。
            </p>
            {[...new Map(related.map((e) => [e.span.path, e])).values()].map((e) => (
              <button
                className="evidence-link"
                key={e.event_id}
                onClick={() => ws.set({ unitId: e.unit_id, eventId: e.event_id, codeSpan: null })}
              >
                {e.span.path}:{e.span.start_line}
                <ArrowUpRight size={14} />
              </button>
            ))}
            <small>
              同じ役割は同じ音形の系列。同じ意味キーは同じ音高です。伴奏は品質の点数ではありません。
            </small>
          </div>
        )}
        {overview && !!bundle.map.review_signals?.length && (
          <details className="initial-notes">
            <summary>初回健診で見つけた点 · {bundle.map.review_signals.length}</summary>
            {bundle.map.review_signals.map((s) => (
              <div key={s.signal_id}>
                <b>
                  <span className="review-axis">{reviewAxes[s.review_axis ?? 'coherence']}</span>
                  {s.verdict === 'concern'
                    ? s.review_axis === 'correctness'
                      ? '動作の確認事項'
                      : '将来の負担候補'
                    : s.verdict === 'justified'
                      ? '境界の理由'
                      : '要確認'}{' '}
                  / {s.label}
                </b>
                <p>{s.explanation}</p>
                <small>{s.alternative}</small>
                <button
                  className="evidence-link"
                  onClick={() => {
                    const target =
                      bundle.map.events.find((e) => s.event_ids.includes(e.event_id)) ??
                      bundle.map.units.find((u) => s.unit_ids.includes(u.unit_id));
                    if (target)
                      ws.set({
                        unitId: target.unit_id,
                        eventId: 'event_id' in target ? target.event_id : '',
                        signalId: s.signal_id,
                        codeSpan: null,
                        screen: 'inspect',
                        scene: Math.max(
                          0,
                          bundle.score.scenes.findIndex((scene) => scene.unit_ids.includes(target.unit_id)),
                        ),
                      });
                  }}
                >
                  判断のある実装を選ぶ <ArrowUpRight size={14} />
                </button>
              </div>
            ))}
          </details>
        )}
        {overview && !!bundle.map.profile.unknowns.length && (
          <details className="initial-notes">
            <summary>未確認・前提の限界</summary>
            {bundle.map.profile.unknowns.map((v) => (
              <p key={v}>{v}</p>
            ))}
          </details>
        )}
        {selectedSignal && (!overview || selectedSignal.comparison || ws.signalId) && (
          <div className={`structural-finding ${selectedSignal.verdict}`}>
            <div className="finding-label">
              {selectedSignal.review_axis === 'correctness'
                ? '動作の正しさの確認'
                : selectedSignal.review_axis === 'quality'
                  ? '設計上の品質の確認'
                  : selectedSignal.verdict === 'concern'
                    ? selectedSignal.category === 'data_flow_opacity'
                      ? '処理の流れを追う負担'
                      : selectedSignal.category === 'responsibility_mixing'
                        ? '異なる判断が混ざる箇所'
                        : '同じ変更で、一緒に直す箇所'
                    : selectedSignal.verdict === 'justified'
                      ? '理由のある境界'
                      : '判断は保留'}
            </div>
            {!ws.signalId && <p>{selectedSignal.explanation}</p>}
            {selectedSignal.change_scenario && (
              <div className="change-scenario">
                <b>
                  {selectedSignal.category === 'data_flow_opacity'
                    ? 'この処理を読み解くとき'
                    : '例えば、仕様がこう変わったら'}
                </b>
                {selectedSignal.change_scenario}
              </div>
            )}
            <details className="alternative">
              <summary>設計上の検討案（反証とは別）</summary>
              <p>{selectedSignal.alternative}</p>
            </details>
            {!ws.signalId && (
              <details className="counter-evidence">
                <summary>
                  反証：
                  {
                    (
                      {
                        not_checked: '確認記録なし',
                        supported: '別の説明を支持',
                        rejected: '別の説明を棄却',
                        undetermined: '判断保留',
                      } as const
                    )[selectedSignal.counter_status ?? 'not_checked']
                  }
                </summary>
                <p>
                  {selectedSignal.counter_explanation ||
                    'この保存結果には、別の説明を検証した記録がありません。懸念は確定した欠陥を意味しません。'}
                </p>
                {selectedSignal.alternative_evidence_ids?.map((id) => {
                  const proof = bundle.map.evidence.find((e) => e.evidence_id === id);
                  return (
                    proof && (
                      <button
                        key={id}
                        className="evidence-link"
                        onClick={() => ws.set({ codeSpan: proof.span, screen: 'inspect' })}
                      >
                        {proof.span.path}:{proof.span.start_line}–{proof.span.end_line}
                      </button>
                    )
                  );
                })}
              </details>
            )}
            {selectedSignal.evidence_ids.map((id) => {
              const proof = bundle.map.evidence.find((e) => e.evidence_id === id);
              return (
                proof && (
                  <button
                    key={id}
                    className="evidence-link"
                    onClick={() => {
                      const target = bundle.map.units.find(
                        (u) =>
                          u.primary_span.path === proof.span.path &&
                          u.primary_span.start_line <= proof.span.start_line &&
                          u.primary_span.end_line >= proof.span.end_line,
                      );
                      ws.set({
                        codeSpan: proof.span,
                        screen: 'inspect',
                        ...(target ? { unitId: target.unit_id } : {}),
                        signalId: selectedSignal.signal_id,
                        following: false,
                      });
                    }}
                  >
                    {proof.span.path}:{proof.span.start_line}
                    <ArrowUpRight size={14} />
                  </button>
                )
              );
            })}
          </div>
        )}
        {selectedSignal?.verdict === 'concern' &&
          (selectedSignal.review_axis ?? 'coherence') === 'coherence' &&
          !selectedSignal.human_review_required &&
          !staticDemo &&
          !fixture &&
          !overview && (
            <div className="improvement-action" data-tour="improve">
              <button
                className="primary wide"
                disabled={pending || proposing}
                onClick={() => propose(selectedSignal.signal_id)}
              >
                <ScanLine size={15} />
                {proposing ? 'Geminiが改善案を作成中…' : 'Geminiに改善案を依頼'}
              </button>
              <small>コードの書き方と責務を検討 → 差分を確認 → あなたが採用</small>
            </div>
          )}
        {proposing && (
          <p className="progress-line">
            <span className="spinner" />
            {events.filter((e) => e.type === 'progress' || e.type === 'tool_started').at(-1)?.payload
              .message ??
              events.filter((e) => e.type === 'tool_started').at(-1)?.payload.purpose ??
              '関連コードを読み、変更の狙いと代案を検討しています…'}
          </p>
        )}
        {proposing && (
          <button className="wide" onClick={cancelProposal}>
            改善案の作成を停止
          </button>
        )}
        {proposalTitle && (
          <button className="proposal-ready wide" data-tour="proposal" onClick={openProposal}>
            差分を確認：{proposalTitle}
            <ArrowUpRight size={15} />
          </button>
        )}
        {fixture || recorded ? (
          <>
            {selectedSignal?.verdict === 'concern' && !overview && (
              <p className="rhythm-explanation">
                {selectedSignal.category === 'data_flow_opacity'
                  ? '応答が途切れる = 処理を追うために判断をまたぐ箇所。'
                  : '同じ責務の意味キーが別ファイルにもある、という保存済み解釈です。'}
                「意味で揃える」で配置を確認できます。懸念の音には、比較対象と反証の確認記録が必要です。
              </p>
            )}
            {recorded && bundle.investigation && (
              <>
                <div className="section-label">保存済み追加調査</div>
                <FindingCards result={bundle.investigation} map={bundle.map} />
              </>
            )}
            {recorded && (
              <details className="trace">
                <summary>
                  Agentの実行記録 · {bundle.trace?.filter((e) => e.type === 'tool_completed').length ?? 0}{' '}
                  回のツール調査
                </summary>
                {bundle.trace
                  ?.filter((e) => e.type === 'tool_completed' || e.type === 'hypothesis_recorded')
                  .map((e) => (
                    <div key={e.seq}>
                      <b>{e.payload.tool ?? e.type}</b>
                      <small>
                        {e.payload.purpose ?? e.payload.message ?? e.payload.statement ?? e.payload.code}
                      </small>
                    </div>
                  ))}
              </details>
            )}
            <p className="limit-note">
              {staticDemo
                ? '保存済みの実解析です。この公開デモでは新しいAgent調査は利用できません。'
                : fixture
                ? 'この説明は模擬データです。Agentの実調査ログではありません。'
                : bundle.partition
                  ? 'この検査範囲の保存済み実解析です。追加調査や未検査範囲の続きはログイン後に開始できます。'
                  : '取り込んだ対象範囲の保存済み解析です。実行動作やRepository全体の健全性は未検証。新規調査はログイン後に開始できます。'}
            </p>
          </>
        ) : (
          <>
            {pending && (
              <p className="progress-line">
                <span className="spinner" />
                選択した範囲と関連する実装を調べています…
              </p>
            )}
            <FindingCards result={result} map={bundle.map} />
            {result &&
            (result.suggested_reclassification?.length ||
              result.review_signals?.length ||
              result.replaced_signal_ids?.length ||
              result.design_patterns?.length) ? (
              <button className="primary wide" onClick={publish}>
                調査結果を演奏に反映
                <ArrowUpRight size={15} />
              </button>
            ) : null}
            {!!bundle.trace?.length && (
              <details className="trace">
                <summary>
                  Agentの実行記録 · {bundle.trace.filter((e) => e.type === 'tool_completed').length}
                  回のツール調査
                </summary>
                {bundle.trace
                  .filter((e) => e.type === 'tool_completed' || e.type === 'hypothesis_recorded')
                  .map((e) => (
                    <div key={e.seq}>
                      <b>{e.payload.tool ?? e.type}</b>
                      <small>{e.payload.purpose ?? e.payload.message ?? e.payload.statement}</small>
                    </div>
                  ))}
              </details>
            )}
            {!!events.length && (
              <details className="trace">
                <summary>
                  追加調査の記録 · {events.filter((e) => e.type === 'tool_completed').length}
                  回のツール調査
                </summary>
                {events.map((e) => (
                  <div key={e.seq}>
                    <b>{e.payload.tool ?? e.type}</b>
                    <small>{e.payload.purpose ?? e.payload.message ?? e.payload.code}</small>
                  </div>
                ))}
              </details>
            )}
          </>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </div>
      {savedAnswer && (
        <div className="saved-answer">
          <small>保存された説明 · 新しいモデル呼び出しなし</small>
          <p>{savedAnswer}</p>
        </div>
      )}
      {fixture || recorded ? (
        <div className="question-form">
          <button
            className="wide"
            onClick={() =>
              setSavedExplanation({
                selection: selectionKey,
                text: `${event?.meaning ?? unit?.boundary_reason ?? bundle.map.profile.purpose}${selectedSignal ? ` ${selectedSignal.explanation}` : ''}`,
              })
            }
          >
            選択箇所の保存された説明を見る
          </button>
          {!staticDemo && (
            <>
              <small>この記録への新しい質問は、保存してAgentに調査を依頼できます。</small>
              <button className="live-question" onClick={activateLive}>
                この記録を保存して精密検査
              </button>
            </>
          )}
        </div>
      ) : null}
      {staticDemo ? (
        <p className="question-form limit-note">この公開デモでは、保存済みの説明と根拠を閲覧できます。</p>
      ) : <form
        className="question-form"
        onSubmit={(e) => {
          e.preventDefault();
          investigate(
            question ||
              'この旋律が複数箇所で戻る理由と、将来の変更・理解の負担を調べてください。分離を保つ正当な理由も確認し、経過観察かリファクタリング候補かを説明してください。',
          );
        }}
      >
        <details className="question-presets">
          <summary>質問の例</summary>
          <button
            type="button"
            disabled={pending || proposing}
            onClick={() =>
              setQuestion(
                'この旋律が別のファイルでも戻るのはなぜ？関連する処理を読み直し、将来の負担と分離を保つ理由を調べてください。',
              )
            }
          >
            この旋律の関係は？
          </button>
          <button
            type="button"
            disabled={pending || proposing}
            onClick={() =>
              setQuestion(
                '今は正常に動く前提で、ここの書き方・処理の流れが将来の変更や理解の負担になる可能性は？抽出による複雑化も含めて検討してください。',
              )
            }
          >
            将来の負担は？
          </button>
        </details>
        <div>
          <input
            aria-label="選択した範囲への質問"
            maxLength={1000}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="聴いて気になった関係を質問…"
          />
          <button aria-label="質問を送信" disabled={pending || proposing}>
            <Send size={16} />
          </button>
        </div>
        <small>
          {fixture || recorded
            ? '保存済み根拠を読む · 新規Agent調査はログイン後'
            : '選択範囲と関連コードだけ調査 · 読み取り専用'}
        </small>
      </form>}
    </section>
  );
}

function FindingCards({ result, map }: { result?: InvestigationResult; map: SemanticMap }) {
  const ws = useWorkspace();
  const titles = {
    concern: '将来の負担候補',
    justified_difference: '理由のある違い',
    inconclusive: 'Human Review Required · 判断保留',
    no_specific_concern: '注目点なし',
  };
  return (
    <>
      {result?.findings.map((finding) => (
        <div className="finding" key={finding.finding_id}>
          <div className="finding-label">{titles[finding.verdict]}</div>
          <div className="review-axis">{reviewAxes[finding.review_axis ?? 'coherence']}</div>
          <p>{finding.summary}</p>
          <small>{finding.justification}</small>
          <div className="section-label">EVIDENCE</div>
          {finding.evidence_ids.slice(0, 3).map((id) => {
            const evidence =
              result.evidence.find((e) => e.evidence_id === id) ??
              map.evidence.find((e) => e.evidence_id === id);
            return (
              evidence && (
                <button
                  key={id}
                  className="evidence-link"
                  onClick={() => ws.set({ codeSpan: evidence.span })}
                >
                  {evidence.span.path}:{evidence.span.start_line}
                  <ArrowUpRight size={14} />
                </button>
              )
            );
          })}
          {finding.limitation && <p className="limit-note">限界：{finding.limitation}</p>}
          {finding.discussion_question && <blockquote>{finding.discussion_question}</blockquote>}
        </div>
      ))}
    </>
  );
}

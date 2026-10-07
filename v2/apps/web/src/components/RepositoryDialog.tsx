import type { RepositoryStatus } from '../api';
import { Dialog } from './Dialogs';
import { useState } from 'react';

export function RepositoryDialog({
  repository,
  close,
  analyze,
  open,
  pending,
  integrate,
}: {
  repository: RepositoryStatus;
  close: () => void;
  analyze: (chunkId: string, retryPartial?: boolean) => void;
  open: (analysisId: string) => void;
  pending: boolean;
  integrate: (chunkIds: string[], unitIds: string[]) => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [unitIds, setUnitIds] = useState<string[]>([]);
  return (
    <Dialog title="リポジトリ全体の検査範囲" close={close}>
      <p className="dialog-intro">
        {repository.eligible_source_files}ファイル / {repository.source_lines.toLocaleString()}行を索引化。
        {repository.analyzed_chunks}/{repository.chunks.length}範囲に保存結果があります。
      </p>
      <p>
        {repository.inspected_units}実装を検査済み · {repository.pending_units}実装は未検査 ·{' '}
        {repository.unresolved_units}実装は未解決
      </p>
      <small>
        通常の範囲ごとの責務分類は独立です。統合調査も選択した実装のみで、全体の健全性は未判定。検査には日次上限を適用します。保存結果の再生はAI費用なし。
      </small>
      <fieldset className="integration-selection">
        <legend>範囲間の意味を統合調査</legend>
        <p>
          保存結果のある2–4範囲を選びます。同じ変更理由かを、新しいコード読取で比較します。選択外は未判定です。
        </p>
        {repository.chunks
          .filter((c) => c.analysis_id && c.unit_ids?.length)
          .map((c) => (
            <label className="checkbox" key={c.chunk_id}>
              <input
                type="checkbox"
                checked={selected.includes(c.chunk_id)}
                disabled={pending || (!selected.includes(c.chunk_id) && selected.length === 4)}
                onChange={(e) => {
                  setSelected(
                    e.target.checked ? [...selected, c.chunk_id] : selected.filter((id) => id !== c.chunk_id),
                  );
                  setUnitIds(
                    e.target.checked
                      ? [...unitIds, ...(c.unit_ids ?? [])]
                      : unitIds.filter((id) => !c.unit_ids?.includes(id)),
                  );
                }}
              />
              {c.label} / {c.units}実装
            </label>
          ))}
        <small>選択 {unitIds.length}実装（上限32） · 新規AI解析1回 · 日次10回・既存トークン上限内</small>
        {!!selected.length && (
          <details className="integration-owners">
            <summary>統合する実装を選ぶ（選択 {unitIds.length}）</summary>
            {repository.chunks
              .filter((c) => selected.includes(c.chunk_id))
              .flatMap((c) => c.owner_units ?? [])
              .map((u) => (
                <label className="checkbox" key={u.unit_id}>
                  <input
                    type="checkbox"
                    checked={unitIds.includes(u.unit_id)}
                    disabled={pending}
                    onChange={(e) =>
                      setUnitIds(
                        e.target.checked ? [...unitIds, u.unit_id] : unitIds.filter((id) => id !== u.unit_id),
                      )
                    }
                  />
                  {u.label} · {u.span.path}:{u.span.start_line}–{u.span.end_line}
                </label>
              ))}
            <small>各範囲から最低1実装を選びます。選択外を自動で切り捨てた解析にはしません。</small>
          </details>
        )}
        {unitIds.length > 32 && <p role="alert">32実装を超えています。統合する実装を選び直してください。</p>}
        <button
          disabled={
            pending ||
            selected.length < 2 ||
            unitIds.length > 32 ||
            unitIds.length < 2 ||
            repository.chunks.some(
              (c) => selected.includes(c.chunk_id) && !c.unit_ids?.some((id) => unitIds.includes(id)),
            )
          }
          onClick={() => integrate(selected, unitIds)}
        >
          選んだ範囲を新規統合調査
        </button>
        {repository.integrations?.map((item) => (
          <button key={item.analysis_id} onClick={() => open(item.analysis_id)}>
            保存した統合結果 / {item.inspected_units}実装
          </button>
        ))}
      </fieldset>
      <div className="repository-chunks">
        {repository.chunks.map((chunk, i) => (
          <div className="repository-chunk" key={chunk.chunk_id}>
            <span>
              <strong>
                {i + 1}. {chunk.label}
              </strong>
              <small>
                {chunk.paths.join(', ')}
                <br />
                {chunk.units}実装 / {chunk.symbol_count}シンボル ·{' '}
                {chunk.status === 'pending'
                  ? '未検査'
                  : chunk.status === 'partial'
                    ? `一部未解決 (${chunk.unresolved_units})`
                    : '検査済み'}
                {chunk.analysis_id && chunk.cache_compatible === false && ' · 以前のAgent版の保存結果'}
              </small>
            </span>
            {chunk.analysis_id ? (
              <span className="repository-actions">
                <button onClick={() => open(chunk.analysis_id!)}>保存結果を開く</button>
                {chunk.cache_compatible === false && (
                  <button disabled={pending} onClick={() => analyze(chunk.chunk_id)}>
                    現行Agentで再検査
                  </button>
                )}
                {chunk.status === 'partial' && (
                  <button disabled={pending} onClick={() => analyze(chunk.chunk_id, true)}>
                    未解決を再検査
                  </button>
                )}
              </span>
            ) : (
              <button disabled={pending} onClick={() => analyze(chunk.chunk_id)}>
                この範囲を検査
              </button>
            )}
          </div>
        ))}
      </div>
      {!!repository.files_without_units.length && (
        <details>
          <summary>関数を持たない{repository.files_without_units.length}ファイル</summary>
          <p>{repository.files_without_units.join(', ')}</p>
          <small>型・契約・定数など。関連調査で参照できます。個別の意味判定はありません。</small>
        </details>
      )}
    </Dialog>
  );
}

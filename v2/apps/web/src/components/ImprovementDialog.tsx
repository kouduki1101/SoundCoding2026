import { Check, X, GitCompareArrows } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { ImprovementProposal } from '../../../../packages/contracts';

export function ImprovementDialog({
  proposal,
  close,
  accept,
  reject,
  pending,
  error,
}: {
  proposal: ImprovementProposal;
  close: () => void;
  accept: () => void;
  reject: () => void;
  pending: boolean;
  error: string;
}) {
  const dialog = useRef<HTMLElement>(null);
  useEffect(() => {
    const prior = document.activeElement as HTMLElement;
    dialog.current?.focus();
    return () => prior?.focus();
  }, []);
  return (
    <div className="modal-backdrop" role="presentation">
      <section
        ref={dialog}
        tabIndex={-1}
        className="improvement-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="改善案を確認"
        onKeyDown={(e) => {
          if (e.key === 'Escape') close();
          if (e.key !== 'Tab') return;
          const nodes = [
            ...e.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),summary,[tabindex="0"]'),
          ];
          if (e.shiftKey && document.activeElement === nodes[0]) {
            e.preventDefault();
            nodes.at(-1)?.focus();
          } else if (!e.shiftKey && document.activeElement === nodes.at(-1)) {
            e.preventDefault();
            nodes[0]?.focus();
          }
        }}
      >
        <header>
          <div>
            <GitCompareArrows size={19} />
            <span>
              Geminiの改善案<small>あなたの判断で採用 · 元のスナップショットは保持</small>
            </span>
          </div>
          <button aria-label="差分を閉じる" onClick={close}>
            <X size={18} />
          </button>
        </header>
        <div className="proposal-intro">
          <h2>{proposal.title}</h2>
          <p>{proposal.rationale}</p>
          <details>
            <summary>トレードオフと必要な確認</summary>
            <p>{proposal.tradeoffs}</p>
            <p>{proposal.verification}</p>
          </details>
        </div>
        <pre className="proposal-diff" aria-label="提案されたコード差分">
          {proposal.diff.split('\n').map((line, i) => (
            <span
              key={i}
              className={
                line.startsWith('+')
                  ? 'diff-add'
                  : line.startsWith('-')
                    ? 'diff-remove'
                    : line.startsWith('@@')
                      ? 'diff-hunk'
                      : ''
              }
            >
              {line}
              {'\n'}
            </span>
          ))}
        </pre>
        <footer>
          <div>
            <b>承認後に、変更箇所と影響先を再解析</b>
            <small>動作保証ではありません。ソースを実行せず、GitHubへは書き込みません。</small>
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
          </div>
          <button disabled={pending || proposal.status !== 'draft'} onClick={reject}>
            却下
          </button>
          <button
            className="primary"
            data-testid="accept-proposal"
            disabled={pending || proposal.status !== 'draft'}
            onClick={accept}
          >
            <Check size={16} />
            {pending ? '再解析を準備中…' : '採用して再解析'}
          </button>
        </footer>
      </section>
    </div>
  );
}

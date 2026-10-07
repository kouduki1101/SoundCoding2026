import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, ClipboardCopy, Pause, Play, Volume2 } from 'lucide-react';
import type { CallRelationships, Span } from '../../../../packages/contracts/CallRelationships';
import type { ImplementationUnit } from '../../../../packages/contracts/SemanticMap';
import { api, type Bundle } from '../api';
import { engine } from '../audio/engine';
import { playbackPlan } from '../audio/playback';
import { buildRelationshipDialogue, type DialoguePhaseId } from '../audio/relationshipDialogue';
import { sequenceExcerpts } from '../audio/excerpts';
import { useAudition } from '../hooks/useAudition';
import { codeExcerpt, rehearsalCases, selectRehearsalLink, type RehearsalCaseId } from './rehearsalModel';
import '../styles/rehearsal.css';

type Take = 'before' | 'after';
type Playhead = { take: Take; phase: DialoguePhaseId };
const beforeSampleId = 'recorded-returns-before';
const afterSampleId = 'recorded-returns-after';
const phaseLabels: Record<DialoguePhaseId, string> = {
  quote: '呼ぶ',
  answer: '応える',
  receive: '受け取る',
  together: '重なる',
};

function memoKey(snapshotId: string, caseId: RehearsalCaseId) {
  return `code-groove:rehearsal-question:${snapshotId}:${caseId}`;
}

function savedQuestion(snapshotId: string, caseId: RehearsalCaseId) {
  try {
    return typeof localStorage === 'undefined'
      ? ''
      : (localStorage.getItem(memoKey(snapshotId, caseId)) ?? '');
  } catch {
    return '';
  }
}

function unit(bundle: Bundle | undefined, label: string): ImplementationUnit | undefined {
  const matches = bundle?.map.units.filter((item) => item.label === label) ?? [];
  return matches.length === 1 ? matches[0] : undefined;
}

function SourceWindow({
  title,
  bundle,
  span,
  active,
  loading,
}: {
  title: string;
  bundle?: Bundle;
  span?: Span;
  active: boolean;
  loading?: boolean;
}) {
  const excerpt = bundle && codeExcerpt(bundle.sources, span);
  return (
    <section className={`rehearsal-source ${active ? 'is-active' : ''}`} aria-label={`${title}の根拠コード`}>
      <div className="rehearsal-source-heading">
        <strong>{title}</strong>
        {excerpt && (
          <span>
            {excerpt.path}:{excerpt.focus}
          </span>
        )}
      </div>
      {excerpt ? (
        <pre className="rehearsal-source-lines">
          {excerpt.lines.map((line) => (
            <span
              className={
                span && line.number >= span.start_line && line.number <= span.end_line ? 'is-focus' : ''
              }
              key={line.number}
            >
              <span className="rehearsal-line-number">{line.number}</span>
              <code>{line.text || ' '}</code>
            </span>
          ))}
        </pre>
      ) : (
        <p className="rehearsal-source-unavailable">
          {loading
            ? '保存済みのコードを読み込んでいます…'
            : 'この版のコードを表示できません。保存済みの元コードで確認してください。'}
        </p>
      )}
    </section>
  );
}

export function RehearsalWorkspace({
  before,
  explore,
  exploreBefore,
}: {
  before: Bundle;
  explore: (sampleId: string) => void;
  exploreBefore: () => void;
}) {
  const [caseId, setCaseId] = useState<RehearsalCaseId>('web');
  const [questions, setQuestions] = useState<Record<RehearsalCaseId, string>>(() => ({
    web: savedQuestion(before.map.snapshot_id, 'web'),
    store: savedQuestion(before.map.snapshot_id, 'store'),
  }));
  const [playhead, setPlayhead] = useState<Playhead | null>(null);
  const [playing, setPlaying] = useState(false);
  const [playError, setPlayError] = useState('');
  const [copyState, setCopyState] = useState('');
  const [manualCopy, setManualCopy] = useState('');
  const [storageAvailable, setStorageAvailable] = useState(true);
  const request = useRef(0);
  const auditionState = useAudition();
  const scene = rehearsalCases[caseId];

  const afterQuery = useQuery({
    queryKey: ['rehearsal-bundle', afterSampleId],
    queryFn: () => api<Bundle>(`/samples/${afterSampleId}/bundle`),
    staleTime: Infinity,
    retry: false,
  });
  const after = afterQuery.data;
  const beforeCaller = unit(before, scene.caller);
  const afterCaller = unit(after, scene.caller);
  const beforeTarget = unit(before, scene.beforeTarget);
  const afterTarget = unit(after, scene.afterTarget);
  const beforeRelations = useQuery({
    queryKey: ['rehearsal-relationships', beforeSampleId, before.map.snapshot_id, beforeCaller?.unit_id],
    queryFn: () =>
      api<CallRelationships>(
        `/samples/${beforeSampleId}/relationships?unit_id=${encodeURIComponent(beforeCaller!.unit_id)}`,
      ),
    enabled: !!beforeCaller,
    staleTime: Infinity,
    retry: false,
  });
  const afterRelations = useQuery({
    queryKey: ['rehearsal-relationships', afterSampleId, after?.map.snapshot_id, afterCaller?.unit_id],
    queryFn: () =>
      api<CallRelationships>(
        `/samples/${afterSampleId}/relationships?unit_id=${encodeURIComponent(afterCaller!.unit_id)}`,
      ),
    enabled: !!afterCaller,
    staleTime: Infinity,
    retry: false,
  });

  const beforeLink =
    beforeRelations.data && beforeCaller && beforeTarget
      ? selectRehearsalLink(beforeRelations.data, beforeCaller, beforeTarget)
      : undefined;
  const afterLink =
    after && afterRelations.data && afterCaller && afterTarget
      ? selectRehearsalLink(afterRelations.data, afterCaller, afterTarget)
      : undefined;
  const beforeDialogue =
    beforeLink?.status === 'ready' && beforeRelations.data
      ? buildRelationshipDialogue(before.map, before.score, beforeRelations.data, beforeLink.link.link_id)
      : undefined;
  const afterDialogue =
    after && afterLink?.status === 'ready' && afterRelations.data
      ? buildRelationshipDialogue(after.map, after.score, afterRelations.data, afterLink.link.link_id)
      : undefined;
  const startDialogue = beforeDialogue?.status === 'ready' ? beforeDialogue : undefined;
  const endDialogue = afterDialogue?.status === 'ready' ? afterDialogue : undefined;
  const sameKit =
    !!startDialogue &&
    !!endDialogue &&
    startDialogue.plan.kit_id === endDialogue.plan.kit_id &&
    startDialogue.plan.kit_hash === endDialogue.plan.kit_hash;
  const ready = !!startDialogue && !!endDialogue && sameKit;
  const loading =
    afterQuery.isPending ||
    (!!beforeCaller && beforeRelations.isPending) ||
    (!!afterCaller && afterRelations.isPending);
  const unavailable =
    [
      afterQuery.error?.message,
      beforeRelations.error?.message,
      afterRelations.error?.message,
      beforeLink?.status === 'unavailable' ? beforeLink.message : '',
      afterLink?.status === 'unavailable' ? afterLink.message : '',
      beforeDialogue?.status === 'unavailable' ? beforeDialogue.message : '',
      afterDialogue?.status === 'unavailable' ? afterDialogue.message : '',
      !beforeCaller || !beforeTarget || (after && (!afterCaller || !afterTarget))
        ? '関数を一意に見つけられません。元コードで確認してください。'
        : '',
      startDialogue && endDialogue && !sameKit ? '前後の音源が異なるため連続試聴を控えます。' : '',
    ].find(Boolean) ?? '';

  const phase = playhead?.phase ?? 'quote';
  const beforeSpan =
    startDialogue?.phases.find((item) => item.id === phase)?.activeSpan ??
    (beforeLink?.status === 'ready' ? beforeLink.link.call_span : beforeCaller?.primary_span);
  const afterSpan =
    endDialogue?.phases.find((item) => item.id === phase)?.activeSpan ??
    (afterLink?.status === 'ready' ? afterLink.link.call_span : afterCaller?.primary_span);

  useEffect(() => {
    return () => {
      request.current++;
      engine.pause();
    };
  }, [caseId]);

  function changeCase(next: RehearsalCaseId) {
    if (next === caseId) return;
    request.current++;
    engine.pause();
    setPlaying(false);
    setPlayhead(null);
    setPlayError('');
    setCopyState('');
    setManualCopy('');
    setCaseId(next);
  }

  async function listen() {
    if (!startDialogue || !endDialogue || !sameKit) return;
    const original = playbackPlan(before.score, 'repo', 0, true);
    if (!original) {
      setPlayError('元の譜面が見つからず、試聴を始められません。');
      return;
    }
    const current = ++request.current;
    engine.configure(original);
    setPlayError('');
    setPlayhead({ take: 'before', phase: 'quote' });
    setPlaying(true);
    const sequence = sequenceExcerpts(startDialogue.plan, endDialogue.plan);
    try {
      const started = await engine.playAudition(
        sequence,
        (note) => {
          if (current !== request.current) return;
          const take: Take = note.tick < 4 * 1920 ? 'before' : 'after';
          const position = take === 'before' ? note.tick : note.tick - 4 * 1920;
          const steps = take === 'before' ? startDialogue.phases : endDialogue.phases;
          const active = steps.find((item) => item.startTick <= position && position < item.endTick);
          if (active) setPlayhead({ take, phase: active.id });
        },
        () => {
          if (current === request.current) setPlaying(false);
        },
      );
      if (current === request.current && !started) {
        setPlaying(false);
        setPlayError('再生を始められませんでした。根拠コードは音なしで確認できます。');
      }
    } catch {
      if (current !== request.current) return;
      setPlaying(false);
      setPlayError('音源を読み込めませんでした。根拠コードは音なしで確認できます。');
    }
  }

  function stop() {
    request.current++;
    engine.pause();
    setPlaying(false);
  }

  function updateQuestion(value: string) {
    setQuestions((current) => ({ ...current, [caseId]: value }));
    try {
      localStorage.setItem(memoKey(before.map.snapshot_id, caseId), value);
      setStorageAvailable(true);
    } catch {
      setStorageAvailable(false);
    }
    setCopyState('');
  }

  async function copyMarkdown() {
    const question = questions[caseId].trim();
    if (!question) return;
    const beforeLocation =
      beforeLink?.status === 'ready' ? beforeLink.link.call_span : beforeCaller?.primary_span;
    const afterLocation =
      afterLink?.status === 'ready' ? afterLink.link.call_span : afterCaller?.primary_span;
    const location = (span?: Span) => (span ? `${span.path}:${span.start_line}` : '未確認');
    const markdown = [
      `# 返品レビュー · ${scene.label}`,
      '',
      '## 観察',
      `- 変更前: \`${scene.caller}\` → \`${scene.beforeTarget}\`（${location(beforeLocation)}）`,
      `- 変更後: \`${scene.caller}\` → \`${scene.afterTarget}\`（${location(afterLocation)}）`,
      '',
      '## 確認したいこと',
      question,
      '',
      '保存済みの実解析に基づくメモ。音の違いだけで正誤は判定していません。',
    ].join('\n');
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(markdown);
      setManualCopy('');
      setCopyState('Markdownをコピーしました。レビューへ貼り付けられます。');
    } catch {
      setManualCopy(markdown);
      setCopyState('自動コピーできませんでした。下のMarkdownを選択してコピーしてください。');
    }
  }

  return (
    <main className="rehearsal" aria-label="返品レビューのリハーサル">
      <div className="rehearsal-inner">
        <header className="rehearsal-heading">
          <div>
            <span className="rehearsal-eyebrow">保存済みの実解析 · 返品レビュー</span>
            <h1>呼ぶ相手の変化を、耳から確かめる。</h1>
            <p>別々だった返品判断が共通の関数へ。20秒の前後比較から、コードで確かめたい問いを残します。</p>
          </div>
          <div className="rehearsal-explore-actions">
            <button className="rehearsal-explore" onClick={exploreBefore}>変更前の譜面</button>
            <button className="rehearsal-explore" onClick={() => explore(afterSampleId)}>
              変更後の譜面 <ArrowRight size={15} />
            </button>
          </div>
        </header>

        <div className="rehearsal-layout">
          <div className="rehearsal-left">
            <section className="rehearsal-card rehearsal-story" aria-label="変更の説明">
              <div className="rehearsal-card-title">
                <span>01</span>
                <strong>何が変わった？</strong>
              </div>
              <div className="rehearsal-cases" role="group" aria-label="レビューする窓口">
                {(['web', 'store'] as const).map((id) => (
                  <button key={id} aria-pressed={caseId === id} onClick={() => changeCase(id)}>
                    {rehearsalCases[id].label}
                  </button>
                ))}
              </div>
              <p className="rehearsal-change-copy">
                {scene.label}の受付関数が呼ぶ相手は、<strong>{scene.beforeTarget}</strong> から
                <strong>{scene.afterTarget}</strong> へ変わりました。
              </p>
              <div className="rehearsal-flow" aria-label="呼出先の変化">
                <div>
                  <small>変更前</small>
                  <b>{scene.beforeTarget}</b>
                </div>
                <ArrowRight size={17} aria-hidden="true" />
                <div>
                  <small>変更後</small>
                  <b>{scene.afterTarget}</b>
                </div>
              </div>
              <small>コード上で確認できる呼出先の変化です。良し悪しは仕様とテストで確かめます。</small>
            </section>

            <section className="rehearsal-card rehearsal-listen" aria-label="変更前後の試聴">
              <div className="rehearsal-card-title">
                <span>02</span>
                <strong>前 → 後を聴く</strong>
              </div>
              <p>呼ぶ側が相手の主題を引用し、相手が応えて、呼ぶ側が受け取ります。</p>
              <div className="rehearsal-transport">
                <button className="rehearsal-play" disabled={!ready || playing} onClick={() => void listen()}>
                  <Play size={17} fill="currentColor" /> 前 → 後を聴く <small>約20秒</small>
                </button>
                {(playing || auditionState !== 'idle') && (
                  <button className="rehearsal-stop" onClick={stop}>
                    <Pause size={15} /> 停止
                  </button>
                )}
              </div>
              <div className="rehearsal-now" role="status" aria-live="polite">
                <Volume2 size={15} />
                {playhead
                  ? `${playing ? '' : '最後に聴いた位置 · '}${playhead.take === 'before' ? '変更前' : '変更後'} · ${phaseLabels[playhead.phase]}`
                  : '再生すると根拠コードも一緒に進みます'}
              </div>
              <div className="rehearsal-phases" aria-label="演奏の四段階">
                {(['quote', 'answer', 'receive', 'together'] as const).map((id, index) => (
                  <span className={phase === id && playhead ? 'is-current' : ''} key={id}>
                    {index + 1}. {phaseLabels[id]}
                  </span>
                ))}
              </div>
              {loading && <small role="status">両版の静的な接点と譜面を読み込んでいます…</small>}
              {!loading && !ready && (
                <small role="alert">{unavailable || 'この接点の前後比較を準備できませんでした。'}</small>
              )}
              {playError && <small role="alert">{playError}</small>}
              <small>音は構造をたどる手がかりです。品質・実行結果・テスト成功を音から判定しません。</small>
            </section>

            <section className="rehearsal-card rehearsal-question" aria-label="レビューの問い">
              <div className="rehearsal-card-title">
                <span>03</span>
                <strong>確かめたいことを残す</strong>
              </div>
              <label htmlFor="rehearsal-question">レビューの問い</label>
              <textarea
                id="rehearsal-question"
                value={questions[caseId]}
                onChange={(event) => updateQuestion(event.target.value)}
                placeholder={scene.questionHint}
                rows={3}
                maxLength={2000}
              />
              <div className="rehearsal-question-actions">
                <small>
                  {storageAvailable
                    ? '入力はこのブラウザに保存されます。'
                    : 'この端末には保存できません。Markdownをコピーしてください。'}
                </small>
                <button disabled={!questions[caseId].trim()} onClick={() => void copyMarkdown()}>
                  <ClipboardCopy size={14} /> Markdownをコピー
                </button>
              </div>
              {copyState && <small role="status">{copyState}</small>}
              {manualCopy && (
                <textarea
                  className="rehearsal-manual-copy"
                  readOnly
                  value={manualCopy}
                  aria-label="手動コピー用Markdown"
                />
              )}
            </section>
          </div>

          <section className="rehearsal-card rehearsal-code" aria-label="前後の根拠コード">
            <div className="rehearsal-code-intro">
              <div className="rehearsal-card-title">
                <span>根拠</span>
                <strong>聴こえた瞬間のコード</strong>
              </div>
              <p>同じ段階の前後を並べています。音が進むと、呼出し・返却候補・利用箇所が切り替わります。</p>
            </div>
            <div className="rehearsal-code-grid">
              <SourceWindow
                title="変更前"
                bundle={before}
                span={beforeSpan}
                active={playhead?.take === 'before'}
              />
              <SourceWindow
                title="変更後"
                bundle={after}
                span={afterSpan}
                active={playhead?.take === 'after'}
                loading={afterQuery.isPending}
              />
            </div>
            <div className="rehearsal-evidence-note">
              <strong>{phaseLabels[phase]}：</strong>
              {phase === 'quote' && '呼び出す行を示しています。'}
              {phase === 'answer' && '相手の返却候補を示しています。複数候補なら関数全体を示します。'}
              {phase === 'receive' && '結果の利用箇所を示しています。複数なら呼出行に戻ります。'}
              {phase === 'together' && '二つの関数の接点を示しています。'}
            </div>
            <div className="rehearsal-provenance">
              <span>保存済みの実解析</span>
              <span>コードは実行していません</span>
              <span>音だけで正誤を決めません</span>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}

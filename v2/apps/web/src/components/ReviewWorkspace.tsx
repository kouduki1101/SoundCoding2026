import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ScanLine } from 'lucide-react';
import type { ScorePlan, ScheduledNote } from '../../../../packages/contracts/ScoreBundle';
import { api, type Bundle, type RepositoryReference } from '../api';
import { engine } from '../audio/engine';
import { useWorkspace } from '../state';
import { DirectoryTree, sourceTree } from './RepositoryTree';
import { Arrangement } from './Arrangement';
import { EventKaraoke } from './EventKaraoke';
export { SampleSwitch } from './SampleSwitch';
const CodePanel = lazy(() => import('./CodePanel').then((module) => ({ default: module.CodePanel })));
const StructureComparisonPanel = lazy(() =>
  import('./StructureComparisonPanel').then((module) => ({ default: module.StructureComparisonPanel })),
);

export function ReviewWorkspace({
  bundle,
  plan,
  children,
}: {
  bundle: Bundle;
  plan: ScorePlan;
  children: React.ReactNode;
}) {
  const ws = useWorkspace();
  const following = ws.following;
  const setFollowing = (value: boolean) => ws.set({ following: value });
  const [comparing, setComparing] = useState(false);
  const center = useRef<HTMLElement>(null);
  useEffect(() => {
    const dismiss = (event: PointerEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent && event.key !== 'Escape') return;
      const menus = center.current?.querySelectorAll<HTMLDetailsElement>('.workspace-menu[open]');
      if (event instanceof KeyboardEvent && menus?.length) event.preventDefault();
      menus?.forEach((menu) => {
        if (event instanceof PointerEvent && menu.contains(event.target as Node)) return;
        if (event instanceof KeyboardEvent && menu.contains(document.activeElement))
          menu.querySelector<HTMLElement>('summary')?.focus();
        menu.open = false;
      });
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', dismiss);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', dismiss);
    };
  }, []);
  const reference = useQuery({
    queryKey: ['repository-reference', bundle.case_study?.revision],
    queryFn: () => api<RepositoryReference>('/samples/recorded-tsugiai-agents/repository-reference'),
    enabled: bundle.case_study?.revision === '35a951488d7b00518e7e73a329d46713cbeacbe8',
    staleTime: Infinity,
    retry: false,
  });
  const referenceSources =
    reference.data?.revision === bundle.case_study?.revision ? reference.data?.sources : undefined;
  const sourcePaths = [...new Set([...Object.keys(bundle.sources), ...Object.keys(referenceSources ?? {})])];
  const unit = bundle.map.units.find((u) => u.unit_id === ws.unitId) ?? bundle.map.units[0];
  const selectedPath = ws.codeSpan?.path ?? unit.primary_span.path;
  const concernPaths = new Set(
    bundle.map.units
      .filter((u) =>
        bundle.map.review_signals?.some((s) => s.verdict === 'concern' && s.unit_ids.includes(u.unit_id)),
      )
      .map((u) => u.primary_span.path),
  );
  function select(note: ScheduledNote, seek = true) {
    if (!note.event_id) return;
    ws.set({
      eventId: note.event_id,
      unitId: note.unit_id!,
      signalId: note.signal_id ?? '',
      codeSpan: null,
      scene: Math.max(
        0,
        bundle.score.scenes.findIndex((s) => s.unit_ids.includes(note.unit_id!)),
      ),
    });
    if (seek) {
      setFollowing(false);
      engine.seek(note.tick);
    }
  }
  function selectFile(path: string) {
    setFollowing(false);
    const target =
      bundle.map.units.find((u) => u.primary_span.path === path && concernPaths.has(path)) ??
      bundle.map.units.find((u) => u.primary_span.path === path);
    const event = bundle.map.events.find((e) => e.unit_id === target?.unit_id);
    ws.set({
      unitId: target?.unit_id ?? '',
      eventId: event?.event_id ?? '',
      codeSpan: event
        ? null
        : {
            file_id: bundle.map.evidence.find((e) => e.span.path === path)?.span.file_id ?? 'source_preview',
            path,
            start_line: 1,
            end_line: 1,
          },
      scene: target
        ? Math.max(
            0,
            bundle.score.scenes.findIndex((s) => s.unit_ids.includes(target.unit_id)),
          )
        : ws.scene,
      playbackFile: ws.playbackFile ? path : '',
    });
  }
  return (
    <div className={`review-workspace ${ws.agentVisible ? '' : 'agent-collapsed'}`}>
      <aside className="file-sidebar">
        <div className="pane-heading">
          Repository<span>{sourcePaths.length} files</span>
        </div>
        {reference.data && (
          <div className="repository-scale" data-testid="repository-scale">
            実在コード {sourcePaths.length} ファイル · {reference.data.source_lines.toLocaleString()} 行
            <small>演奏は保存済みの9実装。全体の解析は未実施。</small>
          </div>
        )}
        {reference.error && (
          <p role="alert">
            全体の参考コードを読み込めません。保存済みの{Object.keys(bundle.sources).length}
            ファイルを表示しています。
          </p>
        )}
        <div className="file-list" data-testid="repository-tree">
          <DirectoryTree
            nodes={sourceTree(sourcePaths)}
            selected={selectedPath}
            select={selectFile}
            concernPaths={concernPaths}
            inspectedPaths={bundle.partition ? new Set(bundle.partition.paths) : undefined}
            recordedPaths={referenceSources ? new Set(Object.keys(bundle.sources)) : undefined}
          />
        </div>
        <details className="file-scope">
          <summary>
            解析済み {bundle.map.coverage.inspected_units}/{bundle.map.coverage.indexed_units} 実装
            <small data-testid="analysis-origin">
              {bundle.map.origin === 'fixture'
                ? '模擬サンプル'
                : bundle.map.origin === 'recorded_live'
                  ? '保存済み実解析'
                  : '実解析'}
            </small>
          </summary>
          <div>
            <p>分母は対象の関数数、分子は確認できた数です。READMEと型定義もファイル一覧に含みます。</p>
            {bundle.partition && (
              <p>
                分母は表示中の検査範囲の実装数です。「参考」のファイルは演奏対象外で、残りの範囲の検査完了を意味しません。
              </p>
            )}
            {bundle.map.coverage.unresolved_unit_ids.length > 0 && (
              <p>
                未確認: {bundle.map.coverage.unresolved_unit_ids.length}{' '}
                関数。未確認の処理には意味の音を付けていません。
              </p>
            )}
            {bundle.sample_id === 'recorded-checkout-flow' && (
              <p>
                動くサンプルの検査対象は src
                の決済ロジックです。起動用の画面とサーバーはこの解析に含まれません。
              </p>
            )}
          </div>
        </details>
      </aside>
      <main className="review-center" ref={center}>
        {comparing && (
          <Suspense fallback={<p>比較画面を読み込み中…</p>}>
            <StructureComparisonPanel bundle={bundle} close={() => setComparing(false)} />
          </Suspense>
        )}
        <Arrangement
          bundle={bundle}
          plan={plan}
          following={following}
          select={select}
          compare={() => {
            engine.pause();
            ws.set({ agentVisible: true });
            setComparing(true);
          }}
        />
        <EventKaraoke bundle={bundle} plan={plan} following={following} select={select} />
        <div className="review-code">
          <Suspense fallback={<div className="code-loading">コードを読み込み中…</div>}>
            <CodePanel
              bundle={bundle}
              following={following}
              toggleFollowing={() => setFollowing(!following)}
              referenceSources={referenceSources}
              plan={plan}
              select={select}
            />
          </Suspense>
        </div>
      </main>
      <aside className="review-agent" id="workspace-agent" data-tour="chat" hidden={!ws.agentVisible}>
        {children}
      </aside>
      {!ws.agentVisible && (
        <button
          className="agent-restore"
          aria-label="AgentWindowを表示"
          aria-expanded="false"
          aria-controls="workspace-agent"
          onClick={() => ws.set({ agentVisible: true })}
        >
          <ScanLine size={17} />
        </button>
      )}
    </div>
  );
}

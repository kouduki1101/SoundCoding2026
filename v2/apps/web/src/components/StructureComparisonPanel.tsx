import { Fragment, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type {
  StructureComparison,
  SyntaxProjection,
} from '../../../../packages/contracts/StructureComparison';
import type { StructurePlaybackPlan } from '../../../../packages/contracts/StructurePlaybackPlan';
import type { Span } from '../../../../packages/contracts/SemanticMap';
import type {
  ComparisonExport,
  ComparisonHumanRecord,
  ComparisonInvestigationRequest,
  ComparisonInvestigationResult,
} from '../../../../packages/contracts/ComparisonExport';
import { api, currentUser, type Bundle, type PublicConfig } from '../api';
import { useWorkspace } from '../state';
import { useComparisonRecords } from '../comparisonState';
import { structurePlayer } from '../audio/structurePlayer';
import { engine } from '../audio/engine';
import { playbackPlan } from '../audio/playback';
import { responsibilityComparison, sequenceExcerpts } from '../audio/excerpts';
import { useAudition } from '../hooks/useAudition';
import '../styles/structure-comparison.css';

type Inventory = {
  snapshot_id: string;
  units: {
    unit_id: string;
    label: string;
    primary_span: { path: string; start_line: number; end_line: number };
  }[];
  sources?: Record<string, string>;
};
type ComparisonData = {
  comparison: StructureComparison;
  playback: StructurePlaybackPlan;
  sources?: Record<string, string>;
};
const statusText = {
  equal: '構文が一致',
  different: '構文が異なる',
  unknown: '対応不明',
  absent: '対応する構文イベントなし',
  unsupported: '抽出不能・未対応',
};
const terminal = ['completed', 'partial', 'failed', 'cancelled'];
const timestamp = () => new Date().toISOString();

function SourceSide({
  projection,
  source,
  eventId,
  side,
  meaningSpan,
}: {
  projection: SyntaxProjection;
  source: string;
  eventId: string | null;
  side: string;
  meaningSpan?: Span;
}) {
  const event = projection.events.find((e) => e.event_id === eventId);
  const lineOffset = (line: number) =>
    source
      .split('\n')
      .slice(0, line - 1)
      .reduce((offset, text) => offset + text.length + 1, 0);
  const location = meaningSpan
    ? {
        ...projection.location,
        ...meaningSpan,
        start_column: 1,
        end_column: 1,
        start_offset: lineOffset(meaningSpan.start_line),
        end_offset: lineOffset(meaningSpan.end_line + 1),
      }
    : (event?.location ?? projection.location);
  const start = projection.location.start_offset,
    end = projection.location.end_offset;
  const highlightStart = Math.max(start, location.start_offset),
    highlightEnd = Math.min(end, location.end_offset);
  const mark = useRef<HTMLElement>(null);
  useEffect(() => {
    mark.current?.scrollIntoView({ block: 'nearest' });
  }, [eventId, meaningSpan]);
  return (
    <section className="structure-source" aria-label={`${side}の読取専用コード`}>
      <strong>
        {side}: {projection.label} · {location.path}:{location.start_line}:{location.start_column}–
        {location.end_line}:{location.end_column}
      </strong>
      <pre tabIndex={0} aria-label={`${side}のコード`}>
        <code>
          {event || meaningSpan ? (
            <>
              {source.slice(start, highlightStart)}
              <mark ref={mark}>{source.slice(highlightStart, highlightEnd)}</mark>
              {source.slice(highlightEnd, end)}
            </>
          ) : (
            source.slice(start, end)
          )}
        </code>
      </pre>
      {meaningSpan ? (
        <small>保存された責務の根拠範囲です。左右の構文対応を推定するものではありません。</small>
      ) : (
        !event && <small>この対応行の元位置はなし／未確定です。関数全体を参考表示しています。</small>
      )}
      <small>
        静的抽出: {projection.status} · 元コード SHA-256 {projection.source_hash.slice(0, 12)}
      </small>
      {projection.diagnostics.map((d) => (
        <p key={d}>{d}</p>
      ))}
    </section>
  );
}

export function StructureComparisonPanel({ bundle, close }: { bundle: Bundle; close: () => void }) {
  const staticDemo = import.meta.env.VITE_STATIC_DEMO === '1';
  const dialog = useRef<HTMLDialogElement>(null);
  const copiedSample = useRef<{ project_id: string; analysis_id: string } | undefined>(undefined);
  const ws = useWorkspace();
  const store = useComparisonRecords();
  const [material, setMaterial] = useState('current');
  const [a, setA] = useState(''),
    [b, setB] = useState('');
  const [segmentIndex, setSegmentIndex] = useState(0);
  const [markers, setMarkers] = useState(false),
    [sound, setSound] = useState(true);
  const [selectedRow, setSelectedRow] = useState('');
  const [meaningNote, setMeaningNote] = useState('');
  const [playing, setPlaying] = useState(false),
    [requesting, setRequesting] = useState(false);
  const [error, setError] = useState('');
  const demo = material === 'demo';
  const auditionState = useAudition();
  const base = demo
    ? '/comparison-demo/structure'
    : ws.sampleId
      ? `/samples/${ws.sampleId}/structure`
      : `/analyses/${bundle.map.analysis_id}/structure`;
  const inventory = useQuery({
    queryKey: ['syntax-inventory', base, bundle.map.snapshot_id],
    queryFn: () => api<Inventory>(base),
  });
  const units = inventory.data?.units ?? [];
  const unitA = a || units[0]?.unit_id || '',
    unitB = b || units[1]?.unit_id || '';
  const data = useQuery({
    queryKey: ['syntax-comparison', base, unitA, unitB, markers],
    queryFn: () => api<ComparisonData>(`${base}?unit_a=${unitA}&unit_b=${unitB}&markers=${markers}`),
    enabled: !!unitA && !!unitB && unitA !== unitB,
  });
  const comparison = data.data?.comparison,
    playback = data.data?.playback;
  const segment = playback?.segments[segmentIndex];
  const rangeStart = segment?.start_row ?? 0,
    rangeEnd = segment?.end_row ?? comparison?.rows.length ?? 0;
  const recordKey = comparison ? `${comparison.comparison_id}:${rangeStart}:${rangeEnd}` : '';
  const record = store.records[recordKey];
  const runId = store.runs[recordKey];
  const run = useQuery({
    queryKey: ['comparison-run', runId],
    queryFn: () => api<{ status: string; result_id?: string; error?: { message: string } }>(`/runs/${runId}`),
    enabled: !!runId,
    refetchInterval: (query) => (terminal.includes(query.state.data?.status ?? '') ? false : 1200),
  });
  const pending = requesting || (!!runId && !run.isError && !terminal.includes(run.data?.status ?? 'queued'));
  const row = comparison?.rows.find((r) => r.row_id === selectedRow) ?? comparison?.rows[rangeStart];
  const meaningEvent = bundle.map.events.find((event) => event.event_id === meaningNote);
  const sources = data.data?.sources ?? inventory.data?.sources ?? bundle.sources;
  const repoPlan = playbackPlan(bundle.score, 'repo', 0, true);
  const semanticUnit = (projection?: SyntaxProjection) => {
    if (!projection || projection.snapshot_id !== bundle.map.snapshot_id) return undefined;
    const matches = bundle.map.units.filter(
      (unit) =>
        unit.label === projection.label &&
        unit.primary_span.path === projection.location.path &&
        unit.primary_span.start_line === projection.location.start_line &&
        unit.primary_span.end_line === projection.location.end_line,
    );
    return matches.length === 1 ? matches[0] : undefined;
  };
  const semanticA = semanticUnit(comparison?.a),
    semanticB = semanticUnit(comparison?.b);
  const melodies =
    !demo && repoPlan && semanticA && semanticB
      ? responsibilityComparison(repoPlan, bundle.map, semanticA.unit_id, semanticB.unit_id)
      : undefined;
  const config = useQuery({
    queryKey: ['config'],
    queryFn: () => api<PublicConfig>('/config'),
    staleTime: Infinity,
  });
  const mockAvailable = !!config.data?.local_mock_enabled && (demo || !!ws.sampleId);
  const liveAvailable =
    !demo &&
    (!ws.sampleId ||
      ['recorded-returns-before', 'recorded-checkout-flow', 'recorded-tsugiai-agents'].includes(ws.sampleId));

  useEffect(() => {
    engine.pause();
    dialog.current?.showModal();
    return () => {
      structurePlayer.stop();
      engine.pause();
    };
  }, []);
  useEffect(() => {
    if (recordKey) useComparisonRecords.getState().ensure(recordKey);
  }, [recordKey]);
  useEffect(() => {
    if (!run.data || !terminal.includes(run.data.status)) return;
    if (!run.data.result_id) {
      setError(run.data.error?.message ?? '調査を終了しました。');
      return;
    }
    const key = recordKey;
    void api<ComparisonInvestigationResult>(`/investigations/${run.data.result_id}`)
      .then((answer) => {
        if (answer.request.record_id === useComparisonRecords.getState().records[key]?.record_id)
          useComparisonRecords.getState().answer(key, answer);
      })
      .catch((e) => setError(e.message));
  }, [run.data, recordKey]);

  function stop(log = true) {
    structurePlayer.stop();
    engine.pause();
    setPlaying(false);
    if (log && recordKey) store.update(recordKey, {}, 'stop');
  }
  async function playResponsibilities(mode: 'A' | 'B' | 'A→B') {
    if (!melodies || !sound) return;
    stop(false);
    setError('');
    const plan =
      mode === 'A→B' ? sequenceExcerpts(melodies.a, melodies.b) : mode === 'A' ? melodies.a : melodies.b;
    try {
      await engine.playAudition(plan, (note) => {
        setMeaningNote(note.event_id ?? '');
        store.update(recordKey, {}, 'responsibility_code_navigation', {
          event_id: note.event_id,
          unit_id: note.unit_id,
        });
      });
      store.update(recordKey, {}, 'responsibility_playback_started', {
        mode,
        bars: melodies.a.total_bars,
        shared_volume: ws.volume,
      });
    } catch {
      setError('責務の音源を読み込めませんでした。元の再生設定に戻りました。コードと説明は読めます。');
    }
  }
  function chooseRow(rowId: string, side?: string, fromSound = false) {
    setMeaningNote('');
    setSelectedRow(rowId);
    store.update(recordKey, {}, fromSound ? 'audio_code_navigation' : 'code_navigation', {
      row_id: rowId,
      side: side ?? 'both',
    });
  }
  async function play(mode: 'A' | 'B' | 'A→B') {
    if (!segment || !sound) return;
    engine.pause();
    setError('');
    try {
      const started = await structurePlayer.play(
        segment,
        mode,
        (tone) => chooseRow(tone.row_id, tone.side, true),
        () => {
          setPlaying(false);
          store.update(recordKey, {}, 'playback_finished', { mode });
        },
      );
      if (!started) return;
      setPlaying(true);
      store.update(recordKey, {}, 'playback_started', { mode, segment: segmentIndex, markers });
    } catch {
      setPlaying(false);
      setError('音源を開始できませんでした。コード比較と記録は利用できます。');
      store.update(recordKey, {}, 'audio_failed');
    }
  }
  function update(fields: Partial<ComparisonHumanRecord>) {
    store.update(recordKey, fields, 'memo_or_status_changed', { fields: Object.keys(fields) });
  }
  async function investigate(mock = false) {
    if (!comparison || !record || !record.question.trim()) return;
    const request: ComparisonInvestigationRequest = {
      record_id: record.record_id,
      snapshot_id: comparison.a.snapshot_id,
      comparison_id: comparison.comparison_id,
      unit_a: comparison.a.unit_id,
      unit_b: comparison.b.unit_id,
      source_hash_a: comparison.a.source_hash,
      source_hash_b: comparison.b.source_hash,
      start_row: rangeStart,
      end_row: rangeEnd,
      expectation: record.expectation,
      observation: record.observation,
      question: record.question,
    };
    const key = recordKey;
    setRequesting(true);
    setError('');
    try {
      if (mock) {
        const answer = await api<ComparisonInvestigationResult>(
          `/samples/${demo ? 'structure-demo' : ws.sampleId}/comparison-investigations/mock`,
          request,
        );
        store.update(key, {}, 'investigation_requested', { origin: 'fixture', request });
        store.answer(key, answer);
      } else {
        if (!currentUser || !liveAvailable)
          throw new Error('実解析の二関数を選び、ログイン後に追加調査してください。');
        let analysisId = bundle.map.analysis_id;
        if (ws.sampleId) {
          copiedSample.current ??= await api<{ project_id: string; analysis_id: string }>(
            `/samples/${ws.sampleId}/projects`,
            {},
          );
          analysisId = copiedSample.current.analysis_id;
        }
        const response = await api<{ run_id: string }>(
          `/analyses/${analysisId}/comparison-investigations`,
          request,
        );
        store.update(key, {}, 'investigation_requested', {
          origin: 'live',
          request,
          run_id: response.run_id,
        });
        store.trackRun(key, response.run_id);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRequesting(false);
    }
  }
  function exportJson() {
    if (!comparison || !playback || !record) return;
    store.update(recordKey, {}, 'export_requested');
    const output: ComparisonExport = {
      export_version: 'code-groove-comparison-v1',
      material_id: demo ? 'structure-demo-v1' : ws.sampleId || ws.projectId,
      code_revision: demo ? 'teaching-source-v1' : (bundle.case_study?.revision ?? bundle.map.snapshot_id),
      comparison,
      playback,
      agent_context: demo
        ? {
            analysis_id: 'mock_initial_structure',
            origin: 'fixture',
            model_id: 'mock-no-model',
            prompt_version: 'comparison-demo-v1',
            interpretation: '模擬説明：両関数の役割が似る可能性。細部と仕様は未確認。',
          }
        : {
            analysis_id: bundle.map.analysis_id,
            origin: bundle.map.origin,
            model_id: bundle.map.model_id,
            analysis_depth: bundle.map.analysis_depth,
            profile: bundle.map.profile,
            responsibilities: bundle.map.responsibilities,
            units: bundle.map.units,
            coverage: bundle.map.coverage,
            trace: bundle.trace ?? [],
            analysis_conditions: {
              prompt_version: (bundle.map as any).prompt_version ?? 'recorded conditions not supplied',
              selected_scope: bundle.partition ?? 'saved map scope',
            },
          },
      presentation: {
        responsibility_playback: melodies
          ? {
              bars_per_side: melodies.a.total_bars,
              omitted_bars: melodies.omittedBars,
              uncertain_keys: melodies.uncertainKeys,
              shared_volume: ws.volume,
              bpm: 96,
            }
          : null,
        sound_enabled: sound,
        markers,
        presentation_order: ['A', 'B'],
        available_playback_orders: ['A', 'B', 'A→B'],
        start_row: rangeStart,
        end_row: rangeEnd,
        remaining_rows: comparison.rows.length - rangeEnd,
        runtime_order_guaranteed: false,
      },
      record: useComparisonRecords.getState().records[recordKey],
      exported_at: timestamp(),
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(output, null, 2)], { type: 'application/json' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = `code-groove-${record.record_id}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <dialog
      ref={dialog}
      className="structure-dialog"
      aria-labelledby="structure-title"
      onCancel={() => {
        stop();
        close();
      }}
    >
      <header>
        <h2 id="structure-title">構造を比較して聴く</h2>
        <button
          onClick={() => {
            stop();
            close();
          }}
        >
          比較を閉じる
        </button>
      </header>
      <p>
        <strong>
          {staticDemo
            ? '1. 保存済みの説明を読み、2. 二関数を聴き比べ、3. 観察と疑問を記録する'
            : '1. Agentの理解を読み、2. 二関数を比較し、3. 疑問を追加調査へ返す'}
        </strong>
      </p>
      <details open className="structure-agent-context">
        <summary>
          初回Agentの説明 ·{' '}
          {demo
            ? '模擬教材・実解析なし'
            : bundle.map.origin === 'recorded_live'
              ? '保存済み実解析'
              : bundle.map.origin === 'fixture'
                ? '模擬解析'
                : '実解析'}
        </summary>
        <p>
          {demo
            ? '模擬説明：両関数は似た役割かもしれません。定数・順序・仕様の細部は未確認です。追加調査もモックで経路を試します。'
            : `${bundle.map.profile.purpose} ${bundle.map.responsibilities.map((r) => `${r.label}: ${r.definition}`).join(' / ')}`}
        </p>
        <p>
          未確認:{' '}
          {demo
            ? '製品仕様と実行動作'
            : bundle.map.profile.unknowns.join(' / ') || '保存記録の対象範囲外・実行動作'}
          。選択候補はAIの指摘に限定していません。
        </p>
      </details>
      <p className="structure-limit">
        初版:
        短い.ts関数。構文の配置順で表示・再生し、実行順・回数・時間は保証しません。同じ音は同じ意味・動作の証明ではありません。
      </p>
      <div className="structure-selectors">
        <label>
          材料
          <select
            aria-label="材料"
            value={material}
            onChange={(e) => {
              stop();
              setMaterial(e.target.value);
              setA('');
              setB('');
              setSegmentIndex(0);
            }}
          >
            <option value="current">現在のAgent解析と同じコード版</option>
            {!staticDemo && <option value="demo">短い比較教材（模擬）</option>}
          </select>
        </label>
        {(['A', 'B'] as const).map((side) => (
          <label key={side}>
            {side}の関数
            <select
              aria-label={`${side}の関数`}
              value={side === 'A' ? unitA : unitB}
              onChange={(e) => {
                stop();
                (side === 'A' ? setA : setB)(e.target.value);
                setSegmentIndex(0);
                setSelectedRow('');
              }}
            >
              {units.map((u) => (
                <option key={u.unit_id} value={u.unit_id}>
                  {u.label} · {u.primary_span.path}:{u.primary_span.start_line}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      {(inventory.isLoading || data.isLoading) && <p role="status">静的構文を抽出しています…</p>}
      {inventory.data && units.length < 2 && (
        <p>
          比較には対象内のTypeScript二関数が必要です。Python・TSXは今回の構造比較の対象外です。既存のAgent解析は利用できます。
        </p>
      )}
      {unitA === unitB && <p>異なる二関数を選んでください。</p>}
      {(error || inventory.error || data.error || run.error) && (
        <p role="alert">{error || inventory.error?.message || data.error?.message || run.error?.message}</p>
      )}
      {comparison && playback && record && (
        <>
          <p>
            静的抽出済み: A・Bの関数範囲。AI解析記録:{' '}
            {demo ? '模擬のみ' : '保存された説明の範囲のみ（選択関数の理解を保証しません）'}。人の理由確認:{' '}
            {record.reason_status === 'confirmed_with_evidence'
              ? `選択行${rangeStart + 1}–${rangeEnd}で記録済み`
              : '未確認・保留を含む'}
            。
          </p>
          <p>
            引数・名前を保持: A <code>{comparison.a.signature}</code> / B{' '}
            <code>{comparison.b.signature}</code>
          </p>
          <section className="responsibility-comparison" aria-label="責務の旋律で比較">
            <b>全体演奏と同じ責務の旋律で比較</b>
            {melodies ? (
              <>
                <p>
                  96 BPM · 共通の音量設定 · 両側とも先頭{melodies.a.total_bars}
                  小節。配置・小節内の間隔と休符を保ちます。構文の対応行とは別の演奏範囲です。
                </p>
                <div className="structure-controls">
                  {(['A', 'B', 'A→B'] as const).map((mode) => (
                    <button key={mode} disabled={!sound} onClick={() => void playResponsibilities(mode)}>
                      責務の{mode}を聴く
                    </button>
                  ))}
                  <button onClick={() => stop(false)}>責務の試聴を取消</button>
                  <span role="status">
                    {auditionState === 'idle'
                      ? '停止中'
                      : auditionState === 'loading'
                        ? '音源を準備中'
                        : '責務を試聴中'}
                  </span>
                </div>
                <small>
                  Aの残り{melodies.omittedBars[0]}小節 / Bの残り{melodies.omittedBars[1]}
                  小節。保存された責務・意味キーが一対一で対応しない項目:{melodies.uncertainKeys.length}
                  件（対応不明）。音に反映できない値・条件の違いは両側のコードで確認します。
                </small>
                {!!melodies.uncertainKeys.length && (
                  <details>
                    <summary>対応不明の箇所を見る</summary>
                    <p>片側のみの記録や繰り返しは、左右の対応を確定していません。</p>
                    {melodies.uncertainKeys.map((key) => {
                      const events = bundle.map.events.filter(
                        (event) =>
                          event.state === 'grounded' &&
                          [semanticA?.unit_id, semanticB?.unit_id].includes(event.unit_id) &&
                          `${event.responsibility_id}:${event.concept_key}` === key,
                      );
                      return (
                        <p key={key}>
                          {events.map((event) => (
                            <button key={event.event_id} onClick={() => setMeaningNote(event.event_id)}>
                              {event.unit_id === semanticA?.unit_id ? 'A' : 'B'} · {event.label} ·{' '}
                              {event.span.start_line}–{event.span.end_line}行（対応不明）
                            </button>
                          ))}
                        </p>
                      );
                    })}
                  </details>
                )}
              </>
            ) : (
              <p>
                この二関数には両側の根拠付き旋律がありません。責務の音は補完せず、コードと静的な構文比較を表示します。
              </p>
            )}
          </section>
          <div className="structure-controls">
            <label>
              <input
                type="checkbox"
                checked={sound}
                onChange={(e) => {
                  stop();
                  setSound(e.target.checked);
                  store.update(recordKey, {}, 'sound_setting', { enabled: e.target.checked });
                }}
              />
              音を使う
            </label>
            <label>
              <input
                type="checkbox"
                checked={markers}
                onChange={(e) => {
                  stop();
                  setMarkers(e.target.checked);
                  store.update(recordKey, {}, 'marker_setting', { enabled: e.target.checked });
                }}
              />
              中立な差マーカー（抽出済みの差への注意）
            </label>
            {(['A', 'B', 'A→B'] as const).map((mode) => (
              <button key={mode} disabled={!sound || !segment} onClick={() => void play(mode)}>
                {mode}を再生
              </button>
            ))}
            <button onClick={() => stop()}>停止</button>
            <span role="status">{playing ? '再生中' : '停止中'}</span>
          </div>
          <p>
            区間 {segmentIndex + 1}/{Math.max(1, playback.segments.length)} · 対応行 {rangeStart + 1}–
            {rangeEnd}/{comparison.rows.length} · 残り {comparison.rows.length - rangeEnd} 行 · A→B{' '}
            {segment ? (segment.duration_ms / 1000).toFixed(1) : '—'} 秒
          </p>
          <div className="structure-controls">
            <button
              disabled={segmentIndex === 0}
              onClick={() => {
                stop();
                setSegmentIndex((i) => i - 1);
              }}
            >
              前の区間
            </button>
            <button
              disabled={segmentIndex + 1 >= playback.segments.length}
              onClick={() => {
                stop();
                setSegmentIndex((i) => i + 1);
              }}
            >
              次の区間（手動）
            </button>
          </div>
          {playback.status !== 'ready' && (
            <p>
              再生なし:{' '}
              {playback.status === 'dictionary_overflow'
                ? '呼び出し辞書の上限4種類を超えています。衝突させません。'
                : playback.status === 'empty'
                  ? '対象の構文イベントがありません。'
                  : '抽出失敗または初版の対象外。元コードと診断を確認してください。'}
            </p>
          )}
          <details>
            <summary>中立な構文音・共有フレーズ辞書（最大4種類）</summary>
            <p>
              構文音:
              ブロック57・宣言/代入60・分岐62・反復59→59・return/throw65。値はコードで確認します。空き:1打、不明:2打、未対応:3打を同じ音色・強さで区別。未回答に音は付きません。
            </p>
            {playback.dictionary.map((p) => (
              <p key={p.key}>
                {p.key} → {p.midi.join('→')} ·{' '}
                {p.identity === 'static_target'
                  ? '静的参照先が同じ'
                  : '同じ呼び出し式（実行時の呼び出し先は未解決）'}
              </p>
            ))}
          </details>
          <div className="structure-sources">
            <SourceSide
              side="A"
              meaningSpan={meaningEvent?.unit_id === semanticA?.unit_id ? meaningEvent?.span : undefined}
              projection={comparison.a}
              source={sources[comparison.a.location.path] ?? ''}
              eventId={row?.a ?? null}
            />
            <SourceSide
              side="B"
              meaningSpan={meaningEvent?.unit_id === semanticB?.unit_id ? meaningEvent?.span : undefined}
              projection={comparison.b}
              source={sources[comparison.b.location.path] ?? ''}
              eventId={row?.b ?? null}
            />
          </div>
          <table className="structure-rows">
            <caption>順序を保存した構文対応（意味・動作の同一性ではありません）</caption>
            <thead>
              <tr>
                <th>A</th>
                <th>対応</th>
                <th>B</th>
              </tr>
            </thead>
            <tbody>
              {comparison.rows.slice(rangeStart, rangeEnd).map((r) => (
                <tr key={r.row_id} aria-selected={row?.row_id === r.row_id}>
                  {(['a', 'b'] as const).map((side, i) => {
                    const event = comparison[side].events.find((e) => e.event_id === r[side]);
                    return (
                      <Fragment key={side}>
                        <td>
                          <button onClick={() => chooseRow(r.row_id, side.toUpperCase())}>
                            {event
                              ? `${event.order + 1}. ${event.kind} · ${event.label} (${event.location.start_line}行、深さ${event.depth})`
                              : statusText[r.status]}
                          </button>
                        </td>
                        {i === 0 && <td className="structure-status-cell">{statusText[r.status]}</td>}
                      </Fragment>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <section className="structure-notes">
            <h3>人の記録 · 音なしでも利用できます</h3>
            {(['expectation', 'observation', 'question'] as const).map((field, i) => (
              <label key={field}>
                {['期待', '観察した事実', '疑問'][i]}
                <textarea
                  maxLength={1000}
                  aria-label={['期待', '観察した事実', '疑問'][i]}
                  value={record[field]}
                  onChange={(e) => update({ [field]: e.target.value })}
                />
              </label>
            ))}
            <label>
              差の認識
              <select
                aria-label="差の認識"
                value={record.recognition}
                onChange={(e) =>
                  update({ recognition: e.target.value as ComparisonHumanRecord['recognition'] })
                }
              >
                <option value="unrecorded">未記録</option>
                <option value="recognized">認識した</option>
                <option value="not_recognized">認識できなかった</option>
              </select>
            </label>
            <label>
              理由の確認
              <select
                aria-label="理由の確認"
                value={record.reason_status}
                onChange={(e) =>
                  update({ reason_status: e.target.value as ComparisonHumanRecord['reason_status'] })
                }
              >
                <option value="not_started">未着手</option>
                <option value="unanswered">未回答</option>
                <option value="deferred">判断保留</option>
                <option value="confirmed_with_evidence" disabled={!record.reason_evidence.trim()}>
                  根拠付きで確認した
                </option>
              </select>
            </label>
            <label>
              確認した理由・根拠
              <textarea
                value={record.reason_evidence}
                onChange={(e) => update({ reason_evidence: e.target.value })}
              />
            </label>
            <label>
              人の判断
              <select
                aria-label="人の判断"
                value={record.judgment}
                onChange={(e) => update({ judgment: e.target.value as ComparisonHumanRecord['judgment'] })}
              >
                <option value="unrecorded">未記録</option>
                <option value="intended_difference">意図された差</option>
                <option value="needs_review">要検討</option>
                <option value="insufficient_context">前提不足で保留</option>
              </select>
            </label>
            <p>
              再生・コード表示・AI回答では確認状態を変更しません。未認識・未回答・保留は問題なしを意味しません。記録はこのコード版・比較区間に限定し、切替後も端末内に保持します。
            </p>
            <div className="structure-controls">
              {staticDemo ? null : mockAvailable ? (
                <button
                  disabled={!record.question.trim() || pending || rangeEnd === 0}
                  onClick={() => void investigate(true)}
                >
                  モック追加調査を試す（ローカル専用）
                </button>
              ) : (
                <button
                  disabled={
                    !currentUser || !liveAvailable || !record.question.trim() || pending || rangeEnd === 0
                  }
                  onClick={() => void investigate()}
                >
                  この疑問をAgentに追加調査する
                </button>
              )}
              {pending && runId && (
                <button
                  onClick={() => void api(`/runs/${runId}/cancel`, {}).catch((e) => setError(e.message))}
                >
                  追加調査を取消
                </button>
              )}
              <button onClick={exportJson}>ローカルJSONに書き出す</button>
              <button onClick={() => update({ ended_at: timestamp() })}>今回の記録を終了する</button>
            </div>
            {!staticDemo && !mockAvailable && !currentUser && (
              <p>追加調査にはログインと利用許可が必要です。比較・記録・書き出しはそのまま使えます。</p>
            )}
            {!staticDemo && !mockAvailable && !liveAvailable && (
              <p>この模擬教材は比較・記録・書き出し用です。新規調査は実解析の二関数から依頼してください。</p>
            )}
            {copiedSample.current && (
              <button
                onClick={() =>
                  ws.set({
                    projectId: copiedSample.current!.project_id,
                    analysisId: copiedSample.current!.analysis_id,
                    sampleId: '',
                  })
                }
              >
                保存した自分のプロジェクトを開く
              </button>
            )}
            {record.answers.map((answer) => (
              <article key={answer.investigation_id} className="structure-answer">
                <strong>
                  {answer.origin === 'fixture' ? 'モック回答・実モデル未使用' : 'Agent追加調査'} ·{' '}
                  {answer.interpretation}
                </strong>
                <p>{answer.summary}</p>
                <p>{answer.reason}</p>
                <p>競合する説明: {answer.counter_explanation}</p>
                <p>未確認: {answer.unknowns.join(' / ')}</p>
                <small>
                  {answer.investigation_id} · {answer.model_id}
                </small>
                {answer.evidence.map((e) => (
                  <p key={e.evidence_id}>
                    {e.span.path}:{e.span.start_line}–{e.span.end_line} · 読取 {e.evidence_id} · SHA{' '}
                    {e.projection_sha256.slice(0, 12)}
                  </p>
                ))}
              </article>
            ))}
          </section>
        </>
      )}
    </dialog>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { User } from 'firebase/auth';
import { FolderGit2, HelpCircle, LogOut, ScanLine, Sun, Moon, PanelRight } from 'lucide-react';
import { AgentActivity } from './components/AgentActivity';
import {
  api,
  currentUser,
  logout,
  setupAuth,
  type Bundle,
  type PublicConfig,
  type RepositoryStatus,
  type ImportSnapshot,
} from './api';
import { RepositoryDialog } from './components/RepositoryDialog';
import { useWorkspace } from './state';
import { Transport } from './components/Transport';
import { AgentPanel } from './components/AgentPanel';
import { useRunEvents } from './hooks/useRunEvents';
import { AuthDialog, OpenDialog, Onboarding } from './components/Dialogs';
import type { ImprovementProposal, InvestigationResult } from '../../../packages/contracts';
import { ImprovementDialog } from './components/ImprovementDialog';
import { ReviewWorkspace, SampleSwitch } from './components/ReviewWorkspace';
import { playbackPlan } from './audio/playback';
import { engine } from './audio/engine';
import { SpotlightTour } from './components/SpotlightTour';
import { StartRehearsal } from './components/StartRehearsal';
import { RehearsalWorkspace } from './components/RehearsalWorkspace';

type Run = {
  run_id: string;
  status: string;
  result_id?: string;
  error?: { code: string; message: string };
  input_tokens?: number;
  output_tokens?: number;
};
const active = ['enqueue_pending', 'queued', 'fetching', 'indexing', 'investigating', 'compiling'];
const staticDemo = import.meta.env.VITE_STATIC_DEMO === '1';
export default function App() {
  const ws = useWorkspace(),
    cache = useQueryClient();
  const [modal, setModal] = useState<'open' | 'auth' | 'guide' | 'repository' | ''>('');
  const [user, setUser] = useState<User | null>(null),
    [error, setError] = useState('');
  const [runId, setRunId] = useState(''),
    [investigationRunId, setInvestigationRunId] = useState(''),
    [result, setResult] = useState<InvestigationResult>();
  const [starting, setStarting] = useState(false),
    [investigationError, setInvestigationError] = useState('');
  const [tour, setTour] = useState(false);
  const [deepView, setDeepView] = useState(() => new URLSearchParams(location.search).get('view') === 'score');
  const [pendingRepo, setPendingRepo] = useState<{ url?: string; scopePath?: string; snapshot?: ImportSnapshot }>();
  const [agentQuestion, setAgentQuestion] = useState('');
  const [proposalRunId, setProposalRunId] = useState(''),
    [proposalId, setProposalId] = useState('');
  const [showProposal, setShowProposal] = useState(false),
    [proposalBusy, setProposalBusy] = useState(false);
  const [acceptingImprovement, setAcceptingImprovement] = useState(false);
  const activity = useQuery({
    queryKey: ['account-activity', user?.uid],
    queryFn: () =>
      api<{ run_id: string; project_id: string; kind: string; status: string } | null>('/account/activity'),
    enabled: !!user,
    refetchInterval: (q) => (q.state.data ? 1500 : 15000),
    retry: false,
  });
  useEffect(() => {
    document.documentElement.dataset.theme = ws.theme;
  }, [ws.theme]);
  useEffect(() => {
    if (user) void cache.invalidateQueries({ queryKey: ['account-activity'] });
  }, [runId, investigationRunId, proposalRunId, user]);
  const config = useQuery({
    queryKey: ['config'],
    queryFn: () => api<PublicConfig>('/config'),
    staleTime: Infinity,
  });
  useEffect(() => {
    if (config.data) void setupAuth(config.data, setUser);
  }, [config.data]);
  useEffect(() => {
    const match = location.pathname.match(/^\/projects\/([^/]+)\/(arrange|inspect)/);
    if (match?.[1] === 'sample-recorded-returns-after') match[1] = 'sample-recorded-returns-before';
    if (match)
      ws.set({
        projectId: match[1],
        sampleId: match[1].startsWith('sample-') ? match[1].slice(7) : '',
        screen: match[2] as 'arrange' | 'inspect',
        analysisId: new URLSearchParams(location.search).get('analysis') ?? '',
        unitId: new URLSearchParams(location.search).get('unit') ?? '',
        eventId: new URLSearchParams(location.search).get('event') ?? '',
        signalId: new URLSearchParams(location.search).get('signal') ?? '',
        scene: Math.max(0, Math.min(7, Number(new URLSearchParams(location.search).get('scene') ?? 1) - 1)),
        codeSpan: null,
      });
    else if (location.pathname === '/')
      ws.set({ projectId: '', sampleId: '', analysisId: '', unitId: '', eventId: '', codeSpan: null });
  }, []);
  useEffect(() => {
    if (ws.projectId && !staticDemo)
      history.replaceState(
        null,
        '',
        `/projects/${ws.projectId}/${ws.screen}?scene=${ws.scene + 1}${ws.analysisId ? `&analysis=${ws.analysisId}` : ''}${ws.unitId ? `&unit=${ws.unitId}` : ''}${ws.eventId ? `&event=${ws.eventId}` : ''}${ws.signalId ? `&signal=${ws.signalId}` : ''}${deepView && ws.sampleId === 'recorded-returns-before' ? '&view=score' : ''}`,
      );
  }, [ws.projectId, ws.screen, ws.scene, ws.analysisId, ws.unitId, ws.eventId, ws.signalId, deepView]);
  const project = useQuery({
    queryKey: ['project', ws.projectId],
    queryFn: () =>
      api<{
        run_id: string;
        latest_analysis_id?: string;
        previous_analysis_id?: string;
        latest_proposal_id?: string;
        proposal_run_id?: string;
        investigation_run_id?: string;
        investigation_analysis_id?: string;
        latest_investigation_id?: string;
        working_copy?: boolean;
        source?: { scope_path?: string };
      }>(`/projects/${ws.projectId}`),
    enabled: !!ws.projectId && !ws.sampleId && !!user,
    retry: false,
  });
  useEffect(() => {
    if (!project.data || runId) return;
    if (!ws.analysisId && project.data.latest_analysis_id)
      ws.set({ analysisId: project.data.latest_analysis_id });
    let cancelled = false;
    if (project.data.run_id)
      void api<Run>(`/runs/${project.data.run_id}`)
        .then((current) => {
          if (!cancelled && active.includes(current.status)) {
            setRunId(current.run_id);
            setAcceptingImprovement(
              !!project.data?.previous_analysis_id || !!project.data?.latest_proposal_id,
            );
          }
        })
        .catch((e) => {
          if (!cancelled) setError(e.message);
        });
    return () => {
      cancelled = true;
    };
  }, [project.data]);
  useEffect(() => {
    if (project.data?.latest_proposal_id) setProposalId(project.data.latest_proposal_id);
    if (project.data?.proposal_run_id) setProposalRunId(project.data.proposal_run_id);
  }, [project.data]);
  const proposalRun = useQuery({
    queryKey: ['run', proposalRunId],
    queryFn: () => api<Run>(`/runs/${proposalRunId}`),
    enabled: !!proposalRunId && !!user,
    refetchInterval: (q) => (active.includes(q.state.data?.status ?? 'queued') ? 1000 : false),
  });
  const proposing =
    proposalBusy || (!!proposalRunId && active.includes(proposalRun.data?.status ?? 'queued'));
  const proposalEvents = useRunEvents(proposalRunId, !!user, proposing);
  const proposal = useQuery({
    queryKey: ['proposal', proposalId],
    queryFn: () => api<ImprovementProposal>(`/proposals/${proposalId}`),
    enabled: !!proposalId && !!user,
    retry: false,
  });
  useEffect(() => {
    if (!proposalRun.data || active.includes(proposalRun.data.status)) return;
    if (proposalRun.data.result_id) {
      setProposalId(proposalRun.data.result_id);
      setShowProposal(true);
    } else setInvestigationError(proposalRun.data.error?.message ?? '改善案の作成を終了しました。');
    setProposalRunId('');
    cache.invalidateQueries({ queryKey: ['project', ws.projectId] });
  }, [proposalRun.data]);
  const bundle = useQuery({
    queryKey: ['bundle', ws.projectId, ws.analysisId, 'groove-chamber-v10'],
    queryFn: () =>
      api<Bundle>(
        ws.sampleId
          ? `/samples/${ws.sampleId}/bundle`
          : `/projects/${ws.projectId}/bundle${ws.analysisId ? `?analysis=${ws.analysisId}` : ''}`,
      ),
    enabled: !!ws.projectId && (ws.sampleId !== '' || !!user) && !runId,
    retry: false,
    staleTime: Infinity,
  });
  const run = useQuery({
    queryKey: ['run', runId],
    queryFn: () => api<Run>(`/runs/${runId}`),
    enabled: !!runId && !!user,
    refetchInterval: (query) =>
      active.includes(query.state.data?.status ?? 'queued') ? (document.hidden ? 5000 : 1000) : false,
  });
  const runEvents = useRunEvents(runId, !!user, active.includes(run.data?.status ?? 'queued'));
  const repository = useQuery({
    queryKey: ['repository', ws.projectId],
    queryFn: () => api<RepositoryStatus | null>(`/projects/${ws.projectId}/repository`),
    enabled: !!ws.projectId && !ws.sampleId && !!user,
    retry: false,
    refetchInterval: runId ? 5000 : false,
  });
  useEffect(() => {
    if (!run.data || active.includes(run.data.status)) return;
    if (['completed', 'partial'].includes(run.data.status)) {
      ws.set({
        analysisId: run.data.result_id ?? '',
        ...(run.data.result_id !== ws.analysisId
          ? { unitId: '', eventId: '', codeSpan: null, scene: 0 }
          : {}),
      });
      setRunId('');
      setAcceptingImprovement(false);
      cache.invalidateQueries({ queryKey: ['project', ws.projectId] });
      cache.invalidateQueries({ queryKey: ['repository', ws.projectId] });
    } else {
      setError(run.data.error?.message ?? '処理を終了しました。');
      setRunId('');
      setAcceptingImprovement(false);
    }
  }, [run.data]);
  const investigationRun = useQuery({
    queryKey: ['run', investigationRunId],
    queryFn: () => api<Run>(`/runs/${investigationRunId}`),
    enabled: !!investigationRunId && !!user,
    refetchInterval: (query) => (active.includes(query.state.data?.status ?? 'queued') ? 1000 : false),
  });
  useEffect(() => {
    if (!project.data || project.data.investigation_analysis_id !== ws.analysisId) return;
    if (project.data.investigation_run_id) setInvestigationRunId(project.data.investigation_run_id);
    else if (project.data.latest_investigation_id) {
      void api<InvestigationResult>(`/investigations/${project.data.latest_investigation_id}`)
        .then(setResult)
        .catch((e) => setInvestigationError(e.message));
    }
  }, [project.data, ws.analysisId]);
  const investigationEvents = useRunEvents(
    investigationRunId,
    !!user,
    active.includes(investigationRun.data?.status ?? 'queued'),
  );
  useEffect(() => {
    const run = investigationRun.data;
    if (!run || active.includes(run.status)) return;
    if (run.result_id)
      void api<InvestigationResult>(`/investigations/${run.result_id}`)
        .then(setResult)
        .catch((e) => setInvestigationError(e.message));
    else setInvestigationError(run.error?.message ?? '調査を終了しました。');
  }, [investigationRun.data]);
  const pending = starting || (!!runId && active.includes(run.data?.status ?? 'queued'));
  const investigating = !!investigationRunId && active.includes(investigationRun.data?.status ?? 'queued');
  const activityRunId = activity.data?.run_id || proposalRunId || investigationRunId || runId;
  const activityEvents = useRunEvents(
    activityRunId,
    !!user,
    !!activity.data || pending || investigating || proposing,
  );
  const activityStatus =
    activity.data?.status ||
    proposalRun.data?.status ||
    investigationRun.data?.status ||
    run.data?.status ||
    'queued';
  function openSample(id: string) {
    engine.pause();
    setDeepView(false);
    setInvestigationRunId('');
    setProposalId('');
    setProposalRunId('');
    setShowProposal(false);
    setAcceptingImprovement(false);
    ws.set({
      sampleId: id,
      projectId: `sample-${id}`,
      analysisId: '',
      scene: 0,
      unitId: '',
      eventId: '',
      codeSpan: null,
      screen: 'inspect',
      muted: [],
      solo: [],
      mode: 'repo',
      wholeWork: true,
      loop: false,
      pulseMuted: true,
      instrumentMutes: [],
      focusEvidence: false,
      playbackFile: '',
    });
    setModal('');
    setRunId('');
    setResult(undefined);
    setError('');
  }
  function goHome() {
    engine.pause();
    setDeepView(false);
    ws.set({ projectId: '', sampleId: '', analysisId: '', unitId: '', eventId: '', codeSpan: null });
    history.replaceState(null, '', '/');
  }
  async function openSaved(id: string) {
    setDeepView(true);
    setProposalId('');
    setProposalRunId('');
    setShowProposal(false);
    setAcceptingImprovement(false);
    setStarting(true);
    setModal('');
    setError('');
    setResult(undefined);
    setInvestigationRunId('');
    try {
      const saved = await api<{ latest_analysis_id?: string; run_id: string }>(`/projects/${id}`);
      ws.set({
        projectId: id,
        sampleId: '',
        analysisId: saved.latest_analysis_id ?? '',
        unitId: '',
        eventId: '',
        codeSpan: null,
        scene: 0,
        screen: 'inspect',
        muted: [],
        solo: [],
        playbackFile: '',
      });
      setRunId(saved.latest_analysis_id ? '' : saved.run_id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setStarting(false);
    }
  }
  async function openRepo(url?: string, scopePath?: string, snapshot?: ImportSnapshot) {
    if (!currentUser) {
      setPendingRepo({ url, scopePath, snapshot });
      setModal('auth');
      return;
    }
    setPendingRepo(undefined);
    setDeepView(true);
    setStarting(true);
    setProposalId('');
    setProposalRunId('');
    setShowProposal(false);
    setAcceptingImprovement(false);
    setError('');
    try {
      const project = await api<{ project_id: string; run_id: string }>(
        snapshot ? '/projects/import' : '/projects',
        snapshot ?? {
          source: url
            ? { kind: 'github_public', url, scope_path: scopePath || null }
            : { kind: 'sample', sample_id: ws.sampleId.replace(/^recorded-/, '') || 'mixed' },
        },
      );
      ws.set({
        projectId: project.project_id,
        sampleId: '',
        analysisId: '',
        unitId: '',
        eventId: '',
        codeSpan: null,
        scene: 0,
        screen: 'inspect',
        playbackFile: '',
      });
      setRunId(project.run_id);
      setModal('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setStarting(false);
    }
  }
  async function analyzeChunk(chunkId: string, retryPartial = false) {
    setStarting(true);
    setError('');
    setModal('');
    engine.pause();
    try {
      const created = await api<{ run_id: string }>(`/projects/${ws.projectId}/chunks`, {
        chunk_id: chunkId,
        ...(retryPartial ? { retry_partial: true } : {}),
      });
      setRunId(created.run_id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setStarting(false);
    }
  }
  async function activateSample() {
    if (!currentUser) {
      setModal('auth');
      return;
    }
    if (
      ['recorded-checkout-flow', 'recorded-returns-before', 'recorded-tsugiai-agents'].includes(ws.sampleId)
    ) {
      try {
        const saved = await api<{ project_id: string; analysis_id: string }>(
          `/samples/${ws.sampleId}/projects`,
          {},
        );
        ws.set({ projectId: saved.project_id, sampleId: '', analysisId: saved.analysis_id });
      } catch (e) {
        setInvestigationError((e as Error).message);
      }
    } else await openRepo();
  }
  async function investigate(question: string) {
    if (!currentUser) {
      setModal('auth');
      return;
    }
    if (!bundle.data) return;
    if (ws.codeSpan && !bundle.data.map.units.some((unit) => unit.primary_span.path === ws.codeSpan?.path)) {
      setInvestigationError(
        'この参考ファイルは保存済み検査の対象外です。まず演奏中の実装か検査済みの根拠行を選んでください。質問は保持しています。',
      );
      return;
    }
    setInvestigationError('');
    setResult(undefined);
    try {
      let analysisId = bundle.data.map.analysis_id;
      if (ws.sampleId) {
        if (
          !['recorded-checkout-flow', 'recorded-returns-before', 'recorded-tsugiai-agents'].includes(
            ws.sampleId,
          )
        ) {
          setInvestigationError(
            '模擬データへの新規調査には、実解析のサンプルかRepositoryを開いてください。質問は保持しています。',
          );
          return;
        }
        const saved = await api<{ project_id: string; analysis_id: string }>(
          `/samples/${ws.sampleId}/projects`,
          {},
        );
        analysisId = saved.analysis_id;
        ws.set({ projectId: saved.project_id, sampleId: '', analysisId });
      }
      const run = await api<{ run_id: string }>(`/analyses/${analysisId}/investigations`, {
        scene_id: bundle.data.score.scenes[ws.scene].scene_id,
        unit_ids: [ws.unitId || bundle.data.map.units.find((u) => u.review_state === 'inspected')!.unit_id],
        event_ids: ws.eventId ? [ws.eventId] : [],
        question,
      });
      setInvestigationRunId(run.run_id);
    } catch (e) {
      setInvestigationError((e as Error).message);
    }
  }
  async function refreshRepository() {
    if (!ws.projectId || ws.sampleId || !currentUser) return;
    setStarting(true);
    setError('');
    try {
      const run = await api<{ run_id: string }>(`/projects/${ws.projectId}/analyses`, {});
      setRunId(run.run_id);
      ws.set({ analysisId: '', eventId: '', unitId: '', codeSpan: null });
      cache.invalidateQueries({ queryKey: ['project', ws.projectId] });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setStarting(false);
    }
  }
  async function proposeImprovement(signalId: string) {
    if (!currentUser) {
      setModal('auth');
      return;
    }
    if (!bundle.data || tour) return;
    setInvestigationError('');
    setProposalBusy(true);
    setProposalId('');
    try {
      let analysisId = bundle.data.map.analysis_id;
      if (ws.sampleId) {
        if (
          !['recorded-returns-before', 'recorded-checkout-flow', 'recorded-tsugiai-agents'].includes(
            ws.sampleId,
          )
        )
          throw new Error('改善案はRepositoryの実解析、または実解析サンプルから始めてください。');
        const saved = await api<{ project_id: string; analysis_id: string }>(
          `/samples/${ws.sampleId}/projects`,
          {},
        );
        ws.set({ projectId: saved.project_id, sampleId: '', analysisId: saved.analysis_id });
        analysisId = saved.analysis_id;
      }
      const next = await api<{ run_id: string }>(`/analyses/${analysisId}/proposals`, {
        signal_id: signalId,
      });
      setProposalRunId(next.run_id);
    } catch (e) {
      setInvestigationError((e as Error).message);
    } finally {
      setProposalBusy(false);
    }
  }
  async function decideImprovement(accept: boolean) {
    if (!proposal.data || tour) return;
    setProposalBusy(true);
    setInvestigationError('');
    try {
      if (accept) {
        const next = await api<{ run_id: string }>(`/proposals/${proposalId}/accept`, {});
        setAcceptingImprovement(true);
        setRunId(next.run_id);
        setShowProposal(false);
        ws.set({ unitId: '', eventId: '', codeSpan: null });
      } else {
        await api(`/proposals/${proposalId}/reject`, {});
        setShowProposal(false);
      }
      cache.invalidateQueries({ queryKey: ['proposal', proposalId] });
    } catch (e) {
      setInvestigationError((e as Error).message);
    } finally {
      setProposalBusy(false);
    }
  }
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        e.defaultPrevented ||
        (e.target as HTMLElement).closest(
          'input,textarea,select,summary,button,.monaco-editor,[role="dialog"]',
        )
      )
        return;
      const events = bundle.data?.map.events ?? [];
      if (e.key === 'Escape') ws.set({ unitId: '', eventId: '', codeSpan: null });
      if (e.key === 'Enter' && (ws.unitId || ws.eventId)) ws.set({ screen: 'inspect' });
      if (['ArrowLeft', 'ArrowRight'].includes(e.key) && events.length) {
        e.preventDefault();
        const index = events.findIndex((event) => event.event_id === ws.eventId);
        const event =
          events[(index + (e.key === 'ArrowRight' ? 1 : events.length - 1) + events.length) % events.length];
        ws.set({ unitId: event.unit_id, eventId: event.event_id, codeSpan: null });
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [bundle.data, ws.unitId, ws.eventId]);
  const data = bundle.data;
  const isRehearsal = ws.sampleId === 'recorded-returns-before' && !deepView;
  const selectedFile =
    ws.codeSpan?.path ??
    data?.map.units.find((u) => u.unit_id === ws.unitId)?.primary_span.path ??
    data?.map.units[0]?.primary_span.path;
  const playbackPath = ws.playbackFile || selectedFile;
  const fileUnits = useMemo(
    () => data?.map.units.filter((u) => u.primary_span.path === playbackPath).map((u) => u.unit_id),
    [data?.map.units, playbackPath],
  );
  const playbackUnits = ws.playbackFile ? fileUnits : undefined;
  const playbackScene = ws.wholeWork ? 0 : ws.scene;
  const plan = useMemo(
    () =>
      playbackPlan(data?.score, ws.mode, playbackScene, ws.wholeWork, playbackUnits) ??
      playbackPlan(data?.score, ws.mode, playbackScene, ws.wholeWork),
    [data?.score, ws.mode, playbackScene, ws.wholeWork, playbackUnits],
  );
  useEffect(() => {
    if (!data || ws.unitId || ws.codeSpan) return;
    const signal =
      data.map.analysis_depth === 'overview'
        ? undefined
        : data.map.review_signals?.find((s) => s.verdict === 'concern');
    const target = data.map.units.find((u) => u.unit_id === signal?.unit_ids[0]) ?? data.map.units[0];
    const event = data.map.events.find((e) => e.unit_id === target.unit_id);
    ws.set({ unitId: target.unit_id, eventId: event?.event_id ?? '', codeSpan: null });
  }, [data, ws.unitId]);
  return (
    <div className="app-shell">
      <header className="topbar">
        <a
          className="brand"
          href="/"
          onClick={(e) => {
            e.preventDefault();
            goHome();
          }}
        >
          <span className="brand-mark">
            <i />
            <i />
            <i />
            <i />
          </span>
          Code Groove
        </a>
        <span className="product-purpose">変更を聴いて、根拠へ戻る</span>
        {!staticDemo && !isRehearsal && !!data && <SampleSwitch openSample={openSample} />}
        {staticDemo && <span className="public-demo-badge">保存済み解析の公開デモ</span>}
        {(ws.sampleId === 'recorded-returns-after' || (ws.sampleId === 'recorded-returns-before' && deepView)) && (
          <button onClick={() => ws.sampleId === 'recorded-returns-before' ? setDeepView(false) : openSample('recorded-returns-before')}>
            聴き比べに戻る
          </button>
        )}
        {project.data?.previous_analysis_id && (
          <div className="sample-switch" aria-label="採用した変更の比較">
            <button
              aria-pressed={ws.analysisId === project.data.previous_analysis_id}
              onClick={() => {
                engine.pause();
                ws.set({
                  analysisId: project.data!.previous_analysis_id!,
                  unitId: '',
                  eventId: '',
                  codeSpan: null,
                });
              }}
            >
              変更前
            </button>
            <button
              aria-pressed={ws.analysisId === project.data.latest_analysis_id}
              onClick={() => {
                engine.pause();
                ws.set({
                  analysisId: project.data!.latest_analysis_id!,
                  unitId: '',
                  eventId: '',
                  codeSpan: null,
                });
              }}
            >
              採用後
            </button>
          </div>
        )}
        {!staticDemo && (
          <button onClick={() => setModal('open')}>
            <FolderGit2 size={14} />
            PR / Repositoryを開く
          </button>
        )}
        {data && !isRehearsal && (
          <button
            className="agent-toggle"
            aria-label={ws.agentVisible ? 'Agentを閉じる' : 'Agentを開く'}
            aria-expanded={ws.agentVisible}
            aria-controls="workspace-agent"
            onClick={() => ws.set({ agentVisible: !ws.agentVisible })}
          >
            <PanelRight size={15} /> Agent
          </button>
        )}
        {!staticDemo && (
          <button className="icon-button" aria-label="使い方" onClick={() => setModal('guide')}>
            <HelpCircle size={16} />
          </button>
        )}
        <button
          className="icon-button"
          aria-label={ws.theme === 'light' ? 'ダークモードに切り替え' : 'ライトモードに切り替え'}
          onClick={() => ws.set({ theme: ws.theme === 'light' ? 'dark' : 'light' })}
        >
          {ws.theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
        </button>
        {staticDemo ? null : user ? (
          <button
            className="account"
            title="ログアウト"
            onClick={async () => {
              await logout();
              cache.clear();
              ws.set({
                projectId: '',
                sampleId: '',
                analysisId: '',
                unitId: '',
                eventId: '',
                codeSpan: null,
              });
              history.replaceState(null, '', '/');
              setRunId('');
              setInvestigationRunId('');
              setResult(undefined);
              setProposalId('');
              setProposalRunId('');
              setShowProposal(false);
            }}
          >
            <LogOut size={15} />
          </button>
        ) : (
          <button onClick={() => setModal('auth')}>ログイン</button>
        )}
      </header>
      {data && !isRehearsal && (
        <Transport
          score={data.score}
          selectedFile={selectedFile}
          fileUnits={fileUnits}
          partitioned={!!data.partition}
          onError={setError}
        />
      )}
      {user && ws.projectId && !ws.sampleId && (
        <div className="refresh-bar">
          <span>
            {repository.data
              ? `${repository.data.eligible_source_files}ファイル · ${repository.data.analyzed_chunks}/${repository.data.chunks.length}範囲に保存結果 · 全体は未判定`
              : project.data?.source?.scope_path
                ? `対象: ${project.data.source.scope_path} · 範囲外は未検査`
                : project.data?.working_copy
                  ? 'アプリ内のスナップショット · 元のRepositoryは保持'
                  : '保存済み結果を再生中 · Git更新時は変更と影響先だけ調査'}
          </span>
          {repository.data && <button onClick={() => setModal('repository')}>検査範囲と続きを選ぶ</button>}
          <button disabled={pending} onClick={() => void refreshRepository()}>
            {project.data?.working_copy ? '保存したコードを再確認' : 'Gitの差分を調べる'}
          </button>
        </div>
      )}
      {(error || bundle.error) && (
        <div className="inline-error" role="alert">
          {error || bundle.error?.message}
          <button onClick={staticDemo ? goHome : () => setModal('open')}>
            {staticDemo ? '最初に戻る' : '別のRepositoryを開く'}
          </button>
        </div>
      )}
      {pending ? (
        <main className="analysis-progress">
          <ScanLine size={27} />
          <h2>
            {acceptingImprovement
              ? '採用した変更を、Geminiが再確認しています'
              : 'Agentがコードの関係を調べています'}
          </h2>
          <p>
            {runEvents.data?.at(-1)?.payload.message ??
              runEvents.data?.at(-1)?.payload.purpose ??
              '固定スナップショットを準備しています。'}
          </p>
          <div className="agent-steps">
            {(runEvents.data ?? [])
              .filter((e) => e.type === 'tool_completed' || e.type === 'incremental_scope')
              .slice(-5)
              .map((e) => (
                <div key={e.seq}>
                  <span>✓</span>
                  {e.payload.purpose ??
                    e.payload.tool ??
                    `変更範囲を確認 · ${e.payload.reused_units} 関数を再利用`}
                </div>
              ))}
          </div>
          <button
            onClick={() => runId && void api(`/runs/${runId}/cancel`, {}).catch((e) => setError(e.message))}
          >
            調査を停止
          </button>
        </main>
      ) : ws.projectId && bundle.isPending && (ws.sampleId || user) ? (
        <main className="analysis-progress" role="status">
          <span className="spinner" />
          <h2>保存した演奏とコードを読み込んでいます</h2>
          <p>保存済み結果の表示で、新しいAI解析は始まりません。</p>
        </main>
      ) : data && !data.score.scenes.length ? (
        <main className="analysis-progress" role="status">
          <h2>判断を保留しました</h2>
          <p>根拠が揃った意味イベントがないため演奏はありません。無音は良い設計を意味しません。</p>
          <p>
            確認済み {data.map.coverage.inspected_units} / 対象 {data.map.coverage.indexed_units}実装
          </p>
          <ul>
            {data.map.profile.unknowns.map((reason, i) => (
              <li key={i}>{reason}</li>
            ))}
          </ul>
          <button onClick={() => setModal('repository')}>検査範囲を確認</button>
        </main>
      ) : data && isRehearsal ? (
        <RehearsalWorkspace before={data} explore={openSample} exploreBefore={() => setDeepView(true)} />
      ) : data && plan ? (
        <ReviewWorkspace bundle={data} plan={plan}>
          <AgentPanel
            question={agentQuestion}
            setQuestion={setAgentQuestion}
            key={data.map.analysis_id}
            bundle={data}
            result={result?.base_analysis_id === data.map.analysis_id ? result : undefined}
            events={proposing ? (proposalEvents.data ?? []) : (investigationEvents.data ?? [])}
            pending={investigating}
            proposing={proposing}
            propose={(id) => void proposeImprovement(id)}
            proposalTitle={
              proposal.data?.status === 'draft' && proposal.data.base_analysis_id === data.map.analysis_id
                ? proposal.data.title
                : undefined
            }
            openProposal={() => setShowProposal(true)}
            cancelProposal={() =>
              proposalRunId &&
              void api(`/runs/${proposalRunId}/cancel`, {}).catch((e) => setInvestigationError(e.message))
            }
            investigate={(q) => void investigate(q)}
            activateLive={() => void activateSample()}
            error={investigationError}
            publish={() => {
              if (result)
                void api<{ analysis_id: string }>(
                  `/investigations/${result.investigation_id}/publish-interpretation`,
                  {},
                )
                  .then((next) => {
                    ws.set({ analysisId: next.analysis_id });
                    void cache.invalidateQueries({ queryKey: ['project', ws.projectId] });
                    setResult(undefined);
                  })
                  .catch((e) => setInvestigationError(e.message));
            }}
          />
        </ReviewWorkspace>
      ) : (
        <StartRehearsal
          start={() => openSample('recorded-returns-before')}
          openRepository={() => setModal('open')}
          openAnalysis={() => openSample('recorded-returns-after')}
          staticDemo={staticDemo}
        />
      )}
      {modal === 'open' && (
        <OpenDialog
          close={() => setModal('')}
          openSample={openSample}
          openRepo={(url, scope) => void openRepo(url, scope)}
          openSnapshot={(snapshot) => void openRepo(undefined, undefined, snapshot)}
          openProject={(id) => void openSaved(id)}
          pending={starting}
        />
      )}
      {modal === 'repository' && repository.data && (
        <RepositoryDialog
          repository={repository.data}
          close={() => setModal('')}
          pending={pending}
          analyze={(id, retryPartial) => void analyzeChunk(id, retryPartial)}
          integrate={(chunkIds, unitIds) => {
            setStarting(true);
            setError('');
            setModal('');
            void api<{ run_id: string }>(`/projects/${ws.projectId}/integrations`, {
              chunk_ids: chunkIds,
              unit_ids: unitIds,
            })
              .then((created) => setRunId(created.run_id))
              .catch((e) => setError(e.message))
              .finally(() => setStarting(false));
          }}
          open={(id) => {
            engine.pause();
            ws.set({ analysisId: id, unitId: '', eventId: '', codeSpan: null, scene: 0, playbackFile: '' });
            setResult(undefined);
            setInvestigationRunId('');
            setModal('');
          }}
        />
      )}
      {modal === 'auth' && (
        <AuthDialog
          close={() => setModal('')}
          done={() => {
            if (pendingRepo) void openRepo(pendingRepo.url, pendingRepo.scopePath, pendingRepo.snapshot);
            else setModal(ws.sampleId ? '' : 'open');
          }}
        />
      )}
      {modal === 'guide' && (
        <Onboarding
          close={() => setModal('')}
          loadSample={() => {
            ws.set({ mode: 'repo', wholeWork: true, loop: false, pulseMuted: true, agentVisible: true });
            openSample('recorded-tsugiai-agents');
            setTour(true);
          }}
        />
      )}
      {tour && <SpotlightTour ready={!!data && !!plan} close={() => setTour(false)} />}
      {showProposal && proposal.data && (
        <ImprovementDialog
          proposal={proposal.data}
          close={() => setShowProposal(false)}
          accept={() => void decideImprovement(true)}
          reject={() => void decideImprovement(false)}
          pending={proposalBusy}
          error={investigationError}
        />
      )}
      {(activity.data || pending || investigating || proposing) && (
        <AgentActivity
          status={activityStatus}
          kind={
            activity.data?.kind ?? (proposing ? 'proposal' : investigating ? 'investigation' : 'analysis')
          }
          events={activityEvents.data ?? []}
          open={
            activity.data
              ? () => {
                  setModal('');
                  void openSaved(activity.data!.project_id);
                }
              : undefined
          }
        />
      )}
    </div>
  );
}

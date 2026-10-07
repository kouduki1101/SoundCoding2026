import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Span } from '../../../packages/contracts/SemanticMap';

type Workspace = {
  projectId: string;
  analysisId: string;
  sampleId: string;
  scene: number;
  mode: 'theme' | 'repo';
  screen: 'arrange' | 'inspect';
  eventId: string;
  unitId: string;
  signalId: string;
  volume: number;
  loop: boolean;
  codeSpan: Span | null;
  muted: string[];
  solo: string[];
  pulseMuted: boolean;
  wholeWork: boolean;
  instrumentMutes: string[];
  focusEvidence: boolean;
  playbackFile: string;
  showBacking: boolean;
  theme: 'light' | 'dark';
  agentVisible: boolean;
  following: boolean;
  set: (values: Partial<Omit<Workspace, 'set'>>) => void;
};
export const useWorkspace = create<Workspace>()(
  persist(
    (set) => ({
      projectId: '',
      analysisId: '',
      sampleId: '',
      scene: 0,
      mode: 'repo',
      screen: 'arrange',
      eventId: '',
      unitId: '',
      signalId: '',
      codeSpan: null,
      volume: 0.45,
      loop: false,
      muted: [],
      solo: [],
      pulseMuted: true,
      wholeWork: true,
      instrumentMutes: [],
      focusEvidence: false,
      playbackFile: '',
      showBacking: false,
      theme: 'light',
      agentVisible: true,
      following: true,
      set: (values) =>
        set({ ...('eventId' in values || 'unitId' in values ? { signalId: '' } : {}), ...values }),
    }),
    { name: 'code-groove-workspace-v1' },
  ),
);

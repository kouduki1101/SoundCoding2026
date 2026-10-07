import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  getAuth,
  browserSessionPersistence,
  setPersistence,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from 'firebase/auth';
import type { SemanticMap, ScoreBundle, InvestigationResult } from '../../../packages/contracts';
import { staticDemoApi } from './staticDemoApi';

export type Bundle = {
  map: SemanticMap;
  score: ScoreBundle;
  sources: Record<string, string>;
  sample_id?: string;
  case_study?: {
    title: string;
    context: string;
    scope: string;
    repository_url: string;
    revision: string;
    recorded_at: string;
    repository_source_files: number;
    runtime_verification: 'not_run';
    license: string;
  };
  investigation?: InvestigationResult;
  trace?: { seq: number; type: string; timestamp: string; payload: Record<string, any> }[];
  repository?: RepositoryStatus;
  partition?: { chunk_id: string; paths: string[]; whole_repository_complete: false };
};
export type RepositoryReference = {
  origin: 'committed_source_reference';
  revision: string;
  repository_url: string;
  license: string;
  semantic_analysis: 'not_run';
  source_lines: number;
  indexed_symbols: number;
  sources: Record<string, string>;
  source_sha256: Record<string, string>;
};
export type RepositoryStatus = {
  snapshot_id: string;
  eligible_source_files: number;
  source_lines: number;
  indexed_symbols: number;
  implementation_units: number;
  analyzed_chunks: number;
  inspected_units: number;
  pending_units: number;
  unresolved_units: number;
  files_without_units: string[];
  note: string;
  cross_partition_review: 'not_run' | 'scoped';
  integrations?: { analysis_id: string; chunk_ids: string[]; inspected_units: number }[];
  chunks: {
    chunk_id: string;
    label: string;
    paths: string[];
    units: number;
    unit_ids?: string[];
    owner_units?: {
      unit_id: string;
      label: string;
      span: { path: string; start_line: number; end_line: number };
    }[];
    symbol_count: number;
    status: 'pending' | 'partial' | 'analyzed';
    analysis_id?: string;
    inspected_units: number;
    unresolved_units: number;
    cache_compatible?: boolean;
  }[];
};
export type ImportSnapshot = { revision: string; label: string; sources: Record<string, string> };
export type PublicConfig = {
  daily_analysis_limit: number;
  live_enabled: boolean;
  local_mock_enabled?: boolean;
  firebase: { apiKey: string; authDomain: string; projectId: string; appId: string };
  model_id: string;
};
let firebase: FirebaseApp | undefined;
export let currentUser: User | null = null;
export async function setupAuth(config: PublicConfig, onUser: (user: User | null) => void) {
  if (!config.firebase.apiKey) return;
  firebase = initializeApp(config.firebase);
  const auth = getAuth(firebase);
  await setPersistence(auth, browserSessionPersistence);
  auth.onAuthStateChanged((user) => {
    currentUser = user;
    onUser(user);
  });
}
export async function login(email: string, password: string) {
  if (!firebase) throw new Error('認証設定を準備中です。サンプルの再生は利用できます。');
  const credential = await signInWithEmailAndPassword(getAuth(firebase), email, password);
  currentUser = credential.user;
}
export async function logout() {
  if (firebase) await signOut(getAuth(firebase));
}
export async function api<T>(path: string, body?: unknown, method?: string): Promise<T> {
  if (import.meta.env.VITE_STATIC_DEMO === '1') return staticDemoApi<T>(path, body, method);
  const headers: Record<string, string> = {};
  if (currentUser) headers.Authorization = `Bearer ${await currentUser.getIdToken()}`;
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    headers['Idempotency-Key'] = crypto.randomUUID();
  }
  const response = await fetch(`/api/v1${path}`, {
    method: method ?? (body === undefined ? 'GET' : 'POST'),
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.message ?? `接続エラー (${response.status})`);
  return result.data;
}

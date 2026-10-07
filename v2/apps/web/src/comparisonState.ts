import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  ComparisonHumanRecord,
  ComparisonInvestigationResult,
} from '../../../packages/contracts/ComparisonExport';

export const newComparisonRecord = (): ComparisonHumanRecord => {
  const now = new Date().toISOString();
  return {
    record_id: `record_${crypto.randomUUID().replaceAll('-', '')}`,
    expectation: '',
    observation: '',
    question: '',
    recognition: 'unrecorded',
    reason_status: 'not_started',
    judgment: 'unrecorded',
    reason_evidence: '',
    started_at: now,
    updated_at: now,
    ended_at: null,
    answers: [],
    operations: [],
  };
};
type Records = {
  records: Record<string, ComparisonHumanRecord>;
  runs: Record<string, string>;
  trackRun: (key: string, runId: string) => void;
  ensure: (key: string) => void;
  update: (
    key: string,
    fields: Partial<ComparisonHumanRecord>,
    operation: string,
    detail?: Record<string, unknown>,
  ) => void;
  answer: (key: string, answer: ComparisonInvestigationResult) => void;
};
export const useComparisonRecords = create<Records>()(
  persist(
    (set, get) => ({
      records: {},
      runs: {},
      trackRun: (key, runId) => set((s) => ({ runs: { ...s.runs, [key]: runId } })),
      ensure: (key) => {
        if (!get().records[key]) set((s) => ({ records: { ...s.records, [key]: newComparisonRecord() } }));
      },
      update: (key, fields, operation, detail = {}) =>
        set((s) => {
          const previous = s.records[key] ?? newComparisonRecord();
          const now = new Date().toISOString();
          return {
            records: {
              ...s.records,
              [key]: {
                ...previous,
                ...fields,
                updated_at: now,
                operations: [...previous.operations, { at: now, operation, ...detail }],
              },
            },
          };
        }),
      answer: (key, answer) => {
        const previous = get().records[key];
        if (!previous || previous.answers.some((a) => a.investigation_id === answer.investigation_id)) return;
        get().update(key, { answers: [...previous.answers, answer] }, 'answer_received', {
          investigation_id: answer.investigation_id,
          origin: answer.origin,
        });
      },
    }),
    { name: 'code-groove-comparison-records-v1' },
  ),
);

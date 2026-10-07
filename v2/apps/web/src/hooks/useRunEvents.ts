import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import type { TraceEvent } from '../components/AgentPanel';

export function useRunEvents(runId: string, authenticated: boolean, active: boolean) {
  const cache = useQueryClient();
  return useQuery({
    queryKey: ['events', runId],
    enabled: !!runId && authenticated,
    queryFn: async () => {
      const previous = cache.getQueryData<TraceEvent[]>(['events', runId]) ?? [];
      const next = await api<TraceEvent[]>(`/runs/${runId}/events?after_seq=${previous.at(-1)?.seq ?? 0}`);
      return [...previous, ...next.filter((event) => !previous.some((old) => old.seq === event.seq))];
    },
    refetchInterval: active ? (document.hidden ? 5000 : 2000) : false,
  });
}

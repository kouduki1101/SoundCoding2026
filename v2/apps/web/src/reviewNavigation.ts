import type { ReviewSignal } from '../../../packages/contracts/SemanticMap';
import type { Bundle } from './api';

export const counterStatusText = {
  not_checked: '反証未確認 · 確認記録なし',
  supported: '別の説明を支持',
  rejected: '別の説明を検討・棄却した記録あり',
  undetermined: '別の説明は判断保留',
};
export const verdictText = { concern: '確認候補', justified: '理由のある違い', inconclusive: '判断保留' };

export function signalSelection(bundle: Bundle, signal: ReviewSignal) {
  const event = bundle.map.events.find(
    (item) => signal.event_ids.includes(item.event_id) && item.state === 'grounded',
  );
  const unit = bundle.map.units.find(
    (item) => item.unit_id === event?.unit_id || signal.unit_ids.includes(item.unit_id),
  );
  const proof = bundle.map.evidence.find((item) => signal.evidence_ids.includes(item.evidence_id));
  return {
    eventId: event?.event_id ?? '',
    unitId: event?.unit_id ?? unit?.unit_id ?? '',
    signalId: signal.signal_id,
    codeSpan: event ? null : (unit?.primary_span ?? proof?.span ?? null),
    agentVisible: true,
    screen: 'inspect' as const,
  };
}

import type { ReturnQuote, ReturnRequest } from './contracts';

const DAY_MS = 86_400_000;
const POLICY = { standardDays: 30, plusDays: 45, standardFeeRate: 0.03, quoteDays: 7 };

export function evaluateReturnPolicy(request: ReturnRequest): ReturnQuote {
  const elapsedDays = Math.floor(
    (Date.parse(request.requestedAt) - Date.parse(request.purchasedAt)) / DAY_MS,
  );
  const windowDays = request.tier === 'plus' ? POLICY.plusDays : POLICY.standardDays;
  const inWindow = elapsedDays >= 0 && elapsedDays <= windowDays;
  const reasons: string[] = [];
  const eligibleSkus: string[] = [];
  let grossCents = 0;

  if (!request.receiptVerified) reasons.push('receipt-required');
  if (!inWindow) reasons.push('outside-window');
  for (const line of request.lines) {
    if (line.finalSale) {
      reasons.push(`final-sale:${line.sku}`);
      continue;
    }
    const remaining = line.quantity - line.returnedQuantity;
    if (remaining <= 0 || !request.receiptVerified || !inWindow) continue;
    eligibleSkus.push(line.sku);
    grossCents += line.paidCents * remaining;
  }

  const feeCents = request.tier === 'plus' ? 0 : Math.round(grossCents * POLICY.standardFeeRate);
  return {
    orderId: request.orderId,
    eligibleSkus,
    amountCents: grossCents - feeCents,
    feeCents,
    reasons,
    expiresAt: new Date(Date.parse(request.requestedAt) + POLICY.quoteDays * DAY_MS).toISOString(),
  };
}

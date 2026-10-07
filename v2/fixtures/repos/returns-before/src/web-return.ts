import type { AuditSink, ReturnQuote, ReturnRepository, ReturnRequest } from './contracts';

export function quoteWebReturn(request: ReturnRequest): ReturnQuote {
  const elapsedDays = Math.floor(
    (Date.parse(request.requestedAt) - Date.parse(request.purchasedAt)) / 86_400_000,
  );
  const windowDays = request.tier === 'plus' ? 45 : 30;
  const reasons: string[] = [];
  const eligibleSkus: string[] = [];
  let grossCents = 0;

  if (!request.receiptVerified) reasons.push('receipt-required');
  if (elapsedDays < 0 || elapsedDays > windowDays) reasons.push('outside-window');

  for (const line of request.lines) {
    const remaining = line.quantity - line.returnedQuantity;
    if (line.finalSale) {
      reasons.push(`final-sale:${line.sku}`);
      continue;
    }
    if (remaining <= 0) continue;
    if (!request.receiptVerified || elapsedDays < 0 || elapsedDays > windowDays) continue;
    eligibleSkus.push(line.sku);
    grossCents += line.paidCents * remaining;
  }

  const feeCents = request.tier === 'plus' ? 0 : Math.round(grossCents * 0.03);
  const expiresAt = new Date(Date.parse(request.requestedAt) + 7 * 86_400_000).toISOString();
  return {
    orderId: request.orderId,
    eligibleSkus,
    amountCents: grossCents - feeCents,
    feeCents,
    reasons,
    expiresAt,
  };
}

export async function submitWebReturn(
  orderId: string,
  repository: ReturnRepository,
  audit: AuditSink,
): Promise<ReturnQuote> {
  const request = await repository.findRequest(orderId);
  const quote = quoteWebReturn(request);
  await repository.saveQuote('web', quote);
  await audit.record({ channel: 'web', orderId, amountCents: quote.amountCents });
  return quote;
}

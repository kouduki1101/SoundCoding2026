import type { AuditSink, ReturnQuote, ReturnRepository, ReturnRequest } from './contracts';

export function quoteStoreReturn(request: ReturnRequest): ReturnQuote {
  const purchaseTime = Date.parse(request.purchasedAt);
  const requestTime = Date.parse(request.requestedAt);
  const age = Math.floor((requestTime - purchaseTime) / 86_400_000);
  const limit = request.tier === 'plus' ? 45 : 30;
  const receiptPresent = request.receiptVerified;
  const inWindow = age >= 0 && age <= limit;
  const reasons: string[] = [];
  const eligibleSkus: string[] = [];
  let subtotal = 0;

  if (!receiptPresent) reasons.push('receipt-required');
  if (!inWindow) reasons.push('outside-window');

  for (const item of request.lines) {
    if (item.finalSale) {
      reasons.push(`final-sale:${item.sku}`);
      continue;
    }
    const available = item.quantity - item.returnedQuantity;
    if (available > 0 && receiptPresent && inWindow) {
      eligibleSkus.push(item.sku);
      subtotal += item.paidCents * available;
    }
  }

  const processingFee = request.tier === 'plus' ? 0 : Math.round(subtotal * 0.03);
  return {
    orderId: request.orderId,
    eligibleSkus,
    amountCents: subtotal - processingFee,
    feeCents: processingFee,
    reasons,
    expiresAt: new Date(requestTime + 7 * 86_400_000).toISOString(),
  };
}

export async function submitStoreReturn(
  orderId: string,
  repository: ReturnRepository,
  audit: AuditSink,
): Promise<ReturnQuote> {
  const request = await repository.findRequest(orderId);
  const quote = quoteStoreReturn(request);
  await repository.saveQuote('store', quote);
  await audit.record({ channel: 'store', orderId, amountCents: quote.amountCents });
  return quote;
}

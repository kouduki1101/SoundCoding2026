import type { AuditSink, ReturnQuote, ReturnRepository } from './contracts';
import { evaluateReturnPolicy } from './return-policy';

export async function submitWebReturn(
  orderId: string,
  repository: ReturnRepository,
  audit: AuditSink,
): Promise<ReturnQuote> {
  const request = await repository.findRequest(orderId);
  const quote = evaluateReturnPolicy(request);
  await repository.saveQuote('web', quote);
  await audit.record({ channel: 'web', orderId, amountCents: quote.amountCents });
  return quote;
}

export async function submitStoreReturn(
  orderId: string,
  repository: ReturnRepository,
  audit: AuditSink,
): Promise<ReturnQuote> {
  const request = await repository.findRequest(orderId);
  const quote = evaluateReturnPolicy(request);
  await repository.saveQuote('store', quote);
  await audit.record({ channel: 'store', orderId, amountCents: quote.amountCents });
  return quote;
}

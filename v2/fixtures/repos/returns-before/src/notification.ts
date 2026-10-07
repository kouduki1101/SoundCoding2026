import type { ReturnQuote, ReturnRequest } from './contracts';

export function renderReturnReceipt(request: ReturnRequest, quote: ReturnQuote) {
  const accepted = quote.eligibleSkus.length;
  const amount = new Intl.NumberFormat('ja-JP', {
    style: 'currency', currency: 'JPY', maximumFractionDigits: 0,
  }).format(quote.amountCents / 100);
  const heading = accepted ? '返品見積もりを受け付けました' : '返品条件をご確認ください';
  const details = [
    `注文 ${request.orderId}`,
    `対象商品 ${accepted} 件`,
    `返金見込み ${amount}`,
    `見積もり期限 ${quote.expiresAt.slice(0, 10)}`,
  ];
  if (quote.reasons.length) details.push(`確認事項 ${quote.reasons.join(', ')}`);
  return { customerId: request.customerId, heading, body: details.join('\n') };
}

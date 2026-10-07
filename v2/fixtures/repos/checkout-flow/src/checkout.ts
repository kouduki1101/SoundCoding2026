import type { CheckoutRequest, OrderRecord, OrderStore } from './contracts';
import { invoiceSummary, quoteInvoice } from './pricing';
import { accrueReward, describeReward } from './rewards';

export async function submitCheckout(request: CheckoutRequest, store: OrderStore) {
  const invoice = quoteInvoice(
    request.lines,
    request.campaign,
    request.submittedAt,
    request.deliveryCents,
  );
  const reward = request.memberId
    ? accrueReward(request.memberId, request.lines, request.campaign, request.submittedAt)
    : null;

  const record: OrderRecord = {
    requestId: request.requestId,
    items: request.lines.map((line) => ({ sku: line.sku, quantity: line.quantity })),
    invoice,
    reward,
  };
  const saved = await store.saveOnce(record);
  return {
    orderId: saved.orderId,
    totalCents: invoice.totalCents,
    message: `${invoiceSummary(invoice)}\n${describeReward(reward)}`,
  };
}

export function checkoutReceipt(record: OrderRecord, orderId: string) {
  return {
    orderId,
    itemCount: record.items.reduce((sum, item) => sum + item.quantity, 0),
    amountCents: record.invoice.totalCents,
    lines: [invoiceSummary(record.invoice), describeReward(record.reward)],
  };
}

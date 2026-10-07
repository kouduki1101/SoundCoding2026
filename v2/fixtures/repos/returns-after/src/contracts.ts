export interface OrderLine {
  sku: string;
  paidCents: number;
  quantity: number;
  returnedQuantity: number;
  finalSale: boolean;
}

export interface ReturnRequest {
  orderId: string;
  customerId: string;
  purchasedAt: string;
  requestedAt: string;
  receiptVerified: boolean;
  tier: 'standard' | 'plus';
  lines: OrderLine[];
}

export interface ReturnQuote {
  orderId: string;
  eligibleSkus: string[];
  amountCents: number;
  feeCents: number;
  reasons: string[];
  expiresAt: string;
}

export interface ReturnRepository {
  findRequest(orderId: string): Promise<ReturnRequest>;
  saveQuote(channel: string, quote: ReturnQuote): Promise<void>;
}

export interface AuditSink {
  record(entry: { channel: string; orderId: string; amountCents: number }): Promise<void>;
}

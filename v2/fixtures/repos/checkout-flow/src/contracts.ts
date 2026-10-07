export type CartLine = {
  sku: string;
  label: string;
  unitPriceCents: number;
  quantity: number;
  category: 'merchandise' | 'gift-card';
};

export type Campaign = {
  code: string;
  rate: number;
  minimumCents: number;
  capCents: number;
  expiresAt: number;
};

export type CheckoutRequest = {
  requestId: string;
  lines: CartLine[];
  campaign: Campaign | null;
  submittedAt: number;
  deliveryCents: number;
  memberId: string | null;
};

export type Invoice = {
  subtotalCents: number;
  discountCents: number;
  deliveryCents: number;
  totalCents: number;
  campaignCode: string | null;
};

export type RewardEntry = {
  memberId: string;
  points: number;
  basisCents: number;
  campaignCode: string | null;
};

export type OrderRecord = {
  requestId: string;
  items: { sku: string; quantity: number }[];
  invoice: Invoice;
  reward: RewardEntry | null;
};

export type OrderStore = {
  saveOnce: (record: OrderRecord) => Promise<{ orderId: string }>;
};

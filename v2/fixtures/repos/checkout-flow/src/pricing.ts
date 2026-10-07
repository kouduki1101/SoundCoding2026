import type { Campaign, CartLine, Invoice } from './contracts';

export function quoteInvoice(
  lines: CartLine[],
  campaign: Campaign | null,
  submittedAt: number,
  deliveryCents: number,
): Invoice {
  const subtotalCents = lines.reduce((sum, line) => sum + line.unitPriceCents * line.quantity, 0);
  const discountableCents = lines
    .filter((line) => line.category !== 'gift-card')
    .reduce((sum, line) => sum + line.unitPriceCents * line.quantity, 0);
  const activeCampaign = campaign && submittedAt <= campaign.expiresAt ? campaign : null;

  let discountCents = 0;
  let campaignCode: string | null = null;
  if (activeCampaign && discountableCents >= activeCampaign.minimumCents) {
    discountCents = Math.min(
      discountableCents,
      activeCampaign.capCents,
      Math.round(discountableCents * activeCampaign.rate),
    );
    campaignCode = activeCampaign.code;
  }

  return {
    subtotalCents,
    discountCents,
    deliveryCents,
    totalCents: subtotalCents - discountCents + deliveryCents,
    campaignCode,
  };
}

export function invoiceSummary(invoice: Invoice) {
  const parts = [`Items $${(invoice.subtotalCents / 100).toFixed(2)}`];
  if (invoice.campaignCode) {
    parts.push(`${invoice.campaignCode}: -$${(invoice.discountCents / 100).toFixed(2)}`);
  }
  if (invoice.deliveryCents) parts.push(`Delivery $${(invoice.deliveryCents / 100).toFixed(2)}`);
  parts.push(`Total $${(invoice.totalCents / 100).toFixed(2)}`);
  return parts.join(' · ');
}

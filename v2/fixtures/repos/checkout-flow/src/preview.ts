import type { Campaign, CartLine } from './contracts';

export function previewCart(lines: CartLine[], campaign: Campaign | null, now: number) {
  let totalCents = 0;
  let merchandiseCents = 0;
  for (const line of lines) {
    const extendedCents = line.unitPriceCents * line.quantity;
    totalCents += extendedCents;
    if (line.category === 'merchandise') merchandiseCents += extendedCents;
  }

  const available = campaign !== null && now <= campaign.expiresAt;
  const qualifies = available && merchandiseCents >= campaign.minimumCents;
  const savingCents = qualifies
    ? Math.min(merchandiseCents, campaign.capCents, Math.round(merchandiseCents * campaign.rate))
    : 0;
  const couponState = !campaign
    ? 'none'
    : !available
      ? 'expired'
      : !qualifies
        ? 'below-minimum'
        : 'applied';

  return {
    totalCents: totalCents - savingCents,
    savingCents,
    couponState,
    advisory: true as const,
  };
}

export function describePreview(preview: ReturnType<typeof previewCart>) {
  const amount = (preview.totalCents / 100).toFixed(2);
  if (preview.couponState === 'expired') return `Estimated $${amount}. Coupon expired.`;
  if (preview.couponState === 'below-minimum') return `Estimated $${amount}. Minimum not reached.`;
  if (preview.savingCents > 0) {
    return `Estimated $${amount}. Saving $${(preview.savingCents / 100).toFixed(2)}.`;
  }
  return `Estimated $${amount}. Confirmed at checkout.`;
}

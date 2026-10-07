import type { Campaign, CartLine, RewardEntry } from './contracts';

export function accrueReward(
  memberId: string,
  lines: CartLine[],
  campaign: Campaign | null,
  submittedAt: number,
): RewardEntry {
  let paidMerchandiseCents = 0;
  for (const line of lines) {
    if (line.category === 'gift-card') continue;
    paidMerchandiseCents += line.quantity * line.unitPriceCents;
  }

  let campaignCode: string | null = null;
  if (
    campaign &&
    campaign.expiresAt >= submittedAt &&
    paidMerchandiseCents >= campaign.minimumCents
  ) {
    const proportionalSaving = Math.round(paidMerchandiseCents * campaign.rate);
    const appliedSaving = Math.min(proportionalSaving, campaign.capCents, paidMerchandiseCents);
    paidMerchandiseCents -= appliedSaving;
    campaignCode = campaign.code;
  }

  return {
    memberId,
    points: Math.floor(paidMerchandiseCents / 100),
    basisCents: paidMerchandiseCents,
    campaignCode,
  };
}

export function describeReward(reward: RewardEntry | null) {
  if (!reward) return 'Guest checkout. No loyalty credit.';
  return `${reward.points} points on $${(reward.basisCents / 100).toFixed(2)} paid merchandise.`;
}

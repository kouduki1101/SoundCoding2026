export function isRefundEligible(
  price: number, daysSincePurchase: number, isFinalSale: boolean,
  hasReceipt: boolean, customerName: string,
) {
  return daysSincePurchase <= 30 && !isFinalSale && hasReceipt;
}

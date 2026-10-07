export function isRefundEligible(
  price: number, daysSincePurchase: number, isFinalSale: boolean,
  hasReceipt: boolean, customerName: string,
) {
  const withinWindow = daysSincePurchase <= 30;
  const refundable = !isFinalSale;
  return withinWindow && refundable && hasReceipt;
}

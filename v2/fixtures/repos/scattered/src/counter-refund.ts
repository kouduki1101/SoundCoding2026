export function refundAtCounter(
  price: number, daysSincePurchase: number, isFinalSale: boolean,
  hasReceipt: boolean, customerName: string,
) {
  const withinWindow = daysSincePurchase <= 30;
  return withinWindow && !isFinalSale && hasReceipt;
}

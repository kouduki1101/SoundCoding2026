export function calculateRefund(
  price: number, daysSincePurchase: number, isFinalSale: boolean,
  hasReceipt: boolean, customerName: string,
) {
  const fee = Math.round(price * 0.05);
  return Math.max(0, price - fee);
}

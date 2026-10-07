export function calculateRefund(
  price: number, daysSincePurchase: number, isFinalSale: boolean,
  hasReceipt: boolean, customerName: string,
) {
  const fee = Math.round(price * 0.05);
  const amount = Math.max(0, price - fee);
  return Math.min(amount, price);
}

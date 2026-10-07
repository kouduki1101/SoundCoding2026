export function calculateRefund(
  price: number, daysSincePurchase: number, isFinalSale: boolean,
  hasReceipt: boolean, customerName: string,
) {
  return Math.max(0, price - Math.round(price * 0.05));
}

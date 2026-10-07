export function previewRefund(
  price: number, daysSincePurchase: number, isFinalSale: boolean,
  hasReceipt: boolean, customerName: string,
) {
  const eligible = daysSincePurchase <= 30 && !isFinalSale;
  const amount = eligible ? Math.max(0, price - price * 0.05) : 0;
  return `${customerName}: ${amount} yen`;
}

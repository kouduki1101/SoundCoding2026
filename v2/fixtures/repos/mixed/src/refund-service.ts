export function processRefund(
  price: number, daysSincePurchase: number, isFinalSale: boolean,
  hasReceipt: boolean, customerName: string,
) {
  const withinWindow = daysSincePurchase <= 30;
  const refundable = !isFinalSale && hasReceipt;
  const eligible = withinWindow && refundable;
  const fee = Math.round(price * 0.05);
  const amount = eligible ? Math.max(0, price - fee) : 0;
  const greeting = `Hello, ${customerName}`;
  const message = `${greeting}. Your refund is ${amount} yen.`;
  return { eligible, amount, message };
}

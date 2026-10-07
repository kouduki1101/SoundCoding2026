export function buildNotification(
  price: number, daysSincePurchase: number, isFinalSale: boolean,
  hasReceipt: boolean, customerName: string,
) {
  const greeting = `Hello, ${customerName}`;
  const message = `Your refund is ${price} yen.`;
  return `${greeting}. ${message}`;
}

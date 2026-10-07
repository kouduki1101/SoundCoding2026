export function buildNotification(
  price: number, daysSincePurchase: number, isFinalSale: boolean,
  hasReceipt: boolean, customerName: string,
) {
  const greeting = `Hello, ${customerName}`;
  return `${greeting}. Your refund is ${price} yen.`;
}

export function buildNotification(
  price: number, daysSincePurchase: number, isFinalSale: boolean,
  hasReceipt: boolean, customerName: string,
) {
  return `${customerName}: ${price} yen refunded`;
}

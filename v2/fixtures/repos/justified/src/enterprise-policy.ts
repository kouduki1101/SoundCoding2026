export function enterpriseRefund(
  price: number, daysSincePurchase: number, isFinalSale: boolean,
  hasReceipt: boolean, customerName: string,
) {
  const contractedWindow = 90;
  return daysSincePurchase <= contractedWindow && hasReceipt;
}

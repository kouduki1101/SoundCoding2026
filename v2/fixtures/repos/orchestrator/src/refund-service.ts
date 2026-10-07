import { isRefundEligible } from './refund-policy';
import { calculateRefund } from './refund-amount';
import { buildNotification } from './notification';
export function processRefund(price: number, days: number, final: boolean, receipt: boolean, name: string) {
  if (!isRefundEligible(price, days, final, receipt, name)) return null;
  const amount = calculateRefund(price, days, final, receipt, name);
  return buildNotification(amount, days, final, receipt, name);
}

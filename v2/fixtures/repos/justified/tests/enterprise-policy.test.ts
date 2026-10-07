// Contract: enterprise customers have a 90-day refund window.
import { enterpriseRefund } from '../src/enterprise-policy';
// Boundary examples: 60 days accepted, 91 days rejected.
export const examples = [{ days: 60, eligible: true }, { days: 91, eligible: false }];

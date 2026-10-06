import { planStandard, planExpress } from "./channels.js";

export function prepareDelivery(parcel) {
  return planExpress(parcel);
}

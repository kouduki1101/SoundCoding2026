export function planStandard(parcel) {
  return { service: "standard", parcelId: parcel.id, dueDays: 3 };
}

export function planExpress(parcel) {
  return { service: "express", parcelId: parcel.id, dueDays: 1 };
}

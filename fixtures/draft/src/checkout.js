import { quote } from "./pricing.js";
import { reserve } from "./inventory.js";

// Fictional shared integration; Aoi reviews the boundary between the parts.
export function checkout(lines, inventory, { discountRate = 0, price = quote } = {}) {
  const reservation = reserve(inventory, lines);
  if (!reservation) {
    return { status: "sold-out" };
  }
  const amount = price(lines, discountRate);
  return { status: "confirmed", ...amount };
}

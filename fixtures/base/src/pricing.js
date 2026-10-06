// Fictional team: Mina's original calculation, reviewed together with Ren.
export function quote(lines, discountRate = 0) {
  const subtotal = lines.reduce(
    (sum, line) => sum + line.unitPrice * line.quantity,
    0
  );
  const discount = Math.round(subtotal * discountRate);
  return { subtotal, discount, total: subtotal - discount, currency: "JPY" };
}

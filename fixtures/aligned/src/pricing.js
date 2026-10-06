// Fictional pair session: Mina and Ren try an equivalent explicit loop.
export function quote(lines, discountRate = 0) {
  let subtotal = 0;
  for (const line of lines) {
    subtotal += line.unitPrice * line.quantity;
  }
  const discount = Math.round(subtotal * discountRate);
  return { subtotal, discount, total: subtotal - discount, currency: "JPY" };
}

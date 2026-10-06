// Fictional team: Ren keeps inventory changes explicit and sequential.
export function reserve(inventory, lines) {
  const remaining = inventory.remaining;
  const required = new Map();
  for (const line of lines) {
    required.set(line.sku, (required.get(line.sku) ?? 0) + line.quantity);
  }
  for (const [sku, quantity] of required) {
    if ((remaining.get(sku) ?? 0) < quantity) {
      return false;
    }
  }
  for (const [sku, quantity] of required) {
    remaining.set(sku, remaining.get(sku) - quantity);
  }
  return true;
}

export function createInventory(initialStock) {
  return { remaining: new Map(Object.entries(initialStock)), nextHoldId: 1 };
}

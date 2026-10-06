// Fictional team: Ren adds a reservation reference to the API contract.
export function reserve(inventory, lines) {
  const remaining = inventory.remaining;
  const required = new Map();
  for (const line of lines) {
    required.set(line.sku, (required.get(line.sku) ?? 0) + line.quantity);
  }
  for (const [sku, quantity] of required) {
    if ((remaining.get(sku) ?? 0) < quantity) {
      return { ok: false, holdId: null };
    }
  }
  for (const [sku, quantity] of required) {
    remaining.set(sku, remaining.get(sku) - quantity);
  }
  return { ok: true, holdId: `hold-${inventory.nextHoldId++}` };
}

export function createInventory(initialStock) {
  return { remaining: new Map(Object.entries(initialStock)), nextHoldId: 1 };
}

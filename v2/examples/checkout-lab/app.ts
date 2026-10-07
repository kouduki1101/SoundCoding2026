import { previewCart } from '@checkout/preview';
import type { Campaign, CartLine } from '@checkout/contracts';

type Catalog = { products: CartLine[]; campaigns: Campaign[]; deliveryCents: number };
const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const find = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const quantities = new Map<string, number>([['field-notes', 1]]);
let requestId = crypto.randomUUID();
let catalog: Catalog;
let busy = false;

async function api<T>(path: string, value?: unknown): Promise<T> {
  const response = await fetch(
    path,
    value
      ? {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(value),
        }
      : undefined,
  );
  const result = await response.json();
  if (!response.ok) throw new Error(result.error);
  return result;
}
function lines() {
  return catalog.products
    .filter((p) => quantities.get(p.sku))
    .map((p) => ({ ...p, quantity: quantities.get(p.sku)! }));
}
function render() {
  const campaign = catalog.campaigns.find((c) => c.code === find<HTMLSelectElement>('coupon').value) ?? null;
  const preview = previewCart(lines(), campaign, Date.now());
  const subtotal = lines().reduce((sum, line) => sum + line.unitPriceCents * line.quantity, 0);
  find('subtotal').textContent = money(subtotal);
  find('discount').textContent = `−${money(preview.savingCents)}`;
  find('total').textContent = money(preview.totalCents + catalog.deliveryCents);
  find('coupon-state').textContent =
    {
      applied: '20% OFF · 上限 $8。ギフトカードは対象外。',
      none: 'クーポンなし',
      expired: '期限切れのため適用なし',
      'below-minimum': '通常商品の合計 $30 から適用',
    }[preview.couponState] ?? 'クーポンなし';
  find<HTMLButtonElement>('checkout').disabled = busy || !lines().length;
  for (const product of catalog.products)
    find<HTMLSelectElement>(product.sku).value = String(quantities.get(product.sku) ?? 0);
}
function cartChanged() {
  requestId = crypto.randomUUID();
  find('message').textContent = '';
  render();
}
async function history() {
  const orders =
    await api<{ orderId: string; itemCount: number; amountCents: number; lines: string[] }[]>('/api/orders');
  const list = find('orders');
  list.replaceChildren();
  for (const order of orders.slice(-5).reverse()) {
    const entry = document.createElement('li');
    const title = document.createElement('strong');
    title.textContent = `${order.itemCount} 点 · ${money(order.amountCents)}`;
    const detail = document.createElement('span');
    detail.textContent = `${order.lines[1]} · ${order.orderId.slice(0, 8)}`;
    entry.append(title, detail);
    list.append(entry);
  }
  find('no-orders').hidden = orders.length > 0;
}
find<HTMLFormElement>('cart').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (busy || !lines().length) return;
  busy = true;
  render();
  find('message').textContent = 'サーバーで価格を確認しています…';
  try {
    const order = await api<{ orderId: string; totalCents: number; message: string }>('/api/orders', {
      requestId,
      items: lines().map(({ sku, quantity }) => ({ sku, quantity })),
      member: find<HTMLInputElement>('member').checked,
      campaignCode: find<HTMLSelectElement>('coupon').value,
    });
    find('message').textContent = `注文を保存しました · ${money(order.totalCents)}\n${order.message}`;
    await history();
  } catch (error) {
    find('message').textContent =
      error instanceof TypeError
        ? '接続を確認してください。カートは保持しています。'
        : (error as Error).message;
  } finally {
    busy = false;
    render();
  }
});
find<HTMLFormElement>('cart').addEventListener('change', (event) => {
  const element = event.target as HTMLInputElement;
  if (quantities.has(element.id) || catalog.products.some((p) => p.sku === element.id))
    quantities.set(element.id, Number(element.value));
  cartChanged();
});
try {
  catalog = await api<Catalog>('/api/catalog');
  render();
  await history();
} catch {
  find('message').textContent = 'ローカルサーバーに接続できません。起動状態を確認してください。';
}

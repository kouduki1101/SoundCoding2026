import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Campaign, CartLine, OrderRecord, OrderStore } from '@checkout/contracts';
import { submitCheckout, checkoutReceipt } from '@checkout/checkout';

export const catalog: CartLine[] = [
  { sku: 'field-notes', label: 'Field Notes', unitPriceCents: 2400, quantity: 1, category: 'merchandise' },
  { sku: 'studio-print', label: 'Studio Print', unitPriceCents: 1800, quantity: 1, category: 'merchandise' },
  { sku: 'gift-card', label: 'Gift Card', unitPriceCents: 2000, quantity: 1, category: 'gift-card' },
];
const deliveryCents = 300;
type SavedOrder = { orderId: string; record: OrderRecord };
class RequestError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export class LocalOrderStore implements OrderStore {
  private orders: SavedOrder[] = [];
  private writing: Promise<unknown> = Promise.resolve();
  constructor(private file: string) {}
  async load() {
    try {
      this.orders = JSON.parse(await readFile(this.file, 'utf8'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  list() {
    return this.orders.map(({ record, orderId }) => checkoutReceipt(record, orderId));
  }
  saveOnce(record: OrderRecord): Promise<{ orderId: string }> {
    const save = this.writing.then(async () => {
      const previous = this.orders.find((order) => order.record.requestId === record.requestId);
      if (previous) {
        if (JSON.stringify(previous.record) !== JSON.stringify(record))
          throw new RequestError(409, '同じ注文IDの内容が変わっています。カートを確認してください。');
        return { orderId: previous.orderId };
      }
      if (this.orders.length >= 200) throw new RequestError(429, 'ローカルデモの注文上限です。');
      const next = { orderId: randomUUID(), record };
      const orders = [...this.orders, next];
      await mkdir(dirname(this.file), { recursive: true });
      await writeFile(`${this.file}.tmp`, JSON.stringify(orders, null, 2), { mode: 0o600 });
      await rename(`${this.file}.tmp`, this.file);
      this.orders = orders;
      return { orderId: next.orderId };
    });
    this.writing = save.catch(() => {});
    return save;
  }
}

export function campaigns(now: number): Campaign[] {
  return [
    { code: 'READ', rate: 0.2, minimumCents: 3000, capCents: 800, expiresAt: now + 3600_000 },
    { code: 'OLD', rate: 0.2, minimumCents: 3000, capCents: 800, expiresAt: now - 3600_000 },
  ];
}
async function body(request: IncomingMessage): Promise<Record<string, unknown>> {
  if (request.headers['content-type'] !== 'application/json')
    throw new RequestError(415, 'JSON形式で送信してください。');
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > 16_384) throw new RequestError(413, 'リクエストが大きすぎます。');
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString());
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch {
    throw new RequestError(400, 'リクエストを確認してください。');
  }
}
function checkoutInput(value: Record<string, unknown>, now: number, availableCampaigns: Campaign[]) {
  if (
    typeof value.requestId !== 'string' ||
    !/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/.test(value.requestId) ||
    !Array.isArray(value.items) ||
    value.items.length < 1 ||
    value.items.length > 3 ||
    typeof value.member !== 'boolean' ||
    !['', 'READ', 'OLD'].includes(value.campaignCode as string) ||
    Object.keys(value).some((key) => !['requestId', 'items', 'member', 'campaignCode'].includes(key))
  )
    throw new RequestError(400, 'カートの内容を確認してください。');
  const seen = new Set<string>();
  const lines = value.items.map((item: unknown) => {
    if (!item || typeof item !== 'object') throw new RequestError(400, '商品を確認してください。');
    const { sku, quantity } = item as { sku: unknown; quantity: unknown };
    const product = catalog.find((product) => product.sku === sku);
    if (
      !product ||
      seen.has(product.sku) ||
      !Number.isInteger(quantity) ||
      (quantity as number) < 1 ||
      (quantity as number) > 10 ||
      Object.keys(item).some((key) => !['sku', 'quantity'].includes(key))
    )
      throw new RequestError(400, '商品と数量を確認してください。');
    seen.add(product.sku);
    return { ...product, quantity: quantity as number };
  });
  return {
    requestId: value.requestId,
    lines,
    campaign: availableCampaigns.find((campaign) => campaign.code === value.campaignCode) ?? null,
    submittedAt: now,
    deliveryCents,
    memberId: value.member ? 'demo-member' : null,
  };
}
function json(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(value));
}
export function checkoutServer(directory: string, core: string, store: LocalOrderStore) {
  const availableCampaigns = campaigns(Date.now());
  return createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    try {
      const address = response.socket?.address();
      const port = typeof address === 'object' && address && 'port' in address ? address.port : 4174;
      const origin = `http://127.0.0.1:${port}`;
      if (
        request.headers.host !== `127.0.0.1:${port}` ||
        (request.headers.origin && request.headers.origin !== origin)
      )
        throw new RequestError(403, 'ローカルの画面から操作してください。');
      if (request.method === 'GET' && request.url === '/api/catalog')
        return json(response, 200, { products: catalog, campaigns: availableCampaigns, deliveryCents });
      if (request.method === 'GET' && request.url === '/api/orders') return json(response, 200, store.list());
      if (request.method === 'POST' && request.url === '/api/orders') {
        const input = checkoutInput(await body(request), Date.now(), availableCampaigns);
        return json(response, 200, await submitCheckout(input, store));
      }
      const pages: Record<string, [string, string]> = {
        '/': [resolve(directory, 'index.html'), 'text/html; charset=utf-8'],
        '/app.mjs': [resolve(directory, 'dist/app.mjs'), 'text/javascript; charset=utf-8'],
        '/style.css': [resolve(directory, 'style.css'), 'text/css; charset=utf-8'],
      };
      for (const name of ['checkout', 'contracts', 'preview', 'pricing', 'rewards'])
        pages[`/source/${name}.ts`] = [resolve(core, `${name}.ts`), 'text/plain; charset=utf-8'];
      const file = request.method === 'GET' ? pages[request.url ?? ''] : undefined;
      if (!file) throw new RequestError(404, '見つかりません。');
      const contents = await readFile(file[0]);
      response.writeHead(200, { 'Content-Type': file[1] });
      response.end(contents);
    } catch (error) {
      json(response, error instanceof RequestError ? error.status : 500, {
        error: error instanceof RequestError ? error.message : '注文を保存できませんでした。',
      });
    }
  });
}
export async function startServer(directory: string, core: string) {
  const store = new LocalOrderStore(resolve(directory, '.local/orders.json'));
  await store.load();
  const server = checkoutServer(directory, core, store);
  server.listen(4174, '127.0.0.1', () => console.log('Checkout Lab: http://127.0.0.1:4174'));
}

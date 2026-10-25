/**
 * Programmable fake of the ArioBox reseller API for `deps.fetch` (SUPPLIER_PLAN.md §4.4).
 * Never talks to the network. Every call is logged with its key, so tests can check where the key went.
 */
export interface FakeCall { method: string; url: string; key: string | null; body: any }

export type PostResponse = { status: number; body?: any } | 'timeout' | 'network';

export interface FakeAriobox {
  fetch: typeof fetch;
  calls: FakeCall[];
  state: {
    usdToman: number;
    items: any[];
    /** HTTP status for GET /products; 'timeout' / 'network' fail the request */
    catalogStatus: number | 'timeout' | 'network';
    /** answers for the next POSTs, in order; empty = a successful order */
    postQueue: PostResponse[];
    /** GET /orders/{id} answers */
    orders: Record<string, any>;
    /** when set, any other key gets 401 (like the real API) */
    validKey: string | null;
  };
  item(productId: string, variationId: string, name: string, price: number | null, attributes?: Record<string, string>): any;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export function makeFakeAriobox(): FakeAriobox {
  const calls: FakeCall[] = [];
  const state: FakeAriobox['state'] = {
    usdToman: 150000, items: [], catalogStatus: 200, postQueue: [], orders: {}, validKey: null,
  };

  const failure = (kind: 'timeout' | 'network'): Error => {
    if (kind === 'timeout') {
      const err = new Error('The operation was aborted due to timeout');
      err.name = 'TimeoutError';
      return err;
    }
    return new TypeError('fetch failed');
  };

  const fetchFn = async (input: any, init: any = {}) => {
    const url = String(input);
    const key: string | null = init.headers?.['X-Api-Key'] ?? null;
    const method: string = init.method ?? 'GET';
    calls.push({ method, url, key, body: init.body ? JSON.parse(init.body) : undefined });
    if (state.validKey !== null && key !== state.validKey) return json(401, { detail: 'invalid api key' });

    if (method === 'GET' && url.endsWith('/api/v1/reseller/products')) {
      const catalogStatus = state.catalogStatus;
      if (typeof catalogStatus === 'string') throw failure(catalogStatus);
      if (catalogStatus !== 200) return json(catalogStatus, { detail: 'temporarily unavailable' });
      return json(200, { ok: true, usd_toman: state.usdToman, currency: 'USD', updated_at: '2026-10-25T10:00:00Z', items: state.items });
    }
    if (method === 'POST' && url.endsWith('/api/v1/reseller/orders')) {
      const next = state.postQueue.shift() ?? { status: 200, body: { ok: true, order_id: 5001, status: 'pending', price: 5.28 } };
      if (typeof next === 'string') throw failure(next);
      return json(next.status, next.body ?? {});
    }
    const orderMatch = url.match(/\/api\/v1\/reseller\/orders\/([^/?]+)$/);
    if (method === 'GET' && orderMatch) {
      const o = state.orders[decodeURIComponent(orderMatch[1])];
      return o ? json(200, o) : json(404, { detail: 'order not found' });
    }
    return json(404, { detail: 'not found' });
  };

  return {
    fetch: fetchFn as unknown as typeof fetch,
    calls,
    state,
    item(productId, variationId, name, price, attributes = {}) {
      return { name, product_id: productId, sku: productId + '-sku', variation_id: variationId, price, attributes };
    },
  };
}

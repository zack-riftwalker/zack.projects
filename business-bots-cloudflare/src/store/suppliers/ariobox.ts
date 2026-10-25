import type { Apps } from '../../apps';
import type { Catalog, CatalogItem, FetchResult, PlaceResult, StatusResult, SupplierAdapter, SupplierRow } from './types';

const TIMEOUT_MS = 10_000;
/** Ids go into callback data and must stay short and safe (SUPPLIER_PLAN.md §4.3). */
const ID_RE = /^[A-Za-z0-9_-]{1,24}$/;
const DETAIL_MAX = 300;
const RAW_MAX = 4000;

type Net = { net: true; detail: string } | { net: false; status: number; text: string; json: any };

const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s);

const bodyDetail = (json: any, text: string): string => {
  const d = json && typeof json === 'object' ? (json.detail ?? json.message ?? json.error) : undefined;
  return cut(typeof d === 'string' && d ? d : text || 'HTTP error', DETAIL_MAX);
};

function parseJson(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** One counted Telegram-free call: budget first, then fetch with the key in the header only. */
async function call(apps: Apps, s: SupplierRow, method: 'GET' | 'POST', path: string, body?: unknown): Promise<Net> {
  apps.budget.take();
  try {
    const res = await apps.fetch(s.base_url + path, {
      method,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        'X-Api-Key': s.api_key,
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    return { net: false, status: res.status, text, json: parseJson(text) };
  } catch (err: any) {
    const timeout = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    return { net: true, detail: timeout ? 'timeout' : 'network error' };
  }
}

const isSafeId = (v: unknown): v is string => typeof v === 'string' && ID_RE.test(v);
const price = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);

function attributesOf(v: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    for (const [k, val] of Object.entries(v)) if (typeof val === 'string') out[k] = val;
  }
  return out;
}

export function makeAriobox(apps: Apps): SupplierAdapter {
  return {
    async fetchCatalog(s): Promise<FetchResult<Catalog>> {
      const r = await call(apps, s, 'GET', '/api/v1/reseller/products');
      if (r.net) return { ok: false, kind: 'temporary', http: null, detail: r.detail };
      if (r.status === 401 || r.status === 403) return { ok: false, kind: 'auth', http: r.status, detail: bodyDetail(r.json, r.text) };
      if (r.status >= 500) return { ok: false, kind: 'temporary', http: r.status, detail: bodyDetail(r.json, r.text) };
      if (r.status < 200 || r.status >= 300) return { ok: false, kind: 'bad_response', http: r.status, detail: bodyDetail(r.json, r.text) };

      const usd = r.json?.usd_toman;
      if (typeof usd !== 'number' || !Number.isFinite(usd) || usd <= 0) {
        return { ok: false, kind: 'bad_response', http: r.status, detail: 'usd_toman missing' };
      }
      if (!Array.isArray(r.json?.items)) return { ok: false, kind: 'bad_response', http: r.status, detail: 'items missing' };

      const items: CatalogItem[] = [];
      for (const it of r.json.items) {
        const variation = it?.variation_id ?? '';
        if (!isSafeId(it?.product_id) || (variation !== '' && !isSafeId(variation))) continue;
        items.push({
          remoteProductId: it.product_id,
          remoteVariationId: variation,
          name: typeof it.name === 'string' ? it.name : '',
          sku: typeof it.sku === 'string' ? it.sku : '',
          priceUsd: price(it.price),
          attributes: attributesOf(it.attributes),
        });
      }
      return {
        ok: true,
        value: { usdToman: usd, items, updatedAt: typeof r.json.updated_at === 'string' ? r.json.updated_at : null },
      };
    },

    async placeOrder(s, p): Promise<PlaceResult> {
      const body: Record<string, unknown> = {
        product_id: p.remoteProductId,
        quantity: p.quantity,
        user_id: s.remote_user_id,
        note: p.note,
      };
      if (p.remoteVariationId !== '') body.variation_id = p.remoteVariationId;

      const r = await call(apps, s, 'POST', '/api/v1/reseller/orders', body);
      if (r.net) return { kind: 'unknown', http: null, detail: r.detail };
      const { status } = r;
      const detail = bodyDetail(r.json, r.text);

      if (status >= 200 && status < 300) {
        const id = r.json?.order_id;
        if (typeof id === 'number' && Number.isInteger(id) && id > 0) {
          return {
            kind: 'placed',
            remoteOrderId: String(id),
            remoteStatus: typeof r.json.status === 'string' ? r.json.status : 'pending',
            priceUsd: price(r.json.price),
            raw: cut(r.text, RAW_MAX),
          };
        }
        return { kind: 'unknown', http: status, detail: 'no order_id in the answer' };
      }
      if (status === 409) return { kind: 'out_of_stock', http: status, detail };
      if (status === 503) return { kind: 'retry_later', http: status, detail };
      if (status === 401) return { kind: 'config', http: status, detail };
      if (status === 404 && /user/i.test(detail)) return { kind: 'config', http: status, detail };
      if (status >= 400 && status < 500) return { kind: 'rejected', http: status, detail };
      return { kind: 'unknown', http: status, detail };
    },

    async getOrder(s, remoteOrderId): Promise<StatusResult> {
      const r = await call(apps, s, 'GET', '/api/v1/reseller/orders/' + encodeURIComponent(remoteOrderId));
      if (r.net) return { kind: 'error', http: null, detail: r.detail };
      if (r.status < 200 || r.status >= 300) return { kind: 'error', http: r.status, detail: bodyDetail(r.json, r.text) };
      const accounts = Array.isArray(r.json?.accounts) ? r.json.accounts : [];
      return {
        kind: 'ok',
        remoteStatus: typeof r.json?.status === 'string' ? r.json.status : '',
        accounts: accounts.map((a: any) => ({
          fields: (Array.isArray(a?.attributes) ? a.attributes : [])
            .filter((f: any) => f && typeof f.key === 'string')
            .map((f: any) => ({ key: f.key, value: String(f.value ?? '') })),
        })),
        message: typeof r.json?.message === 'string' ? r.json.message : null,
        raw: cut(r.text, RAW_MAX),
      };
    },
  };
}

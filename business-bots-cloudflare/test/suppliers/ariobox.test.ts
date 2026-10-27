import { describe, expect, it } from 'vitest';
import { makeTestEnv } from '../helpers/env';
import { makeFakeAriobox } from '../helpers/fakeAriobox';
import { classifyRemoteStatus, makeAriobox } from '../../src/store/suppliers/ariobox';
import type { SupplierRow } from '../../src/store/suppliers/types';

const KEY = 'SECRET-KEY-1234';
const supplier = (over: Partial<SupplierRow> = {}): SupplierRow => ({
  id: 1, kind: 'ariobox', name: 'AB', base_url: 'https://ariobox.test', api_key: KEY, remote_user_id: 42,
  is_enabled: 1, last_sync_at: null, last_sync_ok_at: null, last_sync_error: null, sync_alert_sent: 0, created_at: '',
  ...over,
});

function setup() {
  const fake = makeFakeAriobox();
  const t = makeTestEnv({ fetch: fake.fetch });
  return { fake, adapter: makeAriobox(t.apps()), s: supplier() };
}

describe('ArioBox fetchCatalog (§4.3)', () => {
  it('maps the catalog and skips items with unsafe ids', async () => {
    const { fake, adapter, s } = setup();
    fake.state.items = [
      fake.item('1300', '', 'ChatGPT Plus', 5.28, { 'subscription-duration': '1-month' }),
      fake.item('1301', '9', 'Variant', null, { warranty: '7-days', region: 'EU', count: 3 as any }),
      fake.item('bad id!', '', 'bad product', 1),
      fake.item('1302', 'x/y', 'bad variation', 1),
      fake.item('1303', '', 'zero price', 0),
    ];
    const r = await adapter.fetchCatalog(s);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.usdToman).toBe(150000);
    expect(r.value.items.map((i) => [i.remoteProductId, i.remoteVariationId, i.priceUsd])).toEqual([
      ['1300', '', 5.28], ['1301', '9', null], ['1303', '', null],
    ]);
    expect(r.value.items[1].attributes).toEqual({ warranty: '7-days', region: 'EU' });
  });

  it('401 and 403 → auth; 5xx and network/timeout → temporary; other errors and bad bodies → bad_response', async () => {
    const { fake, adapter, s } = setup();
    fake.state.catalogStatus = 401;
    expect(await adapter.fetchCatalog(s)).toMatchObject({ ok: false, kind: 'auth', http: 401 });
    fake.state.catalogStatus = 403;
    expect(await adapter.fetchCatalog(s)).toMatchObject({ ok: false, kind: 'auth', http: 403 });
    fake.state.catalogStatus = 503;
    expect(await adapter.fetchCatalog(s)).toMatchObject({ ok: false, kind: 'temporary', http: 503 });
    fake.state.catalogStatus = 'timeout';
    expect(await adapter.fetchCatalog(s)).toMatchObject({ ok: false, kind: 'temporary', http: null, detail: 'timeout' });
    fake.state.catalogStatus = 'network';
    expect(await adapter.fetchCatalog(s)).toMatchObject({ ok: false, kind: 'temporary', http: null, detail: 'network error' });
    fake.state.catalogStatus = 404;
    expect(await adapter.fetchCatalog(s)).toMatchObject({ ok: false, kind: 'bad_response', http: 404 });
  });

  it('a body without a positive usd_toman or without items is bad_response', async () => {
    const { fake, adapter, s } = setup();
    fake.state.usdToman = 0;
    expect(await adapter.fetchCatalog(s)).toMatchObject({ ok: false, kind: 'bad_response' });
    fake.state.usdToman = 150000;
    fake.state.items = 'nope' as any;
    expect(await adapter.fetchCatalog(s)).toMatchObject({ ok: false, kind: 'bad_response' });
  });
});

describe('ArioBox placeOrder (§4.3 mapping, never retried)', () => {
  const p = { remoteProductId: '1300', remoteVariationId: '', quantity: 1, note: 'store#7/so#3' };

  it('2xx with a numeric order_id → placed', async () => {
    const { fake, adapter, s } = setup();
    expect(await adapter.placeOrder(s, p)).toEqual({
      kind: 'placed', remoteOrderId: '5001', remoteStatus: 'pending', priceUsd: 5.28,
      raw: JSON.stringify({ ok: true, order_id: 5001, status: 'pending', price: 5.28 }),
    });
    expect(fake.calls.at(-1)!.body).toEqual({ product_id: '1300', quantity: 1, user_id: 42, note: 'store#7/so#3' });
  });

  it('2xx without an order_id → unknown', async () => {
    const { fake, adapter, s } = setup();
    fake.state.postQueue.push({ status: 200, body: { ok: true } });
    expect(await adapter.placeOrder(s, p)).toMatchObject({ kind: 'unknown', http: 200 });
  });

  it('409 → out_of_stock; 503 → retry_later', async () => {
    const { fake, adapter, s } = setup();
    fake.state.postQueue.push({ status: 409, body: { detail: 'out of stock' } }, { status: 503, body: { detail: 'busy' } });
    expect(await adapter.placeOrder(s, p)).toEqual({ kind: 'out_of_stock', http: 409, detail: 'out of stock' });
    expect(await adapter.placeOrder(s, p)).toEqual({ kind: 'retry_later', http: 503, detail: 'busy' });
  });

  it('401 → config; 404 about the user → config; other 404 → rejected', async () => {
    const { fake, adapter, s } = setup();
    fake.state.postQueue.push({ status: 401, body: { detail: 'invalid api key' } }, { status: 404, body: { detail: 'WooCommerce user not found' } }, { status: 404, body: { detail: 'product not found' } });
    expect(await adapter.placeOrder(s, p)).toMatchObject({ kind: 'config', http: 401 });
    expect(await adapter.placeOrder(s, p)).toMatchObject({ kind: 'config', http: 404 });
    expect(await adapter.placeOrder(s, p)).toMatchObject({ kind: 'rejected', http: 404 });
  });

  it('400 → rejected; any other 4xx (not 401/404/409) → retry_later, nothing was bought (Appendix A (a))', async () => {
    const { fake, adapter, s } = setup();
    fake.state.postQueue.push({ status: 400, body: { detail: 'invalid body' } }, { status: 422, body: { detail: 'nope' } }, { status: 403, body: { detail: 'x' } });
    expect(await adapter.placeOrder(s, p)).toMatchObject({ kind: 'rejected', http: 400 });
    expect(await adapter.placeOrder(s, p)).toEqual({ kind: 'retry_later', http: 422, detail: 'nope' });
    expect(await adapter.placeOrder(s, p)).toMatchObject({ kind: 'retry_later', http: 403 });
  });

  it('a refusal that mentions the wallet is flagged lowBalance (case-insensitive); 400 keeps its meaning', async () => {
    const { fake, adapter, s } = setup();
    fake.state.postQueue.push(
      { status: 402, body: { detail: 'Insufficient BALANCE' } }, { status: 503, body: { detail: 'wallet is empty' } },
      { status: 422, body: { detail: 'not enough credit' } }, { status: 400, body: { detail: 'insufficient funds' } },
    );
    expect(await adapter.placeOrder(s, p)).toEqual({ kind: 'retry_later', http: 402, detail: 'Insufficient BALANCE', lowBalance: true });
    expect(await adapter.placeOrder(s, p)).toMatchObject({ kind: 'retry_later', http: 503, lowBalance: true });
    expect(await adapter.placeOrder(s, p)).toMatchObject({ kind: 'retry_later', lowBalance: true });
    expect(await adapter.placeOrder(s, p)).toMatchObject({ kind: 'rejected', http: 400 });
  });

  it('remote status mapping (Appendix A (c)): completed = success; cancelled/failed/refunded/trash = failure; the rest keeps polling', () => {
    for (const s of ['completed', 'Completed ']) expect(classifyRemoteStatus(s)).toBe('success');
    for (const s of ['cancelled', 'failed', 'refunded', 'trash', 'FAILED']) expect(classifyRemoteStatus(s)).toBe('failure');
    for (const s of ['pending', 'processing', 'on-hold', '']) expect(classifyRemoteStatus(s)).toBe('pending');
  });

  it('5xx other than 503, timeout and network error → unknown; each one is a single POST', async () => {
    const { fake, adapter, s } = setup();
    fake.state.postQueue.push({ status: 500, body: { detail: 'boom' } }, 'timeout', 'network');
    expect(await adapter.placeOrder(s, p)).toMatchObject({ kind: 'unknown', http: 500 });
    expect(await adapter.placeOrder(s, p)).toEqual({ kind: 'unknown', http: null, detail: 'timeout' });
    expect(await adapter.placeOrder(s, p)).toEqual({ kind: 'unknown', http: null, detail: 'network error' });
    expect(fake.calls.filter((c) => c.method === 'POST')).toHaveLength(3);
  });

  it('variation_id is sent only when the item has one', async () => {
    const { fake, adapter, s } = setup();
    await adapter.placeOrder(s, { ...p, remoteVariationId: '9' });
    expect(fake.calls.at(-1)!.body.variation_id).toBe('9');
  });
});

describe('ArioBox getOrder', () => {
  it('maps accounts and attributes; a missing order is an error', async () => {
    const { fake, adapter, s } = setup();
    fake.state.orders['5001'] = {
      ok: true, order_id: 5001, status: 'completed', price: '5.28',
      accounts: [{ attributes: [{ key: 'activation_link', value: 'https://x.test/a' }, { key: 'code', value: '123' }] }],
    };
    const r = await adapter.getOrder(s, '5001');
    expect(r).toMatchObject({ kind: 'ok', remoteStatus: 'completed', message: null, accounts: [{ fields: [
      { key: 'activation_link', value: 'https://x.test/a' }, { key: 'code', value: '123' },
    ] }] });
    expect(await adapter.getOrder(s, '777')).toEqual({ kind: 'error', http: 404, detail: 'order not found' });
  });
});

describe('the API key', () => {
  it('goes only in the X-Api-Key header, never in a URL or a body', async () => {
    const { fake, adapter, s } = setup();
    fake.state.validKey = KEY;
    fake.state.items = [fake.item('1300', '', 'A', 1)];
    await adapter.fetchCatalog(s);
    await adapter.placeOrder(s, { remoteProductId: '1300', remoteVariationId: '', quantity: 1, note: 'n' });
    await adapter.getOrder(s, '5001');
    expect(fake.calls).toHaveLength(3);
    for (const c of fake.calls) {
      expect(c.url).not.toContain(KEY);
      expect(c.url).not.toMatch(/apikey|api_key/i);
      expect(c.key).toBe(KEY);
      expect(JSON.stringify(c.body ?? {})).not.toContain(KEY);
    }
  });
});

import { describe, expect, it } from 'vitest';
import { makeTestEnv, type TestEnv } from '../helpers/env';
import { one, q } from '../helpers/seed';
import { escapeHtml } from '../../src/store/utils';
import { tehranDateTime } from '../../src/lib/time';
import { customerContactRow, customerRefHtml, sendToAdmins } from '../../src/store/customerRef';
import { eventStatement, logEvent, EVENT_DETAIL_MAX } from '../../src/store/events';
import { parseSupplierDefaults, setSupplierDefaults, getSupplierDefaults } from '../../src/store/supplierDefaults';
import type { StoreApp } from '../../src/apps';

const store = (t: TestEnv): StoreApp => t.apps().store!;
const PRIVACY = 'Bad Request: BUTTON_USER_PRIVACY_RESTRICTED';

describe('escapeHtml', () => {
  it('escapes &, <, > and quotes and leaves Persian text alone', () => {
    expect(escapeHtml('a & <b> "c" ۱۲ علی')).toBe('a &amp; &lt;b&gt; &quot;c&quot; ۱۲ علی');
    expect(escapeHtml(42)).toBe('42');
  });
});

describe('tehranDateTime', () => {
  it('matches SQLite datetime(..., "+03:30") for the same instant, including the day roll-over', () => {
    const t = makeTestEnv();
    for (const iso of ['2026-01-01T00:00:00Z', '2026-03-20T20:29:59.999Z', '2026-10-25T12:34:56Z']) {
      const sqlite = one(t.storeDb, "SELECT datetime(?, '+03:30') AS d", iso).d;
      expect(tehranDateTime(new Date(iso))).toBe(sqlite);
    }
  });
});

describe('customer reference and contact row', () => {
  it('shows name and @username escaped, and the numeric id in <code>', () => {
    expect(customerRefHtml({ id: 7, name: 'Ali <3', username: 'ali_1' })).toBe(
      '👤 مشتری: <a href="tg://user?id=7">Ali &lt;3</a> (@ali_1)\n🆔 آیدی عددی: <code>7</code>',
    );
    expect(customerRefHtml({ id: 7, name: 'Ali', username: null })).not.toContain('(@');
  });

  it('chat button links to the username, or to tg://user without one', () => {
    expect(customerContactRow(7, 'ali_1', 9)).toEqual([
      { text: '💬 چت با مشتری', url: 'https://t.me/ali_1' },
      { text: '✉️ پیام از طرف ربات', callback_data: 'fo_msg_9' },
    ]);
    expect(customerContactRow(7, null, 9)[0]).toEqual({ text: '💬 چت با مشتری', url: 'tg://user?id=7' });
    expect(customerContactRow(7, 'bad name', 9)[0]).toEqual({ text: '💬 چت با مشتری', url: 'tg://user?id=7' });
  });
});

describe('sendToAdmins', () => {
  it('sends HTML to every admin and returns how many were reached', async () => {
    const t = makeTestEnv();
    const n = await sendToAdmins(store(t), '<b>hi</b>', [customerContactRow(7, 'ali', 9)]);
    expect(n).toBe(2);
    const sent = t.tg.of('sendMessage');
    expect(sent.map((c) => c.payload.chat_id)).toEqual([1001, 1002]);
    expect(sent.every((c) => c.payload.parse_mode === 'HTML')).toBe(true);
  });

  it('on BUTTON_USER_PRIVACY_RESTRICTED resends once without the 💬 button', async () => {
    const t = makeTestEnv();
    t.tg.fail('sendMessage', (c) => c.payload.chat_id === 1001 && JSON.stringify(c.payload.reply_markup).includes('💬'), 400, PRIVACY, 1);
    const n = await sendToAdmins(store(t), 'hi', [customerContactRow(7, null, 9)]);
    expect(n).toBe(2);
    const toFirst = t.tg.of('sendMessage', 1001);
    expect(toFirst).toHaveLength(2);
    expect(JSON.stringify(toFirst[0].payload.reply_markup)).toContain('💬');
    expect(JSON.stringify(toFirst[1].payload.reply_markup)).not.toContain('💬');
    expect(JSON.stringify(toFirst[1].payload.reply_markup)).toContain('fo_msg_9');
    expect(t.tg.of('sendMessage', 1002)).toHaveLength(1);
  });

  it('other errors are not retried and are not counted', async () => {
    const t = makeTestEnv();
    t.tg.fail('sendMessage', (c) => c.payload.chat_id === 1001, 403, 'Forbidden: bot was blocked by the user', -1);
    expect(await sendToAdmins(store(t), 'hi', [])).toBe(1);
    expect(t.tg.of('sendMessage', 1001)).toHaveLength(1);
  });
});

describe('fulfillment events', () => {
  it('writes one row per statement with actor, time and a detail capped at 500 characters', async () => {
    const t = makeTestEnv();
    const app = store(t);
    await logEvent(app, { orderId: 3, kind: 'queued', actor: 1001, detail: { a: 1 } });
    await logEvent(app, { supplierOrderId: 4, kind: 'poll', detail: 'x'.repeat(900) });
    const rows = q(t.storeDb, 'SELECT order_id, supplier_order_id, kind, actor, detail, created_at FROM fulfillment_events ORDER BY id');
    expect(rows[0]).toMatchObject({ order_id: 3, supplier_order_id: null, kind: 'queued', actor: 1001, detail: '{"a":1}' });
    expect(rows[1]).toMatchObject({ order_id: null, supplier_order_id: 4, kind: 'poll', actor: 0 });
    expect(rows[1].detail).toHaveLength(EVENT_DETAIL_MAX);
    expect(rows[0].created_at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it('can be batched with another change as a statement', async () => {
    const t = makeTestEnv();
    const app = store(t);
    await app.raw.batch([app.raw.prepare("INSERT INTO app_state (key, value) VALUES ('k', '1')"), eventStatement(app, { kind: 'claim' })]);
    expect(q(t.storeDb, 'SELECT kind FROM fulfillment_events').map((r) => r.kind)).toEqual(['claim']);
  });
});

describe('supplier defaults (store_kv)', () => {
  it('missing or corrupt JSON reads as not set', () => {
    expect(parseSupplierDefaults(null)).toEqual({ markupPercent: null, markupFixed: null });
    expect(parseSupplierDefaults('{not json')).toEqual({ markupPercent: null, markupFixed: null });
  });

  it('keeps only valid fields: percent 0..500, fixed integer 0..100000000', () => {
    expect(parseSupplierDefaults('{"markupPercent":15,"markupFixed":0}')).toEqual({ markupPercent: 15, markupFixed: 0 });
    expect(parseSupplierDefaults('{"markupPercent":501,"markupFixed":10.5}')).toEqual({ markupPercent: null, markupFixed: null });
    expect(parseSupplierDefaults('{"markupPercent":-1,"markupFixed":100000001}')).toEqual({ markupPercent: null, markupFixed: null });
    expect(parseSupplierDefaults('{"markupPercent":"15","markupFixed":null}')).toEqual({ markupPercent: null, markupFixed: null });
  });

  it('round-trips through store_kv and refuses an out-of-range value', async () => {
    const t = makeTestEnv();
    const app = store(t);
    await setSupplierDefaults(app, { markupPercent: 15, markupFixed: 5000 });
    expect(await getSupplierDefaults(store(t))).toEqual({ markupPercent: 15, markupFixed: 5000 });
    await expect(setSupplierDefaults(app, { markupPercent: 600, markupFixed: null })).rejects.toThrow();
    expect(one(t.storeDb, "SELECT value FROM store_kv WHERE key = 'supplier_defaults'").value).toBe('{"markupPercent":15,"markupFixed":5000}');
  });
});

describe('customer username', () => {
  it('stores it without "@", refreshes it when given, clears on null, and leaves it alone when not given', async () => {
    const t = makeTestEnv();
    const db = store(t).db;
    const first = await db.upsertCustomer({ telegramId: 7, displayName: 'Ali', username: '@ali' });
    expect(first.changes).toBe(1);
    expect(one(t.storeDb, 'SELECT username FROM customers WHERE telegram_id = 7').username).toBe('ali');

    const again = await db.upsertCustomer({ telegramId: 7, displayName: 'Ali X', username: 'ali2' });
    expect(again.changes).toBe(0);
    expect(one(t.storeDb, 'SELECT username, display_name FROM customers WHERE telegram_id = 7')).toEqual({ username: 'ali2', display_name: 'Ali' });

    await db.upsertCustomer({ telegramId: 7, displayName: 'Ali' });
    expect(one(t.storeDb, 'SELECT username FROM customers WHERE telegram_id = 7').username).toBe('ali2');

    await db.upsertCustomer({ telegramId: 7, displayName: 'Ali', username: null });
    expect(one(t.storeDb, 'SELECT username FROM customers WHERE telegram_id = 7').username).toBeNull();
  });

  it('orders snapshot it: createOrder, reward orders and manual claims', async () => {
    const t = makeTestEnv();
    const app = store(t);
    await app.db.upsertCustomer({ telegramId: 7, displayName: 'Ali', username: 'ali' });
    const pid = Number(t.storeDb.sqlite.prepare("INSERT INTO customer_products (name, price, duration_days, warranty_days) VALUES ('GPT', 1000, 30, 7)").run().lastInsertRowid);
    const product = (await app.db.getCustomerProductById(pid))!;

    await app.db.createOrder({ customerTelegramId: 7, customerProductId: pid, productName: 'GPT', price: 1000, receiptFileId: 'f', receiptType: 'photo', customerUsername: 'ali' });
    await app.db.createRewardOrder({ customerTelegramId: 7, product });
    await app.db.createManualPurchaseClaim({ creationKey: 'k1', tokenHash: 'h1', customerProductId: pid, approvedBy: 1001 });
    await app.db.redeemManualPurchaseClaim({ tokenHash: 'h1', customerTelegramId: 7, displayName: 'Ali' });

    expect(q(t.storeDb, 'SELECT customer_username FROM orders ORDER BY id').map((r) => r.customer_username)).toEqual(['ali', 'ali', 'ali']);
  });
});

describe('stalled-order alert skips supplier orders', () => {
  it('a confirmed supplier order is not a stalled order (it has its own 20 h handling)', async () => {
    const t = makeTestEnv();
    const app = store(t);
    const old = '2026-01-01 00:00:00';
    t.storeDb.sqlite.exec(`INSERT INTO customer_products (id, name, price) VALUES (1, 'P', 1);
      INSERT INTO orders (id, customer_telegram_id, customer_product_id, product_name, price, status, decided_at, fulfillment)
      VALUES (1, 7, 1, 'P', 1, 'confirmed', '${old}', NULL), (2, 7, 1, 'P', 1, 'confirmed', '${old}', 'supplier');`);
    const ids = (await app.db.getStalledConfirmedOrders(20)).map((o) => o.id);
    expect(ids).toEqual([1]);
  });
});

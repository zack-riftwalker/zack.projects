import { describe, expect, it } from 'vitest';
import { ADMIN, makeTestEnv, type TestEnv } from '../helpers/env';
import { callbackUpdate, textUpdate } from '../helpers/updates';
import { one, q, seedProduct } from '../helpers/seed';

const CUST = { id: 7001, first_name: 'C' };
const fa = (n: number) => n.toLocaleString('fa-IR');
// Tehran = UTC+3:30
const tehran = (d: number, h: number, m = 0) => new Date(Date.UTC(2026, 10, d, h - 4 + 0, m + 30)); // h:m Tehran on 2026-11-d (valid for h >= 4)
const START = '2026-11-26 20:00:00';
const END = '2026-11-27 23:59:00';
const T_BEFORE = tehran(26, 19, 59);
const T_START = tehran(26, 20, 0);
const T_MID = tehran(27, 10, 0);
const T_END = tehran(27, 23, 59);

function setup(opts: { price?: number; mode?: string; active?: number } = {}) {
  const t = makeTestEnv({ monshi: false });
  seedProduct(t, { name: 'GPT <Plus>', price: opts.price ?? 1000000, active: opts.active ?? 1 });
  if (opts.mode) q(t.storeDb, 'UPDATE customer_products SET pricing_mode = ? WHERE id = 1', opts.mode);
  return t;
}
const sched = (t: TestEnv, sale = 800000, starts = START, ends = END, status = 'pending') =>
  q(t.storeDb, 'INSERT INTO price_schedules (product_id, sale_price, starts_at, ends_at, status) VALUES (1, ?, ?, ?, ?)', sale, starts, ends, status);
const prod = (t: TestEnv) => one(t.storeDb, 'SELECT price, compare_at_price FROM customer_products WHERE id = 1');
const row = (t: TestEnv) => one(t.storeDb, 'SELECT status, normal_price, note FROM price_schedules WHERE id = 1');
const tick = (t: TestEnv, now: Date) => { t.deps.now = () => now; return t.cron(now); };
const adminMsgs = (t: TestEnv) => t.tg.of('sendMessage').filter((c) => c.payload.chat_id === ADMIN.id).map((c) => String(c.payload.text));

describe('price schedules: cron', () => {
  it('before the start nothing changes (and no message)', async () => {
    const t = setup();
    sched(t);
    await tick(t, T_BEFORE);
    expect(prod(t)).toEqual({ price: 1000000, compare_at_price: null });
    expect(row(t).status).toBe('pending');
    expect(t.tg.of('sendMessage')).toHaveLength(0);
  });

  it('start: sale price, struck normal price, active, admins told; second tick is a no-op', async () => {
    const t = setup();
    sched(t);
    await tick(t, T_START);
    expect(prod(t)).toEqual({ price: 800000, compare_at_price: 1000000 });
    expect(row(t)).toEqual({ status: 'active', normal_price: 1000000, note: null });
    const msgs = adminMsgs(t);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toContain('🔥 قیمت جشنواره‌ی «GPT &lt;Plus&gt;» فعال شد: ' + fa(800000) + ' تومان (قبلاً ' + fa(1000000) + ')');
    expect(t.tg.of('sendMessage').filter((c) => c.payload.chat_id === 1002)).toHaveLength(1);
    // the customer sees the struck normal price
    await t.send('store', textUpdate(CUST, '/start'));
    await t.send('store', callbackUpdate(CUST, 'cust_prod_1'));
    const sale = t.tg.texts(CUST.id).at(-1)!;
    expect(sale).toContain('💰 قیمت عادی: ' + fa(1000000) + ' تومان');
    expect(sale).toContain('🔥 قیمت ویژه: ' + fa(800000) + ' تومان');
    const sent = t.tg.of('sendMessage').length;
    await tick(t, tehran(26, 20, 1));
    expect(t.tg.of('sendMessage')).toHaveLength(sent);
    expect(prod(t)).toEqual({ price: 800000, compare_at_price: 1000000 });
  });

  it('end: price back, compare_at NULL, done; second tick is a no-op', async () => {
    const t = setup();
    sched(t);
    await tick(t, T_START);
    await tick(t, T_MID);
    expect(prod(t).price).toBe(800000);
    await tick(t, T_END);
    expect(prod(t)).toEqual({ price: 1000000, compare_at_price: null });
    expect(row(t).status).toBe('done');
    expect(adminMsgs(t).at(-1)).toContain('✅ جشنواره‌ی «GPT &lt;Plus&gt;» تمام شد؛ قیمت برگشت به ' + fa(1000000) + ' تومان.');
    const sent = t.tg.of('sendMessage').length;
    await tick(t, tehran(28, 0, 1));
    expect(t.tg.of('sendMessage')).toHaveLength(sent);
    expect(prod(t)).toEqual({ price: 1000000, compare_at_price: null });
  });

  for (const [label, o, sale] of [
    ['an auto-priced product', { mode: 'auto' }, 800000],
    ['an inactive product', { active: 0 }, 800000],
    ['a sale price at or above the price', {}, 1000000],
    ['a sale price above the price', {}, 1200000],
  ] as const) {
    it('not applied for ' + label + ': closed with a note and a notice', async () => {
      const t = setup(o);
      sched(t, sale);
      await tick(t, T_START);
      expect(prod(t)).toEqual({ price: 1000000, compare_at_price: null });
      expect(row(t).status).toBe('done');
      expect(row(t).note).toMatch(/^not applied/);
      expect(adminMsgs(t)).toHaveLength(1);
      expect(adminMsgs(t)[0]).toContain('اعمال نشد');
    });
  }

  it('a price changed by hand mid-sale is not reverted; admins are warned', async () => {
    const t = setup();
    sched(t);
    await tick(t, T_START);
    q(t.storeDb, 'UPDATE customer_products SET price = 750000 WHERE id = 1');
    await tick(t, T_END);
    expect(prod(t)).toEqual({ price: 750000, compare_at_price: 1000000 });
    expect(row(t)).toMatchObject({ status: 'done', note: 'price changed by hand; not reverted' });
    expect(adminMsgs(t).at(-1)).toContain('⚠️ قیمت «GPT &lt;Plus&gt;» وسط جشنواره دستی عوض شده بود؛ برنگرداندم.');
  });

  it('a pending schedule whose window already passed is done without touching the price', async () => {
    const t = setup();
    sched(t);
    await tick(t, tehran(28, 5, 0));
    expect(prod(t)).toEqual({ price: 1000000, compare_at_price: null });
    expect(row(t)).toMatchObject({ status: 'done', note: 'expired before start' });
    expect(t.tg.of('sendMessage')).toHaveLength(0);
  });

  it('a cancelled schedule is never touched', async () => {
    const t = setup();
    sched(t, 800000, START, END, 'cancelled');
    await tick(t, T_START);
    await tick(t, T_END);
    expect(prod(t)).toEqual({ price: 1000000, compare_at_price: null });
    expect(row(t).status).toBe('cancelled');
  });

  it('budget: four due rows stay within 50 units and the broadcast keeps its share', async () => {
    const t = setup();
    for (let i = 0; i < 3; i++) seedProduct(t, { name: 'P' + i, price: 1000000 });
    for (let p = 1; p <= 4; p++) q(t.storeDb, 'INSERT INTO price_schedules (product_id, sale_price, starts_at, ends_at) VALUES (?, 800000, ?, ?)', p, START, END);
    q(t.storeDb, "INSERT INTO customers (telegram_id, display_name) VALUES (9001, 'x'), (9002, 'y')");
    q(t.storeDb, "INSERT INTO broadcast_jobs (admin_chat_id, text, status, total) VALUES (1001, 'hello', 'running', 2)");
    await tick(t, T_START);
    expect(q(t.storeDb, "SELECT id FROM price_schedules WHERE status = 'active'")).toHaveLength(4);
    expect(t.maxBudget).toBeLessThanOrEqual(50);
    expect(t.tg.of('sendMessage').filter((c) => c.payload.text === 'hello').length).toBeGreaterThan(0);
  });

  it('two overlapping ticks apply once', async () => {
    const t = setup();
    sched(t);
    await Promise.all([tick(t, T_START), tick(t, T_START), tick(t, T_START)]);
    expect(prod(t)).toEqual({ price: 800000, compare_at_price: 1000000 });
    expect(row(t).status).toBe('active');
    expect(adminMsgs(t)).toHaveLength(1);
    await Promise.all([tick(t, T_END), tick(t, T_END)]);
    expect(prod(t)).toEqual({ price: 1000000, compare_at_price: null });
    expect(adminMsgs(t)).toHaveLength(2);
  });
});

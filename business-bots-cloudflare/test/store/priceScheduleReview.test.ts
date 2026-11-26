import { describe, expect, it } from 'vitest';
import { ADMIN, makeTestEnv, type TestEnv } from '../helpers/env';
import { callbackUpdate, textUpdate } from '../helpers/updates';
import { one, q, seedProduct } from '../helpers/seed';
import { recomputeOption } from '../../src/store/suppliers/recompute';
import type { Budget } from '../../src/lib/budget';
import { formatPrice } from '../../src/lib/time';

// regressions from the code review of the price-schedule feature
const CUST = { id: 7001, first_name: 'C' };
/** what the Eitaa poll (it runs first when monshi is on) spends before the price job: the job still sees ~15 units */
const EITAA_COST = 2;
const tehran = (d: number, h: number, m = 0) => new Date(Date.UTC(2026, 10, d, h - 4, m + 30));
const START = '2026-11-26 20:00:00';
const END = '2026-11-27 23:59:00';
const T_START = tehran(26, 20, 0);
const T_END = tehran(27, 23, 59);
const prod = (t: TestEnv, id = 1) => one(t.storeDb, 'SELECT price, compare_at_price FROM customer_products WHERE id = ?', id);
const sched = (t: TestEnv, id: number, sale = 800000, status = 'pending', extra = '') =>
  q(t.storeDb, `INSERT INTO price_schedules (product_id, sale_price, starts_at, ends_at, status${extra ? ', ' + extra.split('=')[0] : ''}) VALUES (?, ?, ?, ?, ?${extra ? ', ' + extra.split('=')[1] : ''})`, id, sale, START, END, status);
const tick = (t: TestEnv, now: Date) => { t.deps.now = () => now; return t.cron(now); };
const adminMsgs = (t: TestEnv, chat = ADMIN.id) => t.tg.of('sendMessage').filter((c) => c.payload.chat_id === chat).map((c) => String(c.payload.text));

describe('review B1: an existing compare_at_price survives a sale', () => {
  it('price 1,000,000 / compare 1,500,000 is exactly back after the sale', async () => {
    const t = makeTestEnv({ monshi: false });
    seedProduct(t, { price: 1000000 });
    q(t.storeDb, 'UPDATE customer_products SET compare_at_price = 1500000');
    sched(t, 1);
    await tick(t, T_START);
    expect(prod(t)).toEqual({ price: 800000, compare_at_price: 1000000 });
    expect(one(t.storeDb, 'SELECT normal_price, normal_compare_at FROM price_schedules')).toEqual({ normal_price: 1000000, normal_compare_at: 1500000 });
    await tick(t, T_END);
    expect(prod(t)).toEqual({ price: 1000000, compare_at_price: 1500000 });
    expect(one(t.storeDb, 'SELECT status FROM price_schedules').status).toBe('done');
  });

  it('cancelling an active sale restores the compare price too', async () => {
    const t = makeTestEnv({ monshi: false });
    seedProduct(t, { price: 1000000 });
    q(t.storeDb, 'UPDATE customer_products SET compare_at_price = 1500000');
    sched(t, 1);
    await tick(t, T_START);
    await t.send('store', callbackUpdate(ADMIN, 'psched_cancel_1'));
    expect(prod(t)).toEqual({ price: 1000000, compare_at_price: 1500000 });
  });
});

describe('review S1: one notice per tick, so reverts are not late on a tight budget', () => {
  const dueRows = (t: TestEnv, status: string) => {
    for (let i = 0; i < 3; i++) seedProduct(t, { name: 'P' + i, price: 1000000 });
    for (let p = 1; p <= 4; p++) {
      sched(t, p, 800000, status, status === 'active' ? 'normal_price=1000000' : '');
      if (status === 'active') q(t.storeDb, 'UPDATE customer_products SET price = 800000, compare_at_price = 1000000 WHERE id = ?', p);
    }
  };
  for (const monshi of [false, true]) {
    it('used = 35, 3 admins, 4 due rows (monshi: ' + monshi + '): all start in one tick, all end in the next, one notice each', async () => {
      const t = makeTestEnv({ monshi, adminIds: '1001,1002,1003' });
      let used = 0; void used;
      t.deps.onBudget = (b: Budget) => { b.used = monshi ? 35 - EITAA_COST : 35; used = b.used; };
      seedProduct(t, { name: 'P', price: 1000000 });
      for (let i = 0; i < 3; i++) seedProduct(t, { name: 'P' + i, price: 1000000 });
      for (let p = 1; p <= 4; p++) sched(t, p);
      await tick(t, T_START);
      expect(q(t.storeDb, "SELECT id FROM price_schedules WHERE status = 'active'")).toHaveLength(4);
      expect(q(t.storeDb, 'SELECT id FROM customer_products WHERE price = 800000')).toHaveLength(4);
      // ONE combined message per admin (the last admin may be cut off by the budget: the notice is best effort)
      expect(adminMsgs(t, 1001)).toHaveLength(1);
      expect(adminMsgs(t, 1001)[0].match(/🔥/g)).toHaveLength(4);
      await tick(t, T_END);
      expect(q(t.storeDb, "SELECT id FROM price_schedules WHERE status = 'done'")).toHaveLength(4);
      expect(q(t.storeDb, 'SELECT id FROM customer_products WHERE price = 1000000')).toHaveLength(4);
      expect(adminMsgs(t, 1001)).toHaveLength(2);
    });
  }

  it('active rows too: four reverts with 15 units left', async () => {
    const t = makeTestEnv({ monshi: true, adminIds: '1001,1002,1003' });
    t.deps.onBudget = (b: Budget) => { b.used = 35; };
    dueRows(t, 'active');
    await tick(t, T_END);
    expect(q(t.storeDb, "SELECT id FROM price_schedules WHERE status = 'done'")).toHaveLength(4);
  });
});

describe('review S2: a supplier recompute never rewrites a manual price', () => {
  it('a manual price that changes between the read and the write is kept', async () => {
    const t = makeTestEnv({ monshi: false });
    seedProduct(t, { price: 1000000 });
    q(t.storeDb, "UPDATE customer_products SET stock_mode = 'auto', is_available = 1"); // no active source → availability changes → the UPDATE runs
    const app = t.apps().store!;
    const orig = app.raw.prepare.bind(app.raw);
    app.raw.prepare = ((sql: string) => {
      // the sale starts right after recompute's read, before its write
      if (sql.startsWith('UPDATE customer_products SET price')) t.storeDb.sqlite.exec('UPDATE customer_products SET price = 800000, compare_at_price = 1000000 WHERE id = 1');
      return orig(sql);
    }) as any;
    await recomputeOption(app, 1);
    expect(prod(t)).toEqual({ price: 800000, compare_at_price: 1000000 });
    expect(one(t.storeDb, 'SELECT is_available FROM customer_products').is_available).toBe(0);
  });
});

describe('review S3: a stale price is never locked in at «agree»', () => {
  const WARN = '⚠️ قیمت این محصول تغییر کرده است؛ لطفاً دوباره بررسی کنید.';
  for (const [label, newPrice] of [['went up', 600000], ['went down', 400000]] as const) {
    it('the price ' + label + ' after the agree screen: pending discarded, product screen with the warning', async () => {
      const t = makeTestEnv({ monshi: false });
      seedProduct(t, { price: 500000 });
      q(t.storeDb, "INSERT INTO discount_codes (code, customer_product_id, discount_type, discount_value, expires_at) VALUES ('X', 1, 'percent', 10, '2999-01-01 00:00:00')");
      await t.send('store', textUpdate(CUST, '/start'));
      await t.send('store', callbackUpdate(CUST, 'cust_prod_1'));
      await t.send('store', callbackUpdate(CUST, 'cust_disc_enter_1'));
      await t.send('store', textUpdate(CUST, 'X'));
      q(t.storeDb, 'UPDATE customer_products SET price = ?', newPrice);
      await t.send('store', callbackUpdate(CUST, 'cust_agree_1'));
      const msg = t.tg.texts(CUST.id).at(-1)!;
      expect(msg).toContain(WARN);
      expect(msg).toContain('📦 GPT Plus');
      expect(t.tg.texts(CUST.id).join('\n')).not.toContain('رسید پرداخت را ارسال');
      // agreeing again from the fresh screen without a code uses the new price
      await t.send('store', callbackUpdate(CUST, 'cust_agree_1'));
      expect(t.tg.texts(CUST.id).at(-1)).toContain('رسید');
    });
  }
});

describe('review S4: a code on a sale price must not make the order free; sale below cost refused', () => {
  it('a 100% code is refused with too_big', async () => {
    const t = makeTestEnv({ monshi: false });
    seedProduct(t, { price: 500000 });
    q(t.storeDb, "INSERT INTO discount_codes (code, customer_product_id, discount_type, discount_value, expires_at) VALUES ('FREE', 1, 'percent', 100, '2999-01-01 00:00:00')");
    q(t.storeDb, "INSERT INTO discount_codes (code, customer_product_id, discount_type, discount_value, expires_at) VALUES ('BIG', 1, 'fixed', 900000, '2999-01-01 00:00:00')");
    for (const code of ['FREE', 'BIG']) {
      await t.send('store', textUpdate(CUST, '/start'));
      await t.send('store', callbackUpdate(CUST, 'cust_prod_1'));
      await t.send('store', callbackUpdate(CUST, 'cust_disc_enter_1'));
      await t.send('store', textUpdate(CUST, code));
      expect(t.tg.texts(CUST.id).at(-1)).toContain('⚠️ این کد تخفیف برای این محصول قابل استفاده نیست.');
    }
  });

  it('the wizard refuses a sale price below cost_toman', async () => {
    const t = makeTestEnv({ monshi: false });
    t.deps.now = () => tehran(26, 10);
    seedProduct(t, { price: 2000000 });
    q(t.storeDb, 'UPDATE customer_products SET cost_toman = 1500000');
    await t.send('store', textUpdate(ADMIN, '✏️ ویرایش محصول'));
    await t.send('store', callbackUpdate(ADMIN, 'cprod_edit_select_1'));
    await t.send('store', callbackUpdate(ADMIN, 'cprod_edit_f_sale'));
    await t.send('store', textUpdate(ADMIN, '1400000'));
    expect(t.tg.texts(ADMIN.id).at(-1)).toBe('⚠️ قیمت جشنواره از قیمت خرید کمتر است.');
    await t.send('store', textUpdate(ADMIN, '1600000'));
    expect(t.tg.texts(ADMIN.id).at(-1)).toContain('زمان شروع');
  });
});

describe('review S5: a cancel racing the start', () => {
  it('the row turned active between the read and the cancel: the guarded revert runs', async () => {
    const t = makeTestEnv({ monshi: false });
    t.deps.now = () => T_START;
    seedProduct(t, { price: 1000000 });
    q(t.storeDb, 'UPDATE customer_products SET compare_at_price = 1500000');
    sched(t, 1);
    const app = t.apps().store!;
    // the cron's start lands right after the admin's handler read the row (still pending)
    const orig = app.db.cancelSchedule.bind(app.db);
    let first = true;
    const stale = await app.db.getScheduleById(1);
    await tick(t, T_START);
    expect(one(t.storeDb, 'SELECT status FROM price_schedules').status).toBe('active');
    expect(await orig(stale!)).toBe('gone'); // what the old code reported
    // through the handler: the stale read is simulated by a pending row that flips to active during the first cancel
    q(t.storeDb, "UPDATE price_schedules SET status = 'pending', normal_price = NULL, normal_compare_at = NULL");
    q(t.storeDb, 'UPDATE customer_products SET price = 1000000, compare_at_price = 1500000');
    const origPrepare = t.storeDb.sqlite.prepare.bind(t.storeDb.sqlite);
    t.storeDb.sqlite.prepare = ((sql: string) => {
      if (first && sql.startsWith("UPDATE price_schedules SET status = 'cancelled' WHERE id = ? AND status = 'pending'")) {
        first = false;
        t.deps.now = () => T_START;
        t.storeDb.sqlite.exec("UPDATE price_schedules SET status = 'active', normal_price = 1000000, normal_compare_at = 1500000 WHERE id = 1");
        t.storeDb.sqlite.exec('UPDATE customer_products SET price = 800000, compare_at_price = 1000000 WHERE id = 1');
      }
      return origPrepare(sql);
    }) as any;
    await t.send('store', callbackUpdate(ADMIN, 'psched_cancel_1'));
    expect(one(t.storeDb, 'SELECT status FROM price_schedules').status).toBe('cancelled');
    expect(prod(t)).toEqual({ price: 1000000, compare_at_price: 1500000 });
    expect(t.tg.calls.some((c) => c.method === 'editMessageText' && String(c.payload.text).includes('قیمت برگشت به'))).toBe(true);
  });
});

describe('review M1/M3/M4/M6', () => {
  it('M1: a claimed-but-unapplied schedule is closed by the start batch itself', async () => {
    const t = makeTestEnv({ monshi: false });
    seedProduct(t, { price: 1000000, active: 0 });
    sched(t, 1);
    const app = t.apps().store!;
    const r = await app.db.startSchedule({ id: 1, product_id: 1, sale_price: 800000 });
    expect(r).toMatchObject({ claimed: 1, applied: 0, closed: 1 });
    expect(one(t.storeDb, 'SELECT status, note FROM price_schedules')).toMatchObject({ status: 'done', note: expect.stringMatching(/^not applied/) });
  });

  it('M3: the revert does nothing once the schedule is no longer active', async () => {
    const t = makeTestEnv({ monshi: false });
    seedProduct(t, { price: 800000 });
    q(t.storeDb, 'UPDATE customer_products SET compare_at_price = 1000000');
    sched(t, 1, 800000, 'cancelled', 'normal_price=1000000');
    const app = t.apps().store!;
    const r = await app.raw.prepare(
      "UPDATE customer_products SET price = ?, compare_at_price = ? WHERE id = ? AND price = ? AND compare_at_price = ? AND EXISTS (SELECT 1 FROM price_schedules WHERE id = ? AND status = 'active')",
    ).bind(1000000, null, 1, 800000, 1000000, 1).run();
    expect(r.meta.changes).toBe(0);
    expect(await app.db.endSchedule({ id: 1, product_id: 1, sale_price: 800000, normal_price: 1000000, normal_compare_at: null })).toEqual({ reverted: 0, finished: 0 });
    expect(prod(t)).toEqual({ price: 800000, compare_at_price: 1000000 });
  });

  it('M4: the start notice shows the claimed normal price, not the stale select', async () => {
    const t = makeTestEnv({ monshi: false });
    seedProduct(t, { price: 1000000 });
    sched(t, 1);
    const app = t.apps().store!;
    const rows = await app.db.getDueSchedules('2026-11-26 20:00:00');
    q(t.storeDb, 'UPDATE customer_products SET price = 900000'); // changed after the select
    const r = await app.db.startSchedule(rows[0]);
    expect(rows[0].current_price).toBe(1000000);
    expect(r.normalPrice).toBe(900000);
  });

  it('M6: the auto-product refusal has a back button', async () => {
    const t = makeTestEnv({ monshi: false });
    seedProduct(t, { price: 2000000 });
    q(t.storeDb, "UPDATE customer_products SET pricing_mode = 'auto'");
    await t.send('store', textUpdate(ADMIN, '✏️ ویرایش محصول'));
    await t.send('store', callbackUpdate(ADMIN, 'cprod_edit_select_1'));
    await t.send('store', callbackUpdate(ADMIN, 'cprod_edit_f_sale'));
    const m = t.tg.of('sendMessage', ADMIN.id).at(-1)!.payload;
    expect(m.text).toContain('خودکار');
    expect(m.reply_markup.inline_keyboard.flat().map((b: any) => b.callback_data)).toContain('cprod_edit_menu');
  });
});

describe('a code on a product already on sale: the better of the two, never both', () => {
  const enter = async (t: TestEnv, code: string) => {
    await t.send('store', textUpdate(CUST, '/start'));
    await t.send('store', callbackUpdate(CUST, 'cust_prod_1'));
    await t.send('store', callbackUpdate(CUST, 'cust_disc_enter_1'));
    await t.send('store', textUpdate(CUST, code));
    return t.tg.texts(CUST.id).at(-1)!;
  };
  const onSale = () => {
    const t = makeTestEnv({ monshi: false });
    seedProduct(t, { price: 750000 });
    q(t.storeDb, 'UPDATE customer_products SET compare_at_price = 949000');
    return t;
  };

  it('a 300k code counts from the normal price: 649,000, not 450,000', async () => {
    const t = onSale();
    q(t.storeDb, "INSERT INTO discount_codes (code, customer_product_id, discount_type, discount_value, expires_at) VALUES ('P300', 1, 'fixed', 300000, '2999-01-01 00:00:00')");
    const msg = await enter(t, 'P300');
    expect(msg).toContain('✅ کد تخفیف اعمال شد');
    expect(msg).toContain('قیمت با تخفیف: ' + formatPrice(649000));
    expect(msg).toContain('قیمت اصلی: ' + formatPrice(949000));
  });

  it('a code smaller than the sale: the sale price, and the code is not attached', async () => {
    const t = onSale();
    q(t.storeDb, "INSERT INTO discount_codes (code, customer_product_id, discount_type, discount_value, expires_at) VALUES ('P100', 1, 'fixed', 100000, '2999-01-01 00:00:00')");
    const msg = await enter(t, 'P100');
    expect(msg).toContain('تخفیف جشنواره‌ی این محصول از کد شما بیشتر است');
    expect(msg).toContain('💰 قیمت: ' + formatPrice(750000));
    expect(msg).not.toContain('قیمت با تخفیف');
  });
});

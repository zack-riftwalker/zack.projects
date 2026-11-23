import { describe, expect, it } from 'vitest';
import { ADMIN, makeTestEnv, type TestEnv } from '../helpers/env';
import { callbackUpdate, textUpdate } from '../helpers/updates';
import { one, q, seedProduct } from '../helpers/seed';
import { productCardText } from '../../src/store/handlers/customerProductsEdit';
import { scheduleSummary } from '../../src/store/handlers/priceScheduleAdmin';

const fa = (n: number) => n.toLocaleString('fa-IR');
const NOW = new Date(Date.UTC(2026, 10, 26, 6, 30)); // 2026-11-26 10:00 Tehran
const STARTS = '2026-11-26 20:00:00';
const ENDS = '2026-11-28 23:59:00';
const START_TXT = '۱۴۰۵/۰۹/۰۵ ۲۰:۰۰';
const END_TXT = '۱۴۰۵/۰۹/۰۷ ۲۳:۵۹';

function setup(opts: { mode?: string; price?: number } = {}) {
  const t = makeTestEnv({ monshi: false });
  t.deps.now = () => NOW;
  seedProduct(t, { name: 'GPT Plus', price: opts.price ?? 2000000 });
  if (opts.mode) q(t.storeDb, 'UPDATE customer_products SET pricing_mode = ? WHERE id = 1', opts.mode);
  return t;
}
const open = async (t: TestEnv) => {
  await t.send('store', textUpdate(ADMIN, '✏️ ویرایش محصول'));
  await t.send('store', callbackUpdate(ADMIN, 'cprod_edit_select_1'));
};
const press = async (t: TestEnv) => { await open(t); await t.send('store', callbackUpdate(ADMIN, 'cprod_edit_f_sale')); };
const last = (t: TestEnv) => String(t.tg.calls.filter((c) => ['sendMessage', 'editMessageText'].includes(c.method) && (c.payload.chat_id === ADMIN.id || c.method === 'editMessageText')).at(-1)!.payload.text);
const rows = (t: TestEnv) => q(t.storeDb, 'SELECT * FROM price_schedules');
const say = (t: TestEnv, s: string) => t.send('store', textUpdate(ADMIN, s));

describe('price schedule admin: wizard', () => {
  it('the card has the button and a «—» summary line', async () => {
    const t = setup();
    await open(t);
    const kb = t.tg.calls.filter((c) => c.payload?.reply_markup?.inline_keyboard).at(-1)!.payload.reply_markup.inline_keyboard.flat();
    expect(kb.some((b: any) => b.text === '⏰ قیمت زمان‌دار' && b.callback_data === 'cprod_edit_f_sale')).toBe(true);
    expect(last(t)).toContain('⏰ قیمت زمان‌دار: —');
    expect(last(t)).not.toContain('جشنواره‌ی این محصول فعال است');
  });

  it('full wizard: price → start → end → saved, summary on the card', async () => {
    const t = setup();
    await press(t);
    expect(last(t)).toBe('💰 قیمت جشنواره را بنویسید (تومان):');
    await say(t, '۱٬۹۸۰٬۰۰۰');
    expect(last(t)).toBe('⏰ زمان شروع را بنویسید (به وقت تهران)، مثلاً:\n۱۴۰۵/۰۹/۰۵ ۲۰:۰۰');
    await say(t, START_TXT);
    expect(last(t)).toBe('⏰ زمان پایان را بنویسید (به وقت تهران)، مثلاً:\n۱۴۰۵/۰۹/۰۷ ۲۳:۵۹');
    await say(t, END_TXT);
    expect(rows(t)).toMatchObject([{ product_id: 1, sale_price: 1980000, starts_at: STARTS, ends_at: ENDS, status: 'pending', normal_price: null }]);
    expect(last(t)).toContain('✅ ثبت شد: «GPT Plus» از ');
    expect(last(t)).toContain('با قیمت ' + fa(1980000) + ' تومان.');
    expect(last(t)).toContain('⏰ قیمت زمان‌دار: ' + fa(1980000) + ' ت از ' + START_TXT + ' تا ' + END_TXT + ' (در انتظار)');
    expect(last(t)).toContain('از ' + START_TXT + ' تا ' + END_TXT + ' با قیمت');
    expect(last(t)).toContain('(در انتظار)');
  });

  it('validation errors at every step keep the step', async () => {
    const t = setup();
    await press(t);
    for (const bad of ['abc', '0', '2000000', '2500000', '1.5', '-3']) {
      await say(t, bad);
      expect(last(t)).toBe('⚠️ قیمت جشنواره باید کمتر از قیمت فعلی باشد.');
    }
    await say(t, '1500000');
    await say(t, 'tomorrow');
    expect(last(t)).toContain('زمان نامعتبر');
    await say(t, '1405/09/05 09:00'); // 1 hour in the past
    expect(last(t)).toBe('⚠️ زمان شروع گذشته است.');
    await say(t, '1405/10/20 09:00'); // > 30 days ahead
    expect(last(t)).toContain('۳۰ روز');
    await say(t, START_TXT);
    await say(t, 'x');
    expect(last(t)).toContain('زمان نامعتبر');
    await say(t, '۱۴۰۵/۰۹/۰۵ ۱۹:۰۰'); // before the start
    expect(last(t)).toBe('⚠️ زمان پایان باید بعد از زمان شروع باشد.');
    await say(t, '۱۴۰۵/۱۰/۱۵ ۲۰:۰۰'); // > 30 days after the start
    expect(last(t)).toContain('۳۰ روز');
    expect(rows(t)).toHaveLength(0);
    await say(t, END_TXT);
    expect(rows(t)).toHaveLength(1);
  });

  it('a start up to 5 minutes in the past means «now»', async () => {
    const t = setup();
    await press(t);
    await say(t, '1500000');
    await say(t, '۱۴۰۵/۰۹/۰۵ ۰۹:۵۸'); // now is 10:00
    await say(t, END_TXT);
    expect(rows(t)[0].starts_at).toBe('2026-11-26 10:00:00');
  });

  it('refuses auto-priced products', async () => {
    const t = setup({ mode: 'auto' });
    await press(t);
    expect(last(t)).toBe('⚠️ قیمت این محصول خودکار (از تأمین‌کننده) است؛ قیمت زمان‌دار برایش ممکن نیست.');
    await say(t, '1500000'); // not a wizard step: nothing is created
    expect(rows(t)).toHaveLength(0);
  });

  it('a product with a schedule shows it with cancel + back, and no second one is created', async () => {
    const t = setup();
    q(t.storeDb, 'INSERT INTO price_schedules (product_id, sale_price, starts_at, ends_at) VALUES (1, 1500000, ?, ?)', STARTS, ENDS);
    await press(t);
    expect(last(t)).toContain(fa(1500000) + ' ت از ');
    const kb = t.tg.calls.filter((c) => c.payload?.reply_markup?.inline_keyboard).at(-1)!.payload.reply_markup.inline_keyboard.flat();
    expect(kb.map((b: any) => [b.text, b.callback_data])).toEqual([['🗑 لغو', 'psched_cancel_1'], ['🔙 بازگشت', 'cprod_edit_menu']]);
    await say(t, '1000000');
    expect(rows(t)).toHaveLength(1);
  });

  it('a schedule that appears mid-wizard is not duplicated', async () => {
    const t = setup();
    await press(t);
    await say(t, '1500000');
    await say(t, START_TXT);
    q(t.storeDb, 'INSERT INTO price_schedules (product_id, sale_price, starts_at, ends_at) VALUES (1, 1400000, ?, ?)', STARTS, ENDS);
    await say(t, END_TXT);
    expect(last(t)).toBe('⚠️ این محصول از قبل یک قیمت زمان‌دار (در انتظار یا فعال) دارد.');
    expect(rows(t)).toHaveLength(1);
  });
});

describe('price schedule admin: cancel', () => {
  it('cancels a pending schedule', async () => {
    const t = setup();
    q(t.storeDb, 'INSERT INTO price_schedules (product_id, sale_price, starts_at, ends_at) VALUES (1, 1500000, ?, ?)', STARTS, ENDS);
    await press(t);
    await t.send('store', callbackUpdate(ADMIN, 'psched_cancel_1'));
    expect(rows(t)[0].status).toBe('cancelled');
    expect(one(t.storeDb, 'SELECT price FROM customer_products').price).toBe(2000000);
    // and a new one can now be made
    await t.send('store', callbackUpdate(ADMIN, 'cprod_edit_f_sale'));
    expect(last(t)).toBe('💰 قیمت جشنواره را بنویسید (تومان):');
  });

  it('cancels an active schedule: the price reverts', async () => {
    const t = setup();
    q(t.storeDb, "INSERT INTO price_schedules (product_id, sale_price, normal_price, starts_at, ends_at, status) VALUES (1, 1500000, 2000000, ?, ?, 'active')", STARTS, ENDS);
    q(t.storeDb, 'UPDATE customer_products SET price = 1500000, compare_at_price = 2000000');
    await open(t);
    expect(last(t)).toContain('(فعال)');
    expect(last(t)).toContain('⚠️ جشنواره‌ی این محصول فعال است؛ با تغییر دستی قیمت، برگشت خودکار انجام نمی‌شود.');
    await t.send('store', callbackUpdate(ADMIN, 'psched_cancel_1'));
    expect(rows(t)[0]).toMatchObject({ status: 'cancelled', note: null });
    expect(one(t.storeDb, 'SELECT price, compare_at_price AS c FROM customer_products')).toEqual({ price: 2000000, c: null });
  });

  it('cancelling an active schedule whose price was changed by hand keeps the price and tells the admin', async () => {
    const t = setup();
    q(t.storeDb, "INSERT INTO price_schedules (product_id, sale_price, normal_price, starts_at, ends_at, status) VALUES (1, 1500000, 2000000, ?, ?, 'active')", STARTS, ENDS);
    q(t.storeDb, 'UPDATE customer_products SET price = 1700000, compare_at_price = 2000000');
    await t.send('store', callbackUpdate(ADMIN, 'psched_cancel_1'));
    expect(rows(t)[0]).toMatchObject({ status: 'cancelled', note: 'price changed by hand; not reverted' });
    expect(one(t.storeDb, 'SELECT price FROM customer_products').price).toBe(1700000);
    expect(t.tg.calls.some((c) => c.method === 'editMessageText' && String(c.payload.text).includes('لطفاً قیمت را خودتان چک کنید'))).toBe(true);
  });

  it('a forged psched_cancel_ from a non-admin is ignored', async () => {
    const t = setup();
    q(t.storeDb, "INSERT INTO price_schedules (product_id, sale_price, normal_price, starts_at, ends_at, status) VALUES (1, 1500000, 2000000, ?, ?, 'active')", STARTS, ENDS);
    q(t.storeDb, 'UPDATE customer_products SET price = 1500000, compare_at_price = 2000000');
    await t.send('store', callbackUpdate({ id: 4242, first_name: 'Evil' }, 'psched_cancel_1'));
    expect(rows(t)[0].status).toBe('active');
    expect(one(t.storeDb, 'SELECT price FROM customer_products').price).toBe(1500000);
  });

  it('cancel of an already finished schedule changes nothing', async () => {
    const t = setup();
    q(t.storeDb, "INSERT INTO price_schedules (product_id, sale_price, starts_at, ends_at, status) VALUES (1, 1500000, ?, ?, 'done')", STARTS, ENDS);
    await t.send('store', callbackUpdate(ADMIN, 'psched_cancel_1'));
    expect(rows(t)[0].status).toBe('done');
  });
});

describe('price schedule admin: card line', () => {
  it('summary text', () => {
    expect(scheduleSummary(null)).toBe('—');
    expect(scheduleSummary({ sale_price: 1980000, starts_at: STARTS, ends_at: ENDS, status: 'pending' })).toBe(
      fa(1980000) + ' ت از ۱۴۰۵/۰۹/۰۵ ۲۰:۰۰ تا ۱۴۰۵/۰۹/۰۷ ۲۳:۵۹ (در انتظار)');
    expect(scheduleSummary({ sale_price: 1, starts_at: STARTS, ends_at: ENDS, status: 'active' })).toMatch(/\(فعال\)$/);
    expect(productCardText({ id: 1, name: 'x', price: 5 } as any)).toContain('⏰ قیمت زمان‌دار: —');
  });

  it('callback data stays within 64 bytes', () => {
    expect(Buffer.byteLength('psched_cancel_' + 2147483647)).toBeLessThanOrEqual(64);
  });
});

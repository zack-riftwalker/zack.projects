import { describe, expect, it } from 'vitest';
import { ADMIN, ADMIN2 } from '../helpers/env';
import { one, q } from '../helpers/seed';
import { itemRef } from '../../src/store/suppliers/store';
import { at, callbackDataOf, press, say } from './helpers';
import { events, iso, posts, shop, soRow } from './engineHelpers';
import type { FakeAriobox } from '../helpers/fakeAriobox';

const completed = (fake: FakeAriobox, n: number, remoteId = '5001', price = '5.28') => {
  fake.state.orders[remoteId] = {
    ok: true, order_id: Number(remoteId), status: 'completed', price,
    accounts: Array.from({ length: n }, (_, i) => ({ attributes: [{ key: 'email', value: `acc${i + 1}@x.test` }, { key: 'password', value: 'pw' + (i + 1) }] })),
  };
};

/** Walks the real menu: direct buy → supplier → item → quantity → confirmation. Stops before «✅ خرید». */
async function toConfirm(t: any, sid: number, qty = 2, productId = '1300', variation = '') {
  const ref = await itemRef(productId, variation);
  await press(t, 'stk_buy');
  await press(t, 'stk_buys_' + sid);
  await press(t, 'stk_buyi_' + sid + '_' + ref);
  await press(t, `stk_buyq_${sid}_${ref}_${qty}`);
  buyOk(t, sid, ref, qty); // remember this confirmation's button
  return ref;
}
/** The «✅ خرید» button of the latest confirmation: its callback carries the confirmation's nonce (review S1). */
const seenBuyOk = new Map<string, string>();
const buyOk = (t: any, sid: number, ref: string, qty: number): string => {
  const prefix = 'stk_buyok_' + sid + '_' + ref + '_' + qty + '_';
  const all = t.tg.calls.filter((c: any) => c.method === 'editMessageText' || c.method === 'sendMessage').flatMap((c: any) => callbackDataOf(c.payload));
  const found = all.filter((d: string) => d.startsWith(prefix)).at(-1);
  if (found) seenBuyOk.set(prefix, found); // a test may clear the fake's calls before it presses
  return found ?? seenBuyOk.get(prefix)!;
};
const adminOnly = (t: any, marker: string) => ({
  a1: t.tg.texts(ADMIN.id).filter((x: string) => x.includes(marker)),
  a2: t.tg.texts(ADMIN2.id).filter((x: string) => x.includes(marker)),
});

describe('S7 direct buy (§10.1)', () => {
  it('menu → supplier → item → quantity → confirmation → one POST → poll → batch with every account, only the requesting admin hears', async () => {
    const { t, fake, sid } = await shop();
    t.tg.reset();
    const ref = await toConfirm(t, sid, 2);
    const confirmText = t.tg.of('editMessageText').at(-1)!.payload.text as string;
    expect(confirmText).toContain('🛒 <b>خرید مستقیم از «ArioBox Main»</b>');
    expect(confirmText).toContain('ChatGPT');
    expect(confirmText).toContain('× ۲');
    expect(confirmText).toContain('$10.56');
    expect(confirmText).toContain('💳 موجودی تخمینی کیف پول: $0.00');
    expect(callbackDataOf(t.tg.of('editMessageText').at(-1)!.payload)).toEqual([buyOk(t, sid, ref, 2), 'stk_x']);
    expect(posts(fake)).toHaveLength(0);

    t.tg.reset();
    await press(t, buyOk(t, sid, ref, 2));
    expect(posts(fake)).toHaveLength(1);
    expect(posts(fake)[0].body).toEqual({ product_id: '1300', quantity: 2, user_id: 42, note: 'stock/so#1' });
    expect(soRow(t)).toMatchObject({
      purpose: 'stock', status: 'placed', remote_order_id: '5001', requested_by: ADMIN.id, supplier_id: sid, quantity: 2,
      order_id: null, source_id: null, price_usd: 5.28, cost_toman: 1584000,
    });
    expect(one(t.storeDb, "SELECT amount_usd FROM wallet_ledger WHERE kind = 'spend'").amount_usd).toBe(-10.56);
    expect(t.tg.texts(ADMIN.id).join('\n')).toContain('⏳ سفارش ثبت شد (#5001)؛ با آماده شدن خبرتان می‌کنم.');

    completed(fake, 2, '5001', '10.56');
    t.tg.reset();
    await at(t, iso('09:52'));
    expect(soRow(t)).toMatchObject({ status: 'completed', next_check_at: null });
    const batch = one(t.storeDb, 'SELECT * FROM stock_batches');
    expect(batch).toMatchObject({ supplier_order_id: 1, supplier_id: sid, quantity: 2, unit_price_usd: 5.28, usd_toman: 150000, cost_toman: 1584000, note: null, created_by: ADMIN.id });
    expect(batch.title).toContain('ChatGPT');
    const accounts = q(t.storeDb, 'SELECT status, content_json FROM stock_accounts ORDER BY id');
    expect(accounts.map((a) => a.status)).toEqual(['available', 'available']);
    expect(JSON.parse(accounts[1].content_json).accounts[0].fields).toEqual([{ key: 'email', value: 'acc2@x.test' }, { key: 'password', value: 'pw2' }]);
    // only the requesting admin gets the batch card
    const { a1, a2 } = adminOnly(t, 'خرید مستقیم #1 تکمیل شد');
    expect(a1).toHaveLength(1);
    expect(a2).toHaveLength(0);
    expect(a1[0]).toContain('📦');
    const card = t.tg.of('sendMessage', ADMIN.id).map((c) => c.payload).find((p) => p.text.includes('تکمیل شد'))!;
    expect(callbackDataOf(card)).toEqual(expect.arrayContaining(['stk_a_1', 'stk_a_2', 'stk_bp_1', 'stk_bn_1', 'stk_list_0']));
    expect(events(t, 'completed')).toHaveLength(1);
    expect(posts(fake)).toHaveLength(1);
  });

  it('fewer accounts than ordered: the batch keeps what arrived, notes the difference and tells the admin', async () => {
    const { t, fake, sid } = await shop();
    const ref = await toConfirm(t, sid, 3);
    await press(t, buyOk(t, sid, ref, 3));
    completed(fake, 2);
    t.tg.reset();
    await at(t, iso('09:52'));
    expect(one(t.storeDb, 'SELECT quantity, note FROM stock_batches')).toEqual({ quantity: 2, note: 'فقط 2 از 3 اکانت رسید' });
    expect(q(t.storeDb, 'SELECT id FROM stock_accounts')).toHaveLength(2);
    expect(t.tg.texts(ADMIN.id).join('\n')).toContain('⚠️ فقط ۲ از ۳ اکانت رسید');
    expect(posts(fake)).toHaveLength(1);
  });

  it('the accounts of a direct buy are offered first (🎯) for the options that share the supplier item', async () => {
    const { t, fake, sid, m1, m3 } = await shop();
    const ref = await toConfirm(t, sid, 1);
    await press(t, buyOk(t, sid, ref, 1));
    completed(fake, 1);
    await at(t, iso('09:52'));
    const { textUpdate } = await import('../helpers/updates');
    await t.send('store', textUpdate({ id: 2002, first_name: 'Ali', username: 'ali_user' }, '/start'));
    await press(t, 'stk_send_1');
    await say(t, '2002');
    const kb = t.tg.of('sendMessage', ADMIN.id).at(-1)!.payload.reply_markup.inline_keyboard.flat();
    const label = (pid: number) => kb.find((b: any) => b.callback_data === `stk_sp_1_2002_${pid}`).text as string;
    expect(label(m1).startsWith('🎯')).toBe(true); // m1 = 1300 with no variation → the same supplier item
    expect(label(m3).startsWith('🎯')).toBe(false);
  });

  it('a double press of «✅ خرید» (or a replayed button) buys once', async () => {
    const { t, fake, sid } = await shop();
    const ref = await toConfirm(t, sid, 1);
    await press(t, buyOk(t, sid, ref, 1));
    await press(t, buyOk(t, sid, ref, 1));
    expect(posts(fake)).toHaveLength(1);
    expect(q(t.storeDb, 'SELECT id FROM supplier_orders')).toHaveLength(1);
    expect(t.tg.of('answerCallbackQuery').at(-1)!.payload.text).toContain('قبلاً استفاده شده');
  });

  it('a custom quantity is typed (1–10) through the supplier text slot; 11 is refused', async () => {
    const { t, sid } = await shop();
    const ref = await itemRef('1300', '');
    await press(t, 'stk_buyc_' + sid + '_' + ref);
    await say(t, '11');
    expect(t.tg.texts(ADMIN.id).at(-1)).toContain('۱ تا ۱۰');
    await say(t, '۴');
    const text = t.tg.of('sendMessage', ADMIN.id).at(-1)!.payload;
    expect(text.text).toContain('× ۴');
    expect(callbackDataOf(text)).toEqual([buyOk(t, sid, ref, 4), 'stk_x']);
  });

  it('unknown: one POST, only the requester is asked, nothing is retried by cron; recording the number continues the order', async () => {
    const { t, fake, sid } = await shop();
    const ref = await toConfirm(t, sid, 1);
    fake.state.postQueue.push('timeout');
    t.tg.reset();
    await press(t, buyOk(t, sid, ref, 1));
    expect(soRow(t)).toMatchObject({ status: 'unknown', purpose: 'stock' });
    const ask = t.tg.of('sendMessage', ADMIN.id).map((c) => c.payload).find((p) => p.text.includes('معلوم نیست'))!;
    expect(callbackDataOf(ask)).toEqual(['stk_rid_1', 'stk_rtu_1']);
    expect(ask.text).toContain('stock/so#1');
    expect(t.tg.of('sendMessage', ADMIN2.id).filter((c) => c.payload.text.includes('معلوم نیست'))).toHaveLength(0);

    for (const hhmm of ['09:55', '10:10', '11:30']) await at(t, iso(hhmm));
    expect(posts(fake)).toHaveLength(1);
    expect(soRow(t).status).toBe('unknown');

    await press(t, 'stk_rid_1');
    await say(t, '5001');
    expect(soRow(t)).toMatchObject({ status: 'placed', remote_order_id: '5001' });
    expect(events(t, 'remote_id_set')).toHaveLength(1);
    // the price was saved before the POST, so recording the number also records the spend
    expect(q(t.storeDb, "SELECT amount_usd, supplier_order_id FROM wallet_ledger WHERE kind = 'spend'")).toEqual([{ amount_usd: -5.28, supplier_order_id: 1 }]);
  });

  it('unknown → «ثبت نشده بود»: asks first, then buys again with a second POST', async () => {
    const { t, fake, sid } = await shop();
    const ref = await toConfirm(t, sid, 1);
    fake.state.postQueue.push({ status: 500, body: { detail: 'boom' } });
    await press(t, buyOk(t, sid, ref, 1));
    expect(soRow(t).status).toBe('unknown');
    await press(t, 'stk_rtu_1');
    expect(t.tg.of('editMessageText').at(-1)!.payload.text).toContain('دوبار شارژ');
    expect(posts(fake)).toHaveLength(1);
    await press(t, 'stk_rtuok_1');
    expect(posts(fake)).toHaveLength(2);
    expect(soRow(t).status).toBe('placed');
    await press(t, 'stk_rtuok_1'); // a stale press does nothing
    expect(posts(fake)).toHaveLength(2);
  });

  it('a placement whose Worker died (stale lease) becomes unknown, the requester is asked and nothing is sent again', async () => {
    const { t, fake, sid } = await shop();
    q(t.storeDb, `INSERT INTO supplier_orders (purpose, supplier_id, remote_product_id, remote_variation_id, quantity, status, lease_until, requested_by, created_at, updated_at)
                  VALUES ('stock', ?, '1300', '', 1, 'placing', '2026-10-25 12:00:00', ?, '2026-10-25 12:00:00', '2026-10-25 12:00:00')`, sid, ADMIN.id);
    t.tg.reset();
    await at(t, iso('10:00')); // 13:30 in Tehran: the lease ran out at 12:00
    expect(soRow(t).status).toBe('unknown');
    expect(posts(fake)).toHaveLength(0);
    const ask = t.tg.of('sendMessage', ADMIN.id).map((c) => c.payload).find((p) => p.text.includes('معلوم نیست'))!;
    expect(callbackDataOf(ask)).toEqual(['stk_rid_1', 'stk_rtu_1']);
    await at(t, iso('11:00'));
    expect(posts(fake)).toHaveLength(0);
  });

  it('refusals are never retried automatically: failed + a «🔁 دوباره» button for the requester; pressing it makes the second POST', async () => {
    const { t, fake, sid } = await shop();
    const ref = await toConfirm(t, sid, 1);
    fake.state.postQueue.push({ status: 503, body: { detail: 'busy' } });
    t.tg.reset();
    await press(t, buyOk(t, sid, ref, 1));
    expect(soRow(t)).toMatchObject({ status: 'failed', last_http: 503 });
    const msg = t.tg.of('sendMessage', ADMIN.id).map((c) => c.payload).find((p) => p.text.includes('خرید مستقیم #1'))!;
    expect(callbackDataOf(msg)).toEqual(['stk_rt_1']);
    expect(t.tg.of('sendMessage', ADMIN2.id).filter((c) => c.payload.text.includes('خرید مستقیم #1'))).toHaveLength(0);
    for (const hhmm of ['09:55', '10:20', '12:00']) await at(t, iso(hhmm));
    expect(posts(fake)).toHaveLength(1);

    await press(t, 'stk_rt_1');
    expect(posts(fake)).toHaveLength(2);
    // a retry is a NEW row (review S7); the failed one is closed so it can't be retried twice
    expect(soRow(t, 1).status).toBe('cancelled');
    expect(soRow(t, 2)).toMatchObject({ status: 'placed', remote_order_id: '5001', purpose: 'stock' });
    await press(t, 'stk_rt_1'); // not failed any more
    expect(posts(fake)).toHaveLength(2);
  });

  it('out of stock, a rejected order and a bad key each give a reason and a retry button, with one POST each', async () => {
    const { t, fake, sid } = await shop();
    const ref = await toConfirm(t, sid, 1);
    for (const [status, detail, text] of [[409, 'out of stock', 'ناموجود'], [400, 'bad body', 'نپذیرفت'], [401, 'invalid api key', 'تنظیمات']] as const) {
      fake.state.postQueue.push({ status, body: { detail } });
      t.tg.reset();
      await toConfirm(t, sid, 1);
      await press(t, buyOk(t, sid, ref, 1));
      const msg = t.tg.of('sendMessage', ADMIN.id).map((c) => c.payload).find((p) => p.text.includes('❌'))!;
      expect(msg.text).toContain(text);
      expect(callbackDataOf(msg)).toHaveLength(1);
    }
    expect(posts(fake)).toHaveLength(3);
    expect(q(t.storeDb, "SELECT status FROM supplier_orders WHERE purpose = 'stock'").map((r) => r.status)).toEqual(['failed', 'failed', 'failed']);
  });

  it('a supplier final failure after placing is told to the requester only', async () => {
    const { t, fake, sid } = await shop();
    const ref = await toConfirm(t, sid, 1);
    await press(t, buyOk(t, sid, ref, 1));
    fake.state.orders['5001'] = { ok: true, order_id: 5001, status: 'failed', price: '5.28', accounts: [] };
    t.tg.reset();
    await at(t, iso('09:52'));
    expect(soRow(t).status).toBe('failed');
    expect(t.tg.texts(ADMIN.id).join('\n')).toContain('ناموفق اعلام کرد');
    expect(t.tg.texts(ADMIN2.id).join('\n')).not.toContain('ناموفق اعلام کرد');
    expect(q(t.storeDb, 'SELECT id FROM stock_batches')).toHaveLength(0);
  });

  it('a completed order that returns no accounts (4 polls) tells the requester and creates no batch', async () => {
    const { t, fake, sid } = await shop();
    const ref = await toConfirm(t, sid, 1);
    await press(t, buyOk(t, sid, ref, 1));
    fake.state.orders['5001'] = { ok: true, order_id: 5001, status: 'completed', price: '5.28', accounts: [] };
    for (const hhmm of ['09:52', '09:55', '10:00', '10:10', '10:20']) await at(t, iso(hhmm));
    expect(soRow(t).status).toBe('failed');
    expect(q(t.storeDb, 'SELECT id FROM stock_batches')).toHaveLength(0);
    expect(t.tg.texts(ADMIN.id).join('\n')).toContain('اکانتی برنگشت');
  });

  it('every callback of the flow stays within 64 bytes', async () => {
    const { t, sid } = await shop();
    const ref = await toConfirm(t, sid, 10);
    for (const row of t.tg.calls.flatMap((c) => c.payload.reply_markup?.inline_keyboard ?? []).flat()) {
      if (row.callback_data) expect(new TextEncoder().encode(row.callback_data).length).toBeLessThanOrEqual(64);
    }
    expect(buyOk(t, sid, ref, 10).length).toBeLessThanOrEqual(64);
  });
});

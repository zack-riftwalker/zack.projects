import { describe, expect, it } from 'vitest';
import { ADMIN } from '../helpers/env';
import { textUpdate } from '../helpers/updates';
import { one, q } from '../helpers/seed';
import { callbackDataOf, press, say } from './helpers';
import { CUSTOMER, events, orderRow, seedStock, shop } from './engineHelpers';

const accts = (t: any) => q(t.storeDb, 'SELECT id, status, order_id, sold_price_toman, sold_at, note FROM stock_accounts ORDER BY id');

async function withStock() {
  const s = await shop();
  await s.t.send('store', textUpdate(CUSTOMER, '/start'));
  await seedStock(s.t, [{ email: 'one@x.test', password: 'p1' }, { email: 'two@x.test', password: 'p2' }], 'ChatGPT — 1 month', 750000);
  s.t.tg.reset();
  return s;
}

describe('S7 «📦 اکانت‌های من» (§10.2)', () => {
  it('the list shows the batch with free counts; the batch card shows cost, profit, note and an account button each', async () => {
    const { t } = await withStock();
    await press(t, 'stk_list_0');
    const list = t.tg.of('editMessageText').at(-1)!.payload;
    expect(callbackDataOf(list)).toContain('stk_b_1');
    expect(JSON.stringify(list.reply_markup)).toContain('آزاد ۲ از ۲');
    await press(t, 'stk_b_1');
    const card = t.tg.of('editMessageText').at(-1)!.payload;
    expect(card.text).toContain('💵 هزینه: ۷۵۰٬۰۰۰ ت');
    expect(card.text).toContain('سود ثبت‌شده برای کل دسته: —');
    expect(callbackDataOf(card)).toEqual(['stk_a_1', 'stk_a_2', 'stk_bp_1', 'stk_bn_1', 'stk_list_0']);
    expect(JSON.stringify(card.reply_markup)).toContain('اکانت ۱ — آزاد');
  });

  it('an empty list says so', async () => {
    const { t } = await shop();
    await press(t, 'stk_list_0');
    expect(t.tg.of('editMessageText').at(-1)!.payload.text).toContain('هنوز اکانتی ندارید');
  });

  it('send to a customer by id: the order is created confirmed→delivered with the product clocks, the cost is the unit cost, the account is delivered', async () => {
    const { t, m1 } = await withStock();
    await press(t, 'stk_a_1');
    expect(callbackDataOf(t.tg.of('editMessageText').at(-1)!.payload)).toEqual(['stk_send_1', 'stk_link_1', 'stk_out_1', 'stk_bad_1', 'stk_b_1']);
    await press(t, 'stk_send_1');
    await say(t, '2002');
    const picker = t.tg.of('sendMessage', ADMIN.id).at(-1)!.payload;
    expect(callbackDataOf(picker)).toContain('stk_sp_1_2002_' + m1);

    await press(t, `stk_sp_1_2002_${m1}`);
    await say(t, '۳۰۰٬۰۰۰');
    const o = orderRow(t, 1);
    expect(o).toMatchObject({
      customer_telegram_id: CUSTOMER.id, customer_product_id: m1, price: 300000, purchase_source: 'manual', status: 'delivered',
      fulfillment: 'stock', cost_toman: 375000, decided_by: ADMIN.id, customer_username: 'ali_user', needs_action_reason: null,
    });
    expect(o.delivered_at).toBeTruthy();
    expect(o.expires_at).toBeTruthy(); // the clocks start now
    expect(o.warranty_expires_at).toBeTruthy();
    expect(accts(t)[0]).toMatchObject({ status: 'delivered', order_id: 1 });
    expect(accts(t)[1].status).toBe('available');
    expect(one(t.storeDb, 'SELECT kind, sent_ok, stock_account_id FROM order_deliveries')).toEqual({ kind: 'stock', sent_ok: 1, stock_account_id: 1 });
    const sent = t.tg.of('sendMessage', CUSTOMER.id).map((c) => c.payload);
    expect(sent.at(-1)!.text).toContain('one@x.test');
    expect(sent.at(-1)!.parse_mode).toBe('HTML');
    const notice = t.tg.of('sendMessage', ADMIN.id).map((c) => c.payload.text as string).find((x) => x.includes('تحویل شد'))!;
    expect(notice).toContain('📦 از اکانت‌های من');
    expect(notice).toContain('خرید: ۳۷۵٬۰۰۰ ت');
    expect(events(t, 'delivered')).toHaveLength(1);
    // the account card of a delivered account has no action, only the order
    await press(t, 'stk_a_1');
    expect(callbackDataOf(t.tg.of('editMessageText').at(-1)!.payload)).toEqual(['stk_b_1']);
    expect(t.tg.of('editMessageText').at(-1)!.payload.text).toContain('/order 1');
  });

  it('send by @username with the product price button; a price of 0 is allowed', async () => {
    const { t, m1 } = await withStock();
    await press(t, 'stk_send_1');
    await say(t, '@Ali_User'); // the lookup tries the lower-case spelling too
    await press(t, `stk_sp_1_2002_${m1}`);
    await say(t, '0');
    expect(orderRow(t, 1)).toMatchObject({ price: 0, status: 'delivered', fulfillment: 'stock' });
    await press(t, 'stk_send_2');
    await say(t, '2002');
    await press(t, `stk_sp_2_2002_${m1}`);
    const price = Number(one(t.storeDb, 'SELECT price FROM customer_products WHERE id = ?', m1).price);
    await press(t, `stk_spd_2_2002_${m1}`);
    expect(orderRow(t, 2).price).toBe(price);
  });

  it('a customer who never started the bot is refused, and the prompt stays open for another id', async () => {
    const { t } = await withStock();
    await press(t, 'stk_send_1');
    await say(t, '999999');
    expect(t.tg.texts(ADMIN.id).at(-1)).toContain('❌ این مشتری ربات را استارت نزده است.');
    expect(q(t.storeDb, 'SELECT id FROM orders')).toHaveLength(0);
    await say(t, '@nobody_here');
    expect(t.tg.texts(ADMIN.id).at(-1)).toContain('❌ این مشتری ربات را استارت نزده است.');
    await say(t, '2002');
    expect(t.tg.of('sendMessage', ADMIN.id).at(-1)!.payload.text).toContain('کدام محصول');
    expect(accts(t)[0].status).toBe('available');
  });

  it('two sends racing for one account: only one order is created', async () => {
    const { t, m1 } = await withStock();
    await press(t, 'stk_send_1');
    await say(t, '2002');
    await press(t, `stk_sp_1_2002_${m1}`);
    q(t.storeDb, "UPDATE stock_accounts SET status = 'reserved' WHERE id = 1"); // someone else took it meanwhile
    await say(t, '1000');
    expect(q(t.storeDb, 'SELECT id FROM orders')).toHaveLength(0);
    expect(t.tg.texts(ADMIN.id).at(-1)).toContain('این اکانت دیگر آزاد نیست');
  });

  it('a customer who blocked the bot: the order stays confirmed with the «send failed» card and the account is reserved', async () => {
    const { t, m1 } = await withStock();
    t.tg.fail('sendMessage', (c) => c.payload.chat_id === CUSTOMER.id);
    await press(t, 'stk_send_1');
    await say(t, '2002');
    await press(t, `stk_sp_1_2002_${m1}`);
    await say(t, '5000');
    expect(orderRow(t, 1)).toMatchObject({ status: 'confirmed', fulfillment: 'stock', needs_action_reason: 'send_failed' });
    expect(accts(t)[0]).toMatchObject({ status: 'reserved', order_id: 1 });
  });

  it('sold outside: asks the price, marks the account; «↩️ برگشت به آزاد» clears the sale', async () => {
    const { t } = await withStock();
    await press(t, 'stk_out_2');
    await say(t, '۵۰۰۰۰۰');
    expect(accts(t)[1]).toMatchObject({ status: 'sold_outside', sold_price_toman: 500000 });
    expect(accts(t)[1].sold_at).toBeTruthy();
    const card = t.tg.of('sendMessage', ADMIN.id).at(-1)!.payload;
    expect(card.text).toContain('فروخته‌شده بیرون');
    expect(callbackDataOf(card)).toEqual(['stk_back_2', 'stk_b_1']);
    await press(t, 'stk_back_2');
    expect(accts(t)[1]).toMatchObject({ status: 'available', sold_price_toman: null, sold_at: null });
    await press(t, 'stk_back_2'); // already available: nothing happens
    expect(t.tg.of('answerCallbackQuery').at(-1)!.payload.text).toContain('تغییر کرده');
  });

  it('defective with a note, then back to available', async () => {
    const { t } = await withStock();
    await press(t, 'stk_bad_1');
    await say(t, 'رمز کار نمی‌کند');
    expect(accts(t)[0]).toMatchObject({ status: 'defective', note: 'رمز کار نمی‌کند' });
    await press(t, 'stk_back_1');
    expect(accts(t)[0]).toMatchObject({ status: 'available', note: null });
    await press(t, 'stk_bad_1');
    await say(t, '-');
    expect(accts(t)[0]).toMatchObject({ status: 'defective', note: null });
  });

  it('batch profit accepts a negative amount and Persian digits; the note is saved', async () => {
    const { t } = await withStock();
    await press(t, 'stk_bp_1');
    await say(t, 'abc');
    expect(t.tg.texts(ADMIN.id).at(-1)).toContain('عدد صحیح');
    await say(t, '-۱۲۰٬۰۰۰');
    expect(one(t.storeDb, 'SELECT reported_profit_toman, reported_at FROM stock_batches')).toMatchObject({ reported_profit_toman: -120000 });
    expect(one(t.storeDb, 'SELECT reported_at FROM stock_batches').reported_at).toBeTruthy();
    expect(t.tg.of('sendMessage', ADMIN.id).at(-1)!.payload.text).toContain('۱۲۰٬۰۰۰ ت');
    await press(t, 'stk_bn_1');
    await say(t, 'خرید از بازار');
    expect(one(t.storeDb, 'SELECT note FROM stock_batches').note).toBe('خرید از بازار');
  });

  it('the stock prompts take the admin text even inside another wizard (no wizard receives it)', async () => {
    const { t } = await withStock();
    await say(t, '➕ افزودن محصول');
    await press(t, 'stk_out_1');
    await say(t, '1234');
    expect(accts(t)[0]).toMatchObject({ status: 'sold_outside', sold_price_toman: 1234 });
    expect(q(t.storeDb, "SELECT id FROM customer_products WHERE name = '1234'")).toHaveLength(0);
  });

  it('a non-admin cannot press any stock button', async () => {
    const { t } = await withStock();
    await t.send('store', (await import('../helpers/updates')).callbackUpdate(CUSTOMER, 'stk_out_1'));
    expect(accts(t)[0].status).toBe('available');
  });
});

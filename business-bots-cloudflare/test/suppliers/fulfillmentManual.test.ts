import { describe, expect, it } from 'vitest';
import { ADMIN, ADMIN2 } from '../helpers/env';
import { textUpdate } from '../helpers/updates';
import { one, q } from '../helpers/seed';
import { COMPLETION_TEXT } from '../../src/store/bridgeHandlers';
import { at, callbackDataOf, press, say } from './helpers';
import {
  adminTexts, buy, completedOrder, confirm, CUSTOMER, events, failedOrder, iso, orderRow, pressAs, posts, sayAs, seedStock, shop, soRow,
} from './engineHelpers';

const lastEdit = (t: any) => t.tg.of('editMessageText').at(-1)!.payload;
const customerGot = (t: any, marker: string) => t.tg.of('sendMessage', CUSTOMER.id).filter((c: any) => c.payload.text.includes(marker));

describe('📦 از اکانت‌های من (fo_stock)', () => {
  it('an empty stock says so; with accounts: list → confirmation shows the account → the customer gets it, the order is delivered with the batch cost', async () => {
    const { t, fake, m1 } = await shop();
    const orderId = await failedOrder(t, fake, m1);
    await press(t, 'fo_stock_' + orderId);
    expect(lastEdit(t).text).toContain('اکانت آزادی در «اکانت‌های من» نیست');

    await seedStock(t, [{ email: 's1@x.test', password: 'pw<1>' }, { email: 's2@x.test', password: 'pw2' }]);
    await press(t, 'fo_stock_' + orderId);
    expect(callbackDataOf(lastEdit(t))).toEqual(['fo_stk_' + orderId + '_1', 'fo_stk_' + orderId + '_2', 'fo_card_' + orderId]);

    await press(t, 'fo_stk_' + orderId + '_1');
    expect(lastEdit(t).text).toContain('<code>s1@x.test</code>');
    expect(lastEdit(t).text).toContain('<code>pw&lt;1&gt;</code>');
    expect(orderRow(t, orderId).status).toBe('confirmed'); // a confirmation changes nothing

    t.tg.reset();
    await press(t, 'fo_stkok_' + orderId + '_1');
    const msg = customerGot(t, 'آماده است');
    expect(msg).toHaveLength(1);
    expect(msg[0].payload.text).toContain('<code>s1@x.test</code>');
    expect(orderRow(t, orderId)).toMatchObject({ status: 'delivered', fulfillment: 'stock', cost_toman: 375000, needs_action_reason: null });
    expect(orderRow(t, orderId).expires_at).toBeTruthy();
    expect(q(t.storeDb, 'SELECT id, status, order_id FROM stock_accounts ORDER BY id')).toEqual([
      { id: 1, status: 'delivered', order_id: orderId }, { id: 2, status: 'available', order_id: null },
    ]);
    expect(one(t.storeDb, 'SELECT kind, stock_account_id, sent_ok FROM order_deliveries')).toEqual({ kind: 'stock', stock_account_id: 1, sent_ok: 1 });
    expect(events(t, 'admin_stock')[0]).toMatchObject({ actor: ADMIN.id });
    const notice = adminTexts(t, 'تحویل شد');
    expect(notice[0]).toContain('📦 از اکانت‌های من');
    expect(notice[0]).toContain('خرید: ');
    expect(lastEdit(t).text).toContain('📦 از اکانت‌های من ارسال شد توسط Admin');
  });

  it('accounts bought for one of the option\'s sources come first (🎯): an order that was resolved otherwise leaves its account in stock', async () => {
    const { t, fake, m1, m3 } = await shop();
    await seedStock(t, [{ email: 'old@x.test', password: 'p' }], 'Other product', 100000); // account #1, unrelated
    // an order is delivered by hand while its supplier order is placed; the supplier's account then lands in stock
    const first = await buy(t, m1);
    await confirm(t, first);
    await press(t, 'fo_self_' + first);
    completedOrder(fake);
    await at(t, iso('09:52'));
    expect(q(t.storeDb, 'SELECT id, supplier_order_id FROM stock_batches ORDER BY id').map((r) => r.supplier_order_id)).toEqual([null, 1]);

    const second = await buy(t, m1);
    fake.state.postQueue.push({ status: 401, body: { detail: 'x' } });
    await confirm(t, second);
    await press(t, 'fo_stock_' + second);
    // the diverted account (batch 2 = account 2) was bought for this very source → listed before the older, unrelated one
    expect(callbackDataOf(lastEdit(t)).slice(0, 2)).toEqual(['fo_stk_' + second + '_2', 'fo_stk_' + second + '_1']);
    expect(lastEdit(t).reply_markup.inline_keyboard[0][0].text).toContain('🎯');
    expect(m3).toBeGreaterThan(0);
  });

  it('two admins picking different accounts at once: one account goes out, the other stays free', async () => {
    const { t, fake, m1 } = await shop();
    const orderId = await failedOrder(t, fake, m1);
    await seedStock(t, [{ email: 'a@x.test', password: '1' }, { email: 'b@x.test', password: '2' }]);
    t.tg.reset();
    await Promise.all([
      pressAs(t, ADMIN, 'fo_stkok_' + orderId + '_1'),
      pressAs(t, ADMIN2, 'fo_stkok_' + orderId + '_2'),
    ]);
    expect(customerGot(t, 'آماده است')).toHaveLength(1);
    const accounts = q(t.storeDb, 'SELECT status FROM stock_accounts ORDER BY id').map((r) => r.status).sort();
    expect(accounts).toEqual(['available', 'delivered']);
    expect(one(t.storeDb, 'SELECT COUNT(*) n FROM order_deliveries').n).toBe(1);
  });

  it('the customer blocked the bot: the account stays reserved for this order, a send_failed card comes; 🔁 ارسال دوباره finishes it', async () => {
    const { t, fake, m1 } = await shop();
    const orderId = await failedOrder(t, fake, m1);
    await seedStock(t, [{ email: 'a@x.test', password: '1' }]);
    t.tg.fail('sendMessage', (c) => c.payload.chat_id === CUSTOMER.id, 403, 'Forbidden: bot was blocked by the user');
    await press(t, 'fo_stkok_' + orderId + '_1');
    expect(one(t.storeDb, 'SELECT status, order_id FROM stock_accounts')).toEqual({ status: 'reserved', order_id: orderId });
    expect(orderRow(t, orderId)).toMatchObject({ status: 'confirmed', needs_action_reason: 'send_failed' });
    expect(adminTexts(t, 'تحویل نشد')).toHaveLength(1);
    expect(adminTexts(t, 'تحویل نشد', ADMIN2.id)).toHaveLength(1);

    t.tg.clearRules();
    await press(t, 'fo_resend_' + orderId);
    expect(orderRow(t, orderId)).toMatchObject({ status: 'delivered', fulfillment: 'stock', cost_toman: 750000 });
    expect(one(t.storeDb, 'SELECT status FROM stock_accounts').status).toBe('delivered');
  });

  it('wrong states: a taken account, a delivered order, a missing account', async () => {
    const { t, fake, m1 } = await shop();
    const orderId = await failedOrder(t, fake, m1);
    await seedStock(t, [{ email: 'a@x.test', password: '1' }]);
    await press(t, 'fo_stkok_' + orderId + '_1');
    await press(t, 'fo_stkok_' + orderId + '_1'); // again
    expect(t.tg.of('answerCallbackQuery').at(-1)!.payload.text).toContain('قبلاً تصمیم گرفته شد');
    expect(customerGot(t, 'آماده است')).toHaveLength(1);
    await press(t, 'fo_stk_' + orderId + '_99');
    expect(t.tg.of('answerCallbackQuery').at(-1)!.payload.text).toContain('قبلاً تصمیم گرفته شد');
  });

  it('a supplier order still running is not allowed to deliver as well: its accounts go to stock', async () => {
    const { t, fake, m1 } = await shop();
    await seedStock(t, [{ email: 'a@x.test', password: '1' }]);
    const orderId = await buy(t, m1);
    await confirm(t, orderId); // placed at the supplier
    await press(t, 'fo_stkok_' + orderId + '_1');
    expect(soRow(t).divert_to_stock).toBe(1);
    completedOrder(fake);
    t.tg.reset();
    await at(t, iso('09:52'));
    expect(customerGot(t, 'آماده است')).toHaveLength(0);
    expect(events(t, 'diverted_to_stock')).toHaveLength(1);
    expect(q(t.storeDb, 'SELECT status FROM stock_accounts ORDER BY id').map((r) => r.status)).toEqual(['delivered', 'available']);
    expect(adminTexts(t, 'به «اکانت‌های من» اضافه شد')).toHaveLength(1);
    expect(adminTexts(t, 'به «اکانت‌های من» اضافه شد', ADMIN2.id)).toHaveLength(1);
  });
});

describe('✍️ ارسال متن اکانت (fo_text)', () => {
  it('prompt → preview → send: the customer gets <code> text, the order is delivered, the text is kept and shown again under «اشتراک‌های من»', async () => {
    const { t, fake, m1 } = await shop();
    const orderId = await failedOrder(t, fake, m1);
    await press(t, 'fo_text_' + orderId);
    expect(t.tg.texts(ADMIN.id).at(-1)).toContain('اطلاعات اکانت را بنویسید');
    await say(t, 'x'.repeat(3501));
    expect(t.tg.texts(ADMIN.id).at(-1)).toContain('بین ۱ تا ۳٬۵۰۰');
    await say(t, 'user: a@b.c\npass: <123>');
    const preview = t.tg.of('sendMessage', ADMIN.id).at(-1)!.payload;
    expect(preview.text).toContain('<code>user: a@b.c\npass: &lt;123&gt;</code>');
    expect(callbackDataOf(preview)).toEqual(['fo_textok_' + orderId, 'fo_text_' + orderId, 'fo_card_' + orderId]);
    expect(orderRow(t, orderId).status).toBe('confirmed');

    t.tg.reset();
    await press(t, 'fo_textok_' + orderId);
    const msg = customerGot(t, 'آماده است');
    expect(msg).toHaveLength(1);
    expect(msg[0].payload.parse_mode).toBe('HTML');
    expect(msg[0].payload.text).toContain('<code>user: a@b.c\npass: &lt;123&gt;</code>');
    expect(orderRow(t, orderId)).toMatchObject({ status: 'delivered', fulfillment: 'manual_text', cost_toman: null });
    expect(one(t.storeDb, 'SELECT kind, content_json, sent_ok FROM order_deliveries')).toEqual({
      kind: 'manual_text', content_json: JSON.stringify({ text: 'user: a@b.c\npass: <123>' }), sent_ok: 1,
    });
    expect(adminTexts(t, 'متن دستی (Admin)').length).toBeGreaterThan(0);
    expect(adminTexts(t, 'هزینه نامشخص').length).toBeGreaterThan(0);

    // under «📋 اشتراک‌های من» the customer sees the account again
    t.tg.reset();
    await t.send('store', textUpdate(CUSTOMER, '📋 اشتراک‌های من'));
    expect(callbackDataOf(t.tg.of('sendMessage', CUSTOMER.id).at(-1)!.payload)).toContain('acct_show_' + orderId);
    await pressAs(t, CUSTOMER, 'acct_show_' + orderId);
    expect(t.tg.of('sendMessage', CUSTOMER.id).at(-1)!.payload.text).toContain('<code>user: a@b.c\npass: &lt;123&gt;</code>');
  });

  it('✏️ دوباره asks again; a double press of «ارسال» sends once; an expired preview is refused', async () => {
    const { t, fake, m1 } = await shop();
    const orderId = await failedOrder(t, fake, m1);
    await press(t, 'fo_text_' + orderId);
    await say(t, 'first');
    await press(t, 'fo_text_' + orderId);
    await say(t, 'second');
    t.tg.reset();
    await Promise.all([pressAs(t, ADMIN, 'fo_textok_' + orderId), pressAs(t, ADMIN, 'fo_textok_' + orderId)]);
    expect(customerGot(t, 'آماده است')).toHaveLength(1);
    expect(customerGot(t, 'second')).toHaveLength(1);

    // another order: a preview older than 15 minutes
    const other = await failedOrder(t, fake, m1, { id: 2005, first_name: 'Reza' });
    await press(t, 'fo_text_' + other);
    await say(t, 'late');
    t.deps.now = () => new Date(iso('11:00'));
    await press(t, 'fo_textok_' + other);
    expect(t.tg.of('answerCallbackQuery').at(-1)!.payload.text).toContain('مهلت تمام شد');
    expect(orderRow(t, other).status).toBe('confirmed');
  });

  it('two admins sending different texts at once: only one reaches the customer', async () => {
    const { t, fake, m1 } = await shop();
    const orderId = await failedOrder(t, fake, m1);
    await press(t, 'fo_text_' + orderId);
    await say(t, 'from admin one');
    await pressAs(t, ADMIN2, 'fo_text_' + orderId);
    await sayAs(t, ADMIN2, 'from admin two');
    t.tg.reset();
    await Promise.all([pressAs(t, ADMIN, 'fo_textok_' + orderId), pressAs(t, ADMIN2, 'fo_textok_' + orderId)]);
    expect(customerGot(t, 'آماده است')).toHaveLength(1);
    expect(one(t.storeDb, 'SELECT COUNT(*) n FROM order_deliveries').n).toBe(1);
  });
});

describe('💵 the cost after a manual delivery (§8.4)', () => {
  it('asks after fo_text; a number sets orders.cost_toman and logs cost_set; a bad value asks again; ⏭ skips', async () => {
    const { t, fake, m1 } = await shop();
    const orderId = await failedOrder(t, fake, m1);
    await press(t, 'fo_text_' + orderId);
    await say(t, 'acct');
    await press(t, 'fo_textok_' + orderId);
    const ask = t.tg.of('sendMessage', ADMIN.id).at(-1)!.payload;
    expect(ask.text).toContain('هزینه‌ی خرید این اکانت چند تومان بود؟ (برای گزارش سود)');
    expect(callbackDataOf(ask)).toEqual(['fo_costskip_' + orderId]);
    await say(t, 'abc');
    expect(t.tg.texts(ADMIN.id).at(-1)).toContain('عدد صحیح بین ۰ تا');
    await say(t, '2000000000');
    expect(t.tg.texts(ADMIN.id).at(-1)).toContain('عدد صحیح بین ۰ تا');
    await say(t, '۴۵۰٬۰۰۰');
    expect(orderRow(t, orderId).cost_toman).toBe(450000);
    expect(events(t, 'cost_set')[0]).toMatchObject({ actor: ADMIN.id, detail: '450000' });

    // skipping leaves the cost empty and closes the prompt
    const other = await failedOrder(t, fake, m1, { id: 2005, first_name: 'Reza' });
    await press(t, 'fo_text_' + other);
    await say(t, 'acct2');
    await press(t, 'fo_textok_' + other);
    await press(t, 'fo_costskip_' + other);
    await say(t, '123');
    expect(orderRow(t, other).cost_toman).toBeNull();
    expect(t.tg.texts(ADMIN.id).at(-1)).toContain('این پیام با هیچ عملیاتی مطابقت نداشت');
  });
});

describe('🙋 خودم تحویل می‌دهم (fo_self / fo_done / fo_undo)', () => {
  it('self → the waiting supplier order is cancelled; ✅ تحویل شد sends COMPLETION_TEXT, starts the clocks, tells the admins and asks the cost', async () => {
    const { t, fake, sid, m1 } = await shop();
    fake.state.postQueue.push({ status: 409, body: { detail: 'x' } });
    const orderId = await buy(t, m1);
    await confirm(t, orderId); // the only source is out of stock → waits
    expect(soRow(t).status).toBe('queued');
    expect(sid).toBeGreaterThan(0);

    await press(t, 'fo_self_' + orderId);
    expect(orderRow(t, orderId)).toMatchObject({ status: 'confirmed', fulfillment: 'manual_outside', needs_action_reason: null });
    expect(soRow(t).status).toBe('cancelled');
    const card = lastEdit(t);
    expect(card.text).toContain('🙋 تحویل دستی توسط Admin');
    expect(card.text).toContain('«✅ تحویل شد»');
    expect(callbackDataOf(card)).toEqual(['fo_done_' + orderId, 'fo_msg_' + orderId, 'fo_undo_' + orderId, 'fo_cancel_' + orderId, 'fo_hist_' + orderId]);
    await at(t, iso('10:30')); // the cancelled order never buys
    expect(posts(fake)).toHaveLength(1);

    t.tg.reset();
    await press(t, 'fo_done_' + orderId);
    expect(t.tg.texts(CUSTOMER.id)).toEqual([COMPLETION_TEXT]);
    const o = orderRow(t, orderId);
    expect(o).toMatchObject({ status: 'delivered', fulfillment: 'manual_outside' });
    expect(o.delivered_at).toBeTruthy();
    expect(o.expires_at).toBeTruthy();
    expect(o.warranty_expires_at).toBeTruthy();
    expect(events(t, 'admin_done')).toHaveLength(1);
    expect(adminTexts(t, '🙋 تحویل دستی (Admin)').length).toBeGreaterThan(0);
    expect(t.tg.texts(ADMIN.id).at(-1)).toContain('هزینه‌ی خرید این اکانت چند تومان بود؟');
    await say(t, '500000');
    expect(orderRow(t, orderId).cost_toman).toBe(500000);

    // a second press does nothing more
    t.tg.reset();
    await press(t, 'fo_done_' + orderId);
    expect(t.tg.texts(CUSTOMER.id)).toHaveLength(0);
  });

  it('↩️ undo (nothing delivered yet) goes back to automatic delivery with a new purchase', async () => {
    const { t, fake, m1 } = await shop();
    fake.state.postQueue.push({ status: 409, body: { detail: 'x' } });
    const orderId = await buy(t, m1);
    await confirm(t, orderId);
    await press(t, 'fo_self_' + orderId);
    expect(posts(fake)).toHaveLength(1);
    t.deps.now = () => new Date(iso('10:30')); // the source rested after its 409 (30 minutes)
    await press(t, 'fo_undo_' + orderId);
    expect(orderRow(t, orderId)).toMatchObject({ fulfillment: 'supplier', stalled_alert_sent: 0 });
    expect(posts(fake)).toHaveLength(2);
    expect(soRow(t, 2)).toMatchObject({ status: 'placed', requested_by: ADMIN.id });
    expect(events(t, 'admin_undo')).toHaveLength(1);
    // delivered by the supplier now
    completedOrder(fake, '5001');
    await at(t, iso('10:32'));
    expect(orderRow(t, orderId)).toMatchObject({ status: 'delivered', fulfillment: 'supplier' });
  });

  it('↩️ undo while the supplier order is still running: it gets its accounts back, no second purchase', async () => {
    const { t, fake, m1 } = await shop();
    const orderId = await buy(t, m1);
    await confirm(t, orderId); // placed
    await press(t, 'fo_self_' + orderId);
    expect(soRow(t).divert_to_stock).toBe(1);
    await press(t, 'fo_undo_' + orderId);
    expect(soRow(t).divert_to_stock).toBe(0);
    expect(posts(fake)).toHaveLength(1);
    expect(one(t.storeDb, 'SELECT COUNT(*) n FROM supplier_orders').n).toBe(1);
    completedOrder(fake);
    await at(t, iso('09:52'));
    expect(orderRow(t, orderId)).toMatchObject({ status: 'delivered', fulfillment: 'supplier' });
    expect(customerGot(t, 'آماده است')).toHaveLength(1);
  });

  it('no undo once something was delivered to the customer; a supplier order that completes after «تحویل شد» goes to stock', async () => {
    const { t, fake, m1 } = await shop();
    const orderId = await buy(t, m1);
    await confirm(t, orderId); // placed
    await press(t, 'fo_self_' + orderId);
    await press(t, 'fo_done_' + orderId);
    await press(t, 'fo_undo_' + orderId);
    expect(t.tg.of('answerCallbackQuery').at(-1)!.payload.text).toContain('قبلاً تصمیم گرفته شد');
    expect(orderRow(t, orderId).fulfillment).toBe('manual_outside');

    // the supplier's account arrives later: the customer gets nothing more, the account is stock
    completedOrder(fake);
    t.tg.reset();
    await at(t, iso('09:52'));
    expect(t.tg.texts(CUSTOMER.id)).toHaveLength(0);
    expect(one(t.storeDb, 'SELECT COUNT(*) n FROM stock_accounts WHERE status = \'available\'').n).toBe(1);
    expect(one(t.storeDb, 'SELECT title FROM stock_batches').title).toContain('برگشتی از سفارش #' + orderId);
    expect(events(t, 'diverted_to_stock')).toHaveLength(1);
    expect(soRow(t).status).toBe('completed');
    expect(orderRow(t, orderId).status).toBe('delivered');
    expect(adminTexts(t, 'قبلاً تعیین‌تکلیف شده بود')).toHaveLength(1);
    expect(adminTexts(t, 'قبلاً تعیین‌تکلیف شده بود', ADMIN2.id)).toHaveLength(1);
  });

  it('refused from other states: a delivered order, an order that is not manual, a stranger', async () => {
    const { t, fake, m1 } = await shop();
    const orderId = await failedOrder(t, fake, m1);
    await press(t, 'fo_done_' + orderId); // not in manual delivery
    expect(t.tg.of('answerCallbackQuery').at(-1)!.payload.text).toContain('قبلاً تصمیم گرفته شد');
    await press(t, 'fo_undo_' + orderId);
    expect(t.tg.of('answerCallbackQuery').at(-1)!.payload.text).toContain('قبلاً تصمیم گرفته شد');
    await pressAs(t, CUSTOMER, 'fo_self_' + orderId);
    expect(t.tg.of('answerCallbackQuery').at(-1)!.payload.text).toContain('دسترسی ندارید');
    expect(orderRow(t, orderId).fulfillment).toBe('supplier');
    // two admins pressing «خودم تحویل می‌دهم» together: one wins
    await Promise.all([pressAs(t, ADMIN, 'fo_self_' + orderId), pressAs(t, ADMIN2, 'fo_self_' + orderId)]);
    expect(events(t, 'admin_self').length).toBeGreaterThanOrEqual(1);
    expect(orderRow(t, orderId).fulfillment).toBe('manual_outside');
  });
});

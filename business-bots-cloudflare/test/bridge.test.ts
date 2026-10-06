import { describe, expect, it } from 'vitest';
import { ADMIN, ADMIN2, MONSHI_TOKEN, OWNER, STORE_TOKEN, makeTestEnv, type TestEnv } from './helpers/env';
import { callbackUpdate, photoUpdate, textUpdate } from './helpers/updates';
import { one, q, seedProduct } from './helpers/seed';
import { connect } from './helpers/monshi';
import { COMPLETION_TEXT as STORE_COMPLETION, PREPARING_TEXT as STORE_PREPARING } from '../src/store/bridgeHandlers';
import { COMPLETION_TEXT as MONSHI_COMPLETION, PREPARING_TEXT as MONSHI_PREPARING } from '../src/monshi/handlers/bridge';

const CUSTOMER = { id: 2002, first_name: 'Ali', username: 'ali_user' };

/** Customer buys a product and the receipt waits for the admin. */
async function purchase(t: TestEnv, opts: { supportChat?: boolean } = {}) {
  const pid = seedProduct(t, { name: 'GPT Plus', duration: 30, warranty: 7 });
  if (opts.supportChat !== false) {
    q(t.monshiDb, "INSERT INTO customers (chat_id, telegram_user_id, first_name) VALUES (?, ?, 'Ali')", CUSTOMER.id, CUSTOMER.id);
  }
  await t.send('store', textUpdate(CUSTOMER, '/start'));
  await t.send('store', callbackUpdate(CUSTOMER, 'cust_prod_' + pid));
  await t.send('store', callbackUpdate(CUSTOMER, 'cust_disc_skip_' + pid));
  await t.send('store', callbackUpdate(CUSTOMER, 'cust_agree_' + pid));
  await t.send('store', photoUpdate(CUSTOMER));
  t.tg.reset();
}

const confirm = (t: TestEnv) => t.send('store', callbackUpdate(ADMIN, 'order_confirm_1', { caption: 'CAP', chatId: ADMIN.id }));
const pressDelivered = (t: TestEnv, user: { id: number }, orderId = 1) =>
  t.send('monshi', callbackUpdate(user, 'orddlv:' + orderId, { chatId: CUSTOMER.id, message_id: 555, text: MONSHI_PREPARING }));

describe('bridge: store ⇄ monshi order flow', () => {
  it('the customer-facing texts are identical on both sides', () => {
    expect(STORE_PREPARING).toBe(MONSHI_PREPARING);
    expect(STORE_COMPLETION).toBe(MONSHI_COMPLETION);
  });

  it('confirm → monshi sends «preparing» from the support account (with the delivery button) → admin delivers → store clock starts', async () => {
    const t = makeTestEnv();
    await connect(t);
    await purchase(t);

    await confirm(t);
    const sends = t.tg.of('sendMessage').filter((c) => c.payload.chat_id === CUSTOMER.id);
    expect(sends.map((c) => c.token)).toEqual([STORE_TOKEN, MONSHI_TOKEN]); // store's «confirmed» first, then support's «preparing»
    expect(sends[0].payload.text).toContain('✅ پرداخت شما تایید شد!');
    expect(sends[1].payload).toMatchObject({ text: MONSHI_PREPARING, business_connection_id: 'bc1' });
    expect(sends[1].payload.reply_markup.inline_keyboard[0][0]).toEqual({ text: '✅ تحویل شد', callback_data: 'orddlv:1' });
    expect(t.tg.of('sendChecklist')).toHaveLength(1);
    expect(t.tg.of('sendChecklist')[0].payload).toMatchObject({ business_connection_id: 'bc1', chat_id: CUSTOMER.id });
    expect(t.tg.of('sendChecklist')[0].payload.checklist.tasks.map((x: any) => x.text)).toEqual(['✅ ثبت سفارش', '✅ تایید پرداخت', '🔄 آماده‌سازی اکانت', '⚪ تحویل']);
    expect(one(t.monshiDb, 'SELECT status, external_order_id, chat_id FROM orders')).toEqual({ status: 'provisioning', external_order_id: 1, chat_id: CUSTOMER.id });
    expect(one(t.storeDb, 'SELECT status, delivered_at FROM orders')).toEqual({ status: 'confirmed', delivered_at: null });

    // a non-admin cannot press the button
    await pressDelivered(t, CUSTOMER);
    expect(t.tg.of('answerCallbackQuery').at(-1)!.payload).toMatchObject({ text: 'این دکمه مخصوص ادمین فروشگاه است 🙂', show_alert: true });
    expect(one(t.monshiDb, 'SELECT status FROM orders').status).toBe('provisioning');

    t.tg.reset();
    await pressDelivered(t, OWNER);
    expect(t.tg.of('sendMessage', CUSTOMER.id).map((c) => c.payload)).toEqual([{ chat_id: CUSTOMER.id, text: MONSHI_COMPLETION, business_connection_id: 'bc1' }]);
    expect(t.tg.of('editMessageReplyMarkup')[0].payload).toMatchObject({ chat_id: CUSTOMER.id, message_id: 555, business_connection_id: 'bc1' });
    expect(t.tg.of('editMessageChecklist')).toHaveLength(1);
    expect(one(t.monshiDb, 'SELECT status FROM orders').status).toBe('delivered');
    const order = one(t.storeDb, 'SELECT status, delivered_at, expires_at, warranty_expires_at FROM orders');
    expect(order.status).toBe('delivered');
    expect(order.delivered_at).toBeTruthy();
    expect(order.expires_at).toBeTruthy();
    expect(order.warranty_expires_at).toBeTruthy();

    // pressing it again is harmless
    t.tg.reset();
    await pressDelivered(t, OWNER);
    expect(t.tg.of('answerCallbackQuery').at(-1)!.payload.text).toBe('ℹ️ قبلاً تحویل ثبت شده.');
    expect(t.tg.of('sendMessage', CUSTOMER.id)).toHaveLength(0);
  });

  it('delivering from the /orders panel (last step) behaves like the button', async () => {
    const t = makeTestEnv();
    await connect(t);
    await purchase(t);
    await confirm(t);
    t.tg.reset();
    await t.send('monshi', callbackUpdate(OWNER, 'ord_next:1'));
    expect(one(t.monshiDb, 'SELECT status FROM orders').status).toBe('delivered');
    expect(t.tg.texts(CUSTOMER.id)).toEqual([MONSHI_COMPLETION]);
    expect(one(t.storeDb, 'SELECT status FROM orders').status).toBe('delivered');
  });

  it('duplicate confirm taps never register a second monshi order', async () => {
    const t = makeTestEnv();
    await connect(t);
    await purchase(t);
    await confirm(t);
    await t.send('store', callbackUpdate(ADMIN2, 'order_confirm_1', { caption: 'CAP', chatId: ADMIN2.id }));
    expect(q(t.monshiDb, 'SELECT * FROM orders')).toHaveLength(1);
    expect(t.tg.of('sendMessage').filter((c) => c.payload.text === MONSHI_PREPARING)).toHaveLength(1);
  });
});

describe('bridge: fallback when the support account cannot reach the customer', () => {
  async function failedFlow(setup: (t: TestEnv) => void | Promise<void>, supportChat = false) {
    const t = makeTestEnv();
    await setup(t);
    await purchase(t, { supportChat });
    await confirm(t);
    return t;
  }

  it('no support chat → store sends «preparing» itself, admins get a notice with a manual delivery button → delivery completes the order', async () => {
    const t = await failedFlow(async (t) => { await connect(t); });
    const toCustomer = t.tg.of('sendMessage', CUSTOMER.id);
    expect(toCustomer.map((c) => c.token)).toEqual([STORE_TOKEN, STORE_TOKEN]);
    expect(toCustomer[1].payload.text).toBe(STORE_PREPARING);
    const notices = t.tg.of('sendMessage').filter((c) => c.payload.text?.includes('از طریق حساب پشتیبانی ارسال نشد'));
    expect(notices.map((c) => c.payload.chat_id)).toEqual([ADMIN.id, ADMIN2.id]);
    expect(notices[0].payload.text).toContain('دلیل: no\\_support\\_chat');
    expect(notices[0].payload.reply_markup.inline_keyboard[0][0].callback_data).toBe('order_deliver_1');
    expect(one(t.storeDb, 'SELECT paid_failed_handled FROM orders').paid_failed_handled).toBe(1);
    expect(q(t.monshiDb, 'SELECT * FROM orders')).toHaveLength(0);

    t.tg.reset();
    await t.send('store', callbackUpdate(ADMIN, 'order_deliver_1', { text: 'notice', chatId: ADMIN.id }));
    expect(t.tg.texts(CUSTOMER.id)).toEqual([STORE_COMPLETION]);
    expect(one(t.storeDb, 'SELECT status, expires_at FROM orders').status).toBe('delivered');
    expect(t.tg.of('editMessageText').at(-1)!.payload.text).toContain('✅ تحویل شد و به مشتری اطلاع داده شد.');

    t.tg.reset();
    await t.send('store', callbackUpdate(ADMIN2, 'order_deliver_1', { text: 'notice', chatId: ADMIN2.id }));
    expect(t.tg.of('answerCallbackQuery').at(-1)!.payload.text).toBe('ℹ️ قبلاً تحویل شده.');
    expect(t.tg.of('sendMessage')).toHaveLength(0);
  });

  it('a non-admin cannot use the manual delivery button', async () => {
    const t = await failedFlow(async (t) => { await connect(t); });
    await t.send('store', callbackUpdate(CUSTOMER, 'order_deliver_1', { text: 'x' }));
    expect(one(t.storeDb, 'SELECT status FROM orders').status).toBe('confirmed');
  });

  it('no business connection → fallback with reason no_business_connection', async () => {
    const t = await failedFlow(() => {}, true);
    const notice = t.tg.of('sendMessage').find((c) => c.payload.text?.includes('از طریق حساب پشتیبانی ارسال نشد'))!;
    expect(notice.payload.text).toContain('no\\_business\\_connection');
    expect(t.tg.texts(CUSTOMER.id).filter((x) => x === STORE_PREPARING)).toHaveLength(1);
  });

  it('send error from the support account → monshi order cancelled, store fallback used', async () => {
    const t = makeTestEnv();
    await connect(t);
    t.tg.fail('sendMessage', (c) => c.token === MONSHI_TOKEN && c.payload.business_connection_id === 'bc1', 400, 'Bad Request: chat not found');
    await purchase(t);
    await confirm(t);
    expect(one(t.monshiDb, 'SELECT status FROM orders').status).toBe('cancelled');
    const notice = t.tg.of('sendMessage').find((c) => c.payload.text?.includes('از طریق حساب پشتیبانی ارسال نشد'))!;
    expect(notice.payload.text).toContain('send\\_failed');
    expect(t.tg.texts(CUSTOMER.id)).toContain(STORE_PREPARING);
  });
});

describe('bridge: monshi bot disabled', () => {
  it('confirm still works; there is no bridge and no fallback', async () => {
    const t = makeTestEnv({ monshi: false });
    await purchase(t);
    await confirm(t);
    expect(one(t.storeDb, 'SELECT status FROM orders').status).toBe('confirmed');
    expect(t.tg.calls.some((c) => c.token === MONSHI_TOKEN)).toBe(false);
    expect(t.tg.texts(CUSTOMER.id)).toHaveLength(1);
    expect(t.tg.texts(CUSTOMER.id)[0]).toContain('✅ پرداخت شما تایید شد!');
    expect(t.tg.of('sendMessage').filter((c) => c.payload.text?.includes('حساب پشتیبانی'))).toHaveLength(0);
  });

  it('store disabled: delivering a monshi order does not crash', async () => {
    const t = makeTestEnv({ store: false });
    await connect(t);
    q(t.monshiDb, "INSERT INTO customers (chat_id, first_name) VALUES (?, 'Ali')", CUSTOMER.id);
    q(t.monshiDb, "INSERT INTO orders (chat_id, title, status, business_connection_id, external_order_id) VALUES (?, 'T', 'provisioning', 'bc1', 77)", CUSTOMER.id);
    await pressDelivered(t, OWNER);
    expect(one(t.monshiDb, 'SELECT status FROM orders').status).toBe('delivered');
  });
});

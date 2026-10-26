import { describe, expect, it } from 'vitest';
import { ADMIN, ADMIN2, budgets, MONSHI_TOKEN } from '../helpers/env';
import { callbackUpdate, textUpdate } from '../helpers/updates';
import { one, q } from '../helpers/seed';
import { formatPrice } from '../../src/store/utils';
import { SUPPLIER_CONFIRM_TEXT } from '../../src/store/labels';
import { at, callbackDataOf } from './helpers';
import { buy, completedOrder, confirm, CUSTOMER, events, iso, NO_NAME, orderRow, posts, shop, soRow } from './engineHelpers';
import { connect } from '../helpers/monshi';
import { seedProduct } from '../helpers/seed';

describe('S5 happy path (§7.2–§7.5)', () => {
  it('confirm → placed inline → poll → completed → customer gets the HTML → order delivered with cost and clocks', async () => {
    const { t, fake, m1 } = await shop();
    const orderId = await buy(t, m1);
    t.tg.reset();
    await confirm(t, orderId);

    // the customer is told it is being prepared, with the supplier text (not the activation-contact text)
    expect(t.tg.texts(CUSTOMER.id)).toEqual([SUPPLIER_CONFIRM_TEXT('ChatGPT — ۱ ماهه')]);
    expect(t.tg.texts(CUSTOMER.id)[0]).not.toContain('@maiposhtibani');
    // the receipt caption notes the automatic delivery
    expect(t.tg.of('editMessageCaption').at(-1)!.payload.caption).toContain('🔌 تحویل خودکار از تأمین‌کننده');
    // exactly one POST, placed inline; the order is a supplier order with a 20 h deadline
    expect(posts(fake)).toHaveLength(1);
    expect(posts(fake)[0].body).toEqual({ product_id: '1300', quantity: 1, user_id: 42, note: 'store#' + orderId + '/so#1' });
    expect(soRow(t)).toMatchObject({ status: 'placed', remote_order_id: '5001', price_usd: 5.28, usd_toman: 150000, cost_toman: 792000, purpose: 'customer' });
    expect(orderRow(t, orderId)).toMatchObject({ status: 'confirmed', fulfillment: 'supplier', customer_username: 'ali_user' });
    expect(orderRow(t, orderId).supplier_deadline_at).toBeTruthy();
    // the wallet ledger got the spend
    expect(one(t.storeDb, "SELECT amount_usd, supplier_order_id FROM wallet_ledger WHERE kind = 'spend'")).toEqual({ amount_usd: -5.28, supplier_order_id: 1 });
    // the webhook confirm stayed within the budget
    expect(Math.max(...budgets.map((b) => b.used))).toBeLessThanOrEqual(35);

    // the supplier finishes; the next cron minute polls and delivers
    completedOrder(fake);
    t.tg.reset();
    await at(t, iso('09:52'));
    const sent = t.tg.of('sendMessage', CUSTOMER.id).map((c) => c.payload);
    expect(sent).toHaveLength(1);
    expect(sent[0].parse_mode).toBe('HTML');
    expect(sent[0].text).toContain('🎉 سفارش «ChatGPT — ۱ ماهه» آماده است!');
    expect(sent[0].text).toContain('👤 نام کاربری: <code>a@b.c</code>');
    expect(sent[0].text).toContain('🔑 رمز عبور: <code>p&lt;w&gt;d</code>'); // a < in a password can't break the message
    expect(sent[0].text).toContain('🔗 لینک فعال‌سازی: https://x.test/a'); // links stay plain, so they stay clickable
    expect(sent[0].text).toContain('📋 اشتراک‌های من');

    const o = orderRow(t, orderId);
    expect(o).toMatchObject({ status: 'delivered', fulfillment: 'supplier', cost_toman: 792000, needs_action_reason: null });
    expect(o.delivered_at).toBeTruthy();
    expect(o.expires_at).toBeTruthy(); // the subscription clock started
    expect(o.warranty_expires_at).toBeTruthy();
    expect(soRow(t)).toMatchObject({ status: 'completed', next_check_at: null });
    expect(one(t.storeDb, 'SELECT kind, sent_ok, supplier_order_id FROM order_deliveries')).toEqual({ kind: 'supplier', sent_ok: 1, supplier_order_id: 1 });
    expect(events(t, 'delivered')).toHaveLength(1);
    expect(posts(fake)).toHaveLength(1);

    // the admin message: customer ref, source, money, buttons
    for (const admin of [ADMIN.id, ADMIN2.id]) {
      const msg = t.tg.of('sendMessage', admin).map((c) => c.payload).find((p) => p.text.includes('تحویل شد'))!;
      expect(msg.parse_mode).toBe('HTML');
      expect(msg.text).toContain('(@ali_user)');
      expect(msg.text).toContain('<code>2002</code>');
      expect(msg.text).toContain('🔌 منبع: ArioBox Main (سفارش #5001)');
      const price = one(t.storeDb, 'SELECT price FROM orders').price;
      expect(msg.text).toContain('💰 فروش: ' + formatPrice(price) + ' ت | خرید: ' + formatPrice(792000) + ' ت | سود: ' + formatPrice(price - 792000) + ' ت');
      expect(callbackDataOf(msg)).toEqual(['fo_view_' + orderId, 'fo_msg_' + orderId]);
      expect(msg.reply_markup.inline_keyboard[1][0].url).toBe('https://t.me/ali_user');
    }
  });

  it('a customer without a username: tg://user button; BUTTON_USER_PRIVACY_RESTRICTED is retried once without it', async () => {
    const { t, fake, m1 } = await shop();
    const orderId = await buy(t, m1, NO_NAME);
    await confirm(t, orderId);
    completedOrder(fake);
    // admin 1's privacy settings... the customer's: Telegram refuses the tg://user button
    t.tg.fail('sendMessage', (c) => c.payload.chat_id === ADMIN.id && JSON.stringify(c.payload.reply_markup ?? {}).includes('tg://user'),
      400, 'Bad Request: BUTTON_USER_PRIVACY_RESTRICTED');
    t.tg.reset();
    await at(t, iso('09:52'));
    const toAdmin = t.tg.of('sendMessage', ADMIN.id).map((c) => c.payload).filter((p) => p.text.includes('تحویل شد'));
    expect(toAdmin).toHaveLength(2); // refused once, then resent
    expect(JSON.stringify(toAdmin[0].reply_markup)).toContain('tg://user?id=' + NO_NAME.id);
    expect(JSON.stringify(toAdmin[1].reply_markup)).not.toContain('tg://user');
    expect(callbackDataOf(toAdmin[1])).toEqual(['fo_view_' + orderId, 'fo_msg_' + orderId]); // ✉️ still there
    // the other admin got the chat button
    const other = t.tg.of('sendMessage', ADMIN2.id).map((c) => c.payload).find((p) => p.text.includes('تحویل شد'))!;
    expect(other.reply_markup.inline_keyboard[1][0].url).toBe('tg://user?id=' + NO_NAME.id);
    expect(other.text).not.toContain('(@');
    expect(orderRow(t, orderId).status).toBe('delivered');
  });

  it('monshi is NOT called for a supplier order and IS still called for a normal one', async () => {
    const { t, fake, m1 } = await shop({ monshi: true });
    await connect(t);
    q(t.monshiDb, "INSERT INTO customers (chat_id, telegram_user_id, first_name) VALUES (?, ?, 'Ali')", CUSTOMER.id, CUSTOMER.id);
    const normal = seedProduct(t, { name: 'Plain', price: 100000 });

    const supplierOrder = await buy(t, m1);
    t.tg.reset();
    await confirm(t, supplierOrder);
    expect(t.tg.calls.filter((c) => c.token === MONSHI_TOKEN)).toHaveLength(0);
    expect(one(t.monshiDb, 'SELECT COUNT(*) n FROM orders').n).toBe(0);
    expect(one(t.storeDb, 'SELECT paid_failed_handled FROM orders WHERE id = ?', supplierOrder).paid_failed_handled).toBe(0);

    const plainOrder = await buy(t, normal);
    t.tg.reset();
    await confirm(t, plainOrder);
    expect(t.tg.calls.filter((c) => c.token === MONSHI_TOKEN).length).toBeGreaterThan(0);
    expect(one(t.monshiDb, 'SELECT external_order_id FROM orders').external_order_id).toBe(plainOrder);
    expect(orderRow(t, plainOrder).fulfillment).toBeNull();
    expect(one(t.storeDb, 'SELECT COUNT(*) n FROM supplier_orders').n).toBe(1);
    expect(posts(fake)).toHaveLength(1);
  });
});

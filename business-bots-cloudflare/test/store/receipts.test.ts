import { describe, expect, it } from 'vitest';
import { ADMIN, ADMIN2, makeTestEnv, type TestEnv } from '../helpers/env';
import { callbackUpdate, documentUpdate, photoUpdate, textUpdate } from '../helpers/updates';
import { one, q, seedCard, seedProduct } from '../helpers/seed';
import { REJECT_REASONS } from '../../src/store/labels';

const CUSTOMER = { id: 2002, first_name: 'Ali', username: 'ali_user' };
const OTHER = { id: 2003, first_name: 'Sara' };

async function buy(t: TestEnv, pid: number, user: { id: number; first_name: string; username?: string } = CUSTOMER, file = 'photo-large') {
  await t.send('store', textUpdate(user, '/start'));
  await t.send('store', callbackUpdate(user, 'cust_prod_' + pid));
  await t.send('store', callbackUpdate(user, 'cust_disc_skip_' + pid));
  await t.send('store', callbackUpdate(user, 'cust_agree_' + pid));
  await t.send('store', photoUpdate(user, file));
}
const rejectBtn = (id: number, admin = ADMIN) => callbackUpdate(admin, 'order_reject_' + id, { caption: 'CAP', chatId: admin.id, message_id: 77 });
const reasonBtn = (id: number, code: string, admin = ADMIN) => callbackUpdate(admin, `order_rejr_${id}_${code}`, { caption: 'CAP', chatId: admin.id, message_id: 77 });

describe('reject reasons', () => {
  it('pressing ❌ only shows the reason keyboard — the order stays pending', async () => {
    const t = makeTestEnv({ monshi: false });
    const pid = seedProduct(t);
    await buy(t, pid);
    await t.send('store', rejectBtn(1));
    expect(one(t.storeDb, 'SELECT status FROM orders').status).toBe('pending');
    const kb = t.tg.of('editMessageReplyMarkup').at(-1)!.payload.reply_markup.inline_keyboard.flat().map((b: any) => b.callback_data);
    expect(kb).toEqual(expect.arrayContaining(['order_rejr_1_amount', 'order_rejr_1_custom', 'order_rejr_1_none', 'order_rejr_1_back']));
    expect(kb).toHaveLength(REJECT_REASONS.length + 3);
  });

  for (const r of REJECT_REASONS) {
    it(`reason ${r.code}: customer text, caption and column`, async () => {
      const t = makeTestEnv({ monshi: false });
      const pid = seedProduct(t);
      await buy(t, pid);
      await t.send('store', reasonBtn(1, r.code));
      expect(one(t.storeDb, 'SELECT status, reject_reason FROM orders')).toEqual({ status: 'rejected', reject_reason: r.text });
      expect(t.tg.of('editMessageCaption').at(-1)!.payload.caption).toBe('CAP\n\n❌ رد شد (توسط ادمین).\n📝 دلیل: ' + r.text);
      const msg = t.tg.of('sendMessage', CUSTOMER.id).at(-1)!.payload;
      expect(msg.text).toContain('📝 دلیل: ' + r.text);
      const hasReupload = !!msg.reply_markup;
      expect(hasReupload).toBe(r.code !== 'duplicate');
    });
  }

  it('back restores the confirm/reject keyboard', async () => {
    const t = makeTestEnv({ monshi: false });
    const pid = seedProduct(t);
    await buy(t, pid);
    await t.send('store', rejectBtn(1));
    await t.send('store', reasonBtn(1, 'back'));
    const kb = t.tg.of('editMessageReplyMarkup').at(-1)!.payload.reply_markup.inline_keyboard[0].map((b: any) => b.callback_data);
    expect(kb).toEqual(['order_confirm_1', 'order_reject_1']);
  });

  it('custom reason: the next admin text is the reason (cut to 200 chars) and edits the original receipt', async () => {
    const t = makeTestEnv({ monshi: false });
    const pid = seedProduct(t);
    await buy(t, pid);
    await t.send('store', reasonBtn(1, 'custom'));
    expect(t.tg.texts(ADMIN.id).at(-1)).toContain('دلیل رد سفارش #1');
    expect(one(t.storeDb, 'SELECT status FROM orders').status).toBe('pending');
    await t.send('store', textUpdate(ADMIN, 'x'.repeat(300)));
    const row = one(t.storeDb, 'SELECT status, reject_reason FROM orders');
    expect(row.status).toBe('rejected');
    expect(row.reject_reason).toHaveLength(200);
    const edit = t.tg.of('editMessageCaption').at(-1)!.payload;
    expect(edit).toMatchObject({ chat_id: ADMIN.id, message_id: 77 });
    expect(edit.caption).toContain('❌ رد شد');
    expect(t.tg.texts(CUSTOMER.id).at(-1)).toContain('📝 دلیل: ' + 'x'.repeat(200));
    // the state is cleared: the next text is just the admin fallback
    await t.send('store', textUpdate(ADMIN, 'hello'));
    expect(t.tg.texts(ADMIN.id).at(-1)).toContain('هیچ عملیاتی مطابقت نداشت');
  });

  it('custom reason: a second admin deciding meanwhile wins; the typed reason is not applied', async () => {
    const t = makeTestEnv({ monshi: false });
    const pid = seedProduct(t);
    await buy(t, pid);
    await t.send('store', reasonBtn(1, 'custom'));
    await t.send('store', callbackUpdate(ADMIN2, 'order_confirm_1', { caption: 'CAP', chatId: ADMIN2.id }));
    await t.send('store', textUpdate(ADMIN, 'too late'));
    expect(one(t.storeDb, 'SELECT status, reject_reason FROM orders')).toEqual({ status: 'confirmed', reject_reason: null });
    expect(t.tg.texts(ADMIN.id).at(-1)).toContain('قبلاً بررسی شده');
    expect(t.tg.texts(CUSTOMER.id).join('\n')).not.toContain('too late');
  });

  it('custom reason: /cancel and a panel button abandon the input', async () => {
    const t = makeTestEnv({ monshi: false });
    const pid = seedProduct(t);
    await buy(t, pid);
    await t.send('store', reasonBtn(1, 'custom'));
    await t.send('store', textUpdate(ADMIN, '/cancel'));
    expect(t.tg.texts(ADMIN.id).at(-1)).toContain('رد رسید لغو شد');
    expect(one(t.storeDb, 'SELECT status FROM orders').status).toBe('pending');

    await t.send('store', reasonBtn(1, 'custom'));
    await t.send('store', textUpdate(ADMIN, '💳 شماره کارت')); // a panel button
    await t.send('store', textUpdate(ADMIN, '/cancel'));
    await t.send('store', textUpdate(ADMIN, 'not a reason'));
    expect(one(t.storeDb, 'SELECT status FROM orders').status).toBe('pending');
  });

  it('a non-admin cannot pick a reason', async () => {
    const t = makeTestEnv({ monshi: false });
    const pid = seedProduct(t);
    await buy(t, pid);
    await t.send('store', reasonBtn(1, 'amount', CUSTOMER as any));
    expect(one(t.storeDb, 'SELECT status FROM orders').status).toBe('pending');
  });
});

describe('re-upload after a rejection', () => {
  async function rejected(t: TestEnv, pid: number) {
    await buy(t, pid);
    await t.send('store', reasonBtn(1, 'unreadable'));
  }

  it('creates a new pending order with the same price and discount', async () => {
    const t = makeTestEnv({ monshi: false });
    seedCard(t);
    const pid = seedProduct(t, { price: 500000 });
    q(t.storeDb, "INSERT INTO discount_codes (code, customer_product_id, discount_type, discount_value, expires_at) VALUES ('OFF', ?, 'percent', 20, '2999-01-01 00:00:00')", pid);
    await t.send('store', textUpdate(CUSTOMER, '/start'));
    await t.send('store', callbackUpdate(CUSTOMER, 'cust_prod_' + pid));
    await t.send('store', callbackUpdate(CUSTOMER, 'cust_disc_enter_' + pid));
    await t.send('store', textUpdate(CUSTOMER, 'OFF'));
    await t.send('store', callbackUpdate(CUSTOMER, 'cust_agree_' + pid));
    await t.send('store', photoUpdate(CUSTOMER, 'first'));
    await t.send('store', reasonBtn(1, 'unreadable'));

    await t.send('store', callbackUpdate(CUSTOMER, 'reupload_1'));
    expect(t.tg.texts(CUSTOMER.id).at(-1)).toContain('رسید جدید');
    expect(t.tg.texts(CUSTOMER.id).at(-1)).toContain('6037-1234-1234-1234');
    await t.send('store', photoUpdate(CUSTOMER, 'second'));
    expect(q(t.storeDb, 'SELECT status, price, discount_code_id FROM orders ORDER BY id')).toEqual([
      { status: 'rejected', price: 400000, discount_code_id: 1 },
      { status: 'pending', price: 400000, discount_code_id: 1 },
    ]);
  });

  it('refused for someone else, for a pending order, and for an unavailable product', async () => {
    const t = makeTestEnv({ monshi: false });
    const pid = seedProduct(t);
    await rejected(t, pid);
    await t.send('store', callbackUpdate(OTHER, 'reupload_1'));
    expect(t.tg.of('answerCallbackQuery').at(-1)!.payload.text).toContain('سفارش یافت نشد');

    q(t.storeDb, 'UPDATE customer_products SET is_available = 0 WHERE id = ?', pid);
    await t.send('store', callbackUpdate(CUSTOMER, 'reupload_1'));
    expect(t.tg.of('answerCallbackQuery').at(-1)!.payload.text).toContain('ناموجود');

    q(t.storeDb, 'UPDATE customer_products SET is_available = 1 WHERE id = ?', pid);
    q(t.storeDb, "UPDATE orders SET status = 'pending'");
    await t.send('store', callbackUpdate(CUSTOMER, 'reupload_1'));
    expect(t.tg.of('answerCallbackQuery').at(-1)!.payload.text).toContain('سفارش یافت نشد');
  });
});

describe('duplicate receipt detection', () => {
  it('warns when the same file was used by another order — and never auto-rejects', async () => {
    const t = makeTestEnv({ monshi: false });
    const pid = seedProduct(t);
    await buy(t, pid, CUSTOMER, 'same');
    await buy(t, pid, OTHER, 'same');
    const caps = t.tg.of('copyMessage').map((c) => c.payload.caption as string);
    const second = caps.filter((c) => c.includes('هشدار'));
    expect(second).toHaveLength(2); // two admins got the warning for order #2
    expect(second[0]).toContain('سفارش #1 (در انتظار بررسی، مشتری 2002)');
    expect(q(t.storeDb, 'SELECT status FROM orders').map((r) => r.status)).toEqual(['pending', 'pending']);
  });

  it('no warning for different files; documents count too', async () => {
    const t = makeTestEnv({ monshi: false });
    const pid = seedProduct(t);
    await buy(t, pid, CUSTOMER, 'one');
    await buy(t, pid, OTHER, 'two');
    expect(t.tg.of('copyMessage').filter((c) => c.payload.caption.includes('هشدار'))).toHaveLength(0);

    await t.send('store', callbackUpdate(CUSTOMER, 'cust_agree_' + pid));
    await t.send('store', documentUpdate(CUSTOMER, 'one')); // same unique id as the first photo
    const last = t.tg.of('copyMessage').at(-1)!.payload.caption as string;
    expect(last).toContain('هشدار');
    expect(one(t.storeDb, 'SELECT receipt_unique_id FROM orders WHERE id = 3').receipt_unique_id).toBe('u-one');
  });
});

import { describe, expect, it } from 'vitest';
import { ADMIN, ADMIN2, makeTestEnv } from '../helpers/env';
import { callbackUpdate, documentUpdate, photoUpdate, textUpdate, voiceUpdate } from '../helpers/updates';
import { one, q, seedCard, seedProduct } from '../helpers/seed';

const CUSTOMER = { id: 2002, first_name: 'Ali_[Test]', username: 'ali_user' };

describe('store: /start', () => {
  it('customer /start inserts a customers row and shows the storefront keyboard', async () => {
    const t = makeTestEnv({ monshi: false });
    await t.send('store', textUpdate(CUSTOMER, '/start'));
    expect(q(t.storeDb, 'SELECT * FROM customers')).toHaveLength(1);
    const sent = t.tg.of('sendMessage', CUSTOMER.id)[0];
    expect(sent.payload.text).toContain('سلام!');
    expect(sent.payload.reply_markup.keyboard[0].map((b: any) => b.text)).toEqual(['🛍 لیست محصولات', '📋 اشتراک‌های من']);
  });

  it('admin /start gets the admin keyboard and no customer row', async () => {
    const t = makeTestEnv({ monshi: false });
    await t.send('store', textUpdate(ADMIN, '/start'));
    expect(q(t.storeDb, 'SELECT * FROM customers')).toHaveLength(0);
    const sent = t.tg.of('sendMessage', ADMIN.id)[0];
    expect(sent.payload.text).toContain('سلام مدیر!');
    expect(sent.payload.reply_markup.keyboard).toHaveLength(6);
  });
});

describe('store: purchase flow', () => {
  it('catalog → product → no code → agree → receipt → admins get a copy → order pending', async () => {
    const t = makeTestEnv({ monshi: false });
    const pid = seedProduct(t, { name: 'GPT Plus', price: 500000 });
    seedCard(t);
    await t.send('store', textUpdate(CUSTOMER, '/start'));

    await t.send('store', textUpdate(CUSTOMER, '🛍 لیست محصولات'));
    const catalog = t.tg.of('sendMessage', CUSTOMER.id).at(-1)!;
    expect(catalog.payload.reply_markup.inline_keyboard[0][0].callback_data).toBe('cust_prod_' + pid);

    await t.send('store', callbackUpdate(CUSTOMER, 'cust_prod_' + pid));
    expect(t.tg.of('sendMessage', CUSTOMER.id).at(-1)!.payload.text).toContain('🎟 آیا کد تخفیف دارید؟');

    await t.send('store', callbackUpdate(CUSTOMER, 'cust_disc_skip_' + pid));
    const terms = t.tg.of('sendMessage', CUSTOMER.id).at(-1)!.payload;
    expect(terms.text).toContain('این محصول شرایط خاصی ندارد');

    await t.send('store', callbackUpdate(CUSTOMER, 'cust_agree_' + pid));
    const edit = t.tg.of('editMessageText').at(-1)!.payload;
    expect(edit.text).toContain('6037-1234-1234-1234');

    await t.send('store', photoUpdate(CUSTOMER));
    const copies = t.tg.of('copyMessage');
    expect(copies.map((c) => c.payload.chat_id)).toEqual([ADMIN.id, ADMIN2.id]);
    expect(copies[0].payload.caption).toContain('🧾 رسید پرداخت جدید');
    expect(copies[0].payload.reply_markup.inline_keyboard[0].map((b: any) => b.callback_data)).toEqual(['order_confirm_1', 'order_reject_1']);
    expect(t.tg.texts(CUSTOMER.id).at(-1)).toContain('رسید شما دریافت شد');
    expect(one(t.storeDb, 'SELECT status, receipt_file_id, receipt_type, price FROM orders')).toEqual({ status: 'pending', receipt_file_id: 'photo-large', receipt_type: 'photo', price: 500000 });
  });

  it('partial admin failure still succeeds; total failure rolls back and keeps receipt state', async () => {
    const t = makeTestEnv({ monshi: false });
    const pid = seedProduct(t);
    await t.send('store', textUpdate(CUSTOMER, '/start'));
    await t.send('store', callbackUpdate(CUSTOMER, 'cust_prod_' + pid));
    await t.send('store', callbackUpdate(CUSTOMER, 'cust_disc_skip_' + pid));
    await t.send('store', callbackUpdate(CUSTOMER, 'cust_agree_' + pid));

    t.tg.fail('copyMessage', (c) => c.payload.chat_id === ADMIN.id);
    await t.send('store', photoUpdate(CUSTOMER));
    expect(one(t.storeDb, "SELECT COUNT(*) n FROM orders WHERE status='pending'").n).toBe(1);
    expect(t.tg.texts(CUSTOMER.id).at(-1)).toContain('رسید شما دریافت شد');

    // second purchase, now every admin fails
    q(t.storeDb, "DELETE FROM orders");
    await t.send('store', callbackUpdate(CUSTOMER, 'cust_agree_' + pid));
    t.tg.clearRules();
    t.tg.fail('copyMessage', () => true);
    await t.send('store', photoUpdate(CUSTOMER));
    expect(one(t.storeDb, "SELECT COUNT(*) n FROM orders").n).toBe(0);
    expect(t.tg.texts(CUSTOMER.id).at(-1)).toContain('ارسال نشد');
    // receipt state kept → a retry succeeds
    t.tg.clearRules();
    await t.send('store', photoUpdate(CUSTOMER));
    expect(one(t.storeDb, "SELECT COUNT(*) n FROM orders WHERE status='pending'").n).toBe(1);
  });

  it('document receipts use copyMessage too; text/voice during receipt step are nudged', async () => {
    const t = makeTestEnv({ monshi: false });
    const pid = seedProduct(t);
    await t.send('store', textUpdate(CUSTOMER, '/start'));
    await t.send('store', callbackUpdate(CUSTOMER, 'cust_prod_' + pid));
    await t.send('store', callbackUpdate(CUSTOMER, 'cust_disc_skip_' + pid));
    await t.send('store', callbackUpdate(CUSTOMER, 'cust_agree_' + pid));

    await t.send('store', textUpdate(CUSTOMER, 'hello'));
    expect(t.tg.texts(CUSTOMER.id).at(-1)).toBe('⚠️ لطفاً عکس یا فایل رسید پرداخت را ارسال کنید، نه متن.');
    await t.send('store', voiceUpdate(CUSTOMER));
    expect(t.tg.texts(CUSTOMER.id).at(-1)).toContain('نه نوع دیگری از پیام');

    await t.send('store', documentUpdate(CUSTOMER, 'doc-9'));
    expect(t.tg.of('copyMessage')).toHaveLength(2);
    expect(one(t.storeDb, 'SELECT receipt_type, receipt_file_id FROM orders')).toEqual({ receipt_type: 'document', receipt_file_id: 'doc-9' });
  });

  it('customer chit-chat with no purchase gets the storefront hint', async () => {
    const t = makeTestEnv({ monshi: false });
    await t.send('store', textUpdate(CUSTOMER, 'سلام'));
    expect(t.tg.texts(CUSTOMER.id).at(-1)).toBe('🤖 برای مشاهده محصولات، از دکمه «🛍 لیست محصولات» استفاده کنید.');
  });
});

describe('store: stale receipt state', () => {
  async function agreed(t: ReturnType<typeof makeTestEnv>) {
    const pid = seedProduct(t);
    await t.send('store', textUpdate(CUSTOMER, '/start'));
    await t.send('store', callbackUpdate(CUSTOMER, 'cust_prod_' + pid));
    await t.send('store', callbackUpdate(CUSTOMER, 'cust_disc_skip_' + pid));
    await t.send('store', callbackUpdate(CUSTOMER, 'cust_agree_' + pid));
    return pid;
  }
  const ageDraft = (t: ReturnType<typeof makeTestEnv>, ms: number) => {
    const row = one(t.storeDb, 'SELECT key, value FROM sessions');
    const v = JSON.parse(row.value);
    v.awaitingReceiptFor.createdAt -= ms;
    q(t.storeDb, 'UPDATE sessions SET value = ? WHERE key = ?', JSON.stringify(v), row.key);
  };

  it('a receipt sent more than 24 h after agreeing creates no order', async () => {
    const t = makeTestEnv({ monshi: false });
    await agreed(t);
    ageDraft(t, 25 * 3600_000);
    await t.send('store', photoUpdate(CUSTOMER));
    expect(q(t.storeDb, 'SELECT * FROM orders')).toHaveLength(0);
    expect(t.tg.texts(CUSTOMER.id).at(-1)).toContain('مهلت ارسال رسید');
    // the state is gone: a later photo is just an ordinary message
    await t.send('store', photoUpdate(CUSTOMER));
    expect(t.tg.texts(CUSTOMER.id).at(-1)).toContain('برای مشاهده محصولات');
  });

  it('a receipt for a product deactivated meanwhile creates no order', async () => {
    const t = makeTestEnv({ monshi: false });
    const pid = await agreed(t);
    q(t.storeDb, 'UPDATE customer_products SET is_active = 0 WHERE id = ?', pid);
    await t.send('store', photoUpdate(CUSTOMER));
    expect(q(t.storeDb, 'SELECT * FROM orders')).toHaveLength(0);
    expect(t.tg.texts(CUSTOMER.id).at(-1)).toContain('این محصول دیگر موجود نیست');
  });
});

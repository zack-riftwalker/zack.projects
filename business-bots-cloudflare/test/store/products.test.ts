import { describe, expect, it } from 'vitest';
import { ADMIN, makeTestEnv, type TestEnv } from '../helpers/env';
import { callbackUpdate, photoUpdate, textUpdate } from '../helpers/updates';
import { one, q, seedCard, seedProduct } from '../helpers/seed';

const CUSTOMER = { id: 2002, first_name: 'Ali', username: 'ali_user' };
const at = (utcHour: number, utcMin = 0) => new Date(Date.UTC(2026, 9, 6, utcHour, utcMin));

async function openEdit(t: TestEnv, pid: number) {
  await t.send('store', textUpdate(ADMIN, '✏️ ویرایش محصول'));
  await t.send('store', callbackUpdate(ADMIN, 'cprod_edit_select_' + pid));
}
const lastText = (t: TestEnv) => t.tg.texts(ADMIN.id).at(-1)!;
const lastEdit = (t: TestEnv) => t.tg.of('editMessageText').at(-1)!.payload.text as string;
const product = (t: TestEnv, id: number) => one(t.storeDb, 'SELECT * FROM customer_products WHERE id = ?', id);

describe('edit product', () => {
  it('opens a card for the picked product', async () => {
    const t = makeTestEnv({ monshi: false });
    const pid = seedProduct(t, { name: 'GPT Plus', price: 500000 });
    await openEdit(t, pid);
    expect(lastEdit(t)).toContain('📦 نام: GPT Plus');
    expect(lastEdit(t)).toContain('📦 وضعیت: ✅ موجود');
  });

  it('edits name, price, duration, warranty and terms (with entities); invalid input is rejected', async () => {
    const t = makeTestEnv({ monshi: false });
    const pid = seedProduct(t);
    await openEdit(t, pid);

    await t.send('store', callbackUpdate(ADMIN, 'cprod_edit_f_name'));
    await t.send('store', textUpdate(ADMIN, 'ab'));
    expect(lastText(t)).toContain('حداقل ۳ کاراکتر');
    await t.send('store', textUpdate(ADMIN, 'Claude Pro'));
    expect(lastText(t)).toContain('✅ ذخیره شد.');
    expect(product(t, pid).name).toBe('Claude Pro');

    await t.send('store', callbackUpdate(ADMIN, 'cprod_edit_f_price'));
    await t.send('store', textUpdate(ADMIN, 'abc'));
    expect(lastText(t)).toContain('عدد وارد‌شده معتبر نیست');
    await t.send('store', textUpdate(ADMIN, '750,000'));
    expect(product(t, pid).price).toBe(750000);
    expect(lastText(t)).toContain('سفارش‌های قبلی تغییری نمی‌کنند');

    await t.send('store', callbackUpdate(ADMIN, 'cprod_edit_f_duration'));
    await t.send('store', textUpdate(ADMIN, '0'));
    expect(lastText(t)).toContain('عدد صحیح مثبت');
    await t.send('store', textUpdate(ADMIN, '60'));
    expect(product(t, pid).duration_days).toBe(60);
    await t.send('store', callbackUpdate(ADMIN, 'cprod_edit_f_duration'));
    await t.send('store', callbackUpdate(ADMIN, 'cprod_edit_clear_days'));
    expect(product(t, pid).duration_days).toBeNull();

    await t.send('store', callbackUpdate(ADMIN, 'cprod_edit_f_warranty'));
    await t.send('store', textUpdate(ADMIN, '14'));
    expect(product(t, pid).warranty_days).toBe(14);

    await t.send('store', callbackUpdate(ADMIN, 'cprod_edit_f_terms'));
    const upd = textUpdate(ADMIN, 'Rules here');
    upd.message.entities = [{ type: 'bold', offset: 0, length: 5 }];
    await t.send('store', upd);
    expect(product(t, pid).terms_text).toBe('Rules here');
    expect(JSON.parse(product(t, pid).terms_entities)).toEqual([{ type: 'bold', offset: 0, length: 5 }]);
    await t.send('store', callbackUpdate(ADMIN, 'cprod_edit_f_terms'));
    await t.send('store', callbackUpdate(ADMIN, 'cprod_edit_clear_terms'));
    expect(product(t, pid).terms_text).toBeNull();
    expect(product(t, pid).terms_entities).toBeNull();

    await t.send('store', callbackUpdate(ADMIN, 'cprod_edit_done'));
    expect(lastText(t)).toContain('ویرایش محصول تمام شد');
    // wizard closed: the next admin text hits the fallback
    await t.send('store', textUpdate(ADMIN, 'hello'));
    expect(lastText(t)).toContain('هیچ عملیاتی مطابقت نداشت');
  });

  it('price edit warns about fixed discount codes that would make the product free', async () => {
    const t = makeTestEnv({ monshi: false });
    const pid = seedProduct(t, { price: 500000 });
    q(t.storeDb, "INSERT INTO discount_codes (code, customer_product_id, discount_type, discount_value, expires_at) VALUES ('BIG', ?, 'fixed', 300000, '2999-01-01 00:00:00')", pid);
    q(t.storeDb, "INSERT INTO discount_codes (code, customer_product_id, discount_type, discount_value, expires_at) VALUES ('PCT', ?, 'percent', 50, '2999-01-01 00:00:00')", pid);
    await openEdit(t, pid);
    await t.send('store', callbackUpdate(ADMIN, 'cprod_edit_f_price'));
    await t.send('store', textUpdate(ADMIN, '200000'));
    expect(lastText(t)).toContain('کد تخفیف BIG');
    expect(lastText(t)).not.toContain('PCT');
  });

  it('a product deactivated meanwhile ends the wizard', async () => {
    const t = makeTestEnv({ monshi: false });
    const pid = seedProduct(t);
    await openEdit(t, pid);
    q(t.storeDb, 'UPDATE customer_products SET is_active = 0 WHERE id = ?', pid);
    await t.send('store', callbackUpdate(ADMIN, 'cprod_edit_f_name'));
    expect(lastText(t)).toContain('دیگر موجود نیست');
  });

  it('non-admins cannot open the wizard', async () => {
    const t = makeTestEnv({ monshi: false });
    seedProduct(t);
    await t.send('store', textUpdate(CUSTOMER, '✏️ ویرایش محصول'));
    expect(t.tg.texts(CUSTOMER.id).join('\n')).not.toContain('محصول مورد نظر را انتخاب کنید');
  });
});

describe('out of stock + waitlist', () => {
  async function startPurchase(t: TestEnv, pid: number) {
    await t.send('store', textUpdate(CUSTOMER, '/start'));
    await t.send('store', callbackUpdate(CUSTOMER, 'cust_prod_' + pid));
    await t.send('store', callbackUpdate(CUSTOMER, 'cust_disc_skip_' + pid));
    await t.send('store', callbackUpdate(CUSTOMER, 'cust_agree_' + pid));
  }

  it('catalog shows the product as ناموجود without a price; picking it offers the waitlist', async () => {
    const t = makeTestEnv({ monshi: false });
    const pid = seedProduct(t, { name: 'GPT Plus' });
    seedProduct(t, { name: 'Other' });
    q(t.storeDb, 'UPDATE customer_products SET is_available = 0 WHERE id = ?', pid);
    await t.send('store', textUpdate(CUSTOMER, '/start'));
    await t.send('store', textUpdate(CUSTOMER, '🛍 لیست محصولات'));
    const rows = t.tg.of('sendMessage', CUSTOMER.id).at(-1)!.payload.reply_markup.inline_keyboard;
    expect(rows[0][0].text).toBe('⛔️ GPT Plus (ناموجود)');
    expect(rows[1][0].text).toContain('Other');

    await t.send('store', callbackUpdate(CUSTOMER, 'cust_prod_' + pid));
    const msg = t.tg.of('sendMessage', CUSTOMER.id).at(-1)!.payload;
    expect(msg.text).toContain('فعلاً ناموجود است');
    expect(msg.reply_markup.inline_keyboard[0][0].callback_data).toBe('waitlist_join_' + pid);
  });

  it('joining the waitlist twice stores one row and answers differently', async () => {
    const t = makeTestEnv({ monshi: false });
    const pid = seedProduct(t);
    q(t.storeDb, 'UPDATE customer_products SET is_available = 0 WHERE id = ?', pid);
    await t.send('store', callbackUpdate(CUSTOMER, 'waitlist_join_' + pid));
    expect(t.tg.of('answerCallbackQuery').at(-1)!.payload.text).toBe('✅ ثبت شد');
    await t.send('store', callbackUpdate(CUSTOMER, 'waitlist_join_' + pid));
    expect(t.tg.of('answerCallbackQuery').at(-1)!.payload.text).toContain('قبلاً ثبت شده‌اید');
    expect(q(t.storeDb, 'SELECT * FROM product_waitlist')).toHaveLength(1);
  });

  it('every purchase step refuses an unavailable product', async () => {
    const t = makeTestEnv({ monshi: false });
    const pid = seedProduct(t);
    await t.send('store', textUpdate(CUSTOMER, '/start'));
    q(t.storeDb, 'UPDATE customer_products SET is_available = 0 WHERE id = ?', pid);
    for (const cb of ['renew_' + pid, 'cust_disc_skip_' + pid, 'cust_disc_enter_' + pid, 'cust_agree_' + pid]) {
      await t.send('store', callbackUpdate(CUSTOMER, cb));
      expect(t.tg.of('answerCallbackQuery').at(-1)!.payload.text).toContain('ناموجود');
    }
    expect(t.tg.of('sendMessage', CUSTOMER.id).filter((c) => c.payload.text?.includes('آیا کد تخفیف'))).toHaveLength(0);
  });

  it('a receipt is still accepted when the product went out of stock after the customer agreed', async () => {
    const t = makeTestEnv({ monshi: false });
    const pid = seedProduct(t);
    seedCard(t);
    await startPurchase(t, pid);
    q(t.storeDb, 'UPDATE customer_products SET is_available = 0 WHERE id = ?', pid);
    await t.send('store', photoUpdate(CUSTOMER));
    expect(one(t.storeDb, "SELECT COUNT(*) n FROM orders WHERE status = 'pending'").n).toBe(1);
  });

  it('renew keeps working after a price edit (the product id never changes)', async () => {
    const t = makeTestEnv({ monshi: false });
    const pid = seedProduct(t, { price: 500000 });
    await openEdit(t, pid);
    await t.send('store', callbackUpdate(ADMIN, 'cprod_edit_f_price'));
    await t.send('store', textUpdate(ADMIN, '900000'));
    await t.send('store', textUpdate(CUSTOMER, '/start'));
    await t.send('store', callbackUpdate(CUSTOMER, 'renew_' + pid));
    expect(t.tg.of('sendMessage', CUSTOMER.id).at(-1)!.payload.text).toContain('۹۰۰٬۰۰۰');
  });

  it('restock: toggling offers the notice, the broadcast reaches only the waitlist, then it is cleared', async () => {
    const t = makeTestEnv({ monshi: false });
    const pid = seedProduct(t, { name: 'GPT Plus' });
    const other = seedProduct(t, { name: 'Other' });
    q(t.storeDb, 'UPDATE customer_products SET is_available = 0 WHERE id = ?', pid);
    for (const id of [3001, 3002, 3003]) q(t.storeDb, 'INSERT INTO customers (telegram_id, display_name) VALUES (?, ?)', id, 'c');
    q(t.storeDb, 'INSERT INTO product_waitlist (product_id, customer_telegram_id) VALUES (?, 3001), (?, 3003), (?, 3002)', pid, pid, other);

    await openEdit(t, pid);
    await t.send('store', callbackUpdate(ADMIN, 'cprod_edit_toggle_stock'));
    expect(one(t.storeDb, 'SELECT is_available FROM customer_products WHERE id = ?', pid).is_available).toBe(1);
    const kb = t.tg.of('editMessageText').at(-1)!.payload.reply_markup.inline_keyboard.flat();
    expect(kb.find((b: any) => b.callback_data === 'cprod_edit_notify_wait').text).toContain('2 نفر');

    await t.send('store', callbackUpdate(ADMIN, 'cprod_edit_notify_wait'));
    await t.cron(at(5, 1));
    const sent = t.tg.of('sendMessage').filter((c) => c.payload.text?.includes('دوباره موجود شد'));
    expect(sent.map((c) => c.payload.chat_id).sort()).toEqual([3001, 3003]);
    expect(sent[0].payload.reply_markup.inline_keyboard[0][0].callback_data).toBe('cust_prod_' + pid);
    expect(t.tg.texts(ADMIN.id).at(-1)).toContain('به 2 نفر از لیست انتظار «GPT Plus» خبر داده شد');
    // only this product's waitlist is cleared
    expect(q(t.storeDb, 'SELECT product_id, customer_telegram_id FROM product_waitlist')).toEqual([{ product_id: other, customer_telegram_id: 3002 }]);
  });

  it('making a product unavailable keeps its waitlist and shows no notice button', async () => {
    const t = makeTestEnv({ monshi: false });
    const pid = seedProduct(t);
    q(t.storeDb, 'INSERT INTO product_waitlist (product_id, customer_telegram_id) VALUES (?, 3001)', pid);
    await openEdit(t, pid);
    await t.send('store', callbackUpdate(ADMIN, 'cprod_edit_toggle_stock'));
    expect(lastEdit(t)).toContain('⛔️ ناموجود');
    expect(q(t.storeDb, 'SELECT * FROM product_waitlist')).toHaveLength(1);
  });
});

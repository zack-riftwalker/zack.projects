import { describe, expect, it } from 'vitest';
import { toJalaali } from 'jalaali-js';
import { ADMIN, ADMIN2, makeTestEnv, type TestEnv } from '../helpers/env';
import { callbackUpdate, photoUpdate, textUpdate } from '../helpers/updates';
import { one, q, seedCard, seedProduct } from '../helpers/seed';

const CUSTOMER = { id: 2002, first_name: 'Ali', username: 'ali_user' };

async function buyOnce(t: TestEnv, pid: number, code?: string) {
  await t.send('store', callbackUpdate(CUSTOMER, 'cust_prod_' + pid));
  if (code) {
    await t.send('store', callbackUpdate(CUSTOMER, 'cust_disc_enter_' + pid));
    await t.send('store', textUpdate(CUSTOMER, code));
  } else {
    await t.send('store', callbackUpdate(CUSTOMER, 'cust_disc_skip_' + pid));
  }
  await t.send('store', callbackUpdate(CUSTOMER, 'cust_agree_' + pid));
  await t.send('store', photoUpdate(CUSTOMER));
}

describe('store: admin confirm / reject', () => {
  it('confirm: caption edited, customer notified, snapshot saved; second tap is "already handled"', async () => {
    const t = makeTestEnv({ monshi: false });
    const pid = seedProduct(t, { duration: 30, warranty: 7 });
    await t.send('store', textUpdate(CUSTOMER, '/start'));
    await buyOnce(t, pid);

    await t.send('store', callbackUpdate(ADMIN, 'order_confirm_1', { caption: 'CAP', chatId: ADMIN.id }));
    expect(t.tg.of('editMessageCaption').at(-1)!.payload.caption).toBe('CAP\n\n✅ تایید شد (توسط ادمین).');
    expect(t.tg.texts(CUSTOMER.id).at(-1)).toContain('✅ پرداخت شما تایید شد!');
    expect(t.tg.texts(CUSTOMER.id).at(-1)).toContain('@maiposhtibani');
    expect(one(t.storeDb, 'SELECT status, duration_days, warranty_days, decided_by FROM orders')).toEqual({ status: 'confirmed', duration_days: 30, warranty_days: 7, decided_by: ADMIN.id });

    const before = t.tg.of('sendMessage', CUSTOMER.id).length;
    await t.send('store', callbackUpdate(ADMIN2, 'order_confirm_1', { caption: 'CAP', chatId: ADMIN2.id }));
    expect(t.tg.of('sendMessage', CUSTOMER.id)).toHaveLength(before);
    expect(t.tg.of('editMessageCaption').at(-1)!.payload.caption).toBe('CAP\n\n✅ قبلاً تایید شده.');
    expect(t.tg.of('answerCallbackQuery').at(-1)!.payload.text).toBe('ℹ️ قبلاً بررسی شده.');
  });

  it('reject: customer gets the rejection text, no redemption recorded', async () => {
    const t = makeTestEnv({ monshi: false });
    const pid = seedProduct(t);
    await buyOnce(t, pid);
    await t.send('store', callbackUpdate(ADMIN, 'order_reject_1', { caption: 'CAP', chatId: ADMIN.id }));
    expect(one(t.storeDb, 'SELECT status FROM orders').status).toBe('pending'); // asks for a reason first
    await t.send('store', callbackUpdate(ADMIN, 'order_rejr_1_none', { caption: 'CAP', chatId: ADMIN.id }));
    expect(one(t.storeDb, 'SELECT status FROM orders').status).toBe('rejected');
    expect(t.tg.texts(CUSTOMER.id).at(-1)).toContain('رسید پرداخت شما تایید نشد');
    expect(t.tg.texts(CUSTOMER.id).at(-1)).not.toContain('دلیل');
    expect(q(t.storeDb, 'SELECT * FROM discount_code_redemptions')).toHaveLength(0);
  });

  it('a non-admin cannot confirm', async () => {
    const t = makeTestEnv({ monshi: false });
    const pid = seedProduct(t);
    await buyOnce(t, pid);
    await t.send('store', callbackUpdate(CUSTOMER, 'order_confirm_1', { caption: 'CAP' }));
    expect(one(t.storeDb, 'SELECT status FROM orders').status).toBe('pending');
    expect(t.tg.of('answerCallbackQuery').at(-1)!.payload.text).toBe('⛔️ دسترسی ندارید.');
  });
});

describe('store: admin wizards', () => {
  it('add-product wizard (5 steps) with terms and entities, then delete wizard', async () => {
    const t = makeTestEnv({ monshi: false });
    await t.send('store', textUpdate(ADMIN, '➕ افزودن محصول'));
    expect(t.tg.texts(ADMIN.id).at(-1)).toContain('مرحله ۱ از ۵');
    await t.send('store', textUpdate(ADMIN, 'ab'));
    expect(t.tg.texts(ADMIN.id).at(-1)).toContain('حداقل ۳ کاراکتر');
    await t.send('store', textUpdate(ADMIN, 'Gemini Pro'));
    await t.send('store', textUpdate(ADMIN, '۱,۲۰۰,۰۰۰'));
    await t.send('store', textUpdate(ADMIN, '30'));
    await t.send('store', callbackUpdate(ADMIN, 'cprod_add_no_warranty'));
    const terms = { type: 'bold', offset: 0, length: 4 };
    const upd = textUpdate(ADMIN, 'Rule one');
    upd.message.entities = [terms];
    await t.send('store', upd);
    const row = one(t.storeDb, 'SELECT * FROM customer_products');
    expect(row).toMatchObject({ name: 'Gemini Pro', price: 1200000, duration_days: 30, warranty_days: null, terms_text: 'Rule one', is_active: 1 });
    expect(JSON.parse(row.terms_entities)).toEqual([terms]);
    expect(t.tg.texts(ADMIN.id).at(-1)).toContain('محصول با موفقیت به فروشگاه اضافه شد');

    // customer sees the terms with the original entities
    await t.send('store', callbackUpdate(CUSTOMER, 'cust_disc_skip_' + row.id));
    const termsMsg = t.tg.of('sendMessage', CUSTOMER.id).at(-1)!.payload;
    expect(termsMsg.text).toBe('Rule one\n\nآیا با شرایط بالا موافقید؟');
    expect(termsMsg.entities).toEqual([terms]);

    // delete wizard
    await t.send('store', textUpdate(ADMIN, '🗑 حذف محصول'));
    await t.send('store', callbackUpdate(ADMIN, 'cprod_deact_select_' + row.id));
    await t.send('store', callbackUpdate(ADMIN, 'cprod_deact_confirm'));
    expect(one(t.storeDb, 'SELECT is_active FROM customer_products').is_active).toBe(0);
  });

  it('card wizard validates 16 digits and saves', async () => {
    const t = makeTestEnv({ monshi: false });
    await t.send('store', textUpdate(ADMIN, '💳 شماره کارت'));
    await t.send('store', textUpdate(ADMIN, '1234'));
    expect(t.tg.texts(ADMIN.id).at(-1)).toContain('دقیقاً ۱۶ رقم');
    await t.send('store', textUpdate(ADMIN, '۶۰۳۷-۱۲۳۴-۱۲۳۴-۱۲۳۴'));
    await t.send('store', textUpdate(ADMIN, 'Ali Test'));
    expect(one(t.storeDb, 'SELECT card_number, card_holder_name FROM store_settings')).toEqual({ card_number: '6037123412341234', card_holder_name: 'Ali Test' });
  });

  it('/cancel and لغو leave a wizard; an active wizard consumes stray callbacks', async () => {
    const t = makeTestEnv({ monshi: false });
    await t.send('store', textUpdate(ADMIN, '💳 شماره کارت'));
    await t.send('store', textUpdate(ADMIN, '/cancel'));
    expect(t.tg.texts(ADMIN.id).at(-1)).toContain('عملیات لغو شد');
    expect(q(t.storeDb, 'SELECT * FROM sessions')).toHaveLength(1);
    expect(JSON.parse(one(t.storeDb, 'SELECT value FROM sessions').value).__scene).toBeUndefined();

    await t.send('store', textUpdate(ADMIN, '💳 شماره کارت'));
    await t.send('store', textUpdate(ADMIN, 'لغو'));
    expect(t.tg.texts(ADMIN.id).at(-1)).toContain('عملیات لغو شد');

    await t.send('store', textUpdate(ADMIN, '💳 شماره کارت'));
    const callsBefore = t.tg.of('sendMessage', ADMIN.id).length;
    await t.send('store', callbackUpdate(ADMIN, 'some_stale_button'));
    // consumed by the wizard step (no card digits typed → still asks as text)
    expect(t.tg.of('sendMessage', ADMIN.id).length).toBe(callsBefore + 1);
    expect(t.tg.texts(ADMIN.id).at(-1)).toContain('شماره کارت را به صورت متن تایپ کنید');
  });
});

describe('store: discount codes', () => {
  function futureJalali(): string {
    const d = new Date(Date.now() + 365 * 86400000);
    const { jy, jm, jd } = toJalaali(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
    return `${jy}/${jm}/${jd} 14:30`;
  }

  async function addCode(t: TestEnv, pid: number, opts: { maxUses?: string; type?: 'percent' | 'fixed'; value?: string } = {}) {
    await t.send('store', textUpdate(ADMIN, '🎟 کد تخفیف'));
    await t.send('store', callbackUpdate(ADMIN, 'cprod_disc_add'));
    await t.send('store', textUpdate(ADMIN, 'summer 20'));
    await t.send('store', callbackUpdate(ADMIN, opts.type === 'fixed' ? 'disc_type_fixed' : 'disc_type_percent'));
    await t.send('store', textUpdate(ADMIN, opts.value ?? '20'));
    await t.send('store', callbackUpdate(ADMIN, 'disc_prod_select_' + pid));
    if (opts.maxUses) await t.send('store', textUpdate(ADMIN, opts.maxUses));
    else await t.send('store', callbackUpdate(ADMIN, 'disc_maxuses_unlimited'));
    await t.send('store', textUpdate(ADMIN, futureJalali()));
  }

  it('wizard creates the code; customer gets the discount; redemption is recorded on confirm only; reuse is refused', async () => {
    const t = makeTestEnv({ monshi: false });
    const pid = seedProduct(t, { price: 500000 });
    await addCode(t, pid);
    expect(t.tg.texts(ADMIN.id).at(-1)).toContain('کد تخفیف با موفقیت ثبت شد');
    expect(one(t.storeDb, 'SELECT code, discount_type, discount_value, max_uses FROM discount_codes')).toEqual({ code: 'SUMMER20', discount_type: 'percent', discount_value: 20, max_uses: null });

    await buyOnce(t, pid, 'summer20');
    const terms = t.tg.of('sendMessage', CUSTOMER.id).filter((c) => c.payload.text.includes('قیمت با تخفیف')).at(-1)!.payload.text;
    expect(terms).toContain(`*${(400000).toLocaleString('fa-IR')} تومان*`);
    expect(one(t.storeDb, 'SELECT price, discount_code_id FROM orders')).toEqual({ price: 400000, discount_code_id: 1 });
    expect(q(t.storeDb, 'SELECT * FROM discount_code_redemptions')).toHaveLength(0);

    await t.send('store', callbackUpdate(ADMIN, 'order_confirm_1', { caption: 'C', chatId: ADMIN.id }));
    expect(q(t.storeDb, 'SELECT customer_telegram_id FROM discount_code_redemptions')).toEqual([{ customer_telegram_id: CUSTOMER.id }]);

    // same customer again → already used
    await t.send('store', callbackUpdate(CUSTOMER, 'cust_prod_' + pid));
    await t.send('store', callbackUpdate(CUSTOMER, 'cust_disc_enter_' + pid));
    await t.send('store', textUpdate(CUSTOMER, 'SUMMER20'));
    expect(t.tg.texts(CUSTOMER.id).at(-1)).toContain('قبلاً از این کد تخفیف استفاده کرده‌اید');
  });

  it('unknown / expired / maxed-out / wrong-product codes are refused', async () => {
    const t = makeTestEnv({ monshi: false });
    const pid = seedProduct(t, { price: 500000 });
    const pid2 = seedProduct(t, { name: 'Other', price: 100 });
    await addCode(t, pid, { maxUses: '1', type: 'fixed', value: '1000' });

    const tryCode = async (productId: number, code: string) => {
      await t.send('store', callbackUpdate(CUSTOMER, 'cust_disc_enter_' + productId));
      await t.send('store', textUpdate(CUSTOMER, code));
      return t.tg.texts(CUSTOMER.id).at(-1)!;
    };
    expect(await tryCode(pid, 'NOPE')).toContain('کد تخفیف نامعتبر است');
    expect(await tryCode(pid2, 'SUMMER20')).toContain('برای این محصول معتبر نیست');

    q(t.storeDb, "UPDATE discount_codes SET expires_at = '2020-01-01 00:00:00'");
    expect(await tryCode(pid, 'SUMMER20')).toContain('منقضی شده');
    q(t.storeDb, "UPDATE discount_codes SET expires_at = '2099-01-01 00:00:00'");

    q(t.storeDb, "INSERT INTO orders (customer_telegram_id, customer_product_id, product_name, price, receipt_file_id, receipt_type) VALUES (7, 1, 'x', 1, 'f', 'photo')");
    q(t.storeDb, 'INSERT INTO discount_code_redemptions (discount_code_id, customer_telegram_id, order_id) VALUES (1, 7, 1)');
    expect(await tryCode(pid, 'SUMMER20')).toContain('ظرفیت استفاده');

    q(t.storeDb, 'UPDATE discount_codes SET is_active = 0');
    expect(await tryCode(pid, 'SUMMER20')).toContain('غیرفعال شده');
  });

  it('list / view / renew / delete actions work for admins only', async () => {
    const t = makeTestEnv({ monshi: false });
    const pid = seedProduct(t);
    await addCode(t, pid);
    await t.send('store', callbackUpdate(ADMIN, 'cprod_disc_list'));
    expect(t.tg.of('editMessageText').at(-1)!.payload.reply_markup.inline_keyboard[0][0].callback_data).toBe('cprod_disc_view_1');
    await t.send('store', callbackUpdate(ADMIN, 'cprod_disc_view_1'));
    expect(t.tg.of('editMessageText').at(-1)!.payload.text).toContain('SUMMER20');
    await t.send('store', callbackUpdate(CUSTOMER, 'cprod_disc_view_1'));
    expect(t.tg.of('answerCallbackQuery').at(-1)!.payload.text).toBe('⛔️ دسترسی ندارید.');
    await t.send('store', callbackUpdate(ADMIN, 'cprod_disc_del_confirm_1'));
    expect(one(t.storeDb, 'SELECT is_active FROM discount_codes').is_active).toBe(0);
    await t.send('store', callbackUpdate(ADMIN, 'cprod_disc_renew_1'));
    await t.send('store', textUpdate(ADMIN, futureJalali()));
    expect(one(t.storeDb, 'SELECT is_active FROM discount_codes').is_active).toBe(1);
  });
});

describe('store: discount codes at confirm time', () => {
  function seedCode(t: TestEnv, pid: number, maxUses: number | null = null) {
    q(t.storeDb, "INSERT INTO discount_codes (code, customer_product_id, discount_type, discount_value, max_uses, expires_at) VALUES ('OFF50', ?, 'percent', 50, ?, '2099-01-01 00:00:00')", pid, maxUses);
  }
  const confirmOrder = (t: TestEnv, id: number) =>
    t.send('store', callbackUpdate(ADMIN, 'order_confirm_' + id, { caption: 'CAP', chatId: ADMIN.id }));

  it('two pending receipts with the same code: only the first confirm consumes it; the admin is warned on the second', async () => {
    const t = makeTestEnv({ monshi: false });
    const pid = seedProduct(t, { price: 500000 });
    seedCode(t, pid);
    await t.send('store', textUpdate(CUSTOMER, '/start'));
    await buyOnce(t, pid, 'OFF50');
    await buyOnce(t, pid, 'OFF50'); // code not consumed yet → accepted again
    expect(q(t.storeDb, 'SELECT price FROM orders ORDER BY id').map((r) => r.price)).toEqual([250000, 250000]);

    await confirmOrder(t, 1);
    expect(t.tg.of('editMessageCaption').at(-1)!.payload.caption).toBe('CAP\n\n✅ تایید شد (توسط ادمین).');
    await confirmOrder(t, 2);
    const caption = t.tg.of('editMessageCaption').at(-1)!.payload.caption;
    expect(caption).toContain('⚠️ کد تخفیف این سفارش هنگام تایید دیگر معتبر نبود');
    expect(caption).toContain('قیمت اصلی: ۵۰۰٬۰۰۰ تومان');
    expect(t.tg.of('answerCallbackQuery').at(-1)!.payload.show_alert).toBe(true);
    expect(q(t.storeDb, 'SELECT order_id FROM discount_code_redemptions')).toEqual([{ order_id: 1 }]);
  });

  it('max_uses is never exceeded even when confirms race', async () => {
    const t = makeTestEnv({ monshi: false });
    const pid = seedProduct(t);
    seedCode(t, pid, 1);
    for (const c of [11, 12, 13]) {
      q(t.storeDb, "INSERT INTO orders (customer_telegram_id, customer_product_id, product_name, price, discount_code_id) VALUES (?, ?, 'P', 1, 1)", c, pid);
    }
    const db = t.apps().store!.db;
    const results = await Promise.all([db.redeemDiscountCodeAtomic(1, 11, 1), db.redeemDiscountCodeAtomic(1, 12, 2)]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(q(t.storeDb, 'SELECT * FROM discount_code_redemptions')).toHaveLength(1);
    expect(await db.redeemDiscountCodeAtomic(1, 13, 3)).toBe(false);
  });
});

describe('store: discount code admin callbacks', () => {
  it('a customer forging the list-page callback gets no code list', async () => {
    const t = makeTestEnv({ monshi: false });
    const pid = seedProduct(t);
    q(t.storeDb, "INSERT INTO discount_codes (code, customer_product_id, discount_type, discount_value, expires_at) VALUES ('SECRET50', ?, 'percent', 50, '2099-01-01 00:00:00')", pid);
    await t.send('store', textUpdate(CUSTOMER, '/start'));
    for (const data of ['cprod_disc_page_0', 'cprod_disc_list', 'cprod_disc_view_1', 'cprod_disc_close']) {
      await t.send('store', callbackUpdate(CUSTOMER, data));
      expect(t.tg.of('answerCallbackQuery').at(-1)!.payload.text).toBe('⛔️ دسترسی ندارید.');
    }
    expect(JSON.stringify(t.tg.calls)).not.toContain('SECRET50');
  });
});

describe('store: admin mid-wizard', () => {
  it('confirming a receipt works while the admin is inside a wizard, and the wizard continues afterwards', async () => {
    const t = makeTestEnv({ monshi: false });
    const pid = seedProduct(t);
    await t.send('store', textUpdate(CUSTOMER, '/start'));
    await buyOnce(t, pid);
    await t.send('store', textUpdate(ADMIN, '➕ افزودن محصول'));
    await t.send('store', callbackUpdate(ADMIN, 'order_confirm_1', { caption: 'CAP', chatId: ADMIN.id }));
    expect(one(t.storeDb, 'SELECT status FROM orders').status).toBe('confirmed');
    await t.send('store', textUpdate(ADMIN, 'New product'));
    expect(t.tg.texts(ADMIN.id).at(-1)).toContain('قیمت');
  });

  it('/start leaves the wizard instead of becoming its input', async () => {
    const t = makeTestEnv({ monshi: false });
    await t.send('store', textUpdate(ADMIN, '➕ افزودن محصول'));
    await t.send('store', textUpdate(ADMIN, '/start'));
    expect(t.tg.texts(ADMIN.id).at(-1)).toContain('سلام مدیر!');
    await t.send('store', textUpdate(ADMIN, 'Some text'));
    expect(t.tg.texts(ADMIN.id).at(-1)).toContain('با هیچ عملیاتی مطابقت نداشت');
    expect(q(t.storeDb, 'SELECT * FROM customer_products')).toHaveLength(0);
  });
});

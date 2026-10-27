import { describe, expect, it } from 'vitest';
import { toJalaali } from 'jalaali-js';
import { ADMIN, ADMIN2, type TestEnv } from '../helpers/env';
import { callbackUpdate, photoUpdate, textUpdate } from '../helpers/updates';
import { one, q } from '../helpers/seed';
import { ACTIVATION_CONTACT } from '../../src/store/labels';
import { DEFAULT_REFERRAL_CONFIG } from '../../src/store/referralConfig';
import { formatPrice } from '../../src/store/utils';
import { at, callbackDataOf, press, say } from './helpers';
import {
  adminTexts, buy, completedOrder, confirm, CUSTOMER, events, failedOrder, iso, orderRow, pressAs, posts, sayAs, seedStock, shop, soRow,
} from './engineHelpers';

const lastEdit = (t: any) => t.tg.of('editMessageText').at(-1)!.payload;
const customerTexts = (t: TestEnv) => t.tg.texts(CUSTOMER.id);

function futureJalali(): string {
  const d = new Date(Date.now() + 365 * 86400000);
  const { jy, jm, jd } = toJalaali(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  return `${jy}/${jm}/${jd} 14:30`;
}

/** A 5 % code for the option (the floor allows it: 874,000 ≥ the 792,000 cost), created through the real wizard. */
async function addCode(t: TestEnv, pid: number) {
  await say(t, '🎟 کد تخفیف');
  await press(t, 'cprod_disc_add');
  await say(t, 'save5');
  await press(t, 'disc_type_percent');
  await say(t, '5');
  await press(t, 'disc_prod_select_' + pid);
  await press(t, 'disc_scope_one');
  await press(t, 'disc_maxuses_unlimited');
  await say(t, futureJalali());
}

async function buyWithCode(t: TestEnv, pid: number, code: string, user = CUSTOMER): Promise<number> {
  await t.send('store', textUpdate(user, '/start'));
  await t.send('store', callbackUpdate(user, 'cust_prod_' + pid));
  await t.send('store', callbackUpdate(user, 'cust_disc_enter_' + pid));
  await t.send('store', textUpdate(user, code));
  await t.send('store', callbackUpdate(user, 'cust_agree_' + pid));
  await t.send('store', photoUpdate(user, 'receipt-' + Math.random()));
  return one(t.storeDb, 'SELECT MAX(id) AS id FROM orders').id;
}

describe('❌ لغو سفارش (fo_cancel)', () => {
  it('reason → confirmation → one batch: order cancelled, code given back, referral un-qualified, refund pending; customer told', async () => {
    const { t, fake, m1 } = await shop();
    await addCode(t, m1);
    // the program: one friend's first purchase qualifies for the inviter
    q(t.storeDb, "INSERT OR REPLACE INTO store_kv (key, value) VALUES ('referral', ?)", JSON.stringify({ ...DEFAULT_REFERRAL_CONFIG, enabled: true, required: 2, discProductId: m1 }));
    const REF = { id: 3001, first_name: 'Referrer' };
    await t.send('store', textUpdate(REF, '/start'));
    await t.send('store', textUpdate(REF, '🎁 دعوت دوستان'));
    const refCode = /ref_([A-Z2-9]{8})/.exec(t.tg.texts(REF.id).at(-1)!)![1];
    await t.send('store', textUpdate(CUSTOMER, '/start ref_' + refCode));

    fake.state.postQueue.push({ status: 401, body: { detail: 'invalid api key' } });
    const orderId = await buyWithCode(t, m1, 'SAVE5');
    const price = one(t.storeDb, 'SELECT price FROM orders WHERE id = ?', orderId).price;
    expect(price).toBe(874000);
    await confirm(t, orderId);
    expect(q(t.storeDb, 'SELECT order_id FROM discount_code_redemptions')).toEqual([{ order_id: orderId }]);
    expect(one(t.storeDb, 'SELECT qualified_at IS NOT NULL AS ok, qualifying_order_id AS o FROM referrals')).toEqual({ ok: 1, o: orderId });

    t.tg.reset();
    await press(t, 'fo_cancel_' + orderId);
    expect(callbackDataOf(lastEdit(t))).toEqual(['fo_cr_' + orderId + '_oos', 'fo_cr_' + orderId + '_price', 'fo_cr_' + orderId + '_cust',
      'fo_cr_' + orderId + '_custom', 'fo_cr_' + orderId + '_none', 'fo_card_' + orderId]);
    await press(t, 'fo_cr_' + orderId + '_cust');
    expect(lastEdit(t).text).toBe('⚠️ سفارش #' + orderId + ' لغو شود؟ مبلغ ' + formatPrice(price) + ' ت باید به مشتری برگردانده شود.\n📝 دلیل: درخواست مشتری');
    expect(orderRow(t, orderId).status).toBe('confirmed'); // a confirmation changes nothing

    await press(t, 'fo_cok_' + orderId);
    expect(orderRow(t, orderId)).toMatchObject({
      status: 'cancelled', cancel_reason: 'درخواست مشتری', cancelled_by: ADMIN.id, refund_status: 'pending', needs_action_reason: null,
    });
    expect(orderRow(t, orderId).cancelled_at).toBeTruthy();
    expect(q(t.storeDb, 'SELECT * FROM discount_code_redemptions')).toHaveLength(0); // the code is usable again
    expect(one(t.storeDb, 'SELECT qualified_at, qualifying_order_id AS o FROM referrals')).toEqual({ qualified_at: null, o: null });
    expect(events(t, 'admin_cancel')[0]).toMatchObject({ actor: ADMIN.id, detail: 'درخواست مشتری' });
    expect(customerTexts(t).at(-1)).toBe(
      '❌ سفارش «ChatGPT — ۱ ماهه» لغو شد.\n📝 دلیل: درخواست مشتری\n\n💸 مبلغ پرداختی شما (' + formatPrice(price) +
      ' تومان) بازگردانده می‌شود. برای پیگیری به ' + ACTIVATION_CONTACT + ' پیام دهید.',
    );
    expect(lastEdit(t).text).toContain('❌ سفارش لغو شد توسط Admin');
    expect(callbackDataOf(lastEdit(t))).toEqual(['fo_refund_' + orderId]);

    // the refund
    t.tg.reset();
    await press(t, 'fo_refund_' + orderId);
    expect(orderRow(t, orderId)).toMatchObject({ refund_status: 'done' });
    expect(orderRow(t, orderId).refunded_at).toBeTruthy();
    expect(customerTexts(t).at(-1)).toBe('✅ مبلغ سفارش «ChatGPT — ۱ ماهه» (' + formatPrice(price) + ' تومان) به شما بازگردانده شد.');
    expect(events(t, 'refund_done')).toHaveLength(1);
    await press(t, 'fo_refund_' + orderId);
    expect(t.tg.of('answerCallbackQuery').at(-1)!.payload.text).toContain('قبلاً تصمیم گرفته شد');
    expect(customerTexts(t).filter((x) => x.includes('بازگردانده شد'))).toHaveLength(1);

    // the same customer can use the code again on a new order
    const again = await buyWithCode(t, m1, 'SAVE5');
    expect(again).toBeGreaterThan(orderId);
  });

  it('a custom reason is typed; «بدون دلیل» sends no reason line; a price-0 order has no refund', async () => {
    const { t, fake, m1 } = await shop();
    const orderId = await failedOrder(t, fake, m1);
    await press(t, 'fo_cancel_' + orderId);
    await press(t, 'fo_cr_' + orderId + '_custom');
    expect(t.tg.texts(ADMIN.id).at(-1)).toContain('دلیل لغو را بنویسید');
    await say(t, 'x'.repeat(201));
    expect(t.tg.texts(ADMIN.id).at(-1)).toContain('بین ۱ تا ۲۰۰');
    await say(t, 'محصول از رده خارج شد');
    expect(t.tg.texts(ADMIN.id).at(-1)).toContain('📝 دلیل: محصول از رده خارج شد');
    await press(t, 'fo_cok_' + orderId);
    expect(orderRow(t, orderId).cancel_reason).toBe('محصول از رده خارج شد');

    const second = await failedOrder(t, fake, m1, { id: 2005, first_name: 'Reza' });
    await press(t, 'fo_cancel_' + second);
    await press(t, 'fo_cr_' + second + '_none');
    await press(t, 'fo_cok_' + second);
    expect(orderRow(t, second)).toMatchObject({ status: 'cancelled', cancel_reason: null });
    expect(t.tg.texts(2005).at(-1)).not.toContain('📝 دلیل');
  });

  it('the supplier side: a waiting order is cancelled; a placed one is kept running and its accounts go to stock', async () => {
    const { t, fake, m1 } = await shop();
    // waiting (out of stock)
    fake.state.postQueue.push({ status: 409, body: { detail: 'x' } });
    const waiting = await buy(t, m1);
    await confirm(t, waiting);
    await press(t, 'fo_cancel_' + waiting);
    await press(t, 'fo_cr_' + waiting + '_oos');
    await press(t, 'fo_cok_' + waiting);
    expect(soRow(t, 1).status).toBe('cancelled');
    await at(t, iso('11:00'));
    expect(posts(fake)).toHaveLength(1);

    // placed at the supplier, then cancelled: the account that arrives is stock, the customer gets nothing
    const placedOrder = await buy(t, m1, { id: 2005, first_name: 'Reza' });
    await confirm(t, placedOrder);
    expect(soRow(t, 2).status).toBe('placed');
    await press(t, 'fo_cancel_' + placedOrder);
    await press(t, 'fo_cr_' + placedOrder + '_price');
    await press(t, 'fo_cok_' + placedOrder);
    expect(soRow(t, 2).divert_to_stock).toBe(1);
    completedOrder(fake, '5001');
    t.tg.reset();
    await at(t, iso('11:05'));
    expect(t.tg.texts(2005)).toHaveLength(0);
    expect(one(t.storeDb, "SELECT COUNT(*) n FROM stock_accounts WHERE status = 'available'").n).toBe(1);
    expect(orderRow(t, placedOrder).status).toBe('cancelled');
    expect(adminTexts(t, 'قبلاً تعیین‌تکلیف شده بود')).toHaveLength(1);
  });

  it('a reserved stock account goes back to «available» when the order is cancelled', async () => {
    const { t, fake, m1 } = await shop();
    const orderId = await failedOrder(t, fake, m1);
    await seedStock(t, [{ email: 'a@x.test', password: '1' }]);
    t.tg.fail('sendMessage', (c) => c.payload.chat_id === CUSTOMER.id && c.payload.text.includes('آماده است'), 403, 'Forbidden: bot was blocked by the user');
    await press(t, 'fo_stkok_' + orderId + '_1');
    expect(one(t.storeDb, 'SELECT status FROM stock_accounts').status).toBe('reserved');
    t.tg.clearRules();
    await press(t, 'fo_cancel_' + orderId);
    await press(t, 'fo_cr_' + orderId + '_none');
    await press(t, 'fo_cok_' + orderId);
    expect(one(t.storeDb, 'SELECT status, order_id FROM stock_accounts')).toEqual({ status: 'available', order_id: null });
  });

  it('refused from other states: delivered, already cancelled, a stranger; two admins together cancel once', async () => {
    const { t, fake, m1 } = await shop();
    const delivered = await buy(t, m1);
    await confirm(t, delivered);
    completedOrder(fake);
    await at(t, iso('09:52'));
    await pressAs(t, ADMIN, 'fo_cancel_' + delivered);
    expect(t.tg.of('answerCallbackQuery').at(-1)!.payload.text).toContain('قبلاً تصمیم گرفته شد');
    await pressAs(t, CUSTOMER, 'fo_cok_' + delivered);
    expect(t.tg.of('answerCallbackQuery').at(-1)!.payload.text).toContain('دسترسی ندارید');

    const orderId = await failedOrder(t, fake, m1, { id: 2005, first_name: 'Reza' });
    for (const admin of [ADMIN, ADMIN2]) {
      await pressAs(t, admin, 'fo_cancel_' + orderId);
      await pressAs(t, admin, 'fo_cr_' + orderId + '_cust');
    }
    t.tg.reset();
    await Promise.all([pressAs(t, ADMIN, 'fo_cok_' + orderId), pressAs(t, ADMIN2, 'fo_cok_' + orderId)]);
    expect(t.tg.texts(2005).filter((x) => x.includes('لغو شد'))).toHaveLength(1);
    expect(events(t, 'admin_cancel')).toHaveLength(1);
    expect(orderRow(t, orderId).status).toBe('cancelled');

    // an expired confirmation (15 minutes) is refused
    const other = await failedOrder(t, fake, m1, { id: 2006, first_name: 'Maryam' });
    await press(t, 'fo_cancel_' + other);
    await press(t, 'fo_cr_' + other + '_cust');
    t.deps.now = () => new Date(iso('12:00'));
    await press(t, 'fo_cok_' + other);
    expect(t.tg.of('answerCallbackQuery').at(-1)!.payload.text).toContain('مهلت تمام شد');
    expect(orderRow(t, other).status).toBe('confirmed');
    expect(sayAs).toBeDefined();
  });

  it('a manual delivery in progress can be cancelled too (the refund flow is the same)', async () => {
    const { t, fake, m1 } = await shop();
    const orderId = await failedOrder(t, fake, m1);
    await press(t, 'fo_self_' + orderId);
    expect(callbackDataOf(lastEdit(t))).toContain('fo_cancel_' + orderId);
    await press(t, 'fo_cancel_' + orderId);
    await press(t, 'fo_cr_' + orderId + '_oos');
    await press(t, 'fo_cok_' + orderId);
    expect(orderRow(t, orderId)).toMatchObject({ status: 'cancelled', refund_status: 'pending' });
  });
});

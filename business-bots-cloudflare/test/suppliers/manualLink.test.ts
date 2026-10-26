import { describe, expect, it } from 'vitest';
import { ADMIN } from '../helpers/env';
import { callbackUpdate, textUpdate } from '../helpers/updates';
import { one, q, seedProduct } from '../helpers/seed';
import { PREPARING_TEXT } from '../../src/store/handlers/manualPurchases';
import { at, callbackDataOf, press } from './helpers';
import { CUSTOMER, completedOrder, events, iso, orderRow, posts, seedStock, shop, soRow } from './engineHelpers';
import type { TestEnv } from '../helpers/env';

const MANUAL = '🛒 ثبت خرید مشتری';
const start = (t: TestEnv) => t.send('store', textUpdate(ADMIN, MANUAL));
const payloadOf = (t: TestEnv): string => /\?start=(mp_[A-Za-z0-9_-]{43})/.exec(t.tg.of('sendMessage', ADMIN.id).at(-1)!.payload.text)![1];
const claim = (t: TestEnv) => one(t.storeDb, 'SELECT * FROM manual_purchase_claims ORDER BY id DESC LIMIT 1');
const open = (t: TestEnv, link: string, user: { id: number; first_name: string; username?: string } = CUSTOMER) => t.send('store', textUpdate(user, '/start ' + link));

/** Admin picks a supplier-backed product and the fulfillment choice, then confirms; returns the link payload. */
async function makeLink(t: TestEnv, pid: number, fulfillment: 'outside' | 'stock' | 'supplier', accountId?: number) {
  await start(t);
  await press(t, 'manual_prod_' + pid);
  await press(t, 'manual_ful_' + fulfillment);
  if (fulfillment === 'stock') await press(t, 'manual_stk_' + accountId);
  await press(t, 'manual_purchase_confirm');
  return payloadOf(t);
}

describe('S7 manual purchase links with a delivery choice (§10.3)', () => {
  it('a product WITHOUT sources skips the new step: the flow is as before', async () => {
    const { t } = await shop();
    const pid = seedProduct(t, { name: 'Plain', price: 100000 });
    await start(t);
    await press(t, 'manual_prod_' + pid);
    const edited = t.tg.of('editMessageText').at(-1)!.payload;
    expect(edited.text).toContain('آیا خرید ثبت شود؟');
    expect(callbackDataOf(edited)).toEqual(['manual_purchase_confirm', 'manual_purchase_cancel']);
    await press(t, 'manual_purchase_confirm');
    expect(claim(t)).toMatchObject({ fulfillment: null, stock_account_id: null });
    await open(t, payloadOf(t));
    expect(orderRow(t, 1)).toMatchObject({ status: 'delivered', fulfillment: null });
  });

  it('a supplier-backed product asks «این خرید چطور تحویل شود؟» with three choices', async () => {
    const { t, m1 } = await shop();
    await start(t);
    await press(t, 'manual_prod_' + m1);
    const edited = t.tg.of('editMessageText').at(-1)!.payload;
    expect(edited.text).toContain('این خرید چطور تحویل شود؟');
    expect(callbackDataOf(edited)).toEqual(['manual_ful_outside', 'manual_ful_stock', 'manual_ful_supplier', 'manual_purchase_cancel']);
  });

  it('outside: exactly as before (delivered at once, fulfillment NULL, no supplier order, no POST)', async () => {
    const { t, fake, m1 } = await shop();
    const link = await makeLink(t, m1, 'outside');
    expect(claim(t)).toMatchObject({ fulfillment: null });
    await open(t, link);
    expect(orderRow(t, 1)).toMatchObject({ status: 'delivered', fulfillment: null, supplier_deadline_at: null });
    expect(orderRow(t, 1).expires_at).toBeTruthy();
    expect(q(t.storeDb, 'SELECT id FROM supplier_orders')).toHaveLength(0);
    expect(posts(fake)).toHaveLength(0);
    expect(t.tg.texts(CUSTOMER.id).at(-1)).toContain('📅 شروع اشتراک');
  });

  it('stock: the account is reserved with the link, the order is delivered at once and the account is sent when the customer opens it', async () => {
    const { t, m1 } = await shop();
    await seedStock(t, [{ email: 'one@x.test', password: 'p1' }, { email: 'two@x.test', password: 'p2' }], 'ChatGPT — 1 month', 750000);
    const link = await makeLink(t, m1, 'stock', 2);
    expect(claim(t)).toMatchObject({ fulfillment: 'stock', stock_account_id: 2 });
    expect(one(t.storeDb, 'SELECT status, order_id FROM stock_accounts WHERE id = 2')).toEqual({ status: 'reserved', order_id: null });
    // the summary named the account
    expect(t.tg.of('editMessageText').map((c) => c.payload.text).join('\n')).toContain('اکانت #2');

    t.tg.reset();
    await open(t, link);
    expect(orderRow(t, 1)).toMatchObject({ status: 'delivered', fulfillment: 'stock', cost_toman: 375000, customer_telegram_id: CUSTOMER.id });
    expect(orderRow(t, 1).expires_at).toBeTruthy();
    expect(one(t.storeDb, 'SELECT status, order_id FROM stock_accounts WHERE id = 2')).toEqual({ status: 'delivered', order_id: 1 });
    expect(one(t.storeDb, 'SELECT kind, sent_ok, stock_account_id FROM order_deliveries')).toEqual({ kind: 'stock', sent_ok: 1, stock_account_id: 2 });
    const texts = t.tg.texts(CUSTOMER.id);
    expect(texts[0]).toContain('✅ خرید شما با موفقیت فعال شد.');
    expect(texts.at(-1)).toContain('two@x.test');
    expect(events(t, 'delivered')).toHaveLength(1);
    // opening it again changes nothing
    await open(t, link);
    expect(q(t.storeDb, 'SELECT id FROM order_deliveries')).toHaveLength(1);
    expect(t.tg.texts(CUSTOMER.id).filter((x) => x.includes('two@x.test'))).toHaveLength(1);
  });

  it('stock link whose message could not be sent: the order is delivered but the «send failed» card offers a resend', async () => {
    const { t, m1 } = await shop();
    await seedStock(t, [{ email: 'one@x.test', password: 'p1' }], 'ChatGPT — 1 month', 375000);
    const link = await makeLink(t, m1, 'stock', 1);
    t.tg.fail('sendMessage', (c) => c.payload.chat_id === CUSTOMER.id && String(c.payload.text).includes('one@x.test'));
    t.tg.reset();
    await open(t, link);
    expect(orderRow(t, 1)).toMatchObject({ status: 'delivered', fulfillment: 'stock', needs_action_reason: 'send_failed' });
    expect(one(t.storeDb, 'SELECT status FROM stock_accounts').status).toBe('reserved');
    const card = t.tg.of('sendMessage', ADMIN.id).map((c) => c.payload).find((p) => p.text.includes('تحویل نشد'))!;
    expect(callbackDataOf(card)).toEqual(expect.arrayContaining(['fo_resend_1', 'fo_view_1']));
    t.tg.clearRules();
    await press(t, 'fo_resend_1');
    expect(orderRow(t, 1).needs_action_reason).toBeNull();
    expect(one(t.storeDb, 'SELECT status, order_id FROM stock_accounts')).toEqual({ status: 'delivered', order_id: 1 });
    expect(t.tg.texts(CUSTOMER.id).at(-1)).toContain('one@x.test');
  });

  it('stock: the reserved account cannot be given twice, and a link nobody opened can be withdrawn', async () => {
    const { t, m1 } = await shop();
    await seedStock(t, [{ email: 'one@x.test', password: 'p1' }], 'ChatGPT — 1 month', 375000);
    const link = await makeLink(t, m1, 'stock', 1);
    // the account is no longer in the pick list
    await start(t);
    await press(t, 'manual_prod_' + m1);
    await press(t, 'manual_ful_stock');
    expect(t.tg.of('answerCallbackQuery').at(-1)!.payload.text).toContain('اکانت آزادی');
    await press(t, 'manual_purchase_cancel');

    await press(t, 'stk_a_1');
    expect(callbackDataOf(t.tg.of('editMessageText').at(-1)!.payload)).toEqual(['stk_rel_1', 'stk_b_1']);
    await press(t, 'stk_rel_1');
    expect(one(t.storeDb, 'SELECT status FROM stock_accounts').status).toBe('available');
    expect(q(t.storeDb, 'SELECT id FROM manual_purchase_claims')).toHaveLength(0);
    await open(t, link);
    expect(t.tg.texts(CUSTOMER.id).at(-1)).toContain('لینک فعال‌سازی نامعتبر');
    expect(q(t.storeDb, 'SELECT id FROM orders')).toHaveLength(0);
  });

  it('from an account card («🔗 لینک خرید دستی»): the account is attached, there is no delivery question', async () => {
    const { t, m1 } = await shop();
    await seedStock(t, [{ email: 'one@x.test', password: 'p1' }], 'ChatGPT — 1 month', 375000);
    await press(t, 'stk_link_1');
    expect(t.tg.texts(ADMIN.id).at(-1)).toContain('ثبت خرید مشتری');
    await press(t, 'manual_prod_' + m1);
    const edited = t.tg.of('editMessageText').at(-1)!.payload;
    expect(edited.text).toContain('اکانت #1');
    expect(callbackDataOf(edited)).toEqual(['manual_purchase_confirm', 'manual_purchase_cancel']);
    await press(t, 'manual_purchase_confirm');
    expect(claim(t)).toMatchObject({ fulfillment: 'stock', stock_account_id: 1 });
    await open(t, payloadOf(t));
    expect(one(t.storeDb, 'SELECT status FROM stock_accounts').status).toBe('delivered');
  });

  it('supplier: the order starts confirmed (not delivered), one POST with the approving admin, the customer is told it is being prepared, the clocks start at delivery', async () => {
    const { t, fake, m1 } = await shop();
    await start(t);
    await press(t, 'manual_prod_' + m1);
    await press(t, 'manual_ful_supplier');
    const summary = t.tg.of('editMessageText').at(-1)!.payload.text as string;
    expect(summary).toContain('هزینه‌ی تقریبی');
    expect(summary).toContain('با زدن «تأیید»، خرید از کیف پول را تأیید می‌کنید.');
    await press(t, 'manual_purchase_confirm');
    expect(claim(t)).toMatchObject({ fulfillment: 'supplier' });
    expect(posts(fake)).toHaveLength(0); // nothing is bought until the customer opens the link

    const link = payloadOf(t);
    t.tg.reset();
    await open(t, link);
    expect(t.tg.texts(CUSTOMER.id).at(-1)).toContain(PREPARING_TEXT);
    expect(t.tg.texts(CUSTOMER.id).at(-1)).not.toContain('شروع اشتراک');
    expect(orderRow(t, 1)).toMatchObject({ status: 'confirmed', fulfillment: 'supplier', delivered_at: null, expires_at: null, purchase_source: 'manual' });
    expect(orderRow(t, 1).supplier_deadline_at).toBeTruthy();
    expect(posts(fake)).toHaveLength(1);
    expect(soRow(t)).toMatchObject({ status: 'placed', requested_by: ADMIN.id, order_id: 1, purpose: 'customer' });

    completedOrder(fake);
    await at(t, iso('09:52'));
    expect(orderRow(t, 1)).toMatchObject({ status: 'delivered', fulfillment: 'supplier', cost_toman: 792000 });
    expect(orderRow(t, 1).expires_at).toBeTruthy(); // the clocks started with the delivery
    expect(t.tg.texts(CUSTOMER.id).join('\n')).toContain('a@b.c');
    expect(posts(fake)).toHaveLength(1);
  });

  it('supplier whose purchase fails: the decision card goes to the admins, one POST, no automatic second try', async () => {
    const { t, fake, m1 } = await shop();
    const link = await makeLink(t, m1, 'supplier');
    fake.state.postQueue.push({ status: 401, body: { detail: 'invalid api key' } });
    t.tg.reset();
    await open(t, link);
    expect(soRow(t).status).toBe('failed');
    expect(orderRow(t, 1)).toMatchObject({ status: 'confirmed', needs_action_reason: 'config' });
    const card = t.tg.of('sendMessage', ADMIN.id).map((c) => c.payload).find((p) => p.text.includes('نیازمند تصمیم'))!;
    expect(callbackDataOf(card)).toContain('fo_retry_1');
    for (const hhmm of ['09:55', '10:30']) await at(t, iso(hhmm));
    expect(posts(fake)).toHaveLength(1);
    expect(t.tg.texts(CUSTOMER.id).join('\n')).not.toContain('خطا');
  });

  it('supplier with every source disabled: the card says so and nothing is bought', async () => {
    const { t, fake, m1 } = await shop();
    const link = await makeLink(t, m1, 'supplier');
    q(t.storeDb, 'UPDATE product_sources SET is_enabled = 0');
    await open(t, link);
    expect(orderRow(t, 1)).toMatchObject({ status: 'confirmed', needs_action_reason: 'no_enabled_source' });
    expect(posts(fake)).toHaveLength(0);
  });

  it('supplier: the loss guard does not stop a purchase the admin approved when making the link', async () => {
    const { t, fake, m1 } = await shop();
    q(t.storeDb, 'UPDATE customer_products SET price = 1000 WHERE id = ?', m1); // far below the cost
    const link = await makeLink(t, m1, 'supplier');
    await open(t, link);
    expect(posts(fake)).toHaveLength(1);
    expect(orderRow(t, 1).needs_action_reason).toBeNull();
  });

  it('opening the supplier link twice (or by another customer) buys once', async () => {
    const { t, fake, m1 } = await shop();
    const link = await makeLink(t, m1, 'supplier');
    await open(t, link);
    await open(t, link);
    await open(t, link, { id: 2003, first_name: 'Sara' });
    expect(posts(fake)).toHaveLength(1);
    expect(q(t.storeDb, 'SELECT id FROM orders')).toHaveLength(1);
    expect(t.tg.texts(2003).at(-1)).toContain('دیگر قابل استفاده نیست');
  });

  it('cancelling the wizard before the end leaves no claim and no reservation', async () => {
    const { t, m1 } = await shop();
    await seedStock(t, [{ email: 'one@x.test', password: 'p1' }], 'ChatGPT', 375000);
    await start(t);
    await press(t, 'manual_prod_' + m1);
    await press(t, 'manual_ful_stock');
    await press(t, 'manual_stk_1');
    await t.send('store', callbackUpdate(ADMIN, 'manual_purchase_cancel'));
    expect(q(t.storeDb, 'SELECT id FROM manual_purchase_claims')).toHaveLength(0);
    expect(one(t.storeDb, 'SELECT status FROM stock_accounts').status).toBe('available');
  });
});

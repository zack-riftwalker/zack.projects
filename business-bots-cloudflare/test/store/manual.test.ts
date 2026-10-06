import { describe, expect, it } from 'vitest';
import { ADMIN, makeTestEnv, type TestEnv } from '../helpers/env';
import { callbackUpdate, textUpdate } from '../helpers/updates';
import { one, q, seedProduct } from '../helpers/seed';
import { buildManualPurchaseLink, createActivationToken, sha256Hex } from '../../src/store/handlers/manualPurchases';

const CUSTOMER = { id: 2002, first_name: 'Ali' };
const OTHER = { id: 2003, first_name: 'Bob' };

async function makeLink(t: TestEnv, pid: number): Promise<string> {
  await t.send('store', textUpdate(ADMIN, '🛒 ثبت خرید مشتری'));
  await t.send('store', callbackUpdate(ADMIN, 'manual_prod_' + pid));
  await t.send('store', callbackUpdate(ADMIN, 'manual_purchase_confirm'));
  const text: string = t.tg.of('sendMessage', ADMIN.id).at(-1)!.payload.text;
  const m = text.match(/\?start=(mp_[A-Za-z0-9_-]{43})/);
  expect(m).toBeTruthy();
  return m![1];
}

describe('manual purchase', () => {
  it('activation token fits a Telegram start payload and only its hash is stored', async () => {
    const { rawToken, tokenHash } = await createActivationToken();
    expect(rawToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(('mp_' + rawToken).length).toBeLessThanOrEqual(64);
    expect(tokenHash).toBe(await sha256Hex(rawToken));
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('buildManualPurchaseLink creates the deep link', () => {
    expect(buildManualPurchaseLink('shop_bot', 'abc')).toBe('https://t.me/shop_bot?start=mp_abc');
  });

  it('wizard exits cleanly when the catalog has no active products', async () => {
    const t = makeTestEnv({ monshi: false });
    await t.send('store', textUpdate(ADMIN, '🛒 ثبت خرید مشتری'));
    expect(t.tg.texts(ADMIN.id).at(-1)).toContain('محصول فعالی برای ثبت خرید وجود ندارد');
    expect(JSON.parse(one(t.storeDb, 'SELECT value FROM sessions')?.value ?? '{}').__scene).toBeUndefined();
  });

  it('wizard creates one shareable claim link; the raw token is never stored', async () => {
    const t = makeTestEnv({ monshi: false });
    const pid = seedProduct(t, { duration: 30, warranty: 7 });
    const payload = await makeLink(t, pid);
    const claims = q(t.storeDb, 'SELECT * FROM manual_purchase_claims');
    expect(claims).toHaveLength(1);
    expect(claims[0].status).toBe('pending');
    expect(claims[0].token_hash).toBe(await sha256Hex(payload.slice(3)));
    expect(JSON.stringify(claims[0])).not.toContain(payload.slice(3));
    const msg = t.tg.of('sendMessage', ADMIN.id).at(-1)!.payload;
    expect(msg.reply_markup.inline_keyboard[0][0].url).toContain('https://t.me/share/url?url=');
  });

  it('redeeming creates one delivered subscription using the approval-time clock, and is idempotent', async () => {
    const t = makeTestEnv({ monshi: false });
    const pid = seedProduct(t, { duration: 30, warranty: 7 });
    const payload = await makeLink(t, pid);
    q(t.storeDb, "UPDATE manual_purchase_claims SET approved_at = '2026-01-01 10:00:00'");

    await t.send('store', textUpdate(CUSTOMER, '/start ' + payload));
    expect(t.tg.texts(CUSTOMER.id).at(-1)).toContain('✅ خرید شما با موفقیت فعال شد.');
    const order = one(t.storeDb, 'SELECT * FROM orders');
    expect(order).toMatchObject({
      status: 'delivered', purchase_source: 'manual', customer_telegram_id: CUSTOMER.id,
      created_at: '2026-01-01 10:00:00', delivered_at: '2026-01-01 10:00:00',
      expires_at: '2026-01-31 10:00:00', warranty_expires_at: '2026-01-08 10:00:00', receipt_file_id: null,
    });
    expect(one(t.storeDb, 'SELECT display_name FROM customers WHERE telegram_id = ?', CUSTOMER.id)).toBeTruthy();
    expect(one(t.storeDb, 'SELECT status, claimed_by, order_id FROM manual_purchase_claims')).toEqual({ status: 'claimed', claimed_by: CUSTOMER.id, order_id: order.id });

    await t.send('store', textUpdate(CUSTOMER, '/start ' + payload));
    expect(t.tg.texts(CUSTOMER.id).at(-1)).toContain('ℹ️ این خرید قبلاً فعال شده است.');
    expect(q(t.storeDb, 'SELECT * FROM orders')).toHaveLength(1);
  });

  it('a different customer cannot claim an already used link', async () => {
    const t = makeTestEnv({ monshi: false });
    const payload = await makeLink(t, seedProduct(t));
    await t.send('store', textUpdate(CUSTOMER, '/start ' + payload));
    await t.send('store', textUpdate(OTHER, '/start ' + payload));
    expect(t.tg.texts(OTHER.id).at(-1)).toContain('این لینک دیگر قابل استفاده نیست');
    expect(q(t.storeDb, 'SELECT * FROM orders')).toHaveLength(1);
  });

  it('malformed / unknown payloads are consumed without touching claim data', async () => {
    const t = makeTestEnv({ monshi: false });
    await makeLink(t, seedProduct(t));
    await t.send('store', textUpdate(CUSTOMER, '/start mp_short'));
    expect(t.tg.texts(CUSTOMER.id).at(-1)).toContain('لینک فعال‌سازی نامعتبر است');
    await t.send('store', textUpdate(CUSTOMER, '/start mp_' + 'A'.repeat(43)));
    expect(t.tg.texts(CUSTOMER.id).at(-1)).toContain('لینک فعال‌سازی نامعتبر است');
    expect(one(t.storeDb, 'SELECT status FROM manual_purchase_claims').status).toBe('pending');
    expect(q(t.storeDb, 'SELECT * FROM orders')).toHaveLength(0);
  });

  it('a normal /start payload is not consumed, and an admin cannot redeem', async () => {
    const t = makeTestEnv({ monshi: false });
    const payload = await makeLink(t, seedProduct(t));
    await t.send('store', textUpdate(CUSTOMER, '/start somethingelse'));
    expect(t.tg.texts(CUSTOMER.id).at(-1)).toContain('سلام!');
    await t.send('store', textUpdate(ADMIN, '/start ' + payload));
    expect(t.tg.texts(ADMIN.id).at(-1)).toContain('توسط ادمین قابل استفاده نیست');
    expect(one(t.storeDb, 'SELECT status FROM manual_purchase_claims').status).toBe('pending');
  });

  it('claim creation survives a repeated confirmation (idempotent by creation key)', async () => {
    const t = makeTestEnv({ monshi: false });
    const pid = seedProduct(t);
    await t.send('store', textUpdate(ADMIN, '🛒 ثبت خرید مشتری'));
    await t.send('store', callbackUpdate(ADMIN, 'manual_prod_' + pid));
    await t.send('store', callbackUpdate(ADMIN, 'manual_purchase_confirm'));
    await t.send('store', callbackUpdate(ADMIN, 'manual_purchase_confirm')); // wizard already left → ignored
    expect(q(t.storeDb, 'SELECT * FROM manual_purchase_claims')).toHaveLength(1);
  });
});

describe('subscriptions & warranty', () => {
  async function delivered(t: TestEnv, extra = '') {
    const pid = seedProduct(t, { duration: 30, warranty: 7 });
    q(t.storeDb, `INSERT INTO orders (customer_telegram_id, customer_product_id, product_name, price, receipt_file_id, receipt_type, status, delivered_at, expires_at, warranty_expires_at ${extra})
      VALUES (?, ?, 'GPT Plus', 5, 'f', 'photo', 'delivered', datetime('now','+03:30','-1 days'), datetime('now','+03:30','+29 days'), datetime('now','+03:30','+6 days'))`, CUSTOMER.id, pid);
    return pid;
  }

  it('"my subscriptions" shows a card with warranty + renew buttons', async () => {
    const t = makeTestEnv({ monshi: false });
    const pid = await delivered(t);
    await t.send('store', textUpdate(CUSTOMER, '📋 اشتراک‌های من'));
    const m = t.tg.of('sendMessage', CUSTOMER.id).at(-1)!.payload;
    expect(m.text).toContain('📦 *GPT Plus*');
    expect(m.text).toContain('🛡 گارانتی: فعال تا');
    expect(m.reply_markup.inline_keyboard[0].map((b: any) => b.callback_data)).toEqual(['warranty_claim_1', 'renew_' + pid]);
  });

  it('no delivered orders → friendly empty message', async () => {
    const t = makeTestEnv({ monshi: false });
    await t.send('store', textUpdate(CUSTOMER, '📋 اشتراک‌های من'));
    expect(t.tg.texts(CUSTOMER.id).at(-1)).toContain('هنوز سفارش تحویل‌شده‌ای ندارید');
  });

  it('warranty claim: ownership check, notifies every admin once, once-per-day guard', async () => {
    const t = makeTestEnv({ monshi: false });
    await delivered(t);
    await t.send('store', callbackUpdate({ id: 9 }, 'warranty_claim_1'));
    expect(t.tg.of('answerCallbackQuery').at(-1)!.payload.text).toBe('❌ سفارش یافت نشد.');
    await t.send('store', callbackUpdate(CUSTOMER, 'warranty_claim_1'));
    expect(t.tg.of('sendMessage').filter((c) => c.payload.text?.includes('درخواست گارانتی جدید')).map((c) => c.payload.chat_id)).toEqual([1001, 1002]);
    await t.send('store', callbackUpdate(CUSTOMER, 'warranty_claim_1'));
    expect(t.tg.of('sendMessage').filter((c) => c.payload.text?.includes('درخواست گارانتی جدید'))).toHaveLength(2);
    expect(t.tg.of('answerCallbackQuery').at(-1)!.payload.text).toContain('حداکثر یک درخواست در روز');
  });

  it('warranty claim from a username with "_" reaches the admins (Markdown-escaped)', async () => {
    const t = makeTestEnv({ monshi: false });
    await delivered(t);
    await t.send('store', callbackUpdate({ ...CUSTOMER, username: 'ali_reza' }, 'warranty_claim_1'));
    const sent = t.tg.of('sendMessage').filter((c) => c.payload.text?.includes('درخواست گارانتی جدید'));
    expect(sent.map((c) => c.payload.chat_id)).toEqual([1001, 1002]);
    expect(sent[0].payload.text).toContain('@ali\\_reza');
    expect(t.tg.texts(CUSTOMER.id).at(-1)).toContain('ثبت و به ادمین اطلاع داده شد');
  });

  it('warranty claim that reaches no admin: customer is told, no once-a-day lock', async () => {
    const t = makeTestEnv({ monshi: false });
    await delivered(t);
    t.tg.fail('sendMessage', (c) => [1001, 1002].includes(c.payload.chat_id), 400, 'Bad Request', 2);
    await t.send('store', callbackUpdate(CUSTOMER, 'warranty_claim_1'));
    expect(t.tg.of('answerCallbackQuery').at(-1)!.payload.text).toContain('ناموفق بود');
    expect(one(t.storeDb, 'SELECT last_warranty_claim_at FROM orders').last_warranty_claim_at).toBeNull();
    await t.send('store', callbackUpdate(CUSTOMER, 'warranty_claim_1')); // retry works
    expect(t.tg.of('answerCallbackQuery').at(-1)!.payload.text).toBe('✅ درخواست ثبت شد.');
  });

  it('renew button restarts the purchase flow with the renewal note', async () => {
    const t = makeTestEnv({ monshi: false });
    const pid = await delivered(t);
    await t.send('store', callbackUpdate(CUSTOMER, 'renew_' + pid));
    const texts = t.tg.texts(CUSTOMER.id);
    expect(texts.at(-2)).toContain('«تمدید» یعنی دریافت یک اکانت جدید');
    expect(texts.at(-1)).toContain('🎟 آیا کد تخفیف دارید؟');
  });
});

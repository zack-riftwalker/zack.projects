import { describe, expect, it } from 'vitest';
import { ADMIN, ADMIN2, budgets } from '../helpers/env';
import { callbackUpdate, textUpdate } from '../helpers/updates';
import { one, q } from '../helpers/seed';
import { at, callbackDataOf, press, say } from './helpers';
import { buy, completedOrder, confirm, CUSTOMER, events, iso, orderRow, posts, shop, soRow, adminTexts } from './engineHelpers';
import { deliveryMessages } from '../../src/store/suppliers/engine';

describe('guards at confirm', () => {
  it('loss guard: a sale price below the cost buys nothing and asks first (then 🔁 + ✅ buys at the current cost)', async () => {
    const { t, fake, m1 } = await shop();
    // a hand-fixed price below the cost, through the real edit wizard («بله، قیمت ثابت»)
    await say(t, '✏️ ویرایش محصول');
    await press(t, 'cprod_edit_select_' + m1);
    await press(t, 'cprod_edit_f_price');
    await say(t, '500000');
    await press(t, 'cprod_edit_fixp_yes');
    expect(one(t.storeDb, 'SELECT price, pricing_mode, cost_toman FROM customer_products WHERE id = ?', m1))
      .toEqual({ price: 500000, pricing_mode: 'manual', cost_toman: 792000 });

    const orderId = await buy(t, m1);
    await confirm(t, orderId);
    expect(posts(fake)).toHaveLength(0);
    expect(one(t.storeDb, 'SELECT COUNT(*) n FROM supplier_orders').n).toBe(0);
    expect(orderRow(t, orderId)).toMatchObject({ status: 'confirmed', fulfillment: 'supplier', needs_action_reason: 'loss' });
    const card = adminTexts(t, 'قیمت پرداختی مشتری');
    expect(card).toHaveLength(1);
    expect(card[0]).toContain('خرید خودکار انجام نشد');

    await press(t, 'fo_retry_' + orderId); // asks first, still no POST
    expect(t.tg.of('editMessageText').at(-1)!.payload.text).toContain('⚠️ خرید با قیمت فعلی (≈');
    expect(posts(fake)).toHaveLength(0);
    await press(t, 'fo_retryok_' + orderId);
    expect(posts(fake)).toHaveLength(1);
    expect(soRow(t)).toMatchObject({ status: 'placed', requested_by: ADMIN.id });
  });

  it('no enabled source: a card, nothing queued; the other admin\'s press on a settled card is refused', async () => {
    const { t, fake, m1 } = await shop();
    const src = one(t.storeDb, 'SELECT id FROM product_sources WHERE customer_product_id = ?', m1).id;
    // manual stock keeps the option on sale; then the only source is switched off (e.g. after the receipt was sent)
    await press(t, 'sup_smode_' + m1);
    await press(t, 'sup_srctog_' + m1 + '_' + src);
    expect(one(t.storeDb, 'SELECT is_available, stock_mode FROM customer_products WHERE id = ?', m1)).toEqual({ is_available: 1, stock_mode: 'manual' });
    const orderId = await buy(t, m1);
    await confirm(t, orderId);
    expect(orderRow(t, orderId).needs_action_reason).toBe('no_enabled_source');
    expect(adminTexts(t, 'هیچ منبع فعالی برای این محصول نیست')).toHaveLength(1);
    expect(posts(fake)).toHaveLength(0);

    // enabled again, the admin presses 🔁: it works
    await press(t, 'sup_srctog_' + m1 + '_' + src);
    await press(t, 'fo_retry_' + orderId);
    expect(posts(fake)).toHaveLength(1);
    // pressing again from the other admin: a live order exists → refused
    await t.send('store', callbackUpdate(ADMIN2, 'fo_retry_' + orderId));
    expect(t.tg.of('answerCallbackQuery').at(-1)!.payload.text).toContain('ممکن نیست');
    expect(posts(fake)).toHaveLength(1);
  });

  it('only admins may press the card buttons', async () => {
    const { t, fake, m1 } = await shop();
    fake.state.postQueue.push('timeout');
    const orderId = await buy(t, m1);
    await confirm(t, orderId);
    for (const data of ['fo_retry_', 'fo_rid_', 'fo_resend_', 'fo_view_']) {
      await t.send('store', callbackUpdate(CUSTOMER, data + orderId));
      expect(t.tg.of('answerCallbackQuery').at(-1)!.payload.text).toContain('دسترسی ندارید');
    }
    expect(posts(fake)).toHaveLength(1);
  });
});

describe('polling (§7.4)', () => {
  it('backs off 1, 2, 5, then every 10 minutes; "pending"/"processing" keep it going and save the supplier\'s message', async () => {
    const { t, fake, m1 } = await shop();
    const orderId = await buy(t, m1);
    await confirm(t, orderId);
    fake.state.orders['5001'] = { ok: true, order_id: 5001, status: 'processing', price: '5.28', message: 'working on it' };
    const gets = () => fake.calls.filter((c) => c.method === 'GET' && c.url.endsWith('/orders/5001')).length;

    await at(t, iso('09:50')); // not due: the first poll is 1 minute after placing
    expect(gets()).toBe(0);
    await at(t, iso('09:51'));
    expect(gets()).toBe(1);
    expect(soRow(t)).toMatchObject({ checks: 1, remote_status: 'processing', last_error: 'working on it', status: 'placed' });
    await at(t, iso('09:52')); // next in 2 minutes
    expect(gets()).toBe(1);
    await at(t, iso('09:53'));
    expect(gets()).toBe(2); // then 5
    await at(t, iso('09:57'));
    expect(gets()).toBe(2);
    await at(t, iso('09:58'));
    expect(gets()).toBe(3); // then 10, 10, ...
    await at(t, iso('10:07'));
    expect(gets()).toBe(3);
    await at(t, iso('10:08'));
    expect(gets()).toBe(4);
    await at(t, iso('10:18'));
    expect(gets()).toBe(5);
    expect(orderRow(t, orderId).status).toBe('confirmed');
  });

  it('a poll error changes nothing and is retried on the next schedule', async () => {
    const { t, fake, m1 } = await shop();
    const orderId = await buy(t, m1);
    await confirm(t, orderId);
    await at(t, iso('09:51')); // the fake has no such order: 404
    expect(soRow(t)).toMatchObject({ status: 'placed', last_http: 404, checks: 1 });
    completedOrder(fake);
    await at(t, iso('09:53'));
    expect(orderRow(t, orderId).status).toBe('delivered');
  });

  it('completed with no accounts: kept polling for 3 more checks, then a card', async () => {
    const { t, fake, m1 } = await shop();
    const orderId = await buy(t, m1);
    await confirm(t, orderId);
    completedOrder(fake, '5001', { accounts: [] });
    for (let m = 51; m <= 59; m++) await at(t, iso('09:' + m));
    expect(orderRow(t, orderId).needs_action_reason).toBeNull();
    for (let m = 0; m <= 30; m++) await at(t, iso('10:' + String(m).padStart(2, '0')));
    expect(orderRow(t, orderId)).toMatchObject({ status: 'confirmed', needs_action_reason: 'completed_no_accounts' });
    expect(soRow(t).status).toBe('failed');
    expect(adminTexts(t, 'تکمیل شد ولی اکانتی برنگشت')).toHaveLength(1);
    expect(posts(fake)).toHaveLength(1);
  });

  for (const status of ['cancelled', 'failed', 'refunded', 'trash']) {
    it(`a final failure (${status}) → supplier_failed card; the ledger is untouched`, async () => {
      const { t, fake, m1 } = await shop();
      const orderId = await buy(t, m1);
      await confirm(t, orderId);
      fake.state.orders['5001'] = { ok: true, order_id: 5001, status, price: '5.28', accounts: [] };
      await at(t, iso('09:52'));
      expect(soRow(t)).toMatchObject({ status: 'failed', remote_status: status });
      expect(orderRow(t, orderId)).toMatchObject({ status: 'confirmed', needs_action_reason: 'supplier_failed' });
      const card = adminTexts(t, 'سفارش را ناموفق اعلام کرد');
      expect(card).toHaveLength(1);
      expect(card[0]).toContain('بازگشت وجه');
      expect(q(t.storeDb, "SELECT * FROM wallet_ledger WHERE kind <> 'spend'")).toHaveLength(0);
      expect(one(t.storeDb, "SELECT COUNT(*) n FROM wallet_ledger WHERE kind = 'spend'").n).toBe(1);
    });
  }
});

describe('delivery (§7.5)', () => {
  it('send failed (customer blocked the bot): a card, accounts kept, NO automatic retry; 🔁 ارسال دوباره works', async () => {
    const { t, fake, m1 } = await shop();
    const orderId = await buy(t, m1);
    await confirm(t, orderId);
    completedOrder(fake);
    t.tg.fail('sendMessage', (c) => c.payload.chat_id === CUSTOMER.id, 403, 'Forbidden: bot was blocked by the user');
    await at(t, iso('09:52'));
    expect(orderRow(t, orderId)).toMatchObject({ status: 'confirmed', needs_action_reason: 'send_failed' });
    expect(one(t.storeDb, 'SELECT sent_ok, send_error FROM order_deliveries')).toEqual({ sent_ok: 0, send_error: 'Forbidden: bot was blocked by the user' });
    expect(events(t, 'send_failed')).toHaveLength(1);
    const card = t.tg.of('sendMessage', ADMIN.id).map((c) => c.payload).find((p) => p.text.includes('تحویل نشد'))!;
    expect(card.text).toContain('Forbidden: bot was blocked by the user');
    expect(callbackDataOf(card)).toEqual(['fo_resend_' + orderId, 'fo_view_' + orderId, 'fo_msg_' + orderId]);

    // later cron minutes never send it again on their own
    t.tg.clearRules();
    t.tg.reset();
    for (let m = 53; m <= 59; m++) await at(t, iso('09:' + m));
    expect(t.tg.of('sendMessage', CUSTOMER.id).filter((c) => c.payload.text.includes('آماده است'))).toHaveLength(0);

    // 👁 shows the accounts to the admin in his own chat only
    t.tg.reset();
    await press(t, 'fo_view_' + orderId);
    expect(t.tg.of('sendMessage').map((c) => c.payload.chat_id)).toEqual([ADMIN.id]);
    expect(t.tg.of('sendMessage')[0].payload.text).toContain('<code>a@b.c</code>');

    // 🔁 explicit resend
    t.tg.reset();
    await press(t, 'fo_resend_' + orderId);
    const sent = t.tg.of('sendMessage', CUSTOMER.id);
    expect(sent).toHaveLength(1);
    expect(sent[0].payload.text).toContain('آماده است');
    expect(orderRow(t, orderId)).toMatchObject({ status: 'delivered', needs_action_reason: null, cost_toman: 792000 });
    expect(one(t.storeDb, 'SELECT sent_ok FROM order_deliveries').sent_ok).toBe(1);
    expect(t.tg.of('editMessageText').at(-1)!.payload.text).toContain('دوباره ارسال شد توسط Admin');
    expect(posts(fake)).toHaveLength(1);
  });

  it('the 20-hour deadline: the card comes once, automatic tries stop; a placed order keeps polling', async () => {
    const { t, fake, sid, m1 } = await shop();
    fake.state.postQueue.push(...Array.from({ length: 6 }, () => ({ status: 409, body: { detail: 'out of stock' } })));
    const orderId = await buy(t, m1);
    await confirm(t, orderId); // 09:50 → deadline 05:50 next day
    const day2 = '2026-10-26';
    await at(t, iso('05:49', day2));
    expect(adminTexts(t, '۲۰ ساعت از تأیید')).toHaveLength(0);
    await at(t, iso('06:00', day2));
    const cards = adminTexts(t, '⏰ ۲۰ ساعت از تأیید سفارش #' + orderId + ' گذشته و هنوز تحویل نشده.');
    expect(cards).toHaveLength(1);
    expect(orderRow(t, orderId)).toMatchObject({ needs_action_reason: 'deadline', stalled_alert_sent: 1 });
    expect(q(t.storeDb, 'SELECT status FROM supplier_orders').every((r) => r.status === 'cancelled')).toBe(true);
    const postsAt = posts(fake).length;
    await at(t, iso('06:30', day2));
    await at(t, iso('12:00', day2));
    expect(adminTexts(t, '۲۰ ساعت از تأیید')).toHaveLength(1);
    expect(posts(fake)).toHaveLength(postsAt); // cancelled: no more automatic tries
    expect(callbackDataOf(t.tg.of('sendMessage', ADMIN.id).find((c) => c.payload.text.includes('۲۰ ساعت'))!.payload)).toEqual(['fo_retry_' + orderId, 'fo_msg_' + orderId]);
    expect(sid).toBeGreaterThan(0);
  });

  it('the deadline for an order that is placed but not finished: same card with the supplier status, polling continues', async () => {
    const { t, fake, m1 } = await shop();
    const orderId = await buy(t, m1);
    await confirm(t, orderId);
    fake.state.orders['5001'] = { ok: true, order_id: 5001, status: 'processing', price: '5.28' };
    await at(t, iso('06:00', '2026-10-26'));
    const cards = adminTexts(t, '(در صف تأمین‌کننده: processing)');
    expect(cards).toHaveLength(1);
    expect(soRow(t).status).toBe('placed');
    completedOrder(fake);
    await at(t, iso('06:20', '2026-10-26'));
    expect(orderRow(t, orderId)).toMatchObject({ status: 'delivered', needs_action_reason: null });
  });

  it('a delivery that did not fit the budget stays «completed» and the next cron minute sends it', async () => {
    const { t, fake, m1 } = await shop();
    const orderId = await buy(t, m1);
    await confirm(t, orderId);
    completedOrder(fake);
    // this one cron invocation starts with most of its budget already spent
    t.deps.onBudget = (b) => { budgets.push(b); b.used = 34; };
    await at(t, iso('09:52'));
    expect(soRow(t)).toMatchObject({ status: 'completed' });
    expect(soRow(t).next_check_at).toBeTruthy();
    expect(orderRow(t, orderId).status).toBe('confirmed');
    expect(t.tg.of('sendMessage', CUSTOMER.id).filter((c) => c.payload.text.includes('آماده است'))).toHaveLength(0);
    expect(one(t.storeDb, 'SELECT sent_ok FROM order_deliveries').sent_ok).toBe(0); // the accounts are safe in D1

    t.deps.onBudget = (b) => { budgets.push(b); };
    await at(t, iso('09:58'));
    expect(orderRow(t, orderId).status).toBe('delivered');
    expect(t.tg.of('sendMessage', CUSTOMER.id).filter((c) => c.payload.text.includes('آماده است'))).toHaveLength(1);
    expect(soRow(t).next_check_at).toBeNull();
  });

  it('a price the supplier reports that matches neither unit nor total → a price_mismatch event and a line for the admin', async () => {
    const { t, fake, m1 } = await shop();
    fake.state.postQueue.push({ status: 200, body: { ok: true, order_id: 5001, status: 'pending', price: 99 } });
    const orderId = await buy(t, m1);
    await confirm(t, orderId);
    expect(events(t, 'price_mismatch')).toHaveLength(1);
    expect(soRow(t)).toMatchObject({ price_usd: 5.28, cost_toman: 792000 }); // the cost stays the catalog's
    completedOrder(fake, '5001', { price: '99' });
    await at(t, iso('09:52'));
    const msg = t.tg.of('sendMessage', ADMIN.id).map((c) => c.payload).find((p) => p.text.includes('تحویل شد'))!;
    expect(msg.text).toContain('قیمت اعلام‌شده‌ی تأمین‌کننده ($99) با قیمت کاتالوگ ($5.28) نمی‌خواند');
  });

  it('a price within 2 % of the unit or the total price is no mismatch', async () => {
    const { t, fake, m1 } = await shop();
    fake.state.postQueue.push({ status: 200, body: { ok: true, order_id: 5001, status: 'pending', price: 5.3 } });
    const orderId = await buy(t, m1);
    await confirm(t, orderId);
    expect(events(t, 'price_mismatch')).toHaveLength(0);
  });
});

describe('«📋 اشتراک‌های من» shows the account again (acct_show)', () => {
  it('the owner gets the stored block; another customer and a forged id get nothing', async () => {
    const { t, fake, m1 } = await shop();
    const orderId = await buy(t, m1);
    await confirm(t, orderId);
    completedOrder(fake);
    await at(t, iso('09:52'));

    t.tg.reset();
    await t.send('store', textUpdate(CUSTOMER, '📋 اشتراک‌های من'));
    const card = t.tg.of('sendMessage', CUSTOMER.id).at(-1)!.payload;
    expect(callbackDataOf(card)).toContain('acct_show_' + orderId);

    t.tg.reset();
    await t.send('store', callbackUpdate(CUSTOMER, 'acct_show_' + orderId));
    const shown = t.tg.of('sendMessage', CUSTOMER.id);
    expect(shown).toHaveLength(1);
    expect(shown[0].payload.text).toContain('<code>a@b.c</code>');
    expect(shown[0].payload.parse_mode).toBe('HTML');
    expect(budgets.at(-1)!.used).toBeLessThanOrEqual(5);

    t.tg.reset();
    const other = { id: 2999, first_name: 'Eve' };
    await t.send('store', callbackUpdate(other, 'acct_show_' + orderId));
    expect(t.tg.of('sendMessage')).toHaveLength(0);
    expect(t.tg.of('answerCallbackQuery').at(-1)!.payload.text).toContain('سفارش یافت نشد');
    await t.send('store', callbackUpdate(CUSTOMER, 'acct_show_999'));
    expect(t.tg.of('sendMessage')).toHaveLength(0);
  });

  it('an order without stored accounts (a normal product) has no button', async () => {
    const { t } = await shop();
    const plain = Number(t.storeDb.sqlite.prepare("INSERT INTO customer_products (name, price) VALUES ('Plain', 1000)").run().lastInsertRowid);
    t.storeDb.sqlite.prepare(`INSERT INTO orders (customer_telegram_id, customer_product_id, product_name, price, status, delivered_at)
      VALUES (?, ?, 'Plain', 1000, 'delivered', datetime('now', '+03:30'))`).run(CUSTOMER.id, plain);
    await t.send('store', textUpdate(CUSTOMER, '📋 اشتراک‌های من'));
    expect(callbackDataOf(t.tg.of('sendMessage', CUSTOMER.id).at(-1)!.payload)).not.toContain('acct_show_1');
  });
});

describe('message formatting', () => {
  it('a long account is split under 3,500 characters; each part is valid and ends with the continue note', () => {
    const long = 'x&'.repeat(4000);
    const parts = deliveryMessages('P', { text: long });
    expect(parts.length).toBeGreaterThan(1);
    for (const [i, p] of parts.entries()) {
      expect(p.length).toBeLessThanOrEqual(3500);
      expect((p.match(/<code>/g) ?? []).length).toBe((p.match(/<\/code>/g) ?? []).length);
      expect(p.includes('(…ادامه در پیام بعد)')).toBe(i < parts.length - 1);
      expect(p).not.toMatch(/&(?!amp;|lt;|gt;|quot;)/); // no entity cut in half
    }
  });
});

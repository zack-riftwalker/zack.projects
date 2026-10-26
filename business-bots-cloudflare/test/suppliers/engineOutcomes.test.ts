import { describe, expect, it } from 'vitest';
import { ADMIN } from '../helpers/env';
import { one, q } from '../helpers/seed';
import { at, callbackDataOf, press, say } from './helpers';
import {
  addBackupSource, adminTexts, buy, completedOrder, confirm, events, iso, orderRow, posts, shop, soRow,
} from './engineHelpers';

const T0 = '09:50';

describe('§7.3 table: one test per result', () => {
  it('out_of_stock on source 1 → source 2 is used in the same round (2 POSTs); the first source rests 30 minutes', async () => {
    const { t, fake, sid, m1 } = await shop();
    const backup = await addBackupSource(t, sid, m1);
    fake.state.postQueue.push({ status: 409, body: { detail: 'out of stock' } });
    const orderId = await buy(t, m1);
    await confirm(t, orderId);

    expect(posts(fake).map((c) => c.body.product_id)).toEqual(['1300', '1400']);
    expect(soRow(t)).toMatchObject({ status: 'placed', source_id: backup, price_usd: 5.5, cost_toman: 825000 });
    const first = one(t.storeDb, 'SELECT oos_until FROM product_sources WHERE priority = 1 AND customer_product_id = ?', m1);
    expect(first.oos_until).toBeTruthy();
    expect(events(t, 'out_of_stock')).toHaveLength(1);
    expect(adminTexts(t, 'نیازمند تصمیم')).toHaveLength(0); // nothing for the admin: the backup worked
  });

  it('all sources out of stock → retried every 15 minutes, ONE admin notice; the sources are not hammered', async () => {
    const { t, fake, sid, m1 } = await shop();
    await addBackupSource(t, sid, m1);
    fake.state.postQueue.push(...Array.from({ length: 4 }, () => ({ status: 409, body: { detail: 'out of stock' } })));
    const orderId = await buy(t, m1);
    await confirm(t, orderId);
    expect(posts(fake)).toHaveLength(2);
    expect(soRow(t).status).toBe('queued');
    expect(orderRow(t, orderId).needs_action_reason).toBe('all_out_of_stock');
    const notice = adminTexts(t, 'همه‌ی منبع‌ها ناموجودند');
    expect(notice).toHaveLength(1);
    expect(notice[0]).toContain('ربات هر ۱۵ دقیقه دوباره تلاش می‌کند تا');
    expect(callbackDataOf(t.tg.of('sendMessage', ADMIN.id).at(-1)!.payload)).toEqual([
      'fo_src_' + orderId, 'fo_stock_' + orderId, 'fo_text_' + orderId, 'fo_self_' + orderId, 'fo_cancel_' + orderId, 'fo_msg_' + orderId, 'fo_hist_' + orderId,
    ]); // queued: waiting by itself, so no «تلاش دوباره»

    await at(t, iso('10:06')); // the sources still rest (30 minutes): no POST
    expect(posts(fake)).toHaveLength(2);
    await at(t, iso('10:21')); // rested: both tried again, both 409
    expect(posts(fake)).toHaveLength(4);
    expect(adminTexts(t, 'همه‌ی منبع‌ها ناموجودند')).toHaveLength(1);

    await at(t, iso('10:53')); // they rested again (until 10:51) and the queue is empty now: the fake accepts
    expect(posts(fake)).toHaveLength(5);
    expect(soRow(t).status).toBe('placed');
    expect(orderRow(t, orderId).needs_action_reason).toBeNull(); // the earlier card is settled
    expect(adminTexts(t, 'همه‌ی منبع‌ها ناموجودند')).toHaveLength(1);
  });

  it('retry_later (503): queued 15 minutes on, one card; a wallet message uses the low-balance header', async () => {
    const { t, fake, m1 } = await shop();
    fake.state.postQueue.push({ status: 503, body: { detail: 'busy' } }, { status: 503, body: { detail: 'busy again' } });
    const orderId = await buy(t, m1);
    await confirm(t, orderId);
    expect(soRow(t)).toMatchObject({ status: 'queued', last_http: 503, last_error: 'busy', attempts: 1 });
    expect(adminTexts(t, 'تأمین‌کننده فعلاً سفارش را نپذیرفت')).toHaveLength(1);
    expect(events(t, 'place_failed')).toHaveLength(1);

    await at(t, iso('10:00')); // not due yet (09:50 + 15 min = 10:05)
    expect(posts(fake)).toHaveLength(1);
    await at(t, iso('10:06'));
    expect(posts(fake)).toHaveLength(2);
    expect(adminTexts(t, 'تأمین‌کننده فعلاً سفارش را نپذیرفت')).toHaveLength(1); // one card, not one per try
    await at(t, iso('10:22'));
    expect(soRow(t).status).toBe('placed');
    expect(orderRow(t, orderId).needs_action_reason).toBeNull();
  });

  it('a refusal that mentions the wallet → the «شارژ کنید» header', async () => {
    const { t, fake, m1 } = await shop();
    fake.state.postQueue.push({ status: 402, body: { detail: 'Insufficient balance' } });
    const orderId = await buy(t, m1);
    await confirm(t, orderId);
    expect(soRow(t)).toMatchObject({ status: 'queued', last_http: 402 });
    expect(adminTexts(t, '💳 موجودی کیف پول «ArioBox Main» کافی نیست — لطفاً شارژ کنید.')).toHaveLength(1);
    expect(posts(fake)).toHaveLength(1);
  });

  it('config (401): failed, the card says to fix the key; no automatic retry; 🔁 after the fix places it', async () => {
    const { t, fake, m1 } = await shop();
    fake.state.postQueue.push({ status: 401, body: { detail: 'invalid api key' } });
    const orderId = await buy(t, m1);
    await confirm(t, orderId);
    expect(soRow(t)).toMatchObject({ status: 'failed', last_http: 401 });
    expect(orderRow(t, orderId).needs_action_reason).toBe('config');
    const card = adminTexts(t, 'تنظیمات «ArioBox Main» مشکل دارد (invalid api key)');
    expect(card).toHaveLength(1);
    expect(callbackDataOf(t.tg.of('sendMessage', ADMIN.id).at(-1)!.payload)).toEqual([
      'fo_retry_' + orderId, 'fo_src_' + orderId, 'fo_stock_' + orderId, 'fo_text_' + orderId, 'fo_self_' + orderId, 'fo_cancel_' + orderId, 'fo_msg_' + orderId, 'fo_hist_' + orderId,
    ]);

    for (let m = 1; m <= 30; m++) await at(t, iso('10:' + String(m).padStart(2, '0')));
    expect(posts(fake)).toHaveLength(1);

    await press(t, 'fo_retry_' + orderId);
    expect(posts(fake)).toHaveLength(2);
    expect(q(t.storeDb, 'SELECT status FROM supplier_orders ORDER BY id').map((r) => r.status)).toEqual(['failed', 'placed']);
    expect(orderRow(t, orderId).needs_action_reason).toBeNull();
    expect(events(t, 'admin_retry')).toHaveLength(1);
    expect(events(t, 'admin_retry')[0].actor).toBe(ADMIN.id);
    // the pressed card is edited to show the outcome
    expect(t.tg.of('editMessageText').at(-1)!.payload.text).toContain('🔁 تلاش دوباره ثبت شد توسط Admin');
  });

  it('rejected (400): failed with the detail on the card, never retried automatically', async () => {
    const { t, fake, m1 } = await shop();
    fake.state.postQueue.push({ status: 400, body: { detail: 'invalid quantity' } });
    const orderId = await buy(t, m1);
    await confirm(t, orderId);
    expect(soRow(t)).toMatchObject({ status: 'failed', last_http: 400 });
    expect(orderRow(t, orderId).needs_action_reason).toBe('rejected');
    expect(adminTexts(t, 'invalid quantity')).toHaveLength(1);
    await at(t, iso('10:30'));
    expect(posts(fake)).toHaveLength(1);
  });
});

describe('unknown: never a second POST on its own', () => {
  for (const [name, response] of [
    ['timeout', 'timeout' as const],
    ['network error', 'network' as const],
    ['HTTP 500', { status: 500, body: { detail: 'boom' } }],
    ['2xx without an order id', { status: 200, body: { ok: true } }],
  ] as const) {
    it(name + ' → unknown, the card has the two buttons, and 30 simulated cron minutes send no second POST', async () => {
      const { t, fake, m1 } = await shop();
      fake.state.postQueue.push(response);
      const orderId = await buy(t, m1);
      await confirm(t, orderId);
      expect(posts(fake)).toHaveLength(1);
      expect(soRow(t).status).toBe('unknown');
      expect(orderRow(t, orderId).needs_action_reason).toBe('unknown');
      const card = adminTexts(t, 'معلوم نیست سفارش در «ArioBox Main» ثبت شده یا نه');
      expect(card).toHaveLength(1);
      expect(card[0]).toContain('store#' + orderId);
      expect(callbackDataOf(t.tg.of('sendMessage', ADMIN.id).at(-1)!.payload)).toEqual([
        'fo_rid_' + orderId, 'fo_retry_' + orderId, 'fo_src_' + orderId, 'fo_stock_' + orderId, 'fo_text_' + orderId, 'fo_self_' + orderId,
        'fo_cancel_' + orderId, 'fo_msg_' + orderId, 'fo_hist_' + orderId,
      ]);
      expect(q(t.storeDb, 'SELECT * FROM wallet_ledger')).toHaveLength(0); // we don't know that it was bought

      for (let m = 1; m <= 30; m++) await at(t, iso('10:' + String(m).padStart(2, '0')));
      expect(posts(fake)).toHaveLength(1);
      expect(soRow(t).status).toBe('unknown');
      expect(adminTexts(t, 'معلوم نیست')).toHaveLength(1);
    });
  }

  it('the worker dies after sending (lease runs out) → unknown, not retried', async () => {
    const { t, fake, m1 } = await shop();
    const orderId = await buy(t, m1);
    // the D1 batch that records «placed» fails: the POST went out, the row stays `placing`
    const batch = t.storeDb.batch.bind(t.storeDb);
    t.storeDb.batch = (async (stmts: any[]) => {
      if (stmts.some((s) => String(s.sql).includes("SET status = 'placed'"))) throw new Error('D1 is down');
      return batch(stmts);
    }) as any;
    await confirm(t, orderId);
    t.storeDb.batch = batch as any;
    expect(posts(fake)).toHaveLength(1);
    expect(soRow(t)).toMatchObject({ status: 'placing' });

    await at(t, iso('09:52')); // lease (3 minutes) still valid
    expect(soRow(t).status).toBe('placing');
    await at(t, iso('09:55'));
    expect(soRow(t).status).toBe('unknown');
    expect(orderRow(t, orderId).needs_action_reason).toBe('unknown');
    expect(adminTexts(t, 'معلوم نیست')).toHaveLength(1);
    for (let m = 56; m <= 59; m++) await at(t, iso('09:' + m));
    expect(posts(fake)).toHaveLength(1);
  });

  it('the admin knows the order exists: fo_rid takes its number, polling starts, the ledger records the spend, delivery follows', async () => {
    const { t, fake, m1 } = await shop();
    fake.state.postQueue.push('timeout');
    const orderId = await buy(t, m1);
    await confirm(t, orderId);
    await press(t, 'fo_rid_' + orderId);
    await say(t, 'abc');
    expect(t.tg.texts(ADMIN.id).at(-1)).toContain('فقط عدد');
    await say(t, '۷۷۷');
    expect(soRow(t)).toMatchObject({ status: 'placed', remote_order_id: '777', checks: 0 });
    expect(orderRow(t, orderId).needs_action_reason).toBeNull();
    expect(one(t.storeDb, "SELECT amount_usd FROM wallet_ledger WHERE kind = 'spend'").amount_usd).toBe(-5.28);
    expect(events(t, 'remote_id_set')[0]).toMatchObject({ actor: ADMIN.id, detail: '777' });

    completedOrder(fake, '777');
    await at(t, iso('09:52'));
    expect(orderRow(t, orderId).status).toBe('delivered');
    expect(posts(fake)).toHaveLength(1);
    // pressing it again does nothing (the supplier order is no longer unknown)
    await press(t, 'fo_rid_' + orderId);
    expect(t.tg.of('answerCallbackQuery').at(-1)!.payload.text).toContain('قبلاً تصمیم گرفته شد');
  });

  it('the admin says «not placed» (🔁): exactly one more POST, and only that press causes it', async () => {
    const { t, fake, m1 } = await shop();
    fake.state.postQueue.push('timeout');
    const orderId = await buy(t, m1);
    await confirm(t, orderId);
    await press(t, 'fo_retry_' + orderId);
    expect(posts(fake)).toHaveLength(2);
    expect(q(t.storeDb, 'SELECT status FROM supplier_orders ORDER BY id').map((r) => r.status)).toEqual(['unknown', 'placed']);
    // a second press (the same or another admin) finds a live order and adds nothing
    await press(t, 'fo_retry_' + orderId);
    expect(posts(fake)).toHaveLength(2);
    expect(one(t.storeDb, 'SELECT COUNT(*) n FROM supplier_orders').n).toBe(2);
  });
});

describe('claims and races', () => {
  it('the webhook kick and two cron ticks in the same minute still make ONE POST (the claim)', async () => {
    const { t, fake, m1 } = await shop();
    fake.state.postQueue.push({ status: 503, body: { detail: 'busy' } });
    const orderId = await buy(t, m1);
    await confirm(t, orderId);
    expect(posts(fake)).toHaveLength(1); // the 503
    t.deps.now = () => new Date(iso('10:06'));
    await Promise.all([t.cron(new Date(iso('10:06'))), t.cron(new Date(iso('10:06'))), t.cron(new Date(iso('10:06')))]);
    expect(posts(fake)).toHaveLength(2);
    expect(soRow(t)).toMatchObject({ status: 'placed', attempts: 2 });
    expect(orderRow(t, orderId).status).toBe('confirmed');
  });

  it('confirming twice makes one supplier order and one POST', async () => {
    const { t, fake, m1 } = await shop();
    const orderId = await buy(t, m1);
    await confirm(t, orderId);
    await confirm(t, orderId);
    expect(one(t.storeDb, 'SELECT COUNT(*) n FROM supplier_orders').n).toBe(1);
    expect(posts(fake)).toHaveLength(1);
  });
});

describe('a confirm that could not finish queueing', () => {
  it('the cron finishes it (one supplier order, one POST), so the customer is not left waiting for 20 hours', async () => {
    const { t, fake, m1 } = await shop();
    const orderId = await buy(t, m1);
    // D1 refuses the INSERT of the supplier order during the confirm
    const batch = t.storeDb.batch.bind(t.storeDb);
    t.storeDb.batch = (async (stmts: any[]) => {
      if (stmts.some((s) => String(s.sql).includes('INSERT INTO supplier_orders'))) throw new Error('D1 is down');
      return batch(stmts);
    }) as any;
    await confirm(t, orderId);
    t.storeDb.batch = batch as any;
    expect(one(t.storeDb, 'SELECT COUNT(*) n FROM supplier_orders').n).toBe(0);
    expect(orderRow(t, orderId)).toMatchObject({ status: 'confirmed', fulfillment: 'supplier' });

    await at(t, iso('09:50')); // a 60 s grace for a confirm that is still running
    expect(posts(fake)).toHaveLength(0);
    await at(t, iso('09:52'));
    expect(posts(fake)).toHaveLength(1);
    expect(one(t.storeDb, 'SELECT COUNT(*) n FROM supplier_orders').n).toBe(1);
    await at(t, iso('09:53'));
    expect(posts(fake)).toHaveLength(1);
  });
});

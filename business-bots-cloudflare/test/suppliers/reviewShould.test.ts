import { describe, expect, it } from 'vitest';
import { ADMIN, budgets, type TestEnv } from '../helpers/env';
import { one, q } from '../helpers/seed';
import { itemRef } from '../../src/store/suppliers/store';
import { at, callbackDataOf, press, say } from './helpers';
import {
  CUSTOMER, addBackupSource, adminTexts, buy, completedOrder, confirm, events, failedOrder, iso, orderRow, posts, seedStock, shop, soRow,
} from './engineHelpers';

/** Opus review: should-fix S1–S8 and the nits (SUPPLIER_PLAN.md §7.5, §8.3, §10.1, §14). */

const customerMessages = (t: any) => t.tg.of('sendMessage', CUSTOMER.id).filter((c: any) => c.payload.text.includes('آماده است'));

/** Runs `fn` while the next customer-facing sendMessage is in flight (after the sender's own checks, before its bookkeeping). */
function onNextCustomerSend(t: TestEnv): (fn: () => Promise<void>) => void {
  let pending: (() => Promise<void>) | null = null;
  const orig = t.deps.makeApi!;
  t.deps.makeApi = (token: string) => {
    const api = orig(token);
    api.config.use(async (prev, method, payload, signal) => {
      if (method === 'sendMessage' && (payload as any).chat_id === CUSTOMER.id && pending) {
        const fn = pending;
        pending = null;
        await fn();
      }
      return prev(method, payload, signal);
    });
    return api;
  };
  return (fn) => { pending = fn; };
}

/** Placed supplier order, the supplier already completed it; the admin has typed account text and sees the preview. */
async function racingSetup() {
  const s = await shop();
  const orderId = await buy(s.t, s.m1);
  await confirm(s.t, orderId);
  completedOrder(s.fake);
  return { ...s, orderId };
}

describe('S2: one delivery at a time (the delivery claim)', () => {
  it('supplier delivery racing «✍️ ارسال متن اکانت»: the customer gets ONE message and the order keeps the supplier\'s fulfillment and cost', async () => {
    const { t, orderId } = await racingSetup();
    await press(t, 'fo_text_' + orderId);
    await say(t, 'manual account');
    onNextCustomerSend(t)(async () => { await press(t, 'fo_textok_' + orderId); });
    await at(t, iso('09:52'));
    expect(customerMessages(t)).toHaveLength(1);
    expect(orderRow(t, orderId)).toMatchObject({ status: 'delivered', fulfillment: 'supplier', cost_toman: 792000 });
    expect(q(t.storeDb, 'SELECT kind, sent_ok FROM order_deliveries ORDER BY id').filter((d) => d.kind === 'manual_text')).toEqual([]);
    expect(t.tg.of('answerCallbackQuery').at(-1)!.payload.text).toContain('قبلاً تصمیم گرفته شد');
  });

  it('supplier delivery racing «📦 از اکانت‌های من»: one message, the stock account stays available', async () => {
    const { t, orderId } = await racingSetup();
    await seedStock(t, [{ email: 'stock@x.test', password: 'pw' }]);
    onNextCustomerSend(t)(async () => { await press(t, 'fo_stkok_' + orderId + '_1'); });
    await at(t, iso('09:52'));
    expect(customerMessages(t)).toHaveLength(1);
    expect(orderRow(t, orderId)).toMatchObject({ status: 'delivered', fulfillment: 'supplier', cost_toman: 792000 });
    expect(one(t.storeDb, 'SELECT status, order_id FROM stock_accounts WHERE id = 1')).toEqual({ status: 'available', order_id: null });
  });

  it('the inline delivery racing the cron\'s redelivery: one message (the claim holds even when the retry time is due)', async () => {
    const { t, orderId } = await racingSetup();
    onNextCustomerSend(t)(async () => {
      q(t.storeDb, "UPDATE supplier_orders SET next_check_at = '2000-01-01 00:00:00' WHERE id = 1");
      await t.cron(new Date(iso('09:52')));
    });
    await at(t, iso('09:52'));
    expect(customerMessages(t)).toHaveLength(1);
    expect(orderRow(t, orderId)).toMatchObject({ status: 'delivered', fulfillment: 'supplier', cost_toman: 792000 });
  });

  it('the completion batch leaves the retry for 5 minutes later, not "now"', async () => {
    const { t, orderId } = await racingSetup();
    t.deps.onBudget = (b) => { budgets.push(b); b.used = 34; };
    await at(t, iso('09:52'));
    t.deps.onBudget = (b) => { budgets.push(b); };
    expect(orderRow(t, orderId).status).toBe('confirmed');
    expect(soRow(t).next_check_at).toBe('2026-10-25 13:27:00'); // 09:52Z = 13:22 Tehran, + 5 min
  });

  it('a failed send releases the claim, so «🔁 ارسال دوباره» can claim again', async () => {
    const { t, orderId } = await racingSetup();
    t.tg.fail('sendMessage', (c) => c.payload.chat_id === CUSTOMER.id, 403, 'Forbidden: bot was blocked by the user');
    await at(t, iso('09:52'));
    expect(orderRow(t, orderId)).toMatchObject({ status: 'confirmed', needs_action_reason: 'send_failed', delivery_claimed_at: null });
    t.tg.clearRules();
    await press(t, 'fo_resend_' + orderId);
    expect(orderRow(t, orderId).status).toBe('delivered');
    expect(customerMessages(t)).toHaveLength(2); // the failed attempt was recorded by the fake too
  });
});

describe('S2: nothing else changes the order while its delivery is being sent', () => {
  it('🙋 and ❌ pressed while the supplier\'s accounts are on their way are refused; the order is delivered by the supplier', async () => {
    const { t, orderId } = await racingSetup();
    onNextCustomerSend(t)(async () => {
      await press(t, 'fo_self_' + orderId);
      expect(t.tg.of('answerCallbackQuery').at(-1)!.payload.text).toContain('قبلاً تصمیم گرفته شد');
      await press(t, 'fo_cancel_' + orderId);
      await press(t, 'fo_cr_' + orderId + '_none');
      await press(t, 'fo_cok_' + orderId);
      expect(t.tg.of('answerCallbackQuery').at(-1)!.payload.text).toContain('قبلاً تصمیم گرفته شد');
    });
    await at(t, iso('09:52'));
    expect(customerMessages(t)).toHaveLength(1);
    expect(orderRow(t, orderId)).toMatchObject({ status: 'delivered', fulfillment: 'supplier', cost_toman: 792000, refund_status: null });
    expect(q(t.storeDb, 'SELECT id FROM stock_batches')).toHaveLength(0);
  });
});

describe('N3: a manual delivery the budget could not send is kept and the cron sends it', () => {
  it('«deferred» inside fo_stkok: the delivery row waits, the account stays reserved, the cron delivers it', async () => {
    const { t, fake, m1 } = await shop();
    const orderId = await failedOrder(t, fake, m1);
    await seedStock(t, [{ email: 's@x.test', password: 'pw' }]);
    // the budget runs low right after the admin's claim, before the send
    const batch = t.storeDb.batch.bind(t.storeDb);
    t.storeDb.batch = (async (stmts: any[]) => {
      const rs = await batch(stmts);
      if (stmts.some((s) => String(s.sql).includes("SET fulfillment = 'stock'"))) budgets.at(-1)!.used = 45;
      return rs;
    }) as any;
    await press(t, 'fo_stkok_' + orderId + '_1');
    t.storeDb.batch = batch as any;
    expect(customerMessages(t)).toHaveLength(0);
    expect(orderRow(t, orderId)).toMatchObject({ status: 'confirmed', fulfillment: 'stock' });
    expect(one(t.storeDb, 'SELECT status FROM stock_accounts').status).toBe('reserved');
    expect(q(t.storeDb, 'SELECT kind, sent_ok, stock_account_id FROM order_deliveries')).toEqual([{ kind: 'stock', sent_ok: 0, stock_account_id: 1 }]);

    await at(t, iso('09:58'));
    expect(customerMessages(t)).toHaveLength(1);
    expect(orderRow(t, orderId)).toMatchObject({ status: 'delivered', fulfillment: 'stock', cost_toman: 750000 });
    expect(one(t.storeDb, 'SELECT status FROM stock_accounts').status).toBe('delivered');
    await at(t, iso('10:10'));
    expect(customerMessages(t)).toHaveLength(1); // once
  });

  it('«skipped» inside fo_stkok (the order changed after the claim): the reservation is released and the admin is told', async () => {
    const { t, fake, m1 } = await shop();
    const orderId = await failedOrder(t, fake, m1);
    await seedStock(t, [{ email: 's@x.test', password: 'pw' }]);
    const batch = t.storeDb.batch.bind(t.storeDb);
    t.storeDb.batch = (async (stmts: any[]) => {
      const rs = await batch(stmts);
      if (stmts.some((s) => String(s.sql).includes("SET fulfillment = 'stock'"))) {
        t.storeDb.batch = batch as any;
        q(t.storeDb, "UPDATE orders SET status = 'cancelled' WHERE id = ?", orderId); // someone else, between the claim and the send
      }
      return rs;
    }) as any;
    await press(t, 'fo_stkok_' + orderId + '_1');
    t.storeDb.batch = batch as any;
    expect(customerMessages(t)).toHaveLength(0);
    expect(one(t.storeDb, 'SELECT status, order_id FROM stock_accounts')).toEqual({ status: 'available', order_id: null });
    expect(t.tg.of('answerCallbackQuery').at(-1)!.payload.text).toContain('ممکن نیست');
  });
});

describe('S5: undo after the accounts were diverted does not leave the order stuck', () => {
  it('🙋 → the supplier\'s accounts go to stock → ↩️ queues a new supplier order and the order is delivered', async () => {
    const { t, fake, m1 } = await shop();
    const orderId = await buy(t, m1);
    await confirm(t, orderId);
    await press(t, 'fo_self_' + orderId);
    completedOrder(fake);
    await at(t, iso('09:52'));
    expect(q(t.storeDb, 'SELECT id FROM stock_batches WHERE supplier_order_id = 1')).toHaveLength(1);

    fake.state.postQueue.push({ status: 200, body: { ok: true, order_id: 5002, status: 'pending', price: 5.28 } });
    await press(t, 'fo_undo_' + orderId);
    expect(posts(fake)).toHaveLength(2);
    expect(q(t.storeDb, 'SELECT status FROM supplier_orders ORDER BY id').map((r) => r.status)).toEqual(['completed', 'placed']);
    expect(orderRow(t, orderId)).toMatchObject({ fulfillment: 'supplier', needs_action_reason: null });

    completedOrder(fake, '5002');
    await at(t, iso('09:58'));
    expect(orderRow(t, orderId).status).toBe('delivered');
    expect(customerMessages(t)).toHaveLength(1);
    expect(q(t.storeDb, 'SELECT id FROM stock_batches WHERE supplier_order_id = 1')).toHaveLength(1);
  });
});

describe('S5 (continued): an undo that queued nothing says so', () => {
  it('the order changed between the undo and the queueing: the admin is told, the card state is not cleared', async () => {
    const { t, fake, m1 } = await shop();
    const orderId = await buy(t, m1);
    await confirm(t, orderId);
    await press(t, 'fo_self_' + orderId);
    q(t.storeDb, "UPDATE supplier_orders SET status = 'cancelled'"); // nothing stands for the order any more
    const batch = t.storeDb.batch.bind(t.storeDb);
    t.storeDb.batch = (async (stmts: any[]) => {
      const rs = await batch(stmts);
      if (stmts.some((s) => String(s.sql).includes("fulfillment = 'supplier', supplier_deadline_at"))) {
        t.storeDb.batch = batch as any;
        q(t.storeDb, "UPDATE orders SET status = 'cancelled' WHERE id = ?", orderId); // another admin cancelled meanwhile
      }
      return rs;
    }) as any;
    await press(t, 'fo_undo_' + orderId);
    t.storeDb.batch = batch as any;
    expect(posts(fake)).toHaveLength(1);
    expect(t.tg.of('answerCallbackQuery').at(-1)!.payload.text).toContain('سفارش خریدی ثبت نشد');
  });
});

describe('S8: an unknown order resolved by hand can still get its remote number', () => {
  it('cancel an unknown order → /order shows 🔢 → the number → poll completes → one stock batch, one ledger spend', async () => {
    const { t, fake, m1 } = await shop();
    fake.state.postQueue.push('timeout');
    const orderId = await buy(t, m1);
    await confirm(t, orderId);
    await press(t, 'fo_cancel_' + orderId);
    await press(t, 'fo_cr_' + orderId + '_none');
    await press(t, 'fo_cok_' + orderId);
    expect(orderRow(t, orderId).status).toBe('cancelled');
    expect(soRow(t)).toMatchObject({ status: 'unknown', divert_to_stock: 1 });

    t.tg.reset();
    await say(t, '/order ' + orderId);
    expect(callbackDataOf(t.tg.of('sendMessage', ADMIN.id).at(-1)!.payload)).toContain('fo_rid_' + orderId);
    await press(t, 'fo_rid_' + orderId);
    await say(t, '777');
    expect(soRow(t)).toMatchObject({ status: 'placed', remote_order_id: '777' });
    expect(q(t.storeDb, "SELECT amount_usd FROM wallet_ledger WHERE kind = 'spend'")).toHaveLength(1);

    completedOrder(fake, '777');
    await at(t, iso('09:52'));
    expect(q(t.storeDb, 'SELECT id FROM stock_batches WHERE supplier_order_id = 1')).toHaveLength(1);
    expect(q(t.storeDb, "SELECT amount_usd FROM wallet_ledger WHERE kind = 'spend'")).toHaveLength(1);
    expect(customerMessages(t)).toHaveLength(0);
    expect(orderRow(t, orderId).status).toBe('cancelled');
  });

  it('🙋 on an unknown order keeps 🔢 on the decision card', async () => {
    const { t, fake, m1 } = await shop();
    fake.state.postQueue.push('timeout');
    const orderId = await buy(t, m1);
    await confirm(t, orderId);
    t.tg.reset();
    await press(t, 'fo_self_' + orderId);
    expect(callbackDataOf(t.tg.of('editMessageText').at(-1)!.payload)).toContain('fo_rid_' + orderId);
  });
});

// ─── S1 ──────────────────────────────────────────────────────────────────────

async function toConfirm(t: any, sid: number, qty = 1) {
  const ref = await itemRef('1300', '');
  await press(t, 'stk_buy');
  await press(t, 'stk_buys_' + sid);
  await press(t, 'stk_buyi_' + sid + '_' + ref);
  await press(t, `stk_buyq_${sid}_${ref}_${qty}`);
  return ref;
}
const buyCallback = (t: any): string => {
  const all = t.tg.calls.filter((c: any) => c.method === 'editMessageText' || c.method === 'sendMessage').flatMap((c: any) => callbackDataOf(c.payload));
  return all.filter((d: string) => d.startsWith('stk_buyok_')).at(-1)!;
};

describe('S1: the direct-buy confirmation is guarded in the DB, not only in the session', () => {
  it('a second tap that reads the OLD session (the first handler was still running) buys nothing', async () => {
    const { t, fake, sid } = await shop();
    await toConfirm(t, sid);
    const cbData = buyCallback(t);
    expect(new TextEncoder().encode(cbData).length).toBeLessThanOrEqual(64);
    const key = ADMIN.id + ':' + ADMIN.id;
    const stale = one(t.storeDb, 'SELECT value FROM sessions WHERE key = ?', key).value;
    await press(t, cbData);
    expect(posts(fake)).toHaveLength(1);
    q(t.storeDb, 'UPDATE sessions SET value = ? WHERE key = ?', stale, key); // Telegram's queued second tap
    await press(t, cbData);
    expect(posts(fake)).toHaveLength(1);
    expect(q(t.storeDb, 'SELECT id FROM supplier_orders')).toHaveLength(1);
  });

  it('a new confirmation gets a new nonce: the OLD message\'s button cannot buy', async () => {
    const { t, fake, sid } = await shop();
    await toConfirm(t, sid);
    const first = buyCallback(t);
    await toConfirm(t, sid);
    const second = buyCallback(t);
    expect(second).not.toBe(first);
    await press(t, first);
    expect(posts(fake)).toHaveLength(0);
    await press(t, second);
    expect(posts(fake)).toHaveLength(1);
  });
});

// ─── S3 ──────────────────────────────────────────────────────────────────────

describe('S3: the heaviest webhook confirm stays within 35 units', () => {
  it('stale catalog, source 1 answers 409, source 2 is placed (and already completed): ≤ 35', async () => {
    const { t, fake, sid, m1 } = await shop();
    await addBackupSource(t, sid, m1);
    fake.state.postQueue.push({ status: 409, body: { detail: 'out of stock' } }, { status: 200, body: { ok: true, order_id: 5001, status: 'completed', price: 5.5 } });
    completedOrder(fake, '5001', { price: '5.5' });
    const orderId = await buy(t, m1);
    t.deps.now = () => new Date(iso('10:30')); // the catalog (fetched 09:50) is stale
    budgets.length = 0;
    const catalogFetches = () => fake.calls.filter((c) => c.method === 'GET' && c.url.endsWith('/products')).length;
    const before = catalogFetches();
    await confirm(t, orderId);
    expect(posts(fake)).toHaveLength(2);
    expect(catalogFetches() - before).toBe(1);
    expect(Math.max(...budgets.map((b) => b.used))).toBeLessThanOrEqual(35);
  });

  it('the catalog of one supplier is refetched at most once per placement', async () => {
    const { t, fake, sid, m1 } = await shop();
    await addBackupSource(t, sid, m1);
    fake.state.postQueue.push({ status: 409, body: { detail: 'out of stock' } });
    const orderId = await buy(t, m1);
    t.deps.now = () => new Date(iso('10:30'));
    const before = fake.calls.filter((c) => c.method === 'GET' && c.url.endsWith('/products')).length;
    await confirm(t, orderId);
    const after = fake.calls.filter((c) => c.method === 'GET' && c.url.endsWith('/products')).length;
    expect(after - before).toBe(1);
  });
});

// ─── S4 ──────────────────────────────────────────────────────────────────────

describe('S4: only the explicit «✅ بله» (or a forced source) skips the loss guard', () => {
  for (const reason of ['config', 'retry_later', 'supplier_failed'] as const) {
    it('a plain 🔁 on a «' + reason + '» card buys nothing at a loss and raises the loss card; ✅ بله then buys', async () => {
      const { t, fake, m1 } = await shop();
      if (reason === 'config') fake.state.postQueue.push({ status: 401, body: { detail: 'bad key' } });
      if (reason === 'retry_later') fake.state.postQueue.push({ status: 503, body: { detail: 'busy' } });
      const orderId = await buy(t, m1);
      await confirm(t, orderId);
      if (reason === 'supplier_failed') {
        fake.state.orders['5001'] = { ok: true, order_id: 5001, status: 'cancelled', price: '5.28', accounts: [] };
        await at(t, iso('09:52'));
      }
      expect(orderRow(t, orderId).needs_action_reason).toBe(reason);
      if (reason === 'retry_later') q(t.storeDb, "UPDATE supplier_orders SET status = 'cancelled' WHERE id = 1"); // the admin presses 🔁 on a waiting order only when none is live
      q(t.storeDb, 'UPDATE orders SET price = 700000 WHERE id = ?', orderId); // the cost (792,000) rose above the sale price
      const before = posts(fake).length;
      await press(t, 'fo_retry_' + orderId);
      expect(posts(fake).length).toBe(before);
      expect(orderRow(t, orderId).needs_action_reason).toBe('loss');
      expect(adminTexts(t, 'خرید خودکار انجام نشد').length).toBeGreaterThanOrEqual(1);

      await press(t, 'fo_retry_' + orderId); // the loss card asks first…
      expect(posts(fake).length).toBe(before);
      await press(t, 'fo_retryok_' + orderId); // …and «✅ بله» is the decision
      expect(posts(fake).length).toBe(before + 1);
    });
  }

  it('the automatic placement checks it too: a cost that rose while the order waited raises the loss card', async () => {
    const { t, fake, m1 } = await shop();
    fake.state.postQueue.push({ status: 503, body: { detail: 'busy' } });
    const orderId = await buy(t, m1);
    await confirm(t, orderId);
    expect(posts(fake)).toHaveLength(1);
    q(t.storeDb, 'UPDATE orders SET price = 700000 WHERE id = ?', orderId);
    await at(t, iso('10:06'));
    expect(posts(fake)).toHaveLength(1);
    expect(orderRow(t, orderId).needs_action_reason).toBe('loss');
    expect(soRow(t).status).toBe('cancelled');
  });
});

// ─── S7 ──────────────────────────────────────────────────────────────────────

describe('S7: «🔁 دوباره» of a failed direct buy makes a new row', () => {
  it('two rows, two remote ids, each ledger spend linked to its own row; a second press adds nothing', async () => {
    const { t, fake, sid } = await shop();
    await toConfirm(t, sid);
    await press(t, buyCallback(t));
    expect(soRow(t)).toMatchObject({ status: 'placed', remote_order_id: '5001' });
    fake.state.orders['5001'] = { ok: true, order_id: 5001, status: 'cancelled', price: '5.28', accounts: [] };
    await at(t, iso('09:52'));
    expect(soRow(t).status).toBe('failed');

    fake.state.postQueue.push({ status: 200, body: { ok: true, order_id: 5002, status: 'pending', price: 5.28 } });
    await press(t, 'stk_rt_1');
    await press(t, 'stk_rt_1');
    const rows = q(t.storeDb, "SELECT id, status, remote_order_id, purpose FROM supplier_orders ORDER BY id");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ remote_order_id: '5001' });
    expect(rows[1]).toMatchObject({ status: 'placed', remote_order_id: '5002', purpose: 'stock' });
    expect(q(t.storeDb, "SELECT supplier_order_id, amount_usd FROM wallet_ledger WHERE kind = 'spend' ORDER BY id")).toEqual([
      { supplier_order_id: 1, amount_usd: -5.28 }, { supplier_order_id: 2, amount_usd: -5.28 },
    ]);
    expect(posts(fake)).toHaveLength(2);
  });
});

// ─── N-items ─────────────────────────────────────────────────────────────────

describe('N2: «completed without accounts» is a real counter', () => {
  it('poll errors and in-progress answers between the empty polls do not reset it', async () => {
    const { t, fake, m1 } = await shop();
    const orderId = await buy(t, m1);
    await confirm(t, orderId);
    const empty = { ok: true, order_id: 5001, status: 'completed', price: '5.28', accounts: [] };
    const steps: [string, () => void][] = [
      ['09:52', () => { fake.state.orders['5001'] = empty; }],
      ['10:00', () => { delete fake.state.orders['5001']; }], // a poll error (404)
      ['10:12', () => { fake.state.orders['5001'] = empty; }],
      ['10:24', () => { fake.state.orders['5001'] = { ok: true, order_id: 5001, status: 'processing', price: '5.28', accounts: [] }; }],
      ['10:36', () => { fake.state.orders['5001'] = empty; }],
      ['10:48', () => { fake.state.orders['5001'] = empty; }],
    ];
    for (const [hhmm, arm] of steps) {
      arm();
      await at(t, iso(hhmm));
    }
    expect(soRow(t).status).toBe('failed');
    expect(orderRow(t, orderId).needs_action_reason).toBe('completed_no_accounts');
    expect(soRow(t).empty_polls).toBe(4);
  });
});

describe('N4: the cost of a placed supplier order is on the store order before delivery', () => {
  it('orders.cost_toman = the supplier order\'s cost at «placed»', async () => {
    const { t, m1 } = await shop();
    const orderId = await buy(t, m1);
    await confirm(t, orderId);
    expect(soRow(t).status).toBe('placed');
    expect(orderRow(t, orderId)).toMatchObject({ status: 'confirmed', cost_toman: 792000 });
  });
});

describe('N6: a «placed» answer that arrives after the lease ran out is not dropped silently', () => {
  it('the admins get the remote number and 🔢; fo_rid then records it once', async () => {
    const { t, fake, m1 } = await shop();
    const orderId = await buy(t, m1);
    const orig = t.deps.fetch!;
    let armed = true;
    t.deps.fetch = (async (input: any, init: any) => {
      if (armed && init?.method === 'POST') {
        armed = false;
        const realNow = t.deps.now;
        t.deps.now = () => new Date(iso('09:56'));
        await t.cron(new Date(iso('09:56'))); // the lease (3 min) ran out meanwhile: the cron marks the row unknown
        t.deps.now = realNow;
      }
      return orig(input, init);
    }) as any;
    await confirm(t, orderId);
    expect(soRow(t).status).toBe('unknown');
    expect(posts(fake)).toHaveLength(1);
    const notice = adminTexts(t, '5001');
    expect(notice.length).toBeGreaterThanOrEqual(1);
    expect(events(t, 'unknown').some((e) => String(e.detail).includes('5001'))).toBe(true);
    const withButton = t.tg.of('sendMessage', ADMIN.id).map((c) => c.payload).filter((p) => String(p.text).includes('5001'));
    expect(withButton.some((p) => callbackDataOf(p).includes('fo_rid_' + orderId))).toBe(true);

    await press(t, 'fo_rid_' + orderId);
    await say(t, '5001');
    expect(soRow(t)).toMatchObject({ status: 'placed', remote_order_id: '5001' });
    expect(q(t.storeDb, "SELECT id FROM wallet_ledger WHERE kind = 'spend'")).toHaveLength(1);
  });
});

describe('N7: a direct buy of an item that left the catalog buys nothing', () => {
  it('the refetch no longer lists it → failed with a clear message, no POST', async () => {
    const { t, fake, sid } = await shop();
    await toConfirm(t, sid);
    const cbData = buyCallback(t);
    fake.state.items = fake.state.items.filter((i) => i.product_id !== '1300');
    q(t.storeDb, "UPDATE supplier_catalogs SET fetched_at = '2020-01-01 00:00:00'"); // stale: refetched before the POST
    q(t.storeDb, "UPDATE suppliers SET last_sync_ok_at = '2020-01-01 00:00:00'");
    t.tg.reset();
    await press(t, cbData);
    expect(posts(fake)).toHaveLength(0);
    expect(soRow(t)).toMatchObject({ purpose: 'stock', status: 'failed' });
    expect(t.tg.texts(ADMIN.id).join('\n')).toContain('در کاتالوگ');
    expect(q(t.storeDb, 'SELECT id FROM wallet_ledger')).toHaveLength(0);
  });
});

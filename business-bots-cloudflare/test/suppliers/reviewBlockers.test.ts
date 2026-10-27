import { describe, expect, it } from 'vitest';
import { ADMIN, budgets } from '../helpers/env';
import { one, q } from '../helpers/seed';
import { at, callbackDataOf, press, say } from './helpers';
import {
  CUSTOMER, addBackupSource, adminTexts, buy, completedOrder, confirm, events, iso, orderRow, posts, seedStock, shop, soRow,
} from './engineHelpers';

/** Opus review blockers B1 / B2 (SUPPLIER_PLAN.md §0 rule 7, §7.5). */

const NOTICE = 'که قبلاً تعیین‌تکلیف شده بود رسید';
const customerGotAccounts = (t: any) => t.tg.of('sendMessage', CUSTOMER.id).filter((c: any) => c.payload.text.includes('آماده است')).length;

/** The supplier order completes while the budget is short: the delivery waits in D1 (sent_ok = 0), nothing was sent. */
async function deferredDelivery() {
  const s = await shop();
  const orderId = await buy(s.t, s.m1);
  await confirm(s.t, orderId);
  completedOrder(s.fake);
  s.t.deps.onBudget = (b) => { budgets.push(b); b.used = 34; };
  await at(s.t, iso('09:52'));
  s.t.deps.onBudget = (b) => { budgets.push(b); };
  expect(soRow(s.t).status).toBe('completed');
  expect(one(s.t.storeDb, 'SELECT sent_ok FROM order_deliveries').sent_ok).toBe(0);
  expect(customerGotAccounts(s.t)).toBe(0);
  return { ...s, orderId };
}

/** 10 cron ticks, 6 minutes apart (the redelivery retry is every 5). */
async function tenTicks(t: any) {
  for (let i = 0; i < 10; i++) {
    const m = 58 + i * 6;
    await at(t, new Date(Date.parse(iso('09:00')) + m * 60_000).toISOString());
  }
}

function expectDivertedOnce(t: any, orderId: number) {
  expect(q(t.storeDb, 'SELECT id FROM stock_batches WHERE supplier_order_id = 1')).toHaveLength(1);
  const accounts = q(t.storeDb, 'SELECT content_json FROM stock_accounts WHERE batch_id = (SELECT id FROM stock_batches WHERE supplier_order_id = 1)');
  expect(accounts).toHaveLength(1);
  expect(adminTexts(t, NOTICE)).toHaveLength(1);
  expect(events(t, 'diverted_to_stock')).toHaveLength(1);
  expect(customerGotAccounts(t)).toBe(0); // the customer never gets the diverted accounts
  expect(orderId).toBeGreaterThan(0);
}

describe('B1: a diverted delivery is diverted once, not every 5 minutes', () => {
  it('deferred delivery → admin cancels → 10 cron ticks: one batch, one set of accounts, one admin notice', async () => {
    const { t, fake, orderId } = await deferredDelivery();
    await press(t, 'fo_cancel_' + orderId);
    await press(t, 'fo_cr_' + orderId + '_none');
    await press(t, 'fo_cok_' + orderId);
    expect(orderRow(t, orderId).status).toBe('cancelled');
    await tenTicks(t);
    expectDivertedOnce(t, orderId);
    expect(posts(fake)).toHaveLength(1);
    expect(soRow(t).next_check_at).toBeNull();
  });

  it('deferred delivery → 🙋 → ✅ (delivered by hand) → 10 ticks: still one batch', async () => {
    const { t, orderId } = await deferredDelivery();
    await press(t, 'fo_self_' + orderId);
    await press(t, 'fo_done_' + orderId);
    expect(orderRow(t, orderId).status).toBe('delivered');
    await tenTicks(t);
    expectDivertedOnce(t, orderId);
  });

  it('deferred delivery → 📦 delivered from «my accounts» → 10 ticks: still one diverted batch', async () => {
    const { t, orderId } = await deferredDelivery();
    await seedStock(t, [{ email: 'stock@x.test', password: 'pw' }]);
    await press(t, 'fo_stock_' + orderId);
    await press(t, 'fo_stk_' + orderId + '_1');
    await press(t, 'fo_stkok_' + orderId + '_1');
    expect(orderRow(t, orderId).status).toBe('delivered');
    await tenTicks(t);
    expect(q(t.storeDb, 'SELECT id FROM stock_batches WHERE supplier_order_id = 1')).toHaveLength(1);
    expect(adminTexts(t, NOTICE)).toHaveLength(1);
    expect(events(t, 'diverted_to_stock')).toHaveLength(1);
    expect(customerGotAccounts(t)).toBe(1); // only the stock account the admin chose
  });

  it('a cancelled order whose accounts were never sent (send_failed, next_check_at cleared) is still diverted by the cron', async () => {
    const { t, fake, m1 } = await shop();
    const orderId = await buy(t, m1);
    await confirm(t, orderId);
    completedOrder(fake);
    t.tg.fail('sendMessage', (c) => c.payload.chat_id === CUSTOMER.id, 403, 'Forbidden: bot was blocked by the user');
    await at(t, iso('09:52'));
    expect(orderRow(t, orderId)).toMatchObject({ status: 'confirmed', needs_action_reason: 'send_failed' });
    expect(soRow(t).next_check_at).toBeNull();
    t.tg.clearRules();
    await press(t, 'fo_cancel_' + orderId);
    await press(t, 'fo_cr_' + orderId + '_none');
    await press(t, 'fo_cok_' + orderId);
    await tenTicks(t);
    expect(q(t.storeDb, 'SELECT id FROM stock_batches WHERE supplier_order_id = 1')).toHaveLength(1);
  });
});

/** A POST that timed out: the order is `unknown` and the card is out. */
async function unknownOrder() {
  const s = await shop();
  s.fake.state.postQueue.push('timeout');
  const orderId = await buy(s.t, s.m1);
  await confirm(s.t, orderId);
  expect(soRow(s.t).status).toBe('unknown');
  expect(posts(s.fake)).toHaveLength(1);
  return { ...s, orderId };
}

describe('B2: an unknown order is never bought again without «ثبت نشده بود»', () => {
  it('path 1: 🙋 → ↩️ undo does not queue a second order (still one POST) and the admin is told', async () => {
    const { t, fake, orderId } = await unknownOrder();
    await press(t, 'fo_self_' + orderId);
    expect(soRow(t).divert_to_stock).toBe(1);
    await press(t, 'fo_undo_' + orderId);
    expect(posts(fake)).toHaveLength(1);
    expect(q(t.storeDb, 'SELECT id FROM supplier_orders')).toHaveLength(1);
    expect(soRow(t)).toMatchObject({ status: 'unknown', divert_to_stock: 1 }); // undo leaves the unknown row alone
    // the order is not stranded: the unknown card is out again
    expect(orderRow(t, orderId)).toMatchObject({ fulfillment: 'supplier', needs_action_reason: 'unknown' });
    expect(adminTexts(t, 'معلوم نیست').length).toBeGreaterThanOrEqual(2);
    for (let m = 1; m <= 12; m++) await at(t, iso('10:' + String(m).padStart(2, '0')));
    expect(posts(fake)).toHaveLength(1);
  });

  it('path 2: the unknown card has no 🔀, and forged fo_srcp / fo_srcok callbacks buy nothing', async () => {
    const { t, fake, sid, m1, orderId } = await unknownOrder();
    const backup = await addBackupSource(t, sid, m1);
    t.tg.reset();
    await press(t, 'fo_card_' + orderId);
    const kb = callbackDataOf(t.tg.of('editMessageText').at(-1)!.payload);
    expect(kb).toContain('fo_retry_' + orderId);
    expect(kb).not.toContain('fo_src_' + orderId);

    await press(t, 'fo_srcp_' + orderId + '_' + backup);
    await press(t, 'fo_srcok_' + orderId + '_' + backup);
    expect(posts(fake)).toHaveLength(1);
    expect(q(t.storeDb, 'SELECT id FROM supplier_orders')).toHaveLength(1);
    expect(soRow(t).status).toBe('unknown');
    expect(orderRow(t, orderId).needs_action_reason).toBe('unknown');
  });

  it('the explicit «🔁 ثبت نشده بود» still buys once: the old row is cancelled with an admin event, a second press adds nothing', async () => {
    const { t, fake, orderId } = await unknownOrder();
    await press(t, 'fo_retry_' + orderId);
    expect(posts(fake)).toHaveLength(2);
    expect(q(t.storeDb, 'SELECT status FROM supplier_orders ORDER BY id').map((r) => r.status)).toEqual(['cancelled', 'placed']);
    const ev = events(t, 'admin_retry').filter((e) => String(e.detail).includes('not placed'));
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ actor: ADMIN.id, supplier_order_id: 1 });
    await press(t, 'fo_retry_' + orderId);
    expect(posts(fake)).toHaveLength(2);
  });

  it('a plain 🔁 on a card whose reason was cleared (an unknown row still exists) buys nothing', async () => {
    const { t, fake, orderId } = await unknownOrder();
    await press(t, 'fo_self_' + orderId);
    await press(t, 'fo_undo_' + orderId);
    q(t.storeDb, "UPDATE orders SET needs_action_reason = NULL WHERE id = ?", orderId);
    await press(t, 'fo_retry_' + orderId);
    expect(posts(fake)).toHaveLength(1);
  });
});

void say;

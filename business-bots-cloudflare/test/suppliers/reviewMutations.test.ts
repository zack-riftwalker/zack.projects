import { describe, expect, it } from 'vitest';
import { ADMIN } from '../helpers/env';
import { one, q } from '../helpers/seed';
import { at, press } from './helpers';
import {
  CUSTOMER, buy, completedOrder, confirm, events, iso, orderRow, posts, seedStock, shop, soRow,
} from './engineHelpers';
import { cancelOrder } from '../../src/store/suppliers/fulfillmentActions';
import { recordRemoteOrderId } from '../../src/store/suppliers/engine';

/**
 * Tests for guards that the Opus review removed one by one without any test failing (M3, M6, M9, M10; M8 is in
 * reviewShould.test.ts «S4»). Each of them fails when its guard is taken out.
 */

const customerMessages = (t: any) => t.tg.of('sendMessage', CUSTOMER.id).filter((c: any) => c.payload.text.includes('آماده است'));

describe('M3: the delivery re-checks the order and the divert flag before it sends', () => {
  it('a completed supplier order flagged divert_to_stock never reaches the customer, even though the order still looks deliverable', async () => {
    const { t, fake, m1 } = await shop();
    const orderId = await buy(t, m1);
    await confirm(t, orderId);
    completedOrder(fake);
    const { budgets } = await import('../helpers/env');
    t.deps.onBudget = (b) => { budgets.push(b); b.used = 34; }; // the first delivery attempt is deferred
    await at(t, iso('09:52'));
    t.deps.onBudget = (b) => { budgets.push(b); };
    expect(soRow(t).status).toBe('completed');
    q(t.storeDb, 'UPDATE supplier_orders SET divert_to_stock = 1 WHERE id = 1'); // flagged by some other path
    await at(t, iso('09:58'));
    expect(customerMessages(t)).toHaveLength(0);
    expect(q(t.storeDb, 'SELECT id FROM stock_batches WHERE supplier_order_id = 1')).toHaveLength(1);
    expect(orderRow(t, orderId)).toMatchObject({ status: 'confirmed', fulfillment: 'supplier' });
  });

  it('an order that was cancelled while its delivery waited gets nothing', async () => {
    const { t, fake, m1 } = await shop();
    const orderId = await buy(t, m1);
    await confirm(t, orderId);
    completedOrder(fake);
    const { budgets } = await import('../helpers/env');
    t.deps.onBudget = (b) => { budgets.push(b); b.used = 34; };
    await at(t, iso('09:52'));
    t.deps.onBudget = (b) => { budgets.push(b); };
    q(t.storeDb, "UPDATE orders SET status = 'cancelled' WHERE id = ?", orderId); // however it happened
    await at(t, iso('09:58'));
    expect(customerMessages(t)).toHaveLength(0);
    expect(q(t.storeDb, 'SELECT id FROM stock_batches WHERE supplier_order_id = 1')).toHaveLength(1);
  });
});

describe('M6: recording the remote number twice records it once', () => {
  it('two entries at the same time: one «ok», one ledger spend, polling starts once', async () => {
    const { t, fake, m1 } = await shop();
    fake.state.postQueue.push('timeout');
    const orderId = await buy(t, m1);
    await confirm(t, orderId);
    expect(soRow(t).status).toBe('unknown');
    const app = t.apps().store!;
    const results = await Promise.all([
      recordRemoteOrderId(app, orderId, '777', ADMIN.id),
      recordRemoteOrderId(app, orderId, '777', ADMIN.id),
    ]);
    expect(results.filter((r) => r === 'ok')).toHaveLength(1);
    expect(q(t.storeDb, "SELECT id FROM wallet_ledger WHERE kind = 'spend'")).toHaveLength(1);
    expect(events(t, 'remote_id_set')).toHaveLength(1);
    expect(soRow(t)).toMatchObject({ status: 'placed', remote_order_id: '777', checks: 0 });
  });

  it('a late second entry after a poll already ran does not reset the polling or book a second spend', async () => {
    const { t, fake, m1 } = await shop();
    fake.state.postQueue.push('timeout');
    const orderId = await buy(t, m1);
    await confirm(t, orderId);
    const app = t.apps().store!;
    expect(await recordRemoteOrderId(app, orderId, '777', ADMIN.id)).toBe('ok');
    fake.state.orders['777'] = { ok: true, order_id: 777, status: 'processing', price: '5.28', accounts: [] };
    await at(t, iso('09:52'));
    const checks = soRow(t).checks;
    expect(checks).toBeGreaterThan(0);
    expect(await recordRemoteOrderId(t.apps().store!, orderId, '888', ADMIN.id)).toBe('none');
    expect(soRow(t)).toMatchObject({ remote_order_id: '777', checks });
    expect(q(t.storeDb, "SELECT id FROM wallet_ledger WHERE kind = 'spend'")).toHaveLength(1);
  });
});

describe('M9: a cancel that lost the race changes nothing else', () => {
  it('cancelOrder on a stale snapshot (the order was delivered meanwhile) leaves the supplier order, the stock account and the history alone', async () => {
    const { t, m1 } = await shop();
    const orderId = await buy(t, m1);
    await confirm(t, orderId);
    await seedStock(t, [{ email: 's@x.test', password: 'p' }]);
    q(t.storeDb, "UPDATE stock_accounts SET status = 'reserved', order_id = ? WHERE id = 1", orderId);
    const app = t.apps().store!;
    const snapshot = (await app.db.getOrderById(orderId))!;
    q(t.storeDb, "UPDATE orders SET status = 'delivered' WHERE id = ?", orderId); // someone else delivered it first

    expect(await cancelOrder(app, snapshot, ADMIN.id, null)).toBe(false);

    expect(soRow(t)).toMatchObject({ status: 'placed', divert_to_stock: 0 });
    expect(one(t.storeDb, 'SELECT status, order_id FROM stock_accounts WHERE id = 1')).toEqual({ status: 'reserved', order_id: orderId });
    expect(events(t, 'admin_cancel')).toHaveLength(0);
    expect(orderRow(t, orderId).status).toBe('delivered');
  });

  it('the same for a queued supplier order: it is not cancelled by a cancel that did not happen', async () => {
    const { t, fake, m1 } = await shop();
    fake.state.postQueue.push({ status: 503, body: { detail: 'busy' } });
    const orderId = await buy(t, m1);
    await confirm(t, orderId);
    expect(soRow(t).status).toBe('queued');
    const app = t.apps().store!;
    const snapshot = (await app.db.getOrderById(orderId))!;
    q(t.storeDb, "UPDATE orders SET status = 'delivered' WHERE id = ?", orderId);
    expect(await cancelOrder(app, snapshot, ADMIN.id, null)).toBe(false);
    expect(soRow(t).status).toBe('queued');
  });
});

describe('M10: ↩️ undo is impossible once a delivery row exists', () => {
  it('🙋 on an order whose accounts could not be sent, then a forged fo_undo: the order stays manual and nothing is bought', async () => {
    const { t, fake, m1 } = await shop();
    const orderId = await buy(t, m1);
    await confirm(t, orderId);
    completedOrder(fake);
    t.tg.fail('sendMessage', (c) => c.payload.chat_id === CUSTOMER.id, 403, 'Forbidden: bot was blocked by the user');
    await at(t, iso('09:52'));
    t.tg.clearRules();
    expect(orderRow(t, orderId).needs_action_reason).toBe('send_failed');
    await press(t, 'fo_self_' + orderId);
    expect(orderRow(t, orderId).fulfillment).toBe('manual_outside');
    expect(one(t.storeDb, 'SELECT COUNT(*) n FROM order_deliveries WHERE diverted = 0').n).toBe(1);

    await press(t, 'fo_undo_' + orderId); // the card has no such button: this is a forged / old callback
    expect(orderRow(t, orderId).fulfillment).toBe('manual_outside');
    expect(posts(fake)).toHaveLength(1);
    expect(q(t.storeDb, 'SELECT id FROM supplier_orders')).toHaveLength(1);
    expect(t.tg.of('answerCallbackQuery').at(-1)!.payload.text).toContain('ممکن نیست');
  });
});

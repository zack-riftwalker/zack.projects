import type { StoreApp } from '../../apps';
import type { Stmt } from '../../lib/budget';
import { tehranDateTime } from '../../lib/time';
import type { Order } from '../db';
import { eventStatement } from '../events';
import { DEADLINE_HOURS, claimCutoff } from './engine';

/**
 * Order-level admin actions (SUPPLIER_PLAN.md §8.3). Every state change is a conditional UPDATE inside one batch;
 * the statements after the first carry a guard on the order's NEW state, so a second admin, the cron or a
 * double tap can't half-apply an action.
 */

const nowStr = (app: StoreApp): string => tehranDateTime(app.apps.now());
const q = (app: StoreApp, sql: string, ...args: unknown[]): Stmt => app.raw.prepare(sql).bind(...args);
export const deadlineFrom = (app: StoreApp): string => tehranDateTime(new Date(app.apps.now().getTime() + DEADLINE_HOURS * 3_600_000));

export interface Guard { sql: string; args: unknown[] }

/**
 * An order resolved some other way must not buy or deliver from the supplier any more: a queued supplier order is
 * cancelled; one that is placing / placed / unknown is flagged so its accounts go to «اکانت‌های من» when they arrive;
 * a completed one whose accounts were never sent is flagged too and the cron diverts them (once).
 */
export function neutralizeStatements(app: StoreApp, orderId: number, guard: Guard): Stmt[] {
  const now = nowStr(app);
  return [
    q(app, `UPDATE supplier_orders SET status = 'cancelled', updated_at = ? WHERE order_id = ? AND status = 'queued' AND ${guard.sql}`, now, orderId, ...guard.args),
    q(app, `UPDATE supplier_orders SET divert_to_stock = 1, updated_at = ? WHERE order_id = ? AND status IN ('placing', 'placed', 'unknown') AND ${guard.sql}`, now, orderId, ...guard.args),
    q(app, `UPDATE supplier_orders SET divert_to_stock = 1, next_check_at = COALESCE(next_check_at, ?), updated_at = ?
            WHERE order_id = ? AND status = 'completed' AND divert_to_stock = 0
              AND NOT EXISTS (SELECT 1 FROM order_deliveries d WHERE d.supplier_order_id = supplier_orders.id AND d.sent_ok = 1)
              AND ${guard.sql}`, now, now, orderId, ...guard.args),
  ];
}

const orderIs = (orderId: number, condition: string, ...args: unknown[]): Guard => ({
  sql: `EXISTS (SELECT 1 FROM orders WHERE id = ? AND ${condition})`, args: [orderId, ...args],
});

/** «🙋 خودم تحویل می‌دهم»: true when this press won. */
export async function startSelfDelivery(app: StoreApp, orderId: number, adminId: number): Promise<boolean> {
  const guard = orderIs(orderId, "status = 'confirmed' AND fulfillment = 'manual_outside'");
  const rs = await app.raw.batch([
    // not while a delivery is in flight: the customer is getting the accounts right now
    q(app, `UPDATE orders SET fulfillment = 'manual_outside', needs_action_reason = NULL, needs_action_at = NULL
            WHERE id = ? AND status = 'confirmed' AND fulfillment = 'supplier' AND (delivery_claimed_at IS NULL OR delivery_claimed_at < ?)`, orderId, claimCutoff(app)),
    ...neutralizeStatements(app, orderId, guard),
    eventStatement(app, { orderId, kind: 'admin_self', actor: adminId, guard }),
  ]);
  return rs[0].meta.changes === 1;
}

/** «↩️ برگشت به تحویل خودکار»: only while nothing was delivered. In-flight supplier orders get their accounts back. */
export async function undoSelfDelivery(app: StoreApp, orderId: number, adminId: number): Promise<boolean> {
  const guard = orderIs(orderId, "status = 'confirmed' AND fulfillment = 'supplier'");
  const now = nowStr(app);
  const rs = await app.raw.batch([
    q(app, `UPDATE orders SET fulfillment = 'supplier', supplier_deadline_at = ?, stalled_alert_sent = 0
            WHERE id = ? AND status = 'confirmed' AND fulfillment = 'manual_outside'
              AND NOT EXISTS (SELECT 1 FROM order_deliveries WHERE order_id = ? AND diverted = 0)`, deadlineFrom(app), orderId, orderId),
    q(app, `UPDATE supplier_orders SET divert_to_stock = 0, updated_at = ? WHERE order_id = ? AND status IN ('placing', 'placed') AND ${guard.sql}`,
      now, orderId, ...guard.args),
    eventStatement(app, { orderId, kind: 'admin_undo', actor: adminId, guard }),
  ]);
  return rs[0].meta.changes === 1;
}

/** «✅ تحویل شد» after a manual delivery: the clocks start. true when this press won. */
export async function finishSelfDelivery(app: StoreApp, orderId: number, adminId: number): Promise<boolean> {
  const rs = await app.raw.batch([
    app.db.markDeliveredStatement(orderId, nowStr(app), 'manual_outside'),
    eventStatement(app, { orderId, kind: 'admin_done', actor: adminId, onlyIfChanged: true }),
  ]);
  return rs[0].meta.changes === 1;
}

/**
 * Takes the order for a text / stock delivery (`fulfillment` becomes the claim) and stops the supplier side. The
 * stock account, when given, is reserved in the same batch. It fails while a supplier delivery is being sent to the
 * customer (the delivery claim of the order), so the customer can never get two accounts. true when this press won.
 */
export async function claimForManualDelivery(
  app: StoreApp, orderId: number, kind: 'manual_text' | 'stock', adminId: number, accountId?: number,
): Promise<boolean> {
  const guard = orderIs(orderId, `status = 'confirmed' AND fulfillment = ?`, kind);
  const now = nowStr(app);
  const stmts: Stmt[] = [];
  if (kind === 'stock') {
    stmts.push(
      q(app, `UPDATE orders SET fulfillment = 'stock', needs_action_reason = NULL, needs_action_at = NULL
              WHERE id = ? AND status = 'confirmed' AND fulfillment = 'supplier' AND (delivery_claimed_at IS NULL OR delivery_claimed_at < ?)
                AND EXISTS (SELECT 1 FROM stock_accounts WHERE id = ? AND status = 'available')`, orderId, claimCutoff(app), accountId),
      q(app, "UPDATE stock_accounts SET status = 'reserved', order_id = ?, updated_at = ? WHERE id = ? AND status = 'available' AND changes() = 1", orderId, now, accountId),
    );
  } else {
    stmts.push(q(app, `UPDATE orders SET fulfillment = 'manual_text', needs_action_reason = NULL, needs_action_at = NULL
                       WHERE id = ? AND status = 'confirmed' AND fulfillment = 'supplier' AND (delivery_claimed_at IS NULL OR delivery_claimed_at < ?)`, orderId, claimCutoff(app)));
  }
  stmts.push(
    ...neutralizeStatements(app, orderId, guard),
    eventStatement(app, { orderId, kind: kind === 'stock' ? 'admin_stock' : 'admin_text', actor: adminId, detail: accountId ? 'account ' + accountId : undefined, guard }),
  );
  const rs = await app.raw.batch(stmts);
  return rs[0].meta.changes === 1 && (kind !== 'stock' || rs[1].meta.changes === 1);
}

/**
 * A text / stock delivery that turned out impossible after the claim (the order changed under it): the order goes back to
 * the supplier side only if it still waits there, and a reserved account is freed. Idempotent; touches nothing that was delivered.
 */
export async function releaseManualClaim(app: StoreApp, orderId: number, kind: 'manual_text' | 'stock', accountId?: number): Promise<void> {
  const stmts = [q(app, "UPDATE orders SET fulfillment = 'supplier' WHERE id = ? AND status = 'confirmed' AND fulfillment = ?", orderId, kind)];
  if (accountId) {
    stmts.push(q(app, "UPDATE stock_accounts SET status = 'available', order_id = NULL, updated_at = ? WHERE id = ? AND order_id = ? AND status = 'reserved'", nowStr(app), accountId, orderId));
  }
  await app.raw.batch(stmts);
}

/** Hot statements of the cancel batch, exported so the index test can EXPLAIN the real SQL. */
export const CANCEL_SQL = {
  // the redemption is found through (code, customer), which has an index; order_id only narrows it down
  redemption: 'DELETE FROM discount_code_redemptions WHERE discount_code_id = (SELECT discount_code_id FROM orders WHERE id = ?) AND customer_telegram_id = ? AND order_id = ?',
  // referrals.invitee_telegram_id is UNIQUE (indexed)
  referral: 'UPDATE referrals SET qualified_at = NULL, qualifying_order_id = NULL WHERE invitee_telegram_id = ? AND qualifying_order_id = ? AND reward_id IS NULL',
  stock: "UPDATE stock_accounts SET status = 'available', order_id = NULL, updated_at = ? WHERE status = 'reserved' AND order_id = ?",
};

/**
 * «❌ لغو سفارش» (SUPPLIER_PLAN.md §8.3), one batch: the order, the discount code back to its owner, the referral
 * un-qualified, supplier orders neutralized, a reserved stock account released. Every statement after the first
 * is guarded by the new `cancelled` state written by THIS admin at THIS second.
 */
export async function cancelOrder(app: StoreApp, order: Order, adminId: number, reason: string | null): Promise<boolean> {
  const now = nowStr(app);
  const guard: Guard = {
    sql: "EXISTS (SELECT 1 FROM orders WHERE id = ? AND status = 'cancelled' AND cancelled_by = ? AND cancelled_at = ?)",
    args: [order.id, adminId, now],
  };
  const rs = await app.raw.batch([
    q(app, `UPDATE orders SET status = 'cancelled', cancel_reason = ?, cancelled_at = ?, cancelled_by = ?,
            refund_status = CASE WHEN price > 0 THEN 'pending' ELSE 'none' END, needs_action_reason = NULL, needs_action_at = NULL
            WHERE id = ? AND status = 'confirmed' AND fulfillment IN ('supplier', 'manual_outside', 'stock', 'manual_text')
              AND (delivery_claimed_at IS NULL OR delivery_claimed_at < ?)`, reason, now, adminId, order.id, claimCutoff(app)),
    q(app, `${CANCEL_SQL.redemption} AND ${guard.sql}`, order.id, order.customer_telegram_id, order.id, ...guard.args),
    q(app, `${CANCEL_SQL.referral} AND ${guard.sql}`, order.customer_telegram_id, order.id, ...guard.args),
    ...neutralizeStatements(app, order.id, guard),
    q(app, `${CANCEL_SQL.stock} AND ${guard.sql}`, now, order.id, ...guard.args),
    eventStatement(app, { orderId: order.id, kind: 'admin_cancel', actor: adminId, detail: reason ?? undefined, guard }),
  ]);
  return rs[0].meta.changes === 1;
}

/** «✅ بازپرداخت انجام شد». true when this press won. */
export async function markRefunded(app: StoreApp, orderId: number, adminId: number): Promise<boolean> {
  const rs = await app.raw.batch([
    q(app, "UPDATE orders SET refund_status = 'done', refunded_at = ? WHERE id = ? AND status = 'cancelled' AND refund_status = 'pending'", nowStr(app), orderId),
    eventStatement(app, { orderId, kind: 'refund_done', actor: adminId, onlyIfChanged: true }),
  ]);
  return rs[0].meta.changes === 1;
}

/** The manual cost of an order (0 … 1,000,000,000 Toman), for the profit report. */
export async function setOrderCost(app: StoreApp, orderId: number, cost: number, adminId: number): Promise<boolean> {
  const rs = await app.raw.batch([
    q(app, "UPDATE orders SET cost_toman = ? WHERE id = ? AND status IN ('confirmed', 'delivered')", cost, orderId),
    eventStatement(app, { orderId, kind: 'cost_set', actor: adminId, detail: String(cost), onlyIfChanged: true }),
  ]);
  return rs[0].meta.changes === 1;
}

/** Adds a (disabled) source to an option and returns its id; null when that item is already one of its sources. */
export async function addDisabledSource(
  app: StoreApp, productId: number, supplierId: number,
  item: { remoteProductId: string; remoteVariationId: string; name: string; attributes: Record<string, string>; priceUsd: number | null },
): Promise<number | null> {
  const r = await q(app, `
    INSERT INTO product_sources (customer_product_id, supplier_id, remote_product_id, remote_variation_id, remote_name,
      attributes_json, price_usd, listed, priority, is_enabled)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, (SELECT COALESCE(MAX(priority), 0) + 1 FROM product_sources WHERE customer_product_id = ?), 0)
    ON CONFLICT DO NOTHING`, productId, supplierId, item.remoteProductId, item.remoteVariationId, item.name,
  JSON.stringify(item.attributes), item.priceUsd, productId).run();
  return r.meta.changes === 1 ? r.meta.last_row_id : null;
}

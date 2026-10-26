import type { StoreApp } from '../../apps';
import { BudgetExceededError } from '../../lib/budget';
import { formatJalaliDateTime, tehranDateTime } from '../../lib/time';
import type { Stmt } from '../../lib/budget';
import type { Order } from '../db';
import { eventStatement, logEvent } from '../events';
import { customerRefHtml, customerContactRow, sendToAdmins } from '../customerRef';
import { escapeHtml, formatPrice } from '../utils';
import { SUPPLIER_CONFIRM_TEXT } from '../labels';
import { Markup } from '../../lib/markup';
import { adapterFor } from './index';
import { ARIOBOX_ASSUMPTIONS, classifyRemoteStatus } from './ariobox';
import { buildDecisionCard, type CardOptions, type NeedsActionReason } from './decisionCard';
import { formatAccountsHtml, parseContent, splitHtml, type DeliveryContent } from './format';
import { pickActiveSource, recomputeOption, type SourceRow } from './recompute';
import { costToman } from './pricing';
import { createStockBatch, stockUnitCost } from './stock';
import { getSupplier, readCatalog } from './store';
import { completeStockOrder, notifyStockProblem } from './stockOrders';
import { usd, walletBalance } from './wallet';
import { syncSupplier } from './sync';
import type { SupplierOrderRow, SupplierRow } from './types';

/** A placement lease: a `placing` row older than this means the Worker died after (maybe) sending. */
export const LEASE_MINUTES = 3;
/** Wait between automatic placement retries (out of stock everywhere, 503, ...). */
export const RETRY_MINUTES = 15;
/** After a 409 the source counts as out of stock for this long. */
export const SOURCE_OOS_MINUTES = 30;
/** Automatic tries stop this long after the receipt was confirmed. */
export const DEADLINE_HOURS = 20;
/** The catalog is refetched before an order when it is older than this. */
export const CATALOG_STALE_MINUTES = 15;
/** Budget a placement needs before it may even claim the row. */
const MIN_PLACE_BUDGET = 12;
/** Budget that must be left right before the POST, so the bookkeeping after it always fits. */
const MIN_POST_BUDGET = 7;
/** The cron does no supplier work below this budget. */
const MIN_WORK_BUDGET = 12;
const FOLLOWUP_LIMITS = { queued: 3, placed: 5, completed: 2, stale: 3, deadline: 3, stranded: 2 };

const nowStr = (app: StoreApp): string => tehranDateTime(app.apps.now());
const addMinutes = (app: StoreApp, minutes: number): string => tehranDateTime(new Date(app.apps.now().getTime() + minutes * 60_000));
const q = (app: StoreApp, sql: string, ...args: unknown[]): Stmt => app.raw.prepare(sql).bind(...args);
const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s);
const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

// ─── Which orders use the engine ─────────────────────────────────────────────

/** True when the product has at least one source row, enabled or not (SUPPLIER_PLAN.md §7.1). */
export async function isSupplierOption(app: StoreApp, productId: number): Promise<boolean> {
  return (await sourceSummary(app, productId)).total > 0;
}

/** Sources of a product (any state) and how many of them are enabled with an enabled supplier; one query. */
export async function sourceSummary(app: StoreApp, productId: number): Promise<{ total: number; enabled: number }> {
  const r = await q(app, `
    SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN s.is_enabled = 1 AND sup.is_enabled = 1 THEN 1 ELSE 0 END), 0) AS enabled
    FROM product_sources s JOIN suppliers sup ON sup.id = s.supplier_id WHERE s.customer_product_id = ?`, productId)
    .first<{ total: number; enabled: number }>();
  return { total: r?.total ?? 0, enabled: r?.enabled ?? 0 };
}

// ─── Price checks (Appendix A assumption (b)) ────────────────────────────────

/** The `price` of the last supplier answer, or null. The GET answer has it as a string. */
export function reportedPrice(raw: string | null): number | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw)?.price;
    const n = typeof v === 'string' ? Number(v) : v;
    return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

/** True when the reported price is neither the unit price nor the total within the tolerance. */
export function priceMismatch(unitUsd: number | null, quantity: number, reported: number | null): boolean {
  if (unitUsd === null || reported === null) return false;
  const near = (a: number, b: number) => Math.abs(a - b) <= b * ARIOBOX_ASSUMPTIONS.priceTolerance;
  return !(near(reported, unitUsd) || near(reported, unitUsd * quantity));
}

// ─── Raising a decision card ─────────────────────────────────────────────────

export interface RaiseOptions extends CardOptions {
  /** keep the order's current reason when it has one (the card is still sent) */
  keepExisting?: boolean;
}

/**
 * Marks the order as needing the admin's decision and sends the card to every admin. Only a confirmed supplier
 * order qualifies; returns false (nothing sent) otherwise.
 */
export async function raiseNeedsAction(app: StoreApp, orderId: number, reason: NeedsActionReason, opts: RaiseOptions = {}): Promise<boolean> {
  const now = nowStr(app);
  const rs = await app.raw.batch([
    q(app, `UPDATE orders SET needs_action_reason = ${opts.keepExisting ? 'COALESCE(needs_action_reason, ?)' : '?'}, needs_action_at = ?
            WHERE id = ? AND status IN ('confirmed', 'delivered') AND fulfillment IS NOT NULL`, reason, now, orderId),
    eventStatement(app, { orderId, kind: 'needs_action', detail: reason, onlyIfChanged: true }),
  ]);
  if (rs[0].meta.changes !== 1) return false;
  await sendCard(app, orderId, opts);
  return true;
}

export async function sendCard(app: StoreApp, orderId: number, opts: CardOptions = {}): Promise<number> {
  const card = await buildDecisionCard(app, orderId, opts);
  if (!card) return 0;
  return sendToAdmins(app, card.html, card.rows);
}

// ─── Queueing ────────────────────────────────────────────────────────────────

/**
 * Inserts a queued supplier order for a confirmed supplier order, but only when none is live (queued / placing /
 * placed / completed-but-undelivered) — one statement, so two admins, the webhook and cron can't both add one.
 * Returns the new id, or null when nothing was added.
 */
export async function queueSupplierOrder(
  app: StoreApp, order: { id: number; customer_product_id: number },
  opts: {
    forcedSourceId?: number | null; requestedBy?: number; eventKind?: 'queued' | 'admin_retry' | 'admin_source'; eventDetail?: string;
    /** the admin chose another source: a supplier order that only WAITS (queued) is cancelled first; one already placing / placed stays */
    supersedeQueued?: boolean;
  } = {},
): Promise<number | null> {
  const now = nowStr(app);
  const supersede = opts.supersedeQueued
    ? [q(app, `UPDATE supplier_orders SET status = 'cancelled', updated_at = ? WHERE order_id = ? AND status = 'queued'
               AND NOT EXISTS (SELECT 1 FROM supplier_orders WHERE order_id = ? AND status IN ('placing', 'placed', 'completed'))`, now, order.id, order.id)]
    : [];
  const rs = await app.raw.batch([
    ...supersede,
    q(app, `INSERT INTO supplier_orders (purpose, order_id, customer_product_id, forced_source_id, quantity, status, next_attempt_at, requested_by, created_at, updated_at)
            SELECT 'customer', ?, ?, ?, 1, 'queued', ?, ?, ?, ?
            WHERE EXISTS (SELECT 1 FROM orders WHERE id = ? AND status = 'confirmed' AND fulfillment = 'supplier')
              AND NOT EXISTS (SELECT 1 FROM supplier_orders WHERE order_id = ? AND status IN ('queued', 'placing', 'placed', 'completed'))`,
      order.id, order.customer_product_id, opts.forcedSourceId ?? null, now, opts.requestedBy ?? 0, now, now, order.id, order.id),
    eventStatement(app, {
      orderId: order.id, supplierOrderId: 'last', kind: opts.eventKind ?? 'queued', actor: opts.requestedBy ?? 0,
      detail: opts.eventDetail, onlyIfChanged: true,
    }),
  ]);
  const inserted = rs[supersede.length];
  return inserted.meta.changes === 1 ? inserted.meta.last_row_id : null;
}

/** Places the order right now, swallowing every error (a failure here must never break the caller's flow). */
export async function kickSupplierOrder(app: StoreApp, soId: number): Promise<void> {
  try {
    await placeSupplierOrder(app, soId);
  } catch (err: any) {
    if (err instanceof BudgetExceededError) console.warn('⚠️ [Supplier] kick of #' + soId + ' stopped: budget exhausted.');
    else console.error('❌ [Supplier] kick of #' + soId + ' failed:', err?.message ?? err);
  }
}

/**
 * Receipt confirm for a supplier-fulfilled option (SUPPLIER_PLAN.md §7.2, steps 5–7): loss guard, no enabled
 * source, otherwise queue and kick. The order already carries `fulfillment='supplier'`.
 */
export async function startSupplierFulfillment(
  app: StoreApp, order: Order, product: { cost_toman?: number | null } | undefined, enabledSources: number,
): Promise<void> {
  if (product?.cost_toman != null && order.price < product.cost_toman) {
    await raiseNeedsAction(app, order.id, 'loss');
    return;
  }
  if (enabledSources === 0) {
    await raiseNeedsAction(app, order.id, 'no_enabled_source');
    return;
  }
  const soId = await queueSupplierOrder(app, order);
  if (soId !== null && app.apps.budget.remaining() >= 15) await kickSupplierOrder(app, soId);
}

/** The order columns that mark a receipt-confirmed order as supplier-fulfilled. */
export async function markSupplierFulfillment(app: StoreApp, orderId: number): Promise<void> {
  await q(app, `UPDATE orders SET fulfillment = 'supplier', supplier_deadline_at = ?,
                customer_username = COALESCE((SELECT username FROM customers WHERE telegram_id = orders.customer_telegram_id), customer_username)
                WHERE id = ? AND status = 'confirmed'`, addMinutes(app, DEADLINE_HOURS * 60), orderId).run();
}

export { SUPPLIER_CONFIRM_TEXT };

// ─── Placing ─────────────────────────────────────────────────────────────────

export interface SourceCandRow extends SourceRow {
  remote_product_id: string; remote_variation_id: string;
  sup_kind: string; sup_name: string; base_url: string; api_key: string; remote_user_id: number;
  usd_toman: number | null; fetched_at: string | null;
}

export const SOURCE_SELECT = `
  SELECT s.id, s.supplier_id, s.remote_product_id, s.remote_variation_id, s.price_usd, s.priority, s.is_enabled, s.listed, s.oos_until,
         sup.is_enabled AS sup_enabled, sup.kind AS sup_kind, sup.name AS sup_name, sup.base_url, sup.api_key, sup.remote_user_id,
         c.usd_toman, c.fetched_at
  FROM product_sources s JOIN suppliers sup ON sup.id = s.supplier_id
  LEFT JOIN supplier_catalogs c ON c.supplier_id = s.supplier_id`;

const supplierRowOf = (c: SourceCandRow): SupplierRow => ({
  id: c.supplier_id, kind: c.sup_kind as 'ariobox', name: c.sup_name, base_url: c.base_url, api_key: c.api_key,
  remote_user_id: c.remote_user_id, is_enabled: c.sup_enabled, last_sync_at: null, last_sync_ok_at: null, last_sync_error: null,
  sync_alert_sent: 0, created_at: '',
});

export type PlaceOutcome = 'deferred' | 'not_claimed' | 'cancelled' | 'placed' | 'queued' | 'failed' | 'unknown' | 'loss';

/**
 * THE ONLY CALLER OF `adapter.placeOrder` (SUPPLIER_PLAN.md §0 rule 7, §7.3). It sends only after winning the atomic
 * `queued → placing` claim. Any outcome that leaves it unclear whether the order was created is `unknown` and goes to
 * an admin; it is never retried here.
 */
export async function placeSupplierOrder(app: StoreApp, soId: number): Promise<PlaceOutcome> {
  if (app.apps.budget.remaining() < MIN_PLACE_BUDGET) return 'deferred';

  // 1. the claim
  const now = nowStr(app);
  const claim = await q(app, `UPDATE supplier_orders SET status = 'placing', lease_until = ?, attempts = attempts + 1, updated_at = ?
                              WHERE id = ? AND status = 'queued' AND (next_attempt_at IS NULL OR next_attempt_at <= ?)`,
  addMinutes(app, LEASE_MINUTES), now, soId, now).run();
  if (claim.meta.changes !== 1) return 'not_claimed';
  const so = await q(app, 'SELECT * FROM supplier_orders WHERE id = ?', soId).first<SupplierOrderRow>();
  if (!so) return 'not_claimed';

  // 2. the store order must still want this
  let order: Order | undefined;
  if (so.purpose === 'customer') {
    order = await app.db.getOrderById(so.order_id!);
    if (!order || order.status !== 'confirmed' || order.fulfillment !== 'supplier' || so.divert_to_stock === 1) {
      await app.raw.batch([
        q(app, "UPDATE supplier_orders SET status = 'cancelled', lease_until = NULL, updated_at = ? WHERE id = ? AND status = 'placing'", nowStr(app), soId),
        eventStatement(app, { orderId: so.order_id, supplierOrderId: soId, kind: 'place_failed', detail: 'order no longer needs it', onlyIfChanged: true }),
      ]);
      return 'cancelled';
    }
  }

  // 3. choose the source, then 4. place (a 409 moves on to the next source)
  const forced = so.forced_source_id !== null || so.purpose === 'stock';
  let sources: SourceCandRow[];
  if (so.purpose === 'stock') {
    // a direct buy names its supplier item itself; it has no product source row
    const direct = await stockCandidate(app, so);
    sources = direct ? [direct] : [];
  } else {
    sources = (await q(app, SOURCE_SELECT + (forced ? ' WHERE s.id = ?' : ' WHERE s.customer_product_id = ? ORDER BY s.priority, s.id'),
      forced ? so.forced_source_id : so.customer_product_id).all<SourceCandRow>()).results;
  }

  for (;;) {
    const cand = forced ? sources[0] ?? null : (pickActiveSource(sources, nowStr(app)) as SourceCandRow | null);
    if (!cand) return noCandidate(app, so, order, forced);

    const basis = await costBasis(app, cand);
    const unitCost = basis.priceUsd !== null && basis.usdToman !== null ? costToman(basis.priceUsd, basis.usdToman) : null;
    // the loss guard protects the automatic path; an admin who pressed «✅ بله» on the loss card has decided
    if (!forced && so.requested_by === 0 && order && unitCost !== null && order.price < unitCost) {
      await app.raw.batch([
        q(app, "UPDATE supplier_orders SET status = 'cancelled', lease_until = NULL, updated_at = ? WHERE id = ? AND status = 'placing'", nowStr(app), soId),
        eventStatement(app, { orderId: order.id, supplierOrderId: soId, kind: 'place_failed', detail: 'loss: price ' + order.price + ' < cost ' + unitCost, onlyIfChanged: true }),
      ]);
      await raiseNeedsAction(app, order.id, 'loss');
      return 'loss';
    }

    // remember what we are about to buy BEFORE the POST: an `unknown` outcome still needs these facts
    const totalCost = unitCost !== null ? Math.round(basis.priceUsd! * so.quantity * basis.usdToman!) : null;
    const persisted = await app.raw.batch([
      q(app, `UPDATE supplier_orders SET source_id = ?, supplier_id = ?, remote_product_id = ?, remote_variation_id = ?, price_usd = ?, usd_toman = ?,
              cost_toman = ?, lease_until = ?, updated_at = ? WHERE id = ? AND status = 'placing'`,
      cand.id || null, cand.supplier_id, cand.remote_product_id, cand.remote_variation_id, basis.priceUsd, basis.usdToman, totalCost,
      addMinutes(app, LEASE_MINUTES), nowStr(app), soId),
      eventStatement(app, { orderId: so.order_id, supplierOrderId: soId, kind: 'claim', actor: so.requested_by, detail: 'source ' + cand.id, onlyIfChanged: true }),
    ]);
    if (persisted[0].meta.changes !== 1) return 'not_claimed';

    if (app.apps.budget.remaining() < MIN_POST_BUDGET) {
      await q(app, "UPDATE supplier_orders SET status = 'queued', attempts = attempts - 1, lease_until = NULL, updated_at = ? WHERE id = ? AND status = 'placing'", nowStr(app), soId).run();
      return 'deferred';
    }

    const note = (so.purpose === 'customer' ? 'store#' + so.order_id + '/so#' : 'stock/so#') + soId;
    const result = await adapterFor(cand.sup_kind, app.apps).placeOrder(supplierRowOf(cand), {
      remoteProductId: cand.remote_product_id, remoteVariationId: cand.remote_variation_id, quantity: so.quantity, note,
    });
    const at = nowStr(app);
    const unit = basis.priceUsd;

    switch (result.kind) {
      case 'placed': {
        const stmts: Stmt[] = [
          q(app, `UPDATE supplier_orders SET status = 'placed', remote_order_id = ?, remote_status = ?, raw_response = ?, last_http = NULL,
                  last_error = NULL, lease_until = NULL, placed_at = ?, next_check_at = ?, checks = 0, updated_at = ?
                  WHERE id = ? AND status = 'placing'`, result.remoteOrderId, result.remoteStatus, result.raw, at, addMinutes(app, 1), at, soId),
        ];
        // the ledger follows the catalog price (Appendix A (b)); skipped when the price is unknown
        if (unit !== null) {
          stmts.push(q(app, `INSERT INTO wallet_ledger (supplier_id, kind, amount_usd, supplier_order_id, note, created_by, created_at)
                             SELECT ?, 'spend', ?, ?, ?, ?, ? WHERE changes() = 1`,
          cand.supplier_id, -round6(unit * so.quantity), soId, note, so.requested_by, at));
        }
        stmts.push(eventStatement(app, { orderId: so.order_id, supplierOrderId: soId, kind: 'placed', actor: so.requested_by, detail: 'remote #' + result.remoteOrderId, onlyIfChanged: true }));
        if (priceMismatch(unit, so.quantity, result.priceUsd)) {
          stmts.push(eventStatement(app, {
            orderId: so.order_id, supplierOrderId: soId, kind: 'price_mismatch',
            detail: 'reported ' + result.priceUsd + ', catalog unit ' + unit + ' × ' + so.quantity,
          }));
        }
        if (order) {
          // an earlier «all out of stock / retry later» card is settled now
          stmts.push(q(app, "UPDATE orders SET needs_action_reason = NULL, needs_action_at = NULL WHERE id = ? AND needs_action_reason IN ('all_out_of_stock', 'retry_later')", order.id));
        }
        await app.raw.batch(stmts);
        if (classifyRemoteStatus(result.remoteStatus) === 'success' && app.apps.budget.remaining() >= 12) {
          await pollSupplierOrder(app, soId, { force: true });
        }
        return 'placed';
      }

      case 'out_of_stock': {
        const until = addMinutes(app, SOURCE_OOS_MINUTES);
        await app.raw.batch([
          q(app, 'UPDATE product_sources SET oos_until = ? WHERE id = ?', until, cand.id),
          eventStatement(app, { orderId: so.order_id, supplierOrderId: soId, kind: 'out_of_stock', detail: cut(cand.sup_name + ' #' + cand.id + ': ' + result.detail, 400) }),
        ]);
        if (so.customer_product_id !== null) await recomputeOption(app, so.customer_product_id);
        if (forced) return finishFailed(app, so, order, 'all_out_of_stock', result.http, result.detail);
        cand.oos_until = until;
        sources = sources.map((s) => (s.id === cand.id ? cand : s));
        if (app.apps.budget.remaining() >= 10) continue;
        await q(app, "UPDATE supplier_orders SET status = 'queued', next_attempt_at = ?, lease_until = NULL, updated_at = ? WHERE id = ? AND status = 'placing'", at, at, soId).run();
        return 'queued';
      }

      case 'retry_later': {
        if (so.purpose === 'stock') return finishFailed(app, so, order, 'retry_later', result.http, result.detail);
        const rs = await app.raw.batch([
          q(app, `UPDATE supplier_orders SET status = 'queued', next_attempt_at = ?, lease_until = NULL, last_http = ?, last_error = ?, updated_at = ?
                  WHERE id = ? AND status = 'placing'`, addMinutes(app, RETRY_MINUTES), result.http, cut(result.detail, 300), at, soId),
          eventStatement(app, { orderId: so.order_id, supplierOrderId: soId, kind: 'place_failed', detail: 'retry_later ' + result.http + ': ' + cut(result.detail, 300), onlyIfChanged: true }),
        ]);
        if (rs[0].meta.changes === 1 && so.first_fail_notified === 0 && order) {
          await q(app, 'UPDATE supplier_orders SET first_fail_notified = 1 WHERE id = ?', soId).run();
          const balance = unit !== null ? await walletBalance(app, cand.supplier_id) : null;
          await raiseNeedsAction(app, order.id, 'retry_later', {
            ...(result.lowBalance ? { header: '💳 موجودی کیف پول «' + escapeHtml(cand.sup_name) + '» کافی نیست — لطفاً شارژ کنید. (سفارش #' + order.id + ')' } : {}),
            ...(balance !== null && unit !== null && balance < unit * so.quantity
              ? { extraLines: ['💳 موجودی تخمینی (' + usd(balance) + ') کمتر از هزینه است.'] } : {}),
          });
        }
        return 'queued';
      }

      case 'config':
        return finishFailed(app, so, order, 'config', result.http, result.detail);
      case 'rejected':
        return finishFailed(app, so, order, 'rejected', result.http, result.detail);

      case 'unknown':
        await markUnknown(app, so.id, result.http, result.detail);
        return 'unknown';
    }
  }
}

/** The candidate of a direct buy: the supplier item named on the row itself, with the cached price and rate. */
async function stockCandidate(app: StoreApp, so: SupplierOrderRow): Promise<SourceCandRow | null> {
  if (so.supplier_id === null || so.remote_product_id === null) return null;
  const sup = await getSupplier(app, so.supplier_id);
  if (!sup || !sup.is_enabled) return null;
  const cached = await readCatalog(app, sup.id);
  const item = cached?.catalog.items.find((i) => i.remoteProductId === so.remote_product_id && i.remoteVariationId === (so.remote_variation_id ?? ''));
  return {
    id: 0, supplier_id: sup.id, remote_product_id: so.remote_product_id, remote_variation_id: so.remote_variation_id ?? '',
    price_usd: item?.priceUsd ?? null, priority: 1, is_enabled: 1, listed: item ? 1 : 0, oos_until: null, sup_enabled: sup.is_enabled,
    sup_kind: sup.kind, sup_name: sup.name, base_url: sup.base_url, api_key: sup.api_key, remote_user_id: sup.remote_user_id,
    usd_toman: cached?.catalog.usdToman ?? null, fetched_at: cached?.fetchedAt ?? null,
  };
}

const stockReasonFa = (reason: NeedsActionReason, detail: string): string => ({
  all_out_of_stock: 'ناموجود است.',
  retry_later: 'تأمین‌کننده فعلاً سفارش را نپذیرفت (' + detail + '). موجودی کیف پول و وضعیت را بررسی کنید.',
  config: 'تنظیمات تأمین‌کننده مشکل دارد (' + detail + ').',
  rejected: 'تأمین‌کننده سفارش را نپذیرفت (' + detail + ').',
} as Record<string, string>)[reason] ?? detail;

/** The price and rate to buy at: the catalog item itself, after a refetch when the cached catalog is stale. */
async function costBasis(app: StoreApp, cand: SourceCandRow): Promise<{ priceUsd: number | null; usdToman: number | null }> {
  let priceUsd = cand.price_usd;
  let usdToman = cand.usd_toman;
  const stale = cand.fetched_at === null || cand.fetched_at < addMinutes(app, -CATALOG_STALE_MINUTES);
  if (stale && app.apps.budget.remaining() >= 20) {
    const supplier = await getSupplier(app, cand.supplier_id);
    if (supplier) {
      await syncSupplier(app, supplier);
      const cached = await readCatalog(app, cand.supplier_id);
      if (cached) {
        usdToman = cached.catalog.usdToman;
        const item = cached.catalog.items.find((i) => i.remoteProductId === cand.remote_product_id && i.remoteVariationId === cand.remote_variation_id);
        if (item?.priceUsd != null) priceUsd = item.priceUsd;
      }
    }
  }
  return { priceUsd, usdToman };
}

/** No usable source: wait and retry every 15 minutes; tell the admins once. A forced source that is gone fails. */
async function noCandidate(app: StoreApp, so: SupplierOrderRow, order: Order | undefined, forced: boolean): Promise<PlaceOutcome> {
  if (forced) return finishFailed(app, so, order, 'rejected', null, 'منبع انتخاب‌شده دیگر وجود ندارد');
  const at = nowStr(app);
  const rs = await app.raw.batch([
    q(app, "UPDATE supplier_orders SET status = 'queued', next_attempt_at = ?, lease_until = NULL, updated_at = ? WHERE id = ? AND status = 'placing'",
      addMinutes(app, RETRY_MINUTES), at, so.id),
    eventStatement(app, { orderId: so.order_id, supplierOrderId: so.id, kind: 'out_of_stock', detail: 'no source available', onlyIfChanged: true }),
  ]);
  if (rs[0].meta.changes === 1 && so.first_fail_notified === 0 && order) {
    await q(app, 'UPDATE supplier_orders SET first_fail_notified = 1 WHERE id = ?', so.id).run();
    const until = order.supplier_deadline_at ? formatJalaliDateTime(order.supplier_deadline_at) : '—';
    await raiseNeedsAction(app, order.id, 'all_out_of_stock', {
      header: '⚠️ سفارش #' + order.id + ' — همه‌ی منبع‌ها ناموجودند؛ ربات هر ۱۵ دقیقه دوباره تلاش می‌کند تا ' + until,
    });
  }
  return 'queued';
}

/** `config` / `rejected` / forced out of stock: nothing was bought, and trying again changes nothing by itself. */
async function finishFailed(
  app: StoreApp, so: SupplierOrderRow, order: Order | undefined, reason: NeedsActionReason, http: number | null, detail: string,
): Promise<PlaceOutcome> {
  const rs = await app.raw.batch([
    q(app, "UPDATE supplier_orders SET status = 'failed', lease_until = NULL, last_http = ?, last_error = ?, updated_at = ? WHERE id = ? AND status = 'placing'",
      http, cut(detail, 300), nowStr(app), so.id),
    eventStatement(app, { orderId: so.order_id, supplierOrderId: so.id, kind: 'place_failed', detail: reason + ' ' + (http ?? '') + ': ' + cut(detail, 300), onlyIfChanged: true }),
  ]);
  if (rs[0].meta.changes === 1 && order) await raiseNeedsAction(app, order.id, reason);
  if (rs[0].meta.changes === 1 && so.purpose === 'stock') await notifyStockProblem(app, so.id, 'failed', stockReasonFa(reason, detail));
  return 'failed';
}

/**
 * The order MAY have been created at the supplier (timeout, network error, 5xx, an answer without an order id, or a
 * lease that ran out). It goes to the admin and is NEVER retried automatically.
 */
export async function markUnknown(app: StoreApp, soId: number, http: number | null, detail: string): Promise<void> {
  const rs = await app.raw.batch([
    q(app, "UPDATE supplier_orders SET status = 'unknown', lease_until = NULL, last_http = ?, last_error = ?, updated_at = ? WHERE id = ? AND status = 'placing'",
      http, cut(detail, 300), nowStr(app), soId),
    eventStatement(app, { supplierOrderId: soId, kind: 'unknown', detail: (http ?? '') + ' ' + cut(detail, 300), onlyIfChanged: true }),
  ]);
  if (rs[0].meta.changes !== 1) return;
  const so = await q(app, 'SELECT order_id, purpose FROM supplier_orders WHERE id = ?', soId).first<{ order_id: number | null; purpose: string }>();
  if (so?.order_id) await raiseNeedsAction(app, so.order_id, 'unknown');
  else if (so?.purpose === 'stock') await notifyStockProblem(app, soId, 'unknown', '');
}

// ─── Polling ─────────────────────────────────────────────────────────────────

/** Minutes until the next poll after the n-th check: the first poll is 1 minute after placing, then 2, 5, 10, 10, … */
export const pollDelayMinutes = (checksDone: number): number => [2, 5, 10][Math.min(Math.max(checksDone, 1) - 1, 2)];

const EMPTY_MARK = 'completed_no_accounts:';
/** Polls that see `completed` without accounts before the admin is asked (the first one plus three more). */
const EMPTY_POLLS_LIMIT = 4;

/**
 * One check of a placed supplier order (SUPPLIER_PLAN.md §7.4). The poll is claimed by pushing `next_check_at`
 * forward with an optimistic `checks` check, so the webhook and cron can't both run it.
 */
export async function pollSupplierOrder(app: StoreApp, soId: number, opts: { force?: boolean } = {}): Promise<void> {
  if (app.apps.budget.remaining() < 8) return;
  const so = await q(app, 'SELECT * FROM supplier_orders WHERE id = ?', soId).first<SupplierOrderRow>();
  if (!so || so.status !== 'placed' || !so.remote_order_id || so.supplier_id === null) return;

  const now = nowStr(app);
  const claim = await q(app, `UPDATE supplier_orders SET next_check_at = ?, checks = checks + 1, updated_at = ?
                              WHERE id = ? AND status = 'placed' AND checks = ? AND (? = 1 OR next_check_at <= ?)`,
  addMinutes(app, pollDelayMinutes(so.checks + 1)), now, soId, so.checks, opts.force ? 1 : 0, now).run();
  if (claim.meta.changes !== 1) return;

  const supplier = await getSupplier(app, so.supplier_id);
  if (!supplier) return;
  const r = await adapterFor(supplier.kind, app.apps).getOrder(supplier, so.remote_order_id);
  if (r.kind === 'error') {
    // a poll error never changes the state: the next scheduled poll tries again
    await q(app, 'UPDATE supplier_orders SET last_http = ?, last_error = ? WHERE id = ?', r.http, cut(r.detail, 300), soId).run();
    return;
  }

  const verdict = classifyRemoteStatus(r.remoteStatus);
  const save = (extra: string, ...args: unknown[]) =>
    q(app, `UPDATE supplier_orders SET remote_status = ?, raw_response = ?, ${extra} WHERE id = ? AND status = 'placed'`, r.remoteStatus, r.raw, ...args, soId);

  if (verdict === 'success') {
    if (r.accounts.length > 0) {
      await completeAndDeliver(app, so, r.remoteStatus, r.raw, r.accounts);
      return;
    }
    const previous = so.last_error?.startsWith(EMPTY_MARK) ? Number(so.last_error.slice(EMPTY_MARK.length)) || 0 : 0;
    const seen = previous + 1;
    await save('last_error = ?', EMPTY_MARK + seen).run();
    if (seen >= EMPTY_POLLS_LIMIT) {
      const rs = await app.raw.batch([
        q(app, "UPDATE supplier_orders SET status = 'failed', updated_at = ? WHERE id = ? AND status = 'placed'", now, soId),
        eventStatement(app, { orderId: so.order_id, supplierOrderId: soId, kind: 'poll', detail: 'completed without accounts', onlyIfChanged: true }),
      ]);
      if (rs[0].meta.changes === 1 && so.order_id !== null) await raiseNeedsAction(app, so.order_id, 'completed_no_accounts');
      else if (rs[0].meta.changes === 1) await notifyStockProblem(app, soId, 'empty', 'سفارش در تأمین‌کننده تکمیل شد ولی اکانتی برنگشت. با تأمین‌کننده هماهنگ کنید.');
    }
    return;
  }

  if (verdict === 'failure') {
    const rs = await app.raw.batch([
      save("status = 'failed', last_error = ?, updated_at = ?", cut(r.message ?? r.remoteStatus, 300), now),
      eventStatement(app, { orderId: so.order_id, supplierOrderId: soId, kind: 'poll', detail: 'final failure: ' + r.remoteStatus, onlyIfChanged: true }),
    ]);
    if (rs[0].meta.changes === 1 && so.order_id !== null) await raiseNeedsAction(app, so.order_id, 'supplier_failed');
    else if (rs[0].meta.changes === 1 && so.purpose === 'stock') {
      await notifyStockProblem(app, soId, 'failed', 'تأمین‌کننده سفارش را ناموفق اعلام کرد (' + r.remoteStatus + '). اگر مبلغ برگشته در تاریخچه‌ی کیف پول «بازگشت وجه» ثبت کنید.');
    }
    return;
  }

  // still in progress
  await save('last_error = ?, updated_at = ?', r.message ? cut(r.message, 300) : null, now).run();
}

// ─── Completion and delivery ─────────────────────────────────────────────────

type Accounts = { fields: { key: string; value: string }[] }[];

/**
 * The supplier order finished with accounts. If the store order still waits for them they are saved as a pending
 * delivery (in the same batch that completes the supplier order, so they can't be lost) and sent; otherwise they go
 * to «اکانت‌های من» and the customer gets nothing (SUPPLIER_PLAN.md §7.5 step 1).
 */
async function completeAndDeliver(app: StoreApp, so: SupplierOrderRow, remoteStatus: string, raw: string, accounts: Accounts): Promise<void> {
  if (so.purpose === 'stock') {
    await completeStockOrder(app, so, remoteStatus, raw, accounts);
    return;
  }
  const now = nowStr(app);
  const order = so.order_id !== null ? await app.db.getOrderById(so.order_id) : undefined;
  const wanted = !!order && order.status === 'confirmed' && order.fulfillment === 'supplier' && so.divert_to_stock === 0;
  const content: DeliveryContent = { accounts };

  if (!wanted) {
    await app.raw.batch([
      q(app, "UPDATE supplier_orders SET status = 'completed', remote_status = ?, raw_response = ?, completed_at = ?, next_check_at = NULL, updated_at = ? WHERE id = ? AND status = 'placed'",
        remoteStatus, raw, now, now, so.id),
      eventStatement(app, { orderId: so.order_id, supplierOrderId: so.id, kind: 'completed', onlyIfChanged: true }),
    ]);
    await divertToStock(app, so, accounts, order);
    return;
  }

  const rs = await app.raw.batch([
    q(app, "UPDATE supplier_orders SET status = 'completed', remote_status = ?, raw_response = ?, completed_at = ?, next_check_at = ?, last_error = NULL, updated_at = ? WHERE id = ? AND status = 'placed'",
      remoteStatus, raw, now, now, now, so.id),
    q(app, `INSERT INTO order_deliveries (order_id, kind, content_json, supplier_order_id, sent_ok, created_by, created_at)
            SELECT ?, 'supplier', ?, ?, 0, 0, ? WHERE changes() = 1`, order!.id, JSON.stringify(content), so.id, now),
    eventStatement(app, { orderId: order!.id, supplierOrderId: so.id, kind: 'completed' }),
  ]);
  if (rs[0].meta.changes !== 1) return;
  await deliverToCustomer(app, order!.id, content, { kind: 'supplier', supplierOrderId: so.id, existingDeliveryId: rs[1].meta.last_row_id });
}

/** Accounts that arrived for an order that was resolved some other way: saved as stock, the admins are told. */
async function divertToStock(app: StoreApp, so: SupplierOrderRow, accounts: Accounts, order: Order | undefined): Promise<void> {
  const name = order?.product_name ?? 'سفارش';
  await createStockBatch(app, {
    supplierId: so.supplier_id, supplierOrderId: so.id,
    title: name + ' (برگشتی از سفارش #' + so.order_id + ')',
    accounts, unitPriceUsd: so.price_usd, usdToman: so.usd_toman, costToman: so.cost_toman,
    orderId: so.order_id, eventKind: 'diverted_to_stock', eventDetail: 'divert_to_stock=' + so.divert_to_stock + ' status=' + (order?.status ?? '?'),
  });
  await sendToAdmins(app, '📦 اکانت سفارش #' + so.order_id + ' که قبلاً تعیین‌تکلیف شده بود رسید و به «اکانت‌های من» اضافه شد.');
}

export interface DeliveryMeta {
  kind: 'supplier' | 'stock' | 'manual_text';
  supplierOrderId?: number | null;
  stockAccountId?: number | null;
  actor?: number;
  /** the admin's name for the notice «✍️ متن دستی (ADMIN)» */
  actorName?: string;
  /** what this account cost (stock / manual text); a supplier delivery reads it from the supplier order */
  costToman?: number | null;
  /** a delivery row saved earlier (the supplier completion batch); no new row is inserted */
  existingDeliveryId?: number;
  /** the order was created already delivered (manual-link stock orders): nothing to mark, nothing to re-check */
  alreadyDelivered?: boolean;
}

export type DeliverResult = 'delivered' | 'diverted' | 'send_failed' | 'skipped' | 'deferred';

/**
 * Sends accounts to the customer and finishes the order (SUPPLIER_PLAN.md §7.5). Shared by supplier completion,
 * stock and manual text. Re-checks the order first, so a customer is never given an account for an order that was
 * delivered or cancelled in the meantime.
 */
export async function deliverToCustomer(app: StoreApp, orderId: number, content: DeliveryContent, meta: DeliveryMeta): Promise<DeliverResult> {
  if (app.apps.budget.remaining() < 6 + app.cfg.adminIds.length) return 'deferred';
  const order = await app.db.getOrderById(orderId);
  const so = meta.supplierOrderId ? await q(app, 'SELECT * FROM supplier_orders WHERE id = ?', meta.supplierOrderId).first<SupplierOrderRow>() : null;

  const stateOk = !!order && (meta.alreadyDelivered ? order.status === 'delivered' : order.status === 'confirmed');
  const supplierOk = meta.kind !== 'supplier' || (order?.fulfillment === 'supplier' && so?.divert_to_stock !== 1);
  if (!stateOk || !supplierOk) {
    if (meta.kind === 'supplier' && so && 'accounts' in content) {
      await divertToStock(app, so, content.accounts, order ?? undefined);
      return 'diverted';
    }
    return 'skipped';
  }

  let deliveryId = meta.existingDeliveryId;
  if (deliveryId === undefined) {
    const r = await q(app, `INSERT INTO order_deliveries (order_id, kind, content_json, supplier_order_id, stock_account_id, sent_ok, created_by, created_at)
                            VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
    orderId, meta.kind, JSON.stringify(content), meta.supplierOrderId ?? null, meta.stockAccountId ?? null, meta.actor ?? 0, nowStr(app)).run();
    deliveryId = r.meta.last_row_id;
  }
  return finishDelivery(app, order!, deliveryId, content, meta, so);
}

const DELIVERY_TAIL =
  '\n\n✅ لطفاً مراحل فعال‌سازی را طی کنید.\n📣 کانال ما: @mai_academia\n\n🔑 این اطلاعات را بعداً هم از «📋 اشتراک‌های من» می‌توانید ببینید.';

/** The customer's message(s) for a delivery (HTML, split under the Telegram limit). */
export function deliveryMessages(productName: string, content: DeliveryContent): string[] {
  return splitHtml('🎉 سفارش «' + escapeHtml(productName) + '» آماده است!\n\n' + formatAccountsHtml(content) + DELIVERY_TAIL);
}

/** Sends the stored delivery and, on success, marks the order delivered; on failure raises the «send_failed» card. */
async function finishDelivery(
  app: StoreApp, order: Order, deliveryId: number, content: DeliveryContent, meta: DeliveryMeta, so: SupplierOrderRow | null,
): Promise<DeliverResult> {
  try {
    for (const part of deliveryMessages(order.product_name, content)) {
      await app.api.sendMessage(order.customer_telegram_id, part, { parse_mode: 'HTML' });
    }
  } catch (err: any) {
    if (err instanceof BudgetExceededError) throw err;
    const why = cut(String(err?.description ?? err?.message ?? 'send failed'), 300);
    const stmts = [
      q(app, 'UPDATE order_deliveries SET send_error = ? WHERE id = ?', why, deliveryId),
      eventStatement(app, { orderId: order.id, supplierOrderId: meta.supplierOrderId ?? null, kind: 'send_failed', actor: meta.actor, detail: why }),
    ];
    // no automatic retry: a resend is always an explicit admin action
    if (meta.supplierOrderId) stmts.push(q(app, 'UPDATE supplier_orders SET next_check_at = NULL WHERE id = ?', meta.supplierOrderId));
    await app.raw.batch(stmts);
    await raiseNeedsAction(app, order.id, 'send_failed');
    return 'send_failed';
  }

  const cost = meta.costToman !== undefined ? meta.costToman : so?.cost_toman ?? null;
  const now = nowStr(app);
  const fulfillment = meta.kind;
  const stmts: Stmt[] = [
    meta.alreadyDelivered ? q(app, 'SELECT 1') : app.db.markDeliveredStatement(order.id, now),
    q(app, 'UPDATE order_deliveries SET sent_ok = 1, send_error = NULL WHERE id = ?', deliveryId),
    q(app, 'UPDATE orders SET cost_toman = COALESCE(?, cost_toman), fulfillment = ?, needs_action_reason = NULL, needs_action_at = NULL WHERE id = ?', cost, fulfillment, order.id),
    eventStatement(app, { orderId: order.id, supplierOrderId: meta.supplierOrderId ?? null, kind: 'delivered', actor: meta.actor, detail: fulfillment }),
  ];
  if (meta.supplierOrderId) stmts.push(q(app, 'UPDATE supplier_orders SET next_check_at = NULL WHERE id = ?', meta.supplierOrderId));
  // a stock account given to the customer is «delivered» (it was reserved for this order)
  if (meta.stockAccountId) stmts.push(q(app, "UPDATE stock_accounts SET status = 'delivered', order_id = ?, updated_at = ? WHERE id = ?", order.id, now, meta.stockAccountId));
  const rs = await app.raw.batch(stmts);
  if (!meta.alreadyDelivered && rs[0].meta.changes !== 1) {
    console.warn('⚠️ [Supplier] order #' + order.id + ' was already delivered when its accounts were sent.');
  }

  await sendDeliveredNotice(app, order, meta, so, cost);
  return 'delivered';
}

/** The admin message after a successful delivery (SUPPLIER_PLAN.md §7.5 step 4; `manual_outside` = «خودم تحویل دادم»). */
export async function sendDeliveredNotice(
  app: StoreApp, order: Order, meta: Omit<DeliveryMeta, 'kind'> & { kind: DeliveryMeta['kind'] | 'manual_outside' }, so: SupplierOrderRow | null, cost: number | null,
): Promise<void> {
  const customer = await q(app, 'SELECT display_name FROM customers WHERE telegram_id = ?', order.customer_telegram_id).first<{ display_name: string }>();
  let source: string;
  const extra: string[] = [];
  if (meta.kind === 'supplier' && so) {
    const sup = so.supplier_id !== null ? await getSupplier(app, so.supplier_id) : undefined;
    source = '🔌 منبع: ' + escapeHtml(sup?.name ?? 'تأمین‌کننده') + ' (سفارش #' + escapeHtml(so.remote_order_id ?? '?') + ')';
    const reported = reportedPrice(so.raw_response);
    if (priceMismatch(so.price_usd, so.quantity, reported)) {
      extra.push('⚠️ قیمت اعلام‌شده‌ی تأمین‌کننده ($' + reported + ') با قیمت کاتالوگ ($' + so.price_usd + ') نمی‌خواند؛ هزینه را بررسی کنید.');
    }
  } else if (meta.kind === 'stock') {
    source = '📦 از اکانت‌های من';
  } else if (meta.kind === 'manual_outside') {
    source = '🙋 تحویل دستی (' + escapeHtml(meta.actorName ?? 'ادمین') + ')';
  } else {
    source = '✍️ متن دستی (' + escapeHtml(meta.actorName ?? 'ادمین') + ')';
  }
  const money = cost !== null
    ? '💰 فروش: ' + formatPrice(order.price) + ' ت | خرید: ' + formatPrice(cost) + ' ت | سود: ' + formatPrice(order.price - cost) + ' ت'
    : '💰 فروش: ' + formatPrice(order.price) + ' ت | هزینه نامشخص';
  const html = [
    '✅ سفارش #' + order.id + ' تحویل شد',
    customerRefHtml({ id: order.customer_telegram_id, name: customer?.display_name ?? String(order.customer_telegram_id), username: order.customer_username }),
    '📦 محصول: ' + escapeHtml(order.product_name),
    source,
    money,
    ...extra,
  ].join('\n');
  await sendToAdmins(app, html, [
    ...(meta.kind === 'manual_outside' ? [] : [[Markup.button.callback('👁 نمایش اکانت', 'fo_view_' + order.id)]]),
    customerContactRow(order.customer_telegram_id, order.customer_username, order.id),
  ]);
}

/** The latest delivery of an order: its stored content and ids. */
export async function latestDelivery(app: StoreApp, orderId: number, onlySent = false) {
  const row = await q(app, 'SELECT * FROM order_deliveries WHERE order_id = ?' + (onlySent ? ' AND sent_ok = 1' : '') + ' ORDER BY id DESC LIMIT 1', orderId)
    .first<{ id: number; kind: 'supplier' | 'stock' | 'manual_text'; content_json: string; supplier_order_id: number | null; stock_account_id: number | null; sent_ok: number; send_error: string | null }>();
  if (!row) return null;
  const content = parseContent(row.content_json);
  return content ? { ...row, content } : null;
}

/** An explicit resend of the latest delivery (`fo_resend`): the same send-and-finish as the first time. */
export async function resendDelivery(app: StoreApp, orderId: number, actor: number): Promise<DeliverResult | 'none'> {
  const order = await app.db.getOrderById(orderId);
  const d = await latestDelivery(app, orderId);
  if (!order || !d) return 'none';
  if (order.status !== 'confirmed' && order.status !== 'delivered') return 'skipped';
  const so = d.supplier_order_id ? await q(app, 'SELECT * FROM supplier_orders WHERE id = ?', d.supplier_order_id).first<SupplierOrderRow>() : null;
  // a stock account keeps its cost across a resend (a manual text has none)
  const costToman = d.kind === 'stock' && d.stock_account_id ? await stockUnitCost(app, d.stock_account_id) : undefined;
  return finishDelivery(app, order, d.id, d.content, {
    kind: d.kind, supplierOrderId: d.supplier_order_id, stockAccountId: d.stock_account_id, actor,
    alreadyDelivered: order.status === 'delivered', ...(costToman !== undefined ? { costToman } : {}),
  }, so);
}

// ─── Admin recorded the remote order id (an `unknown` order that did exist) ──

export async function recordRemoteOrderId(app: StoreApp, orderId: number, remoteOrderId: string, actor: number): Promise<'ok' | 'none'> {
  const so = await q(app, "SELECT * FROM supplier_orders WHERE order_id = ? AND status = 'unknown' ORDER BY id DESC LIMIT 1", orderId).first<SupplierOrderRow>();
  return so ? recordRemoteId(app, so, remoteOrderId, actor) : 'none';
}

/** The same for an `unknown` direct buy (no store order): the supplier order goes on as placed and is polled. */
export async function recordStockRemoteOrderId(app: StoreApp, soId: number, remoteOrderId: string, actor: number): Promise<'ok' | 'none'> {
  const so = await q(app, "SELECT * FROM supplier_orders WHERE id = ? AND purpose = 'stock' AND status = 'unknown'", soId).first<SupplierOrderRow>();
  return so ? recordRemoteId(app, so, remoteOrderId, actor) : 'none';
}

async function recordRemoteId(app: StoreApp, so: SupplierOrderRow, remoteOrderId: string, actor: number): Promise<'ok' | 'none'> {
  const now = nowStr(app);
  const note = so.purpose === 'customer' ? 'store#' + so.order_id + '/so#' + so.id : 'stock/so#' + so.id;
  const stmts: Stmt[] = [
    q(app, "UPDATE supplier_orders SET status = 'placed', remote_order_id = ?, placed_at = ?, next_check_at = ?, checks = 0, last_error = NULL, updated_at = ? WHERE id = ? AND status = 'unknown'",
      remoteOrderId, now, addMinutes(app, 1), now, so.id),
  ];
  if (so.price_usd !== null && so.supplier_id !== null) {
    stmts.push(q(app, `INSERT INTO wallet_ledger (supplier_id, kind, amount_usd, supplier_order_id, note, created_by, created_at)
                       SELECT ?, 'spend', ?, ?, ?, ?, ? WHERE changes() = 1`,
    so.supplier_id, -round6(so.price_usd * so.quantity), so.id, note, actor, now));
  }
  stmts.push(eventStatement(app, { orderId: so.order_id, supplierOrderId: so.id, kind: 'remote_id_set', actor, detail: remoteOrderId, onlyIfChanged: true }));
  if (so.order_id !== null) {
    stmts.push(q(app, "UPDATE orders SET needs_action_reason = NULL, needs_action_at = NULL WHERE id = ? AND needs_action_reason = 'unknown'", so.order_id));
  }
  const rs = await app.raw.batch(stmts);
  return rs[0].meta.changes === 1 ? 'ok' : 'none';
}

// ─── Cron ────────────────────────────────────────────────────────────────────

/** Runs one unit of work; a budget error stops the whole step, any other error only skips the unit. */
async function runUnit(label: string, fn: () => Promise<unknown>): Promise<'ok' | 'stop'> {
  try {
    await fn();
    return 'ok';
  } catch (err: any) {
    if (err instanceof BudgetExceededError) return 'stop';
    console.error('❌ [Supplier] ' + label + ' failed:', err?.message ?? err);
    return 'ok';
  }
}

export const STALE_LEASE_SQL = "SELECT id FROM supplier_orders WHERE status = 'placing' AND lease_until < ? ORDER BY lease_until LIMIT ?";
export const QUEUED_DUE_SQL = "SELECT id FROM supplier_orders WHERE status = 'queued' AND next_attempt_at <= ? ORDER BY next_attempt_at LIMIT ?";
export const PLACED_DUE_SQL = "SELECT id FROM supplier_orders WHERE status = 'placed' AND next_check_at <= ? ORDER BY next_check_at LIMIT ?";
export const UNDELIVERED_SQL = "SELECT id, order_id FROM supplier_orders WHERE status = 'completed' AND next_check_at <= ? ORDER BY next_check_at LIMIT ?";
/** Confirmed supplier orders that never got a supplier order or a decision card (the confirm ran out of budget or failed). */
export const STRANDED_SQL = `SELECT id, customer_product_id FROM orders
  WHERE status = 'confirmed' AND fulfillment = 'supplier' AND needs_action_reason IS NULL
    AND NOT EXISTS (SELECT 1 FROM supplier_orders so WHERE so.order_id = orders.id) AND supplier_deadline_at <= ? LIMIT ?`;
export const DEADLINE_SQL =
  "SELECT id FROM orders WHERE status = 'confirmed' AND fulfillment = 'supplier' AND stalled_alert_sent = 0 AND supplier_deadline_at < ? LIMIT ?";

/**
 * The every-minute supplier work (SUPPLIER_PLAN.md §7.6): stale leases, due placements, due polls, deliveries that
 * did not fit an earlier budget, and the 20-hour deadline. Stops whenever the budget is low.
 */
export async function processSupplierWork(app: StoreApp): Promise<void> {
  const budget = app.apps.budget;
  const enough = () => budget.remaining() >= MIN_WORK_BUDGET;
  if (!enough()) return;
  const now = nowStr(app);
  const ids = async (sql: string, limit: number) => (await q(app, sql, now, limit).all<{ id: number; order_id?: number }>()).results;

  for (const row of await ids(STALE_LEASE_SQL, FOLLOWUP_LIMITS.stale)) {
    if (!enough() || (await runUnit('stale lease #' + row.id, () => markUnknown(app, row.id, null, 'lease expired: the Worker stopped while placing'))) === 'stop') return;
  }
  if (!enough()) return;
  // a confirm that could not finish starting its supplier order is finished here (60 s grace for one still running)
  // (the deadline is confirm time + 20 h, so «confirmed more than 60 s ago» is a deadline before now + 20 h − 60 s)
  const grace = tehranDateTime(new Date(app.apps.now().getTime() + DEADLINE_HOURS * 3_600_000 - 60_000));
  for (const row of (await q(app, STRANDED_SQL, grace, FOLLOWUP_LIMITS.stranded).all<{ id: number; customer_product_id: number }>()).results) {
    if (!enough() || (await runUnit('start #' + row.id, () => restartStranded(app, row.id, row.customer_product_id))) === 'stop') return;
  }
  if (!enough()) return;
  for (const row of await ids(QUEUED_DUE_SQL, FOLLOWUP_LIMITS.queued)) {
    if (!enough() || (await runUnit('place #' + row.id, () => placeSupplierOrder(app, row.id))) === 'stop') return;
  }
  if (!enough()) return;
  for (const row of await ids(PLACED_DUE_SQL, FOLLOWUP_LIMITS.placed)) {
    if (!enough() || (await runUnit('poll #' + row.id, () => pollSupplierOrder(app, row.id))) === 'stop') return;
  }
  if (!enough()) return;
  for (const row of await ids(UNDELIVERED_SQL, FOLLOWUP_LIMITS.completed)) {
    if (!enough() || (await runUnit('deliver #' + row.id, () => redeliverCompleted(app, row.id, row.order_id!))) === 'stop') return;
  }
  if (!enough()) return;
  for (const row of await ids(DEADLINE_SQL, FOLLOWUP_LIMITS.deadline)) {
    if (budget.remaining() < MIN_WORK_BUDGET + app.cfg.adminIds.length) return;
    if ((await runUnit('deadline #' + row.id, () => deadlineAlert(app, row.id))) === 'stop') return;
  }
}

async function restartStranded(app: StoreApp, orderId: number, productId: number): Promise<void> {
  const order = await app.db.getOrderById(orderId);
  if (!order || order.status !== 'confirmed') return;
  const product = await app.db.getCustomerProductById(productId);
  const sources = await sourceSummary(app, productId);
  await startSupplierFulfillment(app, order, product, sources.enabled);
}

/** A completed supplier order whose delivery did not happen yet (budget): sends the pending delivery. */
async function redeliverCompleted(app: StoreApp, soId: number, orderId: number): Promise<void> {
  const now = nowStr(app);
  // claim: push the retry time so a parallel invocation skips it
  const claim = await q(app, "UPDATE supplier_orders SET next_check_at = ? WHERE id = ? AND status = 'completed' AND next_check_at <= ?", addMinutes(app, 5), soId, now).run();
  if (claim.meta.changes !== 1) return;
  const d = await q(app, 'SELECT id, order_id, content_json FROM order_deliveries WHERE order_id = ? AND supplier_order_id = ? AND sent_ok = 0 ORDER BY id DESC LIMIT 1', orderId, soId)
    .first<{ id: number; order_id: number; content_json: string }>();
  const content = d ? parseContent(d.content_json) : null;
  if (!d || !content) {
    await q(app, 'UPDATE supplier_orders SET next_check_at = NULL WHERE id = ?', soId).run();
    return;
  }
  await deliverToCustomer(app, d.order_id, content, { kind: 'supplier', supplierOrderId: soId, existingDeliveryId: d.id });
}

/** 20 hours after the receipt was confirmed and still not delivered (SUPPLIER_PLAN.md §7.6 step 5). Once per order. */
async function deadlineAlert(app: StoreApp, orderId: number): Promise<void> {
  const claim = await q(app, "UPDATE orders SET stalled_alert_sent = 1 WHERE id = ? AND status = 'confirmed' AND stalled_alert_sent = 0", orderId).run();
  if (claim.meta.changes !== 1) return;
  const so = await q(app, 'SELECT id, status, remote_status FROM supplier_orders WHERE order_id = ? ORDER BY id DESC LIMIT 1', orderId)
    .first<{ id: number; status: string; remote_status: string | null }>();
  const stop = so !== null && (so.status === 'queued' || so.status === 'failed');
  if (stop) {
    await app.raw.batch([
      q(app, "UPDATE supplier_orders SET status = 'cancelled', updated_at = ? WHERE id = ? AND status IN ('queued', 'failed')", nowStr(app), so!.id),
      eventStatement(app, { orderId, supplierOrderId: so!.id, kind: 'needs_action', detail: 'deadline: automatic tries stopped' }),
    ]);
  }
  const suffix = so?.status === 'placed' ? ' (در صف تأمین‌کننده: ' + escapeHtml(so.remote_status ?? '—') + ')' : '';
  await raiseNeedsAction(app, orderId, 'deadline', {
    header: '⏰ ۲۰ ساعت از تأیید سفارش #' + orderId + ' گذشته و هنوز تحویل نشده.' + suffix,
    keepExisting: !stop && so?.status !== 'placed',
  });
}

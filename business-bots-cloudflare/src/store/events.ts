import type { StoreApp } from '../apps';
import type { Stmt } from '../lib/budget';
import { tehranDateTime } from '../lib/time';

/** Event kinds for `fulfillment_events.kind` (SUPPLIER_PLAN.md §2.6). */
export type FulfillmentEventKind =
  | 'queued' | 'claim' | 'placed' | 'place_failed' | 'out_of_stock' | 'unknown' | 'poll' | 'completed' | 'delivered'
  | 'send_failed' | 'needs_action' | 'admin_retry' | 'admin_source' | 'admin_stock' | 'admin_text' | 'admin_self'
  | 'admin_done' | 'admin_cancel' | 'refund_done' | 'admin_message' | 'diverted_to_stock' | 'cost_set' | 'remote_id_set' | 'price_mismatch' | 'admin_undo';

export interface EventInput {
  orderId?: number | null;
  /** `'last'` = the supplier order inserted earlier in the same batch (SELECT MAX(id) is safe inside one transaction) */
  supplierOrderId?: number | null | 'last';
  batchId?: number | null;
  kind: FulfillmentEventKind;
  actor?: number;
  detail?: unknown;
  /** `'changes'` = write the event only when the statement just before it in the batch changed a row */
  onlyIfChanged?: boolean;
  /** write the event only when this SQL condition holds (e.g. an EXISTS on the order's new state) */
  guard?: { sql: string; args: unknown[] };
}

export const EVENT_DETAIL_MAX = 500;

/** One INSERT, returned as a statement so callers can put it in the same batch as the change it records. */
export function eventStatement(app: StoreApp, e: EventInput): Stmt {
  const raw = e.detail === undefined || e.detail === null ? null : typeof e.detail === 'string' ? e.detail : JSON.stringify(e.detail);
  const last = e.supplierOrderId === 'last';
  const soId = last ? '(SELECT MAX(id) FROM supplier_orders)' : '?';
  const values = [e.orderId ?? null, ...(last ? [] : [e.supplierOrderId ?? null]), e.batchId ?? null, e.kind, e.actor ?? 0,
    raw === null ? null : raw.slice(0, EVENT_DETAIL_MAX), tehranDateTime(app.apps.now())];
  const cols = 'INSERT INTO fulfillment_events (order_id, supplier_order_id, batch_id, kind, actor, detail, created_at) ';
  const sql = e.guard
    ? cols + 'SELECT ?, ' + soId + ', ?, ?, ?, ?, ? WHERE ' + e.guard.sql
    : e.onlyIfChanged
      ? cols + 'SELECT ?, ' + soId + ', ?, ?, ?, ?, ? WHERE changes() = 1'
      : cols + 'VALUES (?, ' + soId + ', ?, ?, ?, ?, ?)';
  return app.raw.prepare(sql).bind(...values, ...(e.guard?.args ?? []));
}

export async function logEvent(app: StoreApp, e: EventInput): Promise<void> {
  await eventStatement(app, e).run();
}

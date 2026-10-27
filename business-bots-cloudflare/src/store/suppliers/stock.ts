import type { StoreApp } from '../../apps';
import { tehranDateTime } from '../../lib/time';
import { eventStatement } from '../events';
import type { Stmt } from '../../lib/budget';
import type { FulfillmentEventKind } from '../events';
import type { DeliveryContent } from './format';

/** What one account of the batch cost: the batch's total cost divided by its size; null when unknown. */
export async function stockUnitCost(app: StoreApp, accountId: number): Promise<number | null> {
  const row = await app.raw.prepare('SELECT b.cost_toman, b.quantity FROM stock_accounts a JOIN stock_batches b ON b.id = a.batch_id WHERE a.id = ?')
    .bind(accountId).first<{ cost_toman: number | null; quantity: number }>();
  return row && row.cost_toman !== null && row.quantity > 0 ? Math.round(row.cost_toman / row.quantity) : null;
}

export interface NewStockBatch {
  supplierId: number | null;
  supplierOrderId: number | null;
  title: string;
  accounts: { fields: { key: string; value: string }[] }[];
  unitPriceUsd: number | null;
  usdToman: number | null;
  costToman: number | null;
  note?: string | null;
  createdBy?: number;
  orderId?: number | null;
  eventKind?: FulfillmentEventKind;
  eventDetail?: string;
  /** a statement that must change a row for the batch to be saved at all (e.g. the supplier order's `placed → completed`), run first in the same batch */
  claim?: Stmt;
  /** statements that run after the accounts, in the same batch; they must carry their own guard (they do not follow `changes()`) */
  extra?: Stmt[];
}

/**
 * Saves a batch and one `available` account per element, in one batch (the accounts take the batch id with
 * `SELECT MAX(id)`, which is safe inside one transaction). Returns the batch id.
 */
export async function createStockBatch(app: StoreApp, b: NewStockBatch & { claim: Stmt }): Promise<number | null>;
export async function createStockBatch(app: StoreApp, b: NewStockBatch): Promise<number>;
export async function createStockBatch(app: StoreApp, b: NewStockBatch): Promise<number | null> {
  const now = tehranDateTime(app.apps.now());
  const guard = b.claim ? ' WHERE changes() = 1' : '';
  const stmts = [
    ...(b.claim ? [b.claim] : []),
    app.raw.prepare(`INSERT INTO stock_batches
      (supplier_id, supplier_order_id, title, quantity, unit_price_usd, usd_toman, cost_toman, note, created_by, created_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?${guard}`).bind(
      b.supplierId, b.supplierOrderId, b.title, b.accounts.length, b.unitPriceUsd, b.usdToman, b.costToman, b.note ?? null,
      b.createdBy ?? 0, now),
    // each account is saved only while the batch statement before it changed a row
    ...b.accounts.map((a) => app.raw.prepare(
      `INSERT INTO stock_accounts (batch_id, content_json, status, updated_at)
       SELECT (SELECT MAX(id) FROM stock_batches), ?, 'available', ? WHERE changes() = 1`,
    ).bind(JSON.stringify({ accounts: [a] } satisfies DeliveryContent), now)),
    ...(b.extra ?? []),
  ];
  const skip = b.claim ? 1 : 0;
  const rs = await app.raw.batch(stmts);
  if (b.claim && rs[0].meta.changes !== 1) return null;
  const batchId = rs[skip].meta.last_row_id;
  if (b.eventKind) {
    await eventStatement(app, {
      orderId: b.orderId ?? null, supplierOrderId: b.supplierOrderId, batchId, kind: b.eventKind, detail: b.eventDetail,
    }).run();
  }
  return batchId;
}

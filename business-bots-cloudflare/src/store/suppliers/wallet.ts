import type { StoreApp } from '../../apps';
import { tehranDateTime } from '../../lib/time';

export type LedgerKind = 'topup' | 'spend' | 'refund' | 'adjust';

export interface LedgerRow { id: number; kind: LedgerKind; amount_usd: number; supplier_order_id: number | null; note: string | null; created_by: number; created_at: string }

export const BALANCE_SQL = 'SELECT COALESCE(SUM(amount_usd), 0) AS b FROM wallet_ledger WHERE supplier_id = ?';
export const HISTORY_SQL = 'SELECT id, kind, amount_usd, supplier_order_id, note, created_by, created_at FROM wallet_ledger WHERE supplier_id = ? ORDER BY id DESC LIMIT ?';

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

/** The estimated wallet balance in USD: the sum of the ledger the admin keeps (it never blocks a purchase). */
export async function walletBalance(app: StoreApp, supplierId: number): Promise<number> {
  const r = await app.raw.prepare(BALANCE_SQL).bind(supplierId).first<{ b: number }>();
  return round6(r?.b ?? 0);
}

export async function addLedger(
  app: StoreApp, e: { supplierId: number; kind: LedgerKind; amountUsd: number; actor: number; note?: string | null },
): Promise<void> {
  await app.raw.prepare(`INSERT INTO wallet_ledger (supplier_id, kind, amount_usd, supplier_order_id, note, created_by, created_at)
                         VALUES (?, ?, ?, NULL, ?, ?, ?)`)
    .bind(e.supplierId, e.kind, round6(e.amountUsd), e.note ?? null, e.actor, tehranDateTime(app.apps.now())).run();
}

export async function ledgerHistory(app: StoreApp, supplierId: number, limit = 10): Promise<LedgerRow[]> {
  return (await app.raw.prepare(HISTORY_SQL).bind(supplierId, limit).all<LedgerRow>()).results;
}

export const usd = (n: number): string => (n < 0 ? '-$' : '$') + Math.abs(n).toFixed(2);

export const KIND_FA: Record<LedgerKind, string> = { topup: '💳 شارژ', spend: '🛒 خرج', refund: '↩️ بازگشت وجه', adjust: '± اصلاح' };

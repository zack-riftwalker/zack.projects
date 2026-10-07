import type { StoreApp } from '../apps';

export interface CustomerSummary {
  purchases: number;
  spent: number;
  lastOrderAt: string | null;
  pending: number;
  preparing: number;
  active: { product: string; expiresAt: string | null }[];
}

/** What the store knows about a customer, in one 2-statement batch (used by monshi's notifications and /customer). */
export async function getCustomerSummary(app: StoreApp, telegramId: number): Promise<CustomerSummary> {
  const q = (sql: string, ...args: unknown[]) => app.raw.prepare(sql).bind(...args);
  const [totals, active] = await app.raw.batch([
    q(`SELECT COALESCE(SUM(CASE WHEN status IN ('confirmed', 'delivered') THEN 1 ELSE 0 END), 0) AS purchases,
              COALESCE(SUM(CASE WHEN status IN ('confirmed', 'delivered') THEN price ELSE 0 END), 0) AS spent,
              COALESCE(SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END), 0) AS pending,
              COALESCE(SUM(CASE WHEN status = 'confirmed' THEN 1 ELSE 0 END), 0) AS preparing,
              MAX(created_at) AS last
       FROM orders WHERE customer_telegram_id = ?`, telegramId),
    q(`SELECT product_name, expires_at FROM orders
       WHERE customer_telegram_id = ? AND status = 'delivered' AND (expires_at IS NULL OR expires_at > datetime('now', '+03:30'))
       ORDER BY delivered_at DESC LIMIT 3`, telegramId),
  ]);
  const t: any = totals.results[0] ?? {};
  return {
    purchases: t.purchases ?? 0, spent: t.spent ?? 0, lastOrderAt: t.last ?? null,
    pending: t.pending ?? 0, preparing: t.preparing ?? 0,
    active: active.results.map((r: any) => ({ product: r.product_name, expiresAt: r.expires_at })),
  };
}

import type { StoreApp } from '../../apps';
import { tehranDateTime } from '../../lib/time';
import type { Catalog, CatalogItem, SupplierRow } from './types';

export interface NewSupplier {
  kind: 'ariobox';
  name: string;
  baseUrl: string;
  apiKey: string;
  remoteUserId: number;
}

/** Stable order (product, variation), so the same catalog always gives the same hash and blob. */
export function sortItems(items: CatalogItem[]): CatalogItem[] {
  return [...items].sort((a, b) =>
    a.remoteProductId < b.remoteProductId ? -1 : a.remoteProductId > b.remoteProductId ? 1
      : a.remoteVariationId < b.remoteVariationId ? -1 : a.remoteVariationId > b.remoteVariationId ? 1 : 0);
}

/** sha-256 of the normalised items and the rate (SUPPLIER_PLAN.md §6.1). */
export async function catalogHash(items: CatalogItem[], usdToman: number): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(sortItems(items)) + '|' + usdToman);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * A short, stable reference to one catalog item for callback data (12 hex characters of the sha-256 of its remote
 * ids). A position in the catalog blob is not stable: a sync can re-sort it between a list and a tap.
 */
export async function itemRef(productId: string, variationId: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(productId + '\u0000' + variationId));
  return [...new Uint8Array(digest).slice(0, 6)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function listSuppliers(app: StoreApp): Promise<SupplierRow[]> {
  return (await app.raw.prepare('SELECT * FROM suppliers ORDER BY id').bind().all<SupplierRow>()).results;
}

export async function getSupplier(app: StoreApp, id: number): Promise<SupplierRow | undefined> {
  return (await app.raw.prepare('SELECT * FROM suppliers WHERE id = ?').bind(id).first<SupplierRow>()) ?? undefined;
}

/** Saves the supplier and, when given, its first catalog. Returns the new id. */
export async function insertSupplier(app: StoreApp, s: NewSupplier, catalog: Catalog | null): Promise<number> {
  // a saved catalog came from a successful connection just now, so the first periodic sync is not due at once
  const now = catalog ? tehranDateTime(app.apps.now()) : null;
  const r = await app.raw.prepare(
    'INSERT INTO suppliers (kind, name, base_url, api_key, remote_user_id, last_sync_at, last_sync_ok_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).bind(s.kind, s.name, s.baseUrl, s.apiKey, s.remoteUserId, now, now).run();
  const id = r.meta.last_row_id;
  if (catalog) await writeCatalog(app, id, catalog);
  return id;
}

/** One write per sync: the whole catalog is one JSON blob per supplier (never one row per item). */
export async function writeCatalog(app: StoreApp, supplierId: number, catalog: Catalog): Promise<void> {
  const items = sortItems(catalog.items);
  const hash = await catalogHash(items, catalog.usdToman);
  await app.raw.prepare(`
    INSERT INTO supplier_catalogs (supplier_id, fetched_at, usd_toman, items_json, items_hash)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(supplier_id) DO UPDATE SET
      fetched_at = excluded.fetched_at, usd_toman = excluded.usd_toman,
      items_json = excluded.items_json, items_hash = excluded.items_hash
  `).bind(supplierId, tehranDateTime(app.apps.now()), catalog.usdToman, JSON.stringify(items), hash).run();
}

/** The cached catalog, or null when none was ever fetched (or the blob is corrupt). */
export async function readCatalog(app: StoreApp, supplierId: number): Promise<{ catalog: Catalog; fetchedAt: string } | null> {
  const row = await app.raw.prepare('SELECT fetched_at, usd_toman, items_json FROM supplier_catalogs WHERE supplier_id = ?')
    .bind(supplierId).first<{ fetched_at: string; usd_toman: number; items_json: string }>();
  if (!row) return null;
  try {
    return { catalog: { usdToman: row.usd_toman, items: JSON.parse(row.items_json), updatedAt: row.fetched_at }, fetchedAt: row.fetched_at };
  } catch (err: any) {
    console.error('❌ [Supplier] Corrupt catalog JSON for supplier ' + supplierId + ':', err.message);
    return null;
  }
}

export async function setSupplierKey(app: StoreApp, id: number, apiKey: string): Promise<void> {
  await app.raw.prepare('UPDATE suppliers SET api_key = ? WHERE id = ?').bind(apiKey, id).run();
}

export async function setSupplierUserId(app: StoreApp, id: number, userId: number): Promise<void> {
  await app.raw.prepare('UPDATE suppliers SET remote_user_id = ? WHERE id = ?').bind(userId, id).run();
}

/** The minute cron picks a supplier whose last_sync_at is NULL up at once (SUPPLIER_PLAN.md §6.1). */
export async function markSyncDue(app: StoreApp, id: number): Promise<void> {
  await app.raw.prepare('UPDATE suppliers SET last_sync_at = NULL WHERE id = ?').bind(id).run();
}

export async function toggleSupplier(app: StoreApp, id: number): Promise<void> {
  await app.raw.prepare('UPDATE suppliers SET is_enabled = 1 - is_enabled WHERE id = ?').bind(id).run();
}

/** Options that have at least one source from this supplier (0 until the import of S4 exists). */
export async function countLinkedOptions(app: StoreApp, id: number): Promise<number> {
  return (await app.raw.prepare('SELECT COUNT(DISTINCT customer_product_id) AS n FROM product_sources WHERE supplier_id = ?')
    .bind(id).first<{ n: number }>())?.n ?? 0;
}

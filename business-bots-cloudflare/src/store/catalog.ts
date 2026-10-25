import type { StoreApp } from '../apps';
import type { CustomerProduct, ProductGroup } from './db';
import { catalogLabel, escapeMarkdown, formatPrice } from './utils';

export interface CatalogEntry {
  /** group entries first show the group name; standalone products keep their own label */
  label: string;
  callback: string;
  sortOrder: number;
  /** smallest product id in the entry (tie-breaker) */
  minId: number;
}

/**
 * The storefront list (SUPPLIER_PLAN.md §3.1): one entry per group with ≥ 1 active option, one per standalone
 * product. Sorted by sort_order, then the smallest member id.
 */
export function buildCatalogEntries(products: CustomerProduct[], groups: ProductGroup[]): CatalogEntry[] {
  const entries: CatalogEntry[] = [];
  for (const p of products) {
    if (p.group_id == null) {
      entries.push({ label: catalogLabel(p), callback: 'cust_prod_' + p.id, sortOrder: p.sort_order ?? 0, minId: p.id });
    }
  }
  for (const g of groups) {
    const options = products.filter((p) => p.group_id === g.id);
    if (options.length === 0) continue;
    const available = options.filter((p) => p.is_available !== 0);
    const label = available.length === 0
      ? '⛔️ ' + g.name + ' (ناموجود)'
      : g.name + '  |  از ' + formatPrice(Math.min(...available.map((p) => p.price))) + ' ت';
    entries.push({
      label, callback: 'cust_grp_' + g.id, sortOrder: g.sort_order,
      minId: Math.min(...options.map((p) => p.id)),
    });
  }
  return entries.sort((a, b) => a.sortOrder - b.sortOrder || a.minId - b.minId);
}

export async function loadCatalogEntries(app: StoreApp): Promise<CatalogEntry[]> {
  const { products, groups } = await app.db.getCatalogData();
  return buildCatalogEntries(products, groups);
}

/** Options of a group in the order the customer chooses them: sort_order, duration, id. */
export function sortOptions(options: CustomerProduct[]): CustomerProduct[] {
  return [...options].sort((a, b) =>
    (a.sort_order ?? 0) - (b.sort_order ?? 0) || (a.duration_days ?? 0) - (b.duration_days ?? 0) || a.id - b.id);
}

export function optionButtonLabel(p: CustomerProduct): string {
  const label = p.option_label ?? p.name;
  return p.is_available === 0 ? '⛔️ ' + label + ' (ناموجود)' : label + '  |  ' + formatPrice(p.price) + ' ت';
}

export const groupHeaderText = (name: string): string =>
  '📦 *' + escapeMarkdown(name) + '*\n\nلطفاً مدت/نوع را انتخاب کنید:';

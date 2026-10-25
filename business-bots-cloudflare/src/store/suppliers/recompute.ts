import type { StoreApp } from '../../apps';
import { tehranDateTime } from '../../lib/time';
import { getSupplierDefaults } from '../supplierDefaults';
import { costToman, finalPrice, markupFor } from './pricing';

export interface OptionRow {
  id: number; name: string; price: number; is_available: number; pricing_mode: string; stock_mode: string;
  markup_percent: number | null; markup_fixed: number | null; cost_toman: number | null;
}

export interface SourceRow {
  id: number; supplier_id: number; priority: number; is_enabled: number; listed: number; price_usd: number | null;
  oos_until: string | null; sup_enabled: number;
}

/** What changed on one option, for the sync report (SUPPLIER_PLAN.md §6.2). */
export interface OptionChange {
  productId: number; name: string;
  oldPrice: number; newPrice: number; priceChanged: boolean;
  oldAvail: number; newAvail: number; availChanged: boolean;
  cost: number | null; pricingMode: string;
  /** auto pricing, a cost is known, but there is no markup at all */
  noMarkup: boolean;
}

/**
 * The first source by priority that is enabled, listed, priced, from an enabled supplier, and not out of stock
 * until `now` (SUPPLIER_PLAN.md §6.3 step 1). Pure.
 */
export function pickActiveSource(sources: SourceRow[], now: string): SourceRow | null {
  return sources.find((s) => s.is_enabled === 1 && s.listed === 1 && s.price_usd !== null && s.sup_enabled === 1
    && (s.oos_until === null || s.oos_until <= now)) ?? null;
}

/**
 * Recomputes an option's cost, price and availability from its sources (SUPPLIER_PLAN.md §6.3). Writes only when
 * something changed. Manual pricing keeps the price; manual stock keeps the availability.
 */
export async function recomputeOption(app: StoreApp, productId: number): Promise<OptionChange | null> {
  const now = tehranDateTime(app.apps.now());
  const row = await app.raw.prepare(
    'SELECT id, name, price, is_available, pricing_mode, stock_mode, markup_percent, markup_fixed, cost_toman FROM customer_products WHERE id = ?',
  ).bind(productId).first<OptionRow>();
  if (!row) return null;

  const sources = (await app.raw.prepare(`
    SELECT s.id, s.supplier_id, s.priority, s.is_enabled, s.listed, s.price_usd, s.oos_until, sup.is_enabled AS sup_enabled
    FROM product_sources s JOIN suppliers sup ON sup.id = s.supplier_id
    WHERE s.customer_product_id = ? ORDER BY s.priority, s.id`).bind(productId).all<SourceRow>()).results;
  const active = pickActiveSource(sources, now);

  let cost: number | null = null;
  if (active) {
    const rate = await app.raw.prepare('SELECT usd_toman FROM supplier_catalogs WHERE supplier_id = ?')
      .bind(active.supplier_id).first<{ usd_toman: number }>();
    if (rate) cost = costToman(active.price_usd!, rate.usd_toman);
  }

  const markup = markupFor(row, await getSupplierDefaults(app));
  const newPrice = row.pricing_mode === 'auto' && cost !== null && markup ? finalPrice(cost, markup) : row.price;
  const newAvail = row.stock_mode === 'auto' ? (active ? 1 : 0) : row.is_available;
  const change: OptionChange = {
    productId, name: row.name,
    oldPrice: row.price, newPrice, priceChanged: newPrice !== row.price,
    oldAvail: row.is_available, newAvail, availChanged: newAvail !== row.is_available,
    cost, pricingMode: row.pricing_mode,
    noMarkup: row.pricing_mode === 'auto' && cost !== null && markup === null,
  };

  if (change.priceChanged || change.availChanged || cost !== row.cost_toman) {
    await app.raw.prepare(
      'UPDATE customer_products SET price = ?, is_available = ?, cost_toman = ?, price_updated_at = CASE WHEN ? = 1 THEN ? ELSE price_updated_at END WHERE id = ?',
    ).bind(newPrice, newAvail, cost, change.priceChanged ? 1 : 0, now, productId).run();
  }
  return change;
}

import type { SupplierDefaults } from '../supplierDefaults';

/** Cost in Toman of one unit: the USD price times the supplier's rate (SUPPLIER_PLAN.md §5.2). */
export const costToman = (priceUsd: number, usdToman: number): number => Math.round(priceUsd * usdToman);

/** Rounds up to the next 10,000 Toman. */
export const roundUp10k = (amount: number): number => Math.ceil(amount / 10_000) * 10_000;

/**
 * ceil((cost × (1 + percent/100) + fixed) / 10000) × 10000, in integer arithmetic: the percent is taken in
 * hundredths, so 100000 × 1.10 can't become 110000.00000000001 and round up to 120000.
 */
export function finalPrice(cost: number, markup: { percent: number; fixed: number }): number {
  const unit = 10_000;
  const scale = 10_000; // (1 + percent/100) = (10000 + hundredths) / 10000
  const hundredths = Math.round(markup.percent * 100);
  const total = Math.round(cost) * (scale + hundredths) + Math.round(markup.fixed) * scale; // Toman × 10⁻⁴
  const step = unit * scale;
  const units = total % step === 0 ? total / step : Math.floor(total / step) + 1;
  return units * unit;
}

/**
 * The markup that applies to an option: its own override when either half is set (a missing half counts as 0),
 * else the defaults. null = neither is set, so the option keeps its current price.
 */
export function markupFor(
  option: { markup_percent?: number | null; markup_fixed?: number | null },
  defaults: SupplierDefaults,
): { percent: number; fixed: number } | null {
  if (option.markup_percent != null || option.markup_fixed != null) {
    return { percent: option.markup_percent ?? 0, fixed: option.markup_fixed ?? 0 };
  }
  if (defaults.markupPercent != null || defaults.markupFixed != null) {
    return { percent: defaults.markupPercent ?? 0, fixed: defaults.markupFixed ?? 0 };
  }
  return null;
}

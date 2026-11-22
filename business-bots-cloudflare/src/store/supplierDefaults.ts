import type { StoreApp } from '../apps';

/** Default markup for supplier-priced options; null = not set (SUPPLIER_PLAN.md §2.7). */
export interface SupplierDefaults {
  markupPercent: number | null;
  markupFixed: number | null;
}

export const EMPTY_SUPPLIER_DEFAULTS: SupplierDefaults = { markupPercent: null, markupFixed: null };
const KEY = 'supplier_defaults';

const validPercent = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 500 ? v : null);
const validFixed = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 100_000_000 ? v : null);

/** Each field is kept only if it passes its range check; anything else reads as «not set». */
export function parseSupplierDefaults(raw: string | null): SupplierDefaults {
  if (!raw) return { ...EMPTY_SUPPLIER_DEFAULTS };
  let obj: any;
  try {
    obj = JSON.parse(raw);
  } catch (err: any) {
    console.error('❌ [Supplier] Corrupt supplier_defaults JSON:', err.message);
    return { ...EMPTY_SUPPLIER_DEFAULTS };
  }
  return { markupPercent: validPercent(obj?.markupPercent), markupFixed: validFixed(obj?.markupFixed) };
}

export async function getSupplierDefaults(app: StoreApp): Promise<SupplierDefaults> {
  return parseSupplierDefaults(await app.kv.get(KEY));
}

/** Throws on an out-of-range value so a bad admin input can't be stored. */
export async function setSupplierDefaults(app: StoreApp, d: SupplierDefaults): Promise<void> {
  if (validPercent(d.markupPercent) === null && d.markupPercent !== null) throw new Error('markupPercent out of range');
  if (validFixed(d.markupFixed) === null && d.markupFixed !== null) throw new Error('markupFixed out of range');
  await app.kv.set(KEY, JSON.stringify(d));
}

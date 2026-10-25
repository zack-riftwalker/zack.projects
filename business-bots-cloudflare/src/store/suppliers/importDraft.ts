import type { CatalogItem } from './types';

/** Attribute keys we read on purpose; every other key is listed as «ویژگی‌های ناشناخته» (SUPPLIER_PLAN.md §5.1). */
export const DURATION_KEYS = ['subscription-duration', 'duration'] as const;
export const WARRANTY_KEY = 'warranty';
const NO_VALUE = new Set(['none', 'no', '0', 'no-warranty']);
const DURATION_RE = /^(\d+)[- ]?(day|days|month|months|year|years)$/i;

export interface ImportOption {
  remoteVariationId: string;
  label: string;
  durationDays: number | null;
  warrantyDays: number | null;
  priceUsd: number | null;
  attributes: Record<string, string>;
  selected: boolean;
  /** the product this variation already feeds (set when the item was imported before) */
  existingName: string | null;
}

/** The import draft kept in the admin's session (SUPPLIER_PLAN.md §9.2). */
export interface ImportDraft {
  supplierId: number;
  supplierName: string;
  remoteProductId: string;
  /** the supplier's product name (kept for the source row) */
  remoteName: string;
  groupName: string;
  usdToman: number;
  markupPercent: number | null;
  markupFixed: number | null;
  terms: { text: string; entities: any[] | null } | null;
  options: ImportOption[];
  /** the option being edited with «🏷 گزینه» (index into options) */
  editing: number | null;
}

/** Days for «3-month» style values; «none» and friends are null with no unknown part. */
export function parseDuration(value: string | undefined): { days: number | null; known: boolean } {
  if (value === undefined) return { days: null, known: true };
  const v = value.trim().toLowerCase();
  if (NO_VALUE.has(v)) return { days: null, known: true };
  const m = v.match(DURATION_RE);
  if (!m) return { days: null, known: false };
  const n = Number(m[1]);
  const unit = m[2].toLowerCase();
  const days = unit.startsWith('y') ? n * 365 : unit.startsWith('m') ? n * 30 : n;
  return { days, known: true };
}

const fa = (n: number) => String(n).replace(/\d/g, (d) => String.fromCharCode(d.charCodeAt(0) + 0x06f0 - 0x30));

/** «۱ ماهه» for whole months, «۴۵ روزه» otherwise; without a duration, the attribute values or «گزینه K». */
export function optionLabel(durationDays: number | null, index: number, attributes: Record<string, string>): string {
  if (durationDays !== null) {
    return durationDays % 30 === 0 ? fa(durationDays / 30) + ' ماهه' : fa(durationDays) + ' روزه';
  }
  const values = Object.entries(attributes)
    .filter(([k]) => ![...DURATION_KEYS, WARRANTY_KEY].includes(k as never))
    .map(([, v]) => v);
  return values.length ? values.join(' | ') : 'گزینه ' + fa(index + 1);
}

/** Attribute values we could not read, as «key=value». */
export function unknownAttributes(attributes: Record<string, string>): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(attributes)) {
    if (k === WARRANTY_KEY || (DURATION_KEYS as readonly string[]).includes(k)) {
      if (!parseDuration(v).known) out.push(k + '=' + v);
    } else {
      out.push(k + '=' + v);
    }
  }
  return out;
}

/** Builds the draft's options from one remote product's variations (catalog order). */
export function optionsFromItems(items: CatalogItem[], existing: Map<string, string>): ImportOption[] {
  return items.map((it, index) => {
    const durationRaw = it.attributes['subscription-duration'] ?? it.attributes['duration'];
    const durationDays = parseDuration(durationRaw).days;
    const warrantyDays = parseDuration(it.attributes[WARRANTY_KEY]).days;
    const existingName = existing.get(it.remoteVariationId) ?? null;
    return {
      remoteVariationId: it.remoteVariationId,
      label: optionLabel(durationDays, index, it.attributes),
      durationDays,
      warrantyDays,
      priceUsd: it.priceUsd,
      attributes: it.attributes,
      selected: existingName === null,
      existingName,
    };
  });
}

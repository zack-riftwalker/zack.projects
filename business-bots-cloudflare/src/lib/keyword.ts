import { normalizeText } from '../monshi/normalize';

/** Words that always mean something to the Eitaa auto-reply (EITAA_MENU_PLAN.md §1) — never a product keyword. */
export const RESERVED_KEYWORDS = ['منو', 'قیمت', 'قیمتها', 'خرید', 'شرایط'];
/** Whole-message price-list requests (matchMessage answers them with the price list) — never a product keyword. */
export const PRICE_WORDS = new Set(['قیمت', 'قیمتها', 'قیمت ها', 'لیست قیمت', 'لیست قیمتها', 'لیست قیمت ها']);
export const RESERVED_PREFIXES = ['خرید ', 'شرایط ', 'قیمت '];

const QUOTE_OPEN = /^[«"“”']+/;
const TRAIL = /[؟?!.،,»"“”']+$/;

/** Comparison form of a keyword / customer message: digits and letters unified, no half-spaces, no trailing punctuation or quotes. */
export function normalizeKeyword(s: string): string {
  let t = normalizeText((s ?? '').replace(/[‌​]/g, ' ').replace(/[‎‏]/g, '')).toLowerCase();
  for (;;) {
    const next = t.replace(TRAIL, '').replace(QUOTE_OPEN, '').trim();
    if (next === t) break;
    t = next;
  }
  return t.split(/\s+/).filter(Boolean).join(' ');
}

export const keywordWordCount = (normalized: string): number => (normalized ? normalized.split(' ').length : 0);

/** null = acceptable shape; otherwise the admin-facing message (EITAA_MENU_PLAN.md §1 table, first two rows). */
export function keywordShapeError(normalized: string): string | null {
  if (normalized.length < 2 || normalized.length > 20 || keywordWordCount(normalized) > 2) return '⚠️ کلمه باید ۱ یا ۲ کلمه و حداکثر ۲۰ حرف باشد.';
  if (RESERVED_KEYWORDS.includes(normalized) || PRICE_WORDS.has(normalized) || RESERVED_PREFIXES.some((p) => normalized.startsWith(p))) return '⚠️ این کلمه رزرو شده است؛ کلمه‌ی دیگری انتخاب کنید.';
  return null;
}

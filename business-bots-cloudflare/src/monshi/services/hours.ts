import { formatTehran, tehranParts, type WeekdayKey } from '../../lib/time';
import { normalizeDigits } from '../normalize';

// Same order as Python's datetime.weekday() (Monday = 0)
export const WEEKDAY_KEYS: WeekdayKey[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

export const PERSIAN_DAY_NAMES: Record<string, string> = {
  sat: 'شنبه', sun: 'یکشنبه', mon: 'دوشنبه', tue: 'سه‌شنبه', wed: 'چهارشنبه', thu: 'پنجشنبه', fri: 'جمعه',
};
// Iranian week display order
export const IRAN_WEEK_ORDER: WeekdayKey[] = ['sat', 'sun', 'mon', 'tue', 'wed', 'thu', 'fri'];

export type HoursMap = Record<string, string | null | undefined>;

/** Parses the stored HH:MM-HH:MM format into [startMinutes, endMinutes]. */
function parseRange(value: string): [number, number] {
  const [startS, endS] = normalizeDigits(value).split('-');
  const [h1, m1] = startS.trim().split(':').map(Number);
  const [h2, m2] = endS.trim().split(':').map(Number);
  return [h1 * 60 + m1, h2 * 60 + m2];
}

const FLEXIBLE_RANGE_RE = /(\d{1,2})(?::(\d{2}))?\s*(?:-|تا|الی|to|~|إلى)\s*(\d{1,2})(?::(\d{2}))?/;

/** Flexible user input (Persian digits, 'تا', no minutes…) → standard HH:MM-HH:MM or null. */
export function parseFlexibleRange(text: string): string | null {
  const m = normalizeDigits(text).match(FLEXIBLE_RANGE_RE);
  if (!m) return null;
  let h1 = parseInt(m[1], 10);
  let h2 = parseInt(m[3], 10);
  const m1 = m[2] ? parseInt(m[2], 10) : 0;
  let m2 = m[4] ? parseInt(m[4], 10) : 0;
  // "24" at the start means midnight (00:00)
  if (h1 === 24 && m1 === 0) h1 = 0;
  // "24" at the end means end of the same day (23:59), not a wrap to the day start
  if (h2 === 24 && m2 === 0) {
    h2 = 23;
    m2 = 59;
  }
  if (!(h1 >= 0 && h1 <= 23 && h2 >= 0 && h2 <= 23 && m1 >= 0 && m1 <= 59 && m2 >= 0 && m2 <= 59)) return null;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(h1)}:${p(m1)}-${p(h2)}:${p(m2)}`;
}

/** Does this range cross midnight? (end earlier than start) */
export function isOvernight(value: string): boolean {
  const [start, end] = parseRange(value);
  return start > end;
}

export function isBusinessHours(hoursMap: HoursMap, now: Date = new Date()): boolean {
  const t = tehranParts(now);
  const current = t.hour * 60 + t.minute;
  const idx = WEEKDAY_KEYS.indexOf(t.weekdayKey);

  const today = hoursMap[WEEKDAY_KEYS[idx]];
  if (today) {
    const [start, end] = parseRange(today);
    if (start <= end) {
      if (start <= current && current < end) return true;
    } else if (current >= start) {
      // tonight's overnight window that hasn't reached midnight yet
      return true;
    }
  }

  // yesterday's overnight window may still run into this morning
  const yesterday = hoursMap[WEEKDAY_KEYS[(idx + 6) % 7]];
  if (yesterday) {
    const [start, end] = parseRange(yesterday);
    if (start > end && current < end) return true;
  }
  return false;
}

export function formatHours(hoursMap: HoursMap): string {
  return IRAN_WEEK_ORDER.map((key) => `${PERSIAN_DAY_NAMES[key]}: ${hoursMap[key] ? hoursMap[key] : 'تعطیل ❌'}`).join('\n');
}

export { formatTehran };

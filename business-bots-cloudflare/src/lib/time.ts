import { isValidJalaaliDate, toGregorian, toJalaali } from 'jalaali-js';

/** Iran has no DST — same fixed '+03:30' as the legacy SQLite queries. */
export const TEHRAN_OFFSET_MS = 3.5 * 60 * 60 * 1000;

const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
export type WeekdayKey = (typeof WEEKDAYS)[number];

export interface TehranParts {
  y: number; m: number; d: number; hour: number; minute: number;
  weekdayKey: WeekdayKey;
  /** 'YYYY-MM-DD' Tehran date */
  day: string;
}

export function tehranParts(date: Date = new Date()): TehranParts {
  const t = new Date(date.getTime() + TEHRAN_OFFSET_MS);
  const y = t.getUTCFullYear();
  const m = t.getUTCMonth() + 1;
  const d = t.getUTCDate();
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    y, m, d,
    hour: t.getUTCHours(),
    minute: t.getUTCMinutes(),
    weekdayKey: WEEKDAYS[t.getUTCDay()],
    day: `${y}-${pad(m)}-${pad(d)}`,
  };
}

/** Python-compatible `datetime.now(timezone.utc).isoformat()` (monshi storage format). */
export function utcIsoNow(date: Date = new Date()): string {
  return date.toISOString().replace('Z', '000+00:00');
}

const pad2 = (n: number) => String(n).padStart(2, '0');
const persianToAscii = (s: string) =>
  s.replace(/[۰-۹]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0x06f0 + 0x30));

/** 'YYYY-MM-DD HH:MM:SS' Tehran wall clock (SQLite datetime('now','+03:30') format). */
export function tehranDateTimeString(date: Date = new Date()): string {
  const p = tehranParts(date);
  const t = new Date(date.getTime() + TEHRAN_OFFSET_MS);
  return `${p.day} ${pad2(p.hour)}:${pad2(p.minute)}:${pad2(t.getUTCSeconds())}`;
}

export function parseJalaliDateTime(text: string): string | null {
  const normalised = persianToAscii(String(text)).trim();
  const match = normalised.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})\s+(\d{1,2}):(\d{1,2})$/);
  if (!match) return null;
  const [, jy, jm, jd, hh, mm] = match.map(Number);
  if (!isValidJalaaliDate(jy, jm, jd)) return null;
  if (hh > 23 || mm > 59) return null;
  const { gy, gm, gd } = toGregorian(jy, jm, jd);
  return `${gy}-${pad2(gm)}-${pad2(gd)} ${pad2(hh)}:${pad2(mm)}:00`;
}

export function formatJalaliDateTime(isoLike: string): string {
  const match = String(isoLike).match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (!match) return isoLike;
  const [, gy, gm, gd, hh, mm] = match.map(Number);
  const { jy, jm, jd } = toJalaali(gy, gm, gd);
  return `${jy}/${pad2(jm)}/${pad2(jd)} ${pad2(hh)}:${pad2(mm)}`;
}

export function formatJalaliDate(isoLike: string): string {
  const match = String(isoLike).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return isoLike;
  const [, gy, gm, gd] = match.map(Number);
  const { jy, jm, jd } = toJalaali(gy, gm, gd);
  return `${jy}/${pad2(jm)}/${pad2(jd)}`;
}

/** Parses a Tehran wall-clock 'YYYY-MM-DD HH:MM[:SS]' string to epoch ms (null if malformed). */
export function parseLocalDateTime(isoLike: string): number | null {
  const match = String(isoLike).match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return null;
  const [, y, m, d, hh, mm, ss] = match.map(Number);
  return Date.UTC(y, m - 1, d, hh, mm, ss || 0) - TEHRAN_OFFSET_MS;
}

/** Monshi `format_tehran`: UTC ISO timestamp → "jy/jm/jd HH:MM" in Tehran. */
export function formatTehran(isoUtc: string, withTime = true): string {
  let s = isoUtc;
  if (!/[zZ]|[+-]\d{2}:\d{2}$/.test(s)) s += 'Z';
  const ms = Date.parse(s.replace(/(\.\d{3})\d+/, '$1'));
  const t = new Date(ms + TEHRAN_OFFSET_MS);
  const { jy, jm, jd } = toJalaali(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
  const date = `${jy}/${pad2(jm)}/${pad2(jd)}`;
  return withTime ? `${date} ${pad2(t.getUTCHours())}:${pad2(t.getUTCMinutes())}` : date;
}

export function formatPrice(amount: number): string {
  return amount.toLocaleString('fa-IR');
}

export type ReportPeriod = 'today' | '7d' | '30d' | 'month' | 'all';

/** Tehran wall-clock 'YYYY-MM-DD 00:00:00' of the day `addDays` after the Tehran date of `date`. */
export function tehranMidnightString(date: Date, addDays = 0): string {
  const p = tehranParts(date);
  const t = new Date(Date.UTC(p.y, p.m - 1, p.d + addDays));
  return `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())} 00:00:00`;
}

/**
 * Half-open range [from, to) of Tehran wall-clock strings (same format as the orders/customers columns).
 * `to` is always tomorrow's midnight, so the whole of today is included; `fromDay` is null for «all».
 */
export function reportRange(period: ReportPeriod, now: Date): { from: string; to: string; fromDay: string | null; toDay: string } {
  const to = tehranMidnightString(now, 1);
  const toDay = tehranParts(now).day;
  if (period === 'all') return { from: '0000-01-01 00:00:00', to, fromDay: null, toDay };
  let from: string;
  if (period === 'today') {
    from = tehranMidnightString(now, 0);
  } else if (period === 'month') {
    const p = tehranParts(now);
    const j = toJalaali(p.y, p.m, p.d);
    const g = toGregorian(j.jy, j.jm, 1);
    from = `${g.gy}-${pad2(g.gm)}-${pad2(g.gd)} 00:00:00`;
  } else {
    from = tehranDateTimeString(new Date(now.getTime() - (period === '7d' ? 7 : 30) * 86400000));
  }
  return { from, to, fromDay: from.slice(0, 10), toDay };
}

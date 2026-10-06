import type { Context } from 'grammy';
import { Markup, type InlineButton } from '../lib/markup';
import { formatPrice } from '../lib/time';

export { formatPrice };
export {
  parseJalaliDateTime, formatJalaliDateTime, formatJalaliDate, parseLocalDateTime,
} from '../lib/time';

export const MAX_NAME_LENGTH = 100;
export const PAGE_SIZE = 8;

export function escapeMarkdown(text: unknown): string {
  return String(text).replace(/([_*`\[])/g, '\\$1');
}

export function parsePrice(text: string): number {
  const normalised = text
    .replace(/[۰-۹]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0x06f0 + 0x30))
    .replace(/[\s,،]/g, '');
  const val = parseFloat(normalised);
  return isNaN(val) || val <= 0 ? NaN : val;
}

export function buildPagedKeyboard<T>(
  items: T[], page: number, toButton: (item: T) => InlineButton, navPrefix: string, cancelBtn: InlineButton,
) {
  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const p = Math.min(Math.max(0, page), totalPages - 1);
  const rows: InlineButton[][] = items.slice(p * PAGE_SIZE, (p + 1) * PAGE_SIZE).map((item) => [toButton(item)]);
  if (totalPages > 1) {
    const nav: InlineButton[] = [];
    if (p > 0) nav.push(Markup.button.callback('⬅️ قبلی', navPrefix + (p - 1)));
    nav.push(Markup.button.callback('📄 ' + (p + 1) + '/' + totalPages, navPrefix + p));
    if (p < totalPages - 1) nav.push(Markup.button.callback('بعدی ➡️', navPrefix + (p + 1)));
    rows.push(nav);
  }
  rows.push([cancelBtn]);
  return Markup.inlineKeyboard(rows);
}

export function productButton(p: { id: number; name: string; price: number }, callbackPrefix: string): InlineButton {
  return Markup.button.callback(p.name + '  |  ' + formatPrice(p.price) + ' ت', callbackPrefix + p.id);
}

export function productPickerKeyboard(
  products: { id: number; name: string; price: number }[], page: number,
  callbackPrefix: string, navPrefix: string, cancelBtn: InlineButton,
) {
  return buildPagedKeyboard(products, page, (p) => productButton(p, callbackPrefix), navPrefix, cancelBtn);
}

export async function ackStrayCallback(ctx: Context): Promise<void> {
  if (ctx.callbackQuery) {
    await ctx.answerCallbackQuery().catch(() => {});
  }
}

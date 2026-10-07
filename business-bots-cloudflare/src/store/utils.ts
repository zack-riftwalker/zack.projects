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

type PickerProduct = { id: number; name: string; price: number; is_available?: number };

export function productButton(p: PickerProduct, callbackPrefix: string, label?: (p: PickerProduct) => string): InlineButton {
  return Markup.button.callback(label ? label(p) : p.name + '  |  ' + formatPrice(p.price) + ' ت', callbackPrefix + p.id);
}

/** `label` overrides the button text (e.g. to mark out-of-stock products). */
export function productPickerKeyboard(
  products: PickerProduct[], page: number,
  callbackPrefix: string, navPrefix: string, cancelBtn: InlineButton, label?: (p: PickerProduct) => string,
) {
  return buildPagedKeyboard(products, page, (p) => productButton(p, callbackPrefix, label), navPrefix, cancelBtn);
}

/** Catalog label: out-of-stock products stay visible but show no price. */
export function catalogLabel(p: PickerProduct): string {
  return p.is_available === 0 ? '⛔️ ' + p.name + ' (ناموجود)' : p.name + '  |  ' + formatPrice(p.price) + ' ت';
}

/** Admin label: the normal text, prefixed when the product is out of stock. */
export function adminProductLabel(p: PickerProduct): string {
  return (p.is_available === 0 ? '⛔️ ' : '') + p.name + '  |  ' + formatPrice(p.price) + ' ت';
}

export async function ackStrayCallback(ctx: Context): Promise<void> {
  if (ctx.callbackQuery) {
    await ctx.answerCallbackQuery().catch(() => {});
  }
}

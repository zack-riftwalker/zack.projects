/**
 * Eitaa auto-reply content (EITAA_MENU_PLAN.md §2.2): the keyword matcher and the pure builders of the menu, the price
 * list and a product reply. Texts are plain text + Telegram-style entities (UTF-16 offsets); toEitaaEntities converts
 * them for messages.sendMessage. Reads the store only — never writes to it.
 */
import type { MessageEntity } from 'grammy/types';
import type { MonshiApp } from '../../apps';
import type { CustomerProduct } from '../../store/db';
import { buildCatalogEntries, hasCompareAt, priceLines, priceStrikeEntity, sortOptions } from '../../store/catalog';
import { RichText, withHeader } from '../../store/ui';
import { formatPrice } from '../../lib/time';
import { normalizeKeyword, PRICE_WORDS } from '../../lib/keyword';

export { normalizeKeyword };

export type EitaaProduct = CustomerProduct;
export interface Built { text: string; entities: MessageEntity[] }
export type Match =
  | { kind: 'menu' } | { kind: 'prices' }
  | { kind: 'product'; product: EitaaProduct } | { kind: 'buy'; product: EitaaProduct }
  | null;

export const DEFAULT_GREETING = 'سلام 👋 خوش اومدید';
export const MAX_REPLY_UNITS = 4000;

/** Active products in the order of the store catalog; null = the store isn't configured (the feature is off). One D1 statement. */
export async function loadEitaaProducts(app: MonshiApp): Promise<EitaaProduct[] | null> {
  const store = app.apps.store;
  if (!store) return null;
  const rows = await store.db.getEitaaProducts();
  const groups = [...new Set(rows.filter((p) => p.group_id != null).map((p) => p.group_id!))]
    .map((id) => ({ id, name: '', sort_order: rows.find((p) => p.group_id === id)!.group_sort ?? 0 }));
  const ordered: EitaaProduct[] = [];
  for (const e of buildCatalogEntries(rows, groups)) {
    const id = Number(e.callback.replace(/^cust_(prod|grp)_/, ''));
    if (e.callback.startsWith('cust_prod_')) ordered.push(rows.find((p) => p.id === id)!);
    else ordered.push(...sortOptions(rows.filter((p) => p.group_id === id)));
  }
  return ordered;
}

// ─── matching ────────────────────────────────────────────────────────────────

export function matchMessage(text: string | null | undefined, products: EitaaProduct[]): Match {
  const t = normalizeKeyword(text ?? '');
  if (!t || t.split(' ').length > 3) return null;
  if (t === 'منو') return { kind: 'menu' };
  if (PRICE_WORDS.has(t)) return { kind: 'prices' };
  const find = (k: string) => (k ? products.find((p) => p.eitaa_keyword && normalizeKeyword(p.eitaa_keyword) === k) : undefined);
  if (t.startsWith('خرید ')) {
    const p = find(t.slice(5));
    return p ? { kind: 'buy', product: p } : null;
  }
  for (const prefix of ['شرایط ', 'قیمت ']) {
    if (t.startsWith(prefix)) {
      const p = find(t.slice(prefix.length));
      return p ? { kind: 'product', product: p } : null;
    }
  }
  const p = find(t);
  return p ? { kind: 'product', product: p } : null;
}

// ─── builders ────────────────────────────────────────────────────────────────

/** product names in the store start with U+200F */
const cleanName = (name: string): string => name.replace(/^[‏‎]+/, '');
const isAvailable = (p: EitaaProduct): boolean => p.is_available !== 0;

class Out {
  text = '';
  entities: MessageEntity[] = [];
  add(s: string): this { this.text += s; return this; }
  code(s: string): this {
    this.entities.push({ type: 'code', offset: this.text.length, length: s.length });
    this.text += s;
    return this;
  }
  done(): Built { return { text: this.text, entities: this.entities }; }
}

/** the stock list stops (with a «…» line) before the whole text passes this many UTF-16 units */
const STOCK_TEXT_LIMIT = 3500;

/** `tail` = units the rest of the message needs after the stock list, so the quick-reply section always fits */
function addStock(o: Out, products: EitaaProduct[], tail: number): void {
  const avail = products.filter(isAvailable);
  if (!avail.length) { o.add('📦 فعلاً محصولی موجود نیست.'); return; }
  o.add('📦 موجودی امروز:');
  const limit = STOCK_TEXT_LIMIT - tail - 2;
  for (const p of avail) {
    const line = '\n• ' + cleanName(p.name) + ' — ' + formatPrice(p.price) + ' ت' + (hasCompareAt(p) ? ' 🔥' : '');
    if (o.text.length + line.length > limit) { o.add('\n…'); break; }
    o.add(line);
  }
}

export function buildMenu(greeting: string, products: EitaaProduct[]): Built {
  const o = new Out();
  o.add(greeting + '\n\n');
  const keywords = products.filter((p) => isAvailable(p) && p.eitaa_keyword?.trim()).map((p) => p.eitaa_keyword!.trim());
  addStock(o, products, 120 + keywords.reduce((n, k) => n + k.length + 5, 0));
  o.add('\n\n⚡️ جواب سریع (کپی کنید و بفرستید):\n');
  if (keywords.length) {
    keywords.forEach((k, i) => { if (i) o.add('  ·  '); o.code(k); });
    o.add('\n');
  }
  o.code('قیمت').add(' ← لیست قیمت‌ها\n');
  o.code('منو').add(' ← همین پیام\n\nیا سؤالتون رو بنویسید 🙂');
  return o.done();
}

export function buildPrices(products: EitaaProduct[]): Built {
  const o = new Out();
  addStock(o, products, 30);
  o.add('\n\n').code('منو').add(' ← منوی کامل');
  return o.done();
}

/** cuts `text` to `max` units at a line break (when there is one) and clips the entities to what is kept */
function cutAtLine(text: string, entities: MessageEntity[], max: number): { text: string; entities: MessageEntity[] } {
  if (text.length <= max) return { text, entities };
  let cut = text.slice(0, Math.max(0, max));
  const nl = cut.lastIndexOf('\n');
  if (nl > 0) cut = cut.slice(0, nl);
  else if (/[\uD800-\uDBFF]/.test(cut.slice(-1))) cut = cut.slice(0, -1); // never split a surrogate pair
  const kept = entities
    .filter((e) => e.offset < cut.length)
    .map((e) => ({ ...e, length: Math.min(e.length, cut.length - e.offset) }));
  return { text: cut, entities: kept };
}

export function buildProductReply(product: EitaaProduct): Built {
  const head = new RichText();
  head.add('📦 ' + cleanName(product.name) + '\n');
  const prices = priceLines(product);
  const strike = priceStrikeEntity(product, prices, head.text.length);
  if (strike) head.entities.push(strike);
  head.add(prices + '\n' + (isAvailable(product) ? '✅ موجود' : '⛔️ فعلاً ناموجود'));

  const footer = new Out();
  if (isAvailable(product) && product.eitaa_keyword?.trim()) footer.add('\n\n🛒 برای خرید بنویسید:  ').code('خرید ' + product.eitaa_keyword.trim());

  let { text, entities } = head;
  const terms = product.terms_text?.trim() ? product.terms_text : null;
  if (terms) {
    const room = MAX_REPLY_UNITS - head.text.length - 2 - footer.text.length - 1;
    const full = terms.length <= room;
    const t = full ? { text: terms, entities: (product.terms_entities ?? []) as MessageEntity[] } : cutAtLine(terms, (product.terms_entities ?? []) as MessageEntity[], room);
    const joined = withHeader(head.text + '\n\n', head.entities, t.text + (full ? '' : '…'), t.entities);
    text = joined.text;
    entities = joined.entities;
  }
  const base = text.length;
  return { text: text + footer.text, entities: [...entities, ...footer.entities.map((e) => ({ ...e, offset: e.offset + base }))] };
}

// ─── Eitaa entities ──────────────────────────────────────────────────────────

const TYPE_MAP: Record<string, string> = {
  bold: 'messageEntityBold', italic: 'messageEntityItalic', underline: 'messageEntityUnderline', strikethrough: 'messageEntityStrike',
  code: 'messageEntityCode', blockquote: 'messageEntityBlockquote', url: 'messageEntityUrl', mention: 'messageEntityMention',
  hashtag: 'messageEntityHashtag',
};

/** Telegram entities → Eitaa TL objects (UTF-16 offsets are the same on both sides); unsupported types are dropped. */
export function toEitaaEntities(entities: MessageEntity[] | null | undefined): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const e of entities ?? []) {
    const base = { offset: e.offset, length: e.length };
    if (e.type === 'pre') out.push({ _: 'messageEntityPre', ...base, language: (e as any).language ?? '' });
    else if (e.type === 'text_link') out.push({ _: 'messageEntityTextUrl', ...base, url: (e as any).url });
    else if (TYPE_MAP[e.type]) out.push({ _: TYPE_MAP[e.type], ...base });
  }
  return out;
}

import type { StoreApp } from '../../apps';
import { Markup, type InlineButton } from '../../lib/markup';
import { formatJalaliDateTime, tehranDateTime } from '../../lib/time';
import type { Order } from '../db';
import { customerContactRow, customerRefHtml } from '../customerRef';
import { escapeHtml, formatPrice } from '../utils';
import type { SupplierOrderRow } from './types';

export type NeedsActionReason =
  | 'loss' | 'no_enabled_source' | 'all_out_of_stock' | 'retry_later' | 'config' | 'rejected' | 'unknown'
  | 'supplier_failed' | 'completed_no_accounts' | 'send_failed' | 'deadline' | 'approval';

export interface CardOptions {
  /** Replaces the first line (HTML, already escaped). The default is «⏸ سفارش #ID — نیازمند تصمیم». */
  header?: string;
  /** Extra HTML lines under the reason (e.g. the wallet estimate). */
  extraLines?: string[];
}

export interface SourceState { supplier_name: string; is_enabled: number; sup_enabled: number; listed: number; oos_until: string | null }

export interface CardData {
  order: Order;
  so: (SupplierOrderRow & { supplier_name: string | null }) | null;
  customerName: string;
  product: { cost_toman: number | null } | null;
  sendError: string | null;
  /** any delivery row exists (a manual delivery can't be undone after one) */
  hasDelivery: boolean;
  sources: SourceState[];
  now: string;
}

const cb = (text: string, data: string): InlineButton => Markup.button.callback(text, data);
const LIVE = ['queued', 'placing', 'placed'];

export async function loadCardData(app: StoreApp, orderId: number): Promise<CardData | null> {
  const q = (sql: string, ...args: unknown[]) => app.raw.prepare(sql).bind(...args);
  const [o, so, c, p, d, srcs] = await app.raw.batch([
    q('SELECT * FROM orders WHERE id = ?', orderId),
    q(`SELECT so.*, sup.name AS supplier_name FROM supplier_orders so LEFT JOIN suppliers sup ON sup.id = so.supplier_id
       WHERE so.order_id = ? ORDER BY so.id DESC LIMIT 1`, orderId),
    q('SELECT display_name FROM customers WHERE telegram_id = (SELECT customer_telegram_id FROM orders WHERE id = ?)', orderId),
    q('SELECT cost_toman FROM customer_products WHERE id = (SELECT customer_product_id FROM orders WHERE id = ?)', orderId),
    q('SELECT send_error FROM order_deliveries WHERE order_id = ? ORDER BY id DESC LIMIT 1', orderId),
    q(`SELECT sup.name AS supplier_name, s.is_enabled, sup.is_enabled AS sup_enabled, s.listed, s.oos_until
       FROM product_sources s JOIN suppliers sup ON sup.id = s.supplier_id
       WHERE s.customer_product_id = (SELECT customer_product_id FROM orders WHERE id = ?) ORDER BY s.priority, s.id`, orderId),
  ]);
  const order = o.results[0] as Order | undefined;
  if (!order) return null;
  return {
    order,
    so: (so.results[0] as CardData['so']) ?? null,
    customerName: (c.results[0] as any)?.display_name ?? String(order.customer_telegram_id),
    product: (p.results[0] as any) ?? null,
    sendError: (d.results[0] as any)?.send_error ?? null,
    hasDelivery: d.results.length > 0,
    sources: srcs.results as SourceState[],
    now: tehranDateTime(app.apps.now()),
  };
}

function sourceStateFa(s: SourceState, now: string): string {
  if (!s.sup_enabled) return 'تأمین‌کننده غیرفعال است';
  if (!s.is_enabled) return 'غیرفعال (توسط شما)';
  if (!s.listed) return 'از لیست تأمین‌کننده خارج شده';
  if (s.oos_until && s.oos_until > now) return 'ناموجود';
  return 'موجود';
}

/** The Persian text of a reason code (SUPPLIER_PLAN.md §8.1 and §7.3). HTML; every dynamic value is escaped. */
export function reasonText(reason: string, d: CardData): string {
  const supplier = escapeHtml(d.so?.supplier_name ?? 'تأمین‌کننده');
  const detail = escapeHtml((d.so?.last_error ?? '').slice(0, 300));
  switch (reason) {
    case 'loss':
      return 'قیمت پرداختی مشتری (' + formatPrice(d.order.price) + ' ت) از قیمت خرید فعلی (' +
        formatPrice(d.product?.cost_toman ?? 0) + ' ت) کمتر است؛ خرید خودکار انجام نشد.';
    case 'no_enabled_source': return 'هیچ منبع فعالی برای این محصول نیست (همه را غیرفعال کرده‌اید).';
    case 'all_out_of_stock':
      return 'همه‌ی منبع‌ها ناموجودند.' + d.sources.map((s) => '\n• ' + escapeHtml(s.supplier_name) + ': ' + sourceStateFa(s, d.now)).join('');
    case 'retry_later': return 'تأمین‌کننده فعلاً سفارش را نپذیرفت (' + detail + ').';
    case 'config':
      return '❌ تنظیمات «' + supplier + '» مشکل دارد (' + detail + '). کلید یا user_id را در پنل درست کنید، بعد «🔁 تلاش دوباره» را بزنید.';
    case 'rejected': return '«' + supplier + '» سفارش را نپذیرفت (HTTP ' + (d.so?.last_http ?? '?') + ': ' + detail + ').';
    case 'unknown':
      return '❓ معلوم نیست سفارش در «' + supplier + '» ثبت شده یا نه (' + detail + '). در پنل تأمین‌کننده دنبال یادداشت store#' +
        d.order.id + ' بگردید.';
    case 'supplier_failed':
      return '«' + supplier + '» سفارش را ناموفق اعلام کرد (' + escapeHtml(d.so?.remote_status ?? '') +
        '). ممکن است مبلغ در کیف پول شما برگشته باشد؛ در آن صورت در تاریخچه‌ی کیف پول «بازگشت وجه» ثبت کنید.';
    case 'completed_no_accounts': return 'سفارش در «' + supplier + '» تکمیل شد ولی اکانتی برنگشت.';
    case 'send_failed':
      return '❌ سفارش #' + d.order.id + ' تحویل نشد — دلیل: ' + escapeHtml(d.sendError ?? 'مشتری ربات را بلاک کرده');
    case 'deadline': return '⏰ مهلت ۲۰ ساعته‌ی تحویل تمام شد.';
    case 'approval': return 'نیاز به تأیید شما: جایزه‌ی دعوت دوستان — محصول رایگان (هزینه‌ی تقریبی ' +
      formatPrice(d.product?.cost_toman ?? 0) + ' ت)';
    default: return escapeHtml(reason);
  }
}

/** Buttons that make sense for the order's current state (SUPPLIER_PLAN.md §8.2). */
export function cardRows(d: CardData): InlineButton[][] {
  const o = d.order;
  const id = o.id;
  const reason = o.needs_action_reason;
  const so = d.so;
  const live = so !== null && LIVE.includes(so.status);
  // money may already be spent (or a delivery waits): buying from another source would buy twice
  const inFlight = so !== null && ['placing', 'placed', 'completed'].includes(so.status);
  const rows: InlineButton[][] = [];
  const retry = cb('🔁 تلاش دوباره', 'fo_retry_' + id);
  const src = cb('🔀 خرید از منبع دیگر', 'fo_src_' + id);
  const stock = cb('📦 از اکانت‌های من', 'fo_stock_' + id);
  const text = cb('✍️ ارسال متن اکانت', 'fo_text_' + id);
  const self = cb('🙋 خودم تحویل می‌دهم', 'fo_self_' + id);
  const cancel = cb('❌ لغو سفارش', 'fo_cancel_' + id);

  if (o.status === 'confirmed' && o.fulfillment === 'manual_outside') {
    rows.push([cb('✅ تحویل شد', 'fo_done_' + id)]);
    rows.push(customerContactRow(o.customer_telegram_id, o.customer_username, id));
    if (!d.hasDelivery) rows.push([cb('↩️ برگشت به تحویل خودکار', 'fo_undo_' + id)]);
    rows.push([cancel, cb('📜 تاریخچه', 'fo_hist_' + id)]);
    return rows;
  }
  if (o.status === 'confirmed' && (o.fulfillment === 'stock' || o.fulfillment === 'manual_text')) {
    // the admin's own delivery could not be sent: send it again, look at it, or give up and refund
    rows.push([cb('🔁 ارسال دوباره', 'fo_resend_' + id), cb('👁 نمایش اکانت', 'fo_view_' + id)], [cancel]);
  }
  if (o.status === 'confirmed' && o.fulfillment === 'supplier') {
    if (reason === 'unknown') {
      rows.push([cb('🔢 ثبت شده بود؛ شماره‌اش را وارد می‌کنم', 'fo_rid_' + id)], [cb('🔁 ثبت نشده بود؛ دوباره ثبت کن', 'fo_retry_' + id), src]);
      rows.push([stock, text], [self, cancel]);
    } else if (reason === 'send_failed') {
      rows.push([cb('🔁 ارسال دوباره', 'fo_resend_' + id), cb('👁 نمایش اکانت', 'fo_view_' + id)], [self, cancel]);
    } else {
      const first = [...(live ? [] : [retry]), ...(inFlight ? [] : [src])];
      if (first.length) rows.push(first);
      rows.push([stock, text], [self, cancel]);
    }
  }
  rows.push(customerContactRow(o.customer_telegram_id, o.customer_username, id));
  rows.push([cb('📜 تاریخچه', 'fo_hist_' + id)]);
  return rows;
}

/** The decision card of an order: HTML text and keyboard rows (SUPPLIER_PLAN.md §8.2). */
export async function buildDecisionCard(app: StoreApp, orderId: number, opts: CardOptions = {}): Promise<{ html: string; rows: InlineButton[][] } | null> {
  const d = await loadCardData(app, orderId);
  if (!d) return null;
  const o = d.order;
  const lines = [
    opts.header ?? '⏸ سفارش #' + o.id + ' — نیازمند تصمیم',
    customerRefHtml({ id: o.customer_telegram_id, name: d.customerName, username: o.customer_username }),
    '📦 محصول: ' + escapeHtml(o.product_name),
    '💰 مبلغ پرداختی: ' + formatPrice(o.price) + ' تومان | 🕒 تأیید: ' + (o.decided_at ? formatJalaliDateTime(o.decided_at) : '—'),
    ...(o.needs_action_reason ? ['📝 دلیل: ' + reasonText(o.needs_action_reason, d)] : []),
  ];
  const so = d.so;
  if (so && (so.last_http != null || so.last_error)) {
    lines.push('🛒 آخرین تلاش: ' + escapeHtml(so.supplier_name ?? '—') + ' — ' + (so.last_http ?? '—') + ' ' +
      escapeHtml((so.last_error ?? '').slice(0, 200)) + ' — ' + formatJalaliDateTime(so.updated_at));
  }
  if (opts.extraLines) lines.push(...opts.extraLines);
  return { html: lines.join('\n'), rows: cardRows(d) };
}

// ─── /order card and history (SUPPLIER_PLAN.md §8.3, §8.5) ───────────────────

const KIND_FA: Record<string, string> = {
  queued: 'در صف خرید', claim: 'شروع ثبت سفارش', placed: 'در تأمین‌کننده ثبت شد', place_failed: 'ثبت سفارش ناموفق', out_of_stock: 'ناموجود',
  unknown: 'نامشخص (شاید ثبت شده)', poll: 'بررسی وضعیت', completed: 'تأمین‌کننده تکمیل کرد', delivered: 'تحویل به مشتری',
  send_failed: 'ارسال به مشتری ناموفق', needs_action: 'نیازمند تصمیم', admin_retry: 'تلاش دوباره', admin_source: 'خرید از منبع دیگر',
  admin_stock: 'تحویل از اکانت‌های من', admin_text: 'ارسال متن اکانت', admin_self: 'تحویل دستی', admin_undo: 'برگشت به تحویل خودکار',
  admin_done: 'تحویل دستی انجام شد', admin_cancel: 'لغو سفارش', refund_done: 'بازپرداخت انجام شد', admin_message: 'پیام به مشتری',
  diverted_to_stock: 'اکانت به «اکانت‌های من» رفت', cost_set: 'ثبت هزینه', remote_id_set: 'ثبت شماره‌ی سفارش تأمین‌کننده',
  price_mismatch: 'قیمت اعلام‌شده نمی‌خواند',
};
export const kindFa = (kind: string): string => KIND_FA[kind] ?? kind;

interface EventRow { kind: string; actor: number; detail: string | null; created_at: string }

const eventLine = (e: EventRow): string =>
  formatJalaliDateTime(e.created_at) + ' — ' + kindFa(e.kind) + ' — ' + (e.actor === 0 ? 'سیستم' : 'ادمین ' + e.actor) +
  (e.detail ? ' — ' + escapeHtml(e.detail.slice(0, 120)) : '');

/** `JALALI_TIME — KIND_FA — ACTOR — DETAIL` for the newest events (default 15), oldest first. */
export async function historyText(app: StoreApp, orderId: number, limit = 15): Promise<string> {
  const rows = (await app.raw.prepare('SELECT kind, actor, detail, created_at FROM fulfillment_events WHERE order_id = ? ORDER BY id DESC LIMIT ?')
    .bind(orderId, limit).all<EventRow>()).results.reverse();
  return '📜 <b>تاریخچه‌ی سفارش #' + orderId + '</b>\n\n' + (rows.length ? rows.map(eventLine).join('\n') : 'رویدادی ثبت نشده است.');
}

const STATUS_FA: Record<string, string> = {
  pending: 'در انتظار تأیید رسید', confirmed: 'تأییدشده، منتظر تحویل', delivered: 'تحویل‌شده', rejected: 'ردشده', cancelled: 'لغوشده',
};
const FULFILLMENT_FA: Record<string, string> = {
  supplier: '🔌 خودکار از تأمین‌کننده', stock: '📦 از اکانت‌های من', manual_text: '✍️ متن دستی', manual_outside: '🙋 تحویل دستی',
};

/** The card of `/order <id>`: status, customer, product, money, the supplier order, the last 5 events and the buttons. */
export async function buildOrderCard(app: StoreApp, orderId: number): Promise<{ html: string; rows: InlineButton[][] } | null> {
  const d = await loadCardData(app, orderId);
  if (!d) return null;
  const o = d.order;
  const ev = (await app.raw.prepare('SELECT kind, actor, detail, created_at FROM fulfillment_events WHERE order_id = ? ORDER BY id DESC LIMIT 5')
    .bind(orderId).all<EventRow>()).results.reverse();
  const lines = [
    '📄 <b>سفارش #' + o.id + '</b> — ' + (STATUS_FA[o.status] ?? o.status),
    customerRefHtml({ id: o.customer_telegram_id, name: d.customerName, username: o.customer_username }),
    '📦 محصول: ' + escapeHtml(o.product_name),
    '💰 مبلغ: ' + formatPrice(o.price) + ' تومان | 🕒 ثبت: ' + formatJalaliDateTime(o.created_at),
    '🚚 تحویل: ' + (o.fulfillment ? FULFILLMENT_FA[o.fulfillment] ?? o.fulfillment : 'روش قدیمی (ربات منشی / دستی)'),
  ];
  if (d.so) {
    lines.push('🔌 سفارش تأمین‌کننده: ' + escapeHtml(d.so.supplier_name ?? '—') + ' — ' + d.so.status +
      (d.so.remote_order_id ? ' (#' + escapeHtml(d.so.remote_order_id) + ')' : '') + (d.so.remote_status ? ' [' + escapeHtml(d.so.remote_status) + ']' : ''));
  }
  lines.push(o.cost_toman != null
    ? '💵 هزینه: ' + formatPrice(o.cost_toman) + ' ت | سود: ' + formatPrice(o.price - o.cost_toman) + ' ت'
    : '💵 هزینه: نامشخص');
  if (o.status === 'cancelled') {
    lines.push('❌ لغو: ' + escapeHtml(o.cancel_reason ?? 'بدون دلیل') + ' | بازپرداخت: ' +
      (o.refund_status === 'pending' ? 'در انتظار' : o.refund_status === 'done' ? 'انجام شد' : 'ندارد'));
  }
  if (o.needs_action_reason && o.status === 'confirmed') lines.push('📝 نیازمند تصمیم: ' + reasonText(o.needs_action_reason, d));
  if (ev.length) lines.push('', '<b>آخرین رویدادها</b>', ...ev.map(eventLine));

  const decisionState = o.status === 'confirmed' && ['supplier', 'manual_outside', 'stock', 'manual_text'].includes(o.fulfillment ?? '');
  const rows: InlineButton[][] = decisionState ? cardRows(d) : [customerContactRow(o.customer_telegram_id, o.customer_username, o.id)];
  if (o.status === 'cancelled' && o.refund_status === 'pending') rows.unshift([cb('✅ بازپرداخت انجام شد', 'fo_refund_' + o.id)]);
  const tail: InlineButton[] = [];
  if (!decisionState) tail.push(cb('📜 تاریخچه', 'fo_hist_' + o.id));
  if (d.hasDelivery) tail.push(cb('👁 نمایش اکانت', 'fo_view_' + o.id));
  if (tail.length) rows.push(tail);
  return { html: lines.join('\n'), rows };
}

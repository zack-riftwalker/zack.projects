import type { StoreApp } from '../../apps';
import { Markup, type InlineButton } from '../../lib/markup';
import { formatJalaliDateTime } from '../../lib/time';
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

interface CardData {
  order: Order;
  so: (SupplierOrderRow & { supplier_name: string | null }) | null;
  customerName: string;
  product: { cost_toman: number | null } | null;
  sendError: string | null;
}

const cb = (text: string, data: string): InlineButton => Markup.button.callback(text, data);
const LIVE = ['queued', 'placing', 'placed'];

async function loadCardData(app: StoreApp, orderId: number): Promise<CardData | null> {
  const q = (sql: string, ...args: unknown[]) => app.raw.prepare(sql).bind(...args);
  const [o, so, c, p, d] = await app.raw.batch([
    q('SELECT * FROM orders WHERE id = ?', orderId),
    q(`SELECT so.*, sup.name AS supplier_name FROM supplier_orders so LEFT JOIN suppliers sup ON sup.id = so.supplier_id
       WHERE so.order_id = ? ORDER BY so.id DESC LIMIT 1`, orderId),
    q('SELECT display_name FROM customers WHERE telegram_id = (SELECT customer_telegram_id FROM orders WHERE id = ?)', orderId),
    q('SELECT cost_toman FROM customer_products WHERE id = (SELECT customer_product_id FROM orders WHERE id = ?)', orderId),
    q('SELECT send_error FROM order_deliveries WHERE order_id = ? ORDER BY id DESC LIMIT 1', orderId),
  ]);
  const order = o.results[0] as Order | undefined;
  if (!order) return null;
  return {
    order,
    so: (so.results[0] as CardData['so']) ?? null,
    customerName: (c.results[0] as any)?.display_name ?? String(order.customer_telegram_id),
    product: (p.results[0] as any) ?? null,
    sendError: (d.results[0] as any)?.send_error ?? null,
  };
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
    case 'all_out_of_stock': return 'همه‌ی منبع‌ها ناموجودند.';
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

/** Buttons that make sense for the order's current state (only the actions that exist are offered). */
export function cardRows(d: CardData): InlineButton[][] {
  const id = d.order.id;
  const reason = d.order.needs_action_reason;
  const live = d.so !== null && LIVE.includes(d.so.status);
  const rows: InlineButton[][] = [];
  if (reason === 'unknown') {
    rows.push([cb('🔢 ثبت شده بود؛ شماره‌اش را وارد می‌کنم', 'fo_rid_' + id)], [cb('🔁 ثبت نشده بود؛ دوباره ثبت کن', 'fo_retry_' + id)]);
  } else if (reason === 'send_failed') {
    rows.push([cb('🔁 ارسال دوباره', 'fo_resend_' + id), cb('👁 نمایش اکانت', 'fo_view_' + id)]);
  } else if (!live) {
    rows.push([cb('🔁 تلاش دوباره', 'fo_retry_' + id)]);
  }
  rows.push(customerContactRow(d.order.customer_telegram_id, d.order.customer_username, id));
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
    '📝 دلیل: ' + reasonText(o.needs_action_reason ?? '', d),
  ];
  const so = d.so;
  if (so && (so.last_http != null || so.last_error)) {
    lines.push('🛒 آخرین تلاش: ' + escapeHtml(so.supplier_name ?? '—') + ' — ' + (so.last_http ?? '—') + ' ' +
      escapeHtml((so.last_error ?? '').slice(0, 200)) + ' — ' + formatJalaliDateTime(so.updated_at));
  }
  if (opts.extraLines) lines.push(...opts.extraLines);
  return { html: lines.join('\n'), rows: cardRows(d) };
}

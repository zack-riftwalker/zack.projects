import type { StoreApp } from '../../apps';
import { Markup, type InlineButton } from '../../lib/markup';
import { escapeHtml, formatJalaliDate, formatPrice } from '../utils';
import { formatAccountsHtml, parseContent } from './format';

export const ACCOUNT_STATUS_FA: Record<string, string> = {
  available: 'آزاد', reserved: 'رزرو', delivered: 'تحویل‌شده', sold_outside: 'فروخته‌شده بیرون', defective: 'خراب/مرجوعی',
};

export const BATCH_LIST_SQL = `SELECT b.id, b.title, b.quantity, b.created_at,
  (SELECT COUNT(*) FROM stock_accounts a WHERE a.batch_id = b.id AND a.status = 'available') AS free
  FROM stock_batches b ORDER BY b.id DESC LIMIT 60`;
export const BATCH_ACCOUNTS_SQL = 'SELECT id, status FROM stock_accounts WHERE batch_id = ? ORDER BY id LIMIT 40';

const cb = (text: string, data: string): InlineButton => Markup.button.callback(text, data);
const fa = (n: number | string) => String(n).replace(/\d/g, (d) => String.fromCharCode(d.charCodeAt(0) + 0x06f0 - 0x30));

export interface BatchRow {
  id: number; supplier_id: number | null; supplier_order_id: number | null; title: string; quantity: number; unit_price_usd: number | null;
  usd_toman: number | null; cost_toman: number | null; reported_profit_toman: number | null; reported_at: string | null; note: string | null; created_at: string;
}

export interface BatchListItem { id: number; title: string; quantity: number; created_at: string; free: number }

export async function listBatches(app: StoreApp): Promise<BatchListItem[]> {
  return (await app.raw.prepare(BATCH_LIST_SQL).bind().all<BatchListItem>()).results;
}

export const batchLabel = (b: BatchListItem): string => b.title.slice(0, 28) + ' — آزاد ' + fa(b.free) + ' از ' + fa(b.quantity) + ' — ' + formatJalaliDate(b.created_at);

/** The batch card: cost, reported profit, note and one button per account (`stk_a_<id>`), 40 at most. */
export async function buildBatchCard(app: StoreApp, batchId: number): Promise<{ html: string; rows: InlineButton[][] } | null> {
  const [b, accounts] = await app.raw.batch([
    app.raw.prepare('SELECT * FROM stock_batches WHERE id = ?').bind(batchId),
    app.raw.prepare(BATCH_ACCOUNTS_SQL).bind(batchId),
  ]);
  const batch = b.results[0] as BatchRow | undefined;
  if (!batch) return null;
  const list = accounts.results as { id: number; status: string }[];
  const free = list.filter((a) => a.status === 'available').length;
  const lines = [
    '📦 <b>' + escapeHtml(batch.title) + '</b>',
    '🗓 ' + formatJalaliDate(batch.created_at) + ' | تعداد: ' + fa(batch.quantity) + ' | آزاد: ' + fa(free),
    batch.cost_toman !== null
      ? '💵 هزینه: ' + formatPrice(batch.cost_toman) + ' ت' + (batch.unit_price_usd !== null && batch.usd_toman !== null
        ? ' ($' + batch.unit_price_usd + ' × ' + fa(batch.quantity) + ' با نرخ ' + formatPrice(batch.usd_toman) + ')' : '')
      : '💵 هزینه: نامشخص',
    '📈 سود ثبت‌شده برای کل دسته: ' + (batch.reported_profit_toman === null ? '—' : formatPrice(batch.reported_profit_toman) + ' ت'),
  ];
  if (batch.note) lines.push('📝 ' + escapeHtml(batch.note));
  const rows: InlineButton[][] = [];
  for (let i = 0; i < list.length; i += 2) {
    rows.push(list.slice(i, i + 2).map((a, j) => cb('اکانت ' + fa(i + j + 1) + ' — ' + (ACCOUNT_STATUS_FA[a.status] ?? a.status), 'stk_a_' + a.id)));
  }
  rows.push([cb('💰 ثبت سود کل این دسته', 'stk_bp_' + batch.id), cb('📝 یادداشت', 'stk_bn_' + batch.id)], [cb('🔙', 'stk_list_0')]);
  return { html: lines.join('\n'), rows };
}

export interface AccountRow {
  id: number; batch_id: number; content_json: string; status: string; order_id: number | null; sold_price_toman: number | null;
  sold_at: string | null; note: string | null; title: string; cost_toman: number | null; quantity: number;
}

export async function loadAccount(app: StoreApp, id: number): Promise<AccountRow | null> {
  return (await app.raw.prepare(`SELECT a.id, a.batch_id, a.content_json, a.status, a.order_id, a.sold_price_toman, a.sold_at, a.note,
    b.title, b.cost_toman, b.quantity FROM stock_accounts a JOIN stock_batches b ON b.id = a.batch_id WHERE a.id = ?`).bind(id).first<AccountRow>()) ?? null;
}

/** The account card: the content, status, linked order and the actions that fit the status (§10.2). */
export function buildAccountCard(a: AccountRow): { html: string; rows: InlineButton[][] } {
  const content = parseContent(a.content_json);
  const lines = [
    '📦 <b>' + escapeHtml(a.title) + '</b> — اکانت #' + a.id,
    'وضعیت: ' + (ACCOUNT_STATUS_FA[a.status] ?? a.status),
    '',
    content ? formatAccountsHtml(content) : '—',
  ];
  if (a.order_id) lines.push('', '🧾 سفارش #' + a.order_id + ' — /order ' + a.order_id);
  if (a.status === 'sold_outside') lines.push('', '💰 فروش: ' + (a.sold_price_toman === null ? '—' : formatPrice(a.sold_price_toman) + ' ت') + (a.sold_at ? ' — ' + formatJalaliDate(a.sold_at) : ''));
  if (a.note) lines.push('📝 ' + escapeHtml(a.note));
  const rows: InlineButton[][] = [];
  if (a.status === 'available') {
    rows.push([cb('📤 ارسال برای مشتری', 'stk_send_' + a.id), cb('🔗 لینک خرید دستی', 'stk_link_' + a.id)]);
    rows.push([cb('💰 فروختم بیرون از ربات', 'stk_out_' + a.id), cb('⚠️ خراب/مرجوعی', 'stk_bad_' + a.id)]);
  } else if (a.status === 'reserved' && a.order_id === null) {
    // reserved for a manual-purchase link that nobody opened yet
    rows.push([cb('↩️ لینک استفاده نشده؛ آزاد کن', 'stk_rel_' + a.id)]);
  } else if (a.status === 'sold_outside' || a.status === 'defective') {
    rows.push([cb('↩️ برگشت به آزاد', 'stk_back_' + a.id)]);
  }
  rows.push([cb('🔙', 'stk_b_' + a.batch_id)]);
  return { html: lines.join('\n'), rows };
}

/** Available accounts, oldest first; the ones from a batch bought for one of this product's sources come first (`match`). */
export async function availableStockFor(app: StoreApp, productId: number): Promise<{ id: number; title: string; match: boolean }[]> {
  const mine = (await app.raw.prepare('SELECT remote_product_id, remote_variation_id FROM product_sources WHERE customer_product_id = ?')
    .bind(productId).all<{ remote_product_id: string; remote_variation_id: string }>()).results;
  const rows = (await app.raw.prepare(`
    SELECT a.id, b.title, so.remote_product_id, so.remote_variation_id FROM stock_accounts a
    JOIN stock_batches b ON b.id = a.batch_id LEFT JOIN supplier_orders so ON so.id = b.supplier_order_id
    WHERE a.status = 'available' ORDER BY a.id LIMIT 48`).bind()
    .all<{ id: number; title: string; remote_product_id: string | null; remote_variation_id: string | null }>()).results;
  const items = rows.map((r) => ({
    id: r.id, title: r.title,
    match: mine.some((m) => m.remote_product_id === r.remote_product_id && m.remote_variation_id === r.remote_variation_id),
  }));
  return [...items.filter((i) => i.match), ...items.filter((i) => !i.match)];
}

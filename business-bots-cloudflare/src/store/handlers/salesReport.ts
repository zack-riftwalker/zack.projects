import type { Bot } from 'grammy';
import type { StoreApp } from '../../apps';
import { Markup } from '../../lib/markup';
import { formatJalaliDate, reportRange, type ReportPeriod } from '../../lib/time';
import { REPORT_LABEL } from '../labels';
import { formatPrice } from '../utils';
import type { StoreContext } from '../types';

const PERIODS: { key: ReportPeriod; cb: string; button: string; title: string }[] = [
  { key: 'today', cb: 'rpt_today', button: 'امروز', title: 'امروز' },
  { key: '7d', cb: 'rpt_7d', button: '۷ روز', title: '۷ روز اخیر' },
  { key: '30d', cb: 'rpt_30d', button: '۳۰ روز', title: '۳۰ روز اخیر' },
  { key: 'month', cb: 'rpt_month', button: 'این ماه (شمسی)', title: 'این ماه (شمسی)' },
  { key: 'all', cb: 'rpt_all', button: 'کل', title: 'کل' },
];

const fa = (n: number) => n.toLocaleString('fa-IR');
const SOURCE_LABEL: Record<string, string> = { receipt: 'رسید کارت‌به‌کارت', manual: 'خرید دستی' };

function periodKeyboard(current: ReportPeriod) {
  const btn = (p: (typeof PERIODS)[number]) => Markup.button.callback((p.key === current ? '✔ ' : '') + p.button, p.cb);
  return Markup.inlineKeyboard([PERIODS.slice(0, 3).map(btn), PERIODS.slice(3).map(btn)]);
}

/** The supplier / profit statements of the report (SUPPLIER_PLAN.md §11); exported so the index test EXPLAINs the real SQL. */
export const PROFIT_SQL = {
  /** cost, profit and count of the bot's orders that have a recorded cost */
  costed: "SELECT COUNT(*) AS n, COALESCE(SUM(cost_toman), 0) AS cost, COALESCE(SUM(price - cost_toman), 0) AS profit FROM orders WHERE status IN ('confirmed', 'delivered') AND cost_toman IS NOT NULL AND decided_at >= ? AND decided_at < ?",
  /** orders on the new fulfillment paths whose cost is not known yet (legacy orders have fulfillment NULL and are not counted) */
  missing: "SELECT COUNT(*) AS n FROM orders WHERE status IN ('confirmed', 'delivered') AND fulfillment IS NOT NULL AND cost_toman IS NULL AND decided_at >= ? AND decided_at < ?",
  cancelled: "SELECT COUNT(*) AS n FROM orders WHERE status = 'cancelled' AND cancelled_at >= ? AND cancelled_at < ?",
  /** the current number, not limited to the range */
  refundPending: "SELECT COUNT(*) AS n FROM orders WHERE status = 'cancelled' AND refund_status = 'pending'",
  /** accounts sold outside the bot in the range; profit counts only batches without a reported profit and with a known cost */
  outside: `SELECT COUNT(*) AS n, COALESCE(SUM(a.sold_price_toman), 0) AS revenue,
      COALESCE(SUM(CASE WHEN b.reported_profit_toman IS NULL AND b.cost_toman IS NOT NULL AND b.quantity > 0
                        THEN a.sold_price_toman - ROUND(1.0 * b.cost_toman / b.quantity) END), 0) AS profit
    FROM stock_accounts a JOIN stock_batches b ON b.id = a.batch_id
    WHERE a.status = 'sold_outside' AND a.sold_at >= ? AND a.sold_at < ?`,
  /** a profit the admin reported for a whole batch counts in the range of its report time */
  reported: 'SELECT COUNT(*) AS n, COALESCE(SUM(reported_profit_toman), 0) AS profit FROM stock_batches WHERE reported_at >= ? AND reported_at < ? AND reported_profit_toman IS NOT NULL',
  bought: 'SELECT COUNT(*) AS n, COALESCE(SUM(cost_toman), 0) AS cost, COALESCE(SUM(quantity), 0) AS accounts FROM stock_batches WHERE created_at >= ? AND created_at < ?',
  available: "SELECT COUNT(*) AS n FROM stock_accounts WHERE status = 'available'",
  spend: "SELECT COALESCE(SUM(-amount_usd), 0) AS usd FROM wallet_ledger WHERE kind = 'spend' AND created_at >= ? AND created_at < ?",
};

/** Round 4 (CAMPAIGN_PLAN.md §3, §8): per-source and per-code sections; exported so the index test EXPLAINs the real SQL. */
export const CAMPAIGN_SQL = {
  /** new customers of the period by first-touch source, with their paid orders decided in the same period (args: range ×3) */
  sources: `SELECT COALESCE(c.source, '') AS src, COUNT(*) AS n,
      SUM(CASE WHEN EXISTS (SELECT 1 FROM orders o WHERE o.customer_telegram_id = c.telegram_id AND o.status IN ('confirmed', 'delivered') AND o.price > 0 AND o.decided_at >= ? AND o.decided_at < ?) THEN 1 ELSE 0 END) AS buyers,
      COALESCE(SUM((SELECT SUM(o.price) FROM orders o WHERE o.customer_telegram_id = c.telegram_id AND o.status IN ('confirmed', 'delivered') AND o.price > 0 AND o.decided_at >= ? AND o.decided_at < ?)), 0) AS revenue
    FROM customers c WHERE c.created_at >= ? AND c.created_at < ?
    GROUP BY COALESCE(c.source, '') ORDER BY n DESC LIMIT 11`,
  /** top 10 discount codes by revenue in the period (args: range) */
  codes: `SELECT d.code, COUNT(*) AS n, SUM(o.price) AS revenue FROM orders o JOIN discount_codes d ON d.id = o.discount_code_id
    WHERE o.status IN ('confirmed', 'delivered') AND o.decided_at >= ? AND o.decided_at < ?
    GROUP BY o.discount_code_id ORDER BY revenue DESC LIMIT 10`,
};

/** One batch of index-backed statements → the report text. */
export async function buildSalesReport(app: StoreApp, period: ReportPeriod): Promise<string> {
  const { from, to, fromDay, toDay } = reportRange(period, app.apps.now());
  const q = (sql: string, ...args: unknown[]) => app.raw.prepare(sql).bind(...args);
  const range = [from, to];
  const [bySource, rejected, withCode, top, newCustomers, current, costed, missing, cancelled, refundPending, outside, reported, bought, available, spend, sources, codes] = await app.raw.batch([
    q("SELECT purchase_source, COUNT(*) AS n, COALESCE(SUM(price), 0) AS s FROM orders WHERE status IN ('confirmed', 'delivered') AND decided_at >= ? AND decided_at < ? GROUP BY purchase_source", ...range),
    q("SELECT COUNT(*) AS n FROM orders WHERE status = 'rejected' AND decided_at >= ? AND decided_at < ?", ...range),
    q("SELECT COUNT(*) AS n FROM orders WHERE status IN ('confirmed', 'delivered') AND discount_code_id IS NOT NULL AND decided_at >= ? AND decided_at < ?", ...range),
    q("SELECT customer_product_id, MAX(product_name) AS name, COUNT(*) AS n, SUM(price) AS s FROM orders WHERE status IN ('confirmed', 'delivered') AND decided_at >= ? AND decided_at < ? GROUP BY customer_product_id ORDER BY n DESC, s DESC LIMIT 5", ...range),
    q('SELECT COUNT(*) AS n FROM customers WHERE created_at >= ? AND created_at < ?', ...range),
    q("SELECT (SELECT COUNT(*) FROM orders WHERE status = 'pending') AS pending, (SELECT COUNT(*) FROM orders WHERE status = 'confirmed') AS waiting, (SELECT COUNT(*) FROM referrals WHERE qualified_at >= ? AND qualified_at < ?) AS ref_ok", ...range),
    q(PROFIT_SQL.costed, ...range),
    q(PROFIT_SQL.missing, ...range),
    q(PROFIT_SQL.cancelled, ...range),
    q(PROFIT_SQL.refundPending),
    q(PROFIT_SQL.outside, ...range),
    q(PROFIT_SQL.reported, ...range),
    q(PROFIT_SQL.bought, ...range),
    q(PROFIT_SQL.available),
    q(PROFIT_SQL.spend, ...range),
    q(CAMPAIGN_SQL.sources, ...range, ...range, ...range),
    q(CAMPAIGN_SQL.codes, ...range),
  ]);

  const src = new Map<string, { n: number; s: number }>(bySource.results.map((r: any) => [r.purchase_source, { n: r.n, s: r.s }]));
  const receipt = src.get('receipt') ?? { n: 0, s: 0 };
  const manual = src.get('manual') ?? { n: 0, s: 0 };
  const total = { n: receipt.n + manual.n, s: receipt.s + manual.s };
  const title = PERIODS.find((p) => p.key === period)!.title;
  const cur = current.results[0] as any;

  const lines = [
    '📊 گزارش فروش — ' + title,
    '🗓 ' + (fromDay ? formatJalaliDate(fromDay) : 'ابتدا') + ' تا ' + formatJalaliDate(toDay),
    '',
    '💰 درآمد: ' + formatPrice(total.s) + ' تومان (' + fa(total.n) + ' سفارش)',
  ];
  const parts = (['receipt', 'manual'] as const)
    .map((k) => [k, k === 'receipt' ? receipt : manual] as const)
    .filter(([, v]) => v.n > 0);
  parts.forEach(([k, v], i) => lines.push('   ' + (i === parts.length - 1 ? '└' : '├') + ' ' + SOURCE_LABEL[k] + ': ' + fa(v.n) + ' سفارش — ' + formatPrice(v.s) + ' تومان'));
  // the supplier lines appear only where there is something to say, so a shop without suppliers sees the old report
  const c = costed.results[0] as any;
  if (c.n > 0) {
    lines.push('💵 هزینه‌ی خرید: ' + formatPrice(c.cost) + ' ت (' + fa(c.n) + ' سفارش)', '📈 سود سفارش‌های ربات: ' + formatPrice(c.profit) + ' ت');
  }
  const m = (missing.results[0] as any).n;
  if (m > 0) lines.push('ℹ️ ' + fa(m) + ' سفارش بدون هزینه‌ی ثبت‌شده در سود حساب نشده‌اند.');
  lines.push('❌ رسید ردشده: ' + fa((rejected.results[0] as any).n));
  const cancelledN = (cancelled.results[0] as any).n;
  const refundK = (refundPending.results[0] as any).n;
  if (cancelledN > 0 || refundK > 0) lines.push('❌ لغوشده: ' + fa(cancelledN) + ' (بازپرداخت در انتظار: ' + fa(refundK) + ')');
  lines.push(
    '🎟 سفارش با کد تخفیف: ' + fa((withCode.results[0] as any).n),
    '👥 مشتری جدید: ' + fa((newCustomers.results[0] as any).n),
    '🎁 دعوت موفق: ' + fa(cur.ref_ok),
  );
  const out = outside.results[0] as any;
  const rep_ = reported.results[0] as any;
  if (out.n > 0 || rep_.n > 0) {
    lines.push('🛍 فروش بیرون از ربات: درآمد ' + formatPrice(out.revenue) + ' ت، سود ' + formatPrice(out.profit + rep_.profit) + ' ت');
  }
  const buy = bought.results[0] as any;
  const free = (available.results[0] as any).n;
  if (buy.n > 0 || free > 0) {
    lines.push('📦 خرید برای موجودی: ' + formatPrice(buy.cost) + ' ت (' + fa(buy.accounts) + ' اکانت، آزاد: ' + fa(free) + ')');
  }
  const usdSpent = (spend.results[0] as any).usd as number;
  if (usdSpent > 0) lines.push('💳 خرج کیف پول: $' + (Math.round(usdSpent * 100) / 100).toFixed(2));
  // round 4 (§3): where the period's new customers came from (omitted when there are none)
  const srcRows = sources.results as { src: string; n: number; buyers: number; revenue: number }[];
  if (srcRows.length) {
    const named = srcRows.filter((r) => r.src !== '').slice(0, 10);
    const none = srcRows.find((r) => r.src === '');
    lines.push('', '🔗 منبع مشتری‌های جدید');
    for (const r of none ? [...named, none] : named) {
      lines.push('• ' + (r.src === '' ? '(بدون منبع)' : r.src) + ': ' + fa(r.n) + ' مشتری جدید، ' + fa(r.buyers) + ' خریدار، ' + formatPrice(r.revenue) + ' ت');
    }
  }
  // round 4 (§8): revenue per discount code (omitted when no code was used)
  const codeRows = codes.results as { code: string; n: number; revenue: number }[];
  if (codeRows.length) {
    lines.push('', '🎟 کدهای تخفیف');
    for (const r of codeRows) lines.push('• ' + r.code + ': ' + fa(r.n) + ' سفارش، ' + formatPrice(r.revenue) + ' ت');
  }
  lines.push('', '🏆 پرفروش‌ها:');
  if (top.results.length === 0) lines.push('—');
  top.results.forEach((r: any, i: number) => lines.push(fa(i + 1) + '. ' + r.name + ' — ' + fa(r.n) + ' سفارش (' + formatPrice(r.s) + ' تومان)'));
  lines.push(
    '',
    '📌 وضعیت فعلی:',
    '⏳ رسید در انتظار بررسی: ' + fa(cur.pending),
    '🔄 تأییدشده، منتظر تحویل: ' + fa(cur.waiting),
  );
  return lines.join('\n');
}

export function registerSalesReportHandler(bot: Bot<StoreContext>, isAdmin: (id: number | undefined) => boolean) {
  bot.hears(REPORT_LABEL, async (ctx) => {
    if (!isAdmin(ctx.from?.id)) return;
    await ctx.reply(await buildSalesReport(ctx.app, 'today'), periodKeyboard('today'));
  });

  bot.callbackQuery(/^rpt_(today|7d|30d|month|all)$/, async (ctx) => {
    if (!isAdmin(ctx.from?.id)) return ctx.answerCallbackQuery('⛔️ دسترسی ندارید.');
    const period = ctx.match![1] as ReportPeriod;
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(await buildSalesReport(ctx.app, period), periodKeyboard(period)).catch((err) => {
      if (!String(err?.description ?? err?.message ?? '').includes('message is not modified')) throw err;
    });
  });
}

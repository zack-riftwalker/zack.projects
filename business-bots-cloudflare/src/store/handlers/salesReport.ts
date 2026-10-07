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

/** One batch of index-backed statements → the report text. */
export async function buildSalesReport(app: StoreApp, period: ReportPeriod): Promise<string> {
  const { from, to, fromDay, toDay } = reportRange(period, app.apps.now());
  const q = (sql: string, ...args: unknown[]) => app.raw.prepare(sql).bind(...args);
  const range = [from, to];
  const [bySource, rejected, withCode, top, newCustomers, current] = await app.raw.batch([
    q("SELECT purchase_source, COUNT(*) AS n, COALESCE(SUM(price), 0) AS s FROM orders WHERE status IN ('confirmed', 'delivered') AND decided_at >= ? AND decided_at < ? GROUP BY purchase_source", ...range),
    q("SELECT COUNT(*) AS n FROM orders WHERE status = 'rejected' AND decided_at >= ? AND decided_at < ?", ...range),
    q("SELECT COUNT(*) AS n FROM orders WHERE status IN ('confirmed', 'delivered') AND discount_code_id IS NOT NULL AND decided_at >= ? AND decided_at < ?", ...range),
    q("SELECT customer_product_id, MAX(product_name) AS name, COUNT(*) AS n, SUM(price) AS s FROM orders WHERE status IN ('confirmed', 'delivered') AND decided_at >= ? AND decided_at < ? GROUP BY customer_product_id ORDER BY n DESC, s DESC LIMIT 5", ...range),
    q('SELECT COUNT(*) AS n FROM customers WHERE created_at >= ? AND created_at < ?', ...range),
    q("SELECT (SELECT COUNT(*) FROM orders WHERE status = 'pending') AS pending, (SELECT COUNT(*) FROM orders WHERE status = 'confirmed') AS waiting, (SELECT COUNT(*) FROM referrals WHERE qualified_at >= ? AND qualified_at < ?) AS ref_ok", ...range),
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
  lines.push(
    '❌ رسید ردشده: ' + fa((rejected.results[0] as any).n),
    '🎟 سفارش با کد تخفیف: ' + fa((withCode.results[0] as any).n),
    '👥 مشتری جدید: ' + fa((newCustomers.results[0] as any).n),
    '🎁 دعوت موفق: ' + fa(cur.ref_ok),
    '',
    '🏆 پرفروش‌ها:',
  );
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

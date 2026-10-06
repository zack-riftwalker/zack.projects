import type { MonshiApp } from '../../apps';
import type { InlineKb } from '../../lib/markup';
import { utcIsoNow } from '../../lib/time';
import { unansweredView } from '../views';

export const LOOKBACK_DAYS = 7;

/** Full weekly digest text + keyboard (convert-to-FAQ buttons when unanswered questions exist). */
export async function buildDigest(app: MonshiApp): Promise<{ text: string; markup: InlineKb | undefined }> {
  const since = utcIsoNow(new Date(app.apps.now().getTime() - LOOKBACK_DAYS * 86400000));
  const stats = await app.db.getStatsSince(since);
  const by = stats.by_type;

  const lines = [
    '📊 دایجست هفتگی (۷ روز اخیر)\n',
    `✉️ پیام‌های دریافتی: ${stats.total_in}`,
    `👥 مشتری‌های یکتا: ${stats.unique_customers}`,
    `📚 پاسخ FAQ: ${by.faq ?? 0}`,
    `🤖 پیام «دریافت شد»: ${by.ack ?? 0}`,
    `🔔 ارجاع‌شده به شما: ${by.handoff ?? 0}`,
    `📦 پیگیری سفارش: ${by.order_status ?? 0}`,
    `💰 ارجاع قیمت به ربات فروش: ${by.price_fallback ?? 0}`,
    `🧑 پاسخ انسانی: ${by.human ?? 0}`,
  ];

  const openOrders = await app.db.getOpenOrders();
  if (openOrders.length) lines.push(`\n🛒 سفارش‌های باز مانده: ${openOrders.length}`);

  const unused = await app.db.getUnusedFaqsSince(since);
  if (unused.length) {
    lines.push(`\n📚 FAQهای بدون استفاده در ۷ روز اخیر (${unused.length}):`);
    for (const f of unused.slice(0, 10)) lines.push(`  • #${f.id} ${f.question.slice(0, 50)}`);
  }

  let markup: InlineKb | undefined;
  const view = await unansweredView(app, 5);
  if (view) {
    markup = view.markup;
    lines.push('\n' + view.text);
  }
  return { text: lines.join('\n'), markup };
}

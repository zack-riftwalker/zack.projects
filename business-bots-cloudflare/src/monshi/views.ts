import type { MonshiApp } from '../apps';
import { formatJalaliDate, formatPrice, formatTehran, parseLocalDateTime } from '../lib/time';
import type { CustomerSummary } from '../store/customerSummary';
import { Markup, type InlineKb } from '../lib/markup';

/** Most frequent unanswered questions with a convert-to-FAQ button — shared by /unanswered and the digest. */
export async function unansweredView(app: MonshiApp, limit = 10): Promise<{ text: string; markup: InlineKb } | null> {
  const rows = await app.db.getTopUnanswered(limit);
  if (!rows.length) return null;
  const lines = ['📥 پرتکرارترین سوالات بی‌جواب (بدون FAQ مطابق):\n'];
  const buttons = [];
  for (const r of rows) {
    const preview = r.text ? r.text.slice(0, 80) : '—';
    const when = formatTehran(r.last_seen_at);
    lines.push(`🔁 ${r.count} بار — آخرین بار ${when} (تهران)\n💬 ${preview}\n`);
    buttons.push([Markup.button.callback(`➕ تبدیل به FAQ (#${r.id})`, `utofaq:${r.id}`)]);
  }
  return { text: lines.join('\n'), markup: Markup.inlineKeyboard(buttons) };
}

const faNum = (n: number) => n.toLocaleString('fa-IR');

/** The customer-card lines shown in handoff notifications and /customer. `summary` null = store unavailable. */
export function customerCardLines(
  summary: CustomerSummary | null, customer: { first_seen_at: string | null } | null | undefined, now: Date = new Date(),
): string[] {
  const lines: string[] = [];
  if (summary) {
    if (summary.purchases > 0) {
      lines.push(`🛍 سابقه فروشگاه: ${faNum(summary.purchases)} خرید (${formatPrice(summary.spent)} تومان)` +
        (summary.lastOrderAt ? ` · آخرین: ${formatJalaliDate(summary.lastOrderAt)}` : ''));
    }
    for (const a of summary.active) {
      const ms = a.expiresAt ? parseLocalDateTime(a.expiresAt) : null;
      const tail = a.expiresAt
        ? ` تا ${formatJalaliDate(a.expiresAt)}` + (ms !== null ? ` (${faNum(Math.max(0, Math.ceil((ms - now.getTime()) / 86400000)))} روز مانده)` : '')
        : ' (بدون تاریخ انقضا)';
      lines.push(`✅ اشتراک فعال: ${a.product}${tail}`);
    }
    const parts = [
      summary.pending > 0 ? `⏳ ${faNum(summary.pending)} رسید در انتظار بررسی` : '',
      summary.preparing > 0 ? `🔄 ${faNum(summary.preparing)} سفارش در حال آماده‌سازی` : '',
    ].filter(Boolean);
    if (parts.length) lines.push(parts.join(' · '));
    if (summary.purchases === 0 && summary.pending === 0 && summary.preparing === 0) lines.push('🆕 هنوز از فروشگاه خرید نکرده');
  }
  if (customer?.first_seen_at) lines.push(`👋 اولین پیام به پشتیبانی: ${formatTehran(customer.first_seen_at, false)}`);
  return lines;
}

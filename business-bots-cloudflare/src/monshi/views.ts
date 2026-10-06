import type { MonshiApp } from '../apps';
import { formatTehran } from '../lib/time';
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

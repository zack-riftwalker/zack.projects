import type { Bot } from 'grammy';
import type { StoreApp } from '../../apps';
import { Markup, type InlineButton } from '../../lib/markup';
import { formatJalaliDateTime, tehranDateTime } from '../../lib/time';
import { AUDIENCE_LABEL } from '../audience';
import type { StoreContext } from '../types';

const fa = (n: number) => n.toLocaleString('fa-IR');

function audienceText(audience: string | undefined): string {
  const a = audience ?? 'all';
  if (AUDIENCE_LABEL[a]) return AUDIENCE_LABEL[a];
  const m = /^(buyers|waitlist):(\d+)$/.exec(a);
  if (m) return (m[1] === 'buyers' ? 'خریداران محصول #' : 'لیست انتظار محصول #') + m[2];
  return a;
}

/** The list of announcements waiting for their time (plain text: the texts are the admin's own). */
export async function buildScheduledList(app: StoreApp): Promise<{ text: string; kb: ReturnType<typeof Markup.inlineKeyboard> }> {
  const jobs = await app.db.getScheduledBroadcasts(tehranDateTime(app.apps.now()), 10);
  if (!jobs.length) return { text: '🗓 اطلاعیه‌ی زمان‌بندی‌شده‌ای وجود ندارد.', kb: Markup.inlineKeyboard([]) };
  const lines = ['🗓 اطلاعیه‌های زمان‌بندی‌شده:', ''];
  const rows: InlineButton[][] = [];
  jobs.forEach((j, i) => {
    const snippet = j.text.length > 40 ? j.text.slice(0, 40) + '…' : j.text;
    lines.push(fa(i + 1) + '. ' + formatJalaliDateTime(j.send_after!) + ' — ' + audienceText(j.audience), '   «' + snippet.replace(/\n/g, ' ') + '»');
    rows.push([Markup.button.callback('🗑 لغو ' + fa(i + 1), 'ann_sched_cancel_' + j.id)]);
  });
  return { text: lines.join('\n'), kb: Markup.inlineKeyboard(rows) };
}

export function registerAnnounceScheduleHandler(bot: Bot<StoreContext>, isAdmin: (id: number | undefined) => boolean) {
  bot.callbackQuery(/^ann_sched_cancel_(\d+)$/, async (ctx) => {
    if (!isAdmin(ctx.from?.id)) return ctx.answerCallbackQuery('⛔️ دسترسی ندارید.');
    const cancelled = await ctx.app.db.cancelScheduledBroadcast(parseInt(ctx.match![1], 10), tehranDateTime(ctx.app.apps.now()));
    if (!cancelled) {
      await ctx.answerCallbackQuery({ text: '⚠️ ارسال این اطلاعیه شروع شده و دیگر قابل لغو نیست.', show_alert: true });
      return;
    }
    await ctx.answerCallbackQuery('✅ لغو شد.');
    const { text, kb } = await buildScheduledList(ctx.app);
    await ctx.editMessageText(text, kb).catch(() => {});
  });
}

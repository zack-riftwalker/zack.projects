import type { Bot } from 'grammy';
import { Markup } from '../../lib/markup';
import { formatJalaliDateTime, formatPrice } from '../../lib/time';
import type { PriceSchedule } from '../db';
import type { StoreContext } from '../types';

const faDigits = (s: string) => s.replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);
/** a local Tehran time as «۱۴۰۵/۰۹/۰۵ ۲۰:۰۰» (Persian digits) */
export const jalaliFa = (local: string) => faDigits(formatJalaliDateTime(local));

/** `۱٬۹۸۰٬۰۰۰ ت از ۱۴۰۵/۰۹/۰۵ ۲۰:۰۰ تا ۱۴۰۵/۰۹/۰۷ ۲۳:۵۹ (در انتظار)` */
export function scheduleSummary(s: Pick<PriceSchedule, 'sale_price' | 'starts_at' | 'ends_at' | 'status'> | null | undefined): string {
  if (!s) return '—';
  return formatPrice(s.sale_price) + ' ت از ' + jalaliFa(s.starts_at) + ' تا ' + jalaliFa(s.ends_at) +
    ' (' + (s.status === 'active' ? 'فعال' : 'در انتظار') + ')';
}

/** Admin-only global callback (works mid-wizard: `psched_\w+` is in STAGE_BYPASS_RE). */
export function registerPriceScheduleAdmin(bot: Bot<StoreContext>, isAdmin: (id: number | undefined) => boolean) {
  bot.callbackQuery(/^psched_cancel_(\d+)$/, async (ctx) => {
    if (!isAdmin(ctx.from?.id)) return ctx.answerCallbackQuery('⛔️ دسترسی ندارید.');
    let sch = await ctx.app.db.getScheduleById(parseInt(ctx.match![1], 10));
    if (!sch || (sch.status !== 'pending' && sch.status !== 'active')) {
      await ctx.answerCallbackQuery({ text: '⚠️ این قیمت زمان‌دار دیگر فعال یا در انتظار نیست.', show_alert: true });
      return;
    }
    let result = await ctx.app.db.cancelSchedule(sch);
    if (result === 'gone') {
      // the start may have raced the cancel (pending → active in between): re-read and take the active path
      const fresh = await ctx.app.db.getScheduleById(sch.id);
      if (fresh?.status === 'active') {
        sch = fresh;
        result = await ctx.app.db.cancelSchedule(fresh);
      }
    }
    if (result === 'gone') {
      await ctx.answerCallbackQuery({ text: '⚠️ این قیمت زمان‌دار دیگر فعال یا در انتظار نیست.', show_alert: true });
      return;
    }
    await ctx.answerCallbackQuery('✅ لغو شد.');
    const name = sch.product_name ?? '#' + sch.product_id;
    const text =
      result === 'cancelled' ? '🗑 قیمت زمان‌دار «' + name + '» لغو شد.'
      : result === 'reverted' ? '🗑 جشنواره‌ی «' + name + '» لغو شد؛ قیمت برگشت به ' + formatPrice(sch.normal_price ?? 0) + ' تومان.'
      : '⚠️ جشنواره‌ی «' + name + '» لغو شد، ولی قیمت محصول دستی عوض شده بود؛ برنگرداندم. لطفاً قیمت را خودتان چک کنید.';
    await ctx.editMessageText(text, Markup.inlineKeyboard([[Markup.button.callback('🔙 بازگشت', 'cprod_edit_menu')]])).catch(() => {});
  });
}

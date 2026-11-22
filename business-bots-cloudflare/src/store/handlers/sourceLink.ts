import { WizardScene } from '../../lib/wizard';
import { Markup } from '../../lib/markup';
import { SOURCE_NAME_RE } from '../source';
import type { StoreContext } from '../types';

export const SOURCE_LINK_LABEL = '🔗 لینک منبع';
const CANCEL_KB = Markup.inlineKeyboard([[Markup.button.callback('❌ انصراف', 'srclink_cancel')]]);

/** Asks for a source name and answers with the t.me link; no table is needed — sources exist when customers carry them. */
export const sourceLinkWizard = new WizardScene<StoreContext>(
  'source-link-wizard',

  async (ctx) => {
    await ctx.reply('نام منبع را بنویسید (فقط حروف انگلیسی کوچک و عدد، حداکثر ۲۴ حرف). مثال: partnera', CANCEL_KB);
    return ctx.wizard.next();
  },

  async (ctx) => {
    if (ctx.callbackQuery?.data === 'srclink_cancel') {
      await ctx.answerCallbackQuery().catch(() => {});
      await ctx.editMessageText('❌ لغو شد.').catch(() => {});
      return ctx.scene.leave();
    }
    const name = (ctx.message?.text ?? '').toLowerCase().trim();
    if (!SOURCE_NAME_RE.test(name)) {
      await ctx.reply('⚠️ نام منبع نامعتبر است.');
      return;
    }
    await ctx.reply(
      '✅ لینک منبع «' + name + '»:\nhttps://t.me/' + ctx.me.username + '?start=src_' + name +
      '\n\nمشتری‌هایی که با این لینک برای اولین بار وارد شوند، در گزارش فروش زیر همین منبع می‌آیند.',
    );
    return ctx.scene.leave();
  },
);

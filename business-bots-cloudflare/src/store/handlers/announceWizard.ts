import { WizardScene } from '../../lib/wizard';
import { Markup } from '../../lib/markup';
import { processBroadcastBatch } from '../broadcast';
import type { StoreContext } from '../types';

const CANCEL_KB = Markup.inlineKeyboard([
  [Markup.button.callback('❌ انصراف', 'announce_cancel')],
]);

export const SENDING_TEXT =
  '⏳ در حال ارسال اطلاعیه...' +
  '\n\n📬 ارسال به‌صورت دسته‌ای (حدود ۴۰ نفر در دقیقه) انجام می‌شود و در پایان گزارش برایتان ارسال می‌شود.';

export const announceWizard = new WizardScene<StoreContext>(
  'announce-wizard',

  // STEP 0: Ask for the announcement text.
  async (ctx) => {
    ctx.wizard.state.announce = {};

    await ctx.reply(
      '📢 *ارسال اطلاعیه به مشتریان*\n\n' +
      '〔 مرحله ۱ از ۲ 〕\n\n' +
      'متن اطلاعیه‌ای که می‌خواهید برای همه مشتریان ارسال شود را تایپ کنید:',
      { parse_mode: 'Markdown', ...CANCEL_KB },
    );

    return ctx.wizard.next();
  },

  // STEP 1: Receive the text, show confirmation.
  async (ctx) => {
    if (ctx.callbackQuery?.data === 'announce_cancel') {
      await ctx.answerCallbackQuery();
      await ctx.editMessageText('❌ ارسال اطلاعیه لغو شد.').catch(() => {});
      return ctx.scene.leave();
    }

    if (!ctx.message?.text) {
      await ctx.reply('⚠️ لطفاً متن اطلاعیه را به صورت پیام متنی تایپ کنید.');
      return;
    }

    // Not trimmed — trimming would shift the offsets in ctx.message.entities.
    const text = ctx.message.text;
    if (text.trim().length < 2) {
      await ctx.reply('⚠️ متن اطلاعیه خیلی کوتاه است. دوباره وارد کنید:');
      return;
    }

    const entities = ctx.message.entities || null;
    ctx.wizard.state.announce.text = text;
    ctx.wizard.state.announce.entities = entities;

    await ctx.reply(
      '〔 مرحله ۲ از ۲ 〕\n\n📋 *این پیام برای همه مشتریان ارسال خواهد شد:*',
      { parse_mode: 'Markdown' },
    );

    await ctx.reply(
      text + '\n\nآیا از ارسال آن مطمئن هستید؟',
      {
        entities: entities || undefined,
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback('✅ بله، ارسال کن', 'announce_confirm'),
            Markup.button.callback('❌ خیر، انصراف', 'announce_abort'),
          ],
        ]),
      },
    );

    return ctx.wizard.next();
  },

  // STEP 2: Confirm → enqueue the broadcast and send the first batch.
  async (ctx) => {
    if (!ctx.callbackQuery) {
      await ctx.reply('⚠️ لطفاً یکی از دکمه‌های بالا را انتخاب کنید.');
      return;
    }

    const data = ctx.callbackQuery.data;

    if (data === 'announce_abort') {
      await ctx.answerCallbackQuery('عملیات لغو شد.');
      await ctx.editMessageText('❌ ارسال اطلاعیه لغو شد. پیامی ارسال نشد.').catch(() => {});
      return ctx.scene.leave();
    }

    if (data !== 'announce_confirm') {
      await ctx.answerCallbackQuery('⚠️ انتخاب نامعتبر.');
      return;
    }

    const { text, entities } = ctx.wizard.state.announce;
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(SENDING_TEXT).catch(() => {});

    await ctx.scene.leave();
    await ctx.app.db.enqueueBroadcast({ adminChatId: ctx.chat!.id, text, entities });
    await processBroadcastBatch(ctx.app, { reserve: 8 });
  },
);

const CANCEL_REPLY =
  '❌ *عملیات لغو شد.*\n\n' +
  'برای بازگشت به پنل /panel را بزنید.';

announceWizard.command('cancel', async (ctx) => {
  await ctx.reply(CANCEL_REPLY, { parse_mode: 'Markdown' });
  return ctx.scene.leave();
});

announceWizard.hears(/^(لغو|انصراف|cancel|exit|خروج)$/i, async (ctx) => {
  await ctx.reply(CANCEL_REPLY, { parse_mode: 'Markdown' });
  return ctx.scene.leave();
});

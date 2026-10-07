import { WizardScene } from '../../lib/wizard';
import { Markup } from '../../lib/markup';
import { processBroadcastBatch } from '../broadcast';
import { AUDIENCE_LABEL } from '../audience';
import { escapeMarkdown, productPickerKeyboard } from '../utils';
import type { StoreContext } from '../types';

const CANCEL_KB = Markup.inlineKeyboard([
  [Markup.button.callback('❌ انصراف', 'announce_cancel')],
]);

export const SENDING_TEXT =
  '⏳ در حال ارسال اطلاعیه...' +
  '\n\n📬 ارسال به‌صورت دسته‌ای (حدود ۴۰ نفر در دقیقه) انجام می‌شود و در پایان گزارش برایتان ارسال می‌شود.';

const AUDIENCE_KB = Markup.inlineKeyboard([
  [Markup.button.callback('👥 همه مشتری‌ها', 'ann_aud_all')],
  [Markup.button.callback('✅ اشتراک فعال', 'ann_aud_active')],
  [Markup.button.callback('⌛️ اشتراک تمام‌شده', 'ann_aud_expired')],
  [Markup.button.callback('🛍 خریداران یک محصول', 'ann_aud_buyers')],
  [Markup.button.callback('🆕 هنوز خرید نکرده‌اند', 'ann_aud_never')],
  [Markup.button.callback('❌ انصراف', 'announce_cancel')],
]);

const CANCEL_BTN = Markup.button.callback('❌ انصراف', 'announce_cancel');

export const announceWizard = new WizardScene<StoreContext>(
  'announce-wizard',

  // STEP 0: Ask who should receive the announcement.
  async (ctx) => {
    ctx.wizard.state.announce = {};

    await ctx.reply(
      '📢 *ارسال اطلاعیه به مشتریان*\n\n' +
      '〔 مرحله ۱ از ۳ 〕\n\n' +
      '👥 اطلاعیه برای چه کسانی ارسال شود؟',
      { parse_mode: 'Markdown', ...AUDIENCE_KB },
    );

    return ctx.wizard.next();
  },

  // STEP 1: Receive the audience choice (and the product for «buyers»), then ask for the text.
  async (ctx) => {
    const data = ctx.callbackQuery?.data;
    if (!data) {
      await ctx.reply('⚠️ لطفاً یکی از دکمه‌های بالا را انتخاب کنید.');
      return;
    }
    if (data === 'announce_cancel') {
      await ctx.answerCallbackQuery();
      await ctx.editMessageText('❌ ارسال اطلاعیه لغو شد.').catch(() => {});
      return ctx.scene.leave();
    }

    let audience: string | null = null;
    let label = '';

    if (data === 'ann_aud_buyers' || /^ann_prod_page_\d+$/.test(data)) {
      const page = data === 'ann_aud_buyers' ? 0 : parseInt(data.slice('ann_prod_page_'.length), 10);
      const products = await ctx.app.db.getAllActiveCustomerProducts();
      if (products.length === 0) {
        await ctx.answerCallbackQuery();
        await ctx.editMessageText('⚠️ هیچ محصول فعالی وجود ندارد.').catch(() => {});
        return ctx.scene.leave();
      }
      await ctx.answerCallbackQuery();
      await ctx.editMessageText(
        '🛍 اطلاعیه برای خریداران کدام محصول ارسال شود؟',
        { ...productPickerKeyboard(products, page, 'ann_prod_', 'ann_prod_page_', CANCEL_BTN) },
      ).catch(() => {});
      return;
    }

    const prodMatch = data.match(/^ann_prod_(\d+)$/);
    if (prodMatch) {
      const product = await ctx.app.db.getCustomerProductById(parseInt(prodMatch[1], 10));
      if (!product) {
        await ctx.answerCallbackQuery('❌ این محصول دیگر موجود نیست.');
        return;
      }
      audience = 'buyers:' + product.id;
      label = 'خریداران «' + product.name + '»';
    } else if (/^ann_aud_(all|active|expired|never)$/.test(data)) {
      audience = data.slice('ann_aud_'.length);
      label = AUDIENCE_LABEL[audience];
    }
    if (!audience) {
      await ctx.answerCallbackQuery('⚠️ انتخاب نامعتبر.');
      return;
    }

    const n = await ctx.app.db.countAudience(audience);
    await ctx.answerCallbackQuery();
    if (n === 0) {
      await ctx.editMessageText('⚠️ هیچ مشتری‌ای در این گروه نیست.').catch(() => {});
      return ctx.scene.leave();
    }
    ctx.wizard.state.announce.audience = audience;
    ctx.wizard.state.announce.label = label;
    await ctx.editMessageText('👥 گروه انتخاب‌شده: ' + label + ' (' + n + ' نفر)').catch(() => {});

    await ctx.reply(
      '〔 مرحله ۲ از ۳ 〕\n\n' +
      'متن اطلاعیه‌ای که می‌خواهید برای گروه انتخاب‌شده ارسال شود را تایپ کنید:',
      { parse_mode: 'Markdown', ...CANCEL_KB },
    );
    return ctx.wizard.next();
  },

  // STEP 2: Receive the text, show confirmation.
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

    // members can change while the admin types — count again
    const { audience, label } = ctx.wizard.state.announce;
    const n = await ctx.app.db.countAudience(audience);
    if (n === 0) {
      await ctx.reply('⚠️ هیچ مشتری‌ای در این گروه نیست.');
      return ctx.scene.leave();
    }

    const entities = ctx.message.entities || null;
    ctx.wizard.state.announce.text = text;
    ctx.wizard.state.announce.entities = entities;

    await ctx.reply(
      '〔 مرحله ۳ از ۳ 〕\n\n📋 *این پیام برای ' + n + ' نفر (' + escapeMarkdown(label) + ') ارسال خواهد شد:*',
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

  // STEP 3: Confirm → enqueue the broadcast and send the first batch.
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

    const { text, entities, audience } = ctx.wizard.state.announce;
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(SENDING_TEXT).catch(() => {});

    await ctx.scene.leave();
    await ctx.app.db.enqueueBroadcast({ adminChatId: ctx.chat!.id, text, entities, audience });
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

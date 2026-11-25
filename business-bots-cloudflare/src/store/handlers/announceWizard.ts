import { WizardScene } from '../../lib/wizard';
import { Markup } from '../../lib/markup';
import { processBroadcastBatch } from '../broadcast';
import { AUDIENCE_LABEL } from '../audience';
import { formatJalaliDateTime, parseJalaliDateTime, tehranDateTime } from '../../lib/time';
import { buildScheduledList } from './announceSchedule';
import { CART_REMINDER_KEY } from '../scheduler';
import { escapeMarkdown, productPickerKeyboard } from '../utils';
import type { StoreContext } from '../types';

const CANCEL_KB = Markup.inlineKeyboard([
  [Markup.button.callback('❌ انصراف', 'announce_cancel')],
]);

export const SENDING_TEXT =
  '⏳ در حال ارسال اطلاعیه...' +
  '\n\n📬 ارسال به‌صورت دسته‌ای (حدود ۴۰ نفر در دقیقه) انجام می‌شود و در پایان گزارش برایتان ارسال می‌شود.';

const cartLabel = (on: boolean) => '🛒 یادآوری سبد نیمه‌کاره: ' + (on ? '✅ روشن' : '⛔️ خاموش');

/** The first keyboard doubles as the entry menu: the cart-reminder switch lives at the bottom (CAMPAIGN_PLAN.md §0.5). */
const audienceKb = (cartOn: boolean) => Markup.inlineKeyboard([
  [Markup.button.callback('👥 همه مشتری‌ها', 'ann_aud_all')],
  [Markup.button.callback('✅ اشتراک فعال', 'ann_aud_active')],
  [Markup.button.callback('⌛️ اشتراک تمام‌شده', 'ann_aud_expired')],
  [Markup.button.callback('🛍 خریداران یک محصول', 'ann_aud_buyers')],
  [Markup.button.callback('💎 همه‌ی خریدارها', 'ann_aud_buyers_any')],
  [Markup.button.callback('🆕 هنوز خرید نکرده‌اند', 'ann_aud_never')],
  [Markup.button.callback('🗓 اطلاعیه‌های زمان‌بندی‌شده', 'ann_sched_list')],
  [Markup.button.callback(cartLabel(cartOn), 'ann_cart_toggle')],
  [Markup.button.callback('❌ انصراف', 'announce_cancel')],
]);

const CANCEL_BTN = Markup.button.callback('❌ انصراف', 'announce_cancel');

// the customer's tap opens the product list (storefront's ui_menu_shop)
const SHOP_MARKUP = { inline_keyboard: [[{ text: '🛍 خرید', callback_data: 'ui_menu_shop' }]] };

const confirmKb = (shop: boolean) => Markup.inlineKeyboard([
  [
    Markup.button.callback('✅ بله، ارسال کن', 'announce_confirm'),
    Markup.button.callback('❌ خیر، انصراف', 'announce_abort'),
  ],
  [Markup.button.callback('⏰ زمان‌بندی ارسال', 'announce_schedule')],
  [Markup.button.callback(shop ? '✅ دکمه‌ی «🛍 خرید» زیر پیام هست (برداشتن)' : '➕ دکمه‌ی «🛍 خرید» زیر پیام', 'announce_shop')],
]);

export const announceWizard = new WizardScene<StoreContext>(
  'announce-wizard',

  // STEP 0: Ask who should receive the announcement.
  async (ctx) => {
    ctx.wizard.state.announce = {};

    await ctx.reply(
      '📢 *ارسال اطلاعیه به مشتریان*\n\n' +
      '〔 مرحله ۱ از ۳ 〕\n\n' +
      '👥 اطلاعیه برای چه کسانی ارسال شود؟',
      { parse_mode: 'Markdown', ...audienceKb((await ctx.app.kv.get(CART_REMINDER_KEY)) === '1') },
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

    if (data === 'ann_sched_list') {
      await ctx.answerCallbackQuery();
      const { text, kb } = await buildScheduledList(ctx.app);
      await ctx.reply(text, kb);
      return ctx.scene.leave();
    }

    // the switch flips in place; the admin can still pick an audience afterwards
    if (data === 'ann_cart_toggle') {
      const on = (await ctx.app.kv.get(CART_REMINDER_KEY)) !== '1';
      await ctx.app.kv.set(CART_REMINDER_KEY, on ? '1' : '0');
      await ctx.answerCallbackQuery(on ? '✅ روشن شد' : '⛔️ خاموش شد');
      await ctx.editMessageReplyMarkup(audienceKb(on)).catch(() => {});
      return;
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
    } else if (/^ann_aud_(all|active|expired|never|buyers_any)$/.test(data)) {
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
        ...confirmKb(false),
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

    if (data === 'announce_schedule') {
      await ctx.answerCallbackQuery();
      await ctx.editMessageReplyMarkup(Markup.inlineKeyboard([])).catch(() => {});
      await ctx.reply('⏰ زمان ارسال را بنویسید (به وقت تهران)، مثلاً:\n۱۴۰۵/۰۹/۰۴ ۱۹:۴۵', CANCEL_KB);
      return ctx.wizard.next();
    }

    if (data === 'announce_shop') {
      ctx.wizard.state.announce.shop = !ctx.wizard.state.announce.shop;
      await ctx.answerCallbackQuery(ctx.wizard.state.announce.shop ? '🛍 دکمه‌ی خرید اضافه شد' : 'دکمه‌ی خرید برداشته شد');
      await ctx.editMessageReplyMarkup(confirmKb(ctx.wizard.state.announce.shop)).catch(() => {});
      return;
    }

    if (data !== 'announce_confirm') {
      await ctx.answerCallbackQuery('⚠️ انتخاب نامعتبر.');
      return;
    }

    const { text, entities, audience, shop } = ctx.wizard.state.announce;
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(SENDING_TEXT).catch(() => {});

    await ctx.scene.leave();
    await ctx.app.db.enqueueBroadcast({ adminChatId: ctx.chat!.id, text, entities, audience, replyMarkup: shop ? SHOP_MARKUP : null });
    await processBroadcastBatch(ctx.app, { reserve: 8 });
  },

  // STEP 4 (round 4, §5): the send time of a scheduled announcement
  async (ctx) => {
    if (ctx.callbackQuery?.data === 'announce_cancel') {
      await ctx.answerCallbackQuery();
      await ctx.editMessageText('❌ ارسال اطلاعیه لغو شد.').catch(() => {});
      return ctx.scene.leave();
    }
    if (!ctx.message?.text) {
      await ctx.reply('⚠️ لطفاً زمان را به صورت متن تایپ کنید.');
      return;
    }
    const sendAfter = parseJalaliDateTime(ctx.message.text);
    if (!sendAfter) {
      await ctx.reply('⚠️ زمان نامعتبر است. مثال: ۱۴۰۵/۰۹/۰۴ ۱۹:۴۵');
      return;
    }
    const now = ctx.app.apps.now();
    if (sendAfter <= tehranDateTime(now)) {
      await ctx.reply('⚠️ این زمان گذشته است.');
      return;
    }
    if (sendAfter > tehranDateTime(new Date(now.getTime() + 14 * 86_400_000))) {
      await ctx.reply('⚠️ حداکثر ۱۴ روز جلوتر.');
      return;
    }
    const { text, entities, audience, label, shop } = ctx.wizard.state.announce;
    await ctx.scene.leave();
    await ctx.app.db.enqueueBroadcast({ adminChatId: ctx.chat!.id, text, entities, audience, sendAfter, replyMarkup: shop ? SHOP_MARKUP : null });
    await ctx.reply('✅ اطلاعیه برای ' + formatJalaliDateTime(sendAfter) + ' زمان‌بندی شد (' + label + ').');
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

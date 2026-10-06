import { WizardScene } from '../../lib/wizard';
import { Markup } from '../../lib/markup';
import { escapeMarkdown } from '../utils';
import type { StoreContext } from '../types';

const CANCEL_BTN = Markup.button.callback('❌ انصراف', 'cardset_cancel');
const CANCEL_KB = Markup.inlineKeyboard([[CANCEL_BTN]]);

export function parseCardNumber(text: string): string | null {
  const digits = String(text)
    .replace(/[۰-۹]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0x06f0 + 0x30))
    .replace(/[\s-]/g, '');
  return /^\d{16}$/.test(digits) ? digits : null;
}

export function formatCardNumber(cardNumber: string): string {
  return cardNumber.match(/.{1,4}/g)!.join('-');
}

export const storeSettingsWizard = new WizardScene<StoreContext>(
  'store-settings-wizard',

  // STEP 0: Ask for the card number.
  async (ctx) => {
    const current = await ctx.app.db.getStoreSettings();

    const currentBlock = current
      ? '💳 شماره کارت فعلی: `' + formatCardNumber(current.card_number) + '`\n👤 صاحب فعلی: ' + escapeMarkdown(current.card_holder_name) + '\n\n'
      : '';

    await ctx.reply(
      '💳 *تنظیم شماره کارت فروشگاه*\n\n' +
      currentBlock +
      '〔 مرحله ۱ از ۲ 〕\n\n' +
      '🔢 *شماره کارت جدید* را وارد کنید (۱۶ رقم):',
      { parse_mode: 'Markdown', ...CANCEL_KB },
    );

    return ctx.wizard.next();
  },

  // STEP 1: Receive + validate the card number, ask for the holder name.
  async (ctx) => {
    if (ctx.callbackQuery?.data === 'cardset_cancel') {
      await ctx.answerCallbackQuery();
      await ctx.editMessageText('❌ تنظیم شماره کارت لغو شد.').catch(() => {});
      return ctx.scene.leave();
    }

    if (!ctx.message?.text) {
      await ctx.reply('⚠️ لطفاً شماره کارت را به صورت متن تایپ کنید.');
      return;
    }

    const cardNumber = parseCardNumber(ctx.message.text);
    if (!cardNumber) {
      await ctx.reply('❌ شماره کارت باید دقیقاً ۱۶ رقم باشد. دوباره وارد کنید:');
      return;
    }

    ctx.wizard.state.cardNumber = cardNumber;

    await ctx.reply(
      '〔 مرحله ۲ از ۲ 〕\n\n👤 *نام صاحب کارت* را وارد کنید:',
      { parse_mode: 'Markdown', ...CANCEL_KB },
    );

    return ctx.wizard.next();
  },

  // STEP 2: Receive the holder name, save, confirm.
  async (ctx) => {
    if (ctx.callbackQuery?.data === 'cardset_cancel') {
      await ctx.answerCallbackQuery();
      await ctx.editMessageText('❌ تنظیم شماره کارت لغو شد.').catch(() => {});
      return ctx.scene.leave();
    }

    if (!ctx.message?.text || ctx.message.text.trim().length === 0) {
      await ctx.reply('⚠️ لطفاً نام صاحب کارت را به صورت متن تایپ کنید.');
      return;
    }

    const cardHolderName = ctx.message.text.trim();
    const { cardNumber } = ctx.wizard.state;

    try {
      await ctx.app.db.upsertStoreSettings({ cardNumber, cardHolderName });
    } catch (err: any) {
      console.error('❌ [StoreSettings Wizard] DB save failed:', err.message);
      await ctx.reply('❌ خطا در ذخیره اطلاعات کارت. لطفاً دوباره تلاش کنید.');
      return ctx.scene.leave();
    }

    await ctx.reply(
      '✅ *اطلاعات کارت با موفقیت ذخیره شد.*\n\n' +
      '💳 شماره کارت: `' + formatCardNumber(cardNumber) + '`\n' +
      '👤 صاحب کارت: ' + escapeMarkdown(cardHolderName),
      { parse_mode: 'Markdown' },
    );

    console.log('💳 [StoreSettings] Card info updated.');

    return ctx.scene.leave();
  },
);

const CANCEL_REPLY =
  '❌ *عملیات لغو شد.*\n\n' +
  'برای بازگشت به پنل /panel را بزنید.';

storeSettingsWizard.command('cancel', async (ctx) => {
  await ctx.reply(CANCEL_REPLY, { parse_mode: 'Markdown' });
  return ctx.scene.leave();
});

storeSettingsWizard.hears(/^(لغو|انصراف|cancel|exit|خروج)$/i, async (ctx) => {
  await ctx.reply(CANCEL_REPLY, { parse_mode: 'Markdown' });
  return ctx.scene.leave();
});

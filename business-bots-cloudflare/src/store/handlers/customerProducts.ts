import { WizardScene } from '../../lib/wizard';
import { Markup } from '../../lib/markup';
import {
  escapeMarkdown, formatPrice, parsePrice, ackStrayCallback, MAX_NAME_LENGTH, productPickerKeyboard,
} from '../utils';
import type { StoreContext } from '../types';
import type { CustomerProduct } from '../db';

const DEACT_CANCEL_BTN = Markup.button.callback('❌ انصراف', 'cprod_deact_cancel');

export function deactKeyboard(products: CustomerProduct[], page: number) {
  return productPickerKeyboard(products, page, 'cprod_deact_select_', 'cprod_deact_page_', DEACT_CANCEL_BTN);
}

const ADD_CANCEL_KB = Markup.inlineKeyboard([
  [Markup.button.callback('❌ انصراف', 'cprod_add_cancel')],
]);

const NO_TERMS_KB = Markup.inlineKeyboard([
  [Markup.button.callback('▫️ بدون شرایط و قوانین', 'cprod_add_no_terms')],
  [Markup.button.callback('❌ انصراف', 'cprod_add_cancel')],
]);

const NO_DURATION_KB = Markup.inlineKeyboard([
  [Markup.button.callback('▫️ بدون اشتراک زمان‌دار', 'cprod_add_no_duration')],
  [Markup.button.callback('❌ انصراف', 'cprod_add_cancel')],
]);

const NO_WARRANTY_KB = Markup.inlineKeyboard([
  [Markup.button.callback('▫️ بدون گارانتی', 'cprod_add_no_warranty')],
  [Markup.button.callback('❌ انصراف', 'cprod_add_cancel')],
]);

/** null = valid; otherwise the Persian error text (shared by the add and edit wizards). */
export function productNameError(name: string): string | null {
  if (name.length < 3) return '⚠️ نام محصول باید حداقل ۳ کاراکتر باشد. دوباره وارد کنید:';
  if (name.length > MAX_NAME_LENGTH) return '⚠️ نام محصول نباید بیشتر از ' + MAX_NAME_LENGTH + ' کاراکتر باشد. نام کوتاه‌تری وارد کنید:';
  return null;
}

export function parseDays(text: string): number {
  const normalised = String(text)
    .replace(/[۰-۹]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0x06f0 + 0x30))
    .trim();
  if (!/^\d+$/.test(normalised)) return NaN;
  const val = parseInt(normalised, 10);
  return val > 0 ? val : NaN;
}

async function cancelAdd(ctx: StoreContext) {
  await ctx.answerCallbackQuery();
  await ctx.editMessageText('❌ افزودن محصول لغو شد.').catch(() => {});
  return ctx.scene.leave();
}

export const customerProductsWizard = new WizardScene<StoreContext>(
  'customer-products-wizard',

  // STEP 0: Ask for the product name.
  async (ctx) => {
    ctx.wizard.state.newCustomerProduct = {};

    await ctx.reply(
      '➕ *افزودن محصول جدید به فروشگاه*\n\n' +
      '〔 مرحله ۱ از ۵ 〕\n\n' +
      '📦 *نام محصول* را وارد کنید:',
      { parse_mode: 'Markdown', ...ADD_CANCEL_KB },
    );

    return ctx.wizard.next();
  },

  // STEP 1: Receive the name, ask for the price.
  async (ctx) => {
    if (ctx.callbackQuery?.data === 'cprod_add_cancel') return cancelAdd(ctx);

    if (!ctx.message?.text) {
      await ackStrayCallback(ctx);
      await ctx.reply('⚠️ لطفاً نام محصول را به صورت متن تایپ کنید.');
      return;
    }

    const name = ctx.message.text.trim();
    const nameError = productNameError(name);
    if (nameError) {
      await ctx.reply(nameError);
      return;
    }

    ctx.wizard.state.newCustomerProduct.name = name;

    await ctx.reply(
      '〔 مرحله ۲ از ۵ 〕\n\n' +
      '💰 *قیمت* را به تومان وارد کنید:\n\n' +
      '_مثال: 1200000_',
      { parse_mode: 'Markdown', ...ADD_CANCEL_KB },
    );

    return ctx.wizard.next();
  },

  // STEP 2: Receive the price, ask for the subscription duration (skippable).
  async (ctx) => {
    if (ctx.callbackQuery?.data === 'cprod_add_cancel') return cancelAdd(ctx);

    if (!ctx.message?.text) {
      await ackStrayCallback(ctx);
      await ctx.reply('⚠️ لطفاً قیمت را به صورت عدد وارد کنید.');
      return;
    }

    const price = parsePrice(ctx.message.text);
    if (isNaN(price)) {
      await ctx.reply(
        '❌ *عدد وارد‌شده معتبر نیست.*\n\nلطفاً یک عدد مثبت بدون حروف وارد کنید:',
        { parse_mode: 'Markdown' },
      );
      return;
    }

    ctx.wizard.state.newCustomerProduct.price = price;

    await ctx.reply(
      '〔 مرحله ۳ از ۵ 〕\n\n' +
      '⏳ *مدت اشتراک* این محصول چند روز است؟\n' +
      '(بعد از تحویل، روزشمار و یادآوری پایان اشتراک از روی همین عدد محاسبه می‌شود)\n\n' +
      '_مثال: 30_\n\n' +
      'اگر محصول اشتراک زمان‌دار نیست، دکمه زیر را بزنید:',
      { parse_mode: 'Markdown', ...NO_DURATION_KB },
    );

    return ctx.wizard.next();
  },

  // STEP 3: Receive the duration (or skip), ask for warranty (skippable).
  async (ctx) => {
    const data = ctx.callbackQuery?.data;

    if (data === 'cprod_add_cancel') return cancelAdd(ctx);

    if (data === 'cprod_add_no_duration') {
      await ctx.answerCallbackQuery();
      ctx.wizard.state.newCustomerProduct.durationDays = null;
    } else if (ctx.message?.text) {
      const days = parseDays(ctx.message.text);
      if (isNaN(days)) {
        await ctx.reply('⚠️ لطفاً تعداد روز را به صورت یک عدد صحیح مثبت وارد کنید (مثال: 30)، یا دکمه «بدون اشتراک زمان‌دار» را بزنید.');
        return;
      }
      ctx.wizard.state.newCustomerProduct.durationDays = days;
    } else {
      await ackStrayCallback(ctx);
      await ctx.reply('⚠️ لطفاً تعداد روز اشتراک را تایپ کنید یا دکمه «بدون اشتراک زمان‌دار» را بزنید.');
      return;
    }

    await ctx.reply(
      '〔 مرحله ۴ از ۵ 〕\n\n' +
      '🛡 *مدت گارانتی* این محصول چند روز است؟\n' +
      '(مستقل از مدت اشتراک — تا پایان این مدت، مشتری می‌تواند درخواست گارانتی/جایگزینی بدهد)\n\n' +
      '_مثال: 7_\n\n' +
      'اگر گارانتی ندارد، دکمه زیر را بزنید:',
      { parse_mode: 'Markdown', ...NO_WARRANTY_KB },
    );

    return ctx.wizard.next();
  },

  // STEP 4: Receive the warranty (or skip), ask for terms/conditions text.
  async (ctx) => {
    const data = ctx.callbackQuery?.data;

    if (data === 'cprod_add_cancel') return cancelAdd(ctx);

    if (data === 'cprod_add_no_warranty') {
      await ctx.answerCallbackQuery();
      ctx.wizard.state.newCustomerProduct.warrantyDays = null;
    } else if (ctx.message?.text) {
      const days = parseDays(ctx.message.text);
      if (isNaN(days)) {
        await ctx.reply('⚠️ لطفاً تعداد روز را به صورت یک عدد صحیح مثبت وارد کنید (مثال: 7)، یا دکمه «بدون گارانتی» را بزنید.');
        return;
      }
      ctx.wizard.state.newCustomerProduct.warrantyDays = days;
    } else {
      await ackStrayCallback(ctx);
      await ctx.reply('⚠️ لطفاً تعداد روز گارانتی را تایپ کنید یا دکمه «بدون گارانتی» را بزنید.');
      return;
    }

    await ctx.reply(
      '〔 مرحله ۵ از ۵ 〕\n\n' +
      '📜 *شرایط و قوانین* این محصول را وارد کنید.\n' +
      '(این متن قبل از خرید برای مشتری نمایش داده می‌شود)\n\n' +
      'اگر شرایط خاصی ندارید، دکمه زیر را بزنید:',
      { parse_mode: 'Markdown', ...NO_TERMS_KB },
    );

    return ctx.wizard.next();
  },

  // STEP 5: Receive terms text (or skip), save to DB, confirm.
  async (ctx) => {
    const data = ctx.callbackQuery?.data;

    if (data === 'cprod_add_cancel') return cancelAdd(ctx);

    let termsText: string | null = null;
    let termsEntities: any[] | null = null;
    if (data === 'cprod_add_no_terms') {
      await ctx.answerCallbackQuery();
    } else if (ctx.message?.text && ctx.message.text.trim().length > 0) {
      // Not trimmed when stored — entity offsets are computed against the exact original text.
      termsText = ctx.message.text;
      termsEntities = ctx.message.entities || null;
    } else if (ctx.message?.text) {
      // Whitespace-only text — treated the same as "no terms".
    } else {
      await ackStrayCallback(ctx);
      await ctx.reply('⚠️ لطفاً متن شرایط را تایپ کنید یا دکمه «بدون شرایط» را بزنید.');
      return;
    }

    const { name, price, durationDays, warrantyDays } = ctx.wizard.state.newCustomerProduct;

    try {
      await ctx.app.db.addCustomerProduct({ name, price, termsText, termsEntities, durationDays, warrantyDays });
    } catch (err: any) {
      console.error('❌ [CustomerProducts Wizard] DB insert failed:', err.message);
      await ctx.reply('❌ خطا در ذخیره محصول. لطفاً دوباره تلاش کنید.');
      return ctx.scene.leave();
    }

    // The product is already saved — a failed confirmation must never keep
    // the admin stuck in the wizard (their next message would insert a DUPLICATE).
    try {
      await ctx.reply(
        '🎉 *محصول با موفقیت به فروشگاه اضافه شد!*\n\n' +
        '┌─────────────────────\n' +
        '│ 📦 *نام:* ' + escapeMarkdown(name) + '\n' +
        '│ 💰 قیمت: ' + formatPrice(price) + ' تومان\n' +
        '│ ⏳ مدت اشتراک: ' + (durationDays ? durationDays + ' روز' : 'ندارد') + '\n' +
        '│ 🛡 گارانتی: ' + (warrantyDays ? warrantyDays + ' روز' : 'ندارد') + '\n' +
        '│ 📜 شرایط: ' + (termsText ? 'ثبت شد' : 'ندارد') + '\n' +
        '└─────────────────────',
        { parse_mode: 'Markdown' },
      );
    } catch (err: any) {
      console.error('❌ [CustomerProducts Wizard] Product WAS saved, but confirmation delivery failed:', err.message);
    }

    console.log('🆕 [CustomerProducts] New storefront product added: "' + name + '" | price: ' + price);

    return ctx.scene.leave();
  },
);

export const customerProductsDeactivateWizard = new WizardScene<StoreContext>(
  'customer-products-deactivate-wizard',

  // STEP 0: List active storefront products.
  async (ctx) => {
    const products = await ctx.app.db.getAllActiveCustomerProducts();
    if (products.length === 0) {
      await ctx.reply('✅ هیچ محصول فعالی در فروشگاه وجود ندارد.');
      return ctx.scene.leave();
    }

    await ctx.reply(
      '🗑 *حذف محصول از فروشگاه*\n\n' +
      'محصولی را که می‌خواهید حذف کنید انتخاب کنید:',
      { parse_mode: 'Markdown', ...deactKeyboard(products, 0) },
    );

    return ctx.wizard.next();
  },

  // STEP 1: Receive selection → confirm Yes/No.
  async (ctx) => {
    if (!ctx.callbackQuery) {
      await ctx.reply('⚠️ لطفاً یک محصول را از لیست بالا انتخاب کنید.');
      return;
    }

    const data = ctx.callbackQuery.data!;

    if (data === 'cprod_deact_cancel') {
      await ctx.answerCallbackQuery('عملیات لغو شد.');
      await ctx.editMessageText('❌ عملیات لغو شد.').catch(() => {});
      return ctx.scene.leave();
    }

    const pageMatch = data.match(/^cprod_deact_page_(\d+)$/);
    if (pageMatch) {
      await ctx.answerCallbackQuery();
      const products = await ctx.app.db.getAllActiveCustomerProducts();
      await ctx.editMessageReplyMarkup(
        { reply_markup: deactKeyboard(products, parseInt(pageMatch[1], 10)).reply_markup },
      ).catch(() => {});
      return;
    }

    if (!data.startsWith('cprod_deact_select_')) {
      await ctx.answerCallbackQuery('⚠️ انتخاب نامعتبر.');
      return;
    }

    const productId = parseInt(data.replace('cprod_deact_select_', ''), 10);
    const product = await ctx.app.db.getCustomerProductById(productId);

    if (!product || !product.is_active) {
      await ctx.answerCallbackQuery('❌ محصول یافت نشد!');
      await ctx.editMessageText('❌ خطا: محصول یافت نشد.').catch(() => {});
      return ctx.scene.leave();
    }

    ctx.wizard.state.targetProductId = product.id;
    ctx.wizard.state.targetProductName = product.name;

    await ctx.answerCallbackQuery();
    await ctx.editMessageText(
      '⚠️ *آیا از حذف این محصول مطمئن هستید؟*\n\n📦 ' + escapeMarkdown(product.name),
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback('✅ بله، حذف کن', 'cprod_deact_confirm'),
            Markup.button.callback('❌ خیر، انصراف', 'cprod_deact_abort'),
          ],
        ]),
      },
    ).catch(() => {});

    return ctx.wizard.next();
  },

  // STEP 2: Confirm → deactivate.
  async (ctx) => {
    if (!ctx.callbackQuery) {
      await ctx.reply('⚠️ لطفاً یکی از دکمه‌های بالا را انتخاب کنید.');
      return;
    }

    const data = ctx.callbackQuery.data;

    if (data === 'cprod_deact_abort') {
      await ctx.answerCallbackQuery('عملیات لغو شد.');
      await ctx.editMessageText('❌ عملیات لغو شد. محصول تغییری نکرد.').catch(() => {});
      return ctx.scene.leave();
    }

    if (data !== 'cprod_deact_confirm') {
      await ctx.answerCallbackQuery('⚠️ انتخاب نامعتبر.');
      return;
    }

    const { targetProductId, targetProductName } = ctx.wizard.state;

    try {
      const result = await ctx.app.db.deactivateCustomerProduct(targetProductId);
      if (result.changes === 0) {
        throw new Error('Product not found.');
      }
    } catch (err: any) {
      console.error('❌ [CustomerProductsDeactivate] Failed:', err.message);
      await ctx.answerCallbackQuery('❌ خطا در حذف محصول.');
      await ctx.editMessageText('❌ خطا: عملیات انجام نشد.').catch(() => {});
      return ctx.scene.leave();
    }

    try {
      await ctx.answerCallbackQuery('✅ محصول حذف شد!');
      await ctx.editMessageText('✅ محصول «' + targetProductName + '» با موفقیت حذف شد.');
    } catch (err: any) {
      console.error('❌ [CustomerProductsDeactivate] Product WAS deactivated, but confirmation delivery failed:', err.message);
    }

    console.log('🗑 [CustomerProductsDeactivate] Storefront product "' + targetProductName + '" (ID: ' + targetProductId + ') deactivated.');

    return ctx.scene.leave();
  },
);

const CANCEL_REPLY =
  '❌ *عملیات لغو شد.*\n\n' +
  'برای بازگشت به پنل /panel را بزنید.';

for (const scene of [customerProductsWizard, customerProductsDeactivateWizard]) {
  scene.command('cancel', async (ctx) => {
    await ctx.reply(CANCEL_REPLY, { parse_mode: 'Markdown' });
    return ctx.scene.leave();
  });

  scene.hears(/^(لغو|انصراف|cancel|exit|خروج)$/i, async (ctx) => {
    await ctx.reply(CANCEL_REPLY, { parse_mode: 'Markdown' });
    return ctx.scene.leave();
  });
}

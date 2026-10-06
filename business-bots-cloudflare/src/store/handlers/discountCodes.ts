import type { Bot } from 'grammy';
import { WizardScene } from '../../lib/wizard';
import { Markup, type InlineButton } from '../../lib/markup';
import {
  escapeMarkdown, formatPrice, parsePrice, ackStrayCallback, buildPagedKeyboard,
  parseJalaliDateTime, formatJalaliDateTime, productPickerKeyboard,
} from '../utils';
import type { StoreContext } from '../types';
import type { StoreApp } from '../../apps';
import type { CustomerProduct, DiscountCode } from '../db';

// ─── Shared helpers ────────────────────────────────────────────────────────

export function applyDiscount(price: number, discountCode: DiscountCode): number {
  const raw = discountCode.discount_type === 'percent'
    ? price * (discountCode.discount_value / 100)
    : discountCode.discount_value;
  return Math.max(0, Math.round(price - raw));
}

export const DISCOUNT_ERROR_LABEL: Record<string, string> = {
  not_found: '❌ کد تخفیف نامعتبر است.',
  inactive: '❌ این کد تخفیف غیرفعال شده است.',
  wrong_product: '❌ این کد تخفیف برای این محصول معتبر نیست.',
  expired: '⌛️ این کد تخفیف منقضی شده است.',
  max_uses: '❌ ظرفیت استفاده از این کد تخفیف تمام شده است.',
  already_used: 'ℹ️ شما قبلاً از این کد تخفیف استفاده کرده‌اید.',
  check_failed: '❌ خطا در بررسی کد تخفیف. لطفاً دوباره تلاش کنید.',
};

export type DiscountValidation = { ok: true; discountCode: DiscountCode } | { ok: false; reason: string };

/** active → matches product → not expired → not used by this customer → cap not reached. Fails closed. */
async function validateDiscountCodeRecord(
  app: StoreApp, discountCode: DiscountCode | undefined, productId: number, customerTelegramId: number,
): Promise<DiscountValidation> {
  if (!discountCode) return { ok: false, reason: 'not_found' };
  if (!discountCode.is_active) return { ok: false, reason: 'inactive' };
  if (discountCode.customer_product_id !== productId) return { ok: false, reason: 'wrong_product' };
  if (discountCode.expires_at < (await app.db.nowLocalDateTimeString())) return { ok: false, reason: 'expired' };

  try {
    if (await app.db.hasCustomerRedeemedCode(discountCode.id, customerTelegramId)) {
      return { ok: false, reason: 'already_used' };
    }
    if (discountCode.max_uses !== null &&
        (await app.db.countDiscountCodeRedemptions(discountCode.id)) >= discountCode.max_uses) {
      return { ok: false, reason: 'max_uses' };
    }
  } catch (err: any) {
    console.error('❌ [DiscountCodes] Usage check failed — rejecting code to fail closed:', err.message);
    return { ok: false, reason: 'check_failed' };
  }

  return { ok: true, discountCode };
}

export async function validateDiscountCode(app: StoreApp, codeText: string, productId: number, customerTelegramId: number) {
  return validateDiscountCodeRecord(app, await app.db.getDiscountCodeByCode(codeText), productId, customerTelegramId);
}

export async function validateDiscountCodeForOrder(app: StoreApp, discountCodeId: number, productId: number, customerTelegramId: number) {
  return validateDiscountCodeRecord(app, await app.db.getDiscountCodeById(discountCodeId), productId, customerTelegramId);
}

// ─── Shared wizard step bodies (used by both Add and Edit wizards) ───────────

const DISC_TYPE_PERCENT_ACTION = 'disc_type_percent';
const DISC_TYPE_FIXED_ACTION = 'disc_type_fixed';
const DISC_PROD_SELECT_PREFIX = 'disc_prod_select_';
const DISC_PROD_PAGE_PREFIX = 'disc_prod_page_';
const DISC_MAXUSES_UNLIMITED_ACTION = 'disc_maxuses_unlimited';

function typeSelectKeyboard(cancelBtn: InlineButton) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('٪ درصدی', DISC_TYPE_PERCENT_ACTION),
      Markup.button.callback('💵 مبلغ ثابت', DISC_TYPE_FIXED_ACTION),
    ],
    [cancelBtn],
  ]);
}

function maxUsesKeyboard(cancelBtn: InlineButton) {
  return Markup.inlineKeyboard([
    [Markup.button.callback('♾ نامحدود', DISC_MAXUSES_UNLIMITED_ACTION)],
    [cancelBtn],
  ]);
}

function discProductKeyboard(products: CustomerProduct[], page: number, cancelBtn: InlineButton) {
  return productPickerKeyboard(products, page, DISC_PROD_SELECT_PREFIX, DISC_PROD_PAGE_PREFIX, cancelBtn);
}

async function receiveDiscountType(ctx: StoreContext, stateKey: string): Promise<boolean> {
  const data = ctx.callbackQuery?.data;
  if (data !== DISC_TYPE_PERCENT_ACTION && data !== DISC_TYPE_FIXED_ACTION) {
    await ackStrayCallback(ctx);
    await ctx.reply('⚠️ لطفاً یکی از دو گزینه بالا را انتخاب کنید.');
    return false;
  }
  await ctx.answerCallbackQuery();
  ctx.wizard.state[stateKey].discountType = data === DISC_TYPE_PERCENT_ACTION ? 'percent' : 'fixed';
  return true;
}

async function receiveDiscountValue(ctx: StoreContext, stateKey: string): Promise<boolean> {
  if (!ctx.message?.text) {
    await ackStrayCallback(ctx);
    await ctx.reply('⚠️ لطفاً مقدار تخفیف را به صورت عدد وارد کنید.');
    return false;
  }

  const { discountType } = ctx.wizard.state[stateKey];
  const value = parsePrice(ctx.message.text);
  if (isNaN(value)) {
    await ctx.reply('❌ عدد وارد‌شده معتبر نیست. دوباره وارد کنید:');
    return false;
  }
  if (discountType === 'percent' && value > 100) {
    await ctx.reply('❌ درصد تخفیف نمی‌تواند بیشتر از ۱۰۰ باشد. دوباره وارد کنید:');
    return false;
  }

  ctx.wizard.state[stateKey].discountValue = value;
  return true;
}

async function receiveProductSelection(ctx: StoreContext, stateKey: string, cancelBtn: InlineButton): Promise<'page' | 'retry' | 'leave' | 'ok'> {
  if (!ctx.callbackQuery) {
    await ctx.reply('⚠️ لطفاً یک محصول را از لیست بالا انتخاب کنید.');
    return 'retry';
  }

  const data = ctx.callbackQuery.data!;

  const pageMatch = data.match(new RegExp('^' + DISC_PROD_PAGE_PREFIX + '(\\d+)$'));
  if (pageMatch) {
    await ctx.answerCallbackQuery();
    const products = await ctx.app.db.getAllActiveCustomerProducts();
    await ctx.editMessageReplyMarkup(
      { reply_markup: discProductKeyboard(products, parseInt(pageMatch[1], 10), cancelBtn).reply_markup },
    ).catch(() => {});
    return 'page';
  }

  if (!data.startsWith(DISC_PROD_SELECT_PREFIX)) {
    await ctx.answerCallbackQuery('⚠️ انتخاب نامعتبر.');
    return 'retry';
  }

  const productId = parseInt(data.replace(DISC_PROD_SELECT_PREFIX, ''), 10);
  const product = await ctx.app.db.getCustomerProductById(productId);

  if (!product || !product.is_active) {
    await ctx.answerCallbackQuery('❌ محصول یافت نشد!');
    await ctx.editMessageText('❌ خطا: محصول یافت نشد.').catch(() => {});
    return 'leave';
  }

  ctx.wizard.state[stateKey].customerProductId = product.id;
  ctx.wizard.state[stateKey].productName = product.name;

  await ctx.answerCallbackQuery();
  return 'ok';
}

async function receiveMaxUses(ctx: StoreContext, stateKey: string): Promise<'retry' | 'ok'> {
  const data = ctx.callbackQuery?.data;
  let maxUses: number | null = null;

  if (data === DISC_MAXUSES_UNLIMITED_ACTION) {
    await ctx.answerCallbackQuery();
  } else if (ctx.message?.text) {
    const n = parseInt(ctx.message.text.trim(), 10);
    if (isNaN(n) || n <= 0) {
      await ctx.reply('❌ عدد وارد‌شده معتبر نیست. یک عدد صحیح مثبت وارد کنید، یا دکمه «نامحدود» را بزنید:');
      return 'retry';
    }
    maxUses = n;
  } else {
    await ackStrayCallback(ctx);
    await ctx.reply('⚠️ لطفاً یک عدد وارد کنید یا دکمه «نامحدود» را بزنید.');
    return 'retry';
  }

  ctx.wizard.state[stateKey].maxUses = maxUses;
  return 'ok';
}

// ─── Wizard Scene: Add ────────────────────────────────────────────────────────

const ADD_CANCEL_BTN = Markup.button.callback('❌ انصراف', 'disc_add_cancel');
const ADD_CANCEL_KB = Markup.inlineKeyboard([[ADD_CANCEL_BTN]]);

async function leaveAddCancelled(ctx: StoreContext) {
  await ctx.answerCallbackQuery();
  await ctx.editMessageText('❌ افزودن کد تخفیف لغو شد.').catch(() => {});
  return ctx.scene.leave();
}

export const discountCodeAddWizard = new WizardScene<StoreContext>(
  'discount-code-add-wizard',

  // STEP 0: Ask for the code text.
  async (ctx) => {
    ctx.wizard.state.newDiscountCode = {};

    await ctx.reply(
      '🎟 *افزودن کد تخفیف جدید*\n\n' +
      '〔 مرحله ۱ از ۶ 〕\n\n' +
      '🔤 *کد تخفیف* را وارد کنید (مثلاً SUMMER20):',
      { parse_mode: 'Markdown', ...ADD_CANCEL_KB },
    );

    return ctx.wizard.next();
  },

  // STEP 1: Receive the code, ask for the discount type.
  async (ctx) => {
    if (ctx.callbackQuery?.data === 'disc_add_cancel') return leaveAddCancelled(ctx);

    if (!ctx.message?.text) {
      await ackStrayCallback(ctx);
      await ctx.reply('⚠️ لطفاً کد تخفیف را به صورت متن تایپ کنید.');
      return;
    }

    const code = ctx.message.text.trim().toUpperCase().replace(/\s+/g, '');
    if (code.length < 3 || code.length > 30) {
      await ctx.reply('⚠️ کد باید بین ۳ تا ۳۰ کاراکتر باشد (بدون فاصله). دوباره وارد کنید:');
      return;
    }
    if (await ctx.app.db.getDiscountCodeByCode(code)) {
      await ctx.reply('⚠️ این کد قبلاً ثبت شده است. کد دیگری وارد کنید:');
      return;
    }

    ctx.wizard.state.newDiscountCode.code = code;

    await ctx.reply(
      '〔 مرحله ۲ از ۶ 〕\n\n📐 *نوع تخفیف* را انتخاب کنید:',
      { parse_mode: 'Markdown', ...typeSelectKeyboard(ADD_CANCEL_BTN) },
    );

    return ctx.wizard.next();
  },

  // STEP 2: Receive the type, ask for the discount value.
  async (ctx) => {
    if (ctx.callbackQuery?.data === 'disc_add_cancel') return leaveAddCancelled(ctx);

    const advance = await receiveDiscountType(ctx, 'newDiscountCode');
    if (!advance) return;

    const prompt = ctx.wizard.state.newDiscountCode.discountType === 'percent'
      ? '💰 مقدار تخفیف را به *درصد* وارد کنید (بین ۱ تا ۱۰۰):'
      : '💰 مقدار تخفیف را به *تومان* وارد کنید:';

    await ctx.editMessageText(
      '〔 مرحله ۳ از ۶ 〕\n\n' + prompt,
      { parse_mode: 'Markdown', ...ADD_CANCEL_KB },
    ).catch(() => {});

    return ctx.wizard.next();
  },

  // STEP 3: Receive the value, ask which product this code applies to.
  async (ctx) => {
    if (ctx.callbackQuery?.data === 'disc_add_cancel') return leaveAddCancelled(ctx);

    const advance = await receiveDiscountValue(ctx, 'newDiscountCode');
    if (!advance) return;

    const products = await ctx.app.db.getAllActiveCustomerProducts();
    if (products.length === 0) {
      await ctx.reply('❌ هیچ محصول فعالی در فروشگاه وجود ندارد. ابتدا یک محصول اضافه کنید.');
      return ctx.scene.leave();
    }

    await ctx.reply(
      '〔 مرحله ۴ از ۶ 〕\n\n📦 این کد روی کدام محصول اعمال شود؟',
      { parse_mode: 'Markdown', ...discProductKeyboard(products, 0, ADD_CANCEL_BTN) },
    );

    return ctx.wizard.next();
  },

  // STEP 4: Receive product selection (with pagination), ask for max uses.
  async (ctx) => {
    if (ctx.callbackQuery?.data === 'disc_add_cancel') return leaveAddCancelled(ctx);

    const outcome = await receiveProductSelection(ctx, 'newDiscountCode', ADD_CANCEL_BTN);
    if (outcome === 'page' || outcome === 'retry') return;
    if (outcome === 'leave') return ctx.scene.leave();

    await ctx.editMessageText(
      '〔 مرحله ۵ از ۶ 〕\n\n' +
      '🔢 *سقف تعداد کل استفاده* از این کد را وارد کنید (یک عدد صحیح مثبت)،\n' +
      'یا اگر محدودیتی نمی‌خواهید، دکمه زیر را بزنید:',
      { parse_mode: 'Markdown', ...maxUsesKeyboard(ADD_CANCEL_BTN) },
    ).catch(() => {});

    return ctx.wizard.next();
  },

  // STEP 5: Receive max uses, ask for the expiry date/time.
  async (ctx) => {
    if (ctx.callbackQuery?.data === 'disc_add_cancel') return leaveAddCancelled(ctx);

    const outcome = await receiveMaxUses(ctx, 'newDiscountCode');
    if (outcome === 'retry') return;

    await ctx.reply(
      '〔 مرحله ۶ از ۶ 〕\n\n' +
      '📅 *تاریخ و ساعت انقضا* را وارد کنید (تاریخ شمسی).\n' +
      'مثال: `1404/05/10 14:30`',
      { parse_mode: 'Markdown', ...ADD_CANCEL_KB },
    );

    return ctx.wizard.next();
  },

  // STEP 6: Receive expiry date/time, save to DB, confirm.
  async (ctx) => {
    if (ctx.callbackQuery?.data === 'disc_add_cancel') return leaveAddCancelled(ctx);

    if (!ctx.message?.text) {
      await ackStrayCallback(ctx);
      await ctx.reply('⚠️ لطفاً تاریخ و ساعت انقضا را به صورت متن وارد کنید.');
      return;
    }

    const expiresAt = parseJalaliDateTime(ctx.message.text);
    if (!expiresAt) {
      await ctx.reply(
        '❌ فرمت تاریخ نامعتبر است.\nمثال درست: `1404/05/10 14:30`\nدوباره وارد کنید:',
        { parse_mode: 'Markdown' },
      );
      return;
    }
    if (expiresAt <= (await ctx.app.db.nowLocalDateTimeString())) {
      await ctx.reply('❌ تاریخ انقضا باید در آینده باشد. دوباره وارد کنید:');
      return;
    }

    const { code, discountType, discountValue, customerProductId, productName, maxUses } =
      ctx.wizard.state.newDiscountCode;

    try {
      await ctx.app.db.createDiscountCode({ code, customerProductId, discountType, discountValue, maxUses, expiresAt });
    } catch (err: any) {
      console.error('❌ [DiscountCodes Wizard] DB insert failed:', err.message);
      await ctx.reply('❌ خطا در ذخیره کد تخفیف. لطفاً دوباره تلاش کنید.');
      return ctx.scene.leave();
    }

    try {
      await ctx.reply(
        '🎉 *کد تخفیف با موفقیت ثبت شد!*\n\n' +
        '┌─────────────────────\n' +
        '│ 🔤 کد: ' + escapeMarkdown(code) + '\n' +
        '│ 📦 محصول: ' + escapeMarkdown(productName) + '\n' +
        '│ 📐 نوع: ' + (discountType === 'percent' ? 'درصدی' : 'مبلغ ثابت') + '\n' +
        '│ 💰 مقدار: ' + (discountType === 'percent' ? discountValue + '٪' : formatPrice(discountValue) + ' تومان') + '\n' +
        '│ 🔢 سقف استفاده: ' + (maxUses ?? 'نامحدود') + '\n' +
        '│ 📅 انقضا: ' + formatJalaliDateTime(expiresAt) + '\n' +
        '└─────────────────────',
        { parse_mode: 'Markdown' },
      );
    } catch (err: any) {
      console.error('❌ [DiscountCodes Wizard] Code WAS saved, but confirmation delivery failed:', err.message);
    }

    console.log('🎟 [DiscountCodes] New code "' + code + '" added for product "' + productName + '".');

    return ctx.scene.leave();
  },
);

// ─── Wizard Scene: Edit ───────────────────────────────────────────────────────

const EDIT_CANCEL_BTN = Markup.button.callback('❌ انصراف', 'disc_edit_cancel');

async function leaveEditCancelled(ctx: StoreContext) {
  await ctx.answerCallbackQuery();
  await ctx.editMessageText('❌ ویرایش لغو شد.').catch(() => {});
  return ctx.scene.leave();
}

export const discountCodeEditWizard = new WizardScene<StoreContext>(
  'discount-code-edit-wizard', // entered with { codeId }

  // STEP 0: Load the code, ask for the new discount type.
  async (ctx) => {
    const discountCode = await ctx.app.db.getDiscountCodeById(ctx.wizard.state.codeId);
    if (!discountCode) {
      await ctx.reply('❌ کد تخفیف یافت نشد.');
      return ctx.scene.leave();
    }

    ctx.wizard.state.editDiscountCode = {};

    await ctx.reply(
      '✏️ *ویرایش کد تخفیف* «' + escapeMarkdown(discountCode.code) + '»\n\n' +
      '〔 مرحله ۱ از ۴ 〕\n\n📐 *نوع تخفیف* جدید را انتخاب کنید:',
      { parse_mode: 'Markdown', ...typeSelectKeyboard(EDIT_CANCEL_BTN) },
    );

    return ctx.wizard.next();
  },

  // STEP 1: Receive the type, ask for the discount value.
  async (ctx) => {
    if (ctx.callbackQuery?.data === 'disc_edit_cancel') return leaveEditCancelled(ctx);

    const advance = await receiveDiscountType(ctx, 'editDiscountCode');
    if (!advance) return;

    const prompt = ctx.wizard.state.editDiscountCode.discountType === 'percent'
      ? '💰 مقدار تخفیف را به *درصد* وارد کنید (بین ۱ تا ۱۰۰):'
      : '💰 مقدار تخفیف را به *تومان* وارد کنید:';

    await ctx.editMessageText(
      '〔 مرحله ۲ از ۴ 〕\n\n' + prompt,
      { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[EDIT_CANCEL_BTN]]) },
    ).catch(() => {});

    return ctx.wizard.next();
  },

  // STEP 2: Receive the value, ask which product this code applies to.
  async (ctx) => {
    if (ctx.callbackQuery?.data === 'disc_edit_cancel') return leaveEditCancelled(ctx);

    const advance = await receiveDiscountValue(ctx, 'editDiscountCode');
    if (!advance) return;

    const products = await ctx.app.db.getAllActiveCustomerProducts();
    await ctx.reply(
      '〔 مرحله ۳ از ۴ 〕\n\n📦 این کد روی کدام محصول اعمال شود؟',
      { parse_mode: 'Markdown', ...discProductKeyboard(products, 0, EDIT_CANCEL_BTN) },
    );

    return ctx.wizard.next();
  },

  // STEP 3: Receive product selection (with pagination), ask for max uses.
  async (ctx) => {
    if (ctx.callbackQuery?.data === 'disc_edit_cancel') return leaveEditCancelled(ctx);

    const outcome = await receiveProductSelection(ctx, 'editDiscountCode', EDIT_CANCEL_BTN);
    if (outcome === 'page' || outcome === 'retry') return;
    if (outcome === 'leave') return ctx.scene.leave();

    await ctx.editMessageText(
      '〔 مرحله ۴ از ۴ 〕\n\n' +
      '🔢 *سقف تعداد کل استفاده* از این کد را وارد کنید (یک عدد صحیح مثبت)،\n' +
      'یا اگر محدودیتی نمی‌خواهید، دکمه زیر را بزنید:',
      { parse_mode: 'Markdown', ...maxUsesKeyboard(EDIT_CANCEL_BTN) },
    ).catch(() => {});

    return ctx.wizard.next();
  },

  // STEP 4: Receive max uses, save to DB, confirm.
  async (ctx) => {
    if (ctx.callbackQuery?.data === 'disc_edit_cancel') return leaveEditCancelled(ctx);

    const outcome = await receiveMaxUses(ctx, 'editDiscountCode');
    if (outcome === 'retry') return;

    const { discountType, discountValue, customerProductId, productName } = ctx.wizard.state.editDiscountCode;
    const codeId = ctx.wizard.state.codeId;
    const maxUses = ctx.wizard.state.editDiscountCode.maxUses;

    try {
      const result = await ctx.app.db.updateDiscountCodeDetails(codeId, { discountType, discountValue, customerProductId, maxUses });
      if (result.changes === 0) throw new Error('Discount code not found.');
    } catch (err: any) {
      console.error('❌ [DiscountCodes EditWizard] DB update failed:', err.message);
      await ctx.reply('❌ خطا در ذخیره تغییرات. لطفاً دوباره تلاش کنید.');
      return ctx.scene.leave();
    }

    try {
      await ctx.reply(
        '✅ *کد تخفیف با موفقیت ویرایش شد!*\n\n' +
        '📦 محصول: ' + escapeMarkdown(productName) + '\n' +
        '📐 نوع: ' + (discountType === 'percent' ? 'درصدی' : 'مبلغ ثابت') + '\n' +
        '💰 مقدار: ' + (discountType === 'percent' ? discountValue + '٪' : formatPrice(discountValue) + ' تومان') + '\n' +
        '🔢 سقف استفاده: ' + (maxUses ?? 'نامحدود'),
        { parse_mode: 'Markdown' },
      );
    } catch (err: any) {
      console.error('❌ [DiscountCodes EditWizard] Update WAS saved, but confirmation delivery failed:', err.message);
    }

    console.log('✏️ [DiscountCodes] Code id ' + codeId + ' edited.');

    return ctx.scene.leave();
  },
);

// ─── Wizard Scene: Renew ──────────────────────────────────────────────────────

const RENEW_CANCEL_BTN = Markup.button.callback('❌ انصراف', 'disc_renew_cancel');
const RENEW_CANCEL_KB = Markup.inlineKeyboard([[RENEW_CANCEL_BTN]]);

export const discountCodeRenewWizard = new WizardScene<StoreContext>(
  'discount-code-renew-wizard', // entered with { codeId }

  // STEP 0: Load the code, ask for the new expiry date/time.
  async (ctx) => {
    const discountCode = await ctx.app.db.getDiscountCodeById(ctx.wizard.state.codeId);
    if (!discountCode) {
      await ctx.reply('❌ کد تخفیف یافت نشد.');
      return ctx.scene.leave();
    }

    await ctx.reply(
      '⏳ *تمدید کد تخفیف* «' + escapeMarkdown(discountCode.code) + '»\n\n' +
      'انقضای فعلی: ' + formatJalaliDateTime(discountCode.expires_at) + '\n\n' +
      '📅 تاریخ و ساعت انقضای جدید را وارد کنید:\n' +
      'مثال: `1404/06/01 20:00`',
      { parse_mode: 'Markdown', ...RENEW_CANCEL_KB },
    );

    return ctx.wizard.next();
  },

  // STEP 1: Receive the new expiry, save, confirm.
  async (ctx) => {
    if (ctx.callbackQuery?.data === 'disc_renew_cancel') {
      await ctx.answerCallbackQuery();
      await ctx.editMessageText('❌ تمدید لغو شد.').catch(() => {});
      return ctx.scene.leave();
    }

    if (!ctx.message?.text) {
      await ackStrayCallback(ctx);
      await ctx.reply('⚠️ لطفاً تاریخ و ساعت انقضای جدید را به صورت متن وارد کنید.');
      return;
    }

    const expiresAt = parseJalaliDateTime(ctx.message.text);
    if (!expiresAt) {
      await ctx.reply(
        '❌ فرمت تاریخ نامعتبر است.\nمثال درست: `1404/06/01 20:00`\nدوباره وارد کنید:',
        { parse_mode: 'Markdown' },
      );
      return;
    }
    if (expiresAt <= (await ctx.app.db.nowLocalDateTimeString())) {
      await ctx.reply('❌ تاریخ انقضا باید در آینده باشد. دوباره وارد کنید:');
      return;
    }

    const codeId = ctx.wizard.state.codeId;

    try {
      const result = await ctx.app.db.renewDiscountCode(codeId, expiresAt);
      if (result.changes === 0) throw new Error('Discount code not found.');
    } catch (err: any) {
      console.error('❌ [DiscountCodes RenewWizard] DB update failed:', err.message);
      await ctx.reply('❌ خطا در تمدید کد تخفیف. لطفاً دوباره تلاش کنید.');
      return ctx.scene.leave();
    }

    try {
      await ctx.reply(
        '✅ کد تخفیف تمدید شد.\n📅 انقضای جدید: ' + formatJalaliDateTime(expiresAt),
        { parse_mode: 'Markdown' },
      );
    } catch (err: any) {
      console.error('❌ [DiscountCodes RenewWizard] Renew WAS saved, but confirmation delivery failed:', err.message);
    }

    console.log('⏳ [DiscountCodes] Code id ' + codeId + ' renewed until ' + expiresAt + '.');

    return ctx.scene.leave();
  },
);

// ─── List / Detail / Delete (stateless action handlers) ──────────────────────

const DISC_LIST_CANCEL_BTN = Markup.button.callback('❌ بستن', 'cprod_disc_close');

function discListButton(c: DiscountCode): InlineButton {
  const statusIcon = c.is_active ? '✅' : '⛔️';
  return Markup.button.callback(statusIcon + ' ' + c.code, 'cprod_disc_view_' + c.id);
}

function discListKeyboard(codes: DiscountCode[], page: number) {
  return buildPagedKeyboard(codes, page, discListButton, 'cprod_disc_page_', DISC_LIST_CANCEL_BTN);
}

const NO_ACCESS = '⛔️ دسترسی ندارید.';

export function registerDiscountCodeHandler(bot: Bot<StoreContext>, isAdmin: (id: number | undefined) => boolean) {
  bot.callbackQuery('cprod_disc_add', async (ctx) => {
    if (!isAdmin(ctx.from?.id)) return ctx.answerCallbackQuery(NO_ACCESS);
    await ctx.answerCallbackQuery();
    await ctx.scene.enter('discount-code-add-wizard');
  });

  bot.callbackQuery('cprod_disc_list', async (ctx) => {
    if (!isAdmin(ctx.from?.id)) return ctx.answerCallbackQuery(NO_ACCESS);
    await ctx.answerCallbackQuery();

    const codes = await ctx.app.db.getAllDiscountCodes();
    if (codes.length === 0) {
      await ctx.editMessageText('🎟 هیچ کد تخفیفی ثبت نشده است.').catch(() => {});
      return;
    }

    await ctx.editMessageText(
      '🎟 *لیست کدهای تخفیف*\n\nیک کد را برای مشاهده جزئیات انتخاب کنید:',
      { parse_mode: 'Markdown', ...discListKeyboard(codes, 0) },
    ).catch(() => {});
  });

  bot.callbackQuery(/^cprod_disc_page_(\d+)$/, async (ctx) => {
    // callback data is forgeable — without this a customer could list every discount code
    if (!isAdmin(ctx.from?.id)) return ctx.answerCallbackQuery(NO_ACCESS);
    await ctx.answerCallbackQuery();
    const codes = await ctx.app.db.getAllDiscountCodes();
    await ctx.editMessageReplyMarkup(
      { reply_markup: discListKeyboard(codes, parseInt(ctx.match![1], 10)).reply_markup },
    ).catch(() => {});
  });

  bot.callbackQuery('cprod_disc_close', async (ctx) => {
    if (!isAdmin(ctx.from?.id)) return ctx.answerCallbackQuery(NO_ACCESS);
    await ctx.answerCallbackQuery();
    await ctx.editMessageText('🎟 بسته شد.').catch(() => {});
  });

  bot.callbackQuery(/^cprod_disc_view_(\d+)$/, async (ctx) => {
    if (!isAdmin(ctx.from?.id)) return ctx.answerCallbackQuery(NO_ACCESS);

    const id = parseInt(ctx.match![1], 10);
    const discountCode = await ctx.app.db.getDiscountCodeById(id);
    if (!discountCode) {
      await ctx.answerCallbackQuery('❌ کد یافت نشد.');
      return;
    }

    const product = await ctx.app.db.getCustomerProductById(discountCode.customer_product_id);
    const used = await ctx.app.db.countDiscountCodeRedemptions(id);

    await ctx.answerCallbackQuery();
    await ctx.editMessageText(
      '🎟 *' + escapeMarkdown(discountCode.code) + '*\n\n' +
      '📦 محصول: ' + escapeMarkdown(product ? product.name : '؟') + '\n' +
      '📐 نوع: ' + (discountCode.discount_type === 'percent' ? 'درصدی' : 'مبلغ ثابت') + '\n' +
      '💰 مقدار: ' + (discountCode.discount_type === 'percent' ? discountCode.discount_value + '٪' : formatPrice(discountCode.discount_value) + ' تومان') + '\n' +
      '🔢 استفاده‌شده: ' + used + ' از ' + (discountCode.max_uses ?? 'نامحدود') + '\n' +
      '📅 انقضا: ' + formatJalaliDateTime(discountCode.expires_at) + '\n' +
      '📌 وضعیت: ' + (discountCode.is_active ? 'فعال' : 'غیرفعال'),
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback('✏️ ویرایش', 'cprod_disc_edit_' + id),
            Markup.button.callback('⏳ تمدید', 'cprod_disc_renew_' + id),
          ],
          [Markup.button.callback('🗑 حذف', 'cprod_disc_del_' + id)],
          [Markup.button.callback('🔙 بازگشت به لیست', 'cprod_disc_list')],
        ]),
      },
    ).catch(() => {});
  });

  bot.callbackQuery(/^cprod_disc_edit_(\d+)$/, async (ctx) => {
    if (!isAdmin(ctx.from?.id)) return ctx.answerCallbackQuery(NO_ACCESS);
    const id = parseInt(ctx.match![1], 10);
    await ctx.answerCallbackQuery();
    await ctx.scene.enter('discount-code-edit-wizard', { codeId: id });
  });

  bot.callbackQuery(/^cprod_disc_renew_(\d+)$/, async (ctx) => {
    if (!isAdmin(ctx.from?.id)) return ctx.answerCallbackQuery(NO_ACCESS);
    const id = parseInt(ctx.match![1], 10);
    await ctx.answerCallbackQuery();
    await ctx.scene.enter('discount-code-renew-wizard', { codeId: id });
  });

  bot.callbackQuery(/^cprod_disc_del_(\d+)$/, async (ctx) => {
    if (!isAdmin(ctx.from?.id)) return ctx.answerCallbackQuery(NO_ACCESS);

    const id = parseInt(ctx.match![1], 10);
    const discountCode = await ctx.app.db.getDiscountCodeById(id);
    if (!discountCode) {
      await ctx.answerCallbackQuery('❌ کد یافت نشد.');
      return;
    }

    await ctx.answerCallbackQuery();
    await ctx.editMessageText(
      '⚠️ *آیا از حذف کد تخفیف «' + escapeMarkdown(discountCode.code) + '» مطمئن هستید؟*',
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([[
          Markup.button.callback('✅ بله، حذف کن', 'cprod_disc_del_confirm_' + id),
          Markup.button.callback('❌ خیر، انصراف', 'cprod_disc_del_abort_' + id),
        ]]),
      },
    ).catch(() => {});
  });

  bot.callbackQuery(/^cprod_disc_del_confirm_(\d+)$/, async (ctx) => {
    if (!isAdmin(ctx.from?.id)) return ctx.answerCallbackQuery(NO_ACCESS);

    const id = parseInt(ctx.match![1], 10);
    try {
      const result = await ctx.app.db.deactivateDiscountCode(id);
      if (result.changes === 0) throw new Error('Discount code not found.');
    } catch (err: any) {
      console.error('❌ [DiscountCodes] Deactivate failed:', err.message);
      await ctx.answerCallbackQuery('❌ خطا در حذف.');
      await ctx.editMessageText('❌ خطا: عملیات انجام نشد.').catch(() => {});
      return;
    }

    await ctx.answerCallbackQuery('✅ کد حذف شد!');
    await ctx.editMessageText('✅ کد تخفیف با موفقیت حذف شد.').catch(() => {});

    console.log('🗑 [DiscountCodes] Code id ' + id + ' deactivated.');
  });

  bot.callbackQuery(/^cprod_disc_del_abort_(\d+)$/, async (ctx) => {
    if (!isAdmin(ctx.from?.id)) return ctx.answerCallbackQuery(NO_ACCESS);
    await ctx.answerCallbackQuery('انصراف داده شد.');
    await ctx.editMessageText('❌ عملیات لغو شد. کد تغییری نکرد.').catch(() => {});
  });
}

const CANCEL_REPLY =
  '❌ *عملیات لغو شد.*\n\n' +
  'برای بازگشت به پنل /panel را بزنید.';

for (const scene of [discountCodeAddWizard, discountCodeEditWizard, discountCodeRenewWizard]) {
  scene.command('cancel', async (ctx) => {
    await ctx.reply(CANCEL_REPLY, { parse_mode: 'Markdown' });
    return ctx.scene.leave();
  });

  scene.hears(/^(لغو|انصراف|cancel|exit|خروج)$/i, async (ctx) => {
    await ctx.reply(CANCEL_REPLY, { parse_mode: 'Markdown' });
    return ctx.scene.leave();
  });
}

import { WizardScene } from '../../lib/wizard';
import { Markup } from '../../lib/markup';
import { formatPrice, productPickerKeyboard, formatJalaliDate, parseLocalDateTime } from '../utils';
import { isAdminId } from '../config';
import { MANUAL_PURCHASE_LABEL } from '../labels';
import { adminPanelKeyboard } from './adminPanel';
import { customerStorefrontKeyboard } from './storefront';
import type { StoreContext } from '../types';
import type { CustomerProduct, Order } from '../db';

export { MANUAL_PURCHASE_LABEL };

const PRODUCT_PREFIX = 'manual_prod_';
const PAGE_PREFIX = 'manual_prod_page_';
const CONFIRM_ACTION = 'manual_purchase_confirm';
const CANCEL_ACTION = 'manual_purchase_cancel';
const CANCEL_BUTTON = Markup.button.callback('❌ انصراف', CANCEL_ACTION);

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function createActivationToken(): Promise<{ rawToken: string; tokenHash: string }> {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const rawToken = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return { rawToken, tokenHash: await sha256Hex(rawToken) };
}

export function buildManualPurchaseLink(botUsername: string, rawToken: string): string {
  return 'https://t.me/' + botUsername + '?start=mp_' + rawToken;
}

function activatedPurchaseText(order: Order, alreadyClaimed: boolean): string {
  const lines = [
    alreadyClaimed ? 'ℹ️ این خرید قبلاً فعال شده است.' : '✅ خرید شما با موفقیت فعال شد.',
    '',
    '📦 محصول: ' + order.product_name,
    '📅 شروع اشتراک: ' + formatJalaliDate(order.delivered_at!),
  ];

  if (order.expires_at) {
    const expiresMs = parseLocalDateTime(order.expires_at);
    const daysLeft = expiresMs === null ? null : Math.ceil((expiresMs - Date.now()) / 86400000);
    if (daysLeft !== null && daysLeft > 0) {
      lines.push('⏱ ' + daysLeft + ' روز باقی مانده (تا ' + formatJalaliDate(order.expires_at) + ')');
    } else {
      lines.push('⛔️ اشتراک در تاریخ ' + formatJalaliDate(order.expires_at) + ' منقضی شده است.');
    }
  } else {
    lines.push('⏱ این محصول محدودیت زمانی ندارد.');
  }

  if (order.warranty_expires_at) {
    const warrantyMs = parseLocalDateTime(order.warranty_expires_at);
    lines.push(warrantyMs !== null && warrantyMs > Date.now()
      ? '🛡 گارانتی تا ' + formatJalaliDate(order.warranty_expires_at)
      : '🛡 گارانتی منقضی شده است.');
  } else {
    lines.push('🛡 این محصول گارانتی ندارد.');
  }

  lines.push('', 'از دکمه «اشتراک‌های من» می‌توانید وضعیت اشتراک را هر زمان بررسی کنید.');
  return lines.join('\n');
}

/**
 * Consumes `mp_...` /start payloads and attaches the snapshotted purchase to
 * the first non-admin Telegram customer who opens the one-time link.
 * @returns true when the payload belonged to this feature
 */
export async function handleManualPurchaseStart(ctx: StoreContext, payload: string): Promise<boolean> {
  if (!payload.startsWith('mp_')) return false;

  const match = payload.match(/^mp_([A-Za-z0-9_-]{43})$/);
  if (isAdminId(ctx.app.cfg, ctx.from?.id)) {
    await ctx.reply('⛔️ این لینک مخصوص فعال‌سازی مشتری است و توسط ادمین قابل استفاده نیست.', adminPanelKeyboard());
    return true;
  }

  if (!match) {
    await ctx.reply('❌ لینک فعال‌سازی نامعتبر است. لطفاً لینک صحیح را از پشتیبانی دریافت کنید.', customerStorefrontKeyboard());
    return true;
  }

  const tokenHash = await sha256Hex(match[1]);
  let result;
  try {
    result = await ctx.app.db.redeemManualPurchaseClaim({
      tokenHash,
      customerTelegramId: ctx.from!.id,
      displayName: ctx.from!.first_name || ctx.from!.username || String(ctx.from!.id),
    });
  } catch (err: any) {
    console.error('❌ [ManualPurchase] Redemption failed for customer ' + ctx.from!.id + ':', err.message);
    await ctx.reply('❌ فعال‌سازی با خطا مواجه شد. لطفاً با پشتیبانی تماس بگیرید.', customerStorefrontKeyboard());
    return true;
  }

  if (result.outcome === 'invalid') {
    await ctx.reply('❌ لینک فعال‌سازی نامعتبر است. لطفاً لینک صحیح را از پشتیبانی دریافت کنید.', customerStorefrontKeyboard());
    return true;
  }
  if (result.outcome === 'claimed_by_other') {
    console.warn('⚠️ [ManualPurchase] Already-used link opened by customer ' + ctx.from!.id + '.');
    await ctx.reply('❌ این لینک دیگر قابل استفاده نیست. لطفاً با پشتیبانی تماس بگیرید.', customerStorefrontKeyboard());
    return true;
  }

  await ctx.reply(
    activatedPurchaseText(result.order!, result.outcome === 'already_claimed'),
    customerStorefrontKeyboard(),
  );
  console.log(
    '🛒 [ManualPurchase] Order #' + result.order!.id +
    (result.outcome === 'claimed' ? ' activated' : ' reopened') +
    ' by customer ' + ctx.from!.id + '.',
  );
  return true;
}

function productKeyboard(products: CustomerProduct[], page = 0) {
  return productPickerKeyboard(products, page, PRODUCT_PREFIX, PAGE_PREFIX, CANCEL_BUTTON);
}

function productSummary(product: CustomerProduct): string {
  return [
    '🛒 ثبت خرید مشتری',
    '',
    '📦 محصول: ' + product.name,
    '💰 قیمت: ' + formatPrice(product.price) + ' تومان',
    '⏳ مدت اشتراک: ' + (product.duration_days ? product.duration_days + ' روز' : 'بدون محدودیت زمانی'),
    '🛡 مدت گارانتی: ' + (product.warranty_days ? product.warranty_days + ' روز' : 'بدون گارانتی'),
    '',
    '⚠️ زمان اشتراک از لحظه تأیید شما شروع می‌شود، نه از زمان باز کردن لینک توسط مشتری.',
    '',
    'آیا خرید ثبت شود؟',
  ].join('\n');
}

export const manualPurchaseWizard = new WizardScene<StoreContext>(
  'manual-purchase-wizard',

  async (ctx) => {
    if (!isAdminId(ctx.app.cfg, ctx.from?.id)) {
      await ctx.reply('⛔️ دسترسی ندارید.');
      return ctx.scene.leave();
    }

    const products = await ctx.app.db.getAllActiveCustomerProducts();
    if (products.length === 0) {
      await ctx.reply('⚠️ محصول فعالی برای ثبت خرید وجود ندارد. ابتدا از پنل مدیریت یک محصول فعال اضافه کنید.');
      return ctx.scene.leave();
    }

    const token = await createActivationToken();
    ctx.wizard.state.manualPurchase = {
      creationKey: crypto.randomUUID(),
      rawToken: token.rawToken,
      tokenHash: token.tokenHash,
      productId: null,
    };

    await ctx.reply(
      '🛒 ثبت خرید مشتری\n\nمحصولی را که مشتری خارج از ربات خریده انتخاب کنید:',
      productKeyboard(products, 0),
    );
    return ctx.wizard.next();
  },

  async (ctx) => {
    if (!isAdminId(ctx.app.cfg, ctx.from?.id)) {
      await ctx.reply('⛔️ دسترسی ندارید.');
      return ctx.scene.leave();
    }

    const data = ctx.callbackQuery?.data;
    const draft = ctx.wizard.state.manualPurchase;
    if (!draft) {
      await ctx.reply('⚠️ اطلاعات این عملیات از بین رفته است. لطفاً دوباره از پنل شروع کنید.');
      return ctx.scene.leave();
    }

    if (data === CANCEL_ACTION) {
      await ctx.answerCallbackQuery().catch(() => {});
      await ctx.editMessageText('❌ ثبت خرید مشتری لغو شد.').catch(() => {});
      return ctx.scene.leave();
    }

    const pageMatch = data?.match(/^manual_prod_page_(\d+)$/);
    if (pageMatch) {
      await ctx.answerCallbackQuery().catch(() => {});
      const products = await ctx.app.db.getAllActiveCustomerProducts();
      await ctx.editMessageReplyMarkup(
        { reply_markup: productKeyboard(products, parseInt(pageMatch[1], 10)).reply_markup },
      ).catch(() => {});
      return;
    }

    const productMatch = data?.match(/^manual_prod_(\d+)$/);
    if (productMatch) {
      const product = await ctx.app.db.getCustomerProductById(parseInt(productMatch[1], 10));
      if (!product?.is_active) {
        await ctx.answerCallbackQuery({ text: '❌ این محصول دیگر فعال نیست.', show_alert: true }).catch(() => {});
        return ctx.scene.leave();
      }

      draft.productId = product.id;
      await ctx.answerCallbackQuery().catch(() => {});
      await ctx.editMessageText(productSummary(product), {
        ...Markup.inlineKeyboard([[
          Markup.button.callback('✅ تأیید و ساخت لینک', CONFIRM_ACTION),
          CANCEL_BUTTON,
        ]]),
      }).catch(() => {});
      return;
    }

    if (data === CONFIRM_ACTION) {
      const product = await ctx.app.db.getCustomerProductById(draft.productId);
      if (!product?.is_active) {
        await ctx.answerCallbackQuery({ text: '❌ این محصول دیگر فعال نیست.', show_alert: true }).catch(() => {});
        await ctx.editMessageText('❌ محصول انتخاب‌شده غیرفعال شده است. دوباره از پنل شروع کنید.').catch(() => {});
        return ctx.scene.leave();
      }

      let claim;
      try {
        claim = await ctx.app.db.createManualPurchaseClaim({
          creationKey: draft.creationKey,
          tokenHash: draft.tokenHash,
          customerProductId: draft.productId,
          approvedBy: ctx.from!.id,
        });
      } catch (err: any) {
        console.error('❌ [ManualPurchase] Claim creation failed:', err.message);
        await ctx.answerCallbackQuery({ text: '❌ ثبت خرید ناموفق بود.', show_alert: true }).catch(() => {});
        return;
      }

      const botUsername = ctx.me?.username;
      if (!botUsername) {
        console.error('❌ [ManualPurchase] Bot username is unavailable for claim #' + claim.id + '.');
        await ctx.answerCallbackQuery({ text: '❌ نام کاربری ربات در دسترس نیست.', show_alert: true }).catch(() => {});
        return;
      }

      const link = buildManualPurchaseLink(botUsername, draft.rawToken);
      const shareUrl = 'https://t.me/share/url?url=' + encodeURIComponent(link) +
        '&text=' + encodeURIComponent('برای فعال‌سازی خریدتان، این لینک را باز کنید:');

      await ctx.answerCallbackQuery('✅ خرید ثبت شد.').catch(() => {});
      await ctx.editMessageText('✅ خرید دستی «' + claim.product_name + '» ثبت شد و زمان اشتراک از همین لحظه آغاز شد.').catch(() => {});
      await ctx.reply(
        '🔗 لینک یک‌بارمصرف فعال‌سازی مشتری:\n\n' + link +
        '\n\nاین لینک را فقط برای همان مشتری ارسال کنید.',
        Markup.inlineKeyboard([[
          Markup.button.url('📤 ارسال برای مشتری', shareUrl),
        ]]),
      );
      console.log('🛒 [ManualPurchase] Claim #' + claim.id + ' created by admin ' + ctx.from!.id + '.');
      return ctx.scene.leave();
    }

    if (ctx.callbackQuery) await ctx.answerCallbackQuery().catch(() => {});
    await ctx.reply('⚠️ لطفاً یک محصول را انتخاب کنید یا عملیات را لغو کنید.');
  },
);

const CANCEL_REPLY = '❌ ثبت خرید مشتری لغو شد. برای بازگشت به پنل /panel را بزنید.';
manualPurchaseWizard.command('cancel', async (ctx) => {
  await ctx.reply(CANCEL_REPLY);
  return ctx.scene.leave();
});
manualPurchaseWizard.hears(/^(لغو|انصراف|cancel|exit|خروج)$/i, async (ctx) => {
  await ctx.reply(CANCEL_REPLY);
  return ctx.scene.leave();
});

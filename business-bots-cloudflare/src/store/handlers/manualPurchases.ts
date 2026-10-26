import { WizardScene } from '../../lib/wizard';
import { Markup } from '../../lib/markup';
import { formatPrice, productPickerKeyboard, formatJalaliDate, parseLocalDateTime } from '../utils';
import { isAdminId } from '../config';
import { MANUAL_PURCHASE_LABEL } from '../labels';
import { adminPanelKeyboard } from './adminPanel';
import { customerKeyboard } from './storefront';
import { onPurchaseConfirmed } from '../referrals';
import { tehranDateTime } from '../../lib/time';
import { buildPagedKeyboard } from '../utils';
import { deliverToCustomer, isSupplierOption, kickSupplierOrder, queueSupplierOrder, raiseNeedsAction, sourceSummary, DEADLINE_HOURS } from '../suppliers/engine';
import { parseContent } from '../suppliers/format';
import { availableStockFor, loadAccount } from '../suppliers/stockCards';
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

export const PREPARING_TEXT = '⏳ اکانت شما در حال آماده‌سازی است و همین‌جا برایتان ارسال می‌شود (حداکثر تا ۲۴ ساعت).';

function activatedPurchaseText(order: Order, alreadyClaimed: boolean): string {
  // a supplier-fulfilled link: nothing is delivered yet, so the clocks have not started
  if (order.fulfillment === 'supplier' && order.status === 'confirmed') {
    return [
      alreadyClaimed ? 'ℹ️ این خرید قبلاً فعال شده است.' : '✅ خرید شما با موفقیت ثبت شد.',
      '',
      '📦 محصول: ' + order.product_name,
      PREPARING_TEXT,
    ].join('\n');
  }
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
    await ctx.reply('❌ لینک فعال‌سازی نامعتبر است. لطفاً لینک صحیح را از پشتیبانی دریافت کنید.', await customerKeyboard(ctx.app));
    return true;
  }

  const tokenHash = await sha256Hex(match[1]);
  let result;
  try {
    result = await ctx.app.db.redeemManualPurchaseClaim({
      tokenHash,
      customerTelegramId: ctx.from!.id,
      displayName: ctx.from!.first_name || ctx.from!.username || String(ctx.from!.id),
      supplierDeadlineAt: tehranDateTime(new Date(ctx.app.apps.now().getTime() + DEADLINE_HOURS * 3_600_000)),
    });
  } catch (err: any) {
    console.error('❌ [ManualPurchase] Redemption failed for customer ' + ctx.from!.id + ':', err.message);
    await ctx.reply('❌ فعال‌سازی با خطا مواجه شد. لطفاً با پشتیبانی تماس بگیرید.', await customerKeyboard(ctx.app));
    return true;
  }

  if (result.outcome === 'invalid') {
    await ctx.reply('❌ لینک فعال‌سازی نامعتبر است. لطفاً لینک صحیح را از پشتیبانی دریافت کنید.', await customerKeyboard(ctx.app));
    return true;
  }
  if (result.outcome === 'claimed_by_other') {
    console.warn('⚠️ [ManualPurchase] Already-used link opened by customer ' + ctx.from!.id + '.');
    await ctx.reply('❌ این لینک دیگر قابل استفاده نیست. لطفاً با پشتیبانی تماس بگیرید.', await customerKeyboard(ctx.app));
    return true;
  }

  if (result.outcome === 'claimed') {
    try {
      await onPurchaseConfirmed(ctx.app, result.order!);
    } catch (err: any) {
      console.error('❌ [ManualPurchase] Referral qualification failed:', err.message);
    }
  }

  await ctx.reply(
    activatedPurchaseText(result.order!, result.outcome === 'already_claimed'),
    await customerKeyboard(ctx.app),
  );
  if (result.outcome === 'claimed') await startLinkFulfillment(ctx, result.order!, result.claim);
  console.log(
    '🛒 [ManualPurchase] Order #' + result.order!.id +
    (result.outcome === 'claimed' ? ' activated' : ' reopened') +
    ' by customer ' + ctx.from!.id + '.',
  );
  return true;
}

/**
 * After a link was claimed (SUPPLIER_PLAN.md §10.3): 'stock' sends the reserved account (the order is already
 * delivered), 'supplier' starts the purchase the admin approved when the link was created. Never throws.
 */
async function startLinkFulfillment(
  ctx: StoreContext, order: Order, claim: { fulfillment: string | null; stock_account_id: number | null; approved_by: number } | null,
): Promise<void> {
  try {
    if (claim?.fulfillment === 'stock' && claim.stock_account_id) {
      const account = await loadAccount(ctx.app, claim.stock_account_id);
      const content = account ? parseContent(account.content_json) : null;
      if (!account || !content) {
        await raiseNeedsAction(ctx.app, order.id, 'send_failed');
        return;
      }
      await deliverToCustomer(ctx.app, order.id, content, {
        kind: 'stock', stockAccountId: account.id, actor: claim.approved_by, alreadyDelivered: true,
        costToman: account.cost_toman !== null && account.quantity > 0 ? Math.round(account.cost_toman / account.quantity) : null,
      });
    } else if (claim?.fulfillment === 'supplier') {
      const sources = await sourceSummary(ctx.app, order.customer_product_id);
      if (sources.enabled === 0) {
        await raiseNeedsAction(ctx.app, order.id, 'no_enabled_source');
        return;
      }
      // the admin approved the purchase when the link was created: no loss guard (requested_by is not 0)
      const soId = await queueSupplierOrder(ctx.app, order, { requestedBy: claim.approved_by });
      if (soId !== null && ctx.app.apps.budget.remaining() >= 15) await kickSupplierOrder(ctx.app, soId);
    }
  } catch (err: any) {
    console.error('❌ [ManualPurchase] fulfillment of order #' + order.id + ' failed to start:', err?.message ?? err);
  }
}

function productKeyboard(products: CustomerProduct[], page = 0) {
  return productPickerKeyboard(products, page, PRODUCT_PREFIX, PAGE_PREFIX, CANCEL_BUTTON);
}

type Fulfillment = 'outside' | 'stock' | 'supplier';

function productSummary(product: CustomerProduct, fulfillment: Fulfillment = 'outside', stockAccountId: number | null = null): string {
  const lines = [
    '🛒 ثبت خرید مشتری',
    '',
    '📦 محصول: ' + product.name,
    '💰 قیمت: ' + formatPrice(product.price) + ' تومان',
    '⏳ مدت اشتراک: ' + (product.duration_days ? product.duration_days + ' روز' : 'بدون محدودیت زمانی'),
    '🛡 مدت گارانتی: ' + (product.warranty_days ? product.warranty_days + ' روز' : 'بدون گارانتی'),
    '',
  ];
  if (fulfillment === 'supplier') {
    lines.push(
      '🛒 تحویل: خرید از تأمین‌کننده وقتی مشتری لینک را بزند' +
        (product.cost_toman != null ? ' (هزینه‌ی تقریبی ' + formatPrice(product.cost_toman) + ' تومان)' : ''),
      '⚠️ زمان اشتراک از لحظه‌ی تحویل اکانت شروع می‌شود.',
      'با زدن «تأیید»، خرید از کیف پول را تأیید می‌کنید.',
    );
  } else {
    if (fulfillment === 'stock') lines.push('📦 تحویل: اکانت #' + stockAccountId + ' از «اکانت‌های من» با باز شدن لینک برای مشتری ارسال می‌شود.');
    lines.push('⚠️ زمان اشتراک از لحظه تأیید شما شروع می‌شود، نه از زمان باز کردن لینک توسط مشتری.');
  }
  lines.push('', 'آیا خرید ثبت شود؟');
  return lines.join('\n');
}

const confirmKeyboard = () => Markup.inlineKeyboard([[Markup.button.callback('✅ تأیید و ساخت لینک', CONFIRM_ACTION), CANCEL_BUTTON]]);

/** «این خرید چطور تحویل شود؟» — asked only for products with sources (SUPPLIER_PLAN.md §10.3). */
const fulfillmentKeyboard = () => Markup.inlineKeyboard([
  [Markup.button.callback('🙋 خودم تحویل داده‌ام (مثل قبل)', 'manual_ful_outside')],
  [Markup.button.callback('📦 از اکانت‌های من', 'manual_ful_stock')],
  [Markup.button.callback('🛒 خرید از تأمین‌کننده وقتی مشتری لینک را زد', 'manual_ful_supplier')],
  [CANCEL_BUTTON],
]);

async function showStockPick(ctx: StoreContext, product: CustomerProduct, page: number, edit: boolean): Promise<void> {
  const accounts = await availableStockFor(ctx.app, product.id);
  if (accounts.length === 0) {
    await ctx.answerCallbackQuery({ text: '📦 اکانت آزادی در «اکانت‌های من» نیست.', show_alert: true }).catch(() => {});
    return;
  }
  const keyboard = buildPagedKeyboard(accounts, page,
    (a) => Markup.button.callback((a.match ? '🎯 ' : '') + a.title.slice(0, 36) + ' — اکانت #' + a.id, 'manual_stk_' + a.id),
    'manual_stkp_', CANCEL_BUTTON);
  const text = '📦 یک اکانت برای این خرید انتخاب کنید (🎯 = از همین منبع):';
  if (edit) await ctx.editMessageText(text, keyboard).catch(() => {});
  else await ctx.reply(text, keyboard);
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

    // entered from a stock account card («🔗 لینک خرید دستی»): that account is the delivery
    const attached: number | null = ctx.wizard.state.stockAccountId ?? null;
    if (attached !== null) {
      const account = await loadAccount(ctx.app, attached);
      if (!account || account.status !== 'available') {
        await ctx.reply('❌ این اکانت دیگر آزاد نیست.');
        return ctx.scene.leave();
      }
    }

    const token = await createActivationToken();
    ctx.wizard.state.manualPurchase = {
      creationKey: crypto.randomUUID(),
      rawToken: token.rawToken,
      tokenHash: token.tokenHash,
      productId: null,
      fulfillment: attached !== null ? 'stock' : 'outside',
      stockAccountId: attached,
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
      // products with sources ask how the purchase is delivered; the rest (and a stock account already chosen) don't
      if (draft.stockAccountId === null && await isSupplierOption(ctx.app, product.id)) {
        draft.fulfillment = 'outside';
        await ctx.editMessageText('این خرید چطور تحویل شود؟\n\n📦 ' + product.name, fulfillmentKeyboard()).catch(() => {});
        return;
      }
      await ctx.editMessageText(productSummary(product, draft.fulfillment, draft.stockAccountId), confirmKeyboard()).catch(() => {});
      return;
    }

    const fulMatch = data?.match(/^manual_ful_(outside|stock|supplier)$/);
    if (fulMatch && draft.productId) {
      const product = await ctx.app.db.getCustomerProductById(draft.productId);
      if (!product?.is_active) {
        await ctx.answerCallbackQuery({ text: '❌ این محصول دیگر فعال نیست.', show_alert: true }).catch(() => {});
        return ctx.scene.leave();
      }
      if (fulMatch[1] === 'stock') {
        await ctx.answerCallbackQuery().catch(() => {});
        await showStockPick(ctx, product, 0, true);
        return;
      }
      draft.fulfillment = fulMatch[1];
      draft.stockAccountId = null;
      await ctx.answerCallbackQuery().catch(() => {});
      await ctx.editMessageText(productSummary(product, draft.fulfillment), confirmKeyboard()).catch(() => {});
      return;
    }

    const stockPage = data?.match(/^manual_stkp_(\d+)$/);
    if (stockPage && draft.productId) {
      const product = await ctx.app.db.getCustomerProductById(draft.productId);
      await ctx.answerCallbackQuery().catch(() => {});
      if (product) await showStockPick(ctx, product, parseInt(stockPage[1], 10), true);
      return;
    }

    const stockPick = data?.match(/^manual_stk_(\d+)$/);
    if (stockPick && draft.productId) {
      const account = await loadAccount(ctx.app, parseInt(stockPick[1], 10));
      const product = await ctx.app.db.getCustomerProductById(draft.productId);
      if (!account || account.status !== 'available' || !product) {
        await ctx.answerCallbackQuery({ text: '❌ این اکانت دیگر آزاد نیست.', show_alert: true }).catch(() => {});
        return;
      }
      draft.fulfillment = 'stock';
      draft.stockAccountId = account.id;
      await ctx.answerCallbackQuery().catch(() => {});
      await ctx.editMessageText(productSummary(product, 'stock', account.id), confirmKeyboard()).catch(() => {});
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
          fulfillment: draft.fulfillment,
          ...(draft.fulfillment === 'stock' ? { stockAccountId: draft.stockAccountId } : {}),
        });
      } catch (err: any) {
        console.error('❌ [ManualPurchase] Claim creation failed:', err.message);
        await ctx.answerCallbackQuery({
          text: draft.fulfillment === 'stock' ? '❌ ثبت ناموفق بود؛ شاید اکانت دیگر آزاد نیست.' : '❌ ثبت خرید ناموفق بود.', show_alert: true,
        }).catch(() => {});
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
      await ctx.editMessageText(
        draft.fulfillment === 'supplier'
          ? '✅ خرید دستی «' + claim.product_name + '» ثبت شد. وقتی مشتری لینک را بزند، اکانت از تأمین‌کننده خریداری و برایش ارسال می‌شود.'
          : '✅ خرید دستی «' + claim.product_name + '» ثبت شد و زمان اشتراک از همین لحظه آغاز شد.',
      ).catch(() => {});
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

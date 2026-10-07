import type { Bot } from 'grammy';
import { Markup } from '../../lib/markup';
import { storeOrderPaid } from '../../bridge';
import { isAdminId } from '../config';
import {
  escapeMarkdown, formatPrice, productPickerKeyboard, formatJalaliDate, parseLocalDateTime, catalogLabel,
} from '../utils';
import {
  validateDiscountCode, validateDiscountCodeForOrder, applyDiscount, DISCOUNT_ERROR_LABEL,
} from './discountCodes';
import { formatCardNumber } from './storeSettings';
import { buildReceiptCaption, deliverReceiptToAdmins } from '../services/receiptDelivery';
import { ACTIVATION_CONTACT, MY_SUBS_LABEL, RENEWAL_NOTE, STOREFRONT_LABEL } from '../labels';
import type { StoreContext } from '../types';
import type { CustomerProduct, Order } from '../db';

export { STOREFRONT_LABEL, MY_SUBS_LABEL, RENEWAL_NOTE };

const MS_PER_DAY = 86400000;
/** A receipt must follow the «agree» step within this time; older drafts (old price / code) are dropped. */
export const RECEIPT_DRAFT_TTL_MS = MS_PER_DAY;

/** The pending receipt draft, or null — an expired (or pre-TTL, undated) draft is cleared. */
function receiptDraft(ctx: StoreContext) {
  const d = ctx.session?.awaitingReceiptFor;
  if (!d) return null;
  if (!d.createdAt || ctx.app.apps.now().getTime() - d.createdAt > RECEIPT_DRAFT_TTL_MS) {
    ctx.session.awaitingReceiptFor = null;
    return null;
  }
  return d;
}

export function customerStorefrontKeyboard() {
  return Markup.keyboard([[STOREFRONT_LABEL, MY_SUBS_LABEL]]).resize();
}

// ─── Catalog browsing (paged) ─────────────────────────────────────────────────

const CATALOG_CANCEL_BTN = Markup.button.callback('❌ بستن', 'cust_catalog_close');

function catalogKeyboard(products: CustomerProduct[], page: number) {
  return productPickerKeyboard(products, page, 'cust_prod_', 'cust_catalog_page_', CATALOG_CANCEL_BTN, catalogLabel);
}

// ─── Discount-question step (shared by catalog pick and renew button) ────────

async function sendDiscountPrompt(ctx: StoreContext, product: CustomerProduct) {
  // A fresh product selection supersedes any half-finished discount-code entry.
  ctx.session.awaitingDiscountCodeFor = null;

  await ctx.reply(
    '📦 *' + escapeMarkdown(product.name) + '*\n' +
    '💰 قیمت: ' + formatPrice(product.price) + ' تومان\n\n' +
    '🎟 آیا کد تخفیف دارید؟',
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([[
        Markup.button.callback('🎟 وارد کردن کد تخفیف', 'cust_disc_enter_' + product.id),
        Markup.button.callback('➡️ ندارم، ادامه بده', 'cust_disc_skip_' + product.id),
      ]]),
    },
  );
}

// ─── "My Subscriptions" view ─────────────────────────────────────────────────

export function subscriptionCardText(order: Order): string {
  const now = Date.now();
  const lines = ['📦 *' + escapeMarkdown(order.product_name) + '*'];

  lines.push('📅 تاریخ تحویل: ' + formatJalaliDate(order.delivered_at!));

  const deliveredMs = parseLocalDateTime(order.delivered_at!);
  if (deliveredMs !== null) {
    lines.push('⏳ ' + Math.max(0, Math.floor((now - deliveredMs) / MS_PER_DAY)) + ' روز از تحویل گذشته');
  }

  if (order.expires_at) {
    const expiresMs = parseLocalDateTime(order.expires_at);
    const daysLeft = expiresMs === null ? null : Math.ceil((expiresMs - now) / MS_PER_DAY);
    if (daysLeft !== null && daysLeft > 0) {
      lines.push('⏱ ' + daysLeft + ' روز از اشتراک باقی مانده (تا ' + formatJalaliDate(order.expires_at) + ')');
    } else {
      lines.push('⛔️ اشتراک منقضی شده (' + formatJalaliDate(order.expires_at) + ')');
    }
  } else {
    lines.push('⏱ این محصول اشتراک زمان‌دار ندارد');
  }

  if (order.warranty_expires_at) {
    lines.push(isWarrantyActive(order)
      ? '🛡 گارانتی: فعال تا ' + formatJalaliDate(order.warranty_expires_at)
      : '🛡 گارانتی: منقضی شده');
  } else {
    lines.push('🛡 گارانتی: ندارد');
  }

  return lines.join('\n');
}

function isWarrantyActive(order: Order): boolean {
  if (!order.warranty_expires_at) return false;
  const ms = parseLocalDateTime(order.warranty_expires_at);
  return ms !== null && ms > Date.now();
}

// ─── Terms step (shared by "no code" and "code applied" paths) ───────────────

async function showTermsStep(ctx: StoreContext, product: CustomerProduct, finalPrice: number, discountCodeId: number | null) {
  ctx.session.pendingPurchase = {
    productId: product.id,
    productName: product.name,
    price: finalPrice,
    discountCodeId,
  };

  const priceBlock = discountCodeId
    ? '💰 قیمت با تخفیف: *' + formatPrice(finalPrice) + ' تومان* (قیمت اصلی: ' + formatPrice(product.price) + ' تومان)'
    : '💰 قیمت: ' + formatPrice(finalPrice) + ' تومان';

  const agreeDeclineKb = Markup.inlineKeyboard([[
    Markup.button.callback('✅ موافقم', 'cust_agree_' + product.id),
    Markup.button.callback('❌ انصراف', 'cust_decline_' + product.id),
  ]]);

  if (!product.terms_text) {
    await ctx.reply(
      '📦 *' + escapeMarkdown(product.name) + '*\n' +
      priceBlock + '\n\n' +
      '📜 این محصول شرایط خاصی ندارد.\n\n' +
      'آیا با شرایط بالا موافقید؟',
      { parse_mode: 'Markdown', ...agreeDeclineKb },
    );
    return;
  }

  // Two messages: summary first, then the admin's terms verbatim with its
  // original entities (entities reuse requires the text to start at offset 0).
  await ctx.reply(
    '📦 *' + escapeMarkdown(product.name) + '*\n' +
    priceBlock + '\n\n' +
    '📜 *شرایط و قوانین:*',
    { parse_mode: 'Markdown' },
  );

  await ctx.reply(
    product.terms_text + '\n\nآیا با شرایط بالا موافقید؟',
    {
      entities: product.terms_entities || undefined,
      ...agreeDeclineKb,
    },
  );
}

export function registerStorefrontHandler(bot: Bot<StoreContext>) {
  const isAdmin = (ctx: StoreContext) => isAdminId(ctx.app.cfg, ctx.from?.id);

  // ── Entry point: "🛍 لیست محصولات" persistent button ────────────────────────
  bot.hears(STOREFRONT_LABEL, async (ctx) => {
    const products = await ctx.app.db.getAllActiveCustomerProducts();
    if (products.length === 0) {
      await ctx.reply('😔 فعلاً محصولی در فروشگاه موجود نیست.');
      return;
    }

    await ctx.reply(
      '🛍 *فهرست محصولات*\n\nمحصول مورد نظر خود را انتخاب کنید:',
      { parse_mode: 'Markdown', ...catalogKeyboard(products, 0) },
    );
  });

  // ── Entry point: "📋 اشتراک‌های من" persistent button ───────────────────────
  bot.hears(MY_SUBS_LABEL, async (ctx) => {
    const orders = await ctx.app.db.getDeliveredOrdersForCustomer(ctx.from!.id);
    if (orders.length === 0) {
      await ctx.reply('😔 شما هنوز سفارش تحویل‌شده‌ای ندارید.\n\nبعد از تحویل اولین سفارش، وضعیت اشتراک و گارانتی آن اینجا نمایش داده می‌شود.');
      return;
    }

    for (const order of orders) {
      const buttons = [];
      if (isWarrantyActive(order)) {
        buttons.push(Markup.button.callback('🛠 مشکل دارم', 'warranty_claim_' + order.id));
      }
      buttons.push(Markup.button.callback('🔄 تمدید / خرید مجدد', 'renew_' + order.customer_product_id));

      await ctx.reply(subscriptionCardText(order), {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([buttons]),
      }).catch((err) => console.warn('⚠️ [Storefront] Subscription card failed for order #' + order.id + ':', err.message));
    }
  });

  // ── Warranty claim ("🛠 مشکل دارم") — only while the warranty is active ─────
  bot.callbackQuery(/^warranty_claim_(\d+)$/, async (ctx) => {
    const order = await ctx.app.db.getOrderById(parseInt(ctx.match![1], 10));
    // Callback data is forgeable, so re-check ownership + warranty window.
    if (!order || order.customer_telegram_id !== ctx.from.id) {
      await ctx.answerCallbackQuery('❌ سفارش یافت نشد.');
      return;
    }
    if (!isWarrantyActive(order)) {
      await ctx.answerCallbackQuery({ text: '⛔️ گارانتی این سفارش به پایان رسیده است.', show_alert: true });
      return;
    }

    // Once-per-day guard so the button can't spam the admins.
    const lastClaimMs = order.last_warranty_claim_at ? parseLocalDateTime(order.last_warranty_claim_at) : null;
    if (lastClaimMs !== null && Date.now() - lastClaimMs < MS_PER_DAY) {
      await ctx.answerCallbackQuery({ text: 'ℹ️ درخواست شما قبلاً ثبت شده و در حال پیگیری است. (حداکثر یک درخواست در روز)', show_alert: true });
      return;
    }

    const customerLabel = escapeMarkdown(ctx.from.first_name || 'مشتری') +
      (ctx.from.username ? ' (@' + escapeMarkdown(ctx.from.username) + ')' : '');
    const adminMsg =
      '🛠 *درخواست گارانتی جدید*\n\n' +
      '👤 مشتری: ' + customerLabel + '\n' +
      '🆔 آیدی: ' + ctx.from.id + '\n' +
      '📦 محصول: ' + escapeMarkdown(order.product_name) + ' (سفارش #' + order.id + ')\n' +
      '📅 تاریخ تحویل: ' + formatJalaliDate(order.delivered_at!) + '\n' +
      '🛡 گارانتی تا: ' + formatJalaliDate(order.warranty_expires_at!);

    let delivered = 0;
    for (const adminId of ctx.app.cfg.adminIds) {
      try {
        await ctx.api.sendMessage(adminId, adminMsg, { parse_mode: 'Markdown' });
        delivered++;
      } catch (err: any) {
        console.warn('⚠️ [Storefront] Failed to deliver warranty claim to admin ' + adminId + ':', err.message);
      }
    }

    // No admin got it → don't start the once-a-day lock and don't claim success; the customer may retry.
    if (delivered === 0) {
      await ctx.answerCallbackQuery({ text: '❌ ثبت درخواست ناموفق بود. لطفاً کمی بعد دوباره تلاش کنید.', show_alert: true });
      return;
    }

    try {
      await ctx.app.db.setWarrantyClaimNow(order.id);
    } catch (err: any) {
      console.error('❌ [Storefront] setWarrantyClaimNow failed:', err.message);
    }

    await ctx.answerCallbackQuery('✅ درخواست ثبت شد.');
    await ctx.reply('✅ درخواست گارانتی شما برای «' + order.product_name + '» ثبت و به ادمین اطلاع داده شد. به‌زودی با شما تماس گرفته می‌شود.');
  });

  // ── Renew ("🔄 تمدید / خرید مجدد") — restarts the purchase flow ─────────────
  bot.callbackQuery(/^renew_(\d+)$/, async (ctx) => {
    const product = await ctx.app.db.getCustomerProductById(parseInt(ctx.match![1], 10));
    if (!product || !product.is_active) {
      await ctx.answerCallbackQuery({ text: '❌ این محصول در حال حاضر موجود نیست. با پشتیبانی تماس بگیرید.', show_alert: true });
      return;
    }
    if (product.is_available === 0) {
      await ctx.answerCallbackQuery({ text: '⛔️ این محصول فعلاً ناموجود است.', show_alert: true });
      return;
    }

    await ctx.answerCallbackQuery();
    await ctx.reply(RENEWAL_NOTE);
    await sendDiscountPrompt(ctx, product);
  });

  // ── Catalog pagination ──────────────────────────────────────────────────────
  bot.callbackQuery(/^cust_catalog_page_(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const products = await ctx.app.db.getAllActiveCustomerProducts();
    await ctx.editMessageReplyMarkup(
      { reply_markup: catalogKeyboard(products, parseInt(ctx.match![1], 10)).reply_markup },
    ).catch(() => {});
  });

  bot.callbackQuery('cust_catalog_close', async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.editMessageText('🛍 فهرست محصولات بسته شد.').catch(() => {});
  });

  // ── Product selected → ask whether the customer has a discount code ────────
  bot.callbackQuery(/^cust_prod_(\d+)$/, async (ctx) => {
    const product = await ctx.app.db.getCustomerProductById(parseInt(ctx.match![1], 10));
    // Product may have been deactivated after this keyboard was sent.
    if (!product || !product.is_active) {
      await ctx.answerCallbackQuery('❌ این محصول دیگر موجود نیست.');
      return;
    }

    await ctx.answerCallbackQuery();
    if (product.is_available === 0) {
      await ctx.reply(
        '⛔️ «' + product.name + '» فعلاً ناموجود است.\n\n' +
        'می‌توانید عضو لیست انتظار شوید تا به‌محض موجود شدن خبرتان کنیم.',
        Markup.inlineKeyboard([[Markup.button.callback('🔔 موجود شد خبرم کن', 'waitlist_join_' + product.id)]]),
      );
      return;
    }
    await sendDiscountPrompt(ctx, product);
  });

  // ── «🔔 موجود شد خبرم کن» ───────────────────────────────────────────────────
  bot.callbackQuery(/^waitlist_join_(\d+)$/, async (ctx) => {
    const product = await ctx.app.db.getCustomerProductById(parseInt(ctx.match![1], 10));
    if (!product || !product.is_active) {
      await ctx.answerCallbackQuery('❌ این محصول دیگر موجود نیست.');
      return;
    }
    if (product.is_available !== 0) {
      await ctx.answerCallbackQuery('✅ این محصول الان موجود است. از «🛍 لیست محصولات» می‌توانید بخرید.');
      return;
    }
    if (await ctx.app.db.addToWaitlist(product.id, ctx.from.id)) {
      await ctx.answerCallbackQuery('✅ ثبت شد');
      await ctx.editMessageText('🔔 ثبت شد. به‌محض موجود شدن «' + product.name + '» خبرتان می‌کنیم.').catch(() => {});
    } else {
      await ctx.answerCallbackQuery('ℹ️ قبلاً ثبت شده‌اید.');
    }
  });

  // ── No discount code → straight to terms at the original price ─────────────
  bot.callbackQuery(/^cust_disc_skip_(\d+)$/, async (ctx) => {
    const product = await ctx.app.db.getCustomerProductById(parseInt(ctx.match![1], 10));
    if (!product || !product.is_active) {
      await ctx.answerCallbackQuery('❌ این محصول دیگر موجود نیست.');
      await ctx.editMessageText('❌ این محصول دیگر موجود نیست.').catch(() => {});
      return;
    }
    if (product.is_available === 0) {
      await ctx.answerCallbackQuery('⛔️ این محصول فعلاً ناموجود است.');
      await ctx.editMessageText('⛔️ این محصول فعلاً ناموجود است.').catch(() => {});
      return;
    }

    ctx.session.awaitingDiscountCodeFor = null;

    await ctx.answerCallbackQuery();
    await ctx.editMessageText('➡️ بدون کد تخفیف ادامه داده شد.').catch(() => {});
    await showTermsStep(ctx, product, product.price, null);
  });

  // ── Has a discount code → expect the code text next ─────────────────────────
  bot.callbackQuery(/^cust_disc_enter_(\d+)$/, async (ctx) => {
    const product = await ctx.app.db.getCustomerProductById(parseInt(ctx.match![1], 10));
    if (!product || !product.is_active) {
      await ctx.answerCallbackQuery('❌ این محصول دیگر موجود نیست.');
      await ctx.editMessageText('❌ این محصول دیگر موجود نیست.').catch(() => {});
      return;
    }
    if (product.is_available === 0) {
      await ctx.answerCallbackQuery('⛔️ این محصول فعلاً ناموجود است.');
      await ctx.editMessageText('⛔️ این محصول فعلاً ناموجود است.').catch(() => {});
      return;
    }

    ctx.session.awaitingDiscountCodeFor = product.id;

    await ctx.answerCallbackQuery();
    await ctx.editMessageText('🎟 لطفاً کد تخفیف را تایپ کنید:').catch(() => {});
  });

  // ── Discount-code text step — must run before the receipt nudge / catch-all ─
  bot.on('message:text', async (ctx, next) => {
    const productId = ctx.session?.awaitingDiscountCodeFor;
    if (!productId) return next();

    const product = await ctx.app.db.getCustomerProductById(productId);
    if (!product || !product.is_active) {
      ctx.session.awaitingDiscountCodeFor = null;
      await ctx.reply('❌ این محصول دیگر موجود نیست.');
      return;
    }
    if (product.is_available === 0) {
      ctx.session.awaitingDiscountCodeFor = null;
      await ctx.reply('⛔️ این محصول فعلاً ناموجود است.');
      return;
    }

    const result = await validateDiscountCode(ctx.app, ctx.message.text, productId, ctx.from.id);
    if (!result.ok) {
      await ctx.reply(
        DISCOUNT_ERROR_LABEL[result.reason] + '\n\nمی‌توانید دوباره تلاش کنید، یا بدون کد ادامه دهید.',
        {
          ...Markup.inlineKeyboard([[
            Markup.button.callback('➡️ بدون کد، ادامه بده', 'cust_disc_skip_' + productId),
          ]]),
        },
      );
      return;
    }

    ctx.session.awaitingDiscountCodeFor = null;
    const finalPrice = applyDiscount(product.price, result.discountCode);
    await ctx.reply('✅ کد تخفیف اعمال شد!');
    await showTermsStep(ctx, product, finalPrice, result.discountCode.id);
  });

  // ── Agree → expect a receipt next ───────────────────────────────────────────
  bot.callbackQuery(/^cust_agree_(\d+)$/, async (ctx) => {
    const product = await ctx.app.db.getCustomerProductById(parseInt(ctx.match![1], 10));
    if (!product || !product.is_active) {
      await ctx.answerCallbackQuery('❌ این محصول دیگر موجود نیست.');
      await ctx.editMessageText('❌ این محصول دیگر موجود نیست.').catch(() => {});
      return;
    }
    if (product.is_available === 0) {
      await ctx.answerCallbackQuery('⛔️ این محصول فعلاً ناموجود است.');
      await ctx.editMessageText('⛔️ این محصول فعلاً ناموجود است.').catch(() => {});
      return;
    }

    const pending = ctx.session?.pendingPurchase;
    const usePending = pending && pending.productId === product.id;

    ctx.session.awaitingReceiptFor = {
      productId: product.id,
      productName: product.name,
      price: usePending ? pending.price : product.price,
      discountCodeId: usePending ? pending.discountCodeId : null,
      createdAt: ctx.app.apps.now().getTime(),
    };
    ctx.session.pendingPurchase = null;

    await ctx.answerCallbackQuery();

    const settings = await ctx.app.db.getStoreSettings();
    const receiptMsg = settings
      ? '✅ عالی!\n\n' +
        '💳 مبلغ را به شماره کارت زیر واریز کنید:\n' +
        '`' + formatCardNumber(settings.card_number) + '`\n' +
        '👤 به نام: ' + escapeMarkdown(settings.card_holder_name) + '\n\n' +
        '📸 سپس عکس یا فایل رسید پرداخت را ارسال کنید.'
      : '✅ عالی!\n\n📸 لطفاً عکس یا فایل رسید پرداخت را ارسال کنید.';

    await ctx.editMessageText(receiptMsg, { parse_mode: 'Markdown' }).catch(() => {});
  });

  bot.callbackQuery(/^cust_decline_(\d+)$/, async (ctx) => {
    ctx.session.pendingPurchase = null;
    ctx.session.awaitingDiscountCodeFor = null;
    await ctx.answerCallbackQuery('خرید لغو شد.');
    await ctx.editMessageText('❌ خرید لغو شد.').catch(() => {});
  });

  // ── Receipt-step text nudge ─────────────────────────────────────────────────
  bot.on('message:text', async (ctx, next) => {
    if (!receiptDraft(ctx)) return next();
    await ctx.reply('⚠️ لطفاً عکس یا فایل رسید پرداخت را ارسال کنید، نه متن.');
  });

  // ── Receipt received → create order, forward to admins ─────────────────────
  bot.on(['message:photo', 'message:document'], async (ctx, next) => {
    const hadDraft = !!ctx.session?.awaitingReceiptFor;
    const pending = receiptDraft(ctx);
    if (!pending) {
      if (!hadDraft) return next();
      await ctx.reply('⌛️ مهلت ارسال رسید برای این خرید تمام شده است. لطفاً دوباره از «' + STOREFRONT_LABEL + '» محصول را انتخاب کنید.');
      return;
    }
    const product = await ctx.app.db.getCustomerProductById(pending.productId);
    if (!product || !product.is_active) {
      ctx.session.awaitingReceiptFor = null;
      await ctx.reply('❌ این محصول دیگر موجود نیست و رسید ثبت نشد. لطفاً با پشتیبانی تماس بگیرید.');
      return;
    }

    let receiptFileId: string;
    let receiptType: 'photo' | 'document';
    if (ctx.message.photo?.length) {
      receiptType = 'photo';
      receiptFileId = ctx.message.photo[ctx.message.photo.length - 1].file_id; // largest size
    } else if (ctx.message.document) {
      receiptType = 'document';
      receiptFileId = ctx.message.document.file_id;
    } else {
      return next();
    }

    const { productId, productName, price, discountCodeId } = pending;
    let orderId: number;
    try {
      const result = await ctx.app.db.createOrder({
        customerTelegramId: ctx.from.id,
        customerProductId: productId,
        productName, price, receiptFileId, receiptType, discountCodeId,
      });
      orderId = result.lastInsertRowid;
    } catch (err: any) {
      console.error('❌ [Storefront] createOrder failed:', err.message);
      await ctx.reply('❌ خطا در ثبت سفارش. لطفاً دوباره تلاش کنید.');
      return;
    }

    const caption = buildReceiptCaption({
      customer: {
        id: ctx.from.id,
        firstName: ctx.from.first_name || 'مشتری',
        username: ctx.from.username || null,
      },
      order: { productName, price },
    });
    const delivery = await deliverReceiptToAdmins({
      api: ctx.api,
      adminIds: ctx.app.cfg.adminIds,
      sourceChatId: ctx.chat.id,
      sourceMessageId: ctx.message.message_id,
      orderId,
      caption,
    });

    for (const failure of delivery.failures) {
      console.warn(
        '⚠️ [Storefront] Receipt delivery to admin ' + failure.adminId +
        ' failed (' + (failure.errorCode ?? 'unknown') + '): ' + failure.description,
      );
    }

    if (delivery.successfulAdminIds.length === 0) {
      let rollback;
      try {
        rollback = await ctx.app.db.deletePendingOrder(orderId);
      } catch (err: any) {
        console.error('❌ [Storefront] CRITICAL: receipt order #' + orderId + ' notification and rollback both failed:', err.message);
      }

      if (rollback?.changes === 1) {
        await ctx.reply('❌ رسید شما برای ادمین ارسال نشد و سفارش ثبت نهایی نشد. لطفاً کمی بعد همان رسید را دوباره ارسال کنید.');
        return;
      }

      ctx.session.awaitingReceiptFor = null;
      console.error('❌ [Storefront] CRITICAL: pending receipt order #' + orderId + ' could not be rolled back.');
      await ctx.reply('⚠️ رسید شما ذخیره شد اما ارسال آن به ادمین با مشکل مواجه شد. لطفاً سفارش #' + orderId + ' را با پشتیبانی پیگیری کنید و فعلاً رسید را دوباره نفرستید.');
      return;
    }

    ctx.session.awaitingReceiptFor = null;
    await ctx.reply('✅ رسید شما دریافت شد و برای بررسی به مدیر ارسال شد. لطفاً منتظر تایید بمانید.');
    console.log(
      '🧾 [Storefront] New order #' + orderId + ' pending — customer ' + ctx.from.id +
      ', delivered to ' + delivery.successfulAdminIds.length + ' admin(s).',
    );
  });

  // ── Catch-all for ordinary customers ────────────────────────────────────────
  bot.on('message', async (ctx, next) => {
    if (isAdmin(ctx)) return next();

    if (receiptDraft(ctx)) {
      await ctx.reply('⚠️ لطفاً عکس یا فایل رسید پرداخت را ارسال کنید (نه نوع دیگری از پیام).');
      return;
    }

    await ctx.reply('🤖 برای مشاهده محصولات، از دکمه «' + STOREFRONT_LABEL + '» استفاده کنید.');
  });

  // ── Admin decision: confirm/reject ──────────────────────────────────────────
  bot.callbackQuery(/^order_confirm_(\d+)$/, (ctx) => handleOrderDecision(ctx, 'confirmed'));
  bot.callbackQuery(/^order_reject_(\d+)$/, (ctx) => handleOrderDecision(ctx, 'rejected'));
}

const DISCOUNT_REASON_ADMIN: Record<string, string> = {
  not_found: 'کد حذف شده',
  inactive: 'کد غیرفعال شده',
  wrong_product: 'کد برای این محصول نیست',
  expired: 'کد منقضی شده',
  max_uses: 'ظرفیت کد پر شده',
  already_used: 'مشتری قبلاً از این کد استفاده کرده یا ظرفیت پر شده',
  check_failed: 'بررسی کد ناموفق بود',
};

/** Shared confirm/reject handler. Double-tap / second-admin safe via decideOrder's status guard. */
async function handleOrderDecision(ctx: StoreContext, status: 'confirmed' | 'rejected') {
  if (!isAdminId(ctx.app.cfg, ctx.from?.id)) return ctx.answerCallbackQuery('⛔️ دسترسی ندارید.');

  const orderId = parseInt((ctx.match as RegExpMatchArray)[1], 10);
  const order = await ctx.app.db.getOrderById(orderId);
  if (!order) {
    await ctx.answerCallbackQuery('❌ سفارش یافت نشد.');
    return;
  }

  let result;
  try {
    result = await ctx.app.db.decideOrder(orderId, { status, decidedBy: ctx.from!.id });
  } catch (err: any) {
    console.error('❌ [Storefront] decideOrder failed:', err.message);
    await ctx.answerCallbackQuery('❌ خطا در ثبت تصمیم.');
    return;
  }

  const originalCaption = (ctx.callbackQuery?.message as any)?.caption || '';

  if (result.changes === 0) {
    // Already decided — by a double-tap or another admin.
    const current = await ctx.app.db.getOrderById(orderId);
    const label = current?.status === 'confirmed' ? '✅ قبلاً تایید شده' : '❌ قبلاً رد شده';
    await ctx.answerCallbackQuery('ℹ️ قبلاً بررسی شده.');
    await ctx.editMessageCaption({ caption: originalCaption + '\n\n' + label + '.' }).catch(() => {});
    return;
  }

  let discountWarning = '';
  if (status === 'confirmed') {
    // Snapshot the product's subscription/warranty terms onto the order now
    // (the catalog item may change later).
    const product = await ctx.app.db.getCustomerProductById(order.customer_product_id);
    try {
      await ctx.app.db.setOrderSubscriptionSnapshot(orderId, {
        durationDays: product?.duration_days ?? null,
        warrantyDays: product?.warranty_days ?? null,
      });
    } catch (err: any) {
      console.error('❌ [Storefront] setOrderSubscriptionSnapshot failed for order #' + orderId + ':', err.message);
    }

    if (order.discount_code_id) {
      // Re-check the code's rules at confirm time (not just at code-entry time), then record the
      // redemption atomically — two receipts sent with the same code can't both consume it.
      const revalidation = await validateDiscountCodeForOrder(
        ctx.app, order.discount_code_id, order.customer_product_id, order.customer_telegram_id,
      );
      let reason: string | null = revalidation.ok ? null : revalidation.reason;
      if (revalidation.ok) {
        try {
          if (!(await ctx.app.db.redeemDiscountCodeAtomic(order.discount_code_id, order.customer_telegram_id, order.id))) {
            reason = 'already_used'; // lost the race to another order with the same code (per-customer or max_uses)
          }
        } catch (err: any) {
          console.error('❌ [Storefront] redeemDiscountCodeAtomic failed:', err.message);
        }
      }
      if (reason) {
        console.warn(
          '⚠️ [Storefront] Order #' + orderId + ' confirmed, but its discount code (id ' +
          order.discount_code_id + ') is no longer valid at confirm time (reason: ' + reason + ') — redemption NOT recorded.',
        );
        // The receipt was paid at the discounted price: the admin must know before delivering.
        discountWarning =
          '\n⚠️ کد تخفیف این سفارش هنگام تایید دیگر معتبر نبود (' + (DISCOUNT_REASON_ADMIN[reason] ?? reason) + ').' +
          ' مبلغ پرداخت‌شده با تخفیف: ' + formatPrice(order.price) + ' تومان' +
          (product ? '؛ قیمت اصلی: ' + formatPrice(product.price) + ' تومان' : '') + '.';
      }
    }
  }

  const label = status === 'confirmed' ? '✅ تایید شد' : '❌ رد شد';
  await ctx.answerCallbackQuery(discountWarning
    ? { text: label + discountWarning, show_alert: true }
    : label).catch(() => {});
  await ctx.editMessageCaption({ caption: originalCaption + '\n\n' + label + ' (توسط ادمین).' + discountWarning }).catch(() => {});

  const customerMsg = status === 'confirmed'
    ? '✅ پرداخت شما تایید شد! سفارش «' + order.product_name + '» با موفقیت ثبت شد.\n\n' +
      '📩 برای انجام فرایند فعال‌سازی «' + order.product_name + '» به این آیدی پیام بدید: ' + ACTIVATION_CONTACT
    : '❌ متاسفانه رسید پرداخت شما تایید نشد. لطفاً دوباره تلاش کنید یا با پشتیبانی تماس بگیرید.';

  try {
    await ctx.api.sendMessage(order.customer_telegram_id, customerMsg);
  } catch (err: any) {
    console.warn('⚠️ [Storefront] Failed to notify customer ' + order.customer_telegram_id + ':', err.message);
  }

  // Tell monshi last, so the customer sees the store's "confirmed" message first.
  if (status === 'confirmed') {
    try {
      await storeOrderPaid(ctx.app.apps, {
        order_id: orderId,
        customer_id: order.customer_telegram_id,
        product: order.product_name,
      });
    } catch (err: any) {
      console.error('❌ [Storefront] Bridge failed for order #' + orderId + ':', err.message);
    }
  }

  console.log('🧾 [Storefront] Order #' + orderId + ' ' + status + ' by admin ' + ctx.from!.id + '.');
}

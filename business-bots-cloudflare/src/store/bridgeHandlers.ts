import type { Bot } from 'grammy';
import type { StoreApp } from '../apps';
import { Markup } from '../lib/markup';
import { escapeMarkdown } from './utils';
import { isAdminId } from './config';
import type { StoreContext } from './types';

// Customer-facing texts. The preparing text mirrors the one monshi sends from
// the support account — used here only as the fallback when monshi could not
// reach the customer (no support chat exists).
export const PREPARING_TEXT =
  '📦 رسید شما توسط ادمین دریافت شد ✅\n\n' +
  '⏳ اکانت شما در حال آماده‌سازی است و حداکثر تا ۲۴ ساعت آینده تحویل داده می‌شود.\n\n' +
  'ممنون از صبوری شما 🙏';

export const COMPLETION_TEXT =
  '🎉 سفارش شما تکمیل شد!\n\n' +
  '✅ لطفاً مراحل فعال‌سازی را طی کنید.\n' +
  '📣 کانال ما: @mai_academia';

/** Monshi's "order delivered" signal: flips the order to delivered and starts the clocks. */
export async function onOrderDelivered(app: StoreApp, orderIdRaw: unknown): Promise<void> {
  const orderId = parseInt(String(orderIdRaw), 10);
  if (!orderId) return;

  const result = await app.db.markOrderDelivered(orderId);
  if (result.changes === 0) {
    console.warn('⚠️ [Bridge] order_delivered for order #' + orderId + ' ignored (not found or not in confirmed state).');
    return;
  }
  console.log('📦 [Bridge] Order #' + orderId + ' marked delivered via monshi.');
}

/**
 * Monshi could not message the customer (usually: never chatted with the
 * support account). Fallback: the store bot sends the preparing text itself,
 * and admins get a notice with a manual "delivered" button.
 */
export async function onOrderPaidFailed(app: StoreApp, event: { order_id: unknown; reason?: string }): Promise<void> {
  const orderId = parseInt(String(event.order_id), 10);
  const order = orderId ? await app.db.getOrderById(orderId) : undefined;
  if (!order) {
    console.warn('⚠️ [Bridge] order_paid_failed for unknown order:', event.order_id);
    return;
  }
  // Dedup: a repeat, or an event arriving after the order was already delivered, must not message anyone again.
  if (order.status !== 'confirmed' || order.paid_failed_handled) {
    console.warn(
      '⚠️ [Bridge] order_paid_failed for order #' + orderId + ' skipped (' +
      (order.paid_failed_handled ? 'already handled' : 'status ' + order.status) + ').',
    );
    return;
  }
  // Flag BEFORE sending: a crash mid-send then errs on "no duplicate spam".
  await app.db.setPaidFailedHandled(orderId);

  try {
    await app.api.sendMessage(order.customer_telegram_id, PREPARING_TEXT);
  } catch (err: any) {
    console.error('❌ [Bridge] Fallback preparing message failed for order #' + orderId + ':', err.message);
  }

  const adminMsg =
    '⚠️ *پیام آماده‌سازی سفارش #' + orderId + ' از طریق حساب پشتیبانی ارسال نشد.*\n' +
    '(احتمالاً مشتری هنوز با پشتیبانی چت نکرده است — دلیل: ' + escapeMarkdown(event.reason || 'نامشخص') + ')\n\n' +
    '📦 محصول: ' + escapeMarkdown(order.product_name) + '\n' +
    '👤 مشتری: ' + order.customer_telegram_id + '\n\n' +
    '✅ پیام آماده‌سازی از طریق خود ربات فروشگاه برای مشتری ارسال شد.\n' +
    'بعد از تحویل اکانت، با دکمه زیر سفارش را «تحویل شده» کنید:';

  const deliverKb = Markup.inlineKeyboard([[
    Markup.button.callback('✅ تحویل شد', 'order_deliver_' + orderId),
  ]]);

  for (const adminId of app.cfg.adminIds) {
    try {
      await app.api.sendMessage(adminId, adminMsg, { parse_mode: 'Markdown', ...deliverKb });
    } catch (err: any) {
      console.warn('⚠️ [Bridge] Failed to notify admin ' + adminId + ':', err.message);
    }
  }

  console.log('⚠️ [Bridge] order_paid_failed handled for order #' + orderId + ' (reason: ' + (event.reason || 'unknown') + ') — fallback message + admin notice sent.');
}

/** Manual delivery marking — only reachable from the order_paid_failed admin notice above. */
export function registerBridgeHandler(bot: Bot<StoreContext>) {
  bot.callbackQuery(/^order_deliver_(\d+)$/, async (ctx) => {
    if (!isAdminId(ctx.app.cfg, ctx.from?.id)) return ctx.answerCallbackQuery('⛔️ دسترسی ندارید.');

    const orderId = parseInt(ctx.match![1], 10);
    const result = await ctx.app.db.markOrderDelivered(orderId);

    if (result.changes === 0) {
      const current = await ctx.app.db.getOrderById(orderId);
      await ctx.answerCallbackQuery(current?.status === 'delivered' ? 'ℹ️ قبلاً تحویل شده.' : '❌ سفارش قابل تحویل نیست.');
      return;
    }

    const order = await ctx.app.db.getOrderById(orderId);
    try {
      await ctx.api.sendMessage(order!.customer_telegram_id, COMPLETION_TEXT);
    } catch (err: any) {
      console.error('❌ [Bridge] Completion message failed for order #' + orderId + ':', err.message);
    }

    await ctx.answerCallbackQuery('✅ تحویل ثبت شد.');
    await ctx.editMessageText(
      ((ctx.callbackQuery.message as any)?.text || '') + '\n\n✅ تحویل شد و به مشتری اطلاع داده شد.',
    ).catch(() => {});
    console.log('📦 [Bridge] Order #' + orderId + ' marked delivered manually by admin ' + ctx.from!.id + '.');
  });
}

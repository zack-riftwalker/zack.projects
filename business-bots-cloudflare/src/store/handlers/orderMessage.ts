import type { Bot } from 'grammy';
import { Markup } from '../../lib/markup';
import { ACTIVATION_CONTACT } from '../labels';
import { logEvent } from '../events';
import { beginSupplierInput } from '../supplierInput';
import type { StoreContext } from '../types';

const MIN_LENGTH = 1;
const MAX_LENGTH = 1000;

/**
 * «✉️ پیام از طرف ربات» (SUPPLIER_PLAN.md §8.3, `fo_msg_<id>`): the admin writes one message, the bot sends it to
 * the order's customer. The typed text is taken by the supplier text middleware (kind `fo_msg`, ref = order id).
 */
export function registerOrderMessage(bot: Bot<StoreContext>, isAdmin: (id: number | undefined) => boolean) {
  bot.callbackQuery(/^fo_msg_(\d+)$/, async (ctx) => {
    if (!isAdmin(ctx.from?.id)) return ctx.answerCallbackQuery('⛔️ دسترسی ندارید.');
    const order = await ctx.app.db.getOrderById(parseInt(ctx.match[1], 10));
    if (!order) return ctx.answerCallbackQuery({ text: '❌ سفارش یافت نشد.', show_alert: true });
    await beginSupplierInput(ctx, 'fo_msg', String(order.id));
    await ctx.answerCallbackQuery();
    await ctx.reply(
      '✉️ متنی را که می‌خواهید ربات برای مشتری سفارش #' + order.id + ' بفرستد بنویسید (۱ تا ۱٬۰۰۰ کاراکتر):',
      Markup.inlineKeyboard([[Markup.button.callback('❌ انصراف', 'sup_cancel_input')]]),
    );
  });
}

/** The typed message. Returns true when the kind is `fo_msg` (the prompt stays open when the text is refused). */
export async function handleOrderMessageText(ctx: StoreContext, kind: string, ref: string, text: string): Promise<boolean> {
  if (kind !== 'fo_msg') return false;
  const message = text.trim();
  if (message.length < MIN_LENGTH || message.length > MAX_LENGTH) {
    await ctx.reply('❌ پیام باید بین ۱ تا ۱٬۰۰۰ کاراکتر باشد. دوباره بنویسید:');
    return true;
  }
  const order = await ctx.app.db.getOrderById(parseInt(ref, 10));
  if (!order) {
    ctx.session.awaitingSupplierInput = null;
    await ctx.reply('❌ سفارش یافت نشد.');
    return true;
  }
  ctx.session.awaitingSupplierInput = null;
  try {
    await ctx.app.api.sendMessage(
      order.customer_telegram_id,
      '📩 پیام پشتیبانی درباره‌ی سفارش «' + order.product_name + '»:\n\n' + message +
        '\n\nبرای پاسخ به ' + ACTIVATION_CONTACT + ' پیام دهید.',
    );
  } catch (err: any) {
    console.warn('⚠️ [Admin] order message to ' + order.customer_telegram_id + ' failed:', err?.description ?? err?.message);
    await ctx.reply('❌ ارسال نشد: مشتری ربات را بلاک کرده یا هرگز استارت نزده.');
    return true;
  }
  await logEvent(ctx.app, { orderId: order.id, kind: 'admin_message', actor: ctx.from?.id, detail: message });
  await ctx.reply('✅ ارسال شد');
  return true;
}

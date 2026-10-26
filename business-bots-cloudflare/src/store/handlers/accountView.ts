import type { Bot } from 'grammy';
import { deliveryMessages, latestDelivery } from '../suppliers/engine';
import type { StoreContext } from '../types';

/**
 * «🔑 نمایش اطلاعات اکانت» under «📋 اشتراک‌های من» (SUPPLIER_PLAN.md §7.5): resends the stored accounts to their
 * owner. The callback data is forgeable, so the customer is checked against the order.
 */
export function registerAccountView(bot: Bot<StoreContext>) {
  bot.callbackQuery(/^acct_show_(\d+)$/, async (ctx) => {
    const order = await ctx.app.db.getOrderById(parseInt(ctx.match[1], 10));
    if (!order || order.customer_telegram_id !== ctx.from.id || order.status !== 'delivered') {
      await ctx.answerCallbackQuery('❌ سفارش یافت نشد.');
      return;
    }
    const d = await latestDelivery(ctx.app, order.id, true);
    if (!d) {
      await ctx.answerCallbackQuery('❌ اطلاعات اکانتی برای این سفارش ذخیره نشده است.');
      return;
    }
    await ctx.answerCallbackQuery();
    for (const part of deliveryMessages(order.product_name, d.content)) {
      await ctx.reply(part, { parse_mode: 'HTML' });
    }
  });
}

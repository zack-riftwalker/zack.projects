import type { Bot } from 'grammy';
import { Markup } from '../../lib/markup';
import { tehranDateTime } from '../../lib/time';
import { buildDecisionCard } from '../suppliers/decisionCard';
import {
  DEADLINE_HOURS, kickSupplierOrder, latestDelivery, queueSupplierOrder, recordRemoteOrderId, resendDelivery,
} from '../suppliers/engine';
import { deliveryMessages } from '../suppliers/engine';
import { beginSupplierInput } from '../supplierInput';
import type { StoreContext } from '../types';
import { formatPrice } from '../utils';

const html = { parse_mode: 'HTML' as const };
const ALREADY = 'ℹ️ قبلاً تصمیم گرفته شد.';
const IMPOSSIBLE = '❌ این کار در وضعیت فعلی سفارش ممکن نیست.';

const asciiDigits = (s: string) => s.replace(/[۰-۹]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0x06f0 + 0x30)).replace(/[\s,،٬]/g, '');

/** Replaces the pressed card's keyboard with the outcome line `✅ … توسط ADMIN` (other admins' copies are left alone). */
export async function markCard(ctx: StoreContext, outcome: string): Promise<void> {
  const m: any = ctx.callbackQuery?.message;
  if (!m?.text) return;
  await ctx.editMessageText(m.text + '\n\n' + outcome + ' توسط ' + (ctx.from?.first_name ?? 'ادمین'), { entities: m.entities }).catch(() => {});
}

/** The order if it is a confirmed supplier order; otherwise answers the callback and returns null. */
async function liveOrder(ctx: StoreContext, orderId: number) {
  const order = await ctx.app.db.getOrderById(orderId);
  if (!order) {
    await ctx.answerCallbackQuery({ text: '❌ سفارش یافت نشد.', show_alert: true });
    return null;
  }
  if (order.status !== 'confirmed' || order.fulfillment !== 'supplier') {
    await ctx.answerCallbackQuery({ text: ALREADY, show_alert: true });
    return null;
  }
  return order;
}

/** Order-level admin actions of the decision card (SUPPLIER_PLAN.md §8.3). */
export function registerFulfillmentAdmin(bot: Bot<StoreContext>, isAdmin: (id: number | undefined) => boolean) {
  const guard = async (ctx: StoreContext): Promise<boolean> => {
    if (isAdmin(ctx.from?.id)) return true;
    await ctx.answerCallbackQuery('⛔️ دسترسی ندارید.');
    return false;
  };

  // 🔙 from a confirmation: show the card again
  bot.callbackQuery(/^fo_card_(\d+)$/, async (ctx) => {
    if (!(await guard(ctx))) return;
    const card = await buildDecisionCard(ctx.app, parseInt(ctx.match[1], 10));
    await ctx.answerCallbackQuery();
    if (card) await ctx.editMessageText(card.html, { ...html, ...Markup.inlineKeyboard(card.rows) }).catch(() => {});
  });

  // 🔁 تلاش دوباره: a new supplier order, only when none is live (one conditional INSERT decides)
  bot.callbackQuery(/^fo_retry_(\d+)$/, async (ctx) => {
    if (!(await guard(ctx))) return;
    const order = await liveOrder(ctx, parseInt(ctx.match[1], 10));
    if (!order) return;
    if (order.needs_action_reason === 'loss' || order.needs_action_reason === 'approval') {
      const p = await ctx.app.db.getCustomerProductById(order.customer_product_id);
      await ctx.answerCallbackQuery();
      await ctx.editMessageText(
        '⚠️ خرید با قیمت فعلی (≈ ' + formatPrice(p?.cost_toman ?? 0) + ' ت) انجام شود؟',
        Markup.inlineKeyboard([[
          Markup.button.callback('✅ بله', 'fo_retryok_' + order.id), Markup.button.callback('🔙', 'fo_card_' + order.id),
        ]]),
      ).catch(() => {});
      return;
    }
    await retryNow(ctx, order);
  });
  bot.callbackQuery(/^fo_retryok_(\d+)$/, async (ctx) => {
    if (!(await guard(ctx))) return;
    const order = await liveOrder(ctx, parseInt(ctx.match[1], 10));
    if (order) await retryNow(ctx, order);
  });

  // 🔢 an `unknown` order that did exist: the admin types its number
  bot.callbackQuery(/^fo_rid_(\d+)$/, async (ctx) => {
    if (!(await guard(ctx))) return;
    const order = await liveOrder(ctx, parseInt(ctx.match[1], 10));
    if (!order) return;
    if (order.needs_action_reason !== 'unknown') return ctx.answerCallbackQuery({ text: IMPOSSIBLE, show_alert: true });
    await beginSupplierInput(ctx, 'fo_rid', String(order.id));
    await ctx.answerCallbackQuery();
    await ctx.reply(
      '🔢 شماره‌ی سفارش #' + order.id + ' را در پنل تأمین‌کننده وارد کنید (فقط عدد):',
      Markup.inlineKeyboard([[Markup.button.callback('❌ انصراف', 'sup_cancel_input')]]),
    );
  });

  // 🔁 ارسال دوباره: the stored accounts again, only on an explicit press
  bot.callbackQuery(/^fo_resend_(\d+)$/, async (ctx) => {
    if (!(await guard(ctx))) return;
    const orderId = parseInt(ctx.match[1], 10);
    const result = await resendDelivery(ctx.app, orderId, ctx.from.id);
    if (result === 'delivered') {
      await ctx.answerCallbackQuery('✅ ارسال شد.');
      await markCard(ctx, '✅ دوباره ارسال شد');
    } else if (result === 'send_failed') {
      await ctx.answerCallbackQuery({ text: '❌ ارسال نشد: مشتری ربات را بلاک کرده یا هرگز استارت نزده.', show_alert: true });
    } else {
      await ctx.answerCallbackQuery({ text: result === 'none' ? '❌ اکانتی برای این سفارش ذخیره نشده.' : ALREADY, show_alert: true });
    }
  });

  // 👁 نمایش اکانت: only in the pressing admin's chat
  bot.callbackQuery(/^fo_view_(\d+)$/, async (ctx) => {
    if (!(await guard(ctx))) return;
    const order = await ctx.app.db.getOrderById(parseInt(ctx.match[1], 10));
    const d = order ? await latestDelivery(ctx.app, order.id) : null;
    if (!order || !d) return ctx.answerCallbackQuery({ text: '❌ اکانتی برای این سفارش ذخیره نشده.', show_alert: true });
    await ctx.answerCallbackQuery();
    for (const part of deliveryMessages(order.product_name, d.content)) await ctx.reply(part, html);
  });
}

/** Adds a new queued supplier order for the order, clears the card state and places it right away. */
async function retryNow(ctx: StoreContext, order: NonNullable<Awaited<ReturnType<StoreContext['app']['db']['getOrderById']>>>) {
  const app = ctx.app;
  const soId = await queueSupplierOrder(app, order, { requestedBy: ctx.from!.id, eventKind: 'admin_retry' });
  if (soId === null) return ctx.answerCallbackQuery({ text: IMPOSSIBLE, show_alert: true });
  await app.raw.prepare(
    `UPDATE orders SET needs_action_reason = NULL, needs_action_at = NULL, supplier_deadline_at = ?, stalled_alert_sent = 0
     WHERE id = ? AND status = 'confirmed'`,
  ).bind(tehranDateTime(new Date(app.apps.now().getTime() + DEADLINE_HOURS * 3_600_000)), order.id).run();
  await ctx.answerCallbackQuery('🔁 دوباره ثبت می‌شود.');
  await markCard(ctx, '🔁 تلاش دوباره ثبت شد');
  if (app.apps.budget.remaining() >= 15) await kickSupplierOrder(app, soId);
}

/** Typed answers of the fulfillment prompts. Returns true when the kind belongs here. */
export async function handleFulfillmentText(ctx: StoreContext, kind: string, ref: string, text: string): Promise<boolean> {
  if (kind !== 'fo_rid') return false;
  const id = asciiDigits(text);
  if (!/^\d{1,12}$/.test(id) || Number(id) <= 0) {
    await ctx.reply('❌ شماره باید فقط عدد باشد. دوباره وارد کنید:');
    return true;
  }
  ctx.session.awaitingSupplierInput = null;
  const result = await recordRemoteOrderId(ctx.app, parseInt(ref, 10), String(Number(id)), ctx.from!.id);
  await ctx.reply(result === 'ok' ? '✅ ثبت شد؛ پیگیری خودکار سفارش شروع شد.' : IMPOSSIBLE);
  return true;
}

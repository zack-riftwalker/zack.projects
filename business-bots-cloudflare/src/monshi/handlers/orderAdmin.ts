/** Order management from inside Telegram — register, advance a step, cancel. */
import { Markup, type InlineButton } from '../../lib/markup';
import * as orders from '../services/orders';
import { ORDER_STATUS_DELIVERED, nextOrderStatus, type CustomerRow } from '../db';
import type { MonshiCtx } from '../types';
import { adminGuard, cancelButton, safeEdit } from './common';
import { deliverOrder } from './bridge';

const customerLabel = (c: CustomerRow) => c.first_name || c.username || String(c.chat_id);

async function pickCustomerKeyboard(ctx: MonshiCtx) {
  const rows: InlineButton[][] = (await ctx.app.db.getRecentCustomers(5))
    .map((c) => [Markup.button.callback(customerLabel(c), `ord_pick:${c.chat_id}`)]);
  rows.push(...cancelButton().reply_markup.inline_keyboard);
  return Markup.inlineKeyboard(rows);
}

/** Text + keyboard of the open orders (always with the new-order button on top). */
async function ordersView(ctx: MonshiCtx) {
  const rows = await ctx.app.db.getOpenOrders();
  const buttons: InlineButton[][] = [[Markup.button.callback('➕ ثبت سفارش جدید', 'ord_add')]];
  let text: string;
  if (!rows.length) {
    text = '📦 سفارش باز فعال نیست.';
  } else {
    const lines = ['📦 سفارش‌های باز:\n'];
    for (const o of rows) {
      const customer = await ctx.app.db.getCustomer(o.chat_id);
      const name = customer ? customerLabel(customer) : String(o.chat_id);
      lines.push(`#${o.id} — ${o.title} — ${name} (${orders.statusLabel(o.status)})`);
      buttons.push([
        Markup.button.callback(`▶ مرحله بعد (#${o.id})`, `ord_next:${o.id}`),
        Markup.button.callback('❌ لغو', `ord_cancel:${o.id}`),
      ]);
    }
    text = lines.join('\n');
  }
  return { text, markup: Markup.inlineKeyboard(buttons) };
}

const startOrderAddWizard = (ctx: MonshiCtx) => {
  ctx.session.order_wizard = { step: 'customer', data: {} };
};

const ADD_PROMPT = '🛒 ثبت سفارش جدید\n\nمشتری را از لیست انتخاب کن یا آیدی چت/@یوزرنیمش را بفرست:';

export async function cmdOrderAdd(ctx: MonshiCtx): Promise<void> {
  startOrderAddWizard(ctx);
  await ctx.reply(ADD_PROMPT, await pickCustomerKeyboard(ctx));
}

export async function cmdOrders(ctx: MonshiCtx): Promise<void> {
  const { text, markup } = await ordersView(ctx);
  await ctx.reply(text, markup);
}

async function refreshOrdersMessage(ctx: MonshiCtx): Promise<void> {
  const { text, markup } = await ordersView(ctx);
  await safeEdit(ctx, text, markup);
}

export const onOrderCallback = adminGuard(async (ctx) => {
  const app = ctx.app;
  await ctx.answerCallbackQuery();
  const data = ctx.callbackQuery?.data ?? '';

  if (data === 'ord_add') {
    startOrderAddWizard(ctx);
    return safeEdit(ctx, ADD_PROMPT, await pickCustomerKeyboard(ctx));
  }

  if (data.startsWith('ord_pick:')) {
    const wizard = ctx.session.order_wizard;
    if (!wizard) return safeEdit(ctx, '❌ این عملیات دیگر معتبر نیست؛ دوباره /order_add بزن.');
    wizard.data.chat_id = parseInt(data.split(':', 2)[1], 10);
    wizard.step = 'title';
    return safeEdit(ctx, '✏️ عنوان سفارش را بفرست (مثلاً: جمینای ۱ ماهه):', cancelButton());
  }

  if (data.startsWith('ord_next:')) {
    const orderId = parseInt(data.split(':', 2)[1], 10);
    const order = await app.db.getOrder(orderId);
    // delivered / cancelled (stale list message or double tap) → nothing to do, just refresh the list
    const next = order ? nextOrderStatus(order.status) : null;
    if (order && next) {
      if (next === ORDER_STATUS_DELIVERED && order.external_order_id) {
        // store order: same behaviour as the «✅ تحویل شد» button in the customer chat —
        // completion/activation message + checklist + bridge event to the store
        await deliverOrder(app, order);
      } else if (await app.db.transitionOrder(orderId, order.status, next)) {
        await orders.sendOrUpdateChecklist(app, (await app.db.getOrder(orderId))!);
        if (next === ORDER_STATUS_DELIVERED) {
          try {
            await app.api.sendMessage(
              order.chat_id,
              `🎉 سفارش «${order.title}» با موفقیت تحویل داده شد. ممنون از خرید شما!`,
              order.business_connection_id ? { business_connection_id: order.business_connection_id } : {},
            );
          } catch (err: any) {
            console.error(`Failed to send delivery congrats for order ${orderId}`, err?.message ?? err);
          }
        }
      }
    }
    return refreshOrdersMessage(ctx);
  }

  if (data.startsWith('ord_cancel:')) {
    await app.db.cancelOrder(parseInt(data.split(':', 2)[1], 10));
    return refreshOrdersMessage(ctx);
  }
});

/** Text messages belonging to the new-order wizard; false when unrelated. */
export async function onOrderFreeText(ctx: MonshiCtx): Promise<boolean> {
  const wizard = ctx.session.order_wizard;
  if (!wizard) return false;

  const text = (ctx.message?.text ?? '').trim();
  const { step, data } = wizard;

  if (step === 'customer') {
    const customer = text.startsWith('@')
      ? await ctx.app.db.getCustomerByUsername(text)
      : /^-?\d+$/.test(text) ? await ctx.app.db.getCustomer(parseInt(text, 10)) : null;
    if (!customer) {
      await ctx.reply('❌ مشتری‌ای با این مشخصات پیدا نشد. دوباره امتحان کن یا از دکمه‌ها استفاده کن:', await pickCustomerKeyboard(ctx));
      return true;
    }
    data.chat_id = customer.chat_id;
    wizard.step = 'title';
    await ctx.reply('✏️ عنوان سفارش را بفرست (مثلاً: جمینای ۱ ماهه):', cancelButton());
    return true;
  }

  if (step === 'title') {
    const conn = await ctx.app.ctx.getConnection();
    const orderId = await ctx.app.db.addOrder(data.chat_id, text, conn?.business_connection_id ?? null);
    const order = (await ctx.app.db.getOrder(orderId))!;
    delete ctx.session.order_wizard;
    await ctx.reply(`✅ سفارش #${orderId} ثبت شد و چک‌لیست برای مشتری ارسال می‌شود.`);
    await orders.sendOrUpdateChecklist(ctx.app, order);
    return true;
  }
  return false;
}

/**
 * Store ⇄ monshi bridge — monshi side. The store calls handleOrderPaid()
 * directly (same Worker); delivering an order calls back into the store via
 * src/bridge.ts. Replaces the legacy JSON-over-private-channel protocol.
 */
import type { MonshiApp } from '../../apps';
import { monshiOrderDelivered } from '../../bridge';
import { Markup } from '../../lib/markup';
import { ORDER_STATUS_CANCELLED, ORDER_STATUS_FLOW, type OrderRow } from '../db';
import * as orders from '../services/orders';
import type { MonshiCtx } from '../types';
import { notifyAll } from './common';

// «Being prepared» message — sent from the support account right after a receipt is approved in the
// store bot. The same text lives in store/bridgeHandlers.ts (fallback when the customer never chatted with support).
export const PREPARING_TEXT =
  '📦 رسید شما توسط ادمین دریافت شد ✅\n\n' +
  '⏳ اکانت شما در حال آماده‌سازی است و حداکثر تا ۲۴ ساعت آینده تحویل داده می‌شود.\n\n' +
  'ممنون از صبوری شما 🙏';

// Order-completed message — after the admin presses «✅ تحویل شد»
export const COMPLETION_TEXT =
  '🎉 سفارش شما تکمیل شد!\n\n' +
  '✅ لطفاً مراحل فعال‌سازی را طی کنید.\n' +
  '📣 کانال ما: @mai_academia';

const deliveryKeyboard = (orderId: number) =>
  Markup.inlineKeyboard([[Markup.button.callback('✅ تحویل شد', `orddlv:${orderId}`)]]);

export type OrderPaidResult = { ok: true } | { ok: false; reason: string };

export interface OrderPaidEvent { order_id: number; customer_id: number; product?: string }

export async function handleOrderPaid(app: MonshiApp, event: OrderPaidEvent): Promise<OrderPaidResult> {
  const storeOrderId = event.order_id;
  const customerId = event.customer_id;
  const product = event.product || `سفارش #${storeOrderId}`;
  if (!storeOrderId || !customerId) {
    console.warn('order_paid event missing fields', event);
    return { ok: true };
  }

  // a duplicate event (reprocessed queue) must not create a second order
  if (await app.db.getOrderByExternalId(storeOrderId)) {
    console.log(`order_paid for store order ${storeOrderId} already registered — skipped`);
    return { ok: true };
  }

  const customer = await app.db.getCustomer(customerId);
  const conn = await app.ctx.getConnection();
  const bcid = conn?.business_connection_id;
  if (!customer || !bcid) {
    return { ok: false, reason: !customer ? 'no_support_chat' : 'no_business_connection' };
  }

  const orderId = await app.db.addOrder(customer.chat_id, product, bcid, storeOrderId);
  // the customer paid and the receipt is approved — the order starts directly in «provisioning»
  await app.db.setOrderStatus(orderId, 'provisioning');
  const order = (await app.db.getOrder(orderId))!;

  try {
    await app.api.sendMessage(customer.chat_id, PREPARING_TEXT, {
      business_connection_id: bcid,
      ...deliveryKeyboard(orderId),
    });
  } catch (err: any) {
    console.error(`Failed to send preparing message for store order ${storeOrderId}`, err?.message ?? err);
    await app.db.cancelOrder(orderId);
    return { ok: false, reason: 'send_failed' };
  }

  await orders.sendOrUpdateChecklist(app, order);
  console.log(`Store order ${storeOrderId} registered as monshi order ${orderId} (provisioning)`);
  return { ok: true };
}

/**
 * Marks an order «delivered»: completion message to the customer + checklist update + bridge event to the
 * store (starts the subscription clock). Shared by the «✅ تحویل شد» button in the customer chat and the last step of /orders.
 */
export async function deliverOrder(app: MonshiApp, order: OrderRow): Promise<void> {
  await app.db.setOrderStatus(order.id, ORDER_STATUS_FLOW[ORDER_STATUS_FLOW.length - 1]);
  const fresh = (await app.db.getOrder(order.id))!;

  try {
    await app.api.sendMessage(
      fresh.chat_id, COMPLETION_TEXT,
      fresh.business_connection_id ? { business_connection_id: fresh.business_connection_id } : {},
    );
  } catch (err: any) {
    console.error(`Failed to send completion message for order ${order.id}`, err?.message ?? err);
    // delivery really happened, so status/event stay — but the owner must know the customer
    // did not get the completion text and tell them by hand
    try {
      await notifyAll(
        app,
        `⚠️ سفارش #${fresh.id} (${fresh.title}) تحویل ثبت شد ولی پیام تکمیل ` +
        'به مشتری ارسال نشد — لطفاً دستی اطلاع دهید.',
      );
    } catch (err2: any) {
      console.error(`Failed to notify admin about completion-send failure for order ${order.id}`, err2?.message ?? err2);
    }
  }

  await orders.sendOrUpdateChecklist(app, fresh);

  if (fresh.external_order_id) {
    try {
      await monshiOrderDelivered(app.apps, fresh.external_order_id);
    } catch (err: any) {
      console.error(`order_delivered event to the store failed for order ${order.id}`, err?.message ?? err);
    }
  }
}

async function removeDeliveryButton(app: MonshiApp, order: OrderRow, messageId: number | undefined): Promise<void> {
  if (!messageId || !order.business_connection_id) return;
  try {
    await app.api.editMessageReplyMarkup(order.chat_id, messageId, { business_connection_id: order.business_connection_id });
  } catch (err: any) {
    console.error(`Failed to remove delivery button for order ${order.id}`, err?.message ?? err);
  }
}

/**
 * «✅ تحویل شد» under the preparing message in the customer chat (sent from the support account).
 * The customer can see the button too; only the admin may press it.
 */
export async function onDeliveryCallback(ctx: MonshiCtx): Promise<void> {
  const app = ctx.app;
  const uid = ctx.from?.id;
  if (uid !== app.cfg.adminId) {
    await ctx.answerCallbackQuery({ text: 'این دکمه مخصوص ادمین فروشگاه است 🙂', show_alert: true });
    return;
  }

  const orderId = parseInt((ctx.callbackQuery?.data ?? '').split(':', 2)[1], 10);
  const order = await app.db.getOrder(orderId);
  const messageId = (ctx.callbackQuery?.message as any)?.message_id as number | undefined;
  if (!order) {
    await ctx.answerCallbackQuery('❌ سفارش یافت نشد.');
    return;
  }
  if (order.status === ORDER_STATUS_FLOW[ORDER_STATUS_FLOW.length - 1]) {
    // already delivered (e.g. from /orders) — just remove the leftover button
    await ctx.answerCallbackQuery('ℹ️ قبلاً تحویل ثبت شده.');
    await removeDeliveryButton(app, order, messageId);
    return;
  }
  if (order.status === ORDER_STATUS_CANCELLED) {
    await ctx.answerCallbackQuery('❌ این سفارش لغو شده است.');
    return;
  }

  await ctx.answerCallbackQuery('✅ تحویل ثبت شد.');
  await removeDeliveryButton(app, order, messageId);
  await deliverOrder(app, order);
}

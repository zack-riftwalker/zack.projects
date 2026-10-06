import type { MonshiApp } from '../../apps';
import { ORDER_STATUS_CANCELLED, ORDER_STATUS_FLOW, type OrderRow } from '../db';

// Persian label per step — order must match ORDER_STATUS_FLOW exactly
export const STATUS_LABELS: Record<string, string> = {
  registered: 'ثبت سفارش',
  paid: 'تایید پرداخت',
  provisioning: 'آماده‌سازی اکانت',
  delivered: 'تحویل',
};
export const CHECKLIST_TITLE = '📦 پیگیری سفارش';

// Words that, together with «سفارش», signal a follow-up question
const ORDER_QUERY_HINTS = ['چی شد', 'کی میاد', 'کی میرسه', 'وضعیت', 'پیگیری', 'آماده شد', 'کجاست'];

export function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

/** Customer-facing status text — always built from the database. */
export function statusText(order: OrderRow): string {
  if (order.status === ORDER_STATUS_CANCELLED) {
    return `سفارش «${order.title}» لغو شده است. برای پیگیری با پشتیبانی در تماس باشید.`;
  }
  const label = statusLabel(order.status);
  if (order.status === ORDER_STATUS_FLOW[ORDER_STATUS_FLOW.length - 1]) {
    return `وضعیت سفارش «${order.title}»: ${label} ✅`;
  }
  return `وضعیت سفارش «${order.title}»: ${label} ✅\nبه‌محض تغییر وضعیت، اطلاع‌رسانی می‌شود.`;
}

export function buildChecklist(order: OrderRow) {
  const currentIdx = ORDER_STATUS_FLOW.includes(order.status) ? ORDER_STATUS_FLOW.indexOf(order.status) : -1;
  const tasks = ORDER_STATUS_FLOW.map((status, i) => {
    const mark = i < currentIdx ? '✅' : i === currentIdx ? '🔄' : '⚪';
    return { id: i + 1, text: `${mark} ${statusLabel(status)}` };
  });
  return { title: `${CHECKLIST_TITLE}: ${order.title}`, tasks };
}

/**
 * Sends the checklist to the customer (first time) or edits it. Any failure
 * (e.g. no Premium) silently falls back to a plain status message — the
 * feature never breaks the surrounding flow.
 */
export async function sendOrUpdateChecklist(app: MonshiApp, order: OrderRow): Promise<void> {
  const bcid = order.business_connection_id;
  const chatId = order.chat_id;
  const checklist = buildChecklist(order);
  try {
    if (!bcid) throw new Error('no business connection');
    if (order.checklist_message_id) {
      await app.api.editMessageChecklist(bcid, chatId, order.checklist_message_id, checklist);
    } else {
      const msg = await app.api.sendChecklist(bcid, chatId, checklist);
      await app.db.setOrderChecklistMsg(order.id, msg.message_id);
    }
  } catch (err: any) {
    console.warn(`Checklist send/update failed for order ${order.id}; falling back to text:`, err?.message ?? err);
    try {
      await app.api.sendMessage(chatId, statusText(order), bcid ? { business_connection_id: bcid } : {});
    } catch (err2: any) {
      console.error(`Fallback status text also failed for order ${order.id}:`, err2?.message ?? err2);
    }
  }
}

/** Simple keyword fallback for when Gemini is off or failed. */
export function looksLikeOrderQuery(normalizedText: string): boolean {
  if (!normalizedText.includes('سفارش')) return false;
  return ORDER_QUERY_HINTS.some((hint) => normalizedText.includes(hint));
}

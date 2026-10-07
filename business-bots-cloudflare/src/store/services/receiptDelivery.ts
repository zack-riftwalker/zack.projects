import type { Api } from 'grammy';
import { Markup } from '../../lib/markup';
import { formatPrice } from '../utils';

export function buildReceiptCaption({ customer, order, duplicateOf, history }: {
  customer: { id: number; firstName?: string; username?: string | null };
  order: { productName: string; price: number };
  /** an earlier order that used the very same receipt file */
  duplicateOf?: { id: number; status: string; customerId: number } | null;
  /** the customer's confirmed-purchase count so far (null = unknown, no line) */
  history?: number | null;
}): string {
  const username = customer.username ? ' (@' + customer.username + ')' : '';
  const lines = [
    '🧾 رسید پرداخت جدید',
    '',
    '👤 مشتری: ' + (customer.firstName || 'مشتری') + username,
    '🆔 آیدی: ' + customer.id,
    '📦 محصول: ' + order.productName,
    '💰 قیمت: ' + formatPrice(order.price) + ' تومان',
  ];
  if (history !== undefined && history !== null) {
    lines.push(history > 0 ? '🧾 سابقه: ' + history + ' خرید تأییدشده' : '🆕 اولین خرید این مشتری');
  }
  if (duplicateOf) {
    lines.push('', '⚠️ هشدار: همین فایل رسید قبلاً برای سفارش #' + duplicateOf.id +
      ' (' + (ORDER_STATUS_FA[duplicateOf.status] ?? duplicateOf.status) + '، مشتری ' + duplicateOf.customerId + ') ارسال شده است.');
  }
  return lines.join('\n');
}

const ORDER_STATUS_FA: Record<string, string> = {
  pending: 'در انتظار بررسی', confirmed: 'تأییدشده', delivered: 'تحویل‌شده', rejected: 'ردشده',
};

export async function deliverReceiptToAdmins({ api, adminIds, sourceChatId, sourceMessageId, orderId, caption }: {
  api: Api; adminIds: number[]; sourceChatId: number; sourceMessageId: number; orderId: number | bigint; caption: string;
}) {
  const successfulAdminIds: number[] = [];
  const failures: { adminId: number; errorCode: number | null; description: string }[] = [];
  const decisionKeyboard = Markup.inlineKeyboard([[
    Markup.button.callback('✅ تایید پرداخت', 'order_confirm_' + orderId),
    Markup.button.callback('❌ رد پرداخت', 'order_reject_' + orderId),
  ]]);

  for (const adminId of adminIds) {
    try {
      await api.copyMessage(adminId, sourceChatId, sourceMessageId, { caption, ...decisionKeyboard });
      successfulAdminIds.push(adminId);
    } catch (err: any) {
      failures.push({
        adminId,
        errorCode: err?.error_code ?? err?.code ?? null,
        description: err?.description ?? err?.message ?? String(err),
      });
    }
  }
  return { successfulAdminIds, failures };
}

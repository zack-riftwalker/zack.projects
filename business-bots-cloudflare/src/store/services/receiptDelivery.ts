import type { Api } from 'grammy';
import { Markup } from '../../lib/markup';
import { formatPrice } from '../utils';

export function buildReceiptCaption({ customer, order }: {
  customer: { id: number; firstName?: string; username?: string | null };
  order: { productName: string; price: number };
}): string {
  const username = customer.username ? ' (@' + customer.username + ')' : '';
  return [
    '🧾 رسید پرداخت جدید',
    '',
    '👤 مشتری: ' + (customer.firstName || 'مشتری') + username,
    '🆔 آیدی: ' + customer.id,
    '📦 محصول: ' + order.productName,
    '💰 قیمت: ' + formatPrice(order.price) + ' تومان',
  ].join('\n');
}

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

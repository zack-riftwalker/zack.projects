import type { StoreApp } from '../apps';
import { BudgetExceededError } from '../lib/budget';
import { Markup } from '../lib/markup';
import { formatJalaliDate, parseLocalDateTime } from './utils';
import { RENEWAL_NOTE } from './labels';
import type { Order } from './db';

export const STALLED_THRESHOLD_HOURS = 20; // alert admins 20h after confirm (24h promise)
const RESERVE = 6;

/** Plain text (no parse_mode) so product names never break Markdown parsing. */
export function reminderText(kind: '7d' | '3d' | 'expired', order: Order): string {
  if (kind === 'expired') {
    return '⛔️ اشتراک «' + order.product_name + '» شما به پایان رسید.\n\n' +
      'برای ادامه استفاده می‌توانید از دکمه زیر یک اشتراک جدید تهیه کنید.\n\n' + RENEWAL_NOTE;
  }

  const expiresMs = parseLocalDateTime(order.expires_at!);
  const daysLeft = expiresMs === null
    ? (kind === '7d' ? 7 : 3)
    : Math.max(1, Math.ceil((expiresMs - Date.now()) / 86400000));

  return '⏳ یادآوری: از اشتراک «' + order.product_name + '» شما ' + daysLeft +
    ' روز باقی مانده است (تا ' + formatJalaliDate(order.expires_at!) + ').\n\n' +
    'برای جلوگیری از قطع دسترسی، می‌توانید از همین حالا تمدید کنید.\n\n' + RENEWAL_NOTE;
}

/**
 * One pass over the three reminder kinds. Returns true when every due
 * reminder was processed (false = budget ran out, continue next tick).
 * Flags are set even for failed sends so a dead chat can't retry forever.
 */
export async function sendReminders(app: StoreApp): Promise<boolean> {
  const budget = app.apps.budget;
  let complete = true;
  for (const kind of ['7d', '3d', 'expired'] as const) {
    if (budget.remaining() <= RESERVE) return false;
    const due = await app.db.getOrdersDueForReminder(kind);
    const processed: number[] = [];
    for (const order of due) {
      if (budget.remaining() <= RESERVE) {
        complete = false;
        break;
      }
      try {
        await app.api.sendMessage(order.customer_telegram_id, reminderText(kind, order), {
          ...Markup.inlineKeyboard([[
            Markup.button.callback('🔄 تمدید / خرید مجدد', 'renew_' + order.customer_product_id),
          ]]),
        });
        console.log('⏰ [Scheduler] ' + kind + ' reminder sent for order #' + order.id + '.');
      } catch (err: any) {
        if (err instanceof BudgetExceededError) {
          complete = false;
          break;
        }
        console.warn('⚠️ [Scheduler] ' + kind + ' reminder failed for order #' + order.id + ':', err.message);
      }
      processed.push(order.id);
    }
    if (processed.length) {
      try {
        await app.db.setOrderRemindersSent(processed, kind);
      } catch (err: any) {
        console.error('❌ [Scheduler] setOrderRemindersSent failed:', err.message);
        complete = false;
      }
    }
  }
  return complete;
}

/** Alerts admins about confirmed-but-undelivered orders older than the threshold (once per order). */
export async function checkStalledOrders(app: StoreApp): Promise<void> {
  const budget = app.apps.budget;
  for (const order of await app.db.getStalledConfirmedOrders(STALLED_THRESHOLD_HOURS)) {
    if (budget.remaining() <= RESERVE + app.cfg.adminIds.length) return;
    const msg =
      '⏰ هشدار سفارش معطل!\n\n' +
      'سفارش #' + order.id + ' («' + order.product_name + '») بیش از ' + STALLED_THRESHOLD_HOURS +
      ' ساعت پیش تایید شده ولی هنوز تحویل نشده است.\n' +
      '👤 مشتری: ' + order.customer_telegram_id + '\n\n' +
      '⚠️ مهلت ۲۴ ساعته‌ی قول داده‌شده در حال تمام شدن است!';

    for (const adminId of app.cfg.adminIds) {
      try {
        await app.api.sendMessage(adminId, msg);
      } catch (err: any) {
        console.warn('⚠️ [Scheduler] Stalled alert to admin ' + adminId + ' failed:', err.message);
      }
    }

    try {
      await app.db.setStalledAlertSent(order.id);
    } catch (err: any) {
      console.error('❌ [Scheduler] setStalledAlertSent failed for order #' + order.id + ':', err.message);
    }
    console.log('⏰ [Scheduler] Stalled-order alert sent for order #' + order.id + '.');
  }
}

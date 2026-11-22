import type { StoreApp } from '../apps';
import { BudgetExceededError } from '../lib/budget';
import { Markup } from '../lib/markup';
import { formatJalaliDate, parseLocalDateTime } from './utils';
import { tehranDateTime, tehranParts } from '../lib/time';
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

// ─── Abandoned checkout reminder (round 4, CAMPAIGN_PLAN.md §4) ───────────────

export const CART_REMINDER_KEY = 'cart_reminder_enabled';
/** units left for the supplier orders and the broadcast; at most this many rows per tick so a tick never eats more than ~13 */
const CART_RESERVE = 10;
const CART_PER_TICK = 4;
const CART_MIN_AGE_MIN = 60;
const CART_MAX_AGE_H = 23;
const CART_PURGE_H = 48;
/** Tehran hours 00–07 are quiet: drafts wait for 08:00 (their 23 h window still applies). */
const QUIET_HOURS_END = 8;

export const cartReminderText = (productName: string) =>
  '🛒 سفارش «' + productName + '» نیمه‌کاره مانده!\n\n' +
  'اگر پرداخت را انجام داده‌اید، همین‌جا عکس یا فایل رسید را بفرستید. اگر سؤالی دارید، به پشتیبانی پیام بدهید.';

/**
 * Cron (minute % 10 === 7): one reminder per abandoned draft, only while the toggle is on, never at night.
 * Needs only a handful of budget units: every row costs two (order check + send), the batched updates one each.
 */
export async function sendCartReminders(app: StoreApp): Promise<void> {
  const budget = app.apps.budget;
  if (budget.remaining() <= CART_RESERVE + 4) return;
  if ((await app.kv.get(CART_REMINDER_KEY)) !== '1') return;
  const now = app.apps.now();
  if (tehranParts(now).hour < QUIET_HOURS_END) return;

  const ago = (ms: number) => tehranDateTime(new Date(now.getTime() - ms));
  const rows = await app.db.getDueCheckoutDrafts(ago(CART_MIN_AGE_MIN * 60_000), ago(CART_MAX_AGE_H * 3_600_000), CART_PER_TICK);
  const candidates: typeof rows = [];
  const alreadyOrdered: number[] = [];
  for (const row of rows) {
    if (budget.remaining() <= CART_RESERVE + 3) break; // the check, the claim and a send must still fit
    try {
      if (await app.db.hasOrderSince(row.customer_telegram_id, row.created_at)) alreadyOrdered.push(row.customer_telegram_id);
      else candidates.push(row);
    } catch (err: any) {
      if (err instanceof BudgetExceededError) break;
      console.warn('⚠️ [Scheduler] cart reminder order check for ' + row.customer_telegram_id + ' failed:', err.message);
    }
  }
  try {
    // mark first, send after: a failed bookkeeping step must never mean a second reminder (a missed one is the lesser evil)
    const sendable = candidates.slice(0, Math.max(0, budget.remaining() - CART_RESERVE - 1));
    const claimed = new Set(await app.db.claimDraftsForReminder(sendable.map((r) => r.customer_telegram_id)));
    for (const row of sendable) {
      if (!claimed.has(row.customer_telegram_id)) continue; // a concurrent tick has it
      if (budget.remaining() <= CART_RESERVE) break;
      try {
        await app.api.sendMessage(row.customer_telegram_id, cartReminderText(row.product_name), {
          ...Markup.inlineKeyboard([[Markup.button.callback('🛍 ادامه‌ی خرید', 'cust_prod_' + row.product_id)]]),
        });
      } catch (err: any) {
        if (err instanceof BudgetExceededError) break;
        console.warn('⚠️ [Scheduler] cart reminder to ' + row.customer_telegram_id + ' failed:', err.message); // already marked: a dead chat can't retry forever
      }
    }
  } catch (err: any) {
    if (err instanceof BudgetExceededError) return;
    console.error('❌ [Scheduler] cart reminder claim failed:', err.message);
  }
  // housekeeping, best-effort and only while the budget has room above the reserve
  for (const job of [
    () => (alreadyOrdered.length && budget.remaining() > CART_RESERVE ? app.db.deleteCheckoutDrafts(alreadyOrdered) : Promise.resolve()),
    () => (budget.remaining() > CART_RESERVE ? app.db.purgeCheckoutDraftsBefore(ago(CART_PURGE_H * 3_600_000)) : Promise.resolve()),
  ]) {
    try {
      await job();
    } catch (err: any) {
      if (err instanceof BudgetExceededError) return;
      console.error('❌ [Scheduler] cart reminder bookkeeping failed:', err.message);
    }
  }
}
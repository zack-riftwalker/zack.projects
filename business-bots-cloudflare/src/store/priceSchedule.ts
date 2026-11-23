import type { StoreApp } from '../apps';
import { BudgetExceededError } from '../lib/budget';
import { formatJalaliDateTime, formatPrice, tehranDateTime } from '../lib/time';
import type { DueSchedule } from './db';
import { sendToAdmins } from './customerRef';
import { escapeHtml } from './utils';

const MIN_BUDGET = 10; // a tick with less than this left does nothing
const START_COST = 3; // claim + apply + close-if-unapplied (one batch)
const END_COST = 2; // guarded revert + finish (one batch)
const UNAPPLIED_COST = 1; // the fallback close when the batch's own close did not run

/** One message to every admin, best effort: a failed notice never undoes a price change (the price statements are already committed). */
async function notify(app: StoreApp, html: string): Promise<void> {
  if (app.apps.budget.remaining() < 1) return;
  try {
    await sendToAdmins(app, html);
  } catch (err: any) {
    if (err instanceof BudgetExceededError) return;
    console.warn('⚠️ [PriceSchedule] admin notice failed:', err?.message ?? err);
  }
}

const nameOf = (row: DueSchedule) => escapeHtml(row.product_name ?? '#' + row.product_id);

/** returns the notice line for this row (or null for none) */
async function startOne(app: StoreApp, row: DueSchedule, nowLocal: string): Promise<string | null> {
  if (row.ends_at <= nowLocal) {
    await app.db.expireSchedule(row.id); // the window passed before we could start: nothing else
    return null;
  }
  const r = await app.db.startSchedule(row);
  if (r.claimed !== 1) return null; // a concurrent tick has it
  if (r.applied !== 1) {
    if (r.closed !== 1) await app.db.closeSchedule(row.id, 'not applied: product inactive, auto-priced or already at or below the sale price');
    return '⚠️ قیمت جشنواره‌ی «' + nameOf(row) + '» اعمال نشد (محصول غیرفعال یا خودکار است، یا قیمتش از قیمت جشنواره کمتر یا برابر است).';
  }
  return '🔥 قیمت جشنواره‌ی «' + nameOf(row) + '» فعال شد: ' + formatPrice(row.sale_price) + ' تومان (قبلاً ' + formatPrice(r.normalPrice ?? 0) + ')\n' +
    '⏰ تا ' + formatJalaliDateTime(row.ends_at);
}

async function endOne(app: StoreApp, row: DueSchedule): Promise<string | null> {
  const r = await app.db.endSchedule(row);
  if (r.finished !== 1) return null; // a concurrent tick (or the admin's cancel) has it
  if (r.reverted !== 1) {
    await app.db.setScheduleNote(row.id, 'price changed by hand; not reverted');
    return '⚠️ قیمت «' + nameOf(row) + '» وسط جشنواره دستی عوض شده بود؛ برنگرداندم. لطفاً خودتان چک کنید.';
  }
  return '✅ جشنواره‌ی «' + nameOf(row) + '» تمام شد؛ قیمت برگشت به ' + formatPrice(row.normal_price ?? 0) + ' تومان.';
}

/**
 * Every minute: starts and ends scheduled sale prices (PRICE_SCHEDULE_PLAN.md §2). One cheap select per normal tick;
 * every price change is a conditional UPDATE inside one batch with its schedule update, so a retry or a
 * concurrent tick can never apply or revert twice. Admins get ONE combined notice per tick, after the loop, so a tight budget
 * is spent on the prices first.
 */
export async function applyPriceSchedules(app: StoreApp): Promise<void> {
  const budget = app.apps.budget;
  if (budget.remaining() <= MIN_BUDGET) return;
  const nowLocal = tehranDateTime(app.apps.now());
  const lines: string[] = [];
  const noticeReserve = Math.min(app.cfg.adminIds.length, 2); // the notice itself is best effort: never worth a late price
  try {
    const rows = await app.db.getDueSchedules(nowLocal);
    for (const row of rows) {
      const cost = (row.status === 'pending' ? START_COST : END_COST) + noticeReserve;
      if (budget.remaining() < cost) break; // the rest is retried next minute
      try {
        const line = row.status === 'pending' ? await startOne(app, row, nowLocal) : await endOne(app, row);
        if (line) lines.push(line);
      } catch (err: any) {
        if (err instanceof BudgetExceededError) throw err;
        console.error('❌ [PriceSchedule] schedule ' + row.id + ' failed:', err?.message ?? err); // retried next minute
      }
    }
  } catch (err: any) {
    if (!(err instanceof BudgetExceededError)) throw err; // else: the rest is retried next minute: every step is a conditional update
  }
  if (lines.length) await notify(app, lines.join('\n\n'));
}

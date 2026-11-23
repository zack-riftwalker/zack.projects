import type { StoreApp } from '../apps';
import { BudgetExceededError } from '../lib/budget';
import { formatJalaliDateTime, formatPrice, tehranDateTime } from '../lib/time';
import type { DueSchedule } from './db';
import { sendToAdmins } from './customerRef';
import { escapeHtml } from './utils';

const MIN_BUDGET = 10; // a tick with less than this left does nothing
const ROW_FLOOR = 8; // stop taking rows below this

/** A failed notice never undoes a price change (the price statements are already committed). */
async function notify(app: StoreApp, html: string): Promise<void> {
  try {
    await sendToAdmins(app, html);
  } catch (err: any) {
    if (err instanceof BudgetExceededError) throw err;
    console.warn('⚠️ [PriceSchedule] admin notice failed:', err?.message ?? err);
  }
}

const nameOf = (row: DueSchedule) => escapeHtml(row.product_name ?? '#' + row.product_id);

async function startOne(app: StoreApp, row: DueSchedule, nowLocal: string): Promise<void> {
  if (row.ends_at <= nowLocal) {
    await app.db.expireSchedule(row.id); // the window passed before we could start: nothing else
    return;
  }
  const r = await app.db.startSchedule(row);
  if (r.claimed !== 1) return; // a concurrent tick has it
  if (r.applied !== 1) {
    await app.db.closeSchedule(row.id, 'not applied: product inactive, auto-priced or already at or below the sale price');
    await notify(app, '⚠️ قیمت جشنواره‌ی «' + nameOf(row) + '» اعمال نشد (محصول غیرفعال یا خودکار است، یا قیمتش از قیمت جشنواره کمتر یا برابر است).');
    return;
  }
  await notify(app,
    '🔥 قیمت جشنواره‌ی «' + nameOf(row) + '» فعال شد: ' + formatPrice(row.sale_price) + ' تومان (قبلاً ' + formatPrice(row.current_price ?? 0) + ')\n' +
    '⏰ تا ' + formatJalaliDateTime(row.ends_at));
}

async function endOne(app: StoreApp, row: DueSchedule): Promise<void> {
  const r = await app.db.endSchedule(row);
  if (r.finished !== 1) return; // a concurrent tick (or the admin's cancel) has it
  if (r.reverted !== 1) {
    await app.db.setScheduleNote(row.id, 'price changed by hand; not reverted');
    await notify(app, '⚠️ قیمت «' + nameOf(row) + '» وسط جشنواره دستی عوض شده بود؛ برنگرداندم. لطفاً خودتان چک کنید.');
    return;
  }
  await notify(app, '✅ جشنواره‌ی «' + nameOf(row) + '» تمام شد؛ قیمت برگشت به ' + formatPrice(row.normal_price ?? 0) + ' تومان.');
}

/**
 * Every minute: starts and ends scheduled sale prices (PRICE_SCHEDULE_PLAN.md §2). One cheap select per normal tick;
 * every price change is a conditional UPDATE inside one batch with its schedule update, so a retry or a
 * concurrent tick can never apply or revert twice.
 */
export async function applyPriceSchedules(app: StoreApp): Promise<void> {
  const budget = app.apps.budget;
  if (budget.remaining() <= MIN_BUDGET) return;
  const nowLocal = tehranDateTime(app.apps.now());
  try {
    const rows = await app.db.getDueSchedules(nowLocal);
    for (const row of rows) {
      // a start/end costs ≤ 2 statements + one message per admin
      if (budget.remaining() <= ROW_FLOOR || budget.remaining() < app.cfg.adminIds.length + 4) break;
      try {
        if (row.status === 'pending') await startOne(app, row, nowLocal);
        else if (row.status === 'active') await endOne(app, row);
      } catch (err: any) {
        if (err instanceof BudgetExceededError) throw err;
        console.error('❌ [PriceSchedule] schedule ' + row.id + ' failed:', err?.message ?? err); // retried next minute
      }
    }
  } catch (err: any) {
    if (err instanceof BudgetExceededError) return; // the rest is retried next minute: every step is a conditional update
    throw err;
  }
}

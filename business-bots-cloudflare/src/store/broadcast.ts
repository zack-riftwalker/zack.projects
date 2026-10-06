import { GrammyError } from 'grammy';
import type { StoreApp } from '../apps';
import { BudgetExceededError } from '../lib/budget';

const BATCH_SIZE = 40;

/**
 * Sends one batch of the oldest running announcement job. Cursor-based and
 * idempotent: a 429 or an exhausted budget stops the loop without skipping
 * a customer; the next cron tick continues from the cursor.
 */
export async function processBroadcastBatch(app: StoreApp, opts: { reserve: number }): Promise<void> {
  const budget = app.apps.budget;
  let job;
  try {
    job = await app.db.getRunningBroadcast();
  } catch (err: any) {
    if (err instanceof BudgetExceededError) return;
    throw err;
  }
  if (!job) return;

  const n = Math.min(BATCH_SIZE, budget.remaining() - opts.reserve - 3);
  if (n <= 0) return;

  const customers = await app.db.getCustomerBatch(job.cursor_customer_id, n);
  let cursor = job.cursor_customer_id;
  let sent = job.sent;
  let failed = job.failed;
  let stopped = false;

  for (const c of customers) {
    try {
      await app.api.sendMessage(c.telegram_id, job.text, { entities: job.entities || undefined });
      sent++;
    } catch (err: any) {
      if (err instanceof BudgetExceededError) {
        stopped = true;
        break;
      }
      if (err instanceof GrammyError && err.error_code === 429) {
        stopped = true;
        break;
      }
      failed++;
      console.warn('⚠️ [Announce] Failed to deliver to ' + c.telegram_id + ':', err.message);
    }
    cursor = c.id;
  }

  const finished = !stopped && customers.length < n;
  try {
    if (finished) {
      await app.db.finishBroadcast(job.id, cursor, sent, failed);
    } else {
      await app.db.updateBroadcastProgress(job.id, cursor, sent, failed);
    }
  } catch (err) {
    if (!(err instanceof BudgetExceededError)) throw err;
    console.error('❌ [Announce] Could not persist broadcast progress (budget).');
    return;
  }

  if (finished) {
    try {
      await app.api.sendMessage(
        job.admin_chat_id,
        '✅ *اطلاعیه ارسال شد.*\n\n' +
          '📨 ارسال موفق: ' + sent + ' مشتری\n' +
          (failed > 0 ? '⚠️ ارسال ناموفق: ' + failed + ' مشتری\n' : ''),
        { parse_mode: 'Markdown' },
      );
    } catch (err: any) {
      console.warn('⚠️ [Announce] Summary to admin failed:', err.message);
    }
    console.log('📢 [Announce] Broadcast sent: ' + sent + ' ok, ' + failed + ' failed, ' + job.total + ' total.');
  }
}

import { GrammyError } from 'grammy';
import type { StoreApp } from '../apps';
import { BudgetExceededError } from '../lib/budget';
import type { BroadcastJob } from './db';

export { audienceFilter } from './audience';

const BATCH_SIZE = 40;
/** Longer than any batch can take (40 sends + the 25 s webhook window); expires on its own if never released. */
const LEASE_MS = 90_000;

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

  // lease (1) + job re-read (1) + customer batch (1) + progress (1) + release (1) + summary (1) still needed
  if (budget.remaining() - opts.reserve - 6 <= 0) return;
  const nowMs = app.apps.now().getTime();
  const token = nowMs + LEASE_MS;
  if (!(await app.db.acquireBroadcastLease(nowMs, token))) return; // another invocation is sending
  let finished: boolean;
  let sent: number;
  let failed: number;
  try {
    // re-read under the lease: the cursor may have moved while another invocation held it
    job = await app.db.getRunningBroadcast();
    if (!job) return;
    const r = await sendBatch(app, job, opts);
    if (!r) return;
    ({ finished, sent, failed } = r);
  } finally {
    await app.db.releaseBroadcastLease(token).catch((err) => {
      console.warn('⚠️ [Announce] Lease release failed (expires by itself):', err?.message ?? err);
    });
  }

  if (finished) {
    let summary =
      '✅ *اطلاعیه ارسال شد.*\n\n' +
      '📨 ارسال موفق: ' + sent + ' مشتری\n' +
      (failed > 0 ? '⚠️ ارسال ناموفق: ' + failed + ' مشتری\n' : '');
    const waitMatch = /^waitlist:(\d+)$/.exec(job!.audience ?? '');
    if (waitMatch) {
      // the restock notice went out: those customers leave the waitlist (later joiners stay)
      const pid = parseInt(waitMatch[1], 10);
      try {
        const product = await app.db.getCustomerProductById(pid);
        if (job!.created_at) await app.db.clearWaitlist(pid, job!.created_at);
        summary =
          '✅ به ' + sent + ' نفر از لیست انتظار «' + (product?.name ?? pid) + '» خبر داده شد.\n' +
          (failed > 0 ? '⚠️ ارسال ناموفق: ' + failed + ' نفر\n' : '');
        await app.api.sendMessage(job!.admin_chat_id, summary);
        console.log('📢 [Announce] Waitlist notice for product ' + pid + ': ' + sent + ' ok, ' + failed + ' failed.');
      } catch (err: any) {
        console.warn('⚠️ [Announce] Waitlist cleanup/summary failed:', err.message);
      }
      return;
    }
    try {
      await app.api.sendMessage(job!.admin_chat_id, summary, { parse_mode: 'Markdown' });
    } catch (err: any) {
      console.warn('⚠️ [Announce] Summary to admin failed:', err.message);
    }
    console.log('📢 [Announce] Broadcast sent: ' + sent + ' ok, ' + failed + ' failed, ' + job!.total + ' total.');
  }
}

async function sendBatch(
  app: StoreApp, job: BroadcastJob, opts: { reserve: number },
): Promise<{ finished: boolean; sent: number; failed: number } | null> {
  const n = Math.min(BATCH_SIZE, app.apps.budget.remaining() - opts.reserve - 4);
  if (n <= 0) return null;

  const customers = await app.db.getCustomerBatch(job.cursor_customer_id, n, job.audience ?? 'all');
  let markup: any;
  if (job.reply_markup) {
    try {
      markup = JSON.parse(job.reply_markup);
    } catch {
      markup = undefined;
    }
  }
  let cursor = job.cursor_customer_id;
  let sent = job.sent;
  let failed = job.failed;
  let stopped = false;

  for (const c of customers) {
    try {
      await app.api.sendMessage(c.telegram_id, job.text, { entities: job.entities || undefined, ...(markup ? { reply_markup: markup } : {}) });
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
    return null;
  }
  return { finished, sent, failed };
}

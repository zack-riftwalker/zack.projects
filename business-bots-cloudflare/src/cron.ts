import { createApps, type Deps } from './apps';
import type { Env } from './env';
import { getAppState, setAppState } from './lib/appstate';
import { tehranParts } from './lib/time';
import { processBroadcastBatch } from './store/broadcast';
import { checkStalledOrders, sendReminders } from './store/scheduler';

const REMINDER_HOUR_TEHRAN = 11;

async function guarded(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err: any) {
    console.error('❌ [Cron] ' + name + ' failed:', err?.message ?? err);
  }
}

/** One tick of the every-minute cron: incremental, idempotent jobs sharing one 50-call budget. */
export async function runCron(env: Env, now: Date = new Date(), deps: Deps = {}): Promise<void> {
  const apps = createApps(env, deps);
  const t = tehranParts(now);

  if (apps.store) {
    const store = apps.store;

    if (t.minute % 10 === 0) {
      await guarded('stalled-orders', () => checkStalledOrders(store));
    }

    if (t.hour === REMINDER_HOUR_TEHRAN) {
      await guarded('reminders', async () => {
        if ((await getAppState(store.raw, 'reminders_done_day')) === t.day) return;
        const complete = await sendReminders(store);
        if (complete) await setAppState(store.raw, 'reminders_done_day', t.day);
      });
    }
  }

  // Monshi weekly digest is added in M8.

  if (apps.store) {
    const store = apps.store;
    await guarded('broadcast', () => processBroadcastBatch(store, { reserve: 2 }));
  }
}

/**
 * Fast Eitaa poller: a Durable Object whose alarm polls every POLL_INTERVAL_MS, so a customer gets the auto-reply in
 * seconds instead of up to a minute (the cron's floor). Each alarm is its own invocation with its own 50-call budget.
 * The every-minute cron keeps the alarm chain alive and polls itself if this object has gone quiet.
 * (Eitaa has no long-poll: an http_wait probe got an immediate error, Nov 2026 — so polling it is.)
 */
import { createApps, type Apps, type Deps } from '../../apps';
import type { Env } from '../../env';
import { pollEitaa } from './poll';

export const POLL_INTERVAL_MS = 5_000;
// quiet this long (dead, or over a free-plan limit) → the cron polls instead
export const STALE_MS = 90_000;
const ALIVE_UNTIL = 'alive_until';

export class EitaaPoller {
  constructor(private state: DurableObjectState, private env: Env, private deps: Deps = {}) {}

  /** The cron's ping: (re)starts the alarm chain, answers until when this object counts as alive. */
  async fetch(): Promise<Response> {
    const now = Date.now();
    if ((await this.state.storage.getAlarm()) === null) {
      await this.state.storage.setAlarm(now);
      await this.state.storage.put(ALIVE_UNTIL, now + STALE_MS); // a fresh start counts as alive
      console.log('⚡ [EitaaPoller] alarm chain started');
    }
    return Response.json({ aliveUntil: (await this.state.storage.get<number>(ALIVE_UNTIL)) ?? 0 });
  }

  async alarm(): Promise<void> {
    // next tick first: nothing below may end the chain
    await this.state.storage.setAlarm(Date.now() + POLL_INTERVAL_MS);
    const apps = createApps(this.env, this.deps);
    if (!apps.monshi) return;
    let waitMs = 0;
    try {
      const flood = await pollEitaa(apps.monshi, 0);
      if (flood) {
        waitMs = Math.max(flood, 60) * 1000;
        console.warn('⏳ [Eitaa] FLOOD_WAIT ' + flood + 's: fast poller backs off');
        await this.state.storage.setAlarm(Date.now() + waitMs);
      }
    } catch (err) {
      console.error('❌ [EitaaPoller] tick failed:', err instanceof Error ? err.message : err);
    }
    // a flood back-off is not death: the cron must not poll in its place
    await this.state.storage.put(ALIVE_UNTIL, Date.now() + waitMs + STALE_MS);
  }
}

/** For the cron: true when the fast poller is running (it then skips its own poll). Costs one subrequest. */
export async function fastPollerAlive(env: Env, apps: Apps): Promise<boolean> {
  if (!env.EITAA_POLLER) return false;
  try {
    apps.budget.take();
    const ns = env.EITAA_POLLER;
    const res = await ns.get(ns.idFromName('main')).fetch('https://eitaa-poller/');
    const { aliveUntil } = (await res.json()) as { aliveUntil: number };
    const alive = apps.now().getTime() < aliveUntil;
    if (!alive) console.warn('⚠️ [EitaaPoller] quiet since ' + new Date(aliveUntil - STALE_MS).toISOString() + ', the cron polls');
    return alive;
  } catch (err) {
    console.error('❌ [EitaaPoller] ping failed, the cron polls:', err instanceof Error ? err.message : err);
    return false;
  }
}

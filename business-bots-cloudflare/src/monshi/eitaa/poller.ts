/**
 * Fast Eitaa poller: a Durable Object whose alarm polls every POLL_INTERVAL_MS, so a customer gets the auto-reply in
 * seconds instead of up to a minute (the cron's floor). Each alarm is its own invocation with its own 50-call budget.
 * The every-minute cron keeps the alarm chain alive and polls itself if this object has gone quiet.
 */
import { createApps, type Apps, type Deps } from '../../apps';
import type { Env } from '../../env';
import { decodeResponse, encodeCall, ENDPOINT } from './client';
import { pollEitaa } from './poll';
import { loadSession } from './session';

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
      await longPollProbe(this.state, apps);
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
    return apps.now().getTime() < aliveUntil;
  } catch (err) {
    console.error('❌ [EitaaPoller] ping failed, the cron polls:', err instanceof Error ? err.message : err);
    return false;
  }
}

/**
 * shortcut: one-time experiment (idea 3) — does Eitaa hold an `http_wait` open until an update arrives (long-poll)?
 * Logs how long the call took and what came back; remove once the answer is in the logs.
 */
async function longPollProbe(state: DurableObjectState, apps: Apps): Promise<void> {
  if (await state.storage.get('lp_probe_done')) return;
  await state.storage.put('lp_probe_done', 1);
  const s = await loadSession(apps.monshi!);
  if (!s) return;
  const t0 = Date.now();
  let out: string;
  try {
    // http_wait is an MTProto service method: serialized from that schema, sent like any other call
    apps.budget.take();
    const body = encodeCall(s, 'http_wait', { max_delay: 0, wait_after: 0, max_wait: 10000 }, true);
    const res = await apps.fetch(ENDPOINT, { method: 'POST', body, signal: AbortSignal.timeout(14000) });
    const buf = new Uint8Array(await res.arrayBuffer());
    let r: any;
    try { r = decodeResponse(buf); } catch { r = { _: 'undecodable ' + buf.length + 'B' }; }
    out = 'HTTP ' + res.status + ' ' + String(r?._ ?? typeof r) + (r?.error_message ? ' ' + r.error_message : '');
  } catch (err) {
    out = 'error ' + (err instanceof Error ? err.message : String(err)).slice(0, 120);
  }
  console.log('🧪 [Eitaa long-poll probe] ' + (Date.now() - t0) + 'ms → ' + out);
}

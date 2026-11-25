import { describe, expect, it } from 'vitest';
import { makeTestEnv, OWNER, type TestEnv } from '../helpers/env';
import { textUpdate } from '../helpers/updates';
import { one } from '../helpers/seed';
import { difference, fakeEitaa, eMsg, eUser, peerUser, state } from '../helpers/fakeEitaa';
import { runCron } from '../../src/cron';
import { EitaaPoller, POLL_INTERVAL_MS, STALE_MS } from '../../src/monshi/eitaa/poller';

const CUSTOMER = 555;

async function setup() {
  const e = fakeEitaa();
  const t = makeTestEnv({ store: false, fetch: e.fetch });
  e.respond('auth.sendCode', { _: 'auth.sentCode', flags: 0, type: { _: 'auth.sentCodeTypeApp', length: 5 }, phone_code_hash: 'h1' });
  e.respond('auth.signIn', { _: 'auth.authorization', flags: 0, token: 'TOKEN', user: eUser(69152770, 'پشتیبانی') });
  await t.send('monshi', textUpdate(OWNER, '/eitaa_login 09137780948'));
  e.respond('updates.getState', state(100));
  await t.send('monshi', textUpdate(OWNER, '/eitaa_code 12345'));
  return { t, e };
}

function fakeState() {
  const data = new Map<string, any>();
  let alarm: number | null = null;
  const storage = {
    get: async (k: string) => data.get(k),
    put: async (k: string, v: any) => void data.set(k, v),
    getAlarm: async () => alarm,
    setAlarm: async (at: number | Date) => void (alarm = typeof at === 'number' ? at : at.getTime()),
  };
  return { storage, data, alarm: () => alarm } as any;
}

const PROBE = 'unknown:-1835453025'; // http_wait (MTProto schema; the fake only names API methods)
const inMessages = (t: TestEnv) => one(t.monshiDb, "SELECT COUNT(*) AS n FROM messages WHERE chat_id = ? AND direction = 'in'", -CUSTOMER).n;

describe('Eitaa fast poller (Durable Object alarm)', () => {
  it('polls on each alarm, chains the next one 5 s later, and runs the long-poll probe only once', async () => {
    const { t, e } = await setup();
    const st = fakeState();
    const p = new EitaaPoller(st, t.env, t.deps);
    e.respond('updates.getDifference', difference(101, [eMsg(1, peerUser(CUSTOMER), 'سلام')], [eUser(CUSTOMER, 'علی')]));
    const before = Date.now();
    await p.alarm();
    expect(inMessages(t)).toBe(1);
    expect(st.alarm()).toBeGreaterThanOrEqual(before + POLL_INTERVAL_MS);
    expect(st.alarm()).toBeLessThan(before + POLL_INTERVAL_MS + 2000);
    expect(st.data.get('alive_until')).toBeGreaterThanOrEqual(before + STALE_MS);

    e.respond('updates.getDifference', { _: 'updates.differenceEmpty', date: 1, seq: 0 });
    await p.alarm();
    expect(e.methods().filter((m) => m === PROBE)).toHaveLength(1);
    expect(e.methods().filter((m) => m === 'updates.getDifference')).toHaveLength(2);
  });

  it('FLOOD_WAIT → the next alarm waits that long and the cron still counts it alive', async () => {
    const { t, e } = await setup();
    const st = fakeState();
    st.data.set('lp_probe_done', 1);
    e.respond('updates.getDifference', { _: 'rpc_error', error_code: 420, error_message: 'FLOOD_WAIT_120' });
    const before = Date.now();
    await new EitaaPoller(st, t.env, t.deps).alarm();
    expect(st.alarm()).toBeGreaterThanOrEqual(before + 120_000);
    expect(st.data.get('alive_until')).toBeGreaterThanOrEqual(before + 120_000 + STALE_MS);
  });

  it('the first ping starts the alarm chain', async () => {
    const { t } = await setup();
    const st = fakeState();
    const res = await new EitaaPoller(st, t.env, t.deps).fetch();
    expect(st.alarm()).not.toBeNull();
    expect(((await res.json()) as any).aliveUntil).toBeGreaterThan(Date.now());
  });
});

describe('cron with the fast poller', () => {
  const ns = (aliveUntil: number | Error) => ({
    idFromName: () => 'id',
    get: () => ({ fetch: async () => { if (aliveUntil instanceof Error) throw aliveUntil; return Response.json({ aliveUntil }); } }),
  }) as any;

  it('alive → the cron does not poll Eitaa itself', async () => {
    const { t, e } = await setup();
    await runCron({ ...t.env, EITAA_POLLER: ns(Date.now() + 60_000) }, new Date(), t.deps);
    expect(e.methods()).not.toContain('updates.getDifference');
  });

  it('quiet too long, or the ping fails → the cron polls as before', async () => {
    for (const dead of [Date.now() - 1, new Error('DO down')]) {
      const { t, e } = await setup();
      e.respond('updates.getDifference', difference(101, [eMsg(1, peerUser(CUSTOMER), 'سلام')], [eUser(CUSTOMER, 'علی')]));
      await runCron({ ...t.env, EITAA_POLLER: ns(dead) }, new Date(), t.deps);
      expect(inMessages(t)).toBe(1);
    }
  });
});

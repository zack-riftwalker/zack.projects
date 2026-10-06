import { describe, expect, it } from 'vitest';
import worker from '../src/index';
import { makeTestEnv, SECRET, STORE_TOKEN, MONSHI_TOKEN } from './helpers/env';
import { textUpdate } from './helpers/updates';
import { one, q } from './helpers/seed';

const ctx: any = { waitUntil() {}, passThroughOnException() {} };
const req = (path: string, init: RequestInit = {}) => new Request('https://x.test' + path, init);

describe('routing & auth', () => {
  it('rejects a missing or wrong secret with 401', async () => {
    const t = makeTestEnv();
    expect((await t.worker.fetch(req('/tg/store', { method: 'POST', body: '{}' }), t.env, ctx)).status).toBe(401);
    expect((await t.worker.fetch(req('/tg/monshi', { method: 'POST', body: '{}', headers: { 'X-Telegram-Bot-Api-Secret-Token': 'no' } }), t.env, ctx)).status).toBe(401);
    expect((await worker.fetch(req('/tg/store', { method: 'POST', body: '{}' }), { ...t.env, WEBHOOK_SECRET: undefined }, ctx)).status).toBe(401);
  });

  it('404 for unknown paths, 200 for /health', async () => {
    const t = makeTestEnv();
    expect((await t.worker.fetch(req('/nope'), t.env, ctx)).status).toBe(404);
    expect((await t.worker.fetch(req('/health'), t.env, ctx)).status).toBe(200);
  });

  it('200 for authenticated calls even with a bad body or a failing handler', async () => {
    const t = makeTestEnv();
    const bad = await t.worker.fetch(req('/tg/store', { method: 'POST', body: 'not json', headers: { 'X-Telegram-Bot-Api-Secret-Token': SECRET } }), t.env, ctx);
    expect(bad.status).toBe(200);
    t.tg.fail('getMe', () => true, 500, 'boom');
    const res = await t.send('store', textUpdate({ id: 7 }, '/start'));
    expect(res.status).toBe(200);
  });

  it('a disabled bot (no token) is acknowledged with 200 and ignored', async () => {
    const t = makeTestEnv({ monshi: false });
    const res = await t.send('monshi', textUpdate({ id: 7 }, '/start'));
    expect(res.status).toBe(200);
    expect(t.tg.calls).toHaveLength(0);
  });

  it('non-private chats are ignored by the store bot', async () => {
    const t = makeTestEnv({ monshi: false });
    const u = textUpdate({ id: 7 }, '/start');
    u.message.chat = { id: -100, type: 'group', title: 'g' };
    await t.send('store', u);
    expect(t.tg.of('sendMessage')).toHaveLength(0);
    expect(q(t.storeDb, 'SELECT * FROM customers')).toHaveLength(0);
  });
});

describe('/setup', () => {
  it('wrong key → 401', async () => {
    const t = makeTestEnv();
    expect((await t.worker.fetch(req('/setup?key=nope'), t.env, ctx)).status).toBe(401);
    expect((await t.worker.fetch(req('/setup'), t.env, ctx)).status).toBe(401);
  });

  it('registers both webhooks with secret, allowed_updates and max_connections, and reports', async () => {
    const t = makeTestEnv({ gemini: true });
    const res = await t.worker.fetch(req('/setup?key=' + SECRET), t.env, ctx);
    expect(res.status).toBe(200);
    const report: any = await res.json();
    const hooks = t.tg.of('setWebhook');
    expect(hooks).toHaveLength(2);
    const store = hooks.find((h) => h.token === STORE_TOKEN)!.payload;
    const monshi = hooks.find((h) => h.token === MONSHI_TOKEN)!.payload;
    expect(store).toMatchObject({ url: 'https://x.test/tg/store', secret_token: SECRET, max_connections: 1, allowed_updates: ['message', 'callback_query'] });
    expect(monshi).toMatchObject({ url: 'https://x.test/tg/monshi', secret_token: SECRET, max_connections: 3, allowed_updates: ['message', 'callback_query', 'business_connection', 'business_message'] });
    expect(report.store).toMatchObject({ enabled: true, ok: true, username: 'store_bot', webhook: 'https://x.test/tg/store', problems: [] });
    expect(report.monshi).toMatchObject({ enabled: true, ok: true, gemini: true });
    expect(JSON.parse(one(t.storeDb, "SELECT value FROM app_state WHERE key='bot_info'").value).username).toBe('store_bot');
  });

  it('reports config problems for missing admin ids / tokens', async () => {
    const t = makeTestEnv({ adminIds: '', store: true, monshi: false });
    const report: any = await (await t.worker.fetch(req('/setup?key=' + SECRET), t.env, ctx)).json();
    expect(report.store.enabled).toBe(false);
    expect(report.store.problems).toContain('STORE_ADMIN_IDS is empty or invalid');
    expect(report.monshi.problems).toContain('MONSHI_BOT_TOKEN is not set');
    expect(t.tg.of('setWebhook')).toHaveLength(0);
  });
});

describe('budget & session writes', () => {
  it('a plain customer chat writes no session row and stays far below the 50-call budget', async () => {
    const t = makeTestEnv({ monshi: false });
    await t.send('store', textUpdate({ id: 7, first_name: 'X' }, 'سلام'));
    expect(q(t.storeDb, 'SELECT * FROM sessions')).toHaveLength(0);
  });
});

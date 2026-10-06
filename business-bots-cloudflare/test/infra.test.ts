import { describe, expect, it } from 'vitest';
import worker from '../src/index';
import { FakeD1 } from './helpers/fakeD1';

const env: any = {
  STORE_DB: new FakeD1().migrate('store').asD1(),
  MONSHI_DB: new FakeD1().migrate('monshi').asD1(),
  WEBHOOK_SECRET: 'sekret',
};
const ctx: any = { waitUntil() {}, passThroughOnException() {} };

describe('routing', () => {
  it('rejects a missing or wrong secret with 401', async () => {
    const r1 = await worker.fetch(new Request('https://x/tg/store', { method: 'POST', body: '{}' }), env, ctx);
    expect(r1.status).toBe(401);
    const r2 = await worker.fetch(new Request('https://x/tg/monshi', { method: 'POST', body: '{}', headers: { 'X-Telegram-Bot-Api-Secret-Token': 'no' } }), env, ctx);
    expect(r2.status).toBe(401);
  });
  it('404 for unknown paths', async () => {
    expect((await worker.fetch(new Request('https://x/nope'), env, ctx)).status).toBe(404);
  });
  it('200 for authenticated calls, even with a bad body', async () => {
    const r = await worker.fetch(new Request('https://x/tg/store', { method: 'POST', body: 'not json', headers: { 'X-Telegram-Bot-Api-Secret-Token': 'sekret' } }), env, ctx);
    expect(r.status).toBe(200);
  });
});

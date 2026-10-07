import { describe, expect, it } from 'vitest';
import { ADMIN, makeTestEnv, type TestEnv } from '../helpers/env';
import { callbackUpdate, textUpdate } from '../helpers/updates';
import { one, q, seedProduct } from '../helpers/seed';
import { audienceFilter } from '../../src/store/broadcast';

const at = (utcHour: number, utcMin = 0) => new Date(Date.UTC(2026, 9, 6, utcHour, utcMin));

function customer(t: TestEnv, id: number) {
  q(t.storeDb, 'INSERT INTO customers (telegram_id, display_name) VALUES (?, ?)', id, 'c' + id);
}
function order(t: TestEnv, cust: number, pid: number, status: string, expires: string | null) {
  q(t.storeDb,
    `INSERT INTO orders (customer_telegram_id, customer_product_id, product_name, price, status, delivered_at, expires_at)
     VALUES (?, ?, 'P', 100, ?, datetime('now', '+03:30'), ${expires})`, cust, pid, status);
}

/** 1 = active sub, 2 = expired sub, 3 = never bought (pending only), 4 = buyer of product B, 5 = no orders at all */
function seed(t: TestEnv) {
  const a = seedProduct(t, { name: 'A' });
  const b = seedProduct(t, { name: 'B' });
  for (let i = 1; i <= 5; i++) customer(t, 100 + i);
  order(t, 101, a, 'delivered', "datetime('now', '+03:30', '+10 days')");
  order(t, 102, a, 'delivered', "datetime('now', '+03:30', '-1 days')");
  order(t, 103, a, 'pending', 'NULL');
  order(t, 104, b, 'confirmed', 'NULL');
  return { a, b };
}

async function run(t: TestEnv, audienceCbs: string[], text = 'Hello group') {
  await t.send('store', textUpdate(ADMIN, '📢 اطلاعیه‌ها'));
  for (const cb of audienceCbs) await t.send('store', callbackUpdate(ADMIN, cb));
  await t.send('store', textUpdate(ADMIN, text));
  await t.send('store', callbackUpdate(ADMIN, 'announce_confirm'));
  await t.cron(at(5, 1));
  return t.tg.of('sendMessage').filter((c) => c.payload.text === text).map((c) => c.payload.chat_id).sort();
}

describe('targeted announcements', () => {
  it('all', async () => {
    const t = makeTestEnv({ monshi: false });
    seed(t);
    expect(await run(t, ['ann_aud_all'])).toEqual([101, 102, 103, 104, 105]);
  });
  it('active subscriptions', async () => {
    const t = makeTestEnv({ monshi: false });
    seed(t);
    expect(await run(t, ['ann_aud_active'])).toEqual([101]);
    expect(one(t.storeDb, 'SELECT audience, total FROM broadcast_jobs')).toEqual({ audience: 'active', total: 1 });
  });
  it('expired subscriptions', async () => {
    const t = makeTestEnv({ monshi: false });
    seed(t);
    expect(await run(t, ['ann_aud_expired'])).toEqual([102]);
  });
  it('a customer with an active AND an expired subscription counts as active only', async () => {
    const t = makeTestEnv({ monshi: false });
    const { a } = seed(t);
    order(t, 101, a, 'delivered', "datetime('now', '+03:30', '-5 days')");
    expect(await run(t, ['ann_aud_expired'])).toEqual([102]);
  });
  it('never bought', async () => {
    const t = makeTestEnv({ monshi: false });
    seed(t);
    expect(await run(t, ['ann_aud_never'])).toEqual([103, 105]);
  });
  it('buyers of one product via the picker', async () => {
    const t = makeTestEnv({ monshi: false });
    const { b } = seed(t);
    expect(await run(t, ['ann_aud_buyers', 'ann_prod_' + b])).toEqual([104]);
    const confirm = t.tg.of('sendMessage', ADMIN.id).find((c) => c.payload.text.includes('ارسال خواهد شد'))!;
    expect(confirm.payload.text).toContain('1 نفر');
  });
  it('an empty audience stops before asking for text', async () => {
    const t = makeTestEnv({ monshi: false });
    const { a } = seed(t);
    q(t.storeDb, 'DELETE FROM orders');
    await t.send('store', textUpdate(ADMIN, '📢 اطلاعیه‌ها'));
    await t.send('store', callbackUpdate(ADMIN, 'ann_aud_active'));
    expect(t.tg.of('editMessageText').at(-1)!.payload.text).toContain('هیچ مشتری‌ای');
    await t.send('store', textUpdate(ADMIN, 'text'));
    expect(q(t.storeDb, 'SELECT * FROM broadcast_jobs')).toHaveLength(0);
    expect(a).toBeGreaterThan(0);
  });
  it('reply_markup is attached to every send', async () => {
    const t = makeTestEnv({ monshi: false });
    seed(t);
    const kb = { inline_keyboard: [[{ text: 'go', callback_data: 'x' }]] };
    await t.apps().store!.db.enqueueBroadcast({ adminChatId: ADMIN.id, text: 'kb', entities: null, audience: 'active', replyMarkup: kb });
    await t.cron(at(5, 1));
    const sent = t.tg.of('sendMessage').filter((c) => c.payload.text === 'kb');
    expect(sent).toHaveLength(1);
    expect(sent[0].payload.reply_markup).toEqual(kb);
  });
  it('rejects invalid audience strings', () => {
    expect(() => audienceFilter("all' OR 1=1 --")).toThrow();
    expect(() => audienceFilter('buyers:abc')).toThrow();
    expect(audienceFilter('waitlist:7').args).toEqual([7]);
  });
});

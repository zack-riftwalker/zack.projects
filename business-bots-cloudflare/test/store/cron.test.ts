import { describe, expect, it } from 'vitest';
import { ADMIN, ADMIN2, makeTestEnv, type TestEnv } from '../helpers/env';
import { callbackUpdate, textUpdate } from '../helpers/updates';
import { one, q, seedProduct } from '../helpers/seed';
import { toJalaali } from 'jalaali-js';

const at = (utcHour: number, utcMin = 0) => new Date(Date.UTC(2026, 9, 6, utcHour, utcMin)); // Tehran = UTC+3:30
const TEHRAN_11 = at(7, 30);
const TEHRAN_1030 = at(7, 0); // minute 30 → minute%10===0

function insertDelivered(t: TestEnv, pid: number, customer: number, expiresExpr: string) {
  q(t.storeDb, `INSERT INTO orders (customer_telegram_id, customer_product_id, product_name, price, receipt_file_id, receipt_type, status, delivered_at, expires_at)
    VALUES (?, ?, 'GPT Plus', 5, 'f', 'photo', 'delivered', datetime('now','+03:30','-20 days'), ${expiresExpr})`, customer, pid);
}

describe('cron: reminders', () => {
  it('7d, 3d and expired reminders are sent exactly once each', async () => {
    const t = makeTestEnv({ monshi: false });
    const pid = seedProduct(t);
    insertDelivered(t, pid, 2001, "datetime('now','+03:30','+5 days')");
    insertDelivered(t, pid, 2002, "datetime('now','+03:30','+2 days')");
    insertDelivered(t, pid, 2003, "datetime('now','+03:30','-1 days')");
    insertDelivered(t, pid, 2004, "datetime('now','+03:30','+20 days')");

    await t.cron(at(5, 0)); // not Tehran 11:00 → nothing
    expect(t.tg.of('sendMessage')).toHaveLength(0);

    await t.cron(TEHRAN_11);
    const sent = t.tg.of('sendMessage');
    expect(sent.map((c) => c.payload.chat_id).sort()).toEqual([2001, 2002, 2003]);
    expect(sent.find((c) => c.payload.chat_id === 2003)!.payload.text).toContain('اشتراک «GPT Plus» شما به پایان رسید');
    expect(sent.find((c) => c.payload.chat_id === 2001)!.payload.text).toMatch(/از اشتراک «GPT Plus» شما \d روز باقی مانده است/);
    expect(sent[0].payload.reply_markup.inline_keyboard[0][0].callback_data).toBe('renew_' + pid);
    expect(one(t.storeDb, "SELECT value FROM app_state WHERE key='reminders_done_day'").value).toBe('2026-10-06');

    t.tg.reset();
    await t.cron(at(7, 31));
    expect(t.tg.of('sendMessage')).toHaveLength(0);
    expect(q(t.storeDb, 'SELECT reminded_7d, reminded_3d, reminded_expired FROM orders WHERE customer_telegram_id IN (2001,2002,2003) ORDER BY customer_telegram_id'))
      .toEqual([{ reminded_7d: 1, reminded_3d: 0, reminded_expired: 0 }, { reminded_7d: 0, reminded_3d: 1, reminded_expired: 0 }, { reminded_7d: 0, reminded_3d: 0, reminded_expired: 1 }]);
  });

  it('a failed send still sets the flag (blocked customers are not retried)', async () => {
    const t = makeTestEnv({ monshi: false });
    const pid = seedProduct(t);
    insertDelivered(t, pid, 2003, "datetime('now','+03:30','-1 days')");
    t.tg.fail('sendMessage', (c) => c.payload.chat_id === 2003);
    await t.cron(TEHRAN_11);
    expect(one(t.storeDb, 'SELECT reminded_expired FROM orders').reminded_expired).toBe(1);
  });

  it('when the 50-call budget runs out the pass resumes next tick; nobody is reminded twice', async () => {
    const t = makeTestEnv({ monshi: false });
    const pid = seedProduct(t);
    for (let i = 0; i < 120; i++) insertDelivered(t, pid, 3000 + i, "datetime('now','+03:30','-1 days')");

    await t.cron(TEHRAN_11);
    const firstTick = t.tg.of('sendMessage').length;
    expect(firstTick).toBeGreaterThan(20);
    expect(firstTick).toBeLessThan(120);
    expect(q(t.storeDb, "SELECT * FROM app_state WHERE key='reminders_done_day'")).toHaveLength(0);

    for (let i = 1; i < 10; i++) await t.cron(at(7, 30 + i));
    const ids = t.tg.of('sendMessage').map((c) => c.payload.chat_id);
    expect(ids).toHaveLength(120);
    expect(new Set(ids).size).toBe(120);
    expect(q(t.storeDb, "SELECT * FROM app_state WHERE key='reminders_done_day'")).toHaveLength(1);
  });
});

describe('cron: stalled orders', () => {
  it('alerts every admin once, only every 10th minute', async () => {
    const t = makeTestEnv({ monshi: false });
    const pid = seedProduct(t);
    q(t.storeDb, `INSERT INTO orders (customer_telegram_id, customer_product_id, product_name, price, receipt_file_id, receipt_type, status, decided_at)
      VALUES (2002, ?, 'GPT Plus', 5, 'f', 'photo', 'confirmed', datetime('now','+03:30','-21 hours'))`, pid);

    await t.cron(at(7, 1)); // Tehran 10:31
    expect(t.tg.of('sendMessage')).toHaveLength(0);

    await t.cron(TEHRAN_1030);
    expect(t.tg.of('sendMessage').map((c) => c.payload.chat_id)).toEqual([ADMIN.id, ADMIN2.id]);
    expect(t.tg.of('sendMessage')[0].payload.text).toContain('هشدار سفارش معطل!');
    expect(one(t.storeDb, 'SELECT stalled_alert_sent FROM orders').stalled_alert_sent).toBe(1);

    await t.cron(at(7, 10));
    expect(t.tg.of('sendMessage')).toHaveLength(2);
  });
});

describe('announcement broadcast queue', () => {
  const customers = (t: TestEnv, n: number) => {
    for (let i = 0; i < n; i++) q(t.storeDb, 'INSERT INTO customers (telegram_id, display_name) VALUES (?, ?)', 4000 + i, 'c' + i);
  };
  async function startAnnounce(t: TestEnv) {
    await t.send('store', textUpdate(ADMIN, '📢 اطلاعیه‌ها'));
    await t.send('store', callbackUpdate(ADMIN, 'ann_aud_all'));
    await t.send('store', textUpdate(ADMIN, 'Big news'));
    await t.send('store', callbackUpdate(ADMIN, 'announce_confirm'));
  }

  it('first batch is sent immediately, cron ticks finish the job, admin gets one summary', async () => {
    const t = makeTestEnv({ monshi: false });
    customers(t, 90);
    await startAnnounce(t);
    expect(t.tg.of('editMessageText').at(-1)!.payload.text).toContain('ارسال به‌صورت دسته‌ای');
    const afterFirst = t.tg.of('sendMessage').filter((c) => c.payload.text === 'Big news').length;
    expect(afterFirst).toBeGreaterThan(0);
    expect(afterFirst).toBeLessThan(90);

    for (let i = 0; i < 6; i++) await t.cron(at(5, i));
    const recipients = t.tg.of('sendMessage').filter((c) => c.payload.text === 'Big news').map((c) => c.payload.chat_id);
    expect(recipients).toHaveLength(90);
    expect(new Set(recipients).size).toBe(90);
    const summaries = t.tg.of('sendMessage', ADMIN.id).filter((c) => c.payload.text.includes('اطلاعیه ارسال شد'));
    expect(summaries).toHaveLength(1);
    expect(summaries[0].payload.text).toContain('ارسال موفق: 90 مشتری');
    expect(one(t.storeDb, 'SELECT status, sent, failed FROM broadcast_jobs')).toEqual({ status: 'done', sent: 90, failed: 0 });
  });

  it('keeps entities, counts blocked customers as failed, and a 429 stops without skipping anyone', async () => {
    const t = makeTestEnv({ monshi: false });
    customers(t, 5);
    t.tg.fail('sendMessage', (c) => c.payload.chat_id === 4001, 403);
    t.tg.fail('sendMessage', (c) => c.payload.chat_id === 4003, 429, 'Too Many Requests: retry after 5', 1);
    await t.send('store', textUpdate(ADMIN, '📢 اطلاعیه‌ها'));
    await t.send('store', callbackUpdate(ADMIN, 'ann_aud_all'));
    const upd = textUpdate(ADMIN, 'Big news');
    upd.message.entities = [{ type: 'bold', offset: 0, length: 3 }];
    await t.send('store', upd);
    await t.send('store', callbackUpdate(ADMIN, 'announce_confirm'));
    expect(one(t.storeDb, 'SELECT status, cursor_customer_id FROM broadcast_jobs')).toEqual({ status: 'running', cursor_customer_id: 3 });

    await t.cron(at(5, 1));
    const sentTo = t.tg.of('sendMessage').filter((c) => c.payload.text === 'Big news');
    expect(sentTo[0].payload.entities).toEqual([{ type: 'bold', offset: 0, length: 3 }]);
    // customer 4003 was attempted twice (429 then success) and never skipped
    expect(sentTo.filter((c) => c.payload.chat_id === 4003)).toHaveLength(2);
    expect(one(t.storeDb, 'SELECT status, sent, failed FROM broadcast_jobs')).toEqual({ status: 'done', sent: 4, failed: 1 });
  });

  it('two invocations running at the same time never send to the same customer twice (lease)', async () => {
    const t = makeTestEnv({ monshi: false });
    customers(t, 30);
    q(t.storeDb, "INSERT INTO broadcast_jobs (admin_chat_id, text, total) VALUES (?, 'Big news', 30)", ADMIN.id);
    await Promise.all([t.cron(at(5, 1)), t.cron(at(5, 1)), t.cron(at(5, 1))]);
    await t.cron(at(5, 2));
    const recipients = t.tg.of('sendMessage').filter((c) => c.payload.text === 'Big news').map((c) => c.payload.chat_id);
    expect(recipients).toHaveLength(30);
    expect(new Set(recipients).size).toBe(30);
    expect(one(t.storeDb, 'SELECT status, sent FROM broadcast_jobs')).toEqual({ status: 'done', sent: 30 });
    expect(one(t.storeDb, "SELECT value FROM app_state WHERE key = 'broadcast_lease'").value).toBe('0');
  });

  it('a held lease blocks sending; an expired one (crashed invocation) does not', async () => {
    const t = makeTestEnv({ monshi: false });
    customers(t, 3);
    q(t.storeDb, "INSERT INTO broadcast_jobs (admin_chat_id, text, total) VALUES (?, 'Big news', 3)", ADMIN.id);
    q(t.storeDb, "INSERT INTO app_state (key, value) VALUES ('broadcast_lease', ?)", String(Date.now() + 60_000));
    await t.cron(at(5, 1));
    expect(t.tg.of('sendMessage').filter((c) => c.payload.text === 'Big news')).toHaveLength(0);
    q(t.storeDb, "UPDATE app_state SET value = ? WHERE key = 'broadcast_lease'", String(Date.now() - 1));
    await t.cron(at(5, 2));
    expect(t.tg.of('sendMessage').filter((c) => c.payload.text === 'Big news')).toHaveLength(3);
  });

  it('corrupt entities JSON does not block the queue (sent as plain text)', async () => {
    const t = makeTestEnv({ monshi: false });
    customers(t, 2);
    q(t.storeDb, "INSERT INTO broadcast_jobs (admin_chat_id, text, entities, total) VALUES (?, 'Big news', '{oops', 2)", ADMIN.id);
    await t.cron(at(5, 1));
    expect(t.tg.of('sendMessage').filter((c) => c.payload.text === 'Big news')).toHaveLength(2);
    expect(one(t.storeDb, 'SELECT status FROM broadcast_jobs').status).toBe('done');
  });
});

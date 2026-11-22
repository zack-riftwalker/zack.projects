import { describe, expect, it } from 'vitest';
import { ADMIN, makeTestEnv, type TestEnv } from '../helpers/env';
import { callbackUpdate, photoUpdate, textUpdate } from '../helpers/updates';
import { one, q, seedCard, seedProduct } from '../helpers/seed';
import { sendCartReminders } from '../../src/store/scheduler';

const U = (id: number) => ({ id, first_name: 'U' + id });
// 2026-10-07 11:37 Tehran (08:07 UTC), minute % 10 === 7
const NOW = new Date(Date.UTC(2026, 9, 7, 8, 7));
const QUIET_NOW = new Date(Date.UTC(2026, 9, 7, 1, 7)); // 04:37 Tehran

function setup(opts: { flag?: boolean; now?: Date } = {}) {
  const t = makeTestEnv({ monshi: false });
  t.deps.now = () => opts.now ?? NOW;
  seedProduct(t, { name: 'GPT Plus' });
  seedCard(t);
  if (opts.flag !== false) q(t.storeDb, "INSERT INTO store_kv (key, value) VALUES ('cart_reminder_enabled', '1')");
  return t;
}
const draft = (t: TestEnv, id: number, createdAt: string, reminded = 0) =>
  q(t.storeDb, "INSERT INTO checkout_drafts (customer_telegram_id, product_id, product_name, price, created_at, reminded) VALUES (?, 1, 'GPT Plus', 500000, ?, ?)", id, createdAt, reminded);
const drafts = (t: TestEnv) => q(t.storeDb, 'SELECT customer_telegram_id AS id, reminded FROM checkout_drafts ORDER BY customer_telegram_id');
const reminders = (t: TestEnv) => t.tg.of('sendMessage').filter((c) => String(c.payload.text).startsWith('🛒 سفارش «'));
const agree = async (t: TestEnv, u = U(7001)) => {
  await t.send('store', callbackUpdate(u, 'cust_prod_1'));
  await t.send('store', callbackUpdate(u, 'cust_disc_skip_1'));
  await t.send('store', callbackUpdate(u, 'cust_agree_1'));
};

describe('cart reminder: draft rows', () => {
  it('agree creates the row; the receipt deletes it', async () => {
    const t = setup();
    await agree(t);
    expect(q(t.storeDb, 'SELECT * FROM checkout_drafts')).toEqual([
      { customer_telegram_id: 7001, product_id: 1, product_name: 'GPT Plus', price: 500000, created_at: '2026-10-07 11:37:00', reminded: 0 },
    ]);
    await t.send('store', photoUpdate(U(7001), 'r1'));
    expect(drafts(t)).toEqual([]);
  });

  it('agreeing again resets the row (and its reminded flag)', async () => {
    const t = setup();
    await agree(t);
    q(t.storeDb, 'UPDATE checkout_drafts SET reminded = 1');
    await agree(t);
    expect(drafts(t)).toEqual([{ id: 7001, reminded: 0 }]);
  });

  it('decline deletes the row', async () => {
    const t = setup();
    await agree(t);
    await t.send('store', callbackUpdate(U(7001), 'cust_decline_1'));
    expect(drafts(t)).toEqual([]);
  });

  it('an expired session draft is dropped together with the row', async () => {
    const t = setup();
    await agree(t);
    t.deps.now = () => new Date(NOW.getTime() + 25 * 3_600_000);
    await t.send('store', photoUpdate(U(7001), 'late'));
    expect(t.tg.texts(7001).at(-1)).toContain('مهلت ارسال رسید');
    expect(drafts(t)).toEqual([]);
  });
});

describe('cart reminder: cron job', () => {
  it('a due row gets exactly one message with the continue button; a second tick sends nothing', async () => {
    const t = setup();
    draft(t, 7001, '2026-10-07 10:00:00');
    await t.cron(NOW);
    const sent = reminders(t);
    expect(sent).toHaveLength(1);
    expect(sent[0].payload.chat_id).toBe(7001);
    expect(sent[0].payload.text).toContain('«GPT Plus» نیمه‌کاره مانده');
    expect(sent[0].payload.reply_markup.inline_keyboard).toEqual([[{ text: '🛍 ادامه‌ی خرید', callback_data: 'cust_prod_1' }]]);
    expect(drafts(t)).toEqual([{ id: 7001, reminded: 1 }]);
    await t.cron(new Date(NOW.getTime() + 600_000));
    expect(reminders(t)).toHaveLength(1);
  });

  it('only runs at minute % 10 === 7', async () => {
    const t = setup();
    draft(t, 7001, '2026-10-07 10:00:00');
    await t.cron(new Date(Date.UTC(2026, 9, 7, 8, 8)));
    expect(reminders(t)).toHaveLength(0);
  });

  it('younger than an hour and older than 23 hours are not reminded', async () => {
    const t = setup();
    draft(t, 7001, '2026-10-07 11:00:00'); // 37 min
    draft(t, 7002, '2026-10-06 11:00:00'); // 24.6 h
    await t.cron(NOW);
    expect(reminders(t)).toHaveLength(0);
  });

  it('an order created after the draft: no message, the row is deleted', async () => {
    const t = setup();
    draft(t, 7001, '2026-10-07 10:00:00');
    q(t.storeDb, "INSERT INTO orders (customer_telegram_id, customer_product_id, product_name, price, status, created_at) VALUES (7001, 1, 'GPT Plus', 5, 'pending', '2026-10-07 10:30:00')");
    await t.cron(NOW);
    expect(reminders(t)).toHaveLength(0);
    expect(drafts(t)).toEqual([]);
  });

  it('an older order does not stop the reminder', async () => {
    const t = setup();
    draft(t, 7001, '2026-10-07 10:00:00');
    q(t.storeDb, "INSERT INTO orders (customer_telegram_id, customer_product_id, product_name, price, status, created_at) VALUES (7001, 1, 'GPT Plus', 5, 'delivered', '2026-09-01 10:30:00')");
    await t.cron(NOW);
    expect(reminders(t)).toHaveLength(1);
  });

  it('quiet hours (00–07 Tehran): nothing, rows wait', async () => {
    const t = setup({ now: QUIET_NOW });
    draft(t, 7001, '2026-10-06 22:00:00');
    await t.cron(QUIET_NOW);
    expect(reminders(t)).toHaveLength(0);
    expect(drafts(t)).toEqual([{ id: 7001, reminded: 0 }]);
  });

  it('flag off (the default): nothing', async () => {
    const t = setup({ flag: false });
    draft(t, 7001, '2026-10-07 10:00:00');
    await t.cron(NOW);
    expect(reminders(t)).toHaveLength(0);
    expect(drafts(t)).toEqual([{ id: 7001, reminded: 0 }]);
  });

  it('a dead chat is marked reminded too (no retry forever)', async () => {
    const t = setup();
    draft(t, 7001, '2026-10-07 10:00:00');
    t.tg.fail('sendMessage', (c) => c.payload.chat_id === 7001);
    await t.cron(NOW);
    expect(drafts(t)).toEqual([{ id: 7001, reminded: 1 }]);
  });

  it('rows older than 48 h are purged', async () => {
    const t = setup();
    draft(t, 7001, '2026-10-05 10:00:00');
    draft(t, 7002, '2026-10-06 10:00:00');
    await t.cron(NOW);
    expect(drafts(t).map((d) => d.id)).toEqual([7002]);
  });

  it('with little budget left the rest go out on the next tick, nobody twice', async () => {
    const t = setup();
    for (let i = 0; i < 10; i++) draft(t, 7100 + i, '2026-10-07 10:00:0' + i);
    const apps = t.apps();
    apps.budget.take(33);
    await sendCartReminders(apps.store!);
    const first = reminders(t).length;
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(10);
    expect(drafts(t).filter((d) => d.reminded === 1)).toHaveLength(first);
    for (let i = 0; i < 3; i++) await sendCartReminders(t.apps().store!); // at most 4 rows per tick
    expect(reminders(t)).toHaveLength(10);
    expect(new Set(reminders(t).map((c) => c.payload.chat_id)).size).toBe(10);
  });

  it('a tick with reminders due and a running broadcast: both make progress over two ticks', async () => {
    const t = setup();
    for (let i = 0; i < 12; i++) draft(t, 7200 + i, '2026-10-07 10:00:0' + (i % 10));
    for (let i = 0; i < 12; i++) q(t.storeDb, 'INSERT INTO customers (telegram_id, display_name) VALUES (?, ?)', 8000 + i, 'b' + i);
    q(t.storeDb, "INSERT INTO broadcast_jobs (admin_chat_id, text, status, total, audience) VALUES (?, 'HELLO ALL', 'running', 12, 'all')", ADMIN.id);
    await t.cron(NOW);
    await t.cron(new Date(NOW.getTime() + 60_000 * 3));
    expect(reminders(t).length).toBeGreaterThan(0);
    const delivered = t.tg.of('sendMessage').filter((c) => c.payload.text === 'HELLO ALL').length;
    expect(delivered).toBeGreaterThan(0);
    expect(t.maxBudget).toBeLessThanOrEqual(50);
  });
});

describe('cart reminder: review fixes', () => {
  const customer = (t: TestEnv, id: number) => q(t.storeDb, 'INSERT INTO customers (telegram_id, display_name) VALUES (?, ?)', id, 'c' + id);

  it('at most 4 reminders per tick', async () => {
    const t = setup();
    for (let i = 0; i < 10; i++) draft(t, 7300 + i, '2026-10-07 10:00:0' + i);
    await t.cron(NOW);
    expect(reminders(t)).toHaveLength(4);
  });

  it('with Eitaa leaving ~15 units, the broadcast still sends a batch on the :x7 tick', async () => {
    const LATER = new Date(Date.UTC(2026, 9, 7, 10, 7)); // 13:37 Tehran: no daily reminders job in this tick
    const t = setup({ now: LATER });
    t.deps.onBudget = (b) => b.take(35); // what the Eitaa poll took
    for (let i = 0; i < 10; i++) draft(t, 7400 + i, '2026-10-07 10:00:0' + i);
    for (let i = 0; i < 12; i++) customer(t, 8100 + i);
    q(t.storeDb, "INSERT INTO broadcast_jobs (admin_chat_id, text, status, total, audience) VALUES (?, 'HELLO ALL', 'running', 12, 'all')", ADMIN.id);
    await t.cron(LATER);
    expect(t.tg.of('sendMessage').filter((c) => c.payload.text === 'HELLO ALL').length).toBeGreaterThan(0);
    expect(reminders(t).length).toBeLessThanOrEqual(4);
  });

  it('the draft is marked reminded BEFORE the message goes out (a failed bookkeeping step can never mean a second reminder)', async () => {
    const t = setup();
    draft(t, 7001, '2026-10-07 10:00:00');
    const seen: number[] = [];
    t.tg.fail('sendMessage', (c) => {
      if (c.payload.chat_id === 7001) seen.push(drafts(t)[0].reminded);
      return false;
    });
    await t.cron(NOW);
    expect(seen).toEqual([1]);
  });

  it('two overlapping ticks remind each customer once', async () => {
    const t = setup();
    for (let i = 0; i < 3; i++) draft(t, 7500 + i, '2026-10-07 10:00:0' + i);
    await Promise.all([sendCartReminders(t.apps().store!), sendCartReminders(t.apps().store!)]);
    expect(reminders(t)).toHaveLength(3);
  });

  it('a manual-link order made BEFORE the draft but confirmed after it stops the reminder', async () => {
    const t = setup();
    draft(t, 7001, '2026-10-07 10:00:00');
    q(t.storeDb, "INSERT INTO orders (customer_telegram_id, customer_product_id, product_name, price, status, created_at, decided_at) VALUES (7001, 1, 'GPT Plus', 5, 'confirmed', '2026-10-07 09:00:00', '2026-10-07 10:20:00')");
    await t.cron(NOW);
    expect(reminders(t)).toHaveLength(0);
    expect(drafts(t)).toEqual([]);
  });
});

describe('cart reminder: the toggle', () => {
  it('lives on the announcement wizard\'s first keyboard and flips in place', async () => {
    const t = setup({ flag: false });
    q(t.storeDb, "INSERT INTO customers (telegram_id, display_name) VALUES (9, 'x')");
    await t.send('store', textUpdate(ADMIN, '📢 اطلاعیه‌ها'));
    const kb = () => JSON.stringify(t.tg.of('sendMessage', ADMIN.id).at(-1)!.payload.reply_markup);
    expect(kb()).toContain('🛒 یادآوری سبد نیمه‌کاره: ⛔️ خاموش');
    await t.send('store', callbackUpdate(ADMIN, 'ann_cart_toggle', { chatId: ADMIN.id }));
    expect(one(t.storeDb, "SELECT value FROM store_kv WHERE key = 'cart_reminder_enabled'").value).toBe('1');
    expect(JSON.stringify(t.tg.of('editMessageReplyMarkup').at(-1)!.payload.reply_markup)).toContain('✅ روشن');
    await t.send('store', callbackUpdate(ADMIN, 'ann_cart_toggle', { chatId: ADMIN.id }));
    expect(one(t.storeDb, "SELECT value FROM store_kv WHERE key = 'cart_reminder_enabled'").value).toBe('0');
    // still on the audience step
    await t.send('store', callbackUpdate(ADMIN, 'ann_aud_all', { chatId: ADMIN.id }));
    expect(t.tg.texts(ADMIN.id).at(-1)).toContain('متن اطلاعیه');
  });
});
import { describe, expect, it } from 'vitest';
import { budgets, makeTestEnv, OWNER, type TestEnv } from '../helpers/env';
import { textUpdate } from '../helpers/updates';
import { one, q } from '../helpers/seed';
import { decodeCall, difference, fakeEitaa as eitaaFake, eMsg, eUser, peerUser, state } from '../helpers/fakeEitaa';

import { CRON_RESERVE, pollEitaa } from '../../src/monshi/eitaa/poll';

const NOTIFY = 6001;
const CUSTOMER = 555;
const ME = 69152770;
const fa = (n: number) => n.toLocaleString('fa-IR');

type E = ReturnType<typeof eitaaFake>;
async function setup(opts: { auto?: boolean; store?: boolean } = {}): Promise<{ t: TestEnv; e: E }> {
  const e = eitaaFake();
  const t = makeTestEnv({ store: opts.store ?? true, notify: String(NOTIFY), fetch: e.fetch });
  e.respond('auth.sendCode', { _: 'auth.sentCode', flags: 0, type: { _: 'auth.sentCodeTypeApp', length: 5 }, phone_code_hash: 'h1' });
  e.respond('auth.signIn', { _: 'auth.authorization', flags: 0, token: 'SECRET-TOKEN', user: eUser(ME, 'پشتیبانی') });
  await t.send('monshi', textUpdate(OWNER, '/eitaa_login 09137780948'));
  e.respond('updates.getState', state(100));
  await t.send('monshi', textUpdate(OWNER, '/eitaa_code 12345'));
  t.tg.reset();
  if (opts.auto !== false) q(t.monshiDb, "INSERT OR REPLACE INTO settings (key, value) VALUES ('eitaa_auto_enabled', '1')");
  if (opts.store !== false) {
    q(t.storeDb, `INSERT INTO customer_products (name, price, is_available, terms_text, terms_entities, eitaa_keyword) VALUES
      ('جمینای', 500000, 1, 'شرط ۱' || char(10) || 'شرط ۲', '[{"type":"bold","offset":0,"length":5}]', 'جمینای'),
      ('GPT Plus', 800000, 1, NULL, NULL, 'چت'),
      ('کلود', 900000, 0, NULL, NULL, 'کلود')`);
    q(t.storeDb, 'UPDATE customer_products SET compare_at_price = 1000000 WHERE id = 2');
  }
  return { t, e };
}

let pts = 100;
/** One difference served for `polls` polls: a backlog is worked through a few messages per minute (lastId marks what is done). */
const incoming = (e: E, msgs: [number, string][], polls = 1, from = CUSTOMER) => {
  const d = difference(++pts, msgs.map(([id, text]) => eMsg(id, peerUser(from), text)), [eUser(from, 'علی', 'ali_e')]);
  e.respond('updates.getDifference', ...Array.from({ length: polls }, () => d));
};
const run = async (t: TestEnv, n: number) => { for (let i = 0; i < n; i++) await t.cron(); };
const sends = (e: E) => e.calls.filter((c) => c.method === 'messages.sendMessage').map(decodeCall);
const ack = (e: E, ...ids: number[]) => e.respond('messages.sendMessage', ...ids.map((id) => ({ _: 'updateShortSentMessage', flags: 2, id, pts: 1, pts_count: 1, date: 1 })));
/** one poll on a fresh budget; what is left the moment it returns is what the rest of the cron tick can use */
const pollLeft = async (t: TestEnv): Promise<number> => { const m = t.apps().monshi!; await pollEitaa(m); return m.apps.budget.remaining(); };
const notifs = (t: TestEnv) => t.tg.texts(OWNER.id).filter((x) => x.includes('📗'));
const ownerPaused = (t: TestEnv) => one(t.monshiDb, 'SELECT automation_paused_until AS p FROM customers WHERE chat_id = ?', -CUSTOMER)?.p;

describe('Eitaa auto-reply: switches', () => {
  it('feature off → nothing sent, normal notification', async () => {
    const { t, e } = await setup({ auto: false });
    incoming(e, [[1, 'جمینای']]);
    await t.cron();
    expect(sends(e)).toHaveLength(0);
    expect(notifs(t)[0]).toContain('پیام جدید');
  });
  it('global automation off → silent', async () => {
    const { t, e } = await setup();
    q(t.monshiDb, "UPDATE settings SET value = '0' WHERE key = 'automation_enabled'");
    incoming(e, [[1, 'جمینای']]);
    await t.cron();
    expect(sends(e)).toHaveLength(0);
    expect(notifs(t)[0]).toContain('پیام جدید');
  });
  it('store not configured → feature off, no throw', async () => {
    const { t, e } = await setup({ store: false });
    incoming(e, [[1, 'جمینای']]);
    await t.cron();
    expect(sends(e)).toHaveLength(0);
    expect(notifs(t)).toHaveLength(1);
  });
  it('a paused chat → silent', async () => {
    const { t, e } = await setup();
    incoming(e, [[1, 'سلام']]);
    ack(e, 50);
    await t.cron();
    q(t.monshiDb, "UPDATE customers SET automation_paused_until = '2999-01-01T00:00:00.000000+00:00' WHERE chat_id = ?", -CUSTOMER);
    incoming(e, [[2, 'قیمت']]);
    await t.cron();
    expect(sends(e)).toHaveLength(1); // only the first message's menu
  });
});

describe('Eitaa auto-reply: matching', () => {
  it('a new customer gets the menu, sent with code entities, saved as out, notified as an auto-reply', async () => {
    const { t, e } = await setup();
    incoming(e, [[1, 'سلام']]);
    ack(e, 50);
    await t.cron();
    const [s] = sends(e);
    expect(s.flags & 8).toBe(8);
    expect(s.peer).toMatchObject({ _: 'inputPeerUser', access_hash: '777' + CUSTOMER });
    expect(s.message).toContain('📦 موجودی امروز:');
    expect(s.message).toContain('• GPT Plus — ' + fa(800000) + ' ت 🔥');
    expect(s.message).not.toContain('کلود');
    expect(s.entities.map((x: any) => x._)).toEqual(['messageEntityCode', 'messageEntityCode', 'messageEntityCode', 'messageEntityCode']);
    expect(s.entities.map((x: any) => s.message.slice(x.offset, x.offset + x.length))).toEqual(['جمینای', 'چت', 'قیمت', 'منو']);
    expect(one(t.monshiDb, "SELECT telegram_message_id AS id, business_connection_id AS b, text FROM messages WHERE direction = 'out'")).toMatchObject({ id: 50, b: 'eitaa' });
    expect(notifs(t)[0]).toContain('🤖 جواب خودکار رفت: منو');
  });

  it('a keyword as the first message → menu + product reply', async () => {
    const { t, e } = await setup();
    incoming(e, [[1, 'جمینای']]);
    ack(e, 50, 51);
    await t.cron();
    const out = sends(e);
    expect(out).toHaveLength(2);
    expect(out[0].message).toContain('📦 موجودی امروز:');
    expect(out[1].message).toContain('📦 جمینای');
    expect(notifs(t)[0]).toContain('🤖 جواب خودکار رفت: منو، جمینای');
  });

  it('«شرایط جمینای» → the product reply with the terms entities converted', async () => {
    const { t, e } = await setup();
    q(t.monshiDb, "INSERT INTO customers (chat_id, first_seen_at, last_message_at) VALUES (?, '2026-01-01', '2026-01-01')", -CUSTOMER);
    incoming(e, [[1, 'شرایط جمینای']]);
    ack(e, 50);
    await t.cron();
    const [s] = sends(e);
    expect(s.message).toContain('✅ موجود');
    expect(s.message).toContain('شرط ۱\nشرط ۲');
    const bold = s.entities.find((x: any) => x._ === 'messageEntityBold');
    expect(s.message.slice(bold.offset, bold.offset + bold.length)).toBe('شرط ۱');
    expect(s.message).toContain('🛒 برای خرید بنویسید:  خرید جمینای');
    expect(notifs(t)[0]).toContain('🤖 جواب خودکار رفت: جمینای');
  });

  it('«خرید جمینای» → confirmation + a purchase notification; unavailable → the other text', async () => {
    const { t, e } = await setup();
    q(t.monshiDb, "INSERT INTO customers (chat_id, first_seen_at, last_message_at) VALUES (?, '2026-01-01', '2026-01-01')", -CUSTOMER);
    incoming(e, [[1, 'خرید جمینای'], [2, 'خرید کلود']], 3);
    ack(e, 50, 51);
    await run(t, 3);
    const out = sends(e);
    expect(out[0].message).toBe('✅ درخواست خرید «جمینای» ثبت شد؛ به‌زودی پیام می‌دهم.');
    expect(out[1].message).toBe('⛔️ «کلود» فعلاً ناموجود است؛ به‌زودی پیام می‌دهم.');
    expect(notifs(t)[0]).toContain('🛒 خرید از ایتا: جمینای');
    expect(notifs(t)[1]).toContain('🛒 خرید از ایتا: کلود');
  });

  it('prices and menu on request', async () => {
    const { t, e } = await setup();
    q(t.monshiDb, "INSERT INTO customers (chat_id, first_seen_at, last_message_at) VALUES (?, '2026-01-01', '2026-01-01')", -CUSTOMER);
    incoming(e, [[1, 'قیمت'], [2, 'منو']], 3);
    ack(e, 50, 51);
    await run(t, 3);
    const out = sends(e);
    expect(out[0].message.startsWith('📦 موجودی امروز:')).toBe(true);
    expect(out[1].message).toContain('⚡️ جواب سریع');
  });

  it('sensitive messages and long questions get no auto-reply', async () => {
    const { t, e } = await setup();
    incoming(e, [[1, 'رسید'], [2, 'جمینای من کار نمیکنه']], 3);
    await run(t, 3);
    expect(sends(e)).toHaveLength(0);
    expect(notifs(t)).toHaveLength(2);
    expect(notifs(t).every((x) => x.includes('پیام جدید'))).toBe(true);
  });

  it('an unrelated short message from a known customer → nothing', async () => {
    const { t, e } = await setup();
    q(t.monshiDb, "INSERT INTO customers (chat_id, first_seen_at, last_message_at) VALUES (?, '2026-01-01', '2026-01-01')", -CUSTOMER);
    incoming(e, [[1, 'ممنون']]);
    await t.cron();
    expect(sends(e)).toHaveLength(0);
    expect(notifs(t)[0]).toContain('پیام جدید');
  });
});

describe('Eitaa auto-reply: limits', () => {
  it('the same keyword twice within an hour → one reply', async () => {
    const { t, e } = await setup();
    q(t.monshiDb, "INSERT INTO customers (chat_id, first_seen_at, last_message_at) VALUES (?, '2026-01-01', '2026-01-01')", -CUSTOMER);
    incoming(e, [[1, 'جمینای'], [2, 'جمینای']], 3);
    ack(e, 50, 51);
    await run(t, 3);
    expect(sends(e)).toHaveLength(1);
    expect(notifs(t)).toHaveLength(2);
  });

  it('6 different keywords within an hour → 5 replies', async () => {
    const { t, e } = await setup();
    q(t.monshiDb, "INSERT INTO customers (chat_id, first_seen_at, last_message_at) VALUES (?, '2026-01-01', '2026-01-01')", -CUSTOMER);
    for (const [a, b] of [['جمینای'], ['چت'], ['کلود'], ['قیمت'], ['منو'], ['خرید چت']].map((x, i) => [i + 1, x[0]] as [number, string])) {
      incoming(e, [[a, b]]);
      ack(e, 60 + a);
      await t.cron();
    }
    expect(sends(e)).toHaveLength(5);
    expect(notifs(t)).toHaveLength(6);
  });
});

describe('Eitaa auto-reply: the owner steps in', () => {
  it('the owner typing in Eitaa pauses the chat; the next keyword gets no reply', async () => {
    const { t, e } = await setup();
    q(t.monshiDb, "INSERT INTO customers (chat_id, first_seen_at, last_message_at) VALUES (?, '2026-01-01', '2026-01-01')", -CUSTOMER);
    incoming(e, [[1, 'سلام']]);
    await t.cron();
    e.respond('updates.getDifference', difference(++pts, [eMsg(2, peerUser(CUSTOMER), 'سلام، در خدمتم', true)]));
    await t.cron();
    expect(ownerPaused(t)).toBeTruthy();
    incoming(e, [[3, 'جمینای']]);
    await t.cron();
    expect(sends(e)).toHaveLength(0);
  });

  it('our own echo with the known id does not pause', async () => {
    const { t, e } = await setup();
    incoming(e, [[1, 'سلام']]);
    ack(e, 50);
    await t.cron();
    const text = sends(e)[0].message;
    e.respond('updates.getDifference', difference(++pts, [eMsg(50, peerUser(CUSTOMER), text, true)]));
    await t.cron();
    expect(ownerPaused(t)).toBeNull();
    expect(q(t.monshiDb, "SELECT id FROM messages WHERE direction = 'owner'")).toHaveLength(0);
  });

  it('our own echo when the sent id was unknown (fallback id) does not pause either', async () => {
    const { t, e } = await setup();
    incoming(e, [[1, 'سلام']]);
    e.respond('messages.sendMessage', { _: 'updates', updates: [], users: [], chats: [], date: 1, seq: 0 }); // no id in the reply
    await t.cron();
    const text = sends(e)[0].message;
    e.respond('updates.getDifference', difference(++pts, [eMsg(77, peerUser(CUSTOMER), text, true)]));
    await t.cron();
    expect(ownerPaused(t)).toBeNull();
    expect(q(t.monshiDb, "SELECT id FROM messages WHERE direction = 'owner'")).toHaveLength(0);
  });
});

describe('Eitaa auto-reply: budget and failures', () => {
  it('a tick with 4 keyword messages stays within 50 and leaves the cron reserve; the rest is done on later polls', async () => {
    const { t, e } = await setup();
    incoming(e, [[1, 'جمینای'], [2, 'چت'], [3, 'قیمت'], [4, 'خرید چت']], 6);
    ack(e, 50, 51, 52, 53, 54, 55);
    const n = budgets.length;
    expect(await pollLeft(t)).toBeGreaterThanOrEqual(CRON_RESERVE);
    const used = Math.max(...budgets.slice(n).map((b) => b.used));
    expect(used).toBeLessThanOrEqual(50 - 15 + 12); // the poll stops while 15 units stay free (+ the cursor write and a few sends in flight)
    expect(notifs(t).length).toBeGreaterThanOrEqual(1);
    expect(notifs(t).length).toBeLessThan(4); // not everything fits in one minute
    await run(t, 5);
    expect(notifs(t)).toHaveLength(4); // each exactly once
  });

  it('a NEW customer whose first message is a keyword (menu + product) in a multi-message tick keeps the reserve', async () => {
    const { t, e } = await setup();
    const OTHER = 777;
    const d = difference(++pts, [eMsg(1, peerUser(OTHER), 'جمینای'), eMsg(2, peerUser(CUSTOMER), 'چت'), eMsg(3, peerUser(OTHER), 'قیمت')],
      [eUser(OTHER, 'رضا', 'reza_e'), eUser(CUSTOMER, 'علی', 'ali_e')]);
    e.respond('updates.getDifference', d, d, d, d);
    ack(e, 50, 51, 52, 53, 54, 55, 56);
    expect(await pollLeft(t)).toBeGreaterThanOrEqual(CRON_RESERVE);
    expect(sends(e)[0].message).toContain('📦 موجودی امروز:'); // the new customer's menu …
    expect(sends(e)[1].message).toContain('📦 جمینای'); // … then the product reply
    await run(t, 4);
    expect(notifs(t)).toHaveLength(3);
  });

  it('a store failure does not stop forwarding: the message reaches the owner, no auto-reply', async () => {
    const { t, e } = await setup();
    q(t.storeDb, 'DROP TABLE customer_products');
    incoming(e, [[1, 'جمینای']]);
    await t.cron();
    expect(sends(e)).toHaveLength(0);
    expect(notifs(t)).toHaveLength(1);
    expect(notifs(t)[0]).toContain('پیام جدید');
  });

  it('the echo of a bridge reply (unknown sent id) does not pause the chat when reply_bridge_pause is off', async () => {
    const { t, e } = await setup({ auto: false });
    q(t.monshiDb, "INSERT OR REPLACE INTO settings (key, value) VALUES ('reply_bridge_pause', '0')");
    incoming(e, [[1, 'سلام']]);
    await t.cron();
    const notif = one(t.monshiDb, 'SELECT message_id FROM notify_links WHERE recipient_chat_id = ?', OWNER.id).message_id;
    e.respond('messages.sendMessage', { _: 'updates', updates: [], users: [], chats: [], date: 1, seq: 0 }); // no id → fallback id
    const upd = textUpdate(OWNER, 'جواب من');
    upd.message.reply_to_message = { message_id: notif, date: 0, chat: { id: OWNER.id, type: 'private' } };
    await t.send('monshi', upd);
    expect(sends(e)).toHaveLength(1);
    e.respond('updates.getDifference', difference(++pts, [eMsg(88, peerUser(CUSTOMER), 'جواب من', true)]));
    await t.cron();
    expect(ownerPaused(t)).toBeNull();
    expect(q(t.monshiDb, "SELECT id FROM messages WHERE direction = 'owner'")).toHaveLength(1);
  });

  it('a failed send still notifies, and releases the claim so a retry can send', async () => {
    const { t, e } = await setup();
    q(t.monshiDb, "INSERT INTO customers (chat_id, first_seen_at, last_message_at) VALUES (?, '2026-01-01', '2026-01-01')", -CUSTOMER);
    incoming(e, [[1, 'جمینای']]);
    e.respond('messages.sendMessage', { _: 'rpc_error', error_code: 500, error_message: 'INTERNAL' });
    await t.cron();
    expect(notifs(t)).toHaveLength(1);
    expect(notifs(t)[0]).toContain('پیام جدید');
    expect(q(t.monshiDb, "SELECT 1 FROM reply_log WHERE reply_key LIKE 'eitaa_%'")).toHaveLength(0);
    expect(q(t.monshiDb, "SELECT 1 FROM messages WHERE direction = 'out'")).toHaveLength(0);
  });
});

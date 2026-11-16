import { describe, expect, it } from 'vitest';
import { makeTestEnv, OWNER, type TestEnv } from '../helpers/env';
import { textUpdate } from '../helpers/updates';
import { one, q } from '../helpers/seed';
import { difference, fakeEitaa as eitaaFake, eMsg, eUser, peerUser, state } from '../helpers/fakeEitaa';
import { normalizePhone } from '../../src/monshi/handlers/eitaaAdmin';

const NOTIFY = 6001;
const CUSTOMER = 555;
const ME = 69152770;

async function loggedIn(): Promise<{ t: TestEnv; e: ReturnType<typeof eitaaFake> }> {
  const e = eitaaFake();
  const t = makeTestEnv({ store: false, notify: String(NOTIFY), fetch: e.fetch });
  e.respond('auth.sendCode', { _: 'auth.sentCode', flags: 0, type: { _: 'auth.sentCodeTypeApp', length: 5 }, phone_code_hash: 'h1' });
  e.respond('auth.signIn', { _: 'auth.authorization', flags: 0, token: 'SECRET-TOKEN', user: eUser(ME, 'پشتیبانی') });
  await t.send('monshi', textUpdate(OWNER, '/eitaa_login 09137780948'));
  await t.send('monshi', textUpdate(OWNER, '/eitaa_code 12345'));
  e.respond('updates.getState', state(100));
  await t.cron(); // baseline
  t.tg.reset();
  return { t, e };
}

describe('Eitaa login', () => {
  it('sends the code, signs in, deletes the code message and stores the token encrypted', async () => {
    const { t, e } = await loggedIn();
    expect(e.methods()).toEqual(['auth.sendCode', 'auth.signIn', 'updates.getState']);
    expect(e.sent(e.calls[0], '989137780948')).toBe(true);
    expect(e.calls[2].token).toBe('SECRET-TOKEN');
    const session = one(t.monshiDb, "SELECT value FROM app_state WHERE key = 'eitaa_session'").value as string;
    expect(session).not.toContain('SECRET-TOKEN');
    expect(JSON.parse(session)).toMatchObject({ me: { id: String(ME), name: 'پشتیبانی' }, pts: 100 });
    expect(q(t.monshiDb, "SELECT key FROM app_state WHERE key = 'eitaa_login'")).toHaveLength(0);
  });

  it('the code message is deleted and the owner is told it worked', async () => {
    const e = eitaaFake();
    const t = makeTestEnv({ store: false, fetch: e.fetch });
    e.respond('auth.sendCode', { _: 'auth.sentCode', flags: 0, type: { _: 'auth.sentCodeTypeApp', length: 5 }, phone_code_hash: 'h1' });
    e.respond('auth.signIn', { _: 'auth.authorization', flags: 0, token: 'T', user: eUser(ME, 'پشتیبانی') });
    await t.send('monshi', textUpdate(OWNER, '/eitaa_login 09137780948'));
    expect(t.tg.texts(OWNER.id).at(-1)).toContain('داخل اپ ایتا');
    await t.send('monshi', textUpdate(OWNER, '/eitaa_code 12345'));
    expect(t.tg.of('deleteMessage', OWNER.id)).toHaveLength(1);
    expect(t.tg.texts(OWNER.id).at(-1)).toContain('✅ ایتا وصل شد: پشتیبانی');
  });

  it('a wrong code is reported and nothing is stored', async () => {
    const e = eitaaFake();
    const t = makeTestEnv({ store: false, fetch: e.fetch });
    e.respond('auth.sendCode', { _: 'auth.sentCode', flags: 0, type: { _: 'auth.sentCodeTypeApp', length: 5 }, phone_code_hash: 'h1' });
    e.respond('auth.signIn', { _: 'rpc_error', error_code: 400, error_message: 'PHONE_CODE_INVALID' });
    await t.send('monshi', textUpdate(OWNER, '/eitaa_login 09137780948'));
    await t.send('monshi', textUpdate(OWNER, '/eitaa_code 11111'));
    expect(t.tg.texts(OWNER.id).at(-1)).toContain('PHONE_CODE_INVALID');
    expect(q(t.monshiDb, "SELECT key FROM app_state WHERE key = 'eitaa_session'")).toHaveLength(0);
  });

  it('normalizes phone numbers', () => {
    expect(normalizePhone('09137780948')).toBe('989137780948');
    expect(normalizePhone('+98 913 778 0948')).toBe('989137780948');
    expect(normalizePhone('۰۹۱۳۷۷۸۰۹۴۸')).toBe('989137780948');
    expect(normalizePhone('12345')).toBeNull();
  });
});

describe('Eitaa messages → owner', () => {
  it('a customer message reaches every staff account once, tagged 📗 and linked for Reply; others are skipped', async () => {
    const { t, e } = await loggedIn();
    e.respond('updates.getDifference', difference(105, [
      eMsg(1, peerUser(CUSTOMER), 'سلام قیمت اشتراک چنده؟'),
      eMsg(2, peerUser(CUSTOMER), 'دستی جواب دادم', true), // owner typed in the Eitaa app
      eMsg(3, peerUser(ME), 'یادداشت خودم'), // saved messages
      eMsg(4, { _: 'peerChat', chat_id: 9 }, 'پیام گروه'),
    ], [eUser(CUSTOMER, 'علی', 'ali_e')]));
    await t.cron();

    const sent = t.tg.of('sendMessage');
    expect(sent.map((c) => c.payload.chat_id)).toEqual([OWNER.id, NOTIFY]);
    expect(sent[0].payload.text).toContain('📗 ایتا · علی');
    expect(sent[0].payload.text).toContain('سلام قیمت اشتراک چنده؟');
    expect(sent[0].payload.text).toContain('https://eitaa.com/ali_e');
    expect(q(t.monshiDb, 'SELECT customer_chat_id FROM notify_links').map((r) => r.customer_chat_id)).toEqual([-CUSTOMER, -CUSTOMER]);
    expect(q(t.monshiDb, 'SELECT chat_id, direction, business_connection_id AS b FROM messages ORDER BY id'))
      .toEqual([{ chat_id: -CUSTOMER, direction: 'in', b: 'eitaa' }, { chat_id: -CUSTOMER, direction: 'owner', b: 'eitaa' }]);
    expect(one(t.monshiDb, 'SELECT first_name, username FROM customers WHERE chat_id = ?', -CUSTOMER)).toEqual({ first_name: 'علی', username: 'ali_e' });
    expect(one(t.monshiDb, 'SELECT access_hash FROM eitaa_peers WHERE user_id = ?', CUSTOMER).access_hash).toBe('777' + CUSTOMER);
    expect(JSON.parse(one(t.monshiDb, "SELECT value FROM app_state WHERE key = 'eitaa_session'").value).pts).toBe(105);
  });

  it('a message fetched twice is notified once; an empty difference changes nothing', async () => {
    const { t, e } = await loggedIn();
    const d = difference(101, [eMsg(1, peerUser(CUSTOMER), 'سلام')], [eUser(CUSTOMER, 'علی')]);
    e.respond('updates.getDifference', d, d, { _: 'updates.differenceEmpty', date: 1, seq: 0 });
    await t.cron();
    await t.cron();
    await t.cron();
    expect(t.tg.of('sendMessage', OWNER.id)).toHaveLength(1);
  });

  it('an Eitaa error alerts the owner once a day and nothing else breaks', async () => {
    const { t, e } = await loggedIn();
    const err = { _: 'rpc_error', error_code: 401, error_message: 'AUTH_KEY_UNREGISTERED' };
    e.respond('updates.getDifference', err, err);
    await t.cron(new Date('2026-11-16T10:00:00Z'));
    await t.cron(new Date('2026-11-16T10:01:00Z'));
    const alerts = t.tg.texts(OWNER.id).filter((x) => x.includes('اتصال منشی به ایتا خطا دارد'));
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toContain('AUTH_KEY_UNREGISTERED');
  });
});

describe('owner reply → Eitaa customer', () => {
  it('a text Reply to the notification is sent from the Eitaa account, stored as the owner and acknowledged', async () => {
    const { t, e } = await loggedIn();
    e.respond('updates.getDifference', difference(101, [eMsg(1, peerUser(CUSTOMER), 'سلام')], [eUser(CUSTOMER, 'علی')]));
    await t.cron();
    const notif = one(t.monshiDb, 'SELECT message_id FROM notify_links WHERE recipient_chat_id = ?', OWNER.id).message_id;
    e.respond('messages.sendMessage', { _: 'updateShortSentMessage', flags: 2, id: 50, pts: 102, pts_count: 1, date: 1 });
    const upd = textUpdate(OWNER, 'سلام، ۲۰۰ تومن');
    upd.message.reply_to_message = { message_id: notif, date: 0, chat: { id: OWNER.id, type: 'private' } };
    await t.send('monshi', upd);

    const call = e.calls.at(-1)!;
    expect(call.method).toBe('messages.sendMessage');
    expect(e.sent(call, 'سلام، ۲۰۰ تومن')).toBe(true);
    expect(one(t.monshiDb, "SELECT telegram_message_id AS id, business_connection_id AS b FROM messages WHERE direction = 'owner'")).toEqual({ id: 50, b: 'eitaa' });
    expect(t.tg.of('setMessageReaction', OWNER.id)).toHaveLength(1);

    // the same message coming back in the next poll (it is «out») is not stored twice
    e.respond('updates.getDifference', difference(102, [eMsg(50, peerUser(CUSTOMER), 'سلام، ۲۰۰ تومن', true)]));
    await t.cron();
    expect(q(t.monshiDb, "SELECT id FROM messages WHERE direction = 'owner'")).toHaveLength(1);
  });

  it('non-text replies are refused with a hint', async () => {
    const { t, e } = await loggedIn();
    e.respond('updates.getDifference', difference(101, [eMsg(1, peerUser(CUSTOMER), 'سلام')], [eUser(CUSTOMER, 'علی')]));
    await t.cron();
    const notif = one(t.monshiDb, 'SELECT message_id FROM notify_links WHERE recipient_chat_id = ?', OWNER.id).message_id;
    const upd = textUpdate(OWNER, 'x');
    delete upd.message.text;
    upd.message.photo = [{ file_id: 'p', file_unique_id: 'p', width: 1, height: 1 }];
    upd.message.reply_to_message = { message_id: notif, date: 0, chat: { id: OWNER.id, type: 'private' } };
    await t.send('monshi', upd);
    expect(t.tg.texts(OWNER.id).at(-1)).toContain('فقط پیام متنی');
    expect(e.methods()).not.toContain('messages.sendMessage');
  });
});

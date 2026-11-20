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
  e.respond('updates.getState', state(100));
  await t.send('monshi', textUpdate(OWNER, '/eitaa_code 12345')); // takes the baseline right away
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

describe('Eitaa backlog', () => {
  it('a backlog larger than one minute\'s budget is worked through over several polls, each message once', async () => {
    const { t, e } = await loggedIn();
    const msgs = Array.from({ length: 10 }, (_, i) => eMsg(i + 1, peerUser(CUSTOMER), 'پیام ' + (i + 1)));
    const d = difference(150, msgs, [eUser(CUSTOMER, 'علی')]);
    e.respond('updates.getDifference', d, d, d, d, d, d, d, d);
    for (let i = 0; i < 8; i++) await t.cron();
    const texts = t.tg.texts(OWNER.id);
    expect(texts).toHaveLength(10);
    expect(texts.map((x) => x.match(/پیام (\d+)/)![1])).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10']);
    expect(JSON.parse(one(t.monshiDb, "SELECT value FROM app_state WHERE key = 'eitaa_session'").value)).toMatchObject({ pts: 150, lastId: 10 });
  });
});

describe('Eitaa token expiry', () => {
  it('an expired token is renewed, saved and the poll retried — later calls use the new token', async () => {
    const { t, e } = await loggedIn();
    e.respond('updates.getDifference', { _: 'eitaa_updates_expire_token' }, difference(101, [eMsg(1, peerUser(CUSTOMER), 'سلام')], [eUser(CUSTOMER, 'علی')]));
    e.respond('eitaaRefreshToken', { _: 'eitaa_updates_token', token: 'NEW-TOKEN', expire: 1, date: 1 });
    await t.cron();
    expect(e.methods().slice(-3)).toEqual(['updates.getDifference', 'eitaaRefreshToken', 'updates.getDifference']);
    expect(e.calls.at(-1)!.token).toBe('NEW-TOKEN');
    expect(t.tg.of('sendMessage', OWNER.id)).toHaveLength(1);
    e.respond('updates.getDifference', { _: 'updates.differenceEmpty', date: 1, seq: 0 });
    await t.cron();
    expect(e.calls.at(-1)!.token).toBe('NEW-TOKEN'); // persisted (encrypted) across invocations
    expect(one(t.monshiDb, "SELECT value FROM app_state WHERE key = 'eitaa_session'").value).not.toContain('NEW-TOKEN');
  });

  it('an unknown reply alerts the owner instead of going silent', async () => {
    const { t, e } = await loggedIn();
    e.respond('updates.getDifference', { _: 'eitaa_token_updating' });
    await t.cron();
    expect(t.tg.texts(OWNER.id).at(-1)).toContain('eitaaTokenUpdating');
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

describe('Eitaa review fixes', () => {
  const session = (t: TestEnv) => q(t.monshiDb, "SELECT value FROM app_state WHERE key = 'eitaa_session'")[0]?.value as string | undefined;

  it('messages from Eitaa service/verified accounts and login-code texts never reach staff or the DB', async () => {
    const { t, e } = await loggedIn();
    const verified = { ...eUser(4242, 'ایتا'), flags: 1 | 2 | (1 << 17) };
    e.respond('updates.getDifference', difference(101, [
      eMsg(1, peerUser(777000), 'کد ورود شما: 12345'),
      eMsg(2, peerUser(4242), 'اطلاعیه'),
      eMsg(3, peerUser(CUSTOMER), 'کد ورود شما به ایتا: 54321'),
      eMsg(4, peerUser(CUSTOMER), 'کد ۱: 4895072006'), // a customer's own codes still arrive
    ], [eUser(777000, 'Eitaa'), verified, eUser(CUSTOMER, 'علی')]));
    await t.cron();
    const texts = t.tg.texts(OWNER.id);
    expect(texts).toHaveLength(1);
    expect(texts[0]).toContain('4895072006');
    expect(q(t.monshiDb, 'SELECT text FROM messages').map((r) => r.text)).toEqual(['کد ۱: 4895072006']);
  });

  it('a message that reached nobody is not dropped: it is retried next minute', async () => {
    const { t, e } = await loggedIn();
    const d = difference(101, [eMsg(1, peerUser(CUSTOMER), 'سلام')], [eUser(CUSTOMER, 'علی')]);
    e.respond('updates.getDifference', d, d);
    t.tg.fail('sendMessage', () => true, 500, 'Internal Server Error', 2); // owner + notify account
    await t.cron();
    expect(q(t.monshiDb, 'SELECT id FROM messages')).toHaveLength(0);
    expect(JSON.parse(session(t)!).pts).toBe(100);
    await t.cron();
    expect(q(t.monshiDb, 'SELECT customer_chat_id FROM notify_links')).toHaveLength(2);
    expect(q(t.monshiDb, 'SELECT id FROM messages')).toHaveLength(1);
    expect(JSON.parse(session(t)!).pts).toBe(101);
  });

  it('with many staff accounts a message still gets its notification links (budget is sized per recipient)', async () => {
    const e = eitaaFake();
    const t = makeTestEnv({ store: false, notify: '6001,6002,6003,6004,6005', fetch: e.fetch });
    e.respond('auth.sendCode', { _: 'auth.sentCode', flags: 0, type: { _: 'auth.sentCodeTypeApp', length: 5 }, phone_code_hash: 'h1' });
    e.respond('auth.signIn', { _: 'auth.authorization', flags: 0, token: 'T', user: eUser(ME, 'پشتیبانی') });
    e.respond('updates.getState', state(100));
    await t.send('monshi', textUpdate(OWNER, '/eitaa_login 09137780948'));
    await t.send('monshi', textUpdate(OWNER, '/eitaa_code 12345'));
    const msgs = Array.from({ length: 6 }, (_, i) => eMsg(i + 1, peerUser(CUSTOMER), 'پیام ' + (i + 1)));
    const d = difference(110, msgs, [eUser(CUSTOMER, 'علی')]);
    e.respond('updates.getDifference', d, d, d, d, d, d);
    for (let i = 0; i < 6; i++) await t.cron();
    expect(q(t.monshiDb, 'SELECT customer_chat_id FROM notify_links')).toHaveLength(6 * 6);
  });

  it('a network failure or an undecryptable token alerts the owner', async () => {
    const { t } = await loggedIn(); // nothing queued for getDifference = the request fails
    await t.cron(new Date('2026-11-16T10:00:00Z'));
    expect(t.tg.texts(OWNER.id).at(-1)).toContain('اتصال منشی به ایتا خطا دارد');

    const t2 = (await loggedIn()).t;
    t2.monshiDb.prepare("UPDATE app_state SET value = json_set(value, '$.token_enc', 'AAAA.AAAA') WHERE key = 'eitaa_session'").run();
    await t2.cron();
    expect(t2.tg.texts(OWNER.id).at(-1)).toContain('رمزگشایی');
  });

  it('a poll in flight during /eitaa_logout cannot bring the session back', async () => {
    const { t, e } = await loggedIn();
    e.respond('updates.getDifference', () => {
      t.monshiDb.prepare("DELETE FROM app_state WHERE key = 'eitaa_session'").run(); // logout lands mid-call
      return difference(101, [], []);
    });
    await t.cron();
    expect(session(t)).toBeUndefined();
  });

  it('a poll of an older login cannot overwrite a new login', async () => {
    const { t, e } = await loggedIn();
    e.respond('updates.getDifference', () => {
      t.monshiDb.prepare("UPDATE app_state SET value = json_set(value, '$.sid', 'NEW', '$.pts', 7) WHERE key = 'eitaa_session'").run();
      return difference(101, [], []);
    });
    await t.cron();
    expect(JSON.parse(session(t)!)).toMatchObject({ sid: 'NEW', pts: 7 });
  });

  it('a differenceSlice moves through intermediate states until the full difference', async () => {
    const { t, e } = await loggedIn();
    e.respond('updates.getDifference',
      { _: 'updates.differenceSlice', new_messages: [eMsg(1, peerUser(CUSTOMER), 'یک')], new_encrypted_messages: [], other_updates: [], chats: [], users: [eUser(CUSTOMER, 'علی')], intermediate_state: state(101) },
      difference(102, [eMsg(2, peerUser(CUSTOMER), 'دو')], [eUser(CUSTOMER, 'علی')]));
    await t.cron();
    expect(JSON.parse(session(t)!).pts).toBe(101);
    await t.cron();
    expect(JSON.parse(session(t)!).pts).toBe(102);
    expect(t.tg.texts(OWNER.id)).toHaveLength(2);
  });

  it('differenceTooLong starts over from now and tells the owner messages may be missing', async () => {
    const { t, e } = await loggedIn();
    e.respond('updates.getDifference', { _: 'updates.differenceTooLong', pts: 900 });
    e.respond('updates.getState', state(950));
    await t.cron();
    expect(JSON.parse(session(t)!).pts).toBe(950);
    expect(t.tg.texts(OWNER.id).at(-1)).toContain('داخل اپ ایتا چک کنید');
  });

  it('Eitaa customers are not offered in the order wizard; the notification has no pause button', async () => {
    const { t, e } = await loggedIn();
    e.respond('updates.getDifference', difference(101, [eMsg(1, peerUser(CUSTOMER), 'سلام')], [eUser(CUSTOMER, 'علی', 'ali_e')]));
    await t.cron();
    expect(JSON.stringify(t.tg.of('sendMessage', OWNER.id)[0].payload.reply_markup ?? {})).not.toContain('pause_chat');
    t.tg.reset();
    await t.send('monshi', textUpdate(OWNER, '/order_add'));
    expect(JSON.stringify(t.tg.of('sendMessage', OWNER.id).at(-1)!.payload.reply_markup)).not.toContain(String(-CUSTOMER));
    await t.send('monshi', textUpdate(OWNER, '@ali_e'));
    expect(t.tg.texts(OWNER.id).at(-1)).toContain('مشتری‌های ایتا');
    expect(q(t.monshiDb, 'SELECT id FROM orders')).toHaveLength(0);
  });

  it('a reply to a customer without a stored access hash says so clearly', async () => {
    const { t, e } = await loggedIn();
    e.respond('updates.getDifference', difference(101, [eMsg(1, peerUser(CUSTOMER), 'سلام')], [{ ...eUser(CUSTOMER, 'علی'), access_hash: undefined, flags: 2 }]));
    await t.cron();
    const notif = one(t.monshiDb, 'SELECT message_id FROM notify_links WHERE recipient_chat_id = ?', OWNER.id).message_id;
    const upd = textUpdate(OWNER, 'سلام');
    upd.message.reply_to_message = { message_id: notif, date: 0, chat: { id: OWNER.id, type: 'private' } };
    await t.send('monshi', upd);
    expect(t.tg.texts(OWNER.id).at(-1)).toContain('از خود اپ ایتا جواب دهید');
    expect(e.methods()).not.toContain('messages.sendMessage');
  });
});

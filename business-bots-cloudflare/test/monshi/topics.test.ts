import { describe, expect, it } from 'vitest';
import { makeTestEnv, OWNER, type TestEnv } from '../helpers/env';
import { businessConnectionUpdate, businessMessageUpdate, callbackUpdate, textUpdate } from '../helpers/updates';
import { one, q } from '../helpers/seed';
import { CUST, connect, getSetting, setHours, setSetting } from '../helpers/monshi';
import { TOPICS } from '../../src/monshi/services/topics';
import { deliverOrder } from '../../src/monshi/handlers/bridge';

const NOTIFY = { id: 6001, first_name: 'Notify' };
const sat = (utcH: number, utcM = 0) => new Date(Date.UTC(2026, 9, 3, utcH, utcM));

const topicCalls = (t: TestEnv, userId: number) => t.tg.of('createForumTopic', userId);
const threadOf = (t: TestEnv, userId: number, name: string): number => {
  const created = topicCalls(t, userId).findIndex((c) => c.payload.name === name);
  expect(created, `topic ${name} created for ${userId}`).toBeGreaterThanOrEqual(0);
  return Number(one(t.monshiDb, 'SELECT value FROM app_state WHERE key = ?', `topic:${userId}:${Object.entries(TOPICS).find(([, v]) => v.name === name)![0]}`).value);
};
const sentInThread = (t: TestEnv, userId: number, thread: number) =>
  t.tg.of('sendMessage', userId).filter((c) => c.payload.message_thread_id === thread).map((c) => c.payload.text as string);

describe('monshi: topics', () => {
  it('off by default: notifications are sent exactly as before (no topics, no thread ids)', async () => {
    const t = makeTestEnv({ store: false });
    await connect(t);
    setHours(t, 'closed');
    await t.send('monshi', businessMessageUpdate(CUST, 'رمزم کار نمیکنه'));
    expect(t.tg.of('createForumTopic')).toHaveLength(0);
    const notif = t.tg.of('sendMessage', OWNER.id).at(-1)!.payload;
    expect(notif.text).toContain('پیام نیازمند بررسی شما');
    expect(notif).not.toHaveProperty('message_thread_id');
  });

  it('handoff, digest, order notice and connection message each land in their own topic', async () => {
    const t = makeTestEnv({ store: false });
    setSetting(t, 'topics_enabled', '1');
    setHours(t, 'closed');
    setSetting(t, 'greeting_enabled', '0');

    // connection confirmation → ⚙️ system
    await t.send('monshi', businessConnectionUpdate(OWNER, 'bc1'));
    const system = threadOf(t, OWNER.id, TOPICS.system.name);
    expect(sentInThread(t, OWNER.id, system).join('\n')).toContain('اتصال به حساب شما برقرار شد');

    // handoff → 🔔
    await t.send('monshi', businessMessageUpdate(CUST, 'رمزم کار نمیکنه'));
    const handoff = threadOf(t, OWNER.id, TOPICS.handoff.name);
    expect(sentInThread(t, OWNER.id, handoff).join('\n')).toContain('پیام نیازمند بررسی شما');

    // weekly digest → 📊
    await t.cron(sat(6, 0));
    const reports = threadOf(t, OWNER.id, TOPICS.reports.name);
    expect(sentInThread(t, OWNER.id, reports).join('\n')).toContain('دایجست هفتگی');

    // «completion message did not reach the customer» → 📦
    const monshi = t.apps().monshi!;
    const orderId = await monshi.db.addOrder(CUST.id, 'GPT Plus', 'bc1');
    t.tg.fail('sendMessage', (c) => !!c.payload.business_connection_id, 400, 'Bad Request: chat not found');
    await deliverOrder(monshi, (await monshi.db.getOrder(orderId))!);
    const orders = threadOf(t, OWNER.id, TOPICS.orders.name);
    expect(sentInThread(t, OWNER.id, orders).join('\n')).toContain('پیام تکمیل');
  });

  it('topics are created lazily, once per (user, category), and reused from app_state', async () => {
    const t = makeTestEnv({ store: false, notify: String(NOTIFY.id) });
    setSetting(t, 'topics_enabled', '1');
    await connect(t);
    setHours(t, 'closed');
    setSetting(t, 'greeting_enabled', '0');
    t.tg.reset();
    await t.send('monshi', businessMessageUpdate(CUST, 'رمزم کار نمیکنه'));
    await t.send('monshi', businessMessageUpdate(CUST, 'شکایت دارم'));
    expect(topicCalls(t, OWNER.id)).toHaveLength(1);
    expect(topicCalls(t, NOTIFY.id)).toHaveLength(1);
    expect(topicCalls(t, NOTIFY.id)[0].payload).toMatchObject({ name: TOPICS.handoff.name, icon_color: TOPICS.handoff.color });
    const nThread = threadOf(t, NOTIFY.id, TOPICS.handoff.name);
    expect(sentInThread(t, NOTIFY.id, nThread)).toHaveLength(2);
  });

  it('a deleted topic is recreated once and the message is resent', async () => {
    const t = makeTestEnv({ store: false });
    setSetting(t, 'topics_enabled', '1');
    await connect(t);
    setHours(t, 'closed');
    setSetting(t, 'greeting_enabled', '0');
    await t.send('monshi', businessMessageUpdate(CUST, 'رمزم کار نمیکنه'));
    const first = threadOf(t, OWNER.id, TOPICS.handoff.name);

    t.tg.fail('sendMessage', (c) => c.payload.message_thread_id === first, 400, 'Bad Request: message thread not found');
    t.tg.reset();
    await t.send('monshi', businessMessageUpdate(CUST, 'شکایت دارم'));
    const second = threadOf(t, OWNER.id, TOPICS.handoff.name);
    expect(second).not.toBe(first);
    expect(sentInThread(t, OWNER.id, second).join('\n')).toContain('شکایت دارم');
    expect(topicCalls(t, OWNER.id)).toHaveLength(1);
  });

  it('a topic creation failure falls back to a plain message — nothing is lost', async () => {
    const t = makeTestEnv({ store: false });
    setSetting(t, 'topics_enabled', '1');
    await connect(t);
    setHours(t, 'closed');
    setSetting(t, 'greeting_enabled', '0');
    t.tg.fail('createForumTopic', () => true, 400, 'Bad Request: the chat is not a forum');
    await t.send('monshi', businessMessageUpdate(CUST, 'رمزم کار نمیکنه'));
    const notif = t.tg.of('sendMessage', OWNER.id).at(-1)!.payload;
    expect(notif.text).toContain('پیام نیازمند بررسی شما');
    expect(notif).not.toHaveProperty('message_thread_id');
  });

  describe('settings toggle', () => {
    it('on: creates the four topics, saves the setting, posts a line into each', async () => {
      const t = makeTestEnv({ store: false });
      await t.send('monshi', textUpdate(OWNER, '/settings'));
      const hub = t.tg.of('sendMessage', OWNER.id).at(-1)!.payload.reply_markup.inline_keyboard.flat();
      expect(hub.find((b: any) => b.callback_data === 'st_toggle_topics').text).toContain('خاموش 🚫');

      await t.send('monshi', callbackUpdate(OWNER, 'st_toggle_topics', { text: 'x', chatId: OWNER.id }));
      expect(topicCalls(t, OWNER.id).map((c) => c.payload.name)).toEqual(Object.values(TOPICS).map((x) => x.name));
      expect(getSetting(t, 'topics_enabled')).toBe('1');
      expect(t.tg.of('answerCallbackQuery').at(-1)!.payload.text).toContain('تاپیک‌ها ساخته شدند');
      const intro = t.tg.of('sendMessage', OWNER.id).filter((c) => String(c.payload.text).startsWith('این تاپیک برای'));
      expect(intro).toHaveLength(4);
      expect(intro.every((c) => c.payload.message_thread_id)).toBe(true);
    });

    it('on: when Telegram refuses (BotFather topic mode is off) the setting stays off and the owner is told why', async () => {
      const t = makeTestEnv({ store: false });
      t.tg.fail('createForumTopic', () => true, 400, 'Bad Request: the chat is not a forum');
      await t.send('monshi', callbackUpdate(OWNER, 'st_toggle_topics', { text: 'x', chatId: OWNER.id }));
      expect(getSetting(t, 'topics_enabled')).toBe('0');
      const alert = t.tg.of('answerCallbackQuery').at(-1)!.payload;
      expect(alert.show_alert).toBe(true);
      expect(alert.text).toContain('@BotFather');
    });

    it('off: just switches the setting', async () => {
      const t = makeTestEnv({ store: false });
      setSetting(t, 'topics_enabled', '1');
      await t.send('monshi', callbackUpdate(OWNER, 'st_toggle_topics', { text: 'x', chatId: OWNER.id }));
      expect(getSetting(t, 'topics_enabled')).toBe('0');
      expect(topicCalls(t, OWNER.id)).toHaveLength(0);
    });

    it('a non-owner cannot toggle it', async () => {
      const t = makeTestEnv({ store: false });
      await t.send('monshi', callbackUpdate(NOTIFY, 'st_toggle_topics', { text: 'x', chatId: NOTIFY.id }));
      expect(getSetting(t, 'topics_enabled')).toBe('0');
    });
  });
});

import type { Message } from 'grammy/types';
import type { MonshiApp } from '../../apps';

/**
 * Staff messages grouped into forum topics of the owner's private chat with the bot. Needs «Threaded Mode»
 * (topics) switched on for this bot in @BotFather. Only monshi uses it: its private chats are just the staff.
 */
export type TopicCategory = 'handoff' | 'orders' | 'reports' | 'system';

export const TOPICS: Record<TopicCategory, { name: string; color: number }> = {
  handoff: { name: '🔔 پیام‌های نیازمند پاسخ', color: 0xFB6F5F },
  orders: { name: '📦 سفارش‌ها', color: 0xFFD67E },
  reports: { name: '📊 گزارش‌ها', color: 0x6FB9F0 },
  system: { name: '⚙️ سیستم و اتصال', color: 0x8EEE98 },
};
export const TOPIC_CATEGORIES = Object.keys(TOPICS) as TopicCategory[];

const stateKey = (userId: number, cat: TopicCategory) => `topic:${userId}:${cat}`;

/** The topic's thread id; created on first use and remembered in app_state. null when it can't be created. */
export async function ensureTopic(app: MonshiApp, userId: number, cat: TopicCategory): Promise<number | null> {
  const stored = await app.ctx.getState(stateKey(userId, cat));
  const id = stored ? parseInt(stored, 10) : NaN;
  if (Number.isInteger(id) && id > 0) return id;
  try {
    const topic = await app.api.createForumTopic(userId, TOPICS[cat].name, { icon_color: TOPICS[cat].color as any });
    await app.ctx.setState(stateKey(userId, cat), String(topic.message_thread_id));
    return topic.message_thread_id;
  } catch (err: any) {
    console.warn(`Could not create the «${cat}» topic for ${userId}:`, err?.message ?? err);
    return null;
  }
}

const isTopicGone = (err: any) => /thread not found|TOPIC_DELETED|TOPIC_CLOSED|topic (was )?(deleted|closed)/i.test(String(err?.description ?? err?.message ?? ''));

/** Sends to a staff member, into the category's topic when topics are on. Never loses a message to a topic problem. */
export async function sendToStaff(
  app: MonshiApp, userId: number, cat: TopicCategory, text: string, extra: Record<string, any> = {},
): Promise<Message.TextMessage | null> {
  if ((await app.ctx.getSetting('topics_enabled')) !== '1') return app.api.sendMessage(userId, text, extra);

  let thread = await ensureTopic(app, userId, cat);
  if (thread === null) return app.api.sendMessage(userId, text, extra);
  try {
    return await app.api.sendMessage(userId, text, { ...extra, message_thread_id: thread });
  } catch (err: any) {
    if (!isTopicGone(err)) throw err;
  }
  // the topic was deleted/closed by the owner: forget it, make a new one once, resend
  await app.ctx.deleteState(stateKey(userId, cat));
  thread = await ensureTopic(app, userId, cat);
  return app.api.sendMessage(userId, text, thread === null ? extra : { ...extra, message_thread_id: thread });
}

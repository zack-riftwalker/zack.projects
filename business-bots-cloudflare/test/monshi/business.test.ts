import { describe, expect, it } from 'vitest';
import { makeTestEnv, OWNER } from '../helpers/env';
import { businessConnectionUpdate, businessMessageUpdate, callbackUpdate, textUpdate, voiceUpdate } from '../helpers/updates';
import { one, q } from '../helpers/seed';
import { CUST, CUST2, addFaq, answeredBy, businessReplies, connect, getSetting, setHours, setSetting } from '../helpers/monshi';

const NOTIFY = { id: 6001, first_name: 'Notify' };

describe('monshi: business connection', () => {
  it('saves the connection and reports rights to the owner', async () => {
    const t = makeTestEnv({ store: false });
    await t.send('monshi', businessConnectionUpdate(OWNER, 'bcX', true, { can_reply: true, can_read_messages: false } as any));
    expect(one(t.monshiDb, 'SELECT business_connection_id, owner_user_id, is_enabled FROM connection')).toEqual({ business_connection_id: 'bcX', owner_user_id: OWNER.id, is_enabled: 1 });
    const text = t.tg.texts(OWNER.id).at(-1)!;
    expect(text).toContain('اتصال به حساب شما برقرار شد ✅');
    expect(text).toContain('مجوز پاسخ‌گویی: دارد ✅');
    expect(text).toContain('مجوز mark-as-read: ندارد ❌');

    await t.send('monshi', businessConnectionUpdate(OWNER, 'bcX', false));
    expect(t.tg.texts(OWNER.id).at(-1)).toContain('قطع شد ❌');
    expect(one(t.monshiDb, 'SELECT is_enabled FROM connection').is_enabled).toBe(0);
  });
});

describe('monshi: missed connection event', () => {
  it('a business message from an unknown connection registers it (status shows connected)', async () => {
    const t = makeTestEnv({ store: false });
    await t.send('monshi', businessMessageUpdate(CUST, 'سلام', { bcid: 'bcLate' }));
    expect(one(t.monshiDb, 'SELECT business_connection_id, owner_user_id, is_enabled FROM connection')).toEqual({ business_connection_id: 'bcLate', owner_user_id: OWNER.id, is_enabled: 1 });
    await t.send('monshi', textUpdate(OWNER, '/status'));
    expect(t.tg.texts(OWNER.id).at(-1)).toContain('وصل ✅');
    // known connection → no further lookups
    t.tg.reset();
    await t.send('monshi', businessMessageUpdate(CUST, 'دوباره', { bcid: 'bcLate' }));
    expect(t.tg.of('getBusinessConnection')).toHaveLength(0);
  });
});

describe('monshi: connections of other accounts', () => {
  const STRANGER = { id: 9999, first_name: 'Stranger' };
  const STRANGERS_CUSTOMER = { id: 8888, first_name: 'Other' };

  it('a stranger connecting the bot to their own Business account is ignored', async () => {
    const t = makeTestEnv({ store: false });
    await connect(t);
    await t.send('monshi', businessConnectionUpdate(STRANGER, 'foreign1'));
    expect(q(t.monshiDb, 'SELECT business_connection_id FROM connection').map((r) => r.business_connection_id)).toEqual(['bc1']);
    expect(t.tg.calls).toHaveLength(0);
    expect((await t.apps().monshi!.ctx.getConnection())!.business_connection_id).toBe('bc1');
  });

  it("messages arriving through a stranger's connection are dropped (not stored, not answered, no notification)", async () => {
    const t = makeTestEnv({ store: false });
    await connect(t);
    setHours(t, 'closed');
    await t.send('monshi', businessMessageUpdate(STRANGERS_CUSTOMER, 'رمزم کار نمیکنه', { bcid: 'foreign1' }));
    expect(q(t.monshiDb, 'SELECT * FROM customers')).toHaveLength(0);
    expect(q(t.monshiDb, 'SELECT * FROM messages')).toHaveLength(0);
    expect(t.tg.calls.map((c) => c.method)).toEqual(['getBusinessConnection']);
    expect(q(t.monshiDb, 'SELECT business_connection_id FROM connection').map((r) => r.business_connection_id)).toEqual(['bc1']);
  });

  it('a stranger row left in the table by older code never becomes the active connection', async () => {
    const t = makeTestEnv({ store: false });
    await connect(t);
    q(t.monshiDb, "INSERT INTO connection VALUES ('foreign-old', 9999, 1, '2999-01-01T00:00:00+00:00')");
    expect((await t.apps().monshi!.ctx.getConnection())!.business_connection_id).toBe('bc1');
  });
});

describe('monshi: pipeline', () => {
  it('an owner message pauses the chat and marks earlier customer messages as human-answered', async () => {
    const t = makeTestEnv({ store: false });
    await connect(t);
    setHours(t, 'open');
    await t.send('monshi', businessMessageUpdate(CUST, 'سلام یه سوال داشتم'));
    await t.send('monshi', businessMessageUpdate(OWNER, 'بفرمایید', { chatId: CUST.id }));
    expect(answeredBy(t, CUST.id)).toEqual(['human']);
    expect(one(t.monshiDb, 'SELECT direction FROM messages WHERE direction = ?', 'owner')).toBeTruthy();
    const paused = one(t.monshiDb, 'SELECT automation_paused_until FROM customers WHERE chat_id = ?', CUST.id).automation_paused_until;
    expect(Date.parse(paused)).toBeGreaterThan(Date.now() + 3.9 * 3600_000);

    // while paused, nothing is auto-answered
    setHours(t, 'closed');
    setSetting(t, 'greeting_enabled', '0');
    t.tg.reset();
    await t.send('monshi', businessMessageUpdate(CUST, 'کسی هست؟'));
    expect(businessReplies(t, CUST.id)).toEqual([]);
  });

  it('a new customer is greeted exactly once, even with two concurrent first messages', async () => {
    const t = makeTestEnv({ store: false });
    await connect(t);
    setHours(t, 'closed');
    await Promise.all([
      t.send('monshi', businessMessageUpdate(CUST, 'سلام')),
      t.send('monshi', businessMessageUpdate(CUST, 'سلام دوباره')),
    ]);
    const replies = businessReplies(t, CUST.id);
    expect(replies).toHaveLength(1);
    expect(replies[0]).toContain('سلام، خوش آمدید 👋');
    expect(replies[0]).toContain('@mai_academia_bot');
    // greeting doubles as the «received» ack → no extra after-hours ack
    expect(q(t.monshiDb, 'SELECT * FROM messages WHERE chat_id = ?', CUST.id)).toHaveLength(2);
  });

  it('after hours: one ack per cooldown; inside business hours: silent', async () => {
    const t = makeTestEnv({ store: false });
    await connect(t);
    setSetting(t, 'greeting_enabled', '0');

    setHours(t, 'open');
    await t.send('monshi', businessMessageUpdate(CUST, 'سلام وقت بخیر'));
    expect(businessReplies(t, CUST.id)).toEqual([]);

    setHours(t, 'closed');
    await t.send('monshi', businessMessageUpdate(CUST, 'کسی هست؟'));
    expect(businessReplies(t, CUST.id)).toHaveLength(1);
    expect(businessReplies(t, CUST.id)[0]).toContain('خارج از ساعت پاسخ‌گویی هستیم');
    expect(t.tg.of('readBusinessMessage')).toHaveLength(1);

    await t.send('monshi', businessMessageUpdate(CUST, 'هنوز هستید؟'));
    expect(businessReplies(t, CUST.id)).toHaveLength(1); // cooldown

    q(t.monshiDb, "UPDATE customers SET last_ack_sent_at = '2020-01-01T00:00:00+00:00'");
    await t.send('monshi', businessMessageUpdate(CUST, 'سلام؟'));
    expect(businessReplies(t, CUST.id)).toHaveLength(2);
    expect(answeredBy(t, CUST.id)).toEqual(['none', 'ack', 'none', 'ack']);
  });

  it('a failed ack send releases the claim so the next message can retry', async () => {
    const t = makeTestEnv({ store: false });
    await connect(t);
    setSetting(t, 'greeting_enabled', '0');
    setHours(t, 'closed');
    t.tg.fail('sendMessage', (c) => c.payload.business_connection_id === 'bc1', 400, 'Bad Request', 1);
    await t.send('monshi', businessMessageUpdate(CUST, 'سلام'));
    expect(one(t.monshiDb, 'SELECT last_ack_sent_at FROM customers').last_ack_sent_at).toBeNull();
    await t.send('monshi', businessMessageUpdate(CUST, 'سلام؟'));
    expect(businessReplies(t, CUST.id)).toHaveLength(2); // 1 failed attempt + 1 success
    expect(one(t.monshiDb, 'SELECT last_ack_sent_at FROM customers').last_ack_sent_at).not.toBeNull();
  });

  it('sensitive text and media are never answered: owner + notify accounts are alerted with a pause button', async () => {
    const t = makeTestEnv({ store: false, notify: String(NOTIFY.id) });
    await connect(t);
    setHours(t, 'closed');
    setSetting(t, 'greeting_enabled', '0');

    await t.send('monshi', businessMessageUpdate(CUST, 'رسید پرداخت رو فرستادم'));
    await t.send('monshi', businessMessageUpdate(CUST, undefined, { extra: { voice: { file_id: 'v', file_unique_id: 'v', duration: 2 } } }));
    expect(businessReplies(t, CUST.id)).toEqual([]);
    expect(answeredBy(t, CUST.id)).toEqual(['handoff', 'handoff']);
    const alerts = t.tg.of('sendMessage').filter((c) => c.payload.text.includes('🔔 پیام نیازمند بررسی شما'));
    expect(alerts.map((c) => c.payload.chat_id)).toEqual([OWNER.id, NOTIFY.id, OWNER.id, NOTIFY.id]);
    expect(alerts[0].payload.text).toContain('(حساس/مدیا)');
    expect(alerts[0].payload.text).toContain('https://t.me/cust_user');
    expect(alerts[2].payload.text).toContain('[voice]');
    expect(alerts[0].payload.reply_markup.inline_keyboard[0][0].callback_data).toBe('pause_chat:' + CUST.id);
  });

  it('automation switched off → store only', async () => {
    const t = makeTestEnv({ store: false });
    await connect(t);
    setSetting(t, 'automation_enabled', '0');
    setHours(t, 'closed');
    await t.send('monshi', businessMessageUpdate(CUST, 'سلام'));
    expect(businessReplies(t, CUST.id)).toEqual([]);
    expect(q(t.monshiDb, 'SELECT * FROM messages')).toHaveLength(1);
  });

  it('duplicate deliveries of the same message are ignored', async () => {
    const t = makeTestEnv({ store: false });
    await connect(t);
    setHours(t, 'closed');
    const upd = businessMessageUpdate(CUST, 'سلام');
    await t.send('monshi', upd);
    await t.send('monshi', upd);
    expect(q(t.monshiDb, 'SELECT * FROM messages')).toHaveLength(1);
    expect(businessReplies(t, CUST.id)).toHaveLength(1);
  });
});

describe('monshi: FAQ answers', () => {
  it('keyword FAQ answers inside and outside business hours, then the repeat cooldown suppresses duplicates', async () => {
    const t = makeTestEnv({ store: false });
    await connect(t);
    setSetting(t, 'greeting_enabled', '0');
    setHours(t, 'open');
    const id = addFaq(t, { question: 'قیمت جمینای', answer: 'جمینای ۳۰۰ هزار تومان', keywords: 'جمینای, قیمت' });

    await t.send('monshi', businessMessageUpdate(CUST, 'قیمت جمینای چنده؟'));
    expect(businessReplies(t, CUST.id)).toEqual(['جمینای ۳۰۰ هزار تومان']);
    expect(one(t.monshiDb, 'SELECT hit_count FROM faqs').hit_count).toBe(1);
    expect(one(t.monshiDb, 'SELECT answered_by, faq_id FROM messages')).toEqual({ answered_by: 'faq', faq_id: id });

    await t.send('monshi', businessMessageUpdate(CUST, 'جمینای چقدره؟'));
    expect(businessReplies(t, CUST.id)).toHaveLength(1); // cooldown: not repeated
    expect(answeredBy(t, CUST.id)).toEqual(['faq', 'faq']);
    expect(one(t.monshiDb, 'SELECT hit_count FROM faqs').hit_count).toBe(1);

    setHours(t, 'closed');
    await t.send('monshi', businessMessageUpdate(CUST2, 'جمینای دارید؟ قیمت؟'));
    expect(businessReplies(t, CUST2.id)).toEqual(['جمینای ۳۰۰ هزار تومان']);
  });

  it('a generic price question without a matching FAQ gets the sales-bot referral (once per cooldown)', async () => {
    const t = makeTestEnv({ store: false });
    await connect(t);
    setSetting(t, 'greeting_enabled', '0');
    setHours(t, 'open');
    await t.send('monshi', businessMessageUpdate(CUST, 'قیمت چت جی پی تی چنده؟'));
    const replies = businessReplies(t, CUST.id);
    expect(replies).toHaveLength(1);
    expect(replies[0]).toContain('@mai_academia_bot');
    expect(answeredBy(t, CUST.id)).toEqual(['price_fallback']);
    await t.send('monshi', businessMessageUpdate(CUST, 'قیمت چنده'));
    expect(businessReplies(t, CUST.id)).toHaveLength(1);
    expect(one(t.monshiDb, 'SELECT text, count FROM unanswered')).toEqual({ text: 'قیمت چت جی پی تی چنده؟', count: 1 });
  });

  it('unmatched questions are recorded as unanswered and counted', async () => {
    const t = makeTestEnv({ store: false });
    await connect(t);
    setSetting(t, 'greeting_enabled', '0');
    setHours(t, 'open');
    await t.send('monshi', businessMessageUpdate(CUST, 'گارانتی دارید؟'));
    await t.send('monshi', businessMessageUpdate(CUST2, 'گارانتی  دارید؟'));
    expect(q(t.monshiDb, 'SELECT count FROM unanswered')).toEqual([{ count: 2 }]);
  });

  it('order-status question with an open order answers from the database', async () => {
    const t = makeTestEnv({ store: false });
    await connect(t);
    setSetting(t, 'greeting_enabled', '0');
    setHours(t, 'open');
    q(t.monshiDb, "INSERT INTO customers (chat_id, telegram_user_id, first_name) VALUES (?, ?, 'C')", CUST.id, CUST.id);
    q(t.monshiDb, "INSERT INTO orders (chat_id, title, status, business_connection_id) VALUES (?, 'جمینای ۱ ماهه', 'provisioning', 'bc1')", CUST.id);
    await t.send('monshi', businessMessageUpdate(CUST, 'سفارشم چی شد؟'));
    expect(businessReplies(t, CUST.id)).toEqual(['وضعیت سفارش «جمینای ۱ ماهه»: آماده‌سازی اکانت ✅\nبه‌محض تغییر وضعیت، اطلاع‌رسانی می‌شود.']);
    expect(answeredBy(t, CUST.id)).toEqual(['order_status']);
  });
});

describe('monshi: admin access control', () => {
  it('only the owner can use commands; notify accounts only get /start; customers are ignored', async () => {
    const t = makeTestEnv({ store: false, notify: String(NOTIFY.id) });
    await t.send('monshi', textUpdate(OWNER, '/start'));
    expect(t.tg.texts(OWNER.id).at(-1)).toContain('من منشی فروشگاه شما هستم');
    expect(t.tg.of('sendMessage', OWNER.id)[0].payload.reply_markup.is_persistent).toBe(true);

    await t.send('monshi', textUpdate(NOTIFY, '/start'));
    expect(t.tg.texts(NOTIFY.id).at(-1)).toContain('برای دریافت نوتیف‌های منشی ثبت شد');
    await t.send('monshi', textUpdate(NOTIFY, '/status'));
    expect(t.tg.texts(NOTIFY.id)).toHaveLength(1);

    await t.send('monshi', textUpdate(CUST, '/status'));
    expect(t.tg.texts(CUST.id)).toHaveLength(0);
  });

  it('notify accounts may press pause_chat: only; other admin buttons are silently refused', async () => {
    const t = makeTestEnv({ store: false, notify: String(NOTIFY.id) });
    await connect(t);
    q(t.monshiDb, "INSERT INTO customers (chat_id, first_name) VALUES (?, 'C')", CUST.id);
    await t.send('monshi', callbackUpdate(NOTIFY, 'hub_toggle_auto'));
    expect(getSetting(t, 'automation_enabled')).toBe('1');

    await t.send('monshi', callbackUpdate(NOTIFY, 'pause_chat:' + CUST.id));
    expect(one(t.monshiDb, 'SELECT automation_paused_until FROM customers').automation_paused_until).toBeTruthy();
    const ans = t.tg.of('answerCallbackQuery').filter((c) => c.payload.text);
    expect(ans.at(-1)!.payload.text).toBe('ربات برای این چت متوقف شد 💤');
    expect(t.tg.of('answerCallbackQuery').filter((c) => c.payload.text)).toHaveLength(1); // answered exactly once
  });
});

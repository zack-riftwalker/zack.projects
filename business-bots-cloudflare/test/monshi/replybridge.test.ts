import { describe, expect, it } from 'vitest';
import { makeTestEnv, OWNER, type TestEnv } from '../helpers/env';
import { businessMessageUpdate, callbackUpdate } from '../helpers/updates';
import { one, q } from '../helpers/seed';
import { CUST, addFaq, connect, fakeGemini, setHours, setSetting } from '../helpers/monshi';
import { topMatches } from '../../src/monshi/services/faq';

const NOTIFY = { id: 6001, first_name: 'Notify' };
const STRANGER = { id: 12345, first_name: 'Stranger' };
let rid = 90000;

function replyUpdate(user: { id: number; first_name: string }, notifMsgId: number, extra: Record<string, unknown>): any {
  return {
    update_id: rid++,
    message: {
      message_id: rid++, date: 1700000000, chat: { id: user.id, type: 'private' }, from: { id: user.id, is_bot: false, first_name: user.first_name },
      reply_to_message: { message_id: notifMsgId, date: 0, chat: { id: user.id, type: 'private' } }, ...extra,
    },
  };
}

async function setup(opts: { gemini?: ReturnType<typeof fakeGemini> } = {}) {
  const t = makeTestEnv({ store: false, notify: String(NOTIFY.id), gemini: !!opts.gemini, fetch: opts.gemini?.fetch });
  await connect(t);
  setHours(t, 'closed');
  setSetting(t, 'greeting_enabled', '0');
  return t;
}

/** sends a sensitive message and returns the notification message ids per recipient */
async function handoff(t: TestEnv, text = 'رمزم کار نمیکنه') {
  await t.send('monshi', businessMessageUpdate(CUST, text));
  const links = q(t.monshiDb, 'SELECT * FROM notify_links ORDER BY message_id');
  const of = (id: number) => links.filter((l) => l.recipient_chat_id === id).at(-1)!.message_id as number;
  return { owner: of(OWNER.id), notify: of(NOTIFY.id), links };
}
const toCustomer = (t: TestEnv) => t.tg.calls.filter((c) => c.payload?.chat_id === CUST.id && c.payload?.business_connection_id);
const paused = (t: TestEnv) => one(t.monshiDb, 'SELECT automation_paused_until AS p FROM customers WHERE chat_id = ?', CUST.id).p;

describe('notification links', () => {
  it('every handoff notification is linked to its customer, and carries the reply hint', async () => {
    const t = await setup();
    const { links } = await handoff(t);
    expect(links.map((l) => [l.recipient_chat_id, l.customer_chat_id])).toEqual([[OWNER.id, CUST.id], [NOTIFY.id, CUST.id]]);
    expect(t.tg.of('sendMessage', OWNER.id).at(-1)!.payload.text).toContain('↩️ برای جواب دادن، روی همین پیام Reply بزنید.');
  });
});

describe('reply from the notification', () => {
  it('a text reply goes to the customer from the business account, is stored as the owner, pauses the chat and gets a 👍', async () => {
    const t = await setup();
    const { owner } = await handoff(t);
    t.tg.reset();
    const upd = replyUpdate(OWNER, owner, { text: 'سلام، بررسی می‌کنم' });
    upd.message.entities = [{ type: 'bold', offset: 0, length: 4 }];
    await t.send('monshi', upd);
    const sent = toCustomer(t);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ method: 'sendMessage', payload: { chat_id: CUST.id, text: 'سلام، بررسی می‌کنم', business_connection_id: 'bc1', entities: [{ type: 'bold', offset: 0, length: 4 }] } });
    expect(one(t.monshiDb, "SELECT direction, text, answered_by FROM messages WHERE direction = 'owner'")).toMatchObject({ direction: 'owner', text: 'سلام، بررسی می‌کنم' });
    expect(paused(t)).not.toBeNull();
    expect(t.tg.of('setMessageReaction')[0].payload).toMatchObject({ chat_id: OWNER.id, reaction: [{ type: 'emoji', emoji: '👍' }] });
  });

  it('photo, document, voice and sticker replies are forwarded by file id (caption kept)', async () => {
    const t = await setup();
    const { owner } = await handoff(t);
    t.tg.reset();
    await t.send('monshi', replyUpdate(OWNER, owner, { photo: [{ file_id: 's', file_unique_id: 's' }, { file_id: 'big', file_unique_id: 'b' }], caption: 'رسید' }));
    await t.send('monshi', replyUpdate(OWNER, owner, { document: { file_id: 'doc1', file_unique_id: 'd' } }));
    await t.send('monshi', replyUpdate(OWNER, owner, { voice: { file_id: 'v1', file_unique_id: 'v', duration: 3 } }));
    await t.send('monshi', replyUpdate(OWNER, owner, { sticker: { file_id: 'st1', file_unique_id: 'x', type: 'regular', width: 1, height: 1, is_animated: false, is_video: false } }));
    const calls = toCustomer(t);
    expect(calls.map((c) => c.method)).toEqual(['sendPhoto', 'sendDocument', 'sendVoice', 'sendSticker']);
    expect(calls[0].payload).toMatchObject({ photo: 'big', caption: 'رسید', business_connection_id: 'bc1' });
    expect(calls[1].payload.document).toBe('doc1');
    expect(q(t.monshiDb, "SELECT message_type FROM messages WHERE direction = 'owner' ORDER BY id").map((r) => r.message_type)).toEqual(['photo', 'document', 'voice', 'sticker']);
  });

  it('an unsupported message type is refused politely', async () => {
    const t = await setup();
    const { owner } = await handoff(t);
    t.tg.reset();
    await t.send('monshi', replyUpdate(OWNER, owner, { contact: { phone_number: '1', first_name: 'x' } }));
    expect(toCustomer(t)).toHaveLength(0);
    expect(t.tg.texts(OWNER.id).at(-1)).toContain('این نوع پیام پشتیبانی نمی‌شود');
  });

  it('a notify account can reply too — without needing a session', async () => {
    const t = await setup();
    const { notify } = await handoff(t);
    t.tg.reset();
    await t.send('monshi', replyUpdate(NOTIFY, notify, { text: 'از طرف همکار' }));
    expect(toCustomer(t)[0].payload.text).toBe('از طرف همکار');
    expect(q(t.monshiDb, 'SELECT * FROM sessions')).toHaveLength(0);
  });

  it('a stranger cannot reply, and a reply to an ordinary message is not forwarded', async () => {
    const t = await setup();
    const { owner } = await handoff(t);
    t.tg.reset();
    await t.send('monshi', replyUpdate(STRANGER, owner, { text: 'hack' }));
    await t.send('monshi', replyUpdate(OWNER, 424242, { text: 'replying to something else' }));
    await t.send('monshi', replyUpdate(OWNER, owner, { text: '/pause', entities: [{ type: 'bot_command', offset: 0, length: 6 }] }));
    expect(toCustomer(t).map((c) => c.payload)).toEqual([]);
  });

  it('send failure: the staff member is told why and nothing is stored', async () => {
    const t = await setup();
    const { owner } = await handoff(t);
    t.tg.fail('sendMessage', (c) => !!c.payload.business_connection_id, 400, 'Bad Request: BUSINESS_PEER_USAGE_MISSING');
    t.tg.reset();
    await t.send('monshi', replyUpdate(OWNER, owner, { text: 'سلام' }));
    const note = t.tg.texts(OWNER.id).at(-1)!;
    expect(note).toContain('❌ پیام به مشتری نرسید.');
    expect(note).toContain('BUSINESS_PEER_USAGE_MISSING');
    expect(note).toContain('۲۴ ساعت گذشته');
    expect(q(t.monshiDb, "SELECT * FROM messages WHERE direction = 'owner'")).toHaveLength(0);
    expect(paused(t)).toBeNull();
  });

  it('no active business connection → explained', async () => {
    const t = await setup();
    const { owner } = await handoff(t);
    q(t.monshiDb, 'DELETE FROM connection');
    t.tg.reset();
    await t.send('monshi', replyUpdate(OWNER, owner, { text: 'سلام' }));
    expect(t.tg.texts(OWNER.id).at(-1)).toContain('اتصال بیزینس فعال نیست');
  });

  it('reply_bridge_pause = 0: the chat is not paused — and the echo of the sent message does not pause it either', async () => {
    const t = await setup();
    setSetting(t, 'reply_bridge_pause', '0');
    const { owner } = await handoff(t);
    await t.send('monshi', replyUpdate(OWNER, owner, { text: 'سلام' }));
    expect(paused(t)).toBeNull();
    const stored = one(t.monshiDb, "SELECT telegram_message_id AS id FROM messages WHERE direction = 'owner'").id;
    // Telegram echoing our own send back as a business message from the owner: deduplicated, nothing else happens
    await t.send('monshi', businessMessageUpdate(OWNER, 'سلام', { chatId: CUST.id, extra: { message_id: stored } }));
    expect(q(t.monshiDb, "SELECT * FROM messages WHERE direction = 'owner'")).toHaveLength(1);
    expect(paused(t)).toBeNull();
  });
});

describe('FAQ quick-send buttons', () => {
  async function geminiHandoff() {
    const g = fakeGemini({ decisions: [{ action: 'HUMAN_HANDOFF', faq_id: null, confidence: 0.2 }] });
    const t = await setup({ gemini: g });
    const a = addFaq(t, { question: 'گارانتی دارید؟', answer: 'بله ۷ روز', keywords: '' });
    addFaq(t, { question: 'روش پرداخت چیه؟', answer: 'کارت به کارت', keywords: '' });
    addFaq(t, { question: 'تحویل چقدر طول می‌کشه؟', answer: 'تا ۲۴ ساعت', keywords: '' });
    addFaq(t, { question: 'چهارمی', answer: 'x', keywords: '' });
    setHours(t, 'open');
    await t.send('monshi', businessMessageUpdate(CUST, 'سلام یه سوال خاص دارم'));
    const kb = t.tg.of('sendMessage', OWNER.id).at(-1)!.payload.reply_markup.inline_keyboard;
    return { t, kb, a };
  }

  it('up to 3 candidate FAQs appear above the pause button', async () => {
    const { kb } = await geminiHandoff();
    expect(kb).toHaveLength(4);
    expect(kb.slice(0, 3).map((r: any) => r[0].callback_data)).toEqual(['hfaq:7001:1', 'hfaq:7001:2', 'hfaq:7001:3']);
    expect(kb[0][0].text).toBe('📚 گارانتی دارید؟');
    expect(kb[3][0].callback_data).toBe('pause_chat:7001');
  });

  it('pressing one sends the answer, stores it, counts a hit, pauses, and trims the notification buttons', async () => {
    const { t } = await geminiHandoff();
    t.tg.reset();
    await t.send('monshi', callbackUpdate(OWNER, 'hfaq:7001:1', { text: 'ORIGINAL', chatId: OWNER.id }));
    expect(toCustomer(t)[0].payload).toMatchObject({ text: 'بله ۷ روز', business_connection_id: 'bc1' });
    expect(one(t.monshiDb, 'SELECT hit_count FROM faqs WHERE id = 1').hit_count).toBe(1);
    expect(one(t.monshiDb, "SELECT reply_key FROM reply_log").reply_key).toBe('faq:1');
    expect(paused(t)).not.toBeNull();
    const edit = t.tg.of('editMessageText').at(-1)!.payload;
    expect(edit.text).toContain('ORIGINAL');
    expect(edit.text).toContain('✅ جواب «گارانتی دارید؟» ارسال شد (توسط ');
    expect(edit.reply_markup.inline_keyboard).toHaveLength(1);
    expect(edit.reply_markup.inline_keyboard[0][0].callback_data).toBe('pause_chat:7001');

    // a double press does not answer twice
    t.tg.reset();
    await t.send('monshi', callbackUpdate(OWNER, 'hfaq:7001:1', { text: 'ORIGINAL', chatId: OWNER.id }));
    expect(toCustomer(t)).toHaveLength(0);
    expect(t.tg.of('answerCallbackQuery').at(-1)!.payload.text).toContain('همین الان برای مشتری ارسال شده');
  });

  it('a disabled FAQ, a failing send and a notify account are handled', async () => {
    const { t } = await geminiHandoff();
    q(t.monshiDb, 'UPDATE faqs SET enabled = 0 WHERE id = 2');
    await t.send('monshi', callbackUpdate(OWNER, 'hfaq:7001:2', { text: 'x', chatId: OWNER.id }));
    expect(t.tg.of('answerCallbackQuery').at(-1)!.payload.text).toContain('دیگر فعال نیست');

    t.tg.fail('sendMessage', (c) => !!c.payload.business_connection_id, 400, 'Bad Request: x');
    await t.send('monshi', callbackUpdate(OWNER, 'hfaq:7001:3', { text: 'x', chatId: OWNER.id }));
    expect(t.tg.of('answerCallbackQuery').at(-1)!.payload.text).toContain('پیام به مشتری نرسید');
    expect(paused(t)).toBeNull();

    t.tg.clearRules();
    await t.send('monshi', callbackUpdate(NOTIFY, 'hfaq:7001:3', { text: 'x', chatId: NOTIFY.id }));
    expect(t.tg.of('editMessageText').at(-1)!.payload.text).toContain('(توسط Notify)');
    await t.send('monshi', callbackUpdate(STRANGER, 'hfaq:7001:1', { text: 'x', chatId: STRANGER.id }));
    expect(toCustomer(t).filter((c) => c.payload.text === 'بله ۷ روز')).toHaveLength(0);
  });
});

describe('faq.topMatches', () => {
  const faq = (id: number, question: string, keywords: string) => ({ id, question, answer: 'a', keywords, enabled: 1, priority: 0, embedding: null, hit_count: 0, created_at: '', updated_at: '' });
  it('ranks by score, needs a specific hit, caps at k', () => {
    const faqs = [faq(1, 'اول', 'گارانتی, ضمانت'), faq(2, 'دوم', 'گارانتی'), faq(3, 'سوم', 'تحویل'), faq(4, 'چهارم', 'گارانتی, ضمانت, اکانت')];
    expect(topMatches('گارانتی و ضمانت و اکانت', faqs, 3).map((f) => f.id)).toEqual([4, 1, 2]);
    expect(topMatches('چیز نامربوط', faqs)).toEqual([]);
    expect(topMatches(null, faqs)).toEqual([]);
  });
});

describe('notify_links cleanup', () => {
  it('04:xx Tehran, once a day, deletes links older than 30 days', async () => {
    const t = await setup();
    q(t.monshiDb, "INSERT INTO notify_links VALUES (1, 1, 1, '2026-08-01T00:00:00.000000+00:00'), (1, 2, 2, '2026-10-05T00:00:00.000000+00:00')");
    const at = (h: number, m = 0) => new Date(Date.UTC(2026, 9, 7, h, m)); // 04:xx Tehran = 00:30–01:29Z
    await t.cron(at(5, 0)); // 08:30 Tehran
    expect(q(t.monshiDb, 'SELECT * FROM notify_links')).toHaveLength(2);
    await t.cron(at(0, 45));
    expect(q(t.monshiDb, 'SELECT message_id FROM notify_links').map((r) => r.message_id)).toEqual([2]);
    expect(one(t.monshiDb, "SELECT value FROM app_state WHERE key = 'notify_links_cleanup_day'").value).toBe('2026-10-07');
    q(t.monshiDb, "INSERT INTO notify_links VALUES (1, 3, 3, '2026-08-01T00:00:00.000000+00:00')");
    await t.cron(at(1, 0)); // same day → latched
    expect(q(t.monshiDb, 'SELECT * FROM notify_links')).toHaveLength(2);
  });
});

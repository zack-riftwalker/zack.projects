import { describe, expect, it } from 'vitest';
import { makeTestEnv, OWNER } from '../helpers/env';
import { businessMessageUpdate, callbackUpdate, textUpdate } from '../helpers/updates';
import { one, q } from '../helpers/seed';
import { CUST, connect, getSetting, setHours, setSetting } from '../helpers/monshi';

const owner = (t: ReturnType<typeof makeTestEnv>, text: string) => t.send('monshi', textUpdate(OWNER, text));
const ownerCb = (t: ReturnType<typeof makeTestEnv>, data: string) => t.send('monshi', callbackUpdate(OWNER, data));
const last = (t: ReturnType<typeof makeTestEnv>) => t.tg.texts(OWNER.id).at(-1)!;
const lastEdit = (t: ReturnType<typeof makeTestEnv>) => t.tg.of('editMessageText').at(-1)!.payload;

describe('monshi admin: menu & status', () => {
  it('menu buttons run the hubs', async () => {
    const t = makeTestEnv({ store: false });
    await connect(t);
    await owner(t, '📊 وضعیت');
    expect(last(t)).toContain('📊 وضعیت ربات منشی');
    expect(last(t)).toContain('وصل ✅');
    expect(last(t)).toContain('پاسخ خودکار: روشن ✅');
    await owner(t, '❔ راهنما');
    expect(last(t)).toContain('راهنمای ربات منشی');
    await owner(t, '/menu');
    expect(t.tg.of('sendMessage', OWNER.id).at(-1)!.payload.reply_markup.keyboard).toHaveLength(3);
  });

  it('status hub: toggle automation, stats (cached), digest, paused chats and resume', async () => {
    const t = makeTestEnv({ store: false });
    await connect(t);
    await ownerCb(t, 'hub_toggle_auto');
    expect(getSetting(t, 'automation_enabled')).toBe('0');
    expect(lastEdit(t).text).toContain('پاسخ خودکار: خاموش ⏸');
    await owner(t, '/resume');
    expect(getSetting(t, 'automation_enabled')).toBe('1');
    await owner(t, '/pause');
    expect(getSetting(t, 'automation_enabled')).toBe('0');

    await ownerCb(t, 'hub_stats');
    expect(lastEdit(t).text).toContain('📈 آمار کلی');
    expect(one(t.monshiDb, "SELECT COUNT(*) n FROM app_state WHERE key='stats_cache'").n).toBe(1);

    q(t.monshiDb, "INSERT INTO customers (chat_id, first_name, automation_paused_until) VALUES (?, 'Ali', '2099-01-01T00:00:00+00:00')", CUST.id);
    await ownerCb(t, 'hub_paused');
    expect(lastEdit(t).text).toContain('👤 Ali — تا');
    await ownerCb(t, 'resume_chat:' + CUST.id);
    expect(lastEdit(t).text).toBe('💤 هیچ چتی الان متوقف نیست.');
    await ownerCb(t, 'hub_digest');
    expect(lastEdit(t).text).toContain('📊 دایجست هفتگی');
  });

  it('/resume_chat by id or username', async () => {
    const t = makeTestEnv({ store: false });
    q(t.monshiDb, "INSERT INTO customers (chat_id, username, first_name, automation_paused_until) VALUES (?, 'cust_user', 'Ali', '2099-01-01T00:00:00+00:00')", CUST.id);
    await owner(t, '/resume_chat @CUST_user');
    expect(one(t.monshiDb, 'SELECT automation_paused_until p FROM customers').p).toBeNull();
    await owner(t, '/resume_chat 999');
    expect(last(t)).toContain('مشتری‌ای با این مشخصات پیدا نشد');
    await owner(t, '/resume_chat');
    expect(last(t)).toContain('فرمت: /resume_chat');
  });
});

describe('monshi admin: hours', () => {
  it('typed /hours variants and preset buttons', async () => {
    const t = makeTestEnv({ store: false });
    await owner(t, '/hours');
    expect(last(t)).toContain('🕐 ساعت کاری فعلی');
    await owner(t, '/hours شنبه ۹ تا ۱۷');
    expect(JSON.parse(getSetting(t, 'business_hours')!).sat).toBe('09:00-17:00');
    await owner(t, '/hours جمعه 22 تا 6');
    expect(last(t)).toContain('این بازه از نیمه‌شب رد می‌شود');
    await owner(t, '/hours یکشنبه off');
    expect(JSON.parse(getSetting(t, 'business_hours')!).sun).toBeNull();
    await owner(t, '/hours یکشنبه');
    expect(t.tg.of('sendMessage', OWNER.id).at(-1)!.payload.reply_markup.inline_keyboard.at(-1)[0].callback_data).toBe('hback');
    await owner(t, '/hours blah');
    expect(last(t)).toContain('روز هفته را نشناختم');

    await ownerCb(t, 'hday:mon');
    expect(lastEdit(t).text).toContain('ساعت کاری روز دوشنبه');
    await ownerCb(t, 'hset:mon:11:00-23:00');
    expect(JSON.parse(getSetting(t, 'business_hours')!).mon).toBe('11:00-23:00');
    await ownerCb(t, 'hset:mon:off');
    expect(JSON.parse(getSetting(t, 'business_hours')!).mon).toBeNull();
  });

  it('custom hours: wizard text beats nothing, but a menu button beats the wizard', async () => {
    const t = makeTestEnv({ store: false });
    await ownerCb(t, 'hcustom:tue');
    await owner(t, 'نامعتبر');
    expect(last(t)).toContain('متوجه نشدم');
    await owner(t, '📊 وضعیت'); // menu button wins over the pending wizard input
    expect(last(t)).toContain('📊 وضعیت ربات منشی');
    expect(JSON.parse(getSetting(t, 'business_hours')!).tue).toBe('10:00-22:00');
    await owner(t, '۱۰ تا ۲۰');
    expect(JSON.parse(getSetting(t, 'business_hours')!).tue).toBe('10:00-20:00');
    expect(last(t)).toContain('ساعت روز سه‌شنبه ذخیره شد');
  });
});

describe('monshi admin: settings hub', () => {
  it('toggles, cooldown presets / custom, message edits, Gemini controls', async () => {
    const t = makeTestEnv({ store: false, gemini: true });
    await owner(t, '⚙️ تنظیمات');
    expect(last(t)).toContain('⚙️ تنظیمات ربات');

    await ownerCb(t, 'st_toggle_markread');
    expect(getSetting(t, 'mark_read_enabled')).toBe('0');
    await ownerCb(t, 'st_toggle_greeting');
    expect(getSetting(t, 'greeting_enabled')).toBe('0');

    await ownerCb(t, 'st_cooldown_set:4');
    expect(getSetting(t, 'ack_cooldown_hours')).toBe('4');
    await ownerCb(t, 'st_cooldown_custom');
    await owner(t, 'abc');
    expect(last(t)).toContain('عدد نامعتبر است');
    await owner(t, '0.5');
    expect(getSetting(t, 'ack_cooldown_hours')).toBe('0.5');

    await ownerCb(t, 'st_edit:after_hours_message');
    await owner(t, 'پیام جدید {sales_bot}');
    expect(getSetting(t, 'after_hours_message')).toBe('پیام جدید {sales_bot}');
    await ownerCb(t, 'st_edit:greeting_message');
    await owner(t, 'خوش اومدی');
    expect(getSetting(t, 'greeting_message')).toBe('خوش اومدی');
    expect(getSetting(t, 'greeting_enabled')).toBe('1');

    await ownerCb(t, 'st_thresh:faq:0.9');
    expect(getSetting(t, 'faq_threshold')).toBe('0.9');
    await ownerCb(t, 'st_toggle_gemini');
    expect(getSetting(t, 'gemini_enabled')).toBe('0');
    await owner(t, '/gemini_status');
    expect(last(t)).toContain('⚙️ فعال: خیر 🚫');
    await owner(t, '/gemini_toggle');
    expect(getSetting(t, 'gemini_enabled')).toBe('1');
    await owner(t, '/set_threshold handoff 0.6');
    expect(getSetting(t, 'human_handoff_threshold')).toBe('0.6');
    await owner(t, '/set_threshold handoff 7');
    expect(last(t)).toContain('باید بین 0 و 1 باشد');
  });

  it('Gemini toggle without a key answers once with an alert', async () => {
    const t = makeTestEnv({ store: false, gemini: false });
    await ownerCb(t, 'st_toggle_gemini');
    const answers = t.tg.of('answerCallbackQuery');
    expect(answers).toHaveLength(1);
    expect(answers[0].payload).toMatchObject({ show_alert: true });
    await owner(t, '/gemini_toggle');
    expect(last(t)).toContain('ابتدا GEMINI_API_KEY را تنظیم کنید');
  });

  it('/set_message, /set_greeting, /set_cooldown commands', async () => {
    const t = makeTestEnv({ store: false });
    await owner(t, '/set_message\nخط یک\nخط دو');
    expect(getSetting(t, 'after_hours_message')).toBe('خط یک\nخط دو');
    await owner(t, '/set_greeting off');
    expect(getSetting(t, 'greeting_enabled')).toBe('0');
    await owner(t, '/set_greeting سلام جدید');
    expect(getSetting(t, 'greeting_message')).toBe('سلام جدید');
    expect(getSetting(t, 'greeting_enabled')).toBe('1');
    await owner(t, '/set_cooldown 2');
    expect(getSetting(t, 'ack_cooldown_hours')).toBe('2');
    await owner(t, '/set_cooldown x');
    expect(last(t)).toContain('عدد نامعتبر است');
  });
});

describe('monshi admin: FAQ management', () => {
  it('add wizard (3 steps), generic-keyword warning, edit, toggle, list, cancel', async () => {
    const t = makeTestEnv({ store: false });
    await owner(t, '📚 سوالات متداول');
    expect(last(t)).toBe('📋 هنوز هیچ FAQ‌ای ثبت نشده.');
    await ownerCb(t, 'fq_add');
    await owner(t, 'قیمت جمینای');
    await owner(t, 'جمینای ۳۰۰ تومان');
    await owner(t, 'قیمت, هزینه');
    expect(last(t)).toContain('✅ FAQ #1 ذخیره شد و فعال است.');
    expect(last(t)).toContain('همه کلیدواژه‌ها عمومی‌اند');
    expect(one(t.monshiDb, 'SELECT question, answer, keywords, enabled FROM faqs')).toEqual({ question: 'قیمت جمینای', answer: 'جمینای ۳۰۰ تومان', keywords: 'قیمت, هزینه', enabled: 1 });

    await ownerCb(t, 'fq_edit:1:keywords');
    await owner(t, 'جمینای, قیمت');
    expect(last(t)).toContain('✅ به‌روزرسانی شد.');
    expect(last(t)).not.toContain('همه کلیدواژه‌ها عمومی‌اند');
    expect(one(t.monshiDb, 'SELECT keywords, embedding FROM faqs')).toEqual({ keywords: 'جمینای, قیمت', embedding: null });

    await ownerCb(t, 'fq_toggle:1');
    expect(one(t.monshiDb, 'SELECT enabled FROM faqs').enabled).toBe(0);
    await owner(t, '/faq_enable 1');
    expect(one(t.monshiDb, 'SELECT enabled FROM faqs').enabled).toBe(1);
    await owner(t, '/faq_disable 99');
    expect(last(t)).toContain('FAQ‌ای با این شماره پیدا نشد');
    await owner(t, '/faq_edit 1');
    expect(last(t)).toContain('📋 FAQ شماره 1 (فعال ✅)');

    await owner(t, '/faq_add');
    await owner(t, '/cancel');
    expect(last(t)).toBe('لغو شد.');
    await owner(t, '/cancel');
    expect(last(t)).toBe('چیزی برای لغو نبود.');
    await ownerCb(t, 'fq_add');
    await ownerCb(t, 'wiz_cancel');
    expect(lastEdit(t).text).toBe('لغو شد.');
  });

  it('editing the answer clears the repeat-cooldown log', async () => {
    const t = makeTestEnv({ store: false });
    q(t.monshiDb, "INSERT INTO faqs (question, answer, created_at, updated_at) VALUES ('q', 'a', 'x', 'x')");
    q(t.monshiDb, "INSERT INTO reply_log (chat_id, reply_key, sent_at) VALUES (1, 'faq:1', 'x')");
    await ownerCb(t, 'fq_edit:1:answer');
    await owner(t, 'پاسخ جدید');
    expect(q(t.monshiDb, 'SELECT * FROM reply_log')).toHaveLength(0);
  });

  it('unanswered → convert to FAQ', async () => {
    const t = makeTestEnv({ store: false });
    await connect(t);
    setHours(t, 'open');
    setSetting(t, 'greeting_enabled', '0');
    await t.send('monshi', businessMessageUpdate(CUST, 'ارسال دارید؟'));
    await owner(t, '📥 بی‌پاسخ‌ها');
    expect(last(t)).toContain('🔁 1 بار');
    expect(t.tg.of('sendMessage', OWNER.id).at(-1)!.payload.reply_markup.inline_keyboard[0][0].callback_data).toBe('utofaq:1');
    await ownerCb(t, 'utofaq:1');
    expect(lastEdit(t).text).toContain('تبدیل به FAQ');
    await owner(t, 'ارسال نداریم');
    await owner(t, 'ارسال');
    expect(one(t.monshiDb, 'SELECT question, answer FROM faqs')).toEqual({ question: 'ارسال دارید؟', answer: 'ارسال نداریم' });
    expect(one(t.monshiDb, 'SELECT status FROM unanswered').status).toBe('faq_created');
    await owner(t, '/unanswered');
    expect(last(t)).toBe('🎉 سوال بی‌جوابی ثبت نشده.');
  });
});

describe('monshi admin: orders panel', () => {
  it('add via wizard, advance steps, cancel', async () => {
    const t = makeTestEnv({ store: false });
    await connect(t);
    q(t.monshiDb, "INSERT INTO customers (chat_id, username, first_name) VALUES (?, 'cust_user', 'Ali')", CUST.id);
    await owner(t, '🛒 سفارش‌ها');
    expect(last(t)).toBe('📦 سفارش باز فعال نیست.');
    await ownerCb(t, 'ord_add');
    expect(lastEdit(t).text).toContain('ثبت سفارش جدید');
    await owner(t, '@nobody');
    expect(last(t)).toContain('مشتری‌ای با این مشخصات پیدا نشد');
    await owner(t, '@cust_user');
    await owner(t, 'جمینای ۱ ماهه');
    expect(last(t)).toBe('✅ سفارش #1 ثبت شد و چک‌لیست برای مشتری ارسال می‌شود.');
    expect(t.tg.of('sendChecklist')).toHaveLength(1);
    expect(t.tg.of('sendChecklist')[0].payload.checklist.tasks.map((x: any) => x.text)[0]).toBe('🔄 ثبت سفارش');
    expect(one(t.monshiDb, 'SELECT checklist_message_id FROM orders').checklist_message_id).toBeTruthy();

    await owner(t, '/orders');
    expect(last(t)).toContain('#1 — جمینای ۱ ماهه — Ali (ثبت سفارش)');
    await ownerCb(t, 'ord_next:1');
    expect(one(t.monshiDb, 'SELECT status FROM orders').status).toBe('paid');
    expect(t.tg.of('editMessageChecklist')).toHaveLength(1);
    await ownerCb(t, 'ord_next:1');
    await ownerCb(t, 'ord_next:1');
    expect(one(t.monshiDb, 'SELECT status FROM orders').status).toBe('delivered');
    expect(t.tg.texts(CUST.id).at(-1)).toBe('🎉 سفارش «جمینای ۱ ماهه» با موفقیت تحویل داده شد. ممنون از خرید شما!');

    await owner(t, '/order_add');
    await owner(t, String(CUST.id));
    await owner(t, 'دوم');
    await ownerCb(t, 'ord_cancel:2');
    expect(one(t.monshiDb, 'SELECT status FROM orders WHERE id = 2').status).toBe('cancelled');
  });

  it('checklist failure falls back to a plain status message', async () => {
    const t = makeTestEnv({ store: false });
    await connect(t);
    q(t.monshiDb, "INSERT INTO customers (chat_id, first_name) VALUES (?, 'Ali')", CUST.id);
    t.tg.fail('sendChecklist', () => true, 400, 'Bad Request: premium required');
    await owner(t, '/order_add');
    await owner(t, String(CUST.id));
    await owner(t, 'سفارش تست');
    expect(t.tg.calls.filter((c) => c.method === 'sendMessage' && c.payload.chat_id === CUST.id && c.payload.business_connection_id === 'bc1').map((c) => c.payload.text))
      .toEqual(['وضعیت سفارش «سفارش تست»: ثبت سفارش ✅\nبه‌محض تغییر وضعیت، اطلاع‌رسانی می‌شود.']);
  });
});

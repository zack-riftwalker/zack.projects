import { describe, expect, it } from 'vitest';
import { budgets, makeTestEnv, OWNER, type TestEnv } from '../helpers/env';
import { businessMessageUpdate, callbackUpdate, textUpdate } from '../helpers/updates';
import { one, q } from '../helpers/seed';
import { CUST, connect, setHours, setSetting } from '../helpers/monshi';
import { looksPrivate } from '../../src/monshi/services/rules';

const sat = (utcH: number, utcM = 0) => new Date(Date.UTC(2026, 9, 3, utcH, utcM));

async function setup(notify?: string) {
  const t = makeTestEnv({ store: false, notify });
  await connect(t);
  setHours(t, 'open');
  setSetting(t, 'greeting_enabled', '0');
  return t;
}
const ask = (t: TestEnv, text = 'ارسال دارید؟', who = CUST) => t.send('monshi', businessMessageUpdate(who, text));
const ownerReplies = (t: TestEnv, text: string, chatId = CUST.id) => t.send('monshi', businessMessageUpdate(OWNER, text, { chatId }));
/** a manual reply pauses the bot in that chat for a few hours — lift it so the next question is processed */
const unpause = (t: TestEnv) => q(t.monshiDb, 'UPDATE customers SET automation_paused_until = NULL');
const unanswered = async (t: TestEnv) => {
  await t.send('monshi', textUpdate(OWNER, '/unanswered'));
  return t.tg.of('sendMessage', OWNER.id).at(-1)!.payload;
};

describe('unanswered questions with the owner\'s own reply', () => {
  it('shows «جواب خودت» and a one-tap button when the owner answered by hand', async () => {
    const t = await setup();
    await ask(t);
    await ownerReplies(t, 'بله، ارسال به سراسر کشور داریم');
    const view = await unanswered(t);
    expect(view.text).toContain('💬 ارسال دارید؟\n🧑 جواب خودت: «بله، ارسال به سراسر کشور داریم»');
    expect(view.reply_markup.inline_keyboard[0].map((b: any) => b.callback_data)).toEqual(['utofaq:1', 'utofaq_own:1']);
    expect(view.reply_markup.inline_keyboard[0][1].text).toBe('⚡️ FAQ با جواب خودم (#1)');
  });

  it('without an owner reply the view is exactly as before', async () => {
    const t = await setup();
    await ask(t);
    const view = await unanswered(t);
    expect(view.text).not.toContain('جواب خودت');
    expect(view.reply_markup.inline_keyboard[0]).toHaveLength(1);
  });

  it('the reply must come within 24 hours of the question', async () => {
    const t = await setup();
    await ask(t);
    await ownerReplies(t, 'بله، ارسال داریم');
    q(t.monshiDb, "UPDATE messages SET received_at = '2999-01-01T00:00:00.000000+00:00' WHERE direction = 'owner'");
    expect((await unanswered(t)).text).not.toContain('جواب خودت');
  });

  it('only the first reply after the question counts, and a recurring question follows its latest message', async () => {
    const t = await setup();
    await ask(t);
    await ownerReplies(t, 'جواب اول من');
    unpause(t);
    await ask(t); // same question again → count 2, latest row
    await ownerReplies(t, 'جواب دوم من');
    const view = await unanswered(t);
    expect(view.text).toContain('2 بار');
    expect(view.text).toContain('«جواب دوم من»');
    expect(view.text).not.toContain('جواب اول من');
  });

  it('personal replies are never suggested', async () => {
    const t = await setup();
    await ask(t);
    await ownerReplies(t, 'شماره کارت 6037 9972 1234 5678 رو بزن');
    const view = await unanswered(t);
    expect(view.text).not.toContain('جواب خودت');
    expect(view.reply_markup.inline_keyboard[0]).toHaveLength(1);
  });

  it('looksPrivate rules', () => {
    for (const text of [
      'ok', 'رمز عبورت: abc', 'کد ورود شما ۱۲۳۴۵۶', '09123456789', '۰۹۱۲ ۳۴۵ ۶۷۸۹', 'ali@example.com', 'username: ali', 'password : 123', 'شکایت شما ثبت شد',
    ]) expect(looksPrivate(text), text).toBe(true);
    for (const text of ['بله، ارسال به سراسر کشور داریم', 'قیمت ۱۲۰٬۰۰۰ تومان است', 'تا ۲۴ ساعت آینده تحویل می‌دهیم', 'نسخه ۳ ماهه موجود است'])
      expect(looksPrivate(text), text).toBe(false);
  });

  it('tapping ⚡️ creates the FAQ from the question and the owner\'s reply (the keywords step stays) and resolves the item', async () => {
    const t = await setup();
    await ask(t);
    await ownerReplies(t, 'بله، ارسال به سراسر کشور داریم');
    await t.send('monshi', callbackUpdate(OWNER, 'utofaq_own:1', { text: 'old', chatId: OWNER.id }));
    const edit = t.tg.of('editMessageText').at(-1)!.payload.text as string;
    expect(edit).toContain('⚡️ تبدیل به FAQ:\n❓ ارسال دارید؟\n💬 بله، ارسال به سراسر کشور داریم');
    expect(edit).toContain('۳) کلیدواژه‌های تشخیص این سوال');

    await t.send('monshi', textUpdate(OWNER, 'ارسال, پست'));
    expect(one(t.monshiDb, 'SELECT question, answer, keywords, enabled FROM faqs')).toEqual({
      question: 'ارسال دارید؟', answer: 'بله، ارسال به سراسر کشور داریم', keywords: 'ارسال, پست', enabled: 1,
    });
    expect(one(t.monshiDb, 'SELECT status FROM unanswered').status).toBe('faq_created');
    expect(t.tg.texts(OWNER.id).at(-1)).toContain('FAQ #1 ذخیره شد');
  });

  it('the old «➕ تبدیل به FAQ» button still asks for the answer text', async () => {
    const t = await setup();
    await ask(t);
    await t.send('monshi', callbackUpdate(OWNER, 'utofaq:1', { text: 'old', chatId: OWNER.id }));
    expect(t.tg.of('editMessageText').at(-1)!.payload.text).toContain('حالا متن جوابی که باید فرستاده شود را بنویس');
  });

  it('the reply is looked up again on tap: gone or private → refused, nothing created', async () => {
    const t = await setup();
    await ask(t);
    await ownerReplies(t, 'بله، ارسال داریم');
    q(t.monshiDb, "UPDATE messages SET text = 'رمز عبور: 12345678' WHERE direction = 'owner'");
    await t.send('monshi', callbackUpdate(OWNER, 'utofaq_own:1', { text: 'old', chatId: OWNER.id }));
    expect(t.tg.of('editMessageText').at(-1)!.payload.text).toContain('جواب قابل‌استفاده‌ای پیدا نشد');
    await t.send('monshi', textUpdate(OWNER, 'x'));
    expect(q(t.monshiDb, 'SELECT * FROM faqs')).toHaveLength(0);

    await t.send('monshi', callbackUpdate(OWNER, 'utofaq_own:99', { text: 'old', chatId: OWNER.id }));
    expect(t.tg.of('editMessageText').at(-1)!.payload.text).toContain('دیگر موجود نیست');
  });

  it('a notify account cannot use the button', async () => {
    const t = await setup('6001');
    await ask(t);
    await ownerReplies(t, 'بله، ارسال داریم');
    await t.send('monshi', callbackUpdate({ id: 6001, first_name: 'N' }, 'utofaq_own:1', { text: 'old', chatId: 6001 }));
    expect(t.tg.of('editMessageText')).toHaveLength(0);
  });
});

describe('weekly digest mentions answerable questions', () => {
  it('adds the 💡 line with the count', async () => {
    const t = await setup();
    await ask(t);
    await ownerReplies(t, 'بله، ارسال داریم');
    unpause(t);
    await ask(t, 'موجودی دارید؟');
    await ownerReplies(t, 'بله موجود است');
    t.tg.reset();
    await t.cron(sat(6, 0));
    const digest = t.tg.of('sendMessage', OWNER.id)[0].payload.text as string;
    expect(digest).toContain('💡 برای 2 سؤال بی‌جواب، جواب خودت پیدا شد؛ با دکمه‌ی ⚡️ مستقیم FAQ کن.');
    expect(digest).toContain('🧑 جواب خودت: «بله، ارسال داریم»');
  });

  it('no line when nothing is answerable', async () => {
    const t = await setup();
    await ask(t);
    t.tg.reset();
    await t.cron(sat(6, 0));
    expect(t.tg.of('sendMessage', OWNER.id)[0].payload.text).not.toContain('💡');
  });
});

describe('cost', () => {
  it('10 unanswered items with owner replies stay well inside the call budget', async () => {
    const t = await setup();
    for (let i = 0; i < 10; i++) {
      const who = { id: 8000 + i, first_name: 'C' + i };
      await t.send('monshi', businessMessageUpdate(who, 'سوال شماره ' + 'ابجدهوزحطیکلمن'[i] + ' چیه'));
      await ownerReplies(t, 'جواب شماره ' + i + ' از طرف من', who.id);
    }
    budgets.length = 0;
    const view = await unanswered(t);
    expect(view.reply_markup.inline_keyboard).toHaveLength(10);
    expect(view.reply_markup.inline_keyboard.every((r: any) => r.length === 2)).toBe(true);
    expect(budgets.at(-1)!.used).toBeLessThanOrEqual(25);
  });

  it('saveMessage returns the new row id, and 0 for a duplicate', async () => {
    const t = await setup();
    const db = t.apps().monshi!.db;
    const id = await db.saveMessage(1, 55, 'in', 'text', 'x', 'bc1');
    expect(id).toBeGreaterThan(0);
    expect(await db.saveMessage(1, 55, 'in', 'text', 'x', 'bc1')).toBe(0);
  });
});

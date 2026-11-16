import { describe, expect, it } from 'vitest';
import { makeTestEnv, OWNER } from '../helpers/env';
import { businessConnectionUpdate, businessMessageUpdate, callbackUpdate } from '../helpers/updates';
import { one, q } from '../helpers/seed';
import { CUST, addFaq, answeredBy, businessReplies, connect, fakeGemini, setHours, setSetting } from '../helpers/monshi';

async function geminiSetup(g: ReturnType<typeof fakeGemini>, greeting = false) {
  const t = makeTestEnv({ store: false, gemini: true, fetch: g.fetch });
  await connect(t);
  setSetting(t, 'greeting_enabled', greeting ? '1' : '0');
  setHours(t, 'open');
  return t;
}

describe('explicit HUMAN_HANDOFF is never answered automatically', () => {
  it('a faq_id on HUMAN_HANDOFF plus a firm keyword match still hands off (no canned answer)', async () => {
    const g = fakeGemini({ decisions: [{ action: 'HUMAN_HANDOFF', faq_id: 1, confidence: 0.9 }] });
    const t = await geminiSetup(g);
    addFaq(t, { question: 'گارانتی دارید؟', answer: 'بله، ۷ روز گارانتی', keywords: 'گارانتی,ضمانت' });
    await t.send('monshi', businessMessageUpdate(CUST, 'این چه گارانتی و ضمانتیه؟ اکانت خراب شد پولمو پس بدید'));
    expect(businessReplies(t, CUST.id)).toEqual([]);
    expect(answeredBy(t, CUST.id)).toEqual(['handoff']);
    expect(t.tg.texts(OWNER.id)).toEqual([expect.stringContaining('نیازمند بررسی انسانی (تشخیص Gemini)')]);
  });

  it('a price complaint with HUMAN_HANDOFF gets the handoff, not the sales-bot referral', async () => {
    const g = fakeGemini({ decisions: [{ action: 'HUMAN_HANDOFF', faq_id: null, confidence: 0.9 }] });
    const t = await geminiSetup(g);
    addFaq(t, { question: 'x', answer: 'y', keywords: 'ایکس' });
    await t.send('monshi', businessMessageUpdate(CUST, 'چرا قیمت رو بیشتر حساب کردید؟ پولمو پس بدید'));
    expect(businessReplies(t, CUST.id)).toEqual([]);
    expect(answeredBy(t, CUST.id)).toEqual(['handoff']);
    expect(t.tg.texts(OWNER.id)).toEqual([expect.stringContaining('نیازمند بررسی انسانی (تشخیص Gemini)')]);
  });
});

describe('Gemini history', () => {
  it('a greeted new customer: history excludes the current message, short query is not duplicated', async () => {
    const g = fakeGemini({ decisions: [{ action: 'IGNORE', faq_id: null, confidence: 0.9 }] });
    const t = await geminiSetup(g, true);
    addFaq(t, { question: 'سوال', answer: 'جواب', keywords: '' });
    await t.send('monshi', businessMessageUpdate(CUST, 'کی بازید؟'));
    expect(businessReplies(t, CUST.id)).toHaveLength(1); // the greeting went out before Gemini ran
    const prompt = g.generateCalls()[0].body.contents[0].parts[0].text as string;
    expect(prompt).not.toContain('گفت‌وگوی اخیر'); // nothing came before the first message
    expect(prompt).toContain('سوال جدید مشتری: کی بازید؟');
    const embedQuery = g.calls.find((c) => c.url.includes(':embedContent'))!.body.content.parts[0].text;
    expect(embedQuery).toBe('کی بازید؟');
  });
});

describe('hfaq: button', () => {
  it('two staff pressing the same FAQ button at once → the customer gets it once', async () => {
    const t = makeTestEnv({ store: false, notify: '6001' });
    await connect(t);
    const id = addFaq(t, { question: 'گارانتی', answer: 'جواب گارانتی', keywords: '' });
    // slow customer sends, so both presses are in flight together
    const base = t.deps.makeApi!;
    t.deps.makeApi = (token) => {
      const api = base(token);
      api.config.use(async (prev, method, payload, signal) => {
        if (method === 'sendMessage' && (payload as any)?.business_connection_id) await new Promise((r) => setTimeout(r, 30));
        return prev(method, payload, signal);
      });
      return api;
    };
    await Promise.all([
      t.send('monshi', callbackUpdate(OWNER, `hfaq:${CUST.id}:${id}`)),
      t.send('monshi', callbackUpdate({ id: 6001, first_name: 'N' }, `hfaq:${CUST.id}:${id}`)),
    ]);
    expect(businessReplies(t, CUST.id)).toEqual(['جواب گارانتی']);
  });

  it('a failed send releases the claim so the button works again', async () => {
    const t = makeTestEnv({ store: false });
    await connect(t);
    const id = addFaq(t, { question: 'گارانتی', answer: 'جواب گارانتی', keywords: '' });
    t.tg.fail('sendMessage', (c) => !!c.payload.business_connection_id, 400, 'Bad Request: x', 1);
    await t.send('monshi', callbackUpdate(OWNER, `hfaq:${CUST.id}:${id}`));
    expect(t.tg.of('answerCallbackQuery').at(-1)!.payload.text).toContain('پیام به مشتری نرسید');
    expect(q(t.monshiDb, 'SELECT * FROM reply_log')).toHaveLength(0);
    await t.send('monshi', callbackUpdate(OWNER, `hfaq:${CUST.id}:${id}`));
    expect(businessReplies(t, CUST.id)).toHaveLength(2); // the failed attempt + the retry
    expect(t.tg.of('answerCallbackQuery').at(-1)!.payload.text).toContain('✅ ارسال شد');
    expect(one(t.monshiDb, 'SELECT reply_key FROM reply_log').reply_key).toBe('faq:' + id);
  });
});

describe('disabled business connection', () => {
  it('messages are stored and forwarded to the owner, no auto-reply, no lookup per message; re-enabling restores replies', async () => {
    const t = makeTestEnv({ store: false });
    await connect(t);
    setHours(t, 'closed');
    addFaq(t, { question: 'گارانتی', answer: 'جواب گارانتی', keywords: 'گارانتی,ضمانت' });
    await t.send('monshi', businessConnectionUpdate(OWNER, 'bc1', false));
    t.tg.reset();

    await t.send('monshi', businessMessageUpdate(CUST, 'گارانتی و ضمانت دارید؟'));
    await t.send('monshi', businessMessageUpdate(CUST, 'سلام؟'));
    expect(businessReplies(t, CUST.id)).toEqual([]);
    expect(q(t.monshiDb, "SELECT * FROM messages WHERE direction = 'in'")).toHaveLength(2);
    expect(t.tg.texts(OWNER.id)).toHaveLength(2);
    expect(t.tg.of('getBusinessConnection')).toHaveLength(0);
    expect(one(t.monshiDb, 'SELECT is_enabled FROM connection').is_enabled).toBe(0);

    await t.send('monshi', businessConnectionUpdate(OWNER, 'bc1', true));
    t.tg.reset();
    await t.send('monshi', businessMessageUpdate(CUST, 'گارانتی و ضمانت دارید؟ جدید'));
    expect(businessReplies(t, CUST.id)).toEqual(['جواب گارانتی']);
  });

  it('a disabled connection learned through the self-heal lookup is not auto-answered either', async () => {
    const t = makeTestEnv({ store: false });
    setHours(t, 'closed');
    setSetting(t, 'greeting_enabled', '0');
    const base = t.deps.makeApi!;
    t.deps.makeApi = (token) => {
      const api = base(token);
      api.config.use(async (prev, method, payload, signal) => {
        const r: any = await prev(method, payload, signal);
        if (method === 'getBusinessConnection' && r.ok) return { ...r, result: { ...r.result, is_enabled: false } };
        return r;
      });
      return api;
    };
    await t.send('monshi', businessMessageUpdate(CUST, 'سلام'));
    await t.send('monshi', businessMessageUpdate(CUST, 'سلام دوباره'));
    expect(businessReplies(t, CUST.id)).toEqual([]);
    expect(t.tg.texts(OWNER.id)).toHaveLength(2);
    expect(t.tg.of('getBusinessConnection')).toHaveLength(1);
  });
});

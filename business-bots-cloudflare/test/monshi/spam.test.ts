import { describe, expect, it } from 'vitest';
import { makeTestEnv, OWNER } from '../helpers/env';
import { businessMessageUpdate } from '../helpers/updates';
import { q } from '../helpers/seed';
import { CUST, addFaq, businessReplies, connect, fakeGemini, setHours, setSetting } from '../helpers/monshi';

async function setup(gemini?: ReturnType<typeof fakeGemini>) {
  const t = makeTestEnv({ store: false, ...(gemini ? { gemini: true, fetch: gemini.fetch } : {}) });
  await connect(t);
  setSetting(t, 'greeting_enabled', '0');
  setHours(t, 'open');
  return t;
}
const burst = (t: Awaited<ReturnType<typeof setup>>, text: string, n = 3) =>
  Promise.all(Array.from({ length: n }, () => t.send('monshi', businessMessageUpdate(CUST, text))));

describe('monshi: no repeated auto-replies', () => {
  it('the same keyword sent several times at once is answered once (keyword path)', async () => {
    const t = await setup();
    addFaq(t, { question: 'اکانت پرو', answer: 'پرو ماهی ۱۰۰', keywords: 'پرو, اکانت' });
    await burst(t, 'اکانت پرو');
    expect(businessReplies(t, CUST.id)).toEqual(['پرو ماهی ۱۰۰']);
  });

  it('the same keyword sent several times at once is answered once (Gemini path)', async () => {
    const d = { action: 'FAQ_ANSWER', faq_id: 1, confidence: 0.95 };
    const t = await setup(fakeGemini({ decisions: [d, d, d] }));
    addFaq(t, { question: 'اکانت پرو', answer: 'پرو ماهی ۱۰۰', keywords: '' });
    await burst(t, 'پرو');
    expect(businessReplies(t, CUST.id)).toEqual(['پرو ماهی ۱۰۰']);
  });

  it('price fallback is sent once for a burst', async () => {
    const t = await setup();
    setSetting(t, 'price_fallback_message', 'قیمت‌ها در ربات فروش');
    await burst(t, 'قیمت چنده');
    expect(businessReplies(t, CUST.id)).toEqual(['قیمت‌ها در ربات فروش']);
  });

  it('order status is repeated only when the status changes', async () => {
    const t = await setup();
    q(t.monshiDb, "INSERT INTO orders (chat_id, title, status, business_connection_id) VALUES (?, 'T', 'paid', 'bc1')", CUST.id);
    await burst(t, 'سفارشم کی میرسه');
    await t.send('monshi', businessMessageUpdate(CUST, 'سفارشم کی میرسه؟؟'));
    expect(businessReplies(t, CUST.id)).toHaveLength(1);
    q(t.monshiDb, "UPDATE orders SET status = 'preparing'");
    await t.send('monshi', businessMessageUpdate(CUST, 'سفارشم کی میرسه؟'));
    expect(businessReplies(t, CUST.id)).toHaveLength(2);
  });

  it('a send failure releases the claim so the next message is answered', async () => {
    const t = await setup();
    addFaq(t, { question: 'اکانت پرو', answer: 'پرو ماهی ۱۰۰', keywords: 'پرو, اکانت' });
    t.tg.fail('sendMessage', (c) => c.payload.chat_id === CUST.id && !!c.payload.business_connection_id, 400, 'Bad Request', 1);
    await t.send('monshi', businessMessageUpdate(CUST, 'اکانت پرو'));
    await t.send('monshi', businessMessageUpdate(CUST, 'اکانت پرو؟'));
    expect(businessReplies(t, CUST.id)).toEqual(['پرو ماهی ۱۰۰', 'پرو ماهی ۱۰۰']); // 1 failed attempt + 1 success
    expect(q(t.monshiDb, 'SELECT * FROM reply_log')).toHaveLength(1);
  });

  it('an explicit HUMAN_HANDOFF is never overridden by a keyword match', async () => {
    const t = await setup(fakeGemini({ decisions: [{ action: 'HUMAN_HANDOFF', faq_id: null, confidence: 0.9 }] }));
    addFaq(t, { question: 'اکانت پرو', answer: 'پرو ماهی ۱۰۰', keywords: 'پرو, اکانت' });
    await t.send('monshi', businessMessageUpdate(CUST, 'از اکانت پرو راضی نیستم پولمو پس بدید'));
    expect(businessReplies(t, CUST.id)).toEqual([]);
    expect(t.tg.texts(OWNER.id).at(-1)).toContain('تشخیص Gemini');
  });
});

describe('gemini: prompt', () => {
  it('candidates are listed with an answer snippet', async () => {
    const g = fakeGemini({ decisions: [{ action: 'IGNORE', faq_id: null, confidence: 0.9 }] });
    const t = await setup(g);
    addFaq(t, { question: 'گارانتی دارید؟', answer: 'بله،\n۷ روز گارانتی', keywords: '' });
    await t.send('monshi', businessMessageUpdate(CUST, 'ضمانت؟'));
    expect(g.generateCalls()[0].body.contents[0].parts[0].text).toContain('#1: گارانتی دارید؟\n   پاسخ: بله، ۷ روز گارانتی');
  });
});

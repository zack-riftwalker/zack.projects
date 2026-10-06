import { describe, expect, it } from 'vitest';
import { budgets, makeTestEnv, OWNER } from '../helpers/env';
import { businessMessageUpdate } from '../helpers/updates';
import { one, q } from '../helpers/seed';
import { CUST, addFaq, answeredBy, businessReplies, connect, fakeGemini, getSetting, setHours, setSetting } from '../helpers/monshi';
import { cosine, decodeEmbedding, encodeEmbedding, routeDecision } from '../../src/monshi/services/gemini';

async function setup(g: ReturnType<typeof fakeGemini>) {
  const t = makeTestEnv({ store: false, gemini: true, fetch: g.fetch });
  await connect(t);
  setSetting(t, 'greeting_enabled', '0');
  setHours(t, 'open');
  return t;
}

describe('gemini: routing logic', () => {
  const d = (action: any, confidence: number) => ({ action, faq_id: 1, confidence });
  it('routeDecision follows thresholds', () => {
    expect(routeDecision(d('FAQ_ANSWER', 0.9), true, 0.82, 0.68)).toBe('answer');
    expect(routeDecision(d('FAQ_ANSWER', 0.75), true, 0.82, 0.68)).toBe('handoff');
    expect(routeDecision(d('FAQ_ANSWER', 0.5), true, 0.82, 0.68)).toBe('fallthrough');
    expect(routeDecision(d('FAQ_ANSWER', 0.99), false, 0.82, 0.68)).toBe('fallthrough');
    expect(routeDecision(d('HUMAN_HANDOFF', 0.1), false, 0.82, 0.68)).toBe('handoff');
    expect(routeDecision(d('ORDER_STATUS', 0.1), false, 0.82, 0.68)).toBe('order_status');
    expect(routeDecision(d('IGNORE', 1), true, 0.82, 0.68)).toBe('fallthrough');
  });
  it('embedding encode/decode round-trips and cosine works', () => {
    const v = [0.25, -1.5, 3];
    expect(Array.from(decodeEmbedding(encodeEmbedding(v)))).toEqual(v);
    expect(cosine([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0);
    expect(cosine([0, 0], [1, 1])).toBe(0);
  });
});

describe('gemini: pipeline', () => {
  it('FAQ_ANSWER above the threshold answers with the DB text; embeddings are computed once and reused', async () => {
    const g = fakeGemini({ decisions: [{ action: 'FAQ_ANSWER', faq_id: 1, confidence: 0.95 }, { action: 'FAQ_ANSWER', faq_id: 1, confidence: 0.95 }] });
    const t = await setup(g);
    addFaq(t, { question: 'گارانتی دارید؟', answer: 'بله، ۷ روز گارانتی', keywords: '' });
    await t.send('monshi', businessMessageUpdate(CUST, 'ضمانت هم داره؟'));
    expect(businessReplies(t, CUST.id)).toEqual(['بله، ۷ روز گارانتی']);
    expect(g.calls.filter((c) => c.url.includes(':batchEmbedContents'))).toHaveLength(1);
    const body = g.calls.find((c) => c.url.includes(':batchEmbedContents'))!.body;
    expect(body.requests[0]).toMatchObject({ model: 'models/gemini-embedding-001', taskType: 'RETRIEVAL_DOCUMENT', outputDimensionality: 768 });
    expect(g.calls.find((c) => c.url.includes(':embedContent'))!.body).toMatchObject({ taskType: 'RETRIEVAL_QUERY', outputDimensionality: 768 });

    q(t.monshiDb, "DELETE FROM reply_log");
    await t.send('monshi', businessMessageUpdate(CUST, 'گارانتی چقدره'));
    expect(g.calls.filter((c) => c.url.includes(':batchEmbedContents'))).toHaveLength(1); // not recomputed
    expect(one(t.monshiDb, 'SELECT embedding FROM faqs').embedding).toBeTruthy();
    expect(getSetting(t, 'embedding_version')).toBe('3-768');
    const gen = g.generateCalls()[0];
    expect(gen.model).toBe('gemini-3.5-flash');
    expect(gen.body.generationConfig).toMatchObject({ responseMimeType: 'application/json', temperature: 0.1 });
    expect(gen.body.contents[0].parts[0].text).toContain('سوال جدید مشتری: ضمانت هم داره؟');
    expect(gen.body.contents[0].parts[0].text).toContain('#1: گارانتی دارید؟');
  });

  it('mid-band confidence: a firm keyword match wins; otherwise the owner is notified', async () => {
    const g = fakeGemini({ decisions: [{ action: 'FAQ_ANSWER', faq_id: 1, confidence: 0.75 }, { action: 'FAQ_ANSWER', faq_id: 1, confidence: 0.75 }] });
    const t = await setup(g);
    addFaq(t, { question: 'پرداخت اقساطی', answer: 'اقساط نداریم', keywords: 'اقساط, قسطی' });
    await t.send('monshi', businessMessageUpdate(CUST, 'میشه اقساط بدید قسطی؟'));
    expect(businessReplies(t, CUST.id)).toEqual(['اقساط نداریم']);

    await t.send('monshi', businessMessageUpdate({ id: 7100, first_name: 'Z' }, 'یه چیز عجیب'));
    expect(businessReplies(t, 7100)).toEqual([]);
    expect(answeredBy(t, 7100)).toEqual(['handoff']);
    expect(t.tg.texts(OWNER.id).at(-1)).toContain('نیازمند بررسی انسانی (تشخیص Gemini)');
  });

  it('HUMAN_HANDOFF on a price question without FAQ → sales-bot referral instead of a notification', async () => {
    const g = fakeGemini({ decisions: [{ action: 'HUMAN_HANDOFF', faq_id: null, confidence: 0.9 }] });
    const t = await setup(g);
    addFaq(t, { question: 'x', answer: 'y', keywords: 'ایکس' });
    await t.send('monshi', businessMessageUpdate(CUST, 'قیمت اکانت پرو چنده؟'));
    expect(answeredBy(t, CUST.id)).toEqual(['price_fallback']);
    expect(t.tg.texts(OWNER.id)).toHaveLength(0);
  });

  it('ORDER_STATUS with an open order → status text; without one → normal flow continues', async () => {
    const g = fakeGemini({ decisions: [{ action: 'ORDER_STATUS', faq_id: null, confidence: 0.9 }, { action: 'ORDER_STATUS', faq_id: null, confidence: 0.9 }] });
    const t = await setup(g);
    addFaq(t, { question: 'x', answer: 'y', keywords: 'ایکس' });
    await t.send('monshi', businessMessageUpdate(CUST, 'کی میرسه؟'));
    expect(answeredBy(t, CUST.id)).toEqual(['none']); // no open order → silent in business hours
    q(t.monshiDb, "INSERT INTO orders (chat_id, title, status, business_connection_id) VALUES (?, 'T', 'paid', 'bc1')", CUST.id);
    await t.send('monshi', businessMessageUpdate(CUST, 'کی میرسه؟؟'));
    expect(answeredBy(t, CUST.id)).toEqual(['none', 'order_status']);
  });

  it('any Gemini failure silently falls back to keyword matching', async () => {
    const g = fakeGemini({ failEmbeddings: true });
    const t = await setup(g);
    addFaq(t, { question: 'گارانتی', answer: 'ضمانت ۷ روزه', keywords: 'گارانتی, ضمانت' });
    await t.send('monshi', businessMessageUpdate(CUST, 'گارانتی دارید؟ ضمانت؟'));
    expect(businessReplies(t, CUST.id)).toEqual(['ضمانت ۷ روزه']);
  });

  it('primary-model failure → fallback model + circuit breaker for the following requests', async () => {
    const g = fakeGemini({ failModels: ['gemini-3.5-flash'], decisions: [{ action: 'FAQ_ANSWER', faq_id: 1, confidence: 0.95 }, { action: 'FAQ_ANSWER', faq_id: 1, confidence: 0.95 }] });
    const t = await setup(g);
    addFaq(t, { question: 'گارانتی دارید؟', answer: 'بله', keywords: '' });
    await t.send('monshi', businessMessageUpdate(CUST, 'ضمانت چی؟'));
    expect(g.generateCalls().map((c) => c.model)).toEqual(['gemini-3.5-flash', 'gemini-3.1-flash-lite']);
    expect(businessReplies(t, CUST.id)).toEqual(['بله']);
    expect(Number(one(t.monshiDb, "SELECT value FROM app_state WHERE key='gemini_primary_down_until'").value)).toBeGreaterThan(Date.now());

    q(t.monshiDb, 'DELETE FROM reply_log');
    await t.send('monshi', businessMessageUpdate(CUST, 'ضمانت چی؟؟'));
    expect(g.generateCalls().map((c) => c.model)).toEqual(['gemini-3.5-flash', 'gemini-3.1-flash-lite', 'gemini-3.1-flash-lite']);
  });

  it('short messages borrow the previous customer message for retrieval; history is sent as context', async () => {
    const g = fakeGemini({ decisions: [{ action: 'IGNORE', faq_id: null, confidence: 0.1 }, { action: 'IGNORE', faq_id: null, confidence: 0.1 }] });
    const t = await setup(g);
    addFaq(t, { question: 'x', answer: 'y', keywords: 'ایکس' });
    await t.send('monshi', businessMessageUpdate(CUST, 'جمینای یک ماهه رو می‌خوام'));
    await t.send('monshi', businessMessageUpdate(CUST, 'چقدر شد؟'));
    const queryEmbeds = g.calls.filter((c) => c.url.includes(':embedContent'));
    expect(queryEmbeds[1].body.content.parts[0].text).toBe('جمینای یک ماهه رو می‌خوام چقدر شد؟');
    expect(g.generateCalls()[1].body.contents[0].parts[0].text).toContain('گفت‌وگوی اخیر (قدیم به جدید):\nمشتری: جمینای یک ماهه رو می‌خوام');
  });

  it('missing key or disabled setting → Gemini is never called', async () => {
    const g = fakeGemini();
    const t = makeTestEnv({ store: false, gemini: false, fetch: g.fetch });
    await connect(t);
    setHours(t, 'open');
    addFaq(t, { question: 'x', answer: 'y', keywords: 'ایکس' });
    await t.send('monshi', businessMessageUpdate(CUST, 'ایکس چیه؟ ایکس'));
    expect(g.calls).toHaveLength(0);
  });

  it('call budget stays small per message', async () => {
    const g = fakeGemini({ decisions: [{ action: 'FAQ_ANSWER', faq_id: 1, confidence: 0.95 }] });
    const t = await setup(g);
    addFaq(t, { question: 'گارانتی دارید؟', answer: 'بله', keywords: '' });
    await t.send('monshi', businessMessageUpdate(CUST, 'ضمانت؟'));
    const used = budgets.at(-1)!.used;
    expect(used).toBeGreaterThan(5);
    expect(used).toBeLessThanOrEqual(25);
  });
});

describe('gemini: many FAQs without embeddings', () => {
  it('45 un-embedded FAQs (e.g. right after migration) are embedded on the first message within budget', async () => {
    const g = fakeGemini({ decisions: [{ action: 'FAQ_ANSWER', faq_id: 1, confidence: 0.95 }] });
    const t = await setup(g);
    for (let i = 0; i < 45; i++) addFaq(t, { question: 'سوال ' + i, answer: 'جواب ' + i, keywords: '' });
    await t.send('monshi', businessMessageUpdate(CUST, 'یک سوال تستی'));
    expect(one(t.monshiDb, 'SELECT COUNT(*) AS n FROM faqs WHERE embedding IS NOT NULL').n).toBe(45);
    expect(g.calls.filter((c) => c.url.includes(':batchEmbedContents'))).toHaveLength(1);
    expect(g.generateCalls()).toHaveLength(1);
    expect(businessReplies(t, CUST.id)).toEqual(['جواب 0']);
    // each FAQ got its own vector back
    const rows = q(t.monshiDb, 'SELECT id, embedding FROM faqs ORDER BY id');
    expect(rows.every((r: any) => Array.from(decodeEmbedding(r.embedding)).length === 3)).toBe(true);
  });
});

describe('MonshiDb.setFaqEmbeddings', () => {
  it('writes each row its own embedding in a single statement and leaves other rows alone', async () => {
    const t = makeTestEnv({ store: false });
    const a = addFaq(t, { question: 'a', answer: 'A' });
    const b = addFaq(t, { question: 'b', answer: 'B' });
    const c = addFaq(t, { question: 'c', answer: 'C' });
    const before = t.monshiDb.log.length;
    await t.apps().monshi!.db.setFaqEmbeddings([{ id: a, embedding: 'EA' }, { id: c, embedding: 'EC' }]);
    expect(t.monshiDb.log.length - before).toBe(1);
    expect(q(t.monshiDb, 'SELECT id, embedding FROM faqs ORDER BY id')).toEqual([
      { id: a, embedding: 'EA' }, { id: b, embedding: null }, { id: c, embedding: 'EC' },
    ]);
  });
});

/**
 * Gemini layer — FAQ *selector* only, never a free-text answer generator.
 * Flow: embed the customer text → nearest FAQs by cosine similarity → Gemini
 * (structured output) returns only faq_id + confidence → the reply text is
 * always read verbatim from the database. Any error / missing key → null so
 * the caller silently falls back to keyword matching.
 * REST port of services/gemini.py (no SDK on Workers).
 */
import type { MonshiApp } from '../../apps';
import type { FaqRow, MessageRow } from '../db';

export const EMBEDDING_MODEL = 'gemini-embedding-001';
export const GENERATION_MODEL = 'gemini-3.5-flash';
// Used when the primary model hits a limit or is unavailable
export const FALLBACK_GENERATION_MODEL = 'gemini-3.1-flash-lite';
// After a primary failure, use the fallback directly for this long
export const PRIMARY_RETRY_SECONDS = 600;
export const TOP_K_CANDIDATES = 5;
export const REQUEST_TIMEOUT_MS = 8000;
export const EMBEDDING_DIM = 768;
export const EMBEDDING_SCHEMA_VERSION = '3-768';
export const HISTORY_LOOKBACK = 6; // recent messages (both directions) given to Gemini as context
export const SHORT_TEXT_CHARS = 15; // below this the previous customer message is prepended to the embedding query
const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const EMBED_BATCH = 100;
// Budget kept free for the rest of the message pipeline (query embedding, classification, reply, DB writes)
const EMBED_BUDGET_RESERVE = 20;

export const SYSTEM_PROMPT = `تو مسئول دسته‌بندی پیام‌های مشتریان یک فروشگاه تلگرامی هستی.

تنها وظیفه تو انتخاب یکی از FAQهای ارائه‌شده، یا تشخیص سوال درباره وضعیت سفارش است.
هیچ قیمت، ضمانت، ویژگی یا اطلاعات جدیدی تولید نکن.
اگر پیام صریحاً می‌پرسد سفارش/خریدش به کجا رسیده یا کی می‌رسد (نه سوال قیمت یا خرید جدید)،
action را ORDER_STATUS بگذار و faq_id را خالی بگذار.
اگر پاسخ دقیق در FAQها وجود ندارد و سوال سفارش هم نیست، HUMAN_HANDOFF را انتخاب کن.
اگر پیام درباره پرداخت ناموفق، شکایت، رمز عبور، کد ورود یا مشکل امنیتی است،
همیشه HUMAN_HANDOFF را انتخاب کن.
از گفت‌وگوی اخیر (در صورت ارائه) فقط برای فهم منظور واقعی مشتری استفاده کن؛
همچنان فقط باید یکی از FAQهای ارائه‌شده را انتخاب کنی، نه چیز دیگری.

فقط JSON مطابق Schema تعیین‌شده برگردان.`;

export const ACTIONS = ['FAQ_ANSWER', 'AFTER_HOURS_ACK', 'HUMAN_HANDOFF', 'ASK_CLARIFICATION', 'IGNORE', 'ORDER_STATUS'] as const;
export type Action = (typeof ACTIONS)[number];

export interface FaqDecision {
  action: Action;
  faq_id: number | null;
  confidence: number;
}

export type Route = 'answer' | 'handoff' | 'order_status' | 'fallthrough';

/**
 * Only FAQ_ANSWER with high confidence is answered automatically; the middle
 * band goes to a human; HUMAN_HANDOFF is always a handoff; ORDER_STATUS goes to
 * order tracking; everything else falls through to keyword/hours logic.
 */
export function routeDecision(decision: FaqDecision, hasCandidate: boolean, faqThreshold: number, handoffThreshold: number): Route {
  if (decision.action === 'FAQ_ANSWER' && hasCandidate) {
    if (decision.confidence >= faqThreshold) return 'answer';
    if (decision.confidence >= handoffThreshold) return 'handoff';
    return 'fallthrough';
  }
  if (decision.action === 'HUMAN_HANDOFF') return 'handoff';
  if (decision.action === 'ORDER_STATUS') return 'order_status';
  return 'fallthrough';
}

// ── embedding encoding (Float32 → base64) ───────────────────────────────────
export function encodeEmbedding(values: number[]): string {
  const bytes = new Uint8Array(new Float32Array(values).buffer);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

export function decodeEmbedding(b64: string): Float32Array {
  const s = atob(b64);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return new Float32Array(bytes.buffer);
}

export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// Decoded-embedding cache (module level — survives across requests in one isolate)
// Keyed by FAQ id and validated against the stored text: re-embedding (model/version change) does not touch
// updated_at, so the old key scheme could keep serving the previous model's vectors.
const decoded = new Map<number, { src: string; vec: Float32Array }>();
function decodedFor(faq: FaqRow): Float32Array {
  const hit = decoded.get(faq.id);
  if (hit && hit.src === faq.embedding) return hit.vec;
  const vec = decodeEmbedding(faq.embedding!);
  decoded.set(faq.id, { src: faq.embedding!, vec });
  return vec;
}

export function embeddingText(faq: FaqRow): string {
  const keywords = (faq.keywords || '').replace(/,/g, ' ');
  return `${faq.question} ${keywords}`.trim();
}

export function formatHistory(history: MessageRow[]): string {
  const lines: string[] = [];
  for (const row of history) {
    const text = (row.text || '').trim();
    if (!text) continue;
    const label = row.direction === 'in' ? 'مشتری' : 'فروشنده';
    lines.push(`${label}: ${text.slice(0, 200)}`);
  }
  return lines.join('\n');
}

function lastCustomerMessage(history: MessageRow[]): string | null {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].direction === 'in' && history[i].text) return history[i].text;
  }
  return null;
}

export async function isEnabled(app: MonshiApp): Promise<boolean> {
  return !!app.cfg.geminiKey && (await app.ctx.getSetting('gemini_enabled')) === '1';
}

/** Currently used generation model (primary, or fallback while the primary recently failed). */
export async function activeGenerationModel(app: MonshiApp): Promise<string> {
  const until = Number((await app.ctx.getState('gemini_primary_down_until')) || 0);
  return app.apps.now().getTime() < until ? FALLBACK_GENERATION_MODEL : GENERATION_MODEL;
}

async function post(app: MonshiApp, path: string, body: unknown): Promise<any> {
  app.apps.budget.take();
  const res = await app.apps.fetch(BASE_URL + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': app.cfg.geminiKey! },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error('Gemini HTTP ' + res.status);
  return res.json();
}

/** Embeds every enabled FAQ that has no embedding yet (new / edited / migrated), in one batch call. */
export async function ensureEmbeddings(app: MonshiApp): Promise<void> {
  if ((await app.ctx.getSetting('embedding_version')) !== EMBEDDING_SCHEMA_VERSION) {
    await app.db.clearFaqEmbeddings();
    await app.ctx.setSetting('embedding_version', EMBEDDING_SCHEMA_VERSION);
    app.ctx.invalidateFaqs();
  }
  const faqs = await app.ctx.getEnabledFaqs();
  const missing = faqs.filter((f) => !f.embedding);
  if (!missing.length) return;

  for (let i = 0; i < missing.length; i += EMBED_BATCH) {
    // each chunk = 1 Gemini call + 1 D1 statement; what doesn't fit now is embedded on a later message
    if (app.apps.budget.remaining() - 2 < EMBED_BUDGET_RESERVE) return;
    const chunk = missing.slice(i, i + EMBED_BATCH);
    const data = await post(app, `/models/${EMBEDDING_MODEL}:batchEmbedContents`, {
      requests: chunk.map((f) => ({
        model: `models/${EMBEDDING_MODEL}`,
        content: { parts: [{ text: embeddingText(f) }] },
        taskType: 'RETRIEVAL_DOCUMENT',
        outputDimensionality: EMBEDDING_DIM,
      })),
    });
    const rows = chunk.map((f, idx) => ({ id: f.id, embedding: encodeEmbedding(data.embeddings[idx].values) }));
    await app.db.setFaqEmbeddings(rows);
    chunk.forEach((f, idx) => { f.embedding = rows[idx].embedding; });
  }
}

export async function findTopCandidates(app: MonshiApp, text: string, k = TOP_K_CANDIDATES): Promise<FaqRow[]> {
  await ensureEmbeddings(app);
  const rows = (await app.ctx.getEnabledFaqs()).filter((r) => r.embedding);
  if (!rows.length) return [];
  const data = await post(app, `/models/${EMBEDDING_MODEL}:embedContent`, {
    content: { parts: [{ text }] },
    taskType: 'RETRIEVAL_QUERY',
    outputDimensionality: EMBEDDING_DIM,
  });
  const query = data.embedding.values as number[];
  return rows
    .map((r) => ({ score: cosine(query, decodedFor(r)), row: r }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map((x) => x.row);
}

const DECISION_SCHEMA = {
  type: 'object',
  properties: {
    action: { type: 'string', enum: [...ACTIONS] },
    faq_id: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
    confidence: { type: 'number' },
  },
  required: ['action', 'confidence'],
};

export function parseDecision(raw: string): FaqDecision {
  const obj = JSON.parse(raw);
  if (!obj || !(ACTIONS as readonly string[]).includes(obj.action)) throw new Error('invalid action');
  if (typeof obj.confidence !== 'number' || !Number.isFinite(obj.confidence)) throw new Error('invalid confidence');
  const faq_id = obj.faq_id === undefined || obj.faq_id === null ? null : obj.faq_id;
  if (faq_id !== null && !Number.isInteger(faq_id)) throw new Error('invalid faq_id');
  return { action: obj.action, faq_id, confidence: obj.confidence };
}

async function generate(app: MonshiApp, model: string, prompt: string): Promise<FaqDecision> {
  const data = await post(app, `/models/${model}:generateContent`, {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: 'application/json', temperature: 0.1, responseJsonSchema: DECISION_SCHEMA },
  });
  return parseDecision(data.candidates[0].content.parts[0].text);
}

async function classify(app: MonshiApp, text: string, candidates: FaqRow[], historyText = ''): Promise<FaqDecision> {
  const listing = candidates.map((r) => `#${r.id}: ${r.question}`).join('\n');
  const historyBlock = historyText ? `گفت‌وگوی اخیر (قدیم به جدید):\n${historyText}\n\n` : '';
  const prompt = `${historyBlock}سوال جدید مشتری: ${text}\n\nFAQهای نزدیک:\n${listing}`;
  const model = await activeGenerationModel(app);
  try {
    return await generate(app, model, prompt);
  } catch (err) {
    if (model !== GENERATION_MODEL) throw err; // the fallback failed too → caller falls back to keywords
    // primary failed (limit / unavailable / timeout) → retry with the fallback + circuit breaker
    await app.ctx.setState('gemini_primary_down_until', String(app.apps.now().getTime() + PRIMARY_RETRY_SECONDS * 1000));
    console.warn(`Primary model ${GENERATION_MODEL} failed; using ${FALLBACK_GENERATION_MODEL} for the next ${PRIMARY_RETRY_SECONDS / 60} minutes`);
    return generate(app, FALLBACK_GENERATION_MODEL, prompt);
  }
}

/**
 * Gemini's decision plus the matching FAQ row (if any); null when disabled or on any
 * error (the caller must silently fall back to keyword matching).
 */
export async function getDecision(app: MonshiApp, text: string, chatId: number): Promise<{ decision: FaqDecision; faq: FaqRow | null } | null> {
  if (!(await isEnabled(app)) || !text) return null;
  let candidates: FaqRow[];
  let decision: FaqDecision;
  try {
    // The current message is already stored; the last row is it → drop it from history
    const history = (await app.db.getRecentMessages(chatId, HISTORY_LOOKBACK + 1)).slice(0, -1);
    const historyText = formatHistory(history);

    // Very short messages («چقدر شد؟») are weak for semantic search → prepend the previous customer message
    let embedQuery = text;
    if (text.trim().length < SHORT_TEXT_CHARS) {
      const prev = lastCustomerMessage(history);
      if (prev) embedQuery = `${prev} ${text}`;
    }

    candidates = await findTopCandidates(app, embedQuery);
    if (!candidates.length) return null;
    decision = await classify(app, text, candidates, historyText);
  } catch (err: any) {
    console.error('Gemini classification failed; falling back to keyword matching:', err?.message ?? err);
    return null;
  }
  const faq = decision.faq_id !== null ? candidates.find((c) => c.id === decision.faq_id) ?? null : null;
  return { decision, faq };
}

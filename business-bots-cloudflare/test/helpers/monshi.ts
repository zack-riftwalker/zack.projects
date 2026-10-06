import type { TestEnv } from './env';
import { businessConnectionUpdate } from './updates';
import { OWNER } from './env';
import { q } from './seed';

export const CUST = { id: 7001, first_name: 'Cust', username: 'cust_user' };
export const CUST2 = { id: 7002, first_name: 'Cust2' };

export async function connect(t: TestEnv, bcid = 'bc1'): Promise<void> {
  await t.send('monshi', businessConnectionUpdate(OWNER, bcid));
  t.tg.reset();
}

/** open = always inside business hours, closed = always outside. */
export function setHours(t: TestEnv, mode: 'open' | 'closed'): void {
  const days = ['sat', 'sun', 'mon', 'tue', 'wed', 'thu', 'fri'];
  const map = Object.fromEntries(days.map((d) => [d, mode === 'open' ? '00:00-23:59' : null]));
  setSetting(t, 'business_hours', JSON.stringify(map));
}

export function setSetting(t: TestEnv, key: string, value: string): void {
  t.monshiDb.sqlite.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}

export function getSetting(t: TestEnv, key: string): string | null {
  return (t.monshiDb.sqlite.prepare('SELECT value FROM settings WHERE key = ?').get(key) as any)?.value ?? null;
}

export function addFaq(t: TestEnv, f: { question: string; answer: string; keywords?: string; enabled?: number }): number {
  const r = t.monshiDb.sqlite.prepare(
    "INSERT INTO faqs (question, answer, keywords, enabled, priority, hit_count, created_at, updated_at) VALUES (?, ?, ?, ?, 0, 0, '2026-01-01T00:00:00+00:00', '2026-01-01T00:00:00+00:00')",
  ).run(f.question, f.answer, f.keywords ?? '', f.enabled ?? 1);
  return Number(r.lastInsertRowid);
}

/** Messages sent on behalf of the owner to a customer chat (business_connection_id set). */
export function businessReplies(t: TestEnv, chatId: number): string[] {
  return t.tg.calls
    .filter((c) => c.method === 'sendMessage' && c.payload.chat_id === chatId && c.payload.business_connection_id)
    .map((c) => c.payload.text as string);
}

export const answeredBy = (t: TestEnv, chatId: number): string[] =>
  q(t.monshiDb, "SELECT answered_by FROM messages WHERE chat_id = ? AND direction = 'in' ORDER BY id", chatId).map((r) => r.answered_by);

export function fakeGemini(opts: {
  decisions?: Array<any | Error>; // consumed in order for generateContent
  failEmbeddings?: boolean;
  failModels?: string[];
} = {}) {
  const calls: { url: string; model?: string; body: any }[] = [];
  const decisions = [...(opts.decisions ?? [])];
  const fetchImpl = (async (input: any, init?: any) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(init.body) : undefined;
    const model = url.match(/models\/([^:]+):/)?.[1];
    calls.push({ url, model, body });
    const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
    if (url.includes(':batchEmbedContents')) {
      if (opts.failEmbeddings) return json({ error: 'boom' }, 500);
      return json({ embeddings: body.requests.map(() => ({ values: [1, 0, 0] })) });
    }
    if (url.includes(':embedContent')) {
      if (opts.failEmbeddings) return json({ error: 'boom' }, 500);
      return json({ embedding: { values: [1, 0, 0] } });
    }
    if (url.includes(':generateContent')) {
      if (opts.failModels?.includes(model!)) return json({ error: 'overloaded' }, 503);
      const d = decisions.shift();
      if (d instanceof Error) return json({ error: d.message }, 500);
      return json({ candidates: [{ content: { parts: [{ text: JSON.stringify(d ?? { action: 'IGNORE', confidence: 0.1 }) }] } }] });
    }
    return json({}, 404);
  }) as typeof fetch;
  return { fetch: fetchImpl, calls, generateCalls: () => calls.filter((c) => c.url.includes(':generateContent')), embedCalls: () => calls.filter((c) => c.url.includes('mbedContent')) };
}

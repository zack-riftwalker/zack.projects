import type { TestEnv } from './env';

export function seedProduct(t: TestEnv, p: Partial<{ name: string; price: number; terms: string | null; duration: number | null; warranty: number | null; active: number }> = {}): number {
  const r = t.storeDb.sqlite.prepare(
    'INSERT INTO customer_products (name, price, terms_text, duration_days, warranty_days, is_active) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(p.name ?? 'GPT Plus', p.price ?? 500000, p.terms ?? null, p.duration === undefined ? 30 : p.duration, p.warranty === undefined ? 7 : p.warranty, p.active ?? 1);
  return Number(r.lastInsertRowid);
}

export function seedCard(t: TestEnv) {
  t.storeDb.sqlite.prepare("INSERT INTO store_settings (id, card_number, card_holder_name) VALUES (1, '6037123412341234', 'Ali Test')").run();
}

export const q = (db: { sqlite: any }, sql: string, ...args: unknown[]) => db.sqlite.prepare(sql).all(...args) as any[];
export const one = (db: { sqlite: any }, sql: string, ...args: unknown[]) => db.sqlite.prepare(sql).get(...args) as any;

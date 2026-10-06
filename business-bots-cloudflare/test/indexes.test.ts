import { describe, expect, it } from 'vitest';
import { FakeD1 } from './helpers/fakeD1';
import { REMINDER_SQL, STALLED_QUERY } from '../src/store/db';

const BIG = ['orders', 'messages', 'customers', 'unanswered', 'customer_products', 'discount_code_redemptions', 'faqs', 'reply_log', 'sessions'];

function plan(f: FakeD1, sql: string, ...args: unknown[]): string[] {
  return (f.sqlite.prepare('EXPLAIN QUERY PLAN ' + sql).all(...(args as any[])) as any[]).map((r) => String(r.detail));
}

function assertNoScan(details: string[], label: string) {
  const bad = details.filter((d) => BIG.some((t) => new RegExp('^SCAN ' + t + '\\b').test(d)));
  expect(bad, label + ' → ' + details.join(' | ')).toEqual([]);
}

describe('store hot queries use indexes', () => {
  const f = new FakeD1().migrate('store');
  const cases: [string, string, unknown[]][] = [
    ['reminder 7d', REMINDER_SQL['7d'], []],
    ['reminder 3d', REMINDER_SQL['3d'], []],
    ['reminder expired', REMINDER_SQL['expired'], []],
    ['stalled', STALLED_QUERY, ['-20 hours']],
    ['my subscriptions', "SELECT * FROM orders WHERE customer_telegram_id = ? AND status = 'delivered' ORDER BY delivered_at DESC", [1]],
    ['redemption check', 'SELECT 1 FROM discount_code_redemptions WHERE discount_code_id = ? AND customer_telegram_id = ?', [1, 1]],
    ['redemption count', 'SELECT COUNT(*) AS n FROM discount_code_redemptions WHERE discount_code_id = ?', [1]],
    ['active products', 'SELECT id FROM customer_products WHERE is_active = 1 ORDER BY id ASC', []],
    ['customer batch', 'SELECT id, telegram_id FROM customers WHERE id > ? ORDER BY id LIMIT ?', [0, 40]],
    ['running broadcast', "SELECT * FROM broadcast_jobs WHERE status = 'running' ORDER BY id LIMIT 1", []],
    ['session read', 'SELECT value FROM sessions WHERE key = ?', ['k']],
    ['customer lookup', 'SELECT * FROM customers WHERE telegram_id = ?', [1]],
  ];
  for (const [label, sql, args] of cases) {
    it(label, () => assertNoScan(plan(f, sql, ...args), label));
  }
});

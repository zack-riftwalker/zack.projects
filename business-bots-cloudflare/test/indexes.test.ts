import { describe, expect, it } from 'vitest';
import { FakeD1 } from './helpers/fakeD1';
import { REMINDER_SQL, STALLED_QUERY } from '../src/store/db';
import { OPEN_ORDERS_SQL } from '../src/monshi/db';

// faqs is deliberately absent: the FAQ store is tiny (dozens of rows) and its sub-queries are indexed
const BIG = ['orders', 'messages', 'customers', 'unanswered', 'customer_products', 'discount_code_redemptions', 'reply_log', 'sessions', 'referrals', 'referral_rewards', 'product_waitlist', 'notify_links'];

function plan(f: FakeD1, sql: string, ...args: unknown[]): string[] {
  return (f.sqlite.prepare('EXPLAIN QUERY PLAN ' + sql).all(...(args as any[])) as any[]).map((r) => String(r.detail));
}

/** `allowIndexScan`: an ordered scan of an index is fine when a LIMIT stops it after a few rows. */
function assertNoScan(details: string[], label: string, allowIndexScan = false) {
  const bad = details.filter((d) =>
    BIG.some((t) => new RegExp('^SCAN ' + t + '\\b').test(d)) && !(allowIndexScan && /USING (COVERING )?INDEX/.test(d)));
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
    it(label, () => assertNoScan(plan(f, sql, ...args), label, label.includes('(LIMIT)')));
  }
});

describe('monshi hot queries use indexes', () => {
  const f = new FakeD1().migrate('monshi');
  const cases: [string, string, unknown[]][] = [
    ['recent messages', 'SELECT direction, text, message_type FROM messages WHERE chat_id = ? ORDER BY id DESC LIMIT ?', [1, 7]],
    ['messages today', "SELECT COUNT(*) AS n FROM messages WHERE direction = 'in' AND received_at >= ?", ['x']],
    ['stats by type since', "SELECT answered_by, COUNT(*) AS n FROM messages WHERE direction = 'in' AND received_at >= ? GROUP BY answered_by", ['x']],
    ['unused faqs', 'SELECT * FROM faqs WHERE enabled = 1 AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.faq_id = faqs.id AND m.received_at >= ?) ORDER BY id', ['x']],
    ['unanswered lookup', "SELECT id FROM unanswered WHERE normalized_text = ? AND status = 'open'", ['x']],
    ['top unanswered', "SELECT * FROM unanswered WHERE status = 'open' ORDER BY count DESC, last_seen_at DESC LIMIT ?", [5]],
    ['paused chats', 'SELECT * FROM customers WHERE automation_paused_until IS NOT NULL AND automation_paused_until > ? ORDER BY automation_paused_until DESC', ['x']],
    ['customer by username', 'SELECT * FROM customers WHERE username = ? COLLATE NOCASE', ['x']],
    ['recent customers (LIMIT)', 'SELECT * FROM customers ORDER BY last_message_at DESC LIMIT ?', [5]],
    ['order by external id', 'SELECT * FROM orders WHERE external_order_id = ?', [1]],
    ['open orders', OPEN_ORDERS_SQL, ['registered', 'paid', 'provisioning']],
    ['latest open order for chat', 'SELECT * FROM orders WHERE chat_id = ? AND status NOT IN (?, ?) ORDER BY created_at DESC LIMIT 1', [1, 'delivered', 'cancelled']],
    ['active connection', 'SELECT business_connection_id, owner_user_id FROM connection WHERE is_enabled = 1 ORDER BY updated_at DESC LIMIT 1', []],
    ['reply log', 'SELECT sent_at FROM reply_log WHERE chat_id = ? AND reply_key = ?', [1, 'k']],
    ['ack claim', 'UPDATE customers SET last_ack_sent_at = ? WHERE chat_id = ? AND (last_ack_sent_at IS NULL OR last_ack_sent_at < ?)', ['x', 1, 'y']],
  ];
  for (const [label, sql, args] of cases) {
    it(label, () => assertNoScan(plan(f, sql, ...args), label, label.includes('(LIMIT)')));
  }
});

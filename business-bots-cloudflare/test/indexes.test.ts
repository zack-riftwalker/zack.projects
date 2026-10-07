import { describe, expect, it } from 'vitest';
import { FakeD1 } from './helpers/fakeD1';
import { REMINDER_SQL, STALLED_QUERY } from '../src/store/db';
import { audienceFilter } from '../src/store/audience';
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
    ['report revenue', "SELECT purchase_source, COUNT(*) AS n, COALESCE(SUM(price), 0) AS s FROM orders WHERE status IN ('confirmed', 'delivered') AND decided_at >= ? AND decided_at < ? GROUP BY purchase_source", ['a', 'b']],
    ['report rejected', "SELECT COUNT(*) AS n FROM orders WHERE status = 'rejected' AND decided_at >= ? AND decided_at < ?", ['a', 'b']],
    ['report with code', "SELECT COUNT(*) AS n FROM orders WHERE status IN ('confirmed', 'delivered') AND discount_code_id IS NOT NULL AND decided_at >= ? AND decided_at < ?", ['a', 'b']],
    ['report top', "SELECT customer_product_id, MAX(product_name) AS name, COUNT(*) AS n, SUM(price) AS s FROM orders WHERE status IN ('confirmed', 'delivered') AND decided_at >= ? AND decided_at < ? GROUP BY customer_product_id ORDER BY n DESC, s DESC LIMIT 5", ['a', 'b']],
    ['report new customers', 'SELECT COUNT(*) AS n FROM customers WHERE created_at >= ? AND created_at < ?', ['a', 'b']],
    ['ref code lookup', 'SELECT telegram_id FROM customers WHERE ref_code = ?', ['x']],
    ['referral by invitee', 'SELECT id, referrer_telegram_id, qualified_at FROM referrals WHERE invitee_telegram_id = ?', [1]],
    ['unrewarded count', 'SELECT COUNT(*) AS n FROM referrals WHERE referrer_telegram_id = ? AND qualified_at IS NOT NULL AND reward_id IS NULL', [1]],
    ['unrewarded ids', 'SELECT id FROM referrals WHERE referrer_telegram_id = ? AND qualified_at IS NOT NULL AND reward_id IS NULL ORDER BY id LIMIT ?', [1, 3]],
    ['live reward', "SELECT 1 FROM referral_rewards WHERE referrer_telegram_id = ? AND status IN ('pending', 'issued') LIMIT 1", [1]],
    ['referral overview', 'SELECT COUNT(*) AS invited FROM referrals WHERE referrer_telegram_id = ?', [1]],
    ['referral sweep (LIMIT)', "SELECT referrer_telegram_id FROM referrals WHERE qualified_at IS NOT NULL AND reward_id IS NULL AND (? = 1 OR NOT EXISTS (SELECT 1 FROM referral_rewards w WHERE w.referrer_telegram_id = referrals.referrer_telegram_id AND w.status IN ('pending', 'issued'))) GROUP BY referrer_telegram_id HAVING COUNT(*) >= ? LIMIT ?", [1, 3, 5]],
    ['stale pending rewards', "SELECT id, referrer_telegram_id FROM referral_rewards WHERE status = 'pending' AND created_at < datetime('now', '+03:30', '-10 minutes') LIMIT ?", [3]],
    ['admin referral totals (LIMIT)', 'SELECT COUNT(*) AS invited FROM referrals', []],
    ['admin top referrers (LIMIT)', 'SELECT referrer_telegram_id, COUNT(*) AS n FROM referrals WHERE qualified_at IS NOT NULL GROUP BY referrer_telegram_id ORDER BY n DESC LIMIT 5', []],
    ['customer summary totals', "SELECT SUM(CASE WHEN status IN ('confirmed', 'delivered') THEN 1 ELSE 0 END) AS purchases, MAX(created_at) AS last FROM orders WHERE customer_telegram_id = ?", [1]],
    ['customer summary active', "SELECT product_name, expires_at FROM orders WHERE customer_telegram_id = ? AND status = 'delivered' AND (expires_at IS NULL OR expires_at > datetime('now', '+03:30')) ORDER BY delivered_at DESC LIMIT 3", [1]],
    ['report current', "SELECT (SELECT COUNT(*) FROM orders WHERE status = 'pending') AS pending, (SELECT COUNT(*) FROM orders WHERE status = 'confirmed') AS waiting, (SELECT COUNT(*) FROM referrals WHERE qualified_at >= ? AND qualified_at < ?) AS ref_ok", ['a', 'b']],
    ['my orders in progress', "SELECT * FROM orders WHERE customer_telegram_id = ? AND status IN ('pending', 'confirmed') ORDER BY id DESC LIMIT 10", [1]],
    ['my recent rejections', "SELECT * FROM orders WHERE customer_telegram_id = ? AND status = 'rejected' AND decided_at >= datetime('now', '+03:30', '-7 days') ORDER BY id DESC LIMIT 5", [1]],
    ['receipt duplicate lookup', 'SELECT id, status, customer_telegram_id FROM orders WHERE receipt_unique_id = ? ORDER BY id DESC LIMIT 1', ['x']],
    ['waitlist count', 'SELECT COUNT(*) AS n FROM product_waitlist WHERE product_id = ?', [1]],
    ['waitlist clear', 'DELETE FROM product_waitlist WHERE product_id = ? AND created_at <= ?', [1, 'x']],
  ];
  for (const [label, sql, args] of cases) {
    it(label, () => assertNoScan(plan(f, sql, ...args), label, label.includes('(LIMIT)')));
  }
  for (const audience of ['all', 'active', 'expired', 'never', 'buyers:1', 'waitlist:1']) {
    it('broadcast batch: ' + audience, () => {
      const fl = audienceFilter(audience);
      assertNoScan(plan(f, 'SELECT c.id, c.telegram_id FROM customers c WHERE c.id > ? AND (' + fl.where + ') ORDER BY c.id LIMIT ?', 0, ...fl.args, 40), 'broadcast ' + audience);
    });
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
    ['notify link lookup', 'SELECT customer_chat_id FROM notify_links WHERE recipient_chat_id = ? AND message_id = ?', [1, 1]],
    ['notify links cleanup', 'DELETE FROM notify_links WHERE created_at < ?', ['x']],
    ['ack claim', 'UPDATE customers SET last_ack_sent_at = ? WHERE chat_id = ? AND (last_ack_sent_at IS NULL OR last_ack_sent_at < ?)', ['x', 1, 'y']],
  ];
  for (const [label, sql, args] of cases) {
    it(label, () => assertNoScan(plan(f, sql, ...args), label, label.includes('(LIMIT)')));
  }
});

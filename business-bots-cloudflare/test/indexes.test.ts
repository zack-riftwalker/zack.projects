import { describe, expect, it } from 'vitest';
import { FakeD1 } from './helpers/fakeD1';
import { REMINDER_SQL, STALLED_QUERY } from '../src/store/db';
import { audienceFilter } from '../src/store/audience';
import { OPEN_ORDERS_SQL } from '../src/monshi/db';
import { CATALOG_PENDING_SQL, SUPPLIERS_DUE_SQL } from '../src/store/suppliers/sync';
import { APPLY_DEFAULTS_SQL, NEEDS_ACTION_COUNT_SQL, NEEDS_ACTION_LIST_SQL } from '../src/store/handlers/supplierPanel';
import { CANCEL_SQL } from '../src/store/suppliers/fulfillmentActions';
import { BALANCE_SQL, HISTORY_SQL } from '../src/store/suppliers/wallet';
import { BATCH_ACCOUNTS_SQL, BATCH_LIST_SQL } from '../src/store/suppliers/stockCards';
import { PROFIT_SQL } from '../src/store/handlers/salesReport';
import { CUSTOMER_BY_ID_SQL, CUSTOMER_BY_NAME_SQL, MATCHING_PRODUCTS_SQL, RELEASE_LINK_SQL } from '../src/store/handlers/stockAdmin';
import {
  DEADLINE_SQL, LIVE_SUPPLIER_ORDER_SQL, PENDING_MANUAL_SQL, PLACED_DUE_SQL, QUEUED_DUE_SQL, SOURCE_SELECT, STALE_LEASE_SQL, STRANDED_SQL, UNDELIVERED_SQL,
} from '../src/store/suppliers/engine';

// faqs is deliberately absent: the FAQ store is tiny (dozens of rows) and its sub-queries are indexed
const BIG = ['orders', 'messages', 'customers', 'unanswered', 'customer_products', 'discount_code_redemptions', 'reply_log', 'sessions', 'referrals', 'referral_rewards', 'product_waitlist', 'notify_links',
  'product_sources', 'supplier_orders', 'fulfillment_events', 'order_deliveries', 'stock_accounts', 'stock_batches', 'wallet_ledger', 'manual_purchase_claims'];

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

describe('supplier hot queries use indexes', () => {
  const f = new FakeD1().migrate('store');
  const cases: [string, string, unknown[]][] = [
    ['sources of an option', `SELECT s.id FROM product_sources s JOIN suppliers sup ON sup.id = s.supplier_id
      WHERE s.customer_product_id = ? ORDER BY s.priority, s.id`, [1]],
    ['sources of a supplier (apply)', 'SELECT s.id FROM product_sources s WHERE s.supplier_id = ? ORDER BY s.id', [1]],
    ['options of a group', 'SELECT id FROM customer_products WHERE group_id = ? AND is_active = 1', [1]],
    ['catalog products', 'SELECT id FROM customer_products WHERE is_active = 1 ORDER BY id', []],
    // the real queries of the code, not copies of them
    ['supplier fetch due', SUPPLIERS_DUE_SQL, [1, 'x']],
    ['catalog to apply', CATALOG_PENDING_SQL, []],
    ['apply default markup to auto options', APPLY_DEFAULTS_SQL, []],
    ['linked options of a supplier', 'SELECT COUNT(DISTINCT customer_product_id) AS n FROM product_sources WHERE supplier_id = ?', [1]],
    // the order engine (S5)
    ['stale placing leases', STALE_LEASE_SQL, ['x', 3]],
    ['queued and due (LIMIT)', QUEUED_DUE_SQL, ['x', 3]],
    ['placed and due (LIMIT)', PLACED_DUE_SQL, ['x', 5]],
    ['completed, not delivered', UNDELIVERED_SQL, ['x', 2]],
    ['20 h deadline', DEADLINE_SQL, ['x', 3]],
    ['stranded supplier orders', STRANDED_SQL, ['x', 2]],
    ['sources to place an order', SOURCE_SELECT + ' WHERE s.customer_product_id = ? ORDER BY s.priority, s.id', [1]],
    ['forced source', SOURCE_SELECT + ' WHERE s.id = ?', [1]],
    ['sources and enabled count', 'SELECT COUNT(*) AS total FROM product_sources s JOIN suppliers sup ON sup.id = s.supplier_id WHERE s.customer_product_id = ?', [1]],
    ['latest supplier order of an order', 'SELECT so.id FROM supplier_orders so LEFT JOIN suppliers sup ON sup.id = so.supplier_id WHERE so.order_id = ? ORDER BY so.id DESC LIMIT 1', [1]],
    ['unknown supplier order of an order', "SELECT * FROM supplier_orders WHERE order_id = ? AND status = 'unknown' ORDER BY id DESC LIMIT 1", [1]],
    ['live supplier order of an order', "SELECT 1 FROM supplier_orders WHERE order_id = ? AND status IN ('queued', 'placing', 'placed', 'completed')", [1]],
    // review fixes
    ['live supplier orders of an order (queue check)', `SELECT 1 FROM supplier_orders WHERE order_id = ? AND ${LIVE_SUPPLIER_ORDER_SQL} AND NOT (id = ? AND status = 'unknown')`, [1, -1]],
    ['sent delivery of a supplier order', 'SELECT 1 FROM order_deliveries d WHERE d.supplier_order_id = ? AND d.sent_ok = 1', [1]],
    ['divert claim: a batch of the supplier order', 'SELECT 1 FROM stock_batches WHERE supplier_order_id = ?', [1]],
    ['mark the unsent delivery as diverted', 'UPDATE order_deliveries SET diverted = 1 WHERE supplier_order_id = ? AND sent_ok = 0 AND EXISTS (SELECT 1 FROM stock_batches WHERE supplier_order_id = ?)', [1, 1]],
    ['undo: a delivery that was not diverted', 'SELECT 1 FROM order_deliveries WHERE order_id = ? AND diverted = 0', [1]],
    ['card: deliveries not diverted', 'SELECT COUNT(*) FROM order_deliveries WHERE order_id = ? AND diverted = 0', [1]],
    ['admin deliveries the budget could not send (LIMIT)', PENDING_MANUAL_SQL, ['x', 2]],
    ['direct-buy nonce', 'SELECT id FROM supplier_orders WHERE buy_nonce = ?', ['n']],
    ['stk_rel_: withdraw the manual link of an account', RELEASE_LINK_SQL, [1]],
    ['latest delivery of an order', 'SELECT * FROM order_deliveries WHERE order_id = ? ORDER BY id DESC LIMIT 1', [1]],
    ['latest sent delivery of an order', 'SELECT * FROM order_deliveries WHERE order_id = ? AND sent_ok = 1 ORDER BY id DESC LIMIT 1', [1]],
    ['pending delivery of a supplier order', 'SELECT id FROM order_deliveries WHERE order_id = ? AND supplier_order_id = ? AND sent_ok = 0 ORDER BY id DESC LIMIT 1', [1, 1]],
    // decision card, /order, cancel, stock (S6)
    ['needs-action count', NEEDS_ACTION_COUNT_SQL, []],
    ['needs-action list (LIMIT)', NEEDS_ACTION_LIST_SQL, []],
    ['cancel: give the code back', CANCEL_SQL.redemption, [1, 1, 1]],
    ['cancel: un-qualify the referral', CANCEL_SQL.referral, [1, 1]],
    ['cancel: release a reserved account', CANCEL_SQL.stock, ['x', 1]],
    ['card: customer name', 'SELECT display_name FROM customers WHERE telegram_id = (SELECT customer_telegram_id FROM orders WHERE id = ?)', [1]],
    ['card: product cost', 'SELECT cost_toman FROM customer_products WHERE id = (SELECT customer_product_id FROM orders WHERE id = ?)', [1]],
    ['card: sources of the option', `SELECT sup.name FROM product_sources s JOIN suppliers sup ON sup.id = s.supplier_id
      WHERE s.customer_product_id = (SELECT customer_product_id FROM orders WHERE id = ?) ORDER BY s.priority, s.id`, [1]],
    ['available stock (LIMIT)', `SELECT a.id FROM stock_accounts a JOIN stock_batches b ON b.id = a.batch_id
      LEFT JOIN supplier_orders so ON so.id = b.supplier_order_id WHERE a.status = 'available' ORDER BY a.id LIMIT 48`, []],
    ['stock account with its batch', 'SELECT a.id FROM stock_accounts a JOIN stock_batches b ON b.id = a.batch_id WHERE a.id = ?', [1]],
    ['events of an order', 'SELECT * FROM fulfillment_events WHERE order_id = ? ORDER BY id DESC LIMIT 15', [1]],
    ['my subscriptions with stored accounts', `SELECT o.id FROM orders o WHERE o.customer_telegram_id = ? AND o.status = 'delivered'
      AND EXISTS (SELECT 1 FROM order_deliveries d WHERE d.order_id = o.id AND d.sent_ok = 1)`, [1]],
    // direct buy, stock accounts, wallet, manual links (S7)
    ['wallet balance', BALANCE_SQL, [1]],
    ['wallet history (LIMIT)', HISTORY_SQL, [1, 10]],
    ['stock batch list (LIMIT)', BATCH_LIST_SQL, []],
    ['accounts of a batch', BATCH_ACCOUNTS_SQL, [1]],
    ['products that share an account\'s supplier item', MATCHING_PRODUCTS_SQL, [1]],
    ['customer by id', CUSTOMER_BY_ID_SQL, [1]],
    ['customer by username', CUSTOMER_BY_NAME_SQL, ['x']],
    // sales report profit lines (S8)
    ['report: cost and profit', PROFIT_SQL.costed, ['a', 'b']],
    ['report: orders without a cost', PROFIT_SQL.missing, ['a', 'b']],
    ['report: cancelled in the range', PROFIT_SQL.cancelled, ['a', 'b']],
    ['report: refunds pending', PROFIT_SQL.refundPending, []],
    ['report: sold outside', PROFIT_SQL.outside, ['a', 'b']],
    ['report: reported batch profit', PROFIT_SQL.reported, ['a', 'b']],
    ['report: stock bought', PROFIT_SQL.bought, ['a', 'b']],
    ['report: free accounts', PROFIT_SQL.available, []],
    ['report: wallet spend', PROFIT_SQL.spend, ['a', 'b']],
    ['redeem: link the reserved account', `UPDATE stock_accounts SET order_id = (SELECT order_id FROM manual_purchase_claims WHERE token_hash = ?), updated_at = 'x'
      WHERE id = (SELECT stock_account_id FROM manual_purchase_claims WHERE token_hash = ? AND claimed_by = ?) AND status = 'reserved' AND order_id IS NULL AND changes() = 1`, ['h', 'h', 1]],
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
    ['owner reply after question', "SELECT (SELECT received_at FROM messages WHERE id = ?) AS q_at, text, received_at FROM messages WHERE chat_id = ? AND id > ? AND direction = 'owner' AND text IS NOT NULL ORDER BY id LIMIT 1", [1, 1, 1]],
    ['notify link lookup', 'SELECT customer_chat_id FROM notify_links WHERE recipient_chat_id = ? AND message_id = ?', [1, 1]],
    ['notify links cleanup', 'DELETE FROM notify_links WHERE created_at < ?', ['x']],
    ['ack claim', 'UPDATE customers SET last_ack_sent_at = ? WHERE chat_id = ? AND (last_ack_sent_at IS NULL OR last_ack_sent_at < ?)', ['x', 1, 'y']],
  ];
  for (const [label, sql, args] of cases) {
    it(label, () => assertNoScan(plan(f, sql, ...args), label, label.includes('(LIMIT)')));
  }
});

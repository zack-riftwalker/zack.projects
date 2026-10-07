import type { Db, Stmt } from '../lib/budget';
import { TEHRAN_OFFSET_MS, tehranParts, utcIsoNow } from '../lib/time';

export const ORDER_STATUS_FLOW = ['registered', 'paid', 'provisioning', 'delivered'];
export const ORDER_STATUS_CANCELLED = 'cancelled';

export interface CustomerRow {
  chat_id: number; telegram_user_id: number | null; username: string | null; first_name: string | null;
  first_seen_at: string | null; last_message_at: string | null; is_blocked: number;
  automation_paused_until: string | null; last_ack_sent_at: string | null;
}
export interface FaqRow {
  id: number; question: string; answer: string; keywords: string | null; enabled: number; priority: number;
  embedding: string | null; hit_count: number; created_at: string; updated_at: string;
}
export interface OrderRow {
  id: number; chat_id: number; title: string; status: string; checklist_message_id: number | null;
  business_connection_id: string | null; note: string | null; external_order_id: number | null;
  created_at: string; updated_at: string;
}
export interface MessageRow { direction: string; text: string | null; message_type: string | null }
export interface UnansweredRow { id: number; chat_id: number; text: string; normalized_text: string; count: number; last_seen_at: string; status: string; last_message_row_id?: number | null }

const OPEN_STATUSES = ORDER_STATUS_FLOW.slice(0, -1);
export const ORDER_STATUS_DELIVERED = ORDER_STATUS_FLOW[ORDER_STATUS_FLOW.length - 1];

/** Next step of an open order; null when delivered, cancelled or unknown. */
export function nextOrderStatus(status: string): string | null {
  const idx = OPEN_STATUSES.indexOf(status);
  return idx === -1 ? null : ORDER_STATUS_FLOW[idx + 1];
}
export const OPEN_ORDERS_SQL = 'SELECT * FROM orders WHERE status IN (' + OPEN_STATUSES.map(() => '?').join(', ') + ') ORDER BY created_at DESC';

const FAQ_EDITABLE_FIELDS = new Set(['question', 'answer', 'keywords']);
const FAQ_EMBEDDING_AFFECTING_FIELDS = new Set(['question', 'keywords']);

export class MonshiDb {
  constructor(readonly db: Db) {}

  private q(sql: string, ...args: unknown[]): Stmt {
    return this.db.prepare(sql).bind(...args);
  }

  // ── settings / app_state ────────────────────────────────────────────────
  async loadSettingsAndState(): Promise<{ settings: Map<string, string>; state: Map<string, string> }> {
    const [s, a] = await this.db.batch([
      this.q('SELECT key, value FROM settings'),
      this.q('SELECT key, value FROM app_state'),
    ]);
    return {
      settings: new Map(s.results.map((r: any) => [r.key, r.value])),
      state: new Map(a.results.map((r: any) => [r.key, r.value])),
    };
  }

  async setSetting(key: string, value: string): Promise<void> {
    await this.q('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value).run();
  }

  async getSetting(key: string): Promise<string | null> {
    const row = await this.q('SELECT value FROM settings WHERE key = ?', key).first<{ value: string }>();
    return row ? row.value : null;
  }

  async setAppState(key: string, value: string): Promise<void> {
    await this.q(
      'INSERT INTO app_state (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
      key, value, new Date().toISOString(),
    ).run();
  }

  async deleteAppState(key: string): Promise<void> {
    await this.q('DELETE FROM app_state WHERE key = ?', key).run();
  }

  async clearFaqEmbeddings(): Promise<void> {
    await this.q('UPDATE faqs SET embedding = NULL').run();
  }

  // ── connection ──────────────────────────────────────────────────────────
  async saveConnection(connectionId: string, ownerUserId: number, isEnabled: boolean): Promise<void> {
    await this.q(
      'INSERT INTO connection (business_connection_id, owner_user_id, is_enabled, updated_at) VALUES (?, ?, ?, ?) ' +
        'ON CONFLICT(business_connection_id) DO UPDATE SET owner_user_id = excluded.owner_user_id, ' +
        'is_enabled = excluded.is_enabled, updated_at = excluded.updated_at',
      connectionId, ownerUserId, isEnabled ? 1 : 0, utcIsoNow(),
    ).run();
  }

  /** The owner's enabled connection. Rows of other accounts (never saved now, but maybe from older code) are ignored. */
  async getActiveConnection(ownerUserId: number): Promise<{ business_connection_id: string; owner_user_id: number } | null> {
    return this.q(
      'SELECT business_connection_id, owner_user_id FROM connection WHERE is_enabled = 1 AND owner_user_id = ? ORDER BY updated_at DESC LIMIT 1',
      ownerUserId,
    ).first();
  }

  // ── customers ───────────────────────────────────────────────────────────
  async upsertCustomer(chatId: number, userId: number | null, username: string | null, firstName: string | null): Promise<{ isNew: boolean; customer: CustomerRow }> {
    const now = utcIsoNow();
    const [ins, , sel] = await this.db.batch([
      this.q('INSERT INTO customers (chat_id, telegram_user_id, username, first_name, first_seen_at, last_message_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(chat_id) DO NOTHING',
        chatId, userId, username, firstName, now, now),
      this.q('UPDATE customers SET telegram_user_id = ?, username = ?, first_name = ?, last_message_at = ? WHERE chat_id = ?',
        userId, username, firstName, now, chatId),
      this.q('SELECT * FROM customers WHERE chat_id = ?', chatId),
    ]);
    return { isNew: ins.meta.changes === 1, customer: sel.results[0] as CustomerRow };
  }

  async getCustomer(chatId: number): Promise<CustomerRow | null> {
    return this.q('SELECT * FROM customers WHERE chat_id = ?', chatId).first();
  }

  async getRecentCustomers(limit = 5): Promise<CustomerRow[]> {
    return (await this.q('SELECT * FROM customers ORDER BY last_message_at DESC LIMIT ?', limit).all<CustomerRow>()).results;
  }

  async getCustomerByUsername(username: string): Promise<CustomerRow | null> {
    return this.q('SELECT * FROM customers WHERE username = ? COLLATE NOCASE', username.replace(/^@+/, '')).first();
  }

  async getPausedChats(): Promise<CustomerRow[]> {
    return (await this.q(
      'SELECT * FROM customers WHERE automation_paused_until IS NOT NULL AND automation_paused_until > ? ORDER BY automation_paused_until DESC',
      utcIsoNow(),
    ).all<CustomerRow>()).results;
  }

  async setChatPause(chatId: number, untilIso: string | null): Promise<void> {
    await this.q('UPDATE customers SET automation_paused_until = ? WHERE chat_id = ?', untilIso, chatId).run();
  }

  async setLastAck(chatId: number): Promise<void> {
    await this.q('UPDATE customers SET last_ack_sent_at = ? WHERE chat_id = ?', utcIsoNow(), chatId).run();
  }

  /** Atomic ack claim: true only if no ack was sent after `cutoffIso`. */
  async claimAck(chatId: number, cutoffIso: string): Promise<boolean> {
    const r = await this.q(
      'UPDATE customers SET last_ack_sent_at = ? WHERE chat_id = ? AND (last_ack_sent_at IS NULL OR last_ack_sent_at < ?)',
      utcIsoNow(), chatId, cutoffIso,
    ).run();
    return r.meta.changes === 1;
  }

  async restoreAck(chatId: number, previous: string | null): Promise<void> {
    await this.q('UPDATE customers SET last_ack_sent_at = ? WHERE chat_id = ?', previous, chatId).run();
  }

  // ── notify_links (reply-from-notification) ──────────────────────────────
  async saveNotifyLinks(rows: { recipientChatId: number; messageId: number; customerChatId: number }[]): Promise<void> {
    if (!rows.length) return;
    const now = utcIsoNow();
    await this.db.batch(rows.map((r) => this.q(
      'INSERT INTO notify_links (recipient_chat_id, message_id, customer_chat_id, created_at) VALUES (?, ?, ?, ?) ' +
        'ON CONFLICT(recipient_chat_id, message_id) DO UPDATE SET customer_chat_id = excluded.customer_chat_id, created_at = excluded.created_at',
      r.recipientChatId, r.messageId, r.customerChatId, now,
    )));
  }

  async getNotifyLink(recipientChatId: number, messageId: number): Promise<number | null> {
    return (await this.q('SELECT customer_chat_id FROM notify_links WHERE recipient_chat_id = ? AND message_id = ?', recipientChatId, messageId).first<{ customer_chat_id: number }>())?.customer_chat_id ?? null;
  }

  async deleteNotifyLinksBefore(cutoffIso: string): Promise<void> {
    await this.q('DELETE FROM notify_links WHERE created_at < ?', cutoffIso).run();
  }

  // ── reply_log ───────────────────────────────────────────────────────────
  async logAutoReply(chatId: number, replyKey: string): Promise<void> {
    await this.q(
      'INSERT INTO reply_log (chat_id, reply_key, sent_at) VALUES (?, ?, ?) ON CONFLICT(chat_id, reply_key) DO UPDATE SET sent_at = excluded.sent_at',
      chatId, replyKey, utcIsoNow(),
    ).run();
  }

  async getAutoReplySentAt(chatId: number, replyKey: string): Promise<string | null> {
    const row = await this.q('SELECT sent_at FROM reply_log WHERE chat_id = ? AND reply_key = ?', chatId, replyKey).first<{ sent_at: string }>();
    return row ? row.sent_at : null;
  }

  // ── messages ────────────────────────────────────────────────────────────
  async saveMessage(chatId: number, telegramMessageId: number, direction: string, messageType: string, text: string | null | undefined, bcid: string | null): Promise<boolean> {
    const r = await this.q(
      'INSERT INTO messages (chat_id, telegram_message_id, direction, message_type, text, received_at, business_connection_id) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(business_connection_id, chat_id, telegram_message_id) DO NOTHING',
      chatId, telegramMessageId, direction, messageType, text ?? null, utcIsoNow(), bcid,
    ).run();
    return r.meta.changes === 1;
  }

  async markMessageAnswered(chatId: number, telegramMessageId: number, answeredBy: string, faqId: number | null = null): Promise<void> {
    await this.q('UPDATE messages SET answered_by = ?, faq_id = ? WHERE chat_id = ? AND telegram_message_id = ?', answeredBy, faqId, chatId, telegramMessageId).run();
  }

  async getRecentMessages(chatId: number, limit = 6): Promise<MessageRow[]> {
    const rows = (await this.q('SELECT direction, text, message_type FROM messages WHERE chat_id = ? ORDER BY id DESC LIMIT ?', chatId, limit).all<MessageRow>()).results;
    return rows.reverse();
  }

  async markChatAnsweredByHuman(chatId: number): Promise<void> {
    await this.q("UPDATE messages SET answered_by = 'human' WHERE chat_id = ? AND direction = 'in' AND answered_by IN ('none', 'ack')", chatId).run();
  }

  // ── faqs ────────────────────────────────────────────────────────────────
  async addFaq(question: string, answer: string, keywords: string | null): Promise<number> {
    const now = utcIsoNow();
    const r = await this.q(
      'INSERT INTO faqs (question, answer, keywords, enabled, priority, hit_count, created_at, updated_at) VALUES (?, ?, ?, 1, 0, 0, ?, ?)',
      question, answer, keywords || '', now, now,
    ).run();
    return r.meta.last_row_id;
  }

  async getEnabledFaqs(): Promise<FaqRow[]> {
    return (await this.q('SELECT * FROM faqs WHERE enabled = 1').all<FaqRow>()).results;
  }

  async getAllFaqs(): Promise<FaqRow[]> {
    return (await this.q('SELECT * FROM faqs ORDER BY id').all<FaqRow>()).results;
  }

  async getFaq(id: number): Promise<FaqRow | null> {
    return this.q('SELECT * FROM faqs WHERE id = ?', id).first();
  }

  async updateFaqField(faqId: number, field: string, value: string): Promise<void> {
    if (!FAQ_EDITABLE_FIELDS.has(field)) throw new Error('invalid field: ' + field);
    const stmts: Stmt[] = [];
    if (FAQ_EMBEDDING_AFFECTING_FIELDS.has(field)) {
      stmts.push(this.q(`UPDATE faqs SET ${field} = ?, embedding = NULL, updated_at = ? WHERE id = ?`, value, utcIsoNow(), faqId));
    } else {
      stmts.push(this.q(`UPDATE faqs SET ${field} = ?, updated_at = ? WHERE id = ?`, value, utcIsoNow(), faqId));
    }
    if (field === 'answer') stmts.push(this.q('DELETE FROM reply_log WHERE reply_key = ?', 'faq:' + faqId));
    await this.db.batch(stmts);
  }

  /**
   * All rows in ONE statement (a JSON array parameter): one statement per FAQ would spend one unit of the
   * 50-call budget each, and with ~40+ FAQs the batch never fit, so embeddings were never saved.
   */
  async setFaqEmbeddings(rows: { id: number; embedding: string }[]): Promise<void> {
    if (!rows.length) return;
    const json = JSON.stringify(rows.map((r) => ({ id: r.id, e: r.embedding })));
    await this.q(
      "UPDATE faqs SET embedding = (SELECT json_extract(j.value, '$.e') FROM json_each(?) AS j WHERE json_extract(j.value, '$.id') = faqs.id) " +
        "WHERE id IN (SELECT json_extract(value, '$.id') FROM json_each(?))",
      json, json,
    ).run();
  }

  async setFaqEnabled(faqId: number, enabled: boolean): Promise<void> {
    await this.q('UPDATE faqs SET enabled = ?, updated_at = ? WHERE id = ?', enabled ? 1 : 0, utcIsoNow(), faqId).run();
  }

  async incrementFaqHit(faqId: number): Promise<void> {
    await this.q('UPDATE faqs SET hit_count = hit_count + 1 WHERE id = ?', faqId).run();
  }

  // ── unanswered ──────────────────────────────────────────────────────────
  async recordUnanswered(chatId: number, text: string, normalizedText: string): Promise<void> {
    const now = utcIsoNow();
    const existing = await this.q("SELECT id FROM unanswered WHERE normalized_text = ? AND status = 'open'", normalizedText).first<{ id: number }>();
    if (existing) {
      await this.q('UPDATE unanswered SET count = count + 1, last_seen_at = ?, chat_id = ? WHERE id = ?', now, chatId, existing.id).run();
    } else {
      await this.q("INSERT INTO unanswered (chat_id, text, normalized_text, count, last_seen_at, status) VALUES (?, ?, ?, 1, ?, 'open')", chatId, text, normalizedText, now).run();
    }
  }

  async getTopUnanswered(limit = 10): Promise<UnansweredRow[]> {
    return (await this.q("SELECT * FROM unanswered WHERE status = 'open' ORDER BY count DESC, last_seen_at DESC LIMIT ?", limit).all<UnansweredRow>()).results;
  }

  async getUnansweredById(id: number): Promise<UnansweredRow | null> {
    return this.q('SELECT * FROM unanswered WHERE id = ?', id).first();
  }

  async resolveUnanswered(id: number, status = 'faq_created'): Promise<void> {
    await this.q('UPDATE unanswered SET status = ? WHERE id = ?', status, id).run();
  }

  // ── orders ──────────────────────────────────────────────────────────────
  async addOrder(chatId: number, title: string, bcid: string | null, externalOrderId: number | null = null): Promise<number> {
    const now = utcIsoNow();
    const r = await this.q(
      'INSERT INTO orders (chat_id, title, status, business_connection_id, external_order_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      chatId, title, ORDER_STATUS_FLOW[0], bcid, externalOrderId, now, now,
    ).run();
    return r.meta.last_row_id;
  }

  async getOrder(orderId: number): Promise<OrderRow | null> {
    return this.q('SELECT * FROM orders WHERE id = ?', orderId).first();
  }

  async getOrderByExternalId(externalOrderId: number): Promise<OrderRow | null> {
    return this.q('SELECT * FROM orders WHERE external_order_id = ?', externalOrderId).first();
  }

  async setOrderStatus(orderId: number, status: string): Promise<void> {
    if (!ORDER_STATUS_FLOW.includes(status) && status !== ORDER_STATUS_CANCELLED) throw new Error('invalid order status: ' + status);
    await this.q('UPDATE orders SET status = ?, updated_at = ? WHERE id = ?', status, utcIsoNow(), orderId).run();
  }

  async getOpenOrders(): Promise<OrderRow[]> {
    // IN (open statuses) instead of NOT IN (closed): lets SQLite use idx_orders_status_created
    return (await this.q(OPEN_ORDERS_SQL, ...OPEN_STATUSES).all<OrderRow>()).results;
  }

  async getLatestOpenOrderForChat(chatId: number): Promise<OrderRow | null> {
    return this.q('SELECT * FROM orders WHERE chat_id = ? AND status NOT IN (?, ?) ORDER BY created_at DESC LIMIT 1', chatId, ORDER_STATUS_FLOW[ORDER_STATUS_FLOW.length - 1], ORDER_STATUS_CANCELLED).first();
  }

  /**
   * Compare-and-set status change: true only for the one caller that actually moved the order from `from`.
   * A double tap or an out-of-date button gets false and must not repeat the side effects (customer messages).
   */
  async transitionOrder(orderId: number, from: string, to: string): Promise<boolean> {
    if (!ORDER_STATUS_FLOW.includes(to) && to !== ORDER_STATUS_CANCELLED) throw new Error('invalid order status: ' + to);
    const r = await this.q('UPDATE orders SET status = ?, updated_at = ? WHERE id = ? AND status = ?', to, utcIsoNow(), orderId, from).run();
    return r.meta.changes === 1;
  }

  /** Cancels an open order; a delivered or already cancelled one is left alone (false). */
  async cancelOrder(orderId: number): Promise<boolean> {
    const r = await this.q(
      'UPDATE orders SET status = ?, updated_at = ? WHERE id = ? AND status IN (' + OPEN_STATUSES.map(() => '?').join(', ') + ')',
      ORDER_STATUS_CANCELLED, utcIsoNow(), orderId, ...OPEN_STATUSES,
    ).run();
    return r.meta.changes === 1;
  }

  async setOrderChecklistMsg(orderId: number, messageId: number): Promise<void> {
    await this.q('UPDATE orders SET checklist_message_id = ? WHERE id = ?', messageId, orderId).run();
  }

  // ── stats ───────────────────────────────────────────────────────────────
  private todayStartUtcIso(now = new Date()): string {
    const p = tehranParts(now);
    return utcIsoNow(new Date(Date.UTC(p.y, p.m - 1, p.d) - TEHRAN_OFFSET_MS));
  }

  async getLightStats(now = new Date()): Promise<{ today_in: number; customers: number }> {
    const [a, b] = await this.db.batch([
      this.q("SELECT COUNT(*) AS n FROM messages WHERE direction = 'in' AND received_at >= ?", this.todayStartUtcIso(now)),
      this.q('SELECT COUNT(*) AS n FROM customers'),
    ]);
    return { today_in: a.results[0].n, customers: b.results[0].n };
  }

  async getFullStats(now = new Date()): Promise<{ total_in: number; today_in: number; by_type: Record<string, number>; customers: number }> {
    const [t, td, by, c] = await this.db.batch([
      this.q("SELECT COUNT(*) AS n FROM messages WHERE direction = 'in'"),
      this.q("SELECT COUNT(*) AS n FROM messages WHERE direction = 'in' AND received_at >= ?", this.todayStartUtcIso(now)),
      this.q("SELECT answered_by, COUNT(*) AS n FROM messages WHERE direction = 'in' GROUP BY answered_by"),
      this.q('SELECT COUNT(*) AS n FROM customers'),
    ]);
    return {
      total_in: t.results[0].n, today_in: td.results[0].n,
      by_type: Object.fromEntries(by.results.map((r: any) => [r.answered_by, r.n])),
      customers: c.results[0].n,
    };
  }

  async getStatsSince(sinceUtcIso: string): Promise<{ total_in: number; by_type: Record<string, number>; unique_customers: number }> {
    const [t, by, u] = await this.db.batch([
      this.q("SELECT COUNT(*) AS n FROM messages WHERE direction = 'in' AND received_at >= ?", sinceUtcIso),
      this.q("SELECT answered_by, COUNT(*) AS n FROM messages WHERE direction = 'in' AND received_at >= ? GROUP BY answered_by", sinceUtcIso),
      this.q("SELECT COUNT(DISTINCT chat_id) AS n FROM messages WHERE direction = 'in' AND received_at >= ?", sinceUtcIso),
    ]);
    return {
      total_in: t.results[0].n,
      by_type: Object.fromEntries(by.results.map((r: any) => [r.answered_by, r.n])),
      unique_customers: u.results[0].n,
    };
  }

  async getUnusedFaqsSince(sinceUtcIso: string): Promise<FaqRow[]> {
    return (await this.q(
      'SELECT * FROM faqs WHERE enabled = 1 AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.faq_id = faqs.id AND m.received_at >= ?) ORDER BY id',
      sinceUtcIso,
    ).all<FaqRow>()).results;
  }
}

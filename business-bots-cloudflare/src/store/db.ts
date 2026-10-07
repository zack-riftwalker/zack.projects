import type { Db, Stmt } from '../lib/budget';
import { audienceFilter } from './audience';

export interface CustomerProduct {
  id: number; name: string; price: number; terms_text: string | null;
  terms_entities: any[] | null; duration_days: number | null; warranty_days: number | null; is_active?: number; is_available?: number;
}
export interface Order {
  id: number; customer_telegram_id: number; customer_product_id: number; product_name: string; price: number;
  receipt_file_id: string | null; receipt_type: string | null; purchase_source: string; status: string;
  created_at: string; decided_at: string | null; decided_by: number | null; discount_code_id: number | null;
  duration_days: number | null; warranty_days: number | null; delivered_at: string | null;
  expires_at: string | null; warranty_expires_at: string | null; reminded_7d: number; reminded_3d: number;
  reminded_expired: number; stalled_alert_sent: number; reject_reason?: string | null; receipt_unique_id?: string | null; last_warranty_claim_at: string | null; paid_failed_handled: number;
}
export interface DiscountCode {
  id: number; code: string; customer_product_id: number; discount_type: 'percent' | 'fixed';
  discount_value: number; max_uses: number | null; expires_at: string; is_active: number; created_at: string;
  owner_telegram_id?: number | null; source?: string;
}
export interface BroadcastJob {
  id: number; admin_chat_id: number; text: string; entities: any[] | null; status: string;
  cursor_customer_id: number; total: number; sent: number; failed: number;
  audience?: string; reply_markup?: string | null; created_at?: string;
}
export type ClaimOutcome = 'claimed' | 'already_claimed' | 'claimed_by_other' | 'invalid';

const REMINDER_QUERIES: Record<string, string> = {
  '7d': `SELECT * FROM orders
         WHERE status = 'delivered' AND expires_at IS NOT NULL AND reminded_7d = 0
           AND expires_at <= datetime('now', '+03:30', '+7 days')
           AND expires_at >  datetime('now', '+03:30', '+3 days')`,
  '3d': `SELECT * FROM orders
         WHERE status = 'delivered' AND expires_at IS NOT NULL AND reminded_3d = 0
           AND expires_at <= datetime('now', '+03:30', '+3 days')
           AND expires_at >  datetime('now', '+03:30')`,
  'expired': `SELECT * FROM orders
         WHERE status = 'delivered' AND expires_at IS NOT NULL AND reminded_expired = 0
           AND expires_at <= datetime('now', '+03:30')`,
};
const REMINDER_FLAG_COLUMNS: Record<string, string> = { '7d': 'reminded_7d', '3d': 'reminded_3d', 'expired': 'reminded_expired' };

export const STALLED_QUERY = `
      SELECT * FROM orders
      WHERE  status = 'confirmed' AND stalled_alert_sent = 0
        AND  decided_at IS NOT NULL
        AND  decided_at <= datetime('now', '+03:30', ?)
    `;
export const REMINDER_SQL = REMINDER_QUERIES;

export class StoreDb {
  constructor(readonly db: Db) {}

  private q(sql: string, ...args: unknown[]): Stmt {
    return this.db.prepare(sql).bind(...args);
  }

  // ─── Customers ───────────────────────────────────────────────────────────
  async getCustomerByTelegramId(telegramId: number) {
    try {
      return (await this.q('SELECT * FROM customers WHERE telegram_id = ?', telegramId).first()) ?? undefined;
    } catch (err: any) {
      console.error('❌ [DB] getCustomerByTelegramId failed:', err.message);
      return undefined;
    }
  }

  async upsertCustomer({ telegramId, displayName }: { telegramId: number; displayName: string }) {
    const r = await this.q('INSERT OR IGNORE INTO customers (telegram_id, display_name) VALUES (?, ?)', telegramId, displayName).run();
    return { changes: r.meta.changes };
  }

  async getAllCustomerTelegramIds(): Promise<number[]> {
    try {
      const r = await this.q('SELECT telegram_id FROM customers').all<{ telegram_id: number }>();
      return r.results.map((x) => x.telegram_id);
    } catch (err: any) {
      console.error('❌ [DB] getAllCustomerTelegramIds failed:', err.message);
      return [];
    }
  }

  // ─── Customer products ───────────────────────────────────────────────────
  private parseProductRow(row: any): CustomerProduct | undefined {
    if (!row) return undefined;
    let termsEntities = null;
    if (row.terms_entities) {
      try {
        termsEntities = JSON.parse(row.terms_entities);
      } catch (err: any) {
        console.error('❌ [DB] Corrupt terms_entities JSON for product id=' + row.id + ':', err.message);
      }
    }
    return { ...row, terms_entities: termsEntities };
  }

  async getAllActiveCustomerProducts(): Promise<CustomerProduct[]> {
    try {
      const r = await this.q(`
      SELECT id, name, price, terms_text, terms_entities, duration_days, warranty_days, is_available
      FROM   customer_products
      WHERE  is_active = 1
      ORDER  BY id ASC
    `).all();
      return r.results.map((x) => this.parseProductRow(x)!);
    } catch (err: any) {
      console.error('❌ [DB] getAllActiveCustomerProducts failed:', err.message);
      return [];
    }
  }

  async getCustomerProductById(id: number): Promise<CustomerProduct | undefined> {
    try {
      const row = await this.q(`
      SELECT id, name, price, terms_text, terms_entities, duration_days, warranty_days, is_active, is_available
      FROM   customer_products
      WHERE  id = ?
    `, id).first();
      return this.parseProductRow(row);
    } catch (err: any) {
      console.error('❌ [DB] getCustomerProductById failed (id=' + id + '):', err.message);
      return undefined;
    }
  }

  async addCustomerProduct(p: {
    name: string; price: number; termsText?: string | null; termsEntities?: any[] | null;
    durationDays?: number | null; warrantyDays?: number | null;
  }) {
    const r = await this.q(`
    INSERT INTO customer_products (name, price, terms_text, terms_entities, duration_days, warranty_days)
    VALUES (?, ?, ?, ?, ?, ?)
  `, p.name, p.price, p.termsText || null, p.termsEntities?.length ? JSON.stringify(p.termsEntities) : null,
      p.durationDays || null, p.warrantyDays || null).run();
    return { lastInsertRowid: r.meta.last_row_id };
  }

  /** Edits an ACTIVE product; columns come from a fixed whitelist. changes = 0 → missing or deactivated. */
  async updateCustomerProduct(id: number, patch: Partial<{
    name: string; price: number; termsText: string | null; termsEntities: any[] | null;
    durationDays: number | null; warrantyDays: number | null; isAvailable: boolean;
  }>) {
    const sets: string[] = [];
    const args: unknown[] = [];
    const add = (col: string, v: unknown) => { sets.push(col + ' = ?'); args.push(v); };
    if (patch.name !== undefined) add('name', patch.name);
    if (patch.price !== undefined) add('price', patch.price);
    if (patch.termsText !== undefined) add('terms_text', patch.termsText || null);
    if (patch.termsEntities !== undefined) add('terms_entities', patch.termsEntities?.length ? JSON.stringify(patch.termsEntities) : null);
    if (patch.durationDays !== undefined) add('duration_days', patch.durationDays || null);
    if (patch.warrantyDays !== undefined) add('warranty_days', patch.warrantyDays || null);
    if (patch.isAvailable !== undefined) add('is_available', patch.isAvailable ? 1 : 0);
    if (!sets.length) return { changes: 0 };
    const r = await this.q('UPDATE customer_products SET ' + sets.join(', ') + ' WHERE id = ? AND is_active = 1', ...args, id).run();
    return { changes: r.meta.changes };
  }

  /** Active fixed-amount codes that would make `price` free (value ≥ price). */
  async getFixedCodesAtLeast(productId: number, price: number): Promise<DiscountCode[]> {
    return (await this.q(
      "SELECT * FROM discount_codes WHERE customer_product_id = ? AND is_active = 1 AND discount_type = 'fixed' AND discount_value >= ?",
      productId, price,
    ).all<DiscountCode>()).results;
  }

  // ─── Waitlist ────────────────────────────────────────────────────────────
  /** true = newly added, false = already on the list */
  async addToWaitlist(productId: number, customerTelegramId: number): Promise<boolean> {
    const r = await this.q('INSERT INTO product_waitlist (product_id, customer_telegram_id) VALUES (?, ?) ON CONFLICT DO NOTHING', productId, customerTelegramId).run();
    return r.meta.changes === 1;
  }

  async countWaitlist(productId: number): Promise<number> {
    return (await this.q('SELECT COUNT(*) AS n FROM product_waitlist WHERE product_id = ?', productId).first<{ n: number }>())!.n;
  }

  async clearWaitlist(productId: number, upToCreatedAt: string) {
    await this.q('DELETE FROM product_waitlist WHERE product_id = ? AND created_at <= ?', productId, upToCreatedAt).run();
  }

  async deactivateCustomerProduct(id: number) {
    const r = await this.q('UPDATE customer_products SET is_active = 0 WHERE id = ?', id).run();
    return { changes: r.meta.changes };
  }

  // ─── Orders ──────────────────────────────────────────────────────────────
  async createOrder(p: {
    customerTelegramId: number; customerProductId: number; productName: string; price: number;
    receiptFileId: string; receiptType: string; discountCodeId?: number | null;
  }) {
    const r = await this.q(`
    INSERT INTO orders
      (customer_telegram_id, customer_product_id, product_name, price, receipt_file_id, receipt_type, discount_code_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `, p.customerTelegramId, p.customerProductId, p.productName, p.price, p.receiptFileId, p.receiptType, p.discountCodeId || null).run();
    return { lastInsertRowid: r.meta.last_row_id };
  }

  async getOrderById(id: number): Promise<Order | undefined> {
    try {
      return ((await this.q('SELECT * FROM orders WHERE id = ?', id).first()) as Order | null) ?? undefined;
    } catch (err: any) {
      console.error('❌ [DB] getOrderById failed (id=' + id + '):', err.message);
      return undefined;
    }
  }

  async createManualPurchaseClaim(p: { creationKey: string; tokenHash: string; customerProductId: number; approvedBy: number }): Promise<any> {
    const [, sel] = await this.db.batch([
      this.q(`
      INSERT INTO manual_purchase_claims
        (creation_key, token_hash, customer_product_id, product_name, price, duration_days, warranty_days, approved_by)
      SELECT ?, ?, id, name, price, duration_days, warranty_days, ?
      FROM customer_products WHERE id = ? AND is_active = 1
      ON CONFLICT(creation_key) DO NOTHING
    `, p.creationKey, p.tokenHash, p.approvedBy, p.customerProductId),
      this.q('SELECT * FROM manual_purchase_claims WHERE creation_key = ?', p.creationKey),
    ]);
    const row = sel.results[0];
    if (!row) throw new Error('Selected customer product is unavailable.');
    return row;
  }

  async redeemManualPurchaseClaim(p: { tokenHash: string; customerTelegramId: number; displayName: string }): Promise<{ outcome: ClaimOutcome; order: Order | null }> {
    const { tokenHash: h, customerTelegramId: me, displayName } = p;
    const rs = await this.db.batch([
      this.q(`UPDATE manual_purchase_claims
        SET status = 'claimed', claimed_by = ?, claimed_at = datetime('now', '+03:30')
        WHERE token_hash = ? AND status = 'pending'`, me, h),
      this.q(`INSERT INTO customers (telegram_id, display_name)
        SELECT ?, ? WHERE EXISTS (SELECT 1 FROM manual_purchase_claims WHERE token_hash = ? AND claimed_by = ? AND order_id IS NULL)
        ON CONFLICT(telegram_id) DO UPDATE SET display_name = excluded.display_name`, me, displayName, h, me),
      this.q(`INSERT INTO orders (
          customer_telegram_id, customer_product_id, product_name, price,
          receipt_file_id, receipt_type, purchase_source, status, created_at,
          decided_at, decided_by, duration_days, warranty_days, delivered_at,
          expires_at, warranty_expires_at
        )
        SELECT ?, c.customer_product_id, c.product_name, c.price, NULL, NULL, 'manual', 'delivered', c.approved_at,
          c.approved_at, c.approved_by, c.duration_days, c.warranty_days, c.approved_at,
          CASE WHEN c.duration_days IS NOT NULL THEN datetime(c.approved_at, '+' || c.duration_days || ' days') END,
          CASE WHEN c.warranty_days IS NOT NULL THEN datetime(c.approved_at, '+' || c.warranty_days || ' days') END
        FROM manual_purchase_claims c WHERE c.token_hash = ? AND c.claimed_by = ? AND c.order_id IS NULL`, me, h, me),
      this.q(`UPDATE manual_purchase_claims SET order_id = (SELECT MAX(id) FROM orders)
        WHERE token_hash = ? AND claimed_by = ? AND order_id IS NULL`, h, me),
      this.q('SELECT * FROM manual_purchase_claims WHERE token_hash = ?', h),
    ]);
    const claim = rs[4].results[0];
    if (!claim) return { outcome: 'invalid', order: null };
    const order = claim.order_id ? (await this.getOrderById(claim.order_id)) ?? null : null;
    if (rs[0].meta.changes === 1) return { outcome: 'claimed', order };
    return { outcome: claim.claimed_by === me ? 'already_claimed' : 'claimed_by_other', order };
  }

  async deletePendingOrder(id: number) {
    const r = await this.q("DELETE FROM orders WHERE id = ? AND status = 'pending'", id).run();
    return { changes: r.meta.changes };
  }

  async decideOrder(id: number, { status, decidedBy }: { status: string; decidedBy: number }) {
    const r = await this.q(`
    UPDATE orders
    SET    status = ?, decided_at = datetime('now', '+03:30'), decided_by = ?
    WHERE  id = ? AND status = 'pending'
  `, status, decidedBy, id).run();
    return { changes: r.meta.changes };
  }

  async setOrderSubscriptionSnapshot(id: number, { durationDays, warrantyDays }: { durationDays: number | null; warrantyDays: number | null }) {
    const r = await this.q('UPDATE orders SET duration_days = ?, warranty_days = ? WHERE id = ?', durationDays || null, warrantyDays || null, id).run();
    return { changes: r.meta.changes };
  }

  async markOrderDelivered(id: number) {
    const r = await this.q(`
    UPDATE orders
    SET    status       = 'delivered',
           delivered_at = datetime('now', '+03:30'),
           expires_at   = CASE WHEN duration_days IS NOT NULL
                               THEN datetime('now', '+03:30', '+' || duration_days || ' days') END,
           warranty_expires_at = CASE WHEN warranty_days IS NOT NULL
                               THEN datetime('now', '+03:30', '+' || warranty_days || ' days') END
    WHERE  id = ? AND status = 'confirmed'
  `, id).run();
    return { changes: r.meta.changes };
  }

  async getDeliveredOrdersForCustomer(telegramId: number): Promise<Order[]> {
    try {
      const r = await this.q(`
      SELECT * FROM orders
      WHERE  customer_telegram_id = ? AND status = 'delivered'
      ORDER  BY delivered_at DESC
    `, telegramId).all<Order>();
      return r.results;
    } catch (err: any) {
      console.error('❌ [DB] getDeliveredOrdersForCustomer failed:', err.message);
      return [];
    }
  }

  async getOrdersDueForReminder(kind: string): Promise<Order[]> {
    try {
      return (await this.q(REMINDER_QUERIES[kind]).all<Order>()).results;
    } catch (err: any) {
      console.error('❌ [DB] getOrdersDueForReminder(' + kind + ') failed:', err.message);
      return [];
    }
  }

  async setOrderReminderSent(id: number, kind: string) {
    const column = REMINDER_FLAG_COLUMNS[kind];
    if (!column) throw new Error('Unknown reminder kind: ' + kind);
    const r = await this.q('UPDATE orders SET ' + column + ' = 1 WHERE id = ?', id).run();
    return { changes: r.meta.changes };
  }

  /** One batch per ≤90 ids (D1 allows 100 bound parameters per query). */
  async setOrderRemindersSent(ids: number[], kind: string) {
    const column = REMINDER_FLAG_COLUMNS[kind];
    if (!column) throw new Error('Unknown reminder kind: ' + kind);
    const stmts: Stmt[] = [];
    for (let i = 0; i < ids.length; i += 90) {
      const chunk = ids.slice(i, i + 90);
      stmts.push(this.q('UPDATE orders SET ' + column + ' = 1 WHERE id IN (' + chunk.map(() => '?').join(',') + ')', ...chunk));
    }
    if (stmts.length) await this.db.batch(stmts);
  }

  async getStalledConfirmedOrders(thresholdHours: number): Promise<Order[]> {
    try {
      return (await this.q(STALLED_QUERY, '-' + thresholdHours + ' hours').all<Order>()).results;
    } catch (err: any) {
      console.error('❌ [DB] getStalledConfirmedOrders failed:', err.message);
      return [];
    }
  }

  async setStalledAlertSent(id: number) {
    const r = await this.q('UPDATE orders SET stalled_alert_sent = 1 WHERE id = ?', id).run();
    return { changes: r.meta.changes };
  }

  async setPaidFailedHandled(id: number) {
    const r = await this.q('UPDATE orders SET paid_failed_handled = 1 WHERE id = ?', id).run();
    return { changes: r.meta.changes };
  }

  async setWarrantyClaimNow(id: number) {
    const r = await this.q("UPDATE orders SET last_warranty_claim_at = datetime('now', '+03:30') WHERE id = ?", id).run();
    return { changes: r.meta.changes };
  }

  // ─── Discount codes ──────────────────────────────────────────────────────
  async nowLocalDateTimeString(): Promise<string> {
    return (await this.q("SELECT datetime('now', '+03:30') AS now").first<{ now: string }>())!.now;
  }

  async createDiscountCode(p: { code: string; customerProductId: number; discountType: string; discountValue: number; maxUses: number | null; expiresAt: string }) {
    const r = await this.q(`
    INSERT INTO discount_codes
      (code, customer_product_id, discount_type, discount_value, max_uses, expires_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `, p.code.toUpperCase(), p.customerProductId, p.discountType, p.discountValue, p.maxUses ?? null, p.expiresAt).run();
    return { lastInsertRowid: r.meta.last_row_id };
  }

  async getDiscountCodeByCode(code: string): Promise<DiscountCode | undefined> {
    try {
      return ((await this.q('SELECT * FROM discount_codes WHERE code = ?', code.toUpperCase().trim()).first()) as DiscountCode | null) ?? undefined;
    } catch (err: any) {
      console.error('❌ [DB] getDiscountCodeByCode failed:', err.message);
      return undefined;
    }
  }

  async getDiscountCodeById(id: number): Promise<DiscountCode | undefined> {
    try {
      return ((await this.q('SELECT * FROM discount_codes WHERE id = ?', id).first()) as DiscountCode | null) ?? undefined;
    } catch (err: any) {
      console.error('❌ [DB] getDiscountCodeById failed (id=' + id + '):', err.message);
      return undefined;
    }
  }

  async getAllDiscountCodes(): Promise<DiscountCode[]> {
    try {
      return (await this.q('SELECT * FROM discount_codes ORDER BY id DESC').all<DiscountCode>()).results;
    } catch (err: any) {
      console.error('❌ [DB] getAllDiscountCodes failed:', err.message);
      return [];
    }
  }

  async updateDiscountCodeDetails(id: number, p: { discountType: string; discountValue: number; customerProductId: number; maxUses: number | null }) {
    const r = await this.q(`
    UPDATE discount_codes
    SET    discount_type = ?, discount_value = ?, customer_product_id = ?, max_uses = ?
    WHERE  id = ?
  `, p.discountType, p.discountValue, p.customerProductId, p.maxUses ?? null, id).run();
    return { changes: r.meta.changes };
  }

  async renewDiscountCode(id: number, newExpiresAt: string) {
    const r = await this.q('UPDATE discount_codes SET expires_at = ?, is_active = 1 WHERE id = ?', newExpiresAt, id).run();
    return { changes: r.meta.changes };
  }

  async deactivateDiscountCode(id: number) {
    const r = await this.q('UPDATE discount_codes SET is_active = 0 WHERE id = ?', id).run();
    return { changes: r.meta.changes };
  }

  /** Deliberately throws — callers must fail closed. */
  async countDiscountCodeRedemptions(discountCodeId: number): Promise<number> {
    const row = await this.q('SELECT COUNT(*) AS n FROM discount_code_redemptions WHERE discount_code_id = ?', discountCodeId).first<{ n: number }>();
    return row!.n;
  }

  /** Deliberately throws — callers must fail closed. */
  async hasCustomerRedeemedCode(discountCodeId: number, customerTelegramId: number): Promise<boolean> {
    const row = await this.q(`
    SELECT 1 FROM discount_code_redemptions
    WHERE  discount_code_id = ? AND customer_telegram_id = ?
  `, discountCodeId, customerTelegramId).first();
    return !!row;
  }

  /**
   * Records the redemption only if the per-customer and max_uses rules still hold — one statement, so two
   * confirms racing each other (two pending receipts with the same code) can't both get it. true = recorded.
   */
  async redeemDiscountCodeAtomic(discountCodeId: number, customerTelegramId: number, orderId: number): Promise<boolean> {
    const r = await this.q(`
    INSERT INTO discount_code_redemptions (discount_code_id, customer_telegram_id, order_id)
    SELECT d.id, ?, ? FROM discount_codes d
    WHERE  d.id = ?
      AND  NOT EXISTS (SELECT 1 FROM discount_code_redemptions r WHERE r.discount_code_id = d.id AND r.customer_telegram_id = ?)
      AND  (d.max_uses IS NULL OR (SELECT COUNT(*) FROM discount_code_redemptions r WHERE r.discount_code_id = d.id) < d.max_uses)
  `, customerTelegramId, orderId, discountCodeId, customerTelegramId).run();
    return r.meta.changes === 1;
  }

  // ─── Store settings ──────────────────────────────────────────────────────
  async getStoreSettings(): Promise<{ id: number; card_number: string; card_holder_name: string } | undefined> {
    try {
      const row: any = await this.q('SELECT * FROM store_settings WHERE id = 1').first();
      // a row without a card number (possible in migrated data) counts as «not configured yet»
      if (!row || !row.card_number) return undefined;
      return { ...row, card_holder_name: row.card_holder_name ?? '' };
    } catch (err: any) {
      console.error('❌ [DB] getStoreSettings failed:', err.message);
      return undefined;
    }
  }

  async upsertStoreSettings({ cardNumber, cardHolderName }: { cardNumber: string; cardHolderName: string }) {
    const r = await this.q(`
    INSERT INTO store_settings (id, card_number, card_holder_name)
    VALUES (1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET card_number = excluded.card_number, card_holder_name = excluded.card_holder_name
  `, cardNumber, cardHolderName).run();
    return { changes: r.meta.changes };
  }

  // ─── Broadcast queue ─────────────────────────────────────────────────────
  async countAudience(audience: string): Promise<number> {
    const f = audienceFilter(audience);
    return (await this.q('SELECT COUNT(*) AS n FROM customers c WHERE ' + f.where, ...f.args).first<{ n: number }>())!.n;
  }

  async enqueueBroadcast(p: {
    adminChatId: number; text: string; entities: any[] | null; audience?: string; replyMarkup?: any | null;
  }): Promise<number> {
    const audience = p.audience ?? 'all';
    const total = await this.countAudience(audience);
    const r = await this.q(
      'INSERT INTO broadcast_jobs (admin_chat_id, text, entities, total, audience, reply_markup) VALUES (?, ?, ?, ?, ?, ?)',
      p.adminChatId, p.text, p.entities?.length ? JSON.stringify(p.entities) : null, total, audience,
      p.replyMarkup ? JSON.stringify(p.replyMarkup) : null,
    ).run();
    return r.meta.last_row_id;
  }

  async getRunningBroadcast(): Promise<BroadcastJob | undefined> {
    const row: any = await this.q("SELECT * FROM broadcast_jobs WHERE status = 'running' ORDER BY id LIMIT 1").first();
    if (!row) return undefined;
    let entities = null;
    if (row.entities) {
      try {
        entities = JSON.parse(row.entities);
      } catch (err: any) {
        // a corrupt row must not block this and every later announcement — send it as plain text
        console.error('❌ [DB] Corrupt entities JSON for broadcast job id=' + row.id + ':', err.message);
      }
    }
    return { ...row, entities };
  }

  /**
   * Atomic lease so only one invocation sends a broadcast batch at a time (the admin's webhook and the
   * every-minute cron used to send the same batch concurrently). `token` = lease expiry (epoch ms).
   */
  async acquireBroadcastLease(nowMs: number, token: number): Promise<boolean> {
    const r = await this.q(
      "INSERT INTO app_state (key, value, updated_at) VALUES ('broadcast_lease', ?, datetime('now')) " +
        'ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at ' +
        'WHERE CAST(app_state.value AS INTEGER) <= ?',
      String(token), nowMs,
    ).run();
    return r.meta.changes === 1;
  }

  async releaseBroadcastLease(token: number): Promise<void> {
    await this.q("UPDATE app_state SET value = '0' WHERE key = 'broadcast_lease' AND value = ?", String(token)).run();
  }

  async getCustomerBatch(afterId: number, limit: number, audience = 'all'): Promise<{ id: number; telegram_id: number }[]> {
    const f = audienceFilter(audience);
    return (await this.q(
      'SELECT c.id, c.telegram_id FROM customers c WHERE c.id > ? AND (' + f.where + ') ORDER BY c.id LIMIT ?',
      afterId, ...f.args, limit,
    ).all<{ id: number; telegram_id: number }>()).results;
  }

  async updateBroadcastProgress(id: number, cursor: number, sent: number, failed: number) {
    await this.q('UPDATE broadcast_jobs SET cursor_customer_id = ?, sent = ?, failed = ? WHERE id = ?', cursor, sent, failed, id).run();
  }

  async finishBroadcast(id: number, cursor: number, sent: number, failed: number) {
    await this.q(
      "UPDATE broadcast_jobs SET status = 'done', cursor_customer_id = ?, sent = ?, failed = ?, finished_at = datetime('now','+03:30') WHERE id = ?",
      cursor, sent, failed, id,
    ).run();
  }
}

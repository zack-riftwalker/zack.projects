import type { Db, Stmt } from '../lib/budget';
import { audienceFilter } from './audience';

export interface CustomerProduct {
  id: number; name: string; price: number; terms_text: string | null;
  terms_entities: any[] | null; duration_days: number | null; warranty_days: number | null; is_active?: number; is_available?: number;
  // round 3 (SUPPLIER_PLAN.md §2.1); present on rows that select them
  group_id?: number | null; option_label?: string | null; sort_order?: number; pricing_mode?: string; markup_percent?: number | null;
  markup_fixed?: number | null; cost_toman?: number | null; stock_mode?: string; price_updated_at?: string | null;
  // round 4 (CAMPAIGN_PLAN.md §9)
  compare_at_price?: number | null;
  // round 5 (UI_PLAN.md §7): Telegram file_id of the product photo (store bot); null = none
  photo_file_id?: string | null;
  // round 7 (EITAA_MENU_PLAN.md §1): the word an Eitaa customer types to get this product's details
  eitaa_keyword?: string | null;
}
export interface Order {
  id: number; customer_telegram_id: number; customer_product_id: number; product_name: string; price: number;
  receipt_file_id: string | null; receipt_type: string | null; purchase_source: string; status: string;
  created_at: string; decided_at: string | null; decided_by: number | null; discount_code_id: number | null;
  duration_days: number | null; warranty_days: number | null; delivered_at: string | null;
  expires_at: string | null; warranty_expires_at: string | null; reminded_7d: number; reminded_3d: number;
  reminded_expired: number; stalled_alert_sent: number; reject_reason?: string | null; receipt_unique_id?: string | null; last_warranty_claim_at: string | null; paid_failed_handled: number;
  // round 3 (SUPPLIER_PLAN.md §2.1)
  customer_username?: string | null; fulfillment?: string | null; needs_action_reason?: string | null; needs_action_at?: string | null;
  supplier_deadline_at?: string | null; cost_toman?: number | null; cancel_reason?: string | null; cancelled_at?: string | null;
  cancelled_by?: number | null; refund_status?: string | null; refunded_at?: string | null;
  /** a timestamp while a delivery is being sent (SUPPLIER_PLAN.md §7.5); NULL = nobody is sending */
  delivery_claimed_at?: string | null;
}
export interface DiscountCode {
  id: number; code: string; customer_product_id: number; discount_type: 'percent' | 'fixed';
  discount_value: number; max_uses: number | null; expires_at: string; is_active: number; created_at: string;
  owner_telegram_id?: number | null; source?: string; product_group_id?: number | null;
  /** round 4 (§6): local Tehran start time; NULL = active immediately */
  starts_at?: string | null;
}
export interface ProductGroup { id: number; name: string; sort_order: number }
export interface BroadcastJob {
  id: number; admin_chat_id: number; text: string; entities: any[] | null; status: string;
  cursor_customer_id: number; total: number; sent: number; failed: number;
  audience?: string; reply_markup?: string | null; created_at?: string;
  /** round 4 (§5): local Tehran time; NULL = send now */
  send_after?: string | null; cancelled?: number;
}
/** round 6 (PRICE_SCHEDULE_PLAN.md): a scheduled sale price; times are local Tehran strings */
export interface PriceSchedule {
  id: number; product_id: number; sale_price: number; normal_price: number | null; normal_compare_at: number | null;
  starts_at: string; ends_at: string; status: 'pending' | 'active' | 'done' | 'cancelled'; note: string | null; created_at: string;
}
export interface CheckoutDraft { customer_telegram_id: number; product_id: number; product_name: string; price: number; created_at: string; reminded: number }
export const DUE_DRAFTS_SQL = 'SELECT * FROM checkout_drafts WHERE reminded = 0 AND created_at <= ? AND created_at >= ? ORDER BY created_at LIMIT ?';
/** `reminded IN (0, 1)` lets the (reminded, created_at) index serve the range */
export const PURGE_DRAFTS_SQL = 'DELETE FROM checkout_drafts WHERE reminded IN (0, 1) AND created_at < ?';
/** a free (0-Toman) order for the invitee of `referrals`, for the gift product (arg), made since the referral qualified */
const GIFT_ORDER_SQL = 'SELECT 1 FROM orders o WHERE o.customer_telegram_id = referrals.invitee_telegram_id AND o.price = 0 AND o.customer_product_id = ? AND o.created_at >= referrals.qualified_at';
/** an order since the draft: created after it, or (a manual link made earlier) confirmed after it */
export const HAS_ORDER_SINCE_SQL = "SELECT 1 FROM orders WHERE customer_telegram_id = ? AND (created_at >= ? OR (status IN ('confirmed', 'delivered') AND decided_at >= ?)) LIMIT 1";
/** claims the drafts that are still unreminded and says which ones this caller got */
export const CLAIM_DRAFTS_SQL_PREFIX = 'UPDATE checkout_drafts SET reminded = 1 WHERE reminded = 0 AND customer_telegram_id IN (';
export const PENDING_GIFTS_SQL = 'SELECT id FROM referrals WHERE invitee_reward_eligible = 1 AND invitee_reward_order_id IS NULL ORDER BY id LIMIT ?';
/** a claim never finished and no free order exists for the invitee: released (args: qualified_at cut-off is built in) */
export const RESET_GIFTS_SQL = `UPDATE referrals SET invitee_reward_order_id = NULL
  WHERE invitee_reward_eligible = 1 AND invitee_reward_order_id = -1 AND qualified_at <= datetime('now', '+03:30', '-1 hours')
    AND NOT EXISTS (${GIFT_ORDER_SQL})`;
/** a claim never finished but the free order exists: link it instead of issuing a second one */
export const LINK_GIFTS_SQL = `UPDATE referrals SET invitee_reward_order_id = (${GIFT_ORDER_SQL.replace('SELECT 1', 'SELECT o.id')} ORDER BY o.id LIMIT 1)
  WHERE invitee_reward_eligible = 1 AND invitee_reward_order_id = -1 AND qualified_at <= datetime('now', '+03:30', '-1 hours')
    AND EXISTS (${GIFT_ORDER_SQL})`;
export const DISCOUNT_REVENUE_SQL = "SELECT COUNT(*) AS n, COALESCE(SUM(price), 0) AS sum FROM orders WHERE discount_code_id = ? AND status IN ('confirmed', 'delivered')";
export const RUNNING_BROADCAST_SQL = "SELECT * FROM broadcast_jobs WHERE status = 'running' AND cancelled = 0 AND (send_after IS NULL OR send_after <= ?) ORDER BY id LIMIT 1";
export const SCHEDULED_BROADCASTS_SQL = "SELECT id, text, audience, send_after FROM broadcast_jobs WHERE status = 'running' AND cancelled = 0 AND send_after > ? ORDER BY send_after LIMIT ?";
/** round 6: due schedules (to start or to end) with the product's name and current price; the OR is served by the two (status, time) indexes */
export const DUE_SCHEDULES_SQL = `SELECT s.*, (SELECT name FROM customer_products WHERE id = s.product_id) AS product_name,
  (SELECT price FROM customer_products WHERE id = s.product_id) AS current_price
  FROM price_schedules s WHERE (s.status = 'pending' AND s.starts_at <= ?) OR (s.status = 'active' AND s.ends_at <= ?) ORDER BY s.id LIMIT 4`;
/** claims a pending schedule and remembers the product's price AND compare_at_price; RETURNING gives the claimed normal price */
/** the Eitaa auto-reply's product read (EITAA_MENU_PLAN.md §2.2) */
export const EITAA_PRODUCTS_SQL = `SELECT p.id, p.name, p.price, p.compare_at_price, p.is_available, p.terms_text, p.terms_entities, p.eitaa_keyword,
       p.group_id, p.sort_order, p.duration_days, g.sort_order AS group_sort
FROM customer_products p LEFT JOIN product_groups g ON g.id = p.group_id
WHERE p.is_active = 1`;
export const EITAA_KEYWORDS_SQL = 'SELECT id, name, eitaa_keyword FROM customer_products WHERE is_active = 1 AND eitaa_keyword IS NOT NULL';

export const CLAIM_SCHEDULE_SQL = "UPDATE price_schedules SET status = 'active', normal_price = (SELECT price FROM customer_products WHERE id = ?), normal_compare_at = (SELECT compare_at_price FROM customer_products WHERE id = ?) WHERE id = ? AND status = 'pending' RETURNING normal_price";
export const APPLY_SALE_SQL = "UPDATE customer_products SET compare_at_price = price, price = ? WHERE id = ? AND is_active = 1 AND pricing_mode = 'manual' AND price > ? AND EXISTS (SELECT 1 FROM price_schedules WHERE id = ? AND status = 'active')";
/** claimed but the sale is not on the product (nothing applied): close it in the same batch, so an `active` row never exists without its sale */
export const CLOSE_UNAPPLIED_SQL = "UPDATE price_schedules SET status = 'done', note = ? WHERE id = ? AND status = 'active' AND NOT EXISTS (SELECT 1 FROM customer_products WHERE id = ? AND price = ?)";
/** args: normal_price, normal_compare_at, product_id, sale_price, normal_price, schedule_id. Only while the sale is untouched AND the schedule is still active. */
export const REVERT_SALE_SQL = "UPDATE customer_products SET price = ?, compare_at_price = ? WHERE id = ? AND price = ? AND compare_at_price = ? AND EXISTS (SELECT 1 FROM price_schedules WHERE id = ? AND status = 'active')";
export const FINISH_SCHEDULE_SQL = "UPDATE price_schedules SET status = 'done' WHERE id = ? AND status = 'active'";
export type DueSchedule = PriceSchedule & { product_name: string | null; current_price: number | null };
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
        AND  (fulfillment IS NULL OR fulfillment <> 'supplier')
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

  /**
   * `changes` is 1 only for a brand-new customer (the INSERT's result). A given `username` (null = none) is written
   * to existing rows too, without '@'.
   */
  async upsertCustomer({ telegramId, displayName, username }: { telegramId: number; displayName: string; username?: string | null }) {
    const name = username ? username.replace(/^@/, '') : null;
    const stmts = [this.q('INSERT OR IGNORE INTO customers (telegram_id, display_name, username) VALUES (?, ?, ?)', telegramId, displayName, name)];
    if (username !== undefined) {
      stmts.push(this.q('UPDATE customers SET username = ? WHERE telegram_id = ? AND username IS NOT ?', name, telegramId, name));
    }
    const [inserted] = await this.db.batch(stmts);
    return { changes: inserted.meta.changes };
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
      SELECT id, name, price, terms_text, terms_entities, duration_days, warranty_days, is_available,
             group_id, option_label, sort_order
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
      SELECT id, name, price, terms_text, terms_entities, duration_days, warranty_days, is_active, is_available,
             group_id, option_label, sort_order, cost_toman, stock_mode, pricing_mode, markup_percent, markup_fixed, compare_at_price,
             photo_file_id, eitaa_keyword
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
    durationDays: number | null; warrantyDays: number | null; isAvailable: boolean; stockMode: 'auto' | 'manual'; pricingMode: 'auto' | 'manual';
    compareAtPrice: number | null; photoFileId: string | null; eitaaKeyword: string | null;
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
    if (patch.stockMode !== undefined) add('stock_mode', patch.stockMode);
    if (patch.pricingMode !== undefined) add('pricing_mode', patch.pricingMode);
    if (patch.compareAtPrice !== undefined) add('compare_at_price', patch.compareAtPrice);
    if (patch.photoFileId !== undefined) add('photo_file_id', patch.photoFileId);
    if (patch.eitaaKeyword !== undefined) add('eitaa_keyword', patch.eitaaKeyword);
    if (!sets.length) return { changes: 0 };
    const r = await this.q('UPDATE customer_products SET ' + sets.join(', ') + ' WHERE id = ? AND is_active = 1', ...args, id).run();
    return { changes: r.meta.changes };
  }

  /** Active products for the Eitaa auto-reply, with their group's sort order (one statement; ordered in code like the catalog). */
  async getEitaaProducts(): Promise<(CustomerProduct & { group_sort: number | null })[]> {
    const r = await this.q(EITAA_PRODUCTS_SQL).all();
    return r.results.map((x) => this.parseProductRow(x)!) as (CustomerProduct & { group_sort: number | null })[];
  }

  /** Active products that have an Eitaa keyword (the duplicate check of the keyword button). */
  async listEitaaKeywords(): Promise<{ id: number; name: string; eitaa_keyword: string }[]> {
    return (await this.q(EITAA_KEYWORDS_SQL).all<{ id: number; name: string; eitaa_keyword: string }>()).results;
  }

  /** Active fixed-amount codes that would make `price` free (value ≥ price), including group codes of `groupId`. */
  async getFixedCodesAtLeast(productId: number, price: number, groupId: number | null = null): Promise<DiscountCode[]> {
    return (await this.q(
      `SELECT * FROM discount_codes
       WHERE (customer_product_id = ? OR (product_group_id IS NOT NULL AND product_group_id = ?))
         AND is_active = 1 AND discount_type = 'fixed' AND discount_value >= ?`,
      productId, groupId, price,
    ).all<DiscountCode>()).results;
  }

  // ─── Product groups (SUPPLIER_PLAN.md §3) ────────────────────────────────
  /** Products and the groups they belong to, in one batch (the storefront catalog). */
  async getCatalogData(): Promise<{ products: CustomerProduct[]; groups: ProductGroup[] }> {
    const [p, g] = await this.db.batch([
      this.q(`SELECT id, name, price, terms_text, terms_entities, duration_days, warranty_days, is_available,
                     group_id, option_label, sort_order, compare_at_price
              FROM customer_products WHERE is_active = 1 ORDER BY id ASC`),
      this.q('SELECT id, name, sort_order FROM product_groups WHERE id IN (SELECT group_id FROM customer_products WHERE is_active = 1 AND group_id IS NOT NULL)'),
    ]);
    return {
      products: p.results.map((x) => this.parseProductRow(x)!),
      groups: g.results as ProductGroup[],
    };
  }

  async getProductGroup(groupId: number): Promise<ProductGroup | undefined> {
    return (await this.q('SELECT id, name, sort_order FROM product_groups WHERE id = ?', groupId).first<ProductGroup>()) ?? undefined;
  }

  async listGroups(): Promise<ProductGroup[]> {
    return (await this.q('SELECT id, name, sort_order FROM product_groups ORDER BY sort_order, id').all<ProductGroup>()).results;
  }

  /** A group with its active options, for the group's detail message (one batch). */
  async getGroupWithOptions(groupId: number): Promise<{ group: ProductGroup | null; options: CustomerProduct[] }> {
    const [g, o] = await this.db.batch([
      this.q('SELECT id, name, sort_order FROM product_groups WHERE id = ?', groupId),
      this.q(`SELECT id, name, price, terms_text, terms_entities, duration_days, warranty_days, is_available,
                     group_id, option_label, sort_order, cost_toman, compare_at_price
              FROM customer_products WHERE group_id = ? AND is_active = 1`, groupId),
    ]);
    return { group: (g.results[0] as ProductGroup) ?? null, options: o.results.map((x) => this.parseProductRow(x)!) };
  }

  /** Every option of the group (active or not) — its display names are rewritten together. */
  private syncOptionNamesStmt(groupId: number): Stmt {
    return this.q(
      "UPDATE customer_products SET name = (SELECT name FROM product_groups WHERE id = ?) || ' — ' || COALESCE(option_label, '') WHERE group_id = ?",
      groupId, groupId,
    );
  }

  async createGroup(name: string): Promise<number> {
    const r = await this.q('INSERT INTO product_groups (name) VALUES (?)', name).run();
    return r.meta.last_row_id;
  }

  /** Renames the group and rewrites every option's display name in the same batch. */
  async renameGroup(groupId: number, name: string): Promise<void> {
    await this.db.batch([this.q('UPDATE product_groups SET name = ? WHERE id = ?', name, groupId), this.syncOptionNamesStmt(groupId)]);
  }

  async setGroupSortOrder(groupId: number, sortOrder: number): Promise<void> {
    await this.q('UPDATE product_groups SET sort_order = ? WHERE id = ?', sortOrder, groupId).run();
  }

  /** Changes an option's label and refreshes the display names of its group. */
  async setOptionLabel(productId: number, groupId: number, label: string): Promise<{ changes: number }> {
    const [r] = await this.db.batch([
      this.q('UPDATE customer_products SET option_label = ? WHERE id = ? AND group_id = ? AND is_active = 1', label, productId, groupId),
      this.syncOptionNamesStmt(groupId),
    ]);
    return { changes: r.meta.changes };
  }

  /** Puts an option into a group (`name` = group name + ' — ' + label, computed by the caller). */
  async moveOptionToGroup(productId: number, groupId: number, label: string, name: string): Promise<{ changes: number }> {
    const r = await this.q('UPDATE customer_products SET group_id = ?, option_label = ?, name = ? WHERE id = ? AND is_active = 1', groupId, label, name, productId).run();
    return { changes: r.meta.changes };
  }

  /** Takes an option out of its group: it becomes an ordinary product named by its label. */
  async leaveGroup(productId: number): Promise<{ changes: number }> {
    const r = await this.q(
      'UPDATE customer_products SET name = COALESCE(option_label, name), group_id = NULL, option_label = NULL WHERE id = ? AND is_active = 1',
      productId,
    ).run();
    return { changes: r.meta.changes };
  }

  async setOptionSortOrder(productId: number, sortOrder: number): Promise<{ changes: number }> {
    const r = await this.q('UPDATE customer_products SET sort_order = ? WHERE id = ? AND is_active = 1', sortOrder, productId).run();
    return { changes: r.meta.changes };
  }

  /** Active codes that can apply to this option (its own codes and its group's). */
  async getActiveCodesForProduct(productId: number, groupId: number | null): Promise<DiscountCode[]> {
    return (await this.q(
      `SELECT * FROM discount_codes
       WHERE is_active = 1 AND (customer_product_id = ? OR (product_group_id IS NOT NULL AND product_group_id = ?))`,
      productId, groupId,
    ).all<DiscountCode>()).results;
  }

  /** Terms for the whole group (one statement). */
  async setGroupTerms(groupId: number, termsText: string | null, termsEntities: any[] | null): Promise<void> {
    await this.q(
      'UPDATE customer_products SET terms_text = ?, terms_entities = ? WHERE group_id = ? AND is_active = 1',
      termsText || null, termsEntities?.length ? JSON.stringify(termsEntities) : null, groupId,
    ).run();
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
    receiptFileId: string; receiptType: string; discountCodeId?: number | null; receiptUniqueId?: string | null;
    customerUsername?: string | null;
  }) {
    const r = await this.q(`
    INSERT INTO orders
      (customer_telegram_id, customer_product_id, product_name, price, receipt_file_id, receipt_type, discount_code_id, receipt_unique_id, customer_username)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, p.customerTelegramId, p.customerProductId, p.productName, p.price, p.receiptFileId, p.receiptType, p.discountCodeId || null, p.receiptUniqueId || null,
      p.customerUsername || null).run();
    return { lastInsertRowid: r.meta.last_row_id };
  }

  /** The newest earlier order that used the same receipt file (duplicate detection). */
  async findOrderByReceiptUniqueId(uniqueId: string): Promise<{ id: number; status: string; customer_telegram_id: number } | null> {
    return this.q('SELECT id, status, customer_telegram_id FROM orders WHERE receipt_unique_id = ? ORDER BY id DESC LIMIT 1', uniqueId).first();
  }

  async getOrderById(id: number): Promise<Order | undefined> {
    try {
      return ((await this.q('SELECT * FROM orders WHERE id = ?', id).first()) as Order | null) ?? undefined;
    } catch (err: any) {
      console.error('❌ [DB] getOrderById failed (id=' + id + '):', err.message);
      return undefined;
    }
  }

  async createManualPurchaseClaim(p: {
    creationKey: string; tokenHash: string; customerProductId: number; approvedBy: number;
    /** 'stock' reserves `stockAccountId` together with the claim; 'supplier' buys when the customer opens the link */
    fulfillment?: 'outside' | 'stock' | 'supplier'; stockAccountId?: number;
  }): Promise<any> {
    const stock = p.fulfillment === 'stock' && p.stockAccountId !== undefined;
    const stmts = [
      // the reservation comes first: the claim below is inserted only while it changed a row
      ...(stock ? [this.q("UPDATE stock_accounts SET status = 'reserved', updated_at = datetime('now', '+03:30') WHERE id = ? AND status = 'available'", p.stockAccountId)] : []),
      this.q(`
      INSERT INTO manual_purchase_claims
        (creation_key, token_hash, customer_product_id, product_name, price, duration_days, warranty_days, approved_by, fulfillment, stock_account_id)
      SELECT ?, ?, id, name, price, duration_days, warranty_days, ?, ?, ?
      FROM customer_products WHERE id = ? AND is_active = 1${stock ? ' AND changes() = 1' : ''}
      ON CONFLICT(creation_key) DO NOTHING
    `, p.creationKey, p.tokenHash, p.approvedBy, p.fulfillment && p.fulfillment !== 'outside' ? p.fulfillment : null, stock ? p.stockAccountId : null, p.customerProductId),
      this.q('SELECT * FROM manual_purchase_claims WHERE creation_key = ?', p.creationKey),
    ];
    const rs = await this.db.batch(stmts);
    const row = rs[rs.length - 1].results[0];
    if (!row) {
      // the product vanished after the reservation: give the account back
      if (stock) await this.q("UPDATE stock_accounts SET status = 'available' WHERE id = ? AND status = 'reserved' AND order_id IS NULL", p.stockAccountId).run();
      throw new Error('Selected customer product is unavailable.');
    }
    return row;
  }

  async redeemManualPurchaseClaim(p: {
    tokenHash: string; customerTelegramId: number; displayName: string;
    /** the deadline of a supplier-fulfilled purchase (Tehran 'YYYY-MM-DD HH:MM:SS'), now + 20 h */
    supplierDeadlineAt?: string;
  }): Promise<{ outcome: ClaimOutcome; order: Order | null; claim: { fulfillment: string | null; stock_account_id: number | null; approved_by: number } | null }> {
    const { tokenHash: h, customerTelegramId: me, displayName } = p;
    const supplier = "c.fulfillment = 'supplier'";
    const rs = await this.db.batch([
      this.q(`UPDATE manual_purchase_claims
        SET status = 'claimed', claimed_by = ?, claimed_at = datetime('now', '+03:30')
        WHERE token_hash = ? AND status = 'pending'`, me, h),
      this.q(`INSERT INTO customers (telegram_id, display_name)
        SELECT ?, ? WHERE EXISTS (SELECT 1 FROM manual_purchase_claims WHERE token_hash = ? AND claimed_by = ? AND order_id IS NULL)
        ON CONFLICT(telegram_id) DO UPDATE SET display_name = excluded.display_name`, me, displayName, h, me),
      // 'supplier': confirmed and not delivered (the clocks start at delivery); 'stock': delivered as always, the account is sent after this batch
      this.q(`INSERT INTO orders (
          customer_telegram_id, customer_product_id, product_name, price,
          receipt_file_id, receipt_type, purchase_source, status, created_at,
          decided_at, decided_by, duration_days, warranty_days, delivered_at,
          expires_at, warranty_expires_at, customer_username, fulfillment, supplier_deadline_at
        )
        SELECT ?, c.customer_product_id, c.product_name, c.price, NULL, NULL, 'manual',
          CASE WHEN ${supplier} THEN 'confirmed' ELSE 'delivered' END, c.approved_at,
          c.approved_at, c.approved_by, c.duration_days, c.warranty_days,
          CASE WHEN ${supplier} THEN NULL ELSE c.approved_at END,
          CASE WHEN ${supplier} THEN NULL WHEN c.duration_days IS NOT NULL THEN datetime(c.approved_at, '+' || c.duration_days || ' days') END,
          CASE WHEN ${supplier} THEN NULL WHEN c.warranty_days IS NOT NULL THEN datetime(c.approved_at, '+' || c.warranty_days || ' days') END,
          (SELECT username FROM customers WHERE telegram_id = ?),
          CASE WHEN c.fulfillment IN ('stock', 'supplier') THEN c.fulfillment END,
          CASE WHEN ${supplier} THEN ? END
        FROM manual_purchase_claims c WHERE c.token_hash = ? AND c.claimed_by = ? AND c.order_id IS NULL`, me, me, p.supplierDeadlineAt ?? null, h, me),
      this.q(`UPDATE manual_purchase_claims SET order_id = (SELECT MAX(id) FROM orders)
        WHERE token_hash = ? AND claimed_by = ? AND order_id IS NULL`, h, me),
      // the reserved account of a stock link now knows its order (it turns «delivered» when the message is sent)
      this.q(`UPDATE stock_accounts SET order_id = (SELECT order_id FROM manual_purchase_claims WHERE token_hash = ?),
        updated_at = datetime('now', '+03:30')
        WHERE id = (SELECT stock_account_id FROM manual_purchase_claims WHERE token_hash = ? AND claimed_by = ?)
          AND status = 'reserved' AND order_id IS NULL AND changes() = 1`, h, h, me),
      this.q('SELECT * FROM manual_purchase_claims WHERE token_hash = ?', h),
    ]);
    const claim = rs[5].results[0];
    if (!claim) return { outcome: 'invalid', order: null, claim: null };
    const order = claim.order_id ? (await this.getOrderById(claim.order_id)) ?? null : null;
    const info = { fulfillment: claim.fulfillment ?? null, stock_account_id: claim.stock_account_id ?? null, approved_by: claim.approved_by };
    if (rs[0].meta.changes === 1) return { outcome: 'claimed', order, claim: info };
    return { outcome: claim.claimed_by === me ? 'already_claimed' : 'claimed_by_other', order, claim: info };
  }

  async deletePendingOrder(id: number) {
    const r = await this.q("DELETE FROM orders WHERE id = ? AND status = 'pending'", id).run();
    return { changes: r.meta.changes };
  }

  async decideOrder(id: number, { status, decidedBy, rejectReason }: { status: string; decidedBy: number; rejectReason?: string | null }) {
    const r = await this.q(`
    UPDATE orders
    SET    status = ?, decided_at = datetime('now', '+03:30'), decided_by = ?, reject_reason = ?
    WHERE  id = ? AND status = 'pending'
  `, status, decidedBy, rejectReason ?? null, id).run();
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

  /**
   * The same conditional UPDATE as markOrderDelivered, as a statement for a batch and with the time given by the
   * caller (`now` = 'YYYY-MM-DD HH:MM:SS' Tehran), so the clocks follow the app's clock.
   */
  markDeliveredStatement(id: number, now: string, onlyFulfillment?: string): Stmt {
    return this.q(`
    UPDATE orders
    SET    status       = 'delivered',
           delivered_at = ?,
           expires_at   = CASE WHEN duration_days IS NOT NULL THEN datetime(?, '+' || duration_days || ' days') END,
           warranty_expires_at = CASE WHEN warranty_days IS NOT NULL THEN datetime(?, '+' || warranty_days || ' days') END
    WHERE  id = ? AND status = 'confirmed'${onlyFulfillment ? ' AND fulfillment = ?' : ''}
  `, now, now, now, id, ...(onlyFulfillment ? [onlyFulfillment] : []));
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

  /** Orders the customer is still waiting on (pending / confirmed), recently rejected ones, and delivered ones — one batch. */
  async getCustomerOrderOverview(telegramId: number): Promise<{ inProgress: Order[]; rejected: Order[]; delivered: Order[] }> {
    const [a, b, c] = await this.db.batch([
      this.q("SELECT * FROM orders WHERE customer_telegram_id = ? AND status IN ('pending', 'confirmed') ORDER BY id DESC LIMIT 10", telegramId),
      this.q("SELECT * FROM orders WHERE customer_telegram_id = ? AND status = 'rejected' AND decided_at >= datetime('now', '+03:30', '-7 days') ORDER BY id DESC LIMIT 5", telegramId),
      this.q("SELECT * FROM orders WHERE customer_telegram_id = ? AND status = 'delivered' ORDER BY delivered_at DESC", telegramId),
    ]);
    return { inProgress: a.results as Order[], rejected: b.results as Order[], delivered: c.results as Order[] };
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

  async createDiscountCode(p: {
    code: string; customerProductId: number; discountType: string; discountValue: number; maxUses: number | null; expiresAt: string;
    ownerTelegramId?: number | null; source?: 'admin' | 'referral'; productGroupId?: number | null;
    /** round 4 (§6): local Tehran start time; omitted/null = active at once (referral codes keep NULL) */
    startsAt?: string | null;
  }) {
    const r = await this.q(`
    INSERT INTO discount_codes
      (code, customer_product_id, discount_type, discount_value, max_uses, expires_at, owner_telegram_id, source, product_group_id, starts_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, p.code.toUpperCase(), p.customerProductId, p.discountType, p.discountValue, p.maxUses ?? null, p.expiresAt,
      p.ownerTelegramId ?? null, p.source ?? 'admin', p.productGroupId ?? null, p.startsAt ?? null).run();
    return { lastInsertRowid: r.meta.last_row_id };
  }

  /** round 4 (§8): orders and revenue that used this code (confirmed / delivered only) */
  async getDiscountCodeRevenue(id: number): Promise<{ n: number; sum: number }> {
    return (await this.q(DISCOUNT_REVENUE_SQL, id).first<{ n: number; sum: number }>())!;
  }

  async setDiscountCodeStart(id: number, startsAt: string | null) {
    const r = await this.q('UPDATE discount_codes SET starts_at = ? WHERE id = ?', startsAt, id).run();
    return { changes: r.meta.changes };
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
      // referral reward codes are personal; they stay out of the admin's list
      return (await this.q("SELECT * FROM discount_codes WHERE source = 'admin' ORDER BY id DESC").all<DiscountCode>()).results;
    } catch (err: any) {
      console.error('❌ [DB] getAllDiscountCodes failed:', err.message);
      return [];
    }
  }

  async updateDiscountCodeDetails(id: number, p: {
    discountType: string; discountValue: number; customerProductId: number; maxUses: number | null; productGroupId?: number | null;
  }) {
    const r = await this.q(`
    UPDATE discount_codes
    SET    discount_type = ?, discount_value = ?, customer_product_id = ?, max_uses = ?, product_group_id = ?
    WHERE  id = ?
  `, p.discountType, p.discountValue, p.customerProductId, p.maxUses ?? null, p.productGroupId ?? null, id).run();
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

  // ─── Checkout drafts (round 4, §4) ───────────────────────────────────────
  async upsertCheckoutDraft(p: { customerId: number; productId: number; productName: string; price: number; createdAt: string }): Promise<void> {
    await this.q(
      `INSERT INTO checkout_drafts (customer_telegram_id, product_id, product_name, price, created_at, reminded) VALUES (?, ?, ?, ?, ?, 0)
       ON CONFLICT(customer_telegram_id) DO UPDATE SET product_id = excluded.product_id, product_name = excluded.product_name, price = excluded.price, created_at = excluded.created_at, reminded = 0`,
      p.customerId, p.productId, p.productName, p.price, p.createdAt,
    ).run();
  }

  async deleteCheckoutDraft(customerId: number): Promise<void> {
    await this.q('DELETE FROM checkout_drafts WHERE customer_telegram_id = ?', customerId).run();
  }

  async getDueCheckoutDrafts(olderThan: string, notOlderThan: string, limit: number): Promise<CheckoutDraft[]> {
    return (await this.q(DUE_DRAFTS_SQL, olderThan, notOlderThan, limit).all<CheckoutDraft>()).results;
  }

  async hasOrderSince(customerId: number, since: string): Promise<boolean> {
    return !!(await this.q(HAS_ORDER_SINCE_SQL, customerId, since, since).first());
  }

  /** Marks the drafts reminded BEFORE the send and returns the ids this caller really got (a missed reminder beats a doubled one). */
  async claimDraftsForReminder(customerIds: number[]): Promise<number[]> {
    if (!customerIds.length) return [];
    const r = await this.q(CLAIM_DRAFTS_SQL_PREFIX + customerIds.map(() => '?').join(',') + ') RETURNING customer_telegram_id', ...customerIds).all<{ customer_telegram_id: number }>();
    return r.results.map((x) => x.customer_telegram_id);
  }

  async deleteCheckoutDrafts(customerIds: number[]): Promise<void> {
    if (!customerIds.length) return;
    await this.q('DELETE FROM checkout_drafts WHERE customer_telegram_id IN (' + customerIds.map(() => '?').join(',') + ')', ...customerIds).run();
  }

  async purgeCheckoutDraftsBefore(cutoff: string): Promise<void> {
    await this.q(PURGE_DRAFTS_SQL, cutoff).run();
  }

  /** round 4 (§3): first touch only */
  async setCustomerSource(telegramId: number, source: string): Promise<void> {
    await this.q('UPDATE customers SET source = ? WHERE telegram_id = ? AND source IS NULL', source, telegramId).run();
  }

  // ─── Referrals ───────────────────────────────────────────────────────────
  async getRefCode(telegramId: number): Promise<string | null> {
    return (await this.q('SELECT ref_code FROM customers WHERE telegram_id = ?', telegramId).first<{ ref_code: string | null }>())?.ref_code ?? null;
  }

  /** true when the code was stored (false: customer missing, already has a code, or the code collided) */
  async setRefCode(telegramId: number, code: string): Promise<boolean> {
    try {
      const r = await this.q('UPDATE customers SET ref_code = ? WHERE telegram_id = ? AND ref_code IS NULL', code, telegramId).run();
      return r.meta.changes === 1;
    } catch {
      return false; // unique collision
    }
  }

  async findCustomerByRefCode(code: string): Promise<number | null> {
    return (await this.q('SELECT telegram_id FROM customers WHERE ref_code = ?', code).first<{ telegram_id: number }>())?.telegram_id ?? null;
  }

  /** true = a new referral row (the invitee had no inviter yet) */
  async insertReferral(referrerId: number, inviteeId: number): Promise<boolean> {
    const r = await this.q('INSERT INTO referrals (referrer_telegram_id, invitee_telegram_id) VALUES (?, ?) ON CONFLICT(invitee_telegram_id) DO NOTHING', referrerId, inviteeId).run();
    return r.meta.changes === 1;
  }

  async getReferralByInvitee(inviteeId: number): Promise<{ id: number; referrer_telegram_id: number; qualified_at: string | null } | null> {
    return this.q('SELECT id, referrer_telegram_id, qualified_at FROM referrals WHERE invitee_telegram_id = ?', inviteeId).first();
  }

  /** `inviteeGift`: stamps the gift eligibility in the same statement (round 4, §2: never retroactive) */
  async qualifyReferral(id: number, orderId: number, inviteeGift = false): Promise<boolean> {
    const r = await this.q(
      "UPDATE referrals SET qualified_at = datetime('now', '+03:30'), qualifying_order_id = ?, invitee_reward_eligible = ? WHERE id = ? AND qualified_at IS NULL",
      orderId, inviteeGift ? 1 : 0, id,
    ).run();
    return r.meta.changes === 1;
  }

  /** the gift was switched off: rows waiting for it are no longer owed one */
  async clearPendingInviteeGifts(): Promise<void> {
    await this.q('UPDATE referrals SET invitee_reward_eligible = 0 WHERE invitee_reward_eligible = 1 AND invitee_reward_order_id IS NULL').run();
  }

  async getInviteeGiftTarget(referralId: number): Promise<number | null> {
    return (await this.q('SELECT invitee_telegram_id FROM referrals WHERE id = ? AND invitee_reward_eligible = 1 AND invitee_reward_order_id IS NULL', referralId).first<{ invitee_telegram_id: number }>())?.invitee_telegram_id ?? null;
  }

  /** atomic claim: true = this caller issues the gift */
  async claimInviteeGift(referralId: number): Promise<boolean> {
    const r = await this.q('UPDATE referrals SET invitee_reward_order_id = -1 WHERE id = ? AND invitee_reward_eligible = 1 AND invitee_reward_order_id IS NULL', referralId).run();
    return r.meta.changes === 1;
  }

  /**
   * The free order and the record of its id in ONE batch (one D1 transaction), so a claim can never hold an order the row doesn't know.
   * Returns the new order id.
   */
  async issueInviteeGiftOrder(referralId: number, p: { customerTelegramId: number; product: CustomerProduct }): Promise<number> {
    const rs = await this.db.batch([
      this.rewardOrderStmt(p),
      this.q('UPDATE referrals SET invitee_reward_order_id = last_insert_rowid() WHERE id = ? AND invitee_reward_order_id = -1', referralId),
    ]);
    return rs[0].meta.last_row_id;
  }

  async getPendingInviteeGiftIds(limit: number): Promise<number[]> {
    return (await this.q(PENDING_GIFTS_SQL, limit).all<{ id: number }>()).results.map((r) => r.id);
  }

  /**
   * A claim older than an hour (by qualified_at) that never finished: if the free order exists it is linked, otherwise the claim is released.
   * Never releases a claim whose order exists, so the sweep can't issue a second one.
   */
  async resetStuckInviteeGifts(giftProductId: number): Promise<void> {
    await this.q(LINK_GIFTS_SQL, giftProductId, giftProductId).run();
    await this.q(RESET_GIFTS_SQL, giftProductId).run();
  }

  async countUnrewardedReferrals(referrerId: number): Promise<number> {
    return (await this.q('SELECT COUNT(*) AS n FROM referrals WHERE referrer_telegram_id = ? AND qualified_at IS NOT NULL AND reward_id IS NULL', referrerId).first<{ n: number }>())!.n;
  }

  async getOldestUnrewardedReferralIds(referrerId: number, limit: number): Promise<number[]> {
    return (await this.q('SELECT id FROM referrals WHERE referrer_telegram_id = ? AND qualified_at IS NOT NULL AND reward_id IS NULL ORDER BY id LIMIT ?', referrerId, limit).all<{ id: number }>()).results.map((r) => r.id);
  }

  async hasLiveReward(referrerId: number): Promise<boolean> {
    return !!(await this.q("SELECT 1 FROM referral_rewards WHERE referrer_telegram_id = ? AND status IN ('pending', 'issued') LIMIT 1", referrerId).first());
  }

  async createReferralReward(referrerId: number, type: string, snapshot: string): Promise<number> {
    const r = await this.q('INSERT INTO referral_rewards (referrer_telegram_id, reward_type, config_snapshot) VALUES (?, ?, ?)', referrerId, type, snapshot).run();
    return r.meta.last_row_id;
  }

  /** Atomically takes these referrals for a reward; returns how many were really free. */
  async claimReferrals(ids: number[], rewardId: number): Promise<number> {
    if (!ids.length) return 0;
    const r = await this.q('UPDATE referrals SET reward_id = ? WHERE reward_id IS NULL AND id IN (' + ids.map(() => '?').join(',') + ')', rewardId, ...ids).run();
    return r.meta.changes;
  }

  async releaseReward(rewardId: number): Promise<void> {
    await this.db.batch([
      this.q('UPDATE referrals SET reward_id = NULL WHERE reward_id = ?', rewardId),
      this.q('DELETE FROM referral_rewards WHERE id = ?', rewardId),
    ]);
  }

  async finishReferralReward(id: number, status: 'issued' | 'failed', p: { discountCodeId?: number | null; orderId?: number | null } = {}): Promise<void> {
    await this.q("UPDATE referral_rewards SET status = ?, discount_code_id = ?, order_id = ?, issued_at = datetime('now', '+03:30') WHERE id = ?", status, p.discountCodeId ?? null, p.orderId ?? null, id).run();
  }

  /** A free-product reward: an already-confirmed 0-Toman order that follows the normal delivery flow. */
  async createRewardOrder(p: { customerTelegramId: number; product: CustomerProduct }): Promise<number> {
    return (await this.rewardOrderStmt(p).run()).meta.last_row_id;
  }

  /** the INSERT of a reward order, not yet run (so it can join a batch) */
  rewardOrderStmt(p: { customerTelegramId: number; product: CustomerProduct }) {
    return this.q(`
    INSERT INTO orders (customer_telegram_id, customer_product_id, product_name, price, purchase_source, status, decided_at, decided_by, duration_days, warranty_days, customer_username)
    VALUES (?, ?, ?, 0, 'manual', 'confirmed', datetime('now', '+03:30'), 0, ?, ?, (SELECT username FROM customers WHERE telegram_id = ?))
  `, p.customerTelegramId, p.product.id, p.product.name, p.product.duration_days || null, p.product.warranty_days || null, p.customerTelegramId);
  }

  /** Customer-facing numbers + the latest issued rewards, one batch. */
  async getReferralOverview(referrerId: number): Promise<{
    invited: number; qualified: number; unrewarded: number; rewarded: number;
    rewards: { reward_type: string; order_id: number | null; code: string | null; discount_type: string | null; discount_value: number | null; expires_at: string | null; used: number | null; product_name: string | null }[];
  }> {
    const [a, b] = await this.db.batch([
      this.q(`SELECT COUNT(*) AS invited,
                     COALESCE(SUM(CASE WHEN qualified_at IS NOT NULL THEN 1 ELSE 0 END), 0) AS qualified,
                     COALESCE(SUM(CASE WHEN qualified_at IS NOT NULL AND reward_id IS NULL THEN 1 ELSE 0 END), 0) AS unrewarded
              FROM referrals WHERE referrer_telegram_id = ?`, referrerId),
      this.q(`SELECT r.reward_type, r.order_id, d.code, d.discount_type, d.discount_value, d.expires_at,
                     (SELECT COUNT(*) FROM discount_code_redemptions x WHERE x.discount_code_id = d.id) AS used,
                     COALESCE(p.name, o.product_name) AS product_name
              FROM referral_rewards r
              LEFT JOIN discount_codes d ON d.id = r.discount_code_id
              LEFT JOIN customer_products p ON p.id = d.customer_product_id
              LEFT JOIN orders o ON o.id = r.order_id
              WHERE r.referrer_telegram_id = ? AND r.status = 'issued' ORDER BY r.id DESC LIMIT 5`, referrerId),
    ]);
    const row: any = a.results[0];
    return { invited: row.invited, qualified: row.qualified, unrewarded: row.unrewarded, rewarded: row.qualified - row.unrewarded, rewards: b.results as any };
  }

  /** Referrers with enough unspent qualified invites (cron sweep). One-time programs skip anyone already rewarded. */
  async getReferrersReadyForReward(required: number, repeatable: boolean, limit: number): Promise<number[]> {
    return (await this.q(
      `SELECT referrer_telegram_id FROM referrals
       WHERE qualified_at IS NOT NULL AND reward_id IS NULL
         AND (? = 1 OR NOT EXISTS (SELECT 1 FROM referral_rewards w WHERE w.referrer_telegram_id = referrals.referrer_telegram_id AND w.status IN ('pending', 'issued')))
       GROUP BY referrer_telegram_id HAVING COUNT(*) >= ? LIMIT ?`,
      repeatable ? 1 : 0, required, limit,
    ).all<{ referrer_telegram_id: number }>()).results.map((r) => r.referrer_telegram_id);
  }

  async getStalePendingRewards(limit: number): Promise<{ id: number; referrer_telegram_id: number }[]> {
    return (await this.q(
      "SELECT id, referrer_telegram_id FROM referral_rewards WHERE status = 'pending' AND created_at < datetime('now', '+03:30', '-10 minutes') LIMIT ?", limit,
    ).all<{ id: number; referrer_telegram_id: number }>()).results;
  }

  /** Admin panel numbers: totals + top referrers. */
  async getReferralAdminStats(): Promise<{ invited: number; qualified: number; rewards: number; top: { referrer_telegram_id: number; n: number; display_name: string | null }[] }> {
    const [a, b, c] = await this.db.batch([
      this.q('SELECT COUNT(*) AS invited, COALESCE(SUM(CASE WHEN qualified_at IS NOT NULL THEN 1 ELSE 0 END), 0) AS qualified FROM referrals'),
      this.q("SELECT COUNT(*) AS n FROM referral_rewards WHERE status = 'issued'"),
      this.q(`SELECT r.referrer_telegram_id, COUNT(*) AS n, c.display_name FROM referrals r
              LEFT JOIN customers c ON c.telegram_id = r.referrer_telegram_id
              WHERE r.qualified_at IS NOT NULL GROUP BY r.referrer_telegram_id ORDER BY n DESC, r.referrer_telegram_id LIMIT 5`),
    ]);
    const t: any = a.results[0];
    return { invited: t.invited, qualified: t.qualified, rewards: (b.results[0] as any).n, top: c.results as any };
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
    /** round 4 (§5): local Tehran time; the job waits until then. null/undefined = send now */
    sendAfter?: string | null;
  }): Promise<number> {
    const audience = p.audience ?? 'all';
    const total = await this.countAudience(audience);
    const r = await this.q(
      'INSERT INTO broadcast_jobs (admin_chat_id, text, entities, total, audience, reply_markup, send_after) VALUES (?, ?, ?, ?, ?, ?, ?)',
      p.adminChatId, p.text, p.entities?.length ? JSON.stringify(p.entities) : null, total, audience,
      p.replyMarkup ? JSON.stringify(p.replyMarkup) : null, p.sendAfter ?? null,
    ).run();
    return r.meta.last_row_id;
  }

  /** A scheduled job's audience may have changed since it was queued: count it again when it starts. */
  async recomputeBroadcastTotal(id: number, audience: string): Promise<number> {
    const total = await this.countAudience(audience);
    await this.q('UPDATE broadcast_jobs SET total = ? WHERE id = ?', total, id).run();
    return total;
  }

  async getDueSchedules(nowLocal: string): Promise<DueSchedule[]> {
    return (await this.q(DUE_SCHEDULES_SQL, nowLocal, nowLocal).all<DueSchedule>()).results;
  }

  /** a pending schedule whose window passed before it could start (status-guarded: true = this call closed it) */
  async expireSchedule(id: number): Promise<boolean> {
    return (await this.q("UPDATE price_schedules SET status = 'done', note = 'expired before start' WHERE id = ? AND status = 'pending'", id).run()).meta.changes === 1;
  }

  /**
   * claim + apply + close-if-unapplied in ONE batch (one transaction). Returns the `changes` of the first two, whether the third
   * closed the schedule, and the normal price the claim saw.
   */
  async startSchedule(sch: Pick<PriceSchedule, 'id' | 'product_id' | 'sale_price'>): Promise<{ claimed: number; applied: number; closed: number; normalPrice: number | null }> {
    const [a, b, c] = await this.db.batch([
      this.q(CLAIM_SCHEDULE_SQL, sch.product_id, sch.product_id, sch.id),
      this.q(APPLY_SALE_SQL, sch.sale_price, sch.product_id, sch.sale_price, sch.id),
      this.q(CLOSE_UNAPPLIED_SQL, 'not applied: product inactive, auto-priced or already at or below the sale price', sch.id, sch.product_id, sch.sale_price),
    ]);
    return { claimed: a.results.length, applied: b.meta.changes, closed: c.meta.changes, normalPrice: (a.results[0] as any)?.normal_price ?? null };
  }

  private revertStmt(sch: Pick<PriceSchedule, 'id' | 'product_id' | 'sale_price' | 'normal_price' | 'normal_compare_at'>) {
    return this.q(REVERT_SALE_SQL, sch.normal_price, sch.normal_compare_at ?? null, sch.product_id, sch.sale_price, sch.normal_price, sch.id);
  }

  /** the claimed schedule's sale could not be applied: close it with a reason (status-guarded) */
  async closeSchedule(id: number, note: string): Promise<void> {
    await this.q("UPDATE price_schedules SET status = 'done', note = ? WHERE id = ? AND status IN ('active', 'pending')", note, id).run();
  }

  /** guarded revert + finish in ONE batch. `reverted` = the product was still untouched and went back to the normal price. `finished` = this call ended the schedule. */
  async endSchedule(sch: Pick<PriceSchedule, 'id' | 'product_id' | 'sale_price' | 'normal_price' | 'normal_compare_at'>): Promise<{ reverted: number; finished: number }> {
    const [a, b] = await this.db.batch([
      this.revertStmt(sch),
      this.q(FINISH_SCHEDULE_SQL, sch.id),
    ]);
    return { reverted: a.meta.changes, finished: b.meta.changes };
  }

  /** the product's pending or active schedule (at most one: creation is guarded) */
  async getOpenSchedule(productId: number): Promise<PriceSchedule | null> {
    return (await this.q("SELECT * FROM price_schedules WHERE product_id = ? AND status IN ('pending', 'active') LIMIT 1", productId).first<PriceSchedule>()) ?? null;
  }

  async getScheduleById(id: number): Promise<(PriceSchedule & { product_name: string | null; current_price: number | null }) | null> {
    return (await this.q(`SELECT s.*, (SELECT name FROM customer_products WHERE id = s.product_id) AS product_name,
      (SELECT price FROM customer_products WHERE id = s.product_id) AS current_price FROM price_schedules s WHERE s.id = ?`, id).first<any>()) ?? null;
  }

  /** Inserts a pending schedule unless the product already has a pending/active one. true = inserted. */
  async createSchedule(p: { productId: number; salePrice: number; startsAt: string; endsAt: string }): Promise<boolean> {
    const r = await this.q(
      `INSERT INTO price_schedules (product_id, sale_price, starts_at, ends_at) SELECT ?, ?, ?, ?
       WHERE NOT EXISTS (SELECT 1 FROM price_schedules WHERE product_id = ? AND status IN ('pending', 'active'))`,
      p.productId, p.salePrice, p.startsAt, p.endsAt, p.productId).run();
    return r.meta.changes === 1;
  }

  /**
   * The admin's cancel. pending → cancelled. active → the guarded revert + cancelled in ONE batch.
   * 'gone' = the schedule is no longer pending/active (the cron or someone else got there first).
   */
  async cancelSchedule(sch: Pick<PriceSchedule, 'id' | 'product_id' | 'sale_price' | 'normal_price' | 'normal_compare_at' | 'status'>): Promise<'cancelled' | 'reverted' | 'not_reverted' | 'gone'> {
    if (sch.status === 'pending') {
      const r = await this.q("UPDATE price_schedules SET status = 'cancelled' WHERE id = ? AND status = 'pending'", sch.id).run();
      return r.meta.changes === 1 ? 'cancelled' : 'gone';
    }
    const [a, b] = await this.db.batch([
      this.revertStmt(sch),
      this.q("UPDATE price_schedules SET status = 'cancelled' WHERE id = ? AND status = 'active'", sch.id),
    ]);
    if (b.meta.changes !== 1) return 'gone';
    if (a.meta.changes !== 1) {
      await this.setScheduleNote(sch.id, 'price changed by hand; not reverted');
      return 'not_reverted';
    }
    return 'reverted';
  }

  async setScheduleNote(id: number, note: string): Promise<void> {
    await this.q('UPDATE price_schedules SET note = ? WHERE id = ?', note, id).run();
  }

  async getScheduledBroadcasts(nowLocal: string, limit: number): Promise<Pick<BroadcastJob, 'id' | 'text' | 'audience' | 'send_after'>[]> {
    return (await this.q(SCHEDULED_BROADCASTS_SQL, nowLocal, limit).all<Pick<BroadcastJob, 'id' | 'text' | 'audience' | 'send_after'>>()).results;
  }

  /** true = cancelled; false = already started (or not a scheduled job) */
  async cancelScheduledBroadcast(id: number, nowLocal: string): Promise<boolean> {
    // a job whose time has come may already be sending its first batch (the cursor moves only after it): not cancellable
    const r = await this.q(
      "UPDATE broadcast_jobs SET cancelled = 1, status = 'done', finished_at = datetime('now', '+03:30') WHERE id = ? AND status = 'running' AND cursor_customer_id = 0 AND send_after IS NOT NULL AND send_after > ?",
      id, nowLocal,
    ).run();
    return r.meta.changes === 1;
  }

  /** The oldest job that is due: immediate, or scheduled for a time that has come. Future jobs never block it. */
  async getRunningBroadcast(nowLocal: string): Promise<BroadcastJob | undefined> {
    const row: any = await this.q(RUNNING_BROADCAST_SQL, nowLocal).first();
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

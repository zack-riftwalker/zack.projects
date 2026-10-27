import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FakeD1 } from '../helpers/fakeD1';

const DIR = join(process.cwd(), 'migrations', 'store');
const file = (name: string) => readFileSync(join(DIR, name), 'utf8');

/** Shape of the store before round 3: 0001 + 0002 only, then rows that point at orders. */
function legacyStore(): FakeD1 {
  const f = new FakeD1();
  f.applyMigration(file('0001_init.sql'));
  f.applyMigration(file('0002_features.sql'));
  f.sqlite.exec(`
    INSERT INTO customers (id, telegram_id, display_name, ref_code) VALUES (1, 111, 'Ali', 'REF1');
    INSERT INTO customer_products (id, name, price, duration_days, warranty_days) VALUES (3, 'GPT', 500000, 30, 7);
    INSERT INTO discount_codes (id, code, customer_product_id, discount_type, discount_value, expires_at)
      VALUES (4, 'SUMMER', 3, 'percent', 20, '2099-01-01 00:00:00');
    INSERT INTO orders (id, customer_telegram_id, customer_product_id, product_name, price, receipt_file_id, receipt_type,
                        status, decided_at, decided_by, discount_code_id, duration_days, warranty_days, delivered_at,
                        expires_at, reject_reason, receipt_unique_id, reminded_3d, last_warranty_claim_at)
      VALUES
        (10, 111, 3, 'GPT', 400000, 'f1', 'photo', 'pending',   NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'u-10', 0, NULL),
        (11, 111, 3, 'GPT', 400000, 'f2', 'photo', 'confirmed', '2026-01-02 10:00:00', 1001, 4, 30, 7, NULL, NULL, NULL, 'u-11', 0, NULL),
        (12, 111, 3, 'GPT', 500000, 'f3', 'photo', 'rejected',  '2026-01-03 10:00:00', 1001, NULL, NULL, NULL, NULL, NULL, 'blurry', 'u-12', 0, NULL),
        (13, 111, 3, 'GPT', 500000, 'f4', 'document', 'delivered', '2026-01-04 10:00:00', 1001, NULL, 30, 7, '2026-01-04 11:00:00', '2026-02-03 11:00:00', NULL, 'u-13', 1, '2026-01-10 09:00:00');
    -- non-default values for every column the rebuild must carry over
    UPDATE orders SET purchase_source = 'manual', created_at = '2026-01-04 10:55:00', reminded_7d = 1, reminded_expired = 1,
                      stalled_alert_sent = 1, paid_failed_handled = 1, warranty_expires_at = '2026-01-11 11:00:00' WHERE id = 13;
    UPDATE orders SET created_at = '2026-01-02 09:00:00', stalled_alert_sent = 1, reminded_7d = 1 WHERE id = 11;
    UPDATE orders SET paid_failed_handled = 1, created_at = '2026-01-03 08:00:00' WHERE id = 12;
    INSERT INTO discount_code_redemptions (discount_code_id, customer_telegram_id, order_id) VALUES (4, 111, 11);
    INSERT INTO manual_purchase_claims (creation_key, token_hash, customer_product_id, product_name, price, duration_days, warranty_days, approved_by, status, claimed_by, claimed_at, order_id)
      VALUES ('k1', 'h1', 3, 'GPT', 500000, 30, 7, 1001, 'claimed', 111, '2026-01-04 10:59:00', 13);
  `);
  return f;
}

/** Every column the table had before round 3 (0001 + 0002), read from the schema so none can be forgotten. */
const oldColumns = (f: FakeD1): string => rows(f, "PRAGMA table_info('orders')").map((c) => c.name).join(', ');
const rows = (f: FakeD1, sql: string) => f.sqlite.prepare(sql).all() as any[];

describe('migration 0003 (supplier API): rebuilding orders keeps every row', () => {
  it('applies to a populated 0001+0002 database with every row, reference and foreign key intact', () => {
    const f = legacyStore();
    const columns = oldColumns(f);
    expect(columns).toContain('purchase_source');
    expect(columns).toContain('paid_failed_handled');
    const before = rows(f, `SELECT ${columns} FROM orders ORDER BY id`);
    // the seed uses non-default values, so a column the rebuild drops or resets would show up below
    expect(before.find((r) => r.id === 13)).toMatchObject({
      purchase_source: 'manual', created_at: '2026-01-04 10:55:00', reminded_7d: 1, reminded_expired: 1, stalled_alert_sent: 1, paid_failed_handled: 1,
    });
    expect(before.map((r) => r.status)).toEqual(['pending', 'confirmed', 'rejected', 'delivered']);

    f.applyMigration(file('0003_supplier.sql'));

    expect(rows(f, `SELECT ${columns} FROM orders ORDER BY id`)).toEqual(before);
    expect(rows(f, 'SELECT id, order_id FROM manual_purchase_claims')).toEqual([{ id: 1, order_id: 13 }]);
    expect(rows(f, 'SELECT discount_code_id, order_id FROM discount_code_redemptions')).toEqual([{ discount_code_id: 4, order_id: 11 }]);
    expect(rows(f, 'PRAGMA foreign_key_check')).toEqual([]);
  });

  it('keeps the four order indexes from before the rebuild', () => {
    const f = legacyStore();
    f.applyMigration(file('0003_supplier.sql'));
    const names = rows(f, "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'orders'").map((r) => r.name);
    for (const name of ['idx_orders_status_decided', 'idx_orders_status_expires', 'idx_orders_customer_status', 'idx_orders_receipt_unique']) {
      expect(names, name).toContain(name);
    }
  });

  it('accepts the new cancelled status and the new order columns default correctly', () => {
    const f = legacyStore();
    f.applyMigration(file('0003_supplier.sql'));
    f.sqlite.exec("UPDATE orders SET status = 'cancelled', cancelled_at = '2026-05-01 00:00:00', refund_status = 'pending' WHERE id = 10");
    expect(rows(f, 'SELECT status, refund_status, fulfillment, customer_username FROM orders WHERE id = 10')).toEqual([
      { status: 'cancelled', refund_status: 'pending', fulfillment: null, customer_username: null },
    ]);
    expect(() => f.sqlite.exec("UPDATE orders SET status = 'bogus' WHERE id = 10")).toThrow();
  });
});

describe('migration 0003: the AUTOINCREMENT counter of orders survives the rebuild', () => {
  it('an id that was handed out and then deleted (a rolled-back pending order) is not handed out again', () => {
    const f = legacyStore();
    // order 14 was created and removed again: the counter is 14 while the highest row is 13
    f.sqlite.exec(`INSERT INTO orders (id, customer_telegram_id, customer_product_id, product_name, price, status)
      VALUES (14, 111, 3, 'GPT', 1, 'pending'); DELETE FROM orders WHERE id = 14;`);
    expect(rows(f, "SELECT seq FROM sqlite_sequence WHERE name = 'orders'")).toEqual([{ seq: 14 }]);

    f.applyMigration(file('0003_supplier.sql'));

    expect(rows(f, "SELECT seq FROM sqlite_sequence WHERE name = 'orders'")).toEqual([{ seq: 14 }]);
    f.sqlite.exec("INSERT INTO orders (customer_telegram_id, customer_product_id, product_name, price) VALUES (111, 3, 'GPT', 1)");
    expect(rows(f, 'SELECT MAX(id) AS id FROM orders')).toEqual([{ id: 15 }]);
    expect(rows(f, "SELECT name FROM sqlite_master WHERE name = '_orders_seq'")).toEqual([]);
  });

  it('an emptied table keeps its counter too', () => {
    const f = legacyStore();
    f.sqlite.exec('DELETE FROM discount_code_redemptions; DELETE FROM manual_purchase_claims; DELETE FROM orders;');
    f.applyMigration(file('0003_supplier.sql'));
    f.sqlite.exec("INSERT INTO orders (customer_telegram_id, customer_product_id, product_name, price) VALUES (111, 3, 'GPT', 1)");
    expect(rows(f, 'SELECT MAX(id) AS id FROM orders')).toEqual([{ id: 14 }]);
  });

  it('a database that never had an order starts at 1', () => {
    const f = new FakeD1();
    f.applyMigration(file('0001_init.sql'));
    f.applyMigration(file('0002_features.sql'));
    f.applyMigration(file('0003_supplier.sql'));
    f.sqlite.exec("INSERT INTO customer_products (id, name, price) VALUES (3, 'GPT', 1)");
    f.sqlite.exec("INSERT INTO orders (customer_telegram_id, customer_product_id, product_name, price) VALUES (111, 3, 'GPT', 1)");
    expect(rows(f, 'SELECT MAX(id) AS id FROM orders')).toEqual([{ id: 1 }]);
  });
});

import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeD1 } from './helpers/fakeD1';

const ROOT = process.cwd();
const SCRIPT = join(ROOT, 'scripts', 'sqlite_to_d1.py');
const LEGACY = join(ROOT, 'legacy');
const py = (args: string[], env: Record<string, string> = {}) =>
  execFileSync('python3', ['-I', ...args], { env: { ...process.env, ...env }, encoding: 'utf8' });

function columns(f: FakeD1, table: string): string[] {
  return (f.sqlite.prepare(`PRAGMA table_info(${table})`).all() as any[]).map((r) => r.name);
}

describe('sqlite_to_d1.py target columns', () => {
  it('match the D1 migrations exactly (every table, same column set)', () => {
    const cols = JSON.parse(py([SCRIPT, '--print-columns']));
    const store = new FakeD1().migrate('store');
    const monshi = new FakeD1().migrate('monshi');
    for (const [table, c] of Object.entries<string[]>(cols.store)) expect(columns(store, table).sort(), 'store.' + table).toEqual([...c].sort());
    for (const [table, c] of Object.entries<string[]>(cols.monshi)) expect(columns(monshi, table).sort(), 'monshi.' + table).toEqual([...c].sort());
  });
});

describe.skipIf(!existsSync(join(LEGACY, 'store-bot', 'src', 'db', 'schema.sql')) || !existsSync(join(LEGACY, 'monshi-bot', 'db.py')))(
  'legacy data migration (needs legacy/)',
  () => {
    it('legacy-shaped databases import into D1 with correct values, NULL embeddings and a continuing id sequence', () => {
      const dir = mkdtempSync(join(tmpdir(), 'mig-'));
      try {
        const storeDb = join(dir, 'storefront.db');
        const monshiDb = join(dir, 'monshi.db');
        // --- legacy store DB: ALTER-TABLE-history shaped orders (different column order, no purchase_source…)
        py(['-c', `
import sqlite3, sys
con = sqlite3.connect(sys.argv[1])
schema = open(sys.argv[2], encoding='utf-8').read()
import re
# everything except the final orders table, which gets the OLD shape below
schema = re.sub(r'CREATE TABLE IF NOT EXISTS orders\\s*\\(.*?\\n\\);', '', schema, flags=re.S)
con.executescript(schema)
con.executescript("""
CREATE TABLE orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT, customer_telegram_id INTEGER NOT NULL, customer_product_id INTEGER NOT NULL,
  product_name TEXT NOT NULL, price REAL NOT NULL, receipt_file_id TEXT NOT NULL, receipt_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','rejected')),
  created_at TEXT NOT NULL DEFAULT (datetime('now','+03:30')), decided_at TEXT, decided_by INTEGER);
ALTER TABLE orders ADD COLUMN reminded_3d INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN duration_days INTEGER;
ALTER TABLE orders ADD COLUMN discount_code_id INTEGER;
""")
con.execute("INSERT INTO customers (id, telegram_id, display_name) VALUES (5, 111, 'Ali ''Q'' ✓')")
con.execute("INSERT INTO customer_products (id, name, price, terms_text, terms_entities, duration_days, warranty_days) VALUES (3, 'GPT', 500000, 'شرایط', '[{\\"type\\":\\"bold\\",\\"offset\\":0,\\"length\\":2}]', 30, 7)")
con.execute("INSERT INTO orders (id, customer_telegram_id, customer_product_id, product_name, price, receipt_file_id, receipt_type, status, reminded_3d, duration_days) VALUES (41, 111, 3, 'GPT', 500000, 'f1', 'photo', 'confirmed', 1, 30)")
con.execute("INSERT INTO store_settings (id, card_number, card_holder_name) VALUES (1, '6037123412341234', 'Ali')")
con.commit()
`, storeDb, join(LEGACY, 'store-bot', 'src', 'db', 'schema.sql')]);

        // --- legacy monshi DB created by the real legacy db.py
        py(['-c', `
import sys, sqlite3
sys.path.insert(0, sys.argv[2])
import db
db.init_db()
con = sqlite3.connect(sys.argv[1])
con.execute("INSERT INTO customers (chat_id, telegram_user_id, username, first_name, first_seen_at, last_message_at) VALUES (7001, 7001, 'cu', 'Cust', 'a', 'b')")
con.execute("INSERT INTO faqs (id, question, answer, keywords, embedding, created_at, updated_at) VALUES (9, 'q', 'a', 'k', X'0000803f', 'x', 'y')")
con.execute("INSERT INTO messages (chat_id, telegram_message_id, direction, message_type, text, received_at, answered_by, faq_id, business_connection_id) VALUES (7001, 1, 'in', 'text', 'hello ''x''', 't', 'faq', 9, 'bc1')")
con.execute("INSERT INTO orders (id, chat_id, title, status, external_order_id, created_at, updated_at) VALUES (12, 7001, 'T', 'paid', 41, 'c', 'u')")
con.execute("UPDATE settings SET value = 'custom {sales_bot}' WHERE key = 'greeting_message'")
con.commit()
`, monshiDb, join(LEGACY, 'monshi-bot')], { BOT_TOKEN: 'x', ADMIN_USER_ID: '1', DB_PATH: monshiDb });

        const out = join(dir, 'out');
        const log = py([SCRIPT, '--store', storeDb, '--monshi', monshiDb, '--out-dir', out]);
        expect(log).toContain('customers');

        const store = new FakeD1().migrate('store');
        store.sqlite.exec(readFileSync(join(out, 'store_data.sql'), 'utf8'));
        const monshi = new FakeD1().migrate('monshi');
        monshi.sqlite.exec(readFileSync(join(out, 'monshi_data.sql'), 'utf8'));

        const one = (f: FakeD1, sql: string) => f.sqlite.prepare(sql).get() as any;
        expect(one(store, 'SELECT * FROM customers')).toMatchObject({ id: 5, telegram_id: 111, display_name: "Ali 'Q' ✓" });
        expect(one(store, 'SELECT * FROM customer_products')).toMatchObject({ id: 3, name: 'GPT', price: 500000, duration_days: 30, warranty_days: 7, is_active: 1 });
        expect(JSON.parse(one(store, 'SELECT terms_entities t FROM customer_products').t)[0].type).toBe('bold');
        // missing legacy columns take their defaults, shared columns are mapped by NAME not position
        expect(one(store, 'SELECT * FROM orders')).toMatchObject({
          id: 41, customer_product_id: 3, status: 'confirmed', reminded_3d: 1, reminded_7d: 0, duration_days: 30,
          purchase_source: 'receipt', receipt_file_id: 'f1', receipt_type: 'photo', paid_failed_handled: 0, stalled_alert_sent: 0,
        });
        expect(one(store, 'SELECT card_number FROM store_settings').card_number).toBe('6037123412341234');
        // the next new order continues after the highest migrated id
        store.sqlite.prepare("INSERT INTO orders (customer_telegram_id, customer_product_id, product_name, price, receipt_file_id, receipt_type) VALUES (1, 3, 'x', 1, 'f', 'photo')").run();
        expect(one(store, 'SELECT MAX(id) m FROM orders').m).toBe(42);

        expect(one(monshi, 'SELECT * FROM customers')).toMatchObject({ chat_id: 7001, username: 'cu' });
        expect(one(monshi, 'SELECT id, embedding, hit_count FROM faqs')).toEqual({ id: 9, embedding: null, hit_count: 0 });
        expect(one(monshi, 'SELECT text, faq_id FROM messages')).toEqual({ text: "hello 'x'", faq_id: 9 });
        expect(one(monshi, 'SELECT external_order_id e FROM orders').e).toBe(41);
        expect(one(monshi, "SELECT value FROM settings WHERE key='embedding_version'").value).toBe('3-768');
        expect(one(monshi, "SELECT value FROM settings WHERE key='greeting_message'").value).toBe('custom {sales_bot}');
        expect(one(monshi, "SELECT value FROM settings WHERE key='business_hours'").value).toContain('"sat"');
        monshi.sqlite.prepare("INSERT INTO orders (chat_id, title) VALUES (1, 'n')").run();
        expect(one(monshi, 'SELECT MAX(id) m FROM orders').m).toBe(13);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  },
);

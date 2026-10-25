-- ============================================================
--  Round-3: supplier API, option groups, cancellation (see SUPPLIER_PLAN.md)
-- ============================================================
PRAGMA defer_foreign_keys = on;

-- ---- orders: rebuild to add status 'cancelled' + fulfillment columns ----
CREATE TABLE orders_new (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_telegram_id INTEGER NOT NULL,
    customer_product_id  INTEGER NOT NULL,
    product_name         TEXT    NOT NULL,
    price                REAL    NOT NULL,
    receipt_file_id      TEXT,
    receipt_type         TEXT    CHECK (receipt_type IN ('photo', 'document')),
    purchase_source      TEXT    NOT NULL DEFAULT 'receipt' CHECK (purchase_source IN ('receipt', 'manual')),
    status               TEXT    NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'rejected', 'delivered', 'cancelled')),
    created_at           TEXT    NOT NULL DEFAULT (datetime('now', '+03:30')),
    decided_at           TEXT,
    decided_by           INTEGER,
    discount_code_id     INTEGER,
    duration_days        INTEGER,
    warranty_days        INTEGER,
    delivered_at         TEXT,
    expires_at           TEXT,
    warranty_expires_at  TEXT,
    reminded_7d          INTEGER NOT NULL DEFAULT 0,
    reminded_3d          INTEGER NOT NULL DEFAULT 0,
    reminded_expired     INTEGER NOT NULL DEFAULT 0,
    stalled_alert_sent   INTEGER NOT NULL DEFAULT 0,
    last_warranty_claim_at TEXT,
    paid_failed_handled  INTEGER NOT NULL DEFAULT 0,
    reject_reason        TEXT,
    receipt_unique_id    TEXT,
    -- round 3
    customer_username    TEXT,                -- snapshot at order time (without '@'); NULL = none/unknown
    fulfillment          TEXT CHECK (fulfillment IN ('supplier', 'stock', 'manual_text', 'manual_outside')),  -- NULL = legacy path (monshi / manual link)
    needs_action_reason  TEXT,                -- NULL = nothing for the admin to decide (see §8.1 codes)
    needs_action_at      TEXT,
    supplier_deadline_at TEXT,                -- decided_at + 20 h; automatic retries stop after this
    cost_toman           INTEGER,             -- what we paid for this order (NULL = unknown)
    cancel_reason        TEXT,
    cancelled_at         TEXT,
    cancelled_by         INTEGER,
    refund_status        TEXT CHECK (refund_status IN ('pending', 'done', 'none')),
    refunded_at          TEXT,
    FOREIGN KEY (customer_product_id) REFERENCES customer_products(id),
    FOREIGN KEY (discount_code_id) REFERENCES discount_codes(id)
);
INSERT INTO orders_new (
    id, customer_telegram_id, customer_product_id, product_name, price, receipt_file_id, receipt_type,
    purchase_source, status, created_at, decided_at, decided_by, discount_code_id, duration_days, warranty_days,
    delivered_at, expires_at, warranty_expires_at, reminded_7d, reminded_3d, reminded_expired, stalled_alert_sent,
    last_warranty_claim_at, paid_failed_handled, reject_reason, receipt_unique_id)
SELECT
    id, customer_telegram_id, customer_product_id, product_name, price, receipt_file_id, receipt_type,
    purchase_source, status, created_at, decided_at, decided_by, discount_code_id, duration_days, warranty_days,
    delivered_at, expires_at, warranty_expires_at, reminded_7d, reminded_3d, reminded_expired, stalled_alert_sent,
    last_warranty_claim_at, paid_failed_handled, reject_reason, receipt_unique_id
FROM orders;
DROP TABLE orders;
ALTER TABLE orders_new RENAME TO orders;
CREATE INDEX IF NOT EXISTS idx_orders_status_decided  ON orders(status, decided_at);
CREATE INDEX IF NOT EXISTS idx_orders_status_expires  ON orders(status, expires_at);
CREATE INDEX IF NOT EXISTS idx_orders_customer_status ON orders(customer_telegram_id, status);
CREATE INDEX IF NOT EXISTS idx_orders_receipt_unique  ON orders(receipt_unique_id);
CREATE INDEX IF NOT EXISTS idx_orders_needs_action    ON orders(needs_action_at) WHERE needs_action_reason IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_status_cancelled ON orders(status, cancelled_at);

-- ---- customers / products / codes / claims ----
ALTER TABLE customers ADD COLUMN username TEXT;                         -- without '@'
CREATE INDEX IF NOT EXISTS idx_customers_username ON customers(username);

CREATE TABLE IF NOT EXISTS product_groups (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT    NOT NULL DEFAULT (datetime('now', '+03:30'))
);
ALTER TABLE customer_products ADD COLUMN group_id INTEGER REFERENCES product_groups(id);
ALTER TABLE customer_products ADD COLUMN option_label TEXT;               -- required when group_id is set
ALTER TABLE customer_products ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE customer_products ADD COLUMN pricing_mode TEXT NOT NULL DEFAULT 'manual';  -- 'manual' | 'auto'
ALTER TABLE customer_products ADD COLUMN markup_percent REAL;             -- NULL (with markup_fixed NULL) = use the default
ALTER TABLE customer_products ADD COLUMN markup_fixed INTEGER;            -- Toman
ALTER TABLE customer_products ADD COLUMN cost_toman INTEGER;              -- current cost from the active source; NULL = no source / unknown
ALTER TABLE customer_products ADD COLUMN stock_mode TEXT NOT NULL DEFAULT 'manual';    -- 'manual' | 'auto'
ALTER TABLE customer_products ADD COLUMN price_updated_at TEXT;
CREATE INDEX IF NOT EXISTS idx_products_group ON customer_products(group_id, is_active);

ALTER TABLE discount_codes ADD COLUMN product_group_id INTEGER;           -- set = valid for every option of the group

ALTER TABLE manual_purchase_claims ADD COLUMN fulfillment TEXT;           -- NULL/'outside' (as today) | 'stock' | 'supplier'
ALTER TABLE manual_purchase_claims ADD COLUMN stock_account_id INTEGER;

-- ---- suppliers ----
CREATE TABLE IF NOT EXISTS suppliers (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  kind             TEXT    NOT NULL CHECK (kind IN ('ariobox')),
  name             TEXT    NOT NULL,
  base_url         TEXT    NOT NULL,
  api_key          TEXT    NOT NULL,
  remote_user_id   INTEGER NOT NULL,
  is_enabled       INTEGER NOT NULL DEFAULT 1,
  last_sync_at     TEXT,
  last_sync_ok_at  TEXT,
  last_sync_error  TEXT,
  sync_alert_sent  INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT    NOT NULL DEFAULT (datetime('now', '+03:30'))
);

CREATE TABLE IF NOT EXISTS supplier_catalogs (
  supplier_id   INTEGER PRIMARY KEY REFERENCES suppliers(id),
  fetched_at    TEXT    NOT NULL,
  usd_toman     REAL    NOT NULL,
  items_json    TEXT    NOT NULL,     -- normalised items, see §4.2
  items_hash    TEXT    NOT NULL,     -- sha-256 of items_json + usd_toman
  applied_hash  TEXT                  -- = items_hash once every source/option is updated (§6.2)
);

CREATE TABLE IF NOT EXISTS product_sources (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_product_id INTEGER NOT NULL REFERENCES customer_products(id),
  supplier_id         INTEGER NOT NULL REFERENCES suppliers(id),
  remote_product_id   TEXT    NOT NULL,
  remote_variation_id TEXT    NOT NULL DEFAULT '',     -- '' = item has no variation
  remote_name         TEXT    NOT NULL,
  attributes_json     TEXT    NOT NULL DEFAULT '{}',
  price_usd           REAL,
  listed              INTEGER NOT NULL DEFAULT 1,      -- present in the last catalog
  oos_until           TEXT,                            -- set after a 409; treated as unavailable until then
  priority            INTEGER NOT NULL DEFAULT 1,      -- 1 = primary
  is_enabled          INTEGER NOT NULL DEFAULT 1,      -- admin switch
  created_at          TEXT    NOT NULL DEFAULT (datetime('now', '+03:30')),
  UNIQUE (customer_product_id, supplier_id, remote_product_id, remote_variation_id)
);
CREATE INDEX IF NOT EXISTS idx_sources_supplier ON product_sources(supplier_id, id);
CREATE INDEX IF NOT EXISTS idx_sources_product  ON product_sources(customer_product_id, priority);
CREATE INDEX IF NOT EXISTS idx_sources_remote   ON product_sources(supplier_id, remote_product_id, remote_variation_id);

CREATE TABLE IF NOT EXISTS supplier_orders (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  purpose             TEXT    NOT NULL CHECK (purpose IN ('customer', 'stock')),
  order_id            INTEGER,                 -- store order (purpose='customer')
  customer_product_id INTEGER,
  source_id           INTEGER,                 -- the source actually used (NULL while not chosen)
  forced_source_id    INTEGER,                 -- admin chose this source (skips enabled/loss checks)
  supplier_id         INTEGER,
  remote_product_id   TEXT,
  remote_variation_id TEXT,
  quantity            INTEGER NOT NULL DEFAULT 1,
  status              TEXT    NOT NULL DEFAULT 'queued'
                      CHECK (status IN ('queued', 'placing', 'placed', 'completed', 'failed', 'unknown', 'cancelled')),
  lease_until         TEXT,
  attempts            INTEGER NOT NULL DEFAULT 0,
  checks              INTEGER NOT NULL DEFAULT 0,
  next_attempt_at     TEXT,
  next_check_at       TEXT,
  remote_order_id     TEXT,
  remote_status       TEXT,
  price_usd           REAL,                    -- unit price we were charged (see Appendix A for unit/total)
  usd_toman           REAL,
  cost_toman          INTEGER,                 -- total, rounded
  last_http           INTEGER,
  last_error          TEXT,
  divert_to_stock     INTEGER NOT NULL DEFAULT 0,   -- customer order was resolved otherwise → accounts go to stock
  first_fail_notified INTEGER NOT NULL DEFAULT 0,
  requested_by        INTEGER NOT NULL DEFAULT 0,   -- admin telegram id, 0 = automatic
  raw_response        TEXT,                    -- last supplier JSON (cut to 4000 chars)
  created_at          TEXT    NOT NULL,
  placed_at           TEXT,
  completed_at        TEXT,
  updated_at          TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_so_queue  ON supplier_orders(status, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_so_poll   ON supplier_orders(status, next_check_at);
CREATE INDEX IF NOT EXISTS idx_so_lease  ON supplier_orders(status, lease_until);
CREATE INDEX IF NOT EXISTS idx_so_order  ON supplier_orders(order_id, id);

CREATE TABLE IF NOT EXISTS order_deliveries (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id          INTEGER NOT NULL,
  kind              TEXT    NOT NULL CHECK (kind IN ('supplier', 'stock', 'manual_text')),
  content_json      TEXT    NOT NULL,          -- §2.5
  supplier_order_id INTEGER,
  stock_account_id  INTEGER,
  sent_ok           INTEGER NOT NULL DEFAULT 0,
  send_error        TEXT,
  created_by        INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_deliveries_order ON order_deliveries(order_id, id);

CREATE TABLE IF NOT EXISTS fulfillment_events (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id          INTEGER,
  supplier_order_id INTEGER,
  batch_id          INTEGER,
  kind              TEXT    NOT NULL,          -- §2.6
  actor             INTEGER NOT NULL DEFAULT 0, -- admin telegram id, 0 = system
  detail            TEXT,                       -- short JSON or text, ≤ 500 chars
  created_at        TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_order ON fulfillment_events(order_id, id);
CREATE INDEX IF NOT EXISTS idx_events_so    ON fulfillment_events(supplier_order_id, id);

CREATE TABLE IF NOT EXISTS stock_batches (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_id           INTEGER,
  supplier_order_id     INTEGER,
  title                 TEXT    NOT NULL,
  quantity              INTEGER NOT NULL,
  unit_price_usd        REAL,
  usd_toman             REAL,
  cost_toman            INTEGER,              -- total
  reported_profit_toman INTEGER,              -- admin's free-form profit for the whole batch (overrides per-account)
  reported_at           TEXT,
  note                  TEXT,
  created_by            INTEGER NOT NULL DEFAULT 0,
  created_at            TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS stock_accounts (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id         INTEGER NOT NULL REFERENCES stock_batches(id),
  content_json     TEXT    NOT NULL,
  status           TEXT    NOT NULL DEFAULT 'available'
                   CHECK (status IN ('available', 'reserved', 'delivered', 'sold_outside', 'defective')),
  order_id         INTEGER,
  sold_price_toman INTEGER,
  sold_at          TEXT,
  note             TEXT,
  updated_at       TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_stock_batch  ON stock_accounts(batch_id, status);
CREATE INDEX IF NOT EXISTS idx_stock_status ON stock_accounts(status, id);
CREATE INDEX IF NOT EXISTS idx_stock_sold   ON stock_accounts(status, sold_at);

CREATE TABLE IF NOT EXISTS wallet_ledger (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_id       INTEGER NOT NULL,
  kind              TEXT    NOT NULL CHECK (kind IN ('topup', 'spend', 'refund', 'adjust')),
  amount_usd        REAL    NOT NULL,          -- + top-up / refund, − spend
  supplier_order_id INTEGER,
  note              TEXT,
  created_by        INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ledger_supplier ON wallet_ledger(supplier_id, id);

PRAGMA defer_foreign_keys = off;

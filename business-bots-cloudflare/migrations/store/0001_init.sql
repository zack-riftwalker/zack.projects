-- ============================================================
--  New Bot — Database Schema
--  This file is executed automatically on first run by database.js
-- ============================================================


-- ------------------------------------------------------------
--  TABLE: customers
--  Ordinary Telegram users who /start the bot. Minimal by design —
--  presence in this table alone means "known customer"; used as
--  the recipient list for the announcements broadcast and as the
--  origin of an order.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS customers (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id  INTEGER NOT NULL UNIQUE,
    display_name TEXT    NOT NULL,
    created_at   TEXT    NOT NULL DEFAULT (datetime('now', '+03:30'))
);


-- ------------------------------------------------------------
--  TABLE: customer_products
--  The customer-facing storefront catalog. Single customer-facing
--  price only, plus optional terms/conditions text shown before
--  purchase. duration_days/warranty_days drive the subscription
--  tracking + reminder system (both optional, independent of each
--  other).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS customer_products (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    name           TEXT    NOT NULL,
    price          REAL    NOT NULL,
    terms_text     TEXT,                                -- NULL/empty = no terms gate before purchase
    terms_entities TEXT,                                -- JSON array of Telegram MessageEntity, for preserving bold/italic/blockquote/etc. on redisplay
    duration_days  INTEGER,                             -- subscription length in days; NULL = not a subscription (no expiry/reminders)
    warranty_days  INTEGER,                             -- warranty length in days (independent of duration); NULL = no warranty
    is_active      INTEGER NOT NULL DEFAULT 1,
    created_at     TEXT    NOT NULL DEFAULT (datetime('now', '+03:30'))
);


-- ------------------------------------------------------------
--  TABLE: orders
--  One row per customer purchase. Receipt orders start pending and are
--  reviewed by an admin; manual orders are created as already delivered
--  when a customer redeems an admin-generated activation link.
--  Denormalized product_name/price so an order's snapshot survives
--  the catalog item later changing or being deactivated. No FK on
--  customer_telegram_id (deliberately loose) so an order always
--  records who paid even if the customers row is somehow missing.
--  discount_code_id records which code (if any) was redeemed for
--  this order — set at receipt time, only "spent" (recorded in
--  discount_code_redemptions) once the order is confirmed.
--  Lifecycle: pending → confirmed | rejected, then confirmed →
--  delivered (marked by the monshi bot over the bridge channel).
--  duration_days/warranty_days are snapshotted from the product at
--  confirm time (same reasoning as product_name/price); the expiry
--  dates are computed from delivered_at when delivery happens.
--  NOTE: the status CHECK below cannot be ALTERed on an existing DB —
--  database.js rebuilds the table if its CHECK predates 'delivered'.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS orders (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_telegram_id INTEGER NOT NULL,
    customer_product_id  INTEGER NOT NULL,
    product_name         TEXT    NOT NULL,
    price                REAL    NOT NULL,
    receipt_file_id      TEXT,
    receipt_type         TEXT    CHECK (receipt_type IN ('photo', 'document')),
    purchase_source      TEXT    NOT NULL DEFAULT 'receipt' CHECK (purchase_source IN ('receipt', 'manual')),
    status               TEXT    NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'rejected', 'delivered')),
    created_at           TEXT    NOT NULL DEFAULT (datetime('now', '+03:30')),
    decided_at           TEXT,                            -- NULL until an admin confirms/rejects
    decided_by           INTEGER,                          -- telegram_id of the deciding admin
    discount_code_id     INTEGER,                          -- NULL = no code used
    duration_days        INTEGER,                          -- subscription length snapshot from the product at confirm time
    warranty_days        INTEGER,                          -- warranty length snapshot from the product at confirm time
    delivered_at         TEXT,                             -- NULL until marked delivered
    expires_at           TEXT,                             -- delivered_at + duration_days; NULL = not a subscription
    warranty_expires_at  TEXT,                             -- delivered_at + warranty_days; NULL = no warranty
    reminded_7d          INTEGER NOT NULL DEFAULT 0,       -- "7 days left" reminder sent
    reminded_3d          INTEGER NOT NULL DEFAULT 0,       -- "3 days left" reminder sent
    reminded_expired     INTEGER NOT NULL DEFAULT 0,       -- post-expiry reminder sent
    stalled_alert_sent   INTEGER NOT NULL DEFAULT 0,       -- admins warned about >20h undelivered order
    last_warranty_claim_at TEXT,                           -- once-per-day spam guard for the warranty-claim button
    paid_failed_handled  INTEGER NOT NULL DEFAULT 0,       -- order_paid_failed fallback already processed (dedup for redelivered bridge events)

    FOREIGN KEY (customer_product_id) REFERENCES customer_products(id),
    FOREIGN KEY (discount_code_id) REFERENCES discount_codes(id)
);


-- ------------------------------------------------------------
--  TABLE: manual_purchase_claims
--  One one-time bearer link per purchase registered by an admin outside
--  the bot. Product terms and approval time are snapshotted immediately;
--  the customer/order are attached later when the link is redeemed.
--  Only a SHA-256 token hash is stored, never the raw link token.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS manual_purchase_claims (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    creation_key          TEXT    NOT NULL UNIQUE,
    token_hash            TEXT    NOT NULL UNIQUE,
    customer_product_id   INTEGER NOT NULL,
    product_name          TEXT    NOT NULL,
    price                 REAL    NOT NULL,
    duration_days         INTEGER,
    warranty_days         INTEGER,
    approved_by           INTEGER NOT NULL,
    approved_at           TEXT    NOT NULL DEFAULT (datetime('now', '+03:30')),
    status                TEXT    NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'claimed')),
    claimed_by            INTEGER,
    claimed_at            TEXT,
    order_id              INTEGER UNIQUE,

    FOREIGN KEY (customer_product_id) REFERENCES customer_products(id),
    FOREIGN KEY (order_id) REFERENCES orders(id)
);


-- ------------------------------------------------------------
--  TABLE: discount_codes
--  Admin-defined promo codes, each scoped to one customer_products
--  item. discount_value is a percent (1-100) or a flat Toman amount
--  depending on discount_type. expires_at is a 'YYYY-MM-DD HH:MM:SS'
--  local datetime string, directly comparable to
--  datetime('now', '+03:30'). max_uses NULL = unlimited (still
--  subject to the one-redemption-per-customer rule enforced via
--  discount_code_redemptions).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS discount_codes (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    code                 TEXT    NOT NULL UNIQUE,
    customer_product_id  INTEGER NOT NULL,
    discount_type        TEXT    NOT NULL CHECK (discount_type IN ('percent', 'fixed')),
    discount_value       REAL    NOT NULL,
    max_uses             INTEGER,                          -- NULL = unlimited total uses
    expires_at           TEXT    NOT NULL,
    is_active            INTEGER NOT NULL DEFAULT 1,
    created_at           TEXT    NOT NULL DEFAULT (datetime('now', '+03:30')),

    FOREIGN KEY (customer_product_id) REFERENCES customer_products(id)
);


-- ------------------------------------------------------------
--  TABLE: discount_code_redemptions
--  One row per customer who has redeemed a discount code — written
--  only when the linked order is CONFIRMED, so a rejected receipt
--  never consumes a customer's one-time use or the code's max_uses.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS discount_code_redemptions (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    discount_code_id      INTEGER NOT NULL,
    customer_telegram_id  INTEGER NOT NULL,
    order_id              INTEGER,
    redeemed_at           TEXT    NOT NULL DEFAULT (datetime('now', '+03:30')),

    FOREIGN KEY (discount_code_id) REFERENCES discount_codes(id),
    FOREIGN KEY (order_id) REFERENCES orders(id)
);


-- ------------------------------------------------------------
--  TABLE: store_settings
--  Single-row (id fixed to 1) global settings, currently just the
--  one payment card shown to customers after they accept a
--  product's terms. Absence of the row means "not configured yet".
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS store_settings (
    id                INTEGER PRIMARY KEY CHECK (id = 1),
    card_number       TEXT,   -- exactly 16 digits, no spaces/dashes
    card_holder_name  TEXT
);


-- ============================================================
--  Cloudflare additions
-- ============================================================
CREATE TABLE IF NOT EXISTS sessions (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS app_state (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT);
CREATE TABLE IF NOT EXISTS broadcast_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_chat_id INTEGER NOT NULL,
  text TEXT NOT NULL,
  entities TEXT,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','done')),
  cursor_customer_id INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL,
  sent INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','+03:30')),
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_broadcast_status       ON broadcast_jobs(status);
CREATE INDEX IF NOT EXISTS idx_orders_status_decided  ON orders(status, decided_at);
CREATE INDEX IF NOT EXISTS idx_orders_status_expires  ON orders(status, expires_at);
CREATE INDEX IF NOT EXISTS idx_orders_customer_status ON orders(customer_telegram_id, status);
CREATE INDEX IF NOT EXISTS idx_redemptions_code_cust  ON discount_code_redemptions(discount_code_id, customer_telegram_id);
CREATE INDEX IF NOT EXISTS idx_products_active        ON customer_products(is_active, id);

-- ============================================================
--  Round-2 features (see FEATURES_PLAN.md)
-- ============================================================

-- Out of stock ≠ deleted: is_active=0 hides a product, is_available=0 shows it as «ناموجود».
ALTER TABLE customer_products ADD COLUMN is_available INTEGER NOT NULL DEFAULT 1;

-- Receipt review: reject reason + duplicate-receipt detection.
ALTER TABLE orders ADD COLUMN reject_reason TEXT;
ALTER TABLE orders ADD COLUMN receipt_unique_id TEXT;

-- Discount codes that only one customer may use (referral rewards).
ALTER TABLE discount_codes ADD COLUMN owner_telegram_id INTEGER;
ALTER TABLE discount_codes ADD COLUMN source TEXT NOT NULL DEFAULT 'admin';   -- 'admin' | 'referral'

-- Personal referral code (generated lazily).
ALTER TABLE customers ADD COLUMN ref_code TEXT;

-- Broadcast audiences + an optional inline keyboard (JSON) on every message.
ALTER TABLE broadcast_jobs ADD COLUMN audience TEXT NOT NULL DEFAULT 'all';
ALTER TABLE broadcast_jobs ADD COLUMN reply_markup TEXT;

-- Generic key/value settings (referral program config lives under key 'referral').
CREATE TABLE IF NOT EXISTS store_kv (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now', '+03:30'))
);

-- «🔔 موجود شد خبرم کن»
CREATE TABLE IF NOT EXISTS product_waitlist (
  product_id           INTEGER NOT NULL,
  customer_telegram_id INTEGER NOT NULL,
  created_at           TEXT    NOT NULL DEFAULT (datetime('now', '+03:30')),
  PRIMARY KEY (product_id, customer_telegram_id)
);

-- One row per invited customer. invitee is UNIQUE: a person can be invited only once.
CREATE TABLE IF NOT EXISTS referrals (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  referrer_telegram_id INTEGER NOT NULL,
  invitee_telegram_id  INTEGER NOT NULL UNIQUE,
  created_at           TEXT    NOT NULL DEFAULT (datetime('now', '+03:30')),
  qualified_at         TEXT,              -- set when the invitee's first qualifying purchase is confirmed
  qualifying_order_id  INTEGER,
  reward_id            INTEGER            -- set when this referral was "spent" on a reward
);

CREATE TABLE IF NOT EXISTS referral_rewards (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  referrer_telegram_id INTEGER NOT NULL,
  status               TEXT    NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'issued', 'failed')),
  reward_type          TEXT    NOT NULL CHECK (reward_type IN ('discount', 'product')),
  discount_code_id     INTEGER,
  order_id             INTEGER,
  config_snapshot      TEXT    NOT NULL,  -- JSON of the referral config at grant time
  created_at           TEXT    NOT NULL DEFAULT (datetime('now', '+03:30')),
  issued_at            TEXT
);

CREATE INDEX IF NOT EXISTS idx_orders_receipt_unique   ON orders(receipt_unique_id);
CREATE INDEX IF NOT EXISTS idx_customers_created       ON customers(created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_ref_code ON customers(ref_code);
CREATE INDEX IF NOT EXISTS idx_discount_source         ON discount_codes(source, id);
CREATE INDEX IF NOT EXISTS idx_referrals_referrer      ON referrals(referrer_telegram_id, id);
CREATE INDEX IF NOT EXISTS idx_referrals_created       ON referrals(created_at);
CREATE INDEX IF NOT EXISTS idx_referrals_qualified     ON referrals(qualified_at);
CREATE INDEX IF NOT EXISTS idx_referrals_unrewarded    ON referrals(referrer_telegram_id) WHERE qualified_at IS NOT NULL AND reward_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_rewards_referrer        ON referral_rewards(referrer_telegram_id, id);
CREATE INDEX IF NOT EXISTS idx_waitlist_customer       ON product_waitlist(customer_telegram_id);

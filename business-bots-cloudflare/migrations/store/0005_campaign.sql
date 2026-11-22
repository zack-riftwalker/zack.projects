-- ============================================================
--  Round-4: Black Friday campaign features (see CAMPAIGN_PLAN.md)
-- ============================================================

-- §2 double-sided referral: the invitee's own free gift
ALTER TABLE referrals ADD COLUMN invitee_reward_eligible INTEGER NOT NULL DEFAULT 0; -- 1 = qualified while an invitee gift was configured
ALTER TABLE referrals ADD COLUMN invitee_reward_order_id INTEGER;                    -- NULL = not issued; -1 = claimed / being issued

-- §3 source links (?start=src_<name>): first touch only
ALTER TABLE customers ADD COLUMN source TEXT;

-- §4 abandoned checkout reminder
CREATE TABLE IF NOT EXISTS checkout_drafts (
  customer_telegram_id INTEGER PRIMARY KEY,
  product_id           INTEGER NOT NULL,
  product_name         TEXT    NOT NULL,
  price                REAL    NOT NULL,
  created_at           TEXT    NOT NULL,             -- local Tehran 'YYYY-MM-DD HH:MM:SS'
  reminded             INTEGER NOT NULL DEFAULT 0
);

-- §5 scheduled announcements
ALTER TABLE broadcast_jobs ADD COLUMN send_after TEXT;                    -- NULL = send now; local Tehran time
ALTER TABLE broadcast_jobs ADD COLUMN cancelled INTEGER NOT NULL DEFAULT 0; -- cancelled jobs are status 'done' + cancelled 1

-- §6 discount code start time
ALTER TABLE discount_codes ADD COLUMN starts_at TEXT;                     -- NULL = active immediately; local Tehran time

-- §9 compare-at price
ALTER TABLE customer_products ADD COLUMN compare_at_price INTEGER;        -- Toman; shown only when > price

CREATE INDEX IF NOT EXISTS idx_customers_source_created ON customers(source, created_at);
CREATE INDEX IF NOT EXISTS idx_drafts_due               ON checkout_drafts(reminded, created_at);
CREATE INDEX IF NOT EXISTS idx_orders_code_status       ON orders(discount_code_id, status);
CREATE INDEX IF NOT EXISTS idx_broadcast_status_after   ON broadcast_jobs(status, send_after);
CREATE INDEX IF NOT EXISTS idx_referrals_invitee_gift   ON referrals(invitee_reward_eligible, invitee_reward_order_id);

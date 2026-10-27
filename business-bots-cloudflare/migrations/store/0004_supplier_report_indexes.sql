-- Indexes for the profit lines of the sales report (SUPPLIER_PLAN.md §11): every range query is index-backed.
CREATE INDEX IF NOT EXISTS idx_ledger_kind_created ON wallet_ledger(kind, created_at);
CREATE INDEX IF NOT EXISTS idx_batches_created     ON stock_batches(created_at);
CREATE INDEX IF NOT EXISTS idx_batches_reported    ON stock_batches(reported_at);

-- ---- review fixes (SUPPLIER_PLAN.md §0 rule 7, §7.3, §7.5, §8.3, §14) ----
-- A delivery in flight holds this lease (a timestamp); every kind of delivery claims it before it sends (S2).
ALTER TABLE orders ADD COLUMN delivery_claimed_at TEXT;
-- A real counter of «completed without accounts» polls: a poll error or an in-progress answer doesn't reset it (N2).
ALTER TABLE supplier_orders ADD COLUMN empty_polls INTEGER NOT NULL DEFAULT 0;
-- The admin pressed «✅ بله» on the loss card for this very supplier order: only then the loss guard is skipped (S4).
ALTER TABLE supplier_orders ADD COLUMN loss_confirmed INTEGER NOT NULL DEFAULT 0;
-- The nonce of a direct-buy confirmation: one nonce can insert one supplier order, whatever the session says (S1).
ALTER TABLE supplier_orders ADD COLUMN buy_nonce TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_so_buy_nonce ON supplier_orders(buy_nonce) WHERE buy_nonce IS NOT NULL;
-- A stock delivery of a diverted supplier order is done exactly once; the row is marked, never re-diverted (B1).
ALTER TABLE order_deliveries ADD COLUMN diverted INTEGER NOT NULL DEFAULT 0;
-- Admin deliveries (stock / manual text) that did not fit the budget are sent by the cron (N3).
CREATE INDEX IF NOT EXISTS idx_deliveries_pending ON order_deliveries(created_at) WHERE sent_ok = 0 AND send_error IS NULL AND diverted = 0;
CREATE INDEX IF NOT EXISTS idx_deliveries_supplier_order ON order_deliveries(supplier_order_id);
-- stk_rel_ withdraws a manual link of a stock account (N5).
CREATE INDEX IF NOT EXISTS idx_claims_stock_account ON manual_purchase_claims(stock_account_id) WHERE stock_account_id IS NOT NULL;
-- one stock batch per supplier order (the divert claim looks for it) (B1)
CREATE INDEX IF NOT EXISTS idx_batches_supplier_order ON stock_batches(supplier_order_id) WHERE supplier_order_id IS NOT NULL;

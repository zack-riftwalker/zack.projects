-- Indexes for the profit lines of the sales report (SUPPLIER_PLAN.md §11): every range query is index-backed.
CREATE INDEX IF NOT EXISTS idx_ledger_kind_created ON wallet_ledger(kind, created_at);
CREATE INDEX IF NOT EXISTS idx_batches_created     ON stock_batches(created_at);
CREATE INDEX IF NOT EXISTS idx_batches_reported    ON stock_batches(reported_at);

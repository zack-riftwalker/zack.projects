-- round 6: scheduled sale prices (PRICE_SCHEDULE_PLAN.md)
CREATE TABLE IF NOT EXISTS price_schedules (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id   INTEGER NOT NULL,
  sale_price   INTEGER NOT NULL,              -- Toman
  normal_price INTEGER,                       -- the price it replaced; set when it starts
  starts_at    TEXT    NOT NULL,              -- local Tehran
  ends_at      TEXT    NOT NULL,              -- local Tehran
  status       TEXT    NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'done', 'cancelled')),
  note         TEXT,                          -- why it ended oddly (e.g. price changed by hand)
  created_at   TEXT    NOT NULL DEFAULT (datetime('now', '+03:30'))
);
CREATE INDEX IF NOT EXISTS idx_price_sched_start ON price_schedules(status, starts_at);
CREATE INDEX IF NOT EXISTS idx_price_sched_end   ON price_schedules(status, ends_at);
CREATE INDEX IF NOT EXISTS idx_price_sched_prod  ON price_schedules(product_id, status);

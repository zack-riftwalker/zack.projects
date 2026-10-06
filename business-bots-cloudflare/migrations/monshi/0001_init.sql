CREATE TABLE IF NOT EXISTS customers (
    chat_id            INTEGER PRIMARY KEY,
    telegram_user_id   INTEGER,
    username           TEXT,
    first_name         TEXT,
    first_seen_at      TEXT,
    last_message_at    TEXT,
    is_blocked         INTEGER DEFAULT 0,
    automation_paused_until TEXT,
    last_ack_sent_at   TEXT
);

CREATE TABLE IF NOT EXISTS messages (
    id                     INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id                INTEGER NOT NULL,
    telegram_message_id    INTEGER NOT NULL,
    direction              TEXT NOT NULL,          -- in / out / owner
    message_type           TEXT,
    text                   TEXT,
    received_at            TEXT,
    answered_by            TEXT DEFAULT 'none',    -- none / ack / faq / human / handoff
    faq_id                 INTEGER,
    business_connection_id TEXT,
    UNIQUE(business_connection_id, chat_id, telegram_message_id)
);

CREATE TABLE IF NOT EXISTS faqs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    question    TEXT NOT NULL,
    answer      TEXT NOT NULL,
    keywords    TEXT,
    enabled     INTEGER DEFAULT 1,
    priority    INTEGER DEFAULT 0,
    embedding   TEXT,
    hit_count   INTEGER DEFAULT 0,
    created_at  TEXT,
    updated_at  TEXT
);

CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT
);

CREATE TABLE IF NOT EXISTS unanswered (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id         INTEGER,
    text            TEXT,
    normalized_text TEXT,
    count           INTEGER DEFAULT 1,
    last_seen_at    TEXT,
    status          TEXT DEFAULT 'open'
);

CREATE TABLE IF NOT EXISTS connection (
    business_connection_id TEXT PRIMARY KEY,
    owner_user_id          INTEGER,
    is_enabled             INTEGER DEFAULT 1,
    updated_at             TEXT
);

CREATE TABLE IF NOT EXISTS reply_log (
    chat_id   INTEGER NOT NULL,
    reply_key TEXT NOT NULL,     -- 'faq:<id>' یا 'price_fallback'
    sent_at   TEXT,
    PRIMARY KEY (chat_id, reply_key)
);

CREATE TABLE IF NOT EXISTS orders (
    id                     INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id                INTEGER NOT NULL,
    title                  TEXT NOT NULL,
    status                 TEXT NOT NULL DEFAULT 'registered',
    checklist_message_id   INTEGER,
    business_connection_id TEXT,
    note                   TEXT,
    external_order_id      INTEGER,   -- آیدی سفارش در ربات فروشگاه (سفارش‌های رسیده از پل)؛ NULL = سفارش دستی
    created_at             TEXT,
    updated_at             TEXT
);

-- ============================================================
--  Cloudflare additions
-- ============================================================
CREATE TABLE IF NOT EXISTS sessions (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS app_state (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT);
CREATE INDEX IF NOT EXISTS idx_msg_chat_id            ON messages(chat_id, id);
CREATE INDEX IF NOT EXISTS idx_msg_dir_received       ON messages(direction, received_at);
CREATE INDEX IF NOT EXISTS idx_msg_faq_received       ON messages(faq_id, received_at);
CREATE INDEX IF NOT EXISTS idx_unans_status_norm      ON unanswered(status, normalized_text);
CREATE INDEX IF NOT EXISTS idx_unans_status_count     ON unanswered(status, count DESC, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_cust_paused            ON customers(automation_paused_until);
CREATE INDEX IF NOT EXISTS idx_cust_username          ON customers(username COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_cust_last_msg          ON customers(last_message_at);
CREATE INDEX IF NOT EXISTS idx_orders_external        ON orders(external_order_id);
CREATE INDEX IF NOT EXISTS idx_orders_chat_status     ON orders(chat_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_orders_status_created  ON orders(status, created_at);
CREATE INDEX IF NOT EXISTS idx_conn_enabled           ON connection(is_enabled, updated_at);

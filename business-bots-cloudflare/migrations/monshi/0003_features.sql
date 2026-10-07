-- Which customer message an unanswered entry came from (to find the owner's own reply later).
ALTER TABLE unanswered ADD COLUMN last_message_row_id INTEGER;

-- Maps a notification message in a staff chat to the customer it is about (reply-from-notification).
CREATE TABLE IF NOT EXISTS notify_links (
  recipient_chat_id     INTEGER NOT NULL,
  message_id            INTEGER NOT NULL,
  customer_chat_id      INTEGER NOT NULL,
  created_at            TEXT    NOT NULL,
  PRIMARY KEY (recipient_chat_id, message_id)
);
CREATE INDEX IF NOT EXISTS idx_notify_links_created ON notify_links(created_at);

INSERT OR IGNORE INTO settings (key, value) VALUES
  ('topics_enabled', '0'),
  ('reply_bridge_pause', '1');

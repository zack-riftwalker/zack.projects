-- Eitaa customers' access hashes (needed to message them); additive only.
CREATE TABLE IF NOT EXISTS eitaa_peers (
  user_id     INTEGER PRIMARY KEY,
  access_hash TEXT    NOT NULL,
  updated_at  TEXT    NOT NULL
);

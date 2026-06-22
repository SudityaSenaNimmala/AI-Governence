-- 004_discovered_apps.postgres.sql

CREATE TABLE IF NOT EXISTS discovered_apps (
  id              BIGSERIAL PRIMARY KEY,
  host            TEXT NOT NULL UNIQUE,
  wire_format     TEXT NOT NULL,
  first_seen_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  call_count      BIGINT NOT NULL DEFAULT 1,
  machine_count   INTEGER NOT NULL DEFAULT 1,
  sample_path     TEXT,
  sample_model    TEXT,
  promoted        BOOLEAN NOT NULL DEFAULT FALSE,
  promoted_at     TIMESTAMPTZ,
  promoted_to_id  TEXT
);
CREATE INDEX IF NOT EXISTS idx_discovered_last_seen ON discovered_apps(last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_discovered_promoted  ON discovered_apps(promoted, last_seen_at DESC);

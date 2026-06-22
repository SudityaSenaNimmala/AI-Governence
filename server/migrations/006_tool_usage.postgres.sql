-- 006_tool_usage.postgres.sql

CREATE TABLE IF NOT EXISTS tool_usage (
  machine_id      TEXT NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
  tool_key        TEXT NOT NULL,
  host            TEXT NOT NULL,
  vendor          TEXT,
  product         TEXT,
  category        TEXT,
  sandbox         TEXT,
  confidence      REAL,
  source          TEXT NOT NULL DEFAULT 'web_usage',
  first_used_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  hit_count       BIGINT NOT NULL DEFAULT 1,
  PRIMARY KEY (machine_id, tool_key)
);
CREATE INDEX IF NOT EXISTS idx_tool_usage_tool    ON tool_usage(tool_key, last_used_at DESC);
CREATE INDEX IF NOT EXISTS idx_tool_usage_machine ON tool_usage(machine_id, last_used_at DESC);

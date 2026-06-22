-- 007_ai_platforms.postgres.sql

CREATE TABLE IF NOT EXISTS ai_platforms (
  host             TEXT PRIMARY KEY,
  vendor           TEXT,
  product          TEXT,
  category         TEXT,
  sandbox          TEXT,
  governed         BOOLEAN NOT NULL DEFAULT TRUE,
  surface          TEXT NOT NULL DEFAULT 'browser',
  capture_mode     TEXT NOT NULL DEFAULT 'observe',
  governance_note  TEXT,
  pinned           BOOLEAN NOT NULL DEFAULT FALSE,
  source           TEXT NOT NULL DEFAULT 'admin',
  added_by         TEXT DEFAULT 'system',
  added_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ai_platforms_governed ON ai_platforms(governed, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_platforms_surface  ON ai_platforms(surface);
CREATE INDEX IF NOT EXISTS idx_ai_platforms_source   ON ai_platforms(source);

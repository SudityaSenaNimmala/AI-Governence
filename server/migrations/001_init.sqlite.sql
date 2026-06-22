-- 001_init.sqlite.sql
-- Initial schema for SQLite (dev / single-tenant)

CREATE TABLE IF NOT EXISTS machines (
  id              TEXT PRIMARY KEY,
  hostname        TEXT,
  user            TEXT,
  platform        TEXT,
  os_release      TEXT,
  first_seen      TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS scans (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  machine_id      TEXT NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
  agent_version   TEXT,
  started_at      TEXT NOT NULL,
  finished_at     TEXT NOT NULL,
  duration_ms     INTEGER,
  findings_count  INTEGER,
  errors_count    INTEGER,
  raw_json        TEXT NOT NULL,
  received_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_scans_machine ON scans(machine_id, received_at DESC);

CREATE TABLE IF NOT EXISTS findings (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  scan_id         INTEGER NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
  machine_id      TEXT NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
  detector        TEXT NOT NULL,
  type            TEXT NOT NULL,
  vendor          TEXT,
  product         TEXT,
  provider        TEXT,
  tool_key        TEXT,
  risk_score      INTEGER,
  payload_json    TEXT NOT NULL,
  detected_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_findings_scan ON findings(scan_id);
CREATE INDEX IF NOT EXISTS idx_findings_machine ON findings(machine_id);
CREATE INDEX IF NOT EXISTS idx_findings_tool ON findings(tool_key);
CREATE INDEX IF NOT EXISTS idx_findings_type ON findings(type);

CREATE TABLE IF NOT EXISTS sanctions (
  tool_key        TEXT PRIMARY KEY,
  vendor          TEXT,
  product         TEXT,
  status          TEXT NOT NULL CHECK (status IN ('approved','restricted','blocked','unknown')),
  notes           TEXT,
  owner           TEXT,
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS dlp_events (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  machine_id      TEXT REFERENCES machines(id) ON DELETE SET NULL,
  occurred_at     TEXT NOT NULL,
  source          TEXT NOT NULL,
  ai_service      TEXT NOT NULL,
  event_kind      TEXT NOT NULL,
  secret_class    TEXT,
  content_length  INTEGER,
  pattern_matched TEXT,
  metadata_json   TEXT,
  received_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_dlp_machine ON dlp_events(machine_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_dlp_service ON dlp_events(ai_service, occurred_at DESC);

-- Captured content (full prompt text or file bytes). 1:1 with dlp_events.
-- Added 2026-05-18 after the metadata-only architecture was reversed.
CREATE TABLE IF NOT EXISTS dlp_content (
  event_id      INTEGER PRIMARY KEY REFERENCES dlp_events(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL,             -- 'prompt' | 'file'
  mime_type     TEXT,
  filename      TEXT,
  byte_size     INTEGER,
  content_text  TEXT,                      -- prompts + text-readable files
  content_blob  BLOB,                      -- binary files
  truncated     INTEGER NOT NULL DEFAULT 0,
  received_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

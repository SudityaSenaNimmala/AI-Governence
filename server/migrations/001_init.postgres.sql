-- 001_init.postgres.sql
-- Initial schema for PostgreSQL (production)

CREATE TABLE IF NOT EXISTS machines (
  id              TEXT PRIMARY KEY,
  hostname        TEXT,
  "user"          TEXT,
  platform        TEXT,
  os_release      TEXT,
  first_seen      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS scans (
  id              BIGSERIAL PRIMARY KEY,
  machine_id      TEXT NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
  agent_version   TEXT,
  started_at      TIMESTAMPTZ NOT NULL,
  finished_at     TIMESTAMPTZ NOT NULL,
  duration_ms     INTEGER,
  findings_count  INTEGER,
  errors_count    INTEGER,
  raw_json        JSONB NOT NULL,
  received_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_scans_machine ON scans(machine_id, received_at DESC);

CREATE TABLE IF NOT EXISTS findings (
  id              BIGSERIAL PRIMARY KEY,
  scan_id         BIGINT NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
  machine_id      TEXT NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
  detector        TEXT NOT NULL,
  type            TEXT NOT NULL,
  vendor          TEXT,
  product         TEXT,
  provider        TEXT,
  tool_key        TEXT,
  risk_score      INTEGER,
  payload         JSONB NOT NULL,
  detected_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_findings_scan ON findings(scan_id);
CREATE INDEX IF NOT EXISTS idx_findings_machine ON findings(machine_id);
CREATE INDEX IF NOT EXISTS idx_findings_tool ON findings(tool_key);
CREATE INDEX IF NOT EXISTS idx_findings_type ON findings(type);
CREATE INDEX IF NOT EXISTS idx_findings_payload_gin ON findings USING GIN (payload);

CREATE TABLE IF NOT EXISTS sanctions (
  tool_key        TEXT PRIMARY KEY,
  vendor          TEXT,
  product         TEXT,
  status          TEXT NOT NULL CHECK (status IN ('approved','restricted','blocked','unknown')),
  notes           TEXT,
  owner           TEXT,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS dlp_events (
  id              BIGSERIAL PRIMARY KEY,
  machine_id      TEXT REFERENCES machines(id) ON DELETE SET NULL,
  occurred_at     TIMESTAMPTZ NOT NULL,
  source          TEXT NOT NULL,
  ai_service      TEXT NOT NULL,
  event_kind      TEXT NOT NULL,
  secret_class    TEXT,
  content_length  INTEGER,
  pattern_matched TEXT,
  metadata        JSONB,
  received_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_dlp_machine ON dlp_events(machine_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_dlp_service ON dlp_events(ai_service, occurred_at DESC);

-- Captured content (full prompt text or file bytes). 1:1 with dlp_events.
-- Added 2026-05-18 after the metadata-only architecture was reversed.
CREATE TABLE IF NOT EXISTS dlp_content (
  event_id      BIGINT PRIMARY KEY REFERENCES dlp_events(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL,
  mime_type     TEXT,
  filename      TEXT,
  byte_size     INTEGER,
  content_text  TEXT,
  content_blob  BYTEA,
  truncated     BOOLEAN NOT NULL DEFAULT FALSE,
  received_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

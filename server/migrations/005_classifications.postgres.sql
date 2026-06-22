-- 005_classifications.postgres.sql

CREATE TABLE IF NOT EXISTS runtime_classifications (
  host             TEXT PRIMARY KEY,
  is_ai            BOOLEAN NOT NULL,
  confidence       REAL,
  vendor           TEXT,
  category         TEXT,
  sandbox          TEXT,
  governance_note  TEXT,

  classifier       TEXT NOT NULL,
  classified_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  signals_json     JSONB,
  reasoning        TEXT,

  override_is_ai   BOOLEAN,
  override_by      TEXT,
  override_at      TIMESTAMPTZ,
  override_reason  TEXT,

  expires_at       TIMESTAMPTZ,

  hits             BIGINT NOT NULL DEFAULT 1,
  last_hit_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_classifications_is_ai   ON runtime_classifications(is_ai, classified_at DESC);
CREATE INDEX IF NOT EXISTS idx_classifications_expires ON runtime_classifications(expires_at);

CREATE TABLE IF NOT EXISTS classification_audit (
  id           BIGSERIAL PRIMARY KEY,
  host         TEXT NOT NULL,
  event        TEXT NOT NULL,
  occurred_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_ai        BOOLEAN,
  confidence   REAL,
  classifier   TEXT,
  actor        TEXT,
  details_json JSONB
);
CREATE INDEX IF NOT EXISTS idx_classification_audit_host ON classification_audit(host, occurred_at DESC);

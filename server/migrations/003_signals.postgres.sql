-- 003_signals.postgres.sql

CREATE TABLE IF NOT EXISTS server_agent_signals (
  id              BIGSERIAL PRIMARY KEY,
  machine_id      TEXT NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
  occurred_at     TIMESTAMPTZ NOT NULL,
  received_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  kind            TEXT NOT NULL,

  pid             INTEGER,
  uid             INTEGER,
  loginuid        INTEGER,
  "user"          TEXT,
  cmdline         TEXT,
  exe             TEXT,
  cwd             TEXT,
  trigger_source  TEXT,
  details_json    JSONB
);
CREATE INDEX IF NOT EXISTS idx_sas_machine ON server_agent_signals(machine_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_sas_kind    ON server_agent_signals(kind, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_sas_user    ON server_agent_signals("user", occurred_at DESC);

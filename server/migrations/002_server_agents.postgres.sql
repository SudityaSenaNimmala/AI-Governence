-- 002_server_agents.postgres.sql
-- Server-side AI agent governance (Tier 1) — Postgres variant.

CREATE TABLE IF NOT EXISTS server_agent_calls (
  id                   BIGSERIAL PRIMARY KEY,
  machine_id           TEXT NOT NULL REFERENCES machines(id) ON DELETE CASCADE,

  occurred_at          TIMESTAMPTZ NOT NULL,
  received_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  duration_ms          INTEGER,
  response_status      INTEGER,
  host                 TEXT NOT NULL,
  path                 TEXT,
  method               TEXT,
  provider             TEXT,
  model                TEXT,

  prompt_tokens        INTEGER,
  completion_tokens    INTEGER,
  cached_tokens        INTEGER,
  total_cost_usd       NUMERIC(12,6),
  input_cost_usd       NUMERIC(12,6),
  output_cost_usd      NUMERIC(12,6),
  cached_cost_usd      NUMERIC(12,6),
  pricing_version      TEXT,

  pid                  INTEGER,
  uid                  INTEGER,
  loginuid             INTEGER,
  "user"               TEXT,
  cmdline              TEXT,
  exe                  TEXT,
  cwd                  TEXT,
  trigger_source       TEXT,
  parent_chain_json    JSONB,

  prompt_text          TEXT,
  response_text        TEXT,
  response_truncated   BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_sac_machine     ON server_agent_calls(machine_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_sac_user        ON server_agent_calls("user", occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_sac_provider    ON server_agent_calls(provider, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_sac_model       ON server_agent_calls(model, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_sac_trigger     ON server_agent_calls(trigger_source, occurred_at DESC);

-- 002_server_agents.sqlite.sql
-- Server-side AI agent governance (Tier 1).
-- Each row is one observed LLM API call from an agent running on a managed
-- Linux server. Attribution + cost captured by the server-monitor daemon.

CREATE TABLE IF NOT EXISTS server_agent_calls (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  machine_id           TEXT NOT NULL REFERENCES machines(id) ON DELETE CASCADE,

  -- Time + provider
  occurred_at          TEXT NOT NULL,
  received_at          TEXT NOT NULL DEFAULT (datetime('now')),
  duration_ms          INTEGER,
  response_status      INTEGER,
  host                 TEXT NOT NULL,    -- api.openai.com, etc.
  path                 TEXT,             -- /v1/chat/completions
  method               TEXT,
  provider             TEXT,             -- openai | anthropic | google | aws-bedrock | openai-azure
  model                TEXT,             -- exact deployed id (e.g. claude-sonnet-4-6-20260101)

  -- Tokens + cost (USD)
  prompt_tokens        INTEGER,
  completion_tokens    INTEGER,
  cached_tokens        INTEGER,
  total_cost_usd       REAL,
  input_cost_usd       REAL,
  output_cost_usd      REAL,
  cached_cost_usd      REAL,
  pricing_version      TEXT,

  -- Attribution (from /proc/<pid>)
  pid                  INTEGER,
  uid                  INTEGER,
  loginuid             INTEGER,          -- real human; NULL if no human originator
  user                 TEXT,             -- resolved username
  cmdline              TEXT,             -- "python /opt/bots/triage.py --queue urgent"
  exe                  TEXT,             -- /opt/python/bin/python
  cwd                  TEXT,             -- /opt/bots
  trigger_source       TEXT,             -- interactive_shell | cron | systemd | ssh | ci | container
  parent_chain_json    TEXT,             -- JSON array of {pid, comm} up the chain

  -- Content for governance preview (per existing content-storage pattern)
  prompt_text          TEXT,
  response_text        TEXT,
  response_truncated   INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_sac_machine     ON server_agent_calls(machine_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_sac_user        ON server_agent_calls(user, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_sac_provider    ON server_agent_calls(provider, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_sac_model       ON server_agent_calls(model, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_sac_trigger     ON server_agent_calls(trigger_source, occurred_at DESC);

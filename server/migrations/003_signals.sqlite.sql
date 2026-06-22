-- 003_signals.sqlite.sql
-- Tier 2/3 signal events that don't have prompt/response content:
--   gpu_activity   — process is using a CUDA/ROCm device (from nvidia-smi watch)
--   model_load     — process opened a model weight file (from auditd)

CREATE TABLE IF NOT EXISTS server_agent_signals (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  machine_id      TEXT NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
  occurred_at     TEXT NOT NULL,
  received_at     TEXT NOT NULL DEFAULT (datetime('now')),
  kind            TEXT NOT NULL,    -- 'gpu_activity' | 'model_load'

  -- Attribution (from /proc lookup at signal emit time)
  pid             INTEGER,
  uid             INTEGER,
  loginuid        INTEGER,
  user            TEXT,
  cmdline         TEXT,
  exe             TEXT,
  cwd             TEXT,
  trigger_source  TEXT,

  -- Signal-specific fields. JSON keeps the schema flexible.
  --   gpu_activity: { gpu_name, used_memory_mb, gpu_index }
  --   model_load:   { path, action ('open'|'read'), file_class ('gguf'|'safetensors'|'bin'|'pt') }
  details_json    TEXT
);
CREATE INDEX IF NOT EXISTS idx_sas_machine ON server_agent_signals(machine_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_sas_kind    ON server_agent_signals(kind, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_sas_user    ON server_agent_signals(user, occurred_at DESC);

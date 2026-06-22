-- 004_discovered_apps.sqlite.sql
-- Hosts the agent caught making AI-shaped calls but that aren't in the
-- registry yet. Surfaces in the dashboard's Discovery tray so admins can
-- promote them to known apps.

CREATE TABLE IF NOT EXISTS discovered_apps (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  host            TEXT NOT NULL,
  wire_format     TEXT NOT NULL,        -- 'openai' | 'anthropic' | 'google' | 'ollama'
  first_seen_at   TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at    TEXT NOT NULL DEFAULT (datetime('now')),
  call_count      INTEGER NOT NULL DEFAULT 1,
  machine_count   INTEGER NOT NULL DEFAULT 1,
  sample_path     TEXT,                 -- one example request path for context
  sample_model    TEXT,                 -- one example model id seen in the body
  promoted        INTEGER NOT NULL DEFAULT 0,  -- 1 = admin marked it added to registry
  promoted_at     TEXT,
  promoted_to_id  TEXT,                 -- the registry app id once promoted
  UNIQUE(host)
);
CREATE INDEX IF NOT EXISTS idx_discovered_last_seen ON discovered_apps(last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_discovered_promoted  ON discovered_apps(promoted, last_seen_at DESC);

-- 006_tool_usage.sqlite.sql
-- Per-machine tool-usage tracker for AI tools surfaced by the LLM classifier
-- (and any other "user actually USED this tool" signal that doesn't go
-- through the scanner/findings path).
--
-- Why a separate table from `findings`:
--   - `findings` rows are tied to a scan_id (FK to scans). A scan represents
--     a moment in time when the agent enumerated installed apps. Usage of a
--     web tool isn't a scan — it's a runtime event.
--   - Different sources (LLM-classified browser visits, CLI invocations,
--     desktop-app launches) all want to land in the same shape so the Tools
--     catalog UNIONs both.
--
-- Primary key is (machine_id, tool_key) so a machine is counted once per
-- tool regardless of how many times the user opened it.

CREATE TABLE IF NOT EXISTS tool_usage (
  machine_id      TEXT NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
  tool_key        TEXT NOT NULL,        -- canonical identifier (we use the host for web tools)
  host            TEXT NOT NULL,
  vendor          TEXT,                 -- from classifier verdict ("Lovable", "Cognition AI")
  product         TEXT,                 -- usually same as vendor for single-product vendors
  category        TEXT,                 -- "chat-frontend" | "ide-assistant" | ...
  sandbox         TEXT,                 -- "local" | "remote" | "mixed" | "unknown"
  confidence      REAL,                 -- verdict confidence at time of first use
  source          TEXT NOT NULL DEFAULT 'web_usage',  -- web_usage | cli | desktop | proxy_capture
  first_used_at   TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at    TEXT NOT NULL DEFAULT (datetime('now')),
  hit_count       INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (machine_id, tool_key)
);
CREATE INDEX IF NOT EXISTS idx_tool_usage_tool    ON tool_usage(tool_key, last_used_at DESC);
CREATE INDEX IF NOT EXISTS idx_tool_usage_machine ON tool_usage(machine_id, last_used_at DESC);

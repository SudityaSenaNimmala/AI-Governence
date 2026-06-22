-- 007_ai_platforms.sqlite.sql
-- Admin-editable AI platforms registry — the SINGLE source of truth for
-- "which apps should the governance stack actively capture from?"
--
-- Before this table existed, the same information lived in three places:
--   1. agent/src/registry/ai-apps.json    — code-reviewed, ships with agent
--   2. KNOWN_SAAS_WITH_AI                  — hardcoded in fingerprint.js
--   3. content_scripts.matches             — hardcoded in manifest.json
--   4. runtime_classifications             — LLM-discovered, transient
--
-- Now: this table is the source of truth, populated initially from #1+#2+#3.
-- The LLM classifier (#4) can still auto-discover and POPULATE this table,
-- but admin edits in the dashboard are the canonical answer.
--
-- The browser extension + agent fetch this list periodically and govern
-- accordingly. Adding a row → captures kick in fleet-wide on next refresh.
-- Removing a row → governance stops for that host on next refresh.

CREATE TABLE IF NOT EXISTS ai_platforms (
  host             TEXT PRIMARY KEY,          -- canonical key, lowercased, no protocol/port
  vendor           TEXT,                      -- "OpenAI", "Anthropic", "Lovable"
  product          TEXT,                      -- product name (often == vendor for single-product)
  category         TEXT,                      -- 'chat-frontend' | 'ide-assistant' | 'autonomous-agent' | 'api-platform' | 'local-runtime'
  sandbox          TEXT,                      -- 'local' | 'remote' | 'mixed' | 'unknown'

  -- Capture policy:
  governed         INTEGER NOT NULL DEFAULT 1,  -- 1 = capture from this host. 0 = explicitly ignore.
  surface          TEXT NOT NULL DEFAULT 'browser', -- 'browser' | 'desktop' | 'cli' | 'all'
  capture_mode     TEXT NOT NULL DEFAULT 'observe', -- 'observe' (default) | 'block_critical' (future)

  -- Display + metadata:
  governance_note  TEXT,                      -- shown in dashboard / banner
  pinned           INTEGER NOT NULL DEFAULT 0, -- 1 = TLS-pinned (force socket bridge, no MITM)

  -- Provenance: where did this row come from?
  source           TEXT NOT NULL DEFAULT 'admin',
                                              -- 'admin'   — manually added in dashboard
                                              -- 'seed'    — auto-populated at install time
                                              -- 'classifier' — LLM auto-discovered
                                              -- 'allowlist' — extension SaaS allowlist
  added_by         TEXT DEFAULT 'system',
  added_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ai_platforms_governed ON ai_platforms(governed, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_platforms_surface  ON ai_platforms(surface);
CREATE INDEX IF NOT EXISTS idx_ai_platforms_source   ON ai_platforms(source);

-- 005_classifications.sqlite.sql
-- Runtime LLM-classification cache. Populated automatically when the
-- browser extension (or agent) hits an unrecognized host and asks
-- "is this an AI tool?" The verdict is shared across the whole tenant
-- so the LLM only gets called once per host.
--
-- The LLM never writes to the checked-in registry (agent/src/registry/
-- ai-apps.json); that file remains code-reviewed. This table is the
-- runtime equivalent — auto-populated, live across the fleet.

CREATE TABLE IF NOT EXISTS runtime_classifications (
  host             TEXT PRIMARY KEY,        -- e.g. "lovable.dev" or "api.replit.com"
  is_ai            INTEGER NOT NULL,        -- 1 = govern, 0 = ignore. Always reflects active policy
                                            -- (admin override applied if present, else LLM verdict).
  confidence       REAL,                    -- 0..1 from classifier
  vendor           TEXT,                    -- "Lovable", "Replit", null
  category         TEXT,                    -- "ide-assistant" | "autonomous-agent" | ...
  sandbox          TEXT,                    -- "local" | "remote" | "mixed"
  governance_note  TEXT,                    -- one-line caveat (e.g. "actions in vendor cloud invisible")

  -- Source: how was the verdict obtained?
  classifier       TEXT NOT NULL,           -- "llm:claude-haiku-4-5" | "stub:heuristic" | "manual"
  classified_at    TEXT NOT NULL DEFAULT (datetime('now')),

  -- Inputs the classifier saw — useful for audit and re-classification.
  signals_json     TEXT,                    -- { page_title, has_chat_input, body_shape, ... }
  reasoning        TEXT,                    -- LLM's one-line rationale

  -- Override (admin manually flipped the verdict).
  override_is_ai   INTEGER,                 -- NULL = no override; 0 or 1 forces is_ai
  override_by      TEXT,
  override_at      TEXT,
  override_reason  TEXT,

  -- TTL — sites add AI features over time, so re-classify periodically.
  expires_at       TEXT,

  -- Volume hint (set on each /classify-host call, used to prioritize re-check).
  hits             INTEGER NOT NULL DEFAULT 1,
  last_hit_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_classifications_is_ai   ON runtime_classifications(is_ai, classified_at DESC);
CREATE INDEX IF NOT EXISTS idx_classifications_expires ON runtime_classifications(expires_at);

-- Audit log — every classification decision, every override. Append-only.
-- Lets the CISO prove "at time T we treated host X as <AI/not-AI> because <reason>".
CREATE TABLE IF NOT EXISTS classification_audit (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  host         TEXT NOT NULL,
  event        TEXT NOT NULL,               -- "classified" | "override" | "expired" | "rechecked"
  occurred_at  TEXT NOT NULL DEFAULT (datetime('now')),
  is_ai        INTEGER,
  confidence   REAL,
  classifier   TEXT,
  actor        TEXT,                        -- "system" for LLM, user id for overrides
  details_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_classification_audit_host ON classification_audit(host, occurred_at DESC);

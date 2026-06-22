CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS oauth_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor VARCHAR(50) NOT NULL,
  client_id VARCHAR(255) NOT NULL,
  client_secret TEXT NOT NULL,
  tenant_id VARCHAR(255),
  redirect_uri TEXT,
  dataverse_env_url VARCHAR(500),
  azure_subscription_id VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  oauth_key_id UUID NOT NULL REFERENCES oauth_keys(id) ON DELETE CASCADE,
  vendor VARCHAR(50) NOT NULL,
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  token_type VARCHAR(50) DEFAULT 'Bearer',
  scope TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  type VARCHAR(50) NOT NULL, -- lifecycle, risk, connector, orphan, stale, custom
  severity VARCHAR(20) NOT NULL DEFAULT 'medium', -- critical, high, medium, low
  status VARCHAR(20) NOT NULL DEFAULT 'active', -- active, draft, disabled
  template VARCHAR(100),
  conditions JSONB NOT NULL DEFAULT '[]',
  actions JSONB NOT NULL DEFAULT '[]',
  scope JSONB NOT NULL DEFAULT '{"type":"all"}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS policy_violations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id UUID NOT NULL REFERENCES policies(id) ON DELETE CASCADE,
  agent_id VARCHAR(255) NOT NULL,
  agent_name VARCHAR(500),
  condition_triggered TEXT,
  action_taken VARCHAR(50),
  details JSONB,
  resolved BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS governance_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type VARCHAR(100) NOT NULL,
  agent_id VARCHAR(255),
  agent_name VARCHAR(500),
  actor VARCHAR(255),
  before_state JSONB,
  after_state JSONB,
  details TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tokens_oauth_key_id ON tokens(oauth_key_id);
CREATE INDEX IF NOT EXISTS idx_tokens_expires_at ON tokens(expires_at);
-- Add columns that may be missing from older table versions
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='oauth_keys' AND column_name='dataverse_env_url') THEN
    ALTER TABLE oauth_keys ADD COLUMN dataverse_env_url VARCHAR(500);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='oauth_keys' AND column_name='azure_subscription_id') THEN
    ALTER TABLE oauth_keys ADD COLUMN azure_subscription_id VARCHAR(255);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='oauth_keys' AND column_name='redirect_uri') THEN
    ALTER TABLE oauth_keys ADD COLUMN redirect_uri VARCHAR(500);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='oauth_keys' AND column_name='updated_at') THEN
    ALTER TABLE oauth_keys ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
  END IF;
  -- Google Workspace support: admin email for domain-wide delegation, GCP project ID for Vertex AI
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='oauth_keys' AND column_name='google_admin_email') THEN
    ALTER TABLE oauth_keys ADD COLUMN google_admin_email VARCHAR(255);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='oauth_keys' AND column_name='google_project_id') THEN
    ALTER TABLE oauth_keys ADD COLUMN google_project_id VARCHAR(255);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='oauth_keys' AND column_name='log_analytics_workspace_id') THEN
    ALTER TABLE oauth_keys ADD COLUMN log_analytics_workspace_id VARCHAR(255);
  END IF;
  -- Gemini Enterprise (Agentspace) support: the app/engine ID (cid), its location and collection
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='oauth_keys' AND column_name='gemini_engine_id') THEN
    ALTER TABLE oauth_keys ADD COLUMN gemini_engine_id VARCHAR(255);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='oauth_keys' AND column_name='gemini_location') THEN
    ALTER TABLE oauth_keys ADD COLUMN gemini_location VARCHAR(64);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='oauth_keys' AND column_name='gemini_collection') THEN
    ALTER TABLE oauth_keys ADD COLUMN gemini_collection VARCHAR(255);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='agent_registry' AND column_name='approval_status') THEN
    ALTER TABLE agent_registry ADD COLUMN approval_status VARCHAR(50) DEFAULT 'no_status';
  END IF;
  -- Widen client_id to TEXT so encrypted admin keys (350+ chars) fit
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='oauth_keys' AND column_name='client_id' AND data_type='character varying'
  ) THEN
    ALTER TABLE oauth_keys ALTER COLUMN client_id TYPE TEXT;
  END IF;
END $$;

-- Agent registry: CloudFuze's internal source of truth per PRD Section 4.1
-- Stores computed fields (risk score, renewal date, tags) that don't exist in Microsoft APIs
CREATE TABLE IF NOT EXISTS agent_registry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id VARCHAR(255) NOT NULL UNIQUE,
  oauth_key_id UUID REFERENCES oauth_keys(id) ON DELETE CASCADE,
  name VARCHAR(500),
  platform VARCHAR(50) DEFAULT 'copilot_studio',
  owner_id VARCHAR(255),
  owner_name VARCHAR(255),
  renewal_date TIMESTAMPTZ,
  renewal_period_days INTEGER DEFAULT 90,
  last_risk_score INTEGER,
  last_risk_level VARCHAR(20),
  tags JSONB DEFAULT '[]',
  first_discovered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_scanned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_registry_bot_id ON agent_registry(bot_id);
CREATE INDEX IF NOT EXISTS idx_agent_registry_oauth_key ON agent_registry(oauth_key_id);
CREATE INDEX IF NOT EXISTS idx_agent_registry_renewal ON agent_registry(renewal_date);

CREATE INDEX IF NOT EXISTS idx_oauth_keys_vendor ON oauth_keys(vendor);
CREATE INDEX IF NOT EXISTS idx_policies_status ON policies(status);
CREATE INDEX IF NOT EXISTS idx_policy_violations_policy ON policy_violations(policy_id);
CREATE INDEX IF NOT EXISTS idx_policy_violations_agent ON policy_violations(agent_id);
CREATE INDEX IF NOT EXISTS idx_governance_audit_log_agent ON governance_audit_log(agent_id);
CREATE INDEX IF NOT EXISTS idx_governance_audit_log_type ON governance_audit_log(event_type);

-- Alerts: tracks idle-agent notifications for Microsoft & Google
CREATE TABLE IF NOT EXISTS alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id VARCHAR(255) NOT NULL,
  agent_name VARCHAR(500),
  vendor VARCHAR(50) NOT NULL,
  platform VARCHAR(100),
  alert_type VARCHAR(50) NOT NULL DEFAULT 'idle_agent',
  message TEXT,
  idle_minutes INTEGER,
  severity VARCHAR(20) DEFAULT 'low',
  resolved BOOLEAN DEFAULT FALSE,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alerts_agent ON alerts(agent_id);
CREATE INDEX IF NOT EXISTS idx_alerts_vendor ON alerts(vendor);
CREATE INDEX IF NOT EXISTS idx_alerts_resolved ON alerts(resolved);
CREATE INDEX IF NOT EXISTS idx_alerts_created ON alerts(created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_alerts_active_per_agent
  ON alerts(agent_id, alert_type) WHERE resolved = false;

-- Cost tracking: stores token usage and cost snapshots per agent/deployment
CREATE TABLE IF NOT EXISTS cost_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id VARCHAR(255) NOT NULL,
  agent_name VARCHAR(500),
  vendor VARCHAR(50) NOT NULL,
  platform VARCHAR(100),
  model_name VARCHAR(255),
  input_tokens BIGINT DEFAULT 0,
  output_tokens BIGINT DEFAULT 0,
  total_tokens BIGINT DEFAULT 0,
  request_count BIGINT DEFAULT 0,
  input_cost NUMERIC(12,6) DEFAULT 0,
  output_cost NUMERIC(12,6) DEFAULT 0,
  total_cost NUMERIC(12,6) DEFAULT 0,
  period VARCHAR(20),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cost_records_vendor ON cost_records(vendor);
CREATE INDEX IF NOT EXISTS idx_cost_records_agent ON cost_records(agent_id);
CREATE INDEX IF NOT EXISTS idx_cost_records_recorded ON cost_records(recorded_at DESC);

-- Alert configuration (singleton row)
CREATE TABLE IF NOT EXISTS alert_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idle_threshold_minutes INTEGER NOT NULL DEFAULT 43200,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  notify_microsoft BOOLEAN NOT NULL DEFAULT TRUE,
  notify_google BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT single_row CHECK (true)
);

-- Sensitivity labels: per-agent coverage of Microsoft Purview / Google DLP / platform labels
CREATE TABLE IF NOT EXISTS agent_sensitivity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id VARCHAR(255) NOT NULL,
  platform VARCHAR(50) NOT NULL,
  labeled_count INTEGER DEFAULT 0,
  unlabeled_count INTEGER DEFAULT 0,
  coverage_percent INTEGER DEFAULT 0,
  knowledge_sources JSONB DEFAULT '[]',
  available_labels JSONB DEFAULT '[]',
  scanned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(agent_id, platform)
);

CREATE INDEX IF NOT EXISTS idx_agent_sensitivity_agent ON agent_sensitivity(agent_id);

-- Prompt flags: flagged messages from conversation transcripts across all platforms
CREATE TABLE IF NOT EXISTS prompt_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id VARCHAR(255) NOT NULL,
  agent_name VARCHAR(500),
  platform VARCHAR(50) NOT NULL,
  conversation_id VARCHAR(255),
  flag_type VARCHAR(100) NOT NULL,
  severity VARCHAR(20) NOT NULL DEFAULT 'medium',
  snippet TEXT,
  matched_patterns JSONB DEFAULT '[]',
  resolved BOOLEAN DEFAULT FALSE,
  resolved_at TIMESTAMPTZ,
  flagged_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prompt_flags_agent ON prompt_flags(agent_id);
CREATE INDEX IF NOT EXISTS idx_prompt_flags_severity ON prompt_flags(severity);
CREATE INDEX IF NOT EXISTS idx_prompt_flags_resolved ON prompt_flags(resolved);
CREATE INDEX IF NOT EXISTS idx_prompt_flags_flagged ON prompt_flags(flagged_at DESC);

-- Recertification campaigns: lifecycle re-review workflow per agent
CREATE TABLE IF NOT EXISTS recertification_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id VARCHAR(255) NOT NULL,
  agent_name VARCHAR(500),
  platform VARCHAR(50),
  owner_email VARCHAR(255),
  owner_name VARCHAR(255),
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  due_at TIMESTAMPTZ NOT NULL,
  responded_at TIMESTAMPTZ,
  response VARCHAR(50),
  responder VARCHAR(255),
  notes TEXT,
  status VARCHAR(50) NOT NULL DEFAULT 'pending',
  escalated_at TIMESTAMPTZ,
  escalated_to VARCHAR(255),
  oauth_key_id UUID REFERENCES oauth_keys(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_recertification_agent ON recertification_campaigns(agent_id);
CREATE INDEX IF NOT EXISTS idx_recertification_status ON recertification_campaigns(status);
CREATE INDEX IF NOT EXISTS idx_recertification_due ON recertification_campaigns(due_at);

-- Agent metadata: business context per agent (purpose, classification, ownership)
CREATE TABLE IF NOT EXISTS agent_metadata (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id VARCHAR(255) NOT NULL UNIQUE,
  agent_name VARCHAR(500),
  platform VARCHAR(50),
  purpose TEXT,
  business_unit VARCHAR(255),
  data_classification VARCHAR(50) DEFAULT 'unclassified',
  use_case_category VARCHAR(100),
  approved_by VARCHAR(255),
  approved_at TIMESTAMPTZ,
  notes TEXT,
  tags JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_metadata_agent ON agent_metadata(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_metadata_classification ON agent_metadata(data_classification);

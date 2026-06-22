// Risk-scoring engine. Each finding gets a 0–100 risk score computed from rules.
//
// Scoring philosophy:
//   0–19    low      — sanctioned / informational
//   20–39   moderate — unsanctioned but not dangerous in isolation
//   40–69   elevated — unsanctioned with sensitive scope or credentials at rest
//   70–100  high     — secrets in plaintext OR blocked tool actually in use
//
// Rules combine additively but cap at 100. Final score is rounded.
//
// `scoreFinding` is called inline during ingest so risk is stored next to each
// finding. `scoreTool` is called by the dashboard tools endpoint to aggregate.

// ---- per-finding rules ----

const RULES = [
  // API key in shell rc is the worst case — anyone who reads the file gets it.
  {
    test: (f) => f.type === 'api_key' && /\.(zshrc|bashrc|bash_profile|profile|zprofile|zshenv)$/.test(f.location || ''),
    score: 75,
    reason: 'API key in shell profile (plaintext, persists across sessions)',
  },
  // API key in .env at home dir
  {
    test: (f) => f.type === 'api_key' && /\.env$/.test(f.location || '') && /[\\/]\.env$/.test(f.location || '') === false,
    score: 50,
    reason: 'API key in .env file',
  },
  // API key for a blocked provider
  {
    test: (f) => f.type === 'api_key' && ['openai', 'anthropic', 'google-genai'].includes(f.provider),
    score: 40,
    reason: 'enterprise-grade AI provider API key present',
  },

  // MCP server with database scope is high-value
  {
    test: (f) => f.type === 'mcp_server' && (f.scopes || []).includes('database'),
    score: 55,
    reason: 'MCP server bridges an AI agent to a database',
  },
  {
    test: (f) => f.type === 'mcp_server' && (f.scopes || []).includes('source-control'),
    score: 40,
    reason: 'MCP server gives AI agent source-control access',
  },
  {
    test: (f) => f.type === 'mcp_server' && (f.scopes || []).includes('filesystem'),
    score: 30,
    reason: 'MCP server gives AI agent filesystem access',
  },
  {
    test: (f) => f.type === 'mcp_server' && (f.scopes || []).includes('cloud-infra'),
    score: 65,
    reason: 'MCP server gives AI agent cloud-infrastructure control',
  },

  // Running agent processes — actually executing right now
  { test: (f) => f.type === 'running_agent' && f.language === 'python', score: 35, reason: 'autonomous Python AI agent running' },
  { test: (f) => f.type === 'running_agent', score: 30, reason: 'autonomous AI agent running' },

  // Browser AI usage on consumer endpoint (not the enterprise console)
  {
    test: (f) => f.type === 'browser_ai_visit' && /^(chatgpt\.com|gemini\.google\.com|claude\.ai|perplexity\.ai)$/.test(f.domain || ''),
    score: 20,
    reason: 'consumer AI service used in browser (no enterprise data controls)',
  },
  {
    test: (f) => f.type === 'browser_ai_visit' && (f.visitCount ?? 0) > 100,
    score: 15,
    reason: 'heavy browser AI usage (>100 visits)',
  },

  // Local LLM with models cached — could process anything offline
  { test: (f) => f.type === 'local_llm', score: 25, reason: 'local LLM runtime present' },

  // Agent project pulling in autonomous frameworks
  {
    test: (f) => f.type === 'agent_project' && (f.frameworks || []).some((fw) => /autogen|crewai|langgraph|langchain/i.test(fw)),
    score: 35,
    reason: 'project uses autonomous agent framework',
  },
  { test: (f) => f.type === 'agent_project', score: 15, reason: 'AI agent project present' },

  // Generic IDE/desktop AI extension
  { test: (f) => f.type === 'ide_extension', score: 10, reason: 'AI IDE extension installed' },
  { test: (f) => f.type === 'desktop_app', score: 10, reason: 'AI desktop app installed' },
  { test: (f) => f.type === 'running_process', score: 5, reason: 'AI process observed running' },
  { test: (f) => f.type === 'agent_config', score: 10, reason: 'AI agent configuration present' },
];

export function scoreFinding(finding) {
  let total = 0;
  for (const rule of RULES) {
    try { if (rule.test(finding)) total += rule.score; } catch {}
  }
  return Math.min(100, Math.round(total));
}

// Aggregate a tool's risk based on its findings. Used by dashboard rollups.
// Returns the max risk of any constituent finding — one bad finding for a
// tool is enough to flag it.
export function scoreTool(findings) {
  let max = 0;
  for (const f of findings) {
    const s = scoreFinding(f);
    if (s > max) max = s;
  }
  return max;
}

// Adjust for sanction status. Called when joining with sanctions table.
export function adjustForSanction(baseScore, sanctionStatus) {
  switch (sanctionStatus) {
    case 'approved':   return Math.max(0, Math.round(baseScore * 0.3));  // 70% discount
    case 'restricted': return baseScore;
    case 'blocked':    return Math.min(100, baseScore + 30);
    default:           return baseScore;  // unknown
  }
}

export function riskBand(score) {
  if (score >= 70) return 'high';
  if (score >= 40) return 'elevated';
  if (score >= 20) return 'moderate';
  return 'low';
}

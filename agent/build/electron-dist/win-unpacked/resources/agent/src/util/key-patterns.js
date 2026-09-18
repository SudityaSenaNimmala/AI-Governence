// Shared catalog of secret patterns. Used by api_keys (targeted scan) and
// deep_filesystem (broad scan).
//
// Each pattern's regex captures the secret VALUE. The detectors only ever
// emit a fingerprint (prefix + sha256 truncate) — the raw value never leaves
// the function that reads it.

import { createHash } from 'node:crypto';

export const KEY_PATTERNS = [
  { provider: 'openai',         regex: /\b(sk-(?:proj-)?[A-Za-z0-9_-]{20,})\b/g,                      severity: 'high'     },
  { provider: 'anthropic',      regex: /\b(sk-ant-(?:api\d{2}-)?[A-Za-z0-9_-]{20,})\b/g,             severity: 'high'     },
  { provider: 'google-genai',   regex: /\b(AIza[0-9A-Za-z_-]{30,})\b/g,                              severity: 'high'     },
  { provider: 'cohere',         regex: /\b(co_[A-Za-z0-9]{30,})\b/g,                                 severity: 'high'     },
  { provider: 'huggingface',    regex: /\b(hf_[A-Za-z0-9]{30,})\b/g,                                 severity: 'high'     },
  { provider: 'perplexity',     regex: /\b(pplx-[A-Za-z0-9]{30,})\b/g,                               severity: 'high'     },
  { provider: 'groq',           regex: /\b(gsk_[A-Za-z0-9]{30,})\b/g,                                severity: 'high'     },
  { provider: 'replicate',      regex: /\b(r8_[A-Za-z0-9]{30,})\b/g,                                 severity: 'high'     },
  { provider: 'github-pat',     regex: /\b(gh[pousr]_[A-Za-z0-9]{30,})\b/g,                          severity: 'critical' },
  { provider: 'aws-access-key', regex: /\b(AKIA[0-9A-Z]{16})\b/g,                                    severity: 'critical' },
  { provider: 'slack-token',    regex: /\b(xox[abprs]-[A-Za-z0-9-]{10,})\b/g,                        severity: 'high'     },
];

export const ENV_VAR_HINTS = [
  { provider: 'openai',        name: 'OPENAI_API_KEY' },
  { provider: 'anthropic',     name: 'ANTHROPIC_API_KEY' },
  { provider: 'google-genai',  name: 'GOOGLE_API_KEY' },
  { provider: 'google-genai',  name: 'GEMINI_API_KEY' },
  { provider: 'cohere',        name: 'COHERE_API_KEY' },
  { provider: 'huggingface',   name: 'HF_TOKEN' },
  { provider: 'huggingface',   name: 'HUGGINGFACE_API_KEY' },
  { provider: 'perplexity',    name: 'PERPLEXITY_API_KEY' },
  { provider: 'mistral',       name: 'MISTRAL_API_KEY' },
  { provider: 'groq',          name: 'GROQ_API_KEY' },
  { provider: 'replicate',     name: 'REPLICATE_API_TOKEN' },
  { provider: 'azure-openai',  name: 'AZURE_OPENAI_API_KEY' },
];

// First 6 chars + SHA-256 truncate. Cannot be reversed.
export function fingerprintKey(value) {
  const prefix = value.slice(0, 6);
  const hash = createHash('sha256').update(value).digest('hex').slice(0, 12);
  return `${prefix}...${hash}`;
}

// Hints that an agent project lives here — checked alongside key patterns.
export const AGENT_FILE_HINTS = [
  { kind: 'claude_code',  test: (name) => name === 'CLAUDE.md' || name === '.claude' || name.endsWith('.claude') },
  { kind: 'cursor',       test: (name) => name === '.cursorrules' || name === '.cursor' },
  { kind: 'mcp-config',   test: (name) => name === '.mcp.json' || name === 'mcp.json' || name === 'claude_desktop_config.json' },
  { kind: 'aider',        test: (name) => name === '.aider.conf.yml' || name === '.aider.input.history' },
  { kind: 'continue',     test: (name) => name === '.continuerules' || name === '.continueignore' },
  { kind: 'agents-md',    test: (name) => name === 'AGENTS.md' },
];

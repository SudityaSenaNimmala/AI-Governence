// Token vault for reversible PII tokenization in the HTTPS proxy.
//
// Maps unique tokens to original sensitive values. The proxy rewrites request
// bodies with tokens before forwarding to the AI provider, and restores
// originals in the response before returning to the client.
//
// Token format: [CFAI:<PATTERN_SHORT>:<8-hex>]
// Example:      [CFAI:SSN:a7f3b2c1]

import { randomBytes } from 'node:crypto';

const PATTERN_SHORT = {
  'openai-api-key': 'APIKEY', 'anthropic-api-key': 'APIKEY',
  'google-api-key': 'APIKEY', 'huggingface-token': 'APIKEY',
  'github-pat': 'GHTOKEN', 'gitlab-pat': 'GLTOKEN',
  'aws-access-key': 'AWSKEY', 'slack-token': 'SLKTOKEN',
  'jwt': 'JWT', 'us-ssn': 'SSN', 'credit-card': 'CARD',
  'iban': 'IBAN', 'us-phone': 'PHONE',
  'cloudfuze-customer-id': 'CFID', 'internal-jira-key': 'JIRA',
};

const TOKEN_RE = /\[CFAI:[A-Z0-9]+:[a-f0-9]{8}\]/g;
const TOKEN_TTL_MS = 30 * 60 * 1000; // 30 minutes

export class TokenVault {
  constructor() {
    this._map = new Map(); // tokenString → { original, pattern, createdAt }
  }

  /** Create a unique token for an original sensitive value. */
  create(original, patternName) {
    // Reuse existing token for same value + pattern
    for (const [tok, entry] of this._map) {
      if (entry.original === original && entry.pattern === patternName) return tok;
    }
    const short = PATTERN_SHORT[patternName] || 'DATA';
    const id = randomBytes(4).toString('hex');
    const token = `[CFAI:${short}:${id}]`;
    this._map.set(token, { original, pattern: patternName, createdAt: Date.now() });
    return token;
  }

  /** Replace all known tokens in text with their original values. */
  restore(text) {
    if (!text || typeof text !== 'string') return text;
    return text.replace(TOKEN_RE, (tok) => {
      const entry = this._map.get(tok);
      return entry ? entry.original : tok;
    });
  }

  /** Check if text contains any known tokens. */
  hasTokens(text) {
    if (!text) return false;
    TOKEN_RE.lastIndex = 0;
    let m;
    while ((m = TOKEN_RE.exec(text)) !== null) {
      if (this._map.has(m[0])) return true;
    }
    return false;
  }

  /** Remove expired entries. */
  gc() {
    const now = Date.now();
    for (const [tok, entry] of this._map) {
      if (now - entry.createdAt > TOKEN_TTL_MS) this._map.delete(tok);
    }
  }

  get size() { return this._map.size; }
  clear() { this._map.clear(); }
}

export const TOKEN_REGEX = TOKEN_RE;

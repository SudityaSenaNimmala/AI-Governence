// Pattern catalog for sensitive data detection. Patterns mirror the agent's
// key catalog plus PII categories. We only return pattern class names — never
// the matched value, never the content around it.
//
// This file is plain (non-module) JS so manifest content_scripts can load it.

(function () {
  const PATTERNS = [
    // ----- API keys -----
    { name: 'openai-api-key',     class: 'api_key', regex: /\b(sk-(?:proj-)?[A-Za-z0-9_-]{20,})\b/g, severity: 'high' },
    { name: 'anthropic-api-key',  class: 'api_key', regex: /\b(sk-ant-(?:api\d{2}-)?[A-Za-z0-9_-]{20,})\b/g, severity: 'high' },
    { name: 'google-api-key',     class: 'api_key', regex: /\b(AIza[0-9A-Za-z_-]{30,})\b/g, severity: 'high' },
    { name: 'huggingface-token',  class: 'api_key', regex: /\b(hf_[A-Za-z0-9]{30,})\b/g, severity: 'high' },
    { name: 'github-pat',         class: 'api_key', regex: /\b(gh[pousr]_[A-Za-z0-9]{30,})\b/g, severity: 'critical' },
    { name: 'gitlab-pat',         class: 'api_key', regex: /\b(glpat-[A-Za-z0-9_-]{20,})\b/g, severity: 'critical' },
    { name: 'aws-access-key',     class: 'cloud_key', regex: /\b(AKIA[0-9A-Z]{16})\b/g, severity: 'critical' },
    { name: 'gcp-service-key',    class: 'cloud_key', regex: /"type":\s*"service_account"/g, severity: 'critical' },
    { name: 'slack-token',        class: 'api_key', regex: /\b(xox[abprs]-[A-Za-z0-9-]{10,})\b/g, severity: 'high' },
    { name: 'jwt',                class: 'api_key', regex: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, severity: 'high' },

    // ----- PII -----
    { name: 'us-ssn',             class: 'pii',     regex: /\b\d{3}-\d{2}-\d{4}\b/g, severity: 'critical' },
    { name: 'credit-card',        class: 'pii',     regex: /\b(?:\d[ -]*?){13,16}\b/g, severity: 'high',
      validate: luhnCheck },
    { name: 'iban',               class: 'pii',     regex: /\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/g, severity: 'high' },
    { name: 'us-phone',           class: 'pii',     regex: /\b(?:\+?1[ -]?)?\(?[2-9]\d{2}\)?[ -]?\d{3}[ -]?\d{4}\b/g, severity: 'low' },

    // ----- internal hints (customize per organization) -----
    { name: 'cloudfuze-customer-id', class: 'internal', regex: /\bCF-CUST-[A-Z0-9]{6,}\b/g, severity: 'high' },
    { name: 'internal-jira-key',     class: 'internal', regex: /\b(CF|GOV|SEC)-\d{2,}\b/g, severity: 'low' },
  ];

  // File risk classifier — runs on filename + size, not contents.
  // Returns { class, severity, reason }.
  const FILE_RULES = [
    // Critical: secrets / private keys
    { rx: /^\.env(\.|$)|(^|[\\/])\.env(\.|$)/i,        class: 'env_file',     severity: 'critical', reason: '.env file (likely contains secrets)' },
    { rx: /\.(pem|key|pfx|p12|jks|keystore)$/i,        class: 'private_key',  severity: 'critical', reason: 'private key / keystore file' },
    { rx: /(^|[\W_])credentials?[\W_]?/i,              class: 'credentials',  severity: 'critical', reason: 'filename contains "credential"' },
    { rx: /(^|[\W_])secrets?[\W_]?/i,                  class: 'credentials',  severity: 'critical', reason: 'filename contains "secret"' },
    { rx: /(^|[\W_])passwords?[\W_]?/i,                class: 'credentials',  severity: 'critical', reason: 'filename contains "password"' },
    { rx: /id_(rsa|ed25519|ecdsa|dsa)/i,               class: 'ssh_key',      severity: 'critical', reason: 'SSH private key filename pattern' },

    // High: tabular / DB / dumps — often customer PII
    { rx: /\.(csv|tsv|xlsx|xls|ods|parquet)$/i,        class: 'tabular_data', severity: 'high',     reason: 'spreadsheet/tabular file (often customer data)' },
    { rx: /\.(sql|sqlite|db|dump|bak)$/i,              class: 'database',     severity: 'high',     reason: 'database file or backup' },
    { rx: /\.(har)$/i,                                 class: 'network_har',  severity: 'high',     reason: 'HAR file (browser network log, may contain tokens)' },

    // Moderate: documents + configs + archives
    { rx: /\.(pdf|docx|doc|odt|rtf|pages)$/i,          class: 'document',     severity: 'moderate', reason: 'document file' },
    { rx: /\.(zip|7z|rar|tar|tar\.gz|tgz)$/i,          class: 'archive',      severity: 'moderate', reason: 'archive (contents not inspected)' },
    { rx: /\.(json|ya?ml|toml|ini|conf|config|cfg)$/i, class: 'config',       severity: 'moderate', reason: 'configuration file' },

    // Low: source code, plain text, media
    { rx: /\.(js|ts|tsx|jsx|py|rb|go|rs|java|cs|cpp|c|h|swift|kt|php)$/i, class: 'source_code', severity: 'low', reason: 'source code file' },
    { rx: /\.(md|markdown|txt|log)$/i,                 class: 'plain_text',   severity: 'low',      reason: 'plain text / markdown' },
    { rx: /\.(png|jpe?g|gif|webp|svg|bmp|ico)$/i,      class: 'image',        severity: 'low',      reason: 'image file' },
    { rx: /\.(mp3|mp4|mov|avi|wav|flac|webm|mkv)$/i,   class: 'media',        severity: 'low',      reason: 'media file' },
  ];

  function classifyFile(name, size) {
    for (const r of FILE_RULES) {
      if (r.rx.test(name)) {
        return { class: r.class, severity: r.severity, reason: r.reason };
      }
    }
    return { class: 'other', severity: 'low', reason: 'unclassified file type' };
  }

  function sizeBucket(bytes) {
    if (bytes < 1024)            return '<1KB';
    if (bytes < 10 * 1024)       return '1-10KB';
    if (bytes < 100 * 1024)      return '10-100KB';
    if (bytes < 1024 * 1024)     return '100KB-1MB';
    if (bytes < 10 * 1024 * 1024) return '1-10MB';
    if (bytes < 100 * 1024 * 1024) return '10-100MB';
    return '>100MB';
  }

  function luhnCheck(numStr) {
    const digits = numStr.replace(/\D/g, '');
    if (digits.length < 13 || digits.length > 19) return false;
    let sum = 0, alt = false;
    for (let i = digits.length - 1; i >= 0; i--) {
      let n = parseInt(digits[i], 10);
      if (alt) { n *= 2; if (n > 9) n -= 9; }
      sum += n;
      alt = !alt;
    }
    return sum % 10 === 0;
  }

  // Redaction labels keyed by pattern name
  const REDACT_LABELS = {
    'openai-api-key':       '[REDACTED-API-KEY]',
    'anthropic-api-key':    '[REDACTED-API-KEY]',
    'google-api-key':       '[REDACTED-API-KEY]',
    'huggingface-token':    '[REDACTED-API-KEY]',
    'github-pat':           '[REDACTED-GITHUB-TOKEN]',
    'gitlab-pat':           '[REDACTED-GITLAB-TOKEN]',
    'aws-access-key':       '[REDACTED-AWS-KEY]',
    'gcp-service-key':      '[REDACTED-GCP-KEY]',
    'slack-token':          '[REDACTED-SLACK-TOKEN]',
    'jwt':                  '[REDACTED-JWT]',
    'us-ssn':               '[REDACTED-SSN]',
    'credit-card':          '[REDACTED-CREDIT-CARD]',
    'iban':                 '[REDACTED-IBAN]',
    'us-phone':             '[REDACTED-PHONE]',
    'cloudfuze-customer-id':'[REDACTED-CUSTOMER-ID]',
    'internal-jira-key':    '[REDACTED-INTERNAL-KEY]',
  };

  // ── Token Vault for Reversible PII Tokenization ─────────────────────────
  // Maps unique tokens to original sensitive values. Tokens are short,
  // self-describing strings that an LLM can echo back verbatim. On response,
  // the vault restores originals so the user sees real data while the LLM
  // never did.
  //
  // Token format: [CFAI:<pattern-short>:<8-hex>]
  // Example:      [CFAI:SSN:a7f3b2c1]

  const PATTERN_SHORT = {
    'openai-api-key': 'APIKEY', 'anthropic-api-key': 'APIKEY',
    'google-api-key': 'APIKEY', 'huggingface-token': 'APIKEY',
    'github-pat': 'GHTOKEN', 'gitlab-pat': 'GLTOKEN',
    'aws-access-key': 'AWSKEY', 'gcp-service-key': 'GCPKEY',
    'slack-token': 'SLKTOKEN', 'jwt': 'JWT',
    'us-ssn': 'SSN', 'credit-card': 'CARD',
    'iban': 'IBAN', 'us-phone': 'PHONE',
    'cloudfuze-customer-id': 'CFID', 'internal-jira-key': 'JIRA',
  };

  function randomHex8() {
    const arr = new Uint8Array(4);
    (typeof crypto !== 'undefined' && crypto.getRandomValues)
      ? crypto.getRandomValues(arr)
      : arr.forEach((_, i) => { arr[i] = Math.floor(Math.random() * 256); });
    return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
  }

  // The vault itself — shared via window.__cfaiTokenVault
  const TOKEN_RE = /\[CFAI:[A-Z0-9]+:[a-f0-9]{8}\]/g;
  const TOKEN_TTL_MS = 30 * 60 * 1000; // 30 minutes

  const tokenVault = {
    _map: new Map(), // tokenString → { original, pattern, createdAt }

    /** Create a unique token for an original sensitive value. */
    create(original, patternName) {
      // Reuse existing token for the same original value within the same session
      for (const [tok, entry] of this._map) {
        if (entry.original === original && entry.pattern === patternName) return tok;
      }
      const short = PATTERN_SHORT[patternName] || 'DATA';
      const id = randomHex8();
      const token = '[CFAI:' + short + ':' + id + ']';
      this._map.set(token, { original, pattern: patternName, createdAt: Date.now() });
      return token;
    },

    /** Replace all known tokens in text with their original values. */
    restore(text) {
      if (!text || typeof text !== 'string') return text;
      return text.replace(TOKEN_RE, (tok) => {
        const entry = this._map.get(tok);
        return entry ? entry.original : tok;
      });
    },

    /** Check if text contains any known tokens. */
    hasTokens(text) {
      if (!text) return false;
      TOKEN_RE.lastIndex = 0;
      let m;
      while ((m = TOKEN_RE.exec(text)) !== null) {
        if (this._map.has(m[0])) return true;
      }
      return false;
    },

    /** Remove expired entries. */
    gc() {
      const now = Date.now();
      for (const [tok, entry] of this._map) {
        if (now - entry.createdAt > TOKEN_TTL_MS) this._map.delete(tok);
      }
    },

    /** Current vault size (for diagnostics). */
    get size() { return this._map.size; },

    /** Clear entire vault. */
    clear() { this._map.clear(); },
  };

  // Periodic garbage collection
  setInterval(() => tokenVault.gc(), 5 * 60 * 1000);

  // Expose vault globally so fetch-blocker (page world) and content script
  // can both access it.
  window.__cfaiTokenVault = tokenVault;

  // Run all patterns on text. Returns an array of { pattern, class, severity, count }.
  // Never returns the matched value.
  window.__cfaiPatterns = {
    classifyFile,
    sizeBucket,
    scan(text) {
      if (!text || typeof text !== 'string') return [];
      const matches = [];
      for (const p of PATTERNS) {
        p.regex.lastIndex = 0;
        let n = 0;
        let m;
        while ((m = p.regex.exec(text)) !== null) {
          if (p.validate && !p.validate(m[0])) continue;
          n++;
        }
        if (n > 0) {
          matches.push({ pattern: p.name, class: p.class, severity: p.severity, count: n });
        }
      }
      return matches;
    },

    /**
     * Redact sensitive data from text. Replaces each match with a
     * human-readable label like [REDACTED-SSN]. Only redacts patterns at
     * high/critical severity (same as the block threshold).
     *
     * Returns { redacted: string, replacements: [{pattern, label, count}] }
     */
    redact(text, blockSeverities) {
      if (!text || typeof text !== 'string') return { redacted: text, replacements: [] };
      const sevSet = blockSeverities || new Set(['high', 'critical']);
      let result = text;
      const replacements = [];

      // Sort patterns by name length descending to avoid partial overlaps
      const sorted = [...PATTERNS].filter(p => sevSet.has(p.severity));

      for (const p of sorted) {
        p.regex.lastIndex = 0;
        const label = REDACT_LABELS[p.name] || '[REDACTED]';
        let count = 0;
        result = result.replace(p.regex, (match) => {
          if (p.validate && !p.validate(match)) return match;
          count++;
          return label;
        });
        if (count > 0) {
          replacements.push({ pattern: p.name, label, count });
        }
      }
      return { redacted: result, replacements };
    },

    /**
     * Tokenize sensitive data in text using reversible unique tokens.
     * Unlike redact(), the original values can be restored from the tokens.
     *
     * Only tokenizes patterns whose name appears in `tokenizePatterns` set.
     * Patterns not in the set are left untouched (they'll be caught by the
     * block path separately).
     *
     * Returns { tokenized: string, tokens: [{pattern, token, count}] }
     */
    tokenize(text, tokenizePatterns) {
      if (!text || typeof text !== 'string') return { tokenized: text, tokens: [] };
      if (!tokenizePatterns || tokenizePatterns.size === 0) return { tokenized: text, tokens: [] };
      let result = text;
      const tokens = [];

      for (const p of PATTERNS) {
        if (!tokenizePatterns.has(p.name)) continue;
        p.regex.lastIndex = 0;
        let count = 0;
        result = result.replace(p.regex, (match) => {
          if (p.validate && !p.validate(match)) return match;
          count++;
          return tokenVault.create(match, p.name);
        });
        if (count > 0) {
          tokens.push({ pattern: p.name, count });
        }
      }
      return { tokenized: result, tokens };
    },

    /** Restore all tokens in text back to their original values. */
    restoreTokens(text) {
      return tokenVault.restore(text);
    },

    /** List of all pattern names (for config UI). */
    patternNames() {
      return PATTERNS.map(p => ({ name: p.name, class: p.class, severity: p.severity }));
    },
  };
})();

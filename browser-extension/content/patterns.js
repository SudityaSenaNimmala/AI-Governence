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
  };
})();

// Pattern catalog used by the OS-level monitor. Kept in sync with the same
// patterns the browser extension and desktop hook use (see browser-extension/
// content/patterns.js and agent/src/desktop_injector/hook-template.js).
//
// We accept the duplication because each runtime has different constraints:
// the browser extension is non-module JS for content scripts, the desktop hook
// is a string template, and this is Node ESM. Refactoring them into one
// shared package is doable but out of scope for the OS monitor build.

const PATTERNS = [
  { name: 'openai-api-key',     class: 'api_key',   regex: /\b(sk-(?:proj-)?[A-Za-z0-9_-]{20,})\b/g,             severity: 'high'     },
  { name: 'anthropic-api-key',  class: 'api_key',   regex: /\b(sk-ant-(?:api\d{2}-)?[A-Za-z0-9_-]{20,})\b/g,     severity: 'high'     },
  { name: 'google-api-key',     class: 'api_key',   regex: /\b(AIza[0-9A-Za-z_-]{30,})\b/g,                      severity: 'high'     },
  { name: 'huggingface-token',  class: 'api_key',   regex: /\b(hf_[A-Za-z0-9]{30,})\b/g,                         severity: 'high'     },
  { name: 'github-pat',         class: 'api_key',   regex: /\b(gh[pousr]_[A-Za-z0-9]{30,})\b/g,                  severity: 'critical' },
  { name: 'gitlab-pat',         class: 'api_key',   regex: /\b(glpat-[A-Za-z0-9_-]{20,})\b/g,                    severity: 'critical' },
  { name: 'aws-access-key',     class: 'cloud_key', regex: /\b(AKIA[0-9A-Z]{16})\b/g,                            severity: 'critical' },
  { name: 'slack-token',        class: 'api_key',   regex: /\b(xox[abprs]-[A-Za-z0-9-]{10,})\b/g,                severity: 'high'     },
  { name: 'jwt',                class: 'api_key',   regex: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, severity: 'high' },
  { name: 'us-ssn',             class: 'pii',       regex: /\b\d{3}-\d{2}-\d{4}\b/g,                             severity: 'critical' },
  { name: 'credit-card',        class: 'pii',       regex: /\b(?:\d[ -]*?){13,16}\b/g,                           severity: 'high',     validate: luhnCheck },
  { name: 'iban',               class: 'pii',       regex: /\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/g,                  severity: 'high'     },
  { name: 'us-phone',           class: 'pii',       regex: /\b(?:\+?1[ -]?)?\(?[2-9]\d{2}\)?[ -]?\d{3}[ -]?\d{4}\b/g, severity: 'low' },
  { name: 'cloudfuze-customer-id', class: 'internal', regex: /\bCF-CUST-[A-Z0-9]{6,}\b/g,                        severity: 'high'     },
  { name: 'internal-jira-key',     class: 'internal', regex: /\b(CF|GOV|SEC)-\d{2,}\b/g,                         severity: 'low'      },
];

const SEVERITY_ORDER = ['low', 'moderate', 'high', 'critical'];

// Patterns the desktop keystroke-blocker enforces on. High/critical only, and
// we exclude any pattern that needs a JS validator (credit-card → Luhn): the
// blocker runs the regex in .NET where we can't replicate the validator, and
// blocking every 13–16 digit run would be far too aggressive. Exposed as plain
// {name, source, severity} so the enforcer helper can hand the regex sources to
// its .NET Regex engine without us duplicating the catalog.
export const BLOCK_PATTERNS = PATTERNS
  .filter((p) => (p.severity === 'high' || p.severity === 'critical') && !p.validate)
  .map((p) => ({ name: p.name, source: p.regex.source, severity: p.severity }));

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

// Scan text and return { matches, highestSeverity }. Never returns the raw
// match value — the governance server only ever sees pattern names + counts.
export function scan(text) {
  if (!text || typeof text !== 'string') {
    return { matches: [], highestSeverity: null };
  }
  const matches = [];
  for (const p of PATTERNS) {
    p.regex.lastIndex = 0;
    let n = 0; let m;
    while ((m = p.regex.exec(text)) !== null) {
      if (p.validate && !p.validate(m[0])) continue;
      n++;
    }
    if (n > 0) {
      matches.push({ pattern: p.name, class: p.class, severity: p.severity, count: n });
    }
  }
  let highest = null;
  for (const m of matches) {
    if (SEVERITY_ORDER.indexOf(m.severity) > SEVERITY_ORDER.indexOf(highest)) {
      highest = m.severity;
    }
  }
  return { matches, highestSeverity: highest };
}

export function lengthBucket(n) {
  if (n < 100)   return '<100';
  if (n < 1000)  return '100-1k';
  if (n < 10000) return '1k-10k';
  if (n < 50000) return '10k-50k';
  return '50k+';
}

// ---- File classification (mirrors browser-extension/content/patterns.js) ----

const FILE_RULES = [
  { rx: /^\.env(\.|$)|(^|[\\/])\.env(\.|$)/i,        class: 'env_file',     severity: 'critical', reason: '.env file (likely contains secrets)' },
  { rx: /\.(pem|key|pfx|p12|jks|keystore)$/i,        class: 'private_key',  severity: 'critical', reason: 'private key / keystore file' },
  { rx: /(^|[\W_])credentials?[\W_]?/i,              class: 'credentials',  severity: 'critical', reason: 'filename contains "credential"' },
  { rx: /(^|[\W_])secrets?[\W_]?/i,                  class: 'credentials',  severity: 'critical', reason: 'filename contains "secret"' },
  { rx: /(^|[\W_])passwords?[\W_]?/i,                class: 'credentials',  severity: 'critical', reason: 'filename contains "password"' },
  { rx: /id_(rsa|ed25519|ecdsa|dsa)/i,               class: 'ssh_key',      severity: 'critical', reason: 'SSH private key filename pattern' },
  { rx: /\.(csv|tsv|xlsx|xls|ods|parquet)$/i,        class: 'tabular_data', severity: 'high',     reason: 'spreadsheet/tabular file (often customer data)' },
  { rx: /\.(sql|sqlite|db|dump|bak)$/i,              class: 'database',     severity: 'high',     reason: 'database file or backup' },
  { rx: /\.(har)$/i,                                 class: 'network_har',  severity: 'high',     reason: 'HAR file (browser network log, may contain tokens)' },
  { rx: /\.(pdf|docx|doc|odt|rtf|pages)$/i,          class: 'document',     severity: 'moderate', reason: 'document file' },
  { rx: /\.(zip|7z|rar|tar|tar\.gz|tgz)$/i,          class: 'archive',      severity: 'moderate', reason: 'archive (contents not inspected)' },
  { rx: /\.(json|ya?ml|toml|ini|conf|config|cfg)$/i, class: 'config',       severity: 'moderate', reason: 'configuration file' },
  { rx: /\.(js|ts|tsx|jsx|py|rb|go|rs|java|cs|cpp|c|h|swift|kt|php)$/i, class: 'source_code', severity: 'low', reason: 'source code file' },
  { rx: /\.(md|markdown|txt|log)$/i,                 class: 'plain_text',   severity: 'low',      reason: 'plain text / markdown' },
  { rx: /\.(png|jpe?g|gif|webp|svg|bmp|ico)$/i,      class: 'image',        severity: 'low',      reason: 'image file' },
  { rx: /\.(mp3|mp4|mov|avi|wav|flac|webm|mkv)$/i,   class: 'media',        severity: 'low',      reason: 'media file' },
];

export function classifyFile(name) {
  for (const r of FILE_RULES) {
    if (r.rx.test(name)) return { class: r.class, severity: r.severity, reason: r.reason };
  }
  return { class: 'other', severity: 'low', reason: 'unclassified file type' };
}

export function sizeBucket(bytes) {
  if (bytes < 1024)              return '<1KB';
  if (bytes < 10 * 1024)         return '1-10KB';
  if (bytes < 100 * 1024)        return '10-100KB';
  if (bytes < 1024 * 1024)       return '100KB-1MB';
  if (bytes < 10 * 1024 * 1024)  return '1-10MB';
  if (bytes < 100 * 1024 * 1024) return '10-100MB';
  return '>100MB';
}

// Filenames whose extension we'll read as UTF-8 text and scan for patterns.
// Anything not in this set is reported with filename metadata only (no
// content scan). Mirrors browser extension's TEXT_READABLE_EXTENSIONS.
const TEXT_READABLE = new Set([
  '.txt', '.md', '.markdown', '.log',
  '.csv', '.tsv',
  '.json', '.yml', '.yaml', '.toml', '.ini', '.conf', '.config', '.cfg',
  '.env',
  '.js', '.ts', '.tsx', '.jsx', '.mjs', '.cjs',
  '.py', '.rb', '.go', '.rs', '.java', '.cs', '.cpp', '.c', '.h',
  '.swift', '.kt', '.php',
  '.sql',
  '.html', '.htm', '.xml',
  '.pem', '.key',  // these are usually base64-text key files
]);

const CONTENT_SCAN_MAX_BYTES = 5 * 1024 * 1024;   // 5 MB cap

export function isTextReadable(filename) {
  const lower = filename.toLowerCase();
  // Match by suffix so foo.env, .env, .env.local all hit.
  if (/(^|[\\/])\.env(\.|$)/.test(lower)) return true;
  const dot = lower.lastIndexOf('.');
  if (dot < 0) return false;
  return TEXT_READABLE.has(lower.slice(dot));
}

// Binary file formats we can extract text from with a Node-side parser.
// (Differ from TEXT_READABLE because they need a dedicated decoder.)
const BINARY_PARSEABLE = new Set([
  '.docx',  // mammoth
  '.pdf',   // pdf-parse
  '.xlsx', '.xls',  // xlsx (SheetJS)
]);
const IMAGE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp',
]);
const ARCHIVE_EXTENSIONS = new Set([
  '.zip',  // jszip
]);

export function isBinaryParseable(filename) {
  const lower = filename.toLowerCase();
  const dot = lower.lastIndexOf('.');
  if (dot < 0) return false;
  return BINARY_PARSEABLE.has(lower.slice(dot));
}

export function isImage(filename) {
  const lower = filename.toLowerCase();
  const dot = lower.lastIndexOf('.');
  if (dot < 0) return false;
  return IMAGE_EXTENSIONS.has(lower.slice(dot));
}

export function isArchive(filename) {
  const lower = filename.toLowerCase();
  const dot = lower.lastIndexOf('.');
  if (dot < 0) return false;
  return ARCHIVE_EXTENSIONS.has(lower.slice(dot));
}

export function extOf(filename) {
  const lower = filename.toLowerCase();
  const dot = lower.lastIndexOf('.');
  return dot < 0 ? '' : lower.slice(dot);
}

export { CONTENT_SCAN_MAX_BYTES };


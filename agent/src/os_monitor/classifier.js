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

  // ===== GUARDRAILS — Prompt Injection =====
  { name: 'injection-ignore-instructions', class: 'guardrail', regex: /(ignore|forget|disregard|override|skip|drop|abandon|do\s+not\s+follow)\s+(all\s+|any\s+|every\s+)?(previous|prior|above|earlier|system|original|initial|given|existing|preset|default|my|your)\s+(instructions|prompts?|rules|guidelines|directives|constraints|programming|training)/ig, severity: 'critical' },
  { name: 'injection-system-markers',      class: 'guardrail', regex: /\[SYSTEM\]|###\s*System\s*:|<\/?s>|\[INST\]|\[\/INST\]|<\|im_start\|>|<\|endoftext\|>|<\|assistant\|>|<<SYS>>|<\/SYS>/ig, severity: 'high' },
  { name: 'injection-override-safety',     class: 'guardrail', regex: /\b(override\s+(your\s+|the\s+)?(safety|filters?|restrictions?|guardrails?|moderation|protections?|content\s+(policy|filter))|disable\s+(your\s+|the\s+)?(safety|filters?|content\s+filter|moderation|protections?)|bypass\s+(your\s+|the\s+)?(security|restrictions?|guardrails?|content\s+policy|filters?|safety|moderation)|turn\s+off\s+(your\s+|the\s+)?(safety|filters?|restrictions?|moderation|guardrails?|content\s+filter)|drop\s+(all\s+)?(your\s+)?(safety|filters?|restrictions?|guardrails?|guidelines?))\b/ig, severity: 'critical' },
  { name: 'injection-extract-system',      class: 'guardrail', regex: /(output|print|show|display|reveal|repeat|leak|share|give|provide|tell|explain|describe|copy|paste|dump|what\s+(is|are))\s+(me\s+)?(your|the)\s+(system\s+prompt|system\s+instructions|instructions|initial\s+prompt|hidden\s+prompt|original\s+instructions|internal\s+rules|internal\s+instructions|configuration|setup\s+prompt|base\s+prompt|pre[\s-]?prompt|meta[\s-]?prompt|source\s+code|training\s+data|weights|parameters)/ig, severity: 'high' },
  { name: 'injection-new-identity',        class: 'guardrail', regex: /(you\s+are\s+now|from\s+now\s+(on\s+)?you\s+are|I\s+want\s+you\s+to\s+be|you\s+will\s+(now\s+)?act\s+as|you\s+must\s+now\s+be|switch\s+to\s+being|act\s+like\s+you\s+are|behave\s+like\s+you\s+are|pretend\s+you\s+are|you\s+are)\s+(a\s+|an\s+)?(different|new|unrestricted|uncensored|unfiltered|evil|malicious|rogue|unethical|amoral|dark|shadow|alter\s+ego|villainous|corrupt|sinister)/ig, severity: 'critical' },
  { name: 'injection-no-restrictions',     class: 'guardrail', regex: /(without|with\s+no|dont\s+have|don'?t\s+have|have\s+no|no|free\s+from|remove\s+all|drop\s+all|zero)\s+(any\s+)?(restrictions?|filters?|limits?|limitations?|boundaries|constraints|rules|guidelines|guardrails?|safety|ethics|morals)/ig, severity: 'critical' },
  { name: 'injection-pretend-no-rules',    class: 'guardrail', regex: /(pretend|imagine|suppose|assume|act\s+(like|as\s+if)|behave\s+as\s+if)\s+(you\s+)?(have\s+no|don'?t\s+have|are\s+free\s+from|are\s+without|aren'?t\s+bound\s+by|can\s+ignore|are\s+not\s+limited|have\s+zero|lack\s+any)\s*(rules|restrictions|guidelines|safety|filters|limits|ethical|moral|boundaries|constraints|policies|guardrails)/ig, severity: 'critical' },
  { name: 'injection-roleplay-dangerous',  class: 'guardrail', regex: /\b(act|behave|respond|operate|pretend\s+to\s+be|you\s+are)\s+(as\s+|like\s+)?(a\s+|an\s+)?(hacker|criminal|terrorist|drug\s+dealer|assassin|hitman|serial\s+killer|thief|scammer|fraudster|spy|black\s+hat|malware\s+developer|bomb\s+maker|weapons?\s+dealer)\b/ig, severity: 'high' },
  { name: 'injection-forget-identity',     class: 'guardrail', regex: /(forget|stop\s+being|you\s+are\s+no\s+longer|you\s+are\s+not|don'?t\s+be|forget\s+(that\s+)?you\s+are)\s+(a\s+|an\s+)?(ChatGPT|GPT|Claude|Gemini|Copilot|Bard|assistant|AI\s+assistant|helpful\s+assistant|language\s+model|LLM|AI|chatbot|bot)/ig, severity: 'high' },

  // ===== GUARDRAILS — Jailbreak =====
  { name: 'jailbreak-dan',              class: 'guardrail', regex: /\b(do\s+anything\s+now|D[\s.-]*A[\s.-]*N\s+mode|D[\s.-]*A[\s.-]*N\b)/ig, severity: 'critical' },
  { name: 'jailbreak-developer-mode',   class: 'guardrail', regex: /\b(enable|activate|enter|unlock|switch\s+to|turn\s+on|engage|start|initiate|go\s+into|put\s+.{0,15}\s+in)\s+(your\s+)?(developer\s+mode|dev\s+mode|god\s+mode|sudo\s+mode|root\s+mode|debug\s+mode|maintenance\s+mode|super\s+user\s+mode|admin\s+mode)\b|\b(developer\s+mode|dev\s+mode|god\s+mode|sudo\s+mode|root\s+mode|super\s+user\s+mode|admin\s+mode)\s+(enabled|activated|on|engaged|unlocked|active)\b/ig, severity: 'critical' },
  { name: 'jailbreak-no-ethics',        class: 'guardrail', regex: /\b(without|no|ignore|disable|remove|drop|abandon|suspend|free\s+from)\s+(any\s+)?(ethical|moral|safety|content)?\s*(ethics|morals|morality|guidelines|constraints|restrictions|rules|filters|boundaries|limits|policies|standards|principles)/ig, severity: 'critical' },
  { name: 'jailbreak-bypass-policy',    class: 'guardrail', regex: /\b(bypass|circumvent|evade|get\s+around|work\s+around|trick|fool|break\s+through|escape|avoid|subvert|sidestep|override|hack)\s+(the\s+)?(content\s+policy|safety\s+filters?|moderation|content\s+filters?|AI\s+restrictions?|safety\s+measures?|safety\s+protocols?|usage\s+policy|terms\s+of\s+service|guardrails?|content\s+guidelines?)/ig, severity: 'high' },
  { name: 'jailbreak-fiction-excuse',   class: 'guardrail', regex: /\b(this\s+is\s+(just\s+|only\s+)?(a\s+)?(fiction|hypothetical|thought\s+experiment|dream|fantasy|game|joke|test|scenario|simulation|story|movie\s+script|creative\s+exercise|role\s*play)|for\s+(research|educational|academic|creative\s+writing|a\s+novel|a\s+story|a\s+movie|a\s+screenplay|science|testing)\s+(purposes?|only|reasons?)?|in\s+a\s+(fictional|hypothetical|imaginary|alternate|dream)\s+(world|universe|scenario|reality)\s+where|purely\s+(hypothetical|academic|theoretical|fictional))\b/ig, severity: 'high' },
  { name: 'jailbreak-keyword',          class: 'guardrail', regex: /\b(jailbreak|jailbroken)\s+(this|the|you|your|it|chatgpt|gpt|claude|gemini|copilot|ai|model|llm|chatbot)\b|\b(uncensored\s+mode|unrestricted\s+mode|unfiltered\s+mode|unlocked\s+mode|no[\s-]?filter\s+mode|raw\s+mode|unhinged\s+mode|chaos\s+mode|evil\s+mode|beast\s+mode|unshackled)\b/ig, severity: 'critical' },
  { name: 'jailbreak-opposite-day',     class: 'guardrail', regex: /\b(opposite\s+day|opposite\s+mode|do\s+the\s+opposite|reverse\s+your\s+rules|invert\s+your\s+(rules|guidelines|restrictions)|answer\s+the\s+opposite)\b/ig, severity: 'high' },
  { name: 'jailbreak-lets-go-crazy',    class: 'guardrail', regex: /\b(let'?s?\s+go\s+crazy|go\s+wild|go\s+nuts|anything\s+goes|no\s+holds?\s+barr?ed|gloves?\s+(are\s+)?off|all\s+bets?\s+(are\s+)?off|let\s+loose)\b/ig, severity: 'high' },

  // ===== GUARDRAILS — Toxicity =====
  { name: 'toxicity-hate-request',      class: 'guardrail', regex: /\b(write|generate|create|compose|draft|make|give\s+me|produce|come\s+up\s+with)\s+(a\s+|an\s+|me\s+a\s+|me\s+an\s+)?(hateful|racist|sexist|homophobic|antisemitic|islamophobic|xenophobic|violent|threatening|abusive|derogatory|discriminatory|offensive|bigoted|hate)\s+(rant|message|letter|speech|post|comment|text|essay|article|joke|poem|story|song|script|content)\b/ig, severity: 'critical' },
  { name: 'toxicity-harm-instructions', class: 'guardrail', regex: /\b(how\s+(to|can\s+I|do\s+(I|you|we))|steps\s+to|guide\s+(to|for|on)|teach\s+me\s+(to|how)|instructions?\s+(for|to|on)|ways?\s+to)\s+(make\s+(a\s+)?bombs?|make\s+(a\s+)?drugs?|make\s+(a\s+)?weapons?|make\s+(a\s+)?poison|make\s+(a\s+)?explosives?|make\s+(a\s+)?guns?|build\s+(a\s+)?weapons?|create\s+poison|hack\s+into|break\s+into|kill\s+(a\s+person|someone|people|myself)|attack\s+someone|harm\s+(someone|people|a\s+person)|manufacture\s+(drugs|explosives|weapons|meth|fentanyl)|synthesize\s+(drugs|poison|toxins?)|cook\s+meth)/ig, severity: 'critical' },
  { name: 'toxicity-explicit-content',  class: 'guardrail', regex: /\b(generate|write|create|produce|give|make|compose|describe|show|send)\s+(me\s+)?(some\s+)?(explicit|pornographic|nsfw|sexual|sexually\s+explicit|graphic\s+sexual|erotic|adult|xxx|x[\s-]?rated|obscene|indecent|lewd|nude|naked)\s+(content|story|stories|text|images?|fiction|scene|scenarios?|fantasy|fantasies|material|writing|narrative|stuff|things?|pics?|pictures?|photos?|videos?)\b/ig, severity: 'high' },
  { name: 'toxicity-self-harm',         class: 'guardrail', regex: /\b(how\s+(to|can\s+I|do\s+I|could\s+I|should\s+I)\s+(commit\s+suicide|hurt\s+myself|self[\s-]?harm|end\s+my\s+life|kill\s+myself|cut\s+myself|overdose|harm\s+myself|injure\s+myself)|methods?\s+(of|for)\s+(suicide|self[\s-]?harm|ending\s+(my|one'?s|your)\s+life|killing\s+(myself|yourself|oneself))|best\s+way\s+to\s+(die|kill\s+myself|end\s+it|commit\s+suicide)|painless\s+(way|method)\s+to\s+(die|suicide))\b/ig, severity: 'critical' },
  { name: 'toxicity-group-attack',      class: 'guardrail', regex: /\b(all\s+)?(blacks?|whites?|jews?|muslims?|christians?|hispanics?|latinos?|asians?|women|men|gays?|lesbians?|trans|transgender|immigrants?|refugees?|mexicans?|arabs?|indians?|chinese|africans?)\s+(are|is)\s+(inferior|stupid|evil|dangerous|criminals?|subhuman|worthless|lazy|dirty|disgusting|vermin|animals?|pests?|a\s+plague|a\s+cancer|a\s+disease|parasites?|trash|scum|the\s+worst|the\s+problem|ruining|terrible|horrible|bad\s+people)/ig, severity: 'critical' },

  // ===== GUARDRAILS — Bias Probing =====
  { name: 'bias-demographic-comparison', class: 'guardrail', regex: /\b(which|what)\s+(race|gender|ethnicity|religion|nationality|sex|ethnic\s+group|religious\s+group|caste|community)\s+(is|are)\s+(the\s+)?(best|better|worse|worst|greatest|superior|inferior|smarter|dumber|strongest|weakest|more\s+(intelligent|violent|lazy|criminal|dangerous|hardworking|trustworthy|dishonest|advanced|civilized|primitive)|most\s+(intelligent|violent|lazy|criminal|dangerous|hardworking|trustworthy|dishonest|advanced|civilized|primitive)|less\s+(intelligent|capable|trustworthy|civilized))/ig, severity: 'high' },
  { name: 'bias-stereotype-request',    class: 'guardrail', regex: /\b(list|tell\s+me|explain|describe|give\s+me|what\s+are)\s+(the\s+)?(stereotypes?|prejudices?|negative\s+traits?|negative\s+characteristics?|problems?\s+with|issues?\s+with|what'?s\s+wrong\s+with)\s+(about|of|for|against|with)\s+/ig, severity: 'high' },
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

// ── Server-driven pattern policy ─────────────────────────────────────────────
// policy-sync.js mirrors GET /api/policy-packs/extension-config here, so a
// deployed compliance pack governs desktop detection the same way it governs the
// browser extension.
//
// Until a policy arrives — and whenever the server is unreachable or returns
// something malformed — POLICY stays null and every pattern runs at its built-in
// severity. Losing contact with the server must never quietly reduce detection.
let POLICY = null;

function isEnabled(name) {
  if (!POLICY) return true;
  const p = POLICY.patterns && POLICY.patterns[name];
  return !p || p.enabled !== false;
}

// A pack may grade a pattern higher than the catalog does (a phone number is a
// HIPAA identifier even though the catalog calls it 'low'). Only ever stricter.
const SEV_RANK = { low: 1, moderate: 2, medium: 2, high: 3, critical: 4 };
function effectiveSeverity(p) {
  const override = POLICY?.patterns?.[p.name]?.severity;
  if (!override) return p.severity;
  return (SEV_RANK[override] || 0) > (SEV_RANK[p.severity] || 0) ? override : p.severity;
}

function activePatterns() {
  return PATTERNS.filter((p) => isEnabled(p.name));
}

/**
 * Install a policy. Returns a small summary so the caller can log what changed.
 * Passing null/garbage reverts to built-in defaults rather than disabling
 * everything.
 */
export function applyPolicy(policy) {
  POLICY = policy && typeof policy === 'object' && policy.patterns ? policy : null;
  return {
    version: POLICY?.version || null,
    active: activePatterns().length,
    total: PATTERNS.length,
  };
}

export function policyState() {
  return {
    version: POLICY?.version || null,
    source: POLICY ? 'server' : 'built-in defaults',
    active: activePatterns().map((p) => p.name),
    disabled: PATTERNS.filter((p) => !isEnabled(p.name)).map((p) => p.name),
  };
}

/**
 * Block patterns under the current policy — the keystroke blocker's rule set.
 *
 * BLOCK_PATTERNS above stays exported unchanged for callers that want the static
 * catalog, but the enforcer must use THIS so a disabled pattern stops being
 * blocked and an escalated one starts being blocked. Detection and blocking
 * disagreeing is the failure that matters: a pattern reported as critical while
 * the blocker ignores it looks like enforcement and is not.
 */
export function getBlockPatterns() {
  return activePatterns()
    .filter((p) => {
      const sev = effectiveSeverity(p);
      return (sev === 'high' || sev === 'critical') && !p.validate;
    })
    .map((p) => ({ name: p.name, source: p.regex.source, severity: effectiveSeverity(p) }));
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

// Scan text and return { matches, highestSeverity }. Never returns the raw
// match value — the governance server only ever sees pattern names + counts.
export function scan(text) {
  if (!text || typeof text !== 'string') {
    return { matches: [], highestSeverity: null };
  }
  const matches = [];
  for (const p of activePatterns()) {
    p.regex.lastIndex = 0;
    let n = 0; let m;
    while ((m = p.regex.exec(text)) !== null) {
      if (p.validate && !p.validate(m[0])) continue;
      n++;
    }
    if (n > 0) {
      matches.push({ pattern: p.name, class: p.class, severity: effectiveSeverity(p), count: n });
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


// Pattern catalog for sensitive data detection. Patterns mirror the agent's
// key catalog plus PII categories. We only return pattern class names — never
// the matched value, never the content around it.
//
// This file is plain (non-module) JS so manifest content_scripts can load it.

(function () {
  // ── one evaluation per document ────────────────────────────────────────────
  // Injected twice on any host that is in BOTH manifest.json's hardcoded
  // content_scripts list AND the service worker's injectDlpStack() list (see the
  // long note at the top of content/content.js). Most of this file is pure — the
  // pattern/rule tables have no side effects and re-declaring them would be
  // harmless — but two things below are NOT:
  //
  //   • setInterval(tokenVault.gc, 5 min) — a second, orphaned GC timer per
  //     injection, for the life of the page.
  //   • window.__cfaiTokenVault / window.__cfaiPatterns are REPLACED with a fresh
  //     vault whose _map is empty. Tokens minted before the second injection are
  //     then unrecoverable: restoreTokens() no longer knows them, so a tokenized
  //     send would go out with [CFAI:…] placeholders that can never be resolved.
  //
  // So this file gets the same window-level guard content.js has.
  if (window.__cfaiPatternsLoaded) return;
  window.__cfaiPatternsLoaded = true;

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

    // ===== GUARDRAILS — Prompt Injection =====
    { name: 'injection-ignore-instructions', class: 'guardrail', category: 'prompt_injection', regex: /(ignore|forget|disregard|override|skip|drop|abandon|do\s+not\s+follow)\s+(all\s+|any\s+|every\s+)?(previous|prior|above|earlier|system|original|initial|given|existing|preset|default|my|your)\s+(instructions|prompts?|rules|guidelines|directives|constraints|programming|training)/ig, severity: 'critical' },
    { name: 'injection-system-markers',      class: 'guardrail', category: 'prompt_injection', regex: /\[SYSTEM\]|###\s*System\s*:|<\/?s>|\[INST\]|\[\/INST\]|<\|im_start\|>|<\|endoftext\|>|<\|assistant\|>|<<SYS>>|<\/SYS>/ig, severity: 'high' },
    { name: 'injection-override-safety',     class: 'guardrail', category: 'prompt_injection', regex: /\b(override\s+(your\s+|the\s+)?(safety|filters?|restrictions?|guardrails?|moderation|protections?|content\s+(policy|filter))|disable\s+(your\s+|the\s+)?(safety|filters?|content\s+filter|moderation|protections?)|bypass\s+(your\s+|the\s+)?(security|restrictions?|guardrails?|content\s+policy|filters?|safety|moderation)|turn\s+off\s+(your\s+|the\s+)?(safety|filters?|restrictions?|moderation|guardrails?|content\s+filter)|drop\s+(all\s+)?(your\s+)?(safety|filters?|restrictions?|guardrails?|guidelines?))\b/ig, severity: 'critical' },
    { name: 'injection-extract-system',      class: 'guardrail', category: 'prompt_injection', regex: /(output|print|show|display|reveal|repeat|leak|share|give|provide|tell|explain|describe|copy|paste|dump|what\s+(is|are))\s+(me\s+)?(your|the)\s+(system\s+prompt|system\s+instructions|instructions|initial\s+prompt|hidden\s+prompt|original\s+instructions|internal\s+rules|internal\s+instructions|configuration|setup\s+prompt|base\s+prompt|pre[\s-]?prompt|meta[\s-]?prompt|source\s+code|training\s+data|weights|parameters)/ig, severity: 'high' },
    { name: 'injection-new-identity',        class: 'guardrail', category: 'prompt_injection', regex: /(you\s+are\s+now|from\s+now\s+(on\s+)?you\s+are|I\s+want\s+you\s+to\s+be|you\s+will\s+(now\s+)?act\s+as|you\s+must\s+now\s+be|switch\s+to\s+being|act\s+like\s+you\s+are|behave\s+like\s+you\s+are|pretend\s+you\s+are|you\s+are)\s+(a\s+|an\s+)?(different|new|unrestricted|uncensored|unfiltered|evil|malicious|rogue|unethical|amoral|dark|shadow|alter\s+ego|villainous|corrupt|sinister)/ig, severity: 'critical' },
    { name: 'injection-no-restrictions',     class: 'guardrail', category: 'prompt_injection', regex: /(without|with\s+no|dont\s+have|don'?t\s+have|have\s+no|no|free\s+from|remove\s+all|drop\s+all|zero)\s+(any\s+)?(restrictions?|filters?|limits?|limitations?|boundaries|constraints|rules|guidelines|guardrails?|safety|ethics|morals)/ig, severity: 'critical' },
    { name: 'injection-pretend-no-rules',    class: 'guardrail', category: 'prompt_injection', regex: /(pretend|imagine|suppose|assume|act\s+(like|as\s+if)|behave\s+as\s+if)\s+(you\s+)?(have\s+no|don'?t\s+have|are\s+free\s+from|are\s+without|aren'?t\s+bound\s+by|can\s+ignore|are\s+not\s+limited|have\s+zero|lack\s+any)\s*(rules|restrictions|guidelines|safety|filters|limits|ethical|moral|boundaries|constraints|policies|guardrails)/ig, severity: 'critical' },
    { name: 'injection-roleplay-dangerous',  class: 'guardrail', category: 'prompt_injection', regex: /\b(act|behave|respond|operate|pretend\s+to\s+be|you\s+are)\s+(as\s+|like\s+)?(a\s+|an\s+)?(hacker|criminal|terrorist|drug\s+dealer|assassin|hitman|serial\s+killer|thief|scammer|fraudster|spy|black\s+hat|malware\s+developer|bomb\s+maker|weapons?\s+dealer)\b/ig, severity: 'high' },
    { name: 'injection-forget-identity',     class: 'guardrail', category: 'prompt_injection', regex: /(forget|stop\s+being|you\s+are\s+no\s+longer|you\s+are\s+not|don'?t\s+be|forget\s+(that\s+)?you\s+are)\s+(a\s+|an\s+)?(ChatGPT|GPT|Claude|Gemini|Copilot|Bard|assistant|AI\s+assistant|helpful\s+assistant|language\s+model|LLM|AI|chatbot|bot)/ig, severity: 'high' },

    // ===== GUARDRAILS — Jailbreak =====
    { name: 'jailbreak-dan',              class: 'guardrail', regex: /\b(do\s+anything\s+now|D[\s.-]*A[\s.-]*N\s+mode|D[\s.-]*A[\s.-]*N\b)/ig, severity: 'critical', category: 'jailbreak' },
    { name: 'jailbreak-developer-mode',   class: 'guardrail', regex: /\b(enable|activate|enter|unlock|switch\s+to|turn\s+on|engage|start|initiate|go\s+into|put\s+.{0,15}\s+in)\s+(your\s+)?(developer\s+mode|dev\s+mode|god\s+mode|sudo\s+mode|root\s+mode|debug\s+mode|maintenance\s+mode|super\s+user\s+mode|admin\s+mode)\b|\b(developer\s+mode|dev\s+mode|god\s+mode|sudo\s+mode|root\s+mode|super\s+user\s+mode|admin\s+mode)\s+(enabled|activated|on|engaged|unlocked|active)\b/ig, severity: 'critical', category: 'jailbreak' },
    { name: 'jailbreak-no-ethics',        class: 'guardrail', regex: /\b(without|no|ignore|disable|remove|drop|abandon|suspend|free\s+from)\s+(any\s+)?(ethical|moral|safety|content)?\s*(ethics|morals|morality|guidelines|constraints|restrictions|rules|filters|boundaries|limits|policies|standards|principles)/ig, severity: 'critical', category: 'jailbreak' },
    { name: 'jailbreak-bypass-policy',    class: 'guardrail', regex: /\b(bypass|circumvent|evade|get\s+around|work\s+around|trick|fool|break\s+through|escape|avoid|subvert|sidestep|override|hack)\s+(the\s+)?(content\s+policy|safety\s+filters?|moderation|content\s+filters?|AI\s+restrictions?|safety\s+measures?|safety\s+protocols?|usage\s+policy|terms\s+of\s+service|guardrails?|content\s+guidelines?)/ig, severity: 'high', category: 'jailbreak' },
    { name: 'jailbreak-fiction-excuse',   class: 'guardrail', regex: /\b(this\s+is\s+(just\s+|only\s+)?(a\s+)?(fiction|hypothetical|thought\s+experiment|dream|fantasy|game|joke|test|scenario|simulation|story|movie\s+script|creative\s+exercise|role\s*play)|for\s+(research|educational|academic|creative\s+writing|a\s+novel|a\s+story|a\s+movie|a\s+screenplay|science|testing)\s+(purposes?|only|reasons?)?|in\s+a\s+(fictional|hypothetical|imaginary|alternate|dream)\s+(world|universe|scenario|reality)\s+where|purely\s+(hypothetical|academic|theoretical|fictional))\b/ig, severity: 'high', category: 'jailbreak' },
    { name: 'jailbreak-keyword',          class: 'guardrail', regex: /\b(jailbreak|jailbroken)\s+(this|the|you|your|it|chatgpt|gpt|claude|gemini|copilot|ai|model|llm|chatbot)\b|\b(uncensored\s+mode|unrestricted\s+mode|unfiltered\s+mode|unlocked\s+mode|no[\s-]?filter\s+mode|raw\s+mode|unhinged\s+mode|chaos\s+mode|evil\s+mode|beast\s+mode|unshackled)\b/ig, severity: 'critical', category: 'jailbreak' },
    { name: 'jailbreak-opposite-day',     class: 'guardrail', regex: /\b(opposite\s+day|opposite\s+mode|do\s+the\s+opposite|reverse\s+your\s+rules|invert\s+your\s+(rules|guidelines|restrictions)|answer\s+the\s+opposite)\b/ig, severity: 'high', category: 'jailbreak' },
    { name: 'jailbreak-lets-go-crazy',    class: 'guardrail', regex: /\b(let'?s?\s+go\s+crazy|go\s+wild|go\s+nuts|anything\s+goes|no\s+holds?\s+barr?ed|gloves?\s+(are\s+)?off|all\s+bets?\s+(are\s+)?off|let\s+loose)\b/ig, severity: 'high', category: 'jailbreak' },

    // ===== GUARDRAILS — Toxicity =====
    { name: 'toxicity-hate-request',      class: 'guardrail', regex: /\b(write|generate|create|compose|draft|make|give\s+me|produce|come\s+up\s+with)\s+(a\s+|an\s+|me\s+a\s+|me\s+an\s+)?(hateful|racist|sexist|homophobic|antisemitic|islamophobic|xenophobic|violent|threatening|abusive|derogatory|discriminatory|offensive|bigoted|hate)\s+(rant|message|letter|speech|post|comment|text|essay|article|joke|poem|story|song|script|content)\b/ig, severity: 'critical', category: 'toxicity' },
    { name: 'toxicity-harm-instructions', class: 'guardrail', regex: /\b(how\s+(to|can\s+I|do\s+(I|you|we))|steps\s+to|guide\s+(to|for|on)|teach\s+me\s+(to|how)|instructions?\s+(for|to|on)|ways?\s+to)\s+(make\s+(a\s+)?bombs?|make\s+(a\s+)?drugs?|make\s+(a\s+)?weapons?|make\s+(a\s+)?poison|make\s+(a\s+)?explosives?|make\s+(a\s+)?guns?|build\s+(a\s+)?weapons?|create\s+poison|hack\s+into|break\s+into|kill\s+(a\s+person|someone|people|myself)|attack\s+someone|harm\s+(someone|people|a\s+person)|manufacture\s+(drugs|explosives|weapons|meth|fentanyl)|synthesize\s+(drugs|poison|toxins?)|cook\s+meth)/ig, severity: 'critical', category: 'toxicity' },
    { name: 'toxicity-explicit-content',  class: 'guardrail', regex: /\b(generate|write|create|produce|give|make|compose|describe|show|send)\s+(me\s+)?(some\s+)?(explicit|pornographic|nsfw|sexual|sexually\s+explicit|graphic\s+sexual|erotic|adult|xxx|x[\s-]?rated|obscene|indecent|lewd|nude|naked)\s+(content|story|stories|text|images?|fiction|scene|scenarios?|fantasy|fantasies|material|writing|narrative|stuff|things?|pics?|pictures?|photos?|videos?)\b/ig, severity: 'high', category: 'toxicity' },
    { name: 'toxicity-self-harm',         class: 'guardrail', regex: /\b(how\s+(to|can\s+I|do\s+I|could\s+I|should\s+I)\s+(commit\s+suicide|hurt\s+myself|self[\s-]?harm|end\s+my\s+life|kill\s+myself|cut\s+myself|overdose|harm\s+myself|injure\s+myself)|methods?\s+(of|for)\s+(suicide|self[\s-]?harm|ending\s+(my|one'?s|your)\s+life|killing\s+(myself|yourself|oneself))|best\s+way\s+to\s+(die|kill\s+myself|end\s+it|commit\s+suicide)|painless\s+(way|method)\s+to\s+(die|suicide))\b/ig, severity: 'critical', category: 'toxicity' },
    { name: 'toxicity-group-attack',      class: 'guardrail', regex: /\b(all\s+)?(blacks?|whites?|jews?|muslims?|christians?|hispanics?|latinos?|asians?|women|men|gays?|lesbians?|trans|transgender|immigrants?|refugees?|mexicans?|arabs?|indians?|chinese|africans?)\s+(are|is)\s+(inferior|stupid|evil|dangerous|criminals?|subhuman|worthless|lazy|dirty|disgusting|vermin|animals?|pests?|a\s+plague|a\s+cancer|a\s+disease|parasites?|trash|scum|the\s+worst|the\s+problem|ruining|terrible|horrible|bad\s+people)/ig, severity: 'critical', category: 'toxicity' },

    // ===== GUARDRAILS — Bias Probing =====
    { name: 'bias-demographic-comparison', class: 'guardrail', regex: /\b(which|what)\s+(race|gender|ethnicity|religion|nationality|sex|ethnic\s+group|religious\s+group|caste|community)\s+(is|are)\s+(the\s+)?(best|better|worse|worst|greatest|superior|inferior|smarter|dumber|strongest|weakest|more\s+(intelligent|violent|lazy|criminal|dangerous|hardworking|trustworthy|dishonest|advanced|civilized|primitive)|most\s+(intelligent|violent|lazy|criminal|dangerous|hardworking|trustworthy|dishonest|advanced|civilized|primitive)|less\s+(intelligent|capable|trustworthy|civilized))/ig, severity: 'high', category: 'bias' },
    { name: 'bias-stereotype-request',    class: 'guardrail', regex: /\b(list|tell\s+me|explain|describe|give\s+me|what\s+are)\s+(the\s+)?(stereotypes?|prejudices?|negative\s+traits?|negative\s+characteristics?|problems?\s+with|issues?\s+with|what'?s\s+wrong\s+with)\s+(about|of|for|against|with)\s+/ig, severity: 'high', category: 'bias' },

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

  // Redaction labels keyed by pattern name. These are what the AI actually
  // receives in place of the sensitive value, so they are kept short and
  // self-describing. Two hard constraints:
  //   1. No label may itself match any pattern above — otherwise redact() output
  //      would be re-matchable and idempotence breaks (asserted in the tests).
  //   2. Labels are FIXED per pattern: repeated matches share one label, with no
  //      positional numbering, so nothing about the original can be inferred.
  const REDACT_LABELS = {
    'openai-api-key':       '[API-KEY]',
    'anthropic-api-key':    '[API-KEY]',
    'google-api-key':       '[API-KEY]',
    'huggingface-token':    '[API-KEY]',
    'github-pat':           '[GITHUB-TOKEN]',
    'gitlab-pat':           '[GITLAB-TOKEN]',
    'aws-access-key':       '[AWS-KEY]',
    'gcp-service-key':      '[GCP-KEY]',
    'slack-token':          '[SLACK-TOKEN]',
    'jwt':                  '[JWT]',
    'us-ssn':               '[SSN]',
    'credit-card':          '[CREDIT-CARD]',
    'iban':                 '[IBAN]',
    'us-phone':             '[PHONE]',
    'cloudfuze-customer-id':'[CUSTOMER-ID]',
    'internal-jira-key':    '[INTERNAL-KEY]',
  };

  // Fallback for a pattern with no entry above.
  const REDACT_FALLBACK_LABEL = '[MASKED]';

  // ── One-way redaction internals ─────────────────────────────────────────────
  // Used by redact() only. This is the FIXED-LABEL, STATELESS, ONE-WAY path:
  // no vault, no mapping, no TTL, nothing recoverable. It is deliberately
  // separate from the reversible token vault below.

  const SEVERITY_RANK   = { low: 0, moderate: 1, high: 2, critical: 3 };
  const SEVERITY_NAMES  = new Set(['low', 'moderate', 'high', 'critical']);

  // Hard cap for redaction. Beyond this we degrade gracefully (return the text
  // untouched with reason 'too_large') rather than burn a tab on a 10 MB paste.
  // Mirrors the content-scan caps in content.js.
  const REDACT_MAX_CHARS = 1024 * 1024;   // 1 MB of text

  // Masking passes. One pass handles everything normal; the extra passes exist
  // so a seam created by masking can never leave a detectable value behind.
  const REDACT_MAX_PASSES = 3;

  /**
   * Normalize redact()'s second argument.
   *
   * Preferred form: a list/Set of PATTERN NAMES (what the caller's scan()
   * actually matched in THIS text) — every one of them gets masked regardless
   * of severity.
   *
   * Backward-compatible form: a Set/array of SEVERITY names ('high',
   * 'critical', ...) — kept because older call sites passed BLOCK_SEVERITIES.
   *
   * Omitted/empty → mask every pattern in the catalog that matches.
   */
  function normalizeRedactFilter(filter) {
    if (!filter) return { names: null, severities: null };
    const raw = (filter instanceof Set) ? Array.from(filter)
      : Array.isArray(filter) ? filter
      : [filter];
    const values = raw.filter((v) => typeof v === 'string' && v.length > 0);
    if (values.length === 0) return { names: null, severities: null };
    // Severity names and pattern names never collide, so this is unambiguous.
    if (values.every((v) => SEVERITY_NAMES.has(v))) {
      return { names: null, severities: new Set(values) };
    }
    return { names: new Set(values), severities: null };
  }

  /**
   * Collect EVERY match span in `text` as
   * { start, end, pattern, class, severity, label }.
   *
   * Notes:
   *  - Uses a fresh RegExp per pattern so the shared catalog regex objects
   *    (which scan() also drives) never leak lastIndex state into us.
   *  - When validate() rejects a match (e.g. a Luhn-failing card) we resume
   *    scanning ONE character past the rejected span's start, not past its
   *    end — otherwise a valid number starting inside the rejected run would
   *    be silently skipped.
   */
  function collectRedactSpans(text, filter) {
    const spans = [];
    if (!text || typeof text !== 'string') return spans;
    const f = filter || { names: null, severities: null };
    for (const p of PATTERNS) {
      if (f.names && !f.names.has(p.name)) continue;
      if (f.severities && !f.severities.has(p.severity)) continue;
      const flags = p.regex.flags.includes('g') ? p.regex.flags : p.regex.flags + 'g';
      const rx = new RegExp(p.regex.source, flags);
      const label = REDACT_LABELS[p.name] || REDACT_FALLBACK_LABEL;
      let m;
      while ((m = rx.exec(text)) !== null) {
        const start = m.index;
        const len = m[0].length;
        if (len === 0) { rx.lastIndex = start + 1; continue; }
        if (p.validate && !p.validate(m[0])) { rx.lastIndex = start + 1; continue; }
        spans.push({
          start, end: start + len,
          pattern: p.name, class: p.class, severity: p.severity, label,
        });
        rx.lastIndex = start + len;
      }
    }
    return spans;
  }

  // Precedence between two competing spans:
  // severity desc → longer span → earlier start → pattern name. Total order, so
  // the winner never depends on catalog declaration order or collection order.
  function compareSpanPrecedence(a, b) {
    const sa = SEVERITY_RANK[a.severity] ?? -1;
    const sb = SEVERITY_RANK[b.severity] ?? -1;
    if (sa !== sb) return sb - sa;                       // severity desc
    const la = a.end - a.start, lb = b.end - b.start;
    if (la !== lb) return lb - la;                       // longest span wins
    if (a.start !== b.start) return a.start - b.start;   // earliest start
    if (a.pattern !== b.pattern) return a.pattern < b.pattern ? -1 : 1;
    return 0;
  }

  /**
   * Turn raw spans into non-overlapping regions to mask.
   *
   * Overlapping spans are MERGED (region = union of the overlapping cluster)
   * rather than resolved by dropping the loser. Dropping was a data-leak: for
   * `pay 123-45-6789-000-0007 now` the critical us-ssn span won and the
   * overlapping credit-card span was discarded, so the tail of the card number
   * went out verbatim. Same for an openai key whose regex swallows a trailing
   * AWS key. Masking the union guarantees the feature's core promise — no
   * detected value survives — while precedence still decides which single LABEL
   * the merged region gets.
   *
   * Every contributing span is reported in `members` so `replacements` (and the
   * enforcement_redact audit event) lists every pattern that was actually masked.
   *
   * Returns regions sorted by start offset, ready for one linear splice.
   */
  function resolveRedactSpans(spans) {
    const list = Array.from(spans || []);
    if (list.length === 0) return [];

    // Total order (start, end, pattern) so clustering is deterministic even when
    // two patterns produce the exact same span.
    list.sort((a, b) => (a.start - b.start) || (a.end - b.end) ||
                        (a.pattern < b.pattern ? -1 : a.pattern > b.pattern ? 1 : 0));

    const regions = [];
    let cluster = [list[0]];
    let clusterEnd = list[0].end;

    const flush = () => {
      let winner = cluster[0];
      for (let i = 1; i < cluster.length; i++) {
        if (compareSpanPrecedence(cluster[i], winner) < 0) winner = cluster[i];
      }
      regions.push({
        start: cluster[0].start,          // list is start-sorted, so this is the min
        end: clusterEnd,
        pattern: winner.pattern,
        class: winner.class,
        severity: winner.severity,
        label: winner.label,
        members: cluster.map((s) => ({ pattern: s.pattern, class: s.class, severity: s.severity })),
      });
    };

    for (let i = 1; i < list.length; i++) {
      const s = list[i];
      if (s.start < clusterEnd) {
        cluster.push(s);
        if (s.end > clusterEnd) clusterEnd = s.end;
      } else {
        flush();
        cluster = [s];
        clusterEnd = s.end;
      }
    }
    flush();
    return regions;
  }

  // Single linear pass. The previous implementation spliced the string once per
  // span (`out.slice(0,start) + label + out.slice(end)`), which is quadratic —
  // a 15k-row pasted spreadsheet took ~12s on the main thread, twice per block.
  function spliceRedactRegions(text, regions) {
    const parts = [];
    let cursor = 0;
    for (const r of regions) {
      if (r.start > cursor) parts.push(text.slice(cursor, r.start));
      parts.push(r.label);
      cursor = r.end;
    }
    if (cursor < text.length) parts.push(text.slice(cursor));
    return parts.join('');
  }

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

  function scanAll(text) {
    if (!text || typeof text !== 'string') return [];
    const matches = [];
    for (const p of PATTERNS) {
      p.regex.lastIndex = 0;
      let n = 0;
      let m;
      while ((m = p.regex.exec(text)) !== null) {
        if (m[0].length === 0) { p.regex.lastIndex = m.index + 1; continue; }
        // Rejected by validate() (e.g. Luhn): resume ONE char past the start
        // of the rejected span. Continuing from its end would blind us to a
        // valid value that begins inside the rejected run.
        if (p.validate && !p.validate(m[0])) { p.regex.lastIndex = m.index + 1; continue; }
        n++;
      }
      if (n > 0) {
        matches.push({ pattern: p.name, class: p.class, severity: p.severity, count: n });
      }
    }
    return matches;
  }

  // Rich editors reflow lines into blocks and swap spaces for NBSP / figure
  // space / narrow-NBSP. None of that means a write failed.
  function normalizeWhitespace(s) {
    return String(s ?? '')
      .replace(/[\u00a0\u2007\u202f]/g, ' ')
      .replace(/\r\n?/g, '\n')
      .replace(/[ \t]+$/gm, '')
      .replace(/\n{2,}/g, '\n')
      .trim();
  }

  // Run all patterns on text. Returns an array of { pattern, class, severity, count }.
  // Never returns the matched value.
  window.__cfaiPatterns = {
    classifyFile,
    sizeBucket,
    scan(text) { return scanAll(text); },

    /**
     * The pre-send safety gate for the extension's "Tokenize & Send" flow.
     *
     * Given what a composer NOW reads back, the masked text we intended to put
     * there, and the labels we inserted, decide whether it is safe to let the
     * send proceed. Pure text logic — no DOM — so the rule that guards against
     * leaking unmasked data is unit-testable.
     *
     * A write passes only when NOTHING sensitive is left in the box AND the text
     * is either exactly what we wrote (whitespace-tolerant) or at least carries
     * every label we inserted (rich editors legitimately reflow paragraphs).
     *
     * @returns {{ok, exact, labelsPresent, leftovers: string[], readLength}}
     */
    verifyRedaction(readText, expectedText, labels) {
      const read = typeof readText === 'string' ? readText : '';
      const expected = typeof expectedText === 'string' ? expectedText : '';
      const labelList = Array.isArray(labels)
        ? labels.filter((l) => typeof l === 'string' && l.length > 0)
        : [];

      const exact = normalizeWhitespace(read) === normalizeWhitespace(expected);
      const leftovers = scanAll(read).map((m) => m.pattern);
      const labelsPresent = labelList.length > 0 && labelList.every((l) => read.includes(l));

      return {
        // Fail closed: any pattern still matching in the box vetoes the send,
        // even if the text otherwise looks like what we wrote.
        ok: leftovers.length === 0 && (exact || labelsPresent),
        exact,
        labelsPresent,
        leftovers,
        readLength: read.length,
      };
    },

    /**
     * ONE-WAY redaction. Every matched span becomes a fixed label such as
     * [SSN]. Nothing is stored, nothing is reversible, there is no
     * TTL and no vault — this is NOT tokenize()/restoreTokens().
     *
     * Pure, synchronous, stateless: safe to unit-test without a DOM.
     *
     * @param {string} text
     * @param {string[]|Set<string>} [patternNames]
     *        Pattern names to mask — normally every pattern scan() matched in
     *        THIS text, so everything detected gets masked regardless of
     *        severity. A Set/array of severity names is also accepted for
     *        backward compatibility with older call sites. Omitted → mask
     *        every catalog pattern that matches.
     *
     * @returns {{ redacted: string,
     *             replacements: Array<{pattern,class,severity,label,count}>,
     *             firstOffset: number,
     *             skipped?: boolean, reason?: string }}
     *        `firstOffset` is the offset of the first replaced span in the
     *        ORIGINAL text (-1 when nothing was replaced). Repeated matches of
     *        the same pattern share one identical label — deliberately no
     *        positional numbering.
     */
    redact(text, patternNames) {
      if (!text || typeof text !== 'string') {
        return { redacted: text, replacements: [], firstOffset: -1 };
      }
      if (text.length > REDACT_MAX_CHARS) {
        // Graceful degradation: never mask a giant blob, and never claim we
        // did. Callers treat an empty `replacements` as "cannot mask".
        return { redacted: text, replacements: [], firstOffset: -1, skipped: true, reason: 'too_large' };
      }

      const filter = normalizeRedactFilter(patternNames);
      const tally = new Map();
      let working = text;

      // Converge: masking can in principle leave a seam that matches again, and
      // the promise is that NOTHING detectable survives. Bounded so a pathological
      // input can never spin.
      for (let pass = 0; pass < REDACT_MAX_PASSES; pass++) {
        const regions = resolveRedactSpans(collectRedactSpans(working, filter));
        if (regions.length === 0) break;
        for (const r of regions) {
          for (const m of r.members) {
            const hit = tally.get(m.pattern);
            if (hit) hit.count++;
            else tally.set(m.pattern, {
              pattern: m.pattern, class: m.class, severity: m.severity,
              label: REDACT_LABELS[m.pattern] || REDACT_FALLBACK_LABEL, count: 1,
            });
          }
        }
        working = spliceRedactRegions(working, regions);
      }

      if (working === text) return { redacted: text, replacements: [], firstOffset: -1 };

      // Offset of the first replacement in ORIGINAL coordinates = first position
      // where the masked text diverges from the input.
      let firstOffset = 0;
      const shared = Math.min(text.length, working.length);
      while (firstOffset < shared && text[firstOffset] === working[firstOffset]) firstOffset++;

      const out = {
        redacted: working,
        replacements: Array.from(tally.values()),
        firstOffset,
      };

      // Fail loud rather than silently: anything still detectable after the
      // passes is surfaced so callers can refuse to send.
      const residue = Array.from(new Set(collectRedactSpans(working, filter).map((s) => s.pattern)));
      if (residue.length > 0) out.residual = residue;
      return out;
    },

    /** Exposed for unit tests only — not used by the extension at runtime. */
    __redactInternals: {
      collectRedactSpans, resolveRedactSpans, normalizeRedactFilter,
      spliceRedactRegions, compareSpanPrecedence,
      REDACT_LABELS, REDACT_FALLBACK_LABEL,
      REDACT_MAX_CHARS, REDACT_MAX_PASSES,
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

// AI host classifier — asks an LLM (Anthropic Claude Haiku by default)
// whether a given web host is an AI tool, and how it should be categorized.
//
// CRITICAL PRIVACY RULE
// ─────────────────────
// Only METADATA may flow to the classifier LLM. Never the user's prompt
// text, never response body content, never anything that could itself be
// sensitive. The classifier sees:
//
//   - host name
//   - page title (visible browser-tab title)
//   - meta-description (visible to anyone with View Source)
//   - DOM-heuristic flags (has_chat_input, streams_text, has_send_button)
//   - request body SHAPE tags (e.g. "{messages[], model}") — NOT body content
//
// Violating this rule turns the governance product into the leak it's
// supposed to prevent. The buildClassifierPrompt function below is the
// single chokepoint — review carefully before adding any new field.
//
// FAIL-OPEN BEHAVIOUR
// ───────────────────
// If no ANTHROPIC_API_KEY is configured (dev environments), or the LLM
// call fails (network, rate-limit, parse error), we fall back to a
// deterministic stub classifier that uses host-name + signal heuristics.
// The stub returns a real verdict so the rest of the system keeps working;
// it just produces lower-confidence answers.

const DEFAULT_MODEL    = 'claude-haiku-4-5-20251001';
const REQUEST_TIMEOUT  = 8_000;
const MAX_OUTPUT_TOKENS = 400;

const API_KEY = process.env.ANTHROPIC_API_KEY || null;
const MODEL   = process.env.CFAI_CLASSIFIER_MODEL || DEFAULT_MODEL;

/**
 * Classify a host. Returns a verdict object (see top of file for shape).
 * Never throws — falls back to the stub on any failure.
 *
 * @param {object} args
 * @param {string} args.host           e.g. "lovable.dev"
 * @param {object} args.signals        DOM + network heuristic flags from the extension
 * @param {object} [args.log]
 */
export async function classifyHost({ host, signals = {}, log } = {}) {
  if (!host) {
    return stubVerdict({ host: '', signals, reason: 'no host provided' });
  }
  if (!API_KEY) {
    return stubVerdict({ host, signals, reason: 'no ANTHROPIC_API_KEY — using stub classifier' });
  }

  try {
    const verdict = await callAnthropic({ host, signals, log });
    return verdict;
  } catch (e) {
    log?.warn?.(`ai-classifier: LLM call failed for ${host} (${e?.message || e}) — falling back to stub`);
    return stubVerdict({ host, signals, reason: 'llm-error: ' + (e?.message || e) });
  }
}

// ---- Real LLM path -------------------------------------------------------

async function callAnthropic({ host, signals, log }) {
  const prompt = buildClassifierPrompt({ host, signals });
  const ctrl = AbortSignal.timeout(REQUEST_TIMEOUT);

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type':    'application/json',
      'x-api-key':       API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: MAX_OUTPUT_TOKENS,
      // Hard system prompt: classifier-only, JSON-only output, no chatty preamble.
      system: [
        'You are an AI app classifier for a governance product. ',
        'Given metadata about a web host, decide whether the host is an AI tool ',
        '(LLM chat, AI assistant, autonomous AI agent, AI code helper, etc.) and ',
        'classify it. Reply with a single JSON object only — no prose, no markdown ',
        'fences, no commentary. The object must have exactly these keys: ',
        'is_ai (boolean), vendor (string or null), category (one of "chat-frontend", ',
        '"ide-assistant", "autonomous-agent", "api-platform", "local-runtime", or null), ',
        'sandbox (one of "local", "remote", "mixed", "unknown"), ',
        'confidence (number 0..1), ',
        'governance_note (string or null, one sentence on visibility caveats), ',
        'reasoning (string, one short sentence explaining the verdict).',
      ].join(''),
      messages: [{ role: 'user', content: prompt }],
    }),
    signal: ctrl,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`anthropic HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  const body = await res.json();
  const text = body?.content?.[0]?.text || '';
  const parsed = extractJson(text);
  if (!parsed) throw new Error('classifier returned unparseable output: ' + text.slice(0, 200));

  return normalizeVerdict(parsed, { classifier: 'llm:' + MODEL });
}

// Builds the user-content prompt. ONLY metadata fields. If you find yourself
// wanting to add a body-content or prompt-text field here, STOP — re-read the
// CRITICAL PRIVACY RULE at top.
function buildClassifierPrompt({ host, signals }) {
  const lines = [
    'Classify this web host.',
    '',
    `host: ${host}`,
  ];
  // Only-whitelisted fields, NEVER raw prompt/response text:
  const allow = ['page_title', 'meta_description', 'has_chat_input', 'has_send_button',
                 'has_streaming_text', 'request_body_shape', 'response_body_shape',
                 'detected_wire_format', 'process_name'];
  for (const k of allow) {
    if (signals[k] != null) {
      const v = typeof signals[k] === 'string' ? signals[k].slice(0, 200) : signals[k];
      lines.push(`${k}: ${JSON.stringify(v)}`);
    }
  }
  lines.push('');
  lines.push('Reply with JSON only — see system instructions.');
  return lines.join('\n');
}

// Pull the first JSON object out of the model's response, tolerating leading
// markdown fences or stray characters in case the model misbehaves.
function extractJson(text) {
  if (!text || typeof text !== 'string') return null;
  // Strip ```json ... ``` fences if present.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  // Find the first { ... last } substring.
  const start = candidate.indexOf('{');
  const end   = candidate.lastIndexOf('}');
  if (start < 0 || end < 0 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

function normalizeVerdict(raw, meta) {
  const allowedCategories = new Set(['chat-frontend', 'ide-assistant', 'autonomous-agent', 'api-platform', 'local-runtime']);
  const allowedSandbox    = new Set(['local', 'remote', 'mixed', 'unknown']);
  return {
    is_ai:           !!raw.is_ai,
    vendor:          typeof raw.vendor === 'string' ? raw.vendor.slice(0, 100) : null,
    category:        allowedCategories.has(raw.category) ? raw.category : null,
    sandbox:         allowedSandbox.has(raw.sandbox)     ? raw.sandbox    : 'unknown',
    confidence:      clamp01(Number(raw.confidence)),
    governance_note: typeof raw.governance_note === 'string' ? raw.governance_note.slice(0, 300) : null,
    reasoning:       typeof raw.reasoning === 'string' ? raw.reasoning.slice(0, 500) : '',
    classifier:      meta.classifier,
  };
}

function clamp01(n) {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

// ---- Stub fallback -------------------------------------------------------

const AI_HOST_REGEX = /\b(ai|llm|gpt|chat|inference|agent|copilot|claude|llama|mistral|cohere|anthropic|openai|gemini|bard|perplexity|grok|deepseek|groq|together|fireworks|huggingface|replicate|cursor|cline|aider|devin|lovable|bolt|v0|tempo|replit|augment|factory|windsurf|codeium|tabnine|reka|character|huggingchat)\b/i;
const AI_TLD_REGEX  = /\.ai$|\.dev$/i;

/**
 * Deterministic fallback classifier. Honest about its uncertainty —
 * never returns confidence above 0.7. The real LLM should always be
 * preferred in production.
 */
export function stubVerdict({ host, signals = {}, reason = 'stub' }) {
  const h = (host || '').toLowerCase();
  const sigScore =
    (signals.has_chat_input    ? 1 : 0) +
    (signals.has_send_button   ? 1 : 0) +
    (signals.has_streaming_text ? 1 : 0) +
    (signals.detected_wire_format ? 2 : 0);

  let is_ai = false;
  let confidence = 0;
  let reasoning = reason;

  if (AI_HOST_REGEX.test(h)) {
    is_ai = true; confidence = 0.7;
    reasoning = `host name contains AI-keyword (stub heuristic)`;
  } else if (AI_TLD_REGEX.test(h) && sigScore >= 1) {
    is_ai = true; confidence = 0.6;
    reasoning = `.ai/.dev TLD + page signals (stub heuristic)`;
  } else if (sigScore >= 3) {
    is_ai = true; confidence = 0.55;
    reasoning = `strong DOM signals despite no host hint (stub heuristic)`;
  } else if (sigScore === 0) {
    is_ai = false; confidence = 0.6;
    reasoning = `no AI signals (stub heuristic)`;
  } else {
    is_ai = false; confidence = 0.3;
    reasoning = `weak signals — defaulting to not-AI (stub heuristic)`;
  }

  return {
    is_ai,
    vendor: null,
    category: null,
    sandbox: 'unknown',
    confidence,
    governance_note: null,
    reasoning,
    classifier: 'stub:heuristic',
  };
}

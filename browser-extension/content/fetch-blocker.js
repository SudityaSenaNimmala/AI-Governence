// Injected into the PAGE's main world (not the content script's isolated world).
// Monkey-patches window.fetch to block any AI chat API call that contains
// sensitive data patterns. This is the network-level safety net.
//
// Blocking is the primary defense. The DOM-level enforcement in content.js
// shows the block popup with "Redact & Send". This is the network safety net.
//
// Agent blocking is handled by the content script at the DOM level (Enter/click
// interception + input disabling) — NOT here.

(function () {
  'use strict';

  const SENSITIVE_PATTERNS = [
    // DLP
    { name: 'us-ssn',            regex: /\b\d{3}-\d{2}-\d{4}\b/g },
    { name: 'credit-card',       regex: /\b(?:4\d{3}|5[1-5]\d{2}|3[47]\d{2}|6(?:011|5\d{2}))[ -]?\d{4}[ -]?\d{4}[ -]?\d{1,4}\b/g },
    { name: 'openai-api-key',    regex: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g },
    { name: 'anthropic-api-key', regex: /\bsk-ant-(?:api\d{2}-)?[A-Za-z0-9_-]{20,}\b/g },
    { name: 'google-api-key',    regex: /\bAIza[0-9A-Za-z_-]{30,}\b/g },
    { name: 'aws-access-key',    regex: /\bAKIA[0-9A-Z]{16}\b/g },
    { name: 'github-pat',        regex: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g },
    { name: 'slack-token',        regex: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g },
    { name: 'iban',              regex: /\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/g },
    // Guardrails — prompt injection + jailbreak + toxicity (network safety net)
    { name: 'injection-ignore-instructions', regex: /(ignore|forget|disregard|override|skip|drop|abandon|do\s+not\s+follow)\s+(all\s+|any\s+|every\s+)?(previous|prior|above|earlier|system|original|initial|given|existing|preset|default|my|your)\s+(instructions|prompts?|rules|guidelines|directives|constraints|programming|training)/i },
    { name: 'injection-override-safety',     regex: /\b(override\s+(your\s+|the\s+)?(safety|filters?|restrictions?|guardrails?|moderation|content\s+(policy|filter))|disable\s+(your\s+|the\s+)?(safety|filters?|content\s+filter|moderation)|bypass\s+(your\s+|the\s+)?(security|restrictions?|guardrails?|content\s+policy|filters?|safety|moderation)|turn\s+off\s+(your\s+|the\s+)?(safety|filters?|restrictions?|moderation|guardrails?|content\s+filter)|drop\s+(all\s+)?(your\s+)?(safety|filters?|restrictions?|guardrails?|guidelines?))\b/i },
    { name: 'injection-new-identity',        regex: /(you\s+are\s+now|from\s+now\s+(on\s+)?you\s+are|I\s+want\s+you\s+to\s+be|act\s+like\s+you\s+are|pretend\s+you\s+are|you\s+are)\s+(a\s+|an\s+)?(different|new|unrestricted|uncensored|unfiltered|evil|malicious|rogue|unethical|amoral|dark|villainous|corrupt|sinister)/i },
    { name: 'injection-no-restrictions',     regex: /(without|with\s+no|dont\s+have|don'?t\s+have|have\s+no|no|free\s+from|remove\s+all|drop\s+all|zero)\s+(any\s+)?(restrictions?|filters?|limits?|limitations?|boundaries|constraints|rules|guidelines|guardrails?|safety|ethics|morals)/i },
    { name: 'injection-extract-system',      regex: /(output|print|show|display|reveal|repeat|leak|share|give|provide|tell|explain|describe|copy|paste|dump|what\s+(is|are))\s+(me\s+)?(your|the)\s+(system\s+prompt|system\s+instructions|instructions|initial\s+prompt|hidden\s+prompt|original\s+instructions|internal\s+rules|source\s+code|training\s+data)/i },
    { name: 'injection-roleplay-dangerous',  regex: /\b(act|behave|respond|operate|pretend\s+to\s+be|you\s+are)\s+(as\s+|like\s+)?(a\s+|an\s+)?(hacker|criminal|terrorist|drug\s+dealer|assassin|hitman|serial\s+killer|thief|scammer|fraudster|bomb\s+maker)\b/i },
    { name: 'jailbreak-dan',                 regex: /\b(do\s+anything\s+now|D[\s.-]*A[\s.-]*N\s+mode|D[\s.-]*A[\s.-]*N\b)/i },
    { name: 'jailbreak-developer-mode',      regex: /\b(enable|activate|enter|unlock|switch\s+to|turn\s+on)\s+(your\s+)?(developer\s+mode|dev\s+mode|god\s+mode|sudo\s+mode|admin\s+mode)\b/i },
    { name: 'jailbreak-no-ethics',           regex: /\b(without|no|ignore|disable|remove|drop|abandon|suspend|free\s+from)\s+(any\s+)?(ethical|moral|safety|content)?\s*(ethics|morals|morality|guidelines|constraints|restrictions|rules|filters|boundaries|limits|policies|standards|principles)/i },
    { name: 'jailbreak-fiction-excuse',      regex: /\b(this\s+is\s+(just\s+|only\s+)?(a\s+)?(fiction|hypothetical|thought\s+experiment|dream|fantasy|game|joke|test|scenario|simulation|story)|for\s+(research|educational|academic|creative\s+writing|a\s+novel|a\s+story|a\s+movie|science|testing)\s+(purposes?|only|reasons?)?)\b/i },
    { name: 'jailbreak-keyword',             regex: /\b(jailbreak|jailbroken)\s+(this|the|you|your|it|chatgpt|gpt|claude|gemini|copilot|ai|model|llm|chatbot)\b|\b(uncensored\s+mode|unrestricted\s+mode|unfiltered\s+mode|unlocked\s+mode|unhinged\s+mode|chaos\s+mode|evil\s+mode)\b/i },
    { name: 'jailbreak-lets-go-crazy',       regex: /\b(let'?s?\s+go\s+crazy|go\s+wild|go\s+nuts|anything\s+goes|no\s+holds?\s+barr?ed|gloves?\s+(are\s+)?off)\b/i },
    { name: 'toxicity-hate-request',         regex: /\b(write|generate|create|compose|draft|make|give\s+me|produce)\s+(a\s+|an\s+|me\s+a\s+|me\s+an\s+)?(hateful|racist|sexist|homophobic|antisemitic|islamophobic|xenophobic|violent|threatening|abusive|derogatory|discriminatory|offensive|bigoted|hate)\s+(rant|message|letter|speech|post|comment|text|essay|article|joke|poem|story|song|script|content)\b/i },
    { name: 'toxicity-harm-instructions',    regex: /\b(how\s+(to|can\s+I|do\s+(I|you|we))|steps\s+to|guide\s+(to|for|on)|teach\s+me\s+(to|how)|ways?\s+to)\s+(make\s+(a\s+)?bombs?|make\s+(a\s+)?drugs?|make\s+(a\s+)?weapons?|make\s+(a\s+)?poison|make\s+(a\s+)?explosives?|make\s+(a\s+)?guns?|build\s+(a\s+)?weapons?|create\s+poison|hack\s+into|break\s+into|kill\s+(a\s+person|someone|people|myself)|manufacture\s+(drugs|explosives|weapons|meth|fentanyl))/i },
    { name: 'toxicity-explicit-content',     regex: /\b(generate|write|create|produce|give|make|compose|describe|show|send)\s+(me\s+)?(some\s+)?(explicit|pornographic|nsfw|sexual|sexually\s+explicit|erotic|adult|xxx|nude|naked)\s+(content|story|stories|text|images?|fiction|stuff|things?|pics?|material)\b/i },
    { name: 'toxicity-self-harm',            regex: /\b(how\s+(to|can\s+I|do\s+I|could\s+I)\s+(commit\s+suicide|hurt\s+myself|self[\s-]?harm|end\s+my\s+life|kill\s+myself|harm\s+myself)|best\s+way\s+to\s+(die|kill\s+myself|end\s+it|commit\s+suicide))\b/i },
  ];

  function scanText(text) {
    if (!text || text.length < 5) return [];
    const found = [];
    for (const p of SENSITIVE_PATTERNS) {
      p.regex.lastIndex = 0;
      if (p.regex.test(text)) found.push(p.name);
    }
    return found;
  }

  // The fetch-blocker is the HARD SAFETY NET — blocks ALL sensitive
  // patterns at the network level. The DOM enforcement in content.js
  // shows the block popup with "Redact & Send". If the DOM layer misses
  // (React quirks), the fetch-blocker ensures sensitive data NEVER leaves.
  // When the user clicks "Redact & Send", the text is cleaned BEFORE
  // the fetch fires, so the fetch-blocker sees clean text and lets it through.

  function extractUserText(bodyText) {
    try {
      const json = JSON.parse(bodyText);
      const texts = [];
      if (Array.isArray(json.messages)) {
        for (const msg of json.messages) {
          if (msg.content && msg.content.parts && Array.isArray(msg.content.parts)) {
            for (const p of msg.content.parts) { if (typeof p === 'string') texts.push(p); }
          }
          if (typeof msg.content === 'string') texts.push(msg.content);
          if (Array.isArray(msg.content)) {
            for (const block of msg.content) { if (block && typeof block.text === 'string') texts.push(block.text); }
          }
        }
      }
      if (Array.isArray(json.contents)) {
        for (const c of json.contents) {
          if (c.parts && Array.isArray(c.parts)) {
            for (const part of c.parts) { if (typeof part.text === 'string') texts.push(part.text); }
          }
        }
      }
      if (typeof json.prompt === 'string') texts.push(json.prompt);
      if (texts.length > 0) return texts.join('\n');
    } catch (e) {}
    return null;
  }

  const AI_HOSTS = [
    /chatgpt\.com/, /chat\.openai\.com/, /api\.openai\.com/,
    /api\.anthropic\.com/, /claude\.ai/,
    /generativelanguage\.googleapis\.com/,
    /copilot\.microsoft\.com/, /m365\.cloud\.microsoft/,
    /gemini\.google\.com/, /aistudio\.google\.com/,
  ];

  function isChatPost(url, method) {
    if (method && method.toUpperCase() !== 'POST') return false;
    const s = typeof url === 'string' ? url : url?.toString?.() || '';
    for (const rx of AI_HOSTS) { if (rx.test(s)) return true; }
    if (s.startsWith('/') || s.startsWith('./') || !s.includes('://')) {
      const host = location.hostname || '';
      for (const rx of AI_HOSTS) { if (rx.test(host)) return true; }
    }
    return false;
  }

  // ── AI response capture (Session Replay, phase 3) ──────────────────────────
  // Everything between this sentinel and the matching end sentinel is PURE:
  // no window, document, fetch, location or console. That is what lets
  // tests/load-response-assembler.mjs slice the region out and run the real
  // shipped reassembly logic under Node. Keep it that way.
  //
  // The job: given the raw bytes of one AI chat response (already decoded to a
  // string), rebuild the assistant's message. Every site streams, and each one
  // streams differently, so we identify the site, split the stream into events
  // once, and run site-specific extractors over the parsed events. This is the
  // browser port of the reassembly the Node side does in
  // agent/src/server-monitor/cost-parser.js — same idea, different host.
  //
  // Cost control: parsing happens ONCE, at end of stream. Per chunk we only
  // decode and push a string. A previous incident on this codebase (see the
  // ENFORCEMENT notes in content.js) showed that doing real work per streamed
  // token is what makes Chrome's tab go unresponsive.

  // Which wire format does this host speak on the response side?
  //   'unsupported' → we know the format is one this approach cannot read, so
  //                   don't even buffer it.
  const RESPONSE_SITE_RULES = [
    { rx: /(^|\.)chatgpt\.com$/,                        site: 'chatgpt' },
    { rx: /(^|\.)chat\.openai\.com$/,                   site: 'chatgpt' },
    { rx: /(^|\.)claude\.ai$/,                          site: 'claude' },
    { rx: /(^|\.)api\.anthropic\.com$/,                 site: 'anthropic' },
    { rx: /(^|\.)api\.openai\.com$/,                    site: 'openai' },
    { rx: /(^|\.)generativelanguage\.googleapis\.com$/, site: 'google' },
    { rx: /(^|\.)aistudio\.google\.com$/,               site: 'google' },
    // Consumer Gemini answers over batchexecute: a `)]}'`-prefixed stream of
    // length-delimited, deeply nested JSON arrays with no stable text path.
    { rx: /(^|\.)gemini\.google\.com$/,                 site: 'unsupported' },
    // Copilot chat rides SignalR/WebSocket, which never passes through fetch or
    // XHR at all (same reason the DOM-level block exists in content.js).
    { rx: /(^|\.)copilot\.microsoft\.com$/,             site: 'unsupported' },
    { rx: /(^|\.)cloud\.microsoft$/,                    site: 'unsupported' },
  ];

  function hostOf(url, fallbackHost) {
    const s = typeof url === 'string' ? url : (url && url.toString ? url.toString() : '');
    const m = s.match(/^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)/i);
    if (m) return m[1].split('@').pop().split(':')[0].toLowerCase();
    return (fallbackHost || '').toLowerCase();
  }

  function responseSiteFor(url, fallbackHost) {
    const host = hostOf(url, fallbackHost);
    if (!host) return 'generic';
    for (const r of RESPONSE_SITE_RULES) { if (r.rx.test(host)) return r.site; }
    return 'generic';
  }

  // --- stream splitting ---

  function safeParse(s) {
    try { return JSON.parse(s); } catch (e) { return undefined; }
  }

  // SSE: blank-line-delimited blocks of `field: value` lines. Multiple data:
  // lines in one block concatenate with \n (per the spec).
  function parseSseFrames(text) {
    const out = [];
    for (const block of text.split(/\r?\n\r?\n/)) {
      if (!block.trim()) continue;
      let name = null;
      const data = [];
      for (const line of block.split(/\r?\n/)) {
        if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
        else if (line.startsWith('event:')) name = line.slice(6).trim();
      }
      if (!data.length) continue;
      const payload = data.join('\n');
      if (payload === '[DONE]') continue;
      out.push({ name: name, data: payload, json: safeParse(payload) });
    }
    return out;
  }

  function parseNdjsonLines(text) {
    const out = [];
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      const json = safeParse(line);
      if (json !== undefined) out.push({ name: null, data: line, json: json });
    }
    return out;
  }

  // Returns { format, items }. `format` is descriptive only — it rides along on
  // the event so the server can tell how a capture was decoded.
  function collectStreamEvents(raw) {
    const text = typeof raw === 'string' ? raw : '';
    if (!text.trim()) return { format: 'empty', items: [] };
    if (/(^|\n)(data|event):/.test(text)) {
      const items = parseSseFrames(text);
      if (items.length) return { format: 'sse', items: items };
    }
    const whole = safeParse(text);
    if (whole !== undefined) return { format: 'json', items: [{ name: null, data: text, json: whole }] };
    const lines = parseNdjsonLines(text);
    if (lines.length) return { format: 'ndjson', items: lines };
    return { format: 'unknown', items: [] };
  }

  // --- per-site extractors: (items) → assembled assistant text ('' if none) ---

  function partsText(msg) {
    const parts = msg && msg.content && msg.content.parts;
    if (!Array.isArray(parts)) return '';
    return parts.filter((p) => typeof p === 'string').join('');
  }

  function isAssistantText(msg) {
    if (!msg || !msg.author || msg.author.role !== 'assistant') return false;
    const ct = msg.content && msg.content.content_type;
    return ct == null || ct === 'text';
  }

  // ChatGPT's own backend. Two shapes coexist:
  //   legacy   — each frame is a FULL snapshot: {message:{author,content:{parts:[...]}}}
  //   v1 delta — {"p":"/message/content/parts/0","o":"append","v":"tok"} operations
  //              (the initial op is {p:"",o:"add",v:{message:{...}}}, and later
  //              frames often drop p/o entirely and are just {"v":"tok"},
  //              meaning "same target as last time")
  // We track both and keep whichever produced more text.
  function extractChatGpt(items) {
    let snapshot = '';        // best full snapshot seen (legacy shape)
    let base = '';            // parts text at the moment the assistant msg was added
    let appended = '';        // accumulated append deltas
    let onTarget = false;     // is the current append target the assistant text?

    const isTextPartPath = (p) => typeof p === 'string' && /\/content\/parts\/\d+$/.test(p) && !/thought/i.test(p);

    const takeSnapshot = (msg) => {
      if (!isAssistantText(msg)) { onTarget = false; return; }
      const text = partsText(msg);
      onTarget = true;
      if (text.length > snapshot.length) snapshot = text;
      base = text;
      appended = '';
    };

    const applyOp = (op, depth) => {
      if (!op || typeof op !== 'object' || depth > 4) return;
      if (op.message && typeof op.message === 'object') { takeSnapshot(op.message); return; }
      const kind = typeof op.o === 'string' ? op.o : null;
      if (kind === 'patch' && Array.isArray(op.v)) {
        for (const sub of op.v) applyOp(sub, depth + 1);
        return;
      }
      if (kind === 'add' || kind === 'replace') {
        if (op.v && typeof op.v === 'object') {
          if (op.v.message) takeSnapshot(op.v.message);
          else if (op.v.author) takeSnapshot(op.v);
          else if (Array.isArray(op.v)) { for (const sub of op.v) applyOp(sub, depth + 1); }
        } else if (typeof op.v === 'string' && isTextPartPath(op.p)) {
          onTarget = true;
          base = op.v;
          appended = '';
        }
        return;
      }
      if (typeof op.v === 'string') {
        // Explicit append, or a bare {"v":"..."} continuation of the last target.
        if (op.p == null || op.p === '' || isTextPartPath(op.p)) {
          if (op.p != null && op.p !== '') onTarget = isTextPartPath(op.p);
          if (onTarget) appended += op.v;
        } else {
          onTarget = false;
        }
        return;
      }
      if (Array.isArray(op.v)) { for (const sub of op.v) applyOp(sub, depth + 1); }
    };

    for (const it of items) {
      if (it.json === undefined || it.json === null || typeof it.json !== 'object') continue;
      applyOp(it.json, 0);
    }
    const streamed = base + appended;
    return streamed.length >= snapshot.length ? streamed : snapshot;
  }

  // Anthropic wire format — used by api.anthropic.com AND by claude.ai's own
  // /completion endpoint. Older claude.ai builds send {type:'completion'}.
  function extractAnthropic(items) {
    let out = '';
    for (const it of items) {
      const e = it.json;
      if (!e || typeof e !== 'object') continue;
      if (e.type === 'content_block_delta' && e.delta && typeof e.delta.text === 'string') out += e.delta.text;
      else if (e.type === 'content_block_start' && e.content_block && typeof e.content_block.text === 'string') out += e.content_block.text;
      else if (typeof e.completion === 'string') out += e.completion;
      else if (Array.isArray(e.content)) {
        // Non-streaming /v1/messages response.
        for (const b of e.content) { if (b && typeof b.text === 'string') out += b.text; }
      }
    }
    return out;
  }

  // OpenAI-compatible: chat completions (streamed deltas or a whole message),
  // legacy completions, and the Responses API's output_text deltas.
  function extractOpenAi(items) {
    let out = '';
    for (const it of items) {
      const e = it.json;
      if (!e || typeof e !== 'object') continue;
      const choices = Array.isArray(e.choices) ? e.choices : null;
      if (choices) {
        for (const c of choices) {
          if (!c) continue;
          if (c.delta && typeof c.delta.content === 'string') out += c.delta.content;
          else if (c.message && typeof c.message.content === 'string') out += c.message.content;
          else if (typeof c.text === 'string') out += c.text;
        }
        continue;
      }
      if (e.type === 'response.output_text.delta' && typeof e.delta === 'string') out += e.delta;
    }
    return out;
  }

  // Gemini / Google AI Studio: candidates[].content.parts[].text
  function extractGoogle(items) {
    let out = '';
    for (const it of items) {
      const e = it.json;
      if (!e || typeof e !== 'object') continue;
      const cands = Array.isArray(e.candidates) ? e.candidates : null;
      if (!cands) continue;
      for (const c of cands) {
        const parts = c && c.content && c.content.parts;
        if (Array.isArray(parts)) {
          for (const p of parts) { if (p && typeof p.text === 'string') out += p.text; }
        }
      }
    }
    return out;
  }

  // Ollama / llama.cpp style local servers, and anything else that streams a
  // plain {message:{content}} / {response} / {content} object per chunk.
  function extractLocalish(items) {
    let out = '';
    for (const it of items) {
      const e = it.json;
      if (!e || typeof e !== 'object') continue;
      if (e.message && typeof e.message.content === 'string') out += e.message.content;
      else if (typeof e.response === 'string') out += e.response;
      else if (typeof e.content === 'string') out += e.content;
    }
    return out;
  }

  function extractorsFor(site) {
    if (site === 'chatgpt')   return [extractChatGpt, extractOpenAi];
    if (site === 'claude')    return [extractAnthropic];
    if (site === 'anthropic') return [extractAnthropic];
    if (site === 'openai')    return [extractOpenAi];
    if (site === 'google')    return [extractGoogle];
    // Unknown AI host: try every shape, most specific first.
    return [extractAnthropic, extractOpenAi, extractGoogle, extractChatGpt, extractLocalish];
  }

  /**
   * Reassemble one AI response. Returns { text, format }; text is '' when
   * nothing recognizable was found (caller then emits nothing).
   */
  function assembleAiResponseText(raw, site) {
    if (site === 'unsupported') return { text: '', format: 'unsupported' };
    const collected = collectStreamEvents(raw);
    if (!collected.items.length) return { text: '', format: collected.format };
    for (const ex of extractorsFor(site)) {
      let text = '';
      try { text = ex(collected.items) || ''; } catch (e) { text = ''; }
      if (text) return { text: text, format: collected.format };
    }
    return { text: '', format: collected.format };
  }
  // ── end AI response capture ────────────────────────────────────────────────

  // Cap on how much decoded response text we keep per call. Beyond this we keep
  // draining the stream (so the page is never starved) but stop buffering.
  const RESPONSE_MAX_CHARS = 1024 * 1024;

  // Page world → content-script world. Same channel the existing block path
  // uses (a CustomEvent on window, which content.js already listens for), so
  // there is no second communication mechanism to reason about.
  function publishAiResponse(url, site, raw, truncated, startedAt) {
    try {
      const result = assembleAiResponseText(raw, site);
      if (!result.text) return;
      window.dispatchEvent(new CustomEvent('cfai-ai-response', {
        detail: {
          text: result.text,
          format: result.format,
          site: site,
          url: String(url || ''),
          truncated: !!truncated,
          duration_ms: startedAt ? (Date.now() - startedAt) : null,
        },
      }));
    } catch (e) {
      // Capture must never affect the page.
    }
  }

  const CAPTURABLE_CONTENT_TYPE = /event-stream|ndjson|json|text\/plain/i;

  // POSTs on AI hosts that are definitely not a chat turn — anti-bot sentinels,
  // telemetry, moderation, account state. Skipping them means we never buffer a
  // body we know carries no reply. Same spirit as the proxy's scan-policy skip
  // list. A wrong skip only costs us a capture; it can never break the page.
  const NON_CHAT_PATH = /\/(sentinel|ces|telemetry|analytics|metrics|health|settings|account|bootstrap|prepare|moderations?|usage|feedback|voice|share|title)\b/i;

  // Drain a cloned response body, buffering the decoded text, and publish ONE
  // event when the stream ends. Per-chunk work is a TextDecoder call and an
  // array push — no parsing, no regex, no DOM.
  async function captureResponseStream(res, url, site, startedAt) {
    let reader;
    try { reader = res.body.getReader(); } catch (e) { return; }
    const decoder = new TextDecoder('utf-8');
    const chunks = [];
    let chars = 0;
    let truncated = false;
    try {
      for (;;) {
        const step = await reader.read();
        if (step.done) break;
        if (!step.value) continue;
        if (truncated) continue;                       // still draining, no longer keeping
        const piece = decoder.decode(step.value, { stream: true });
        chars += piece.length;
        if (chars > RESPONSE_MAX_CHARS) { truncated = true; continue; }
        chunks.push(piece);
      }
      if (!truncated) chunks.push(decoder.decode());
    } catch (e) {
      // Stream aborted (user hit stop, tab navigated) — publish the partial.
    }
    publishAiResponse(url, site, chunks.join(''), truncated, startedAt);
  }

  /**
   * Tee the response for capture without handing the page a different Response
   * object. response.clone() shares the body via an internal tee, so the page
   * keeps the ORIGINAL response — url, type, redirected and headers all intact.
   * Rebuilding a Response around a piped stream would silently change those.
   */
  function withResponseCapture(promise, url, site) {
    const startedAt = Date.now();
    return promise.then((response) => {
      try {
        if (!site || site === 'unsupported') return response;
        if (NON_CHAT_PATH.test(String(url || ''))) return response;
        if (!response || !response.ok || !response.body) return response;
        const ct = response.headers && response.headers.get ? (response.headers.get('content-type') || '') : '';
        if (!CAPTURABLE_CONTENT_TYPE.test(ct)) return response;
        captureResponseStream(response.clone(), url, site, startedAt);
      } catch (e) {
        // Never break the page's fetch because capture failed.
      }
      return response;
    });
  }

  const originalFetch = window.fetch;

  window.fetch = function (input, init) {
    // Set inside the try below when this call is an AI chat POST whose response
    // we can read. Declared out here so the fall-through return can use it even
    // if the blocking logic threw.
    let captureSite = null;
    let captureUrl = '';
    try {
      const url = typeof input === 'string' ? input
        : input instanceof Request ? input.url
        : String(input || '');
      const method = init?.method || (input instanceof Request ? input.method : 'GET');

      if (isChatPost(url, method)) {
        captureUrl = url;
        const site = responseSiteFor(url, location.hostname);
        captureSite = site === 'unsupported' ? null : site;
        let bodyText = '';
        if (typeof init?.body === 'string') bodyText = init.body;

        if (bodyText) {
          // ONLY scan extracted user message text — not raw bodies.
          // Raw body scanning false-positives on internal telemetry,
          // session IDs, UUIDs, and analytics payloads.
          const userText = extractUserText(bodyText);
          if (userText !== null) {
            const matches = scanText(userText);
            if (matches.length > 0) {
              console.warn('[cfai] FETCH BLOCKED — sensitive data:', matches.join(', '));
              window.dispatchEvent(new CustomEvent('cfai-fetch-blocked', {
                detail: { url, matches, blockedText: userText }
              }));
              return Promise.reject(new DOMException(
                'Blocked by CloudFuze AI Governance', 'AbortError'
              ));
            }
          }
        }

        if (!bodyText && init?.body && typeof init.body !== 'string') {
          const origBody = init.body;
          return new Promise(async (resolve, reject) => {
            try {
              let text = '';
              if (origBody instanceof Blob) text = await origBody.text();
              else if (origBody instanceof ArrayBuffer) text = new TextDecoder().decode(origBody);
              else if (origBody instanceof ReadableStream) {
                const reader = origBody.getReader();
                const chunks = [];
                while (true) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); }
                const combined = new Uint8Array(chunks.reduce((a, c) => a + c.length, 0));
                let offset = 0;
                for (const chunk of chunks) { combined.set(chunk, offset); offset += chunk.length; }
                text = new TextDecoder().decode(combined);
                init = { ...init, body: text };
              }
              const userText = extractUserText(text);
              if (userText !== null) {
                const asyncMatches = scanText(userText);
                if (asyncMatches.length > 0) {
                  console.warn('[cfai] FETCH BLOCKED (async) — sensitive data:', asyncMatches.join(', '));
                  window.dispatchEvent(new CustomEvent('cfai-fetch-blocked', {
                    detail: { url, matches: asyncMatches, blockedText: userText }
                  }));
                  reject(new DOMException('Blocked by CloudFuze AI Governance', 'AbortError'));
                  return;
                }
              }
              resolve(withResponseCapture(originalFetch.call(window, input, init), url, captureSite));
            } catch (e) { resolve(withResponseCapture(originalFetch.call(window, input, init), url, captureSite)); }
          });
        }
      }
    } catch (e) {
      console.warn('[cfai] fetch blocker error (allowing request):', e);
    }
    const passthrough = originalFetch.apply(this, arguments);
    return captureSite ? withResponseCapture(passthrough, captureUrl, captureSite) : passthrough;
  };

  const origXhrOpen = XMLHttpRequest.prototype.open;
  const origXhrSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    this._cfaiMethod = method;
    this._cfaiUrl = url;
    return origXhrOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function (body) {
    try {
      if (isChatPost(this._cfaiUrl, this._cfaiMethod)) {
        let bodyStr = typeof body === 'string' ? body : null;
        if (!bodyStr && body instanceof URLSearchParams) bodyStr = body.toString();
        if (bodyStr) {
          const userText = extractUserText(bodyStr);
          if (userText !== null) {
            const matches = scanText(userText);
            if (matches.length > 0) {
              console.warn('[cfai] XHR BLOCKED — sensitive data:', matches.join(', '));
              window.dispatchEvent(new CustomEvent('cfai-fetch-blocked', {
                detail: { url: this._cfaiUrl, matches, blockedText: userText }
              }));
              this.abort();
              return;
            }
          }
        }
        // Response capture. We read responseText ONCE, at DONE — the full
        // streamed body is already there, so polling it per progress event
        // would just be repeated work for the same result.
        const site = responseSiteFor(this._cfaiUrl, location.hostname);
        if (site !== 'unsupported' && !NON_CHAT_PATH.test(String(this._cfaiUrl || '')) && !this._cfaiCapturing) {
          this._cfaiCapturing = true;
          const startedAt = Date.now();
          const url = this._cfaiUrl;
          this.addEventListener('load', () => {
            try {
              if (this.status < 200 || this.status >= 300) return;
              // responseText throws for arraybuffer/blob response types.
              if (this.responseType && this.responseType !== 'text') return;
              const raw = this.responseText || '';
              if (!raw) return;
              const truncated = raw.length > RESPONSE_MAX_CHARS;
              publishAiResponse(url, site, truncated ? raw.slice(0, RESPONSE_MAX_CHARS) : raw, truncated, startedAt);
            } catch (e) {}
          });
        }
      }
    } catch (e) {}
    return origXhrSend.apply(this, arguments);
  };

  // After a blocked fetch: clean up ChatGPT's optimistic UI
  window.addEventListener('cfai-fetch-blocked', (e) => {
    const blockedText = e.detail?.blockedText || '';
    setTimeout(() => {
      const userMsgs = document.querySelectorAll('[data-message-author-role="user"]');
      if (userMsgs.length > 0) {
        const lastMsg = userMsgs[userMsgs.length - 1];
        const container = lastMsg.closest('[data-testid^="conversation-turn"]')
          || lastMsg.closest('article') || lastMsg.closest('[class*="group"]')
          || lastMsg.parentElement?.parentElement?.parentElement;
        if (container) container.remove();
      }
      setTimeout(() => {
        const remaining = document.querySelectorAll('[data-message-author-role], [data-testid^="conversation-turn"]');
        if (remaining.length === 0) window.history.back();
      }, 100);
    }, 200);
    if (blockedText) {
      setTimeout(() => {
        const input = document.querySelector(
          '#prompt-textarea, textarea[data-id="root"], div[contenteditable="true"][role="textbox"], '
          + 'div[contenteditable="true"][class*="ProseMirror"], textarea[placeholder*="Message"], '
          + 'div[contenteditable="true"][data-placeholder]'
        );
        if (input) {
          if (input.tagName === 'TEXTAREA' || input.tagName === 'INPUT') {
            const setter = Object.getOwnPropertyDescriptor(
              input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value'
            )?.set;
            if (setter) setter.call(input, blockedText); else input.value = blockedText;
            input.dispatchEvent(new Event('input', { bubbles: true }));
          } else {
            input.focus();
            const sel = window.getSelection(), range = document.createRange();
            range.selectNodeContents(input); sel.removeAllRanges(); sel.addRange(range);
            document.execCommand('insertText', false, blockedText);
            if ((input.innerText || '').trim() !== blockedText.trim()) {
              input.textContent = blockedText;
              input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
            }
          }
          input.focus();
        }
      }, 600);
    }
  });

  // ── Model Routing — rewrite model field in API request body ──────
  // The content script dispatches 'cfai-route-model' when a routing rule
  // matches. We store the target model and apply it to the NEXT fetch POST
  // to an AI host. No DOM scanning, no dropdown interaction — just rewrite
  // the JSON body before it leaves the browser.
  let _pendingRoute = null;

  document.addEventListener('cfai-route-model', (e) => {
    if (e.detail && e.detail.model) {
      _pendingRoute = { model: e.detail.model, rule_name: e.detail.rule_name || '', ts: Date.now() };
      console.info('[cfai] routing queued:', _pendingRoute.model, '(' + _pendingRoute.rule_name + ')');
    }
  });

  // ── Smart tier detection for fetch-blocker backup routing ──
  function detectTier(modelId) {
    const t = (modelId || '').toLowerCase();
    if (t.includes('opus'))   return { provider: 'anthropic', tier: 'premium' };
    if (t.includes('sonnet')) return { provider: 'anthropic', tier: 'standard' };
    if (t.includes('haiku'))  return { provider: 'anthropic', tier: 'economy' };
    if (t.includes('mini') || t.includes('3.5'))  return { provider: 'openai', tier: 'economy' };
    if (t.includes('4o') || t.includes('4.1'))    return { provider: 'openai', tier: 'standard' };
    if (t.includes('gpt-4') || t.includes('o1') || t.includes('o3')) return { provider: 'openai', tier: 'premium' };
    if (t.includes('flash'))  return { provider: 'google', tier: 'economy' };
    if (t.includes('pro'))    return { provider: 'google', tier: 'standard' };
    return null;
  }

  const FALLBACK_ROUTES = {
    anthropic: { premium: 'claude-sonnet-4-20250514', standard: 'claude-haiku-4-5-20251001' },
    openai:    { premium: 'gpt-4o', standard: 'gpt-4o-mini' },
    google:    { premium: 'gemini-2.0-flash', standard: 'gemini-2.0-flash' },
  };

  // Patch the fetch wrapper to apply routing BEFORE sending
  const _routedFetch = window.fetch;
  window.fetch = function(input, init) {
    try {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input || '');
      const method = init?.method || (input instanceof Request ? input.method : 'GET');

      if (isChatPost(url, method) && typeof init?.body === 'string') {
        try {
          const json = JSON.parse(init.body);
          if (json.model) {
            // Primary: use pending route from content script
            if (_pendingRoute && (Date.now() - _pendingRoute.ts) < 5000) {
              const originalModel = json.model;
              json.model = _pendingRoute.model;
              init = { ...init, body: JSON.stringify(json) };
              console.info('[cfai] ROUTED fetch:', originalModel, '→', json.model);
              document.dispatchEvent(new CustomEvent('cfai-route-applied', {
                detail: { from: originalModel, to: json.model, rule: _pendingRoute.rule_name }
              }));
              _pendingRoute = null;
            }
          }
        } catch {}
      }
    } catch {}
    return _routedFetch.apply(this, arguments);
  };

  console.info('[cfai] fetch blocker + smart model router installed — sensitive data will be intercepted, AI responses captured');
})();

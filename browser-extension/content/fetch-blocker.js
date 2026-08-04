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

  const originalFetch = window.fetch;

  window.fetch = function (input, init) {
    try {
      const url = typeof input === 'string' ? input
        : input instanceof Request ? input.url
        : String(input || '');
      const method = init?.method || (input instanceof Request ? input.method : 'GET');

      if (isChatPost(url, method)) {
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
              resolve(originalFetch.call(window, input, init));
            } catch (e) { resolve(originalFetch.call(window, input, init)); }
          });
        }
      }
    } catch (e) {
      console.warn('[cfai] fetch blocker error (allowing request):', e);
    }
    return originalFetch.apply(this, arguments);
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

  console.info('[cfai] fetch blocker + smart model router installed');
})();

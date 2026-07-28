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
    { name: 'us-ssn',            regex: /\b\d{3}-\d{2}-\d{4}\b/g },
    { name: 'credit-card',       regex: /\b(?:4\d{3}|5[1-5]\d{2}|3[47]\d{2}|6(?:011|5\d{2}))[ -]?\d{4}[ -]?\d{4}[ -]?\d{1,4}\b/g },
    { name: 'openai-api-key',    regex: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g },
    { name: 'anthropic-api-key', regex: /\bsk-ant-(?:api\d{2}-)?[A-Za-z0-9_-]{20,}\b/g },
    { name: 'google-api-key',    regex: /\bAIza[0-9A-Za-z_-]{30,}\b/g },
    { name: 'aws-access-key',    regex: /\bAKIA[0-9A-Z]{16}\b/g },
    { name: 'github-pat',        regex: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g },
    { name: 'slack-token',        regex: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g },
    { name: 'iban',              regex: /\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/g },
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

  console.info('[cfai] fetch blocker installed — sensitive data will be intercepted');
})();

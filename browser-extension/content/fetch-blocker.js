// Injected into the PAGE's main world (not the content script's isolated world).
// Monkey-patches window.fetch to block any AI chat API call that contains
// sensitive data patterns. This is React-proof.

(function () {
  'use strict';

  const SENSITIVE_PATTERNS = [
    { name: 'us-ssn',            regex: /\b\d{3}-\d{2}-\d{4}\b/ },
    { name: 'credit-card',       regex: /\b(?:4\d{3}|5[1-5]\d{2}|3[47]\d{2}|6(?:011|5\d{2}))[ -]?\d{4}[ -]?\d{4}[ -]?\d{1,4}\b/ },
    { name: 'openai-api-key',    regex: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/ },
    { name: 'anthropic-api-key', regex: /\bsk-ant-(?:api\d{2}-)?[A-Za-z0-9_-]{20,}\b/ },
    { name: 'google-api-key',    regex: /\bAIza[0-9A-Za-z_-]{30,}\b/ },
    { name: 'aws-access-key',    regex: /\bAKIA[0-9A-Z]{16}\b/ },
    { name: 'github-pat',        regex: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/ },
    { name: 'slack-token',       regex: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/ },
    { name: 'iban',              regex: /\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/ },
  ];

  function scanText(text) {
    if (!text || text.length < 5) return [];
    const found = [];
    for (const p of SENSITIVE_PATTERNS) {
      if (p.regex.test(text)) found.push(p.name);
    }
    return found;
  }

  // ChatGPT sends POST to /backend-api/conversation with JSON body
  // containing { messages: [{ content: { parts: ["user text"] } }] }
  // We need to deep-scan the entire JSON body string for patterns.
  function isChatPost(url, method) {
    if (method && method.toUpperCase() !== 'POST') return false;
    const s = typeof url === 'string' ? url : url?.toString?.() || '';
    // ChatGPT endpoints (including new ces/v1/* paths)
    if (/chatgpt\.com/.test(s)) return true;
    if (/chat\.openai\.com/.test(s)) return true;
    // Other AI services
    if (/api\.openai\.com\/v1\/chat\/completions/.test(s)) return true;
    if (/api\.anthropic\.com\/v1\/messages/.test(s)) return true;
    if (/claude\.ai\/api\//.test(s)) return true;
    if (/generativelanguage\.googleapis\.com/.test(s)) return true;
    if (/copilot\.microsoft\.com/.test(s)) return true;
    if (/gemini\.google\.com/.test(s)) return true;
    return false;
  }

  const originalFetch = window.fetch;
  let _lastBlockTime = 0;
  let _lastBlockNotify = 0;

  window.fetch = function (input, init) {
    try {
      const url = typeof input === 'string' ? input
        : input instanceof Request ? input.url
        : String(input || '');
      const method = init?.method || (input instanceof Request ? input.method : 'GET');

      if (isChatPost(url, method)) {
        let bodyText = '';
        if (typeof init?.body === 'string') {
          bodyText = init.body;
        }

        if (bodyText) {
          const matches = scanText(bodyText);
          if (matches.length > 0) {
            const now = Date.now();
            _lastBlockTime = now;
            if (now - _lastBlockNotify > 3000) {
              _lastBlockNotify = now;
              console.warn('[cfai] FETCH BLOCKED — sensitive data:', matches.join(', '), '→', url.slice(0, 80));
              window.dispatchEvent(new CustomEvent('cfai-fetch-blocked', {
                detail: { url, matches }
              }));
            }
            return Promise.reject(new DOMException(
              'Blocked by CloudFuze AI Governance',
              'AbortError'
            ));
          }
        }

        // Async body check — if body is not a string, read it and check
        if (!bodyText && init?.body && typeof init.body !== 'string') {
          const origBody = init.body;
          return new Promise(async (resolve, reject) => {
            try {
              let text = '';
              if (origBody instanceof Blob) {
                text = await origBody.text();
              } else if (origBody instanceof ArrayBuffer) {
                text = new TextDecoder().decode(origBody);
              } else if (origBody instanceof ReadableStream) {
                const reader = origBody.getReader();
                const chunks = [];
                while (true) {
                  const { done, value } = await reader.read();
                  if (done) break;
                  chunks.push(value);
                }
                const combined = new Uint8Array(chunks.reduce((a, c) => a + c.length, 0));
                let offset = 0;
                for (const chunk of chunks) { combined.set(chunk, offset); offset += chunk.length; }
                text = new TextDecoder().decode(combined);
                // Reconstruct body since we consumed the stream
                init = { ...init, body: text };
              }
              const asyncMatches = scanText(text);
              if (asyncMatches.length > 0) {
                const now = Date.now();
                _lastBlockTime = now;
                if (now - _lastBlockNotify > 3000) {
                  _lastBlockNotify = now;
                  console.warn('[cfai] FETCH BLOCKED (async) — sensitive data:', asyncMatches.join(', '));
                  window.dispatchEvent(new CustomEvent('cfai-fetch-blocked', {
                    detail: { url, matches: asyncMatches }
                  }));
                }
                reject(new DOMException('Blocked by CloudFuze AI Governance', 'AbortError'));
              } else {
                resolve(originalFetch.call(window, input, init));
              }
            } catch (e) {
              resolve(originalFetch.call(window, input, init));
            }
          });
        }
      }
    } catch (e) {
      console.warn('[cfai] fetch blocker error (allowing request):', e);
    }

    return originalFetch.apply(this, arguments);
  };

  // Also patch XMLHttpRequest for older AI services
  const origXhrOpen = XMLHttpRequest.prototype.open;
  const origXhrSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url) {
    this._cfaiMethod = method;
    this._cfaiUrl = url;
    return origXhrOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function (body) {
    try {
      if (isChatPost(this._cfaiUrl, this._cfaiMethod) && typeof body === 'string') {
        const matches = scanText(body);
        if (matches.length > 0) {
          console.warn('[cfai] XHR BLOCKED — sensitive data:', matches.join(', '), '→', this._cfaiUrl);
          window.dispatchEvent(new CustomEvent('cfai-fetch-blocked', {
            detail: { url: this._cfaiUrl, matches }
          }));
          this.abort();
          return;
        }
      }
    } catch (e) {
      console.warn('[cfai] xhr blocker error:', e);
    }
    return origXhrSend.apply(this, arguments);
  };

  // After a blocked fetch, remove the optimistically-rendered user message
  // from ChatGPT's UI and restore the text to the input.
  window.addEventListener('cfai-fetch-blocked', () => {
    setTimeout(() => {
      // ChatGPT renders user messages as [data-message-author-role="user"]
      // or inside elements with specific classes. Find and remove the last one.
      const userMsgs = document.querySelectorAll(
        '[data-message-author-role="user"], ' +
        '.text-message [data-message-author-role="user"]'
      );
      if (userMsgs.length > 0) {
        // Walk up to the full message container and remove it
        const lastMsg = userMsgs[userMsgs.length - 1];
        const container = lastMsg.closest('[data-testid^="conversation-turn"]')
          || lastMsg.closest('article')
          || lastMsg.closest('[class*="group"]')
          || lastMsg.parentElement?.parentElement?.parentElement;
        if (container) {
          container.remove();
          console.info('[cfai] removed blocked message from UI');
        }
      }
    }, 200);
  });

  console.info('[cfai] fetch blocker installed — sensitive data will be blocked from AI APIs');
})();

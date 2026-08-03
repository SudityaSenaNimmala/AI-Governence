// Content script — observes the page's prompt inputs and emits DLP events to
// the background service worker. As of 2026-05-18 it also forwards the full
// prompt text and file bytes for inline dashboard preview. See
// [[project_content_storage]] in memory for policy context.

(function () {
  // ── one bootstrap per document ─────────────────────────────────────────────
  // THIS FILE IS INJECTED TWICE ON SOME HOSTS, and everything below it runs twice
  // when it is. Two independent paths put the same stack into the same document:
  //
  //   1. manifest.json content_scripts[0].matches — the hardcoded host list, which
  //      Chrome injects on page load. chatgpt.com is in it.
  //   2. background/service-worker.js injectDlpStack() via chrome.scripting — the
  //      path for hosts an admin registered or the classifier decided to govern.
  //      Its `_injectedTabs` Set only stops IT from injecting twice; it knows
  //      nothing about what the manifest already injected.
  //
  // A host that is in BOTH (chatgpt.com is) therefore gets the whole stack twice in
  // one document. Confirmed live: two "content script v2 loaded" lines, two replay
  // controllers registering two runs for ONE session id, and two DLP layers each
  // scanning and each showing their own modal.
  //
  // The guard is a WINDOW property, not a module-scope variable: a second injection
  // is a second, completely separate evaluation of this file, so only shared state
  // on the (isolated-world) window can be seen across the two. Same pattern as
  // installEnforcementHooks()'s __cfaiEnforceInstalled below, hoisted to cover the
  // WHOLE file — that one only made one sub-feature idempotent, so a second
  // injection still re-ran everything else.
  //
  // It must stay FIRST: nothing above it may have a side effect, or the second
  // injection would still fire it before returning.
  if (window.__cfaiContentBootstrapped) {
    console.info('[cfai] content script already bootstrapped on', location.hostname,
                 '— ignoring this injection (manifest + scripting both cover this host)');
    return;
  }
  window.__cfaiContentBootstrapped = true;

  console.info('[cfai] content script v2 loaded on', location.hostname);

  // Inject fetch blocker IMMEDIATELY (synchronous) so it patches fetch()
  // before any page JS fires. The blocked list arrives shortly after via
  // postMessage from the cached storage read.
  try {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('content/fetch-blocker.js');
    (document.head || document.documentElement).appendChild(script);
    script.onload = () => script.remove();
  } catch (e) {
    console.warn('[cfai] could not inject fetch blocker:', e);
  }

  // Load blocked list from cache and send to fetch-blocker immediately
  try {
    chrome.storage.local.get(['cfai.blocked'], (result) => {
      const cached = result['cfai.blocked'] || [];
      if (cached.length > 0) applyBlockedList(cached);
    });
  } catch (e) {}

  // Listen for blocked fetch events from the fetch-blocker (safety net).
  window.addEventListener('cfai-fetch-blocked', (e) => {
    if (PLATFORM_BLOCKED) return;
    const { matches } = e.detail || {};
    console.info('[cfai] fetch was blocked, showing popup. Matches:', matches);
    const matchObjs = (matches || []).map(name => ({ pattern: name, severity: 'critical', count: 1 }));
    showWarning(matchObjs, 'Sensitive data blocked from being sent');
  });

  // ── AI response capture (Session Replay, phase 3) ───────────────────────────
  // fetch-blocker.js runs in the PAGE's JS world. It tees the site's own chat
  // response, reassembles the assistant's full reply from whatever streaming
  // format that site uses, and hands the finished text over on the SAME window
  // CustomEvent channel the block path already uses — no new cross-world
  // mechanism.
  //
  // Here, in the isolated content-script world, we turn it into an ordinary
  // governance event. Going through emit() is the whole point: the reply
  // automatically inherits the session_id this tab is already tracking plus the
  // next client_seq, so a conversation stays ordered and groupable exactly the
  // way phase 1 set up.
  //
  // Exactly ONE event per response — the page side buffers the stream and only
  // fires at end-of-stream, so nothing here runs per streamed token.
  const AI_RESPONSE_MAX_CHARS = 1024 * 1024;
  let _lastAiResponseKey = '';
  window.addEventListener('cfai-ai-response', (e) => {
    try {
      const d = e.detail || {};
      let text = typeof d.text === 'string' ? d.text : '';
      if (!text.trim()) return;

      let truncated = !!d.truncated;
      if (text.length > AI_RESPONSE_MAX_CHARS) {
        text = text.slice(0, AI_RESPONSE_MAX_CHARS);
        truncated = true;
      }

      // Sites sometimes refetch the same conversation (retry, tab refocus,
      // regenerate). Drop an identical back-to-back reply instead of counting
      // the turn twice.
      const key = text.length + ':' + text.slice(0, 200) + '|' + text.slice(-200);
      if (key === _lastAiResponseKey) return;
      _lastAiResponseKey = key;

      emit({
        kind: 'ai_response',
        content_text: text,
        content_length: text.length,
        length_bucket: lengthBucket(text.length),
        matches: [],                 // the reply is captured, not scanned, in this phase
        response_format: d.format || null,
        capture_truncated: truncated ? 1 : 0,
        duration_ms: typeof d.duration_ms === 'number' ? d.duration_ms : null,
      });
      console.info('[cfai] captured AI response —', text.length, 'chars,', d.format, 'format');
    } catch (err) {
      // Capture is best-effort and must never disturb the page.
    }
  });

  // ── Full-platform block ────────────────────────────────────────────────────
  // An admin can mark an AI platform "blocked" in the governance registry. On a
  // blocked host we refuse EVERY send (not only sensitive ones) and show an
  // org-block notice. The flag rides along in the platforms mirror the service
  // worker syncs into chrome.storage.local (key 'cfai.platforms').
  let PLATFORM_BLOCKED = false;
  let BLOCKED_PLATFORM = null;
  function platformBlockMatch(platforms) {
    const h = location.hostname.toLowerCase();
    for (const p of platforms || []) {
      if (!p || !p.blocked || !p.host) continue;
      const ph = String(p.host).toLowerCase();
      if (h === ph || h.endsWith('.' + ph)) return p;
    }
    return null;
  }
  function applyPlatformPolicy(platforms) {
    const hit = platformBlockMatch(platforms);
    PLATFORM_BLOCKED = !!hit;
    BLOCKED_PLATFORM = hit;
    if (PLATFORM_BLOCKED) showPlatformBanner();
    else removePlatformBanner();
  }
  try {
    // 1) Instant first paint from the cached mirror.
    chrome.storage.local.get(['cfai.platforms'], (r) => applyPlatformPolicy(r['cfai.platforms'] || []));
    // 2) Live updates when the service worker rewrites the mirror.
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes['cfai.platforms']) applyPlatformPolicy(changes['cfai.platforms'].newValue || []);
    });
    // 3) Near-real-time poll (~3s) so admin block/allow changes reflect quickly
    //    on this open tab. We ask the service worker (it caches + does the
    //    cross-origin fetch); content-script fetches would hit the page CSP.
    const pollPolicy = () => {
      try {
        chrome.runtime.sendMessage({ type: 'cfai-get-platforms' }, (resp) => {
          if (chrome.runtime.lastError) return;
          if (resp && Array.isArray(resp.platforms)) applyPlatformPolicy(resp.platforms);
        });
      } catch (e) {}
    };
    setInterval(pollPolicy, 3000);
    pollPolicy();
  } catch (e) {}

  const SERVICE = inferService(location.hostname);
  const scan = window.__cfaiPatterns?.scan ?? (() => []);
  const classifyFile = window.__cfaiPatterns?.classifyFile ?? ((n) => ({ class: 'other', severity: 'low', reason: '' }));
  const sizeBucket = window.__cfaiPatterns?.sizeBucket ?? (() => '?');

  // Bucket the content length so we don't leak exact prompt sizes.
  function lengthBucket(n) {
    if (n < 100)    return '<100';
    if (n < 1000)   return '100-1k';
    if (n < 10000)  return '1k-10k';
    if (n < 50000)  return '10k-50k';
    return '50k+';
  }

  // Detect prompt input elements on this site. Generic across AI services:
  // they all use either <textarea>, [contenteditable], or [role="textbox"].
  // Find every prompt-like input on the page, traversing into open shadow
  // roots recursively. Salesforce Lightning components (and many SaaS
  // chatbots that use Web Components) attach their UI inside shadow trees,
  // so a flat document.querySelectorAll misses them entirely.
  function findPromptInputs(root = document) {
    const out = [];
    // Selector notes:
    //   - `[contenteditable]:not([contenteditable="false"])` catches both
    //     `contenteditable="true"` AND `contenteditable=""` (which is
    //     semantically true but didn't match the old strict selector). Many
    //     modern editors — Lovable, Slate-based UIs, Lexical — emit
    //     <div contenteditable> with no value attribute.
    //   - `role="combobox"` / `role="searchbox"` catch a few AI tools that
    //     style their main prompt as a search-like combobox (Perplexity
    //     historically did this).
    const SELECTOR =
      'textarea, ' +
      '[contenteditable]:not([contenteditable="false"]), ' +
      '[role="textbox"], [role="combobox"], [role="searchbox"]';
    const visit = (r) => {
      try {
        for (const el of r.querySelectorAll(SELECTOR)) out.push(el);
        // Open shadow roots — Salesforce Lightning, some Web Component UIs.
        for (const el of r.querySelectorAll('*')) {
          if (el.shadowRoot) visit(el.shadowRoot);
        }
        // Same-origin iframes — some AI app builders (Lovable, Stackblitz,
        // partial Bolt usage) mount the chat input inside an inline frame.
        // Cross-origin frames throw on contentDocument; we silently skip them.
        if (typeof r.querySelectorAll === 'function') {
          for (const ifr of r.querySelectorAll('iframe, frame')) {
            try {
              const doc = ifr.contentDocument;
              if (doc) visit(doc);
            } catch { /* cross-origin — skip */ }
          }
        }
      } catch { /* skip */ }
    };
    visit(root);
    return out;
  }

  function readInputText(el) {
    if (!el) return '';
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') return el.value || '';
    return el.innerText || '';
  }

  /**
   * Write text into a prompt input element in a React-compatible way.
   * React ignores direct .value assignments because it tracks input state
   * internally. We use the native value setter and dispatch proper events
   * so React picks up the change.
   *
   * ⚠ DO NOT use this to write MASKED text before sending. Its contenteditable
   * path (execCommand, then a raw `textContent =` fallback) cannot be trusted on
   * editors that keep their own content model — see writeMaskedText() below,
   * which verifies the write and refuses to send when it cannot. Kept here for
   * the legacy redactPrompt() helper only.
   */
  function writeInputText(el, text) {
    if (!el) return;
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      // Use native setter to bypass React's synthetic event system
      const nativeSetter = Object.getOwnPropertyDescriptor(
        el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
        'value'
      )?.set;
      if (nativeSetter) {
        nativeSetter.call(el, text);
      } else {
        el.value = text;
      }
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      // contenteditable element (ChatGPT, Claude, etc.)
      el.focus();
      // Select all existing content and replace
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      sel.removeAllRanges();
      sel.addRange(range);
      // Use execCommand for React/framework compatibility
      document.execCommand('insertText', false, text);
      // Fallback if execCommand is not supported
      if (readInputText(el).trim() !== text.trim()) {
        el.textContent = text;
        el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
      }
    }
  }

  /**
   * Redact sensitive data in the prompt and optionally trigger send.
   * Returns the redacted text and replacement details.
   */
  function redactPrompt(el) {
    if (!el) return null;
    const text = readInputText(el);
    if (!text) return null;
    const { redacted, replacements } = window.__cfaiPatterns.redact(text, BLOCK_SEVERITIES);
    if (replacements.length === 0) return null;
    writeInputText(el, redacted);
    return { original: text, redacted, replacements };
  }

  /**
   * Simulate pressing Enter on the prompt input to trigger send.
   * Delayed to let React process the text change first.
   */
  function simulateSend(el) {
    setTimeout(() => {
      if (!el) return;
      el.focus();
      const enterEvent = new KeyboardEvent('keydown', {
        key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
        bubbles: true, cancelable: true,
      });
      el.dispatchEvent(enterEvent);
    }, 150);
  }

  // Read a File/Blob and return its bytes as a base64 string. Streaming via
  // FileReader avoids the 100MB+ string concat path that crashes Chrome.
  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onerror = () => reject(r.error || new Error('FileReader failed'));
      r.onload  = () => {
        const result = r.result || '';
        const comma = result.indexOf(',');
        resolve(comma >= 0 ? result.slice(comma + 1) : '');
      };
      r.readAsDataURL(file);
    });
  }

  // ── Conversation identity (Session Replay) ─────────────────────────────────
  // THE SESSION IS NOT MINTED HERE ANY MORE.
  //
  // It used to be: three locals (_sessionId / _clientSeq / _lastConvId) minted a
  // session_id on first attach and rotated it whenever the conversation id in the
  // URL changed. Content-script memory dies on every page load, so a reload — or
  // the site's own hard navigation between chats — silently started a new session,
  // and so did every chat switch.
  //
  // A session now spans a continuous stretch of using the SAME AI service in the
  // SAME tab: it survives chat switches, "New chat" and same-service reloads, and
  // ends only on tab close, a switch to a different AI service, 15 min without
  // visible-tab use, a 12h cap or a browser restart. That state cannot live here,
  // so background/service-worker.js owns it (chrome.storage.local, keyed by tab
  // id, which survives navigation) and stamps session_id / client_seq onto every
  // event as it arrives. emit() below deliberately sends neither.
  //
  // What this file is still the only place that can do is READ THE URL. So the
  // conversation id stays here, and it is now purely informational: a
  // `session_bind` event tells the server "this session also touched the site's
  // own conversation X", which it accumulates. It no longer decides anything.

  // Conversation-id shapes for the sites that only put a real id in the URL
  // after the first message is sent. A site we have no pattern for simply has
  // no external id — the session_id alone still groups the conversation.
  const CONV_ID_PATTERNS = [
    /\/c\/([\w-]{8,})/,             // ChatGPT      /c/<id>
    /\/chat\/([\w-]{8,})/,          // Claude, Poe  /chat/<uuid>
    /\/app\/([\w-]{8,})/,           // Gemini       /app/<id>
    /\/conversation\/([\w-]{8,})/,  // Copilot-style
    /\/threads?\/([\w-]{8,})/,      // thread-style urls
    /\/search\/([\w-]{8,})/,        // Perplexity   /search/<slug>
  ];

  let _lastConvId = null;  // conversation id last seen in the URL

  function currentConvId() {
    try {
      const path = location.pathname || '';
      for (const re of CONV_ID_PATTERNS) {
        const m = path.match(re);
        if (m) return m[1];
      }
    } catch (e) {}
    return null;
  }

  // Tiny event that carries no content — only "the session this tab is in also
  // covers the AI site's own conversation id X".
  function emitSessionBind(convId) {
    emit({ kind: 'session_bind', external_conv_id: convId });
  }

  // Called from scanAndAttach() — which the SPA MutationObserver and the 5s
  // re-scan already drive — plus history events, so we notice an SPA route
  // change without adding yet another observer. A changed conversation id is NOT
  // a session boundary any more; it only produces a bind.
  function checkConvUrl() {
    const conv = currentConvId();
    if (conv === _lastConvId) return;
    _lastConvId = conv;
    if (conv) emitSessionBind(conv);      // "New chat" (conv → null) binds nothing
  }

  function emit(event) {
    try {
      chrome.runtime.sendMessage({
        ...event,
        service: SERVICE,
        occurredAt: new Date().toISOString(),
        // NO session_id / client_seq: the service worker stamps both from the
        // engagement record it owns for this tab. Sending our own would be a
        // second, page-lifetime-scoped opinion about where the session starts —
        // exactly the bug this change removes.
        //
        // __cfai_visible is a control field, stripped by the worker before the
        // event is queued. It decides whether this event counts as visible-tab
        // use and therefore slides the 15-min idle window: a backgrounded tab
        // that keeps streaming replies must NOT keep its session alive forever.
        __cfai_visible: isTabVisible(),
      }, (resp) => {
        // The worker answers with the session this event landed in, so the cache
        // the replay controller reads is refreshed for free — no extra RPC.
        if (chrome.runtime.lastError) return;
        if (resp && typeof resp.session_id === 'string' && resp.session_id) {
          _cachedSessionId = resp.session_id;
        }
      });
    } catch (e) {
      // Extension context may be lost (reload, update). Silently drop.
    }
  }

  function isTabVisible() {
    try { return document.visibilityState !== 'hidden'; } catch (e) { return true; }
  }

  // --- the session id this tab is in, as last reported by the worker ---
  // The replay controller (content/replay.js) needs it on every tick to keep one
  // run scoped to one session_id, and it must never block or mint. So the answer
  // is cached and refreshed asynchronously: on emit (something happened), and on
  // visibilitychange (coming back to the tab is use, and is also the moment a
  // stale cached id is most likely to be wrong).
  //
  // Same RPC the offscreen recorder already uses (__cfai_kind:'currentSessionId'),
  // with touch:true so the ask also registers as visible-tab use — someone
  // reading a long reply without typing is still using the session. It cannot
  // mint: a 'touch' signal never creates an engagement.
  let _cachedSessionId = null;
  let _sessionIdAskedAt = 0;
  const SESSION_ID_REFRESH_MS = 2000;

  function currentSessionIdCached() {
    return _cachedSessionId;
  }

  function refreshSessionId(force) {
    const now = Date.now();
    if (!force && now - _sessionIdAskedAt < SESSION_ID_REFRESH_MS) return;
    _sessionIdAskedAt = now;
    try {
      chrome.runtime.sendMessage(
        { __cfai_kind: 'currentSessionId', touch: true, __cfai_visible: isTabVisible() },
        (resp) => {
          if (chrome.runtime.lastError) return;
          _cachedSessionId = (resp && typeof resp.session_id === 'string' && resp.session_id)
            ? resp.session_id
            : null;
        },
      );
    } catch (e) {
      // Extension context gone. Keep the last known answer.
    }
  }

  // Client-side correlation id. Stamped on the enforcement_block event when the
  // block modal opens, then echoed as `decision_for` on whatever the user chose
  // (enforcement_redact / enforcement_decision) so the audit trail pairs up.
  function newClientEventId() {
    try {
      if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    } catch (e) {}
    return 'cfai-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  // ── Programmatic-send window ───────────────────────────────────────────────
  // "Tokenize & Send" rewrites the prompt and then triggers the site's own send
  // path. That resend must not be re-intercepted by our own layers (keydown,
  // button click, global blocker, or the _recentSensitivePaste guard). The
  // masked text no longer matches any pattern, but the paste guard is
  // time-based, so we mark a short window instead of relying on the scan.
  const PROGRAMMATIC_SEND_MS = 1500;
  let _programmaticSendAt = 0;
  function markProgrammaticSend() { _programmaticSendAt = Date.now(); }
  function isProgrammaticSend() { return (Date.now() - _programmaticSendAt) < PROGRAMMATIC_SEND_MS; }
  // Closes the window immediately. Used when a masking attempt is abandoned —
  // the original text is still in the composer, so blocking must resume NOW.
  function clearProgrammaticSend() { _programmaticSendAt = 0; }

  // True when the event originated inside our own injected UI. Uses
  // composedPath() because our modal lives in a shadow root — closest() does
  // not cross a shadow boundary and e.target is retargeted to the host.
  function isCfaiOwnUiEvent(e) {
    try {
      const path = (typeof e.composedPath === 'function') ? e.composedPath() : [];
      for (const n of path) {
        if (!n || n.nodeType !== 1 || !n.classList) continue;
        if (n.classList.contains('cfai-block-host') ||
            n.classList.contains('cfai-block-modal') ||
            n.classList.contains('cfai-toast') ||
            n.classList.contains('cfai-monitored')) return true;
      }
      return !!e.target?.closest?.('.cfai-block-host, .cfai-block-modal, .cfai-toast');
    } catch (err) {
      return false;
    }
  }

  // redact() lives in patterns.js and is pure/stateless. Wrapped so a missing
  // or throwing catalog can never take the block modal down with it.
  function safeRedact(text, patternNames) {
    try {
      const fn = window.__cfaiPatterns?.redact;
      if (typeof fn !== 'function') return null;
      const r = fn(text, patternNames);
      if (!r || typeof r.redacted !== 'string' || !Array.isArray(r.replacements)) return null;
      if (r.skipped) {
        console.warn('[cfai] redact skipped:', r.reason, '— masking not offered');
        return null;
      }
      // redact() converges to "nothing detectable left". If it still reports
      // residue we must not offer or send it.
      if (Array.isArray(r.residual) && r.residual.length > 0) {
        console.warn('[cfai] redact left detectable values behind:', r.residual.join(','),
                     '— refusing to offer masking for this prompt');
        return null;
      }
      return r;
    } catch (e) {
      console.warn('[cfai] redact failed:', e?.message || e);
      return null;
    }
  }

  // Dedup key — prevents double-emit when both the global enforcement handler
  // and the per-element fallback handler fire for the same Enter keypress.
  let _lastLogKey = null;

  // Set by handlePaste when sensitive data is pasted. Checked by tryBlock
  // when the input text hasn't been updated yet (paste+send in rapid succession).
  let _recentSensitivePaste = null;

  // Central emit + notify function for every prompt send.
  // Called from tryBlock (synchronous, captures text before React clears it)
  // AND from the per-element keydown fallback (with pre-captured text).
  function logPromptEvent(text) {
    if (!text || text.length < 4) return;
    const key = text.length + '|' + text.slice(0, 32);
    if (key === _lastLogKey) return;   // already logged this prompt
    _lastLogKey = key;
    setTimeout(() => { if (_lastLogKey === key) _lastLogKey = null; }, 600);

    const matches = scan(text);
    const severity = highestSeverity(matches);

    emit({
      kind: 'prompt_submit',
      length_bucket: lengthBucket(text.length),
      content_length: text.length,
      matches: matches.map(({ pattern, class: cls, severity: sev, count }) => ({ pattern, class: cls, severity: sev, count })),
      highest_severity: severity,
      content_text: text,
    });

    if (severity === 'critical' || severity === 'high') {
      showWarning(matches);
    } else {
      showMonitoredIndicator();
    }
  }

  // Subtle bottom-right badge shown for every clean/low-severity prompt send
  // so users can confirm the extension is active on ChatGPT, Claude, etc.
  function showMonitoredIndicator() {
    document.querySelector('.cfai-monitored')?.remove();
    const el = document.createElement('div');
    el.className = 'cfai-monitored';
    el.textContent = '🛡 Prompt monitored · CloudFuze AI Governance';
    Object.assign(el.style, {
      position: 'fixed', bottom: '12px', right: '12px',
      zIndex: '2147483647',
      background: 'rgba(15,23,42,0.78)', color: '#94a3b8',
      font: '11px/1.4 -apple-system,"Segoe UI",Roboto,sans-serif',
      padding: '5px 10px', borderRadius: '6px',
      boxShadow: '0 2px 8px rgba(0,0,0,.18)', pointerEvents: 'none',
      opacity: '1', transition: 'opacity 0.4s',
    });
    document.documentElement.appendChild(el);
    setTimeout(() => {
      el.style.opacity = '0';
      setTimeout(() => { try { el.remove(); } catch {} }, 400);
    }, 2200);
  }

  // Thin wrapper kept for the per-element keydown fallback path.
  function handleSubmit(el, preCapture) {
    const text = (typeof preCapture === 'string') ? preCapture : readInputText(el);
    logPromptEvent(text);
  }

  function handlePaste(el, event) {
    // Two kinds of paste: text + files attached to the clipboard.
    const cd = event.clipboardData;
    if (!cd) return;

    // Files via clipboard (rare but happens — screenshots, copied-from-explorer files)
    if (cd.files && cd.files.length > 0) {
      for (const f of cd.files) emitFileUpload(f, 'clipboard');
    }

    const text = cd.getData('text') || '';
    if (!text || text.length < 4) return;
    const matches = scan(text);
    if (matches.length === 0) return;
    const severity = highestSeverity(matches);

    emit({
      kind: 'prompt_paste',
      length_bucket: lengthBucket(text.length),
      content_length: text.length,
      matches: matches.map(({ pattern, class: cls, severity: sev, count }) => ({ pattern, class: cls, severity: sev, count })),
      highest_severity: severity,
      content_text: text,
    });

    if (severity === 'critical') {
      showWarning(matches, 'Sensitive data pasted into ' + SERVICE);
    }

    // Flag that sensitive data was just pasted — tryBlock checks this when
    // the input text hasn't updated yet (paste+Enter in rapid succession).
    if (severity === 'critical' || severity === 'high') {
      _recentSensitivePaste = { matches, text, at: Date.now() };
      setTimeout(() => { _recentSensitivePaste = null; }, 2000);
    }
  }

  // ---- File upload detection ----
  // Vectors: file picker, drag-and-drop, paste. We additionally do a LOCAL
  // content scan on text-readable files: read bytes in the browser, run our
  // secret/PII pattern catalog, send only match COUNTS to the server. The
  // file bytes never leave the user's machine.

  // Extensions we can read directly as UTF-8 text.
  const TEXT_READABLE_EXTENSIONS = new Set([
    '.txt', '.md', '.markdown',
    '.csv', '.tsv', '.psv',
    '.json', '.ndjson', '.jsonl',
    '.yaml', '.yml', '.toml', '.ini', '.conf', '.config', '.cfg', '.properties',
    '.env', '.envrc',
    '.log',
    '.html', '.htm', '.xml', '.svg',
    '.sql',
    '.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs',
    '.py', '.rb', '.go', '.rs', '.java', '.kt', '.swift', '.cs', '.cpp', '.c', '.h',
    '.sh', '.bash', '.zsh', '.ps1', '.cmd', '.bat',
    '.tf', '.tfvars',
  ]);
  // Binary formats extracted via bundled parsers.
  const BINARY_PARSEABLE = new Set([
    '.pdf',
    '.docx',
    '.xlsx', '.xls', '.xlsm', '.ods',
  ]);
  const IMAGE_EXTENSIONS = new Set([
    '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.tif', '.tiff',
  ]);
  const ARCHIVE_EXTENSIONS = new Set([
    '.zip',
  ]);
  const CONTENT_SCAN_MAX_BYTES = 25 * 1024 * 1024;  // 25 MB hard cap
  const OCR_MAX_BYTES = 8 * 1024 * 1024;            // OCR caps lower — images are slow
  const ZIP_MAX_ENTRIES = 100;
  const ZIP_MAX_DEPTH = 2;
  const SEVERITY_ORDER = ['low', 'moderate', 'high', 'critical'];

  // One-time pdf.js worker setup. Lazy — only runs when the first PDF arrives.
  let pdfWorkerConfigured = false;
  function ensurePdfWorker() {
    if (pdfWorkerConfigured) return;
    pdfWorkerConfigured = true;
    if (typeof window.pdfjsLib !== 'undefined' && window.pdfjsLib.GlobalWorkerOptions) {
      try {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('vendor/pdf.worker.js');
      } catch (e) {
        console.warn('[cfai] could not set pdf worker; falling back to main-thread parsing', e);
      }
    }
  }

  async function extractTextFromFile(file) {
    const ext = extOf(file.name);

    if (TEXT_READABLE_EXTENSIONS.has(ext)) {
      return { text: await file.text(), via: 'text_decode' };
    }

    if (ext === '.pdf') {
      if (typeof window.pdfjsLib === 'undefined') return { error: 'pdfjs_not_loaded' };
      ensurePdfWorker();
      const buf = await file.arrayBuffer();
      const pdf = await window.pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
      let text = '';
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        text += content.items.map((it) => ('str' in it) ? it.str : '').join(' ') + '\n';
      }
      return { text, via: 'pdfjs', pages: pdf.numPages };
    }

    if (ext === '.docx') {
      if (typeof window.mammoth === 'undefined') return { error: 'mammoth_not_loaded' };
      const buf = await file.arrayBuffer();
      const r = await window.mammoth.extractRawText({ arrayBuffer: buf });
      return { text: r.value || '', via: 'mammoth' };
    }

    if (ext === '.xlsx' || ext === '.xls' || ext === '.xlsm' || ext === '.ods') {
      if (typeof window.XLSX === 'undefined') return { error: 'xlsx_not_loaded' };
      const buf = await file.arrayBuffer();
      const wb = window.XLSX.read(new Uint8Array(buf), { type: 'array' });
      let text = '';
      for (const name of wb.SheetNames) {
        text += '# Sheet: ' + name + '\n';
        text += window.XLSX.utils.sheet_to_csv(wb.Sheets[name]) + '\n';
      }
      return { text, via: 'xlsx', sheets: wb.SheetNames.length };
    }

    if (IMAGE_EXTENSIONS.has(ext)) {
      if (file.size > OCR_MAX_BYTES) return { error: 'image_too_large' };
      if (typeof window.Tesseract === 'undefined') return { error: 'tesseract_not_loaded' };
      try {
        const text = await ocrImage(file);
        return { text, via: 'tesseract' };
      } catch (e) {
        console.error('[cfai] OCR failed:', e);
        return { error: 'ocr_failed: ' + (e?.message || String(e)) };
      }
    }

    return { error: 'unsupported_format', extension: ext };
  }

  // Lazy-initialized Tesseract worker. First OCR pays ~3–5s warmup
  // (loading the 10 MB language model from the extension's local files);
  // subsequent OCRs reuse the worker.
  let tessWorkerPromise = null;
  function getTesseractWorker() {
    if (tessWorkerPromise) return tessWorkerPromise;
    tessWorkerPromise = (async () => {
      const langPath = chrome.runtime.getURL('vendor/tesseract/');
      const workerPath = chrome.runtime.getURL('vendor/tesseract/worker.min.js');
      const corePath = chrome.runtime.getURL('vendor/tesseract/');
      console.log('[cfai] initializing Tesseract worker', { langPath, workerPath, corePath });
      try {
        const worker = await window.Tesseract.createWorker('eng', 1, {
          langPath,
          workerPath,
          corePath,
          // Content scripts run in the page's origin, so `new Worker('chrome-extension://...')`
          // is cross-origin and blocked. Tesseract fetches the worker script and wraps
          // it in a blob URL (page origin), which IS allowed.
          workerBlobURL: true,
          cacheMethod: 'none',
          logger: (m) => { if (m.status) console.log('[cfai] tesseract:', m.status, m.progress); },
        });
        console.log('[cfai] Tesseract worker ready');
        return worker;
      } catch (e) {
        console.error('[cfai] Tesseract worker init failed:', e);
        tessWorkerPromise = null;  // allow retry on next image
        throw e;
      }
    })();
    return tessWorkerPromise;
  }

  async function ocrImage(file) {
    const worker = await getTesseractWorker();
    // Convert the File to a data URL for Tesseract. Stays in memory.
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
    const { data } = await worker.recognize(dataUrl);
    return data?.text || '';
  }

  // Recursive zip scan — extract entries, run the same content scan on each
  // entry, accumulate match counts. Caps to ZIP_MAX_ENTRIES and ZIP_MAX_DEPTH.
  async function scanZipEntries(file, depth = 0) {
    if (typeof window.JSZip === 'undefined') return { entries: [], error: 'jszip_not_loaded' };
    if (depth >= ZIP_MAX_DEPTH) return { entries: [], error: 'max_depth' };
    const buf = await file.arrayBuffer();
    const zip = await window.JSZip.loadAsync(buf);
    const entries = [];
    let count = 0;
    for (const name of Object.keys(zip.files)) {
      if (count >= ZIP_MAX_ENTRIES) break;
      const entry = zip.files[name];
      if (entry.dir) continue;
      count++;

      const ext = extOf(name);
      const isScannable =
        TEXT_READABLE_EXTENSIONS.has(ext) || BINARY_PARSEABLE.has(ext) ||
        IMAGE_EXTENSIONS.has(ext) || ARCHIVE_EXTENSIONS.has(ext);
      if (!isScannable) {
        entries.push({ name, ext, scanned: false, reason: 'unsupported' });
        continue;
      }

      try {
        const blob = await entry.async('blob');
        const nestedFile = new File([blob], name, { type: blob.type });
        const cs = await scanFileContents(nestedFile, depth + 1);
        entries.push({
          name,
          ext,
          scanned: cs.scanned,
          via: cs.via,
          matchCount: cs.matchCount || 0,
          matches: cs.matches || [],
          contentSeverity: cs.contentSeverity || null,
        });
      } catch (e) {
        entries.push({ name, ext, scanned: false, reason: 'extract_failed' });
      }
    }
    return { entries, truncated: count >= ZIP_MAX_ENTRIES };
  }

  async function scanFileContents(file, depth = 0) {
    const ext = extOf(file.name);

    const isText    = TEXT_READABLE_EXTENSIONS.has(ext);
    const isBinary  = BINARY_PARSEABLE.has(ext);
    const isImage   = IMAGE_EXTENSIONS.has(ext);
    const isArchive = ARCHIVE_EXTENSIONS.has(ext);

    if (!isText && !isBinary && !isImage && !isArchive) {
      return { scanned: false, reason: 'unsupported_format', extension: ext };
    }
    if (file.size > CONTENT_SCAN_MAX_BYTES) {
      return { scanned: false, reason: 'too_large', bytes: file.size };
    }

    // Archive: recursively scan contents, aggregate matches.
    if (isArchive) {
      let zipResult;
      try { zipResult = await scanZipEntries(file, depth); }
      catch (e) { return { scanned: false, reason: 'zip_failed', error: String(e?.message || e) }; }
      if (zipResult.error) return { scanned: false, reason: zipResult.error };

      // Aggregate match counts across all entries
      const agg = new Map();  // pattern -> { class, severity, count }
      let topSeverity = null;
      let total = 0;
      for (const entry of zipResult.entries) {
        if (!entry.matches) continue;
        for (const m of entry.matches) {
          total += m.count;
          const key = m.pattern;
          const existing = agg.get(key);
          if (existing) existing.count += m.count;
          else agg.set(key, { pattern: m.pattern, class: m.class, severity: m.severity, count: m.count });
          if (SEVERITY_ORDER.indexOf(m.severity) > SEVERITY_ORDER.indexOf(topSeverity)) topSeverity = m.severity;
        }
      }

      return {
        scanned: true,
        via: 'jszip',
        bytesScanned: file.size,
        entries: zipResult.entries.length,
        truncated: !!zipResult.truncated,
        matchCount: total,
        matches: [...agg.values()],
        contentSeverity: topSeverity,
        // Include a brief breakdown of which entries were dirty
        entryBreakdown: zipResult.entries
          .filter((e) => (e.matchCount || 0) > 0)
          .map((e) => ({ name: e.name, matches: e.matchCount, severity: e.contentSeverity })),
      };
    }

    let extraction;
    try {
      extraction = await extractTextFromFile(file);
    } catch (e) {
      return { scanned: false, reason: 'extraction_failed', error: String(e?.message || e) };
    }
    if (extraction.error) {
      return { scanned: false, reason: extraction.error, extension: ext };
    }

    const text = extraction.text || '';
    const matches = scan(text);
    const lineCount = (text.match(/\n/g) || []).length + 1;

    let topSeverity = null;
    for (const m of matches) {
      if (SEVERITY_ORDER.indexOf(m.severity) > SEVERITY_ORDER.indexOf(topSeverity)) topSeverity = m.severity;
    }

    return {
      scanned: true,
      via: extraction.via,
      bytesScanned: file.size,
      lineCount,
      pages: extraction.pages,
      sheets: extraction.sheets,
      matchCount: matches.reduce((a, m) => a + m.count, 0),
      matches: matches.map(({ pattern, class: cls, severity, count }) => ({ pattern, class: cls, severity, count })),
      contentSeverity: topSeverity,
    };
  }

  async function emitFileUpload(file, via) {
    if (!file || !file.name) return;
    const r = classifyFile(file.name, file.size);

    // Try to read the contents locally and run the pattern catalog. This
    // happens in parallel with the upload itself (we don't block the user).
    const contentScan = await scanFileContents(file);

    // Promote severity if content scan found something nastier than the
    // filename heuristic suggested.
    let severity = r.severity;
    if (contentScan?.contentSeverity &&
        SEVERITY_ORDER.indexOf(contentScan.contentSeverity) > SEVERITY_ORDER.indexOf(severity)) {
      severity = contentScan.contentSeverity;
    }

    console.log('[cfai] emit file_upload', {
      filename: file.name, size: file.size, class: r.class, severity, via,
      scanned: contentScan?.scanned, matches: contentScan?.matchCount ?? 0,
    });

    // Read the raw bytes for the dashboard preview. 25 MB cap mirrors the
    // server's MAX_CONTENT_BYTES. Beyond that we just send the metadata and
    // skip content; the server would truncate anyway.
    const PREVIEW_MAX = 25 * 1024 * 1024;
    let contentBase64 = null;
    let contentText = null;
    if (file.size <= PREVIEW_MAX) {
      try {
        if (TEXT_READABLE_EXTENSIONS.has(extOf(file.name).toLowerCase())) {
          contentText = await file.text();
        } else {
          contentBase64 = await fileToBase64(file);
        }
      } catch (e) {
        console.warn('[cfai] could not read file for preview:', e?.message || e);
      }
    }

    emit({
      kind: 'file_upload',
      via,
      filename: file.name,
      size: file.size,
      size_bucket: sizeBucket(file.size),
      mime_type: file.type || null,
      extension: extOf(file.name),
      file_class: r.class,
      severity,
      reason: r.reason,
      content_scan: contentScan,
      content_text: contentText,
      content_base64: contentBase64,
    });

    // After the async content scan: surface a bottom-right toast for any file
    // that came back risky. The centered popup is reserved for send-time so
    // the file-upload step itself doesn't feel modal. The prompt-send block
    // is the hard backstop — even if the user ignores this toast, the actual
    // send won't go through while the prompt or attachment still contains
    // sensitive data.
    const hasContentMatches = contentScan?.matchCount > 0;
    const filenameWasRisky = severity === 'high' || severity === 'critical';
    if (hasContentMatches || filenameWasRisky) {
      const patterns = hasContentMatches && contentScan.matches?.length
        ? contentScan.matches.map((m) => ({ pattern: m.pattern, class: m.class, severity: m.severity, count: m.count }))
        : [{ pattern: r.class || 'file', class: r.class, severity, count: 1 }];
      const note = hasContentMatches
        ? `${file.name} → ${SERVICE}  (${contentScan.matchCount} sensitive matches found)`
        : `${file.name} → ${SERVICE}  (${r.reason})`;
      if (hasContentMatches) {
        console.info('[cfai] file content-scan flagged', file.name, '— matches:',
          patterns.map((p) => p.pattern).join(', '));
      }
      showWarning(patterns, note);
      // Remember the file so the send-time check can block if it's still
      // attached when the user hits Send (the prompt text itself may be
      // perfectly innocuous — "summarize this file" — but the attachment is not).
      rememberFlaggedFile(file.name, patterns, severity);
    }
  }

  function extOf(name) {
    const m = name.match(/(\.[^./\\]+)$/);
    return m ? m[1].toLowerCase() : '';
  }

  // Document-level capture for ANY `change` event on a file input — much more
  // robust than walking the DOM, since AI sites mount the file input lazily
  // and often hide it (display:none). Capture phase = we run before the page's
  // own handlers, so even sites that stopPropagation() can't shut us out.
  // File upload enforcement: filename heuristic is synchronous so we can
  // preventDefault BEFORE the page's React handler sees the change/drop.
  // Content-based block runs in the async path after the file is already
  // in the page state — too late to revoke via preventDefault, so we just
  // emit a warning + dashboard event there.
  function filenameRisky(file) {
    if (!ENFORCE) return null;
    const r = classifyFile(file.name, file.size);
    if (BLOCK_SEVERITIES.has(r.severity)) return r;
    return null;
  }

  document.addEventListener('change', (e) => {
    const t = e.target;
    if (!t || t.tagName !== 'INPUT' || t.type !== 'file') return;
    const files = t.files;
    if (!files || files.length === 0) return;

    const blocked = [...files].filter((f) => filenameRisky(f));
    if (blocked.length > 0) {
      e.preventDefault();
      e.stopImmediatePropagation();
      try { t.value = ''; } catch {}
      for (const f of blocked) {
        const r = classifyFile(f.name, f.size);
        console.info('[cfai] BLOCKED upload (filename) via change:', f.name);
        showWarning(
          [{ pattern: r.class, class: r.class, severity: r.severity, count: 1 }],
          `File upload blocked: ${f.name}`,
        );
        rememberFlaggedFile(f.name, [{ pattern: r.class, severity: r.severity, count: 1 }], r.severity);
        emit({
          kind: 'enforcement_block',
          blocked_for: 'file_upload',
          filename: f.name,
          file_class: r.class,
          severity: r.severity,
          highest_severity: r.severity,
          reason: r.reason,
        });
      }
      return;
    }

    console.log('[cfai] file_picker change captured:', files.length, 'file(s)');
    for (const f of files) emitFileUpload(f, 'file_picker');
  }, true);

  // Drag-and-drop — page-wide, capture phase
  document.addEventListener('drop', (e) => {
    if (!e.dataTransfer?.files || e.dataTransfer.files.length === 0) return;

    const blocked = [...e.dataTransfer.files].filter((f) => filenameRisky(f));
    if (blocked.length > 0) {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (typeof e.stopPropagation === 'function') e.stopPropagation();
      for (const f of blocked) {
        const r = classifyFile(f.name, f.size);
        console.info('[cfai] BLOCKED upload (filename) via drop:', f.name);
        showWarning(
          [{ pattern: r.class, class: r.class, severity: r.severity, count: 1 }],
          `File drop blocked: ${f.name}`,
        );
        rememberFlaggedFile(f.name, [{ pattern: r.class, severity: r.severity, count: 1 }], r.severity);
        emit({
          kind: 'enforcement_block',
          blocked_for: 'file_upload',
          filename: f.name,
          file_class: r.class,
          severity: r.severity,
          highest_severity: r.severity,
          reason: r.reason,
        });
      }
      return;
    }

    console.log('[cfai] drop captured:', e.dataTransfer.files.length, 'file(s)');
    for (const f of e.dataTransfer.files) emitFileUpload(f, 'drop');
  }, true);

  // Some AI apps use Shadow DOM. Walk the document for shadow roots and
  // re-attach our listeners inside them too.
  function attachToShadowRoots(root = document) {
    try {
      const all = root.querySelectorAll('*');
      for (const el of all) {
        if (el.shadowRoot && !el.shadowRoot.__cfaiAttached) {
          el.shadowRoot.__cfaiAttached = true;
          // File-picker change inside the shadow tree.
          el.shadowRoot.addEventListener('change', (e) => {
            const t = e.target;
            if (!t || t.tagName !== 'INPUT' || t.type !== 'file') return;
            if (!t.files || t.files.length === 0) return;
            for (const f of t.files) emitFileUpload(f, 'file_picker_shadow');
          }, true);
          // Prompt inputs *inside* the shadow tree need our paste/keydown
          // handlers too — without this, Lightning/Web-Component chat widgets
          // (Salesforce Agentforce, etc.) get zero coverage.
          for (const promptEl of findPromptInputs(el.shadowRoot)) attach(promptEl);
          // Recurse — shadow roots can contain shadow roots.
          attachToShadowRoots(el.shadowRoot);
        }
      }
    } catch { /* closed shadow or cross-origin — skip */ }
  }
  attachToShadowRoots();

  function highestSeverity(matches) {
    const order = ['low', 'moderate', 'high', 'critical'];
    let top = null;
    for (const m of matches) {
      if (order.indexOf(m.severity) > order.indexOf(top)) top = m.severity;
    }
    return top;
  }

  // ============================================================
  // ENFORCEMENT — block the send action when sensitive content is present.
  // ============================================================
  // Design: lazy intercept, zero DOM manipulation.
  //
  // We do NOT disable the send button, inject inline banners, or rescan on
  // every keystroke. An earlier version did all three and it fought ChatGPT's
  // React render loop badly enough to trigger Chrome's "Page Unresponsive"
  // dialog. The lesson: never mutate the host page's React-managed DOM from
  // a content script if you can avoid it.
  //
  // Instead: when the user actually tries to send (Enter without Shift, or a
  // click on something that looks like a send button), we do ONE scan of the
  // current input text. If it contains high/critical patterns, we:
  //   1. preventDefault + stopImmediatePropagation so the page never sees it
  //   2. emit an enforcement_block event to the governance server
  //   3. open a centered modal popup explaining why the send was blocked
  // No state stored, no input listeners, no button-disabling churn.
  //
  // Override gesture: Ctrl+Alt+Enter sends anyway (logged as enforcement_override).

  const ENFORCE = true;
  const BLOCK_SEVERITIES = new Set(['high', 'critical']);

  // filename → { matches, severity, chipEl }
  //
  // Populated whenever a file is flagged at upload (sync filename heuristic
  // or async content scan). Used at send time to decide whether to block a
  // "clean prompt with a dirty attachment".
  //
  // chipEl is a reference to the actual DOM element that the host page (e.g.
  // ChatGPT) rendered to represent the attachment. We grab it shortly after
  // remembering the file by searching for the filename text/attrs, then
  // walking up to the chip's container. At send time we check
  // chipEl.isConnected as the primary signal: if the chip is still in the
  // DOM the user hasn't removed it. This works even when the host page
  // truncates the visible filename ("Long_Name..."), because chipEl is a
  // stable element reference rather than a text match.
  const flaggedFiles = new Map();

  function rememberFlaggedFile(filename, matches, severity) {
    if (!filename) return;
    flaggedFiles.set(filename, {
      matches: (matches || []).map((m) => ({ pattern: m.pattern, severity: m.severity, count: m.count || 1 })),
      severity: severity || 'high',
      chipEl: null,
    });
    // Try to find the rendered chip element. Retries because ChatGPT renders
    // the chip after a few React tick(s) — not synchronously after the drop.
    let attempts = 0;
    const tick = () => {
      attempts++;
      const entry = flaggedFiles.get(filename);
      if (!entry || entry.chipEl) return;
      const chip = findChipElementByFilename(filename);
      if (chip) {
        entry.chipEl = chip;
        console.info('[cfai] tracked chip for', filename);
        return;
      }
      if (attempts < 8) setTimeout(tick, 200);   // up to ~1.6s of retries
    };
    setTimeout(tick, 100);
  }

  // Walks the document for an element representing the attachment chip for
  // `filename`. Best-effort: prefers HTML attribute match (title/aria-label/
  // alt usually carry the full name), falls back to a distinctive prefix in
  // the visible text. Returns the closest plausible chip container, not the
  // text node itself.
  function findChipElementByFilename(filename) {
    if (!filename) return null;
    const stem = filename.replace(/\.[^.]+$/, '');
    const prefix = stem.slice(0, 16);
    const all = document.body?.querySelectorAll('*') || [];
    for (const el of all) {
      if (!el || el.children.length > 12) continue;
      const html = el.outerHTML || '';
      const txt  = el.textContent || '';
      if (txt.length > 300 && html.length > 1000) continue;
      const matched =
        html.includes(filename) ||
        (prefix.length >= 8 && txt.includes(prefix));
      if (!matched) continue;
      // Walk up to find a chip-shaped ancestor (has siblings / is itself a chip).
      let chip = el;
      for (let i = 0; i < 4 && chip.parentElement; i++) {
        if (chip.children.length >= 2) break;
        chip = chip.parentElement;
      }
      return chip;
    }
    return null;
  }

  function isPromptInput(el) {
    if (!el || !el.tagName) return false;
    if (el.tagName === 'TEXTAREA') return true;
    if (el.getAttribute && (el.getAttribute('contenteditable') === 'true' || el.getAttribute('role') === 'textbox')) return true;
    return false;
  }

  // Find the prompt input that "owns" this send button by walking up to the
  // composer container, then searching down for a prompt input.
  function findPromptInputFor(btn) {
    let container = btn.closest('form, [class*="composer" i], [class*="input" i], [data-testid*="composer" i]');
    if (!container) container = btn.parentElement?.parentElement?.parentElement || document.body;
    return container.querySelector('textarea, [contenteditable="true"], [role="textbox"]') || null;
  }

  function looksLikeSendButton(btn) {
    if (!btn) return false;
    const label = (btn.getAttribute('aria-label') || '').toLowerCase();
    const text  = (btn.innerText || '').toLowerCase().trim();
    const tid   = (btn.getAttribute('data-testid') || '').toLowerCase();
    const cls   = (btn.className || '').toLowerCase();
    if (label.includes('send') || label.includes('submit')) return true;
    if (text === 'send' || text === 'submit') return true;
    if (tid.includes('send-button') || tid.includes('send_button') || tid.includes('send')) return true;
    if (btn.type === 'submit') return true;
    // ChatGPT uses an SVG arrow button near the composer — catch any button
    // inside the composer form/container that has an SVG child (icon button)
    if (btn.querySelector('svg') && btn.closest('form, [class*="composer" i], [class*="input-area" i], [class*="prompt" i], [class*="chat-input" i]')) return true;
    // Also match by proximity — any button right next to a textarea/contenteditable
    const sibling = btn.previousElementSibling || btn.parentElement;
    if (sibling && (sibling.querySelector?.('textarea, [contenteditable="true"], [role="textbox"]'))) return true;
    return false;
  }

  function scanForBlockers(text) {
    if (!text || text.length < 4) return null;
    const matches = scan(text).filter((m) => BLOCK_SEVERITIES.has(m.severity));
    return matches.length > 0 ? matches : null;
  }


  // Returns the client_event_id it stamped on the event so the caller can pass
  // it to the modal — whatever the user then chooses references it via
  // `decision_for`.
  function emitEnforcement(action, el, matches, kind, clientEventId) {
    const text = el ? readInputText(el) : '';
    const eventId = clientEventId || newClientEventId();
    emit({
      kind: 'enforcement_' + action,
      client_event_id: eventId,
      blocked_for: kind,
      matches: (matches || []).map((m) => ({ pattern: m.pattern, class: m.class, severity: m.severity, count: m.count })),
      highest_severity: highestSeverity(matches || []),
      content_length: text.length,
      length_bucket: el ? lengthBucket(text.length) : '<100',
      // Carry the blocked text so admins can View what was stopped — same as
      // paste/submit events. The server stores this in dlp_content.
      content_text: text || undefined,
    });
    return eventId;
  }

  // ── Modal host + style isolation ───────────────────────────────────────────
  // The modal is interactive now (two real choices), so a hostile or merely
  // aggressive host-page CSS rule making it unusable is a functional risk.
  // We therefore render it inside an OPEN shadow root and adopt our own
  // content.css inside that root, so page CSS cannot reach it. Older Chromium
  // without constructable stylesheets falls back to the previous light-DOM
  // path (manifest-injected content.css styles it there).
  const MODAL_HOST_SELECTOR = '.cfai-block-host, .cfai-block-modal';

  // "Tokenize & Send" holds default focus, and the modal usually opens from the
  // user's own Enter keydown — so OS key-repeat from that same keypress could
  // activate it before the preview has been read. Keyboard activation of that
  // one button is therefore ignored for this long after the modal opens.
  // Pointer clicks are never delayed, and "Edit manually" is never delayed.
  const TOKENIZE_KEY_ARM_MS = 300;

  let _modalSheet = null;         // CSSStyleSheet once fetched + parsed
  let _modalSheetTried = false;
  function primeModalStylesheet() {
    if (_modalSheetTried) return;
    _modalSheetTried = true;
    try {
      if (typeof CSSStyleSheet === 'undefined' ||
          typeof CSSStyleSheet.prototype.replaceSync !== 'function' ||
          typeof ShadowRoot === 'undefined' ||
          !('adoptedStyleSheets' in ShadowRoot.prototype)) {
        console.info('[cfai] constructable stylesheets unavailable — modal will use light DOM');
        return;
      }
      const sheet = new CSSStyleSheet();
      fetch(chrome.runtime.getURL('content/content.css'))
        .then((r) => (r.ok ? r.text() : Promise.reject(new Error('css http ' + r.status))))
        .then((css) => { sheet.replaceSync(css); _modalSheet = sheet; })
        .catch((e) => console.warn('[cfai] modal stylesheet unavailable, using light DOM:', e?.message || e));
    } catch (e) {
      console.warn('[cfai] modal stylesheet setup failed, using light DOM:', e?.message || e);
    }
  }
  primeModalStylesheet();

  function existingCfaiModal() {
    return document.querySelector(MODAL_HOST_SELECTOR);
  }
  function removeExistingCfaiModal() {
    for (const n of document.querySelectorAll(MODAL_HOST_SELECTOR)) {
      try {
        if (typeof n.__cfaiClose === 'function') n.__cfaiClose();
        else n.remove();
      } catch (e) { try { n.remove(); } catch (e2) {} }
    }
  }

  // Returns { host, ui } where `ui` is the .cfai-block-modal container the
  // markup goes into. The host is always appended to <html> (not <body>) —
  // React can reparent or clear body children, it cannot touch this.
  function createModalHost() {
    const host = document.createElement('div');
    host.className = 'cfai-block-host';
    let ui;
    if (_modalSheet && typeof host.attachShadow === 'function') {
      try {
        const shadow = host.attachShadow({ mode: 'open' });
        shadow.adoptedStyleSheets = [_modalSheet];
        // Neutralize inherited page styles on the host itself; the shadow
        // content positions itself fixed relative to the viewport.
        host.style.cssText = 'all: initial; display: block; position: static;';
        ui = document.createElement('div');
        ui.className = 'cfai-block-modal';
        shadow.appendChild(ui);
      } catch (e) {
        console.warn('[cfai] shadow modal failed, falling back to light DOM:', e?.message || e);
        ui = null;
      }
    }
    if (!ui) {
      // Light-DOM fallback — styled by the manifest-injected content.css.
      host.classList.add('cfai-block-modal');
      host.style.cssText = '';
      ui = host;
    }
    document.documentElement.appendChild(host);
    return { host, ui };
  }

  // Centered modal popup. Stays open until the user acts. Built fully outside
  // the host page's React tree with the highest reasonable z-index so React
  // reconciliation can never tear it down or fight with it.
  //
  // opts:
  //   title (string)            — heading line
  //   body  (string)            — short explanation under the title
  //   matches (array)           — { pattern, severity, count } chips
  //   hint (string, optional)   — small grey help text under the chips
  //   filename (string, opt)    — shown above the chips when blocking a file
  //   promptEl (element, opt)   — the live prompt input (needed to mask + send)
  //   offerRedact (bool, opt)   — offer "Tokenize & Send" when maskable
  //   clientEventId (string,opt)— correlation id from the enforcement_block event
  function showCfaiPopup(opts) {
    removeExistingCfaiModal();

    const { host, ui } = createModalHost();
    ui.setAttribute('role', 'alertdialog');
    ui.setAttribute('aria-modal', 'true');

    const filenameRow = opts.filename
      ? `<div class="cfai-block-filename">${escapeHtml(opts.filename)}</div>`
      : '';
    const tagsRow = (opts.matches && opts.matches.length)
      ? `<div class="cfai-block-tags">${opts.matches.map((m) =>
          `<span class="cfai-tag cfai-${m.severity}">${escapeHtml(m.pattern)}${m.count > 1 ? ' &times;' + m.count : ''}</span>`
        ).join(' ')}</div>`
      : '';
    const hintRow = opts.hint
      ? `<div class="cfai-block-hint">${opts.hint}</div>`
      : '';

    if (opts.hardBlock) {
      // Hard block — stays until the user chooses.
      //   A) Sensitive content + a live prompt element we can mask  → two choices
      //   B) Sensitive content we cannot mask (no element / nothing
      //      replaceable)                                          → edit only
      //   C) Platform block (no matches)                           → "Got it"
      const hasSensitiveMatches = !!(opts.matches && opts.matches.length > 0);
      const clientEventId = opts.clientEventId || newClientEventId();
      const openedAt = Date.now();

      // Compute the actual masked text NOW so the preview shows exactly what
      // would be sent. Empty replacements ⇒ we cannot mask ⇒ no tokenize button
      // (never render a button that silently no-ops).
      let redaction = null;
      if (opts.offerRedact && opts.promptEl) {
        const live = readInputText(opts.promptEl);
        const r = safeRedact(live, scan(live).map((m) => m.pattern));
        if (r && r.replacements.length > 0) redaction = r;
      }

      const previewHtml = redaction
        ? `<div class="cfai-redact-preview">
             <div class="cfai-redact-preview-label">This is what gets sent</div>
             <div class="cfai-redact-preview-text"></div>
           </div>`
        : '';

      let actionsHtml;
      if (hasSensitiveMatches) {
        actionsHtml = `
          <div class="cfai-block-actions">
            ${redaction ? '<button type="button" class="cfai-block-tokenize">Tokenize &amp; Send</button>' : ''}
            <button type="button" class="cfai-block-dismiss cfai-block-edit-btn">Edit manually</button>
          </div>`;
      } else {
        actionsHtml = '<div class="cfai-block-actions"><button type="button" class="cfai-block-dismiss">Got it</button></div>';
      }

      ui.innerHTML = `
        <div class="cfai-block-backdrop"></div>
        <div class="cfai-block-card">
          <div class="cfai-block-icon" aria-hidden="true">&#9888;</div>
          <div class="cfai-block-title">${escapeHtml(opts.title)}</div>
          <div class="cfai-block-body">${escapeHtml(opts.body)}</div>
          ${filenameRow}
          ${tagsRow}
          ${previewHtml}
          ${hintRow}
          ${actionsHtml}
          <div class="cfai-block-footer">This event was reported to the security team.</div>
        </div>
      `;

      if (redaction) {
        const previewText = ui.querySelector('.cfai-redact-preview-text');
        if (previewText) {
          previewText.textContent = redaction.redacted.length > 300
            ? redaction.redacted.slice(0, 300) + '…'
            : redaction.redacted;
        }
      }

      // Keep page handlers from seeing events that are NOT ours. Uses
      // composedPath() — closest() cannot cross the shadow boundary, and
      // without this our own buttons would be swallowed here.
      const trap = (e) => {
        if (isCfaiOwnUiEvent(e)) return;
        e.stopImmediatePropagation();
      };
      for (const evt of ['keydown', 'keyup', 'pointerdown', 'mousedown', 'click']) {
        host.addEventListener(evt, trap, true);
      }

      let pollClose = null;
      let closed = false;
      const onKey = (e) => {
        if (e.key !== 'Escape') return;
        e.stopImmediatePropagation();
        if (hasSensitiveMatches) chooseEdit('dismiss');
        else close();
      };
      const close = () => {
        if (closed) return;
        closed = true;
        if (pollClose) clearInterval(pollClose);
        document.removeEventListener('keydown', onKey, true);
        try { host.remove(); } catch (e) {}
      };
      host.__cfaiClose = close;
      document.addEventListener('keydown', onKey, true);

      // Backdrop / Escape / "Edit manually" all behave identically: the text is
      // never altered and nothing is sent. Only the logged `decision` differs.
      const chooseEdit = (decision) => {
        if (closed) return;
        close();
        emitDecision(decision, opts.promptEl, opts.matches, clientEventId);
        focusPromptForEdit(opts.promptEl, redaction ? redaction.firstOffset : 0);
      };

      const tokenizeBtn = ui.querySelector('.cfai-block-tokenize');
      if (tokenizeBtn) {
        const run = (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (closed) return;
          close();
          tokenizeAndSend(opts.promptEl, opts.matches, clientEventId);
        };
        // Pointer activation is instant.
        tokenizeBtn.addEventListener('click', run);
        // Keyboard activation is armed after TOKENIZE_KEY_ARM_MS so key-repeat
        // from the Enter press that opened the modal can't send for the user.
        tokenizeBtn.addEventListener('keydown', (e) => {
          if (e.key !== 'Enter' && e.key !== ' ') return;   // Tab etc. still work
          e.preventDefault();
          e.stopImmediatePropagation();
          if (Date.now() - openedAt < TOKENIZE_KEY_ARM_MS) {
            console.info('[cfai] ignoring keyboard activation of Tokenize & Send — not armed yet');
            return;
          }
          run(e);
        }, true);
      }

      const dismissBtn = ui.querySelector('.cfai-block-dismiss');
      if (dismissBtn) {
        const act = (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (hasSensitiveMatches) chooseEdit('edit');
          else close();
        };
        dismissBtn.addEventListener('click', act);
        dismissBtn.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.stopImmediatePropagation(); act(e); }
        }, true);
      }

      // "Tokenize & Send" is the default-focused action when it is offered;
      // otherwise focus whichever single button we rendered.
      const focusFirst = tokenizeBtn || dismissBtn;
      if (focusFirst) setTimeout(() => { try { focusFirst.focus(); } catch (e) {} }, 0);

      // Auto-close polling. Deliberately NOT started while the two-choice modal
      // is up — it would race a decision the user is still making.
      if (hasSensitiveMatches && !redaction) {
        pollClose = setInterval(() => {
          const el = (opts.promptEl && opts.promptEl.isConnected)
            ? opts.promptEl
            : (findActivePromptInput() || findPromptInputs()[0]);
          const text = el ? readInputText(el) : '';
          if (!scanForBlockers(text)) close();
        }, 300);
      }

      ui.querySelector('.cfai-block-backdrop')?.addEventListener('click', (e) => {
        e.stopPropagation();
        if (hasSensitiveMatches) chooseEdit('dismiss');
        else close();
      });

    } else {
      // Soft popup (file warnings, etc.) — has dismiss button
      ui.innerHTML = `
        <div class="cfai-block-backdrop"></div>
        <div class="cfai-block-card">
          <div class="cfai-block-icon" aria-hidden="true">&#9888;</div>
          <div class="cfai-block-title">${escapeHtml(opts.title)}</div>
          <div class="cfai-block-body">${escapeHtml(opts.body)}</div>
          ${filenameRow}
          ${tagsRow}
          ${hintRow}
          <div class="cfai-block-actions">
            <button type="button" class="cfai-block-dismiss">Got it</button>
          </div>
          <div class="cfai-block-footer">This event was reported to the security team.</div>
        </div>
      `;

      let closed = false;
      const onKey = (e) => { if (e.key === 'Escape') { e.stopImmediatePropagation(); close(); } };
      const close = () => {
        if (closed) return;
        closed = true;
        document.removeEventListener('keydown', onKey, true);
        try { host.remove(); } catch (e) {}
      };
      host.__cfaiClose = close;
      ui.querySelector('.cfai-block-backdrop').addEventListener('click', (e) => { e.stopPropagation(); close(); });
      const dismissBtn = ui.querySelector('.cfai-block-dismiss');
      dismissBtn.addEventListener('click', (e) => { e.stopPropagation(); close(); });
      dismissBtn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopImmediatePropagation(); close(); } }, true);
      document.addEventListener('keydown', onKey, true);
      setTimeout(() => dismissBtn?.focus(), 0);
    }
  }

  // ── Writing masked text into a live composer ───────────────────────────────
  // Why this exists (bug found on perplexity.ai, 2026-07): Perplexity's composer
  // is a LEXICAL editor, not a textarea — their SPA preloads
  // `_spa/assets/lexical-*.js` and their composer bundles are `ask-input-*.js`;
  // Lexical marks its root with data-lexical-editor="true". Lexical keeps its own
  // EditorState and the app SERIALIZES THAT on send, not the DOM. So a DOM-only
  // write (execCommand that the editor ignores, or worse `el.textContent = …`)
  // can leave the box *showing* masked text while the editor still holds — and
  // sends — the ORIGINAL. That is how unmasked data got out.
  //
  // Verified in Lexical's own bundle, its paste handler is:
  //   $getSelection() !== null && (e.preventDefault(),
  //     editor.update(() => { … e.clipboardData … }, { tag: 'paste' }), true)
  // Three things follow, and this module depends on all three:
  //   1. it must be a real ClipboardEvent (Lexical ignores clipboardData on
  //      InputEvent/KeyboardEvent), so we build one with a DataTransfer;
  //   2. it calls preventDefault(), so dispatchEvent() returning false is a
  //      reliable "the editor took this into its own model" acknowledgment;
  //   3. it needs a non-null editor selection, so we focus + select-all and let
  //      the async selectionchange land before dispatching.
  //
  // Rule for editors with their own model: ONLY an acknowledged paste may write.
  // We never fall back to execCommand/textContent there — a half-landed write is
  // worse than no write, because the DOM would read clean to our own detector
  // while the editor still sends the original.

  const EDITOR_FINGERPRINTS = [
    { name: 'lexical',     sel: '[data-lexical-editor]' },
    { name: 'slate',       sel: '[data-slate-editor]' },
    { name: 'prosemirror', sel: '.ProseMirror' },
    { name: 'quill',       sel: '.ql-editor' },
    { name: 'draftjs',     sel: '[data-contents="true"], .public-DraftEditor-content' },
    { name: 'tiptap',      sel: '.tiptap' },
  ];

  // Name of the rich-text framework managing this element, or null for a plain
  // field / plain contenteditable.
  function detectEditorFramework(el) {
    if (!el || el.nodeType !== 1) return null;
    for (const f of EDITOR_FINGERPRINTS) {
      try {
        if (el.matches?.(f.sel) || el.closest?.(f.sel) || el.querySelector?.(f.sel)) return f.name;
      } catch (e) { /* bad selector support — skip */ }
    }
    try {
      // Lexical also stamps its text nodes; catches a root we matched loosely.
      if (el.querySelector?.('[data-lexical-text]')) return 'lexical';
    } catch (e) {}
    return null;
  }

  // Identity only — never any prompt content. Safe to paste into a bug report.
  function describeElement(el) {
    if (!el || el.nodeType !== 1) return '(none)';
    const attr = (n) => { try { return el.getAttribute(n) || ''; } catch (e) { return ''; } };
    const cls = String(el.className || '').slice(0, 80);
    return [
      '<' + String(el.tagName || '?').toLowerCase() + '>',
      attr('id') ? '#' + attr('id') : '',
      'role=' + (attr('role') || '-'),
      'contenteditable=' + (attr('contenteditable') || '-'),
      'testid=' + (attr('data-testid') || '-'),
      'placeholder=' + (attr('placeholder') || attr('data-placeholder') || '-'),
      cls ? 'class="' + cls + '"' : '',
      'chars=' + (readInputText(el) || '').length,
    ].filter(Boolean).join(' ');
  }

  function nextTick(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms || 0));
  }
  function afterFrame() {
    return new Promise((resolve) => {
      try {
        if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => setTimeout(resolve, 0));
        else setTimeout(resolve, 16);
      } catch (e) { setTimeout(resolve, 16); }
    });
  }

  function selectAllIn(el) {
    try {
      el.focus();
      if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') { el.select(); return true; }
      const sel = window.getSelection();
      if (!sel) return false;
      const range = document.createRange();
      range.selectNodeContents(el);
      sel.removeAllRanges();
      sel.addRange(range);
      return true;
    } catch (e) {
      console.warn('[cfai] write: select-all failed —', e?.message || e);
      return false;
    }
  }

  // The only question that matters before sending: does the composer now hold
  // our masked text, and is there definitely no sensitive data left in it?
  // The decision itself lives in patterns.js (pure, unit-tested) \u2014 see
  // verifyRedaction() and tests/redaction.test.mjs.
  function verifyMaskedWrite(el, maskedText, labels) {
    let read = '';
    try { read = el ? readInputText(el) : ''; } catch (e) {}
    const fn = window.__cfaiPatterns?.verifyRedaction;
    if (typeof fn !== 'function') {
      // Fail closed \u2014 without the gate we do not send.
      console.warn('[cfai] write: verifyRedaction() unavailable \u2014 refusing to send');
      return { ok: false, exact: false, labelsPresent: false, leftovers: ['gate_unavailable'], readLength: read.length };
    }
    try {
      return fn(read, maskedText, labels || []);
    } catch (e) {
      console.warn('[cfai] write: verifyRedaction() threw \u2014 refusing to send:', e?.message || e);
      return { ok: false, exact: false, labelsPresent: false, leftovers: ['gate_threw'], readLength: read.length };
    }
  }

  // execCommand('insertText'), instrumented. A framework editor that manages its
  // own model cancels the beforeinput it triggers and applies the change itself —
  // that cancellation is our acknowledgment signal.
  function execInsertText(text) {
    let seen = false;
    let prevented = false;
    // Bubble phase on document runs AFTER the editor's own listeners, so
    // defaultPrevented reflects whether the editor claimed the change.
    const onBeforeInput = (ev) => { seen = true; if (ev.defaultPrevented) prevented = true; };
    document.addEventListener('beforeinput', onBeforeInput, false);
    let returned = false;
    try { returned = document.execCommand('insertText', false, text); }
    catch (e) { console.warn('[cfai] write: execCommand threw —', e?.message || e); }
    document.removeEventListener('beforeinput', onBeforeInput, false);
    console.info('[cfai] write: execCommand returned=' + returned +
                 ' | beforeinput seen=' + seen + ' cancelled-by-editor=' + prevented);
    return { returned, beforeInputSeen: seen, beforeInputPrevented: prevented };
  }

  // Dispatch a synthetic paste carrying `text`. Returns handled=true when a
  // listener called preventDefault() — i.e. the editor ingested it.
  function dispatchPaste(el, text) {
    if (typeof DataTransfer === 'undefined' || typeof ClipboardEvent === 'undefined') {
      return { available: false, handled: false, reason: 'ClipboardEvent/DataTransfer unavailable' };
    }
    try {
      const dt = new DataTransfer();
      dt.setData('text/plain', text);
      const evt = new ClipboardEvent('paste', {
        clipboardData: dt, bubbles: true, cancelable: true, composed: true,
      });
      const notCancelled = el.dispatchEvent(evt);
      return { available: true, handled: !notCancelled };
    } catch (e) {
      return { available: false, handled: false, reason: e?.message || String(e) };
    }
  }

  /**
   * Write masked text into a live composer and REPORT HONESTLY whether it landed.
   * Resolves { ok, strategy, framework, checks } — callers must not send unless
   * `ok` is true. Every step logs to the console with a [cfai] write: prefix so a
   * non-technical user can copy the output into a bug report.
   */
  async function writeMaskedText(el, text, labels) {
    const framework = detectEditorFramework(el);
    const isField = el.tagName === 'TEXTAREA' || el.tagName === 'INPUT';
    const out = { ok: false, strategy: 'none', framework, checks: [] };

    console.info('[cfai] write: BEGIN on', location.hostname, '| target =', describeElement(el));
    console.info('[cfai] write: editor model =', framework || 'none (plain field/contenteditable)',
                 '| plain field =', isField,
                 '| masked chars =', text.length,
                 '| labels =', labels.join(' ') || '(none)');

    const check = (strategy, acknowledged) => {
      const v = verifyMaskedWrite(el, text, labels);
      out.checks.push({ strategy, acknowledged, ...v });
      console.info('[cfai] write: strategy=' + strategy +
        ' | editor-acknowledged=' + acknowledged +
        ' | readback=' + (v.ok ? 'MATCHES masked text' : 'DOES NOT MATCH') +
        ' (exact=' + v.exact + ', labels-present=' + v.labelsPresent +
        ', read ' + v.readLength + ' chars vs ' + text.length + ' expected)' +
        (v.leftovers.length ? ' | STILL SENSITIVE IN BOX: ' + v.leftovers.join(',') : ''));
      return v;
    };
    const succeed = (strategy) => {
      out.ok = true;
      out.strategy = strategy;
      console.info('[cfai] write: SUCCESS via "' + strategy + '" — safe to send');
      return out;
    };
    const fail = (why) => {
      console.warn('[cfai] write: FAILED — ' + why + '. Nothing will be sent.');
      return out;
    };

    if (isField) {
      // Plain <textarea>/<input>: the DOM value IS the source of truth, and the
      // native-setter + input/change dance is the canonical React bypass.
      try {
        const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
        el.focus();
        if (setter) setter.call(el, text); else el.value = text;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      } catch (e) {
        console.warn('[cfai] write: native value setter threw —', e?.message || e);
      }
      await afterFrame();
      if (check('native-setter', true).ok) return succeed('native-setter');

      selectAllIn(el);
      await nextTick(0);
      execInsertText(text);
      await afterFrame();
      if (check('execCommand', true).ok) return succeed('execCommand');
      return fail('could not rewrite this ' + el.tagName.toLowerCase());
    }

    // contenteditable / role=textbox.
    // Select everything first so the paste REPLACES the prompt, and give the
    // editor a task to sync its own selection from the DOM selection
    // (selectionchange is dispatched asynchronously).
    for (let attempt = 1; attempt <= 2; attempt++) {
      selectAllIn(el);
      await nextTick(0);
      const paste = dispatchPaste(el, text);
      if (!paste.available) {
        console.warn('[cfai] write: paste simulation unavailable —', paste.reason);
        break;
      }
      console.info('[cfai] write: paste attempt ' + attempt + ' | editor called preventDefault =', paste.handled);
      if (!paste.handled) {
        // A synthetic paste has no default action, so nothing was written and a
        // retry is harmless. The editor's selection may just not be synced yet.
        if (attempt === 1) { await nextTick(20); continue; }
        break;
      }
      await afterFrame();
      let v = check('paste', true);
      if (!v.ok) {
        // Accepted but not rendered yet (React-driven editors re-render async).
        await afterFrame();
        v = check('paste (second readback)', true);
      }
      if (v.ok) return succeed('paste');
      // Do NOT escalate after an accepted paste — another write would risk
      // duplicating the text inside the editor's model.
      return fail((framework || 'the editor') + ' accepted the paste but the box does not read back as the masked text');
    }

    if (framework) {
      // Deliberate: no execCommand/textContent fallback here. Those can mutate
      // the DOM without updating the editor's model, which would make the box
      // look clean to our own detector while the app still sends the original.
      return fail('this composer is a ' + framework + ' editor and it did not accept the paste; ' +
                  'refusing DOM-only fallbacks that could desync its content model');
    }

    // Plain contenteditable — the DOM really is the content, so the older
    // strategies are safe here.
    selectAllIn(el);
    await nextTick(0);
    execInsertText(text);
    await afterFrame();
    if (check('execCommand', true).ok) return succeed('execCommand');

    try {
      el.textContent = text;
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
    } catch (e) {
      console.warn('[cfai] write: textContent fallback threw —', e?.message || e);
    }
    await afterFrame();
    if (check('textContent', true).ok) return succeed('textContent');
    return fail('every write strategy was rejected by this page');
  }

  // ── Modal choice: Tokenize & Send ──────────────────────────────────────────
  // FIXED-LABEL, ONE-WAY, STATELESS masking: every detected span becomes a
  // fixed label ([SSN], [API-KEY], …). No mapping is stored
  // anywhere, nothing is reversible, there is no TTL. This is intentionally NOT
  // the reversible token vault used by the desktop agent's proxy — which is
  // exactly why this emits its own `enforcement_redact` kind instead of
  // reusing `enforcement_tokenize`.
  async function tokenizeAndSend(promptEl, matches, clientEventId) {
    const el = (promptEl && promptEl.isConnected)
      ? promptEl
      : (findActivePromptInput() || findPromptInputs()[0] || null);
    if (!el) {
      showWarning([], 'Could not find the prompt box — please edit the prompt manually.');
      return;
    }

    const original = readInputText(el);
    if (!original) return;

    // Mask EVERYTHING detected in this prompt, not only the patterns that
    // tripped the severity gate that opened the modal.
    const result = safeRedact(original, scan(original).map((m) => m.pattern));
    if (!result || result.replacements.length === 0) {
      showWarning([], 'Nothing could be masked — please edit the prompt manually.');
      return;
    }

    const replacements = result.replacements.map((r) => ({
      pattern: r.pattern, class: r.class, severity: r.severity, label: r.label, count: r.count,
    }));
    const labels = Array.from(new Set(replacements.map((r) => r.label)));
    console.info('[cfai] tokenize & send —', replacements.map((r) => r.pattern + '×' + r.count).join(', '));

    // Mark before we write: the write itself dispatches input/paste events that
    // other intercept layers observe.
    markProgrammaticSend();

    let write;
    try {
      write = await writeMaskedText(el, result.redacted, labels);
    } catch (e) {
      console.error('[cfai] write: threw —', e?.message || e);
      write = { ok: false, strategy: 'threw', framework: null, checks: [] };
    }

    // Final gate immediately before sending. Sending on an unverified write is
    // exactly the bug that let unmasked text out of Perplexity, so this is the
    // one condition that must hold.
    const verify = verifyMaskedWrite(el, result.redacted, labels);
    const safeToSend = !!write.ok && verify.ok;
    console.info('[cfai] tokenize: pre-send gate | write.ok=' + write.ok +
                 ' strategy=' + write.strategy +
                 ' | final readback ok=' + verify.ok +
                 (verify.leftovers.length ? ' | STILL SENSITIVE: ' + verify.leftovers.join(',') : '') +
                 ' => ' + (safeToSend ? 'SENDING' : 'NOT SENDING'));

    emit({
      kind: 'enforcement_redact',
      mechanism: 'extension_dom',
      decision_for: clientEventId,
      replacements,
      replacement_count: replacements.reduce((a, r) => a + (r.count || 0), 0),
      // Same shape existing events use — pattern/class/severity/count only,
      // never a matched value.
      matches: replacements.map(({ pattern, class: cls, severity, count }) => ({ pattern, class: cls, severity, count })),
      highest_severity: highestSeverity(replacements),
      content_length: original.length,
      length_bucket: lengthBucket(original.length),
      // The MASKED text only, and only when it actually landed in the composer.
      content_text: safeToSend ? result.redacted : undefined,
      content_redacted: true,
      write_strategy: write.strategy,
      write_editor: write.framework || 'none',
      write_verified: safeToSend,
      sent: safeToSend,
    });

    if (!safeToSend) {
      // Re-arm every block layer straight away: the composer still holds the
      // ORIGINAL text, and the programmatic-send window must not let it out.
      clearProgrammaticSend();
      console.warn('[cfai] tokenize: prompt was NOT rewritten and NOTHING was sent — the original text is still in the box');
      showWarning([], 'Could not mask this prompt automatically — nothing was sent. Please edit the prompt manually.');
      return;
    }

    markProgrammaticSend();
    triggerSendFor(el, result.redacted, labels);
  }

  // Strategy chain: (a) click the site's real send button, (b) synthetic Enter,
  // (c) leave the masked text in place and tell the user to press Enter. We
  // never clear or lose the masked prompt.
  function triggerSendFor(el, maskedText, labels) {
    const btn = findSendButtonForInput(el);
    if (btn) {
      console.info('[cfai] tokenize: clicking the site send button —', describeElement(btn));
      try { btn.click(); } catch (e) { simulateSend(el); }
    } else {
      console.info('[cfai] tokenize: no send button found — dispatching Enter');
      simulateSend(el);
    }

    setTimeout(() => {
      // Still holding the masked text ⇒ the site never consumed the send. The
      // masked prompt stays exactly where it is; the user only has to hit Enter.
      const still = verifyMaskedWrite(el, maskedText, labels || []);
      if (still.ok) {
        console.info('[cfai] tokenize: send did not go through — masked text left in place for the user');
        showWarning([], 'Tokenized — press Enter to send.');
      } else {
        console.info('[cfai] tokenize: composer no longer holds the masked text — send went through');
      }
    }, 1200);
  }

  // Forward counterpart to findPromptInputFor(): given a prompt input, find the
  // composer's real send button. Explicit send affordances win; the loose
  // looksLikeSendButton() heuristic is only a fallback, and obvious decoys
  // (attach, mic, stop, …) are never clicked.
  function findSendButtonForInput(el) {
    if (!el || typeof el.closest !== 'function') return null;
    const DECOY = /attach|upload|file|image|photo|camera|mic|voice|dictate|speech|audio|stop|cancel|close|menu|model|setting|emoji|search|new chat|history|sidebar/;
    // "Send feedback" / "Share" style buttons say "send" but are not the composer.
    const NOT_SEND = /feedback|report|invite|share|email|newsletter|subscribe|survey/;

    const roots = [];
    const scoped = el.closest('form, [class*="composer" i], [class*="input" i], [data-testid*="composer" i]');
    if (scoped) roots.push(scoped);
    let up = (scoped || el).parentElement;
    for (let i = 0; i < 3 && up; i++) { roots.push(up); up = up.parentElement; }

    const weak = [];
    for (const r of roots) {
      let btns;
      try { btns = r.querySelectorAll('button, [role="button"]'); } catch (e) { continue; }
      for (const b of btns) {
        if (!b || b.disabled || b.getAttribute('aria-disabled') === 'true') continue;
        if (isCfaiOwnNode(b)) continue;
        const label = ((b.getAttribute('aria-label') || '') + ' ' +
                       (b.getAttribute('data-testid') || '') + ' ' +
                       (b.getAttribute('title') || '')).toLowerCase();
        const text = (b.innerText || '').trim().toLowerCase();
        if (NOT_SEND.test(label + ' ' + text)) continue;
        if (/send|submit/.test(label) || text === 'send' || text === 'submit' || b.type === 'submit') {
          return b;
        }
        if (!DECOY.test(label + ' ' + text) && looksLikeSendButton(b)) weak.push(b);
      }
    }
    return weak[0] || null;
  }

  function isCfaiOwnNode(node) {
    try {
      return !!node?.closest?.('.cfai-block-host, .cfai-block-modal, .cfai-toast');
    } catch (e) {
      return false;
    }
  }

  // ── Modal choice: Edit manually / dismiss ──────────────────────────────────
  // Never alters the text. Just focuses the prompt and drops the caret on the
  // first thing we would have masked. The detection loop stays armed, so a
  // resubmit with the sensitive text still present reopens the modal via the
  // existing logic.
  function focusPromptForEdit(promptEl, offset) {
    const el = (promptEl && promptEl.isConnected)
      ? promptEl
      : (findActivePromptInput() || findPromptInputs()[0] || null);
    if (!el) return;
    try {
      el.focus();
      const want = Math.max(0, Number.isFinite(offset) && offset > 0 ? offset : 0);
      if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
        const pos = Math.min(want, (el.value || '').length);
        el.setSelectionRange(pos, pos);
        return;
      }
      // contenteditable — walk text nodes to convert a flat offset into a
      // (node, offset) pair. Best-effort: innerText and textContent can differ
      // around block boundaries.
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
      let remaining = want;
      let node = null;
      let nodeOffset = 0;
      let last = null;
      while ((node = walker.nextNode())) {
        last = node;
        const len = (node.nodeValue || '').length;
        if (remaining <= len) { nodeOffset = remaining; break; }
        remaining -= len;
      }
      const target = node || last;
      const sel = window.getSelection();
      const range = document.createRange();
      if (target) range.setStart(target, Math.min(nodeOffset, (target.nodeValue || '').length));
      else range.selectNodeContents(el);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
    } catch (e) {
      // Caret placement is a nicety; focus already happened.
    }
  }

  // Decision telemetry. No content_text — nothing about the prompt changed, so
  // no text is logged for this event.
  function emitDecision(decision, promptEl, matches, clientEventId) {
    let len = 0;
    try { len = promptEl ? readInputText(promptEl).length : 0; } catch (e) {}
    emit({
      kind: 'enforcement_decision',
      decision,
      decision_for: clientEventId,
      matches: (matches || []).map((m) => ({ pattern: m.pattern, class: m.class, severity: m.severity, count: m.count })),
      highest_severity: highestSeverity(matches || []),
      length_bucket: lengthBucket(len),
    });
  }

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );
  }

  // Full-platform block popup — shown when the org has disallowed this platform.
  function showPlatformBlockPopup() {
    if (existingCfaiModal()) return;
    const name = (BLOCKED_PLATFORM && (BLOCKED_PLATFORM.product || BLOCKED_PLATFORM.vendor || BLOCKED_PLATFORM.host)) || 'This AI platform';
    showCfaiPopup({
      title: `${name} is blocked`,
      body:  'CloudFuze AI Governance has disallowed this AI platform for your organization. Prompts cannot be sent here.',
      matches: [],
      hint:  'Contact your administrator if you need access to this tool.',
      hardBlock: true,
    });
  }

  // Persistent banner pinned to the top of a blocked platform.
  function showPlatformBanner() {
    if (document.getElementById('cfai-platform-banner')) return;
    const name = (BLOCKED_PLATFORM && (BLOCKED_PLATFORM.product || BLOCKED_PLATFORM.vendor || BLOCKED_PLATFORM.host)) || 'This AI platform';
    const bar = document.createElement('div');
    bar.id = 'cfai-platform-banner';
    bar.setAttribute('style', 'position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#b91c1c;color:#fff;font:600 13px/1.4 system-ui,-apple-system,sans-serif;padding:10px 16px;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,.25);');
    bar.textContent = `\u{1F512} ${name} is blocked by CloudFuze AI Governance — prompts cannot be sent here.`;
    (document.documentElement || document.body).appendChild(bar);
  }
  function removePlatformBanner() {
    const b = document.getElementById('cfai-platform-banner');
    if (b) b.remove();
  }

  // The prompt-block modal. Offers two ways forward:
  //   • Tokenize & Send — masks every detected value with a fixed label and
  //     resends (one-way, nothing stored, nothing recoverable).
  //   • Edit manually   — closes and puts the caret on the first offending span.
  // No "send anyway, unmodified" path exists.
  function showBlockPopup(matches, promptEl, clientEventId) {
    if (existingCfaiModal()) return;
    const el = promptEl || findActivePromptInput() || findPromptInputs()[0];
    showCfaiPopup({
      title: 'Sensitive data detected — how do you want to send this?',
      body:  'CloudFuze AI Governance found sensitive data in this prompt:',
      matches,
      hint:  'Tokenize &amp; Send replaces each detected value with a fixed label such as [SSN] before sending. The original values are never sent, and cannot be recovered from the label.',
      hardBlock: true,
      offerRedact: true,
      promptEl: el,
      clientEventId,
    });
  }

  // (We don't auto-remove the file from the composer — the user removes it
  // themselves. We just stop the send and explain why.)

  // Helper used by every intercept path. Returns true if the event was blocked.
  // Two reasons we'd block a send:
  //   1) Prompt text contains high/critical patterns → block + prompt popup
  //   2) Composer still has a previously-flagged attachment → block + attachment popup
  //
  // `el` may be null on bare attachment sends (user clicks Send with no prompt
  // text and no focus on the textarea). In that case the prompt scan is skipped
  // and only the attachment check decides whether to block.
  function tryBlock(el, e, label) {
    // Always reset dedup so repeated sends of the same sensitive text get blocked every time.
    _lastLogKey = null;

    // If el is null or detached, try harder to find the prompt input.
    // After popup dismissal, focus moves away and findActivePromptInput()
    // returns null. Fall back to the first prompt input on the page.
    if (!el || !el.isConnected) {
      el = findActivePromptInput() || findPromptInputs()[0] || null;
    }

    // (0) Full-platform block — the org has disallowed this AI platform, so we
    //     refuse EVERY send regardless of content.
    if (PLATFORM_BLOCKED) {
      if (e) {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (typeof e.stopPropagation === 'function') e.stopPropagation();
      }
      console.info('[cfai] BLOCKED (platform disallowed) via', label);
      emit({ kind: 'enforcement_block', blocked_for: 'platform', reason: 'platform_blocked', highest_severity: 'critical', matches: [] });
      showPlatformBlockPopup();
      return true;
    }

    // (0b) Our own "Tokenize & Send" resend. The masked text matches no
    //      pattern, but the _recentSensitivePaste guard below is time-based, so
    //      it would otherwise re-block a send the user already authorized.
    if (isProgrammaticSend()) {
      logPromptEvent(el ? readInputText(el) : '');
      return false;
    }

    // (1) Sensitive prompt text.
    const text = el ? readInputText(el) : '';
    const promptMatches = scanForBlockers(text);

    // (2) Sensitive attachments still on the composer.
    const flaggedAttachments = collectActiveFlaggedAttachments(el);

    if (!promptMatches && flaggedAttachments.length === 0) {
      // Check if sensitive data was JUST pasted (within 2s). The input text
      // might not reflect the paste yet (React batching / rapid paste+send).
      // Don't consume the flag — let it persist for the full 2s timeout so
      // multiple rapid send attempts are all caught.
      if (_recentSensitivePaste && (Date.now() - _recentSensitivePaste.at) < 2000) {
        if (e) { e.preventDefault(); e.stopImmediatePropagation(); if (typeof e.stopPropagation === 'function') e.stopPropagation(); }
        console.info('[cfai] BLOCKED via', label, '(recent paste, input not yet updated)');
        // Emit the block so the modal's follow-up decision event has something
        // to reference via decision_for (this path previously logged nothing).
        const cid = emitEnforcement('block', el, _recentSensitivePaste.matches, 'prompt_submit');
        showBlockPopup(_recentSensitivePaste.matches, el, cid);
        return true;
      }
      // Not blocking — still log the send for governance.
      logPromptEvent(text);
      return false;
    }

    // Block path — sensitive data must be removed before sending.

    if (e) {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (typeof e.stopPropagation === 'function') e.stopPropagation();
    }

    if (flaggedAttachments.length > 0) {
      const filenames = flaggedAttachments.map((a) => a.filename).join(', ');
      const allMatches = mergeMatches(flaggedAttachments.flatMap((a) => a.matches));
      console.info('[cfai] BLOCKED via', label, '(attachment)', filenames);
      emit({
        kind: 'enforcement_block',
        blocked_for: 'file_upload',
        filename: filenames,
        highest_severity: highestSeverity(allMatches),
        matches: allMatches,
      });
      showAttachmentBlockPopup(flaggedAttachments);
      return true;
    }

    console.info('[cfai] BLOCKED via', label, promptMatches.map((m) => m.pattern).join(', '));
    const cid = emitEnforcement('block', el, promptMatches, 'prompt_submit');
    showBlockPopup(promptMatches, el, cid);
    return true;
  }

  function collectActiveFlaggedAttachments(/* promptEl */) {
    if (flaggedFiles.size === 0) return [];

    // We compute these lazily — only do the (cheap) innerHTML/textContent
    // capture once even if we have multiple flagged files in the map.
    let docHtml = null;
    let docText = null;
    const out = [];

    for (const [filename, info] of Array.from(flaggedFiles.entries())) {
      let stillAttached = false;

      // Primary signal: the chip element reference we captured at upload
      // time. If it's still connected to the live DOM, the user hasn't
      // removed it. This survives chip-text truncation entirely.
      if (info.chipEl) {
        stillAttached = info.chipEl.isConnected === true;
      } else {
        // Fallback: text search. innerHTML covers title=/aria-label=/alt=
        // attribute values (full filename often hides there even when the
        // visible chip text is truncated like "Long_Name...").
        if (docHtml === null) docHtml = document.body?.innerHTML || '';
        if (docText === null) docText = document.body?.textContent || '';
        stillAttached = filenameAppearsAttached(filename, docHtml, docText);
      }

      if (stillAttached) {
        out.push({ filename, matches: info.matches, severity: info.severity });
      } else {
        // Attachment was removed from the chat — forget it so a future clean
        // send isn't blocked by a stale entry.
        flaggedFiles.delete(filename);
      }
    }
    return out;
  }

  // True if `filename` looks like it's still attached on the page.
  // Tries (in order):
  //   1. Exact full-name match in HTML (catches title="..", aria-label="..", alt="..")
  //   2. Exact full-name match in visible text
  //   3. Distinctive-prefix match in visible text — handles "Long_File_Name…"
  //      style chip truncation. Prefix length is the longer of 16 chars or
  //      the chunk before the last extension dot.
  function filenameAppearsAttached(filename, docHtml, docText) {
    if (!filename) return false;
    if (docHtml.includes(filename)) return true;
    if (docText.includes(filename)) return true;
    const prefix = distinctivePrefix(filename);
    if (prefix && prefix.length >= 8 && docText.includes(prefix)) return true;
    return false;
  }

  function distinctivePrefix(filename) {
    // Strip the extension so "...Reference (1).docx" doesn't compete with the
    // chip's truncated visible label that ends in "...Referenc…".
    const stem = filename.replace(/\.[^.]+$/, '');
    // Use first 16 chars (or whole stem if shorter). Short enough that ChatGPT's
    // chip truncation will still preserve it, distinctive enough that random
    // page text won't false-positive.
    return stem.slice(0, 16);
  }

  function mergeMatches(list) {
    const byKey = new Map();
    for (const m of list) {
      const k = m.pattern + '|' + (m.severity || '');
      if (byKey.has(k)) byKey.get(k).count += (m.count || 1);
      else byKey.set(k, { pattern: m.pattern, severity: m.severity, count: m.count || 1 });
    }
    return Array.from(byKey.values());
  }

  function showAttachmentBlockPopup(attachments) {
    const single = attachments.length === 1;
    const filenameLine = single
      ? attachments[0].filename
      : `${attachments.length} attached files`;
    const allMatches = mergeMatches(attachments.flatMap((a) => a.matches));
    showCfaiPopup({
      title: single ? "This file can't be sent" : "These files can't be sent",
      body:  'CloudFuze AI Governance blocked the send because the attached file contains sensitive data:',
      filename: filenameLine,
      matches: allMatches,
      hint:  single
        ? 'Remove the attachment from the chat before sending.'
        : 'Remove the flagged attachments from the chat before sending.',
    });
  }

  function findActivePromptInput() {
    // Walk through shadow roots — inside a shadow tree, document.activeElement
    // returns the shadow host, not the actually-focused element inside.
    let ae = document.activeElement;
    while (ae && ae.shadowRoot && ae.shadowRoot.activeElement) {
      ae = ae.shadowRoot.activeElement;
    }
    if (isPromptInput(ae)) return ae;
    // Fallback: only one prompt input on the page → use that.
    const all = findPromptInputs();
    return all.length === 1 ? all[0] : null;
  }

  function installEnforcementHooks() {
    if (window.__cfaiEnforceInstalled) return;
    window.__cfaiEnforceInstalled = true;
    console.info('[cfai] enforcement v2 installed (intercept-on-send, no DOM mutation)');

    // 0) Document-level paste fallback. Per-element paste listeners cover the
    //    happy path, but shadow-rooted inputs (Salesforce Lightning chat etc.)
    //    are easy to miss when attach() can't see them. This catches the paste
    //    via event-bubbling out of the shadow tree, uses composedPath() to
    //    find the real target element, and reroutes to handlePaste.
    document.addEventListener('paste', (e) => {
      const path = (typeof e.composedPath === 'function') ? e.composedPath() : [];
      const realTarget = path.find((n) => n && n.nodeType === 1 && isPromptInput(n));
      if (!realTarget) return;
      if (realTarget.__cfaiAttached) return;  // already handled per-element
      handlePaste(realTarget, e);
    }, true);

    // 1) Enter without Shift = send.
    document.addEventListener('keydown', (e) => {
      if (!ENFORCE) return;
      if (e.key !== 'Enter' || e.shiftKey) return;
      const el = isPromptInput(e.target) ? e.target : findActivePromptInput();
      if (!el) return;
      tryBlock(el, e, 'keydown:Enter');
    }, true);

    // 2) Click / mousedown / pointerdown on a send-like button. We hook all
    //    three because different sites trigger the actual send on different
    //    events — ChatGPT in particular wires pointerdown on the up-arrow.
    //    `el` may be null on bare-attachment sends; tryBlock handles that.
    const buttonHandler = (label) => (e) => {
      if (!ENFORCE) return;
      const btn = e.target?.closest?.('button, [role="button"]');
      if (!btn || !looksLikeSendButton(btn)) return;
      const el = findPromptInputFor(btn) || findActivePromptInput();
      tryBlock(el, e, label);
    };
    document.addEventListener('click',        buttonHandler('click'),        true);
    document.addEventListener('mousedown',    buttonHandler('mousedown'),    true);
    document.addEventListener('pointerdown',  buttonHandler('pointerdown'),  true);

    // 3) Form submit (the composer is usually inside a <form>; some sites
    //    dispatch a submit event regardless of how it was triggered). `el`
    //    may again be null — bare-attachment sends are still blocked via
    //    the attachment check in tryBlock.
    document.addEventListener('submit', (e) => {
      if (!ENFORCE) return;
      const form = e.target;
      const el = form?.querySelector?.('textarea, [contenteditable="true"], [role="textbox"]') || findActivePromptInput();
      tryBlock(el, e, 'submit');
    }, true);

    // 4) PERSISTENT BLOCKER — continuously monitors prompt inputs. While
    //    sensitive text is present, ALL events on the page are intercepted
    //    at the window level so React cannot fire the send. This defeats
    //    ChatGPT's synthetic event system which bypasses DOM capture handlers.
    let _blockActive = false;
    let _lastBlockText = '';

    function globalBlocker(e) {
      // Allow our own UI (composedPath — the modal lives in a shadow root, so
      // e.target is retargeted to the host and closest() can't see inside).
      if (isCfaiOwnUiEvent(e)) return;
      // Our own masked resend — already authorized by the user.
      if (isProgrammaticSend()) return;
      // Only intercept actual send gestures — not random clicks
      if (e.type === 'keydown') {
        if (e.key !== 'Enter' || e.shiftKey) return;
      } else {
        // For pointer/mouse/click: only intercept send-like buttons
        const btn = e.target?.closest?.('button, [role="button"]');
        if (!btn || !looksLikeSendButton(btn)) return;
      }

      const el = findActivePromptInput() || findPromptInputs()[0];
      if (!el) return;
      const text = readInputText(el);
      const matches = scanForBlockers(text);
      if (!matches) {
        if (_blockActive) deactivateBlocker();
        return;
      }

      e.preventDefault();
      e.stopImmediatePropagation();
      e.stopPropagation();
      console.info('[cfai] GLOBAL BLOCKER stopped', e.type);
      _lastLogKey = null;
      const cid = emitEnforcement('block', el, matches, 'prompt_submit');
      showBlockPopup(matches, el, cid);
    }

    function activateBlocker() {
      if (_blockActive) return;
      _blockActive = true;
      // Intercept at window level, capture phase, for every send-like event
      for (const evt of ['keydown', 'pointerdown', 'mousedown', 'click', 'submit']) {
        window.addEventListener(evt, globalBlocker, true);
      }
      console.info('[cfai] global blocker ACTIVATED');
    }

    function deactivateBlocker() {
      if (!_blockActive) return;
      _blockActive = false;
      for (const evt of ['keydown', 'pointerdown', 'mousedown', 'click', 'submit']) {
        window.removeEventListener(evt, globalBlocker, true);
      }
      console.info('[cfai] global blocker deactivated');
    }

    // Poll the prompt input every 500ms. If sensitive content is detected,
    // activate the global blocker. This is lightweight and React-proof.
    // Only activate the global blocker for genuine block-patterns.
    // Tokenize-only patterns are handled by the popup at send time —
    // the global blocker must NOT intercept sidebar clicks, navigation, etc.
    setInterval(() => {
      if (!ENFORCE) return;
      const el = findActivePromptInput() || findPromptInputs()[0];
      if (!el) { if (_blockActive) deactivateBlocker(); return; }
      const text = readInputText(el);
      const matches = scanForBlockers(text);
      if (matches) {
        if (!_blockActive) activateBlocker();
        _lastBlockText = text;
      } else {
        if (_blockActive) deactivateBlocker();
        _lastBlockText = '';
      }
    }, 500);
  }
  // END ENFORCEMENT ============================================

  // ---- UI: subtle in-page toast ----
  function showWarning(matches, title = 'Sensitive data detected') {
    const existing = document.querySelector('.cfai-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'cfai-toast';
    toast.innerHTML = `
      <button class="cfai-toast-close" aria-label="Close">&times;</button>
      <div class="cfai-toast-title">${title}</div>
      <div class="cfai-toast-body">${matches.map((m) => `<span class="cfai-tag cfai-${m.severity}">${m.pattern}</span>`).join(' ')}</div>
      <div class="cfai-toast-footer">CloudFuze AI Governance · This event was reported to the security team.</div>
    `;
    document.body.appendChild(toast);
    // Dismiss when user clicks anywhere outside the toast
    const dismissOnClick = (e) => {
      if (!toast.contains(e.target)) {
        toast.remove();
        document.removeEventListener('click', dismissOnClick, true);
      }
    };
    toast.querySelector('.cfai-toast-close').addEventListener('click', () => {
      toast.remove();
      document.removeEventListener('click', dismissOnClick, true);
    });
    // Delay listener so the current click event doesn't immediately dismiss
    setTimeout(() => document.addEventListener('click', dismissOnClick, true), 100);
  }

  // ---- Event wiring ----
  //
  // TWO MARKS, TWO DIFFERENT QUESTIONS. content/replay.js reads only the second.
  //
  //   el.__cfaiAttached — "the DLP layer is watching this element". Set on every hit
  //     of findPromptInputs()'s deliberately BROAD selector, which includes
  //     [role="combobox"] and [role="searchbox"] and bare [contenteditable]. That
  //     breadth is correct for DLP: better to scan a Salesforce lookup field we did
  //     not need to than to miss a composer styled as a search box. It is NOT
  //     evidence that the element is a prompt box, and nothing here changes it.
  //
  //   el.__cfaiComposer — "this element is prompt-SHAPED". Set only when the element
  //     passes isPromptInput(), the same stricter test the enforcement path already
  //     uses to decide what the user is about to send (TEXTAREA, or
  //     contenteditable="true", or role="textbox" — combobox and searchbox do not
  //     qualify). This is the ONLY mark replay.js's maskInputFn treats as permission
  //     to record an input's text in cleartext.
  //
  // WHY THE SPLIT. replay.js originally unmasked on __cfaiAttached, so on an in-scope
  // host (Salesforce is in the host list) every ordinary role="combobox" Lightning
  // lookup and every notes/description field the broad selector found was recorded in
  // cleartext, and a hostile in-scope page could get an arbitrary text input unmasked
  // with one setAttribute('role','combobox'). The narrow mark keeps the property
  // unforgeable — both files are classic content scripts in the same manifest entry,
  // so this is isolated-world state the page cannot see or set — and now also
  // requires the element to be composer-shaped. type=password stays masked
  // unconditionally in replay.js, ahead of either mark.
  function attach(el) {
    // Evaluated on EVERY pass, ahead of the early-return below, so an element that
    // only becomes composer-shaped later (a div that gains contenteditable="true"
    // after mount) is still marked by a later scanAndAttach().
    if (isPromptInput(el)) el.__cfaiComposer = true;
    if (el.__cfaiAttached) return;
    el.__cfaiAttached = true;
    // Attaching used to MINT the session ("detection engaged → a conversation
    // starts"). It no longer does: finding a composer is not use, and the session
    // may well already exist from before this page load. Ask the worker instead,
    // which resumes a surviving engagement and never mints on a bare ask.
    refreshSessionId(true);
    const tag = el.tagName + (el.getAttribute('role') ? ('[role=' + el.getAttribute('role') + ']') : '');
    console.info('[cfai] attached to prompt input:', tag,
      el.getAttribute('aria-label') || el.getAttribute('placeholder') || '');

    el.addEventListener('paste', (e) => handlePaste(el, e), true);

    // PRIMARY ENFORCEMENT — block Enter directly on the input element.
    // This fires before React's delegation because it's on the element itself.
    // Tokenize-patterns are filtered out by scanForBlockers — they pass through
    // and are handled by the fetch-blocker at the network level.
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        const captured = readInputText(el);
        if (ENFORCE && captured && !isProgrammaticSend()) {
          const matches = scanForBlockers(captured);
          if (matches) {
            e.preventDefault();
            e.stopImmediatePropagation();
            e.stopPropagation();
            console.info('[cfai] ELEMENT-LEVEL BLOCK on Enter');
            _lastLogKey = null;
            const cid = emitEnforcement('block', el, matches, 'prompt_submit');
            showBlockPopup(matches, el, cid);
            return;
          }
        }
        setTimeout(() => handleSubmit(el, captured), 0);
      }
    }, true);

    // Also block the send button — find nearby buttons and attach directly
    const form = el.closest('form') || el.parentElement?.parentElement?.parentElement;
    if (form) {
      const blockBtnEvent = (e) => {
        if (!ENFORCE) return;
        if (isProgrammaticSend()) return;   // our own masked resend
        const text = readInputText(el);
        if (!text) return;
        const matches = scanForBlockers(text);
        if (!matches) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        e.stopPropagation();
        console.info('[cfai] BUTTON-LEVEL BLOCK on', e.type);
        _lastLogKey = null;
        const cid = emitEnforcement('block', el, matches, 'prompt_submit');
        showBlockPopup(matches, el, cid);
      };
      // Attach to all buttons in the composer area
      const attachToButtons = () => {
        for (const btn of form.querySelectorAll('button, [role="button"]')) {
          if (btn.__cfaiBlocked) continue;
          btn.__cfaiBlocked = true;
          btn.addEventListener('pointerdown', blockBtnEvent, true);
          btn.addEventListener('mousedown', blockBtnEvent, true);
          btn.addEventListener('click', blockBtnEvent, true);
        }
      };
      attachToButtons();
      // Re-attach when new buttons appear (ChatGPT swaps send/stop buttons)
      new MutationObserver(attachToButtons).observe(form, { subtree: true, childList: true });
    }
  }

  function scanAndAttach() {
    // Piggy-backs on the existing SPA/DOM-change cadence: bind the session to a
    // new conversation id when the URL changed (see checkConvUrl — it no longer
    // rotates anything).
    checkConvUrl();
    for (const el of findPromptInputs()) attach(el);
    attachToShadowRoots();
  }

  scanAndAttach();
  installEnforcementHooks();

  // Back/forward and hash routing don't necessarily mutate the DOM in a way the
  // observer below catches, so check the URL on those directly too.
  window.addEventListener('popstate', checkConvUrl);
  window.addEventListener('hashchange', checkConvUrl);

  // Coming back to the tab is use: it slides the session's idle window (the ask
  // carries touch:true) and it is the moment the cached session id is most likely
  // to be stale — the sweep may have retired the engagement while we were away.
  // The replay recorder rides along on this ONE listener rather than adding a
  // second: it pauses the instant the tab is hidden and resumes when it comes back
  // (see nextReplayState), and the session-id refresh above is exactly the
  // information its next tick needs.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshSessionId(true);
    try { if (_replayController) _replayController.onVisibilityChange(); } catch (e) {}
  });
  // On load, find out whether an engagement survived this page load. It usually
  // has — surviving a reload is the point of the change — and the replay
  // controller needs the id before any event fires.
  refreshSessionId(true);

  // Watch for DOM changes (SPA navigation in these apps) so we attach the
  // paste/keydown handlers to newly-mounted prompt inputs. Enforcement
  // listeners are global (on document) so they don't need re-binding.
  const obs = new MutationObserver(() => scanAndAttach());
  obs.observe(document.body, { subtree: true, childList: true });

  // Periodic re-scan as a belt-and-suspenders measure
  setInterval(scanAndAttach, 5000);

  function inferService(host) {
    if (/chatgpt|openai/.test(host)) return 'ChatGPT';
    if (/claude/.test(host)) return 'Claude';
    if (/gemini|aistudio|bard/.test(host)) return 'Gemini';
    if (/perplexity/.test(host)) return 'Perplexity';
    if (/copilot|m365\.cloud\.microsoft/.test(host)) return 'Microsoft Copilot';
    if (/poe/.test(host)) return 'Poe';
    if (/huggingface/.test(host)) return 'HuggingFace Chat';
    if (/mistral/.test(host)) return 'Mistral';
    if (/groq/.test(host)) return 'Groq';
    // SaaS-embedded AI chatbots — host is the customer's site (or the widget
    // CDN), so the service name follows the vendor we identify on the page.
    if (/salesforce|force\.com/.test(host)) return 'Salesforce Agentforce';
    if (/intercom/.test(host))               return 'Intercom AI';
    if (/drift/.test(host))                  return 'Drift AI';
    if (/zendesk|zopim/.test(host))          return 'Zendesk AI';
    if (/hubspot|hs-scripts/.test(host))     return 'HubSpot AI';
    if (/livechatinc/.test(host))            return 'LiveChat AI';
    if (/crisp\.chat/.test(host))            return 'Crisp AI';
    if (/tawk\.to/.test(host))               return 'Tawk AI';
    return host;
  }

  // ── Recording indicator (Session Replay) ────────────────────────────────────
  // DELIBERATE PRODUCT DECISION: this deployment runs Session Replay with no
  // in-page indicator and no in-page stop control. Employee AI usage is governed
  // under policy the employee has already been notified of through other
  // channels (handbook / IT policy / onboarding), not through this UI, so the
  // banner and its "Stop recording" button — which existed to give the tab
  // recording a visible, user-stoppable indicator — were removed rather than
  // merely hidden. `_replayController` is retained below because the replay
  // bootstrap and the visibilitychange handler both still need a reference to
  // the controller; it no longer has anything reachable that stops it via the
  // page UI.
  let _recRecordingId = null;
  // The rrweb controller, assigned by the session-replay bootstrap at the very
  // end of this IIFE. DECLARED HERE, well before that point, because the
  // visibilitychange handler above reads it: `let` is not hoisted into an
  // initialized state, so a declaration further down would leave a temporal
  // dead zone at that read site.
  let _replayController = null;

  // content.js is injected with all_frames:true. Recording state belongs to the
  // the TAB, so only the top frame paints it — otherwise every iframe would grow
  // its own clipped copy, and each of those copies would arm its own fail-closed
  // watcher, so one ad frame recycling its DOM would kill a legitimate recording.
  // (The worker also scopes its banner messages to frameId 0; this is the
  // belt-and-braces half, and it keeps the region testable outside a browser.)
  function isTopFrame() {
    try {
      if (typeof window === 'undefined') return true;
      return window.top === window.self;
    } catch (e) {
      // Cross-origin access to window.top throws — that only happens inside a
      // frame, so treat it as "not the top frame".
      return false;
    }
  }

  // showRecordingBanner / hideRecordingBanner are the two hooks the replay
  // controller calls (as `d.showBanner` / `d.hideBanner`, see the bootstrap
  // below) at run start/registration/pause/resume/complete. Per the deliberate
  // decision above, neither touches the DOM — recording proceeds without any
  // in-page indicator, and there is no "Stop recording" control for a user to
  // find. Both are kept as real functions (not deleted) purely because the
  // controller's dependency-injection contract expects them to exist and be
  // safely callable at every one of those lifecycle points.
  function showRecordingBanner(recordingId) {
    if (!isTopFrame()) return null;
    _recRecordingId = recordingId || _recRecordingId;
    return null;
  }

  function hideRecordingBanner() {
    _recRecordingId = null;
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || typeof msg !== 'object') return;

    // Legacy message types from the retired tabCapture era. Nothing sends them
    // any more (the worker no longer owns recording start/stop), but the
    // listener is kept so an old worker build talking to a freshly-updated
    // content script does not hang waiting for an answer.
    if (msg.type === 'cfai-recording-started') {
      showRecordingBanner(msg.recording_id);
      if (sendResponse) sendResponse({ ok: true });
      return;
    }
    if (msg.type === 'cfai-recording-stopped') {
      hideRecordingBanner();
      if (sendResponse) sendResponse({ ok: true });
      return;
    }
    // Legacy query, kept only so an older worker build does not hang on a
    // sendMessage with no answer. The worker OWNS session identity now, so it
    // never has to ask us; all we can report is the last answer it gave us.
    // Asking must never MINT (that would create a conversation with no turns), so
    // null is a valid answer.
    if (msg.type === 'cfai-recording-state' && msg.want === 'session') {
      if (sendResponse) sendResponse({ session_id: currentSessionIdCached() });
      return;
    }
  });

  // ── Blocked Agent Enforcement ──────────────────────────────────────────────
  // Maps platform types to the hostnames where those agents are accessed via
  // browser. When a blocked agent is detected on the current page, we inject
  // a full-page overlay that prevents all interaction.

  const PLATFORM_TO_HOSTS = {
    copilot_studio:     [/copilot\.microsoft/, /m365\.cloud\.microsoft/, /powerva\.ms/, /copilotstudio/],
    personal_agent:     [/copilot\.microsoft/, /m365\.cloud\.microsoft/],
    teams_chat_agent:   [/teams\.microsoft/],
    openai_assistant:   [/chatgpt\.com/, /chat\.openai\.com/],
    custom_gpt:         [/chatgpt\.com/, /chat\.openai\.com/],
    claude_ai_project:  [/claude\.ai/],
    gemini:             [/gemini\.google/, /aistudio\.google/],
    gemini_enterprise:  [/gemini\.google/, /discoveryengine/],
    vertex_ai:          [/console\.cloud\.google/],
    azure_foundry:      [/portal\.azure/, /ai\.azure/],
  };

  // ── Blocked Agent Enforcement (DOM-level) ─────────────────────────────────
  // Copilot uses SignalR/WebSocket events for chat, not fetch(). The only
  // way to block sends is at the DOM level: disable the input field and
  // intercept Enter/click before the app's event handlers fire.
  //
  // This runs in the CONTENT SCRIPT (has chrome.storage.local access)
  // so there's no postMessage delay.

  let _blockedList = [];
  let _blockEnforcerInstalled = false;
  let _blockCheckInterval = null;

  function applyBlockedList(list) {
    _blockedList = list || [];
    // Also forward to fetch-blocker for platforms that DO use fetch (ChatGPT, Claude)
    window.postMessage({ type: 'cfai-blocked-agents', blocked: list }, '*');
    // Start DOM-level enforcement
    if (!_blockCheckInterval && _blockedList.length > 0) {
      enforceBlockedAgent();
      _blockCheckInterval = setInterval(enforceBlockedAgent, 500);
    }
  }

  // Get the current agent name from ONLY the top header bar / breadcrumb.
  // This is the single reliable indicator of which agent is active.
  // Do NOT scan chat body or main content — that causes false positives
  // from agent names appearing in sidebar, suggestions, or chat history.
  function getHeaderAgentText() {
    const parts = [];

    // 1. document.title — "AgentName | M365 Copilot" or "AgentName > ChatTitle | M365 Copilot"
    parts.push(document.title || '');

    // 2. The top breadcrumb/header bar — the strip at the very top showing
    //    "Gemini Conversation Agent 1" or "Agent > Conversation Title"
    //    Target the FIRST text element in the top bar area.
    //    Copilot's header is usually the first child of the page layout.
    const headerCandidates = document.querySelectorAll(
      // Breadcrumb-style elements
      '[class*="readcrumb"], [class*="eader"] a, [class*="eader"] span,' +
      // Generic top-bar text — first few elements only
      '[class*="opBar"] span, [class*="op-bar"] span'
    );
    for (const el of headerCandidates) {
      if (el.closest('nav, [class*="sidebar"], [class*="Sidebar"], [role="navigation"]')) continue;
      const text = (el.textContent || '').trim();
      if (text.length > 2 && text.length < 80) parts.push(text);
    }

    return parts.join(' ').toLowerCase();
  }

  function isBlockedAgentActive() {
    if (!_blockedList.length) return null;
    const host = location.hostname;
    const headerText = getHeaderAgentText();

    for (const agent of _blockedList) {
      const hostPatterns = PLATFORM_TO_HOSTS[agent.platform] || [];
      if (!hostPatterns.some(rx => rx.test(host))) continue;

      const name = (agent.agent_name || '').toLowerCase();
      if (!name || name.length < 2) continue;

      // Exact full name match only — no partial matching.
      // "gemini agent 1" must NOT match "gemini agent".
      if (headerText.includes(name)) return agent;
    }
    return null;
  }

  function enforceBlockedAgent() {
    const blocked = isBlockedAgentActive();
    const inputs = document.querySelectorAll(
      'textarea, [contenteditable="true"], [role="textbox"], [class*="textbox"]'
    );

    if (blocked) {
      // Disable all input fields
      inputs.forEach(el => {
        if (!el.dataset.cfaiBlocked) {
          el.dataset.cfaiBlocked = '1';
          el.dataset.cfaiOrigPointerEvents = el.style.pointerEvents || '';
        }
        el.style.pointerEvents = 'none';
        el.style.opacity = '0.4';
        el.setAttribute('aria-disabled', 'true');
        // Clear any typed text
        if (el.textContent && el.textContent.trim()) {
          // Don't clear placeholder text
        }
      });

      // Install Enter/click blocker once
      if (!_blockEnforcerInstalled) {
        _blockEnforcerInstalled = true;

        // Block Enter key at capture phase (before app sees it)
        document.addEventListener('keydown', function(e) {
          if (e.key === 'Enter' && !e.shiftKey) {
            const activeBlocked = isBlockedAgentActive();
            if (activeBlocked) {
              e.preventDefault();
              e.stopPropagation();
              e.stopImmediatePropagation();
              showWarning(
                [{ pattern: 'Blocked agent: ' + activeBlocked.agent_name, severity: 'critical', count: 1 }],
                'Agent blocked by organization policy'
              );
              return false;
            }
          }
        }, true); // capture phase

        // Block send button clicks — ONLY buttons inside/near the input area
        document.addEventListener('click', function(e) {
          const activeBlocked = isBlockedAgentActive();
          if (!activeBlocked) return;

          // Only block clicks on buttons that are inside the composer/input area
          // (not sidebar nav, not header buttons, not chat history)
          const btn = e.target.closest('button, [role="button"]');
          if (!btn) return;

          // Check if button is near an input/textbox (within the same container)
          const inputArea = btn.closest('[class*="composer"], [class*="input-area"], [class*="ChatInput"], [class*="prompt"]');
          const nearTextbox = btn.parentElement?.querySelector('[role="textbox"], textarea, [contenteditable]');
          const isInInputZone = inputArea || nearTextbox;
          if (!isInInputZone) return; // not a send button — let click through

          const label = (btn.getAttribute('aria-label') || '').toLowerCase();
          if (/send|submit/.test(label) || isInInputZone) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            showWarning(
              [{ pattern: 'Blocked agent: ' + activeBlocked.agent_name, severity: 'critical', count: 1 }],
              'Agent blocked by organization policy'
            );
            return false;
          }
        }, true); // capture phase
      }
    } else {
      // Restore inputs when not on a blocked agent
      inputs.forEach(el => {
        if (el.dataset.cfaiBlocked) {
          el.style.pointerEvents = el.dataset.cfaiOrigPointerEvents || '';
          el.style.opacity = '';
          el.removeAttribute('aria-disabled');
          delete el.dataset.cfaiBlocked;
          delete el.dataset.cfaiOrigPointerEvents;
        }
      });
    }
  }

  // Load blocked list from cache IMMEDIATELY (no postMessage delay)
  try {
    chrome.storage.local.get(['cfai.blocked'], (result) => {
      const cached = result['cfai.blocked'] || [];
      if (cached.length > 0) {
        console.info('[cfai] blocked agents from cache:', cached.map(a => a.agent_name).join(', '));
        applyBlockedList(cached);
      }
    });
  } catch (e) {}

  // Also request from background (gets fresh data from server)
  try {
    chrome.runtime.sendMessage({ type: 'cfai-get-blocked' }, (resp) => {
      if (resp?.blocked) applyBlockedList(resp.blocked);
    });
  } catch {}

  // Listen for real-time updates from background
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'cfai-blocked-update') {
      applyBlockedList(msg.blocked || []);
    }
  });

  // ── session replay bootstrap ─────────────────────────────────────────────
  // Wiring only. Everything that DECIDES anything lives in content/replay.js
  // (window.__cfaiReplay), which is a separate classic script for exactly that
  // reason: it has no DOM or chrome.* dependency of its own, so its state machine,
  // chunking, gzip and masking are all unit-tested in plain `node --test`. This
  // region hands it the four collaborators only this file has — the worker RPC
  // channel, the cached session id, tab visibility and the recording banner — and
  // then gets out of the way.
  //
  // WHY IT IS LAST IN THE IIFE: it reaches back for showRecordingBanner /
  // hideRecordingBanner / currentSessionIdCached / isTabVisible / isTopFrame, all
  // defined above, and starting the recorder before the DLP layer has attached would
  // mean observing a page whose composer attach() has not marked yet — and that mark
  // (el.__cfaiComposer, read by replay.js's maskInputFn as COMPOSER_MARK) is the
  // primary unmask signal. Note it is the NARROW mark, not the broad __cfaiAttached
  // one — see the two-marks comment on attach().
  //
  // `_replayController` itself is declared up in the recording-banner region, next to
  // the other state the banner path owns — see the note there.

  /**
   * chrome.runtime.sendMessage as a Promise, resolving { ok:false, error } instead
   * of rejecting. Same shape as every other worker RPC in this file (see emit() and
   * refreshSessionId): the callback reads chrome.runtime.lastError first, because
   * not reading it makes Chrome log "Unchecked runtime.lastError" on every send to
   * a worker that has gone away. The recorder is written to treat any falsy or
   * !ok answer as "not accepted", so a rejected promise would only convert a
   * handled outage into an unhandled one.
   */
  function sendReplayRpc(payload) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(payload, (resp) => {
          const err = chrome.runtime.lastError;
          if (err) return resolve({ ok: false, error: err.message || 'sendMessage failed' });
          resolve(resp || { ok: false, error: 'no response' });
        });
      } catch (e) {
        // Extension context invalidated (reload/update). The recorder stops on the
        // register-retry cap or the next policy poll.
        resolve({ ok: false, error: e?.message || 'extension context gone' });
      }
    });
  }

  function startSessionReplay() {
    // The recording belongs to the TAB. content.js is injected with
    // all_frames:true, so a per-frame recorder would register N runs for one page
    // and each subframe would fight the others over the daily budget.
    if (!isTopFrame()) return null;

    // Each precondition is checked and REPORTED separately. This used to blame
    // content/replay.js whenever `api` was falsy, which hid the far more common
    // failure — the 800 KB vendor bundle not loading — behind the wrong filename.
    // One warning, not a loop: on a host reached through the classifier's
    // chrome.scripting path, a missing file here means the inject list and the
    // manifest have drifted apart, which is worth seeing in the console.
    if (typeof window.rrweb?.record !== 'function') {
      console.warn('[cfai] session replay unavailable — vendor/rrweb-record.js did not load',
                   window.rrweb ? '(window.rrweb has no record())' : '(window.rrweb is missing)');
      return null;
    }
    const api = window.__cfaiReplay;
    if (!api || typeof api.createReplayController !== 'function') {
      console.warn('[cfai] session replay unavailable — content/replay.js did not load',
                   api ? '(window.__cfaiReplay has no createReplayController())' : '');
      return null;
    }

    let ctl = null;
    try {
      ctl = api.createReplayController({
        rrweb: window.rrweb,
        send: sendReplayRpc,
        // A cached read of what the WORKER last said this tab's session is. Never
        // mints, never blocks — see the conversation-identity region above.
        getSessionId: currentSessionIdCached,
        visible: isTabVisible,
        showBanner: showRecordingBanner,
        hideBanner: hideRecordingBanner,
        // The hostname only. The path carries the conversation id, which is not
        // this feature's business.
        host: location.hostname,
        doc: document,
      });
      // init() is ASYNC: a failure inside it REJECTS, and a sync try/catch can never
      // see that — hence the explicit .catch(). It is not fatal and does not
      // invalidate the controller (init() arms its own tick timer regardless, and the
      // banner stop path still needs this reference), so it is logged and the
      // controller is kept. A SYNCHRONOUS throw — a controller object without an
      // init(), a stub — still lands in the catch below and yields no controller.
      Promise.resolve(ctl.init()).catch((e) => {
        console.warn('[cfai] session replay init failed:', e?.message || e);
      });
    } catch (e) {
      console.warn('[cfai] session replay failed to start:', e?.message || e);
      return null;
    }
    return ctl;
  }

  _replayController = startSessionReplay();

  // pagehide, NOT beforeunload: beforeunload disqualifies the page from the back/
  // forward cache. Best effort by nature — the document is going away while gzip
  // and sendMessage are both async — so nothing awaits it.
  window.addEventListener('pagehide', () => {
    try { if (_replayController) _replayController.onPageHide(); } catch (e) {}
  });
  // visibilitychange is folded into the single listener further up, next to the
  // session-id refresh, rather than registering a second one.
  // ── end session replay bootstrap ─────────────────────────────────────────

})();

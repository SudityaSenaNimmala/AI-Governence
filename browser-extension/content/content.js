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
  // Inject feature flags into the page world via a DOM data attribute.
  // Both fetch-blocker.js and content.js read from this.
  // The attribute is set BEFORE fetch-blocker loads so it reads flags synchronously.
  function pushFeaturesToPage(feats) {
    try {
      document.documentElement.setAttribute('data-cfai-features', JSON.stringify(feats));
    } catch {}
  }

  // Load features then inject fetch-blocker
  function injectFetchBlocker() {
    try {
      const script = document.createElement('script');
      script.src = chrome.runtime.getURL('content/fetch-blocker.js');
      (document.head || document.documentElement).appendChild(script);
      script.onload = () => script.remove();
    } catch (e) {
      console.warn('[cfai] could not inject fetch blocker:', e);
    }
  }

  // Try to get features from service worker first, then inject
  let _fetchBlockerInjected = false;
  function injectOnce() {
    if (_fetchBlockerInjected) return;
    _fetchBlockerInjected = true;
    injectFetchBlocker();
  }

  try {
    // Ask service worker for features — it has them from startup fetch
    chrome.runtime.sendMessage({ type: 'cfai-get-features' }, (resp) => {
      if (chrome.runtime.lastError) { injectOnce(); return; }
      if (resp?.features?.features) {
        pushFeaturesToPage(resp.features.features);
      }
      injectOnce();
    });
    // Safety: if service worker doesn't respond in 1s, inject anyway
    setTimeout(injectOnce, 1000);
  } catch (e) {
    injectOnce();
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

      // WHICH CONVERSATION THIS REPLY BELONGS TO, captured by the page side when
      // the request was TEED — not now. A long answer can still be streaming
      // when the user clicks into another chat, so reading the URL (or the
      // active-conversation variable, which the user's next prompt will have
      // already moved) at end-of-stream would file the reply under the wrong
      // conversation. Falls back to whatever emit() would have stamped when the
      // page side could not determine one.
      const teeConvId = typeof d.external_conv_id === 'string' && d.external_conv_id.trim()
        ? d.external_conv_id.trim()
        : null;

      emit({
        kind: 'ai_response',
        ...(teeConvId ? { external_conv_id: teeConvId } : {}),
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
  async function applyPlatformPolicy(platforms) {
    if (!isFeatureOn('ai_systems')) return; // platform blocking is part of AI Systems
    const hit = platformBlockMatch(platforms);
    if (hit) {
      // Check if this machine has a temporary access exception.
      // Routed through the service worker to avoid mixed-content blocks
      // (HTTPS page → HTTP server fetch is silently blocked by Chrome).
      try {
        const resp = await new Promise((resolve) => {
          chrome.runtime.sendMessage(
            { __cfai_kind: 'checkAccessException', tool_host: location.hostname },
            (r) => {
              if (chrome.runtime.lastError) return resolve(null);
              resolve(r);
            },
          );
        });
        if (resp && resp.allowed) {
          PLATFORM_BLOCKED = false;
          BLOCKED_PLATFORM = null;
          removePlatformBanner();
          console.info('[cfai] access exception active for', location.hostname, '— expires:', resp.expires_at);
          return;
        }
      } catch {} // Service worker unavailable — enforce the block
    }
    PLATFORM_BLOCKED = !!hit;
    BLOCKED_PLATFORM = hit;
    if (PLATFORM_BLOCKED) showPlatformBanner();
    else removePlatformBanner();
  }
  // ── Server-driven DLP pattern policy ─────────────────────────────────────────
  // Mirrors the platform-policy plumbing below: cached read for an instant start,
  // storage listener for live updates, and a message fallback if this tab loaded
  // before the service worker had written the mirror.
  //
  // If none of that yields a policy, patterns.js keeps every pattern enabled at
  // its built-in severity. Detection degrading silently to nothing because the
  // server was unreachable would be far worse than ignoring pack configuration.
  function applyDlpPolicy(policy) {
    try {
      if (!policy || !window.__cfaiPatterns?.applyPolicy) return;
      window.__cfaiPatterns.applyPolicy(policy);
    } catch { /* never let policy handling break the page */ }
  }
  try {
    chrome.storage.local.get(['cfai.dlp_policy'], (r) => applyDlpPolicy(r['cfai.dlp_policy']));
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes['cfai.dlp_policy']) applyDlpPolicy(changes['cfai.dlp_policy'].newValue);
    });
    chrome.runtime.sendMessage({ type: 'cfai-get-dlp-policy' }, (resp) => {
      if (chrome.runtime.lastError) return;
      if (resp && resp.policy) applyDlpPolicy(resp.policy);
    });
  } catch { /* extension context unavailable — defaults apply */ }

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
  const _rawScan = window.__cfaiPatterns?.scan ?? (() => []);
  // Gate ALL scanning through the DLP feature flag
  const scan = (text) => isFeatureOn('dlp') ? _rawScan(text) : [];
  const classifyFile = window.__cfaiPatterns?.classifyFile ?? ((n) => ({ class: 'other', severity: 'low', reason: '' }));
  const sizeBucket = window.__cfaiPatterns?.sizeBucket ?? (() => '?');

  // ── Server-driven feature flags ────────────────────────────────────────────
  // Cached from the service worker. When a feature is disabled on the server,
  // the extension skips its enforcement — e.g. DLP scanning, platform blocking.
  let _cfaiFeatures = {};
  // Bootstrap from DOM attribute (set by us above before fetch-blocker loaded)
  try { const raw = document.documentElement.getAttribute('data-cfai-features'); if (raw) _cfaiFeatures = JSON.parse(raw); } catch {}

  function isFeatureOn(key) {
    // Re-read from DOM attribute each time — picks up live updates
    try {
      const raw = document.documentElement.getAttribute('data-cfai-features');
      if (raw) { const f = JSON.parse(raw); if (f[key]) return f[key].status === 'enabled'; }
    } catch {}
    const f = _cfaiFeatures[key];
    if (!f) return true;
    return f.status === 'enabled';
  }

  function applyFeatures(feats) {
    if (!feats || typeof feats !== 'object' || !Object.keys(feats).length) return;
    _cfaiFeatures = feats;
    pushFeaturesToPage(feats);
  }

  try {
    // Live updates when service worker refreshes flags
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes['cfai.features']?.newValue?.features) {
        applyFeatures(changes['cfai.features'].newValue.features);
      }
    });
  } catch {}

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

  // ── The ACTIVE conversation — what the replay recorder is scoped to ─────────
  // _lastConvId above follows the URL. This one deliberately does NOT: it is the
  // conversation id that was in effect at the moment of the last REAL user
  // interaction — a submitted prompt, a pasted prompt, a file upload — and it is
  // updated in exactly one place, inside emit(), for exactly those kinds.
  //
  // WHY, and why this is not a timer. A user flicking through five old chats to
  // find something must not produce five recordings; but the moment they type in
  // one of them, that chat's recording must start. Both fall out of this variable
  // with no debounce, no settle window and no timing logic anywhere: navigating
  // without interacting never changes it, so the replay controller's
  // conversation boundary never fires and nothing new is recorded — reading an
  // old chat costs nothing. One prompt changes it, and the boundary fires then.
  //
  // It is deliberately NOT moved by an ai_response arriving: a reply is the
  // model acting, not the user, and the reply can land after the user has
  // already switched chats (the listener carries its own capture-time id for
  // exactly that reason). Nor by a bare navigation, which is the whole point.
  //
  // 'prompt_typed' is emitted by agent/src/os_monitor, not by this file. It is
  // kept here so the one definition of "a user composed something" is the same
  // in both subsystems (server-side routes/dlp.js USER_KINDS lists all four too)
  // and so it is already handled if this script ever starts emitting it.
  const USER_ACTION_KINDS = new Set([
    'prompt_submit',
    'prompt_paste',
    'prompt_typed',
    'file_upload',
  ]);
  let _activeConvId = null;

  // ── …and the kinds that must NOT read that cache at all ─────────────────────
  // THE BUG THIS FIXES. A prompt that trips enforcement never reaches
  // logPromptEvent() — the blocking branch deliberately skips it and emits only
  // enforcement_block, carrying the blocked text. A blocked FILE upload skips
  // emitFileUpload() the same way. So nothing on either path moves _activeConvId,
  // and the enforcement record was stamped with whatever chat the user last
  // successfully TYPED in: block something in chat B right after prompting in
  // chat A and the evidence was filed under chat A.
  //
  // The cache exists to answer "which chat is the user composing in", debounced
  // against mere navigation, so that clicking through old chats does not start
  // recordings. These kinds ask a different question — "where did this thing that
  // just happened, happen" — and the honest answer is a LIVE read of the URL at
  // the moment of the event. There is nothing to debounce: a security event is
  // not a composition.
  //
  // NOT ai_response: a reply is the model acting, and it can land after the user
  // has already switched chats, so it carries its own capture-time id from the
  // request tee (see the ai_response listener) and falls back to the cache.
  // NOT session_bind: it is about a specific id by definition and supplies it.
  //
  // A live read that finds no id (a brand-new chat the site has not minted a URL
  // for yet) stores null — the correct, safe outcome. Misattributing is worse
  // than not attributing, and null is exactly how every other "no id extractable"
  // case in this feature already degrades.
  // Only kinds that actually go through emit() belong here. `access_request`
  // used to be listed and was dead weight: the block modal sends it straight to
  // the worker with its own chrome.runtime.sendMessage, and the worker relays it
  // to /api/v1/access-requests — it never touches emit(), so it never had a
  // conversation id to stamp in the first place. tests/conv-identity.test.mjs
  // now derives the kind list from emit() call sites, so a dead entry here fails
  // the build instead of looking like a rule.
  const LIVE_CONV_ID_KINDS = new Set([
    'model_routed',
  ]);

  /** Every enforcement_* kind (block / redact / decision / override / …) plus the
   * explicit list above. Prefix-matched so a new enforcement action cannot
   * silently opt itself back into the stale cache. */
  function readsLiveConvId(kind) {
    if (typeof kind !== 'string') return false;
    return kind.startsWith('enforcement_') || LIVE_CONV_ID_KINDS.has(kind);
  }

  /** What the replay controller reads as getConversationId(). Never mints, never
   * touches the URL — see the note above. */
  function activeConvIdCached() {
    return _activeConvId;
  }

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

  // ── AI surface scope ──────────────────────────────────────────────────────
  //
  // Governance used to be decided per HOST and enforced across the whole PAGE.
  // The registry governs mail.google.com for "Gemini in Gmail", hubspot.com for
  // HubSpot AI, github.com for Copilot — and once a host was governed, every
  // textarea, contenteditable and file input on it was captured as an AI prompt.
  // Production collected 186 events from app.hubspot.com, 32 from github.com and
  // 6 from a SharePoint tenant, all from ordinary compose fields, all with stored
  // content. That is employee correspondence captured under an AI policy.
  //
  // So a host is now one of two scopes:
  //   whole_site  — the site IS the AI product. Capture anywhere (unchanged).
  //   embedded_ai — AI is a panel inside a larger app. Capture ONLY inside a
  //                 recognised AI panel, and nothing at all if none is present.
  //
  // THE LIST IS BUILT IN, not only fetched. The server serves the authoritative
  // map at /api/v1/ai-surfaces so a stale selector is a config fix rather than an
  // extension release — but a privacy guarantee must not depend on a network call
  // succeeding, so this floor applies even with no server reachable. The synced
  // map can add hosts and replace selectors; it cannot remove the floor.
  const EMBEDDED_AI_FLOOR = {
    'mail.google.com': ['[aria-label*="Gemini" i]', '[data-gemini]', 'dialog[aria-label*="Gemini" i]'],
    'docs.google.com': ['[aria-label*="Gemini" i]', '[aria-label*="Help me write" i]'],
    'hubspot.com':     ['[data-test-id*="copilot" i]', '[class*="copilot" i]', '[aria-label*="Breeze" i]'],
    'github.com':      ['[data-testid*="copilot" i]', '#copilot-chat', '[aria-label*="Copilot" i]', 'copilot-chat'],
    'sharepoint.com':  ['[aria-label*="Copilot" i]', '[class*="copilot" i]'],
    'zendesk.com':     ['[data-test-id*="copilot" i]', '[data-test-id*="generative" i]', '[class*="ai-agent" i]'],
    'salesforce.com':  ['[aria-label*="Einstein" i]', '[aria-label*="Agentforce" i]'],
    'force.com':       ['[aria-label*="Einstein" i]', '[aria-label*="Agentforce" i]'],
    'intercom.com':    ['[class*="fin-" i]', '[class*="intercom-ai" i]'],
  };
  // NOTE ON SELECTORS: they key on the AI product's own name — Gemini, Copilot,
  // Breeze, Einstein — never a bare "ai" token. An attribute substring match on
  // "ai" also matches the word "mail", which on Gmail would re-select the entire
  // mail UI and reproduce exactly the bug this code removes.

  let _syncedSurfaces = null;   // { host: {selectors:[]} } from the server
  try {
    chrome.storage.local.get(['cfai.ai_surfaces'], (r) => {
      const v = r['cfai.ai_surfaces'];
      if (v && typeof v === 'object') _syncedSurfaces = v.embedded || v;
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes['cfai.ai_surfaces']) {
        const v = changes['cfai.ai_surfaces'].newValue;
        _syncedSurfaces = v && (v.embedded || v);
      }
    });
  } catch (e) { /* extension context gone; the floor still applies */ }

  /** Longest matching host key across the synced map and the built-in floor. */
  function surfaceSelectorsForHost(host) {
    const h = String(host || '').toLowerCase();
    let best = null, bestLen = 0;
    const consider = (key, sels) => {
      if (!sels || !sels.length) return;
      if ((h === key || h.endsWith('.' + key)) && key.length > bestLen) {
        best = sels; bestLen = key.length;
      }
    };
    for (const [k, v] of Object.entries(EMBEDDED_AI_FLOOR)) consider(k, v);
    if (_syncedSurfaces) {
      for (const [k, v] of Object.entries(_syncedSurfaces)) {
        consider(k, Array.isArray(v) ? v : (v && v.selectors));
      }
    }
    return best;   // null => whole_site
  }

  const _panelSelectors = surfaceSelectorsForHost(
    (typeof window !== 'undefined' && window.location) ? window.location.hostname : '',
  );
  const IS_EMBEDDED_AI = !!_panelSelectors;
  if (IS_EMBEDDED_AI) {
    console.info('[cfai] embedded-AI host: capture restricted to the AI panel only');
  }

  // What a prompt is typed into. Also the test for "is this an AI PANEL, or just
  // the button that opens one".
  const COMPOSER_SEL = 'textarea, [contenteditable]:not([contenteditable="false"]), [role="textbox"]';

  /**
   * A matched node only counts as an open AI panel if a prompt can actually be
   * typed in it.
   *
   * WHY. Gmail keeps a Gemini launcher button in its toolbar at all times, and
   * that button's aria-label contains "Gemini" — so a name-only selector matched
   * it on the bare inbox, `aiPanels()` came back non-empty, and the page was
   * treated as having an open AI panel when it did not. Reported from a live test:
   * the banner appeared on the inbox.
   *
   * Requiring a composer is not a heuristic about size or position, it is the
   * thing we actually care about: a surface where prompts can be entered. A
   * launcher icon contains no composer. If a panel renders its composer inside a
   * shadow root this returns false and the host captures nothing — the same
   * fail-closed direction as everything else here.
   */
  // The launcher itself: Gmail's toolbar Gemini button, a "Ask Copilot" link, a
  // menu trigger. Rejected before anything else — it carries the AI's name but is
  // not a surface anything can be typed into.
  const LAUNCHER_SEL = 'button, [role="button"], a, [aria-haspopup]';

  function isPanelWithComposer(el) {
    try {
      if (el.matches && el.matches(LAUNCHER_SEL)) return false;
      if (el.matches && el.matches(COMPOSER_SEL)) return true;
      return !!(el.querySelector && el.querySelector(COMPOSER_SEL));
    } catch (e) { return false; }
  }

  /** Visible AI panels on the page right now. */
  function aiPanels() {
    if (!_panelSelectors) return [];
    const out = [];
    for (const sel of _panelSelectors) {
      let found;
      try { found = document.querySelectorAll(sel); } catch (e) { continue; }
      for (const el of found) {
        // A hidden panel is not an open panel: a collapsed side panel still
        // exists in the DOM, and treating it as open would re-govern the page.
        if (typeof el.getClientRects === 'function' && el.getClientRects().length === 0) continue;
        if (!isPanelWithComposer(el)) continue;
        out.push(el);
      }
    }
    return out;
  }

  /**
   * May this element's content be captured?
   *
   * whole_site  → always. embedded_ai → only inside a visible AI panel.
   * Crosses shadow boundaries via getRootNode(), because these panels are
   * routinely rendered in one.
   */
  function captureAllowed(el) {
    if (!IS_EMBEDDED_AI) return true;
    const panels = aiPanels();
    if (panels.length === 0) return false;   // fail closed
    if (!el) return true;                    // page-level event, a panel is open
    let node = el;
    while (node) {
      for (const p of panels) {
        if (p === node || (p.contains && p.contains(node))) return true;
      }
      const root = node.getRootNode ? node.getRootNode() : null;
      node = (root && root.host) ? root.host : null;   // hop out of a shadow root
    }
    return false;
  }
  // ── end AI surface scope ─

  function emit(event) {
    try {
      const kind = event && event.kind;
      // SCOPE GATE. On an embedded-AI host, nothing is reported unless an AI
      // panel is actually open. Events carrying an element are additionally
      // checked for containment at their own call sites, where the element is
      // known; this catches the page-level kinds (ai_response, model_routed)
      // that have no element at all.
      if (IS_EMBEDDED_AI && !captureAllowed(null)) {
        console.info('[cfai] suppressed', kind, '— no AI panel open on this embedded-AI host');
        return;
      }
      // THE ONLY PLACE _activeConvId MOVES. A real user action re-reads the URL;
      // everything else (an AI reply arriving, an enforcement record, a routing
      // decision, a bare SPA navigation) leaves it exactly where it was.
      if (USER_ACTION_KINDS.has(kind)) _activeConvId = currentConvId();
      // …and the kinds that read the URL LIVE without ever moving the cache —
      // see readsLiveConvId(). Reading is not composing, so this must not look
      // like a user action to the replay controller.
      const convId = readsLiveConvId(kind) ? currentConvId() : _activeConvId;
      chrome.runtime.sendMessage({
        // The conversation this specific action belonged to. Placed BEFORE the
        // spread so an event that captured its own id — the ai_response
        // listener, which records the conversation at the moment the request was
        // teed rather than when the stream finished, and session_bind, which is
        // about a specific id by definition — keeps it.
        external_conv_id: convId,
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
  // ── end conversation identity ─────────────────────────────────────────────
  // A SENTINEL, not decoration: tests/load-conv-identity.mjs slices the region
  // between this and the header above out of the shipped file and evaluates it,
  // so the conversation-stamping rules are tested against the code that ships
  // rather than a copy of it. The slice throws if either marker moves.

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

  // ── Model Routing ──────────────────────────────────────────────────
  let _skipRouting = false;

  // ── Smart Model Router — tier-based, works across all providers ──────
  //
  // Model hierarchy per provider:
  //   Premium  (expensive, most capable) → for complex tasks only
  //   Standard (balanced)                → for moderate tasks
  //   Economy  (cheap, fast)             → for simple tasks
  //
  // Routes BOTH directions:
  //   - Downgrade: user picks Opus for "hi" → routes to Haiku (save money)
  //   - Upgrade:   user picks Haiku for architecture design → routes to Sonnet (ensure quality)

  // Complexity classification lives in content/complexity.js (window.__cfaiComplexity).
  // It used to be two flat keyword regexes here with a character-length fallback,
  // which routed short-but-hard prompts ("what's our architecture for X") to the
  // cheapest model and bumped long-but-easy ones up a tier. See that file and
  // tests/complexity.test.mjs.
  function classifyComplexity(text) {
    const c = window.__cfaiComplexity;
    // Load-order failure: hold no opinion. 'moderate' leaves a premium model
    // alone rather than silently downgrading the user's choice on a bad load.
    if (!c) return 'moderate';
    try { return c.classify(text); } catch { return 'moderate'; }
  }

  // ── Model tier detection (Smart Model Router) ────────────────────────────

  /**
   * The model tiers each PLATFORM offers, keyed by host. Tier numbers match
   * TIER_NUM: 3 = premium, 2 = standard, 1 = economy. The string is the label to
   * look for in that platform's own model picker.
   *
   * WHY KEYED BY HOST AND NOT BY VENDOR. Tier detection used to be one ordered
   * keyword chain over the whole button text with no idea which site it was on,
   * and that cannot be extended past three vendors without cross-talk:
   *
   *   - 'mini' meant openai/economy, so Grok 3 mini read as OpenAI and the router
   *     would then hunt for "GPT-4o mini" in xAI's picker.
   *   - 'pro' meant google/premium, so Perplexity's "Sonar Pro" read as Google
   *     and it would hunt for Gemini's labels.
   *   - Perplexity and Poe PROXY other vendors ("Claude Sonnet", "GPT-4o"), so
   *     keyword matching attributes them to the wrong picker entirely.
   *
   * The host decides the vendor, so a label can never leak across platforms.
   * A host that is not listed keeps the old keyword-only behaviour, so nothing
   * that works today changes.
   */
  const PLATFORM_TIERS = {
    'claude.ai':            { vendor: 'anthropic',  3: 'Opus',     2: 'Sonnet',    1: 'Haiku' },
    'chatgpt.com':          { vendor: 'openai',     3: 'GPT-4',    2: 'GPT-4o',    1: 'GPT-4o mini' },
    'chat.openai.com':      { vendor: 'openai',     3: 'GPT-4',    2: 'GPT-4o',    1: 'GPT-4o mini' },
    'gemini.google.com':    { vendor: 'google',     3: 'Pro',      2: 'Thinking',  1: 'Flash' },
    'aistudio.google.com':  { vendor: 'google',     3: 'Pro',      2: 'Thinking',  1: 'Flash' },
    // Le Chat. 'chat.mistral.ai' is listed before the bare domain and matched by
    // longest key, so the app host wins over the marketing site.
    'chat.mistral.ai':      { vendor: 'mistral',    3: 'Large',    2: 'Medium',    1: 'Small' },
    'mistral.ai':           { vendor: 'mistral',    3: 'Large',    2: 'Medium',    1: 'Small' },
    'perplexity.ai':        { vendor: 'perplexity', 3: 'Research', 2: 'Sonar Pro', 1: 'Sonar' },
  };

  /** The PLATFORM_TIERS entry for a host — longest matching key wins. */
  function platformTiers(host) {
    const h = String(host || '').toLowerCase();
    if (!h) return null;
    let best = null, bestLen = 0;
    for (const key of Object.keys(PLATFORM_TIERS)) {
      if ((h === key || h.endsWith('.' + key) || h.includes(key)) && key.length > bestLen) {
        best = PLATFORM_TIERS[key];
        bestLen = key.length;
      }
    }
    return best;
  }

  // Local copy so this region stays evaluable ON ITS OWN — the tests slice it
  // out of the file and run it with no surrounding scope, which is the whole
  // reason nothing in here may reference a declaration further down the file.
  // Same values as TIER_NAME.
  const TIER_NAME_LOCAL = { 3: 'premium', 2: 'standard', 1: 'economy' };

  /**
   * Which of a platform's own tier labels the button text is showing.
   * LONGEST LABEL FIRST: Perplexity offers both "Sonar" and "Sonar Pro", and
   * matching the short one first would read Pro as economy.
   */
  function tierFromPlatformLabels(text, entry) {
    const t = String(text || '').toLowerCase();
    if (!t) return null;
    const byLen = [3, 2, 1]
      .filter((n) => entry[n])
      .sort((a, b) => String(entry[b]).length - String(entry[a]).length);
    for (const n of byLen) {
      if (t.includes(String(entry[n]).toLowerCase())) return TIER_NAME_LOCAL[n];
    }
    return null;
  }

  /**
   * Detect provider + tier from the model button text.
   *
   * `host` is OPTIONAL and additive: with it, the platform's own labels are
   * consulted first and the vendor comes from the host, which is what stops
   * label cross-talk. Without it the behaviour is exactly the historic
   * keyword chain — which is what keeps every existing caller and test valid.
   */
  function detectModelInfo(text, host) {
    const entry = host ? platformTiers(host) : null;
    if (entry) {
      const tier = tierFromPlatformLabels(text, entry);
      if (tier) return { provider: entry.vendor, tier };
      // A proxied model ("Claude Sonnet" inside Perplexity): take the TIER from
      // the keyword chain but keep the vendor from the host, so the label we
      // later click still comes from this platform's picker.
      const legacy = detectModelInfoByKeyword(text);
      if (legacy) return { provider: entry.vendor, tier: legacy.tier };
      return null;
    }
    return detectModelInfoByKeyword(text);
  }

  // Detect model tier from button text or model ID.
  // Handles current + future model names dynamically by keyword matching.
  function detectModelInfoByKeyword(text) {
    const t = (text || '').toLowerCase();

    // Anthropic — Fable and Opus are premium, Sonnet is standard, Haiku is economy
    if (t.includes('fable'))  return { provider: 'anthropic', tier: 'premium' };
    if (t.includes('opus'))   return { provider: 'anthropic', tier: 'premium' };
    if (t.includes('sonnet')) return { provider: 'anthropic', tier: 'standard' };
    if (t.includes('haiku'))  return { provider: 'anthropic', tier: 'economy' };

    // OpenAI — order matters: "mini" before "4o", "o1/o3/o4" are premium
    if (t.includes('mini') || t.includes('3.5') || t.includes('nano'))  return { provider: 'openai', tier: 'economy' };
    if (t.includes('4o') || t.includes('4.1'))                          return { provider: 'openai', tier: 'standard' };
    if (t.includes('gpt-4') || t.includes('gpt4'))                      return { provider: 'openai', tier: 'premium' };
    if (/\bo[1-9]/.test(t))                                             return { provider: 'openai', tier: 'premium' };
    // ChatGPT sometimes shows just "ChatGPT" with no version — treat as standard
    if (t.includes('chatgpt'))                                          return { provider: 'openai', tier: 'standard' };

    // Google — Gemini renamed its lineup from Flash/Pro/Ultra to Flash/Thinking/Pro
    // (confirmed against Google's own pricing/plan pages, 2026-08). "Thinking" is a
    // reasoning mode layered on Flash, priced close to Flash; "Pro" is now the
    // separate, priciest flagship gated behind a paid plan — so the tier order is
    // Flash (cheapest) < Thinking (middle) < Pro (priciest), not a straight rename.
    // "ultra" is kept as a legacy/back-compat match in case an older or
    // enterprise surface still shows it.
    if (t.includes('flash') || t.includes('lite'))  return { provider: 'google', tier: 'economy' };
    if (t.includes('thinking'))                     return { provider: 'google', tier: 'standard' };
    if (t.includes('pro'))                          return { provider: 'google', tier: 'premium' };
    if (t.includes('ultra'))                        return { provider: 'google', tier: 'premium' };

    return null;
  }
  // ── end model tier detection ─

  // Smart routing table: [provider][currentTier][complexity] → target
  // Uses UI DISPLAY NAMES (what the user sees in the dropdown), NOT API model IDs.
  // This way we don't need to know or hardcode API IDs — the app sends the right
  // one automatically when the dropdown changes.
  const ROUTE_TABLE = {
    anthropic: {
      premium: {  // Opus, Fable
        simple:   { uiName: 'Haiku',  reason: 'Simple prompt → Haiku (10x cheaper)' },
        moderate: { uiName: 'Sonnet', reason: 'Standard prompt → Sonnet (5x cheaper)' },
        complex:  null,
      },
      standard: { // Sonnet
        simple:   { uiName: 'Haiku',  reason: 'Simple prompt → Haiku (faster + cheaper)' },
        moderate: null,
        complex:  null,
      },
      economy: {  // Haiku
        simple:   null,
        moderate: null,
        complex:  { uiName: 'Sonnet', reason: 'Complex prompt → upgraded to Sonnet' },
      },
    },
    openai: {
      premium: {  // GPT-4, o1, o3
        simple:   { uiName: 'GPT-4o mini', reason: 'Simple prompt → GPT-4o mini (66x cheaper)' },
        moderate: { uiName: 'GPT-4o',      reason: 'Standard prompt → GPT-4o (balanced)' },
        complex:  null,
      },
      standard: { // GPT-4o
        simple:   { uiName: 'GPT-4o mini', reason: 'Simple prompt → GPT-4o mini (cheaper)' },
        moderate: null,
        complex:  null,
      },
      economy: {  // GPT-4o mini, GPT-3.5
        simple:   null,
        moderate: null,
        complex:  { uiName: 'GPT-4o',      reason: 'Complex prompt → upgraded to GPT-4o' },
      },
    },
    google: {
      premium: {  // Gemini Ultra/Pro
        simple:   { uiName: 'Flash',          reason: 'Simple prompt → Flash (fastest)' },
        moderate: { uiName: 'Flash',          reason: 'Standard prompt → Flash' },
        complex:  null,
      },
      standard: { // Gemini Pro
        simple:   { uiName: 'Flash',          reason: 'Simple prompt → Flash (faster)' },
        moderate: null,
        complex:  null,
      },
      economy: {  // Gemini Flash
        simple:   null,
        moderate: null,
        complex:  { uiName: 'Pro',            reason: 'Complex prompt → upgraded to Pro' },
      },
    },
  };

  // ── User ceiling tracking ──
  // The "ceiling" is what the user MANUALLY selected — the most expensive
  // model they're willing to pay for. We optimize within that ceiling.
  // When we change the model via routing, we DON'T update the ceiling.
  let _userCeiling = null;    // { provider, tier, modelText }
  let _weAreRouting = false;  // true while our code is changing the model

  const TIER_NUM = { premium: 3, standard: 2, economy: 1 };
  const TIER_NAME = { 3: 'premium', 2: 'standard', 1: 'economy' };

  // Maps provider + tier number → UI name to search for in dropdown
  const TIER_UI_NAME = {
    anthropic: { 3: 'Opus', 2: 'Sonnet', 1: 'Haiku' },
    openai:    { 3: 'GPT-4', 2: 'GPT-4o', 1: 'GPT-4o mini' },
    google:    { 3: 'Pro', 2: 'Thinking', 1: 'Flash' },
  };

  const TIER_REASON = {
    upgrade:   { 3: 'Complex prompt → premium model', 2: 'Complex prompt → upgraded for quality', 1: '' },
    downgrade: { 2: 'Standard prompt → balanced model', 1: 'Simple prompt → fastest & cheapest' },
  };

  /**
   * The label to click for a target tier on this host. The host-scoped table
   * wins; TIER_UI_NAME is the vendor-level fallback for a host that is not
   * listed, so unlisted platforms behave exactly as they did before.
   *
   * Lives OUTSIDE the model-tier-detection region on purpose: it reads
   * TIER_UI_NAME, which is declared here, and that region is sliced out and
   * executed standalone by tests/load-model-router.mjs — anything in there that
   * referenced a later declaration would break the loader.
   */
  function tierLabelFor(host, provider, tierNum) {
    const entry = platformTiers(host);
    if (entry && entry[tierNum]) return entry[tierNum];
    return (TIER_UI_NAME[provider] || {})[tierNum] || null;
  }

  // ── Admin routing rules (synced from the server) ─────────────────────────
  // The service worker has always written /api/v1/routing/rules into
  // chrome.storage under 'cfai.routing_rules' — and NOTHING read it. Every
  // rule an admin configured was dead on arrival, which is why routing
  // analytics attributed 1 of 252 routes to a rule_id. This is the reader.
  //
  // A rule only ever OVERRIDES the built-in choice, so an empty, unsynced or
  // unreachable rule set leaves the built-in behaviour intact rather than
  // disabling routing.
  let _serverRules = [];

  function applyServerRules(list) {
    _serverRules = Array.isArray(list)
      ? list.filter(r => r && r.enabled !== false)
            .sort((a, b) => (a.priority || 50) - (b.priority || 50))
      : [];
    if (_serverRules.length) console.info('[cfai] routing rules loaded:', _serverRules.length);
  }

  try {
    chrome.storage.local.get(['cfai.routing_rules'], (r) => applyServerRules(r['cfai.routing_rules']));
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes['cfai.routing_rules']) {
        applyServerRules(changes['cfai.routing_rules'].newValue);
      }
    });
  } catch (e) {
    // Extension context gone; built-in routing still works.
  }

  /**
   * First rule matching this provider + complexity (+ optional host), by
   * priority. An absent or empty condition array means "any", matching how the
   * server's own /routing/decide treats them.
   */
  function serverRuleFor(provider, complexity, host) {
    const anyOf = (arr, v) => !Array.isArray(arr) || arr.length === 0 || arr.includes(v);
    for (const r of _serverRules) {
      const c = r.conditions || {};
      if (!anyOf(c.provider, provider)) continue;
      if (!anyOf(c.complexity, complexity)) continue;
      if (Array.isArray(c.host) && c.host.length
          && !c.host.some(h => String(host || '').includes(h))) continue;
      return r;
    }
    return null;
  }

  // Load persisted ceiling from chrome.storage (survives extension refresh)
  try {
    chrome.storage.local.get('cfai.user_ceiling', (data) => {
      if (data['cfai.user_ceiling']) {
        _userCeiling = data['cfai.user_ceiling'];
        console.info('[cfai] ceiling restored:', _userCeiling.modelText, '→', _userCeiling.tier);
      }
    });
  } catch {}

  function updateUserCeiling() {
    if (_weAreRouting) return;
    const btn = getModelButton();
    if (!btn) return;
    const text = (btn.textContent || '').trim();
    const info = detectModelInfo(text);
    if (!info) return;
    const newTierNum = TIER_NUM[info.tier] || 2;
    const oldTierNum = _userCeiling ? (TIER_NUM[_userCeiling.tier] || 2) : 0;

    // Only update ceiling if user manually selected a HIGHER tier model.
    // This prevents our own downgrades from lowering the ceiling.
    if (newTierNum > oldTierNum || !_userCeiling || _userCeiling.provider !== info.provider) {
      _userCeiling = { ...info, modelText: text };
      console.info('[cfai] user ceiling updated:', text, '→', info.tier);
      try { chrome.storage.local.set({ 'cfai.user_ceiling': _userCeiling }); } catch {}
    }
  }

  // Check for manual model changes every 2s
  setInterval(updateUserCeiling, 2000);
  // Initial detection
  setTimeout(updateUserCeiling, 1000);

  function smartRoute(currentModelText, promptText) {
    // Host is passed so the platform's own tier labels are used and the vendor
    // comes from the site, not from a keyword that might belong to someone else.
    const host = (typeof window !== 'undefined' && window.location) ? window.location.hostname : '';
    const current = detectModelInfo(currentModelText, host);
    if (!current) return null;

    // Set ceiling on first detection if not set
    if (!_userCeiling) {
      _userCeiling = { ...current, modelText: currentModelText };
    }

    // If ceiling is for a different provider or not set, use standard as default ceiling
    const ceiling = (_userCeiling && _userCeiling.provider === current.provider)
      ? _userCeiling
      : { ...current, tier: 'standard' };  // assume standard ceiling if unknown

    const complexity = classifyComplexity(promptText);
    const ceilingNum = TIER_NUM[ceiling.tier] || 2;
    const currentNum = TIER_NUM[current.tier] || 2;

    // Determine target tier based on complexity
    let targetNum;
    if (complexity === 'simple') {
      targetNum = 1;  // economy — cheapest
    } else if (complexity === 'complex') {
      // Complex prompts ALWAYS get at least standard (tier 2).
      // If user's ceiling is higher, use that.
      targetNum = Math.max(ceilingNum, 2);
    } else {
      // moderate → standard tier
      targetNum = 2;
    }

    // Cap at ceiling (don't exceed what user is willing to pay)
    if (complexity !== 'complex') {
      targetNum = Math.min(targetNum, Math.max(ceilingNum, 2));
    }

    // Already at the right tier?
    if (targetNum === currentNum) return null;

    const targetTierName = TIER_NAME[targetNum];

    // An admin rule wins over the built-in label, so a platform that renames a
    // tier can be corrected from the dashboard instead of by shipping a new
    // extension. `action.ui_name` is what gets clicked; `action.model` is the API
    // id used by the fetch-blocker path (see dispatchRouteModel), and the two are
    // deliberately separate — a model id is not a picker label.
    const rule = serverRuleFor(current.provider, complexity, host);
    const uiName = (rule && rule.action && rule.action.ui_name)
      || tierLabelFor(host, current.provider, targetNum);
    if (!uiName) return null;

    const direction = targetNum < currentNum ? 'downgrade' : 'upgrade';
    const reason = (rule && rule.name)
      || (direction === 'downgrade'
        ? (TIER_REASON.downgrade[targetNum] || 'Optimized for this prompt')
        : (TIER_REASON.upgrade[targetNum] || 'Upgraded for quality'));

    return {
      model: uiName,
      uiName,
      apiModel: (rule && rule.action && rule.action.model) || null,
      rule_id: (rule && rule.id) || null,
      rule_name: reason,
      complexity,
      currentTier: current.tier,
      targetTier: targetTierName,
      provider: current.provider,
    };
  }

  // Tell fetch-blocker (page context) to rewrite the model on next API call.
  // This is the RELIABLE backup — always works regardless of UI changes.
  function dispatchRouteModel(model, ruleName) {
    document.dispatchEvent(new CustomEvent('cfai-route-model', {
      detail: { model, rule_name: ruleName },
    }));
  }

  document.addEventListener('cfai-route-applied', (e) => {
    console.info('[cfai] fetch-level route applied:', e.detail?.from, '→', e.detail?.to);
  });

  // ── Adaptive Model Selector — learns the DOM once, reuses, re-learns if stale ──
  // Cache stores the button element. If it's detached, we re-scan.
  let _modelBtnCache = null;

  // Keywords that indicate a model selector button — covers all major AI platforms
  const MODEL_KEYWORDS = [
    // Anthropic
    'Opus', 'Sonnet', 'Haiku', 'Fable',
    // OpenAI
    'GPT-4', 'GPT-3', 'ChatGPT', 'o1', 'o3', 'o4',
    // Google
    'Gemini', 'Flash', 'Ultra', 'Thinking',
    // Microsoft
    'Copilot',
    // Other
    'Mistral', 'Llama', 'Command',
  ];

  // Platform-specific selectors — checked first before generic keyword search
  const PLATFORM_BUTTON_SELECTORS = {
    'chatgpt.com':     '[data-testid="model-switcher"], button[aria-label*="Model"], [class*="model-switcher"]',
    'chat.openai.com': '[data-testid="model-switcher"], button[aria-label*="Model"], [class*="model-switcher"]',
    'gemini.google.com': 'button[aria-label*="model" i], [class*="model-selector"], [data-model-selector]',
  };

  function findModelButton() {
    const host = window.location.hostname;

    // Try platform-specific selectors first
    for (const [domain, selector] of Object.entries(PLATFORM_BUTTON_SELECTORS)) {
      if (host.includes(domain.replace('www.', ''))) {
        const el = document.querySelector(selector);
        if (el) {
          _modelBtnCache = el;
          console.info('[cfai] model button found via platform selector:', (el.textContent || '').trim().slice(0, 40));
          return el;
        }
      }
    }

    // Generic keyword search — works on any AI platform
    for (const el of document.querySelectorAll('button, [role="button"], [role="combobox"], [role="listbox"]')) {
      const t = (el.textContent || '').trim();
      if (t.length > 100 || t.length < 2) continue;
      if (MODEL_KEYWORDS.some(k => t.includes(k))) {
        _modelBtnCache = el;
        console.info('[cfai] model button discovered:', t);
        return el;
      }
    }
    return null;
  }

  function getModelButton() {
    // Use cache if element still in DOM
    if (_modelBtnCache && _modelBtnCache.isConnected) return _modelBtnCache;
    // Cache stale — re-scan
    _modelBtnCache = null;
    return findModelButton();
  }

  // ── Model-menu option lookup ─────────────────────────────────────────────
  // Containers a model dropdown actually renders into. `.mat-mdc-menu-panel` is
  // Angular Material, which is what Gemini is built on; the rest are the
  // standard roles every other platform uses.
  const MENU_CONTAINER_SELECTOR =
    '[role="menu"], [role="listbox"], [role="dialog"], [popover], .mat-mdc-menu-panel';

  // Rendered and hittable. Deliberately fail-OPEN: a node is only rejected when
  // the DOM actively says it is hidden, so an unusual host page (or a minimal
  // test double) is never wrongly skipped.
  function isVisibleEl(el) {
    if (!el || el.nodeType !== 1) return false;
    if (typeof el.getAttribute === 'function') {
      if (el.getAttribute('aria-hidden') === 'true') return false;
      if (el.getAttribute('hidden') !== null) return false;
    }
    if (typeof el.hasAttribute === 'function' && el.hasAttribute('inert')) return false;
    if (typeof el.getClientRects === 'function') {
      const rects = el.getClientRects();
      if (rects && rects.length === 0) return false;
    }
    if (typeof el.getBoundingClientRect === 'function') {
      const r = el.getBoundingClientRect();
      if (r && (r.width === 0 || r.height === 0)) return false;
    }
    return true;
  }

  // Shortest text containing `text` inside one scope = the most specific element.
  function pickShortestMatch(scope, text, exclude) {
    let best = null;
    let bestLen = Infinity;
    for (const el of scope.querySelectorAll('*')) {
      if (el === exclude) continue;                 // never re-click the trigger
      if (el.children.length > 10) continue;
      const t = (el.textContent || '').trim();
      if (t.length > 100 || t.length < 2) continue;
      if (!t.includes(text)) continue;
      if (!isVisibleEl(el)) continue;
      if (t.length < bestLen) { best = el; bestLen = t.length; }
    }
    return best;
  }

  /**
   * Find the clickable element for a model option.
   *
   * OPEN MENUS ARE SEARCHED FIRST, and this is the whole point rather than an
   * optimisation. The old version scanned the entire document and took the
   * shortest text match anywhere on the page — which is wrong precisely on
   * Gemini, whose target tier is literally named "Thinking" and which ALSO
   * renders "Thinking" as a generation status while a reply streams. The status
   * label is shorter than the menu row, so it won the shortest-match contest,
   * got clicked, and nothing changed: 9 of 10 Gemini routings reported
   * ui_changed:false while Claude managed 34 of 34.
   *
   * Invisible nodes are skipped for the same reason — a collapsed menu still has
   * its rows in the DOM.
   *
   * The whole-document pass is kept as a fallback so platforms that render their
   * picker without any of the standard roles still work.
   */
  function findClickableByText(text, opts) {
    const exclude = (opts && opts.exclude) || null;
    for (const menu of document.querySelectorAll(MENU_CONTAINER_SELECTOR)) {
      if (!isVisibleEl(menu)) continue;
      const hit = pickShortestMatch(menu, text, exclude);
      if (hit) return hit;
    }
    return pickShortestMatch(document, text, exclude);
  }

  // Poll instead of sleeping a fixed 400ms. A menu that renders in 50ms no longer
  // costs 400, and one that takes 900 no longer reports failure.
  async function waitForEl(get, timeoutMs, stepMs) {
    const deadline = Date.now() + (timeoutMs || 1500);
    for (;;) {
      const v = get();
      if (v) return v;
      if (Date.now() >= deadline) return null;
      await new Promise(r => setTimeout(r, stepMs || 100));
    }
  }

  // What the open menu is actually offering, for the failure log. Without this a
  // failed switch says only "not found" and the next debugging step is guesswork.
  function visibleMenuOptions() {
    const out = [];
    for (const menu of document.querySelectorAll(MENU_CONTAINER_SELECTOR)) {
      if (!isVisibleEl(menu)) continue;
      for (const el of menu.querySelectorAll('[role="option"], [role="menuitem"], [role="menuitemradio"], button, li')) {
        if (!isVisibleEl(el)) continue;
        const t = (el.textContent || '').trim();
        if (t && t.length < 80 && !out.includes(t)) out.push(t);
      }
    }
    return out;
  }
  // ── end model-menu option lookup ─

  async function changeModelInUI(targetModelId) {
    const btn = getModelButton();
    if (!btn) { console.warn('[cfai] model button not found'); return false; }

    const btnText = (btn.textContent || '').trim();
    const targetText = targetModelId;

    // Already on target model?
    if (btnText.includes(targetText)) return true;

    // Step 1: Click model button to open dropdown
    console.info('[cfai] step 1: clicking model button');
    btn.click();

    // Step 2: Search for target model — try multiple strategies.
    // `exclude: btn` on every lookup: the trigger button's own label contains a
    // model name, so it is itself a tempting shortest-match and clicking it just
    // closes the menu again.
    let targetEl = await waitForEl(() => findClickableByText(targetText, { exclude: btn }));

    if (!targetEl) {
      // Strategy A: look for "More models" sub-menu (Claude pattern)
      const moreEl = findClickableByText('More models', { exclude: btn });
      if (moreEl) {
        console.info('[cfai] step 2a: clicking "More models"');
        moreEl.click();
        targetEl = await waitForEl(() => findClickableByText(targetText, { exclude: btn }));
      }
    }

    if (!targetEl) {
      // Strategy B: look for "See all models" or "Show all" (ChatGPT/other patterns)
      for (const altText of ['See all', 'Show all', 'All models', 'More', 'View all']) {
        const altEl = findClickableByText(altText, { exclude: btn });
        if (altEl) {
          console.info('[cfai] step 2b: clicking "' + altText + '"');
          altEl.click();
          targetEl = await waitForEl(() => findClickableByText(targetText, { exclude: btn }));
          if (targetEl) break;
        }
      }
    }

    if (!targetEl) {
      // Strategy C: look in any open popover/menu/dialog by role
      for (const el of document.querySelectorAll('[role="option"], [role="menuitem"], [role="menuitemradio"], [role="listbox"] *')) {
        const t = (el.textContent || '').trim();
        if (t.includes(targetText) && t.length < 80) {
          targetEl = el;
          console.info('[cfai] step 2c: found via role selector');
          break;
        }
      }
    }

    if (targetEl) {
      console.info('[cfai] clicking target:', (targetEl.textContent || '').trim().slice(0, 40));
      targetEl.click();
    } else {
      // Name what the menu DID offer. "not found" alone cannot distinguish a
      // stale selector, a renamed tier, or a menu that never opened — and those
      // need three different fixes.
      const offered = visibleMenuOptions();
      console.warn('[cfai] target "' + targetText + '" not found in any dropdown; '
        + (offered.length
          ? 'open menu offered: ' + offered.join(' | ')
          : 'no open menu found — the model button click did not open a picker'));
      // Close any open menus
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await new Promise(r => setTimeout(r, 100));
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return false;
    }

    // Verify
    await new Promise(r => setTimeout(r, 400));
    _modelBtnCache = null;
    const newBtn = findModelButton();
    const newText = newBtn ? (newBtn.textContent || '').trim() : '';
    if (newText.includes(targetText)) {
      console.info('[cfai] ✓ model changed:', btnText, '→', newText);
      return true;
    }

    console.info('[cfai] click done, button now shows:', newText);
    return newText !== btnText;
  }

  function showRoutingToast(fromModel, toModel, ruleName) {
    const old = document.getElementById('cfai-routing-toast');
    if (old) old.remove();
    const d = document.createElement('div');
    d.id = 'cfai-routing-toast';
    d.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:2147483647;background:#0044cc;color:#fff;padding:12px 18px;border-radius:10px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;font-size:13px;box-shadow:0 4px 16px rgba(0,0,0,0.2);max-width:350px;animation:cfai-fade-in .2s ease-out;';
    const f = (fromModel || '').replace(/claude-/i,'').replace(/-\d{8}$/,'');
    const t = (toModel || '').replace(/claude-/i,'').replace(/-\d{8}$/,'');

    // BUILT WITH DOM NODES, NOT innerHTML. `fromModel` is read straight off the
    // AI site's own model-picker button, so it is page-controlled text: an
    // innerHTML concatenation let any of these sites inject markup into our own
    // governance toast. `ruleName` comes from the server, but an admin types it,
    // so it is not trusted markup either. textContent everywhere.
    const line = (text, css) => {
      const el = document.createElement('div');
      if (css) el.style.cssText = css;
      el.textContent = text;
      return el;
    };

    d.appendChild(line('⚡ Model Routed', 'font-weight:700;margin-bottom:4px'));

    const swap = document.createElement('div');
    swap.appendChild(document.createTextNode(f + ' → '));
    const strong = document.createElement('strong');
    strong.textContent = t;
    swap.appendChild(strong);
    d.appendChild(swap);

    d.appendChild(line('Rule: ' + (ruleName || ''), 'font-size:11px;opacity:0.8;margin-top:4px'));
    d.appendChild(line('CloudFuze AI Governance', 'font-size:10px;opacity:0.6;margin-top:2px'));

    document.documentElement.appendChild(d);
    setTimeout(() => { try { d.remove(); } catch {} }, 5000);
  }

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
    // Pasting into an ordinary compose box on an embedded-AI host is not an AI
    // action. Checked here rather than only in emit() because the element is
    // known at this point, so containment can be enforced precisely.
    if (!captureAllowed(el)) return;
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
    // Attaching a file to an email or a ticket is not an AI upload. Without this
    // gate, every attachment on a governed SaaS host was scanned and recorded.
    if (!captureAllowed(t)) return;

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
    // Same rule as the file picker: a file dropped onto the mail composer is not
    // an AI upload. e.target is the drop target, which is what must be inside the
    // AI panel for this to count.
    if (!captureAllowed(e.target)) return;

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
    if (btn.querySelector('svg') && btn.closest('form, [class*="composer" i], [class*="input-area" i], [class*="prompt" i], [class*="chat-input" i]')) {
      // Skip if it looks like a mic/media button (check svg content for mic-like paths)
      const svgHtml = (btn.querySelector('svg')?.innerHTML || '').toLowerCase();
      if (/microphone|mic-|record|m12.*v6.*a6/i.test(svgHtml)) return false;
      return true;
    }
    // Also match by proximity — any button right next to a textarea/contenteditable
    const sibling = btn.previousElementSibling || btn.parentElement;
    if (sibling && (sibling.querySelector?.('textarea, [contenteditable="true"], [role="textbox"]'))) return true;
    return false;
  }

  function scanForBlockers(text) {
    if (!text || text.length < 4) return null;
    let matches = scan(text).filter((m) => BLOCK_SEVERITIES.has(m.severity));
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
          `<span class="cfai-tag cfai-${m.severity}"${m.class ? ' data-class="' + escapeHtml(m.class) + '"' : ''}>${escapeHtml(m.pattern)}${m.count > 1 ? ' &times;' + m.count : ''}</span>`
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
        const requestBtn = opts.requestAccess
          ? '<button type="button" class="cfai-block-request" style="appearance:none;border:0;background:#0044cc;color:#fff;font-size:13px;font-weight:600;padding:9px 22px;border-radius:8px;cursor:pointer;margin-right:8px;">Request Access</button>'
          : '';
        actionsHtml = '<div class="cfai-block-actions">' + requestBtn + '<button type="button" class="cfai-block-dismiss">Got it</button></div>';
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

      // Request Access button (platform block, no sensitive matches) — shows an
      // inline form and submits to the server. Only rendered by actionsHtml
      // when !hasSensitiveMatches && opts.requestAccess, so this is a no-op
      // for the redaction/tokenize path above.
      if (!hasSensitiveMatches) {
        const requestBtn = ui.querySelector('.cfai-block-request');
        if (requestBtn && opts.requestAccess) {
          requestBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            // Replace button with inline form
            const actionsDiv = ui.querySelector('.cfai-block-actions');
            if (actionsDiv) {
              actionsDiv.innerHTML = `
                <div style="width:100%;text-align:left;">
                  <div style="font-size:13px;font-weight:600;margin-bottom:6px;">Why do you need access?</div>
                  <textarea id="cfai-request-reason" placeholder="Briefly describe your use case..." style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;resize:vertical;min-height:60px;box-sizing:border-box;font-family:inherit;"></textarea>
                  <div style="display:flex;gap:8px;margin-top:8px;justify-content:flex-end;">
                    <button type="button" class="cfai-block-dismiss" style="appearance:none;border:1px solid #e2e8f0;background:#fff;color:#475569;font-size:13px;padding:7px 16px;border-radius:8px;cursor:pointer;">Cancel</button>
                    <button type="button" id="cfai-submit-request" style="appearance:none;border:0;background:#0044cc;color:#fff;font-size:13px;font-weight:600;padding:7px 16px;border-radius:8px;cursor:pointer;">Submit Request</button>
                  </div>
                </div>
              `;
              // Cancel button
              actionsDiv.querySelector('.cfai-block-dismiss').addEventListener('click', (e) => { e.stopPropagation(); close(); });
              // Submit button
              actionsDiv.querySelector('#cfai-submit-request').addEventListener('click', async (e) => {
                e.stopPropagation();
                const reason = (ui.querySelector('#cfai-request-reason')?.value || '').trim();
                const submitBtn = actionsDiv.querySelector('#cfai-submit-request');
                submitBtn.textContent = 'Submitting...';
                submitBtn.disabled = true;
                try {
                  // Route through service worker to avoid mixed-content blocks
                  const result = await new Promise((resolve, reject) => {
                    try {
                      chrome.runtime.sendMessage({
                        kind: 'access_request',
                        tool_host: opts.requestAccess.tool_host,
                        tool_name: opts.requestAccess.tool_name,
                        tool_vendor: opts.requestAccess.tool_vendor,
                        reason,
                      }, (response) => {
                        if (chrome.runtime.lastError) {
                          const msg = chrome.runtime.lastError.message || '';
                          if (msg.includes('invalidated') || msg.includes('Receiving end does not exist')) {
                            // Extension was reloaded — refresh page to load new content script
                            window.location.reload();
                            return;
                          }
                          reject(new Error(msg));
                        }
                        else if (response?.error) reject(new Error(response.error));
                        else resolve(response);
                      });
                    } catch (e) {
                      if (e.message?.includes('invalidated')) { window.location.reload(); return; }
                      reject(e);
                    }
                  });
                  actionsDiv.innerHTML = '<div style="text-align:center;padding:12px;color:#22c55e;font-weight:600;">✓ Request submitted! Your admin will review it.</div>';
                } catch (err) {
                  let msg;
                  if (err.message?.includes('invalidated') || err.message?.includes('Receiving end')) {
                    window.location.reload(); return;
                  } else if (err.message?.includes('pending')) msg = 'You already have a pending request for this tool.';
                  else if (err.message?.includes('fetch') || err.message?.includes('NetworkError') || err.message?.includes('Failed')) msg = 'Cannot reach the governance server. Please check your network connection or contact IT.';
                  else if (err.message?.includes('Not configured')) msg = 'Extension is not configured yet. Open extension settings and enter the server URL.';
                  else msg = 'Something went wrong. Please try again or contact your administrator.';
                  actionsDiv.innerHTML = '<div style="text-align:center;padding:12px;color:#ef4444;">' + escapeHtml(msg) + '</div><div style="text-align:center;margin-top:8px;"><button type="button" class="cfai-block-dismiss" style="appearance:none;border:1px solid #e2e8f0;background:#fff;color:#475569;font-size:13px;padding:7px 16px;border-radius:8px;cursor:pointer;">Close</button></div>';
                  actionsDiv.querySelector('.cfai-block-dismiss')?.addEventListener('click', (e) => { e.stopPropagation(); close(); });
                }
              });
              // Stop keyboard events from leaking to the AI tool's input behind the popup
              const reasonEl = ui.querySelector('#cfai-request-reason');
              if (reasonEl) {
                for (const evt of ['keydown','keyup','keypress','input']) {
                  reasonEl.addEventListener(evt, e => e.stopPropagation());
                }
                setTimeout(() => reasonEl.focus(), 0);
              }
            }
          });
        }
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
      // Paste didn't work — try execCommand('insertText') which goes through
      // the browser's editing API. Most modern editors (including Gemini's)
      // hook into this, unlike raw textContent which bypasses the model.
      selectAllIn(el);
      await nextTick(0);
      execInsertText(text);
      await afterFrame();
      if (check('execCommand (framework)', true).ok) return succeed('execCommand (framework)');
      return fail('this composer is a ' + framework + ' editor — paste and execCommand both failed');
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
    // Claude.ai and similar sites: clicking the send button is unreliable because
    // the mic/voice button sits right next to send and gets picked before React
    // enables the real send button. Enter keydown is the universal send trigger
    // that works on every site — use it directly instead of hunting for a button.
    setTimeout(() => {
      simulateSend(el);
    }, 300);

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
    const DECOY = /attach|upload|file|image|photo|camera|mic|voice|dictate|speech|audio|record|stop|cancel|close|menu|model|setting|emoji|search|new chat|history|sidebar|microphone/;
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
  // Includes "Request Access" button so employees can ask for temporary access.
  function showPlatformBlockPopup() {
    if (existingCfaiModal()) return;
    const platformInfo = BLOCKED_PLATFORM || {};
    const name = platformInfo.product || platformInfo.vendor || platformInfo.host || 'This AI platform';
    const host = window.location.hostname;

    showCfaiPopup({
      title: `${name} is blocked`,
      body:  'CloudFuze AI Governance has disallowed this AI platform for your organization. Prompts cannot be sent here.',
      matches: [],
      hint:  'Need access? Click below to submit a request to your administrator.',
      hardBlock: true,
      requestAccess: {
        tool_host: host,
        tool_name: name,
        tool_vendor: platformInfo.vendor || null,
      },
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
    // Pick title/body based on whether it's a guardrail or DLP violation
    const hasGuardrail = matches.some(m => m.class === 'guardrail');
    const hasDlp = matches.some(m => m.class !== 'guardrail');
    let title, body;
    if (hasGuardrail && !hasDlp) {
      title = 'Unsafe prompt blocked';
      body = 'CloudFuze AI Governance blocked this message because it contains a security or safety violation:';
    } else if (hasGuardrail && hasDlp) {
      title = "This prompt can't be sent";
      body = 'CloudFuze AI Governance blocked this message — it contains sensitive data and a safety violation:';
    } else {
      title = "This prompt can't be sent";
      body = 'CloudFuze AI Governance blocked this message because it contains sensitive data:';
    }
    showCfaiPopup({
      title, body, matches,
      // Tokenize & Send only ever appears (via actionsHtml/redaction) when there
      // is DLP content to mask — a pure guardrail violation (jailbreak, toxicity,
      // etc.) has nothing to tokenize, so its hint stays the plain removal
      // instruction rather than describing a button that won't render.
      hint: hasDlp
        ? 'Tokenize &amp; Send replaces each detected value with a fixed label such as [SSN] before sending. The original values are never sent, and cannot be recovered from the label.'
        : 'Remove the flagged content from your prompt to continue.',
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
    // Sending an ordinary email, ticket reply or CRM note on an embedded-AI host
    // is not a prompt. Returning false leaves the site's own send path completely
    // untouched — the user must not be blocked from doing their job.
    if (!captureAllowed(el)) return false;
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
      // ── Model Routing ──
      // 1. Try to change the model in the UI (visible to user)
      // 2. Always set fetch-blocker backup (guarantees the API call uses the right model)
      // 3. Pause the send → change model → re-send
      if (!_skipRouting) {
        const currentModelText = (getModelButton()?.textContent || '').trim();
        const routing = smartRoute(currentModelText, text);
        if (routing) {
          // PAUSE the send
          if (e) { e.preventDefault(); e.stopImmediatePropagation(); if (typeof e.stopPropagation === 'function') e.stopPropagation(); }
          console.info('[cfai] SMART ROUTE:', currentModelText, '→', routing.uiName, '(' + routing.rule_name + ')');

          // Set fetch-blocker backup (always works even if DOM change fails)
          dispatchRouteModel(routing.model, routing.rule_name);

          // Try DOM change, then re-send regardless
          _weAreRouting = true;
          changeModelInUI(routing.model).then((uiChanged) => {
            _weAreRouting = false;
            showRoutingToast(currentModelText, routing.uiName, routing.rule_name);
            emit({
              kind: 'model_routed',
              mechanism: 'browser_extension',
              routed_model: routing.model,
              routed_ui_name: routing.uiName,
              rule_name: routing.rule_name,
              complexity: routing.complexity,
              current_tier: routing.currentTier,
              provider: routing.provider,
              content_length: text.length,
              ui_changed: uiChanged,
            });

            // Re-trigger the send
            _skipRouting = true;
            setTimeout(() => {
              const target = (el && el.isConnected) ? el : findActivePromptInput();
              if (target) {
                target.dispatchEvent(new KeyboardEvent('keydown', {
                  key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
                  bubbles: true, cancelable: true,
                }));
              }
              setTimeout(() => { _skipRouting = false; }, 500);
            }, 200);
          });
          return true;
        }
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
    // scanForBlockers only reports high/critical matches (BLOCK_SEVERITIES) —
    // anything below that threshold is invisible here, not "handled elsewhere".
    // There is no separate tokenize-only pattern class today: every match the
    // block modal shows can be sent via "Tokenize & Send", which reuses this
    // same scan.
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
    // scanForBlockers only matches high/critical severity (BLOCK_SEVERITIES).
    // A match below that threshold is simply never flagged here — the
    // fetch-blocker does not pick up any slack for it.
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
        // The conversation the user last actually DID something in. Not a live
        // URL read: that is what keeps clicking through old chats from starting
        // a recording per chat, with no timer involved. See the note on
        // _activeConvId in the conversation-identity region.
        getConversationId: activeConvIdCached,
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

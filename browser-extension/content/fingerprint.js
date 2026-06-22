// AI page fingerprinter — runs on every page.
//
// Cheap DOM + network heuristic that decides whether the page looks like an
// AI tool. If "definitely not AI", does nothing (zero cost). If "definitely
// AI" or "ambiguous", sends metadata to the service-worker which asks the
// server's classifier ("/api/v1/classify-host"). The classifier verdict
// becomes the policy across the whole fleet.
//
// PRIVACY: this file is the chokepoint where metadata about the page leaves
// the user's machine. Send NOTHING except whitelisted fields below — no
// prompt text, no response text, no input values, no DOM body content. If
// you add a new signal, route it through the explicit signal-builder
// helpers, not raw DOM scrapes.
//
// PERFORMANCE: runs at document_idle (manifest setting). The initial check
// is O(few DOM queries). A MutationObserver watches for chat-like UIs being
// rendered after page load (SPAs). Both are debounced so we ask the
// classifier at most ONCE per page.

(function () {
  'use strict';

  // Guard: don't re-run in iframes (parent handles classification for the URL).
  if (window.top !== window) return;
  // Guard: skip non-http(s) schemes — extension pages, chrome://, etc.
  if (!/^https?:$/.test(location.protocol)) return;

  const host = location.hostname;
  const FINGERPRINTED_KEY = `__cfai_fingerprinted__${host}`;
  // Per-tab guard so we don't ping the server repeatedly on SPA navigation.
  if (window[FINGERPRINTED_KEY]) return;

  // -----------------------------------------------------------------
  // KNOWN_SAAS_WITH_AI — fallback list used only if chrome.storage hasn't
  // been populated yet (first install, service worker never refreshed).
  //
  // The CANONICAL list now lives server-side in the ai_platforms table
  // and is fetched by the service worker into chrome.storage.local under
  // 'cfai.platforms'. We consult storage FIRST; this hardcoded fallback
  // is just the first-run safety net.
  //
  // To add/remove platforms, use the dashboard at #/ai-platforms — DO NOT
  // edit this list. New deploys still need it for the brief window before
  // the first registry refresh completes.
  // -----------------------------------------------------------------
  const FALLBACK_SAAS_WITH_AI = [
    // Microsoft 365 Copilot (Word/Excel/PowerPoint/Outlook online)
    { host: 'office.com',            vendor: 'Microsoft',  product: 'Microsoft 365 Copilot', category: 'ide-assistant' },
    { host: 'office365.com',         vendor: 'Microsoft',  product: 'Microsoft 365 Copilot', category: 'ide-assistant' },
    { host: 'outlook.office.com',    vendor: 'Microsoft',  product: 'Outlook Copilot',       category: 'chat-frontend' },
    { host: 'outlook.office365.com', vendor: 'Microsoft',  product: 'Outlook Copilot',       category: 'chat-frontend' },
    { host: 'outlook.live.com',      vendor: 'Microsoft',  product: 'Outlook Copilot',       category: 'chat-frontend' },
    { host: 'sharepoint.com',        vendor: 'Microsoft',  product: 'SharePoint Copilot',    category: 'ide-assistant' },
    { host: 'teams.microsoft.com',   vendor: 'Microsoft',  product: 'Teams Copilot',         category: 'chat-frontend' },
    // Google
    { host: 'mail.google.com',       vendor: 'Google',     product: 'Gemini in Gmail',       category: 'chat-frontend' },
    { host: 'docs.google.com',       vendor: 'Google',     product: 'Gemini in Docs',        category: 'ide-assistant' },
    { host: 'meet.google.com',       vendor: 'Google',     product: 'Gemini in Meet',        category: 'chat-frontend' },
    // Productivity SaaS with first-class AI features
    { host: 'slack.com',             vendor: 'Slack',      product: 'Slack AI',              category: 'chat-frontend' },
    { host: 'notion.so',             vendor: 'Notion',     product: 'Notion AI',             category: 'ide-assistant' },
    { host: 'notion.site',           vendor: 'Notion',     product: 'Notion AI',             category: 'ide-assistant' },
    { host: 'linear.app',            vendor: 'Linear',     product: 'Linear AI',             category: 'ide-assistant' },
    { host: 'atlassian.net',         vendor: 'Atlassian',  product: 'Atlassian Intelligence', category: 'ide-assistant' },
    { host: 'atlassian.com',         vendor: 'Atlassian',  product: 'Atlassian Intelligence', category: 'ide-assistant' },
    { host: 'asana.com',             vendor: 'Asana',      product: 'Asana AI',              category: 'ide-assistant' },
    { host: 'monday.com',            vendor: 'monday.com', product: 'monday AI',             category: 'ide-assistant' },
    { host: 'clickup.com',           vendor: 'ClickUp',    product: 'ClickUp Brain',         category: 'ide-assistant' },
    { host: 'app.clickup.com',       vendor: 'ClickUp',    product: 'ClickUp Brain',         category: 'ide-assistant' },
    { host: 'canva.com',             vendor: 'Canva',      product: 'Magic Studio',          category: 'ide-assistant' },
    { host: 'figma.com',             vendor: 'Figma',      product: 'Figma AI',              category: 'ide-assistant' },
    { host: 'miro.com',              vendor: 'Miro',       product: 'Miro AI',               category: 'ide-assistant' },
    // Code hosting with embedded AI
    { host: 'github.com',            vendor: 'GitHub',     product: 'GitHub Copilot Chat',   category: 'ide-assistant' },
    { host: 'gitlab.com',            vendor: 'GitLab',     product: 'GitLab Duo',            category: 'ide-assistant' },
    // CRM with embedded AI
    { host: 'lightning.force.com',   vendor: 'Salesforce', product: 'Einstein / Agentforce', category: 'ide-assistant' },
    { host: 'salesforce.com',        vendor: 'Salesforce', product: 'Einstein / Agentforce', category: 'ide-assistant' },
    { host: 'hubspot.com',           vendor: 'HubSpot',    product: 'HubSpot AI',            category: 'ide-assistant' },
  ];

  // Cached registry (loaded async on script start). Until the async load
  // completes we fall back to FALLBACK_SAAS_WITH_AI so first-run users
  // aren't ungoverned on the most common SaaS apps.
  let _platformsCache = null;

  async function loadPlatforms() {
    try {
      const obj = await chrome.storage.local.get(['cfai.platforms']);
      const fromServer = obj['cfai.platforms'];
      if (Array.isArray(fromServer) && fromServer.length > 0) {
        _platformsCache = fromServer;
        return;
      }
    } catch { /* extension context lost — fall through to fallback */ }
    _platformsCache = FALLBACK_SAAS_WITH_AI;
  }

  function matchesKnownSaas(h) {
    if (!h) return null;
    const lh = h.toLowerCase();
    // Until the cache loads, use the hardcoded list directly. After load,
    // the cache may be either the server list OR the fallback (same shape).
    const list = _platformsCache || FALLBACK_SAAS_WITH_AI;
    for (const entry of list) {
      if (!entry?.host) continue;
      if (lh === entry.host || lh.endsWith('.' + entry.host)) return entry;
    }
    return null;
  }

  // -----------------------------------------------------------------
  // AI-affordance click detector — for SaaS apps we haven't allowlisted,
  // catch the moment a user activates an AI feature (clicks "Ask AI",
  // sparkle button, "Help me write", etc.). On click, force-inject the
  // DLP stack so the next paste/send is governed.
  //
  // Conservative thresholds: a click on a generic "Generate" button
  // alone does NOT trigger — we require either a strong phrase or a
  // verb + AI-context combination.
  // -----------------------------------------------------------------
  const STRONG_AI_PHRASE = new RegExp(
    [
      'ask ai\\b',
      'ask copilot\\b',
      'ask gemini\\b',
      'ai assistant\\b',
      'ai chat\\b',
      'ai mode\\b',
      'ai suggest',
      'ai write\\b',
      'ai prompt\\b',
      'ai response\\b',
      'help me (write|draft|reply|respond|compose|brainstorm)',
      'summarize with ai\\b',
      'rewrite with ai\\b',
      'improve with ai\\b',
      'draft with ai\\b',
      'explain with ai\\b',
      'use ai\\b',
      'with ai\\b',
      'open copilot\\b',
      'copilot chat\\b',
      'duet ai\\b',
      'gitlab duo\\b',
      'einstein\\b',
      'gemini\\b',
    ].join('|'),
    'i',
  );
  const AI_DATA_HINT     = /(^|[-_])(ai|copilot|assistant|gemini|einstein|llm|gpt|claude)([-_]|$)/i;
  const AI_VERB          = /\b(generate|write|draft|reply|respond|compose|summarize|improve|rewrite|suggest|fix|explain|brainstorm|magic)\b/i;
  const SPARKLE          = /✨|sparkle|stars/i;   // ✨ U+2728

  function isAiAffordance(el) {
    let cur = el;
    for (let i = 0; i < 4 && cur && cur.nodeType === 1; i++) {
      const text  = (cur.textContent || '').slice(0, 200);
      const aria  = (cur.getAttribute?.('aria-label') || '') + ' ' + (cur.getAttribute?.('title') || '');
      const cls   = (cur.className && typeof cur.className === 'string') ? cur.className : '';
      const data  = serializeDataset(cur);

      // 1) Strong phrase anywhere in text/aria → ai
      if (STRONG_AI_PHRASE.test(text + ' ' + aria + ' ' + cls)) return { reason: 'phrase', label: trim80(text || aria) };

      // 2) AI data hint + verb in text → ai
      if (AI_DATA_HINT.test(data) && AI_VERB.test(text + ' ' + aria)) return { reason: 'data+verb', label: trim80(text || aria) };

      // 3) Sparkle (icon class or ✨) + verb → ai
      if ((SPARKLE.test(cls) || SPARKLE.test(text)) && AI_VERB.test(text + ' ' + aria)) return { reason: 'sparkle+verb', label: trim80(text || aria) };

      cur = cur.parentElement;
    }
    return null;
  }

  function serializeDataset(el) {
    try {
      const ds = el.dataset || {};
      return Object.entries(ds).map(([k, v]) => `${k}=${v}`).join(' ');
    } catch { return ''; }
  }

  function trim80(s) { return (s || '').replace(/\s+/g, ' ').trim().slice(0, 80); }

  // -----------------------------------------------------------------
  // Run order:
  //   1. If host is in KNOWN_SAAS_WITH_AI → force-inject immediately.
  //   2. Always install affordance click listener (catches the SaaS
  //      tools we don't have on the allowlist).
  //   3. If neither of the above shortcut paths fired by document_idle,
  //      run the DOM heuristic + LLM classifier (the original flow).
  // -----------------------------------------------------------------
  // Load the server-driven registry first, THEN decide whether this host
  // is on the SaaS allowlist. loadPlatforms typically returns in <10ms (a
  // chrome.storage.local read), well before check()'s 800ms scheduler.
  loadPlatforms().then(() => {
    const saasMatch = matchesKnownSaas(host);
    if (saasMatch && !window[FINGERPRINTED_KEY]) {
      window[FINGERPRINTED_KEY] = 'saas-allowlist';
      forceKnown({ ...saasMatch, source: 'allowlist' });
    }
  });

  installAffordanceListener();

  // Run the initial check shortly after idle so SPA frameworks have time to render.
  scheduleCheck(800);

  // Watch for late-loading chat UIs (e.g., Lovable's editor that mounts after auth).
  // Debounced MutationObserver: if the page suddenly grows a chat input or send
  // button later, re-evaluate (max once per page thanks to FINGERPRINTED_KEY).
  let mutTimer = null;
  const mo = new MutationObserver(() => {
    if (window[FINGERPRINTED_KEY]) { mo.disconnect(); return; }
    clearTimeout(mutTimer);
    mutTimer = setTimeout(check, 600);
  });
  try { mo.observe(document.documentElement || document.body, { childList: true, subtree: true }); } catch {}

  function scheduleCheck(delay) {
    setTimeout(check, delay);
  }

  function check() {
    if (window[FINGERPRINTED_KEY]) return;
    const signals = buildSignals();
    const verdict = preDecide(signals);
    if (verdict === 'not-ai') {
      // Strong negative — cache locally for this tab so we stop watching.
      window[FINGERPRINTED_KEY] = 'local:not-ai';
      try { mo.disconnect(); } catch {}
      return;
    }
    if (verdict === 'ai' || verdict === 'ambiguous') {
      window[FINGERPRINTED_KEY] = 'pending';
      classify(signals);
    }
  }

  // Build the metadata signals bundle. ONLY whitelisted fields. Never include
  // raw text content from inputs or messages — those are prompt content.
  function buildSignals() {
    const inputs   = document.querySelectorAll('textarea, [contenteditable="true"], [contenteditable=""]');
    const buttons  = document.querySelectorAll('button, [role="button"]');
    const sendBtn  = Array.from(buttons).some((b) => {
      const t = (b.textContent || '').trim().toLowerCase();
      return /^(send|submit|generate|run|ask|chat|reply)\b/i.test(t) ||
             /aria-label/i.test(b.outerHTML.slice(0, 200)) && /send|submit|generate/i.test(b.outerHTML.slice(0, 200));
    });
    const hasChatInput =
      // Multi-line input that takes prose, not a single <input>
      Array.from(inputs).some((el) => {
        if (el.tagName === 'TEXTAREA') return true;
        // contenteditable div with a placeholder hint
        const ph = el.getAttribute('placeholder') || el.getAttribute('data-placeholder') || el.getAttribute('aria-label') || '';
        return /message|ask|prompt|chat/i.test(ph);
      });
    const hasStreamingMarker =
      // Common attributes on streaming response containers across AI apps
      !!document.querySelector(
        '[data-message-role],[data-role="assistant"],[data-streaming],[data-streaming-text],.streaming-text,[aria-live="polite"]:not(:empty)'
      );
    const pageTitle = (document.title || '').slice(0, 200);
    const metaDesc  = document.querySelector('meta[name="description"]')?.getAttribute('content')?.slice(0, 200) || '';

    return {
      page_title:        pageTitle,
      meta_description:  metaDesc,
      has_chat_input:    !!hasChatInput,
      has_send_button:   !!sendBtn,
      has_streaming_text: !!hasStreamingMarker,
      // request_body_shape + detected_wire_format come from the proxy side,
      // not the page DOM — they'd require fetch instrumentation, defer.
    };
  }

  // Pre-decide locally — if we're certain it's not AI, skip the server call.
  function preDecide(s) {
    const positiveScore = (s.has_chat_input ? 1 : 0) + (s.has_send_button ? 1 : 0) + (s.has_streaming_text ? 1 : 0);
    // Title check — many AI apps put "AI", "chat", "assistant" in the title
    const titleHint = /\b(ai|chat|assistant|copilot|gpt|llm|claude|gemini|agent)\b/i.test(s.page_title);

    if (positiveScore === 0 && !titleHint) return 'not-ai';      // obviously not (login pages, articles, etc.)
    if (positiveScore >= 2 || (positiveScore >= 1 && titleHint)) return 'ambiguous'; // ask classifier
    return 'ambiguous';   // single weak signal — let classifier decide
  }

  // Force-mark this host as a known AI tool — used by the SaaS allowlist
  // and the affordance click detector. Skips the LLM entirely.
  function forceKnown({ vendor, product, category, source, label } = {}) {
    chrome.runtime.sendMessage(
      {
        __cfai_kind: 'knownAiTool',
        host,
        vendor: vendor || null,
        product: product || null,
        category: category || null,
        sandbox: 'remote',           // SaaS AI features run server-side
        source: source || 'allowlist',
        reason: label ? `${source}: "${label}"` : source,
      },
      (resp) => {
        if (chrome.runtime.lastError || !resp?.ok) {
          // Worker died or unenrolled — silently drop. Next user action that
          // re-enters will retry.
          return;
        }
        const v = resp.verdict;
        if (v?.should_govern) showGovernanceBanner(v);
      },
    );
  }

  function installAffordanceListener() {
    // One-shot per page — once an affordance fires, we trust the page is
    // AI for the rest of the session. Saves redundant injection requests.
    let fired = false;
    document.addEventListener('click', (ev) => {
      if (fired) return;
      const match = isAiAffordance(ev.target);
      if (!match) return;
      fired = true;
      forceKnown({ vendor: host, product: host, category: 'ide-assistant', source: 'affordance', label: match.label });
    }, true);   // capture phase — fires before React's synthetic handlers stop propagation
  }

  function classify(signals) {
    chrome.runtime.sendMessage(
      { __cfai_kind: 'classifyHost', host, signals },
      (resp) => {
        if (chrome.runtime.lastError) {
          // Service worker probably terminated; will retry on next visit.
          window[FINGERPRINTED_KEY] = null;
          return;
        }
        if (!resp || !resp.ok || !resp.verdict) {
          window[FINGERPRINTED_KEY] = null;
          return;
        }
        const v = resp.verdict;
        window[FINGERPRINTED_KEY] = v.should_govern ? 'govern' : (v.is_ai ? 'is-ai-low-conf' : 'not-ai');

        if (v.should_govern) {
          // The host's verdict says govern it. The existing per-site content
          // scripts (content.js) handle capture; this fingerprinter is the
          // discovery + classification layer only. Annotate the page so the
          // user knows it's being governed (small banner — invisible if the
          // existing content script already handles this site).
          showGovernanceBanner(v);
        }
      },
    );
  }

  function showGovernanceBanner(v) {
    // Skip if existing content script has already annotated this page.
    if (document.querySelector('[data-cfai-banner]')) return;
    const div = document.createElement('div');
    div.setAttribute('data-cfai-banner', '1');
    div.style.cssText =
      'position:fixed;bottom:12px;right:12px;z-index:2147483647;' +
      'background:#0f172a;color:#e2e8f0;font:12px/1.4 -apple-system,Segoe UI,Roboto,sans-serif;' +
      'padding:8px 12px;border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,.25);' +
      'border:1px solid #1e293b;max-width:320px;';
    const vendor = v.vendor ? `<strong>${escapeHtml(v.vendor)}</strong>` : 'AI tool';
    const note = v.governance_note ? `<div style="opacity:.7;margin-top:4px;font-size:11px">${escapeHtml(v.governance_note)}</div>` : '';
    div.innerHTML =
      `<div>🛡 ${vendor} — governed by CloudFuze (${(v.confidence * 100).toFixed(0)}% conf)</div>${note}`;
    document.documentElement.appendChild(div);
    setTimeout(() => { try { div.remove(); } catch {} }, 6000);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
})();

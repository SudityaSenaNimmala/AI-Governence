// CloudFuze AI Governance — renderer-side scanner.
//
// This file is read as TEXT by hook-template.js at module-load time and
// embedded into HOOK_SOURCE via JSON.stringify, so it ends up as a plain
// JavaScript string in the rendered cfai-hook.js. The Electron main process
// then runs `(${RENDERER_SCANNER})()` via webContents.executeJavaScript in
// every renderer.
//
// We keep this in a separate file so we can write the regexes / template
// strings with normal single-level JS escaping (e.g. `\b` for word boundary)
// instead of the double-escaped form a nested template literal would force.
//
// IMPORTANT: do not introduce top-level imports/exports — this file is run as
// inline JS inside the renderer, not loaded as a module.

(function rendererScanner() {
  // Luhn check — same as the browser extension, used to suppress credit-card
  // false positives (long digit runs that aren't valid card numbers).
  function luhnCheck(numStr) {
    const digits = String(numStr).replace(/\D/g, '');
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

  // Pattern catalog — kept in sync with browser-extension/content/patterns.js.
  // Full catalog parity (API keys, PII, internal hints) so the desktop hook
  // detects exactly what the browser extension does.
  const KEY_PATTERNS = [
    // ----- API keys -----
    { name: 'openai-api-key',     class: 'api_key',   regex: /\b(sk-(?:proj-)?[A-Za-z0-9_-]{20,})\b/g,                 severity: 'high'     },
    { name: 'anthropic-api-key',  class: 'api_key',   regex: /\b(sk-ant-(?:api\d{2}-)?[A-Za-z0-9_-]{20,})\b/g,         severity: 'high'     },
    { name: 'google-api-key',     class: 'api_key',   regex: /\b(AIza[0-9A-Za-z_-]{30,})\b/g,                          severity: 'high'     },
    { name: 'huggingface-token',  class: 'api_key',   regex: /\b(hf_[A-Za-z0-9]{30,})\b/g,                              severity: 'high'     },
    { name: 'github-pat',         class: 'api_key',   regex: /\b(gh[pousr]_[A-Za-z0-9]{30,})\b/g,                       severity: 'critical' },
    { name: 'gitlab-pat',         class: 'api_key',   regex: /\b(glpat-[A-Za-z0-9_-]{20,})\b/g,                         severity: 'critical' },
    { name: 'aws-access-key',     class: 'cloud_key', regex: /\b(AKIA[0-9A-Z]{16})\b/g,                                 severity: 'critical' },
    { name: 'gcp-service-key',    class: 'cloud_key', regex: /"type":\s*"service_account"/g,                            severity: 'critical' },
    { name: 'slack-token',        class: 'api_key',   regex: /\b(xox[abprs]-[A-Za-z0-9-]{10,})\b/g,                     severity: 'high'     },
    { name: 'jwt',                class: 'api_key',   regex: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, severity: 'high' },

    // ----- PII -----
    { name: 'us-ssn',             class: 'pii',       regex: /\b\d{3}-\d{2}-\d{4}\b/g,                                 severity: 'critical' },
    { name: 'credit-card',        class: 'pii',       regex: /\b(?:\d[ -]*?){13,16}\b/g,                               severity: 'high', validate: luhnCheck },
    { name: 'iban',               class: 'pii',       regex: /\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/g,                      severity: 'high'     },
    { name: 'us-phone',           class: 'pii',       regex: /\b(?:\+?1[ -]?)?\(?[2-9]\d{2}\)?[ -]?\d{3}[ -]?\d{4}\b/g, severity: 'low'      },

    // ----- internal hints (customize per organization) -----
    { name: 'cloudfuze-customer-id', class: 'internal', regex: /\bCF-CUST-[A-Z0-9]{6,}\b/g,                            severity: 'high'     },
    { name: 'internal-jira-key',     class: 'internal', regex: /\b(CF|GOV|SEC)-\d{2,}\b/g,                             severity: 'low'      },
  ];

  const BLOCK_SEVERITIES = new Set(['high', 'critical']);

  function scan(text) {
    if (!text || typeof text !== 'string') return [];
    const out = [];
    for (const p of KEY_PATTERNS) {
      p.regex.lastIndex = 0;
      let n = 0;
      let m;
      while ((m = p.regex.exec(text)) !== null) {
        if (p.validate && !p.validate(m[0])) continue;
        n++;
      }
      if (n > 0) out.push({ pattern: p.name, class: p.class, severity: p.severity, count: n });
    }
    return out;
  }

  function highest(matches) {
    const order = ['low','moderate','high','critical'];
    let top = null;
    for (const m of matches) if (order.indexOf(m.severity) > order.indexOf(top)) top = m.severity;
    return top;
  }

  function lengthBucket(n) {
    if (n < 100) return '<100';
    if (n < 1000) return '100-1k';
    if (n < 10000) return '1k-10k';
    if (n < 50000) return '10k-50k';
    return '50k+';
  }

  function emit(event) {
    // Bridge to the main process which has fetch + the embedded token.
    try { window.__cfaiBridge?.send(event); } catch {}
  }

  // ---- Prompt-input helpers ----
  function readInputText(el) {
    if (!el) return '';
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') return el.value || '';
    return el.innerText || '';
  }
  function isPromptInput(el) {
    if (!el || !el.tagName) return false;
    if (el.tagName === 'TEXTAREA') return true;
    if (el.getAttribute && (el.getAttribute('contenteditable') === 'true' || el.getAttribute('role') === 'textbox')) return true;
    return false;
  }
  function findPromptInputs() {
    const out = [];
    const visit = (r) => {
      try {
        for (const el of r.querySelectorAll('textarea, [contenteditable="true"], [role="textbox"]')) out.push(el);
        for (const el of r.querySelectorAll('*')) if (el.shadowRoot) visit(el.shadowRoot);
      } catch {}
    };
    visit(document);
    return out;
  }
  function findActivePromptInput() {
    let ae = document.activeElement;
    while (ae && ae.shadowRoot && ae.shadowRoot.activeElement) ae = ae.shadowRoot.activeElement;
    if (isPromptInput(ae)) return ae;
    const all = findPromptInputs();
    return all.length === 1 ? all[0] : null;
  }
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
    if (label.includes('send') || label.includes('submit')) return true;
    if (text === 'send' || text === 'submit') return true;
    if (tid.includes('send-button') || tid.includes('send_button')) return true;
    if (btn.type === 'submit') return true;
    return false;
  }

  function scanForBlockers(text) {
    if (!text || text.length < 4) return null;
    const matches = scan(text).filter((m) => BLOCK_SEVERITIES.has(m.severity));
    return matches.length > 0 ? matches : null;
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

  function escapeHtml(s) {
    const map = { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' };
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => map[c]);
  }

  // ---- Centered modal popup ----
  // Same look as the browser-extension modal. Appended to <html> with max
  // z-index so the host page's React tree can't reparent or unmount it.
  // CSS is injected once via a <style> tag the first time we show.
  const MODAL_CSS = [
    '.cfai-block-modal{position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",sans-serif;animation:cfai-fade-in .15s ease-out;}',
    '.cfai-block-backdrop{position:absolute;inset:0;background:rgba(15,23,42,.55);backdrop-filter:blur(2px);}',
    '.cfai-block-card{position:relative;width:min(440px,92vw);background:#fff;border-radius:14px;box-shadow:0 24px 60px rgba(0,0,0,.30),0 4px 12px rgba(0,0,0,.10);padding:28px 28px 22px;text-align:center;color:#0f172a;animation:cfai-pop-in .18s cubic-bezier(.18,.89,.32,1.28);}',
    '.cfai-block-icon{width:56px;height:56px;margin:0 auto 14px;display:flex;align-items:center;justify-content:center;background:#fee2e2;color:#b91c1c;border-radius:50%;font-size:28px;line-height:1;}',
    '.cfai-block-title{font-size:18px;font-weight:600;margin-bottom:6px;color:#0f172a;}',
    '.cfai-block-body{font-size:13.5px;color:#475569;line-height:1.5;margin-bottom:14px;}',
    '.cfai-block-filename{display:inline-block;max-width:100%;font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace;font-size:12.5px;color:#1e293b;background:#f1f5f9;border:1px solid #e2e8f0;border-radius:6px;padding:5px 10px;margin:0 auto 12px;overflow-wrap:anywhere;word-break:break-all;}',
    '.cfai-block-tags{display:flex;flex-wrap:wrap;justify-content:center;gap:6px;margin-bottom:16px;}',
    '.cfai-block-tags .cfai-tag{margin:0;font-size:12px;padding:4px 8px;}',
    '.cfai-block-hint{font-size:12px;color:#64748b;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:8px 10px;margin-bottom:18px;line-height:1.5;}',
    '.cfai-block-hint kbd{display:inline-block;font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace;font-size:11px;background:#fff;color:#334155;border:1px solid #cbd5e1;border-bottom-width:2px;border-radius:4px;padding:1px 5px;margin:0 1px;}',
    '.cfai-block-actions{display:flex;justify-content:center;}',
    '.cfai-block-dismiss{appearance:none;border:0;background:#4f46e5;color:#fff;font-size:13.5px;font-weight:600;padding:9px 22px;border-radius:8px;cursor:pointer;box-shadow:0 1px 2px rgba(0,0,0,.10);transition:background .12s ease,transform .05s ease;}',
    '.cfai-block-dismiss:hover{background:#4338ca;}',
    '.cfai-block-dismiss:active{transform:translateY(1px);}',
    '.cfai-block-dismiss:focus{outline:3px solid #c7d2fe;outline-offset:2px;}',
    '.cfai-block-footer{margin-top:14px;font-size:11px;color:#94a3b8;}',
    '.cfai-tag{display:inline-block;padding:2px 6px;margin:2px;border-radius:4px;font-size:11px;}',
    '.cfai-low{background:#f3f4f6;color:#1f2937;}',
    '.cfai-moderate{background:#fef3c7;color:#92400e;}',
    '.cfai-high{background:#fee2e2;color:#991b1b;}',
    '.cfai-critical{background:#7f1d1d;color:#fff;font-weight:600;}',
    '@keyframes cfai-fade-in{from{opacity:0;}to{opacity:1;}}',
    '@keyframes cfai-pop-in{from{opacity:0;transform:translateY(8px) scale(.96);}to{opacity:1;transform:translateY(0) scale(1);}}',
  ].join('');

  function ensureModalStyle() {
    if (document.getElementById('cfai-block-style')) return;
    const style = document.createElement('style');
    style.id = 'cfai-block-style';
    style.textContent = MODAL_CSS;
    (document.head || document.documentElement).appendChild(style);
  }

  function showCfaiPopup(opts) {
    ensureModalStyle();
    document.querySelector('.cfai-block-modal')?.remove();
    const root = document.createElement('div');
    root.className = 'cfai-block-modal';
    root.setAttribute('role', 'alertdialog');
    root.setAttribute('aria-modal', 'true');
    const filenameRow = opts.filename
      ? '<div class="cfai-block-filename">' + escapeHtml(opts.filename) + '</div>'
      : '';
    const tagsRow = (opts.matches && opts.matches.length)
      ? '<div class="cfai-block-tags">' + opts.matches.map((m) =>
          '<span class="cfai-tag cfai-' + m.severity + '">' + escapeHtml(m.pattern) +
          (m.count > 1 ? ' &times;' + m.count : '') + '</span>'
        ).join(' ') + '</div>'
      : '';
    const hintRow = opts.hint
      ? '<div class="cfai-block-hint">' + opts.hint + '</div>'
      : '';
    root.innerHTML =
      '<div class="cfai-block-backdrop"></div>' +
      '<div class="cfai-block-card">' +
        '<div class="cfai-block-icon" aria-hidden="true">&#9888;</div>' +
        '<div class="cfai-block-title">' + escapeHtml(opts.title) + '</div>' +
        '<div class="cfai-block-body">' + escapeHtml(opts.body) + '</div>' +
        filenameRow + tagsRow + hintRow +
        '<div class="cfai-block-actions">' +
          '<button type="button" class="cfai-block-dismiss">Got it</button>' +
        '</div>' +
        '<div class="cfai-block-footer">This event was reported to CloudFuze AI Governance.</div>' +
      '</div>';
    document.documentElement.appendChild(root);
    const close = () => root.remove();
    root.querySelector('.cfai-block-backdrop').addEventListener('click', close);
    root.querySelector('.cfai-block-dismiss').addEventListener('click', close);
    const onKey = (e) => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey, true); } };
    document.addEventListener('keydown', onKey, true);
    setTimeout(() => root.querySelector('.cfai-block-dismiss')?.focus(), 0);
  }

  function showBlockPopup(matches) {
    showCfaiPopup({
      title: "This prompt can't be sent",
      body:  'CloudFuze AI Governance blocked this message because it contains sensitive data:',
      matches,
      hint:  'Remove the highlighted information before sending. Override (logged): <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>Enter</kbd>.',
    });
  }

  function showAttachmentBlockPopup(attachments) {
    const single = attachments.length === 1;
    const filenameLine = single ? attachments[0].filename : attachments.length + ' attached files';
    const allMatches = mergeMatches(attachments.flatMap((a) => a.matches || []));
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

  // ---- Flagged-file tracking ----
  // So a clean prompt + still-attached dirty file blocks the send. Mirrors
  // the browser extension's flaggedFiles map.
  const flaggedFiles = new Map();
  function rememberFlaggedFile(filename, matches, severity) {
    if (!filename) return;
    flaggedFiles.set(filename, {
      matches: (matches || []).map((m) => ({ pattern: m.pattern, severity: m.severity, count: m.count || 1 })),
      severity: severity || 'high',
      chipEl: null,
    });
    let attempts = 0;
    const tick = () => {
      attempts++;
      const entry = flaggedFiles.get(filename);
      if (!entry || entry.chipEl) return;
      const chip = findChipElementByFilename(filename);
      if (chip) { entry.chipEl = chip; return; }
      if (attempts < 8) setTimeout(tick, 200);
    };
    setTimeout(tick, 100);
  }
  function findChipElementByFilename(filename) {
    if (!filename) return null;
    const stem = filename.replace(/\.[^.]+$/, '');
    const prefix = stem.slice(0, 16);
    const all = (document.body && document.body.querySelectorAll('*')) || [];
    for (const el of all) {
      if (!el || el.children.length > 12) continue;
      const html = el.outerHTML || '';
      const txt  = el.textContent || '';
      if (txt.length > 300 && html.length > 1000) continue;
      const matched = html.includes(filename) || (prefix.length >= 8 && txt.includes(prefix));
      if (!matched) continue;
      let chip = el;
      for (let i = 0; i < 4 && chip.parentElement; i++) {
        if (chip.children.length >= 2) break;
        chip = chip.parentElement;
      }
      return chip;
    }
    return null;
  }
  function filenameAppearsAttached(filename, docHtml, docText) {
    if (!filename) return false;
    if (docHtml.includes(filename)) return true;
    if (docText.includes(filename)) return true;
    const stem = filename.replace(/\.[^.]+$/, '');
    const prefix = stem.slice(0, 16);
    if (prefix && prefix.length >= 8 && docText.includes(prefix)) return true;
    return false;
  }
  function collectActiveFlaggedAttachments() {
    if (flaggedFiles.size === 0) return [];
    let docHtml = null;
    let docText = null;
    const out = [];
    for (const [filename, info] of Array.from(flaggedFiles.entries())) {
      let stillAttached = false;
      if (info.chipEl) {
        stillAttached = info.chipEl.isConnected === true;
      } else {
        if (docHtml === null) docHtml = (document.body && document.body.innerHTML) || '';
        if (docText === null) docText = (document.body && document.body.textContent) || '';
        stillAttached = filenameAppearsAttached(filename, docHtml, docText);
      }
      if (stillAttached) out.push({ filename, matches: info.matches, severity: info.severity });
      else flaggedFiles.delete(filename);
    }
    return out;
  }

  function emitEnforcement(action, el, matches, kind) {
    const text = el ? readInputText(el) : '';
    emit({
      kind: 'enforcement_' + action,
      blocked_for: kind,
      matches: (matches || []).map((m) => ({ pattern: m.pattern, class: m.class, severity: m.severity, count: m.count })),
      highest_severity: highest(matches || []),
      content_length: text.length,
      length_bucket: lengthBucket(text.length),
      content_text: text,
    });
  }

  // tryBlock: scan the active prompt + check for still-attached flagged files,
  // and if either trips a block, preventDefault + show modal + emit event.
  // Returns true if the send was blocked.
  function tryBlock(el, e, label) {
    const text = el ? readInputText(el) : '';
    const promptMatches = scanForBlockers(text);
    const flaggedAttachments = collectActiveFlaggedAttachments();
    if (!promptMatches && flaggedAttachments.length === 0) return false;

    if (e && e.ctrlKey && e.altKey) {
      emitEnforcement('override', el, promptMatches || [], 'prompt_submit');
      return false;
    }
    if (e) {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (typeof e.stopPropagation === 'function') e.stopPropagation();
    }
    if (flaggedAttachments.length > 0) {
      const filenames = flaggedAttachments.map((a) => a.filename).join(', ');
      const allMatches = mergeMatches(flaggedAttachments.flatMap((a) => a.matches || []));
      emit({
        kind: 'enforcement_block',
        blocked_for: 'file_upload',
        filename: filenames,
        highest_severity: highest(allMatches),
        matches: allMatches,
      });
      showAttachmentBlockPopup(flaggedAttachments);
      return true;
    }
    emitEnforcement('block', el, promptMatches, 'prompt_submit');
    showBlockPopup(promptMatches);
    return true;
  }

  // ---- Telemetry: paste scanning (no enforcement) ----
  document.addEventListener('paste', (e) => {
    const path = (typeof e.composedPath === 'function') ? e.composedPath() : [];
    const target = path.find((n) => n && n.nodeType === 1 && isPromptInput(n)) ||
      (isPromptInput(e.target) ? e.target : null);
    if (!target) return;
    const text = (e.clipboardData && e.clipboardData.getData('text')) || '';
    if (text.length < 4) return;
    const matches = scan(text);
    if (matches.length === 0) return;
    emit({
      kind: 'prompt_paste',
      content_length: text.length,
      length_bucket: lengthBucket(text.length),
      matches,
      highest_severity: highest(matches),
      content_text: text,
    });
  }, true);

  // ---- Enforcement: Enter key (no Shift) ----
  // MUST use capture phase (true) so we fire before the app's own React/keydown
  // handler — without it, the app sends first and our preventDefault is too late.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.shiftKey) return;
    const el = isPromptInput(e.target) ? e.target : findActivePromptInput();
    if (!el) return;
    // Capture text NOW before any framework clears the field.
    const text = readInputText(el);
    const blocked = tryBlock(el, e, 'keydown:Enter');
    if (blocked) return;
    // Clean send — emit telemetry. Use pre-captured text since the field may
    // be cleared by the time the micro-task fires.
    if (text.length >= 4) {
      const matches = scan(text);
      emit({
        kind: 'prompt_submit',
        content_length: text.length,
        length_bucket: lengthBucket(text.length),
        matches,
        highest_severity: highest(matches),
        content_text: text,
      });
    }
  }, true);

  // ---- Enforcement: send-like button (click / mousedown / pointerdown) ----
  function buttonHandler(label) {
    return (e) => {
      const btn = e.target && e.target.closest && e.target.closest('button, [role="button"]');
      if (!btn || !looksLikeSendButton(btn)) return;
      const el = findPromptInputFor(btn) || findActivePromptInput();
      tryBlock(el, e, label);
    };
  }
  document.addEventListener('click',        buttonHandler('click'),        true);
  document.addEventListener('mousedown',    buttonHandler('mousedown'),    true);
  document.addEventListener('pointerdown',  buttonHandler('pointerdown'),  true);

  // ---- Enforcement: form submit — capture phase required ----
  document.addEventListener('submit', (e) => {
    const form = e.target;
    const el = (form && form.querySelector && form.querySelector('textarea, [contenteditable="true"], [role="textbox"]')) || findActivePromptInput();
    tryBlock(el, e, 'submit');
  }, true);

  // ---- File classifier + content scanner (mirrors browser extension) ----
  const FILE_RULES = [
    { rx: /\.env(\.|$)|(^|[\\/])\.env(\.|$)/i,             cls: 'env_file',     sev: 'critical' },
    { rx: /\.(pem|key|pfx|p12|jks|keystore)$/i,            cls: 'private_key',  sev: 'critical' },
    { rx: /(^|[\W_])credentials?[\W_]?/i,                  cls: 'credentials',  sev: 'critical' },
    { rx: /(^|[\W_])secrets?[\W_]?/i,                      cls: 'credentials',  sev: 'critical' },
    { rx: /(^|[\W_])passwords?[\W_]?/i,                    cls: 'credentials',  sev: 'critical' },
    { rx: /id_(rsa|ed25519|ecdsa|dsa)/i,                   cls: 'ssh_key',      sev: 'critical' },
    { rx: /\.(csv|tsv|xlsx|xls|ods|parquet)$/i,            cls: 'tabular_data', sev: 'high' },
    { rx: /\.(sql|sqlite|db|dump|bak)$/i,                  cls: 'database',     sev: 'high' },
    { rx: /\.(har)$/i,                                     cls: 'network_har',  sev: 'high' },
    { rx: /\.(pdf|docx|doc|odt|rtf|pages)$/i,              cls: 'document',     sev: 'moderate' },
    { rx: /\.(zip|7z|rar|tar|tar\.gz|tgz)$/i,              cls: 'archive',      sev: 'moderate' },
    { rx: /\.(json|ya?ml|toml|ini|conf|config|cfg)$/i,     cls: 'config',       sev: 'moderate' },
    { rx: /\.(js|ts|tsx|jsx|py|rb|go|rs|java|cs|cpp|c|h|swift|kt|php)$/i, cls: 'source_code', sev: 'low' },
    { rx: /\.(md|markdown|txt|log)$/i,                     cls: 'plain_text',   sev: 'low' },
    { rx: /\.(png|jpe?g|gif|webp|svg|bmp|ico)$/i,          cls: 'image',        sev: 'low' },
    { rx: /\.(mp3|mp4|mov|avi|wav|flac|webm|mkv)$/i,       cls: 'media',        sev: 'low' },
  ];
  const TEXT_READABLE = /\.(txt|md|markdown|log|csv|tsv|json|ya?ml|toml|ini|conf|config|cfg|env|js|ts|tsx|jsx|mjs|cjs|py|rb|go|rs|java|cs|cpp|c|h|swift|kt|php|sql|html?|xml|pem|key)$/i;
  const CONTENT_SCAN_MAX_BYTES = 5 * 1024 * 1024;

  function classifyFile(name) {
    for (const r of FILE_RULES) if (r.rx.test(name)) return { cls: r.cls, sev: r.sev };
    return { cls: 'other', sev: 'low' };
  }
  function sizeBucket(n) {
    if (n < 1024) return '<1KB';
    if (n < 10240) return '1-10KB';
    if (n < 102400) return '10-100KB';
    if (n < 1048576) return '100KB-1MB';
    if (n < 10485760) return '1-10MB';
    return '>10MB';
  }
  async function scanFileContents(file) {
    const isText = TEXT_READABLE.test(file.name) || /(^|[\\/])\.env(\.|$)/.test(file.name);
    if (!isText) return { scanned: false, reason: 'unsupported_format' };
    if (file.size > CONTENT_SCAN_MAX_BYTES) return { scanned: false, reason: 'too_large', bytes: file.size };
    let text;
    try {
      text = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = () => reject(r.error);
        r.readAsText(file);
      });
    } catch (e) {
      return { scanned: false, reason: 'read_failed', error: String(e?.message || e) };
    }
    const matches = scan(text || '');
    const lineCount = ((text || '').match(/\n/g) || []).length + 1;
    let topSeverity = null;
    const ord = ['low','moderate','high','critical'];
    for (const m of matches) if (ord.indexOf(m.severity) > ord.indexOf(topSeverity)) topSeverity = m.severity;
    return {
      scanned: true,
      via: 'utf8',
      bytesScanned: file.size,
      lineCount,
      matchCount: matches.reduce((a, m) => a + m.count, 0),
      matches: matches.map((m) => ({ pattern: m.pattern, class: m.class, severity: m.severity, count: m.count })),
      contentSeverity: topSeverity,
    };
  }

  function filenameRisky(file) {
    const cls = classifyFile(file.name);
    return (cls.sev === 'high' || cls.sev === 'critical') ? cls : null;
  }
  function blockFileEvent(e, files, via) {
    const blocked = Array.from(files).filter(filenameRisky);
    if (blocked.length === 0) return false;
    e.preventDefault();
    e.stopImmediatePropagation();
    const attachmentInfos = [];
    for (const f of blocked) {
      const cls = classifyFile(f.name);
      emit({
        kind: 'enforcement_block',
        blocked_for: 'file_upload',
        via,
        filename: f.name,
        file_class: cls.cls,
        severity: cls.sev,
        highest_severity: cls.sev,
      });
      attachmentInfos.push({
        filename: f.name,
        severity: cls.sev,
        matches: [{ pattern: cls.cls, severity: cls.sev, count: 1 }],
      });
    }
    showAttachmentBlockPopup(attachmentInfos);
    return true;
  }

  document.addEventListener('change', (e) => {
    const t = e.target;
    if (!t || t.tagName !== 'INPUT' || t.type !== 'file') return;
    const files = t.files;
    if (!files) return;
    if (blockFileEvent(e, files, 'file_picker')) {
      try { t.value = ''; } catch {}
      return;
    }
    for (const f of files) emitFileUpload(f, 'file_picker');
  }, true);

  document.addEventListener('drop', (e) => {
    if (!e.dataTransfer?.files) return;
    if (blockFileEvent(e, e.dataTransfer.files, 'drop')) return;
    for (const f of e.dataTransfer.files) emitFileUpload(f, 'drop');
  }, true);

  async function emitFileUpload(file, via) {
    const cls = classifyFile(file.name);
    const cs = await scanFileContents(file);
    const ord = ['low','moderate','high','critical'];
    let severity = cls.sev;
    if (cs?.contentSeverity && ord.indexOf(cs.contentSeverity) > ord.indexOf(severity)) {
      severity = cs.contentSeverity;
    }
    // If content scan caught a high/critical pattern that filename heuristic
    // missed, remember the file so a later clean prompt + dirty attachment
    // still blocks at send time.
    if (severity === 'high' || severity === 'critical') {
      rememberFlaggedFile(file.name, (cs && cs.matches) || [], severity);
    }
    // Capture raw bytes/text for dashboard preview. 25 MB cap mirrors server.
    const PREVIEW_MAX = 25 * 1024 * 1024;
    let contentBase64 = null;
    let contentText = null;
    if (file.size <= PREVIEW_MAX) {
      try {
        const lower = (file.name || '').toLowerCase();
        const textExt = /\.(txt|md|markdown|csv|tsv|json|ndjson|jsonl|yaml|yml|toml|ini|conf|env|log|html|htm|xml|svg|sql|js|ts|jsx|tsx|mjs|cjs|py|rb|go|rs|java|kt|swift|cs|cpp|c|h|sh|bash|zsh|ps1|tf|tfvars)$/.test(lower);
        if (textExt) {
          contentText = await file.text();
        } else {
          contentBase64 = await new Promise((resolve, reject) => {
            const r = new FileReader();
            r.onerror = () => reject(r.error);
            r.onload  = () => {
              const v = r.result || '';
              const i = v.indexOf(',');
              resolve(i >= 0 ? v.slice(i + 1) : '');
            };
            r.readAsDataURL(file);
          });
        }
      } catch { /* leave null */ }
    }
    emit({
      kind: 'file_upload',
      via,
      filename: file.name,
      size: file.size,
      size_bucket: sizeBucket(file.size),
      mime_type: file.type || null,
      file_class: cls.cls,
      severity,
      content_scan: cs,
      content_text: contentText,
      content_base64: contentBase64,
    });
  }

  // Bridge fallback: renderer pushes events into __cfaiRendererQueue; the
  // main process polls and drains via executeJavaScript. A preload script
  // may replace __cfaiBridge.send with a faster direct IPC path.
  if (!window.__cfaiBridge) {
    window.__cfaiBridge = { send: (e) => {
      (window.__cfaiRendererQueue = window.__cfaiRendererQueue || []).push(e);
    }};
  }
})

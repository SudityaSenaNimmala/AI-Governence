// Content script — observes the page's prompt inputs and emits DLP events to
// the background service worker. As of 2026-05-18 it also forwards the full
// prompt text and file bytes for inline dashboard preview. See
// [[project_content_storage]] in memory for policy context.

(function () {
  console.info('[cfai] content script v2 loaded on', location.hostname);

  // Inject fetch blocker into the PAGE's main world so it can intercept
  // the actual fetch() calls that React makes. Content scripts run in an
  // isolated world and cannot patch the page's fetch.
  try {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('content/fetch-blocker.js');
    (document.head || document.documentElement).appendChild(script);
    script.onload = () => script.remove();
  } catch (e) {
    console.warn('[cfai] could not inject fetch blocker:', e);
  }

  // Listen for blocked fetch events from the injected script
  window.addEventListener('cfai-fetch-blocked', (e) => {
    const { matches } = e.detail || {};
    console.info('[cfai] fetch was blocked, showing popup. Matches:', matches);
    const matchObjs = (matches || []).map(name => ({ pattern: name, severity: 'critical', count: 1 }));
    showWarning(matchObjs, 'Sensitive data blocked from being sent');
  });

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

  function emit(event) {
    try {
      chrome.runtime.sendMessage({ ...event, service: SERVICE, occurredAt: new Date().toISOString() });
    } catch (e) {
      // Extension context may be lost (reload, update). Silently drop.
    }
  }

  // Dedup key — prevents double-emit when both the global enforcement handler
  // and the per-element fallback handler fire for the same Enter keypress.
  let _lastLogKey = null;

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
      content_text: text,           // full clipboard text for dashboard preview
    });

    if (severity === 'critical') {
      showWarning(matches, 'Sensitive data pasted into ' + SERVICE);
    }

    // Enforcement happens lazily on send (keydown Enter / click on send-like
    // button). We intentionally do NOT re-evaluate or mutate the page DOM here
    // — fighting React state on every keystroke caused Chrome to mark the page
    // unresponsive (the page kept re-rendering as we kept disabling buttons).
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

  function emitEnforcement(action, el, matches, kind) {
    emit({
      kind: 'enforcement_' + action,
      blocked_for: kind,
      matches: (matches || []).map((m) => ({ pattern: m.pattern, class: m.class, severity: m.severity, count: m.count })),
      highest_severity: highestSeverity(matches || []),
      content_length: el ? readInputText(el).length : 0,
      length_bucket: el ? lengthBucket(readInputText(el).length) : '<100',
    });
  }

  // Centered modal popup. Stays open until the user dismisses it. Built fully
  // outside the host page's React tree (appended to <html>, not <body>) with
  // the highest reasonable z-index so React reconciliation can never tear it
  // down or fight with it.
  //
  // opts:
  //   title (string)            — heading line
  //   body  (string)            — short explanation under the title
  //   matches (array)           — { pattern, severity, count } chips
  //   hint (string, optional)   — small grey help text under the chips
  //   filename (string, opt)    — shown above the chips when blocking a file
  function showCfaiPopup(opts) {
    document.querySelector('.cfai-block-modal')?.remove();

    const root = document.createElement('div');
    root.className = 'cfai-block-modal';
    root.setAttribute('role', 'alertdialog');
    root.setAttribute('aria-modal', 'true');
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
      // Hard block — no dismiss button, no escape, no backdrop click.
      // Only way out: remove sensitive data from the prompt.
      root.innerHTML = `
        <div class="cfai-block-backdrop"></div>
        <div class="cfai-block-card">
          <div class="cfai-block-icon" aria-hidden="true">&#9888;</div>
          <div class="cfai-block-title">${escapeHtml(opts.title)}</div>
          <div class="cfai-block-body">${escapeHtml(opts.body)}</div>
          ${filenameRow}
          ${tagsRow}
          ${hintRow}
          <div class="cfai-block-footer">This event was reported to the security team.</div>
        </div>
      `;
      document.documentElement.appendChild(root);

      // Block all keyboard/mouse events from reaching the page while modal is up
      const trap = (e) => {
        if (e.target?.closest?.('.cfai-block-modal')) return;
        e.stopImmediatePropagation();
      };
      for (const evt of ['keydown', 'keyup', 'pointerdown', 'mousedown', 'click']) {
        root.addEventListener(evt, trap, true);
      }

      // Auto-dismiss when sensitive text is removed — poll every 300ms
      const pollClose = setInterval(() => {
        const el = findActivePromptInput() || findPromptInputs()[0];
        const text = el ? readInputText(el) : '';
        const stillSensitive = scanForBlockers(text);
        if (!stillSensitive) {
          clearInterval(pollClose);
          root.remove();
        }
      }, 300);

      // Allow clicking backdrop to go back and edit (remove modal but keep blocker active)
      root.querySelector('.cfai-block-backdrop').addEventListener('click', (e) => {
        e.stopPropagation();
        root.remove();
        clearInterval(pollClose);
      });

    } else {
      // Soft popup (file warnings, etc.) — has dismiss button
      root.innerHTML = `
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
      document.documentElement.appendChild(root);

      const close = () => root.remove();
      root.querySelector('.cfai-block-backdrop').addEventListener('click', (e) => { e.stopPropagation(); close(); });
      const dismissBtn = root.querySelector('.cfai-block-dismiss');
      dismissBtn.addEventListener('click', (e) => { e.stopPropagation(); close(); });
      dismissBtn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopImmediatePropagation(); close(); } }, true);
      const onKey = (e) => { if (e.key === 'Escape') { e.stopImmediatePropagation(); close(); document.removeEventListener('keydown', onKey, true); } };
      document.addEventListener('keydown', onKey, true);
      setTimeout(() => dismissBtn?.focus(), 0);
    }
  }

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );
  }

  // The original prompt-block popup — hard block, no dismiss.
  // Only disappears when the user removes sensitive data from the input.
  function showBlockPopup(matches) {
    // Don't stack multiple popups
    if (document.querySelector('.cfai-block-modal')) return;
    showCfaiPopup({
      title: "This prompt can't be sent",
      body:  'CloudFuze AI Governance blocked this message because it contains sensitive data:',
      matches,
      hint:  'Remove the sensitive information from your prompt to continue.',
      hardBlock: true,
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
    // (1) Sensitive prompt text.
    const text = el ? readInputText(el) : '';
    const promptMatches = scanForBlockers(text);

    // (2) Sensitive attachments still on the composer. We walk the flaggedFiles
    //     map and check whether each filename is still visible in the document.
    //     If the user removed the chip, its filename disappears from the DOM,
    //     so we forget the entry to keep the map fresh.
    const flaggedAttachments = collectActiveFlaggedAttachments(el);

    if (!promptMatches && flaggedAttachments.length === 0) {
      // Not blocking — still log the send for governance and show the
      // "monitored" indicator so users see the extension is active.
      logPromptEvent(text);
      return false;
    }

    // No override allowed — sensitive data must be removed before sending.

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
    emitEnforcement('block', el, promptMatches, 'prompt_submit');
    showBlockPopup(promptMatches);
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
      // Allow our own UI, typing, navigation, and non-send actions
      if (e.target?.closest?.('.cfai-toast, .cfai-block-modal')) return;
      if (e.type === 'keydown' && e.key !== 'Enter') return;
      if (e.type === 'keydown' && e.key === 'Enter' && e.shiftKey) return;

      const el = findActivePromptInput() || findPromptInputs()[0];
      if (!el) return;
      const text = readInputText(el);
      const matches = scanForBlockers(text);
      if (!matches) {
        // Text was cleaned — deactivate blocker
        if (_blockActive) deactivateBlocker();
        return;
      }

      e.preventDefault();
      e.stopImmediatePropagation();
      e.stopPropagation();
      console.info('[cfai] GLOBAL BLOCKER stopped', e.type);
      _lastLogKey = null;
      emitEnforcement('block', el, matches, 'prompt_submit');
      showBlockPopup(matches);
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
    toast.querySelector('.cfai-toast-close').addEventListener('click', () => toast.remove());
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 6000);
  }

  // ---- Event wiring ----
  function attach(el) {
    if (el.__cfaiAttached) return;
    el.__cfaiAttached = true;
    const tag = el.tagName + (el.getAttribute('role') ? ('[role=' + el.getAttribute('role') + ']') : '');
    console.info('[cfai] attached to prompt input:', tag,
      el.getAttribute('aria-label') || el.getAttribute('placeholder') || '');

    el.addEventListener('paste', (e) => handlePaste(el, e), true);

    // PRIMARY ENFORCEMENT — block Enter directly on the input element.
    // This fires before React's delegation because it's on the element itself.
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        const captured = readInputText(el);
        if (ENFORCE && captured) {
          const matches = scanForBlockers(captured);
          if (matches) {
            e.preventDefault();
            e.stopImmediatePropagation();
            e.stopPropagation();
            console.info('[cfai] ELEMENT-LEVEL BLOCK on Enter');
            _lastLogKey = null;
            emitEnforcement('block', el, matches, 'prompt_submit');
            showBlockPopup(matches);
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
        const text = readInputText(el);
        if (!text) return;
        const matches = scanForBlockers(text);
        if (!matches) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        e.stopPropagation();
        console.info('[cfai] BUTTON-LEVEL BLOCK on', e.type);
        _lastLogKey = null;
        emitEnforcement('block', el, matches, 'prompt_submit');
        showBlockPopup(matches);
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
    for (const el of findPromptInputs()) attach(el);
    attachToShadowRoots();
  }

  scanAndAttach();
  installEnforcementHooks();

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
    if (/copilot/.test(host)) return 'Microsoft Copilot';
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

  // ── Blocked Agent Enforcement ──────────────────────────────────────────────
  // Maps platform types to the hostnames where those agents are accessed via
  // browser. When a blocked agent is detected on the current page, we inject
  // a full-page overlay that prevents all interaction.

  const PLATFORM_TO_HOSTS = {
    copilot_studio:     [/copilot\.microsoft/, /powerva\.ms/, /copilotstudio/],
    personal_agent:     [/copilot\.microsoft/],
    teams_chat_agent:   [/teams\.microsoft/],
    openai_assistant:   [/chatgpt\.com/, /chat\.openai\.com/],
    custom_gpt:         [/chatgpt\.com/, /chat\.openai\.com/],
    claude_ai_project:  [/claude\.ai/],
    gemini:             [/gemini\.google/, /aistudio\.google/],
    gemini_enterprise:  [/gemini\.google/, /discoveryengine/],
    vertex_ai:          [/console\.cloud\.google/],
    azure_foundry:      [/portal\.azure/, /ai\.azure/],
  };

  let _blockedOverlay = null;

  function checkBlockedAgents(blockedList) {
    if (!blockedList || blockedList.length === 0) {
      removeBlockOverlay();
      return;
    }
    const host = location.hostname;
    const pageText = (document.title + ' ' + document.body?.innerText?.slice(0, 5000)).toLowerCase();

    for (const agent of blockedList) {
      // Check if this page hosts the agent's platform
      const hostPatterns = PLATFORM_TO_HOSTS[agent.platform] || [];
      const hostMatch = hostPatterns.some(rx => rx.test(host));
      if (!hostMatch) continue;

      // Check if the agent name appears on the page
      const name = (agent.agent_name || '').toLowerCase();
      if (name && name.length > 2 && pageText.includes(name)) {
        showBlockOverlay(agent);
        return;
      }
    }
    removeBlockOverlay();
  }

  function showBlockOverlay(agent) {
    if (_blockedOverlay) return; // already showing
    _blockedOverlay = document.createElement('div');
    _blockedOverlay.id = 'cfai-block-overlay';
    _blockedOverlay.innerHTML = `
      <div style="
        position:fixed; inset:0; z-index:2147483647;
        background:rgba(0,0,0,0.85); display:flex; align-items:center;
        justify-content:center; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
      ">
        <div style="
          background:#1c1c1e; border:1px solid #ef4444; border-radius:16px;
          padding:40px 48px; max-width:480px; text-align:center; color:#fff;
        ">
          <div style="font-size:48px; margin-bottom:16px;">&#128683;</div>
          <h2 style="font-size:20px; font-weight:700; margin:0 0 8px; color:#ef4444;">
            Agent Blocked
          </h2>
          <p style="font-size:15px; color:#ccc; margin:0 0 16px; line-height:1.6;">
            <strong>${agent.agent_name || 'This agent'}</strong> has been blocked by your organization's AI governance policy.
          </p>
          <p style="font-size:12px; color:#888; margin:0 0 20px;">
            ${agent.reason || 'Contact your administrator for access.'}
          </p>
          <div style="
            display:inline-flex; align-items:center; gap:8px; padding:8px 16px;
            background:#ef44441a; border:1px solid #ef444433; border-radius:8px;
            font-size:12px; color:#f87171;
          ">
            <span>CloudFuze AI Governance</span>
          </div>
        </div>
      </div>
    `;
    document.documentElement.appendChild(_blockedOverlay);
    // Block all keyboard and mouse input
    const blocker = (e) => { e.stopPropagation(); e.preventDefault(); };
    _blockedOverlay.addEventListener('keydown', blocker, true);
    _blockedOverlay.addEventListener('click', blocker, true);
    console.info('[cfai] Agent blocked:', agent.agent_name, agent.platform);
  }

  function removeBlockOverlay() {
    if (_blockedOverlay) {
      _blockedOverlay.remove();
      _blockedOverlay = null;
    }
  }

  // Request blocked list from background on load
  try {
    chrome.runtime.sendMessage({ type: 'cfai-get-blocked' }, (resp) => {
      if (resp?.blocked) checkBlockedAgents(resp.blocked);
    });
  } catch {}

  // Listen for real-time blocked list updates from background
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'cfai-blocked-update') {
      checkBlockedAgents(msg.blocked || []);
    }
  });

  // Re-check periodically (page content changes as user navigates SPAs)
  setInterval(() => {
    try {
      chrome.runtime.sendMessage({ type: 'cfai-get-blocked' }, (resp) => {
        if (resp?.blocked) checkBlockedAgents(resp.blocked);
      });
    } catch {}
  }, 15000);

})();

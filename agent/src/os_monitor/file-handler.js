// Given a file path the user copied or selected for upload to an AI app,
// build a `file_upload` DLP event matching the shape the server's
// /api/v1/dlp endpoint expects (same shape the browser extension uses).
//
// As of 2026-05-18 the event also carries the raw bytes (or text, for
// text-readable formats) so the dashboard can render an inline preview.
// See [[project_content_storage]] in memory for the policy context.

import { stat, readFile, open } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import {
  scan,
  classifyFile,
  sizeBucket,
  isTextReadable,
  isBinaryParseable,
  isImage,
  isArchive,
  isDocumentLikeFormat,
  extOf,
  CONTENT_SCAN_MAX_BYTES,
  CONTENT_CAPTURE_MAX_BYTES,
} from './classifier.js';
import { extractTextFromBinary, extractZip } from './binary-extractors.js';
import { Worker } from 'node:worker_threads';

// Binary extraction in a WORKER (security review 2026-09-28, finding 5), for the
// composer census and pane routes (`isolate: true`): the parsers -- SheetJS's
// readFile is synchronous -- then cannot block the event loop that keeps every
// attach hold alive. Terminated on EXTRACTION_BUDGET_MS; resourceLimits bound an
// inflating document. Resolves like extractTextFromBinary, or TIMED_OUT, or
// { failed: 'too_large' | 'extraction_failed' }.
const WORKER_URL = new URL('./extract-worker.js', import.meta.url);
export const WORKER_RESOURCE_LIMITS = { maxOldGenerationSizeMb: 512, maxYoungGenerationSizeMb: 64, stackSizeMb: 8 };
function extractIsolated(path, ext, { maxChars = 0 } = {}) {
  return new Promise((resolve) => {
    let done = false;
    let worker;
    const finish = (v) => { if (done) return; done = true; clearTimeout(timer); try { worker?.terminate(); } catch {} resolve(v); };
    try {
      worker = new Worker(WORKER_URL, { workerData: { path, ext, maxChars }, resourceLimits: WORKER_RESOURCE_LIMITS });
    } catch { resolve({ failed: 'extraction_failed' }); return; }
    const timer = setTimeout(() => finish(TIMED_OUT), EXTRACTION_BUDGET_MS);
    timer.unref?.();
    worker.once('message', (m) => {
      if (!m?.ok) finish({ failed: 'extraction_failed' });
      else if (m.none) finish(null);
      else finish({ text: m.text, via: m.via, pages: m.pages ?? undefined, sheets: m.sheets ?? undefined });
    });
    worker.once('error', (err) => finish({ failed: /ERR_WORKER_OUT_OF_MEMORY/.test(String(err?.code || err)) ? 'too_large' : 'extraction_failed' }));
    worker.once('exit', (code) => { if (!done) finish({ failed: code === 0 ? 'extraction_failed' : 'too_large' }); });
  });
}

const SEVERITY_ORDER = ['low', 'moderate', 'high', 'critical'];

// How long any single extraction may run before we answer without it.
//
// The UI needs an answer within a bounded time — the same reasoning behind
// REWRITE_WRITE_BUDGET_MS on the rewrite path. Here the consumer is the
// attachment hold: index.js arms a short PROVISIONAL hold before this function
// is called and can only decide what to do with it once we return, so an
// extraction that never returns leaves the send in limbo (and, before the
// refresh fix, let the provisional hold silently lapse). A full PDF / docx /
// xlsx / nested-zip extraction of a file inside the 5 MB scan cap finishes far
// inside 8s; anything past it is a hang, a pathological file, or a first-run
// tesseract WASM download.
//
// This bounds the ANSWER, not the work: a stuck parser keeps running in the
// background (there is no cancellation token in mammoth / pdf-parse / SheetJS /
// jszip to hand it), it just no longer decides anything. The outcome is
// reason:'extraction_timeout', which the fail-closed rule below treats exactly
// like a failed parse.
export const EXTRACTION_BUDGET_MS = 8000;

// Sentinel so the timeout is told apart from a genuine parser error without
// string-matching a message.
const TIMED_OUT = Symbol('extraction_timeout');

async function withExtractionBudget(promise) {
  let timer = null;
  try {
    return await Promise.race([
      promise,
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(TIMED_OUT), EXTRACTION_BUDGET_MS);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Read at most `max` bytes off `path`.
 *
 * readFile() has no size argument, so the old capture sites read whole files
 * into memory — including in the `too_large` branch, which had ALREADY decided
 * the file was too big to look at. A file handle plus one bounded read is the
 * fix: memory is capped at `max` regardless of what is on disk.
 *
 * Returns { buf, truncated } — truncated is what tells the dashboard the
 * preview is a prefix rather than the file.
 */
async function readCapped(path, max, size) {
  if (size != null && size <= max) return { buf: await readFile(path), truncated: false };
  let fh;
  try {
    fh = await open(path, 'r');
    const buf = Buffer.allocUnsafe(max);
    const { bytesRead } = await fh.read(buf, 0, max, 0);
    return { buf: buf.subarray(0, bytesRead), truncated: (size == null ? bytesRead >= max : size > max) };
  } finally {
    await fh?.close().catch(() => {});
  }
}

function maxSeverity(...sevs) {
  let top = null;
  for (const s of sevs) {
    if (!s) continue;
    if (SEVERITY_ORDER.indexOf(s) > SEVERITY_ORDER.indexOf(top)) top = s;
  }
  return top;
}

// Runs the pattern catalog against `text` and packages the results in the
// shape the server's content_scan validator accepts. Used by both the UTF-8
// path and the binary-extraction paths.
function scanExtractedText({ text, via, bytesScanned, pages, sheets }) {
  const safeText = text || '';
  const { matches } = scan(safeText);
  const lineCount = (safeText.match(/\n/g) || []).length + 1;
  const matchCount = matches.reduce((a, m) => a + m.count, 0);
  let topSeverity = null;
  for (const m of matches) {
    if (SEVERITY_ORDER.indexOf(m.severity) > SEVERITY_ORDER.indexOf(topSeverity)) topSeverity = m.severity;
  }
  const result = {
    scanned: true,
    via,
    bytesScanned,
    lineCount,
    matchCount,
    matches: matches.map((m) => ({ pattern: m.pattern, class: m.class, severity: m.severity, count: m.count })),
    contentSeverity: topSeverity,
  };
  if (pages != null)  result.pages  = pages;
  if (sheets != null) result.sheets = sheets;
  return result;
}

/**
 * Build a `file_upload`-kind DLP event for a file at `path`. `via` describes
 * how the file got referenced (clipboard_file_copy | open_file_dialog).
 *
 * Returns null if the path doesn't exist (race with the user — file was
 * deleted, moved, or never resolvable from clipboard) — caller should skip.
 */
// PARTIAL SCAN (user decision 2026-09-28, composer census only): a file over
// CONTENT_SCAN_MAX_BYTES is not waved through unscanned. The FIRST part is
// scanned instead -- the first CONTENT_SCAN_MAX_BYTES bytes of a text file, or
// the first CONTENT_SCAN_MAX_BYTES characters of a document's extracted text for
// a binary document up to PARTIAL_BINARY_MAX_BYTES -- and content_scan says so
// (partial:true). A sensitive hit in that part holds the send like any other; a
// clean partial scan is reported, not held (hold_reason 'partially_scanned').
// Anything too big even for that stays too_large -> unverified -> fail closed on
// a governed surface.
export const PARTIAL_BINARY_MAX_BYTES = 50 * 1024 * 1024;

// `isolate`: run binary extraction in a worker (see extractIsolated).
// `quiet`: never put the filename or path in a log line (the census routes:
// finding 12) -- only an error code.
// `metadataOnly`: stat + classify, never read the content (a name-only census
// resolution that is not bound to this attach: finding 2).
export async function buildFileUploadEvent({
  path, via, service, vendor, processName, windowTitle, log, partialScan = false,
  isolate = false, quiet = false, metadataOnly = false,
}) {
  const extractBinary = (pth, ext2, maxChars = 0) => (isolate
    ? extractIsolated(pth, ext2, { maxChars })
    : withExtractionBudget(extractTextFromBinary(pth, ext2)));
  let st;
  try { st = await stat(path); }
  catch (err) {
    if (err.code === 'ENOENT') return null;
    log?.warn(quiet ? `file-handler: stat failed (${err.code || 'error'})` : `file-handler: stat failed for ${path}: ${err.message}`);
    return null;
  }
  if (!st.isFile()) return null;   // directories, devices etc. — skip

  const filename = basename(path);
  const r = classifyFile(filename);
  if (metadataOnly) {
    return {
      kind: 'file_upload', via, service, vendor, process_name: processName, window_title: windowTitle,
      filename, size: st.size, size_bucket: sizeBucket(st.size), mime_type: null,
      extension: extname(filename) || null, file_class: r.class, severity: r.severity, reason: r.reason,
      content_scan: { scanned: false, reason: 'unbound_name_match', unverified: true },
      content_text: null, content_base64: null,
    };
  }

  // Try to scan content. Three routing paths:
  //   1) Text-readable formats (.env, .csv, .json, source code, etc.) — read as UTF-8
  //   2) Binary parseable formats (.docx, .pdf, .xlsx) — route through extractors
  //   3) Anything else — filename-class only
  const ext = extOf(filename);
  let contentScan = null;
  // Captured content forwarded to the server for inline preview. Either
  // `content_text` (decoded UTF-8) or `content_base64` (binary).
  let capturedText = null;
  let capturedBase64 = null;
  let capturedMime = null;
  // Set by any capture below that had to stop at CONTENT_CAPTURE_MAX_BYTES, so
  // the preview is never silently presented as the whole file.
  let captureTruncated = false;
  if (st.size > CONTENT_SCAN_MAX_BYTES && partialScan && isTextReadable(filename)) {
    try {
      const { buf } = await readCapped(path, CONTENT_SCAN_MAX_BYTES, st.size);
      const text = buf.toString('utf8');
      capturedText = text;
      captureTruncated = true;
      capturedMime = 'text/plain; charset=utf-8';
      contentScan = scanExtractedText({ text, via: 'utf8', bytesScanned: buf.length });
      contentScan.partial = true;
    } catch (err) {
      contentScan = { scanned: false, reason: 'read_failed', error: String(err?.message || err) };
    }
  } else if (st.size > CONTENT_SCAN_MAX_BYTES && partialScan && isBinaryParseable(filename) && st.size <= PARTIAL_BINARY_MAX_BYTES) {
    try {
      const extraction = await extractBinary(path, ext, CONTENT_SCAN_MAX_BYTES);
      if (extraction === TIMED_OUT) {
        contentScan = { scanned: false, reason: 'extraction_timeout', extension: ext, budgetMs: EXTRACTION_BUDGET_MS };
      } else if (extraction?.failed) {
        contentScan = { scanned: false, reason: extraction.failed === 'too_large' ? 'too_large' : 'extraction_failed', extension: ext };
      } else if (!extraction) {
        contentScan = { scanned: false, reason: 'unsupported_format', extension: ext };
      } else {
        contentScan = scanExtractedText({
          text: String(extraction.text || '').slice(0, CONTENT_SCAN_MAX_BYTES),
          via: extraction.via, bytesScanned: Math.min(st.size, CONTENT_SCAN_MAX_BYTES),
          pages: extraction.pages, sheets: extraction.sheets,
        });
        contentScan.partial = true;
      }
    } catch (err) {
      contentScan = { scanned: false, reason: 'extraction_failed', extension: ext, error: String(err?.message || err) };
    }
    try {
      const { buf, truncated } = await readCapped(path, CONTENT_CAPTURE_MAX_BYTES, st.size);
      capturedBase64 = buf.toString('base64');
      capturedMime = mimeFromExt(ext) || 'application/octet-stream';
      captureTruncated = captureTruncated || truncated;
    } catch { /* leave null */ }
  } else if (st.size > CONTENT_SCAN_MAX_BYTES) {
    contentScan = { scanned: false, reason: 'too_large', bytes: st.size };
    // Still capture the bytes for preview if we can. They're already on disk;
    // failing to forward is worse than skipping the local scan.
    //
    // BOUNDED, unlike before: this branch has already decided the file is too
    // large to scan, so reading all of it to base64 a preview was the one place
    // a multi-GB file could take the agent process down with it. The cap is the
    // server's own storage ceiling — see CONTENT_CAPTURE_MAX_BYTES.
    try {
      const { buf, truncated } = await readCapped(path, CONTENT_CAPTURE_MAX_BYTES, st.size);
      capturedBase64 = buf.toString('base64');
      captureTruncated = truncated;
    } catch { /* leave captured* null */ }
  } else if (isTextReadable(filename)) {
    try {
      const buf = await readFile(path);
      const text = buf.toString('utf8');
      capturedText = text;
      capturedMime = 'text/plain; charset=utf-8';
      contentScan = scanExtractedText({ text, via: 'utf8', bytesScanned: st.size });
    } catch (err) {
      contentScan = { scanned: false, reason: 'read_failed', error: String(err?.message || err) };
    }
  } else if (isBinaryParseable(filename) || isImage(filename)) {
    try {
      const extraction = await extractBinary(path, ext);
      if (extraction?.failed) {
        contentScan = { scanned: false, reason: extraction.failed === 'too_large' ? 'too_large' : 'extraction_failed', extension: ext };
      } else if (extraction === TIMED_OUT) {
        // Ran past EXTRACTION_BUDGET_MS. Reported as its own reason rather than
        // folded into extraction_failed so the dashboard can tell a corrupt or
        // encrypted file from a slow one — both are equally unverified, which is
        // what the hold decision keys on.
        log?.warn(quiet ? `file-handler: extraction exceeded ${EXTRACTION_BUDGET_MS}ms — answering without it` : `file-handler: extraction of ${filename} exceeded ${EXTRACTION_BUDGET_MS}ms — answering without it`);
        contentScan = { scanned: false, reason: 'extraction_timeout', extension: ext, budgetMs: EXTRACTION_BUDGET_MS };
      } else if (!extraction) {
        contentScan = { scanned: false, reason: 'unsupported_format', extension: ext };
      } else {
        contentScan = scanExtractedText({
          text: extraction.text,
          via: extraction.via,
          bytesScanned: st.size,
          pages: extraction.pages,
          sheets: extraction.sheets,
        });
      }
    } catch (err) {
      log?.warn(quiet ? `file-handler: binary extraction failed (${err?.code || err?.name || 'error'})` : `file-handler: binary extraction failed for ${filename}: ${err?.message || err}`);
      contentScan = {
        scanned: false,
        reason: 'extraction_failed',
        extension: ext,
        error: String(err?.message || err),
      };
    }
    // Capture the raw bytes so the dashboard can render the file directly
    // (image preview, PDF embed, .xlsx via SheetJS).
    try {
      const { buf, truncated } = await readCapped(path, CONTENT_CAPTURE_MAX_BYTES, st.size);
      capturedBase64 = buf.toString('base64');
      capturedMime = mimeFromExt(ext) || 'application/octet-stream';
      captureTruncated = captureTruncated || truncated;
    } catch { /* leave null */ }
  } else if (isArchive(filename)) {
    try {
      const zipScan = await withExtractionBudget(extractZip({ path, scan, log }));
      contentScan = zipScan === TIMED_OUT
        ? { scanned: false, reason: 'extraction_timeout', extension: ext, budgetMs: EXTRACTION_BUDGET_MS }
        : zipScan;
      if (zipScan === TIMED_OUT) {
        log?.warn(quiet ? `file-handler: zip extraction exceeded ${EXTRACTION_BUDGET_MS}ms — answering without it` : `file-handler: zip extraction of ${filename} exceeded ${EXTRACTION_BUDGET_MS}ms — answering without it`);
      }
    } catch (err) {
      log?.warn(quiet ? `file-handler: zip extraction failed (${err?.code || err?.name || 'error'})` : `file-handler: zip extraction failed for ${filename}: ${err?.message || err}`);
      contentScan = { scanned: false, reason: 'zip_failed', error: String(err?.message || err) };
    }
    try {
      const { buf, truncated } = await readCapped(path, CONTENT_CAPTURE_MAX_BYTES, st.size);
      capturedBase64 = buf.toString('base64');
      capturedMime = 'application/zip';
      captureTruncated = captureTruncated || truncated;
    } catch { /* leave null */ }
  } else {
    contentScan = { scanned: false, reason: 'unsupported_format', extension: ext };
    // Last-resort: still try to send bytes for unknown extensions so the
    // dashboard can offer a download link.
    try {
      const { buf, truncated } = await readCapped(path, CONTENT_CAPTURE_MAX_BYTES, st.size);
      capturedBase64 = buf.toString('base64');
      capturedMime = 'application/octet-stream';
      captureTruncated = captureTruncated || truncated;
    } catch { /* leave null */ }
  }

  // ── "We could not verify this file" ────────────────────────────────────────
  //
  // The one fact a hold decision cannot get from `severity`: a file that was
  // never scanned has no contentSeverity to raise, so an encrypted PDF or a
  // password-protected workbook full of customer data scores exactly the same
  // as an empty one. `unverified` is that fact, stated on the scan result so
  // the consumer never has to re-derive it from a reason string.
  //
  // TRUE only when BOTH halves hold: nothing was scanned, AND the format is one
  // that should have been readable (isDocumentLikeFormat — see its comment for
  // why an unopenable .7z counts and a .mp4 does not). So a media file, an image
  // whose OCR found nothing, and an unknown extension all stay `false` and keep
  // today's fail-OPEN behaviour untouched.
  //
  // It is a SIGNAL, not a decision: index.js's shouldHold only escalates on it
  // inside a governed/blocked conversation. Everywhere else the severity
  // threshold is unchanged.
  if (contentScan && contentScan.scanned !== true) {
    contentScan.unverified = isDocumentLikeFormat(filename);
  }
  if (captureTruncated && contentScan) contentScan.captureTruncated = true;

  // Promote severity if content scan found something nastier than the
  // filename heuristic suggested. Matches browser extension behavior.
  const severity = maxSeverity(r.severity, contentScan?.contentSeverity);

  return {
    kind: 'file_upload',
    via,
    service,
    vendor,
    process_name: processName,
    window_title: windowTitle,
    filename,
    size: st.size,
    size_bucket: sizeBucket(st.size),
    mime_type: capturedMime,
    extension: extname(filename) || null,
    file_class: r.class,
    severity,
    reason: r.reason,
    content_scan: contentScan,
    // Forwarded raw payload for dashboard preview. The server caps at 25 MB
    // and truncates beyond that, marking the row truncated=1.
    content_text: capturedText,
    content_base64: capturedBase64,
  };
}

function mimeFromExt(ext) {
  const e = String(ext || '').toLowerCase();
  return ({
    '.pdf':  'application/pdf',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.xls':  'application/vnd.ms-excel',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.doc':  'application/msword',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.png':  'image/png',
    '.jpg':  'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif':  'image/gif',
    '.webp': 'image/webp',
    '.bmp':  'image/bmp',
    '.svg':  'image/svg+xml',
    '.zip':  'application/zip',
  })[e] || null;
}

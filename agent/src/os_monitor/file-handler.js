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
  OCR_MAX_BYTES,
} from './classifier.js';
import {
  extractTextFromBinary, extractZip, summarizeZipScan, decodeText, detectTextEncoding, SUSPICIOUS_REASONS,
} from './binary-extractors.js';
import { ocrImageFile, ocrImageBuffer, cancelOcrGroup } from './ocr-service.js';
import { Worker } from 'node:worker_threads';

// ── content_scan.reason CONTRACT ─────────────────────────────────────────────
//
// Whenever content_scan.scanned !== true, content_scan.reason is EXACTLY one of
// SCAN_FAILURE_REASONS (the attachment-hold / enforcement code keys on these):
//
//   'unsupported_format'  no extractor for this extension (legacy .doc/.ppt,
//                         .msg, unknown types -- and a legacy .doc/.ppt renamed
//                         to .docx/.pptx)
//   'too_large'           over CONTENT_SCAN_MAX_BYTES (25 MB) -- or, for an
//                         image, over OCR_MAX_BYTES (8 MB) -- or a decompression
//                         bomb, or the isolated extract worker ran out of memory
//   'encrypted'           password-protected: a CFB container holding an
//                         EncryptionInfo/EncryptedPackage stream under an
//                         OOXML/ODF name, a PDF that needs a password, or a
//                         workbook SheetJS reports as password-protected
//   'extraction_timeout'  ran past its budget (EXTRACTION_BUDGET_MS; OCR: its
//                         run budget or its queue ceiling)
//   'extraction_failed'   anything else: unreadable/corrupt file, parser error,
//                         OCR engine or its bundled language data unavailable
//
// Retired aliases, folded into 'extraction_failed' (nothing read them):
// 'read_failed' (text read error) and 'zip_failed' (archive parse error).
//
// ── content_scan.suspicious CONTRACT ─────────────────────────────────────────
//
// suspicious:true + suspicious_reason (one of SUSPICIOUS_REASONS) is set when a
// READABLE file (text, document, image, archive) failed or was only partly read
// in a way its author controls. Absent (never false) otherwise; genuinely
// unsupported types (.doc, video, unknown) never carry it.
//
//   'decompression_ratio'      zip/OOXML/ODF (or an entry in one) expands > 400 MB,
//                              or > 50 MB at > 100x its compressed size: not inflated
//   'self_timeout'             the file's OWN extraction ran out its budget (not
//                              time spent queued behind another file)
//   'oom'                      the isolated extract worker hit its memory limit
//   'oversize_unscanned_tail'  over a size cap with content left unread: a file
//                              too big to scan at all, a text file whose middle
//                              was skipped (bytesUnscanned > 0), a document whose
//                              extracted text was cut at 25M characters, an image
//                              over the OCR cap
//   'container_truncated'      zip/.eml with entries not scanned: max depth, entry
//                              cap, OCR cap, over-cap / encrypted / failed entries,
//                              or document-like entries with no extractor
//
// It can accompany scanned:false (nothing usable was read) or scanned:true with
// partial:true (what WAS read is in matches/contentSeverity). It is a signal:
// the consumer (index.js) decides where it holds.
//
// Content severity is content_scan.contentSeverity + content_scan.matches --
// computed from the content alone. The event's top-level `severity` is the max
// of that and the filename class.
export const SCAN_FAILURE_REASONS = Object.freeze([
  'unsupported_format', 'too_large', 'encrypted', 'extraction_timeout', 'extraction_failed',
]);
export { SUSPICIOUS_REASONS };
function failureReason(r) {
  return SCAN_FAILURE_REASONS.includes(r) ? r : 'extraction_failed';
}
function markSuspicious(cs, why) {
  if (!cs || !SUSPICIOUS_REASONS.includes(why)) return cs;
  // First cause wins, except that a bomb outranks a generic truncation.
  if (!cs.suspicious || (why === 'decompression_ratio' && cs.suspicious_reason === 'container_truncated')) {
    cs.suspicious = true;
    cs.suspicious_reason = why;
  }
  return cs;
}

/**
 * Remove zip entry / attachment NAMES from a content_scan, keeping the counts.
 * For callers that must not report names (a weak census match): mutates and
 * returns `cs`. entryBreakdown rows keep matches/severity/skipped, lose `name`.
 */
export function stripContentScanNames(cs) {
  if (cs && Array.isArray(cs.entryBreakdown)) {
    cs.entryBreakdown = cs.entryBreakdown.map(({ name, ...rest }) => rest);
  }
  return cs;
}

// Binary and archive extraction in a WORKER (security review 2026-09-28,
// finding 5) -- the DEFAULT for every caller since 2026-09-30 (`isolate`): the
// parsers -- SheetJS is synchronous -- then cannot block the event loop that
// keeps every attach hold alive. resourceLimits bound an inflating document.
//
// Budget: EXTRACTION_BUDGET_MS of the worker's own time. While the worker waits
// on an OCR of one of its image entries (run on the shared engine, background
// priority) the clock is PAUSED -- each image has its own OCR budget -- and
// EXTRACTION_HARD_MAX_MS caps the whole thing regardless. On expiry the worker
// is terminated and its queued OCR jobs are cancelled.
//
// Resolves { text, via, pages, sheets, truncated, suspicious } | { zip } | null
// | TIMED_OUT | { failed, suspicious? }.
const WORKER_URL = new URL('./extract-worker.js', import.meta.url);
export const WORKER_RESOURCE_LIMITS = { maxOldGenerationSizeMb: 512, maxYoungGenerationSizeMb: 64, stackSizeMb: 8 };
export const EXTRACTION_HARD_MAX_MS = 30 * 1000;
function extractIsolated(path, ext, { maxChars = 0 } = {}) {
  return new Promise((resolve) => {
    let done = false;
    let worker;
    let timer = null;
    let remaining = EXTRACTION_BUDGET_MS;
    let armedAt = 0;
    let outstanding = 0;
    const group = {};
    const finish = (v) => {
      if (done) return;
      done = true; clearTimeout(timer); clearTimeout(hard);
      cancelOcrGroup(group);
      try { worker?.terminate(); } catch {}
      resolve(v);
    };
    const pause = () => { if (timer) { clearTimeout(timer); timer = null; remaining -= Date.now() - armedAt; } };
    const resume = () => { armedAt = Date.now(); timer = setTimeout(() => finish(TIMED_OUT), Math.max(0, remaining)); timer.unref?.(); };
    let hard = null;
    try {
      worker = new Worker(WORKER_URL, { workerData: { path, ext, maxChars }, resourceLimits: WORKER_RESOURCE_LIMITS });
    } catch { resolve({ failed: 'extraction_failed' }); return; }
    armedAt = Date.now();
    timer = setTimeout(() => finish(TIMED_OUT), EXTRACTION_BUDGET_MS);
    timer.unref?.();
    hard = setTimeout(() => finish(TIMED_OUT), EXTRACTION_HARD_MAX_MS);
    hard.unref?.();
    worker.on('message', (m) => {
      if (done) return;
      if (m?.type === 'ocr') {
        if (outstanding++ === 0) pause();
        ocrImageBuffer(m.bytes, { priority: 'background', group }).then((result) => {
          if (done) return;
          if (--outstanding === 0) resume();
          try { worker.postMessage({ type: 'ocr_result', id: m.id, result }); } catch { /* worker gone */ }
        });
        return;
      }
      if (!m?.ok) finish({ failed: failureReason(m?.reason), suspicious: m?.suspicious || null });
      else if (m.none) finish(null);
      else if (m.zip) finish({ zip: m.zip });
      else finish({ text: m.text, via: m.via, pages: m.pages ?? undefined, sheets: m.sheets ?? undefined, truncated: !!m.truncated, suspicious: m.suspicious || null });
    });
    worker.once('error', (err) => finish(/ERR_WORKER_OUT_OF_MEMORY/.test(String(err?.code || err))
      ? { failed: 'too_large', suspicious: 'oom' } : { failed: 'extraction_failed' }));
    worker.once('exit', (code) => { if (!done) finish(code === 0 ? { failed: 'extraction_failed' } : { failed: 'too_large', suspicious: 'oom' }); });
  });
}

const SEVERITY_ORDER = ['low', 'moderate', 'high', 'critical'];

// How long any single extraction may run before we answer without it.
//
// The UI needs an answer within a bounded time — the same reasoning behind
// REWRITE_WRITE_BUDGET_MS on the rewrite path. Here the consumer is the
// attachment hold: index.js arms a short PROVISIONAL hold before this function
// is called and can only decide what to do with it once we return, so an
// extraction that never returns leaves the send in limbo. A full PDF / docx /
// xlsx / nested-zip extraction of an ordinary document finishes far inside 8s,
// and so does a warm OCR (ocr-service.js keeps one engine alive, loaded from
// bundled language data -- there is no download any more); anything past it is
// a hang, a pathological file, or a very large document near the 25 MB cap.
//
// In the worker (the default) the work is terminated too; on the in-process
// route (isolate:false) it keeps running in the background -- there is no
// cancellation token in mammoth / pdf-parse / SheetJS / jszip -- it just no
// longer decides anything. The outcome is reason:'extraction_timeout' with
// suspicious_reason 'self_timeout'.
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

// OCR one image through the shared engine (interactive priority), answering in
// extractBinary's shapes. The 8 MB cap is checked on the stat()ed size before
// any byte is read. Only a run-budget expiry is the image's own doing
// (self_timeout); a queue-ceiling expiry is not.
async function ocrImage(pth, size) {
  if (size > OCR_MAX_BYTES) return { failed: 'too_large', suspicious: 'oversize_unscanned_tail', capBytes: OCR_MAX_BYTES };
  const r = await ocrImageFile(pth, { budgetMs: EXTRACTION_BUDGET_MS, priority: 'interactive' });
  if (r.ok) return { text: r.text, via: 'tesseract' };
  if (r.reason === 'extraction_timeout') return r.selfTimeout ? TIMED_OUT : { failed: 'extraction_timeout' };
  return { failed: r.reason || 'extraction_failed' };
}

// ── Text over the scan cap ───────────────────────────────────────────────────
// Streamed in STREAM_CHUNK_BYTES reads, decoded with the file's BOM encoding,
// and cut at a line (else whitespace) boundary so a value is never split across
// two scan() calls. Up to TEXT_STREAM_MAX_BYTES the WHOLE file is scanned;
// beyond it, the first (TEXT_STREAM_MAX_BYTES - TEXT_TAIL_BYTES) and the last
// TEXT_TAIL_BYTES are, and bytesUnscanned says how much of the middle was not.
export const TEXT_STREAM_MAX_BYTES = 100 * 1024 * 1024;
export const TEXT_TAIL_BYTES = 8 * 1024 * 1024;
const STREAM_CHUNK_BYTES = 4 * 1024 * 1024;

function safeCut(s) {
  const nl = s.lastIndexOf('\n');
  if (nl >= 0) return nl + 1;
  for (let i = s.length - 1, stop = Math.max(0, s.length - 65536); i >= stop; i--) {
    const c = s.charCodeAt(i);
    if (c === 32 || c === 9 || c === 13) return i + 1;
  }
  return s.length >= 2 * STREAM_CHUNK_BYTES ? s.length : 0;
}

async function streamScanText(path, size) {
  const ranges = size <= TEXT_STREAM_MAX_BYTES
    ? [[0, size]]
    : [[0, TEXT_STREAM_MAX_BYTES - TEXT_TAIL_BYTES], [size - TEXT_TAIL_BYTES, size]];
  const agg = new Map();
  let newlines = 0;
  let scanned = 0;
  const add = (text) => {
    if (!text) return;
    for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) newlines++;
    for (const m of scan(text).matches) {
      const ex = agg.get(m.pattern);
      if (ex) ex.count += m.count;
      else agg.set(m.pattern, { pattern: m.pattern, class: m.class, severity: m.severity, count: m.count });
    }
  };
  let fh;
  try {
    fh = await open(path, 'r');
    const head = Buffer.alloc(4);
    await fh.read(head, 0, 4, 0);
    const { encoding, bom } = detectTextEncoding(head);
    const chunk = Buffer.allocUnsafe(STREAM_CHUNK_BYTES);
    for (const [from, to] of ranges) {
      const dec = new TextDecoder(encoding);
      let pos = from === 0 ? bom : from;
      if (encoding !== 'utf-8' && (pos - bom) % 2) pos++;   // stay on a UTF-16 code unit
      let pending = '';
      while (pos < to) {
        const { bytesRead } = await fh.read(chunk, 0, Math.min(STREAM_CHUNK_BYTES, to - pos), pos);
        if (!bytesRead) break;
        pos += bytesRead;
        pending += dec.decode(chunk.subarray(0, bytesRead), { stream: true });
        const cut = safeCut(pending);
        if (cut) { add(pending.slice(0, cut)); pending = pending.slice(cut); }
      }
      add(pending + dec.decode());
      scanned += pos - from;
    }
  } finally {
    await fh?.close().catch(() => {});
  }
  const matches = [...agg.values()];
  let top = null;
  for (const m of matches) if (SEVERITY_ORDER.indexOf(m.severity) > SEVERITY_ORDER.indexOf(top)) top = m.severity;
  return {
    scanned: true,
    via: 'utf8',
    bytesScanned: scanned,
    bytesUnscanned: Math.max(0, size - scanned),
    lineCount: newlines + 1,
    matchCount: matches.reduce((a, m) => a + m.count, 0),
    matches,
    contentSeverity: top,
  };
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

// One extraction answer -> content_scan. `extraction` is whatever extractBinary /
// ocrImage resolved to.
function scanFromExtraction(extraction, { ext, size, partial = false }) {
  if (extraction === TIMED_OUT) {
    return markSuspicious({ scanned: false, reason: 'extraction_timeout', extension: ext, budgetMs: EXTRACTION_BUDGET_MS }, 'self_timeout');
  }
  if (extraction?.failed) {
    const cs = { scanned: false, reason: failureReason(extraction.failed), extension: ext };
    if (cs.reason === 'too_large') cs.bytes = size;
    if (extraction.capBytes) cs.capBytes = extraction.capBytes;
    if (cs.reason === 'extraction_timeout') cs.budgetMs = EXTRACTION_BUDGET_MS;
    return markSuspicious(cs, extraction.suspicious);
  }
  if (!extraction) return { scanned: false, reason: 'unsupported_format', extension: ext };
  let text = String(extraction.text || '');
  let truncated = !!extraction.truncated;
  if (text.length > CONTENT_SCAN_MAX_BYTES) { text = text.slice(0, CONTENT_SCAN_MAX_BYTES); truncated = true; }
  const cs = scanExtractedText({
    text, via: extraction.via, bytesScanned: Math.min(size, CONTENT_SCAN_MAX_BYTES),
    pages: extraction.pages, sheets: extraction.sheets,
  });
  if (partial) cs.partial = true;
  if (truncated) { cs.partial = true; markSuspicious(cs, 'oversize_unscanned_tail'); }
  if (extraction.suspicious) { cs.partial = true; markSuspicious(cs, extraction.suspicious); }
  return cs;
}

// PARTIAL SCAN (user decision 2026-09-28, composer census only): a file over
// CONTENT_SCAN_MAX_BYTES is not waved through unscanned. A text file is stream-
// scanned (whole up to TEXT_STREAM_MAX_BYTES, head + tail beyond); a binary
// document up to PARTIAL_BINARY_MAX_BYTES has its first CONTENT_SCAN_MAX_BYTES
// characters of extracted text scanned -- and content_scan says so
// (partial:true; bytesUnscanned / suspicious when anything was left unread). A
// sensitive hit holds the send like any other. Anything too big even for that is
// too_large + suspicious 'oversize_unscanned_tail'.
export const PARTIAL_BINARY_MAX_BYTES = 50 * 1024 * 1024;

/**
 * Build a `file_upload`-kind DLP event for a file at `path`. `via` describes
 * how the file got referenced (clipboard_file_copy | open_file_dialog).
 *
 * Returns null if the path doesn't exist (race with the user — file was
 * deleted, moved, or never resolvable from clipboard) — caller should skip.
 *
 * `isolate` (default true): run binary/archive extraction in the worker (see
 *   extractIsolated). false = in-process, kept for tests and tools.
 * `quiet`: never put the filename, path or an entry name in a log line (the
 *   census routes: finding 12) -- only an error code.
 */
export async function buildFileUploadEvent({
  path, via, service, vendor, processName, windowTitle, log, partialScan = false,
  isolate = true, quiet = false,
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

  // Try to scan content. Routing:
  //   1) Text-readable formats (.env, .csv, .json, source code, etc.) — decoded text
  //   2) Binary documents (.docx, .pdf, .xlsx, .pptx, ...) and images (OCR)
  //   3) .zip — every entry through the same extractors
  //   4) Anything else — filename-class only
  const ext = extOf(filename);
  const readable = isTextReadable(filename) || isBinaryParseable(filename) || isImage(filename) || isArchive(filename);
  let contentScan = null;
  // Captured content forwarded to the server for inline preview. Either
  // `content_text` (decoded text) or `content_base64` (binary).
  let capturedText = null;
  let capturedBase64 = null;
  let capturedMime = null;
  // Set by any capture below that had to stop at CONTENT_CAPTURE_MAX_BYTES, so
  // the preview is never silently presented as the whole file.
  let captureTruncated = false;
  if (st.size > CONTENT_SCAN_MAX_BYTES && partialScan && isTextReadable(filename)) {
    try {
      contentScan = await streamScanText(path, st.size);
      contentScan.partial = true;
      if (contentScan.bytesUnscanned > 0) markSuspicious(contentScan, 'oversize_unscanned_tail');
      const { buf } = await readCapped(path, CONTENT_SCAN_MAX_BYTES, st.size);
      capturedText = decodeText(buf);
      captureTruncated = true;
      capturedMime = 'text/plain; charset=utf-8';
    } catch (err) {
      contentScan = { scanned: false, reason: 'extraction_failed', error: String(err?.message || err) };
    }
  } else if (st.size > CONTENT_SCAN_MAX_BYTES && partialScan && isBinaryParseable(filename) && st.size <= PARTIAL_BINARY_MAX_BYTES) {
    try {
      const extraction = await extractBinary(path, ext, CONTENT_SCAN_MAX_BYTES);
      contentScan = scanFromExtraction(extraction, { ext, size: st.size, partial: true });
    } catch (err) {
      contentScan = { scanned: false, reason: failureReason(err?.cfaiReason), extension: ext, error: String(err?.message || err) };
      markSuspicious(contentScan, err?.cfaiSuspicious);
    }
    try {
      const { buf, truncated } = await readCapped(path, CONTENT_CAPTURE_MAX_BYTES, st.size);
      capturedBase64 = buf.toString('base64');
      capturedMime = mimeFromExt(ext) || 'application/octet-stream';
      captureTruncated = captureTruncated || truncated;
    } catch { /* leave null */ }
  } else if (st.size > CONTENT_SCAN_MAX_BYTES) {
    contentScan = { scanned: false, reason: 'too_large', bytes: st.size };
    if (readable) markSuspicious(contentScan, 'oversize_unscanned_tail');
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
      const text = decodeText(buf);
      capturedText = text;
      capturedMime = 'text/plain; charset=utf-8';
      contentScan = scanExtractedText({ text, via: 'utf8', bytesScanned: st.size });
    } catch (err) {
      contentScan = { scanned: false, reason: 'extraction_failed', error: String(err?.message || err) };
    }
  } else if (isBinaryParseable(filename) || isImage(filename)) {
    try {
      // Images go to the one warm OCR thread (ocr-service.js) on every route; it
      // is already off the event loop and enforces its own budget, so there is
      // nothing to gain from a fresh extract worker per image -- and a fresh
      // worker is exactly the per-image cold start this replaced.
      const extraction = isImage(filename) ? await ocrImage(path, st.size) : await extractBinary(path, ext, CONTENT_SCAN_MAX_BYTES);
      if (extraction === TIMED_OUT) {
        log?.warn(quiet ? `file-handler: extraction exceeded ${EXTRACTION_BUDGET_MS}ms — answering without it` : `file-handler: extraction of ${filename} exceeded ${EXTRACTION_BUDGET_MS}ms — answering without it`);
      }
      contentScan = scanFromExtraction(extraction, { ext, size: st.size });
    } catch (err) {
      log?.warn(quiet ? `file-handler: binary extraction failed (${err?.code || err?.name || 'error'})` : `file-handler: binary extraction failed for ${filename}: ${err?.message || err}`);
      contentScan = {
        scanned: false,
        reason: failureReason(err?.cfaiReason),
        extension: ext,
        error: String(err?.message || err),
      };
      markSuspicious(contentScan, err?.cfaiSuspicious);
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
      if (isolate) {
        const res = await extractIsolated(path, '.zip', { maxChars: 0 });
        contentScan = res?.zip
          ? summarizeZipScan(res.zip, scan, st.size)
          : scanFromExtraction(res, { ext, size: st.size });
      } else {
        const zipScan = await withExtractionBudget(extractZip({ path, scan, log }));
        contentScan = zipScan === TIMED_OUT
          ? markSuspicious({ scanned: false, reason: 'extraction_timeout', extension: ext, budgetMs: EXTRACTION_BUDGET_MS }, 'self_timeout')
          : zipScan;
      }
      if (contentScan?.reason === 'extraction_timeout') {
        log?.warn(quiet ? `file-handler: zip extraction exceeded ${EXTRACTION_BUDGET_MS}ms — answering without it` : `file-handler: zip extraction of ${filename} exceeded ${EXTRACTION_BUDGET_MS}ms — answering without it`);
      }
    } catch (err) {
      log?.warn(quiet ? `file-handler: zip extraction failed (${err?.code || err?.name || 'error'})` : `file-handler: zip extraction failed for ${filename}: ${err?.message || err}`);
      contentScan = { scanned: false, reason: failureReason(err?.cfaiReason), extension: ext, error: String(err?.message || err) };
      markSuspicious(contentScan, err?.cfaiSuspicious);
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
  // `unverified` states, on the scan result, the one fact `severity` cannot: a
  // file that was never scanned has no contentSeverity to raise, so an encrypted
  // PDF full of customer data scores exactly what an empty one does.
  //
  // TRUE only when BOTH halves hold: nothing was scanned, AND the format is one
  // that should have been readable (isDocumentLikeFormat — see its comment for
  // why an unopenable .7z counts and a .mp4 does not). Media, images and
  // unknown extensions stay `false`.
  //
  // It is a SIGNAL, not a decision -- and a weaker one than `suspicious` (see the
  // contract at the top of this file): the consumer (index.js) decides what, if
  // anything, it holds on.
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
    '.docm': 'application/vnd.ms-word.document.macroEnabled.12',
    '.dotx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.template',
    '.xlsm': 'application/vnd.ms-excel.sheet.macroEnabled.12',
    '.xlsb': 'application/vnd.ms-excel.sheet.binary.macroEnabled.12',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.pptm': 'application/vnd.ms-powerpoint.presentation.macroEnabled.12',
    '.ppsx': 'application/vnd.openxmlformats-officedocument.presentationml.slideshow',
    '.odt':  'application/vnd.oasis.opendocument.text',
    '.odp':  'application/vnd.oasis.opendocument.presentation',
    '.ods':  'application/vnd.oasis.opendocument.spreadsheet',
    '.eml':  'message/rfc822',
    '.rtf':  'application/rtf',
    '.tif':  'image/tiff',
    '.tiff': 'image/tiff',
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

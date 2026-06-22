// Given a file path the user copied or selected for upload to an AI app,
// build a `file_upload` DLP event matching the shape the server's
// /api/v1/dlp endpoint expects (same shape the browser extension uses).
//
// As of 2026-05-18 the event also carries the raw bytes (or text, for
// text-readable formats) so the dashboard can render an inline preview.
// See [[project_content_storage]] in memory for the policy context.

import { stat, readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import {
  scan,
  classifyFile,
  sizeBucket,
  isTextReadable,
  isBinaryParseable,
  isImage,
  isArchive,
  extOf,
  CONTENT_SCAN_MAX_BYTES,
} from './classifier.js';
import { extractTextFromBinary, extractZip } from './binary-extractors.js';

const SEVERITY_ORDER = ['low', 'moderate', 'high', 'critical'];

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
export async function buildFileUploadEvent({ path, via, service, vendor, processName, windowTitle, log }) {
  let st;
  try { st = await stat(path); }
  catch (err) {
    if (err.code === 'ENOENT') return null;
    log?.warn(`file-handler: stat failed for ${path}: ${err.message}`);
    return null;
  }
  if (!st.isFile()) return null;   // directories, devices etc. — skip

  const filename = basename(path);
  const r = classifyFile(filename);

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
  if (st.size > CONTENT_SCAN_MAX_BYTES) {
    contentScan = { scanned: false, reason: 'too_large', bytes: st.size };
    // Still capture the bytes for preview if we can. They're already on disk;
    // failing to forward is worse than skipping the local scan.
    try {
      const buf = await readFile(path);
      capturedBase64 = buf.toString('base64');
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
      const extraction = await extractTextFromBinary(path, ext);
      if (!extraction) {
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
      log?.warn(`file-handler: binary extraction failed for ${filename}: ${err?.message || err}`);
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
      const buf = await readFile(path);
      capturedBase64 = buf.toString('base64');
      capturedMime = mimeFromExt(ext) || 'application/octet-stream';
    } catch { /* leave null */ }
  } else if (isArchive(filename)) {
    try {
      contentScan = await extractZip({ path, scan, log });
    } catch (err) {
      log?.warn(`file-handler: zip extraction failed for ${filename}: ${err?.message || err}`);
      contentScan = { scanned: false, reason: 'zip_failed', error: String(err?.message || err) };
    }
    try {
      const buf = await readFile(path);
      capturedBase64 = buf.toString('base64');
      capturedMime = 'application/zip';
    } catch { /* leave null */ }
  } else {
    contentScan = { scanned: false, reason: 'unsupported_format', extension: ext };
    // Last-resort: still try to send bytes for unknown extensions so the
    // dashboard can offer a download link.
    try {
      const buf = await readFile(path);
      capturedBase64 = buf.toString('base64');
      capturedMime = 'application/octet-stream';
    } catch { /* leave null */ }
  }

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

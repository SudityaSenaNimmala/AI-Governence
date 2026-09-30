// Text extraction for binary file formats. Mirrors the formats the browser
// extension handles via PDF.js / SheetJS / mammoth / JSZip / tesseract (which it
// loads in the renderer). Here we run them in Node -- normally inside the
// isolated extract worker (extract-worker.js), never on the monitor's loop.
//
// Everything works on BYTES (extractFromBuffer). Zip entries and .eml
// attachments are extracted in memory and are never spooled to disk, so no
// temp copy of a user's file is ever written next to it or anywhere else.
//
// All extractors return { text, via, pages?, sheets?, suspicious? } on success,
// or throw. A throw that carries `cfaiReason` names WHY the file could not be
// read, in the content_scan.reason vocabulary (file-handler.js
// SCAN_FAILURE_REASONS); `cfaiSuspicious` additionally names an
// attacker-controllable cause (SUSPICIOUS_REASONS below). A throw without either
// is a plain 'extraction_failed'.
//
// Privacy: only the count of pattern matches leaves this machine. The
// extracted text stays in memory locally for the duration of the scan.

import { readFile } from 'node:fs/promises';
import {
  isBinaryParseable, isImage, isTextReadable, isDocumentLikeFormat, OCR_MAX_BYTES, CONTENT_SCAN_MAX_BYTES,
} from './classifier.js';
import { ocrImageBuffer } from './ocr-service.js';

let mammothMod, xlsxMod, pdfParseMod, jszipMod;
async function getMammoth() { return (mammothMod ??= (await import('mammoth'))); }
async function getXlsx()    { return (xlsxMod    ??= (await import('xlsx')).default || (await import('xlsx'))); }
async function getPdfParse() {
  if (!pdfParseMod) {
    // pdf-parse exposes a default function export; some bundlers wrap it.
    const m = await import('pdf-parse');
    pdfParseMod = m.default || m;
  }
  return pdfParseMod;
}
async function getJszip() {
  if (!jszipMod) {
    const m = await import('jszip');
    jszipMod = m.default || m;
  }
  return jszipMod;
}

// ── content_scan.suspicious_reason vocabulary ────────────────────────────────
// A readable file failed, or was only partly read, in a way the file's AUTHOR
// controls. See file-handler.js for where each is set on content_scan.
export const SUSPICIOUS_REASONS = Object.freeze([
  'decompression_ratio',     // zip/OOXML/ODF expands far past its size: not inflated
  'self_timeout',            // the file's own extraction ran out its budget
  'oom',                     // the isolated extract worker hit its memory limit
  'oversize_unscanned_tail', // over a size cap: all or part of the content unread
  'container_truncated',     // zip/.eml: entries skipped (depth, count, encrypted, failed, ...)
]);

export function tagged(reason, message, suspicious = null) {
  const e = new Error(message || reason);
  e.cfaiReason = reason;
  if (suspicious) e.cfaiSuspicious = suspicious;
  return e;
}

// Default OCR route for in-process extraction (zip entries, .eml attachments):
// the shared warm engine, at background priority so an interactive screenshot
// is never queued behind an archive's images. The extract worker replaces this
// with a proxy to the parent (extract-worker.js).
const DEFAULT_CTX = Object.freeze({
  depth: 0,
  ocr: (bytes, opts = {}) => ocrImageBuffer(bytes, { priority: 'background', ...opts }),
});

// ── Container limits ─────────────────────────────────────────────────────────
const ZIP_MAX_DEPTH       = 3;
const ZIP_MAX_ENTRIES     = 200;
const ZIP_MAX_OCR_ENTRIES = 20;
const EML_MAX_ATTACHMENTS = 50;
// Decompression bomb: refuse to inflate when the expanded total is both large
// and far out of proportion to the compressed size, or simply absurd. Read from
// the central directory (JSZip's _data sizes) BEFORE anything is inflated. A
// directory that LIES about sizes is caught by the worker's resourceLimits
// instead ('oom').
export const BOMB_RATIO        = 100;
export const BOMB_MIN_EXPANDED = 50 * 1024 * 1024;
export const BOMB_ABS_EXPANDED = 400 * 1024 * 1024;
// Total extracted text a container may contribute (matches the scan cap).
const PARTS_MAX_CHARS = CONTENT_SCAN_MAX_BYTES;

export function zipExpansion(zip) {
  let expanded = 0; let compressed = 0;
  for (const f of Object.values(zip.files)) {
    if (f.dir) continue;
    expanded += Number(f._data?.uncompressedSize) || 0;
    compressed += Number(f._data?.compressedSize) || 0;
  }
  return { expanded, compressed };
}

export function isDecompressionBomb({ expanded, compressed }) {
  if (expanded > BOMB_ABS_EXPANDED) return true;
  return expanded > BOMB_MIN_EXPANDED && expanded > BOMB_RATIO * Math.max(compressed, 1);
}

async function loadZipChecked(buf) {
  const JSZip = await getJszip();
  const zip = await JSZip.loadAsync(buf);
  if (isDecompressionBomb(zipExpansion(zip))) throw tagged('too_large', 'decompression_ratio', 'decompression_ratio');
  return zip;
}

// ── Encrypted-container detection ────────────────────────────────────────────
//
// An OOXML or ODF document is a ZIP. When Office password-protects one it wraps
// the encrypted package in a Compound File Binary (OLE2) container holding an
// EncryptionInfo and an EncryptedPackage stream. CFB bytes under an OOXML name
// WITHOUT those streams are a legacy binary file that was renamed (.xls ->
// .xlsx, .doc -> .docx): read as legacy where we can (SheetJS reads .xls), and
// 'unsupported_format' where we cannot (.doc/.ppt) -- never 'encrypted'.
const CFB_MAGIC = [0xd0, 0xcf, 0x11, 0xe0];
const ZIP_CONTAINER_EXTENSIONS = new Set([
  '.docx', '.docm', '.dotx', '.xlsx', '.xlsm', '.xlsb',
  '.pptx', '.pptm', '.ppsx', '.odt', '.odp', '.ods',
]);
const SHEET_EXTENSIONS = new Set(['.xlsx', '.xls', '.xlsm', '.xlsb', '.ods']);

export function hasCfbMagic(head) {
  return !!head && head.length >= 4 && CFB_MAGIC.every((b, i) => head[i] === b);
}

/** 'encrypted' | 'legacy' | 'invalid' for a buffer that starts with the CFB magic. */
export async function cfbKind(buf) {
  const XLSX = await getXlsx();
  let names;
  try {
    names = XLSX.CFB.read(buf, { type: 'buffer' }).FileIndex.map((f) => f.name);
  } catch {
    return 'invalid';
  }
  return names.includes('EncryptionInfo') || names.includes('EncryptedPackage') ? 'encrypted' : 'legacy';
}

// Kept for callers that only have the first bytes: true when the magic is on a
// zip-container extension (a HINT; cfbKind decides).
export function isCfbEncryptedContainer(head, ext) {
  return ZIP_CONTAINER_EXTENSIONS.has(String(ext || '').toLowerCase()) && hasCfbMagic(head);
}

// ── Text decoding ────────────────────────────────────────────────────────────
/** Decode text bytes honouring a UTF-8 / UTF-16LE / UTF-16BE byte-order mark. */
export function detectTextEncoding(b) {
  if (b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) return { encoding: 'utf-8', bom: 3 };
  if (b.length >= 2 && b[0] === 0xff && b[1] === 0xfe) return { encoding: 'utf-16le', bom: 2 };
  if (b.length >= 2 && b[0] === 0xfe && b[1] === 0xff) return { encoding: 'utf-16be', bom: 2 };
  return { encoding: 'utf-8', bom: 0 };
}
export function decodeText(buf) {
  const b = buf instanceof Uint8Array ? buf : Buffer.from(buf);
  const { encoding, bom } = detectTextEncoding(b);
  return new TextDecoder(encoding).decode(b.subarray(bom));
}

// ── XML helpers ──────────────────────────────────────────────────────────────
const XML_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
export function decodeXmlEntities(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try { return String.fromCodePoint(cp); } catch { return m; }
    }
    return XML_ENTITIES[e.toLowerCase()] ?? m;
  });
}

function numericOrder(a, b) {
  const na = Number((a.match(/(\d+)\.xml$/) || [])[1] || 0);
  const nb = Number((b.match(/(\d+)\.xml$/) || [])[1] || 0);
  return na - nb || a.localeCompare(b);
}

// DrawingML text: runs are <a:t>, paragraphs end at </a:p>. Runs are joined
// without a separator because Office splits one word across runs freely.
export function drawingMlText(xml) {
  const out = [];
  const re = /<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>|<a:t\s*\/>|<\/a:p>|<a:br\s*\/?>/g;
  let m;
  while ((m = re.exec(xml))) {
    if (m[1] !== undefined) out.push(decodeXmlEntities(m[1]));
    else if (m[0].startsWith('</a:p') || m[0].startsWith('<a:br')) out.push('\n');
  }
  return out.join('');
}

// ODF text: everything inside office:body, with the whitespace elements
// (text:s / text:tab / text:line-break) and paragraph/heading ends restored.
export function odfText(xml) {
  const body = (xml.match(/<office:body[\s>][\s\S]*<\/office:body>/) || [xml])[0];
  return decodeXmlEntities(body
    .replace(/<text:s(?:\s+text:c="(\d+)")?\s*\/>/g, (_, c) => ' '.repeat(Math.min(Number(c) || 1, 256)))
    .replace(/<text:tab\s*\/>/g, '\t')
    .replace(/<text:line-break\s*\/>/g, '\n')
    .replace(/<\/text:(?:p|h)>/g, '\n')
    .replace(/<\/table:table-cell>/g, '\t')
    .replace(/<[^>]+>/g, ''));
}

// ── Extractors (bytes in) ────────────────────────────────────────────────────

async function extractDocxBuf(buf) {
  const mammoth = await getMammoth();
  // extractRawText reads paragraphs & runs without formatting noise — ideal
  // for pattern matching. Tables, headers, footers, footnotes all included.
  // .docm / .dotx carry the same word/document.xml part, so mammoth reads them.
  const result = await mammoth.extractRawText({ buffer: buf });
  return { text: result.value || '', via: 'mammoth' };
}

function isPdfPasswordError(err) {
  return err?.name === 'PasswordException' || /password/i.test(String(err?.message || ''));
}

async function extractPdfBuf(buf) {
  const pdfParse = await getPdfParse();
  // pdf-parse's bundled pdf.js (v1.10) is handed a PLAIN Uint8Array that owns
  // its memory: given a Node Buffer it can mis-lex the file ("bad XRef entry",
  // "Invalid number") -- and a pooled Buffer's byteOffset is ignored outright --
  // which turned a password-protected PDF into a generic parse failure instead
  // of the PasswordException that identifies it.
  const data = new Uint8Array(buf);
  let result;
  try {
    result = await pdfParse(data);
  } catch (err) {
    if (isPdfPasswordError(err)) throw tagged('encrypted', 'pdf_password_required');
    throw err;
  }
  return { text: result.text || '', via: 'pdf-parse', pages: result.numpages || null };
}

async function extractSheetBuf(buf) {
  const XLSX = await getXlsx();
  let wb;
  try {
    wb = XLSX.read(buf, { type: 'buffer' });
  } catch (err) {
    if (/password|encrypt/i.test(String(err?.message || ''))) throw tagged('encrypted', 'workbook_password_protected');
    throw err;
  }
  const sheetNames = wb.SheetNames || [];
  // Stringify every sheet as CSV-like text so regexes see cell values
  // including dates, numbers stored as text, etc. CSV keeps row/column
  // structure intact which is what users see when looking at the file.
  const parts = [];
  for (const name of sheetNames) {
    const sheet = wb.Sheets[name];
    if (!sheet) continue;
    try {
      const csv = XLSX.utils.sheet_to_csv(sheet);
      parts.push(`# Sheet: ${name}\n${csv}`);
    } catch {
      // skip un-stringifiable sheets
    }
  }
  return { text: parts.join('\n\n'), via: 'sheetjs', sheets: sheetNames.length };
}

// .pptx / .pptm / .ppsx: slide text and speaker notes, in slide order.
async function extractPptxZip(zip) {
  const names = Object.keys(zip.files);
  const slides = names.filter((n) => /^ppt\/slides\/slide\d+\.xml$/i.test(n)).sort(numericOrder);
  const notes = names.filter((n) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/i.test(n)).sort(numericOrder);
  const parts = [];
  for (const n of slides) parts.push(drawingMlText(await zip.files[n].async('string')));
  for (const n of notes) parts.push(drawingMlText(await zip.files[n].async('string')));
  return { text: parts.join('\n'), via: 'jszip-pptx', pages: slides.length };
}

// .odt / .odp: content.xml carries the document text (styles.xml only adds
// header/footer boilerplate, which is included too when present).
async function extractOdfZip(zip) {
  const content = zip.file('content.xml');
  if (!content) throw new Error('odf_missing_content');
  const parts = [odfText(await content.async('string'))];
  const styles = zip.file('styles.xml');
  if (styles) {
    const s = await styles.async('string');
    const hf = s.match(/<style:(?:header|footer)[\s>][\s\S]*?<\/style:(?:header|footer)>/g) || [];
    for (const h of hf) parts.push(odfText(h));
  }
  return { text: parts.join('\n'), via: 'jszip-odf' };
}

// ── .eml ─────────────────────────────────────────────────────────────────────
// A bounded MIME walk: the people/subject headers, every text/* part decoded
// from base64 / quoted-printable in its declared charset, and ATTACHMENTS run
// through the same extractors as a top-level file (documents, images via OCR,
// zips). An attachment that cannot be read -- over the cap, encrypted, a
// document format we have no parser for, past the attachment cap -- makes the
// message 'container_truncated': it is not reported as clean.
function decodeQuotedPrintableBytes(s) {
  const bin = s.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
  return Buffer.from(bin, 'latin1');
}
function decodeCharset(bytes, charset) {
  try { return new TextDecoder(charset || 'utf-8').decode(bytes); }
  catch { return new TextDecoder('utf-8').decode(bytes); }
}
function decodeEncodedWords(s) {
  return String(s).replace(/=\?([^?]+)\?([bq])\?([^?]*)\?=/gi, (m, cs, enc, data) => {
    try {
      const bytes = enc.toLowerCase() === 'b' ? Buffer.from(data, 'base64') : decodeQuotedPrintableBytes(data.replace(/_/g, ' '));
      return decodeCharset(bytes, cs);
    } catch { return m; }
  });
}
function parseHeaders(block) {
  const headers = {};
  for (const line of block.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i > 0) headers[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
  }
  return headers;
}
function headerParam(value, name) {
  const m = String(value || '').match(new RegExp(`(?:^|;)\\s*${name}\\*?\\s*=\\s*(?:"([^"]*)"|([^;\\s]+))`, 'i'));
  return m ? decodeEncodedWords(m[1] ?? m[2]) : null;
}
export function htmlToText(html) {
  return decodeXmlEntities(String(html)
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' '));
}
function mimeWalk(raw, depth, out) {
  if (depth > 8) { out.incomplete = true; return; }
  const m = raw.match(/\r?\n\r?\n/);
  const headBlock = m ? raw.slice(0, m.index) : raw;
  const body = m ? raw.slice(m.index + m[0].length) : '';
  const h = parseHeaders(headBlock);
  if (depth === 0) {
    for (const k of ['from', 'to', 'cc', 'bcc', 'reply-to', 'subject']) {
      if (h[k]) out.text.push(`${k}: ${decodeEncodedWords(h[k])}`);
    }
  }
  const ctRaw = h['content-type'] || 'text/plain';
  const ctype = ctRaw.toLowerCase();
  const boundary = headerParam(ctRaw, 'boundary');
  if (ctype.startsWith('multipart/') && boundary) {
    const esc = boundary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pieces = body.split(new RegExp(`\\r?\\n?--${esc}(?:--)?[ \\t]*\\r?\\n?`));
    for (const p of pieces) if (p.trim()) mimeWalk(p, depth + 1, out);
    return;
  }
  if (ctype.startsWith('message/rfc822')) { mimeWalk(body, depth + 1, out); return; }
  const cte = (h['content-transfer-encoding'] || '').toLowerCase();
  const bytes = cte === 'base64' ? Buffer.from(body.replace(/\s+/g, ''), 'base64')
    : cte === 'quoted-printable' ? decodeQuotedPrintableBytes(body)
      : Buffer.from(body, 'latin1');
  const disposition = String(h['content-disposition'] || '').toLowerCase();
  const filename = headerParam(h['content-disposition'], 'filename') || headerParam(ctRaw, 'name');
  const isAttachment = disposition.startsWith('attachment') || (!!filename && !ctype.startsWith('text/'));
  if (!isAttachment && ctype.startsWith('text/')) {
    const text = decodeCharset(bytes, headerParam(ctRaw, 'charset'));
    out.text.push(ctype.startsWith('text/html') ? htmlToText(text) : text);
    return;
  }
  if (isAttachment || filename) out.attachments.push({ filename: filename || 'attachment', ctype, bytes });
}

async function extractEmlBuf(buf, ctx) {
  // latin1 keeps every byte addressable; decoded parts are re-read per charset.
  const out = { text: [], attachments: [], incomplete: false };
  mimeWalk(Buffer.from(buf).toString('latin1'), 0, out);
  let suspicious = out.incomplete ? 'container_truncated' : null;
  let chars = out.text.reduce((a, t) => a + t.length, 0);
  let n = 0;
  for (const att of out.attachments) {
    if (++n > EML_MAX_ATTACHMENTS) { suspicious ??= 'container_truncated'; break; }
    try {
      const r = await extractEntryText(att.filename, att.bytes, ctx);
      if (r.skipped) { if (r.incomplete) suspicious ??= r.suspicious || 'container_truncated'; continue; }
      if (r.suspicious) suspicious ??= r.suspicious;
      let t = r.text || '';
      if (chars + t.length > PARTS_MAX_CHARS) { t = t.slice(0, Math.max(0, PARTS_MAX_CHARS - chars)); suspicious ??= 'container_truncated'; }
      chars += t.length;
      out.text.push(`# Attachment: ${att.filename}\n${t}`);
    } catch (err) {
      suspicious = err?.cfaiSuspicious === 'decompression_ratio' ? 'decompression_ratio' : (suspicious ?? 'container_truncated');
    }
  }
  const res = { text: out.text.join('\n'), via: 'mime' };
  if (suspicious) res.suspicious = suspicious;
  return res;
}

// Back-compat text-only helper (headers + text parts; attachments not opened).
export function emlToText(raw) {
  const out = { text: [], attachments: [], incomplete: false };
  mimeWalk(String(raw), 0, out);
  return out.text.join('\n');
}

// ── .rtf ─────────────────────────────────────────────────────────────────────
// Tokenise and keep only text: control words dropped, \par/\tab/\line and the
// typographic words mapped to characters, \'hh and \uN decoded (honouring \ucN
// fallback skipping), and non-text destinations (font/colour/style tables,
// pictures, embedded objects, field instructions, \* groups) skipped whole.
// Header/footer/footnote/comment text IS kept -- that is exactly where a
// document hides a name or an account number.
const RTF_SKIP_DESTINATIONS = new Set([
  'fonttbl', 'colortbl', 'stylesheet', 'info', 'pict', 'object', 'objdata', 'themedata',
  'colorschememapping', 'datastore', 'latentstyles', 'listtable', 'listoverridetable',
  'rsidtbl', 'generator', 'xmlnstbl', 'fldinst', 'filetbl', 'revtbl', 'pgptbl',
  'protusertbl', 'listtext', 'pntext', 'bkmkstart', 'bkmkend', 'shpinst', 'blipuid',
  'fontemb', 'fontfile', 'userprops', 'wgrffmtfilter', 'passwordhash', 'defchp', 'defpap',
]);
const RTF_SPECIAL = {
  par: '\n', sect: '\n\n', page: '\n\n', line: '\n', row: '\n', tab: '\t', cell: '\t', nestcell: '\t',
  emdash: '—', endash: '–', emspace: ' ', enspace: ' ', qmspace: ' ', bullet: '•',
  lquote: '‘', rquote: '’', ldblquote: '“', rdblquote: '”',
};
export function rtfToText(src) {
  const re = /\\([a-z]{1,32})(-?\d{1,10})?[ ]?|\\'([0-9a-f]{2})|\\([^a-z])|([{}])|([\r\n]+)|([^\\{}\r\n]+)/gi;
  const stack = [];
  let ignorable = false;
  let ucskip = 1;
  let curskip = 0;
  const out = [];
  let m;
  while ((m = re.exec(src))) {
    const [, word, arg, hex, ch, brace, , text] = m;
    if (brace) {
      curskip = 0;
      if (brace === '{') stack.push([ucskip, ignorable]);
      else if (stack.length) [ucskip, ignorable] = stack.pop();
    } else if (ch) {
      curskip = 0;
      if (ch === '~') { if (!ignorable) out.push(String.fromCharCode(0xa0)); }
      else if (ch === '_') { if (!ignorable) out.push('-'); }
      else if ('{}\\'.includes(ch)) { if (!ignorable) out.push(ch); }
      else if (ch === '*') ignorable = true;
    } else if (word) {
      curskip = 0;
      const w = word.toLowerCase();
      if (RTF_SKIP_DESTINATIONS.has(w)) ignorable = true;
      else if (ignorable) { /* inside a skipped destination */ }
      else if (RTF_SPECIAL[w] !== undefined) out.push(RTF_SPECIAL[w]);
      else if (w === 'uc') ucskip = Number(arg) || 0;
      else if (w === 'u') {
        let c = Number(arg) || 0;
        if (c < 0) c += 0x10000;
        out.push(String.fromCharCode(c));
        curskip = ucskip;
      }
    } else if (hex) {
      if (curskip > 0) curskip--;
      else if (!ignorable) out.push(Buffer.from([parseInt(hex, 16)]).toString('latin1'));
    } else if (text) {
      let t = text;
      if (curskip > 0) { const n = Math.min(curskip, t.length); t = t.slice(n); curskip -= n; }
      if (t && !ignorable) out.push(t);
    }
  }
  return out.join('');
}

async function extractImageBuf(buf, ctx) {
  if (buf.length > OCR_MAX_BYTES) throw tagged('too_large', 'image_over_ocr_cap', 'oversize_unscanned_tail');
  const r = await ctx.ocr(buf);
  if (!r?.ok) throw tagged(r?.reason || 'extraction_failed', r?.error || r?.reason, r?.selfTimeout ? 'self_timeout' : null);
  return { text: r.text || '', via: 'tesseract' };
}

/**
 * Route by extension over BYTES. Returns { text, via, pages?, sheets?,
 * suspicious? }, or null if no extractor handles the extension (or a CFB file
 * under an OOXML name turns out to be a legacy .doc/.ppt we cannot read).
 */
export async function extractFromBuffer(buf, ext, ctx = DEFAULT_CTX) {
  const e = String(ext || '').toLowerCase();
  if (ZIP_CONTAINER_EXTENSIONS.has(e) && hasCfbMagic(buf)) {
    const kind = await cfbKind(buf);
    if (kind === 'encrypted') throw tagged('encrypted', 'cfb_encrypted_package');
    if (kind === 'invalid') throw new Error('cfb_unreadable');
    // A legacy binary file under a modern name.
    return SHEET_EXTENSIONS.has(e) ? extractSheetBuf(buf) : null;
  }
  switch (e) {
    case '.docx':
    case '.docm':
    case '.dotx': await loadZipChecked(buf); return extractDocxBuf(buf);
    case '.pdf':  return extractPdfBuf(buf);
    case '.xlsx':
    case '.xlsm':
    case '.xlsb':
    case '.ods':  await loadZipChecked(buf); return extractSheetBuf(buf);
    case '.xls':  return extractSheetBuf(buf);
    case '.pptx':
    case '.pptm':
    case '.ppsx': return extractPptxZip(await loadZipChecked(buf));
    case '.odt':
    case '.odp':  return extractOdfZip(await loadZipChecked(buf));
    case '.eml':  return extractEmlBuf(buf, ctx);
    case '.rtf':  return { text: rtfToText(Buffer.from(buf).toString('latin1')), via: 'rtf' };
    case '.png':
    case '.jpg':
    case '.jpeg':
    case '.gif':
    case '.bmp':
    case '.webp':
    case '.tif':
    case '.tiff': return extractImageBuf(buf, ctx);
    default:      return null;
  }
}

/** Path wrapper kept for callers and the extract worker. */
export async function extractTextFromBinary(path, ext, ctx = DEFAULT_CTX) {
  return extractFromBuffer(await readFile(path), ext, ctx);
}

// ── One container entry (zip entry or .eml attachment) → text ────────────────
//
// { text, via, suspicious? } when read; { skipped, incomplete, suspicious? } when
// not. `incomplete` is true when the skip means we cannot call the container
// clean: anything that should have been readable. A media file or an unknown
// extension inside an archive is skipped WITHOUT making the archive incomplete,
// exactly as a top-level one is not held.
function extOfName(name) {
  const lower = String(name).toLowerCase();
  const base = lower.slice(Math.max(lower.lastIndexOf('/'), lower.lastIndexOf('\\')) + 1);
  const dot = base.lastIndexOf('.');
  return dot < 0 ? '' : base.slice(dot);
}
function isEnvStyleName(name) {
  return /(^|[\\/])\.env(\.|$)/i.test(name);
}

async function extractEntryText(name, bytes, ctx) {
  const ext = extOfName(name);
  const depth = (ctx.depth || 0) + 1;
  if (bytes.length > CONTENT_SCAN_MAX_BYTES) return { skipped: 'too_large', incomplete: true };
  if (isTextReadable(name) || isEnvStyleName(name)) return { text: decodeText(bytes), via: 'utf8' };
  if (ext === '.zip') {
    if (depth >= ZIP_MAX_DEPTH) return { skipped: 'max_depth', incomplete: true };
    const z = await walkZip(bytes, { ...ctx, depth });
    return { text: z.parts.map((p) => p.text).join('\n'), via: 'jszip', suspicious: z.suspicious || null };
  }
  if (isImage(name)) {
    if (bytes.length > OCR_MAX_BYTES) return { skipped: 'too_large', incomplete: true };
    if (ctx.ocrBudget && ctx.ocrBudget.left-- <= 0) return { skipped: 'ocr_cap', incomplete: true };
    const r = await ctx.ocr(bytes);
    if (!r?.ok) return { skipped: r?.reason === 'extraction_timeout' ? 'ocr_timeout' : 'ocr_failed', incomplete: true };
    return { text: r.text || '', via: 'tesseract' };
  }
  if (isBinaryParseable(name)) {
    const ex = await extractFromBuffer(bytes, ext, { ...ctx, depth });
    if (!ex) return { skipped: 'unsupported', incomplete: true };
    return ex;
  }
  return { skipped: 'unsupported', incomplete: isDocumentLikeFormat(name) };
}

// ---- ZIP walk ----
//
// In-memory, bounded, recursive. Returns
//   { parts: [{ name, text, via }], entries, truncated, skipped: [{ name, why }],
//     suspicious: null | 'container_truncated' | 'decompression_ratio' }
// Nothing is inflated when the central directory says the archive is a bomb
// (throws suspicious 'decompression_ratio'); an entry whose own expanded size is
// over the scan cap is skipped unread.
export async function walkZip(buf, ctx = DEFAULT_CTX, prefix = '') {
  const zip = await loadZipChecked(buf);
  const out = { parts: [], entries: 0, truncated: false, skipped: [], suspicious: null };
  const ocrBudget = ctx.ocrBudget || { left: ZIP_MAX_OCR_ENTRIES };
  const c = { ...ctx, ocrBudget };
  let chars = 0;
  const flag = (why) => { if (why === 'decompression_ratio') out.suspicious = why; else out.suspicious ??= 'container_truncated'; };
  for (const name of Object.keys(zip.files)) {
    const entry = zip.files[name];
    if (entry.dir) continue;
    if (out.entries >= ZIP_MAX_ENTRIES) { out.truncated = true; flag('container_truncated'); break; }
    out.entries++;
    const full = prefix + name;
    if ((Number(entry._data?.uncompressedSize) || 0) > CONTENT_SCAN_MAX_BYTES) {
      out.skipped.push({ name: full, why: 'too_large' }); flag('container_truncated'); continue;
    }
    // Never inflate an entry we would skip anyway (media, unknown types).
    if (!(isTextReadable(name) || isEnvStyleName(name) || isImage(name) || isBinaryParseable(name) || extOfName(name) === '.zip')) {
      out.skipped.push({ name: full, why: 'unsupported' });
      if (isDocumentLikeFormat(name)) flag('container_truncated');
      continue;
    }
    try {
      const bytes = await entry.async('nodebuffer');
      if (extOfName(name) === '.zip') {
        // Nested archive: walked in place so its own skipped rows (max_depth,
        // encrypted, ...) and parts surface with full paths.
        const depth = (c.depth || 0) + 1;
        if (depth >= ZIP_MAX_DEPTH) { out.skipped.push({ name: full, why: 'max_depth' }); flag('container_truncated'); continue; }
        const nested = await walkZip(bytes, { ...c, depth }, `${full}/`);
        out.skipped.push(...nested.skipped);
        if (nested.truncated) out.truncated = true;
        if (nested.suspicious) flag(nested.suspicious);
        for (const p of nested.parts) {
          let text = p.text;
          if (chars + text.length > PARTS_MAX_CHARS) { text = text.slice(0, Math.max(0, PARTS_MAX_CHARS - chars)); flag('container_truncated'); }
          chars += text.length;
          out.parts.push({ ...p, text });
        }
        continue;
      }
      const r = await extractEntryText(name, bytes, c);
      if (r.skipped) { out.skipped.push({ name: full, why: r.skipped }); if (r.incomplete) flag('container_truncated'); continue; }
      if (r.suspicious) flag(r.suspicious);
      let text = String(r.text || '');
      if (chars + text.length > PARTS_MAX_CHARS) { text = text.slice(0, Math.max(0, PARTS_MAX_CHARS - chars)); flag('container_truncated'); }
      chars += text.length;
      out.parts.push({ name: full, text, via: r.via });
    } catch (err) {
      out.skipped.push({ name: full, why: err?.cfaiReason === 'encrypted' ? 'encrypted' : (err?.cfaiSuspicious === 'decompression_ratio' ? 'decompression_ratio' : 'extract_failed') });
      flag(err?.cfaiSuspicious === 'decompression_ratio' ? 'decompression_ratio' : 'container_truncated');
    }
  }
  return out;
}

// ---- ZIP result -> content_scan ----
//
// Scans every part with `scan` (on the caller's thread: the pattern catalog is
// live policy state) and packages { scanned, via:'jszip', entries, truncated,
// matchCount, matches, contentSeverity, entryBreakdown } plus, when anything was
// skipped that should have been readable, partial:true + suspicious.
const SEVERITY_ORDER = ['low', 'moderate', 'high', 'critical'];

export function summarizeZipScan(z, scan, bytesScanned) {
  const aggMatches = new Map();
  let totalMatchCount = 0;
  let topSeverity = null;
  const entryBreakdown = [];
  for (const p of z.parts) {
    const { matches } = scan(p.text);
    let entryTop = null; let entryCount = 0;
    for (const m of matches) {
      entryCount += m.count;
      const ex = aggMatches.get(m.pattern);
      if (ex) ex.count += m.count;
      else aggMatches.set(m.pattern, { pattern: m.pattern, class: m.class, severity: m.severity, count: m.count });
      if (SEVERITY_ORDER.indexOf(m.severity) > SEVERITY_ORDER.indexOf(entryTop)) entryTop = m.severity;
      if (SEVERITY_ORDER.indexOf(m.severity) > SEVERITY_ORDER.indexOf(topSeverity)) topSeverity = m.severity;
    }
    totalMatchCount += entryCount;
    if (entryCount > 0) entryBreakdown.push({ name: p.name, matches: entryCount, severity: entryTop });
  }
  for (const s of z.skipped) entryBreakdown.push({ name: s.name, matches: 0, severity: null, skipped: s.why });
  const cs = {
    scanned: true,
    via: 'jszip',
    bytesScanned,
    entries: z.entries,
    truncated: !!z.truncated,
    matchCount: totalMatchCount,
    matches: [...aggMatches.values()],
    contentSeverity: topSeverity,
    entryBreakdown,
  };
  if (z.suspicious) { cs.partial = true; cs.suspicious = true; cs.suspicious_reason = z.suspicious; }
  return cs;
}

// In-process zip scan (isolate:false callers). Same result as the worker route.
export async function extractZip({ path, scan, log, ctx = DEFAULT_CTX }) {
  const buf = await readFile(path);
  const z = await walkZip(buf, ctx);
  if (z.skipped.length) log?.warn?.(`zip: ${z.skipped.length} entr${z.skipped.length === 1 ? 'y' : 'ies'} not scanned`);
  return summarizeZipScan(z, scan, buf.length);
}

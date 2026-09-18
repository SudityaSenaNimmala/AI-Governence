// Text extraction for binary file formats. Mirrors the formats the browser
// extension handles via PDF.js / SheetJS / mammoth (which it loads in the
// renderer). Here we run them in Node.
//
// All extractors return { text, via, pages?, sheets? } on success, or
// throw on failure. The caller (file-handler.js) wraps that in the
// standard content_scan shape and runs the pattern catalog against `text`.
//
// Privacy: only the count of pattern matches leaves this machine. The
// extracted text stays in memory locally for the duration of the scan.

import { readFile } from 'node:fs/promises';

let mammothMod, xlsxMod, pdfParseMod, tesseractWorker, tesseractModPromise, jszipMod;
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
// Tesseract: heavy WASM init (~3-5s + downloads lang data on first call).
// We create one worker per agent run and keep it alive — subsequent images
// take ~1s. Initialization is lazy: nothing happens unless an image is scanned.
async function getTesseractWorker() {
  if (tesseractWorker) return tesseractWorker;
  if (!tesseractModPromise) {
    tesseractModPromise = (async () => {
      const t = await import('tesseract.js');
      const Tesseract = t.default || t;
      const worker = await Tesseract.createWorker('eng');
      return worker;
    })();
  }
  tesseractWorker = await tesseractModPromise;
  return tesseractWorker;
}

// Caps for archive recursion. Mirror browser extension constants.
const ZIP_MAX_DEPTH   = 3;
const ZIP_MAX_ENTRIES = 200;

export async function extractDocx(path) {
  const mammoth = await getMammoth();
  const buf = await readFile(path);
  // extractRawText reads paragraphs & runs without formatting noise — ideal
  // for pattern matching. Tables, headers, footers, footnotes all included.
  const result = await mammoth.extractRawText({ buffer: buf });
  return { text: result.value || '', via: 'mammoth' };
}

export async function extractPdf(path) {
  const pdfParse = await getPdfParse();
  const buf = await readFile(path);
  const result = await pdfParse(buf);
  return { text: result.text || '', via: 'pdf-parse', pages: result.numpages || null };
}

export async function extractXlsx(path) {
  const XLSX = await getXlsx();
  const wb = XLSX.readFile(path);
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

export async function extractImage(path) {
  const worker = await getTesseractWorker();
  const result = await worker.recognize(path);
  return { text: result?.data?.text || '', via: 'tesseract' };
}

/**
 * Route by extension. Returns the same shape as the text extractors above,
 * or null if no extractor handles the extension.
 */
export async function extractTextFromBinary(path, ext) {
  switch (ext.toLowerCase()) {
    case '.docx': return extractDocx(path);
    case '.pdf':  return extractPdf(path);
    case '.xlsx':
    case '.xls':  return extractXlsx(path);
    case '.png':
    case '.jpg':
    case '.jpeg':
    case '.gif':
    case '.bmp':
    case '.webp': return extractImage(path);
    default:      return null;
  }
}

// ---- ZIP recursive scan ----
//
// Returns a flattened content_scan-shaped result: { scanned, via:'jszip',
// entries, truncated, matchCount, matches, contentSeverity, entryBreakdown }.
// Each entry is itself routed through the right extractor (text/binary/image).
// Caller is responsible for honoring the size cap on the outer .zip.

const SEVERITY_ORDER = ['low', 'moderate', 'high', 'critical'];

function isTextExtension(ext) {
  return /^\.(txt|md|markdown|log|csv|tsv|json|ya?ml|toml|ini|conf|config|cfg|env|js|ts|tsx|jsx|mjs|cjs|py|rb|go|rs|java|cs|cpp|c|h|swift|kt|php|sql|html?|xml|pem|key)$/i.test(ext);
}

// Special-case for .env-style names like `.env`, `.env.production`,
// `.env.local`. extOf would return `.production` for these and miss them,
// so we check the full name separately.
function isEnvStyleName(name) {
  return /(^|[\\/])\.env(\.|$)/i.test(name);
}
function isBinaryExtension(ext) {
  return /^\.(docx|pdf|xlsx|xls)$/i.test(ext);
}
function isImageExtension(ext) {
  return /^\.(png|jpe?g|gif|bmp|webp)$/i.test(ext);
}

export async function extractZip({ path, scan, depth = 0, log }) {
  if (depth >= ZIP_MAX_DEPTH) {
    return { scanned: false, reason: 'max_depth' };
  }
  const JSZip = await getJszip();
  const buf = await readFile(path);
  const zip = await JSZip.loadAsync(buf);

  const aggMatches = new Map();   // pattern -> { pattern, class, severity, count }
  let totalMatchCount = 0;
  let topSeverity = null;
  const entryBreakdown = [];

  let count = 0;
  const names = Object.keys(zip.files);
  for (const name of names) {
    if (count >= ZIP_MAX_ENTRIES) break;
    const entry = zip.files[name];
    if (entry.dir) continue;
    count++;

    const lower = name.toLowerCase();
    const dot   = lower.lastIndexOf('.');
    const ext   = dot < 0 ? '' : lower.slice(dot);

    let entryText = null;
    let entryVia  = null;

    try {
      if (isTextExtension(ext) || isEnvStyleName(lower)) {
        const s = await entry.async('string');
        entryText = s;
        entryVia  = 'utf8';
      } else if (isBinaryExtension(ext) || isImageExtension(ext) || ext === '.zip') {
        // Spool the entry to a temp file so we can re-use the binary extractors
        // which all take a path. Cheap and avoids reimplementing each parser.
        const entryBuf = await entry.async('nodebuffer');
        const tmp = `${path}.cfai-entry-${count}${ext}`;
        const { writeFile, unlink } = await import('node:fs/promises');
        await writeFile(tmp, entryBuf);
        try {
          if (ext === '.zip') {
            const nested = await extractZip({ path: tmp, scan, depth: depth + 1, log });
            // Roll nested results into the aggregate
            if (nested.scanned) {
              totalMatchCount += nested.matchCount;
              for (const m of (nested.matches || [])) {
                const k = m.pattern;
                const ex = aggMatches.get(k);
                if (ex) ex.count += m.count;
                else aggMatches.set(k, { ...m });
                if (SEVERITY_ORDER.indexOf(m.severity) > SEVERITY_ORDER.indexOf(topSeverity)) topSeverity = m.severity;
              }
              entryBreakdown.push({ name, matches: nested.matchCount, severity: nested.contentSeverity });
            }
            await unlink(tmp).catch(() => {});
            continue;  // already aggregated nested
          }
          const ex = await extractTextFromBinary(tmp, ext);
          if (ex) { entryText = ex.text; entryVia = ex.via; }
        } finally {
          await unlink(tmp).catch(() => {});
        }
      } else {
        entryBreakdown.push({ name, matches: 0, severity: null, skipped: 'unsupported' });
        continue;
      }
    } catch (err) {
      entryBreakdown.push({ name, matches: 0, severity: null, skipped: 'extract_failed' });
      log?.warn(`zip entry ${name} extract failed: ${err?.message || err}`);
      continue;
    }

    if (entryText == null) continue;

    const { matches } = scan(entryText);
    let entryTop = null;
    let entryCount = 0;
    for (const m of matches) {
      entryCount += m.count;
      const k = m.pattern;
      const ex = aggMatches.get(k);
      if (ex) ex.count += m.count;
      else aggMatches.set(k, { pattern: m.pattern, class: m.class, severity: m.severity, count: m.count });
      if (SEVERITY_ORDER.indexOf(m.severity) > SEVERITY_ORDER.indexOf(entryTop))    entryTop = m.severity;
      if (SEVERITY_ORDER.indexOf(m.severity) > SEVERITY_ORDER.indexOf(topSeverity)) topSeverity = m.severity;
    }
    totalMatchCount += entryCount;
    if (entryCount > 0) {
      entryBreakdown.push({ name, matches: entryCount, severity: entryTop });
    }
  }

  return {
    scanned: true,
    via: 'jszip',
    bytesScanned: buf.length,
    entries: count,
    truncated: count >= ZIP_MAX_ENTRIES,
    matchCount: totalMatchCount,
    matches: [...aggMatches.values()],
    contentSeverity: topSeverity,
    entryBreakdown,
  };
}

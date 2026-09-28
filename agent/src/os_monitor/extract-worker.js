// Binary text extraction in a WORKER THREAD (security review 2026-09-28,
// finding 5).
//
// mammoth / pdf-parse / SheetJS (XLSX.readFile is synchronous) / tesseract run
// here instead of on the monitor's main thread, so a large or pathological
// document cannot freeze the event loop -- the loop that re-states every
// attach hold before its 15s dead-man TTL lapses. The parent terminates this
// worker on its time budget, and resourceLimits bound what an inflating
// (zip-bomb-shaped) .docx/.xlsx can take.
//
// Protocol: workerData = { path, ext, maxChars } -> one message
//   { ok:true, text, via, pages, sheets } | { ok:false, error }
// The text is capped at maxChars before it crosses the thread boundary.
import { parentPort, workerData } from 'node:worker_threads';
import { extractTextFromBinary } from './binary-extractors.js';

(async () => {
  try {
    const { path, ext, maxChars } = workerData || {};
    const r = await extractTextFromBinary(path, ext);
    if (!r) { parentPort.postMessage({ ok: true, none: true }); return; }
    const text = String(r.text || '');
    parentPort.postMessage({
      ok: true,
      text: maxChars ? text.slice(0, maxChars) : text,
      via: r.via, pages: r.pages ?? null, sheets: r.sheets ?? null,
    });
  } catch (err) {
    parentPort.postMessage({ ok: false, error: String(err?.code || err?.name || 'extraction_failed') });
  }
})();

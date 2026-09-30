// Binary text extraction in a WORKER THREAD (security review 2026-09-28,
// finding 5).
//
// mammoth / pdf-parse / SheetJS / JSZip run here instead of on the monitor's
// main thread, so a large or pathological document cannot freeze the event
// loop -- the loop that re-states every attach hold before its 15s dead-man TTL
// lapses. The parent terminates this worker on its time budget, and
// resourceLimits bound what an inflating (zip-bomb-shaped) file can take.
//
// Protocol: workerData = { path, ext, maxChars }. The worker may send any number
//   { type:'ocr', id, bytes }            -- an image entry to OCR; the parent runs
//                                           it on the shared warm OCR thread and
//                                           answers { type:'ocr_result', id, result }
// and then exactly one final message:
//   { ok:true, text, via, pages, sheets, truncated, suspicious }   a document
//   { ok:true, zip: { parts, entries, truncated, skipped, suspicious } }   a .zip
//   { ok:true, none:true }                                          no extractor
//   { ok:false, error, reason?, suspicious? }
// `reason` / `suspicious` are the extractor's cfaiReason / cfaiSuspicious; the
// parent maps them onto content_scan. Text is capped at maxChars (truncated:true
// when that cut anything) before it crosses the thread boundary. Pattern
// scanning happens in the PARENT: the catalog is live policy state.
import { parentPort, workerData } from 'node:worker_threads';
import { readFile } from 'node:fs/promises';
import { extractFromBuffer, walkZip } from './binary-extractors.js';

let seq = 0;
const pending = new Map();
parentPort.on('message', (m) => {
  if (m?.type !== 'ocr_result') return;
  const r = pending.get(m.id);
  if (r) { pending.delete(m.id); r(m.result); }
});
function ocrViaParent(bytes) {
  return new Promise((resolve) => {
    const id = ++seq;
    pending.set(id, resolve);
    const copy = new Uint8Array(bytes);   // own the memory before transferring it
    parentPort.postMessage({ type: 'ocr', id, bytes: copy }, [copy.buffer]);
  });
}
const ctx = { depth: 0, ocr: ocrViaParent };

(async () => {
  try {
    const { path, ext, maxChars } = workerData || {};
    const buf = await readFile(path);
    if (String(ext).toLowerCase() === '.zip') {
      const z = await walkZip(buf, ctx);
      parentPort.postMessage({ ok: true, zip: z });
      return;
    }
    const r = await extractFromBuffer(buf, ext, ctx);
    if (!r) { parentPort.postMessage({ ok: true, none: true }); return; }
    const text = String(r.text || '');
    const cut = maxChars && text.length > maxChars;
    parentPort.postMessage({
      ok: true,
      text: cut ? text.slice(0, maxChars) : text,
      truncated: !!cut,
      via: r.via, pages: r.pages ?? null, sheets: r.sheets ?? null,
      suspicious: r.suspicious ?? null,
    });
  } catch (err) {
    parentPort.postMessage({
      ok: false,
      error: String(err?.code || err?.name || 'extraction_failed'),
      reason: err?.cfaiReason || null,
      suspicious: err?.cfaiSuspicious || null,
    });
  }
})();

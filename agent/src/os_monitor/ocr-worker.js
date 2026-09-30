// The ONE long-lived OCR thread (see ocr-service.js for the lifecycle).
//
// Hosts a single tesseract.js worker for the life of this thread, so only the
// first image pays the WASM + language-model start-up; every later image is a
// warm recognize(). The language data is the BUNDLED eng.traineddata.gz in
// workerData.langPath -- a local directory, never a URL -- re-verified against
// workerData.sha256 right here before the engine loads it, and caching is off,
// so tesseract.js never reaches for its jsDelivr CDN default and never writes a
// traineddata copy into the process's working directory.
//
// Protocol:
//   workerData = { langPath, lang, sha256 }
//   -> { type:'ready' } once the engine is up, or { type:'init_error', error }
//   <- { id, path } or { id, bytes }      one image per message
//   -> { type:'result', id, text } | { type:'error', id, error }
// Text crosses the thread boundary and stays in the agent's memory; the caller
// runs the pattern catalog over it and forwards only match counts.
import { parentPort, workerData } from 'node:worker_threads';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const { langPath, lang = 'eng', sha256 } = workerData || {};
let engine = null;

async function init() {
  const data = await readFile(join(langPath, `${lang}.traineddata.gz`));
  if (!sha256 || createHash('sha256').update(data).digest('hex') !== sha256) throw new Error('ocr_lang_hash_mismatch');
  const t = await import('tesseract.js');
  const Tesseract = t.default || t;
  engine = await Tesseract.createWorker(lang, 1 /* OEM.LSTM_ONLY */, {
    langPath,
    cachePath: langPath,
    cacheMethod: 'none',
    gzip: true,
    errorHandler: () => {},
  });
}

const ready = init().then(
  () => { parentPort.postMessage({ type: 'ready' }); },
  (err) => { parentPort.postMessage({ type: 'init_error', error: String(err?.message || err) }); throw err; },
);
// The rejection is re-observed by every job below; this only stops an init
// failure with no job queued from surfacing as an unhandled rejection.
ready.catch(() => {});

parentPort.on('message', async (msg) => {
  const id = msg?.id;
  try {
    await ready;
    const input = msg.bytes ? Buffer.from(msg.bytes.buffer, msg.bytes.byteOffset, msg.bytes.byteLength) : msg.path;
    const r = await engine.recognize(input);
    parentPort.postMessage({ type: 'result', id, text: String(r?.data?.text || '') });
  } catch (err) {
    parentPort.postMessage({ type: 'error', id, error: String(err?.code || err?.name || 'ocr_failed') });
  }
});

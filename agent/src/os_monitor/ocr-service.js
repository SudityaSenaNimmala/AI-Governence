// One long-lived OCR worker thread for the whole agent process.
//
// WHY. The old path created a fresh tesseract.js worker for every image, and
// with no langPath set tesseract.js fetched eng.traineddata from its jsDelivr
// CDN and cached a copy in the current working directory. Now ocr-worker.js is
// spawned once (lazily) and kept warm, on the eng.traineddata.gz the browser
// extension already ships -- resolved from a LOCAL directory and accepted only
// if its SHA-256 matches OCR_LANG_SHA256. No verified copy => OCR fails fast
// with extraction_failed; it never falls back to the network.
//
// BUDGETS (per job, both configurable):
//   * runBudgetMs  -- starts when the image is handed to a READY engine. Waiting
//     in the queue or for the engine to start never counts against it. On
//     expiry the thread is terminated (a stuck WASM loop cannot be cancelled any
//     other way), the job answers { reason:'extraction_timeout', selfTimeout:true }
//     -- the image itself ran out its budget -- and a fresh thread is started at
//     once, OUTSIDE any job's budget, so the next image does not pay the cold
//     start.
//   * queueMaxMs   -- the ceiling on waiting (queue + engine start-up). On expiry
//     the job is dropped: { reason:'extraction_timeout', selfTimeout:false } --
//     not the image's fault.
// PRIORITY: 'interactive' jobs (a screenshot being attached) are always started
// before 'background' ones (images inside an archive / email).
// GROUPS: cancelOcrGroup(g) drops every queued job of a group -- used when a
// zip's extraction ends (timed out, finished, failed) so its leftover images do
// not occupy the engine.
//
// LIFETIME. The thread is unref()'d whenever no image is in flight, so it never
// keeps a CLI run or a test process alive, and it is terminated after
// OCR_IDLE_MS without work. After a failed engine start OCR backs off for
// OCR_INIT_BACKOFF_MS (jobs fail fast) instead of respawning in a loop.
import { Worker } from 'node:worker_threads';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

export const OCR_LANG = 'eng';
export const OCR_LANG_FILE = `${OCR_LANG}.traineddata.gz`;
// SHA-256 of browser-extension/vendor/tesseract/eng.traineddata.gz. A copy that
// does not match -- including one pointed at by CFAI_TESSDATA_DIR -- is ignored.
// Re-pin deliberately if the bundled model is ever upgraded.
export const OCR_LANG_SHA256 = 'ed350f3752f81ee8f38769edc14d92d997dababe23b565c59879372cc46a2468';
export const OCR_IDLE_MS = 10 * 60 * 1000;
export const OCR_INIT_MAX_MS = 60 * 1000;
export const OCR_INIT_BACKOFF_MS = 30 * 1000;
export const OCR_RUN_BUDGET_MS = 8000;
export const OCR_QUEUE_MAX_MS = 20 * 1000;

/**
 * Where the bundled language data may live, in priority order.
 *   1. CFAI_TESSDATA_DIR               -- explicit override (still hash-checked)
 *   2. <this dir>/tessdata             -- the NSIS installer stages it here
 *   3. <agent>/../browser-extension/vendor/tesseract
 *                                      -- the repo checkout, AND the Electron
 *                                         build (extraResources put agent/src and
 *                                         browser-extension side by side)
 */
export function tessdataCandidates(env = process.env) {
  return [
    env.CFAI_TESSDATA_DIR,
    join(HERE, 'tessdata'),
    join(HERE, '..', '..', '..', 'browser-extension', 'vendor', 'tesseract'),
  ].filter(Boolean);
}

const hashCache = new Map();   // file -> { size, mtimeMs, ok }
export function langFileVerified(file) {
  try {
    const st = statSync(file);
    const hit = hashCache.get(file);
    if (hit && hit.size === st.size && hit.mtimeMs === st.mtimeMs) return hit.ok;
    const ok = createHash('sha256').update(readFileSync(file)).digest('hex') === OCR_LANG_SHA256;
    hashCache.set(file, { size: st.size, mtimeMs: st.mtimeMs, ok });
    return ok;
  } catch {
    return false;
  }
}

export function resolveTessdataDir(env = process.env) {
  for (const dir of tessdataCandidates(env)) {
    const f = join(dir, OCR_LANG_FILE);
    if (existsSync(f) && langFileVerified(f)) return dir;
  }
  return null;
}

const WORKER_URL = new URL('./ocr-worker.js', import.meta.url);

let cur = null;        // { worker, ready, active, initTimer, langPath }
let idleTimer = null;
let backoffUntil = 0;
let seq = 0;
const queue = [];      // jobs waiting to run
const stats = { spawns: 0, jobs: 0, kills: 0, runTimeouts: 0, queueTimeouts: 0, cancelled: 0 };

function settle(job, value) {
  if (job.settled) return;
  job.settled = true;
  // NOT the run timer: a job that is answered (cancelled) while its image is
  // still on the engine keeps it, so a hung recognize() is still killed.
  clearTimeout(job.queueTimer);
  job.resolve(value);
}

function kill(s) {
  if (!s) return;
  if (cur === s) cur = null;
  clearTimeout(s.initTimer);
  stats.kills++;
  try { s.worker.terminate(); } catch { /* already gone */ }
  if (s.active) { const j = s.active; s.active = null; clearTimeout(j.runTimer); settle(j, { ok: false, reason: 'extraction_failed', error: 'ocr_worker_terminated' }); }
}

function failQueued(reason, error) {
  while (queue.length) settle(queue.shift(), { ok: false, reason, error });
}

function spawn() {
  if (Date.now() < backoffUntil) return null;
  const langPath = resolveTessdataDir();
  if (!langPath) return null;
  let worker;
  try {
    worker = new Worker(WORKER_URL, { workerData: { langPath, lang: OCR_LANG, sha256: OCR_LANG_SHA256 } });
  } catch {
    return null;
  }
  const s = { worker, ready: false, active: null, initTimer: null, langPath };
  stats.spawns++;
  s.initTimer = setTimeout(() => {
    if (cur === s && !s.ready) { kill(s); backoffUntil = Date.now() + OCR_INIT_BACKOFF_MS; failQueued('extraction_failed', 'ocr_init_timeout'); }
  }, OCR_INIT_MAX_MS);
  s.initTimer.unref?.();
  worker.on('message', (m) => {
    if (cur !== s) return;
    if (m?.type === 'ready') {
      s.ready = true;
      clearTimeout(s.initTimer);
      pump();
    } else if (m?.type === 'init_error') {
      kill(s);
      backoffUntil = Date.now() + OCR_INIT_BACKOFF_MS;
      failQueued('extraction_failed', 'ocr_init_failed');
    } else if (m?.type === 'result' || m?.type === 'error') {
      const job = s.active;
      if (!job || job.id !== m.id) return;
      s.active = null;
      clearTimeout(job.runTimer);
      settle(job, m.type === 'result'
        ? { ok: true, text: m.text }
        : { ok: false, reason: 'extraction_failed', error: String(m.error || 'ocr_failed') });
      pump();
    }
  });
  worker.on('error', () => { if (cur === s) { kill(s); pump(); } });
  worker.on('exit', () => { if (cur === s) { cur = null; kill(s); pump(); } });
  return s;
}

function scheduleIdle() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => { if (cur && !cur.active && !queue.length) kill(cur); }, OCR_IDLE_MS);
  idleTimer.unref?.();
}

function nextJob() {
  let i = queue.findIndex((j) => j.priority === 'interactive');
  if (i < 0) i = 0;
  return queue.length ? queue.splice(i, 1)[0] : null;
}

function pump() {
  if (!queue.length && !cur?.active) {
    if (cur) { cur.worker.unref(); scheduleIdle(); }
    return;
  }
  clearTimeout(idleTimer);
  if (!cur) {
    cur = spawn();
    if (!cur) { failQueued('extraction_failed', 'ocr_unavailable'); return; }
  }
  // Something is waiting on this thread: keep the process alive for it.
  cur.worker.ref();
  if (!cur.ready || cur.active) return;
  const job = nextJob();
  if (!job) return;
  clearTimeout(job.queueTimer);
  cur.active = job;
  // The run budget starts NOW -- the engine is warm and the image is next.
  job.runTimer = setTimeout(() => onRunTimeout(job), job.runBudgetMs);
  job.runTimer.unref?.();
  if (job.bytes) {
    const b = job.bytes; job.bytes = null;
    cur.worker.postMessage({ id: job.id, bytes: b }, [b.buffer]);
  } else {
    cur.worker.postMessage({ id: job.id, path: job.path });
  }
}

function onRunTimeout(job) {
  if (cur?.active !== job) return;
  stats.runTimeouts++;
  cur.active = null;
  kill(cur);
  settle(job, { ok: false, reason: 'extraction_timeout', selfTimeout: true });
  // Respawn eagerly, outside every job's run budget.
  cur = spawn();
  pump();
}

function onQueueTimeout(job) {
  if (job.settled) return;
  const i = queue.indexOf(job);
  if (i < 0) return;
  queue.splice(i, 1);
  stats.queueTimeouts++;
  settle(job, { ok: false, reason: 'extraction_timeout', selfTimeout: false });
  pump();
}

function enqueue(job) {
  stats.jobs++;
  job.queueTimer = setTimeout(() => onQueueTimeout(job), job.queueMaxMs);
  job.queueTimer.unref?.();
  queue.push(job);
  pump();
}

function makeJob(resolve, opts) {
  return {
    id: ++seq, resolve, settled: false, queueTimer: null, runTimer: null,
    priority: opts.priority === 'background' ? 'background' : 'interactive',
    group: opts.group ?? null,
    runBudgetMs: opts.budgetMs ?? OCR_RUN_BUDGET_MS,
    queueMaxMs: opts.queueMaxMs ?? OCR_QUEUE_MAX_MS,
  };
}

/**
 * OCR one image file. Never rejects.
 * @param {{budgetMs?:number, queueMaxMs?:number, priority?:'interactive'|'background', group?:any}} [opts]
 * @returns {Promise<{ok:true,text:string} | {ok:false,reason:'extraction_timeout'|'extraction_failed',selfTimeout?:boolean,error?:string}>}
 */
export function ocrImageFile(path, opts = {}) {
  return new Promise((resolve) => { const j = makeJob(resolve, opts); j.path = path; enqueue(j); });
}

/** OCR image BYTES (zip entries, .eml attachments). Same answers as ocrImageFile. */
export function ocrImageBuffer(bytes, opts = {}) {
  return new Promise((resolve) => {
    const j = makeJob(resolve, opts);
    j.bytes = new Uint8Array(bytes);   // a private copy: it is transferred to the thread
    enqueue(j);
  });
}

/** Drop every QUEUED job of `group`; an image already running finishes, unobserved. */
export function cancelOcrGroup(group) {
  if (group == null) return 0;
  let n = 0;
  for (let i = queue.length - 1; i >= 0; i--) {
    if (queue[i].group !== group) continue;
    const [j] = queue.splice(i, 1);
    settle(j, { ok: false, reason: 'extraction_failed', error: 'ocr_cancelled' });
    n++;
  }
  if (cur?.active?.group === group) { settle(cur.active, { ok: false, reason: 'extraction_failed', error: 'ocr_cancelled' }); n++; }
  stats.cancelled += n;
  if (n) pump();
  return n;
}

/** Start the engine ahead of the first image (optional; OCR is lazy otherwise). */
export function warmOcr() {
  if (!cur) { cur = spawn(); if (cur) pump(); }
  return !!cur;
}

/** Terminate the thread and fail anything pending. Tests and shutdown. */
export function shutdownOcr() {
  clearTimeout(idleTimer);
  failQueued('extraction_failed', 'ocr_shutdown');
  if (cur) kill(cur);
  backoffUntil = 0;
}

export function ocrStats() {
  return { ...stats, queued: queue.length, busy: !!cur?.active, alive: !!cur, ready: !!cur?.ready, langPath: cur?.langPath ?? null };
}

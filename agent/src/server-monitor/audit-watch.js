// auditd model-file load watcher — Tier 3 L5 (signal-only, no content).
//
// We install an auditd rule (cloudfuze-aigov-models.rules) that flags `open`/
// `openat` syscalls succeeding on filenames matching `*.gguf|*.safetensors|
// *.bin|*.pt` under common model-cache paths. The kernel writes records to
// /var/log/audit/audit.log; we tail it and emit a `model_load` signal each
// time an agent process loads weight bytes.
//
// Limitations of v1:
//   - Linux-only (auditd is Linux). Windows ETW + macOS EndpointSecurity are
//     conceptually equivalent but out of scope for this session.
//   - File-suffix matching is a heuristic. Catches the common cases (HF cache
//     and llama.cpp ggufs); won't catch custom-named weight files or memory-
//     mapped archives. A v2 could whitelist known model directories.
//   - We need to read /var/log/audit/audit.log which requires root or the
//     adm group; the systemd unit runs as root anyway.
//
// Failure modes — all silent / non-fatal:
//   - No auditd installed → log a warning, do nothing.
//   - audit.log missing → log warning, retry tail every 10s.

import fs from 'node:fs';
import readline from 'node:readline';
import { attribute } from './attribution.js';

const AUDIT_LOG_PATH = '/var/log/audit/audit.log';
const RETRY_MS = 10_000;

// Lines we care about look roughly like:
//   type=PATH msg=audit(1716200000.123:456): item=0 name="/root/.cache/.../model.gguf" inode=... nametype=NORMAL
//   type=SYSCALL msg=audit(1716200000.123:456): arch=... syscall=257 success=yes ... auid=1000 uid=1000 ... pid=12345 comm="python3" exe="/usr/bin/python3" key="cloudfuze-aigov-models"
//
// The key="cloudfuze-aigov-models" tag comes from our rule file; we filter
// on it to ignore unrelated audit events. Records for the same event share
// msg=audit(<timestamp>:<serial>) — we keep a small in-flight map of <serial>
// → partial state until we see both type=PATH and type=SYSCALL.

export function startAuditWatch({ reporter, log }) {
  let stopped = false;
  let inflight = new Map();
  let tail = null;

  function attach() {
    if (stopped) return;
    if (!fs.existsSync(AUDIT_LOG_PATH)) {
      log?.info?.(`audit-watch: ${AUDIT_LOG_PATH} not present yet — retry in ${RETRY_MS}ms`);
      setTimeout(attach, RETRY_MS).unref?.();
      return;
    }
    tail = fs.createReadStream(AUDIT_LOG_PATH, { start: getEndOffset(), encoding: 'utf8' });
    const rl = readline.createInterface({ input: tail });
    rl.on('line', handleLine);
    rl.on('close', () => {
      if (stopped) return;
      // File rotation or initial drain ended — retry from the new end.
      setTimeout(attach, RETRY_MS).unref?.();
    });
    log?.info?.(`audit-watch: tailing ${AUDIT_LOG_PATH}`);
  }

  function handleLine(line) {
    if (!line.includes('cloudfuze-aigov-models')) return;
    const serial = serialOf(line);
    if (!serial) return;

    if (line.startsWith('type=PATH')) {
      const name = matchOne(line, /name="([^"]+)"/);
      const nametype = matchOne(line, /nametype=(\w+)/);
      if (name && nametype === 'NORMAL') {
        const partial = inflight.get(serial) || {};
        partial.path = name;
        inflight.set(serial, partial);
      }
    } else if (line.startsWith('type=SYSCALL')) {
      const success = matchOne(line, /success=(\w+)/);
      if (success !== 'yes') { inflight.delete(serial); return; }
      const pid  = Number(matchOne(line, /\bpid=(\d+)/)) || null;
      const uid  = Number(matchOne(line, /\buid=(\d+)/)) || null;
      const auid = Number(matchOne(line, /\bauid=(\d+)/)) || null;
      const comm = matchOne(line, /comm="([^"]+)"/);
      const exe  = matchOne(line, /exe="([^"]+)"/);
      const partial = inflight.get(serial) || {};
      inflight.delete(serial);
      if (!pid || !partial.path) return;

      emit({ pid, uid, auid, comm, exe, path: partial.path }).catch((err) => {
        log?.warn?.(`audit-watch: emit failed ${err.message}`);
      });
    }

    // Cleanup partial state older than ~5s — auditd guarantees ordering so
    // this is just paranoid.
    if (inflight.size > 1000) {
      const keys = Array.from(inflight.keys()).slice(0, 200);
      for (const k of keys) inflight.delete(k);
    }
  }

  async function emit({ pid, uid, auid, comm, exe, path }) {
    // Full /proc attribution (gets cmdline, parent chain, trigger source).
    const attr = await attribute(pid).catch(() => null) || { pid, uid, exe, comm };
    if (auid && auid !== 4294967295 && attr.loginuid == null) attr.loginuid = auid;

    reporter.enqueue({
      occurred_at: new Date().toISOString(),
      kind: 'model_load',
      attribution: attr,
      details: {
        path,
        action: 'open',
        file_class: classify(path),
      },
    });
  }

  attach();

  return { stop() { stopped = true; if (tail) tail.destroy(); } };
}

function classify(path) {
  if (/\.gguf$/i.test(path))        return 'gguf';
  if (/\.safetensors$/i.test(path)) return 'safetensors';
  if (/\.bin$/i.test(path))         return 'bin';
  if (/\.pt$/i.test(path))          return 'pytorch';
  if (/\.onnx$/i.test(path))        return 'onnx';
  if (/\.gguf2$/i.test(path))       return 'gguf2';
  return 'unknown';
}

function serialOf(line) {
  const m = line.match(/msg=audit\(([\d.]+):(\d+)\)/);
  return m ? `${m[1]}:${m[2]}` : null;
}

function matchOne(line, re) {
  const m = line.match(re);
  return m ? m[1] : null;
}

// Tail from the current end of the file — we don't replay history on restart.
function getEndOffset() {
  try {
    return fs.statSync(AUDIT_LOG_PATH).size;
  } catch { return 0; }
}

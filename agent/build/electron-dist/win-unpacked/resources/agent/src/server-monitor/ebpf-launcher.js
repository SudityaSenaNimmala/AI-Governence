// eBPF SSL capture launcher (Linux only) — Tier 2 L2.
//
// Spawns the `cloudfuze-ssl-capture` helper which uses eBPF uprobes on
// libssl's SSL_write / SSL_read to capture plaintext BEFORE TLS encryption.
// This defeats TLS-pinning agents that reject our MITM CA.
//
// Each event from the helper is one JSON line:
//   { ts_ns, pid, tid, uid, is_read, truncated, len, comm, data }
//
// We correlate consecutive {write, read} events from the same pid+tid into
// a single API call:
//   - write → HTTP request bytes (we parse the request line to learn host+path)
//   - read  → HTTP response bytes (we parse usage / model from the body)
//
// This is a best-effort correlator. For pipelined HTTP/2 or concurrent writes
// per connection it may misalign, but those cases also fail at the proxy.
// What we DO catch reliably: any standard HTTP/1.1 LLM SDK call (the common
// case) that bypassed the proxy due to TLS pinning.
//
// Failure modes:
//   - Helper binary missing → log + disable (Tier 2 not deployed yet).
//   - Helper exits non-zero  → log + restart with backoff (uprobe attach
//     might be flapping during package upgrades).
//   - libssl symbols stripped → helper prints error to stderr, we capture it.

import { spawn } from 'node:child_process';
import readline from 'node:readline';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { attribute } from './attribution.js';
import { parseApiCall, providerForHost } from './cost-parser.js';

const HELPER_PATH = process.env.SSL_CAPTURE_BIN
  || '/opt/cloudfuze/server-monitor/cloudfuze-ssl-capture';
const RESTART_BACKOFF_MS = 5_000;
const MAX_BACKOFF_MS     = 60_000;

export function startEbpfCapture({ reporter, log }) {
  if (process.platform !== 'linux') {
    log?.info?.('ebpf-capture: not linux — skipping');
    return { stop() {} };
  }
  if (!fs.existsSync(HELPER_PATH)) {
    log?.info?.(`ebpf-capture: helper binary not found at ${HELPER_PATH} — Tier 2 L2 disabled. To enable, build the helper (see agent/src/server-monitor/ebpf/Makefile) and deploy to that path.`);
    return { stop() {} };
  }

  let stopped = false;
  let child = null;
  let backoff = RESTART_BACKOFF_MS;
  // Per-(pid,tid) correlator. Holds the most recent write so the next read
  // from the same thread can be paired with it.
  const inFlight = new Map();   // key = `${pid}:${tid}` → { writeData, writeTs, host, path, method }

  function start() {
    if (stopped) return;
    log?.info?.(`ebpf-capture: starting ${HELPER_PATH}`);
    child = spawn(HELPER_PATH, [], { stdio: ['ignore', 'pipe', 'pipe'] });

    const rl = readline.createInterface({ input: child.stdout });
    rl.on('line', (line) => {
      if (!line) return;
      let ev;
      try { ev = JSON.parse(line); } catch { return; }
      handleEvent(ev).catch((e) => log?.warn?.(`ebpf-capture: handle error ${e.message}`));
    });

    child.stderr.on('data', (chunk) => {
      // The helper's diagnostics go to stderr — surface them in the daemon log.
      const text = chunk.toString().trim();
      if (text) log?.info?.(`ebpf-capture[helper]: ${text}`);
    });

    child.on('exit', (code, signal) => {
      log?.warn?.(`ebpf-capture: helper exited code=${code} signal=${signal}`);
      if (stopped) return;
      setTimeout(start, backoff);
      backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
    });
    child.on('spawn', () => { backoff = RESTART_BACKOFF_MS; });
  }

  async function handleEvent(ev) {
    if (!ev || typeof ev.data !== 'string') return;
    const key = `${ev.pid}:${ev.tid}`;

    if (ev.is_read === 0) {
      // It's a write — try to parse as an HTTP/1.1 request to learn the host.
      const reqMeta = parseHttpRequest(ev.data);
      // Only keep it in flight if it looks like a request to an LLM host.
      // We're guessing here without the SNI; use Host header.
      if (reqMeta && providerForHost(reqMeta.host, reqMeta.path)) {
        inFlight.set(key, {
          writeData: ev.data,
          writeTs: ev.ts_ns,
          host: reqMeta.host,
          path: reqMeta.path,
          method: reqMeta.method,
          headers: reqMeta.headers,
          body: reqMeta.body,
        });
      } else {
        inFlight.delete(key);   // unrelated traffic
      }
      return;
    }

    // is_read === 1: response bytes. Pair with the most-recent write on this
    // thread, parse, emit as a standard server_agent_calls event.
    const inflight = inFlight.get(key);
    if (!inflight) return;
    inFlight.delete(key);

    const respMeta = parseHttpResponse(ev.data);
    if (!respMeta) return;

    const parsed = parseApiCall({
      host: inflight.host,
      path: inflight.path,
      requestBody:  Buffer.from(inflight.body || '', 'utf8'),
      requestHeaders: inflight.headers,
      responseBody: Buffer.from(respMeta.body || '', 'utf8'),
      responseHeaders: respMeta.headers,
    });
    if (!parsed) return;

    const attr = await attribute(ev.pid).catch(() => null);
    reporter.enqueue({
      occurred_at: new Date().toISOString(),
      duration_ms: Math.max(0, Math.round((ev.ts_ns - inflight.writeTs) / 1_000_000)),
      response_status: respMeta.status,
      host: inflight.host,
      path: inflight.path,
      method: inflight.method,
      provider: parsed.provider,
      model:    parsed.model,
      prompt_tokens:     parsed.prompt_tokens,
      completion_tokens: parsed.completion_tokens,
      cached_tokens:     parsed.cached_tokens,
      cost: parsed.cost,
      prompt_text:   parsed.prompt_text,
      response_text: parsed.response_text,
      response_truncated: ev.truncated === 1,
      attribution: attr,
      capture_source: 'ebpf',     // dashboard can show this as the bypass path
    });
  }

  start();

  return {
    stop() {
      stopped = true;
      try { child?.kill('SIGTERM'); } catch {}
    },
  };
}

// --- Minimal HTTP/1.1 parsers. Don't pull in a dep just for this. ---

function parseHttpRequest(text) {
  // Expect: "POST /v1/messages HTTP/1.1\r\nHost: api.anthropic.com\r\n...\r\n\r\nBODY"
  const headerEnd = text.indexOf('\r\n\r\n');
  if (headerEnd < 0) return null;
  const head = text.slice(0, headerEnd);
  const body = text.slice(headerEnd + 4);
  const [reqLine, ...headerLines] = head.split('\r\n');
  const reqParts = reqLine.split(' ');
  if (reqParts.length < 3) return null;
  const method = reqParts[0];
  const path   = reqParts[1];
  const headers = {};
  for (const line of headerLines) {
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    headers[line.slice(0, idx).toLowerCase()] = line.slice(idx + 1).trim();
  }
  const host = headers['host'] || null;
  return { method, path, host, headers, body };
}

function parseHttpResponse(text) {
  const headerEnd = text.indexOf('\r\n\r\n');
  if (headerEnd < 0) return null;
  const head = text.slice(0, headerEnd);
  const body = text.slice(headerEnd + 4);
  const [statusLine, ...headerLines] = head.split('\r\n');
  const sParts = statusLine.split(' ');
  const status = sParts.length >= 2 ? Number(sParts[1]) : 0;
  const headers = {};
  for (const line of headerLines) {
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    headers[line.slice(0, idx).toLowerCase()] = line.slice(idx + 1).trim();
  }
  return { status, headers, body };
}

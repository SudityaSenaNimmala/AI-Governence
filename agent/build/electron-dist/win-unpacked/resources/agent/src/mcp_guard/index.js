#!/usr/bin/env node
// cfai-mcp-guard — a man-in-the-middle shim for stdio MCP servers.
//
// Usage (as launched by an MCP host via a rewritten config entry):
//   node .../mcp_guard/index.js -- <real-command> [real-args...]
//
// It spawns <real-command> as a child, relays the JSON-RPC stream both ways,
// and drops host→server `tools/call` requests that carry sensitive data —
// returning a JSON-RPC policy error to the host instead. The server process is
// never told about the blocked call and stays fully alive for everything else.
//
// Config (via env, injected by apply.js):
//   CFAI_GUARD_SERVER      governance server base URL (for reporting; optional)
//   CFAI_GUARD_TOKEN       machine bearer token (optional)
//   CFAI_GUARD_SERVERNAME  label for the protected MCP server (reporting)
//   CFAI_GUARD_THRESHOLD   min severity to block: low|moderate|high|critical (default high)
//
// IMPORTANT: stdout is the protocol channel to the host. Nothing but framed
// JSON-RPC messages may be written there — all diagnostics go to stderr.

import { spawn } from 'node:child_process';
import { inspectMessage, shouldBlock, shouldTokenize, tokenizeMessage, blockResponse, TokenVault } from './guard.js';
import { lengthBucket } from '../os_monitor/classifier.js';

const argv = process.argv.slice(2);
const sep = argv.indexOf('--');
const realCmd = sep >= 0 ? argv.slice(sep + 1) : argv;
if (realCmd.length === 0) {
  process.stderr.write('[cfai-mcp-guard] no MCP server command given (expected: ... -- <command> [args])\n');
  process.exit(64);
}

const SERVER     = process.env.CFAI_GUARD_SERVER || null;
const TOKEN      = process.env.CFAI_GUARD_TOKEN || null;
const SERVERNAME = process.env.CFAI_GUARD_SERVERNAME || realCmd.join(' ').slice(0, 60);
const THRESHOLD  = (process.env.CFAI_GUARD_THRESHOLD || 'high').toLowerCase();

// ── Reversible PII Tokenization ──────────────────────────────────────
// CFAI_GUARD_TOKENIZE: comma-separated pattern names to tokenize instead
// of blocking. E.g. "us-ssn,credit-card,iban". Default: empty (all block).
const TOKENIZE_RAW = process.env.CFAI_GUARD_TOKENIZE || '';
const TOKENIZE_PATTERNS = new Set(
  TOKENIZE_RAW.split(',').map(s => s.trim()).filter(Boolean)
);
const vault = new TokenVault();
// Periodic vault cleanup
setInterval(() => vault.gc(), 5 * 60 * 1000);

const elog = (msg) => process.stderr.write(`[cfai-mcp-guard] ${msg}\n`);

// Spawn the real MCP server. stdin/stdout piped (we mediate); stderr inherited
// so the server's own diagnostics reach the host's logs unchanged.
//
// Windows: bare commands like `npx` resolve to `npx.cmd` only through a shell,
// but `shell:true` does NOT auto-quote, so paths with spaces break. We only use
// a shell when the command isn't already a concrete .exe, and we quote every
// token ourselves. A direct .exe (e.g. node) spawns without a shell, so paths
// with spaces are passed verbatim.
const child = spawnServer(realCmd);

function spawnServer([cmd, ...args]) {
  const opts = { stdio: ['pipe', 'pipe', 'inherit'] };
  if (process.platform === 'win32' && !/\.exe"?$/i.test(cmd)) {
    const q = (s) => '"' + String(s).replace(/"/g, '\\"') + '"';
    return spawn([cmd, ...args].map(q).join(' '), { ...opts, shell: true });
  }
  return spawn(cmd, args, opts);
}

child.on('error', (err) => {
  elog(`failed to start MCP server: ${err.message}`);
  process.exit(70);
});
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});

// server → host: restore any tokens in the response before forwarding.
// We line-buffer so we can parse individual JSON-RPC messages.
let serverBuf = '';
child.stdout.on('data', (d) => {
  if (vault.size === 0) {
    // No active tokens — fast path, pass through verbatim.
    process.stdout.write(d);
    return;
  }
  // Line-buffer to find complete JSON-RPC messages.
  serverBuf += d.toString('utf8');
  let idx;
  while ((idx = serverBuf.indexOf('\n')) >= 0) {
    const line = serverBuf.slice(0, idx);
    serverBuf = serverBuf.slice(idx + 1);
    if (vault.hasTokens(line)) {
      const restored = vault.restore(line);
      process.stdout.write(restored + '\n');
      elog(`restored tokens in server response`);
    } else {
      process.stdout.write(line + '\n');
    }
  }
});

// host → server: line-buffered NDJSON, inspect each message.
let buf = '';
process.stdin.on('data', (chunk) => {
  buf += chunk.toString('utf8');
  let idx;
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx);
    buf = buf.slice(idx + 1);
    handleLine(line);
  }
});
process.stdin.on('end', () => {
  if (buf.length) handleLine(buf);
  child.stdin.end();
});

function handleLine(line) {
  const trimmed = line.trim();
  if (!trimmed) { child.stdin.write(line + '\n'); return; }

  let msg;
  try { msg = JSON.parse(trimmed); }
  catch { child.stdin.write(line + '\n'); return; } // not JSON we understand — pass through

  let inspection = null;
  try { inspection = inspectMessage(msg); }
  catch (err) { elog(`inspect error (passing through): ${err.message}`); }

  if (shouldBlock(inspection, THRESHOLD)) {
    // Check if ALL matching patterns should be tokenized instead of blocked
    if (TOKENIZE_PATTERNS.size > 0 && shouldTokenize(inspection, TOKENIZE_PATTERNS, THRESHOLD)) {
      const result = tokenizeMessage(msg, vault, TOKENIZE_PATTERNS);
      if (result) {
        const tokenized = JSON.stringify(result.message);
        child.stdin.write(tokenized + '\n');
        elog(`TOKENIZED tools/call "${inspection.toolName}" — ${result.tokenCount} values (${inspection.matches.map((m) => m.pattern).join(', ')})`);
        reportTokenize(inspection, result.tokenCount).catch(() => {});
        return;
      }
    }

    const resp = blockResponse(msg, inspection);
    process.stdout.write(JSON.stringify(resp) + '\n');   // tell the host it was blocked
    elog(`BLOCKED tools/call "${inspection.toolName}" — ${inspection.highestSeverity} (${inspection.matches.map((m) => m.pattern).join(', ')})`);
    report(inspection).catch(() => {});
    return; // do NOT forward to the server
  }

  child.stdin.write(line + '\n');
}

// Best-effort governance event. Never throws into the relay path.
async function report(inspection) {
  if (!SERVER || !TOKEN || typeof fetch !== 'function') return;
  const event = {
    occurredAt: new Date().toISOString(),
    kind: 'enforcement_block',
    service: SERVERNAME,
    source: 'mcp_guard',
    event_kind: 'mcp_tool_call',
    matches: inspection.matches.map((m) => ({ pattern: m.pattern, class: m.class, severity: m.severity, count: m.count })),
    highest_severity: inspection.highestSeverity,
    content_length: inspection.scannedLength,
    length_bucket: lengthBucket(inspection.scannedLength),
  };
  try {
    await fetch(SERVER.replace(/\/$/, '') + '/api/v1/dlp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + TOKEN },
      body: JSON.stringify({ events: [event] }),
    });
  } catch { /* offline / server down — drop, enforcement already happened locally */ }
}

async function reportTokenize(inspection, tokenCount) {
  if (!SERVER || !TOKEN || typeof fetch !== 'function') return;
  const event = {
    occurredAt: new Date().toISOString(),
    kind: 'enforcement_tokenize',
    service: SERVERNAME,
    source: 'mcp_guard',
    event_kind: 'mcp_tool_call',
    mechanism: 'reversible_tokenization',
    token_count: tokenCount,
    matches: inspection.matches.map((m) => ({ pattern: m.pattern, class: m.class, severity: m.severity, count: m.count })),
    highest_severity: inspection.highestSeverity,
    content_length: inspection.scannedLength,
    length_bucket: lengthBucket(inspection.scannedLength),
  };
  try {
    await fetch(SERVER.replace(/\/$/, '') + '/api/v1/dlp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + TOKEN },
      body: JSON.stringify({ events: [event] }),
    });
  } catch {}
}

const tokenizeInfo = TOKENIZE_PATTERNS.size > 0
  ? `, tokenize=[${[...TOKENIZE_PATTERNS].join(',')}]`
  : '';
elog(`guarding: ${realCmd.join(' ')} (threshold=${THRESHOLD}${tokenizeInfo})`);

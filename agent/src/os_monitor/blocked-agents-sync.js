// ── Blocked agents poller ──────────────────────────────────────────────────
// Polls the server's blocked-agents list and writes it to a local JSON file.
// The enforcer PowerShell reads this file to know which desktop app processes
// to fully block (all input swallowed when a blocked agent's app is foreground).
//
// TWO sources feed that one file:
//   1. GET /api/lifecycle/blocked-agents — per-agent blocks, keyed by agent_id
//      and matched to a process via PLATFORM_PROCS.
//   2. GET /api/v1/ai-platforms          — the admin Inventory page's per-HOST
//      `blocked` toggle, previously enforced only by the browser extension.
//      synthesizePlatformBlocks() turns those rows into the same file's shape.
//
// Access exceptions are subtracted here, on the same tick. This is the ONLY
// place desktop un-blocking happens: enforcer-win.ps1 just re-reads the file
// every 10s and needs no notion of exceptions at all. A row is dropped only
// when an admin-approved, unexpired exception exists for a host that row's
// platform maps to (or, for a synthesised platform row, for its own host) —
// see filterBlockedAgents() in ai-processes.js.
//
// This module is shared by BOTH agent entry points — electron/monitor-runner.mjs
// (the Electron app) and src/index.js's --monitor path (the bare-Node CLI, which
// is what build:sea compiles into the standalone .exe). It used to live inline in
// monitor-runner.mjs only, which meant every server-driven block was completely
// inert for anyone who installed the CLI/.exe distribution instead. serverUrl /
// token / log stay explicit parameters because the two callers resolve
// credentials differently (loadCredentials() vs. reading credentials.json
// directly), so nothing here may assume how the caller got them.

import { join } from 'node:path';
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { filterBlockedAgents, synthesizePlatformBlocks, normalizeAgentRows } from './ai-processes.js';

const BLOCKED_PATH = join(homedir(), '.cloudfuze-aigov', 'blocked-agents.json');
const PENDING_REQUEST_PATH = join(homedir(), '.cloudfuze-aigov', 'pending-access-request.json');
// A queued request older than this is stale — the block it was about may well
// have been lifted, or the user may have forgotten they ever asked. Filing it a
// day later would surprise both them and the admin who receives it.
const PENDING_REQUEST_TTL_MS = 24 * 3600 * 1000;

// GET /api/v1/access-exceptions/mine — machine-scoped by the token's claims, so
// nothing here identifies any other device. Returns null (NOT an empty list) on
// any failure: an empty list means "no exceptions", which would re-block an app
// the user has approved access to, while null means "don't touch the file".
async function fetchMyExceptions(serverUrl, token, log) {
  try {
    const res = await fetch(`${serverUrl}/api/v1/access-exceptions/mine`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      log.warn(`access-exceptions: server returned ${res.status} — leaving the blocklist as-is`);
      return null;
    }
    const rows = await res.json();
    return Array.isArray(rows) ? rows : null;
  } catch (err) {
    log.warn(`access-exceptions: fetch failed — ${err.message}`);
    return null;
  }
}

// GET /api/v1/ai-platforms — the admin Inventory rows. Fetched UNFILTERED: the
// `surface` field is not usable as a filter here (no admin UI has ever set it,
// so every row is 'browser' and ?surface=desktop returns nothing), and
// synthesizePlatformBlocks() applies the real desktop-relevance test instead.
// The route is unauthenticated today; the token is sent anyway, matching the
// browser extension's own precedent, so requiring auth later needs no agent
// change. Returns null (NOT []) on failure, for the same fail-closed reason
// fetchMyExceptions does: [] would mean "nothing is platform-blocked".
async function fetchAiPlatforms(serverUrl, token, log) {
  try {
    const res = await fetch(`${serverUrl}/api/v1/ai-platforms`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      log.warn(`ai-platforms: server returned ${res.status} — leaving the blocklist as-is`);
      return null;
    }
    const rows = await res.json();
    return Array.isArray(rows) ? rows : null;
  } catch (err) {
    log.warn(`ai-platforms: fetch failed — ${err.message}`);
    return null;
  }
}

async function refreshBlockedAgents(serverUrl, token, log) {
  // Exceptions first: a fetch failure must leave the previous file untouched
  // rather than briefly rewriting it without the exception applied.
  const exceptions = await fetchMyExceptions(serverUrl, token, log);
  const platforms = await fetchAiPlatforms(serverUrl, token, log);
  try {
    const res = await fetch(`${serverUrl}/api/lifecycle/blocked-agents`);
    if (!res.ok) return;
    const agentRows = await res.json();
    // FAIL CLOSED on either source failing: leave the file completely alone.
    // Writing a file built from only ONE source would silently drop every block
    // the other source contributed — a rewrite that unblocks an app is not
    // recoverable, while a stale file simply keeps enforcing the last known
    // policy until the next tick, 10s away.
    if (platforms === null) {
      log.warn('blocked-agents: ai-platforms unavailable — leaving the blocklist as-is');
      return;
    }
    // Agent rows first so a more specific per-agent block wins if both sources
    // ever name the same process: CheckFgBlocked() returns on its first match,
    // so array order IS the precedence. (Both branches set the same fields, so
    // the only visible difference is which name the block is attributed to.)
    // normalizeAgentRows() is what synthesizePlatformBlocks() has always done to
    // its own fields, applied to the server's per-agent rows too: the .ps1's
    // hand-rolled JSON parser derails on the WHOLE file for one stray quote,
    // backslash or brace in one value. It also downgrades an agent-scoped row
    // whose agent_name cannot survive that transport back to platform scope, so
    // a name the enforcer could never match falls back to a whole-app block
    // rather than silently enforcing nothing. See ai-processes.js.
    const list = normalizeAgentRows(Array.isArray(agentRows) ? agentRows : [], log)
      .concat(synthesizePlatformBlocks(platforms));
    // Fail CLOSED on an exception fetch failure — keep blocking. The user can
    // still ask again; silently unblocking a disallowed app because the server
    // was briefly unreachable is the one outcome that is not recoverable.
    const effective = exceptions === null ? list : filterBlockedAgents(list, exceptions, log);
    mkdirSync(join(homedir(), '.cloudfuze-aigov'), { recursive: true });
    writeFileSync(BLOCKED_PATH, JSON.stringify(effective), 'utf8');
    const lifted = list.length - effective.length;
    log.info(`blocked-agents: synced ${effective.length} blocked agent(s)` + (lifted > 0 ? ` (${lifted} lifted by access exception)` : ''));
  } catch (err) {
    log.warn(`blocked-agents: sync failed — ${err.message}`);
  }
}

// ── Offline access-request queue (single slot) ──────────────────────────────
// Electron's main process POSTs a Request Access submission directly; if the
// network is down it drops the payload here instead of losing it. One slot, not
// a queue: clicking Submit again while offline OVERWRITES the file. There is
// nothing useful about accumulating five identical asks for the same app, and
// the server would 409 all but the first anyway.
//
// The payload holds only what the user typed plus the block's own identity — no
// prompt text, no clipboard, no file contents ever reach this file.
async function flushPendingAccessRequest(serverUrl, token, log) {
  if (!existsSync(PENDING_REQUEST_PATH)) return;
  let payload;
  try {
    payload = JSON.parse(readFileSync(PENDING_REQUEST_PATH, 'utf8'));
  } catch {
    rmSync(PENDING_REQUEST_PATH, { force: true });   // unreadable — nothing to retry
    return;
  }

  const queuedAt = Date.parse(payload?.queued_at || '');
  if (Number.isFinite(queuedAt) && Date.now() - queuedAt > PENDING_REQUEST_TTL_MS) {
    log.info('access-request: dropping a queued request older than 24h');
    rmSync(PENDING_REQUEST_PATH, { force: true });
    return;
  }

  const { queued_at, ...body } = payload || {};
  try {
    const res = await fetch(`${serverUrl}/api/v1/access-requests`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    // 2xx is success; 4xx is a verdict (already pending, rejected within the
    // cooldown, bad payload) — in both cases the queued copy has served its
    // purpose and must not be retried forever. Only 5xx / a thrown network
    // error leaves the slot in place for the next tick.
    if (res.status < 500) {
      rmSync(PENDING_REQUEST_PATH, { force: true });
      log.info(`access-request: queued request submitted (${res.status})`);
    }
  } catch (err) {
    log.warn(`access-request: still offline — ${err.message}`);
  }
}

// Poll every 10 seconds — matching enforcer-win.ps1's own BLOCKED_CHECK_INTERVAL,
// so a block or an approval takes ~20s worst case to reach the keyboard hook
// instead of ~40s. Three cheap GETs per machine per 10s; the queued-request
// flush shares the tick but has no timing dependency of its own (its only clock
// is the 24h PENDING_REQUEST_TTL_MS, and it no-ops immediately when the single
// slot file is absent, which is the normal case).
//
// Returns { stop() } so a caller — or a test — can tear the poller down cleanly.
// Neither entry point strictly needs it today (both run until process exit), but
// the timer is unref()'d exactly as before so it can never hold the process open.
export function startBlockedAgentsSync({ serverUrl, token, log }) {
  const tick = () => {
    refreshBlockedAgents(serverUrl, token, log);
    flushPendingAccessRequest(serverUrl, token, log);
  };
  tick();
  const blockedInterval = setInterval(tick, 10_000);
  blockedInterval.unref();
  return { stop: () => clearInterval(blockedInterval) };
}

export { BLOCKED_PATH, PENDING_REQUEST_PATH, PENDING_REQUEST_TTL_MS };

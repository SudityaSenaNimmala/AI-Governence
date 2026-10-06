// "The browser extension routes in this browser" — the agent side of the
// routing-ownership heartbeat.
//
// CONTRACT (browser-extension/background/service-worker.js sendRoutingHeartbeat):
//   POST http://127.0.0.1:<beacon port>/cfai/routing-heartbeat
//   content-type: application/json
//   { browser: 'chrome'|'edge'|'other', ext_version, routing_owner: true,
//     nonce, instance_id, ts }      — every 30 s
//
// The beacon (identity-beacon.js) validates and records the beat in a small
// state file; the OS monitor (a different process in the Electron build) reads
// it and tells the enforcer which browser PROCESSES are extension-owned. The
// enforcer's WEB arm stands down in those until ~90 s after the last beat (three
// missed beats). The desktop-app arm (Claude Desktop etc.) is never affected.
//
// PRIVACY: nothing about the user or a page is in a beat, and nothing beyond
// "browser kind -> last beat time" is stored. nonce / instance_id / ext_version
// are validated for shape and then dropped.

import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

export const ROUTING_OWNERS_PATH = join(homedir(), '.cloudfuze-aigov', 'routing-owners.json');
export const ROUTING_OWNER_TTL_MS = 90_000;
export const HEARTBEAT_MAX_BYTES = 2048;
const TS_SKEW_MS = 5 * 60_000;   // same machine, same clock: anything further is not a live beat

// Browser KIND (from the extension's user agent) -> the process names the
// enforcer sees. 'chrome' is every non-Edge Chromium: Brave, Vivaldi and Opera
// send a Chrome user agent, so a 'chrome' beat may well come from one of them.
// Standing the web arm down in all of them costs, at worst, the agent not
// routing in a Chromium browser the extension is not in — never two routers
// fighting over one picker.
export const BROWSER_PROCESSES = {
  chrome: ['chrome', 'brave', 'vivaldi', 'opera'],
  edge: ['msedge'],
  other: ['firefox'],
};

const NONCE_RE = /^[0-9a-f]{8,64}$/i;
const INSTANCE_RE = /^[A-Za-z0-9_-]{8,128}$/;
const VERSION_RE = /^[0-9A-Za-z._-]{1,32}$/;

/**
 * Shape check for one beat. Returns { ok: true, browser } or { ok: false, error }.
 * `seenNonces` (a Map nonce -> ms), when given, rejects a replayed beat.
 */
export function validateRoutingHeartbeat(body, { now = Date.now(), seenNonces = null } = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'not an object' };
  const allowed = new Set(['browser', 'ext_version', 'routing_owner', 'nonce', 'instance_id', 'ts']);
  for (const k of Object.keys(body)) if (!allowed.has(k)) return { ok: false, error: `unexpected field ${k.slice(0, 32)}` };
  if (!Object.prototype.hasOwnProperty.call(BROWSER_PROCESSES, body.browser)) return { ok: false, error: 'bad browser' };
  if (body.routing_owner !== true) return { ok: false, error: 'routing_owner must be true' };
  if (typeof body.nonce !== 'string' || !NONCE_RE.test(body.nonce)) return { ok: false, error: 'bad nonce' };
  if (typeof body.instance_id !== 'string' || !INSTANCE_RE.test(body.instance_id)) return { ok: false, error: 'bad instance_id' };
  if (!(body.ext_version === null || body.ext_version === undefined
    || (typeof body.ext_version === 'string' && VERSION_RE.test(body.ext_version)))) return { ok: false, error: 'bad ext_version' };
  const ts = typeof body.ts === 'string' && body.ts.length <= 40 ? Date.parse(body.ts) : NaN;
  if (!Number.isFinite(ts) || Math.abs(ts - now) > TS_SKEW_MS) return { ok: false, error: 'stale or bad ts' };
  if (seenNonces) {
    for (const [n, at] of seenNonces) if (now - at > TS_SKEW_MS * 2) seenNonces.delete(n);
    if (seenNonces.has(body.nonce)) return { ok: false, error: 'replayed nonce' };
    if (seenNonces.size < 1000) seenNonces.set(body.nonce, now);
  }
  return { ok: true, browser: body.browser };
}

function readState(path) {
  try {
    const s = JSON.parse(readFileSync(path, 'utf8'));
    return s && typeof s === 'object' && s.beats && typeof s.beats === 'object' ? s : { beats: {} };
  } catch { return { beats: {} }; }
}

/** Record a validated beat: browser kind -> last beat time. Atomic replace. */
export function recordRoutingHeartbeat(browser, { path = ROUTING_OWNERS_PATH, now = Date.now() } = {}) {
  if (!Object.prototype.hasOwnProperty.call(BROWSER_PROCESSES, browser)) return false;
  const state = readState(path);
  const beats = {};
  for (const k of Object.keys(BROWSER_PROCESSES)) {
    const v = state.beats[k];
    if (typeof v === 'number' && Number.isFinite(v)) beats[k] = v;
  }
  beats[browser] = now;
  try {
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify({ beats }), 'utf8');
    renameSync(tmp, path);
    return true;
  } catch { return false; }
}

/**
 * Browser PROCESS name -> owned-until (epoch ms), for every browser kind whose
 * last beat is within the ttl. A beat stamped in the future is clamped to now.
 */
export function readRoutingOwners({ path = ROUTING_OWNERS_PATH, now = Date.now(), ttlMs = ROUTING_OWNER_TTL_MS } = {}) {
  const out = new Map();
  const { beats } = readState(path);
  for (const [kind, procs] of Object.entries(BROWSER_PROCESSES)) {
    const at = beats[kind];
    if (typeof at !== 'number' || !Number.isFinite(at)) continue;
    const until = Math.min(at, now) + ttlMs;
    if (until <= now) continue;
    for (const p of procs) out.set(p, Math.max(out.get(p) || 0, until));
  }
  return out;
}

function isLoopback(addr) {
  const a = String(addr || '');
  return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';
}

// A web PAGE can POST to a loopback port too, and it could otherwise claim
// ownership and switch the agent's web arm off. Its Origin is http(s)://…, which
// a page cannot forge; an extension's service worker sends its own extension
// origin. No Origin at all is a local non-browser client.
function originAllowed(origin) {
  if (origin === undefined || origin === null || origin === '') return true;
  return /^(chrome-extension|extension|moz-extension|safari-web-extension):\/\/[A-Za-z0-9._-]+\/?$/.test(String(origin));
}

/**
 * The beacon's request handler for POST /cfai/routing-heartbeat. Answers 204 on
 * success; 400/403/413 otherwise. Never echoes the body.
 */
export function handleRoutingHeartbeat(req, res, { path = ROUTING_OWNERS_PATH, seenNonces = null, onBeat = null, now = () => Date.now() } = {}) {
  const reply = (code) => { if (!res.headersSent) res.writeHead(code); res.end(); };
  if (!isLoopback(req.socket?.remoteAddress)) return reply(403);
  if (!originAllowed(req.headers?.origin)) return reply(403);
  const ctype = String(req.headers?.['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (ctype !== 'application/json') return reply(415);
  const declared = Number(req.headers?.['content-length']);
  if (Number.isFinite(declared) && declared > HEARTBEAT_MAX_BYTES) return reply(413);

  let size = 0;
  const chunks = [];
  let aborted = false;
  req.on('data', (c) => {
    if (aborted) return;
    size += c.length;
    if (size > HEARTBEAT_MAX_BYTES) { aborted = true; reply(413); req.destroy?.(); return; }
    chunks.push(c);
  });
  req.on('end', () => {
    if (aborted) return;
    let body;
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return reply(400); }
    const v = validateRoutingHeartbeat(body, { now: now(), seenNonces });
    if (!v.ok) return reply(400);
    recordRoutingHeartbeat(v.browser, { path, now: now() });
    try { onBeat?.(v.browser); } catch { /* never fail the beat */ }
    return reply(204);
  });
  req.on('error', () => reply(400));
}

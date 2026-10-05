// Desktop-agent model routing, Node side:
//   * the extension's routing heartbeat on the local beacon (validation,
//     loopback/extension-origin only, size cap, replay guard, ownership file);
//   * the policy poll (ETag/304, 404 -> legacy feed, failures keep the policy);
//   * Enforcer.updateRouterConfig / setRoutingFleet / setRoutingOwners pushing
//     to the RUNNING helper on stdin instead of restarting it;
//   * the route line -> model_routed field mapping;
//   * one timer owner for the policy poll (no constructor duplicate).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

import {
  validateRoutingHeartbeat, recordRoutingHeartbeat, readRoutingOwners,
  BROWSER_PROCESSES, ROUTING_OWNER_TTL_MS,
} from '../src/os_monitor/routing-ownership.js';
import { startIdentityBeacon } from '../src/identity-beacon.js';
import { fetchRoutingPolicy, RoutingPolicySync } from '../src/os_monitor/routing-policy-sync.js';
import { Enforcer } from '../src/os_monitor/enforcer.js';
import { modelRoutedFields, routeResult } from '../src/os_monitor/route-event.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const AGENT_DIR = join(HERE, '..');
const tmp = () => mkdtempSync(join(tmpdir(), 'cfai-routing-'));

const beat = (over = {}) => ({
  browser: 'chrome', ext_version: '0.9.0', routing_owner: true,
  nonce: 'a1b2c3d4e5f60718293a4b5c6d7e8f90', instance_id: '0123456789abcdef0123456789abcdef',
  ts: new Date().toISOString(), ...over,
});

// ── validation ───────────────────────────────────────────────────────────────

test('heartbeat: a well-formed beat is accepted; every malformed shape is refused', () => {
  assert.deepEqual(validateRoutingHeartbeat(beat()), { ok: true, browser: 'chrome' });
  assert.equal(validateRoutingHeartbeat(beat({ browser: 'edge' })).browser, 'edge');
  assert.equal(validateRoutingHeartbeat(beat({ ext_version: null })).ok, true);
  for (const bad of [
    null, [], 'x', beat({ browser: 'safari' }), beat({ routing_owner: false }), beat({ routing_owner: 'true' }),
    beat({ nonce: 'zz' }), beat({ nonce: 'not hex at all!!' }), beat({ instance_id: 'short' }),
    beat({ instance_id: 'has spaces in it ok' }), beat({ ext_version: '<script>' }),
    beat({ ts: 'yesterday' }), beat({ ts: new Date(Date.now() - 10 * 60_000).toISOString() }),
    { ...beat(), prompt: 'my SSN is 123-45-6789' },
  ]) {
    assert.equal(validateRoutingHeartbeat(bad).ok, false, `must refuse ${JSON.stringify(bad)?.slice(0, 80)}`);
  }
});

test('heartbeat: a replayed nonce is refused', () => {
  const seen = new Map();
  assert.equal(validateRoutingHeartbeat(beat(), { seenNonces: seen }).ok, true);
  assert.equal(validateRoutingHeartbeat(beat(), { seenNonces: seen }).ok, false);
  assert.equal(validateRoutingHeartbeat(beat({ nonce: 'ffffffffffffffff' }), { seenNonces: seen }).ok, true);
});

test('ownership: a beat owns that browser kind\'s processes for ~90s, then lapses', () => {
  const path = join(tmp(), 'owners.json');
  const t0 = 1_800_000_000_000;
  assert.equal(recordRoutingHeartbeat('chrome', { path, now: t0 }), true);
  let owners = readRoutingOwners({ path, now: t0 + 1000 });
  for (const p of BROWSER_PROCESSES.chrome) assert.equal(owners.get(p), t0 + ROUTING_OWNER_TTL_MS);
  assert.equal(owners.has('msedge'), false, 'per browser kind');
  assert.equal(owners.has('claude'), false, 'never a desktop app');
  owners = readRoutingOwners({ path, now: t0 + ROUTING_OWNER_TTL_MS + 1 });
  assert.equal(owners.size, 0, 'three missed beats release it');
  // Only browser -> time is stored. No nonce, instance id or version.
  const stored = JSON.parse(readFileSync(path, 'utf8'));
  assert.deepEqual(Object.keys(stored), ['beats']);
  assert.deepEqual(Object.keys(stored.beats), ['chrome']);
  // A corrupt file reads as "nobody owns anything", never a throw.
  writeFileSync(path, '{not json');
  assert.equal(readRoutingOwners({ path }).size, 0);
});

// ── the beacon endpoint ──────────────────────────────────────────────────────

function startBeacon(path) {
  const server = startIdentityBeacon({ machineId: 'm-test', user: 'u@example.com', ports: [0], routingOwnersPath: path });
  return new Promise((resolve) => server.on('listening', () => resolve(server)));
}

function post(port, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = typeof body === 'string' ? body : JSON.stringify(body);
    const req = http.request({
      host: '127.0.0.1', port, path: '/cfai/routing-heartbeat', method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data), ...headers },
    }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    req.on('error', reject);
    req.end(data);
  });
}

test('beacon: POST /cfai/routing-heartbeat records a valid beat (204) and refuses the rest', async () => {
  const path = join(tmp(), 'owners.json');
  const server = await startBeacon(path);
  const port = server.address().port;
  try {
    assert.equal(await post(port, beat(), { origin: 'chrome-extension://abcdefghijklmnop' }), 204);
    assert.ok(readRoutingOwners({ path }).has('chrome'), 'the beat is recorded');
    assert.equal(await post(port, beat()), 400, 'the same nonce again is a replay');
    // A web PAGE cannot claim ownership.
    assert.equal(await post(port, beat({ browser: 'edge', nonce: 'abababababababab' }), { origin: 'https://evil.example' }), 403);
    assert.equal(readRoutingOwners({ path }).has('msedge'), false);
    // Shape, type and size.
    assert.equal(await post(port, beat({ browser: 'nope', nonce: 'cdcdcdcdcdcdcdcd' })), 400);
    assert.equal(await post(port, '{"browser":', {}), 400);
    assert.equal(await post(port, beat({ nonce: 'efefefefefefefef' }), { 'content-type': 'text/plain' }), 415);
    assert.equal(await post(port, JSON.stringify({ pad: 'x'.repeat(5000) })), 413);
    // The identity GET is unchanged.
    const id = await new Promise((resolve) => http.get({ host: '127.0.0.1', port, path: '/cfai/identity' }, (res) => {
      let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => resolve(JSON.parse(b)));
    }));
    assert.equal(id.machineId, 'm-test');
  } finally {
    server.close();
  }
});

// ── the policy poll ──────────────────────────────────────────────────────────

function fakeFetch(routes) {
  const calls = [];
  const impl = async (url, opts = {}) => {
    calls.push({ url, headers: opts.headers || {} });
    const r = routes(url, opts.headers || {});
    return {
      status: r.status, ok: r.status >= 200 && r.status < 300,
      headers: { get: (k) => (r.headers || {})[k.toLowerCase()] || null },
      json: async () => r.body,
    };
  };
  return { impl, calls };
}

const POLICY = {
  version: 'v-1', schema_version: 2, rules: [], catalog_overrides: [],
  settings: { allow_upgrade: true, respect_user_override: true }, fleet_enabled: true, generated_at: '2026-10-05T00:00:00Z',
};

test('policy: 200 -> updated (machine JWT, unfiltered), 304 -> unchanged, 404 -> legacy rules', async () => {
  const { impl, calls } = fakeFetch((url, h) => {
    if (url.endsWith('/api/v1/routing/policy')) {
      if (h['if-none-match'] === '"v-1"') return { status: 304 };
      return { status: 200, body: POLICY, headers: { etag: '"v-1"' } };
    }
    return { status: 500 };
  });
  const r1 = await fetchRoutingPolicy({ serverUrl: 'http://s/', token: 'jwt', fetchImpl: impl });
  assert.equal(r1.status, 'updated');
  assert.equal(r1.version, 'v-1');
  assert.equal(r1.etag, '"v-1"');
  assert.equal('generated_at' in r1.policy, false, 'per-response noise is not policy');
  assert.equal(calls[0].headers.authorization, 'Bearer jwt');
  assert.equal(calls[0].url, 'http://s/api/v1/routing/policy', 'no ?surface= filter: the web arm needs browser-scoped rules too');
  const r2 = await fetchRoutingPolicy({ serverUrl: 'http://s', token: 'jwt', etag: '"v-1"', fetchImpl: impl });
  assert.equal(r2.status, 'unchanged');

  const legacy = fakeFetch((url) => (url.endsWith('/policy') ? { status: 404 } : { status: 200, body: [{ id: 'r1', action: { ui_name: 'Haiku' } }] }));
  const r3 = await fetchRoutingPolicy({ serverUrl: 'http://s', token: 'jwt', fetchImpl: legacy.impl });
  assert.equal(r3.status, 'legacy');
  assert.deepEqual(r3.policy, [{ id: 'r1', action: { ui_name: 'Haiku' } }]);
  assert.equal(legacy.calls[1].headers.authorization, undefined, 'the legacy feed is unauthenticated');

  for (const status of [401, 500]) {
    const f = fakeFetch(() => ({ status }));
    assert.equal((await fetchRoutingPolicy({ serverUrl: 'http://s', token: 'jwt', fetchImpl: f.impl })).status, 'error');
  }
  const malformed = fakeFetch(() => ({ status: 200, body: { rules: 'nope' } }));
  assert.equal((await fetchRoutingPolicy({ serverUrl: 'http://s', token: 'jwt', fetchImpl: malformed.impl })).status, 'error');
});

test('policy sync: delivers on a version change only, caches to disk, keeps the policy on failure', async () => {
  const cachePath = join(tmp(), 'routing-policy.json');
  let mode = 'v1';
  const { impl } = fakeFetch(() => {
    if (mode === 'down') return { status: 503 };
    if (mode === 'v2') return { status: 200, body: { ...POLICY, version: 'v-2' }, headers: { etag: '"v-2"' } };
    return { status: 200, body: POLICY, headers: { etag: '"v-1"' } };
  });
  const delivered = [];
  const sync = new RoutingPolicySync({
    serverUrl: 'http://s', getToken: () => 'jwt', cachePath, fetchImpl: impl,
    onPolicy: (p, v) => delivered.push(v),
  });
  assert.equal(sync.primeFromCache(), false, 'nothing cached yet');
  await sync.refresh();
  await sync.refresh();                 // same version: not delivered again
  mode = 'down';
  await sync.refresh();                 // failure: nothing delivered, nothing lost
  mode = 'v2';
  await sync.refresh();
  assert.deepEqual(delivered, ['v-1', 'v-2']);
  const cached = JSON.parse(readFileSync(cachePath, 'utf8'));
  assert.equal(cached.version, 'v-2');
  assert.equal(cached.etag, '"v-2"');
  // A new process primes from that cache before its first fetch.
  const again = [];
  const s2 = new RoutingPolicySync({ serverUrl: 'http://s', getToken: () => 'jwt', cachePath, fetchImpl: impl, onPolicy: (p, v) => again.push(v) });
  assert.equal(s2.primeFromCache(), true);
  assert.deepEqual(again, ['v-2']);
});

// ── pushing to the running helper ────────────────────────────────────────────

function enforcerWithFakeChild() {
  const e = new Enforcer({ log: null, aiProcessNames: [], blockPatterns: [] });
  const writes = [];
  let killed = 0;
  e.child = { stdin: { destroyed: false, write: (l) => writes.push(JSON.parse(l)) }, kill: () => { killed++; } };
  return { e, writes, killed: () => killed };
}

test('CONFIG RELOAD: updateRouterConfig pushes a new policy on stdin, once per version, never restarts', () => {
  const { e, writes, killed } = enforcerWithFakeChild();
  assert.equal(e.updateRouterConfig(POLICY, 'v-1'), true);
  assert.equal(e.updateRouterConfig(POLICY, 'v-1'), false, 'same version is a no-op');
  assert.equal(e.updateRouterConfig({ ...POLICY, version: 'v-2' }, 'v-2'), true);
  assert.deepEqual(writes.map((w) => [w.cmd, w.policy?.version]), [['router_policy', 'v-1'], ['router_policy', 'v-2']]);
  assert.equal(killed(), 0, 'a policy change must not drop keystroke protection by restarting the helper');
  // Independent of the DLP patterns: updateBlockPatterns with unchanged patterns
  // still does nothing, which is exactly why the old path never delivered rules.
  assert.equal(e.updateBlockPatterns([]), false);
});

test('FLEET: setRoutingFleet pushes a bare on/off', () => {
  const { e, writes } = enforcerWithFakeChild();
  e.setRoutingFleet(false);
  e.setRoutingFleet(true);
  assert.deepEqual(writes, [{ cmd: 'router_fleet', state: 'off' }, { cmd: 'router_fleet', state: 'on' }]);
});

test('OWNERSHIP: setRoutingOwners pushes a capped ttl per process and releases dropped ones', () => {
  const { e, writes } = enforcerWithFakeChild();
  const now = Date.now();
  e.setRoutingOwners(new Map([['chrome', now + 60_000], ['msedge', now + 999_999]]));
  const chrome = writes.find((w) => w.process === 'chrome');
  assert.ok(chrome.ttl_ms > 55_000 && chrome.ttl_ms <= 60_000);
  assert.equal(writes.find((w) => w.process === 'msedge').ttl_ms, 120_000, 'capped');
  writes.length = 0;
  e.setRoutingOwners(new Map([['chrome', now + 60_000]]));
  assert.deepEqual(writes.find((w) => w.process === 'msedge'), { cmd: 'routing_owner', process: 'msedge', ttl_ms: 0 });
});

// ── the event ────────────────────────────────────────────────────────────────

test('model_routed: route lines map to the routing v2 allowlist, with no prompt content', () => {
  const desktop = modelRoutedFields({
    kind: 'route', process: 'claude', provider: 'anthropic', from_tier: 'premium', to_tier: 'economy',
    to_label: 'Haiku 4.5', complexity: 'simple', effort_from: 'High', effort_to: 'Low', result: 'ok', len: 12,
    surface: 'desktop_app', host_or_app: 'claude_desktop', rule_id: 'r1', model: 'claude-haiku-4-5', from_label: 'Opus 5',
  });
  assert.deepEqual(desktop, {
    mechanism: 'desktop_uia', surface: 'desktop_app', result: 'applied', host_or_app: 'claude_desktop',
    provider: 'anthropic', from_tier: 'premium', from_label: 'Opus 5', to_tier: 'economy', to_label: 'Haiku 4.5',
    model: 'claude-haiku-4-5', complexity: 'simple', rule_id: 'r1', effort_from: 'high', effort_to: 'low', len: 12,
  });
  const web = modelRoutedFields({ browser_host: 'claude.ai', result: 'noop', reason: 'already_on_target', len: 5, from_tier: 'standard' });
  assert.equal(web.mechanism, 'desktop_web_uia');
  assert.equal(web.surface, 'browser');
  assert.equal(web.host_or_app, 'claude.ai');
  assert.equal(web.result, 'noop');

  assert.equal(routeResult({ result: 'failed' }), 'failed');
  assert.equal(routeResult({ result: 'aborted' }), 'failed');
  assert.equal(routeResult({ result: 'restored_not_sent' }), 'failed');
  assert.equal(routeResult({ result: 'sent_unrouted', reason: 'picker_not_found' }), 'failed');
  assert.equal(routeResult({ result: 'sent_unrouted', reason: 'already_on_target' }), 'noop');
  for (const r of ['suggested', 'observed', 'unsupported', 'user_override']) assert.equal(routeResult({ result: r }), r);
  assert.equal(modelRoutedFields({ result: 'failed', len: -1 }).len, undefined, 'unknown length is omitted');
  // Only named fields travel.
  const leak = modelRoutedFields({ result: 'ok', prompt: 'secret', text: 'secret', originalText: 'secret' });
  assert.equal(JSON.stringify(leak).includes('secret'), false);
});

// ── one timer owner ──────────────────────────────────────────────────────────

test('TIMERS: the policy poll is started only in start() and cleared in stop()', async () => {
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'index.js'), 'utf8');
  const ctorStart = src.indexOf('  constructor(');
  const startAt = src.indexOf('\n  start() {');
  const ctor = src.slice(ctorStart, startAt);
  assert.equal(/#refreshRoutingRules\(\)/.test(ctor), false, 'the constructor must not schedule a policy poll');
  assert.equal((src.match(/this\._routingRulesInterval = setInterval/g) || []).length, 1);
  assert.match(src, /if \(this\._routingRulesTimer\) \{ clearTimeout\(this\._routingRulesTimer\); this\._routingRulesTimer = null; \}/);
  assert.match(src, /if \(this\._routingRulesInterval\) \{ clearInterval\(this\._routingRulesInterval\); this\._routingRulesInterval = null; \}/);
  assert.match(src, /if \(this\._routingOwnersTimer\) \{ clearInterval\(this\._routingOwnersTimer\); this\._routingOwnersTimer = null; \}/);
  // The old path restarted the helper through updateBlockPatterns, which is a
  // no-op when the DLP patterns are unchanged.
  const refresh = src.slice(src.indexOf('async #refreshRoutingRules()'), src.indexOf('\n  stop() {'));
  assert.equal(/updateBlockPatterns/.test(refresh), false);
  // The fleet switch reaches the enforcer.
  assert.match(src, /this\.enforcer\?\.setRoutingFleet\?\.\(want\('model_routing'\)\);/);
});

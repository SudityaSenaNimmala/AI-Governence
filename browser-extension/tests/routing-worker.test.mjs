// The service worker's routing duties, through its REAL module:
//   * GET /api/v1/routing/policy with the machine JWT and If-None-Match,
//     a 304 keeps the mirror, a 404 falls back to the legacy /routing/rules feed,
//     any other failure keeps the previous mirror;
//   * the desktop-agent ownership heartbeat (POST /cfai/routing-heartbeat).
//
// Own process (node --test runs each file separately), own stubs — the worker is
// an ES module and is evaluated once per process, so sharing worker-load's
// instance would couple the two files' fixtures.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const WORKER = new URL('../background/service-worker.js', import.meta.url).href;

function response(status, body, headers = {}) {
  const h = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k) => h[String(k).toLowerCase()] ?? null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

const calls = [];
const routes = new Map();
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(url);
  const method = (init.method || 'GET').toUpperCase();
  let body = null;
  if (typeof init.body === 'string') { try { body = JSON.parse(init.body); } catch { body = init.body; } }
  calls.push({ method, host: u.host, path: u.pathname, headers: init.headers || {}, body });
  const h = routes.get(`${method} ${u.host}${u.pathname}`) ?? routes.get(`${method} ${u.pathname}`) ?? routes.get(u.pathname);
  if (typeof h === 'function') return h({ method, headers: init.headers || {}, body });
  if (h) return h;
  return response(404, { error: 'no stub' });
};
const of = (path) => calls.filter((c) => c.path === path);

const store = {};
const alarms = [];
const alarmListeners = [];
const noopEvent = { addListener: () => {} };
globalThis.chrome = {
  storage: {
    local: {
      get: async (keys) => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map((k) => [k, store[k]])),
      set: async (obj) => { Object.assign(store, obj); },
      remove: async (keys) => { for (const k of (Array.isArray(keys) ? keys : [keys])) delete store[k]; },
    },
    managed: { get: async () => ({}) },
    onChanged: noopEvent,
  },
  runtime: {
    onMessage: noopEvent, onStartup: noopEvent, onInstalled: noopEvent,
    sendMessage: () => {}, getURL: (p) => 'chrome-extension://test/' + p,
    getManifest: () => ({ version: '9.9.9' }),
    openOptionsPage: () => {},
  },
  alarms: {
    create: (name, opts) => alarms.push({ name, ...opts }),
    clear: async () => true,
    onAlarm: { addListener: (fn) => alarmListeners.push(fn) },
  },
  tabs: { onRemoved: noopEvent, query: async () => [], sendMessage: () => {}, get: async () => ({}) },
  webNavigation: { onCommitted: noopEvent, onHistoryStateUpdated: noopEvent },
  action: { onClicked: noopEvent },
  scripting: { executeScript: async () => {}, insertCSS: async () => {} },
  notifications: { create: () => {} },
};
const _si = globalThis.setInterval;
globalThis.setInterval = (fn, ms, ...rest) => { const t = _si(fn, ms, ...rest); t?.unref?.(); return t; };

store['cfai.config'] = { serverUrl: 'https://gov.example.test', enrollSecret: 's3cret' };
store['cfai.token'] = 'test-jwt';
routes.set('POST /api/v1/enroll', response(200, { token: 'test-jwt' }));

const POLICY = {
  version: 'pol-1', fleet_enabled: true,
  settings: { allow_upgrade: true, respect_user_override: true },
  catalog_overrides: [], rules: [{ id: 'r1', enabled: true, priority: 10, action: { type: 'set_tier', target_tier: 'economy' } }],
};
let policyHandler = () => response(200, POLICY, { ETag: '"pol-1"' });
routes.set('GET /api/v1/routing/policy', (req) => policyHandler(req));

const worker = await import(WORKER);
const settle = () => new Promise((r) => setTimeout(r, 30));
await settle();

const fireAlarm = async (name) => { for (const fn of alarmListeners) fn({ name }); await settle(); };

test('startup pulls the v2 policy with the machine JWT and caches it with its ETag', () => {
  const pulls = of('/api/v1/routing/policy');
  assert.ok(pulls.length >= 1, 'the policy is fetched at startup');
  assert.match(String(pulls[0].headers.authorization || ''), /^Bearer /, 'machine-authenticated');
  assert.deepEqual(store['cfai.routing_policy'].policy, POLICY);
  assert.equal(store['cfai.routing_policy'].etag, '"pol-1"');
  assert.equal(store['cfai.routing_policy'].source, 'v2');
  assert.equal(of('/api/v1/routing/rules').length, 0, 'no legacy fetch when v2 answers');
});

test('the next poll is conditional, and a 304 keeps the mirror untouched', async () => {
  let seen = null;
  policyHandler = (req) => { seen = req.headers['if-none-match']; return response(304, null); };
  await fireAlarm('cfai-routing-refresh');
  assert.equal(seen, '"pol-1"', 'If-None-Match carries the cached ETag');
  assert.deepEqual(store['cfai.routing_policy'].policy, POLICY);
});

test('a server error keeps the previous mirror (an outage never disables rules)', async () => {
  policyHandler = () => response(503, { error: 'down' });
  await fireAlarm('cfai-routing-refresh');
  assert.deepEqual(store['cfai.routing_policy'].policy, POLICY);
});

test('a malformed policy body is ignored, not stored', async () => {
  policyHandler = () => response(200, { nope: true });
  await fireAlarm('cfai-routing-refresh');
  assert.deepEqual(store['cfai.routing_policy'].policy, POLICY);
});

test('a 404 (server without routing v2) falls back to the legacy rules feed and drops the v2 mirror', async () => {
  policyHandler = () => response(404, { error: 'not found' });
  routes.set('GET /api/v1/routing/rules', response(200, [
    { id: 'b', enabled: true, priority: 30 }, { id: 'a', enabled: true, priority: 10 }, { id: 'off', enabled: false },
  ]));
  await fireAlarm('cfai-routing-refresh');
  assert.equal(store['cfai.routing_policy'], undefined, 'stale v2 mirror removed so content uses the legacy feed');
  assert.deepEqual(store['cfai.routing_rules'].map((r) => r.id), ['a', 'b']);
});

test('the heartbeat alarm exists at 30 s and has a handler', () => {
  const hb = alarms.find((a) => a.name === 'cfai-routing-heartbeat');
  assert.ok(hb, 'heartbeat alarm created');
  assert.equal(hb.periodInMinutes, 0.5);
});

test('no desktop agent → no heartbeat is sent', async () => {
  calls.length = 0;
  assert.equal(await worker.sendRoutingHeartbeat(), null);
  assert.equal(calls.filter((c) => c.path === '/cfai/routing-heartbeat').length, 0);
});

test('with the agent beacon up, the heartbeat posts the documented contract to the SAME port', async () => {
  calls.length = 0;
  routes.set('GET 127.0.0.1:19534/cfai/identity', response(200, { hostname: 'PC-1', user: 'u' }));
  let got = null;
  routes.set('POST 127.0.0.1:19534/cfai/routing-heartbeat', (req) => { got = req.body; return response(204, null); });
  const sent = await worker.sendRoutingHeartbeat();
  assert.ok(sent && got, 'a heartbeat was posted');
  const hb = calls.find((c) => c.path === '/cfai/routing-heartbeat');
  assert.equal(hb.host, '127.0.0.1:19534', 'posted to the port whose beacon answered');
  assert.equal(hb.method, 'POST');
  assert.equal(hb.headers['content-type'], 'application/json');
  assert.deepEqual(Object.keys(got).sort(), ['browser', 'ext_version', 'instance_id', 'nonce', 'routing_owner', 'ts']);
  assert.equal(got.routing_owner, true);
  assert.equal(got.ext_version, '9.9.9');
  assert.match(got.nonce, /^[0-9a-f]{32}$/);
  assert.match(got.instance_id, /^[0-9a-f]{32}$/);
  assert.ok(['chrome', 'edge', 'other'].includes(got.browser));

  const first = { ...got };
  const again = await worker.sendRoutingHeartbeat();
  assert.notEqual(again.nonce, first.nonce, 'nonce is fresh per beat');
  assert.equal(again.instance_id, first.instance_id, 'instance_id is stable');
});

test('an agent too old to know the endpoint is harmless', async () => {
  routes.delete('POST 127.0.0.1:19534/cfai/routing-heartbeat');   // falls to the 404 stub
  const sent = await worker.sendRoutingHeartbeat();
  assert.ok(sent, 'it still attempted, and did not throw');
});

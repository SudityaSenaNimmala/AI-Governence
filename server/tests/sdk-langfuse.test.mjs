// Developer SDK ↔ Langfuse Cloud: credential issuing (routes/sdk.js), the
// ingestion gateway (routes/langfuse-gateway.js) and the trace read-back path.
//
// Same harness as the sibling suites: real Express handlers over real HTTP with
// a real admin token, and only the Mongo handle faked (tests/helpers/fake-db.mjs).
// The one extra fake here is the OUTBOUND call to Langfuse Cloud: globalThis.fetch
// is wrapped so requests to the (deliberately unroutable) Langfuse base URL are
// captured and answered locally, while requests to our own test server pass
// straight through to the real fetch. No test makes a real network call.
//
// The Langfuse env vars are set per test rather than read from the environment,
// so the suite behaves identically on a machine where Langfuse is configured and
// one where it is not.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import crypto from 'node:crypto';

import {
  mountSdk,
  mintProjectCredentials,
  verifyProjectSecret,
  sha256Hex,
  mapObservation,
  providerForModel,
  currentBudgetMonth,
  DEFAULT_MONTHLY_EVENT_BUDGET,
  _clearSdkReadCache,
} from '../src/routes/sdk.js';
import { mountLangfuseGateway, stampBatch, parseBasicAuth } from '../src/routes/langfuse-gateway.js';
import { mountTracing } from '../src/routes/tracing.js';
import {
  mountTracingIngestBodyLimit,
  tracingBackend,
  checkRateLimit,
  _resetTracingRateLimits,
} from '../src/lib/tracing-store.js';
import {
  planIngestion,
  normalizeEvent,
  costForGeneration,
  preview,
  levelRank,
  levelForRank,
  MAX_BATCH_ITEMS,
  DEFAULT_RETENTION_DAYS,
} from '../src/lib/tracing-ingest.js';
import { sweepExpiredTraces } from '../src/lib/tracing-retention.js';
import { ADMIN_TOKEN } from '../src/auth.js';
import { applyInitialSchema } from '../src/db/index.js';
import { createFakeDb } from './helpers/fake-db.mjs';
import { dropLegacySdkData } from '../scripts/drop-legacy-sdk-collections.mjs';

const PROJECTS = 'sdk_projects';
const TRACES = 'lf_traces';
const OBSERVATIONS = 'lf_observations';
const OBSERVATION_IO = 'lf_observation_io';
const LF_BASE = 'https://langfuse.invalid-for-tests';

// ── Langfuse env, owned by the test ──────────────────────────────────────────
function setLangfuseEnv(configured) {
  if (configured) {
    process.env.LANGFUSE_BASE_URL = LF_BASE;
    process.env.LANGFUSE_PUBLIC_KEY = 'pk-lf-cloudfuze-real';
    process.env.LANGFUSE_SECRET_KEY = 'sk-lf-cloudfuze-real';
  } else {
    delete process.env.LANGFUSE_BASE_URL;
    delete process.env.LANGFUSE_PUBLIC_KEY;
    delete process.env.LANGFUSE_SECRET_KEY;
  }
}

// Intercept only the outbound Langfuse calls. `routes` maps a path prefix to a
// handler returning { status, body, contentType }.
function stubLangfuse(routes = {}) {
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : String(input?.url ?? input);
    if (!url.startsWith(LF_BASE)) return real(input, init);

    const path = url.slice(LF_BASE.length);
    calls.push({
      path,
      method: init?.method || 'GET',
      authorization: init?.headers?.authorization,
      body: init?.body,
      json: (() => { try { return JSON.parse(init?.body); } catch { return null; } })(),
    });
    const key = Object.keys(routes).find((p) => path.startsWith(p));
    const out = key ? await routes[key]({ path, init }) : { status: 200, body: { successes: [], errors: [] } };
    return new Response(
      typeof out.body === 'string' ? out.body : JSON.stringify(out.body ?? {}),
      { status: out.status ?? 200, headers: { 'content-type': out.contentType || 'application/json' } },
    );
  };
  return { calls, restore() { globalThis.fetch = real; } };
}

// `backend` selects CFAI_TRACING_BACKEND for the duration of the test.
//
// It defaults to 'langfuse' here, which is NOT the production default — in
// production the env var is unset and that means 'local'. Every test in sections
// 1–11 below is about the Langfuse Cloud relay, which is now the opt-in path, so
// they pin it explicitly rather than being silently rerouted to local storage.
// Section 12 exercises the default. The pin is set per test rather than read from
// the environment for the same reason the Langfuse keys are: the suite must
// behave identically on a machine that has the var set and one that does not.
async function withServer(fn, { langfuse = true, backend = 'langfuse' } = {}) {
  const db = createFakeDb();
  await applyInitialSchema(db);
  _clearSdkReadCache();
  _resetTracingRateLimits();
  setLangfuseEnv(langfuse);
  const previousBackend = process.env.CFAI_TRACING_BACKEND;
  if (backend === null) delete process.env.CFAI_TRACING_BACKEND;
  else process.env.CFAI_TRACING_BACKEND = backend;

  const app = express();
  // Mirrors src/index.js: the ingestion route's own 5mb parser is registered
  // BEFORE the global 50mb one, because body-parser no-ops once a body has been
  // parsed and a limit mounted afterwards would never fire.
  mountTracingIngestBodyLimit(app);
  app.use(express.json({ limit: '50mb' }));
  mountSdk(app, db);
  mountLangfuseGateway(app, db);
  mountTracing(app, db);
  app.use((err, req, res, next) => res.status(500).json({ error: err.message }));

  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  const json = async (res) => {
    const text = await res.text();
    try { return { body: JSON.parse(text), text }; } catch { return { body: text, text }; }
  };

  const adminHeaders = (admin) => (admin ? { authorization: `Bearer ${ADMIN_TOKEN}` } : {});

  const api = {
    db,
    base,

    async createProject(body = {}, { admin = true } = {}) {
      const res = await fetch(`${base}/api/v1/sdk/projects`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...adminHeaders(admin) },
        body: JSON.stringify({ name: 'demo', language: 'javascript', ...body }),
      });
      return { status: res.status, ...(await json(res)) };
    },

    async listProjects({ admin = true } = {}) {
      const res = await fetch(`${base}/api/v1/sdk/projects`, { headers: adminHeaders(admin) });
      return { status: res.status, ...(await json(res)) };
    },

    async deleteProject(id, { admin = true } = {}) {
      const res = await fetch(`${base}/api/v1/sdk/projects/${id}`, {
        method: 'DELETE', headers: adminHeaders(admin),
      });
      return { status: res.status, ...(await json(res)) };
    },

    async stats({ admin = true } = {}) {
      const res = await fetch(`${base}/api/v1/sdk/stats`, { headers: adminHeaders(admin) });
      return { status: res.status, ...(await json(res)) };
    },

    async events(query = '', { admin = true } = {}) {
      const res = await fetch(`${base}/api/v1/sdk/events${query}`, { headers: adminHeaders(admin) });
      return { status: res.status, ...(await json(res)) };
    },

    // The developer-facing gateway. `creds` is { public_key, secret_key }.
    async ingest(batch, creds, { authorization } = {}) {
      const headers = { 'content-type': 'application/json' };
      const auth = authorization !== undefined
        ? authorization
        : 'Basic ' + Buffer.from(`${creds.public_key}:${creds.secret_key}`).toString('base64');
      if (auth !== null) headers.authorization = auth;
      const res = await fetch(`${base}/api/v1/lf/api/public/ingestion`, {
        method: 'POST', headers, body: JSON.stringify({ batch }),
      });
      return { status: res.status, ...(await json(res)) };
    },

    // ── Local tracing read API ───────────────────────────────────────────────
    async tracing(path, { admin = false } = {}) {
      const res = await fetch(`${base}/api/v1/tracing${path}`, { headers: adminHeaders(admin) });
      return { status: res.status, ...(await json(res)) };
    },

    row(id) { return api.db._rows(PROJECTS).find((p) => p.id === id); },
    trace(id) { return api.db._rows(TRACES).find((t) => t.id === id); },
    observation(id) { return api.db._rows(OBSERVATIONS).find((o) => o.id === id); },
    ioRow(id) { return api.db._rows(OBSERVATION_IO).find((r) => r.observation_id === id); },
  };

  try {
    return await fn(api);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    _clearSdkReadCache();
    _resetTracingRateLimits();
    if (previousBackend === undefined) delete process.env.CFAI_TRACING_BACKEND;
    else process.env.CFAI_TRACING_BACKEND = previousBackend;
  }
}

// A created project plus the raw secret the creation call revealed.
async function seedProject(api, body = {}) {
  const res = await api.createProject(body);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body;
}

const traceItem = (tags) => ({
  id: crypto.randomUUID(),
  type: 'trace-create',
  timestamp: '2026-07-30T10:00:00.000Z',
  body: { id: 'trace-1', name: 'chat', ...(tags ? { tags } : {}) },
});

// ── 1. Auth on every sdk route ───────────────────────────────────────────────

test('all five /api/v1/sdk routes reject an unauthenticated caller', async () => {
  await withServer(async (api) => {
    // This is the bug being fixed: GET /projects used to answer 200 with every
    // project's plaintext key to anyone who could reach the port.
    assert.equal((await api.createProject({}, { admin: false })).status, 401);
    assert.equal((await api.listProjects({ admin: false })).status, 401);
    assert.equal((await api.deleteProject('anything', { admin: false })).status, 401);
    assert.equal((await api.stats({ admin: false })).status, 401);
    assert.equal((await api.events('?project_id=anything', { admin: false })).status, 401);

    // And a wrong token is no better than no token.
    const res = await fetch(`${api.base}/api/v1/sdk/projects`, {
      headers: { authorization: 'Bearer not-the-admin-token' },
    });
    assert.equal(res.status, 401);
  });
});

test('POST /api/v1/sdk/events is gone — the gateway replaced it', async () => {
  await withServer(async (api) => {
    const res = await fetch(`${api.base}/api/v1/sdk/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${ADMIN_TOKEN}` },
      body: JSON.stringify({ events: [{ type: 'llm_call' }] }),
    });
    assert.equal(res.status, 404, 'the old local ingest route must not exist any more');
  });
});

// ── 2. Credential minting ────────────────────────────────────────────────────

test('project creation reveals the raw secret exactly once and never stores it', async () => {
  await withServer(async (api) => {
    const created = await seedProject(api, { name: 'checkout-svc' });

    assert.match(created.public_key, /^pk-lf-[0-9a-f-]{36}$/);
    assert.match(created.secret_key, /^sk-lf-[0-9a-f]{64}$/);
    assert.equal(created.secret_key_last4, created.secret_key.slice(-4));
    assert.equal(created.cf_tag, 'cfproj:' + created.id);
    assert.equal(created.status, 'active');
    assert.equal(created.total_events, 0);
    assert.equal(created.total_cost_usd, 0);
    assert.equal(created.monthly_event_budget, DEFAULT_MONTHLY_EVENT_BUDGET);
    // The digest is an internal detail; the creation response must not carry it.
    assert.equal('secret_key_hash' in created, false);

    // Stored: the digest, never the secret.
    const row = api.row(created.id);
    assert.equal('secret_key' in row, false, 'the raw secret must never be persisted');
    assert.equal('api_key' in row, false, 'the legacy plaintext key field is gone');
    assert.equal(row.secret_key_hash, sha256Hex(created.secret_key));
    assert.equal(row.budget_month, currentBudgetMonth());

    // And no later read hands it back.
    const list = await api.listProjects();
    assert.equal(list.status, 200);
    assert.equal(list.body.length, 1);
    const listed = list.body[0];
    assert.equal(listed.public_key, created.public_key);
    assert.equal(listed.secret_key_last4, created.secret_key_last4);
    assert.equal('secret_key' in listed, false);
    assert.equal('secret_key_hash' in listed, false);
    assert.equal(list.text.includes(created.secret_key), false, 'raw secret leaked into the list route');
    assert.equal(list.text.includes(row.secret_key_hash), false, 'the digest leaked into the list route');

    // Neither does the stats card or a second creation's list.
    const stats = await api.stats();
    assert.equal(stats.text.includes(created.secret_key), false);
  });
});

test('mintProjectCredentials / verifyProjectSecret are a matched pair', async () => {
  const creds = mintProjectCredentials('proj-1');
  assert.equal(creds.cf_tag, 'cfproj:proj-1');
  assert.equal(verifyProjectSecret(creds.secret_key, creds.secret_key_hash), true);
  assert.equal(verifyProjectSecret(creds.secret_key + 'x', creds.secret_key_hash), false);
  assert.equal(verifyProjectSecret('sk-lf-' + 'a'.repeat(64), creds.secret_key_hash), false);
  // Never throws on junk — a malformed header must be a 401, not a 500.
  assert.equal(verifyProjectSecret(undefined, creds.secret_key_hash), false);
  assert.equal(verifyProjectSecret(creds.secret_key, undefined), false);
  assert.equal(verifyProjectSecret(creds.secret_key, ''), false);
});

test('parseBasicAuth handles the shapes an SDK and an attacker send', () => {
  const encode = (s) => 'Basic ' + Buffer.from(s).toString('base64');
  assert.deepEqual(parseBasicAuth(encode('pk:sk')), { publicKey: 'pk', secretKey: 'sk' });
  // A secret containing ':' splits on the FIRST separator only.
  assert.deepEqual(parseBasicAuth(encode('pk:sk:more')), { publicKey: 'pk', secretKey: 'sk:more' });
  assert.equal(parseBasicAuth(''), null);
  assert.equal(parseBasicAuth('Bearer abc'), null);
  assert.equal(parseBasicAuth(encode('no-separator')), null);
  assert.equal(parseBasicAuth(encode(':only-secret')), null);
});

// ── 3. Revocation ────────────────────────────────────────────────────────────

test('DELETE revokes rather than deletes, and the gateway then rejects the credentials', async () => {
  const stub = stubLangfuse();
  try {
    await withServer(async (api) => {
      const p = await seedProject(api);

      // Works before revocation.
      assert.equal((await api.ingest([traceItem()], p)).status, 200);

      const del = await api.deleteProject(p.id);
      assert.equal(del.status, 200);
      assert.equal(del.body.status, 'revoked');

      // The document survives — its cf_tag is still stamped on real traces.
      const row = api.row(p.id);
      assert.ok(row, 'the project document must not be hard-deleted');
      assert.equal(row.status, 'revoked');
      assert.ok(row.revoked_at);

      // ...and the credentials are dead.
      const after = await api.ingest([traceItem()], p);
      assert.equal(after.status, 401);
      assert.equal(after.body.error, 'invalid SDK credentials');

      // A revoked project drops out of the live counts but keeps its history.
      const stats = await api.stats();
      assert.equal(stats.body.total_projects, 0);
      assert.equal(stats.body.total_events, 1);

      assert.equal((await api.deleteProject('no-such-project')).status, 404);
    });
  } finally { stub.restore(); }
});

// ── 4. Gateway auth ──────────────────────────────────────────────────────────

test('gateway refuses a missing, malformed, unknown or wrong credential — with one message', async () => {
  const stub = stubLangfuse();
  try {
    await withServer(async (api) => {
      const p = await seedProject(api);
      const batch = [traceItem()];

      const cases = [
        ['no header', { authorization: null }],
        ['bearer instead of basic', { authorization: `Bearer ${p.secret_key}` }],
        ['not base64 pairs', { authorization: 'Basic ' + Buffer.from('garbage').toString('base64') }],
        ['unknown public key', { authorization: 'Basic ' + Buffer.from(`pk-lf-nope:${p.secret_key}`).toString('base64') }],
        ['wrong secret', { authorization: 'Basic ' + Buffer.from(`${p.public_key}:sk-lf-${'0'.repeat(64)}`).toString('base64') }],
      ];
      for (const [label, opts] of cases) {
        const res = await api.ingest(batch, p, opts);
        assert.equal(res.status, 401, label);
        // One indistinguishable message for every failure mode: which of "no
        // such key" / "wrong secret" / "revoked" it was is not the caller's
        // business.
        assert.deepEqual(res.body, { error: 'invalid SDK credentials' }, label);
      }
      assert.equal(stub.calls.length, 0, 'an unauthenticated request must never reach Langfuse');
    });
  } finally { stub.restore(); }
});

test('gateway answers 503 rather than throwing when Langfuse is not configured', async () => {
  await withServer(async (api) => {
    const p = await seedProject(api);
    const res = await api.ingest([traceItem()], p);
    assert.equal(res.status, 503);
    assert.equal(res.body.error, 'Langfuse not configured');
    // Nothing was charged against the budget for a request we never relayed.
    assert.equal(api.row(p.id).total_events, 0);
  }, { langfuse: false });
});

// ── 5. Tag stamping — the tenant boundary ────────────────────────────────────

test("gateway strips a client-supplied cfproj tag and stamps the project's own", async () => {
  const stub = stubLangfuse();
  try {
    await withServer(async (api) => {
      const victim = await seedProject(api, { name: 'victim' });
      const attacker = await seedProject(api, { name: 'attacker' });

      // The attack: label my traces with the victim's project tag so they show
      // up in (and pollute) the victim's dashboard view.
      const res = await api.ingest([
        traceItem(['prod', victim.cf_tag, victim.cf_tag.toUpperCase(), 'CfProj:anything']),
      ], attacker);
      assert.equal(res.status, 200);

      assert.equal(stub.calls.length, 1);
      const relayed = stub.calls[0].json.batch[0].body;
      assert.deepEqual(relayed.tags, ['prod', attacker.cf_tag]);
      assert.equal(relayed.tags.includes(victim.cf_tag), false, 'the foreign tag survived the strip');
      // Case variants of the reserved prefix are stripped too.
      assert.equal(relayed.tags.some((t) => /^cfproj:/i.test(t) && t !== attacker.cf_tag), false);
      // Metadata attribution is stamped as well, so nothing crosses untagged.
      assert.equal(relayed.metadata.cf_project_id, attacker.id);
    });
  } finally { stub.restore(); }
});

test('stampBatch tags trace bodies and falls back to metadata for observation bodies', () => {
  const project = { id: 'p1', cf_tag: 'cfproj:p1' };
  const batch = [
    { type: 'trace-create', body: { name: 'chat' } },                       // no tags at all
    { type: 'generation-create', body: { model: 'gpt-4o', metadata: { run: 7 } } },
    { type: 'span-create', body: { name: 's', metadata: 'a bare string' } },
    { type: 'score-create', body: { tags: ['cfproj:someone-else'] } },      // no tags field in the schema, but sent anyway
    { type: 'sdk-log', body: null },                                        // must not throw
  ];
  stampBatch(batch, project);

  assert.deepEqual(batch[0].body.tags, ['cfproj:p1']);
  // Observation bodies have no tags field in Langfuse's schema — attribution
  // rides in metadata instead, beside whatever the developer already put there.
  assert.equal(batch[1].body.tags, undefined);
  assert.deepEqual(batch[1].body.metadata, { run: 7, cf_project_id: 'p1' });
  // A non-object metadata value is preserved, not dropped, and not spread.
  assert.deepEqual(batch[2].body.metadata, { cf_project_id: 'p1', cf_original_metadata: 'a bare string' });
  // A tags array anywhere is still sanitised, whatever the event type.
  assert.deepEqual(batch[3].body.tags, ['cfproj:p1']);
  assert.equal(batch[4].body, null);
});

// ── 6. Budget enforcement ────────────────────────────────────────────────────

test('gateway refuses to relay once the monthly budget would be exceeded', async () => {
  const stub = stubLangfuse();
  try {
    await withServer(async (api) => {
      const p = await seedProject(api);
      const row = api.row(p.id);
      row.monthly_event_budget = 3;
      row.events_this_month = 2;
      row.budget_month = currentBudgetMonth();

      // 2 used + 2 requested > 3 → refused whole, not partially relayed.
      const res = await api.ingest([traceItem(), traceItem()], p);
      assert.equal(res.status, 429);
      assert.deepEqual(res.body, { error: 'monthly event budget exceeded', limit: 3, current: 2 });
      assert.equal(stub.calls.length, 0, 'a budget-blocked batch must never reach Langfuse');
      // A refused request costs nothing, so it consumes nothing.
      assert.equal(api.row(p.id).events_this_month, 2);
      assert.equal(api.row(p.id).total_events, 0);

      // Exactly at the line still goes through.
      const ok = await api.ingest([traceItem()], p);
      assert.equal(ok.status, 200);
      assert.equal(stub.calls.length, 1);
      assert.equal(api.row(p.id).events_this_month, 3);
    });
  } finally { stub.restore(); }
});

test('a stale budget month resets the counter instead of blocking forever', async () => {
  const stub = stubLangfuse();
  try {
    await withServer(async (api) => {
      const p = await seedProject(api);
      const row = api.row(p.id);
      row.monthly_event_budget = 5;
      row.events_this_month = 5;         // last month's spend, at the limit
      row.budget_month = '2001-01';

      const res = await api.ingest([traceItem(), traceItem()], p);
      assert.equal(res.status, 200);
      const after = api.row(p.id);
      assert.equal(after.budget_month, currentBudgetMonth());
      assert.equal(after.events_this_month, 2, 'reset to this batch, not incremented onto last month');
      assert.equal(after.total_events, 2, 'the lifetime counter keeps counting across months');
    });
  } finally { stub.restore(); }
});

// ── 7. Relay behaviour and counters ──────────────────────────────────────────

test('gateway passes the Langfuse status and body through untouched', async () => {
  const stub = stubLangfuse({
    '/api/public/ingestion': () => ({
      status: 207,
      body: { successes: [{ id: 'a', status: 201 }], errors: [{ id: 'b', status: 400, message: 'bad' }] },
    }),
  });
  try {
    await withServer(async (api) => {
      const p = await seedProject(api);
      const res = await api.ingest([traceItem(), traceItem()], p);
      // 207 partial success is Langfuse's own contract with the SDK — rewriting
      // it to 200/500 would break the SDK's retry logic.
      assert.equal(res.status, 207);
      assert.deepEqual(res.body.errors, [{ id: 'b', status: 400, message: 'bad' }]);
      // Relayed with CloudFuze's real key, never the developer's.
      const expected = 'Basic ' + Buffer.from('pk-lf-cloudfuze-real:sk-lf-cloudfuze-real').toString('base64');
      assert.equal(stub.calls[0].authorization, expected);
      assert.equal(stub.calls[0].body.includes(p.secret_key), false);

      const row = api.row(p.id);
      assert.equal(row.total_events, 2);
      assert.ok(row.last_event_at);
    });
  } finally { stub.restore(); }
});

test('a rejected upstream relay does not advance the counters', async () => {
  const stub = stubLangfuse({ '/api/public/ingestion': () => ({ status: 500, body: { error: 'boom' } }) });
  try {
    await withServer(async (api) => {
      const p = await seedProject(api);
      const res = await api.ingest([traceItem()], p);
      assert.equal(res.status, 500, 'the upstream failure is passed through so the SDK retries');
      const row = api.row(p.id);
      assert.equal(row.total_events, 0);
      assert.equal(row.events_this_month, 0);
      assert.equal(row.last_event_at, null);
    });
  } finally { stub.restore(); }
});

test('an unreachable Langfuse becomes a 502, not an unhandled error', async () => {
  const stub = stubLangfuse({ '/api/public/ingestion': () => { throw new Error('ECONNREFUSED'); } });
  try {
    await withServer(async (api) => {
      const p = await seedProject(api);
      const res = await api.ingest([traceItem()], p);
      assert.equal(res.status, 502);
      assert.equal(res.body.error, 'langfuse relay failed');
      assert.equal(api.row(p.id).total_events, 0);
    });
  } finally { stub.restore(); }
});

// ── 8. Read path ─────────────────────────────────────────────────────────────

const LANGFUSE_TRACES = {
  data: [
    {
      id: 'trace-a',
      timestamp: '2026-07-30T10:00:00.000Z',
      tags: ['cfproj:x'],
      observations: ['obs-a'],                        // ids → needs a second call
    },
    {
      id: 'trace-b',
      timestamp: '2026-07-29T09:00:00.000Z',
      tags: ['cfproj:x'],
      observations: [{                                // already expanded → no second call
        id: 'obs-b',
        type: 'SPAN',
        model: 'claude-3-5-sonnet-20241022',
        promptTokens: 5,
        completionTokens: 6,
        totalCost: 0.5,
        latency: 0.25,
        level: 'ERROR',
      }],
    },
  ],
  meta: { totalItems: 2 },
};

const LANGFUSE_OBSERVATIONS = {
  data: [{
    id: 'obs-a',
    type: 'GENERATION',
    name: 'chat-completion',
    model: 'gpt-4o-mini',
    usageDetails: { input: 120, output: 34 },
    calculatedTotalCost: 0.0021,
    latency: 2.4,                                     // SECONDS
    level: 'DEFAULT',
  }],
};

test('GET /sdk/events maps Langfuse traces onto the dashboard event shape', async () => {
  const stub = stubLangfuse({
    '/api/public/traces': () => ({ status: 200, body: LANGFUSE_TRACES }),
    '/api/public/observations': () => ({ status: 200, body: LANGFUSE_OBSERVATIONS }),
  });
  try {
    await withServer(async (api) => {
      const p = await seedProject(api);
      const res = await api.events(`?project_id=${p.id}`);
      assert.equal(res.status, 200);
      assert.equal(res.body.degraded, false);
      assert.equal(res.body.events.length, 2);

      // The traces query is scoped by THIS project's tag, and by nothing else.
      const tracesCall = stub.calls.find((c) => c.path.startsWith('/api/public/traces'));
      assert.ok(tracesCall.path.includes(`tags=${encodeURIComponent(p.cf_tag)}`), tracesCall.path);

      // Newest first.
      const [a, b] = res.body.events;
      assert.equal(a.trace_id, 'trace-a');
      assert.equal(b.trace_id, 'trace-b');

      assert.equal(a.occurred_at, '2026-07-30T10:00:00.000Z');
      assert.equal(a.type, 'GENERATION');
      assert.equal(a.model, 'gpt-4o-mini');
      assert.equal(a.provider, 'openai');
      assert.equal(a.prompt_tokens, 120);
      assert.equal(a.completion_tokens, 34);
      assert.equal(a.total_cost_usd, 0.0021);
      assert.equal(a.status, 'ok');
      assert.equal(a.project_id, p.id);
      // seconds → milliseconds, end to end through the route (see the dedicated
      // unit test below for the same property in isolation).
      assert.equal(a.duration_ms, 2400);

      // Fallbacks: the flat legacy token fields, totalCost, and level: ERROR.
      assert.equal(b.provider, 'anthropic');
      assert.equal(b.prompt_tokens, 5);
      assert.equal(b.completion_tokens, 6);
      assert.equal(b.total_cost_usd, 0.5);
      assert.equal(b.status, 'error');
      assert.equal(b.duration_ms, 250);

      // A trace whose observations arrived expanded costs no extra round trip.
      const obsCalls = stub.calls.filter((c) => c.path.startsWith('/api/public/observations'));
      assert.equal(obsCalls.length, 1);
      assert.ok(obsCalls[0].path.includes('traceId=trace-a'));
    });
  } finally { stub.restore(); }
});

test('duration_ms converts Langfuse SECONDS to milliseconds', () => {
  // Pinned on its own: Langfuse reports `latency` in seconds and this repo's UI
  // renders milliseconds, so a missing ×1000 silently turns every 2.4s call into
  // "2 ms" — a plausible-looking number that no assertion elsewhere would catch.
  assert.equal(mapObservation({ id: 't' }, { latency: 2.4 }).duration_ms, 2400);
  assert.equal(mapObservation({ id: 't' }, { latency: 0.25 }).duration_ms, 250);
  assert.equal(mapObservation({ id: 't' }, { latency: 0 }).duration_ms, 0);
  assert.equal(mapObservation({ id: 't' }, {}).duration_ms, null);
  assert.equal(mapObservation({ id: 't' }, { latency: null }).duration_ms, null);
});

test('provider is derived from the model name, since Langfuse has no such field', () => {
  assert.equal(providerForModel('gpt-4o-mini'), 'openai');
  assert.equal(providerForModel('claude-3-5-sonnet-20241022'), 'anthropic');
  assert.equal(providerForModel('gemini-1.5-pro'), 'google');
  assert.equal(providerForModel('llama-3-70b'), 'other');
  assert.equal(providerForModel(undefined), 'other');
});

test('GET /sdk/events degrades to an empty flagged result when Langfuse is unset', async () => {
  await withServer(async (api) => {
    const p = await seedProject(api);
    const res = await api.events(`?project_id=${p.id}`);
    // 200, not 500: the dashboard still has to render the project list.
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { events: [], degraded: true, reason: 'langfuse_not_configured' });
  }, { langfuse: false });
});

test('GET /sdk/events degrades when Langfuse answers with an error', async () => {
  const stub = stubLangfuse({ '/api/public/traces': () => ({ status: 503, body: { error: 'down' } }) });
  try {
    await withServer(async (api) => {
      const p = await seedProject(api);
      const res = await api.events(`?project_id=${p.id}`);
      assert.equal(res.status, 200);
      assert.deepEqual(res.body, { events: [], degraded: true, reason: 'langfuse_unreachable' });
    });
  } finally { stub.restore(); }
});

test('GET /sdk/events requires a project id and 404s an unknown one', async () => {
  await withServer(async (api) => {
    assert.equal((await api.events('')).status, 400);
    assert.equal((await api.events('?project_id=nope')).status, 404);
  });
});

test('concurrent reads of the same project make ONE outbound Langfuse query', async () => {
  const stub = stubLangfuse({
    '/api/public/traces': async () => {
      await new Promise((r) => setTimeout(r, 20));    // hold both callers in flight
      return { status: 200, body: { data: [] } };
    },
  });
  try {
    await withServer(async (api) => {
      const p = await seedProject(api);
      const [one, two] = await Promise.all([
        api.events(`?project_id=${p.id}`),
        api.events(`?project_id=${p.id}`),
      ]);
      assert.equal(one.status, 200);
      assert.equal(two.status, 200);
      assert.equal(stub.calls.length, 1, 'two dashboard tabs must not become two Langfuse queries');

      // And a third read inside the 30s TTL is served from cache.
      await api.events(`?project_id=${p.id}`);
      assert.equal(stub.calls.length, 1);
    });
  } finally { stub.restore(); }
});

// ── 9. Stats ─────────────────────────────────────────────────────────────────

test('stats come from the local running counters, not from a live Langfuse query', async () => {
  const stub = stubLangfuse();
  try {
    await withServer(async (api) => {
      const p1 = await seedProject(api, { name: 'one' });
      const p2 = await seedProject(api, { name: 'two' });
      await api.ingest([traceItem(), traceItem()], p1);

      // p2 last saw traffic two days ago: still a project, no longer "active".
      api.row(p2.id).last_event_at = new Date(Date.now() - 2 * 86_400_000).toISOString();
      api.row(p2.id).total_events = 40;
      api.row(p2.id).total_cost_usd = 1.25;

      const res = await api.stats();
      assert.equal(res.status, 200);
      assert.equal(res.body.total_projects, 2);
      assert.equal(res.body.active_projects, 1);
      // Lifetime totals survive Langfuse's 30-day retention window precisely
      // because nothing here reads Langfuse.
      assert.equal(res.body.total_events, 42);
      assert.equal(res.body.total_cost_usd, 1.25);
      assert.equal(stub.calls.filter((c) => c.path.startsWith('/api/public/traces')).length, 0);
    });
  } finally { stub.restore(); }
});

// ── 10. Schema ───────────────────────────────────────────────────────────────

test('applyInitialSchema declares the sdk_projects indexes', async () => {
  const db = createFakeDb();
  await applyInitialSchema(db);
  const idx = await db.collection('sdk_projects').indexes();
  const byName = Object.fromEntries(idx.map((i) => [i.name, i]));

  assert.ok(byName.id_1, 'sdk_projects needs an index on id');
  assert.equal(byName.id_1.unique, true);
  // The gateway looks a project up by public_key on EVERY ingestion request.
  assert.ok(byName.public_key_1, 'sdk_projects needs an index on public_key');
  assert.equal(byName.public_key_1.unique, true);
  assert.ok(byName['created_at_-1'], 'sdk_projects needs the list-order index');
});

test('the public_key unique index is enforced, so a minted key cannot collide', async () => {
  const db = createFakeDb();
  await applyInitialSchema(db);
  const col = db.collection('sdk_projects');
  await col.insertOne({ id: 'a', public_key: 'pk-lf-1' });
  await assert.rejects(() => col.insertOne({ id: 'b', public_key: 'pk-lf-1' }), (e) => e.code === 11000);
});

// ── 11. Legacy cleanup script ────────────────────────────────────────────────

test('drop-legacy-sdk-collections drops sdk_events and only pre-migration projects', async () => {
  const db = createFakeDb();
  await db.collection('sdk_events').insertOne({ id: 'e1', prompt_text: 'secret prompt' });
  await db.collection('sdk_events').insertOne({ id: 'e2' });
  // Pre-migration: a plaintext cfsk_ key and no public_key.
  await db.collection('sdk_projects').insertOne({ id: 'old', name: 'Testing', api_key: 'cfsk_deadbeef' });
  // Current-scheme projects, one of them revoked — neither may be touched.
  await db.collection('sdk_projects').insertOne({ id: 'new', name: 'live', public_key: 'pk-lf-1', status: 'active' });
  await db.collection('sdk_projects').insertOne({ id: 'rev', name: 'revoked', public_key: 'pk-lf-2', status: 'revoked' });

  const dry = await dropLegacySdkData(db, { dryRun: true });
  assert.equal(dry.events_documents, 2);
  assert.equal(dry.events_collection_dropped, false);
  assert.equal(dry.legacy_projects_found, 1);
  assert.equal(dry.legacy_projects_deleted, 0);
  assert.deepEqual(dry.legacy_project_names, ['Testing']);
  assert.equal(db._rows('sdk_events').length, 2, 'a dry run writes nothing');

  const real = await dropLegacySdkData(db);
  assert.equal(real.events_collection_dropped, true);
  assert.equal(real.events_documents, 2);
  assert.equal(real.legacy_projects_deleted, 1);
  assert.equal(real.projects_remaining, 2);
  assert.equal(db._rows('sdk_events').length, 0);
  assert.deepEqual(db._rows('sdk_projects').map((p) => p.id).sort(), ['new', 'rev']);

  // Re-running is a no-op, not an error.
  const again = await dropLegacySdkData(db);
  assert.equal(again.events_collection_dropped, false);
  assert.equal(again.legacy_projects_found, 0);
});

// ═══════════════════════════════════════════════════════════════════════════════
// 12. LOCAL TRACING BACKEND (CFAI_TRACING_BACKEND=local — the default)
//
// Everything above this line is the Langfuse Cloud relay, which is now opt-in.
// Everything below is the backend that ships on by default: the same wire
// protocol, the same credentials, the same budget — stored in this server's own
// Mongo instead of relayed. The SDK cannot tell the difference, and that is the
// property most of these tests exist to hold.
// ═══════════════════════════════════════════════════════════════════════════════

const local = (fn) => () => withServer(fn, { backend: 'local', langfuse: false });

// Wire helpers shaped exactly like the official Langfuse SDK's output.
let seq = 0;
const envelope = (type, body, timestamp) => ({
  id: `evt-${++seq}`,
  timestamp: timestamp ?? '2026-08-01T10:00:00.000Z',
  type,
  body,
});
const traceCreate = (body) => envelope('trace-create', { id: 'tr-1', name: 'chat', ...body });
const genCreate = (body) => envelope('generation-create', {
  id: 'gen-1', traceId: 'tr-1', name: 'answer', model: 'gpt-4o',
  startTime: '2026-08-01T10:00:00.000Z', ...body,
});
const genUpdate = (body) => envelope('generation-update', {
  id: 'gen-1', traceId: 'tr-1', endTime: '2026-08-01T10:00:02.000Z', ...body,
});
const spanCreate = (body) => envelope('span-create', {
  id: 'sp-1', traceId: 'tr-1', name: 'retrieve',
  startTime: '2026-08-01T10:00:00.500Z', ...body,
});

// ── 12a. The switch itself ───────────────────────────────────────────────────

test('CFAI_TRACING_BACKEND defaults to local when the env var is unset', () => {
  const previous = process.env.CFAI_TRACING_BACKEND;
  try {
    delete process.env.CFAI_TRACING_BACKEND;
    assert.equal(tracingBackend(), 'local', 'local storage is the DEFAULT, not the fallback');

    process.env.CFAI_TRACING_BACKEND = 'langfuse';
    assert.equal(tracingBackend(), 'langfuse');
    process.env.CFAI_TRACING_BACKEND = 'LANGFUSE';
    assert.equal(tracingBackend(), 'langfuse', 'case must not decide the backend');

    // A typo must not take ingestion down — it resolves to the default.
    process.env.CFAI_TRACING_BACKEND = 'langfsue';
    assert.equal(tracingBackend(), 'local');
    process.env.CFAI_TRACING_BACKEND = '';
    assert.equal(tracingBackend(), 'local');
  } finally {
    if (previous === undefined) delete process.env.CFAI_TRACING_BACKEND;
    else process.env.CFAI_TRACING_BACKEND = previous;
  }
});

test('local ingestion stores nothing in Langfuse and needs no Langfuse config', local(async (api) => {
  const stub = stubLangfuse();
  try {
    const p = await seedProject(api);
    // langfuse: false — the relay would have answered 503 here.
    const res = await api.ingest([traceCreate(), genCreate(), genUpdate({ usage: { input: 100, output: 20 } })], p);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(stub.calls.length, 0, 'the local backend must never call Langfuse');
    assert.ok(api.trace('tr-1'));
  } finally { stub.restore(); }
}));

test('a project is created content-masked with 30-day retention', local(async (api) => {
  const created = await seedProject(api);
  assert.equal(created.capture_content, false, 'content capture must be OFF by default');
  assert.equal(created.retention_days, DEFAULT_RETENTION_DAYS);
  assert.equal(created.total_traces, 0);
  assert.equal(created.total_observations, 0);
}));

// ── 12b. Storage shape ───────────────────────────────────────────────────────

test('a trace and its generation are stored with rollups and an estimated cost', local(async (api) => {
  const p = await seedProject(api);
  const res = await api.ingest([
    traceCreate({ userId: 'u-1', sessionId: 's-1', tags: ['prod'], input: 'hello there' }),
    spanCreate({ input: { q: 'refunds' } }),
    envelope('span-update', { id: 'sp-1', traceId: 'tr-1', endTime: '2026-08-01T10:00:01.000Z', output: { hits: 3 } }),
    genCreate({ modelParameters: { temperature: 0 } }),
    genUpdate({ output: 'an answer', usage: { input: 1000, output: 500 } }),
  ], p);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.successes.length, 5);
  assert.deepEqual(res.body.errors, []);

  const trace = api.trace('tr-1');
  assert.equal(trace.project_id, p.id, 'project_id is the tenant boundary in local mode');
  assert.equal(trace.user_id, 'u-1');
  assert.equal(trace.session_id, 's-1');
  assert.equal(trace.stub, false);
  assert.equal(trace.observation_count, 2);
  assert.equal(trace.generation_count, 1);
  assert.equal(trace.input_tokens, 1000);
  assert.equal(trace.output_tokens, 500);
  assert.equal(trace.total_tokens, 1500);
  assert.ok(trace.received_at, 'the server always stamps its own arrival time');
  assert.ok(trace.expires_at instanceof Date);

  // gpt-4o at 2.50/10.00 per 1M: 1000 in + 500 out = 0.0025 + 0.005.
  const gen = api.observation('gen-1');
  assert.equal(gen.type, 'GENERATION');
  assert.equal(gen.provider, 'openai');
  assert.equal(gen.model, 'gpt-4o');
  assert.equal(Math.round(gen.cost_details.total * 1e6), 7500);
  assert.equal(gen.cost_estimated, true, 'a cost we computed must say so');
  assert.equal(gen.latency_ms, 2000);
  assert.equal(gen.usage_details.total, 1500);

  const span = api.observation('sp-1');
  assert.equal(span.type, 'SPAN');
  assert.equal(span.latency_ms, 500);
  assert.equal('model' in span, false, 'generation-only fields must not appear on a span');

  // Lifetime counters count DOCUMENTS created, not events ingested.
  const row = api.row(p.id);
  assert.equal(row.total_traces, 1);
  assert.equal(row.total_observations, 2);
  assert.equal(row.total_events, 5);
}));

test('a client-supplied costDetails is trusted verbatim and never summed with ours', local(async (api) => {
  const p = await seedProject(api);
  await api.ingest([
    traceCreate(),
    genCreate(),
    genUpdate({ usage: { input: 1000, output: 500 }, costDetails: { input: 1, output: 2, total: 3 } }),
  ], p);

  const gen = api.observation('gen-1');
  assert.deepEqual(gen.cost_details, { input: 1, output: 2, total: 3 });
  assert.equal(gen.cost_estimated, false);
  assert.equal(api.trace('tr-1').total_cost_usd, 3, 'the computed figure must not be added on top');
}));

test('an unknown-but-plausible observation type is stored verbatim, not rejected', local(async (api) => {
  const p = await seedProject(api);
  const res = await api.ingest([
    traceCreate(),
    envelope('span-create', { id: 'ag-1', traceId: 'tr-1', type: 'AGENT', name: 'planner' }),
    envelope('span-create', { id: 'tl-1', traceId: 'tr-1', type: 'TOOL', name: 'search' }),
  ], p);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(api.observation('ag-1').type, 'AGENT');
  assert.equal(api.observation('tl-1').type, 'TOOL');
}));

// ── 12c. Upsert merge — the create-then-update protocol ──────────────────────

test('create then update merge onto ONE document, across separate batches', local(async (api) => {
  const p = await seedProject(api);

  await api.ingest([traceCreate(), genCreate()], p);
  assert.equal(api.trace('tr-1').total_tokens, 0);
  assert.equal(api.trace('tr-1').observation_count, 1);

  // The SDK's second flush: the same ids, now carrying the result.
  await api.ingest([genUpdate({ output: 'done', usage: { input: 300, output: 100 } })], p);

  assert.equal(api.db._rows(OBSERVATIONS).length, 1, 'an update must not create a second document');
  const gen = api.observation('gen-1');
  assert.equal(gen.name, 'answer', 'a field the update omitted must survive');
  assert.equal(gen.model, 'gpt-4o');
  assert.equal(gen.output_preview, 'done');

  const trace = api.trace('tr-1');
  assert.equal(trace.observation_count, 1, 'the observation must be counted once, not twice');
  assert.equal(trace.generation_count, 1);
  assert.equal(trace.total_tokens, 400);
}));

test('replaying the identical batch does not double-count the rollup', local(async (api) => {
  const p = await seedProject(api);
  const batch = () => [traceCreate(), genCreate(), genUpdate({ usage: { input: 200, output: 50 } })];

  await api.ingest(batch(), p);
  const first = { ...api.trace('tr-1') };
  // An SDK that retried a batch it had actually delivered (a timed-out 200) must
  // not double every number on the dashboard.
  await api.ingest(batch(), p);
  const second = api.trace('tr-1');

  assert.equal(second.observation_count, first.observation_count);
  assert.equal(second.total_tokens, first.total_tokens);
  assert.equal(second.total_tokens, 250);
  assert.equal(second.total_cost_usd, first.total_cost_usd);
}));

test('a trace-update patches the trace without disturbing its rollups', local(async (api) => {
  const p = await seedProject(api);
  await api.ingest([traceCreate(), genCreate(), genUpdate({ usage: { input: 10, output: 10 } })], p);
  await api.ingest([envelope('trace-update', { id: 'tr-1', output: 'final answer', tags: ['done'] })], p);

  const trace = api.trace('tr-1');
  assert.equal(trace.output_preview, 'final answer');
  assert.equal(trace.name, 'chat', 'the create-time name must survive an update that omits it');
  assert.deepEqual(trace.tags, ['done']);
  assert.equal(trace.total_tokens, 20);
  assert.equal(trace.observation_count, 1);
}));

// ── 12d. Out-of-order arrival ────────────────────────────────────────────────

test('an observation arriving before its trace creates a stub, never a dropped event', local(async (api) => {
  const p = await seedProject(api);

  const res = await api.ingest([genCreate(), genUpdate({ usage: { input: 60, output: 40 } })], p);
  assert.equal(res.status, 200, JSON.stringify(res.body));

  const stub = api.trace('tr-1');
  assert.ok(stub, 'the observation must not be dropped for want of a trace');
  assert.equal(stub.stub, true);
  assert.equal(stub.name, null);
  assert.equal(stub.total_tokens, 100);
  assert.equal(stub.observation_count, 1);

  // The real trace event turns up later and fills the stub in.
  await api.ingest([traceCreate({ userId: 'u-9' })], p);
  const filled = api.trace('tr-1');
  assert.equal(filled.stub, false);
  assert.equal(filled.name, 'chat');
  assert.equal(filled.user_id, 'u-9');
  assert.equal(filled.total_tokens, 100, 'filling the stub must not reset what it accumulated');
  assert.equal(filled.observation_count, 1);
  assert.equal(api.db._rows(TRACES).length, 1);
}));

// ── 12e. Content masking ─────────────────────────────────────────────────────

const SECRET_PROMPT = 'my card is 4111 1111 1111 1111 and email bob@acme.com, key sk-ant-abcdefgh12345';

test('with capture_content false only a MASKED preview is stored, and no raw row at all', local(async (api) => {
  const p = await seedProject(api);
  assert.equal(api.row(p.id).capture_content, false);

  await api.ingest([
    traceCreate({ input: SECRET_PROMPT }),
    genCreate({ input: SECRET_PROMPT }),
    genUpdate({ output: 'the SSN is 123-45-6789' }),
  ], p);

  const gen = api.observation('gen-1');
  assert.equal(gen.input_preview.includes('4111'), false, 'the card number survived masking');
  assert.equal(gen.input_preview.includes('bob@acme.com'), false);
  assert.equal(gen.input_preview.includes('sk-ant-'), false);
  assert.match(gen.input_preview, /\[CARD\]/);
  assert.match(gen.input_preview, /\[EMAIL\]/);
  assert.match(gen.output_preview, /\[SSN\]/);
  assert.equal(api.trace('tr-1').input_preview.includes('4111'), false);

  // No raw content anywhere, and nothing raw hiding on the metadata document.
  assert.equal(api.db._rows(OBSERVATION_IO).length, 0);
  assert.equal('input' in gen, false);
  assert.equal('output' in gen, false);
  assert.equal(JSON.stringify(api.db._rows(OBSERVATIONS)).includes('4111 1111'), false);
}));

test('with capture_content true the raw text lands ONLY in the separate io collection', local(async (api) => {
  const p = await seedProject(api);
  api.row(p.id).capture_content = true;

  await api.ingest([traceCreate(), genCreate({ input: SECRET_PROMPT }), genUpdate({ output: 'raw answer' })], p);

  const io = api.ioRow('gen-1');
  assert.ok(io, 'opting in must actually capture');
  assert.equal(io.project_id, p.id);
  assert.equal(io.input, SECRET_PROMPT, 'the raw value is stored unmodified');
  assert.equal(io.output, 'raw answer');
  assert.ok(io.expires_at instanceof Date, 'raw content must carry its own retention clock');

  // Still masked on the metadata document — the split is the whole point.
  const gen = api.observation('gen-1');
  assert.equal(gen.input_preview.includes('4111'), false);
  assert.equal('input' in gen, false, 'raw content must never be mixed into the metadata document');
}));

test('a preview is masked BEFORE it is truncated, and capped', () => {
  const long = 'x'.repeat(400);
  assert.equal(preview(long).length, 251);            // 250 + the ellipsis
  // A value straddling the cut must not survive as a readable fragment.
  assert.equal(preview('a'.repeat(245) + ' 4111111111111111').includes('4111'), false);
  // Structured prompts are stringified so they are masked as text, not previewed
  // as "[object Object]".
  assert.match(preview([{ role: 'user', content: 'ssn 123-45-6789' }]), /\[SSN\]/);
  assert.equal(preview(undefined), null);
  assert.equal(preview(''), null);
});

// ── 12f. Partial failure ─────────────────────────────────────────────────────

test('one malformed item is a 207 partial success, not a failed batch', local(async (api) => {
  const p = await seedProject(api);
  const res = await api.ingest([
    traceCreate(),
    { id: 'bad-1', type: 'trace-create', body: { name: 'no id' } },      // no body.id
    { id: 'bad-2', type: 'generation-create', body: { id: 'x' } },       // no traceId
    { id: 'bad-3', type: 'span-create', body: 'not an object' },
    { id: 'bad-4' },                                                      // no type, no body
    genCreate(),
    genUpdate({ usage: { input: 5, output: 5 } }),
  ], p);

  assert.equal(res.status, 207, 'partial success is 207 — the shape the SDK expects');
  assert.equal(res.body.successes.length, 3, 'the good items must still land');
  assert.equal(res.body.errors.length, 4);
  assert.deepEqual(res.body.errors.map((e) => e.id).sort(), ['bad-1', 'bad-2', 'bad-3', 'bad-4']);
  for (const e of res.body.errors) assert.equal(typeof e.message, 'string');

  assert.ok(api.trace('tr-1'));
  assert.equal(api.trace('tr-1').total_tokens, 10);
  assert.equal(api.db._rows(OBSERVATIONS).length, 1);
}));

test('score and evaluator events are reported as not-stored, not silently 200ed', local(async (api) => {
  const p = await seedProject(api);
  const res = await api.ingest([
    traceCreate(),
    envelope('score-create', { id: 'sc-1', traceId: 'tr-1', name: 'quality', value: 0.9 }),
    envelope('span-create', { id: 'ev-1', traceId: 'tr-1', type: 'EVALUATOR', name: 'judge' }),
  ], p);

  assert.equal(res.status, 207);
  assert.equal(res.body.successes.length, 1);
  assert.equal(res.body.errors.length, 2, 'evals are out of scope — say so rather than pretend');
  for (const e of res.body.errors) assert.match(e.message, /not stored by this backend/);
  // Neither item was stored, and neither errored the whole batch.
  assert.equal(api.db._rows(OBSERVATIONS).length, 0);
  assert.ok(api.trace('tr-1'));
}));

test('a timestamp far in the future is a per-item error, not a poisoned batch', local(async (api) => {
  const p = await seedProject(api);
  const far = new Date(Date.now() + 72 * 3600 * 1000).toISOString();
  const res = await api.ingest([
    traceCreate(),
    envelope('trace-create', { id: 'tr-future', name: 'wrong clock' }, far),
  ], p);

  assert.equal(res.status, 207);
  assert.equal(res.body.errors.length, 1);
  assert.match(res.body.errors[0].message, /48h in the future/);
  assert.equal(api.trace('tr-future'), undefined);
  assert.ok(api.trace('tr-1'), 'the good item still landed');
}));

test('an end before its start clamps to zero rather than a negative duration', local(async (api) => {
  const p = await seedProject(api);
  await api.ingest([
    traceCreate(),
    envelope('span-create', {
      id: 'sp-back', traceId: 'tr-1', name: 'backwards',
      startTime: '2026-08-01T10:00:05.000Z', endTime: '2026-08-01T10:00:01.000Z',
    }),
  ], p);
  assert.equal(api.observation('sp-back').latency_ms, 0);
}));

// ── 12g. Guards on a new external surface ────────────────────────────────────

test('a batch over the item cap is refused whole with 413', local(async (api) => {
  const p = await seedProject(api);
  const big = Array.from({ length: MAX_BATCH_ITEMS + 1 }, (_, i) =>
    envelope('trace-create', { id: `t-${i}`, name: 'x' }));
  const res = await api.ingest(big, p);
  assert.equal(res.status, 413);
  assert.equal(res.body.limit, MAX_BATCH_ITEMS);
  assert.equal(api.db._rows(TRACES).length, 0);

  // Exactly at the cap still goes through.
  const ok = await api.ingest(big.slice(0, MAX_BATCH_ITEMS), p);
  assert.equal(ok.status, 200);
}));

test('a body over the route 5mb cap is 413, not a generic 500', local(async (api) => {
  const p = await seedProject(api);
  // ~6MB of payload in one legal-looking event: under the global 50mb parser
  // this would be accepted, which is exactly what the route-scoped cap prevents.
  const res = await api.ingest([traceCreate({ input: 'a'.repeat(6 * 1024 * 1024) })], p);
  assert.equal(res.status, 413, 'a 500 would tell the SDK to retry the same oversized body forever');
  assert.equal(api.db._rows(TRACES).length, 0);
}));

test('the per-project rate limiter refills over time and reports Retry-After', () => {
  _resetTracingRateLimits();
  const t0 = 1_000_000;
  // Burst capacity is 200.
  for (let i = 0; i < 200; i++) {
    assert.equal(checkRateLimit('p1', t0).allowed, true, `request ${i} inside the burst`);
  }
  const blocked = checkRateLimit('p1', t0);
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterSec >= 1, 'Retry-After must be a whole second, at least 1');

  // Another project has its own bucket.
  assert.equal(checkRateLimit('p2', t0).allowed, true);
  // 50 tokens/sec refill.
  assert.equal(checkRateLimit('p1', t0 + 1000).allowed, true);
  _resetTracingRateLimits();
});

test('local ingestion still enforces auth and the monthly budget', local(async (api) => {
  const p = await seedProject(api);
  assert.equal((await api.ingest([traceCreate()], p, { authorization: null })).status, 401);
  assert.equal(api.db._rows(TRACES).length, 0, 'an unauthenticated batch must store nothing');

  const row = api.row(p.id);
  row.monthly_event_budget = 1;
  row.events_this_month = 1;
  row.budget_month = currentBudgetMonth();
  const res = await api.ingest([traceCreate()], p);
  assert.equal(res.status, 429, 'switching backend must not switch off the budget');
  assert.equal(api.db._rows(TRACES).length, 0);
}));

// ── 12h. Read API ────────────────────────────────────────────────────────────

async function seedTraces(api, p) {
  await api.ingest([
    traceCreate({ userId: 'u-1', sessionId: 's-1', tags: ['prod'], input: 'hello' }),
    spanCreate(),
    envelope('span-update', { id: 'sp-1', traceId: 'tr-1', endTime: '2026-08-01T10:00:01.000Z' }),
    genCreate({ startTime: '2026-08-01T10:00:01.000Z' }),
    genUpdate({ output: 'answer', usage: { input: 100, output: 20 }, level: 'ERROR' }),
  ], p);
  await api.ingest([
    envelope('trace-create', { id: 'tr-2', name: 'other', userId: 'u-2' }, '2026-08-02T10:00:00.000Z'),
  ], p);
  return p;
}

test('GET /tracing/traces lists rollups, newest first, with no raw content', local(async (api) => {
  const p = await seedProject(api);
  api.row(p.id).capture_content = true;
  await seedTraces(api, p);

  const res = await api.tracing(`/traces?project_id=${p.id}`);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.traces.map((t) => t.id), ['tr-2', 'tr-1'], 'newest first');

  const one = res.body.traces[1];
  assert.equal(one.name, 'chat');
  assert.equal(one.user_id, 'u-1');
  assert.equal(one.observation_count, 2);
  assert.equal(one.generation_count, 1);
  assert.equal(one.total_tokens, 120);
  assert.equal(one.level, 'ERROR', 'a trace inherits the worst level of its observations');
  assert.equal(one.cost_estimated, true);
  // Earliest observation start (00.500) to latest observation end (02.000).
  // Derived from the $min/$max accumulators at read time, not stored raw.
  assert.equal(one.latency_ms, 1500);
  assert.equal(one.input_preview, 'hello');

  // Storage accumulators are internal — they must not leak into the API.
  assert.equal('span_start_ms' in one, false);
  assert.equal('level_rank' in one, false);
  // And no raw content, even for a capture_content project.
  assert.equal(res.text.includes('"input"'), false);

  assert.equal((await api.tracing('/traces')).status, 400, 'project_id is required');
}));

test('GET /tracing/traces filters and paginates by cursor', local(async (api) => {
  const p = await seedProject(api);
  await seedTraces(api, p);

  assert.deepEqual((await api.tracing(`/traces?project_id=${p.id}&user_id=u-2`)).body.traces.map((t) => t.id), ['tr-2']);
  assert.deepEqual((await api.tracing(`/traces?project_id=${p.id}&session_id=s-1`)).body.traces.map((t) => t.id), ['tr-1']);
  assert.deepEqual((await api.tracing(`/traces?project_id=${p.id}&name=other`)).body.traces.map((t) => t.id), ['tr-2']);
  assert.deepEqual((await api.tracing(`/traces?project_id=${p.id}&tags=prod`)).body.traces.map((t) => t.id), ['tr-1']);
  assert.deepEqual((await api.tracing(`/traces?project_id=${p.id}&level=ERROR`)).body.traces.map((t) => t.id), ['tr-1']);
  assert.deepEqual(
    (await api.tracing(`/traces?project_id=${p.id}&from=2026-08-02T00:00:00.000Z`)).body.traces.map((t) => t.id),
    ['tr-2'],
  );
  // A different project sees nothing — project_id is the tenant boundary.
  assert.deepEqual((await api.tracing('/traces?project_id=someone-else')).body.traces, []);

  const page1 = (await api.tracing(`/traces?project_id=${p.id}&limit=1`)).body;
  assert.deepEqual(page1.traces.map((t) => t.id), ['tr-2']);
  assert.ok(page1.next_cursor);
  const page2 = (await api.tracing(`/traces?project_id=${p.id}&limit=1&cursor=${encodeURIComponent(page1.next_cursor)}`)).body;
  assert.deepEqual(page2.traces.map((t) => t.id), ['tr-1']);
  assert.equal(page2.next_cursor, null, 'the last page must not advertise another');
}));

test('GET /tracing/traces/:id returns a waterfall ordered by start with offsets', local(async (api) => {
  const p = await seedProject(api);
  await seedTraces(api, p);

  const res = await api.tracing(`/traces/tr-1?project_id=${p.id}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.trace.id, 'tr-1');
  assert.deepEqual(res.body.observations.map((o) => o.id), ['sp-1', 'gen-1'], 'ordered by start_time');

  const [span, gen] = res.body.observations;
  assert.equal(span.offset_ms, 500, 'offset is relative to the trace start, for the waterfall');
  assert.equal(gen.offset_ms, 1000);
  assert.equal(span.depth, 0);
  assert.equal(gen.type, 'GENERATION');
  assert.equal(gen.model, 'gpt-4o');
  assert.equal(gen.has_io, false, 'a list never carries content, only whether content exists');
  assert.equal('input' in gen, false);

  assert.equal((await api.tracing(`/traces/nope?project_id=${p.id}`)).status, 404);
  assert.equal((await api.tracing('/traces/tr-1')).status, 400);
}));

test('a cyclic parent chain cannot hang the trace detail route', local(async (api) => {
  const p = await seedProject(api);
  await api.ingest([
    traceCreate(),
    // parent_observation_id is client-supplied: a -> b -> a is a thing a caller
    // can send, and it must not become an infinite walk.
    envelope('span-create', { id: 'a', traceId: 'tr-1', name: 'a', parentObservationId: 'b', startTime: '2026-08-01T10:00:00.000Z' }),
    envelope('span-create', { id: 'b', traceId: 'tr-1', name: 'b', parentObservationId: 'a', startTime: '2026-08-01T10:00:01.000Z' }),
  ], p);

  const res = await api.tracing(`/traces/tr-1?project_id=${p.id}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.observations.length, 2);
  assert.ok(res.body.observations.every((o) => o.parent_cycle === true), 'the broken tree is surfaced, not flattened silently');
  assert.ok(res.body.observations.every((o) => o.depth <= 50));
}));

test('GET /tracing/observations filters by type, model and trace', local(async (api) => {
  const p = await seedProject(api);
  await seedTraces(api, p);

  const all = await api.tracing(`/observations?project_id=${p.id}`);
  assert.equal(all.status, 200);
  assert.deepEqual(all.body.observations.map((o) => o.id), ['gen-1', 'sp-1'], 'newest first');

  const gens = await api.tracing(`/observations?project_id=${p.id}&type=GENERATION`);
  assert.deepEqual(gens.body.observations.map((o) => o.id), ['gen-1']);
  assert.equal(gens.body.observations[0].usage_details.input, 100);
  assert.equal(gens.body.observations[0].has_io, false);

  assert.deepEqual(
    (await api.tracing(`/observations?project_id=${p.id}&model=gpt-4o`)).body.observations.map((o) => o.id),
    ['gen-1'],
  );
  assert.deepEqual(
    (await api.tracing(`/observations?project_id=${p.id}&trace_id=tr-2`)).body.observations, [],
  );
  assert.equal((await api.tracing('/observations')).status, 400);
}));

test('GET /tracing/observations/:id/io requires admin auth and is the ONLY raw-content route', local(async (api) => {
  const p = await seedProject(api);
  api.row(p.id).capture_content = true;
  await api.ingest([traceCreate(), genCreate({ input: SECRET_PROMPT }), genUpdate({ output: 'raw answer' })], p);

  // Unauthenticated: refused. This is the one route in the file that is gated,
  // because it is the one route that returns unmasked prompt text.
  const anon = await api.tracing(`/observations/gen-1/io?project_id=${p.id}`);
  assert.equal(anon.status, 401);
  assert.equal(anon.text.includes('4111'), false, 'a rejected request must not leak the content it refused');

  const wrong = await fetch(`${api.base}/api/v1/tracing/observations/gen-1/io?project_id=${p.id}`, {
    headers: { authorization: 'Bearer not-the-admin-token' },
  });
  assert.equal(wrong.status, 401);

  const ok = await api.tracing(`/observations/gen-1/io?project_id=${p.id}`, { admin: true });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.input, SECRET_PROMPT);
  assert.equal(ok.body.output, 'raw answer');

  // The metadata list route stays open and stays masked — that split is the
  // existing convention (GET /api/v1/dlp is open, its content route is not).
  const list = await api.tracing(`/observations?project_id=${p.id}`);
  assert.equal(list.status, 200);
  assert.equal(list.body.observations[0].has_io, true);
  assert.equal(list.text.includes('4111'), false, 'raw content must never appear in a list');

  assert.equal((await api.tracing(`/observations/nope/io?project_id=${p.id}`, { admin: true })).status, 404);
}));

test('a masked project has no io row to fetch even for an admin', local(async (api) => {
  const p = await seedProject(api);
  await api.ingest([traceCreate(), genCreate({ input: SECRET_PROMPT })], p);
  const res = await api.tracing(`/observations/gen-1/io?project_id=${p.id}`, { admin: true });
  assert.equal(res.status, 404, 'content that was never captured cannot be produced by authenticating');
}));

// ── 12i. Retention ───────────────────────────────────────────────────────────

test('the retention sweeper deletes children before the parent and leaves nothing orphaned', local(async (api) => {
  const p = await seedProject(api);
  api.row(p.id).capture_content = true;
  await seedTraces(api, p);
  await api.ingest([envelope('generation-create', {
    id: 'gen-2', traceId: 'tr-2', model: 'gpt-4o', startTime: '2026-08-02T10:00:00.000Z', input: 'live',
  })], p);

  // Age tr-1 past its expiry; tr-2 stays live.
  const past = new Date(Date.now() - 1000);
  api.trace('tr-1').expires_at = past;
  for (const o of api.db._rows(OBSERVATIONS)) if (o.trace_id === 'tr-1') o.expires_at = past;
  for (const r of api.db._rows(OBSERVATION_IO)) if (r.observation_id !== 'gen-2') r.expires_at = past;

  const result = await sweepExpiredTraces(api.db);
  assert.equal(result.traces_deleted, 1);
  assert.equal(result.observations_deleted, 2);
  assert.ok(result.io_deleted >= 1, 'raw content must go with its observation');

  assert.equal(api.trace('tr-1'), undefined);
  assert.equal(api.observation('sp-1'), undefined);
  assert.equal(api.observation('gen-1'), undefined);
  assert.equal(api.ioRow('gen-1'), undefined);
  // The live trace and its content are untouched.
  assert.ok(api.trace('tr-2'));
  assert.ok(api.observation('gen-2'));

  // Idempotent: a second pass finds nothing left to do.
  const again = await sweepExpiredTraces(api.db);
  assert.equal(again.traces_deleted, 0);
  assert.equal(again.errors, 0);
}));

test('an expired observation whose trace is already gone is still collected', local(async (api) => {
  const p = await seedProject(api);
  await api.ingest([genCreate()], p);            // creates a stub trace
  const past = new Date(Date.now() - 1000);
  api.observation('gen-1').expires_at = past;
  api.db._rows(TRACES).length = 0;               // the parent vanished

  const result = await sweepExpiredTraces(api.db);
  assert.equal(result.orphans_deleted, 1, 'nothing may be left unreachable — that is why this is not a TTL index');
  assert.equal(api.observation('gen-1'), undefined);
}));

test('retention_days on the project drives the stored expiry', local(async (api) => {
  const p = await seedProject(api);
  api.row(p.id).retention_days = 1;
  await api.ingest([traceCreate(), genCreate()], p);

  const days = (api.trace('tr-1').expires_at.getTime() - Date.now()) / 86_400_000;
  assert.ok(days > 0.9 && days < 1.1, `expected ~1 day, got ${days}`);
  const obsDays = (api.observation('gen-1').expires_at.getTime() - Date.now()) / 86_400_000;
  assert.ok(obsDays > 0.9 && obsDays < 1.1);
}));

// ── 12j. The pure planner, without a server ──────────────────────────────────

test('planIngestion never mixes $set and $inc on the same field path', () => {
  const plan = planIngestion(
    [traceCreate(), genCreate(), genUpdate({ usage: { input: 10, output: 5 } })],
    { project: { id: 'p1' } },
  );
  const OPS = ['$set', '$setOnInsert', '$inc', '$min', '$max'];
  for (const op of plan.operations) {
    for (let i = 0; i < OPS.length; i++) {
      for (let j = i + 1; j < OPS.length; j++) {
        const a = Object.keys(op.update[OPS[i]] ?? {});
        const b = new Set(Object.keys(op.update[OPS[j]] ?? {}));
        for (const key of a) {
          // Mongo rejects this outright — see routes/langfuse-gateway.js's budget
          // rollover, which had to be written around the same restriction.
          assert.equal(b.has(key), false, `${key} appears in both ${OPS[i]} and ${OPS[j]}`);
        }
      }
    }
  }
  // Trace counters live in $setOnInsert on the upsert and $inc on the rollup —
  // two DIFFERENT update documents, which is what makes that legal.
  const traceOps = plan.operations.filter((o) => o.collection === TRACES);
  assert.equal(traceOps.length, 2);
  assert.equal(traceOps[0].update.$setOnInsert.observation_count, 0);
  assert.equal(traceOps[1].update.$inc.observation_count, 1);
});

test('costForGeneration prices the vendors it knows and refuses to guess for the rest', () => {
  // 1M in + 1M out of gpt-4o at 2.50 / 10.00.
  const openai = costForGeneration({ model: 'gpt-4o', usage: { input: 1_000_000, output: 1_000_000 } });
  assert.equal(openai.cost_details.total, 12.5);
  assert.equal(openai.cost_estimated, true);

  // gpt-4o-mini must not be priced as gpt-4o.
  const mini = costForGeneration({ model: 'gpt-4o-mini', usage: { input: 1_000_000, output: 0 } });
  assert.equal(mini.cost_details.total, 0.15);

  const anthropic = costForGeneration({ model: 'claude-3-5-sonnet-20241022', usage: { input: 1_000_000, output: 0 } });
  assert.equal(anthropic.cost_details.total, 3);

  // Supplied cost wins outright and is NOT marked estimated.
  const supplied = costForGeneration({
    model: 'gpt-4o', usage: { input: 1_000_000, output: 1_000_000 },
    costDetails: { total: 0.42 },
  });
  assert.equal(supplied.cost_details.total, 0.42);
  assert.equal(supplied.cost_estimated, false);

  // A vendor with no price table gets null, not another vendor's rates.
  const unknown = costForGeneration({ model: 'llama-3-70b', usage: { input: 1000, output: 1000 } });
  assert.equal(unknown.cost_details.total, null);
  assert.equal(unknown.cost_estimated, false);

  // No tokens, no cost, and no false precision.
  assert.equal(costForGeneration({ model: 'gpt-4o', usage: {} }).cost_details.total, null);
  assert.equal(costForGeneration({}).cost_estimated, false);
});

test('normalizeEvent rejects junk without throwing', () => {
  assert.equal(normalizeEvent(null).ok, false);
  assert.equal(normalizeEvent('nope').ok, false);
  assert.equal(normalizeEvent({ type: 'trace-create' }).ok, false);          // no body
  assert.equal(normalizeEvent({ body: { id: 'x' } }).ok, false);             // no type
  assert.equal(normalizeEvent({ type: 'trace-create', body: [] }).ok, false);
  // Unknown-but-harmless event types are accepted-and-ignored, not errors.
  const log = normalizeEvent({ type: 'sdk-log', body: { message: 'hi' } });
  assert.equal(log.ok, true);
  assert.equal(log.kind, 'ignored');
});

test('trace level rank ordering survives Mongo $max, which string ordering would not', () => {
  assert.ok(levelRank('ERROR') > levelRank('WARNING'));
  assert.ok(levelRank('WARNING') > levelRank('DEFAULT'));
  assert.ok(levelRank('DEFAULT') > levelRank('DEBUG'));
  // Alphabetically 'WARNING' > 'ERROR', which is why the accumulator is numeric.
  assert.ok('WARNING' > 'ERROR');
  assert.equal(levelForRank(levelRank('ERROR')), 'ERROR');
  assert.equal(levelForRank(undefined), 'DEFAULT');
  assert.equal(levelRank('nonsense'), levelRank('DEFAULT'));
});

test('a reserved cfproj: tag is stripped in local mode too', () => {
  const plan = planIngestion(
    [envelope('trace-create', { id: 't', tags: ['prod', 'cfproj:someone-else', 'CFPROJ:x'] })],
    { project: { id: 'p1' } },
  );
  assert.deepEqual(plan.operations[0].update.$set.tags, ['prod']);
});

// ── 12k. Schema ──────────────────────────────────────────────────────────────

test('applyInitialSchema declares the tracing indexes, and none of them is a TTL', async () => {
  const db = createFakeDb();
  await applyInitialSchema(db);

  const traceIdx = Object.fromEntries((await db.collection(TRACES).indexes()).map((i) => [i.name, i]));
  assert.equal(traceIdx.project_id_1_id_1.unique, true);
  assert.ok(traceIdx['project_id_1_timestamp_-1']);
  assert.ok(traceIdx['project_id_1_user_id_1_timestamp_-1']);
  assert.ok(traceIdx.expires_at_1, 'the sweeper queries this — it is NOT a TTL index');

  const obsIdx = Object.fromEntries((await db.collection(OBSERVATIONS).indexes()).map((i) => [i.name, i]));
  assert.equal(obsIdx.project_id_1_id_1.unique, true);
  assert.ok(obsIdx.project_id_1_trace_id_1_start_time_1);
  assert.ok(obsIdx['project_id_1_type_1_start_time_-1']);
  assert.ok(obsIdx.trace_id_1);

  const ioIdx = Object.fromEntries((await db.collection(OBSERVATION_IO).indexes()).map((i) => [i.name, i]));
  assert.equal(ioIdx.project_id_1_observation_id_1.unique, true);

  // No expireAfterSeconds anywhere: TTL would delete a parent trace and orphan
  // its observations and their content rows.
  for (const coll of [TRACES, OBSERVATIONS, OBSERVATION_IO]) {
    for (const idx of await db.collection(coll).indexes()) {
      assert.equal('expireAfterSeconds' in idx, false, `${coll}.${idx.name} must not be a TTL index`);
    }
  }
});

test('the {project_id,id} unique index keeps two projects from colliding on one trace id', async () => {
  const db = createFakeDb();
  await applyInitialSchema(db);
  const col = db.collection(TRACES);
  await col.insertOne({ project_id: 'p1', id: 'tr-1' });
  // Same trace id, different tenant: legal, and must stay legal.
  await col.insertOne({ project_id: 'p2', id: 'tr-1' });
  await assert.rejects(() => col.insertOne({ project_id: 'p1', id: 'tr-1' }), (e) => e.code === 11000);
});

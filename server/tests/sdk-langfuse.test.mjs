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
import { ADMIN_TOKEN } from '../src/auth.js';
import { applyInitialSchema } from '../src/db/index.js';
import { createFakeDb } from './helpers/fake-db.mjs';
import { dropLegacySdkData } from '../scripts/drop-legacy-sdk-collections.mjs';

const PROJECTS = 'sdk_projects';
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

async function withServer(fn, { langfuse = true } = {}) {
  const db = createFakeDb();
  await applyInitialSchema(db);
  _clearSdkReadCache();
  setLangfuseEnv(langfuse);

  const app = express();
  app.use(express.json({ limit: '50mb' }));
  mountSdk(app, db);
  mountLangfuseGateway(app, db);
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

    row(id) { return api.db._rows(PROJECTS).find((p) => p.id === id); },
  };

  try {
    return await fn(api);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    _clearSdkReadCache();
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

const TRACES = {
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

const OBSERVATIONS = {
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
    '/api/public/traces': () => ({ status: 200, body: TRACES }),
    '/api/public/observations': () => ({ status: 200, body: OBSERVATIONS }),
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

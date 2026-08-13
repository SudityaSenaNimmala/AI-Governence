// Developer SDK projects — credential issuing + trace read-back.
//
// WHAT CHANGED, AND WHY
// ---------------------
// This used to be a hand-rolled tracing backend: developers POSTed events to
// /api/v1/sdk/events with a `cfsk_...` bearer token and we stored them in a
// local `sdk_events` collection. That is gone. Traces now live in Langfuse
// Cloud, and this server is a credential-issuing GATEWAY in front of the one
// real Langfuse project CloudFuze owns (see routes/langfuse-gateway.js and
// lib/langfuse.js for the tenancy argument).
//
// So this file now does two things:
//   1. Mints and lists per-developer credential pairs (pk-lf-… / sk-lf-…).
//      Those keys are OURS, not Langfuse's, despite the familiar-looking prefix
//      — a developer's SDK points at THIS server, and only this server holds the
//      real Langfuse key.
//   2. Reads a project's traces back OUT of Langfuse, using CloudFuze's real key
//      and filtering by the project's own `cfproj:<id>` tag.
//
// SECURITY FIX included here: every route in this file used to be completely
// unauthenticated, and GET /projects projected every field except `_id` — which
// meant it handed each project's plaintext API key to any caller who could reach
// the port. The dashboard's "you will only see this key once" modal was
// decorative. All five routes now require requireAdminAuth, the raw secret is
// never stored (only its SHA-256), and the list route projects an explicit
// allow-list of fields rather than trusting field omission.

import crypto from 'node:crypto';
import { a } from '../util.js';
import { requireAdminAuth } from '../auth.js';
import { langfuseConfig, langfuseFetch } from '../lib/langfuse.js';
import { DEFAULT_RETENTION_DAYS } from '../lib/tracing-ingest.js';

// Langfuse Cloud is usage-billed, so an SDK stuck in a retry loop is a bill, not
// just noise. Every project therefore carries a monthly ingestion budget. 10k
// events/month is deliberately generous for the intended use (a developer wiring
// up and demoing an integration) while still capping a runaway loop at a
// bounded cost. It lives on the project document rather than in code so an admin
// can raise it per project — an admin-facing override UI is NOT built yet.
export const DEFAULT_MONTHLY_EVENT_BUDGET = 10_000;

// How many traces the dashboard's "Recent Traces" table pulls from Langfuse.
const TRACE_PAGE_LIMIT = 50;
// Live read cache. Two dashboard tabs polling at once must not become two
// outbound Langfuse queries.
const READ_CACHE_TTL_MS = 30_000;

// The fields GET /projects is allowed to return. An allow-list, not a deny-list:
// the bug this replaces was a deny-list that forgot a field.
const PUBLIC_PROJECT_FIELDS = [
  'id', 'name', 'language', 'description', 'status',
  'public_key', 'secret_key_last4', 'cf_tag',
  'created_at', 'revoked_at', 'last_event_at',
  'total_events', 'total_cost_usd',
  'events_this_month', 'budget_month', 'monthly_event_budget',
  // Local tracing backend settings + counters.
  'capture_content', 'retention_days', 'total_traces', 'total_observations',
];

export function publicProject(doc = {}) {
  const out = {};
  for (const f of PUBLIC_PROJECT_FIELDS) if (f in doc) out[f] = doc[f];
  return out;
}

export function sha256Hex(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

// The raw secret exists only inside the one request that created it. What lands
// in Mongo is its digest plus the last 4 characters, which is all the dashboard
// needs to say "this is the key you saved".
export function mintProjectCredentials(projectId) {
  const secret_key = 'sk-lf-' + crypto.randomBytes(32).toString('hex');
  return {
    public_key: 'pk-lf-' + crypto.randomUUID(),
    secret_key,                               // RAW — returned once, never stored
    secret_key_hash: sha256Hex(secret_key),
    secret_key_last4: secret_key.slice(-4),
    cf_tag: 'cfproj:' + projectId,
  };
}

// Constant-time verification, mirroring auth.js's constantTimeEqual: compare the
// DIGESTS (always 64 hex chars, so a length mismatch leaks nothing about the
// secret) rather than the secrets themselves, and never with `===`.
export function verifyProjectSecret(rawSecret, storedHash) {
  if (typeof rawSecret !== 'string' || typeof storedHash !== 'string') return false;
  const ab = Buffer.from(sha256Hex(rawSecret), 'utf8');
  const bb = Buffer.from(storedHash, 'utf8');
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

export function currentBudgetMonth(now = new Date()) {
  return now.toISOString().slice(0, 7); // YYYY-MM
}

// `provider` is not a Langfuse concept — Langfuse records the model string only.
// The dashboard groups by vendor, so derive it from the model name prefix.
export function providerForModel(model) {
  const m = String(model || '').toLowerCase();
  if (m.startsWith('gpt-') || m.startsWith('o1') || m.startsWith('o3')) return 'openai';
  if (m.startsWith('claude-')) return 'anthropic';
  if (m.startsWith('gemini-')) return 'google';
  return 'other';
}

function firstNumber(...values) {
  for (const v of values) {
    const n = Number(v);
    if (v !== null && v !== undefined && v !== '' && Number.isFinite(n)) return n;
  }
  return null;
}

// One Langfuse observation → one dashboard event row. Field names are the ones
// the previous local-storage implementation returned, so the read contract the
// dashboard builds against does not move.
export function mapObservation(trace, obs) {
  const usage = obs.usageDetails || obs.usage || {};
  return {
    id: obs.id,
    trace_id: trace.id,
    project_id: null,                          // filled in by the caller
    occurred_at: trace.timestamp || obs.startTime || null,
    type: obs.type || null,
    provider: providerForModel(obs.model),
    model: obs.model || null,
    prompt_tokens: firstNumber(usage.input, usage.promptTokens, obs.promptTokens),
    completion_tokens: firstNumber(usage.output, usage.completionTokens, obs.completionTokens),
    total_cost_usd: firstNumber(obs.calculatedTotalCost, obs.totalCost, obs.costDetails?.total),
    // Langfuse reports latency in SECONDS. The dashboard reads milliseconds.
    // Dropping this multiplication turns a 2.4s call into "2ms".
    duration_ms: (() => {
      const seconds = firstNumber(obs.latency);
      return seconds === null ? null : Math.round(seconds * 1000);
    })(),
    status: String(obs.level || '').toUpperCase() === 'ERROR' ? 'error' : 'ok',
    name: obs.name || null,
  };
}

// ── Live read of one project's traces ────────────────────────────────────────
// Cache + in-flight dedupe, keyed strictly by project id. A plain module-level
// Map on purpose: no new dependency, no Redis, and the whole thing is a 30s
// window over a read-only view.
const readCache = new Map();   // project_id → { expires, events }
const inFlight = new Map();    // project_id → Promise<events>

export function _clearSdkReadCache() {   // test hook
  readCache.clear();
  inFlight.clear();
}

async function langfuseJson(path) {
  const res = await langfuseFetch(path);
  if (!res.ok) throw new Error(`langfuse ${path.split('?')[0]} responded ${res.status}`);
  return res.json();
}

async function observationsFor(trace) {
  // Langfuse's trace list returns `observations` as an array of IDs; the single
  // trace endpoint returns full objects. Accept either so we never make N+1
  // calls we did not have to.
  if (Array.isArray(trace.observations) && trace.observations.length
      && typeof trace.observations[0] === 'object') {
    return trace.observations;
  }
  const body = await langfuseJson(
    `/api/public/observations?traceId=${encodeURIComponent(trace.id)}&limit=100`,
  );
  return Array.isArray(body?.data) ? body.data : [];
}

async function fetchProjectEvents(project) {
  const tag = encodeURIComponent(project.cf_tag);
  const body = await langfuseJson(
    `/api/public/traces?tags=${tag}&limit=${TRACE_PAGE_LIMIT}&page=1`,
  );
  const traces = Array.isArray(body?.data) ? body.data : [];

  const events = [];
  // Small bounded concurrency: 50 traces × one observation call each, six at a
  // time. Bounded by TRACE_PAGE_LIMIT and shielded by the 30s cache.
  const queue = [...traces];
  const workers = Array.from({ length: Math.min(6, queue.length) }, async () => {
    while (queue.length) {
      const trace = queue.shift();
      let obs = [];
      try {
        obs = await observationsFor(trace);
      } catch {
        // One trace failing to expand must not blank the whole table.
        obs = [];
      }
      for (const o of obs) {
        events.push({ ...mapObservation(trace, o), project_id: project.id });
      }
    }
  });
  await Promise.all(workers);

  events.sort((x, y) => String(y.occurred_at || '').localeCompare(String(x.occurred_at || '')));
  return events;
}

async function readProjectEvents(project) {
  const key = project.id;
  const hit = readCache.get(key);
  if (hit && hit.expires > Date.now()) return hit.events;

  const pending = inFlight.get(key);
  if (pending) return pending;

  const promise = fetchProjectEvents(project)
    .then((events) => {
      readCache.set(key, { expires: Date.now() + READ_CACHE_TTL_MS, events });
      return events;
    })
    .finally(() => inFlight.delete(key));

  inFlight.set(key, promise);
  return promise;
}

export function mountSdk(app, db) {
  const col = () => db.collection('sdk_projects');

  // Create a project and mint its credential pair. The raw secret is in the
  // response body of THIS call and nowhere else, ever.
  app.post('/api/v1/sdk/projects', requireAdminAuth, a(async (req, res) => {
    const { name, language, description } = req.body || {};
    if (!name) return res.status(400).json({ error: 'name is required' });

    const id = crypto.randomUUID();
    const { secret_key, ...creds } = mintProjectCredentials(id);
    const project = {
      id,
      name,
      language: language || 'javascript',
      description: description || '',
      ...creds,                                 // public_key, secret_key_hash, last4, cf_tag
      created_at: new Date().toISOString(),
      last_event_at: null,
      // Lifetime counters, maintained by the gateway. They are NOT derived from
      // Langfuse, because Langfuse's free tier drops trace history after 30 days
      // and a lifetime stat card must not shrink when that happens.
      total_events: 0,
      total_cost_usd: 0,
      // Monthly ingestion budget (Langfuse Cloud is usage-billed).
      monthly_event_budget: DEFAULT_MONTHLY_EVENT_BUDGET,
      events_this_month: 0,
      budget_month: currentBudgetMonth(),
      // ── Local tracing backend (CFAI_TRACING_BACKEND=local, the default) ─────
      // Masked by default. With capture_content false the store keeps only
      // maskSensitive() previews of input/output; raw prompt and completion text
      // is never written anywhere. Turning it on is a deliberate, per-project
      // act, and even then the raw text lands in its own collection behind an
      // admin-only route.
      capture_content: false,
      retention_days: DEFAULT_RETENTION_DAYS,
      total_traces: 0,
      total_observations: 0,
      status: 'active',
    };
    await col().insertOne(project);

    // The one-time reveal.
    res.status(201).json({ ...publicProject(project), secret_key });
  }));

  // List projects. Explicit allow-list — never the hash, never the raw secret
  // (which does not exist here to leak in the first place).
  app.get('/api/v1/sdk/projects', requireAdminAuth, a(async (req, res) => {
    const rows = await col().find({}, { projection: { _id: 0 } }).sort({ created_at: -1 }).toArray();
    res.json(rows.map(publicProject));
  }));

  // REVOKE, not delete — the verb stays DELETE for the dashboard's sake, but the
  // document survives with status: 'revoked'. Its `cf_tag` is still stamped on
  // real traces sitting in Langfuse; hard-deleting the row would leave those
  // traces attributed to an id nothing can resolve, and would free the tag to be
  // re-minted onto a future project that would then inherit someone else's data.
  // The gateway rejects a revoked project's credentials with 401, so revocation
  // is a real kill switch, not a flag.
  app.delete('/api/v1/sdk/projects/:id', requireAdminAuth, a(async (req, res) => {
    const r = await col().updateOne(
      { id: req.params.id },
      { $set: { status: 'revoked', revoked_at: new Date().toISOString() } },
    );
    if (!r.matchedCount) return res.status(404).json({ error: 'project not found' });
    res.json({ ok: true, status: 'revoked' });
  }));

  // Dashboard stat cards. Everything here comes from OUR collection: the
  // lifetime totals are running counters (see above), so they survive Langfuse's
  // retention window.
  app.get('/api/v1/sdk/stats', requireAdminAuth, a(async (req, res) => {
    const rows = await col().find({}, { projection: { _id: 0 } }).toArray();
    const since = new Date(Date.now() - 86_400_000).toISOString();
    const live = rows.filter((p) => p.status !== 'revoked');
    res.json({
      total_projects: live.length,
      active_projects: live.filter((p) => p.last_event_at && p.last_event_at >= since).length,
      // Revoked projects keep contributing: those events really were ingested
      // and really were billed.
      total_events: rows.reduce((t, p) => t + (Number(p.total_events) || 0), 0),
      total_cost_usd: rows.reduce((t, p) => t + (Number(p.total_cost_usd) || 0), 0),
    });
  }));

  // Recent traces for one project, read live out of Langfuse and filtered by the
  // project's own tag. Degrades to an empty, flagged result rather than a 500:
  // Langfuse being unreachable (or not configured yet) must not stop the
  // dashboard rendering the project list.
  app.get('/api/v1/sdk/events', requireAdminAuth, a(async (req, res) => {
    const { project_id } = req.query;
    if (!project_id) return res.status(400).json({ error: 'project_id is required' });

    const limit = Math.min(Number(req.query.limit) || TRACE_PAGE_LIMIT, TRACE_PAGE_LIMIT);
    const project = await col().findOne({ id: String(project_id) });
    if (!project) return res.status(404).json({ error: 'project not found' });

    if (!langfuseConfig().configured) {
      return res.json({ events: [], degraded: true, reason: 'langfuse_not_configured' });
    }

    try {
      const events = await readProjectEvents(project);
      res.json({ events: events.slice(0, limit), degraded: false });
    } catch (err) {
      // Message only — an error from the trace API can quote request content.
      console.warn(`[langfuse] trace read failed project=${project.id}: ${err.message}`);
      res.json({ events: [], degraded: true, reason: 'langfuse_unreachable' });
    }
  }));
}

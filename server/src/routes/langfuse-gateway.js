// Langfuse ingestion gateway — the write half of the Developer SDK feature.
//
// A developer's Langfuse SDK is pointed at THIS server (baseUrl
// `<server>/api/v1/lf`) and authenticates with the pk-lf-… / sk-lf-… pair we
// minted for their project in routes/sdk.js. This gateway verifies that pair,
// stamps the project's `cfproj:<id>` tag onto every item in the batch, and only
// then relays to the real Langfuse Cloud API using CloudFuze's single real key.
//
// Why the indirection instead of handing developers the real Langfuse key: there
// is exactly ONE real Langfuse project (per-project auto-creation is an
// Enterprise feature we are not buying). A shared real key would let every
// developer read and write every other developer's traces, with no way to revoke
// one of them. Ours are individually revocable and can only ever write their own
// tag.
//
// THE TAG IS THE ENTIRE TENANT BOUNDARY. A client-supplied `cfproj:` tag is
// therefore stripped before ours is added — otherwise a developer could label
// their traces with someone else's project id and have their data show up in
// (and pollute) that project's dashboard view.
//
// Logging discipline: batch bodies are real prompt and completion text. Nothing
// in this file logs, stores, or echoes a body — only structural facts
// (project id, batch size, upstream status).

import express from 'express';
import { a } from '../util.js';
import { langfuseConfig, langfuseFetch } from '../lib/langfuse.js';
import {
  DEFAULT_MONTHLY_EVENT_BUDGET,
  currentBudgetMonth,
  verifyProjectSecret,
} from './sdk.js';

// Any casing of the reserved prefix — a developer sending `CFPROJ:x` must not
// slip past a case-sensitive filter.
const CF_TAG_PREFIX = /^\s*cfproj:/i;

// Langfuse's ingestion event types whose body carries a `tags` array (TraceBody).
// Observation bodies (span/generation/event) have no tags field in Langfuse's
// schema, so those get the metadata fallback below instead.
const TAG_BEARING_TYPES = new Set(['trace-create', 'trace-update']);

// One 401 body for every failure mode — unknown public key, wrong secret, and
// revoked project are indistinguishable to the caller, the same way the rest of
// this codebase phrases an auth failure.
const UNAUTHORIZED = { error: 'invalid SDK credentials' };

// Parse `Authorization: Basic base64(publicKey:secretKey)`.
export function parseBasicAuth(header = '') {
  const m = String(header).match(/^Basic\s+(.+)$/i);
  if (!m) return null;
  let decoded;
  try {
    decoded = Buffer.from(m[1].trim(), 'base64').toString('utf8');
  } catch {
    return null;
  }
  const sep = decoded.indexOf(':');
  if (sep < 1) return null;
  return { publicKey: decoded.slice(0, sep), secretKey: decoded.slice(sep + 1) };
}

// Mutates `batch` in place: strips any client-supplied cfproj tag and stamps the
// project's own. Exported so the security property is directly testable.
export function stampBatch(batch, project) {
  for (const item of batch) {
    if (!item || typeof item !== 'object') continue;
    const body = item.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) continue;

    // 1. Strip. Applies to EVERY event type, not just the tag-bearing ones: a
    //    tags array on an observation body is ignored by Langfuse today, but
    //    "ignored today" is not a security guarantee worth relying on.
    if (Array.isArray(body.tags)) {
      body.tags = body.tags.filter((t) => typeof t === 'string' && !CF_TAG_PREFIX.test(t));
    }

    // 2. Stamp. Tag-bearing bodies get the real tag (this is what the read path
    //    filters on).
    if (TAG_BEARING_TYPES.has(String(item.type)) || Array.isArray(body.tags)) {
      body.tags = [...(Array.isArray(body.tags) ? body.tags : []), project.cf_tag];
    }

    // 3. Belt and braces for everything else: an id in metadata, so no item
    //    crosses the boundary carrying no attribution at all. Metadata is
    //    arbitrary JSON in Langfuse, so a non-object value is preserved beside
    //    ours rather than silently dropped.
    const meta = body.metadata;
    if (meta && typeof meta === 'object' && !Array.isArray(meta)) {
      body.metadata = { ...meta, cf_project_id: project.id };
    } else if (meta === undefined || meta === null) {
      body.metadata = { cf_project_id: project.id };
    } else {
      body.metadata = { cf_project_id: project.id, cf_original_metadata: meta };
    }
  }
  return batch;
}

// Cost is normally computed by Langfuse from its model price table, not sent by
// the SDK — so this is best effort, and only sums what a client actually
// supplied. The dashboard's lifetime cost card is therefore a floor, not a
// billing source of truth.
function costOfBatch(batch) {
  let total = 0;
  for (const item of batch) {
    const body = item?.body;
    if (!body || typeof body !== 'object') continue;
    const n = Number(body.costDetails?.total ?? body.usage?.totalCost ?? body.usage?.total_cost);
    if (Number.isFinite(n)) total += n;
  }
  return total;
}

export function mountLangfuseGateway(app, db) {
  const col = () => db.collection('sdk_projects');

  // Authenticate a developer's credential pair. Returns the project doc or null.
  // Unknown key, wrong secret and revoked project all return null on purpose.
  async function authenticate(req) {
    const creds = parseBasicAuth(req.headers.authorization || '');
    if (!creds || !creds.publicKey || !creds.secretKey) return null;
    const project = await col().findOne({ public_key: creds.publicKey });
    if (!project || project.status === 'revoked') {
      // Still burn the comparison so a revoked/unknown key is not measurably
      // faster to probe than a wrong secret.
      verifyProjectSecret(creds.secretKey, '0'.repeat(64));
      return null;
    }
    if (!verifyProjectSecret(creds.secretKey, project.secret_key_hash || '')) return null;
    return project;
  }

  // Monthly budget check. Returns null when the request fits, or the 429 body
  // when it does not. The counter resets whenever the stored month is stale.
  function budgetCheck(project, count) {
    const month = currentBudgetMonth();
    const limit = Number.isFinite(Number(project.monthly_event_budget))
      ? Number(project.monthly_event_budget)
      : DEFAULT_MONTHLY_EVENT_BUDGET;
    const current = project.budget_month === month ? (Number(project.events_this_month) || 0) : 0;
    if (current + count > limit) {
      return { body: { error: 'monthly event budget exceeded', limit, current }, month, current };
    }
    return null;
  }

  // Counters advance only on a relay Langfuse actually accepted. A rejected or
  // budget-blocked request costs nothing, so it must not consume budget either.
  async function recordIngestion(project, count, costDelta) {
    const month = currentBudgetMonth();
    const rolled = project.budget_month !== month;
    const $set = { last_event_at: new Date().toISOString(), budget_month: month };
    const $inc = { total_events: count, total_cost_usd: costDelta };
    if (rolled) {
      // A new month: reset rather than increment. ($set and $inc may not touch
      // the same path — Mongo rejects that outright.)
      $set.events_this_month = count;
    } else {
      $inc.events_this_month = count;
    }
    await col().updateOne({ id: project.id }, { $set, $inc });
  }

  // ── POST /api/v1/lf/api/public/ingestion ───────────────────────────────────
  // The batch endpoint the official Langfuse JS/Python SDKs call.
  app.post('/api/v1/lf/api/public/ingestion', a(async (req, res) => {
    const project = await authenticate(req);
    if (!project) return res.status(401).json(UNAUTHORIZED);

    const cfg = langfuseConfig();
    if (!cfg.configured) {
      console.warn('[langfuse] gateway hit with no LANGFUSE_* configuration — refusing relay');
      return res.status(503).json({ error: 'Langfuse not configured' });
    }

    const batch = req.body?.batch;
    if (!Array.isArray(batch)) return res.status(400).json({ error: 'batch array required' });
    const count = batch.length;
    if (!count) return res.status(200).json({ successes: [], errors: [] });

    const overBudget = budgetCheck(project, count);
    if (overBudget) {
      console.warn(`[langfuse] budget exceeded project=${project.id} batch=${count} limit=${overBudget.body.limit}`);
      return res.status(429).json(overBudget.body);
    }

    stampBatch(batch, project);

    let upstream;
    try {
      upstream = await langfuseFetch('/api/public/ingestion', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...req.body, batch }),
      });
    } catch (err) {
      console.warn(`[langfuse] relay failed project=${project.id} batch=${count}: ${err.message}`);
      // 502 keeps the SDK's own retry/backoff engaged.
      return res.status(502).json({ error: 'langfuse relay failed' });
    }

    if (upstream.ok || upstream.status === 207) {
      await recordIngestion(project, count, costOfBatch(batch));
    }

    // Pass Langfuse's own status and body through untouched so the SDK's retry
    // and partial-success handling keeps behaving exactly as it would against
    // Langfuse directly. The body is NOT read into a log line.
    const text = await upstream.text();
    console.log(`[langfuse] relay project=${project.id} batch=${count} status=${upstream.status}`);
    res
      .status(upstream.status)
      .type(upstream.headers.get('content-type') || 'application/json')
      .send(text);
  }));

  // ── POST /api/v1/lf/api/public/otel/v1/traces ──────────────────────────────
  // The OTLP path (the Java / OpenTelemetry SDK route into Langfuse).
  //
  // KNOWN, DELIBERATE LIMITATION: per-project tag segregation is NOT enforced on
  // this path. OTLP payloads are usually protobuf, and even the JSON encoding
  // carries tags as span attributes nested under
  // resourceSpans[].scopeSpans[].spans[].attributes[] with typed AnyValue
  // wrappers. Rewriting that correctly needs a real OTLP parser; doing it
  // half-right would corrupt spans or, worse, appear to enforce a boundary it
  // does not. So this route authenticates and budget-checks (the revocation and
  // cost controls DO apply), then relays the body opaquely — traces arriving
  // this way land in the shared Langfuse project WITHOUT a cfproj tag, which
  // means they are not readable through GET /api/v1/sdk/events either. Until a
  // proper OTLP attribute rewrite lands, the JS/Python ingestion route above is
  // the only fully-segregated path.
  const rawBody = express.raw({ type: () => true, limit: '25mb' });

  app.post('/api/v1/lf/api/public/otel/v1/traces', rawBody, a(async (req, res) => {
    const project = await authenticate(req);
    if (!project) return res.status(401).json(UNAUTHORIZED);

    const cfg = langfuseConfig();
    if (!cfg.configured) {
      console.warn('[langfuse] otel gateway hit with no LANGFUSE_* configuration — refusing relay');
      return res.status(503).json({ error: 'Langfuse not configured' });
    }

    // express.json() upstream may already have parsed a JSON body; in that case
    // re-serialise it, otherwise forward the raw bytes as they arrived.
    const contentType = req.headers['content-type'] || 'application/x-protobuf';
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body ?? {}));

    // One span is one billable unit we cannot count without parsing, so charge
    // the batch as a single event rather than pretending to a precise number.
    const overBudget = budgetCheck(project, 1);
    if (overBudget) {
      console.warn(`[langfuse] budget exceeded (otel) project=${project.id} limit=${overBudget.body.limit}`);
      return res.status(429).json(overBudget.body);
    }

    let upstream;
    try {
      upstream = await langfuseFetch('/api/public/otel/v1/traces', {
        method: 'POST',
        headers: { 'content-type': contentType },
        body,
      });
    } catch (err) {
      console.warn(`[langfuse] otel relay failed project=${project.id}: ${err.message}`);
      return res.status(502).json({ error: 'langfuse relay failed' });
    }

    if (upstream.ok) await recordIngestion(project, 1, 0);

    const text = await upstream.text();
    console.log(`[langfuse] otel relay project=${project.id} bytes=${body.length} status=${upstream.status}`);
    res
      .status(upstream.status)
      .type(upstream.headers.get('content-type') || 'application/json')
      .send(text);
  }));
}

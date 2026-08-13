// Local tracing store — the I/O half of the ingestion path.
//
// lib/tracing-ingest.js decides WHAT to write (pure, fixture-testable). This file
// decides whether we are in local mode at all, guards the route (body size, batch
// size, per-project rate), reads the prior observation state the planner needs to
// keep the trace rollup exact, and executes the operations the planner returned.
//
// It logs structural facts only — project id, batch size, counts. Never a body,
// never a preview, never a model input. See the header of tracing-ingest.js.

import express from 'express';
import {
  planIngestion,
  observationIdsInBatch,
  MAX_BATCH_ITEMS,
  TRACES,
  OBSERVATIONS,
} from './tracing-ingest.js';

// The ingestion route is a new externally-callable surface, so it gets its own
// 5mb body cap instead of inheriting the global 50mb one (which is sized for DLP
// file uploads and would let a single tracing request pin 50mb of heap). It has
// to be registered BEFORE the global express.json() in src/index.js — body-parser
// no-ops once a body has already been parsed, so a limit mounted after the global
// parser would be decorative.
export const TRACING_INGEST_PATH = '/api/v1/lf/api/public/ingestion';
export const TRACING_BODY_LIMIT = '5mb';

export function mountTracingIngestBodyLimit(app) {
  app.use(TRACING_INGEST_PATH, express.json({ limit: TRACING_BODY_LIMIT }));
  // Scoped error handler, right behind the parser. Without it an oversized body
  // falls through to the app-wide handler in src/index.js and becomes a generic
  // 500 — which tells an SDK to retry the same too-large payload forever. 413 is
  // terminal and says exactly what to fix.
  app.use(TRACING_INGEST_PATH, (err, req, res, next) => {
    if (err && (err.type === 'entity.too.large' || err.status === 413)) {
      return res.status(413).json({ error: 'request body too large', limit: TRACING_BODY_LIMIT });
    }
    return next(err);
  });
}

/**
 * Which backend ingestion writes to.
 *
 * Unset → 'local'. Local storage is the product now; the Langfuse Cloud relay is
 * the opt-in legacy path, kept working byte-for-byte for anyone already pointed
 * at it. Any value other than 'langfuse' resolves to 'local' rather than throwing,
 * because a typo in an env var must not take ingestion down.
 */
export function tracingBackend() {
  return String(process.env.CFAI_TRACING_BACKEND || '').toLowerCase() === 'langfuse'
    ? 'langfuse'
    : 'local';
}

// ── Per-project rate limit ───────────────────────────────────────────────────
// A module-level Map token bucket. Same reasoning already applied to the read
// cache in routes/sdk.js: no new dependency, no Redis. KNOWN CAVEAT — the bucket
// is PER PROCESS, so N replicas allow N× this rate. That is acceptable here
// because the monthly event budget in routes/sdk.js is the real cost ceiling and
// it IS shared (it lives in Mongo); this limiter only exists to stop one runaway
// SDK loop from saturating a single process.
const RATE_CAPACITY = 200;        // burst
const RATE_REFILL_PER_SEC = 50;   // sustained
const buckets = new Map();        // project_id → { tokens, lastRefill }

export function _resetTracingRateLimits() {   // test hook
  buckets.clear();
}

export function checkRateLimit(projectId, now = Date.now()) {
  let b = buckets.get(projectId);
  if (!b) {
    b = { tokens: RATE_CAPACITY, lastRefill: now };
    buckets.set(projectId, b);
  }
  const elapsedSec = Math.max(0, (now - b.lastRefill) / 1000);
  b.tokens = Math.min(RATE_CAPACITY, b.tokens + elapsedSec * RATE_REFILL_PER_SEC);
  b.lastRefill = now;

  if (b.tokens < 1) {
    // Whole seconds — Retry-After has no sub-second form.
    return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((1 - b.tokens) / RATE_REFILL_PER_SEC)) };
  }
  b.tokens -= 1;
  return { allowed: true };
}

// ── Ingestion ────────────────────────────────────────────────────────────────

/**
 * Store one batch locally.
 *
 * @returns { status, body } — the Langfuse ingestion envelope
 *          `{ successes: [{id,status}], errors: [{id,status,message}] }`, 200 when
 *          everything landed and 207 when some items did not. That envelope is
 *          what the official SDK's retry logic reads, so it is not ours to
 *          redesign.
 */
export async function ingestLocally(db, project, batch, { now = new Date() } = {}) {
  // The planner needs the CURRENT stored state of every observation the batch
  // touches. Without it the rollup would double-count: Langfuse's SDK sends
  // `generation-create` and then `generation-update` for the same observation, so
  // a blind $inc of each event's tokens counts the same generation twice.
  const ids = observationIdsInBatch(batch);
  const existing = new Map();
  if (ids.length) {
    const rows = await db.collection(OBSERVATIONS)
      .find({ project_id: project.id, id: { $in: ids } })
      // Metadata only — no previews, and certainly no content. These are the
      // fields the planner needs to compute an exact delta and to price a
      // generation whose model arrived in an earlier batch than its usage.
      .project({
        _id: 0, id: 1, trace_id: 1, type: 1, model: 1, level: 1,
        start_time: 1, end_time: 1, usage_details: 1, cost_details: 1, cost_estimated: 1,
      })
      .toArray();
    for (const r of rows) existing.set(r.id, r);
  }

  const plan = planIngestion(batch, { project, existingObservations: existing, now });

  // Lifetime counters on sdk_projects count DOCUMENTS created, not events
  // ingested, so an update to an existing trace must not increment them. The
  // upsert result already answers that — no extra read needed.
  let traces = 0;
  let observations = 0;
  for (const op of plan.operations) {
    const r = await db.collection(op.collection)
      .updateOne(op.filter, op.update, { upsert: op.upsert === true });
    const created = r?.upsertedCount ?? 0;
    if (op.collection === TRACES) traces += created;
    else if (op.collection === OBSERVATIONS) observations += created;
  }

  return {
    status: plan.errors.length ? 207 : 200,
    body: { successes: plan.successes, errors: plan.errors },
    stored: plan.successes.length,
    rejected: plan.rejected,
    traces,
    observations,
  };
}

export { MAX_BATCH_ITEMS };

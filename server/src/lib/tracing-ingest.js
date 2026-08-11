// Local tracing ingestion — the PURE half.
//
// This module turns a batch of Langfuse-protocol ingestion events into a list of
// Mongo operations. It touches no database and no Express object on purpose:
// every interesting rule in this feature (validation, cost estimation, masking,
// out-of-order arrival, rollup arithmetic) lives here and is testable against
// plain fixtures. routes/langfuse-gateway.js does the I/O around it.
//
// WHAT THIS REPLACES. `CFAI_TRACING_BACKEND=langfuse` still relays the batch to
// Langfuse Cloud exactly as before. The default, `local`, stores it here instead.
// The wire protocol on the way in is identical either way, because it is the
// official Langfuse SDK's, and the whole point is that a developer's SDK does not
// know which backend it is talking to.
//
// CONTENT DISCIPLINE. Nothing in this file logs. Input and output text reaches
// two places and no others: a maskSensitive() preview capped at PREVIEW_LIMIT
// characters that lands on the observation/trace document, and — only when the
// project has capture_content: true — the raw value, in its own lf_observation_io
// document, never mixed into the metadata document. That split mirrors
// dlp_events / dlp_content.
//
// THE MONGO RULE THAT SHAPES EVERYTHING BELOW. A single update document may not
// touch the same field path from two operators; Mongo rejects it outright, and
// tests/helpers/fake-db.mjs reproduces that rejection (routes/langfuse-gateway.js
// already had to work around it for the budget rollover). The trace rollup is
// where that bites hardest, so the counter fields on lf_traces
// (observation_count, generation_count, total_tokens, …) appear ONLY in $inc, in
// a rollup update that is a SEPARATE operation from the trace upsert. The trace
// upsert may seed them with $setOnInsert because that is a different update
// document.

import { maskSensitive } from './mask-sensitive.js';
import { findPricing, computeCost } from '../governance/services/pricingUtils.ts';

export const TRACES = 'lf_traces';
export const OBSERVATIONS = 'lf_observations';
export const OBSERVATION_IO = 'lf_observation_io';

// Masked previews are display artefacts, not content. 250 chars is the same cap
// mask-sensitive.js defaults to and the same one the DLP snippet path uses.
export const PREVIEW_LIMIT = 250;

// A batch bigger than this is refused whole. Matches the "cap what a client can
// ask for in one request" style of routes/server-agents.js.
export const MAX_BATCH_ITEMS = 200;

// Default retention, overridable per project via sdk_projects.retention_days.
export const DEFAULT_RETENTION_DAYS = 30;

// A client clock can be wrong; it cannot be wrong by two days into the future
// without something being broken or hostile. Past timestamps are accepted at
// face value (backfill is legitimate) — received_at is always stamped by us, so
// the honest arrival time survives either way.
export const MAX_CLOCK_SKEW_MS = 48 * 60 * 60 * 1000;

// Observation types we store. SPAN / GENERATION / EVENT are the Langfuse core
// three; the rest are types newer Langfuse SDKs emit for agent workloads. They
// are passed through verbatim rather than rejected — an unknown-but-plausible
// type is a forward-compatibility problem, not an attack, and dropping it would
// silently lose the developer's data.
const OBSERVATION_TYPES = new Set([
  'SPAN', 'GENERATION', 'EVENT',
  'AGENT', 'TOOL', 'CHAIN', 'RETRIEVER', 'EMBEDDING', 'GUARDRAIL',
]);

// Event types we deliberately accept-and-drop. Evals/scoring are out of scope for
// this phase, so pretending to store a score would be a lie; erroring the batch
// over one would break an SDK that legitimately sends them alongside traces.
// They are counted in `rejected` instead, and reported back per item.
const IGNORED_EVENT_TYPES = new Set(['score-create', 'score-update']);
const IGNORED_OBSERVATION_TYPES = new Set(['EVALUATOR']);

// Langfuse event type → the collection family it lands in.
const TRACE_EVENTS = new Set(['trace-create', 'trace-update']);
const OBSERVATION_EVENTS = new Set([
  'span-create', 'span-update',
  'generation-create', 'generation-update',
  'event-create', 'event-update',
  'observation-create', 'observation-update',
]);

const LEVELS = ['DEBUG', 'DEFAULT', 'WARNING', 'ERROR'];
// Trace level is the worst level any of its observations reached. Mongo's $max
// on the STRING would order it alphabetically (DEFAULT < ERROR < WARNING), which
// gets the answer wrong, so the accumulator is a rank and the read layer maps it
// back. Same reason lf_traces carries span_start_ms/span_end_ms instead of a
// directly-$set latency_ms: an accumulator that $max/$min can maintain without a
// read-before-write, derived into the documented field at read time.
export function levelRank(level) {
  const idx = LEVELS.indexOf(String(level || '').toUpperCase());
  return idx < 0 ? 1 : idx;                    // unknown → DEFAULT
}
export function levelForRank(rank) {
  return LEVELS[Number.isInteger(rank) && rank >= 0 && rank < LEVELS.length ? rank : 1];
}

export function providerForModel(model) {
  const m = String(model || '').toLowerCase();
  if (m.startsWith('claude-') || m.startsWith('anthropic.')) return 'anthropic';
  if (m.startsWith('gpt-') || m.startsWith('o1') || m.startsWith('o3') || m.startsWith('chatgpt')) return 'openai';
  if (m.startsWith('gemini-') || m.startsWith('text-bison') || m.startsWith('palm-')) return 'google';
  return 'other';
}

function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// ISO-8601 string, or null. Everything time-shaped is stored as an ISO string so
// the {project_id, timestamp:-1} index and the keyset cursor sort identically.
function isoOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function epochOrNull(iso) {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : t;
}

// Free-text of any shape (a string, or the object/array an SDK passes as a
// structured prompt) reduced to a masked, capped preview. JSON.stringify first so
// a structured prompt is masked as text rather than silently previewed as
// "[object Object]".
export function preview(value) {
  if (value === null || value === undefined) return null;
  let text;
  if (typeof value === 'string') text = value;
  else {
    try { text = JSON.stringify(value); } catch { text = String(value); }
  }
  const masked = maskSensitive(text, PREVIEW_LIMIT);
  return masked === '' ? null : masked;
}

/**
 * Cost for one generation.
 *
 * A client-supplied costDetails is trusted verbatim and marked cost_estimated:
 * false — the caller knows its own bill better than a list-price table does. A
 * computed figure is NEVER summed with a supplied one; it only ever fills a gap.
 */
export function costForGeneration({ model, costDetails, usage }) {
  const supplied = isPlainObject(costDetails) ? costDetails : null;
  const suppliedTotal = supplied
    ? num(supplied.total) ?? (num(supplied.input) !== null || num(supplied.output) !== null
      ? (num(supplied.input) || 0) + (num(supplied.output) || 0)
      : null)
    : null;

  if (suppliedTotal !== null) {
    return {
      cost_details: {
        input: num(supplied.input),
        output: num(supplied.output),
        total: suppliedTotal,
      },
      cost_estimated: false,
    };
  }

  const inTok = num(usage?.input) || 0;
  const outTok = num(usage?.output) || 0;
  if (!model || (inTok === 0 && outTok === 0)) {
    return { cost_details: { input: null, output: null, total: null }, cost_estimated: false };
  }

  const provider = providerForModel(model);
  // Only the vendors with a price table can be estimated. Anything else keeps a
  // null cost rather than being priced off an unrelated vendor's rates.
  if (provider === 'other') {
    return { cost_details: { input: null, output: null, total: null }, cost_estimated: false };
  }
  const pricing = findPricing(model, provider);
  const input = computeCost(inTok, 0, pricing);
  const output = computeCost(0, outTok, pricing);
  return {
    cost_details: { input, output, total: input + output },
    cost_estimated: true,
  };
}

// ── Per-event normalisation ──────────────────────────────────────────────────

// Returns undefined — not an object of nulls — when the body carries no usage at
// all. That distinction is load-bearing: Langfuse's protocol sends usage on the
// `-update`, so a `-create` that wrote {input:null,output:null} would be
// harmless, but an `-update` carrying only `output` text would BLANK the usage
// the create had recorded. Absent must mean "leave it alone", never "set to
// nothing".
function usageFromBody(body) {
  const u = isPlainObject(body.usageDetails) ? body.usageDetails
    : isPlainObject(body.usage) ? body.usage
      : null;
  if (!u && body.promptTokens === undefined && body.completionTokens === undefined) return undefined;
  const s = u || {};
  const input = num(s.input) ?? num(s.promptTokens) ?? num(s.input_tokens) ?? num(body.promptTokens);
  const output = num(s.output) ?? num(s.completionTokens) ?? num(s.output_tokens) ?? num(body.completionTokens);
  const total = num(s.total) ?? num(s.totalTokens)
    ?? (input !== null || output !== null ? (input || 0) + (output || 0) : null);
  if (input === null && output === null && total === null) return undefined;
  return {
    input,
    output,
    total,
    cache_read: num(s.cache_read) ?? num(s.cacheRead) ?? num(s.cache_read_input_tokens),
    cache_creation: num(s.cache_creation) ?? num(s.cacheCreation) ?? num(s.cache_creation_input_tokens),
  };
}

function latencyOf(startIso, endIso) {
  const s = epochOrNull(startIso);
  const e = epochOrNull(endIso);
  if (s === null || e === null) return null;
  // A client whose end predates its start gets 0, not a negative duration that
  // would poison every average downstream.
  return Math.max(0, e - s);
}

function observationTypeFor(eventType, body) {
  const explicit = String(body.type || '').toUpperCase();
  if (explicit) return explicit;
  if (eventType.startsWith('span-')) return 'SPAN';
  if (eventType.startsWith('generation-')) return 'GENERATION';
  if (eventType.startsWith('event-')) return 'EVENT';
  // A generic `observation-update` with no explicit type says nothing about the
  // type — guessing SPAN here would silently demote a stored GENERATION.
  return eventType.endsWith('-create') ? 'SPAN' : undefined;
}

// `undefined` when the field is absent, so the caller's definedOnly() drops it.
const orUndef = (v) => (v === undefined ? undefined : v);
const previewOrUndef = (v) => (v === undefined ? undefined : preview(v));

/**
 * Validate and normalise one wire event.
 *
 * Returns { ok:true, kind, doc } or { ok:false, status, message } or
 * { ok:true, kind:'ignored', message }. Never throws — one malformed item must
 * not take the batch with it.
 */
export function normalizeEvent(item, { now = new Date() } = {}) {
  if (!isPlainObject(item)) return { ok: false, status: 400, message: 'event must be an object' };

  const type = String(item.type || '');
  if (!type) return { ok: false, status: 400, message: 'event type is required' };

  const body = item.body;
  if (!isPlainObject(body)) return { ok: false, status: 400, message: 'event body must be an object' };

  if (IGNORED_EVENT_TYPES.has(type)) {
    return { ok: true, kind: 'ignored', message: `event type ${type} is not stored by this backend` };
  }

  // Reject an implausible future timestamp per item, not per batch.
  const stamp = isoOrNull(item.timestamp) ?? isoOrNull(body.timestamp) ?? isoOrNull(body.startTime);
  if (stamp && new Date(stamp).getTime() - now.getTime() > MAX_CLOCK_SKEW_MS) {
    return { ok: false, status: 400, message: 'timestamp is more than 48h in the future' };
  }

  if (TRACE_EVENTS.has(type)) return normalizeTrace(type, body, stamp, now);
  if (OBSERVATION_EVENTS.has(type)) return normalizeObservation(type, body, stamp, now);

  // sdk-log and anything else we do not model. Accepted so the SDK does not
  // retry forever, but reported as not stored.
  return { ok: true, kind: 'ignored', message: `event type ${type} is not stored by this backend` };
}

// EVERY field here is `undefined` when the client did not send it. Langfuse's
// protocol is create-then-update on the same id, and an update body carries only
// the fields that changed — so anything defaulted to null here would blank the
// value the create established. That is exactly the bug the `-update` tests pin.
function normalizeTrace(eventType, body, stamp, now) {
  const id = body.id ? String(body.id) : null;
  if (!id) return { ok: false, status: 400, message: 'trace body requires an id' };

  return {
    ok: true,
    kind: 'trace',
    doc: {
      id,
      // An update's envelope timestamp is when the UPDATE was emitted, not when
      // the trace began; only a create (or an explicit body.timestamp) may set it.
      timestamp: isoOrNull(body.timestamp)
        ?? (eventType === 'trace-create' ? (stamp ?? now.toISOString()) : undefined),
      name: orUndef(body.name),
      user_id: orUndef(body.userId ?? body.user_id),
      session_id: orUndef(body.sessionId ?? body.session_id),
      environment: orUndef(body.environment),
      release: orUndef(body.release),
      version: orUndef(body.version),
      // `cfproj:` is reserved. In the local backend the tenant boundary is the
      // project_id stamped on every document, not the tag, so a spoofed tag
      // cannot cross tenants the way it could through the Langfuse relay — but a
      // trace list rendering someone else's project tag is still a lie, so the
      // prefix is stripped here as well (same rule as
      // langfuse-gateway.js's stampBatch).
      tags: Array.isArray(body.tags)
        ? body.tags.filter((t) => typeof t === 'string' && !/^\s*cfproj:/i.test(t))
        : undefined,
      metadata: isPlainObject(body.metadata) ? body.metadata : undefined,
      public: typeof body.public === 'boolean' ? body.public : undefined,
      input_preview: previewOrUndef(body.input),
      output_preview: previewOrUndef(body.output),
    },
  };
}

function normalizeObservation(eventType, body, stamp, now) {
  const id = body.id ? String(body.id) : null;
  if (!id) return { ok: false, status: 400, message: 'observation body requires an id' };

  const traceId = body.traceId ?? body.trace_id ?? null;
  if (!traceId) return { ok: false, status: 400, message: 'observation body requires a traceId' };

  const obsType = observationTypeFor(eventType, body);
  if (IGNORED_OBSERVATION_TYPES.has(obsType)) {
    return { ok: true, kind: 'ignored', message: `observation type ${obsType} is not stored by this backend` };
  }
  // Unknown types pass through verbatim (see OBSERVATION_TYPES comment); only a
  // type that is not a string at all is a client error.
  if (!/^[A-Z0-9_]{1,32}$/.test(obsType)) {
    return { ok: false, status: 400, message: 'observation type is malformed' };
  }

  // Same rule as normalizeTrace: absent means absent. Only a `-create` may
  // invent a start time from the envelope; an `-update` carrying just an endTime
  // must not overwrite the real start with the moment the update was emitted.
  const startTime = isoOrNull(body.startTime)
    ?? (eventType.endsWith('-create') ? (stamp ?? now.toISOString()) : undefined);

  return {
    ok: true,
    kind: 'observation',
    // Raw input/output ride alongside the doc but are NEVER merged into it — the
    // planner routes them to lf_observation_io, and only if the project opted in.
    raw: { input: body.input, output: body.output },
    // Cost, latency and provider are NOT computed here. They depend on fields
    // that arrive in different events (model on the create, usage and endTime on
    // the update), so they are derived by the planner from the merged state —
    // computing them per-event would price a generation whose model it had not
    // seen yet at nothing.
    supplied_cost: isPlainObject(body.costDetails) ? body.costDetails : undefined,
    doc: {
      id,
      trace_id: String(traceId),
      parent_observation_id: orUndef(body.parentObservationId ?? body.parent_observation_id),
      type: obsType,
      name: orUndef(body.name),
      start_time: startTime,
      end_time: isoOrNull(body.endTime) ?? undefined,
      completion_start_time: isoOrNull(body.completionStartTime) ?? undefined,
      level: body.level === undefined ? undefined : String(body.level).toUpperCase(),
      status_message: orUndef(body.statusMessage ?? body.status_message),
      environment: orUndef(body.environment),
      version: orUndef(body.version),
      metadata: isPlainObject(body.metadata) ? body.metadata : undefined,
      input_preview: previewOrUndef(body.input),
      output_preview: previewOrUndef(body.output),
      model: orUndef(body.model),
      model_parameters: isPlainObject(body.modelParameters) ? body.modelParameters : undefined,
      usage_details: usageFromBody(body),
      prompt_name: orUndef(body.promptName ?? body.prompt_name),
      prompt_version: body.promptVersion === undefined && body.prompt_version === undefined
        ? undefined
        : num(body.promptVersion ?? body.prompt_version),
    },
  };
}

// Undefined means "the client did not send this field" — last-write-wins must not
// overwrite a known value with nothing.
function definedOnly(doc) {
  const out = {};
  for (const [k, v] of Object.entries(doc)) if (v !== undefined) out[k] = v;
  return out;
}

/** Ids of every observation the batch touches — the route pre-loads these. */
export function observationIdsInBatch(batch) {
  const ids = new Set();
  for (const item of Array.isArray(batch) ? batch : []) {
    if (!isPlainObject(item) || !OBSERVATION_EVENTS.has(String(item.type))) continue;
    const id = isPlainObject(item.body) ? item.body.id : null;
    if (id) ids.add(String(id));
  }
  return [...ids];
}

// ── The planner ──────────────────────────────────────────────────────────────

/**
 * Plan the Mongo work for one validated batch.
 *
 * @param batch    the wire `batch` array
 * @param options.project   the sdk_projects doc (id, capture_content, retention_days)
 * @param options.existingObservations  Map<observation id, stored doc> for the ids
 *        already in lf_observations. This is what makes the trace rollup EXACT
 *        instead of approximately-right: Langfuse's SDK sends `generation-create`
 *        and then `generation-update` for the same id, so a rollup that blindly
 *        $inc'd both would double-count every generation's tokens. With the prior
 *        state in hand the planner increments by the DELTA, which is also what
 *        makes a replayed batch idempotent.
 * @param options.now
 *
 * @returns { operations, successes, errors, rejected, traceIds }
 *          `operations` is an ordered list of { collection, filter, update, upsert }
 *          — the caller executes them in order and needs no further knowledge.
 */
export function planIngestion(batch, options = {}) {
  const { project = {}, existingObservations = new Map(), now = new Date() } = options;
  const projectId = project.id ?? null;
  const captureContent = project.capture_content === true;
  const retentionDays = Number.isFinite(Number(project.retention_days))
    ? Number(project.retention_days)
    : DEFAULT_RETENTION_DAYS;
  const expiresAt = new Date(now.getTime() + retentionDays * 86_400_000);
  const receivedAt = now.toISOString();

  const successes = [];
  const errors = [];
  let rejected = 0;

  // Merge every event for the same id inside THIS batch before planning, so a
  // create+update pair that arrived together becomes one upsert and one rollup
  // rather than two of each.
  const traces = new Map();          // trace id → merged doc
  const observations = new Map();    // observation id → { doc, raw }

  for (const item of batch) {
    const eventId = isPlainObject(item) && item.id ? String(item.id) : null;
    const result = normalizeEvent(item, { now });

    if (!result.ok) {
      errors.push({ id: eventId, status: result.status, message: result.message });
      continue;
    }
    if (result.kind === 'ignored') {
      rejected++;
      errors.push({ id: eventId, status: 422, message: result.message });
      continue;
    }

    if (result.kind === 'trace') {
      const prev = traces.get(result.doc.id);
      traces.set(result.doc.id, prev ? { ...prev, ...definedOnly(result.doc) } : result.doc);
    } else {
      const prev = observations.get(result.doc.id);
      observations.set(result.doc.id, prev
        ? {
            doc: { ...prev.doc, ...definedOnly(result.doc) },
            // Raw content follows the same last-write-wins rule as the doc: an
            // update carrying only `output` must not blank the create's `input`.
            raw: {
              input: result.raw.input === undefined ? prev.raw.input : result.raw.input,
              output: result.raw.output === undefined ? prev.raw.output : result.raw.output,
            },
            supplied_cost: result.supplied_cost ?? prev.supplied_cost,
          }
        : result);
    }
    successes.push({ id: eventId, status: 201 });
  }

  const operations = [];
  // Rollup deltas accumulate per trace and are emitted as ONE $inc-only update
  // per trace at the end — see the file header on the $set/$inc restriction.
  const rollups = new Map();

  const rollupFor = (traceId) => {
    if (!rollups.has(traceId)) {
      rollups.set(traceId, {
        inc: {
          observation_count: 0, generation_count: 0,
          total_tokens: 0, input_tokens: 0, output_tokens: 0, total_cost_usd: 0,
        },
        min: {},
        max: {},
      });
    }
    return rollups.get(traceId);
  };

  // 1. Trace upserts.
  for (const [id, doc] of traces) {
    const set = definedOnly({ ...doc, updated_at: receivedAt, received_at: receivedAt, expires_at: expiresAt, stub: false });
    delete set.id;
    operations.push({
      collection: TRACES,
      filter: { project_id: projectId, id },
      upsert: true,
      update: {
        $set: set,
        // Counters live in $setOnInsert here and in $inc in the rollup below.
        // Two different update documents, so no conflict — putting them in one
        // is the exact mistake this comment exists to prevent.
        $setOnInsert: {
          created_at: receivedAt,
          observation_count: 0, generation_count: 0,
          total_tokens: 0, input_tokens: 0, output_tokens: 0,
          total_cost_usd: 0, cost_estimated: false,
          // DEFAULT floor. The rollup's $max raises it; without a seed a trace
          // with no observations at all would have no level_rank and drop out of
          // a level filter entirely.
          level_rank: levelRank('DEFAULT'),
        },
      },
    });
    rollupFor(id);   // ensure the trace's rollup op exists even with no observations
  }

  // 2. Observation upserts + exact rollup deltas.
  for (const [id, { doc, raw, supplied_cost: suppliedCost }] of observations) {
    const prior = existingObservations.get(id) || null;

    // Derive from the MERGED state — this batch's fields where present, the
    // stored document's where not. A `generation-update` carrying usage but no
    // model still gets priced, because the model is on the create.
    const type = doc.type ?? prior?.type ?? 'SPAN';
    doc.type = type;
    const startTime = doc.start_time ?? prior?.start_time ?? null;
    const endTime = doc.end_time ?? prior?.end_time ?? null;
    const latency = latencyOf(startTime, endTime);
    if (latency !== null) doc.latency_ms = latency;

    if (type === 'GENERATION') {
      const model = doc.model ?? prior?.model ?? null;
      const usage = doc.usage_details ?? prior?.usage_details ?? null;
      if (model) doc.provider = providerForModel(model);
      const cost = costForGeneration({ model, costDetails: suppliedCost, usage });
      // Only write a cost once there is one to write, so a create that arrives
      // before its usage does not stamp a confident $0.00 on the document.
      if (cost.cost_details.total !== null) {
        doc.cost_details = cost.cost_details;
        doc.cost_estimated = cost.cost_estimated;
      }
    }

    const set = definedOnly({ ...doc, updated_at: receivedAt, received_at: receivedAt, expires_at: expiresAt });
    delete set.id;

    operations.push({
      collection: OBSERVATIONS,
      filter: { project_id: projectId, id },
      upsert: true,
      update: { $set: set, $setOnInsert: { created_at: receivedAt } },
    });

    if (captureContent && (raw.input !== undefined || raw.output !== undefined)) {
      const io = {};
      if (raw.input !== undefined) io.input = raw.input;
      if (raw.output !== undefined) io.output = raw.output;
      operations.push({
        collection: OBSERVATION_IO,
        filter: { project_id: projectId, observation_id: id },
        upsert: true,
        update: {
          $set: { ...io, expires_at: expiresAt },
          $setOnInsert: { created_at: receivedAt },
        },
      });
    }

    // The rollup increments by the DELTA between the stored state and the new
    // one, never by the raw event. Langfuse sends `generation-create` then
    // `generation-update` for one generation; a blind $inc on each would count
    // its tokens twice, and a replayed batch would double every figure on the
    // dashboard. Delta arithmetic makes both cases exact.
    const r = rollupFor(doc.trace_id ?? prior?.trace_id);
    const wasGeneration = prior?.type === 'GENERATION';
    const isGeneration = type === 'GENERATION';

    r.inc.observation_count += prior ? 0 : 1;
    r.inc.generation_count += (isGeneration ? 1 : 0) - (wasGeneration ? 1 : 0);

    const nextUsage = doc.usage_details ?? prior?.usage_details ?? null;
    const nextIn = num(nextUsage?.input) || 0;
    const nextOut = num(nextUsage?.output) || 0;
    const nextTotal = num(nextUsage?.total) ?? (nextIn + nextOut);
    const prevIn = num(prior?.usage_details?.input) || 0;
    const prevOut = num(prior?.usage_details?.output) || 0;
    const prevTotal = num(prior?.usage_details?.total) ?? (prevIn + prevOut);
    r.inc.input_tokens += nextIn - prevIn;
    r.inc.output_tokens += nextOut - prevOut;
    r.inc.total_tokens += nextTotal - prevTotal;

    const nextCost = num((doc.cost_details ?? prior?.cost_details)?.total) || 0;
    r.inc.total_cost_usd += nextCost - (num(prior?.cost_details?.total) || 0);

    if ((doc.cost_estimated ?? prior?.cost_estimated) === true) r.max.cost_estimated = true;

    const startMs = epochOrNull(startTime);
    const endMs = epochOrNull(endTime) ?? startMs;
    if (startMs !== null) r.min.span_start_ms = Math.min(r.min.span_start_ms ?? startMs, startMs);
    if (endMs !== null) r.max.span_end_ms = Math.max(r.max.span_end_ms ?? endMs, endMs);
    r.max.level_rank = Math.max(r.max.level_rank ?? 0, levelRank(doc.level ?? prior?.level));
  }

  // 3. One rollup update per trace. $inc / $min / $max only, plus a $set that
  //    touches no path any of them do, plus a $setOnInsert that creates the STUB
  //    trace an out-of-order observation implies. The stub carries stub:true so
  //    the later trace-create can fill it in (its $set above clears the flag) and
  //    so a reader can tell "we never saw the trace event" from "the trace had no
  //    name".
  for (const [traceId, r] of rollups) {
    const inc = {};
    for (const [k, v] of Object.entries(r.inc)) if (v !== 0) inc[k] = v;

    const update = { $set: { updated_at: receivedAt, expires_at: expiresAt } };
    if (Object.keys(inc).length) update.$inc = inc;
    if (Object.keys(r.min).length) update.$min = r.min;
    if (Object.keys(r.max).length) update.$max = r.max;
    // Only fields NOT present in $inc/$min/$max may be seeded here. `timestamp`
    // is seeded so a stub still sorts into the trace list; a later trace-create
    // overwrites it with the client's own.
    update.$setOnInsert = {
      created_at: receivedAt,
      received_at: receivedAt,
      stub: true,
      timestamp: receivedAt,
      name: null,
      user_id: null,
      session_id: null,
      input_preview: null,
      output_preview: null,
    };
    // A trace event in the same batch already $sets these; seeding them twice in
    // two separate updates is fine (different update documents), but the trace
    // upsert runs first, so the $setOnInsert here is a no-op in that case.
    operations.push({
      collection: TRACES,
      filter: { project_id: projectId, id: traceId },
      upsert: true,
      update,
    });
  }

  return { operations, successes, errors, rejected, traceIds: [...rollups.keys()] };
}

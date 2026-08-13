// Tracing read API — locally-stored traces and observations.
//
// NAMESPACE. These routes live under /api/v1/tracing/*, NOT /api/v1/traces/*.
// routes/server-agents.js already owns /api/v1/traces, /api/v1/traces/stats and
// /api/v1/traces/:traceId for a completely unrelated thing (pseudo-traces
// synthesised from passive OS-level call interception). The two have nothing to
// do with each other and must not collide.
//
// AUTH. Every route here is open EXCEPT GET /observations/:id/io, which returns
// raw prompt/completion text and requires requireAdminAuth. That split is the
// existing convention in this codebase, not an oversight: connect-ui's apiFetch
// sends no Authorization header, and metadata-only GETs like /api/v1/dlp and
// /api/v1/registry are correspondingly open, while the routes that hand back
// captured content are gated. Metadata here means masked previews and rollups —
// input_preview/output_preview have already been through maskSensitive().
//
// CONTENT. No list route ever returns raw content, not even an authenticated one.
// A list carries `has_io: boolean` and nothing more; the raw value is fetched one
// observation at a time, only when a human explicitly opens it. Same lazy
// fetch-on-demand shape the DLP content drawer uses.

import { a } from '../util.js';
import { requireAdminAuth } from '../auth.js';
import { TRACES, OBSERVATIONS, OBSERVATION_IO, levelForRank } from '../lib/tracing-ingest.js';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

// parent_observation_id is client-supplied and therefore may be circular or
// absurdly deep. Both guards below exist so a malformed chain cannot hang a
// request: the visited set stops a cycle, the cap stops a 100k-deep chain.
const MAX_TREE_DEPTH = 50;

// One trace detail response is bounded too — a runaway agent loop can produce
// tens of thousands of spans and the waterfall renders none of them usefully.
const MAX_TRACE_OBSERVATIONS = 2000;

function clampLimit(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), MAX_LIMIT) : DEFAULT_LIMIT;
}

function isoOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// Keyset pagination on the sort key itself, so page N costs the same as page 1.
// The cursor IS the last row's timestamp. KNOWN LIMITATION, deliberate: rows
// sharing an identical millisecond timestamp can straddle a page boundary and be
// skipped. `_id`-tiebreak keyset needs an $or the storage layer here does not
// need to grow for a 50-row page, and an offset cursor would degrade on exactly
// the large result sets pagination exists for.
function decodeCursor(raw) {
  if (!raw) return null;
  try {
    const decoded = Buffer.from(String(raw), 'base64url').toString('utf8');
    return isoOrNull(decoded);
  } catch {
    return null;
  }
}
function encodeCursor(value) {
  return value ? Buffer.from(String(value), 'utf8').toString('base64url') : null;
}

function timeWindow(from, to) {
  const range = {};
  const f = isoOrNull(from);
  const t = isoOrNull(to);
  if (f) range.$gte = f;
  if (t) range.$lte = t;
  return Object.keys(range).length ? range : null;
}

// The public shape of a trace row. Rollup fields and masked previews only —
// span_start_ms / span_end_ms / level_rank are storage accumulators (they exist
// because Mongo's $min/$max can maintain them without a read-before-write; see
// lib/tracing-ingest.js) and are derived into latency_ms / level here rather than
// leaking out as-is.
function publicTrace(doc) {
  const start = Number(doc.span_start_ms);
  const end = Number(doc.span_end_ms);
  return {
    id: doc.id,
    project_id: doc.project_id,
    timestamp: doc.timestamp ?? null,
    name: doc.name ?? null,
    user_id: doc.user_id ?? null,
    session_id: doc.session_id ?? null,
    environment: doc.environment ?? null,
    release: doc.release ?? null,
    version: doc.version ?? null,
    tags: Array.isArray(doc.tags) ? doc.tags : [],
    metadata: doc.metadata ?? null,
    public: doc.public === true,
    stub: doc.stub === true,
    observation_count: Number(doc.observation_count) || 0,
    generation_count: Number(doc.generation_count) || 0,
    total_tokens: Number(doc.total_tokens) || 0,
    input_tokens: Number(doc.input_tokens) || 0,
    output_tokens: Number(doc.output_tokens) || 0,
    total_cost_usd: Number(doc.total_cost_usd) || 0,
    cost_estimated: doc.cost_estimated === true,
    latency_ms: Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) : null,
    level: levelForRank(doc.level_rank),
    input_preview: doc.input_preview ?? null,
    output_preview: doc.output_preview ?? null,
    created_at: doc.created_at ?? null,
    updated_at: doc.updated_at ?? null,
    received_at: doc.received_at ?? null,
  };
}

function publicObservation(doc, { hasIo = false } = {}) {
  const out = {
    id: doc.id,
    project_id: doc.project_id,
    trace_id: doc.trace_id ?? null,
    parent_observation_id: doc.parent_observation_id ?? null,
    type: doc.type ?? null,
    name: doc.name ?? null,
    start_time: doc.start_time ?? null,
    end_time: doc.end_time ?? null,
    completion_start_time: doc.completion_start_time ?? null,
    latency_ms: Number.isFinite(Number(doc.latency_ms)) ? Number(doc.latency_ms) : null,
    level: doc.level ?? 'DEFAULT',
    status_message: doc.status_message ?? null,
    environment: doc.environment ?? null,
    version: doc.version ?? null,
    metadata: doc.metadata ?? null,
    input_preview: doc.input_preview ?? null,
    output_preview: doc.output_preview ?? null,
    has_io: hasIo === true,
    created_at: doc.created_at ?? null,
    updated_at: doc.updated_at ?? null,
  };
  if (doc.type === 'GENERATION') {
    out.model = doc.model ?? null;
    out.provider = doc.provider ?? null;
    out.model_parameters = doc.model_parameters ?? null;
    out.usage_details = doc.usage_details ?? null;
    out.cost_details = doc.cost_details ?? null;
    out.cost_estimated = doc.cost_estimated === true;
    out.prompt_name = doc.prompt_name ?? null;
    out.prompt_version = doc.prompt_version ?? null;
  }
  return out;
}

export function mountTracing(app, db) {
  const traces = () => db.collection(TRACES);
  const observations = () => db.collection(OBSERVATIONS);
  const io = () => db.collection(OBSERVATION_IO);

  // Which of these observation ids have a raw-content row. One query, so the
  // list route stays O(1) in round trips — the same shape routes/dlp.js uses to
  // fill has_content.
  async function ioFlags(projectId, ids) {
    if (!ids.length) return new Set();
    const rows = await io()
      .find({ project_id: projectId, observation_id: { $in: ids } })
      .project({ _id: 0, observation_id: 1 })
      .toArray();
    return new Set(rows.map((r) => r.observation_id));
  }

  // ── GET /api/v1/tracing/traces ─────────────────────────────────────────────
  app.get('/api/v1/tracing/traces', a(async (req, res) => {
    const { project_id, session_id, user_id, name, tags, level, from, to, cursor } = req.query;
    if (!project_id) return res.status(400).json({ error: 'project_id is required' });

    const limit = clampLimit(req.query.limit);
    const filter = { project_id: String(project_id) };
    if (session_id) filter.session_id = String(session_id);
    if (user_id) filter.user_id = String(user_id);
    if (name) filter.name = String(name);
    // Multikey equality on the array — "traces carrying this tag".
    if (tags) filter.tags = { $in: String(tags).split(',').map((t) => t.trim()).filter(Boolean) };
    if (level) filter.level_rank = { $gte: ['DEBUG', 'DEFAULT', 'WARNING', 'ERROR'].indexOf(String(level).toUpperCase()) };

    const window = timeWindow(from, to);
    const after = decodeCursor(cursor);
    if (window || after) {
      filter.timestamp = { ...(window || {}) };
      // The cursor narrows the window rather than replacing it.
      if (after) filter.timestamp.$lt = after;
    }

    // One extra row answers "is there a next page" without a second count query.
    const rows = await traces()
      .find(filter, { projection: { _id: 0 } })
      .sort({ timestamp: -1 })
      .limit(limit + 1)
      .toArray();

    const page = rows.slice(0, limit);
    const next = rows.length > limit ? encodeCursor(page[page.length - 1]?.timestamp) : null;
    res.json({ traces: page.map(publicTrace), next_cursor: next });
  }));

  // ── GET /api/v1/tracing/traces/:id ─────────────────────────────────────────
  // The waterfall view: the trace plus its observations in start order, each with
  // an offset_ms from the trace's own start and a depth from the parent chain.
  app.get('/api/v1/tracing/traces/:id', a(async (req, res) => {
    const { project_id } = req.query;
    if (!project_id) return res.status(400).json({ error: 'project_id is required' });

    const projectId = String(project_id);
    const trace = await traces().findOne({ project_id: projectId, id: String(req.params.id) });
    if (!trace) return res.status(404).json({ error: 'trace not found' });

    const rows = await observations()
      .find({ project_id: projectId, trace_id: trace.id }, { projection: { _id: 0 } })
      .sort({ start_time: 1 })
      .limit(MAX_TRACE_OBSERVATIONS + 1)
      .toArray();
    const truncated = rows.length > MAX_TRACE_OBSERVATIONS;
    const page = truncated ? rows.slice(0, MAX_TRACE_OBSERVATIONS) : rows;

    const byId = new Map(page.map((o) => [o.id, o]));

    // Depth of one node, with BOTH guards. parent_observation_id comes straight
    // from the client, so `a -> b -> a` and a 10,000-link chain are both things a
    // caller can send; neither may turn a page render into a hang.
    const depthOf = (obs) => {
      const seen = new Set([obs.id]);
      let depth = 0;
      let parentId = obs.parent_observation_id;
      while (parentId && depth < MAX_TREE_DEPTH) {
        if (seen.has(parentId)) return { depth, cycle: true };
        seen.add(parentId);
        const parent = byId.get(parentId);
        if (!parent) break;              // parent is outside this trace — stop, do not error
        depth++;
        parentId = parent.parent_observation_id;
      }
      return { depth, cycle: false, truncated: depth >= MAX_TREE_DEPTH };
    };

    const flags = await ioFlags(projectId, page.map((o) => o.id));

    // The waterfall's zero point: the trace timestamp when we have one, otherwise
    // the earliest observation, so a stub trace still renders.
    const starts = page.map((o) => new Date(o.start_time).getTime()).filter((n) => Number.isFinite(n));
    const traceStart = Number.isFinite(new Date(trace.timestamp).getTime())
      ? new Date(trace.timestamp).getTime()
      : (starts.length ? Math.min(...starts) : null);

    const list = page.map((o) => {
      const { depth, cycle, truncated: deep } = depthOf(o);
      const startMs = new Date(o.start_time).getTime();
      return {
        ...publicObservation(o, { hasIo: flags.has(o.id) }),
        offset_ms: traceStart !== null && Number.isFinite(startMs) ? Math.max(0, startMs - traceStart) : null,
        depth,
        // Surfaced rather than silently flattened: a UI that shows a broken tree
        // as if it were a real one is worse than one that says the data is bad.
        parent_cycle: cycle === true,
        depth_truncated: deep === true,
      };
    });

    res.json({
      trace: publicTrace(trace),
      observations: list,
      truncated,
    });
  }));

  // ── GET /api/v1/tracing/observations ───────────────────────────────────────
  app.get('/api/v1/tracing/observations', a(async (req, res) => {
    const { project_id, type, model, trace_id, from, to, cursor } = req.query;
    if (!project_id) return res.status(400).json({ error: 'project_id is required' });

    const projectId = String(project_id);
    const limit = clampLimit(req.query.limit);
    const filter = { project_id: projectId };
    if (type) filter.type = String(type).toUpperCase();
    if (model) filter.model = String(model);
    if (trace_id) filter.trace_id = String(trace_id);

    const window = timeWindow(from, to);
    const after = decodeCursor(cursor);
    if (window || after) {
      filter.start_time = { ...(window || {}) };
      if (after) filter.start_time.$lt = after;
    }

    const rows = await observations()
      .find(filter, { projection: { _id: 0 } })
      .sort({ start_time: -1 })
      .limit(limit + 1)
      .toArray();

    const page = rows.slice(0, limit);
    const flags = await ioFlags(projectId, page.map((o) => o.id));
    const next = rows.length > limit ? encodeCursor(page[page.length - 1]?.start_time) : null;

    res.json({
      observations: page.map((o) => publicObservation(o, { hasIo: flags.has(o.id) })),
      next_cursor: next,
    });
  }));

  // ── GET /api/v1/tracing/observations/:id/io ────────────────────────────────
  // The ONE route in this file that returns raw, unmasked prompt/completion text,
  // and therefore the one that is admin-gated. Content only exists here at all
  // when the project was created with capture_content: true.
  app.get('/api/v1/tracing/observations/:id/io', requireAdminAuth, a(async (req, res) => {
    const { project_id } = req.query;
    if (!project_id) return res.status(400).json({ error: 'project_id is required' });

    const row = await io().findOne(
      { project_id: String(project_id), observation_id: String(req.params.id) },
      { projection: { _id: 0, input: 1, output: 1, created_at: 1 } },
    );
    if (!row) return res.status(404).json({ error: 'no content captured for this observation' });

    res.json({
      observation_id: String(req.params.id),
      input: row.input ?? null,
      output: row.output ?? null,
      created_at: row.created_at ?? null,
    });
  }));
}

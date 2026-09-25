import { a } from '../util.js';
import { attachMachineIdentity } from '../lib/machine-identity.js';
import {
  RESPONSE_BUDGET_MS, raceWithFallback, applyBudgetHeaders, registerResponseWarmer,
} from '../lib/response-budget.js';

// One clamp for every list route, matching routes/dlp.js: a page size is at
// least 1, at most 2000, and a non-numeric value falls back to the route's own
// default rather than becoming NaN.
function clampLimit(value, fallback) {
  return Math.min(Math.max(Number(value) || fallback, 1), 2000);
}

export function mountQueries(app, db) {
  const OVERVIEW_ROUTE = 'overview';
  const MACHINES_ROUTE = 'machines';
  const FINDINGS_ROUTE = 'findings';

  // Every read below is bounded by the shared response budget
  // (lib/response-budget.js): live if the query finishes inside it, otherwise
  // this route's own last real answer with X-Response-Stale and the time it was
  // captured. Nothing is ever synthesized, and a key with nothing captured yet
  // waits the real query out rather than 503ing.
  app.get('/api/v1/overview', a(async (req, res) => {
    const result = await raceWithFallback({
      route: OVERVIEW_ROUTE, params: null, budgetMs: RESPONSE_BUDGET_MS,
      live: () => fetchOverview(db),
    });
    if (result.failed) throw result.error;   // unchanged: a real failure is still a 500
    applyBudgetHeaders(res, result);
    res.json(result.value);
  }));

  app.get('/api/v1/machines', a(async (req, res) => {
    const result = await raceWithFallback({
      route: MACHINES_ROUTE, params: null, budgetMs: RESPONSE_BUDGET_MS,
      live: () => fetchMachines(db),
    });
    if (result.failed) throw result.error;
    applyBudgetHeaders(res, result);
    res.json(result.value);
  }));

  app.get('/api/v1/machines/:id', a(async (req, res) => {
    const m = await db.collection('machines').findOne({ id: req.params.id });
    if (!m) return res.status(404).json({ error: 'machine not found' });

    const recentScans = await db.collection('scans')
      .find({ machine_id: req.params.id })
      .sort({ received_at: -1 })
      .limit(20)
      .project({ _id: 0, id: 1, started_at: 1, finished_at: 1, duration_ms: 1, findings_count: 1, errors_count: 1, received_at: 1 })
      .toArray();

    // Get latest scan id for this machine
    const latestScan = await db.collection('scans')
      .find({ machine_id: req.params.id })
      .sort({ received_at: -1 })
      .limit(1)
      .toArray();
    const latestScanId = latestScan[0]?.id ?? null;

    let findings = [];
    if (latestScanId) {
      const findingsRaw = await db.collection('findings')
        .find({ machine_id: req.params.id, scan_id: latestScanId })
        .sort({ detector: 1, type: 1 })
        .project({ _id: 0, id: 1, detector: 1, type: 1, vendor: 1, product: 1, provider: 1, tool_key: 1, risk_score: 1, payload_json: 1, detected_at: 1 })
        .toArray();
      findings = findingsRaw.map(parsePayload);
    }

    // Strip MongoDB _id from machine
    const { _id, ...machineClean } = m;
    res.json({ machine: machineClean, recentScans, latestFindings: findings });
  }));

  app.get('/api/v1/findings', a(async (req, res) => {
    const { type, vendor, product, machineId, toolKey, latestOnly, limit = 500 } = req.query;

    // EVERY FILTER VALUE IS COERCED WITH String(), which is the defence
    // /api/v1/dlp already applies and this route did not. Express's default
    // extended query parser turns `?type[$ne]=x` into an OBJECT, and an object
    // landing in the filter verbatim is evaluated as a query OPERATOR: on /dlp
    // that trick returned every event instead of none, and the same shape on
    // `machineId` here defeated per-machine scoping. String() collapses it to
    // harmless text, so a filter can only ever mean equality.
    const filter = {};
    if (type)      filter.type       = String(type);
    if (vendor)    filter.vendor     = String(vendor);
    if (product)   filter.product    = String(product);
    if (machineId) filter.machine_id = String(machineId);
    if (toolKey)   filter.tool_key   = String(toolKey);

    // CLAMPED, AND NaN-GUARDED. This was a bare `.limit(Number(limit))`: no
    // server-side ceiling at all, so a single request could pull the whole
    // collection, and `?limit=abc` produced NaN — not a page size any driver
    // will accept.
    const lim = clampLimit(limit, 500);
    const latest = latestOnly === 'true' || latestOnly === '1';

    const result = await raceWithFallback({
      route: FINDINGS_ROUTE,
      // The helper builds the key from the route name plus these filters, so
      // two different views can never be served each other's rows.
      params: { filter, lim, latest },
      budgetMs: RESPONSE_BUDGET_MS,
      live: () => fetchFindings(db, filter, lim, latest),
    });
    if (result.failed) throw result.error;
    applyBudgetHeaders(res, result);
    res.json(result.value);
  }));

  app.get('/api/v1/tools', a(async (req, res) => {
    // Two sources for the catalog:
    //   findings    - scanner-detected installed AI tools
    //   tool_usage  - runtime web-tool usage captured by the LLM classifier flow
    // We combine them into one virtual table keyed by tool_key.

    // Aggregate from findings
    const findingsAgg = await db.collection('findings').aggregate([
      {
        $group: {
          _id: '$tool_key',
          vendor: { $max: '$vendor' },
          product: { $max: '$product' },
          machines: { $addToSet: '$machine_id' },
          count_value: { $sum: 1 },
          risk_score: { $max: '$risk_score' },
        },
      },
    ]).toArray();

    // Aggregate from tool_usage
    const usageAgg = await db.collection('tool_usage').aggregate([
      {
        $group: {
          _id: '$tool_key',
          vendor: { $max: '$vendor' },
          product: { $max: '$product' },
          machines: { $addToSet: '$machine_id' },
          count_value: { $sum: '$hit_count' },
          risk_score: { $max: null },
        },
      },
    ]).toArray();

    // Merge both sources by tool_key
    const toolMap = new Map();
    for (const r of findingsAgg) {
      toolMap.set(r._id, {
        tool_key: r._id,
        vendor: r.vendor,
        product: r.product,
        machineSet: new Set(r.machines),
        count_value: r.count_value,
        risk_score: r.risk_score,
      });
    }
    for (const r of usageAgg) {
      const existing = toolMap.get(r._id);
      if (existing) {
        for (const m of r.machines) existing.machineSet.add(m);
        existing.count_value += r.count_value;
        existing.vendor = existing.vendor || r.vendor;
        existing.product = existing.product || r.product;
      } else {
        toolMap.set(r._id, {
          tool_key: r._id,
          vendor: r.vendor,
          product: r.product,
          machineSet: new Set(r.machines),
          count_value: r.count_value,
          risk_score: r.risk_score,
        });
      }
    }

    // Left-join with sanctions
    const sanctionsList = await db.collection('sanctions').find({}).toArray();
    const sanctionMap = new Map();
    for (const s of sanctionsList) sanctionMap.set(s.tool_key, s);

    const rows = [...toolMap.values()].map((t) => {
      const s = sanctionMap.get(t.tool_key);
      return {
        tool_key: t.tool_key,
        vendor: t.vendor,
        product: t.product,
        machines: t.machineSet.size,
        findings: t.count_value,
        risk_score: t.risk_score,
        sanction: s?.status ?? 'unknown',
        notes: s?.notes ?? null,
        owner: s?.owner ?? null,
      };
    });
    rows.sort((a, b) => (b.machines - a.machines) || (b.findings - a.findings));

    // Evidence types - from findings + tool_usage
    const findingsEv = await db.collection('findings').aggregate([
      { $group: { _id: { tool_key: '$tool_key', type: '$type' } } },
    ]).toArray();
    const usageEv = await db.collection('tool_usage').aggregate([
      { $project: { tool_key: 1, type: { $concat: ['web_usage:', '$source'] } } },
      { $group: { _id: { tool_key: '$tool_key', type: '$type' } } },
    ]).toArray();

    const evidenceMap = new Map();
    for (const r of findingsEv) {
      const tk = r._id.tool_key;
      if (!evidenceMap.has(tk)) evidenceMap.set(tk, []);
      evidenceMap.get(tk).push(r._id.type);
    }
    for (const r of usageEv) {
      const tk = r._id.tool_key;
      if (!evidenceMap.has(tk)) evidenceMap.set(tk, []);
      evidenceMap.get(tk).push(r._id.type);
    }
    for (const r of rows) r.evidence_types = evidenceMap.get(r.tool_key) || [];

    res.json(rows);
  }));

  app.get('/api/v1/tools/:key', a(async (req, res) => {
    const key = req.params.key;

    // Aggregate from findings + tool_usage for this key
    const findingsAgg = await db.collection('findings').aggregate([
      { $match: { tool_key: key } },
      {
        $group: {
          _id: '$tool_key',
          vendor: { $max: '$vendor' },
          product: { $max: '$product' },
          machines: { $addToSet: '$machine_id' },
          count_value: { $sum: 1 },
          risk_score: { $max: '$risk_score' },
        },
      },
    ]).toArray();

    const usageAgg = await db.collection('tool_usage').aggregate([
      { $match: { tool_key: key } },
      {
        $group: {
          _id: '$tool_key',
          vendor: { $max: '$vendor' },
          product: { $max: '$product' },
          machines: { $addToSet: '$machine_id' },
          count_value: { $sum: '$hit_count' },
          risk_score: { $max: null },
        },
      },
    ]).toArray();

    const machineSet = new Set();
    let vendor = null, product = null, countValue = 0, riskScore = null;
    for (const r of findingsAgg) {
      vendor = r.vendor; product = r.product;
      for (const m of r.machines) machineSet.add(m);
      countValue += r.count_value;
      riskScore = r.risk_score;
    }
    for (const r of usageAgg) {
      vendor = vendor || r.vendor; product = product || r.product;
      for (const m of r.machines) machineSet.add(m);
      countValue += r.count_value;
    }

    if (machineSet.size === 0) return res.status(404).json({ error: 'tool not found' });

    const sanction = await db.collection('sanctions').findOne({ tool_key: key });

    const tool = {
      tool_key: key,
      vendor,
      product,
      machines: machineSet.size,
      findings: countValue,
      risk_score: riskScore,
      sanction: sanction?.status ?? 'unknown',
      notes: sanction?.notes ?? null,
      owner: sanction?.owner ?? null,
    };

    // Per-machine evidence from findings
    const findingsEvidence = await db.collection('findings')
      .find({ tool_key: key })
      .project({ _id: 0, machine_id: 1, type: 1, detector: 1, payload_json: 1 })
      .toArray();

    // Per-machine evidence from tool_usage
    const usageEvidence = await db.collection('tool_usage')
      .find({ tool_key: key })
      .project({ _id: 0, machine_id: 1, host: 1, vendor: 1, category: 1, sandbox: 1, confidence: 1, first_used_at: 1, last_used_at: 1, hit_count: 1, source: 1 })
      .toArray();

    // Get machines for joining
    const machineIds = [...machineSet];
    const machinesDocs = await db.collection('machines')
      .find({ id: { $in: machineIds } })
      .project({ _id: 0, id: 1, hostname: 1, user: 1 })
      .toArray();
    const machineMap = new Map();
    for (const m of machinesDocs) machineMap.set(m.id, m);

    const usagesByMachine = new Map();
    for (const r of findingsEvidence) {
      const mach = machineMap.get(r.machine_id);
      if (!mach) continue;
      if (!usagesByMachine.has(r.machine_id)) {
        usagesByMachine.set(r.machine_id, {
          machine_id: r.machine_id, hostname: mach.hostname, user: mach.user, evidence: [],
        });
      }
      usagesByMachine.get(r.machine_id).evidence.push({
        type: r.type, detector: r.detector, payload: safeJson(r.payload_json),
      });
    }
    for (const r of usageEvidence) {
      const mach = machineMap.get(r.machine_id);
      if (!mach) continue;
      if (!usagesByMachine.has(r.machine_id)) {
        usagesByMachine.set(r.machine_id, {
          machine_id: r.machine_id, hostname: mach.hostname, user: mach.user, evidence: [],
        });
      }
      usagesByMachine.get(r.machine_id).evidence.push({
        type: 'web_usage',
        detector: r.source,
        payload: {
          host: r.host, vendor: r.vendor, category: r.category,
          sandbox: r.sandbox, confidence: r.confidence,
          first_used_at: r.first_used_at, last_used_at: r.last_used_at,
          hit_count: r.hit_count,
        },
      });
    }

    res.json({ tool, usages: [...usagesByMachine.values()] });
  }));

  app.get('/api/v1/shadow', a(async (req, res) => {
    const rows = await db.collection('findings').aggregate([
      {
        $group: {
          _id: '$tool_key',
          vendor: { $max: '$vendor' },
          product: { $max: '$product' },
          machines: { $addToSet: '$machine_id' },
          findings: { $sum: 1 },
          risk_score: { $max: '$risk_score' },
        },
      },
      {
        $lookup: {
          from: 'sanctions',
          localField: '_id',
          foreignField: 'tool_key',
          as: 'sanction_doc',
        },
      },
      { $unwind: { path: '$sanction_doc', preserveNullAndEmptyArrays: true } },
      {
        $addFields: {
          sanction: { $ifNull: ['$sanction_doc.status', 'unknown'] },
        },
      },
      { $match: { sanction: { $ne: 'approved' } } },
      {
        $project: {
          _id: 0,
          tool_key: '$_id',
          vendor: 1,
          product: 1,
          machines: { $size: '$machines' },
          findings: 1,
          risk_score: 1,
          sanction: 1,
        },
      },
      { $sort: { machines: -1 } },
    ]).toArray();
    res.json(rows);
  }));

  // Boot-time warming, each with the route's default (no-filter) parameters.
  // Off the request path, failures logged and swallowed by warmResponseStore —
  // so the first request after a deploy has a real fallback to serve instead of
  // being the one request that has to wait a cold query out.
  registerResponseWarmer(OVERVIEW_ROUTE, () => raceWithFallback({
    route: OVERVIEW_ROUTE, params: null, budgetMs: RESPONSE_BUDGET_MS, live: () => fetchOverview(db),
  }));
  registerResponseWarmer(MACHINES_ROUTE, () => raceWithFallback({
    route: MACHINES_ROUTE, params: null, budgetMs: RESPONSE_BUDGET_MS, live: () => fetchMachines(db),
  }));
  registerResponseWarmer(FINDINGS_ROUTE, () => raceWithFallback({
    route: FINDINGS_ROUTE, params: { filter: {}, lim: 500, latest: false },
    budgetMs: RESPONSE_BUDGET_MS, live: () => fetchFindings(db, {}, 500, false),
  }));
}

// The work behind GET /api/v1/overview, pulled out of the handler so the route
// can race it against the budget and the boot warmer can run the same read —
// one definition, so a warmed body can never differ in shape from a served one.
async function fetchOverview(db) {
  // ALL SIX READS IN PARALLEL — none of them feeds another.
  //
  // Same fix, for the same reason, as /api/v1/machines below: the cost here is
  // latency, not data. Six sequential round trips against Atlas is six times
  // the round-trip time before the first byte of the response, and this is the
  // first call the Overview tab makes, so those seconds were the tab's load
  // time. /machines went from 11.8s to 272ms on exactly this change.
  const [machines, scans, findingsCount, uniqueToolKeys, byType, topTools] = await Promise.all([
    // Count only real desktop agents — machines with a real OS user and platform.
    // Browser extensions, CLI sessions, test data, trackers and demo seeds are
    // excluded. This is the "employees with the agent installed" number.
    db.collection('machines').countDocuments({
      user: { $exists: true, $ne: null },
      platform: { $exists: true, $ne: null },
      hostname: { $not: /browser-extension|Claude Code CLI/i },
    }),
    db.collection('scans').countDocuments(),
    db.collection('findings').countDocuments(),
    db.collection('findings').distinct('tool_key'),

    db.collection('findings').aggregate([
      { $group: { _id: '$type', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $project: { _id: 0, type: '$_id', count: 1 } },
    ]).toArray(),

    // topTools: group findings by tool_key, left-join with sanctions
    db.collection('findings').aggregate([
      {
        $group: {
          _id: '$tool_key',
          vendor: { $max: '$vendor' },
          product: { $max: '$product' },
          machines: { $addToSet: '$machine_id' },
          findings: { $sum: 1 },
          risk_score: { $max: '$risk_score' },
        },
      },
      {
        $lookup: {
          from: 'sanctions',
          localField: '_id',
          foreignField: 'tool_key',
          as: 'sanction_doc',
        },
      },
      { $unwind: { path: '$sanction_doc', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: 0,
          tool_key: '$_id',
          vendor: 1,
          product: 1,
          machines: { $size: '$machines' },
          findings: 1,
          risk_score: 1,
          sanction: { $ifNull: ['$sanction_doc.status', 'unknown'] },
        },
      },
      { $sort: { machines: -1, findings: -1 } },
      { $limit: 50 },
    ]).toArray(),
  ]);

  return {
    totals: { machines, scans, findings: findingsCount, unique_tools: uniqueToolKeys.length },
    byType,
    topTools,
  };
}

// The work behind GET /api/v1/machines.
async function fetchMachines(db) {
  // EVERY enrolled machine, agent or browser extension.
  //
  // This used to filter { platform: { $ne: null } } to mean "endpoint agents
  // only". In Mongo that predicate also excludes documents where `platform` is
  // simply ABSENT, and a browser-extension enrollment never reports one — so
  // every extension-enrolled machine was missing from the roster the UI joins
  // session/event rows against, and an extension-only session rendered as a raw
  // machine UUID with no readable label anywhere to fall back to.
  //
  // The rows below already carry `user` (agent-reported username), `hostname`
  // (the extension sets '<browser>-browser-extension' at enroll time) and `id`,
  // which is exactly the label precedence the UI wants: user → hostname → id.
  // `platform` is passed through as-is, so a caller that genuinely wants agents
  // only can still tell them apart.
  const machinesList = await db.collection('machines')
    .find({})
    .sort({ last_seen: -1 })
    .toArray();

  // Per-machine counts come from TWO aggregations, not three queries per machine.
  //
  // This loop used to run countDocuments + distinct + a scans lookup inside the
  // per-machine loop: 47 enrolled machines meant 141 sequential round trips, and
  // the endpoint took 11.8s measured against the real cluster (272ms this way).
  // It is latency, not data — the collections are small. The Agents & MCP tab
  // Promise.all's this endpoint, so those seconds were the tab's entire load time.
  //
  // The findings pipeline groups twice on purpose. Grouping by
  // {machine_id, tool_key} first and then counting those groups reproduces
  // `distinct('tool_key')` exactly — including a null tool_key counting as one
  // distinct value, which is what distinct() returns — without building an array
  // of every tool key per machine inside the $group.
  const [findingStats, scanStats] = await Promise.all([
    db.collection('findings').aggregate([
      { $group: { _id: { machine_id: '$machine_id', tool_key: '$tool_key' }, n: { $sum: 1 } } },
      { $group: { _id: '$_id.machine_id', findings_count: { $sum: '$n' }, unique_tools: { $sum: 1 } } },
    ]).toArray(),
    db.collection('scans').aggregate([
      { $group: { _id: '$machine_id', last_scan_at: { $max: '$received_at' } } },
    ]).toArray(),
  ]);
  const findingsBy = new Map(findingStats.map((f) => [f._id, f]));
  const lastScanBy = new Map(scanStats.map((s) => [s._id, s.last_scan_at]));

  // A machine with no findings and no scans is normal — most enrolments are
  // browser extensions or CLI sessions, which never run a scan — so a missing
  // group means zero, not a dropped row.
  return machinesList.map((m) => ({
    id: m.id,
    hostname: m.hostname,
    user: m.user,
    platform: m.platform,
    os_release: m.os_release,
    first_seen: m.first_seen,
    last_seen: m.last_seen,
    findings_count: findingsBy.get(m.id)?.findings_count ?? 0,
    unique_tools: findingsBy.get(m.id)?.unique_tools ?? 0,
    last_scan_at: lastScanBy.get(m.id) ?? null,
  }));
}

// The work behind GET /api/v1/findings. `filter` is already String()-coerced and
// `lim` already clamped by the route.
async function fetchFindings(db, filter, lim, latestOnly) {
  const query = { ...filter };

  // latestOnly=true -> restrict to findings from each machine's most recent scan.
  // This one IS a real data dependency — the scan ids have to be known before
  // the findings query can be built — so it stays sequential.
  if (latestOnly) {
    // Get max scan id per machine
    const latestScans = await db.collection('scans').aggregate([
      { $sort: { received_at: -1 } },
      { $group: { _id: '$machine_id', latest_scan_id: { $first: '$id' } } },
    ]).toArray();
    const latestScanIds = latestScans.map((s) => s.latest_scan_id);
    query.scan_id = { $in: latestScanIds };
  }

  const rows = await db.collection('findings')
    .find(query)
    .sort({ detected_at: -1 })
    .limit(lim)
    .project({ _id: 0, id: 1, scan_id: 1, machine_id: 1, detector: 1, type: 1, vendor: 1, product: 1, provider: 1, tool_key: 1, risk_score: 1, payload_json: 1, detected_at: 1 })
    .toArray();

  await attachMachineIdentity(db, rows);
  return rows.map(parsePayload);
}

function parsePayload(row) {
  return { ...row, payload: safeJson(row.payload_json) };
}

function safeJson(s) {
  if (s == null) return null;
  if (typeof s === 'object') return s;  // already parsed
  try { return JSON.parse(s); } catch { return null; }
}

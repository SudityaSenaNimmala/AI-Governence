import { a } from '../util.js';

export function mountQueries(app, db) {
  app.get('/api/v1/overview', a(async (req, res) => {
    const machines = await db.collection('machines').countDocuments({ platform: { $ne: null } });
    const scans = await db.collection('scans').countDocuments();
    const findingsCount = await db.collection('findings').countDocuments();
    const uniqueToolKeys = await db.collection('findings').distinct('tool_key');

    const byType = await db.collection('findings').aggregate([
      { $group: { _id: '$type', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $project: { _id: 0, type: '$_id', count: 1 } },
    ]).toArray();

    // topTools: group findings by tool_key, left-join with sanctions
    const topTools = await db.collection('findings').aggregate([
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
    ]).toArray();

    res.json({
      totals: { machines, scans, findings: findingsCount, unique_tools: uniqueToolKeys.length },
      byType,
      topTools,
    });
  }));

  app.get('/api/v1/machines', a(async (req, res) => {
    // Only endpoint-agent machines (platform IS NOT NULL).
    const machinesList = await db.collection('machines')
      .find({ platform: { $ne: null } })
      .sort({ last_seen: -1 })
      .toArray();

    const rows = [];
    for (const m of machinesList) {
      const findings_count = await db.collection('findings').countDocuments({ machine_id: m.id });
      const uniqueTools = await db.collection('findings').distinct('tool_key', { machine_id: m.id });
      const lastScan = await db.collection('scans')
        .find({ machine_id: m.id })
        .sort({ received_at: -1 })
        .limit(1)
        .toArray();

      rows.push({
        id: m.id,
        hostname: m.hostname,
        user: m.user,
        platform: m.platform,
        os_release: m.os_release,
        first_seen: m.first_seen,
        last_seen: m.last_seen,
        findings_count,
        unique_tools: uniqueTools.length,
        last_scan_at: lastScan[0]?.received_at ?? null,
      });
    }
    res.json(rows);
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
    const filter = {};
    if (type) filter.type = type;
    if (vendor) filter.vendor = vendor;
    if (product) filter.product = product;
    if (machineId) filter.machine_id = machineId;
    if (toolKey) filter.tool_key = toolKey;

    // latestOnly=true -> restrict to findings from each machine's most recent scan.
    if (latestOnly === 'true' || latestOnly === '1') {
      // Get max scan id per machine
      const latestScans = await db.collection('scans').aggregate([
        { $sort: { received_at: -1 } },
        { $group: { _id: '$machine_id', latest_scan_id: { $first: '$id' } } },
      ]).toArray();
      const latestScanIds = latestScans.map((s) => s.latest_scan_id);
      filter.scan_id = { $in: latestScanIds };
    }

    const rows = await db.collection('findings')
      .find(filter)
      .sort({ detected_at: -1 })
      .limit(Number(limit))
      .project({ _id: 0, id: 1, scan_id: 1, machine_id: 1, detector: 1, type: 1, vendor: 1, product: 1, provider: 1, tool_key: 1, risk_score: 1, payload_json: 1, detected_at: 1 })
      .toArray();

    res.json(rows.map(parsePayload));
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
}

function parsePayload(row) {
  return { ...row, payload: safeJson(row.payload_json) };
}

function safeJson(s) {
  if (s == null) return null;
  if (typeof s === 'object') return s;  // already parsed
  try { return JSON.parse(s); } catch { return null; }
}

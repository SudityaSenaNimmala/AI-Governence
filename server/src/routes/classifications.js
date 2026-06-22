// LLM host-classification routes.
//
// POST /api/v1/classify-host
// GET  /api/v1/classifications
// POST /api/v1/classifications/:host/override
// POST /api/v1/classifications/:host/override/clear
// POST /api/v1/known-ai-tool

import { a } from '../util.js';
import { requireMachineAuth } from '../auth.js';
import { classifyHost } from '../lib/ai-classifier.js';

// TTL — sites add AI features over time, so re-classify every ~30 days.
const TTL_DAYS = 30;
const CONFIDENCE_THRESHOLD = Number(process.env.CFAI_CLASSIFIER_THRESHOLD) || 0.85;

export function mountClassifications(app, db, log) {
  // POST /api/v1/classify-host
  app.post('/api/v1/classify-host', requireMachineAuth, a(async (req, res) => {
    const host = normalizeHost(req.body?.host);
    if (!host) return res.status(400).json({ error: 'host required' });
    const signals = (req.body?.signals && typeof req.body.signals === 'object') ? req.body.signals : {};

    // 0. Check ai_platforms registry first.
    const platform = await findPlatformForHost(db, host);
    if (platform) {
      await recordToolUsage(db, req.machine.id, host, {
        is_ai: 1,
        vendor: platform.vendor,
        category: platform.category,
        sandbox: platform.sandbox,
        confidence: 0.98,
        override_is_ai: null,
      });
      return res.json({
        host,
        is_ai:          true,
        should_govern:  !!platform.governed,
        confidence:     0.98,
        classifier:     'registry:ai_platforms',
        reasoning:      `matched ${platform.host} in ai_platforms registry (governed=${platform.governed})`,
        vendor:         platform.vendor         || null,
        product:        platform.product        || null,
        category:       platform.category       || null,
        sandbox:        platform.sandbox        || null,
        governance_note: platform.governance_note || null,
        from_cache:     false,
        threshold:      CONFIDENCE_THRESHOLD,
      });
    }

    // 1. Cache check.
    const existing = await db.collection('runtime_classifications').findOne({ host });
    const now = new Date();
    let fresh = null;

    if (existing) {
      // Bump usage stats regardless of whether we re-classify.
      await db.collection('runtime_classifications').updateOne(
        { host },
        { $inc: { hits: 1 }, $set: { last_hit_at: now } },
      );
      // Record per-machine tool usage
      await recordToolUsage(db, req.machine.id, host, existing);

      const expired = existing.expires_at && new Date(existing.expires_at) <= now;
      // If admin has overridden, NEVER re-classify automatically.
      if (existing.override_is_ai != null) {
        return res.json(rowToVerdict(existing, { fromCache: true, threshold: CONFIDENCE_THRESHOLD }));
      }
      if (!expired) {
        return res.json(rowToVerdict(existing, { fromCache: true, threshold: CONFIDENCE_THRESHOLD }));
      }
      // Expired -> fall through to re-classify.
      log?.info?.(`classify-host: ${host} cache expired, re-classifying`);
    }

    // 2. Cache miss (or expired): call classifier.
    fresh = await classifyHost({ host, signals, log: log?.child?.('classifier') ?? log });
    const expiresAt = new Date(now.getTime() + TTL_DAYS * 24 * 3600 * 1000);

    // 3. Upsert.
    if (existing) {
      await db.collection('runtime_classifications').updateOne(
        { host },
        {
          $set: {
            is_ai: fresh.is_ai ? 1 : 0,
            confidence: fresh.confidence,
            vendor: fresh.vendor,
            category: fresh.category,
            sandbox: fresh.sandbox,
            governance_note: fresh.governance_note,
            classifier: fresh.classifier,
            classified_at: now,
            signals_json: JSON.stringify(signals),
            reasoning: fresh.reasoning,
            expires_at: expiresAt,
            last_hit_at: now,
          },
          $inc: { hits: 1 },
        },
      );
    } else {
      await db.collection('runtime_classifications').insertOne({
        host,
        is_ai: fresh.is_ai ? 1 : 0,
        confidence: fresh.confidence,
        vendor: fresh.vendor,
        category: fresh.category,
        sandbox: fresh.sandbox,
        governance_note: fresh.governance_note,
        classifier: fresh.classifier,
        signals_json: JSON.stringify(signals),
        reasoning: fresh.reasoning,
        expires_at: expiresAt,
        classified_at: now,
        hits: 1,
        last_hit_at: now,
        override_is_ai: null,
        override_by: null,
        override_at: null,
        override_reason: null,
      });
    }

    // 4. Audit log.
    await db.collection('classification_audit').insertOne({
      host,
      event: 'classified',
      is_ai: fresh.is_ai ? 1 : 0,
      confidence: fresh.confidence,
      classifier: fresh.classifier,
      actor: 'system',
      details_json: JSON.stringify({ reasoning: fresh.reasoning, vendor: fresh.vendor, category: fresh.category }),
      created_at: now,
    });

    // 5. Tool-usage tracking.
    await recordToolUsage(db, req.machine.id, host, {
      is_ai:           fresh.is_ai ? 1 : 0,
      vendor:          fresh.vendor,
      category:        fresh.category,
      sandbox:         fresh.sandbox,
      confidence:      fresh.confidence,
      override_is_ai:  null,
    });

    res.json({
      ...fresh,
      host,
      should_govern: fresh.is_ai && fresh.confidence >= CONFIDENCE_THRESHOLD,
      threshold:     CONFIDENCE_THRESHOLD,
      from_cache:    false,
    });
  }));

  // GET /api/v1/classifications
  app.get('/api/v1/classifications', a(async (req, res) => {
    const filter = {};
    if (req.query.is_ai === '1') filter.is_ai = 1;
    else if (req.query.is_ai === '0') filter.is_ai = 0;
    if (req.query.classifier) filter.classifier = req.query.classifier;

    const rows = await db.collection('runtime_classifications')
      .find(filter)
      .sort({ last_hit_at: -1 })
      .limit(500)
      .project({
        _id: 0, host: 1, is_ai: 1, confidence: 1, vendor: 1, category: 1, sandbox: 1, governance_note: 1,
        classifier: 1, classified_at: 1, reasoning: 1,
        override_is_ai: 1, override_by: 1, override_at: 1, override_reason: 1,
        expires_at: 1, hits: 1, last_hit_at: 1,
      })
      .toArray();
    res.json(rows.map((r) => rowToVerdict(r, { fromCache: true, threshold: CONFIDENCE_THRESHOLD })));
  }));

  // POST /api/v1/classifications/:host/override
  app.post('/api/v1/classifications/:host/override', a(async (req, res) => {
    const host = normalizeHost(req.params.host);
    if (!host) return res.status(400).json({ error: 'host required' });
    if (typeof req.body?.is_ai !== 'boolean') return res.status(400).json({ error: 'is_ai (boolean) required' });
    const reason = (req.body.reason || '').slice(0, 500);

    const existing = await db.collection('runtime_classifications').findOne({ host });
    if (!existing) return res.status(404).json({ error: 'host not classified yet' });

    const now = new Date();
    await db.collection('runtime_classifications').updateOne(
      { host },
      {
        $set: {
          override_is_ai: req.body.is_ai ? 1 : 0,
          override_at: now,
          override_by: req.body.actor || 'admin',
          override_reason: reason,
        },
      },
    );
    await db.collection('classification_audit').insertOne({
      host,
      event: 'override',
      is_ai: req.body.is_ai ? 1 : 0,
      classifier: 'manual',
      actor: req.body.actor || 'admin',
      details_json: JSON.stringify({ reason, was: !!existing.is_ai, prev_classifier: existing.classifier }),
      created_at: now,
    });
    res.json({ ok: true });
  }));

  // POST /api/v1/known-ai-tool
  app.post('/api/v1/known-ai-tool', requireMachineAuth, a(async (req, res) => {
    const host = normalizeHost(req.body?.host);
    if (!host) return res.status(400).json({ error: 'host required' });
    const vendor   = (req.body?.vendor   || null);
    const product  = (req.body?.product  || vendor || null);
    const category = (req.body?.category || null);
    const sandbox  = (req.body?.sandbox  || 'remote');
    const source   = (req.body?.source   || 'allowlist');
    const reason   = (req.body?.reason   || `marked AI by ${source}`).slice(0, 300);
    const TTL_DAYS_KNOWN = 365;
    const expiresAt = new Date(Date.now() + TTL_DAYS_KNOWN * 24 * 3600 * 1000);

    const existing = await db.collection('runtime_classifications').findOne({ host });
    const verdict = {
      is_ai: 1,
      confidence: 1.0,
      vendor, category, sandbox,
      governance_note: null,
      classifier: 'known:' + source,
      reasoning: reason,
    };

    const now = new Date();
    if (existing) {
      await db.collection('runtime_classifications').updateOne(
        { host },
        {
          $set: {
            vendor: vendor || existing.vendor,
            category: category || existing.category,
            sandbox: sandbox || existing.sandbox,
            last_hit_at: now,
          },
          $inc: { hits: 1 },
        },
      );
    } else {
      await db.collection('runtime_classifications').insertOne({
        host,
        is_ai: 1,
        confidence: 1.0,
        vendor,
        category,
        sandbox,
        classifier: verdict.classifier,
        reasoning: reason,
        expires_at: expiresAt,
        classified_at: now,
        governance_note: null,
        signals_json: null,
        hits: 1,
        last_hit_at: now,
        override_is_ai: null,
        override_by: null,
        override_at: null,
        override_reason: null,
      });
    }

    await db.collection('classification_audit').insertOne({
      host,
      event: 'known',
      is_ai: 1,
      confidence: 1.0,
      classifier: verdict.classifier,
      actor: 'system',
      details_json: JSON.stringify({ source, reason, vendor, category }),
      created_at: now,
    });

    // Record this machine's usage.
    await recordToolUsage(db, req.machine.id, host, { ...verdict, override_is_ai: null });

    res.json({
      host,
      is_ai: true,
      should_govern: true,
      confidence: 1.0,
      vendor, category, sandbox,
      classifier: verdict.classifier,
      reasoning: reason,
      from_cache: !!existing,
      threshold: CONFIDENCE_THRESHOLD,
    });
  }));

  // POST /api/v1/classifications/:host/override/clear
  app.post('/api/v1/classifications/:host/override/clear', a(async (req, res) => {
    const host = normalizeHost(req.params.host);
    if (!host) return res.status(400).json({ error: 'host required' });
    const existing = await db.collection('runtime_classifications').findOne({ host });
    if (!existing) return res.status(404).json({ error: 'host not classified yet' });

    await db.collection('runtime_classifications').updateOne(
      { host },
      {
        $set: {
          override_is_ai: null,
          override_by: null,
          override_at: null,
          override_reason: null,
        },
      },
    );
    res.json({ ok: true });
  }));
}

// Upsert a tool_usage row when a machine hits an AI-classified host.
async function recordToolUsage(db, machineId, host, verdict) {
  if (!verdict) return;
  const effectiveIsAi = verdict.override_is_ai != null ? !!verdict.override_is_ai : !!verdict.is_ai;
  if (!effectiveIsAi) return;

  const product = verdict.vendor || host;

  const existing = await db.collection('tool_usage').findOne({
    machine_id: machineId,
    tool_key: host,
  });

  const now = new Date();
  if (existing) {
    await db.collection('tool_usage').updateOne(
      { machine_id: machineId, tool_key: host },
      {
        $set: {
          last_used_at: now,
          vendor: verdict.vendor ?? existing.vendor,
          product: product || existing.product,
          category: verdict.category ?? existing.category,
          sandbox: verdict.sandbox ?? existing.sandbox,
          confidence: verdict.confidence ?? existing.confidence,
        },
        $inc: { hit_count: 1 },
      },
    );
  } else {
    await db.collection('tool_usage').insertOne({
      machine_id: machineId,
      tool_key: host,
      host,
      vendor: verdict.vendor ?? null,
      product,
      category: verdict.category ?? null,
      sandbox: verdict.sandbox ?? null,
      confidence: verdict.confidence ?? null,
      source: 'web_usage',
      hit_count: 1,
      first_used_at: now,
      last_used_at: now,
    });
  }
}

// Suffix-match `host` against the ai_platforms collection.
async function findPlatformForHost(db, host) {
  // Exact match first.
  const exact = await db.collection('ai_platforms').findOne({ host });
  if (exact) return exact;

  // Subdomain suffix match: 'sub.example.com' matches entry 'example.com'.
  // We need to find all platforms and check suffix manually since MongoDB
  // can't do the reverse LIKE pattern efficiently.
  const allPlatforms = await db.collection('ai_platforms')
    .find({})
    .project({ _id: 0 })
    .toArray();

  let bestMatch = null;
  let bestLen = 0;
  for (const p of allPlatforms) {
    if (host.endsWith('.' + p.host) && p.host.length > bestLen) {
      bestMatch = p;
      bestLen = p.host.length;
    }
  }
  return bestMatch;
}

function normalizeHost(h) {
  if (!h || typeof h !== 'string') return null;
  let s = h.trim().toLowerCase();
  s = s.replace(/^https?:\/\//, '').split('/')[0].split(':')[0];
  if (!/^[a-z0-9.\-]+\.[a-z]{2,}$/.test(s)) return null;
  return s;
}

function rowToVerdict(row, { fromCache, threshold }) {
  const overridden = row.override_is_ai != null;
  const effective_is_ai = overridden ? !!row.override_is_ai : !!row.is_ai;
  return {
    host:            row.host,
    is_ai:           effective_is_ai,
    confidence:      row.confidence ?? 0,
    vendor:          row.vendor,
    category:        row.category,
    sandbox:         row.sandbox,
    governance_note: row.governance_note,
    classifier:      row.classifier,
    classified_at:   row.classified_at,
    reasoning:       row.reasoning,
    overridden,
    override_by:     row.override_by,
    override_at:     row.override_at,
    override_reason: row.override_reason,
    expires_at:      row.expires_at,
    hits:            row.hits,
    last_hit_at:     row.last_hit_at,
    should_govern:   effective_is_ai && (overridden || (row.confidence ?? 0) >= threshold),
    threshold,
    from_cache:      !!fromCache,
  };
}

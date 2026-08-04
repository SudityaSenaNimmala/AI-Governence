import { a } from '../util.js';
import { requireAdminAuth } from '../auth.js';
import {
  normalizeDlpEvent, normalizeApproval, normalizeViolation, normalizeAlert, render,
} from '../lib/cef.js';

// SIEM export — a pull endpoint that renders decision + evidence records as
// CEF / LEEF / JSON so an external SIEM or audit pipeline can ingest them.
// (A real-time syslog push also exists — see lib/siem-forward.js.)

// tsIsDate: whether the collection stores its timestamp as a JS Date (true) or
// an ISO string (dlp_events.occurred_at comes from the client as a string).
const SOURCES = {
  dlp:        { coll: 'dlp_events',        ts: 'occurred_at', tsIsDate: false, norm: normalizeDlpEvent },
  approvals:  { coll: 'approval_requests', ts: 'requested_at', tsIsDate: true, norm: normalizeApproval },
  violations: { coll: 'policy_violations', ts: 'created_at',   tsIsDate: true, norm: normalizeViolation },
  alerts:     { coll: 'alerts',            ts: 'created_at',   tsIsDate: true, norm: normalizeAlert },
};

export function mountSiem(app, db) {
  app.get('/api/v1/siem/export', requireAdminAuth, a(async (req, res) => {
    const format = String(req.query.format || 'cef').toLowerCase();
    if (!['cef', 'leef', 'json'].includes(format)) {
      return res.status(400).json({ error: "format must be cef, leef, or json" });
    }
    const limit = Math.min(Number(req.query.limit) || 1000, 10000);
    const sinceRaw = req.query.since ? new Date(req.query.since) : null;
    const since = sinceRaw && !isNaN(sinceRaw.getTime()) ? sinceRaw : null;

    const requested = String(req.query.types || Object.keys(SOURCES).join(','));
    const types = requested.split(',').map((s) => s.trim()).filter((t) => SOURCES[t]);
    if (!types.length) {
      return res.status(400).json({ error: 'no valid types; choose from ' + Object.keys(SOURCES).join(',') });
    }

    const events = [];
    for (const t of types) {
      const src = SOURCES[t];
      const filter = {};
      if (since) filter[src.ts] = { $gte: src.tsIsDate ? since : since.toISOString() };
      const rows = await db.collection(src.coll)
        .find(filter)
        .sort({ [src.ts]: -1 })
        .limit(limit)
        .project({ _id: 0 })
        .toArray();
      for (const r of rows) {
        try { events.push(src.norm(r)); } catch { /* skip malformed row */ }
      }
    }

    events.sort((x, y) => tms(y.ts) - tms(x.ts));
    const clipped = events.slice(0, limit);

    if (format === 'json') {
      return res.json({ count: clipped.length, events: clipped });
    }
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="cloudfuze-siem-${format}.log"`);
    res.send(clipped.map((ev) => render(ev, format)).join('\n') + (clipped.length ? '\n' : ''));
  }));

  // Capability probe for integrators.
  app.get('/api/v1/siem/formats', (req, res) => {
    res.json({
      formats: ['cef', 'leef', 'json'],
      types: Object.keys(SOURCES),
      syslog_forwarder_enabled: !!process.env.SIEM_SYSLOG_HOST,
    });
  });
}

function tms(v) { try { return new Date(v).getTime() || 0; } catch { return 0; } }

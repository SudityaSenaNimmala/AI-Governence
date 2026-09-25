// Ingest for BROWSER errors, so a dashboard failure reaches the triage queue
// instead of dying in a console nobody has open.
//
// ── THIS IS AN INGEST ENDPOINT, AND THAT IS A REAL CONCESSION ────────────────
//
// server/src/routes/errors.js deliberately has none, and a test forbids one:
// anything that accepts error text over HTTP lets a caller write straight into
// the input of a pipeline that writes code and opens pull requests.
//
// A browser error reporter cannot avoid being exactly that. The browser is the
// only place a React failure exists, so the choice is between this endpoint and
// no UI coverage at all. Every error tracker makes the same trade.
//
// What makes it acceptable is that the trade is NAMED rather than hidden:
//
//   * rows land with source:'client' and go in their OWN collection. They are
//     never pooled with server errors, so "a server threw this" and "someone
//     posted this" stay distinguishable at every later step.
//   * the triage bundle marks client rows as ATTACKER-CONTROLLABLE. A server
//     stack is evidence the runtime produced; this is a claim somebody made.
//   * every field is masked and hard-capped, so the row cannot become a
//     transport for either a payload or a wall of text.
//   * no auth is required (a crashed page often has no session), so the rate
//     limit is what stops it being a free write endpoint.
//
// The pipeline should treat a client row as a LEAD — worth a human's attention,
// never worth an unattended code change on its own.
import crypto from 'node:crypto';
import { maskSensitive } from '../lib/mask-sensitive.js';

const MAX_MESSAGE = 400;
const MAX_STACK = 2500;
const MAX_FRAMES = 10;
const MAX_URL = 300;

// One row per bug, same reasoning as the server side: hashing the raw message
// would give a new row per click and drown the queue.
function fingerprint(name, message, topFrame, route) {
  const norm = String(message || '')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<uuid>')
    .replace(/\b\d+\b/g, '<n>')
    .replace(/'[^']*'/g, "'<s>'")
    .replace(/"[^"]*"/g, '"<s>"');
  const frame = String(topFrame || '')
    .replace(/https?:\/\/[^/]+/g, '')     // host varies by environment
    .replace(/:\d+:\d+/g, ':<line>')
    .replace(/-[A-Za-z0-9_]{8,}\.js/g, '-<hash>.js');  // Vite bundle hashes
  return crypto.createHash('sha256')
    .update(`${name}::${norm}::${frame}::${route}`)
    .digest('hex').slice(0, 16);
}

export function mountClientErrors(app, db) {
  const col = () => db.collection('client_errors');

  // Crude per-process rate limit. No auth is required here, so this is the only
  // thing standing between the endpoint and being a free write primitive. Small
  // on purpose: a real page produces a handful of errors, not hundreds.
  const WINDOW_MS = 60_000;
  const MAX_PER_WINDOW = 30;
  let windowStart = Date.now();
  let inWindow = 0;

  app.post('/api/v1/client-errors', async (req, res) => {
    try {
      const now = Date.now();
      if (now - windowStart > WINDOW_MS) { windowStart = now; inWindow = 0; }
      if (++inWindow > MAX_PER_WINDOW) {
        // 202 rather than 429 on purpose: the browser must not retry, and a
        // reporting endpoint should never make a broken page look more broken.
        return res.status(202).json({ ok: true, dropped: 'rate_limited' });
      }

      const b = req.body || {};
      const name = String(b.name || 'Error').slice(0, 80);
      const message = maskSensitive(String(b.message || ''), MAX_MESSAGE);
      const frames = String(b.stack || '').split(/\r?\n/).slice(0, MAX_FRAMES)
        .map((l) => maskSensitive(l, 260));
      const stack = frames.join('\n').slice(0, MAX_STACK);
      // The route the user was on, NOT a full URL: a dashboard URL can carry
      // ids and query values, and none of that helps diagnose a React crash.
      const route = maskSensitive(String(b.route || '').split('?')[0], MAX_URL);
      const fp = fingerprint(name, b.message, frames[1] || frames[0], route);

      const when = new Date();
      await col().updateOne(
        { fingerprint: fp },
        {
          $set: {
            source: 'client',
            name, message, stack, route,
            component: maskSensitive(String(b.component || ''), 120),
            // Which build the browser was running, so a fix can be tied to a
            // release and a stale tab is distinguishable from a live regression.
            build: String(b.build || '').slice(0, 60),
            last_seen: when,
          },
          $inc: { count: 1 },
          $setOnInsert: { fingerprint: fp, first_seen: when, resolved: false },
        },
        { upsert: true },
      );
      res.json({ ok: true, fingerprint: fp });
    } catch {
      // A failure to report must never surface to the user: the page is already
      // broken, and a second error about the first one helps nobody.
      res.status(202).json({ ok: true });
    }
  });

  // Read side, mirroring the server-error routes so the triage runner needs no
  // special case beyond knowing which collection it asked for.
  app.get('/api/v1/client-errors', async (req, res) => {
    try {
      const status = String(req.query.status || 'open');
      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
      const filter = {};
      if (status === 'open') filter.resolved = { $ne: true };
      else if (status === 'resolved') filter.resolved = true;
      const rows = await col().find(filter).sort({ last_seen: -1 }).limit(limit).toArray();
      res.json(rows.map(({ _id, ...rest }) => rest));
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : 'failed' });
    }
  });

  app.get('/api/v1/client-errors/:fingerprint', async (req, res) => {
    try {
      const row = await col().findOne({ fingerprint: String(req.params.fingerprint) });
      if (!row) return res.status(404).json({ error: 'not found' });
      const { _id, ...rest } = row;
      res.json(rest);
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : 'failed' });
    }
  });

  app.patch('/api/v1/client-errors/:fingerprint', async (req, res) => {
    try {
      const resolved = req.body?.resolved;
      if (typeof resolved !== 'boolean') {
        return res.status(400).json({ error: 'resolved must be a boolean' });
      }
      const set = { resolved, updated_at: new Date() };
      if (resolved) {
        set.resolved_at = new Date();
        if (req.body?.pr) set.resolved_pr = String(req.body.pr).slice(0, 200);
      } else {
        set.resolved_at = null;
      }
      const r = await col().updateOne({ fingerprint: String(req.params.fingerprint) }, { $set: set });
      if (r.matchedCount === 0) return res.status(404).json({ error: 'not found' });
      res.json({ ok: true, resolved });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : 'failed' });
    }
  });
}

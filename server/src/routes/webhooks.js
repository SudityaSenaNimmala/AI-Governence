import crypto from 'node:crypto';
import { a } from '../util.js';
import { requireAdminAuth } from '../auth.js';
import { signWebhook, newSecret } from '../integration-util.js';

// Outbound webhooks — let third-party governance/control layers RECEIVE CloudFuze
// signals (enforcement blocks, hold approvals, policy violations) instead of
// polling. Each delivery is HMAC-SHA256 signed with the endpoint's secret so the
// receiver can verify authenticity.

export const WEBHOOK_EVENTS = [
  'enforcement.block',
  'enforcement.override',
  'approval.created',
  'approval.decided',
  'policy.violation',
];

// Dispatch an event to every active endpoint subscribed to it (or to '*').
// Fire-and-forget: never throws into the caller's request path.
export async function emitWebhook(db, type, data) {
  try {
    const endpoints = await db.collection('webhook_endpoints')
      .find({ active: true })
      .project({ _id: 0, id: 1, url: 1, secret: 1, events: 1 })
      .toArray();
    const targets = endpoints.filter((e) => (e.events || []).includes('*') || (e.events || []).includes(type));
    if (!targets.length) return;

    const envelope = { id: crypto.randomUUID(), type, created_at: new Date().toISOString(), data };
    const raw = JSON.stringify(envelope);

    await Promise.allSettled(targets.map(async (e) => {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 5000);
      try {
        const res = await fetch(e.url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-cloudfuze-event': type,
            'x-cloudfuze-signature': signWebhook(e.secret, raw),
          },
          body: raw,
          signal: ctrl.signal,
        });
        await db.collection('webhook_endpoints').updateOne(
          { id: e.id },
          { $set: { last_status: res.status, last_delivery_at: new Date() } },
        );
      } catch (err) {
        await db.collection('webhook_endpoints').updateOne(
          { id: e.id },
          { $set: { last_status: 'error', last_error: String(err?.message || err), last_delivery_at: new Date() } },
        ).catch(() => {});
      } finally { clearTimeout(t); }
    }));
  } catch { /* never break the caller */ }
}

export function mountWebhooks(app, db) {
  // List endpoints (secret never returned).
  app.get('/api/v1/webhooks', requireAdminAuth, a(async (req, res) => {
    const rows = await db.collection('webhook_endpoints')
      .find({})
      .project({ _id: 0, secret: 0 })
      .toArray();
    res.json({ events: WEBHOOK_EVENTS, endpoints: rows });
  }));

  // Register an endpoint. Returns the signing secret ONCE.
  app.post('/api/v1/webhooks', requireAdminAuth, a(async (req, res) => {
    const { url, events } = req.body ?? {};
    if (!url || !/^https?:\/\//.test(url)) return res.status(400).json({ error: 'valid url required' });
    const evts = Array.isArray(events) && events.length ? events : ['*'];
    const bad = evts.filter((e) => e !== '*' && !WEBHOOK_EVENTS.includes(e));
    if (bad.length) return res.status(400).json({ error: `unknown events: ${bad.join(',')}` });

    const doc = {
      id: crypto.randomUUID(),
      url,
      events: evts,
      secret: newSecret(),
      active: true,
      created_at: new Date(),
      last_status: null,
      last_delivery_at: null,
    };
    await db.collection('webhook_endpoints').insertOne(doc);
    res.status(201).json({ id: doc.id, url: doc.url, events: doc.events, secret: doc.secret,
      note: 'Store this secret — it verifies the x-cloudfuze-signature header and is not shown again.' });
  }));

  // Enable/disable or update subscribed events.
  app.patch('/api/v1/webhooks/:id', requireAdminAuth, a(async (req, res) => {
    const set = {};
    if (typeof req.body?.active === 'boolean') set.active = req.body.active;
    if (Array.isArray(req.body?.events)) set.events = req.body.events;
    if (!Object.keys(set).length) return res.status(400).json({ error: 'nothing to update' });
    const r = await db.collection('webhook_endpoints').updateOne({ id: req.params.id }, { $set: set });
    if (!r.matchedCount) return res.status(404).json({ error: 'not found' });
    res.json({ ok: true });
  }));

  app.delete('/api/v1/webhooks/:id', requireAdminAuth, a(async (req, res) => {
    await db.collection('webhook_endpoints').deleteOne({ id: req.params.id });
    res.json({ ok: true });
  }));

  // Fire a test event to all matching endpoints.
  app.post('/api/v1/webhooks/test', requireAdminAuth, a(async (req, res) => {
    await emitWebhook(db, 'enforcement.block', { test: true, message: 'CloudFuze webhook test', at: new Date().toISOString() });
    res.json({ ok: true, sent: 'enforcement.block (test)' });
  }));
}

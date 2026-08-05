import crypto from 'node:crypto';
import { a } from '../util.js';
import { requireMachineAuth, requireAdminAuth } from '../auth.js';
import { emitWebhook } from './webhooks.js';
import { siemForward } from '../lib/siem-forward.js';

// HOLD / approve-before-release workflow.
//
// For platforms/rules set to "hold" (capture_mode: 'hold'), instead of a hard
// block the client creates an approval_request and blocks the current send. An
// admin approves or denies. On approval, a time-boxed ALLOWANCE is written; the
// client polls /allowances and lets the user's retry through until it expires.
// (Interception is synchronous, so we can't literally freeze a keystroke for
// minutes — "hold" = block-now + create-request + release-on-approval-retry.)

const DEFAULT_TTL_MIN = 15;

export function mountApprovals(app, db) {
  // Client creates a hold request (machine-authenticated).
  app.post('/api/v1/approvals', requireMachineAuth, a(async (req, res) => {
    const { ai_service, event_kind, patterns, snippet, user } = req.body ?? {};
    const doc = {
      id: crypto.randomUUID(),
      status: 'pending',
      machine_id: req.machine.id,
      user: user || req.machine.hostname || null,
      ai_service: ai_service || 'unknown',
      event_kind: event_kind || 'prompt_submit',
      patterns: Array.isArray(patterns) ? patterns : [],
      snippet: typeof snippet === 'string' ? snippet.slice(0, 500) : null,
      requested_at: new Date(),
      decided_at: null,
      decided_by: null,
      expires_at: null,
    };
    await db.collection('approval_requests').insertOne(doc);
    siemForward('approval', doc);
    emitWebhook(db, 'approval.created', {
      id: doc.id, machine_id: doc.machine_id, user: doc.user,
      ai_service: doc.ai_service, event_kind: doc.event_kind, patterns: doc.patterns,
    });
    res.status(201).json({ id: doc.id, status: doc.status });
  }));

  // Client polls the status of its own request (machine-auth).
  app.get('/api/v1/approvals/:id', requireMachineAuth, a(async (req, res) => {
    const r = await db.collection('approval_requests').findOne(
      { id: req.params.id }, { projection: { _id: 0 } });
    if (!r) return res.status(404).json({ error: 'not found' });
    res.json(r);
  }));

  // Admin: list requests (default pending, newest first).
  app.get('/api/v1/approvals', requireAdminAuth, a(async (req, res) => {
    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    const rows = await db.collection('approval_requests')
      .find(filter).sort({ requested_at: -1 }).limit(500).project({ _id: 0 }).toArray();
    res.json(rows);
  }));

  // Admin: approve or deny. Approve writes a time-boxed allowance.
  app.post('/api/v1/approvals/:id/decide', requireAdminAuth, a(async (req, res) => {
    const { decision, ttl_minutes, decided_by } = req.body ?? {};
    if (decision !== 'approve' && decision !== 'deny') {
      return res.status(400).json({ error: "decision must be 'approve' or 'deny'" });
    }
    const reqDoc = await db.collection('approval_requests').findOne({ id: req.params.id });
    if (!reqDoc) return res.status(404).json({ error: 'not found' });
    if (reqDoc.status !== 'pending') return res.status(409).json({ error: `already ${reqDoc.status}` });

    const now = new Date();
    let allowance = null;
    if (decision === 'approve') {
      const ttl = Math.max(1, Math.min(240, Number(ttl_minutes) || DEFAULT_TTL_MIN));
      allowance = {
        id: crypto.randomUUID(),
        approval_id: reqDoc.id,
        machine_id: reqDoc.machine_id,
        user: reqDoc.user,
        ai_service: reqDoc.ai_service,
        created_at: now,
        expires_at: new Date(now.getTime() + ttl * 60000),
      };
      await db.collection('allowances').insertOne(allowance);
    }
    await db.collection('approval_requests').updateOne(
      { id: reqDoc.id },
      { $set: { status: decision === 'approve' ? 'approved' : 'denied',
        decided_at: now, decided_by: decided_by || 'admin',
        expires_at: allowance?.expires_at || null } },
    );
    siemForward('approval', {
      ...reqDoc,
      status: decision === 'approve' ? 'approved' : 'denied',
      decided_at: now, decided_by: decided_by || 'admin',
      expires_at: allowance?.expires_at || null,
    });
    emitWebhook(db, 'approval.decided', {
      id: reqDoc.id, decision, machine_id: reqDoc.machine_id, user: reqDoc.user,
      ai_service: reqDoc.ai_service, expires_at: allowance?.expires_at || null,
    });
    res.json({ ok: true, status: decision === 'approve' ? 'approved' : 'denied',
      allowance_expires_at: allowance?.expires_at || null });
  }));

  // Clients poll for an active allowance so an approved retry can proceed.
  app.get('/api/v1/allowances', requireMachineAuth, a(async (req, res) => {
    const now = new Date();
    const filter = { machine_id: req.machine.id, expires_at: { $gt: now } };
    if (req.query.service) filter.ai_service = req.query.service;
    const rows = await db.collection('allowances')
      .find(filter).project({ _id: 0, id: 1, ai_service: 1, expires_at: 1 }).toArray();
    res.json({ now: now.toISOString(), allowances: rows });
  }));
}

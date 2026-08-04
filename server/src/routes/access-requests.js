// AI Tool Access Request — employees request access to blocked tools, admins approve/reject.
//
// Flow:
//   1. Extension blocks a tool → user clicks "Request Access" → submits reason
//   2. Server stores request with machine_id, tool, reason, status=pending
//   3. Admin reviews in dashboard → approves with MANDATORY expiry (date or countdown)
//   4. Server creates a temporary exception: machine_id + tool + expires_at
//   5. Extension checks exceptions before blocking — if active exception exists, allow through
//   6. When exception expires, tool is blocked again automatically
//
// The exception is per-machine — only the requesting employee gets access, not everyone.

import crypto from 'node:crypto';
import { a } from '../util.js';

export function mountAccessRequests(app, db) {
  const requests   = () => db.collection('access_requests');
  const exceptions = () => db.collection('access_exceptions');

  // ── Submit request (from browser extension) ──

  app.post('/api/v1/access-requests', a(async (req, res) => {
    const { machine_id, hostname, user, tool_host, tool_name, tool_vendor, reason } = req.body ?? {};
    if (!machine_id || !tool_host) {
      return res.status(400).json({ error: 'machine_id and tool_host are required' });
    }

    // Check if there's already a pending request for this machine + tool
    const existing = await requests().findOne({
      machine_id,
      tool_host,
      status: 'pending',
    });
    if (existing) {
      return res.status(409).json({ error: 'A pending request already exists for this tool', request_id: existing.id });
    }

    const request = {
      id: crypto.randomUUID(),
      machine_id,
      hostname: hostname || null,
      user: user || null,
      tool_host,
      tool_name: tool_name || tool_host,
      tool_vendor: tool_vendor || null,
      reason: reason || '',
      status: 'pending',        // pending → approved → expired | pending → rejected
      submitted_at: new Date(),
      reviewed_at: null,
      reviewed_by: null,
      review_note: null,
      expires_at: null,
    };

    await requests().insertOne(request);
    res.status(201).json({ ok: true, id: request.id });
  }));

  // ── List requests (admin dashboard) ──

  app.get('/api/v1/access-requests', a(async (req, res) => {
    const { status } = req.query;
    const filter = {};
    if (status) filter.status = status;

    const rows = await requests()
      .find(filter)
      .sort({ submitted_at: -1 })
      .limit(200)
      .project({ _id: 0 })
      .toArray();

    // Resolve employee names from profiles
    const profiles = await db.collection('employee_profiles')
      .find({}).project({ _id: 0, machine_ids: 1, display_name: 1 }).toArray();
    const machineToName = new Map();
    for (const p of profiles) {
      for (const mid of p.machine_ids || []) machineToName.set(mid, p.display_name);
    }

    const enriched = rows.map(r => ({
      ...r,
      employee_name: machineToName.get(r.machine_id) || r.user || r.hostname || 'Unknown',
    }));

    res.json(enriched);
  }));

  // ── Approve request (admin — expiry is MANDATORY) ──

  app.put('/api/v1/access-requests/:id/approve', a(async (req, res) => {
    const { expires_at, expires_in_hours, note } = req.body ?? {};

    // Calculate expiry — either a date or a countdown in hours
    let expiryDate;
    if (expires_at) {
      expiryDate = new Date(expires_at);
    } else if (expires_in_hours) {
      expiryDate = new Date(Date.now() + Number(expires_in_hours) * 3600000);
    } else {
      return res.status(400).json({ error: 'Expiry is required. Provide expires_at (date) or expires_in_hours (number).' });
    }

    if (isNaN(expiryDate.getTime()) || expiryDate <= new Date()) {
      return res.status(400).json({ error: 'Expiry must be a future date' });
    }

    const request = await requests().findOne({ id: req.params.id });
    if (!request) return res.status(404).json({ error: 'Request not found' });
    if (request.status !== 'pending') {
      return res.status(400).json({ error: 'Request is already ' + request.status });
    }

    // Update request
    await requests().updateOne({ id: req.params.id }, { $set: {
      status: 'approved',
      reviewed_at: new Date(),
      review_note: note || null,
      expires_at: expiryDate,
    }});

    // Create access exception — this is what the extension checks
    await exceptions().updateOne(
      { machine_id: request.machine_id, tool_host: request.tool_host },
      { $set: {
        machine_id: request.machine_id,
        tool_host: request.tool_host,
        tool_name: request.tool_name,
        request_id: request.id,
        granted_at: new Date(),
        expires_at: expiryDate,
        active: true,
      }},
      { upsert: true },
    );

    res.json({ ok: true, expires_at: expiryDate });
  }));

  // ── Reject request ──

  app.put('/api/v1/access-requests/:id/reject', a(async (req, res) => {
    const { note } = req.body ?? {};
    const request = await requests().findOne({ id: req.params.id });
    if (!request) return res.status(404).json({ error: 'Request not found' });
    if (request.status !== 'pending') {
      return res.status(400).json({ error: 'Request is already ' + request.status });
    }

    await requests().updateOne({ id: req.params.id }, { $set: {
      status: 'rejected',
      reviewed_at: new Date(),
      review_note: note || null,
    }});

    res.json({ ok: true });
  }));

  // ── Check exception (extension calls this to know if a blocked tool is temporarily allowed) ──

  app.get('/api/v1/access-exceptions/check', a(async (req, res) => {
    const { machine_id, tool_host } = req.query;
    if (!machine_id || !tool_host) {
      return res.status(400).json({ error: 'machine_id and tool_host required' });
    }

    const exception = await exceptions().findOne({
      machine_id,
      tool_host,
      active: true,
      expires_at: { $gt: new Date() },
    });

    if (exception) {
      res.json({ allowed: true, expires_at: exception.expires_at });
    } else {
      // Clean up expired exceptions
      await exceptions().updateMany(
        { machine_id, tool_host, expires_at: { $lte: new Date() } },
        { $set: { active: false } },
      );
      res.json({ allowed: false });
    }
  }));

  // ── List active exceptions (admin view) ──

  app.get('/api/v1/access-exceptions', a(async (req, res) => {
    // Clean up expired ones first
    await exceptions().updateMany(
      { expires_at: { $lte: new Date() }, active: true },
      { $set: { active: false } },
    );

    const rows = await exceptions()
      .find({ active: true })
      .sort({ expires_at: 1 })
      .project({ _id: 0 })
      .toArray();

    res.json(rows);
  }));

  // ── Revoke an exception early ──

  app.delete('/api/v1/access-exceptions/:id', a(async (req, res) => {
    await exceptions().updateOne(
      { request_id: req.params.id },
      { $set: { active: false } },
    );
    await requests().updateOne(
      { id: req.params.id },
      { $set: { status: 'revoked', reviewed_at: new Date() } },
    );
    res.json({ ok: true });
  }));
}

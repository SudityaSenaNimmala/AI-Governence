// Discovery tray — hosts the agent caught making AI-shaped calls but that
// aren't in the registry. Two routes:
//
//   POST /api/v1/discovered-apps           (machine-authenticated)
//   GET  /api/v1/discovered-apps
//   POST /api/v1/discovered-apps/:id/promote

import crypto from 'node:crypto';
import { a } from '../util.js';
import { requireMachineAuth } from '../auth.js';

export function mountDiscovered(app, db) {
  app.post('/api/v1/discovered-apps', requireMachineAuth, a(async (req, res) => {
    const discoveries = req.body?.discoveries;
    if (!Array.isArray(discoveries)) return res.status(400).json({ error: 'discoveries array required' });
    if (discoveries.length > 200) return res.status(413).json({ error: 'batch too large (max 200)' });

    let stored = 0;
    for (const d of discoveries) {
      if (!d?.host || !d?.wire_format) continue;

      const existing = await db.collection('discovered_apps').findOne({ host: d.host });
      if (existing) {
        const updateFields = {
          $inc: { call_count: d.count ?? 1 },
          $set: { last_seen_at: new Date() },
        };
        if (d.sample_path) updateFields.$set.sample_path = d.sample_path;
        if (d.sample_model) updateFields.$set.sample_model = d.sample_model;
        await db.collection('discovered_apps').updateOne(
          { host: d.host },
          updateFields,
        );
      } else {
        await db.collection('discovered_apps').insertOne({
          id: crypto.randomUUID(),
          host: d.host,
          wire_format: d.wire_format,
          sample_path: d.sample_path ?? null,
          sample_model: d.sample_model ?? null,
          call_count: d.count ?? 1,
          machine_count: 1,
          first_seen_at: new Date(),
          last_seen_at: new Date(),
          promoted: 0,
          promoted_at: null,
          promoted_to_id: null,
        });
      }
      stored++;
    }
    res.status(201).json({ ok: true, stored });
  }));

  app.get('/api/v1/discovered-apps', a(async (req, res) => {
    const filter = {};
    if (req.query.promoted === '1') filter.promoted = 1;
    else if (req.query.promoted === '0') filter.promoted = 0;

    const rows = await db.collection('discovered_apps')
      .find(filter)
      .sort({ last_seen_at: -1 })
      .limit(500)
      .project({
        _id: 0, id: 1, host: 1, wire_format: 1, first_seen_at: 1, last_seen_at: 1,
        call_count: 1, machine_count: 1, sample_path: 1, sample_model: 1,
        promoted: 1, promoted_at: 1, promoted_to_id: 1,
      })
      .toArray();
    res.json(rows.map((r) => ({ ...r, promoted: !!r.promoted })));
  }));

  app.post('/api/v1/discovered-apps/:id/promote', a(async (req, res) => {
    const id = req.params.id;
    const promotedToId = req.body?.registry_id || null;
    await db.collection('discovered_apps').updateOne(
      { id },
      {
        $set: {
          promoted: 1,
          promoted_at: new Date(),
          promoted_to_id: promotedToId,
        },
      },
    );
    res.json({ ok: true });
  }));
}

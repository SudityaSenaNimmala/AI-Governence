// SDK project management + event ingestion routes
import crypto from 'node:crypto';
import { a } from '../util.js';

export function mountSdk(app, db) {
  const col = () => db.collection('sdk_projects');
  const events = () => db.collection('sdk_events');

  // Create a new SDK project + API key
  app.post('/api/v1/sdk/projects', a(async (req, res) => {
    const { name, language, description } = req.body || {};
    if (!name) return res.status(400).json({ error: 'name is required' });

    const apiKey = 'cfsk_' + crypto.randomBytes(24).toString('hex');
    const project = {
      id: crypto.randomUUID(),
      name,
      language: language || 'javascript',
      description: description || '',
      api_key: apiKey,
      created_at: new Date().toISOString(),
      last_event_at: null,
      total_events: 0,
      total_cost_usd: 0,
      status: 'active',
    };
    await col().insertOne(project);
    res.status(201).json(project);
  }));

  // List all SDK projects.
  //
  // api_key is projected OUT, not just _id. It used to ship in full to every
  // caller of this route, and POST /api/v1/sdk/events authenticates with exactly
  // that value — so listing projects handed out the credential that the ingest
  // endpoint checks, defeating the SDK's own auth.
  //
  // The full key is returned exactly once, by POST above, which is where the
  // dashboard shows it for copying. api_key_prefix is enough to tell two projects
  // apart in a list without being usable. The snippet builder already degrades to
  // a "cfsk_••••" placeholder when the key is absent, so nothing breaks.
  app.get('/api/v1/sdk/projects', a(async (req, res) => {
    const projects = await col()
      .find({}, { projection: { _id: 0, api_key: 0 } })
      .sort({ created_at: -1 })
      .toArray();
    res.json(projects);
  }));

  // Delete a project
  app.delete('/api/v1/sdk/projects/:id', a(async (req, res) => {
    const id = String(req.params.id);
    // Delete the project's events too. Without this the events survived their
    // parent: /sdk/events?project_id=<deleted> still returned rows, and
    // /sdk/stats counted them, so the dashboard showed "1 project, 2 events"
    // with one event belonging to nothing. Events first, so a failure midway
    // leaves the project (and therefore a way to retry) rather than orphans.
    const ev = await events().deleteMany({ project_id: id });
    await col().deleteOne({ id });
    res.json({ ok: true, events_deleted: ev.deletedCount });
  }));

  // SDK stats
  app.get('/api/v1/sdk/stats', a(async (req, res) => {
    const projects = await col().countDocuments();
    const totalEvents = await events().countDocuments();
    const costAgg = await events().aggregate([
      { $group: { _id: null, cost: { $sum: { $ifNull: ['$total_cost_usd', 0] } } } },
    ]).toArray();
    const activeProjects = await col().countDocuments({
      last_event_at: { $gte: new Date(Date.now() - 86400000).toISOString() },
    });
    res.json({
      total_projects: projects,
      active_projects: activeProjects,
      total_events: totalEvents,
      total_cost_usd: costAgg[0]?.cost || 0,
    });
  }));

  // Ingest events from SDK (authenticated via API key)
  app.post('/api/v1/sdk/events', a(async (req, res) => {
    const authHeader = req.headers.authorization || '';
    const apiKey = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!apiKey || !apiKey.startsWith('cfsk_')) {
      return res.status(401).json({ error: 'Invalid SDK API key' });
    }

    const project = await col().findOne({ api_key: apiKey, status: 'active' });
    if (!project) return res.status(401).json({ error: 'Invalid or inactive API key' });

    const eventList = req.body?.events;
    if (!Array.isArray(eventList)) return res.status(400).json({ error: 'events array required' });

    let stored = 0;
    for (const e of eventList.slice(0, 100)) {
      if (!e?.type) continue;
      await events().insertOne({
        id: crypto.randomUUID(),
        project_id: project.id,
        project_name: project.name,
        type: e.type,
        provider: e.provider || null,
        model: e.model || null,
        prompt_tokens: e.prompt_tokens || null,
        completion_tokens: e.completion_tokens || null,
        total_cost_usd: e.total_cost_usd || null,
        duration_ms: e.duration_ms || null,
        status: e.status || 'ok',
        prompt_text: e.prompt_text?.slice(0, 5000) || null,
        response_text: e.response_text?.slice(0, 5000) || null,
        guardrail_flags: e.guardrail_flags || null,
        metadata: e.metadata || null,
        occurred_at: e.occurred_at || new Date().toISOString(),
        received_at: new Date().toISOString(),
      });
      stored++;
    }

    // Update project stats
    await col().updateOne(
      { id: project.id },
      {
        $set: { last_event_at: new Date().toISOString() },
        $inc: { total_events: stored },
      },
    );

    res.status(201).json({ ok: true, stored });
  }));

  // Get events for a project
  app.get('/api/v1/sdk/events', a(async (req, res) => {
    const { project_id, limit = 100 } = req.query;
    const filter = {};
    if (project_id) filter.project_id = project_id;
    const rows = await events()
      .find(filter, { projection: { _id: 0 } })
      .sort({ occurred_at: -1 })
      .limit(Math.min(Number(limit) || 100, 500))
      .toArray();
    res.json(rows);
  }));
}

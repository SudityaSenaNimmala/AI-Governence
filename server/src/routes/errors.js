// Read access to captured server errors — the queue the auto-triage pipeline
// polls, and a human-readable list of what is actually breaking in production.
//
// READ AND RESOLVE ONLY. There is deliberately no route that creates an error
// row: rows come from the server's own error handler, never from a request. An
// ingest endpoint here would let anyone who can reach the API inject text
// straight into the input of a pipeline that writes code, which is the one
// thing this design must not allow.
export function mountErrors(app, db) {
  const col = () => db.collection('server_errors');
  const a = (fn) => (req, res) => fn(req, res).catch((e) => {
    res.status(500).json({ error: e instanceof Error ? e.message : 'failed' });
  });

  // GET /api/v1/errors — newest-first, open by default.
  //
  // `open` is the default rather than `all` because the consumer is a triage
  // loop: the question it asks every poll is "what is broken that nobody has
  // dealt with", and making it pass a filter to get that answer invites the
  // filter being forgotten.
  app.get('/api/v1/errors', a(async (req, res) => {
    const status = String(req.query.status || 'open');
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    const filter = {};
    if (status === 'open') filter.resolved = { $ne: true };
    else if (status === 'resolved') filter.resolved = true;
    // status=all → no filter.

    // `since` lets a poller ask only for what moved, so a long-running loop does
    // not re-read the whole table every minute.
    if (req.query.since) {
      const d = new Date(String(req.query.since));
      if (!Number.isNaN(d.getTime())) filter.last_seen = { $gt: d };
    }

    const rows = await col().find(filter).sort({ last_seen: -1 }).limit(limit).toArray();
    res.json(rows.map(({ _id, ...rest }) => rest));
  }));

  // GET /api/v1/errors/:fingerprint — one bug, for the analysis step.
  app.get('/api/v1/errors/:fingerprint', a(async (req, res) => {
    const row = await col().findOne({ fingerprint: String(req.params.fingerprint) });
    if (!row) return res.status(404).json({ error: 'not found' });
    const { _id, ...rest } = row;
    res.json(rest);
  }));

  // PATCH /api/v1/errors/:fingerprint — mark resolved, or reopen.
  //
  // The pipeline marks a bug resolved when its PR merges, and `resolved_release`
  // records which build claimed the fix. A later occurrence does NOT auto-reopen
  // (see recordError), so a resolved row whose last_seen moves past its
  // resolved_at is the signal that the fix did not work -- which is more useful
  // than silently reopening and losing that the attempt was made.
  app.patch('/api/v1/errors/:fingerprint', a(async (req, res) => {
    const resolved = req.body?.resolved;
    if (typeof resolved !== 'boolean') {
      return res.status(400).json({ error: 'resolved must be a boolean' });
    }
    const set = { resolved, updated_at: new Date() };
    if (resolved) {
      set.resolved_at = new Date();
      if (req.body?.resolved_by) set.resolved_by = String(req.body.resolved_by).slice(0, 120);
      if (req.body?.pr) set.resolved_pr = String(req.body.pr).slice(0, 200);
      set.resolved_release = String(process.env.GIT_SHA || process.env.RELEASE || '').slice(0, 40);
    } else {
      set.resolved_at = null;
    }
    const r = await col().updateOne({ fingerprint: String(req.params.fingerprint) }, { $set: set });
    if (r.matchedCount === 0) return res.status(404).json({ error: 'not found' });
    res.json({ ok: true, fingerprint: req.params.fingerprint, resolved });
  }));

  // GET /api/v1/errors-summary — counts, for a dashboard tile.
  app.get('/api/v1/errors-summary', a(async (_req, res) => {
    const open = await col().countDocuments({ resolved: { $ne: true } });
    const total = await col().countDocuments({});
    // A resolved bug whose last_seen is AFTER its resolved_at came back: the fix
    // did not work. Surfaced as its own number because it is the one that should
    // stop the pipeline trying again with the same approach.
    const regressed = await col().countDocuments({
      resolved: true,
      $expr: { $gt: ['$last_seen', '$resolved_at'] },
    });
    res.json({ open, resolved: total - open, regressed, total });
  }));
}

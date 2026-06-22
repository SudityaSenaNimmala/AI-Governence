import { a } from '../util.js';

export function mountSanctions(app, db) {
  app.get('/api/v1/sanctions', a(async (req, res) => {
    const rows = await db.collection('sanctions')
      .find({})
      .sort({ updated_at: -1 })
      .project({ _id: 0 })
      .toArray();
    res.json(rows);
  }));

  app.put('/api/v1/sanctions/:key', a(async (req, res) => {
    const { status, notes, owner, vendor, product } = req.body ?? {};
    if (!['approved', 'restricted', 'blocked', 'unknown'].includes(status)) {
      return res.status(400).json({ error: 'invalid status' });
    }
    const now = new Date();
    await db.collection('sanctions').updateOne(
      { tool_key: req.params.key },
      {
        $set: {
          tool_key: req.params.key,
          vendor: vendor ?? null,
          product: product ?? null,
          status,
          notes: notes ?? null,
          owner: owner ?? null,
          updated_at: now,
        },
      },
      { upsert: true },
    );
    res.json({ ok: true });
  }));

  app.delete('/api/v1/sanctions/:key', a(async (req, res) => {
    await db.collection('sanctions').deleteOne({ tool_key: req.params.key });
    res.json({ ok: true });
  }));
}

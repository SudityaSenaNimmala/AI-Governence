import crypto from 'node:crypto';
import { ENROLL_SECRET, signMachineToken } from '../auth.js';
import { a } from '../util.js';

export function mountEnroll(app, db) {
  // Body: { machineId, hostname, enrollSecret }
  // Returns: { token, machineId }
  app.post('/api/v1/enroll', a(async (req, res) => {
    const { machineId, hostname, enrollSecret } = req.body ?? {};
    if (!machineId || !hostname) return res.status(400).json({ error: 'machineId and hostname required' });
    if (!enrollSecret) return res.status(401).json({ error: 'enrollSecret required' });

    if (!constantTimeEqual(enrollSecret, ENROLL_SECRET)) {
      return res.status(401).json({ error: 'invalid enrollSecret' });
    }

    const now = new Date();
    await db.collection('machines').updateOne(
      { id: machineId },
      {
        $set: { id: machineId, hostname, last_seen: now },
        $setOnInsert: { first_seen: now },
      },
      { upsert: true },
    );

    const token = signMachineToken({ machineId, hostname });
    res.json({ token, machineId });
  }));
}

function constantTimeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

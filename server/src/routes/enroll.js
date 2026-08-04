import crypto from 'node:crypto';
import { ENROLL_SECRET, signMachineToken } from '../auth.js';
import { a } from '../util.js';
import { resolveProfiles } from './identity.js';

export function mountEnroll(app, db) {
  // Body: { machineId, hostname, enrollSecret, employeeEmail? }
  // Returns: { token, machineId }
  app.post('/api/v1/enroll', a(async (req, res) => {
    const { machineId, hostname, enrollSecret, employeeEmail } = req.body ?? {};
    if (!machineId || !hostname) return res.status(400).json({ error: 'machineId and hostname required' });
    if (!enrollSecret) return res.status(401).json({ error: 'enrollSecret required' });

    if (!constantTimeEqual(enrollSecret, ENROLL_SECRET)) {
      return res.status(401).json({ error: 'invalid enrollSecret' });
    }

    const now = new Date();
    const machineData = { id: machineId, hostname, last_seen: now };
    if (employeeEmail) machineData.employee_email = employeeEmail.toLowerCase().trim();

    await db.collection('machines').updateOne(
      { id: machineId },
      {
        $set: machineData,
        $setOnInsert: { first_seen: now },
      },
      { upsert: true },
    );

    // Auto-resolve employee profiles in background (non-blocking)
    const allMachines = await db.collection('machines').find({}).project({ _id: 0 }).toArray();
    resolveProfiles(db, allMachines).catch(() => {});

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

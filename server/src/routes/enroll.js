import crypto from 'node:crypto';
import { ENROLL_SECRET, signMachineToken } from '../auth.js';
import { a } from '../util.js';
import { resolveProfiles } from './identity.js';

export function mountEnroll(app, db) {
  app.post('/api/v1/enroll', a(async (req, res) => {
    const { machineId, hostname, user, claudeAccountEmail, displayName, enrollSecret, employeeEmail } = req.body ?? {};
    if (!machineId || !hostname) return res.status(400).json({ error: 'machineId and hostname required' });
    if (!enrollSecret) return res.status(401).json({ error: 'enrollSecret required' });

    if (!constantTimeEqual(enrollSecret, ENROLL_SECRET)) {
      return res.status(401).json({ error: 'invalid enrollSecret' });
    }

    const now = new Date();
    const set = { id: machineId, hostname, last_seen: now };
    if (user) set.user = user;   // only overwrite when the client actually sends one
    if (claudeAccountEmail) set.claude_account_email = String(claudeAccountEmail).toLowerCase();
    if (displayName) set.display_name = displayName;
    if (req.body?.type) set.type = req.body.type;  // 'server-monitor' or 'desktop-agent'
    if (req.body?.proxy_port) set.proxy_port = req.body.proxy_port;

    const update = { $set: set, $setOnInsert: { first_seen: now } };

    // Accumulate every Claude account seen on this machine rather than only the
    // latest. One person often signs in under several accounts over time; without
    // the history, each one looks like a different user and their usage fragments.
    if (claudeAccountEmail) {
      update.$addToSet = { claude_accounts: String(claudeAccountEmail).toLowerCase() };
    }

    // Server monitors go into their own collection, not machines (which is for desktop agents/users)
    const collection = set.type === 'server-monitor' ? 'monitored_servers' : 'machines';
    await db.collection(collection).updateOne({ id: machineId }, update, { upsert: true });

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

import crypto from 'node:crypto';
import { ENROLL_SECRET, signMachineToken } from '../auth.js';
import { a } from '../util.js';

export function mountEnroll(app, db) {
  // Body: { machineId, hostname, user?, claudeAccountEmail?, displayName?, enrollSecret }
  // `user` is the real identity (OS username for the desktop agent; signed-in
  // browser-profile email or admin-configured identity for the extension) so
  // usage can be attributed to a person, not just "Mozilla-browser-extension".
  //
  // `claudeAccountEmail` is the Claude account signed in on this machine. It is
  // what lets one person be shown as ONE user: Claude Code reports usage against
  // an OAuth email while the desktop/browser watcher reports an OS username, and
  // without this link the same human appears as two separate users. `displayName`
  // is the account's own display name, preferred for the UI label when present.
  // Returns: { token, machineId }
  app.post('/api/v1/enroll', a(async (req, res) => {
    const { machineId, hostname, user, claudeAccountEmail, displayName, enrollSecret } = req.body ?? {};
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

    const update = { $set: set, $setOnInsert: { first_seen: now } };

    // Accumulate every Claude account seen on this machine rather than only the
    // latest. One person often signs in under several accounts over time; without
    // the history, each one looks like a different user and their usage fragments.
    if (claudeAccountEmail) {
      update.$addToSet = { claude_accounts: String(claudeAccountEmail).toLowerCase() };
    }

    await db.collection('machines').updateOne({ id: machineId }, update, { upsert: true });

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

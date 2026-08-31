import { ENROLL_SECRET, signMachineToken, constantTimeEqual } from '../auth.js';
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
    // Only overwrite when the client actually sends one.
    //
    // NORMALISED, because the same person arrives spelled two ways. Windows hands
    // `whoami /upn` back as "satya.pinniti@cloudfuze.com" and the Intune
    // enrolment registry key as "Satya.Pinniti@cloudfuze.com" — verified on a
    // real Entra-joined machine, not hypothetical. ai-usage.js groups by this
    // field with an exact match, so without folding case the desktop agent and
    // the browser extension still land in two rows and every other part of the
    // UPN alignment is defeated by capitalisation.
    //
    // Only email-shaped values are lowercased. An OS username is left alone: it
    // is a display name for a Windows account, and "SatyaPinniti" is how the
    // person expects to see it.
    if (user) {
      const u = String(user).trim();
      set.user = /^[^\s@]+@[^\s@]+$/.test(u) ? u.toLowerCase() : u;
    }
    if (claudeAccountEmail) set.claude_account_email = String(claudeAccountEmail).toLowerCase();
    if (displayName) set.display_name = displayName;
    if (req.body?.type) set.type = req.body.type;  // 'server-monitor' or 'desktop-agent'

    // WHERE THE IDENTITY CAME FROM, or why there isn't one. On a browser-only
    // rollout attribution rests on the browser profile being signed in, which is
    // an admin policy the extension cannot verify — so without this, a fleet
    // where sign-in was never enforced is indistinguishable from one that is
    // anonymous on purpose, and both just show "Browser User (…)".
    // Recorded unconditionally, including 'none', so the absence is a fact on
    // the record rather than a missing field that could mean anything.
    if (typeof req.body?.identitySource === 'string') {
      set.identity_source = req.body.identitySource;
    }
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

// Unified Employee Identity — links agent + browser extension data to one person.
//
// The problem: the desktop agent and browser extension enroll with DIFFERENT
// machineIds and hostnames. This module resolves them into unified employee
// profiles by matching on hostname, OS username, and optional employee email.
//
// Resolution strategy:
//   1. Group machines by normalized hostname (case-insensitive, strip "-browser-extension")
//   2. Within a group, merge OS user info from agents with browser extension data
//   3. If employee email is provided (extension options), use it as primary key
//   4. Admins can manually link/unlink via API
//
// The employee_profiles collection is the single source of truth for "who is this person"
// across the entire platform — Risk Score, DLP attribution, cost tracking all use it.

import crypto from 'node:crypto';
import { a } from '../util.js';

export function mountIdentity(app, db) {
  const profiles = () => db.collection('employee_profiles');
  const machines = () => db.collection('machines');

  // ── Auto-resolve: scan all machines, build/update employee profiles ──

  app.post('/api/v1/identity/resolve', a(async (req, res) => {
    const allMachines = await machines().find({}).project({ _id: 0 }).toArray();
    const stats = await resolveProfiles(db, allMachines);
    res.json(stats);
  }));

  // ── List all employee profiles ──

  app.get('/api/v1/identity/profiles', a(async (req, res) => {
    const rows = await profiles().find({}).sort({ display_name: 1 }).project({ _id: 0 }).toArray();
    res.json(rows);
  }));

  // ── Get single profile with full detail ──

  app.get('/api/v1/identity/profiles/:id', a(async (req, res) => {
    const profile = await profiles().findOne({ id: req.params.id }, { projection: { _id: 0 } });
    if (!profile) return res.status(404).json({ error: 'profile not found' });

    // Attach linked machines
    const linkedMachines = await machines()
      .find({ id: { $in: profile.machine_ids || [] } })
      .project({ _id: 0 })
      .toArray();
    profile.machines = linkedMachines;

    res.json(profile);
  }));

  // ── Update profile (admin sets display name, email, department) ──

  app.put('/api/v1/identity/profiles/:id', a(async (req, res) => {
    const { display_name, email, department, manager, notes } = req.body ?? {};
    const update = { updated_at: new Date() };
    if (display_name !== undefined) update.display_name = display_name;
    if (email !== undefined)        update.email = email;
    if (department !== undefined)    update.department = department;
    if (manager !== undefined)       update.manager = manager;
    if (notes !== undefined)         update.notes = notes;
    const result = await profiles().updateOne({ id: req.params.id }, { $set: update });
    if (result.matchedCount === 0) return res.status(404).json({ error: 'profile not found' });
    res.json({ ok: true });
  }));

  // ── Manually link a machine to a profile ──

  app.post('/api/v1/identity/profiles/:id/link', a(async (req, res) => {
    const { machine_id } = req.body ?? {};
    if (!machine_id) return res.status(400).json({ error: 'machine_id required' });

    // Remove from any other profile first
    await profiles().updateMany({}, { $pull: { machine_ids: machine_id } });

    // Add to target profile
    await profiles().updateOne(
      { id: req.params.id },
      { $addToSet: { machine_ids: machine_id }, $set: { updated_at: new Date() } }
    );
    res.json({ ok: true });
  }));

  // ── Unlink a machine from a profile ──

  app.post('/api/v1/identity/profiles/:id/unlink', a(async (req, res) => {
    const { machine_id } = req.body ?? {};
    if (!machine_id) return res.status(400).json({ error: 'machine_id required' });
    await profiles().updateOne(
      { id: req.params.id },
      { $pull: { machine_ids: machine_id }, $set: { updated_at: new Date() } }
    );
    res.json({ ok: true });
  }));

  // ── Lookup: given a machine_id, return the employee profile ──

  app.get('/api/v1/identity/lookup/:machineId', a(async (req, res) => {
    const profile = await profiles().findOne(
      { machine_ids: req.params.machineId },
      { projection: { _id: 0 } }
    );
    res.json(profile || null);
  }));
}

// ── Resolution Engine ─────────────────────────────────────────────────

export async function resolveProfiles(db, allMachines) {
  const profiles = db.collection('employee_profiles');
  let created = 0, updated = 0, skipped = 0;

  // STEP 1: Filter — only desktop agents and browser extensions count.
  // Desktop agent: has real hostname + user + platform (win32/darwin/linux)
  // Browser extension: hostname ends with "browser-extension"
  // Everything else (CLI, test data, demo seeds) is ignored.
  const agents = [];
  const extensions = [];

  for (const m of allMachines) {
    const h = (m.hostname || '').toLowerCase();
    if (m.user && m.platform && h && !h.includes('browser-extension') && !h.includes('claude code')) {
      agents.push(m);
    } else if (h.includes('browser-extension')) {
      extensions.push(m);
    } else {
      skipped++;
    }
  }

  // STEP 2: Build profiles from desktop agents (primary source of identity)
  for (const agent of agents) {
    const hostname = agent.hostname.toLowerCase().trim();
    const user = (agent.user || '').trim();
    const resolveKey = `agent:${hostname}:${user.toLowerCase()}`;
    const displayName = humanizeName(user);

    const existing = await profiles.findOne({ resolve_key: resolveKey });

    if (existing) {
      const merged = [...new Set([...(existing.machine_ids || []), agent.id])];
      await profiles.updateOne({ id: existing.id }, { $set: {
        machine_ids: merged,
        updated_at: new Date(),
        last_seen: new Date(),
        platform: agent.platform,
      }});
      updated++;
    } else {
      await profiles.insertOne({
        id: crypto.randomUUID(),
        resolve_key: resolveKey,
        display_name: displayName,
        email: null,
        os_user: user,
        hostname: agent.hostname,
        platform: agent.platform,
        department: null,
        manager: null,
        notes: null,
        machine_ids: [agent.id],
        sources: ['agent'],
        created_at: new Date(),
        updated_at: new Date(),
        last_seen: new Date(),
      });
      created++;
    }
  }

  // STEP 3: Link browser extensions to existing agent profiles.
  // Match by: (1) hostname (extension sends "SudityaSena-browser-extension" → match agent "SudityaSena")
  //           (2) employee email → fuzzy match to OS username
  //           (3) no match → standalone profile
  for (const ext of extensions) {
    // AN EXTENSION'S IDENTITY USUALLY ARRIVES IN `user`, NOT `employee_email`.
    // employee_email is only ever set by the `employeeEmail` managed key, while
    // every other identity path — the Intune-provisioned userEmail, the signed-in
    // browser profile, the desktop-agent beacon — writes to `user` at enrollment.
    // Reading only employee_email meant a browser-only machine that had reported a
    // perfectly good corporate address still fell through to the standalone branch
    // and was displayed as "Browser User (…)": the name was known and thrown away.
    //
    // `user` is an email on the extension paths but an OS username ("alice") on the
    // beacon path, so only treat it as an email when it looks like one; the
    // non-email case is handled as a display name further down.
    const extUser = String(ext.user || '').trim();
    const userIsEmail = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(extUser);
    const email = (ext.employee_email || '').toLowerCase().trim()
      || (userIsEmail ? extUser.toLowerCase() : '');
    const extHost = (ext.hostname || '').toLowerCase().replace(/-?browser-?extension$/i, '').trim();

    const allProfiles = await profiles.find({}).project({ _id: 0 }).toArray();
    let matched = null;

    // Strategy 1: Match by hostname (extension "SudityaSena-browser-extension" → agent "SudityaSena")
    if (extHost && extHost.length > 2 && !extHost.startsWith('mozilla')) {
      matched = allProfiles.find(p => {
        const agentHost = (p.hostname || '').toLowerCase().trim();
        return agentHost === extHost;
      });
      if (matched) {
        console.log(`[identity] linked extension ${ext.id.slice(0,8)} to ${matched.display_name} via hostname: ${extHost}`);
      } else {
        console.log(`[identity] no hostname match for extension ${ext.id.slice(0,8)}: "${extHost}" vs`, allProfiles.map(p => '"' + (p.hostname||'').toLowerCase() + '"').join(', '));
      }
    }

    // Strategy 2: Match by email → OS username
    if (!matched && email) {
      matched = allProfiles.find(p => p.email === email);
      if (!matched) {
        const emailUser = email.split('@')[0].replace(/[._-]/g, '').toLowerCase();
        matched = allProfiles.find(p => {
          const osU = (p.os_user || '').replace(/[._-]/g, '').toLowerCase();
          return osU && osU === emailUser;
        });
      }
      if (matched) console.log(`[identity] linked extension to ${matched.display_name} via email: ${email}`);
    }

    if (matched) {
      // Link extension to existing agent profile — also delete any old standalone profile for this ext
      await profiles.deleteMany({ resolve_key: `ext:${ext.id}` });
      const merged = [...new Set([...(matched.machine_ids || []), ext.id])];
      const sources = [...new Set([...(matched.sources || []), 'extension'])];
      const updates = { machine_ids: merged, sources, updated_at: new Date() };
      if (email && !matched.email) updates.email = email;
      await profiles.updateOne({ id: matched.id }, { $set: updates });
      updated++;
      continue;
    }

    // No linkable agent profile — create standalone extension profile
    const resolveKey = `ext:${ext.id}`;
    const existing = await profiles.findOne({ resolve_key: resolveKey });
    if (existing) {
      skipped++;
    } else {
      // Order: a real address, then a non-email username the beacon supplied, and
      // only then the anonymous placeholder. The placeholder is a last resort, not
      // a default — it should appear only when nothing at all was reported.
      const displayName = email
        ? email.split('@')[0].replace(/[._-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
        : (extUser ? humanizeName(extUser)
          : 'Browser User (' + ext.id.slice(0, 8) + ')');
      await profiles.insertOne({
        id: crypto.randomUUID(),
        resolve_key: resolveKey,
        display_name: displayName,
        email: email || null,
        os_user: null,
        hostname: extHost || null,
        platform: 'browser',
        department: null,
        manager: null,
        notes: null,
        machine_ids: [ext.id],
        sources: ['extension'],
        created_at: new Date(),
        updated_at: new Date(),
        last_seen: new Date(),
      });
      created++;
    }
  }

  return { created, updated, skipped, total_profiles: created + updated };
}

// "SudityaNimmala" → "Suditya Nimmala"
// "john.doe" → "John Doe"
// "DOMAIN\\jdoe" → "Jdoe"
function humanizeName(raw) {
  if (!raw) return 'Unknown';
  // Strip domain prefix
  let name = raw.includes('\\') ? raw.split('\\').pop() : raw;
  // Split camelCase: "SudityaNimmala" → "Suditya Nimmala"
  name = name.replace(/([a-z])([A-Z])/g, '$1 $2');
  // Split on dots, underscores, hyphens
  name = name.replace(/[._-]/g, ' ');
  // Title case
  name = name.replace(/\b\w/g, c => c.toUpperCase()).trim();
  return name || 'Unknown';
}

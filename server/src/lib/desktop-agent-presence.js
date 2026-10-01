// What counts as a "System" on the AI Hub Overview, and how an already-installed
// desktop agent gets recognised as one.
//
// THE DEFECT. The Overview "Systems" card counted machines with BOTH `user` and
// `platform` set. The desktop agent (Electron tray app) enrolled with only
// {machineId, hostname, enrollSecret}, enroll.js never stored `platform`, and the
// tray app enrolls once (only when it has no token) — so a desktop agent that was
// running and sending os_monitor DLP events all day was never counted, while old
// scanner-report machines (which do carry user + platform) were.
//
// The fix has three parts: enroll stores an allowlisted platform, new agents send
// user/platform/type, and — because existing installs never re-enroll — the
// server marks a machine `type: 'desktop-agent'` when it sees traffic only the
// desktop agent produces (os_monitor DLP events, the tray app's preferences
// fetch). This module is that marking plus the one shared definition of the count.

import { normalizeIdentity } from './identity-normalize.js';
import { DEMO_MACHINE_MATCH } from './demo-personas.js';

// Records that are not an endpoint with the agent installed: the browser
// extension enrols as '<browser>-browser-extension', the OTel CLI path writes a
// synthetic 'Claude Code CLI' machine keyed 'clicode:<email>', and the Claude
// usage tracker keys itself 'clautrk:<hash>'.
const NON_ENDPOINT_HOSTNAME = /browser-extension|Claude Code CLI/i;
const NON_ENDPOINT_ID = /^(clautrk|clicode):/;

// Mongo filter for the Overview "Systems" count (routes/queries.js fetchOverview).
// A machine counts when it is a known desktop agent, or when it carries the
// user + platform pair a scanner report / new-style enroll writes. Leftover demo
// machines (lib/demo-personas.js: JAMES/EMILY/SARAH host with a demo or empty
// user) never count; a real machine with such a hostname but a real user does.
export const SYSTEMS_FILTER = {
  id: { $not: NON_ENDPOINT_ID },
  hostname: { $not: NON_ENDPOINT_HOSTNAME },
  type: { $nin: ['server-monitor', 'browser-extension'] },
  $or: [
    { type: 'desktop-agent' },
    {
      user: { $exists: true, $ne: null },
      platform: { $exists: true, $ne: null },
    },
  ],
  $nor: [DEMO_MACHINE_MATCH],
};

export function isNonEndpointMachine(m) {
  if (!m) return true;
  return NON_ENDPOINT_ID.test(String(m.id ?? '')) || NON_ENDPOINT_HOSTNAME.test(String(m.hostname ?? ''));
}

// One write per machine per window at most. The DLP ingest route is the hottest
// write path in the server and an active agent flushes every few seconds; the
// marker only needs to land once, and last_seen at minute granularity is plenty.
const MARK_INTERVAL_MS = 5 * 60_000;
const lastMarked = new Map();

export function _resetDesktopAgentPresence() { lastMarked.clear(); }

// Mark an existing machine record as a desktop agent and bump last_seen.
//
// Never creates a machine (no upsert) and never overwrites: `type` and `user` are
// only filled when absent. `user` is the OS username the os_monitor reporter
// already stamps on every event — the same value stored on the dlp_events rows —
// so nothing new about the person is persisted. Platform is deliberately NOT
// guessed here: no existing desktop-agent request says which OS it runs on, and
// the count does not need it once `type` is set.
export async function markDesktopAgentSeen(db, machineId, { user } = {}, now = new Date()) {
  if (!machineId) return false;
  const prev = lastMarked.get(machineId);
  if (prev && now.getTime() - prev < MARK_INTERVAL_MS) return false;
  lastMarked.set(machineId, now.getTime());

  const m = await db.collection('machines').findOne(
    { id: machineId },
    { projection: { _id: 0, id: 1, hostname: 1, type: 1, user: 1 } },
  );
  if (!m || isNonEndpointMachine(m)) return false;

  const set = { last_seen: now };
  if (!m.type) set.type = 'desktop-agent';
  if (m.user == null && typeof user === 'string' && user) {
    const u = normalizeIdentity(user);
    if (u) set.user = u;
  }
  await db.collection('machines').updateOne({ id: machineId }, { $set: set });
  return true;
}

// Purge captured CONTENT for events recorded from non-AI surfaces.
//
// WHY. Governance scope was decided per host and enforced across the whole page,
// so every governed SaaS app had its ordinary compose fields and file inputs
// captured as AI prompts — email bodies, ticket replies, CRM notes, attachments.
// lib/ai-surfaces.js now restricts capture to the AI panel on those hosts, but
// the content collected before that fix is still stored.
//
// WHAT IT TOUCHES. dlp_content rows only — the bodies. The dlp_events rows stay,
// so usage counts, timelines and per-user attribution are unchanged; what is
// removed is the text and file payloads that should never have been collected.
//
// The host set comes from lib/ai-surfaces.js, the same module the capture gate
// uses, so the two cannot disagree about which hosts are embedded-AI.
//
// DEFAULT IS A DRY RUN. Pass --apply to delete. Deletion is irreversible.
//
//   node --import tsx server/scripts/purge-embedded-ai-content.mjs           # report
//   node --import tsx server/scripts/purge-embedded-ai-content.mjs --apply   # delete

import { openDb } from '../src/db.js';
import { embeddedAiHostKeys, isEmbeddedAi } from '../src/lib/ai-surfaces.js';

const APPLY = process.argv.includes('--apply');

function hostOf(row) {
  // tab_host is where the event actually happened. ai_service is a product label
  // ("HubSpot AI"), not a host, so it cannot be matched against the host list.
  try {
    const meta = row.metadata_json ? JSON.parse(row.metadata_json) : null;
    return meta?.tab_host || null;
  } catch { return null; }
}

const db = await openDb();

const events = db.collection('dlp_events');
const content = db.collection('dlp_content');

console.log('embedded-AI hosts:', embeddedAiHostKeys().join(', '));
console.log('');

// Every event that has stored content, so its host can be resolved from metadata.
const withContentIds = new Set(
  (await content.find({}).project({ _id: 0, event_id: 1 }).toArray()).map((c) => c.event_id),
);

const rows = await events.find({})
  .project({ _id: 0, id: 1, metadata_json: 1, ai_service: 1, user: 1, occurred_at: 1, event_kind: 1 })
  .toArray();

const affected = [];
const byHost = new Map();
for (const r of rows) {
  const host = hostOf(r);
  if (!host || !isEmbeddedAi(host)) continue;
  const hasContent = withContentIds.has(r.id);
  const entry = byHost.get(host) || { events: 0, withContent: 0, users: new Set(), first: null, last: null };
  entry.events++;
  if (hasContent) { entry.withContent++; affected.push(r.id); }
  if (r.user) entry.users.add(r.user);
  const t = r.occurred_at;
  if (t && (!entry.first || t < entry.first)) entry.first = t;
  if (t && (!entry.last || t > entry.last)) entry.last = t;
  byHost.set(host, entry);
}

console.log('host'.padEnd(38), 'events'.padStart(7), 'w/content'.padStart(10), 'users'.padStart(6), '  range');
for (const [host, e] of [...byHost.entries()].sort((a, b) => b[1].events - a[1].events)) {
  const range = e.first ? `${String(e.first).slice(0, 10)} → ${String(e.last).slice(0, 10)}` : '';
  console.log(
    host.padEnd(38),
    String(e.events).padStart(7),
    String(e.withContent).padStart(10),
    String(e.users.size).padStart(6),
    '  ' + range,
  );
}

console.log('');
console.log(`events from embedded-AI hosts : ${[...byHost.values()].reduce((n, e) => n + e.events, 0)}`);
console.log(`content rows to delete        : ${affected.length}`);
console.log(`event rows to delete          : 0  (metadata is kept by design)`);

if (!APPLY) {
  console.log('');
  console.log('DRY RUN — nothing deleted. Re-run with --apply to delete the content rows.');
  process.exit(0);
}

if (affected.length === 0) {
  console.log('\nNothing to delete.');
  process.exit(0);
}

// Batched: one deleteMany with 10k ids is a document too large for the wire.
let deleted = 0;
const BATCH = 500;
for (let i = 0; i < affected.length; i += BATCH) {
  const slice = affected.slice(i, i + BATCH);
  const r = await content.deleteMany({ event_id: { $in: slice } });
  deleted += r.deletedCount ?? 0;
}

console.log('');
console.log(`DELETED ${deleted} content rows. dlp_events left untouched.`);
process.exit(0);

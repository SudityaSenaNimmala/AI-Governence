/**
 * One-shot cleanup: retire the hand-rolled Developer SDK tracing store.
 *
 * The Developer SDK used to be a local tracing backend — developers POSTed
 * events to /api/v1/sdk/events with a `cfsk_...` bearer token and the rows
 * landed in `sdk_events`. Traces now live in Langfuse Cloud and are read back
 * live (server/src/routes/sdk.js), so:
 *
 *   1. `sdk_events` is dropped outright. Nothing in it maps onto a Langfuse
 *      trace — there is no id, no observation and no tag to carry across — so
 *      keeping it would only leave stale rows that no route can ever read, while
 *      still holding the prompt/response text the old ingest route stored.
 *   2. Every `sdk_projects` document WITHOUT a `public_key` is deleted. Those
 *      are pre-migration projects issued under the old `cfsk_...` scheme
 *      (including the "Testing" project made during manual testing). Unlike a
 *      revoked project, they carry no `cf_tag`, so there is no Langfuse-side
 *      data for them to orphan, and their `api_key` is a plaintext credential
 *      that no code path accepts any more — deleting is strictly safer than
 *      leaving it in the database.
 *
 * This is NOT a migration and it is NOT run at boot. It is a deliberate,
 * one-time operator action.
 *
 * Usage:
 *   node scripts/drop-legacy-sdk-collections.mjs [--dry-run]
 *
 * Reads MONGODB_URI from server/.env. --dry-run reports what it would do and
 * writes nothing.
 */
import dotenv from 'dotenv';
dotenv.config();

import { MongoClient } from 'mongodb';
import { pathToFileURL } from 'node:url';

const COLL_EVENTS = 'sdk_events';
const COLL_PROJECTS = 'sdk_projects';

// Exported so a test can drive it against a fake Db handle rather than a live
// MongoDB, and so the counts it reports are the counts under test.
export async function dropLegacySdkData(db, { dryRun = false } = {}) {
  const present = new Set(
    (await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name),
  );

  // ── 1. sdk_events ──────────────────────────────────────────────────────────
  let eventsDropped = false;
  let eventsDocuments = 0;
  if (present.has(COLL_EVENTS)) {
    eventsDocuments = await db.collection(COLL_EVENTS).countDocuments();
    if (!dryRun) {
      await db.collection(COLL_EVENTS).drop();
      eventsDropped = true;
    }
  }

  // ── 2. pre-migration projects ──────────────────────────────────────────────
  // `{ public_key: { $exists: false } }` and nothing else: a project minted by
  // the current code always has one, so this cannot touch a live project even if
  // it is revoked.
  const legacyFilter = { public_key: { $exists: false } };
  const projects = db.collection(COLL_PROJECTS);
  const legacy = await projects.find(legacyFilter).toArray();
  let projectsDeleted = 0;
  if (legacy.length && !dryRun) {
    const res = await projects.deleteMany(legacyFilter);
    projectsDeleted = res.deletedCount ?? 0;
  }

  return {
    dry_run: dryRun,
    events_collection_dropped: eventsDropped,
    events_documents: eventsDocuments,
    legacy_projects_found: legacy.length,
    legacy_project_names: legacy.map((p) => p.name ?? '(unnamed)'),
    legacy_projects_deleted: projectsDeleted,
    projects_remaining: await projects.countDocuments(),
  };
}

async function main() {
  const MONGODB_URI = process.env.MONGODB_URI;
  const DRY_RUN = process.argv.includes('--dry-run');
  if (!MONGODB_URI) {
    console.error('MONGODB_URI not set in .env');
    process.exit(1);
  }

  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db();
  console.log(`Connected to MongoDB: ${db.databaseName}${DRY_RUN ? '  [DRY RUN]' : ''}`);

  const summary = await dropLegacySdkData(db, { dryRun: DRY_RUN });

  console.log(`\n=== Collection '${COLL_EVENTS}' ===`);
  console.log(summary.events_documents === 0 && !summary.events_collection_dropped
    ? '  not present, nothing to drop'
    : `  ${DRY_RUN ? 'WOULD DROP' : 'dropped'} (${summary.events_documents} document(s))`);

  console.log(`\n=== Pre-migration '${COLL_PROJECTS}' documents (no public_key) ===`);
  console.log(`  found ${summary.legacy_projects_found}`);
  for (const name of summary.legacy_project_names) console.log(`    ${name}`);
  console.log(`  ${DRY_RUN ? 'WOULD DELETE' : 'deleted'} ${DRY_RUN ? summary.legacy_projects_found : summary.legacy_projects_deleted}`);

  console.log('\n=== Summary ===');
  console.log(JSON.stringify(summary, null, 2));

  await client.close();
}

// Only run when invoked directly (`node scripts/drop-legacy-sdk-collections.mjs`),
// never when imported by a test.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => { console.error('Cleanup failed:', err); process.exit(1); });
}

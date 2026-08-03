/**
 * One-shot cleanup: retire the tab-video phase of Session Replay.
 *
 * Session Replay pivoted from literal tab video (chrome.tabCapture +
 * MediaRecorder + WebM in GridFS) to rrweb DOM/interaction recording, because
 * Chrome only grants a tab-capture stream from a user gesture and the product
 * needs recording to start with zero clicks. The video storage is therefore dead
 * weight — and video of a user's screen is the most sensitive thing this server
 * ever held, so leaving it lying around is a liability, not a hedge.
 *
 * This is NOT a migration and it is NOT run at boot. It is a deliberate, one-time
 * operator action:
 *
 *   1. Drop the `recording_videos` GridFS bucket (.files and .chunks).
 *   2. Drop the `session_recording_segments` collection.
 *   3. Tombstone every `session_recordings` doc with capture: 'tab_video' —
 *      status: 'expired', purged_at, purged_reason: 'video_capture_deprecated'.
 *
 * Step 3 does NOT delete the run documents. Same rule the retention sweeper
 * follows: the bytes go, the record that a capture happened stays, so an audit can
 * still answer "was this tab recorded on that date, and what became of it".
 *
 * Usage:
 *   node scripts/cleanup-video-recordings.mjs [--dry-run]
 *
 * Reads MONGODB_URI from server/.env. --dry-run reports what it would do and
 * writes nothing.
 */
import dotenv from 'dotenv';
dotenv.config();

import { MongoClient } from 'mongodb';

const MONGODB_URI = process.env.MONGODB_URI;
const DRY_RUN = process.argv.includes('--dry-run');

const COLL_RECORDINGS = 'session_recordings';
const COLL_SEGMENTS = 'session_recording_segments';
const GRIDFS_BUCKET = 'recording_videos';
const CAPTURE_TAB_VIDEO = 'tab_video';
const PURGE_REASON = 'video_capture_deprecated';

if (!MONGODB_URI) {
  console.error('MONGODB_URI not set in .env');
  process.exit(1);
}

async function listCollections(db) {
  const names = await db.listCollections({}, { nameOnly: true }).toArray();
  return new Set(names.map((c) => c.name));
}

// Drop a collection only if it exists, so a re-run is a no-op instead of an error.
async function dropIfPresent(db, present, name) {
  if (!present.has(name)) {
    console.log(`  ${name}: not present, nothing to drop`);
    return { dropped: false, documents: 0 };
  }
  const documents = await db.collection(name).countDocuments();
  if (DRY_RUN) {
    console.log(`  ${name}: WOULD DROP (${documents} document(s))`);
    return { dropped: false, documents };
  }
  await db.collection(name).drop();
  console.log(`  ${name}: dropped (${documents} document(s))`);
  return { dropped: true, documents };
}

async function main() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db();
  console.log(`Connected to MongoDB: ${db.databaseName}${DRY_RUN ? '  [DRY RUN]' : ''}`);

  const present = await listCollections(db);

  // ── 1. The GridFS bucket ───────────────────────────────────────────────────
  // Dropped as its two backing collections rather than via GridFSBucket.drop(),
  // so the script does not need the bucket to be well-formed (a half-deleted
  // bucket with .chunks but no .files is exactly the state worth cleaning up).
  console.log(`\n=== GridFS bucket '${GRIDFS_BUCKET}' ===`);
  const files = await dropIfPresent(db, present, `${GRIDFS_BUCKET}.files`);
  const chunks = await dropIfPresent(db, present, `${GRIDFS_BUCKET}.chunks`);

  // ── 2. The segment pointer collection ──────────────────────────────────────
  console.log(`\n=== Collection '${COLL_SEGMENTS}' ===`);
  const segments = await dropIfPresent(db, present, COLL_SEGMENTS);

  // ── 3. Tombstone the video runs ────────────────────────────────────────────
  console.log(`\n=== Tombstoning '${COLL_RECORDINGS}' runs with capture: '${CAPTURE_TAB_VIDEO}' ===`);
  const runsColl = db.collection(COLL_RECORDINGS);
  const videoRuns = await runsColl
    .find({ capture: CAPTURE_TAB_VIDEO })
    .project({ _id: 0, recording_id: 1, machine_id: 1, status: 1, byte_size: 1, segment_count: 1 })
    .toArray();

  const alreadyPurged = await runsColl.countDocuments({
    capture: CAPTURE_TAB_VIDEO,
    purged_reason: PURGE_REASON,
  });

  console.log(`  found ${videoRuns.length} tab_video run(s)` +
    (alreadyPurged ? ` (${alreadyPurged} already tombstoned by a previous run of this script)` : ''));
  for (const r of videoRuns) {
    console.log(`    ${r.recording_id}  machine=${r.machine_id}  status=${r.status}  ` +
      `segments=${r.segment_count ?? 0}  bytes=${r.byte_size ?? 0}`);
  }

  let modified = 0;
  if (videoRuns.length && !DRY_RUN) {
    const now = new Date();
    const res = await runsColl.updateMany(
      { capture: CAPTURE_TAB_VIDEO },
      {
        $set: {
          status: 'expired',
          expired_at: now,
          purged_at: now,
          purged_reason: PURGE_REASON,
        },
      },
    );
    modified = res.modifiedCount ?? 0;
    console.log(`  tombstoned ${modified} run(s) — documents KEPT as audit tombstones, not deleted`);
  } else if (videoRuns.length) {
    console.log(`  WOULD tombstone ${videoRuns.length} run(s) — documents kept, not deleted`);
  }

  // Sanity check: the run documents must still be there.
  const survivors = await runsColl.countDocuments({ capture: CAPTURE_TAB_VIDEO });

  console.log('\n=== Summary ===');
  console.log(JSON.stringify({
    dry_run: DRY_RUN,
    gridfs_files_dropped: files.dropped,
    gridfs_files_documents: files.documents,
    gridfs_chunks_dropped: chunks.dropped,
    gridfs_chunks_documents: chunks.documents,
    segments_collection_dropped: segments.dropped,
    segments_documents: segments.documents,
    video_runs_found: videoRuns.length,
    video_runs_tombstoned: modified,
    video_runs_still_present: survivors,
  }, null, 2));

  await client.close();
}

main().catch((err) => { console.error('Cleanup failed:', err); process.exit(1); });

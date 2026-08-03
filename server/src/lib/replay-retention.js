// Retention sweeper for session replays (rrweb DOM recordings).
//
// Adapted from the video-phase sweeper this replaces. Two things changed, one did
// not:
//   • The blob store is gone. Chunk payloads are inline documents in
//     session_replay_chunks, so "delete the blobs, then the pointer rows, then
//     mark the run expired" collapses to "delete the chunk rows, mark the run
//     expired". There is no orphan class left to defer for, so there is no
//     deferral path either.
//   • Only `capture: 'dom_events'` runs are swept. Legacy 'tab_video' rows live in
//     the same collection but their bytes were in a GridFS bucket this file no
//     longer knows about; tombstoning them here would claim a purge that never
//     happened. scripts/cleanup-video-recordings.mjs is what retires those.
//   • The run document is still NEVER hard-deleted. It stays as a tombstone
//     (`status: 'expired'`) so an audit can answer "was this tab recorded on that
//     date, and what happened to the recording" after the events are gone. That
//     answer is the point of a governance product; losing it would be worse than
//     keeping a few hundred bytes.
//
// A MongoDB TTL index still cannot do this job: TTL would delete the run document
// — the tombstone — and leave its chunk documents behind with nothing pointing at
// them. So retention stays an explicit sweep.

const COLL_RECORDINGS = 'session_recordings';
const COLL_CHUNKS = 'session_replay_chunks';
const CAPTURE_DOM_EVENTS = 'dom_events';

export const DEFAULT_SWEEP_INTERVAL_MS = 15 * 60 * 1000;   // 15 min

// Bounded per pass so a large backlog degrades into several sweeps instead of one
// very long one holding a connection.
const DEFAULT_BATCH = 100;

export async function sweepExpiredReplays(db, options = {}) {
  const now = options.now ?? new Date();
  const batch = options.batch ?? DEFAULT_BATCH;

  const expired = await db.collection(COLL_RECORDINGS)
    .find({
      capture: CAPTURE_DOM_EVENTS,
      expires_at: { $lt: now },
      status: { $ne: 'expired' },
    })
    .limit(batch)
    .project({ _id: 0, recording_id: 1, machine_id: 1, status: 1, chunk_count: 1, byte_size: 1 })
    .toArray();

  const result = {
    replays_scanned: expired.length,
    replays_expired: 0,
    chunks_deleted: 0,
    bytes_freed: 0,
    errors: 0,
  };

  for (const run of expired) {
    try {
      // Count and size before the delete, so the tombstone can record what was
      // actually purged rather than what the run's counters claimed.
      const chunks = await db.collection(COLL_CHUNKS)
        .find({ recording_id: run.recording_id })
        .project({ _id: 0, seq: 1, byte_size: 1 })
        .toArray();
      const freed = chunks.reduce((t, c) => t + (c.byte_size || 0), 0);

      const del = await db.collection(COLL_CHUNKS).deleteMany({ recording_id: run.recording_id });
      const deleted = del?.deletedCount ?? 0;

      await db.collection(COLL_RECORDINGS).updateOne(
        { recording_id: run.recording_id },
        {
          $set: {
            status: 'expired',
            expired_at: now,
            purged_at: now,
            purged_reason: 'retention_expired',
            // What the tombstone is allowed to remember: how much was purged, not
            // anything about what was in it.
            purged_chunk_count: deleted,
            purged_byte_size: freed,
          },
        },
      );

      result.chunks_deleted += deleted;
      result.bytes_freed += freed;
      result.replays_expired++;
    } catch (err) {
      // One bad run must not stop the pass; the next sweep retries it because it is
      // still un-expired and still past expires_at.
      result.errors++;
      console.error(`[replay-retention] sweep failed replay=${run.recording_id}: ${err.message}`);
    }
  }

  return result;
}

// Kick one sweep at startup (expiries accrue while the process is down), then on
// an interval. Kept as a plain unref'd setInterval rather than pulling in a cron
// dependency for one job.
export function startReplayRetentionSweeper(db, options = {}) {
  const intervalMs = options.intervalMs ?? DEFAULT_SWEEP_INTERVAL_MS;

  const run = async () => {
    try {
      const r = await sweepExpiredReplays(db, { batch: options.batch });
      // Silent when there was nothing to do — this runs every 15 minutes forever.
      if (r.replays_scanned > 0) {
        console.log(
          `[replay-retention] expired ${r.replays_expired} replay(s), ` +
          `deleted ${r.chunks_deleted} chunk(s), freed ${r.bytes_freed} bytes` +
          (r.errors ? `, ${r.errors} error(s)` : ''),
        );
      }
    } catch (err) {
      // A failed sweep must never take the server down; the next tick retries.
      console.error(`[replay-retention] sweep failed: ${err.message}`);
    }
  };

  run();
  const timer = setInterval(run, intervalMs);
  // Do not hold the event loop open on its own account.
  timer.unref?.();
  return () => clearInterval(timer);
}

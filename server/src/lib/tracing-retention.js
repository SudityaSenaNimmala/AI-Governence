// Retention sweeper for locally-stored traces (CFAI_TRACING_BACKEND=local).
//
// Modelled on lib/replay-retention.js, and it exists for the same reason that one
// does: a MongoDB TTL index cannot do this job. TTL would delete the PARENT
// document — the lf_traces row — and leave its lf_observations children behind
// with nothing pointing at them, plus their lf_observation_io rows, which are the
// only place raw prompt/completion text is ever stored. Orphaned content that no
// route can reach and no sweeper will ever find again is the worst possible
// outcome for a governance product. So retention is an explicit, ordered sweep:
// children first, parent last.
//
// One difference from replay-retention.js: a trace is HARD-deleted, not left as a
// tombstone. A session recording tombstone answers "was this user's screen
// recorded on that date" — an audit question worth keeping bytes for. A developer's
// own SDK trace has no equivalent question; the project's lifetime counters on
// sdk_projects already survive independently, so nothing is lost by removing the
// row outright.

const COLL_TRACES = 'lf_traces';
const COLL_OBSERVATIONS = 'lf_observations';
const COLL_IO = 'lf_observation_io';

export const DEFAULT_SWEEP_INTERVAL_MS = 60 * 60 * 1000;   // hourly

// Bounded per pass so a large backlog degrades into several sweeps instead of one
// very long one holding a connection.
const DEFAULT_BATCH = 200;

export async function sweepExpiredTraces(db, options = {}) {
  const now = options.now ?? new Date();
  const batch = options.batch ?? DEFAULT_BATCH;

  const expired = await db.collection(COLL_TRACES)
    .find({ expires_at: { $lt: now } })
    .limit(batch)
    .project({ _id: 0, project_id: 1, id: 1 })
    .toArray();

  const result = {
    traces_scanned: expired.length,
    traces_deleted: 0,
    observations_deleted: 0,
    io_deleted: 0,
    orphans_deleted: 0,
    errors: 0,
  };

  for (const trace of expired) {
    try {
      const scope = { project_id: trace.project_id, trace_id: trace.id };
      const children = await db.collection(COLL_OBSERVATIONS)
        .find(scope)
        .project({ _id: 0, id: 1 })
        .toArray();

      // Raw content first: if the process dies mid-sweep, the surviving state is
      // "metadata without content", never "content nothing points at".
      for (const child of children) {
        const io = await db.collection(COLL_IO)
          .deleteMany({ project_id: trace.project_id, observation_id: child.id });
        result.io_deleted += io?.deletedCount ?? 0;
      }

      const obs = await db.collection(COLL_OBSERVATIONS).deleteMany(scope);
      result.observations_deleted += obs?.deletedCount ?? 0;

      const del = await db.collection(COLL_TRACES)
        .deleteMany({ project_id: trace.project_id, id: trace.id });
      result.traces_deleted += del?.deletedCount ?? 0;
    } catch (err) {
      // One bad trace must not stop the pass; the next sweep retries it because
      // it is still past expires_at.
      result.errors++;
      console.error(`[tracing-retention] sweep failed trace=${trace.id}: ${err.message}`);
    }
  }

  // Second pass: observations (and their content) whose own expiry has passed but
  // whose trace row is already gone — the residue of a partially-failed sweep, or
  // of an observation whose stub trace was deleted under a shorter retention. The
  // whole point of not using TTL is that nothing is left unreachable, so this pass
  // is what makes that claim true rather than aspirational.
  try {
    const orphanIo = await db.collection(COLL_IO).deleteMany({ expires_at: { $lt: now } });
    result.io_deleted += orphanIo?.deletedCount ?? 0;
    const orphans = await db.collection(COLL_OBSERVATIONS).deleteMany({ expires_at: { $lt: now } });
    result.orphans_deleted = orphans?.deletedCount ?? 0;
    result.observations_deleted += result.orphans_deleted;
  } catch (err) {
    result.errors++;
    console.error(`[tracing-retention] orphan sweep failed: ${err.message}`);
  }

  return result;
}

// Kick one sweep at startup (expiries accrue while the process is down), then on
// an interval. A plain unref'd setInterval rather than a cron dependency for one
// job, exactly as lib/replay-retention.js does.
export function startTracingRetentionSweeper(db, options = {}) {
  const intervalMs = options.intervalMs ?? DEFAULT_SWEEP_INTERVAL_MS;

  const run = async () => {
    try {
      const r = await sweepExpiredTraces(db, { batch: options.batch });
      // Silent when there was nothing to do — this runs forever.
      if (r.traces_scanned > 0 || r.orphans_deleted > 0) {
        console.log(
          `[tracing-retention] deleted ${r.traces_deleted} trace(s), ` +
          `${r.observations_deleted} observation(s), ${r.io_deleted} content row(s)` +
          (r.errors ? `, ${r.errors} error(s)` : ''),
        );
      }
    } catch (err) {
      // A failed sweep must never take the server down; the next tick retries.
      console.error(`[tracing-retention] sweep failed: ${err.message}`);
    }
  };

  run();
  const timer = setInterval(run, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}

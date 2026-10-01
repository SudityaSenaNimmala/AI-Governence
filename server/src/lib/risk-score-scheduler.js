// Background recompute of AI Risk Scores.
//
// Scores used to move only when an admin clicked "Compute Scores", so the
// Risk Scores tab showed whatever the last click left behind — days old on a
// quiet week, and wrong the moment a new machine enrolled. This runs the same
// thing the button does (resolve profiles, then computeAllScores) on a timer.
//
// Same shape as replay-retention.js: a plain unref'd timer, every failure
// caught and logged, never fatal. Interval from RISK_SCORE_INTERVAL_MIN
// (default 15 minutes; 0 disables). The first run waits ~60s after boot so it
// does not compete with the deploy health check and boot-time warmers.

import { computeAllScores, isRiskComputeRunning } from '../routes/risk-score.js';
import { resolveProfiles } from '../routes/identity.js';

export const DEFAULT_RISK_INTERVAL_MIN = 15;
export const DEFAULT_FIRST_RUN_DELAY_MS = 60 * 1000;

/** Parse RISK_SCORE_INTERVAL_MIN: unset/blank/invalid → default, <= 0 → disabled (0). */
export function riskIntervalMsFromEnv(env = process.env) {
  const raw = env.RISK_SCORE_INTERVAL_MIN;
  if (raw === undefined || String(raw).trim() === '') return DEFAULT_RISK_INTERVAL_MIN * 60 * 1000;
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_RISK_INTERVAL_MIN * 60 * 1000;
  return n <= 0 ? 0 : Math.round(n * 60 * 1000);
}

/**
 * One scheduled pass. Exported for tests. Never throws.
 * @returns {Promise<{ skipped?: boolean, reason?: string, computed?: number, error?: string }>}
 */
export async function runRiskScorePass(db, state = { running: false }) {
  // Overlap guard: a previous tick still going, or a manual POST /compute in flight.
  if (state.running || isRiskComputeRunning(db)) return { skipped: true, reason: 'in_flight' };
  state.running = true;
  try {
    // Resolve first so machines that enrolled since the last pass get profiles
    // and are scored now rather than on the next admin click.
    const machines = await db.collection('machines').find({}).project({ _id: 0 }).toArray();
    await resolveProfiles(db, machines);
    const r = await computeAllScores(db, { source: 'scheduler', ifBusy: 'skip' });
    if (!r.skipped && (r.history_written || r.alerts_fired)) {
      console.log(`[risk-score] scheduled run: ${r.computed} person(s), ${r.history_written} changed, ${r.alerts_fired} alert(s)`);
    }
    return r;
  } catch (err) {
    console.error(`[risk-score] scheduled run failed: ${err.message}`);
    return { error: err.message };
  } finally {
    state.running = false;
  }
}

/**
 * @param {object} db
 * @param {{ intervalMs?: number, firstRunDelayMs?: number }} [options]
 * @returns {() => void} stop function (no-op when disabled)
 */
export function startRiskScoreScheduler(db, options = {}) {
  const intervalMs = options.intervalMs ?? riskIntervalMsFromEnv();
  if (!intervalMs || intervalMs <= 0) {
    console.log('[risk-score] scheduler disabled (RISK_SCORE_INTERVAL_MIN=0)');
    return () => {};
  }
  const firstRunDelayMs = options.firstRunDelayMs ?? DEFAULT_FIRST_RUN_DELAY_MS;
  const state = { running: false };
  const run = () => { runRiskScorePass(db, state).catch(() => {}); };

  const first = setTimeout(run, firstRunDelayMs);
  first.unref?.();
  const timer = setInterval(run, intervalMs);
  // Do not hold the event loop open on its own account.
  timer.unref?.();
  return () => { clearTimeout(first); clearInterval(timer); };
}

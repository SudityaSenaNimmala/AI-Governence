// Structured capture of server errors, so a live failure becomes a queryable
// record instead of a line in a container log nobody is reading.
//
// This exists to feed the auto-triage pipeline: an error here is the INPUT to
// analysis, a fix and a pull request. Two properties therefore matter more than
// they would for ordinary logging.
//
// ── 1. WHAT IS STORED IS UNTRUSTED AND POSSIBLY SENSITIVE ────────────────────
//
// This is a DLP product. An error thrown while handling a prompt, a filename or
// an agent name can carry that text in its message, and a stack can carry a
// query string. Storing it raw would put the very content this product exists
// to protect into a collection nobody thinks of as sensitive, and would then
// feed it to an agent that writes code.
//
// So every free-text field goes through maskSensitive() before it is stored --
// the same masking the DLP paths already use -- and is length-capped. The
// fingerprint is computed from the NORMALISED text, so masking cannot change
// which errors dedup together.
//
// ── 2. THE CAPTURE PATH MUST NEVER THROW ─────────────────────────────────────
//
// It runs inside an Express error handler, i.e. on a request that has already
// failed. An exception here would replace a useful 500 with a confusing one and
// could take the process down from an unhandled rejection. Every function below
// is wrapped, and a failure to record is swallowed after one console line.
import crypto from 'node:crypto';
import { maskSensitive } from './mask-sensitive.js';

// Caps. A stack is useful for a handful of frames; the rest is noise that costs
// storage and makes the fingerprint brittle.
const MAX_FRAMES = 12;
const MAX_MESSAGE = 500;
const MAX_STACK = 4000;

// Values that vary per occurrence but do not change WHICH bug this is. They are
// removed before fingerprinting so "user 41 not found" and "user 9137 not
// found" are one error rather than two, while the stored message (masked) still
// shows a real example.
const VARIABLE = [
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<uuid>'],
  [/\b[0-9a-f]{24,}\b/gi, '<hex>'],
  [/\b\d+\b/g, '<n>'],
  [/'[^']*'/g, "'<s>'"],
  [/"[^"]*"/g, '"<s>"'],
];

function normalizeForFingerprint(text) {
  let t = String(text || '');
  for (const [re, to] of VARIABLE) t = t.replace(re, to);
  return t.trim();
}

// Absolute paths differ between a developer's machine and the container, and
// line/column numbers move with every unrelated edit above them. Both are
// stripped so a fingerprint survives a reformat and matches across machines.
function normalizeFrame(line) {
  return String(line || '')
    .replace(/\(?(?:file:\/\/)?[A-Za-z]:[\\/][^\s)]+/g, '(<path>')
    .replace(/\(?(?:file:\/\/)?\/[^\s)]+/g, '(<path>')
    .replace(/:\d+:\d+/g, ':<line>')
    .trim();
}

/**
 * A stable id for "which bug is this".
 *
 * Deliberately NOT a hash of the raw message: that would split one bug into a
 * new row per request and drown the triage queue, which is the failure mode
 * that makes error dashboards useless.
 */
export function fingerprintError(err, route) {
  try {
    const name = (err && err.name) || 'Error';
    const msg = normalizeForFingerprint((err && err.message) || '');
    const frames = String((err && err.stack) || '')
      .split('\n')
      .filter((l) => l.trim().startsWith('at '))
      .slice(0, 5)
      .map(normalizeFrame)
      .join('|');
    const basis = `${name}::${msg}::${frames}::${route || ''}`;
    return crypto.createHash('sha256').update(basis).digest('hex').slice(0, 16);
  } catch {
    // A fingerprint we cannot compute must not lose the error. Bucket it under
    // a constant so it is still visible, rather than dropping it.
    return 'unfingerprintable';
  }
}

function safeStack(err) {
  const raw = String((err && err.stack) || '');
  // MASK PER LINE, then rejoin. maskSensitive collapses every run of
  // whitespace into a single space -- correct for a prompt fragment, wrong
  // for a stack. Passing the whole trace through it produced ONE unreadable
  // line and threw away the frame structure that is the only reason to store
  // a stack at all. Masking each frame separately keeps the redaction and
  // keeps the shape.
  const frames = raw.split(/\r?\n/).slice(0, MAX_FRAMES)
    .map((line) => maskSensitive(line, 300));
  const joined = frames.join('\n');
  return joined.length > MAX_STACK ? joined.slice(0, MAX_STACK) + '\u2026' : joined;
}

/**
 * Record one error occurrence. Upserts by fingerprint and bumps a count, so the
 * collection holds one row per BUG rather than one per request.
 *
 * `resolved` is deliberately NOT reset when an old fingerprint reappears: a
 * human or the pipeline marks a bug resolved, and a late straggler from a
 * pod that had not yet restarted must not silently reopen it. `last_seen` still
 * moves, so a genuinely recurring error is visible as a resolved row with a
 * fresh timestamp -- which is the signal that a fix did not work.
 */
export async function recordError(db, err, ctx = {}) {
  try {
    if (!db || !err) return null;
    const route = ctx.route || '';
    const fingerprint = fingerprintError(err, route);
    const now = new Date();
    await db.collection('server_errors').updateOne(
      { fingerprint },
      {
        $set: {
          name: (err.name || 'Error').slice(0, 80),
          message: maskSensitive(err.message || '', MAX_MESSAGE),
          stack: safeStack(err),
          route,
          method: (ctx.method || '').slice(0, 10),
          status: Number(ctx.status) || 500,
          kind: ctx.kind || 'request',
          last_seen: now,
          // The build this occurred on, so a fix can be tied to a release and a
          // reappearance after a deploy is distinguishable from one before it.
          release: (process.env.GIT_SHA || process.env.RELEASE || '').slice(0, 40),
        },
        $inc: { count: 1 },
        $setOnInsert: { fingerprint, first_seen: now, resolved: false },
      },
      { upsert: true },
    );
    return fingerprint;
  } catch (e) {
    // Never let recording a failure become a failure.
    console.error('[error-capture] could not record:', e && e.message);
    return null;
  }
}

/**
 * Mount the Express error handler plus the two process-level hooks.
 *
 * The process hooks matter as much as the request handler: the errors that take
 * a server down are exactly the ones that never reach an Express middleware,
 * and those are the ones worth waking a pipeline for.
 */
export function mountErrorCapture(app, db) {
  app.use((err, req, res, _next) => {
    const route = (req && (req.route?.path || req.path)) || '';
    recordError(db, err, {
      route,
      method: req && req.method,
      status: err && err.status,
      kind: 'request',
    });
    // Unchanged from the handler this replaces: the response shape is part of
    // the API and is not this change's business.
    console.error('Server error:', err);
    if (res && !res.headersSent) {
      res.status((err && err.status) || 500).json({ error: err && err.message });
    }
  });

  process.on('unhandledRejection', (reason) => {
    const e = reason instanceof Error ? reason : new Error(String(reason));
    recordError(db, e, { kind: 'unhandledRejection', status: 0 });
    console.error('unhandledRejection:', e && e.message);
  });

  // NOT swallowed. An uncaughtException leaves the process in an undefined
  // state, and a server that keeps serving from one is worse than one that
  // restarts -- the deploy already health-checks and rolls back. Recorded
  // first, then rethrown on the next tick so the default handler still exits.
  process.on('uncaughtException', (e) => {
    recordError(db, e, { kind: 'uncaughtException', status: 0 });
    console.error('uncaughtException:', e && e.message);
    setTimeout(() => { throw e; }, 50);
  });
}

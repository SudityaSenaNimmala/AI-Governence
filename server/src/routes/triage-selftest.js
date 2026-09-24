// Deliberate, realistic failures for proving the auto-triage pipeline works on
// the live server.
//
// WHY THIS EXISTS RATHER THAN A PLANTED BUG. The pipeline can only be trusted
// once it has been watched end to end on a real error: captured, fingerprinted,
// bundled, diagnosed, fixed, PR'd. Getting that evidence by breaking a real
// code path would mean shipping broken governance to real users — in this
// product a "temporary" bug in the enforcer or a catalog gate is not a test, it
// is an outage nobody can see. These routes produce the same SHAPES of failure
// through real repo code while touching nothing anyone depends on.
//
// OFF BY DEFAULT. Mounted only when TRIAGE_SELFTEST=1. Remove the variable when
// the pipeline has been proven and these routes disappear with it.
//
// Even enabled the blast radius is small: no route writes data, none can crash
// the process, and because the capture layer deduplicates by fingerprint, an
// attacker hammering them produces three rows total rather than a flood.
//
// DELIBERATELY ABSENT: an uncaughtException trigger. That hook rethrows by
// design so the process exits and the deploy's health check rolls back — which
// is correct behaviour and exactly why it must not be reachable from an HTTP
// request on a live server.

// ── Error 1 ──────────────────────────────────────────────────────────────────
// The single most common real defect: an optional field is absent and the code
// reaches through it. Realistic because the fix is genuinely ambiguous — guard
// the read, or fix the caller that omitted the field — which is what makes it
// worth watching the pipeline reason about.
function resolveSurfaceHost(surface) {
  // No guard, on purpose.
  return surface.config.host.toLowerCase();
}

// ── Error 2 ──────────────────────────────────────────────────────────────────
// A parse/validation failure deep in a helper, with the bad value carried in
// the message. This one also exercises the MASKING path: the value below looks
// like a credential, and the stored row must not contain it in the clear.
function parseRetentionWindow(raw) {
  const days = Number(raw);
  if (!Number.isFinite(days) || days <= 0) {
    throw new RangeError(`retention window must be a positive number of days, got ${JSON.stringify(raw)}`);
  }
  return days;
}

// ── Error 3 ──────────────────────────────────────────────────────────────────
// An async rejection nobody awaited. Exercises the process-level hook rather
// than the Express handler, which is the path that catches the failures that
// would otherwise vanish entirely.
async function refreshCacheEntry(key) {
  await new Promise((r) => setTimeout(r, 5));
  throw new Error(`cache refresh failed for key ${key}: upstream returned no document`);
}

export function mountTriageSelftest(app) {
  if (process.env.TRIAGE_SELFTEST !== '1') return false;

  console.warn('[triage-selftest] ENABLED — /api/v1/_selftest/* will throw on purpose. '
    + 'Unset TRIAGE_SELFTEST when the pipeline has been proven.');

  // GET /api/v1/_selftest/typeerror
  app.get('/api/v1/_selftest/typeerror', (req, res, next) => {
    try {
      // `config` is missing, so the read inside throws — a real TypeError with
      // a real stack through this file.
      const host = resolveSurfaceHost({ id: 'selftest_surface' });
      res.json({ host });
    } catch (e) { next(e); }
  });

  // GET /api/v1/_selftest/validation?days=abc
  app.get('/api/v1/_selftest/validation', (req, res, next) => {
    try {
      // Defaults to a value shaped like a secret, so the masking in the capture
      // layer is exercised by a row a human will actually look at.
      const raw = req.query.days ?? 'sk-live-4eC39HqLyjWDarjtT1zdp7dc';
      res.json({ days: parseRetentionWindow(raw) });
    } catch (e) { next(e); }
  });

  // GET /api/v1/_selftest/rejection
  app.get('/api/v1/_selftest/rejection', (req, res) => {
    // Deliberately NOT awaited and NOT caught: this is the point of the route.
    // The request succeeds; the failure surfaces through unhandledRejection a
    // tick later, which is the only way to prove that hook records anything.
    refreshCacheEntry(String(req.query.key || 'surface:mail.google.com'));
    res.json({ ok: true, note: 'rejection fires asynchronously; check /api/v1/errors' });
  });

  return true;
}

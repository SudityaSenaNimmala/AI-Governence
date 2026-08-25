import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';

// In dev: env vars JWT_SECRET and ENROLL_SECRET.
// In prod: load from a secrets store (Azure Key Vault / AWS Secrets Manager).
export const JWT_SECRET = process.env.JWT_SECRET || generateDevSecret();
export const ENROLL_SECRET = process.env.ENROLL_SECRET || 'dev-enroll-secret-change-me';

function generateDevSecret() {
  // Stable per-process in dev. Logging at startup makes it easy to copy for the agent.
  return crypto.randomBytes(32).toString('hex');
}

export function signMachineToken({ machineId, hostname }) {
  return jwt.sign(
    { sub: machineId, hostname, kind: 'machine' },
    JWT_SECRET,
    { algorithm: 'HS256', expiresIn: '365d', issuer: 'cloudfuze-ai-gov' }
  );
}

// Express middleware. Attaches req.machine = { id, hostname } on success.
export function requireMachineAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const m = header.match(/^Bearer\s+(.+)$/);
  if (!m) return res.status(401).json({ error: 'missing bearer token' });
  try {
    const claims = jwt.verify(m[1], JWT_SECRET, { issuer: 'cloudfuze-ai-gov' });
    if (claims.kind !== 'machine') return res.status(403).json({ error: 'wrong token kind' });
    req.machine = { id: claims.sub, hostname: claims.hostname };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'invalid token: ' + err.message });
  }
}

// Admin auth — for dashboard endpoints. v0 uses a single ADMIN_TOKEN.
// In v1 wire to your SSO (Microsoft Entra ID etc.).
export const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'dev-admin-token';

// Enforced in EVERY environment, including local dev.
//
// This middleware used to `return next()` whenever NODE_ENV !== 'production',
// which made it decorative: a route "protected" by it was wide open on every
// developer machine and in every non-prod deployment (NODE_ENV is unset by
// default, so `npm run dev` and a plain `node src/index.js` in staging both took
// the bypass). Session recordings are video of a user's screen — the most
// sensitive artefact this product stores — so a middleware that no-ops outside
// production is not an acceptable guard for them.
//
// Removing the bypass is safe as a shared change: no route consumed
// requireAdminAuth before the recordings routes did, so there is no existing
// caller whose behaviour this alters. Read routes that were deliberately left
// open (GET /api/v1/dlp, GET /api/v1/sessions) are open because they never
// referenced this function, and they stay exactly as they were — this does not
// silently lock down the local dashboard.
//
// Dev convenience is preserved by the token itself, not by an env check: with no
// ADMIN_TOKEN set the value is the well-known 'dev-admin-token', which startup
// logs, so a local caller just sends `Authorization: Bearer dev-admin-token`.
// ADMIN_AUTH_OPEN — a deliberate, temporary hole, opted into per deployment.
//
// WHY IT EXISTS. The dashboard has no way for a person to sign in yet, so every
// admin-gated panel (Access Requests, Active Exceptions, session replay, SDK
// projects) is unusable in a deployment: the browser has no credential to send and
// the server correctly answers 401. The alternative stopgaps are worse — baking
// ADMIN_TOKEN into the client bundle publishes it to every visitor, and asking
// each admin to paste a shared token is a credential-handling habit worth not
// teaching. Admin OAuth is the real answer and is deliberately deferred.
//
// WHAT IT COSTS, stated so it is chosen rather than discovered. With this on,
// anyone who can reach the API can read access requests and approve, reject or
// revoke them — which for a governance product means an outsider could grant
// access to a blocked AI tool. It is only defensible while the host is reachable
// solely from inside the network or by people who would be admins anyway.
//
// DEFAULT OFF, so nobody gets this by upgrading. Enabling it logs a warning on
// every request path that uses it, once, because a hole nothing mentions is a hole
// nobody remembers to close. Delete this branch when OAuth lands.
// Trimmed, because .env parsers routinely leave trailing whitespace and
// `ADMIN_AUTH_OPEN=true ` is unambiguous in intent. Still an exact match on
// "true" otherwise: "1"/"yes"/"on" must NOT enable it, so a mistyped value fails
// closed rather than opening the admin surface by accident.
const ADMIN_AUTH_OPEN = String(process.env.ADMIN_AUTH_OPEN || '').trim().toLowerCase() === 'true';
let _openWarned = false;

export function requireAdminAuth(req, res, next) {
  if (ADMIN_AUTH_OPEN) {
    if (!_openWarned) {
      _openWarned = true;
      console.warn('[auth] ADMIN_AUTH_OPEN=true — admin routes are UNAUTHENTICATED. '
        + 'Anyone who can reach this API can approve or revoke tool access. '
        + 'Intended as a stopgap until admin OAuth ships; unset it to re-enable auth.');
    }
    return next();
  }
  const header = req.headers.authorization || '';
  const m = header.match(/^Bearer\s+(.+)$/);
  if (!m || !constantTimeEqual(m[1], ADMIN_TOKEN)) {
    return res.status(401).json({ error: 'admin auth required' });
  }
  next();
}

/** Exposed so the dashboard can say out loud that admin auth is off. */
export function adminAuthIsOpen() { return ADMIN_AUTH_OPEN; }

// Length-independent comparison: bail on a length mismatch (already public via
// the token's own format) and otherwise compare in constant time so a wrong
// token cannot be refined byte-by-byte from response timing.
// Exported so callers that authenticate with the enroll secret (enroll.js,
// browser-coverage.js) share one implementation. Comparing secrets with === leaks
// their length and prefix through timing, which is worth exactly one function.
export function constantTimeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

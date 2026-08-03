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
export function requireAdminAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const m = header.match(/^Bearer\s+(.+)$/);
  if (!m || !constantTimeEqual(m[1], ADMIN_TOKEN)) {
    return res.status(401).json({ error: 'admin auth required' });
  }
  next();
}

// Length-independent comparison: bail on a length mismatch (already public via
// the token's own format) and otherwise compare in constant time so a wrong
// token cannot be refined byte-by-byte from response timing.
function constantTimeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

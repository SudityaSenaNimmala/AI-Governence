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

export function requireAdminAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const m = header.match(/^Bearer\s+(.+)$/);
  if (!m || m[1] !== ADMIN_TOKEN) {
    // Allow unauthenticated reads in dev for the local dashboard convenience
    if (process.env.NODE_ENV !== 'production') return next();
    return res.status(401).json({ error: 'admin auth required' });
  }
  next();
}

import crypto from 'node:crypto';

// Third-party integration helpers: API-key generation/hashing and webhook signing.

// Generate a display-prefixed random API key. The full key is shown ONCE at
// creation; only its SHA-256 hash is stored.
export function generateApiKey() {
  const secret = crypto.randomBytes(24).toString('base64url');
  const key = `cfgov_${secret}`;
  return { key, hash: hashApiKey(key), hint: key.slice(0, 12) + '…' };
}

export function hashApiKey(key) {
  return crypto.createHash('sha256').update(String(key)).digest('hex');
}

// Constant-time compare of a presented key against a stored hash.
export function apiKeyMatches(presentedKey, storedHash) {
  if (!presentedKey || !storedHash) return false;
  const a = Buffer.from(hashApiKey(presentedKey));
  const b = Buffer.from(String(storedHash));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// HMAC-SHA256 signature for a webhook body, so receivers can verify authenticity.
export function signWebhook(secret, rawBody) {
  return 'sha256=' + crypto.createHmac('sha256', String(secret)).update(rawBody).digest('hex');
}

export function newSecret(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

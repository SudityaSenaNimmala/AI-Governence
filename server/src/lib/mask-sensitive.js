/**
 * Mask sensitive values before any captured text is displayed back.
 *
 * This is a DLP product: the text it holds is sensitive precisely because a
 * detector already flagged it. Re-printing that text into a compliance screen
 * leaks the exact value the policy exists to stop — to a wider audience than the
 * original prompt had, since a dashboard is read by people who were never party
 * to the conversation.
 *
 * One implementation, used everywhere, because two drifted:
 *
 *   policySimulator.ts  had a careful masker with a thoughtful comment…
 *   prompts.ts          stored `text.substring(0, 250)` verbatim and served it
 *                       from an unauthenticated GET — and it only creates that
 *                       record BECAUSE it matched an SSN, card, password: or
 *                       api_key:, so the snippet is worst-case by construction.
 *
 * Gaps closed relative to the old policySimulator version (each verified against
 * the detector catalog in browser-extension/content/patterns.js — these are cases
 * where the detector FIRES, so the event is in scope, but the mask missed and the
 * raw value was printed):
 *
 *   "4111 - 1111 - 1111 - 1111"     card written with space-dash-space
 *   "-----BEGIN PRIVATE KEY-----"   GCP service-account / RSA private keys
 *   "123456789" / "123 45 6789"     SSN without dashes
 *   aws_secret_access_key=…         AWS secret (only the AKIA id was masked)
 *   AccountKey=…==                  Azure storage connection strings
 *   Authorization: Bearer …         bearer tokens that are not JWTs
 *   CF-CUST-A1B2C3                  internal customer identifiers
 *
 * Order matters: structural patterns (private keys, connection strings) run before
 * the generic number/word patterns, so a key body is not first chewed up by the
 * card or SSN rules.
 */

/** Ordered list so the most specific/structural patterns mask first. */
const RULES = [
  // ── Structural secrets ─────────────────────────────────────────────────────
  // PEM blocks: mask the whole block, not just the header, or the body leaks.
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[PRIVATE_KEY]'],
  // An unterminated PEM header still means a key was pasted.
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]{0,4000}/g, '[PRIVATE_KEY]'],
  // GCP service-account JSON leaks via its private_key field.
  [/"private_key"\s*:\s*"[^"]*"/g, '"private_key":"[PRIVATE_KEY]"'],
  // Azure storage / service-bus connection strings.
  [/\bAccountKey=[A-Za-z0-9+/=]{20,}/gi, 'AccountKey=[SECRET]'],
  [/\bSharedAccessKey=[A-Za-z0-9+/=]{20,}/gi, 'SharedAccessKey=[SECRET]'],

  // ── Named credentials ──────────────────────────────────────────────────────
  [/\b(aws_secret_access_key|aws_session_token)\s*[=:]\s*\S+/gi, '$1=[SECRET]'],
  [/\b(api[_-]?key|apikey|secret|password|passwd|pwd|token|auth)\s*[=:]\s*["']?[^\s"',;]{6,}["']?/gi, '$1=[SECRET]'],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/g, 'Bearer [TOKEN]'],

  // ── Vendor key formats ─────────────────────────────────────────────────────
  [/\b(sk-ant-[A-Za-z0-9_-]{8,}|sk-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9]{8,}|glpat-[A-Za-z0-9_-]{8,}|AKIA[0-9A-Z]{8,}|ASIA[0-9A-Z]{8,}|xox[abprs]-[A-Za-z0-9-]{8,}|AIza[0-9A-Za-z_-]{10,}|hf_[A-Za-z0-9]{10,}|cfsk_[A-Za-z0-9]{8,})\b/g, '[SECRET]'],
  // JWTs.
  [/\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\b/g, '[TOKEN]'],

  // ── Personal / financial identifiers ───────────────────────────────────────
  [/\b\d{3}-\d{2}-\d{4}\b/g, '[SSN]'],
  // Undashed and space-separated SSNs. Kept narrow (exactly 9 digits, or the
  // 3-2-4 grouping) so ordinary 9-digit numbers in prose are not over-masked.
  [/\b\d{3}[ .]\d{2}[ .]\d{4}\b/g, '[SSN]'],
  // `(?:[ -]*)` not `[ -]?` — the DETECTOR allows any run of separators
  // (`(?:\d[ -]*?){13,16}`), so "4111 - 1111 - 1111 - 1111" was flagged as a card
  // and then printed in full because the mask only permitted ONE separator.
  // Ends on \d so a trailing separator run is not swallowed — otherwise
  // "4111 - 1111 - 1111 - 1111 today" masked to "[CARD]today".
  [/\b(?:\d[ -]*){12,18}\d\b/g, '[CARD]'],
  [/\b[A-Z]{2}\d{2}[ ]?[A-Z0-9]{4}[ ]?[A-Z0-9]{4}[ ]?[A-Z0-9]{2,18}\b/g, '[IBAN]'],

  // ── Internal identifiers ───────────────────────────────────────────────────
  [/\bCF-CUST-[A-Z0-9]{4,}\b/gi, '[CUSTOMER_ID]'],

  // ── Contact details ────────────────────────────────────────────────────────
  [/\b[\w.+-]+@[\w-]+\.[\w.]{2,}\b/g, '[EMAIL]'],
  [/\b(?:\+?1[ -]?)?\(?[2-9]\d{2}\)?[ -]?\d{3}[ -]?\d{4}\b/g, '[PHONE]'],
];

/**
 * Mask sensitive values in `text` and trim to `limit` characters.
 *
 * Masking runs BEFORE truncation so a value straddling the cut cannot survive as
 * a readable fragment.
 */
export function maskSensitive(text, limit = 250) {
  let t = String(text || '').replace(/\s+/g, ' ').trim();
  for (const [re, replacement] of RULES) t = t.replace(re, replacement);
  return t.length > limit ? t.slice(0, limit) + '…' : t;
}

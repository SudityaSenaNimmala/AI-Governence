// The retired demo personas, recognised so they can be kept OUT of real data.
//
// WHY. Commit 7500ded made the product real-data-only, but old demo seeds left
// employee_profiles ("James Carter", "Emily Rodriguez", "Sarah Mitchell",
// resolve_key agent:james:jamescarter …) and machines (JAMES / EMILY / SARAH and
// their *-browser-extension siblings) in live databases. Those demo profiles had
// also absorbed REAL people's machines, so Risk Scores merged a real employee into
// a "JamesCarter" row. Nothing is deleted here — callers use these predicates to
// skip demo records when grouping, scoring and counting.
//
// CAREFUL. A hostname alone is NOT proof of demo data: a real employee's PC was
// named EMILY with no user until it re-enrolled under its real OS user. A machine
// is demo only when its hostname matches AND its user is a demo persona or empty.
// A machine with any other user is always real.

export const DEMO_PERSONA_USERS = new Set(['jamescarter', 'emilyrodriguez', 'sarahmitchell']);
export const DEMO_PERSONA_EMAILS = new Set([
  'james.carter@cloudfuze.com',
  'emily.rodriguez@cloudfuze.com',
  'sarah.mitchell@cloudfuze.com',
]);
export const DEMO_PERSONA_HOSTS = /^(JAMES|EMILY|SARAH)(-browser-extension)?$/i;

// Mongo-side twin of isDemoIdentity for the `user` field: bare or DOMAIN\-prefixed
// username, or one of the demo addresses. Case-insensitive.
export const DEMO_PERSONA_USER_RE =
  /^(?:[^\\]*\\)?(?:jamescarter|emilyrodriguez|sarahmitchell)$|^(?:james\.carter|emily\.rodriguez|sarah\.mitchell)@cloudfuze\.com$/i;

/**
 * True when a username, email or display name is one of the demo personas.
 * "CORP\\JamesCarter", "jamescarter", "James.Carter@CloudFuze.com" and the display
 * name "James Carter" all match; anything else (including empty) does not.
 */
export function isDemoIdentity(value) {
  const s = String(value ?? '').trim().toLowerCase();
  if (!s) return false;
  if (s.includes('@')) return DEMO_PERSONA_EMAILS.has(s);
  const bare = s.split('\\').pop().replace(/\s+/g, '');
  return DEMO_PERSONA_USERS.has(bare);
}

/** True only for a demo hostname whose user is a demo persona or missing. */
export function isDemoMachine(m) {
  if (!m) return false;
  if (!DEMO_PERSONA_HOSTS.test(String(m.hostname ?? '').trim())) return false;
  const user = String(m.user ?? '').trim();
  return !user || isDemoIdentity(user);
}

// Mongo predicate matching demo machines — put it under $nor to exclude them.
export const DEMO_MACHINE_MATCH = {
  hostname: DEMO_PERSONA_HOSTS,
  $or: [
    { user: { $exists: false } },
    { user: null },
    { user: '' },
    { user: DEMO_PERSONA_USER_RE },
  ],
};

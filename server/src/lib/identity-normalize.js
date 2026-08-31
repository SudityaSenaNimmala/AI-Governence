// One spelling per person, wherever an identity enters the system.
//
// WHY THIS IS SHARED RATHER THAN INLINE. Windows does not agree with itself about
// capitalisation: on one real Entra-joined machine `whoami /upn` returns
// "satya.pinniti@cloudfuze.com" while the Intune enrolment registry key holds
// "Satya.Pinniti@cloudfuze.com". The desktop agent reads the first, the browser
// extension is handed the second as managed policy, and both send it to us.
//
// Every read path that groups by identity does so with an EXACT string match
// (ai-usage.js, the access-request roster, the identity resolver). So an identity
// normalised at one entry point and not another produces one human displayed as
// two — with no error, and no way to tell from the UI that the rows belong
// together. Live data showed exactly that: "Chaitanya.Malle@cloudfuze.com" and
// "Praveen.V@cloudfuze.com" stored beside lowercase addresses from the same fleet.
//
// So there is one function, and every entry point calls it.

/**
 * Fold an identity to its canonical form.
 *
 * Email-shaped values are lowercased, because an address is case-insensitive in
 * the part that matters and the two sources above disagree about it.
 *
 * Everything else is returned trimmed but otherwise untouched. An OS username is
 * a display name for a Windows account — "SatyaPinniti" is how its owner expects
 * to see it, and lowercasing it would fix nothing while making every agent row
 * look wrong.
 *
 * @param {unknown} value
 * @returns {string|null} the canonical identity, or null when there isn't one
 */
export function normalizeIdentity(value) {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  if (!s) return null;
  return /^[^\s@]+@[^\s@]+$/.test(s) ? s.toLowerCase() : s;
}

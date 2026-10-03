// One rule for every PERSON name the dashboards render: "First Last" — words
// separated by a space, each word's first letter capitalised.
//
// WHY. Identity arrives in whatever shape the source had: a run-together Windows
// account ("SruthiChimata", "Pravallikapunumalli"), a DOMAIN\ prefix, a dotted
// or underscored username ("sruthi.chimata", "sruthi_chimata"), an all-caps
// directory name ("SUDITYA NIMMALA"), or just an email. Showing those raw made
// the same person look like several and read as a bug. Every table, drawer,
// dialog and tooltip that shows a person routes the value through here.
//
// WHAT IT NEVER TOUCHES. Placeholders like "Browser User (a1b2c3d4)", anything
// carrying a digit (machine ids, "DESKTOP-7F2K", "user123"), and non-strings
// come back exactly as given — those are labels, not names. Callers must format
// only the NAME and fall back to a hostname/id afterwards
// (`formatPersonName(name) || host`), never pass the hostname in.

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const PLACEHOLDER_RE = /^(browser user|unknown user)\b/i;

const isEmail = (s) => typeof s === "string" && EMAIL_RE.test(s.trim());
const compact = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

// "o'brien" → "O'Brien", "MCDONALD" → "Mcdonald", "McDonald" kept, "j" → "J".
function capitaliseWord(word, forceNormalise) {
  if (!word) return word;
  // Hyphenated parts ("mary-jane", "smith-jones") are capitalised individually.
  if (word.includes("-")) return word.split("-").map(w => capitaliseWord(w, forceNormalise)).join("-");
  const letters = word.replace(/[^A-Za-z]/g, "");
  const allLower = letters && letters === letters.toLowerCase();
  const allUpper = letters && letters === letters.toUpperCase();
  let out;
  if (allLower || (allUpper && (forceNormalise || letters.length > 3))) {
    out = word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  } else {
    // Mixed case ("McDonald", "DeAndre") or a short all-caps token in a mixed
    // name ("JD", "III") — already deliberate; only make sure it starts upper.
    out = word.charAt(0).toUpperCase() + word.slice(1);
  }
  // O'Brien / D'Souza: the letter after a one-letter prefix + apostrophe.
  return out.replace(/^([A-Za-z])(['’])([a-z])/, (_, a, q, c) => a.toUpperCase() + q + c.toUpperCase());
}

// Split a raw identifier into words without capitalising.
function splitWords(raw) {
  let s = raw;
  // camelCase boundary: "SruthiChimata" → "Sruthi Chimata", but a word that
  // starts "Mc"/"Mac" keeps its inner capital ("McDonald", "MacKenzie").
  s = s.replace(/([a-z])([A-Z])/g, (m, a, b, idx) => {
    // The camel-word ending at `a`: from the last capital (or word start) to it.
    const before = s.slice(0, idx + 1);
    const head = before.slice(before.search(/[A-Z]?[a-z']*$/));
    return /^(Mc|Mac)$/.test(head) ? m : `${a} ${b}`;
  });
  // "JSmith" → "J Smith" (an initial glued to the surname).
  s = s.replace(/\b([A-Z])([A-Z][a-z]{2,})/g, "$1 $2");
  const hasSpace = /\s/.test(s.trim());
  const letters = s.replace(/[^A-Za-z]/g, "");
  const uniformCase = letters === letters.toLowerCase() || letters === letters.toUpperCase();
  // '-' is a separator only in a username-shaped value ("sruthi-chimata"); in a
  // real name ("Mary-Jane Watson", "Anne Smith-Jones") it is part of the word.
  const sep = !hasSpace && uniformCase && !/[._]/.test(s) ? /[\s._-]+/ : /[\s._]+/;
  return s.split(sep).filter(Boolean);
}

function fromWords(words) {
  const letters = words.join("").replace(/[^A-Za-z]/g, "");
  const wholeNameUpper = letters.length > 1 && letters === letters.toUpperCase();
  return words.map(w => capitaliseWord(w, wholeNameUpper)).join(" ");
}

function nameFromEmail(email) {
  if (!isEmail(email)) return null;
  const local = email.trim().split("@")[0];
  const words = splitWords(local);
  return words.length ? fromWords(words) : null;
}

/**
 * Format a person's name as "First Last".
 * @param {string|null|undefined} name  the raw name/username/email
 * @param {string|null|undefined} email the person's email when the row has one —
 *        supplies the first/last split for a run-together username.
 * @returns the formatted name, or the input unchanged when it isn't a person
 *          name (placeholder, contains digits, non-string). null/'' fall back to
 *          a name derived from `email`, else are returned as given.
 */
export function formatPersonName(name, email) {
  if (name == null || (typeof name === "string" && !name.trim())) {
    return nameFromEmail(email) || name;
  }
  if (typeof name !== "string") return name;
  const trimmed = name.trim();
  if (PLACEHOLDER_RE.test(trimmed)) return trimmed;
  // DOMAIN\user → user.
  const bare = trimmed.includes("\\") ? trimmed.slice(trimmed.lastIndexOf("\\") + 1) : trimmed;
  if (!bare) return nameFromEmail(email) || trimmed;
  // An email used as a NAME: the local part is the name.
  if (isEmail(bare)) return nameFromEmail(bare) || bare;
  if (bare.includes("@")) return trimmed;
  // Digits mean an id / hostname / machine label — not ours to rewrite.
  if (/\d/.test(bare)) return trimmed;
  const words = splitWords(bare);
  if (!words.length) return trimmed;
  // A single run-together word ("Pravallikapunumalli"): the email's local part
  // supplies the split — but only when it is the SAME identifier.
  if (words.length === 1 && isEmail(email)) {
    const local = email.trim().split("@")[0];
    if (compact(local) === compact(bare)) {
      const fromEmail = nameFromEmail(email);
      if (fromEmail && fromEmail.includes(" ")) return fromEmail;
    }
  }
  return fromWords(words);
}

/**
 * For a server-resolved name field that may already have fallen back to a
 * device label (access requests' employee_name → hostname): format it as a
 * person unless it IS the row's hostname, which is left exactly as given.
 */
export function formatRowPerson(name, email, hostname) {
  if (typeof name === "string" && hostname) {
    const strip = (s) => String(s).trim().toLowerCase().replace(/-?browser-?extension$/, "");
    // A hostname fallback stays raw only when it is machine-shaped (digits,
    // '-', '_', '.', e.g. "LAPTOP-FCRNKB4", "Mozilla-browser-extension"). A
    // name-shaped hostname ("SudityaSena", "SATYA") is how people name their
    // PCs, so it is formatted like any other person name.
    if (strip(name) === strip(hostname) && /[\d\-_.]/.test(String(name))) return name;
  }
  return formatPersonName(name, email);
}

// Historical names kept so older call sites / imports keep working.
export const splitConcatenatedName = (name) => formatPersonName(name);
export const personDisplayName = (name, email) => formatPersonName(name, email) || email || null;

export default formatPersonName;

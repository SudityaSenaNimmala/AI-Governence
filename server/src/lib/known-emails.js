// Work emails the fleet has reported anywhere, keyed so a run-together OS
// username can find its owner's address.
//
// WHY. A Windows account like "Pravallikapunumalli" carries no first/last
// boundary, so nothing can display it as "Pravallika Punumalli" — unless the
// person's email ("pravallika.punumalli@cloudfuze.com") is known. Emails arrive
// on OTHER machine records: Claude Code sessions (clicode:…), usage trackers
// (clautrk:…), signed-in browser extensions — any machine whose `user` is an
// address. Keying both sides by the local part with separators removed
// ("pravallikapunumalli") links them.
//
// Ambiguous keys (two different emails compacting to the same key) map to null
// rather than guessing. Demo personas never count.

import { isDemoIdentity } from './demo-personas.js';

export const EMAIL_SHAPE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** "CORP\\Pravallika.Punumalli@x.com" / "Pravallikapunumalli" → "pravallikapunumalli". */
export const compactKey = (s) => String(s || '')
  .toLowerCase()
  .replace(/^.*\\/, '')
  .replace(/@.*$/, '')
  .replace(/[^a-z0-9]/g, '');

/**
 * Map<compactKey, email|null> built from machine records (a Map of machines or
 * any iterable). A null value marks an ambiguous key — callers treat it as
 * "unknown".
 */
export function knownEmailsByKey(machines) {
  const map = new Map();
  const list = machines instanceof Map ? machines.values() : (machines || []);
  for (const m of list) {
    const u = String(m?.user || '').trim();
    if (!EMAIL_SHAPE.test(u) || isDemoIdentity(u)) continue;
    const key = compactKey(u);
    if (!key) continue;
    const email = u.toLowerCase();
    map.set(key, map.has(key) && map.get(key) !== email ? null : email);
  }
  return map;
}

/** The unique fleet-known email for a username, or null (none / ambiguous / demo). */
export function emailForUsername(emailsByKey, username) {
  if (!username || isDemoIdentity(username)) return null;
  const key = compactKey(username);
  if (!key) return null;
  return emailsByKey.get(key) || null;
}

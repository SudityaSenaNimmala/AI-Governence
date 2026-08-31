// Who this machine's usage belongs to, as a CORPORATE EMAIL rather than an OS
// account name.
//
// WHY THIS EXISTS. The agent used to enrol with `os.userInfo().username`
// ("SatyaPinniti") while the browser extension enrols with the Intune enrolment
// UPN pushed as managed policy ("satya.pinniti@cloudfuze.com"). Both are correct
// names for the same human, but they are DIFFERENT STRINGS, and
// server/src/routes/ai-usage.js groups by `machines.user` — so one person showed
// up as two rows, on two surfaces, with no indication they were the same. The
// Claude Code CLI adds a third: OpenTelemetry attributes by `user.email`, an
// email again.
//
// Resolving the same email here makes all four surfaces — desktop agent, browser
// extension, Claude Code CLI, and the identity beacon the extension reads —
// agree on one key, so they merge without the server having to guess.
//
// It also removes an ordering dependency from the rollout: the extension gets
// this same UPN from managed policy on its very first enrolment, so a machine
// where the beacon is slow or missing is still attributed to the right person.

import os from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

// ABSOLUTE PATHS, NOT BARE NAMES. Bare 'whoami' resolves through PATH, and on a
// developer machine with Git for Windows installed that finds MSYS's whoami
// first — which knows nothing about /upn, exits 0 anyway, and prints
// 'HOST\user'. The value fails the address check and we fall through to the OS
// username: no error, no log line, just a machine that quietly stops merging
// with its own browser extension. Same class of shadowing applies to reg.exe.
const SYS32 = join(process.env.SystemRoot || 'C:\\Windows', 'System32');
const WHOAMI = join(SYS32, 'whoami.exe');
const REG = join(SYS32, 'reg.exe');

// Deliberately loose. This is a sanity check that a registry/CLI value looks
// like an address before we treat it as one — not an attempt to validate email
// syntax, which would reject real UPNs.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * A UPN is only accepted when it belongs to the corporate domain.
 *
 * Mirrors the browser extension's `identityDomain` guard: a wrong name is worse
 * than no name, because a wrong name gets acted on. A machine enrolled under
 * some other tenant's UPN falls back to the OS username instead of borrowing an
 * identity we cannot vouch for.
 *
 * Suffix matching is exact — "notcloudfuze.com" and "cloudfuze.com.evil.io" are
 * both refused.
 */
function inDomain(email, domain) {
  if (!domain) return true;                     // no domain configured — no guard
  const suffix = domain.startsWith('@') ? domain : '@' + domain;
  return email.endsWith(suffix.toLowerCase());
}

function clean(value, domain) {
  if (!value) return null;
  const email = String(value).trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return null;
  return inDomain(email, domain) ? email : null;
}

/**
 * The UPN of the account actually signed in.
 *
 * THIS IS FIRST, not the device enrolment UPN, because of where we run: the
 * fleet install registers ONE all-users logon task that starts this process in
 * each interactive user's own session (see claude_tracker/service.js). So on a
 * shared machine `whoami /upn` names the person at the keyboard, whereas the
 * enrolment UPN names whoever the DEVICE was enrolled for — one right answer and
 * one confidently wrong one.
 *
 * Fails on a local (non-Entra) account, which has no work identity at all.
 */
function sessionUpn(domain) {
  if (process.platform !== 'win32') return null;
  try {
    const res = spawnSync(WHOAMI, ['/upn'], { encoding: 'utf8', windowsHide: true });
    if (res.status !== 0) return null;
    return clean(res.stdout, domain);
  } catch {
    return null;
  }
}

/**
 * The UPN the device was enrolled into Intune with.
 *
 * The same key scripts/intune-provision-extension.ps1 reads (Get-EnrolledUpn) to
 * push `userEmail` to the extension, so on a 1:1 assigned laptop the agent and
 * the extension land on byte-identical strings by construction rather than by
 * coincidence.
 */
function enrollmentUpn(domain) {
  if (process.platform !== 'win32') return null;
  try {
    // One key per enrolment, so query the subtree and take the first value that
    // actually carries an address. Filtering on EnrollmentType=6 (MDM) would be
    // more precise but older agents vary, and a non-MDM key with a real UPN is
    // still a real UPN.
    const res = spawnSync(
      REG,
      ['query', 'HKLM\SOFTWARE\Microsoft\Enrollments', '/s', '/v', 'UPN'],
      { encoding: 'utf8', windowsHide: true }
    );
    if (res.status !== 0) return null;
    for (const m of res.stdout.matchAll(/UPN\s+REG_SZ\s+(\S+)/g)) {
      const email = clean(m[1], domain);
      if (email) return email;
    }
  } catch { /* reg.exe missing or access denied — fall through */ }
  return null;
}

// Resolved once per process. Both lookups spawn a child process synchronously,
// and this is read on every enrol and on the hot path that stamps DLP events.
let cached = null;

/**
 * @param {{domain?: string, force?: boolean}} [opts]
 * @returns {{user: string, source: 'session_upn'|'intune_upn'|'os_user'}}
 */
export function resolveCorporateIdentity({ domain, force = false } = {}) {
  if (cached && !force) return cached;

  const guard = String(domain ?? process.env.CFAI_IDENTITY_DOMAIN ?? '')
    .trim()
    .toLowerCase()
    .replace(/^@/, '');

  const fromSession = sessionUpn(guard);
  if (fromSession) return (cached = { user: fromSession, source: 'session_upn' });

  const fromEnrollment = enrollmentUpn(guard);
  if (fromEnrollment) return (cached = { user: fromEnrollment, source: 'intune_upn' });

  // No work identity on this machine (local account, unenrolled device, or a UPN
  // outside the corporate domain). Report the OS account rather than nothing:
  // it is a real, stable name for this person on this box, it is simply not one
  // that merges with the other surfaces.
  return (cached = { user: os.userInfo().username, source: 'os_user' });
}

/** The identity string alone, for the many call sites that only need that. */
export function resolveCorporateUser(opts) {
  return resolveCorporateIdentity(opts).user;
}

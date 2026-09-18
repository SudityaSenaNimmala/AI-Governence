// Build-time configuration for the Claude tracker.
//
// scripts/build.mjs injects these via esbuild `define`, so the shipped .exe needs
// no config file and no arguments — a tester just runs it. During a dev run
// (`node src/claude_tracker/index.js`) the identifiers are undeclared, `typeof`
// safely yields "undefined", and we fall back to env vars.
//
// NOTE: the enroll secret is embedded in the binary and is recoverable by anyone
// who inspects it. That is an accepted trade-off for an internal pilot — use a
// dedicated secret for this build and rotate it when the pilot ends.

/* global __CFAI_SERVER_URL__, __CFAI_ENROLL_SECRET__, __CFAI_TRACKER_VERSION__, __CFAI_IDENTITY_DOMAIN__ */

export const SERVER_URL = (
  typeof __CFAI_SERVER_URL__ !== 'undefined' ? __CFAI_SERVER_URL__ : null
) || process.env.CFAI_SERVER_URL || 'http://localhost:8787';

export const ENROLL_SECRET = (
  typeof __CFAI_ENROLL_SECRET__ !== 'undefined' ? __CFAI_ENROLL_SECRET__ : null
) || process.env.CFAI_ENROLL_SECRET || 'dev-enroll-secret-change-me';

// The corporate email domain. A UPN outside it is refused as an identity and we
// report the OS username instead — the same guard the browser extension applies
// to a signed-in browser profile (`identityDomain` in managed policy). Both
// sides need it: without it here, a machine enrolled into some other tenant
// would enrol under that tenant's UPN and silently merge with nobody.
//
// Empty means no guard, which is right for a dev run and wrong for a fleet build.
export const IDENTITY_DOMAIN = (
  typeof __CFAI_IDENTITY_DOMAIN__ !== 'undefined' ? __CFAI_IDENTITY_DOMAIN__ : null
) || process.env.CFAI_IDENTITY_DOMAIN || '';

export const VERSION = (
  typeof __CFAI_TRACKER_VERSION__ !== 'undefined' ? __CFAI_TRACKER_VERSION__ : null
) || '0.1.0-dev';

// Only Claude surfaces. Keeping this list to 'Claude' is what makes this a
// Claude-only tracker rather than a general AI monitor.
export const DESKTOP_PROCESSES = ['Claude'];
export const BROWSER_PROCESSES = ['chrome', 'msedge', 'brave', 'firefox'];

export const FLUSH_INTERVAL_MS = 15_000;

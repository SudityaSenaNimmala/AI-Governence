// Pulls the DLP pattern policy derived from deployed compliance policy packs and
// installs it into the classifier, so desktop detection is governed by the same
// packs as the browser extension.
//
// Mirrors the extension's service-worker behaviour deliberately: same endpoint,
// same fail-safe rules, so the two surfaces cannot drift apart in what they
// enforce.
//
// Fail-safe policy, and the reason for it:
//   - A failed fetch leaves the previously installed policy in place. We never
//     install a default on error, because "no policy" means "run every pattern"
//     and writing that on a transient 500 would look like a successful sync.
//   - A malformed body is ignored for the same reason: a truncated response
//     could otherwise silently disable real detection.
//   - The endpoint is fetched unauthenticated (as the extension does): detection
//     policy must sync even when the agent's token is stale or it has not
//     finished enrolling. Block policy must not depend on enrollment state.

import { applyPolicy, policyState, getBlockPatterns } from './classifier.js';

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;   // pattern policy changes rarely

export class PolicySync {
  /**
   * @param onChange called with { version, blockPatterns } when the effective
   *        policy changes, so the caller can push new rules to the enforcer.
   */
  constructor({ serverUrl, log, intervalMs = DEFAULT_INTERVAL_MS, onChange = null }) {
    this.serverUrl = String(serverUrl || '').replace(/\/+$/, '');
    this.log = log;
    this.intervalMs = intervalMs;
    this.onChange = onChange;
    this.timer = null;
    this.lastVersion = null;
  }

  async refresh() {
    if (!this.serverUrl) return false;
    let body;
    try {
      const res = await fetch(`${this.serverUrl}/api/policy-packs/extension-config`);
      if (!res.ok) {
        this.log?.warn?.(`policy-sync: HTTP ${res.status} — keeping previous policy`);
        return false;
      }
      body = await res.json();
    } catch (err) {
      this.log?.warn?.(`policy-sync: fetch failed (${err?.message || err}) — keeping previous policy`);
      return false;
    }

    if (!body || typeof body !== 'object' || !body.patterns) {
      this.log?.warn?.('policy-sync: malformed response — keeping previous policy');
      return false;
    }

    // Nothing to do when the server reports the same version we already hold.
    if (body.version && body.version === this.lastVersion) return false;

    const summary = applyPolicy(body);
    this.lastVersion = summary.version;
    const state = policyState();

    this.log?.info?.(
      `policy-sync: applied policy ${summary.version} — ${summary.active}/${summary.total} patterns active`
      + (state.disabled.length ? ` (disabled: ${state.disabled.join(', ')})` : ''),
    );

    try {
      this.onChange?.({ version: summary.version, blockPatterns: getBlockPatterns() });
    } catch (err) {
      this.log?.warn?.(`policy-sync: onChange handler failed: ${err?.message || err}`);
    }
    return true;
  }

  start() {
    if (this.timer) return;
    // Refresh immediately: the first interval is minutes away and a freshly
    // started agent should not run unpoliced until then.
    this.refresh().catch(() => {});
    this.timer = setInterval(() => { this.refresh().catch(() => {}); }, this.intervalMs);
    if (this.timer.unref) this.timer.unref();   // never hold the process open
  }

  stop() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }
}

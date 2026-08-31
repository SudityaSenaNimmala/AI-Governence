// Mirrors the fleet-wide feature switches (GET /api/v1/features) and reports
// changes, so an admin turning something off in the dashboard's Settings page
// stops it on this machine within about a minute — no reinstall, no restart.
//
// Deliberately a near-copy of policy-sync.js: same endpoint style, same fail-safe
// rules, same version short-circuit. Two pollers that behave differently under
// failure is how two surfaces end up enforcing different things while both look
// healthy, so the shape is shared on purpose rather than reinvented.
//
// FAIL-SAFE POLICY, and the reason for each rule:
//   - A failed fetch leaves the previously applied flags in place. We never fall
//     back to "everything on", because that would silently re-enable something an
//     admin disabled and would look like a successful sync while doing it.
//   - A malformed body is ignored for the same reason: a truncated response could
//     otherwise switch subsystems on or off at random.
//   - Before the first successful fetch, everything is ON. This is a governance
//     product: the state a machine falls back to must be the governed one.
//   - The endpoint is fetched unauthenticated, as the extension does. Feature
//     policy must sync even when this agent's token is stale or it has not
//     finished enrolling, because the alternative is a machine that keeps running
//     a configuration the admin has retired.

const DEFAULT_INTERVAL_MS = 60 * 1000;   // an admin expects a switch to take effect promptly

export class FeatureSync {
  /**
   * @param onChange called with { version, features, changed } when the effective
   *        flags move. `features` is { key: boolean }; `changed` lists only the
   *        keys whose value actually flipped, so a caller can start/stop just
   *        those subsystems rather than churning all of them every poll.
   */
  constructor({ serverUrl, log, intervalMs = DEFAULT_INTERVAL_MS, onChange = null }) {
    this.serverUrl = String(serverUrl || '').replace(/\/+$/, '');
    this.log = log;
    this.intervalMs = intervalMs;
    this.onChange = onChange;
    this.timer = null;
    this.lastVersion = null;
    /** Last applied flags. Empty means "nothing fetched yet" → treat all as on. */
    this.features = {};
  }

  /** Unknown keys answer true: "I don't know" must read as "keep governing". */
  isEnabled(key) {
    return this.features[key] !== false;
  }

  async refresh() {
    if (!this.serverUrl) return false;

    let body;
    try {
      const res = await fetch(`${this.serverUrl}/api/v1/features?surface=agent`);
      if (!res.ok) {
        this.log?.warn?.(`feature-sync: HTTP ${res.status} — keeping previous flags`);
        return false;
      }
      body = await res.json();
    } catch (err) {
      this.log?.warn?.(`feature-sync: fetch failed (${err?.message || err}) — keeping previous flags`);
      return false;
    }

    if (!body || typeof body !== 'object' || !body.features || typeof body.features !== 'object') {
      this.log?.warn?.('feature-sync: malformed response — keeping previous flags');
      return false;
    }

    // Nothing to do when the server reports the state we already hold. The server
    // hashes only what endpoints act on, so an unchanged version really is a no-op.
    if (body.version && body.version === this.lastVersion) return false;

    const next = {};
    for (const [key, v] of Object.entries(body.features)) next[key] = v?.status !== 'disabled';

    // First successful fetch: everything counts as changed, because the caller has
    // started nothing yet and needs the full picture to act on.
    const first = this.lastVersion === null;
    const changed = first
      ? Object.keys(next)
      : Object.keys(next).filter((k) => this.features[k] !== next[k]);

    this.features = next;
    this.lastVersion = body.version || null;

    if (changed.length) {
      const off = Object.entries(next).filter(([, on]) => !on).map(([k]) => k);
      this.log?.info?.(
        `feature-sync: applied ${this.lastVersion || '(unversioned)'}`
        + (off.length ? ` — disabled: ${off.join(', ')}` : ' — all features on'),
      );
      try {
        this.onChange?.({ version: this.lastVersion, features: next, changed });
      } catch (err) {
        this.log?.warn?.(`feature-sync: onChange handler failed: ${err?.message || err}`);
      }
    }
    return true;
  }

  start() {
    if (this.timer) return;
    // Refresh immediately: the first interval is a minute away and a freshly
    // started agent should not spend it running a retired configuration.
    this.refresh().catch(() => {});
    this.timer = setInterval(() => { this.refresh().catch(() => {}); }, this.intervalMs);
    if (this.timer.unref) this.timer.unref();   // never hold the process open
  }

  stop() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }
}

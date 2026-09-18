// DiscoveryReporter — batches unknown-AI-host discoveries and POSTs them to
// /api/v1/discovered-apps so they show up in the dashboard's Discovery tray.
//
// One row per host (server upserts), so we coalesce locally too: each unique
// host accumulates a count + the most-recent sample fields, and the whole
// batch flushes every FLUSH_MS or when MAX_BATCH unique hosts have been seen.
// This avoids hammering the server when a user spam-types prompts at the
// same unknown vendor.

const FLUSH_MS  = 10_000;
const MAX_BATCH = 50;

export class DiscoveryReporter {
  constructor({ serverUrl, token, log } = {}) {
    this.serverUrl = serverUrl;
    this.token = token;
    this.log = log;
    this.byHost = new Map();   // host → { wire_format, count, sample_path, sample_model }
    this.timer = null;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.flush().catch(() => {}), FLUSH_MS);
  }

  stop() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    this.flush().catch(() => {});
  }

  /** Record one discovery. Coalesces with prior records for the same host. */
  record({ host, wire_format, sample_path, sample_model }) {
    if (!host || !wire_format) return;
    const cur = this.byHost.get(host);
    if (cur) {
      cur.count += 1;
      // Keep the FIRST sample seen — sample_* are illustrative, not the latest call.
      if (!cur.sample_path  && sample_path)  cur.sample_path  = sample_path;
      if (!cur.sample_model && sample_model) cur.sample_model = sample_model;
    } else {
      this.byHost.set(host, { wire_format, count: 1, sample_path: sample_path || null, sample_model: sample_model || null });
    }
    if (this.byHost.size >= MAX_BATCH) this.flush().catch(() => {});
  }

  async flush() {
    if (this.byHost.size === 0) return;
    if (!this.serverUrl || !this.token) {
      // No credentials yet — drop quietly. We'll discover them again next time
      // the user hits the same host once the proxy is enrolled.
      this.byHost.clear();
      return;
    }

    const discoveries = [];
    for (const [host, r] of this.byHost) {
      discoveries.push({
        host,
        wire_format: r.wire_format,
        sample_path: r.sample_path,
        sample_model: r.sample_model,
        count: r.count,
      });
    }
    this.byHost.clear();

    try {
      const res = await fetch(`${this.serverUrl}/api/v1/discovered-apps`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'authorization': `Bearer ${this.token}`,
        },
        body: JSON.stringify({ discoveries }),
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        this.log?.warn?.(`discovery-reporter: POST failed ${res.status} ${txt}`);
        return;
      }
      this.log?.info?.(`discovery-reporter: posted ${discoveries.length} host(s)`);
    } catch (e) {
      this.log?.warn?.(`discovery-reporter: POST error ${e?.message || e}`);
    }
  }
}

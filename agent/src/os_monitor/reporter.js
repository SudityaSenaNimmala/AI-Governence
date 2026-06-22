// Batches events captured by the OS monitor and POSTs them to the governance
// server's /api/v1/dlp endpoint. Same endpoint, same payload shape as the
// browser extension and desktop hook — events get distinguished by the
// `source` field, set to 'os_monitor'.

// Two-tier flush: a fast debounce after each enqueue (so the dashboard sees
// events within a couple seconds for live alerting), plus a longer safety-net
// interval (in case the debounce timer is somehow lost or stalled).
const DEBOUNCE_MS         = 2_000;   // flush this long after the latest event
const SAFETY_INTERVAL_MS  = 30_000;  // also flush at least this often
const MAX_BATCH           = 50;

export class Reporter {
  constructor({ serverUrl, token, log }) {
    this.serverUrl = serverUrl;
    this.token = token;
    this.log = log;
    this.queue = [];
    this.safetyTimer = null;
    this.debounceTimer = null;
  }

  start() {
    if (this.safetyTimer) return;
    this.safetyTimer = setInterval(() => this.flush(), SAFETY_INTERVAL_MS);
  }

  stop() {
    if (this.safetyTimer)   { clearInterval(this.safetyTimer);  this.safetyTimer = null; }
    if (this.debounceTimer) { clearTimeout(this.debounceTimer); this.debounceTimer = null; }
    this.flush();
  }

  enqueue(event) {
    this.queue.push({
      ...event,
      source: 'os_monitor',
      occurredAt: event.occurredAt || new Date().toISOString(),
    });

    // Eager-flush if batch fills (high-volume case).
    if (this.queue.length >= MAX_BATCH) {
      this.flush();
      return;
    }

    // Debounce: flush DEBOUNCE_MS after the last enqueue. Reset on each new
    // event so a burst becomes one flush rather than many.
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.flush();
    }, DEBOUNCE_MS);
  }

  async flush() {
    if (this.queue.length === 0) return;
    const batch = this.queue.splice(0, MAX_BATCH);
    try {
      const res = await fetch(this.serverUrl + '/api/v1/dlp', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'authorization': 'Bearer ' + this.token,
        },
        body: JSON.stringify({ events: batch }),
      });
      if (!res.ok) {
        this.log?.warn(`os_monitor: dlp POST failed status=${res.status}, requeueing ${batch.length}`);
        this.queue.unshift(...batch);
      } else {
        this.log?.info(`os_monitor: flushed ${batch.length} event(s)`);
      }
    } catch (err) {
      this.log?.warn('os_monitor: dlp POST error: ' + (err?.message || err) + ' — requeueing');
      this.queue.unshift(...batch);
    }
  }
}

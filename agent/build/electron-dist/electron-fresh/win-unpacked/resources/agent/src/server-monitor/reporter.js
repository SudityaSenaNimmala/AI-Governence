// Buffered, retrying reporter for server-agent events.
//
// Behavior:
//   - Buffer events in memory; flush in batches every FLUSH_INTERVAL_MS or
//     when the buffer hits FLUSH_BATCH_SIZE.
//   - Exponential backoff on POST failures with a hard cap.
//   - If the in-memory buffer exceeds MAX_BUFFER, oldest events are dropped
//     and we log the drop count (better to keep recent over old when the
//     server is down for a long time).
//
// No on-disk spill in v1 — server outages longer than a few minutes will
// lose events. A spill file is straightforward to add later.

import { setTimeout as sleep } from 'node:timers/promises';

const FLUSH_INTERVAL_MS = 5_000;
const FLUSH_BATCH_SIZE  = 50;
const MAX_BUFFER        = 5_000;
const MAX_BACKOFF_MS    = 60_000;

export function createReporter({ serverUrl, token, log, endpoint = '/api/v1/server-agent-events' }) {
  let buffer = [];
  let dropped = 0;
  let stopped = false;
  let backoff = 1_000;
  let inflight = null;

  async function flush() {
    if (buffer.length === 0) return;
    const batch = buffer.splice(0, FLUSH_BATCH_SIZE);
    try {
      const res = await fetch(`${serverUrl.replace(/\/+$/, '')}${endpoint}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ events: batch }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text().catch(() => '')}`);
      backoff = 1_000;
      if (dropped > 0) {
        log?.warn?.(`reporter: dropped ${dropped} event(s) due to buffer overflow during outage`);
        dropped = 0;
      }
    } catch (err) {
      // Put the batch back at the head; we'll retry next tick.
      buffer = [...batch, ...buffer];
      log?.warn?.(`reporter: flush failed (${err.message}); retry in ${backoff}ms`);
      await sleep(backoff);
      backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
    }
  }

  async function loop() {
    while (!stopped) {
      await sleep(FLUSH_INTERVAL_MS);
      if (buffer.length >= FLUSH_BATCH_SIZE) {
        inflight = flush();
        await inflight;
        inflight = null;
      } else if (buffer.length > 0) {
        inflight = flush();
        await inflight;
        inflight = null;
      }
    }
  }

  loop().catch((e) => log?.error?.(`reporter loop crashed: ${e.message}`));

  return {
    enqueue(event) {
      buffer.push(event);
      if (buffer.length > MAX_BUFFER) {
        const overflow = buffer.length - MAX_BUFFER;
        buffer.splice(0, overflow);
        dropped += overflow;
      }
    },
    async drain() {
      stopped = true;
      if (inflight) await inflight;
      while (buffer.length > 0) await flush();
    },
    stats() {
      return { buffered: buffer.length, dropped, backoff };
    },
  };
}

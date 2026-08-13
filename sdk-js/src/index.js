// @cloudfuze/ai-gov-sdk — tracing client for the CloudFuze AI Governance server.
//
// Zero runtime dependencies: global fetch, global timers, nothing else. That is a
// hard requirement, not a preference — this library gets installed into other
// people's production LLM services, and every dependency it carries is one they
// did not choose and cannot audit.
//
// THE ONE RULE THIS FILE IS BUILT AROUND: instrumentation must never be able to
// break the application it instruments. So nothing here throws into caller code —
// not a network failure, not a 500, not a malformed argument. Errors go to the
// optional `onError` callback and are otherwise swallowed. The send queue is
// bounded and drops OLDEST-first when the server is unreachable, because an
// unbounded queue in front of a down server is an out-of-memory crash in someone
// else's service with our name on it.
//
// The wire format is the Langfuse ingestion protocol — `{ id, timestamp, type,
// body }` envelopes posted in a `{ batch: [...] }` to /api/public/ingestion. That
// is deliberate: the server speaks it (routes/langfuse-gateway.js), and it means
// a team already using the official Langfuse SDK can switch by changing a base
// URL rather than rewriting their instrumentation.

const INGESTION_PATH = '/api/public/ingestion';
const GATEWAY_PREFIX = '/api/v1/lf';

const DEFAULTS = {
  flushAt: 50,
  flushIntervalMs: 3000,
  maxRetries: 3,
  // Ten flushes' worth of backlog. Past this the oldest events go, and the count
  // is reported through onError so a dropped event is never silent.
  maxQueueSize: 10_000,
  requestTimeoutMs: 10_000,
  retryBaseDelayMs: 250,
};

function uuid() {
  // randomUUID is available on Node 20 without an import from node:crypto in
  // most runtimes, but not all — fall back rather than assume.
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  const hex = () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0');
  return `${hex()}${hex()}-${hex()}-4${hex().slice(1)}-a${hex().slice(1)}-${hex()}${hex()}${hex()}`;
}

function iso(value) {
  if (!value) return new Date().toISOString();
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

/**
 * Resolve the ingestion URL from whatever the caller passed as baseUrl.
 *
 * Accepts both the server root (`http://host:8787`) and the Langfuse-compatible
 * gateway base (`http://host:8787/api/v1/lf`), because the first is what a
 * CloudFuze user naturally has to hand and the second is what someone migrating
 * from the official Langfuse SDK already has in their config.
 */
export function ingestionUrl(baseUrl) {
  const base = String(baseUrl || '').replace(/\/+$/, '');
  if (base.endsWith(GATEWAY_PREFIX)) return base + INGESTION_PATH;
  return base + GATEWAY_PREFIX + INGESTION_PATH;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class Observation {
  constructor(tracer, { id, traceId, parentObservationId, kind }) {
    this.id = id;
    this.traceId = traceId;
    this.parentObservationId = parentObservationId ?? null;
    this._kind = kind;                 // 'span' | 'generation' | 'event'
    this._tracer = tracer;
    this._ended = false;
  }

  /** Nest a child span under this one. */
  startSpan(options = {}) {
    return this._tracer._startObservation('span', {
      ...options,
      traceId: this.traceId,
      parentObservationId: this.id,
    });
  }

  /** Nest a child generation under this one. */
  startGeneration(options = {}) {
    return this._tracer._startObservation('generation', {
      ...options,
      traceId: this.traceId,
      parentObservationId: this.id,
    });
  }

  /** Patch fields without ending. */
  update(fields = {}) {
    this._tracer._enqueue(`${this._kind}-update`, {
      id: this.id,
      traceId: this.traceId,
      ...this._tracer._observationBody(fields),
    });
    return this;
  }

  /**
   * Finish the observation. `end()` twice is a no-op rather than an error — a
   * `finally { span.end() }` next to an explicit end() is a normal shape in
   * caller code and must not produce a duplicate event or a throw.
   */
  end(fields = {}) {
    if (this._ended) return this;
    this._ended = true;
    this._tracer._enqueue(`${this._kind}-update`, {
      id: this.id,
      traceId: this.traceId,
      endTime: iso(fields.endTime),
      ...this._tracer._observationBody(fields),
    });
    return this;
  }
}

class Trace {
  constructor(tracer, { id }) {
    this.id = id;
    this._tracer = tracer;
  }

  startSpan(options = {}) {
    return this._tracer._startObservation('span', { ...options, traceId: this.id });
  }

  startGeneration(options = {}) {
    return this._tracer._startObservation('generation', { ...options, traceId: this.id });
  }

  /** A point-in-time marker with no duration. */
  event(options = {}) {
    return this._tracer._startObservation('event', { ...options, traceId: this.id });
  }

  update(fields = {}) {
    const body = { id: this.id };
    if (fields.name !== undefined) body.name = fields.name;
    if (fields.userId !== undefined) body.userId = fields.userId;
    if (fields.sessionId !== undefined) body.sessionId = fields.sessionId;
    if (fields.input !== undefined) body.input = fields.input;
    if (fields.output !== undefined) body.output = fields.output;
    if (fields.metadata !== undefined) body.metadata = fields.metadata;
    if (fields.tags !== undefined) body.tags = fields.tags;
    if (fields.version !== undefined) body.version = fields.version;
    if (fields.release !== undefined) body.release = fields.release;
    this._tracer._enqueue('trace-update', body);
    return this;
  }
}

export class CloudFuzeTracer {
  constructor(options = {}) {
    this.baseUrl = options.baseUrl || process.env.CF_AIGOV_URL || '';
    this.publicKey = options.publicKey || process.env.CF_AIGOV_PUBLIC_KEY || '';
    this.secretKey = options.secretKey || process.env.CF_AIGOV_SECRET_KEY || '';
    this.environment = options.environment || process.env.CF_AIGOV_ENVIRONMENT || 'default';
    this.release = options.release ?? null;

    this.flushAt = options.flushAt ?? DEFAULTS.flushAt;
    this.flushIntervalMs = options.flushIntervalMs ?? DEFAULTS.flushIntervalMs;
    this.maxRetries = options.maxRetries ?? DEFAULTS.maxRetries;
    this.maxQueueSize = options.maxQueueSize ?? DEFAULTS.maxQueueSize;
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULTS.requestTimeoutMs;
    this.retryBaseDelayMs = options.retryBaseDelayMs ?? DEFAULTS.retryBaseDelayMs;
    this.onError = typeof options.onError === 'function' ? options.onError : null;
    this.enabled = options.enabled !== false;

    this._url = ingestionUrl(this.baseUrl);
    this._auth = 'Basic ' + Buffer.from(`${this.publicKey}:${this.secretKey}`).toString('base64');
    this._queue = [];
    this._dropped = 0;
    this._inFlight = null;
    this._closed = false;

    if (!this.baseUrl || !this.publicKey || !this.secretKey) {
      this._report(new Error('CloudFuzeTracer needs baseUrl, publicKey and secretKey — tracing is disabled'));
      this.enabled = false;
    }

    // A batch that has not reached flushAt still has to leave eventually, or a
    // low-traffic service would never report anything.
    this._timer = setInterval(() => { this.flush(); }, this.flushIntervalMs);
    this._timer.unref?.();

    // Short scripts (the demo, a cron job, a test) exit before the interval ever
    // fires. Without this their last — often only — batch is lost, and the user
    // concludes the product does not work.
    // Guarded to fire ONCE: beforeExit re-fires whenever the handler schedules
    // more async work, so an unguarded flush against an unreachable server (which
    // retries, then re-queues) would spin forever and the process would never
    // exit.
    this._beforeExitDone = false;
    this._beforeExit = () => {
      if (this._beforeExitDone) return;
      this._beforeExitDone = true;
      this.flush().catch(() => {});
    };
    process.on?.('beforeExit', this._beforeExit);
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  startTrace(options = {}) {
    const id = options.id || uuid();
    const body = {
      id,
      name: options.name ?? null,
      timestamp: iso(options.timestamp),
      environment: options.environment ?? this.environment,
    };
    if (options.userId !== undefined) body.userId = options.userId;
    if (options.sessionId !== undefined) body.sessionId = options.sessionId;
    if (options.input !== undefined) body.input = options.input;
    if (options.output !== undefined) body.output = options.output;
    if (options.metadata !== undefined) body.metadata = options.metadata;
    if (options.tags !== undefined) body.tags = options.tags;
    if (options.version !== undefined) body.version = options.version;
    if ((options.release ?? this.release) != null) body.release = options.release ?? this.release;

    this._enqueue('trace-create', body);
    return new Trace(this, { id });
  }

  /** Number of events waiting to be sent. Exposed for tests and diagnostics. */
  get queueLength() { return this._queue.length; }

  /** Events discarded because the queue was full. Never resets silently. */
  get droppedCount() { return this._dropped; }

  /**
   * Send everything queued. Resolves when the attempt finishes — successfully or
   * not. It does NOT reject: a caller writing `await tracer.flush()` in a request
   * handler must not get an exception because the governance server was
   * restarting.
   */
  async flush() {
    if (this._inFlight) {
      // Serialise flushes so two callers cannot interleave batches (which would
      // let an update overtake the create it patches).
      await this._inFlight.catch(() => {});
    }
    if (!this._queue.length) return { sent: 0, dropped: this._dropped };

    const batch = this._queue.splice(0, this._queue.length);
    this._inFlight = this._send(batch);
    const result = await this._inFlight;
    this._inFlight = null;
    return result;
  }

  /** Stop the timer and flush a final time. Safe to call twice. */
  async shutdown() {
    if (this._closed) return;
    this._closed = true;
    clearInterval(this._timer);
    process.off?.('beforeExit', this._beforeExit);
    await this.flush();
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  _report(err) {
    if (this.onError) {
      // A throwing onError must not become the failure it was meant to report.
      try { this.onError(err); } catch { /* ignore */ }
    }
  }

  _startObservation(kind, options = {}) {
    const id = options.id || uuid();
    const body = {
      id,
      traceId: options.traceId,
      startTime: iso(options.startTime),
      environment: options.environment ?? this.environment,
      ...this._observationBody(options),
    };
    if (options.parentObservationId) body.parentObservationId = options.parentObservationId;
    if (options.name !== undefined) body.name = options.name;

    this._enqueue(`${kind}-create`, body);
    return new Observation(this, {
      id,
      traceId: options.traceId,
      parentObservationId: options.parentObservationId,
      kind,
    });
  }

  // The fields shared by span/generation bodies, mapped onto Langfuse's names.
  // `usage` is accepted as the friendly alias for `usageDetails` because that is
  // what the ergonomic call site looks like: gen.end({ usage: { input, output } }).
  _observationBody(fields = {}) {
    const body = {};
    if (fields.name !== undefined) body.name = fields.name;
    if (fields.input !== undefined) body.input = fields.input;
    if (fields.output !== undefined) body.output = fields.output;
    if (fields.metadata !== undefined) body.metadata = fields.metadata;
    if (fields.level !== undefined) body.level = fields.level;
    if (fields.statusMessage !== undefined) body.statusMessage = fields.statusMessage;
    if (fields.version !== undefined) body.version = fields.version;
    if (fields.model !== undefined) body.model = fields.model;
    if (fields.modelParameters !== undefined) body.modelParameters = fields.modelParameters;
    if (fields.promptName !== undefined) body.promptName = fields.promptName;
    if (fields.promptVersion !== undefined) body.promptVersion = fields.promptVersion;
    if (fields.completionStartTime !== undefined) body.completionStartTime = iso(fields.completionStartTime);
    const usage = fields.usageDetails ?? fields.usage;
    if (usage !== undefined) body.usageDetails = usage;
    // Optional. Omit it and the server prices the call from its own table and
    // marks the figure cost_estimated: true.
    if (fields.costDetails !== undefined) body.costDetails = fields.costDetails;
    return body;
  }

  _enqueue(type, body) {
    if (!this.enabled || this._closed) return;

    if (this._queue.length >= this.maxQueueSize) {
      // Drop OLDEST. A full queue means the server has been unreachable for a
      // while; the newest events describe what is happening now, which is the
      // more useful half to keep.
      const overflow = this._queue.length - this.maxQueueSize + 1;
      this._queue.splice(0, overflow);
      this._dropped += overflow;
      this._report(new Error(`tracing queue full — dropped ${this._dropped} event(s) total`));
    }

    this._queue.push({ id: uuid(), timestamp: new Date().toISOString(), type, body });

    if (this._queue.length >= this.flushAt) {
      // Fire and forget: enqueue is called from the caller's hot path.
      this.flush().catch(() => {});
    }
  }

  async _send(batch) {
    let lastError = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (attempt > 0) {
        // Exponential backoff with jitter, so a fleet of services that all lost
        // the server at the same instant does not retry in lockstep.
        const delay = this.retryBaseDelayMs * 2 ** (attempt - 1);
        await sleep(delay + Math.floor(Math.random() * this.retryBaseDelayMs));
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);
      try {
        const res = await fetch(this._url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: this._auth },
          body: JSON.stringify({ batch }),
          signal: controller.signal,
        });

        // 2xx (including 207 partial success) is terminal: the server has the
        // batch. A per-item error inside a 207 is a client bug that retrying the
        // identical payload cannot fix, so it is reported, not retried.
        if (res.status >= 200 && res.status < 300) {
          if (res.status === 207) {
            const detail = await res.json().catch(() => null);
            if (detail?.errors?.length) {
              this._report(new Error(`tracing: ${detail.errors.length} event(s) rejected by the server`));
            }
          }
          return { sent: batch.length, dropped: this._dropped };
        }

        // 4xx other than 429 is our payload or our credentials — retrying an
        // identical request cannot help, and hammering a 401 looks like an
        // attack. Permanent: these events are discarded, not re-queued.
        if (res.status >= 400 && res.status < 500 && res.status !== 429) {
          this._dropped += batch.length;
          this._report(new Error(`tracing: server rejected the batch (${res.status}) — ${batch.length} event(s) discarded`));
          return { sent: 0, dropped: this._dropped, error: `http ${res.status}` };
        }
        lastError = new Error(`tracing: server responded ${res.status}`);
      } catch (err) {
        lastError = err;
      } finally {
        clearTimeout(timer);
      }
    }

    // Retries exhausted against a transient failure (network, 5xx, 429). Put the
    // batch BACK at the head of the queue — it is older than anything queued
    // while we were trying — so a server that comes back within the retention of
    // the queue loses nothing. _requeue enforces the bound and counts whatever it
    // has to drop, which is the only place events are lost to unreachability.
    this._requeue(batch);
    this._report(lastError || new Error('tracing: batch could not be delivered'));
    return { sent: 0, dropped: this._dropped, error: lastError?.message ?? null };
  }

  _requeue(batch) {
    this._queue.unshift(...batch);
    if (this._queue.length > this.maxQueueSize) {
      const overflow = this._queue.length - this.maxQueueSize;
      this._queue.splice(0, overflow);          // oldest first
      this._dropped += overflow;
      this._report(new Error(`tracing queue full — dropped ${this._dropped} event(s) total`));
    }
  }
}

export default CloudFuzeTracer;

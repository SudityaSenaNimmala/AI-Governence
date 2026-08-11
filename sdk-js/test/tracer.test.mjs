// @cloudfuze/ai-gov-sdk — batching, retry and wire-format tests.
//
// Everything runs against a real node:http server on an ephemeral port that the
// test controls. No mocked fetch, no real backend, no network beyond loopback:
// the interesting properties here are about what actually goes over a socket and
// what happens when the other end misbehaves, and a stubbed fetch would let a
// wrong URL or a missing header pass.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { CloudFuzeTracer, ingestionUrl } from '../src/index.js';

// A stub ingestion server. `respond` is called per request and returns
// { status, body }; every received batch is recorded.
async function withServer(respond, fn) {
  const requests = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      let parsed = null;
      try { parsed = JSON.parse(raw); } catch { /* recorded as null */ }
      requests.push({
        url: req.url,
        method: req.method,
        authorization: req.headers.authorization,
        contentType: req.headers['content-type'],
        batch: parsed?.batch ?? null,
      });
      const out = respond(requests.length, parsed) || { status: 200, body: { successes: [], errors: [] } };
      res.writeHead(out.status ?? 200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(out.body ?? {}));
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    return await fn({ base, requests });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function makeTracer(base, options = {}) {
  return new CloudFuzeTracer({
    baseUrl: base,
    publicKey: 'pk-lf-test',
    secretKey: 'sk-lf-test',
    // Long enough that no test is at the mercy of the interval firing.
    flushIntervalMs: 60_000,
    ...options,
  });
}

// ── URL resolution ───────────────────────────────────────────────────────────

test('ingestionUrl accepts the server root or the gateway base', () => {
  assert.equal(ingestionUrl('http://h:8787'), 'http://h:8787/api/v1/lf/api/public/ingestion');
  assert.equal(ingestionUrl('http://h:8787/'), 'http://h:8787/api/v1/lf/api/public/ingestion');
  // Someone migrating from the official Langfuse SDK already has this form.
  assert.equal(ingestionUrl('http://h:8787/api/v1/lf'), 'http://h:8787/api/v1/lf/api/public/ingestion');
  assert.equal(ingestionUrl('http://h:8787/api/v1/lf/'), 'http://h:8787/api/v1/lf/api/public/ingestion');
});

// ── Wire format ──────────────────────────────────────────────────────────────

test('emits the Langfuse envelope and event types the server expects', async () => {
  await withServer(() => ({ status: 200, body: { successes: [], errors: [] } }), async ({ base, requests }) => {
    const tracer = makeTracer(base, { environment: 'staging' });

    const trace = tracer.startTrace({ name: 'chat', userId: 'u1', sessionId: 's1', tags: ['a'] });
    const span = trace.startSpan({ name: 'retrieve', input: { q: 'x' } });
    span.end({ output: { hits: 2 } });
    const gen = trace.startGeneration({ name: 'answer', model: 'gpt-4o', modelParameters: { temperature: 0 } });
    gen.end({ output: 'hi', usage: { input: 10, output: 5 } });
    trace.update({ output: 'hi' });

    await tracer.flush();
    await tracer.shutdown();

    assert.equal(requests.length, 1);
    const req = requests[0];
    assert.equal(req.method, 'POST');
    assert.equal(req.url, '/api/v1/lf/api/public/ingestion');
    assert.equal(req.authorization, 'Basic ' + Buffer.from('pk-lf-test:sk-lf-test').toString('base64'));

    const types = req.batch.map((e) => e.type);
    assert.deepEqual(types, [
      'trace-create', 'span-create', 'span-update',
      'generation-create', 'generation-update', 'trace-update',
    ]);

    // Every event carries the {id, timestamp, type, body} envelope.
    for (const e of req.batch) {
      assert.equal(typeof e.id, 'string');
      assert.match(e.timestamp, /^\d{4}-\d{2}-\d{2}T/);
      assert.equal(typeof e.body, 'object');
    }

    const traceBody = req.batch[0].body;
    assert.equal(traceBody.name, 'chat');
    assert.equal(traceBody.userId, 'u1');
    assert.equal(traceBody.sessionId, 's1');
    assert.equal(traceBody.environment, 'staging');

    // Observations point at their trace, and the generation's create/update
    // share one id so the server merges them onto one document.
    const [, spanCreate, spanUpdate, genCreate, genUpdate] = req.batch;
    assert.equal(spanCreate.body.traceId, traceBody.id);
    assert.equal(spanUpdate.body.id, spanCreate.body.id);
    assert.ok(spanUpdate.body.endTime);
    assert.equal(genCreate.body.model, 'gpt-4o');
    assert.equal(genUpdate.body.id, genCreate.body.id);
    // `usage` is the friendly alias; the wire field is Langfuse's usageDetails.
    assert.deepEqual(genUpdate.body.usageDetails, { input: 10, output: 5 });
    assert.equal('usage' in genUpdate.body, false);
    // Not sent unless the caller supplied it — the server prices it instead.
    assert.equal('costDetails' in genUpdate.body, false);
  });
});

test('nested spans carry parentObservationId', async () => {
  await withServer(() => ({ status: 200, body: {} }), async ({ base, requests }) => {
    const tracer = makeTracer(base);
    const trace = tracer.startTrace({ name: 't' });
    const parent = trace.startSpan({ name: 'chain' });
    const child = parent.startSpan({ name: 'inner' });
    const gen = parent.startGeneration({ name: 'llm', model: 'gpt-4o-mini' });
    child.end();
    gen.end();
    parent.end();
    await tracer.flush();
    await tracer.shutdown();

    const byName = Object.fromEntries(
      requests[0].batch.filter((e) => e.type.endsWith('-create')).map((e) => [e.body.name, e.body]),
    );
    assert.equal(byName.chain.parentObservationId, undefined);
    assert.equal(byName.inner.parentObservationId, byName.chain.id);
    assert.equal(byName.llm.parentObservationId, byName.chain.id);
  });
});

test('costDetails is forwarded verbatim when the caller supplies it', async () => {
  await withServer(() => ({ status: 200, body: {} }), async ({ base, requests }) => {
    const tracer = makeTracer(base);
    const trace = tracer.startTrace({ name: 't' });
    const gen = trace.startGeneration({ name: 'g', model: 'gpt-4o' });
    gen.end({ usage: { input: 1, output: 2 }, costDetails: { input: 0.1, output: 0.2, total: 0.3 } });
    await tracer.flush();
    await tracer.shutdown();

    const update = requests[0].batch.find((e) => e.type === 'generation-update');
    assert.deepEqual(update.body.costDetails, { input: 0.1, output: 0.2, total: 0.3 });
  });
});

// ── Batching ─────────────────────────────────────────────────────────────────

test('flushes automatically once flushAt events are queued', async () => {
  await withServer(() => ({ status: 200, body: {} }), async ({ base, requests }) => {
    const tracer = makeTracer(base, { flushAt: 3 });

    tracer.startTrace({ name: 'a' });          // 1
    tracer.startTrace({ name: 'b' });          // 2
    assert.equal(requests.length, 0, 'must not send before the threshold');
    tracer.startTrace({ name: 'c' });          // 3 → auto flush

    // The auto-flush is fire-and-forget; give it the event loop.
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(requests.length, 1);
    assert.equal(requests[0].batch.length, 3);
    assert.equal(tracer.queueLength, 0);
    await tracer.shutdown();
  });
});

test('flushes on the interval when the threshold is never reached', async () => {
  await withServer(() => ({ status: 200, body: {} }), async ({ base, requests }) => {
    const tracer = makeTracer(base, { flushAt: 1000, flushIntervalMs: 30 });
    tracer.startTrace({ name: 'lonely' });
    await new Promise((r) => setTimeout(r, 120));
    assert.equal(requests.length, 1, 'a low-traffic service must still report');
    await tracer.shutdown();
  });
});

test('flush on an empty queue sends nothing', async () => {
  await withServer(() => ({ status: 200, body: {} }), async ({ base, requests }) => {
    const tracer = makeTracer(base);
    const r = await tracer.flush();
    assert.equal(r.sent, 0);
    assert.equal(requests.length, 0);
    await tracer.shutdown();
  });
});

// ── Retry / failure handling ─────────────────────────────────────────────────

test('retries a 5xx with backoff and succeeds on a later attempt', async () => {
  let calls = 0;
  await withServer((n) => {
    calls = n;
    return n < 3 ? { status: 503, body: { error: 'down' } } : { status: 200, body: {} };
  }, async ({ base, requests }) => {
    const tracer = makeTracer(base, { maxRetries: 3, retryBaseDelayMs: 5 });
    tracer.startTrace({ name: 'x' });
    const result = await tracer.flush();

    assert.equal(calls, 3);
    assert.equal(requests.length, 3);
    assert.equal(result.sent, 1);
    assert.equal(result.dropped, 0);
    // The same batch is re-sent, not a rebuilt one.
    assert.equal(requests[0].batch[0].id, requests[2].batch[0].id);
    await tracer.shutdown();
  });
});

test('a batch that never lands is re-queued, not lost', async () => {
  await withServer(() => ({ status: 500, body: { error: 'boom' } }), async ({ base, requests }) => {
    const errors = [];
    const tracer = makeTracer(base, {
      maxRetries: 1, retryBaseDelayMs: 5, onError: (e) => errors.push(e.message),
    });
    tracer.startTrace({ name: 'x' });
    const result = await tracer.flush();

    assert.equal(requests.length, 2, 'initial attempt plus one retry');
    assert.equal(result.sent, 0);
    // Transient failure: nothing is dropped, the event waits for the next flush.
    assert.equal(result.dropped, 0);
    assert.equal(tracer.queueLength, 1);
    assert.ok(errors.length > 0, 'the failure is reported through onError');
    await tracer.shutdown();
  });
});

test('a 401 is terminal — no retry, events discarded, caller informed', async () => {
  await withServer(() => ({ status: 401, body: { error: 'invalid SDK credentials' } }),
    async ({ base, requests }) => {
      const errors = [];
      const tracer = makeTracer(base, { maxRetries: 3, retryBaseDelayMs: 5, onError: (e) => errors.push(e.message) });
      tracer.startTrace({ name: 'x' });
      const result = await tracer.flush();

      assert.equal(requests.length, 1, 'hammering a 401 helps nobody');
      assert.equal(result.sent, 0);
      assert.equal(result.dropped, 1);
      assert.equal(tracer.queueLength, 0, 'a permanently rejected batch is not re-queued');
      assert.match(errors.join(' '), /401/);
      await tracer.shutdown();
    });
});

test('a 207 partial success is terminal and reports the rejected count', async () => {
  await withServer(() => ({
    status: 207,
    body: { successes: [{ id: 'a', status: 201 }], errors: [{ id: 'b', status: 400, message: 'bad' }] },
  }), async ({ base, requests }) => {
    const errors = [];
    const tracer = makeTracer(base, { onError: (e) => errors.push(e.message) });
    tracer.startTrace({ name: 'a' });
    tracer.startTrace({ name: 'b' });
    const result = await tracer.flush();

    assert.equal(requests.length, 1, 'a 207 must not be retried — the payload is what it is');
    assert.equal(result.sent, 2);
    assert.match(errors.join(' '), /1 event\(s\) rejected/);
    await tracer.shutdown();
  });
});

test('an unreachable server never throws into the caller', async () => {
  // Port 1 on loopback: nothing listens, connection is refused immediately.
  const errors = [];
  const tracer = new CloudFuzeTracer({
    baseUrl: 'http://127.0.0.1:1',
    publicKey: 'pk', secretKey: 'sk',
    maxRetries: 1, retryBaseDelayMs: 5, flushIntervalMs: 60_000,
    onError: (e) => errors.push(e.message),
  });
  const trace = tracer.startTrace({ name: 'x' });
  const span = trace.startSpan({ name: 's' });
  span.end({ output: 'y' });

  const result = await tracer.flush();     // must resolve, not reject
  assert.equal(result.sent, 0);
  assert.ok(errors.length > 0);
  assert.equal(tracer.queueLength, 3, 'the events wait for the server to come back');
  await tracer.shutdown();
});

// ── Bounded queue ────────────────────────────────────────────────────────────

test('the queue is bounded and drops OLDEST first, counting what it dropped', async () => {
  const errors = [];
  const tracer = new CloudFuzeTracer({
    baseUrl: 'http://127.0.0.1:1',
    publicKey: 'pk', secretKey: 'sk',
    flushAt: 1_000_000,                  // never auto-flush
    flushIntervalMs: 60_000,
    maxQueueSize: 5,
    onError: (e) => errors.push(e.message),
  });

  for (let i = 0; i < 12; i++) tracer.startTrace({ name: `t${i}` });

  assert.equal(tracer.queueLength, 5, 'the queue must not grow without limit');
  assert.equal(tracer.droppedCount, 7);
  // Newest kept: t7…t11. The old events are the ones sacrificed.
  const names = tracer._queue.map((e) => e.body.name);
  assert.deepEqual(names, ['t7', 't8', 't9', 't10', 't11']);
  assert.ok(errors.some((m) => /queue full/.test(m)));
  await tracer.shutdown();
});

// ── Guards ───────────────────────────────────────────────────────────────────

test('end() twice does not emit a duplicate event', async () => {
  await withServer(() => ({ status: 200, body: {} }), async ({ base, requests }) => {
    const tracer = makeTracer(base);
    const trace = tracer.startTrace({ name: 't' });
    const span = trace.startSpan({ name: 's' });
    span.end({ output: 'one' });
    span.end({ output: 'two' });          // a stray finally{} — must be a no-op
    await tracer.flush();
    await tracer.shutdown();

    const updates = requests[0].batch.filter((e) => e.type === 'span-update');
    assert.equal(updates.length, 1);
    assert.equal(updates[0].body.output, 'one');
  });
});

test('missing credentials disable the tracer instead of throwing', async () => {
  const errors = [];
  const tracer = new CloudFuzeTracer({ baseUrl: '', publicKey: '', secretKey: '', onError: (e) => errors.push(e.message) });
  const trace = tracer.startTrace({ name: 'x' });
  trace.startSpan({ name: 's' }).end();
  const result = await tracer.flush();

  assert.equal(tracer.enabled, false);
  assert.equal(tracer.queueLength, 0, 'a disabled tracer queues nothing');
  assert.equal(result.sent, 0);
  assert.match(errors.join(' '), /baseUrl, publicKey and secretKey/);
  await tracer.shutdown();
});

test('enabled:false makes every call a no-op', async () => {
  await withServer(() => ({ status: 200, body: {} }), async ({ base, requests }) => {
    const tracer = makeTracer(base, { enabled: false });
    const trace = tracer.startTrace({ name: 't' });
    trace.startGeneration({ name: 'g', model: 'gpt-4o' }).end({ usage: { input: 1, output: 1 } });
    await tracer.flush();
    assert.equal(requests.length, 0);
    await tracer.shutdown();
  });
});

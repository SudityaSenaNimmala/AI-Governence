# @cloudfuze/ai-gov-sdk

Tracing client for the CloudFuze AI & Agent Governance server. Record what your
LLM app did — traces, spans and generations — and see it in the AI Hub.

- **Zero runtime dependencies.** Global `fetch`, Node 20+.
- **Non-blocking.** Events are batched in memory and flushed in the background.
- **Never breaks your app.** No method throws. Delivery failures go to an
  optional `onError` callback; the send queue is bounded and drops oldest-first
  rather than growing without limit when the server is unreachable.

## Install

```bash
npm install @cloudfuze/ai-gov-sdk
```

From inside this monorepo:

```bash
npm install ./sdk-js
```

## Credentials

Create a project in the dashboard (or `POST /api/v1/sdk/projects`). You get a
`pk-lf-…` / `sk-lf-…` pair. The secret is shown **once**.

```bash
export CF_AIGOV_URL=http://localhost:8787
export CF_AIGOV_PUBLIC_KEY=pk-lf-...
export CF_AIGOV_SECRET_KEY=sk-lf-...
```

`baseUrl` accepts either the server root (`http://localhost:8787`) or the
Langfuse-compatible gateway base (`http://localhost:8787/api/v1/lf`).

## Usage

```js
import { CloudFuzeTracer } from '@cloudfuze/ai-gov-sdk';

const tracer = new CloudFuzeTracer({
  baseUrl: process.env.CF_AIGOV_URL,
  publicKey: process.env.CF_AIGOV_PUBLIC_KEY,
  secretKey: process.env.CF_AIGOV_SECRET_KEY,
  environment: 'production',
  onError: (err) => console.warn('[tracing]', err.message),
});

const trace = tracer.startTrace({
  name: 'support-chat',
  userId: 'u-1042',
  sessionId: 'sess-88',
  metadata: { tenant: 'acme' },
});

// A unit of work that is not a model call.
const span = trace.startSpan({ name: 'retrieve-docs', input: { query: 'refund policy' } });
const docs = await retrieve('refund policy');
span.end({ output: { hits: docs.length } });

// A model call.
const gen = trace.startGeneration({
  name: 'answer',
  model: 'gpt-4o',
  input: [{ role: 'user', content: 'How do refunds work?' }],
  modelParameters: { temperature: 0.2 },
});
const completion = await callTheModel();
gen.end({
  output: completion.text,
  usage: { input: completion.promptTokens, output: completion.completionTokens },
  // costDetails is optional — omit it and the server prices the call from its
  // own table and marks the figure as estimated.
});

trace.update({ output: completion.text });

await tracer.flush();
```

### Nesting

`span.startSpan()` and `span.startGeneration()` create children of that span, so
the dashboard can draw the real call tree:

```js
const chain = trace.startSpan({ name: 'rag-chain' });
const retrieval = chain.startSpan({ name: 'vector-search' });
retrieval.end({ output: { hits: 8 } });
const gen = chain.startGeneration({ name: 'synthesize', model: 'gpt-4o-mini' });
gen.end({ output: 'answer', usage: { input: 900, output: 120 } });
chain.end();
```

## API

### `new CloudFuzeTracer(options)`

| option | default | meaning |
| --- | --- | --- |
| `baseUrl` | `CF_AIGOV_URL` | governance server URL |
| `publicKey` | `CF_AIGOV_PUBLIC_KEY` | `pk-lf-…` |
| `secretKey` | `CF_AIGOV_SECRET_KEY` | `sk-lf-…` |
| `environment` | `'default'` | stamped on every trace/observation |
| `flushAt` | `50` | flush once this many events are queued |
| `flushIntervalMs` | `3000` | flush at least this often |
| `maxRetries` | `3` | retries per batch, exponential backoff with jitter |
| `maxQueueSize` | `10000` | hard ceiling; oldest events are dropped past it |
| `onError` | — | `(error) => void`, called instead of throwing |
| `enabled` | `true` | set `false` to make every call a no-op |

- `tracer.startTrace({ name, userId, sessionId, input, metadata, tags })` → `Trace`
- `trace.startSpan({ name, input, metadata })` → `Observation`
- `trace.startGeneration({ name, model, input, modelParameters })` → `Observation`
- `trace.event({ name, input })` → `Observation` (point-in-time marker)
- `trace.update({ output, metadata, … })`
- `observation.update({ … })`, `observation.end({ output, usage, costDetails, level, statusMessage })`
- `await tracer.flush()` — send everything queued; resolves either way, never rejects
- `await tracer.shutdown()` — stop the timer and flush a final time
- `tracer.queueLength`, `tracer.droppedCount`

Short-lived scripts do not need to call `flush()` explicitly — the tracer
registers a `beforeExit` flush — but calling it makes the timing explicit.

## Privacy

The server masks input and output before storing a preview
(`maskSensitive()` — secrets, SSNs, cards, emails, tokens). Raw text is stored
**only** if the project was created with `capture_content: true`, in a separate
collection, readable only through an admin-authenticated endpoint. Default
retention is 30 days per project.

## Demo

```bash
node examples/demo.mjs
```

See the top of that file for the environment variables it expects.

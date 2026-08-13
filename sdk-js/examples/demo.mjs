#!/usr/bin/env node
//
// CloudFuze AI Governance — tracing demo.
//
// Sends ONE realistic trace to your governance server so you can see the feature
// working end to end. It calls no real LLM and needs no OpenAI/Anthropic key —
// the model call is faked, including its token counts.
//
// ── Run it ───────────────────────────────────────────────────────────────────
//
//   export CF_AIGOV_URL=http://localhost:8787
//   export CF_AIGOV_PUBLIC_KEY=pk-lf-...        # from the dashboard
//   export CF_AIGOV_SECRET_KEY=sk-lf-...        # shown once, when you created it
//   node sdk-js/examples/demo.mjs
//
// On Windows PowerShell:
//
//   $env:CF_AIGOV_URL="http://localhost:8787"
//   $env:CF_AIGOV_PUBLIC_KEY="pk-lf-..."
//   $env:CF_AIGOV_SECRET_KEY="sk-lf-..."
//   node sdk-js/examples/demo.mjs
//
// Then look for the trace named "demo-support-chat".

import { CloudFuzeTracer } from '../src/index.js';

const BASE_URL = process.env.CF_AIGOV_URL;
const PUBLIC_KEY = process.env.CF_AIGOV_PUBLIC_KEY;
const SECRET_KEY = process.env.CF_AIGOV_SECRET_KEY;
const TRACE_NAME = 'demo-support-chat';

if (!BASE_URL || !PUBLIC_KEY || !SECRET_KEY) {
  console.error(`
Missing configuration.

  CF_AIGOV_URL         ${BASE_URL ? 'ok' : 'MISSING  (e.g. http://localhost:8787)'}
  CF_AIGOV_PUBLIC_KEY  ${PUBLIC_KEY ? 'ok' : 'MISSING  (pk-lf-... from the dashboard)'}
  CF_AIGOV_SECRET_KEY  ${SECRET_KEY ? 'ok' : 'MISSING  (sk-lf-... shown once at creation)'}

Set all three and run this script again.
`);
  process.exit(1);
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const problems = [];
const tracer = new CloudFuzeTracer({
  baseUrl: BASE_URL,
  publicKey: PUBLIC_KEY,
  secretKey: SECRET_KEY,
  environment: 'demo',
  // Collected rather than printed as they happen, so the final summary can be a
  // single clear verdict instead of a scroll of half-messages.
  onError: (err) => problems.push(err.message),
});

console.log(`Sending a demo trace to ${BASE_URL} …`);

// ── The trace: one customer-support conversation turn ────────────────────────
const trace = tracer.startTrace({
  name: TRACE_NAME,
  userId: 'demo-user-42',
  sessionId: 'demo-session-1',
  tags: ['demo', 'support'],
  metadata: { channel: 'web-chat', tenant: 'acme-corp' },
  input: 'How long do refunds take?',
});

// 1. A non-LLM unit of work: looking documents up. The delay is there so the
//    waterfall in the UI has a visible bar rather than a zero-width tick.
console.log('  • span: retrieve-docs');
const retrieval = trace.startSpan({
  name: 'retrieve-docs',
  input: { query: 'refund processing time', top_k: 3 },
});
await wait(180);
retrieval.end({
  output: { hits: 3, sources: ['refunds-policy.md', 'billing-faq.md', 'sla.md'] },
  metadata: { store: 'pgvector', index: 'kb-v3' },
});

// 2. The model call. Entirely fabricated — no network call to any LLM provider.
console.log('  • generation: answer-customer (gpt-4o, faked)');
const generation = trace.startGeneration({
  name: 'answer-customer',
  model: 'gpt-4o',
  modelParameters: { temperature: 0.2, max_tokens: 300 },
  input: [
    { role: 'system', content: 'You are a helpful billing support agent.' },
    { role: 'user', content: 'How long do refunds take?' },
  ],
});
await wait(420);
const answer =
  'Refunds are approved within one business day and appear on your statement '
  + 'in 5–10 business days, depending on your bank.';
generation.end({
  output: answer,
  // Fabricated token counts. costDetails is intentionally omitted so the server
  // prices this call from its own table and flags it cost_estimated: true —
  // which is exactly the path a real integration without cost data takes.
  usage: { input: 812, output: 96 },
});

// 3. Close the trace out with the final answer.
trace.update({ output: answer, metadata: { resolved: true } });

// ── Deliver ──────────────────────────────────────────────────────────────────
const result = await tracer.flush();
await tracer.shutdown();

if (result.sent > 0 && problems.length === 0) {
  console.log(`
SUCCESS — ${result.sent} events delivered.

Look for the trace named:   ${TRACE_NAME}
  user:      demo-user-42
  session:   demo-session-1
  contains:  1 span (retrieve-docs) + 1 generation (answer-customer, gpt-4o)

Check it from the API:
  curl "${BASE_URL}/api/v1/tracing/traces?project_id=<YOUR_PROJECT_ID>"

…or open the AI Hub in the dashboard and find "${TRACE_NAME}".
`);
  process.exit(0);
}

console.error(`
FAILED — nothing was stored.

${problems.length ? problems.map((p) => '  • ' + p).join('\n') : '  • the batch was not delivered'}

Things to check:
  • Is the server running?   curl ${BASE_URL}/api/v1/health
  • Are CF_AIGOV_PUBLIC_KEY / CF_AIGOV_SECRET_KEY the pair from the SAME project,
    and has that project not been revoked?  (a mismatch answers 401)
`);
process.exit(1);

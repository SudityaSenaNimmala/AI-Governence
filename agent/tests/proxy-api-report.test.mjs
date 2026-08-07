// Desktop proxy → governance server reporting of captured API calls.
//
// Before this, agent/src/proxy/index.js ran parseApiCall() purely for the
// Discovery breadcrumb and dropped prompt_text / response_text / tokens /
// cost on the floor. These tests pin the whole mapping: synthetic streamed
// response bytes → parseApiCall() reassembly → the exact
// /api/v1/server-agent-events payload the proxy now enqueues.
//
// No network and no proxy process: parseApiCall and buildApiCallEvent are both
// pure.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseApiCall } from '../src/server-monitor/cost-parser.js';
import { buildApiCallEvent } from '../src/proxy/index.js';

const STARTED_AT = Date.UTC(2026, 6, 1, 10, 0, 0);

/** Simulate what the MITM tee hands the hook: one Buffer of the whole stream. */
function sse(...frames) {
  return Buffer.from(frames.map((f) => `data: ${typeof f === 'string' ? f : JSON.stringify(f)}\n\n`).join(''), 'utf8');
}
function ndjson(...objs) {
  return Buffer.from(objs.map((o) => JSON.stringify(o)).join('\n') + '\n', 'utf8');
}

function capture({ host, path, requestBody, responseBody, responseHeaders, peerPort = 5555, proc = null }) {
  const call = {
    host,
    path,
    method: 'POST',
    requestHeaders: { 'content-type': 'application/json' },
    requestBody: Buffer.from(JSON.stringify(requestBody), 'utf8'),
    responseStatus: 200,
    responseHeaders,
    responseBody,
    responseTruncated: false,
    startedAt: STARTED_AT,
    durationMs: 2500,
    peerPort,
  };
  const parsed = parseApiCall({
    host: call.host,
    path: call.path,
    requestBody: call.requestBody,
    requestHeaders: call.requestHeaders,
    responseBody: call.responseBody,
    responseHeaders: call.responseHeaders,
  });
  return { call, parsed, event: parsed ? buildApiCallEvent({ call, parsed, proc }) : null };
}

test('OpenAI streaming call: reassembled response text, tokens and cost all reach the event', () => {
  const { event } = capture({
    host: 'api.openai.com',
    path: '/v1/chat/completions',
    requestBody: { model: 'gpt-4o', messages: [{ role: 'user', content: 'name three colours' }] },
    responseHeaders: { 'content-type': 'text/event-stream' },
    responseBody: sse(
      { choices: [{ delta: { role: 'assistant', content: '' } }] },
      { choices: [{ delta: { content: 'red' } }] },
      { choices: [{ delta: { content: ', green' } }] },
      { choices: [{ delta: { content: ' and blue' } }] },
      { choices: [{ delta: {} }], usage: { prompt_tokens: 11, completion_tokens: 5, prompt_tokens_details: { cached_tokens: 4 } } },
      '[DONE]',
    ),
    proc: { pid: 4242, name: 'chatgpt.exe' },
  });

  assert.ok(event, 'a known provider must produce an event');
  assert.equal(event.provider, 'openai');
  assert.equal(event.model, 'gpt-4o');
  // The whole point of this phase: the ASSISTANT text is captured.
  assert.equal(event.response_text, 'red, green and blue');
  assert.equal(event.prompt_text, '[user] name three colours');
  assert.equal(event.prompt_tokens, 11);
  assert.equal(event.completion_tokens, 5);
  assert.equal(event.cached_tokens, 4);
  assert.ok(event.cost && typeof event.cost.total_cost_usd === 'number', 'cost rides along');

  // Envelope fields the ingest route requires / stores.
  assert.equal(event.occurred_at, new Date(STARTED_AT).toISOString());
  assert.equal(event.duration_ms, 2500);
  assert.equal(event.response_status, 200);
  assert.equal(event.host, 'api.openai.com');
  assert.equal(event.path, '/v1/chat/completions');
  assert.equal(event.method, 'POST');
  assert.equal(event.response_truncated, false);
  assert.deepEqual(event.attribution, { pid: 4242, exe: 'chatgpt.exe', cmdline: null, trigger_source: 'desktop_proxy' });

  // Documented gap: no session_id on the desktop path (browser-extension only).
  assert.equal(event.session_id, undefined);
});

test('Anthropic streaming call: content_block_delta frames reassemble into response_text', () => {
  const { event } = capture({
    host: 'api.anthropic.com',
    path: '/v1/messages',
    requestBody: { model: 'claude-sonnet-4-20250514', max_tokens: 64, system: 'be terse', messages: [{ role: 'user', content: 'ping' }] },
    responseHeaders: { 'content-type': 'text/event-stream' },
    responseBody: sse(
      { type: 'message_start', message: { usage: { input_tokens: 9, cache_read_input_tokens: 2 } } },
      { type: 'content_block_delta', delta: { type: 'text_delta', text: 'po' } },
      { type: 'content_block_delta', delta: { type: 'text_delta', text: 'ng' } },
      { type: 'message_delta', usage: { output_tokens: 3 } },
      { type: 'message_stop' },
    ),
  });

  assert.ok(event);
  assert.equal(event.provider, 'anthropic');
  assert.equal(event.response_text, 'pong');
  assert.equal(event.prompt_text, '[system] be terse\n[user] ping');
  assert.equal(event.prompt_tokens, 9);
  assert.equal(event.completion_tokens, 3);
  assert.equal(event.cached_tokens, 2);
  assert.equal(event.attribution, null, 'no process resolved → null attribution, not a fake one');
});

test('non-streaming JSON response also carries response_text', () => {
  const { event } = capture({
    host: 'api.openai.com',
    path: '/v1/chat/completions',
    requestBody: { model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'hi' }] },
    responseHeaders: { 'content-type': 'application/json' },
    responseBody: Buffer.from(JSON.stringify({
      model: 'gpt-4o-mini',
      choices: [{ message: { role: 'assistant', content: 'hello there' } }],
      usage: { prompt_tokens: 2, completion_tokens: 3 },
    }), 'utf8'),
  });

  assert.equal(event.response_text, 'hello there');
  assert.equal(event.completion_tokens, 3);
});

test('local Ollama NDJSON stream reports text with zero cost', () => {
  const { event } = capture({
    host: 'localhost',
    path: '/api/chat',
    requestBody: { model: 'llama3', messages: [{ role: 'user', content: 'hey' }] },
    responseHeaders: { 'content-type': 'application/x-ndjson' },
    responseBody: ndjson(
      { message: { role: 'assistant', content: 'hi ' } },
      { message: { role: 'assistant', content: 'there' } },
      { done: true, prompt_eval_count: 4, eval_count: 2 },
    ),
  });

  assert.ok(event);
  assert.equal(event.provider, 'local-ollama');
  assert.equal(event.response_text, 'hi there');
  assert.equal(event.prompt_tokens, 4);
  assert.equal(event.completion_tokens, 2);
});

test('truncated response bodies are flagged, not silently trusted', () => {
  const { call, parsed } = capture({
    host: 'api.openai.com',
    path: '/v1/chat/completions',
    requestBody: { model: 'gpt-4o', messages: [{ role: 'user', content: 'x' }] },
    responseHeaders: { 'content-type': 'application/json' },
    responseBody: Buffer.from(JSON.stringify({ choices: [{ message: { content: 'partial' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }), 'utf8'),
  });
  const event = buildApiCallEvent({ call: { ...call, responseTruncated: true }, parsed });
  assert.equal(event.response_truncated, true);
});

// ── Known upstream gap, asserted so nobody has to rediscover it ─────────────
// cost-parser.js bails with `if (!usage) return null` for the cloud providers.
// A streamed OpenAI call WITHOUT stream_options.include_usage therefore has its
// response text discarded even though it was fully reassembled. Out of scope
// for this phase (it changes server-monitor behaviour too); this test pins the
// current behaviour so the fix is visible when it lands.
test('GAP: a streamed call with no usage block is dropped entirely, losing the response text', () => {
  const { parsed, event } = capture({
    host: 'api.openai.com',
    path: '/v1/chat/completions',
    requestBody: { model: 'gpt-4o', messages: [{ role: 'user', content: 'hello' }] },
    responseHeaders: { 'content-type': 'text/event-stream' },
    responseBody: sse(
      { choices: [{ delta: { content: 'text that is ' } }] },
      { choices: [{ delta: { content: 'lost today' } }] },
      '[DONE]',
    ),
  });
  assert.equal(parsed, null, 'no usage → parseApiCall returns null');
  assert.equal(event, null, 'so nothing is reported, response text included');
});

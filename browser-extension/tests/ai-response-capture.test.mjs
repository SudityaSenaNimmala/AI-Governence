// AI response reassembly in the page world (Session Replay, phase 3).
// Exercises the real slice of content/fetch-blocker.js — see
// load-response-assembler.mjs.
//
// Fixtures are shaped after what each site actually puts on the wire. Every
// stream is also replayed in 7-character chunks to prove reassembly does not
// depend on network framing.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { loadResponseAssembler, assembleFromChunks, chunkify } from './load-response-assembler.mjs';

const api = loadResponseAssembler();

const sse = (...frames) => frames.map((f) => `data: ${typeof f === 'string' ? f : JSON.stringify(f)}\n\n`).join('');

/** Assert a stream assembles to `expected` both whole and split into small chunks. */
function assertAssembles(raw, site, expected, format) {
  const whole = api.assembleAiResponseText(raw, site);
  assert.equal(whole.text, expected);
  if (format) assert.equal(whole.format, format);
  const chunked = assembleFromChunks(api, chunkify(raw), site);
  assert.equal(chunked.text, expected, 'chunk boundaries must not change the result');
}

// ── site detection ──────────────────────────────────────────────────────────

test('site detection maps hosts to the right response parser', () => {
  const cases = [
    ['https://chatgpt.com/backend-api/conversation', 'chatgpt'],
    ['https://chat.openai.com/backend-api/conversation', 'chatgpt'],
    ['/backend-api/f/conversation', 'chatgpt'],            // relative → page host
    ['https://claude.ai/api/organizations/o/chat_conversations/c/completion', 'claude'],
    ['https://api.anthropic.com/v1/messages', 'anthropic'],
    ['https://api.openai.com/v1/chat/completions', 'openai'],
    ['https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:streamGenerateContent', 'google'],
    ['https://aistudio.google.com/generate', 'google'],
    ['https://gemini.google.com/_/BardChatUi/data/batchexecute', 'unsupported'],
    ['https://copilot.microsoft.com/c/api/conversations', 'unsupported'],
    ['https://m365.cloud.microsoft/chat', 'unsupported'],
    ['https://some-new-ai.example.com/v1/chat', 'generic'],
  ];
  for (const [url, expected] of cases) {
    assert.equal(api.responseSiteFor(url, 'chatgpt.com'), expected, url);
  }
});

test('an unsupported site never even attempts reassembly', () => {
  const r = api.assembleAiResponseText(sse({ choices: [{ delta: { content: 'x' } }] }), 'unsupported');
  assert.equal(r.text, '');
  assert.equal(r.format, 'unsupported');
});

// ── ChatGPT ─────────────────────────────────────────────────────────────────

test('ChatGPT v1 delta encoding: add + append ops reassemble', () => {
  const raw =
    'event: delta_encoding\ndata: "v1"\n\n' +
    sse(
      { p: '', o: 'add', v: { message: { id: 'm1', author: { role: 'assistant' }, content: { content_type: 'text', parts: [''] } } } },
      { p: '/message/content/parts/0', o: 'append', v: 'The capital' },
      { v: ' of France' },
      { v: ' is Paris.' },
      { type: 'message_stream_complete', conversation_id: 'c1' },
    );
  assertAssembles(raw, 'chatgpt', 'The capital of France is Paris.', 'sse');
});

test('ChatGPT legacy full-snapshot frames take the LAST snapshot, not a concatenation', () => {
  const raw = sse(
    { message: { author: { role: 'assistant' }, content: { content_type: 'text', parts: ['Hel'] } } },
    { message: { author: { role: 'assistant' }, content: { content_type: 'text', parts: ['Hello wor'] } } },
    { message: { author: { role: 'assistant' }, content: { content_type: 'text', parts: ['Hello world!'] } } },
    '[DONE]',
  );
  assertAssembles(raw, 'chatgpt', 'Hello world!', 'sse');
});

test('ChatGPT: non-assistant frames (user echo, tool calls, thoughts) are not captured as the reply', () => {
  const raw = sse(
    { p: '', o: 'add', v: { message: { author: { role: 'user' }, content: { content_type: 'text', parts: ['my question'] } } } },
    { p: '/message/content/parts/0', o: 'append', v: 'SHOULD NOT APPEAR' },
    { p: '', o: 'add', v: { message: { author: { role: 'tool' }, content: { content_type: 'text', parts: ['tool noise'] } } } },
    { p: '', o: 'add', v: { message: { author: { role: 'assistant' }, content: { content_type: 'text', parts: [''] } } } },
    { p: '/message/content/parts/0', o: 'append', v: 'real answer' },
    { p: '/message/content/thoughts/0/content', o: 'append', v: 'hidden reasoning' },
  );
  const r = api.assembleAiResponseText(raw, 'chatgpt');
  assert.equal(r.text, 'real answer');
  assert.equal(/SHOULD NOT APPEAR|hidden reasoning|tool noise/.test(r.text), false);
});

test('ChatGPT: patch ops carrying a batch of appends are flattened', () => {
  const raw = sse(
    { p: '', o: 'add', v: { message: { author: { role: 'assistant' }, content: { content_type: 'text', parts: [''] } } } },
    { o: 'patch', v: [
      { p: '/message/content/parts/0', o: 'append', v: 'one ' },
      { p: '/message/content/parts/0', o: 'append', v: 'two ' },
      { p: '/message/status', o: 'replace', v: 'finished_successfully' },
    ] },
    { v: 'three' },
  );
  assertAssembles(raw, 'chatgpt', 'one two three');
});

// ── Claude ──────────────────────────────────────────────────────────────────

test('claude.ai: Anthropic-style content_block_delta frames reassemble', () => {
  const raw =
    'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1"}}\n\n' +
    'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Sure"}}\n\n' +
    'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":", here"}}\n\n' +
    'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" you go."}}\n\n' +
    'event: message_stop\ndata: {"type":"message_stop"}\n\n';
  assertAssembles(raw, 'claude', 'Sure, here you go.', 'sse');
});

test('claude.ai: legacy {type:"completion"} frames also reassemble', () => {
  const raw = sse(
    { type: 'completion', completion: 'old' },
    { type: 'completion', completion: ' style' },
    { type: 'completion', completion: ' stream' },
  );
  assertAssembles(raw, 'claude', 'old style stream');
});

test('api.anthropic.com non-streaming /v1/messages response', () => {
  const raw = JSON.stringify({
    type: 'message',
    content: [{ type: 'text', text: 'block one. ' }, { type: 'text', text: 'block two.' }],
    usage: { input_tokens: 3, output_tokens: 5 },
  });
  assertAssembles(raw, 'anthropic', 'block one. block two.', 'json');
});

// ── OpenAI-compatible ───────────────────────────────────────────────────────

test('api.openai.com streamed chat completion deltas reassemble', () => {
  const raw = sse(
    { choices: [{ delta: { role: 'assistant', content: '' } }] },
    { choices: [{ delta: { content: 'red' } }] },
    { choices: [{ delta: { content: ', green' } }] },
    { choices: [{ delta: { content: ' and blue' } }] },
    { choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 11, completion_tokens: 5 } },
    '[DONE]',
  );
  assertAssembles(raw, 'openai', 'red, green and blue', 'sse');
});

test('openai non-streaming response reads choices[].message.content', () => {
  const raw = JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'one shot answer' } }], usage: {} });
  assertAssembles(raw, 'openai', 'one shot answer', 'json');
});

test('openai Responses-API output_text deltas reassemble', () => {
  const raw = sse(
    { type: 'response.output_text.delta', delta: 'stream' },
    { type: 'response.output_text.delta', delta: 'ed out' },
    { type: 'response.completed' },
  );
  assertAssembles(raw, 'openai', 'streamed out');
});

// ── Google ──────────────────────────────────────────────────────────────────

test('Gemini API streamGenerateContent (alt=sse) reassembles candidate parts', () => {
  const raw = sse(
    { candidates: [{ content: { parts: [{ text: 'Photo' }], role: 'model' } }] },
    { candidates: [{ content: { parts: [{ text: 'synthesis' }], role: 'model' } }] },
    { candidates: [{ content: { parts: [{ text: ' explained.' }], role: 'model' } }], usageMetadata: { promptTokenCount: 4 } },
  );
  assertAssembles(raw, 'google', 'Photosynthesis explained.', 'sse');
});

// ── generic fallback ────────────────────────────────────────────────────────

test('an unknown AI host still reassembles a recognizable stream shape', () => {
  const openaiish = sse({ choices: [{ delta: { content: 'unknown ' } }] }, { choices: [{ delta: { content: 'vendor' } }] });
  assertAssembles(openaiish, 'generic', 'unknown vendor');

  const anthropicish = sse({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'other vendor' } });
  assertAssembles(anthropicish, 'generic', 'other vendor');

  const ndjson = '{"message":{"content":"local "}}\n{"message":{"content":"model"}}\n{"done":true}\n';
  assertAssembles(ndjson, 'generic', 'local model', 'ndjson');
});

// ── robustness ──────────────────────────────────────────────────────────────

test('a truncated final frame does not lose the frames before it', () => {
  const raw = sse(
    { choices: [{ delta: { content: 'kept' } }] },
    { choices: [{ delta: { content: ' text' } }] },
  ) + 'data: {"choices":[{"delta":{"content":"cut off';
  assertAssembles(raw, 'openai', 'kept text');
});

test('noise that is not an AI response yields no text (so no event is emitted)', () => {
  for (const raw of [
    '',
    '   ',
    'not json at all',
    JSON.stringify({ ok: true, items: [1, 2, 3] }),
    sse({ type: 'ping' }, { type: 'error', error: { message: 'nope' } }),
    ')]}\'\n\n[["wrb.fr",null,"[[\\"gemini batchexecute noise\\"]]"]]',
  ]) {
    assert.equal(api.assembleAiResponseText(raw, 'generic').text, '', JSON.stringify(raw).slice(0, 60));
  }
});

test('SSE parsing follows the spec: multi-line data joins with \\n, [DONE] is skipped', () => {
  const frames = api.parseSseFrames('data: {"a":1}\ndata: extra\n\ndata: [DONE]\n\nevent: x\ndata: {"b":2}\n\n');
  assert.equal(frames.length, 2);
  assert.equal(frames[0].data, '{"a":1}\nextra');
  assert.equal(frames[1].name, 'x');
  assert.deepEqual(frames[1].json, { b: 2 });
});

test('a very long response is still assembled in full (caller applies the cap)', () => {
  const chunk = 'x'.repeat(1000);
  const frames = [];
  for (let i = 0; i < 200; i++) frames.push({ choices: [{ delta: { content: chunk } }] });
  const r = api.assembleAiResponseText(sse(...frames), 'openai');
  assert.equal(r.text.length, 200 * 1000);
});

// Smoke test for the AI-apps registry + generic shape detector.
//
// Covers:
//   1. Registry loads and exposes the apps we expect.
//   2. Whitelist merges registry domains (Augment / Factory / Devin / Claude Code).
//   3. detectAiShape() correctly identifies OpenAI / Anthropic / Gemini / Ollama
//      body shapes coming from an UNKNOWN host.
//   4. parseApiCall() returns provider='unknown:<shape>' + _discovered breadcrumb
//      when called against an unknown host with AI-shaped bodies.

import { allApps, appForHost, appForProcess, alwaysInterceptDomains, webDomains } from '../src/registry/loader.js';
import { isIntercepted, isAlwaysInterceptHost } from '../src/proxy/whitelist.js';
import { parseApiCall, detectAiShape } from '../src/server-monitor/cost-parser.js';

let pass = 0, fail = 0;
function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`  ok   — ${name}`); }
  else    { fail++; console.log(`  FAIL — ${name}${detail ? '  (' + detail + ')' : ''}`); }
}

console.log('# 1. Registry loads');
const apps = allApps();
check('registry has at least 15 apps',      apps.length >= 15, `got ${apps.length}`);
check('Claude Code present',                 !!apps.find((a) => a.id === 'claude-code'));
check('Augment Code present',                !!apps.find((a) => a.id === 'augment-code'));
check('Factory.AI present',                  !!apps.find((a) => a.id === 'factory-ai'));
check('Devin present',                       !!apps.find((a) => a.id === 'devin'));

console.log('\n# 2. Lookup');
check('appForHost(api.augmentcode.com) → Augment Code',
       appForHost('api.augmentcode.com')?.id === 'augment-code');
check('appForHost(api.devin.ai)        → Devin',
       appForHost('api.devin.ai')?.id === 'devin');
check('appForHost(unknown.com)         → null',
       appForHost('unknown.com') === null);
check('appForProcess(claude)           → Claude Code',
       appForProcess('claude')?.id === 'claude-code');
check('appForProcess(droid)            → Factory.AI',
       appForProcess('droid')?.id === 'factory-ai');

console.log('\n# 3. Whitelist now includes registry domains');
check('isAlwaysInterceptHost(api.augmentcode.com)', isAlwaysInterceptHost('api.augmentcode.com'));
check('isAlwaysInterceptHost(api.factory.ai)',      isAlwaysInterceptHost('api.factory.ai'));
check('isAlwaysInterceptHost(api.devin.ai)',        isAlwaysInterceptHost('api.devin.ai'));
check('isAlwaysInterceptHost(api.anthropic.com) (existing)', isAlwaysInterceptHost('api.anthropic.com'));
check('isIntercepted(app.devin.ai)  — web domain',  isIntercepted('app.devin.ai'));
check('alwaysInterceptDomains() length >= 8',       alwaysInterceptDomains().length >= 8);
check('webDomains() includes claude.ai',            webDomains().includes('claude.ai'));

console.log('\n# 4. Shape detector — unknown host with known body shape');

// 4a. OpenAI shape from a brand-new host.
const openaiReq = { model: 'foo-1', messages: [{ role: 'user', content: 'hello' }] };
const openaiResp = { id: 'x', model: 'foo-1', choices: [{ message: { role: 'assistant', content: 'hi' } }], usage: { prompt_tokens: 5, completion_tokens: 1 } };
check('detectAiShape: OpenAI shape',
       detectAiShape({ reqJson: openaiReq, respJson: openaiResp })?.wireFormat === 'openai');

// 4b. Anthropic shape.
const anthroReq  = { model: 'claude-foo', messages: [{ role: 'user', content: 'hi' }], max_tokens: 100 };
const anthroResp = { content: [{ type: 'text', text: 'hello' }], usage: { input_tokens: 5, output_tokens: 2 } };
check('detectAiShape: Anthropic shape',
       detectAiShape({ reqJson: anthroReq, respJson: anthroResp })?.wireFormat === 'anthropic');

// 4c. Gemini shape.
const geminiReq  = { contents: [{ role: 'user', parts: [{ text: 'hi' }] }] };
const geminiResp = { candidates: [{ content: { parts: [{ text: 'hello' }] } }], usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 } };
check('detectAiShape: Gemini shape',
       detectAiShape({ reqJson: geminiReq, respJson: geminiResp })?.wireFormat === 'google');

// 4d. Ollama shape (NDJSON-style, non-stream collapsed).
const ollamaReq  = { model: 'llama3.1', messages: [{ role: 'user', content: 'hi' }] };
const ollamaResp = { message: { role: 'assistant', content: 'hello' }, prompt_eval_count: 5, eval_count: 2, done: true };
check('detectAiShape: Ollama shape',
       detectAiShape({ reqJson: ollamaReq, respJson: ollamaResp })?.wireFormat === 'ollama');

// 4e. Non-AI JSON should NOT match.
const randomReq  = { username: 'bob', password: 'xyz' };
const randomResp = { ok: true, token: 'abc' };
check('detectAiShape: non-AI body → null',
       detectAiShape({ reqJson: randomReq, respJson: randomResp }) === null);

console.log('\n# 5. parseApiCall — unknown host, AI-shaped body, full pipeline');
const parsed = parseApiCall({
  host: 'api.slingshot-ai-totally-not-real.com',
  path: '/v1/chat/completions',
  requestBody:  Buffer.from(JSON.stringify(openaiReq), 'utf8'),
  requestHeaders: { 'content-type': 'application/json' },
  responseBody: Buffer.from(JSON.stringify(openaiResp), 'utf8'),
  responseHeaders: { 'content-type': 'application/json' },
});
check('parseApiCall: unknown host returns result',     !!parsed);
check('parseApiCall: provider = unknown:openai',       parsed?.provider === 'unknown:openai');
check('parseApiCall: prompt_tokens parsed correctly',  parsed?.prompt_tokens === 5);
check('parseApiCall: _discovered breadcrumb present',  parsed?._discovered?.host === 'api.slingshot-ai-totally-not-real.com');
check('parseApiCall: _discovered.wireFormat = openai', parsed?._discovered?.wireFormat === 'openai');

// And known host still works as before.
const knownParsed = parseApiCall({
  host: 'api.anthropic.com',
  path: '/v1/messages',
  requestBody:  Buffer.from(JSON.stringify(anthroReq), 'utf8'),
  requestHeaders: { 'content-type': 'application/json' },
  responseBody: Buffer.from(JSON.stringify(anthroResp), 'utf8'),
  responseHeaders: { 'content-type': 'application/json' },
});
check('parseApiCall: known host returns provider=anthropic (no unknown:)',
       knownParsed?.provider === 'anthropic');
check('parseApiCall: known host has NO _discovered',
       knownParsed?._discovered === undefined);

console.log(`\n${fail === 0 ? 'ALL OK' : 'FAIL'}: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

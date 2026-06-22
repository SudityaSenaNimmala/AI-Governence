// Parse provider response bodies to extract:
//   - the deployed model id
//   - prompt_tokens / completion_tokens (+ cached if reported)
//   - the user prompt and the model's reply (for governance dashboard preview)
//
// Handles both JSON (non-streaming) and SSE (streaming, text/event-stream).
// Each provider returns usage in a slightly different shape — normalize here.
//
// Returns null if the body doesn't look like a known LLM call.

import { computeCost } from './pricing.js';
import zlib from 'node:zlib';

const ENDPOINT_RULES = [
  // host suffix → provider tag. Path is matched separately if needed.
  { hostSuffix: 'api.anthropic.com',                provider: 'anthropic' },
  { hostSuffix: 'api.openai.com',                   provider: 'openai' },
  { hostSuffix: 'openai.azure.com',                 provider: 'openai-azure' },
  { hostSuffix: 'generativelanguage.googleapis.com', provider: 'google' },
  { hostSuffix: 'bedrock-runtime',                  provider: 'aws-bedrock' },   // *.bedrock-runtime.<region>.amazonaws.com
];

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

// For local model servers (Tier 2), detection is by URL path, not host:
//   - ollama:    /api/generate, /api/chat, /api/embeddings, /api/embed
//   - vLLM:      OpenAI-compatible — /v1/chat/completions, /v1/completions, /v1/embeddings
//   - llama.cpp: /completion, /v1/chat/completions
// We mark them as `local-<engine>` so cost = 0 (local inference) but the call
// still gets attribution + prompt content in the dashboard.
function localProviderForPath(urlPath) {
  if (!urlPath) return null;
  if (/^\/api\/(generate|chat|embeddings|embed)\b/.test(urlPath)) return 'local-ollama';
  if (/^\/v1\/(chat\/completions|completions|embeddings)\b/.test(urlPath)) return 'local-openai-compatible';
  if (/^\/completion\b/.test(urlPath)) return 'local-llamacpp';
  return null;
}

export function providerForHost(host, urlPath = null) {
  if (!host) return null;
  const h = host.toLowerCase().split(':')[0];
  // Cloud providers first.
  for (const r of ENDPOINT_RULES) {
    if (h === r.hostSuffix || h.endsWith('.' + r.hostSuffix) || h.includes(r.hostSuffix)) return r.provider;
  }
  // Local model servers — detect by path.
  if (LOCAL_HOSTS.has(h)) {
    return localProviderForPath(urlPath);
  }
  return null;
}

// Main entry point. Inputs:
//   host:           target hostname (e.g. 'api.openai.com')
//   path:           request path (e.g. '/v1/chat/completions')
//   requestBody:    Buffer of the request body
//   requestHeaders: object
//   responseBody:   Buffer of the response body (possibly gzip-encoded)
//   responseHeaders: object
//
// Returns { provider, model, prompt_tokens, completion_tokens, cached_tokens,
//   prompt_text, response_text, cost, _discovered? } or null.
//
// If `host` is not a recognized provider, we still try to detect this as an
// AI call by SHAPE — body structure rather than vendor identity. When the
// shape matches, we tag `provider: 'unknown:<wireFormat>'` and surface
// `_discovered: { host, urlPath, wireFormat }` so callers (proxy reporter)
// can publish the host to the dashboard's Discovery tray. This is the
// mechanism that gives the "govern every AI app" claim teeth — unknown
// vendors are CAPTURED, just unlabeled until an admin promotes them.
export function parseApiCall({ host, path: urlPath, requestBody, requestHeaders, responseBody, responseHeaders }) {
  const reqJson = safeJson(requestBody);
  const respBuf = maybeDecompress(responseBody, responseHeaders);

  const isSse = (responseHeaders?.['content-type'] || '').includes('text/event-stream');
  // Ollama uses NDJSON streaming (one JSON object per line) instead of SSE.
  const isNdjsonStream = (responseHeaders?.['content-type'] || '').includes('application/x-ndjson');
  const respJson = (isSse || isNdjsonStream) ? null : safeJson(respBuf);
  const sseEvents = isSse ? parseSse(respBuf) : null;
  const ndjsonEvents = isNdjsonStream ? parseNdjson(respBuf) : null;

  let provider = providerForHost(host, urlPath);
  let discovered = null;

  // Fallback: unknown host. Try shape detection — if the body looks like an
  // AI API by structure, treat it as one. False-positive risk: we require
  // BOTH a model field AND token-shaped usage in the response (or streaming
  // equivalents) before we believe it. Generic JSON APIs don't have those.
  if (!provider) {
    const shape = detectAiShape({ reqJson, respJson, sseEvents, ndjsonEvents, urlPath });
    if (!shape) return null;
    provider = `unknown:${shape.wireFormat}`;
    discovered = { host, urlPath, wireFormat: shape.wireFormat, confidence: shape.confidence };
  }

  // Dispatch to the parser. Note that 'unknown:openai' uses the same parser
  // as 'openai' — the only difference is the tag and the discovery breadcrumb.
  let parsed = null;
  if (provider === 'openai' || provider === 'openai-azure' || provider === 'local-openai-compatible' || provider === 'unknown:openai') {
    parsed = parseOpenAI({ urlPath, reqJson, respJson, sseEvents });
  } else if (provider === 'anthropic' || provider === 'unknown:anthropic') {
    parsed = parseAnthropic({ urlPath, reqJson, respJson, sseEvents });
  } else if (provider === 'google' || provider === 'unknown:google') {
    parsed = parseGoogle({ urlPath, reqJson, respJson, sseEvents });
  } else if (provider === 'aws-bedrock') {
    parsed = parseBedrock({ urlPath, reqJson, respJson, sseEvents });
  } else if (provider === 'local-ollama' || provider === 'unknown:ollama') {
    parsed = parseOllama({ urlPath, reqJson, respJson, ndjsonEvents });
  } else if (provider === 'local-llamacpp') {
    parsed = parseLlamaCpp({ urlPath, reqJson, respJson, sseEvents });
  }
  if (!parsed) return null;

  // For unknown providers we can't price reliably (model id may not match any
  // entry in pricing.js). computeCost handles the unknown case by returning
  // null — that's correct; the dashboard renders a "—" instead of a fake $.
  const cost = computeCost({
    modelId: parsed.model,
    promptTokens: parsed.prompt_tokens || 0,
    completionTokens: parsed.completion_tokens || 0,
    cachedTokens: parsed.cached_tokens || 0,
    providerHint: provider,
  });
  const out = { provider, ...parsed, cost };
  if (discovered) out._discovered = discovered;
  return out;
}

// Generic AI body-shape detector — the heart of "govern every AI app".
//
// Returns { wireFormat, confidence } or null. Designed to be conservative —
// false positives here mean we'd capture random non-AI JSON traffic, so we
// require strong signals (model field + usage tokens, OR clearly-shaped
// streaming events).
//
// Detection order matters: Anthropic shapes a SUPERSET of "messages+model"
// so its more-specific markers (input_tokens, content[].type='text') win
// over OpenAI's. Tested by smoke-test alongside.
export function detectAiShape({ reqJson, respJson, sseEvents, ndjsonEvents, urlPath } = {}) {
  // --- Anthropic shape ---
  // Request: { model, messages: [...], max_tokens, ... }   (max_tokens is required by Anthropic API)
  // Response (non-stream): { content: [{type:'text', text:'...'}], usage: { input_tokens, output_tokens } }
  // Response (SSE):        events of type 'content_block_delta' with delta.text
  const anthropicReq = reqJson && typeof reqJson.model === 'string'
    && Array.isArray(reqJson.messages)
    && (reqJson.max_tokens != null || reqJson.system != null);
  const anthropicResp = (respJson && Array.isArray(respJson.content)
    && respJson.content.some((b) => b && b.type === 'text')
    && (respJson.usage?.input_tokens != null || respJson.usage?.output_tokens != null))
    || (Array.isArray(sseEvents) && sseEvents.some((e) => e?.type === 'content_block_delta' || e?.type === 'message_start'));
  if (anthropicReq && anthropicResp) return { wireFormat: 'anthropic', confidence: 'high' };

  // --- Google Gemini shape ---
  // Request:  { contents: [{role, parts: [{text}]}] }
  // Response: { candidates: [{content:{parts:[{text}]}}], usageMetadata: {promptTokenCount, candidatesTokenCount} }
  const geminiReq = reqJson && Array.isArray(reqJson.contents)
    && reqJson.contents.some((c) => Array.isArray(c?.parts));
  const geminiResp = (respJson && Array.isArray(respJson.candidates) && respJson.usageMetadata)
    || (Array.isArray(sseEvents) && sseEvents.some((e) => e?.candidates && e?.usageMetadata != null))
    || (typeof urlPath === 'string' && /:generateContent\b|:streamGenerateContent\b/.test(urlPath));
  if (geminiReq && geminiResp) return { wireFormat: 'google', confidence: 'high' };

  // --- Ollama (NDJSON) shape ---
  // Detect first because it's a SUPERSET of OpenAI's `{model, messages}` shape.
  // Distinguishing marker: NDJSON streaming with `done` field, or `prompt_eval_count`/`eval_count` in usage.
  const ollamaResp = (Array.isArray(ndjsonEvents) && ndjsonEvents.some((e) => e?.done === true))
    || (respJson && (respJson.prompt_eval_count != null || respJson.eval_count != null));
  const ollamaReq = reqJson && (Array.isArray(reqJson.messages) || typeof reqJson.prompt === 'string')
    && typeof reqJson.model === 'string';
  if (ollamaReq && ollamaResp) return { wireFormat: 'ollama', confidence: 'high' };

  // --- OpenAI-compatible shape ---
  // Request:  { model, messages:[{role,content}] }                OR
  //           { model, prompt:'...' }                              OR
  //           { model, input:'...' }   (responses API)
  // Response: { choices:[{message:{content}} | {delta:{content}}], usage:{prompt_tokens, completion_tokens} }
  // SSE:      events with `choices[0].delta.content`
  const openaiReq = reqJson && typeof reqJson.model === 'string'
    && (Array.isArray(reqJson.messages) || typeof reqJson.prompt === 'string' || reqJson.input != null);
  const openaiResp = (respJson && Array.isArray(respJson.choices)
    && (respJson.usage?.prompt_tokens != null || respJson.usage?.input_tokens != null))
    || (Array.isArray(sseEvents) && sseEvents.some((e) => e?.choices?.[0]?.delta != null));
  if (openaiReq && openaiResp) return { wireFormat: 'openai', confidence: 'high' };

  // Loose-match fallbacks (medium confidence) — request alone, no usage in
  // response. These get captured but flagged so admins can review.
  if (openaiReq && Array.isArray(respJson?.choices)) return { wireFormat: 'openai', confidence: 'medium' };
  if (anthropicReq && Array.isArray(respJson?.content)) return { wireFormat: 'anthropic', confidence: 'medium' };

  return null;
}

// ---- Provider-specific parsers ----

function parseOpenAI({ urlPath, reqJson, respJson, sseEvents }) {
  // /v1/chat/completions, /v1/completions, /v1/embeddings, /v1/responses
  if (!urlPath) return null;
  const model = reqJson?.model || respJson?.model || null;

  // Build prompt text from `messages` (chat) or `prompt` (legacy) or `input` (responses API).
  let promptText = null;
  if (Array.isArray(reqJson?.messages)) {
    promptText = reqJson.messages.map((m) => {
      const role = m.role || 'user';
      const content = typeof m.content === 'string'
        ? m.content
        : Array.isArray(m.content) ? m.content.map((c) => c.text || '').join('') : '';
      return `[${role}] ${content}`;
    }).join('\n');
  } else if (typeof reqJson?.prompt === 'string') {
    promptText = reqJson.prompt;
  } else if (typeof reqJson?.input === 'string') {
    promptText = reqJson.input;
  } else if (Array.isArray(reqJson?.input)) {
    promptText = reqJson.input.map((x) => typeof x === 'string' ? x : (x?.text || '')).join('\n');
  }

  // Response text + usage.
  let responseText = null;
  let usage = respJson?.usage || null;

  if (respJson?.choices?.length) {
    responseText = respJson.choices.map((c) => c.message?.content || c.text || '').join('\n');
  } else if (sseEvents) {
    const collected = [];
    let finalUsage = null;
    for (const e of sseEvents) {
      // Chat streaming: each `data:` is `{choices:[{delta:{content:"..."}}]}`.
      const delta = e?.choices?.[0]?.delta?.content;
      if (typeof delta === 'string') collected.push(delta);
      // Some streams include `usage` on the final chunk (when stream_options.include_usage=true).
      if (e?.usage) finalUsage = e.usage;
    }
    if (collected.length) responseText = collected.join('');
    if (finalUsage) usage = finalUsage;
  }

  if (!usage) return null;     // can't price without tokens; skip
  return {
    model,
    prompt_tokens: usage.prompt_tokens ?? usage.input_tokens ?? 0,
    completion_tokens: usage.completion_tokens ?? usage.output_tokens ?? 0,
    cached_tokens: usage.prompt_tokens_details?.cached_tokens ?? 0,
    prompt_text: promptText,
    response_text: responseText,
  };
}

function parseAnthropic({ urlPath, reqJson, respJson, sseEvents }) {
  // /v1/messages — request has `messages` and optional `system`; response has
  // `content: [{type:'text', text:'...'}]` and `usage: {input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens}`.
  if (!urlPath) return null;
  const model = reqJson?.model || respJson?.model || null;

  let promptText = null;
  if (reqJson) {
    const parts = [];
    if (typeof reqJson.system === 'string') parts.push(`[system] ${reqJson.system}`);
    else if (Array.isArray(reqJson.system)) parts.push(`[system] ${reqJson.system.map((s) => s.text || '').join('')}`);
    if (Array.isArray(reqJson.messages)) {
      for (const m of reqJson.messages) {
        const role = m.role || 'user';
        const c = typeof m.content === 'string'
          ? m.content
          : Array.isArray(m.content) ? m.content.map((b) => b.text || '').join('') : '';
        parts.push(`[${role}] ${c}`);
      }
    }
    promptText = parts.join('\n');
  }

  let responseText = null;
  let usage = respJson?.usage || null;

  if (Array.isArray(respJson?.content)) {
    responseText = respJson.content.map((b) => b.text || '').join('');
  } else if (sseEvents) {
    const collected = [];
    let finalUsage = null;
    for (const e of sseEvents) {
      // Anthropic streaming events: `content_block_delta` with `{delta:{type:'text_delta', text:'...'}}`.
      if (e?.type === 'content_block_delta' && e?.delta?.text) collected.push(e.delta.text);
      // `message_delta` events at the end carry final usage.
      if (e?.type === 'message_delta' && e?.usage) finalUsage = { ...(finalUsage || {}), ...e.usage };
      if (e?.type === 'message_start' && e?.message?.usage) finalUsage = { ...(finalUsage || {}), ...e.message.usage };
    }
    if (collected.length) responseText = collected.join('');
    if (finalUsage) usage = finalUsage;
  }

  if (!usage) return null;
  return {
    model,
    prompt_tokens: usage.input_tokens ?? 0,
    completion_tokens: usage.output_tokens ?? 0,
    cached_tokens: (usage.cache_read_input_tokens ?? 0),
    prompt_text: promptText,
    response_text: responseText,
  };
}

function parseGoogle({ urlPath, reqJson, respJson, sseEvents }) {
  // generativelanguage.googleapis.com/v1beta/models/<MODEL>:generateContent  (or :streamGenerateContent)
  // Model id is in the URL path, not the body.
  if (!urlPath) return null;
  const modelMatch = urlPath.match(/models\/([^/:]+)/);
  const model = modelMatch ? modelMatch[1] : null;

  // Request — `contents: [{role, parts:[{text}]}]`.
  let promptText = null;
  if (Array.isArray(reqJson?.contents)) {
    promptText = reqJson.contents.map((c) => {
      const role = c.role || 'user';
      const text = Array.isArray(c.parts) ? c.parts.map((p) => p.text || '').join('') : '';
      return `[${role}] ${text}`;
    }).join('\n');
  }

  // Response — `candidates[0].content.parts[].text` + `usageMetadata`.
  let responseText = null;
  let usage = respJson?.usageMetadata || null;
  if (respJson?.candidates?.length) {
    responseText = respJson.candidates.map((c) => {
      return Array.isArray(c.content?.parts) ? c.content.parts.map((p) => p.text || '').join('') : '';
    }).join('\n');
  } else if (sseEvents) {
    const collected = [];
    let finalUsage = null;
    for (const e of sseEvents) {
      const parts = e?.candidates?.[0]?.content?.parts;
      if (Array.isArray(parts)) collected.push(parts.map((p) => p.text || '').join(''));
      if (e?.usageMetadata) finalUsage = e.usageMetadata;
    }
    if (collected.length) responseText = collected.join('');
    if (finalUsage) usage = finalUsage;
  }

  if (!usage) return null;
  return {
    model,
    prompt_tokens: usage.promptTokenCount ?? 0,
    completion_tokens: usage.candidatesTokenCount ?? 0,
    cached_tokens: usage.cachedContentTokenCount ?? 0,
    prompt_text: promptText,
    response_text: responseText,
  };
}

function parseOllama({ urlPath, reqJson, respJson, ndjsonEvents }) {
  // ollama endpoints:
  //   /api/chat     — req {model, messages:[{role,content}], stream}
  //                   resp non-stream: {message:{role,content}, prompt_eval_count, eval_count}
  //                   resp NDJSON:      one obj per token; final obj has done=true + counts
  //   /api/generate — req {model, prompt, stream}
  //                   resp non-stream: {response, prompt_eval_count, eval_count}
  //                   resp NDJSON:      stream of {response} chunks; final has counts
  //   /api/embeddings — no token counts; we still log prompt
  const model = reqJson?.model || respJson?.model || null;

  // Prompt text.
  let promptText = null;
  if (Array.isArray(reqJson?.messages)) {
    promptText = reqJson.messages.map((m) => {
      const role = m.role || 'user';
      const content = typeof m.content === 'string' ? m.content : '';
      return `[${role}] ${content}`;
    }).join('\n');
  } else if (typeof reqJson?.prompt === 'string') {
    promptText = reqJson.prompt;
  } else if (typeof reqJson?.input === 'string') {
    promptText = reqJson.input;
  }

  // Response text + counts.
  let responseText = null;
  let promptTokens = null;
  let completionTokens = null;

  if (respJson) {
    // Non-streaming
    responseText = respJson.message?.content || respJson.response || null;
    promptTokens     = respJson.prompt_eval_count ?? null;
    completionTokens = respJson.eval_count ?? null;
  } else if (ndjsonEvents) {
    const collected = [];
    for (const e of ndjsonEvents) {
      // /api/chat streaming: each chunk has `message.content`. /api/generate: `response`.
      if (typeof e?.message?.content === 'string') collected.push(e.message.content);
      else if (typeof e?.response === 'string') collected.push(e.response);
      if (e?.done === true) {
        if (e.prompt_eval_count != null) promptTokens = e.prompt_eval_count;
        if (e.eval_count != null)        completionTokens = e.eval_count;
      }
    }
    if (collected.length) responseText = collected.join('');
  }

  // No tokens? Still useful to log the call — it's local, cost is 0 by definition.
  // Don't bail on missing usage for local providers.
  return {
    model,
    prompt_tokens: promptTokens || 0,
    completion_tokens: completionTokens || 0,
    cached_tokens: 0,
    prompt_text: promptText,
    response_text: responseText,
  };
}

function parseLlamaCpp({ urlPath, reqJson, respJson, sseEvents }) {
  // llama.cpp server's native endpoint:
  //   /completion — req {prompt, n_predict, stream}; resp {content, tokens_predicted, tokens_evaluated}
  // OpenAI-compat /v1/* is parsed by parseOpenAI in the dispatcher above.
  const model = reqJson?.model || 'llama.cpp-local';
  const promptText = typeof reqJson?.prompt === 'string' ? reqJson.prompt : null;

  let responseText = null;
  let promptTokens = null;
  let completionTokens = null;

  if (respJson) {
    responseText     = typeof respJson.content === 'string' ? respJson.content : null;
    promptTokens     = respJson.tokens_evaluated ?? null;
    completionTokens = respJson.tokens_predicted ?? null;
  } else if (sseEvents) {
    // llama.cpp SSE: each event has {content, stop}. Final event has tokens_evaluated + tokens_predicted.
    const collected = [];
    for (const e of sseEvents) {
      if (typeof e?.content === 'string') collected.push(e.content);
      if (e?.stop === true) {
        if (e.tokens_evaluated != null) promptTokens = e.tokens_evaluated;
        if (e.tokens_predicted != null) completionTokens = e.tokens_predicted;
      }
    }
    if (collected.length) responseText = collected.join('');
  }

  return {
    model,
    prompt_tokens: promptTokens || 0,
    completion_tokens: completionTokens || 0,
    cached_tokens: 0,
    prompt_text: promptText,
    response_text: responseText,
  };
}

function parseBedrock({ urlPath, reqJson, respJson, sseEvents }) {
  // Bedrock has many invocation shapes — different per model owner. v1 covers
  // the common Anthropic-on-Bedrock and InvokeModel paths; everything else
  // returns null and we log it as `provider=aws-bedrock` with no tokens.
  if (!urlPath) return null;
  const modelMatch = urlPath.match(/model\/([^/]+)/);
  const model = modelMatch ? decodeURIComponent(modelMatch[1]) : null;
  const usage = respJson?.usage || null;
  if (!usage) return null;
  return {
    model,
    prompt_tokens: usage.input_tokens ?? usage.inputTokens ?? 0,
    completion_tokens: usage.output_tokens ?? usage.outputTokens ?? 0,
    cached_tokens: 0,
    prompt_text: null,
    response_text: null,
  };
}

// ---- Helpers ----

function safeJson(buf) {
  if (!buf || buf.length === 0) return null;
  try { return JSON.parse(buf.toString('utf8')); } catch { return null; }
}

function maybeDecompress(buf, headers) {
  if (!buf || buf.length === 0) return buf;
  const enc = (headers?.['content-encoding'] || '').toLowerCase();
  try {
    if (enc === 'gzip') return zlib.gunzipSync(buf);
    if (enc === 'br')   return zlib.brotliDecompressSync(buf);
    if (enc === 'deflate') return zlib.inflateSync(buf);
  } catch { /* fall through to raw */ }
  return buf;
}

function parseNdjson(buf) {
  if (!buf || buf.length === 0) return [];
  const text = buf.toString('utf8');
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch {}
  }
  return out;
}

function parseSse(buf) {
  if (!buf || buf.length === 0) return [];
  const text = buf.toString('utf8');
  const events = [];
  for (const block of text.split(/\r?\n\r?\n/)) {
    if (!block.trim()) continue;
    const dataLines = [];
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
    }
    if (!dataLines.length) continue;
    const payload = dataLines.join('\n');
    if (payload === '[DONE]') continue;
    try { events.push(JSON.parse(payload)); } catch {}
  }
  return events;
}

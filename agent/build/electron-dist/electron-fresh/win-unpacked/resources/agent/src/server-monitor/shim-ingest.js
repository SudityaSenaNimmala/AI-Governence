// Local ingest endpoint for the Python in-process shim (Tier 3 L4).
//
// The shim runs INSIDE the agent's Python process — it can't talk to the
// governance server directly without re-implementing auth, retries, etc.
// Instead it POSTs to the daemon over a local-only HTTP listener; the daemon
// adds attribution and forwards via the normal reporter.
//
// Listens on 127.0.0.1:SHIM_PORT (default 8744 — different from the proxy
// port so callers can't be confused). HTTP, no auth — bound to loopback only.
//
// Body shape (one POST per LLM call inside the agent process):
//   {
//     occurred_at,       (ISO timestamp)
//     duration_ms,
//     provider,          ("local-python-transformers" | "local-python-llamacpp" | "openai-python-sdk" | "anthropic-python-sdk")
//     model,
//     prompt_text,
//     response_text,
//     prompt_tokens, completion_tokens   (best-effort)
//     pid                (so we can attribute back via /proc)
//   }

import http from 'node:http';
import { attribute } from './attribution.js';
import { computeCost } from './pricing.js';

const SHIM_HOST = '127.0.0.1';
const SHIM_PORT = Number(process.env.SHIM_INGEST_PORT) || 8744;
const MAX_BODY = 8 * 1024 * 1024;   // 8MB per call

export function startShimIngest({ reporter, log }) {
  const server = http.createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/v1/in-process') {
      res.writeHead(404).end();
      return;
    }
    let bytes = 0;
    const chunks = [];
    req.on('data', (c) => {
      bytes += c.length;
      if (bytes > MAX_BODY) { req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', async () => {
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        await ingest(body, reporter, log);
        res.writeHead(204).end();
      } catch (e) {
        log?.warn?.(`shim-ingest: bad payload ${e.message}`);
        res.writeHead(400).end();
      }
    });
    req.on('error', () => { try { res.writeHead(400).end(); } catch {} });
  });

  server.listen(SHIM_PORT, SHIM_HOST, () => {
    log?.info?.(`shim-ingest: listening on http://${SHIM_HOST}:${SHIM_PORT}/v1/in-process`);
  });
  server.on('error', (err) => log?.warn?.(`shim-ingest: server error ${err.message}`));

  return {
    stop() { try { server.close(); } catch {} },
  };
}

async function ingest(body, reporter, log) {
  if (!body || !body.occurred_at) return;

  const attr = body.pid ? await attribute(body.pid).catch(() => null) : null;

  // Cost — for openai/anthropic via the python SDK we can price; for local
  // python frameworks (transformers/llama_cpp) it's always $0.
  const isCloudSdk = body.provider === 'openai-python-sdk' || body.provider === 'anthropic-python-sdk';
  const cost = computeCost({
    modelId: body.model,
    promptTokens: body.prompt_tokens || 0,
    completionTokens: body.completion_tokens || 0,
    providerHint: isCloudSdk ? null : 'local-python',
  });

  reporter.enqueue({
    occurred_at: body.occurred_at,
    duration_ms: body.duration_ms ?? null,
    response_status: 200,
    host: 'python-in-process',
    path: body.endpoint || `/in-process/${body.provider || 'unknown'}`,
    method: 'CALL',
    provider: body.provider || 'unknown',
    model: body.model || null,
    prompt_tokens: body.prompt_tokens || 0,
    completion_tokens: body.completion_tokens || 0,
    cached_tokens: 0,
    cost,
    prompt_text: body.prompt_text || null,
    response_text: body.response_text || null,
    response_truncated: false,
    attribution: attr,
  });
}

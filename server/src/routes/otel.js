import crypto from 'node:crypto';
import { a } from '../util.js';

// Ingests OpenTelemetry from the Claude Code CLI (and other OTel-emitting CLIs).
// Two event kinds are consumed:
//
//   claude_code.user_prompt  -> dlp_events (prompt counts, as before)
//   claude_code.api_request  -> ai_token_usage (REAL token counts + cost)
//
// The api_request event is the only place we get billed-accurate numbers without
// an Anthropic admin key: Claude Code reports input_tokens, output_tokens,
// cache_read_tokens, cache_creation_tokens and cost_usd per request, and every
// event carries user.email from the OAuth login. Everything else in the product
// estimates tokens from captured prompt length; these are measured.
//
// CLIs run inside a terminal process, so the process-name keystroke watcher
// can't see them — OTel is the supported path. Point the CLI at this endpoint:
//   CLAUDE_CODE_ENABLE_TELEMETRY=1
//   OTEL_LOGS_EXPORTER=otlp
//   OTEL_EXPORTER_OTLP_PROTOCOL=http/json
//   OTEL_EXPORTER_OTLP_ENDPOINT=http://<server>:8787/api/v1/otel
// (the exporter appends /v1/logs). Prompt content is NOT logged by Claude Code
// unless OTEL_LOG_USER_PROMPTS=1 — we only read the prompt_length attribute.
//
// NOTE on metrics: Claude Code also exports a `claude_code.token.usage` metric
// carrying the same totals. We deliberately do NOT count tokens from it — doing
// so alongside api_request would double-count every request. The metrics
// endpoint stays accepted-and-ignored so a fully-configured exporter doesn't
// error; api_request is the single source of truth for tokens and cost.

// Flatten an OTLP attributes array [{key,value:{stringValue|intValue|...}}] to an object.
function attrsToObj(attrs) {
  const o = {};
  for (const a of attrs || []) {
    const v = a?.value || {};
    o[a.key] =
      v.stringValue ??
      (v.intValue != null ? Number(v.intValue) : undefined) ??
      (v.doubleValue != null ? Number(v.doubleValue) : undefined) ??
      v.boolValue ??
      undefined;
  }
  return o;
}

function nanoToIso(nano) {
  if (!nano) return new Date().toISOString();
  try { return new Date(Number(BigInt(nano) / 1000000n)).toISOString(); }
  catch { return new Date().toISOString(); }
}

// Resolve the human behind a Claude Code event. user.email is present whenever
// the CLI is logged in via OAuth; account_uuid and session.id are fallbacks so a
// row is never dropped for want of an identity.
function identify(a2, resAttrs) {
  const email =
    a2['user.email'] || resAttrs['user.email'] ||
    a2['user.account_uuid'] || resAttrs['user.account_uuid'] || null;
  const sessionId = a2['session.id'] || resAttrs['session.id'] || null;
  return { email, sessionId, machineId: 'clicode:' + (email || sessionId || 'unknown') };
}

export function mountOtel(app, db) {
  // Attribute the CLI user to a synthetic machine keyed by their identity, so the
  // AI Usage per-user grouping resolves a real name.
  async function touchMachine(machineId, email, now) {
    await db.collection('machines').updateOne(
      { id: machineId },
      {
        $set: { id: machineId, hostname: 'Claude Code CLI', user: email || 'Claude Code CLI', last_seen: now },
        $setOnInsert: { first_seen: now },
      },
      { upsert: true },
    );
  }

  // OTLP/HTTP JSON logs. Exporter POSTs to {OTEL_EXPORTER_OTLP_ENDPOINT}/v1/logs.
  app.post('/api/v1/otel/v1/logs', a(async (req, res) => {
    const resourceLogs = req.body?.resourceLogs || [];
    let stored = 0;
    let usageStored = 0;

    for (const rl of resourceLogs) {
      const resAttrs = attrsToObj(rl?.resource?.attributes);
      if (process.env.CFAI_OTEL_DEBUG === '1') {
        console.log('[otel-debug] resource attrs:', JSON.stringify(resAttrs));
      }
      for (const sl of rl?.scopeLogs || []) {
        for (const rec of sl?.logRecords || []) {
          const a2 = attrsToObj(rec.attributes);
          // Event name lives in the body or an event.name attribute depending on SDK version.
          const name = rec?.body?.stringValue || a2['event.name'] || a2['event_name'];
          const occurredAt = nanoToIso(rec.timeUnixNano || rec.observedTimeUnixNano);
          const now = new Date();

          if (name === 'claude_code.user_prompt') {
            const { email, sessionId, machineId } = identify(a2, resAttrs);
            const promptLen = Number(a2['prompt_length'] ?? a2['prompt.length'] ?? 0) || 0;

            await touchMachine(machineId, email, now);

            await db.collection('dlp_events').insertOne({
              id: crypto.randomUUID(),
              machine_id: machineId,
              occurred_at: occurredAt,
              source: 'claude_code_cli',
              ai_service: 'Claude Code',
              event_kind: 'prompt_submit',
              secret_class: null,
              content_length: promptLen,
              pattern_matched: null,
              metadata_json: JSON.stringify({
                via: 'otel',
                session_id: sessionId,
                model: a2['model'] || null,
                terminal: a2['terminal.type'] || null,
              }),
              received_at: now,
            });
            stored++;
            continue;
          }

          // Real, billed-accurate token counts and cost — the one source in this
          // product that isn't an estimate.
          if (name === 'claude_code.api_request') {
            const { email, sessionId, machineId } = identify(a2, resAttrs);
            const requestId = a2['request_id'] || null;

            const inputTokens = Number(a2['input_tokens'] ?? 0) || 0;
            const outputTokens = Number(a2['output_tokens'] ?? 0) || 0;
            const cacheReadTokens = Number(a2['cache_read_tokens'] ?? 0) || 0;
            const cacheCreationTokens = Number(a2['cache_creation_tokens'] ?? 0) || 0;

            // cost_usd_micros is integer-safe; prefer it and fall back to the float.
            const micros = a2['cost_usd_micros'];
            const costUsd = micros != null
              ? Number(micros) / 1e6
              : (Number(a2['cost_usd'] ?? 0) || 0);

            await touchMachine(machineId, email, now);

            const row = {
              machine_id: machineId,
              user_email: email,
              occurred_at: occurredAt,
              source: 'claude_code_cli',
              ai_service: 'Claude Code',
              model: a2['model'] || null,
              input_tokens: inputTokens,
              output_tokens: outputTokens,
              cache_read_tokens: cacheReadTokens,
              cache_creation_tokens: cacheCreationTokens,
              total_tokens: inputTokens + outputTokens + cacheReadTokens + cacheCreationTokens,
              cost_usd: costUsd,
              measured: true,            // distinguishes these from estimated rows
              request_id: requestId,
              session_id: sessionId,
              query_source: a2['query_source'] || null,
              duration_ms: Number(a2['duration_ms'] ?? 0) || 0,
              received_at: now,
            };

            if (requestId) {
              // Claude Code retries re-emit the same request_id; upsert so a retry
              // corrects the row instead of double-counting the tokens. `id` lives
              // only in $setOnInsert — putting it in the filter too would make
              // Mongo reject the upsert with a path conflict.
              await db.collection('ai_token_usage').updateOne(
                { source: 'claude_code_cli', request_id: requestId },
                { $set: row, $setOnInsert: { id: crypto.randomUUID() } },
                { upsert: true },
              );
            } else {
              await db.collection('ai_token_usage').insertOne({ id: crypto.randomUUID(), ...row });
            }
            usageStored++;
          }
        }
      }
    }

    // OTLP success response shape — exporters parse this strictly, so keep it to
    // exactly `partialSuccess` and carry our counters in a header instead.
    res.set('x-aigov-ingested', `prompts=${stored},usage=${usageStored}`);
    res.status(200).json({ partialSuccess: {} });
  }));

  // Accept (and ignore) metrics/traces so an exporter configured for them doesn't error.
  app.post('/api/v1/otel/v1/metrics', (req, res) => res.status(200).json({ partialSuccess: {} }));
  app.post('/api/v1/otel/v1/traces', (req, res) => res.status(200).json({ partialSuccess: {} }));
}

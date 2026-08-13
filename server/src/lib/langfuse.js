// Langfuse Cloud client config — the ONE real Langfuse credential this product
// owns, shared by the ingestion gateway (routes/langfuse-gateway.js) and the
// read path (routes/sdk.js).
//
// There is exactly one real Langfuse project, owned by CloudFuze. Per-project
// auto-provisioning on Langfuse's side is an Enterprise-only feature we are not
// buying, so tenant separation is OUR job: every developer gets a credential
// pair minted by us, and their traces are segregated inside the shared Langfuse
// project by a `cfproj:<project id>` tag that only the gateway may write.
//
// LANGFUSE_SECRET_KEY is the crown jewel here: it can read and write EVERY
// developer's traces. It never leaves this process — never logged, never put in
// a response body, never handed to an SDK. The credential a developer holds is
// the one we minted for them, which only this server understands.
//
// Config is read from process.env at CALL time, not at import time, so that a
// container which starts before Langfuse is configured picks the values up on a
// restart without any other code caring, and so tests can toggle it.

export const LANGFUSE_TIMEOUT_MS = 15_000;

export function langfuseConfig() {
  const baseUrl = String(process.env.LANGFUSE_BASE_URL || '').trim().replace(/\/+$/, '');
  const publicKey = String(process.env.LANGFUSE_PUBLIC_KEY || '').trim();
  const secretKey = String(process.env.LANGFUSE_SECRET_KEY || '').trim();
  return {
    baseUrl,
    publicKey,
    secretKey,
    // All three or nothing: a base URL with no credentials produces a confusing
    // 401 from Langfuse on the first real request instead of an honest 503 here.
    configured: Boolean(baseUrl && publicKey && secretKey),
  };
}

// HTTP Basic with CloudFuze's real Langfuse key pair. Never log the return value.
export function langfuseAuthHeader(cfg = langfuseConfig()) {
  return 'Basic ' + Buffer.from(`${cfg.publicKey}:${cfg.secretKey}`).toString('base64');
}

// One outbound call to Langfuse Cloud. Returns the raw Response so callers decide
// how to treat a non-2xx (the gateway passes it through verbatim so the SDK's own
// retry/backoff still works; the read path degrades to an empty result).
//
// `fetch` is called unqualified on purpose: it resolves the global binding per
// call, so tests can stub globalThis.fetch without this module cooperating.
export function langfuseFetch(path, { method = 'GET', body, headers = {}, timeoutMs = LANGFUSE_TIMEOUT_MS } = {}) {
  const cfg = langfuseConfig();
  if (!cfg.configured) throw new Error('langfuse not configured');
  return fetch(`${cfg.baseUrl}${path}`, {
    method,
    headers: { authorization: langfuseAuthHeader(cfg), ...headers },
    body,
    signal: AbortSignal.timeout(timeoutMs),
  });
}

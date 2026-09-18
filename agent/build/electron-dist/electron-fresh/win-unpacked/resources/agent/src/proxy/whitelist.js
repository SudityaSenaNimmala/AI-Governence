// Domains the proxy intercepts (TLS-terminates + scans request bodies).
//
// Everything NOT in this list is bridged at the socket layer with zero MITM —
// browsers, Slack, OS update traffic, etc. pass through untouched. This keeps
// the cert-pinning blast radius small and avoids breaking unrelated apps.
//
// Match is on the SNI host (or HTTP Host header). Subdomains are matched via
// suffix: an entry of `openai.com` matches `api.openai.com` and `chatgpt.com`
// equivalents below. Each entry is its own apex to keep the matching explicit.
//
// Source of truth for KNOWN apps is `agent/src/registry/ai-apps.json` — the
// hardcoded arrays below are kept as a fallback (so the proxy still works if
// the registry file is missing or fails to parse) but are merged with the
// registry at module load. Unknown apps are caught at runtime by the
// shape-based detector in cost-parser.js, NOT by adding them here.

import * as _registry from '../registry/loader.js';

// ARCHITECTURE NOTE (v1):
//
// We intercept ONLY API endpoints — the ones that CLIs, SDKs, and headless
// scripts hit directly. Web frontends (chatgpt.com, claude.ai, gemini.google.com,
// www.perplexity.ai, poe.com) are intentionally NOT in this list:
//
//   - Browser traffic to those is handled by the browser extension (DOM-level
//     intercept + centered modal, never trips Cloudflare).
//   - Claude Desktop traffic to claude.ai is handled by the asar hook in the
//     Electron app itself (same modal pattern).
//   - ChatGPT Store traffic to chatgpt.com is currently uncovered at the
//     network layer — Store sandboxing blocks asar injection, and intercepting
//     chatgpt.com at the proxy reliably trips Cloudflare 431 + cert-pinning
//     edge cases. Pending a per-process bypass implementation (see ROADMAP).
//
// What this means for coverage:
//   * api.openai.com           — CLI tools, custom integrations, OpenAI SDKs
//   * api.anthropic.com        — Anthropic SDKs, Claude API consumers
//   * generativelanguage.*     — Gemini API
//   * api.copilot.microsoft.com— Copilot programmatic
//   * api.perplexity.ai        — Perplexity API
//   * api-inference.huggingface.co — HF inference
export const INTERCEPT_DOMAINS = [
  // ---- API endpoints (CLIs, SDKs, scripts) — always intercept ----
  'api.openai.com',
  'api.anthropic.com',
  'generativelanguage.googleapis.com',
  'api.copilot.microsoft.com',
  'api.perplexity.ai',
  'api-inference.huggingface.co',

  // ---- Local model servers (Tier 2 localhost intercept) ----
  // Server-monitor passes alwaysIntercept=true, so these get TLS-terminated
  // when accessed via HTTPS (rare for local services — most run plain HTTP
  // which goes through the proxy's plain-HTTP handler directly).
  // Detection of ollama / vLLM / llama.cpp is done by URL path in the cost
  // parser, not by host.
  'localhost',
  '127.0.0.1',

  // ---- AI web frontends — intercepted ONLY when source is a known AI
  // desktop app (ChatGPT.exe, claude.exe, etc.). Browsers hitting these
  // bridge through silently because their process names aren't in the AI
  // desktop list. See scan-policy.js / AI_DESKTOP_PROCESSES + the CONNECT
  // handler in proxy-server.js.
  'chatgpt.com',
  'chat.openai.com',
  'claude.ai',
  'gemini.google.com',
  'aistudio.google.com',
  'copilot.microsoft.com',
  'www.perplexity.ai',
  'perplexity.ai',
  'poe.com',
  'huggingface.co',
];

// Hosts intercepted regardless of source process. API endpoints — typically
// called by CLIs / SDKs / scripts where we DO want body inspection no matter
// who's calling. Exported so tests can extend it (e.g. add 127.0.0.1).
export const ALWAYS_INTERCEPT = new Set([
  'api.openai.com',
  'api.anthropic.com',
  'generativelanguage.googleapis.com',
  'api.copilot.microsoft.com',
  'api.perplexity.ai',
  'api-inference.huggingface.co',
  'localhost',
  '127.0.0.1',
]);

// Hosts we KNOW pin their TLS certs and refuse our CA. MITMing them just
// generates ERR_SSL_SSLV3_ALERT_CERTIFICATE_UNKNOWN spam, breaks the app's
// realtime feature, and forces the app into a retry loop. Bridge them
// unconditionally — we lose DLP visibility for these endpoints, but that
// loss already happened the moment the vendor pinned. Discovered hosts
// get added here.
const NEVER_INTERCEPT = new Set([
  // ChatGPT Desktop (Microsoft Store) pins its TLS certs across the entire
  // chatgpt.com surface — both the WebSocket endpoint and the regular
  // backend-api host. Confirmed via ERR_SSL_SSLV3_ALERT_CERTIFICATE_UNKNOWN
  // logs 2026-05-20. Bridge unconditionally to stop the failed-handshake
  // retry loop. (Proxy-based DLP is impossible for this app — the app
  // refuses any CA the user installs.)
  'chatgpt.com',
  'ws.chatgpt.com',
]);

// Merge registry into the in-memory lists. Done at module load so existing
// callers that read INTERCEPT_DOMAINS / ALWAYS_INTERCEPT directly continue
// to work. Failures here are non-fatal — the hardcoded baseline above is the
// floor of coverage.
try {
  for (const d of _registry.alwaysInterceptDomains()) {
    if (!INTERCEPT_DOMAINS.includes(d)) INTERCEPT_DOMAINS.push(d);
    ALWAYS_INTERCEPT.add(d);
  }
  for (const d of _registry.webDomains()) {
    if (!INTERCEPT_DOMAINS.includes(d)) INTERCEPT_DOMAINS.push(d);
  }
  for (const d of _registry.pinnedDomains()) {
    NEVER_INTERCEPT.add(d);
  }
} catch (e) {
  // Don't throw — proxy still functions on the hardcoded list.
  // eslint-disable-next-line no-console
  console.warn(`[whitelist] registry merge skipped: ${e?.message || e}`);
}

/** True if MITM is forbidden for this host (cert pinning known). */
export function isPinnedHost(host) {
  if (!host) return false;
  const h = host.toLowerCase().split(':')[0];
  if (NEVER_INTERCEPT.has(h)) return true;
  for (const d of NEVER_INTERCEPT) {
    if (h.endsWith('.' + d)) return true;
  }
  return false;
}

// Heuristic: virtually every LLM API endpoint lives under `api.<vendor>` or
// `inference.<vendor>`. When CFAI_DISCOVER_UNKNOWN=1 (default on in dev),
// match these patterns so unknown AI vendors get MITMed and fingerprinted by
// the shape detector in cost-parser.js. Without this, the Discovery tray
// can only ever surface vendors already in the intercept list — which
// defeats the point of "govern every AI app".
//
// Tradeoff: non-AI endpoints under api.* (api.stripe.com, api.github.com,
// api.spotify.com, etc.) also get MITMed. Most aren't TLS-pinned so they
// keep working; the shape detector returns null on them so they generate
// no discovery rows or extra storage. The cost is a TLS handshake on our
// CA, ~50–150ms added to first call. Set CFAI_DISCOVER_UNKNOWN=0 to revert
// to strict allow-list mode.
const DISCOVER_UNKNOWN = process.env.CFAI_DISCOVER_UNKNOWN !== '0';
const UNKNOWN_AI_HOST_RE = /^(api|inference|gateway|chat|llm)\./i;

export function isLikelyAiApi(host) {
  if (!DISCOVER_UNKNOWN || !host) return false;
  const h = host.toLowerCase().split(':')[0];
  // Don't widen onto pinned hosts — those still bridge to avoid handshake spam.
  if (isPinnedHost(h)) return false;
  return UNKNOWN_AI_HOST_RE.test(h);
}

// Lookup reads the array live so tests can append. Cost is negligible.
export function isIntercepted(host) {
  if (!host) return false;
  const h = host.toLowerCase().split(':')[0];     // strip port
  for (const d of INTERCEPT_DOMAINS) {
    const dl = d.toLowerCase();
    if (h === dl) return true;
    if (h.endsWith('.' + dl)) return true;
  }
  // Heuristic fallback so the Discovery tray can actually populate. See
  // isLikelyAiApi() above for the rationale.
  return isLikelyAiApi(h);
}

/** True if the host should be intercepted *regardless* of the source process. */
export function isAlwaysInterceptHost(host) {
  if (!host) return false;
  const h = host.toLowerCase().split(':')[0];
  if (ALWAYS_INTERCEPT.has(h)) return true;
  for (const d of ALWAYS_INTERCEPT) {
    if (h.endsWith('.' + d)) return true;
  }
  return false;
}

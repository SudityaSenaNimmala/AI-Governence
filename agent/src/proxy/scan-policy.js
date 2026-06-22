// Proxy-layer scan and block policy.
//
// Two decisions live here:
//
//   1. shouldSkipScan(host, path) — should we scan THIS request at all?
//      The proxy intercepts all whitelisted hosts (from whitelist.js), but
//      a whitelisted host serves many endpoints — telemetry, anti-bot pings,
//      static assets, account state, etc. Scanning those bodies leads to
//      false positives (a Datadog session-duration timestamp passes Luhn
//      ~10% of the time and trips the credit-card pattern). The fix is to
//      skip non-prompt paths entirely: bridge them through with no
//      decryption-side decision. Discovered FP paths get added here.
//
//   2. PROXY_BLOCK_PATTERNS — which classifier matches should result in a
//      451 block at the proxy layer? Some patterns (credit-card, us-ssn,
//      us-phone, jwt) match common ID/auth shapes inside HTTP bodies and
//      false-positive too aggressively for a *network-level* block to be
//      safe. We keep them in the classifier — they still fire at the
//      browser-extension / asar-hook / clipboard layers where the user
//      *typed* the content — but we don't block on them here. Only prefix-
//      anchored patterns (sk-, AKIA, ghp_, etc.) get block decisions at
//      the proxy.

// ---- 1. Path skip rules ----

// Path substrings that mark a request as definitely-not-a-prompt regardless
// of host. Generic, conservative.
const PATH_SUBSTRING_SKIPS = [
  '/telemetry/', '/sentinel/', '/sentinel?',
  '/metrics', '/analytics/',
  '/heartbeat', '/health',
  '/_next/',                 // Next.js static assets
];

// Host-specific skip prefixes. Add entries here as new false positives turn
// up. The match is: request URL's pathname startsWith(prefix) for the given
// host (with subdomain match — `chatgpt.com` covers `*.chatgpt.com`).
const HOST_PATH_SKIPS = {
  'chatgpt.com': [
    '/ces/',                            // DataDog RUM + custom analytics
    '/backend-api/sentinel/',           // anti-bot pings
    '/backend-api/me',                  // user-profile fetch
    '/backend-api/accounts',
    '/backend-api/models',
    '/backend-api/conversations',       // conversation LIST (the prompt itself goes to /conversation/...)
    '/backend-api/health',
    '/backend-api/settings',
    '/assets/',
  ],
  'chat.openai.com': [
    '/ces/',
    '/backend-api/sentinel/',
  ],
  'claude.ai': [
    '/api/account',
    '/api/bootstrap',
    '/api/oauth/',
    '/api/usage',
    '/api/organizations/health',
  ],
};

export function shouldSkipScan(host, path) {
  if (!host || !path) return false;
  const lowerHost = host.toLowerCase();
  const lowerPath = path.toLowerCase();

  for (const sub of PATH_SUBSTRING_SKIPS) {
    if (lowerPath.includes(sub)) return true;
  }
  for (const [h, prefixes] of Object.entries(HOST_PATH_SKIPS)) {
    if (lowerHost === h || lowerHost.endsWith('.' + h)) {
      for (const prefix of prefixes) {
        if (lowerPath.startsWith(prefix)) return true;
      }
    }
  }
  return false;
}

// ---- 2. Which classifier patterns trigger a 451 at the proxy layer ----

// Only prefix-anchored patterns with effectively zero false-positive rate
// inside HTTP traffic. The "loose" patterns (credit-card, us-ssn, jwt,
// us-phone, iban) still fire at the user-input layers (hook, extension,
// clipboard) where context is clearly "user typed/pasted this", but at
// the network layer we'd hit too many false positives in metadata.
export const PROXY_BLOCK_PATTERNS = new Set([
  'openai-api-key',
  'anthropic-api-key',
  'google-api-key',
  'huggingface-token',
  'github-pat',
  'gitlab-pat',
  'aws-access-key',
  'slack-token',
  'cloudfuze-customer-id',
]);

/** Filter a classifier match list to just the patterns we'd block on at the proxy. */
export function blockableMatches(matches) {
  if (!matches) return [];
  return matches.filter((m) => PROXY_BLOCK_PATTERNS.has(m.pattern));
}

// ---- 3. Which connecting processes should we BRIDGE (skip MITM for) ----

// Browsers have their own DLP coverage via the CloudFuze browser extension,
// which works at the DOM level and never causes header-size / cert issues.
// When the proxy intercepts a browser request to chatgpt.com it duplicates
// effort AND tends to trip Cloudflare's strict header limits (the 431
// errors we kept seeing). Safer to bridge browsers entirely and let the
// extension handle them. Source process is identified via the Windows TCP
// table — see process-resolver-win32.js.
const BROWSER_PROCESSES = new Set([
  'chrome.exe',
  'msedge.exe',
  'msedgewebview2.exe',
  'firefox.exe',
  'brave.exe',
  'opera.exe',
  'opera_gx.exe',
  'vivaldi.exe',
  'librewolf.exe',
  'waterfox.exe',
  'arc.exe',
]);

export function isBrowserProcess(processName) {
  if (!processName) return false;
  return BROWSER_PROCESSES.has(processName.toLowerCase());
}

// ---- 4. Known AI desktop apps ----
//
// For "AI web frontend" hosts in the whitelist (chatgpt.com, claude.ai, ...),
// the proxy DEFAULT is to bridge — keeps browsers fast and avoids tripping
// Cloudflare. We only intercept when the source process is one of these
// known AI desktop apps. Same name as the OS-monitor catalog (see
// agent/src/os_monitor/ai-processes.js) so they stay in sync.
const AI_DESKTOP_PROCESSES = new Set([
  'chatgpt',                  // ChatGPT (Store + non-Store, .exe stripped)
  'chatgpt.exe',
  'claude',                   // Claude Desktop
  'claude.exe',
  'cursor',                   // Cursor IDE
  'cursor.exe',
  'copilot',                  // Microsoft Copilot standalone
  'copilot.exe',
  'comet',                    // Perplexity Comet
  'comet.exe',
  'gemini',                   // Google Gemini desktop (if released)
  'gemini.exe',
  'poe',                      // Quora Poe desktop wrapper
  'poe.exe',
  'github copilot',           // GitHub Copilot Chat
  'github copilot.exe',
]);

export function isAiDesktopProcess(processName) {
  if (!processName) return false;
  return AI_DESKTOP_PROCESSES.has(processName.toLowerCase());
}

// Pulls the model-routing policy for the desktop enforcer.
//
//   GET /api/v1/routing/policy   (machine Bearer JWT, If-None-Match -> 304)
//     -> { version, rules, catalog_overrides, settings, fleet_enabled, generated_at }
//   404 -> the server predates the policy endpoint: fall back to the legacy
//          GET /api/v1/routing/rules array (decideRoute accepts either shape).
//   anything else (network error, 401, 5xx, malformed body) -> keep what we had.
//
// NO ?surface= FILTER, deliberately. The server trims ?surface=desktop_app to
// rules scoped to the desktop app, but this enforcer ALSO routes on the web
// (its browser arm: claude.ai / gemini in Chrome/Edge, surface 'browser'), so a
// browser-scoped rule must reach it too. The unfiltered document is the
// superset; the decideRoute port applies each rule's own scope.
//
// The result is cached on disk (model-router-config.js) so a respawned helper
// starts on the last policy even when the server is unreachable.

import { loadCachedRoutingPolicy, saveCachedRoutingPolicy, ROUTING_POLICY_PATH } from './model-router-config.js';

const TIMEOUT_MS = 10_000;

function validPolicyDoc(body) {
  return !!body && typeof body === 'object' && !Array.isArray(body)
    && Array.isArray(body.rules)
    && (body.catalog_overrides === undefined || Array.isArray(body.catalog_overrides))
    && (body.settings === undefined || (body.settings && typeof body.settings === 'object'));
}

/**
 * One poll. Pure apart from fetch: returns what happened and never throws.
 *
 * @returns {Promise<{ status: 'updated'|'unchanged'|'legacy'|'error', policy?, etag?, version?, error? }>}
 */
export async function fetchRoutingPolicy({ serverUrl, token, etag = null, fetchImpl = globalThis.fetch }) {
  const base = String(serverUrl || '').replace(/\/+$/, '');
  if (!base) return { status: 'error', error: 'no server url' };
  try {
    if (token) {
      const headers = { authorization: `Bearer ${token}` };
      if (etag) headers['if-none-match'] = etag;
      const res = await fetchImpl(`${base}/api/v1/routing/policy`, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (res.status === 304) return { status: 'unchanged' };
      if (res.ok) {
        const body = await res.json();
        if (!validPolicyDoc(body)) return { status: 'error', error: 'malformed policy document' };
        const version = body.version ?? null;
        // generated_at changes on every response and is not policy; dropping it
        // keeps the cached document (and its version) stable across polls.
        const { generated_at: _g, ...policy } = body;
        return {
          status: 'updated',
          policy,
          etag: res.headers?.get?.('etag') || (version ? `"${version}"` : null),
          version,
        };
      }
      if (res.status !== 404) return { status: 'error', error: `HTTP ${res.status}` };
    }
    // 404, or no machine token yet: the legacy unauthenticated feed.
    const res = await fetchImpl(`${base}/api/v1/routing/rules`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return { status: 'error', error: `legacy HTTP ${res.status}` };
    const rules = await res.json();
    if (!Array.isArray(rules)) return { status: 'error', error: 'malformed legacy rules' };
    return { status: 'legacy', policy: rules, etag: null, version: `legacy:${JSON.stringify(rules)}` };
  } catch (err) {
    return { status: 'error', error: err?.message || String(err) };
  }
}

/**
 * Poll + cache + deliver. `onPolicy(policy, version)` is called when the
 * policy differs from the last one applied (including the first load from the
 * disk cache, so a helper that started before the first fetch still gets it).
 */
export class RoutingPolicySync {
  constructor({ serverUrl, getToken, log, onPolicy, cachePath = ROUTING_POLICY_PATH, fetchImpl }) {
    this.serverUrl = serverUrl;
    this.getToken = getToken || (() => null);
    this.log = log;
    this.onPolicy = onPolicy;
    this.cachePath = cachePath;
    this.fetchImpl = fetchImpl;
    const cached = loadCachedRoutingPolicy(cachePath);
    this.etag = cached?.etag || null;
    this.version = cached ? (cached.version ?? null) : undefined;
    this.cachedPolicy = cached ? cached.policy : undefined;
  }

  /** Deliver the disk-cached policy, if any, without a fetch. */
  primeFromCache() {
    if (this.cachedPolicy === undefined) return false;
    try { this.onPolicy?.(this.cachedPolicy, this.version ?? JSON.stringify(this.cachedPolicy)); } catch { /* caller's problem */ }
    return true;
  }

  async refresh() {
    const r = await fetchRoutingPolicy({
      serverUrl: this.serverUrl, token: this.getToken(), etag: this.etag, fetchImpl: this.fetchImpl,
    });
    if (r.status === 'unchanged') return r;
    if (r.status === 'error') {
      this.log?.warn?.(`routing-policy: ${r.error} — keeping the current policy`);
      return r;
    }
    if (r.version !== null && r.version === this.version) return { ...r, status: 'unchanged' };
    this.etag = r.etag;
    this.version = r.version;
    this.cachedPolicy = r.policy;
    saveCachedRoutingPolicy({ policy: r.policy, etag: r.etag, version: r.version, at: new Date().toISOString() }, this.cachePath);
    this.log?.info?.(`routing-policy: ${r.status === 'legacy' ? 'legacy rules feed' : `policy ${r.version}`} applied`);
    try { this.onPolicy?.(r.policy, r.version); } catch (err) {
      this.log?.warn?.(`routing-policy: onPolicy failed — ${err?.message || err}`);
    }
    return r;
  }
}

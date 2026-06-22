// AI app registry loader.
//
// Reads ai-apps.json once at startup and builds the lookup tables every other
// module needs:
//
//   - interceptDomains() / alwaysInterceptDomains()  → whitelist.js
//   - webDomains()                                    → browser-extension matching
//   - appForHost(host)                                → cost-parser dispatch + dashboard naming
//   - appForProcess(comm)                             → attribution / process tagging
//   - isPinnedHost(host)                              → forces socket bridge
//   - allApps()                                       → dashboard sidebar listing
//
// Design notes:
//
//   * Reads from disk synchronously at module init. Tiny file, runs once.
//     If you need hot-reload, expose a reload() and call it from a config
//     watcher — not built today.
//   * Domain matching is suffix-based: an entry of "openai.com" matches
//     "api.openai.com" but NOT "fakeopenai.com.evil.com". Belt-and-suspenders
//     check below.
//   * Unknown apps DO NOT go through this module — they're handled by the
//     shape detector in cost-parser.js. This file is for the known list only.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const REGISTRY_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'ai-apps.json',
);

let _registry = null;

function load() {
  if (_registry) return _registry;
  const raw = JSON.parse(readFileSync(REGISTRY_PATH, 'utf8'));
  const apps = Array.isArray(raw.apps) ? raw.apps : [];

  // Build indices.
  const byApiDomain   = new Map();   // domain → app
  const byWebDomain   = new Map();
  const byProcess    = new Map();
  const pinnedDomains = new Set();
  const apiDomainList = [];          // ordered for whitelist export
  const webDomainList = [];

  for (const app of apps) {
    if (!app?.id) continue;
    for (const d of app.apiDomains || []) {
      const k = d.toLowerCase();
      byApiDomain.set(k, app);
      apiDomainList.push(k);
      if (app.pinned) pinnedDomains.add(k);
    }
    for (const d of app.webDomains || []) {
      const k = d.toLowerCase();
      byWebDomain.set(k, app);
      webDomainList.push(k);
      if (app.pinned) pinnedDomains.add(k);
    }
    for (const p of app.processes || []) {
      byProcess.set(p.toLowerCase(), app);
    }
  }

  _registry = {
    apps,
    byApiDomain, byWebDomain, byProcess,
    apiDomainList, webDomainList,
    pinnedDomains,
  };
  return _registry;
}

/** Lookup helper: suffix-match a host against a Map keyed by domain. */
function suffixMatch(host, map) {
  if (!host) return null;
  const h = host.toLowerCase().split(':')[0];
  if (map.has(h)) return map.get(h);
  for (const [d, app] of map) {
    // Require a real dot boundary so "api.openai.com" does NOT match
    // "evilopenai.com".
    if (h.endsWith('.' + d)) return app;
    // Wildcard for AWS bedrock-style host fragments (e.g. *.bedrock-runtime.<region>.amazonaws.com)
    if (d.indexOf('.') < 0 && h.includes('.' + d + '.')) return app;
  }
  return null;
}

/** Domains to MITM (api-side; always intercepted regardless of source process). */
export function alwaysInterceptDomains() {
  return [...load().apiDomainList];
}

/** All domains the proxy may intercept (api + web). */
export function interceptDomains() {
  const r = load();
  return [...new Set([...r.apiDomainList, ...r.webDomainList])];
}

/** Web hosts — intercepted ONLY when the source process is a known AI desktop app. */
export function webDomains() {
  return [...load().webDomainList];
}

/** Known TLS-pinned domains. Force socket bridge. */
export function pinnedDomains() {
  return new Set(load().pinnedDomains);
}

/** Lookup by host. Returns the app record or null. */
export function appForHost(host) {
  const r = load();
  return suffixMatch(host, r.byApiDomain) || suffixMatch(host, r.byWebDomain);
}

/** Lookup by process basename (lowercased, no extension). */
export function appForProcess(comm) {
  if (!comm) return null;
  const c = comm.toLowerCase().replace(/\.exe$/, '');
  return load().byProcess.get(c) || null;
}

/** Full app list. Used by dashboard listing and admin tooling. */
export function allApps() {
  return [...load().apps];
}

/** Lookup by stable id. */
export function appById(id) {
  return load().apps.find((a) => a.id === id) || null;
}

/** Test/dev hook to force reload (e.g. after editing ai-apps.json in dev). */
export function _reload() {
  _registry = null;
  return load();
}

// Generates browser-extension/content/model-routing.js from the CANONICAL shared
// routing sources:
//   shared/decide-route.js     — decideRoute() and its helpers (ES module)
//   shared/model-catalog.json  — the per-provider / per-host / per-app catalog
//
// WHY A GENERATED COPY. Content scripts are classic scripts: they cannot import
// an ES module or a JSON file synchronously, and the extension package cannot
// reach outside browser-extension/. Same reasoning, and same discipline, as
// scripts/gen-proxy-complexity.mjs: one source of truth, a checked-in generated
// artifact, and a test (browser-extension/tests/shared-routing.test.mjs) that
// fails the moment the two drift.
//
// Run after ANY edit to shared/decide-route.js or shared/model-catalog.json:
//   node scripts/gen-shared-routing.mjs
//
// The transformation is mechanical: strip the `export` keyword from top-level
// `export const` / `export function` declarations, inline the catalog as a
// constant, wrap in an IIFE that publishes window.__cfaiRouting.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
export const SRC_DECIDE = path.join(root, 'shared', 'decide-route.js');
export const SRC_CATALOG = path.join(root, 'shared', 'model-catalog.json');
export const OUT = path.join(root, 'browser-extension', 'content', 'model-routing.js');
// The desktop agent's copy of the catalog. An ES module (not JSON) so it loads
// the same way in a dev run, in the esbuild-bundled tracker binary, and in the
// agent zip served by server/src/routes/installations.js (which ships agent/src
// but nothing from shared/). Pinned by agent/tests/routing-decide-lockstep.test.mjs.
export const OUT_AGENT_CATALOG = path.join(root, 'agent', 'src', 'os_monitor', 'model-catalog.generated.js');

/** The agent catalog module text, LF line endings. Pure. */
export function buildAgentCatalogModule() {
  const catalog = JSON.parse(readFileSync(SRC_CATALOG, 'utf8'));
  return `// GENERATED FILE — DO NOT EDIT BY HAND.
//
// Source of truth: shared/model-catalog.json
// Regenerate with: node scripts/gen-shared-routing.mjs
// Pinned by:       agent/tests/routing-decide-lockstep.test.mjs
//
// Shipped to the desktop enforcer inside CFAI_MODEL_ROUTER_CONFIG.catalog, where
// the C# port of shared/decide-route.js reads it.

export const MODEL_CATALOG = ${JSON.stringify(catalog, null, 2)};

export const MODEL_CATALOG_VERSION = MODEL_CATALOG.catalog_version;
`;
}

/** The bundle text, LF line endings. Pure: reads the two sources, writes nothing. */
export function buildBundle() {
  const decide = readFileSync(SRC_DECIDE, 'utf8').replace(/\r\n/g, '\n');
  const catalog = JSON.parse(readFileSync(SRC_CATALOG, 'utf8'));

  // Only the two forms the portability rules in decide-route.js allow.
  const stripped = decide.replace(/^export (const|function) /gm, '$1 ');
  if (/^\s*export\b/m.test(stripped)) {
    throw new Error('gen-shared-routing: decide-route.js has an export form other than '
      + '`export const` / `export function` at top level — update this generator.');
  }
  if (/^\s*import\b/m.test(stripped)) {
    throw new Error('gen-shared-routing: decide-route.js must not import anything (it is bundled into a classic script).');
  }

  const body = stripped.split('\n').map((l) => (l.length ? '  ' + l : l)).join('\n');

  return `// GENERATED FILE — DO NOT EDIT BY HAND.
//
// Sources of truth: shared/decide-route.js + shared/model-catalog.json
// Regenerate with:  node scripts/gen-shared-routing.mjs
// Pinned by:        browser-extension/tests/shared-routing.test.mjs
//
// Classic content script. Publishes window.__cfaiRouting:
//   decideRoute(ctx, policy)             — bound to the bundled catalog
//   resolveSurface(surface, host, policy, provider)
//   detectTierFromLabel(entry, text), labelMatches(text, label)
//   normalizePolicy(policy), normHostOrApp(h), CATALOG, VERSION, CATALOG_VERSION
// PRIVACY: nothing in here sees prompt text.

(function () {
  if (window.__cfaiRoutingLoaded) return;
  window.__cfaiRoutingLoaded = true;

  const CATALOG = ${JSON.stringify(catalog)};

${body.replace(/\s+$/, '')}

  window.__cfaiRouting = {
    VERSION: DECIDE_ROUTE_VERSION,
    CATALOG_VERSION: CATALOG.catalog_version,
    CATALOG: CATALOG,
    decideRoute: function (ctx, policy) { return decideRoute(ctx, policy, CATALOG); },
    resolveSurface: function (surface, hostOrApp, policy, provider) {
      return resolveSurface(CATALOG, surface, hostOrApp, policy, provider);
    },
    detectTierFromLabel: detectTierFromLabel,
    labelMatches: labelMatches,
    normalizePolicy: normalizePolicy,
    normHostOrApp: normHostOrApp,
  };
})();
`;
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  const text = buildBundle();
  writeFileSync(OUT, text, 'utf8');
  writeFileSync(OUT_AGENT_CATALOG, buildAgentCatalogModule(), 'utf8');
  console.log(`generated ${path.relative(root, OUT_AGENT_CATALOG)}`);
  // Verify by USING it, exactly as the extension will: evaluate against a stub window.
  const win = {};
  // eslint-disable-next-line no-new-func
  new Function('window', text)(win);
  const api = win.__cfaiRouting;
  if (!api || typeof api.decideRoute !== 'function') {
    throw new Error('gen-shared-routing: bundle did not publish window.__cfaiRouting.decideRoute');
  }
  const smoke = api.decideRoute({
    surface: 'browser', host_or_app: 'claude.ai', provider: 'anthropic',
    current_tier: 'premium', complexity: 'simple', user_override: false,
    fleet_enabled: true, machine_enabled: true,
  }, null);
  if (smoke.result !== 'routed' || smoke.target_tier !== 'economy') {
    throw new Error('gen-shared-routing: smoke decision wrong: ' + JSON.stringify(smoke));
  }
  console.log(`generated ${path.relative(root, OUT)} (decideRoute v${api.VERSION}, catalog ${api.CATALOG_VERSION})`);
}

/**
 * Feature Flags — server-driven, simple true/false.
 *
 * Fetches GET /api/v1/features on load. The server reads FEAT_* from its .env.
 * All features default to enabled. Set FEAT_<NAME>=false to disable.
 *
 * Dashboard: disabled features show "Feature not available" when clicked.
 * Browser extension: disabled features skip enforcement.
 */

let _features = {};
let _loaded = false;
let _loadPromise = null;

export function loadFeatures() {
  if (_loadPromise) return _loadPromise;
  _loadPromise = fetch('/api/v1/features')
    .then(r => r.json())
    .then(data => {
      _features = data.features || {};
      _loaded = true;
    })
    .catch(() => { _loaded = true; });
  return _loadPromise;
}

loadFeatures();

function feat(key) {
  return _features[key] || { status: 'enabled' };
}

export function isFeatureEnabled(key) {
  return feat(key).status === 'enabled';
}

export function isFeatureLocked(key) {
  return false; // no plan gating
}

export function isFeatureVisible(key) {
  const s = feat(key).status;
  if (s === 'hidden') return false;
  return true;
}

export function getMissingDeps(key) {
  const DEPS = { risk_scores: ['ai_systems'] };
  const deps = DEPS[key];
  if (!deps) return [];
  return deps.filter(d => !isFeatureEnabled(d)).map(d => (feat(d).label || d));
}

export function getFeatureDef(key) {
  return _features[key] || null;
}

export function getAllFlags() {
  const out = {};
  for (const [k, v] of Object.entries(_features)) out[k] = v.status === 'enabled';
  return out;
}

export function areFeaturesLoaded() {
  return _loaded;
}

export const FEATURE_DEFS = new Proxy({}, {
  get(_, key) { return _features[key] || { label: key }; }
});

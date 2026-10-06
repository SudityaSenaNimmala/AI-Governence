// Model routing — rule schema v2, shared by the seeder/migration
// (seed-routing.js) and the routes (routes/routing.js).
//
// WHAT CHANGED FROM v1. A v1 rule named a concrete target: `action.ui_name` (the
// label the extension clicks in a picker) and `action.model` (the API id the
// fetch-rewrite path sends). That baked one vendor lineup into every stored rule,
// so each model launch meant a migration, and routing could only ever move a
// prompt DOWN to a hard-coded cheap model.
//
// A v2 rule names a TIER (economy / standard / premium) plus an optional effort
// level. The client resolves a tier to a concrete picker label / model through
// the shared catalog, and admins can override a label per provider/host via
// `routing_catalog_overrides`. `action.ui_name` / `action.model` survive only as
// explicit per-rule overrides (model is api_proxy-only).
//
//   { id, name, enabled, priority, schema_version: 2, builtin_key?,
//     scope:      { surfaces: ['browser','desktop_app','api_proxy'], hosts?, apps? },
//     conditions: { provider?, complexity?, current_tier?, sensitivity? },
//     action:     { type: 'set_tier'|'cap_tier'|'suggest'|'none',
//                   target_tier?, effort?, model?, ui_name? },
//     mode:       'enforce'|'suggest'|'observe' }
//
// Unknown fields on an incoming rule are PRESERVED, not stripped: the dashboard
// form round-trips whatever it was given, and a v1 condition such as
// `prompt_tokens_gt` that the v2 engines do not evaluate is still the admin's data.

import crypto from 'node:crypto';

export const SCHEMA_VERSION = 2;
export const TIERS = ['economy', 'standard', 'premium'];
export const EFFORTS = ['low', 'medium', 'high'];
export const MODES = ['enforce', 'suggest', 'observe'];
export const ACTION_TYPES = ['set_tier', 'cap_tier', 'suggest', 'none'];
export const RULE_SURFACES = ['browser', 'desktop_app', 'api_proxy'];
export const COMPLEXITIES = ['simple', 'moderate', 'complex'];
export const SENSITIVITIES = ['critical', 'high', 'moderate', 'medium', 'low'];
export const DEFAULT_SETTINGS = Object.freeze({ allow_upgrade: true, respect_user_override: true });

// Which tier each v1 complexity bucket corresponds to — the mapping the
// built-ins have always encoded by name ("Simple prompt → Haiku").
export const COMPLEXITY_TIER = { simple: 'economy', moderate: 'standard', complex: 'premium' };
export const COMPLEXITY_EFFORT = { simple: 'low', moderate: undefined, complex: 'high' };

// The concrete targets the v1 built-ins shipped, per provider × tier. Used for
// two things only: projecting a v2 rule back to v1 for GET /routing/rules
// (clients that predate v2 still click `action.ui_name`), and deciding whether a
// migrated admin label is a real customisation worth a catalog override.
export const LEGACY_TIER_DEFAULTS = {
  anthropic:  { economy: { ui_name: 'Haiku',       model: 'claude-haiku-4-5' },
                standard: { ui_name: 'Sonnet',     model: 'claude-sonnet-5' },
                premium: { ui_name: 'Opus',        model: 'claude-opus-5' } },
  openai:     { economy: { ui_name: 'GPT-4o mini', model: 'gpt-4o-mini' },
                standard: { ui_name: 'GPT-4o',     model: 'gpt-4o' },
                premium: { ui_name: 'GPT-4',       model: 'gpt-4' } },
  google:     { economy: { ui_name: 'Flash',       model: 'gemini-2.5-flash-lite' },
                standard: { ui_name: 'Thinking',   model: 'gemini-3.7-flash' },
                premium: { ui_name: 'Pro',         model: 'gemini-2.5-pro' } },
  mistral:    { economy: { ui_name: 'Small',       model: 'mistral-small-latest' },
                standard: { ui_name: 'Medium',     model: 'mistral-medium-latest' },
                premium: { ui_name: 'Large',       model: 'mistral-large-latest' } },
  perplexity: { economy: { ui_name: 'Sonar',       model: 'sonar' },
                standard: { ui_name: 'Sonar Pro',  model: 'sonar-pro' },
                premium: { ui_name: 'Research',    model: 'sonar-deep-research' } },
};

/**
 * Best-effort tier for a v1 target (model id or picker label). Only used when
 * translating an admin-edited v1 rule; returns null rather than guessing when
 * nothing recognisable is present.
 */
export function inferTier(...names) {
  // Checked in order; the first list with a hit wins. Sonar Pro is called out
  // first because "pro" alone would otherwise read as premium.
  for (const name of names) {
    if (typeof name !== 'string' || !name.trim()) continue;
    const s = name.trim().toLowerCase();
    if (/sonar[- ]pro/.test(s)) return 'standard';
    // Token-anchored: "gemini" contains "mini".
    if (/haiku|(^|[-\s.])(mini|nano|lite|small|instant)\b|3\.5-turbo|^sonar$/.test(s)) return 'economy';
    if (/opus|research|large|ultra|(^|[-\s])pro\b|^o[13]$|^o[13]-|^gpt-4$/.test(s)) return 'premium';
    if (/sonnet|gpt-4o|gpt-4\.1|gpt-5|flash|thinking|medium|turbo|^gpt-4-/.test(s)) return 'standard';
  }
  return null;
}

const arr = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
const isStr = (v) => typeof v === 'string';

/**
 * Translate a v1 rule document into v2. Never mutates the input; keeps every
 * field it does not understand. Pure, so the migration is testable and
 * deterministic (same input → same output → idempotent).
 */
export function translateV1Rule(rule) {
  const v1Action = rule.action && typeof rule.action === 'object' ? rule.action : {};
  const v1Cond = rule.conditions && typeof rule.conditions === 'object' ? rule.conditions : {};

  const conditions = { ...v1Cond };
  const hasRoutingSignal = ['provider', 'complexity', 'current_tier']
    .some((k) => arr(v1Cond[k]).length > 0);
  const sensitivityOnly = arr(v1Cond.sensitivity).length > 0 && !hasRoutingSignal;

  const tier = inferTier(v1Action.ui_name, v1Action.model)
    || (arr(v1Cond.complexity).length === 1 ? COMPLEXITY_TIER[arr(v1Cond.complexity)[0]] : null);

  const action = { ...v1Action, type: 'set_tier' };
  if (tier) action.target_tier = tier;
  // Keep the admin's picker label as an explicit per-rule override; the
  // migration separately records it as a catalog override when it differs
  // from what we shipped (see catalogOverrideFor).
  if (!isStr(action.ui_name) || !action.ui_name.trim()) delete action.ui_name;
  if (!isStr(action.model) || !action.model.trim()) delete action.model;

  return {
    ...rule,
    schema_version: SCHEMA_VERSION,
    // A sensitivity-only rule was a "send sensitive prompts to the private
    // endpoint" rule. Only the proxy can honour that; in a browser picker it
    // would just force an arbitrary model on every sensitive prompt.
    scope: rule.scope && typeof rule.scope === 'object'
      ? rule.scope
      : { surfaces: sensitivityOnly || (!tier && v1Action.endpoint_id) ? ['api_proxy'] : [...RULE_SURFACES] },
    conditions,
    action,
    mode: MODES.includes(rule.mode) ? rule.mode : 'enforce',
    migrated_from_v1: { conditions: v1Cond, action: v1Action },
  };
}

/**
 * The catalog override a migrated v1 rule implies, or null. Only when the rule
 * names exactly one provider and its label is NOT the label we shipped for that
 * provider × tier — re-recording a shipped default would pin a stale label.
 */
export function catalogOverrideFor(v2Rule) {
  const label = v2Rule.action?.ui_name;
  const tier = v2Rule.action?.target_tier;
  const providers = arr(v2Rule.conditions?.provider);
  if (!isStr(label) || !tier || providers.length !== 1) return null;
  const provider = String(providers[0]).toLowerCase();
  if (LEGACY_TIER_DEFAULTS[provider]?.[tier]?.ui_name === label) return null;
  return { provider, host_or_app: '*', tier, label };
}

// ── Input validation for writes ───────────────────────────────────────────────

const LABEL_MAX = 80;
const NAME_MAX = 200;
const MODEL_RE = /^[A-Za-z0-9._:/@-]{1,120}$/;
const PROVIDER_RE = /^[a-z0-9_.-]{1,40}$/;

function cleanStr(v, max) {
  if (!isStr(v)) return null;
  // eslint-disable-next-line no-control-regex
  const s = v.replace(/[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩﻿]/g, '').trim();
  return s && s.length <= max ? s : null;
}

function validateEnumList(list, allowed, field) {
  for (const v of list) if (!allowed.includes(v)) return `${field} contains unknown value: ${v}`;
  return null;
}

/**
 * Normalise a rule write. Accepts v2 bodies, and v1 bodies (action with model /
 * ui_name and no type) from a dashboard or script that predates v2, which are
 * translated rather than refused. `partial` is a PUT: only the provided fields
 * are validated and returned.
 *
 * Returns { value } or { error }.
 */
export function normalizeRuleInput(body, { partial = false } = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'body must be an object' };
  let b = { ...body };
  delete b._id; delete b.id; delete b.builtin_key; delete b.created_at; delete b.updated_at;
  delete b.migrated_from_v1;

  // v1 shape → translate, so an old client cannot store an untyped action.
  if (b.action && typeof b.action === 'object' && !b.action.type
      && (b.action.model || b.action.ui_name || b.action.endpoint_id)) {
    const sent = new Set(Object.keys(b));
    b = translateV1Rule(b);
    delete b.migrated_from_v1;
    // On a partial update, translation must not invent fields the caller did
    // not send — an empty `conditions` or a recomputed `scope` would overwrite
    // the stored ones.
    if (partial) for (const k of Object.keys(b)) if (k !== 'action' && !sent.has(k)) delete b[k];
  }

  const out = {};
  if (!partial || b.name !== undefined) {
    const name = cleanStr(b.name, NAME_MAX);
    if (!name) return { error: 'name is required (max 200 chars)' };
    out.name = name;
  }
  if (b.enabled !== undefined || !partial) out.enabled = b.enabled === undefined ? true : !!b.enabled;
  if (b.priority !== undefined || !partial) {
    const p = Number(b.priority ?? 50);
    out.priority = Number.isFinite(p) ? Math.max(0, Math.min(10000, Math.round(p))) : 50;
  }
  if (b.mode !== undefined || !partial) {
    const mode = b.mode ?? 'enforce';
    if (!MODES.includes(mode)) return { error: `mode must be one of ${MODES.join(', ')}` };
    out.mode = mode;
  }

  if (b.scope !== undefined || !partial) {
    const scope = b.scope && typeof b.scope === 'object' ? { ...b.scope } : {};
    const surfaces = scope.surfaces === undefined ? [...RULE_SURFACES] : arr(scope.surfaces);
    if (!surfaces.length) return { error: 'scope.surfaces must name at least one surface' };
    const e = validateEnumList(surfaces, RULE_SURFACES, 'scope.surfaces');
    if (e) return { error: e };
    scope.surfaces = surfaces;
    for (const k of ['hosts', 'apps']) {
      if (scope[k] === undefined) continue;
      const list = arr(scope[k]).map((x) => cleanStr(x, 200));
      if (list.some((x) => !x)) return { error: `scope.${k} must be a list of short strings` };
      scope[k] = list;
    }
    out.scope = scope;
  }

  if (b.conditions !== undefined || !partial) {
    if (b.conditions != null && (typeof b.conditions !== 'object' || Array.isArray(b.conditions))) {
      return { error: 'conditions must be an object' };
    }
    const c = { ...(b.conditions || {}) };
    const checks = [
      ['complexity', COMPLEXITIES], ['current_tier', TIERS], ['sensitivity', SENSITIVITIES],
    ];
    for (const [k, allowed] of checks) {
      if (c[k] === undefined) continue;
      c[k] = arr(c[k]);
      const e = validateEnumList(c[k], allowed, `conditions.${k}`);
      if (e) return { error: e };
    }
    if (c.provider !== undefined) {
      c.provider = arr(c.provider).map((p) => String(p).toLowerCase());
      if (c.provider.some((p) => !PROVIDER_RE.test(p))) return { error: 'conditions.provider has an invalid provider id' };
    }
    out.conditions = c;
  }

  if (b.action !== undefined || !partial) {
    if (!b.action || typeof b.action !== 'object' || Array.isArray(b.action)) return { error: 'action is required' };
    const act = { ...b.action };
    if (!ACTION_TYPES.includes(act.type)) return { error: `action.type must be one of ${ACTION_TYPES.join(', ')}` };
    if (act.target_tier !== undefined && act.target_tier !== null && !TIERS.includes(act.target_tier)) {
      return { error: `action.target_tier must be one of ${TIERS.join(', ')}` };
    }
    if (act.effort !== undefined && act.effort !== null && !EFFORTS.includes(act.effort)) {
      return { error: `action.effort must be one of ${EFFORTS.join(', ')}` };
    }
    if ((act.type === 'set_tier' || act.type === 'cap_tier' || act.type === 'suggest')
        && !act.target_tier && !act.model && !act.endpoint_id) {
      return { error: `action.type ${act.type} needs a target_tier (or a model for api_proxy)` };
    }
    if (act.model !== undefined && act.model !== null && act.model !== '') {
      if (!isStr(act.model) || !MODEL_RE.test(act.model)) return { error: 'action.model is not a valid model id' };
    } else delete act.model;
    if (act.ui_name !== undefined && act.ui_name !== null && act.ui_name !== '') {
      const l = cleanStr(act.ui_name, LABEL_MAX);
      if (!l) return { error: 'action.ui_name must be a short label' };
      act.ui_name = l;
    } else delete act.ui_name;
    if (act.target_tier == null) delete act.target_tier;
    if (act.effort == null) delete act.effort;
    out.action = act;
  }

  out.schema_version = SCHEMA_VERSION;
  return { value: out };
}

export function normalizeCatalogOverride(body) {
  const provider = cleanStr(body?.provider, 40)?.toLowerCase();
  if (!provider || !PROVIDER_RE.test(provider)) return { error: 'provider is required' };
  const host = body?.host_or_app == null || body.host_or_app === '' ? '*' : cleanStr(body.host_or_app, 200);
  if (!host) return { error: 'host_or_app must be a short string or "*"' };
  if (!TIERS.includes(body?.tier)) return { error: `tier must be one of ${TIERS.join(', ')}` };
  const label = cleanStr(body?.label, LABEL_MAX);
  if (!label) return { error: 'label is required (max 80 chars)' };
  return { value: { provider, host_or_app: host.toLowerCase(), tier: body.tier, label } };
}

export function normalizeSettings(body, current = DEFAULT_SETTINGS) {
  const out = { ...DEFAULT_SETTINGS, ...current };
  for (const k of Object.keys(DEFAULT_SETTINGS)) {
    if (body?.[k] === undefined) continue;
    if (typeof body[k] !== 'boolean') return { error: `${k} must be boolean` };
    out[k] = body[k];
  }
  return { value: out };
}

/**
 * v2 rule → the v1 shape older clients act on. ADDITIVE: every v2 field is kept,
 * and `action.ui_name` / `action.model` are filled from the catalog override or
 * the shipped default when the rule does not set them. A rule a v1 client could
 * only misapply (suggest/observe mode, a non-routing action, or a rule that
 * excludes both client surfaces) is reported disabled to it.
 */
export function toLegacyView(rule, overrides = []) {
  if (!rule || rule.schema_version !== SCHEMA_VERSION) return rule;
  const action = { ...(rule.action || {}) };
  const tier = action.target_tier;
  const providers = arr(rule.conditions?.provider);
  if (tier && providers.length === 1) {
    const p = String(providers[0]).toLowerCase();
    const ov = overrides.find((o) => o.provider === p && o.tier === tier && o.host_or_app === '*');
    const def = LEGACY_TIER_DEFAULTS[p]?.[tier];
    if (!action.ui_name && (ov?.label || def?.ui_name)) action.ui_name = ov?.label || def.ui_name;
    if (!action.model && def?.model) action.model = def.model;
  }
  const surfaces = arr(rule.scope?.surfaces);
  const actionable = (rule.mode ?? 'enforce') === 'enforce'
    && (action.type === 'set_tier' || action.type === 'cap_tier')
    && (action.ui_name || action.model || action.endpoint_id);
  const reachable = surfaces.length === 0 || surfaces.some((s) => RULE_SURFACES.includes(s));
  return { ...rule, action, enabled: !!rule.enabled && !!actionable && reachable };
}

/** Stable content hash for the policy document — what clients compare on. */
export function policyVersion(payload) {
  return crypto.createHash('sha256').update(stableStringify(payload)).digest('hex').slice(0, 16);
}

function stableStringify(v) {
  if (v instanceof Date) return JSON.stringify(v.toISOString());
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  if (v && typeof v === 'object') {
    return '{' + Object.keys(v).sort().filter((k) => v[k] !== undefined)
      .map((k) => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
  }
  return JSON.stringify(v ?? null);
}

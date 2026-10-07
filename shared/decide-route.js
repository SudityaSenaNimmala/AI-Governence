// Model-routing decision function — the ONE definition of "which tier should this
// prompt go to", shared by every routing engine.
//
// CANONICAL SOURCE. Consumers:
//   * browser extension — browser-extension/content/model-routing.js, GENERATED
//     from this file + shared/model-catalog.json by `node scripts/gen-shared-routing.mjs`
//     (content scripts are classic scripts and cannot import an ES module);
//   * desktop enforcer (C#, agent/src/os_monitor) — a hand PORT of this file. It
//     must pass every case in shared/routing-decision-vectors.json, which is the
//     executable form of this contract. Do not change behaviour here without
//     updating the vectors, and expect the port to fail until it follows.
//   * Node (tests, server, agent) — `import { decideRoute } from 'shared/decide-route.js'`.
//
// PORTABILITY RULES for this file, because it is ported, not just imported:
//   * pure: no I/O, no clock, no randomness, no globals, no imports;
//   * plain data in and out (JSON-shaped), no classes, no RegExp in the contract;
//   * every `export` is a top-level `export function` / `export const` — the
//     generator strips the keyword to build the classic-script bundle.
//
// PRIVACY: nothing here sees prompt text. Callers classify first (complexity.js)
// and pass the verdict.
//
// Spec: docs/MODEL_ROUTING_COMPLEXITY.md section 7.

export const DECIDE_ROUTE_VERSION = '1.0.0';

export const TIERS = ['economy', 'standard', 'premium'];
export const EFFORTS = ['low', 'medium', 'high'];
export const MODES = ['enforce', 'suggest', 'observe'];
export const SURFACES = ['browser', 'desktop_app', 'api_proxy'];

// The built-in table, used when no rule matches. Routing goes BOTH ways: an easy
// prompt moves down to economy, a demanding one moves UP to premium.
export const COMPLEXITY_TIER = { simple: 'economy', moderate: 'standard', complex: 'premium' };
// Effort follows the same signal where a surface exposes it. Moderate leaves the
// user's effort alone (null = "do not touch").
export const COMPLEXITY_EFFORT = { simple: 'low', moderate: null, complex: 'high' };

const TIER_RANK = { economy: 1, standard: 2, premium: 3 };
const RANK_TIER = { 1: 'economy', 2: 'standard', 3: 'premium' };

function lower(v) {
  return typeof v === 'string' ? v.trim().toLowerCase() : '';
}

function asList(v) {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

/** A tier name, or null. Accepts the numeric form (1/2/3) older callers use. */
export function normTier(t) {
  if (typeof t === 'number') return RANK_TIER[t] || null;
  const s = lower(t);
  return TIER_RANK[s] ? s : null;
}

function normEffort(e) {
  const s = lower(e);
  return EFFORTS.indexOf(s) >= 0 ? s : null;
}

/** 'desktop' is accepted as an alias of 'desktop_app'. Unknown -> ''. */
export function normSurface(s) {
  const v = lower(s);
  if (v === 'desktop') return 'desktop_app';
  return SURFACES.indexOf(v) >= 0 ? v : '';
}

/** Lower-cased host with any leading "www." removed; app keys pass through lower-cased. */
export function normHostOrApp(h) {
  const v = lower(h);
  return v.indexOf('www.') === 0 ? v.slice(4) : v;
}

function isWordChar(ch) {
  return (ch >= '0' && ch <= '9') || (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z');
}

/**
 * Does `label` occur in `text` as a whole model identifier?
 *
 * Case-insensitive. The character BEFORE the occurrence must not be a letter or
 * digit, and the character AFTER must not be a letter, digit, '.' or '-' — the
 * characters that extend a model id ('Flash' -> 'Flash-Lite', 'GPT-4' -> 'GPT-4o',
 * 'Sonnet 5' -> 'Sonnet 5.5'). Every occurrence is tried, not just the first.
 * Same rule as agent/src/os_monitor/ai-processes.js modelItemNameMatches /
 * resolveButtonTier, extended with the leading boundary.
 */
export function labelMatches(text, label) {
  const t = String(text === undefined || text === null ? '' : text);
  const l = String(label === undefined || label === null ? '' : label);
  if (!l.length || t.length < l.length) return false;
  const tl = t.toLowerCase();
  const ll = l.toLowerCase();
  let from = 0;
  for (;;) {
    const at = tl.indexOf(ll, from);
    if (at < 0) return false;
    const before = at > 0 ? t.charAt(at - 1) : '';
    const after = at + l.length < t.length ? t.charAt(at + l.length) : '';
    const okBefore = before === '' || !isWordChar(before);
    const okAfter = after === '' || !(isWordChar(after) || after === '.' || after === '-');
    if (okBefore && okAfter) return true;
    from = at + 1;
  }
}

function copyTierEntry(e) {
  const src = e || {};
  return {
    click_labels: asList(src.click_labels).slice(),
    button_label_patterns: asList(src.button_label_patterns).slice(),
    verified: src.verified === true,
  };
}

function prependUnique(list, value) {
  const out = [value];
  for (const v of list) if (lower(v) !== lower(value)) out.push(v);
  return out;
}

/**
 * Normalise policy.catalog_overrides to a list of
 * { provider, host_or_app, tier, label } — the server's
 * routing_catalog_overrides row shape. host_or_app '*' = every surface of
 * that provider. Malformed rows are dropped.
 */
function overrideList(policy) {
  const raw = policy && policy.catalog_overrides;
  const out = [];
  for (const o of asList(raw)) {
    if (!o || typeof o !== 'object') continue;
    const provider = lower(o.provider);
    const tier = normTier(o.tier);
    const label = typeof o.label === 'string' ? o.label.trim() : '';
    if (!provider || !tier || !label) continue;
    const hoa = o.host_or_app === undefined || o.host_or_app === null || o.host_or_app === '' ? '*' : normHostOrApp(o.host_or_app);
    out.push({ provider: provider, host_or_app: hoa, tier: tier, label: label });
  }
  return out;
}

function hostMatchesKey(host, key) {
  return host === key || (host.length > key.length && host.slice(host.length - key.length - 1) === '.' + key);
}

/**
 * The catalog entry for a surface, with catalog overrides applied, or null.
 *
 * browser    -> catalog.hosts, longest key the host equals or is a subdomain of
 *               ('alias_of' followed once);
 * desktop_app-> catalog.apps, exact key;
 * api_proxy  -> no picker; a synthetic entry carrying just the provider.
 *
 * An override naming a host_or_app the catalog does not know (with a provider)
 * SYNTHESISES an entry, so an admin can add a host without a release.
 *
 * Returns { key, kind, provider, verified, effort, tiers: {tier: {click_labels,
 * button_label_patterns, verified}} }.
 */
export function resolveSurface(catalog, surface, hostOrApp, policy, providerHint) {
  const cat = catalog || {};
  const s = normSurface(surface);
  const hoa = normHostOrApp(hostOrApp);
  const overrides = overrideList(policy);
  let key = '';
  let kind = '';
  let base = null;

  if (s === 'browser') {
    const hosts = cat.hosts || {};
    let bestLen = 0;
    for (const k of Object.keys(hosts)) {
      const kk = lower(k);
      if (hostMatchesKey(hoa, kk) && kk.length > bestLen) { key = kk; bestLen = kk.length; }
    }
    if (key) {
      kind = 'host';
      base = hosts[key] || hosts[Object.keys(hosts).filter((k) => lower(k) === key)[0]];
      if (base && base.alias_of) {
        base = hosts[base.alias_of] || null;
      }
    }
  } else if (s === 'desktop_app') {
    const apps = cat.apps || {};
    for (const k of Object.keys(apps)) {
      if (lower(k) === hoa) { key = lower(k); kind = 'app'; base = apps[k]; break; }
    }
  } else if (s === 'api_proxy') {
    const p = lower(providerHint);
    if (!p) return null;
    return { key: hoa || '*', kind: 'api', provider: p, verified: false, effort: { supported: false }, tiers: {} };
  } else {
    return null;
  }

  const entry = {
    key: key || hoa,
    kind: kind || (s === 'browser' ? 'host' : 'app'),
    provider: base ? lower(base.provider) : '',
    verified: !!(base && base.verified === true),
    effort: base && base.effort ? base.effort : { supported: false },
    tiers: {},
  };
  if (base && base.tiers) {
    for (const t of TIERS) if (base.tiers[t]) entry.tiers[t] = copyTierEntry(base.tiers[t]);
  }

  // Overrides: wildcard first, then the exact surface, so the specific one wins.
  const exact = [];
  const wild = [];
  for (const o of overrides) {
    if (o.host_or_app === '*') wild.push(o);
    else if (o.host_or_app === hoa || (key && o.host_or_app === key)) exact.push(o);
  }
  if (!base) {
    if (!exact.length) return null;
    entry.provider = exact[0].provider;
  }
  for (const o of wild.concat(exact)) {
    if (o.provider !== entry.provider) continue;
    const te = entry.tiers[o.tier] || copyTierEntry(null);
    te.click_labels = [o.label];
    te.button_label_patterns = prependUnique(te.button_label_patterns, o.label);
    entry.tiers[o.tier] = te;
  }
  return entry;
}

/**
 * Which tier a picker's button text is showing, from the entry's
 * button_label_patterns (plus click_labels). Longest pattern across ALL tiers is
 * tried first, so 'Flash-Lite' is never read as 'Flash'. Null when nothing matches.
 */
export function detectTierFromLabel(entry, text) {
  if (!entry || !entry.tiers) return null;
  const cands = [];
  for (const t of TIERS) {
    const te = entry.tiers[t];
    if (!te) continue;
    for (const p of asList(te.button_label_patterns).concat(asList(te.click_labels))) {
      if (typeof p === 'string' && p.length) cands.push({ tier: t, p: p });
    }
  }
  cands.sort((a, b) => b.p.length - a.p.length);
  for (const c of cands) if (labelMatches(text, c.p)) return c.tier;
  return null;
}

/** The tier whose api_ids list contains `model`, for one provider. */
function tierFromApiId(catalog, provider, model) {
  const m = lower(model);
  const p = catalog && catalog.providers && catalog.providers[provider];
  if (!m || !p || !p.tiers) return null;
  for (const t of TIERS) {
    const ids = asList(p.tiers[t] && p.tiers[t].api_ids);
    for (const id of ids) if (lower(id) === m) return t;
  }
  return null;
}

function providerTierEffortSupported(catalog, provider, tier) {
  const p = catalog && catalog.providers && catalog.providers[provider];
  return !!(p && p.tiers && p.tiers[tier] && p.tiers[tier].effort_supported === true);
}

function firstApiId(catalog, provider, tier) {
  const p = catalog && catalog.providers && catalog.providers[provider];
  const ids = asList(p && p.tiers && p.tiers[tier] && p.tiers[tier].api_ids);
  return ids.length ? ids[0] : null;
}

/**
 * Normalise either policy shape:
 *   v2 — GET /api/v1/routing/policy: { version, rules, catalog_overrides,
 *        settings: { allow_upgrade, respect_user_override }, fleet_enabled }
 *   v1 — GET /api/v1/routing/rules: a bare array of rules.
 * null/undefined -> no rules, default settings (built-in table only).
 */
export function normalizePolicy(policy) {
  const isArr = Array.isArray(policy);
  const p = isArr ? { rules: policy } : (policy && typeof policy === 'object' ? policy : {});
  const settings = p.settings && typeof p.settings === 'object' ? p.settings : {};
  return {
    version: isArr ? 1 : (p.version === undefined ? null : p.version),
    rules: asList(p.rules).filter((r) => r && typeof r === 'object'),
    catalog_overrides: asList(p.catalog_overrides),
    settings: {
      allow_upgrade: settings.allow_upgrade !== false,
      // OPT-IN since 2026-10-07 (was opt-out). A manual model switch no longer
      // stands routing down for the conversation: the user's pick becomes the
      // current model and the next prompt is routed from it. Only an explicit
      // `true` restores the old behaviour.
      respect_user_override: settings.respect_user_override === true,
    },
    fleet_enabled: p.fleet_enabled !== false,
  };
}

/** A rule is v2 when its action carries a `type`; anything else is legacy v1. */
export function isV2Rule(rule) {
  return !!(rule && rule.action && typeof rule.action === 'object' && typeof rule.action.type === 'string');
}

function listIncludes(list, value) {
  const v = lower(value);
  for (const x of list) if (lower(x) === v) return true;
  return false;
}

function scopeTargetMatches(target, hoa) {
  const t = normHostOrApp(target);
  if (!t) return false;
  if (t === '*') return true;
  return hoa === t || hostMatchesKey(hoa, t);
}

/**
 * Does `rule` apply to this request? Conditions absent or empty mean "any".
 *
 * SENSITIVITY: a rule carrying a non-empty `conditions.sensitivity` only ever
 * matches on surface 'api_proxy'. On browser/desktop the rule is SKIPPED (not
 * applied with the condition ignored): those rules exist to send sensitive
 * traffic to a private endpoint, which only the proxy can do — applying one in a
 * picker would just force a model on every prompt.
 */
export function ruleMatches(rule, ctx) {
  if (!rule || rule.enabled === false) return false;
  const surface = normSurface(ctx.surface);
  const hoa = normHostOrApp(ctx.host_or_app);
  const c = rule.conditions && typeof rule.conditions === 'object' ? rule.conditions : {};

  const sens = asList(c.sensitivity);
  if (sens.length) {
    if (surface !== 'api_proxy') return false;
    if (!listIncludes(sens, ctx.sensitivity)) return false;
  }
  const prov = asList(c.provider);
  if (prov.length && !listIncludes(prov, ctx.provider)) return false;
  const cx = asList(c.complexity);
  if (cx.length && !listIncludes(cx, ctx.complexity)) return false;

  if (isV2Rule(rule)) {
    const ct = asList(c.current_tier);
    if (ct.length && !listIncludes(ct, ctx.current_tier)) return false;
    const scope = rule.scope && typeof rule.scope === 'object' ? rule.scope : {};
    const surfaces = asList(scope.surfaces).map(normSurface);
    if (surfaces.length && surfaces.indexOf(surface) < 0) return false;
    const targets = asList(scope.hosts).concat(asList(scope.apps));
    if (targets.length) {
      let any = false;
      for (const t of targets) if (scopeTargetMatches(t, hoa)) { any = true; break; }
      if (!any) return false;
    }
  } else {
    // v1: `conditions.host` was a substring test in the old extension.
    const hosts = asList(c.host);
    if (hosts.length) {
      let any = false;
      for (const h of hosts) if (lower(h) && hoa.indexOf(lower(h)) >= 0) { any = true; break; }
      if (!any) return false;
    }
  }
  return true;
}

/** Enabled rules by ascending priority (default 50), ties in document order. */
export function orderedRules(rules) {
  const indexed = [];
  asList(rules).forEach((r, i) => {
    if (r && typeof r === 'object' && r.enabled !== false) indexed.push({ r: r, i: i });
  });
  indexed.sort((a, b) => {
    const pa = typeof a.r.priority === 'number' ? a.r.priority : 50;
    const pb = typeof b.r.priority === 'number' ? b.r.priority : 50;
    return pa !== pb ? pa - pb : a.i - b.i;
  });
  return indexed.map((x) => x.r);
}

function ruleId(rule) {
  if (!rule) return null;
  const id = rule.id !== undefined && rule.id !== null ? rule.id : rule._id;
  return id === undefined || id === null ? null : String(id);
}

function result(fields) {
  return {
    target_tier: fields.target_tier === undefined ? null : fields.target_tier,
    effort: fields.effort === undefined ? null : fields.effort,
    rule_id: fields.rule_id === undefined ? null : fields.rule_id,
    rule_name: fields.rule_name === undefined ? null : fields.rule_name,
    mode: fields.mode === undefined ? null : fields.mode,
    result: fields.result,
    reason: fields.reason,
    from_tier: fields.from_tier === undefined ? null : fields.from_tier,
    to_label: fields.to_label === undefined ? null : fields.to_label,
    click_labels: fields.click_labels || [],
    model: fields.model === undefined ? null : fields.model,
  };
}

/**
 * Decide where one prompt should go.
 *
 * @param ctx {
 *   surface:        'browser' | 'desktop_app' (alias 'desktop') | 'api_proxy',
 *   host_or_app:    hostname (browser) or catalog app key (desktop_app),
 *   provider:       'anthropic' | 'openai' | 'google' | 'perplexity' | 'mistral' | null
 *                   (null -> taken from the catalog entry),
 *   current_tier:   tier the picker shows NOW, or null when it could not be read,
 *   user_tier?:     tier the USER last chose themselves (the ceiling used only when
 *                   allow_upgrade is false); defaults to current_tier,
 *   current_effort?:'low' | 'medium' | 'high' | null — effort the picker shows now,
 *   user_override:  true when the user switched the model back after we routed,
 *   complexity:     'simple' | 'moderate' | 'complex' | 'unknown',
 *   sensitivity?:   only read on api_proxy,
 *   fleet_enabled:  false -> disabled (also read from policy.fleet_enabled),
 *   machine_enabled:false -> disabled,
 * }
 * @param policy   v2 policy object, v1 rules array, or null (see normalizePolicy)
 * @param catalog  parsed shared/model-catalog.json
 * @returns {
 *   target_tier, effort, rule_id, rule_name, mode, result, reason,
 *   from_tier, to_label, click_labels, model
 * }
 *   result: 'routed' | 'suggested' | 'observed' | 'noop' | 'unsupported' |
 *           'disabled' | 'user_override'
 *
 * ORDER (fixed; the vectors pin it):
 *   1. disabled  — policy/ctx fleet_enabled false, or machine_enabled false.
 *   2. override  — ctx.user_override && settings.respect_user_override
 *                  (opt-in: missing / anything but true = routing continues).
 *   3. surface   — unknown surface / provider mismatch / unreadable current tier
 *                  -> 'unsupported'.
 *   4. rule      — first matching enabled rule by priority; else the built-in
 *                  complexity table.
 *   5. cap       — only when allow_upgrade is false: never above user_tier.
 *   6. effort    — dropped (null) where the surface or target tier has no effort control.
 *   7. noop      — target == current and no effort change to make.
 *   8. label     — catalog (+overrides) click_labels; a v2 rule ui_name is tried
 *                  first, a v1 ui_name the catalog recognises goes after the
 *                  catalog labels (an unrecognised v1 label first); none for a
 *                  tier change -> 'unsupported'. Not needed on api_proxy.
 *   9. mode      — enforce -> 'routed', suggest -> 'suggested', observe -> 'observed'.
 */
export function decideRoute(ctx, policy, catalog) {
  const c = ctx && typeof ctx === 'object' ? ctx : {};
  const pol = normalizePolicy(policy);
  const surface = normSurface(c.surface);
  const fromTier = normTier(c.current_tier);

  // 1. disabled
  if (!pol.fleet_enabled || c.fleet_enabled === false) {
    return result({ result: 'disabled', reason: 'fleet_disabled', from_tier: fromTier });
  }
  if (c.machine_enabled === false) {
    return result({ result: 'disabled', reason: 'machine_disabled', from_tier: fromTier });
  }

  // 2. the user put it back after we routed — leave this conversation alone
  if (c.user_override === true && pol.settings.respect_user_override) {
    return result({ result: 'user_override', reason: 'user_override', from_tier: fromTier });
  }

  // 3. surface
  if (!surface) return result({ result: 'unsupported', reason: 'unknown_surface', from_tier: fromTier });
  const entry = resolveSurface(catalog, surface, c.host_or_app, pol, c.provider);
  if (!entry) return result({ result: 'unsupported', reason: 'unknown_surface', from_tier: fromTier });
  const ctxProvider = lower(c.provider);
  if (ctxProvider && entry.provider && ctxProvider !== entry.provider) {
    return result({ result: 'unsupported', reason: 'provider_mismatch', from_tier: fromTier });
  }
  const provider = entry.provider || ctxProvider;
  if (!fromTier) return result({ result: 'unsupported', reason: 'current_tier_unknown' });

  const complexity = lower(c.complexity);
  const builtinTier = COMPLEXITY_TIER[complexity] || null;
  const builtinEffort = Object.prototype.hasOwnProperty.call(COMPLEXITY_EFFORT, complexity)
    ? COMPLEXITY_EFFORT[complexity] : null;
  const matchCtx = {
    surface: surface,
    host_or_app: c.host_or_app,
    provider: provider,
    complexity: complexity,
    current_tier: fromTier,
    sensitivity: c.sensitivity,
  };

  // 4. first matching rule, else built-in
  let rule = null;
  for (const r of orderedRules(pol.rules)) {
    if (ruleMatches(r, matchCtx)) { rule = r; break; }
  }

  let target = builtinTier;
  let effort = builtinEffort;
  let mode = 'enforce';
  let ruleLabel = null;
  // v2 ui_name is an explicit per-rule override and is clicked FIRST. A v1
  // ui_name that the catalog recognises as a tier label is a seeded default from
  // an older lineup ('Thinking', 'GPT-4o mini'), so the catalog's current labels
  // are tried before it; an unrecognised (custom) v1 label still goes first.
  let ruleLabelFirst = true;
  let model = null;

  if (rule) {
    const a = rule.action && typeof rule.action === 'object' ? rule.action : {};
    ruleLabel = typeof a.ui_name === 'string' && a.ui_name.trim() ? a.ui_name.trim() : null;
    model = typeof a.model === 'string' && a.model.trim() ? a.model.trim() : null;
    if (isV2Rule(rule)) {
      mode = MODES.indexOf(rule.mode) >= 0 ? rule.mode : 'enforce';
      const type = a.type;
      const actTier = normTier(a.target_tier);
      if (type === 'none') {
        return result({
          result: 'noop', reason: 'rule_action_none', rule_id: ruleId(rule), rule_name: rule.name || null,
          mode: mode, from_tier: fromTier,
        });
      }
      if (type === 'cap_tier') {
        target = builtinTier && actTier
          ? (TIER_RANK[builtinTier] <= TIER_RANK[actTier] ? builtinTier : actTier)
          : builtinTier;
      } else {
        // set_tier / suggest / unknown type: the named tier, else the label's tier, else built-in
        target = actTier
          || (ruleLabel ? detectTierFromLabel(entry, ruleLabel) : null)
          || (model ? tierFromApiId(catalog, provider, model) : null)
          || builtinTier;
        if (type === 'suggest' && mode === 'enforce') mode = 'suggest';
      }
      if (a.effort !== undefined) effort = normEffort(a.effort);
    } else {
      // v1: the rule names a label (and/or model id); its tier is read back off the catalog.
      const labelTier = ruleLabel ? detectTierFromLabel(entry, ruleLabel) : null;
      if (labelTier) ruleLabelFirst = false;
      target = labelTier
        || (model ? tierFromApiId(catalog, provider, model) : null)
        || builtinTier;
    }
  }

  const rid = ruleId(rule);
  const rname = rule ? (rule.name || null) : null;

  if (!target) {
    return result({
      result: 'noop', reason: 'unknown_complexity', rule_id: rid, rule_name: rname, mode: mode, from_tier: fromTier,
    });
  }

  // 5. cap — only when upgrades are switched off
  let capped = false;
  if (!pol.settings.allow_upgrade) {
    const ceiling = normTier(c.user_tier) || fromTier;
    if (TIER_RANK[target] > TIER_RANK[ceiling]) { target = ceiling; capped = true; }
  }

  // 6. effort only where it can actually be set
  const effortCtl = entry.effort && entry.effort.supported === true;
  const effortOk = surface === 'api_proxy'
    ? providerTierEffortSupported(catalog, provider, target)
    : (effortCtl && providerTierEffortSupported(catalog, provider, target));
  if (!effortOk) effort = null;
  const currentEffort = normEffort(c.current_effort);

  // 7. nothing to change
  const tierChange = target !== fromTier;
  const effortChange = !!effort && !!currentEffort && effort !== currentEffort;
  if (!tierChange && !effortChange) {
    return result({
      target_tier: target, result: 'noop', reason: capped ? 'upgrade_not_allowed' : 'already_on_target',
      rule_id: rid, rule_name: rname, mode: mode, from_tier: fromTier,
    });
  }

  // 8. label
  let clickLabels = [];
  if (surface !== 'api_proxy') {
    const te = entry.tiers[target];
    const catLabels = asList(te && te.click_labels);
    if (!ruleLabel) clickLabels = catLabels.slice();
    else if (ruleLabelFirst) clickLabels = prependUnique(catLabels, ruleLabel);
    else clickLabels = listIncludes(catLabels, ruleLabel) ? catLabels.slice() : catLabels.concat([ruleLabel]);
    if (tierChange && !clickLabels.length) {
      return result({
        target_tier: target, result: 'unsupported', reason: 'no_label_for_tier',
        rule_id: rid, rule_name: rname, mode: mode, from_tier: fromTier,
      });
    }
  }
  if (!model) model = firstApiId(catalog, provider, target);

  // 9. mode
  const res = mode === 'suggest' ? 'suggested' : (mode === 'observe' ? 'observed' : 'routed');
  const reason = !tierChange ? 'effort_only'
    : (TIER_RANK[target] > TIER_RANK[fromTier] ? 'upgrade' : 'downgrade');
  return result({
    target_tier: target,
    effort: effort,
    rule_id: rid,
    rule_name: rname,
    mode: mode,
    result: res,
    reason: reason,
    from_tier: fromTier,
    to_label: clickLabels.length ? clickLabels[0] : null,
    click_labels: clickLabels,
    model: model,
  });
}

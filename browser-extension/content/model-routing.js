// GENERATED FILE — DO NOT EDIT BY HAND.
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

  const CATALOG = {"schema_version":1,"catalog_version":"2026-10-05","_doc":"Canonical model-routing catalog. Edited HERE only; browser-extension/content/model-routing.js is generated from it by `node scripts/gen-shared-routing.mjs`. Consumed by shared/decide-route.js (and its C# port in the desktop enforcer). Spec: docs/MODEL_ROUTING_COMPLEXITY.md section 7. `verified: true` only where live evidence is recorded in code (see each `evidence`). Label matching rule: a label/pattern matches text case-insensitively at a token boundary - the char before it must not be [0-9A-Za-z] and the char after it must not be [0-9A-Za-z.-]; longest pattern wins.","tiers":["economy","standard","premium"],"efforts":["low","medium","high"],"providers":{"anthropic":{"tiers":{"premium":{"api_ids":["claude-opus-5","claude-opus-4-8","claude-opus-4-7","claude-opus-4-6"],"effort_supported":true},"standard":{"api_ids":["claude-sonnet-5","claude-sonnet-4-6"],"effort_supported":true},"economy":{"api_ids":["claude-haiku-4-5"],"effort_supported":false}}},"openai":{"tiers":{"premium":{"api_ids":["gpt-5.6-sol","gpt-5.5"],"effort_supported":true},"standard":{"api_ids":["gpt-5.6-terra","gpt-5.4"],"effort_supported":true},"economy":{"api_ids":["gpt-5.6-luna","gpt-5.4-mini"],"effort_supported":false}}},"google":{"tiers":{"premium":{"api_ids":["gemini-3.1-pro"],"effort_supported":false},"standard":{"api_ids":["gemini-3.7-flash"],"effort_supported":false},"economy":{"api_ids":["gemini-3.5-flash-lite"],"effort_supported":false}}},"perplexity":{"tiers":{"premium":{"api_ids":["sonar-deep-research"],"effort_supported":false},"standard":{"api_ids":["sonar-pro"],"effort_supported":false},"economy":{"api_ids":["sonar"],"effort_supported":false}}},"mistral":{"tiers":{"premium":{"api_ids":["mistral-large-latest"],"effort_supported":false},"standard":{"api_ids":["mistral-medium-latest"],"effort_supported":false},"economy":{"api_ids":["mistral-small-latest"],"effort_supported":false}}}},"hosts":{"claude.ai":{"provider":"anthropic","verified":true,"evidence":"agent/src/os_monitor/ai-processes.js claude_web modelPicker, live UIA pass 2026-09-22: button 'Model: Opus 5 High'; items 'Opus 5 For complex tasks', 'Sonnet 5 Most efficient for everyday tasks', 'Haiku 4.5 Fastest for quick answers', 'Effort High', 'More models'. 2026-10-05 (Desktop, same UI): labels are now 'Opus 5.5' / 'Sonnet 5.5' (button 'Opus 5.5 Medium'); 'Opus 5' / 'Sonnet 5' and the family names stay as fallbacks.","picker":{"name_prefix":"Model:","item_control_types":["RadioButton","MenuItem"],"item_selected_prefix":""},"effort":{"supported":true,"verified":false,"evidence":"Effort is READ live (button trailing token High/Medium/Low, ai-processes.js MODEL_EFFORT_TOKENS). SETTING it via the 'Effort' submenu has not had a live pass.","menu_item_prefix":"Effort","levels":{"low":"Low","medium":"Medium","high":"High"}},"confirm_dialog":{"verified":false,"evidence":"Same dialog as apps.claude_desktop (Claude Desktop renders claude.ai). Live 2026-10-05 on Desktop: Claude showed its own modal titled \"Switch model?\" (\"...This task is cached for the current model...\") with buttons \"Cancel\" and \"Switch to Sonnet 5.5\" (focused). The route stalled with focus in the dialog. New conversations show no dialog. Auto-confirm (content.js confirmModelSwitch) not yet live-verified on claude.ai.","title_contains":"Switch model","button_name_prefix":"Switch to ","cancel_button_name":"Cancel"},"tiers":{"premium":{"click_labels":["Opus 5.5","Opus 5","Opus"],"button_label_patterns":["Opus","Fable","Mythos"],"verified":true},"standard":{"click_labels":["Sonnet 5.5","Sonnet 5","Sonnet"],"button_label_patterns":["Sonnet"],"verified":true},"economy":{"click_labels":["Haiku 4.5","Haiku"],"button_label_patterns":["Haiku"],"verified":true}}},"chatgpt.com":{"provider":"openai","verified":false,"evidence":"No live picker pass: the measured account has no model picker at all (ai-processes.js chatgpt_web carries no modelPicker). Labels follow the GPT-5.6 Sol/Terra/Luna lineup (agent/src/desktop_injector/hook-renderer.js MODEL_DISPLAY, agent/src/server-monitor/pricing.js). Legacy GPT-4 / GPT-4o / GPT-4o mini kept as READ patterns only.","tiers":{"premium":{"click_labels":["GPT-5.6 Sol","Sol"],"button_label_patterns":["Sol","GPT-5.6 Sol","GPT-4","o3","o1"],"verified":false},"standard":{"click_labels":["GPT-5.6 Terra","Terra"],"button_label_patterns":["Terra","GPT-5.6 Terra","GPT-4o","GPT-4.1"],"verified":false},"economy":{"click_labels":["GPT-5.6 Luna","Luna"],"button_label_patterns":["Luna","GPT-5.6 Luna","GPT-4o mini","o4-mini","GPT-5 mini"],"verified":false}}},"chat.openai.com":{"alias_of":"chatgpt.com"},"gemini.google.com":{"provider":"google","verified":true,"evidence":"agent/src/os_monitor/ai-processes.js gemini_web modelPicker, live pass 2026-09-22: button 'Open mode picker, currently Pro'; items '3.5 Flash-Lite Fastest answers', '3.8 Flash All-around help New', 'Selected 3.1 Pro Advanced reasoning', 'Extended thinking Complex problem solving'. 'Extended thinking' is an effort-like axis, never a tier.","picker":{"name_prefix":"Open mode picker,","item_control_types":["MenuItem"],"item_selected_prefix":"Selected "},"effort":{"supported":false,"verified":false},"tiers":{"premium":{"click_labels":["3.1 Pro","Pro"],"button_label_patterns":["Pro","3.1 Pro","Ultra"],"verified":true},"standard":{"click_labels":["3.8 Flash"],"button_label_patterns":["Flash","3.8 Flash","Thinking"],"verified":true},"economy":{"click_labels":["3.5 Flash-Lite","Flash-Lite"],"button_label_patterns":["Flash-Lite","Flash Lite","3.5 Flash-Lite"],"verified":true}}},"aistudio.google.com":{"provider":"google","verified":false,"evidence":"No live pass. Same lineup as gemini.google.com assumed.","effort":{"supported":false,"verified":false},"tiers":{"premium":{"click_labels":["3.1 Pro","Pro"],"button_label_patterns":["Pro","Ultra"],"verified":false},"standard":{"click_labels":["3.8 Flash"],"button_label_patterns":["Flash"],"verified":false},"economy":{"click_labels":["3.5 Flash-Lite","Flash-Lite"],"button_label_patterns":["Flash-Lite","Flash Lite"],"verified":false}}},"perplexity.ai":{"provider":"perplexity","verified":false,"evidence":"No live pass. Labels carried over from content.js PLATFORM_TIERS.","tiers":{"premium":{"click_labels":["Research"],"button_label_patterns":["Research"],"verified":false},"standard":{"click_labels":["Sonar Pro"],"button_label_patterns":["Sonar Pro"],"verified":false},"economy":{"click_labels":["Sonar"],"button_label_patterns":["Sonar"],"verified":false}}},"chat.mistral.ai":{"provider":"mistral","verified":false,"evidence":"No live pass. Labels carried over from content.js PLATFORM_TIERS.","tiers":{"premium":{"click_labels":["Large"],"button_label_patterns":["Large"],"verified":false},"standard":{"click_labels":["Medium"],"button_label_patterns":["Medium"],"verified":false},"economy":{"click_labels":["Small"],"button_label_patterns":["Small"],"verified":false}}}},"apps":{"claude_desktop":{"provider":"anthropic","verified":true,"evidence":"Live button text 'Model: Sonnet 5 Medium' against Claude Desktop (agent/tests/model-router-config.test.mjs); picker defaults MODEL_PICKER_NAME_PREFIX_DEFAULT / MODEL_PICKER_ITEM_CONTROL_TYPES_DEFAULT in ai-processes.js. Live 2026-10-05: button 'Opus 5.5 Medium', target 'Sonnet 5.5'; 'Opus 5' / 'Sonnet 5' and the family names stay as fallbacks.","picker":{"name_prefix":"Model:","item_control_types":["RadioButton","MenuItem"],"item_selected_prefix":""},"effort":{"supported":true,"verified":false,"evidence":"Effort token read off the button; setting it has not had a live pass.","menu_item_prefix":"Effort","levels":{"low":"Low","medium":"Medium","high":"High"}},"confirm_dialog":{"verified":false,"evidence":"Live 2026-10-05, Claude Desktop, existing conversation on Opus 5.5 Medium, picker switched to Sonnet: Claude showed its own modal titled \"Switch model?\" (\"...This task is cached for the current model...\") with buttons \"Cancel\" and \"Switch to Sonnet 5.5\" (focused). The route stalled with focus in the dialog. New conversations show no dialog. Auto-confirm (enforcer-win.ps1 RouteAwaitSwitch) not yet live-verified.","title_contains":"Switch model","button_name_prefix":"Switch to ","cancel_button_name":"Cancel"},"tiers":{"premium":{"click_labels":["Opus 5.5","Opus 5","Opus"],"button_label_patterns":["Opus","Fable","Mythos"],"verified":true},"standard":{"click_labels":["Sonnet 5.5","Sonnet 5","Sonnet"],"button_label_patterns":["Sonnet"],"verified":true},"economy":{"click_labels":["Haiku 4.5","Haiku"],"button_label_patterns":["Haiku"],"verified":true}}},"chatgpt_desktop":{"provider":"openai","verified":false,"evidence":"No live pass. Labels from agent/src/desktop_injector/hook-renderer.js MODEL_DISPLAY.","tiers":{"premium":{"click_labels":["GPT-5.6 Sol","Sol"],"button_label_patterns":["Sol","GPT-4","o3","o1"],"verified":false},"standard":{"click_labels":["GPT-5.6 Terra","Terra"],"button_label_patterns":["Terra","GPT-4o","GPT-4.1"],"verified":false},"economy":{"click_labels":["GPT-5.6 Luna","Luna"],"button_label_patterns":["Luna","GPT-4o mini","o4-mini","GPT-5 mini"],"verified":false}}}}};

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

  const DECIDE_ROUTE_VERSION = '1.0.0';

  const TIERS = ['economy', 'standard', 'premium'];
  const EFFORTS = ['low', 'medium', 'high'];
  const MODES = ['enforce', 'suggest', 'observe'];
  const SURFACES = ['browser', 'desktop_app', 'api_proxy'];

  // The built-in table, used when no rule matches. Routing goes BOTH ways: an easy
  // prompt moves down to economy, a demanding one moves UP to premium.
  const COMPLEXITY_TIER = { simple: 'economy', moderate: 'standard', complex: 'premium' };
  // Effort follows the same signal where a surface exposes it. Moderate leaves the
  // user's effort alone (null = "do not touch").
  const COMPLEXITY_EFFORT = { simple: 'low', moderate: null, complex: 'high' };

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
  function normTier(t) {
    if (typeof t === 'number') return RANK_TIER[t] || null;
    const s = lower(t);
    return TIER_RANK[s] ? s : null;
  }

  function normEffort(e) {
    const s = lower(e);
    return EFFORTS.indexOf(s) >= 0 ? s : null;
  }

  /** 'desktop' is accepted as an alias of 'desktop_app'. Unknown -> ''. */
  function normSurface(s) {
    const v = lower(s);
    if (v === 'desktop') return 'desktop_app';
    return SURFACES.indexOf(v) >= 0 ? v : '';
  }

  /** Lower-cased host with any leading "www." removed; app keys pass through lower-cased. */
  function normHostOrApp(h) {
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
  function labelMatches(text, label) {
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
  function resolveSurface(catalog, surface, hostOrApp, policy, providerHint) {
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
  function detectTierFromLabel(entry, text) {
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
  function normalizePolicy(policy) {
    const isArr = Array.isArray(policy);
    const p = isArr ? { rules: policy } : (policy && typeof policy === 'object' ? policy : {});
    const settings = p.settings && typeof p.settings === 'object' ? p.settings : {};
    return {
      version: isArr ? 1 : (p.version === undefined ? null : p.version),
      rules: asList(p.rules).filter((r) => r && typeof r === 'object'),
      catalog_overrides: asList(p.catalog_overrides),
      settings: {
        allow_upgrade: settings.allow_upgrade !== false,
        respect_user_override: settings.respect_user_override !== false,
      },
      fleet_enabled: p.fleet_enabled !== false,
    };
  }

  /** A rule is v2 when its action carries a `type`; anything else is legacy v1. */
  function isV2Rule(rule) {
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
  function ruleMatches(rule, ctx) {
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
  function orderedRules(rules) {
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
   *   2. override  — ctx.user_override && settings.respect_user_override.
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
  function decideRoute(ctx, policy, catalog) {
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

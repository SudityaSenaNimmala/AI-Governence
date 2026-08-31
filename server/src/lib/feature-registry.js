// The catalogue behind GET/PUT /api/v1/features — the switches that turn parts of
// this product on and off across the dashboard, the browser extension and the
// desktop agent at once.
//
// THIS REPLACES AN INLINE MAP IN index.js, and the keys are unchanged on purpose:
// connect-ui/src/featureFlags.js and the extension's content scripts already read
// them (`ai_systems`, `dlp`, `access_requests`, `model_routing`), so renaming any
// of them would silently un-gate live enforcement. The response shape
// ({ features: { key: { label, status } } }) is likewise preserved.
//
// WHAT IS NEW HERE is `surfaces` — which of dashboard / extension / agent actually
// reads each flag. Before, the labels carried that as prose ("(extension)"), which
// no code could check. Now the settings page can say where a switch reaches, a
// surface can ask for only its own flags, and a test can assert that every flag
// aimed at a surface is one that surface knows about — so a switch cannot quietly
// become decorative.

export const SURFACES = ['dashboard', 'extension', 'agent'];

/**
 * `default` is `true` for everything, and that is a safety property rather than a
 * convenience: this is a governance product, so the state a surface falls back to
 * when it cannot reach the server must be "governed". A default of `false`
 * anywhere would mean a machine that loses connectivity quietly stops enforcing.
 */
const F = (key, label, surfaces, group) => ({ key, label, surfaces, group, default: true });

export const FEATURE_GROUPS = {
  ENFORCE: 'Enforcement & capture',
  ENDPOINT: 'Desktop agent',
  DASHBOARD: 'Dashboard sections',
};

export const FEATURE_REGISTRY = [
  // ── Things that change what is enforced on a real machine ─────────────────
  F('dlp', 'DLP — scanning + guardrails', ['dashboard', 'extension', 'agent'], FEATURE_GROUPS.ENFORCE),
  F('ai_systems', 'AI Systems — registry + platform blocking', ['dashboard', 'extension'], FEATURE_GROUPS.ENFORCE),
  F('access_requests', 'Access Requests — the request-access gate', ['dashboard', 'extension'], FEATURE_GROUPS.ENFORCE),
  F('model_routing', 'Model Routing — routing enforcement', ['dashboard', 'extension'], FEATURE_GROUPS.ENFORCE),
  F('session_replay', 'Session Replay — recording', ['dashboard', 'extension'], FEATURE_GROUPS.ENFORCE),

  // ── Desktop agent ─────────────────────────────────────────────────────────
  F('clipboard_monitor', 'Clipboard Monitor — prompt monitoring', ['dashboard', 'agent'], FEATURE_GROUPS.ENDPOINT),
  F('endpoint_scan', 'Endpoint Scan — AI tool discovery', ['dashboard', 'agent'], FEATURE_GROUPS.ENDPOINT),
  F('agents_mcp', 'Agents & MCP — MCP/agent discovery', ['dashboard', 'agent'], FEATURE_GROUPS.ENDPOINT),
  // NEW KEY. The keystroke send-blocker was the one control with a settings
  // mechanism of its own — an Electron checkbox passed to the monitor as
  // CFAI_ENFORCER_ENABLED (agent/src/os_monitor/settings-env.js). That made it
  // per-machine and invisible: a user could switch off blocking locally and the
  // dashboard would still show it running. It belongs here with the rest.
  F('agent_enforcer', 'Keystroke send-blocker — blocking inside sealed desktop apps', ['dashboard', 'agent'], FEATURE_GROUPS.ENDPOINT),

  // ── Dashboard sections. Cosmetic by comparison: hiding a tab changes what an
  //    admin sees, never what a machine enforces. Grouped apart so the settings
  //    page does not present the two kinds of switch as equivalent.
  F('overview', 'Overview', ['dashboard'], FEATURE_GROUPS.DASHBOARD),
  F('claude_usage', 'Claude Usage', ['dashboard'], FEATURE_GROUPS.DASHBOARD),
  F('policies', 'Policies', ['dashboard'], FEATURE_GROUPS.DASHBOARD),
  F('risk_scores', 'Risk Scores', ['dashboard'], FEATURE_GROUPS.DASHBOARD),
  F('agent_governance', 'Agent Governance', ['dashboard'], FEATURE_GROUPS.DASHBOARD),
  F('installations', 'Installations', ['dashboard'], FEATURE_GROUPS.DASHBOARD),
  F('integrations', 'Integrations', ['dashboard'], FEATURE_GROUPS.DASHBOARD),
  F('server_monitor', 'Server Monitor', ['dashboard'], FEATURE_GROUPS.DASHBOARD),
  F('sdk', 'Developer SDK', ['dashboard'], FEATURE_GROUPS.DASHBOARD),
];

export const FEATURE_KEYS = FEATURE_REGISTRY.map((f) => f.key);

const BY_KEY = new Map(FEATURE_REGISTRY.map((f) => [f.key, f]));

export const getFeature = (key) => BY_KEY.get(key) || null;
export const isKnownFeature = (key) => BY_KEY.has(key);

/** The keys one surface consumes — what /api/v1/features?surface=agent returns. */
export const keysForSurface = (surface) =>
  FEATURE_REGISTRY.filter((f) => f.surfaces.includes(surface)).map((f) => f.key);

/**
 * The env-var floor, preserved exactly as it behaved before this was DB-backed:
 * FEAT_<KEY>=false (or 0) disables. Anything else, including unset, enables.
 *
 * KEPT AS THE FLOOR RATHER THAN DELETED because a deployment may already rely on
 * it, and because it is the only way to force a feature off on a server whose
 * database is unreachable. The stored override sits ON TOP of it — see
 * effectiveFeatures().
 */
export function envDefault(key, env = process.env) {
  const v = env['FEAT_' + key.toUpperCase()];
  return v !== 'false' && v !== '0';
}

/**
 * Which features a deployed compliance pack depends on, and therefore locks on.
 *
 * WHY LOCKING EXISTS. Policy packs already carry per-rule enable/disable
 * (PATCH /api/policy-packs/:id/rules/:ruleKey). Two independent switches over one
 * behaviour is how a fleet reaches a state neither page describes: an admin turns
 * DLP off here, the SOC 2 pack still reports its DLP rules as deployed and
 * satisfied, and the control is silently not running. So a deployed pack wins, and
 * the settings page renders the toggle locked and names the pack rather than
 * accepting a change it will not honour.
 *
 * DERIVED, NOT DECLARED. Making every pack rule list its features would mean
 * editing all of them and would rot the moment someone adds a rule. A deployed
 * `dlp` rule inherently needs the pattern engine running and acting on what it
 * finds — that is what a DLP control IS — so the dependency is read off the
 * enforcement kind. `requiresFeatures` remains for a rule that is not derivable.
 */
const DLP_RULE_REQUIRES = ['dlp'];

export function lockedFeatures(deployedPacks) {
  const locks = new Map();   // featureKey → ["framework:ruleKey", …]
  const add = (key, by) => {
    if (!BY_KEY.has(key)) return;          // a stale reference must not invent a lock
    if (!locks.has(key)) locks.set(key, []);
    if (!locks.get(key).includes(by)) locks.get(key).push(by);
  };

  for (const { pack, ruleStates } of deployedPacks || []) {
    for (const rule of pack?.rules || []) {
      // A rule the admin disabled requires nothing — turning a pack rule off is
      // how they say they are not relying on that control.
      if (ruleStates?.[rule.key]?.enabled === false) continue;
      const by = `${pack.framework}:${rule.key}`;
      if (rule.enforcement === 'dlp') for (const k of DLP_RULE_REQUIRES) add(k, by);
      for (const k of rule.requiresFeatures || []) add(k, by);
    }
  }
  return locks;
}

/**
 * Resolve the effective state. Precedence, lowest to highest:
 *
 *   registry default  →  FEAT_* env var  →  stored admin override  →  pack lock
 *
 * LOCKS ARE LAST AND WIN. A deployed pack's requirement is not a preference to be
 * merged with the admin's; it is the thing that outranks it. If an override could
 * win, the settings page and the compliance report would each be telling the truth
 * about a different system.
 */
export function effectiveFeatures({ overrides = {}, locks = new Map(), env = process.env } = {}) {
  const out = {};
  for (const f of FEATURE_REGISTRY) {
    const lockedBy = locks.get(f.key) || null;
    const stored = Object.prototype.hasOwnProperty.call(overrides, f.key)
      ? overrides[f.key] === true
      : envDefault(f.key, env);

    out[f.key] = {
      label: f.label,
      // Preserved wire shape: existing consumers read `.status === 'enabled'`.
      status: (lockedBy ? true : stored) ? 'enabled' : 'disabled',
      surfaces: f.surfaces,
      group: f.group,
      ...(lockedBy ? { locked_by: lockedBy } : {}),
      // Lets the UI say "you turned this off, but a pack requires it" rather than
      // showing a toggle that silently disagrees with the click that set it.
      ...(lockedBy && stored === false ? { override_suppressed: true } : {}),
    };
  }
  return out;
}

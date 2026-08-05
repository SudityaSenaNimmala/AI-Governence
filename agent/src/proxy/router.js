// Intelligent Model Routing engine for the HTTPS proxy.
//
// Fetches routing rules from the governance server, caches them in memory,
// and evaluates routing decisions locally for <5ms latency. Decisions are
// reported asynchronously via the DLP reporter (no per-request server call).
//
// Usage:
//   const router = new ModelRouter({ serverUrl, token, log });
//   await router.start();   // initial fetch + periodic refresh
//   const decision = router.decide({ host, model, text, sensitivity });
//   // decision: { routed: true, model, host, rule_name, rule_id } or { routed: false }

const REFRESH_INTERVAL_MS = 60_000;

// Known model families per provider — used to validate same-provider swaps.
const PROVIDER_MODELS = {
  openai: [
    'gpt-4', 'gpt-4-turbo', 'gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4.1-mini', 'gpt-4.1-nano',
    'gpt-3.5-turbo', 'o1', 'o1-mini', 'o1-pro', 'o3', 'o3-mini', 'o4-mini',
  ],
  anthropic: [
    'claude-opus-4', 'claude-sonnet-4', 'claude-haiku-4',
    'claude-3-5-sonnet', 'claude-3-5-haiku', 'claude-3-opus', 'claude-3-sonnet', 'claude-3-haiku',
  ],
  google: [
    'gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-2.0-pro',
    'gemini-1.5-pro', 'gemini-1.5-flash', 'gemini-1.0-pro',
  ],
};

export class ModelRouter {
  constructor({ serverUrl, token, log }) {
    this._serverUrl = serverUrl?.replace(/\/+$/, '');
    this._token = token;
    this._log = log;
    this._rules = [];
    this._endpoints = [];
    this._timer = null;
    this._ready = false;
  }

  async start() {
    if (!this._serverUrl) {
      this._log?.warn?.('router: no server URL — routing disabled');
      return;
    }
    await this._refresh();
    this._timer = setInterval(() => this._refresh(), REFRESH_INTERVAL_MS);
  }

  stop() {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
  }

  get ready() { return this._ready; }
  get ruleCount() { return this._rules.filter(r => r.enabled).length; }

  // ── Core routing decision — called synchronously per request (<1ms) ──

  decide({ host, model, text, sensitivity }) {
    if (!this._ready || this._rules.length === 0) return { routed: false };

    const promptTokens = estimateTokens(text);
    const complexity = classifyComplexity(text, promptTokens);
    const ctx = { host, model, sensitivity, complexity, prompt_tokens: promptTokens };

    for (const rule of this._rules) {
      if (!rule.enabled) continue;
      if (matchesConditions(rule.conditions, ctx)) {
        const action = resolveAction(rule.action, this._endpoints, model);
        if (action) {
          return {
            routed: true,
            model: action.model,
            host: action.host,
            rule_id: rule.id,
            rule_name: rule.name,
            original_model: model,
            original_host: host,
            sensitivity,
            complexity,
            prompt_tokens_est: promptTokens,
          };
        }
      }
    }
    return { routed: false };
  }

  // ── Periodic rule refresh ─────────────────────────────────────────────

  async _refresh() {
    try {
      const headers = {};
      if (this._token) headers.authorization = `Bearer ${this._token}`;

      const [rulesRes, epRes] = await Promise.all([
        fetch(`${this._serverUrl}/api/v1/routing/rules`, { headers }),
        fetch(`${this._serverUrl}/api/v1/routing/endpoints`, { headers }),
      ]);
      if (rulesRes.ok) {
        this._rules = await rulesRes.json();
        // Ensure sorted by priority (server already does this, but be safe)
        this._rules.sort((a, b) => (a.priority || 50) - (b.priority || 50));
      }
      if (epRes.ok) {
        this._endpoints = (await epRes.json()).filter(e => e.enabled);
      }
      this._ready = true;
      this._log?.info?.(`router: refreshed ${this._rules.length} rules, ${this._endpoints.length} endpoints`);
    } catch (e) {
      // Non-fatal — keep using stale rules if we have them
      this._log?.warn?.(`router: refresh failed: ${e?.message || e}`);
      if (this._rules.length > 0) this._ready = true;
    }
  }
}

// ── Complexity Classification ─────────────────────────────────────────

const COMPLEX_SIGNALS = /\b(architect|design|implement|refactor|optimize|compare|evaluate|explain in detail|step.by.step|comprehensive|thorough|deep.dive|trade.?offs?|pros?.and?.cons|debug|investigate|root.cause|security.review|performance|scale|migration)\b/i;
const SIMPLE_SIGNALS  = /\b(commit.message|changelog|fix.typo|rename|format|lint|summarize|translate|convert|hello|hi|hey|thanks|thank.you|yes|no|ok|okay)\b/i;

function classifyComplexity(text, tokenEstimate) {
  if (!text) return 'unknown';
  if (tokenEstimate < 100) return 'simple';
  if (tokenEstimate > 3000) return 'complex';

  // Check content signals (sample first 2000 chars for speed)
  const sample = text.length > 2000 ? text.slice(0, 2000) : text;
  if (COMPLEX_SIGNALS.test(sample)) return 'complex';
  if (SIMPLE_SIGNALS.test(sample)) return 'simple';

  // Code-heavy prompts are usually moderate+
  const codeBlockCount = (sample.match(/```/g) || []).length / 2;
  if (codeBlockCount >= 2) return 'complex';
  if (codeBlockCount >= 1) return 'moderate';

  return 'moderate';
}

function estimateTokens(text) {
  if (!text) return 0;
  // Rough approximation: ~4 chars per token for English, ~3 for code
  return Math.ceil(text.length / 4);
}

// ── Rule Matching (same logic as server, duplicated for locality) ──────

function matchesConditions(conditions, ctx) {
  if (conditions.sensitivity) {
    const targets = Array.isArray(conditions.sensitivity) ? conditions.sensitivity : [conditions.sensitivity];
    if (!ctx.sensitivity || !targets.includes(ctx.sensitivity)) return false;
  }
  if (conditions.complexity) {
    const targets = Array.isArray(conditions.complexity) ? conditions.complexity : [conditions.complexity];
    if (!ctx.complexity || !targets.includes(ctx.complexity)) return false;
  }
  if (conditions.provider) {
    const targets = Array.isArray(conditions.provider) ? conditions.provider : [conditions.provider];
    const hostProvider = providerFromHost(ctx.host);
    if (!targets.includes(hostProvider)) return false;
  }
  if (conditions.model) {
    const targets = Array.isArray(conditions.model) ? conditions.model : [conditions.model];
    const modelLower = (ctx.model || '').toLowerCase();
    if (!targets.some(t => modelLower.includes(t.toLowerCase()))) return false;
  }
  if (conditions.prompt_tokens_gt != null) {
    if ((ctx.prompt_tokens || 0) <= conditions.prompt_tokens_gt) return false;
  }
  if (conditions.prompt_tokens_lt != null) {
    if ((ctx.prompt_tokens || Infinity) >= conditions.prompt_tokens_lt) return false;
  }
  return true;
}

function providerFromHost(host) {
  if (!host) return 'unknown';
  const h = host.toLowerCase();
  if (h.includes('openai'))      return 'openai';
  if (h.includes('anthropic'))   return 'anthropic';
  if (h.includes('googleapis') || h.includes('google')) return 'google';
  if (h.includes('copilot') || h.includes('microsoft')) return 'microsoft';
  if (h.includes('perplexity'))  return 'perplexity';
  if (h.includes('huggingface')) return 'huggingface';
  return 'unknown';
}

function resolveAction(action, endpoints, originalModel) {
  if (action.model) {
    return { model: action.model, host: action.host || null };
  }
  if (action.endpoint_id) {
    const ep = endpoints.find(e => e.id === action.endpoint_id);
    if (ep && ep.enabled) {
      return { model: ep.models?.[0] || originalModel, host: ep.host || null };
    }
  }
  return null;
}

export { classifyComplexity, estimateTokens, providerFromHost, PROVIDER_MODELS };

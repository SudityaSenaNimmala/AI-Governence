import { a } from '../util.js';

// Prompt-type events captured by the OS monitor + browser extension.
const PROMPT_KINDS = ['prompt_paste', 'prompt_submit', 'prompt_typed'];

// ── Estimation knobs (rough — this is captured prompt volume, not billed usage) ──
const CHARS_PER_TOKEN = 4;        // ~4 chars/token for English text
const OUTPUT_RATIO = 3;           // assume the model reply is ~3x the prompt
const DEFAULT_PROMPT_TOKENS = 150; // fallback when an event has no captured length

// input / output USD per 1,000,000 tokens, chosen per platform by keyword.
// Representative published rates; tune here as pricing changes.
const RATE_TABLE = [
  { match: /anthropic|claude/,           in: 3.0,  out: 15.0 },
  { match: /openai|chatgpt|gpt/,         in: 2.5,  out: 10.0 },
  { match: /copilot|microsoft|m365/,     in: 2.5,  out: 10.0 },
  { match: /gemini|google|bard/,         in: 1.25, out: 5.0 },
  { match: /cursor/,                     in: 3.0,  out: 15.0 },
  { match: /perplexity/,                 in: 1.0,  out: 1.0 },
  { match: /lovable|replit|v0/,          in: 3.0,  out: 15.0 },
];
const DEFAULT_RATE = { in: 3.0, out: 15.0 };

function rateFor(...names) {
  const s = names.filter(Boolean).join(' ').toLowerCase();
  for (const r of RATE_TABLE) if (r.match.test(s)) return r;
  return DEFAULT_RATE;
}

// Turn a prompt count + captured character total into estimated tokens & cost.
function estimate(prompts, totalChars, rate) {
  const inputTokens = totalChars > 0
    ? Math.round(totalChars / CHARS_PER_TOKEN)
    : Math.round(prompts * DEFAULT_PROMPT_TOKENS);
  const outputTokens = Math.round(inputTokens * OUTPUT_RATIO);
  const est_total_tokens = inputTokens + outputTokens;
  const est_cost_usd = (inputTokens / 1e6) * rate.in + (outputTokens / 1e6) * rate.out;
  return { est_input_tokens: inputTokens, est_output_tokens: outputTokens, est_total_tokens, est_cost_usd };
}

export function mountAiUsage(app, db) {
  // Per-platform prompt usage, each with a per-user (machine) breakdown.
  app.get('/api/v1/ai-usage', a(async (req, res) => {
    // Pull just the prompt events (small — aggregate in JS to stay portable
    // across the sqlite/postgres/mongo abstraction).
    const events = await db.collection('dlp_events')
      .find({ event_kind: { $in: PROMPT_KINDS } })
      .project({ _id: 0, ai_service: 1, machine_id: 1, content_length: 1 })
      .toArray();

    // machine_id -> { hostname, user } for human-readable rows.
    const machines = await db.collection('machines')
      .find({})
      .project({ _id: 0, id: 1, hostname: 1, user: 1 })
      .toArray();
    const machineMap = new Map(machines.map((m) => [m.id, m]));

    // Exclude debug/test enrollments (e.g. "debug-browser") from usage so they
    // don't show up as a platform user. Events stay in the DB; they're just
    // filtered out of this report.
    const EXCLUDE_RE = /debug/i;
    const excludedMachineIds = new Set(
      machines
        .filter((m) => EXCLUDE_RE.test(m.hostname || '') || EXCLUDE_RE.test(m.user || ''))
        .map((m) => m.id),
    );

    // Platform registry -> resolve product/vendor labels from the raw service/host.
    const platforms = await db.collection('ai_platforms')
      .find({})
      .project({ _id: 0, host: 1, vendor: 1, product: 1 })
      .toArray();
    const platformMap = new Map();
    for (const p of platforms) if (p.host) platformMap.set(p.host.toLowerCase(), p);
    function resolvePlatform(service) {
      const s = String(service || '').toLowerCase();
      if (platformMap.has(s)) return platformMap.get(s);
      for (const [host, p] of platformMap) if (s === host || s.endsWith('.' + host)) return p;
      return null;
    }

    // Fold events -> service -> machine.
    const byService = new Map();
    for (const e of events) {
      const machineId = e.machine_id || 'unknown';
      if (excludedMachineIds.has(machineId)) continue;   // skip debug/test machines
      const service = e.ai_service || 'unknown';
      const chars = Number(e.content_length) || 0;
      if (!byService.has(service)) byService.set(service, { machines: new Map() });
      const svc = byService.get(service);
      if (!svc.machines.has(machineId)) svc.machines.set(machineId, { prompts: 0, chars: 0 });
      const m = svc.machines.get(machineId);
      m.prompts += 1;
      m.chars += chars;
    }

    // Build the response with estimates.
    const platformsOut = [];
    const totals = { prompts: 0, est_total_tokens: 0, est_cost_usd: 0 };
    for (const [service, svc] of byService) {
      const plat = resolvePlatform(service);
      const rate = rateFor(service, plat?.product, plat?.vendor);

      // Group by real user identity, merging every machine that shares it.
      // A "real" user is machines.user (the OS username, or the browser
      // profile email the extension now sends). Machines without one — e.g.
      // browser installs that enrolled before identity capture — fall back to
      // the hostname and collapse into a single "unattributed" row instead of
      // many identical "Mozilla-browser-extension" rows.
      const GENERIC_USER = /-browser-extension$/i;
      let svcPrompts = 0, svcChars = 0;
      const identities = new Map();
      for (const [machineId, m] of svc.machines) {
        svcPrompts += m.prompts;
        svcChars += m.chars;
        const meta = machineMap.get(machineId) || {};
        const realUser = meta.user && !GENERIC_USER.test(meta.user) ? meta.user : null;
        const key = realUser || meta.hostname || machineId;
        if (!identities.has(key)) {
          identities.set(key, {
            label: realUser || meta.hostname || String(machineId).slice(0, 12),
            user: realUser,
            hostname: meta.hostname || null,
            attributed: !!realUser,
            machines: 0,
            prompts: 0,
            chars: 0,
          });
        }
        const idn = identities.get(key);
        idn.machines += 1;
        idn.prompts += m.prompts;
        idn.chars += m.chars;
        if (realUser) idn.attributed = true;
      }
      const breakdown = [...identities.values()]
        .map((idn) => ({
          label: idn.label,
          user: idn.user,
          hostname: idn.hostname,
          attributed: idn.attributed,
          machines: idn.machines,
          prompts: idn.prompts,
          ...estimate(idn.prompts, idn.chars, rate),
        }))
        .sort((x, y) => y.est_cost_usd - x.est_cost_usd);

      const svcEst = estimate(svcPrompts, svcChars, rate);
      platformsOut.push({
        ai_service: service,
        product: plat?.product || null,
        vendor: plat?.vendor || null,
        rate_in: rate.in,
        rate_out: rate.out,
        machines: breakdown.length,
        prompts: svcPrompts,
        ...svcEst,
        breakdown,
      });
      totals.prompts += svcPrompts;
      totals.est_total_tokens += svcEst.est_total_tokens;
      totals.est_cost_usd += svcEst.est_cost_usd;
    }
    platformsOut.sort((a, b) => b.est_cost_usd - a.est_cost_usd);

    res.json({
      platforms: platformsOut,
      totals,
      assumptions: {
        chars_per_token: CHARS_PER_TOKEN,
        output_ratio: OUTPUT_RATIO,
        default_prompt_tokens: DEFAULT_PROMPT_TOKENS,
        note: 'Estimated from captured prompt length; output assumed at a fixed ratio of input. Not billed figures.',
      },
    });
  }));
}

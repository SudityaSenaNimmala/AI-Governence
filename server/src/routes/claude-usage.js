import crypto from 'node:crypto';
import { a } from '../util.js';
import { requireMachineAuth } from '../auth.js';
import { machineIdentity } from '../lib/machine-identity.js';

// Claude-only usage: prompts per user across every Claude surface, with REAL
// tokens and cost where we have them and clearly-flagged estimates where we
// don't.
//
// Where the numbers come from:
//   Claude Code (CLI)      prompts: OTel claude_code.user_prompt
//                          tokens/cost: OTel claude_code.api_request  <- MEASURED
//   Claude (browser)       prompts: browser extension, or the claude-tracker exe
//                          tokens/cost: estimated from captured prompt length
//   Claude Code (browser)  same as above, split out by the claude.ai/code path
//   Claude Desktop         prompts: os_monitor UIA watcher
//                          tokens/cost: estimated
//
// Only Claude Code reports billed-accurate figures (Claude Code computes cost
// itself). Everything else is an estimate and is reported under separate keys so
// the UI can never silently present one as the other.

// Prompt-type events. Enforcement events (enforcement_block / _tokenize /
// _redact) are NOT prompts — counting them would inflate every figure here.
const PROMPT_KINDS = ['prompt_paste', 'prompt_submit', 'prompt_typed'];

const CHARS_PER_TOKEN = 4;         // ~4 chars/token for English prose
const OUTPUT_RATIO = 3;            // assumed reply size when we can't measure it
const DEFAULT_PROMPT_TOKENS = 150; // fallback when an event carried no length

// Published per-MTok rates. Used only for ESTIMATED cost — measured cost comes
// from Claude Code itself and never touches this table.
const MODEL_RATES = [
  { match: /fable|mythos/, in: 10.0, out: 50.0 },
  { match: /opus/, in: 5.0, out: 25.0 },
  { match: /haiku/, in: 1.0, out: 5.0 },
  { match: /sonnet/, in: 3.0, out: 15.0 },
];
const DEFAULT_RATE = { in: 3.0, out: 15.0 }; // claude.ai's default tier is Sonnet

function rateFor(model) {
  const m = String(model || '').toLowerCase();
  for (const r of MODEL_RATES) if (r.match.test(m)) return r;
  return DEFAULT_RATE;
}

// Price a set of MEASURED token counts. Used for transcript-derived Claude Code
// usage, where we have exact counts but no cost figure (OTel supplies its own
// cost_usd; transcripts do not).
//
// Cache tokens are not billed at the input rate: reads are ~0.1x and writes
// ~1.25x. Charging everything at full input rate would overstate cost badly on
// agentic workloads, where cache reads dominate by an order of magnitude.
function priceMeasured({ input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens }, model) {
  const r = rateFor(model);
  return (
    (input_tokens / 1e6) * r.in
    + (cache_read_tokens / 1e6) * r.in * 0.10
    + (cache_creation_tokens / 1e6) * r.in * 1.25
    + (output_tokens / 1e6) * r.out
  );
}

// Which capture sources count. By default ONLY the Claude tracker exe and Claude
// Code's own telemetry, so every figure comes from one deliberate, attributable
// pipeline. The browser extension and the full agent's os_monitor also emit
// Claude events, but mixing them in double-counts the same human and drags in
// unattributed rows like "Mozilla-browser-extension" — which is exactly what
// makes a usage number untrustworthy. Pass ?sources=all to see everything.
const TRACKER_SOURCES = ['claude_tracker', 'claude_code_cli'];
const ALL_SOURCES = [...TRACKER_SOURCES, 'browser_extension', 'os_monitor'];

// The three primary Claude surfaces are ALWAYS returned, in this order, even at
// zero. A surface that silently disappears when it has no activity is
// indistinguishable from one that isn't being tracked at all, which is the whole
// question this page exists to answer. Extra surfaces (e.g. Claude Code on the
// web) are appended after these when they have data.
const CANONICAL_SURFACES = ['Claude Desktop', 'Claude (browser)', 'Claude Code (CLI)'];

function emptySurface(surface) {
  return {
    surface, users: 0, prompts: 0,
    measured_tokens: 0, measured_cost_usd: 0, measured_requests: 0,
    estimated_tokens: 0, estimated_cost_usd: 0,
    breakdown: [],
  };
}

// Map a raw (ai_service, source) pair onto a human Claude surface. Returns null
// for anything that isn't Claude, which is how non-Claude traffic is excluded.
function surfaceFor(aiService, source) {
  const svc = String(aiService || '');
  if (svc === 'Claude Code') return 'Claude Code (CLI)';
  if (svc === 'Claude Code (web)') return 'Claude Code (browser)';
  if (svc === 'Claude Desktop') return 'Claude Desktop';
  if (svc === 'Claude') {
    // os_monitor only ever matches the desktop process; the tracker labels the
    // desktop app explicitly (above), so a bare 'Claude' from it is the browser.
    if (source === 'os_monitor') return 'Claude Desktop';
    return 'Claude (browser)';
  }
  return null;
}

function estimate(prompts, totalChars, rate) {
  const inputTokens = totalChars > 0
    ? Math.round(totalChars / CHARS_PER_TOKEN)
    : Math.round(prompts * DEFAULT_PROMPT_TOKENS);
  const outputTokens = Math.round(inputTokens * OUTPUT_RATIO);
  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: inputTokens + outputTokens,
    cost_usd: (inputTokens / 1e6) * rate.in + (outputTokens / 1e6) * rate.out,
  };
}

export function mountClaudeUsage(app, db) {
  // Token usage read from local Claude Code transcripts by the tracker.
  //
  // This exists because OTel delivery is lossy: its exporter has no durable
  // queue, so anything emitted while the server is unreachable is gone. The
  // transcripts on disk are complete, so the tracker replays from them and
  // upserts by message uuid — making repeated delivery safe.
  app.post('/api/v1/claude-usage/tokens', requireMachineAuth, a(async (req, res) => {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    if (rows.length === 0) return res.status(400).json({ error: 'rows must be a non-empty array' });

    const identity = await machineIdentity(db, req.machine.id);
    const now = new Date();
    let stored = 0;

    for (const r of rows) {
      if (!r?.uuid) continue;   // no stable key means we cannot dedupe; skip
      const input = Number(r.input_tokens) || 0;
      const output = Number(r.output_tokens) || 0;
      const cacheRead = Number(r.cache_read_tokens) || 0;
      const cacheCreate = Number(r.cache_creation_tokens) || 0;
      const counts = {
        input_tokens: input, output_tokens: output,
        cache_read_tokens: cacheRead, cache_creation_tokens: cacheCreate,
      };
      // Transcripts carry exact tokens but no cost, so derive it here.
      const costUsd = Number(r.cost_usd) > 0
        ? Number(r.cost_usd)
        : priceMeasured(counts, r.model);

      await db.collection('ai_token_usage').updateOne(
        { request_id: r.uuid },
        {
          $set: {
            machine_id: req.machine.id,
            user_email: r.user_email || identity.user || null,
            occurred_at: r.occurredAt || now.toISOString(),
            source: 'claude_tracker',
            ai_service: 'Claude Code',
            model: r.model || null,
            input_tokens: input,
            output_tokens: output,
            cache_read_tokens: cacheRead,
            cache_creation_tokens: cacheCreate,
            total_tokens: input + output + cacheRead + cacheCreate,
            cost_usd: costUsd,
            measured: true,
            request_id: r.uuid,
            received_at: now,
          },
          $setOnInsert: { id: crypto.randomUUID() },
        },
        { upsert: true },
      );
      stored++;
    }

    res.status(201).json({ ok: true, stored });
  }));

  // Claim Claude accounts for a machine, so their usage rolls up under that
  // machine's person.
  //
  // Why this is needed: Claude Code's telemetry carries no hostname or machine
  // id (only os.type / service.name), so the server cannot tell which physical
  // machine a given account was used on. Going forward the tracker reports each
  // account it sees and they accumulate automatically — but accounts used BEFORE
  // the tracker was installed have no such record, and there is no evidence left
  // on disk to infer it. This endpoint records that attribution explicitly.
  //
  // Body: { machineId, emails: ["a@x.com", ...], unclaim?: bool }
  app.post('/api/v1/claude-usage/claim', a(async (req, res) => {
    const { machineId, emails, unclaim } = req.body ?? {};
    if (!machineId) return res.status(400).json({ error: 'machineId required' });
    if (!Array.isArray(emails) || emails.length === 0) {
      return res.status(400).json({ error: 'emails must be a non-empty array' });
    }

    const machine = await db.collection('machines').findOne({ id: machineId });
    if (!machine) return res.status(404).json({ error: `no machine with id ${machineId}` });

    const normalized = [...new Set(
      emails.filter((e) => typeof e === 'string' && e.includes('@')).map((e) => e.toLowerCase().trim()),
    )];
    if (normalized.length === 0) return res.status(400).json({ error: 'no valid email addresses' });

    await db.collection('machines').updateOne(
      { id: machineId },
      unclaim
        ? { $pull: { claude_accounts: { $in: normalized } } }
        : { $addToSet: { claude_accounts: { $each: normalized } } },
    );

    const updated = await db.collection('machines').findOne(
      { id: machineId }, { projection: { _id: 0, id: 1, hostname: 1, user: 1, claude_accounts: 1 } },
    );
    res.json({ ok: true, action: unclaim ? 'unclaimed' : 'claimed', emails: normalized, machine: updated });
  }));

  app.get('/api/v1/claude-usage', a(async (req, res) => {
    const days = Number(req.query.days) > 0 ? Number(req.query.days) : null;
    const since = days ? new Date(Date.now() - days * 86400_000).toISOString() : null;
    const allSources = String(req.query.sources || '') === 'all';
    const sources = allSources ? ALL_SOURCES : TRACKER_SOURCES;

    // machine_id -> { hostname, user, claude_account_email, claude_accounts, display_name }
    const machines = await db.collection('machines')
      .find({}).project({
        _id: 0, id: 1, hostname: 1, user: 1,
        claude_account_email: 1, claude_accounts: 1, display_name: 1,
      })
      .toArray();
    const machineMap = new Map(machines.map((m) => [m.id, m]));

    // ONE PERSON PER SYSTEM.
    //
    // The same human arrives under two different identities: the tracker reports
    // an OS username (e.g. SatyaPinniti on host SATYA) while Claude Code reports
    // the signed-in OAuth email (e.g. name@company.com). The tracker tells us, at
    // enrolment, which Claude account is signed in on its machine — so we can map
    // that email back to the machine and show a single row per person per system.
    //
    // Every Claude account known to belong to a machine maps back to it — the
    // current one plus every account previously seen or explicitly claimed. This
    // is what lets one person who signed in under several accounts on the same
    // machine appear as a single row.
    const emailToMachine = new Map();
    for (const m of machines) {
      for (const e of m.claude_accounts || []) {
        if (e) emailToMachine.set(String(e).toLowerCase(), m);
      }
      if (m.claude_account_email) emailToMachine.set(m.claude_account_email, m);
    }

    // A person is identified by OS user + hostname first, and only by machine id
    // when that is unavailable.
    //
    // Keying on machine id alone split one human across rows: the .exe tracker and
    // the browser extension enrol as SEPARATE machine records, so the same person on
    // the same laptop appeared twice — 1,118 prompts on one row and 20 on another,
    // both "SatyaPinniti" on host "SATYA". That is fine for an inventory and wrong
    // for the thing this table is for: deciding whose Team licence is underused.
    // Split rows make a heavy user look like two light ones.
    const personKeyFor = (machine, fallback) => {
      const user = machine?.user && !GENERIC_USER.test(machine.user) ? machine.user : null;
      const host = machine?.hostname || null;
      if (user && host) return `person:${String(user).toLowerCase()}@${String(host).toLowerCase()}`;
      return machine ? `machine:${machine.id}` : `unlinked:${fallback}`;
    };

    // A browser reporting its own user agent as the hostname, e.g. an extension that
    // enrolled before it could read the OS user. "Mozilla" is what every major
    // browser's UA starts with, so it is the value that actually shows up.
    const UA_HOSTNAME = /^(mozilla|chrome|safari|firefox|edge|opera)$/i;
    const isNamed = (r) => Boolean(r.user) || Boolean(r.hostname && !UA_HOSTNAME.test(r.hostname));

    // Exclude debug/test enrollments, same rule the AI Usage report uses.
    const EXCLUDE_RE = /debug/i;
    const excluded = new Set(
      machines
        .filter((m) => EXCLUDE_RE.test(m.hostname || '') || EXCLUDE_RE.test(m.user || ''))
        .map((m) => m.id),
    );

    const promptQuery = { event_kind: { $in: PROMPT_KINDS }, source: { $in: sources } };
    if (since) promptQuery.occurred_at = { $gte: since };
    const events = await db.collection('dlp_events')
      .find(promptQuery)
      .project({ _id: 0, ai_service: 1, source: 1, machine_id: 1, content_length: 1 })
      .toArray();

    const usageQuery = { source: { $in: sources } };
    if (since) usageQuery.occurred_at = { $gte: since };
    const usageRows = await db.collection('ai_token_usage')
      .find(usageQuery)
      .project({
        _id: 0, ai_service: 1, source: 1, machine_id: 1, user_email: 1, model: 1,
        input_tokens: 1, output_tokens: 1, cache_read_tokens: 1,
        cache_creation_tokens: 1, total_tokens: 1, cost_usd: 1,
      })
      .toArray();

    // surface -> { users: Map<key, row> }
    const surfaces = new Map();
    const ensure = (surface) => {
      if (!surfaces.has(surface)) surfaces.set(surface, { surface, users: new Map() });
      return surfaces.get(surface);
    };

    // Resolve an event to a person. `fallbackEmail` is the Claude Code OAuth email
    // (present only on token-usage rows and CLI events); when it maps to a machine
    // that enrolled with that account, the event is attributed to that machine's
    // person — which is what merges CLI usage with desktop/browser usage.
    const GENERIC_USER = /-browser-extension$/i;
    const identityFor = (machineId, explicitEmail) => {
      let meta = machineMap.get(machineId) || null;

      // Claude Code has no real machine of its own — otel.js files its events
      // under a synthetic `clicode:<identity>` id. Prompt events carry no email
      // field at all, so derive it from that id (and from the machine record's
      // user, which otel.js sets to the same address). Without this, CLI prompts
      // stay orphaned from the machine that produced them.
      let email = explicitEmail || null;
      if (!email && typeof machineId === 'string' && machineId.startsWith('clicode:')) {
        email = machineId.slice('clicode:'.length);
      }
      if (!email && meta?.user && String(meta.user).includes('@')) email = meta.user;

      // Resolve to the machine that enrolled with this Claude account.
      if (email) {
        const linked = emailToMachine.get(String(email).toLowerCase());
        if (linked) meta = linked;
      }
      const fallbackEmail = email;

      const osUser = meta?.user && !GENERIC_USER.test(meta.user) ? meta.user : null;
      // Prefer the OS username: this row is "a person on a machine", and the OS
      // account is that machine's stable owner. A Claude display name is per
      // Claude-account and changes whenever someone signs in as someone else —
      // using it would relabel the machine's owner after every account switch.
      // "-browser-extension" is an enrolment suffix the extension appends to the
      // hostname it registers, not part of anyone's name. Left in, the table read
      // "SudityaSena-browser-extension", which names the capture method rather than
      // the person and reads as a different individual from a "SudityaSena" row
      // enrolled by the .exe.
      const cleanHost = meta?.hostname ? String(meta.hostname).replace(/-browser-extension$/i, '') : null;
      const label = osUser || meta?.display_name || fallbackEmail || cleanHost
        || String(machineId || 'unknown').slice(0, 12);

      return {
        key: personKeyFor(meta, fallbackEmail || machineId),
        label,
        user: osUser || fallbackEmail || null,
        // Cleaned here too, not just in the label: the System column renders this,
        // and "SudityaSena-browser-extension" names the capture method rather than
        // the machine.
        hostname: cleanHost,
        email: meta?.claude_account_email || (fallbackEmail ? String(fallbackEmail).toLowerCase() : null),
        attributed: !!(osUser || fallbackEmail),
        linked: !!meta,
      };
    };

    const ensureUser = (surfaceRow, ident) => {
      if (!surfaceRow.users.has(ident.key)) {
        surfaceRow.users.set(ident.key, {
          label: ident.label,
          user: ident.user,
          hostname: ident.hostname,
          email: ident.email,
          attributed: ident.attributed,
          prompts: 0,
          chars: 0,
          models: new Set(),
          measured: {
            input_tokens: 0, output_tokens: 0, cache_read_tokens: 0,
            cache_creation_tokens: 0, total_tokens: 0, cost_usd: 0, requests: 0,
          },
        });
      }
      return surfaceRow.users.get(ident.key);
    };

    // Claude Code usage can arrive twice for the same person: lossily over OTel
    // (source claude_code_cli) and completely from local transcripts read by the
    // tracker (source claude_tracker). Where a machine reports transcript data,
    // that is authoritative and the OTel copy is dropped — otherwise every CLI
    // prompt delivered by both paths would be counted twice.
    const transcriptMachines = new Set();
    for (const e of events) {
      if (e.source === 'claude_tracker' && e.ai_service === 'Claude Code') {
        const ident = identityFor(e.machine_id, null);
        transcriptMachines.add(ident.key);
      }
    }
    const supersededByTranscript = (machineId, email, service) => {
      if (service !== 'Claude Code') return false;
      const ident = identityFor(machineId, email);
      return transcriptMachines.has(ident.key);
    };

    for (const e of events) {
      if (excluded.has(e.machine_id)) continue;
      const surface = surfaceFor(e.ai_service, e.source);
      if (!surface) continue;
      if (e.source === 'claude_code_cli'
          && supersededByTranscript(e.machine_id, null, e.ai_service)) continue;
      const ident = identityFor(e.machine_id, null);
      const u = ensureUser(ensure(surface), ident);
      u.prompts += 1;
      u.chars += Number(e.content_length) || 0;
    }

    for (const r of usageRows) {
      if (excluded.has(r.machine_id)) continue;
      const surface = surfaceFor(r.ai_service, r.source);
      if (!surface) continue;
      if (r.source === 'claude_code_cli'
          && supersededByTranscript(r.machine_id, r.user_email || null, r.ai_service)) continue;
      const ident = identityFor(r.machine_id, r.user_email || null);
      const u = ensureUser(ensure(surface), ident);
      u.measured.input_tokens += Number(r.input_tokens) || 0;
      u.measured.output_tokens += Number(r.output_tokens) || 0;
      u.measured.cache_read_tokens += Number(r.cache_read_tokens) || 0;
      u.measured.cache_creation_tokens += Number(r.cache_creation_tokens) || 0;
      u.measured.total_tokens += Number(r.total_tokens) || 0;
      u.measured.cost_usd += Number(r.cost_usd) || 0;
      u.measured.requests += 1;
      if (r.model) u.models.add(r.model);
    }

    const totals = {
      prompts: 0, users: 0,
      measured_tokens: 0, measured_cost_usd: 0, measured_requests: 0,
      estimated_tokens: 0, estimated_cost_usd: 0,
    };
    const seenUsers = new Set();
    // person_key -> rollup across every surface, so one human on one machine is
    // a single row no matter how many Claude surfaces they used.
    const systems = new Map();

    // Tallied at the point of exclusion, not by filtering `systems` afterwards.
    // Skipping these in the surface loop means they never reach the rollup, so a
    // post-hoc filter counts zero and the excluded usage disappears with nothing
    // saying it existed — the opposite of the intent.
    const excludedKeys = new Set();
    let excludedPrompts = 0;

    const surfacesOut = [];
    for (const s of surfaces.values()) {
      const breakdown = [];
      const agg = {
        prompts: 0, measured_tokens: 0, measured_cost_usd: 0, measured_requests: 0,
        estimated_tokens: 0, estimated_cost_usd: 0,
      };

      for (const [personKey, u] of s.users) {
        // Same isNamed rule as the per-person table, applied here too.
        //
        // Filtering only `systems` left the two tables disagreeing: the surface tab
        // read "Claude (Browser) · 70 prompts" while the browser column above summed
        // to 58, the difference being UA-only enrolments listed in one place and not
        // the other. Two totals for the same thing on one screen is worse than
        // either choice made consistently.
        if (!isNamed(u)) { excludedKeys.add(personKey); excludedPrompts += u.prompts || 0; continue; }
        const models = [...u.models];
        const hasMeasured = u.measured.total_tokens > 0 || u.measured.requests > 0;
        // Only estimate where nothing was measured — never stack an estimate on
        // top of real numbers for the same user/surface.
        const est = hasMeasured ? null : estimate(u.prompts, u.chars, rateFor(models[0]));

        const row = {
          person_key: personKey,
          label: u.label,
          user: u.user,
          hostname: u.hostname,
          email: u.email,
          attributed: u.attributed,
          prompts: u.prompts,
          models,
          measured: hasMeasured,
          tokens: hasMeasured ? u.measured.total_tokens : est.total_tokens,
          cost_usd: hasMeasured ? u.measured.cost_usd : est.cost_usd,
          detail: hasMeasured ? { ...u.measured } : { ...est, estimated: true },
        };
        breakdown.push(row);

        // Per-system rollup: one entry per person/machine, across every surface.
        if (!systems.has(personKey)) {
          systems.set(personKey, {
            person_key: personKey,
            label: u.label,
            hostname: u.hostname,
            email: u.email,
            user: u.user,
            // Carried through so a per-person row can say whether the name was
            // resolved from an OS account or only inferred from a hostname. Absent,
            // it read as undefined — and any consumer testing !attributed would have
            // labelled every person "unattributed", including the ones we are sure of.
            attributed: u.attributed,
            prompts: 0,
            measured_tokens: 0,
            measured_cost_usd: 0,
            estimated_tokens: 0,
            estimated_cost_usd: 0,
            by_surface: {},
          });
        }
        const sys = systems.get(personKey);
        // A machine-resolved label/hostname is better than an email-only one.
        if (u.hostname && !sys.hostname) sys.hostname = u.hostname;
        if (u.email && !sys.email) sys.email = u.email;
        sys.prompts += u.prompts;
        sys.by_surface[s.surface] = (sys.by_surface[s.surface] || 0) + u.prompts;
        if (hasMeasured) {
          sys.measured_tokens += u.measured.total_tokens;
          sys.measured_cost_usd += u.measured.cost_usd;
        } else {
          sys.estimated_tokens += est.total_tokens;
          sys.estimated_cost_usd += est.cost_usd;
        }

        agg.prompts += u.prompts;
        if (hasMeasured) {
          agg.measured_tokens += u.measured.total_tokens;
          agg.measured_cost_usd += u.measured.cost_usd;
          agg.measured_requests += u.measured.requests;
        } else {
          agg.estimated_tokens += est.total_tokens;
          agg.estimated_cost_usd += est.cost_usd;
        }
        seenUsers.add(personKey);   // count people, not identities
      }

      breakdown.sort((x, y) => y.prompts - x.prompts);
      surfacesOut.push({ surface: s.surface, users: breakdown.length, ...agg, breakdown });

      totals.prompts += agg.prompts;
      totals.measured_tokens += agg.measured_tokens;
      totals.measured_cost_usd += agg.measured_cost_usd;
      totals.measured_requests += agg.measured_requests;
      totals.estimated_tokens += agg.estimated_tokens;
      totals.estimated_cost_usd += agg.estimated_cost_usd;
    }

    // Backfill the primary surfaces so the UI always shows Desktop, Browser and
    // CLI — a zero there means "tracked, nothing yet", not "missing".
    for (const name of CANONICAL_SURFACES) {
      if (!surfacesOut.some((s) => s.surface === name)) surfacesOut.push(emptySurface(name));
    }

    // Canonical order first; anything else (Claude Code on the web) after, by volume.
    surfacesOut.sort((x, y) => {
      const ix = CANONICAL_SURFACES.indexOf(x.surface);
      const iy = CANONICAL_SURFACES.indexOf(y.surface);
      if (ix !== -1 && iy !== -1) return ix - iy;
      if (ix !== -1) return -1;
      if (iy !== -1) return 1;
      return y.prompts - x.prompts;
    });

    totals.users = seenUsers.size;

    res.json({
      period_days: days,
      sources,
      sources_mode: allSources ? 'all' : 'tracker',
      // Rows that name somebody. The test is whether the enrolment resolved to a
      // person, NOT whether it came from the extension — an extension enrolment that
      // registered as "SudityaSena" is a real colleague and belongs here.
      //
      // What gets excluded is an enrolment whose hostname is the browser's own user
      // agent, so it reads "Mozilla" once the suffix is stripped. Those name nobody,
      // cannot inform a licence decision, and sitting beside real people they invite
      // revoking a seat from a row that is not a seat.
      //
      // Counted, not dropped silently: unattributed_rows/unattributed_prompts say
      // how much usage sits outside the named rows, so totals still reconcile.
      systems: [...systems.values()].sort((x, y) => y.prompts - x.prompts),
      unattributed_rows: excludedKeys.size,
      unattributed_prompts: excludedPrompts,
      surfaces: surfacesOut,
      totals,
      assumptions: {
        chars_per_token: CHARS_PER_TOKEN,
        output_ratio: OUTPUT_RATIO,
        default_prompt_tokens: DEFAULT_PROMPT_TOKENS,
        note: 'Prompt counts are measured on every surface. Tokens and cost are MEASURED for Claude Code (reported by the CLI itself) and ESTIMATED elsewhere from captured prompt length. The two are never summed together.',
        sources_note: allSources
          ? 'Including browser-extension and os_monitor events — the same person may be counted twice across sources.'
          : 'Counting only the Claude Usage Tracker exe and Claude Code telemetry. Browser-extension and os_monitor events are excluded so each prompt is counted once, by one pipeline.',
      },
    });
  }));
}

// AI Risk Score Engine — computes a 0-100 risk score per employee.
//
// Score factors (weighted):
//   1. DLP violations (high/critical blocked events)     — weight 30
//   2. Enforcement overrides (Ctrl+Alt+Enter bypasses)   — weight 25
//   3. Shadow tool usage (unsanctioned AI tools)          — weight 20
//   4. Data sensitivity (PII/secrets in prompts)          — weight 15
//   5. Volume anomaly (sudden usage spikes)               — weight 10
//
// Score ranges:
//   0-30:  Low (green)     — model AI citizen
//   31-60: Medium (yellow) — some flags, worth monitoring
//   61-80: High (orange)   — active issues, needs attention
//   81-100: Critical (red) — immediate intervention required
//
// The score is computed over a configurable window (default: 30 days).
// Historical scores are stored for trending.

import crypto from 'node:crypto';
import { a } from '../util.js';
import { fireWebhooks } from './webhooks.js';
import { scoreToLevel } from '../lib/risk-scale.js';
import { isDemoIdentity, isDemoMachine } from '../lib/demo-personas.js';
import { compactKey, knownEmailsByKey } from '../lib/known-emails.js';
import {
  RESPONSE_BUDGET_MS, raceWithFallback, applyBudgetHeaders, registerResponseWarmer, invalidateRoute,
} from '../lib/response-budget.js';

const WINDOW_DAYS = 90;
const WEIGHTS = {
  dlp_violations: 30,
  enforcement_overrides: 25,
  shadow_tools: 20,
  data_sensitivity: 15,
  volume_anomaly: 10,
};

/**
 * Profiles the endpoint scanner created from a browser extension it could not yet
 * match to a named account. Defined once so the list and summary endpoints cannot
 * drift apart again — they previously each carried their own copy of this rule,
 * and only one of them applied it.
 *
 * Exported because it is not only a risk-score concern: it is the org-wide test
 * for "this display name is a placeholder, not a person", and routes/access-requests.js
 * needs it to keep such a name from outranking a real detected username.
 */
export const UNIDENTIFIED_NAME = /^Browser User/;

const SCORES_ROUTE = 'risk-scores';
const SUMMARY_ROUTE = 'risk-scores.summary';

export function mountRiskScore(app, db) {
  const scores    = () => db.collection('risk_scores');
  const profiles  = () => db.collection('employee_profiles');
  const dlpEvents = () => db.collection('dlp_events');

  // ── Compute scores for all employees ──

  // PER PERSON, NOT PER PROFILE. One human routinely owns several
  // employee_profiles (one per agent machine/OS-user resolve_key, one per
  // unmatched browser extension), so each PERSON is scored once over the union
  // of their machines and the result is written to every member profile. The
  // body is computeAllScores (below) so the background scheduler
  // (lib/risk-score-scheduler.js) runs exactly the same thing; see runCompute for
  // why it is batched rather than a loop of queries.
  app.post('/api/v1/risk-scores/compute', a(async (req, res) => {
    // A scheduled run already in flight is joined rather than duplicated.
    res.json(await computeAllScores(db, { source: 'manual', ifBusy: 'join' }));
  }));

  // ── Get all current scores (from profiles) ──
  //
  // BUDGETED, at last. The incident in the comment above — 384 serialized round
  // trips, ~18s, past nginx's 120s proxy_read_timeout, a 504 for the caller and
  // a box too busy to answer anything else — was fixed by batching the COMPUTE
  // path, and no safety net was ever added to the read paths. Both of these
  // reads are now bounded like every other AI Hub tab read: over budget, they
  // serve the last real answer with X-Response-Stale and its capture time.

  app.get('/api/v1/risk-scores', a(async (req, res) => {
    const result = await raceWithFallback({
      route: SCORES_ROUTE, params: null, budgetMs: RESPONSE_BUDGET_MS,
      live: () => fetchScores(db),
    });
    if (result.failed) throw result.error;
    applyBudgetHeaders(res, result);
    res.json(result.value);
  }));

  // ── Summary stats (MUST be before /:profileId to avoid Express param conflict) ──

  app.get('/api/v1/risk-scores/summary', a(async (req, res) => {
    const result = await raceWithFallback({
      route: SUMMARY_ROUTE, params: null, budgetMs: RESPONSE_BUDGET_MS,
      live: () => fetchScoresSummary(db),
    });
    if (result.failed) throw result.error;
    applyBudgetHeaders(res, result);
    res.json(result.value);
  }));

  registerResponseWarmer(SCORES_ROUTE, () => raceWithFallback({
    route: SCORES_ROUTE, params: null, budgetMs: RESPONSE_BUDGET_MS, live: () => fetchScores(db),
  }));
  registerResponseWarmer(SUMMARY_ROUTE, () => raceWithFallback({
    route: SUMMARY_ROUTE, params: null, budgetMs: RESPONSE_BUDGET_MS, live: () => fetchScoresSummary(db),
  }));

  // ── Score trend — average score per day, across identified employees ──
  // (also before /:profileId, same Express param-conflict reason as /summary)
  //
  // risk_scores already carries one row per employee per compute run, so this
  // is a real aggregation over real history — not a synthesized rollup. Each
  // row already carries the display_name it was scored under, so the same
  // UNIDENTIFIED_NAME exclusion /summary uses applies directly here with no
  // join back to employee_profiles. Sparse by construction: a day only
  // appears if a compute ran that day AND wrote history — rows are deduped per
  // person (only on a change, or once a day), so a day averages the people
  // whose score was recorded that day.
  app.get('/api/v1/risk-scores/trend', a(async (req, res) => {
    const days = Math.min(365, Math.max(1, Number(req.query.days) || 90));
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const rows = await scores().aggregate([
      { $match: { computed_at: { $gte: since }, display_name: { $not: UNIDENTIFIED_NAME } } },
      { $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$computed_at' } },
          avg_score: { $avg: '$score' },
          employees: { $sum: 1 },
        } },
      { $sort: { _id: 1 } },
    ]).toArray();
    res.json(rows.map(r => ({ date: r._id, avg_score: Math.round(r.avg_score), employees: r.employees })));
  }));

  // ── Get single employee score with history ──

  app.get('/api/v1/risk-scores/:profileId', a(async (req, res) => {
    const profile = await profiles().findOne({ id: req.params.profileId }, { projection: { _id: 0 } });
    if (!profile) return res.status(404).json({ error: 'profile not found' });

    // The list shows ONE row per person, keyed by the highest-scoring member's
    // id, so its breakdown covers every profile sharing that person_key —
    // otherwise the expanded row would show one device's events under a score
    // computed over all of them. Before the first compute there is no
    // person_key yet and the profile stands alone, as it always did.
    let members = [profile];
    if (profile.person_key) {
      const same = await profiles().find({ person_key: profile.person_key }).project({ _id: 0 }).toArray();
      if (same.length) members = same.some(m => m.id === profile.id) ? same : [profile, ...same];
    }
    // Demo personas and demo machines are never part of a real person: a stale
    // person_key on a leftover demo profile must not pull it (or the JAMES /
    // EMILY machines) back into a real employee's breakdown.
    const allMachineIds = [...new Set(members.flatMap(m => m.machine_ids || []).filter(Boolean))];
    const machineDocs = allMachineIds.length
      ? await db.collection('machines').find({ id: { $in: allMachineIds } })
        .project({ _id: 0, id: 1, user: 1, hostname: 1 }).toArray()
      : [];
    const byId = new Map(machineDocs.map(m => [m.id, m]));
    members = members.filter(m => m.id === profile.id || !isDemoProfile(m, byId));
    const memberIds = members.map(m => m.id);
    const machineIds = realMachineIds(members, byId);

    const history = await scores()
      .find({ profile_id: { $in: memberIds } })
      .sort({ computed_at: -1 })
      .limit(90)
      .project({ _id: 0, score: 1, level: 1, computed_at: 1 })
      .toArray();

    // Recent DLP events across all of this person's machines
    const recentEvents = await dlpEvents()
      .find({ machine_id: { $in: machineIds }, occurred_at: { $gte: windowStart() } })
      // occurred_at is stored as ISO string — string comparison works for sorting
      .sort({ occurred_at: -1 })
      .limit(20)
      .project({ _id: 0 })
      .toArray();

    res.json({ profile, history, recent_events: recentEvents, merged_profile_ids: memberIds });
  }));
}

// ── Person grouping ───────────────────────────────────────────────────
//
// WHY. resolveProfiles (routes/identity.js) mints one employee_profile per
// agent machine/OS-user pair (`agent:host:user`) and one per browser extension
// it could not link, so a single human with a laptop, a desktop and a browser
// showed up three times in "Employees by Risk" — each with a slice of their
// behaviour and therefore a score that understated them.
//
// RULE. Profiles that share a normalized email OR a detected OS username (any
// machine `user` / profile os_user, DOMAIN\ stripped, lowercased) are the same
// person — joined transitively with union-find, so A~B by email and B~C by
// username puts all three together. Display names are deliberately NOT a join
// key: two different people can share one. Unidentified ("Browser User …")
// profiles never join anything.
//
// person_key: the component's smallest email, else its smallest username, else
// the profile id (a singleton with nothing to join on).
//
// OWN IDENTITY FIRST. A profile's tokens come from what identifies THAT profile:
// its resolve_key (`agent:<host>:<user>` → user, `ext:<machineId>` → that
// machine's user/email), its email and its os_user. Users of the OTHER machines
// in machine_ids are only a fallback for a profile with no identity of its own.
// Otherwise one machine that ended up on two people's profiles (old demo seeds
// absorbed real employees' extensions this way) bridged them into one person.
//
// DEMO PERSONAS (lib/demo-personas.js) never contribute a token, and a profile
// whose own identity is a demo persona — or which has no real identity and only
// demo machines — is dropped from the output entirely.

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const HIGH_LEVELS = new Set(['high', 'critical']);
const HISTORY_REFRESH_MS = 24 * 60 * 60 * 1000;

function normUser(u) {
  const s = String(u || '').trim();
  if (!s) return null;
  if (EMAIL_RE.test(s)) return { email: s.toLowerCase() };
  const bare = s.split('\\').pop().trim().toLowerCase();
  return bare ? { user: bare } : null;
}

// The identity values a profile carries itself, before any demo filtering.
function ownIdentityValues(p, machinesById) {
  const out = [];
  const rk = String(p.resolve_key || '');
  if (rk.startsWith('agent:')) {
    const rest = rk.slice('agent:'.length);
    const i = rest.indexOf(':');
    if (i >= 0) out.push(rest.slice(i + 1));
  } else if (rk.startsWith('ext:')) {
    out.push(machinesById.get(rk.slice('ext:'.length))?.user);
  }
  out.push(p.email, p.os_user);
  return out.filter(v => String(v ?? '').trim());
}

// Profile's machines, minus demo machines. A machine id with no record is kept —
// nothing says it is demo.
function realMachines(p, machinesById) {
  return (p.machine_ids || []).filter(Boolean).filter(id => !isDemoMachine(machinesById.get(id)));
}

function realMachineIds(members, machinesById) {
  return [...new Set(members.flatMap(m => realMachines(m, machinesById)))];
}

/**
 * Pure. True for a leftover demo persona profile: its own identity is a demo
 * persona, or it has no real identity of its own and every machine it lists is a
 * demo machine (or, with nothing else to go on, a demo display name).
 */
export function isDemoProfile(p, machinesById = new Map()) {
  if (!p) return false;
  const own = ownIdentityValues(p, machinesById);
  const realOwn = own.filter(v => !isDemoIdentity(v));
  if (realOwn.length) return false;
  if (own.length) return true;                         // only demo identities
  const ids = (p.machine_ids || []).filter(Boolean);
  if (ids.length && ids.every(id => isDemoMachine(machinesById.get(id)))) return true;
  // No identity, no machines that say otherwise: fall back to the name.
  const borrowed = realMachines(p, machinesById)
    .map(id => machinesById.get(id)?.user).filter(u => u && !isDemoIdentity(u));
  return !borrowed.length && isDemoIdentity(p.display_name);
}

/**
 * Pure. Groups profiles into persons. Demo persona profiles are excluded.
 * @param {object[]} allProfiles
 * @param {Map<string, {id,user,hostname}>} machinesById
 * @returns {{ person_key: string, identified: boolean, members: object[] }[]}
 */
export function groupPersons(allProfiles, machinesById = new Map()) {
  allProfiles = allProfiles.filter(p => !isDemoProfile(p, machinesById));
  const parent = allProfiles.map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const union = (x, y) => { const a = find(x), b = find(y); if (a !== b) parent[b] = a; };

  const tokens = allProfiles.map((p) => {
    const emails = new Set(), users = new Set();
    if (UNIDENTIFIED_NAME.test(p.display_name || '')) return { emails, users };
    const add = (v) => {
      if (isDemoIdentity(v)) return;
      const n = normUser(v);
      if (n?.email) emails.add(n.email); else if (n?.user) users.add(n.user);
    };
    for (const v of ownIdentityValues(p, machinesById)) add(v);
    if (!emails.size && !users.size) {
      for (const id of realMachines(p, machinesById)) add(machinesById.get(id)?.user);
    }
    return { emails, users };
  });

  const owner = new Map();
  tokens.forEach((t, i) => {
    const keys = [...[...t.emails].map(e => 'e:' + e), ...[...t.users].map(u => 'u:' + u)];
    for (const k of keys) {
      if (owner.has(k)) union(owner.get(k), i); else owner.set(k, i);
    }
  });

  const comps = new Map();
  allProfiles.forEach((_, i) => {
    const r = find(i);
    if (!comps.has(r)) comps.set(r, []);
    comps.get(r).push(i);
  });

  return [...comps.values()].map((idx) => {
    const members = idx.map(i => allProfiles[i]).sort((a, b) => String(a.id).localeCompare(String(b.id)));
    const emails = [...new Set(idx.flatMap(i => [...tokens[i].emails]))].sort();
    const users = [...new Set(idx.flatMap(i => [...tokens[i].users]))].sort();
    const identified = members.some(m => !UNIDENTIFIED_NAME.test(m.display_name || ''));
    return { person_key: emails[0] || users[0] || String(members[0].id), identified, members };
  });
}

// The identity the agent/extension actually reported (machine OS user → profile
// email → machine hostname → profile hostname), over the person's profiles, the
// preferred one first. Each profile's OWN machine (the one its resolve_key names)
// is consulted before any other it lists, and demo machines / demo personas are
// skipped, so a real person is never labelled with a demo persona's username.
function detectedName(members, byId) {
  for (const p of members) {
    const rk = String(p.resolve_key || '');
    const ownExt = rk.startsWith('ext:') ? rk.slice(4) : null;
    const ownUser = rk.startsWith('agent:') ? rk.slice(6).split(':').slice(1).join(':') : null;
    const ms = realMachines(p, byId).map(id => byId.get(id)).filter(Boolean);
    const rank = (m) => (m.id === ownExt || (ownUser && String(m.user || '').toLowerCase() === ownUser.toLowerCase())) ? 0 : 1;
    ms.sort((a, b) => rank(a) - rank(b));
    const user = ms.find(m => m.user && !isDemoIdentity(m.user))?.user;
    const email = p.email && !isDemoIdentity(p.email) ? p.email : null;
    const n = user || email || ms.find(m => m.hostname)?.hostname || p.hostname;
    if (n) return n;
  }
  return null;
}

function unionSources(members) {
  const arrays = members.map(m => m.sources).filter(Array.isArray);
  return arrays.length ? [...new Set(arrays.flat())] : undefined;
}

// Highest-scoring member, ties broken by id — the same order computeAllScores
// uses for its representative, so history rows and list rows agree on the id.
function topMember(members) {
  return [...members].sort((a, b) =>
    ((b.risk_score ?? -1) - (a.risk_score ?? -1)) || String(a.id).localeCompare(String(b.id)))[0];
}

const PROFILE_FIELDS = { _id: 0, id: 1, display_name: 1, email: 1, hostname: 1, department: 1, os_user: 1,
  risk_score: 1, risk_level: 1, risk_factors: 1, risk_computed_at: 1, sources: 1, machine_ids: 1, person_key: 1,
  resolve_key: 1 };

// TWO READS, IN PARALLEL, whatever the head count: every profile and every
// machine's reported identity; grouping is then pure in-memory work. Grouping
// is recomputed live with the same rule compute uses, so a profile created
// since the last compute (no person_key yet) is already folded into its person
// and the table is right before the next run.
async function loadPersonGroups(db) {
  const [allProfiles, machines] = await Promise.all([
    db.collection('employee_profiles').find({}).project(PROFILE_FIELDS).toArray(),
    db.collection('machines').find({}).project({ _id: 0, id: 1, user: 1, hostname: 1 }).toArray(),
  ]);
  const byId = new Map(machines.map(m => [m.id, m]));
  return { groups: groupPersons(allProfiles, byId), byId };
}

// The work behind GET /api/v1/risk-scores, pulled out of the handler so the
// route can race it against the budget and the boot warmer can run the same
// read — one definition, so a warmed body can never differ from a served one.
//
// ONE ROW PER PERSON. The row carries the highest-scoring member's id, so the
// existing /:profileId detail route keeps working, plus merged_profile_ids.
// Work emails the fleet has reported anywhere (any machine whose user is an
// address: Claude Code sessions, trackers, signed-in extensions), keyed by the
// local part with separators removed — "pravallika.punumalli@x" → key
// "pravallikapunumalli". A person whose only identity is a run-together Windows
// username ("Pravallikapunumalli") gets that email, which is what lets the UI
// show "Pravallika Punumalli". Ambiguous keys (two different emails) are
// dropped rather than guessed. Demo personas never count.
// (Matcher shared with resolveProfiles — see lib/known-emails.js.)
async function fetchScores(db) {
  const { groups, byId } = await loadPersonGroups(db);
  const emailsByKey = knownEmailsByKey(byId);
  const rows = [];
  for (const g of groups) {
    const scored = g.members.filter(m => m.risk_score != null);
    if (!scored.length) continue;
    const top = topMember(scored);
    const detected = detectedName([top, ...g.members.filter(m => m !== top)], byId);
    const ownEmail = [top, ...g.members].map(m => m.email).find(e => e && !isDemoIdentity(e)) || null;
    rows.push({
      id: top.id,
      display_name: top.display_name,
      email: ownEmail || emailsByKey.get(compactKey(detected)) || null,
      hostname: top.hostname ?? null,
      department: top.department || g.members.find(m => m.department)?.department || null,
      risk_score: top.risk_score,
      risk_level: top.risk_level,
      risk_factors: top.risk_factors,
      risk_computed_at: top.risk_computed_at,
      sources: unionSources(g.members),
      detected_name: detected,
      person_key: g.person_key,
      merged_profile_ids: g.members.map(m => m.id),
      // Tagged identified or not using the SAME rule the summary applies, so
      // total_employees + unidentified equals this row count. The filter stays
      // out of this endpoint — dropping rows here would hide real people whose
      // extension has not yet been matched to an account.
      is_identified: g.identified,
    });
  }
  rows.sort((a, b) => (b.risk_score - a.risk_score) || String(a.id).localeCompare(String(b.id)));
  return rows;
}

// The work behind GET /api/v1/risk-scores/summary. Counts PERSONS, from the same
// two parallel reads as the list, so the header and the table cannot disagree.
async function fetchScoresSummary(db) {
  const { groups } = await loadPersonGroups(db);
  let unidentified = 0, notAssessed = 0;
  const scoredPeople = [];
  for (const g of groups) {
    const scored = g.members.filter(m => m.risk_score != null);
    // Scored but not attributable to a named person: counted separately rather
    // than dropped, and kept out of the average (an unnamed row cannot be actioned).
    if (!g.identified) { if (scored.length) unidentified++; continue; }
    // Report the unmeasured population instead of quietly dropping it — "we
    // measured 4 of 40 people" is a different statement from "we measured 4".
    if (!scored.length) { notAssessed++; continue; }
    scoredPeople.push(topMember(scored));
  }

  const total = scoredPeople.length;
  const avgScore = total ? Math.round(scoredPeople.reduce((s, p) => s + p.risk_score, 0) / total) : 0;
  const distribution = { low: 0, medium: 0, high: 0, critical: 0 };
  for (const p of scoredPeople) distribution[p.risk_level] = (distribution[p.risk_level] || 0) + 1;

  return {
    total_employees: total,
    average_score: avgScore,
    distribution,
    unidentified,
    not_assessed: notAssessed,
    coverage_percent: (total + notAssessed) ? Math.round((total / (total + notAssessed)) * 100) : 0,
  };
}

// ── Compute (shared by POST /compute and the scheduler) ───────────────

// One run per db at a time. WeakMap so separate test dbs never block each other.
const inFlight = new WeakMap();

export function isRiskComputeRunning(db) {
  return inFlight.has(db);
}

/**
 * Score every person and persist the result onto each member profile.
 *
 * @param {object} db
 * @param {{ source?: string, ifBusy?: 'join'|'skip' }} [opts]
 *   ifBusy 'join' (default) returns the in-flight run's result; 'skip' returns
 *   `{ skipped: true }` immediately — what the scheduler wants.
 */
export function computeAllScores(db, { source = 'manual', ifBusy = 'join' } = {}) {
  const running = inFlight.get(db);
  if (running) return ifBusy === 'skip' ? Promise.resolve({ skipped: true, reason: 'in_flight' }) : running;
  const p = runCompute(db, source).finally(() => inFlight.delete(db));
  inFlight.set(db, p);
  return p;
}

// WHY THIS IS BATCHED AND NOT A LOOP OF QUERIES.
//
// This used to issue SIX sequential Mongo queries per profile and then TWO
// sequential writes, inside a sequential for-loop. At 48 profiles that is 384
// serialized round trips against Atlas; on the deploy host it exceeded nginx's
// 120s proxy_read_timeout and the caller got a 504 — while the run monopolised
// the box long enough that concurrent requests failed too.
//
// The cost is independent of the head count: three parallel reads (profiles,
// sanctions, machine identities), the metric aggregations, pure in-memory
// scoring, then at most one insertMany and one bulkWrite.
async function runCompute(db, source) {
  const profilesC = db.collection('employee_profiles');
  const [allProfiles, allSanctions, machines] = await Promise.all([
    profilesC.find({}).project({ _id: 0 }).toArray(),
    db.collection('sanctions').find({}).project({ _id: 0 }).toArray(),
    db.collection('machines').find({}).project({ _id: 0, id: 1, user: 1, hostname: 1 }).toArray(),
  ]);
  const sanctionedKeys = new Set(allSanctions.filter(s => s.status === 'approved').map(s => s.tool_key));
  const byId = new Map(machines.map(m => [m.id, m]));
  const groups = groupPersons(allProfiles, byId);

  const machineIds = realMachineIds(allProfiles, byId);
  const metrics = await machineMetrics(db, machineIds);

  const computedAt = new Date();
  const results = [];
  const history = [];
  const updates = [];
  const alerts = [];

  for (const g of groups) {
    const rep = g.members[0];   // id-ordered; matches topMember once all members share the score
    const merged = {
      id: rep.id,
      display_name: rep.display_name,
      email: rep.email || g.members.find(m => m.email)?.email,
      // Demo machines never count toward a real person's score.
      machine_ids: realMachineIds(g.members, byId),
      // Unknown provenance on ANY member keeps the full denominator — the same
      // conservative rule computeScore applies to a single profile.
      sources: g.members.every(m => Array.isArray(m.sources)) ? unionSources(g.members) : undefined,
    };
    const score = computeScore(merged, metrics, sanctionedKeys);
    const detected = detectedName(g.members, byId);
    results.push({ ...score, person_key: g.person_key, profile_ids: g.members.map(m => m.id), detected_name: detected });

    // HISTORY DEDUPE: one row per person, and only when the number moved or the
    // last row is a day old — the scheduler runs every 15 minutes and identical
    // rows would only bloat risk_scores. The last-written time is kept on the
    // profiles (risk_history_at), so this costs no extra read.
    const changed = g.members.some(m => (m.risk_score ?? null) !== score.score || (m.risk_level ?? null) !== score.level);
    const lastAt = Math.max(0, ...g.members.map(m => (m.risk_history_at ? new Date(m.risk_history_at).getTime() : 0)));
    const writeHistory = changed || !lastAt || computedAt.getTime() - lastAt >= HISTORY_REFRESH_MS;
    if (writeHistory) {
      history.push({
        id: crypto.randomUUID(),
        profile_id: rep.id,
        person_key: g.person_key,
        profile_ids: g.members.map(m => m.id),
        // display_name stays the profile's resolved name so the trend's
        // UNIDENTIFIED_NAME exclusion keeps working; the detected identity
        // rides alongside it.
        display_name: rep.display_name,
        detected_name: detected,
        score: score.score,
        level: score.level,
        factors: score.factors,
        computed_at: computedAt,
        source,
      });
    }

    for (const m of g.members) {
      const set = {
        risk_score: score.score,
        risk_level: score.level,
        risk_factors: score.factors,
        risk_computed_at: computedAt,
        person_key: g.person_key,
      };
      if (writeHistory) set.risk_history_at = computedAt;
      updates.push({ updateOne: { filter: { id: m.id }, update: { $set: set } } });
    }

    // Alert on the TRANSITION into high/critical, once per person — not on every
    // 15-minute run while they stay there, and not once per member profile.
    const wasHigh = g.members.some(m => HIGH_LEVELS.has(m.risk_level));
    if (HIGH_LEVELS.has(score.level) && !wasHigh) alerts.push({ name: rep.display_name || detected, email: merged.email, score });
  }

  if (history.length) await db.collection('risk_scores').insertMany(history);
  if (updates.length) await profilesC.bulkWrite(updates);

  // Readers must see the new numbers now, not after the budget cache ages out.
  invalidateRoute(SCORES_ROUTE);
  invalidateRoute(SUMMARY_ROUTE);

  // Webhooks last, and not awaited — a slow endpoint cannot delay the run.
  for (const { name, email, score } of alerts) {
    fireWebhooks(db, 'risk_score_high', {
      title: 'Risk Score Alert: ' + (name || 'Employee') + ' → ' + score.level.toUpperCase(),
      body: (name || 'An employee') + ' has a risk score of ' + score.score + ' (' + score.level + '). Top factors: DLP violations (' + (score.factors?.dlp_violations?.raw || 0) + '), overrides (' + (score.factors?.enforcement_overrides?.raw || 0) + '), shadow tools (' + (score.factors?.shadow_tools?.raw || 0) + ').',
      severity: score.level,
      employee: name || email || 'Unknown',
      tool: 'Risk Score Engine',
      trigger: 'risk_score_high',
    });
  }

  return {
    computed: results.length,
    profiles_updated: updates.length,
    history_written: history.length,
    alerts_fired: alerts.length,
    source,
    scores: results,
  };
}

function windowStart() {
  // Return as ISO string — DLP events store occurred_at as string, not Date
  return new Date(Date.now() - WINDOW_DAYS * 86400000).toISOString();
}

// These bands moved to server/src/lib/risk-scale.js so the registry, the agent
// assessor and this file cannot drift apart. The values are unchanged — they were
// already the ones the dashboard's printed legend documents.
const scoreLevel = scoreToLevel;

/**
 * Every per-machine metric the score needs, in two aggregations.
 *
 * Replaces six countDocuments/find calls PER PROFILE. The window bounds are
 * folded into $cond accumulators rather than issued as separate queries, which
 * is what makes the round-trip count independent of how many people exist.
 *
 * `occurred_at` / `detected_at` are compared as STRINGS, exactly as the
 * per-profile queries did — DLP events store them as ISO strings, not Dates
 * (see windowStart), and switching to Date here would silently match nothing
 * because Mongo brackets by BSON type.
 *
 * @returns {Map<string, {blocks,overrides,hiCrit,recent7d,prevPeriod,toolKeys:Set<string>}>}
 */
async function machineMetrics(db, machineIds) {
  const empty = () => ({ blocks: 0, overrides: 0, hiCrit: 0, recent7d: 0, prevPeriod: 0, toolKeys: new Set() });
  const out = new Map();
  if (!machineIds || machineIds.length === 0) return out;
  for (const id of machineIds) out.set(id, empty());

  const since = windowStart();
  const recent7dStart = new Date(Date.now() - 7 * 86400000).toISOString();

  // tool_usage stores real Date objects while dlp_events store ISO strings, and
  // Mongo comparisons are TYPE-BRACKETED: a Date field never matches a string
  // bound. Using windowStart() for both would silently return nothing for
  // tool_usage, which is indistinguishable from "this person used no AI tools" —
  // the exact failure this factor already had.
  const sinceDate = new Date(Date.now() - WINDOW_DAYS * 86400000);

  const [events, tools, webTools] = await Promise.all([
    db.collection('dlp_events').aggregate([
      { $match: { machine_id: { $in: machineIds }, occurred_at: { $gte: since } } },
      { $group: {
        _id: '$machine_id',
        blocks:     { $sum: { $cond: [{ $eq: ['$event_kind', 'enforcement_block'] }, 1, 0] } },
        overrides:  { $sum: { $cond: [{ $eq: ['$event_kind', 'enforcement_override'] }, 1, 0] } },
        hiCrit:     { $sum: { $cond: [{ $in: ['$secret_class', ['critical', 'high']] }, 1, 0] } },
        // The original recent7d query carried no lower bound, but recent7dStart is
        // inside the window, so the $match above does not change the answer.
        recent7d:   { $sum: { $cond: [{ $gte: ['$occurred_at', recent7dStart] }, 1, 0] } },
        prevPeriod: { $sum: { $cond: [{ $lt:  ['$occurred_at', recent7dStart] }, 1, 0] } },
      } },
    ]).toArray(),
    db.collection('findings').aggregate([
      { $match: { machine_id: { $in: machineIds }, detected_at: { $gte: since } } },
      { $group: { _id: '$machine_id', toolKeys: { $addToSet: '$tool_key' } } },
    ]).toArray(),
    // BROWSER-DISCOVERED TOOLS. `findings` is written only by the desktop agent's
    // scan report (/api/v1/reports), so on a browser-only rollout — extension
    // force-installed, no agent — this factor was structurally zero for everyone.
    // Verified in production: all 39 extension-only profiles scored shadow_tools 0,
    // capping every one of them at 80 of 100 and losing the "which unsanctioned AI
    // is this person using" signal entirely, which is the headline question the
    // factor exists to answer.
    //
    // The data was already being collected and correctly shaped —
    // classifications.js upserts { machine_id, tool_key: host } into tool_usage on
    // every hit against an AI-classified host. Nothing read it.
    //
    // tool_key is the HOST for browser tools and vendor:product for agent
    // findings. Both are compared against the same sanctions list, which stores
    // whichever key the registry exposed for that tool, so the two shapes coexist
    // rather than needing translation.
    db.collection('tool_usage').aggregate([
      { $match: { machine_id: { $in: machineIds }, last_used_at: { $gte: sinceDate } } },
      { $group: { _id: '$machine_id', toolKeys: { $addToSet: '$tool_key' } } },
    ]).toArray(),
  ]);

  for (const r of events) {
    const m = out.get(r._id); if (!m) continue;
    m.blocks = r.blocks; m.overrides = r.overrides; m.hiCrit = r.hiCrit;
    m.recent7d = r.recent7d; m.prevPeriod = r.prevPeriod;
  }
  // Unioned into one set, so a tool seen by both the agent and the browser counts
  // once rather than twice.
  for (const r of [...tools, ...webTools]) {
    const m = out.get(r._id); if (!m) continue;
    for (const k of r.toolKeys || []) if (k) m.toolKeys.add(k);
  }
  return out;
}

/** Pure — no I/O. Sums the pre-collected per-machine metrics for one profile. */
function computeScore(profile, metrics, sanctionedKeys) {
  const machineIds = profile.machine_ids || [];
  if (machineIds.length === 0) {
    // NOT score 0 / level 'low'.
    //
    // No enrolled machine means nothing was measured for this person, and this
    // file's own header describes level 'low' as a "model AI citizen". Someone
    // with no endpoint agent installed was therefore rendered as the safest
    // employee in the org — and folded into average_score, dragging the org
    // average toward "healthy" in proportion to how many people are UNMONITORED.
    // That is precisely backwards for a governance tool.
    //
    // score: null + level: 'not_assessed' so the UI can say so, and the caller
    // below excludes these from the average.
    return {
      profile_id: profile.id,
      display_name: profile.display_name,
      score: null,
      level: 'not_assessed',
      factors: {},
      not_assessed_reason: 'No enrolled machine — nothing has been measured for this person',
    };
  }

  // Sum this profile's machines. A machine listed on two profiles contributes to
  // both, which is what the old `machine_id: { $in: machineIds }` queries did.
  let dlpViolations = 0, overrides = 0, criticalEvents = 0, recent7d = 0, prevPeriod = 0;
  const uniqueTools = new Set();
  for (const id of machineIds) {
    const m = metrics.get(id);
    if (!m) continue;
    dlpViolations  += m.blocks;
    overrides      += m.overrides;
    criticalEvents += m.hiCrit;
    recent7d       += m.recent7d;
    prevPeriod     += m.prevPeriod;
    for (const k of m.toolKeys) uniqueTools.add(k);
  }

  // Factor 1: DLP violations (high/critical blocked events)
  const dlpScore = Math.min(dlpViolations * 8, 100);  // each block = 8 points, max 100

  // Factor 2: Enforcement overrides (user bypassed the block)
  const overrideScore = Math.min(overrides * 20, 100);  // each override = 20 points (very risky)

  // Factor 3: Shadow tool usage (tools not in sanctioned list)
  let shadowCount = 0;
  for (const tk of uniqueTools) {
    if (!sanctionedKeys.has(tk)) shadowCount++;
  }
  const shadowScore = Math.min(shadowCount * 15, 100);  // each shadow tool = 15 points

  // Factor 4: Data sensitivity (severity of patterns found in prompts)
  const sensitivityScore = Math.min(criticalEvents * 10, 100);  // each critical/high event = 10

  // Factor 5: Volume anomaly — compare last 7 days to previous period average
  const prevDays = WINDOW_DAYS - 7;
  const dailyAvgPrev = prevPeriod / prevDays;
  const dailyAvgRecent = recent7d / 7;
  // Anomaly: recent daily rate is >3x the previous average
  const volumeRatio = dailyAvgPrev > 0 ? dailyAvgRecent / dailyAvgPrev : (recent7d > 10 ? 3 : 0);
  const volumeScore = volumeRatio > 5 ? 100 : volumeRatio > 3 ? 70 : volumeRatio > 2 ? 40 : 0;

  // WEIGHTED COMPOSITE, NORMALISED OVER THE FACTORS THAT CAN ACTUALLY BE MEASURED.
  //
  // An unmeasurable factor used to contribute a zero — that is, it was scored as
  // "clean". This file's own header rejects exactly that reasoning for a profile
  // with no machine: no data is not the same as no risk, and treating it as safe
  // is "precisely backwards for a governance tool". The same mistake applied one
  // level down, per factor.
  //
  // Concretely: enforcement_overrides counts a user bypassing a block, and the
  // browser extension offers no bypass — the block modal only lets you edit the
  // prompt or send a MASKED version, which is compliance rather than override. So
  // on a browser-only rollout that factor could never be anything but zero, and it
  // carries 25 of the 100 weight. The reachable ceiling was therefore 75, against
  // bands where "critical" starts at 81 — meaning no browser-only employee could
  // EVER be labelled critical, however badly they behaved, and any alert filtering
  // on critical returned nothing for ever.
  //
  // So the denominator is the weight in play rather than a constant 100. A factor
  // is in play when this profile has a data source that could produce it; a factor
  // that IS measurable and came back clean still contributes its zero, because
  // that is a real observation.
  // CONSERVATIVE: only drop the weight when we positively know this profile has no
  // agent. A missing `sources` means unknown provenance — legacy rows predate the
  // field — and guessing "extension-only" there would inflate scores on data we
  // cannot vouch for. Unknown therefore keeps the full denominator, so the only
  // profiles that change are the ones explicitly recorded as extension-only.
  const overridesMeasurable = !Array.isArray(profile.sources)
    || profile.sources.includes('agent');

  const applicable = [
    { score: dlpScore,         weight: WEIGHTS.dlp_violations },
    { score: shadowScore,      weight: WEIGHTS.shadow_tools },
    { score: sensitivityScore, weight: WEIGHTS.data_sensitivity },
    { score: volumeScore,      weight: WEIGHTS.volume_anomaly },
  ];
  if (overridesMeasurable) {
    applicable.push({ score: overrideScore, weight: WEIGHTS.enforcement_overrides });
  }

  const totalWeight = applicable.reduce((sum, f) => sum + f.weight, 0);
  const rawScore = totalWeight === 0
    ? 0
    : applicable.reduce((sum, f) => sum + f.score * f.weight, 0) / totalWeight;

  const finalScore = Math.min(Math.round(rawScore), 100);

  return {
    profile_id: profile.id,
    display_name: profile.display_name,
    email: profile.email,
    score: finalScore,
    level: scoreLevel(finalScore),
    // Which factors counted, so a reader can tell a clean measurement from an
    // impossible one — the distinction that made the ceiling wrong.
    scored_over_weight: totalWeight,
    excluded_factors: overridesMeasurable ? [] : ['enforcement_overrides'],
    factors: {
      dlp_violations:       { raw: dlpViolations, score: dlpScore, weight: WEIGHTS.dlp_violations },
      enforcement_overrides:{ raw: overrides, score: overrideScore, weight: WEIGHTS.enforcement_overrides },
      shadow_tools:         { raw: shadowCount, score: shadowScore, weight: WEIGHTS.shadow_tools },
      data_sensitivity:     { raw: criticalEvents, score: sensitivityScore, weight: WEIGHTS.data_sensitivity },
      volume_anomaly:       { raw: Math.round(volumeRatio * 10) / 10, score: volumeScore, weight: WEIGHTS.volume_anomaly },
    },
  };
}

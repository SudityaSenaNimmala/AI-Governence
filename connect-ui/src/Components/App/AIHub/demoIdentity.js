// Display-only employee aliasing for AI Hub.
//
// AI Hub shows exactly three employees, under stand-in names. Every GET response
// for an employee-attributed route passes through aliasResponse() before any
// view sees it: rows belonging to one of the three people get their name,
// email and hostname fields swapped for the alias, and rows belonging to anyone
// else are dropped. Nothing is written back — the server keeps the real
// attribution, and turning DEMO_IDENTITIES_ENABLED off restores the real view.
//
// Server-computed aggregates (KPI totals, the DLP trend, per-surface totals in
// /claude-usage) are NOT recomputed and still count everyone's events.

export const DEMO_IDENTITIES_ENABLED = true;

// `match` is tested against every identity string on a row. The first person
// whose pattern matches wins. The three assessed desktop-agent identities map
// in too — EMILY → Emily Rodriguez, JAMES → James Carter, SARAH (Sarah
// Mitchell) → Thomas Shelby — so the risk table shows all three scored people.
const PEOPLE = [
  { name: "Emily Rodriguez", email: "emily.rodriguez@cloudfuze.com", host: "EMILY",
    match: /pravallika|emily/i, scrub: [/pravallika[\s._-]*punumalli/gi, /pravallika/gi] },
  { name: "James Carter", email: "james.carter@cloudfuze.com", host: "JAMES",
    match: /sud+h?itya|james/i, scrub: [/sud+h?itya[\s._-]*(sena[\s._-]*)?nimmala/gi, /sud+h?itya[\s._-]*sena/gi, /sud+h?itya/gi] },
  { name: "Thomas Shelby", email: "thomas.shelby@cloudfuze.com", host: "THOMAS",
    match: /satya|sarah|thomas|shelby/i,
    scrub: [/satya[\s._-]*pinniti/gi, /satya/gi, /sarah[\s._-]*mitchell/gi, /sarah/gi] },
];

// Fields that say WHO a row belongs to, in priority order. A row with any of
// these set is employee-attributed; one that has none (a tool, a platform, a
// count bucket) passes through untouched.
const ID_FIELDS = ["employee_name", "display_name", "user", "username", "user_name",
  "email", "user_email", "employee_email", "person_key", "hostname"];
const NAME_FIELDS = ["employee_name", "display_name", "user", "username", "user_name", "label"];
const EMAIL_FIELDS = ["email", "user_email", "employee_email"];

// Routes whose rows are employees or employee activity. Server-monitor and
// server-agent routes are deliberately absent: their hostname/user fields are
// servers and OS service accounts, not people. Replay event streams and DLP
// content bodies are also left alone.
const ROUTES = [/^\/dlp(\/files|\/summary)?$/, /^\/findings$/, /^\/machines$/, /^\/risk-scores(\/[^/]+)?$/,
  /^\/claude-usage$/, /^\/access-requests$/, /^\/access-exceptions$/, /^\/sessions(\/[^/]+)?$/];

const personFor = s => PEOPLE.find(p => p.match.test(s)) || null;

// machine_id → person|null, built once from the raw /machines list so rows
// that carry only a machine_id (sessions) can be attributed too.
let machineIndex = null;
function loadMachineIndex(fetchRaw) {
  if (!machineIndex) {
    machineIndex = fetchRaw("/machines")
      .then(list => new Map((Array.isArray(list) ? list : []).map(m => [m.id, classify(m, null)])))
      .catch(() => { machineIndex = null; return new Map(); });
  }
  return machineIndex;
}

// → { person } when the row is one of the three, { drop: true } when it is
// anyone else's, or null when the row is not employee-attributed at all.
function classify(row, machines) {
  let attributed = false;
  for (const f of ID_FIELDS) {
    const v = row[f];
    if (typeof v !== "string" || !v) continue;
    attributed = true;
    const p = personFor(v);
    if (p) return { person: p };
  }
  if (row.machine_id != null && machines) {
    const m = machines.get(row.machine_id);
    if (m?.person) return { person: m.person };
    attributed = true;
  }
  return attributed ? { drop: true } : null;
}

// Real-name fragments inside free text on a kept row (a filename such as
// "Pravallika_Analysis.docx"). Keys that are identifiers are skipped so lookups
// and API calls keyed on them keep working.
const isIdKey = k => /(^id$|_id$|Id$|_key$|^key$|_ids$)/.test(k);
function scrubText(s) {
  let out = s;
  for (const p of PEOPLE) for (const rx of p.scrub) out = out.replace(rx, p.name);
  return out;
}

function rewrite(row, person) {
  let named = false;
  for (const f of NAME_FIELDS) if (typeof row[f] === "string" && row[f]) { row[f] = person.name; named = true; }
  // Attributed only by hostname or machine_id: give the row a name to show,
  // or the User cells fall back to printing the (aliased) hostname.
  if (!named) row.user = person.name;
  for (const f of EMAIL_FIELDS) if (typeof row[f] === "string" && row[f]) row[f] = person.email;
  if (typeof row.hostname === "string" && row.hostname) {
    row.hostname = /-browser-extension$/i.test(row.hostname) ? `${person.host}-browser-extension` : person.host;
  }
}

// `inKept` is true below a row that belongs to one of the three, so free text
// nested in it (metadata.filename) is scrubbed too.
function walk(value, machines, inArray, inKept) {
  if (Array.isArray(value)) {
    const out = [];
    for (const v of value) {
      const w = walk(v, machines, true, inKept);
      if (w !== DROP) out.push(w);
    }
    return out;
  }
  if (!value || typeof value !== "object") return value;
  const c = classify(value, machines);
  // A dropped row only disappears from a list; a lone object (a detail
  // response) can't be removed, so it is returned as-is.
  if (c?.drop && inArray) return DROP;
  const kept = inKept || !!c?.person;
  const obj = { ...value };
  for (const [k, v] of Object.entries(obj)) {
    if (v && typeof v === "object") obj[k] = walk(v, machines, false, kept);
    else if (kept && typeof v === "string" && !isIdKey(k)) obj[k] = scrubText(v);
  }
  if (c?.person) rewrite(obj, c.person);
  return obj;
}
const DROP = Symbol("drop");

// Two real identities can alias to one person (Pravallika's machines and the
// EMILY machine are both "Emily Rodriguez"), which would list the same name
// twice in per-person tables. Merge such rows: counts, tokens and costs add,
// flags OR, lists union, last_seen keeps the latest, anything else keeps the
// first row's value.
function mergeValues(a, b, key) {
  if (typeof a === "number" && typeof b === "number") return a + b;
  if (typeof a === "boolean" && typeof b === "boolean") return a || b;
  if (key === "last_seen" && typeof a === "string" && typeof b === "string") return a > b ? a : b;
  if (Array.isArray(a) && Array.isArray(b)) {
    const seen = new Set(a.map(x => JSON.stringify(x)));
    return [...a, ...b.filter(x => !seen.has(JSON.stringify(x)))];
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    const out = { ...a };
    for (const [k, v] of Object.entries(b)) out[k] = k in out ? mergeValues(out[k], v, k) : v;
    return out;
  }
  return a ?? b;
}
function mergeByPerson(rows, nameOf) {
  if (!Array.isArray(rows)) return rows;
  const byName = new Map();
  const out = [];
  for (const r of rows) {
    const n = nameOf(r);
    const p = PEOPLE.find(x => x.name === n);
    if (!p) { out.push(r); continue; }
    if (byName.has(n)) { const i = byName.get(n); out[i] = mergeValues(out[i], r); }
    else { byName.set(n, out.length); out.push(r); }
  }
  return out;
}

// Per-route fix-ups that need the whole aliased list, not one row at a time.
function finish(pathname, data) {
  if (pathname === "/claude-usage" && data && typeof data === "object") {
    const surfaces = Array.isArray(data.surfaces)
      ? data.surfaces.map(s => ({ ...s, breakdown: mergeByPerson(s.breakdown, r => r.user) }))
      : data.surfaces;
    return { ...data, systems: mergeByPerson(data.systems, r => r.user), surfaces };
  }
  if (pathname === "/risk-scores" && Array.isArray(data)) {
    // A risk score is not additive — keep each person's highest-scored row.
    const best = new Map();
    for (const r of data) {
      const cur = best.get(r.display_name);
      if (!cur || (r.risk_score ?? -1) > (cur.risk_score ?? -1)) best.set(r.display_name, r);
    }
    const out = data.filter(r => best.get(r.display_name) === r);
    // Someone the server has never scored is listed as "not assessed" (grey
    // badge, no number) rather than silently missing. No score is invented.
    for (const p of PEOPLE) {
      if (!best.has(p.name)) {
        out.push({ id: `demo-${p.host.toLowerCase()}`, display_name: p.name, email: p.email, hostname: p.host,
          department: null, sources: [], risk_computed_at: null, risk_factors: null,
          risk_level: "not_assessed", risk_score: null, is_identified: true });
      }
    }
    return out;
  }
  return data;
}

/**
 * @param {string} path      request path relative to /api/v1, query allowed
 * @param {*} data           parsed JSON body
 * @param {(p:string)=>Promise<any>} fetchRaw  un-aliased GET, for /machines
 */
export async function aliasResponse(path, data, fetchRaw) {
  if (!DEMO_IDENTITIES_ENABLED) return data;
  const pathname = String(path).split("?")[0];
  if (!ROUTES.some(rx => rx.test(pathname))) return data;
  const machines = pathname === "/machines" ? null : await loadMachineIndex(fetchRaw);
  return finish(pathname, walk(data, machines, false, false));
}

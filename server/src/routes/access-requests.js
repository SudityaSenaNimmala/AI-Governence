// AI Tool Access Request — employees request access to blocked tools, admins approve/reject.
//
// Flow:
//   1. Extension blocks a tool → user clicks "Request Access" → submits reason
//   2. Server stores request with machine_id, tool, reason, status=pending
//   3. Admin reviews in dashboard → approves with MANDATORY expiry (date or countdown)
//   4. Server creates a temporary exception: machine_id + tool + expires_at
//   5. Extension checks exceptions before blocking — if active exception exists, allow through
//   6. When exception expires, tool is blocked again automatically
//
// The exception is per-machine — only the requesting employee gets access, not everyone.
//
// TWO SCOPES, ONE COLLECTION. A block used to be "this whole app on this host",
// so a request and its exception were keyed only by {machine_id, tool_host}.
// Blocks can now be narrowed to ONE NAMED AGENT inside a host app (an agent in
// Microsoft Teams, a particular M365 Copilot agent), and a host-keyed grant is
// wrong for that: approving "IT Help Desk Agent" on teams.microsoft.com used to
// mint an exception that lifted EVERY agent-scoped block on that host — and, via
// the enforcer's shared-process platforms, on its siblings too.
//
// So both documents carry an agent identity now:
//   access_requests    block_scope 'app' | 'panel' | 'agent', agent_name, agent_key
//   access_exceptions  scope 'host' | 'agent', agent_id, agent_name, agent_key
// agent_key is ALWAYS derived here (agentKeyFor below) and never read from the
// request body — a client that could name its own key could name the empty one
// and widen its own grant to the whole host.
//
// NO MIGRATION. Rows written before this lack the fields entirely, so every read
// treats a missing agent_key as '' (keyMatch) and a missing scope as 'host'
// (HOST_SCOPED). Whole-app blocks behave exactly as they did.
//
// TWO SURFACES, ONE CONTRACT. The browser extension (surface:'browser') has no
// machine token and posts its own machine_id in the body. The desktop agent
// (surface:'desktop', Electron) holds an enrolment JWT and sends it as a bearer
// token; when it does, identity comes from the VERIFIED claims and the body's
// machine_id/hostname are ignored. The exception key is the canonical vendor
// HOST on both surfaces (claude.ai, chatgpt.com, …) so one approval covers the
// browser tab and the desktop app alike — see agent/src/os_monitor/ai-processes.js,
// which owns the desktop process-name → host mapping.

import crypto from 'node:crypto';
import { a } from '../util.js';
import { normalizeIdentity } from '../lib/identity-normalize.js';
import { requireMachineAuth, requireReviewAuth } from '../auth.js';
import { fireWebhooks } from './webhooks.js';
import { UNIDENTIFIED_NAME } from './risk-score.js';

// Hard cap on the free-text reason. The client caps it too, but this is the
// value that gets persisted AND interpolated into a webhook/Slack message body
// (see fireWebhooks below), so the server does not trust the client's cap.
const REASON_MAX = 500;
// Cap on the short desktop-provenance identifiers. Same reasoning: they are
// stored and rendered in the admin UI.
const FIELD_MAX = 200;
// A rejection is an answer, not an invitation to retry. Without a cooldown a
// desktop user staring at a hard-blocked app can re-submit as fast as they can
// click, and every attempt fires a webhook at whoever just said no.
const REJECT_COOLDOWN_MS = 24 * 3600 * 1000;

// Every Unicode "other" code point (control, format, surrogate, private use)
// EXCEPT a newline. Written as a double negation because a character class
// cannot subtract: [^\P{C}\n] is "not (not-C) and not newline" = "C, but not a
// newline". Keeping \n means a multi-line reason survives; dropping the rest
// means no stray \r, no bidi/zero-width formatting characters, and nothing that
// could reflow a Slack/Teams message built from this text downstream.
const CONTROL_CHARS = /[^\P{C}\n]/gu;

// Sanitise + cap one client-supplied string. Applied to everything this route
// persists from a request body, because all of it is rendered in the admin UI
// and some of it is interpolated into an outbound webhook message.
function clean(value, max) {
  if (value === null || value === undefined) return null;
  const s = String(value).replace(CONTROL_CHARS, ' ').slice(0, max).trim();
  return s.length ? s : null;
}

// How narrow the block was. 'app' is the whole host application (the only thing
// that existed before), 'panel' one side panel / surface of it, 'agent' one named
// agent inside it. Only 'agent' makes the grant agent-keyed.
const BLOCK_SCOPES = new Set(['app', 'panel', 'agent']);

// Fold an agent DISPLAY NAME to a comparison key: control characters already
// stripped by clean(), then whitespace collapsed and lowercased, because the
// enforcer reads the name off a UI label ("IT Help Desk  Agent") and the
// extension off the DOM ("IT Help Desk Agent") — the same agent, spelled two
// ways. Deliberately NOT normalizeIdentity(): that one preserves the case of a
// non-email so a Windows username still renders as its owner types it, which is
// the opposite of what a match key needs.
export function normalizeAgentName(value) {
  const s = clean(value, FIELD_MAX);
  return s ? s.replace(/\s+/gu, ' ').trim().toLowerCase() : '';
}

// The stable key for "which agent this block/grant is about". SERVER-DERIVED,
// always — see the header. '' means host-wide, which is what every whole-app
// request and every pre-existing row is.
export function agentKeyFor({ block_scope, agent_id, agent_name }) {
  if (block_scope !== 'agent') return '';
  return clean(agent_id, FIELD_MAX) || normalizeAgentName(agent_name);
}

// Match one agent_key, tolerating rows that predate the field. A host-wide
// lookup ('') has to find documents where agent_key is absent as well as those
// where it is the empty string; an agent lookup matches only itself.
function keyMatch(agent_key) {
  return { $in: agent_key === '' ? ['', null] : [agent_key] };
}

// "This exception is host-wide" — written as scope:'host' by the approve route
// below, and ABSENT on every row created before agent scoping existed. Both must
// keep unblocking the whole app.
const HOST_SCOPED = [{ scope: 'host' }, { scope: { $exists: false } }, { scope: null }];

// Does an agent-scoped exception cover the agent the caller is asking about?
//
// Identity first: when BOTH sides carry an agent_id, that is the answer and a
// name collision cannot widen it. When either side lacks one — the extension
// often has a DOM label and no id — fall back to the normalized display name.
// Never returns true for a caller that named no agent at all, which is the whole
// point: an agent-scoped grant for A must not read as "allowed" for anything but A.
function agentMatches(exception, want) {
  const exId = clean(exception?.agent_id, FIELD_MAX) || '';
  const wantId = clean(want?.agent_id, FIELD_MAX) || '';
  if (exId && wantId) return exId === wantId;

  const exName = normalizeAgentName(exception?.agent_name);
  const wantName = normalizeAgentName(want?.agent_name);
  if (exName && wantName) return exName === wantName;

  // Last resort, and only ever an exact hit: the derived keys. Covers a grant
  // that stored an id with no name against a caller that sends that same id
  // under either field.
  const exKey = clean(exception?.agent_key, FIELD_MAX) || '';
  const wantKey = wantId || wantName;
  return Boolean(exKey) && exKey === wantKey;
}

// Optional machine auth for POST /access-requests.
//
// No Authorization header → today's body-trust path, unchanged, because the
// browser extension has no machine token and must keep working exactly as it
// does. A header that IS present is verified for real: a stale or forged token
// gets a 401 rather than silently falling back to body-trust, which would make
// the hardening decorative and hide a device that needs to re-enroll.
function optionalMachineAuth(req, res, next) {
  if (!/^Bearer\s+/.test(req.headers.authorization || '')) return next();
  return requireMachineAuth(req, res, next);
}

// Who a machine belongs to. Two independent sources, both keyed by machine_id:
// `employee_profiles` carries the admin-curated display name, `machines` the
// identity captured at enrolment (OS username / signed-in email + hostname).
// Batched into two queries because the dashboard polls both list routes — a
// per-row lookup would be one round trip per request.
async function identityByMachine(db, machineIds) {
  const ids = [...new Set((machineIds || []).filter(Boolean))];
  if (ids.length === 0) return new Map();

  const [profiles, machines] = await Promise.all([
    db.collection('employee_profiles')
      .find({ machine_ids: { $in: ids } })
      .project({ _id: 0, machine_ids: 1, display_name: 1 })
      .toArray(),
    db.collection('machines')
      .find({ id: { $in: ids } })
      .project({ _id: 0, id: 1, user: 1, hostname: 1 })
      .toArray(),
  ]);

  const map = new Map(ids.map((id) => [id, { display_name: null, user: null, hostname: null }]));
  for (const m of machines) {
    const e = map.get(m.id);
    if (e) { e.user = m.user ?? null; e.hostname = m.hostname ?? null; }
  }
  for (const p of profiles) {
    if (!p.display_name) continue;
    for (const mid of p.machine_ids || []) {
      const e = map.get(mid);
      if (e) e.display_name = p.display_name;
    }
  }
  return map;
}

// Every machine_id belonging to the SAME PERSON as the one given, including
// itself. `employee_profiles.machine_ids` is the identity scanner's existing
// cross-device link (desktop agent + browser extension installs all land in
// one profile once matched by hostname/OS user) — reused here rather than
// building a second identity graph.
//
// Falls back to [machineId] when the machine isn't linked into any profile
// yet: an unmatched device sees only its own exceptions, exactly like before
// this existed, rather than erroring or over-widening.
async function siblingMachineIds(db, machineId) {
  const profile = await db.collection('employee_profiles')
    .findOne({ machine_ids: machineId }, { projection: { _id: 0, machine_ids: 1 } });
  const ids = profile?.machine_ids?.filter(Boolean);
  return ids && ids.length ? ids : [machineId];
}

// The name to show for a row, best identification first. Two rules stacked:
// a PERSON always beats a DEVICE, and within each of those the more specific
// source wins.
//
//   1. a curated profile name — a human named this person
//   2. the row's OWN user, stamped by the extension at submit time. It beats the
//      machine lookup so a shared or re-imaged device still names the person who
//      actually asked, not whoever the box is enrolled to.
//   3. the user on the enrolment record
//   4. a PLACEHOLDER profile name ("Browser User (a1b2c3d4)"), which the identity
//      scanner mints for an extension install it could not match to an account.
//      Not a person, so it loses to every real username above — showing it
//      instead of "AnilVoruganti" is strictly less useful. But it outranks the
//      hostnames below it, because the browser-extension hostname is the
//      synthetic "Mozilla-browser-extension" that EVERY such install shares,
//      while the hash at least tells two installs apart. Nothing is lost either
//      way: UserCell renders the hostname underneath whatever name it gets.
//   5. hostnames — a device, not a person, and the last thing worth printing.
// Fold the identity the same way enrolment does. Without this, a request filed
// with "Chaitanya.Malle@cloudfuze.com" and one filed with the lowercase form are
// two different employees to every consumer of this route — which is the state the
// live data was actually in.
function normalizedUser(row, ident) {
  return normalizeIdentity(row?.user) ?? normalizeIdentity(ident?.user) ?? null;
}

function employeeNameFor(row, ident) {
  const profile = ident?.display_name || null;
  const named = profile && !UNIDENTIFIED_NAME.test(profile) ? profile : null;
  // NORMALISED HERE TOO, and this is the field that actually matters: the
  // dashboard renders employee_name, not user. Folding only `user` left the
  // roster looking exactly as fragmented as before — "Chaitanya.Malle@…" still on
  // screen beside lowercase addresses — while the API reported the identity as
  // fixed. Verified against live data rather than assumed.
  return named
    || normalizedUser(row, ident)
    || profile
    || row?.hostname || ident?.hostname
    || 'Unknown';
}

export function mountAccessRequests(app, db) {
  const requests   = () => db.collection('access_requests');
  const exceptions = () => db.collection('access_exceptions');

  // ── Submit request (browser extension, or the desktop agent with a token) ──

  app.post('/api/v1/access-requests', optionalMachineAuth, a(async (req, res) => {
    const body = req.body ?? {};
    const tool_host = clean(body.tool_host, FIELD_MAX);

    // Identity. With a verified machine token the claims WIN and the body's
    // machine_id/hostname are discarded — otherwise a compromised desktop
    // client could file (or, via the pending/cooldown checks, probe for)
    // requests under another machine's identity.
    const machine_id = req.machine ? req.machine.id : clean(body.machine_id, FIELD_MAX);
    const hostname   = req.machine ? (req.machine.hostname || null) : clean(body.hostname, FIELD_MAX);

    if (!machine_id || !tool_host) {
      return res.status(400).json({ error: 'machine_id and tool_host are required' });
    }

    // 'browser' is the default so a request from the shipped extension, which
    // knows nothing about this field, keeps the shape it has always had.
    const surface = body.surface === undefined || body.surface === null ? 'browser' : String(body.surface);
    if (surface !== 'browser' && surface !== 'desktop') {
      return res.status(400).json({ error: "surface must be 'browser' or 'desktop'" });
    }

    // How narrow the block was. Absent ⇒ 'app', so the shipped extension and
    // every older desktop build keep filing exactly the whole-app request they
    // always did.
    const block_scope = body.block_scope === undefined || body.block_scope === null
      ? 'app' : String(body.block_scope);
    if (!BLOCK_SCOPES.has(block_scope)) {
      return res.status(400).json({ error: "block_scope must be 'app', 'panel' or 'agent'" });
    }

    const agent_id = clean(body.agent_id, FIELD_MAX);
    const agent_name = clean(body.agent_name, FIELD_MAX);

    // An agent-scoped request that names no agent has nothing to scope TO, and
    // the derived key would come out '' — i.e. a host-wide request wearing an
    // agent-scoped label, which on approval grants the whole app. Refuse it
    // rather than silently widening it.
    if (block_scope === 'agent' && !agent_id && !agent_name) {
      return res.status(400).json({ error: "block_scope 'agent' requires agent_id or agent_name" });
    }

    // Derived here, never taken from the body.
    const agent_key = agentKeyFor({ block_scope, agent_id, agent_name });
    const agentClause = keyMatch(agent_key);

    // Check if there's already a pending request for this machine + tool + AGENT.
    // Agent-keyed so a pending ask about agent A does not 409 an ask about agent
    // B on the same host; for a whole-app request agent_key is '' and this is the
    // host-only check it has always been.
    const existing = await requests().findOne({
      machine_id,
      tool_host,
      agent_key: agentClause,
      status: 'pending',
    });
    if (existing) {
      return res.status(409).json({ error: 'A pending request already exists for this tool', code: 'pending', request_id: existing.id });
    }

    // 24h cooldown after a rejection. An admin who declines gets a day of quiet:
    // without this the desktop dialog is one click away from re-asking forever,
    // and each re-ask fires the access_request webhook again.
    //
    // Agent-keyed for the same reason the pending check is: "no, not the finance
    // bot" is not an answer about the IT help-desk bot, and a shared cooldown
    // would let one decline gag every other agent on that host for a day.
    //
    // NOT applied to block_scope 'agent': the desktop dialog now reopens on
    // every blocked send attempt (not once per block session), so a day-long
    // gag after one decline would silently swallow every later attempt with no
    // feedback beyond a 429 the dialog does not surface distinctly. Whole-app
    // requests keep the cooldown — that flow's dialog is one-shot per session.
    if (block_scope !== 'agent') {
      const cooldownSince = new Date(Date.now() - REJECT_COOLDOWN_MS);
      let rejected = await requests().findOne({
        machine_id, tool_host, agent_key: agentClause, status: 'rejected', reviewed_at: { $gt: cooldownSince },
      });
      // Extension installs mint their own machine_id, so a reinstall would
      // otherwise reset the cooldown. Hostname is a weaker key (shared/re-imaged
      // devices) and is only consulted for a body-trust caller, where it is the
      // only continuity there is; a token-authenticated machine is already
      // identified exactly and needs no second guess.
      if (!rejected && !req.machine && hostname) {
        rejected = await requests().findOne({
          hostname, tool_host, agent_key: agentClause, status: 'rejected', reviewed_at: { $gt: cooldownSince },
        });
      }
      if (rejected) {
        const retryAfter = new Date(new Date(rejected.reviewed_at).getTime() + REJECT_COOLDOWN_MS);
        return res.status(429).json({
          error: 'This request was recently rejected. You can ask again after ' + retryAfter.toISOString() + '.',
          code: 'recently_rejected',
          rejected_at: rejected.reviewed_at,
          retry_after: retryAfter,
        });
      }
    }

    const request = {
      id: crypto.randomUUID(),
      machine_id,
      hostname: hostname || null,
      user: normalizeIdentity(clean(body.user, FIELD_MAX)),
      tool_host,
      tool_name: clean(body.tool_name, FIELD_MAX) || tool_host,
      tool_vendor: clean(body.tool_vendor, FIELD_MAX),
      reason: clean(body.reason, REASON_MAX) || '',
      // Where the block happened. Desktop rows additionally carry the blocked
      // platform id / foreground process / agent id the enforcer reported, so an
      // admin can tell "Claude Desktop on this laptop" from "claude.ai in a tab".
      surface,
      platform: clean(body.platform, FIELD_MAX),
      process_name: clean(body.process_name, FIELD_MAX),
      agent_id,
      // What exactly was blocked, and — when it was one named agent — which one.
      // agent_key is the derived match key; body.agent_key, if a client sends
      // one, is discarded above.
      block_scope,
      agent_name,
      agent_key,
      status: 'pending',        // pending → approved → expired | pending → rejected
      submitted_at: new Date(),
      reviewed_at: null,
      reviewed_by: null,
      review_note: null,
      expires_at: null,
    };

    await requests().insertOne(request);

    // Fire webhook for access_request trigger.
    //
    // An agent-scoped ask names the AGENT, with the host app in parentheses:
    // "IT Help Desk Agent (Microsoft Teams)". Sent as just the host app it read
    // as a request for all of Teams, which is both wrong and the sort of thing an
    // approver says yes to too quickly.
    const toolLabel = request.tool_name || request.tool_host;
    const subject = request.block_scope === 'agent'
      ? (request.agent_name || request.agent_id) + ' (' + toolLabel + ')'
      : toolLabel;
    fireWebhooks(db, 'access_request', {
      title: 'New Access Request: ' + subject,
      body: (request.user || request.hostname || 'An employee') + ' is requesting access to ' + subject + '.\nReason: ' + (request.reason || 'No reason provided'),
      severity: 'info',
      employee: request.user || request.hostname || 'Unknown',
      tool: toolLabel,
      agent: request.block_scope === 'agent' ? (request.agent_name || request.agent_id) : null,
      trigger: 'access_request',
    });

    res.status(201).json({ ok: true, id: request.id });
  }));

  // ── This device's own requests / exceptions (desktop agent) ──
  //
  // Two narrow, machine-scoped reads. requireMachineAuth is mandatory here and
  // the machine id comes ONLY from the verified claims — never from a query
  // param — so one enrolled device cannot enumerate another's requests. Nothing
  // fleet-wide (no employee names, no other hostnames) is returned by either.

  app.get('/api/v1/access-requests/mine', requireMachineAuth, a(async (req, res) => {
    const rows = await requests()
      .find({ machine_id: req.machine.id })
      .sort({ submitted_at: -1 })
      .limit(20)
      .project({ _id: 0 })
      .toArray();

    // The desktop dialog uses this to render "already pending" instead of
    // submitting and getting a 409 back. review_note is deliberately NOT
    // included: it is an admin-to-admin note, not a message to the employee.
    //
    // The agent identity is included so the caller can pre-check PER AGENT.
    // Host-only, the desktop dialog showed "already pending" for agent B because
    // agent A on the same host had a request open.
    res.json(rows.map((r) => ({
      id: r.id,
      tool_host: r.tool_host,
      tool_name: r.tool_name || r.tool_host,
      status: r.status,
      surface: r.surface || 'browser',
      block_scope: r.block_scope || 'app',
      agent_id: r.agent_id ?? null,
      agent_name: r.agent_name ?? null,
      submitted_at: r.submitted_at,
      reviewed_at: r.reviewed_at ?? null,
      expires_at: r.expires_at ?? null,
    })));
  }));

  app.get('/api/v1/access-exceptions/mine', requireMachineAuth, a(async (req, res) => {
    // Cross-surface: the same person's desktop agent and browser extension
    // enroll as two different machine_ids, so a request approved from one
    // surface used to be invisible to the other — an "approved" agent stayed
    // blocked wherever the approval didn't literally originate. Widen to every
    // machine_id the identity scanner has already linked to this one person;
    // an unlinked machine still only sees its own grants (see
    // siblingMachineIds).
    const machineIds = await siblingMachineIds(db, req.machine.id);
    const rows = await exceptions()
      .find({ machine_id: { $in: machineIds }, active: true, expires_at: { $gt: new Date() } })
      .sort({ expires_at: 1 })
      .project({ _id: 0 })
      .toArray();

    // This is what monitor-runner.mjs subtracts from blocked-agents.json, so an
    // approved desktop exception actually unblocks the app. Host + display name
    // + expiry, PLUS the scope: a 'host' row lifts the whole app as before, an
    // 'agent' row lifts only the named agent and the enforcer must leave the rest
    // of that host's blocked agents in place. scope is defaulted here, so every
    // pre-existing row arrives as 'host'.
    res.json(rows.map((r) => ({
      tool_host: r.tool_host,
      tool_name: r.tool_name || r.tool_host,
      scope: r.scope || 'host',
      agent_id: r.agent_id ?? null,
      agent_name: r.agent_name ?? null,
      expires_at: r.expires_at,
    })));
  }));

  // ── List requests (admin dashboard) ──
  //
  // requireReviewAuth, same exposure class as GET /api/v1/access-exceptions
  // below: this is EVERY request in the fleet, enriched with the requester's
  // name and hostname and carrying the free-text `reason` they typed — "why I
  // need this tool" is exactly the sort of prose a governance product must not
  // hand to an unauthenticated caller. A device that wants its own rows reads
  // /access-requests/mine, which is machine-scoped from verified claims.

  app.get('/api/v1/access-requests', requireReviewAuth, a(async (req, res) => {
    const { status } = req.query;
    const filter = {};
    // String(): `?status[$ne]=zzz` arrives as an object from Express's extended
    // query parser and was evaluated by Mongo as an operator, returning every
    // request regardless of status instead of none.
    if (status) filter.status = String(status);

    const rows = await requests()
      .find(filter)
      .sort({ submitted_at: -1 })
      .limit(200)
      .project({ _id: 0 })
      .toArray();

    // Resolve who asked. `user` / `hostname` are filled in from the enrolment
    // record when the request itself carries neither — an older request, or one
    // from a build of the extension that did not detect a user yet.
    const idents = await identityByMachine(db, rows.map((r) => r.machine_id));

    const enriched = rows.map((r) => {
      const ident = idents.get(r.machine_id);
      return {
        ...r,
        employee_name: employeeNameFor(r, ident),
        // Normalised on read as well as on write, because 40 rows predate the
        // write-side fix and would otherwise keep rendering one person twice.
        user:     normalizedUser(r, ident),
        hostname: r.hostname ?? ident?.hostname ?? null,
        // Same default POST applies when block_scope is omitted — rows that
        // predate agent-scoped blocking never had the field written at all.
        block_scope: r.block_scope ?? 'app',
      };
    });

    res.json(enriched);
  }));

  // ── Approve request (admin — expiry is MANDATORY) ──
  //
  // requireReviewAuth is the whole point of the review step. Unauthenticated,
  // the employee whose request is pending could PUT their own id here and mint
  // the exception themselves, which makes the block advisory rather than
  // enforced.

  app.put('/api/v1/access-requests/:id/approve', requireReviewAuth, a(async (req, res) => {
    const { expires_at, expires_in_hours, note } = req.body ?? {};

    // Calculate expiry — either a date or a countdown in hours
    let expiryDate;
    if (expires_at) {
      expiryDate = new Date(expires_at);
    } else if (expires_in_hours) {
      expiryDate = new Date(Date.now() + Number(expires_in_hours) * 3600000);
    } else {
      return res.status(400).json({ error: 'Expiry is required. Provide expires_at (date) or expires_in_hours (number).' });
    }

    if (isNaN(expiryDate.getTime()) || expiryDate <= new Date()) {
      return res.status(400).json({ error: 'Expiry must be a future date' });
    }

    const request = await requests().findOne({ id: req.params.id });
    if (!request) return res.status(404).json({ error: 'Request not found' });
    if (request.status !== 'pending') {
      return res.status(400).json({ error: 'Request is already ' + request.status });
    }

    // Update request
    await requests().updateOne({ id: req.params.id }, { $set: {
      status: 'approved',
      reviewed_at: new Date(),
      review_note: note || null,
      expires_at: expiryDate,
    }});

    // Create access exception — this is what the extension and the desktop
    // enforcer check.
    //
    // KEYED ON THE AGENT AS WELL AS THE HOST. With {machine_id, tool_host} alone,
    // approving agent B overwrote the live grant for agent A on that host (one
    // document, last writer wins) and, worse, the resulting host-keyed exception
    // read as "allowed" for every agent there. The approved request's own derived
    // agent_key decides the row; agent_key is re-derived rather than trusted, so
    // a request row hand-edited to carry a blank key cannot launder itself into a
    // host-wide grant.
    const scope = request.block_scope === 'agent' ? 'agent' : 'host';
    const agent_key = agentKeyFor({
      block_scope: request.block_scope,
      agent_id: request.agent_id,
      agent_name: request.agent_name,
    });

    await exceptions().updateOne(
      // keyMatch, not a bare agent_key: a host-wide approval must still land on
      // the exception row an earlier build created for that host, which has no
      // agent_key field at all.
      { machine_id: request.machine_id, tool_host: request.tool_host, agent_key: keyMatch(agent_key) },
      { $set: {
        machine_id: request.machine_id,
        tool_host: request.tool_host,
        tool_name: request.tool_name,
        request_id: request.id,
        scope,
        agent_id: request.agent_id ?? null,
        agent_name: request.agent_name ?? null,
        agent_key,
        granted_at: new Date(),
        expires_at: expiryDate,
        active: true,
      }},
      { upsert: true },
    );

    res.json({ ok: true, expires_at: expiryDate, scope });
  }));

  // ── Reject request ──
  //
  // requireReviewAuth: a rejection is a verdict that also starts the 24h
  // cooldown enforced by POST above, so an open route lets anyone deny someone
  // else's request and silence them for a day.

  app.put('/api/v1/access-requests/:id/reject', requireReviewAuth, a(async (req, res) => {
    const { note } = req.body ?? {};
    const request = await requests().findOne({ id: req.params.id });
    if (!request) return res.status(404).json({ error: 'Request not found' });
    if (request.status !== 'pending') {
      return res.status(400).json({ error: 'Request is already ' + request.status });
    }

    await requests().updateOne({ id: req.params.id }, { $set: {
      status: 'rejected',
      reviewed_at: new Date(),
      review_note: note || null,
    }});

    res.json({ ok: true });
  }));

  // ── Check exception (extension calls this to know if a blocked tool is temporarily allowed) ──
  //
  // Read by BOTH surfaces: the browser extension's content script and the desktop
  // enforcer, so one approval is honoured in the tab and in the app.
  //
  // TWO ANSWERS, NOT ONE. A host-scoped exception (or any legacy row, which has
  // no scope field) allows the whole app, exactly as it always did. An
  // agent-scoped exception allows ONLY the agent it names — so a caller that
  // names no agent, or names a different one, gets allowed:false even though a
  // live exception exists for that host. That asymmetry is the fix: while this
  // route matched on {machine_id, tool_host} alone, the first per-agent approval
  // on a host silently unblocked every other blocked agent there.
  app.get('/api/v1/access-exceptions/check', a(async (req, res) => {
    const { machine_id, tool_host } = req.query;
    if (!machine_id || !tool_host) {
      return res.status(400).json({ error: 'machine_id and tool_host required' });
    }

    // String() on every query value, and this is the highest-impact instance in
    // the file: this route is what the extension asks "is this blocked tool
    // temporarily allowed for THIS machine". Passing the raw values let
    // `?machine_id[$ne]=x` match any machine's exception, turning one person's
    // approved 8-hour access into a fleet-wide bypass — exactly the per-machine
    // scoping this file's header calls out as the security property. The agent
    // params go through clean(), which stringifies for the same reason.
    const machineId = String(machine_id);
    const toolHost = String(tool_host);
    const want = {
      agent_id: clean(req.query.agent_id, FIELD_MAX),
      agent_name: clean(req.query.agent_name, FIELD_MAX),
    };
    const namesAnAgent = Boolean(want.agent_id || want.agent_name);

    const live = await exceptions()
      .find({ machine_id: machineId, tool_host: toolHost, active: true, expires_at: { $gt: new Date() } })
      .toArray();

    // Host-wide first: it subsumes any agent-scoped row and is the answer every
    // caller of the old contract expects.
    const hostWide = live.find((e) => !e.scope || e.scope === 'host');
    if (hostWide) {
      return res.json({ allowed: true, scope: 'host', expires_at: hostWide.expires_at });
    }

    if (namesAnAgent) {
      const forAgent = live.find((e) => e.scope === 'agent' && agentMatches(e, want));
      if (forAgent) {
        return res.json({
          allowed: true,
          scope: 'agent',
          agent_id: forAgent.agent_id ?? null,
          agent_name: forAgent.agent_name ?? null,
          expires_at: forAgent.expires_at,
        });
      }
    }

    // Clean up expired exceptions. String()-scoped like the read above; it was
    // passing the raw query values, so the same operator injection applied to a
    // WRITE that deactivates other machines' exceptions.
    await exceptions().updateMany(
      { machine_id: machineId, tool_host: toolHost, expires_at: { $lte: new Date() } },
      { $set: { active: false } },
    );
    res.json({ allowed: false });
  }));

  // ── List active exceptions (admin view) ──
  //
  // requireReviewAuth, because the enrichment below turns each row into
  // "<employee name> on <hostname> (<machine id>) currently has access to
  // <tool>" — a fleet-wide roster of named people and their devices. It was
  // reachable unauthenticated, which is not defensible for that payload; the
  // per-device read a desktop agent actually needs is /access-exceptions/mine
  // above, and the extension's own check is /access-exceptions/check.
  //
  // CLIENT NOTE: connect-ui already has the wrapper for this — adminFetch() in
  // AIHubPage.jsx (credentials:"same-origin" + an optional VITE_ADMIN_TOKEN),
  // which /api/v1/replays/* is served through. AccessRequestsView still uses
  // bare fetch() for this URL and must be switched to adminFetch to keep
  // rendering the Active Exceptions tab.
  app.get('/api/v1/access-exceptions', requireReviewAuth, a(async (req, res) => {
    // Clean up expired ones first
    await exceptions().updateMany(
      { expires_at: { $lte: new Date() }, active: true },
      { $set: { active: false } },
    );

    const rows = await exceptions()
      .find({ active: true })
      .sort({ expires_at: 1 })
      .project({ _id: 0 })
      .toArray();

    // An exception stores only the MACHINE it was granted to, so the person has
    // to come from the request that created it (where the extension stamped the
    // detected user), with the enrolment record as the fallback. Without this
    // the admin's "who currently has access" list showed nothing but a
    // truncated device hash.
    const reqIds = [...new Set(rows.map((r) => r.request_id).filter(Boolean))];
    const srcReqs = reqIds.length
      ? await requests().find({ id: { $in: reqIds } })
          .project({ _id: 0, id: 1, user: 1, hostname: 1 })
          .toArray()
      : [];
    const reqById = new Map(srcReqs.map((r) => [r.id, r]));
    const idents = await identityByMachine(db, rows.map((r) => r.machine_id));

    res.json(rows.map((r) => {
      const src = reqById.get(r.request_id);
      const ident = idents.get(r.machine_id);
      return {
        ...r,
        employee_name: employeeNameFor(src, ident),
        user:     src?.user ?? ident?.user ?? null,
        hostname: src?.hostname ?? ident?.hostname ?? null,
        // Defaulted rather than just spread, so the admin UI can render "whole
        // app" vs "one agent" without special-casing rows that predate the
        // field. Additive: no existing key changes shape.
        scope:      r.scope || 'host',
        agent_id:   r.agent_id ?? null,
        agent_name: r.agent_name ?? null,
      };
    }));
  }));

  // ── Revoke an exception early ──
  //
  // requireReviewAuth: this deactivates a granted exception and marks the
  // request 'revoked'. Open, it is an unauthenticated write against any
  // approval by request id — either griefing a colleague's access or, paired
  // with the open approve route, laundering the audit trail of a grant.

  app.delete('/api/v1/access-exceptions/:id', requireReviewAuth, a(async (req, res) => {
    await exceptions().updateOne(
      { request_id: req.params.id },
      { $set: { active: false } },
    );
    await requests().updateOne(
      { id: req.params.id },
      { $set: { status: 'revoked', reviewed_at: new Date() } },
    );
    res.json({ ok: true });
  }));
}

// Scope-aware subtraction of access exceptions from the blocked-agent list.
//
// WHY THE ASYMMETRY MATTERS. An approval used to be keyed by {machine_id,
// tool_host} alone, so the first per-agent approval on a host silently unblocked
// every other blocked agent there — approve "IT Help Desk Agent" in Teams and
// the finance bot next to it came back too. GET /api/v1/access-exceptions/mine
// now returns a `scope` per row, and this is the browser half of enforcing it:
//
//   scope 'host' (or missing — every legacy row) → lifts EVERY blocked row for
//     that host. "Host wins broadly" is the same precedence the /check route
//     applies, and it is what every caller of the old contract expects.
//   scope 'agent' → lifts ONLY rows that are themselves agent-scoped AND name
//     the same agent. It must never lift a whole-platform block: the admin who
//     approved one bot did not approve the app.
//
// FAIL CLOSED is the caller's job. [] legitimately means "no exceptions", so a
// caller that could not reach the server must skip the call — asserted against
// the worker itself in worker-load.test.mjs, not here.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  PLATFORM_HOST_PATTERNS,
  platformMatchesHost,
  normalizeAgentName,
  agentIdentityMatches,
  isAgentScopedRow,
  subtractAccessExceptions,
} from '../lib/blocked-agents.js';

const CONTENT = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'content', 'content.js'),
  'utf8',
);

// Rows exactly as GET /api/lifecycle/blocked-agents projects them.
const helpDesk = { agent_id: 'agt-A', agent_name: 'IT Help Desk Agent', platform: 'copilot_studio', agent_scope: 'agent' };
const finance  = { agent_id: 'agt-B', agent_name: 'Finance Approvals Bot', platform: 'copilot_studio', agent_scope: 'agent' };
const wholeCopilot = { agent_id: 'agt-C', agent_name: 'Copilot', platform: 'copilot_studio', agent_scope: 'platform' };
const claudeProject = { agent_id: 'agt-D', agent_name: 'Acme Project', platform: 'claude_ai_project', agent_scope: 'agent' };

// ── platform → host ─────────────────────────────────────────────────────────

test('a copilot_studio block is reachable at the surfaces the agent is published into', () => {
  for (const host of ['teams.microsoft.com', 'outlook.office.com', 'acme.sharepoint.com', 'm365.cloud.microsoft']) {
    assert.equal(platformMatchesHost('copilot_studio', host), true, host);
  }
  assert.equal(platformMatchesHost('copilot_studio', 'claude.ai'), false);
});

test('an UNKNOWN platform matches no host — "no exception can apply", never "unblock it"', () => {
  assert.equal(platformMatchesHost('some_new_platform', 'teams.microsoft.com'), false);
  assert.equal(platformMatchesHost('', 'teams.microsoft.com'), false);
  assert.equal(platformMatchesHost(null, 'teams.microsoft.com'), false);
  assert.equal(platformMatchesHost('copilot_studio', ''), false);
});

test('host matching is case-insensitive and tolerates whitespace', () => {
  assert.equal(platformMatchesHost(' Copilot_Studio ', ' TEAMS.microsoft.COM '), true);
});

// ── the host map may not drift from content.js ──────────────────────────────

test('lib/blocked-agents.js and content.js agree on every platform host pattern', () => {
  // content.js keeps its own PLATFORM_TO_HOSTS literal because content scripts
  // are classic scripts with no bundler. One copy decides which hosts a blocked
  // agent is even LOOKED FOR on; the other decides which rows an approved
  // host-scoped exception LIFTS. A platform in one and not the other either
  // under-enforces in the page or refuses to honour an approval in the worker.
  const at = CONTENT.indexOf('const PLATFORM_TO_HOSTS');
  assert.ok(at > 0, 'PLATFORM_TO_HOSTS must still exist in content.js');
  const literal = CONTENT.slice(at, CONTENT.indexOf('};', at));

  const fromContent = {};
  const entry = /(\w+):\s*\[([^\]]*)\]/g;
  let m;
  while ((m = entry.exec(literal))) {
    fromContent[m[1]] = m[2]
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => {
        assert.match(s, /^\/.*\/$/, `content.js pattern ${s} is not a bare regex literal`);
        return s.slice(1, -1);
      });
  }

  assert.deepEqual(
    Object.keys(fromContent).sort(),
    Object.keys(PLATFORM_HOST_PATTERNS).sort(),
    'the two maps cover different platforms',
  );
  for (const [platform, sources] of Object.entries(fromContent)) {
    assert.deepEqual(PLATFORM_HOST_PATTERNS[platform], sources, `patterns differ for ${platform}`);
  }
});

// ── agent identity ──────────────────────────────────────────────────────────

test('ids win when both sides have one; names are the fallback, normalized', () => {
  assert.equal(agentIdentityMatches({ agent_id: 'x' }, { agent_id: 'x' }), true);
  assert.equal(agentIdentityMatches({ agent_id: 'x' }, { agent_id: 'y' }), false);
  // A name collision must NOT override two different ids — that is the whole
  // reason ids are checked first.
  assert.equal(
    agentIdentityMatches({ agent_id: 'x', agent_name: 'Bot' }, { agent_id: 'y', agent_name: 'Bot' }),
    false,
  );
  // Either side lacking an id falls through to the name.
  assert.equal(agentIdentityMatches({ agent_name: 'IT Help Desk' }, { agent_id: 'y', agent_name: 'it help desk' }), true);
  assert.equal(agentIdentityMatches({ agent_id: 'x', agent_name: '  Bot ' }, { agent_name: 'BOT' }), true);
});

test('no shared identity at all is not a match', () => {
  // An agent-scoped grant carrying no agent identity would otherwise lift
  // everything — a host-wide grant wearing a narrow label.
  assert.equal(agentIdentityMatches({ agent_id: 'x', agent_name: 'Bot' }, {}), false);
  assert.equal(agentIdentityMatches({}, {}), false);
});

test('normalizeAgentName matches the server’s normalisation', () => {
  assert.equal(normalizeAgentName('  IT Help Desk  '), 'it help desk');
  assert.equal(normalizeAgentName(null), '');
  assert.equal(normalizeAgentName(undefined), '');
});

test('only agent_scope:’agent’ rows are agent-scoped', () => {
  assert.equal(isAgentScopedRow({ agent_scope: 'agent' }), true);
  assert.equal(isAgentScopedRow({ agent_scope: 'AGENT' }), true);
  assert.equal(isAgentScopedRow({ agent_scope: 'platform' }), false);
  assert.equal(isAgentScopedRow({ agent_scope: null }), false);
  assert.equal(isAgentScopedRow({}), false, 'absent means platform-wide, i.e. not narrowable');
});

// ── subtraction ─────────────────────────────────────────────────────────────

const all = [helpDesk, finance, wholeCopilot, claudeProject];

test('an agent-scoped exception lifts ONLY the matching agent', () => {
  const out = subtractAccessExceptions(all, [
    { tool_host: 'teams.microsoft.com', scope: 'agent', agent_id: 'agt-A', agent_name: 'IT Help Desk Agent' },
  ]);
  assert.deepEqual(out.map((r) => r.agent_id), ['agt-B', 'agt-C', 'agt-D']);
});

test('an agent-scoped exception never lifts a whole-platform block', () => {
  // Approving one bot is not approving Copilot. wholeCopilot's agent_scope is
  // 'platform', so even naming it exactly must leave it blocked.
  const out = subtractAccessExceptions([wholeCopilot], [
    { tool_host: 'teams.microsoft.com', scope: 'agent', agent_id: 'agt-C', agent_name: 'Copilot' },
  ]);
  assert.deepEqual(out, [wholeCopilot]);
});

test('a host-scoped exception lifts everything for that host, agent rows included', () => {
  const out = subtractAccessExceptions(all, [
    { tool_host: 'teams.microsoft.com', scope: 'host' },
  ]);
  // claude_ai_project does not map to teams.microsoft.com, so it stays.
  assert.deepEqual(out.map((r) => r.agent_id), ['agt-D']);
});

test('a legacy exception with no scope field is treated as host-wide', () => {
  // Every row written before the scope column existed arrives without one, and
  // reading those as narrow would re-block apps people already have access to.
  for (const exc of [
    { tool_host: 'teams.microsoft.com' },
    { tool_host: 'teams.microsoft.com', scope: null },
    { tool_host: 'teams.microsoft.com', scope: '' },
  ]) {
    const out = subtractAccessExceptions(all, [exc]);
    assert.deepEqual(out.map((r) => r.agent_id), ['agt-D'], JSON.stringify(exc));
  }
});

test('an agent-scoped exception for the wrong host does not lift the right-named agent', () => {
  const out = subtractAccessExceptions(all, [
    { tool_host: 'claude.ai', scope: 'agent', agent_id: 'agt-A', agent_name: 'IT Help Desk Agent' },
  ]);
  assert.deepEqual(out.map((r) => r.agent_id), ['agt-A', 'agt-B', 'agt-C', 'agt-D']);
});

test('name-only matching works when either side has no id', () => {
  const namedOnly = { agent_name: 'Gemini Conversation Agent 1', platform: 'gemini', agent_scope: 'agent' };
  const out = subtractAccessExceptions([namedOnly], [
    { tool_host: 'gemini.google.com', scope: 'agent', agent_name: 'gemini conversation agent 1' },
  ]);
  assert.deepEqual(out, []);
});

test('a differently-named agent still blocks — the deliberate part of the contract', () => {
  const namedOnly = { agent_name: 'Gemini Conversation Agent 1', platform: 'gemini', agent_scope: 'agent' };
  const out = subtractAccessExceptions([namedOnly], [
    { tool_host: 'gemini.google.com', scope: 'agent', agent_name: 'Gemini Conversation Agent 2' },
  ]);
  assert.deepEqual(out, [namedOnly]);
});

test('several exceptions apply together', () => {
  const out = subtractAccessExceptions(all, [
    { tool_host: 'teams.microsoft.com', scope: 'agent', agent_id: 'agt-A' },
    { tool_host: 'claude.ai', scope: 'host' },
  ]);
  assert.deepEqual(out.map((r) => r.agent_id), ['agt-B', 'agt-C']);
});

test('an exception with no tool_host is ignored rather than treated as global', () => {
  const out = subtractAccessExceptions(all, [{ scope: 'host' }, { scope: 'agent', agent_id: 'agt-A' }, null]);
  assert.equal(out.length, all.length);
});

test('no exceptions changes nothing, and the input is never mutated', () => {
  const input = [helpDesk, finance];
  assert.equal(subtractAccessExceptions(input, []), input);
  assert.equal(subtractAccessExceptions(input, null), input);
  subtractAccessExceptions(input, [{ tool_host: 'teams.microsoft.com', scope: 'host' }]);
  assert.deepEqual(input, [helpDesk, finance]);
});

test('a non-array list degrades to an empty list rather than throwing', () => {
  assert.deepEqual(subtractAccessExceptions(null, [{ tool_host: 'x' }]), []);
  assert.deepEqual(subtractAccessExceptions(undefined, []), []);
});

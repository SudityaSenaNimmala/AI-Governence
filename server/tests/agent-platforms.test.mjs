// Which blocked-agent platforms the server claims are ENFORCEABLE.
//
// THE GAP THIS PINS DOWN. `blocked_agents.platform` carries whatever discovery
// found, and the AgentPlatform union is much wider than the set the two enforcers
// understand. A block on a platform neither of them knows — power_automate,
// oauth_app, aws_bedrock, manual — was stored, shown as Blocked, reported as a
// plain success by POST /api/lifecycle/block, and stopped nothing. It was
// indistinguishable from a block that works.
//
// Two properties matter and both are asserted here: the annotation is HONEST (it
// tracks what the shipped enforcers actually key on), and it is INERT (it never
// refuses, drops or lifts a block — it only explains one).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  M365_AGENT_PLATFORMS, ENFORCEABLE_PLATFORMS, AGENT_MATCHABLE_PLATFORMS,
  PRODUCT_LEVEL_PLATFORMS, isEnforceablePlatform, unenforceableReason,
} from '../src/lib/agent-platforms.js';
import { isUnenforceableBlock } from '../src/lib/agent-platform.js';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

// ── The set itself ──────────────────────────────────────────────────────────

test('the M365 agent platforms are the six per-agent surfaces, and all are enforceable', () => {
  assert.deepEqual([...M365_AGENT_PLATFORMS], [
    'copilot_studio', 'personal_agent', 'teams_chat_agent',
    'sharepoint_embedded', 'teams_app', 'isv_store',
  ]);
  for (const p of M365_AGENT_PLATFORMS) {
    assert.equal(isEnforceablePlatform(p), true, `${p} is an M365 agent platform but reports unenforceable`);
  }
});

test('the enforceable set is frozen and free of duplicates', () => {
  // Frozen because it is a policy constant read at request time by a route — a
  // caller must not be able to widen what the server calls enforceable at runtime.
  assert.equal(Object.isFrozen(ENFORCEABLE_PLATFORMS), true);
  assert.equal(Object.isFrozen(AGENT_MATCHABLE_PLATFORMS), true);
  assert.equal(Object.isFrozen(PRODUCT_LEVEL_PLATFORMS), true);
  assert.equal(Object.isFrozen(M365_AGENT_PLATFORMS), true);
  assert.equal(new Set(ENFORCEABLE_PLATFORMS).size, ENFORCEABLE_PLATFORMS.length);
  assert.equal(new Set(AGENT_MATCHABLE_PLATFORMS).size, AGENT_MATCHABLE_PLATFORMS.length);
});

// The relationship between the two sets, asserted rather than assumed: the
// per-agent-matchable set is exactly the union minus the product-level values.
// Adding a platform to ENFORCEABLE_PLATFORMS without deciding which of the two
// kinds it is should fail here rather than silently pick one.
test('AGENT_MATCHABLE_PLATFORMS is ENFORCEABLE_PLATFORMS minus the product-level ids', () => {
  assert.deepEqual([...PRODUCT_LEVEL_PLATFORMS], ['m365_copilot', 'teams_desktop']);
  assert.deepEqual(
    [...ENFORCEABLE_PLATFORMS].filter((p) => !PRODUCT_LEVEL_PLATFORMS.includes(p)).sort(),
    [...AGENT_MATCHABLE_PLATFORMS].sort(),
  );
  for (const p of PRODUCT_LEVEL_PLATFORMS) {
    assert.equal(AGENT_MATCHABLE_PLATFORMS.includes(p), false, `${p} is not name-matchable`);
  }
});

test('every agent-matchable entry answers true, whatever case or padding the row stored', () => {
  for (const p of AGENT_MATCHABLE_PLATFORMS) {
    assert.equal(isEnforceablePlatform(p), true, p);
    // Both enforcers compare case-insensitively on a trimmed value, so the server
    // must not report a row unenforceable for a difference neither of them sees.
    assert.equal(isEnforceablePlatform(`  ${p.toUpperCase()}  `), true, p);
  }
});

// The two functions annotate ONE per-agent row, and a per-agent row is matched by
// NAME. Neither product-level id is a key in PLATFORM_HOST_PATTERNS or in
// PLATFORM_PROCS, so no name match can ever resolve under one — reporting such a
// row as fine would claim a block works when nothing looks at it.
test('a product-level platform is not agent-matchable, in any case or padding', () => {
  for (const p of PRODUCT_LEVEL_PLATFORMS) {
    assert.equal(isEnforceablePlatform(p), false, p);
    assert.equal(isEnforceablePlatform(`  ${p.toUpperCase()}  `), false, p);
    assert.equal(unenforceableReason(p), 'product_level_platform', p);
    assert.equal(unenforceableReason(`  ${p.toUpperCase()}  `), 'product_level_platform', p);
  }
});

// The values discovery legitimately writes that NO surface can act on. This is the
// list the widening exists for: before it, each of these came back as a working
// block.
const DISCOVERED_BUT_UNENFORCEABLE = [
  'power_automate', 'oauth_app', 'google_workspace', 'google_chat',
  'apps_script', 'gemini_workspace', 'claude_project', 'claude_model',
  'aws_bedrock', 'aws_sagemaker', 'manual',
];

test('real AgentPlatform values that no surface can act on are NOT enforceable', () => {
  for (const p of DISCOVERED_BUT_UNENFORCEABLE) {
    assert.equal(isEnforceablePlatform(p), false, `${p} is claimed enforceable but no surface keys on it`);
  }
});

test('an absent or junk platform is never enforceable', () => {
  for (const p of [undefined, null, '', '   ', 0, false, {}, [], 'not_a_platform']) {
    assert.equal(isEnforceablePlatform(p), false, JSON.stringify(p) ?? 'undefined');
  }
});

// ── The reason strings ──────────────────────────────────────────────────────

test('unenforceableReason tells the three failures apart', () => {
  for (const p of [undefined, null, '', '   ', 0, false, {}]) {
    assert.equal(unenforceableReason(p), 'no_platform', JSON.stringify(p) ?? 'undefined');
  }
  for (const p of DISCOVERED_BUT_UNENFORCEABLE) {
    assert.equal(unenforceableReason(p), 'unknown_platform', p);
  }
  for (const p of PRODUCT_LEVEL_PLATFORMS) {
    assert.equal(unenforceableReason(p), 'product_level_platform', p);
  }
  for (const p of AGENT_MATCHABLE_PLATFORMS) {
    assert.equal(unenforceableReason(p), null, p);
  }
});

// The widened annotation must remain a strict SUPERSET of the old one: every row
// the previous predicate flagged is still flagged, with the reason it always had.
test('the no-platform case still agrees with isUnenforceableBlock', () => {
  for (const platform of [undefined, null, '', '  ', 0, false, {}]) {
    assert.equal(isUnenforceableBlock({ agent_id: 'x', platform }), true);
    assert.equal(unenforceableReason(platform), 'no_platform');
  }
  // …and the rows it passed are now split into "fine" and "nobody knows this one",
  // which is the whole point of the widening.
  assert.equal(isUnenforceableBlock({ agent_id: 'x', platform: 'power_automate' }), false);
  assert.equal(unenforceableReason('power_automate'), 'unknown_platform');
});

// ── Drift guards against the two shipped enforcers ──────────────────────────
//
// The set is hand-maintained ON PURPOSE (see the file header: the extension and
// the desktop agent are versioned artifacts on the endpoint, not something the
// server can read at request time). What must not happen is the hand-maintained
// copy falling BEHIND them — a platform an enforcer really does act on, missing
// here, would label a working block broken in the admin UI. Parsed read-only.

function objectKeysOf(src, symbol) {
  const at = src.indexOf(symbol);
  assert.notEqual(at, -1, `${symbol} not found — this parser is stale`);
  const block = src.slice(at, src.indexOf('});', at));
  return [...block.matchAll(/^\s*([a-z0-9_]+):\s*\[/gm)].map((m) => m[1]);
}

test('every platform the browser extension can enforce is listed as enforceable', () => {
  const keys = objectKeysOf(
    read('../../browser-extension/lib/blocked-agents.js'),
    'export const PLATFORM_HOST_PATTERNS = Object.freeze({',
  );
  assert.ok(keys.length > 5, `parsed only ${keys.length} platforms — parser is stale`);
  assert.deepEqual(
    keys.filter((k) => !isEnforceablePlatform(k)), [],
    'the extension enforces these platforms but the server reports them unenforceable',
  );
});

test('every platform the desktop enforcer can act on is listed as enforceable', () => {
  const keys = objectKeysOf(
    read('../../agent/src/os_monitor/ai-processes.js'),
    'export const PLATFORM_PROCS = Object.freeze({',
  );
  assert.ok(keys.length > 5, `parsed only ${keys.length} platforms — parser is stale`);
  assert.deepEqual(
    keys.filter((k) => !isEnforceablePlatform(k)), [],
    'the desktop enforcer acts on these platforms but the server reports them unenforceable',
  );
});

// ── Spelling parity with the type that produces these values ────────────────

test('the M365 agent platforms are spelled exactly as the AgentPlatform union', () => {
  const src = read('../src/governance/types/agent.ts');
  const at = src.indexOf('export type AgentPlatform');
  assert.notEqual(at, -1);
  const union = src.slice(at, src.indexOf(';', at));
  for (const p of M365_AGENT_PLATFORMS) {
    assert.ok(union.includes(`"${p}"`), `${p} is not an AgentPlatform value — discovery never writes it`);
  }
  // m365_copilot and teams_desktop are deliberately NOT in that union: they are
  // enforcement targets (the M365 Copilot app, the Teams client), not discovery
  // results. Asserted so the difference reads as intentional rather than as a typo.
  //
  // They stay in ENFORCEABLE_PLATFORMS — both ARE enforced today, through the
  // whole-product ai_platforms host cascade — but a per-agent row stored under
  // one is matched by NAME and nothing matches it, so unenforceableReason must
  // say 'product_level_platform' rather than null. Both halves are asserted
  // together here because dropping either one is the mistake: removing them from
  // the union would deny a real enforcement path, and answering null would claim
  // a per-agent block works when nothing looks at it.
  for (const p of PRODUCT_LEVEL_PLATFORMS) {
    assert.ok(ENFORCEABLE_PLATFORMS.includes(p), `${p} must stay in ENFORCEABLE_PLATFORMS — it is enforced today`);
    assert.equal(unenforceableReason(p), 'product_level_platform',
      `${p} names a product, not a per-agent-matchable value`);
    assert.equal(union.includes(`"${p}"`), false, `${p} is now an AgentPlatform value — update this note`);
  }
});

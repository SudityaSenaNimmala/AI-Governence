// The session boundary (Session Replay — engagement rule).
//
// One session = one continuous stretch of using the SAME AI service in the SAME
// tab. It survives chat switches, "New chat" and same-service reloads; it ends on
// tab close, a service change, 15 min without visible-tab use, a 12 h cap, or a
// browser restart. The decision logic is pure and lives in lib/recording.js, so
// all of it is exercised here with an injected clock — no Chrome, no DOM.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ENGAGEMENT_DEFAULTS,
  SERVICE_KEY_HOSTS,
  RECORDABLE_HOST_SUFFIXES,
  builtinServiceKey,
  serviceKeyForHost,
  engagementServiceKey,
  engagementExpiry,
  nextEngagement,
  normalizeReplayPolicy,
} from '../lib/recording.js';

const T0 = Date.UTC(2026, 6, 30, 9, 0, 0);
const POLICY = normalizeReplayPolicy(null);
const IDLE = ENGAGEMENT_DEFAULTS.idle_timeout_ms;
const MAX = ENGAGEMENT_DEFAULTS.max_session_ms;

function engagement(overrides = {}) {
  return {
    session_id: 's-1',
    service_key: 'openai',
    host: 'chatgpt.com',
    started_at: T0,
    last_activity_at: T0,
    client_seq: 0,
    ...overrides,
  };
}

// ── the service-key table ───────────────────────────────────────────────────

test('defaults are 15 minutes idle and a 12 hour cap', () => {
  assert.equal(IDLE, 15 * 60 * 1000);
  assert.equal(MAX, 12 * 60 * 60 * 1000);
});

test('every recordable host maps to exactly one service key', () => {
  const seen = new Map();
  for (const [key, hosts] of Object.entries(SERVICE_KEY_HOSTS)) {
    for (const h of hosts) {
      assert.equal(seen.has(h), false, `${h} appears under two keys`);
      seen.set(h, key);
    }
  }
  for (const suffix of RECORDABLE_HOST_SUFFIXES) {
    const key = builtinServiceKey(suffix);
    assert.ok(key, `recordable host ${suffix} has no service key`);
  }
});

test('hosts of one product share a key; look-alike surfaces do not', () => {
  for (const h of ['chatgpt.com', 'chat.openai.com', 'openai.com']) {
    assert.equal(serviceKeyForHost(h), 'openai', h);
  }
  assert.equal(serviceKeyForHost('claude.ai'), 'anthropic');
  assert.equal(serviceKeyForHost('gemini.google.com'), 'google-gemini');
  assert.equal(serviceKeyForHost('bard.google.com'), 'google-gemini');
  // Same vendor, deliberately a DIFFERENT session.
  assert.equal(serviceKeyForHost('aistudio.google.com'), 'google-aistudio');
  assert.equal(serviceKeyForHost('copilot.microsoft.com'), 'microsoft-copilot');
  assert.equal(serviceKeyForHost('m365.cloud.microsoft'), 'microsoft-copilot');
  assert.equal(serviceKeyForHost('mistral.ai'), 'mistral');
  assert.equal(serviceKeyForHost('chat.mistral.ai'), 'mistral');
  assert.equal(serviceKeyForHost('grok.com'), 'xai-grok');
});

test('a subdomain of a keyed host inherits the key; an unrelated host has none', () => {
  assert.equal(serviceKeyForHost('www.perplexity.ai'), 'perplexity');
  assert.equal(serviceKeyForHost('notperplexity.ai'), null, 'suffix match, never substring');
  assert.equal(serviceKeyForHost('example.com'), null);
  assert.equal(serviceKeyForHost(''), null);
  assert.equal(serviceKeyForHost(null), null);
  // github.com is intentionally NOT recordable — only an admin can add it.
  assert.equal(serviceKeyForHost('github.com'), null);
});

test('a registry-only platform gets a key from its own registry host', () => {
  const platforms = [{ host: 'ai.acme.example', governed: 1 }];
  assert.equal(serviceKeyForHost('ai.acme.example', platforms), 'registry:ai.acme.example');
  assert.equal(serviceKeyForHost('eu.ai.acme.example', platforms), 'registry:ai.acme.example',
    'both subdomains are the same registered platform, so one session');
  // Without the registry entry it is not recordable at all.
  assert.equal(serviceKeyForHost('ai.acme.example'), null);
});

test('the built-in key wins over a registry row for the same major', () => {
  // An admin registering chat.openai.com must not split it away from chatgpt.com.
  const platforms = [{ host: 'chat.openai.com', governed: 1 }];
  assert.equal(serviceKeyForHost('chat.openai.com', platforms), 'openai');
  assert.equal(serviceKeyForHost('chatgpt.com', platforms), 'openai');
});

test('grouping falls back to the hostname for a governed-but-unlisted host', () => {
  // content.js is injected on classifier-discovered hosts too. Those events still
  // need a session_id, so grouping is wider than recordability.
  assert.equal(serviceKeyForHost('some-llm.example'), null);
  assert.equal(engagementServiceKey('some-llm.example'), 'host:some-llm.example');
  assert.equal(engagementServiceKey('CHATGPT.com'), 'openai', 'known hosts keep the canonical key');
  assert.equal(engagementServiceKey(''), null);
});

// ── engagementExpiry ────────────────────────────────────────────────────────

test('a fresh engagement has not expired', () => {
  assert.equal(engagementExpiry(engagement(), T0, POLICY), null);
  assert.equal(engagementExpiry(engagement(), T0 + IDLE - 1, POLICY), null);
});

test('exactly at the idle boundary the engagement is expired', () => {
  assert.equal(engagementExpiry(engagement(), T0 + IDLE, POLICY), 'idle_timeout');
  assert.equal(engagementExpiry(engagement(), T0 + IDLE + 60_000, POLICY), 'idle_timeout');
});

test('activity slides the idle window forward', () => {
  const rec = engagement({ last_activity_at: T0 + 10 * 60_000 });
  assert.equal(engagementExpiry(rec, T0 + 20 * 60_000, POLICY), null);
  assert.equal(engagementExpiry(rec, T0 + 25 * 60_000, POLICY), 'idle_timeout');
});

test('exactly at the 12h cap the engagement is expired even while in use', () => {
  const busy = engagement({ last_activity_at: T0 + MAX - 1000 });
  assert.equal(engagementExpiry(busy, T0 + MAX - 1, POLICY), null);
  assert.equal(engagementExpiry(busy, T0 + MAX, POLICY), 'max_session_ms');
});

test('idle is reported ahead of the cap when both windows are blown', () => {
  assert.equal(engagementExpiry(engagement(), T0 + MAX + IDLE, POLICY), 'idle_timeout');
});

test('null, garbage and unusable timestamps', () => {
  assert.equal(engagementExpiry(null, T0, POLICY), null, 'no engagement cannot expire');
  assert.equal(engagementExpiry(undefined, T0, POLICY), null);
  // Fail closed: a record we cannot bound is reported as over, not kept forever.
  assert.equal(engagementExpiry({ session_id: 'x' }, T0, POLICY), 'idle_timeout');
  assert.equal(engagementExpiry(engagement({ started_at: 'nope' }), T0, POLICY), 'idle_timeout');
  // last_activity_at missing falls back to started_at rather than expiring.
  assert.equal(engagementExpiry({ session_id: 'x', started_at: T0 }, T0 + 60_000, POLICY), null);
});

test('a policy may tighten the windows, and junk values fall back to the defaults', () => {
  const tight = normalizeReplayPolicy({ idle_timeout_ms: 60_000, max_session_ms: 3_600_000 });
  assert.equal(tight.idle_timeout_ms, 60_000);
  assert.equal(engagementExpiry(engagement(), T0 + 60_000, tight), 'idle_timeout');
  assert.equal(engagementExpiry(engagement(), T0 + 60_000, POLICY), null);

  // Clamped: 5ms would rotate the session per keystroke.
  assert.equal(normalizeReplayPolicy({ idle_timeout_ms: 5 }).idle_timeout_ms, 60_000);
  assert.equal(normalizeReplayPolicy({ max_session_ms: 99 * 60 * 60 * 1000 }).max_session_ms, 24 * 60 * 60 * 1000);
  // An idle window past the hard cap could never fire.
  const silly = normalizeReplayPolicy({ idle_timeout_ms: 4 * 60 * 60 * 1000, max_session_ms: 600_000 });
  assert.equal(silly.idle_timeout_ms, silly.max_session_ms);

  assert.equal(engagementExpiry(engagement(), T0 + IDLE, {}), 'idle_timeout', 'empty policy uses defaults');
  assert.equal(engagementExpiry(engagement(), T0 + IDLE, { idle_timeout_ms: 'x' }), 'idle_timeout');
});

// ── nextEngagement: minting and continuing ──────────────────────────────────

test('the first activity on a recordable host mints an engagement', () => {
  const r = nextEngagement(null, { type: 'activity', host: 'chatgpt.com', new_session_id: 'sid-1' }, T0, POLICY);
  assert.equal(r.action, 'mint');
  assert.equal(r.closed, null);
  assert.equal(r.seq, 0, 'the minting event is stamped seq 0');
  assert.deepEqual(r.record, {
    session_id: 'sid-1',
    service_key: 'openai',
    host: 'chatgpt.com',
    started_at: T0,
    last_activity_at: T0,
    client_seq: 1,
  });
});

test('client_seq increases monotonically across a run of events', () => {
  let rec = null;
  const seqs = [];
  for (let i = 0; i < 5; i++) {
    const r = nextEngagement(rec, { type: 'activity', host: 'chatgpt.com', new_session_id: 'sid-1' }, T0 + i * 1000, POLICY);
    seqs.push(r.seq);
    rec = r.record;
  }
  assert.deepEqual(seqs, [0, 1, 2, 3, 4]);
  assert.equal(rec.session_id, 'sid-1');
  assert.equal(rec.last_activity_at, T0 + 4000);
});

test('a chat switch or a new chat on the same service does NOT rotate the session', () => {
  // The conversation id is no longer part of the boundary at all — the same host
  // and the same service key mean the same engagement, whatever the URL path is.
  const first = nextEngagement(null, { type: 'activity', host: 'chatgpt.com', new_session_id: 'sid-1' }, T0, POLICY);
  const later = nextEngagement(first.record, { type: 'activity', host: 'chatgpt.com', new_session_id: 'sid-2' }, T0 + 5000, POLICY);
  assert.equal(later.action, 'continue');
  assert.equal(later.record.session_id, 'sid-1');
  assert.equal(later.closed, null);
  assert.equal(later.seq, 1);
});

test('a same-service navigation commit keeps the engagement and does not count as activity', () => {
  const rec = engagement({ last_activity_at: T0 });
  const r = nextEngagement(rec, { type: 'nav_committed', host: 'chatgpt.com', isTopFrame: true }, T0 + 60_000, POLICY);
  assert.equal(r.action, 'continue');
  assert.equal(r.record.session_id, 's-1');
  assert.equal(r.record.last_activity_at, T0, 'a commit can fire in a hidden tab');
  assert.equal(r.seq, null, 'a commit is not an event to stamp');
  assert.equal(r.closed, null);
});

test('an openai.com → chatgpt.com redirect is one service, so one session', () => {
  const rec = engagement({ service_key: 'openai', host: 'openai.com' });
  const r = nextEngagement(rec, { type: 'nav_committed', host: 'chatgpt.com', isTopFrame: true }, T0 + 1000, POLICY);
  assert.equal(r.action, 'continue');
  assert.equal(r.record.session_id, 's-1');
});

test('a subframe commit is not a boundary', () => {
  const rec = engagement();
  const r = nextEngagement(rec, { type: 'nav_committed', host: 'ads.example', isTopFrame: false }, T0 + 1000, POLICY);
  assert.equal(r.action, 'none');
  assert.equal(r.record.session_id, 's-1');
  assert.equal(r.closed, null);
});

// ── nextEngagement: ending ──────────────────────────────────────────────────

test('committing to a DIFFERENT service closes the engagement and mints nothing yet', () => {
  const rec = engagement();
  const r = nextEngagement(rec, { type: 'nav_committed', host: 'claude.ai', isTopFrame: true }, T0 + 1000, POLICY);
  assert.equal(r.action, 'closed');
  assert.equal(r.record, null);
  assert.equal(r.closed.reason, 'service_changed');
  assert.equal(r.closed.session_id, 's-1');

  // The next activity on the new service mints the replacement.
  const fresh = nextEngagement(null, { type: 'activity', host: 'claude.ai', new_session_id: 'sid-2' }, T0 + 2000, POLICY);
  assert.equal(fresh.action, 'mint');
  assert.equal(fresh.record.service_key, 'anthropic');
  assert.equal(fresh.record.session_id, 'sid-2');
});

test('gemini → aistudio is a service change, not a chat switch', () => {
  const rec = engagement({ service_key: 'google-gemini', host: 'gemini.google.com' });
  const r = nextEngagement(rec, { type: 'nav_committed', host: 'aistudio.google.com', isTopFrame: true }, T0 + 1000, POLICY);
  assert.equal(r.action, 'closed');
  assert.equal(r.closed.reason, 'service_changed');
});

test('committing to a non-recordable host closes the engagement as navigated_away', () => {
  const rec = engagement();
  const r = nextEngagement(rec, { type: 'nav_committed', host: 'news.example', isTopFrame: true }, T0 + 1000, POLICY);
  assert.equal(r.action, 'closed');
  assert.equal(r.closed.reason, 'navigated_away');
});

test('a service switch noticed on an activity signal closes and mints in one step', () => {
  // No commit arrived (in-page transition, or the worker was asleep for it).
  const rec = engagement();
  const r = nextEngagement(rec, { type: 'activity', host: 'claude.ai', new_session_id: 'sid-2' }, T0 + 1000, POLICY);
  assert.equal(r.action, 'mint');
  assert.equal(r.closed.reason, 'service_changed');
  assert.equal(r.closed.session_id, 's-1');
  assert.equal(r.record.session_id, 'sid-2');
  assert.equal(r.record.service_key, 'anthropic');
  assert.equal(r.seq, 0, 'the new session starts its own seq');
});

test('resuming within the idle window continues; after it, a fresh session', () => {
  const rec = engagement();

  const within = nextEngagement(rec, { type: 'activity', host: 'chatgpt.com', new_session_id: 'sid-2' }, T0 + IDLE - 1, POLICY);
  assert.equal(within.action, 'continue');
  assert.equal(within.record.session_id, 's-1');
  assert.equal(within.closed, null);

  const after = nextEngagement(rec, { type: 'activity', host: 'chatgpt.com', new_session_id: 'sid-2' }, T0 + IDLE, POLICY);
  assert.equal(after.action, 'mint');
  assert.equal(after.closed.reason, 'idle_timeout');
  assert.equal(after.record.session_id, 'sid-2');
  assert.equal(after.record.started_at, T0 + IDLE);
  assert.equal(after.seq, 0);
});

test('an activity signal past the 12h cap closes with max_session_ms and mints', () => {
  const rec = engagement({ last_activity_at: T0 + MAX - 1000 });
  const r = nextEngagement(rec, { type: 'activity', host: 'chatgpt.com', new_session_id: 'sid-2' }, T0 + MAX, POLICY);
  assert.equal(r.action, 'mint');
  assert.equal(r.closed.reason, 'max_session_ms');
  assert.equal(r.record.session_id, 'sid-2');
});

// ── nextEngagement: visibility and touches ──────────────────────────────────

test('an event from a HIDDEN tab is stamped but does not extend the idle window', () => {
  const rec = engagement();
  const r = nextEngagement(rec, { type: 'activity', host: 'chatgpt.com', visible: false }, T0 + 60_000, POLICY);
  assert.equal(r.action, 'continue');
  assert.equal(r.seq, 0, 'the event still gets a seq — it is real evidence');
  assert.equal(r.record.last_activity_at, T0, 'a background tab does not keep the session alive');
  assert.equal(r.record.client_seq, 1);
  // …so it still times out 15 min after the last VISIBLE use.
  assert.equal(engagementExpiry(r.record, T0 + IDLE, POLICY), 'idle_timeout');
});

test('a visible touch extends the window without minting or consuming a seq', () => {
  const rec = engagement();
  const r = nextEngagement(rec, { type: 'touch', host: 'chatgpt.com' }, T0 + 60_000, POLICY);
  assert.equal(r.action, 'continue');
  assert.equal(r.seq, null);
  assert.equal(r.record.last_activity_at, T0 + 60_000);
  assert.equal(r.record.client_seq, 0, 'no seq was handed out');
});

test('a touch never mints — asking must not create a session', () => {
  const cold = nextEngagement(null, { type: 'touch', host: 'chatgpt.com', new_session_id: 'sid-9' }, T0, POLICY);
  assert.equal(cold.action, 'none');
  assert.equal(cold.record, null);

  const stale = nextEngagement(engagement(), { type: 'touch', host: 'chatgpt.com' }, T0 + IDLE, POLICY);
  assert.equal(stale.action, 'closed');
  assert.equal(stale.record, null);
  assert.equal(stale.closed.reason, 'idle_timeout');
});

// ── nextEngagement: input hygiene ───────────────────────────────────────────

test('an unknown signal type or a junk record changes nothing', () => {
  const rec = engagement();
  assert.equal(nextEngagement(rec, { type: 'tab_closed' }, T0, POLICY).action, 'none');
  assert.equal(nextEngagement(rec, null, T0, POLICY).action, 'none');
  assert.equal(nextEngagement(rec, {}, T0, POLICY).action, 'none');
  // tab_closed is the caller's job precisely because it says nothing about a host.
  assert.equal(nextEngagement(rec, { type: 'tab_closed' }, T0, POLICY).record.session_id, 's-1');
});

test('a stored record with no session_id is treated as no engagement', () => {
  const r = nextEngagement({ started_at: T0, last_activity_at: T0 }, { type: 'activity', host: 'chatgpt.com', new_session_id: 'sid-1' }, T0, POLICY);
  assert.equal(r.action, 'mint');
  assert.equal(r.closed, null, 'nothing real was closed');
});

test('activity with no usable host cannot mint', () => {
  const r = nextEngagement(null, { type: 'activity', host: '', new_session_id: 'sid-1' }, T0, POLICY);
  assert.equal(r.action, 'none');
  assert.equal(r.record, null);
});

test('a missing new_session_id still yields a deterministic id rather than throwing', () => {
  const r = nextEngagement(null, { type: 'activity', host: 'chatgpt.com' }, T0, POLICY);
  assert.equal(r.action, 'mint');
  assert.equal(r.record.session_id, 'eng-' + T0);
});

test('the input record is never mutated', () => {
  const rec = engagement();
  const snapshot = { ...rec };
  nextEngagement(rec, { type: 'activity', host: 'claude.ai', new_session_id: 'sid-2' }, T0 + 1000, POLICY);
  nextEngagement(rec, { type: 'activity', host: 'chatgpt.com', new_session_id: 'sid-2' }, T0 + 1000, POLICY);
  assert.deepEqual(rec, snapshot);
});

// WHICH TEXT ON THE PAGE COUNTS AS "this blocked agent is on screen".
//
// THE DEFECT. isBlockedAgentActive() matched a blocked row's agent_name against
// getHeaderAgentText() with `headerText.includes(name)` — a plain substring —
// and accepted any name of 2 characters or more. getHeaderAgentText() is
// document.title plus every breadcrumb/header/top-bar element on the page.
//
// That was tolerable while the only hosts reaching this path were two dedicated
// Copilot chat surfaces. The per-agent M365 work widened PLATFORM_TO_HOSTS to
// the whole Microsoft suite — SharePoint, Word/Excel/PowerPoint on the web,
// Outlook, Teams — where those strings are USER-AUTHORED document names. A row
// named "Chat" then matched "Q3 Chatter Report.docx" and blocked the composer of
// a document that has nothing to do with any agent.
//
// THE RULE NOW: the name must appear as a whole token/phrase, and must be at
// least AGENT_NAME_MIN_LEN characters. Both halves are asserted here against the
// SHIPPED region (see load-panel-agent-label.mjs) — directly, and through the
// real decision function, because the panel signal has to obey the same rule as
// the header one or the widening simply moves.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  loadAgentNameMatch, loadBlockedAgentActive, nameMatchRegion, contentSource,
} from './load-panel-agent-label.mjs';

const { agentNameMatchesText, AGENT_NAME_MIN_LEN } = loadAgentNameMatch();

// ── 1. The rule itself ──────────────────────────────────────────────────────

test('a name still matches when it stands as its own token', () => {
  assert.equal(agentNameMatchesText('copilot', 'copilot | microsoft 365'), true);
  assert.equal(agentNameMatchesText('copilot', 'chat | copilot'), true);
  assert.equal(agentNameMatchesText('it help desk agent',
    'it help desk agent | microsoft 365 copilot'), true);
  assert.equal(agentNameMatchesText('finance approvals bot',
    'home > finance approvals bot > chat'), true);
});

test('punctuation and separators still bound a token', () => {
  for (const text of [
    'copilot,notes', 'copilot-notes', '(copilot)', 'copilot/chat', '[copilot]',
    'notes|copilot', 'copilot.docx',
  ]) {
    assert.equal(agentNameMatchesText('copilot', text), true, text);
  }
});

test('a name embedded inside a longer word no longer matches', () => {
  // The headline false positive: ordinary SharePoint/Office page furniture.
  assert.equal(agentNameMatchesText('chat', 'q3 chatter report.docx'), false);
  assert.equal(agentNameMatchesText('chat', 'chatham house rules - notes'), false);
  assert.equal(agentNameMatchesText('copilot', 'copilots roadmap 2026'), false);
  assert.equal(agentNameMatchesText('data', 'metadata migration plan'), false);
  assert.equal(agentNameMatchesText('lead', 'leadership offsite agenda'), false);
});

test('digits are word characters too — a name must not match inside an id', () => {
  assert.equal(agentNameMatchesText('team', 'team7 standup'), false);
  assert.equal(agentNameMatchesText('team', 'x2team notes'), false);
  assert.equal(agentNameMatchesText('team', 'team 7 standup'), true);
});

test('names shorter than the floor are not matched at all', () => {
  assert.ok(AGENT_NAME_MIN_LEN >= 4,
    'a 2-3 character name cannot be matched against scraped page text with confidence');
  assert.equal(agentNameMatchesText('hr', 'hr | microsoft 365 copilot'), false);
  assert.equal(agentNameMatchesText('bot', 'bot | microsoft 365 copilot'), false);
  assert.equal(agentNameMatchesText('a', 'a'), false);
  assert.equal(agentNameMatchesText('', 'anything at all'), false);
});

test('regex metacharacters in an admin-typed name are literal, not a pattern', () => {
  // agent_name is free text. `.` must not mean "any character", and an unbalanced
  // bracket must not throw out of the 500ms enforcement interval.
  assert.equal(agentNameMatchesText('c.pilot', 'copilot | microsoft 365'), false);
  assert.equal(agentNameMatchesText('c.pilot', 'c.pilot | microsoft 365'), true);
  assert.doesNotThrow(() => agentNameMatchesText('bad[(name', 'anything'));
  assert.equal(agentNameMatchesText('bad[(name', 'bad[(name here'), true);
});

test('empty text is never a match', () => {
  assert.equal(agentNameMatchesText('copilot', ''), false);
  assert.equal(agentNameMatchesText('copilot', null), false);
});

// ── 2. The rule, through the real decision ──────────────────────────────────

const onSharePoint = (over = {}) => loadBlockedAgentActive({
  host: 'acme.sharepoint.com', headerText: '', panelLabels: [], ...over,
});

const CHAT_AGENT = { agent_id: 'agt-1', agent_name: 'Chat', platform: 'copilot_studio' };
const COPILOT = { agent_id: 'agt-2', agent_name: 'Copilot', platform: 'copilot_studio' };

test('a generic-named blocked agent does not fire on an ordinary document title', () => {
  const run = onSharePoint({
    blockedList: [CHAT_AGENT],
    headerText: 'Q3 Chatter Report.docx - Saved > Documents > Finance',
  });
  assert.equal(run.isBlockedAgentActive(), null,
    'a user\'s own document must never be blocked because its name contains the agent\'s');
});

test('nor on a breadcrumb that merely contains the name as a fragment', () => {
  const run = onSharePoint({
    blockedList: [COPILOT],
    headerText: 'Home > Copilots Roadmap 2026 > Overview',
  });
  assert.equal(run.isBlockedAgentActive(), null);
});

test('the same agent DOES still fire when the header names it properly', () => {
  const run = onSharePoint({
    blockedList: [COPILOT],
    headerText: 'Copilot | Microsoft 365',
  });
  assert.equal(run.isBlockedAgentActive(), COPILOT);
});

test('the panel signal obeys the same rule as the header signal', () => {
  // Otherwise the false-positive surface just moves from the header to the pane.
  const near = onSharePoint({
    blockedList: [CHAT_AGENT],
    headerText: 'Documents',
    panelLabels: ['Chatter digest assistant'],
  });
  assert.equal(near.isBlockedAgentActive(), null);

  const exact = onSharePoint({
    blockedList: [COPILOT],
    headerText: 'Documents',
    panelLabels: ['Copilot'],
  });
  assert.equal(exact.isBlockedAgentActive(), COPILOT);
});

test('a 2-3 character blocked name blocks nothing on a scraped surface', () => {
  const run = onSharePoint({
    blockedList: [{ agent_id: 'agt-3', agent_name: 'HR', platform: 'copilot_studio' }],
    headerText: 'HR | Microsoft 365 Copilot',
    panelLabels: ['HR'],
  });
  assert.equal(run.isBlockedAgentActive(), null,
    'under-blocking a too-generic name is the correct side to err on here');
});

test('surrounding whitespace in an admin-typed name does not defeat the match', () => {
  const run = onSharePoint({
    blockedList: [{ agent_id: 'agt-4', agent_name: '  Finance Approvals Bot  ', platform: 'copilot_studio' }],
    headerText: 'Finance Approvals Bot | Microsoft 365 Copilot',
  });
  assert.ok(run.isBlockedAgentActive(), 'agent_name must be trimmed before matching');
});

// ── 3. Pinned on shipped source ─────────────────────────────────────────────

test('the decision uses the shared matcher for BOTH signals, and no substring test', () => {
  const src = contentSource();
  const at = src.indexOf('function isBlockedAgentActive() {');
  const body = src.slice(at, src.indexOf('\n  }', at));
  assert.match(body, /agentNameMatchesText\(name, headerText\)/);
  assert.match(body, /agentNameMatchesText\(name, label\)/);
  assert.doesNotMatch(body, /\.includes\(name\)/,
    'no signal may fall back to a plain substring match against scraped page text');
  assert.match(body, /name\.length < AGENT_NAME_MIN_LEN/,
    'the length floor must be the shared constant, not a second literal');
});

test('the matcher is anchored on non-alphanumeric boundaries, not bare \\b', () => {
  // \b would still let a name ending in punctuation match mid-word, and these
  // names are free text.
  const region = nameMatchRegion();
  assert.match(region, /\[\^a-z0-9\]/, 'the boundary must be an explicit character class');
  assert.ok(region.includes("'\\\\$&'"),
    'an admin-typed name must be regex-escaped before it becomes a pattern');
});

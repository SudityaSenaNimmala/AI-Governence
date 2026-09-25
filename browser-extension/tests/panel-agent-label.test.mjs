// Reading WHICH AGENT is open, from inside the panel, without reading anything
// else — and without acting on it until someone has verified it.
//
// WHY THIS EXISTS. getHeaderAgentText() decides whether a blocked agent is
// active by scraping document.title and the top bar. On Microsoft 365 that is
// blind: the title stays "Microsoft Teams" / "Chat | Microsoft 365 Copilot"
// whichever agent is loaded in the Copilot pane, so a per-agent block on a
// Copilot Studio or declarative agent never fires in the browser at all. The
// name is rendered inside the pane instead.
//
// WHY IT IS DANGEROUS. Everything that makes the header read safe is absent
// here. The pane also contains chat history, suggestion chips, an agent picker
// and other people's names. A document-wide read, a fallback, or a "close
// enough" match does not produce a missed block — it produces a block on an
// agent the user never opened, or on the whole app, which is the exact class of
// failure blocked-agent-scope.test.mjs exists to prevent. And the selectors it
// depends on (server/src/lib/ai-surfaces.js's M365_AGENT_LABEL) are an
// UNVERIFIED HYPOTHESIS about Microsoft's DOM.
//
// So the contract asserted below is four things, and all four are load-bearing:
//   1. panel-scoped     — never document, never outside the resolved panel
//   2. fail closed      — no label found is NO EVIDENCE, and blocks nothing
//   3. opt-in           — off unless an admin explicitly turned it on
//   4. never transmitted — read, compared locally, discarded
//
// Driven against the SHIPPED region and the SHIPPED aiPanels() over one fake
// DOM (see load-panel-agent-label.mjs), in the style of its sibling tests.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  loadPanelAgentLabel, loadBlockedAgentActive, readerRegion, contentSource, el, doc,
} from './load-panel-agent-label.mjs';
import {
  loadBlockedAgentScope, el as blockEl, doc as blockDoc, isDisabled, isUntouched,
} from './load-blocked-agent-scope.mjs';

const AGENT = { agent_id: 'agt-7f3c', agent_name: 'IT Help Desk Agent', platform: 'copilot_studio' };
const OTHER = { agent_id: 'agt-9a1b', agent_name: 'Finance Approvals Bot', platform: 'copilot_studio' };

// Exactly what GET /api/v1/ai-surfaces serves for the M365 hosts today. Two of
// these are compound attribute selectors the fake DOM deliberately does not
// implement — it is a substring matcher, not a selector engine — so the fixtures
// below key on the class-based one. That is honest: a selector the fake cannot
// match is a selector that finds nothing, which is the case this file cares most
// about getting right.
const M365_AGENT_LABEL = [
  '.fai-CopilotMessage__accessibleHeading',
  '.fai-AiGeneratedDisclaimer',
  '[aria-selected="true"][role="option"]',
  '[role="combobox"][aria-expanded]',
];

const SYNCED = {
  embedded: {
    'teams.microsoft.com': {
      product: 'Microsoft 365 Copilot in Teams',
      selectors: ['[aria-label*="Copilot" i]', '[data-tid*="copilot" i]'],
      agentLabelSelectors: M365_AGENT_LABEL,
    },
    // A host with a panel but NO agent-label selectors — the majority case, and
    // the one that must stay exactly as it is today.
    'hubspot.com': {
      product: 'HubSpot Breeze',
      selectors: ['[class*="copilot" i]'],
    },
  },
};

// ── Fixtures ────────────────────────────────────────────────────────────────

function heading(text) {
  return el({ tag: 'div', className: 'fai-CopilotMessage__accessibleHeading', text });
}

/**
 * A Teams tab: the user's own DM rail, and a Copilot pane with an open agent.
 * `outsideLabel` is the trap — an agent name rendered in the sidebar, which a
 * document-wide read would happily pick up.
 */
function teamsDom({
  panelVisible = true,
  panelLabel = 'IT Help Desk Agent',
  outsideLabel = 'Finance Approvals Bot',
} = {}) {
  const dmComposer = el({ tag: 'div', id: 'dm-composer', attrs: { role: 'textbox' } });
  const panelComposer = el({ tag: 'div', id: 'panel-composer', attrs: { role: 'textbox' } });
  const label = panelLabel == null ? null : heading(panelLabel);
  const panel = el({
    tag: 'div', id: 'copilot-panel', visible: panelVisible,
    attrs: { 'aria-label': 'Copilot chat' },
    children: label ? [label, panelComposer] : [panelComposer],
  });
  const sidebarLabel = outsideLabel == null ? null : heading(outsideLabel);
  const sidebar = el({
    tag: 'nav', id: 'agent-rail',
    children: sidebarLabel ? [sidebarLabel] : [],
  });

  const document = doc([
    el({ tag: 'div', id: 'chat-pane', children: [dmComposer] }),
    sidebar,
    panel,
  ]);
  return { document, panel, panelComposer, dmComposer, label, sidebarLabel };
}

function reader(fixture, over = {}) {
  return loadPanelAgentLabel({
    host: 'teams.microsoft.com',
    document: fixture.document,
    synced: SYNCED,
    ...over,
  });
}

/**
 * The region with its comments stripped. The prose in there NAMES the things it
 * is forbidden to do ("never `document`", "must not emit") — asserting over the
 * raw text would either fail on the explanation or force the explanation out.
 */
function codeOnly(body) {
  return body
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ');
}

/** Count only the label-selector queries, so aiPanels()' own probing is excluded. */
function countLabelQueries(node) {
  const orig = node.querySelectorAll.bind(node);
  const state = { n: 0 };
  node.querySelectorAll = (s) => {
    if (M365_AGENT_LABEL.includes(s)) state.n += 1;
    return orig(s);
  };
  return state;
}

// ── The fixture itself has to be honest ─────────────────────────────────────

test('the fixture resolves one Copilot panel, with the agent name inside it', () => {
  const f = teamsDom();
  const run = reader(f, { flagOn: true });
  assert.equal(run.aiPanels().length, 1, 'exactly the Copilot pane must resolve');
  assert.equal(run.aiPanels()[0], f.panel);
  assert.deepEqual(run.agentLabelSelectorsForHost('teams.microsoft.com'), M365_AGENT_LABEL);
  assert.equal(run.captureAllowed(f.dmComposer), false, 'a Teams DM is not the panel');
});

// ── 1. The flag. OFF is the shipped default ─────────────────────────────────

test('OFF BY DEFAULT: with the flag unset the reader returns nothing and reads nothing', () => {
  const f = teamsDom();
  const run = reader(f);                       // note: no flagOn — the shipped state
  const q = countLabelQueries(f.panel);

  assert.equal(run.getPanelAgentLabel(f.panel), null);
  assert.deepEqual(run.openPanelAgentLabels(), []);
  assert.equal(q.n, 0, 'a disabled reader must not even touch the DOM');
  assert.ok(run.flagKeys.includes('m365_agent_label_reader'),
    'the gate must be the opt-in flag, by that exact key');
});

test('the flag is checked on EVERY path, not only the aggregate one', () => {
  // A future caller that reaches getPanelAgentLabel() directly must hit the same
  // gate — otherwise "off" would depend on which entry point was used.
  const f = teamsDom();
  const run = reader(f);
  assert.equal(run.getPanelAgentLabel(f.panel), null);
  assert.ok(run.flagKeys.length >= 1);
});

test('with the flag ON, the open agent in the panel is read', () => {
  const f = teamsDom();
  const run = reader(f, { flagOn: true });
  assert.equal(run.getPanelAgentLabel(f.panel), 'IT Help Desk Agent');
  assert.deepEqual(run.openPanelAgentLabels(), ['it help desk agent']);
});

// ── 2. Panel scope ──────────────────────────────────────────────────────────

test('a name rendered OUTSIDE the panel is never read', () => {
  // The headline risk. "Finance Approvals Bot" is in the sidebar rail; the user
  // has the help-desk agent open. A document-wide read blocks the wrong agent.
  const f = teamsDom({ panelLabel: null, outsideLabel: 'Finance Approvals Bot' });
  const run = reader(f, { flagOn: true });
  assert.equal(run.getPanelAgentLabel(f.panel), null);
  assert.deepEqual(run.openPanelAgentLabels(), [],
    'an agent name in the sidebar is not an agent the user opened');
});

test('with the panel collapsed there is nothing to read at all', () => {
  const f = teamsDom({ panelVisible: false });
  const run = reader(f, { flagOn: true });
  assert.equal(run.aiPanels().length, 0, 'a collapsed panel is not an open panel');
  assert.deepEqual(run.openPanelAgentLabels(), []);
});

test('the reader region never touches `document`', () => {
  // Enforced structurally rather than behaviourally: the loader injects five free
  // variables and `document` is not one of them, so a document read would throw
  // here — but the source assertion is what stops one being added with a stub.
  const body = readerRegion();
  assert.doesNotMatch(codeOnly(body), /\bdocument\b/,
    'the reader must be scoped to the panel element, never to the document');
  assert.match(body, /panelEl\.querySelectorAll\(/,
    'the selector scan must run against the panel element');
});

// ── 3. Fail closed ──────────────────────────────────────────────────────────

test('no matching element in the panel is NO EVIDENCE, not a block', () => {
  const f = teamsDom({ panelLabel: null, outsideLabel: null });
  const run = reader(f, { flagOn: true });
  assert.equal(run.getPanelAgentLabel(f.panel), null);
  assert.deepEqual(run.openPanelAgentLabels(), []);
});

test('a host that serves no agent-label selectors reads nothing, flag or no flag', () => {
  // hubspot.com has a panel but no agentLabelSelectors. Absent must mean "no
  // agent-label read here", never "fall back to something".
  const composer = el({ tag: 'textarea', id: 'breeze-input' });
  const panel = el({
    tag: 'div', attrs: { class: 'copilot-panel' },
    children: [heading('IT Help Desk Agent'), composer],
  });
  const run = loadPanelAgentLabel({
    host: 'hubspot.com', document: doc([panel]), synced: SYNCED, flagOn: true,
  });
  assert.equal(run.agentLabelSelectorsForHost('hubspot.com'), null);
  assert.equal(run.getPanelAgentLabel(panel), null);
  assert.deepEqual(run.openPanelAgentLabels(), []);
});

test('with no synced surface map at all the reader is inert', () => {
  // There is deliberately NO built-in floor for these selectors: they are an
  // unverified guess, and a guess compiled into the extension needs a release to
  // correct. No sync ⇒ today's behaviour.
  const f = teamsDom();
  const run = reader(f, { flagOn: true, synced: undefined });
  assert.equal(run.agentLabelSelectorsForHost('teams.microsoft.com'), null);
  assert.deepEqual(run.openPanelAgentLabels(), []);
});

test('prose is not a display name — an over-long match is discarded', () => {
  // '.fai-AiGeneratedDisclaimer' and the combobox selector can wrap a whole
  // conversation. Substring-matching an agent name against a paragraph is where
  // an accidental block would come from.
  const long = 'AI-generated content may be incorrect. '.repeat(6) + 'IT Help Desk Agent';
  const f = teamsDom({ panelLabel: long });
  assert.ok(long.length > 120);
  const run = reader(f, { flagOn: true });
  assert.equal(run.getPanelAgentLabel(f.panel), null);
});

test('a one-character label is not a name either', () => {
  const f = teamsDom({ panelLabel: 'A' });
  const run = reader(f, { flagOn: true });
  assert.equal(run.getPanelAgentLabel(f.panel), null);
});

test('a null panel, or one that cannot be queried, returns null rather than throwing', () => {
  const f = teamsDom();
  const run = reader(f, { flagOn: true });
  assert.equal(run.getPanelAgentLabel(null), null);
  assert.equal(run.getPanelAgentLabel({}), null);
});

// ── 4. Caching, and the 500ms loop ──────────────────────────────────────────

test('the selector scan runs ONCE per panel, not once per enforcement tick', () => {
  // enforceBlockedAgent() runs twice a second. A per-tick querySelectorAll over
  // four selectors on a live Copilot pane is exactly the cost this cache exists
  // to avoid.
  const f = teamsDom();
  const run = reader(f, { flagOn: true });
  const q = countLabelQueries(f.panel);

  for (let i = 0; i < 10; i++) assert.equal(run.getPanelAgentLabel(f.panel), 'IT Help Desk Agent');
  assert.equal(q.n, 1, 'the panel was re-scanned on a repeat read');
});

test('a null read is cached too — a miss must not re-scan every tick', () => {
  const f = teamsDom({ panelLabel: null, outsideLabel: null });
  const run = reader(f, { flagOn: true });
  const q = countLabelQueries(f.panel);
  for (let i = 0; i < 10; i++) assert.equal(run.getPanelAgentLabel(f.panel), null);
  assert.equal(q.n, M365_AGENT_LABEL.length,
    'one pass over the selector list, then cached');
});

test('a change inside the panel invalidates the cached read', () => {
  const f = teamsDom();
  const run = reader(f, { flagOn: true });
  assert.equal(run.getPanelAgentLabel(f.panel), 'IT Help Desk Agent');

  // The user switches agents inside the pane.
  f.label.textContent = 'Finance Approvals Bot';
  assert.equal(run.getPanelAgentLabel(f.panel), 'IT Help Desk Agent',
    'until the observer fires, the cached read is what is returned');
  run.observers.fire(f.panel);
  assert.equal(run.getPanelAgentLabel(f.panel), 'Finance Approvals Bot',
    'a stale agent name is the one way this reader could block the wrong thing');
});

test('the MutationObserver is scoped to the panel element, never the document', () => {
  const f = teamsDom();
  const run = reader(f, { flagOn: true });
  run.getPanelAgentLabel(f.panel);

  assert.deepEqual(run.observers.targets(), [f.panel],
    'a document-wide observer on Teams fires on every message in every chat');
  const [{ options }] = run.observers.observers[0].watching;
  assert.equal(options.subtree, true);
  assert.ok(!('childList' in options) || options.childList === true);
});

test('one observer per panel, however many times it is read', () => {
  const f = teamsDom();
  const run = reader(f, { flagOn: true });
  for (let i = 0; i < 5; i++) {
    run.getPanelAgentLabel(f.panel);
    run.observers.fire(f.panel);
  }
  assert.equal(run.observers.observers.length, 1);
});

test('with no MutationObserver available, nothing is cached — freshness over staleness', () => {
  const f = teamsDom();
  const run = reader(f, { flagOn: true, noMutationObserver: true });
  const q = countLabelQueries(f.panel);
  assert.equal(run.getPanelAgentLabel(f.panel), 'IT Help Desk Agent');
  assert.equal(run.getPanelAgentLabel(f.panel), 'IT Help Desk Agent');
  assert.equal(q.n, 2, 'an entry that can never be invalidated must not be written');
});

// ── 5. PII discipline ───────────────────────────────────────────────────────

test('nothing the reader sees can leave the page', () => {
  // The identical guarantee getHeaderAgentText() carries (see the comment above
  // showBlockedAgentPopup): the text is compared against the org's own blocked
  // list in this closure and dropped. A governance product that uploaded whatever
  // string it scraped out of a customer's Copilot pane would be indefensible.
  const body = codeOnly(readerRegion());
  for (const forbidden of [
    /\bemit\s*\(/, /sendMessage/, /\bfetch\s*\(/, /XMLHttpRequest/, /navigator\.sendBeacon/,
    /\bconsole\b/, /\bclog\s*\(/, /localStorage/, /sessionStorage/, /chrome\./,
    /postMessage/, /\bnew Image\b/,
  ]) {
    assert.doesNotMatch(body, forbidden,
      `the agent-label reader must not reference ${forbidden}`);
  }
});

test('the label is never stored anywhere that outlives the panel element', () => {
  const body = codeOnly(readerRegion());
  assert.match(body, /new WeakMap\(\)/,
    'the per-panel cache must be a WeakMap, so a swapped-out pane drops its label');
  assert.doesNotMatch(body, /new Map\(\)|new Set\(\)/);
});

// ── 6. The wiring: an OR, never a replacement ───────────────────────────────

const onTeams = (over = {}) => loadBlockedAgentActive({
  host: 'teams.microsoft.com', blockedList: [AGENT], headerText: '', panelLabels: [], ...over,
});

test('the header signal alone still blocks — unchanged behaviour', () => {
  const run = onTeams({ headerText: 'IT Help Desk Agent | Microsoft 365 Copilot' });
  assert.equal(run.isBlockedAgentActive(), AGENT);
});

test('the panel signal alone blocks, which is the whole point of the phase', () => {
  // On M365 the header names no agent, so before this the block never fired.
  const run = onTeams({ headerText: 'Chat | Microsoft Teams', panelLabels: ['IT Help Desk Agent'] });
  assert.equal(run.isBlockedAgentActive(), AGENT);
});

test('neither signal ⇒ nothing is blocked', () => {
  const run = onTeams({ headerText: 'Chat | Microsoft Teams', panelLabels: [] });
  assert.equal(run.isBlockedAgentActive(), null);
});

test('a DIFFERENT agent open in the panel does not block the blocked one', () => {
  const run = onTeams({ headerText: 'Chat | Microsoft Teams', panelLabels: ['Finance Approvals Bot'] });
  assert.equal(run.isBlockedAgentActive(), null);
});

test('the panel read never runs for a host no blocked agent is published to', () => {
  // The short-circuit that keeps this off the 500ms path entirely: claude_ai_project
  // maps to claude.ai, so on Teams the row is skipped before any DOM read.
  const run = loadBlockedAgentActive({
    host: 'teams.microsoft.com',
    blockedList: [{ agent_id: 'agt-D', agent_name: 'Acme Project', platform: 'claude_ai_project' }],
    panelLabels: ['Acme Project'],
  });
  assert.equal(run.isBlockedAgentActive(), null);
  assert.equal(run.calls.panel, 0, 'a row that cannot apply here must not trigger a panel read');
});

test('an empty blocked list reads neither the header nor the panel', () => {
  const run = loadBlockedAgentActive({ host: 'teams.microsoft.com', blockedList: [] });
  assert.equal(run.isBlockedAgentActive(), null);
  assert.equal(run.calls.panel, 0);
  assert.equal(run.calls.header, 0);
});

test('the panel is read at most once per decision, however many rows match the host', () => {
  const run = loadBlockedAgentActive({
    host: 'teams.microsoft.com',
    blockedList: [OTHER, AGENT, { agent_id: 'x', agent_name: 'Third Bot', platform: 'teams_app' }],
    headerText: 'Chat | Microsoft Teams',
    panelLabels: ['Third Bot'],
  });
  assert.equal(run.isBlockedAgentActive().agent_name, 'Third Bot');
  assert.equal(run.calls.panel, 1);
});

test('a row with no usable name is skipped by both signals', () => {
  const run = loadBlockedAgentActive({
    host: 'teams.microsoft.com',
    blockedList: [{ agent_id: 'agt-z', agent_name: 'A', platform: 'copilot_studio' }],
    panelLabels: ['A'],
  });
  assert.equal(run.isBlockedAgentActive(), null);
});

test('the wiring is an OR in shipped source — the header read is not replaced', () => {
  const src = contentSource();
  const at = src.indexOf('function isBlockedAgentActive() {');
  const body = src.slice(at, src.indexOf('\n  }', at));
  assert.match(body, /const headerText = getHeaderAgentText\(\);/,
    'the header signal must still be computed');
  assert.match(body, /if \(agentNameMatchesText\(name, headerText\)\) return agent;/,
    'the existing header match must still be able to block on its own');
  assert.doesNotMatch(body, /headerText\.includes\(/,
    'the header signal must not fall back to a raw substring test');
  const header = body.indexOf('agentNameMatchesText(name, headerText)');
  const panel = body.indexOf('panelLabels()');
  assert.ok(header > 0 && panel > header,
    'the panel read must be an additional signal after the header one, not instead of it');
});

// ── 7. It must not widen what a block lands on ──────────────────────────────

test('a block decided from a panel label still only disables that panel', () => {
  // The line this whole feature is not allowed to cross. Deciding WHICH agent is
  // open must not change WHERE a block lands — blocked-agent-scope.test.mjs owns
  // that boundary, and this drives the real decision into the real enforcer to
  // show the new signal does not move it.
  const dmComposer = blockEl({ tag: 'div', id: 'dm-composer', attrs: { role: 'textbox' } });
  const panelComposer = blockEl({ tag: 'div', id: 'panel-composer', attrs: { role: 'textbox' } });
  const label = blockEl({ tag: 'div', className: 'fai-CopilotMessage__accessibleHeading' });
  label.textContent = 'IT Help Desk Agent';
  const panel = blockEl({
    tag: 'div', id: 'copilot-panel', attrs: { 'aria-label': 'Copilot chat' },
    children: [label, panelComposer],
  });
  const document = blockDoc([
    blockEl({ tag: 'div', id: 'chat-pane', children: [dmComposer] }),
    panel,
  ]);

  // The real reader, over this DOM, with the flag on.
  const rdr = loadPanelAgentLabel({
    host: 'teams.microsoft.com', document, synced: SYNCED, flagOn: true,
  });
  // The real decision, fed by the real reader.
  const decide = loadBlockedAgentActive({
    host: 'teams.microsoft.com',
    blockedList: [AGENT],
    headerText: 'Chat | Microsoft Teams',
    panelLabels: () => rdr.openPanelAgentLabels(),
  });
  const blocked = decide.isBlockedAgentActive();
  assert.equal(blocked, AGENT, 'the panel-label signal must be what fired here');

  // The real enforcer, over the same DOM, with that decision.
  const run = loadBlockedAgentScope({ host: 'teams.microsoft.com', document, agent: blocked });
  run.enforceBlockedAgent();
  assert.ok(isDisabled(panelComposer), 'the blocked agent\'s own composer');
  assert.ok(isUntouched(dmComposer),
    'blocking one bot is still not blocking Teams — the label read must not widen scope');
});

test('the enforcement region does not reach for the reader at all', () => {
  // WHERE a block lands and WHICH agent is blocked stay separate regions. The
  // reader is consumed only through isBlockedAgentActive().
  const src = contentSource();
  const start = src.indexOf('// ── blocked-agent enforcement scope ─');
  const end = src.indexOf('// ── end blocked-agent enforcement scope ─');
  assert.ok(start > 0 && end > start);
  const body = src.slice(start, end);
  assert.doesNotMatch(body, /getPanelAgentLabel|openPanelAgentLabels/);
});

// ── 8. The flag's default, pinned on shipped source ─────────────────────────

test('the reader is gated on the OPT-IN helper, not the default-on isFeatureOn', () => {
  const src = contentSource();
  const body = readerRegion();
  assert.match(body, /isOptInFeatureOn\(FEATURE_M365_AGENT_LABEL_READER\)/);
  assert.doesNotMatch(body, /isFeatureOn\(/,
    'isFeatureOn() treats an unknown key as ENABLED — wrong default for an unverified read');

  const at = src.indexOf('function isOptInFeatureOn(key) {');
  assert.ok(at > 0, 'the opt-in flag helper is gone');
  const helper = src.slice(at, src.indexOf('\n  }', at));
  assert.match(helper, /return !!f && f\.status === 'enabled';/,
    'an absent flag must read as OFF');
  assert.match(src, /const FEATURE_M365_AGENT_LABEL_READER = 'm365_agent_label_reader';/);
});

// ── 9. Which SOURCE the opt-in flag is read from ────────────────────────────
//
// There are two: the `data-cfai-features` attribute on <html>, which is a
// SNAPSHOT pushed at injection time, and `_cfaiFeatures`, the cache the service
// worker refreshes live. isFeatureOn() treats the attribute as authoritative
// only for keys it actually CONTAINS, and falls through otherwise.
// isOptInFeatureOn() used to `return` out of that branch unconditionally, so any
// key absent from the snapshot answered "off" from the older of the two sources
// while a fresher answer sat one line below — an admin who had just switched the
// reader on saw nothing until the next navigation.
//
// The fail-closed default is NOT what changed, and the last test here pins it.

/** The shipped isOptInFeatureOn(), over a controllable attribute and cache. */
function loadOptIn({ attribute, cache = {} } = {}) {
  const src = contentSource();
  const at = src.indexOf('function isOptInFeatureOn(key) {');
  const body = src.slice(at, src.indexOf('\n  }', at) + 4)
    + '\n  return isOptInFeatureOn;';
  const document = {
    documentElement: { getAttribute: () => (attribute === undefined ? null : attribute) },
  };
  // eslint-disable-next-line no-new-func
  return new Function('document', '_cfaiFeatures', body)(document, cache);
}

const ON = { status: 'enabled' };
const OFF = { status: 'disabled' };

test('a key PRESENT in the page snapshot is still answered from the snapshot', () => {
  const snapshot = JSON.stringify({ m365_agent_label_reader: OFF });
  const isOn = loadOptIn({ attribute: snapshot, cache: { m365_agent_label_reader: ON } });
  assert.equal(isOn('m365_agent_label_reader'), false,
    'the attribute is re-read every call precisely so a live-pushed change lands');
});

test('a key ABSENT from the snapshot falls through to the extension cache', () => {
  // The fix. A snapshot that predates the flag existing says nothing about it —
  // which is not the same as saying it is off.
  const snapshot = JSON.stringify({ dlp: ON });
  const isOn = loadOptIn({ attribute: snapshot, cache: { m365_agent_label_reader: ON } });
  assert.equal(isOn('m365_agent_label_reader'), true);
});

test('the fall-through matches isFeatureOn\'s shape, line for line', () => {
  const src = contentSource();
  const shape = /if \(raw\) \{ const f = JSON\.parse\(raw\); if \(f\[key\]\) return f\[key\]\.status === 'enabled'; \}/g;
  assert.equal((src.match(shape) || []).length, 2,
    'both flag helpers must gate the early return on the key being PRESENT');
});

test('nothing anywhere still means OFF — the opt-in default is unchanged', () => {
  assert.equal(loadOptIn()('m365_agent_label_reader'), false, 'no attribute, empty cache');
  assert.equal(loadOptIn({ attribute: '{}' })('m365_agent_label_reader'), false, 'empty snapshot');
  assert.equal(loadOptIn({ attribute: 'not json' })('m365_agent_label_reader'), false, 'malformed snapshot');
  assert.equal(loadOptIn({ attribute: JSON.stringify({ dlp: ON }) })('m365_agent_label_reader'), false,
    'absent from BOTH sources is still off — the fall-through adds a source, not a default');
  assert.equal(loadOptIn({ cache: { m365_agent_label_reader: OFF } })('m365_agent_label_reader'), false);
});

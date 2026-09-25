// A blocked AGENT must disable that agent, not the app it lives in.
//
// THE DEFECT. enforceBlockedAgent() had no scope check of any kind. It set
// pointer-events:none on every `textarea, [contenteditable="true"],
// [role="textbox"], [class*="textbox"]` in the document and armed two
// document-level capture-phase handlers that cancelled Enter and composer-area
// clicks for as long as isBlockedAgentActive() was truthy. On teams.microsoft.com
// — where a Copilot Studio agent is a tab next to the user's real DMs and
// channels — blocking ONE named agent therefore disabled EVERY composer in the
// tab: the browser twin of the "whole app is blocked" failure the desktop
// enforcer (agent/src/os_monitor/) is built to avoid, and the same failure
// showPlatformBanner() already refuses to commit by bailing out on
// IS_EMBEDDED_AI.
//
// THE FIX is to reuse the gate the platform-block path already uses —
// captureAllowed(), from the AI-surface scope region — in all three places a
// block can land: the element-disabling loop, the keydown handler, and the click
// handler. These tests drive the SHIPPED enforcement region against the SHIPPED
// gate over one fake DOM (see load-blocked-agent-scope.mjs), so "outside the
// panel" means what content.js means by it, not what a stub says.
//
// THE REGRESSION RISK is the other direction: captureAllowed() returns true
// unconditionally on a whole_site host, and enforcement there must stay exactly
// as strong as it was. That is asserted explicitly below.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  loadBlockedAgentScope, contentSource, el, doc, evt, isDisabled, isUntouched,
} from './load-blocked-agent-scope.mjs';

const AGENT = { agent_id: 'agt-7f3c', agent_name: 'IT Help Desk Agent', platform: 'copilot_studio' };

// ── Fixtures ────────────────────────────────────────────────────────────────
//
// teams.microsoft.com is in EMBEDDED_AI_FLOOR with selectors
// ['[aria-label*="Copilot" i]', '[data-tid*="copilot" i]'], so the Copilot panel
// below is resolved by the real gate, and the chat rail beside it is not.

function teamsDom({ panelVisible = true } = {}) {
  const dmComposer = el({ tag: 'div', id: 'dm-composer', attrs: { role: 'textbox' } });
  const dmSendBtn = el({ tag: 'button', id: 'dm-send', attrs: { 'aria-label': 'Send' } });
  const channelComposer = el({ tag: 'div', id: 'channel-composer', attrs: { role: 'textbox' } });
  const panelComposer = el({ tag: 'div', id: 'panel-composer', attrs: { role: 'textbox' } });
  const panelSendBtn = el({ tag: 'button', id: 'panel-send', attrs: { 'aria-label': 'Send' } });
  const panel = el({
    tag: 'div', id: 'copilot-panel', visible: panelVisible,
    attrs: { 'aria-label': 'Copilot chat' },
    children: [
      el({
        tag: 'div', id: 'panel-input-area', attrs: { class: 'copilot-composer' },
        children: [panelComposer, panelSendBtn],
      }),
    ],
  });

  const document = doc([
    // The user's real chat: a DM composer with its own send button, in a
    // container whose class matches the click handler's fuzzy composer test.
    el({
      tag: 'div', id: 'chat-pane', attrs: { class: 'ts-message-composer' },
      children: [dmComposer, dmSendBtn],
    }),
    el({ tag: 'div', id: 'channel-pane', children: [channelComposer] }),
    // The blocked agent's panel.
    panel,
  ]);

  return { document, panel, dmComposer, dmSendBtn, channelComposer, panelComposer, panelSendBtn };
}

function teams(fixture, agent = AGENT) {
  return loadBlockedAgentScope({ host: 'teams.microsoft.com', document: fixture.document, agent });
}

// ── The fixture itself has to be honest ─────────────────────────────────────

test('the fixture resolves exactly one Copilot panel on Teams, and it is embedded-AI', () => {
  const f = teamsDom();
  const run = teams(f);
  assert.equal(run.IS_EMBEDDED_AI, true, 'teams.microsoft.com must be an embedded-AI host');
  assert.equal(run.aiPanels().length, 1, 'the Copilot panel, and nothing else, must resolve');
  assert.equal(run.captureAllowed(f.panelComposer), true);
  assert.equal(run.captureAllowed(f.dmComposer), false, 'a Teams DM is not the AI panel');
});

// ── 1. The element-disabling loop ───────────────────────────────────────────

test('on Teams, a blocked agent disables the panel composer and ONLY it', () => {
  const f = teamsDom();
  const run = teams(f);
  run.enforceBlockedAgent();

  assert.ok(isDisabled(f.panelComposer),
    'the blocked agent\'s own composer must still be disabled');
  assert.ok(isUntouched(f.dmComposer),
    'a Teams DM composer must not be touched — blocking one bot is not blocking Teams');
  assert.ok(isUntouched(f.channelComposer),
    'nor a channel composer elsewhere on the page');
});

test('the 500ms re-application does not creep outwards on repeat runs', () => {
  // The interval calls this every half second. A gate that only held on the
  // first pass would look correct in a single-call test and still disable the
  // app a moment later.
  const f = teamsDom();
  const run = teams(f);
  for (let i = 0; i < 5; i++) run.enforceBlockedAgent();
  assert.ok(isDisabled(f.panelComposer));
  assert.ok(isUntouched(f.dmComposer));
  assert.ok(isUntouched(f.channelComposer));
});

test('with NO panel open, a blocked agent disables nothing at all', () => {
  // Fail closed in the safe direction: the gate cannot tell which surface is
  // the agent's, so it must not disable the customer's app on a guess.
  const f = teamsDom({ panelVisible: false });
  const run = teams(f);
  run.enforceBlockedAgent();
  assert.ok(isUntouched(f.dmComposer));
  assert.ok(isUntouched(f.channelComposer));
  assert.ok(isUntouched(f.panelComposer), 'a collapsed panel is not an open panel');
});

test('a composer disabled while the panel was open is released when it closes', () => {
  const f = teamsDom();
  const run = teams(f);
  run.enforceBlockedAgent();
  assert.ok(isDisabled(f.panelComposer));

  // The user closes the Copilot pane. The agent is still on the blocked list.
  f.panel.visible = false;
  assert.equal(run.aiPanels().length, 0);
  run.enforceBlockedAgent();

  assert.ok(isUntouched(f.panelComposer),
    'pointer-events:none must not outlive the panel it was scoped to');
});

test('our own Request Access reason box is still never disabled', () => {
  // Pre-existing guard, and it lives INSIDE the panel, so the new scope check
  // cannot be what is keeping it alive. Kept pinned.
  const reasonBox = el({ tag: 'textarea', id: 'cfai-reason', attrs: { role: 'textbox' } });
  const document = doc([
    el({
      tag: 'div', id: 'copilot-panel', attrs: { 'aria-label': 'Copilot chat' },
      children: [
        el({ tag: 'div', id: 'panel-composer', attrs: { role: 'textbox' } }),
        el({ tag: 'div', className: 'cfai-block-modal', children: [reasonBox] }),
      ],
    }),
  ]);
  const run = loadBlockedAgentScope({ host: 'teams.microsoft.com', document, agent: AGENT });
  run.enforceBlockedAgent();
  assert.ok(isUntouched(reasonBox));
});

test('when no agent is blocked, everything is restored', () => {
  const f = teamsDom();
  const run = teams(f);
  run.enforceBlockedAgent();
  assert.ok(isDisabled(f.panelComposer));

  run.state.agent = null;
  run.enforceBlockedAgent();
  assert.ok(isUntouched(f.panelComposer));
});

// ── 2. The keydown capture handler ──────────────────────────────────────────

test('on Teams, Enter in a DM is NOT swallowed while an agent is blocked', () => {
  // The headline bug. This handler is on `document` at capture phase, so with no
  // gate it cancelled every Enter in the tab and the user could not send a chat.
  const f = teamsDom();
  const run = teams(f);
  run.enforceBlockedAgent();

  const e = run.keydown(evt(f.dmComposer));
  assert.equal(e.defaultPrevented, false, 'the DM send must reach Teams');
  assert.equal(e.propagationStopped, false);
  assert.equal(run.popups.length, 0, 'and no "agent blocked" popup should appear');
});

test('on Teams, Enter in the blocked agent\'s composer IS swallowed', () => {
  const f = teamsDom();
  const run = teams(f);
  run.enforceBlockedAgent();

  const e = run.keydown(evt(f.panelComposer));
  assert.equal(e.defaultPrevented, true);
  assert.equal(e.propagationStopped, true);
  assert.deepEqual(run.popups, [AGENT], 'and the block is explained at the moment it happens');
});

test('Shift+Enter in the panel is still a newline, not a send', () => {
  const f = teamsDom();
  const run = teams(f);
  run.enforceBlockedAgent();
  const e = run.keydown(evt(f.panelComposer, { shiftKey: true }));
  assert.equal(e.defaultPrevented, false);
  assert.equal(run.popups.length, 0);
});

test('with no panel open, Enter anywhere on Teams is left alone', () => {
  const f = teamsDom({ panelVisible: false });
  const run = teams(f);
  run.enforceBlockedAgent();
  for (const target of [f.dmComposer, f.channelComposer, f.panelComposer]) {
    const e = run.keydown(evt(target));
    assert.equal(e.defaultPrevented, false, target.id);
  }
  assert.equal(run.popups.length, 0);
});

// ── 3. The click capture handler ────────────────────────────────────────────

test('on Teams, the DM Send button still works while an agent is blocked', () => {
  // #chat-pane carries class "ts-message-composer", which matches the handler's
  // `[class*="composer"]` proximity test — so the scope gate is the only thing
  // standing between the user and an un-sendable chat.
  const f = teamsDom();
  const run = teams(f);
  run.enforceBlockedAgent();

  const e = run.click(evt(f.dmSendBtn, { key: undefined }));
  assert.equal(e.defaultPrevented, false, 'clicking Send in a DM is not a prompt to the agent');
  assert.equal(run.popups.length, 0);
});

test('on Teams, the blocked agent\'s own Send button is still cancelled', () => {
  const f = teamsDom();
  const run = teams(f);
  run.enforceBlockedAgent();

  const e = run.click(evt(f.panelSendBtn, { key: undefined }));
  assert.equal(e.defaultPrevented, true);
  assert.equal(e.propagationStopped, true);
  assert.deepEqual(run.popups, [AGENT]);
});

// ── 4. whole_site hosts must be untouched by all of the above ───────────────

for (const host of ['chatgpt.com', 'claude.ai', 'cursor.com']) {
  test(`on ${host} (whole_site) enforcement is exactly as strong as before`, () => {
    // No AI panel exists or is needed here: the site IS the AI product, so
    // captureAllowed() short-circuits to true and every branch added above is a
    // no-op. If a future edit makes the gate conditional on a resolvable panel,
    // this is where per-agent blocking silently stops working on the dedicated
    // AI sites — which is the whole product.
    const composer = el({ tag: 'div', id: 'prompt-textarea', attrs: { role: 'textbox' } });
    const sendBtn = el({ tag: 'button', id: 'send', attrs: { 'aria-label': 'Send prompt' } });
    const sidebarSearch = el({ tag: 'textarea', id: 'search' });
    const document = doc([
      el({ tag: 'div', id: 'composer-bg', attrs: { class: 'composer-parent' }, children: [composer, sendBtn] }),
      el({ tag: 'nav', id: 'sidebar', children: [sidebarSearch] }),
    ]);
    const run = loadBlockedAgentScope({ host, document, agent: AGENT });

    assert.equal(run.IS_EMBEDDED_AI, false, `${host} must remain a whole_site host`);
    assert.equal(run.captureAllowed(composer), true);
    assert.equal(run.captureAllowed(sidebarSearch), true, 'whole_site means the whole site');

    run.enforceBlockedAgent();
    // Page-wide disabling is the CORRECT behaviour here, including the sidebar
    // search box — unchanged from before the fix.
    assert.ok(isDisabled(composer));
    assert.ok(isDisabled(sidebarSearch));

    const k = run.keydown(evt(composer));
    assert.equal(k.defaultPrevented, true);
    const k2 = run.keydown(evt(sidebarSearch));
    assert.equal(k2.defaultPrevented, true, 'Enter was blocked page-wide before, and still is');

    const c = run.click(evt(sendBtn, { key: undefined }));
    assert.equal(c.defaultPrevented, true);
    assert.equal(run.popups.length, 3);
  });
}

// ── 5. The wiring, pinned on shipped source ─────────────────────────────────
//
// The region is sliced and driven above, but a future edit could keep the tests
// green by re-adding a second, unscoped listener elsewhere. These assertions are
// about the shape of the shipped code, matching enforcement-scope.test.mjs.

const CONTENT = contentSource();

function enforcementRegion() {
  const at = CONTENT.indexOf('// ── blocked-agent enforcement scope ─');
  const end = CONTENT.indexOf('// ── end blocked-agent enforcement scope ─');
  assert.ok(at > 0 && end > at, 'blocked-agent enforcement sentinels missing or out of order');
  return CONTENT.slice(at, end);
}

test('all three enforcement paths go through captureAllowed', () => {
  const body = enforcementRegion();
  assert.match(body, /if \(!captureAllowed\(el\)\)/,
    'the disabling loop must skip elements outside the AI panel');
  const gates = body.match(/captureAllowed\(e\.target\)/g) || [];
  assert.equal(gates.length, 2,
    'both the keydown and the click capture handlers must gate on e.target');
});

test('the click handler gates on scope BEFORE its composer-proximity test', () => {
  const body = enforcementRegion();
  const gate = body.indexOf('captureAllowed(e.target)', body.indexOf("addEventListener('click'"));
  const proximity = body.indexOf('[class*="composer"]');
  assert.ok(gate > 0 && proximity > gate,
    'the fuzzy composer/class match must never be reached for an out-of-panel click');
});

test('the dead cfai-blocked-agents postMessage is gone', () => {
  // It claimed to feed content/fetch-blocker.js, which has never registered a
  // window message listener and whose own header says agent blocking is NOT
  // handled there. All it actually did was publish the org's blocked-agent
  // names and ids into the page's main world.
  assert.ok(!/cfai-blocked-agents/.test(CONTENT),
    'content.js must not broadcast the blocked-agent list to the page');
});

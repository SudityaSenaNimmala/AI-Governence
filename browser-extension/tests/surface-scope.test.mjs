// The AI-surface capture gate — the privacy guarantee.
//
// THE DEFECT THIS PINS DOWN. Governance scope was decided per HOST and enforced
// across the whole PAGE. The registry governs mail.google.com for "Gemini in
// Gmail", hubspot.com for HubSpot AI, github.com for Copilot — and once a host was
// governed the DLP stack was injected into the whole tab, where content.js
// captured from every textarea, contenteditable and file input on it. Production
// held 186 events from app.hubspot.com, 32 from github.com and 6 from a SharePoint
// tenant: ordinary compose fields, with stored content, collected under an
// AI-governance policy.
//
// The rule now: on an embedded-AI host, capture only inside a VISIBLE AI panel,
// and nothing at all when no panel is open. Under-collecting is a reportable gap;
// collecting employee email is a compliance incident, so the failure mode is
// deliberately the first one.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { loadSurfaceScope, el, doc, contentSource } from './load-surface-scope.mjs';

// A Gmail-shaped page: an ordinary mail composer, and optionally the Gemini panel.
function gmailPage({ geminiOpen = false, geminiVisible = true } = {}) {
  const mailBox = el({ tag: 'div', attrs: { 'aria-label': 'Message Body', contenteditable: 'true' } });
  const mailCompose = el({ tag: 'div', attrs: { 'aria-label': 'New Message' }, children: [mailBox] });
  const children = [mailCompose];
  let geminiBox = null;
  if (geminiOpen) {
    geminiBox = el({ tag: 'textarea', attrs: { 'aria-label': 'Ask Gemini' } });
    children.push(el({
      tag: 'div',
      attrs: { 'aria-label': 'Gemini side panel' },
      visible: geminiVisible,
      children: [geminiBox],
    }));
  }
  return { page: doc(children), mailBox, geminiBox };
}

test('Gmail with no Gemini panel captures NOTHING', () => {
  const { page, mailBox } = gmailPage({ geminiOpen: false });
  const s = loadSurfaceScope('mail.google.com', page);

  assert.equal(s.IS_EMBEDDED_AI, true, 'Gmail must be treated as an embedded-AI host');
  assert.equal(s.captureAllowed(mailBox), false, 'the mail composer was captured');
  assert.equal(s.captureAllowed(null), false, 'a page-level event was captured with no panel open');
});

test('Gmail with the Gemini panel open captures inside it, not the mail composer', () => {
  const { page, mailBox, geminiBox } = gmailPage({ geminiOpen: true });
  const s = loadSurfaceScope('mail.google.com', page);

  assert.equal(s.captureAllowed(geminiBox), true, 'the Gemini composer was NOT captured');
  assert.equal(s.captureAllowed(mailBox), false, 'the mail composer was captured while Gemini was open');
});

// A collapsed side panel is still in the DOM. Treating it as open would re-govern
// the whole page — the original bug wearing a different hat.
test('a hidden panel does not count as an open panel', () => {
  const { page, mailBox, geminiBox } = gmailPage({ geminiOpen: true, geminiVisible: false });
  const s = loadSurfaceScope('mail.google.com', page);

  assert.deepEqual(s.aiPanels(), []);
  assert.equal(s.captureAllowed(geminiBox), false);
  assert.equal(s.captureAllowed(mailBox), false);
});

test('a dedicated AI site is unrestricted — no behaviour change', () => {
  const box = el({ tag: 'textarea' });
  for (const host of ['claude.ai', 'chatgpt.com', 'gemini.google.com', 'perplexity.ai']) {
    const s = loadSurfaceScope(host, doc([box]));
    assert.equal(s.IS_EMBEDDED_AI, false, `${host} must not be scoped`);
    assert.equal(s.captureAllowed(box), true);
    assert.equal(s.captureAllowed(null), true);
  }
});

// gemini.google.com and mail.google.com are both *.google.com. A sloppy suffix
// match would drag Gemini into embedded_ai and silence the platform that is meant
// to be fully governed.
test('Gemini is not caught by the Gmail entry', () => {
  const box = el({ tag: 'textarea' });
  const s = loadSurfaceScope('gemini.google.com', doc([box]));
  assert.equal(s.IS_EMBEDDED_AI, false);
  assert.equal(s.captureAllowed(box), true);
});

test('the gate reaches through a shadow root', () => {
  // These panels are routinely rendered in a shadow root, so an element inside
  // one must still resolve to its host panel. The panel carries its own composer
  // in the light DOM, which is what qualifies it as a panel at all.
  const panelComposer = el({ tag: 'textarea' });
  const panel = el({ tag: 'div', attrs: { 'aria-label': 'Copilot chat' }, children: [panelComposer] });
  const inner = el({ tag: 'textarea' });
  inner.shadowHost = panel;
  const page = doc([panel]);
  const s = loadSurfaceScope('github.com', page);

  assert.equal(s.captureAllowed(inner), true, 'a shadow-DOM element inside the panel was rejected');
  const outside = el({ tag: 'textarea' });
  assert.equal(s.captureAllowed(outside), false, 'an element outside the panel was accepted');
});

// ── The live regression: Gmail's permanent Gemini launcher ──────────────────
//
// Reported from a real test — the banner appeared on the bare Gmail inbox. Gmail
// keeps a Gemini button in its toolbar at all times, and that button's aria-label
// contains "Gemini", so a name-only selector matched it, the page looked like it
// had an open AI panel, and both the notice and capture were enabled on ordinary
// mail. A panel now has to be something a prompt can be typed into.

function gmailWithLauncherOnly() {
  const launcher = el({ tag: 'button', attrs: { 'aria-label': 'Ask Gemini' } });
  const mailBox = el({ tag: 'div', attrs: { 'aria-label': 'Message Body', contenteditable: 'true' } });
  return { page: doc([launcher, mailBox]), launcher, mailBox };
}

test('the toolbar Gemini launcher is not an open panel', () => {
  const { page, mailBox } = gmailWithLauncherOnly();
  const s = loadSurfaceScope('mail.google.com', page);

  assert.deepEqual(s.aiPanels(), [], 'the launcher button counted as an open AI panel');
  assert.equal(s.captureAllowed(mailBox), false, 'the mail composer was captured on the bare inbox');
  assert.equal(s.captureAllowed(null), false);
});

test('a launcher plus a real open panel still governs the panel', () => {
  const launcher = el({ tag: 'button', attrs: { 'aria-label': 'Ask Gemini' } });
  const geminiBox = el({ tag: 'textarea', attrs: { 'aria-label': 'Enter a prompt' } });
  const panel = el({ tag: 'div', attrs: { 'aria-label': 'Gemini' }, children: [geminiBox] });
  const mailBox = el({ tag: 'div', attrs: { 'aria-label': 'Message Body', contenteditable: 'true' } });
  const s = loadSurfaceScope('mail.google.com', doc([launcher, panel, mailBox]));

  assert.equal(s.aiPanels().length, 1, 'expected exactly the panel, not the launcher too');
  assert.equal(s.captureAllowed(geminiBox), true, 'the Gemini composer was not governed');
  assert.equal(s.captureAllowed(mailBox), false, 'the mail composer was governed');
});

test('a named container with no composer is not a panel', () => {
  // A heading, a tooltip, a menu item — anything that carries the AI's name but
  // cannot be typed into.
  const label = el({ tag: 'span', attrs: { 'aria-label': 'Gemini' } });
  const mailBox = el({ tag: 'div', attrs: { 'aria-label': 'Message Body', contenteditable: 'true' } });
  const s = loadSurfaceScope('mail.google.com', doc([label, mailBox]));
  assert.deepEqual(s.aiPanels(), []);
  assert.equal(s.captureAllowed(mailBox), false);
});

test('every over-collecting host from production is now scoped', () => {
  for (const host of [
    'mail.google.com', 'app.hubspot.com', 'github.com',
    'cloudfuzecom-my.sharepoint.com', 'marketingcloudfuze.zendesk.com',
    'docs.google.com',
  ]) {
    const s = loadSurfaceScope(host, doc([]));
    assert.equal(s.IS_EMBEDDED_AI, true, `${host} is still unscoped`);
    // Nothing on the page at all -> nothing captured.
    assert.equal(s.captureAllowed(el({ tag: 'textarea' })), false, `${host} still captures with no panel`);
  }
});

// The built-in list is the floor. A server that is unreachable, or returns
// nothing, must not restore whole-page capture on Gmail.
test('the built-in floor applies with no synced map', () => {
  const { page, mailBox } = gmailPage({ geminiOpen: false });
  const s = loadSurfaceScope('mail.google.com', page, undefined);
  assert.equal(s.IS_EMBEDDED_AI, true);
  assert.equal(s.captureAllowed(mailBox), false);
});

test('the synced map can add a host the floor does not carry', () => {
  const box = el({ tag: 'textarea' });
  const synced = { embedded: { 'notion.so': { selectors: ['[aria-label*="Notion AI" i]'] } } };
  const s = loadSurfaceScope('www.notion.so', doc([box]), synced);
  assert.equal(s.IS_EMBEDDED_AI, true, 'a server-added host was ignored');
  assert.equal(s.captureAllowed(box), false, 'captured with no panel on a server-added host');
});

// A selector matching the bare token "ai" also matches "mail" — on Gmail that
// re-selects the entire mail UI and reproduces the original bug exactly.
test('no built-in selector keys on a bare "ai" token', () => {
  const s = loadSurfaceScope('claude.ai', doc([]));
  for (const [host, sels] of Object.entries(s.EMBEDDED_AI_FLOOR)) {
    for (const sel of sels) {
      assert.doesNotMatch(sel, /\*=\s*"ai"/i,
        `${host}: ${sel} matches "ai", which also matches "mail"`);
    }
  }
});

test('a malformed selector is skipped rather than throwing', () => {
  const box = el({ tag: 'textarea' });
  const synced = { embedded: { 'example.com': { selectors: ['[[[not-a-selector'] } } };
  const page = doc([box]);
  page.querySelectorAll = (sel) => { if (sel.includes('[[[')) throw new Error('bad selector'); return []; };
  const s = loadSurfaceScope('example.com', page, synced);
  assert.equal(s.captureAllowed(box), false);   // fails closed, does not crash
});

// ── Routing must never run on an embedded-AI host ───────────────────────────
//
// Reported live: with the Gemini panel open in Gmail, pressing any button showed a
// "Model Routed" toast and the button did nothing. Routing pauses the event with
// preventDefault() and then clicks around hunting for a model label — on a host
// app that means hijacking that app's own buttons. These panels have no model
// picker to switch, so there is nothing to gain and a working app to break.
//
// Asserted against the shipped source, because the guard sits in the send path
// rather than in the sliced region.
test('the send path refuses to route on an embedded-AI host', () => {
  const src = contentSource();
  // Asserts the PROPERTY, not the exact expression. The first version pinned
  // `if (!_skipRouting && !IS_EMBEDDED_AI)` verbatim and broke the moment a
  // feature-flag condition was legitimately appended to the same line — a test
  // failing on a correct change is worse than no test.
  const guard = src.split(/\r?\n/).find((l) => l.includes('!_skipRouting'));
  assert.ok(guard, 'the routing guard line is gone entirely');
  assert.ok(guard.includes('!IS_EMBEDDED_AI'),
    'the routing block is no longer guarded by IS_EMBEDDED_AI — Gmail buttons will break again');
});

// ── Microsoft publish surfaces ──────────────────────────────────────────────
//
// A Copilot Studio agent is one Dataverse object published to many places: M365
// Copilot, Teams (including the desktop app), SharePoint, Outlook, Power Apps,
// Dynamics, Direct Line. The admin does not know which. Since enforcement here is
// browser-only, the extension has to be PRESENT on every browser surface — a
// blocklist cannot act on a page it was never injected into.
//
// The danger in doing that: Teams is a chat client and Outlook is mail. Injecting
// the DLP stack there without scoping capture to the Copilot panel would recreate
// the over-collection defect at a far worse scale than HubSpot did — every Teams
// message, every email. So each surface added for BLOCKING must also be in the
// embedded-AI floor. Agent blocking itself runs on its own interval and is not
// gated by the capture scope, which is what makes the pairing safe.

const MS_SURFACES = [
  ['teams.microsoft.com',          'Teams'],
  ['m365.cloud.microsoft',         'M365 Copilot'],
  ['contoso.sharepoint.com',       'SharePoint'],
  ['outlook.office.com',           'Outlook'],
  ['outlook.office365.com',        'Outlook (legacy host)'],
  ['org32322095.crm.dynamics.com', 'Dynamics / Dataverse'],
  ['copilotstudio.microsoft.com',  'Copilot Studio authoring'],
  ['make.powerapps.com',           'Power Apps'],
];

test('every Microsoft publish surface is scoped to the Copilot panel', () => {
  for (const [host, label] of MS_SURFACES) {
    const s = loadSurfaceScope(host, doc([]));
    assert.equal(s.IS_EMBEDDED_AI, true,
      `${label} (${host}) is unscoped — injecting there would capture the whole app`);
  }
});

test('a Teams message and an Outlook mail body are not captured', () => {
  // The precise failure being prevented: these are the app's own composers, not
  // an AI prompt, and there is no Copilot panel open.
  for (const [host, label] of [['teams.microsoft.com', 'Teams'], ['outlook.office.com', 'Outlook']]) {
    const composer = el({ tag: 'div', attrs: { 'aria-label': 'Message', contenteditable: 'true' } });
    const s = loadSurfaceScope(host, doc([composer]));
    assert.equal(s.captureAllowed(composer), false, `${label}: the app's own composer was captured`);
    assert.equal(s.captureAllowed(null), false, `${label}: a page-level event was captured`);
  }
});

test('a Copilot panel on a Microsoft surface IS captured', () => {
  const panelBox = el({ tag: 'textarea', attrs: { 'aria-label': 'Ask Copilot' } });
  const panel = el({ tag: 'div', attrs: { 'aria-label': 'Copilot' }, children: [panelBox] });
  const teamsBox = el({ tag: 'div', attrs: { 'aria-label': 'Message', contenteditable: 'true' } });
  const s = loadSurfaceScope('teams.microsoft.com', doc([panel, teamsBox]));

  assert.equal(s.captureAllowed(panelBox), true, 'the Copilot composer was not governed');
  assert.equal(s.captureAllowed(teamsBox), false, 'the Teams message composer was governed');
});

// Agent blocking must work on every surface regardless of capture scope — it is
// enforcement, not collection. If it were gated, adding these hosts as
// embedded_ai would silently disable the very blocking they were added for.
test('agent blocking is not gated by the capture scope', () => {
  const src = contentSource();
  const start = src.indexOf('function enforceBlockedAgent');
  assert.ok(start > 0, 'enforceBlockedAgent not found');
  const body = src.slice(start, src.indexOf('\n  }', start));
  assert.ok(!body.includes('captureAllowed'),
    'enforceBlockedAgent now consults captureAllowed — blocking would stop working outside AI panels');
  assert.ok(!body.includes('IS_EMBEDDED_AI'),
    'enforceBlockedAgent now consults IS_EMBEDDED_AI — blocking would stop working on Teams/Outlook');
});

// ── A platform block must not disable the host app ──────────────────────────
//
// Reported live: blocking "Gemini in Gmail" made the whole of Gmail unusable —
// "I am not able to click any button". The send blocking was already correctly
// scoped (tryBlock returns early unless captureAllowed puts the element inside the
// AI panel, so mail still sends). The damage was the NOTICE: a full-width bar at
// position:fixed top:0 with the maximum z-index and no pointer-events:none, which
// sat over Gmail's own toolbar and swallowed every click in that strip.
//
// Blocking one panel inside a mail client must not look like, or behave like,
// disabling the mail client.

function platformBannerBody() {
  const src = contentSource();
  const start = src.indexOf('function showPlatformBanner()');
  assert.ok(start > 0, 'showPlatformBanner is gone');
  return src.slice(start, src.indexOf('\n  }', start));
}

test('the page-wide block banner is suppressed on an embedded-AI host', () => {
  const body = platformBannerBody();
  assert.ok(body.includes('IS_EMBEDDED_AI'),
    'showPlatformBanner no longer checks IS_EMBEDDED_AI — it will cover the host app again');
  // The guard has to be an early return, not merely a mention.
  const guardIdx = body.indexOf('IS_EMBEDDED_AI');
  const createIdx = body.indexOf('createElement');
  assert.ok(createIdx === -1 || guardIdx < createIdx,
    'the IS_EMBEDDED_AI check comes after the banner is built — it would still render');
});

test('the block banner cannot intercept clicks anywhere', () => {
  // It is a notice, not a control. On a dedicated AI site it still spans the top
  // of the page, so swallowing clicks there is wrong too.
  assert.ok(platformBannerBody().includes('pointer-events:none'),
    'the banner can swallow clicks meant for the page underneath it');
});

test('a platform block still refuses a prompt inside the AI panel', () => {
  // The block must survive being scoped — losing enforcement would be a worse bug
  // than the obstruction it replaced.
  const geminiBox = el({ tag: 'textarea', attrs: { 'aria-label': 'Enter a prompt' } });
  const panel = el({ tag: 'div', attrs: { 'aria-label': 'Gemini' }, children: [geminiBox] });
  const mailBox = el({ tag: 'div', attrs: { 'aria-label': 'Message Body', contenteditable: 'true' } });
  const s = loadSurfaceScope('mail.google.com', doc([panel, mailBox]));

  assert.equal(s.captureAllowed(geminiBox), true, 'the panel is no longer governed at all');
  assert.equal(s.captureAllowed(mailBox), false, 'the mail composer became governed');
});

// ── The click origin must be in the panel, not just the resolved input ──────
//
// Reported live: with Gemini blocked in Gmail, clicking ANY button showed the
// blocked popup and the button did nothing.
//
// The button handler resolves its element with
// `findPromptInputFor(btn) || findActivePromptInput()`, and looksLikeSendButton()
// matches ordinary Gmail toolbar buttons. So a click on Archive resolved to the
// Gemini panel's composer — which IS inside the panel — the gate passed on that
// element, and the click was cancelled. Checking the resolved input alone cannot
// distinguish "the user sent a prompt" from "the user clicked something else
// while a panel happened to be open".

test('a Gmail toolbar click is not treated as a prompt send while Gemini is open', () => {
  const geminiBox = el({ tag: 'textarea', attrs: { 'aria-label': 'Enter a prompt' } });
  const panel = el({ tag: 'div', attrs: { 'aria-label': 'Gemini' }, children: [geminiBox] });
  const archiveBtn = el({ tag: 'button', attrs: { 'aria-label': 'Archive' } });
  const s = loadSurfaceScope('mail.google.com', doc([panel, archiveBtn]));

  // The resolved input is the panel's composer and passes on its own …
  assert.equal(s.captureAllowed(geminiBox), true);
  // … but the thing actually clicked does not, which is what must decide it.
  assert.equal(s.captureAllowed(archiveBtn), false,
    'a Gmail toolbar button was treated as inside the AI panel');
});

test('the send path checks the event origin, not only the resolved input', () => {
  const src = contentSource();
  const start = src.indexOf('function tryBlock(el, e, label)');
  assert.ok(start > 0, 'tryBlock is gone');
  const head = src.slice(start, start + 2000);
  assert.ok(head.includes('e.target'),
    'tryBlock no longer checks the event origin — any button click will read as a prompt send again');
  const originIdx = head.indexOf('captureAllowed(origin)');
  assert.ok(originIdx > 0, 'the origin is not passed through captureAllowed');
  // It has to be an early return, before any enforcement branch runs.
  const platformIdx = head.indexOf('PLATFORM_BLOCKED');
  assert.ok(platformIdx === -1 || originIdx < platformIdx,
    'the origin check comes after the platform-block branch — the click would still be cancelled');
});

test('a real send from inside the panel is still blocked', () => {
  // The origin check must not cost the enforcement: pressing Enter in the panel
  // has the composer as its own event target, so it still qualifies.
  const geminiBox = el({ tag: 'textarea', attrs: { 'aria-label': 'Enter a prompt' } });
  const panel = el({ tag: 'div', attrs: { 'aria-label': 'Gemini' }, children: [geminiBox] });
  const s = loadSurfaceScope('mail.google.com', doc([panel]));
  assert.equal(s.captureAllowed(geminiBox), true, 'a genuine prompt send stopped being governed');
});

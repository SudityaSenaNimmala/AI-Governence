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

import { loadSurfaceScope, el, doc } from './load-surface-scope.mjs';

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

// When the "governed by CloudFuze" notice is shown.
//
// THE DEFECT THIS PINS DOWN. The banner appeared as soon as the HOST verdict said
// govern. On a dedicated AI site that is correct. On a SaaS app where AI is one
// panel it was both wrong and alarming: opening a Gmail inbox popped "governed by
// CloudFuze" while the user read ordinary mail, under a "Google" label, implying
// their mail was being watched. Nothing was being captured from the mail at that
// point once the surface gate landed — so the notice was a false alarm, which is
// its own kind of harm for a governance product.
//
// The rule now matches capture exactly: on an embedded-AI host the notice appears
// only when an AI panel is actually open, and it names the AI feature rather than
// the host's vendor.
//
// The region is sliced out of content/fingerprint.js the same way the other
// loaders here slice content.js — the file is a classic-script IIFE that cannot be
// imported, and this region's only free variables are document, MutationObserver,
// setTimeout and the escapeHtml helper it sits beside.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(here, '..', 'content', 'fingerprint.js'), 'utf8');

const START = '// ── When to tell the user they are governed ─';
// Stops at the renderer, deliberately: including it would pull the real
// showGovernanceBanner into the slice, where its local declaration would shadow
// the recording stub this test injects, and every assertion about WHEN the notice
// fires would instead exercise real DOM calls.
const END = '  function showGovernanceBanner(v) {';

function region() {
  const from = src.indexOf(START);
  const to = src.indexOf(END);
  if (from < 0) throw new Error(`fingerprint.js sentinel not found: ${START}`);
  if (to <= from) throw new Error('fingerprint.js notice sentinels are out of order');
  return src.slice(from, to);
}

/** A DOM stub recording what got appended, with controllable panel visibility. */
function harness({ panelPresent = false, panelVisible = true } = {}) {
  const appended = [];
  let present = panelPresent;
  const observers = [];

  // A panel is something a prompt can be typed into. The launcher button that
  // opens it is NOT — Gmail keeps one in its toolbar permanently, and matching it
  // is what made the banner appear on the bare inbox.
  const composer = { matches: (sel) => /textarea/.test(sel) };
  const panelNode = {
    getClientRects: () => (panelVisible ? [{ width: 10, height: 10 }] : []),
    matches: () => false,                       // a container, not a control
    querySelector: (sel) => (/textarea/.test(sel) ? composer : null),
  };
  const launcherNode = {
    getClientRects: () => [{ width: 24, height: 24 }],
    matches: (sel) => /button/.test(sel),       // it IS a control
    querySelector: () => null,                  // nothing to type into
  };

  const document = {
    documentElement: { appendChild: (el) => appended.push(el) },
    querySelector: () => null,          // no pre-existing banner
    // The launcher is ALWAYS present, exactly as in Gmail; the panel only when opened.
    querySelectorAll: (sel) => (/Gemini|Copilot|Breeze|Einstein/i.test(sel)
      ? (present ? [launcherNode, panelNode] : [launcherNode])
      : []),
  };

  class FakeMutationObserver {
    constructor(cb) { this.cb = cb; observers.push(this); this.live = false; }
    observe() { this.live = true; }
    disconnect() { this.live = false; }
  }

  const timers = [];
  const setTimeoutStub = (fn) => { timers.push(fn); return timers.length; };

  return {
    appended, observers, timers,
    openPanel() { present = true; },
    flush() { for (const o of observers) if (o.live) o.cb(); const t = timers.splice(0); for (const fn of t) fn(); },
    load(host = 'mail.google.com') {
      const body = 'const window = { location: { hostname: ' + JSON.stringify(host) + ' } };\n'
        + region()
        + '\n  function escapeHtml(s){return String(s);}'
        + '\n  return { announceGovernance, panelsVisible, EMBEDDED_AI_FLOOR, floorSelectorsForHost };';
      // showGovernanceBanner lives outside the sliced region, so a recording stub
      // stands in for it — this test is about WHEN it is called, not its markup.
      const shown = [];
      // eslint-disable-next-line no-new-func
      const run = new Function('document', 'MutationObserver', 'setTimeout', 'showGovernanceBanner', body);
      const api = run(document, FakeMutationObserver, setTimeoutStub, (v) => shown.push(v));
      return { ...api, shown };
    },
  };
}

const GMAIL_VERDICT = {
  should_govern: true,
  surface_scope: 'embedded_ai',
  surface_product: 'Gemini in Gmail',
  vendor: 'Google',
  panel_selectors: ['[aria-label*="Gemini" i]'],
  confidence: 0.98,
};

const CLAUDE_VERDICT = {
  should_govern: true,
  surface_scope: 'whole_site',
  surface_product: null,
  vendor: 'Anthropic',
  panel_selectors: [],
  confidence: 0.99,
};

test('a dedicated AI site announces immediately — unchanged', () => {
  const h = harness();
  const { announceGovernance, shown } = h.load('claude.ai');
  announceGovernance(CLAUDE_VERDICT);
  assert.equal(shown.length, 1);
});

test('Gmail with no Gemini panel shows NO notice', () => {
  const h = harness({ panelPresent: false });
  const { announceGovernance, shown } = h.load();
  announceGovernance(GMAIL_VERDICT);
  assert.equal(shown.length, 0, 'the notice fired while the user was just reading mail');
});

test('Gmail with the panel already open announces at once', () => {
  const h = harness({ panelPresent: true });
  const { announceGovernance, shown } = h.load();
  announceGovernance(GMAIL_VERDICT);
  assert.equal(shown.length, 1);
});

test('the notice appears when the panel is opened later', () => {
  const h = harness({ panelPresent: false });
  const { announceGovernance, shown } = h.load();
  announceGovernance(GMAIL_VERDICT);
  assert.equal(shown.length, 0, 'announced before the panel existed');

  h.openPanel();
  h.flush();                       // a DOM mutation, then the debounce firing
  assert.equal(shown.length, 1, 'the notice never appeared after the panel opened');
});

test('a collapsed panel is not an open panel', () => {
  const h = harness({ panelPresent: true, panelVisible: false });
  const { announceGovernance, shown, panelsVisible } = h.load();
  assert.equal(panelsVisible(['[aria-label*="Gemini" i]']), false);
  announceGovernance(GMAIL_VERDICT);
  assert.equal(shown.length, 0);
});

test('the notice fires once, not on every mutation', () => {
  const h = harness({ panelPresent: false });
  const { announceGovernance, shown } = h.load();
  announceGovernance(GMAIL_VERDICT);
  h.openPanel();
  h.flush();
  h.flush();
  h.flush();
  assert.equal(shown.length, 1, `the banner fired ${shown.length} times`);
});

test('the observer disconnects after firing', () => {
  const h = harness({ panelPresent: false });
  const { announceGovernance } = h.load();
  announceGovernance(GMAIL_VERDICT);
  assert.equal(h.observers.some((o) => o.live), true, 'nothing is watching for the panel');
  h.openPanel();
  h.flush();
  assert.equal(h.observers.every((o) => !o.live), true, 'the observer kept running after firing');
});

test('a scoped host with no known panel selectors stays silent', () => {
  // Capture is gated by the same unknown, so there is nothing to announce.
  //
  // The host must be one the FLOOR does not cover, otherwise the floor supplies
  // selectors and the notice correctly proceeds — which is what makes an empty
  // panel_selectors list on a Gmail verdict harmless rather than silencing.
  const h = harness({ panelPresent: true });
  const { announceGovernance, shown } = h.load('some-scoped-saas.example');
  announceGovernance({ ...GMAIL_VERDICT, panel_selectors: [], surface_product: null });
  assert.equal(shown.length, 0);
});

test('an empty selector list from the server falls back to the floor', () => {
  // The inverse of the case above, and the reason the fallback exists: a verdict
  // that carries the scope but no selectors must not silence a host the extension
  // already knows how to scope.
  const h = harness({ panelPresent: true });
  const { announceGovernance, shown } = h.load('mail.google.com');
  announceGovernance({ ...GMAIL_VERDICT, panel_selectors: [] });
  assert.equal(shown.length, 1, 'the floor selectors were not used as a fallback');
});

// The banner copy is outside the sliced region, so assert on the source: these
// two strings are what stop the notice reading as blanket surveillance.
test('the banner names the AI feature and states the scope', () => {
  assert.match(src, /surface_product \|\| v\.vendor/,
    'the banner still leads with the host vendor rather than the AI feature');
  assert.match(src, /Only your AI prompts here are governed/,
    'the banner no longer tells the user the rest of the app is not governed');
});

// ── The regression that shipped: fail-open against an old server ────────────
//
// The first version of this gate read surface_scope from the SERVER VERDICT only.
// Against a server that predates the field — or one unreachable, or a verdict
// cached from before the upgrade — surface_scope is undefined, the embedded test
// is false, and the notice announced on Gmail the moment the inbox opened. That
// is fail-OPEN on precisely the case the gate exists for, and it is what a live
// test caught: the fix was deployed to the extension before the server, so every
// verdict arrived without the field.

const LEGACY_VERDICT = {
  should_govern: true,
  vendor: 'Google',
  confidence: 0.98,
  // no surface_scope, no panel_selectors — an old or unreachable server
};

test('an old server verdict does NOT re-enable the load-time banner on Gmail', () => {
  const h = harness({ panelPresent: false });
  const { announceGovernance, shown } = h.load('mail.google.com');
  announceGovernance({ ...LEGACY_VERDICT });
  assert.equal(shown.length, 0,
    'the banner fired on the Gmail inbox because the server sent no surface_scope');
});

test('with an old server verdict the notice still appears when Gemini opens', () => {
  const h = harness({ panelPresent: false });
  const { announceGovernance, shown } = h.load('mail.google.com');
  announceGovernance({ ...LEGACY_VERDICT });
  h.openPanel();
  h.flush();
  assert.equal(shown.length, 1, 'the floor gated the notice but never let it through');
});

test('an old server verdict still announces immediately on a dedicated AI site', () => {
  const h = harness();
  const { announceGovernance, shown } = h.load('claude.ai');
  announceGovernance({ ...LEGACY_VERDICT, vendor: 'Anthropic' });
  assert.equal(shown.length, 1, 'a whole-site AI product went silent');
});

test('the floor marks the verdict scoped so the banner copy states the scope', () => {
  const h = harness({ panelPresent: true });
  const v = { ...LEGACY_VERDICT };
  const { announceGovernance, shown } = h.load('mail.google.com');
  announceGovernance(v);
  assert.equal(shown.length, 1);
  assert.equal(shown[0].surface_scope, 'embedded_ai',
    'the banner would not print the "rest of this app is not governed" line');
});

test('the floor resolves tenant subdomains and does not catch Gemini', () => {
  const { floorSelectorsForHost } = harness().load();
  assert.ok(floorSelectorsForHost('app.hubspot.com'), 'hubspot tenant not matched');
  assert.ok(floorSelectorsForHost('acme.zendesk.com'), 'zendesk tenant not matched');
  assert.equal(floorSelectorsForHost('gemini.google.com'), null, 'Gemini was scoped by the Gmail entry');
  assert.equal(floorSelectorsForHost('claude.ai'), null);
});

// The two content scripts are injected independently, so neither can depend on the
// other's load order and each carries its own copy of the floor. That is only safe
// while the copies are identical.
test('the notice floor and the capture floor are the same list', () => {
  const contentSrc = readFileSync(path.join(here, '..', 'content', 'content.js'), 'utf8');
  const grab = (src, label) => {
    const i = src.indexOf('const EMBEDDED_AI_FLOOR = {');
    assert.ok(i > 0, `${label}: EMBEDDED_AI_FLOOR not found`);
    const end = src.indexOf('};', i);
    assert.ok(end > i, `${label}: EMBEDDED_AI_FLOOR never closes`);
    // Normalise whitespace so alignment padding is not a difference.
    return src.slice(i, end).replace(/\s+/g, ' ').trim();
  };
  assert.equal(
    grab(src, 'fingerprint.js'),
    grab(contentSrc, 'content.js'),
    'the notice gate and the capture gate disagree about which hosts are embedded-AI',
  );
});

// The live regression, on the notice side. Gmail's toolbar Gemini button is
// present on the bare inbox; it must not be mistaken for an open panel.
test('the permanent Gemini launcher does not trigger the notice', () => {
  const h = harness({ panelPresent: false });   // launcher only
  const { announceGovernance, shown, panelsVisible } = h.load('mail.google.com');
  assert.equal(panelsVisible(['[aria-label*="Gemini" i]']), false,
    'the launcher button was treated as an open panel');
  announceGovernance({ ...GMAIL_VERDICT });
  assert.equal(shown.length, 0, 'the banner fired on the bare Gmail inbox');
});

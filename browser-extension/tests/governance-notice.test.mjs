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

  const panelNode = {
    getClientRects: () => (panelVisible ? [{ width: 10, height: 10 }] : []),
  };

  const document = {
    documentElement: { appendChild: (el) => appended.push(el) },
    querySelector: () => null,          // no pre-existing banner
    querySelectorAll: (sel) => (present && /Gemini|Copilot|Breeze|Einstein/i.test(sel) ? [panelNode] : []),
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
    load() {
      const body = region()
        + '\n  function escapeHtml(s){return String(s);}'
        + '\n  return { announceGovernance, panelsVisible };';
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
  const { announceGovernance, shown } = h.load();
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
  const h = harness({ panelPresent: true });
  const { announceGovernance, shown } = h.load();
  announceGovernance({ ...GMAIL_VERDICT, panel_selectors: [] });
  assert.equal(shown.length, 0);
});

// The banner copy is outside the sliced region, so assert on the source: these
// two strings are what stop the notice reading as blanket surveillance.
test('the banner names the AI feature and states the scope', () => {
  assert.match(src, /surface_product \|\| v\.vendor/,
    'the banner still leads with the host vendor rather than the AI feature');
  assert.match(src, /Only your AI prompts here are governed/,
    'the banner no longer tells the user the rest of the app is not governed');
});

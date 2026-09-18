// The enforcement hooks must not cancel events that are not ours to cancel.
//
// THE DEFECT CLASS THIS PINS DOWN. Every send hook resolves an element, decides
// from its CONTENTS whether to block, then cancels the event. When the resolved
// element and the real event target are unrelated, the cancel lands on innocent
// UI — the extension stops being a governance layer and starts being a bug in
// the customer's application.
//
// Three concrete failures, all of this shape:
//
//  1. The persistent blocker had no scope check at all. On an embedded-AI host
//     every contenteditable counts as a prompt input, so an SSN typed into a
//     Gmail message body armed a window-level capture listener and from then on
//     Enter anywhere in Gmail was cancelled with a block modal. Capture was
//     already gated, so the app broke with nothing logged to explain it.
//  2. The Enter hook fell back to "the composer" for ANY Enter on the page, so
//     a keystroke in a search box was cancelled and blamed on composer text.
//  3. Naively gating (1) would have flipped it into an under-block: the first
//     prompt input on Gmail is the mail body, so the blocker would never arm for
//     text typed into the Gemini panel itself.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { loadEventOrigin, node, evt, legacyEvt } from './load-event-origin.mjs';

const CONTENT = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'content', 'content.js'),
  'utf8',
);

// ── eventCameFrom ───────────────────────────────────────────────────────────

const origin = loadEventOrigin({
  captureAllowed: () => true,
  findActivePromptInput: () => null,
  findPromptInputs: () => [],
});

test('an event on the element itself came from it', () => {
  const composer = node('composer');
  assert.equal(origin.eventCameFrom(composer, evt(composer)), true);
});

test('an event on a node inside the element came from it', () => {
  // Contenteditables target their inner nodes, so this is the common case for a
  // real Enter in a composer — not an edge case.
  const inner = node('text-node');
  const composer = node('composer', [inner]);
  assert.equal(origin.eventCameFrom(composer, evt(inner, [inner, composer])), true);
});

test('an event elsewhere on the page did NOT come from the element', () => {
  // The search box: this is failure (2). Cancelling here breaks the host app.
  const search = node('search-box');
  const composer = node('composer', [node('inner')]);
  assert.equal(origin.eventCameFrom(composer, evt(search, [search, node('header')])), false);
});

test('a shadow-rooted composer is matched through composedPath', () => {
  // e.target is retargeted to the shadow HOST, so contains() reports false for
  // the composer inside. Without composedPath this returns a false negative and
  // real sends in shadow-rooted panels stop being intercepted.
  const composer = node('composer-in-shadow');
  const host = node('shadow-host');
  assert.equal(origin.eventCameFrom(composer, evt(host, [composer, host])), true);
});

test('without composedPath it falls back to containment', () => {
  const inner = node('inner');
  const composer = node('composer', [inner]);
  assert.equal(origin.eventCameFrom(composer, legacyEvt(inner)), true);
  assert.equal(origin.eventCameFrom(composer, legacyEvt(node('outside'))), false);
});

test('missing element or event is not an origin match', () => {
  assert.equal(origin.eventCameFrom(null, evt(node('x'))), false);
  assert.equal(origin.eventCameFrom(node('x'), null), false);
});

// ── governedPromptInput ─────────────────────────────────────────────────────

function resolver({ active = null, all = [], allowed = () => true }) {
  return loadEventOrigin({
    captureAllowed: allowed,
    findActivePromptInput: () => active,
    findPromptInputs: () => all,
  }).governedPromptInput;
}

test('on a whole_site host the focused input wins, as before', () => {
  const focused = node('composer');
  const other = node('other');
  assert.equal(resolver({ active: focused, all: [other, focused] })(), focused);
});

test('on a whole_site host with nothing focused, the first input wins', () => {
  const first = node('first');
  assert.equal(resolver({ active: null, all: [first, node('second')] })(), first);
});

test('a focused input OUTSIDE the AI panel is not used', () => {
  // Failure (1): the Gmail message body is focused and full of sensitive text.
  // Using it would arm the blocker across the whole app.
  const mailBody = node('gmail-body');
  const panelInput = node('gemini-input');
  const el = resolver({
    active: mailBody,
    all: [mailBody, panelInput],
    allowed: (n) => n === panelInput,
  })();
  assert.equal(el, panelInput, 'must skip the focused mail body and take the panel input');
});

test('the panel input is found even when it is not first on the page', () => {
  // Failure (3): the naive fix takes findPromptInputs()[0], which on Gmail is
  // the mail body — scope-gated to null, so the blocker would never arm for the
  // Gemini panel and enforcement would silently stop working on that host.
  const mailBody = node('gmail-body');
  const subject = node('gmail-subject');
  const panelInput = node('gemini-input');
  const el = resolver({
    active: null,
    all: [mailBody, subject, panelInput],
    allowed: (n) => n === panelInput,
  })();
  assert.equal(el, panelInput);
});

test('no governed input at all resolves to null, not to a page input', () => {
  // Panel closed, or its selector went stale. Fail closed: returning any input
  // here is what armed the blocker over the host app.
  const el = resolver({
    active: node('gmail-body'),
    all: [node('gmail-body'), node('gmail-subject')],
    allowed: () => false,
  })();
  assert.equal(el, null);
});

// ── The wiring: these guards must actually be installed ─────────────────────
//
// The functions above are pure and testable; the call sites are mid-IIFE with no
// seam. Asserted on shipped source so a future edit that drops a guard fails
// here rather than in a customer's tab.

test('the persistent blocker resolves through the scope-aware finder', () => {
  const at = CONTENT.indexOf('function globalBlocker');
  assert.ok(at > 0, 'globalBlocker not found');
  const body = CONTENT.slice(at, CONTENT.indexOf('function activateBlocker', at));

  assert.match(body, /governedPromptInput\(\)/,
    'globalBlocker must resolve through governedPromptInput, not the raw finders');
  assert.ok(!/findPromptInputs\(\)\[0\]/.test(body),
    'globalBlocker must not fall back to the first prompt input on the page');
  assert.match(body, /captureAllowed\(e\.target\)/,
    'globalBlocker must check that the gesture itself came from a governed surface');
  assert.match(body, /eventCameFrom\(el, e\)/,
    'globalBlocker must require Enter to come from the flagged input');
});

test('the blocker poll disarms when no governed input remains', () => {
  const at = CONTENT.lastIndexOf('setInterval(() => {');
  assert.ok(at > 0, 'blocker poll not found');
  const body = CONTENT.slice(at, at + 700);
  assert.match(body, /governedPromptInput\(\)/, 'the poll must use the scope-aware finder');
  assert.match(body, /if \(!el\).*deactivateBlocker\(\)/s,
    'the poll must disarm the blocker when no governed input is present');
});

test('the Enter hook requires the keystroke to come from the composer', () => {
  const at = CONTENT.indexOf("tryBlock(el, e, 'keydown:Enter')");
  assert.ok(at > 0, 'the Enter hook was not found');
  const before = CONTENT.slice(Math.max(0, at - 700), at);
  assert.match(before, /eventCameFrom\(el, e\)/,
    'Enter must be checked against the resolved composer before tryBlock cancels it');
});

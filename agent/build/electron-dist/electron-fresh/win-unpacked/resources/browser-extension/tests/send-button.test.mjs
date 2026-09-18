// Which composer button is the SEND button.
//
// THE DEFECT THIS PINS DOWN. looksLikeSendButton() had two shape-based rules —
// "an icon button inside the composer" and "a button adjacent to the textbox" —
// added to catch the unlabelled SVG arrow that ChatGPT and others ship. But a
// modern composer is a toolbar of unlabelled SVG icon buttons sitting next to
// the textbox: attach, mic, model picker, tools, canvas. All of them matched.
//
// A positive is acted on with preventDefault(), so a false positive cancels a
// real UI action. On gemini.google.com, clicking "+" to attach a document was
// read as a send: the click was cancelled so the file dialog never opened, and
// the router then hunted for a model label, leaving the model dropdown open and
// a "Flash → Thinking" toast on screen. Attaching a document was impossible.
//
// Two properties are asserted here: a button that names itself send is still a
// send button, and a button that names itself as something else never is — even
// when it has every shape signal a send button has.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { loadSendButton, btn } from './load-send-button.mjs';

const { looksLikeSendButton, isNonSendControl } = loadSendButton();

// ── Real send buttons must keep working ─────────────────────────────────────

test('a button that names itself send is a send button', () => {
  for (const spec of [
    { label: 'Send message' },
    { label: 'Submit' },
    { text: 'Send' },
    { text: 'submit' },
    { testid: 'send-button' },
    { testid: 'composer-send_button' },
    { type: 'submit' },
  ]) {
    assert.equal(looksLikeSendButton(btn(spec)), true, JSON.stringify(spec));
  }
});

test('the unlabelled SVG arrow in a composer is still caught', () => {
  // This is the rule the deny list must not break: ChatGPT's send control has
  // no accessible name at all, only an arrow glyph inside the composer.
  assert.equal(looksLikeSendButton(btn({ svg: true, inComposer: true })), true);
});

test('an unnamed button adjacent to the textbox is still caught', () => {
  assert.equal(looksLikeSendButton(btn({ nextToTextbox: true })), true);
});

test('an explicit send label beats every deny signal', () => {
  // A control can be named "Send" and still sit in a container whose testid
  // carries a denied word. Self-identification wins.
  assert.equal(looksLikeSendButton(btn({ label: 'Send message', testid: 'more-menu-send' })), true);
  assert.equal(looksLikeSendButton(btn({ label: 'Send', haspopup: true })), true);
  assert.equal(isNonSendControl(btn({ label: 'Send', testid: 'model-picker' })), false);
});

// ── The controls that were misfiring ────────────────────────────────────────

test('Gemini\'s attach button is not a send button', () => {
  // The live failure, in the three shapes it actually appears in: named,
  // wrapping a file input, and wrapped in a <label> around one. Each also
  // carries the shape signals (icon in composer, next to the textbox) that
  // used to make it a positive.
  const shapes = [
    { label: 'Add files', svg: true, inComposer: true, nextToTextbox: true },
    { label: 'Attach file', svg: true, inComposer: true },
    { fileInput: true, svg: true, inComposer: true },
    { inFileLabel: true, svg: true, inComposer: true },
    { label: 'Upload from computer', nextToTextbox: true },
    { label: 'Insert', svg: true, inComposer: true },
  ];
  for (const spec of shapes) {
    assert.equal(looksLikeSendButton(btn(spec)), false, JSON.stringify(spec));
  }
});

test('the model picker is not a send button', () => {
  // "Flash ⌄" — the control whose menu was left hanging open on screen.
  for (const spec of [
    { text: 'Flash', haspopup: true, svg: true, inComposer: true },
    { text: 'Flash', expanded: true, nextToTextbox: true },
    { label: 'Model selector', svg: true, inComposer: true },
    { testid: 'model-switcher', svg: true, inComposer: true },
  ]) {
    assert.equal(looksLikeSendButton(btn(spec)), false, JSON.stringify(spec));
  }
});

test('every other composer-toolbar control is not a send button', () => {
  for (const label of [
    'Use microphone', 'Voice input', 'Dictate', 'Record audio', 'Take a photo',
    'Screenshot', 'Emoji', 'Add sticker', 'Tools', 'Canvas', 'Deep research',
    'Settings', 'More options', 'Close', 'Cancel', 'Clear', 'Stop generating',
    'Copy', 'New chat', 'History', 'Dismiss',
  ]) {
    assert.equal(
      looksLikeSendButton(btn({ label, svg: true, inComposer: true, nextToTextbox: true })),
      false, `"${label}" must not be treated as send`,
    );
  }
});

test('menu semantics alone disqualify a control', () => {
  // No name at all, just a popup owner with every shape signal. A send button
  // never owns a popup, so shape must not carry it.
  assert.equal(looksLikeSendButton(btn({ haspopup: true, svg: true, inComposer: true })), false);
  assert.equal(looksLikeSendButton(btn({ expanded: true, svg: true, inComposer: true })), false);
});

// ── The word-boundary regression ────────────────────────────────────────────

test('denied words do not match inside unrelated words', () => {
  // Substring matching demoted real send buttons: 'mic' inside "Dynamics",
  // 'back' inside "feedback", 'more' inside "Learn more", 'copy' inside
  // "Copilot". Each of these is an unnamed arrow that must stay a send button.
  for (const label of [
    'Dynamics composer arrow', 'Send feedback arrow', 'Copilot compose',
    'Atomic action', 'Backup complete',
  ]) {
    assert.equal(
      isNonSendControl(btn({ label })), false,
      `"${label}" contains no denied word — it must not be demoted`,
    );
  }
});

test('framework class noise cannot demote a send button', () => {
  // className is deliberately NOT consulted: "MuiIconButton-more" or a hashed
  // CSS module carries words the author never chose as a label.
  assert.equal(
    looksLikeSendButton(btn({ className: 'MuiIconButton-more model-x', svg: true, inComposer: true })),
    true,
  );
});

// ── The empty-composer half of the same failure ─────────────────────────────
//
// Fixing button identification is necessary but not sufficient. The Gemini
// screenshot showed an EMPTY composer ("Ask Gemini" placeholder) and a
// "Standard prompt → Gemini Thinking" toast, so routing fired with nothing to
// send. A real send button clicked on an empty box would still have done it.
// tryBlock() now returns before routing when there is no text and no flagged
// attachment. Asserted on shipped source because the guard sits mid-function in
// the IIFE with no seam to slice.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const CONTENT = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'content', 'content.js'),
  'utf8',
);

test('routing cannot fire on an empty composer', () => {
  // lastIndexOf, not indexOf: the same banner heads the routing HELPERS far
  // earlier in the file, and anchoring on that one would put every assertion
  // below in the wrong region and pass for the wrong reason.
  const routeAt = CONTENT.lastIndexOf('// ── Model Routing ──');
  assert.ok(routeAt > 0, 'model-routing block not found');

  // The guard must sit BEFORE the routing block, in the same branch.
  const before = CONTENT.slice(0, routeAt);
  const guardAt = before.lastIndexOf('if (!text.trim()) {');
  assert.ok(guardAt > 0, 'empty-composer guard is missing or moved below routing');

  // And it must return rather than fall through.
  const guard = before.slice(guardAt, guardAt + 60);
  assert.match(guard, /return false;/, 'the guard must return, not continue into routing');

  // Nothing may re-enter routing between the guard and the routing block.
  const between = before.slice(guardAt);
  assert.ok(
    !/smartRoute\(/.test(between),
    'a routing call appears between the empty-composer guard and the routing block',
  );
});

// MODEL ROUTING CAN NEVER GET STUCK -- the extension's DOM path (claude.ai,
// gemini.google.com), under the same end-of-route invariant as the desktop
// agent (agent/tests/enforcer-route-watchdog.test.mjs):
//   (a) no model menu left open;
//   (b) the paused prompt sent EXACTLY ONCE, or -- when that is not safe (the
//       user edited it, the conversation changed) -- left in the composer, focused;
//   (c) one model_routed event with a precise reason (and `send`).
//
// Live 2026-10-06: "it just opens the model window but doesn't change, and gets
// stuck there." Before this, nothing bounded applyRouteDecision: a switch that
// never settled kept the prompt PAUSED forever; the menu-closing Escape was
// dispatched AT document, which never passes through body, where Angular CDK
// (Gemini) listens; and the re-sent Enter was fire-and-forget.
//
// The routing region and the menu-lookup region are the REAL content.js code
// (tests/load-routing-flow.mjs, tests/load-menu-lookup.mjs).

import test from 'node:test';
import assert from 'node:assert/strict';
import { loadRoutingFlow } from './load-routing-flow.mjs';
import { loadMenuLookup, contentSource, el, doc } from './load-menu-lookup.mjs';

const CLAUDE_55 = { 'Haiku 4.5': 'Haiku 4.5', 'Sonnet 5.5': 'Sonnet 5.5 Medium', 'Opus 5.5': 'Opus 5.5 High' };
const GEMINI = { '3.5 Flash-Lite': 'Flash-Lite', '3.6 Flash': 'Flash', '3.1 Pro': 'Pro' };
const MODERATE = 'explain what an API is';   // moderate -> Sonnet (routing-flow.test.mjs)
const COMPLEX = 'Write a literature review on transformer models and cite sources';

function claude(opts = {}) {
  const flow = loadRoutingFlow({
    host: 'claude.ai', pathname: '/chat/conv-1', buttonText: 'Opus 5.5 Medium',
    onSwitch: (l) => CLAUDE_55[l] || null, ...opts,
  });
  flow.observePicker();
  return flow;
}
function gemini(opts = {}) {
  const flow = loadRoutingFlow({
    host: 'gemini.google.com', pathname: '/app/abc', buttonText: 'Flash-Lite',
    onSwitch: (l) => GEMINI[l] || null, ...opts,
  });
  flow.observePicker();
  return flow;
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ── the watchdog ────────────────────────────────────────────────────────────

test('a switch that NEVER settles: past the watchdog the menu is closed and the prompt goes ONCE, unrouted', async () => {
  const flow = gemini({ hang: true, watchdogMs: 150 });
  const { r, paused } = flow.send(COMPLEX);
  assert.equal(r.decision.result, 'routed');
  assert.equal(paused, true);
  assert.equal(flow.env.events.length, 0, 'inside the budget: the prompt is paused, nothing reported yet');
  assert.equal(flow.env.resent.length, 0);
  await wait(250);
  await flow.settle();
  assert.equal(flow.env.menuState, null, '(a) the picker menu the hung switch opened is closed');
  assert.equal(flow.env.resent.length, 1, '(b) exactly one re-sent Enter');
  assert.equal(flow.env.sent, 1, '(b) the prompt went out once');
  assert.equal(flow.env.events.length, 1, '(c) one event');
  const ev = flow.env.events[0];
  assert.equal(ev.result, 'failed');
  assert.equal(ev.reason, 'watchdog_timeout');
  assert.equal(ev.send, 'enter');
  assert.equal(ev.ui_changed, false);
});

test('a switch that throws: reported failed, menu closed, prompt goes ONCE', async () => {
  const flow = claude({ throws: true });
  flow.send(MODERATE);
  await flow.settle();
  const ev = flow.env.events.at(-1);
  assert.equal(flow.env.events.length, 1);
  assert.equal(ev.result, 'failed');
  // switchToTier treats a throwing picker click as "that label did not work".
  assert.equal(ev.reason, 'target_item_not_found');
  assert.equal(flow.env.menuState, null);
  assert.equal(flow.env.sent, 1);
});

test('a fast route never trips the watchdog: one event, one send, nothing reported later', async () => {
  const flow = claude({ watchdogMs: 400 });
  flow.send(MODERATE);
  await flow.settle();
  await wait(500);
  await flow.settle();
  assert.equal(flow.env.events.length, 1);
  assert.equal(flow.env.events[0].result, 'applied');
  assert.equal(flow.env.events[0].send, 'enter');
  assert.equal(flow.env.resent.length, 1);
});

// ── (a) never leave a menu open ─────────────────────────────────────────────

test('a switch that lands but leaves its menu showing: the menu is closed BEFORE the re-send', async () => {
  const flow = gemini({ menuLeftOpen: true });
  flow.send(COMPLEX);
  await flow.settle();
  assert.equal(flow.env.button.textContent, 'Pro');
  assert.ok(flow.env.menuCloses >= 1);
  assert.equal(flow.env.menuState, null);
  assert.equal(flow.env.sent, 1);
  assert.equal(flow.env.events.at(-1).result, 'applied');
});

// ── (b) exactly one send, verified ──────────────────────────────────────────

test('our Enter went to the picker (it opened the menu): menu closed, ONE click on send, prompt sent ONCE', async () => {
  const flow = gemini({ enterDoes: 'menu', sendButton: 'send' });
  flow.send(COMPLEX);
  await flow.settle();
  assert.equal(flow.env.resent.length, 1, 'one Enter');
  assert.equal(flow.env.buttonClicks, 1, 'one click');
  assert.equal(flow.env.sent, 1, 'one prompt');
  assert.equal(flow.env.menuState, null, 'the menu our Enter opened is closed');
  assert.equal(flow.env.programmatic, 1, 'the click is marked ours: never logged as a second user send');
  const ev = flow.env.events.at(-1);
  assert.equal(ev.result, 'applied');
  assert.equal(ev.send, 'button');
});

test('nothing takes the prompt: never more than one Enter + one click; reported failed "not_submitted", composer focused', async () => {
  const flow = gemini({ enterDoes: 'nothing', sendButton: 'nothing' });
  flow.send(COMPLEX);
  await flow.settle();
  assert.equal(flow.env.resent.length, 1);
  assert.equal(flow.env.buttonClicks, 1);
  assert.equal(flow.env.sent, 0);
  assert.equal(flow.env.composer.innerText, COMPLEX, 'the prompt is left intact');
  assert.ok(flow.env.focusCalls.length >= 2, 'focus is put back on the composer at the end');
  const ev = flow.env.events.at(-1);
  assert.equal(ev.result, 'failed', 'a route whose prompt did not go out is never "applied"');
  assert.equal(ev.reason, 'not_submitted');
  assert.equal(ev.ui_changed, true, 'the switch itself did land');
});

test('no send button to fall back on: one Enter, then the prompt is left focused', async () => {
  const flow = claude({ enterDoes: 'nothing', sendButton: null });
  flow.send(MODERATE);
  await flow.settle();
  assert.equal(flow.env.resent.length, 1);
  assert.equal(flow.env.buttonClicks, 0);
  assert.equal(flow.env.events.at(-1).send, 'not_submitted');
});

test('the user edited the prompt while the picker switched: NOTHING is sent, the edit is theirs', async () => {
  const flow = claude({ beforeResend: (comp) => { comp.innerText += ' and also cover cost'; } });
  flow.send(MODERATE);
  await flow.settle();
  assert.equal(flow.env.resent.length, 0, 'never send text the user did not send');
  assert.equal(flow.env.sent, 0);
  const ev = flow.env.events.at(-1);
  assert.equal(ev.result, 'failed');
  assert.equal(ev.reason, 'unsafe_text_changed');
});

test('the conversation changed while the picker switched: NOTHING is sent into the other conversation', async () => {
  const flow = claude({ beforeResend: (_c, env) => { env.location.pathname = '/chat/conv-2'; } });
  flow.send(MODERATE);
  await flow.settle();
  assert.equal(flow.env.resent.length, 0);
  assert.equal(flow.env.events.at(-1).reason, 'unsafe_navigated');
});

test('a failed switch still sends ONCE, unrouted, and reports the switch failure', async () => {
  const flow = claude({ onSwitch: () => null });
  flow.send(MODERATE);
  await flow.settle();
  assert.equal(flow.env.sent, 1);
  const ev = flow.env.events.at(-1);
  assert.equal(ev.result, 'failed');
  assert.equal(ev.reason, 'target_item_not_found');
  assert.equal(ev.send, 'enter');
});

// ── closeOpenMenus against a DOM ────────────────────────────────────────────

function withKeyboardEvent(fn) {
  const had = 'KeyboardEvent' in globalThis;
  const prev = globalThis.KeyboardEvent;
  globalThis.KeyboardEvent = class { constructor(type, init) { this.type = type; Object.assign(this, init); } };
  return Promise.resolve().then(fn).finally(() => { if (had) globalThis.KeyboardEvent = prev; else delete globalThis.KeyboardEvent; });
}

test('closeOpenMenus: Gemini\'s Angular menu closes on an Escape dispatched from the FOCUSED element (bubbles through body)', () => withKeyboardEvent(async () => {
  const menu = el({ className: 'mat-mdc-menu-panel', children: [el({ role: 'menuitem', text: '3.1 Pro Advanced reasoning' })] });
  const root = doc([menu]);
  const seen = [];
  // CDK's overlay keyboard dispatcher listens on BODY: an event dispatched AT
  // document never reaches it. One dispatched from the composer bubbles there.
  root.dispatchEvent = (ev) => { seen.push(['document', ev.key]); };
  root.activeElement = { dispatchEvent: (ev) => { seen.push(['active', ev.key, ev.keyCode]); if (ev.type === 'keydown' && ev.keyCode === 27) menu.visible = false; } };
  const { anyModelMenuOpen, closeOpenMenus } = loadMenuLookup(root);
  assert.equal(anyModelMenuOpen(), true);
  assert.equal(await closeOpenMenus(), true);
  assert.equal(anyModelMenuOpen(), false);
  assert.ok(seen.some((s) => s[0] === 'active' && s[1] === 'Escape' && s[2] === 27));
}));

test('closeOpenMenus: an Escape the page ignores -> the CDK backdrop is clicked; bounded; nothing pressed with no menu', () => withKeyboardEvent(async () => {
  const menu = el({ role: 'menu', children: [el({ role: 'menuitem', text: '3.6 Flash All-around help' })] });
  const backdrop = el({ className: 'cdk-overlay-backdrop' });
  backdrop.click = () => { backdrop.clicked++; menu.visible = false; };
  const root = doc([backdrop, menu]);
  let escapes = 0;
  root.activeElement = { dispatchEvent: (ev) => { if (ev.type === 'keydown') escapes++; } };
  const { closeOpenMenus } = loadMenuLookup(root);
  assert.equal(await closeOpenMenus(), true);
  assert.equal(backdrop.clicked, 1);
  assert.equal(escapes, 1);

  // A menu nothing will close: at most 3 rounds, then false.
  const stuck = el({ role: 'menu' });
  const root2 = doc([stuck]);
  let esc2 = 0;
  root2.activeElement = { dispatchEvent: (ev) => { if (ev.type === 'keydown') esc2++; } };
  assert.equal(await loadMenuLookup(root2).closeOpenMenus(), false);
  assert.equal(esc2, 3);

  // No menu: not a single key.
  const root3 = doc([el({ role: 'dialog', text: 'Something else' })]);
  let esc3 = 0;
  root3.activeElement = { dispatchEvent: () => { esc3++; } };
  assert.equal(await loadMenuLookup(root3).closeOpenMenus(), true);
  assert.equal(esc3, 0, 'a dialog / popover the page keeps is never "a menu to close"');
}));

// ── SOURCE ─────────────────────────────────────────────────────────────────

test('content.js SOURCE: no menu-closing Escape is dispatched AT document any more; the switch honours the cancel token', () => {
  const src = contentSource();
  const start = src.indexOf('async function changeModelInUI(');
  const fn = src.slice(start, src.indexOf('function showRoutingToast(', start));
  assert.ok(!/document\.dispatchEvent\(new KeyboardEvent\('keydown', \{ key: 'Escape'/.test(fn), 'Escape AT document never reaches Angular CDK');
  assert.ok(/closeOpenMenus\(\)/.test(fn));
  assert.ok(/const cancelled = routeCancelToken\(\)/.test(fn));
  assert.ok((fn.match(/if \(cancelled\(\)\) return abandon\(\);/g) || []).length >= 3, 'checked after every wait');
  const apply = src.slice(src.indexOf('function applyRouteDecision('), src.indexOf('function sameComposerText('));
  assert.ok(/Promise\.race\(\[work, watchdog\]\)/.test(apply), 'every route runs under the watchdog');
  assert.ok(/ROUTE_WATCHDOG_MS/.test(apply));
  assert.ok(/_routeCancelGen\+\+/.test(apply), 'a timed-out switch is cancelled');
  const finish = src.slice(src.indexOf('async function finishRoutedSend('), src.indexOf('// ── end model routing ─'));
  assert.equal((finish.match(/dispatchEvent\(new KeyboardEvent\('keydown'/g) || []).length, 1, 'one Enter');
  assert.equal((finish.match(/btn\.click\(\)/g) || []).length, 1, 'one fallback click, only after the Enter verifiably did not send');
  assert.ok(finish.indexOf('btn.click()') > finish.indexOf('ROUTE_RESEND_VERIFY_MS'), 'the click only after the verify window');
});

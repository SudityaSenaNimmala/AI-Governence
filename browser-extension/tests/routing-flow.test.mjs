// The browser routing flow end to end, on shipped code: content.js's routing
// region + the shared decideRoute bundle + the real classifier. See
// tests/load-routing-flow.mjs for what is real and what is faked.

import test from 'node:test';
import assert from 'node:assert/strict';
import { loadRoutingFlow, CONFIRM_DECLINED } from './load-routing-flow.mjs';

const CLAUDE_PICKER = {
  'Haiku 4.5': 'Haiku 4.5',
  'Sonnet 5': 'Sonnet 5 Medium',
  'Opus 5': 'Opus 5 High',
};
// The picker as Claude labels it since 2026-10-05.
const CLAUDE_PICKER_55 = {
  'Haiku 4.5': 'Haiku 4.5',
  'Sonnet 5.5': 'Sonnet 5.5 Medium',
  'Opus 5.5': 'Opus 5.5 High',
};
const claudeSwitch = (label) => CLAUDE_PICKER[label] || null;

const SIMPLE = 'thanks';
const COMPLEX = 'Write a literature review on transformer models and cite sources';
const PROMPT_WITH_SECRET = 'define idempotent — my SSN is 123-45-6789';

function claude(opts = {}) {
  const flow = loadRoutingFlow({
    host: 'claude.ai', pathname: '/chat/conv-1', buttonText: 'Opus 5 High', onSwitch: claudeSwitch, ...opts,
  });
  flow.observePicker();   // the page-load sighting
  return flow;
}

test('a simple prompt on Opus is paused, switched to Haiku 4.5, reported and re-sent', async () => {
  const flow = claude();
  const { r, paused } = flow.send(SIMPLE);
  assert.equal(r.decision.result, 'routed');
  assert.equal(paused, true, 'an enforced route pauses the send');
  assert.equal(flow.env.paused, 1);
  await flow.settle();
  assert.deepEqual(flow.env.switchCalls, ['Haiku 4.5']);
  assert.equal(flow.env.button.textContent, 'Haiku 4.5');
  assert.equal(flow.env.resent.length, 1, 'the paused prompt is re-sent');
  const ev = flow.env.events.at(-1);
  assert.equal(ev.kind, 'model_routed');
  assert.equal(ev.result, 'applied');
  assert.equal(ev.ui_changed, true);
});

test('model_routed carries exactly the contract fields — and no prompt or page text', async () => {
  const flow = claude();
  flow.send(PROMPT_WITH_SECRET);
  await flow.settle();
  const ev = flow.env.events.at(-1);
  for (const [k, v] of Object.entries({
    mechanism: 'browser_extension', surface: 'browser', host_or_app: 'claude.ai', provider: 'anthropic',
    from_tier: 'premium', from_label: 'Opus 5.5', to_tier: 'economy', to_label: 'Haiku 4.5',
    model: 'claude-haiku-4-5', complexity: 'simple', rule_id: null, result: 'applied', reason: 'downgrade',
    effort_from: 'high', effort_to: null, len: PROMPT_WITH_SECRET.length,
  })) assert.deepEqual(ev[k], v, `field ${k}`);
  const json = JSON.stringify(ev);
  assert.ok(!json.includes('123-45-6789') && !json.includes('idempotent'), 'no prompt text in the event');
  assert.ok(!json.includes('Opus 5 High'), 'no raw button text: from_label is the catalog name');
});

test('our own route never moves the user\'s choice (no ceiling ratchet)', async () => {
  const flow = claude();
  assert.deepEqual(flow.state().userChoice['claude.ai|anthropic'].tier, 'premium', 'page-load sighting adopted');
  flow.send(SIMPLE);
  await flow.settle();
  flow.observePicker();   // the poller now sees Haiku — which WE selected
  assert.equal(flow.state().userChoice['claude.ai|anthropic'].tier, 'premium');
  assert.equal(flow.state().overrideConvs.size, 0, 'our own switch is not an override');
  assert.equal(flow.state().lastRoute['claude.ai|anthropic'].tier, 'economy');
});

test('after a reload, the model WE left the site on is not adopted as the user\'s choice', async () => {
  const store = {};
  const first = claude({ store });
  first.send(SIMPLE);
  await first.settle();
  // Reload: claude.ai remembers the last model, so the page opens on Haiku.
  const second = claude({ store, buttonText: 'Haiku 4.5' });
  assert.equal(second.state().userChoice['claude.ai|anthropic'].tier, 'premium');
});

test('the user switching back suppresses routing for that conversation, reported once', async () => {
  const flow = claude();
  flow.send(SIMPLE);
  await flow.settle();
  // The user puts Opus back by hand.
  flow.env.button.textContent = 'Opus 5 High';
  flow.observePicker();
  assert.ok(flow.state().overrideConvs.has('c:conv-1'));
  assert.equal(flow.state().userChoice['claude.ai|anthropic'].tier, 'premium');

  const before = flow.env.events.length;
  const a = flow.send(SIMPLE);
  assert.equal(a.r.decision.result, 'user_override');
  assert.equal(a.paused, false, 'not paused');
  assert.equal(flow.env.events.length, before + 1);
  assert.equal(flow.env.events.at(-1).result, 'user_override');
  const b = flow.send(SIMPLE);
  assert.equal(b.r.decision.result, 'user_override');
  assert.equal(flow.env.events.length, before + 1, 'reported once per conversation, not per prompt');
  assert.deepEqual(flow.env.switchCalls, ['Haiku 4.5'], 'no further switching');

  // A different conversation in the same tab routes again.
  flow.env.location.pathname = '/chat/conv-2';
  const c = flow.send(SIMPLE);
  assert.equal(c.r.decision.result, 'routed');
});

test('a demanding prompt on Haiku is UPGRADED to Opus with high effort (allow_upgrade default)', async () => {
  const flow = claude({ buttonText: 'Haiku 4.5' });
  const { r } = flow.send(COMPLEX);
  assert.equal(r.ctx.complexity, 'complex');
  assert.equal(r.decision.target_tier, 'premium');
  assert.equal(r.decision.effort, 'high');
  await flow.settle();
  const ev = flow.env.events.at(-1);
  assert.equal(ev.result, 'applied');
  assert.equal(ev.reason, 'upgrade');
  assert.equal(ev.effort_to, 'high', 'Opus 5 opened on High, so the requested effort reads back');
});

test('effort-only: complex on "Opus 5 Medium" drives the Effort submenu to High', async () => {
  const flow = claude({
    buttonText: 'Opus 5 Medium',
    effortMenu: { levels: { Low: 'Opus 5 Low', Medium: 'Opus 5 Medium', High: 'Opus 5 High' } },
  });
  const { r, paused } = flow.send(COMPLEX);
  assert.equal(r.decision.reason, 'effort_only');
  assert.equal(paused, true);
  await flow.settle();
  assert.deepEqual(flow.env.switchCalls, [], 'tier unchanged — no model click');
  assert.equal(flow.env.button.textContent, 'Opus 5 High');
  const ev = flow.env.events.at(-1);
  assert.equal(ev.result, 'applied');
  assert.equal(ev.effort_from, 'medium');
  assert.equal(ev.effort_to, 'high');
});

test('effort the page did not accept is reported as what actually applies, and as failed', async () => {
  const flow = claude({ buttonText: 'Opus 5 Medium' });   // no effort submenu rendered
  flow.send(COMPLEX);
  await flow.settle();
  const ev = flow.env.events.at(-1);
  assert.equal(ev.result, 'failed');
  assert.equal(ev.reason, 'effort_not_applied');
  assert.equal(ev.effort_to, 'medium');
  assert.equal(flow.env.resent.length, 1, 'the prompt is still sent');
});

test('a picker that will not switch is reported failed, not applied, and the prompt still goes', async () => {
  const flow = claude({ onSwitch: () => null });
  flow.send(SIMPLE);
  await flow.settle();
  assert.deepEqual(flow.env.switchCalls, ['Haiku 4.5', 'Haiku'], 'every catalog label is tried');
  const ev = flow.env.events.at(-1);
  assert.equal(ev.result, 'failed');
  assert.equal(ev.reason, 'target_item_not_found');
  assert.equal(ev.ui_changed, false);
  assert.equal(flow.env.resent.length, 1);
  assert.equal(flow.state().lastRoute['claude.ai|anthropic'], undefined, 'a failed route is not remembered as ours');
});

test('Gemini: "3.8 Flash" reads as STANDARD (the keyword chain would say economy)', () => {
  const flow = loadRoutingFlow({ host: 'gemini.google.com', buttonText: '3.8 Flash', onSwitch: () => null });
  assert.equal(flow.readPickerState().tier, 'standard');
  flow.env.button.textContent = '3.5 Flash-Lite';
  assert.equal(flow.readPickerState().tier, 'economy');
});

test('user choice is tracked per (host, provider), never globally', () => {
  const store = {};
  claude({ store });
  loadRoutingFlow({ host: 'gemini.google.com', buttonText: '3.5 Flash-Lite', onSwitch: () => null, store }).observePicker();
  const choice = store['cfai.routing_user_choice'];
  assert.equal(choice['claude.ai|anthropic'].tier, 'premium');
  assert.equal(choice['gemini.google.com|google'].tier, 'economy');
});

test('fleet switch off in the policy: nothing is paused, switched or reported', async () => {
  const flow = claude({ store: { 'cfai.routing_policy': { policy: { version: 'x', rules: [], fleet_enabled: false }, etag: 'e1' } } });
  const { r, paused } = flow.send(SIMPLE);
  assert.equal(r.decision.result, 'disabled');
  assert.equal(paused, false);
  await flow.settle();
  assert.equal(flow.env.events.length, 0);
});

test('a suggest-mode rule shows a suggestion and does not pause or switch', async () => {
  const policy = {
    version: 's', fleet_enabled: true, settings: { allow_upgrade: true, respect_user_override: true },
    rules: [{ id: 'sug', name: 'suggest', enabled: true, priority: 1, scope: {}, conditions: {},
      action: { type: 'suggest', target_tier: 'economy' }, mode: 'suggest' }],
  };
  const flow = claude({ store: { 'cfai.routing_policy': { policy } } });
  const { paused } = flow.send(SIMPLE);
  assert.equal(paused, false);
  assert.deepEqual(flow.env.switchCalls, []);
  assert.equal(flow.env.events.at(-1).result, 'suggested');
  assert.equal(flow.env.events.at(-1).rule_id, 'sug');
  assert.equal(flow.env.toasts.length, 1);
});

test('legacy v1 rules are used only when no v2 policy is cached', () => {
  const v1 = [{ id: 'v1', enabled: true, priority: 1, conditions: { provider: ['anthropic'] }, action: { ui_name: 'Sonnet' } }];
  const legacyOnly = claude({ store: { 'cfai.routing_rules': v1 } });
  assert.equal(legacyOnly.send(SIMPLE).r.decision.rule_id, 'v1');
  const both = claude({ store: { 'cfai.routing_rules': v1, 'cfai.routing_policy': { policy: { version: 'p', rules: [] } } } });
  assert.equal(both.send(SIMPLE).r.decision.rule_id, null, 'the v2 document wins over the legacy mirror');
});

test('an unreadable picker is unsupported and silent — never a blind click', async () => {
  const flow = claude({ buttonText: 'Write your prompt to Claude' });
  const { r, paused } = flow.send(SIMPLE);
  assert.equal(r.decision.result, 'unsupported');
  assert.equal(r.decision.reason, 'current_tier_unknown');
  assert.equal(paused, false);
  await flow.settle();
  assert.equal(flow.env.events.length, 0);
});

test('a page outside the catalog never routes', () => {
  const flow = loadRoutingFlow({ host: 'mail.google.com', buttonText: 'Gemini', onSwitch: () => null });
  const { r, paused } = flow.send(SIMPLE);
  assert.equal(r.decision.result, 'unsupported');
  assert.equal(paused, false);
});

// ── 2026-10-05: "Opus 5.5" / "Sonnet 5.5", and Claude's "Switch model?" dialog ──

const MODERATE = 'explain what an API is';   // the live 2026-10-05 prompt

test('5.5 labels: a moderate prompt on "Opus 5.5 Medium" switches to "Sonnet 5.5" on the first label', async () => {
  const flow = claude({ buttonText: 'Opus 5.5 Medium', onSwitch: (l) => CLAUDE_PICKER_55[l] || null });
  assert.equal(flow.readPickerState().tier, 'premium');
  assert.equal(flow.readPickerState().effort, 'medium', 'the effort suffix still parses');
  const { r } = flow.send(MODERATE);
  assert.equal(r.decision.target_tier, 'standard');
  await flow.settle();
  assert.deepEqual(flow.env.switchCalls, ['Sonnet 5.5']);
  const ev = flow.env.events.at(-1);
  assert.equal(ev.result, 'applied');
  assert.equal(ev.to_label, 'Sonnet 5.5');
  assert.equal(ev.from_label, 'Opus 5.5');
  assert.equal(flow.env.resent.length, 1);
});

test('an unconfirmable "Switch model?" dialog stops the label loop, is reported, and the prompt goes ONCE', async () => {
  const flow = claude({ buttonText: 'Opus 5.5 Medium', onSwitch: () => CONFIRM_DECLINED });
  flow.send(MODERATE);
  await flow.settle();
  assert.deepEqual(flow.env.switchCalls, ['Sonnet 5.5'], 'no further labels: each would reopen the dialog');
  const ev = flow.env.events.at(-1);
  assert.equal(ev.result, 'failed');
  assert.equal(ev.reason, 'confirm_dialog_not_confirmed');
  assert.equal(ev.ui_changed, false);
  assert.equal(flow.env.resent.length, 1, 'the paused prompt is re-sent exactly once, unrouted');
  assert.equal(flow.state().lastRoute['claude.ai|anthropic'], undefined);
});

// Regression coverage for the BROWSER web-surface catalog — the desktop
// monitor's replacement for the browser extension's capture.
//
// Two very different classes of assertion live here, and both matter:
//
//   1. SEPARATION. A browser must never leak into the AI-app catalogs. The
//      whole feature is one careless `AI_PROCESSES.push` away from turning the
//      clipboard poller and the file/attachment watchers loose on the entire
//      browser — every download dialog, every paste in every tab. That is
//      general browser surveillance rather than AI governance, and it would be
//      an invisible change: nothing would fail, there would just be far more
//      data. These tests are the tripwire.
//
//   2. THE PRIVACY GATES in prompt-watcher.ps1, asserted by parsing the .ps1 —
//      the same technique os-monitor-safety.test.mjs already uses, and for the
//      same reason: the gates are what stand between "read the AI composer on
//      claude.ai" and "read whatever text box has focus in the browser",
//      including the address bar.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  AI_PROCESSES,
  IDE_PROCESSES,
  BROWSER_PROCS,
  WEB_SURFACES,
  webSurfaceForHost,
  browserProcNames,
  buildWebSurfaceConfig,
  enforcingWebSurface,
  enforcingWebPicker,
  modelItemNameMatches,
  matchModelPickerItems,
  parseModelPickerLabel,
  stripSelectedPrefix,
  resolveButtonTier,
  watcherProcessNames,
  identifyAiProcess,
  isHostAppProcess,
  isAttachmentWatcherEligible,
  shouldScrubClipboardFor,
  hostForProcess,
  processForHost,
  processesForHost,
  synthesizePlatformBlocks,
  filterBlockedAgents,
  catalogTierLabels,
} from '../src/os_monitor/ai-processes.js';
import { MODEL_CATALOG } from '../src/os_monitor/model-catalog.generated.js';

import { detectModelInfoFromConfig } from '../src/os_monitor/model-router-config.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const OS_MONITOR = join(HERE, '..', 'src', 'os_monitor');

const BROWSER_NAMES = ['chrome', 'msedge', 'brave', 'vivaldi', 'opera', 'firefox'];

test('a browser is never in any AI-app catalog', () => {
  // AI_PROCESSES drives index.js's aiProcNames, which is handed to the
  // clipboard poller, the file-dialog watcher and the attachment watcher. A
  // browser there means all three run across the whole browser.
  for (const name of BROWSER_NAMES) {
    assert.equal(
      AI_PROCESSES.some((e) => e.match.test(name)), false,
      `${name} must not be in AI_PROCESSES — see the WEB_SURFACES comment`,
    );
    assert.equal(IDE_PROCESSES.some((e) => e.match.test(name)), false, `${name} must not be in IDE_PROCESSES`);
    assert.equal(identifyAiProcess(name), null, `identifyAiProcess(${name}) must not name a product`);
    assert.equal(identifyAiProcess(name + '.exe'), null);
    // Not a host app either: hostApp is a membership flag on AI_PROCESSES, and
    // a browser is not a member at all.
    assert.equal(isHostAppProcess(name), false);
    // The three capture permissions that would widen to the whole browser.
    assert.equal(isAttachmentWatcherEligible(name), false, `${name} must not arm the attachment watcher`);
    assert.equal(shouldScrubClipboardFor(name), false);
    assert.equal(hostForProcess(name), null, `hostForProcess(${name}) must not invent an exception key`);
  }
});

test('watcherProcessNames never contains a browser', () => {
  // This is the list the UIA watchers and the keystroke enforcer are given.
  const watched = watcherProcessNames().map((n) => n.toLowerCase());
  for (const name of BROWSER_NAMES) {
    assert.equal(watched.includes(name), false, `${name} leaked into watcherProcessNames()`);
  }
  // browserProcNames() is the separate list, and it is exactly the catalog.
  assert.deepEqual(browserProcNames(), BROWSER_NAMES);
  // The two lists must not intersect at all.
  const overlap = browserProcNames().filter((n) => watched.includes(n.toLowerCase()));
  assert.deepEqual(overlap, []);
});

test('a web surface never redirects the desktop app host mapping', () => {
  // claude.ai is both a WEB_SURFACES host and the Claude DESKTOP app's host.
  // The desktop mapping must be untouched: processForHost answers "which
  // desktop app is this host reached through", and the answer is still the app.
  assert.equal(processForHost('claude.ai'), 'claude');
  assert.deepEqual(processesForHost('chatgpt.com'), ['chatgpt', 'chatgpt classic']);
  // And an Inventory block on a host must never synthesize a browser row —
  // a process_name:'chrome' row would be matched process-wide by the enforcer
  // and swallow Enter in every tab.
  for (const host of WEB_SURFACES.map((s) => s.host)) {
    const rows = synthesizePlatformBlocks([{ host, product: 'x', vendor: 'y', blocked: true }]);
    for (const row of rows) {
      assert.equal(
        BROWSER_NAMES.includes(String(row.process_name || '').toLowerCase()), false,
        `an Inventory block on ${host} synthesized a browser process row: ${JSON.stringify(row)}`,
      );
    }
  }
});

test('webSurfaceForHost normalisation and rejection', () => {
  assert.equal(webSurfaceForHost('claude.ai').product, 'Claude');
  assert.equal(webSurfaceForHost('CLAUDE.AI').product, 'Claude');
  assert.equal(webSurfaceForHost('www.claude.ai').product, 'Claude');
  assert.equal(webSurfaceForHost('  chatgpt.com  ').product, 'ChatGPT');
  // Subdomains of a governed host are governed.
  assert.equal(webSurfaceForHost('foo.chatgpt.com').product, 'ChatGPT');
  // Everything else is not, including the near-misses that matter:
  // a suffix that is not a dot-boundary, and an attacker-controlled parent.
  assert.equal(webSurfaceForHost('notclaude.ai'), null);
  assert.equal(webSurfaceForHost('claude.ai.attacker.example'), null);
  // mail.google.com WAS asserted null here, as a statement that Gmail is not an
  // AI surface. That is no longer true and the change is deliberate: the Gemini
  // side panel lives in Gmail, and AI-xxx governs it.
  //
  // WHAT REPLACED THE OLD GUARANTEE. The old line said "Gmail is not governed".
  // The new guarantee is narrower and is asserted where it belongs -- Gmail is
  // governed ONLY at the Gemini composer:
  //   * capture refuses any element that is not the catalog composer
  //     (Is-BrowserComposerElement, asserted below);
  //   * a block is composer-scoped rather than host-scoped, so blocking Gemini
  //     cannot stop the user sending mail (hostApp, asserted in
  //     enforcer-browser-block.test.mjs).
  // Deleting either of those without restoring this line would silently govern
  // a whole email client.
  assert.equal(webSurfaceForHost('mail.google.com').product, 'Gemini');
  assert.equal(webSurfaceForHost('mail.google.com').hostApp, true,
    'Gmail must be a hostApp surface, or a block on Gemini would kill all of Gmail');
  // docs.google.com WAS asserted null here too. Now governed, and like Gmail it
  // is a hostApp surface -- the user's documents with an AI panel attached, so
  // the block is scoped to the Gemini composer and never to the editor.
  assert.equal(webSurfaceForHost('docs.google.com').product, 'Gemini');
  assert.equal(webSurfaceForHost('docs.google.com').hostApp, true,
    'Docs must be a hostApp surface, or blocking Gemini would stop document editing');
  assert.equal(webSurfaceForHost(''), null);
  assert.equal(webSurfaceForHost(null), null);
  assert.equal(webSurfaceForHost(undefined), null);
});

// The two-flag safety gate AI_PANELS and AGENT_SURFACES use. A surface enforces
// only after a human runs a live pass on THAT host in THAT browser and flips
// both flags — per-host, because passing on claude.ai says nothing about
// whether Gemini's composer reads correctly.
//
// This is the tripwire for that rule. It is deliberately an ALLOW-LIST of hosts
// a human has signed off, not a blanket "everything is disarmed": the point is
// that arming a surface must be a conscious edit in two places, so a flag
// flipped by accident (or by a well-meaning refactor) still fails here.
const LIVE_PASSED = new Set([
  // mail.google.com armed 2026-09-23 after a live pass in Chrome with the
  // Gemini side panel open: panel [Group] Name='Gemini' Class='MxSLJe',
  // composer [ComboBox] Name='Ask Gemini' Class='Pv5YRd TIYGAd VMkJgc' with
  // both Value and Text patterns. The only other text-capable focusable
  // elements in the window were the page RootWebAreas and [Edit] 'Search mail'.
  'mail.google.com',
  // docs.google.com armed 2026-09-24: the same Workspace side panel, composer
  // [ComboBox] 'Ask Gemini', send [Button] 'Submit' (reads 'Cancel' while a
  // response is generating -- the resting name is what the catalog carries).
  'docs.google.com',
  // outlook.office.com armed 2026-09-24: composer [Edit] 'Message Copilot'
  // AutomationId 'm365-chat-editor-target-element', send [Button] 'Send'.
  'outlook.office.com',
  // sharepoint.com armed 2026-09-24 -- Word online, both tenant host shapes.
  'sharepoint.com',
  // m365.cloud.microsoft armed 2026-09-21 (AI-218) after a live pass in Chrome:
  // the omnibox resolves the host through the SSO redirect chain and holds it
  // on a /chat/agent/<id> deep link; the composer is [Edit] AutomationId
  // 'm365-chat-editor-target-element' with Name 'Message <agent>', readable
  // through BOTH ValuePattern and TextPattern; the send button is [Button]
  // 'Send' and exists only once the composer is non-empty.
  //
  // NOT measured: the GENERIC composer Name with no agent open -- the test
  // account landed straight in an agent. genericNames carries three plausible
  // spellings instead of one measured string. Recorded here because a live pass
  // with a known hole is not the same as a complete one.
  'm365.cloud.microsoft',
  // claude.ai re-armed 2026-09-09 after the security-audit fixes: findings 1
  // (click-after-unfocus bypass), 2/3 (capture read Documents, password fields
  // and other processes' elements), 4 (composer matched structurally, so a
  // cross-origin payment iframe qualified) and 5 (sticky _app guards) are all
  // closed, plus the app-switch cache-drop residual. chatgpt.com and
  // gemini.google.com stay disarmed until this one is re-verified by hand.
  'claude.ai',
  // chatgpt.com and gemini.google.com re-armed 2026-09-09 alongside claude.ai.
  // Same audit fixes cover all three: the composer-identity gate, the pid check,
  // the Document/password refusal, MouseEnforceOk, ForegroundIsBrowser and the
  // app-switch cache retention are all per-surface-agnostic. Each surface's own
  // composer name and send-button name were live-probed separately.
  'chatgpt.com',
  'gemini.google.com',
  // vertexaisearch.cloud.google.com armed 2026-09-22 (AI-219) after a live UIA
  // probe: the omnibox resolves the host on a /home/cid/<id>/r/agent/<id>/
  // deep link; the composer is [Group] Name='Search' AutomationId
  // 'agent-search-prosemirror-editor' ClassName 'prosemirror-editor'; the send
  // button is [Button] Name='Submit'; and TWO different agents produced two
  // different ids in the URL path, which is what the agent read matches on.
  //
  // FIRST SURFACE WITH NO PER-AGENT STRING IN THE COMPOSER: Name='Search' is
  // identical for every agent, so its composer identity is the AutomationId
  // alone and its AGENT identity is the URL. Both are recorded on the entry.
  'vertexaisearch.cloud.google.com',
]);

test('a web surface enforces only after a recorded live pass', () => {
  for (const s of WEB_SURFACES) {
    if (LIVE_PASSED.has(s.host)) {
      // Both flags, or the gate stays shut — asserting both catches the
      // half-flip that would look armed in the catalog but enforce nothing.
      assert.equal(s.enforce, true, `${s.id} is live-passed but enforce=false`);
      assert.equal(s.verified, true, `${s.id} is live-passed but verified=false`);
      assert.ok(enforcingWebSurface(s.host), `${s.id} is live-passed but the gate refuses it`);
      continue;
    }
    assert.equal(s.enforce, false, `${s.id} ships with enforce=true — needs a live pass first`);
    assert.equal(s.verified, false, `${s.id} ships with verified=true — needs a live pass first`);
    assert.equal(enforcingWebSurface(s.host), null, `${s.id} would enforce despite its flags`);
  }
});

test('an armed surface without a send-button signature blocks Enter only', () => {
  // Arming a host does NOT imply its click path is covered: the send button is
  // a separate live probe. This asserts the two are tracked independently, so
  // "armed" is never mistaken for "every send path is blocked".
  for (const s of WEB_SURFACES) {
    if (!enforcingWebSurface(s.host)) continue;
    if (s.sendButtonControlType && s.sendButtonName) continue;
    // Reaching here is legal — it just means Enter-only. Recorded so the gap is
    // visible rather than assumed away.
    assert.ok(true, `${s.id} is armed with no send-button signature: Enter-only blocking`);
  }
  // claude.ai is armed AND probed, so it must have both.
  const claude = WEB_SURFACES.find((s) => s.host === 'claude.ai');
  assert.ok(claude.sendButtonName, 'claude.ai is armed, so its click path must be covered');
});

test('buildWebSurfaceConfig carries both flags and no extra fields', () => {
  const cfg = buildWebSurfaceConfig();
  assert.equal(cfg.length, WEB_SURFACES.length);
  for (const row of cfg) {
    // Dropping either flag on the wire silently moves a surface to the other
    // side of the enforcement gate on the .ps1 side.
    assert.equal(typeof row.enforce, 'boolean');
    assert.equal(typeof row.verified, 'boolean');
    assert.equal(typeof row.host, 'string');
    assert.ok(row.host.length > 0);
    assert.deepEqual(
      Object.keys(row).sort(),
      ['agentReadEnforce', 'agentReadMode', 'agentReadUrlPattern', 'agentReadVerified',
       'composerAutomationId', 'composerControlType', 'composerFocusableChildClassName',
       'composerName', 'composerNamePrefixes',
       'enforce', 'genericNames',
       'host',
       // AI EMBEDDED IN A GENERAL-PURPOSE APP. True only for a host that is
       // NOT an AI tool -- somebody's mail or documents with an AI panel in
       // it -- and it NARROWS the block to that panel's composer. Travels on
       // every row so the .ps1 never has to tell missing from false.
       'hostApp',
       'id',
       // AI-216. The modelPicker block, FLATTENED exactly the way agentRead is.
       // FOURTEEN fields, present on EVERY row: the .ps1 must never have to
       // tell missing from empty, and a surface with no block is represented
       // by empties + false/false rather than by absent keys.
       //
       // The four ButtonTier*/ItemSelectedPrefix fields came with Gemini,
       // whose picker BUTTON names models differently from its MENU
       // ('currently Pro' vs '3.1 Pro') and which folds the selection state
       // into the selected item's Name instead of exposing SelectionItem.
       'modelPickerButtonTier1Label', 'modelPickerButtonTier2Label',
       'modelPickerButtonTier3Label',
       'modelPickerControlType', 'modelPickerEnforce', 'modelPickerFromTier',
       'modelPickerItemControlTypes', 'modelPickerItemSelectedPrefix',
       'modelPickerNamePrefix', 'modelPickerProvider',
       'modelPickerTier1Label', 'modelPickerTier2Label', 'modelPickerTier3Label',
       'modelPickerVerified',
       'newlineKeys', 'platform', 'platforms', 'postSendVerifyMs',
       'product', 'sendButtonControlType', 'sendButtonName', 'vendor', 'verified'],
    );
    // AI-216. BOTH flags of the picker's nested pair travel, for the same
    // reason the surface's own pair and agentRead's do: dropping either would
    // silently move model routing to the other side of its gate.
    assert.equal(typeof row.modelPickerEnforce, 'boolean');
    assert.equal(typeof row.modelPickerVerified, 'boolean');
    assert.ok(Array.isArray(row.modelPickerItemControlTypes));
    // The agent read has its OWN two-flag pair, and both travel for exactly the
    // reason the surface's own pair does: dropping either would silently move
    // the agent read to the other side of its gate.
    assert.equal(typeof row.agentReadEnforce, 'boolean');
    assert.equal(typeof row.agentReadVerified, 'boolean');
    // The send-button signature travels as two resolved strings. BOTH must be
    // non-empty for the enforcer to search at all: a control type with no name
    // would match every Button on the page, and a name with no control type
    // would widen the search to every element. '' means "unprobed" ⇒ that
    // surface gets Enter-only blocking rather than a guessed rectangle.
    assert.equal(typeof row.sendButtonControlType, 'string');
    assert.equal(typeof row.sendButtonName, 'string');
    // Tier B knobs are resolved to concrete values here so the C# side never
    // has to tell missing from empty.
    assert.equal(typeof row.newlineKeys, 'string');
    assert.ok(row.newlineKeys.length > 0);
    assert.equal(typeof row.postSendVerifyMs, 'number');
    // 1500, not the 200ms default: a Chromium composer's value reaches UIA one
    // serialization hop late, so a shorter window reads back the pre-write text
    // and abandons a rewrite that actually succeeded. Same value and reason as
    // the Teams entry.
    assert.equal(row.postSendVerifyMs, 1500, `${row.id} must allow for the Chromium serialization hop`);
    // AI-219. The composer control type is resolved to the DEFAULT, never to
    // '' -- the one field here whose empty would be meaningless. Four of the
    // shipped surfaces predate it and must keep asking for an [Edit].
    assert.equal(typeof row.composerControlType, 'string');
    assert.ok(row.composerControlType.length > 0, `${row.id} ships no composer control type`);
    // The agent-id pattern travels only for the mode that uses it, and an empty
    // pattern extracts nothing -- so a mode/pattern mismatch yields "no agent",
    // which is no block rather than a wrong one.
    assert.equal(typeof row.agentReadUrlPattern, 'string');
    // AI-219 follow-up. '' means "the identified element IS the composer" --
    // the only shape that existed before, and what all four older surfaces
    // still declare. A non-empty value means the composer is that element's
    // focusable CHILD, and the identity stays anchored on
    // composerAutomationId, which is therefore required alongside it.
    assert.equal(typeof row.composerFocusableChildClassName, 'string');
    if (row.composerFocusableChildClassName) {
      assert.ok(row.composerAutomationId.length > 0,
        `${row.id} declares a child descent with no anchor to identify it by`);
    }
    if (row.agentReadMode !== 'url_path') {
      assert.equal(row.agentReadUrlPattern, '', `${row.id} carries a URL pattern it cannot use`);
    } else {
      assert.ok(row.agentReadUrlPattern.includes('('), `${row.id} url_path pattern has no capture group`);
    }
  }
});

test('an Inventory host block reaches the browser, and only element-scoped', () => {
  const rows = synthesizePlatformBlocks([
    { host: 'claude.ai', product: 'Claude', vendor: 'Anthropic', blocked: true },
  ]);
  const web = rows.filter((r) => r.browser_host);
  assert.equal(web.length, 1, 'expected exactly one browser row for claude.ai');
  assert.equal(web[0].browser_host, 'claude.ai');
  // It carries `host` too, which is what lets an approved exception subtract it.
  assert.equal(web[0].host, 'claude.ai');
  // And it must carry NO process_name: such a row is matched process-WIDE by
  // the enforcer and would swallow Enter in every tab of the browser.
  assert.equal('process_name' in web[0], false, 'the browser row must not carry a process name');
  for (const r of rows) {
    assert.equal(
      BROWSER_NAMES.includes(String(r.process_name || '').toLowerCase()), false,
      `a browser process row was synthesized: ${JSON.stringify(r)}`,
    );
  }
});

test('an approved host exception lifts the browser block row', () => {
  const rows = synthesizePlatformBlocks([
    { host: 'claude.ai', product: 'Claude', vendor: 'Anthropic', blocked: true },
  ]);
  assert.ok(rows.some((r) => r.browser_host === 'claude.ai'));
  // scope:'host' (and a legacy row with no scope at all) lifts every row for
  // that host — including the browser one. This is what makes Request Access
  // actually unblock a web surface.
  const after = filterBlockedAgents(rows, [{ tool_host: 'claude.ai' }], null);
  assert.equal(after.some((r) => r.browser_host === 'claude.ai'), false,
    'an approved claude.ai exception did not lift the browser row');
  // An exception for a DIFFERENT host must not lift it.
  const other = filterBlockedAgents(rows, [{ tool_host: 'chatgpt.com' }], null);
  assert.ok(other.some((r) => r.browser_host === 'claude.ai'),
    'a chatgpt.com exception wrongly lifted the claude.ai browser row');
});

test('web-surface products match what the extension reported', () => {
  // The monitor REPLACES the extension on this surface, so its events must
  // merge into the existing platform row on the AI Usage dashboard rather than
  // opening a parallel one beside the history. These strings are content.js's
  // inferService() values.
  const byHost = Object.fromEntries(WEB_SURFACES.map((s) => [s.host, s.product]));
  assert.equal(byHost['claude.ai'], 'Claude');
  assert.equal(byHost['chatgpt.com'], 'ChatGPT');
  assert.equal(byHost['gemini.google.com'], 'Gemini');
  // 'Claude' and not 'Claude Desktop': the desktop app keeps that name, and the
  // two are told apart by process_name and tab_host instead.
  assert.notEqual(byHost['claude.ai'], 'Claude Desktop');
});

test('a send-button signature is live-probed or absent, never guessed', () => {
  // Each value here was read off a live browser, never inferred — a guessed
  // rectangle in a browser would swallow clicks on arbitrary page content,
  // which is why the desktop corner heuristic is unusable on this surface.
  //
  // Asserted PER SURFACE rather than as a shared constant: claude.ai and
  // gemini.google.com both happen to name their button 'Send message', but
  // that is a coincidence between two unrelated implementations (Base UI vs
  // Angular Material) and must not be refactored into one value that a single
  // vendor rename would then break for both.
  const byHost = Object.fromEntries(WEB_SURFACES.map((s) => [s.host, s]));
  const EXPECTED = {
    // Chrome, 2026-09-23: [Button] Name='Submit' at 1773,1004, present but
    // IsEnabled=false while the composer is empty -- the opposite of claude.ai,
    // where the control is absent until something is typed.
    //
    // 'Submit' is also what Gemini Enterprise's arrow is called. That is a
    // coincidence between two Google surfaces, not a shared implementation, and
    // it is listed per-host here for the same reason claude.ai and
    // gemini.google.com both saying 'Send message' is: one vendor rename must
    // not silently break the other.
    'mail.google.com':   'Submit',
    // Chrome, 2026-09-24: [Button] Name='Submit' at 1823,1004. Reads 'Cancel' at
    // the SAME rect while generating; the catalog carries the resting name.
    'docs.google.com':   'Submit',
    // Chrome, 2026-09-24: [Button] Name='Send' beside the Copilot composer --
    // the same name m365.cloud.microsoft uses, because it is the same component.
    'outlook.office.com': 'Send',
    // Chrome, 2026-09-24: [Button] Name='Send' Class='fui-Button ... fai-SendButton'
    'sharepoint.com':    'Send',
    // Chrome, 2026-09-08: [Button] Name='Send message' AutomationId='_r_bn_'
    'claude.ai':         'Send message',
    // Edge, 2026-09-09: [Button] Name='Send prompt'
    // AutomationId='composer-submit-button'
    'chatgpt.com':       'Send prompt',
    // Chrome, 2026-09-09: [Button] Name='Send message', nested in a Group whose
    // class carries 'send-button … has-input'
    'gemini.google.com': 'Send message',
    // Chrome, 2026-09-21: [Button] Name='Send', NO AutomationId, and absent
    // entirely while the composer is empty. The weakest signature in the
    // catalog -- see the residual-risk note on the entry itself.
    'm365.cloud.microsoft': 'Send',
    // 2026-09-22: [Button] Name='Submit' AutomationId='button'
    // ClassName='icon-button  filled-tonal ' rect=1541,1012 51x51. The
    // AutomationId is the generic word 'button', so the NAME is the signal here
    // too -- the same choice claude.ai's generated '_r_bn_' forced.
    'vertexaisearch.cloud.google.com': 'Submit',
  };
  for (const [host, name] of Object.entries(EXPECTED)) {
    assert.equal(byHost[host].sendButtonControlType, 'Button', `${host} send control type`);
    assert.equal(byHost[host].sendButtonName, name, `${host} send button name`);
  }
  // Every ARMED surface is covered — if a fourth is armed, it must be probed
  // too rather than silently shipping without a click block.
  //
  // Scoped to armed surfaces because AI-218 adds catalogued-but-INERT Microsoft
  // entries. Those deliberately carry NO send-button signature: 'Send' on
  // m365.cloud.microsoft is a generic word with no AutomationId to disambiguate
  // it, so it gets Enter-only blocking rather than a rectangle that could
  // swallow clicks on unrelated M365 controls. An unprobed surface having no
  // signature is the correct state; an ARMED one having none would be the gap.
  assert.deepEqual(
    WEB_SURFACES.filter((s) => s.enforce && s.verified).map((s) => s.host).sort(),
    Object.keys(EXPECTED).sort(),
    'an ARMED WEB_SURFACES entry exists with no recorded send-button probe',
  );
  // Half a signature is never shipped: it is both fields or neither.
  for (const s of WEB_SURFACES) {
    const ct = s.sendButtonControlType || '';
    const nm = s.sendButtonName || '';
    assert.equal(!!ct, !!nm, `${s.id} ships half a send-button signature`);
  }
  // The AutomationId must never become the signal — claude.ai's is a generated
  // Base UI id ('_r_bn_') that changes between renders, and the ClassName is the
  // shared 'cds-reset group/btn …' soup every button on the site carries.
  for (const s of WEB_SURFACES) {
    assert.equal('sendButtonAutomationId' in s, false, `${s.id}: AutomationId is generated, never durable`);
    assert.equal('sendButtonClass' in s, false, `${s.id}: ClassName is shared across every button on the site`);
  }
});

test('WEB_SURFACES declares no paths', () => {
  // HOST ONLY. A path field is one step from a query string, and a query string
  // on an AI URL routinely contains the prompt itself.
  for (const s of WEB_SURFACES) {
    assert.equal(s.host.includes('/'), false, `${s.id} host contains a path`);
    assert.equal('path' in s, false, `${s.id} declares a path`);
    assert.equal('pathRules' in s, false, `${s.id} declares pathRules — see the HOST ONLY note`);
  }
});

test('BROWSER_PROCS entries yield exactly one literal process name each', () => {
  // The .ps1/C# side turns each match into an exact-match HashSet key, so a
  // regex alternation would silently match nothing.
  for (const e of BROWSER_PROCS) {
    const src = e.match.source;
    assert.equal(src.includes('|'), false, `${src} uses alternation — needs one entry per name`);
    assert.ok(src.startsWith('^') && src.endsWith('$'), `${src} must be anchored`);
  }
  assert.equal(new Set(browserProcNames()).size, browserProcNames().length, 'duplicate process name');
});

// ── prompt-watcher.ps1 privacy gates, asserted against the source ───────────

test('prompt-watcher.ps1 resolves the URL before reading any text', () => {
  const src = readFile(join(OS_MONITOR, 'prompt-watcher.ps1'), 'utf8');
  return src.then((text) => {
    const classifyAt = text.indexOf('$webSurface = Classify-WebSurface');
    assert.ok(classifyAt > 0, 'the web-surface resolution is gone');
    // The ordering invariant: in the non-tracker loop the surface is resolved
    // before the focused element is fetched, so a Gmail or Jira composer is
    // never read at all. If a future edit reads text first and classifies
    // after, this fails.
    const readAt = text.indexOf('$text = Read-FocusedText $focused', classifyAt);
    assert.ok(readAt > classifyAt, 'text is read before the surface is resolved');
  });
});

test('prompt-watcher.ps1 excludes browser chrome from composer reads', () => {
  const src = readFile(join(OS_MONITOR, 'prompt-watcher.ps1'), 'utf8');
  return src.then((text) => {
    assert.ok(text.includes('function Is-BrowserChromeElement'), 'the omnibox exclusion is gone');
    // The exclusion must be APPLIED, not merely defined, and on both read paths.
    // The browser gate is now THREE predicates, all added by the 2026-09-09
    // security audit: the chrome-name exclusion, a composer test that refuses
    // Document and password fields (the capture path was more permissive than
    // the enforcer's), and a pid check so a globally-focused element from
    // another process is never read.
    const applied = text.match(/\$chromeBlocked = \$isBrowserFg -and \(\(Is-BrowserChromeElement \$focused\)/g) || [];
    assert.equal(applied.length, 2, 'the browser read gate is not applied on both read paths');
    // The pid check guards BOTH read paths. The composer-IDENTITY gate guards
    // only the non-tracker path: the tracker resolves its surface with
    // Classify-ClaudeUrl (no $webSurface) and reports LENGTH ONLY, so no text
    // can be persisted there and the finding-4 harm cannot occur — see the
    // comment on that branch.
    assert.equal((text.split('Element-BelongsToForeground $focused $fg.pid').length - 1), 2,
      'the pid check must guard BOTH browser read paths');
    assert.equal((text.split('Is-BrowserComposerElement $focused $webSurface').length - 1), 1,
      'the composer-identity gate belongs on the non-tracker read path');
    // Document and password fields must be refused for a browser: in a Chromium
    // tree the PAGE and the transcript pane are both Documents, so accepting one
    // meant reading up to 16,000 chars of the whole conversation.
    const composerFn = text.slice(text.indexOf('function Is-BrowserComposerElement'));
    const body = composerFn.slice(0, composerFn.indexOf(String.fromCharCode(10) + '}'));
    assert.match(body, /if \(\$el\.Current\.IsPassword\) \{ return \$false \}/);
    // The control type is CATALOG DATA now, not a hard-coded Edit: Gemini
    // Enterprise's composer is a Group and the Gemini panel in Gmail is a
    // ComboBox, and capture saw neither while this was pinned to Edit.
    // What must still hold is that an UNRECOGNISED type refuses.
    assert.ok(body.includes('$el.Current.ControlType -ne $ctObj'),
      'the composer control type must come from the catalog');
    assert.ok(body.includes('default    { return $false }'),
      'an unmappable control type must refuse, never fall back to any type');
    // Matched against the CODE form, not the bare word: the rule is worth
    // explaining in a comment, and a substring test on prose would forbid
    // saying why. On a web page ControlType.Document is the RootWebArea --
    // the whole page -- so accepting it would read everything, every tick.
    assert.equal(/ControlType\]::Document/.test(body), false,
      'a browser composer must never accept ControlType.Document');
    const guards = text.match(/-and -not \$chromeBlocked/g) || [];
    assert.equal(guards.length, 2, 'the omnibox exclusion is computed but not enforced');

    // THE INVARIANT: the exclusion must recognise at least everything the
    // address-bar FINDER recognises. A narrower exclusion than the finder
    // leaves a gap by construction — an element the finder would happily read
    // a URL out of, that the composer path is still willing to read as a
    // prompt. Both are asserted to use the same alternation.
    const finder = text.match(/if \(\$nm -match '([^']+)'\) \{\s*\n\s*\$vp = \$null/);
    assert.ok(finder, 'could not locate the address-bar finder pattern');
    const exclusion = text.match(/if \(\$nm -match '([^']+)'\) \{ return \$true \}/);
    assert.ok(exclusion, 'could not locate the chrome-exclusion pattern');
    for (const alt of finder[1].split('|')) {
      assert.ok(
        exclusion[1].split('|').includes(alt),
        `the finder matches '${alt}' but the exclusion does not — that element could be read as a prompt`,
      );
    }
  });
});

test('prompt-watcher.ps1 never emits a URL, a path or a browser window title', () => {
  const src = readFile(join(OS_MONITOR, 'prompt-watcher.ps1'), 'utf8');
  return src.then((text) => {
    // Only the catalog-matched host may travel on an event.
    assert.ok(text.includes("browser_host = if ($webSurface) { '' + $webSurface.host }"),
      'browser_host must carry the catalog host, not the URL');
    // No EMITTED field may be built from a URL. Scoped to the Emit-Json
    // hashtables rather than the whole file, because the URL legitimately
    // appears in the resolver and its cache — it just must never travel.
    // (A crude file-wide grep for '= $url' matches the cache line and is why
    // this is scoped: the assertion has to describe emission, not mention.)
    const emits = text.match(/Emit-Json @\{[\s\S]*?\n *\}/g) || [];
    assert.ok(emits.length >= 3, 'could not locate the Emit-Json blocks');
    for (const block of emits) {
      assert.equal(/\$url\b/.test(block), false, `a URL is emitted:\n${block}`);
      assert.equal(/\$uri\b/.test(block), false, `a parsed URI is emitted:\n${block}`);
      assert.equal(/AbsolutePath|\.Query\b/.test(block), false, `a path or query is emitted:\n${block}`);
    }
    // Classify-WebSurface itself must not look at a path.
    const fn = text.slice(text.indexOf('function Classify-WebSurface'));
    const body = fn.slice(0, fn.indexOf('\n}\n'));
    assert.equal(body.includes('AbsolutePath'), false, 'Classify-WebSurface reads a path');
    assert.equal(body.includes('Query'), false, 'Classify-WebSurface reads a query string');
    // The element Name is not collected for a browser surface: on a web page it
    // is site-authored and can carry the document or conversation title.
    assert.ok(text.includes('if (-not $isBrowserFg) {'), 'the browser title suppression is gone');
  });
});

test('prompt-watcher.ps1 parses its catalog without the PS 5.1 pipeline trap', () => {
  const src = readFile(join(OS_MONITOR, 'prompt-watcher.ps1'), 'utf8');
  return src.then((text) => {
    // In Windows PowerShell 5.1 ConvertFrom-Json hands a JSON ARRAY to the
    // pipeline as ONE un-enumerated object, so `@($env:X | ConvertFrom-Json)`
    // yields a single element holding every row and every host comparison
    // silently matches nothing. This bug was real and caught by test; the
    // direct-call form inside foreach is the fix and the file's own convention.
    assert.equal(
      /@\(\$env:CFAI_WEB_SURFACES \| ConvertFrom-Json\)/.test(text), false,
      'the piped ConvertFrom-Json form is back — a JSON array does not enumerate in PS 5.1',
    );
    assert.ok(
      text.includes('foreach ($s in (ConvertFrom-Json $env:CFAI_WEB_SURFACES))'),
      'the catalog must be parsed with a direct ConvertFrom-Json call inside foreach',
    );
  });
});

test('the web-surface payload is opt-in from the Node side', () => {
  const src = readFile(join(OS_MONITOR, 'prompt-watcher.js'), 'utf8');
  return src.then((text) => {
    // An absent payload makes Classify-WebSurface return null for every URL, so
    // this conditional IS the feature switch — not a flag the .ps1 has to be
    // trusted to check.
    assert.ok(
      text.includes('...(this.webSurfaces ? { CFAI_WEB_SURFACES: JSON.stringify(buildWebSurfaceConfig()) } : {})'),
      'the web-surface payload is no longer gated on the webSurfaces flag',
    );
  });
});

test('the passive detection toast yields to the block dialog, but never goes silent', async () => {
  // The user-visible bug this guards: the UIA watcher reads the composer every
  // ~1.2s, so the "CRITICAL — sensitive content typed" toast fired WHILE the
  // person was still typing, before any send attempt. On an enforcing surface
  // they then got the BLOCKED toast and the block dialog as well: three pop-ups
  // for one event, and the only actionable one was the dialog.
  //
  // The suppression must be conditional. Going quiet on a DETECT-ONLY surface
  // would be a real loss of coverage, because there is no block dialog there to
  // take over.
  // The logic lives in #reportPromptText, not inline in the handler. Both
  // prompt_text handlers — the watcher's and the enforcer's — delegate to it,
  // which is what stops the two paths drifting on which pop-ups they raise.
  const src = await readFile(join(OS_MONITOR, 'index.js'), 'utf8');
  const handler = src.slice(src.indexOf('#reportPromptText(ev, { fromEnforcer }) {'),
                            src.indexOf('#lastKnownFleetEvidenceDlp()'));
  assert.ok(handler.length > 0, 'expected a #reportPromptText body');
  // …and both handlers really do route through it, or the suppression would
  // only apply to whichever one kept a copy.
  assert.match(src, /this\.promptWatcher\.on\('prompt_text', \(ev\) => this\.#reportPromptText\(ev, \{ fromEnforcer: false \}\)\)/);
  assert.match(src, /this\.#reportPromptText\(ev, \{ fromEnforcer: true \}\)/);

  // Reporting is NOT conditional — the dlp event is enqueued regardless, so the
  // dashboard and the audit trail are untouched by this. Only the pop-up moves.
  assert.ok(handler.indexOf('this.reporter.enqueue(') < handler.indexOf('const willBlock'),
    'the event must be reported before any notification decision');

  const gate = handler.slice(handler.indexOf('const willBlock'), handler.indexOf('} else {'));
  // All three conditions required, so suppression happens ONLY when a block is
  // genuinely coming to replace the toast.
  assert.match(gate, /if \(!ev\.browser_host\) return false;/, 'a desktop app must keep its existing toast');
  assert.match(gate, /if \(!this\.enforcerEnabled\) return false;/, 'enforcer off means detect-only');
  assert.match(gate, /if \(!enforcingWebSurface\(ev\.browser_host\)\) return false;/, 'an unverified surface is detect-only');
  // And the matched patterns must actually be blockable. The scan set and the
  // block set are the same 37 patterns today, but both come from synced fleet
  // policy — a policy that blocked a subset of what it detects would otherwise
  // silence the remainder with no notification at all.
  assert.match(gate, /getBlockPatterns\(\)/, 'suppression must verify the pattern is in the LIVE block set');
  assert.match(gate, /matches\.some\(/, 'suppression must check the matched patterns, not just the surface');
});

test('the BLOCKED toast yields to the dialog, and comes back if the dialog fails', async () => {
  // Both notifications for one block was the complaint. The popup is the better
  // one: it names the app and patterns AND can be acted on (Tokenize & Send /
  // Edit / Override), so on a browser surface it takes over.
  //
  // THE HAZARD this guards against is removing the toast outright. The popup
  // opens on ONE condition — a rewritable block with a preview. An attachment
  // hold, a platform block, or a content block whose composer could not be
  // re-read reaches no dialog at all: the Electron block dialog is not a second
  // net either, because its @@CFAI-BLOCK relay is gated behind `legacyStdout`,
  // off everywhere but the packaged desktop app. Suppressing unconditionally
  // would leave a swallowed Enter with nothing on screen to explain it — the
  // user's keyboard looks broken and support has no thread to pull.
  const src = await readFile(join(OS_MONITOR, 'index.js'), 'utf8');
  const handler = src.slice(src.indexOf("this.enforcer.on('block'"), src.indexOf('// ── Request Access, at the moment of the block'));
  assert.ok(handler.length > 0, 'expected a block handler');

  // TWO dialogs can take over, and each suppression condition must mirror its
  // own dialog's condition exactly — otherwise a block falls through the gap
  // between them and shows nothing at all.
  const gate = handler.slice(handler.indexOf('const tokenizeWillOffer'), handler.indexOf('if (!dialogWillOffer'));

  // 1. Tokenize & Send — a DLP content block on a browser surface.
  for (const term of ['ev.browser_host', 'ev.rewritable', 'ev.block_id', '!isPlatform', '!isAttachment', 'ev.preview']) {
    assert.ok(gate.includes(term), `the tokenize suppression lost its ${term} term`);
  }
  // A DESKTOP content block keeps its toast: ev.browser_host is required, which
  // is what keeps long-shipped fleet behaviour untouched.
  assert.match(gate, /ev\.browser_host &&/, 'a desktop content block must keep its toast');

  // 2. Request Access — a PLATFORM block, where there is nothing to tokenize
  // because the site is disallowed outright. `toolHost` is required because
  // #offerAccessRequest refuses to open a dialog it has nothing to ask for;
  // without that term we would suppress the toast for a block showing nothing.
  assert.match(gate, /const accessWillOffer = !!\(isPlatform && !isAttachment && toolHost\)/,
    'the Request Access suppression must require a resolvable tool_host');
  assert.match(gate, /const dialogWillOffer = tokenizeWillOffer \|\| accessWillOffer/);
  // An ATTACHMENT hold reaches neither dialog, so it must keep its toast.
  assert.ok(gate.includes('!isAttachment'), 'an attachment hold must keep its toast');

  // And the dialog's failure path re-shows it. Without this the suppression is
  // a silent-failure mode rather than a UX improvement.
  const failPath = handler.slice(handler.indexOf('tokenize: offer failed'));
  assert.match(failPath, /if \(dialogWillOffer && this\.#shouldFire\(/,
    'a dialog that fails to open must fall back to the toast');
  assert.match(failPath, /this\.toast\.show\(/, 'the fallback must actually show something');
  // And the Request Access dialog needs the same net, in ITS handler — a
  // platform block whose dialog throws would otherwise leave the user in front
  // of an app that silently will not send.
  const accessHandler = src.slice(src.indexOf("this.enforcer.on('requestaccessoffer'"));
  const accessFail = accessHandler.slice(0, accessHandler.indexOf('});') + 3);
  assert.match(accessFail, /access-request: offer failed/);
  assert.match(accessFail, /this\.toast\.show\(/,
    'a Request Access dialog that fails to open must fall back to the toast');
  // Same dedup key on both paths, so the fallback can never double up with the
  // toast the suppression skipped.
  const keyRe = /`enf\|\$\{ev\.process\}\|\$\{ev\.patterns\}\|\$\{ev\.filename \|\| ''\}`/g;
  assert.equal((handler.match(keyRe) || []).length, 2,
    'both the suppressed toast and its fallback must share one dedup key');
});

test('the composer is identified POSITIVELY, not just structurally', () => {
  // Security audit finding 4. The composer test was structural — any Edit on a
  // governed host that was not a password and not chrome-named. That matched a
  // "Search chats" box, a rename field, and most seriously an Edit inside a
  // CROSS-ORIGIN IFRAME, because the omnibox only reveals the TOP-LEVEL url.
  // A payment iframe's card-number field is an Edit, is not IsPassword, and
  // matches no chrome name: it was cached as the composer, read every tick,
  // matched the credit-card pattern, and had its raw value persisted server-side.
  //
  // Every governed surface must therefore carry its composer's live-probed
  // accessible name, and the .ps1 must require an exact match.
  // THE INVARIANT IS "never matched structurally alone", not "must have an
  // exact name". AI-218 needs a second shape: Microsoft's composer Name embeds
  // the agent's own display name ("Message IT Help Desk Agent"), so it changes
  // per agent and no fixed string can match it. That surface is identified by a
  // stable AutomationId AND a name prefix, both required — which is strictly
  // MORE evidence than a name alone, not less.
  //
  // So every surface must carry one of:
  //   (a) an exact composerName, or
  //   (b) composerAutomationId AND composerNamePrefixes, or
  //   (c) AI-219: composerAutomationId alone, and ONLY on a url_path surface.
  //       (With composerFocusableChildClassName the id is matched on the
  //       element's ANCHOR ancestor rather than on the element itself -- the
  //       identity is the same exact ordinal AutomationId either way, and the
  //       class is an ADDITIONAL requirement, never a substitute for it.)
  //       Gemini Enterprise's composer is [Group] Name='Search' for EVERY
  //       agent, so there is no name to match and no prefix to take. What keeps
  //       this from being "structural alone" — the finding-4 defect — is that
  //       the id is semantic and specific ('agent-search-prosemirror-editor'),
  //       matched ordinally and whole-string, AND that the agent identity comes
  //       from a second, independent signal (the URL) rather than from the same
  //       string. A url_path surface with no AutomationId has no identity at
  //       all and is refused by the clause below like any other.
  //   (d) nothing at all — in which case it must be UNARMED, because a surface
  //       with no identity can never be allowed to read anything.
  for (const s of WEB_SURFACES) {
    const exact = !!(s.composerName && s.composerName.length);
    const hasAid = !!(s.composerAutomationId && s.composerAutomationId.length);
    const structural = hasAid && !!(s.composerNamePrefixes && s.composerNamePrefixes.length);
    const urlPath = hasAid && !!(s.agentRead && s.agentRead.mode === 'url_path');
    const armed = s.enforce && s.verified;
    assert.ok(exact || structural || urlPath || !armed,
      `${s.id} is armed with no positive composer identity — it would be matched structurally`);
    // A PREFIX ON ITS OWN IS NOT ENOUGH. "Message " is a common label; without
    // the AutomationId pinning the element it would be a structural match
    // wearing a name, which is the exact defect audit finding 4 was about.
    if (s.composerNamePrefixes && s.composerNamePrefixes.length) {
      assert.ok(s.composerAutomationId && s.composerAutomationId.length,
        `${s.id} identifies its composer by prefix alone — that is a structural match`);
    }
  }
  const byHost = Object.fromEntries(WEB_SURFACES.map((s) => [s.host, s.composerName]));
  assert.equal(byHost['claude.ai'], 'Write your prompt to Claude');
  assert.equal(byHost['chatgpt.com'], 'Chat with ChatGPT');
  assert.equal(byHost['gemini.google.com'], 'Enter a prompt for Gemini');
  // Resolved into the payload so the .ps1 never has to tell missing from empty.
  for (const row of buildWebSurfaceConfig()) {
    assert.equal(typeof row.composerName, 'string');
    assert.equal(typeof row.composerAutomationId, 'string');
    assert.ok(Array.isArray(row.composerNamePrefixes));
    const armedRow = row.enforce && row.verified;
    if (armedRow) {
      assert.ok(row.composerName.length > 0
        || (row.composerAutomationId.length > 0 && row.composerNamePrefixes.length > 0)
        || (row.composerAutomationId.length > 0 && row.agentReadMode === 'url_path'),
        `${row.id} ships armed with no composer identity`);
    }
  }
});

test('an unidentified composer is REFUSED, never allowed', async () => {
  // The fail direction, which is the whole point: a surface with no known
  // composer name gets NO capture rather than falling back to "any Edit".
  // Asserted at the source, because the alternative reading of an empty name
  // ("no constraint") is exactly the finding-4 behaviour.
  const text = await readFile(join(OS_MONITOR, 'prompt-watcher.ps1'), 'utf8');
  const fn = text.slice(text.indexOf('function Is-BrowserComposerElement'));
  const body = fn.slice(0, fn.indexOf(String.fromCharCode(10) + '}'));
  // The shape changed when capture learned the other two identity forms
  // (AutomationId + prefix, and AutomationId alone on a url_path surface), but
  // the PROPERTY is unchanged and is what is asserted: a surface carrying
  // NEITHER a composer name NOR an AutomationId identifies nothing, and must
  // refuse rather than fall back to "any Edit" -- which is finding-4 behaviour.
  assert.match(body, /if \(-not \$wantAid\) \{ return \$false \}/,
    'no name and no AutomationId must REFUSE, not allow any Edit');
  // And shape (c) -- AutomationId with no name at all -- stays restricted to
  // url_path surfaces, where the agent identity comes from the URL instead.
  assert.match(body, /return \(\$mode -ieq 'url_path'\)/,
    'an AutomationId with no name prefix may only identify a url_path surface');
  // Exact, case-insensitive, whole-string — not a prefix or a substring, either
  // of which would re-admit a differently-named field on the same host.
  assert.match(body, /\$nm -ieq \$want/);
  assert.equal(/StartsWith|Contains|-match/.test(body), false,
    'the composer name match must be whole-string, not a prefix or substring');
});

test('the Request Access offer carries the host, or a browser block has no remedy', async () => {
  // LIVE FAILURE 2026-09-15. A blocked browser surface swallowed the send
  // correctly and then showed NOTHING: the log read
  //   "access-request: no tool_host for chrome — no dialog offered"
  // while the toast had already stood down because a dialog was expected.
  //
  // Cause: EmitBlock carried browser_host, OfferAccessRequest did not. On the
  // Node side blockToolHost() resolves browser_host -> panel -> PROCESS ->
  // platform map, and for a browser every fallback is empty BY DESIGN:
  // hostForProcess('chrome') is deliberately null (a browser is not in
  // AI_PROCESSES and must never name one host) and PLATFORM_BLOCK_SENTINEL has
  // no PLATFORM_PROCS entry. So the first term is the ONLY one that can
  // resolve, and without it there is nothing to request an exception against.
  const src = await readFile(join(OS_MONITOR, 'enforcer-win.ps1'), 'utf8');
  const fn = src.slice(src.indexOf('static void OfferAccessRequest('));
  const body = fn.slice(0, fn.indexOf(String.fromCharCode(10) + '    }'));
  assert.match(body, /\+ BrowserHostField\(\)/,
    'OfferAccessRequest must carry browser_host, or a blocked browser surface offers no way to request access');

  // BOTH emitters use the SAME helper, so the host on the block and the host on
  // the offer can never disagree — a mismatch would mint an exception that
  // lifts a different row than the one that fired.
  const code = src.split(String.fromCharCode(10)).filter((l) => !l.trim().startsWith('//')).join(String.fromCharCode(10));
  const emitBlock = code.slice(code.indexOf('static void EmitBlock('));
  assert.match(emitBlock.slice(0, emitBlock.indexOf(String.fromCharCode(10) + '    }')), /BrowserHostField\(\)/);

  // And the Node side must still read that field FIRST.
  const idx = await readFile(join(OS_MONITOR, 'index.js'), 'utf8');
  assert.match(idx, /return ev\.browser_host \|\| hostForPanel\(/,
    'blockToolHost must prefer browser_host — every other term is null for a browser');
});

// ── AI-216: model routing on claude.ai, and ONLY claude.ai ─────────────────

test('AI-216: ONLY live-probed surfaces carry a modelPicker block', () => {
  const withPicker = WEB_SURFACES.filter((s) => s.modelPicker);
  assert.deepEqual(
    withPicker.map((s) => s.id), ['claude_web', 'gemini_web'],
    'both were live-probed with the menu OPEN. chatgpt.com has no picker at all '
    + 'on the probed account (the Go plan exposes none), and every other surface '
    + 'is unmeasured. Adding a block here arms UI-driving code against a page '
    + 'nobody has measured — which is how this feature shipped two no-ops.',
  );
});

test('AI-216: gemini.google.com ships ARMED, with its live-measured signature', () => {
  const mp = WEB_SURFACES.find((s) => s.id === 'gemini_web').modelPicker;
  assert.equal(mp.enforce, true);
  assert.equal(mp.verified, true);
  // Measured 2026-09-22 in Chrome with the menu open. A change here means a
  // human re-probed the page, never that a test was noisy.
  assert.equal(mp.controlType, 'Button');
  // The model name is the SUFFIX on this surface; the trailing comma is part of
  // the measured string and stops this matching 'Open mode picker settings'.
  assert.equal(mp.namePrefix, 'Open mode picker,');
  // MenuItem, not RadioButton — delta 1 from claude.ai.
  assert.deepEqual(mp.itemControlTypes, ['MenuItem']);
  // Delta 3: the selected item folds its state into its Name.
  assert.equal(mp.itemSelectedPrefix, 'Selected ');
  assert.equal(mp.provider, 'google');
  // Delta 4: the button and the menu name the same model DIFFERENTLY, so the
  // strings we CLICK are not the strings we READ.
  assert.deepEqual(mp.tierLabels, { 3: '3.1 Pro', 2: '3.8 Flash', 1: '3.5 Flash-Lite' });
  assert.deepEqual(mp.buttonTierLabels, { 3: 'Pro', 2: 'Flash', 1: 'Flash-Lite' });
  // 'Extended thinking' is a SECOND AXIS, not a tier — Gemini's analogue of
  // Claude's Effort. It appears in the live menu and must never be a target.
  const all = JSON.stringify(mp);
  assert.equal(all.includes('Extended thinking'), false,
    'Extended thinking is an axis, not a tier — it must not be routable');
});

test('AI-216: claude.ai declares NEITHER Gemini field, so it is unaffected', () => {
  const mp = WEB_SURFACES.find((s) => s.id === 'claude_web').modelPicker;
  // The two fields added for Gemini must be absent here, not empty-but-present:
  // absent is what makes claude.ai's behaviour byte-identical to before.
  assert.equal(mp.itemSelectedPrefix, undefined,
    'claude.ai exposes SelectionItemPattern, so it needs no name-folded prefix');
  assert.equal(mp.buttonTierLabels, undefined,
    "claude.ai's button and menu agree ('Opus 5' in both), so one table suffices");
});

test('AI-216: resolveButtonTier survives the Flash / Flash-Lite prefix hazard', () => {
  const bt = { 3: 'Pro', 2: 'Flash', 1: 'Flash-Lite' };
  // THE HAZARD: 'Flash' is a proper prefix of 'Flash-Lite', so a naive
  // containment test reads a Flash-Lite user as being on Flash — one tier too
  // expensive — and would never route them down.
  //
  // TWO INDEPENDENT PROTECTIONS, and mutation testing showed EITHER IS
  // SUFFICIENT on this table: longest-label-first ordering tries 'Flash-Lite'
  // before 'Flash', and the boundary rule refuses 'Flash' against 'Flash-Lite'
  // because '-' continues an identifier. Disabling one alone still passes;
  // disabling both fails this test. That redundancy is deliberate — a future
  // table may defeat one of them (two labels of equal length, or a separator
  // outside the identifier class) — but it is recorded here rather than left
  // for someone to discover by deleting the 'unused' one.
  assert.equal(resolveButtonTier('Open mode picker, currently Flash-Lite', bt), 1);
  assert.equal(resolveButtonTier('Open mode picker, currently Flash', bt), 2);
  assert.equal(resolveButtonTier('Open mode picker, currently Pro', bt), 3);
  // No table -> 0, meaning "fall through to the keyword chain" — the path
  // claude.ai takes, unchanged.
  assert.equal(resolveButtonTier('Model: Opus 5 High', {}), 0);
  // A label naming nothing in the table is also 0, never a guess.
  assert.equal(resolveButtonTier('Open mode picker, currently Ultra', bt), 0);
});

test('AI-216: the button table exists because the keyword chain is WRONG here', () => {
  // Not a style preference. model-router-config orders google's rules
  // ['flash','lite'] -> economy BEFORE ['pro'] -> premium, so the chain
  // collapses two distinct live tiers into one. Pinned so that "simplify this
  // away and use detectModelInfo" fails rather than silently mis-tiering.
  // Asserted through the EXPORTED behaviour rather than the internal rule
  // table: what matters is the answer the chain gives, not how it is stored.
  const lite = detectModelInfoFromConfig('Open mode picker, currently Flash-Lite');
  const flash = detectModelInfoFromConfig('Open mode picker, currently Flash');
  assert.equal(lite?.tier, 'economy');
  assert.equal(flash?.tier, 'economy',
    'the chain collapses Flash and Flash-Lite into ONE tier — but the live menu '
    + 'has them as two (3.5 Flash-Lite, 3.8 Flash). A user on Flash would read as '
    + 'already-cheapest and never route down. That is why buttonTierLabels exists, '
    + 'and why replacing it with detectModelInfo would silently mis-tier Gemini.');
  // And the catalog table gives the answer the chain cannot.
  const bt = WEB_SURFACES.find((x) => x.id === 'gemini_web').modelPicker.buttonTierLabels;
  assert.equal(resolveButtonTier('Open mode picker, currently Flash', bt), 2);
  assert.equal(resolveButtonTier('Open mode picker, currently Flash-Lite', bt), 1);
});

test('AI-216: stripSelectedPrefix removes one declared prefix, and nothing else', () => {
  // The live selected item: 'Selected 3.1 Pro Advanced reasoning'.
  assert.equal(stripSelectedPrefix('Selected 3.1 Pro Advanced reasoning', 'Selected '),
    '3.1 Pro Advanced reasoning');
  // An unselected item is returned untouched.
  assert.equal(stripSelectedPrefix('3.8 Flash All-around help', 'Selected '),
    '3.8 Flash All-around help');
  // No declared prefix -> identity, which is every pre-Gemini surface.
  assert.equal(stripSelectedPrefix('Sonnet 5 Most efficient', ''), 'Sonnet 5 Most efficient');
  // It strips ONE prefix, not "any leading words" — a different leading word is
  // left alone, so the whole-token discipline still refuses an impostor.
  assert.equal(stripSelectedPrefix('Recommended 3.1 Pro', 'Selected '), 'Recommended 3.1 Pro');
});

test('AI-216: the selected item is matchable ONLY because the prefix is stripped', () => {
  // The regression this closes is state-dependent and therefore easy to miss:
  // without the strip, the boundary matcher refuses EXACTLY ONE item — whichever
  // is currently selected — so a route targeting the active model finds zero
  // matches while every other target works.
  const menu = [
    { controlType: 'MenuItem', name: '3.5 Flash-Lite Fastest answers' },
    { controlType: 'MenuItem', name: '3.8 Flash All-around help New' },
    { controlType: 'MenuItem', name: 'Selected 3.1 Pro Advanced reasoning' },
  ];
  const withStrip = matchModelPickerItems(menu, '3.1 Pro', ['MenuItem'], 'Selected ');
  assert.equal(withStrip.length, 1, 'the selected item must be findable');
  const without = matchModelPickerItems(menu, '3.1 Pro', ['MenuItem']);
  assert.equal(without.length, 0,
    'and without the prefix it is NOT — which is the bug, pinned so it cannot return');
  // The unselected items are unaffected either way.
  assert.equal(matchModelPickerItems(menu, '3.8 Flash', ['MenuItem'], 'Selected ').length, 1);
  // And the hazard again, at the MENU level: '3.8 Flash' must not match
  // '3.5 Flash-Lite'.
  assert.equal(matchModelPickerItems(menu, '3.8 Flash', ['MenuItem'], 'Selected ')[0].name,
    '3.8 Flash All-around help New');
});

test('AI-216: claude.ai ships ARMED, with the live-measured signature', () => {
  const mp = WEB_SURFACES.find((s) => s.id === 'claude_web').modelPicker;
  // Armed deliberately: live-probed on this host, and the user wants to test it.
  assert.equal(mp.enforce, true);
  assert.equal(mp.verified, true);
  // Every one of these came off a real UIA probe. If a value here changes, a
  // human re-probed the page — it must not change because a test was noisy.
  assert.equal(mp.controlType, 'Button');
  assert.equal(mp.namePrefix, 'Model:');
  assert.deepEqual(mp.itemControlTypes, ['RadioButton', 'MenuItem']);
  assert.equal(mp.provider, 'anthropic');
  assert.equal(mp.fromTier, 'button_label');
  // VERSIONED labels. 'Opus' alone would match an 'Opus 4.1' the user never
  // chose; the version is what the boundary rule then protects. They come from
  // the SHARED catalog now: Claude labels Opus/Sonnet '5.5' (live 2026-10-05),
  // and the hand-copied 'Sonnet 5' failed every web-arm route.
  assert.deepEqual(mp.tierLabels, { 3: 'Opus 5.5', 2: 'Sonnet 5.5', 1: 'Haiku 4.5' });
});

test('model routing: web picker click labels are the SHARED catalog\'s, never a stale copy', () => {
  // Live 2026-10-06 (agent 1307630): claude.ai in a browser failed
  // 'from_tier_not_confirmed_fallback_not_submitted' because this table said
  // 'Sonnet 5' while the menu item read 'Sonnet 5.5 ...'. One source of truth.
  for (const [id, host] of [['claude_web', 'claude.ai'], ['gemini_web', 'gemini.google.com']]) {
    const mp = WEB_SURFACES.find((s) => s.id === id).modelPicker;
    const tiers = MODEL_CATALOG.hosts[host].tiers;
    assert.deepEqual(mp.tierLabels, {
      3: tiers.premium.click_labels[0], 2: tiers.standard.click_labels[0], 1: tiers.economy.click_labels[0],
    }, id);
    assert.deepEqual(mp.tierLabels, catalogTierLabels(host), id);
  }
  // The live 2026-10 claude.ai item is matched by the standard label...
  const claude = WEB_SURFACES.find((s) => s.id === 'claude_web').modelPicker;
  assert.equal(modelItemNameMatches('Sonnet 5.5 Most efficient for simpler tasks', claude.tierLabels[2]), true);
  // ...which the old hand-copied label could never do (the root cause).
  assert.equal(modelItemNameMatches('Sonnet 5.5 Most efficient for simpler tasks', 'Sonnet 5'), false);
  assert.deepEqual(catalogTierLabels('no-such-host.example'), { 3: '', 2: '', 1: '' });
});

test('AI-216: the picker gate reads BOTH flags, and takes the SURFACE', () => {
  const claude = WEB_SURFACES.find((s) => s.id === 'claude_web');
  assert.ok(enforcingWebPicker(claude), 'claude.ai ships armed');

  // A surface with no block at all.
  assert.equal(enforcingWebPicker(WEB_SURFACES.find((s) => s.id === 'chatgpt_web')), null);
  assert.equal(enforcingWebPicker(null), null);
  assert.equal(enforcingWebPicker({}), null);

  const base = claude.modelPicker;
  // enforce WITHOUT verified, and verified WITHOUT enforce. Neither may arm.
  assert.equal(enforcingWebPicker({ modelPicker: { ...base, verified: false } }), null);
  assert.equal(enforcingWebPicker({ modelPicker: { ...base, enforce: false } }), null);
  // A block that describes no findable picker is refused, not defaulted — a
  // gate must not manufacture the signature it is gating on.
  assert.equal(enforcingWebPicker({ modelPicker: { ...base, namePrefix: '' } }), null);
  assert.equal(enforcingWebPicker({ modelPicker: { ...base, itemControlTypes: [] } }), null);
});

test('AI-216: the payload flattens the block, and defaults apply ONLY when it exists', () => {
  const cfg = buildWebSurfaceConfig();
  const claude = cfg.find((s) => s.id === 'claude_web');
  assert.equal(claude.modelPickerNamePrefix, 'Model:');
  assert.equal(claude.modelPickerControlType, 'Button');
  assert.deepEqual(claude.modelPickerItemControlTypes, ['RadioButton', 'MenuItem']);
  assert.equal(claude.modelPickerTier3Label, 'Opus 5.5');
  assert.equal(claude.modelPickerTier2Label, 'Sonnet 5.5');
  assert.equal(claude.modelPickerTier1Label, 'Haiku 4.5');
  assert.equal(claude.modelPickerProvider, 'anthropic');
  assert.equal(claude.modelPickerFromTier, 'button_label');
  assert.equal(claude.modelPickerEnforce, true);
  assert.equal(claude.modelPickerVerified, true);

  // claude.ai declares NEITHER Gemini field, and both resolve to empty -- which
  // is what keeps its behaviour byte-identical to before they existed.
  assert.equal(claude.modelPickerItemSelectedPrefix, '');
  assert.equal(claude.modelPickerButtonTier3Label, '');
  assert.equal(claude.modelPickerButtonTier2Label, '');
  assert.equal(claude.modelPickerButtonTier1Label, '');

  const gem = cfg.find((s) => s.id === 'gemini_web');
  assert.equal(gem.modelPickerNamePrefix, 'Open mode picker,');
  assert.deepEqual(gem.modelPickerItemControlTypes, ['MenuItem']);
  assert.equal(gem.modelPickerItemSelectedPrefix, 'Selected ');
  // The two tables are DIFFERENT strings for the same three models -- the whole
  // reason buttonTierLabels exists.
  assert.equal(gem.modelPickerTier3Label, '3.1 Pro');
  assert.equal(gem.modelPickerButtonTier3Label, 'Pro');
  assert.equal(gem.modelPickerTier1Label, '3.5 Flash-Lite');
  assert.equal(gem.modelPickerButtonTier1Label, 'Flash-Lite');
  assert.equal(gem.modelPickerProvider, 'google');
  assert.equal(gem.modelPickerEnforce, true);
  assert.equal(gem.modelPickerVerified, true);

  // EVERY surface WITHOUT a block resolves to empties and false/false. A
  // non-empty prefix there would describe a picker the enforcer would then go
  // looking for on a page nobody probed.
  const armed = new Set(['claude_web', 'gemini_web']);
  for (const s of cfg) {
    if (armed.has(s.id)) continue;
    assert.equal(s.modelPickerNamePrefix, '', `${s.id} must carry no picker prefix`);
    assert.equal(s.modelPickerControlType, '', `${s.id} must carry no picker control type`);
    assert.deepEqual(s.modelPickerItemControlTypes, [], `${s.id} must carry no item types`);
    assert.equal(s.modelPickerItemSelectedPrefix, '', `${s.id} must carry no selected prefix`);
    assert.equal(s.modelPickerButtonTier3Label, '', `${s.id} must carry no button labels`);
    assert.equal(s.modelPickerEnforce, false);
    assert.equal(s.modelPickerVerified, false);
  }
});

// THE REGRESSION GUARD FOR chatgpt.com.
//
// chatgpt_web ships enforce:true/verified:true and is what provides
// chatgpt.com's BLOCKING and DLP coverage. AI-216 adds no picker there (that
// account has no picker at all) and must disturb nothing else: silently
// disabling ChatGPT governance would be a far worse regression than the feature
// being added is an improvement. Byte-identical, field for field.
const CHATGPT_WEB_GOLDEN = {
  id: 'chatgpt_web',
  host: 'chatgpt.com',
  product: 'ChatGPT',
  vendor: 'OpenAI',
  platform: 'openai_assistant',
  newlineKeys: 'shift_enter',
  postSendVerifyMs: 1500,
  sendButtonControlType: 'Button',
  sendButtonName: 'Send prompt',
  composerName: 'Chat with ChatGPT',
  composerControlType: 'Edit',
  composerNamePrefixes: [],
  composerAutomationId: '',
  composerFocusableChildClassName: '',
  genericNames: [],
  platforms: [],
  agentReadMode: '',
  agentReadUrlPattern: '',
  agentReadEnforce: false,
  agentReadVerified: false,
  modelPickerControlType: '',
  modelPickerNamePrefix: '',
  modelPickerItemControlTypes: [],
  modelPickerTier3Label: '',
  modelPickerTier2Label: '',
  modelPickerTier1Label: '',
  // Present-but-EMPTY, exactly like the other picker fields: buildWebSurfaceConfig
  // emits every field on every row, and empty is what tells the enforcer there
  // is no picker here. chatgpt.com keeps its blocking and DLP coverage untouched.
  // FALSE, and that is the assertion: chatgpt.com is a dedicated AI tool, so
  // its block stays host-scoped. Flipping this would narrow ChatGPT's block
  // to its composer and let a blocked user send from another element.
  hostApp: false,
  modelPickerButtonTier3Label: '',
  modelPickerButtonTier2Label: '',
  modelPickerButtonTier1Label: '',
  modelPickerItemSelectedPrefix: '',
  modelPickerProvider: '',
  modelPickerFromTier: '',
  modelPickerEnforce: false,
  modelPickerVerified: false,
  enforce: true,
  verified: true,
};

test("AI-216: chatgpt_web's built payload is UNCHANGED, field for field", () => {
  const got = buildWebSurfaceConfig().find((s) => s.id === 'chatgpt_web');
  assert.deepEqual(got, CHATGPT_WEB_GOLDEN,
    'chatgpt.com carries this site\'s blocking and DLP coverage. If this fails, '
    + 'AI-216 disturbed an entry it was explicitly scoped out of.');
  // Stated separately so the reason is legible in the failure, not just the diff.
  assert.equal(got.enforce, true, 'chatgpt.com must stay ARMED for blocking');
  assert.equal(got.verified, true, 'chatgpt.com must stay ARMED for blocking');
  assert.equal(got.sendButtonName, 'Send prompt', 'the click-block signature must survive');
  assert.equal(got.composerName, 'Chat with ChatGPT', 'the DLP composer identity must survive');
});

// ── The pure item matcher ─────────────────────────────────────────────────

test('AI-216: the item matcher is boundary-aware, not a bare StartsWith', () => {
  // The MEASURED menu. These three must match their catalog labels.
  assert.equal(modelItemNameMatches('Opus 5 For complex tasks', 'Opus 5'), true);
  assert.equal(modelItemNameMatches('Sonnet 5 Most efficient for everyday tasks', 'Sonnet 5'), true);
  assert.equal(modelItemNameMatches('Haiku 4.5 Fastest for quick answers', 'Haiku 4.5'), true);

  // THE WHOLE POINT. A bare prefix test accepts all four of these, and every
  // one of them would route the user to a model nobody chose.
  assert.equal(modelItemNameMatches('Sonnet 5.5 Something', 'Sonnet 5'), false, 'a minor version must not match');
  assert.equal(modelItemNameMatches('Sonnet 50 Something', 'Sonnet 5'), false, 'a longer number must not match');
  assert.equal(modelItemNameMatches('Opus 5x Experimental', 'Opus 5'), false, 'a letter suffix must not match');
  assert.equal(modelItemNameMatches('Opus 5-preview', 'Opus 5'), false, 'a hyphenated variant must not match');
  assert.equal(modelItemNameMatches('Haiku 4.55 Faster', 'Haiku 4.5'), false, 'the version is protected too');

  // End-of-string is a match: a menu that renders the bare label is a hit.
  assert.equal(modelItemNameMatches('Sonnet 5', 'Sonnet 5'), true);
  // Case-insensitive on the label compare, mirroring the desktop path.
  assert.equal(modelItemNameMatches('sonnet 5 whatever', 'Sonnet 5'), true);
  // Degenerate inputs never match.
  assert.equal(modelItemNameMatches('', 'Sonnet 5'), false);
  assert.equal(modelItemNameMatches('Sonnet 5 x', ''), false);
  assert.equal(modelItemNameMatches(null, 'Sonnet 5'), false);
  assert.equal(modelItemNameMatches('Sonnet 5 x', null), false);
});

test('AI-216: ambiguity is a REFUSAL — zero or 2+ never clicks, and never the first', () => {
  const menu = [
    { controlType: 'RadioButton', name: 'Opus 5 For complex tasks' },
    { controlType: 'RadioButton', name: 'Sonnet 5 Most efficient for everyday tasks' },
    { controlType: 'RadioButton', name: 'Haiku 4.5 Fastest for quick answers' },
    { controlType: 'MenuItem', name: 'Effort High' },
    { controlType: 'MenuItem', name: 'More models' },
  ];
  const types = ['RadioButton', 'MenuItem'];

  assert.equal(matchModelPickerItems(menu, 'Sonnet 5', types).length, 1, 'exactly one clicks');

  // A tier this account does not have. AN ORDINARY RUNTIME PATH, not an anomaly:
  // model availability is per account, not per host.
  assert.equal(matchModelPickerItems(menu, 'Fable 5.1', types).length, 0);

  // TWO matches. The caller must refuse, never take the first — there is no
  // evidence available to break the tie.
  const dupes = menu.concat([{ controlType: 'RadioButton', name: 'Sonnet 5 (legacy)' }]);
  assert.equal(matchModelPickerItems(dupes, 'Sonnet 5', types).length, 2);

  // The control type is part of the match: a Text node reading the same string
  // is not a clickable item.
  const asText = [{ controlType: 'Text', name: 'Sonnet 5 Most efficient' }];
  assert.equal(matchModelPickerItems(asText, 'Sonnet 5', types).length, 0);

  // An EMPTY type list matches NOTHING — fail closed, never "any control".
  assert.equal(matchModelPickerItems(menu, 'Sonnet 5', []).length, 0);
  assert.equal(matchModelPickerItems(menu, 'Sonnet 5', undefined).length, 0);
});

test('AI-216: the effort token is parsed from the SAME label the tier comes from', () => {
  // Measured, both sides of a real Opus->Sonnet switch.
  assert.deepEqual(parseModelPickerLabel('Model: Opus 5 High', 'Model:'), { body: 'Opus 5', effort: 'High' });
  assert.deepEqual(parseModelPickerLabel('Model: Sonnet 5 Medium', 'Model:'), { body: 'Sonnet 5', effort: 'Medium' });
  assert.deepEqual(parseModelPickerLabel('Model: Haiku 4.5 Low', 'Model:'), { body: 'Haiku 4.5', effort: 'Low' });

  // A CLOSED SET, not "the last word". The remainder after the model name is
  // arbitrary site text, and emitting an arbitrary trailing word would put
  // page-derived content into a governance event.
  assert.deepEqual(parseModelPickerLabel('Model: Opus 5 Turbo', 'Model:'), { body: 'Opus 5 Turbo', effort: '' });
  assert.deepEqual(parseModelPickerLabel('Model: Opus 5', 'Model:'), { body: 'Opus 5', effort: '' });
  // A double space must not produce an empty token.
  assert.deepEqual(parseModelPickerLabel('Model:  Opus 5  High', 'Model:'), { body: 'Opus 5', effort: 'High' });
});

test('AI-216: the tier is blind to effort, so an effort change is never a model change', () => {
  // THIS IS THE INVARIANT behind "from_tier comparisons must be tier-only".
  // Switching model changes effort as a side effect; if the tier detector could
  // see the effort token, an effort-only change would read as a model change and
  // a verified switch could be reported for a switch that never happened.
  const a = detectModelInfoFromConfig('Model: Opus 5 High');
  const b = detectModelInfoFromConfig('Model: Opus 5 Medium');
  assert.deepEqual(a, b, 'effort must not move the detected tier');
  assert.equal(a.tier, 'premium');
  const c = detectModelInfoFromConfig('Model: Sonnet 5 Medium');
  assert.equal(c.tier, 'standard');
  assert.notDeepEqual(a, c, 'a real model change must still register');
});

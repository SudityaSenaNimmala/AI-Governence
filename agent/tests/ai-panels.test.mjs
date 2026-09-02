// IDE-hosted AI panel signatures (Claude Code / GitHub Copilot Chat in VS Code,
// Cursor's own AI composer).
//
// Every assertion here is a pure-function check — no UI, no UIA, no keyboard
// hook. The signatures themselves come from live UIA probing against real
// installations (2026-08); the values below are those observed values verbatim,
// so this file is what pins them against an accidental edit. See
// ai-processes.js's AI_PANELS comment for the provenance of each one.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  AI_PANELS,
  AGENT_SURFACES,
  IDE_PROCESSES,
  AI_PROCESSES,
  matchPanelSignature,
  identifyAiPanel,
  hostForPanel,
  panelForHost,
  buildAiPanelConfig,
  buildIdeProcessConfig,
  synthesizePlatformBlocks,
  processForHost,
  filterBlockedAgents,
  PLATFORM_BLOCK_SENTINEL,
} from '../src/os_monitor/ai-processes.js';

const AGENT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');

// The three signatures exactly as observed live. `vscode_chat`'s is the one
// INFERRED value — see its own test below.
const CLAUDE_CODE = {
  process: 'Code',
  controlType: 'Edit',
  name: 'Message input',
  className: 'messageInput_cKsPxg',
};
const CURSOR_COMPOSER = {
  process: 'Cursor',
  controlType: 'Edit',
  name: '',
  className: 'aislash-editor-input',
};
const COPILOT_CHAT = {
  process: 'Code',
  controlType: 'Edit',
  name: 'Chat Input (Agent), edit files in your workspace. Press Enter to send out the request. Use Alt+F1 for Chat Accessibility Help.',
  className: 'native-edit-context',
};
// Microsoft Teams' message composer, exactly as probed live 2026-08 in a real
// new-Teams (MSIX) window. Note the Name is the literal "Type a message" and is
// IDENTICAL in a DM, a group chat, an agent conversation and the Copilot panel —
// it is deliberately not used as a signal. The ClassName is the real, verbatim
// token list: stable CKEditor semantic classes mixed with Fluent-UI build
// hashes, and only the semantic `ck-editor__editable` token is matched.
const TEAMS_COMPOSER = {
  process: 'ms-teams',
  controlType: 'Edit',
  name: 'Type a message',
  className: 'ck ck-content ck-editor__editable ck-rounded-corners ck-editor__editable_inline ck-blurred ___1czdayc f1poobt0 f1cktdmf f13htf1t f1ubnyt4 f1couhl3 f1ahpp82 f11qra4b f6dzj5z f1p9o1ba fokg9q4',
};
// NOT a composer: Cursor's agent-session history search box. Same ControlType,
// same process, similar shape — filtering past sessions is not sending a prompt.
const CURSOR_AGENT_SEARCH = {
  process: 'Cursor',
  controlType: 'Edit',
  name: 'Search Agents…',
  className: 'agent-sidebar-search-input',
};

// ── The three verified/inferred signatures match ─────────────────────────────

test('the Claude Code composer in VS Code matches', () => {
  const hit = matchPanelSignature(CLAUDE_CODE);
  assert.ok(hit, 'Claude Code composer must match');
  assert.equal(hit.id, 'claude_code');
  assert.equal(hit.enforce, true);
});

test('the Claude Code composer matches inside Cursor too', () => {
  // The extension runs in any VS Code fork; procs carries both.
  assert.equal(matchPanelSignature({ ...CLAUDE_CODE, process: 'Cursor' })?.id, 'claude_code');
});

test('a drifted Claude Code CSS-module hash still matches via the Name', () => {
  // classPrefix is "messageInput_" and the suffix is a per-build hash, so the
  // exact ClassName WILL change. The ARIA-driven Name is the stable signal, and
  // either one alone is sufficient.
  assert.equal(matchPanelSignature({ ...CLAUDE_CODE, className: 'messageInput_zzzzzz' })?.id, 'claude_code');
  assert.equal(matchPanelSignature({ ...CLAUDE_CODE, className: 'totally-renamed' })?.id, 'claude_code');
  // …and the prefix alone works if the Name is what changes.
  assert.equal(matchPanelSignature({ ...CLAUDE_CODE, name: '' })?.id, 'claude_code');
  // The prefix must be a PREFIX, not a substring — a class that merely contains
  // it is not the composer.
  assert.equal(matchPanelSignature({ ...CLAUDE_CODE, name: '', className: 'xx-messageInput_abc' }), null);
});

test("Cursor's own composer matches on its ClassName alone (its Name is empty)", () => {
  const hit = matchPanelSignature(CURSOR_COMPOSER);
  assert.ok(hit, "Cursor's composer must match");
  assert.equal(hit.id, 'cursor_composer');
  assert.equal(hit.enforce, true);
  assert.equal(hit.verified, true, 'Cursor was probed live and ships enforcing');
});

test("a second CSS class on Cursor's composer must not hide it", () => {
  // A web-hosted element's UIA ClassName is the DOM class ATTRIBUTE, not one
  // class: Cursor's own Monaco editor input reports "inputarea
  // monaco-mouse-cursor-text", measured. cursor_composer is the ONE signature
  // with nothing to fall back on — empty Name, no namePrefix, no classPrefix —
  // so a whole-string compare stopped matching a genuinely focused, genuinely
  // stable composer the moment Cursor added a state class to it. In
  // enforcer-win.ps1 that non-match is what tears an IDE-panel platform block
  // down; live, 2 of 3 verified rounds let a blocked Enter through.
  for (const className of [
    'aislash-editor-input aislash-editor-input-has-text',
    'aislash-editor-input focused',
    'monaco-editor aislash-editor-input',
    '  aislash-editor-input\tmonaco-mouse-cursor-text ',
  ]) {
    assert.equal(matchPanelSignature({ ...CURSOR_COMPOSER, className })?.id, 'cursor_composer', className);
  }
  // …and the same for a token-wise classPrefix.
  assert.equal(
    matchPanelSignature({ ...CLAUDE_CODE, name: '', className: 'chat-input messageInput_cKsPxg' })?.id,
    'claude_code',
  );
});

test('token matching is not substring matching — an unrelated class list still never matches', () => {
  // The whole risk of accepting a class LIST is over-matching. A token must be a
  // WHOLE class (or, for classPrefix, start one) — never a fragment of one.
  for (const className of [
    'xx-aislash-editor-input',
    'aislash-editor-input-wrapper',
    'foo xx-aislash-editor-input bar',
    'inputarea monaco-mouse-cursor-text',
  ]) {
    assert.equal(matchPanelSignature({ ...CURSOR_COMPOSER, className }), null, className);
  }
  for (const className of ['xx-messageInput_abc', 'foo xx-messageInput_abc bar']) {
    assert.equal(matchPanelSignature({ ...CLAUDE_CODE, name: '', className }), null, className);
  }
});

test("Cursor's Monaco code-editor input is not a panel", () => {
  // The element that steals the global FocusedElement read in the live Cursor
  // repro. It must keep matching NOTHING — the fix is that a non-match no longer
  // tears an armed platform block down, not that this starts matching.
  assert.equal(matchPanelSignature({
    process: 'Cursor',
    controlType: 'Edit',
    name: 'The editor is not accessible at this time. To enable screen reader optimized mode',
    className: 'inputarea monaco-mouse-cursor-text',
  }), null);
});

test("Cursor's agent-history SEARCH box must NOT match", () => {
  // The regression that matters most in this file: this control is the same
  // ControlType in the same process, and treating it as a composer would swallow
  // Enter while someone searches their own session history.
  assert.equal(matchPanelSignature(CURSOR_AGENT_SEARCH), null);
  // Neither half of it may match on its own either.
  assert.equal(matchPanelSignature({ ...CURSOR_AGENT_SEARCH, name: '' }), null);
  assert.equal(matchPanelSignature({ ...CURSOR_AGENT_SEARCH, className: '' }), null);
});

test('GitHub Copilot Chat matches on the Name prefix only, never on native-edit-context', () => {
  const hit = matchPanelSignature(COPILOT_CHAT);
  assert.ok(hit, 'Copilot Chat must still MATCH — it ships detection-only, not undetected');
  assert.equal(hit.id, 'vscode_chat');
  // The ClassName observed alongside it is a GENERIC VS Code internal class,
  // shared with the Find widget, quick-open, search and rename inputs. Matching
  // it would blanket-block ordinary editor UI.
  assert.equal(matchPanelSignature({ ...COPILOT_CHAT, name: '' }), null);
  for (const panel of AI_PANELS) {
    assert.notEqual(panel.classEquals, 'native-edit-context', `${panel.id} must not match the generic class`);
    assert.notEqual(panel.classPrefix, 'native-edit-context', `${panel.id} must not match the generic class`);
  }
});

// ── Matching and enforcing are separate concerns ─────────────────────────────

test('Copilot Chat ships enforce:false and the matcher does not treat that as "do not match"', () => {
  const entry = AI_PANELS.find((p) => p.id === 'vscode_chat');
  assert.ok(entry);
  assert.equal(entry.enforce, false, 'unverified signature — detection-only until probed live');
  assert.equal(entry.verified, false);
  // Detection must still fire, or the whole point of shipping it detection-first
  // (exercising the plumbing, gathering telemetry) is lost.
  assert.equal(matchPanelSignature(COPILOT_CHAT)?.id, 'vscode_chat');
  // …and vscode_chat is again the ONLY non-enforcing panel: its signature was
  // inferred and has never been probed against a real install, so it stays
  // detection-only until a human runs that live pass. TWO Teams composers have
  // now passed through this list and left it, both for the same reason — not a
  // doubted signature, but an unverified ROUTE:
  //   teams_composer         — the Chat-list route; pass ran 2026-08-30.
  //   teams_copilot_composer — the embedded Copilot tab; its signature was
  //                            measured live in 2026-09, and the route's own
  //                            end-to-end pass ran 2026-09-02, so it enforces
  //                            now and has left this list too.
  assert.deepEqual(AI_PANELS.filter((p) => !p.enforce).map((p) => p.id), ['vscode_chat']);
});

test('teams_copilot_composer is a SECOND, different Teams composer — verified and enforcing', () => {
  // Measured live 2026-09 against the embedded Copilot tab of a real new-Teams
  // install: its ClassName is "fai-EditorInput__input r18fti29 r18aquq2
  // ___10kbave f1pha7fy f1immsc2 f1mk8lai" with NO ck-editor__editable token
  // anywhere in it. The Chat-list route and the Copilot tab genuinely ship two
  // different editors, so one signature cannot cover both.
  const COPILOT_TAB_CLASS = 'fai-EditorInput__input r18fti29 r18aquq2 ___10kbave f1pha7fy f1immsc2 f1mk8lai';
  const entry = AI_PANELS.find((p) => p.id === 'teams_copilot_composer');
  assert.ok(entry, 'the teams_copilot_composer panel is missing');
  assert.equal(entry.enforce, true, 'the Copilot-tab route enforces after its 2026-09-02 live pass');
  assert.equal(entry.verified, true);
  // The SEMANTIC token is what is matched — not the Fluent-UI build hashes
  // beside it — exactly as teams_composer matches ck-editor__editable.
  assert.equal(entry.classEquals, 'fai-EditorInput__input');
  assert.equal(
    matchPanelSignature({ process: 'ms-teams', controlType: 'Edit', name: 'Message Copilot', className: COPILOT_TAB_CLASS })?.id,
    'teams_copilot_composer',
  );
  // The two composers do not match each other's signature, in either direction.
  assert.equal(matchPanelSignature(TEAMS_COMPOSER)?.id, 'teams_composer');
  assert.equal(COPILOT_TAB_CLASS.includes('ck-editor__editable'), false);
  // The composer's Name is generic and deliberately unused: "Message Copilot"
  // with no agent selected, and observed carrying agent-ish text otherwise. The
  // class alone decides, so an empty or misleading Name changes nothing.
  assert.equal(
    matchPanelSignature({ process: 'ms-teams', controlType: 'Edit', name: '', className: COPILOT_TAB_CLASS })?.id,
    'teams_copilot_composer',
  );
  // host:null, for the IDENTICAL load-bearing reason teams_composer carries it —
  // an Inventory toggle on teams.microsoft.com must not be able to synthesize a
  // panel row against this entry either.
  assert.equal(entry.host, null);
  assert.equal(hostForPanel('teams_copilot_composer'), null);
  assert.deepEqual(
    synthesizePlatformBlocks([{ host: 'teams.microsoft.com', product: 'Microsoft Teams', vendor: 'Microsoft', blocked: true }]),
    [],
  );
});

// ── Negative cases ───────────────────────────────────────────────────────────

test('the wrong ControlType never matches', () => {
  for (const controlType of ['Document', 'Text', 'Button', 'Custom', 'Pane', 'edit ', '']) {
    assert.equal(
      matchPanelSignature({ ...CLAUDE_CODE, controlType }),
      controlType.trim().toLowerCase() === 'edit' ? matchPanelSignature(CLAUDE_CODE) : null,
      `controlType=${JSON.stringify(controlType)}`,
    );
  }
  // A code editor surface in VS Code is a Document, and it must never match.
  assert.equal(matchPanelSignature({ process: 'Code', controlType: 'Document', name: 'index.js', className: 'monaco-editor' }), null);
});

test('the wrong process never matches', () => {
  // Right element shape, wrong host process — a signature is only valid in the
  // IDE it was probed in.
  assert.equal(matchPanelSignature({ ...CLAUDE_CODE, process: 'notepad' }), null);
  assert.equal(matchPanelSignature({ ...CLAUDE_CODE, process: 'Claude' }), null);
  // cursor_composer is Cursor-only: the same class in VS Code is not it.
  assert.equal(matchPanelSignature({ ...CURSOR_COMPOSER, process: 'Code' }), null);
});

test('null / empty / whitespace input never throws and never matches', () => {
  for (const bad of [undefined, null, {}, { process: null }, { process: '' }, { process: '   ' }]) {
    assert.equal(matchPanelSignature(bad), null, JSON.stringify(bad));
  }
  assert.equal(matchPanelSignature({ process: 'Code', controlType: null, name: null, className: null }), null);
  assert.equal(matchPanelSignature({ process: 'Code', controlType: 'Edit', name: '', className: '' }), null);
  assert.equal(matchPanelSignature({ process: 'Code', controlType: 'Edit', name: '   ', className: '   ' }), null);
});

test('matching is case- and .exe-insensitive, like every other name compare here', () => {
  assert.equal(matchPanelSignature({ ...CLAUDE_CODE, process: 'code.exe' })?.id, 'claude_code');
  assert.equal(matchPanelSignature({ ...CLAUDE_CODE, process: 'CODE' })?.id, 'claude_code');
  assert.equal(matchPanelSignature({ ...CLAUDE_CODE, name: 'MESSAGE INPUT' })?.id, 'claude_code');
  assert.equal(matchPanelSignature({ ...CURSOR_COMPOSER, className: 'AISlash-Editor-Input' })?.id, 'cursor_composer');
  // Surrounding whitespace from a UIA read is trimmed, not treated as a
  // mismatch.
  assert.equal(matchPanelSignature({ ...CLAUDE_CODE, name: '  Message input  ' })?.id, 'claude_code');
});

// ── Identity lookups round-trip ──────────────────────────────────────────────

test('identifyAiPanel / hostForPanel / panelForHost round-trip for all three panels', () => {
  assert.deepEqual(identifyAiPanel('claude_code'), { product: 'Claude Code', vendor: 'Anthropic' });
  assert.deepEqual(identifyAiPanel('vscode_chat'), { product: 'GitHub Copilot Chat', vendor: 'GitHub' });
  assert.deepEqual(identifyAiPanel('cursor_composer'), { product: 'Cursor', vendor: 'Anysphere' });

  assert.equal(hostForPanel('claude_code'), 'claude.ai');
  assert.equal(hostForPanel('vscode_chat'), 'github.com');
  assert.equal(hostForPanel('cursor_composer'), 'cursor.com');

  for (const panel of AI_PANELS) {
    // A host-less panel is deliberately unreachable from a host — see below.
    if (!panel.host) continue;
    assert.equal(panelForHost(panel.host), panel.id, `${panel.host} → ${panel.id}`);
    assert.equal(hostForPanel(panelForHost(panel.host)), panel.host);
  }
});

test('teams_composer carries NO host, so an Inventory toggle can never block all of Teams', () => {
  // THE load-bearing property of this entry. If teams_composer had
  // host:'teams.microsoft.com', an admin toggling that host in Inventory would
  // make synthesizePlatformBlocks emit a panel-keyed row against it — and that
  // row would disable the composer in EVERY Teams conversation: DMs, channels,
  // meeting chat, everyone. That is "disable all of Teams", which is exactly
  // what the whole agent-scoped Teams feature exists to avoid.
  const teams = AI_PANELS.find((p) => p.id === 'teams_composer');
  assert.ok(teams, 'the teams_composer panel is missing');
  assert.equal(teams.host, null, 'teams_composer must carry no host');
  assert.equal(hostForPanel('teams_composer'), null);
  // The reverse lookup must not resolve the Teams host to this panel — not by
  // the entry's own (absent) host, and not by the AI_PROCESSES host either.
  assert.equal(panelForHost('teams.microsoft.com'), null);
  assert.equal(panelForHost('TEAMS.MICROSOFT.COM'), null);
  // …and no synthesised row is produced for it at all: not a panel row (no
  // host), and not a process row (processesForHost excludes a host app).
  assert.deepEqual(
    synthesizePlatformBlocks([{ host: 'teams.microsoft.com', product: 'Microsoft Teams', vendor: 'Microsoft', blocked: true }]),
    [],
    'an Inventory block on teams.microsoft.com must synthesize NOTHING for the desktop',
  );
  // It is still MATCHED, though — detection and enforcement stay separate, so
  // the agent-scoped path in enforcer-win.ps1 can use it.
  assert.equal(matchPanelSignature(TEAMS_COMPOSER)?.id, 'teams_composer');
});

test('the identity lookups reject junk instead of guessing', () => {
  for (const bad of ['', null, undefined, 'nope', 'CLAUDE_CODE']) {
    assert.equal(identifyAiPanel(bad), null, `identifyAiPanel(${bad})`);
    assert.equal(hostForPanel(bad), null, `hostForPanel(${bad})`);
  }
  assert.equal(panelForHost(''), null);
  assert.equal(panelForHost(null), null);
  assert.equal(panelForHost('example.com'), null);
  // Same no-subdomain-guessing rule processForHost follows: ai_platforms.host is
  // already normalized server-side.
  assert.equal(panelForHost('app.claude.ai'), null);
  assert.equal(panelForHost('https://claude.ai'), null);
  // …but case and padding are tolerated, since those are cosmetic.
  assert.equal(panelForHost('  CURSOR.COM '), 'cursor_composer');
});

test('every panel carries a bare canonical host and a distinct id', () => {
  const ids = new Set();
  for (const panel of AI_PANELS) {
    // `host: null` is a deliberate, documented choice for a HOST-APP panel
    // (teams_composer) — it is what makes the panel unreachable from an
    // Inventory host toggle. Anything else must still be a bare hostname.
    if (panel.host !== null) {
      assert.match(panel.host, /^[a-z0-9.-]+\.[a-z]{2,}$/, `${panel.id}: '${panel.host}' is not a bare hostname`);
    }
    assert.match(panel.id, /^[a-z0-9_]+$/, `${panel.id} must be a plain id (it is used as a JSON key and a C# literal)`);
    assert.equal(ids.has(panel.id), false, `duplicate panel id ${panel.id}`);
    ids.add(panel.id);
    assert.ok(panel.product && panel.vendor, `${panel.id} is missing product/vendor`);
    assert.ok(Array.isArray(panel.procs) && panel.procs.length > 0, `${panel.id} has no host process`);
    assert.equal(typeof panel.enforce, 'boolean', `${panel.id} must state enforce explicitly`);
  }
});

test('every panel names only processes the IDE catalog — or a declared HOST APP — carries', () => {
  // A panel used to be an IDE-only concept. It is now also how a HOST APP's one
  // governed composer is identified, so the rule is "an IDE process or a process
  // an AGENT_SURFACES entry declares hostApp:true" — never an arbitrary process.
  // Both sides stay closed: a panel naming a process in neither catalog would be
  // element scoping over an app nothing else in the system knows about.
  const ideNames = new Set(buildIdeProcessConfig().map((e) => e.name.toLowerCase()));
  const hostAppNames = new Set(
    AGENT_SURFACES.filter((s) => s.hostApp === true).flatMap((s) => s.procs.map((p) => p.toLowerCase())),
  );
  assert.ok(hostAppNames.has('ms-teams'), 'expected ms-teams to be a declared host app');
  for (const panel of AI_PANELS) {
    for (const proc of panel.procs) {
      const name = proc.toLowerCase();
      assert.ok(ideNames.has(name) || hostAppNames.has(name),
        `${panel.id} names ${proc}, which is neither an IDE process nor a declared host app`);
    }
  }
});

// ── IDE catalog scoping ──────────────────────────────────────────────────────

test('a panelFallback IDE must also be in AI_PROCESSES, or it silently means no coverage', () => {
  const aiNames = new Set(
    AI_PROCESSES.map((e) => e.match.source.replace(/^\^/, '').replace(/\$$/, '').replace(/[\\/]i?$/, '').toLowerCase()),
  );
  for (const entry of buildIdeProcessConfig()) {
    if (!entry.panelFallback) continue;
    assert.ok(
      aiNames.has(entry.name.toLowerCase()),
      `${entry.name} claims panelFallback but has no AI_PROCESSES entry to fall back TO — ` +
      'enforcer-win.ps1 requires both, so this would silently mean no coverage at all',
    );
  }
  // Today NEITHER IDE has a whole-app fallback: VS Code never had one (it was
  // absent from every catalog, so there was no coverage to preserve), and Cursor
  // gave its up by the 2026-08-25 decision to scope it to its AI composer only,
  // matching Claude Code's precision. So the loop above currently has no entries
  // to check — that is intentional, not dead weight: the invariant is what makes
  // re-enabling a fallback for ANY IDE safe, since the moment someone sets
  // panelFallback:true on an entry with no AI_PROCESSES name to fall back to,
  // this fails instead of silently shipping zero coverage.
  assert.deepEqual(buildIdeProcessConfig(), [
    { name: 'code', panelFallback: false },
    { name: 'cursor', panelFallback: false },
  ]);
});

test('the enforcer env payload is built from the catalog, not restated', () => {
  const config = buildAiPanelConfig();
  assert.equal(config.length, AI_PANELS.length);
  for (const entry of config) {
    const source = AI_PANELS.find((p) => p.id === entry.id);
    assert.ok(source, `${entry.id} is not in AI_PANELS`);
    assert.equal(entry.enforce, source.enforce, 'the C# side needs the real enforce flag');
    assert.deepEqual(entry.procs, source.procs);
    // Absent match fields travel as '' rather than undefined, so the C# side
    // never has to distinguish missing from empty.
    for (const key of ['nameEquals', 'namePrefix', 'classEquals', 'classPrefix']) {
      assert.equal(typeof entry[key], 'string', `${entry.id}.${key} must be a string`);
    }
  }
  // Survives JSON round-tripping, which is how it actually reaches the helper.
  assert.deepEqual(JSON.parse(JSON.stringify(config)), config);
  // No product/vendor/host on this channel: nothing on the C# side displays
  // them, and index.js resolves them from the id.
  for (const entry of config) {
    assert.equal('product' in entry, false);
    assert.equal('host' in entry, false);
  }
});

test('enforcer-win.ps1 consumes both payloads and holds the comparison code, not the data', async () => {
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'enforcer-win.ps1'), 'utf8');
  assert.match(src, /CFAI_IDE_PROCESSES/);
  assert.match(src, /CFAI_AI_PANELS/);
  assert.match(src, /static void LoadAiPanels\(string json\)/);
  assert.match(src, /static PanelSig MatchPanelSignature\(string proc, string controlType, string name, string className\)/);
  // The data must NOT be duplicated as C# literals — that is the drift this
  // JSON-over-env-var mechanism exists to prevent.
  for (const literal of ['Message input', 'aislash-editor-input', 'messageInput_', 'Chat Input']) {
    assert.equal(src.includes('"' + literal + '"'), false, `${literal} is hardcoded in the .ps1 — it must arrive as data`);
  }
});

// ── Platform-block bridge: a host maps to a panel, a process, or both ────────

test('synthesizePlatformBlocks emits a panel row keyed on `panel`, never process_name', () => {
  const rows = synthesizePlatformBlocks([
    { host: 'cursor.com', product: 'Cursor', vendor: 'Anysphere', blocked: true },
  ]);
  assert.deepEqual(rows, [{
    platform: PLATFORM_BLOCK_SENTINEL,
    panel: 'cursor_composer',
    agent_name: 'Cursor',
    agent_id: '',
    host: 'cursor.com',
    reason: 'Blocked by organization policy',
  }]);
  // The whole point: no process_name, because process_name matching in the .ps1
  // is process-WIDE and would block plain code editing in Cursor.
  assert.equal('process_name' in rows[0], false);
  assert.equal(processForHost('cursor.com'), null, 'the Cursor PROCESS stays excluded');
});

test('claude.ai blocks the desktop app AND the Claude Code panel', () => {
  const rows = synthesizePlatformBlocks([
    { host: 'claude.ai', product: 'Claude', blocked: true },
  ]);
  assert.deepEqual(rows.map((r) => r.process_name || r.panel), ['claude', 'claude_code']);
  for (const row of rows) assert.equal(row.host, 'claude.ai');
});

test('github.com covers the Copilot Chat panel even though it has no standalone process', () => {
  // The approved linkage: one Inventory toggle covers the website and the
  // in-IDE panel. The standalone "GitHub Copilot" process stays excluded by
  // processForHost (it is a plugin with no window this catalog can key on).
  const rows = synthesizePlatformBlocks([
    { host: 'github.com', product: 'GitHub Copilot', blocked: true },
  ]);
  assert.deepEqual(rows.map((r) => r.panel), ['vscode_chat']);
  assert.equal(processForHost('github.com'), null);
  // The row exists even though vscode_chat ships enforce:false — the enforce
  // gate lives in enforcer-win.ps1's panel branch, so this is real wiring and
  // flipping the flag is the only thing later needed. Not a no-op stub.
  assert.equal(AI_PANELS.find((p) => p.id === 'vscode_chat').enforce, false);
});

test('a panel block is lifted by an access exception for its host', () => {
  const list = synthesizePlatformBlocks([
    { host: 'cursor.com', product: 'Cursor', blocked: true },
    { host: 'claude.ai', product: 'Claude', blocked: true },
  ]);
  assert.equal(list.length, 3);   // cursor panel + claude process + claude panel
  const kept = filterBlockedAgents(list, [{ tool_host: 'CURSOR.COM' }]);
  assert.deepEqual(kept.map((r) => r.process_name || r.panel), ['claude', 'claude_code']);
  // One approval for claude.ai lifts BOTH claude.ai rows — the desktop app and
  // the panel — which is the point of keying exceptions on the host.
  assert.deepEqual(
    filterBlockedAgents(list, [{ tool_host: 'claude.ai' }]).map((r) => r.panel),
    ['cursor_composer'],
  );
});

test('panel rows are deduped separately from process rows', () => {
  // Two hosts, same panel, must collapse; a process key and a panel key must
  // never collide with each other.
  const rows = synthesizePlatformBlocks([
    { host: 'claude.ai', product: 'Claude', blocked: true },
    { host: 'CLAUDE.AI', product: 'Claude again', blocked: true },
  ]);
  assert.deepEqual(rows.map((r) => r.process_name || r.panel), ['claude', 'claude_code']);
  assert.equal(rows[0].agent_name, 'Claude', 'the FIRST row wins a dedup');
});

test('panel rows go through the same .ps1-unsafe-character scrubbing', () => {
  const [row] = synthesizePlatformBlocks([
    { host: 'cursor.com', product: 'Ev"il\\ {name}', blocked: true },
  ]);
  assert.equal(row.panel, 'cursor_composer');
  for (const value of Object.values(row)) {
    assert.equal(/["\\{}\u0000-\u001f\u007f]/.test(value), false, `unsafe char survived in ${value}`);
  }
  assert.equal(JSON.stringify(row).includes('\\'), false);
});

// IDE-hosted AI panel signatures (Claude Code / GitHub Copilot Chat in VS Code,
// Cursor's own AI composer).
//
// Every assertion here is a pure-function check — no UI, no UIA, no keyboard
// hook. The signatures themselves come from live UIA probing against real
// installations (2026-08); the values below are those observed values verbatim,
// so this file is what pins them against an accidental edit. See
// ai-processes.js's AI_PANELS comment for the provenance of each one.
//
// ONE entry is an exception to "observed verbatim": vscode_chat's signature
// was INFERRED, not measured, and is flagged where it is tested. It ships
// enforce:false. office_copilot_pane (the Microsoft 365 Copilot side pane in
// Word/Excel/PowerPoint/OneNote) WAS a second exception — an outright
// placeholder — until the 2026-09-18 live probe against Word measured its
// signature, and a second pass on 2026-09-21 (a real server-side block
// through a real packaged build) cleared it to enforce; see its own section
// below for both.

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
  panelsForHost,
  buildAiPanelConfig,
  buildIdeProcessConfig,
  synthesizePlatformBlocks,
  processForHost,
  processesForHost,
  filterBlockedAgents,
  watcherProcessNames,
  PLATFORM_PROCS,
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
  // office_copilot_pane passed through this list on the same terms as both
  // Teams composers and has now left it too: its signature moved from an
  // outright placeholder to a measured, collision-checked one (2026-09-18),
  // and its own end-to-end pass (a real server-side block, through a real
  // packaged build) ran 2026-09-21 — so vscode_chat is once again the ONLY
  // entry here, and for the original reason: its signature was never even
  // measured, only inferred.
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

// ── The Microsoft 365 Copilot pane inside Word/Excel/PowerPoint/OneNote ──────
//
// LIVE-PROBED 2026-09-18 against a real licensed Word desktop install, via
// read-only UIA (no synthesized input). Only WINWORD was reached by the probe;
// Excel/PowerPoint/OneNote are covered by `procs` on the strength of this being
// the SAME Fluent chat editor teams_copilot_composer already measured, not by a
// separate measurement in each app. The observed ClassName is the identical
// string teams_copilot_composer pins ("fai-EditorInput__input r18fti29
// r18aquq2 ___10kbave f1pha7fy f1immsc2 f1mk8lai") — same component, different
// host app — and the AutomationId ("m365-chat-editor-target-element") is also
// identical, though nothing here reads it (no AutomationId rule exists in this
// schema; see that entry's own note).
//
// The COLLISION CHECK this section exists to prove: run against the same Word
// window in the same probing session —
//   * the document body:   ControlType.Document, ClassName '_WwG';
//   * Find / "Tell me" (Word unifies both into one "Search document" box):
//                           ControlType.Edit, Name 'Search document',
//                           ClassName 'NetUITextbox' — a native Win32 control;
//   * the New Comment box: ControlType.Edit, Name '@mention or comment',
//                           ClassName '' (native), AutomationId
//                           'cardEditor_1_<guid>'.
// None carries the "fai-EditorInput__input" token, so `classEquals` cannot
// match any of them. Excel's formula bar / in-cell editor, PowerPoint's
// slide-notes field and OneNote's page canvas were NOT probed directly — they
// are native/Win32 surfaces in those hosts, not instances of this Fluent
// WebView2 component, on the same cross-app-reuse argument as the composer
// signature itself — and their fixtures below stay plausible stand-ins.
const OFFICE_PANE_CLASS = 'fai-EditorInput__input r18fti29 r18aquq2 ___10kbave f1pha7fy f1immsc2 f1mk8lai';
const OFFICE_PANE_PROCS = ['WINWORD', 'EXCEL', 'POWERPNT', 'ONENOTE', 'ONENOTEIM'];

test('the Office Copilot pane matches in every one of its five host processes', () => {
  const entry = AI_PANELS.find((p) => p.id === 'office_copilot_pane');
  assert.ok(entry, 'the office_copilot_pane panel is missing');
  // ONE entry, not four: the pane is one implementation hosted by several
  // processes, exactly like claude_code across Code/Cursor.
  assert.deepEqual(entry.procs, OFFICE_PANE_PROCS);
  assert.equal(entry.classEquals, 'fai-EditorInput__input');
  for (const process of OFFICE_PANE_PROCS) {
    const focused = {
      process,
      controlType: 'Edit',
      name: "Describe what you'd like to edit",
      className: OFFICE_PANE_CLASS,
    };
    assert.equal(matchPanelSignature(focused)?.id, 'office_copilot_pane', process);
    // …and the same tolerance every other entry gets: case and .exe on the
    // process name, padding on the Name.
    assert.equal(matchPanelSignature({ ...focused, process: `${process.toLowerCase()}.exe` })?.id, 'office_copilot_pane');
    assert.equal(matchPanelSignature({ ...focused, name: `  ${focused.name}  ` })?.id, 'office_copilot_pane');
    // The Name is not consulted at all — the class alone decides, exactly as
    // teams_copilot_composer's generic "Message Copilot" Name is unused.
    assert.equal(matchPanelSignature({ ...focused, name: '' })?.id, 'office_copilot_pane');
  }
  // The signature is Office-only: the same element shape in an unrelated process
  // is not it, and no OTHER panel's signature reaches into these processes.
  assert.equal(matchPanelSignature({ process: 'notepad', controlType: 'Edit', name: '', className: OFFICE_PANE_CLASS }), null);
  assert.equal(matchPanelSignature({ ...CLAUDE_CODE, process: 'WINWORD' }), null);
  assert.equal(matchPanelSignature({ ...CURSOR_COMPOSER, process: 'EXCEL' }), null);
  assert.equal(matchPanelSignature({ ...TEAMS_COMPOSER, process: 'ONENOTE' }), null);
  // …and the reverse: this signature's class does not leak into ms-teams, where
  // teams_copilot_composer alone must win.
  assert.equal(matchPanelSignature({ process: 'ms-teams', controlType: 'Edit', name: '', className: OFFICE_PANE_CLASS })?.id, 'teams_copilot_composer');
});

test('the Office Copilot pane is LIVE-VERIFIED and ENFORCING after its 2026-09-21 end-to-end pass', () => {
  const entry = AI_PANELS.find((p) => p.id === 'office_copilot_pane');
  // The signature was measured and collision-checked on 2026-09-18; the
  // end-to-end pass every OTHER enforce:true entry in this catalog required —
  // a real send in this pane, through a real server-side block and a real
  // packaged build — ran 2026-09-21 and cleared both flags.
  assert.equal(entry.enforce, true, 'the 2026-09-21 end-to-end pass cleared this to enforce');
  assert.equal(entry.verified, true);
  // The placeholder is gone; only the ClassName rule is declared (no Name rule
  // — the composer's Name was observed but is not a reliable signal on its own,
  // same reasoning as teams_copilot_composer).
  assert.equal(entry.nameEquals, undefined);
  assert.equal(entry.namePrefix, undefined);
  assert.equal(entry.classEquals, 'fai-EditorInput__input');
  assert.equal(entry.classPrefix, undefined);
  assert.equal(matchPanelSignature({
    process: 'WINWORD', controlType: 'Edit', name: '', className: OFFICE_PANE_CLASS,
  })?.id, 'office_copilot_pane');
  // `dlpMatch: 'panel'` — a question about the composer's NATURE (does a match
  // on this element alone prove the user is talking to an AI?), settled by the
  // 2026-09-18 signature measurement and its collision check independently of
  // `enforce` (does this surface get to swallow a keystroke?, settled by the
  // 2026-09-21 pass). teams_copilot_composer flipped both in one pass; that
  // was its history, not a coupling between the fields.
  assert.equal(entry.dlpMatch, 'panel');
  assert.equal(buildAiPanelConfig().find((e) => e.id === 'office_copilot_pane').dlpMatch, 'panel');
  assert.equal(buildAiPanelConfig().find((e) => e.id === 'office_copilot_pane').enforce, true);
});

test('the document/spreadsheet/slide/notebook surface itself never matches the Copilot pane', () => {
  // THE false positive that matters: matching any of these would swallow Enter
  // in ordinary editing — a new paragraph in Word, committing a cell in Excel,
  // a new bullet on a slide, a new line on a OneNote page.
  //
  // The three WINWORD fixtures are the MEASURED collision-check values (see the
  // section note above); Excel/PowerPoint/OneNote stay plausible stand-ins.
  const NOT_THE_PANE = [
    // Word: the document body — measured.
    { process: 'WINWORD',  controlType: 'Document', name: 'Q3 Board Memo.docx', className: '_WwG' },
    // Word: Find / "Tell me", unified into the "Search document" box — measured.
    { process: 'WINWORD',  controlType: 'Edit',     name: 'Search document', className: 'NetUITextbox' },
    // Word: the New Comment box — measured.
    { process: 'WINWORD',  controlType: 'Edit',     name: '@mention or comment', className: '' },
    // Excel: the formula bar and the in-cell editor.
    { process: 'EXCEL',    controlType: 'Edit',     name: 'Formula Bar', className: 'EXCEL7' },
    { process: 'EXCEL',    controlType: 'Edit',     name: 'B7', className: 'EXCEL6' },
    { process: 'EXCEL',    controlType: 'Custom',   name: 'Payroll 2026.xlsx', className: 'EXCEL7' },
    // PowerPoint: the slide canvas and the speaker-notes field.
    { process: 'POWERPNT', controlType: 'Custom',   name: 'Slide 4', className: 'mdiClass' },
    { process: 'POWERPNT', controlType: 'Edit',     name: 'Click to add notes', className: '' },
    // OneNote, both variants: the page canvas and the page title.
    { process: 'ONENOTE',  controlType: 'Document', name: 'Meeting notes', className: 'OneNote::Canvas' },
    { process: 'ONENOTE',  controlType: 'Edit',     name: 'Page title', className: '' },
    { process: 'ONENOTEIM', controlType: 'Document', name: 'Untitled page', className: '' },
    // An empty / whitespace ClassName can never satisfy the token rule.
    { process: 'WINWORD',  controlType: 'Edit',     name: '', className: '' },
    { process: 'EXCEL',    controlType: 'Edit',     name: '', className: '   ' },
  ];
  for (const focused of NOT_THE_PANE) {
    assert.equal(matchPanelSignature(focused), null,
      `${focused.process}/${focused.controlType}/"${focused.name}" must not match any panel`);
  }
  // Token matching, not substring: a class that merely contains the token as
  // part of a longer, unrelated word is not the composer.
  assert.equal(matchPanelSignature({
    process: 'WINWORD', controlType: 'Edit', name: '', className: 'xx-fai-EditorInput__input-wrapper',
  }), null);
});

test('office_copilot_pane carries m365.cloud.microsoft — blocking that host reaches the pane too', () => {
  // A DELIBERATE INVERSION of what this test used to pin (host:null, and
  // "blocking m365.cloud.microsoft cannot disable Copilot in Word"). The old
  // argument was that the toggle would be blocking "a completely different app",
  // the standalone Microsoft 365 Copilot desktop client.
  //
  // It is not a different app relative to this pane. m365.cloud.microsoft is
  // THIS PANE'S OWN PRODUCT'S host — the pane IS Microsoft 365 Copilot, rendered
  // inside an Office host app — so cascading the block is the intent, not a side
  // effect. Under the old null an admin who blocked the host got a half-enforced
  // answer: the standalone client blocked, the identical assistant still one
  // Ribbon button away inside Word.
  const entry = AI_PANELS.find((p) => p.id === 'office_copilot_pane');
  assert.equal(entry.host, 'm365.cloud.microsoft');
  assert.equal(hostForPanel('office_copilot_pane'), 'm365.cloud.microsoft');
  assert.equal(panelForHost('m365.cloud.microsoft'), 'office_copilot_pane');
  // Case and padding are cosmetic here, as everywhere else in this lookup.
  assert.equal(panelForHost('M365.CLOUD.MICROSOFT'), 'office_copilot_pane');
  assert.equal(panelForHost('  m365.cloud.microsoft '), 'office_copilot_pane');
  // No OTHER host reaches the pane — the cascade is from its own product's host
  // only, not from Microsoft hosts at large. teams.microsoft.com in particular
  // must not: that is the comms client's host, and Teams' own two composers keep
  // host:null for that separate, still-valid reason.
  for (const host of ['copilot.microsoft.com', 'teams.microsoft.com', 'office.com', 'microsoft365.com']) {
    assert.notEqual(panelForHost(host), 'office_copilot_pane', host);
  }
  // Identity resolution still works, which is what an event from the pane needs.
  assert.deepEqual(identifyAiPanel('office_copilot_pane'), { product: 'Microsoft 365 Copilot', vendor: 'Microsoft' });
});

test('blocking m365.cloud.microsoft emits a PANEL row for the Office pane — and no Office process row', () => {
  // THE safety property of the host reversal above, and the reason it is not
  // "disable all of Word": the synthesised row is PANEL-keyed, scoped to the one
  // composer element, never process_name-keyed. process_name matching in
  // enforcer-win.ps1 is process-WIDE — a WINWORD row would swallow Enter in
  // every paragraph of every document.
  const rows = synthesizePlatformBlocks([
    { host: 'm365.cloud.microsoft', product: 'Microsoft Copilot', vendor: 'Microsoft', blocked: true },
  ]);
  // The standalone app's process row (unchanged) PLUS one panel row per pane of
  // this product — the Office pane and (since 2026-09-24) the Outlook pane.
  assert.deepEqual(rows.map((r) => r.process_name || `panel:${r.panel}`),
    ['m365copilot', 'panel:office_copilot_pane', 'panel:outlook_copilot_pane']);
  const panelRow = rows.find((r) => r.panel === 'office_copilot_pane');
  assert.deepEqual(panelRow, {
    platform: PLATFORM_BLOCK_SENTINEL,
    panel: 'office_copilot_pane',
    agent_name: 'Microsoft Copilot',
    agent_id: '',
    host: 'm365.cloud.microsoft',
    reason: 'Blocked by organization policy',
  });
  assert.equal('process_name' in panelRow, false, 'a panel row must never carry process_name');
  // …and NO row names an Office process, in any shape.
  const OFFICE = ['winword', 'excel', 'powerpnt', 'onenote', 'onenoteim', 'outlook', 'olk'];
  for (const row of rows) {
    const proc = String(row.process_name || '').toLowerCase();
    assert.equal(OFFICE.includes(proc), false, `a process row for ${proc} would disable the whole Office app`);
  }
});

test('processesForHost(m365.cloud.microsoft) stays exactly [m365copilot] — no Office process ever', () => {
  // The single assertion that keeps the host reversal from becoming a whole-app
  // Word/Excel/PowerPoint/OneNote block. It holds structurally, not by a special
  // case: no Office process name is in AI_PROCESSES at all (they live only in
  // IDE_PROCESSES, deliberately — see that catalog's note), and processesForHost
  // reads AI_PROCESSES alone.
  assert.deepEqual(processesForHost('m365.cloud.microsoft'), ['m365copilot']);
  assert.deepEqual(processesForHost('M365.CLOUD.MICROSOFT'), ['m365copilot']);
  for (const name of ['WINWORD', 'EXCEL', 'POWERPNT', 'ONENOTE', 'ONENOTEIM']) {
    assert.equal(processesForHost('m365.cloud.microsoft').some((p) => p.toLowerCase() === name.toLowerCase()),
      false, `${name} must never be a blockable process for this host`);
  }
  // Stated at the single-value helper too, which other call sites use.
  assert.equal(processForHost('m365.cloud.microsoft'), 'm365copilot');
});

test('an approved exception for m365.cloud.microsoft lifts the Office pane block as well', () => {
  // One approval, every surface of the same product — the point of keying access
  // exceptions on the host. Without this the admin could approve the request and
  // the pane would stay dead inside Word with nothing left to approve.
  const list = synthesizePlatformBlocks([
    { host: 'm365.cloud.microsoft', product: 'Microsoft Copilot', blocked: true },
    { host: 'claude.ai', product: 'Claude', blocked: true },
  ]);
  assert.equal(list.length, 5);  // m365 process + Office & Outlook panels + claude process + claude panel
  const kept = filterBlockedAgents(list, [{ tool_host: 'M365.CLOUD.MICROSOFT' }]);
  assert.deepEqual(kept.map((r) => r.process_name || `panel:${r.panel}`), ['claude', 'panel:claude_code']);
  // …and the reverse: an approval for an unrelated host leaves both m365 rows.
  assert.deepEqual(
    filterBlockedAgents(list, [{ tool_host: 'claude.ai' }]).map((r) => r.process_name || `panel:${r.panel}`),
    ['m365copilot', 'panel:office_copilot_pane', 'panel:outlook_copilot_pane'],
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
    // One host can have SEVERAL panels (m365.cloud.microsoft → the Office and
    // the Outlook panes): every panel is reachable through panelsForHost, and
    // panelForHost stays the first of them for its existing callers.
    assert.ok(panelsForHost(panel.host).includes(panel.id), `${panel.host} → ${panel.id}`);
    assert.equal(panelForHost(panel.host), panelsForHost(panel.host)[0]);
    assert.equal(hostForPanel(panel.id), panel.host);
  }
  assert.deepEqual(panelsForHost('m365.cloud.microsoft'), ['office_copilot_pane', 'outlook_copilot_pane']);
  assert.deepEqual(panelsForHost('teams.microsoft.com'), []);
  assert.deepEqual(panelsForHost(''), []);
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
  //
  // The five Office entries make that invariant load-bearing rather than
  // theoretical: none of them is in AI_PROCESSES (by design — see the IDE_PROCESSES
  // comment), so setting panelFallback:true on one would mean "scan the typed
  // buffer process-wide in Word", i.e. every keystroke of ordinary document
  // editing. The loop above now fails on that instead of shipping it.
  assert.deepEqual(buildIdeProcessConfig(), [
    { name: 'code', panelFallback: false, panelChildProcess: false },
    { name: 'cursor', panelFallback: false, panelChildProcess: false },
    { name: 'winword', panelFallback: false, panelChildProcess: true },
    { name: 'excel', panelFallback: false, panelChildProcess: true },
    { name: 'powerpnt', panelFallback: false, panelChildProcess: true },
    { name: 'onenote', panelFallback: false, panelChildProcess: true },
    { name: 'onenoteim', panelFallback: false, panelChildProcess: true },
    // Outlook, for its Copilot pane only (2026-09-24). A mail client: the same
    // two flags, and no AI_PROCESSES / watcher membership anywhere.
    { name: 'outlook', panelFallback: false, panelChildProcess: true },
    { name: 'olk', panelFallback: false, panelChildProcess: true },
  ]);
  // …and stated per-entry as well, so a future addition to this catalog cannot
  // pass by being absent from the list above.
  for (const entry of buildIdeProcessConfig()) {
    assert.equal(entry.panelFallback, false, `${entry.name} must not carry a whole-app fallback`);
  }
  // The Office hosts specifically: an Enter swallowed in a spreadsheet cell or a
  // Word document is the worst false positive this feature could produce, and
  // panelFallback:false is the single flag standing between the catalog and it.
  for (const name of ['winword', 'excel', 'powerpnt', 'onenote', 'onenoteim', 'outlook', 'olk']) {
    const entry = buildIdeProcessConfig().find((e) => e.name === name);
    assert.ok(entry, `${name} is missing from the IDE catalog`);
    assert.equal(entry.panelFallback, false, `${name} MUST be panel-scoped only`);
  }
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
    // never has to distinguish missing from empty. `soleAgent` follows the same
    // convention — see its own test below.
    for (const key of ['nameEquals', 'namePrefix', 'classEquals', 'classPrefix', 'soleAgent']) {
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

// ── `soleAgent`: the one AI product a composer can ever be talking to ────────

test('soleAgent may only be declared alongside dlpMatch:"panel"', () => {
  // THE INVARIANT. Both fields make the same underlying claim from two
  // directions — "this composer has no non-AI use" — so one without the other is
  // a half-made claim. A soleAgent on a strict-'agent' entry would name the only
  // possible agent while the catalog simultaneously insisted a named
  // governed-/blocked-agents row is needed to know which agent is open; a
  // dlpMatch:'panel' entry with no soleAgent is the lesser (and allowed) case,
  // since not every no-non-AI-use composer has a single product behind it.
  for (const panel of AI_PANELS) {
    if (panel.soleAgent === undefined) continue;
    assert.equal(typeof panel.soleAgent, 'string', `${panel.id}.soleAgent must be a string`);
    assert.ok(panel.soleAgent.trim().length > 0, `${panel.id}.soleAgent must not be blank`);
    assert.equal(panel.dlpMatch, 'panel',
      `${panel.id} declares soleAgent without dlpMatch:'panel' — that is a half-made claim`);
  }
  // Today: the two Microsoft 365 Copilot composers, and only those. Both are the
  // same product surfaced inside a different host app (Teams' embedded Copilot
  // tab; the Office side pane).
  assert.deepEqual(
    AI_PANELS.filter((p) => p.soleAgent).map((p) => [p.id, p.soleAgent]),
    [
      ['teams_copilot_composer', 'Microsoft 365 Copilot'],
      ['office_copilot_pane', 'Microsoft 365 Copilot'],
      ['outlook_copilot_pane', 'Microsoft 365 Copilot'],
    ],
  );
});

// ── `fallbackRead`: the Chat-list badge route's config, on the PANEL ────────

test('NO panel declares a fallbackRead any more — the Chat-list badge route is retired', () => {
  // Retired 2026-09-24. The "AI generated badge paired with a sender name"
  // fallback on teams_composer shipped false/false and never armed; it was
  // replaced by the AI-EVIDENCE check (aiEvidence:'teams_chat'), because a live
  // probe showed a human group chat carrying "badge-<ts>" Images named
  // "<person> mentioned you" — a "badge" heuristic one release away from
  // reading a colleague chat. See the teams_composer entry.
  assert.deepEqual(AI_PANELS.filter((p) => p.fallbackRead).map((p) => p.id), []);
  for (const entry of buildAiPanelConfig()) {
    assert.equal('fallbackRead' in entry, false, `${entry.id} must not carry a fallbackRead key`);
  }
  const config = buildAiPanelConfig();
  assert.deepEqual(JSON.parse(JSON.stringify(config)), config);
});

test('teams_composer carries the AI-EVIDENCE check, and it is the ONLY panel that does', () => {
  // The composer is shared by every Teams conversation (dlpMatch 'agent'), so a
  // panel match never governs it by itself; the pane's own evidence can.
  const teams = AI_PANELS.find((p) => p.id === 'teams_composer');
  assert.equal(teams.aiEvidence, 'teams_chat');
  assert.equal(teams.dlpMatch, 'agent', 'the evidence route must not relax the panel-alone rule');
  assert.deepEqual(AI_PANELS.filter((p) => p.aiEvidence).map((p) => p.id), ['teams_composer']);
  // It travels, resolved: only the one literal the enforcer implements, '' elsewhere.
  for (const entry of buildAiPanelConfig()) {
    assert.equal(entry.aiEvidence, entry.id === 'teams_composer' ? 'teams_chat' : '', entry.id);
  }
});

test('the panel fallback route cannot be armed without BOTH of its own flags', () => {
  // The two-flag discipline, stated as data rather than trusted to a reviewer.
  // Every panel fallback in the catalog must either be fully inert (both false)
  // or carry a recorded live pass (both true) — never enforce-without-verified,
  // which is the shape that ships an unproven route armed.
  for (const panel of AI_PANELS) {
    const fb = panel.fallbackRead;
    if (!fb) continue;
    assert.equal(typeof fb.enforce, 'boolean', `${panel.id}.fallbackRead.enforce`);
    assert.equal(typeof fb.verified, 'boolean', `${panel.id}.fallbackRead.verified`);
    if (fb.enforce) {
      assert.equal(fb.verified, true,
        `${panel.id} enforces a fallback route it has not recorded a live pass for`);
    }
    // A route with no class filter would be a reader pointed at arbitrary text
    // nodes — the one thing the 2026-09 measurement pass explicitly rejected.
    assert.equal(typeof fb.headingClass, 'string', `${panel.id}.fallbackRead.headingClass`);
    assert.ok(fb.headingClass.trim().length > 0,
      `${panel.id}.fallbackRead needs a class filter — a bare text node is not a match target`);
    assert.equal(fb.mode, 'message_heading', `${panel.id}.fallbackRead.mode`);
  }
});

test('teams_composer never carries soleAgent — it is the opposite of a sole agent', () => {
  // ONE element serves every conversation in Teams' Chat-list route: a DM, a
  // channel post, a group chat and an agent chat all focus the same shape. There
  // is no single agent behind it, which is also why it keeps dlpMatch:'agent'.
  // Naming a sole agent here would assert the exact thing that is false about it.
  const teams = AI_PANELS.find((p) => p.id === 'teams_composer');
  assert.ok(teams, 'the teams_composer panel is missing');
  assert.equal(teams.soleAgent, undefined);
  assert.equal(teams.dlpMatch, 'agent');
  assert.equal(buildAiPanelConfig().find((e) => e.id === 'teams_composer').soleAgent, '');
  // The IDE composers are absent for a different reason: they are not host-app
  // surfaces and have no agent-identity question to answer at all.
  for (const id of ['claude_code', 'cursor_composer', 'vscode_chat']) {
    assert.equal(AI_PANELS.find((p) => p.id === id).soleAgent, undefined, id);
    assert.equal(buildAiPanelConfig().find((e) => e.id === id).soleAgent, '');
  }
});

test('soleAgent travels to the C# side VERBATIM, and is consumed only for block attribution', async () => {
  // The transport is real — that is the point of shipping the field ahead of any
  // logic. Absent travels as '' (same convention as the match fields), a present
  // value travels byte-for-byte with no defaulting: this side must not invent a
  // product name the catalog did not write down.
  const config = buildAiPanelConfig();
  for (const entry of config) {
    const source = AI_PANELS.find((p) => p.id === entry.id);
    assert.equal(entry.soleAgent, source.soleAgent || '', `${entry.id}.soleAgent`);
  }
  assert.equal(config.find((e) => e.id === 'office_copilot_pane').soleAgent, 'Microsoft 365 Copilot');
  assert.equal(config.find((e) => e.id === 'teams_copilot_composer').soleAgent, 'Microsoft 365 Copilot');
  // The C# mirror parses it exactly like the other string fields…
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'enforcer-win.ps1'), 'utf8');
  assert.match(src, /public string SoleAgent;/);
  assert.match(src, /SoleAgent = JsStr\(d, "soleAgent"\),/);
  // …and reads it in exactly ONE function: ResolveBlockAgent, which may quote it
  // as the product a block/redact AUDIT RECORD is about (agent_src "sole"). Four
  // mentions in the CODE — the declaration, the parse, and that function's two
  // reads — so no blocking or DLP decision can be consulting it. The logic that
  // would (identifying a named agent from a panel match alone, for BLOCKING)
  // changes live enforcement behaviour and is separate, later,
  // human-supervised work; os-monitor-safety.test.mjs pins the decision sites.
  //
  // Comment lines are stripped first: comments in this repo deliberately name
  // the thing the code must not do, so counting them would trip the very test
  // they explain.
  const code = src.split(/\r?\n/).filter((l) => !/^\s*(\/\/|#)/.test(l)).join('\n');
  assert.equal((code.match(/SoleAgent/g) || []).length, 4,
    'SoleAgent gained a reader — its only permitted one is ResolveBlockAgent');
  const resolver = src.slice(src.indexOf('static string ResolveBlockAgent('), src.indexOf('static PanelSig PanelById('));
  assert.equal((resolver.split(/\r?\n/).filter((l) => !/^\s*\/\//.test(l)).join('\n').match(/SoleAgent/g) || []).length, 2);
});

// ── D-4: the Office process names stay OUT of every other catalog ────────────

test('Office process names never reach AI_PROCESSES or the watchers, and never a whole-app block', () => {
  // The privacy/false-positive floor under the whole Office-pane feature, and the
  // reason the host reversal above is safe.
  //
  // THE ABSOLUTE HALF, unchanged: AI_PROCESSES / watcherProcessNames() would turn
  // on clipboard scanning, attachment-chip diffing and prompt-text reading across
  // the whole app — every .docx a user opens reported as an AI file upload and
  // every document keystroke buffered. There is no marking that makes that
  // acceptable, so these names must never appear there at all.
  //
  // THE CONDITIONAL HALF, and it changed deliberately when per-agent blocking was
  // extended to the pane. PLATFORM_PROCS and AGENT_SURFACES membership used to be
  // forbidden outright, because each one WAS a route to a whole-app block:
  //   PLATFORM_PROCS — an agent-scoped row matched the process WIDE, swallowing
  //     Enter in ordinary editing;
  //   AGENT_SURFACES — a surface that could not narrow fell back to blocking the
  //     whole app, for a process whose entire surface minus one pane is the
  //     user's own document.
  // Both are now REQUIRED memberships — an agent-scoped row has to be able to
  // cover the process before it can ever be narrowed to one agent inside the pane
  // — and the whole-app outcome is barred by a different mechanism instead:
  // `hostApp: true` on the covering AGENT_SURFACES entry, which CheckFgBlocked
  // reads off the PROCESS and not off the surface being verified. So the
  // invariant is restated rather than dropped: every Office name in either
  // catalog must be covered by a host-app surface. The behavioural proof that
  // this really produces no block lives in tests/enforcer-panel-block.test.mjs
  // ('THE INVERSION, in Office').
  const OFFICE = ['winword', 'excel', 'powerpnt', 'onenote', 'onenoteim'];
  const literal = (e) => e.match.source.replace(/^\^/, '').replace(/\$$/, '').replace(/[\\/]i?$/, '').toLowerCase();

  const aiNames = AI_PROCESSES.map(literal);
  const watchers = watcherProcessNames().map((n) => n.toLowerCase());
  assert.ok(watchers.length > 0, 'expected a non-empty watcher list to check against');
  const platformProcs = Object.values(PLATFORM_PROCS).flat().map((p) => String(p).toLowerCase());

  for (const name of OFFICE) {
    assert.equal(aiNames.includes(name), false, `${name} in AI_PROCESSES turns on the passive watchers app-wide`);
    assert.equal(watchers.includes(name), false, `${name} reached watcherProcessNames()`);
    // Where the name IS allowed now, the host-app marking has to be there too.
    const surfaces = AGENT_SURFACES.filter((s) => s.procs.some((p) => String(p).toLowerCase() === name));
    if (platformProcs.includes(name) || surfaces.length > 0) {
      assert.equal(surfaces.length > 0, true,
        `${name} is in PLATFORM_PROCS with no AGENT_SURFACES entry to bar the whole-app arm`);
      for (const surface of surfaces) {
        assert.equal(surface.hostApp, true,
          `${surface.id} covers ${name} without hostApp — an agent row would disable the whole app`);
        assert.equal(surface.panelHosted, true,
          `${surface.id} covers ${name} without panelHosted — the pane's own panel block would be switched off`);
      }
    }
  }
  // …and the IDE catalog is where they still live as panel HOSTS, so this test
  // cannot pass by the names having been removed from the product altogether.
  const ideNames = IDE_PROCESSES.map(literal);
  for (const name of OFFICE) {
    assert.ok(ideNames.includes(name), `${name} must still be an IDE_PROCESSES panel host`);
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

// ── M365 agent routes (2026-09-24): per-app names, verification record, Outlook ─

test('the Office pane names each host app for the Prompts tab, and falls back to its product', () => {
  const cases = [
    ['WINWORD', 'Word Copilot'], ['winword.exe', 'Word Copilot'], ['EXCEL', 'Excel Copilot'],
    ['POWERPNT', 'PowerPoint Copilot'], ['ONENOTE', 'OneNote Copilot'], ['ONENOTEIM', 'OneNote Copilot'],
  ];
  for (const [proc, product] of cases) {
    assert.deepEqual(identifyAiPanel('office_copilot_pane', proc), { product, vendor: 'Microsoft' }, proc);
  }
  // No process, or one the entry does not list → the panel's own product.
  assert.deepEqual(identifyAiPanel('office_copilot_pane'), { product: 'Microsoft 365 Copilot', vendor: 'Microsoft' });
  assert.deepEqual(identifyAiPanel('office_copilot_pane', 'notepad'), { product: 'Microsoft 365 Copilot', vendor: 'Microsoft' });
  // Every host the pane covers has a name.
  const office = AI_PANELS.find((p) => p.id === 'office_copilot_pane');
  assert.deepEqual(Object.keys(office.productByProc).sort(), [...office.procs].sort());
  // The Teams routes and the Outlook pane.
  assert.equal(identifyAiPanel('teams_composer', 'ms-teams').product, 'Microsoft Teams (agent)');
  assert.equal(identifyAiPanel('teams_copilot_composer', 'ms-teams').product, 'Microsoft Copilot (Teams)');
  assert.equal(identifyAiPanel('outlook_copilot_pane', 'OUTLOOK').product, 'Outlook Copilot');
  assert.equal(identifyAiPanel('outlook_copilot_pane', 'olk').product, 'Outlook Copilot');
});

test('verification is recorded PER HOST: only Word earned it; Excel / PowerPoint / OneNote enforce unverified', () => {
  const office = AI_PANELS.find((p) => p.id === 'office_copilot_pane');
  assert.equal(office.enforce, true);
  assert.deepEqual(office.verifiedProcs, ['WINWORD']);
  for (const proc of ['EXCEL', 'POWERPNT', 'ONENOTE']) {
    assert.ok(office.procs.includes(proc), `${proc} must be covered`);
    assert.equal(office.verifiedProcs.includes(proc), false, `${proc} has had no live pass`);
  }
  for (const proc of office.verifiedProcs) assert.ok(office.procs.includes(proc));
});

test('the Outlook Copilot pane ships ENFORCING but UNVERIFIED, on the Fluent-AI class token only', () => {
  const o = AI_PANELS.find((p) => p.id === 'outlook_copilot_pane');
  assert.ok(o);
  assert.equal(o.enforce, true);
  assert.equal(o.verified, false, 'unprobed on a live Outlook — the catalog must say so');
  assert.deepEqual(o.procs, ['OUTLOOK', 'olk']);
  assert.equal(o.classEquals, 'fai-EditorInput__input');
  assert.equal(o.dlpMatch, 'panel');
  assert.equal(o.newlineKeys, 'shift_enter');
  assert.equal(o.postSendVerifyMs, 1500);
  assert.equal(o.host, 'm365.cloud.microsoft', 'the pane\'s own product host — NOT outlook.office.com');
  assert.equal(o.nameEquals, undefined);
  assert.equal(o.namePrefix, undefined);
});

test('collision fixtures: generic Office / Outlook editing classes never match a pane', () => {
  const NATIVE = [
    ['EXCEL', 'Edit', 'EXCEL<'], ['EXCEL', 'Edit', 'EXCEL6'], ['EXCEL', 'DataItem', 'EXCEL7'],
    ['POWERPNT', 'Document', 'mdiClass'], ['POWERPNT', 'Edit', 'NetUITextbox'],
    ['ONENOTE', 'Document', 'NetUIHWND'], ['ONENOTE', 'Edit', 'NetUITextbox'],
    ['WINWORD', 'Document', '_WwG'], ['WINWORD', 'Edit', 'NetUITextbox'],
    ['OUTLOOK', 'Document', '_WwG'], ['OUTLOOK', 'Edit', 'RichEdit20WPT'], ['OUTLOOK', 'Edit', 'NetUITextbox'],
    ['olk', 'Edit', 'ms-rte-Editor elementToProof'], ['olk', 'Edit', 'fui-Input__input'],
  ];
  for (const [proc, controlType, className] of NATIVE) {
    for (const name of ['', 'Message body', 'Formula Bar', 'Search']) {
      assert.equal(matchPanelSignature({ process: proc, controlType, name, className }), null, `${proc} ${className} "${name}"`);
    }
  }
  // …while the Fluent-AI composer matches in every host.
  for (const proc of ['WINWORD', 'EXCEL', 'POWERPNT', 'ONENOTE', 'OUTLOOK', 'olk']) {
    assert.ok(matchPanelSignature({ process: proc, controlType: 'Edit', name: '', className: 'fai-EditorInput__input r18fti29' }), proc);
  }
});

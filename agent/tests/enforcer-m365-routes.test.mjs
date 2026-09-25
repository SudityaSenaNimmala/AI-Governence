// "Every agent chat in the Microsoft 365 desktop apps gets the same prompt DLP
// scan + block + Tokenize & Send that ChatGPT/Claude desktop get" (2026-09-24),
// after that day's security review (H1, H2+M2, H3, M1, L1, L5).
//
// Behavioural coverage, driven by tests/helpers/m365-routes-harness.ps1 over the
// REAL catalog payloads. For Teams the harness drives the REAL evidence path —
// ComputeTickTeamsEvidence → key / TTL / keep-last-good / watchdog → a real
// background thread → the strict verdict → the published immutable verdict —
// with only the UIA pane SNAPSHOT scripted. NOTHING installs a hook or types.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  buildIdeProcessConfig, buildAiPanelConfig, buildAgentSurfaceConfig, watcherProcessNames,
} from '../src/os_monitor/ai-processes.js';

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const AGENT_DIR = join(__dirname, '..');
const HARNESS = join(__dirname, 'helpers', 'm365-routes-harness.ps1');
const ENFORCER = process.env.CFAI_TEST_ENFORCER_PS1 || join(AGENT_DIR, 'src', 'os_monitor', 'enforcer-win.ps1');
const win = process.platform === 'win32';

let cached = null;
async function run() {
  if (cached) return cached;
  const dir = await mkdtemp(join(tmpdir(), 'cfai-m365-routes-'));
  try {
    await writeFile(join(dir, 'ide.json'), JSON.stringify(buildIdeProcessConfig()));
    await writeFile(join(dir, 'panels.json'), JSON.stringify(buildAiPanelConfig()));
    await writeFile(join(dir, 'surfaces.json'), JSON.stringify(buildAgentSurfaceConfig()));
    await writeFile(join(dir, 'aiprocs.txt'), watcherProcessNames().join(','));
    const { stdout } = await execFileAsync(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-Sta', '-ExecutionPolicy', 'Bypass', '-File', HARNESS, '-Ps1', ENFORCER, '-PayloadDir', dir],
      { maxBuffer: 32 * 1024 * 1024, windowsHide: true, timeout: 240000 },
    );
    const lines = stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const junk = lines.filter((l) => !l.startsWith('{'));
    assert.deepEqual(junk, [], `harness wrote non-JSON to stdout:\n${junk.join('\n')}`);
    cached = lines.map((l) => JSON.parse(l));
    return cached;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
async function ticks(scenario) {
  const rows = (await run()).filter((r) => r.case === 'tick' && r.scenario === scenario);
  assert.ok(rows.length, `harness produced no ticks for '${scenario}'`);
  return rows;
}
async function tick(scenario) { return (await ticks(scenario))[0]; }
async function collect(variant) {
  const r = (await run()).find((x) => x.case === 'collect' && x.variant === variant);
  assert.ok(r, `no collect '${variant}'`);
  return Object.fromEntries(r.result.split(';').map((kv) => kv.split('=')));
}
// "Not scanned" for a Chat-list tick: not governed, no content block, no Tier B,
// no upload. (_fgIsAi may still be true in the 3s sticky window after a governed
// tick — that is pre-existing and carries no content: PanelUiaOk is false.)
const NOT_GOVERNED = (r, label) => {
  assert.equal(r.dlpGoverned, false, `${label}: must not be DLP-governed`);
  assert.equal(r.agentChatEvidence, false, `${label}: no agent-chat evidence`);
  assert.equal(r.contentBlock, false, `${label}: a sensitive Enter must not be swallowed`);
  assert.equal(r.tierBReached, false, `${label}: Tokenize & Send must not be offered`);
  assert.equal(r.evidenceRoute, false, `${label}: no prompt may be uploaded`);
};
const SCANNED = (r, label) => {
  assert.equal(r.fgIsAi, true, `${label}: must be an AI surface`);
  assert.equal(r.contentBlock, true, `${label}: a sensitive Enter must be blocked`);
  assert.equal(r.tierBReached, true, `${label}: Tokenize & Send must be offered`);
};

test('harness never calls Start(), never installs a hook, never types', async () => {
  const src = await readFile(HARNESS, 'utf8');
  const code = src.split(/\r?\n/).filter((l) => !l.trimStart().startsWith('#')).join('\n');
  assert.equal(/\[CfaiEnforcer\]::Start\(/.test(code), false);
  assert.equal(/SetWindowsHookEx|SendInput|RunRewrite|StartRewrite|LiveRewriteIo/.test(code), false);
  // It drives the REAL evidence path, not the per-tick field.
  assert.match(code, /Call 'ComputeTickTeamsEvidence'/);
  assert.equal(/SetF '_tickAgentChatEvidence' \$true|SetF '_tickAgentChatEvidence' \(/.test(code), false,
    'the harness must never set the evidence verdict directly');
});

test('THE FIX EXISTS', { skip: !win }, async () => {
  assert.equal((await run()).find((x) => x.case === 'available')?.available, true);
});

// ── The strict verdict (H2 + M2) ─────────────────────────────────────────────

test('THE ROUTE: a 1:1 agent chat — every incoming message has its feedback button — is scanned, blocked and offered T&S, no row', { skip: !win }, async () => {
  const first = await tick('teams_agent_first_tick');
  NOT_GOVERNED(first, 'before the first search completes');   // fail closed
  const r = await tick('teams_agent_1to1');
  assert.equal(r.hostAppArmed, false, 'no policy row in this scenario');
  assert.equal(r.hostEvidenceArmed, true);
  assert.equal(r.nameRead, false);
  assert.equal(r.verdict, 'agent:OneToOne');
  assert.equal(r.agentChatEvidence, true);
  assert.equal(r.dlpGoverned, true);
  SCANNED(r, 'agent 1:1');
  assert.equal(r.evidenceRoute, true, 'the prompt is uploaded for the Prompts tab');
  const block = JSON.parse(r.blockLine);
  assert.equal(block.rewritable, true);
  assert.equal(block.platform_block, undefined);
  assert.equal(block.panel, 'teams_composer');
  const prompt = JSON.parse(r.promptLine);
  assert.equal(prompt.kind, 'prompt_text');
  assert.equal('title' in prompt, false);
});

test('a human 1:1 containing ONE agent-marked reply among unmarked human messages is NOT an agent chat', { skip: !win }, async () => {
  const r = await tick('teams_human_1to1_one_agent_reply');
  assert.equal(r.verdict, 'not_agent:OneToOne');
  NOT_GOVERNED(r, 'human 1:1 with an agent reply');
});

test('feedback buttons from ANOTHER thread — all of them, or just one — mean not an agent chat', { skip: !win }, async () => {
  for (const s of ['teams_feedback_thread_mismatch', 'teams_feedback_one_foreign']) {
    const r = await tick(s);
    assert.equal(r.verdict, 'not_agent:OneToOne', s);
    NOT_GOVERNED(r, s);
  }
});

test('TWO conversation headers in scope — not an agent chat', { skip: !win }, async () => {
  const r = await tick('teams_two_headers');
  assert.equal(r.verdict, 'not_agent:Ambiguous');
  NOT_GOVERNED(r, 'two headers');
});

test('a GROUP chat ("@thread.v2") is never scanned, even with a feedback button for every message', { skip: !win }, async () => {
  const r = await tick('teams_group_chat_with_markers');
  assert.equal(r.verdict, 'not_agent:GroupOrChannel');
  assert.equal(r.chatIsGroup, true);
  NOT_GOVERNED(r, 'group chat');
});

test('no header, no pane, no incoming messages, a walk cap hit, or focus moving mid-search — fail CLOSED', { skip: !win }, async () => {
  const expect = {
    teams_missing_header: 'not_agent:NoHeader', teams_pane_not_found: 'none',
    teams_no_messages: 'not_agent:OneToOne', teams_cap_hit: 'not_agent:OneToOne', teams_focus_moved_mid_search: 'none',
  };
  for (const [s, v] of Object.entries(expect)) {
    const r = await tick(s);
    assert.equal(r.verdict, v, s);
    NOT_GOVERNED(r, s);
  }
});

test('the REAL collector: IDs and classes only; disclaimer and the human badge are not evidence; the cap fails closed', { skip: !win }, async () => {
  assert.deepEqual(await collect('agent'), { headers: '1', messages: '1', feedback: '2', cap: 'False', agent: 'True', kind: 'OneToOne' });
  assert.equal((await collect('human_mixed')).agent, 'False');
  assert.equal((await collect('group')).kind, 'GroupOrChannel');
  assert.equal((await collect('group')).agent, 'False');
  assert.equal((await collect('disclaimer_only')).agent, 'False', 'the AI-generated disclaimer alone is not required, and not enough');
  const cap = await collect('cap');
  assert.equal(cap.cap, 'True');
  assert.equal(cap.agent, 'False');
});

// ── The cache (M1) and the watchdog / keep-last-good (L5) ────────────────────

test('a conversation switch agent → human 1:1 WITHIN the TTL is not governed — immediately, and after its own search', { skip: !win }, async () => {
  const [agent, justSwitched, settled] = await ticks('teams_switch_agent_to_human');
  assert.equal(agent.dlpGoverned, true);
  NOT_GOVERNED(justSwitched, 'immediately after the switch');
  assert.equal(justSwitched.searches, 2, 'the new composer key started a new search');
  NOT_GOVERNED(settled, 'after the human 1:1 was searched');
  assert.equal(settled.verdict, 'not_agent:OneToOne');
});

test('focus leaving the composer clears the published verdict; coming back needs a new search', { skip: !win }, async () => {
  const [governed, away, back] = await ticks('teams_focus_leaves_composer');
  assert.equal(governed.dlpGoverned, true);
  assert.equal(away.verdict, 'none');
  NOT_GOVERNED(away, 'focus elsewhere');
  assert.equal(back.verdict, 'none');
  NOT_GOVERNED(back, 'back, before a new search');
});

test('KEEP-LAST-GOOD: a same-key re-check keeps the verdict while it runs; a FAILED re-check clears it', { skip: !win }, async () => {
  const [first, during, after] = await ticks('teams_keep_last_good');
  assert.equal(first.dlpGoverned, true);
  assert.equal(during.searches, 2, 'the TTL started a re-check');
  assert.equal(during.dlpGoverned, true, 'the last good verdict is kept while the re-check runs');
  assert.equal(after.verdict, 'not_agent:OneToOne');
  NOT_GOVERNED(after, 'after a failed re-check');
});

test('WATCHDOG: a hung search is abandoned after 3s and its late result is discarded', { skip: !win }, async () => {
  const [hung, recovered, afterLate] = await ticks('teams_watchdog');
  NOT_GOVERNED(hung, 'while the first search hangs');
  assert.equal(recovered.searches, 2, 'the watchdog let a new search start');
  assert.equal(recovered.dlpGoverned, true);
  assert.equal(afterLate.verdict, 'agent:OneToOne', 'the hung search\'s "not agent" result was discarded by generation');
  assert.equal(afterLate.dlpGoverned, true);
});

// ── H1: the title/Named route never uploads; @thread.v2 refuses every route ──

test('a GROUP chat renamed to a BLOCKED agent\'s name: no block, no scan, no upload', { skip: !win }, async () => {
  const r = await tick('teams_renamed_group_as_blocked_agent');
  assert.equal(r.chatIsGroup, true);
  assert.equal(r.fgIsBlocked, false, 'the rename cannot arm the agent block');
  NOT_GOVERNED(r, 'renamed group (blocked name)');
  // control: the same Named blocked agent in a real agent 1:1 still blocks.
  const c = await tick('teams_named_blocked_agent_control');
  assert.equal(c.fgIsBlocked, true);
  assert.equal(JSON.parse(c.blockLine).agent_src, 'row');
  assert.equal(c.evidenceRoute, false, 'a blocked conversation uploads nothing');
});

test('a GROUP chat renamed to a GOVERNED agent\'s name: not scanned, no upload', { skip: !win }, async () => {
  const r = await tick('teams_renamed_group_as_governed_agent');
  assert.equal(r.chatIsGroup, true);
  NOT_GOVERNED(r, 'renamed group (governed name)');
});

test('the Named GOVERNED route without evidence is scanned (row route) but NEVER uploads', { skip: !win }, async () => {
  const r = await tick('teams_named_governed_no_evidence');
  assert.equal(r.dlpGoverned, true, 'the name route keeps working with its row');
  assert.equal(r.agentChatEvidence, false);
  assert.equal(r.evidenceRoute, false, 'the title/Named route is never an upload licence');
});

// ── H3: the fleet dlp flag gates every evidence route ────────────────────────

test('dlp OFF with a Teams policy row: the evidence routes (agent chat, Copilot tab) do nothing', { skip: !win }, async () => {
  const chat = await tick('teams_dlp_off_with_row');
  assert.equal(chat.hostAppArmed, true, 'the row arms the read');
  assert.equal(chat.hostEvidenceArmed, false);
  // The pane IS read under the row's arm (so a "@thread.v2" header can refuse
  // the name / block routes) and the raw verdict may say "agent" — but with dlp
  // off it licenses nothing: not governed, no content block, no T&S, no upload.
  assert.equal(chat.dlpGoverned, false, 'dlp off: evidence must not govern');
  assert.equal(chat.contentBlock, false);
  assert.equal(chat.tierBReached, false);
  assert.equal(chat.evidenceRoute, false, 'dlp off: nothing is uploaded');
  const tab = await tick('teams_copilot_tab_dlp_off_with_row');
  assert.equal(tab.matched, 'teams_copilot_composer');
  NOT_GOVERNED(tab, 'dlp off, Copilot tab');
  const none = await tick('teams_dlp_off_no_rows');
  assert.equal(none.matched, '', 'dlp off and no row: Teams is not even read');
  assert.equal(none.searches, 0);
  NOT_GOVERNED(none, 'dlp off, no rows');
});

test('the Teams COPILOT TAB with dlp on and no rows is scanned (panel-alone), attributed to its sole agent', { skip: !win }, async () => {
  const r = await tick('teams_copilot_tab_no_rows');
  assert.equal(r.dlpGoverned, true);
  SCANNED(r, 'Copilot tab');
  assert.equal(r.evidenceRoute, true);
  const block = JSON.parse(r.blockLine);
  assert.equal(block.rewritable, true);
  assert.equal(block.agent_src, 'sole');
});

test('the M365 Copilot app is a whole-app chat surface (unchanged), with a rewritable block', { skip: !win }, async () => {
  const r = await tick('m365_copilot_app');
  SCANNED(r, 'M365 Copilot app');
  assert.equal(JSON.parse(r.blockLine).rewritable, true);
  assert.equal(r.evidenceRoute, false, 'its prompts come from the prompt watcher — no double record');
});

test('Word / Excel / PowerPoint / OneNote / Outlook panes: scanned + T&S + upload with dlp ON; NOTHING with dlp OFF', { skip: !win }, async () => {
  for (const [app, panel] of [['WINWORD', 'office_copilot_pane'], ['EXCEL', 'office_copilot_pane'], ['POWERPNT', 'office_copilot_pane'],
    ['ONENOTE', 'office_copilot_pane'], ['OUTLOOK', 'outlook_copilot_pane'], ['olk', 'outlook_copilot_pane']]) {
    const on = await tick(`pane_${app}`);
    assert.equal(on.matched, panel, app);
    assert.equal(on.nameRead, false, `${app}: the element Name is never read`);
    SCANNED(on, `${app} pane`);
    assert.equal(on.evidenceRoute, true, app);
    assert.equal(JSON.parse(on.blockLine).rewritable, true, app);
    const off = await tick(`pane_dlp_off_${app}`);
    assert.equal(off.contentOk, false, `${app}: no content with dlp off`);
    assert.equal(off.contentBlock, false, `${app}: no content block with dlp off`);
    assert.equal(off.tierBReached, false, `${app}: no Tokenize & Send with dlp off`);
    assert.equal(off.evidenceRoute, false, `${app}: no upload with dlp off`);
  }
  // …but a panel-keyed BLOCK ROW still blocks the pane with dlp off.
  const row = await tick('pane_dlp_off_row_still_blocks');
  assert.equal(row.fgIsBlocked, true);
  assert.equal(row.evidenceRoute, false);
});

test('native Office / Outlook editing surfaces never match a pane (collision fixtures)', { skip: !win }, async () => {
  const rows = (await run()).filter((r) => r.case === 'tick' && r.scenario.startsWith('collide_'));
  assert.equal(rows.length, 14);
  for (const r of rows) {
    assert.equal(r.matched, '', r.scenario);
    assert.equal(r.fgIsAi, false, r.scenario);
    NOT_GOVERNED(r, r.scenario);
  }
});

test('Outlook: the COMPOSE BODY never swallows Enter — cold, or right after the Copilot pane', { skip: !win }, async () => {
  for (const s of ['outlook_body_cold', 'olk_body_cold']) {
    const r = await tick(s);
    assert.equal(r.fgIsAi, false);
    NOT_GOVERNED(r, s);
  }
  const [pane, body] = await ticks('outlook_pane_then_body');
  SCANNED(pane, 'pane');
  assert.equal(body.matched, '');
  assert.equal(body.contentBlock, false);
  assert.equal(body.tierBReached, false);
  assert.equal(body.evidenceRoute, false);
});

test('the evidence-prompt line carries text + catalog ids + row/sole/none attribution, and NO title or UI-read name', { skip: !win }, async () => {
  const withPrompt = (await run()).filter((r) => r.case === 'tick' && r.promptLine);
  assert.ok(withPrompt.length >= 8);
  for (const r of withPrompt) {
    const ev = JSON.parse(r.promptLine);
    assert.deepEqual(Object.keys(ev).filter((k) => k !== 'surface').sort(),
      ['agent', 'agent_id', 'agent_src', 'cause', 'kind', 'len', 'panel', 'process', 'text'].sort(), r.scenario);
    assert.equal('title' in ev, false);
    assert.ok(['row', 'sole', 'none'].includes(ev.agent_src));
    for (const forbidden of ['Microsoft Teams |', 'Type a message', 'Message Copilot', '@']) {
      assert.equal(r.promptLine.includes(forbidden), false, `${r.scenario}: ${forbidden}`);
    }
  }
});

// ── BUG A (live 2026-09-24): Word's focused element is WINWORD's own WebView2Holder ─
// The REAL ResolveEffectiveFocus + MatchPanelSignature, with only the webview
// finder scripted and REAL parent/child pids for the direct-child rule.
async function webview(variant) {
  const r = (await run()).find((x) => x.case === 'webview' && x.variant === variant);
  assert.ok(r, `no webview case '${variant}'`);
  return r.result;
}

test('BUG A: a focused WebView2Holder in every Office / Outlook host resolves to the webview composer and matches its pane', { skip: !win }, async () => {
  for (const [app, panel] of [['WINWORD', 'office_copilot_pane'], ['EXCEL', 'office_copilot_pane'], ['POWERPNT', 'office_copilot_pane'],
    ['ONENOTE', 'office_copilot_pane'], ['OUTLOOK', 'outlook_copilot_pane'], ['olk', 'outlook_copilot_pane']]) {
    assert.equal(await webview(`holder_composer_${app}`), `resolved;calls=1;match=${panel}`, app);
  }
});

test('BUG A: a holder with no focused Edit — or a non-Edit, a host-pid or an unrelated-pid element — is NO panel (fail closed)', { skip: !win }, async () => {
  for (const v of ['holder_no_focused_edit', 'holder_found_non_edit', 'holder_found_in_host_pid', 'holder_found_unrelated_pid']) {
    assert.equal(await webview(v), 'null;calls=1', v);
  }
  // A focused webview Edit that is NOT the Copilot composer resolves but matches nothing.
  assert.equal(await webview('holder_focused_other_webview_edit'), 'resolved;calls=1;match=');
});

test('BUG A: anything but the host\'s own WebView2Holder takes the unchanged path, and no webview is searched', { skip: !win }, async () => {
  for (const v of ['non_holder_document', 'holder_in_non_office_process', 'holder_in_teams', 'holder_not_owned_by_host']) {
    assert.equal(await webview(v), 'unchanged;calls=0;match=', v);
  }
});

test('BUG A: one resolver for every panel reader; it searches only the host\'s direct-child webviews, never reads a title', async () => {
  const src = await readFile(ENFORCER, 'utf8');
  const code = src.split(/\r?\n/).filter((l) => !/^\s*\/\//.test(l)).join('\n');
  assert.match(code, /el = ResolveHolderElement\(el, fgPid, proc\);\s*if \(el == null\) return null;/);
  for (const site of [/AutomationElement panelEl = EffectiveFocusedElement\(\);/, /AutomationElement el = EffectiveFocusedElement\(\);/,
    /try \{ el = EffectiveFocusedElement\(\); \} catch \{ el = null; \}/, /try \{ _el = EffectiveFocusedElement\(\); \} catch \{ _el = null; \}/,
    /var f = EffectiveFocusedElement\(\);/]) {
    assert.match(code, site);
  }
  const sec = code.slice(code.indexOf('internal sealed class FocusProps'), code.indexOf('static bool PanelUsesNameRule('));
  assert.match(sec, /if \(!string\.Equals\(f\.ClassName, "WebView2Holder", StringComparison\.Ordinal\)\) return false;/);
  assert.match(sec, /if \(f\.Pid != \(int\)hostPid\) return false;/);
  assert.match(sec, /return _idePanelChildProcs\.Contains\(StripExe\(proc\)\.Trim\(\)\);/);
  assert.match(sec, /if \(GetParentProcessId\(\(int\)kv\.Key\) == \(int\)hostPid\) hwnds\.AddRange\(kv\.Value\);/);
  assert.match(sec, /new PropertyCondition\(AutomationElement\.HasKeyboardFocusProperty, true\)/);
  assert.equal(/GetWindowText|\.Current\.Name|ReadText\(/.test(sec.replace(/if \(readName\) \{ try \{ f\.Name = el\.Current\.Name \?\? ""; \} catch \{ \} \}/, '')), false,
    'the resolver reads no title and no text');
  assert.equal((code.match(/PropsOf\([^)]*, true\)/g) || []).length, 0, 'the resolver never reads a Name');
});

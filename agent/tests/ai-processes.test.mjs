// Regression coverage for the AI_PROCESSES catalog's attachment-watcher
// eligibility flags. This exists because a wrong assumption here is exactly
// what caused the real bug this test file guards against: Claude Desktop's
// useAttachmentWatcher was false on the theory that the asar-injected DOM
// hook covers file uploads instead — but that hook is confirmed dead on
// current Claude Desktop builds (ASAR integrity enforcement blocks the
// injection), so Claude Desktop got ZERO file-content scanning of any kind
// until this was fixed. See ai-processes.js's own comments for the full story.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  AI_PROCESSES,
  IDE_PROCESSES,
  PLATFORM_PROCS,
  isAttachmentWatcherEligible,
  shouldScrubClipboardFor,
  identifyAiProcess,
  hostForProcess,
  hostsForPlatform,
  filterBlockedAgents,
  processForHost,
  synthesizePlatformBlocks,
  PLATFORM_BLOCK_SENTINEL,
  AGENT_SURFACES,
  AGENT_NAME_GENERIC,
  AGENT_NAME_NOT_COMPOSER,
  agentSurfaceForProcess,
  extractAgentName,
  agentNameMatches,
  normalizeAgentRows,
  buildAgentSurfaceConfig,
} from '../src/os_monitor/ai-processes.js';

const AGENT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');

test('Claude Desktop is eligible for attachment-chip content scanning', () => {
  // The regression: this used to be false, silently leaving Claude Desktop
  // file uploads (PDF/docx/xlsx/zip, all fully supported by
  // binary-extractors.js) completely unscanned.
  assert.equal(isAttachmentWatcherEligible('Claude'), true);
  assert.equal(isAttachmentWatcherEligible('claude'), true);   // case-insensitive
  assert.equal(isAttachmentWatcherEligible('claude.exe'), true);
});

test('Cursor and GitHub Copilot stay excluded — different, still-valid reasons', () => {
  // Cursor: genuine continuous file exposure via its IDE UI (tab strip, file
  // tree) — enabling this would misreport every file opened while coding as
  // an AI file upload. Needs its own UIA investigation before ever flipping,
  // not the same fix as Claude's.
  assert.equal(isAttachmentWatcherEligible('Cursor'), false);
  // GitHub Copilot Chat runs as a VS Code plugin, not a standalone window —
  // a different architecture this catalog cannot key on by process name alone.
  assert.equal(isAttachmentWatcherEligible('GitHub Copilot'), false);
});

test('pure chat apps remain eligible (unaffected by the Claude fix)', () => {
  for (const proc of ['ChatGPT', 'ChatGPT Classic', 'Comet', 'Gemini', 'Poe', 'Copilot', 'M365Copilot']) {
    assert.equal(isAttachmentWatcherEligible(proc), true, `${proc} should stay eligible`);
  }
});

test('unknown process names are not eligible', () => {
  assert.equal(isAttachmentWatcherEligible('notepad'), false);
  assert.equal(isAttachmentWatcherEligible(''), false);
  assert.equal(isAttachmentWatcherEligible(null), false);
});

test('Claude Desktop clipboard scrub is unaffected by the attachment-watcher fix', () => {
  // These two flags are independent — the fix only touches
  // useAttachmentWatcher. Claude has another block mechanism (the keystroke
  // enforcer), so it correctly stays un-scrubbed either way.
  assert.equal(shouldScrubClipboardFor('Claude'), false);
});

test('identifyAiProcess still resolves Claude to the same product/vendor', () => {
  assert.deepEqual(identifyAiProcess('Claude'), { product: 'Claude', vendor: 'Anthropic' });
});

// ── Access-exception keys (desktop Request Access) ───────────────────────────
// The exception a desktop block is lifted by is keyed on the canonical vendor
// HOST, the same key the browser extension uses (its tool_host is literally the
// blocked tab's hostname). One approval therefore covers both surfaces — which
// only holds if these hosts match the hosts a browser would actually be on.

test('every catalog entry carries a canonical host', () => {
  for (const entry of AI_PROCESSES) {
    assert.ok(entry.host, `${entry.product} is missing a host`);
    assert.match(entry.host, /^[a-z0-9.-]+\.[a-z]{2,}$/, `${entry.product}: '${entry.host}' is not a bare hostname`);
    assert.equal(/^https?:|\/$/.test(entry.host), false, `${entry.product}: host must be a hostname, not a URL`);
  }
});

test('hostForProcess resolves the desktop apps to the hosts the extension sees', () => {
  assert.equal(hostForProcess('Claude'), 'claude.ai');
  assert.equal(hostForProcess('claude.exe'), 'claude.ai');       // suffix + case tolerant
  assert.equal(hostForProcess('ChatGPT'), 'chatgpt.com');
  assert.equal(hostForProcess('ChatGPT Classic'), 'chatgpt.com'); // name variant, same product
  assert.equal(hostForProcess('Gemini'), 'gemini.google.com');
  assert.equal(hostForProcess('Copilot'), 'copilot.microsoft.com');
  assert.equal(hostForProcess('Cursor'), 'cursor.com');
  assert.equal(hostForProcess('notepad'), null);
  assert.equal(hostForProcess(null), null);
});

test('hostsForPlatform maps every blockable platform to at least one host', () => {
  assert.deepEqual(hostsForPlatform('claude_ai_project'), ['claude.ai']);
  assert.deepEqual(hostsForPlatform('openai_assistant'), ['chatgpt.com']);
  assert.deepEqual(hostsForPlatform('custom_gpt'), ['chatgpt.com']);
  assert.deepEqual(hostsForPlatform('gemini'), ['gemini.google.com']);
  // copilot_studio is reachable through two different Copilot builds.
  assert.deepEqual(hostsForPlatform('copilot_studio'), ['copilot.microsoft.com', 'm365.cloud.microsoft']);
  for (const platform of Object.keys(PLATFORM_PROCS)) {
    assert.ok(hostsForPlatform(platform).length > 0, `${platform} maps to no host`);
  }
  // An unknown platform yields nothing, which callers must read as "no
  // exception can apply" — never as "unblock it".
  assert.deepEqual(hostsForPlatform('teams_chat_agent'), []);
  assert.deepEqual(hostsForPlatform(undefined), []);
});

test('PLATFORM_PROCS agrees with the copy inside enforcer-win.ps1', async () => {
  // The .ps1 is a standalone PowerShell process that reads blocked-agents.json
  // itself and cannot import ESM, so the map is duplicated there by necessity.
  // If the two drift, the enforcer blocks a platform this side cannot map to a
  // host — and an approved exception silently fails to unblock the app.
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'enforcer-win.ps1'), 'utf8');
  const block = src.slice(src.indexOf('PLATFORM_PROCS = new Dictionary'));
  const body = block.slice(0, block.indexOf('};'));

  const fromPs1 = {};
  const rowRe = /\{\s*"([a-z_]+)",\s*new HashSet<string>\([^)]*\)\s*\{([^}]*)\}/g;
  let m;
  while ((m = rowRe.exec(body)) !== null) {
    fromPs1[m[1]] = m[2].split(',').map((s) => s.trim().replace(/^"|"$/g, '')).filter(Boolean);
  }

  assert.ok(Object.keys(fromPs1).length > 0, 'could not parse PLATFORM_PROCS out of enforcer-win.ps1');
  assert.deepEqual(fromPs1, { ...PLATFORM_PROCS });
});

test('filterBlockedAgents drops only the rows an exception actually covers', () => {
  const list = [
    { agent_id: 'a1', agent_name: 'Claude Projects', platform: 'claude_ai_project' },
    { agent_id: 'a2', agent_name: 'Team GPT',        platform: 'openai_assistant' },
    { agent_id: 'a3', agent_name: 'Sales Copilot',   platform: 'copilot_studio' },
    { agent_id: 'a4', agent_name: 'Teams bot',       platform: 'teams_chat_agent' },
  ];
  const kept = filterBlockedAgents(list, [
    { tool_host: 'CLAUDE.AI', expires_at: new Date(Date.now() + 3600000) },   // case-insensitive
    { tool_host: 'm365.cloud.microsoft' },                                     // one of two Copilot hosts is enough
  ]);
  assert.deepEqual(kept.map((r) => r.agent_id), ['a2', 'a4']);
});

test('filterBlockedAgents is a no-op for an empty or malformed exception list', () => {
  const list = [{ agent_id: 'a1', platform: 'claude_ai_project' }];
  assert.deepEqual(filterBlockedAgents(list, []), list);
  assert.deepEqual(filterBlockedAgents(list, null), list);
  assert.deepEqual(filterBlockedAgents(list, [{}]), list);
  assert.deepEqual(filterBlockedAgents(list, [{ tool_host: '' }]), list);
  // An exception for a tool this device does not block changes nothing.
  assert.deepEqual(filterBlockedAgents(list, [{ tool_host: 'poe.com' }]), list);
});

// ── Inventory host block → desktop process (the ai_platforms bridge) ─────────
// The admin Inventory page's `blocked` toggle is keyed by HOST and was enforced
// only by the browser extension. processForHost is the reverse of
// hostForProcess, and synthesizePlatformBlocks turns those rows into the
// blocked-agents.json shape the desktop enforcer already reads.

test('processForHost is the exact reverse of hostForProcess for every eligible app', () => {
  for (const entry of AI_PROCESSES) {
    if (entry.useAttachmentWatcher === false) continue;
    const proc = processForHost(entry.host);
    assert.ok(proc, `${entry.host} should resolve to a process`);
    // Round-trips: whatever name comes back must map to the host we asked for.
    assert.equal(hostForProcess(proc), entry.host, `${proc} → ${entry.host} round trip`);
  }
});

test('processForHost matches case-insensitively and rejects anything unknown', () => {
  assert.equal(processForHost('claude.ai'), 'claude');
  assert.equal(processForHost('CLAUDE.AI'), 'claude');
  assert.equal(processForHost('  claude.ai  '), 'claude');
  assert.equal(processForHost('gemini.google.com'), 'gemini');
  assert.equal(processForHost('example.com'), null);
  // No subdomain / URL guessing: ai_platforms.host is already normalised by the
  // server, and inferring a match here could block a whole vendor's desktop app
  // off an unrelated subdomain row.
  assert.equal(processForHost('app.claude.ai'), null);
  assert.equal(processForHost('https://claude.ai'), null);
  assert.equal(processForHost(''), null);
  assert.equal(processForHost(null), null);
  assert.equal(processForHost(undefined), null);
});

test('processForHost excludes the IDE surfaces — Cursor and GitHub Copilot', () => {
  // Fully swallowing keystrokes in a code editor because someone toggled
  // cursor.com in the browser inventory would be a catastrophic false positive.
  // Keyed on the useAttachmentWatcher flag, not a hardcoded name list, so the
  // exclusion tracks the catalog.
  assert.equal(processForHost('cursor.com'), null);
  assert.equal(processForHost('github.com'), null);
  // …and the flag really is what draws that line today.
  const excluded = AI_PROCESSES.filter((e) => e.useAttachmentWatcher === false).map((e) => e.product);
  assert.deepEqual(excluded, ['Cursor', 'GitHub Copilot']);
});

test('synthesizePlatformBlocks only emits rows that are blocked AND resolve to a desktop app or panel', () => {
  const rows = synthesizePlatformBlocks([
    { host: 'claude.ai',   product: 'Claude',    vendor: 'Anthropic',  blocked: true  },
    { host: 'chatgpt.com', product: 'ChatGPT',   vendor: 'OpenAI',     blocked: false },  // not blocked
    { host: 'lovable.dev', product: 'Lovable',   vendor: 'Lovable',    blocked: true  },  // no desktop app, no panel
    { host: 'cursor.com',  product: 'Cursor',    vendor: 'Anysphere',  blocked: true  },  // IDE process excluded; PANEL covered
    { host: 'github.com',  product: 'Copilot',   vendor: 'GitHub',     blocked: true  },  // IDE plugin excluded; PANEL covered
  ]);
  // The IDE PROCESS exclusion is unchanged — no row ever names Cursor or
  // GitHub Copilot as a process_name, because process_name matching in the .ps1
  // is process-wide and would swallow input in a code editor. What is new is
  // that the AI PANEL inside those IDEs is covered, scoped to the composer
  // element. See ai-panels.test.mjs for the panel rows in detail.
  assert.deepEqual(rows, [
    {
      platform: PLATFORM_BLOCK_SENTINEL,
      process_name: 'claude',
      agent_name: 'Claude',
      agent_id: '',
      host: 'claude.ai',
      reason: 'Blocked by organization policy',
    },
    {
      platform: PLATFORM_BLOCK_SENTINEL,
      panel: 'claude_code',
      agent_name: 'Claude',
      agent_id: '',
      host: 'claude.ai',
      reason: 'Blocked by organization policy',
    },
    {
      platform: PLATFORM_BLOCK_SENTINEL,
      panel: 'cursor_composer',
      agent_name: 'Cursor',
      agent_id: '',
      host: 'cursor.com',
      reason: 'Blocked by organization policy',
    },
    {
      platform: PLATFORM_BLOCK_SENTINEL,
      panel: 'vscode_chat',
      agent_name: 'Copilot',
      agent_id: '',
      host: 'github.com',
      reason: 'Blocked by organization policy',
    },
  ]);
  assert.equal(rows.some((r) => /cursor|github copilot/i.test(r.process_name || '')), false);
});

test('synthesizePlatformBlocks only reads the blocked boolean — never capture_mode', () => {
  // capture_mode (observe/block_critical/hold) is separate, tracked work. A row
  // with a strict capture_mode but blocked:false must not become a block.
  assert.deepEqual(synthesizePlatformBlocks([
    { host: 'claude.ai', product: 'Claude', blocked: false, capture_mode: 'hold' },
  ]), []);
  // …and truthy-but-not-true is not enough either (the server returns a real
  // boolean via rowToJson; anything else means something upstream changed).
  assert.deepEqual(synthesizePlatformBlocks([{ host: 'claude.ai', blocked: 1 }]), []);
});

test('synthesizePlatformBlocks falls back vendor → host for the display name', () => {
  // Keyed by row rather than by index: claude.ai now yields TWO rows (the
  // desktop process AND the Claude Code panel), and both take the same name.
  const rows = synthesizePlatformBlocks([
    { host: 'claude.ai',  vendor: 'Anthropic', product: null, blocked: true },
    { host: 'chatgpt.com', vendor: null,       product: null, blocked: true },
  ]);
  for (const row of rows.filter((r) => r.host === 'claude.ai')) {
    assert.equal(row.agent_name, 'Anthropic', 'vendor is the first fallback');
  }
  assert.equal(rows.find((r) => r.host === 'chatgpt.com').agent_name, 'chatgpt.com', 'host is the last fallback');
});

test('the AI and IDE catalogs stay separate, and Cursor dual membership is deliberate', () => {
  // The privacy-scoping guarantee: AI_PROCESSES drives aiProcNames, which is
  // handed to the clipboard poller and the attachment-chip / file-dialog /
  // prompt-text watchers. An IDE name in there turns those on across the whole
  // editor. The keystroke enforcer gets IDE names via its OWN env var instead.
  const aiNames = AI_PROCESSES.map((e) =>
    e.match.source.replace(/^\^/, '').replace(/\$$/, '').replace(/[\\/]i?$/, '').toLowerCase(),
  );
  const ideNames = IDE_PROCESSES.map((e) =>
    e.match.source.replace(/^\^/, '').replace(/\$$/, '').replace(/[\\/]i?$/, '').toLowerCase(),
  );
  assert.deepEqual(ideNames, ['code', 'cursor']);
  // VS Code must NOT be in the AI catalog — that is what keeps the passive
  // watchers out of the editor entirely.
  assert.equal(aiNames.includes('code'), false, '"Code" in AI_PROCESSES would turn on clipboard/attachment watching across VS Code');
  assert.equal(identifyAiProcess('Code'), null);
  assert.equal(hostForProcess('Code'), null);
  // Cursor IS in both, deliberately — but as of the 2026-08-25 decision its IDE
  // entry carries panelFallback:false, so that dual membership is now LATENT
  // rather than an active path: UpdateForeground checks the IDE catalog first,
  // and its whole-app branch (`_ideFallbackProcs.Contains(proc) &&
  // _aiProcs.Contains(proc)`) can never be satisfied for a process whose
  // panelFallback is false, because such a process is never added to
  // _ideFallbackProcs at all. Cursor is therefore scoped to its AI composer only,
  // exactly like Claude Code — typing in its editor or terminal is not scanned.
  // The AI_PROCESSES entry stays because (a) it is what `host: 'cursor.com'`
  // resolution, the access-exception chain and the passive-watcher flags below
  // are keyed on, and (b) it is the coverage the fallback branch would use if
  // panelFallback were ever flipped back to true.
  assert.equal(aiNames.includes('cursor'), true);
  assert.equal(IDE_PROCESSES.find((e) => e.match.test('cursor')).panelFallback, false);
  // And Cursor's existing AI_PROCESSES flags are untouched by this feature.
  assert.equal(isAttachmentWatcherEligible('Cursor'), false);
  assert.equal(processForHost('cursor.com'), null);
});

test('synthesizePlatformBlocks dedupes hosts that resolve to the same desktop app', () => {
  // Two Copilot hosts, one Copilot process each — distinct, both kept. Two rows
  // for the SAME process collapse: the enforcer stops at the first match, so a
  // duplicate would only be dead weight in the file.
  const rows = synthesizePlatformBlocks([
    { host: 'claude.ai',             product: 'Claude',   blocked: true },
    { host: 'CLAUDE.AI',             product: 'Claude 2', blocked: true },   // same process
    { host: 'copilot.microsoft.com', product: 'Copilot',  blocked: true },
    { host: 'm365.cloud.microsoft',  product: 'M365',     blocked: true },
  ]);
  // claude.ai also contributes its panel row; the two Copilot hosts have no
  // panel. Process and panel keys are namespaced, so they can never collide.
  assert.deepEqual(
    rows.map((r) => r.process_name || 'panel:' + r.panel),
    ['claude', 'panel:claude_code', 'copilot', 'm365copilot'],
  );
  assert.equal(rows[0].agent_name, 'Claude', 'the FIRST row wins a dedup');
});

test('synthesizePlatformBlocks strips the characters that would break the .ps1 JSON parser', () => {
  // enforcer-win.ps1 parses this file with a hand-rolled extractor:
  // ExtractJsonString stops at the first `"`, SplitJsonArray splits on brace
  // depth. One bad admin-typed value would derail parsing of the WHOLE file —
  // silently dropping every OTHER block too, not just its own row.
  const [row] = synthesizePlatformBlocks([{
    host: 'claude.ai',
    product: 'Ev"il\\ {name} \u0007with\ncontrol\tchars',
    blocked: true,
  }]);
  assert.equal(row.agent_name, 'Evil name withcontrolchars');
  for (const value of Object.values(row)) {
    assert.equal(/["\\{}\u0000-\u001f\u007f]/.test(value), false, `unsafe char survived in ${value}`);
  }
  // A round trip through the real serialiser must produce no escapes at all,
  // which is the property the .ps1 extractor actually depends on.
  assert.equal(JSON.stringify(row).includes('\\'), false);
});

test('synthesizePlatformBlocks caps field length and tolerates junk input', () => {
  const [row] = synthesizePlatformBlocks([
    { host: 'claude.ai', product: 'x'.repeat(5000), blocked: true },
  ]);
  assert.equal(row.agent_name.length, 200);
  assert.deepEqual(synthesizePlatformBlocks([]), []);
  assert.deepEqual(synthesizePlatformBlocks(null), []);
  assert.deepEqual(synthesizePlatformBlocks(undefined), []);
  assert.deepEqual(synthesizePlatformBlocks([null, {}, { blocked: true }]), []);
});

test('filterBlockedAgents lifts a synthesised platform block via the row own host', () => {
  // The sentinel has no PLATFORM_PROCS entry by design, so hostsForPlatform
  // returns [] — without the row.host branch an approved exception could never
  // unblock a host-keyed platform block on the desktop.
  const list = [
    ...synthesizePlatformBlocks([
      { host: 'claude.ai',   product: 'Claude',  blocked: true },
      { host: 'chatgpt.com', product: 'ChatGPT', blocked: true },
    ]),
    { agent_id: 'a1', agent_name: 'Team GPT', platform: 'openai_assistant' },
  ];
  // One approval for claude.ai lifts EVERY claude.ai row — the desktop process
  // row and the Claude Code panel row alike, which is the point of keying
  // exceptions on the host rather than on the process or panel. chatgpt.com
  // appears TWICE here — see processesForHost: ChatGPT Desktop ships under two
  // different process names ("ChatGPT" and "ChatGPT Classic"), so one host
  // now correctly synthesises one row per process name, not just the first.
  const kept = filterBlockedAgents(list, [{ tool_host: 'CLAUDE.AI' }]);
  assert.deepEqual(kept.map((r) => r.host || r.agent_id), ['chatgpt.com', 'chatgpt.com', 'a1']);
  // An exception for the agent-block row's platform host still lifts only that
  // row — the host-keyed chatgpt.com platform row is a separate decision.
  assert.deepEqual(
    filterBlockedAgents(list, [{ tool_host: 'chatgpt.com' }]).map((r) => (r.host || r.agent_id) + (r.panel ? '/' + r.panel : '')),
    ['claude.ai', 'claude.ai/claude_code'],
  );
});

// ── Agent surfaces: which named agent is open inside one AI app ─────────────
//
// A blocked_agents row names ONE agent ({ agent_name: "AI Learning Advisor",
// platform: "personal_agent" }), but the desktop enforcer matched it against the
// whole PROCESS set the platform maps to and used agent_name only as display
// text. Blocking one agent therefore disabled the entire Microsoft 365 Copilot
// app — generic Copilot chat and every other agent in it included.
//
// The pure half of the fix lives here; the C# port in enforcer-win.ps1
// (ExtractAgentName / AgentNameMatches) must stay in lockstep with it, and
// os-monitor-safety.test.mjs pins the .ps1 side.

// The MEASURED live values (2026-08, read-only UIA probe of a real Microsoft 365
// Copilot window). The WINDOW TITLE is useless — always the static "Microsoft
// 365 Copilot" — and is used by nothing.
const M365_GENERIC = { process: 'M365Copilot', controlType: 'Edit', name: 'Message Copilot' };
const M365_ADVISOR = { process: 'M365Copilot', controlType: 'Edit', name: 'Message AI Learning Advisor' };

test('the M365Copilot surface is live-verified and enforcing — enforce:true AND verified:true', () => {
  // Verified live on 2026-08-27 against a real Microsoft 365 Copilot install with
  // a real added agent ("AI Learning Advisor"): only that agent was blocked, the
  // Request Access modal named it rather than the whole app, and generic Copilot
  // chat plus a different agent kept sending. Duplicated deliberately in
  // os-monitor-safety.test.mjs, which is the file a reviewer reads for safety
  // invariants.
  const m365 = AGENT_SURFACES.find((s2) => s2.id === 'm365_copilot');
  assert.ok(m365, 'the m365_copilot surface is missing');
  assert.equal(m365.enforce, true);
  assert.equal(m365.verified, true);
  // The locale limitation is modelled as DATA, so adding a language is adding an
  // array element rather than editing the C#.
  assert.deepEqual(m365.composerNamePrefixes, ['Message ']);
  assert.deepEqual(m365.genericNames, ['Copilot']);
});

test('the safety gate holds for every entry: nothing may enforce without being verified', () => {
  // The general rule, stated over the whole catalog rather than over one entry, so
  // it keeps covering FUTURE surfaces after m365_copilot stopped being the
  // unverified example. A new entry ships enforce:false/verified:false — matched
  // and unit-tested, arming nothing — until a human runs its own live pass.
  // enforcer-win.ps1's EnforcingAgentSurface() requires BOTH flags, so an
  // enforce:true/verified:false entry would be a catalog author claiming a live
  // pass that never happened.
  for (const surface of AGENT_SURFACES) {
    assert.equal(typeof surface.enforce, 'boolean', `${surface.id} must state enforce explicitly`);
    assert.equal(typeof surface.verified, 'boolean', `${surface.id} must state verified explicitly`);
    if (surface.enforce) {
      assert.equal(surface.verified, true, `${surface.id} enforces without a recorded live verification`);
    }
    // Every entry needs something to match on, verified or not — a surface with
    // no prefix can never read a name and would silently narrow nothing.
    assert.ok(Array.isArray(surface.composerNamePrefixes) && surface.composerNamePrefixes.length > 0, surface.id);
    assert.ok(Array.isArray(surface.genericNames), surface.id);
  }
});

test('agentSurfaceForProcess matches on the process name, case- and .exe-insensitively', () => {
  for (const proc of ['M365Copilot', 'm365copilot', 'M365Copilot.exe', ' M365Copilot ']) {
    assert.equal(agentSurfaceForProcess(proc)?.id, 'm365_copilot', proc);
  }
  // Copilot STANDALONE is a different process and has no surface: PLATFORM_PROCS
  // maps personal_agent to both, so a row covering it must still fall back to a
  // whole-app block there rather than silently narrowing.
  assert.equal(agentSurfaceForProcess('Copilot'), null);
  for (const proc of ['ChatGPT', 'Claude', 'Code', 'notepad', '', null, undefined]) {
    assert.equal(agentSurfaceForProcess(proc), null, String(proc));
  }
});

test('extractAgentName reads the agent name off the composer, with Generic first', () => {
  // The whole read signal, on the measured values.
  assert.equal(extractAgentName(M365_ADVISOR), 'AI Learning Advisor');
  assert.equal(extractAgentName(M365_GENERIC), AGENT_NAME_GENERIC);
  // Generic is matched case-insensitively and after whitespace normalisation, so
  // a UI that pads or re-cases the label still resolves to "no agent open".
  assert.equal(extractAgentName({ ...M365_GENERIC, name: 'Message   copilot' }), AGENT_NAME_GENERIC);
  // Whitespace in a real name is normalised, not lost.
  assert.equal(extractAgentName({ ...M365_ADVISOR, name: 'Message  AI  Learning   Advisor  ' }), 'AI Learning Advisor');
  // A non-breaking space is what a web-hosted ARIA label routinely carries.
  assert.equal(extractAgentName({ ...M365_ADVISOR, name: 'Message AI\u00a0Learning Advisor' }), 'AI Learning Advisor');
});

test('extractAgentName treats anything it cannot read as NO EVIDENCE, never as "no agent"', () => {
  // Every one of these must be NotComposer, not Generic: reporting "no specific
  // agent is open" off a read that established nothing would tear a live block
  // down on the first bad tick.
  const notComposer = [
    // Wrong control type — the transcript, a button, a list.
    { ...M365_ADVISOR, controlType: 'Document' },
    { ...M365_ADVISOR, controlType: '' },
    { ...M365_ADVISOR, controlType: null },
    // No recognised prefix: a different composer, a search box, a non-English UI.
    { ...M365_ADVISOR, name: 'Search agents' },
    { ...M365_ADVISOR, name: 'Nachricht an AI Learning Advisor' },
    // The prefix and nothing after it.
    { ...M365_ADVISOR, name: 'Message ' },
    { ...M365_ADVISOR, name: 'Message' },
    { ...M365_ADVISOR, name: 'Message    ' },
    { ...M365_ADVISOR, name: '' },
    { ...M365_ADVISOR, name: null },
    // A process with no surface at all.
    { process: 'ChatGPT', controlType: 'Edit', name: 'Message ChatGPT' },
    { process: '', controlType: 'Edit', name: 'Message Copilot' },
  ];
  for (const focused of notComposer) {
    assert.equal(extractAgentName(focused), AGENT_NAME_NOT_COMPOSER, JSON.stringify(focused));
  }
  // Never throws: every input comes from another process's accessibility tree.
  assert.equal(extractAgentName(null), AGENT_NAME_NOT_COMPOSER);
  assert.equal(extractAgentName(undefined), AGENT_NAME_NOT_COMPOSER);
  assert.equal(extractAgentName({}), AGENT_NAME_NOT_COMPOSER);
});

test('agentNameMatches is WHOLE-STRING, not the substring test the extension uses', () => {
  assert.equal(agentNameMatches('AI Learning Advisor', 'AI Learning Advisor'), true);
  // Normalised on BOTH sides.
  assert.equal(agentNameMatches('ai learning advisor', 'AI Learning Advisor'), true);
  assert.equal(agentNameMatches('AI  Learning Advisor', ' AI Learning Advisor '), true);
  // The looseness this deliberately does NOT have. The browser extension's
  // enforceBlockedAgent() substring-matches because its signal (a name found
  // somewhere in a page header) is much messier; here the signal is an exact
  // composer label, so a row for "Advisor" must not block "AI Learning Advisor".
  assert.equal(agentNameMatches('AI Learning Advisor', 'Advisor'), false);
  assert.equal(agentNameMatches('Advisor', 'AI Learning Advisor'), false);
  assert.equal(agentNameMatches('AI Learning Advisor 2', 'AI Learning Advisor'), false);
  // A sentinel outcome can never match anything, including a row that happens to
  // be named like one.
  assert.equal(agentNameMatches(AGENT_NAME_GENERIC, 'Copilot'), false);
  assert.equal(agentNameMatches(AGENT_NAME_GENERIC, AGENT_NAME_GENERIC), false);
  assert.equal(agentNameMatches(AGENT_NAME_NOT_COMPOSER, AGENT_NAME_NOT_COMPOSER), false);
  // Empty on either side is never a match — the fail-closed direction here is to
  // NOT narrow, which leaves the whole-app block in place.
  for (const [a, b] of [['', 'x'], ['x', ''], [null, 'x'], ['x', null], ['  ', 'x'], [undefined, undefined]]) {
    assert.equal(agentNameMatches(a, b), false, `${a} / ${b}`);
  }
});

test('an agent literally named "Copilot" can never be matched through this mechanism', () => {
  // Intentional: the Generic filter runs BEFORE matching, and a platform-scoped
  // row is the right tool for "block all of Copilot".
  assert.equal(agentNameMatches(extractAgentName(M365_GENERIC), 'Copilot'), false);
});

test('buildAgentSurfaceConfig serialises the catalog without aliasing it', () => {
  const [entry] = buildAgentSurfaceConfig();
  assert.deepEqual(entry, {
    id: 'm365_copilot',
    procs: ['M365Copilot'],
    controlType: 'Edit',
    composerNamePrefixes: ['Message '],
    genericNames: ['Copilot'],
    enforce: true,
    verified: true,
  });
  // Copies, so a consumer mutating the payload cannot reach back into the catalog.
  entry.procs.push('Notepad');
  entry.composerNamePrefixes.push('x');
  assert.deepEqual(AGENT_SURFACES[0].procs, ['M365Copilot']);
  assert.deepEqual(AGENT_SURFACES[0].composerNamePrefixes, ['Message ']);
});

// ── normalizeAgentRows: the transport the matching key has to survive ───────
//
// enforcer-win.ps1 parses blocked-agents.json with a hand-rolled extractor that
// derails on the WHOLE FILE for one stray quote/backslash/brace in one value,
// silently dropping every other block too. synthesizePlatformBlocks has always
// sanitised its admin-typed fields; the server's per-agent rows were sent RAW.
// That only risked a corrupted display string before — now agent_name is the
// MATCHING KEY, and Agent Store display names are free text.

test('normalizeAgentRows strips the characters that derail the .ps1 parser', () => {
  const [row] = normalizeAgentRows([{
    agent_id: 'a1',
    agent_name: 'Say "hello"\\ {now}',
    platform: 'personal_agent',
    reason: 'Blocked "by" admin',
  }]);
  assert.equal(row.agent_name, 'Say hello now');
  assert.equal(row.reason, 'Blocked by admin');
  assert.equal(row.platform, 'personal_agent');
});

test('normalizeAgentRows DOWNGRADES an agent-scoped row whose name cannot survive', () => {
  // A name the enforcer could never match would mean an agent-scoped block that
  // silently enforces nothing. Falling back to platform scope restores the
  // whole-app block, which is the fail-closed answer.
  const warnings = [];
  const logger = { warn: (m) => warnings.push(m) };
  const [row] = normalizeAgentRows([{
    agent_id: 'a1', agent_name: 'Advisor "Prime"', platform: 'personal_agent', agent_scope: 'agent',
  }], logger);
  assert.equal(row.agent_scope, null, 'a sanitised-away name must not stay agent-scoped');
  assert.equal(row.agent_name, 'Advisor Prime');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /downgraded to platform scope/);

  // A name that survives intact keeps its scope, including one whose only change
  // is whitespace the matcher normalises on both sides anyway.
  const kept = normalizeAgentRows([
    { agent_id: 'a2', agent_name: 'AI Learning Advisor', platform: 'personal_agent', agent_scope: 'agent' },
    { agent_id: 'a3', agent_name: '  AI  Learning Advisor  ', platform: 'personal_agent', agent_scope: 'agent' },
  ]);
  assert.deepEqual(kept.map((r) => r.agent_scope), ['agent', 'agent']);

  // Too short to be a name at all after sanitising — same downgrade.
  const [tiny] = normalizeAgentRows([{ agent_id: 'a4', agent_name: '"{}"', platform: 'personal_agent', agent_scope: 'agent' }]);
  assert.equal(tiny.agent_scope, null);
  // A PLATFORM-scoped row is never downgraded (there is nothing to downgrade to)
  // and its name is still sanitised.
  const [plat] = normalizeAgentRows([{ agent_id: 'a5', agent_name: 'Bad "name"', platform: 'personal_agent', agent_scope: 'platform' }]);
  assert.equal(plat.agent_scope, 'platform');
  assert.equal(plat.agent_name, 'Bad name');
});

test('normalizeAgentRows normalises agent_scope to the enum, or to null', () => {
  const rows = normalizeAgentRows([
    { agent_id: '1', agent_name: 'A One', agent_scope: 'agent' },
    { agent_id: '2', agent_name: 'A Two', agent_scope: 'AGENT' },
    { agent_id: '3', agent_name: 'A Three', agent_scope: ' platform ' },
    { agent_id: '4', agent_name: 'A Four' },
    { agent_id: '5', agent_name: 'A Five', agent_scope: null },
    { agent_id: '6', agent_name: 'A Six', agent_scope: '' },
    // Anything unrecognised must land on the WIDE side, never silently narrow.
    { agent_id: '7', agent_name: 'A Seven', agent_scope: 'Agent ' },
    { agent_id: '8', agent_name: 'A Eight', agent_scope: 'everything' },
  ]);
  assert.deepEqual(rows.map((r) => r.agent_scope),
    ['agent', 'agent', 'platform', null, null, null, 'agent', null]);
  // The field is always PRESENT, so the .ps1 never has to distinguish absent from
  // null — it extracts "" for both anyway.
  for (const r of rows) assert.ok('agent_scope' in r);
});

test('normalizeAgentRows leaves non-string fields alone and never throws', () => {
  // Booleans/numbers/dates cannot carry a character the parser chokes on, and
  // coercing them would change the file's shape for no benefit.
  const [row] = normalizeAgentRows([{
    agent_id: 'a1', agent_name: 'A One', blocked: true, orphaned: false, count: 3, oauth_key_id: null,
  }]);
  assert.equal(row.blocked, true);
  assert.equal(row.orphaned, false);
  assert.equal(row.count, 3);
  assert.equal(row.oauth_key_id, null);
  // Junk in, no throw: this runs on the blocked-agents poll path.
  assert.deepEqual(normalizeAgentRows(null), []);
  assert.deepEqual(normalizeAgentRows(undefined), []);
  assert.deepEqual(normalizeAgentRows('nope'), []);
  assert.deepEqual(normalizeAgentRows([null, undefined, 'x', 7]), []);
  // Input rows are not mutated — the caller still holds the server's payload.
  const input = [{ agent_id: 'a1', agent_name: 'Bad "name"', agent_scope: 'agent' }];
  normalizeAgentRows(input);
  assert.equal(input[0].agent_name, 'Bad "name"');
  assert.equal(input[0].agent_scope, 'agent');
});

test('a normalised row can never break out of the .ps1 string extractor', () => {
  // The actual invariant, stated as a property rather than a case list: no value
  // written to blocked-agents.json may contain a quote, a backslash, a brace or a
  // control character, because any one of them derails the parse of the whole
  // file. Long values are truncated for the same reason.
  const nasty = 'x"y\\z{a}b\u0000c\u001fd' + 'p'.repeat(400);
  const [row] = normalizeAgentRows([{
    agent_id: nasty, agent_name: nasty, platform: nasty, reason: nasty, host: nasty, agent_scope: 'agent',
  }]);
  for (const [key, value] of Object.entries(row)) {
    if (typeof value !== 'string') continue;
    assert.equal(/["\\{}\u0000-\u001f\u007f]/.test(value), false, `${key} kept a parser-breaking character`);
    assert.ok(value.length <= 200, `${key} was not truncated`);
  }
});

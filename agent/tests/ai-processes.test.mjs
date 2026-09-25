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
  matchPanelSignature,
  isAttachmentWatcherEligible,
  shouldScrubClipboardFor,
  identifyAiProcess,
  hostForProcess,
  hostsForPlatform,
  filterBlockedAgents,
  processForHost,
  processesForHost,
  watcherProcessNames,
  synthesizePlatformBlocks,
  PLATFORM_BLOCK_SENTINEL,
  AGENT_SURFACES,
  AGENT_NAME_GENERIC,
  AGENT_NAME_NOT_COMPOSER,
  agentSurfaceForProcess,
  extractAgentName,
  extractAgentNameFromTitle,
  extractAgentNameFromHeading,
  titleKindOf,
  looksLikeParticipantList,
  agentNameMatches,
  normalizeAgentRows,
  normalizeGovernedRows,
  filterGovernedAgents,
  buildAgentSurfaceConfig,
  AI_PANELS,
  panelForHost,
  EGRESS_SURFACES,
  EGRESS_SYNC_ROOTS,
  EGRESS_SEND_CHORDS,
  normalizeEgressSendKeys,
  egressSurfaceForProcess,
  isEgressProcess,
  buildEgressSurfaceConfig,
  synthesizeEgressSurfaces,
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
  // copilot_studio is reachable through two Copilot builds AND inside Microsoft
  // Teams — a Copilot Studio agent is added to Teams as a chat participant, so
  // teams.microsoft.com is a real desktop reach for it. Same for personal_agent.
  assert.deepEqual(hostsForPlatform('copilot_studio'),
    ['copilot.microsoft.com', 'm365.cloud.microsoft', 'teams.microsoft.com']);
  assert.deepEqual(hostsForPlatform('personal_agent'),
    ['copilot.microsoft.com', 'm365.cloud.microsoft', 'teams.microsoft.com']);
  // teams_chat_agent is Teams-only. This is what lets an admin's approved
  // teams.microsoft.com exception actually lift a Teams agent block on the
  // desktop, via filterBlockedAgents.
  assert.deepEqual(hostsForPlatform('teams_chat_agent'), ['teams.microsoft.com']);
  for (const platform of Object.keys(PLATFORM_PROCS)) {
    assert.ok(hostsForPlatform(platform).length > 0, `${platform} maps to no host`);
  }
  // An unknown platform yields nothing, which callers must read as "no
  // exception can apply" — never as "unblock it".
  assert.deepEqual(hostsForPlatform('not_a_platform'), []);
  assert.deepEqual(hostsForPlatform(undefined), []);
});

test('a host app resolves to a host but never to a blockable process', () => {
  // The whole asymmetry of `hostApp`, stated in one place.
  //
  // hostForProcess MUST resolve — that is what puts teams.microsoft.com on the
  // access-exception chain, and it is the only reason ms-teams is in
  // AI_PROCESSES at all.
  assert.equal(hostForProcess('ms-teams'), 'teams.microsoft.com');
  assert.equal(hostForProcess('ms-teams.exe'), 'teams.microsoft.com');
  assert.equal(hostForProcess('MS-Teams'), 'teams.microsoft.com');
  // The REVERSE must not. A process_name:'ms-teams' row in blocked-agents.json
  // is matched process-WIDE by enforcer-win.ps1: it would swallow Enter in every
  // DM, channel and meeting chat because an admin toggled a host in Inventory.
  assert.equal(processForHost('teams.microsoft.com'), null);
  assert.deepEqual(processesForHost('teams.microsoft.com'), []);
  // …so an Inventory block on the host synthesizes no desktop row at all.
  assert.deepEqual(
    synthesizePlatformBlocks([{ host: 'teams.microsoft.com', product: 'Microsoft Teams', vendor: 'Microsoft', blocked: true }]),
    [],
  );
  // And the flag is declared exactly where the docs say it is.
  const teams = AI_PROCESSES.find((e) => e.product === 'Microsoft Teams');
  assert.ok(teams, 'the Microsoft Teams entry is missing');
  assert.equal(teams.hostApp, true);
  assert.deepEqual(AI_PROCESSES.filter((e) => e.hostApp === true).map((e) => e.product), ['Microsoft Teams']);
});

test('a host app never reaches the passive watchers', () => {
  // THE privacy property of the host-app feature. Microsoft Teams in the watcher
  // list would turn on clipboard scanning, attachment-chip watching and
  // prompt-text reading across a company's whole communications client — every
  // DM and every channel — which is exactly what the narrow agent-conversation
  // scoping exists to avoid. Same separation, same reason, as IDE_PROCESSES.
  const names = watcherProcessNames();
  assert.ok(names.length > 0);
  for (const name of names) {
    assert.equal(name.toLowerCase() === 'ms-teams', false, 'ms-teams must never reach a passive watcher');
  }
  // It is exactly the catalog minus the host apps — no other entry was dropped.
  const expected = AI_PROCESSES
    .filter((e) => e.hostApp !== true)
    .map((e) => e.match.source.replace(/^\^/, '').replace(/\$$/, '').replace(/[\\/]i?$/, ''));
  assert.deepEqual(names, expected);
  assert.equal(names.length, AI_PROCESSES.length - 1);
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

// ── Scope-aware exception subtraction ───────────────────────────────────────
// /access-exceptions/mine now carries scope ('host' | 'agent'), agent_id and
// agent_name. An agent-scoped approval must lift ONE agent and leave every
// other blocked agent on the same host blocked — the desktop mirror of the
// server's own /access-exceptions/check, which answers allowed:false for an
// agent it has no grant for even when a different agent on that host is
// approved. A host-scoped (or scope-less, i.e. pre-existing) approval must keep
// lifting everything, unchanged.

test('filterBlockedAgents: an agent-scoped exception lifts only that agent', () => {
  const list = [
    { agent_id: 'ag-1', agent_name: 'IT Help Desk Agent', platform: 'teams_chat_agent', agent_scope: 'agent' },
    { agent_id: 'ag-2', agent_name: 'Finance Bot',        platform: 'teams_chat_agent', agent_scope: 'agent' },
  ];
  const kept = filterBlockedAgents(list, [
    { tool_host: 'teams.microsoft.com', scope: 'agent', agent_id: 'ag-1', agent_name: 'IT Help Desk Agent' },
  ]);
  assert.deepEqual(kept.map((r) => r.agent_id), ['ag-2'],
    'the other agent on the same host must stay blocked');
});

test('filterBlockedAgents: an agent-scoped exception never lifts a whole-platform row', () => {
  // The important one. A row with no agent_scope is "all of this app is
  // disallowed" — either a synthesised Inventory platform block or a per-agent
  // row normalizeAgentRows downgraded because its name could not survive the
  // enforcer transport. Neither is what "approve the IT help-desk bot" granted,
  // even though the agent_name on the coarse row can match perfectly.
  //
  // chatgpt.com rather than a Teams host on purpose: Teams is a HOST APP, so
  // processesForHost refuses to synthesize a whole-process row for it at all
  // (blocking a company's chat client off an Inventory toggle), and this case
  // needs a host that really does produce one.
  const list = [
    { agent_id: 'ag-1', agent_name: 'Team GPT', platform: 'openai_assistant' },              // downgraded
    { agent_id: 'ag-1', agent_name: 'Team GPT', platform: 'openai_assistant', agent_scope: 'platform' },
    ...synthesizePlatformBlocks([{ host: 'chatgpt.com', product: 'Team GPT', blocked: true }]),
  ];
  // The synthesised rows even carry the SAME agent_name (and no agent_id), so
  // nothing but the missing agent_scope keeps them blocked.
  assert.ok(list.length > 2, 'expected the Inventory bridge to synthesize a row here');
  const kept = filterBlockedAgents(list, [
    { tool_host: 'chatgpt.com', scope: 'agent', agent_id: 'ag-1', agent_name: 'Team GPT' },
  ]);
  assert.deepEqual(kept, list, 'an agent-scoped grant must subtract nothing here');
});

test('filterBlockedAgents: an agent-scoped exception matches on the normalized name when either side has no id', () => {
  const list = [
    { agent_name: 'IT Help  Desk Agent', platform: 'personal_agent', agent_scope: 'agent' },
    { agent_name: 'Finance Bot',         platform: 'personal_agent', agent_scope: 'agent' },
  ];
  // Doubled space + different case on the row, no agent_id on either side.
  const kept = filterBlockedAgents(list, [
    { tool_host: 'M365.CLOUD.MICROSOFT', scope: 'agent', agent_id: null, agent_name: 'it help desk agent' },
  ]);
  assert.deepEqual(kept.map((r) => r.agent_name), ['Finance Bot']);

  // …and an id on BOTH sides is decisive: a name collision cannot widen it.
  const byId = [
    { agent_id: 'ag-1', agent_name: 'Shared Name', platform: 'personal_agent', agent_scope: 'agent' },
    { agent_id: 'ag-2', agent_name: 'Shared Name', platform: 'personal_agent', agent_scope: 'agent' },
  ];
  assert.deepEqual(
    filterBlockedAgents(byId, [
      { tool_host: 'm365.cloud.microsoft', scope: 'agent', agent_id: 'ag-2', agent_name: 'Shared Name' },
    ]).map((r) => r.agent_id),
    ['ag-1'],
  );
});

test('filterBlockedAgents: an agent-scoped exception for a DIFFERENT host lifts nothing', () => {
  const list = [
    { agent_id: 'ag-1', agent_name: 'IT Help Desk Agent', platform: 'teams_chat_agent', agent_scope: 'agent' },
  ];
  assert.deepEqual(
    filterBlockedAgents(list, [
      { tool_host: 'chatgpt.com', scope: 'agent', agent_id: 'ag-1', agent_name: 'IT Help Desk Agent' },
    ]),
    list,
  );
});

test('filterBlockedAgents: an agent-scoped exception naming no agent lifts nothing', () => {
  // It cannot match an agent, and it must NOT fall back to lifting the host —
  // that widening is the security bug the server removed.
  const list = [
    { agent_id: 'ag-1', agent_name: 'IT Help Desk Agent', platform: 'teams_chat_agent', agent_scope: 'agent' },
    { agent_id: 'ag-2', agent_name: 'Finance Bot',        platform: 'teams_chat_agent' },
  ];
  assert.deepEqual(
    filterBlockedAgents(list, [{ tool_host: 'teams.microsoft.com', scope: 'agent', agent_id: null, agent_name: null }]),
    list,
  );
});

test('REGRESSION: a host-scoped or legacy exception still lifts every row for that host', () => {
  // Byte-for-byte the pre-agent-scope behaviour, for all three shapes an
  // exception row can arrive in: scope:'host', scope absent (every approval
  // granted before the field existed), and scope:null.
  const list = [
    { agent_id: 'ag-1', agent_name: 'Team GPT',   platform: 'openai_assistant', agent_scope: 'agent' },
    { agent_id: 'ag-2', agent_name: 'Custom GPT', platform: 'custom_gpt' },
    ...synthesizePlatformBlocks([{ host: 'chatgpt.com', product: 'ChatGPT', blocked: true }]),
    { agent_id: 'ag-3', agent_name: 'IT Help Desk Agent', platform: 'teams_chat_agent', agent_scope: 'agent' },
  ];
  for (const ex of [
    { tool_host: 'chatgpt.com', scope: 'host' },
    { tool_host: 'chatgpt.com' },
    { tool_host: 'chatgpt.com', scope: null },
    // An unrecognised scope must land on the WIDE branch, never silently
    // narrow an approval an admin already made into "nothing was lifted".
    { tool_host: 'chatgpt.com', scope: 'something_new' },
  ]) {
    assert.deepEqual(
      filterBlockedAgents(list, [ex]).map((r) => r.agent_id),
      ['ag-3'],
      `scope=${JSON.stringify(ex.scope)}`,
    );
  }
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
  // …and the flag really is what draws that line today. Microsoft Teams is
  // excluded twice over — by this flag AND by its own `hostApp` guard, which is
  // deliberate belt-and-braces: flipping useAttachmentWatcher on a host app
  // later must not quietly re-enable whole-app blocking for it.
  const excluded = AI_PROCESSES.filter((e) => e.useAttachmentWatcher === false).map((e) => e.product);
  assert.deepEqual(excluded, ['Cursor', 'GitHub Copilot', 'Microsoft Teams']);
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
  // The Office hosts of the Microsoft 365 Copilot side pane live here and ONLY
  // here, for the same reason VS Code does: an Office name in AI_PROCESSES would
  // turn on clipboard scanning and attachment-chip watching across the whole app
  // and report every document a user opens as an AI file upload.
  assert.deepEqual(ideNames, ['code', 'cursor', 'winword', 'excel', 'powerpnt', 'onenote', 'onenoteim', 'outlook', 'olk']);
  for (const name of ['winword', 'excel', 'powerpnt', 'onenote', 'onenoteim']) {
    assert.equal(aiNames.includes(name), false, `"${name}" in AI_PROCESSES would turn on the passive watchers across an Office app`);
    assert.equal(identifyAiProcess(name), null);
    assert.equal(hostForProcess(name), null);
  }
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
  // claude.ai also contributes its panel row, and so does m365.cloud.microsoft
  // now that office_copilot_pane carries that host (the pane IS Microsoft 365
  // Copilot inside an Office app — see ai-panels.test.mjs for the reasoning and
  // for the safety property that no OFFICE PROCESS row is ever synthesized).
  // copilot.microsoft.com is the standalone client only and has no panel.
  // Process and panel keys are namespaced, so they can never collide.
  assert.deepEqual(
    rows.map((r) => r.process_name || 'panel:' + r.panel),
    ['claude', 'panel:claude_code', 'copilot', 'm365copilot', 'panel:office_copilot_pane', 'panel:outlook_copilot_pane'],
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
    // nothing to read a name FROM can never narrow anything, and would ship as a
    // silent no-op. Which fields those are depends on the read mode, and the
    // absence of `read` must keep meaning the original composer-name mode.
    // 'composer_name' is the ORIGINAL mode stated out loud (office_copilot_pane_agent
    // does; m365_copilot leaves it absent and means the same thing). Both spellings
    // are accepted here for exactly that reason — buildAgentSurfaceConfig and the C#
    // both normalise anything that is not 'window_title' to 'composer_name'.
    assert.ok(surface.read === undefined || surface.read === 'composer_name' || surface.read === 'window_title',
      `${surface.id}: unknown read mode '${surface.read}'`);
    if (surface.read === 'window_title') {
      assert.ok(surface.titleSeparator, `${surface.id} has no titleSeparator`);
      assert.ok(surface.titleSuffix, `${surface.id} has no titleSuffix`);
      assert.ok(Array.isArray(surface.titleKinds) && surface.titleKinds.length > 0, `${surface.id} has no titleKinds`);
    } else {
      assert.ok(Array.isArray(surface.composerNamePrefixes) && surface.composerNamePrefixes.length > 0, surface.id);
    }
    assert.ok(Array.isArray(surface.genericNames), surface.id);
  }
});

test('teams_desktop ships VERIFIED and ENFORCING, reads the title, and never falls back to a whole-app block', () => {
  const teams = AGENT_SURFACES.find((s) => s.id === 'teams_desktop');
  assert.ok(teams, 'the teams_desktop surface is missing');
  // Live-verified 2026-08-30 against a real Microsoft Teams desktop install with
  // a real blocked Copilot Studio agent ("IT Help Desk Agent"): the send was
  // swallowed only in that agent's conversation, while a 1:1 DM, a group chat and
  // a channel post all sent normally, and switching away from the agent released
  // the block while switching back re-armed it. Both flags true means
  // enforcer-win.ps1 reads the title and arms the agent-scoped block for Teams.
  assert.equal(teams.enforce, true);
  assert.equal(teams.verified, true);
  // The discriminator, and the measured title grammar behind it.
  assert.equal(teams.read, 'window_title');
  assert.equal(teams.titleSeparator, ' | ');
  assert.equal(teams.titleSuffix, 'Microsoft Teams');
  assert.deepEqual(teams.titleKinds, ['Chat']);
  // THE inversion. For an AI-only app "cannot tell which agent is open" safely
  // means "block the whole app". For a general-purpose communications client it
  // would mean the user cannot message a colleague, so it must mean "block
  // nothing" instead.
  assert.equal(teams.hostApp, true);
  // …and host-app status stays a deliberate, enumerated opt-in. The second entry
  // is the Microsoft 365 Copilot pane inside desktop Office, where the same
  // inversion applies with a bigger blast radius: "cannot tell which agent is
  // open" must never become "nobody in the org may use Word".
  assert.deepEqual(AGENT_SURFACES.filter((s) => s.hostApp === true).map((s) => s.id),
    ['teams_desktop', 'office_copilot_pane_agent']);
  // Teams is NOT panel-hosted and Office is: the flag that decides whether a host
  // app also loses its element-scoped mechanisms (see _panelHostAppProcs in
  // enforcer-win.ps1) is likewise enumerated, never inferred.
  assert.equal(teams.panelHosted, undefined, 'teams_desktop is not panel-hosted');
  assert.deepEqual(AGENT_SURFACES.filter((s) => s.panelHosted === true).map((s) => s.id),
    ['office_copilot_pane_agent']);
  // m365_copilot is completely untouched by the new fields existing.
  const m365 = AGENT_SURFACES.find((s) => s.id === 'm365_copilot');
  assert.equal(m365.read, undefined, 'm365_copilot must not gain a read mode');
  assert.equal(m365.hostApp, undefined, 'm365_copilot must not become a host app');
  assert.equal(m365.titleSeparator, undefined);
});

test('office_copilot_pane_agent ships INERT, fails OPEN, and never turns Office into an AI app', () => {
  const office = AGENT_SURFACES.find((s) => s.id === 'office_copilot_pane_agent');
  assert.ok(office, 'the office_copilot_pane_agent surface is missing');

  // THE SHIPPING STATE. Nothing here has been probed live in a real Office
  // install: the "Message <agent>" composer Name is inferred from the standalone
  // Microsoft 365 Copilot app plus the shared Fluent composer. Both flags false
  // is what makes that safe to ship — matched, unit-tested, arming nothing.
  assert.equal(office.enforce, false, 'a surface nobody has live-probed may not enforce');
  assert.equal(office.verified, false);
  assert.equal(office.fallbackRead.enforce, false, 'the second route ships inert too');
  assert.equal(office.fallbackRead.verified, false);

  // THE FAIL DIRECTION, and the single most important line in the entry. Word,
  // Excel, PowerPoint and OneNote are the company's document editors: "cannot
  // tell which Copilot agent is open" must mean NO BLOCK AT ALL, never a
  // whole-app block. Asserted behaviourally against the real .ps1 in
  // tests/enforcer-panel-block.test.mjs.
  assert.equal(office.hostApp, true);
  // …and the sub-kind that keeps it out of _hostAppProcs, so the live-verified
  // office_copilot_pane panel keeps its panel-keyed block and its Tokenize &
  // Send path. See enforcer-win.ps1's _panelHostAppProcs.
  assert.equal(office.panelHosted, true);

  // The read signal, and the reason it is the composer-name mode rather than
  // Teams' window-title one: an Office window title is the DOCUMENT name.
  assert.equal(office.read, 'composer_name');
  assert.equal(office.titleSeparator, undefined);
  assert.equal(office.controlType, 'Edit');
  assert.deepEqual(office.composerNamePrefixes, ['Message ']);
  assert.deepEqual(office.genericNames, ['Copilot', 'Microsoft 365 Copilot']);
  assert.deepEqual(office.procs, ['WINWORD', 'EXCEL', 'POWERPNT', 'ONENOTE', 'ONENOTEIM']);

  // It reuses the AI_PANELS pane entry's processes exactly — the same surface,
  // asked a second question. A drift here would mean one of the two silently
  // stops covering an app.
  const pane = AI_PANELS.find((p) => p.id === 'office_copilot_pane');
  assert.deepEqual(office.procs, pane.procs.filter((p) => office.procs.includes(p)),
    'the agent-identification entry must track the pane entry it reads off');

  // The pure read, on the inferred shape. Generic first, as everywhere else.
  const focus = (name, process = 'WINWORD') => ({ process, controlType: 'Edit', name });
  assert.equal(extractAgentName(focus('Message Contract Analyzer')), 'Contract Analyzer');
  assert.equal(extractAgentName(focus('Message Copilot')), AGENT_NAME_GENERIC);
  assert.equal(extractAgentName(focus('Message Microsoft 365 Copilot')), AGENT_NAME_GENERIC);
  assert.equal(extractAgentName(focus('Search document')), AGENT_NAME_NOT_COMPOSER);
  // The document body is a Document/Text control, never this composer's Edit.
  assert.equal(extractAgentName({ process: 'WINWORD', controlType: 'Document', name: 'Message Contract Analyzer' }),
    AGENT_NAME_NOT_COMPOSER);
  for (const proc of ['EXCEL', 'POWERPNT', 'ONENOTE', 'ONENOTEIM']) {
    assert.equal(extractAgentName(focus('Message Contract Analyzer', proc)), 'Contract Analyzer', proc);
  }

  // THE PRIVACY PROPERTY, restated for these five processes: an agent surface
  // narrows an existing block, it never widens capture. No Office name may be in
  // AI_PROCESSES or reach a passive watcher — that would report every document a
  // user opens as an AI file upload.
  const watchers = watcherProcessNames().map((n) => n.toLowerCase());
  for (const proc of office.procs) {
    assert.equal(watchers.includes(proc.toLowerCase()), false, `${proc} must never reach a passive watcher`);
    assert.equal(identifyAiProcess(proc), null, `${proc} must not be an AI process`);
    assert.equal(hostForProcess(proc), null, `${proc} must resolve to no blockable host`);
    assert.deepEqual(processesForHost('m365.cloud.microsoft'), ['m365copilot'],
      'the pane cascade stays panel-keyed — no Office process may become process-keyed');
  }
});

test('PLATFORM_PROCS reaches the Office Copilot pane, and never the mail client', () => {
  // Membership is what lets an agent-scoped row COVER the process at all; the
  // hostApp marking above is what stops it becoming a whole-app block there.
  for (const platform of ['copilot_studio', 'personal_agent', 'sharepoint_embedded']) {
    for (const proc of ['WINWORD', 'EXCEL', 'POWERPNT', 'ONENOTE', 'ONENOTEIM']) {
      assert.ok(PLATFORM_PROCS[platform].includes(proc), `${platform} must reach ${proc}`);
    }
    // Every platform still has to resolve to at least one access-exception HOST,
    // or an admin's approved exception could never lift the block. Office
    // processes are (correctly) not in AI_PROCESSES, so a key naming only Office
    // would silently be un-liftable — which is why sharepoint_embedded also
    // names the standalone app.
    assert.ok(hostsForPlatform(platform).includes('m365.cloud.microsoft'), platform);
  }
  assert.deepEqual(PLATFORM_PROCS.sharepoint_embedded,
    ['M365Copilot', 'WINWORD', 'EXCEL', 'POWERPNT', 'ONENOTE', 'ONENOTEIM']);
  // OUTLOOK is an EGRESS surface. It must never appear here — the general rule is
  // asserted over the whole map elsewhere in this file; this pins the one name
  // this change was most likely to add by hand.
  for (const procs of Object.values(PLATFORM_PROCS)) {
    assert.equal(procs.map((p) => p.toLowerCase()).includes('outlook'), false,
      'a mail client must never be reachable by an agent-scoped block');
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
  const [entry, teams] = buildAgentSurfaceConfig();
  // The title fields travel on EVERY entry, empty for a composer-name surface.
  // Stating 'composer_name' explicitly (rather than shipping "") is what keeps
  // the JS default and the C# default the same word in the same place.
  assert.deepEqual(entry, {
    id: 'm365_copilot',
    procs: ['M365Copilot'],
    controlType: 'Edit',
    composerNamePrefixes: ['Message '],
    genericNames: ['Copilot'],
    read: 'composer_name',
    titleSeparator: '',
    titleSuffix: '',
    titleKinds: [],
    titleFullKinds: [],
    hostApp: false,
    panelHosted: false,
    enforce: true,
    verified: true,
    // Tier B's two per-surface write facts. m365_copilot's 1500 is its own
    // catalog value (the 2026-09-21 live not_submitted bug), finally on the wire.
    newlineKeys: 'shift_enter',
    postSendVerifyMs: 1500,
  });
  // The m365_copilot payload carries NO fallbackRead key at all — the nested
  // block is omitted rather than shipped empty, so a surface that never declares
  // a second UI route sends byte-for-byte the payload it always did.
  assert.equal('fallbackRead' in entry, false, 'm365_copilot must not gain a fallbackRead key');
  assert.deepEqual(teams, {
    id: 'teams_desktop',
    procs: ['ms-teams'],
    controlType: 'Edit',
    composerNamePrefixes: [],
    genericNames: ['Copilot', 'Chat', 'Microsoft Teams', 'Meeting chat'],
    read: 'window_title',
    titleSeparator: ' | ',
    titleSuffix: 'Microsoft Teams',
    titleKinds: ['Chat'],
    // Segment 1 names the agent only in the five-segment Copilot form (live 2026-09-24).
    titleFullKinds: ['Copilot'],
    hostApp: true,
    panelHosted: false,
    enforce: true,
    verified: true,
    // No catalog value → the defaults, resolved here exactly as a panel's are.
    // (Teams' composers carry their own 1500 on their AI_PANELS rows, which win.)
    newlineKeys: 'shift_enter',
    postSendVerifyMs: 200,
    // The SECOND UI ROUTE (the embedded Copilot tab), with its OWN two-flag gate
    // — now both true, after that route's own live pass on 2026-09-02. The C#
    // side reaches it only when both are true, so dropping either from the
    // payload would silently move the route to the wrong side of its own gate.
    fallbackRead: {
      mode: 'message_heading',
      paneKinds: ['Copilot'],
      headingClass: 'fai-CopilotMessage__accessibleHeading',
      headingSuffix: ' said:',
      landingInfix: ' Created by ',
      genericNames: ['Copilot', 'Microsoft 365 Copilot', 'You'],
      enforce: true,
      verified: true,
    },
  });
  // The Office pane surface, whose payload is what tells the C# side to put
  // WINWORD/EXCEL/POWERPNT/ONENOTE/ONENOTEIM into _panelHostAppProcs rather than
  // _hostAppProcs. Losing either flag from the payload would move it to the
  // wrong side of a safety gate: hostApp:false would let a row blocking one
  // agent disable Word outright, panelHosted:false would silently retire the
  // live-verified office_copilot_pane panel's own block and rewrite paths.
  const office = buildAgentSurfaceConfig().find((e) => e.id === 'office_copilot_pane_agent');
  assert.equal(office.hostApp, true);
  assert.equal(office.panelHosted, true);
  assert.equal(office.enforce, false);
  assert.equal(office.verified, false);
  assert.equal(office.read, 'composer_name');
  assert.deepEqual(office.procs, ['WINWORD', 'EXCEL', 'POWERPNT', 'ONENOTE', 'ONENOTEIM']);
  assert.equal(office.fallbackRead.enforce, false);
  assert.equal(office.fallbackRead.verified, false);
  assert.equal(office.fallbackRead.headingClass, 'fai-CopilotMessage__accessibleHeading');
  assert.equal(office.fallbackRead.headingSuffix, ' said:');
  // Shipped with NO paneKinds and NO landingInfix, which is exactly why
  // LoadAgentSurfaces drops the block: both are Teams' title-derived gates and
  // neither has a meaning on a composer-name surface. Recorded here so nobody
  // reads "flip the two flags" as enough to arm this route.
  assert.deepEqual(office.fallbackRead.paneKinds, []);
  assert.equal(office.fallbackRead.landingInfix, '');

  // Copies, so a consumer mutating the payload cannot reach back into the catalog.
  entry.procs.push('Notepad');
  entry.composerNamePrefixes.push('x');
  teams.titleKinds.push('Channel');
  teams.genericNames.push('x');
  teams.fallbackRead.paneKinds.push('Activity');
  teams.fallbackRead.genericNames.push('x');
  assert.deepEqual(AGENT_SURFACES[0].procs, ['M365Copilot']);
  assert.deepEqual(AGENT_SURFACES[0].composerNamePrefixes, ['Message ']);
  assert.deepEqual(AGENT_SURFACES[1].titleKinds, ['Chat']);
  assert.deepEqual(AGENT_SURFACES[1].genericNames, ['Copilot', 'Chat', 'Microsoft Teams', 'Meeting chat']);
  assert.deepEqual(AGENT_SURFACES[1].fallbackRead.paneKinds, ['Copilot']);
  assert.deepEqual(AGENT_SURFACES[1].fallbackRead.genericNames, ['Copilot', 'Microsoft 365 Copilot', 'You']);
  // Survives JSON round-tripping, which is how it actually reaches the helper —
  // the nested block is the first structured value on this channel.
  const config = buildAgentSurfaceConfig();
  assert.deepEqual(JSON.parse(JSON.stringify(config)), config);
});

test('buildAgentSurfaceConfig carries postSendVerifyMs (clamped) and newlineKeys for every surface', async () => {
  // THE LIVE BUG (2026-09-21): m365_copilot has declared postSendVerifyMs:1500
  // since its WebView2 composer was measured, but this function never put it on
  // the wire — so the enforcer used the 200ms default, reported a delivered
  // mask-and-send as not_submitted, and no enforcement_redact was recorded.
  const { clampPostSendVerifyMs, DEFAULT_NEWLINE_KEYS, DEFAULT_POST_SEND_VERIFY_MS, MAX_POST_SEND_VERIFY_MS } =
    await import('../src/os_monitor/ai-processes.js');
  const config = buildAgentSurfaceConfig();
  const m365 = config.find((e) => e.id === 'm365_copilot');
  assert.equal(AGENT_SURFACES.find((s) => s.id === 'm365_copilot').postSendVerifyMs, 1500);
  assert.equal(m365.postSendVerifyMs, 1500, 'm365_copilot must ship its catalog post-send window');
  for (const entry of config) {
    const src = AGENT_SURFACES.find((s) => s.id === entry.id);
    assert.equal(typeof entry.postSendVerifyMs, 'number', `${entry.id}.postSendVerifyMs must be a number`);
    // The SAME clamp buildAiPanelConfig applies — one rule for both catalogs.
    assert.equal(entry.postSendVerifyMs, clampPostSendVerifyMs(src.postSendVerifyMs), entry.id);
    assert.ok(entry.postSendVerifyMs >= DEFAULT_POST_SEND_VERIFY_MS && entry.postSendVerifyMs <= MAX_POST_SEND_VERIFY_MS);
    assert.equal(entry.newlineKeys, src.newlineKeys === undefined ? DEFAULT_NEWLINE_KEYS : src.newlineKeys, entry.id);
  }
  // …and the C# side parses and re-clamps it exactly as it does a panel's copy.
  const ps1 = await readFile(join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'os_monitor', 'enforcer-win.ps1'), 'utf8');
  const load = ps1.slice(ps1.indexOf('static void LoadAgentSurfaces(string json)'), ps1.indexOf('static AgentSurface MatchAgentSurface(string proc)'));
  assert.match(load, /PostSendVerifyMs = JsIntClamped\(d, "postSendVerifyMs",\s*\r?\n?\s*REWRITE_POST_SEND_MS, REWRITE_POST_SEND_MS, REWRITE_POST_SEND_MAX_MS\),/);
  assert.match(load, /NewlineKeys = JsStr\(d, "newlineKeys"\),/);
});

// ── Window-title agent reads (Microsoft Teams) ───────────────────────────────
//
// Teams' composer Name is the literal "Type a message" in EVERY conversation, so
// the composer-name mechanism above cannot work here at all. The window title is
// the only signal that says which conversation is open. Every title below is a
// VERBATIM live capture (2026-08) from a real Teams install with a real Copilot
// Studio agent ("IT Help Desk Agent") added.

const TEAMS_SURFACE = AGENT_SURFACES.find((s) => s.id === 'teams_desktop');

// Measured, verbatim.
const T_AGENT   = 'Chat | IT Help Desk Agent | filefuze | erik@filefuze.co | Microsoft Teams';
const T_GROUP   = 'Chat | alex, max | filefuze | erik@filefuze.co | Microsoft Teams';
const T_DM      = 'Sruthi Chimata | CloudFuze, Inc | Pravallika.Punumalli@cloudfuze.com | Microsoft Teams';
const T_COPILOT = 'Copilot | filefuze | erik@filefuze.co | Microsoft Teams';
const T_CHANNEL = 'Teams and Channels | CFQMSG END-END Sanity testing for public channel-ivy2 | General | filefuze | erik@filefuze.co | Microsoft Teams';
const T_ACTIVITY = 'Activity | Workflows | filefuze | erik@filefuze.co | Microsoft Teams';

test('extractAgentNameFromTitle names the agent conversation and nothing else', () => {
  // THE positive case: the real agent conversation, on the real title.
  assert.equal(extractAgentNameFromTitle(TEAMS_SURFACE, T_AGENT), 'IT Help Desk Agent');

  // A human GROUP CHAT has the IDENTICAL 5-segment shape — kind alone cannot
  // tell the two apart. Teams' own participant naming is what does, and it is
  // AUTHORITATIVE "no agent open", not "no evidence".
  assert.equal(extractAgentNameFromTitle(TEAMS_SURFACE, T_GROUP), AGENT_NAME_GENERIC);

  // A plain 1:1 DM has NO leading kind segment at all — the person's display
  // name is segment 0. Without the kind check this would read as an agent named
  // after a colleague, so it must land in NO EVIDENCE.
  assert.equal(extractAgentNameFromTitle(TEAMS_SURFACE, T_DM), AGENT_NAME_NOT_COMPOSER);

  // The Teams-generic Copilot panel: kind is "Copilot" and there is no separate
  // name segment at all. The kind check rejects it before anything is extracted,
  // so it is NO EVIDENCE — not Generic. (Both are non-blocking; the distinction
  // matters because only an AUTHORITATIVE outcome retires a live block's latch.)
  assert.equal(extractAgentNameFromTitle(TEAMS_SURFACE, T_COPILOT), AGENT_NAME_NOT_COMPOSER);

  // A channel post view and the Activity tab: different kinds, same rejection.
  assert.equal(extractAgentNameFromTitle(TEAMS_SURFACE, T_CHANNEL), AGENT_NAME_NOT_COMPOSER);
  assert.equal(extractAgentNameFromTitle(TEAMS_SURFACE, T_ACTIVITY), AGENT_NAME_NOT_COMPOSER);
});

test('extractAgentNameFromTitle refuses any title that is not this app\'s', () => {
  // The suffix check is what stops another app's window from ever being parsed
  // as a Teams title.
  for (const title of [
    'Chat | IT Help Desk Agent | filefuze | erik@filefuze.co | Slack',
    'Chat | IT Help Desk Agent | filefuze | erik@filefuze.co',
    'Chat | IT Help Desk Agent | Microsoft Teams Classic',
    'Microsoft Teams',
    'Chat | Microsoft Teams',              // only 2 segments — nothing to name
    'index.js - my-project - Visual Studio Code',
  ]) {
    assert.equal(extractAgentNameFromTitle(TEAMS_SURFACE, title), AGENT_NAME_NOT_COMPOSER, title);
  }
  // Generic labels in the name slot are AUTHORITATIVE "no agent open".
  for (const name of ['Copilot', 'Chat', 'Microsoft Teams', 'Meeting chat', 'meeting CHAT']) {
    assert.equal(
      extractAgentNameFromTitle(TEAMS_SURFACE, `Chat | ${name} | filefuze | erik@filefuze.co | Microsoft Teams`),
      AGENT_NAME_GENERIC, name,
    );
  }
  // Never throws — every input comes from another process's window.
  for (const bad of [null, undefined, '', '   ', 0, {}]) {
    assert.equal(extractAgentNameFromTitle(TEAMS_SURFACE, bad), AGENT_NAME_NOT_COMPOSER, JSON.stringify(bad));
  }
  assert.equal(extractAgentNameFromTitle(null, T_AGENT), AGENT_NAME_NOT_COMPOSER);
  assert.equal(extractAgentNameFromTitle({}, T_AGENT), AGENT_NAME_NOT_COMPOSER);
});

test('extractAgentNameFromTitle strips an unread-count prefix and bounds its input', () => {
  // HYPOTHESISED, not live-measured: implemented defensively because a missed
  // strip would silently disable the whole read the moment a message arrives.
  assert.equal(extractAgentNameFromTitle(TEAMS_SURFACE, `(3) ${T_AGENT}`), 'IT Help Desk Agent');
  assert.equal(extractAgentNameFromTitle(TEAMS_SURFACE, `(12)${T_AGENT}`), 'IT Help Desk Agent');
  assert.equal(extractAgentNameFromTitle(TEAMS_SURFACE, `(3) ${T_GROUP}`), AGENT_NAME_GENERIC);
  // Not a count — left alone, and then rejected on its own merits.
  assert.equal(extractAgentNameFromTitle(TEAMS_SURFACE, `() ${T_AGENT}`), AGENT_NAME_NOT_COMPOSER);
  assert.equal(extractAgentNameFromTitle(TEAMS_SURFACE, `(x) ${T_AGENT}`), AGENT_NAME_NOT_COMPOSER);
  // Capped at 512 chars, so a pathological title cannot make this expensive —
  // and truncation loses the suffix, which fails closed to NO EVIDENCE.
  const long = `Chat | ${'a'.repeat(600)} | filefuze | erik@filefuze.co | Microsoft Teams`;
  assert.equal(extractAgentNameFromTitle(TEAMS_SURFACE, long), AGENT_NAME_NOT_COMPOSER);
  // Whitespace is normalised, not treated as a mismatch — same rule the
  // composer-name read follows on both sides of every comparison.
  assert.equal(
    extractAgentNameFromTitle(TEAMS_SURFACE, '  Chat |  IT  Help Desk Agent | filefuze | e@f.co | Microsoft Teams  '),
    'IT Help Desk Agent',
  );
});

test('extractAgentName dispatches to the title reader for a window_title surface', () => {
  // The dispatcher: the same entry point the composer path uses, so the C# port
  // has one method to mirror. `title` is preferred, `name` is the fallback,
  // because the C# side puts the title in its single string parameter.
  assert.equal(extractAgentName({ process: 'ms-teams', title: T_AGENT }), 'IT Help Desk Agent');
  assert.equal(extractAgentName({ process: 'ms-teams.exe', title: T_AGENT }), 'IT Help Desk Agent');
  assert.equal(extractAgentName({ process: 'ms-teams', name: T_AGENT }), 'IT Help Desk Agent');
  assert.equal(extractAgentName({ process: 'ms-teams', title: T_GROUP }), AGENT_NAME_GENERIC);
  assert.equal(extractAgentName({ process: 'ms-teams', title: T_DM }), AGENT_NAME_NOT_COMPOSER);
  // The composer's own Name is NOT a signal for this surface — it is the same
  // literal in every conversation, which is the whole reason for title mode.
  assert.equal(extractAgentName({ process: 'ms-teams', controlType: 'Edit', name: 'Type a message' }), AGENT_NAME_NOT_COMPOSER);
  // …and m365_copilot's composer path is completely unaffected by the dispatch.
  assert.equal(extractAgentName(M365_ADVISOR), 'AI Learning Advisor');
  assert.equal(extractAgentName(M365_GENERIC), AGENT_NAME_GENERIC);
  // A title-shaped string in an M365Copilot composer read is not a title read.
  assert.equal(extractAgentName({ process: 'M365Copilot', controlType: 'Edit', title: T_AGENT, name: 'Message Copilot' }), AGENT_NAME_GENERIC);
});

test('looksLikeParticipantList recognises Teams\' own group-chat naming', () => {
  // Accepted: Teams' default comma+space join of participant display names.
  for (const value of [
    'alex, max',
    'Alex Morgan, Max Chen',
    'Alex Morgan, Max Chen, Sam Ng',
    "Siobhán O'Brien, Max Chen",
    'Renée Dubois-Martin, Max Chen',
    'J. R. Ewing, Max Chen',
  ]) {
    assert.equal(looksLikeParticipantList(value), true, value);
  }
  // Rejected: a single name, an agent name, and anything with a digit or a
  // symbol a display name does not carry.
  for (const value of [
    'IT Help Desk Agent',
    'alex',
    '',
    '   ',
    'alex,max',                       // no space after the comma — not the join
    'Deal Desk Bot, Agent #2',        // a digit and a symbol
    'Team Alpha, Squad 7',            // a digit
    'A Very Long Single Segment Name Beyond Forty Chars, Max',
    'One Two Three Four, Max Chen',   // four words is not a display name
    'alex, ',                         // one real segment
    'alex@corp.com, max@corp.com',    // '@' is not a name character
  ]) {
    assert.equal(looksLikeParticipantList(value), false, JSON.stringify(value));
  }
  // Never throws.
  for (const bad of [null, undefined, 0, {}]) {
    assert.equal(looksLikeParticipantList(bad), false, JSON.stringify(bad));
  }
});

test('looksLikeParticipantList is defence in depth, NOT a complete fix', () => {
  // Stated as a test so the accepted residual risk is impossible to lose.
  //
  // 1. A DELIBERATELY renamed group chat with no comma is indistinguishable from
  //    an agent conversation, by construction. If someone renames a chat to
  //    exactly a blocked agent's name, it is blocked. Accepted, not solved.
  assert.equal(looksLikeParticipantList('IT Help Desk Agent'), false);
  assert.equal(
    extractAgentNameFromTitle(TEAMS_SURFACE, 'Chat | IT Help Desk Agent | filefuze | e@f.co | Microsoft Teams'),
    'IT Help Desk Agent',
    'a chat renamed to a blocked agent name is not distinguishable — accepted',
  );
  // 2. The converse: a comma+space AGENT name is read as a participant list and
  //    therefore never blocked through this path. Fail-OPEN, which is the
  //    correct direction for a general-purpose communications client — a missed
  //    block is recoverable, a company that cannot chat is not.
  assert.equal(looksLikeParticipantList('Contracts, Legal'), true);
  assert.equal(
    extractAgentNameFromTitle(TEAMS_SURFACE, 'Chat | Contracts, Legal | filefuze | e@f.co | Microsoft Teams'),
    AGENT_NAME_GENERIC,
    'an agent whose name contains ", " cannot be blocked via the title — accepted, fail-open',
  );
});

test('agentSurfaceForProcess resolves the Teams host app', () => {
  for (const proc of ['ms-teams', 'MS-Teams', 'ms-teams.exe', ' ms-teams ']) {
    assert.equal(agentSurfaceForProcess(proc)?.id, 'teams_desktop', proc);
  }
  // The old Teams process name is a different app and is not covered.
  assert.equal(agentSurfaceForProcess('Teams'), null);
});

// ── The SECOND Teams UI route: the embedded Copilot tab ──────────────────────
//
// Teams reaches an agent two ways. The Chat-list route names the conversation in
// the WINDOW TITLE and is covered above. The embedded "Copilot" tab does NOT:
// measured live 2026-09, its title is the generic, CONSTANT "Copilot | filefuze |
// erik@filefuze.co | Microsoft Teams" no matter which agent is open, so the title
// parse correctly returns NO EVIDENCE there and that route was a silent
// detection gap. The agent's name is in the PANE instead, on an accessible
// heading. Every string below is a VERBATIM live capture.

// The agent's own message heading — class and Name, both measured. The trailing
// hash token is a stable per-component-type hash (identical across two messages
// in one session), not a per-instance id, but nothing here depends on that: the
// SEMANTIC token is what is matched.
const H_AGENT_MSG_CLASS = 'fai-CopilotMessage__accessibleHeading rhgro0h';
const H_AGENT_MSG_NAME = 'IT Help Desk Agent said:';
// The USER's own message heading — a DIFFERENT class, confirmed live. This is
// what makes it impossible to read a human's message as the agent's.
const H_USER_MSG_CLASS = 'fai-UserMessage__accessibleHeading r183b29h';
const H_USER_MSG_NAME = 'You said:';
// The landing heading of a freshly-opened conversation, before any message is
// sent. A generic Fluent title style, so it cannot be class-filtered — the
// " Created by " infix is the whole signal.
const H_LANDING_CLASS = 'fui-Title1 fui-Text ___4t6usk0 fk6fouc fccw675 f1ebx5kk flh3ekv f17mccla f1w7gpdv f6juhto f1gl81tg f2jf649 f19n0e5 f1pnz6pm f1jsk80 ffay0gz f1mix7af f138trxt fhvk2gl f1trf6pf';
const H_LANDING_NAME = 'IT Help Desk Agent Created by Your developer name';

test('the Copilot-tab route CANNOT be a second AGENT_SURFACES entry — it would be shadowed', () => {
  // The structural reason `fallbackRead` is nested on teams_desktop rather than
  // being an entry of its own. agentSurfaceForProcess is FIRST-MATCH-WINS per
  // process name, so a second entry carrying procs:['ms-teams'] could never be
  // reached at all. Asserted here so the reasoning cannot quietly stop holding.
  const forTeams = AGENT_SURFACES.filter((s) => s.procs.some((p) => p.toLowerCase() === 'ms-teams'));
  assert.equal(forTeams.length, 1, 'exactly one AGENT_SURFACES entry may name ms-teams');
  assert.equal(forTeams[0].id, 'teams_desktop');
  assert.equal(agentSurfaceForProcess('ms-teams').id, 'teams_desktop');
  // …and the surface that IS returned is the one carrying the fallback block.
  assert.ok(agentSurfaceForProcess('ms-teams').fallbackRead, 'the reachable surface must carry the fallback');
});

test('the Copilot-tab route is VERIFIED and ENFORCING — both of its own flags are true', () => {
  // Its OWN pair, deliberately separate from teams_desktop's (true/true since the
  // Chat-list route's 2026-08-30 pass). Hanging this route off that pair would
  // have shipped it live-armed on day one against a route nobody had verified
  // end-to-end; instead it shipped false/false and was flipped only by its own
  // live pass on 2026-09-02 (blocked agent reached through the Copilot tab, send
  // stopped, with the Chat-list route / M365Copilot / a DM / a generic agent all
  // re-confirmed correct in the same pass). The pair stays separate so a future
  // third route still starts inert.
  const fb = AGENT_SURFACES.find((s) => s.id === 'teams_desktop').fallbackRead;
  assert.ok(fb, 'the fallbackRead block is missing');
  assert.equal(fb.enforce, true, 'the Copilot-tab route enforces after its own live pass');
  assert.equal(fb.verified, true, 'the 2026-09-02 live pass is what allows enforce to be true');
  assert.equal(fb.mode, 'message_heading');
  // The measured data, pinned.
  assert.deepEqual(fb.paneKinds, ['Copilot']);
  assert.equal(fb.headingClass, 'fai-CopilotMessage__accessibleHeading');
  assert.equal(fb.headingSuffix, ' said:');
  assert.equal(fb.landingInfix, ' Created by ');
  assert.deepEqual(fb.genericNames, ['Copilot', 'Microsoft 365 Copilot', 'You']);
  // AND the load-bearing separation: 'Copilot' must NOT have been added to
  // titleKinds. On this route the title's SECOND segment is the tenant/org name,
  // so a titleKinds match would make the primary parse read "filefuze" as the
  // open agent's name.
  const teams = AGENT_SURFACES.find((s) => s.id === 'teams_desktop');
  assert.deepEqual(teams.titleKinds, ['Chat'], 'Copilot must never become a titleKind');
  assert.equal(extractAgentNameFromTitle(teams, T_COPILOT), AGENT_NAME_NOT_COMPOSER,
    'the Copilot tab title must still name nothing through the primary parse');
});

test('titleKindOf answers "which Teams view is this" once, for both consumers', () => {
  // The measured shapes.
  assert.equal(titleKindOf(TEAMS_SURFACE, T_AGENT), 'Chat');
  assert.equal(titleKindOf(TEAMS_SURFACE, T_GROUP), 'Chat');
  assert.equal(titleKindOf(TEAMS_SURFACE, T_COPILOT), 'Copilot');
  assert.equal(titleKindOf(TEAMS_SURFACE, T_CHANNEL), 'Teams and Channels');
  assert.equal(titleKindOf(TEAMS_SURFACE, T_ACTIVITY), 'Activity');
  // A 1:1 DM has NO kind segment at all — segment 0 is the colleague's display
  // name, so that is what comes back. Harmless and correct: the value is only
  // ever compared against a catalog list, never used as a name.
  assert.equal(titleKindOf(TEAMS_SURFACE, T_DM), 'Sruthi Chimata');
  // Unparseable → '' — not this app's window at all, too few segments, or junk.
  for (const bad of [
    'index.js - my-project - Visual Studio Code',
    'Chat | IT Help Desk Agent | filefuze | erik@filefuze.co | Slack',
    'Chat | Microsoft Teams',          // only two segments
    'Microsoft Teams',
    '', '   ', null, undefined, 0, {},
  ]) {
    assert.equal(titleKindOf(TEAMS_SURFACE, bad), '', JSON.stringify(bad));
  }
  assert.equal(titleKindOf(null, T_AGENT), '');
  assert.equal(titleKindOf({}, T_AGENT), '');
  // The unread-count strip and whitespace normalisation are shared with the
  // primary parse, because both go through the same segmentation.
  assert.equal(titleKindOf(TEAMS_SURFACE, `(3) ${T_COPILOT}`), 'Copilot');
  assert.equal(titleKindOf(TEAMS_SURFACE, '  Copilot  | filefuze | e@f.co | Microsoft Teams '), 'Copilot');
});

test('LIVE 2026-09-04: Teams serves the Copilot title shape for a CHAT-LIST conversation too', () => {
  // THE OBSERVATION. In the same Chat-list agent conversation, with no
  // navigation away from it, Teams stopped serving
  //   "Chat | IT Help Desk Agent | filefuze | erik@filefuze.co | Microsoft Teams"
  // and started serving the four-segment shape that had only ever been measured
  // in the embedded Copilot TAB:
  //   "Copilot | filefuze | erik@filefuze.co | Microsoft Teams"
  // — no conversation name segment at all. Teams chose that.
  //
  // The pure layer must be UNCHANGED by it, and this pins that in both
  // directions, because the tempting "fix" is the wrong one.
  const RETITLED = 'Copilot | filefuze | erik@filefuze.co | Microsoft Teams';
  assert.equal(RETITLED, T_COPILOT, 'the live title is byte-identical to the measured Copilot-tab one');

  // 1. It PARSES — four segments, the app suffix last — so nothing errors and
  //    nothing falls off the end. Three segments is the minimum; this has four.
  assert.equal(titleKindOf(TEAMS_SURFACE, RETITLED), 'Copilot');

  // 2. The primary parse still names NOTHING, and that is correct rather than a
  //    gap to close here. The second segment is the TENANT ("filefuze"), so
  //    adding 'Copilot' to titleKinds — the obvious-looking fix — would make
  //    this read the ORG NAME as the open agent's name and match it against the
  //    blocklist. That is why the recovery route is the heading scan instead.
  assert.equal(extractAgentNameFromTitle(TEAMS_SURFACE, RETITLED), AGENT_NAME_NOT_COMPOSER);
  assert.equal(agentNameMatches(extractAgentNameFromTitle(TEAMS_SURFACE, RETITLED), 'filefuze'), false);
  assert.deepEqual(TEAMS_SURFACE.titleKinds, ['Chat'], 'Copilot must still never be a titleKind');

  // 3. The kind IS in paneKinds, which is what routes this title to the heading
  //    scan — and paneKinds gates only, never extracts. The gate is therefore
  //    the same one whichever composer holds focus, which is why the Chat-list
  //    route needed no widening to be covered.
  assert.ok(TEAMS_SURFACE.fallbackRead.paneKinds.includes(titleKindOf(TEAMS_SURFACE, RETITLED)));

  // 4. THE BOUNDARY. Every OTHER no-evidence Teams title keeps a kind that is
  //    NOT in paneKinds, so none of them can reach the heading scan. This is the
  //    distinction that must survive: "the title's kind is a pane we scan" is a
  //    different question from "the title failed to name a conversation", and
  //    only the first may trigger a walk of a conversation's message content.
  for (const [title, why] of [
    [T_DM, 'a 1:1 DM has no kind segment at all'],
    [T_CHANNEL, 'a channel view'],
    [T_ACTIVITY, 'the Activity tab'],
  ]) {
    assert.equal(extractAgentNameFromTitle(TEAMS_SURFACE, title), AGENT_NAME_NOT_COMPOSER, why);
    assert.equal(TEAMS_SURFACE.fallbackRead.paneKinds.includes(titleKindOf(TEAMS_SURFACE, title)), false,
      `${why} must never reach the heading scan`);
  }
  // A group chat — Teams' own participant naming and a DELIBERATE rename alike —
  // keeps kind "Chat", which is not in paneKinds either. The rename reads Named
  // (the accepted residual risk documented on looksLikeParticipantList) and the
  // participant list reads Generic; neither is walked.
  for (const title of [T_GROUP, 'Chat | Q4 launch war room | filefuze | e@f.co | Microsoft Teams']) {
    assert.equal(TEAMS_SURFACE.fallbackRead.paneKinds.includes(titleKindOf(TEAMS_SURFACE, title)), false,
      'no human conversation may ever reach the heading scan');
  }
  assert.equal(extractAgentNameFromTitle(TEAMS_SURFACE, T_GROUP), AGENT_NAME_GENERIC);
});

test('extractAgentNameFromHeading reads the landing heading of a fresh conversation', () => {
  // The state confirmed BEFORE any message is sent — and, since re-opening an
  // agent's Copilot-tab conversation resets it to empty, the common state right
  // after opening one.
  assert.equal(
    extractAgentNameFromHeading(TEAMS_SURFACE, [{ className: H_LANDING_CLASS, name: H_LANDING_NAME }]),
    'IT Help Desk Agent',
  );
  // Whitespace is normalised on the way out, same as every other reader here.
  assert.equal(
    extractAgentNameFromHeading(TEAMS_SURFACE, [{ className: H_LANDING_CLASS, name: '  IT  Help Desk Agent Created by  Someone ' }]),
    'IT Help Desk Agent',
  );
  // The infix must actually be there, and something must precede it.
  for (const name of ['IT Help Desk Agent', 'Created by Your developer name', ' Created by X']) {
    assert.equal(
      extractAgentNameFromHeading(TEAMS_SURFACE, [{ className: H_LANDING_CLASS, name }]),
      AGENT_NAME_NOT_COMPOSER, name,
    );
  }
});

test('extractAgentNameFromHeading reads the agent\'s own message headings, and only those', () => {
  // One message sent.
  assert.equal(
    extractAgentNameFromHeading(TEAMS_SURFACE, [{ className: H_AGENT_MSG_CLASS, name: H_AGENT_MSG_NAME }]),
    'IT Help Desk Agent',
  );
  // Headings ACCUMULATE — confirmed live that a second exchange did not replace
  // the first message's heading. Two that AGREE are one confirmed answer.
  assert.equal(
    extractAgentNameFromHeading(TEAMS_SURFACE, [
      { className: H_AGENT_MSG_CLASS, name: H_AGENT_MSG_NAME },
      { className: H_USER_MSG_CLASS, name: H_USER_MSG_NAME },
      { className: H_AGENT_MSG_CLASS, name: H_AGENT_MSG_NAME },
    ]),
    'IT Help Desk Agent',
  );
  // THE class filter. The USER's heading is a different class (measured), so a
  // human's own message can never be read as the agent's — even though its Name
  // has the identical "<x> said:" shape.
  assert.equal(
    extractAgentNameFromHeading(TEAMS_SURFACE, [{ className: H_USER_MSG_CLASS, name: H_USER_MSG_NAME }]),
    AGENT_NAME_NOT_COMPOSER,
  );
  // …and a heading whose class does not contain the token is ignored outright,
  // however convincing its Name looks. This is what stops the plain bare-name
  // Text control near each response (measured: Name "IT Help Desk Agent", no
  // distinguishing class) from ever being the signal.
  assert.equal(
    extractAgentNameFromHeading(TEAMS_SURFACE, [{ className: 'fai-SomethingElse r1', name: 'Finance Analyst said:' }]),
    AGENT_NAME_NOT_COMPOSER,
  );
  assert.equal(
    extractAgentNameFromHeading(TEAMS_SURFACE, [{ className: '', name: 'IT Help Desk Agent' }]),
    AGENT_NAME_NOT_COMPOSER,
  );
  // Token matching, not a substring test: a class that merely CONTAINS the token
  // as part of a longer word must not satisfy it.
  assert.equal(
    extractAgentNameFromHeading(TEAMS_SURFACE, [{ className: 'x-fai-CopilotMessage__accessibleHeading', name: H_AGENT_MSG_NAME }]),
    AGENT_NAME_NOT_COMPOSER,
  );
  // The suffix has to be there, and something has to precede it.
  for (const name of ['IT Help Desk Agent', 'said:', ' said:', 'IT Help Desk Agent says:']) {
    assert.equal(
      extractAgentNameFromHeading(TEAMS_SURFACE, [{ className: H_AGENT_MSG_CLASS, name }]),
      AGENT_NAME_NOT_COMPOSER, JSON.stringify(name),
    );
  }
});

test('extractAgentNameFromHeading treats DISAGREEING headings as NO EVIDENCE, never a block', () => {
  // A mixed or stale transcript, or a pane that re-rendered mid-walk. For a HOST
  // APP the fail direction is inverted: "cannot tell which agent is open" must
  // never mean "block anyway" in a company's communications client.
  assert.equal(
    extractAgentNameFromHeading(TEAMS_SURFACE, [
      { className: H_AGENT_MSG_CLASS, name: 'IT Help Desk Agent said:' },
      { className: H_AGENT_MSG_CLASS, name: 'Finance Analyst said:' },
    ]),
    AGENT_NAME_NOT_COMPOSER,
  );
  // …and a disagreement does NOT fall through to the landing heading either: an
  // ambiguous pane stays ambiguous.
  assert.equal(
    extractAgentNameFromHeading(TEAMS_SURFACE, [
      { className: H_AGENT_MSG_CLASS, name: 'IT Help Desk Agent said:' },
      { className: H_AGENT_MSG_CLASS, name: 'Finance Analyst said:' },
      { className: H_LANDING_CLASS, name: H_LANDING_NAME },
    ]),
    AGENT_NAME_NOT_COMPOSER,
  );
  // Two landing headings that disagree are ambiguous for the same reason.
  assert.equal(
    extractAgentNameFromHeading(TEAMS_SURFACE, [
      { className: H_LANDING_CLASS, name: 'IT Help Desk Agent Created by A' },
      { className: H_LANDING_CLASS, name: 'Finance Analyst Created by B' },
    ]),
    AGENT_NAME_NOT_COMPOSER,
  );
  // Case and whitespace differences are NOT a disagreement — same normalisation
  // both sides of every comparison in this catalog.
  assert.equal(
    extractAgentNameFromHeading(TEAMS_SURFACE, [
      { className: H_AGENT_MSG_CLASS, name: 'IT Help Desk Agent said:' },
      { className: H_AGENT_MSG_CLASS, name: 'it  help desk  agent said:' },
    ]),
    'IT Help Desk Agent',
  );
});

test('extractAgentNameFromHeading applies the Generic filter BEFORE any match', () => {
  // Same ordering as every other reader here, so an agent literally named
  // "Copilot" can never be matched through this route either.
  for (const label of ['Copilot', 'Microsoft 365 Copilot', 'You', 'copilot', ' You ']) {
    assert.equal(
      extractAgentNameFromHeading(TEAMS_SURFACE, [{ className: H_AGENT_MSG_CLASS, name: `${label} said:` }]),
      AGENT_NAME_GENERIC, label,
    );
  }
  // A message heading wins over the landing heading when both are present —
  // step 3 runs only when step 2 found nothing at all.
  assert.equal(
    extractAgentNameFromHeading(TEAMS_SURFACE, [
      { className: H_LANDING_CLASS, name: 'Finance Analyst Created by B' },
      { className: H_AGENT_MSG_CLASS, name: H_AGENT_MSG_NAME },
    ]),
    'IT Help Desk Agent',
  );
});

test('extractAgentNameFromHeading never throws and refuses a surface with no fallback', () => {
  // Every input comes from another process's accessibility tree.
  for (const bad of [null, undefined, [], [null], [{}], [{ className: null, name: null }], 'x', 0, {}]) {
    assert.equal(extractAgentNameFromHeading(TEAMS_SURFACE, bad), AGENT_NAME_NOT_COMPOSER, JSON.stringify(bad));
  }
  // m365_copilot declares no fallbackRead at all, so this route does not exist
  // for it — the same headings must name nothing.
  const m365 = AGENT_SURFACES.find((s) => s.id === 'm365_copilot');
  assert.equal(m365.fallbackRead, undefined, 'm365_copilot must not gain a fallback route');
  assert.equal(
    extractAgentNameFromHeading(m365, [{ className: H_AGENT_MSG_CLASS, name: H_AGENT_MSG_NAME }]),
    AGENT_NAME_NOT_COMPOSER,
  );
  for (const bad of [null, undefined, {}, { fallbackRead: {} }, { fallbackRead: { mode: 'nope' } }]) {
    assert.equal(
      extractAgentNameFromHeading(bad, [{ className: H_AGENT_MSG_CLASS, name: H_AGENT_MSG_NAME }]),
      AGENT_NAME_NOT_COMPOSER, JSON.stringify(bad),
    );
  }
});

// ── The EMPTY-SUFFIX case: the Chat-list badge route (live 2026-09-21) ──────
//
// extractAgentNameFromHeading used to require a NON-EMPTY headingSuffix before
// it would look at a class-matched candidate at all. That was right while the
// only caller was the Copilot tab, whose headings read "<Agent> said:". The
// Chat-list badge route's candidate is different: its collector PAIRS an "AI
// generated" badge (ClassName token fai-AiGeneratedDisclaimer) with the bare
// sender-name Text beside it, so the Name it hands in IS the agent name and
// there is nothing to strip.

const BADGE_CLASS = 'fai-AiGeneratedDisclaimer ___lv0h9d0 fk6fouc f13mqy1h figsok6 fwrc4pm ft85np5 fluwili f14t3ns0 f11d4kpn flu3bqm f1jl2yie fz5stix';
// The RETIRED Chat-list badge route (2026-09-24 — see the teams_composer entry)
// no longer lives in the catalog. Its pure reader (extractAgentNameFromHeading's
// empty-suffix support) still exists, so it is exercised against a FIXTURE of
// the exact block that used to ship, rather than against the catalog.
const TEAMS_COMPOSER = {
  id: 'teams_composer_badge_fixture',
  fallbackRead: {
    mode: 'message_heading', headingClass: 'fai-AiGeneratedDisclaimer', headingSuffix: '',
    genericNames: ['Copilot', 'You'], enforce: false, verified: false,
  },
};

test('the Chat-list badge fallback is RETIRED from the catalog, replaced by the AI-evidence check', () => {
  // Measured live 2026-09-24: a human group chat carries "badge-<ts>" Images
  // (class fui-ChatMessage__decorationIcon, Name "<person> mentioned you"). A
  // "badge" heuristic was one release away from reading a colleague chat, so
  // the route is gone and teams_composer declares aiEvidence:'teams_chat'.
  const catalog = AI_PANELS.find((p) => p.id === 'teams_composer');
  assert.equal('fallbackRead' in catalog, false);
  assert.equal(catalog.aiEvidence, 'teams_chat');
  assert.deepEqual(AI_PANELS.filter((p) => p.fallbackRead).map((p) => p.id), []);
});

test('extractAgentNameFromHeading offers the BARE name when headingSuffix is empty', () => {
  // The measured pair, verbatim: the badge's ClassName travels with the paired
  // Text's Name, which is exactly what the collector synthesizes.
  assert.equal(
    extractAgentNameFromHeading(TEAMS_COMPOSER, [{ className: BADGE_CLASS, name: 'IT Help Desk Agent' }]),
    'IT Help Desk Agent',
  );
  // Whitespace is normalised on the way out, same as every other reader here.
  assert.equal(
    extractAgentNameFromHeading(TEAMS_COMPOSER, [{ className: BADGE_CLASS, name: '  IT  Help Desk Agent ' }]),
    'IT Help Desk Agent',
  );
  // Badges ACCUMULATE down a transcript; two that agree are one answer.
  assert.equal(
    extractAgentNameFromHeading(TEAMS_COMPOSER, [
      { className: BADGE_CLASS, name: 'IT Help Desk Agent' },
      { className: BADGE_CLASS, name: 'IT Help Desk Agent' },
    ]),
    'IT Help Desk Agent',
  );
  // …and two that DISAGREE are no evidence, never a block — the contract is
  // unchanged by the empty suffix.
  assert.equal(
    extractAgentNameFromHeading(TEAMS_COMPOSER, [
      { className: BADGE_CLASS, name: 'IT Help Desk Agent' },
      { className: BADGE_CLASS, name: 'Expenses Helper' },
    ]),
    AGENT_NAME_NOT_COMPOSER,
  );
  // The CLASS is still the whole gate. An empty suffix loosens what a matched
  // candidate's Name may look like; it loosens NOTHING about what counts as a
  // candidate, which is the thing the 2026-09 pass was right to protect.
  for (const cls of ['', 'fui-Text r1', 'x-fai-AiGeneratedDisclaimer']) {
    assert.equal(
      extractAgentNameFromHeading(TEAMS_COMPOSER, [{ className: cls, name: 'IT Help Desk Agent' }]),
      AGENT_NAME_NOT_COMPOSER, `className ${JSON.stringify(cls)} must not be a candidate`,
    );
  }
  // An empty or whitespace-only Name offers nothing.
  for (const name of ['', '   ', null, undefined]) {
    assert.equal(
      extractAgentNameFromHeading(TEAMS_COMPOSER, [{ className: BADGE_CLASS, name }]),
      AGENT_NAME_NOT_COMPOSER, JSON.stringify(name),
    );
  }
  // The Generic filter still runs BEFORE any match.
  for (const label of ['Copilot', 'You', 'copilot']) {
    assert.equal(
      extractAgentNameFromHeading(TEAMS_COMPOSER, [{ className: BADGE_CLASS, name: label }]),
      AGENT_NAME_GENERIC, label,
    );
  }
  // Never throws on garbage, same as the surface-driven path.
  for (const bad of [null, undefined, [], [null], [{}], 'x', 0, {}]) {
    assert.equal(extractAgentNameFromHeading(TEAMS_COMPOSER, bad), AGENT_NAME_NOT_COMPOSER, JSON.stringify(bad));
  }
});

test('the empty-suffix change is INERT for every non-empty-suffix caller', () => {
  // ZERO regression is the requirement, so the Copilot-tab route's own
  // assertions are re-run here against the same catalog object the shipped
  // reader uses. The suffix path must still strip, still require something
  // before the suffix, and still refuse a Name that does not carry it.
  assert.equal(TEAMS_SURFACE.fallbackRead.headingSuffix, ' said:', 'the other route keeps its suffix');
  assert.equal(
    extractAgentNameFromHeading(TEAMS_SURFACE, [{ className: H_AGENT_MSG_CLASS, name: H_AGENT_MSG_NAME }]),
    'IT Help Desk Agent',
  );
  // A class-matched heading whose Name lacks the suffix is STILL not offered —
  // this is the exact assertion the relaxed guard could have broken, since the
  // empty-suffix branch would happily have taken the whole string.
  assert.equal(
    extractAgentNameFromHeading(TEAMS_SURFACE, [{ className: H_AGENT_MSG_CLASS, name: 'IT Help Desk Agent' }]),
    AGENT_NAME_NOT_COMPOSER,
    'a bare name under a suffix-carrying route must not suddenly become evidence',
  );
  // …and a Name that is ONLY the suffix has nothing before it to offer.
  assert.equal(
    extractAgentNameFromHeading(TEAMS_SURFACE, [{ className: H_AGENT_MSG_CLASS, name: ' said:' }]),
    AGENT_NAME_NOT_COMPOSER,
  );
  // The user's own heading still carries a different class and is still unread.
  assert.equal(
    extractAgentNameFromHeading(TEAMS_SURFACE, [{ className: H_USER_MSG_CLASS, name: H_USER_MSG_NAME }]),
    AGENT_NAME_NOT_COMPOSER,
  );
});

test('a badge-paired name still has to match a blocklist row whole', () => {
  // Nothing about this route is special downstream: the recovered name goes
  // through the same whole-string agentNameMatches every other read does.
  const name = extractAgentNameFromHeading(TEAMS_COMPOSER, [{ className: BADGE_CLASS, name: 'IT Help Desk Agent' }]);
  assert.equal(agentNameMatches(name, 'IT Help Desk Agent'), true);
  assert.equal(agentNameMatches(name, 'Help Desk'), false);
  assert.equal(agentNameMatches(extractAgentNameFromHeading(TEAMS_COMPOSER, []), 'IT Help Desk Agent'), false);
});

test('a name read off a Copilot-tab heading still has to match a blocklist row whole', () => {
  // The extracted name is not special: it goes through the same whole-string
  // agentNameMatches every other read does, so a row for "Advisor" cannot block
  // "IT Help Desk Agent" via this route either.
  const name = extractAgentNameFromHeading(TEAMS_SURFACE, [{ className: H_AGENT_MSG_CLASS, name: H_AGENT_MSG_NAME }]);
  assert.equal(agentNameMatches(name, 'IT Help Desk Agent'), true);
  assert.equal(agentNameMatches(name, 'Help Desk'), false);
  // A sentinel outcome can never match anything.
  assert.equal(agentNameMatches(extractAgentNameFromHeading(TEAMS_SURFACE, []), 'IT Help Desk Agent'), false);
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

// ── governed-agents.json: DLP-monitored, NOT blocked ────────────────────────
// The second file blocked-agents-sync.js writes, from GET
// /api/lifecycle/governed-agents. Same shape as the blocked rows on purpose, so
// the enforcer-side parser is shared rather than duplicated, with two
// differences that both exist to avoid governing more than was asked for.

test('normalizeGovernedRows produces the SAME on-disk shape as the blocked rows', () => {
  const [row] = normalizeGovernedRows([{
    agent_id: 'ag-1',
    agent_name: 'IT Help "Desk"',
    platform: 'teams_chat_agent',
    reason: 'Sensitive {data}',
    oauth_key_id: 'k1',
    agent_scope: 'platform',
    dlp_monitor: true,
    dlp_monitor_at: '2026-09-01T10:00:00.000Z',
    orphaned: false,
  }]);
  // Field for field, with the same sanitising and the same agent_scope enum the
  // blocked list uses — no renamed and no invented fields.
  assert.deepEqual(row, {
    agent_id: 'ag-1',
    agent_name: 'IT Help Desk',
    platform: 'teams_chat_agent',
    reason: 'Sensitive data',
    oauth_key_id: 'k1',
    agent_scope: 'platform',
    dlp_monitor: true,
    dlp_monitor_at: '2026-09-01T10:00:00.000Z',
    orphaned: false,
  });
  // Junk in, no throw — this runs on a network poll path.
  assert.deepEqual(normalizeGovernedRows(null), []);
  assert.deepEqual(normalizeGovernedRows('nope'), []);
  assert.deepEqual(normalizeGovernedRows([null, 'x', 7]), []);
});

test('normalizeGovernedRows DROPS an agent-scoped row whose name cannot survive, instead of widening it', () => {
  // The one deliberate divergence from the blocked list. There, a name the
  // enforcer could never match is downgraded to a whole-app BLOCK — fail-closed.
  // Here the same downgrade would turn "DLP-monitor this one agent" into
  // "scan everything typed in this app", i.e. capture far more prompt content
  // than the admin asked for, so the row is dropped instead.
  const warnings = [];
  const rows = normalizeGovernedRows([
    { agent_id: 'ag-1', agent_name: 'Advisor "Prime"', platform: 'personal_agent', agent_scope: 'agent' },
    { agent_id: 'ag-2', agent_name: 'Finance Bot', platform: 'personal_agent', agent_scope: 'agent' },
  ], { warn: (m) => warnings.push(m) });
  assert.deepEqual(rows.map((r) => r.agent_id), ['ag-2']);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /dropped/);
  // A row the SERVER already sent as platform- or no-scope is untouched: that
  // breadth is the admin's own decision, not a transport artefact.
  const wide = normalizeGovernedRows([
    { agent_id: 'ag-3', agent_name: 'Bad "name"', platform: 'personal_agent', agent_scope: 'platform' },
    { agent_id: 'ag-4', agent_name: 'Bad "name"', platform: 'personal_agent' },
  ]);
  assert.deepEqual(wide.map((r) => [r.agent_id, r.agent_name, r.agent_scope]),
    [['ag-3', 'Bad name', 'platform'], ['ag-4', 'Bad name', null]]);
});

test('filterGovernedAgents: BLOCKED WINS — a blocked agent is never also governed', () => {
  const blocked = [
    { agent_id: 'ag-1', agent_name: 'IT Help Desk Agent', platform: 'teams_chat_agent', agent_scope: 'agent' },
  ];
  const governed = [
    { agent_id: 'ag-1', agent_name: 'IT Help Desk Agent', platform: 'teams_chat_agent', agent_scope: 'agent' },
    { agent_id: 'ag-2', agent_name: 'Finance Bot', platform: 'teams_chat_agent', agent_scope: 'agent' },
  ];
  const logged = [];
  const kept = filterGovernedAgents(governed, blocked, { info: (m) => logged.push(m) });
  assert.deepEqual(kept.map((r) => r.agent_id), ['ag-2']);
  assert.match(logged.join('\n'), /blocked wins/);
});

test('filterGovernedAgents matches ids first and the normalized name as the fallback', () => {
  // Same convention as filterBlockedAgents' agent-scoped branch: an id on BOTH
  // sides is decisive, so a display-name collision cannot drop the wrong row…
  const byId = filterGovernedAgents(
    [
      { agent_id: 'ag-1', agent_name: 'Shared Name', platform: 'personal_agent' },
      { agent_id: 'ag-2', agent_name: 'Shared Name', platform: 'personal_agent' },
    ],
    [{ agent_id: 'ag-2', agent_name: 'Shared Name', platform: 'personal_agent' }],
  );
  assert.deepEqual(byId.map((r) => r.agent_id), ['ag-1']);

  // …and with no id on one side the whitespace-normalised, case-insensitive
  // name is what collides. This is the race the sync-layer filter exists for:
  // a synthesised platform block carries no agent_id at all.
  const byName = filterGovernedAgents(
    [
      { agent_id: 'ag-1', agent_name: 'IT Help  Desk Agent', platform: 'personal_agent' },
      { agent_id: 'ag-2', agent_name: 'Finance Bot', platform: 'personal_agent' },
    ],
    [{ agent_id: '', agent_name: 'it help desk agent', platform: 'ai_platform' }],
  );
  assert.deepEqual(byName.map((r) => r.agent_id), ['ag-2']);

  // The platform is NOT part of the key: two lists that disagree about it still
  // collide, and blocked still wins.
  const crossPlatform = filterGovernedAgents(
    [{ agent_id: 'ag-9', agent_name: 'Roaming Agent', platform: 'teams_chat_agent' }],
    [{ agent_id: 'ag-9', agent_name: 'Roaming Agent', platform: 'personal_agent' }],
  );
  assert.deepEqual(crossPlatform, []);
});

test('filterGovernedAgents is a no-op for an empty or malformed blocked list', () => {
  const governed = [{ agent_id: 'ag-1', agent_name: 'Finance Bot', platform: 'personal_agent' }];
  assert.deepEqual(filterGovernedAgents(governed, []), governed);
  assert.deepEqual(filterGovernedAgents(governed, null), governed);
  // A blocked row naming NEITHER an id nor a name can match nothing — it must
  // not swallow the whole governed list.
  assert.deepEqual(filterGovernedAgents(governed, [{}, { agent_id: '  ', agent_name: '  ' }]), governed);
  assert.deepEqual(filterGovernedAgents([], [{ agent_id: 'ag-1' }]), []);
  assert.deepEqual(filterGovernedAgents(null, [{ agent_id: 'ag-1' }]), []);
  // A governed row with neither id nor name is kept: there is no evidence it is
  // the blocked one, and the enforcer cannot match it to anything either way.
  assert.deepEqual(
    filterGovernedAgents([{ platform: 'personal_agent' }], [{ agent_id: 'ag-1', agent_name: 'Finance Bot' }]),
    [{ platform: 'personal_agent' }],
  );
});

// ── Egress surfaces: a NON-AI destination data leaves through ────────────────
//
// The FOURTH catalog (Microsoft Outlook's compose/attach paths, plus the
// OneDrive/SharePoint sync roots). Everything below is about ONE property: that
// membership here unlocks NOTHING the other three catalogs unlock. An egress
// surface is a general-purpose mail client — a strictly worse case than the
// Teams host-app entry, which at least has a provable "an agent conversation is
// open" state to scope reads with. Outlook has none: every window in it is a
// human conversation.

test('EGRESS_SURFACES never reaches watcherProcessNames — the clipboard poller, the UIA watchers, the enforcer', () => {
  // THE privacy property, and the reason it is asserted first. An egress process
  // name in this list would turn on clipboard scanning, whole-window
  // attachment-chip watching and prompt-text reading across a mail client — i.e.
  // every email the user reads, every attachment a colleague sent them, and the
  // window title, which is the message SUBJECT LINE.
  const names = watcherProcessNames().map((n) => n.toLowerCase());
  assert.ok(names.length > 0);
  for (const surface of EGRESS_SURFACES) {
    for (const proc of surface.procs) {
      assert.equal(names.includes(String(proc).toLowerCase()), false,
        `${proc} is an egress surface and must never reach a passive watcher`);
    }
  }
  // Stated the other way round too, so a future AI_PROCESSES entry that happened
  // to name a mail client is caught as well.
  const egressProcs = EGRESS_SURFACES.flatMap((s) => s.procs.map((p) => String(p).toLowerCase()));
  assert.deepEqual(names.filter((n) => egressProcs.includes(n)), []);
});

test('a MAIL CLIENT may reach the scanning catalogs ONLY through a dlpMatch:"panel" class-token panel', () => {
  // NARROWED 2026-09-24 from a blanket "disjoint from IDE_PROCESSES and
  // AI_PANELS": the user explicitly wants Outlook's Copilot pane covered. What
  // must stay true is the reason the blanket rule existed — a mail client is
  // never a WHOLE-APP AI surface and nothing in it but the Copilot composer is
  // ever scanned:
  const egressProcs = new Set(EGRESS_SURFACES.flatMap((s) => s.procs.map((p) => String(p).toLowerCase())));
  const literal = (e) => e.match.source.replace(/^\^/, '').replace(/\$/, '').replace(/[\\/]i?$/, '').toLowerCase();
  // 1. never AI_PROCESSES (whole-app treatment, clipboard, every watcher) and
  //    never PLATFORM_PROCS (a process-wide block row).
  for (const entry of AI_PROCESSES) {
    assert.equal(egressProcs.has(literal(entry)), false, `${entry.product} is in BOTH AI_PROCESSES and EGRESS_SURFACES`);
  }
  for (const [platform, procs] of Object.entries(PLATFORM_PROCS)) {
    for (const proc of procs) {
      assert.equal(egressProcs.has(String(proc).toLowerCase()), false, `PLATFORM_PROCS.${platform} names the mail client ${proc}`);
    }
  }
  // 2. an IDE_PROCESSES entry for a mail client must have NO whole-app fallback
  //    and must host at least one panel (otherwise it would be dead config).
  for (const entry of IDE_PROCESSES) {
    if (!egressProcs.has(literal(entry))) continue;
    assert.equal(entry.panelFallback, false, `${entry.product}: a mail client may never fall back to whole-app scanning`);
    assert.ok(AI_PANELS.some((pl) => pl.procs.some((pr) => pr.toLowerCase() === literal(entry))),
      `${entry.product} is an IDE entry with no panel to host`);
  }
  // 3. every panel naming a mail client is dlpMatch:'panel' (a composer with no
  //    non-AI use) and matches by a CLASS TOKEN only — no Name rule, which in a
  //    mail client could match a subject or body label.
  const mailPanels = AI_PANELS.filter((pl) => pl.procs.some((pr) => egressProcs.has(pr.toLowerCase())));
  assert.deepEqual(mailPanels.map((pl) => pl.id), ['outlook_copilot_pane']);
  for (const panel of mailPanels) {
    assert.equal(panel.dlpMatch, 'panel', `${panel.id}: a mail-client panel must be dlpMatch:'panel'`);
    assert.ok(panel.classEquals || panel.classPrefix, `${panel.id}: a mail-client panel must key on a class token`);
    assert.equal(panel.nameEquals, undefined, `${panel.id} must not match on a Name`);
    assert.equal(panel.namePrefix, undefined, `${panel.id} must not match on a Name`);
    // 4. …and its signature can never match an egress COMPOSE-BODY signature,
    //    measured or future: the body sig's own class values must not satisfy
    //    the panel's rule, and no body sig may name the panel's token.
    for (const surface of EGRESS_SURFACES) {
      const body = surface.bodySig;
      if (!body) continue;
      for (const cls of [body.classEquals, body.classPrefix].filter(Boolean)) {
        assert.equal(matchPanelSignature({ process: surface.procs[0], controlType: body.controlType || 'Edit', name: '', className: cls })?.id === panel.id,
          false, `${panel.id} would match ${surface.id}'s compose body`);
      }
    }
  }
  // Outlook's measured-elsewhere compose / reading surfaces (classic Word-based
  // editor, WebView2 body, search box) never match the pane's signature.
  for (const cls of ['_WwG', 'ms-rte-Editor', 'NetUITextbox', 'RichEdit20WPT', 'elementToProof', '']) {
    for (const proc of ['OUTLOOK', 'olk']) {
      assert.equal(matchPanelSignature({ process: proc, controlType: 'Edit', name: 'Message body', className: cls }), null,
        `${proc} element with class ${JSON.stringify(cls)} must not match a panel`);
      assert.equal(matchPanelSignature({ process: proc, controlType: 'Document', name: 'Message body', className: cls }), null);
    }
  }
  // …while the pane's own Fluent composer does.
  assert.equal(matchPanelSignature({ process: 'OUTLOOK', controlType: 'Edit', name: 'Message Copilot',
    className: 'fai-EditorInput__input r18fti29 r18aquq2' })?.id, 'outlook_copilot_pane');
  // …and identifyAiProcess must not resolve one, so the clipboard/focus handlers
  // (which filter on it rather than on the watcher list) drop an egress process
  // at their own `if (!ai) return` guard.
  for (const proc of egressProcs) {
    assert.equal(identifyAiProcess(proc), null, `identifyAiProcess resolved the egress process ${proc}`);
    assert.equal(hostForProcess(proc), null, `hostForProcess resolved the egress process ${proc}`);
  }
});

test('an Inventory host toggle can never synthesize a desktop block row for an egress surface', () => {
  // processForHost / processesForHost are what turn an admin's `blocked` toggle
  // into a process_name row, and such a row is matched process-WIDE by
  // enforcer-win.ps1. One for a mail client would swallow Enter in every compose
  // window and every reply in the company — i.e. "nobody may write email" —
  // which is the same class of outcome the ms-teams host-app guard exists to
  // prevent, only worse.
  for (const surface of EGRESS_SURFACES) {
    assert.equal(processForHost(surface.host), null, `${surface.host} must resolve to no blockable process`);
    assert.deepEqual(processesForHost(surface.host), [], `${surface.host} must resolve to no blockable processes`);
    assert.equal(panelForHost(surface.host), null, `${surface.host} must resolve to no blockable panel`);
    assert.deepEqual(
      synthesizePlatformBlocks([{ host: surface.host, product: surface.product, blocked: true }]),
      [],
      `an Inventory block on ${surface.host} must synthesize nothing`,
    );
  }
  // The sync roots too — an admin blocking onedrive.live.com must not disable
  // any desktop process either.
  for (const root of EGRESS_SYNC_ROOTS) {
    for (const host of root.policyHosts) {
      assert.equal(processForHost(host), null);
      assert.deepEqual(processesForHost(host), []);
      assert.deepEqual(synthesizePlatformBlocks([{ host, product: root.product, blocked: true }]), []);
    }
  }
});

test('PLATFORM_PROCS names no egress process — an agent-scoped block can never reach a mail client', () => {
  const egressProcs = new Set(EGRESS_SURFACES.flatMap((s) => s.procs.map((p) => String(p).toLowerCase())));
  for (const [platform, procs] of Object.entries(PLATFORM_PROCS)) {
    for (const proc of procs) {
      assert.equal(egressProcs.has(String(proc).toLowerCase()), false,
        `PLATFORM_PROCS.${platform} names the egress process ${proc}`);
    }
  }
  // And no egress host is reachable as a platform host, so hostsForPlatform can
  // never put a mail client on the access-exception chain either.
  const egressHosts = new Set([
    ...EGRESS_SURFACES.map((s) => s.host),
    ...EGRESS_SYNC_ROOTS.flatMap((r) => r.policyHosts),
  ].map((h) => String(h).toLowerCase()));
  for (const platform of Object.keys(PLATFORM_PROCS)) {
    for (const host of hostsForPlatform(platform)) {
      assert.equal(egressHosts.has(host.toLowerCase()), false, `${platform} maps to the egress host ${host}`);
    }
  }
});

// ── The send-chord invariant ────────────────────────────────────────────────
//
// THE most dangerous mistake this catalog can contain, which is why it has its
// own tests. In an Outlook compose body plain Enter inserts a NEWLINE — it does
// not send. Swallowing it would not block a send; it would make writing an email
// impossible, in a mail client, with no visible cause. That is categorically
// worse than the miss it would be preventing.

test('EGRESS_SEND_CHORDS is a closed enum and contains no bare-Enter spelling', () => {
  assert.deepEqual([...EGRESS_SEND_CHORDS], ['ctrl_enter', 'alt_s']);
  // Frozen, so no consumer can push a chord into it at runtime.
  assert.throws(() => { EGRESS_SEND_CHORDS.push('enter'); });
  for (const bare of ['enter', 'return', 'vk_return', 'newline', 'Enter', 'RETURN']) {
    assert.equal(EGRESS_SEND_CHORDS.includes(bare.toLowerCase()), false,
      `${bare} must never be a recognised send chord — bare Enter inserts a newline in a compose body`);
  }
  // Every chord in the enum names a MODIFIER. A value that could be satisfied by
  // an unmodified keypress is what the invariant is really about.
  for (const chord of EGRESS_SEND_CHORDS) {
    assert.match(chord, /^(ctrl|alt|shift)_/, `${chord} names no modifier`);
  }
});

test('normalizeEgressSendKeys refuses bare Enter, unrecognised chords, and half-valid lists', () => {
  // The happy path first, so a refusal below cannot pass for the wrong reason.
  assert.deepEqual(normalizeEgressSendKeys(['ctrl_enter', 'alt_s'], null, 'x'), ['ctrl_enter', 'alt_s']);
  assert.deepEqual(normalizeEgressSendKeys(['CTRL_ENTER', ' alt_s '], null, 'x'), ['ctrl_enter', 'alt_s']);
  assert.deepEqual(normalizeEgressSendKeys(['alt_s', 'alt_s'], null, 'x'), ['alt_s'], 'de-duplicated');

  // BARE ENTER, in every spelling. null — not a filtered list — because dropping
  // the bad chord and keeping the rest would arm the surface with a chord set
  // nobody authored.
  for (const bad of ['enter', 'Enter', 'ENTER', 'return', 'vk_return', 'newline', 'send']) {
    assert.equal(normalizeEgressSendKeys([bad], null, 'x'), null, `${bad} must be refused`);
    assert.equal(normalizeEgressSendKeys(['ctrl_enter', bad], null, 'x'), null,
      `a list containing ${bad} must be refused WHOLE, not filtered`);
  }
  // Anything else unrecognised — including a plausible-looking typo.
  for (const bad of ['ctrl+enter', 'ctrlenter', 'shift_enter', 'alt_send', 'ctrl_s', '']) {
    assert.equal(normalizeEgressSendKeys([bad], null, 'x'), null, `${bad} must be refused`);
  }
  // A surface naming no chord at all can hold nothing, and must not load.
  assert.equal(normalizeEgressSendKeys([], null, 'x'), null);
  assert.equal(normalizeEgressSendKeys(null, null, 'x'), null);
  assert.equal(normalizeEgressSendKeys(undefined, null, 'x'), null);
  assert.equal(normalizeEgressSendKeys('ctrl_enter', null, 'x'), null, 'a bare string is not a chord list');
  // The refusal is REPORTED, with the reason, rather than being silent.
  const lines = [];
  normalizeEgressSendKeys(['enter'], { warn: (m) => lines.push(String(m)) }, 'outlook_test');
  assert.equal(lines.length, 1);
  assert.match(lines[0], /outlook_test/);
  assert.match(lines[0], /newline/i, 'the warning must say WHY bare Enter is refused');
});

test('a catalog entry with an unsafe sendKeys list is invisible to every consumer', () => {
  // The refusal is not advisory: an entry that fails validation must not load
  // anywhere, or it would be recognised as an egress surface (and therefore
  // read) while arming nothing — the worst of both.
  const bad = { id: 'bogus', procs: ['NOTEPAD'], sendKeys: ['enter'], host: 'x.example', policyHosts: ['x.example'] };
  const original = EGRESS_SURFACES.slice();
  EGRESS_SURFACES.push(bad);
  try {
    assert.equal(egressSurfaceForProcess('NOTEPAD'), null, 'egressSurfaceForProcess must not resolve it');
    assert.equal(isEgressProcess('NOTEPAD'), false, 'isEgressProcess must not resolve it');
    assert.equal(buildEgressSurfaceConfig(null).some((e) => e.id === 'bogus'), false,
      'buildEgressSurfaceConfig must drop it');
    const armed = synthesizeEgressSurfaces([{ host: 'x.example', governed: true, capture_mode: 'hold' }], null);
    assert.equal(armed.surfaces.some((s) => s.id === 'bogus'), false,
      'synthesizeEgressSurfaces must never arm it, even with a governed policy row');
  } finally {
    EGRESS_SURFACES.length = 0;
    EGRESS_SURFACES.push(...original);
  }
});

test('every egress entry ships with the two-flag gate CLOSED and its guesses marked', async () => {
  for (const surface of [...EGRESS_SURFACES, ...EGRESS_SYNC_ROOTS]) {
    assert.equal(typeof surface.enforce, 'boolean', `${surface.id} must state enforce explicitly`);
    assert.equal(typeof surface.verified, 'boolean', `${surface.id} must state verified explicitly`);
    // The same rule the other catalogs are held to: enforcing without a recorded
    // live pass is a catalog author claiming a verification that never happened.
    if (surface.enforce) assert.equal(surface.verified, true, `${surface.id} enforces without a live pass`);
  }
  // AS SHIPPED, both are false on every entry — nothing here arms in production
  // until a human runs a read-only UIA probe and flips them. This assertion is
  // meant to be UPDATED by that pass, together with the flags.
  for (const surface of [...EGRESS_SURFACES, ...EGRESS_SYNC_ROOTS]) {
    assert.equal(surface.verified, false, `${surface.id} claims a live probe — update this test with the evidence`);
    assert.equal(surface.enforce, false, `${surface.id} claims enforcement — update this test with the evidence`);
  }
  // Every UI signature is still a TODO, and stated as null rather than guessed
  // at. A null scopeWindow makes the chip diff report nothing; a null bodySig
  // disables body capture; a null recipientSig means no recipient read at all.
  for (const surface of EGRESS_SURFACES) {
    assert.equal(surface.scopeWindow, null, `${surface.id}: scopeWindow was filled in — was it live-probed?`);
    assert.equal(surface.bodySig, null, `${surface.id}: bodySig was filled in — was it live-probed?`);
    assert.equal(surface.recipientSig, null, `${surface.id}: recipientSig was filled in — was it live-probed?`);
  }
  // …and the catalog says so in as many words, at the process names and the
  // signatures, so a reader is never told a guess is a measurement.
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'ai-processes.js'), 'utf8');
  const block = src.slice(src.indexOf('export const EGRESS_SURFACES'), src.indexOf('export const EGRESS_SYNC_ROOTS'));
  assert.ok(block.length > 0);
  assert.ok((block.match(/TODO\(live-probe\)/g) || []).length >= 8,
    'every guessed process name and signature must carry a TODO(live-probe) marker');
});

test('an egress signature with only a control type is refused — it would match the whole window', () => {
  // A signature naming a ControlType and nothing else matches EVERY element of
  // that type. In a mail client that is the reading pane, the message list and
  // the search box; matching it would make the "scoped root" scoping meaningless.
  const original = EGRESS_SURFACES.slice();
  EGRESS_SURFACES.push({
    id: 'too_broad', procs: ['NOTEPAD'], sendKeys: ['alt_s'],
    host: 'x.example', policyHosts: ['x.example'],
    scopeWindow: { controlType: 'Pane' },
    bodySig: { controlType: 'Document', classEquals: 'ok' },
    captureBody: 'full', detect: 'file_dialog',
  });
  try {
    const entry = buildEgressSurfaceConfig(null).find((e) => e.id === 'too_broad');
    assert.ok(entry, 'the entry itself is otherwise valid and should load');
    assert.equal(entry.scopeWindow, null, 'a control-type-only signature must be dropped');
    assert.deepEqual(entry.bodySig, {
      controlType: 'Document', nameEquals: '', namePrefix: '', classEquals: 'ok', classPrefix: '',
    }, 'a signature with a real rule survives');
  } finally {
    EGRESS_SURFACES.length = 0;
    EGRESS_SURFACES.push(...original);
  }
});

test('synthesizeEgressSurfaces arms NOTHING without a governed ai_platforms row', () => {
  // THE policy gate, and the whole reason the feature is inert by default. Every
  // downstream consumer reads the file this produces: no row means no process is
  // watched, no compose body is read, no picker is recognised and no
  // FileSystemWatcher is opened.
  for (const rows of [
    [],
    null,
    undefined,
    [{ host: 'outlook.office.com' }],                                   // no governed field
    [{ host: 'outlook.office.com', governed: false }],
    [{ host: 'outlook.office.com', governed: 1 }],                       // truthy is NOT true
    [{ host: 'outlook.office.com', blocked: true }],                     // blocked is a different question
    [{ host: 'chatgpt.com', governed: true }],                           // a governed row for a DIFFERENT host
    [{ host: 'outlook.office.com', governed: true, capture_mode: 'x' }].map((r) => ({ ...r, governed: 'yes' })),
  ]) {
    const out = synthesizeEgressSurfaces(rows, null);
    assert.deepEqual(out.surfaces, [], `armed a surface for ${JSON.stringify(rows)}`);
    assert.deepEqual(out.sync_roots, [], `armed a sync root for ${JSON.stringify(rows)}`);
  }
});

test('synthesizeEgressSurfaces requires surface:desktop|all — governed alone is not consent to DESKTOP monitoring', () => {
  // outlook.office.com and sharepoint.com are ALREADY governed, with
  // surface:'browser', on every existing deployment — seeded at server startup
  // for the pre-existing browser Copilot-panel feature (server/src/seed-
  // platforms.js). If `governed` alone were enough here, the day a human
  // live-probes the catalog and flips its two flags, EVERY deployment would
  // start reading Outlook attachments and bodies with no admin having
  // separately opted a host into desktop mail monitoring. `surface` is that
  // separate opt-in, and this is where it must actually be enforced.
  for (const surface of ['browser', 'cli', '', undefined, null, 'BROWSER']) {
    const out = synthesizeEgressSurfaces([{ host: 'outlook.office.com', governed: true, capture_mode: 'hold', surface }], null);
    assert.deepEqual(out.surfaces, [], `surface=${JSON.stringify(surface)} must not arm a desktop mail surface`);
  }
  for (const surface of ['browser', 'cli', '', undefined]) {
    const out = synthesizeEgressSurfaces([{ host: 'onedrive.live.com', governed: true, capture_mode: 'observe', surface }], null);
    assert.deepEqual(out.sync_roots, [], `surface=${JSON.stringify(surface)} must not arm the sync watcher`);
  }
  // 'desktop' and 'all' both count, and comparison is case/whitespace-insensitive
  // — same normalization the .ps1 side already applies to every other field here.
  for (const surface of ['desktop', 'all', 'DESKTOP', ' all ']) {
    const out = synthesizeEgressSurfaces([{ host: 'outlook.office.com', governed: true, capture_mode: 'hold', surface }], null);
    assert.ok(out.surfaces.length > 0, `surface=${JSON.stringify(surface)} should arm`);
  }
});

test('synthesizeEgressSurfaces arms only the surfaces the governed+desktop hosts name, with their capture_mode', () => {
  const mailOnly = synthesizeEgressSurfaces([
    { host: 'outlook.office.com', governed: true, capture_mode: 'hold', surface: 'desktop' },
  ], null);
  assert.deepEqual(mailOnly.surfaces.map((s) => s.id), ['outlook_classic', 'outlook_new']);
  assert.deepEqual(mailOnly.surfaces.map((s) => s.capture_mode), ['hold', 'hold']);
  assert.deepEqual(mailOnly.surfaces.map((s) => s.policy_host), ['outlook.office.com', 'outlook.office.com']);
  // A governed MAIL policy must not arm the cloud-sync watcher — they are
  // different hosts and different decisions.
  assert.deepEqual(mailOnly.sync_roots, [], 'a mail policy must not arm filesystem observation');

  const syncOnly = synthesizeEgressSurfaces([
    { host: 'onedrive.live.com', governed: true, capture_mode: 'observe', surface: 'all' },
  ], null);
  assert.deepEqual(syncOnly.surfaces, [], 'a sync policy must not arm a mail client');
  assert.deepEqual(syncOnly.sync_roots.map((r) => r.id), ['onedrive_sharepoint']);
  assert.equal(syncOnly.sync_roots[0].capture_mode, 'observe');
  // The two-flag gate travels, so the consumer can refuse an unverified root.
  assert.equal(syncOnly.sync_roots[0].verified, false);
  assert.equal(syncOnly.sync_roots[0].enforce, false);

  // capture_mode: 'hold' is the ONLY value that can ever swallow a keystroke, so
  // an unrecognised one must land on the weakest of the three rather than being
  // trusted.
  for (const [mode, expected] of [
    ['hold', 'hold'], ['block_critical', 'block_critical'], ['observe', 'observe'],
    ['HOLD', 'hold'], ['', 'observe'], [null, 'observe'], ['something_new', 'observe'],
  ]) {
    const out = synthesizeEgressSurfaces([{ host: 'outlook.office.com', governed: true, capture_mode: mode, surface: 'desktop' }], null);
    assert.equal(out.surfaces[0].capture_mode, expected, `capture_mode ${JSON.stringify(mode)}`);
  }
  // Two rows arming one surface: the STRONGEST mode wins, so array order cannot
  // decide what a policy means.
  const both = synthesizeEgressSurfaces([
    { host: 'outlook.office.com', governed: true, capture_mode: 'observe', surface: 'desktop' },
    { host: 'outlook.office.com', governed: true, capture_mode: 'hold', surface: 'desktop' },
  ], null);
  assert.equal(both.surfaces[0].capture_mode, 'hold');
});

test('buildEgressSurfaceConfig strips the characters that would break the .ps1 JSON parser', () => {
  // Same discipline synthesizePlatformBlocks is held to, and for the same
  // reason: enforcer-win.ps1 parses egress-surfaces.json with the hand-rolled
  // extractor, where one stray quote, backslash or brace in one value derails
  // the WHOLE payload rather than its own row.
  const original = EGRESS_SURFACES.slice();
  EGRESS_SURFACES.push({
    id: 'ev"il\\ {id}', procs: ['NOTE"PAD'], sendKeys: ['alt_s'],
    host: 'x"y', policyHosts: ['a{b}'],
    scopeWindow: { controlType: 'Pane', classEquals: 'cls"{}' },
  });
  try {
    const entry = buildEgressSurfaceConfig(null).find((e) => e.id === 'evil id');
    assert.ok(entry, 'the sanitised id should be findable');
    const flat = JSON.stringify(entry);
    assert.equal(flat.includes('\\'), false, 'a round trip through the real serialiser must produce no escapes');
    assert.equal(/["{}]/.test(entry.procs.join('') + entry.host + entry.policyHosts.join('')), false);
  } finally {
    EGRESS_SURFACES.length = 0;
    EGRESS_SURFACES.push(...original);
  }
});

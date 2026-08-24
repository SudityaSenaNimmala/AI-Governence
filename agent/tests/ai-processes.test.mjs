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

test('synthesizePlatformBlocks only emits rows that are blocked AND resolve to a desktop app', () => {
  const rows = synthesizePlatformBlocks([
    { host: 'claude.ai',   product: 'Claude',    vendor: 'Anthropic',  blocked: true  },
    { host: 'chatgpt.com', product: 'ChatGPT',   vendor: 'OpenAI',     blocked: false },  // not blocked
    { host: 'lovable.dev', product: 'Lovable',   vendor: 'Lovable',    blocked: true  },  // no desktop app
    { host: 'cursor.com',  product: 'Cursor',    vendor: 'Anysphere',  blocked: true  },  // excluded IDE
    { host: 'github.com',  product: 'Copilot',   vendor: 'GitHub',     blocked: true  },  // excluded IDE plugin
  ]);
  assert.deepEqual(rows, [{
    platform: PLATFORM_BLOCK_SENTINEL,
    process_name: 'claude',
    agent_name: 'Claude',
    agent_id: '',
    host: 'claude.ai',
    reason: 'Blocked by organization policy',
  }]);
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
  const [a, b] = synthesizePlatformBlocks([
    { host: 'claude.ai',  vendor: 'Anthropic', product: null, blocked: true },
    { host: 'chatgpt.com', vendor: null,       product: null, blocked: true },
  ]);
  assert.equal(a.agent_name, 'Anthropic');
  assert.equal(b.agent_name, 'chatgpt.com');
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
  assert.deepEqual(rows.map((r) => r.process_name), ['claude', 'copilot', 'm365copilot']);
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
  const kept = filterBlockedAgents(list, [{ tool_host: 'CLAUDE.AI' }]);
  assert.deepEqual(kept.map((r) => r.host || r.agent_id), ['chatgpt.com', 'a1']);
  // An exception for the agent-block row's platform host still lifts only that
  // row — the host-keyed chatgpt.com platform row is a separate decision.
  assert.deepEqual(
    filterBlockedAgents(list, [{ tool_host: 'chatgpt.com' }]).map((r) => r.host || r.agent_id),
    ['claude.ai'],
  );
});

// AI Hub's Prompts tab for the Microsoft 365 agent routes (2026-09-24).
//
// The enforcer emits {kind:"prompt_text"} for a SENSITIVE prompt typed into an
// AI-evidence route (the Teams agent 1:1 chat, the Teams Copilot tab, the Word /
// Excel / PowerPoint / OneNote / Outlook Copilot panes). index.js must report it
// as the same prompt_typed (or prompt_paste) record ChatGPT/Claude desktop get —
// same content fields — with the per-route service name, NO window title, and
// agent attribution by the row/sole/none rules. Nothing here spawns a process.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { OsMonitor } from '../src/os_monitor/index.js';
import { lengthBucket } from '../src/os_monitor/classifier.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const AGENT_DIR = join(__dirname, '..');

function inertWatcher() {
  const stub = new EventEmitter();
  stub.start = () => {};
  stub.stop = () => {};
  return stub;
}

function makeMonitor({ fleetStatePath = join(mkdtempSync(join(tmpdir(), 'cfai-fleet-')), 'fleet-evidence-dlp.json') } = {}) {
  const lines = [];
  const log = {
    info: (m) => lines.push(String(m)), warn: (m) => lines.push(String(m)),
    error: (m) => lines.push(String(m)), debug: (m) => lines.push(String(m)),
  };
  log.child = () => log;
  const reported = [];
  const evidenceDlp = [];
  const monitor = new OsMonitor({ serverUrl: '', token: '', log, enforcerEnabled: false, fleetStatePath });
  monitor.poller = inertWatcher();
  monitor.dialogWatcher = inertWatcher();
  monitor.attachmentWatcher = inertWatcher();
  monitor.promptWatcher = inertWatcher();
  monitor.enforcer = Object.assign(new EventEmitter(), {
    start() {}, stop() {}, attachHold() {}, updateBlockPatterns() {}, tokenize() {},
    setEvidenceDlp: (on) => evidenceDlp.push(on),
  });
  monitor.toast = { start() {}, stop() {}, show() {} };
  monitor.reporter = { start() {}, stop() {}, enqueue: (e) => reported.push(e) };
  monitor.policySync.start = () => {};
  monitor.featureSync.start = () => {};
  monitor.start();
  return { monitor, reported, lines, evidenceDlp, fleetStatePath };
}

const SECRET = 'please check ssn 123-45-6789 for me';

// One enforcer prompt_text per route, exactly as EmitEvidencePrompt writes it.
const ROUTES = [
  { process: 'ms-teams', panel: 'teams_composer', surface: 'teams_desktop', agent: 'IT Help Desk Agent', agent_id: 'ag-1', agent_src: 'row',
    service: 'Microsoft Teams (agent)' },
  { process: 'ms-teams', panel: 'teams_copilot_composer', surface: 'teams_desktop', agent: 'Microsoft 365 Copilot', agent_id: '', agent_src: 'sole',
    service: 'Microsoft Copilot (Teams)' },
  { process: 'WINWORD', panel: 'office_copilot_pane', surface: 'office_copilot_pane_agent', agent: 'Microsoft 365 Copilot', agent_id: '', agent_src: 'sole',
    service: 'Word Copilot' },
  { process: 'EXCEL', panel: 'office_copilot_pane', agent: 'Microsoft 365 Copilot', agent_id: '', agent_src: 'sole', service: 'Excel Copilot' },
  { process: 'POWERPNT', panel: 'office_copilot_pane', agent: 'Microsoft 365 Copilot', agent_id: '', agent_src: 'sole', service: 'PowerPoint Copilot' },
  { process: 'ONENOTE', panel: 'office_copilot_pane', agent: 'Microsoft 365 Copilot', agent_id: '', agent_src: 'sole', service: 'OneNote Copilot' },
  { process: 'OUTLOOK', panel: 'outlook_copilot_pane', agent: 'Microsoft 365 Copilot', agent_id: '', agent_src: 'sole', service: 'Outlook Copilot' },
  { process: 'olk', panel: 'outlook_copilot_pane', agent: 'Microsoft 365 Copilot', agent_id: '', agent_src: 'sole', service: 'Outlook Copilot' },
];

function emit(route, extra = {}) {
  const h = makeMonitor();
  try {
    h.monitor.enforcer.emit('prompt_text', {
      kind: 'prompt_text', process: route.process, panel: route.panel, cause: 'typed',
      text: SECRET, len: SECRET.length, agent: route.agent, agent_id: route.agent_id,
      agent_src: route.agent_src, ...(route.surface ? { surface: route.surface } : {}), ...extra,
    });
  } finally { h.monitor.stop(); }
  return h;
}

test('every M365 agent route produces a prompt_typed record with the per-route service name', () => {
  for (const route of ROUTES) {
    const { reported } = emit(route);
    const ev = reported.find((e) => e.kind === 'prompt_typed');
    assert.ok(ev, `${route.process}/${route.panel}: no prompt_typed record`);
    assert.equal(ev.service, route.service, route.panel);
    assert.equal(ev.vendor, 'Microsoft');
    assert.equal(ev.process_name, route.process);
  }
});

test('content fields are EXACTLY the ChatGPT/Claude desktop prompt_typed fields — no new data class', () => {
  const { reported } = emit(ROUTES[0]);
  const ev = reported.find((e) => e.kind === 'prompt_typed');
  assert.equal(ev.content_text, SECRET);
  assert.equal(ev.content_length, SECRET.length);
  assert.equal(ev.length_bucket, lengthBucket(SECRET.length));
  assert.equal(ev.source, 'os_monitor_uia');
  assert.ok(Array.isArray(ev.matches) && ev.matches.some((m) => m.pattern));
  assert.ok(ev.highest_severity);
  // …compared field-for-field with the watcher path's own record.
  const h = makeMonitor();
  try {
    h.monitor.promptWatcher.emit('prompt_text', { process: 'claude', title: 'Claude', text: SECRET, len: SECRET.length, panel: '' });
  } finally { h.monitor.stop(); }
  const watcher = h.reported.find((e) => e.kind === 'prompt_typed');
  const shared = ['kind', 'source', 'content_text', 'content_length', 'length_bucket', 'matches', 'highest_severity'];
  for (const k of shared) assert.deepEqual(ev[k], watcher[k], k);
  // The watcher path keeps its title exactly as before.
  assert.equal(watcher.window_title, 'Claude');
});

test('NO window title for these routes — a Teams title names colleagues, an Outlook title is a subject', () => {
  for (const route of ROUTES) {
    const { reported } = emit(route, { title: 'Chat | Sruthi Chimata | CloudFuze | p@cloudfuze.com | Microsoft Teams' });
    const ev = reported.find((e) => e.kind === 'prompt_typed');
    assert.equal('window_title' in ev, false, route.panel);
    assert.equal(JSON.stringify(ev).includes('Sruthi'), false);
  }
});

test('agent attribution follows the row / sole / none rules, never a UI-read name', () => {
  const row = emit(ROUTES[0]).reported.find((e) => e.kind === 'prompt_typed');
  assert.equal(row.agent_name, 'IT Help Desk Agent');
  assert.equal(row.agent_id, 'ag-1');
  assert.equal(row.agent_scope, 'agent');
  assert.equal(row.surface, 'teams_composer', 'the panel id wins over the agent-surface id');
  const sole = emit(ROUTES[2]).reported.find((e) => e.kind === 'prompt_typed');
  assert.equal(sole.agent_name, 'Microsoft 365 Copilot');
  assert.equal(sole.agent_scope, 'panel');
  assert.equal('agent_id' in sole, false);
  // No provenance claim → no agent fields, whatever the event carries.
  const none = emit({ ...ROUTES[0], agent_src: 'none' }).reported.find((e) => e.kind === 'prompt_typed');
  assert.equal('agent_name' in none, false);
  const bogus = emit({ ...ROUTES[0], agent: 'Secret Project Bot', agent_src: 'ui_read' }).reported.find((e) => e.kind === 'prompt_typed');
  assert.equal('agent_name' in bogus, false);
  assert.equal(JSON.stringify(bogus).includes('Secret Project Bot'), false);
});

test('a paste on an evidence route is reported as prompt_paste, with the same content fields', () => {
  const { reported } = emit(ROUTES[2], { cause: 'paste' });
  assert.equal(reported.some((e) => e.kind === 'prompt_typed'), false);
  const ev = reported.find((e) => e.kind === 'prompt_paste');
  assert.ok(ev);
  assert.equal(ev.service, 'Word Copilot');
  assert.equal(ev.content_text, SECRET);
  assert.equal('window_title' in ev, false);
});

test('a clean prompt, an unknown panel and an unknown process are dropped', () => {
  const clean = emit(ROUTES[0], { text: 'hello there, how are you', len: 24 });
  assert.equal(clean.reported.some((e) => /^prompt_/.test(e.kind)), false, 'only sensitive prompts are recorded');
  const unknown = emit({ ...ROUTES[0], panel: 'not_a_panel', process: 'notepad' });
  assert.equal(unknown.reported.some((e) => /^prompt_/.test(e.kind)), false);
});

test('log lines carry product and pattern names only — no text, no agent', () => {
  const { lines } = emit(ROUTES[0]);
  assert.ok(lines.some((l) => l.includes('typed into Microsoft Teams (agent)')));
  for (const l of lines) {
    for (const forbidden of ['123-45-6789', 'IT Help Desk Agent', 'ag-1', 'please check']) {
      assert.equal(l.includes(forbidden), false, `a log line carried ${forbidden}: ${l}`);
    }
  }
});

test('L3: before the fleet answers, the evidence routes are OFF — or the PERSISTED last-known fleet value', () => {
  // No persisted value: OFF, even though start() applies the pre-fetch
  // "everything on" defaults to the file watchers.
  const cold = makeMonitor();
  cold.monitor.stop();
  assert.deepEqual(cold.evidenceDlp, [false]);
  // A persisted last-known fleet value of ON is honoured at start.
  const dir = mkdtempSync(join(tmpdir(), 'cfai-fleet-'));
  const path = join(dir, 'fleet-evidence-dlp.json');
  writeFileSync(path, JSON.stringify({ dlp: true }));
  const warm = makeMonitor({ fleetStatePath: path });
  warm.monitor.stop();
  assert.deepEqual(warm.evidenceDlp, [true]);
  // A corrupt record reads as OFF.
  writeFileSync(path, '{not json');
  const corrupt = makeMonitor({ fleetStatePath: path });
  corrupt.monitor.stop();
  assert.deepEqual(corrupt.evidenceDlp, [false]);
});

test('L3: a REAL fleet result is pushed to the enforcer and persisted for the next start', () => {
  const h = makeMonitor();
  try {
    h.monitor.featureSync.onChange({ features: { dlp: true }, changed: ['dlp'] });
    assert.deepEqual(h.evidenceDlp, [false, true]);
    assert.equal(JSON.parse(readFileSync(h.fleetStatePath, 'utf8')).dlp, true);
    h.monitor.featureSync.onChange({ features: { dlp: false }, changed: ['dlp'] });
    assert.deepEqual(h.evidenceDlp, [false, true, false]);
    assert.equal(JSON.parse(readFileSync(h.fleetStatePath, 'utf8')).dlp, false);
  } finally { h.monitor.stop(); }
});

test('H3: the enforcer prompt_text upload needs BOTH fleet dlp AND clipboard_monitor', () => {
  for (const off of ['dlp', 'clipboard_monitor']) {
    const h = makeMonitor();
    try {
      h.monitor.running[off] = false;
      h.monitor.enforcer.emit('prompt_text', {
        kind: 'prompt_text', process: 'WINWORD', panel: 'office_copilot_pane', cause: 'typed',
        text: SECRET, len: SECRET.length, agent: 'Microsoft 365 Copilot', agent_id: '', agent_src: 'sole',
      });
    } finally { h.monitor.stop(); }
    assert.equal(h.reported.some((e) => /^prompt_/.test(e.kind)), false, `${off} off: nothing may be uploaded`);
  }
});

test('the M365 Copilot APP keeps its prompt-watcher record, now named "Microsoft 365 Copilot"', () => {
  const h = makeMonitor();
  try {
    h.monitor.promptWatcher.emit('prompt_text', { process: 'M365Copilot', title: 'Message Copilot', text: SECRET, len: SECRET.length, panel: '' });
  } finally { h.monitor.stop(); }
  const ev = h.reported.find((e) => e.kind === 'prompt_typed');
  assert.equal(ev.service, 'Microsoft 365 Copilot');
  assert.equal(ev.vendor, 'Microsoft');
});

test('source: enforcer.js forwards prompt_text without logging it; index.js wires both producers to one reporter', async () => {
  const enf = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'enforcer.js'), 'utf8');
  const c = enf.slice(enf.indexOf("case 'prompt_text':"), enf.indexOf('break;', enf.indexOf("case 'prompt_text':")));
  assert.match(c, /this\.emit\('prompt_text', ev\);/);
  assert.equal(/this\.log/.test(c), false, 'the event carries prompt text and must never be logged');
  const idx = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'index.js'), 'utf8');
  assert.match(idx, /this\.promptWatcher\.on\('prompt_text', \(ev\) => this\.#reportPromptText\(ev, \{ fromEnforcer: false \}\)\);/);
  const listener = idx.slice(idx.indexOf("this.enforcer.on('prompt_text'"), idx.indexOf("this.enforcer.on('prompt_text'") + 250);
  assert.match(listener, /if \(!this\.running\.dlp \|\| !this\.running\.clipboard_monitor\) return;/);
  assert.match(listener, /this\.#reportPromptText\(ev, \{ fromEnforcer: true \}\);/);
  // L4: a malformed prompt_text line is never echoed into the log.
  const onStdout = enf.slice(enf.indexOf('#onStdout(chunk) {'), enf.indexOf('#dispatch(ev) {'));
  assert.match(onStdout, /if \(line\.startsWith\('\{"kind":"prompt_text"'\)\) this\.log\?\.warn\('enforcer: malformed prompt_text line dropped'\);/);
  // L3: OFF by default on this side too, and only a real `true` turns it on.
  assert.match(enf, /this\.evidenceDlp = false;/);
  assert.match(enf, /this\.evidenceDlp = on === true;/);
  assert.match(idx, /\.\.\.\(fromEnforcer \? \{\} : \{ window_title: ev\.title \}\)/);
});

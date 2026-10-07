// HOW LONG A ROUTE HOLDS THE PROMPT: Enter -> switch -> send -> report.
//
// Live (2026-10-07, agent 35419d9f, Gemini in Edge via the desktop agent's web
// arm): "there is a lag for each model routing change", and model_routed landed
// 1.5s after the route's own send. Measured with tests/helpers/route-latency-
// harness.ps1 against a scripted, typical world (items render in 20ms, the
// switch lands 100ms after the select, the menu closes 30ms after Collapse(),
// the composer empties 120ms after the Enter). The harness counts the route's
// WAITING -- fixed sleeps read from the source plus the REAL poll loops on a
// fake clock -- not UIA call costs, which did not change.
//
// Before (HEAD 74e47cc), both arms:            after (this change):
//   Expand -> items     150 ms fixed sleep        30 ms polled
//   Select -> wait      300 ms fixed sleep         0 ms
//   switch wait         120 ms poll              120 ms poll (30ms cadence)
//   collapse             80 ms fixed             40 ms polled
//   pre-Enter gate      150 ms (one settle)      150 ms (unchanged: invariant)
//   = Enter -> send     800 ms of waiting        340 ms
//   after the Enter    1500 ms web / 200 desk    150 ms (polled, early exit)
//   = Enter -> report  2300 ms web               490 ms
//
// These bounds fail if a fixed wait creeps back onto the path.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, mkdtemp } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const AGENT_DIR = join(HERE, '..');
const ENFORCER = join(AGENT_DIR, 'src', 'os_monitor', 'enforcer-win.ps1');
const HARNESS = join(HERE, 'helpers', 'route-latency-harness.ps1');

const win = process.platform === 'win32';
const winOnly = { skip: !win && 'harness compiles the enforcer C# and needs Windows PowerShell' };

const { buildLexiconConfig } = await import(
  pathToFileURL(join(AGENT_DIR, 'src', 'os_monitor', 'model-router-config.js')).href);

let cached = null;
function runHarness() {
  if (cached) return cached;
  cached = (async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cfai-lat-'));
    const cfg = join(dir, 'router-config.json');
    await writeFile(cfg, JSON.stringify(buildLexiconConfig()), 'utf8');
    return new Promise((resolve, reject) => {
      const child = spawn('powershell', [
        '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
        '-File', HARNESS, '-Ps1', ENFORCER, '-RouterConfig', cfg,
      ], { windowsHide: true });
      let out = '';
      let err = '';
      child.stdout.on('data', (d) => { out += d; });
      child.stderr.on('data', (d) => { err += d; });
      child.on('error', reject);
      child.on('close', (code) => {
        const rows = out.split(/\r?\n/).filter((l) => l.trim().startsWith('{'))
          .map((l) => { try { return JSON.parse(l); } catch { return null; } })
          .filter(Boolean);
        if (!rows.some((r) => r.t === 'done')) {
          reject(new Error(`harness did not complete (exit ${code})\n${err}\n${out}`));
          return;
        }
        resolve(rows);
      });
    });
  })();
  return cached;
}

const loop = (rows, name) => {
  const r = rows.find((x) => x.t === 'loop' && x.name === name);
  assert.ok(r, `no ${name} row`);
  return r;
};

test('latency: no fixed sleep between Expand() and the item search, or between Select() and the switch wait', winOnly, async () => {
  const rows = await runHarness();
  for (const arm of ['web', 'desktop']) {
    const f = rows.find((r) => r.t === 'fixed' && r.arm === arm);
    assert.ok(f, arm);
    assert.equal(f.expandFixedMs, 0, `${arm}: the menu render is polled, not slept`);
    assert.equal(f.expandPolled, true, `${arm}: RouteAwaitMenuItems`);
    assert.equal(f.preAwaitFixedMs, 0, `${arm}: no settle sleep before the switch wait (was 300ms)`);
  }
});

test('latency: Enter -> send waits under 400ms and Enter -> report under 600ms on a typical switch', winOnly, async (t) => {
  const rows = await runHarness();
  const menu = loop(rows, 'menu_render');
  const sw = loop(rows, 'switch_wait');
  const col = loop(rows, 'collapse');
  const gate = loop(rows, 'gate');
  assert.equal(sw.switched, true);
  assert.equal(col.closed, true);
  assert.equal(gate.ok, true);
  assert.ok(menu.ms <= 60, `menu render poll ${menu.ms}ms`);
  assert.ok(col.ms <= 60, `collapse ${col.ms}ms (was a fixed 80ms)`);
  assert.equal(gate.ms, 150, 'the gate keeps its one 150ms settle re-check (the Gemini focus hand-back invariant)');
  const toSend = menu.ms + sw.ms + col.ms + gate.ms;
  for (const arm of ['web', 'desktop']) {
    const after = loop(rows, 'after_enter_' + arm);
    assert.equal(after.submitted, true);
    assert.ok(after.ms <= 200, `${arm}: the post-send read exits once the composer empties (was ${arm === 'web' ? 1500 : 200}ms flat), got ${after.ms}`);
    const toReport = toSend + after.ms;
    t.diagnostic(`${arm}: Enter->send waits ${toSend}ms (HEAD 800ms), Enter->report ${toReport}ms (HEAD ${arm === 'web' ? 2300 : 1000}ms)`);
    assert.ok(toSend < 400, `${arm}: Enter -> send ${toSend}ms`);
    assert.ok(toReport < 600, `${arm}: Enter -> report ${toReport}ms`);
  }
});

test('latency: a held Enter\'s decision fits its budget (stable read + the real classifier)', winOnly, async (t) => {
  const rows = await runHarness();
  const h = rows.find((r) => r.t === 'held');
  assert.ok(h, 'held row');
  t.diagnostic(`classify ms per prompt: ${h.classifyMsPerPrompt.join(', ')}; stable read ${h.stableReadMs}ms; budget ${h.budgetMs}ms`);
  assert.ok(h.classifyMaxMs + 2 * h.stableReadMs < h.budgetMs, 'decide = two stable reads + classify, well inside the budget');
});

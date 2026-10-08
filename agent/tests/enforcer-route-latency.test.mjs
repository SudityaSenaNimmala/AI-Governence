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
//   pre-Enter gate      150 ms (one settle)       50 ms (re-check anchored on the
//                                                        menu's quiet time, 6323ae9+1)
//   = Enter -> send     800 ms of waiting        240 ms (340 at 6323ae9)
//   after the Enter    1500 ms web / 200 desk    150 ms (polled, early exit)
//   = Enter -> report  2300 ms web               390 ms (490 at 6323ae9)
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
  assert.ok(gate.ms > 0 && gate.ms <= 60, `the gate keeps ONE hand-back re-check, 40-60ms with the menu's quiet time unknown (was a flat 150ms), got ${gate.ms}`);
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

// 2026-10-07 (Gemini in Edge, web arm; Claude Desktop similar): "it changed the
// model but the prompt is being sent with a lag. It needs to be sent
// immediately after the model is changed." The wait between the switch reading
// back and the ONE Enter, on the real loops:
//                               HEAD 98632ab           this change
//   web, focus on composer      collapse 40 + gate 150 = 190   40 + 50 = 90
//   web, focus handed back      40 + refocus 120 + 150 = 310   40 + 30 + 50 = 120
//   desktop, focus on composer  gate 150                       50
//   desktop, focus handed back  refocus 120 + 150 = 270        30 + 50 = 80
// (desktop runs no RouteCollapseMenu on the happy path: TryCollapsePicker, then
// the refocus, then the gate, whose own menu check collapses only if needed.)
test('latency: switch verified -> Enter waits <= 150ms on web and desktop, focus on the composer or handed back', winOnly, async (t) => {
  const rows = await runHarness();
  const col = loop(rows, 'collapse');
  const gate = loop(rows, 'gate');
  const ok = loop(rows, 'refocus_ok');
  const back = loop(rows, 'refocus_handback');
  assert.equal(ok.ok, true);
  assert.equal(back.ok, true);
  assert.equal(ok.ms, 0, 'focus already on the composer: the refocus does nothing');
  assert.equal(back.focuses, 1);
  assert.equal(back.clicks, 0, 'a SetFocus that landed is never followed by a click');
  assert.ok(back.ms <= 40, `SetFocus -> focus seen is polled (was a flat 120ms), got ${back.ms}`);
  const cases = {
    web_focus_ok: col.ms + ok.ms + gate.ms,
    web_handback: col.ms + back.ms + gate.ms,
    desktop_focus_ok: ok.ms + gate.ms,
    desktop_handback: back.ms + gate.ms,
  };
  for (const [k, v] of Object.entries(cases)) {
    t.diagnostic(`switch verified -> Enter, ${k}: ${v}ms`);
    assert.ok(v <= 150, `${k}: switch verified -> Enter waits ${v}ms`);
  }
});

test('latency: a held Enter\'s decision fits its budget (stable read + the real classifier)', winOnly, async (t) => {
  const rows = await runHarness();
  const h = rows.find((r) => r.t === 'held');
  assert.ok(h, 'held row');
  t.diagnostic(`classify ms per prompt: ${h.classifyMsPerPrompt.join(', ')}; stable read ${h.stableReadMs}ms; budget ${h.budgetMs}ms`);
  assert.ok(h.classifyMaxMs + 2 * h.stableReadMs < h.budgetMs, 'decide = two stable reads + classify, well inside the budget');
});

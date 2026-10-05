// The desktop enforcer's C# complexity classifier, held in LOCKSTEP with the
// canonical browser-extension/content/complexity.js.
//
// WHY THIS EXISTS — a live bug. Claude Desktop, user types "hi" on Sonnet: the
// enforcer reported model_routed noop, complexity "moderate", to_tier standard,
// reason already_on_target. The browser classifier says "hi" is simple (Haiku).
// Two independent faults produced that, and neither was visible to any test:
//
//   1. The packaged agent has no browser-extension/ tree next to it, so
//      model-router-config.js could not read complexity.js and shipped a config
//      with ZERO categories. The C# side loaded it happily and scored every
//      prompt 0 -> 'moderate'. (Now: the agent's own generated copy is read as a
//      fallback, and an empty lexicon classifies as 'unknown', which never routes.)
//   2. The C# port had silently fallen behind the JS: step 3b (pure arithmetic,
//      classifier 1.2.0) was never ported, so "what is 2+2" was simple in the
//      browser and moderate on the desktop; and .NET's Unicode-wide \b \w \s
//      differ from JS's for non-ASCII text.
//
// The only existing coverage compared the extracted DATA, never the C# SCORING.
// This test runs every prompt in shared/complexity-corpus.json through BOTH the
// canonical classifyDetailed() and the compiled C# ClassifyComplexityDetailed
// (tests/helpers/complexity-lockstep-harness.ps1) and requires verdict, deciding
// rule and score to be identical — for the canonical-source config AND for the
// agent-copy config the packaged binary actually ships.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { writeFile, mkdtemp } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const AGENT_DIR = join(HERE, '..');
const REPO = join(AGENT_DIR, '..');
const ENFORCER = join(AGENT_DIR, 'src', 'os_monitor', 'enforcer-win.ps1');
const HARNESS = join(HERE, 'helpers', 'complexity-lockstep-harness.ps1');
const CORPUS = JSON.parse(readFileSync(join(REPO, 'shared', 'complexity-corpus.json'), 'utf8'));

const { buildLexiconConfig, _paths } = await import(
  pathToFileURL(join(AGENT_DIR, 'src', 'os_monitor', 'model-router-config.js')).href);

function loadCanonical() {
  const win = {};
  // eslint-disable-next-line no-new-func
  new Function('window', readFileSync(join(REPO, 'browser-extension', 'content', 'complexity.js'), 'utf8'))(win);
  return win.__cfaiComplexity;
}
const canonical = loadCanonical();

const win = process.platform === 'win32';
const SKIP = { skip: win ? false : 'windows only (compiles the embedded C#)' };

const CONFIGS = {
  canonical: buildLexiconConfig(),
  agent_copy: buildLexiconConfig([_paths.AGENT_COMPLEXITY_JS_PATH]),
  none: buildLexiconConfig([join(tmpdir(), 'cfai-no-such-complexity.js')]),
};

let cached = null;
function runHarness() {
  if (cached) return cached;
  cached = (async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cfai-cx-'));
    const cfgLines = [];
    for (const [name, cfg] of Object.entries(CONFIGS)) {
      const p = join(dir, `${name}.json`);
      await writeFile(p, JSON.stringify(cfg), 'utf8');
      cfgLines.push(JSON.stringify({ name, path: p }));
    }
    const configsPath = join(dir, 'configs.ndjson');
    const casesPath = join(dir, 'cases.ndjson');
    await writeFile(configsPath, cfgLines.join('\n'), 'utf8');
    await writeFile(casesPath, CORPUS.cases.map((c) => JSON.stringify({
      id: c.id, b64: Buffer.from(c.text, 'utf8').toString('base64'),
    })).join('\n'), 'utf8');
    return new Promise((resolve, reject) => {
      const child = spawn('powershell', [
        '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
        '-File', HARNESS, '-Ps1', ENFORCER, '-Configs', configsPath, '-Cases', casesPath,
      ], { windowsHide: true });
      let out = '';
      let err = '';
      child.stdout.on('data', (d) => { out += d; });
      child.stderr.on('data', (d) => { err += d; });
      child.on('error', reject);
      child.on('close', (code) => {
        const lines = out.split(/\r?\n/).filter((l) => l.trim().startsWith('{')).map((l) => JSON.parse(l));
        if (!lines.some((l) => l.t === 'done')) {
          reject(new Error(`harness did not finish (exit ${code}):\n${err}\n${out.slice(-2000)}`));
          return;
        }
        resolve(lines);
      });
    });
  })();
  return cached;
}

test('the shared corpus is substantial and covers the reported prompts', () => {
  assert.ok(CORPUS.cases.length >= 60, `corpus has ${CORPUS.cases.length} prompts, want >= 60`);
  const texts = new Set(CORPUS.cases.map((c) => c.text));
  for (const p of ['hi', 'hello', 'good morning', 'thanks', 'what is 2+2', 'explain what an API is']) {
    assert.ok(texts.has(p), `corpus must include ${JSON.stringify(p)}`);
  }
  const ids = CORPUS.cases.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length, 'corpus ids must be unique');
  const groups = new Set(CORPUS.cases.map((c) => c.group));
  for (const g of ['greeting', 'mixed', 'arithmetic', 'research', 'code', 'long', 'edge']) {
    assert.ok(groups.has(g), `corpus group ${g} missing`);
  }
});

test('the agent-copy config (what the packaged agent ships) carries the full lexicon', () => {
  assert.equal(CONFIGS.canonical.lexiconSource, 'canonical');
  assert.equal(CONFIGS.agent_copy.lexiconSource, 'agent_copy');
  assert.equal(CONFIGS.none.lexiconSource, 'none');
  const strip = (c) => JSON.stringify({ ...c, lexiconSource: null });
  assert.equal(strip(CONFIGS.agent_copy), strip(CONFIGS.canonical),
    'agent/src/proxy/complexity.js is stale — run: node scripts/gen-proxy-complexity.mjs');
  assert.equal(CONFIGS.canonical.classifierVersion, canonical.VERSION);
});

for (const name of ['canonical', 'agent_copy']) {
  test(`LOCKSTEP (${name} config): C# verdict, rule and score equal complexity.js on every corpus prompt`, SKIP, async () => {
    const lines = await runHarness();
    const loaded = lines.find((l) => l.t === 'loaded' && l.config === name);
    assert.ok(loaded && loaded.lexiconLoaded === true, `${name}: C# did not consider the lexicon loaded`);
    const got = new Map(lines.filter((l) => l.t === 'classify' && l.config === name).map((l) => [l.id, JSON.parse(l.json)]));
    const divergences = [];
    for (const c of CORPUS.cases) {
      const want = canonical.classifyDetailed(c.text);
      const cs = got.get(c.id);
      if (!cs || cs.verdict !== want.verdict || cs.rule !== want.rule || cs.score !== want.score) {
        divergences.push({ id: c.id, text: c.text.slice(0, 50), js: want, cs });
      }
    }
    assert.deepEqual(divergences, [], `C# diverged from complexity.js on ${divergences.length} prompt(s)`);
  });
}

test('REGRESSION (live): "hi" and small talk are simple on the desktop, not moderate', SKIP, async () => {
  const lines = await runHarness();
  const byId = new Map(CORPUS.cases.map((c) => [c.id, c]));
  for (const l of lines.filter((x) => x.t === 'classify' && x.config === 'agent_copy')) {
    const c = byId.get(l.id);
    if (['hi', 'hello', 'good morning', 'thanks', 'what is 2+2', 'how are you'].includes(c.text)) {
      assert.equal(JSON.parse(l.json).verdict, 'simple', `${JSON.stringify(c.text)} must be simple on the desktop`);
    }
  }
});

test('an EMPTY lexicon classifies everything as unknown — never a routable guess', SKIP, async () => {
  const lines = await runHarness();
  const loaded = lines.find((l) => l.t === 'loaded' && l.config === 'none');
  assert.equal(loaded.lexiconLoaded, false);
  const verdicts = lines.filter((l) => l.t === 'classify' && l.config === 'none').map((l) => JSON.parse(l.json));
  assert.equal(verdicts.length, CORPUS.cases.length);
  for (const v of verdicts) assert.deepEqual(v, { verdict: 'unknown', rule: 'no_lexicon', score: null });
});

test('corpus expectations hold for the canonical classifier', () => {
  for (const c of CORPUS.cases) {
    if (!c.expect) continue;
    assert.equal(canonical.classify(c.text), c.expect, `${c.id} ${JSON.stringify(c.text.slice(0, 60))}`);
  }
});

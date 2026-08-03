// content/content.js is injected TWICE into the same document on some hosts, and
// everything in it used to run twice when it was.
//
// THE LIVE FINDING (chatgpt.com): two "[cfai] content script v2 loaded" lines, two
// replay controllers each registering their OWN run for the SAME session id, and two
// independent event-counting sequences running concurrently — i.e. two recorders and
// two DLP layers on one page.
//
// THE CAUSE: chatgpt.com is in manifest.json's hardcoded content_scripts[0].matches,
// so Chrome injects the whole stack on page load; the service worker ALSO classifies
// it as should_govern and calls injectDlpStack(), which pushes the identical file
// list in again through chrome.scripting. The worker's _injectedTabs Set only stops
// that second path from firing twice — it knows nothing about the manifest.
//
// THE FIX under test: a window-level sentinel at the very top of content.js's IIFE
// that makes the SECOND evaluation a complete no-op. It has to be a window property,
// because two injections are two separate evaluations that share nothing else.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { makeDocumentWorld, guardIsFirstStatement } from './load-content-injection.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const contentSrc = readFileSync(path.join(here, '..', 'content', 'content.js'), 'utf8');
const patternsSrc = readFileSync(path.join(here, '..', 'content', 'patterns.js'), 'utf8');

test('injecting content.js twice into one document bootstraps it exactly once', () => {
  const world = makeDocumentWorld();

  const first = world.inject();
  assert.ok(first, 'the first injection runs the setup');
  assert.equal(world.created.length, 1, 'one replay controller');
  assert.equal(world.loadedLines.length, 1);

  // The manifest already put the stack in; now the worker's classifier path puts it
  // in again. Same document, same window, a second evaluation of the same file.
  const second = world.inject();

  assert.equal(second, null, 'the second injection returns before any setup runs');
  assert.equal(world.created.length, 1, 'still ONE replay controller — not two runs for one session');
  assert.equal(world.controllers.length, 1);
  assert.equal(world.loadedLines.length, 1, 'and it does not claim to have loaded twice');
  assert.equal(world.skippedLines.length, 1, 'it says why it did nothing instead of being silent');

  // Listeners are the other half of "twice": a second pagehide handler would drive a
  // second controller through its whole shutdown.
  const pagehides = world.listeners.filter((l) => l.type === 'pagehide');
  assert.equal(pagehides.length, 1, 'one pagehide listener, not one per injection');

  world.fire('window', 'pagehide');
  assert.equal(world.controllers[0].pageHides, 1, 'and it drives the one controller once');
});

test('a third and fourth injection are no-ops too', () => {
  const world = makeDocumentWorld();
  world.inject();
  for (let i = 0; i < 3; i++) assert.equal(world.inject(), null, `injection ${i + 2}`);
  assert.equal(world.created.length, 1);
  assert.equal(world.listeners.filter((l) => l.type === 'pagehide').length, 1);
});

test('a fresh document (a real navigation) bootstraps normally', () => {
  // The guard is per-document, not per-extension: a new page is a new window, and it
  // must record. Getting this wrong would disable replay after the first tab.
  const first = makeDocumentWorld();
  first.inject();
  const next = makeDocumentWorld();
  assert.ok(next.inject(), 'a new document runs the setup');
  assert.equal(next.created.length, 1);
});

test('the guard is the FIRST thing in the IIFE, before any side effect', () => {
  // If anything with a side effect precedes it — the fetch-blocker injection, a
  // storage read, an addEventListener — the second injection still fires that before
  // returning, which is a partial re-run rather than a no-op.
  assert.ok(guardIsFirstStatement(),
    'only comments may sit between the IIFE opening and the __cfaiContentBootstrapped guard');

  const guard = contentSrc.indexOf('window.__cfaiContentBootstrapped');
  const fetchBlocker = contentSrc.indexOf("chrome.runtime.getURL('content/fetch-blocker.js')");
  const enforceFlag = contentSrc.indexOf('window.__cfaiEnforceInstalled');
  assert.ok(guard > 0 && guard < fetchBlocker, 'the guard precedes the fetch-blocker injection');
  assert.ok(guard < enforceFlag,
    'and it precedes the per-sub-feature flag it generalises (__cfaiEnforceInstalled)');
});

test('patterns.js is idempotent too — it does not re-arm its GC timer or swap the vault', () => {
  // patterns.js is injected by both paths as well. Its tables are pure, but two
  // things in it are not: a setInterval GC timer, and window.__cfaiTokenVault /
  // window.__cfaiPatterns being REPLACED by a fresh vault — which orphans every
  // token minted before the second injection, so restoreTokens() can no longer
  // resolve them.
  const win = {};
  const intervals = [];
  // eslint-disable-next-line no-new-func
  const run = new Function('window', 'setInterval', 'clearInterval', 'crypto', patternsSrc);
  const load = () => run(win, (fn, ms) => { intervals.push(ms); return intervals.length; }, () => {}, globalThis.crypto);

  load();
  const vault = win.__cfaiTokenVault;
  const token = win.__cfaiPatterns.tokenize('my ssn is 123-45-6789', new Set(['us-ssn']));
  assert.match(token.tokenized, /\[CFAI:SSN:[a-f0-9]{8}\]/);
  const timersAfterFirst = intervals.length;

  load();

  assert.equal(intervals.length, timersAfterFirst, 'no second GC timer');
  assert.equal(win.__cfaiTokenVault, vault, 'the SAME vault, so live tokens stay resolvable');
  assert.equal(win.__cfaiPatterns.restoreTokens(token.tokenized), 'my ssn is 123-45-6789');
});

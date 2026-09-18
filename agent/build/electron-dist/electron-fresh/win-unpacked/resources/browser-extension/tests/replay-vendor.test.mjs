// Is the recorder actually WIRED UP and SHIPPABLE?
//
// content/replay.js was fully written and fully unit-tested for a while and still
// did precisely nothing, because it was in no manifest, no inject list and no
// vendor bundle. Every assertion in this file exists to make that class of mistake
// impossible to reintroduce silently: the two injection paths, the vendored
// recorder, and the version pin that ties the two together.
//
// There are TWO injection paths and they must agree:
//   manifest.json content_scripts[0]  the hardcoded AI-host list
//   injectDlpStack() in the worker    hosts an admin added to the platforms
//                                     registry, or the LLM classifier decided to
//                                     govern. Recording that works only on the
//                                     hardcoded list would silently skip exactly
//                                     the hosts an admin went out of their way to
//                                     add.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');
const json = (p) => JSON.parse(read(p));

const VENDOR = 'vendor/rrweb-record.js';
const REPLAY = 'content/replay.js';

/** The content-script files in the order they load, in either injection path. */
function manifestFiles() {
  return json('manifest.json').content_scripts[0].js;
}

function injectStackFiles() {
  const src = read('background/service-worker.js');
  const at = src.indexOf('async function injectDlpStack');
  assert.ok(at > 0, 'injectDlpStack not found in the service worker');
  const filesAt = src.indexOf('files: [', at);
  const end = src.indexOf(']', filesAt);
  assert.ok(filesAt > 0 && end > filesAt, 'could not read injectDlpStack\'s files array');
  return src.slice(filesAt + 'files: ['.length, end)
    .split(',')
    .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
}

test('manifest.json loads the recorder, in an order that can actually work', () => {
  const files = manifestFiles();
  assert.ok(files.includes(VENDOR), 'the rrweb bundle is in the manifest');
  assert.ok(files.includes(REPLAY), 'content/replay.js is in the manifest');

  const iVendor = files.indexOf(VENDOR);
  const iReplay = files.indexOf(REPLAY);
  const iContent = files.indexOf('content/content.js');
  const iPatterns = files.indexOf('content/patterns.js');

  // rrweb defines window.rrweb; replay.js defines window.__cfaiReplay; content.js
  // reads BOTH in its bootstrap. Any other order means the bootstrap warns and
  // recording never starts.
  assert.ok(iVendor < iReplay, 'vendor/rrweb-record.js must load before content/replay.js');
  assert.ok(iReplay < iContent, 'content/replay.js must load before content/content.js');
  assert.ok(iPatterns < iContent, 'content/patterns.js must still load before content.js');
  // The vendor libs are a block; the recorder belongs with them, not after patterns.
  assert.ok(iVendor < iPatterns, 'the vendor block stays together');
});

test('the classifier/registry inject path loads exactly the same files in the same order', () => {
  assert.deepEqual(
    injectStackFiles(),
    manifestFiles(),
    'injectDlpStack() and manifest content_scripts[0].js have drifted apart — ' +
    'recording would work on the hardcoded hosts and silently not on admin-added ones',
  );
});

test('the content-script entry is otherwise untouched', () => {
  const entry = json('manifest.json').content_scripts[0];
  assert.equal(entry.run_at, 'document_idle');
  assert.equal(entry.all_frames, true);
  assert.deepEqual(entry.css, ['content/content.css']);
  assert.ok(Array.isArray(entry.matches) && entry.matches.length > 0);
});

test('the version pin, the source constant and the vendored bundle all agree', () => {
  const pinned = json('package.json').devDependencies['@rrweb/record'];
  assert.ok(pinned, '@rrweb/record must be a pinned devDependency');
  assert.match(pinned, /^\d+\.\d+\.\d+/, 'pinned exactly, no ^ or ~ range');

  const declared = read(REPLAY).match(/RRWEB_VERSION\s*=\s*'([^']+)'/)?.[1];
  assert.ok(declared, 'content/replay.js must declare RRWEB_VERSION');
  // The recorder id derived from this constant is stored on every run and is what
  // tells a future player which event schema it is looking at. A drift here
  // mislabels stored evidence.
  assert.equal(declared, pinned,
    'package.json pin and RRWEB_VERSION in content/replay.js must match');
});

test('the build takes the RECORDER-ONLY package — this is how "never ship the player" is enforced', () => {
  const build = read('scripts/build-vendor.mjs');
  // The target is an object literal spanning several lines, so read the whole
  // block around the dest path rather than one line of it.
  const at = build.indexOf(`dest: '${VENDOR}'`);
  assert.ok(at > 0, `scripts/build-vendor.mjs has no target producing ${VENDOR}`);
  const target = build.slice(Math.max(0, at - 500), at + 200);

  assert.match(target, /@rrweb\/record/,
    'the vendor target must be @rrweb/record');
  // The full `rrweb` package also carries the Replayer/player, which the extension
  // must never ship: it is dead weight and it can replay data in the page.
  assert.doesNotMatch(
    target.replace(/@rrweb\/record/g, ''),
    /node_modules\/rrweb\//,
    'never vendor the full rrweb package — it bundles the player',
  );
});

test('vendor/rrweb-record.js exists, is MV3-safe, and exposes window.rrweb', () => {
  const full = path.join(root, VENDOR);
  assert.ok(existsSync(full), `${VENDOR} is missing — run \`npm run vendor\``);
  const src = readFileSync(full, 'utf8');
  assert.ok(statSync(full).size > 50 * 1024, 'suspiciously small for the rrweb recorder');

  // MV3 forbids unsafe-eval. A bundle that needs it fails to load at all, in a way
  // that is easy to miss because only recording breaks.
  assert.doesNotMatch(src, /new Function\s*\(/, 'MV3 disallows new Function()');
  assert.doesNotMatch(src, /[^\w.$]eval\s*\(/, 'MV3 disallows eval()');

  // The UMD preamble's global assignment IS the contract with content.js, which
  // reads window.rrweb.
  assert.match(src, /\brrweb["'\]]/, 'the UMD preamble must assign the rrweb global');
  assert.match(src.slice(0, 600), /g\[["']rrweb["']\]\s*=/,
    'expected the UMD global-assignment preamble at the top of the bundle');

  // The player must not be in here.
  assert.doesNotMatch(src, /rrwebPlayer/, 'the player must never be vendored');

  // The ~800 KB sibling .map must not be referenced: it is not shipped, and a
  // dangling sourceMappingURL logs a devtools warning on every page load.
  const tail = src.slice(-2000);
  assert.doesNotMatch(tail, /\/\/#\s*sourceMappingURL=/, 'the trailing source map link must be stripped');
});

test('content.js has a sliceable session-replay bootstrap that uses both globals', () => {
  const src = read('content/content.js');
  const from = src.indexOf('// ── session replay bootstrap ─');
  const to = src.indexOf('// ── end session replay bootstrap ─');
  assert.ok(from > 0, 'the bootstrap start sentinel is missing');
  assert.ok(to > from, 'the bootstrap end sentinel is missing or out of order');

  const region = src.slice(from, to);
  assert.match(region, /window\.__cfaiReplay/, 'it must read the replay API off window');
  assert.match(region, /window\.rrweb/, 'it must hand the vendored recorder in');
  assert.match(region, /createReplayController/);
  assert.match(region, /_replayController/, 'the controller must be reachable from the banner path');
});

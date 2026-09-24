// Auto-triage, stage one: the properties that make a captured error usable as
// the INPUT to a pipeline that writes code.
//
// Two of these are security properties rather than correctness ones, and they
// are asserted here because nothing downstream can recover from getting them
// wrong: masked-before-storage, and one-row-per-bug.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { fingerprintError } from '../src/lib/error-capture.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..', 'src');

function errWith(message, stack) {
  const e = new Error(message);
  e.stack = stack || `Error: ${message}\n    at handler (/app/server/src/routes/x.js:10:5)`;
  return e;
}

test('one row per BUG, not per request: variable data does not split a fingerprint', () => {
  // THE FAILURE THIS PREVENTS is the one that makes error dashboards useless:
  // hashing the raw message gives a new row per request, the queue fills with
  // thousands of copies of one bug, and the real second bug is never seen.
  const a = errWith('user 41 not found');
  const b = errWith('user 9137 not found');
  const c = errWith('user 8 not found');
  assert.equal(fingerprintError(a, '/u'), fingerprintError(b, '/u'));
  assert.equal(fingerprintError(b, '/u'), fingerprintError(c, '/u'));

  // Same for the other things that vary per occurrence.
  const u1 = errWith('no doc 3f2504e0-4f89-11d3-9a0c-0305e82c3301');
  const u2 = errWith('no doc 7b1a9c88-1111-4444-8888-0305e82c3301');
  assert.equal(fingerprintError(u1, '/d'), fingerprintError(u2, '/d'));

  const q1 = errWith(`bad field 'agent_name'`);
  const q2 = errWith(`bad field 'browser_host'`);
  assert.equal(fingerprintError(q1, '/f'), fingerprintError(q2, '/f'));
});

test('different bugs stay different', () => {
  // The other half, and the one that makes the test above non-vacuous: if
  // normalisation went too far everything would collapse into one row, which
  // looks like perfect dedup and is total blindness.
  const a = errWith('user 41 not found');
  const b = errWith('database connection refused');
  assert.notEqual(fingerprintError(a, '/u'), fingerprintError(b, '/u'));

  // Same message, different place in the code, is a different bug.
  const s1 = errWith('boom', 'Error: boom\n    at alpha (/app/src/a.js:1:1)');
  const s2 = errWith('boom', 'Error: boom\n    at beta (/app/src/b.js:1:1)');
  assert.notEqual(fingerprintError(s1, '/x'), fingerprintError(s2, '/x'));

  // And the same bug reached through different routes is worth separating —
  // the caller is part of the reproduction.
  assert.notEqual(fingerprintError(a, '/one'), fingerprintError(a, '/two'));
});

test('a fingerprint survives a machine change and an unrelated edit above it', () => {
  // The same bug seen on a developer's Windows box and in the Linux container
  // must dedup, or every deploy looks like a wave of new bugs. Line numbers are
  // normalised for the same reason: adding an import at the top of a file must
  // not re-open every error in it.
  const win = errWith('boom',
    'Error: boom\n    at h (C:\\src\\AI-Governence\\server\\src\\routes\\x.js:10:5)');
  const nix = errWith('boom',
    'Error: boom\n    at h (/srv/AI-Governence/server/src/routes/x.js:412:9)');
  assert.equal(fingerprintError(win, '/r'), fingerprintError(nix, '/r'));
});

test('a fingerprint is never thrown away, even for a malformed error', () => {
  // Losing an error because its shape was odd is worse than bucketing it
  // badly: the row is the only evidence the failure happened at all.
  assert.equal(typeof fingerprintError(null, '/x'), 'string');
  assert.equal(typeof fingerprintError({}, '/x'), 'string');
  assert.equal(typeof fingerprintError('a string', '/x'), 'string');
  assert.ok(fingerprintError(undefined, '').length > 0);
});

test('SECURITY: error text is masked before it is stored', async () => {
  // This is a DLP product. An error thrown while handling a prompt, a filename
  // or a URL can carry that text, and it is then stored AND fed to an agent
  // that writes code. Storing it raw would put the exact content this product
  // exists to protect into a collection nobody treats as sensitive.
  const src = await readFile(join(SRC, 'lib', 'error-capture.js'), 'utf8');
  const record = src.slice(src.indexOf('export async function recordError'));
  assert.match(record, /message: maskSensitive\(/,
    'the message must be masked before storage');
  assert.match(record, /stack: safeStack\(/,
    'the stack must go through the masking helper');
  const safe = src.slice(src.indexOf('function safeStack('), src.indexOf('export async function recordError'));
  assert.match(safe, /maskSensitive\(line, \d+\)/,
    'every stack frame must be masked, not just the first');
});

test('SECURITY: masking cannot change which errors dedup together', async () => {
  // The fingerprint is computed from the NORMALISED text, not the masked text.
  // If it were computed after masking, tightening a redaction rule would
  // silently re-open every error it touched — a change to a privacy control
  // must not move the triage queue.
  const src = await readFile(join(SRC, 'lib', 'error-capture.js'), 'utf8');
  const fp = src.slice(src.indexOf('export function fingerprintError'),
                       src.indexOf('function safeStack('));
  assert.equal(/maskSensitive/.test(fp), false,
    'fingerprinting must not depend on the masking rules');
});

test('SECURITY: there is no route that lets a caller inject an error row', async () => {
  // Rows come only from the server's own handler. An ingest endpoint would let
  // anyone who can reach the API write text straight into the input of a
  // pipeline that writes code and opens pull requests.
  const routes = await readFile(join(SRC, 'routes', 'errors.js'), 'utf8');
  assert.equal(/app\.post\(/.test(routes), false,
    'no POST route may exist on the errors API');
  assert.equal(/app\.put\(/.test(routes), false, 'no PUT route either');
  // PATCH exists, but only to flip a boolean — assert it cannot write free text
  // into the fields the analysis step reads.
  const patch = routes.slice(routes.indexOf("app.patch("));
  for (const field of ['message', 'stack', 'name:', 'route:']) {
    assert.equal(patch.includes(`set.${field}`), false,
      `PATCH must not be able to set ${field}`);
  }
});

test('the capture path never throws, because it runs on an already-failed request', async () => {
  const src = await readFile(join(SRC, 'lib', 'error-capture.js'), 'utf8');
  const record = src.slice(src.indexOf('export async function recordError'),
                           src.indexOf('export function mountErrorCapture'));
  assert.match(record, /try \{/, 'recordError must be wrapped');
  assert.match(record, /catch \(e\) \{/, 'and must swallow its own failure');
  // An error handler that throws replaces a useful 500 with a confusing one and
  // can take the process down through an unhandled rejection.
  assert.match(record, /console\.error\('\[error-capture\]/,
    'a swallowed failure must still be visible');
});

test('an uncaughtException is recorded but NOT swallowed', async () => {
  // A process in an undefined state that keeps serving is worse than one that
  // restarts — the deploy health-checks and rolls back. Recording it must not
  // turn a crash into a silent zombie.
  const src = await readFile(join(SRC, 'lib', 'error-capture.js'), 'utf8');
  const hook = src.slice(src.indexOf("process.on('uncaughtException'"));
  assert.match(hook, /throw e/, 'the exception must be rethrown after recording');
});

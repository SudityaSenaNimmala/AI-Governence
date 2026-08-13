// GET /api/v1/sdk/download — the JS SDK (sdk-js/) served as a zip.
//
// The point of this suite is that the endpoint returns a *genuinely valid*
// archive, not merely a 200 with some bytes. So the zip is parsed here by an
// INDEPENDENT reader written against the spec (End-Of-Central-Directory ->
// central directory -> local headers), rather than by reusing lib/zip.js's own
// writer logic — a bug shared between a writer and its mirror-image reader is
// exactly the bug this would otherwise miss. Entry payloads are then compared to
// the real files on disk, and CRC-32s are re-verified with zlib.
//
// No db and no Langfuse stubbing: the route touches neither.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import zlib from 'node:zlib';
import { readFileSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { mountSdkDownload, collectSdkFiles, SDK_JS_DIR } from '../src/routes/sdk-download.js';
import { createZip, toZipEntryName } from '../src/lib/zip.js';

// ── An independent, spec-driven ZIP reader ───────────────────────────────────

function findEocd(buf) {
  // The EOCD is the last 22 bytes when there is no archive comment; scan back
  // anyway rather than assuming.
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) return i;
  }
  throw new Error('no End-Of-Central-Directory record — not a zip');
}

function readZip(buf) {
  const eocd = findEocd(buf);
  const totalEntries = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);

  assert.equal(buf.readUInt16LE(eocd + 8), totalEntries, 'entries-on-disk must match total entries');
  assert.equal(cdOffset + cdSize, eocd, 'central directory must end exactly where the EOCD begins');

  const entries = [];
  let p = cdOffset;
  for (let i = 0; i < totalEntries; i++) {
    assert.equal(buf.readUInt32LE(p), 0x02014b50, `central directory entry ${i} has a bad signature`);
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const compSize = buf.readUInt32LE(p + 20);
    const uncompSize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);

    // Follow the pointer into the local header and take the data from THERE —
    // that is the path a real extractor walks, so a wrong offset must fail here.
    assert.equal(buf.readUInt32LE(localOffset), 0x04034b50, `${name}: bad local header signature`);
    const localNameLen = buf.readUInt16LE(localOffset + 26);
    const localExtraLen = buf.readUInt16LE(localOffset + 28);
    const localName = buf.toString('utf8', localOffset + 30, localOffset + 30 + localNameLen);
    assert.equal(localName, name, 'central directory and local header disagree on the name');
    assert.equal(buf.readUInt32LE(localOffset + 14), crc, `${name}: local/central CRC mismatch`);
    assert.equal(buf.readUInt32LE(localOffset + 22), uncompSize, `${name}: local/central size mismatch`);

    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const data = buf.subarray(dataStart, dataStart + compSize);

    assert.equal(method, 0, `${name}: expected STORE`);
    assert.equal(data.length, uncompSize, `${name}: truncated entry data`);
    if (typeof zlib.crc32 === 'function') {
      assert.equal(zlib.crc32(data) >>> 0, crc, `${name}: CRC-32 does not match its bytes`);
    }

    // Nothing may point outside the archive it was extracted from.
    assert.ok(!name.startsWith('/') && !name.includes('..'), `${name}: unsafe entry path`);
    assert.ok(!name.includes('\\'), `${name}: zip entry names must use forward slashes`);

    entries.push({ name, data });
    p += 46 + nameLen + extraLen + commentLen;
  }
  assert.equal(p, eocd, 'central directory did not consume exactly its stated size');
  return new Map(entries.map((e) => [e.name, e.data]));
}

async function withServer(fn, options = undefined) {
  const app = express();
  app.use(express.json());
  mountSdkDownload(app, options);
  app.use((err, req, res, next) => res.status(500).json({ error: err.message }));

  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

// ── 1. The archive is real and contains a runnable package ───────────────────

test('the download is a parseable zip whose entries match the files on disk', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/v1/sdk/download`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'application/zip');
    assert.equal(res.headers.get('content-disposition'), 'attachment; filename="ai-gov-sdk.zip"');

    const buf = Buffer.from(await res.arrayBuffer());
    assert.equal(Number(res.headers.get('content-length')), buf.length, 'Content-Length must match the body');
    // Local file header signature "PK\x03\x04" — what `file(1)` keys off.
    assert.equal(buf.subarray(0, 4).toString('hex'), '504b0304');

    const files = readZip(buf);

    // The package has to be usable: entry point, manifest, docs, demo.
    for (const required of ['package.json', 'src/index.js', 'README.md', 'examples/demo.mjs']) {
      assert.ok(files.has(required), `zip is missing ${required}`);
      assert.ok(files.get(required).length > 0, `${required} is empty in the zip`);
    }

    // Byte-identical to the source tree, not just present.
    for (const [name, data] of files) {
      const onDisk = readFileSync(join(SDK_JS_DIR, name));
      assert.deepEqual(data, onDisk, `${name} in the zip differs from sdk-js/${name}`);
    }

    // And the manifest is the SDK's, parsed rather than string-matched.
    const pkg = JSON.parse(files.get('package.json').toString('utf8'));
    assert.equal(pkg.name, '@cloudfuze/ai-gov-sdk');
    assert.equal(pkg.main, 'src/index.js');
  });
});

// ── 2. Exclusions ────────────────────────────────────────────────────────────

test('the zip carries the runnable package but not the SDK test suite or repo furniture', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/v1/sdk/download`);
    const files = readZip(Buffer.from(await res.arrayBuffer()));

    for (const name of files.keys()) {
      assert.ok(!name.startsWith('test/'), `test suite leaked into the zip: ${name}`);
      assert.ok(!name.startsWith('tests/'), `test suite leaked into the zip: ${name}`);
      assert.ok(!name.includes('node_modules/'), `node_modules leaked into the zip: ${name}`);
      assert.ok(!name.split('/').some((seg) => seg.startsWith('.git')), `git metadata leaked: ${name}`);
      assert.ok(name !== 'package-lock.json', 'lockfile should not ship');
    }
    // Guard against the exclusion list silently matching everything.
    assert.ok(files.size >= 4, `expected the package contents, got ${files.size} entries`);
  });
});

test('sdk-js/ has a test dir on disk, so the exclusion above is actually exercised', () => {
  // If this ever fails, the previous test became vacuous and the exclusion is
  // no longer being proven by it.
  assert.ok(existsSync(join(SDK_JS_DIR, 'test')), 'sdk-js/test/ is gone — retune the exclusion test');
  const collected = collectSdkFiles();
  assert.ok(collected.length > 0);
  assert.ok(!collected.some((f) => toZipEntryName(f.name).startsWith('test/')));
});

// ── 3. Missing source tree ───────────────────────────────────────────────────

test('a deploy without sdk-js/ answers 404 JSON, not a broken zip', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/v1/sdk/download`);
    assert.equal(res.status, 404);
    // The failure has to be legible as a packaging problem. A zip with zero
    // entries is structurally valid, so a browser would save it and the
    // developer would report a corrupt download instead.
    assert.match(res.headers.get('content-type') ?? '', /application\/json/);
    const body = await res.json();
    assert.match(body.error, /not found/i);
    assert.ok(body.detail.includes('sdk-js/'));
  }, { dir: join(SDK_JS_DIR, 'definitely-not-here') });
});

test('a present but empty sdk-js/ also answers 404 rather than an empty archive', async () => {
  const emptyDir = mkdtempSync(join(tmpdir(), 'cfai-sdk-empty-'));
  try {
    await withServer(async (base) => {
      const res = await fetch(`${base}/api/v1/sdk/download`);
      assert.equal(res.status, 404);
      assert.match((await res.json()).error, /empty/i);
    }, { dir: emptyDir });
  } finally {
    rmSync(emptyDir, { recursive: true, force: true });
  }
});

test('an archive of zero entries is valid-but-useless, which is why the 404s above exist', () => {
  const zip = createZip([]);
  assert.equal(zip.length, 22, 'just an End-Of-Central-Directory record');
  assert.equal(readZip(zip).size, 0);
});

test('a directory containing only excluded entries yields nothing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cfai-sdk-excluded-'));
  try {
    mkdirSync(join(dir, 'test'));
    writeFileSync(join(dir, 'test', 'a.test.mjs'), 'x');
    mkdirSync(join(dir, 'node_modules'));
    writeFileSync(join(dir, 'node_modules', 'dep.js'), 'x');
    writeFileSync(join(dir, '.gitignore'), 'node_modules');
    writeFileSync(join(dir, 'package-lock.json'), '{}');
    assert.deepEqual(collectSdkFiles(dir), []);

    // ...and one includable file proves the walk itself works.
    writeFileSync(join(dir, 'package.json'), '{"name":"x"}');
    assert.deepEqual(collectSdkFiles(dir).map((f) => f.name), ['package.json']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── 4. No auth required ──────────────────────────────────────────────────────

test('the download needs no credentials — it is public by design', async () => {
  await withServer(async (base) => {
    const anonymous = await fetch(`${base}/api/v1/sdk/download`);
    assert.equal(anonymous.status, 200, 'must not be admin-gated');

    // A bogus token must not make it *worse* either (no auth middleware to trip).
    const withJunkToken = await fetch(`${base}/api/v1/sdk/download`, {
      headers: { authorization: 'Bearer not-a-real-token' },
    });
    assert.equal(withJunkToken.status, 200);
  });
});

// ── 5. The shared zip writer ─────────────────────────────────────────────────

test('createZip round-trips names, nested paths and binary content', () => {
  const binary = Buffer.from([0x00, 0xff, 0x7f, 0x80, 0x0a, 0x0d, 0x1a]);
  const zip = createZip([
    { name: 'a.txt', data: Buffer.from('hello', 'utf8') },
    { name: 'deep/nested/dir/b.json', data: Buffer.from('{"k":1}', 'utf8') },
    { name: 'bin.dat', data: binary },
    // Windows-style separators must be normalised, or extractors produce one
    // file literally named "win\path.txt" instead of a directory.
    { name: 'win\\path\\c.txt', data: Buffer.from('c', 'utf8') },
    { name: 'empty.txt', data: Buffer.alloc(0) },
  ]);

  const files = readZip(zip);
  assert.equal(files.size, 5);
  assert.equal(files.get('a.txt').toString('utf8'), 'hello');
  assert.equal(files.get('deep/nested/dir/b.json').toString('utf8'), '{"k":1}');
  assert.deepEqual(files.get('bin.dat'), binary);
  assert.equal(files.get('win/path/c.txt').toString('utf8'), 'c');
  assert.equal(files.get('empty.txt').length, 0);
});

test('zip entries carry a real DOS timestamp, not the invalid all-zero one', () => {
  const zip = createZip([{ name: 'x.txt', data: Buffer.from('x'), mtime: new Date('2026-03-04T05:06:08Z') }]);
  // Local header mod time/date live at +10 and +12; both zero decodes to
  // "day 0 of month 0", which stricter extractors reject.
  const time = zip.readUInt16LE(10);
  const date = zip.readUInt16LE(12);
  assert.notEqual(date, 0, 'mod date must be set');
  const day = date & 0x1f;
  const month = (date >> 5) & 0x0f;
  const year = ((date >> 9) & 0x7f) + 1980;
  assert.equal(year, 2026);
  assert.ok(month >= 1 && month <= 12, `month ${month} out of range`);
  assert.ok(day >= 1 && day <= 31, `day ${day} out of range`);
  assert.ok(((time >> 11) & 0x1f) <= 23);

  // A missing mtime must still produce a valid date rather than zeros.
  const noMtime = createZip([{ name: 'y.txt', data: Buffer.from('y') }]);
  assert.notEqual(noMtime.readUInt16LE(12), 0);
});

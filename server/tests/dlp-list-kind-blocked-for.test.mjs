// GET /api/v1/dlp — ?kind= and ?blocked_for= filters.
//
// Fail-closed file blocks (the desktop agent holding an attachment it could not
// fully scan) carry no matches, so they have no severity and
// ?severity=high,critical never returns them. The UI instead asks for
//   ?kind=enforcement_block&blocked_for=file_upload
// Both are exact-match allowlists; an invalid value yields an EMPTY page, never
// an unfiltered one — the same convention ?severity= already follows.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

import { mountDlp } from '../src/routes/dlp.js';
import { signMachineToken } from '../src/auth.js';
import { responseStore } from '../src/lib/response-budget.js';
import { createFakeDb } from './helpers/fake-db.mjs';

const TOKEN = signMachineToken({ machineId: 'machine-filter-1', hostname: 'test-host' });

// The list route caches per filter; a previous test's rows must not answer this one.
beforeEach(() => responseStore.clear());

async function withServer(fn) {
  const db = createFakeDb();
  const app = express();
  app.use(express.json({ limit: '50mb' }));
  mountDlp(app, db);
  app.use((err, req, res, next) => res.status(500).json({ error: err.message }));
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (events) => fetch(`${base}/api/v1/dlp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ events }),
  });
  const list = async (qs) => {
    const res = await fetch(`${base}/api/v1/dlp${qs}`);
    assert.equal(res.status, 200, `GET ${qs} -> ${res.status}`);
    return res.json();
  };
  try {
    return await fn({ db, post, list });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const MATCH = { pattern: 'us-ssn', class: 'ssn', severity: 'critical', count: 1 };
let t = 0;
const at = () => new Date(Date.UTC(2026, 8, 28, 10, 0, t++)).toISOString();

const SEED = () => [
  // Fail-closed file block: no matches, so no severity at all.
  { kind: 'enforcement_block', service: 'Microsoft Teams', occurredAt: at(), matches: [],
    blocked_for: 'file_upload', client_event_id: 'att-1', mechanism: 'desktop_uia', hold_reason: 'unverified' },
  // Content-matched file block: has a severity.
  { kind: 'enforcement_block', service: 'Microsoft Teams', occurredAt: at(), matches: [MATCH],
    highest_severity: 'critical', blocked_for: 'file_upload', client_event_id: 'att-2' },
  // Prompt block.
  { kind: 'enforcement_block', service: 'ChatGPT', occurredAt: at(), matches: [MATCH],
    highest_severity: 'critical', blocked_for: 'prompt_submit' },
  // Prefix trap: must NOT match blocked_for=file_upload.
  { kind: 'enforcement_block', service: 'ChatGPT', occurredAt: at(), matches: [],
    blocked_for: 'file_upload_preview' },
  // Same blocked_for on a different kind.
  { kind: 'enforcement_override', service: 'Microsoft Teams', occurredAt: at(), matches: [MATCH],
    highest_severity: 'high', blocked_for: 'file_upload' },
  // The file_upload event itself.
  { kind: 'file_upload', service: 'Microsoft Teams', occurredAt: at(), filename: 'payroll.xlsx',
    size: 10, severity: 'high', attachment_id: 'att-1', enforcement: 'held', hold_reason: 'unverified' },
  { kind: 'prompt_submit', service: 'ChatGPT', occurredAt: at(), matches: [MATCH], highest_severity: 'critical' },
];

const kinds = (rows) => rows.map((r) => r.event_kind).sort();
const blockedFor = (rows) => rows.map((r) => r.metadata?.blocked_for ?? null).sort();

test('kind=enforcement_block&blocked_for=file_upload returns BOTH file blocks, including the severity-less one', async () => {
  await withServer(async ({ post, list }) => {
    assert.equal((await post(SEED())).status, 201);
    const rows = await list('?kind=enforcement_block&blocked_for=file_upload');
    assert.equal(rows.length, 2);
    assert.deepEqual(kinds(rows), ['enforcement_block', 'enforcement_block']);
    assert.deepEqual(blockedFor(rows), ['file_upload', 'file_upload']);
    assert.deepEqual(rows.map((r) => r.metadata.correlation_id).sort(), ['att-1', 'att-2']);
    // The severity filter, by contrast, misses the fail-closed one.
    const bySeverity = await list('?kind=enforcement_block&blocked_for=file_upload&severity=high,critical');
    assert.equal(bySeverity.length, 1);
    assert.equal(bySeverity[0].metadata.correlation_id, 'att-2');
  });
});

test('kind alone filters on event_kind exactly', async () => {
  await withServer(async ({ post, list }) => {
    await post(SEED());
    assert.equal((await list('?kind=enforcement_block')).length, 4);
    assert.deepEqual(kinds(await list('?kind=file_upload')), ['file_upload']);
    assert.deepEqual(kinds(await list('?kind=enforcement_override')), ['enforcement_override']);
  });
});

test('blocked_for alone matches across kinds, exactly (no prefix match)', async () => {
  await withServer(async ({ post, list }) => {
    await post(SEED());
    const rows = await list('?blocked_for=file_upload');
    assert.deepEqual(kinds(rows), ['enforcement_block', 'enforcement_block', 'enforcement_override']);
    assert.ok(!blockedFor(rows).includes('file_upload_preview'));
    assert.deepEqual(blockedFor(await list('?blocked_for=file_upload_preview')), ['file_upload_preview']);
    assert.deepEqual(blockedFor(await list('?blocked_for=prompt_submit')), ['prompt_submit']);
  });
});

test('combines with service and limit', async () => {
  await withServer(async ({ post, list }) => {
    await post(SEED());
    assert.equal((await list('?kind=enforcement_block&blocked_for=file_upload&service=ChatGPT')).length, 0);
    assert.equal((await list('?kind=enforcement_block&blocked_for=file_upload&service=Microsoft%20Teams')).length, 2);
    const one = await list('?kind=enforcement_block&blocked_for=file_upload&limit=1');
    assert.equal(one.length, 1);
    assert.equal(one[0].metadata.correlation_id, 'att-2', 'newest first');
  });
});

test('an unknown or malformed kind yields an empty page, not an unfiltered one', async () => {
  await withServer(async ({ post, list }) => {
    await post(SEED());
    for (const qs of ['?kind=bogus', '?kind=ENFORCEMENT_BLOCK', '?kind=', '?kind[$ne]=x', '?kind=enforcement_block&kind=file_upload', '?kind=enforcement_']) {
      assert.deepEqual(await list(qs), [], `${qs} should return nothing`);
    }
  });
});

test('a malformed blocked_for yields an empty page and cannot inject a regex or operator', async () => {
  await withServer(async ({ post, list }) => {
    await post(SEED());
    for (const qs of [
      '?blocked_for=',
      '?blocked_for=.*',
      '?blocked_for=file.upload',
      '?blocked_for=File_Upload',
      '?blocked_for=file_upload%22',
      '?blocked_for[$ne]=x',
      `?blocked_for=${'a'.repeat(33)}`,
      '?blocked_for=file_upload&blocked_for=prompt_submit',
    ]) {
      assert.deepEqual(await list(qs), [], `${qs} should return nothing`);
    }
  });
});

test('without the new params the list is unchanged', async () => {
  await withServer(async ({ post, list }) => {
    await post(SEED());
    assert.equal((await list('')).length, SEED().length);
  });
});

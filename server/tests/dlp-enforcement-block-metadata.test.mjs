// POST /api/v1/dlp — enforcement_block metadata for file uploads.
//
// Regression test for a real bug found while designing desktop file-upload
// blocking: the catch-all metadata branch (everything that isn't
// file_upload/ai_response/model_routed) only stored prompt-shaped fields
// (matches/length_bucket/highest_severity/tab_host). blocked_for and
// filename — both already sent by the browser extension's existing
// file-content block (content.js's blockFileEvent) — were silently dropped
// on ingest, so a blocked file's name never reached the dashboard even
// though the client sent it. Same harness as dlp-ai-response.test.mjs: the
// real Express handler over real HTTP with a real machine JWT; only the
// Mongo handle is faked.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

import { mountDlp } from '../src/routes/dlp.js';
import { signMachineToken } from '../src/auth.js';
import { createFakeDb } from './helpers/fake-db.mjs';

const MACHINE_ID = 'machine-abc-123';
const TOKEN = signMachineToken({ machineId: MACHINE_ID, hostname: 'test-host' });

async function withServer(fn) {
  const db = createFakeDb();
  const app = express();
  app.use(express.json({ limit: '50mb' }));
  mountDlp(app, db);
  app.use((err, req, res, next) => res.status(500).json({ error: err.message }));

  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  const post = (events, token = TOKEN) => fetch(`${base}/api/v1/dlp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ events }),
  });

  try {
    return await fn({ db, post, base });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const at = (min) => new Date(Date.UTC(2026, 6, 1, 10, min, 0)).toISOString();

test('enforcement_block for a file upload persists blocked_for, filename, and blocked_by', async () => {
  await withServer(async ({ db, post }) => {
    const res = await post([{
      kind: 'enforcement_block',
      blocked_for: 'file_upload',
      blocked_by: 'attachment_hold',
      filename: 'payroll.xlsx',
      service: 'Claude',
      occurredAt: at(1),
      matches: [{ pattern: 'us-ssn', class: 'pii', severity: 'high', count: 3 }],
      highest_severity: 'high',
    }]);
    assert.equal(res.status, 201);

    const rows = await db.collection('dlp_events').find({}).toArray();
    assert.equal(rows.length, 1);
    const metadata = JSON.parse(rows[0].metadata_json);
    assert.equal(metadata.blocked_for, 'file_upload');
    assert.equal(metadata.blocked_by, 'attachment_hold');
    assert.equal(metadata.filename, 'payroll.xlsx');
    assert.deepEqual(metadata.matches, [{ pattern: 'us-ssn', class: 'pii', severity: 'high', count: 3 }]);
  });
});

test('enforcement_block for a plain prompt (no file) omits the file-only fields', async () => {
  await withServer(async ({ db, post }) => {
    const res = await post([{
      kind: 'enforcement_block',
      blocked_for: 'prompt_submit',
      service: 'Claude',
      occurredAt: at(1),
      matches: [{ pattern: 'aws-access-key', class: 'secret', severity: 'critical', count: 1 }],
      highest_severity: 'critical',
    }]);
    assert.equal(res.status, 201);

    const rows = await db.collection('dlp_events').find({}).toArray();
    const metadata = JSON.parse(rows[0].metadata_json);
    assert.equal(metadata.blocked_for, 'prompt_submit');
    // No file involved — filename/blocked_by must not appear as spurious
    // nulls or undefined-string artifacts in the persisted JSON.
    assert.equal('filename' in metadata, false);
    assert.equal('blocked_by' in metadata, false);
  });
});

test('prompt_submit (not a block at all) is unaffected by the new fields', async () => {
  await withServer(async ({ db, post }) => {
    const res = await post([{
      kind: 'prompt_submit',
      service: 'ChatGPT',
      occurredAt: at(1),
      session_id: 's1',
      client_seq: 1,
      length_bucket: '100-1k',
      content_length: 120,
      matches: [],
      tabHost: 'chatgpt.com',
    }]);
    assert.equal(res.status, 201);

    const rows = await db.collection('dlp_events').find({}).toArray();
    const metadata = JSON.parse(rows[0].metadata_json);
    assert.equal('blocked_for' in metadata, false);
    assert.equal('filename' in metadata, false);
    assert.equal('blocked_by' in metadata, false);
  });
});

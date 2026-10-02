// REGRESSION: File Uploads (GET /api/v1/dlp/files) showed "Pravallikapunumalli"
// unsplit. attachMachineIdentity resolved the fleet-known email, but this
// endpoint rebuilt each row from a fixed field list that left `email` out, so
// the UI had nothing to split the run-together username with.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

import { mountDlp } from '../src/routes/dlp.js';
import { responseStore } from '../src/lib/response-budget.js';
import { createFakeDb } from './helpers/fake-db.mjs';

test('/dlp/files rows carry the matched work email', async () => {
  responseStore.clear();
  const db = createFakeDb();
  await db.collection('machines').insertMany([
    { id: 'm-pc', hostname: 'Pravallika', user: 'Pravallikapunumalli' },
    { id: 'clicode:Pravallika.Punumalli@cloudfuze.com', hostname: 'Claude Code CLI', user: 'Pravallika.Punumalli@cloudfuze.com' },
  ]);
  await db.collection('dlp_events').insertMany([
    { id: 'ev-1', machine_id: 'm-pc', user: 'Pravallikapunumalli', event_kind: 'file_upload',
      occurred_at: '2026-09-05T06:34:00.000Z', secret_class: 'high', metadata_json: '{"filename":"Test.docx"}' },
  ]);
  const app = express();
  app.use(express.json());
  mountDlp(app, db);
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/dlp/files?limit=50`);
    const rows = await res.json();
    const row = (Array.isArray(rows) ? rows : rows.rows || rows.items || []).find((r) => r.id === 'ev-1');
    assert.ok(row, 'the file row is returned');
    assert.equal(row.user, 'Pravallikapunumalli');
    assert.equal(row.email, 'pravallika.punumalli@cloudfuze.com');
  } finally {
    await new Promise((r) => server.close(r));
    responseStore.clear();
  }
});

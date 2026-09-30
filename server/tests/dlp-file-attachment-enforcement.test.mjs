// POST /api/v1/dlp — file_upload events from the desktop agent carry attachment
// enforcement context: attachment_id (joins to the enforcement_block whose
// client_event_id -> metadata.correlation_id is the same id), enforcement
// ('held' | 'reported') and hold_reason (short [a-z_] code). Each is kept only
// when well-formed and DROPPED otherwise. metadata_json only: no column, no
// migration, no SIEM field. GET /api/v1/dlp/files must hand them to the UI.
//
// Same harness as dlp-enforcement-agent-fields.test.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

import { mountDlp, attachmentEnforcementFields } from '../src/routes/dlp.js';
import { signMachineToken } from '../src/auth.js';
import { normalizeDlpEvent } from '../src/lib/cef.js';
import { createFakeDb } from './helpers/fake-db.mjs';

const TOKEN = signMachineToken({ machineId: 'machine-attach-1', hostname: 'test-host' });

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
  const get = (path) => fetch(`${base}${path}`);
  try {
    return await fn({ db, post, get });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const meta = (db, kind) => {
  const row = db._rows('dlp_events').find((r) => r.event_kind === kind);
  assert.ok(row, `no ${kind} row stored`);
  return JSON.parse(row.metadata_json);
};

const ATTACHMENT_ID = '3f2b8c1e-9d4a-4e6b-8a7f-1c2d3e4f5a6b';
const KEYS = ['attachment_id', 'enforcement', 'hold_reason'];

const fileEvent = (extra) => ({
  kind: 'file_upload',
  service: 'Microsoft Teams',
  occurredAt: new Date('2026-09-28T10:00:00Z').toISOString(),
  filename: 'payroll.xlsx',
  size: 1024,
  severity: 'high',
  file_class: 'spreadsheet',
  agent_name: 'HR Assistant',
  surface: 'teams_desktop',
  ...extra,
});

test('file_upload keeps attachment_id, enforcement and hold_reason', async () => {
  await withServer(async ({ db, post }) => {
    const res = await post([fileEvent({ attachment_id: ATTACHMENT_ID, enforcement: 'held', hold_reason: 'cloud_reference' })]);
    assert.equal(res.status, 201);
    const m = meta(db, 'file_upload');
    assert.equal(m.attachment_id, ATTACHMENT_ID);
    assert.equal(m.enforcement, 'held');
    assert.equal(m.hold_reason, 'cloud_reference');
    // Existing file + agent allowlist intact.
    assert.equal(m.filename, 'payroll.xlsx');
    assert.equal(m.agent_name, 'HR Assistant');
    assert.equal(m.surface, 'teams_desktop');
    // metadata_json only — no new top-level column.
    const row = db._rows('dlp_events')[0];
    for (const key of KEYS) assert.equal(key in row, false, `${key} leaked to a column`);
  });
});

test("enforcement 'reported' is kept; hold_reason is optional", async () => {
  await withServer(async ({ db, post }) => {
    await post([fileEvent({ attachment_id: ATTACHMENT_ID, enforcement: 'reported' })]);
    const m = meta(db, 'file_upload');
    assert.equal(m.enforcement, 'reported');
    assert.equal('hold_reason' in m, false);
  });
});

test('values are trimmed and invisible characters stripped', async () => {
  await withServer(async ({ db, post }) => {
    await post([fileEvent({
      attachment_id: `  ${ATTACHMENT_ID}​ `,
      enforcement: '‮held‬',
      hold_reason: '\tpartially\u0000_scanned\n',
    })]);
    const m = meta(db, 'file_upload');
    assert.equal(m.attachment_id, ATTACHMENT_ID);
    assert.equal(m.enforcement, 'held');
    assert.equal(m.hold_reason, 'partially_scanned');
  });
});

test('malformed values are DROPPED, not coerced or truncated', async () => {
  await withServer(async ({ db, post }) => {
    const res = await post([fileEvent({
      attachment_id: { $ne: null },
      enforcement: 'blocked',
      hold_reason: 'Cloud Reference',
    })]);
    assert.equal(res.status, 201);
    const m = meta(db, 'file_upload');
    for (const key of KEYS) assert.equal(key in m, false, `${key} should have been dropped`);
    assert.equal(m.filename, 'payroll.xlsx', 'the event itself is still stored');
  });
});

test('enforcement must match exactly (case, arrays, numbers)', () => {
  for (const bad of ['HELD', 'Held', 'held ', ['held'], 1, true, '', 'reported,held']) {
    const out = attachmentEnforcementFields({ enforcement: bad });
    // 'held ' trims to 'held' and is legitimately kept.
    if (bad === 'held ') assert.equal(out.enforcement, 'held');
    else assert.equal('enforcement' in out, false, `${JSON.stringify(bad)} should be dropped`);
  }
});

test('length caps: 64 kept, 65 dropped (applied after stripping)', () => {
  assert.equal(attachmentEnforcementFields({ attachment_id: 'a'.repeat(64) }).attachment_id, 'a'.repeat(64));
  assert.equal('attachment_id' in attachmentEnforcementFields({ attachment_id: 'a'.repeat(65) }), false);
  assert.equal(attachmentEnforcementFields({ attachment_id: 'a'.repeat(64) + '​'.repeat(10) }).attachment_id, 'a'.repeat(64));
  assert.equal(attachmentEnforcementFields({ hold_reason: 'x'.repeat(64) }).hold_reason, 'x'.repeat(64));
  assert.equal('hold_reason' in attachmentEnforcementFields({ hold_reason: 'x'.repeat(65) }), false);
});

test('hold_reason accepts only [a-z_]', () => {
  for (const ok of ['cloud_reference', 'partially_scanned', 'unverified', 'not_found', '_']) {
    assert.equal(attachmentEnforcementFields({ hold_reason: ok }).hold_reason, ok);
  }
  for (const bad of ['not-found', 'not found', 'reason1', 'Unverified', '<script>', 'é', '__proto__x.y']) {
    assert.equal('hold_reason' in attachmentEnforcementFields({ hold_reason: bad }), false, `${bad} should be dropped`);
  }
});

test('attachmentEnforcementFields is a pure allowlist', () => {
  assert.deepEqual(
    attachmentEnforcementFields({ attachment_id: 'x', enforcement: 'held', hold_reason: 'unverified', other: 'nope' }),
    { attachment_id: 'x', enforcement: 'held', hold_reason: 'unverified' },
  );
  assert.deepEqual(attachmentEnforcementFields({}), {});
  assert.deepEqual(attachmentEnforcementFields(null), {});
});

test('binding: only the exact value "weak" survives', () => {
  assert.equal(attachmentEnforcementFields({ binding: 'weak' }).binding, 'weak');
  for (const bad of ['strong', 'WEAK', 'weakly', '', 1, true, null, {}]) {
    assert.equal('binding' in attachmentEnforcementFields({ binding: bad }), false, `${JSON.stringify(bad)} should be dropped`);
  }
});

test('an older-shape file_upload with none of the keys has none of them (absent, not null)', async () => {
  await withServer(async ({ db, post }) => {
    await post([fileEvent({})]);
    const m = meta(db, 'file_upload');
    for (const key of KEYS) assert.equal(key in m, false);
  });
});

test('non-file events do not gain the attachment keys', async () => {
  await withServer(async ({ db, post }) => {
    await post([{
      kind: 'prompt_submit', service: 'ChatGPT', occurredAt: new Date().toISOString(),
      matches: [], attachment_id: ATTACHMENT_ID, enforcement: 'held', hold_reason: 'unverified',
    }]);
    const m = meta(db, 'prompt_submit');
    for (const key of KEYS) assert.equal(key in m, false);
  });
});

test('the enforcement_block for the attachment correlates via client_event_id', async () => {
  await withServer(async ({ db, post }) => {
    await post([
      fileEvent({ attachment_id: ATTACHMENT_ID, enforcement: 'held', hold_reason: 'unverified' }),
      {
        kind: 'enforcement_block', service: 'Microsoft Teams', occurredAt: new Date('2026-09-28T10:00:01Z').toISOString(),
        matches: [], blocked_for: 'file_upload', client_event_id: ATTACHMENT_ID, mechanism: 'desktop_uia',
      },
    ]);
    assert.equal(meta(db, 'enforcement_block').correlation_id, meta(db, 'file_upload').attachment_id);
    assert.equal(meta(db, 'enforcement_block').blocked_for, 'file_upload');
  });
});

test('GET /api/v1/dlp/files returns the attachment keys in metadata', async () => {
  await withServer(async ({ post, get }) => {
    await post([fileEvent({ attachment_id: ATTACHMENT_ID, enforcement: 'held', hold_reason: 'not_found' })]);
    const res = await get('/api/v1/dlp/files');
    assert.equal(res.status, 200);
    const rows = await res.json();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].metadata.attachment_id, ATTACHMENT_ID);
    assert.equal(rows[0].metadata.enforcement, 'held');
    assert.equal(rows[0].metadata.hold_reason, 'not_found');
    assert.equal(JSON.parse(rows[0].metadata_json).attachment_id, ATTACHMENT_ID);
  });
});

test('the attachment keys are NOT forwarded to SIEM (cef.js allowlist)', async () => {
  await withServer(async ({ db, post }) => {
    await post([fileEvent({ attachment_id: ATTACHMENT_ID, enforcement: 'held', hold_reason: 'unverified' })]);
    const row = db._rows('dlp_events').find((r) => r.event_kind === 'file_upload');
    const cef = JSON.stringify(normalizeDlpEvent(row));
    for (const v of [ATTACHMENT_ID, 'unverified', '"held"']) assert.equal(cef.includes(v), false, `${v} reached SIEM`);
  });
});

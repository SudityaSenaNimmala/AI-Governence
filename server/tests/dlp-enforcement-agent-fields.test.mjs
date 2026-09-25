// POST /api/v1/dlp — agent context survives ingest on enforcement_* events.
//
// The enforcement branch of metadata_json is an allowlist, and only file events
// kept agent_name/agent_id/agent_scope. So a block or redact on a host-app
// surface (e.g. Microsoft Teams, where one app hosts many agents) could say
// "Teams" but not WHICH agent. These four keys are now kept — each validated as a
// string, trimmed, and dropped (not truncated, not coerced) when malformed or
// over 200 chars. metadata_json only: no column, no migration, no SIEM field.
//
// Same harness as dlp-enforcement-provenance.test.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

import { mountDlp, agentMetaFields } from '../src/routes/dlp.js';
import { signMachineToken } from '../src/auth.js';
import { createFakeDb } from './helpers/fake-db.mjs';

const TOKEN = signMachineToken({ machineId: 'machine-agent-1', hostname: 'test-host' });

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
  try {
    return await fn({ db, post });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const meta = (db, kind) => {
  const row = db._rows('dlp_events').find((r) => r.event_kind === kind);
  assert.ok(row, `no ${kind} row stored`);
  return JSON.parse(row.metadata_json);
};

const MATCH = { pattern: 'us-ssn', class: 'ssn', severity: 'critical', count: 1 };
const base = (kind, extra) => ({
  kind,
  service: 'Microsoft Teams',
  occurredAt: new Date('2026-09-20T10:00:00Z').toISOString(),
  matches: [MATCH],
  highest_severity: 'critical',
  mechanism: 'desktop_uia',
  ...extra,
});
const AGENT = { agent_name: 'HR Assistant', agent_id: 'agent-hr-1', agent_scope: 'agent', surface: 'teams_desktop' };

for (const kind of ['enforcement_block', 'enforcement_redact']) {
  test(`${kind} keeps agent_name, agent_id, agent_scope and surface`, async () => {
    await withServer(async ({ db, post }) => {
      const res = await post([base(kind, AGENT)]);
      assert.equal(res.status, 201);
      const m = meta(db, kind);
      assert.equal(m.agent_name, 'HR Assistant');
      assert.equal(m.agent_id, 'agent-hr-1');
      assert.equal(m.agent_scope, 'agent');
      assert.equal(m.surface, 'teams_desktop');
      // Existing enforcement provenance and base allowlist are still there.
      assert.equal(m.mechanism, 'desktop_uia');
      assert.equal(m.highest_severity, 'critical');
      assert.deepEqual(m.matches, [MATCH]);
      // Stored in metadata_json ONLY — no new top-level column.
      const row = db._rows('dlp_events')[0];
      for (const key of Object.keys(AGENT)) assert.equal(key in row, false, `${key} leaked to a column`);
    });
  });
}

test('agent fields are trimmed', async () => {
  await withServer(async ({ db, post }) => {
    await post([base('enforcement_block', { agent_name: '  HR Assistant  ', surface: '\tteams_web\n' })]);
    const m = meta(db, 'enforcement_block');
    assert.equal(m.agent_name, 'HR Assistant');
    assert.equal(m.surface, 'teams_web');
  });
});

test('non-string, empty and oversized agent fields are DROPPED, not coerced', async () => {
  await withServer(async ({ db, post }) => {
    const res = await post([base('enforcement_block', {
      agent_name: { $ne: null },
      agent_id: ['agent-hr-1'],
      agent_scope: 42,
      surface: 'x'.repeat(201),
    })]);
    assert.equal(res.status, 201);
    const m = meta(db, 'enforcement_block');
    for (const key of ['agent_name', 'agent_id', 'agent_scope', 'surface']) {
      assert.equal(key in m, false, `${key} should have been dropped`);
    }
    // The event itself is still stored with its other fields.
    assert.equal(m.mechanism, 'desktop_uia');
  });
});

test('exactly 200 chars is kept; whitespace-only is dropped', async () => {
  await withServer(async ({ db, post }) => {
    await post([base('enforcement_block', { agent_id: 'a'.repeat(200), agent_name: '   ' })]);
    const m = meta(db, 'enforcement_block');
    assert.equal(m.agent_id, 'a'.repeat(200));
    assert.equal('agent_name' in m, false);
  });
});

test('an older-shape enforcement event with no agent fields still ingests, with no agent keys', async () => {
  await withServer(async ({ db, post }) => {
    const res = await post([base('enforcement_block', { client_event_id: 'corr-1', blocked_for: 'prompt_submit' })]);
    assert.equal(res.status, 201);
    const m = meta(db, 'enforcement_block');
    assert.equal(m.correlation_id, 'corr-1');
    assert.equal(m.blocked_for, 'prompt_submit');
    for (const key of ['agent_name', 'agent_id', 'agent_scope', 'surface']) {
      assert.equal(key in m, false, `${key} must be absent, not null`);
    }
  });
});

test('a non-enforcement prompt event does not gain the agent keys', async () => {
  await withServer(async ({ db, post }) => {
    await post([{ kind: 'prompt_submit', service: 'ChatGPT', occurredAt: new Date().toISOString(), matches: [MATCH], ...AGENT }]);
    const m = meta(db, 'prompt_submit');
    for (const key of ['agent_name', 'agent_id', 'agent_scope', 'surface']) assert.equal(key in m, false);
  });
});

// ── file_upload branch: same validation as enforcement ──────────────────────

const fileEvent = (extra) => ({
  kind: 'file_upload',
  service: 'Microsoft Teams',
  occurredAt: new Date('2026-09-20T11:00:00Z').toISOString(),
  filename: 'payroll.xlsx',
  size: 1024,
  severity: 'high',
  file_class: 'spreadsheet',
  ...extra,
});

test('file_upload keeps valid agent fields (trimmed) and drops malformed ones', async () => {
  await withServer(async ({ db, post }) => {
    const res = await post([fileEvent({
      agent_name: '  HR Assistant ',
      agent_id: { $ne: null },
      agent_scope: 'x'.repeat(201),
      surface: 'teams_desktop',
    })]);
    assert.equal(res.status, 201);
    const m = meta(db, 'file_upload');
    assert.equal(m.agent_name, 'HR Assistant');
    assert.equal('agent_id' in m, false, 'object agent_id must be dropped');
    assert.equal('agent_scope' in m, false, 'oversized agent_scope must be dropped');
    assert.equal(m.surface, 'teams_desktop');
    // The rest of the file allowlist is intact.
    assert.equal(m.filename, 'payroll.xlsx');
    assert.equal(m.file_class, 'spreadsheet');
  });
});

test('a file_upload with no agent fields carries no agent keys', async () => {
  await withServer(async ({ db, post }) => {
    await post([fileEvent({})]);
    const m = meta(db, 'file_upload');
    for (const key of ['agent_name', 'agent_id', 'agent_scope', 'surface']) assert.equal(key in m, false);
  });
});

// ── invisible-character stripping ───────────────────────────────────────────

test('control, bidi-override and zero-width characters are stripped before storing', async () => {
  await withServer(async ({ db, post }) => {
    await post([
      base('enforcement_block', {
        // RLO ... PDF would render "tnatsissA RH" reversed in the dashboard.
        agent_name: '‮HR Assistant‬',
        // Zero-width space / joiner / BOM make this LOOK like agent-hr-1.
        agent_id: 'agent​-hr‍-1﻿',
        // C0 control, DEL, C1 control, LRM, isolate.
        agent_scope: '\u0007ag\u007Fe\u0085nt‎⁦',
        surface: 'teams\u0000_desktop',
      }),
      fileEvent({ agent_name: '⁧Payroll Bot⁩' }),
    ]);
    const m = meta(db, 'enforcement_block');
    assert.equal(m.agent_name, 'HR Assistant');
    assert.equal(m.agent_id, 'agent-hr-1');
    assert.equal(m.agent_scope, 'agent');
    assert.equal(m.surface, 'teams_desktop');
    assert.equal(meta(db, 'file_upload').agent_name, 'Payroll Bot');
  });
});

test('a value made ONLY of stripped characters is dropped, not stored empty', async () => {
  await withServer(async ({ db, post }) => {
    await post([base('enforcement_redact', {
      agent_name: '​‌‍﻿',
      agent_id: '‮‬',
      agent_scope: '\u0000\u001F\u007F',
      surface: ' ⁦ ⁩ ',
    })]);
    const m = meta(db, 'enforcement_redact');
    for (const key of ['agent_name', 'agent_id', 'agent_scope', 'surface']) {
      assert.equal(key in m, false, `${key} should have been dropped`);
    }
  });
});

test('the length cap applies AFTER stripping', () => {
  // 200 visible chars padded with zero-width chars is still within the cap.
  assert.equal(agentMetaFields({ agent_id: 'a'.repeat(200) + '​'.repeat(50) }).agent_id, 'a'.repeat(200));
  assert.equal('agent_id' in agentMetaFields({ agent_id: 'a'.repeat(201) + '​' }), false);
});

test('agentMetaFields is a pure allowlist', () => {
  assert.deepEqual(agentMetaFields({ ...AGENT, other: 'nope', matches: [] }), AGENT);
  assert.deepEqual(agentMetaFields({}), {});
  assert.deepEqual(agentMetaFields(null), {});
});

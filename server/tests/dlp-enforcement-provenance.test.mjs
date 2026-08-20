// POST /api/v1/dlp — enforcement provenance survives ingest.
//
// The regression this pins down: metadata_json kept an allowlist of four fields
// (matches, length_bucket, highest_severity, tab_host) for every non-file,
// non-response event. Enforcement events carry much more than that, and all of
// it was silently dropped — so the dashboard could not say WHAT was stopped
// (blocked_for), HOW (mechanism), or what the person then chose (decision).
//
// The visible symptom: an enforcement_block and the enforcement_decision that
// answered it rendered as two rows differing only by a label, and looked like
// the same event logged twice. The two ends of the pairing the extension already
// stamps — client_event_id on the block, decision_for on the outcome — were both
// among the dropped fields, so nothing could rejoin them either.
//
// Same harness as dlp-ai-response.test.mjs: the real handler over real HTTP with
// a real machine JWT, only the Mongo handle faked.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

import { mountDlp } from '../src/routes/dlp.js';
import { signMachineToken } from '../src/auth.js';
import { createFakeDb } from './helpers/fake-db.mjs';

const MACHINE_ID = 'machine-enf-1';
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

const CORR = 'cfai-corr-0001';
const MATCH = { pattern: 'us-ssn', class: 'ssn', severity: 'critical', count: 1 };

// Exactly what browser-extension/content.js emits: emitEnforcement stamps the
// block with client_event_id, emitDecision echoes it back as decision_for.
test('a block keeps its correlation id, mechanism and blocked_for', async () => {
  await withServer(async ({ db, post }) => {
    const res = await post([{
      kind: 'enforcement_block',
      client_event_id: CORR,
      blocked_for: 'prompt_submit',
      mechanism: 'extension_dom',
      reason: 'sensitive_pattern',
      service: 'ChatGPT',
      occurredAt: new Date('2026-08-20T10:00:00Z').toISOString(),
      matches: [MATCH],
      highest_severity: 'critical',
    }]);
    assert.equal(res.status, 201);

    const m = meta(db, 'enforcement_block');
    assert.equal(m.correlation_id, CORR);
    assert.equal(m.blocked_for, 'prompt_submit');
    assert.equal(m.mechanism, 'extension_dom');
    assert.equal(m.reason, 'sensitive_pattern');
    // The pre-existing allowlist must still be there.
    assert.equal(m.highest_severity, 'critical');
    assert.deepEqual(m.matches, [MATCH]);
  });
});

test('an outcome keeps the decision and what it decided about', async () => {
  await withServer(async ({ db, post }) => {
    await post([{
      kind: 'enforcement_decision',
      decision: 'dismiss',
      decision_for: CORR,
      service: 'ChatGPT',
      occurredAt: new Date('2026-08-20T10:00:04Z').toISOString(),
      matches: [MATCH],
      highest_severity: 'critical',
    }]);

    const m = meta(db, 'enforcement_decision');
    assert.equal(m.decision, 'dismiss');
    assert.equal(m.decision_for, CORR);
  });
});

// The point of storing both ends: the pair can be rejoined. This is the exact
// join the dashboard's groupDlpEvents performs.
test('block and its outcome can be rejoined on the stored ids', async () => {
  await withServer(async ({ db, post }) => {
    await post([
      {
        kind: 'enforcement_block', client_event_id: CORR, blocked_for: 'prompt_submit',
        service: 'ChatGPT', occurredAt: new Date('2026-08-20T10:00:00Z').toISOString(),
        matches: [MATCH], highest_severity: 'critical',
      },
      {
        kind: 'enforcement_decision', decision: 'edit', decision_for: CORR,
        service: 'ChatGPT', occurredAt: new Date('2026-08-20T10:00:06Z').toISOString(),
        matches: [MATCH], highest_severity: 'critical',
      },
    ]);

    const rows = db._rows('dlp_events').map((r) => ({ ...r, meta: JSON.parse(r.metadata_json) }));
    const block = rows.find((r) => r.event_kind === 'enforcement_block');
    const outcome = rows.find((r) => r.event_kind === 'enforcement_decision');
    assert.equal(outcome.meta.decision_for, block.meta.correlation_id);
    assert.equal(outcome.meta.decision, 'edit');
  });
});

// The correlation value is deliberately NOT routed to the top-level
// client_event_id column: that column is the dedupe key, so a block and its
// outcome sharing the value would make the outcome UPSERT over the block and
// destroy the pair. Two rows must survive.
test('a shared correlation id does not collapse the two events into one row', async () => {
  await withServer(async ({ db, post }) => {
    await post([
      {
        kind: 'enforcement_block', client_event_id: CORR, service: 'ChatGPT',
        occurredAt: new Date('2026-08-20T10:00:00Z').toISOString(),
        matches: [MATCH], highest_severity: 'critical',
      },
      {
        kind: 'enforcement_decision', decision: 'dismiss', decision_for: CORR, service: 'ChatGPT',
        occurredAt: new Date('2026-08-20T10:00:03Z').toISOString(),
        matches: [MATCH], highest_severity: 'critical',
      },
    ]);
    assert.equal(db._rows('dlp_events').length, 2);
    const ids = new Set(db._rows('dlp_events').map((r) => r.id));
    assert.equal(ids.size, 2);
  });
});

// Prefix-matched, so an enforcement action that does not exist yet is covered
// the day it ships rather than silently losing its fields.
test('a brand-new enforcement_* kind is covered by the prefix rule', async () => {
  await withServer(async ({ db, post }) => {
    await post([{
      kind: 'enforcement_quarantine',   // hypothetical future action
      blocked_for: 'file_upload', mechanism: 'extension_dom', service: 'ChatGPT',
      occurredAt: new Date('2026-08-20T10:00:00Z').toISOString(),
      matches: [MATCH], highest_severity: 'critical',
    }]);
    const m = meta(db, 'enforcement_quarantine');
    assert.equal(m.blocked_for, 'file_upload');
    assert.equal(m.mechanism, 'extension_dom');
  });
});

// A prompt is not an enforcement event and must not sprout six null fields.
test('non-enforcement events keep their lean metadata', async () => {
  await withServer(async ({ db, post }) => {
    await post([{
      kind: 'prompt_typed', service: 'ChatGPT',
      occurredAt: new Date('2026-08-20T10:00:00Z').toISOString(),
      matches: [MATCH], highest_severity: 'critical', length_bucket: '100-500',
    }]);
    const m = meta(db, 'prompt_typed');
    assert.equal('decision' in m, false);
    assert.equal('correlation_id' in m, false);
    assert.equal('mechanism' in m, false);
    assert.equal(m.length_bucket, '100-500');
  });
});

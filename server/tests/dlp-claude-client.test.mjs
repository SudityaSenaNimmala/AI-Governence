// POST /api/v1/dlp — labelling transcript-derived Claude Code prompts with the
// client they were typed in.
//
// THE THING THIS PROTECTS. Only Claude Code's OTel telemetry reports
// `terminal.type`; the local transcripts the tracker replays carry no client
// information at all. Transcript rows also SUPERSEDE the OTel copy in the rollup
// (so a prompt delivered by both paths is counted once) — which means that
// without this join, installing the tracker would DELETE the IDE/terminal split
// for that machine. The failure would look like everyone migrating to the
// terminal overnight.
//
// Exercises the real handler over real HTTP with a real machine JWT; only the
// Mongo handle is faked.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

import { mountDlp } from '../src/routes/dlp.js';
import { signMachineToken } from '../src/auth.js';
import { createFakeDb } from './helpers/fake-db.mjs';

const MACHINE_ID = 'machine-claude-1';
const TOKEN = signMachineToken({ machineId: MACHINE_ID, hostname: 'SATYA' });

async function withServer(seed, fn) {
  const db = createFakeDb();
  if (seed) await seed(db);

  const app = express();
  app.use(express.json({ limit: '50mb' }));
  mountDlp(app, db);
  app.use((err, req, res, next) => res.status(500).json({ error: err.message }));

  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const post = (events) => fetch(`http://127.0.0.1:${server.address().port}/api/v1/dlp`, {
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

// What the tracker sends for one transcript prompt: a count, a dedupe key, and
// the session id — no text, and no client.
function trackerPrompt(uuid, claudeSessionId) {
  return {
    source: 'claude_tracker',
    service: 'Claude Code',
    kind: 'prompt_submit',
    content_length: 120,
    occurredAt: new Date(Date.UTC(2026, 7, 18, 9, 0, 0)).toISOString(),
    clientEventId: uuid,
    claude_session_id: claudeSessionId,
    metadata: { via: 'transcript' },
  };
}

const seedSessions = async (db) => {
  await db.collection('claude_code_sessions').insertOne({
    session_id: 'sess-ide', terminal: 'vscode',
  });
  await db.collection('claude_code_sessions').insertOne({
    session_id: 'sess-shell', terminal: 'xterm-256color',
  });
};

test('a transcript prompt inherits the client OTel recorded for its session', async () => {
  await withServer(seedSessions, async ({ db, post }) => {
    const res = await post([trackerPrompt('u-1', 'sess-ide')]);
    assert.equal(res.status, 201);

    const row = await db.collection('dlp_events').findOne({ id: 'u-1' });
    assert.equal(row.terminal, 'vscode', 'the IDE session is labelled from the join');
    assert.equal(row.claude_session_id, 'sess-ide');
  });
});

test('each prompt gets its own session\'s client, not the batch\'s first', async () => {
  await withServer(seedSessions, async ({ db, post }) => {
    await post([
      trackerPrompt('u-1', 'sess-ide'),
      trackerPrompt('u-2', 'sess-shell'),
      trackerPrompt('u-3', 'sess-ide'),
    ]);

    assert.equal((await db.collection('dlp_events').findOne({ id: 'u-1' })).terminal, 'vscode');
    assert.equal((await db.collection('dlp_events').findOne({ id: 'u-2' })).terminal, 'xterm-256color');
    assert.equal((await db.collection('dlp_events').findOne({ id: 'u-3' })).terminal, 'vscode');
  });
});

test('a session OTel never reported stays unlabelled rather than guessing', async () => {
  await withServer(seedSessions, async ({ db, post }) => {
    await post([trackerPrompt('u-9', 'sess-never-seen')]);

    const row = await db.collection('dlp_events').findOne({ id: 'u-9' });
    assert.equal(row.terminal, null, 'null, so the rollup can report it as Unknown');
    assert.equal(row.claude_session_id, 'sess-never-seen', 'the id is kept so a later join can fix it');
  });
});

test('claude_session_id does not create a Session Replay session', async () => {
  // The replay list is built from the `sessions` collection, which any event
  // carrying `session_id` writes to. Claude Code sessions have no recording and
  // never will, so putting them there would fill that list with dead rows.
  await withServer(seedSessions, async ({ db, post }) => {
    await post([trackerPrompt('u-1', 'sess-ide')]);

    const sessions = await db.collection('sessions').find({}).toArray();
    assert.equal(sessions.length, 0, 'a Claude Code session is not a replay session');
  });
});

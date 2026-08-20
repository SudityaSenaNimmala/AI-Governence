#!/usr/bin/env node
// One-off: lift `terminal` out of metadata_json onto the dlp_events row.
//
//   node server/scripts/backfill-terminal.mjs            # report only
//   node server/scripts/backfill-terminal.mjs --apply    # write
//
// WHY. otel.js has recorded Claude Code's `terminal.type` since the CLI
// telemetry landed, but only inside metadata_json — a JSON *string*. The Claude
// Usage rollup groups in Mongo (that is what took one read from 60.7s to 97ms),
// and $group cannot see inside a string without a per-document parse. So the
// data needed to answer "how much of this is the VS Code extension?" was already
// on the server and unreachable by the query that wants it.
//
// New events are written with the field top-level. This moves the existing ones,
// so the split is populated the moment it ships instead of starting empty and
// filling in over the following weeks.
//
// Idempotent: only touches rows that have no top-level `terminal` yet, so
// re-running it is a no-op. Also seeds claude_code_sessions from the same rows,
// which is what lets transcript-derived prompts for those sessions be labelled.

import { MongoClient } from 'mongodb';

const APPLY = process.argv.includes('--apply');
const URI = process.env.MONGODB_URI || 'mongodb://mongo:27017/aigov';
const BATCH = 500;

const client = new MongoClient(URI);

function terminalFrom(metadataJson) {
  if (!metadataJson || typeof metadataJson !== 'string') return null;
  try {
    const t = JSON.parse(metadataJson)?.terminal;
    return typeof t === 'string' && t.trim() ? t.trim() : null;
  } catch {
    return null;
  }
}

try {
  await client.connect();
  const db = client.db();
  const events = db.collection('dlp_events');

  // Only Claude Code rows can carry a terminal, and only ones not already done.
  const filter = {
    source: 'claude_code_cli',
    terminal: { $exists: false },
    metadata_json: { $type: 'string' },
  };

  const total = await events.countDocuments(filter);
  console.log(`${total} claude_code_cli event(s) without a top-level terminal`);
  if (total === 0) {
    console.log('nothing to do');
    process.exit(0);
  }

  const counts = new Map();
  const sessions = new Map();   // session_id -> terminal
  let scanned = 0;
  let writable = 0;
  let ops = [];

  const cursor = events.find(filter).project({ _id: 1, metadata_json: 1 });
  for await (const doc of cursor) {
    scanned++;
    const meta = (() => { try { return JSON.parse(doc.metadata_json); } catch { return null; } })();
    const terminal = terminalFrom(doc.metadata_json);
    const sessionId = meta?.session_id || null;

    counts.set(terminal ?? '(none)', (counts.get(terminal ?? '(none)') || 0) + 1);
    if (sessionId && terminal && !sessions.has(sessionId)) sessions.set(sessionId, terminal);

    // Rows whose metadata held no terminal still get the field, written as null.
    // Without that they stay $exists:false and every future run re-scans them —
    // and, more importantly, "we looked and there was nothing" is a different
    // fact from "we never looked", which is the distinction this whole feature
    // rests on.
    if (terminal) writable++;
    ops.push({
      updateOne: {
        filter: { _id: doc._id },
        update: { $set: { terminal: terminal ?? null, claude_session_id: sessionId } },
      },
    });

    if (APPLY && ops.length >= BATCH) {
      await events.bulkWrite(ops, { ordered: false });
      ops = [];
      process.stdout.write(`\r  written ${scanned}/${total}…`);
    }
  }
  if (APPLY && ops.length) await events.bulkWrite(ops, { ordered: false });
  if (APPLY) process.stdout.write('\n');

  console.log(`\nscanned ${scanned}, ${writable} carried a terminal value`);
  console.log('by terminal.type:');
  for (const [k, v] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(k).padEnd(18)} ${v}`);
  }

  if (APPLY && sessions.size) {
    const sessionOps = [...sessions.entries()].map(([session_id, terminal]) => ({
      updateOne: {
        filter: { session_id },
        update: {
          $set: { last_seen_at: new Date() },
          $setOnInsert: { session_id, terminal, first_seen_at: new Date() },
        },
        upsert: true,
      },
    }));
    await db.collection('claude_code_sessions').bulkWrite(sessionOps, { ordered: false });
    console.log(`seeded ${sessions.size} session -> client mapping(s)`);
  } else if (sessions.size) {
    console.log(`would seed ${sessions.size} session -> client mapping(s)`);
  }

  console.log(APPLY ? '\napplied' : '\ndry run — re-run with --apply to write');
} catch (err) {
  console.error(err?.stack || err?.message || String(err));
  process.exitCode = 1;
} finally {
  await client.close();
}

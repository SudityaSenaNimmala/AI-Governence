// session_id -> which client that Claude Code session ran in.
//
// WHY A MAP RATHER THAN A FIELD ON THE EVENT.
//
// Claude Code reports `terminal.type` over OTel, and nowhere else. The tracker's
// transcript reader is the durable path — it replays from disk, so it survives
// the server being unreachable, which OTel does not — but the transcripts carry
// no client information whatsoever (their `entrypoint` field reads "cli" even
// for a session running inside the VS Code extension; verified against real
// files, not assumed).
//
// Those two paths meet in claude-usage.js, where transcript rows deliberately
// SUPERSEDE the OTel copy so a prompt delivered twice is counted once. Stamping
// the client only on OTel events would therefore make the IDE/terminal split
// disappear on precisely the machines running the tracker — the best
// instrumented ones. The session id is the one key both paths share, so it is
// what joins them: OTel supplies the label, transcripts supply the counts.
//
// Consequence worth stating plainly: the label is only as complete as OTel
// delivery. A session whose OTel events were all dropped has no entry here and
// its prompts read "Unknown" — not silently folded into Terminal, which would
// understate IDE usage while looking precise.

const COLL = 'claude_code_sessions';

// Records the client for a session. First writer wins on the client value: a
// session runs in one place, and later events re-reporting the same value would
// only rewrite it with itself. `last_seen_at` still moves, so a stale-session
// cleanup has something to sort on.
export async function rememberSessionClient(db, sessionId, terminalType, now = new Date()) {
  if (!sessionId || !terminalType) return;
  await db.collection(COLL).updateOne(
    { session_id: sessionId },
    {
      $set: { last_seen_at: now },
      $setOnInsert: { session_id: sessionId, terminal: terminalType, first_seen_at: now },
    },
    { upsert: true },
  );
}

export async function lookupSessionClient(db, sessionId) {
  if (!sessionId) return null;
  const row = await db.collection(COLL).findOne(
    { session_id: sessionId },
    { projection: { _id: 0, terminal: 1 } },
  );
  return row?.terminal ?? null;
}

// Batch form for the ingest path, which handles up to 200 events per request and
// must not issue one findOne per event.
export async function lookupSessionClients(db, sessionIds) {
  const ids = [...new Set((sessionIds || []).filter(Boolean))];
  if (ids.length === 0) return new Map();
  const rows = await db.collection(COLL)
    .find({ session_id: { $in: ids } })
    .project({ _id: 0, session_id: 1, terminal: 1 })
    .toArray();
  return new Map(rows.map((r) => [r.session_id, r.terminal]));
}

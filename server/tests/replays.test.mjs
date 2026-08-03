// Session Replay — rrweb DOM recording API. /api/v1/replay-policy, /api/v1/replays*.
//
// Same harness as the sibling suites: real Express handlers over real HTTP with a
// real machine JWT and a real admin token. The only thing faked is the Mongo handle
// (tests/helpers/fake-db.mjs) — there is no blob store to fake any more, because
// chunk payloads are inline documents.
//
// The fake DB is told about the real unique indexes via applyInitialSchema, so the
// {recording_id, seq} constraint that makes a retried chunk upload idempotent is
// actually enforced here rather than assumed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import zlib from 'node:zlib';
import crypto from 'node:crypto';

import { mountReplays, REPLAY_POLICY, REPLAY_CAPS } from '../src/routes/replays.js';
import { mountSessions } from '../src/routes/sessions.js';
import { mountDlp } from '../src/routes/dlp.js';
import { sweepExpiredReplays } from '../src/lib/replay-retention.js';
import { signMachineToken, ADMIN_TOKEN } from '../src/auth.js';
import { applyInitialSchema } from '../src/db/index.js';
import { createFakeDb } from './helpers/fake-db.mjs';

const MACHINE_ID = 'machine-abc-123';
const TOKEN = signMachineToken({ machineId: MACHINE_ID, hostname: 'test-host' });

const OTHER_MACHINE = 'machine-xyz-999';
const OTHER_TOKEN = signMachineToken({ machineId: OTHER_MACHINE, hostname: 'other-host' });

const RECORDINGS = 'session_recordings';
const CHUNKS = 'session_replay_chunks';

const RECORDER = 'rrweb@2.0.0-alpha.4';

// ── Synthetic chunk payloads ─────────────────────────────────────────────────
// Shaped like rrweb output (type + timestamp + data) but the contents are never
// inspected by the server, so they only have to be a JSON array.
function mkEvents(count, baseTs, { fullSnapshot = false } = {}) {
  return Array.from({ length: count }, (_, i) => ({
    type: fullSnapshot && i === 0 ? 2 : 3,
    timestamp: baseTs + i * 100,
    data: { source: 1, id: i },
  }));
}

// Build the wire body for one chunk: gzip the JSON array, base64 it, hash the
// gzip bytes exactly as the extension is specified to.
function mkChunk(events, { hasFullSnapshot = false, eventCount = null, corruptSha = false, raw = null } = {}) {
  const bytes = raw ?? zlib.gzipSync(Buffer.from(JSON.stringify(events), 'utf8'));
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  const timestamps = events.map((e) => e.timestamp);
  return {
    encoding: 'gzip',
    chunk_b64: bytes.toString('base64'),
    event_count: eventCount ?? events.length,
    first_ts: timestamps.length ? Math.min(...timestamps) : 0,
    last_ts: timestamps.length ? Math.max(...timestamps) : 0,
    has_full_snapshot: hasFullSnapshot,
    sha256: corruptSha ? 'f'.repeat(64) : sha256,
    _bytes: bytes,
  };
}

const T0 = 1_780_000_000_000;                    // some fixed ms epoch

async function withServer(fn) {
  const db = createFakeDb();
  await applyInitialSchema(db);

  const app = express();
  app.use(express.json({ limit: '50mb' }));
  mountDlp(app, db);
  mountSessions(app, db);
  mountReplays(app, db);
  app.use((err, req, res, next) => res.status(500).json({ error: err.message }));

  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  const json = async (res) => {
    const text = await res.text();
    try { return JSON.parse(text); } catch { return text; }
  };

  const api = {
    db,
    base,

    async policy(token = TOKEN) {
      const headers = token ? { authorization: `Bearer ${token}` } : {};
      const res = await fetch(`${base}/api/v1/replay-policy`, { headers });
      return { status: res.status, body: await json(res) };
    },

    async create(body = {}, token = TOKEN) {
      const headers = { 'content-type': 'application/json' };
      if (token) headers.authorization = `Bearer ${token}`;
      const res = await fetch(`${base}/api/v1/replays`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          replay_id: crypto.randomUUID(),
          session_id: 'sess-1',
          tab_host: 'chatgpt.com',
          ai_service: 'ChatGPT',
          recorder: RECORDER,
          mask_profile: 'v1',
          capture: 'dom_events',
          started_at: '2026-07-01T10:00:00.000Z',
          ...body,
        }),
      });
      return { status: res.status, body: await json(res) };
    },

    async putChunk(replayId, seq, chunk, { token = TOKEN } = {}) {
      const headers = { 'content-type': 'application/json' };
      if (token) headers.authorization = `Bearer ${token}`;
      const { _bytes, ...body } = chunk;
      const res = await fetch(`${base}/api/v1/replays/${replayId}/chunks/${seq}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
      return { status: res.status, body: res.status === 204 ? null : await json(res) };
    },

    async complete(replayId, body = {}, token = TOKEN) {
      const headers = { 'content-type': 'application/json' };
      if (token) headers.authorization = `Bearer ${token}`;
      const res = await fetch(`${base}/api/v1/replays/${replayId}/complete`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
      return { status: res.status, body: await json(res) };
    },

    async list(query = '', { admin = true } = {}) {
      const headers = admin ? { authorization: `Bearer ${ADMIN_TOKEN}` } : {};
      const res = await fetch(`${base}/api/v1/replays${query}`, { headers });
      return { status: res.status, body: await json(res) };
    },

    async manifest(replayId, { admin = true } = {}) {
      const headers = admin ? { authorization: `Bearer ${ADMIN_TOKEN}` } : {};
      const res = await fetch(`${base}/api/v1/replays/${replayId}`, { headers });
      return { status: res.status, body: await json(res) };
    },

    async events(replayId, { admin = true, query = '' } = {}) {
      const headers = admin ? { authorization: `Bearer ${ADMIN_TOKEN}` } : {};
      const res = await fetch(`${base}/api/v1/replays/${replayId}/events${query}`, { headers });
      const text = await res.text();
      const lines = text.split('\n').filter((l) => l.length);
      return {
        status: res.status,
        headers: res.headers,
        text,
        lines,
        events: (() => { try { return lines.map((l) => JSON.parse(l)); } catch { return null; } })(),
      };
    },

    async session(sessionId) {
      const res = await fetch(`${base}/api/v1/sessions/${sessionId}`);
      return { status: res.status, body: await json(res) };
    },

    async ingest(events) {
      const res = await fetch(`${base}/api/v1/dlp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
        body: JSON.stringify({ events }),
      });
      return { status: res.status, body: await json(res) };
    },

    run(replayId) {
      return api.db._rows(RECORDINGS).find((r) => r.recording_id === replayId);
    },
    chunkRows(replayId) {
      return api.db._rows(CHUNKS).filter((c) => c.recording_id === replayId);
    },
  };

  try {
    return await fn(api);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

// An event array whose GZIPPED size lands between the ordinary per-chunk cap and
// the absolute ceiling — the size band a real full-DOM snapshot falls in, which a
// flat 256 KB cap used to refuse outright. The filler is random (so incompressible:
// the size is real, not a gzip artefact) and `fullSnapshot` decides whether a type-2
// event is genuinely present, which is the whole point of the two-tier check.
function mkOversizeEvents({ fullSnapshot = false } = {}) {
  const events = fullSnapshot
    ? [{ type: 2, timestamp: T0, data: { node: { id: 1, tagName: 'html' } } }]
    : [];
  for (let i = 0; i < 40; i++) {
    events.push({
      type: 3,
      timestamp: T0 + events.length,
      data: { source: 1, blob: crypto.randomBytes(64 * 1024).toString('base64') },
    });
    if (zlib.gzipSync(Buffer.from(JSON.stringify(events), 'utf8')).length > REPLAY_CAPS.max_chunk_bytes) {
      return events;
    }
  }
  throw new Error('could not build an over-cap payload');
}

// A three-chunk run: 2 + 3 + 2 = 7 events, the first chunk carrying a snapshot.
const CHUNK_0 = () => mkChunk(mkEvents(2, T0, { fullSnapshot: true }), { hasFullSnapshot: true });
const CHUNK_1 = () => mkChunk(mkEvents(3, T0 + 10_000));
const CHUNK_2 = () => mkChunk(mkEvents(2, T0 + 20_000));

async function seedReplay(api, { complete = true, sessionId = 'sess-1' } = {}) {
  const created = await api.create({ session_id: sessionId });
  assert.equal(created.status, 201);
  const id = created.body.replay_id;

  for (const [seq, chunk] of [[0, CHUNK_0()], [1, CHUNK_1()], [2, CHUNK_2()]]) {
    const r = await api.putChunk(id, seq, chunk);
    assert.equal(r.status, 204, JSON.stringify(r.body));
  }

  if (complete) {
    const done = await api.complete(id, {
      stop_reason: 'session_rotated',
      chunk_count: 3,
      event_count: 7,
      session_ids: [sessionId],
      ended_at: '2026-07-01T10:00:30.000Z',
      duration_ms: 30_000,
    });
    assert.equal(done.status, 200, JSON.stringify(done.body));
  }
  return id;
}

// ── 1. Policy ────────────────────────────────────────────────────────────────

test('GET /replay-policy requires a machine token and returns the rrweb defaults', async () => {
  await withServer(async (api) => {
    const anon = await api.policy(null);
    assert.equal(anon.status, 401);

    const res = await api.policy();
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, {
      enabled: true,
      chunk_flush_ms: 10_000,
      chunk_max_bytes: 262_144,
      max_run_ms: 3_600_000,
      max_daily_ms: 14_400_000,
      checkout_every_ms: 300_000,
      mask_profile: 'composer_visible',
      retention_days: 30,
    });
    // The advertised per-chunk budget must be the cap the server actually enforces,
    // or a client that obeys the policy still gets 413s.
    assert.equal(res.body.chunk_max_bytes, REPLAY_CAPS.max_chunk_bytes);
    assert.equal(res.body.retention_days, REPLAY_POLICY.retention_days);
    // mask_profile is not a free-form label: it is the NAME OF A CLIENT BEHAVIOUR,
    // and the client (browser-extension/lib/recording.js MASK_PROFILES) only knows
    // 'composer_visible' and 'mask_all'. It clamps anything else to 'mask_all',
    // which masks the prompt composer too — so a value this server invents does not
    // degrade gracefully, it produces recordings that contain no evidence. This
    // field read 'v1' for a while, which is exactly that bug.
    assert.ok(
      ['composer_visible', 'mask_all'].includes(res.body.mask_profile),
      `mask_profile must be a profile the recorder knows, got '${res.body.mask_profile}'`,
    );
  });
});

// ── 2. POST /replays ─────────────────────────────────────────────────────────

test('POST /replays creates a dom_events run owned by the calling machine', async () => {
  await withServer(async (api) => {
    const id = crypto.randomUUID();
    const res = await api.create({ replay_id: id });
    assert.equal(res.status, 201);
    assert.equal(res.body.replay_id, id);

    const row = api.run(id);
    assert.equal(row.capture, 'dom_events');
    assert.equal(row.machine_id, MACHINE_ID);
    assert.equal(row.recorder, RECORDER);
    assert.equal(row.mask_profile, 'v1');
    assert.equal(row.status, 'recording');
    assert.equal(row.audio, false);
    assert.deepEqual(row.session_ids, ['sess-1']);
    assert.equal(row.event_count, 0);
    assert.equal(row.chunk_count, 0);
    assert.equal(row.byte_size, 0);

    // Video-era fields must be ABSENT, not null — they have no meaning for a DOM
    // recording and a null would read as "we tried and got nothing".
    for (const f of ['mime_type', 'codec', 'width', 'height', 'fps', 'bitrate_bps', 'segment_ms']) {
      assert.equal(f in row, false, `${f} should be absent`);
    }
    // Same for the $min/$max timeline fields: an initial null would pin
    // first_event_ts to null forever, because null sorts below every number.
    assert.equal('first_event_ts' in row, false);
    assert.equal('last_event_ts' in row, false);

    // Retention clock starts at creation, from the policy.
    const days = (row.expires_at - row.created_at) / 86_400_000;
    assert.equal(Math.round(days), REPLAY_POLICY.retention_days);
  });
});

test('POST /replays requires auth and tab_host, and refuses a non-dom_events capture', async () => {
  await withServer(async (api) => {
    assert.equal((await api.create({}, null)).status, 401);
    assert.equal((await api.create({ tab_host: undefined })).status, 400);
    assert.equal((await api.create({ capture: 'tab_video' })).status, 400);
    assert.equal((await api.create({ replay_id: 'not-a-uuid' })).status, 400);

    // Ownership is taken from the JWT, never the body.
    const res = await api.create({ machine_id: 'someone-else' });
    assert.equal(res.status, 201);
    assert.equal(api.run(res.body.replay_id).machine_id, MACHINE_ID);
  });
});

test('POST /replays is idempotent for the owner and 409 for another machine', async () => {
  await withServer(async (api) => {
    const id = crypto.randomUUID();
    assert.equal((await api.create({ replay_id: id })).status, 201);

    // Same machine, same id — a retry, not a duplicate.
    const again = await api.create({ replay_id: id });
    assert.equal(again.status, 200);
    assert.equal(again.body.idempotent, true);
    assert.equal(again.body.status, 'recording');
    assert.equal(api.db._rows(RECORDINGS).filter((r) => r.recording_id === id).length, 1);

    // A different machine cannot attach to (or steal) the id.
    const stolen = await api.create({ replay_id: id }, OTHER_TOKEN);
    assert.equal(stolen.status, 409);
    assert.equal(api.run(id).machine_id, MACHINE_ID);
  });
});

test('POST /replays mints an id when the client does not supply one', async () => {
  await withServer(async (api) => {
    const res = await api.create({ replay_id: undefined });
    assert.equal(res.status, 201);
    assert.match(res.body.replay_id, /^[0-9a-f-]{36}$/);
  });
});

// ── 3. POST /replays/:id/chunks/:seq ─────────────────────────────────────────

test('chunk upload stores the gzip payload inline and $incs the run counters', async () => {
  await withServer(async (api) => {
    const created = await api.create({});
    const id = created.body.replay_id;

    const c0 = CHUNK_0();
    assert.equal((await api.putChunk(id, 0, c0)).status, 204);
    const c1 = CHUNK_1();
    assert.equal((await api.putChunk(id, 1, c1)).status, 204);

    const rows = api.chunkRows(id);
    assert.equal(rows.length, 2);
    const stored = rows.find((r) => r.seq === 0);
    assert.equal(stored.encoding, 'gzip');
    assert.ok(Buffer.isBuffer(stored.payload));
    assert.deepEqual(stored.payload, c0._bytes);          // byte-exact, inline
    assert.equal(stored.byte_size, c0._bytes.length);
    assert.equal(stored.sha256, c0.sha256);
    assert.equal(stored.has_full_snapshot, true);
    assert.equal(stored.event_count, 2);                  // server-derived

    const run = api.run(id);
    assert.equal(run.chunk_count, 2);
    assert.equal(run.event_count, 5);                     // 2 + 3
    assert.equal(run.byte_size, c0._bytes.length + c1._bytes.length);
    assert.equal(run.first_event_ts, T0);
    assert.equal(run.last_event_ts, T0 + 10_000 + 200);
    assert.ok(run.last_chunk_at instanceof Date);
  });
});

test('chunk upload keeps the client event count beside the server-derived one', async () => {
  await withServer(async (api) => {
    const id = (await api.create({})).body.replay_id;
    // Client claims 99 events; the payload really holds 2.
    await api.putChunk(id, 0, mkChunk(mkEvents(2, T0), { eventCount: 99 }));

    const row = api.chunkRows(id)[0];
    assert.equal(row.event_count, 2);          // authoritative: counted from bytes
    assert.equal(row.client_event_count, 99);  // kept, so the gap stays visible
    assert.equal(api.run(id).event_count, 2);
  });
});

test('out-of-order chunks still widen the run timeline ($min / $max, not read-modify-write)', async () => {
  await withServer(async (api) => {
    const id = (await api.create({})).body.replay_id;
    // Arrive 2, 0, 1 — the extension's retry queue drains out of order.
    await api.putChunk(id, 2, CHUNK_2());
    await api.putChunk(id, 0, CHUNK_0());
    await api.putChunk(id, 1, CHUNK_1());

    const run = api.run(id);
    assert.equal(run.first_event_ts, T0);                 // lowered by the later arrival
    assert.equal(run.last_event_ts, T0 + 20_000 + 100);
    assert.equal(run.chunk_count, 3);
    assert.equal(run.event_count, 7);
  });
});

test('chunk upload verifies the client sha256 against the decoded bytes', async () => {
  await withServer(async (api) => {
    const id = (await api.create({})).body.replay_id;

    const bad = await api.putChunk(id, 0, mkChunk(mkEvents(2, T0), { corruptSha: true }));
    assert.equal(bad.status, 400);
    assert.match(bad.body.error, /sha256/);
    assert.equal(api.chunkRows(id).length, 0);            // nothing stored

    const { sha256, ...noSha } = mkChunk(mkEvents(2, T0));
    const missing = await api.putChunk(id, 0, noSha);
    assert.equal(missing.status, 400);
    assert.match(missing.body.error, /sha256/);
  });
});

test('chunk upload is idempotent for the same seq + same bytes, and 409 for different bytes', async () => {
  await withServer(async (api) => {
    const id = (await api.create({})).body.replay_id;
    const chunk = CHUNK_0();

    assert.equal((await api.putChunk(id, 0, chunk)).status, 204);
    // Byte-identical retry: one row, counters untouched.
    assert.equal((await api.putChunk(id, 0, chunk)).status, 204);
    assert.equal(api.chunkRows(id).length, 1);
    assert.equal(api.run(id).chunk_count, 1);
    assert.equal(api.run(id).event_count, 2);

    // Same seq, different content — a real integrity conflict, not a retry.
    const conflict = await api.putChunk(id, 0, mkChunk(mkEvents(5, T0 + 1)));
    assert.equal(conflict.status, 409);
    assert.match(conflict.body.error, /different content/);
    assert.equal(api.chunkRows(id).length, 1);
  });
});

test('chunk upload rejects a payload that is not gzipped JSON events', async () => {
  await withServer(async (api) => {
    const id = (await api.create({})).body.replay_id;

    const notGzip = await api.putChunk(id, 0, mkChunk([], { raw: Buffer.from('plain text, not gzip') }));
    assert.equal(notGzip.status, 400);
    assert.match(notGzip.body.error, /not gzip/);

    const notArray = await api.putChunk(id, 1, mkChunk([], {
      raw: zlib.gzipSync(Buffer.from(JSON.stringify({ type: 3 }), 'utf8')),
    }));
    assert.equal(notArray.status, 400);
    assert.match(notArray.body.error, /not a JSON array/);

    const notJson = await api.putChunk(id, 2, mkChunk([], { raw: zlib.gzipSync(Buffer.from('<xml/>')) }));
    assert.equal(notJson.status, 400);
    assert.match(notJson.body.error, /not JSON/);

    assert.equal(api.chunkRows(id).length, 0);
    assert.equal(api.run(id).chunk_count, 0);
  });
});

test('chunk upload rejects a bad envelope: encoding, seq range, timestamps, empty body', async () => {
  await withServer(async (api) => {
    const id = (await api.create({})).body.replay_id;
    const ok = CHUNK_0();

    assert.equal((await api.putChunk(id, 0, { ...ok, encoding: 'br' })).status, 400);
    assert.equal((await api.putChunk(id, REPLAY_CAPS.max_chunks_per_run, ok)).status, 400);
    assert.equal((await api.putChunk(id, -1, ok)).status, 400);
    assert.equal((await api.putChunk(id, 0, { ...ok, first_ts: 'soon' })).status, 400);
    assert.equal((await api.putChunk(id, 0, { ...ok, first_ts: 500, last_ts: 100 })).status, 400);
    assert.equal((await api.putChunk(id, 0, { ...ok, chunk_b64: undefined })).status, 400);
    const empty = await api.putChunk(id, 0, { ...ok, chunk_b64: '', sha256: 'a'.repeat(64) });
    assert.equal(empty.status, 400);
    assert.equal(api.chunkRows(id).length, 0);
  });
});

test('chunk upload refuses a payload over the per-chunk cap', async () => {
  await withServer(async (api) => {
    const id = (await api.create({})).body.replay_id;
    // Genuinely over the cap after gzip, and carrying no full snapshot — so it gets
    // the ordinary 256 KB allowance and nothing more.
    const res = await api.putChunk(id, 0, mkChunk(mkOversizeEvents()));
    assert.equal(res.status, 413);
    assert.match(res.body.error, new RegExp(`${REPLAY_CAPS.max_chunk_bytes} gzipped bytes`));
    assert.equal(api.chunkRows(id).length, 0);
  });
});

// ── the two-tier chunk cap ───────────────────────────────────────────────────
// A real site's full DOM snapshot does not fit in 256 KB gzipped. Refusing it made
// the client re-buffer it, then evict it (it is always the oldest event) to get back
// under its own ceiling — so the run uploaded fine and replayed as a blank page. The
// snapshot chunk therefore gets a larger allowance, but only if the snapshot is
// REALLY IN THERE: the size allowance is earned by the decoded payload, not claimed
// by a flag.

test('a chunk over the ordinary cap that only CLAIMS a snapshot is held to the 256 KB cap', async () => {
  await withServer(async (api) => {
    const id = (await api.create({})).body.replay_id;

    // has_full_snapshot: true, but there is no type-2 event anywhere in the payload.
    const liar = mkChunk(mkOversizeEvents({ fullSnapshot: false }), { hasFullSnapshot: true });
    assert.ok(liar._bytes.length > REPLAY_CAPS.max_chunk_bytes, 'the fixture must be over the cap');
    assert.ok(liar._bytes.length < REPLAY_CAPS.max_snapshot_chunk_bytes, 'and under the ceiling');

    const res = await api.putChunk(id, 0, liar);
    assert.equal(res.status, 413);
    assert.match(res.body.error, new RegExp(`${REPLAY_CAPS.max_chunk_bytes} gzipped bytes`));
    assert.equal(api.chunkRows(id).length, 0);
    assert.equal(api.run(id).byte_size, 0);
  });
});

test('a chunk that REALLY carries a full snapshot is accepted over the ordinary cap', async () => {
  await withServer(async (api) => {
    const id = (await api.create({})).body.replay_id;

    const snapshot = mkChunk(mkOversizeEvents({ fullSnapshot: true }), { hasFullSnapshot: true });
    assert.ok(snapshot._bytes.length > REPLAY_CAPS.max_chunk_bytes);
    assert.ok(snapshot._bytes.length < REPLAY_CAPS.max_snapshot_chunk_bytes);

    assert.equal((await api.putChunk(id, 0, snapshot)).status, 204);
    const row = api.chunkRows(id).find((c) => c.seq === 0);
    assert.equal(row.has_full_snapshot, true);
    assert.equal(row.byte_size, snapshot._bytes.length);
    assert.equal(api.run(id).byte_size, snapshot._bytes.length);

    // And the flag itself is server-derived: a chunk that carries a snapshot is
    // recorded as carrying one even when the client forgot to say so, because that
    // flag is where a player learns it can start playback here.
    const modest = mkChunk(mkEvents(3, T0 + 60_000, { fullSnapshot: true }), { hasFullSnapshot: false });
    assert.equal((await api.putChunk(id, 1, modest)).status, 204);
    const seq1 = api.chunkRows(id).find((c) => c.seq === 1);
    assert.equal(seq1.has_full_snapshot, true, 'derived from the payload');
    assert.equal(seq1.client_has_full_snapshot, false, 'the claim is kept beside it, never over it');

    const manifest = await api.manifest(id);
    assert.deepEqual(manifest.body.chunks.map((c) => c.has_full_snapshot), [true, true]);
  });
});

test('a chunk over the ABSOLUTE ceiling is refused whatever it claims', async () => {
  await withServer(async (api) => {
    const id = (await api.create({})).body.replay_id;
    const huge = crypto.randomBytes(REPLAY_CAPS.max_snapshot_chunk_bytes + 4096);

    for (const claim of [true, false]) {
      const res = await api.putChunk(id, 0, mkChunk([], { raw: huge, hasFullSnapshot: claim }));
      assert.equal(res.status, 413, `claim=${claim}`);
      assert.match(res.body.error, new RegExp(`${REPLAY_CAPS.max_snapshot_chunk_bytes} gzipped bytes`));
    }
    assert.equal(api.chunkRows(id).length, 0);
    assert.equal(api.run(id).status, 'recording', 'a refused chunk is not a run-level cap breach');
  });
});

test('chunk upload aborts the run when it would pass the per-run byte cap', async () => {
  await withServer(async (api) => {
    const id = (await api.create({})).body.replay_id;
    // Fast-forward the server's own counter to just under the cap rather than
    // uploading 50 MB; the cap is checked against this counter, not the client's.
    api.run(id).byte_size = REPLAY_CAPS.max_run_bytes;

    const res = await api.putChunk(id, 0, CHUNK_0());
    assert.equal(res.status, 413);
    assert.equal(res.body.cap_exceeded, 'run_bytes');

    const run = api.run(id);
    assert.equal(run.status, 'aborted');
    assert.equal(run.stop_reason, 'chunk_cap');
    assert.equal(run.cap_exceeded, 'run_bytes');
    assert.equal(api.chunkRows(id).length, 0);

    // Further chunks are refused because the run is no longer 'recording'.
    const after = await api.putChunk(id, 1, CHUNK_1());
    assert.equal(after.status, 409);
    assert.match(after.body.error, /aborted/);
  });
});

test('chunk upload aborts the run when it would pass the per-run chunk-count cap', async () => {
  await withServer(async (api) => {
    const id = (await api.create({})).body.replay_id;
    api.run(id).chunk_count = REPLAY_CAPS.max_chunks_per_run;

    const res = await api.putChunk(id, 0, CHUNK_0());
    assert.equal(res.status, 413);
    assert.equal(res.body.cap_exceeded, 'chunk_count');
    assert.equal(api.run(id).status, 'aborted');
    assert.equal(api.run(id).stop_reason, 'chunk_cap');
  });
});

test('chunk upload enforces auth, existence, ownership and run status', async () => {
  await withServer(async (api) => {
    const id = (await api.create({})).body.replay_id;

    assert.equal((await api.putChunk(id, 0, CHUNK_0(), { token: null })).status, 401);
    assert.equal((await api.putChunk('00000000-0000-4000-8000-000000000000', 0, CHUNK_0())).status, 404);

    const foreign = await api.putChunk(id, 0, CHUNK_0(), { token: OTHER_TOKEN });
    assert.equal(foreign.status, 403);
    assert.match(foreign.body.error, /another machine/);
    assert.equal(api.chunkRows(id).length, 0);

    assert.equal((await api.putChunk(id, 0, CHUNK_0())).status, 204);
    await api.complete(id, { stop_reason: 'requested' });
    const late = await api.putChunk(id, 1, CHUNK_1());
    assert.equal(late.status, 409);
    assert.match(late.body.error, /complete/);
  });
});

test('chunk upload refuses to extend a legacy tab_video run', async () => {
  await withServer(async (api) => {
    // A run left behind by the retired video phase.
    await api.db.collection(RECORDINGS).insertOne({
      recording_id: 'legacy-video-1',
      machine_id: MACHINE_ID,
      capture: 'tab_video',
      status: 'recording',
      session_ids: ['sess-1'],
      started_at: new Date('2026-06-01T00:00:00Z'),
    });
    const res = await api.putChunk('legacy-video-1', 0, CHUNK_0());
    assert.equal(res.status, 409);
    assert.match(res.body.error, /not a dom_events capture/);
  });
});

// ── 4. POST /replays/:id/complete ────────────────────────────────────────────

test('POST /complete finalises the run and keeps the client counters beside the server ones', async () => {
  await withServer(async (api) => {
    const id = (await api.create({})).body.replay_id;
    await api.putChunk(id, 0, CHUNK_0());
    await api.putChunk(id, 1, CHUNK_1());

    const res = await api.complete(id, {
      stop_reason: 'session_rotated',
      chunk_count: 3,              // client believes it sent one more than arrived
      event_count: 9,
      session_ids: ['sess-1', 'sess-2'],
      ended_at: '2026-07-01T10:00:30.000Z',
      duration_ms: 30_000,
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'complete');
    assert.equal(res.body.stop_reason, 'session_rotated');
    assert.equal(res.body.abort_reason, null);
    assert.equal(res.body.duration_ms, 30_000);
    // Server-authoritative vs client-reported, both present, neither overwritten.
    assert.equal(res.body.chunk_count, 2);
    assert.equal(res.body.event_count, 5);
    assert.equal(res.body.client_chunk_count, 3);
    assert.equal(res.body.client_event_count, 9);
    assert.deepEqual(res.body.session_ids.sort(), ['sess-1', 'sess-2']);
    // Never leaks the storage-side id or the Mongo _id.
    assert.equal('recording_id' in res.body, false);
    assert.equal('_id' in res.body, false);
  });
});

test('POST /complete classifies stop reasons: clean ones complete, anything else aborts', async () => {
  await withServer(async (api) => {
    const cleanReasons = [
      'session_rotated', 'pagehide', 'navigated_away', 'daily_cap', 'policy_disabled',
      'browser_restarted', 'requested',
      // The engagement rule's own endings. A run is scoped 1:1 to one session_id,
      // so every way a session can end is also a CLEAN way for a run to end —
      // filing any of these as an abort would make normal use look like failure.
      'engagement_rotated', 'service_changed', 'idle_timeout', 'max_session_ms',
    ];
    for (const reason of cleanReasons) {
      const id = (await api.create({})).body.replay_id;
      const res = await api.complete(id, { stop_reason: reason });
      assert.equal(res.body.status, 'complete', `${reason} should be a clean completion`);
      assert.equal(res.body.stop_reason, reason);
    }

    for (const reason of ['recorder_crashed', 'unknown_future_reason']) {
      const id = (await api.create({})).body.replay_id;
      const res = await api.complete(id, { stop_reason: reason });
      assert.equal(res.body.status, 'aborted', `${reason} should abort`);
      // The exact string survives the classification either way.
      assert.equal(res.body.stop_reason, reason);
      assert.equal(res.body.abort_reason, reason);
    }

    // An explicit abort_reason overrides an otherwise-clean stop reason.
    const id = (await api.create({})).body.replay_id;
    const res = await api.complete(id, { stop_reason: 'requested', abort_reason: 'offscreen_died' });
    assert.equal(res.body.status, 'aborted');
    assert.equal(res.body.abort_reason, 'offscreen_died');
    assert.equal(res.body.stop_reason, 'requested');
  });
});

test('POST /complete is idempotent and never rewrites the first ending', async () => {
  await withServer(async (api) => {
    const id = await seedReplay(api);

    const again = await api.complete(id, { stop_reason: 'recorder_crashed', session_ids: ['sess-9'] });
    assert.equal(again.status, 200);
    assert.equal(again.body.idempotent, true);
    // The original clean ending stands.
    assert.equal(again.body.status, 'complete');
    assert.equal(again.body.stop_reason, 'session_rotated');
    // But a session id reported late is still merged in, not dropped.
    assert.ok(again.body.session_ids.includes('sess-9'));
  });
});

test('POST /complete enforces auth, existence and ownership', async () => {
  await withServer(async (api) => {
    const id = (await api.create({})).body.replay_id;
    assert.equal((await api.complete(id, {}, null)).status, 401);
    assert.equal((await api.complete('00000000-0000-4000-8000-000000000000', {})).status, 404);
    const foreign = await api.complete(id, {}, OTHER_TOKEN);
    assert.equal(foreign.status, 403);
    assert.equal(api.run(id).status, 'recording');
  });
});

// ── 5. GET /replays ──────────────────────────────────────────────────────────

test('GET /replays rejects an unauthenticated read even outside production', async () => {
  await withServer(async (api) => {
    assert.equal(process.env.NODE_ENV, undefined);       // i.e. not 'production'
    const res = await api.list('', { admin: false });
    assert.equal(res.status, 401);
    assert.match(res.body.error, /admin auth required/);
  });
});

test('GET /replays returns metadata only, filterable, newest first', async () => {
  await withServer(async (api) => {
    const a1 = await api.create({ session_id: 'sess-1', started_at: '2026-07-01T10:00:00.000Z' });
    const b1 = await api.create({ session_id: 'sess-2', started_at: '2026-07-02T10:00:00.000Z' });
    await api.complete(a1.body.replay_id, { stop_reason: 'requested', session_ids: ['sess-1'] });

    const all = await api.list();
    assert.equal(all.status, 200);
    assert.equal(all.body.length, 2);
    // started_at descending.
    assert.equal(all.body[0].replay_id, b1.body.replay_id);
    // No payloads, no chunk index, no storage-side id.
    assert.equal('chunks' in all.body[0], false);
    assert.equal('payload' in all.body[0], false);
    assert.equal('recording_id' in all.body[0], false);

    const bySession = await api.list('?session_id=sess-1');
    assert.equal(bySession.body.length, 1);
    assert.equal(bySession.body[0].replay_id, a1.body.replay_id);

    assert.equal((await api.list('?status=complete')).body.length, 1);
    assert.equal((await api.list(`?machine_id=${MACHINE_ID}`)).body.length, 2);
    assert.equal((await api.list('?machine_id=nobody')).body.length, 0);
  });
});

test('GET /replays hides legacy tab_video runs unless they are asked for', async () => {
  await withServer(async (api) => {
    await api.create({});
    await api.db.collection(RECORDINGS).insertOne({
      recording_id: 'legacy-video-1',
      machine_id: MACHINE_ID,
      capture: 'tab_video',
      status: 'expired',
      purged_reason: 'video_capture_deprecated',
      session_ids: [],
      started_at: new Date('2026-06-01T00:00:00Z'),
    });

    assert.equal((await api.list()).body.length, 1);
    assert.equal((await api.list('?capture=all')).body.length, 2);
    const legacy = await api.list('?capture=tab_video');
    assert.equal(legacy.body.length, 1);
    assert.equal(legacy.body[0].capture, 'tab_video');
    assert.equal(legacy.body[0].purged_reason, 'video_capture_deprecated');
    assert.equal((await api.list('?capture=nonsense')).status, 400);
  });
});

// ── 6. GET /replays/:id (manifest) ───────────────────────────────────────────

test('GET /replays/:id is the manifest: ordered chunk index, no payloads, integrity block', async () => {
  await withServer(async (api) => {
    const id = await seedReplay(api);

    const anon = await api.manifest(id, { admin: false });
    assert.equal(anon.status, 401);

    const res = await api.manifest(id);
    assert.equal(res.status, 200);
    assert.equal(res.body.replay_id, id);
    assert.equal(res.body.capture, 'dom_events');
    assert.equal(res.body.recorder, RECORDER);
    assert.equal(res.body.playback.kind, 'rrweb-events');
    assert.equal(res.body.playback.events_url, `/api/v1/replays/${id}/events`);

    assert.deepEqual(res.body.chunks.map((c) => c.seq), [0, 1, 2]);
    assert.deepEqual(res.body.chunks.map((c) => c.event_count), [2, 3, 2]);
    assert.deepEqual(res.body.chunks.map((c) => c.has_full_snapshot), [true, false, false]);
    for (const c of res.body.chunks) {
      assert.equal('payload' in c, false);               // never event bytes
      assert.match(c.sha256, /^[0-9a-f]{64}$/);
      assert.ok(c.byte_size > 0);
      assert.ok(c.first_ts <= c.last_ts);
    }

    const i = res.body.integrity;
    assert.equal(i.chunks_stored, 3);
    assert.equal(i.chunks_server_counted, 3);
    assert.equal(i.chunks_client_reported, 3);
    assert.equal(i.events_stored, 7);
    assert.equal(i.events_server_counted, 7);
    assert.equal(i.events_client_reported, 7);
    assert.deepEqual(i.missing_seqs, []);
    assert.equal(i.consistent, true);

    assert.equal((await api.manifest('00000000-0000-4000-8000-000000000000')).status, 404);
  });
});

test('GET /replays/:id makes a client/server count gap and a seq gap visible', async () => {
  await withServer(async (api) => {
    const id = (await api.create({})).body.replay_id;
    await api.putChunk(id, 0, CHUNK_0());
    // seq 1 never arrives.
    await api.putChunk(id, 2, CHUNK_2());
    await api.complete(id, { stop_reason: 'requested', chunk_count: 3, event_count: 7 });

    const i = (await api.manifest(id)).body.integrity;
    assert.equal(i.chunks_stored, 2);
    assert.equal(i.chunks_client_reported, 3);
    assert.equal(i.events_stored, 4);
    assert.equal(i.events_client_reported, 7);
    assert.deepEqual(i.missing_seqs, [1]);
    assert.equal(i.missing_seq_count, 1);
    assert.equal(i.consistent, false);
  });
});

// ── 7. GET /replays/:id/events ───────────────────────────────────────────────

test('GET /events streams the events back as ordered NDJSON, decompressed', async () => {
  await withServer(async (api) => {
    const id = await seedReplay(api);

    const anon = await api.events(id, { admin: false });
    assert.equal(anon.status, 401);

    const res = await api.events(id);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /application\/x-ndjson/);
    assert.equal(res.headers.get('cache-control'), 'private, no-store');
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');

    // One event per line, in seq then in-chunk order.
    assert.equal(res.lines.length, 7);
    assert.deepEqual(
      res.events.map((e) => e.timestamp),
      [
        T0, T0 + 100,
        T0 + 10_000, T0 + 10_100, T0 + 10_200,
        T0 + 20_000, T0 + 20_100,
      ],
    );
    // The full snapshot leads, as rrweb replay requires.
    assert.equal(res.events[0].type, 2);
    // Round-trip fidelity: what comes out is what went in.
    assert.deepEqual(res.events.slice(0, 2), mkEvents(2, T0, { fullSnapshot: true }));
  });
});

test('GET /events honours from_seq / to_seq for progressive loading', async () => {
  await withServer(async (api) => {
    const id = await seedReplay(api);

    const mid = await api.events(id, { query: '?from_seq=1&to_seq=1' });
    assert.equal(mid.status, 200);
    assert.equal(mid.lines.length, 3);
    assert.equal(mid.events[0].timestamp, T0 + 10_000);

    const tail = await api.events(id, { query: '?from_seq=1' });
    assert.equal(tail.lines.length, 5);

    const head = await api.events(id, { query: '?to_seq=0' });
    assert.equal(head.lines.length, 2);

    // A range with no chunks is an empty 200, not an error.
    const none = await api.events(id, { query: '?from_seq=50&to_seq=60' });
    assert.equal(none.status, 200);
    assert.equal(none.lines.length, 0);

    assert.equal((await api.events(id, { query: '?from_seq=5&to_seq=1' })).status, 400);
    assert.equal((await api.events(id, { query: '?from_seq=abc' })).status, 400);
  });
});

test('GET /events is 404 for an unknown run, 410 once purged, 409 for a video run', async () => {
  await withServer(async (api) => {
    assert.equal((await api.events('00000000-0000-4000-8000-000000000000')).status, 404);

    const purged = await seedReplay(api);
    Object.assign(api.run(purged), { status: 'expired', purged_at: new Date() });
    const gone = await api.events(purged);
    assert.equal(gone.status, 410);

    await api.db.collection(RECORDINGS).insertOne({
      recording_id: 'legacy-video-1',
      machine_id: MACHINE_ID,
      capture: 'tab_video',
      status: 'complete',
      session_ids: [],
      started_at: new Date('2026-06-01T00:00:00Z'),
    });
    assert.equal((await api.events('legacy-video-1')).status, 409);
  });
});

test('GET /events on a run with no chunks is an empty 200', async () => {
  await withServer(async (api) => {
    const id = (await api.create({})).body.replay_id;
    const res = await api.events(id);
    assert.equal(res.status, 200);
    assert.equal(res.text, '');
  });
});

// ── 8. Session detail projection ─────────────────────────────────────────────

test('GET /sessions/:id additively reports its replays and nothing else changes', async () => {
  await withServer(async (api) => {
    const ingested = await api.ingest([{
      kind: 'prompt_submit',
      service: 'ChatGPT',
      session_id: 'sess-1',
      occurredAt: '2026-07-01T10:00:05.000Z',
      client_seq: 1,
      content: 'hello',
    }]);
    assert.equal(ingested.status, 201);
    assert.equal(ingested.body.stored, 1);

    const id = await seedReplay(api, { sessionId: 'sess-1' });

    const res = await api.session('sess-1');
    assert.equal(res.status, 200);
    // The rest of the route is untouched.
    assert.equal(res.body.session.session_id, 'sess-1');
    assert.equal(res.body.messages.length, 1);
    assert.equal(res.body.messages_truncated, false);

    assert.equal(res.body.replays.length, 1);
    assert.deepEqual(res.body.replays[0], {
      replay_id: id,
      capture: 'dom_events',
      started_at: '2026-07-01T10:00:00.000Z',
      duration_ms: 30_000,
      status: 'complete',
      event_count: 7,
      chunk_count: 3,
    });
    // Metadata only — never the events, and not even a hint of the payload.
    assert.equal('payload' in res.body.replays[0], false);
    assert.equal('chunks' in res.body.replays[0], false);
    // The video-era `recordings` key is gone, replaced by `replays`.
    assert.equal('recordings' in res.body, false);
  });
});

test('GET /sessions/:id shows a legacy video tombstone alongside DOM replays, tagged by capture', async () => {
  await withServer(async (api) => {
    await api.ingest([{
      kind: 'prompt_submit', service: 'ChatGPT', session_id: 'sess-1',
      occurredAt: '2026-07-01T10:00:05.000Z', client_seq: 1, content: 'hi',
    }]);
    await api.db.collection(RECORDINGS).insertOne({
      recording_id: 'legacy-video-1',
      machine_id: MACHINE_ID,
      capture: 'tab_video',
      status: 'expired',
      purged_reason: 'video_capture_deprecated',
      session_ids: ['sess-1'],
      started_at: new Date('2026-06-01T00:00:00Z'),
      duration_ms: 1000,
    });
    await seedReplay(api, { sessionId: 'sess-1' });

    const res = await api.session('sess-1');
    assert.equal(res.body.replays.length, 2);
    const byCapture = Object.fromEntries(res.body.replays.map((r) => [r.capture, r]));
    assert.equal(byCapture.tab_video.status, 'expired');
    assert.equal(byCapture.tab_video.event_count, 0);
    assert.equal(byCapture.dom_events.status, 'complete');
  });
});

test('GET /sessions/:id picks up a replay that spanned into this conversation', async () => {
  await withServer(async (api) => {
    await api.ingest([{
      kind: 'prompt_submit', service: 'ChatGPT', session_id: 'sess-2',
      occurredAt: '2026-07-01T10:05:00.000Z', client_seq: 1, content: 'later',
    }]);
    const id = (await api.create({ session_id: 'sess-1' })).body.replay_id;
    await api.putChunk(id, 0, CHUNK_0());
    // The run reports both conversations when it ends.
    await api.complete(id, { stop_reason: 'session_rotated', session_ids: ['sess-1', 'sess-2'] });

    const res = await api.session('sess-2');
    assert.equal(res.body.replays.length, 1);
    assert.equal(res.body.replays[0].replay_id, id);
  });
});

// ── Retention sweeper ────────────────────────────────────────────────────────

test('sweeper deletes the chunk documents of an expired replay and leaves a tombstone', async () => {
  await withServer(async (api) => {
    const id = await seedReplay(api);
    const storedBytes = api.chunkRows(id).reduce((t, c) => t + c.byte_size, 0);
    // Backdate the retention clock.
    api.run(id).expires_at = new Date(Date.now() - 1000);

    const r = await sweepExpiredReplays(api.db);
    assert.equal(r.replays_scanned, 1);
    assert.equal(r.replays_expired, 1);
    assert.equal(r.chunks_deleted, 3);
    assert.equal(r.bytes_freed, storedBytes);
    assert.equal(r.errors, 0);

    // Chunks gone.
    assert.equal(api.chunkRows(id).length, 0);
    // Run document KEPT as an audit tombstone, with what was purged recorded.
    const run = api.run(id);
    assert.ok(run, 'the run document must never be hard-deleted');
    assert.equal(run.status, 'expired');
    assert.equal(run.purged_reason, 'retention_expired');
    assert.ok(run.purged_at instanceof Date);
    assert.equal(run.purged_chunk_count, 3);
    assert.equal(run.purged_byte_size, storedBytes);
    // The original counters survive: "there were 7 events" is still answerable.
    assert.equal(run.event_count, 7);

    // A second sweep finds nothing left to do.
    assert.equal((await sweepExpiredReplays(api.db)).replays_scanned, 0);

    // And the events are genuinely unfetchable now.
    assert.equal((await api.events(id)).status, 410);
  });
});

test('sweeper reclaims an abandoned run that never reported complete', async () => {
  await withServer(async (api) => {
    const id = (await api.create({})).body.replay_id;
    await api.putChunk(id, 0, CHUNK_0());
    api.run(id).expires_at = new Date(Date.now() - 1000);

    const r = await sweepExpiredReplays(api.db);
    assert.equal(r.replays_expired, 1);
    assert.equal(api.run(id).status, 'expired');
    assert.equal(api.chunkRows(id).length, 0);
  });
});

test('sweeper leaves legacy tab_video runs alone — it cannot purge bytes it never held', async () => {
  await withServer(async (api) => {
    await api.db.collection(RECORDINGS).insertOne({
      recording_id: 'legacy-video-1',
      machine_id: MACHINE_ID,
      capture: 'tab_video',
      status: 'complete',
      session_ids: [],
      started_at: new Date('2026-06-01T00:00:00Z'),
      expires_at: new Date(Date.now() - 1000),
    });

    const r = await sweepExpiredReplays(api.db);
    assert.equal(r.replays_scanned, 0);
    // Untouched: scripts/cleanup-video-recordings.mjs owns retiring these.
    assert.equal(api.db._rows(RECORDINGS)[0].status, 'complete');
  });
});

test('sweeper respects its batch bound', async () => {
  await withServer(async (api) => {
    for (let i = 0; i < 3; i++) {
      const id = (await api.create({})).body.replay_id;
      api.run(id).expires_at = new Date(Date.now() - 1000);
    }
    const r = await sweepExpiredReplays(api.db, { batch: 2 });
    assert.equal(r.replays_scanned, 2);
    assert.equal(r.replays_expired, 2);
    assert.equal((await sweepExpiredReplays(api.db, { batch: 2 })).replays_expired, 1);
  });
});

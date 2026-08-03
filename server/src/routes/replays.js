// Session Replay — DOM/interaction recording API (rrweb).
//
// This REPLACES the tab-video phase (chrome.tabCapture + MediaRecorder + WebM in
// GridFS). Video is gone for one product reason: Chrome only grants a tab-capture
// stream from a user gesture, so every recording needed a click. rrweb records DOM
// mutations and input events as structured JSON instead, which the extension can
// start and stop with no gesture at all. Playback is a RECONSTRUCTION of the page,
// not pixels — same technique as Clarity/Hotjar/FullStory.
//
// ── STORAGE ──────────────────────────────────────────────────────────────────
// No blob store. A chunk is a gzipped JSON array of rrweb events, capped at 256 KB
// gzipped, which fits comfortably inside a single MongoDB document — so the bytes
// live INLINE in session_replay_chunks.payload (BSON binary) and there is no
// GridFS bucket, no pointer to keep consistent, and no orphan class to sweep.
// `session_recordings` is reused as the run/parent collection (a run is now
// discriminated by `capture: 'dom_events'`; legacy rows carry 'tab_video').
//
// ── WIRE CONTRACT ────────────────────────────────────────────────────────────
//   • replay_id is MINTED BY THE CLIENT and sent in the POST body, because the
//     extension starts pushing chunks to the id it already holds without reading
//     the create response. The server honours the supplied id (uuid-validated,
//     collision-checked) rather than minting its own.
//   • The id is `replay_id` on the wire and `recording_id` in storage — the run
//     collection and its unique index predate the pivot and were not worth a
//     rewrite for a rename.
//   • Chunks are JSON (base64 of the gzip bytes), not a raw binary body: they are
//     small, they travel with metadata, and it keeps the app-wide JSON parser as
//     the only body parser in the server.
//   • Every chunk carries a client-computed sha256 of the gzip bytes, which the
//     server verifies. Same seq + same hash is a safe retry (204); same seq +
//     different bytes is a genuine integrity conflict (409).
//
// Content discipline: a chunk payload is gunzipped transiently on ingest, only to
// prove it really is a JSON array of events and to count them. Nothing from inside
// an event is ever logged, copied out, or stored — only the array length. The
// payload itself is served by exactly one route, GET /:id/events, behind
// requireAdminAuth, with no-store headers.

import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { promisify } from 'node:util';
import { once } from 'node:events';

import { a } from '../util.js';
import { requireMachineAuth, requireAdminAuth } from '../auth.js';

const gunzip = promisify(zlib.gunzip);

const COLL_RECORDINGS = 'session_recordings';
const COLL_CHUNKS = 'session_replay_chunks';

// The capture kind this file owns. Legacy video runs in the same collection are
// 'tab_video' and are never written or extended here.
export const CAPTURE_DOM_EVENTS = 'dom_events';
const CAPTURE_TAB_VIDEO = 'tab_video';

// Replay policy. Hardcoded for this phase — there is no admin config UI yet and a
// one-row config collection with no writer would be dead weight. Every value
// except retention_days is a CLIENT-side budget the extension is expected to
// honour; retention_days is the server's own, because it drives expires_at and the
// retention sweeper. The server does not cut a run off when max_run_ms passes, but
// it does refuse chunks past the hard caps below.
export const REPLAY_POLICY = Object.freeze({
  enabled: true,
  chunk_flush_ms: 10_000,          // flush a chunk every 10 s
  chunk_max_bytes: 262_144,        // 256 KB gzipped per chunk — mirrors MAX_CHUNK_BYTES
  max_run_ms: 3_600_000,           // 1 h per run
  max_daily_ms: 14_400_000,        // 4 h per machine per day
  checkout_every_ms: 300_000,      // full DOM snapshot every 5 min (rrweb checkoutEveryNms)
  // Which masking config the recorder must apply. This MUST be one of the profile
  // names the client actually knows (MASK_PROFILES in
  // browser-extension/lib/recording.js: 'composer_visible' | 'mask_all') — an
  // unrecognised value is clamped there to 'mask_all', which fails closed and masks
  // the prompt composer too, i.e. the recording captures no evidence at all. It read
  // 'v1' for a while, which is exactly that bug.
  mask_profile: 'composer_visible',
  retention_days: 30,
});

// ── Hard caps, enforced server-side ──────────────────────────────────────────
// The policy above is advice the client is asked to follow; these are the limits
// the server actually enforces, so a buggy or hostile client cannot push unbounded
// data. Exceeding one is a 4xx, never a silent truncation — governance evidence
// that has been quietly trimmed is worse than evidence that is missing.
// Exported so the caps are stateable in one place for tests and for the client
// track building against this API; they are NOT configurable at runtime.
// THE PER-CHUNK LIMIT IS TWO-TIER, and the reason is a live-test finding. A real
// site's FULL DOM SNAPSHOT (rrweb event type 2) does not fit in 256 KB gzipped —
// ChatGPT's is at or over it — and it is the one event a replay cannot be watched
// without: everything after it is a mutation applied to it. A flat 256 KB cap
// refused exactly that chunk, over and over, and the client's rollback then evicted
// the snapshot (the oldest event) to get back under its own re-buffer ceiling. The
// run "succeeded" and replayed as a blank page.
//
//   • max_chunk_bytes          the ordinary cap. Every chunk without a snapshot.
//   • max_snapshot_chunk_bytes the ABSOLUTE ceiling for any chunk. A chunk between
//                              the two is only accepted if, once inflated, it
//                              really does carry a type-2 full snapshot — verified
//                              against the decoded events, NOT against the client's
//                              has_full_snapshot flag. A client that lies about
//                              carrying a snapshot to buy itself a bigger upload
//                              allowance is held to the 256 KB cap.
//
// 4 MB gzipped is the pre-inflation allocation bound, chosen to sit under
// MAX_INFLATED_CHUNK_BYTES (8 MB) below, which is the OTHER, independent ceiling: a
// chunk whose inflated JSON passes 8 MB is refused by inflateEventArray no matter
// how small its gzip stream is. In practice that decompression bound is what a
// genuinely enormous snapshot hits first, and hitting it is a 400 — an honest
// refusal the client turns into a 'chunk_rejected' abort.
export const REPLAY_CAPS = Object.freeze({
  max_chunk_bytes: 256 * 1024,                  // gzipped, per chunk
  max_snapshot_chunk_bytes: 4 * 1024 * 1024,    // gzipped, absolute ceiling for ANY chunk
  max_chunks_per_run: 2000,
  max_run_bytes: 50 * 1024 * 1024,              // gzipped, per run
});

const MAX_CHUNK_BYTES = REPLAY_CAPS.max_chunk_bytes;
const MAX_SNAPSHOT_CHUNK_BYTES = REPLAY_CAPS.max_snapshot_chunk_bytes;
const MAX_CHUNKS_PER_RUN = REPLAY_CAPS.max_chunks_per_run;
const MAX_RUN_BYTES = REPLAY_CAPS.max_run_bytes;

// seq is bounded by the per-run chunk cap: chunk 2000 could never be accepted.
const MAX_SEQ = MAX_CHUNKS_PER_RUN - 1;

// Guard on the base64 field before it is decoded, so an oversized chunk is refused
// without allocating a buffer for it. Sized against the ABSOLUTE ceiling, because
// that is the largest body that could legitimately be accepted; the 256 KB tier is
// enforced after the payload has been proved to carry a snapshot or not.
const MAX_CHUNK_B64_LEN = Math.ceil(MAX_SNAPSHOT_CHUNK_BYTES / 3) * 4 + 64;

// Decompression bound. A 256 KB gzip stream can inflate to hundreds of MB, so both
// the ingest validation and the /events reader cap the output rather than trusting
// the header. Node throws ERR_BUFFER_TOO_LARGE past this.
const MAX_INFLATED_CHUNK_BYTES = 8 * 1024 * 1024;

// How many chunks /events holds in memory at once while streaming. 16 × 256 KB is
// ~4 MB of gzip in flight, which keeps a 50 MB run off the heap.
const EVENTS_READ_BATCH = 16;

const MAX_HOST_LEN = 253;
const MAX_SESSION_ID_LEN = 128;
const MAX_RECORDER_LEN = 80;
const MAX_MASK_PROFILE_LEN = 40;
const MAX_STOP_REASON_LEN = 200;
// Mirrors the list-route convention in routes/sessions.js.
const DEFAULT_LIST_LIMIT = 100;
const MAX_LIST_LIMIT = 500;
// A run covers one conversation normally; the array exists for schema stability.
const MAX_SESSION_IDS = 50;
// Cap on the gap list in the manifest's integrity block — a run missing hundreds
// of chunks is already answered by the counters.
const MAX_REPORTED_GAPS = 100;

// rrweb's EventType.FullSnapshot. Mirrors RRWEB_TYPE_FULL_SNAPSHOT in
// browser-extension/content/replay.js, which is where the events are produced. The
// server needs it to VERIFY a client's has_full_snapshot claim against the decoded
// payload, which is what earns a chunk the larger size allowance above.
const RRWEB_TYPE_FULL_SNAPSHOT = 2;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256_RE = /^[0-9a-f]{64}$/i;

// Timestamps are the client's own ms-epoch clock (it is the only clock that can
// place an event on the recorded timeline). Bounded so a garbage value cannot
// poison $min/$max on the run.
const MIN_EVENT_TS = 0;
const MAX_EVENT_TS = 4_102_444_800_000;         // 2100-01-01

const STATUS_RECORDING = 'recording';
const STATUS_COMPLETE = 'complete';
const STATUS_ABORTED = 'aborted';
const STATUS_EXPIRED = 'expired';

// Ways a DOM recording is SUPPOSED to end. A stop_reason is present on every
// completion, so "there is a reason" cannot mean "this failed" — the reason is
// classified instead. Anything not in this set is filed as an abort, and the exact
// string is stored either way so no information is lost.
const CLEAN_STOP_REASONS = new Set([
  'requested',
  'user_toggle',
  'user_stopped',
  'stopped',
  'session_rotated',       // pre-engagement name for the below; older clients still send it
  // A run is scoped 1:1 to one session_id, and a session is now one continuous
  // stretch of using ONE AI service in ONE tab (the engagement rule). So a run
  // ends whenever that engagement does, and each of those endings is a CLEAN one:
  'engagement_rotated',    // the tab's engagement rotated; a new run opens
  'service_changed',       // the tab moved to a different AI service
  'idle_timeout',          // no visible-tab use for the idle window
  'max_session_ms',        // the engagement hit its hard cap
  'pagehide',
  'navigated_away',
  'tab_closed',
  'daily_cap',
  'max_run_ms',
  'max_duration',
  'policy_disabled',
  'browser_restarted',
]);

export function mountReplays(app, db) {
  // ── Policy — what the recorder is allowed to capture ───────────────────────
  app.get('/api/v1/replay-policy', requireMachineAuth, a(async (req, res) => {
    res.json(REPLAY_POLICY);
  }));

  // ── Start a run ───────────────────────────────────────────────────────────
  app.post('/api/v1/replays', requireMachineAuth, a(async (req, res) => {
    const b = req.body ?? {};

    const tabHost = normalizeShortString(b.tab_host, MAX_HOST_LEN);
    if (!tabHost) return res.status(400).json({ error: 'tab_host required' });

    // This route creates DOM-event runs only. A body asking for anything else is a
    // client built against the retired video API, and saying so is more useful
    // than quietly filing it as dom_events.
    const capture = normalizeShortString(b.capture, 40);
    if (capture !== null && capture !== CAPTURE_DOM_EVENTS) {
      return res.status(400).json({ error: `capture must be '${CAPTURE_DOM_EVENTS}'` });
    }

    const supplied = normalizeShortString(b.replay_id, 64);
    if (supplied !== null && !UUID_RE.test(supplied)) {
      return res.status(400).json({ error: 'replay_id must be a uuid' });
    }
    // The fallback keeps the route usable by a caller that does not pre-mint.
    const replayId = supplied ?? crypto.randomUUID();

    const sessionId = normalizeShortString(b.session_id, MAX_SESSION_ID_LEN);
    const now = new Date();

    const doc = {
      recording_id: replayId,
      // Ownership comes from the JWT, never the body: a machine cannot create a
      // run attributed to someone else.
      machine_id: req.machine.id,
      tab_host: tabHost,
      ai_service: normalizeShortString(b.ai_service, 80) ?? 'unknown',
      // Normally exactly one id. Kept as an array for schema continuity with the
      // video phase and because /complete may report more.
      session_ids: sessionId ? [sessionId] : [],
      capture: CAPTURE_DOM_EVENTS,
      // Stored verbatim: which library version produced these events decides
      // whether a future player can still replay them.
      recorder: normalizeShortString(b.recorder, MAX_RECORDER_LEN),
      // Which masking config was active. An audit needs to know what the recorder
      // was configured to redact at capture time, not what today's config says.
      mask_profile: normalizeShortString(b.mask_profile, MAX_MASK_PROFILE_LEN) ?? REPLAY_POLICY.mask_profile,
      started_at: toDate(b.started_at),
      ended_at: null,
      duration_ms: null,
      // Server-authoritative totals, moved only by $inc on an accepted chunk.
      event_count: 0,
      chunk_count: 0,
      byte_size: 0,
      // first_event_ts / last_event_ts are deliberately ABSENT, not null. They are
      // maintained with $min/$max, and in BSON ordering null sorts below every
      // number — an initial null would make $min a permanent no-op and pin
      // first_event_ts to null forever. A missing field is what $min/$max expect.
      //
      // mime_type / codec / width / height / fps / bitrate_bps / segment_ms are
      // absent for the same "no meaning here" reason: they were video-only.
      //
      // audio stays, always false: "was audio recorded" is a governance answer
      // that should be readable off the record rather than taken on trust.
      audio: false,
      status: STATUS_RECORDING,
      stop_reason: null,
      abort_reason: null,
      // The retention clock starts at creation, not completion, so an abandoned
      // run that never reports /complete still ages out on its own.
      expires_at: new Date(now.getTime() + REPLAY_POLICY.retention_days * 86_400_000),
      created_at: now,
    };

    try {
      await db.collection(COLL_RECORDINGS).insertOne(doc);
    } catch (err) {
      if (!isDuplicateKey(err)) throw err;
      // Either a genuine retry of the same registration or a client reusing an id.
      // Idempotent for the owner, refused for anyone else — never an
      // attach-to-someone-else's-run.
      const existing = await db.collection(COLL_RECORDINGS).findOne(
        { recording_id: replayId },
        { projection: { _id: 0, machine_id: 1, status: 1, capture: 1 } },
      );
      if (existing
        && existing.machine_id === req.machine.id
        && existing.capture === CAPTURE_DOM_EVENTS) {
        // status is echoed so a client retrying after the run already ended can
        // see why its chunk uploads are about to be refused.
        return res.status(200).json({ replay_id: replayId, status: existing.status, idempotent: true });
      }
      return res.status(409).json({ error: 'replay_id already exists' });
    }

    res.status(201).json({ replay_id: replayId });
  }));

  // ── Upload one chunk of events ────────────────────────────────────────────
  app.post('/api/v1/replays/:replay_id/chunks/:seq', requireMachineAuth, a(async (req, res) => {
    const replayId = String(req.params.replay_id);
    const b = req.body ?? {};

    const seq = normalizeInt(req.params.seq, 0, MAX_SEQ);
    if (seq === null) {
      return res.status(400).json({ error: `seq must be an integer in [0, ${MAX_SEQ}]` });
    }

    const encoding = normalizeShortString(b.encoding, 20) ?? 'gzip';
    if (encoding !== 'gzip') return res.status(400).json({ error: "encoding must be 'gzip'" });

    const b64 = typeof b.chunk_b64 === 'string' ? b.chunk_b64 : null;
    if (!b64) return res.status(400).json({ error: 'chunk_b64 required' });
    // Tier 2, the absolute ceiling: refused on the encoded field, before a buffer is
    // allocated for it and long before anything is inflated. Nothing the body claims
    // can buy an allowance past this — it is the resource bound, not a policy.
    if (b64.length > MAX_CHUNK_B64_LEN) {
      return res.status(413).json({ error: `chunk exceeds ${MAX_SNAPSHOT_CHUNK_BYTES} gzipped bytes` });
    }

    // The claimed hash is required, not optional: it is the only way the server can
    // tell a retry from a rewrite, and unverifiable evidence is not evidence.
    const claimedSha = normalizeShortString(b.sha256, 64);
    if (!claimedSha || !SHA256_RE.test(claimedSha)) {
      return res.status(400).json({ error: 'sha256 (hex, of the gzipped bytes) required' });
    }

    const firstTs = normalizeInt(b.first_ts, MIN_EVENT_TS, MAX_EVENT_TS);
    const lastTs = normalizeInt(b.last_ts, MIN_EVENT_TS, MAX_EVENT_TS);
    if (firstTs === null || lastTs === null) {
      return res.status(400).json({ error: 'first_ts and last_ts must be ms-epoch integers' });
    }
    if (lastTs < firstTs) return res.status(400).json({ error: 'last_ts must be >= first_ts' });

    const bytes = Buffer.from(b64, 'base64');
    if (bytes.length === 0) return res.status(400).json({ error: 'empty chunk payload' });
    // Same absolute ceiling, now on the decoded bytes (base64 padding/whitespace
    // makes the check above an estimate). Still BEFORE inflation: never spend CPU
    // decompressing something already known to be refused.
    if (bytes.length > MAX_SNAPSHOT_CHUNK_BYTES) {
      return res.status(413).json({ error: `chunk exceeds ${MAX_SNAPSHOT_CHUNK_BYTES} gzipped bytes` });
    }
    // Between the two tiers the verdict depends on what is INSIDE the payload, so it
    // cannot be reached yet. Held here and decided right after inflateEventArray,
    // which is itself bounded by MAX_INFLATED_CHUNK_BYTES.
    const overOrdinaryCap = bytes.length > MAX_CHUNK_BYTES;

    // Integrity before anything is stored. A mismatch means the payload was
    // truncated or altered in flight (or the client hashed something else) — either
    // way the bytes are not what the recorder produced, so store nothing.
    const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
    if (sha256 !== claimedSha.toLowerCase()) {
      return res.status(400).json({ error: 'sha256 does not match the decoded payload' });
    }

    const run = await db.collection(COLL_RECORDINGS).findOne(
      { recording_id: replayId },
      {
        projection: {
          _id: 0, recording_id: 1, machine_id: 1, status: 1, capture: 1,
          chunk_count: 1, byte_size: 1,
        },
      },
    );
    if (!run) return res.status(404).json({ error: 'replay not found' });
    if (run.machine_id !== req.machine.id) {
      return res.status(403).json({ error: 'replay belongs to another machine' });
    }
    if (run.capture !== CAPTURE_DOM_EVENTS) {
      return res.status(409).json({ error: 'replay is not a dom_events capture' });
    }
    if (run.status !== STATUS_RECORDING) {
      return res.status(409).json({ error: `replay is ${run.status}, not accepting chunks` });
    }

    // Prove the payload really is a gzipped JSON array of events, and count them.
    // Doing this on ingest is what makes event_count server-authoritative and
    // guarantees /events can never hit an unreplayable chunk. Nothing from inside
    // an event is retained — only the array length.
    let events;
    try {
      events = await inflateEventArray(bytes);
    } catch (err) {
      return res.status(400).json({ error: `payload is not a gzipped JSON array of events: ${err.message}` });
    }
    const eventCount = events.length;

    // Whether this chunk really opens a replayable segment. DERIVED FROM THE PAYLOAD,
    // like event_count, rather than taken from b.has_full_snapshot: the claim decides
    // both how big the chunk is allowed to be and where a player can start playback,
    // and neither should rest on a client's word when the answer is sitting in the
    // bytes we just inflated. Nothing from the events is retained — this is one
    // boolean over their `type` field.
    const hasFullSnapshot = events.some((e) => e && e.type === RRWEB_TYPE_FULL_SNAPSHOT);

    // Tier 1: a chunk over the ordinary cap is only allowed the larger allowance if
    // it genuinely carries the snapshot that justifies it. A client that set
    // has_full_snapshot to buy room for 300 KB of mouse moves gets the normal 413.
    if (overOrdinaryCap && !hasFullSnapshot) {
      return res.status(413).json({ error: `chunk exceeds ${MAX_CHUNK_BYTES} gzipped bytes` });
    }

    // Idempotency, first line: a retried chunk we already hold must not be stored
    // twice or double-counted. The unique {recording_id, seq} index is the second
    // line, for two retries racing (handled below).
    const existing = await db.collection(COLL_CHUNKS).findOne(
      { recording_id: replayId, seq },
      { projection: { _id: 0, sha256: 1 } },
    );
    if (existing) return respondToDuplicate(res, existing, sha256);

    // Run-level caps. Checked against the server's own $inc'd totals, so a client
    // that lies about its counters cannot talk its way past them. A breach ends the
    // run: it is filed as aborted with the exact reason, which is both the honest
    // status and what stops the client's remaining chunks from being accepted one
    // at a time.
    const cap = runCapExceeded(run, bytes.length);
    if (cap) {
      await db.collection(COLL_RECORDINGS).updateOne(
        { recording_id: replayId, status: STATUS_RECORDING },
        {
          $set: {
            status: STATUS_ABORTED,
            stop_reason: 'chunk_cap',
            abort_reason: 'chunk_cap',
            // Which cap, so the tombstone says more than "too big".
            cap_exceeded: cap,
            ended_at: new Date(),
          },
        },
      );
      return res.status(413).json({ error: `replay exceeded its ${cap} cap; run aborted`, cap_exceeded: cap });
    }

    try {
      await db.collection(COLL_CHUNKS).insertOne({
        recording_id: replayId,
        seq,
        encoding: 'gzip',
        // A Node Buffer serialises to BSON binary subtype 0; the driver hands it
        // back as a Binary, which readChunkBytes() below normalises.
        payload: bytes,
        // Server-derived from the payload itself.
        event_count: eventCount,
        // What the client said, kept beside — never over — the server's count.
        client_event_count: normalizeInt(b.event_count, 0, Number.MAX_SAFE_INTEGER),
        first_ts: firstTs,
        last_ts: lastTs,
        // Whether this chunk opens with a full DOM snapshot, i.e. whether playback
        // can start here without replaying everything before it. Server-derived (see
        // above); the client's own claim is kept beside it, never over it.
        has_full_snapshot: hasFullSnapshot,
        client_has_full_snapshot: b.has_full_snapshot === true,
        byte_size: bytes.length,
        sha256,
        received_at: new Date(),
      });
    } catch (err) {
      if (!isDuplicateKey(err)) throw err;
      // Lost a race with a concurrent retry of the same seq. The winner's row is
      // authoritative; answer as if we had seen it in the check above.
      const winner = await db.collection(COLL_CHUNKS).findOne(
        { recording_id: replayId, seq },
        { projection: { _id: 0, sha256: 1 } },
      );
      return respondToDuplicate(res, winner ?? { sha256 }, sha256);
    }

    // One atomic document update. $inc rather than read-modify-write so parallel or
    // retried uploads cannot lose an increment, and $min/$max rather than a
    // read-compare-write so out-of-order chunks still widen the timeline correctly.
    await db.collection(COLL_RECORDINGS).updateOne(
      { recording_id: replayId },
      {
        $inc: { event_count: eventCount, chunk_count: 1, byte_size: bytes.length },
        $min: { first_event_ts: firstTs },
        $max: { last_event_ts: lastTs },
        $set: { last_chunk_at: new Date() },
      },
    );

    res.status(204).end();
  }));

  // ── Finish (or abort) a run ───────────────────────────────────────────────
  app.post('/api/v1/replays/:replay_id/complete', requireMachineAuth, a(async (req, res) => {
    const replayId = String(req.params.replay_id);
    const b = req.body ?? {};

    const run = await db.collection(COLL_RECORDINGS).findOne(
      { recording_id: replayId },
      { projection: { _id: 0, recording_id: 1, machine_id: 1, status: 1, capture: 1 } },
    );
    if (!run) return res.status(404).json({ error: 'replay not found' });
    if (run.machine_id !== req.machine.id) {
      return res.status(403).json({ error: 'replay belongs to another machine' });
    }
    if (run.capture !== CAPTURE_DOM_EVENTS) {
      return res.status(409).json({ error: 'replay is not a dom_events capture' });
    }

    // session_ids is merged, never overwritten, so a second /complete (or one that
    // reports a different subset) cannot drop a conversation this run covered.
    const sessionIds = normalizeSessionIds(b.session_ids);
    if (sessionIds.length) {
      await db.collection(COLL_RECORDINGS).updateOne(
        { recording_id: replayId },
        { $addToSet: { session_ids: { $each: sessionIds } } },
      );
    }

    // Already finished: confirm the state instead of erroring. The extension
    // retries /complete after a service-worker restart, and a 409 there would look
    // like data loss to an operator reading logs. Terminal state is never rewritten
    // — the first ending is the true one.
    if (run.status !== STATUS_RECORDING) {
      const current = await db.collection(COLL_RECORDINGS).findOne(
        { recording_id: replayId },
        { projection: { _id: 0 } },
      );
      return res.json({ ...publicReplay(current), idempotent: true });
    }

    const stopReason = normalizeShortString(b.stop_reason, MAX_STOP_REASON_LEN);
    const explicitAbort = normalizeShortString(b.abort_reason, MAX_STOP_REASON_LEN);
    const aborted = explicitAbort !== null
      || (stopReason !== null && !CLEAN_STOP_REASONS.has(stopReason));

    await db.collection(COLL_RECORDINGS).updateOne(
      { recording_id: replayId },
      {
        $set: {
          status: aborted ? STATUS_ABORTED : STATUS_COMPLETE,
          ended_at: toDate(b.ended_at),
          duration_ms: normalizeInt(b.duration_ms, 0, Number.MAX_SAFE_INTEGER),
          // Kept on a clean stop too: "how did this end" is useful on its own, and
          // the classification above must not be the only surviving record of it.
          stop_reason: stopReason,
          abort_reason: aborted ? (explicitAbort ?? stopReason) : null,
          // The CLIENT's view of the run, stored next to — never over — the
          // server's own $inc'd counters. A gap between the two is exactly the
          // "the evidence has holes" signal an admin needs, so both numbers are
          // kept and neither is allowed to overwrite the other.
          client_chunk_count: normalizeInt(b.chunk_count, 0, Number.MAX_SAFE_INTEGER),
          client_event_count: normalizeInt(b.event_count, 0, Number.MAX_SAFE_INTEGER),
          client_duration_ms: normalizeInt(b.duration_ms, 0, Number.MAX_SAFE_INTEGER),
        },
      },
    );

    const updated = await db.collection(COLL_RECORDINGS).findOne(
      { recording_id: replayId },
      { projection: { _id: 0 } },
    );
    res.json(publicReplay(updated));
  }));

  // ── List runs — metadata only, real admin auth ────────────────────────────
  //
  // requireAdminAuth is enforced in EVERY environment: its NODE_ENV !==
  // 'production' bypass was removed in an earlier round (see the note in auth.js)
  // and must not come back. A DOM replay reconstructs what was on a user's screen,
  // so these routes do not inherit the deliberately open read path of
  // GET /api/v1/dlp and GET /api/v1/sessions.
  app.get('/api/v1/replays', requireAdminAuth, a(async (req, res) => {
    const filter = {};

    // Legacy tab_video runs share this collection but have no replayable chunks,
    // so the default view is DOM runs only. ?capture=tab_video|all is there for an
    // audit that wants the video-era tombstones.
    const capture = normalizeShortString(req.query.capture, 40) ?? CAPTURE_DOM_EVENTS;
    if (capture !== 'all') {
      if (capture !== CAPTURE_DOM_EVENTS && capture !== CAPTURE_TAB_VIDEO) {
        return res.status(400).json({ error: "capture must be 'dom_events', 'tab_video' or 'all'" });
      }
      filter.capture = capture;
    }

    // Array containment: a run matches if this conversation is one of the ones it
    // covers. Served by the {session_ids:1, started_at:1} multikey index.
    const sessionId = normalizeShortString(req.query.session_id, MAX_SESSION_ID_LEN);
    if (sessionId) filter.session_ids = sessionId;

    const machineId = normalizeShortString(req.query.machine_id, 200);
    if (machineId) filter.machine_id = machineId;

    const status = normalizeShortString(req.query.status, 20);
    if (status) filter.status = status;

    const rows = await db.collection(COLL_RECORDINGS)
      .find(filter)
      .sort({ started_at: -1 })
      .limit(clampLimit(req.query.limit))
      .project({ _id: 0 })
      .toArray();

    res.json(rows.map(publicReplay));
  }));

  // ── Manifest — the playback contract for the player ───────────────────────
  //
  // The run's metadata plus an ordered index of its chunks, WITHOUT payloads. A
  // player uses it to size the timeline, to find the seq it can start playback
  // from (has_full_snapshot), and to decide which sub-range to pull from /events.
  app.get('/api/v1/replays/:replay_id', requireAdminAuth, a(async (req, res) => {
    const replayId = String(req.params.replay_id);

    const run = await db.collection(COLL_RECORDINGS).findOne(
      { recording_id: replayId },
      { projection: { _id: 0 } },
    );
    if (!run) return res.status(404).json({ error: 'replay not found' });

    const rows = await db.collection(COLL_CHUNKS)
      .find({ recording_id: replayId })
      .sort({ seq: 1 })
      // payload is excluded on purpose: a manifest must never carry event bytes.
      .project({
        _id: 0, seq: 1, event_count: 1, client_event_count: 1, first_ts: 1,
        last_ts: 1, has_full_snapshot: 1, byte_size: 1, sha256: 1,
      })
      .toArray();
    // The projection is the contract, the sort is the correctness requirement.
    // Re-sort locally so a degraded cursor cannot hand back a scrambled timeline.
    rows.sort((x, y) => x.seq - y.seq);

    const chunks = rows.map((c) => ({
      seq: c.seq,
      event_count: c.event_count ?? 0,
      first_ts: c.first_ts ?? null,
      last_ts: c.last_ts ?? null,
      has_full_snapshot: c.has_full_snapshot === true,
      byte_size: c.byte_size ?? 0,
      sha256: c.sha256 ?? null,
    }));

    const storedEvents = chunks.reduce((t, c) => t + c.event_count, 0);
    const storedBytes = chunks.reduce((t, c) => t + c.byte_size, 0);
    const missingSeqs = findGaps(chunks.map((c) => c.seq));

    res.json({
      ...publicReplay(run),
      playback: {
        kind: 'rrweb-events',
        // Restated at the top level so a player never has to infer the rule.
        note: 'fetch /events for NDJSON rrweb events in order; replay with rrweb-player. This is a DOM reconstruction, not video.',
        events_url: `/api/v1/replays/${encodeURIComponent(replayId)}/events`,
        recorder: run.recorder ?? null,
        mask_profile: run.mask_profile ?? null,
      },
      chunks,
      // Three views of the same run, kept separate so a discrepancy is visible
      // rather than smoothed over: what is actually stored, what the server
      // counted as it accepted uploads, and what the client believed it sent.
      integrity: {
        chunks_stored: chunks.length,
        chunks_server_counted: run.chunk_count ?? 0,
        chunks_client_reported: run.client_chunk_count ?? null,
        events_stored: storedEvents,
        events_server_counted: run.event_count ?? 0,
        events_client_reported: run.client_event_count ?? null,
        byte_size_stored: storedBytes,
        byte_size_server_counted: run.byte_size ?? 0,
        // A hole in the seq sequence is a hole in the playback, so name them.
        missing_seqs: missingSeqs.slice(0, MAX_REPORTED_GAPS),
        missing_seq_count: missingSeqs.length,
        consistent: chunks.length === (run.chunk_count ?? 0)
          && storedEvents === (run.event_count ?? 0)
          && storedBytes === (run.byte_size ?? 0)
          && missingSeqs.length === 0,
      },
    });
  }));

  // ── Events — the reconstructable content itself ───────────────────────────
  //
  // The one route that returns what was on screen. NDJSON, one rrweb event per
  // line, in seq then in-chunk order: chunks are read in seq order, gunzipped, and
  // each event written as its own line. Streamed in small batches so a 50 MB run is
  // never materialised on the heap, and never cached anywhere.
  //
  // ?from_seq / ?to_seq (inclusive) fetch a sub-range, for progressive loading — a
  // player can pull the chunk containing the nearest full snapshot and go forward
  // from there instead of downloading the whole run to seek.
  app.get('/api/v1/replays/:replay_id/events', requireAdminAuth, a(async (req, res) => {
    const replayId = String(req.params.replay_id);

    const fromSeq = req.query.from_seq === undefined ? 0 : normalizeInt(req.query.from_seq, 0, MAX_SEQ);
    const toSeq = req.query.to_seq === undefined ? MAX_SEQ : normalizeInt(req.query.to_seq, 0, MAX_SEQ);
    if (fromSeq === null || toSeq === null) {
      return res.status(400).json({ error: `from_seq and to_seq must be integers in [0, ${MAX_SEQ}]` });
    }
    if (toSeq < fromSeq) return res.status(400).json({ error: 'to_seq must be >= from_seq' });

    const run = await db.collection(COLL_RECORDINGS).findOne(
      { recording_id: replayId },
      { projection: { _id: 0, recording_id: 1, status: 1, capture: 1, purged_at: 1 } },
    );
    if (!run) return res.status(404).json({ error: 'replay not found' });
    if (run.capture !== CAPTURE_DOM_EVENTS) {
      // A legacy video run's tombstone survives, but there are no events to serve.
      return res.status(409).json({ error: 'replay is not a dom_events capture' });
    }
    if (run.status === STATUS_EXPIRED || run.purged_at) {
      // The tombstone outlives the events on purpose; say which it is.
      return res.status(410).json({ error: 'replay expired and its events were purged' });
    }

    // seq index first, payloads in batches after — so the response can start
    // flowing before the whole run has been read.
    const index = await db.collection(COLL_CHUNKS)
      .find({ recording_id: replayId, seq: { $gte: fromSeq, $lte: toSeq } })
      .sort({ seq: 1 })
      .project({ _id: 0, seq: 1 })
      .toArray();
    const seqs = index.map((c) => c.seq).sort((x, y) => x - y);

    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    // Screen reconstruction must not land in a shared cache, a disk cache or a
    // proxy, and must not be sniffed into something a browser will execute.
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // An empty run is a legitimate 200 with no lines; the manifest is where a
    // client learns the chunk count.
    if (!seqs.length) return res.end();

    try {
      for (let i = 0; i < seqs.length; i += EVENTS_READ_BATCH) {
        if (res.destroyed || res.writableEnded) return;      // client went away
        const batchSeqs = seqs.slice(i, i + EVENTS_READ_BATCH);
        const batch = await db.collection(COLL_CHUNKS)
          .find({ recording_id: replayId, seq: { $in: batchSeqs } })
          .project({ _id: 0, seq: 1, payload: 1 })
          .toArray();
        batch.sort((x, y) => x.seq - y.seq);

        for (const chunk of batch) {
          const events = await inflateEventArray(readChunkBytes(chunk.payload));
          for (const ev of events) {
            if (res.destroyed || res.writableEnded) return;
            if (!res.write(JSON.stringify(ev) + '\n')) await once(res, 'drain');
          }
        }
      }
    } catch (err) {
      // Headers are already out, so the status cannot be changed. Aborting the
      // response is the honest signal: the client sees a truncated transfer rather
      // than believing it received the whole recording. The message deliberately
      // carries no payload content.
      console.error(`[replays] stream failed replay=${replayId}: ${err.message}`);
      res.destroy(err);
      return;
    }

    res.end();
  }));
}

// ── Caps ─────────────────────────────────────────────────────────────────────

// Which run-level cap this chunk would breach, or null. Both are checked against
// the server's own counters, not the client's.
function runCapExceeded(run, incomingBytes) {
  if ((run.chunk_count ?? 0) >= MAX_CHUNKS_PER_RUN) return 'chunk_count';
  if ((run.byte_size ?? 0) + incomingBytes > MAX_RUN_BYTES) return 'run_bytes';
  return null;
}

// ── Payload handling ─────────────────────────────────────────────────────────

// Gunzip (bounded) and require a JSON array. Throws with a reason the caller can
// put in a 400 — never with any part of the decoded content.
async function inflateEventArray(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 2) throw new Error('payload missing');
  // gzip magic. Checked before spending CPU on a stream that cannot be gzip.
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) throw new Error('not gzip');

  let json;
  try {
    // maxOutputLength is the zip-bomb guard: a small gzip stream can otherwise
    // inflate to hundreds of MB inside one request.
    json = await gunzip(bytes, { maxOutputLength: MAX_INFLATED_CHUNK_BYTES });
  } catch (err) {
    throw new Error(`gunzip failed (${err.code || err.message})`);
  }

  let parsed;
  try {
    parsed = JSON.parse(json.toString('utf8'));
  } catch {
    throw new Error('inflated payload is not JSON');
  }
  if (!Array.isArray(parsed)) throw new Error('inflated payload is not a JSON array');
  return parsed;
}

// The stored payload comes back as a BSON Binary from the real driver and as a
// plain Buffer from the in-memory test double, so normalise both.
function readChunkBytes(payload) {
  if (Buffer.isBuffer(payload)) return payload;
  if (payload instanceof Uint8Array) return Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength);
  if (payload && payload.buffer) return readChunkBytes(payload.buffer);
  if (payload && typeof payload.value === 'function') return readChunkBytes(payload.value(true));
  throw new Error('chunk payload is not binary');
}

// A retry of a chunk we already hold is a success (204) when the bytes match.
// Different bytes under the same seq is a real integrity problem — one of the two
// uploads is not what the recorder produced — so it is reported rather than
// silently resolved in favour of whichever arrived first.
function respondToDuplicate(res, existing, sha256) {
  if (existing.sha256 && existing.sha256 !== sha256) {
    return res.status(409).json({ error: 'chunk already stored with different content' });
  }
  return res.status(204).end();
}

// ── Shaping / validation ─────────────────────────────────────────────────────

// The wire shape of a run. Mapped explicitly, never spread, so a field added to
// session_recordings later cannot leak out of a read route by accident.
export function publicReplay(r) {
  if (!r) return null;
  return {
    // `replay_id` on the wire, `recording_id` in storage — see the WIRE CONTRACT
    // note at the top of this file.
    replay_id: r.recording_id,
    machine_id: r.machine_id,
    tab_host: r.tab_host,
    ai_service: r.ai_service ?? null,
    // 'dom_events' for rrweb runs, 'tab_video' for the retired video phase.
    capture: r.capture ?? null,
    recorder: r.recorder ?? null,
    mask_profile: r.mask_profile ?? null,
    session_ids: r.session_ids ?? [],
    started_at: r.started_at ?? null,
    ended_at: r.ended_at ?? null,
    duration_ms: r.duration_ms ?? null,
    // The playback timeline, in the client's ms-epoch clock.
    first_event_ts: r.first_event_ts ?? null,
    last_event_ts: r.last_event_ts ?? null,
    // Server-authoritative totals — what is actually stored.
    event_count: r.event_count ?? 0,
    chunk_count: r.chunk_count ?? 0,
    byte_size: r.byte_size ?? 0,
    // What the client believed it uploaded. Kept alongside, never merged.
    client_event_count: r.client_event_count ?? null,
    client_chunk_count: r.client_chunk_count ?? null,
    // Surfaced deliberately: "was audio recorded" is a governance answer, not an
    // implementation detail. Always false for a DOM recording.
    audio: r.audio === true,
    status: r.status,
    stop_reason: r.stop_reason ?? null,
    abort_reason: r.abort_reason ?? null,
    cap_exceeded: r.cap_exceeded ?? null,
    expires_at: r.expires_at ?? null,
    expired_at: r.expired_at ?? null,
    purged_at: r.purged_at ?? null,
    purged_reason: r.purged_reason ?? null,
    purged_chunk_count: r.purged_chunk_count ?? null,
    purged_byte_size: r.purged_byte_size ?? null,
  };
}

// Missing seq numbers between the lowest and highest stored chunk. A gap is a hole
// in the playback, so the manifest reports it instead of leaving a player to
// discover it as a rendering glitch.
function findGaps(seqs) {
  if (seqs.length < 2) return [];
  const present = new Set(seqs);
  const out = [];
  for (let s = seqs[0]; s < seqs[seqs.length - 1]; s++) {
    if (!present.has(s)) out.push(s);
  }
  return out;
}

function isDuplicateKey(err) {
  return err?.code === 11000 || /duplicate key/i.test(err?.message || '');
}

function normalizeShortString(value, maxLen) {
  if (typeof value !== 'string') return null;
  const s = value.trim();
  if (!s || s.length > maxLen) return null;
  return s;
}

function normalizeSessionIds(value) {
  if (value === undefined || value === null) return [];
  const arr = Array.isArray(value) ? value : [value];
  const out = [];
  for (const v of arr.slice(0, MAX_SESSION_IDS)) {
    const s = normalizeShortString(v, MAX_SESSION_ID_LEN);
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}

function normalizeInt(value, min, max) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < min || n > max) return null;
  return n;
}

function clampLimit(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIST_LIMIT;
  return Math.min(Math.floor(n), MAX_LIST_LIMIT);
}

// The client clock is the only wall clock that can say when a capture started;
// fall back to server time when it is missing or unparseable.
function toDate(value) {
  if (value) {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return new Date();
}

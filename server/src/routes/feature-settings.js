// GET/PUT /api/v1/features — the fleet-wide switches behind the Settings page.
//
// WHAT CHANGED AND WHY. This endpoint already existed, defined inline in index.js,
// and it already reached all three surfaces. Its only source was `FEAT_*`
// environment variables, which meant turning a feature off required editing
// server/.env and restarting the server — impossible from the dashboard, and
// impossible at all for anyone without shell access to the host. So the switches
// existed but nobody could throw them.
//
// It is now database-backed with an admin-writable PUT. The env vars stay as the
// floor beneath the stored value, so existing deployments behave exactly as they
// did until someone changes something in the UI.
//
// The wire shape is UNCHANGED — { features: { key: { label, status } } } — because
// connect-ui/src/featureFlags.js and the extension's content scripts already parse
// it. Fields are added, never renamed. Renaming a key would silently un-gate live
// enforcement on every deployed machine.
//
// PROPAGATION. Both endpoints poll; neither is pushed to. Same shape as the four
// policy channels this product already runs, and chosen for the same reasons: it
// survives sleep, offline and MV3 service-worker termination for free, and an
// endpoint that misses a poll simply gets the change on the next one. Budget about
// a minute from click to effect.
//
// THE READ IS UNAUTHENTICATED, matching every other policy endpoint here: policy
// must reach an endpoint whose token is stale or which has not finished enrolling.
// THE WRITE IS ADMIN-GATED, AND AUDITED — these switches can turn off the
// compliance product, so "who disabled DLP, and when" has to be answerable.

import crypto from 'node:crypto';
import { a } from '../util.js';
import { requireAdminAuth } from '../auth.js';
import {
  FEATURE_REGISTRY,
  SURFACES,
  isKnownFeature,
  keysForSurface,
  lockedFeatures,
  effectiveFeatures,
} from '../lib/feature-registry.js';
import { getPack } from '../governance/services/policyPacks.js';

const DOC_ID = 'default';
const SETTINGS = 'feature_settings';
const AUDIT = 'feature_settings_audit';
const DEPLOYMENTS = 'policy_pack_deployments';

async function resolve(db) {
  const doc = await db.collection(SETTINGS).findOne({ id: DOC_ID });
  const overrides = doc?.features && typeof doc.features === 'object' ? doc.features : {};

  const deployments = await db.collection(DEPLOYMENTS).find({}).toArray();
  const deployedPacks = [];
  for (const d of deployments) {
    if (!d?.deployed_version) continue;        // undeployed keeps history, requires nothing
    const pack = getPack(d.pack_id);
    if (pack) deployedPacks.push({ pack, ruleStates: d.rules || {} });
  }

  return {
    features: effectiveFeatures({ overrides, locks: lockedFeatures(deployedPacks) }),
    updated_at: doc?.updated_at || null,
  };
}

/**
 * A hash of what surfaces ACT ON — the statuses, nothing else.
 *
 * Deliberately excludes labels and lock provenance. Deploying a pack over features
 * that were already on changes the locks but changes nothing any endpoint does;
 * including that here would wake every machine in the fleet for a no-op. The UI
 * reads the payload fresh and never uses the version to skip.
 */
function versionOf(features) {
  const stable = Object.keys(features).sort().map((k) => [k, features[k].status]);
  return crypto.createHash('sha256').update(JSON.stringify(stable)).digest('hex').slice(0, 16);
}

export function mountFeatureSettings(app, db) {
  // ── read ──────────────────────────────────────────────────────────────────
  app.get('/api/v1/features', a(async (req, res) => {
    const { features, updated_at } = await resolve(db);
    const version = versionOf(features);

    // ?surface=extension|agent|dashboard trims to what that surface consumes.
    // Both endpoint surfaces assert they recognise every key they are sent, so an
    // unknown key is a deployment skew worth failing a test over, not ignoring.
    const surface = req.query.surface ? String(req.query.surface) : null;
    let out = features;
    if (surface) {
      if (!SURFACES.includes(surface)) {
        return res.status(400).json({ error: `unknown surface: ${surface}` });
      }
      const allowed = new Set(keysForSurface(surface));
      out = Object.fromEntries(Object.entries(features).filter(([k]) => allowed.has(k)));
    }

    // `features` first and unchanged in shape — every existing consumer reads it.
    // The version is of the WHOLE state even when filtered, so two surfaces never
    // disagree about whether they are current.
    res.json({ features: out, version, generated_at: new Date().toISOString(), updated_at });
  }));

  // The catalogue, for the settings page to render from.
  app.get('/api/v1/features/registry', a(async (_req, res) => {
    res.json({
      groups: [...new Set(FEATURE_REGISTRY.map((f) => f.group))],
      surfaces: SURFACES,
      features: FEATURE_REGISTRY,
    });
  }));

  // ── write ─────────────────────────────────────────────────────────────────
  app.put('/api/v1/features', requireAdminAuth, a(async (req, res) => {
    const incoming = req.body?.features;
    if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
      return res.status(400).json({ error: 'features must be an object of { key: boolean }' });
    }

    // REJECT UNKNOWN KEYS rather than storing them. A key nothing reads would
    // render as a working switch and do nothing — the precise failure the registry
    // exists to prevent. It also catches a dashboard left behind by a rollback.
    const unknown = Object.keys(incoming).filter((k) => !isKnownFeature(k));
    if (unknown.length) return res.status(400).json({ error: `unknown feature keys: ${unknown.join(', ')}` });

    const nonBool = Object.entries(incoming).filter(([, v]) => typeof v !== 'boolean');
    if (nonBool.length) {
      return res.status(400).json({ error: `values must be boolean: ${nonBool.map(([k]) => k).join(', ')}` });
    }

    const before = (await resolve(db)).features;

    const doc = await db.collection(SETTINGS).findOne({ id: DOC_ID });
    const now = new Date();
    await db.collection(SETTINGS).updateOne(
      { id: DOC_ID },
      { $set: { id: DOC_ID, features: { ...(doc?.features || {}), ...incoming }, updated_at: now } },
      { upsert: true },
    );

    const after = (await resolve(db)).features;

    // Only real transitions are recorded. Re-saving the page unchanged must not
    // manufacture audit noise that buries the one change that mattered.
    const changes = Object.keys(after)
      .filter((k) => before[k]?.status !== after[k]?.status)
      .map((k) => ({ key: k, from: before[k]?.status, to: after[k]?.status }));

    if (changes.length) {
      await db.collection(AUDIT).insertOne({
        at: now,
        actor: String(req.body?.actor || req.headers['x-actor'] || 'unknown'),
        changes,
        // Kept even when the effective state did not move: an attempt to disable a
        // locked feature is worth seeing.
        requested: incoming,
      });
    }

    res.json({ ok: true, version: versionOf(after), changed: changes, features: after });
  }));

  // ── who changed what ──────────────────────────────────────────────────────
  app.get('/api/v1/features/audit', requireAdminAuth, a(async (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const rows = await db.collection(AUDIT)
      .find({}).sort({ at: -1 }).limit(limit).project({ _id: 0 }).toArray();
    res.json(rows);
  }));
}

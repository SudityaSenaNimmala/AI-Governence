// Where on a governed page capture is allowed.
//
// THE DEFECT THIS PINS DOWN. Governance scope was decided per HOST and enforced
// across the whole PAGE. The registry governs mail.google.com for "Gemini in
// Gmail", hubspot.com for HubSpot AI, github.com for Copilot — and once a host was
// governed, service-worker.js injected the DLP stack into the whole tab and
// content.js captured from every textarea, contenteditable and file input on it.
// Production held 186 events from app.hubspot.com, 32 from github.com and 6 from a
// SharePoint tenant, all from ordinary compose fields, all with stored content —
// employee correspondence collected under an AI-governance policy.
//
// Two properties matter and both are asserted here: a dedicated AI site keeps its
// current whole-page behaviour, and a SaaS app with embedded AI is restricted to
// its AI panel.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { readFileSync } from 'node:fs';

import {
  SURFACE_SCOPE, surfaceFor, isEmbeddedAi, embeddedAiHostKeys, EMBEDDED_AI_SURFACES,
} from '../src/lib/ai-surfaces.js';
import { mountAiSurfaces } from '../src/routes/ai-surfaces.js';

// ── Scope resolution ────────────────────────────────────────────────────────

test('dedicated AI sites stay whole_site — current behaviour is preserved', () => {
  for (const host of [
    'chatgpt.com', 'chat.openai.com', 'claude.ai',
    'gemini.google.com', 'aistudio.google.com',
    'perplexity.ai', 'chat.mistral.ai', 'poe.com',
  ]) {
    assert.equal(surfaceFor(host).scope, SURFACE_SCOPE.WHOLE_SITE, `${host} must stay whole_site`);
    assert.equal(isEmbeddedAi(host), false);
  }
});

test('the hosts that over-collected are embedded_ai', () => {
  for (const host of [
    'mail.google.com', 'app.hubspot.com', 'github.com',
    'cloudfuzecom-my.sharepoint.com', 'marketingcloudfuze.zendesk.com',
  ]) {
    const s = surfaceFor(host);
    assert.equal(s.scope, SURFACE_SCOPE.EMBEDDED_AI, `${host} must be embedded_ai`);
    assert.ok(s.selectors.length > 0, `${host} has no panel selectors, so nothing could ever match`);
  }
});

// gemini.google.com is a Google host and mail.google.com is embedded — a sloppy
// suffix match on 'google.com' would drag Gemini into embedded_ai and silence the
// one platform that is supposed to be fully governed.
test('subdomain matching does not leak between Google properties', () => {
  assert.equal(surfaceFor('gemini.google.com').scope, SURFACE_SCOPE.WHOLE_SITE);
  assert.equal(surfaceFor('aistudio.google.com').scope, SURFACE_SCOPE.WHOLE_SITE);
  assert.equal(surfaceFor('mail.google.com').scope, SURFACE_SCOPE.EMBEDDED_AI);
  assert.equal(surfaceFor('docs.google.com').scope, SURFACE_SCOPE.EMBEDDED_AI);
});

test('dot-suffix matches a tenant subdomain, a bare substring does not', () => {
  assert.equal(surfaceFor('acme.zendesk.com').scope, SURFACE_SCOPE.EMBEDDED_AI);
  assert.equal(surfaceFor('acme.my.salesforce.com').scope, SURFACE_SCOPE.EMBEDDED_AI);
  // Not a subdomain of zendesk.com — an attacker-controlled lookalike must not
  // inherit a policy entry, in either direction.
  assert.equal(surfaceFor('zendesk.com.evil.example').scope, SURFACE_SCOPE.WHOLE_SITE);
  assert.equal(surfaceFor('notzendesk.com').scope, SURFACE_SCOPE.WHOLE_SITE);
});

test('an unknown host defaults to whole_site, and that default is deliberate', () => {
  // The LLM classifier discovers arbitrary AI sites and governs them with generic
  // selectors. Defaulting those to embedded_ai would silently stop capture on
  // every newly discovered tool, which is a worse failure than the one being
  // fixed. The residual risk — an unlisted SaaS app with embedded AI — is on the
  // roadmap, not papered over here.
  assert.equal(surfaceFor('some-new-ai-tool.example').scope, SURFACE_SCOPE.WHOLE_SITE);
  assert.equal(surfaceFor('').scope, SURFACE_SCOPE.WHOLE_SITE);
  assert.equal(surfaceFor(null).scope, SURFACE_SCOPE.WHOLE_SITE);
});

// A selector matching the bare token "ai" also matches "mail" — on Gmail that
// would re-select the entire mail UI and reproduce the exact bug being fixed.
test('no selector keys on a bare "ai" token', () => {
  for (const [host, entry] of Object.entries(EMBEDDED_AI_SURFACES)) {
    for (const sel of entry.selectors) {
      assert.doesNotMatch(sel, /\*=\s*"ai"/i,
        `${host}: selector ${sel} matches the substring "ai", which also matches "mail"`);
    }
    assert.ok(entry.product, `${host} has no product name`);
  }
});

test('every embedded host key is reported for the content purge', () => {
  const keys = embeddedAiHostKeys();
  assert.deepEqual([...keys].sort(), Object.keys(EMBEDDED_AI_SURFACES).sort());
  // The purge and the capture gate must agree on which hosts are embedded, or
  // one would delete content the other still collects.
  for (const k of keys) assert.equal(isEmbeddedAi(k), true);
});

// ── The endpoint ────────────────────────────────────────────────────────────

async function withServer(fn) {
  const app = express();
  app.use(express.json());
  mountAiSurfaces(app);
  app.use((err, req, res, next) => res.status(500).json({ error: err.message }));
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    return await fn(async (p) => {
      const res = await fetch(`${base}${p}`);
      assert.equal(res.status, 200, `GET ${p} → ${res.status}`);
      return res.json();
    });
  } finally {
    await new Promise((r) => server.close(r));
  }
}

test('GET /ai-surfaces serves the whole map for the extension to cache', async () => {
  await withServer(async (get) => {
    const body = await get('/api/v1/ai-surfaces');
    assert.equal(body.default_scope, SURFACE_SCOPE.WHOLE_SITE);
    assert.ok(body.embedded['mail.google.com'].selectors.length > 0);
    assert.equal(
      Object.keys(body.embedded).sort().join(','),
      embeddedAiHostKeys().sort().join(','),
    );
  });
});

test('GET /ai-surfaces?host= answers for one host', async () => {
  await withServer(async (get) => {
    const gmail = await get('/api/v1/ai-surfaces?host=mail.google.com');
    assert.equal(gmail.scope, SURFACE_SCOPE.EMBEDDED_AI);
    assert.ok(gmail.selectors.length > 0);

    const claude = await get('/api/v1/ai-surfaces?host=claude.ai');
    assert.equal(claude.scope, SURFACE_SCOPE.WHOLE_SITE);
    assert.deepEqual(claude.selectors, []);
  });
});

// ── Server map ↔ extension floor parity ─────────────────────────────────────
//
// WHY THIS IS PINNED. GET /api/v1/ai-surfaces is the authoritative map, and the
// reason it exists is that a vendor reshuffling its DOM should be a server-side
// selector fix rather than an extension release. That only holds for hosts the
// server actually knows about: a host present in the extension's built-in floor
// but absent from this map can never be corrected remotely, because the server
// answers whole_site for it and the extension falls back to its compiled-in
// selectors forever. The two lists drifted to 44 vs 9 once before — every host
// added to the extension floor since the feature shipped was unfixable from the
// server. Keep them equal.

const EXT_CONTENT = new URL(
  '../../browser-extension/content/content.js', import.meta.url,
);

/** Host keys from the extension's compiled-in EMBEDDED_AI_FLOOR. */
function extensionFloorHosts() {
  const src = readFileSync(EXT_CONTENT, 'utf8');
  const at = src.indexOf('const EMBEDDED_AI_FLOOR = {');
  assert.notEqual(at, -1, 'EMBEDDED_AI_FLOOR not found in content.js');
  const block = src.slice(at, src.indexOf('\n  };', at));
  // Value may be an array literal OR a bare GENERIC_AI_PANEL reference, so match
  // on the key and the colon rather than on the opening bracket.
  return [...block.matchAll(/^\s*'([^']+)':\s*\S/gm)].map((m) => m[1]);
}

test('the server map and the extension floor cover the same hosts', () => {
  const floor = extensionFloorHosts();
  assert.ok(floor.length > 20, `parsed only ${floor.length} floor hosts — parser is stale`);

  const server = embeddedAiHostKeys();
  const missingFromServer = floor.filter((h) => !server.includes(h));
  const missingFromFloor = server.filter((h) => !floor.includes(h));

  assert.deepEqual(
    missingFromServer, [],
    'hosts in the extension floor but not in server/src/lib/ai-surfaces.js — '
    + 'their selectors can never be fixed without shipping a new extension',
  );
  assert.deepEqual(
    missingFromFloor, [],
    'hosts the server scopes but the extension has no floor for — against an '
    + 'unreachable server these fail open and capture the whole page',
  );
});

test('every scoped host names its AI product and has at least one selector', () => {
  for (const [host, entry] of Object.entries(EMBEDDED_AI_SURFACES)) {
    assert.ok(entry.product, `${host} has no product name — the notice would read "AI tool"`);
    assert.ok(entry.selectors.length > 0, `${host} has no selectors — it would capture nothing`);
    for (const sel of entry.selectors) {
      // Cheap shape check — no DOM here to compile against. A selector that is
      // just "ai" or "*" would re-select the host app and reproduce the bug.
      assert.ok(sel.length > 3 && sel !== '*', `${host}: selector ${sel} is too broad`);
    }
  }
});

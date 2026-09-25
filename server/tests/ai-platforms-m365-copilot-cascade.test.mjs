// The Microsoft 365 Copilot cascade has to fire from BOTH admin surfaces that
// can toggle a product's block state, not just one.
//
// THE GAP THIS PINS DOWN. registry-m365-copilot-hosts.test.mjs already proves
// the cascade works from PUT /api/v1/registry/:id/status (the Inventory list).
// But a real admin can *also* reach this exact product from a second, host-
// keyed catalog page that calls PATCH /api/v1/ai-platforms/:host directly —
// found live 2026-09-21 when blocking "office.com" via the API cascaded
// correctly (Inventory's route), but the only row visibly toggleable in the
// Inventory UI for this product had zero discovered usage and never surfaced
// as its own row at all, while the host-keyed catalog page DID list
// `office.com` / `m365.cloud.microsoft` directly — and toggling THOSE through
// its own route did not cascade, because the cascade only lived in
// registry.js. Two admin surfaces disagreeing about what one product toggle
// covers is the exact failure this file exists to catch.
//
// THE FIX is `applyMicrosoftWorkspaceCopilotCascade` in lib/ai-surfaces.js,
// shared by both routes' handlers. This file exercises it through
// ai-platforms.js's PATCH specifically; registry.js's own call site is
// covered by registry-m365-copilot-hosts.test.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

import { mountAiPlatforms } from '../src/routes/ai-platforms.js';
import { MICROSOFT_WORKSPACE_COPILOT_HOSTS } from '../src/lib/ai-surfaces.js';
import { createFakeDb } from './helpers/fake-db.mjs';
import { adminJsonHeaders } from './helpers/admin-auth.mjs';

async function withServer(seed, fn) {
  const db = createFakeDb();
  if (seed) await seed(db);
  const app = express();
  app.use(express.json());
  mountAiPlatforms(app, db);
  app.use((err, req, res, next) => res.status(500).json({ error: err.message }));
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    return await fn({
      db,
      async patchHost(host, body) {
        const res = await fetch(`${base}/api/v1/ai-platforms/${encodeURIComponent(host)}`, {
          method: 'PATCH',
          headers: adminJsonHeaders(),
          body: JSON.stringify(body),
        });
        const json = await res.json();
        assert.equal(res.status, 200, `PATCH ${host} → ${res.status}: ${JSON.stringify(json)}`);
        return json;
      },
    });
  } finally {
    await new Promise((r) => server.close(r));
  }
}

const hostRow = (db, host) => db._rows('ai_platforms').find((r) => r.host === host);

async function seedOfficeDotCom(db) {
  await db.collection('ai_platforms').insertOne({
    host: 'office.com', vendor: 'Microsoft', product: 'Microsoft 365 Copilot',
    category: 'ide-assistant', sandbox: 'remote', governed: true, surface: 'browser',
    source: 'seed', added_by: 'system', added_at: new Date(), blocked: false,
  });
}

test('PATCH /api/v1/ai-platforms/office.com blocking cascades across all 10 curated hosts', async () => {
  await withServer(seedOfficeDotCom, async ({ db, patchHost }) => {
    await patchHost('office.com', { blocked: true });
    for (const host of MICROSOFT_WORKSPACE_COPILOT_HOSTS) {
      const row = hostRow(db, host);
      assert.ok(row, `${host} row must exist after the cascade`);
      // Stored as 1/0, matching applyMicrosoftWorkspaceCopilotCascade's own
      // convention — not a JS boolean.
      assert.equal(row.blocked, 1, `${host} must be blocked`);
    }
  });
});

test('PATCH unblocking office.com clears the whole curated set the same way', async () => {
  await withServer(async (db) => {
    await seedOfficeDotCom(db);
    for (const host of MICROSOFT_WORKSPACE_COPILOT_HOSTS) {
      if (host === 'office.com') continue;
      await db.collection('ai_platforms').insertOne({
        host, vendor: 'Microsoft', product: 'Microsoft 365 Copilot',
        surface: 'browser', blocked: true, added_at: new Date(),
      });
    }
  }, async ({ db, patchHost }) => {
    await patchHost('office.com', { blocked: false });
    for (const host of MICROSOFT_WORKSPACE_COPILOT_HOSTS) {
      assert.equal(hostRow(db, host).blocked, 0, `${host} must be unblocked`);
    }
  });
});

test('PATCHing an UNRELATED host never triggers the cascade', async () => {
  await withServer(async (db) => {
    await db.collection('ai_platforms').insertOne({
      host: 'claude.ai', vendor: 'Anthropic', product: 'Claude',
      surface: 'browser', blocked: false, added_at: new Date(),
    });
  }, async ({ db, patchHost }) => {
    await patchHost('claude.ai', { blocked: true });
    for (const host of MICROSOFT_WORKSPACE_COPILOT_HOSTS) {
      assert.equal(hostRow(db, host), undefined, `${host} must not have been created`);
    }
  });
});

test('toggling sharepoint.com or outlook.office.com DIRECTLY also cascades — the gate is HOST membership, not a product-string match', async () => {
  // The obvious design would gate this on the row's own `product` string
  // matching "Microsoft 365 Copilot" (mirroring registry.js's own gate). Found
  // live 2026-09-21 that this is wrong for THIS route: the seed data for
  // m365.cloud.microsoft itself — the exact host office_copilot_pane's `host`
  // field points to — carries product "Microsoft Copilot" (missing "365"),
  // the same kind of own-name inconsistency sharepoint.com/outlook.office.com
  // have by design. A product-string gate would have silently never cascaded
  // from the single most relevant host in the whole set. Host membership in
  // the curated, reviewed list is the correct, unambiguous signal here.
  await withServer(async (db) => {
    await db.collection('ai_platforms').insertOne({
      host: 'sharepoint.com', vendor: 'Microsoft', product: 'SharePoint Copilot',
      surface: 'browser', blocked: false, added_at: new Date(),
    });
  }, async ({ db, patchHost }) => {
    await patchHost('sharepoint.com', { blocked: true });
    assert.equal(hostRow(db, 'sharepoint.com').blocked, 1, 'the host itself is still patched');
    // sharepoint.com's OWN identity is untouched — the cascade only ever sets
    // `blocked` on an existing row (see applyMicrosoftWorkspaceCopilotCascade).
    assert.equal(hostRow(db, 'sharepoint.com').product, 'SharePoint Copilot');
    for (const host of MICROSOFT_WORKSPACE_COPILOT_HOSTS) {
      if (host === 'sharepoint.com') continue;
      const row = hostRow(db, host);
      assert.ok(row, `${host} must have been created by the cascade`);
      assert.equal(row.blocked, 1, `${host} must be blocked too`);
    }
  });
});

test('toggling a host NOT in the curated list never cascades, even if its product happens to say "Microsoft 365 Copilot"', async () => {
  // The mirror image of the test above: product-string match is not consulted
  // AT ALL by this route, in either direction. A row outside the curated list
  // must not be able to trigger the cascade just by carrying the right label.
  await withServer(async (db) => {
    await db.collection('ai_platforms').insertOne({
      host: 'copilot.microsoft.com', vendor: 'Microsoft', product: 'Microsoft 365 Copilot',
      surface: 'browser', blocked: false, added_at: new Date(),
    });
  }, async ({ db, patchHost }) => {
    await patchHost('copilot.microsoft.com', { blocked: true });
    assert.equal(hostRow(db, 'copilot.microsoft.com').blocked, 1);
    for (const host of MICROSOFT_WORKSPACE_COPILOT_HOSTS) {
      assert.equal(hostRow(db, host), undefined, `${host} must not have been created`);
    }
  });
});

test('a non-blocked field patch (e.g. governance_note) never triggers the cascade', async () => {
  await withServer(seedOfficeDotCom, async ({ db, patchHost }) => {
    await patchHost('office.com', { governance_note: 'reviewed' });
    for (const host of MICROSOFT_WORKSPACE_COPILOT_HOSTS) {
      if (host === 'office.com') continue;
      assert.equal(hostRow(db, host), undefined, `${host} must not exist — only 'blocked' patches cascade`);
    }
  });
});

test('the cascade widens surface to "all" for a host scoped only to desktop, same as the registry route', async () => {
  await withServer(async (db) => {
    await seedOfficeDotCom(db);
    await db.collection('ai_platforms').insertOne({
      host: 'teams.microsoft.com', vendor: 'Microsoft', product: 'Teams Copilot',
      surface: 'desktop', blocked: false, added_at: new Date(),
    });
  }, async ({ db, patchHost }) => {
    await patchHost('office.com', { blocked: true });
    const teams = hostRow(db, 'teams.microsoft.com');
    assert.equal(teams.blocked, 1);
    assert.equal(teams.surface, 'all', 'desktop-only surface must widen, not be reassigned away from desktop coverage');
  });
});

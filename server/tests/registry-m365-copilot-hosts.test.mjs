// Blocking the Microsoft 365 Copilot PRODUCT has to reach the browser extension.
//
// THE GAP THIS PINS DOWN. M365 Copilot is consumed across a set of Microsoft web
// surfaces — Teams, Outlook, SharePoint, office.com, cloud.microsoft — and has no
// single host of its own. The extension enforces per HOST, from ai_platforms, so a
// product toggle that only patched hosts already sitting in that collection
// enforced on whichever subset happened to be seeded and silently nowhere else.
//
// THE FIX IS A CURATED STATIC LIST, and that is the load-bearing part. The obvious
// shortcut — deriving the host set from a discovered agent's `matched_hosts` — is
// the over-blocking bug that was removed from PUT /api/v1/registry/:id/status:
// discovery attaches the whole Microsoft suite to every Copilot Studio agent, so
// one narrow decision blocked Teams, SharePoint and Outlook for the entire org.
// Coverage is therefore declared in lib/ai-surfaces.js and changing it is a code
// review, not a side effect of a tenant scan.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

import { mountRegistry } from '../src/routes/registry.js';
import {
  MICROSOFT_WORKSPACE_COPILOT_HOSTS,
  isMicrosoftWorkspaceCopilotProduct,
} from '../src/lib/ai-surfaces.js';
import { createFakeDb } from './helpers/fake-db.mjs';
import { adminJsonHeaders } from './helpers/admin-auth.mjs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// A successful live build rewrites data/registry-snapshot.json, so any test that
// mounts the registry keeps its own copy of that file rather than overwriting
// the curated capture the Inventory tab falls back on. Set before mountRegistry,
// which reads the path at mount time.
process.env.REGISTRY_SNAPSHOT_PATH = join(
  mkdtempSync(join(tmpdir(), 'cfai-registry-m365-')), 'registry-snapshot.json',
);

const M365 = 'Microsoft 365 Copilot';

async function withServer(seed, fn) {
  const db = createFakeDb();
  if (seed) await seed(db);
  const app = express();
  app.use(express.json());
  mountRegistry(app, db);
  app.use((err, req, res, next) => res.status(500).json({ error: err.message }));
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    return await fn({
      db,
      async setStatus(id, body) {
        const res = await fetch(`${base}/api/v1/registry/${encodeURIComponent(id)}/status`, {
          method: 'PUT',
          headers: adminJsonHeaders(),
          body: JSON.stringify(body),
        });
        const json = await res.json();
        assert.equal(res.status, 200, `PUT status → ${res.status}: ${JSON.stringify(json)}`);
        return json;
      },
    });
  } finally {
    await new Promise((r) => server.close(r));
  }
}

const hostRow = (db, host) => db._rows('ai_platforms').find((r) => r.host === host);

// ── The list itself ─────────────────────────────────────────────────────────

test('the curated list is exactly the M365 Copilot web surfaces', () => {
  assert.deepEqual(MICROSOFT_WORKSPACE_COPILOT_HOSTS, [
    'cloud.microsoft',
    'm365.cloud.microsoft',
    'office.com',
    'office365.com',
    'microsoft365.com',
    'teams.microsoft.com',
    'outlook.office.com',
    'outlook.office365.com',
    'outlook.live.com',
    'sharepoint.com',
  ]);
});

test('the neighbouring Microsoft products are deliberately NOT covered', () => {
  // Each of these is a different product with its own registry row and its own
  // decision. Sweeping them in would block things the admin did not choose:
  // copilot.microsoft.com is the free consumer assistant, copilotstudio/powerapps/
  // powerva are authoring surfaces rather than the agent being consumed, and
  // crm.dynamics.com is Dynamics Copilot.
  for (const host of [
    'copilot.microsoft.com', 'copilotstudio.microsoft.com', 'powerapps.com',
    'crm.dynamics.com', 'powerva.ms',
  ]) {
    assert.equal(MICROSOFT_WORKSPACE_COPILOT_HOSTS.includes(host), false, `${host} must not be covered`);
  }
});

test('hosts are bare, so dot-suffix matching covers tenant subdomains', () => {
  for (const host of MICROSOFT_WORKSPACE_COPILOT_HOSTS) {
    assert.equal(host, host.toLowerCase().trim());
    assert.equal(/^https?:|\/|^\*|^\./.test(host), false, `${host} is not a bare hostname`);
  }
  // <tenant>.sharepoint.com is covered by the bare entry rather than enumerated.
  assert.ok(MICROSOFT_WORKSPACE_COPILOT_HOSTS.includes('sharepoint.com'));
});

test('the product test is an EXACT match, never a substring — plus its ONE recognized alias', () => {
  assert.equal(isMicrosoftWorkspaceCopilotProduct(M365), true);
  assert.equal(isMicrosoftWorkspaceCopilotProduct('  microsoft 365 copilot  '), true);
  // "Microsoft Copilot" (missing "365") is a DELIBERATE alias, added
  // 2026-09-21: the only live, reachable Inventory toggle for this product
  // today is a discovered endpoint_scan/browser_ai_visit row whose name is
  // this shorter string, and blocking it must reach the same surfaces the
  // longer name does. It widens which LABEL can trigger the cascade, never
  // which hosts get blocked — copilot.microsoft.com stays absent from
  // MICROSOFT_WORKSPACE_COPILOT_HOSTS regardless.
  assert.equal(isMicrosoftWorkspaceCopilotProduct('Microsoft Copilot'), true);
  assert.equal(isMicrosoftWorkspaceCopilotProduct('  MICROSOFT COPILOT  '), true, 'case/padding tolerated like every other name compare here');
  // "Copilot" is in the name of at least six unrelated Microsoft products; a loose
  // match here would widen a product block onto surfaces nobody chose. These
  // five, unlike the alias above, are NOT this product and must stay rejected.
  for (const name of [
    'Copilot', 'Dynamics Copilot', 'Copilot Studio',
    'GitHub Copilot', 'Teams Copilot', 'SharePoint Copilot', 'Power Apps Copilot',
    'Microsoft 365 Copilot Chat', 'Microsoft 365', '', null, undefined, {},
  ]) {
    assert.equal(isMicrosoftWorkspaceCopilotProduct(name), false, JSON.stringify(name) ?? 'undefined');
  }
});

// ── The toggle ──────────────────────────────────────────────────────────────

test('blocking the M365 Copilot product blocks all ten hosts, creating the missing rows', async () => {
  await withServer(async (db) => {
    // Only two of the ten exist up front — the realistic state, and the reason a
    // toggle that merely patched existing rows enforced almost nowhere.
    await db.collection('ai_platforms').insertOne({ host: 'office.com', vendor: 'Microsoft', product: M365, surface: 'browser', blocked: 0 });
    await db.collection('ai_platforms').insertOne({ host: 'sharepoint.com', vendor: 'Microsoft', product: 'SharePoint Copilot', surface: 'browser', blocked: 0 });
  }, async ({ db, setStatus }) => {
    const body = await setStatus('office.com', { status: 'blocked', product_name: M365 });

    for (const host of MICROSOFT_WORKSPACE_COPILOT_HOSTS) {
      const row = hostRow(db, host);
      assert.ok(row, `${host} has no ai_platforms row — the extension cannot enforce a host it never receives`);
      assert.equal(row.blocked, 1, `${host} was not blocked`);
      // The extension fetches ?surface=browser, which selects surface browser|all.
      // A row on any other surface is invisible to it, i.e. blocked in the UI and
      // enforced nowhere — the failure this whole route keeps running into.
      assert.ok(['browser', 'all'].includes(row.surface), `${host} is invisible to the extension (surface: ${row.surface})`);
    }
    assert.ok(body.enforced, 'the product block reported enforcing nothing');
    assert.ok(body.enforced_via.includes('m365_workspace_hosts'), 'enforced_via does not name the curated host set');
  });
});

test('blocking the DISCOVERED "Microsoft Copilot" endpoint-scan row cascades too, using the exact body the real Inventory toggle sends', async () => {
  // Reproduced from a real session, 2026-09-21: the only Inventory row a real
  // admin could actually find and click for this product is a discovered
  // endpoint_scan/browser_ai_visit entry (id "microsoft:microsoft-copilot"),
  // not a platform/host row — it has no matched_hosts and its own PUT never
  // even enforces its own host. setRowStatus() (AIHubPage.jsx) sends this
  // exact body shape when that toggle is clicked; nothing here is synthetic.
  await withServer(null, async ({ setStatus }) => {
    const body = await setStatus('microsoft:microsoft-copilot', {
      status: 'blocked',
      product_name: 'Microsoft Copilot',
      matched_hosts: [],
      category: 'web-service',
      source: 'endpoint_scan',
      platform: null,
    });
    assert.ok(body.enforced_via.includes('m365_workspace_hosts'),
      'the discovered row\'s own toggle must reach the SAME cascade the platform-row toggle does');
  });
});

test('unblocking clears the same ten hosts', async () => {
  await withServer(null, async ({ db, setStatus }) => {
    await setStatus('office.com', { status: 'blocked', product_name: M365 });
    await setStatus('office.com', { status: 'approved', product_name: M365 });

    for (const host of MICROSOFT_WORKSPACE_COPILOT_HOSTS) {
      const row = hostRow(db, host);
      // blocked:0 rather than a deleted row — same convention as PATCH
      // /api/v1/ai-platforms/:host and the agent blocklist's unblock, so the
      // decision stays visible instead of vanishing.
      assert.ok(row, `${host} was deleted rather than unblocked`);
      assert.equal(row.blocked, 0, `${host} stayed blocked after the product was approved`);
    }
  });
});

test('a created row carries real product identity, and an existing row keeps its own', async () => {
  await withServer(async (db) => {
    await db.collection('ai_platforms').insertOne({
      host: 'sharepoint.com', vendor: 'Microsoft', product: 'SharePoint Copilot',
      category: 'ide-assistant', surface: 'browser', blocked: 0,
    });
  }, async ({ db, setStatus }) => {
    await setStatus('office.com', { status: 'blocked', product_name: M365 });

    const created = hostRow(db, 'teams.microsoft.com');
    assert.equal(created.product, M365);
    assert.equal(created.vendor, 'Microsoft');
    assert.equal(created.governed, 1);

    // sharepoint.com legitimately belongs to a differently-named product row.
    // The toggle needs to read that identity, not overwrite it.
    const existing = hostRow(db, 'sharepoint.com');
    assert.equal(existing.product, 'SharePoint Copilot', 'an existing row had its identity rewritten');
    assert.equal(existing.blocked, 1, 'and it still has to be blocked');
  });
});

test('a host-only caller still resolves the product from its ai_platforms row', async () => {
  // A caller that knows the host but sends no product_name (scripts, older UI
  // builds) must reach the same coverage — the product identity is on the row.
  await withServer(async (db) => {
    await db.collection('ai_platforms').insertOne({ host: 'office.com', vendor: 'Microsoft', product: M365, surface: 'browser', blocked: 0 });
  }, async ({ db, setStatus }) => {
    await setStatus('office.com', { status: 'blocked' });
    assert.equal(hostRow(db, 'teams.microsoft.com')?.blocked, 1,
      'the product went unrecognised, so the curated hosts were never touched');
  });
});

// ── Scope: this fan-out belongs to ONE product identity ─────────────────────

test('blocking an unrelated product touches none of the ten hosts', async () => {
  await withServer(async (db) => {
    await db.collection('ai_platforms').insertOne({ host: 'poe.com', product: 'Poe', surface: 'browser', blocked: 0 });
    for (const host of MICROSOFT_WORKSPACE_COPILOT_HOSTS) {
      await db.collection('ai_platforms').insertOne({ host, product: M365, surface: 'browser', blocked: 0 });
    }
  }, async ({ db, setStatus }) => {
    await setStatus('poe.com', { status: 'blocked', product_name: 'Poe', matched_hosts: ['poe.com'] });

    assert.equal(hostRow(db, 'poe.com').blocked, 1, 'the product the admin actually blocked was missed');
    for (const host of MICROSOFT_WORKSPACE_COPILOT_HOSTS) {
      assert.equal(hostRow(db, host).blocked, 0, `${host} was blocked by an unrelated product decision`);
    }
  });
});

test('a Microsoft product with a similar name does not reach the M365 hosts', async () => {
  await withServer(async (db) => {
    await db.collection('ai_platforms').insertOne({ host: 'crm.dynamics.com', product: 'Dynamics Copilot', surface: 'browser', blocked: 0 });
    for (const host of MICROSOFT_WORKSPACE_COPILOT_HOSTS) {
      await db.collection('ai_platforms').insertOne({ host, product: M365, surface: 'browser', blocked: 0 });
    }
  }, async ({ db, setStatus }) => {
    await setStatus('crm.dynamics.com', { status: 'blocked', product_name: 'Dynamics Copilot', matched_hosts: ['crm.dynamics.com'] });
    for (const host of MICROSOFT_WORKSPACE_COPILOT_HOSTS) {
      assert.equal(hostRow(db, host).blocked, 0, `${host} was blocked by a Dynamics Copilot decision`);
    }
  });
});

test('blocking a named AGENT that lives in M365 Copilot does not fan out to any host', async () => {
  // The original over-blocking bug, in its exact shape: an individual agent is
  // enforced by NAME through blocked_agents and has no host of its own. A product
  // toggle is a materially bigger action and must stay the admin's explicit choice.
  await withServer(async (db) => {
    await db.collection('discovered_agents').insertOne({
      id: 'agent-1', name: 'Enterprise Agent', platform: 'personal_agent',
      product: M365, lifecycleStatus: 'active',
      matched_hosts: MICROSOFT_WORKSPACE_COPILOT_HOSTS,
    });
    for (const host of MICROSOFT_WORKSPACE_COPILOT_HOSTS) {
      await db.collection('ai_platforms').insertOne({ host, product: M365, surface: 'browser', blocked: 0 });
    }
  }, async ({ db, setStatus }) => {
    const body = await setStatus('agent-1', {
      status: 'blocked', product_name: 'Enterprise Agent',
      category: 'autonomous-agent', source: 'governance',
      matched_hosts: MICROSOFT_WORKSPACE_COPILOT_HOSTS,
    });
    for (const host of MICROSOFT_WORKSPACE_COPILOT_HOSTS) {
      assert.equal(hostRow(db, host).blocked, 0, `${host} was blocked by an individual agent decision`);
    }
    assert.deepEqual(body.enforced_via, ['agent_blocklist']);
  });
});

test('even naming the product on an agent row does not fan out', async () => {
  // product_name === "Microsoft 365 Copilot" while the row is an agent: the agent
  // gate wins, because the narrow mechanism is what was asked for.
  await withServer(async (db) => {
    await db.collection('discovered_agents').insertOne({ id: 'agent-2', name: M365, platform: 'personal_agent', lifecycleStatus: 'active' });
    for (const host of MICROSOFT_WORKSPACE_COPILOT_HOSTS) {
      await db.collection('ai_platforms').insertOne({ host, product: M365, surface: 'browser', blocked: 0 });
    }
  }, async ({ db, setStatus }) => {
    await setStatus('agent-2', { status: 'blocked', product_name: M365, category: 'autonomous-agent' });
    for (const host of MICROSOFT_WORKSPACE_COPILOT_HOSTS) {
      assert.equal(hostRow(db, host).blocked, 0, `${host} was blocked by an agent-scoped decision`);
    }
  });
});

test('coverage comes from the curated list, never from discovery data', async () => {
  // The removed bug, guarded from the other direction: a host that discovery
  // associates with M365 Copilot but the curated list excludes stays untouched.
  await withServer(async (db) => {
    await db.collection('ai_platforms').insertOne({ host: 'copilot.microsoft.com', product: 'Microsoft Copilot', surface: 'browser', blocked: 0 });
    await db.collection('ai_platforms').insertOne({ host: 'office.com', product: M365, surface: 'browser', blocked: 0 });
    // Discovery associates a much broader host set with this product — the data
    // the removed bug used to read coverage from.
    await db.collection('discovered_agents').insertOne({
      id: 'discovered-m365', name: 'M365 Copilot (discovered)', product: M365,
      matched_hosts: ['office.com', 'copilot.microsoft.com', 'powerapps.com'],
    });
  }, async ({ db, setStatus }) => {
    await setStatus('office.com', { status: 'blocked', product_name: M365 });
    assert.equal(hostRow(db, 'office.com').blocked, 1);
    assert.equal(hostRow(db, 'copilot.microsoft.com').blocked, 0,
      'the free consumer Copilot was blocked from a discovery association');
    assert.equal(hostRow(db, 'powerapps.com'), undefined,
      'an authoring surface was created and blocked from discovery data');
  });
});

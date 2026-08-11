// Connections — org-level OAuth integrations for Slack, Teams, Jira, etc.
//
// Each connection stores credentials in the `integrations` collection (separate
// from governance oauth_keys). Once connected, the server can:
//   - List channels/groups/projects from the connected tool
//   - Post messages directly (no webhook URL needed from the user)
//
// Supported:
//   slack  — Bot Token → list channels → post via chat.postMessage
//   teams  — App credentials (client_id, secret, tenant) → Graph API → list teams/channels → post

import crypto from 'node:crypto';
import { a } from '../util.js';
import { createZip } from '../lib/zip.js';
import { createRequire } from 'node:module';
import { writeFileSync, readFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';

export function mountConnections(app, db) {
  const integrations = () => db.collection('integrations');

  // ── List all connections with status ──

  app.get('/api/v1/connections', a(async (req, res) => {
    const rows = await integrations().find({}).project({ _id: 0 }).toArray();
    const byType = new Map(rows.map(r => [r.type, r]));

    const SUPPORTED = [
      { type: 'slack', name: 'Slack', icon: '💬', description: 'Post alerts to any Slack channel' },
      { type: 'teams', name: 'Microsoft Teams', icon: '🏢', description: 'Post alerts to any Teams channel' },
    ];

    const result = SUPPORTED.map(s => {
      const conn = byType.get(s.type);
      return {
        ...s,
        status: conn ? 'configured' : 'not_configured',
        configured_at: conn?.configured_at || null,
      };
    });

    res.json(result);
  }));

  // ── Configure a connection ──

  app.post('/api/v1/connections/:type', a(async (req, res) => {
    const type = req.params.type;

    if (type === 'slack') {
      const { bot_token } = req.body ?? {};
      if (!bot_token) return res.status(400).json({ error: 'bot_token is required' });
      // Verify the token works
      try {
        const r = await fetch('https://slack.com/api/auth.test', {
          headers: { 'Authorization': 'Bearer ' + bot_token },
        });
        const data = await r.json();
        if (!data.ok) return res.status(400).json({ error: 'Invalid Slack token: ' + (data.error || 'unknown') });

        await integrations().updateOne(
          { type: 'slack' },
          { $set: { type: 'slack', bot_token, team_name: data.team, team_id: data.team_id, configured_at: new Date() } },
          { upsert: true },
        );
        res.json({ ok: true, team: data.team });
      } catch (e) {
        res.status(400).json({ error: 'Failed to verify token: ' + e.message });
      }

    } else if (type === 'teams') {
      const { client_id, client_secret, tenant_id } = req.body ?? {};
      if (!client_id || !client_secret || !tenant_id) {
        return res.status(400).json({ error: 'client_id, client_secret, and tenant_id are required' });
      }
      try {
        // Step 1: Verify credentials
        const tokenRes = await fetch(`https://login.microsoftonline.com/${tenant_id}/oauth2/v2.0/token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ grant_type: 'client_credentials', client_id, client_secret, scope: 'https://graph.microsoft.com/.default' }),
        });
        const tokenData = await tokenRes.json();
        if (!tokenData.access_token) {
          return res.status(400).json({ error: 'Failed to get token: ' + (tokenData.error_description || tokenData.error || 'unknown') });
        }

        // Step 2: Check if bot app already exists in catalog (user may have uploaded manually)
        let teamsAppId = null;
        try {
          const catRes = await fetch(
            `https://graph.microsoft.com/v1.0/appCatalogs/teamsApps?$filter=externalId eq '${client_id}'&$select=id`,
            { headers: { 'Authorization': 'Bearer ' + tokenData.access_token } },
          );
          const catData = await catRes.json();
          teamsAppId = catData.value?.[0]?.id || null;
        } catch {}

        if (teamsAppId) {
          // Already in catalog — no upload needed
        } else {
          // Step 3: Generate manifest and try to upload
          const manifest = generateTeamsManifest(client_id);
          const zipBuffer = buildManifestZip(manifest);
          try {
            const uploadRes = await fetch(
              'https://graph.microsoft.com/v1.0/appCatalogs/teamsApps?requiresReview=false',
              { method: 'POST', headers: { 'Authorization': 'Bearer ' + tokenData.access_token, 'Content-Type': 'application/zip' }, body: zipBuffer },
            );
            if (uploadRes.ok || uploadRes.status === 201) {
              const uploadData = await uploadRes.json().catch(() => ({}));
              teamsAppId = uploadData.id;
            }
          } catch {}

          // Search again in case upload succeeded but didn't return the id
          if (!teamsAppId) {
            try {
              const catRes2 = await fetch(
                `https://graph.microsoft.com/v1.0/appCatalogs/teamsApps?$filter=externalId eq '${client_id}'&$select=id`,
                { headers: { 'Authorization': 'Bearer ' + tokenData.access_token } },
              );
              const catData2 = await catRes2.json();
              teamsAppId = catData2.value?.[0]?.id || null;
            } catch {}
          }
        }

        // Step 4: Save credentials + catalog app ID
        await integrations().updateOne(
          { type: 'teams' },
          { $set: { type: 'teams', client_id, client_secret, tenant_id, teams_app_id: teamsAppId, configured_at: new Date() } },
          { upsert: true },
        );

        if (teamsAppId) {
          res.json({ ok: true, catalog_published: true });
        } else {
          // Configuration succeeded but catalog upload failed — still connected, just needs manual upload
          res.json({
            ok: true,
            catalog_published: false,
            manual_upload_needed: true,
            message: 'Connected successfully but could not auto-publish bot to Teams app catalog. Your org policy may block API-based app uploads. Download the manifest and upload it manually via Teams Admin Center.',
          });
        }
      } catch (e) {
        res.status(400).json({ error: 'Failed to configure Teams: ' + e.message });
      }

    } else {
      res.status(400).json({ error: 'Unsupported connection type: ' + type });
    }
  }));

  // ── Download Teams manifest zip (for manual upload) ──

  app.get('/api/v1/connections/teams/manifest', a(async (req, res) => {
    const conn = await integrations().findOne({ type: 'teams' });
    if (!conn) return res.status(404).json({ error: 'Teams not connected' });
    const manifest = generateTeamsManifest(conn.client_id);
    const zipBuffer = buildManifestZip(manifest);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="CloudFuze-Alerts-Bot.zip"');
    res.send(zipBuffer);
  }));

  // ── Disconnect ──

  app.delete('/api/v1/connections/:type', a(async (req, res) => {
    await integrations().deleteOne({ type: req.params.type });
    res.json({ ok: true });
  }));

  // ── List channels (Slack or Teams) ──

  app.get('/api/v1/connections/:type/channels', a(async (req, res) => {
    const type = req.params.type;
    const conn = await integrations().findOne({ type });
    if (!conn) return res.status(404).json({ error: type + ' is not connected' });

    if (type === 'slack') {
      try {
        // Paginate to get ALL channels
        const allChannels = [];
        let cursor = '';
        do {
          const url = 'https://slack.com/api/conversations.list?types=public_channel,private_channel&limit=200' + (cursor ? '&cursor=' + cursor : '');
          const r = await fetch(url, { headers: { 'Authorization': 'Bearer ' + conn.bot_token } });
          const data = await r.json();
          if (!data.ok) return res.status(400).json({ error: 'Slack API: ' + data.error });
          allChannels.push(...(data.channels || []));
          cursor = data.response_metadata?.next_cursor || '';
        } while (cursor);

        const channels = allChannels.map(c => ({
          id: c.id, name: '#' + c.name, is_private: c.is_private,
        })).sort((a, b) => a.name.localeCompare(b.name));
        res.json({ type: 'flat', channels });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }

    } else if (type === 'teams') {
      try {
        const token = await getTeamsToken(conn);
        // List all teams — paginate to get all
        let teamsUrl = 'https://graph.microsoft.com/v1.0/groups?$filter=resourceProvisioningOptions/Any(x:x eq \'Team\')&$select=id,displayName&$top=100';
        const allTeams = [];
        while (teamsUrl) {
          const teamsRes = await fetch(teamsUrl, { headers: { 'Authorization': 'Bearer ' + token } });
          const teamsData = await teamsRes.json();
          allTeams.push(...(teamsData.value || []));
          teamsUrl = teamsData['@odata.nextLink'] || null;
          // No cap — fetch all teams. Search box handles filtering on the UI side.
        }
        // Return just teams list — channels loaded on demand per team
        const teams = allTeams
          .sort((a, b) => (a.displayName || '').localeCompare(b.displayName || ''))
          .map(t => ({ team_id: t.id, team_name: t.displayName }));
        res.json({ type: 'hierarchical', teams });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }

    } else {
      res.status(400).json({ error: 'Unsupported type' });
    }
  }));

  // ── Get channels for a specific team (lazy load) ──

  app.get('/api/v1/connections/teams/team/:teamId/channels', a(async (req, res) => {
    const conn = await integrations().findOne({ type: 'teams' });
    if (!conn) return res.status(404).json({ error: 'Teams not connected' });
    try {
      const token = await getTeamsToken(conn);
      const chRes = await fetch(`https://graph.microsoft.com/v1.0/teams/${req.params.teamId}/channels?$select=id,displayName`, {
        headers: { 'Authorization': 'Bearer ' + token },
      });
      const chData = await chRes.json();
      const channels = (chData.value || [])
        .sort((a, b) => (a.displayName || '').localeCompare(b.displayName || ''))
        .map(ch => ({ id: req.params.teamId + '|' + ch.id, name: ch.displayName }));
      res.json(channels);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  }));

  // ── Post a message (used by webhook fire) ──

  app.post('/api/v1/connections/:type/post', a(async (req, res) => {
    const { channel_id, text, title, severity } = req.body ?? {};
    if (!channel_id || !text) return res.status(400).json({ error: 'channel_id and text required' });

    const type = req.params.type;
    const conn = await integrations().findOne({ type });
    if (!conn) return res.status(404).json({ error: type + ' is not connected' });

    try {
      if (type === 'slack') {
        // Auto-join the channel first (idempotent — no-op if already in)
        await fetch('https://slack.com/api/conversations.join', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + conn.bot_token, 'Content-Type': 'application/json' },
          body: JSON.stringify({ channel: channel_id }),
        });
        const r = await fetch('https://slack.com/api/chat.postMessage', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + conn.bot_token, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            channel: channel_id,
            text: title ? '*' + title + '*\n' + text : text,
          }),
        });
        const data = await r.json();
        if (!data.ok) return res.status(400).json({ error: 'Slack: ' + data.error });
        res.json({ ok: true });

      } else if (type === 'teams') {
        const result = await postToTeamsChannel(conn, channel_id, title || 'CloudFuze Alert', text);
        if (result.ok) res.json({ ok: true });
        else res.status(400).json({ error: result.error });
      }
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  }));
}

// Post to a Teams channel via Bot Framework proactive messaging
export async function postToTeamsChannel(conn, channelId, title, text) {
  try {
    const [teamId, teamsChannelId] = channelId.split('|');

    // Step 1: Auto-install bot in the team (idempotent — no-op if already installed)
    await installBotInTeam(conn, teamId).catch(() => {});

    // Step 2: Get bot token from Bot Framework
    const botToken = await getBotFrameworkToken(conn);

    // Step 3: Create conversation in the channel
    const serviceUrl = 'https://smba.trafficmanager.net/amer/';
    const convRes = await fetch(serviceUrl + 'v3/conversations', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + botToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bot: { id: conn.client_id },
        isGroup: true,
        channelData: { channel: { id: teamsChannelId } },
        activity: {
          type: 'message',
          text: '**' + title + '**\n\n' + text,
        },
      }),
    });

    if (convRes.ok) return { ok: true };

    // If the above fails, try posting directly to the channel conversation
    const directRes = await fetch(serviceUrl + 'v3/conversations/' + teamsChannelId + '/activities', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + botToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'message',
        text: '<b>' + title + '</b><br/>' + text.replace(/\n/g, '<br/>'),
        textFormat: 'html',
      }),
    });

    if (directRes.ok) return { ok: true };
    const errText = await directRes.text().catch(() => '');
    return { error: 'Teams Bot API ' + directRes.status + ': ' + errText.slice(0, 200) };
  } catch (e) {
    return { error: e.message };
  }
}

// Auto-install bot app in a team via Graph API (idempotent)
async function installBotInTeam(conn, teamId) {
  const graphToken = await getTeamsToken(conn);

  // Use the stored teamsAppId if available, otherwise try to find it
  let teamsAppId = conn.teams_app_id;

  if (!teamsAppId) {
    // Try to find our app in the catalog by externalId (bot's client_id)
    try {
      const catalogRes = await fetch(
        `https://graph.microsoft.com/v1.0/appCatalogs/teamsApps?$filter=externalId eq '${conn.client_id}'&$select=id`,
        { headers: { 'Authorization': 'Bearer ' + graphToken } },
      );
      const catalogData = await catalogRes.json();
      teamsAppId = catalogData.value?.[0]?.id;
    } catch {}
  }

  if (!teamsAppId) return; // Can't auto-install without the catalog ID

  // Install the app in the team (201 = installed, 409 = already installed)
  const installRes = await fetch(
    `https://graph.microsoft.com/v1.0/teams/${teamId}/installedApps`,
    {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + graphToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ 'teamsApp@odata.bind': `https://graph.microsoft.com/v1.0/appCatalogs/teamsApps/${teamsAppId}` }),
    },
  );
  if (installRes.status === 201 || installRes.status === 409) return;
}

// Get Bot Framework token (different from Graph token)
async function getBotFrameworkToken(conn) {
  const res = await fetch(`https://login.microsoftonline.com/${conn.tenant_id}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: conn.client_id,
      client_secret: conn.client_secret,
      scope: 'https://api.botframework.com/.default',
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('Bot token failed: ' + (data.error_description || data.error));
  return data.access_token;
}

// Helper: get Graph API token (for listing teams/channels)
async function getTeamsToken(conn) {
  const res = await fetch(`https://login.microsoftonline.com/${conn.tenant_id}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: conn.client_id,
      client_secret: conn.client_secret,
      scope: 'https://graph.microsoft.com/.default',
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('Token failed: ' + (data.error_description || data.error));
  return data.access_token;
}

// Generate a Teams app manifest JSON for the bot
function generateTeamsManifest(clientId) {
  return {
    '$schema': 'https://developer.microsoft.com/en-us/json-schemas/teams/v1.16/MicrosoftTeams.schema.json',
    manifestVersion: '1.16',
    version: '1.0.0',
    id: clientId,
    developer: { name: 'CloudFuze', websiteUrl: 'https://cloudfuze.com', privacyUrl: 'https://cloudfuze.com/privacy', termsOfUseUrl: 'https://cloudfuze.com/terms' },
    name: { short: 'CloudFuze Alerts', full: 'CloudFuze AI Governance Alerts' },
    description: { short: 'AI governance alerts', full: 'Receive AI governance alerts — DLP violations, risk score changes, access requests — directly in Teams.' },
    icons: { color: 'color.png', outline: 'outline.png' },
    accentColor: '#0044CC',
    bots: [{ botId: clientId, scopes: ['team', 'groupChat'], supportsFiles: false, isNotificationOnly: true }],
    permissions: ['identity', 'messageTeamMembers'],
    validDomains: [],
  };
}

// Build a minimal valid zip containing manifest.json + placeholder icons
function buildManifestZip(manifest) {
  // Use a minimal zip builder — no external dependencies
  const manifestJson = JSON.stringify(manifest, null, 2);
  const manifestBuf = Buffer.from(manifestJson, 'utf8');

  // Minimal 1x1 PNG (192x192 required but Teams accepts small PNGs for dev/testing)
  const colorPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPj/HwADBwIAMCbHYQAAAABJRU5ErkJggg==', 'base64');
  const outlinePng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/58BAwoDBwIRGBoAAAAASUVORK5CYII=', 'base64');

  // Build ZIP manually (no dependency needed for 3 small files)
  return createZip([
    { name: 'manifest.json', data: manifestBuf },
    { name: 'color.png', data: colorPng },
    { name: 'outline.png', data: outlinePng },
  ]);
}

// The ZIP writer this used to define inline now lives in ../lib/zip.js — the same
// implementation was duplicated verbatim in routes/installations.js. Imported at
// the top of this file.

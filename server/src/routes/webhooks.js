// GRC & Identity Integration Layer — generic webhook system.
//
// Admins configure webhook destinations with triggers. When an event matches,
// CloudFuze POSTs a JSON payload to the URL. Pre-built templates format the
// payload for Slack, Teams, Jira, ServiceNow — or send raw JSON for custom.

import crypto from 'node:crypto';
import { a } from '../util.js';

const VALID_TRIGGERS = ['dlp_critical', 'risk_score_high', 'access_request', 'tool_blocked', 'tool_approved'];

const TEMPLATES = {
  slack: {
    name: 'Slack',
    hint: 'Paste your Slack Incoming Webhook URL',
    urlPlaceholder: 'https://hooks.slack.com/services/T.../B.../xxx',
    format: (event) => ({
      text: `*CloudFuze AI Governance*\n${event.title}`,
      blocks: [
        { type: 'header', text: { type: 'plain_text', text: '⚠️ ' + event.title } },
        { type: 'section', text: { type: 'mrkdwn', text: event.body } },
        ...(event.link ? [{ type: 'section', text: { type: 'mrkdwn', text: `<${event.link}|View in CloudFuze>` } }] : []),
      ],
    }),
  },
  teams: {
    name: 'Microsoft Teams',
    hint: 'Paste your Teams Incoming Webhook URL',
    urlPlaceholder: 'https://xxx.webhook.office.com/webhookb2/...',
    format: (event) => ({
      '@type': 'MessageCard', '@context': 'http://schema.org/extensions',
      themeColor: event.severity === 'critical' ? 'FF0000' : event.severity === 'high' ? 'FF8C00' : '0044CC',
      summary: event.title,
      sections: [{
        activityTitle: '⚠️ ' + event.title,
        facts: [
          { name: 'Severity', value: event.severity || 'info' },
          { name: 'Employee', value: event.employee || '—' },
          { name: 'Tool', value: event.tool || '—' },
          { name: 'Time', value: new Date().toISOString() },
        ],
        text: event.body,
      }],
      potentialAction: event.link ? [{ '@type': 'OpenUri', name: 'View in CloudFuze', targets: [{ os: 'default', uri: event.link }] }] : [],
    }),
  },
  jira: {
    name: 'Jira',
    hint: 'Jira REST API endpoint',
    urlPlaceholder: 'https://company.atlassian.net/rest/api/3/issue',
    format: (event) => ({
      fields: {
        project: { key: event.jira_project || 'SEC' },
        summary: '[CloudFuze] ' + event.title,
        description: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: event.body }] }] },
        issuetype: { name: 'Task' },
        priority: { name: event.severity === 'critical' ? 'Highest' : event.severity === 'high' ? 'High' : 'Medium' },
      },
    }),
  },
  servicenow: {
    name: 'ServiceNow',
    hint: 'ServiceNow Incident Table API',
    urlPlaceholder: 'https://company.service-now.com/api/now/table/incident',
    format: (event) => ({
      short_description: '[CloudFuze] ' + event.title,
      description: event.body,
      urgency: event.severity === 'critical' ? '1' : event.severity === 'high' ? '2' : '3',
      impact: event.severity === 'critical' ? '1' : '2',
      category: 'AI Governance',
      caller_id: event.employee || '',
    }),
  },
  custom: {
    name: 'Custom Webhook',
    hint: 'Any URL that accepts POST JSON',
    urlPlaceholder: 'https://your-api.com/webhook',
    format: (event) => event,
  },
};

export async function fireWebhooks(db, trigger, eventData) {
  const hooks = await db.collection('webhooks')
    .find({ enabled: true, triggers: trigger }).project({ _id: 0 }).toArray();

  for (const hook of hooks) {
    // Direct connection mode: post via connected integration (Slack API / Graph API)
    if (hook.connection_type && hook.channel_id) {
      postViaConnection(db, hook, trigger, eventData).catch(() => {});
      continue;
    }

    // Legacy webhook URL mode
    const template = TEMPLATES[hook.template] || TEMPLATES.custom;
    const payload = template.format(eventData);
    const headers = { 'Content-Type': 'application/json' };
    if (hook.auth_header) {
      const [key, ...val] = hook.auth_header.split(':');
      headers[key.trim()] = val.join(':').trim();
    }
    fetch(hook.url, { method: 'POST', headers, body: JSON.stringify(payload), signal: AbortSignal.timeout(10000) })
      .then(async (res) => {
        await db.collection('webhook_log').insertOne({
          webhook_id: hook.id, webhook_name: hook.name, trigger,
          status: res.ok ? 'delivered' : 'failed', http_status: res.status, timestamp: new Date(),
        });
      }).catch(async (err) => {
        await db.collection('webhook_log').insertOne({
          webhook_id: hook.id, webhook_name: hook.name, trigger,
          status: 'error', error: err.message, timestamp: new Date(),
        });
      });
  }
}

// Post via direct connection (Slack Bot API / Teams Graph API)
async function postViaConnection(db, hook, trigger, eventData) {
  const conn = await db.collection('integrations').findOne({ type: hook.connection_type });
  if (!conn) {
    const err = hook.connection_type + ' not connected';
    await db.collection('webhook_log').insertOne({ webhook_id: hook.id, webhook_name: hook.name, trigger, status: 'error', error: err, timestamp: new Date() });
    return { error: err };
  }
  try {
    const text = eventData.body || eventData.title || 'CloudFuze Alert';
    const title = eventData.title || 'CloudFuze AI Governance';

    if (hook.connection_type === 'slack') {
      const r = await fetch('https://slack.com/api/chat.postMessage', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + conn.bot_token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel: hook.channel_id, text: '*' + title + '*\n' + text }),
      });
      const data = await r.json();
      await db.collection('webhook_log').insertOne({ webhook_id: hook.id, webhook_name: hook.name, trigger, status: data.ok ? 'delivered' : 'failed', error: data.ok ? null : data.error, timestamp: new Date() });
      return data.ok ? { ok: true } : { error: 'Slack: ' + data.error };

    } else if (hook.connection_type === 'teams') {
      // Use Bot Framework API for posting
      const botTokenRes = await fetch(`https://login.microsoftonline.com/${conn.tenant_id}/oauth2/v2.0/token`, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'client_credentials', client_id: conn.client_id, client_secret: conn.client_secret, scope: 'https://api.botframework.com/.default' }),
      });
      const botTokenData = await botTokenRes.json();
      if (!botTokenData.access_token) return { error: 'Bot token failed: ' + (botTokenData.error_description || botTokenData.error) };

      const [teamId, channelId] = hook.channel_id.split('|');
      const serviceUrl = 'https://smba.trafficmanager.net/amer/';

      // Try creating a conversation with an activity
      const r = await fetch(serviceUrl + 'v3/conversations', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + botTokenData.access_token, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bot: { id: conn.client_id },
          isGroup: true,
          channelData: { channel: { id: channelId } },
          activity: { type: 'message', text: '**' + title + '**\n\n' + text },
        }),
      });

      const status = r.status;
      const respText = await r.text().catch(() => '');
      let finalOk = r.ok;

      // Fallback: post directly to channel conversation
      if (!finalOk) {
        const r2 = await fetch(serviceUrl + 'v3/conversations/' + channelId + '/activities', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + botTokenData.access_token, 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'message', text: '**' + title + '**\n\n' + text }),
        });
        finalOk = r2.ok;
      }

      await db.collection('webhook_log').insertOne({ webhook_id: hook.id, webhook_name: hook.name, trigger, status: finalOk ? 'delivered' : 'failed', http_status: status, error: finalOk ? null : respText.slice(0, 200), timestamp: new Date() });
      if (finalOk) return { ok: true };
      if (respText.includes('Forbidden') || respText.includes('403')) return { error: '403 Forbidden. Make sure the CloudFuze Alerts bot is added to the target team in Microsoft Teams.' };
      return { error: status + ' ' + respText.slice(0, 200) };
    }
    return { ok: true };
  } catch (e) {
    await db.collection('webhook_log').insertOne({ webhook_id: hook.id, webhook_name: hook.name, trigger, status: 'error', error: e.message, timestamp: new Date() });
    return { error: e.message };
  }
}

export function mountWebhooks(app, db) {
  const webhooks = () => db.collection('webhooks');
  const wlog = () => db.collection('webhook_log');

  app.get('/api/v1/webhooks/templates', a(async (req, res) => {
    const out = {};
    for (const [key, t] of Object.entries(TEMPLATES)) {
      out[key] = { name: t.name, hint: t.hint, urlPlaceholder: t.urlPlaceholder };
    }
    res.json({ templates: out, triggers: VALID_TRIGGERS });
  }));

  app.get('/api/v1/webhooks', a(async (req, res) => {
    res.json(await webhooks().find({}).sort({ created_at: -1 }).project({ _id: 0 }).toArray());
  }));

  app.post('/api/v1/webhooks', a(async (req, res) => {
    const { name, url, template, triggers, auth_header, connection_type, channel_id, enabled = true } = req.body ?? {};
    if (!name) return res.status(400).json({ error: 'name required' });
    if (!connection_type && !url) return res.status(400).json({ error: 'url or connection_type required' });
    const hook = {
      id: crypto.randomUUID(), name, url: url || null, template: template || 'custom',
      triggers: triggers || [], auth_header: auth_header || null,
      connection_type: connection_type || null, channel_id: channel_id || null,
      enabled: !!enabled, created_at: new Date(), updated_at: new Date(),
    };
    await webhooks().insertOne(hook);
    res.status(201).json({ ok: true, id: hook.id });
  }));

  app.put('/api/v1/webhooks/:id', a(async (req, res) => {
    const { name, url, template, triggers, auth_header, connection_type, channel_id, enabled } = req.body ?? {};
    const update = { updated_at: new Date() };
    if (name !== undefined) update.name = name;
    if (url !== undefined) update.url = url;
    if (template !== undefined) update.template = template;
    if (triggers !== undefined) update.triggers = triggers;
    if (auth_header !== undefined) update.auth_header = auth_header;
    if (connection_type !== undefined) update.connection_type = connection_type;
    if (channel_id !== undefined) update.channel_id = channel_id;
    if (enabled !== undefined) update.enabled = !!enabled;
    const r = await webhooks().updateOne({ id: req.params.id }, { $set: update });
    if (r.matchedCount === 0) return res.status(404).json({ error: 'not found' });
    res.json({ ok: true });
  }));

  app.delete('/api/v1/webhooks/:id', a(async (req, res) => {
    await webhooks().deleteOne({ id: req.params.id });
    res.json({ ok: true });
  }));

  app.post('/api/v1/webhooks/:id/test', a(async (req, res) => {
    const hook = await webhooks().findOne({ id: req.params.id }, { projection: { _id: 0 } });
    if (!hook) return res.status(404).json({ error: 'not found' });
    const testEvent = {
      title: 'Test notification from CloudFuze', severity: 'info',
      body: 'This is a test webhook delivery. If you see this, the integration is working correctly.',
      employee: 'Test User', tool: 'CloudFuze Test', trigger: 'test', link: null,
    };

    // Direct connection mode — post via Slack API / Graph API
    if (hook.connection_type && hook.channel_id) {
      const result = await postViaConnection(db, hook, 'test', testEvent);
      if (result?.error) {
        const msg = result.error;
        if (msg.includes('403') || msg.includes('Forbidden') || msg.includes('Missing role')) {
          const perms = hook.connection_type === 'teams' ? 'ChannelMessage.Send' : 'chat:write';
          res.json({ ok: false, error: 'Permission denied. Add "' + perms + '" permission in ' + (hook.connection_type === 'teams' ? 'Azure Portal → App registrations → API permissions → Grant admin consent' : 'Slack App → OAuth & Permissions') });
        } else if (msg.includes('not connected')) {
          res.json({ ok: false, error: hook.connection_type + ' is not connected. Go to Connections tab and configure it.' });
        } else {
          res.json({ ok: false, error: msg });
        }
      } else {
        res.json({ ok: true });
      }
      return;
    }

    // Legacy webhook URL mode
    const template = TEMPLATES[hook.template] || TEMPLATES.custom;
    const payload = template.format(testEvent);
    const headers = { 'Content-Type': 'application/json' };
    if (hook.auth_header) { const [k, ...v] = hook.auth_header.split(':'); headers[k.trim()] = v.join(':').trim(); }
    try {
      const resp = await fetch(hook.url, { method: 'POST', headers, body: JSON.stringify(payload), signal: AbortSignal.timeout(10000) });
      await wlog().insertOne({ webhook_id: hook.id, webhook_name: hook.name, trigger: 'test', status: resp.ok ? 'delivered' : 'failed', http_status: resp.status, timestamp: new Date() });
      res.json({ ok: resp.ok, status: resp.status });
    } catch (err) {
      await wlog().insertOne({ webhook_id: hook.id, webhook_name: hook.name, trigger: 'test', status: 'error', error: err.message, timestamp: new Date() });
      res.json({ ok: false, error: err.message });
    }
  }));

  app.get('/api/v1/webhooks/log', a(async (req, res) => {
    res.json(await wlog().find({}).sort({ timestamp: -1 }).limit(100).project({ _id: 0 }).toArray());
  }));
}

// Alias for backward compat — older routes import emitWebhook
export { fireWebhooks as emitWebhook };

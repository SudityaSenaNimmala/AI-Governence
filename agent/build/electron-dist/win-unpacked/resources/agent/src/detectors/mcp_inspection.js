// Deep MCP server inspection. Given a server's command/args/env, extract
// concrete data targets so governance can answer "what specifically can this
// agent see?" — not just "filesystem" but which filesystem paths.

// Each rule matches a server style and extracts targets from its args/env.
// Add new rules as more MCP servers appear in the wild.
const RULES = [
  {
    name: 'filesystem',
    match: ({ blob }) => /modelcontextprotocol\/server-filesystem|mcp-server-filesystem/i.test(blob),
    scopes: ['filesystem'],
    targets: ({ args }) => {
      // The filesystem server takes one or more directory args.
      const dirs = (args || []).filter((a) =>
        a && !a.startsWith('-') && /[\\/]|^[A-Z]:/.test(a) && !a.endsWith('.js')
      );
      return dirs.map((path) => ({ kind: 'directory', path }));
    },
  },
  {
    name: 'github',
    match: ({ blob }) => /modelcontextprotocol\/server-github|mcp-github/i.test(blob),
    scopes: ['source-control'],
    targets: ({ env, args }) => {
      const targets = [];
      // Env var GITHUB_PERSONAL_ACCESS_TOKEN means an account scope
      if (env?.GITHUB_PERSONAL_ACCESS_TOKEN || env?.GITHUB_TOKEN) {
        targets.push({ kind: 'github-account', scope: 'all repos token can see' });
      }
      // Some configs pin orgs via args
      for (const a of args || []) {
        const m = a.match(/^--org[=\s]+([^\s]+)$/);
        if (m) targets.push({ kind: 'github-org', org: m[1] });
      }
      return targets;
    },
  },
  {
    name: 'postgres',
    match: ({ blob }) => /server-postgres|mcp-postgres/i.test(blob),
    scopes: ['database'],
    targets: ({ args, env }) => {
      const targets = [];
      for (const a of args || []) {
        if (/^postgres(ql)?:\/\//i.test(a)) {
          targets.push(parsePostgresUrl(a));
        }
      }
      if (env?.DATABASE_URL && /postgres/i.test(env.DATABASE_URL)) {
        targets.push({ kind: 'database', flavor: 'postgres', via: 'env:DATABASE_URL' });
      }
      return targets;
    },
  },
  {
    name: 'sqlite',
    match: ({ blob }) => /server-sqlite|mcp-sqlite/i.test(blob),
    scopes: ['database'],
    targets: ({ args }) => (args || [])
      .filter((a) => /\.sqlite$|\.db$/.test(a))
      .map((path) => ({ kind: 'database', flavor: 'sqlite', path })),
  },
  {
    name: 'slack',
    match: ({ blob }) => /server-slack|mcp-slack/i.test(blob),
    scopes: ['chat'],
    targets: ({ env }) => {
      if (env?.SLACK_BOT_TOKEN || env?.SLACK_TEAM_ID) {
        return [{ kind: 'slack-workspace', via: env.SLACK_TEAM_ID ? `team:${env.SLACK_TEAM_ID}` : 'token' }];
      }
      return [];
    },
  },
  {
    name: 'google-drive',
    match: ({ blob }) => /server-gdrive|server-google-drive|mcp-gdrive/i.test(blob),
    scopes: ['cloud-storage'],
    targets: ({ env }) => env?.GDRIVE_OAUTH_PATH
      ? [{ kind: 'gdrive', via: 'oauth-token' }]
      : [{ kind: 'gdrive' }],
  },
  {
    name: 'puppeteer-browser',
    match: ({ blob }) => /server-puppeteer|server-playwright|mcp-browser/i.test(blob),
    scopes: ['web', 'browser-automation'],
    targets: () => [{ kind: 'arbitrary-web' }],
  },
  {
    name: 'fetch',
    match: ({ blob }) => /server-fetch|mcp-fetch/i.test(blob),
    scopes: ['web'],
    targets: () => [{ kind: 'arbitrary-web' }],
  },
  {
    name: 'memory',
    match: ({ blob }) => /server-memory|mcp-memory/i.test(blob),
    scopes: ['memory'],
    targets: () => [],
  },
];

function parsePostgresUrl(url) {
  try {
    const u = new URL(url.replace(/^postgresql:/, 'postgres:'));
    return {
      kind: 'database',
      flavor: 'postgres',
      host: u.hostname,
      port: u.port || '5432',
      database: u.pathname.replace(/^\//, '') || null,
      user: u.username || null,
    };
  } catch {
    return { kind: 'database', flavor: 'postgres' };
  }
}

// Returns { kind, scopes, targets } for a given MCP server.
export function inspectMcpServer(server) {
  const args = Array.isArray(server.args) ? server.args : [];
  const env = server.env || {};
  const blob = [server.command, ...args, ...Object.values(env)].filter(Boolean).join(' ').toLowerCase();

  for (const rule of RULES) {
    if (rule.match({ blob, args, env, command: server.command })) {
      return {
        kind: rule.name,
        scopes: rule.scopes,
        targets: rule.targets({ args, env, command: server.command }) || [],
      };
    }
  }

  // Fallback: generic classification based on substring match
  const scopes = [];
  if (/filesystem|fs/i.test(blob)) scopes.push('filesystem');
  if (/github|gitlab/i.test(blob)) scopes.push('source-control');
  if (/postgres|mysql|sqlite|mongo|redis/i.test(blob)) scopes.push('database');
  if (/slack|discord|teams/i.test(blob)) scopes.push('chat');
  if (/drive|onedrive|dropbox|box/i.test(blob)) scopes.push('cloud-storage');
  if (/puppeteer|playwright|browser|fetch/i.test(blob)) scopes.push('web');
  if (/sentry|datadog|grafana/i.test(blob)) scopes.push('observability');
  if (/aws|gcp|azure/i.test(blob)) scopes.push('cloud-infra');

  return { kind: 'unknown', scopes, targets: [] };
}

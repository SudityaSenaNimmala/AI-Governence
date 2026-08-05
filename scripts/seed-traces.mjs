// Seed demo trace data into MongoDB for testing the tracing feature
const SERVER = 'http://localhost:3001';

// Enroll a demo machine
const enrollRes = await fetch(SERVER + '/api/v1/enroll', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ machineId: 'demo-server-001', hostname: 'prod-ai-server-1', enrollSecret: 'dev-enroll-secret-change-me' }),
});
const { token } = await enrollRes.json();
console.log('Enrolled:', token ? 'yes' : 'no');

const now = Date.now();
const events = [
  // Trace 1: Customer support bot (3 calls, 5s)
  { occurred_at: new Date(now - 300000).toISOString(), duration_ms: 1200, response_status: 200, host: 'api.openai.com', path: '/v1/chat/completions', method: 'POST', provider: 'openai', model: 'gpt-4o', prompt_tokens: 890, completion_tokens: 320, cost: { total_cost_usd: 0.012 }, prompt_text: 'Analyze this customer complaint about billing...', response_text: 'The customer is reporting an overcharge on their August invoice...', attribution: { pid: 1234, user: 'sarah', cmdline: 'python support_bot.py', cwd: '/opt/agents/support', trigger_source: 'systemd' } },
  { occurred_at: new Date(now - 298800).toISOString(), duration_ms: 2300, response_status: 200, host: 'api.openai.com', path: '/v1/chat/completions', method: 'POST', provider: 'openai', model: 'gpt-4o', prompt_tokens: 2100, completion_tokens: 850, cost: { total_cost_usd: 0.034 }, prompt_text: 'Draft a response to the customer...', response_text: 'Dear valued customer, thank you for bringing this to our attention...', attribution: { pid: 1234, user: 'sarah', cmdline: 'python support_bot.py', cwd: '/opt/agents/support', trigger_source: 'systemd' } },
  { occurred_at: new Date(now - 296500).toISOString(), duration_ms: 1800, response_status: 200, host: 'api.openai.com', path: '/v1/chat/completions', method: 'POST', provider: 'openai', model: 'gpt-4o', prompt_tokens: 3200, completion_tokens: 450, cost: { total_cost_usd: 0.028 }, prompt_text: 'Review and improve this draft for tone...', response_text: 'Dear [Customer Name], We sincerely apologize...', attribution: { pid: 1234, user: 'sarah', cmdline: 'python support_bot.py', cwd: '/opt/agents/support', trigger_source: 'systemd' } },

  // Trace 2: Code review agent (5 calls, 12s)
  { occurred_at: new Date(now - 180000).toISOString(), duration_ms: 800, response_status: 200, host: 'api.anthropic.com', path: '/v1/messages', method: 'POST', provider: 'anthropic', model: 'claude-3-5-sonnet', prompt_tokens: 450, completion_tokens: 120, cost: { total_cost_usd: 0.003 }, prompt_text: 'Review this pull request for security issues...', response_text: 'I will analyze the code changes...', attribution: { pid: 5678, user: 'devops-ci', cmdline: 'node code_reviewer.js', cwd: '/opt/agents/reviewer', trigger_source: 'github-actions' } },
  { occurred_at: new Date(now - 179200).toISOString(), duration_ms: 2100, response_status: 200, host: 'api.anthropic.com', path: '/v1/messages', method: 'POST', provider: 'anthropic', model: 'claude-3-5-sonnet', prompt_tokens: 8900, completion_tokens: 2400, cost: { total_cost_usd: 0.058 }, prompt_text: 'Analyze auth.py for SQL injection, XSS...', response_text: 'Found 2 potential issues: Line 45 SQL query uses string concatenation...', attribution: { pid: 5678, user: 'devops-ci', cmdline: 'node code_reviewer.js', cwd: '/opt/agents/reviewer', trigger_source: 'github-actions' } },
  { occurred_at: new Date(now - 177100).toISOString(), duration_ms: 1500, response_status: 200, host: 'api.anthropic.com', path: '/v1/messages', method: 'POST', provider: 'anthropic', model: 'claude-3-5-sonnet', prompt_tokens: 5200, completion_tokens: 1800, cost: { total_cost_usd: 0.042 }, prompt_text: 'Review api_routes.py...', response_text: 'This file looks clean. No vulnerabilities detected...', attribution: { pid: 5678, user: 'devops-ci', cmdline: 'node code_reviewer.js', cwd: '/opt/agents/reviewer', trigger_source: 'github-actions' } },
  { occurred_at: new Date(now - 175600).toISOString(), duration_ms: 900, response_status: 200, host: 'api.anthropic.com', path: '/v1/messages', method: 'POST', provider: 'anthropic', model: 'claude-3-5-sonnet', prompt_tokens: 3100, completion_tokens: 900, cost: { total_cost_usd: 0.022 }, prompt_text: 'Check models.py for data validation...', response_text: 'Found 1 issue: User input line 23 not sanitized...', attribution: { pid: 5678, user: 'devops-ci', cmdline: 'node code_reviewer.js', cwd: '/opt/agents/reviewer', trigger_source: 'github-actions' } },
  { occurred_at: new Date(now - 174700).toISOString(), duration_ms: 1200, response_status: 200, host: 'api.anthropic.com', path: '/v1/messages', method: 'POST', provider: 'anthropic', model: 'claude-3-5-sonnet', prompt_tokens: 4500, completion_tokens: 1500, cost: { total_cost_usd: 0.035 }, prompt_text: 'Generate summary review comment...', response_text: 'PR Review: 3 issues found. CRITICAL: SQL injection in auth.py...', attribution: { pid: 5678, user: 'devops-ci', cmdline: 'node code_reviewer.js', cwd: '/opt/agents/reviewer', trigger_source: 'github-actions' } },

  // Trace 3: Failed translation agent (1 call, error)
  { occurred_at: new Date(now - 60000).toISOString(), duration_ms: 500, response_status: 429, host: 'api.openai.com', path: '/v1/chat/completions', method: 'POST', provider: 'openai', model: 'gpt-4o', prompt_tokens: 200, completion_tokens: 0, cost: { total_cost_usd: 0 }, prompt_text: 'Translate this document to French...', response_text: 'Rate limit exceeded.', attribution: { pid: 9999, user: 'batch-worker', cmdline: 'python translator.py', cwd: '/opt/agents/translate', trigger_source: 'cron' } },

  // Trace 4: Data analyst (2 calls)
  { occurred_at: new Date(now - 30000).toISOString(), duration_ms: 3500, response_status: 200, host: 'api.anthropic.com', path: '/v1/messages', method: 'POST', provider: 'anthropic', model: 'claude-3-5-sonnet', prompt_tokens: 12000, completion_tokens: 3500, cost: { total_cost_usd: 0.092 }, prompt_text: 'Analyze quarterly sales data and identify trends...', response_text: 'Q3 2026 Analysis: Revenue increased 23% YoY...', attribution: { pid: 4321, user: 'alex', cmdline: 'python data_analyst.py', cwd: '/home/alex/analytics', trigger_source: 'ssh' } },
  { occurred_at: new Date(now - 26500).toISOString(), duration_ms: 2800, response_status: 200, host: 'api.anthropic.com', path: '/v1/messages', method: 'POST', provider: 'anthropic', model: 'claude-3-5-sonnet', prompt_tokens: 8500, completion_tokens: 4200, cost: { total_cost_usd: 0.078 }, prompt_text: 'Generate executive summary with chart recommendations...', response_text: 'Executive Summary: Three key trends: 1) Enterprise segment grew 45%...', attribution: { pid: 4321, user: 'alex', cmdline: 'python data_analyst.py', cwd: '/home/alex/analytics', trigger_source: 'ssh' } },
];

const res = await fetch(SERVER + '/api/v1/server-agent-events', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'authorization': 'Bearer ' + token },
  body: JSON.stringify({ events }),
});
console.log('Seeded:', await res.json());

// Test traces
const traces = await (await fetch(SERVER + '/api/v1/traces')).json();
console.log('\nTraces found:', traces.length);
for (const t of traces) {
  console.log(' ', t.user?.padEnd(12), 'calls:', t.call_count, 'cost: $' + t.total_cost_usd.toFixed(3), t.status, '-', (t.cmdline || '').slice(0, 30));
}

// Test stats
const stats = await (await fetch(SERVER + '/api/v1/traces/stats')).json();
console.log('\nStats:', JSON.stringify(stats));

// Test single trace detail
if (traces.length > 0) {
  const detail = await (await fetch(SERVER + '/api/v1/traces/' + encodeURIComponent(traces[0].trace_id))).json();
  console.log('\nTrace detail:', detail.user, '- calls:', detail.calls?.length, 'duration:', detail.duration_ms + 'ms');
}

// Test connected servers
const servers = await (await fetch(SERVER + '/api/v1/monitor/servers')).json();
console.log('\nServers:', servers.length, servers.map(s => s.machine_id + ' (' + s.status + ')').join(', '));

// Test token generation
const tokenRes = await (await fetch(SERVER + '/api/v1/monitor/generate-token', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ serverUrl: 'https://xyz.cloudfuze.com' }),
})).json();
console.log('\nInstall command:', tokenRes.install_command?.slice(0, 80) + '...');

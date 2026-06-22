import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import {
  Card, PageHeader, Table, LoadingPage, ErrorBanner, SectionTitle, Badge, Tag, MonoText,
} from '../components/ui.jsx';
import { AgentIcon, PlugIcon, HookIcon } from '../components/Icons.jsx';

function HookStatusBadge({ s }) {
  if (!s) return <Badge tone="default">unknown</Badge>;
  if (s === 'injected' || s === 'already_injected') return <Badge tone="success" dot>injected</Badge>;
  if (s === 'failed')  return <Badge tone="danger" dot>failed</Badge>;
  if (s === 'pending') return <Badge tone="warning" dot>pending</Badge>;
  return <Badge tone="default">{s}</Badge>;
}

const CATEGORY_META = {
  ai_agent: {
    title: 'Autonomous AI agents',
    hint: 'Projects using agent frameworks (LangChain, AutoGen, CrewAI, LlamaIndex, MCP SDK) that run multi-step reasoning and tool use.',
    tone: 'danger',
  },
  ai_coding_agent: {
    title: 'AI coding agents',
    hint: 'Projects managed by Claude Code, Cursor, Aider, Continue (detected via .claude / .cursor / CLAUDE.md / .cursorrules).',
    tone: 'warning',
  },
  ai_app: {
    title: 'AI-using apps',
    hint: 'Projects that call LLM APIs (openai, anthropic, Vercel ai SDK, Gemini) — chatbots / RAG, not autonomous agents.',
    tone: 'brand',
  },
};

export default function Agents() {
  const [mcp, setMcp]             = useState(null);
  const [projects, setProjects]   = useState(null);
  const [configs, setConfigs]     = useState(null);
  const [hookStatus, setHookStat] = useState(null);
  const [err, setErr]             = useState(null);

  useEffect(() => {
    Promise.all([
      api.latestFindings({ type: 'mcp_server',          limit: 500 }),
      api.latestFindings({ type: 'agent_project',       limit: 500 }),
      api.latestFindings({ type: 'agent_config',        limit: 500 }),
      api.latestFindings({ type: 'desktop_hook_status', limit: 500 }),
    ])
      .then(([m, p, c, h]) => { setMcp(m); setProjects(p); setConfigs(c); setHookStat(h); })
      .catch((e) => setErr(e.message));
  }, []);

  if (err) return <ErrorBanner msg={err} />;
  if (!mcp || !projects || !configs || !hookStatus) return <LoadingPage />;

  const byCategory = {
    ai_agent:        projects.filter((p) => p.payload?.primaryCategory === 'ai_agent'),
    ai_coding_agent: projects.filter((p) => p.payload?.primaryCategory === 'ai_coding_agent'),
    ai_app:          projects.filter((p) => p.payload?.primaryCategory === 'ai_app'),
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Agents & MCP"
        subtitle="Deep view of AI agents, their MCP connections, and where the desktop hook is active."
      />

      <Card>
        <SectionTitle
          title="MCP servers in use"
          hint="Each MCP server is a capability granted to an AI agent. Scopes show what kind of data/system the server bridges to."
        />
        <Table
          getRowKey={(r) => r.id}
          columns={[
            {
              key: 'machine',
              header: 'Machine',
              render: (f) => (
                <a className="text-brand-600 hover:text-brand-700 font-mono text-xs" href={`#/machines/${f.machine_id}`}>
                  {f.machine_id.slice(0, 10)}
                </a>
              ),
            },
            { key: 'client',  header: 'Client',  render: (f) => f.payload?.client || '—' },
            {
              key: 'server',
              header: 'Server',
              render: (f) => <span className="font-medium text-slate-900">{f.payload?.serverName}</span>,
            },
            {
              key: 'scopes',
              header: 'Scopes',
              render: (f) => {
                const scopes = f.payload?.scopes || [];
                if (scopes.length === 0) return <span className="text-xs text-slate-400">none classified</span>;
                return (
                  <div className="flex flex-wrap gap-1">
                    {scopes.map((s) => <Badge key={s} tone="warning">{s}</Badge>)}
                  </div>
                );
              },
            },
            {
              key: 'command',
              header: 'Command',
              render: (f) => (
                <MonoText className="truncate block max-w-md">
                  {[f.payload?.command, ...(f.payload?.args || [])].filter(Boolean).join(' ') || '—'}
                </MonoText>
              ),
            },
          ]}
          rows={mcp}
          emptyMessage="No MCP servers detected yet."
        />
      </Card>

      {Object.entries(CATEGORY_META).map(([key, meta]) => (
        <Card key={key}>
          <SectionTitle
            title={meta.title}
            hint={meta.hint}
            action={<Badge tone={meta.tone}>{byCategory[key].length}</Badge>}
          />
          <Table
            getRowKey={(r) => r.id}
            columns={[
              {
                key: 'machine',
                header: 'Machine',
                render: (f) => (
                  <a className="text-brand-600 hover:text-brand-700 font-mono text-xs" href={`#/machines/${f.machine_id}`}>
                    {f.machine_id.slice(0, 10)}
                  </a>
                ),
              },
              {
                key: 'path',
                header: 'Path',
                render: (f) => <MonoText>{f.payload?.path}</MonoText>,
              },
              { key: 'language', header: 'Language', render: (f) => f.payload?.language || '—' },
              {
                key: 'frameworks',
                header: 'Frameworks',
                render: (f) => (
                  <div className="flex flex-wrap gap-1">
                    {(f.payload?.frameworks || []).map((fw) => <Tag key={fw}>{fw}</Tag>)}
                  </div>
                ),
              },
              {
                key: 'modified',
                header: 'Modified',
                render: (f) => <span className="text-xs text-slate-500">{f.payload?.lastModified ?? '—'}</span>,
              },
            ]}
            rows={byCategory[key]}
            emptyMessage="None detected."
          />
        </Card>
      ))}

      <Card>
        <SectionTitle
          title="Desktop hook coverage"
          hint={
            <>For each Electron-based AI desktop app, whether the endpoint agent has injected the in-app monitoring hook. Events appear on <a className="text-brand-600 hover:underline" href="#/dlp">AI activity</a> with source <code className="font-mono text-[11px] bg-slate-100 px-1 rounded">desktop_hook</code>.</>
          }
        />
        <Table
          getRowKey={(r) => r.id}
          columns={[
            {
              key: 'machine',
              header: 'Machine',
              render: (f) => (
                <a className="text-brand-600 hover:text-brand-700 font-mono text-xs" href={`#/machines/${f.machine_id}`}>
                  {f.machine_id.slice(0, 10)}
                </a>
              ),
            },
            {
              key: 'product',
              header: 'Product',
              render: (f) => (
                <div>
                  <div className="font-medium text-slate-900">{f.payload?.product || '—'}</div>
                  <div className="text-xs text-slate-500">{f.payload?.vendor || '—'}</div>
                </div>
              ),
            },
            {
              key: 'versions',
              header: 'Version',
              render: (f) => (
                <div className="space-y-0.5">
                  <MonoText>{f.payload?.appVersion || '—'}</MonoText>
                  <div className="text-[11px] text-slate-400">hook {f.payload?.hookVersion || '?'}</div>
                </div>
              ),
            },
            {
              key: 'status',
              header: 'Status',
              render: (f) => <HookStatusBadge s={f.payload?.hookStatus} />,
            },
            {
              key: 'injectedAt',
              header: 'Injected',
              render: (f) => <span className="text-xs text-slate-500">{f.payload?.injectedAt || '—'}</span>,
            },
          ]}
          rows={hookStatus}
          emptyMessage="No desktop AI apps detected on enrolled machines yet — or the injector hasn't run."
        />
      </Card>

      <Card>
        <SectionTitle
          title="Agent configurations"
          hint="Machine-level config files that grant capabilities to AI agents."
        />
        <Table
          getRowKey={(r) => r.id}
          columns={[
            {
              key: 'machine',
              header: 'Machine',
              render: (f) => (
                <a className="text-brand-600 hover:text-brand-700 font-mono text-xs" href={`#/machines/${f.machine_id}`}>
                  {f.machine_id.slice(0, 10)}
                </a>
              ),
            },
            { key: 'kind',   header: 'Kind',   render: (f) => f.payload?.kind   || '—' },
            { key: 'vendor', header: 'Vendor', render: (f) => f.payload?.vendor || '—' },
            {
              key: 'path',
              header: 'Path',
              render: (f) => <MonoText>{f.payload?.path}</MonoText>,
            },
            {
              key: 'modified',
              header: 'Modified',
              render: (f) => <span className="text-xs text-slate-500">{f.payload?.lastModified ?? '—'}</span>,
            },
          ]}
          rows={configs}
          emptyMessage="No agent configs detected."
        />
      </Card>
    </div>
  );
}

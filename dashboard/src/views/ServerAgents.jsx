import React, { useEffect, useState, useMemo } from 'react';
import {
  Card, PageHeader, Table, StatCard, SectionTitle, LoadingPage, ErrorBanner,
  Badge, MonoText, Tag, EmptyState,
} from '../components/ui.jsx';

function formatUsd(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  const v = Number(n);
  if (v === 0) return '$0.00';
  if (v < 0.01) return '<$0.01';
  if (v < 1)    return '$' + v.toFixed(3);
  if (v < 100)  return '$' + v.toFixed(2);
  return '$' + Math.round(v).toLocaleString();
}

function formatTokens(n) {
  if (n == null) return '—';
  const v = Number(n);
  if (v < 1000) return String(v);
  if (v < 1_000_000) return (v / 1000).toFixed(1) + 'K';
  return (v / 1_000_000).toFixed(2) + 'M';
}

function relTime(iso) {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '—';
  const d = Date.now() - t;
  if (d < 60_000)      return Math.round(d / 1000) + 's ago';
  if (d < 3_600_000)   return Math.round(d / 60_000) + 'm ago';
  if (d < 86_400_000)  return Math.round(d / 3_600_000) + 'h ago';
  return Math.round(d / 86_400_000) + 'd ago';
}

const TRIGGER_TONE = {
  interactive_shell: 'info',
  cron:              'violet',
  systemd:           'default',
  ssh:               'info',
  ci:                'warning',
  container:         'brand',
  login:             'info',
};

function TriggerBadge({ trigger }) {
  if (!trigger) return <span className="text-xs text-slate-300">—</span>;
  return <Badge tone={TRIGGER_TONE[trigger] || 'default'}>{trigger}</Badge>;
}

const PROVIDER_TONE = {
  openai:        'success',
  anthropic:     'violet',
  google:        'info',
  'openai-azure': 'info',
  'aws-bedrock': 'warning',
};

function ProviderBadge({ provider }) {
  if (!provider) return <span className="text-xs text-slate-300">—</span>;
  return <Badge tone={PROVIDER_TONE[provider] || 'default'}>{provider}</Badge>;
}

function PromptPreview({ id, has, onOpen }) {
  if (!has) return <span className="text-xs text-slate-300">—</span>;
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onOpen(id); }}
      className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700"
    >
      view
    </button>
  );
}

function CallDrawer({ id, onClose }) {
  const [data, setData] = useState(null);
  const [err, setErr]   = useState(null);

  useEffect(() => {
    if (id == null) return;
    setData(null);
    setErr(null);
    fetch(`/api/v1/server-agents/calls/${id}`)
      .then((r) => r.ok ? r.json() : r.text().then((t) => Promise.reject(new Error(t))))
      .then(setData)
      .catch((e) => setErr(e.message));
  }, [id]);

  if (id == null) return null;
  return (
    <div className="fixed inset-0 z-40 flex" onClick={onClose}>
      <div className="flex-1 bg-slate-900/30" />
      <div
        className="w-full max-w-3xl bg-white shadow-2xl overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6 border-b border-slate-200 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Server agent call</h2>
            <p className="text-xs text-slate-500 mt-0.5">call #{id}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-2xl leading-none">×</button>
        </div>
        {err && <div className="p-6"><ErrorBanner msg={err} /></div>}
        {!data && !err && <div className="p-6 text-sm text-slate-500">Loading…</div>}
        {data && (
          <div className="p-6 space-y-6 text-sm">
            <section>
              <div className="text-[11px] uppercase tracking-wider font-semibold text-slate-500 mb-2">Attribution</div>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                <div><dt className="text-xs text-slate-500">User</dt><dd className="font-medium">{data.user || '(unknown)'}</dd></div>
                <div><dt className="text-xs text-slate-500">Trigger</dt><dd><TriggerBadge trigger={data.trigger_source} /></dd></div>
                <div className="col-span-2"><dt className="text-xs text-slate-500">Command</dt><dd><MonoText>{data.cmdline || '—'}</MonoText></dd></div>
                <div className="col-span-2"><dt className="text-xs text-slate-500">cwd</dt><dd><MonoText>{data.cwd || '—'}</MonoText></dd></div>
                <div><dt className="text-xs text-slate-500">PID / loginuid</dt><dd className="font-mono text-xs">{data.pid ?? '—'} / {data.loginuid ?? '—'}</dd></div>
                <div><dt className="text-xs text-slate-500">Machine</dt><dd className="font-mono text-xs">{data.machine_id}</dd></div>
              </dl>
            </section>
            <section>
              <div className="text-[11px] uppercase tracking-wider font-semibold text-slate-500 mb-2">Call</div>
              <dl className="grid grid-cols-3 gap-x-6 gap-y-2">
                <div><dt className="text-xs text-slate-500">Provider</dt><dd><ProviderBadge provider={data.provider} /></dd></div>
                <div><dt className="text-xs text-slate-500">Model</dt><dd className="font-mono text-xs break-all">{data.model || '—'}</dd></div>
                <div><dt className="text-xs text-slate-500">Status</dt><dd className="font-mono text-xs">{data.response_status || '—'}</dd></div>
                <div><dt className="text-xs text-slate-500">Prompt tokens</dt><dd className="font-mono tabular-nums">{formatTokens(data.prompt_tokens)}</dd></div>
                <div><dt className="text-xs text-slate-500">Completion tokens</dt><dd className="font-mono tabular-nums">{formatTokens(data.completion_tokens)}</dd></div>
                <div><dt className="text-xs text-slate-500">Cost</dt><dd className="font-mono tabular-nums font-semibold">{formatUsd(data.total_cost_usd)}</dd></div>
              </dl>
            </section>
            {data.prompt_text && (
              <section>
                <div className="text-[11px] uppercase tracking-wider font-semibold text-slate-500 mb-2">Prompt</div>
                <pre className="text-xs bg-slate-50 border border-slate-200 rounded-md p-3 max-h-80 overflow-auto whitespace-pre-wrap font-mono">{data.prompt_text}</pre>
              </section>
            )}
            {data.response_text && (
              <section>
                <div className="text-[11px] uppercase tracking-wider font-semibold text-slate-500 mb-2">Response</div>
                <pre className="text-xs bg-slate-50 border border-slate-200 rounded-md p-3 max-h-80 overflow-auto whitespace-pre-wrap font-mono">{data.response_text}</pre>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function ServerAgents() {
  const [summary, setSummary] = useState(null);
  const [calls, setCalls]     = useState(null);
  const [err, setErr]         = useState(null);
  const [drawerId, setDrawerId] = useState(null);

  useEffect(() => {
    Promise.all([
      fetch('/api/v1/server-agents/summary').then((r) => r.json()),
      fetch('/api/v1/server-agents/calls?limit=200').then((r) => r.json()),
    ])
      .then(([s, c]) => { setSummary(s); setCalls(c); })
      .catch((x) => setErr(x.message));
  }, []);

  if (err) return <ErrorBanner msg={err} />;
  if (!summary || !calls) return <LoadingPage />;

  const totals = summary.totals || {};

  return (
    <>
      <PageHeader
        title="Server agents"
        subtitle="LLM activity from CLI / cron / systemd agents on managed Linux servers. Captured by the server-monitor daemon via MITM proxy + /proc attribution."
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard label="Calls observed"    value={Number(totals.calls || 0).toLocaleString()} />
        <StatCard label="Total cost (USD)"  value={formatUsd(totals.total_cost_usd)} tone="brand" />
        <StatCard label="Distinct users"    value={Number(totals.distinct_users || 0)} />
        <StatCard label="Distinct machines" value={Number(totals.distinct_machines || 0)} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <Card>
          <SectionTitle title="Cost by user" hint="Top spenders — useful for chargeback" />
          <Table
            columns={[
              { key: 'user',     header: 'User' },
              { key: 'calls',    header: 'Calls', align: 'right', render: (r) => Number(r.calls).toLocaleString() },
              { key: 'cost_usd', header: 'Cost',  align: 'right', render: (r) => formatUsd(r.cost_usd) },
            ]}
            rows={summary.byUser || []}
            getRowKey={(r) => r.user}
            emptyMessage="No usage attributed to users yet."
          />
        </Card>
        <Card>
          <SectionTitle title="Cost by model" hint="Where the budget is going" />
          <Table
            columns={[
              { key: 'model',    header: 'Model', render: (r) => <span className="font-mono text-xs break-all">{r.model}</span> },
              { key: 'calls',    header: 'Calls', align: 'right', render: (r) => Number(r.calls).toLocaleString() },
              { key: 'cost_usd', header: 'Cost',  align: 'right', render: (r) => formatUsd(r.cost_usd) },
            ]}
            rows={summary.byModel || []}
            getRowKey={(r) => r.model}
            emptyMessage="No model usage yet."
          />
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <Card>
          <SectionTitle title="Trigger source" hint="How agents got invoked" />
          <Table
            columns={[
              { key: 'trigger_source', header: 'Source', render: (r) => <TriggerBadge trigger={r.trigger_source} /> },
              { key: 'calls',          header: 'Calls', align: 'right', render: (r) => Number(r.calls).toLocaleString() },
              { key: 'cost_usd',       header: 'Cost',  align: 'right', render: (r) => formatUsd(r.cost_usd) },
            ]}
            rows={summary.byTrigger || []}
            getRowKey={(r) => r.trigger_source}
            emptyMessage="No trigger data yet."
          />
        </Card>
        <Card>
          <SectionTitle title="By provider" />
          <Table
            columns={[
              { key: 'provider', header: 'Provider', render: (r) => <ProviderBadge provider={r.provider} /> },
              { key: 'calls',    header: 'Calls', align: 'right', render: (r) => Number(r.calls).toLocaleString() },
              { key: 'cost_usd', header: 'Cost',  align: 'right', render: (r) => formatUsd(r.cost_usd) },
            ]}
            rows={summary.byProvider || []}
            getRowKey={(r) => r.provider}
            emptyMessage="No provider data yet."
          />
        </Card>
      </div>

      <Card>
        <SectionTitle title="Recent calls" hint="Most recent 200 invocations across all servers" />
        {calls.length === 0 ? (
          <EmptyState
            title="No server-agent calls yet"
            message="Once the server-monitor daemon is installed on a managed server and HTTPS_PROXY is set, calls will stream in here."
          />
        ) : (
          <Table
            columns={[
              { key: 'occurred_at',   header: 'When', render: (r) => <span className="text-xs text-slate-500">{relTime(r.occurred_at)}</span>, width: 'w-24' },
              { key: 'user',          header: 'User', render: (r) => r.user || <span className="text-slate-300">—</span> },
              { key: 'trigger_source',header: 'Trigger', render: (r) => <TriggerBadge trigger={r.trigger_source} /> },
              { key: 'cmdline',       header: 'Agent', render: (r) => <MonoText className="text-xs">{(r.cmdline || '').slice(0, 60) || '—'}</MonoText> },
              { key: 'provider',      header: 'Provider', render: (r) => <ProviderBadge provider={r.provider} /> },
              { key: 'model',         header: 'Model', render: (r) => <span className="font-mono text-[11px] text-slate-600">{r.model || '—'}</span> },
              { key: 'tokens',        header: 'Tokens', align: 'right', render: (r) => formatTokens((r.prompt_tokens || 0) + (r.completion_tokens || 0)) },
              { key: 'cost',          header: 'Cost', align: 'right', render: (r) => formatUsd(r.total_cost_usd) },
              { key: 'preview',       header: '', align: 'right', render: (r) => <PromptPreview id={r.id} has={r.has_prompt} onOpen={setDrawerId} /> },
            ]}
            rows={calls}
            getRowKey={(r) => r.id}
          />
        )}
      </Card>

      <CallDrawer id={drawerId} onClose={() => setDrawerId(null)} />
    </>
  );
}

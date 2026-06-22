import React, { useEffect, useState } from 'react';
import {
  Card, PageHeader, Table, SectionTitle, LoadingPage, ErrorBanner,
  Badge, MonoText,
} from '../components/ui.jsx';

function relTime(iso) {
  if (!iso) return '—';
  const norm = iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z';
  const t = new Date(norm).getTime();
  if (!Number.isFinite(t)) return '—';
  const d = Date.now() - t;
  if (d < 60_000)     return Math.round(d / 1000) + 's ago';
  if (d < 3_600_000)  return Math.round(d / 60_000) + 'm ago';
  if (d < 86_400_000) return Math.round(d / 3_600_000) + 'h ago';
  return Math.round(d / 86_400_000) + 'd ago';
}

const CATEGORY_TONE = {
  'chat-frontend':     'info',
  'ide-assistant':     'success',
  'autonomous-agent':  'violet',
  'api-platform':      'default',
  'local-runtime':     'warning',
};

const SANDBOX_TONE = {
  local:  'success',
  remote: 'warning',
  mixed:  'info',
  unknown: 'default',
};

function ConfidenceBar({ value, threshold }) {
  const pct = Math.round((value || 0) * 100);
  const above = (value || 0) >= threshold;
  return (
    <div className="flex items-center gap-2 w-32">
      <div className="flex-1 h-1.5 rounded bg-slate-200 overflow-hidden">
        <div
          className={'h-full ' + (above ? 'bg-emerald-500' : 'bg-slate-400')}
          style={{ width: pct + '%' }}
        />
      </div>
      <span className="text-xs tabular-nums text-slate-600 w-9 text-right">{pct}%</span>
    </div>
  );
}

export default function Classifications() {
  const [rows,  setRows]  = useState(null);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('all');   // 'all' | 'ai' | 'not-ai'
  const [busy,  setBusy]  = useState(null);

  function load() {
    setError(null);
    const q = filter === 'ai' ? '?is_ai=1' : filter === 'not-ai' ? '?is_ai=0' : '';
    fetch('/api/v1/classifications' + q)
      .then((r) => r.ok ? r.json() : r.text().then((t) => Promise.reject(new Error(t))))
      .then(setRows)
      .catch((e) => setError(e.message));
  }
  useEffect(load, [filter]);

  async function override(host, is_ai) {
    setBusy(host);
    try {
      await fetch(`/api/v1/classifications/${encodeURIComponent(host)}/override`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ is_ai, reason: 'admin manual override from dashboard' }),
      });
      load();
    } finally { setBusy(null); }
  }
  async function clearOverride(host) {
    setBusy(host);
    try {
      await fetch(`/api/v1/classifications/${encodeURIComponent(host)}/override/clear`, { method: 'POST' });
      load();
    } finally { setBusy(null); }
  }

  if (rows == null && !error) return <LoadingPage />;

  const threshold = rows?.[0]?.threshold ?? 0.85;

  const columns = [
    { key: 'host', header: 'Host',
      render: (r) => (
        <div className="flex items-center gap-2">
          <MonoText>{r.host}</MonoText>
          {r.overridden && <Badge tone="warning">overridden</Badge>}
        </div>
      ),
    },
    { key: 'is_ai', header: 'Verdict',
      render: (r) => r.is_ai
        ? <Badge tone="success">AI tool</Badge>
        : <Badge tone="default">not AI</Badge>,
    },
    { key: 'confidence', header: 'Confidence',
      render: (r) => <ConfidenceBar value={r.confidence} threshold={r.threshold || threshold} /> },
    { key: 'vendor', header: 'Vendor',
      render: (r) => <span className="text-xs text-slate-600">{r.vendor || '—'}</span> },
    { key: 'category', header: 'Category',
      render: (r) => r.category ? <Badge tone={CATEGORY_TONE[r.category] || 'default'}>{r.category}</Badge> : <span className="text-xs text-slate-300">—</span> },
    { key: 'sandbox', header: 'Sandbox',
      render: (r) => r.sandbox ? <Badge tone={SANDBOX_TONE[r.sandbox] || 'default'}>{r.sandbox}</Badge> : <span className="text-xs text-slate-300">—</span> },
    { key: 'govern', header: 'Governed?',
      render: (r) => r.should_govern
        ? <Badge tone="success">yes</Badge>
        : <Badge tone="default">no</Badge> },
    { key: 'classifier', header: 'By',
      render: (r) => <span className="text-xs text-slate-500"><MonoText>{r.classifier}</MonoText></span> },
    { key: 'last_hit', header: 'Last hit',
      render: (r) => <span className="text-xs text-slate-500">{relTime(r.last_hit_at)}</span> },
    { key: 'actions', header: '', align: 'right',
      render: (r) => (
        <div className="flex justify-end gap-2 text-xs">
          {r.overridden ? (
            <button
              disabled={busy === r.host}
              onClick={() => clearOverride(r.host)}
              className="text-slate-500 hover:text-slate-800"
            >Clear override</button>
          ) : (
            <button
              disabled={busy === r.host}
              onClick={() => override(r.host, !r.is_ai)}
              className="text-brand-600 hover:text-brand-700 font-medium"
            >Flip to {r.is_ai ? 'not-AI' : 'AI'}</button>
          )}
        </div>
      ),
    },
  ];

  const aiCount    = rows?.filter((r) => r.is_ai).length || 0;
  const notAiCount = rows?.filter((r) => !r.is_ai).length || 0;
  const llmCount   = rows?.filter((r) => r.classifier?.startsWith('llm:')).length || 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="AI classifications"
        subtitle="Hosts the system has classified — automatically by the LLM classifier or via the heuristic stub. Verdicts apply across the fleet in real time. The classifier never sees prompt content, only metadata (host name, page title, body shape). Admin can override any verdict; overrides take effect immediately and are audit-logged."
      />

      {error && <ErrorBanner>{error}</ErrorBanner>}

      <div className="grid grid-cols-4 gap-4">
        <Card>
          <div className="text-xs uppercase tracking-wider text-slate-500 font-semibold">Hosts</div>
          <div className="text-2xl font-semibold text-slate-800 mt-1">{rows?.length ?? 0}</div>
        </Card>
        <Card>
          <div className="text-xs uppercase tracking-wider text-slate-500 font-semibold">AI</div>
          <div className="text-2xl font-semibold text-emerald-600 mt-1">{aiCount}</div>
        </Card>
        <Card>
          <div className="text-xs uppercase tracking-wider text-slate-500 font-semibold">Not AI</div>
          <div className="text-2xl font-semibold text-slate-600 mt-1">{notAiCount}</div>
        </Card>
        <Card>
          <div className="text-xs uppercase tracking-wider text-slate-500 font-semibold">via LLM</div>
          <div className="text-2xl font-semibold text-violet-600 mt-1">{llmCount}</div>
          <div className="text-[10px] text-slate-400 mt-0.5">(others via stub heuristic)</div>
        </Card>
      </div>

      <Card>
        <div className="flex items-center justify-between mb-3">
          <SectionTitle>Classifications</SectionTitle>
          <div className="flex gap-1 text-xs">
            {['all', 'ai', 'not-ai'].map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={
                  'px-2.5 py-1 rounded font-medium ' +
                  (filter === f ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-100')
                }
              >{f === 'all' ? 'All' : f === 'ai' ? 'AI only' : 'Not AI'}</button>
            ))}
          </div>
        </div>
        <Table
          columns={columns}
          rows={rows || []}
          rowKey="host"
          emptyMessage="No classifications yet. The first time the extension sees a new host, it'll appear here."
        />
      </Card>

      <Card>
        <SectionTitle>How auto-classification works</SectionTitle>
        <div className="text-sm text-slate-600 space-y-2 leading-relaxed mt-2">
          <p>
            When the browser extension lands on an unrecognized host, it sends a small bundle of metadata
            (<MonoText>host</MonoText>, <MonoText>page_title</MonoText>, <MonoText>has_chat_input</MonoText>,
            <MonoText> has_streaming_text</MonoText>, <MonoText>request_body_shape</MonoText>) to the server.
            The server checks this cache; on a miss it asks the configured classifier LLM
            (<MonoText>{rows?.[0]?.classifier?.startsWith('llm:') ? rows[0].classifier.slice(4) : 'Claude Haiku 4.5'}</MonoText>) <em>"is this an AI tool?"</em>
            and stores the verdict.
          </p>
          <p>
            Verdicts with confidence ≥ <MonoText>{(threshold * 100).toFixed(0)}%</MonoText> are
            governed live — the user's prompts to that host start flowing into the AI Activity view immediately.
            Below threshold, the host is logged here but not enforced.
          </p>
          <p>
            <strong>Privacy:</strong> only metadata reaches the classifier. Prompt content,
            response content, and other sensitive payloads are never sent.
          </p>
          <p>
            <strong>Override:</strong> click <em>Flip to AI/not-AI</em> on any row to manually correct a verdict.
            Overrides take effect fleet-wide within seconds, are audit-logged, and persist until cleared.
          </p>
        </div>
      </Card>
    </div>
  );
}

import React, { useEffect, useMemo, useState } from 'react';
import {
  Card, PageHeader, Table, SectionTitle, LoadingPage, ErrorBanner,
  Badge, MonoText, Input,
} from '../components/ui.jsx';
import { SearchIcon } from '../components/Icons.jsx';

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
const SANDBOX_TONE = { local: 'success', remote: 'warning', mixed: 'info', unknown: 'default' };
const SOURCE_TONE  = { admin: 'brand', 'seed:registry': 'default', 'seed:allowlist': 'default', classifier: 'violet' };

const CATEGORY_OPTIONS = ['chat-frontend', 'ide-assistant', 'autonomous-agent', 'api-platform', 'local-runtime'];
const SANDBOX_OPTIONS  = ['local', 'remote', 'mixed', 'unknown'];
const SURFACE_OPTIONS  = ['browser', 'desktop', 'cli', 'all'];

export default function AiPlatforms() {
  const [rows,  setRows]  = useState(null);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [busy, setBusy] = useState(null);

  function load() {
    setError(null);
    fetch('/api/v1/ai-platforms')
      .then((r) => r.ok ? r.json() : r.text().then((t) => Promise.reject(new Error(t))))
      .then(setRows)
      .catch((e) => setError(e.message));
  }
  useEffect(load, []);

  const filtered = useMemo(() => {
    if (!rows) return null;
    if (!filter) return rows;
    const n = filter.toLowerCase();
    return rows.filter((r) =>
      (r.host || '').toLowerCase().includes(n)
      || (r.vendor || '').toLowerCase().includes(n)
      || (r.product || '').toLowerCase().includes(n)
      || (r.category || '').toLowerCase().includes(n),
    );
  }, [rows, filter]);

  async function toggleGoverned(host, current) {
    setBusy(host);
    try {
      await fetch(`/api/v1/ai-platforms/${encodeURIComponent(host)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ governed: !current }),
      });
      load();
    } finally { setBusy(null); }
  }

  async function removeRow(host) {
    if (!confirm(`Remove ${host} from the registry? This stops governance for that host across the fleet.`)) return;
    setBusy(host);
    try {
      await fetch(`/api/v1/ai-platforms/${encodeURIComponent(host)}`, { method: 'DELETE' });
      load();
    } finally { setBusy(null); }
  }

  if (rows == null && !error) return <LoadingPage />;

  const governedCount   = (rows || []).filter((r) => r.governed).length;
  const adminAdded      = (rows || []).filter((r) => r.source === 'admin').length;
  const classifierAdded = (rows || []).filter((r) => r.source === 'classifier').length;

  const columns = [
    { key: 'host', header: 'Host',
      render: (r) => <MonoText>{r.host}</MonoText> },
    { key: 'vendor', header: 'Vendor',
      render: (r) => <span className="text-sm text-slate-700">{r.vendor || '—'}</span> },
    { key: 'product', header: 'Product',
      render: (r) => <span className="text-xs text-slate-500">{r.product || '—'}</span> },
    { key: 'category', header: 'Category',
      render: (r) => r.category ? <Badge tone={CATEGORY_TONE[r.category] || 'default'}>{r.category}</Badge> : <span className="text-xs text-slate-300">—</span> },
    { key: 'sandbox', header: 'Sandbox',
      render: (r) => r.sandbox ? <Badge tone={SANDBOX_TONE[r.sandbox] || 'default'}>{r.sandbox}</Badge> : <span className="text-xs text-slate-300">—</span> },
    { key: 'surface', header: 'Surface',
      render: (r) => <Badge tone="default">{r.surface}</Badge> },
    { key: 'governed', header: 'Governed', align: 'right',
      render: (r) => (
        <button
          disabled={busy === r.host}
          onClick={() => toggleGoverned(r.host, r.governed)}
          className="text-xs font-medium"
          title="Toggle governance for this host across the fleet"
        >
          {r.governed
            ? <Badge tone="success">on</Badge>
            : <Badge tone="default">off</Badge>}
        </button>
      ),
    },
    { key: 'source', header: 'Source',
      render: (r) => <Badge tone={SOURCE_TONE[r.source] || 'default'}>{r.source}</Badge> },
    { key: 'updated', header: 'Updated',
      render: (r) => <span className="text-xs text-slate-500">{relTime(r.updated_at)}</span> },
    { key: 'actions', header: '', align: 'right',
      render: (r) => (
        <button
          disabled={busy === r.host}
          onClick={() => removeRow(r.host)}
          className="text-xs font-medium text-rose-600 hover:text-rose-700"
        >Remove</button>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="AI Platforms"
        subtitle="The admin-editable registry of AI tools the governance stack actively captures from. Browser extension and desktop agent both fetch this list. Adding a row → governance kicks in fleet-wide within ~10 minutes (or instantly on next page load). Removing → governance stops."
      />

      {error && <ErrorBanner>{error}</ErrorBanner>}

      <div className="grid grid-cols-4 gap-4">
        <Card>
          <div className="text-xs uppercase tracking-wider text-slate-500 font-semibold">Total</div>
          <div className="text-2xl font-semibold text-slate-800 mt-1">{rows?.length ?? 0}</div>
        </Card>
        <Card>
          <div className="text-xs uppercase tracking-wider text-slate-500 font-semibold">Governed</div>
          <div className="text-2xl font-semibold text-emerald-600 mt-1">{governedCount}</div>
        </Card>
        <Card>
          <div className="text-xs uppercase tracking-wider text-slate-500 font-semibold">Admin-added</div>
          <div className="text-2xl font-semibold text-violet-600 mt-1">{adminAdded}</div>
        </Card>
        <Card>
          <div className="text-xs uppercase tracking-wider text-slate-500 font-semibold">LLM-discovered</div>
          <div className="text-2xl font-semibold text-amber-600 mt-1">{classifierAdded}</div>
        </Card>
      </div>

      <Card>
        <div className="flex items-center justify-between mb-3 gap-3">
          <div className="w-72">
            <Input
              icon={<SearchIcon size={14} />}
              placeholder="Filter by host, vendor, product…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </div>
          <button
            onClick={() => setShowAdd(true)}
            className="px-3 py-1.5 bg-brand-600 hover:bg-brand-700 text-white text-xs font-medium rounded"
          >+ Add platform</button>
        </div>

        {showAdd && (
          <AddPlatformForm
            onCancel={() => setShowAdd(false)}
            onSaved={() => { setShowAdd(false); load(); }}
          />
        )}

        <Table
          columns={columns}
          rows={filtered || []}
          rowKey="host"
          emptyMessage="No platforms in the registry yet."
        />
      </Card>

      <Card>
        <SectionTitle>How the registry works</SectionTitle>
        <div className="text-sm text-slate-600 space-y-2 leading-relaxed mt-2">
          <p>
            This is the single source of truth across the governance stack. Three sources populate it:
          </p>
          <ul className="list-disc pl-5 space-y-1">
            <li><Badge tone="default">seed:registry</Badge> — pre-seeded from <MonoText>agent/src/registry/ai-apps.json</MonoText> at install time</li>
            <li><Badge tone="default">seed:allowlist</Badge> — pre-seeded from the SaaS-with-AI list (Slack, Notion, Microsoft 365, etc.)</li>
            <li><Badge tone="violet">classifier</Badge> — auto-added by the LLM classifier when a user hits a host we've never seen</li>
            <li><Badge tone="brand">admin</Badge> — you added it manually here</li>
          </ul>
          <p>
            <strong>Browser extension</strong>: fetches the governed list every ~10 minutes and force-injects the DLP stack on any matching host.
            <strong> Desktop agent</strong>: same — feeds into the proxy's intercept whitelist.
          </p>
          <p>
            <strong>Toggle Governed</strong> off → captures stop fleet-wide for that host. <strong>Remove</strong> → row is deleted; if the LLM re-classifies the host as AI later, it'll come back as <Badge tone="violet">classifier</Badge>.
          </p>
        </div>
      </Card>
    </div>
  );
}

function AddPlatformForm({ onCancel, onSaved }) {
  const [host, setHost]         = useState('');
  const [vendor, setVendor]     = useState('');
  const [product, setProduct]   = useState('');
  const [category, setCategory] = useState('');
  const [sandbox, setSandbox]   = useState('unknown');
  const [surface, setSurface]   = useState('browser');
  const [note, setNote]         = useState('');
  const [err, setErr]           = useState(null);
  const [busy, setBusy]         = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch('/api/v1/ai-platforms', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          host, vendor, product: product || vendor,
          category: category || null, sandbox, surface,
          governance_note: note || null,
          governed: true,
          added_by: 'dashboard-admin',
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setErr(body.error || `HTTP ${res.status}`);
        return;
      }
      onSaved();
    } finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} className="border border-slate-200 rounded-md p-4 mb-4 bg-slate-50">
      <div className="text-sm font-semibold mb-3">Add a platform</div>
      {err && <ErrorBanner>{err}</ErrorBanner>}
      <div className="grid grid-cols-3 gap-3">
        <label className="text-xs">
          Host <span className="text-rose-500">*</span>
          <input className="mt-1 block w-full border border-slate-300 rounded px-2 py-1 text-sm" required value={host} onChange={(e) => setHost(e.target.value)} placeholder="e.g. lovable.dev" />
        </label>
        <label className="text-xs">
          Vendor
          <input className="mt-1 block w-full border border-slate-300 rounded px-2 py-1 text-sm" value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="e.g. Lovable" />
        </label>
        <label className="text-xs">
          Product
          <input className="mt-1 block w-full border border-slate-300 rounded px-2 py-1 text-sm" value={product} onChange={(e) => setProduct(e.target.value)} placeholder="defaults to vendor" />
        </label>
        <label className="text-xs">
          Category
          <select className="mt-1 block w-full border border-slate-300 rounded px-2 py-1 text-sm" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">— select —</option>
            {CATEGORY_OPTIONS.map((c) => <option key={c}>{c}</option>)}
          </select>
        </label>
        <label className="text-xs">
          Sandbox
          <select className="mt-1 block w-full border border-slate-300 rounded px-2 py-1 text-sm" value={sandbox} onChange={(e) => setSandbox(e.target.value)}>
            {SANDBOX_OPTIONS.map((c) => <option key={c}>{c}</option>)}
          </select>
        </label>
        <label className="text-xs">
          Surface
          <select className="mt-1 block w-full border border-slate-300 rounded px-2 py-1 text-sm" value={surface} onChange={(e) => setSurface(e.target.value)}>
            {SURFACE_OPTIONS.map((c) => <option key={c}>{c}</option>)}
          </select>
        </label>
        <label className="text-xs col-span-3">
          Governance note (optional)
          <input className="mt-1 block w-full border border-slate-300 rounded px-2 py-1 text-sm" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. agent runs in vendor cloud — actions invisible" />
        </label>
      </div>
      <div className="flex justify-end gap-2 mt-3">
        <button type="button" onClick={onCancel} className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded">Cancel</button>
        <button type="submit" disabled={busy} className="px-3 py-1.5 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-xs font-medium rounded">
          {busy ? 'Adding…' : 'Add platform'}
        </button>
      </div>
    </form>
  );
}

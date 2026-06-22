import React, { useEffect, useState } from 'react';
import {
  Card, PageHeader, Table, SectionTitle, LoadingPage, ErrorBanner,
  Badge, MonoText, EmptyState,
} from '../components/ui.jsx';

function relTime(iso) {
  if (!iso) return '—';
  // Server returns sqlite-style "YYYY-MM-DD HH:MM:SS" (UTC, no tz). Parse as UTC.
  const norm = iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z';
  const t = new Date(norm).getTime();
  if (!Number.isFinite(t)) return '—';
  const d = Date.now() - t;
  if (d < 60_000)     return Math.round(d / 1000) + 's ago';
  if (d < 3_600_000)  return Math.round(d / 60_000) + 'm ago';
  if (d < 86_400_000) return Math.round(d / 3_600_000) + 'h ago';
  return Math.round(d / 86_400_000) + 'd ago';
}

const WIRE_TONE = {
  openai:    'success',
  anthropic: 'violet',
  google:    'info',
  ollama:    'warning',
};

function WireBadge({ format }) {
  if (!format) return <span className="text-xs text-slate-300">—</span>;
  return <Badge tone={WIRE_TONE[format] || 'default'}>{format}</Badge>;
}

export default function Discovered() {
  const [rows,    setRows]    = useState(null);
  const [error,   setError]   = useState(null);
  const [showPromoted, setShowPromoted] = useState(false);

  function load() {
    setError(null);
    const q = showPromoted ? '' : '?promoted=0';
    fetch(`/api/v1/discovered-apps${q}`)
      .then((r) => r.ok ? r.json() : r.text().then((t) => Promise.reject(new Error(t))))
      .then(setRows)
      .catch((e) => setError(e.message));
  }
  useEffect(load, [showPromoted]);

  async function promote(id) {
    // We do NOT auto-edit ai-apps.json — that's a code-reviewed file. This
    // just hides the row so the tray stays curated. Admin still needs to
    // open a PR with the new registry entry.
    await fetch(`/api/v1/discovered-apps/${id}/promote`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    load();
  }

  if (rows == null && !error) return <LoadingPage />;

  const columns = [
    { key: 'host',        header: 'Host',         render: (r) => <MonoText>{r.host}</MonoText> },
    { key: 'wire_format', header: 'Wire format',  render: (r) => <WireBadge format={r.wire_format} /> },
    { key: 'call_count',  header: 'Calls', align: 'right',
      render: (r) => (r.call_count?.toLocaleString?.() ?? r.call_count) },
    { key: 'sample_model', header: 'Sample model',
      render: (r) => <span className="text-xs text-slate-500"><MonoText>{r.sample_model || '—'}</MonoText></span> },
    { key: 'sample_path',  header: 'Sample path',
      render: (r) => <span className="text-xs text-slate-500"><MonoText>{r.sample_path || '—'}</MonoText></span> },
    { key: 'first_seen',   header: 'First seen',
      render: (r) => <span className="text-xs text-slate-500">{relTime(r.first_seen_at)}</span> },
    { key: 'last_seen',    header: 'Last seen',
      render: (r) => <span className="text-xs text-slate-500">{relTime(r.last_seen_at)}</span> },
    { key: 'action', header: '', align: 'right',
      render: (r) => r.promoted ? (
        <Badge tone="success">promoted</Badge>
      ) : (
        <button
          onClick={() => promote(r.id)}
          className="text-xs font-medium text-brand-600 hover:text-brand-700"
        >
          Mark promoted
        </button>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Discovery tray"
        subtitle="AI hosts captured by behavior, not by name. Each row is a host the agent saw making AI-shaped calls (OpenAI/Anthropic/Gemini/Ollama wire formats) that isn't in the registry yet. Promote to mark it reviewed — the registry change still goes through code review in ai-apps.json."
      />

      {error && <ErrorBanner>{error}</ErrorBanner>}

      <Card>
        <div className="flex items-center justify-between mb-3">
          <SectionTitle>Discovered hosts</SectionTitle>
          <label className="text-xs text-slate-500 flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={showPromoted}
              onChange={(e) => setShowPromoted(e.target.checked)}
              className="rounded border-slate-300"
            />
            Show already-promoted
          </label>
        </div>

        {rows && rows.length === 0 ? (
          <EmptyState
            title="No discoveries yet"
            message="When the agent sees an AI-shaped call to an unknown host, it'll show up here. If this stays empty, your users are only hitting hosts already in the registry — which is the happy path."
          />
        ) : (
          <Table
            columns={columns}
            rows={rows || []}
            rowKey="id"
            emptyMessage="No unpromoted discoveries."
          />
        )}
      </Card>

      <Card>
        <SectionTitle>How discovery works</SectionTitle>
        <div className="text-sm text-slate-600 space-y-2 leading-relaxed mt-2">
          <p>
            The proxy and server-monitor capture any HTTPS traffic whose request
            and response bodies match an LLM wire shape (<MonoText>messages</MonoText> +
            <MonoText> usage.prompt_tokens</MonoText>, Anthropic's
            <MonoText> content[].text</MonoText> + <MonoText>input_tokens</MonoText>,
            Gemini's <MonoText>candidates[].content.parts</MonoText> +
            <MonoText> usageMetadata</MonoText>, or Ollama's NDJSON with
            <MonoText> done:true</MonoText>) — regardless of host.
          </p>
          <p>
            Hosts NOT in the registry land here, tagged
            {' '}<Badge tone="default">unknown:&lt;format&gt;</Badge> in the call log,
            with prompt/response captured but cost left blank (we don't know the
            vendor's pricing).
          </p>
          <p>
            To promote: add a block to <MonoText>agent/src/registry/ai-apps.json</MonoText>,
            ship the agent update, then click <em>Mark promoted</em> here.
          </p>
        </div>
      </Card>
    </div>
  );
}

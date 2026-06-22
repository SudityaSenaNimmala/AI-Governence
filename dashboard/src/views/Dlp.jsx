import React, { useEffect, useState } from 'react';
import {
  Card, PageHeader, Table, StatCard, SectionTitle, LoadingPage, ErrorBanner,
  Badge, SeverityPill, MonoText, Tag,
} from '../components/ui.jsx';
import { MessageIcon, FileIcon, AlertIcon } from '../components/Icons.jsx';
import PreviewDrawer from '../components/PreviewDrawer.jsx';

function Source({ s }) {
  const map = {
    browser_extension: { tone: 'info',   text: 'browser' },
    desktop_hook:      { tone: 'violet', text: 'desktop hook' },
    os_monitor:        { tone: 'success',text: 'os monitor' },
  };
  const m = map[s] || { tone: 'default', text: s || '—' };
  return <Badge tone={m.tone}>{m.text}</Badge>;
}

const CATEGORY_COLORS = {
  'chat-frontend':     'brand',
  'api-platform':      'warning',
  'cli-agent':         'violet',
  'ide-assistant':     'info',
  'autonomous-agent':  'danger',
  'local-runtime':     'success',
};

function ToolBadge({ platform }) {
  if (!platform) return <span className="text-xs text-slate-300">—</span>;
  const label = platform.product || platform.vendor || platform.host || '—';
  const tone  = CATEGORY_COLORS[platform.category] || 'default';
  return (
    <span className="inline-flex flex-col gap-0.5">
      <Badge tone={tone}>{label}</Badge>
      {platform.category && (
        <span className="text-[10px] text-slate-400">{platform.category}</span>
      )}
    </span>
  );
}

function PreviewBtn({ has, onClick, label = 'View' }) {
  if (!has) return <span className="text-xs text-slate-300">—</span>;
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700"
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" />
      </svg>
      {label}
    </button>
  );
}

function formatBytes(n) {
  if (n == null) return '—';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB';
  return (n / 1024 / 1024 / 1024).toFixed(1) + ' GB';
}

export default function Dlp() {
  const [summary, setSummary] = useState(null);
  const [prompts, setPrompts] = useState(null);
  const [files, setFiles]     = useState(null);
  const [err, setErr]         = useState(null);
  const [preview, setPreview] = useState(null);   // { eventId, meta }

  useEffect(() => {
    Promise.all([
      fetch('/api/v1/dlp/summary').then((r) => r.json()),
      fetch('/api/v1/dlp?limit=200').then((r) => r.json()),
      fetch('/api/v1/dlp/files').then((r) => r.json()),
    ])
      .then(([s, e, f]) => {
        setSummary(s);
        setPrompts(e.filter((x) => x.event_kind !== 'file_upload'));
        setFiles(f);
      })
      .catch((x) => setErr(x.message));
  }, []);

  if (err) return <ErrorBanner msg={err} />;
  if (!summary || !prompts || !files) return <LoadingPage />;

  const promptCount = (summary.byKind || []).filter((k) => k.event_kind !== 'file_upload').reduce((a, b) => a + b.events, 0);
  const fileCount   = (summary.byKind || []).filter((k) => k.event_kind === 'file_upload').reduce((a, b) => a + b.events, 0);
  const critCount   = (summary.bySeverity || []).filter((s) => s.severity === 'critical' || s.severity === 'high').reduce((a, b) => a + b.events, 0);

  const openPreview = (row) => setPreview({ eventId: row.id, meta: row });

  return (
    <div className="space-y-6">
      <PageHeader
        title="AI activity"
        subtitle="Sensitive-data events captured as users interact with AI services across three surfaces — the browser extension, the desktop hook, and the OS monitor. Click any row to view the full prompt or file content."
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label="Prompt events"   value={promptCount} hint="paste + submit"            tone="brand"   icon={<MessageIcon size={18} />} />
        <StatCard label="File uploads"    value={fileCount}   hint="picker + drop + clipboard" tone="warning" icon={<FileIcon size={18} />} />
        <StatCard label="High / critical" value={critCount}   hint="needs review"              tone="danger"  icon={<AlertIcon size={18} />} />
      </div>

      <Card>
        <SectionTitle
          title="Activity by AI service"
          hint="Events grouped by service, across all capture surfaces."
        />
        <Table
          getRowKey={(r) => r.ai_service}
          columns={[
            { key: 'ai_service',   header: 'Service', render: (r) => <span className="font-medium text-slate-900">{r.ai_service}</span> },
            { key: 'prompts',      header: 'Prompts',     align: 'right', render: (r) => r.prompts || 0 },
            { key: 'file_uploads', header: 'File uploads',align: 'right', render: (r) => r.file_uploads || 0 },
            { key: 'events',       header: 'Total',       align: 'right' },
            { key: 'machines',     header: 'Machines',    align: 'right' },
          ]}
          rows={summary.byService}
          emptyMessage="No events yet. Install the extension on a test machine to start collecting."
        />
      </Card>

      <Card>
        <SectionTitle
          title="Sensitive prompts"
          hint="Text pasted or submitted into AI prompts that matched secret / PII patterns. Click View to see the full prompt."
          action={<Badge tone="brand">{prompts.length}</Badge>}
        />
        <ClickableTable
          rows={prompts}
          onRowClick={openPreview}
          columns={[
            { key: 'when',     header: 'When',     render: (e) => <span className="text-xs text-slate-500">{e.occurred_at}</span> },
            { key: 'tool',     header: 'Tool',     render: (e) => <ToolBadge platform={e.platform} /> },
            { key: 'service',  header: 'Service',  render: (e) => e.ai_service },
            { key: 'source',   header: 'Source',   render: (e) => <Source s={e.source} /> },
            { key: 'kind',     header: 'Kind',     render: (e) => <Tag>{e.event_kind}</Tag> },
            { key: 'pattern',  header: 'Pattern',  render: (e) => <MonoText>{e.pattern_matched || '—'}</MonoText> },
            { key: 'severity', header: 'Severity', render: (e) => <SeverityPill severity={e.secret_class} /> },
            { key: 'len',      header: 'Length',   align: 'right', render: (e) => e.content_length ?? '—' },
            { key: 'preview',  header: '',         align: 'right', render: (e) => <PreviewBtn has={e.has_content} onClick={() => openPreview(e)} /> },
          ]}
          emptyMessage="No prompt-flagged events."
        />
      </Card>

      <Card>
        <SectionTitle
          title="File uploads"
          hint="Files dropped, pasted, or selected for upload to an AI service. Click View to see the file inline."
          action={<Badge tone="warning">{files.length}</Badge>}
        />
        <ClickableTable
          rows={files}
          onRowClick={openPreview}
          columns={[
            { key: 'when',     header: 'When',     render: (e) => <span className="text-xs text-slate-500">{e.occurred_at}</span> },
            { key: 'tool',     header: 'Tool',     render: (e) => <ToolBadge platform={e.platform} /> },
            { key: 'service',  header: 'Service',  render: (e) => e.ai_service },
            { key: 'filename', header: 'Filename', render: (e) => <MonoText>{e.metadata?.filename || '—'}</MonoText> },
            { key: 'class',    header: 'Class',    render: (e) => <Tag>{e.file_class}</Tag> },
            { key: 'severity', header: 'Severity', render: (e) => <SeverityPill severity={e.severity} /> },
            { key: 'size',     header: 'Size',     align: 'right', render: (e) => <span className="text-xs">{e.metadata?.size_bucket || formatBytes(e.size)}</span> },
            { key: 'via',      header: 'Via',      render: (e) => <Badge tone="default">{e.metadata?.via || '—'}</Badge> },
            { key: 'preview',  header: '',         align: 'right', render: (e) => <PreviewBtn has={e.has_content} onClick={() => openPreview(e)} label="Open" /> },
          ]}
          emptyMessage="No file uploads detected."
        />
      </Card>

      {preview && (
        <PreviewDrawer
          eventId={preview.eventId}
          eventMeta={preview.meta}
          onClose={() => setPreview(null)}
        />
      )}
    </div>
  );
}

// Same shape as Table from ui.jsx, but rows are clickable. We don't reuse
// Table directly because the row-level <tr onClick> needs to live inside this
// component (Table's row class is fixed).
function ClickableTable({ columns, rows, onRowClick, emptyMessage }) {
  return (
    <div className="overflow-x-auto -mx-6 px-6">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 border-b border-slate-200">
            {columns.map((c) => (
              <th key={c.key} className={`py-2.5 pr-4 font-semibold ${c.align === 'right' ? 'text-right pr-0' : ''}`}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr><td colSpan={columns.length} className="py-10 text-center text-sm text-slate-400">{emptyMessage}</td></tr>
          )}
          {rows.map((r) => {
            const clickable = !!r.has_content;
            return (
              <tr
                key={r.id}
                className={`border-b border-slate-100 ${clickable ? 'hover:bg-slate-50/70 cursor-pointer' : 'opacity-95'} transition-colors`}
                onClick={() => { if (clickable) onRowClick(r); }}
              >
                {columns.map((c) => (
                  <td key={c.key} className={`py-3 pr-4 align-middle ${c.align === 'right' ? 'text-right pr-0 tabular-nums' : ''}`}>
                    {c.render ? c.render(r) : r[c.key]}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

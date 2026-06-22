import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import {
  Card, PageHeader, Table, LoadingPage, ErrorBanner, Input, Tag, SanctionPill,
} from '../components/ui.jsx';
import { SearchIcon, ToolsIcon } from '../components/Icons.jsx';

export default function Tools() {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState(null);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('all');

  useEffect(() => {
    api.tools().then(setRows).catch((e) => setErr(e.message));
  }, []);

  const filtered = useMemo(() => {
    if (!rows) return null;
    return rows.filter((r) => {
      if (status !== 'all' && r.sanction !== status) return false;
      if (!q) return true;
      const needle = q.toLowerCase();
      return (r.product || '').toLowerCase().includes(needle) ||
             (r.vendor  || '').toLowerCase().includes(needle);
    });
  }, [rows, q, status]);

  if (err) return <ErrorBanner msg={err} />;
  if (!rows || !filtered) return <LoadingPage />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tools catalog"
        subtitle="Every distinct AI tool detected across the org."
      />

      <Card padding="p-0">
        <div className="flex items-center gap-3 px-6 pt-5 pb-3 border-b border-slate-100">
          <div className="w-72">
            <Input
              icon={<SearchIcon size={14} />}
              placeholder="Filter by vendor or product…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-1 ml-auto">
            {['all', 'approved', 'restricted', 'blocked', 'unknown'].map((s) => (
              <button
                key={s}
                onClick={() => setStatus(s)}
                className={
                  'h-8 px-3 rounded-md text-xs font-medium transition-colors ' +
                  (status === s
                    ? 'bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-200'
                    : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100')
                }
              >
                {s}
              </button>
            ))}
          </div>
        </div>
        <div className="px-6 py-4">
          <Table
            getRowKey={(r) => r.tool_key}
            columns={[
              {
                key: 'product',
                header: 'Product',
                render: (t) => (
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="w-8 h-8 rounded-md bg-slate-100 text-slate-500 flex items-center justify-center shrink-0">
                      <ToolsIcon size={15} />
                    </span>
                    <div className="min-w-0">
                      <div className="font-medium text-slate-900 truncate">{t.product || '—'}</div>
                      <div className="text-xs text-slate-500 truncate">{t.vendor || 'Unknown vendor'}</div>
                    </div>
                  </div>
                ),
              },
              {
                key: 'evidence',
                header: 'Evidence',
                render: (t) => (
                  <div className="flex flex-wrap gap-1">
                    {(t.evidence_types || []).slice(0, 4).map((e) => <Tag key={e}>{e}</Tag>)}
                    {(t.evidence_types || []).length > 4 && (
                      <Tag>+{t.evidence_types.length - 4}</Tag>
                    )}
                  </div>
                ),
              },
              { key: 'machines', header: 'Machines', align: 'right' },
              {
                key: 'sanction',
                header: 'Status',
                render: (t) => <SanctionPill status={t.sanction} />,
              },
              {
                key: 'action',
                header: '',
                align: 'right',
                render: (t) => (
                  <a
                    className="text-xs font-medium text-brand-600 hover:text-brand-700"
                    href={`#/tools/${encodeURIComponent(t.tool_key)}`}
                  >
                    Open →
                  </a>
                ),
              },
            ]}
            rows={filtered}
            emptyMessage={rows.length === 0 ? 'No tools detected yet.' : 'No tools match your filter.'}
          />
        </div>
      </Card>
    </div>
  );
}

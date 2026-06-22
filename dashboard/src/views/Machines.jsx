import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import {
  Card, PageHeader, Table, LoadingPage, ErrorBanner, Input, Badge,
} from '../components/ui.jsx';
import { SearchIcon, MachineIcon } from '../components/Icons.jsx';

function relativeTime(ts) {
  if (!ts) return '—';
  const d = new Date(ts.replace(' ', 'T') + (ts.includes('Z') ? '' : 'Z'));
  const diff = (Date.now() - d.getTime()) / 1000;
  if (isNaN(diff)) return ts;
  if (diff < 60) return 'just now';
  if (diff < 3600) return Math.round(diff / 60) + 'm ago';
  if (diff < 86400) return Math.round(diff / 3600) + 'h ago';
  return Math.round(diff / 86400) + 'd ago';
}

function platformTone(p) {
  const v = (p || '').toLowerCase();
  if (v.includes('win')) return 'info';
  if (v.includes('mac') || v.includes('darwin')) return 'default';
  if (v.includes('linux')) return 'warning';
  return 'default';
}

export default function Machines() {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState(null);
  const [q, setQ] = useState('');

  useEffect(() => {
    api.machines().then(setRows).catch((e) => setErr(e.message));
  }, []);

  const filtered = useMemo(() => {
    if (!rows) return null;
    if (!q) return rows;
    const needle = q.toLowerCase();
    return rows.filter((m) =>
      (m.hostname || '').toLowerCase().includes(needle) ||
      (m.user || '').toLowerCase().includes(needle) ||
      (m.platform || '').toLowerCase().includes(needle)
    );
  }, [rows, q]);

  if (err) return <ErrorBanner msg={err} />;
  if (!rows || !filtered) return <LoadingPage />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Enrolled machines"
        subtitle="All endpoints that have reported in."
        actions={
          <div className="w-72">
            <Input
              icon={<SearchIcon size={14} />}
              placeholder="Search hostname, user, OS…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
        }
      />

      <Card padding="p-0">
        <div className="px-6 pt-5 pb-2 flex items-center justify-between text-xs text-slate-500">
          <span>{filtered.length} of {rows.length} machines</span>
        </div>
        <div className="px-6 pb-4">
          <Table
            getRowKey={(r) => r.id}
            columns={[
              {
                key: 'hostname',
                header: 'Machine',
                render: (m) => (
                  <a className="group inline-flex items-center gap-2.5 min-w-0" href={`#/machines/${m.id}`}>
                    <span className="w-8 h-8 rounded-md bg-slate-100 text-slate-500 flex items-center justify-center shrink-0 group-hover:bg-brand-50 group-hover:text-brand-600 transition-colors">
                      <MachineIcon size={15} />
                    </span>
                    <span className="min-w-0">
                      <span className="block font-medium text-slate-900 group-hover:text-brand-700 truncate">
                        {m.hostname || m.id.slice(0, 12)}
                      </span>
                      <span className="block text-xs text-slate-500 truncate">{m.user || 'unknown user'}</span>
                    </span>
                  </a>
                ),
              },
              {
                key: 'platform',
                header: 'Platform',
                render: (m) => <Badge tone={platformTone(m.platform)}>{m.platform || '—'}</Badge>,
              },
              { key: 'findings_count', header: 'Findings', align: 'right' },
              { key: 'unique_tools',   header: 'Tools',    align: 'right' },
              {
                key: 'last_scan_at',
                header: 'Last scan',
                render: (m) => <span className="text-xs text-slate-500">{relativeTime(m.last_scan_at)}</span>,
              },
              {
                key: 'action',
                header: '',
                align: 'right',
                render: (m) => (
                  <a className="text-xs font-medium text-brand-600 hover:text-brand-700" href={`#/machines/${m.id}`}>
                    Open →
                  </a>
                ),
              },
            ]}
            rows={filtered}
            emptyMessage={rows.length === 0 ? 'No machines have reported yet.' : 'No machines match your filter.'}
          />
        </div>
      </Card>
    </div>
  );
}

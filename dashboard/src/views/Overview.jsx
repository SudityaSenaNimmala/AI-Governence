import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import {
  Card, PageHeader, StatCard, SectionTitle, Table, SanctionPill,
  LoadingPage, ErrorBanner, EmptyState,
} from '../components/ui.jsx';

export { LoadingPage as Loading, ErrorBanner as Error } from '../components/ui.jsx';
import {
  MachineIcon, ActivityIcon, AlertIcon, ToolsIcon, InboxIcon, ChevronRight,
} from '../components/Icons.jsx';

export default function Overview() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    api.overview().then(setData).catch((e) => setErr(e.message));
  }, []);

  if (err) return <ErrorBanner msg={err} />;
  if (!data) return <LoadingPage />;

  const totalFindings = data.totals.findings || 0;
  const byType = (data.byType || []).slice().sort((a, b) => b.count - a.count);
  const maxByType = Math.max(1, ...byType.map((t) => t.count));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Overview"
        subtitle="Aggregate AI tool and agent footprint across enrolled machines."
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Enrolled machines"
          value={data.totals.machines}
          tone="brand"
          icon={<MachineIcon size={18} />}
        />
        <StatCard
          label="Total scans"
          value={data.totals.scans}
          tone="info"
          icon={<ActivityIcon size={18} />}
        />
        <StatCard
          label="Findings"
          value={data.totals.findings}
          tone="warning"
          icon={<AlertIcon size={18} />}
        />
        <StatCard
          label="Unique AI tools"
          value={data.totals.unique_tools}
          tone="violet"
          icon={<ToolsIcon size={18} />}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <Card className="lg:col-span-3">
          <SectionTitle
            title="Top AI tools across the org"
            hint="Most-detected tools, ranked by machine count."
            action={<a href="#/tools" className="text-xs font-medium text-brand-600 hover:text-brand-700 inline-flex items-center gap-0.5">View all <ChevronRight size={12} /></a>}
          />
          <Table
            getRowKey={(r) => r.tool_key}
            columns={[
              {
                key: 'product',
                header: 'Product',
                render: (t) => (
                  <div className="min-w-0">
                    <div className="font-medium text-slate-900 truncate">{t.product || '—'}</div>
                    <div className="text-xs text-slate-500 truncate">{t.vendor || 'Unknown vendor'}</div>
                  </div>
                ),
              },
              { key: 'machines', header: 'Machines', align: 'right' },
              { key: 'findings', header: 'Findings', align: 'right' },
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
                    View →
                  </a>
                ),
              },
            ]}
            rows={data.topTools}
            emptyMessage="No data yet. Run the agent and POST a report."
          />
        </Card>

        <Card className="lg:col-span-2">
          <SectionTitle
            title="Findings breakdown"
            hint="Distribution by detector type."
          />
          {byType.length === 0 ? (
            <EmptyState
              icon={<InboxIcon size={20} />}
              title="No findings yet"
              message="The agent hasn't reported any findings. Once it runs a scan, categories will appear here."
            />
          ) : (
            <div className="space-y-3">
              {byType.map((row) => {
                const pct = (row.count / maxByType) * 100;
                const share = totalFindings ? Math.round((row.count / totalFindings) * 100) : 0;
                return (
                  <div key={row.type}>
                    <div className="flex items-center justify-between text-xs mb-1.5">
                      <span className="font-medium text-slate-700 truncate">{row.type.replace(/_/g, ' ')}</span>
                      <span className="text-slate-500 tabular-nums">
                        {row.count} <span className="text-slate-400">· {share}%</span>
                      </span>
                    </div>
                    <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-brand-500 to-brand-400 rounded-full"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

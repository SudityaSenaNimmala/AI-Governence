import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import {
  Card, PageHeader, Table, LoadingPage, ErrorBanner, SanctionPill, EmptyState,
} from '../components/ui.jsx';
import { ShadowIcon, ToolsIcon, CheckIcon } from '../components/Icons.jsx';

export default function Shadow() {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    api.shadow().then(setRows).catch((e) => setErr(e.message));
  }, []);

  if (err) return <ErrorBanner msg={err} />;
  if (!rows) return <LoadingPage />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Shadow AI"
        subtitle="AI tools detected in the org that are not yet approved. Triage and sanction below."
      />

      <Card padding="p-0">
        <div className="px-6 pt-5 pb-3 text-xs text-slate-500">
          {rows.length} tool{rows.length === 1 ? '' : 's'} awaiting review
        </div>
        <div className="px-6 pb-4">
          {rows.length === 0 ? (
            <EmptyState
              icon={<CheckIcon size={22} />}
              title="No shadow AI detected"
              message="Every tool currently found is either approved or already triaged."
            />
          ) : (
            <Table
              getRowKey={(r) => r.tool_key}
              columns={[
                {
                  key: 'product',
                  header: 'Product',
                  render: (r) => (
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="w-8 h-8 rounded-md bg-rose-50 text-rose-600 flex items-center justify-center shrink-0">
                        <ShadowIcon size={15} />
                      </span>
                      <div className="min-w-0">
                        <div className="font-medium text-slate-900 truncate">{r.product || '—'}</div>
                        <div className="text-xs text-slate-500 truncate">{r.vendor || 'Unknown vendor'}</div>
                      </div>
                    </div>
                  ),
                },
                { key: 'machines', header: 'Machines', align: 'right' },
                { key: 'findings', header: 'Findings', align: 'right' },
                {
                  key: 'sanction',
                  header: 'Status',
                  render: (r) => <SanctionPill status={r.sanction} />,
                },
                {
                  key: 'action',
                  header: '',
                  align: 'right',
                  render: (r) => (
                    <a
                      className="text-xs font-medium text-brand-600 hover:text-brand-700"
                      href={`#/tools/${encodeURIComponent(r.tool_key)}`}
                    >
                      Review →
                    </a>
                  ),
                },
              ]}
              rows={rows}
            />
          )}
        </div>
      </Card>
    </div>
  );
}

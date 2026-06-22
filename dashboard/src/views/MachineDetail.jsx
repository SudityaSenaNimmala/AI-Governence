import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import {
  Card, PageHeader, SectionTitle, LoadingPage, ErrorBanner, Badge, MonoText, Tag,
} from '../components/ui.jsx';
import { ChevronLeft } from '../components/Icons.jsx';

export default function MachineDetail({ id }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    api.machine(id).then(setData).catch((e) => setErr(e.message));
  }, [id]);

  if (err) return <ErrorBanner msg={err} />;
  if (!data) return <LoadingPage />;

  const { machine, latestFindings, recentScans } = data;
  const groups = {};
  for (const f of latestFindings) (groups[f.detector] ||= []).push(f);

  return (
    <div className="space-y-6">
      <a href="#/machines" className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-900">
        <ChevronLeft size={14} /> All machines
      </a>

      <PageHeader
        title={machine.hostname || machine.id.slice(0, 12)}
        subtitle={
          <span className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
            <span><span className="text-slate-400">User:</span> <span className="text-slate-700">{machine.user || '—'}</span></span>
            <span><span className="text-slate-400">Platform:</span> <span className="text-slate-700">{machine.platform || '—'}</span></span>
            <span><span className="text-slate-400">OS:</span> <span className="text-slate-700">{machine.os_release || '—'}</span></span>
            <span><span className="text-slate-400">Last seen:</span> <span className="text-slate-700">{machine.last_seen || '—'}</span></span>
          </span>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2">
          <SectionTitle title="Latest findings" hint="Grouped by detector." action={<Badge tone="brand">{latestFindings.length}</Badge>} />
          <div className="space-y-5">
            {Object.entries(groups).map(([detector, findings]) => (
              <div key={detector}>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">{detector.replace(/_/g, ' ')}</span>
                  <Tag>{findings.length}</Tag>
                </div>
                <div className="space-y-2">
                  {findings.map((f) => <FindingCard key={f.id} f={f} />)}
                </div>
              </div>
            ))}
            {Object.keys(groups).length === 0 && (
              <div className="text-sm text-slate-400 py-6 text-center">No findings.</div>
            )}
          </div>
        </Card>

        <Card>
          <SectionTitle title="Recent scans" hint="Most recent agent runs on this machine." />
          {recentScans.length === 0 ? (
            <div className="text-xs text-slate-400 py-4 text-center">No scans recorded.</div>
          ) : (
            <ul className="space-y-2.5">
              {recentScans.map((s) => (
                <li key={s.id} className="flex items-start justify-between gap-3 pb-2.5 border-b border-slate-100 last:border-0 last:pb-0">
                  <div className="min-w-0">
                    <div className="text-xs text-slate-700">{s.started_at}</div>
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      Scan #{s.id} · {s.duration_ms} ms
                    </div>
                  </div>
                  <Badge tone="default">{s.findings_count} findings</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

function FindingCard({ f }) {
  const name = f.product || f.payload?.appId || f.payload?.serverName || f.payload?.runtime || f.payload?.path || '(unnamed)';
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Tag>{f.type}</Tag>
            <span className="font-medium text-slate-900 text-sm truncate">{name}</span>
          </div>
          {f.vendor && <div className="text-xs text-slate-500 mt-0.5">{f.vendor}</div>}
        </div>
        {f.provider && <span className="text-[11px] text-slate-500 whitespace-nowrap">{f.provider}</span>}
      </div>
      <details className="mt-2">
        <summary className="text-[11px] text-slate-500 cursor-pointer select-none hover:text-slate-700">view payload</summary>
        <pre className="text-[11px] bg-white border border-slate-200 rounded-md p-2 mt-1.5 overflow-x-auto font-mono text-slate-700">{JSON.stringify(f.payload, null, 2)}</pre>
      </details>
    </div>
  );
}

import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import {
  Card, PageHeader, SectionTitle, LoadingPage, ErrorBanner, SanctionPill,
  Button, Input, Badge, MonoText,
} from '../components/ui.jsx';
import { ChevronLeft } from '../components/Icons.jsx';

export default function ToolDetail({ toolKey }) {
  const [data, setData]     = useState(null);
  const [err, setErr]       = useState(null);
  const [status, setStatus] = useState('unknown');
  const [notes, setNotes]   = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.tool(toolKey)
      .then((d) => {
        setData(d);
        setStatus(d.tool.sanction || 'unknown');
        setNotes(d.tool.notes || '');
      })
      .catch((e) => setErr(e.message));
  }, [toolKey]);

  if (err) return <ErrorBanner msg={err} />;
  if (!data) return <LoadingPage />;

  const { tool, usages } = data;

  async function save() {
    setSaving(true);
    try {
      await api.setSanction(toolKey, { status, notes, vendor: tool.vendor, product: tool.product });
      const refreshed = await api.tool(toolKey);
      setData(refreshed);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <a href="#/tools" className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-900">
        <ChevronLeft size={14} /> Tools catalog
      </a>

      <PageHeader
        title={tool.product || tool.tool_key}
        subtitle={
          <span className="flex items-center gap-3 text-sm">
            <span className="text-slate-700">{tool.vendor || 'Unknown vendor'}</span>
            <span className="text-slate-300">·</span>
            <SanctionPill status={tool.sanction} />
            <span className="text-slate-300">·</span>
            <span className="text-xs text-slate-500">{tool.machines} machines · {tool.findings} findings</span>
          </span>
        }
      />

      <Card>
        <SectionTitle title="Sanctioning" hint="Set the policy for this tool. Notes are visible to other admins." />
        <div className="grid grid-cols-1 md:grid-cols-[160px_1fr_auto] gap-3 items-end">
          <label className="block">
            <span className="text-xs font-medium text-slate-600 mb-1.5 block">Status</span>
            <select
              className="h-9 w-full border border-slate-200 rounded-md text-sm bg-white px-3 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="unknown">unknown</option>
              <option value="approved">approved</option>
              <option value="restricted">restricted</option>
              <option value="blocked">blocked</option>
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-medium text-slate-600 mb-1.5 block">Notes</span>
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. enterprise license, DPA signed, restricted to engineering only"
            />
          </label>
          <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</Button>
        </div>
      </Card>

      <Card>
        <SectionTitle title="Where it's used" hint={`${usages.length} machine${usages.length === 1 ? '' : 's'} with evidence of this tool.`} />
        <div className="space-y-2.5">
          {usages.map((u) => (
            <div key={u.machine_id} className="rounded-lg border border-slate-200 p-3.5 hover:border-slate-300 transition-colors">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <a className="font-medium text-slate-900 hover:text-brand-700 truncate inline-block" href={`#/machines/${u.machine_id}`}>
                    {u.hostname || u.machine_id.slice(0, 12)}
                  </a>
                  <span className="text-xs text-slate-500 ml-2">{u.user}</span>
                </div>
                <Badge tone="default">{u.evidence?.length || 0} pieces of evidence</Badge>
              </div>
              <details className="mt-2">
                <summary className="text-[11px] text-slate-500 cursor-pointer select-none hover:text-slate-700">view evidence</summary>
                <div className="mt-2 space-y-1.5">
                  {(u.evidence || []).map((ev, i) => (
                    <div key={i} className="rounded-md bg-slate-50 border border-slate-200 p-2">
                      <div className="flex items-center gap-2 text-[11px]">
                        <MonoText>{ev.type}</MonoText>
                        <span className="text-slate-400">via {ev.detector}</span>
                      </div>
                      <pre className="text-[11px] mt-1 overflow-x-auto font-mono text-slate-700">{JSON.stringify(ev.payload, null, 2)}</pre>
                    </div>
                  ))}
                </div>
              </details>
            </div>
          ))}
          {usages.length === 0 && (
            <div className="text-sm text-slate-400 text-center py-6">No usage records.</div>
          )}
        </div>
      </Card>
    </div>
  );
}

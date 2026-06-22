import React from 'react';
import { SearchIcon, BellIcon, ChevronRight } from './Icons.jsx';

const TITLES = {
  overview:             'Overview',
  machines:             'Machines',
  tools:                'Tools catalog',
  agents:               'Agents & MCP',
  dlp:                  'AI activity',
  shadow:               'Shadow AI',
  'agent-governance':   'Agent Governance',
  'server-agents':      'Server agents',
  'ai-platforms':       'AI Platforms',
};

export default function Topbar({ view, param }) {
  const root = TITLES[view] || 'Overview';
  return (
    <header className="sticky top-0 z-10 h-14 bg-white/85 backdrop-blur border-b border-slate-200 flex items-center justify-between px-8">
      <div className="flex items-center gap-2 text-sm text-slate-500 min-w-0">
        <span className="text-slate-400">Governance</span>
        <ChevronRight size={14} />
        <a href={`#/${view}`} className="text-slate-900 font-medium truncate">{root}</a>
        {param && (
          <>
            <ChevronRight size={14} />
            <span className="text-slate-700 font-mono text-[12px] truncate max-w-[200px]">{param}</span>
          </>
        )}
      </div>

      <div className="flex items-center gap-2">
        <div className="hidden md:flex items-center gap-2 px-3 h-9 bg-slate-100 hover:bg-slate-200/70 rounded-md text-slate-500 text-xs cursor-pointer transition-colors min-w-[220px]">
          <SearchIcon size={14} />
          <span>Search machines, tools…</span>
          <kbd className="ml-auto text-[10px] bg-white border border-slate-200 rounded px-1.5 py-0.5 font-mono text-slate-500">⌘K</kbd>
        </div>
        <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-emerald-700 bg-emerald-50 ring-1 ring-inset ring-emerald-200 px-2 py-1 rounded-md">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
          Production
        </span>
        <button className="w-9 h-9 inline-flex items-center justify-center rounded-md text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors" title="Notifications">
          <BellIcon size={17} />
        </button>
      </div>
    </header>
  );
}

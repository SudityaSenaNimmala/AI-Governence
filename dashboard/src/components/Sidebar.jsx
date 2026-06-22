import React from 'react';
import {
  HomeIcon, MachineIcon, ToolsIcon, AgentIcon,
  ActivityIcon, ShieldIcon, ServerIcon, GovernanceIcon,
} from './Icons.jsx';

const NAV = [
  {
    section: 'Discover',
    items: [
      { id: 'overview', label: 'Overview',     Icon: HomeIcon },
      { id: 'machines', label: 'Machines',     Icon: MachineIcon },
      { id: 'tools',    label: 'Tools catalog', Icon: ToolsIcon },
    ],
  },
  {
    section: 'Monitor',
    items: [
      { id: 'agents',        label: 'Agents & MCP',  Icon: AgentIcon },
      { id: 'server-agents', label: 'Server agents', Icon: ServerIcon },
      { id: 'dlp',           label: 'AI activity',   Icon: ActivityIcon },
    ],
  },
  {
    section: 'Govern',
    items: [
      { id: 'ai-platforms',       label: 'AI Platforms',       Icon: ToolsIcon },
      { id: 'agent-governance',   label: 'Agent Governance',   Icon: GovernanceIcon },
    ],
  },
];

export default function Sidebar({ current }) {
  return (
    <aside className="w-60 bg-slate-950 text-slate-300 min-h-screen flex flex-col shrink-0">
      <div className="px-5 pt-5 pb-6 flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center text-white shadow-sm">
          <ShieldIcon size={18} />
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-widest text-slate-500 leading-none">CloudFuze</div>
          <div className="text-sm font-semibold text-white leading-tight mt-0.5">AI Governance</div>
        </div>
      </div>

      <nav className="flex-1 px-3 space-y-5 overflow-y-auto">
        {NAV.map((group) => (
          <div key={group.section}>
            <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 px-3 mb-1.5">
              {group.section}
            </div>
            <div className="space-y-0.5">
              {group.items.map((n) => {
                const active = current === n.id;
                return (
                  <a
                    key={n.id}
                    href={`#/${n.id}`}
                    className={
                      'flex items-center gap-3 px-3 py-2 rounded-md text-[13px] font-medium transition-colors ' +
                      (active
                        ? 'bg-brand-500/15 text-white ring-1 ring-inset ring-brand-500/30'
                        : 'text-slate-400 hover:bg-slate-900 hover:text-slate-100')
                    }
                  >
                    <n.Icon size={17} />
                    <span>{n.label}</span>
                  </a>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="px-5 py-4 border-t border-slate-800/70">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-slate-700 text-slate-200 flex items-center justify-center text-xs font-semibold uppercase">
            SP
          </div>
          <div className="min-w-0">
            <div className="text-xs font-semibold text-slate-200 truncate">Satya Pinniti</div>
            <div className="text-[10px] text-slate-500 truncate">CloudFuze · Admin</div>
          </div>
        </div>
        <div className="mt-3 text-[10px] text-slate-600">v0.1.0 · prototype</div>
      </div>
    </aside>
  );
}

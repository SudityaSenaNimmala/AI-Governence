import React from 'react';

export function Card({ className = '', children, padding = 'p-6' }) {
  return (
    <div className={`bg-white rounded-xl border border-slate-200 shadow-card ${padding} ${className}`}>
      {children}
    </div>
  );
}

export function SectionTitle({ title, hint, action }) {
  return (
    <div className="flex items-start justify-between gap-4 mb-4">
      <div>
        <h2 className="text-base font-semibold text-slate-900">{title}</h2>
        {hint && <p className="text-xs text-slate-500 mt-0.5">{hint}</p>}
      </div>
      {action}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions, breadcrumb }) {
  return (
    <header className="mb-6">
      {breadcrumb && <div className="mb-2 text-xs text-slate-500">{breadcrumb}</div>}
      <div className="flex items-start justify-between gap-6 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
          {subtitle && <p className="text-sm text-slate-500 mt-1 max-w-3xl leading-relaxed">{subtitle}</p>}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

const TONES = {
  default:  { dot: 'bg-slate-400',   bg: 'bg-slate-100',   text: 'text-slate-700',   ring: 'ring-slate-200' },
  success:  { dot: 'bg-emerald-500', bg: 'bg-emerald-50',  text: 'text-emerald-800', ring: 'ring-emerald-200' },
  warning:  { dot: 'bg-amber-500',   bg: 'bg-amber-50',    text: 'text-amber-800',   ring: 'ring-amber-200' },
  danger:   { dot: 'bg-rose-500',    bg: 'bg-rose-50',     text: 'text-rose-800',    ring: 'ring-rose-200' },
  info:     { dot: 'bg-sky-500',     bg: 'bg-sky-50',      text: 'text-sky-800',     ring: 'ring-sky-200' },
  brand:    { dot: 'bg-brand-500',   bg: 'bg-brand-50',    text: 'text-brand-700',   ring: 'ring-brand-200' },
  violet:   { dot: 'bg-violet-500',  bg: 'bg-violet-50',   text: 'text-violet-800',  ring: 'ring-violet-200' },
};

export function Badge({ tone = 'default', children, dot = false, mono = false }) {
  const t = TONES[tone] || TONES.default;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-medium ring-1 ring-inset ${t.bg} ${t.text} ${t.ring} ${mono ? 'font-mono' : ''}`}>
      {dot && <span className={`w-1.5 h-1.5 rounded-full ${t.dot}`} />}
      {children}
    </span>
  );
}

const SANCTION_TONE = {
  approved:   'success',
  restricted: 'warning',
  blocked:    'danger',
  unknown:    'default',
};

export function SanctionPill({ status = 'unknown' }) {
  return <Badge tone={SANCTION_TONE[status] || 'default'} dot>{status}</Badge>;
}

const SEVERITY_TONE = {
  critical: 'danger',
  high:     'danger',
  moderate: 'warning',
  low:      'default',
  none:     'default',
};

export function SeverityPill({ severity }) {
  if (severity === 'critical') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-semibold bg-rose-600 text-white ring-1 ring-inset ring-rose-700">
        <span className="w-1.5 h-1.5 rounded-full bg-white" />
        critical
      </span>
    );
  }
  return <Badge tone={SEVERITY_TONE[severity] || 'default'} dot>{severity || 'none'}</Badge>;
}

export function StatCard({ label, value, hint, tone = 'default', icon }) {
  const t = TONES[tone] || TONES.default;
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-card p-5 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="text-xs font-medium uppercase tracking-wider text-slate-500">{label}</div>
        <div className="text-3xl font-semibold text-slate-900 mt-1.5 tabular-nums">{value ?? 0}</div>
        {hint && <div className="text-xs text-slate-500 mt-1">{hint}</div>}
      </div>
      {icon && (
        <div className={`shrink-0 w-9 h-9 rounded-lg flex items-center justify-center ${t.bg} ${t.text}`}>
          {icon}
        </div>
      )}
    </div>
  );
}

export function Table({ columns, rows, emptyMessage = 'No data yet.', rowKey, getRowKey }) {
  const keyFn = getRowKey || ((r, i) => (rowKey ? r[rowKey] : i));
  return (
    <div className="overflow-x-auto -mx-6 px-6">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 border-b border-slate-200">
            {columns.map((c) => (
              <th
                key={c.key}
                className={`py-2.5 pr-4 font-semibold ${c.align === 'right' ? 'text-right pr-0' : ''} ${c.width || ''}`}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={columns.length} className="py-10 text-center text-sm text-slate-400">
                {emptyMessage}
              </td>
            </tr>
          )}
          {rows.map((r, i) => (
            <tr key={keyFn(r, i)} className="border-b border-slate-100 hover:bg-slate-50/70 transition-colors">
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={`py-3 pr-4 align-middle ${c.align === 'right' ? 'text-right pr-0 tabular-nums' : ''} ${c.cellClass || ''}`}
                >
                  {c.render ? c.render(r, i) : r[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function EmptyState({ title, message, icon }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-16 px-6">
      {icon && <div className="w-12 h-12 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center mb-3">{icon}</div>}
      <div className="text-sm font-semibold text-slate-700">{title}</div>
      {message && <div className="text-xs text-slate-500 mt-1 max-w-sm">{message}</div>}
    </div>
  );
}

export function Skeleton({ className = '' }) {
  return <div className={`animate-pulse rounded-md bg-slate-200/70 ${className}`} />;
}

export function LoadingPage() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-4 w-96" />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24" />)}
      </div>
      <Skeleton className="h-72" />
    </div>
  );
}

export function ErrorBanner({ msg }) {
  return (
    <div className="flex items-start gap-3 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl p-4">
      <svg className="w-5 h-5 shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
      <div>
        <div className="font-semibold text-sm">Something went wrong</div>
        <div className="text-xs mt-0.5 font-mono break-all">{msg}</div>
      </div>
    </div>
  );
}

export function IconButton({ children, href, onClick, title }) {
  const Comp = href ? 'a' : 'button';
  return (
    <Comp
      href={href}
      onClick={onClick}
      title={title}
      className="inline-flex items-center justify-center w-8 h-8 rounded-md text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors"
    >
      {children}
    </Comp>
  );
}

export function Button({ children, onClick, disabled, variant = 'primary', size = 'md', type = 'button' }) {
  const sizes = {
    sm: 'h-8 px-3 text-xs',
    md: 'h-9 px-4 text-sm',
  };
  const variants = {
    primary:   'bg-brand-600 hover:bg-brand-700 text-white shadow-sm',
    secondary: 'bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 shadow-sm',
    ghost:     'text-slate-600 hover:text-slate-900 hover:bg-slate-100',
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${sizes[size]} ${variants[variant]}`}
    >
      {children}
    </button>
  );
}

export function Input({ value, onChange, placeholder, icon, type = 'text' }) {
  return (
    <div className="relative">
      {icon && (
        <span className="absolute inset-y-0 left-3 flex items-center text-slate-400 pointer-events-none">
          {icon}
        </span>
      )}
      <input
        type={type}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        className={`h-9 w-full border border-slate-200 rounded-md text-sm bg-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500 transition ${icon ? 'pl-9 pr-3' : 'px-3'}`}
      />
    </div>
  );
}

export function Tag({ children }) {
  return (
    <span className="inline-flex items-center text-[11px] font-medium bg-slate-100 text-slate-700 rounded-md px-1.5 py-0.5 ring-1 ring-inset ring-slate-200">
      {children}
    </span>
  );
}

export function MonoText({ children, className = '' }) {
  return <span className={`font-mono text-[12px] text-slate-600 ${className}`}>{children}</span>;
}

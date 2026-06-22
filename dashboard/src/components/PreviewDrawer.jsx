import React, { useEffect, useState } from 'react';
import { Badge, Tag, MonoText } from './ui.jsx';

// Side drawer that fetches and renders the captured content for a single
// dlp_event. Decides how to render based on the response's Content-Type.
//   - text/*           → highlighted text block
//   - image/*          → <img>
//   - application/pdf  → <iframe>
//   - everything else  → download link
export default function PreviewDrawer({ eventId, eventMeta, onClose }) {
  const [state, setState] = useState({ status: 'loading' });
  const [objectUrl, setObjectUrl] = useState(null);

  useEffect(() => {
    let cancelled = false;
    let revokeUrl = null;
    async function load() {
      setState({ status: 'loading' });
      try {
        const res = await fetch(`/api/v1/dlp/${eventId}/content`);
        if (!res.ok) {
          const body = await res.text().catch(() => '');
          setState({ status: 'error', error: `${res.status}: ${body || res.statusText}` });
          return;
        }
        const contentType = res.headers.get('content-type') || '';
        const truncated = res.headers.get('x-content-truncated') === '1';
        if (contentType.startsWith('text/')) {
          const text = await res.text();
          if (cancelled) return;
          setState({ status: 'ok', kind: 'text', contentType, text, truncated });
        } else {
          const blob = await res.blob();
          if (cancelled) return;
          const url = URL.createObjectURL(blob);
          revokeUrl = url;
          setObjectUrl(url);
          setState({ status: 'ok', kind: classifyKind(contentType), contentType, blob, truncated });
        }
      } catch (err) {
        if (!cancelled) setState({ status: 'error', error: err?.message || String(err) });
      }
    }
    load();
    return () => {
      cancelled = true;
      if (revokeUrl) URL.revokeObjectURL(revokeUrl);
    };
  }, [eventId]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const filename = eventMeta?.metadata?.filename;
  const title = filename || (eventMeta?.event_kind?.includes('prompt') ? 'Prompt content' : 'Captured content');
  const subtitle = eventMeta?.ai_service
    ? `${eventMeta.ai_service} · ${eventMeta.event_kind} · ${eventMeta.occurred_at}`
    : eventMeta?.event_kind;

  return (
    <div className="fixed inset-0 z-40 flex justify-end" aria-modal="true" role="dialog">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} />
      <aside className="relative w-full max-w-2xl bg-white shadow-pop h-full flex flex-col">
        <header className="flex items-start justify-between gap-4 px-6 py-4 border-b border-slate-200">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-slate-900 truncate">{title}</h2>
            {subtitle && <p className="text-xs text-slate-500 mt-0.5 truncate">{subtitle}</p>}
            <div className="flex items-center gap-2 mt-2">
              {eventMeta?.source && <Badge tone="info">{eventMeta.source}</Badge>}
              {eventMeta?.secret_class && <Badge tone={eventMeta.secret_class === 'critical' ? 'danger' : eventMeta.secret_class === 'high' ? 'danger' : 'warning'}>{eventMeta.secret_class}</Badge>}
              {state.truncated && <Badge tone="warning">truncated</Badge>}
            </div>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 w-8 h-8 rounded-md text-slate-500 hover:text-slate-900 hover:bg-slate-100 inline-flex items-center justify-center"
            title="Close (Esc)"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </header>

        <div className="flex-1 overflow-auto">
          {state.status === 'loading' && (
            <div className="p-6 text-sm text-slate-400">Loading content…</div>
          )}
          {state.status === 'error' && (
            <div className="m-6 rounded-lg bg-rose-50 border border-rose-200 p-4">
              <div className="text-sm font-semibold text-rose-800">Couldn't load content</div>
              <div className="text-xs font-mono text-rose-700 mt-1 break-all">{state.error}</div>
              <p className="text-xs text-slate-500 mt-3">
                Older events captured before content storage was enabled won't have a preview available.
              </p>
            </div>
          )}
          {state.status === 'ok' && state.kind === 'text' && (
            <TextPreview text={state.text} matches={eventMeta?.metadata?.matches} contentType={state.contentType} />
          )}
          {state.status === 'ok' && state.kind === 'image' && (
            <div className="p-6 flex items-start justify-center bg-slate-50 min-h-full">
              <img src={objectUrl} alt={filename || ''} className="max-w-full rounded-md shadow-sm" />
            </div>
          )}
          {state.status === 'ok' && state.kind === 'pdf' && (
            <iframe src={objectUrl} title="PDF preview" className="w-full h-full border-0" />
          )}
          {state.status === 'ok' && state.kind === 'binary' && (
            <div className="p-6 flex flex-col items-center justify-center text-center text-sm">
              <div className="w-14 h-14 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center mb-3">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                </svg>
              </div>
              <div className="text-slate-700 font-medium">{filename || 'Binary file'}</div>
              <div className="text-xs text-slate-500 mt-1">{state.contentType || 'application/octet-stream'} · can't render inline</div>
              <a
                href={objectUrl}
                download={filename || 'download.bin'}
                className="mt-4 inline-flex items-center gap-2 px-4 h-9 rounded-md bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium"
              >
                Download file
              </a>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

function classifyKind(contentType) {
  if (contentType.startsWith('image/')) return 'image';
  if (contentType.startsWith('application/pdf')) return 'pdf';
  return 'binary';
}

// Renders text content with secret patterns highlighted. We don't have
// per-match offsets from the agent — we apply pattern regexes here on the
// already-stored text, which is fine because this view runs in the admin's
// browser, not in a multi-tenant context.
function TextPreview({ text, matches, contentType }) {
  // Convert agent-reported pattern names to a set; we still highlight via the
  // crude name match (e.g., look for "AKIA" anywhere). Good enough for visual
  // scan; admins can ⌘F for full search.
  const HIGHLIGHTS = [
    { name: 'openai-api-key',  re: /sk-[A-Za-z0-9]{20,}/g },
    { name: 'anthropic-api-key', re: /sk-ant-[A-Za-z0-9_\-]{20,}/g },
    { name: 'aws-access-key',  re: /AKIA[0-9A-Z]{16}/g },
    { name: 'github-pat',      re: /ghp_[A-Za-z0-9]{30,}/g },
    { name: 'us-ssn',          re: /\b\d{3}-\d{2}-\d{4}\b/g },
    { name: 'email',           re: /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g },
    { name: 'credit-card',     re: /\b(?:\d[ -]?){13,19}\d\b/g },
    { name: 'bearer-token',    re: /[Bb]earer\s+[A-Za-z0-9\-._~+/]+=*/g },
  ];

  // Build a list of [start, end, name] non-overlapping spans.
  const spans = [];
  for (const h of HIGHLIGHTS) {
    h.re.lastIndex = 0;
    let m;
    while ((m = h.re.exec(text)) !== null) {
      spans.push({ start: m.index, end: m.index + m[0].length, name: h.name });
      if (m.index === h.re.lastIndex) h.re.lastIndex++;
    }
  }
  spans.sort((a, b) => a.start - b.start);
  // Drop overlaps (first match wins).
  const merged = [];
  let cursor = -1;
  for (const s of spans) {
    if (s.start < cursor) continue;
    merged.push(s);
    cursor = s.end;
  }

  const parts = [];
  let idx = 0;
  for (const s of merged) {
    if (s.start > idx) parts.push({ text: text.slice(idx, s.start) });
    parts.push({ text: text.slice(s.start, s.end), match: s.name });
    idx = s.end;
  }
  if (idx < text.length) parts.push({ text: text.slice(idx) });

  return (
    <div className="px-6 py-5">
      {Array.isArray(matches) && matches.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-1.5">
          <span className="text-[11px] font-medium text-slate-500 mr-1 self-center">Matched:</span>
          {matches.map((m, i) => (
            <Badge key={i} tone="danger">{m.pattern}{m.count > 1 ? ` ×${m.count}` : ''}</Badge>
          ))}
        </div>
      )}
      <pre className="text-[12.5px] leading-relaxed font-mono text-slate-800 whitespace-pre-wrap break-words bg-slate-50 border border-slate-200 rounded-lg p-4">
        {parts.map((p, i) =>
          p.match ? (
            <mark
              key={i}
              title={p.match}
              className="bg-rose-100 text-rose-900 ring-1 ring-rose-300 rounded px-0.5 mx-px"
            >
              {p.text}
            </mark>
          ) : (
            <span key={i}>{p.text}</span>
          )
        )}
      </pre>
      <div className="mt-3 text-[11px] text-slate-400">
        {text.length.toLocaleString()} chars · {contentType}
      </div>
    </div>
  );
}

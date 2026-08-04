// SIEM export formatters — ArcSight CEF, QRadar LEEF, and RFC 5424 syslog framing.
//
// Turns CloudFuze governance records (DLP events, approval requests, policy
// violations, alerts) into the line formats a SIEM ingests, so decision +
// evidence records can flow into an external audit pipeline.
//
// A record is first normalized to a common event shape, then rendered.

const VENDOR = 'CloudFuze';
const PRODUCT = 'AI-Governance';
const VERSION = '0.1.0';

// low/moderate/high/critical → CEF/syslog numeric severity.
const SEV_CEF = { low: 3, moderate: 5, medium: 5, high: 7, critical: 10 };
export function sevToCef(sev) {
  if (typeof sev === 'number') return Math.max(0, Math.min(10, sev));
  return SEV_CEF[String(sev || '').toLowerCase()] ?? 4;
}

// ── Normalizers: collection row → common event ────────────────────────────────
// Common event: { sigId, name, severity(0-10), ts(Date|string), ext{ } }
// `ext` keys are CEF extension keys (dvchost, suser, app, rt, cs1, ...).

export function normalizeDlpEvent(r) {
  const meta = safe(r.metadata_json);
  const isBlock = r.event_kind === 'enforcement_block' || r.event_kind === 'enforcement_override';
  return {
    sigId: r.event_kind || 'dlp_event',
    name: isBlock
      ? (r.event_kind === 'enforcement_override' ? 'Sensitive data send overridden' : 'Sensitive data send blocked')
      : `DLP ${r.event_kind || 'event'}`,
    severity: sevToCef(r.secret_class),
    ts: r.occurred_at || r.received_at,
    ext: prune({
      externalId: r.id,
      dvchost: r.hostname || r.machine_id,
      suser: r.user || meta?.user || null,
      app: r.ai_service,
      dhost: meta?.tab_host || null,
      cs1Label: 'patterns', cs1: r.pattern_matched,
      cs2Label: 'secretClass', cs2: r.secret_class,
      cn1Label: 'contentLength', cn1: r.content_length,
      cs3Label: 'source', cs3: r.source,
    }),
  };
}

export function normalizeApproval(r) {
  return {
    sigId: `approval.${r.status || 'pending'}`,
    name: `Hold approval ${r.status || 'pending'}`,
    severity: r.status === 'denied' ? 7 : 4,
    ts: r.decided_at || r.requested_at,
    ext: prune({
      externalId: r.id,
      dvchost: r.machine_id,
      suser: r.user,
      app: r.ai_service,
      cs1Label: 'patterns', cs1: Array.isArray(r.patterns) ? r.patterns.join(',') : r.patterns,
      cs2Label: 'eventKind', cs2: r.event_kind,
      cs3Label: 'decidedBy', cs3: r.decided_by,
      cs4Label: 'expiresAt', cs4: iso(r.expires_at),
    }),
  };
}

export function normalizeViolation(r) {
  const done = Array.isArray(r.actions_executed)
    ? r.actions_executed.filter((a) => a.status === 'done').map((a) => a.type).join(',')
    : r.action_taken;
  return {
    sigId: 'policy.violation',
    name: `Policy violation: ${r.policy_name || r.policy_id || 'policy'}`,
    severity: sevToCef(r.details?.riskLevel || r.severity),
    ts: r.created_at,
    ext: prune({
      externalId: r.id,
      duser: r.agent_name,
      dvc: r.agent_id,
      cs1Label: 'condition', cs1: r.condition_triggered,
      cs2Label: 'actionsExecuted', cs2: done,
      cs3Label: 'platform', cs3: r.details?.platform,
      cn1Label: 'riskScore', cn1: r.details?.riskScore,
    }),
  };
}

export function normalizeAlert(r) {
  return {
    sigId: `alert.${r.alert_type || 'alert'}`,
    name: r.message || `Alert: ${r.alert_type || 'alert'}`,
    severity: sevToCef(r.severity),
    ts: r.created_at,
    ext: prune({
      externalId: r.id,
      duser: r.agent_name,
      dvc: r.agent_id,
      cs1Label: 'vendor', cs1: r.vendor,
      cs2Label: 'platform', cs2: r.platform,
      cs3Label: 'policy', cs3: r.policy_name,
      cs4Label: 'escalated', cs4: r.escalated ? 'true' : 'false',
      cs5Label: 'dueAt', cs5: iso(r.due_at),
    }),
  };
}

// ── Renderers ─────────────────────────────────────────────────────────────────

// ArcSight CEF:0|Vendor|Product|Version|SignatureID|Name|Severity|Extensions
export function toCEF(ev) {
  const header = [
    'CEF:0', VENDOR, PRODUCT, VERSION,
    cefHeader(ev.sigId), cefHeader(ev.name), String(ev.severity),
  ].join('|');
  const ext = { ...ev.ext };
  if (ev.ts) ext.rt = ms(ev.ts); // receipt time in epoch millis
  const kv = Object.entries(ext)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${cefExt(v)}`)
    .join(' ');
  return `${header}|${kv}`;
}

// QRadar LEEF 2.0 with tab-delimited attributes.
export function toLEEF(ev) {
  const header = ['LEEF:2.0', VENDOR, PRODUCT, VERSION, ev.sigId].join('|');
  const ext = { ...ev.ext, name: ev.name, sev: ev.severity };
  if (ev.ts) ext.devTime = iso(ev.ts);
  const attrs = Object.entries(ext)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${leefVal(v)}`)
    .join('\t');
  return `${header}|\t${attrs}`;
}

// Wrap a rendered line in an RFC 5424 syslog frame for a syslog collector.
// facility local0 (16); pri = facility*8 + severity(0-7).
export function toSyslog(line, ev, host = 'cloudfuze') {
  const sysSev = Math.min(7, Math.round((10 - (ev?.severity ?? 4)) * 0.7)); // higher CEF sev → lower syslog number
  const pri = 16 * 8 + sysSev;
  const ts = iso(ev?.ts) || new Date().toISOString();
  return `<${pri}>1 ${ts} ${host} ${PRODUCT} - ${ev?.sigId || '-'} - ${line}`;
}

export function render(ev, format) {
  if (format === 'leef') return toLEEF(ev);
  if (format === 'json') return JSON.stringify(ev);
  return toCEF(ev);
}

// ── escaping helpers ──────────────────────────────────────────────────────────
function cefHeader(s) { return String(s ?? '').replace(/\\/g, '\\\\').replace(/\|/g, '\\|'); }
function cefExt(s) { return String(s ?? '').replace(/\\/g, '\\\\').replace(/=/g, '\\=').replace(/\r?\n/g, '\\n'); }
function leefVal(s) { return String(s ?? '').replace(/\t/g, ' ').replace(/\r?\n/g, ' '); }

function safe(s) { if (s == null) return null; if (typeof s === 'object') return s; try { return JSON.parse(s); } catch { return null; } }
function prune(o) { const out = {}; for (const [k, v] of Object.entries(o)) if (v !== null && v !== undefined && v !== '') out[k] = v; return out; }
function iso(v) { if (!v) return null; try { return new Date(v).toISOString(); } catch { return null; } }
function ms(v) { try { return String(new Date(v).getTime()); } catch { return ''; } }

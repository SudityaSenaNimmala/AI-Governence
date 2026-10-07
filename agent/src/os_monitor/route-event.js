// The enforcer's {"kind":"route"} line -> the `model_routed` event fields the
// server accepts (server/src/routes/dlp.js routingMetaFields: an explicit
// allowlist of enums / bounded identifiers). Pure, so it is unit-tested.
//
// PRIVACY: everything here is an enum, a tier, a catalog label, a model id, a
// rule id or a length. The enforcer never puts prompt text on a route line and
// this mapping would not carry it if it did — only named fields are copied.

const TIERS = new Set(['economy', 'standard', 'premium']);
const EFFORTS = new Set(['low', 'medium', 'high']);
const PASS_THROUGH = new Set(['noop', 'unsupported', 'suggested', 'observed', 'user_override']);

/**
 * The enforcer's own result vocabulary -> the routing v2 result.
 *   ok                        -> applied
 *   failed / aborted / restored_not_sent -> failed
 *   sent_unrouted             -> failed (the switch did not happen), except a
 *                                route the helper found already on target at run
 *                                time, which is a noop
 *   noop / unsupported / suggested / observed / user_override -> as is
 */
export function routeResult(ev) {
  const r = String(ev?.result || '');
  if (r === 'ok') return 'applied';
  if (PASS_THROUGH.has(r)) return r;
  if (r === 'sent_unrouted' && String(ev?.reason || '').startsWith('already_on_target')) return 'noop';
  return 'failed';
}

const tier = (v) => (TIERS.has(v) ? v : null);
const effort = (v) => {
  const e = String(v || '').trim().toLowerCase();
  return EFFORTS.has(e) ? e : null;
};
const str = (v, max) => (typeof v === 'string' && v.length > 0 ? v.slice(0, max) : null);
// Stage timings (enforcer RouteTimingFields): integer ms, 0..60000, else dropped.
const STAGE_MS_MAX = 60_000;
const stageMs = (v) => (Number.isInteger(v) && v >= 0 && v <= STAGE_MS_MAX ? v : null);

/** The routing v2 fields for one route line. Absent values are omitted. */
export function modelRoutedFields(ev) {
  const browser = !!ev?.browser_host || ev?.surface === 'browser';
  const out = {
    mechanism: browser ? 'desktop_web_uia' : 'desktop_uia',
    surface: browser ? 'browser' : 'desktop_app',
    result: routeResult(ev),
  };
  const put = (k, v) => { if (v !== null && v !== undefined) out[k] = v; };
  put('host_or_app', str(ev?.host_or_app, 200) || str(ev?.browser_host, 200));
  put('provider', str(ev?.provider, 40));
  put('from_tier', tier(ev?.from_tier));
  put('from_label', str(ev?.from_label, 80));
  put('to_tier', tier(ev?.to_tier));
  put('to_label', str(ev?.to_label, 80));
  put('model', str(ev?.model, 120));
  put('complexity', ['simple', 'moderate', 'complex'].includes(ev?.complexity) ? ev.complexity : null);
  put('rule_id', str(ev?.rule_id, 64));
  put('reason', str(ev?.reason, 64));
  put('effort_from', effort(ev?.effort_from));
  put('effort_to', effort(ev?.effort_to));
  if (typeof ev?.len === 'number' && Number.isFinite(ev.len) && ev.len >= 0) out.len = ev.len;
  // Where a route's time went: Enter held -> switch verified -> Enter sent.
  put('t_switch_ms', stageMs(ev?.t_switch_ms));
  put('t_send_ms', stageMs(ev?.t_send_ms));
  put('t_total_ms', stageMs(ev?.t_total_ms));
  return out;
}

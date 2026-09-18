// Loads the REAL agent-block Request Access region out of content/content.js, so
// the popup rules are tested against shipped code rather than a paraphrase.
//
// WHY A SLICE AND NOT AN IMPORT. Same reason as the other load-*.mjs loaders:
// content.js is one classic-script IIFE that touches document/chrome/window at
// load time and cannot be evaluated whole in Node.
//
// The region's only free variables are the five injected below. If it grows a
// sixth, this loader throws a ReferenceError the moment a test calls it — which
// is the intended alarm, not a nuisance: the region is the thing that decides
// whether an admin-typed agent name (and nothing else) leaves the page.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const START = '// ── Agent-block Request Access ─';
const END = '// ── end agent-block Request Access ─';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(here, '..', 'content', 'content.js'), 'utf8');

function region() {
  const from = src.indexOf(START);
  const to = src.indexOf(END);
  if (from < 0) throw new Error(`content.js sentinel not found: ${START}`);
  if (to < 0) throw new Error(`content.js sentinel not found: ${END}`);
  if (to <= from) throw new Error('content.js agent-block sentinels are out of order');
  return src.slice(from, to);
}

/**
 * @param {object} deps
 *  - modalOpen: what existingCfaiModal() returns (truthy ⇒ a popup is already up)
 *  - features: { access_requests: boolean } — backs isFeatureOn()
 *  - hostname: location.hostname
 * @returns {{
 *   showBlockedAgentPopup: Function,
 *   agentBlockKey: Function,
 *   popups: object[],      // every showCfaiPopup() call's opts, in order
 *   warnings: object[],    // every showWarning() call, in order
 * }}
 */
export function loadAgentBlockRequest(deps = {}) {
  const popups = [];
  const warnings = [];
  const state = { modalOpen: !!deps.modalOpen };

  const showWarning = (matches, title) => { warnings.push({ matches, title }); };
  const existingCfaiModal = () => (state.modalOpen ? {} : null);
  const isFeatureOn = (key) => {
    const f = deps.features || {};
    return key in f ? !!f[key] : true;
  };
  const showCfaiPopup = (opts) => { popups.push(opts); };
  const location = { hostname: deps.hostname || 'teams.microsoft.com' };

  const body = region()
    + '\n  return { showBlockedAgentPopup, agentBlockKey };';
  // eslint-disable-next-line no-new-func
  const api = new Function(
    'showWarning', 'existingCfaiModal', 'isFeatureOn', 'showCfaiPopup', 'location',
    body,
  )(showWarning, existingCfaiModal, isFeatureOn, showCfaiPopup, location);

  return { ...api, popups, warnings, state };
}

/** A blocked-agents row exactly as GET /api/lifecycle/blocked-agents returns it. */
export function blockedRow(spec = {}) {
  return {
    agent_id: spec.agent_id === undefined ? 'agt-7f3c' : spec.agent_id,
    agent_name: spec.agent_name === undefined ? 'IT Help Desk Agent' : spec.agent_name,
    platform: spec.platform || 'copilot_studio',
    agent_scope: spec.agent_scope === undefined ? 'agent' : spec.agent_scope,
    reason: 'Blocked by admin',
  };
}

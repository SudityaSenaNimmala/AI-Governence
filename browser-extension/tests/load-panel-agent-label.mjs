// Loads the REAL panel agent-label reader out of content/content.js, plus the
// REAL isBlockedAgentActive() it feeds, so the tests exercise shipped code.
//
// WHY A SLICE AND NOT AN IMPORT. Same reason as every other load-*.mjs here:
// content.js is one classic-script IIFE that touches document/chrome/window at
// load time and cannot be evaluated whole in Node.
//
// WHY aiPanels() IS NOT STUBBED. The guarantee under test is "this reader only
// ever looks inside a panel the capture gate already resolved". Stubbing the
// panel resolver would test a paraphrase of that. So the fixture builds one fake
// DOM, hands it to loadSurfaceScope() for the SHIPPED aiPanels() and
// agentLabelSelectorsForHost(), and hands those to the reader region — the same
// wiring the shipped IIFE has, where all of it closes over one document.
//
// The reader region's free variables are the five injected below. If it grows a
// sixth — `document` above all — this loader throws a ReferenceError the moment a
// test calls it, which is the intended alarm.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { loadSurfaceScope } from './load-surface-scope.mjs';
import { el as baseEl, doc as baseDoc } from './load-blocked-agent-scope.mjs';

const START = '// ── panel agent-label reader ─';
const END = '// ── end panel agent-label reader ─';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(here, '..', 'content', 'content.js'), 'utf8');

export function contentSource() {
  return src;
}

export function readerRegion() {
  const from = src.indexOf(START);
  const to = src.indexOf(END);
  if (from < 0) throw new Error(`content.js sentinel not found: ${START}`);
  if (to < 0) throw new Error(`content.js sentinel not found: ${END}`);
  if (to <= from) throw new Error('content.js panel agent-label sentinels are out of order');
  return src.slice(from, to);
}

const NAME_START = '// ── blocked-agent name match ─';
const NAME_END = '// ── end blocked-agent name match ─';

/** The shipped name-matching rule both signals go through. Exported so a test
 *  can drive agentNameMatchesText() directly as well as through the decision. */
export function nameMatchRegion() {
  const from = src.indexOf(NAME_START);
  const to = src.indexOf(NAME_END);
  if (from < 0) throw new Error(`content.js sentinel not found: ${NAME_START}`);
  if (to <= from) throw new Error('content.js name-match sentinels are missing or out of order');
  return src.slice(from, to);
}

/** The shipped `function isBlockedAgentActive() { … }`, plus the host map and the
 *  name-matching rule it reads. */
function blockedAgentActiveRegion() {
  const hostsAt = src.indexOf('const PLATFORM_TO_HOSTS = {');
  const hostsEnd = src.indexOf('\n  };', hostsAt);
  const fnAt = src.indexOf('function isBlockedAgentActive() {');
  // The first close-brace at TWO spaces of indentation after the signature is the
  // function's own — everything nested inside it is indented deeper.
  const fnEnd = src.indexOf('\n  }', fnAt);
  if (hostsAt < 0 || hostsEnd < 0) throw new Error('content.js PLATFORM_TO_HOSTS not found');
  if (fnAt < 0 || fnEnd < 0) throw new Error('content.js isBlockedAgentActive not found');
  // The name-match region is a free-variable dependency of the function, not a
  // stub: a test that injected its own matcher would be testing a paraphrase of
  // the exact rule that decides whether a customer's document title blocks them.
  return src.slice(hostsAt, hostsEnd + 4) + '\n' + nameMatchRegion() + '\n' + src.slice(fnAt, fnEnd + 4);
}

/** agentNameMatchesText() / AGENT_NAME_MIN_LEN, straight out of shipped source. */
export function loadAgentNameMatch() {
  const body = nameMatchRegion() + '\n  return { agentNameMatchesText, AGENT_NAME_MIN_LEN };';
  // eslint-disable-next-line no-new-func
  return new Function(body)();
}

// ── Test doubles ────────────────────────────────────────────────────────────

/** An element that can carry text, which the base fake's el() has no notion of. */
export function el(spec = {}) {
  const node = baseEl(spec);
  if (spec.text != null) node.textContent = String(spec.text);
  return node;
}

export { baseDoc as doc };

/**
 * A MutationObserver stand-in that records what it was pointed at, so a test can
 * assert the observer is scoped to ONE panel rather than the document, and can
 * fire it on demand.
 */
export function observerHarness() {
  const observers = [];
  function MO(cb) {
    this.cb = cb;
    this.watching = [];
    observers.push(this);
  }
  MO.prototype.observe = function observe(target, options) {
    this.watching.push({ target, options });
  };
  MO.prototype.disconnect = function disconnect() { this.watching.length = 0; };

  return {
    MutationObserver: MO,
    observers,
    /** Every element any observer was pointed at. */
    targets: () => observers.flatMap((o) => o.watching.map((w) => w.target)),
    /** Simulate a DOM change inside `target`. */
    fire(target) {
      for (const o of observers) {
        if (o.watching.some((w) => w.target === target)) o.cb([], o);
      }
    },
  };
}

/**
 * Instantiate the reader as if content.js had just been injected into `host`.
 *
 * @param {object} opts
 *  - host:     window.location.hostname
 *  - document: a doc() from this module
 *  - synced:   the /api/v1/ai-surfaces mirror, as chrome.storage holds it
 *  - flagOn:   whether m365_agent_label_reader is enabled (DEFAULT false —
 *              matching the shipped opt-in default, which is the point)
 *  - noMutationObserver: drop MutationObserver entirely, as an old runtime would
 * @returns {{ getPanelAgentLabel:Function, openPanelAgentLabels:Function, … }}
 */
export function loadPanelAgentLabel(opts = {}) {
  const document = opts.document || baseDoc([]);
  const host = opts.host || 'teams.microsoft.com';
  const scope = loadSurfaceScope(host, document, opts.synced);
  const mo = observerHarness();
  const flagKeys = [];

  const body = readerRegion()
    + '\n  return { getPanelAgentLabel, openPanelAgentLabels, AGENT_LABEL_MAX_LEN };';
  // eslint-disable-next-line no-new-func
  const api = new Function(
    'MutationObserver', 'isOptInFeatureOn', 'FEATURE_M365_AGENT_LABEL_READER',
    'agentLabelSelectorsForHost', 'location', 'aiPanels',
    body,
  )(
    opts.noMutationObserver ? undefined : mo.MutationObserver,
    (key) => { flagKeys.push(key); return opts.flagOn === true; },
    'm365_agent_label_reader',
    scope.agentLabelSelectorsForHost,
    { hostname: host },
    scope.aiPanels,
  );

  return {
    ...api,
    document,
    observers: mo,
    flagKeys,
    aiPanels: scope.aiPanels,
    captureAllowed: scope.captureAllowed,
    agentLabelSelectorsForHost: scope.agentLabelSelectorsForHost,
  };
}

/**
 * The shipped isBlockedAgentActive(), driven with an injected header read and an
 * injected panel read — so the OR between the two signals is tested as shipped.
 *
 * @param {object} opts
 *  - host, blockedList, headerText (string), panelLabels (string[] or function)
 */
export function loadBlockedAgentActive(opts = {}) {
  const calls = { header: 0, panel: 0 };
  const body = blockedAgentActiveRegion() + '\n  return { isBlockedAgentActive };';
  // eslint-disable-next-line no-new-func
  const api = new Function(
    '_blockedList', 'location', 'getHeaderAgentText', 'openPanelAgentLabels',
    body,
  )(
    opts.blockedList || [],
    { hostname: opts.host || 'teams.microsoft.com' },
    () => { calls.header += 1; return String(opts.headerText || '').toLowerCase(); },
    () => {
      calls.panel += 1;
      const p = typeof opts.panelLabels === 'function' ? opts.panelLabels() : opts.panelLabels;
      return (p || []).map((s) => String(s).toLowerCase());
    },
  );
  return { ...api, calls };
}

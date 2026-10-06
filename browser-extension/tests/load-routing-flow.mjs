// Loads the REAL model-routing state machine out of content/content.js — the
// region between '// ── Model routing — shared decideRoute' and
// '// ── end model routing ─' — and runs it against the REAL shared bundle
// (content/model-routing.js) and the REAL classifier (content/complexity.js).
//
// WHY A SLICE. Same reason as every other loader here: content.js is one
// classic-script IIFE that touches document/chrome/window at load and cannot be
// evaluated whole in Node. This region's free variables are handed in
// explicitly below, so a new dependency shows up as a ReferenceError here rather
// than as a silently-mocked behaviour.
//
// The fake picker is deliberately dumb: changeModelInUI(label) asks the test's
// `onSwitch(label)` what the button should read afterwards (or null = the click
// did nothing). Success is judged by the region reading the tier BACK, which is
// exactly the property under test.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadComplexity } from './load-complexity.mjs';

const START = '// ── Model routing — shared decideRoute';
const END = '// ── end model routing ─';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(here, '..', 'content', 'content.js'), 'utf8');
const bundleSrc = readFileSync(path.join(here, '..', 'content', 'model-routing.js'), 'utf8');
const { classify } = loadComplexity();

function region() {
  const from = src.indexOf(START);
  const to = src.indexOf(END);
  if (from < 0) throw new Error(`content.js sentinel not found: ${START}`);
  if (to < 0) throw new Error(`content.js sentinel not found: ${END}`);
  if (to <= from) throw new Error('content.js model-routing sentinels are out of order');
  return src.slice(from, to);
}

function loadBundle() {
  const win = {};
  // eslint-disable-next-line no-new-func
  new Function('window', bundleSrc)(win);
  return win.__cfaiRouting;
}

const tick = () => new Promise((r) => setTimeout(r, 0));

/** Return this from `onSwitch` to simulate an unconfirmable "Switch model?" dialog. */
export const CONFIRM_DECLINED = Symbol('confirm_declined');

/**
 * @param {object} o
 * @param {string} o.host
 * @param {string} o.pathname
 * @param {string} o.buttonText        what the picker button reads now
 * @param {(label:string)=>string|null} o.onSwitch  new button text after clicking `label`, or null
 * @param {object} [o.store]           shared chrome.storage.local contents (pass the same object to share)
 * @param {boolean} [o.featureOn]
 * @param {object} [o.effortMenu]      { levels: { High:'Opus 5 High', ... } } — enables the Effort submenu fake
 */
export function loadRoutingFlow(o) {
  const env = {
    events: [],
    toasts: [],
    switchCalls: [],
    resent: [],
    focusCalls: [],
    paused: 0,
    store: o.store || {},
    storageListeners: [],
    location: { hostname: o.host, pathname: o.pathname || '/' },
    button: { textContent: o.buttonText, click() { env.menuState = 'root'; } },
    menuState: null,
  };

  const chrome = {
    storage: {
      local: {
        get(keys, cb) {
          const out = {};
          for (const k of (Array.isArray(keys) ? keys : [keys])) if (k in env.store) out[k] = env.store[k];
          cb(out);
        },
        set(obj) { Object.assign(env.store, obj); },
      },
      onChanged: { addListener(fn) { env.storageListeners.push(fn); } },
    },
  };

  // Effort submenu fake (claude.ai shape: 'Effort <Level>' item opens Low/Medium/High).
  const item = (text, onClick) => ({ textContent: text, children: [], click: onClick });
  const menu = {
    querySelectorAll() {
      if (env.menuState === 'root') {
        const cur = (env.button.textContent.split(/\s+/).pop() || '');
        return [
          item('Opus 5 For complex tasks', () => {}),
          item('Effort ' + cur, () => { env.menuState = 'effort'; }),
        ];
      }
      if (env.menuState === 'effort' && o.effortMenu) {
        return Object.keys(o.effortMenu.levels).map((lvl) => item(lvl, () => {
          env.button.textContent = o.effortMenu.levels[lvl];
          env.menuState = null;
        }));
      }
      return [];
    },
  };
  const document = {
    querySelectorAll(sel) { return sel === 'MENU' && env.menuState ? [menu] : []; },
    dispatchEvent() { env.menuState = null; },
  };

  const deps = {
    window: { __cfaiRouting: loadBundle() },
    chrome,
    location: env.location,
    clog: () => {},
    getModelButton: () => env.button,
    currentConvId: () => {
      const m = /\/chat\/([\w-]+)/.exec(env.location.pathname);
      return m ? m[1] : null;
    },
    classifyComplexity: (t) => classify(t),
    isFeatureOn: () => o.featureOn !== false,
    emit: (ev) => env.events.push(ev),
    changeModelInUI: async (label) => {
      env.switchCalls.push(label);
      const next = o.onSwitch ? o.onSwitch(label) : null;
      // The real changeModelInUI's answer when Claude's "Switch model?" dialog
      // could not be confirmed (and was dismissed): nothing changed.
      if (next === CONFIRM_DECLINED) return 'confirm_declined';
      if (next) env.button.textContent = next;
      return !!next;
    },
    MENU_CONTAINER_SELECTOR: 'MENU',
    isVisibleEl: () => true,
    waitForEl: async (get) => {
      for (let i = 0; i < 5; i++) { const v = get(); if (v) return v; await tick(); }
      return null;
    },
    showRoutingToast: (...a) => env.toasts.push(a),
    findActivePromptInput: () => null,
    document,
    KeyboardEvent: class { constructor(type, init) { this.type = type; Object.assign(this, init); } },
    setInterval: () => 0,                         // the poller is driven by hand: observePicker()
    setTimeout: (fn) => setTimeout(fn, 0),        // collapse the 200/400/500 ms waits
  };

  const names = Object.keys(deps);
  const body = `const { ${names.join(', ')} } = arguments[0];\n`
    + 'let _modelBtnCache = null;\nlet _skipRouting = false;\n'
    + region()
    + `\nreturn {
      routeDecisionFor, applyRouteDecision, observePicker, readPickerState,
      state: () => ({ overrideConvs: _overrideConvs, userChoice: _routingUserChoice,
        lastRoute: _routingLastRoute, routeExpect: _routeExpect, policy: routingPolicy() }),
      setStorage: (r) => applyRoutingStorage(r),
    };`;
  // eslint-disable-next-line no-new-func
  const api = new Function(body)(deps);

  /** One send: decide + act, exactly as tryBlock's routing block does. */
  api.send = (text) => {
    const r = api.routeDecisionFor(text);
    const e = {
      preventDefault() { env.paused++; },
      stopImmediatePropagation() {},
      stopPropagation() {},
    };
    // `focusCalls` records the order: focus() must land BEFORE the re-sent Enter.
    const el = { isConnected: true, focus: () => env.focusCalls.push(env.resent.length), dispatchEvent: (ev) => env.resent.push(ev) };
    const paused = r ? api.applyRouteDecision(r, text, e, el) : false;
    return { r, paused };
  };
  api.settle = async () => { for (let i = 0; i < 40; i++) await tick(); };
  api.env = env;
  return api;
}

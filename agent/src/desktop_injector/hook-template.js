// Hook template — the JS that gets injected into an Electron AI app.
//
// The injector substitutes the __CFAI_*__ placeholders with the real values
// at injection time, then writes this script into the app's asar bundle.
// Inside the app, the bootstrap (cfai-bootstrap.js) requires this module and
// attaches its listeners to every BrowserWindow's renderer.
//
// We export a single function `installHook(app, BrowserWindow)` that registers
// a webContents listener; whenever a new window finishes loading, we inject
// the renderer-side scanner via executeJavaScript.
//
// The renderer-side scanner lives in a separate file (`hook-renderer.js`) so
// it can be written with normal single-level JS escaping. We read it at
// module-load time and embed it into HOOK_SOURCE via JSON.stringify, which
// produces a properly-escaped JS string literal in the rendered cfai-hook.js.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RENDERER_SCANNER_SRC = readFileSync(join(__dirname, 'hook-renderer.js'), 'utf8');

export const HOOK_SOURCE = `
"use strict";

// =====================================================================
// CloudFuze AI Governance — desktop hook (v__CFAI_HOOK_VERSION__)
// Injected into __CFAI_APP_ID__ at __CFAI_INJECTED_AT__.
// =====================================================================

const CFAI_SERVER_URL = "__CFAI_SERVER_URL__";
const CFAI_TOKEN      = "__CFAI_TOKEN__";
const CFAI_APP_ID     = "__CFAI_APP_ID__";
const CFAI_PRODUCT    = "__CFAI_PRODUCT__";

const { app, BrowserWindow, Notification } = require('electron');

// ---- Native OS notification on critical detection ----
// Electron's Notification API maps to Windows action center / macOS notification center /
// Linux notify-osd. Visible even if the AI app is minimized or another window is focused.
function showNativeWarning(title, body) {
  try {
    if (!Notification.isSupported()) return;
    new Notification({
      title: '⚠ CloudFuze AI Governance',
      subtitle: title,
      body,
      urgency: 'critical',
      silent: false,
    }).show();
  } catch (e) {
    try { console.warn('[cfai] native notification failed:', e?.message || e); } catch {}
  }
}

// The renderer-side scanner. Loaded from hook-renderer.js at module-load time
// and embedded here as a properly-escaped JS string literal. The Electron
// main process runs \`(\${RENDERER_SCANNER})()\` in every renderer via
// executeJavaScript.
//
// Design mirrors the browser-extension enforcement layer:
//   - intercept on SEND (Enter / send-button click / mousedown / pointerdown / form submit)
//   - never mutate the host app's DOM (no button-disabling, no banner injection,
//     no rescan on every keystroke) — that fights the host app's React render
//     loop and can lock up the renderer
//   - on block, show a CENTERED modal popup explaining why, appended to <html>
//     (not <body>) with max z-index so the host page's React tree can't tear
//     it down
//   - Ctrl+Alt+Enter = logged override
const RENDERER_SCANNER = ${JSON.stringify(RENDERER_SCANNER_SRC)};

// ===== Main-process side =====

const eventQueue = [];
async function flushQueue() {
  if (eventQueue.length === 0) return;
  const batch = eventQueue.splice(0, 50);
  try {
    const res = await fetch(CFAI_SERVER_URL + '/api/v1/dlp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'authorization': 'Bearer ' + CFAI_TOKEN },
      body: JSON.stringify({ events: batch.map((e) => ({ ...e, occurredAt: new Date().toISOString(), service: CFAI_PRODUCT, source: 'desktop_hook' })) }),
    });
    if (!res.ok) {
      // Put events back at front of queue, try again next tick
      eventQueue.unshift(...batch);
    }
  } catch {
    eventQueue.unshift(...batch);
  }
}
setInterval(flushQueue, 60_000);

// IPC: each renderer pushes events into window.__cfaiRendererQueue. The main
// process polls every 2s via executeJavaScript to drain the queue.
function installInWindow(win) {
  win.webContents.on('did-finish-load', () => {
    win.webContents.executeJavaScript('(' + RENDERER_SCANNER + ')();').catch(() => {});
    pollRendererQueue(win);
  });
}

function pollRendererQueue(win) {
  const poll = async () => {
    try {
      if (win.isDestroyed()) return;
      const events = await win.webContents.executeJavaScript(
        '(() => { const q = window.__cfaiRendererQueue || []; window.__cfaiRendererQueue = []; return q; })();',
        true
      );
      if (Array.isArray(events) && events.length > 0) {
        eventQueue.push(...events);

        // Fire a native OS notification for any critical/high-severity event,
        // so the user sees it even with the app minimized.
        for (const ev of events) {
          const sev = ev.highest_severity || ev.severity;
          if (sev === 'critical' || sev === 'high') {
            // For prompts the matches are top-level; for file uploads they
            // live inside content_scan. Fall back to filename/file_class if
            // no content matches (e.g. .env file with empty content scan).
            const matchSource = ev.kind === 'file_upload' ? (ev.content_scan?.matches || []) : (ev.matches || []);
            const patterns = matchSource.map((m) => m.pattern + (m.count > 1 ? '×' + m.count : '')).join(', ');
            const what =
              ev.kind === 'enforcement_block'
                ? ('Send blocked — ' + (patterns || ev.filename || 'sensitive data'))
                : ev.kind === 'enforcement_override'
                ? ('Send override — ' + (patterns || 'sensitive data'))
                : ev.kind === 'file_upload'
                ? ('File: ' + (ev.filename || 'unknown') + (patterns ? ' — contains: ' + patterns : ' — class: ' + (ev.file_class || 'unknown')))
                : ev.kind === 'prompt_paste'   ? ('Paste detected — ' + (patterns || 'sensitive data'))
                : ev.kind === 'prompt_submit'  ? ('Prompt submit — ' + (patterns || 'sensitive data'))
                : ('Event: ' + ev.kind);
            showNativeWarning(
              CFAI_PRODUCT + ' → ' + sev.toUpperCase(),
              what + '\\nReported to CloudFuze governance.'
            );
          }
        }

        flushQueue();
      }
    } catch {}
    setTimeout(poll, 2000);
  };
  poll();
}

export function installHook() {
  app.on('browser-window-created', (_event, win) => installInWindow(win));
  // Apps may create windows before this module loads — handle existing ones too.
  for (const win of BrowserWindow.getAllWindows()) installInWindow(win);

  // Send a heartbeat to the governance server announcing we're alive.
  fetch(CFAI_SERVER_URL + '/api/v1/dlp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'authorization': 'Bearer ' + CFAI_TOKEN },
    body: JSON.stringify({
      events: [{
        kind: 'desktop_hook_heartbeat',
        service: CFAI_PRODUCT,
        source: 'desktop_hook',
        occurredAt: new Date().toISOString(),
        appId: CFAI_APP_ID,
      }],
    }),
  }).catch(() => {});
}
`;

// Bootstrap: tiny wrapper that requires the original main, then activates our hook.
export const BOOTSTRAP_SOURCE = `
// CloudFuze AI Governance — desktop hook bootstrap
// Loads the original main, then activates the renderer scanner injector.
try {
  const { installHook } = require('./cfai-hook.js');
  installHook();
} catch (e) {
  // Never block the host app from booting — log + continue
  try { console.warn('[cfai] hook init failed:', e?.message || e); } catch {}
}

// Fall through to the original entry point
require('./__CFAI_ORIGINAL_MAIN__');
`;

// Apply substitutions and return ready-to-write source for the two injected files.
export function renderHookFiles({ serverUrl, token, appId, product, hookVersion, originalMain }) {
  const subs = {
    __CFAI_SERVER_URL__: serverUrl,
    __CFAI_TOKEN__: token,
    __CFAI_APP_ID__: appId,
    __CFAI_PRODUCT__: product,
    __CFAI_HOOK_VERSION__: hookVersion,
    __CFAI_INJECTED_AT__: new Date().toISOString(),
    __CFAI_ORIGINAL_MAIN__: originalMain,
  };
  let hook = HOOK_SOURCE;
  let boot = BOOTSTRAP_SOURCE;
  for (const [k, v] of Object.entries(subs)) {
    hook = hook.split(k).join(v);
    boot = boot.split(k).join(v);
  }
  // The hook script is ESM in our source for readability; convert to CommonJS
  // since Electron apps' main process is CJS.
  hook = hook.replace(/^export function installHook/m, 'function installHook')
             .replace(/^export const HOOK_SOURCE/m, 'const HOOK_SOURCE')
             .replace(/^export const /gm, 'const ')
             + '\nmodule.exports = { installHook };\n';
  return { hookJs: hook, bootstrapJs: boot };
}

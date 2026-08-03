// Isolation container for rrweb replay.
//
// ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
// A replay is a reconstruction of the DOM of chatgpt.com / claude.ai / etc. The
// recorder runs with inlineImages:false, so the captured DOM still REFERENCES
// external assets by URL (images, fonts, stylesheets, iframes). If those events
// are handed straight to rrweb in the dashboard's own document, the browser of
// the admin reviewing the replay will happily fetch them — which means:
//
//   1. The AI vendor is told, live, that someone at this company is reviewing AI
//      usage right now (with the reviewer's IP, and their cookies for that
//      vendor if the asset host is cookie-bearing).
//   2. The replay renders TODAY's version of an asset inside a recording of
//      something that happened weeks ago — a forensic integrity problem.
//
// So the replay must render behind a Content-Security-Policy that permits no
// outbound subresource at all. Two independent controls do that; this file is
// the container half, replaySanitize.js is the event half. Neither is trusted
// to be sufficient on its own.
//
// ── HOW THE CSP IS DELIVERED ────────────────────────────────────────────────
// rrweb's Replayer builds its own iframe via createSandboxedIframe(), which
// force-sets sandbox="allow-same-origin" and deliberately ignores any caller
// supplied `sandbox` attribute; there is no config hook for a CSP. That inner
// iframe is an about:blank document, and an about:blank document INHERITS the
// policy container of the document that created it.
//
// That inheritance is the lever. rrweb creates the inner iframe from
// `config.root.ownerDocument`, and rrweb-player's root div is a normal element —
// so if the player's DOM subtree lives inside an iframe WE authored, rrweb's
// inner replay document inherits OUR policy.
//
// The wrapper is therefore a srcdoc iframe whose <head> opens with a
// <meta http-equiv="Content-Security-Policy">. Because that meta is present in
// the initial markup the parser sees, it is authoritative — unlike a meta
// injected into an already-parsed document, which the spec permits a browser to
// ignore.
//
// rrweb-player's own JavaScript still executes in the PARENT realm (it is part
// of this bundle); only its rendered DOM lives in the wrapper. That is why the
// wrapper's CSP can be script-src 'none' without breaking the controls, and why
// the player's stylesheet has to be inlined into the wrapper document — a
// stylesheet loaded in the parent document does not style nodes in a child
// document.
//
// ── FALLBACK ───────────────────────────────────────────────────────────────
// Mounting a component across documents is legal but not something rrweb-player
// advertises. If the wrapper cannot be created or does not become scriptable,
// createReplayHost() degrades to mounting in the parent document and reports
// hardened:false, so the caller can show the reviewer an explicit warning
// instead of quietly dropping an isolation guarantee. In that mode the event
// sanitiser is still in force, and applyReplayIframeCsp() below adds a
// best-effort CSP to rrweb's inner iframe.

// Locked down to the point where nothing can leave the machine:
//   - default-src 'none' is the backstop for every directive not named.
//   - style-src 'unsafe-inline' is required: rrweb rebuilds captured CSS as
//     inline <style> text, and Replayer.insertStyleRules() injects more.
//   - img/font/media are pinned to data: so assets the recorder DID inline
//     (rr_dataURL, inlined fonts) still render, while every http(s) URL fails.
//   - frame-src allows only local schemes + our own origin, which is what
//     rrweb's nested-iframe replay creates. A recorded <iframe src> pointing at
//     a vendor is blocked (and stripped by the sanitiser as well).
//   - connect-src 'none' kills fetch/XHR/beacon/WebSocket from replayed code.
export const REPLAY_CSP = [
  "default-src 'none'",
  "script-src 'none'",
  "style-src 'unsafe-inline'",
  "img-src data:",
  "font-src data:",
  "media-src data:",
  "connect-src 'none'",
  "object-src 'none'",
  "worker-src 'none'",
  "manifest-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "frame-src 'self' blob: data:",
].join("; ");

const CSP_META = `<meta http-equiv="Content-Security-Policy" content="${REPLAY_CSP}">`;
const PARENT_CSS_ID = "cf_rrweb_player_css";

// The wrapper document. The CSP meta is the first thing in <head> on purpose:
// anything above it would be fetched before the policy applied.
function hostMarkup(playerCss) {
  return `<!doctype html><html><head>${CSP_META}`
    + `<meta name="referrer" content="no-referrer">`
    + `<style>html,body{margin:0;padding:0;background:#111827;overflow:hidden;}`
    + `#cf_replay_mount{width:100%;}`
    + `${playerCss || ""}</style>`
    + `</head><body><div id="cf_replay_mount"></div></body></html>`;
}

// Fallback path only: the player's stylesheet has to exist in the parent
// document because that is where its DOM ends up. Added once per page.
function ensureParentPlayerCss(playerCss) {
  if (!playerCss || document.getElementById(PARENT_CSS_ID)) return;
  const style = document.createElement("style");
  style.id = PARENT_CSS_ID;
  style.textContent = playerCss;
  document.head.appendChild(style);
}

function makeFallbackHost(container, playerCss) {
  ensureParentPlayerCss(playerCss);
  const mount = document.createElement("div");
  mount.className = "aihub_replay_mount";
  container.appendChild(mount);
  return {
    hardened: false,
    mount,
    frame: null,
    setHeight(px) { mount.style.minHeight = `${px}px`; },
    destroy() { mount.remove(); },
  };
}

/**
 * Creates the container rrweb-player should be mounted into.
 *
 * Resolves with { hardened, mount, frame, setHeight, destroy }. `hardened` is
 * false when the CSP wrapper could not be established — the caller MUST surface
 * that to the reviewer rather than treat the two paths as equivalent.
 *
 * @param {HTMLElement} container element the host is appended to
 * @param {string} playerCss     rrweb-player's stylesheet text, inlined into the wrapper
 * @param {number} timeoutMs     how long to wait for the wrapper to become scriptable
 */
export function createReplayHost(container, playerCss, timeoutMs = 4000) {
  return new Promise((resolve) => {
    if (!container) { resolve(null); return; }
    let settled = false;
    const finish = (host) => { if (!settled) { settled = true; resolve(host); } };

    let frame;
    try {
      frame = document.createElement("iframe");
    } catch {
      finish(makeFallbackHost(container, playerCss));
      return;
    }
    // allow-same-origin: required, or contentDocument is opaque and nothing can
    // be mounted at all. allow-scripts: rrweb-player attaches listeners to the
    // controls it renders in here; without it those interactions are unreliable
    // in some engines. Neither weakens the CSP, which is the real control — and
    // the wrapper document ships no script of its own (script-src 'none').
    frame.setAttribute("sandbox", "allow-same-origin allow-scripts");
    frame.setAttribute("referrerpolicy", "no-referrer");
    frame.setAttribute("title", "Session replay (isolated container)");
    frame.className = "aihub_replay_host";

    const onLoad = () => {
      try {
        const doc = frame.contentDocument;
        const mount = doc && doc.getElementById("cf_replay_mount");
        if (!doc || !mount) { frame.remove(); finish(makeFallbackHost(container, playerCss)); return; }
        finish({
          hardened: true,
          mount,
          frame,
          setHeight(px) { frame.style.height = `${px}px`; },
          destroy() { frame.remove(); },
        });
      } catch {
        frame.remove();
        finish(makeFallbackHost(container, playerCss));
      }
    };

    frame.addEventListener("load", onLoad, { once: true });
    frame.srcdoc = hostMarkup(playerCss);
    container.appendChild(frame);
    // A srcdoc frame that never fires load would leave the panel permanently
    // empty, which is worse than an honest downgrade.
    setTimeout(() => { if (!settled) { frame.remove(); finish(makeFallbackHost(container, playerCss)); } }, timeoutMs);
  });
}

/**
 * Belt-and-braces CSP for rrweb's INNER replay iframe.
 *
 * In hardened mode this is redundant (the inner about:blank already inherited
 * REPLAY_CSP). It matters in the fallback, where the inner document inherits the
 * dashboard's policy — i.e. none. rrweb calls document.open() on every full
 * snapshot, which wipes the head, so this has to be re-applied after each
 * rebuild rather than once.
 *
 * LIMITATION, stated plainly: a meta CSP inserted after parsing has begun is
 * best-effort. Current Chromium and Gecko honour it for subsequent subresource
 * loads, but it is not a header and the spec does not require enforcement. This
 * is a second line of defence, never the reason the feature is safe — the event
 * sanitiser is what guarantees there is no external URL to fetch.
 */
export function applyReplayIframeCsp(replayFrame) {
  if (!replayFrame) return;
  try {
    replayFrame.setAttribute("referrerpolicy", "no-referrer");
    const doc = replayFrame.contentDocument;
    const head = doc && doc.head;
    if (!head) return;
    if (head.querySelector('meta[http-equiv="Content-Security-Policy"]')) return;
    const meta = doc.createElement("meta");
    meta.setAttribute("http-equiv", "Content-Security-Policy");
    meta.setAttribute("content", REPLAY_CSP);
    head.insertBefore(meta, head.firstChild);
  } catch {
    // Cross-document access can throw if the replayer was torn down mid-rebuild.
  }
}

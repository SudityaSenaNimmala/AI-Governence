// Hotjar session recording / heatmaps for connect-ui.
//
// Off by default: with no site ID configured, initHotjar() returns false and no script is ever
// requested. Turn it on by setting the HOTJAR_SITE_ID repo variable (baked in at build time) or by
// editing public/runtime-config.js on the host (takes effect on the next page load).

import { HOTJAR_SITE_ID } from "../config/runtimeConfig";

const SCRIPT_ID = "hotjar-snippet";

// Snippet version Hotjar expects in both _hjSettings and the script URL. Bumping this is Hotjar's
// call, not ours -- it changes only when they ship a new loader contract.
const SNIPPET_VERSION = 6;

export function isHotjarEnabled() {
  return Boolean(HOTJAR_SITE_ID);
}

/**
 * Injects the Hotjar snippet. No-ops when no site ID is configured, which is the normal state in
 * local development and on any deploy that has not opted in.
 *
 * Idempotent on purpose: React double-invokes effects under StrictMode, and two copies of the
 * snippet would open two recordings for one page view.
 *
 * @returns {boolean} true only when this call actually injected the script.
 */
export function initHotjar() {
  if (!isHotjarEnabled()) return false;
  if (typeof window === "undefined" || typeof document === "undefined") return false;
  if (document.getElementById(SCRIPT_ID)) return false;

  // A non-numeric ID would silently request hotjar-NaN.js and fail with nothing in the console
  // pointing at the cause. Say so instead -- a typo'd ID and a deliberately disabled Hotjar should
  // not look identical to whoever is debugging.
  if (!/^\d+$/.test(HOTJAR_SITE_ID)) {
    // eslint-disable-next-line no-console
    console.warn(
      `[analytics] Ignoring hotjarSiteId="${HOTJAR_SITE_ID}": a Hotjar Site ID is digits only ` +
        `(e.g. "3847291"). Find it under Settings -> Sites & Organizations in Hotjar. Recording is off.`
    );
    return false;
  }

  // The queue has to exist before the remote script loads, so calls made during the first render --
  // identifyHotjarUser, in particular -- are replayed instead of dropped on the floor.
  window.hj =
    window.hj ||
    function () {
      (window.hj.q = window.hj.q || []).push(arguments);
    };
  // Number, not string: Hotjar's own snippet emits `hjid:1234567` as a numeric literal and the
  // remote script reads this value back. The digits-only guard above means Number() cannot NaN here.
  window._hjSettings = { hjid: Number(HOTJAR_SITE_ID), hjsv: SNIPPET_VERSION };

  const script = document.createElement("script");
  script.id = SCRIPT_ID;
  script.async = true;
  script.src = `https://static.hotjar.com/c/hotjar-${HOTJAR_SITE_ID}.js?sv=${SNIPPET_VERSION}`;
  document.head.appendChild(script);
  return true;
}

/**
 * Tags the current recording so it can be found again, using the CloudFuze user's opaque id.
 *
 * Deliberately NOT the email address. connect-ui signs in external customers, so an email here
 * would export customer PII into a third-party analytics tool -- the exact class of data this
 * product exists to govern. `domain` is the tenant the session belongs to (company, not person),
 * which is what you actually want to filter recordings by.
 *
 * Note: filtering by these attributes is a paid Hotjar feature. On a tier without it the call is
 * accepted and ignored, so this stays safe to ship regardless of plan.
 *
 * @param {{id?: string, publicId?: string, domain?: string}} user The SET_CF_USER payload.
 * @returns {boolean} true only when an identify call was actually sent.
 */
export function identifyHotjarUser(user) {
  if (!isHotjarEnabled()) return false;
  if (typeof window === "undefined" || typeof window.hj !== "function") return false;

  // publicId when present, else the internal id. Both are opaque handles, not personal data.
  const userId = String(user?.publicId || user?.id || "").trim();
  if (!userId) return false;

  window.hj("identify", userId, { tenant: user?.domain || "UNKNOWN" });
  return true;
}

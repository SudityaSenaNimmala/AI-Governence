// Resolves configuration that has to stay changeable after the Vite build.
//
// Order is runtime first, build-time second:
//   1. window.__APP_CONFIG__  -- from public/runtime-config.js, editable on the host post-build
//   2. import.meta.env.VITE_* -- baked into dist/ at build time by the CI `frontend` job
//
// Values here are PUBLIC by definition: everything Vite emits is readable by any visitor. Never
// resolve a secret through this module.

const runtime =
  typeof window !== "undefined" && window.__APP_CONFIG__ ? window.__APP_CONFIG__ : {};

// Treated as "not set": undefined, null, blank, and the "__PLACEHOLDER__" shape a container
// entrypoint might substitute at start-up -- an unsubstituted placeholder must fall through to the
// next source rather than be used as a real value.
function isUnset(value) {
  if (typeof value !== "string") return true;
  const trimmed = value.trim();
  return !trimmed || /^__.*__$/.test(trimmed);
}

function resolve(runtimeValue, buildTimeValue) {
  for (const candidate of [runtimeValue, buildTimeValue]) {
    if (!isUnset(candidate)) return candidate.trim();
  }
  return "";
}

// Hotjar Site ID, digits only. Blank disables Hotjar entirely -- see src/analytics/hotjar.js.
export const HOTJAR_SITE_ID = resolve(
  runtime.hotjarSiteId,
  import.meta.env.VITE_HOTJAR_SITE_ID
);

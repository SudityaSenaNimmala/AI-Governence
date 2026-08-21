// Runtime configuration -- read when the page loads, NOT compiled into the bundle.
//
// Vite freezes every import.meta.env.VITE_* reference into dist/ as a string literal, so a bundle
// built without a Hotjar ID could never be switched on without a rebuild. This file is copied
// verbatim out of public/ into dist/, which means it stays editable on the deploy host after the
// build: no rebuild, no toolchain, no Node.js. Edit it and reload the page.
//
// Caveat for THIS repo's deploy: .github/workflows/deploy.yml wipes DEPLOY_DIR on every push to
// main (only .env survives), so a host-side edit here is undone by the next deploy. Good for a
// one-off check; to enable something durably, set the repo variable the workflow reads.
//
// See src/config/runtimeConfig.js for how these values are resolved.
window.__APP_CONFIG__ = {
  // Hotjar Site ID (digits only, e.g. "3847291"). Not a secret: it ships inside client-side
  // JavaScript that any visitor can read, so it belongs in a CI *variable*, never a secret store.
  //
  // Blank = Hotjar fully off. No script is requested and no session is recorded.
  //
  // Asymmetric, and this bites people: writing an ID here turns recording ON for a bundle built
  // without one. Writing "" here canNOT turn it OFF for a bundle that has one baked in -- a blank
  // runtime value falls through to the build-time value. To switch that off, rebuild with
  // VITE_HOTJAR_SITE_ID unset (i.e. clear the HOTJAR_SITE_ID repo variable).
  hotjarSiteId: "",
};

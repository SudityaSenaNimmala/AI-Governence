// GET /api/v1/ai-surfaces — where on a governed page capture is allowed.
//
// Served over HTTP rather than compiled into the extension so a selector that
// goes stale when a vendor reshuffles its DOM is a config fix, not a release plus
// a redeploy to every endpoint. Same reasoning as the routing rules and the DLP
// pattern policy, both of which sync the same way.
//
// UNAUTHENTICATED, like /ai-platforms and /policy-packs/extension-config: this is
// POLICY, not data. It must reach a content script whose token is stale or which
// has not enrolled yet, because the alternative is an extension that falls back to
// capturing everything on a host where AI is one panel.

import { a } from '../util.js';
import { EMBEDDED_AI_SURFACES, SURFACE_SCOPE, surfaceFor } from '../lib/ai-surfaces.js';

export function mountAiSurfaces(app) {
  app.get('/api/v1/ai-surfaces', a(async (req, res) => {
    // A single host can be asked about directly, which is what the service
    // worker does when it is about to inject into one tab.
    const host = req.query.host ? String(req.query.host) : null;
    if (host) {
      return res.json({ host, ...surfaceFor(host) });
    }

    // Otherwise the whole map, for the extension to cache.
    res.json({
      default_scope: SURFACE_SCOPE.WHOLE_SITE,
      scopes: SURFACE_SCOPE,
      embedded: Object.fromEntries(
        Object.entries(EMBEDDED_AI_SURFACES).map(([k, v]) => [k, {
          product: v.product,
          selectors: v.selectors,
        }]),
      ),
    });
  }));
}

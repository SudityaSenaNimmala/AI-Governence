// Send a browser error to the triage queue.
//
// A React failure only exists in the browser, so without this a broken button
// is invisible to everything server-side: the user sees nothing happen, and no
// row is ever created. This is the only path by which a UI bug reaches the
// auto-triage pipeline at all.
//
// THREE RULES, all for the same reason — the page is ALREADY broken and this
// code runs inside that failure:
//
//   1. It never throws. A reporting error on top of a render error turns one
//      broken panel into a blank screen.
//   2. It never blocks. Fire-and-forget; nothing awaits it and no UI state
//      depends on the response.
//   3. It sends as little as will identify the bug. No page URL with its query
//      string, no user identifiers, no component props — a dashboard URL
//      carries ids and filter values, and none of that helps diagnose a crash.
//
// The server masks and caps everything again on arrival. This is not the
// security boundary; it is the courtesy of not sending rubbish in the first
// place.

let sent = 0;
const MAX_PER_SESSION = 20;

export function reportClientError(err, context = {}) {
  try {
    // A render loop can throw thousands of times a second. The server dedups
    // and rate-limits, but there is no reason to make it do that work, and a
    // browser stuck in a POST loop is its own problem.
    if (sent >= MAX_PER_SESSION) return;
    sent += 1;

    const e = err instanceof Error ? err : new Error(String(err));
    const body = {
      name: e.name || 'Error',
      message: e.message || '',
      stack: e.stack || '',
      // PATHNAME ONLY. The query string on this dashboard carries tenant ids,
      // host names and filter values.
      route: (typeof location !== 'undefined' ? location.pathname : '') || '',
      component: context.component || '',
      build: (typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : '') || '',
    };

    // keepalive so the report survives the navigation that a crash often
    // triggers; a plain fetch is cancelled when the page goes away.
    fetch('/api/v1/client-errors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      keepalive: true,
    }).catch(() => { /* rule 1 */ });
  } catch { /* rule 1 */ }
}

/**
 * Catch the two failures React's own error boundary never sees: an error in an
 * event handler, and a rejected promise nobody awaited. Those are precisely the
 * "I clicked the button and nothing happened" cases — the boundary only fires
 * during render.
 */
export function installGlobalErrorReporting() {
  if (typeof window === 'undefined') return;
  if (window.__cfaiErrorReportingInstalled) return;
  window.__cfaiErrorReportingInstalled = true;

  window.addEventListener('error', (ev) => {
    reportClientError(ev.error || ev.message, { component: 'window.onerror' });
  });

  window.addEventListener('unhandledrejection', (ev) => {
    reportClientError(ev.reason, { component: 'unhandledrejection' });
  });
}

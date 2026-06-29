import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ROUTE_EVENT_MAP } from './proactiveTemplates';

/**
 * Fires a cf:proactive custom event whenever the route changes.
 * Maps URL path prefixes to event types via ROUTE_EVENT_MAP.
 * Rendered inside <Router> in App.jsx — no visible output.
 *
 * Also listens for cf:navigate events dispatched by the mouse agent
 * and translates them into React Router navigation calls.
 */
export default function RouteProactiveTrigger() {
  const location = useLocation();
  const navigate = useNavigate();
  const prevPath = useRef<string>('');

  // Wire up mouse agent navigation — must be inside <Router> to call useNavigate
  useEffect(() => {
    function onAgentNavigate(e: Event) {
      const { path } = (e as CustomEvent).detail ?? {};
      if (path) navigate(path);
    }
    window.addEventListener('cf:navigate', onAgentNavigate);
    return () => window.removeEventListener('cf:navigate', onAgentNavigate);
  }, [navigate]);

  useEffect(() => {
    const path = location.pathname;

    // Skip if same path as before (e.g. query param change only)
    if (path === prevPath.current) return;
    prevPath.current = path;

    // Find matching event type — check longest prefix first
    const sortedKeys = Object.keys(ROUTE_EVENT_MAP).sort((a, b) => b.length - a.length);
    const matchedKey = sortedKeys.find((prefix) => path.startsWith(prefix));

    if (matchedKey) {
      const type = ROUTE_EVENT_MAP[matchedKey as keyof typeof ROUTE_EVENT_MAP];
      window.dispatchEvent(new CustomEvent('cf:proactive', { detail: { type, data: {} } }));
    }
  }, [location.pathname]);

  return null;
}

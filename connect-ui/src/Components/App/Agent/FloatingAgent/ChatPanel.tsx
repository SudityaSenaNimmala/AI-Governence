import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Sparkles } from 'lucide-react';
import ChatPanelContent from './ChatPanelContent';
import OnboardingPopup from './OnboardingPopup';
import GreetingPopup from './GreetingPopup';
import ProactiveBubble from './ProactiveBubble';
import { getProactiveMessage } from './proactiveTemplates';
import { useMouseAgent } from './mouseAgent/useMouseAgent';
import MouseAgentOverlay from './mouseAgent/MouseAgentOverlay';
import type { ActionPlan } from './mouseAgent/types';

const USER_NAME_KEY = 'cf_user_name';

/** Extract the first name from a full name string and apply Title Case. */
function toFirstName(fullName: string): string | null {
  if (!fullName) return null;
  const base = fullName.includes('@') ? fullName.split('@')[0] : fullName;
  const first = base.trim().split(/[\s._-]/)[0] || '';
  if (!first) return null;
  // Title Case: capitalise first letter, lowercase the rest
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
}

/** Decode JWT payload (no verification — display only) and extract a first name. */
function firstNameFromToken(token: string): string | null {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    const fullName: string =
      payload.name ?? payload.given_name ?? payload.preferred_username ?? payload.email ?? '';
    return toFirstName(fullName);
  } catch {
    return null;
  }
}

const PANEL_W = 440;
const PANEL_H = 620;
const BTN_SIZE = 52;
const SIDEBAR_W = 80; // CloudFuze side-nav width — panel must not overlap it

function clamp01(t: number): number {
  return Math.max(0, Math.min(1, t));
}

interface Props {
  token: string;
  isAuthenticated?: boolean;
  userFullName?: string;
}

interface Pos { x: number; y: number }

const PULSE_CSS = `
@keyframes cfAskPulse{0%{transform:scale(1);opacity:.7}70%,100%{transform:scale(1.55);opacity:0}}
.cf-ask-pulse{animation:cfAskPulse 2s ease-out infinite}
@keyframes spin{to{transform:rotate(360deg)}}
@keyframes cfPanelOpen{0%{transform:scale(0.08);opacity:0}60%{opacity:1}100%{transform:scale(1);opacity:1}}
.cf-panel-open{animation:cfPanelOpen 0.22s cubic-bezier(0.34,1.4,0.64,1) forwards}
`;

export function ChatPanel({ token, isAuthenticated = true, userFullName = '' }: Props) {
  useEffect(() => {
    if (document.getElementById('cf-ask-pulse-style')) return;
    const s = document.createElement('style');
    s.id = 'cf-ask-pulse-style';
    s.textContent = PULSE_CSS;
    document.head.appendChild(s);
  }, []);

  const [userName, setUserName]             = useState<string | null>(() => {
    // Use first name from CloudFuze user profile (passed from GlobalApp via user.name or email)
    const first = toFirstName(userFullName);
    if (first) { localStorage.setItem(USER_NAME_KEY, first); return first; }
    // Fallback: use stored name if it is a real name (not the skip placeholder)
    const stored = localStorage.getItem(USER_NAME_KEY);
    if (stored && stored !== "there") return stored;
    // Last fallback: decode JWT payload for name/email fields
    const fromToken = firstNameFromToken(token);
    if (fromToken) { localStorage.setItem(USER_NAME_KEY, fromToken); return fromToken; }
    return null;
  });
  const [showOnboarding, setShowOnboarding] = useState<boolean>(() => !localStorage.getItem(USER_NAME_KEY));
  const [showGreeting, setShowGreeting]     = useState<boolean>(() => !!localStorage.getItem(USER_NAME_KEY));
  const [open, setOpen]                     = useState(false);
  const [animating, setAnimating]           = useState<'opening' | 'closing' | null>(null);
  const [expanded, setExpanded]             = useState(false);
  const [proactive, setProactive]           = useState<{ fact: string; question: string } | null>(null);
  const [prefillText, setPrefillText]       = useState<string>("");
  const [autoSendText, setAutoSendText]     = useState<string>("");
  const proactiveCooldownRef                = useRef<number>(0);
  const openRef                             = useRef(false);
  const proactiveRef                        = useRef<{ fact: string; question: string } | null>(null);
  const showGreetingRef                     = useRef(showGreeting);

  // Mouse agent
  const mouseAgent = useMouseAgent();
  const agentStepsRef = useRef<{ label: string; startTime: number }[]>([]);
  const agentStepMessageIdRef = useRef<string | null>(null);

  function handleActionStart(plan: ActionPlan, _messageId?: string) {
    // Special handling for role-based onboarding: create workflow and navigate to review
    if (plan.operation === 'create_role_based_onboard_workflow') {
      createRoleBasedWorkflow(plan);
      return;
    }

    // For all other actions, use the mouse agent
    // Start cursor from the agent avatar (top-left of chat panel header)
    const panelRect = panelRef.current?.getBoundingClientRect();
    const avatarPos = panelRect
      ? { x: panelRect.left + 30, y: panelRect.top + 29 }   // avatar circle center in header
      : { x: window.innerWidth - 480, y: 40 };               // fallback if panel ref not ready
    mouseAgent.startExecution(plan, avatarPos);
  }

  async function createRoleBasedWorkflow(plan: ActionPlan) {
    try {
      // Call the backend to create the role-based workflow
      const response = await fetch('/api/agent/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          run_id: plan.params?.run_id || 'temp-' + Date.now(),
          action: 'create_role_based_onboard_workflow',
          payload: {
            role: plan.params?.role,
            template: plan.params?.template,
            email: plan.params?.email,
            workflow_name: `${plan.params?.role} Onboarding Workflow`,
          }
        })
      });

      if (!response.ok) throw new Error(`API error: ${response.status}`);
      const result = await response.json();

      // Navigate to workflow builder with the created workflow
      if (result.data?.workflow) {
        // Store the complete workflow in localStorage for the workflow builder to pick up
        localStorage.setItem('cf:pending_workflow_json', JSON.stringify(result.data.workflow));
        // Navigate to the correct workflow builder URL
        // Use setTimeout to ensure localStorage is written before navigation
        setTimeout(() => {
          window.location.href = '/CloudFuze/WorkFLowBuilder?action=workflow&draft=pending_workflow_json';
        }, 100);
      } else {
        alert('Failed to create workflow: ' + (result.error || 'Unknown error'));
      }
    } catch (error) {
      alert('Error creating workflow: ' + (error instanceof Error ? error.message : String(error)));
    }
  }

  // Track agent step progress and log to chat
  useEffect(() => {
    const { status, currentLabel } = mouseAgent.state;

    // When agent starts executing, initialize step tracking
    if (status === 'executing' && currentLabel && !agentStepMessageIdRef.current) {
      agentStepsRef.current = [];
      agentStepMessageIdRef.current = `agent-steps-${Date.now()}`;
    }

    // When agent returns to idle, clean up immediately
    if (status === 'idle') {
      agentStepMessageIdRef.current = null;
      agentStepsRef.current = [];
      return;
    }

    // When agent is paused, stop logging steps
    if (status === 'paused') {
      return;
    }

    // When agent is done or aborted, clean up after delay
    if ((status === 'done' || status === 'aborted' || status === 'error') && agentStepMessageIdRef.current) {
      setTimeout(() => {
        agentStepMessageIdRef.current = null;
        agentStepsRef.current = [];
      }, 2000);
    }

    // Track step changes ONLY while executing
    if (status === 'executing' && currentLabel && agentStepMessageIdRef.current) {
      const lastStep = agentStepsRef.current[agentStepsRef.current.length - 1];

      // New step if label changed from previous
      if (!lastStep || lastStep.label !== currentLabel) {
        agentStepsRef.current.push({ label: currentLabel, startTime: performance.now() });
      }
    }
  }, [mouseAgent.state.status, mouseAgent.state.currentLabel]);

  // Emit step updates to chat via custom event - ONLY when actually executing
  useEffect(() => {
    const { status } = mouseAgent.state;

    // Only emit if agent is actually running or paused (not idle)
    if (!agentStepMessageIdRef.current || status === 'idle') return;

    const messageId = agentStepMessageIdRef.current;
    const steps = agentStepsRef.current;
    const { currentLabel } = mouseAgent.state;

    window.dispatchEvent(
      new CustomEvent('agent-step-update', {
        detail: { messageId, steps, status, currentLabel },
      })
    );
  }, [mouseAgent.state.currentLabel, mouseAgent.state.status]);

  // Keep refs in sync
  useEffect(() => { openRef.current = open; }, [open]);
  useEffect(() => { proactiveRef.current = proactive; }, [proactive]);
  useEffect(() => { showGreetingRef.current = showGreeting; }, [showGreeting]);

  // Listen for proactive events fired by CloudFuze pages (registered once)
  useEffect(() => {
    function handleProactive(e: Event) {
      if (localStorage.getItem('cf_proactive_enabled') === 'false') return;
      const { type, data } = (e as CustomEvent).detail ?? {};
      if (openRef.current) return;
      const isRouteEvent = (type as string)?.startsWith('route_');
      // Route events must not override the greeting popup (welcome message).
      // showGreetingRef stays true during the same JS tick as setShowGreeting(false),
      // so login_renewals effect + route events fired at mount are both handled correctly.
      if (isRouteEvent && showGreetingRef.current) return;
      const now = Date.now();
      // If a bubble is already visible, always allow replacement (resets timer).
      // Otherwise apply cooldown: route 8s, click 3s.
      const bubbleVisible = !!proactiveRef.current;
      if (!bubbleVisible) {
        const cooldown = isRouteEvent ? 8_000 : 3_000;
        if (now - proactiveCooldownRef.current < cooldown) return;
        proactiveCooldownRef.current = now;
      }
      const msg = getProactiveMessage(type, data);
      if (msg) { setShowGreeting(false); setProactive(msg); }
    }
    window.addEventListener('cf:proactive', handleProactive);
    return () => window.removeEventListener('cf:proactive', handleProactive);
  }, []);

  // Dismiss the greeting popup on any page click so it never blocks user interaction.
  // A 150 ms delay ensures the greeting's own onClick fires first (opens the panel),
  // so the document listener does not interfere with that path.
  useEffect(() => {
    if (!showGreeting) return;
    let added = false;
    const t = setTimeout(() => {
      document.addEventListener('click', dismissGreeting, { capture: true, once: true });
      added = true;
    }, 150);
    function dismissGreeting() { setShowGreeting(false); }
    return () => {
      clearTimeout(t);
      if (added) document.removeEventListener('click', dismissGreeting, { capture: true });
    };
  }, [showGreeting]);

  // After successful login: show personalized renewals bubble (LoginForm sets sessionStorage flag).
  // Waits until first-time onboarding is finished so it does not compete with the name popup.
  useEffect(() => {
    if (!isAuthenticated) return;
    try {
      if (sessionStorage.getItem('cf_proactive_after_login') !== '1') return;
    } catch {
      return;
    }
    if (showOnboarding) return;

    try {
      sessionStorage.removeItem('cf_proactive_after_login');
    } catch {
      /* ignore */
    }

    setShowGreeting(false);

    const first =
      (userName && userName !== 'there' ? userName : null) ||
      toFirstName(userFullName) ||
      firstNameFromToken(token) ||
      '';

    const t = window.setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent('cf:proactive', {
          detail: { type: 'login_renewals', data: { firstName: first } },
        }),
      );
    }, 700);

    return () => clearTimeout(t);
  }, [isAuthenticated, showOnboarding, userName, userFullName, token]);

  // If userFullName arrives after mount (async context load), update stored name
  useEffect(() => {
    const first = toFirstName(userFullName);
    if (!first) return;
    setUserName(prev => {
      if (!prev || prev === 'there') {
        localStorage.setItem(USER_NAME_KEY, first);
        return first;
      }
      return prev;
    });
  }, [userFullName]);

  // Keep session alive while the panel is open so the dashboard's
  // mousemove-based session-expiry handler never redirects mid-chat.
  useEffect(() => {
    if (!open) return;
    const tick = () => localStorage.setItem('time', String(new Date().getTime()));
    tick(); // set immediately on open
    const id = setInterval(tick, 10_000); // refresh every 10s
    return () => clearInterval(id);
  }, [open]);

  // Button position as fractions of the draggable area so it stays correct when the viewport resizes.
  // nx: 0 = left (sidebar edge), 1 = right; ny: 0 = top, 1 = bottom. Default: centered horizontally, ~24px from bottom.
  const [btnNorm, setBtnNorm] = useState(() => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    // Guard: if viewport is not yet laid out (w/h too small), default to bottom-right corner
    if (w < 200 || h < 200) return { nx: 1, ny: 1 };
    const rangeX = Math.max(1e-6, w - SIDEBAR_W - BTN_SIZE);
    const rangeY = Math.max(1e-6, h - BTN_SIZE);
    return {
      nx: clamp01((w - BTN_SIZE - 24 - SIDEBAR_W) / rangeX),
      ny: clamp01((h - BTN_SIZE - 24) / rangeY),
    };
  });
  const [panelOffset, setPanelOffset] = useState({ rx: 24, ry: 24 });
  const [vp, setVp] = useState({ w: window.innerWidth, h: window.innerHeight });
  useEffect(() => {
    function syncViewport() {
      setVp({ w: window.innerWidth, h: window.innerHeight });
    }
    window.addEventListener('resize', syncViewport);
    const vv = window.visualViewport;
    vv?.addEventListener('resize', syncViewport);
    vv?.addEventListener('scroll', syncViewport);
    return () => {
      window.removeEventListener('resize', syncViewport);
      vv?.removeEventListener('resize', syncViewport);
      vv?.removeEventListener('scroll', syncViewport);
    };
  }, []);

  const btnRangeX = Math.max(0, vp.w - SIDEBAR_W - BTN_SIZE);
  const btnRangeY = Math.max(0, vp.h - BTN_SIZE);
  const btnPos: Pos = {
    x: SIDEBAR_W + clamp01(btnNorm.nx) * btnRangeX,
    y: clamp01(btnNorm.ny) * btnRangeY,
  };
  const pos: Pos = {
    x: Math.max(SIDEBAR_W, Math.min(vp.w - PANEL_W - panelOffset.rx, vp.w - PANEL_W)),
    y: Math.max(0,         Math.min(vp.h - PANEL_H - panelOffset.ry, vp.h - PANEL_H)),
  };

  const panelRef = useRef<HTMLDivElement>(null);

  const onDragPanel = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX, startY = e.clientY;
    const origX = pos.x, origY = pos.y;
    let lastX = origX, lastY = origY;

    const onMove = (ev: MouseEvent) => {
      lastX = Math.max(SIDEBAR_W, Math.min(origX + (ev.clientX - startX), window.innerWidth  - PANEL_W));
      lastY = Math.max(0,         Math.min(origY + (ev.clientY - startY), window.innerHeight - PANEL_H));
      if (panelRef.current) {
        panelRef.current.style.left = `${lastX}px`;
        panelRef.current.style.top  = `${lastY}px`;
      }
    };
    const onUp = () => {
      if (panelRef.current) panelRef.current.style.transition = '';
      setPanelOffset({ rx: Math.max(0, window.innerWidth - lastX - PANEL_W), ry: Math.max(0, window.innerHeight - lastY - PANEL_H) });
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    if (panelRef.current) panelRef.current.style.transition = 'none';
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [pos]);

  const btnRef        = useRef<HTMLDivElement>(null);
  const btnDraggedRef = useRef(false);

  const onDragBtn = useCallback((e: React.MouseEvent) => {
    const startX = e.clientX;
    const startY = e.clientY;
    btnDraggedRef.current = false;
    const origX = btnPos.x;
    const origY = btnPos.y;
    let lastX = origX;
    let lastY = origY;

    const toNorm = (lx: number, ly: number) => {
      const ww = window.innerWidth;
      const wh = window.innerHeight;
      const rX = Math.max(1e-6, ww - SIDEBAR_W - BTN_SIZE);
      const rY = Math.max(1e-6, wh - BTN_SIZE);
      return {
        nx: clamp01((lx - SIDEBAR_W) / rX),
        ny: clamp01(ly / rY),
      };
    };

    const onMove = (ev: MouseEvent) => {
      if (Math.abs(ev.clientX - startX) > 4 || Math.abs(ev.clientY - startY) > 4) btnDraggedRef.current = true;
      const ww = window.innerWidth;
      const wh = window.innerHeight;
      lastX = Math.max(SIDEBAR_W, Math.min(origX + (ev.clientX - startX), ww - BTN_SIZE));
      lastY = Math.max(0, Math.min(origY + (ev.clientY - startY), wh - BTN_SIZE));
      if (btnRef.current) {
        btnRef.current.style.left = `${lastX}px`;
        btnRef.current.style.top = `${lastY}px`;
      }
      setBtnNorm(toNorm(lastX, lastY));
    };
    const onUp = () => {
      setBtnNorm(toNorm(lastX, lastY));
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [btnPos]);

  function handleOnboardingDone(name: string) {
    localStorage.setItem(USER_NAME_KEY, name);
    setUserName(name);
    setShowOnboarding(false);
    setShowGreeting(true);
  }

  function handleSetName(name: string) {
    localStorage.setItem(USER_NAME_KEY, name);
    setUserName(name);
  }

  // Refresh session timestamp on any interaction within the panel,
  // preventing AgentNav's mousemove handler from triggering a session-expired redirect.
  function refreshSession(e: React.SyntheticEvent) {
    e.stopPropagation();
    localStorage.setItem('time', String(new Date().getTime()));
  }

  function closePanel() {
    setAnimating('closing');
    setTimeout(() => { setOpen(false); setExpanded(false); setAnimating(null); }, 200);
  }

  // transform-origin: corner of panel closest to the button
  function getPanelTransformOrigin(): string {
    const bx = btnPos.x + BTN_SIZE / 2;
    const by = btnPos.y + BTN_SIZE / 2;
    const px = pos.x, py = pos.y;
    const h = bx < px + PANEL_W / 2 ? 'left' : 'right';
    const v = by < py + PANEL_H / 2 ? 'top' : 'bottom';
    return `${v} ${h}`;
  }

  return (
    <>
      {/* Onboarding & greeting only when authenticated */}
      {isAuthenticated && showOnboarding && !open && (
        <OnboardingPopup
          onDone={handleOnboardingDone}
          onClose={() => setShowOnboarding(false)}
        />
      )}

      {isAuthenticated && showGreeting && !open && userName && (
        <GreetingPopup
          userName={userName}
          btnPos={btnPos}
          btnSize={BTN_SIZE}
          onOpen={() => { setShowGreeting(false); setOpen(true); }}
          onClose={() => setShowGreeting(false)}
        />
      )}

      {isAuthenticated && proactive && !open && !showGreeting && !showOnboarding && (
        <ProactiveBubble
          key={proactive.fact + proactive.question}
          fact={proactive.fact}
          question={proactive.question}
          btnPos={btnPos}
          btnSize={BTN_SIZE}
          onFill={(q) => { proactiveCooldownRef.current = 0; setAutoSendText(q); setProactive(null); setOpen(true); }}
          onClose={() => { proactiveCooldownRef.current = 0; setProactive(null); }}
        />
      )}

      {/* Floating Agent button */}
      {!open && (
        <div ref={btnRef} onClick={refreshSession} style={{ position: 'fixed', left: btnPos.x, top: btnPos.y, zIndex: 9999 }}>
          {/* Pulse ring */}
          <span className="cf-ask-pulse" style={{
            position: 'absolute', inset: -6,
            borderRadius: '50%',
            border: isAuthenticated ? '2px solid rgba(22,72,192,0.4)' : '2px solid rgba(255,255,255,0.5)',
            pointerEvents: 'none',
          }} />

          <button
            onMouseDown={onDragBtn}
            onClick={() => {
              if (!btnDraggedRef.current) {
                const bx = btnPos.x, by = btnPos.y;
                // Panel overlaps the button — bottom-right corner of panel aligns with button
                let px = bx - PANEL_W + BTN_SIZE;
                let py = by - PANEL_H + BTN_SIZE;
                px = Math.max(SIDEBAR_W, Math.min(px, window.innerWidth - PANEL_W));
                py = Math.max(0, Math.min(py, window.innerHeight - PANEL_H));
                setPanelOffset({ rx: Math.max(0, window.innerWidth - px - PANEL_W), ry: Math.max(0, window.innerHeight - py - PANEL_H) });
                setOpen(true);
                setAnimating('opening');
                setTimeout(() => setAnimating(null), 220);
              }
            }}
            style={{
              width: BTN_SIZE, height: BTN_SIZE,
              borderRadius: '50%',
              background: isAuthenticated
                ? 'linear-gradient(135deg, #0d2666 0%, #1648c0 50%, #1a4bc4 100%)'
                : 'rgba(255,255,255,0.95)',
              border: 'none',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'grab',
              boxShadow: isAuthenticated
                ? '0 4px 24px rgba(13,38,102,0.45)'
                : '0 4px 24px rgba(0,0,0,0.2)',
              userSelect: 'none',
              position: 'relative',
            }}>
            <Sparkles size={22} color={isAuthenticated ? '#fff' : '#1648c0'} strokeWidth={1.8} />
          </button>
        </div>
      )}

      {/* Floating chat panel */}
      {open && !isAuthenticated && (
        <div onClick={refreshSession} style={{
          position: 'fixed',
          left: pos.x, top: pos.y,
          zIndex: 9999,
          width: PANEL_W, height: 'auto',
          background: '#fff',
          borderRadius: 14,
          boxShadow: '0 8px 40px rgba(0,0,0,0.18)',
          overflow: 'hidden', border: '1px solid #dbeafe',
        }}>
          <div style={{ background: '#0d1f6e', padding: '16px 16px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'rgba(255,255,255,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Sparkles size={16} color="#fff" strokeWidth={1.8} />
              </div>
              <div>
                <div style={{ fontSize: 9, fontWeight: 700, color: '#93c5fd', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Manage AI</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>AI Assistant</div>
              </div>
            </div>
            <button onClick={() => setOpen(false)} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.6)', cursor: 'pointer', fontSize: 20, lineHeight: 1, padding: '2px 4px' }}>×</button>
          </div>
          <div style={{ padding: '24px 20px', textAlign: 'center' }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>🔒</div>
            <div style={{ fontSize: 15, fontWeight: 600, color: '#0d1f6e', marginBottom: 8 }}>Login Required</div>
            <div style={{ fontSize: 13, color: '#64748b', lineHeight: 1.5 }}>Please login to your CloudFuze account to access AI features.</div>
          </div>
        </div>
      )}

      {open && isAuthenticated && (
        <div
          ref={panelRef}
          onClick={refreshSession}
          style={{
          position: 'fixed',
          left:      expanded ? 0 : pos.x,
          top:       expanded ? 0 : pos.y,
          zIndex:    9999,
          width:     expanded ? '100vw' : PANEL_W,
          height:    expanded ? '100vh' : PANEL_H,
          background: '#fff',
          borderRadius: expanded ? 0 : 14,
          boxShadow: '0 8px 40px rgba(0,0,0,0.18)',
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden', border: '1px solid #dbeafe',
          transformOrigin: expanded ? 'center' : getPanelTransformOrigin(),
          transform: animating === 'closing' ? 'scale(0.08)' : undefined,
          // Semi-transparent when the agent cursor is travelling behind the panel
          opacity: animating === 'closing' ? 0 : (() => {
            const agentActive = mouseAgent.state.status !== 'idle';
            if (!agentActive) return undefined;
            const p = mouseAgent.cursorPos;
            const rect = panelRef.current?.getBoundingClientRect();
            if (!rect) return undefined;
            const behind = p.x >= rect.left && p.x <= rect.right && p.y >= rect.top && p.y <= rect.bottom;
            return behind ? 0.35 : undefined;
          })(),
          transition: animating === 'closing'
            ? 'transform 0.18s ease-in, opacity 0.16s ease-in'
            : 'width 0.2s ease, height 0.2s ease, border-radius 0.3s ease, opacity 0.3s ease',
        }}>
          {/* Drag handle — starts after the left avatar/back-button area */}
          {!expanded && (
            <div
              onMouseDown={onDragPanel}
              style={{ position: 'absolute', top: 0, left: 56, right: 150, height: 58, cursor: 'grab', zIndex: 1 }}
            />
          )}
          <ChatPanelContent
            token={token}
            onClose={closePanel}
            onExpand={() => setExpanded(e => !e)}
            isExpanded={expanded}
            userName={userName ?? undefined}
            onSetName={handleSetName}
            prefillText={prefillText}
            onPrefillConsumed={() => setPrefillText("")}
            autoSendText={autoSendText}
            onAutoSendConsumed={() => setAutoSendText("")}
            onActionStart={handleActionStart}
            mouseAgentPause={
              mouseAgent.state.pauseMessage
                ? {
                    message: mouseAgent.state.pauseMessage,
                    onDone: mouseAgent.confirmResume,
                    onStop: mouseAgent.abort,
                  }
                : null
            }
          />
        </div>
      )}

      {/* Mouse agent overlay — cursor + control bar (no blocking modal) */}
      {mouseAgent.state.status !== 'idle' && (
        <MouseAgentOverlay
          onRegisterElements={mouseAgent.registerCursorElements}
          cursorPos={mouseAgent.cursorPos}
          status={mouseAgent.state.status}
          currentLabel={mouseAgent.state.currentLabel}
          currentStepIndex={mouseAgent.state.currentStepIndex}
          totalSteps={mouseAgent.state.totalSteps}
          onAbort={mouseAgent.abort}
          onPause={mouseAgent.pause}
          onResume={mouseAgent.resume}
        />
      )}
    </>
  );
}

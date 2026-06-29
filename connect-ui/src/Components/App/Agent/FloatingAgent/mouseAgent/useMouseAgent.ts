import { useState, useRef, useCallback } from 'react';
import type { AgentStatus, ActionPlan, Step } from './types';
import { getSteps } from './stepPlans';
import {
  findClickable,
  findSidebarItem,
  findInput,
  getCenter,
  highlightElement,
  isVisible,
  findWorkflowCanvasAddButton,
  findWorkflowSaveButton,
  findWorkflowDndPayloadRow,
  dispatchWorkflowCanvasDropFromPayloadJson,
  findWorkflowCanvasDropZone,
  findManualTriggerUserRowCheckbox,
  findEnabledRunWorkflowControl,
  looksLikeEmail,
} from './elementResolver';

/**
 * Maps route prefixes to the sidebar nav item title text (as it appears in .cf_sideNav_div).
 * Based on the actual SideNav.jsx menuJson: Dashboard, Integrations, Applications, Workflow,
 * Browser Activity, Settings.
 *
 * If a route is a sub-page of a sidebar section (e.g. /Workflow/OffBoard under /Workflow),
 * we click the sidebar item first, then dispatch cf:navigate for the specific sub-route.
 */
const SIDEBAR_SECTIONS: Array<{ prefix: string; sidebarTitle: string; directLink: boolean }> = [
  // directLink=true  → the sidebar link goes directly to this exact route, no second nav needed
  // directLink=false → sidebar link goes to the section root, we dispatch cf:navigate after for the sub-route
  { prefix: '/Dashboard',       sidebarTitle: 'Dashboard',     directLink: true  },
  { prefix: '/Integrations/Add',sidebarTitle: 'Integrations',  directLink: true  }, // sidebar Link → /Integrations/Add
  { prefix: '/Integrations',    sidebarTitle: 'Integrations',  directLink: false },
  { prefix: '/Applications',    sidebarTitle: 'Applications',  directLink: true  },
  { prefix: '/Workflow',        sidebarTitle: 'Workflow',       directLink: false }, // sidebar Link → /Workflow/Template
  { prefix: '/BrowserActivity', sidebarTitle: 'Browser',       directLink: true  },
  { prefix: '/Settings',        sidebarTitle: 'Settings',      directLink: true  },
];

export interface MouseAgentState {
  status: AgentStatus;
  currentStepIndex: number;
  totalSteps: number;
  currentLabel: string;
  pauseMessage: string | null;
  error: string | null;
}

const INITIAL_STATE: MouseAgentState = {
  status: 'idle',
  currentStepIndex: 0,
  totalSteps: 0,
  currentLabel: '',
  pauseMessage: null,
  error: null,
};

/**
 * Animate the cursor from its current position to a target using ease-in-out rAF.
 * Calls onUpdate for every frame so the DOM is updated at 60fps.
 */
function animateCursor(
  from: { x: number; y: number },
  to: { x: number; y: number },
  onUpdate: (pos: { x: number; y: number }) => void,
  durationMs: number = 700,
): Promise<void> {
  return new Promise(resolve => {
    const duration = durationMs;
    const start = performance.now();

    function easeInOut(t: number): number {
      return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
    }

    function frame(now: number) {
      const t = Math.min((now - start) / duration, 1);
      const ease = easeInOut(t);
      onUpdate({ x: from.x + (to.x - from.x) * ease, y: from.y + (to.y - from.y) * ease });
      if (t < 1) requestAnimationFrame(frame);
      else resolve();
    }
    requestAnimationFrame(frame);
  });
}

const WORKFLOW_DRAG_GHOST_ATTR = 'data-cf-workflow-drag-ghost';

function workflowDragGhostLabel(row: Element): string {
  const p = row.querySelector('.cf_workdflow_app_header p');
  const t = p?.textContent?.trim() ?? row.textContent?.trim() ?? '';
  return (t || 'Application').slice(0, 64);
}

/**
 * Floating “card” that follows the cursor during a simulated drag (onboard app → canvas).
 */
function mountWorkflowDragGhost(label: string): {
  move: (pos: { x: number; y: number }) => void;
  remove: () => void;
} {
  const el = document.createElement('div');
  el.setAttribute(WORKFLOW_DRAG_GHOST_ATTR, '');
  el.textContent = label;
  el.style.cssText = [
    'position:fixed',
    'z-index:200002',
    'pointer-events:none',
    'padding:8px 12px',
    'border-radius:10px',
    'background:rgba(255,255,255,0.98)',
    'border:1.5px solid #2563eb',
    'box-shadow:0 10px 28px rgba(37,99,235,0.32)',
    'font-size:12px',
    'font-weight:600',
    'color:#0f1729',
    'max-width:240px',
    'white-space:nowrap',
    'overflow:hidden',
    'text-overflow:ellipsis',
    'transform:translate(-4px,8px)',
  ].join(';');
  document.body.appendChild(el);
  return {
    move(pos: { x: number; y: number }) {
      el.style.left = `${pos.x}px`;
      el.style.top = `${pos.y}px`;
    },
    remove() {
      el.style.opacity = '0';
      el.style.transition = 'opacity 0.22s ease';
      setTimeout(() => el.remove(), 230);
    },
  };
}

/**
 * Type a value into a React-controlled input by using the native setter trick.
 */
function typeIntoReactInput(inputEl: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (nativeInputValueSetter) nativeInputValueSetter.call(inputEl, value);
  else inputEl.value = value;
  inputEl.dispatchEvent(new Event('input', { bubbles: true }));
  inputEl.dispatchEvent(new Event('change', { bubbles: true }));
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function useMouseAgent() {
  const [state, setState] = useState<MouseAgentState>(INITIAL_STATE);

  // React state for cursorPos — updated at ~10fps (used for panel opacity check only).
  // The actual visual cursor is driven at 60fps via direct DOM refs below.
  const [cursorPos, setCursorPos] = useState({ x: -200, y: -200 });

  // ── Direct DOM refs for smooth 60fps cursor movement ──────────────────────────
  // These are set by MouseAgentOverlay via registerCursorElements().
  const cursorHeadRef  = useRef<HTMLDivElement | null>(null);
  const cursorLabelRef = useRef<HTMLDivElement | null>(null);

  // Called by MouseAgentOverlay once it mounts so we can drive position directly.
  const registerCursorElements = useCallback(
    (head: HTMLDivElement | null, label: HTMLDivElement | null) => {
      cursorHeadRef.current  = head;
      cursorLabelRef.current = label;
      // Immediately position at current off-screen coords
      if (head)  { head.style.left  = `${cursorPosRef.current.x - 8}px`;  head.style.top  = `${cursorPosRef.current.y - 8}px`; }
      if (label) { label.style.left = `${cursorPosRef.current.x + 18}px`; label.style.top = `${cursorPosRef.current.y + 12}px`; }
    },
    [],
  );

  // Refs for imperative control across async step execution
  const stepsRef         = useRef<Step[]>([]);
  const abortedRef       = useRef(false);
  const pausedRef        = useRef(false);
  const pauseResolveRef  = useRef<(() => void) | null>(null);
  const cleanupHighlightRef = useRef<(() => void) | null>(null);
  const cursorPosRef     = useRef({ x: -200, y: -200 });
  const lastStateMsRef   = useRef(0); // for throttling setCursorPos

  /**
   * Write cursor position to DOM directly (60fps) and throttle the React state
   * update to ~10fps so we don't hammer the React tree on every frame.
   */
  function updateCursor(pos: { x: number; y: number }) {
    cursorPosRef.current = pos;

    // 60fps direct DOM update — no React state, no re-render
    if (cursorHeadRef.current) {
      cursorHeadRef.current.style.left  = `${pos.x - 8}px`;
      cursorHeadRef.current.style.top   = `${pos.y - 8}px`;
    }
    if (cursorLabelRef.current) {
      cursorLabelRef.current.style.left = `${pos.x + 18}px`;
      cursorLabelRef.current.style.top  = `${pos.y + 12}px`;
    }

    // Throttled React state (~10fps) — only for panel opacity check
    const now = performance.now();
    if (now - lastStateMsRef.current > 80) {
      lastStateMsRef.current = now;
      setCursorPos({ ...pos });
    }
  }

  function updateState(partial: Partial<MouseAgentState>) {
    setState(prev => ({ ...prev, ...partial }));
  }

  async function moveCursorTo(target: { x: number; y: number }): Promise<void> {
    await animateCursor(cursorPosRef.current, target, updateCursor);
    // Final state update so React knows the exact resting position
    setCursorPos({ ...target });
  }

  /** Move cursor to element and dispatch a real click (shared by click / builder-specific steps). */
  async function animateClickOnElement(el: Element): Promise<void> {
    const center = getCenter(el);
    await moveCursorTo(center);
    await delay(300);
    if (abortedRef.current) return;
    const cleanup = highlightElement(el);
    await delay(200);
    cleanup();
    el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true }));
    el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, cancelable: true }));
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await delay(300);
  }

  async function executeStep(step: Step, index: number, total: number): Promise<void> {
    if (abortedRef.current) return;

    updateState({
      currentStepIndex: index,
      totalSteps: total,
      currentLabel: (step as any).label ?? (step as any).message ?? '',
    });

    switch (step.type) {
      case 'navigate': {
        // Find which sidebar section this route belongs to
        const section = SIDEBAR_SECTIONS.find(s => step.route.startsWith(s.prefix));

        if (section) {
          // Find the actual sidebar <a> link element, scoped to .cf_sideNav_div
          const sidebarLink = findSidebarItem(section.sidebarTitle);

          if (sidebarLink && isVisible(sidebarLink)) {
            // Move cursor to the sidebar nav item and click the real React Router Link
            const center = getCenter(sidebarLink);
            await moveCursorTo(center);
            await delay(250);
            if (abortedRef.current) return;

            const cleanup = highlightElement(sidebarLink);
            await delay(180);
            cleanup();
            sidebarLink.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
            await delay(900); // wait for React Router to render the new page

            // If this is a sub-route deeper than what the sidebar link covers, navigate further
            if (!section.directLink) {
              if (abortedRef.current) return;
              window.dispatchEvent(new CustomEvent('cf:navigate', { detail: { path: step.route } }));
              await delay(900);
            }
          } else {
            // Sidebar element not in DOM yet — fall back to cf:navigate with visual movement
            const fallbackY = (() => {
              const titles = SIDEBAR_SECTIONS.map(s => s.sidebarTitle);
              const idx = titles.indexOf(section.sidebarTitle);
              return 100 + idx * 64; // ~64px per sidebar item, first item at y=100
            })();
            await moveCursorTo({ x: 40, y: fallbackY });
            await delay(300);
            if (abortedRef.current) return;
            window.dispatchEvent(new CustomEvent('cf:navigate', { detail: { path: step.route } }));
            await delay(900);
          }
        } else {
          // Route not in sidebar — move cursor to sidebar center area, then dispatch
          await moveCursorTo({ x: 40, y: window.innerHeight * 0.4 });
          await delay(300);
          if (abortedRef.current) return;
          window.dispatchEvent(new CustomEvent('cf:navigate', { detail: { path: step.route } }));
          await delay(900);
        }
        break;
      }

      case 'wait': {
        await delay(step.ms);
        break;
      }

      case 'click': {
        let el: Element | null = null;
        const textTrim = String(step.text).trim();

        // Manual Trigger popup: wait for enabled footer after user selection
        if (textTrim === 'Run Workflow') {
          for (let attempt = 0; attempt < 40; attempt++) {
            if (abortedRef.current) return;
            el = findEnabledRunWorkflowControl();
            if (el) break;
            if (attempt === 4) {
              await moveCursorTo({ x: window.innerWidth * 0.72, y: window.innerHeight * 0.88 });
            }
            await delay(250);
          }
        } else if (looksLikeEmail(textTrim)) {
          // Manual Trigger user table: target the checkbox in the matching <tr> (debounced search + API)
          for (let attempt = 0; attempt < 35; attempt++) {
            if (abortedRef.current) return;
            el = findManualTriggerUserRowCheckbox(textTrim);
            if (el) break;
            if (attempt === 4) {
              await moveCursorTo({ x: window.innerWidth * 0.55, y: window.innerHeight * 0.42 });
            }
            await delay(280);
          }
          if (!el) {
            for (let attempt = 0; attempt < 25; attempt++) {
              if (abortedRef.current) return;
              el = findClickable(step.text);
              if (el && isVisible(el)) break;
              if (step.fallbackSelector) {
                const fb = document.querySelector(step.fallbackSelector);
                if (fb && isVisible(fb)) { el = fb; break; }
              }
              await delay(300);
            }
          }
        } else {
          for (let attempt = 0; attempt < 25; attempt++) {
            if (abortedRef.current) return;
            el = findClickable(step.text);
            if (el && isVisible(el)) break;
            if (step.fallbackSelector) {
              const fb = document.querySelector(step.fallbackSelector);
              if (fb && isVisible(fb)) { el = fb; break; }
            }
            if (attempt === 3) {
              await moveCursorTo({ x: window.innerWidth * 0.55, y: window.innerHeight * 0.5 });
            }
            await delay(300);
          }
        }

        if (!el || !isVisible(el)) {
          console.warn(`[MouseAgent] Could not find clickable: "${step.text}"`);
          await moveCursorTo({ x: window.innerWidth * 0.55, y: window.innerHeight * 0.5 });
          break;
        }

        // If the matched element is a <p> (e.g. vendor name in popup, user email in table),
        // redirect the click to the nearest checkbox/toggle in the same row so
        // the React onChange fires correctly.
        // Prefer <tr> — a parent `.CF_d-flex` is often the whole popup body and would grab the wrong checkbox.
        // Do NOT redirect workflow wizard tiles ("Onboarding", "Manual Trigger") — those must click the <p>/card itself.
        const workflowTileLabel =
          /^(onboarding|manual\s*trigger|create\s*workflow)$/i.test(String(step.text).trim());
        if ((el as HTMLElement).tagName === 'P' && !workflowTileLabel) {
          const row = el.closest('tr') ?? el.closest('.CF_d-flex');
          if (row) {
            const cb = row.querySelector<HTMLInputElement>(
              'input[type="checkbox"], .switch input'
            );
            if (cb && isVisible(cb)) el = cb;
          }
        }

        await animateClickOnElement(el);
        break;
      }

      case 'click_builder_add': {
        let el: Element | null = null;
        for (let attempt = 0; attempt < 36; attempt++) {
          if (abortedRef.current) return;
          el = findWorkflowCanvasAddButton();
          if (el && isVisible(el)) break;
          if (attempt === 4) {
            await moveCursorTo({ x: window.innerWidth * 0.55, y: window.innerHeight * 0.48 });
          }
          await delay(400);
        }
        if (!el || !isVisible(el)) {
          console.warn('[MouseAgent] Could not find workflow canvas Add control (icon / aria-label)');
          await moveCursorTo({ x: window.innerWidth * 0.55, y: window.innerHeight * 0.5 });
          break;
        }
        await animateClickOnElement(el);
        break;
      }

      case 'click_builder_save': {
        let el: Element | null = null;
        for (let attempt = 0; attempt < 28; attempt++) {
          if (abortedRef.current) return;
          el = findWorkflowSaveButton();
          if (el && isVisible(el)) break;
          if (attempt === 3) {
            await moveCursorTo({ x: window.innerWidth * 0.55, y: window.innerHeight * 0.12 });
          }
          await delay(350);
        }
        if (!el || !isVisible(el)) {
          console.warn('[MouseAgent] Could not find Save in workflow editor toolbar');
          await moveCursorTo({ x: window.innerWidth * 0.55, y: window.innerHeight * 0.15 });
          break;
        }
        await animateClickOnElement(el);
        break;
      }

      case 'workflow_drop': {
        const matchText = (step as { matchText?: string }).matchText ?? '';
        let row: Element | null = null;
        for (let attempt = 0; attempt < 32; attempt++) {
          if (abortedRef.current) return;
          row = findWorkflowDndPayloadRow(matchText || undefined);
          if (row) break;
          if (attempt === 4) {
            await moveCursorTo({ x: window.innerWidth * 0.72, y: window.innerHeight * 0.45 });
          }
          await delay(350);
        }
        if (!row) {
          console.warn('[MouseAgent] No workflow row with data-cf-dnd-payload for drop');
          await moveCursorTo({ x: window.innerWidth * 0.55, y: window.innerHeight * 0.5 });
          break;
        }
        const raw = row.getAttribute('data-cf-dnd-payload');
        if (!raw) {
          console.warn('[MouseAgent] Row missing data-cf-dnd-payload');
          break;
        }

        const rr = row.getBoundingClientRect();
        const pickUp = {
          x: rr.left + Math.min(36, rr.width * 0.22),
          y: rr.top + rr.height / 2,
        };

        await moveCursorTo(pickUp);
        await delay(140);
        if (abortedRef.current) return;

        const hiPick = highlightElement(row);
        await delay(120);
        hiPick();

        const ghost = mountWorkflowDragGhost(workflowDragGhostLabel(row));
        ghost.move(cursorPosRef.current);

        const dropZone = findWorkflowCanvasDropZone();
        if (dropZone && isVisible(dropZone)) {
          const to = getCenter(dropZone);
          await animateCursor(
            cursorPosRef.current,
            to,
            (pos) => {
              updateCursor(pos);
              ghost.move(pos);
            },
            1000,
          );
          setCursorPos({ ...to });
        } else {
          const fallback = { x: window.innerWidth * 0.44, y: window.innerHeight * 0.46 };
          await animateCursor(
            cursorPosRef.current,
            fallback,
            (pos) => {
              updateCursor(pos);
              ghost.move(pos);
            },
            780,
          );
          setCursorPos({ ...fallback });
        }

        ghost.remove();
        await delay(200);
        if (abortedRef.current) return;

        const dz = findWorkflowCanvasDropZone();
        if (dz && isVisible(dz)) {
          const pulse = highlightElement(dz);
          await delay(200);
          pulse();
        }

        const ok = dispatchWorkflowCanvasDropFromPayloadJson(raw);
        if (!ok) {
          console.warn('[MouseAgent] Could not dispatch cf:workflowDrop');
        }
        await delay(420);
        break;
      }

      case 'type': {
        let inputEl: HTMLInputElement | null = null;

        for (let attempt = 0; attempt < 25; attempt++) {
          if (abortedRef.current) return;
          inputEl = findInput({ placeholder: step.placeholder, labelText: step.labelText });
          if (inputEl && isVisible(inputEl)) break;
          if (attempt === 3) {
            await moveCursorTo({ x: window.innerWidth * 0.55, y: window.innerHeight * 0.5 });
          }
          await delay(300);
        }

        if (!inputEl || !isVisible(inputEl)) {
          console.warn(`[MouseAgent] Could not find input placeholder="${step.placeholder}"`);
          await moveCursorTo({ x: window.innerWidth * 0.55, y: window.innerHeight * 0.5 });
          break;
        }

        const center = getCenter(inputEl);
        await moveCursorTo(center);
        await delay(200);

        if (abortedRef.current) return;

        inputEl.focus();
        if (step.clear) { typeIntoReactInput(inputEl, ''); await delay(50); }

        const val = String(step.value);
        const isEmailSearch =
          (step.placeholder ?? '').toLowerCase().includes('email') && val.includes('@');

        if (isEmailSearch) {
          // One shot + input event — keeps SearchComponent state in sync; debounced API needs time below.
          typeIntoReactInput(inputEl, val);
          inputEl.dispatchEvent(
            new InputEvent('input', { bubbles: true, cancelable: true, data: val, inputType: 'insertFromPaste' }),
          );
          await delay(120);
        } else {
          for (const char of val) {
            if (abortedRef.current) return;
            typeIntoReactInput(inputEl, inputEl.value + char);
            await delay(40 + Math.random() * 40);
          }
        }
        break;
      }

      case 'pause': {
        // Show pause message in the chat panel (not as a blocking modal)
        updateState({
          status: 'paused',
          currentLabel: step.message,
          pauseMessage: step.message,
        });

        // Highlight the relevant element if provided
        if (step.highlightLabel) {
          const el = findInput({ placeholder: step.highlightLabel, labelText: step.highlightLabel })
            ?? findClickable(step.highlightLabel);
          if (el) {
            cleanupHighlightRef.current?.();
            cleanupHighlightRef.current = highlightElement(el);
            await moveCursorTo(getCenter(el));
          }
        }

        // Wait until confirmResume is called from the chat panel
        await new Promise<void>(resolve => { pauseResolveRef.current = resolve; });

        cleanupHighlightRef.current?.();
        cleanupHighlightRef.current = null;

        if (abortedRef.current) return;
        updateState({ status: 'executing', pauseMessage: null });
        break;
      }

      case 'confirm': {
        updateState({ status: 'paused', currentLabel: step.message, pauseMessage: step.message });
        await new Promise<void>(resolve => { pauseResolveRef.current = resolve; });
        if (abortedRef.current) return;
        updateState({ status: 'executing', pauseMessage: null });
        break;
      }

      case 'seek': {
        // Show label while polling
        updateState({ currentLabel: step.label });

        const timeoutMs = step.timeoutMs ?? 3000;
        const seekStart = performance.now();
        let seekEl: Element | null = null;

        while (performance.now() - seekStart < timeoutMs) {
          if (abortedRef.current) return;
          seekEl = findClickable(step.text);
          if (seekEl && isVisible(seekEl)) break;
          await delay(300);
        }

        const subSteps: Step[] = seekEl ? step.found : step.notFound;
        const branchLabel = seekEl
          ? `Found "${step.text}" — using existing workflow`
          : `No "${step.text}" workflow found — creating new`;
        updateState({ currentLabel: branchLabel });
        await delay(400);

        for (let si = 0; si < subSteps.length; si++) {
          if (abortedRef.current) return;
          while (pausedRef.current && !abortedRef.current) await delay(100);
          if (abortedRef.current) break;
          await executeStep(subSteps[si], index, total);
        }
        break;
      }
    }
  }

  async function runSteps(steps: Step[]) {
    stepsRef.current = steps;
    abortedRef.current = false;
    pausedRef.current  = false;

    updateState({
      status: 'executing',
      currentStepIndex: 0,
      totalSteps: steps.length,
      currentLabel: 'Starting…',
      pauseMessage: null,
      error: null,
    });

    // Small delay so React can mount MouseAgentOverlay and register cursor elements
    await delay(80);

    try {
      for (let i = 0; i < steps.length; i++) {
        if (abortedRef.current) break;
        while (pausedRef.current && !abortedRef.current) await delay(100);
        if (abortedRef.current) break;
        await executeStep(steps[i], i, steps.length);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      updateState({ status: 'error', error: msg });
      return;
    }

    if (!abortedRef.current) {
      updateState({ status: 'done', currentLabel: 'Done!' });
      setTimeout(() => {
        setState(INITIAL_STATE);
        cursorPosRef.current = { x: -200, y: -200 };
        setCursorPos({ x: -200, y: -200 });
      }, 2500);
    }
  }

  const startExecution = useCallback((plan: ActionPlan, startPos?: { x: number; y: number }) => {
    const steps = getSteps(plan.operation, plan.params);
    if (!steps.length) {
      console.warn(`[MouseAgent] No steps for operation: ${plan.operation}`);
      return;
    }
    // Place cursor at starting position (agent avatar) before running steps
    if (startPos) {
      cursorPosRef.current = startPos;
      setCursorPos({ ...startPos });
      // Immediately update DOM if already registered
      if (cursorHeadRef.current) {
        cursorHeadRef.current.style.left = `${startPos.x - 8}px`;
        cursorHeadRef.current.style.top  = `${startPos.y - 8}px`;
      }
    }
    void runSteps(steps);
  }, []);

  const confirmResume = useCallback(() => {
    pauseResolveRef.current?.();
    pauseResolveRef.current = null;
  }, []);

  const abort = useCallback(() => {
    abortedRef.current = true;
    pausedRef.current  = false;
    pauseResolveRef.current?.();
    pauseResolveRef.current = null;
    cleanupHighlightRef.current?.();
    cleanupHighlightRef.current = null;
    updateState({ status: 'aborted', pauseMessage: null, currentLabel: 'Stopped' });
    setTimeout(() => {
      setState(INITIAL_STATE);
      cursorPosRef.current = { x: -200, y: -200 };
      setCursorPos({ x: -200, y: -200 });
    }, 2000);
  }, []);

  const pause = useCallback(() => {
    pausedRef.current = true;
    updateState({ status: 'paused', pauseMessage: 'Paused. Click Resume to continue.' });
  }, []);

  const resume = useCallback(() => {
    pausedRef.current = false;
    updateState({ status: 'executing', pauseMessage: null });
  }, []);

  return {
    state,
    cursorPos,
    startExecution,
    confirmResume,
    abort,
    pause,
    resume,
    registerCursorElements,
  };
}

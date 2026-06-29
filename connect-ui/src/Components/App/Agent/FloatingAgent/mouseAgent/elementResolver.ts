/**
 * elementResolver.ts
 * Finds DOM elements by text content and description, since the app uses
 * React with inline styles and no predictable class names.
 */

import { getCloudName } from '../../../../helpers/helpers';

export function isVisible(el: Element): boolean {
  if (!el) return false;
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return false;
  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
  // Check ancestor hidden via inline style
  let node: Element | null = el;
  while (node) {
    const ns = window.getComputedStyle(node);
    if (ns.display === 'none' || ns.visibility === 'hidden') return false;
    node = node.parentElement;
  }
  return true;
}

export function getCenter(el: Element): { x: number; y: number } {
  const rect = el.getBoundingClientRect();
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  };
}

/** Basic email shape — used to prefer table-row checkbox targeting in Manual Trigger popup. */
export function looksLikeEmail(text: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(String(text).trim());
}

/**
 * Manual Trigger Workflow popup (`ManualTriggerComponent`) lists users in a `<table>`.
 * Prefer this over generic text matching so we click the checkbox in the correct `<tr>`.
 */
export function findManualTriggerUserRowCheckbox(email: string): HTMLInputElement | null {
  const needle = String(email).trim().toLowerCase();
  if (!needle) return null;

  const roots = document.querySelectorAll(
    '.cf_popup_container_body, [class*="cf_popup_container"]',
  );
  for (const root of roots) {
    if (!isVisible(root)) continue;
    const rows = root.querySelectorAll('table tbody tr');
    for (const tr of rows) {
      if (!isVisible(tr)) continue;
      const rowText = (tr.textContent ?? '').trim().toLowerCase();
      if (!rowText.includes(needle)) continue;
      const cb = tr.querySelector<HTMLInputElement>('input[type="checkbox"]');
      if (cb && isVisible(cb)) return cb;
    }
  }
  return null;
}

/**
 * "Run Workflow" in the manual trigger footer — skip when the parent ActionButton is disabled
 * (`cf_button_disabled` until at least one user is selected).
 */
export function findEnabledRunWorkflowControl(): Element | null {
  const candidates = document.querySelectorAll('p, button, [role="button"], a');
  for (const el of candidates) {
    const t = el.textContent?.trim() ?? '';
    if (t !== 'Run Workflow') continue;
    if (!isVisible(el)) continue;
    let node: Element | null = el;
    let disabled = false;
    while (node) {
      if (node.classList?.contains('cf_button_disabled')) {
        disabled = true;
        break;
      }
      node = node.parentElement;
    }
    if (disabled) continue;
    return el;
  }
  return null;
}

/**
 * Find a button (or similar) by its visible text content.
 * Falls back to broader tag search if button search fails.
 */
export function findByText(text: string, tag: string = 'button'): Element | null {
  const lower = text.trim().toLowerCase();

  // Search the given tag first
  const tagEls = document.querySelectorAll(tag);
  for (const el of tagEls) {
    const t = el.textContent?.trim().toLowerCase() ?? '';
    if ((t === lower || t.includes(lower)) && isVisible(el)) return el;
  }

  // Widen to spans and divs if not found
  if (tag === 'button') {
    for (const fallbackTag of ['a', 'span', 'div']) {
      const els = document.querySelectorAll(fallbackTag);
      for (const el of els) {
        const t = el.textContent?.trim().toLowerCase() ?? '';
        if (t === lower && isVisible(el)) return el;
      }
    }
  }

  return null;
}

/**
 * Score for picking among elements whose text matches the query.
 * Prefer exact label > whole-word match > shorter text (avoid long paragraphs containing the word).
 */
function clickableMatchScore(el: Element, lower: string): number {
  const t = el.textContent?.trim().toLowerCase() ?? '';
  if (!t || !isVisible(el)) return -Infinity;
  if (!lower) return -Infinity;

  const tag = el.tagName;
  const role = el.getAttribute('role');
  const tagBoost =
    role === 'button' ? 100 :
    tag === 'BUTTON' ? 90 :
    tag === 'A' ? 50 :
    tag === 'P' ? 35 :
    25;

  if (t === lower) {
    return 1_000_000 + tagBoost;
  }

  if (!t.includes(lower)) return -Infinity;

  const escaped = lower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const wordMatch = new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(t);

  if (wordMatch) {
    return 500_000 - t.length + tagBoost;
  }

  return 200_000 - t.length * 2 + tagBoost;
}

/**
 * Check if an element is inside the chat panel floating widget.
 * Helps avoid clicking elements in the chat (which is a floating overlay).
 */
function isInChatPanel(el: Element): boolean {
  // Find the chat panel — it's typically a fixed positioned div on the right
  let node: Element | null = el;
  while (node) {
    const style = window.getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    // Chat panel has fixed positioning and is typically on the right side
    if (style.position === 'fixed' && rect.right > window.innerWidth - 150) {
      // Check if it looks like a panel (has specific styling)
      if (style.zIndex && parseInt(style.zIndex) > 5000) {
        return true;
      }
    }
    node = node.parentElement;
  }
  return false;
}

/**
 * Find a clickable element (button, [role=button], a, or div with onclick) by text content.
 * Picks the best-scoring match so the first DOM hit is not always used (fixes wrong "Onboarding" clicks).
 * Prefers elements outside the chat panel (floating widget).
 */
export function findClickable(text: string): Element | null {
  const lower = text.trim().toLowerCase();
  if (!lower) return null;

  const selectors = ['button', '[role="button"]', 'a', '[onclick]'];
  const candidates: Element[] = [];

  for (const sel of selectors) {
    document.querySelectorAll(sel).forEach((el) => candidates.push(el));
  }
  document.querySelectorAll('p').forEach((el) => candidates.push(el));

  // First pass: prefer candidates NOT in chat panel
  let best: Element | null = null;
  let bestScore = -Infinity;
  for (const el of candidates) {
    if (isInChatPanel(el)) continue;  // Skip chat panel elements
    const s = clickableMatchScore(el, lower);
    if (s > bestScore) {
      bestScore = s;
      best = el;
    }
  }
  if (best && bestScore > -Infinity) return best;

  // Second pass: if not found outside chat, search in chat as fallback
  bestScore = -Infinity;
  for (const el of candidates) {
    const s = clickableMatchScore(el, lower);
    if (s > bestScore) {
      bestScore = s;
      best = el;
    }
  }
  if (best && bestScore > -Infinity) return best;

  const all = document.querySelectorAll('div, span, li, td');
  for (const el of all) {
    const direct = Array.from(el.childNodes)
      .filter(n => n.nodeType === Node.TEXT_NODE)
      .map(n => n.textContent?.trim() ?? '')
      .join('');
    if (direct.toLowerCase() === lower && isVisible(el)) return el;
  }

  return null;
}

/** Prefer main / canvas / workflow surfaces (not global header chrome). */
function inWorkflowSurface(el: Element): boolean {
  return !!(
    el.closest("main") ||
    el.closest('[class*="react-flow" i]') ||
    el.closest('[class*="workflow" i]') ||
    el.closest('[class*="canvas" i]') ||
    el.closest('[class*="builder" i]') ||
    el.closest('[class*="Workflow" i]')
  );
}

/**
 * NewFlowV4: circular “+” lives under `.cf_newFlow_canvas_action` (pannable column).
 * Zoom controls use a separate `div` with Plus (not `button`) — excluded by scoping to canvas_action.
 * Save uses an 80×35 `button` — excluded by max width.
 */
export function findWorkflowCanvasAddButton(): Element | null {
  const canvasAction = document.querySelector(".cf_newFlow_canvas_action");
  if (canvasAction) {
    const buttons = canvasAction.querySelectorAll("button.cf_action_button");
    const sized: Element[] = [];
    for (const el of buttons) {
      if (!isVisible(el)) continue;
      if (el.closest(".cf_canvas_zoom_options")) continue;
      const hasSvg = !!el.querySelector("svg");
      const r = el.getBoundingClientRect();
      const w = r.width;
      const h = r.height;
      if (hasSvg && w >= 28 && w <= 48 && h >= 28 && h <= 48) {
        sized.push(el);
      }
    }
    if (sized.length === 1) return sized[0];
    if (sized.length > 1) {
      sized.sort((a, b) => b.getBoundingClientRect().top - a.getBoundingClientRect().top);
      return sized[0];
    }
  }

  const candidates: Element[] = [];

  document
    .querySelectorAll(
      '[aria-label*="add" i], [aria-label*="Add" i], [aria-label*="step" i], [title*="add" i], [title*="Add" i]'
    )
    .forEach((el) => {
      if (!isVisible(el)) return;
      if (el.closest(".cf_canvas_zoom_options")) return;
      if (el.tagName === "BUTTON" || el.getAttribute("role") === "button" || el.tagName === "A") {
        candidates.push(el);
      }
    });

  for (const el of document.querySelectorAll('button, [role="button"]')) {
    if (!isVisible(el)) continue;
    if (el.closest(".cf_canvas_zoom_options")) continue;
    const compact = (el.textContent ?? "").replace(/\s+/g, "").toLowerCase();
    const hasSvg = !!el.querySelector("svg");
    if (hasSvg && (compact === "" || compact === "+")) {
      const r = el.getBoundingClientRect();
      if (r.width >= 10 && r.width <= 52 && r.height >= 10 && r.height <= 52) {
        candidates.push(el);
      }
    }
  }

  let best: Element | null = null;
  let bestScore = -Infinity;
  for (const el of candidates) {
    let s = 0;
    if (inWorkflowSurface(el)) s += 120;
    const al = (el.getAttribute("aria-label") ?? el.getAttribute("title") ?? "").toLowerCase();
    if (al.includes("add") || al.includes("step")) s += 100;
    const r = el.getBoundingClientRect();
    s += Math.max(0, 60 - Math.min(r.width, 60));
    if (s > bestScore) {
      bestScore = s;
      best = el;
    }
  }
  if (best) return best;
  return findClickable("+");
}

/**
 * NewFlowV4: workflow Save is in `.cf_zoom_percentage_container` without `.cf_newBox_Shadow`
 * (zoom block uses both classes). Prefer that over other "Save" buttons on the page.
 */
export function findWorkflowSaveButton(): Element | null {
  const containers = document.querySelectorAll(".cf_main_content_place .cf_zoom_percentage_container");
  for (const wrap of containers) {
    if (wrap.classList.contains("cf_newBox_Shadow")) continue;
    const btn = wrap.querySelector("button.cf_action_button");
    if (!btn || !isVisible(btn)) continue;
    const raw = btn.textContent?.trim() ?? "";
    const t = raw.toLowerCase();
    if (t === "save" || t === "save changes" || /^save\b/.test(t)) return btn;
  }

  let best: Element | null = null;
  let bestScore = -Infinity;

  for (const el of document.querySelectorAll('button, [role="button"], a')) {
    if (!isVisible(el)) continue;
    const raw = el.textContent?.trim() ?? "";
    const t = raw.toLowerCase();
    if (!t) continue;
    const isSave =
      t === "save" ||
      t === "save changes" ||
      t === "save workflow" ||
      t === "apply" ||
      /^save\b/.test(t);
    if (!isSave) continue;

    let s = 40;
    if (t === "save" || t === "save changes") s += 30;
    if (el.closest("header")) s += 200;
    if (el.closest('[class*="toolbar" i]')) s += 160;
    if (el.closest('[class*="header" i]')) s += 120;
    if (inWorkflowSurface(el)) s += 40;

    if (s > bestScore) {
      bestScore = s;
      best = el;
    }
  }

  return best ?? findClickable("Save");
}

/** Drop target for workflow drag payloads (NewFlowV4 canvas). */
export function findWorkflowCanvasDropZone(): Element | null {
  const el = document.querySelector(".cf_action_drop_pannel");
  return el && isVisible(el) ? el : null;
}

/**
 * Row in a workflow side panel with `data-cf-dnd-payload` (NewFlowActionPannelV2 or CustomTemplateActionPannel).
 * `matchText` matches visible text, `providerName`, or display name from payload JSON.
 */
export function findWorkflowDndPayloadRow(matchText?: string): Element | null {
  const hint = matchText?.trim().toLowerCase() ?? "";
  const rows = document.querySelectorAll("[data-cf-dnd-payload]");
  const visibleRows: Element[] = [];
  for (const row of rows) {
    if (!isVisible(row)) continue;
    visibleRows.push(row);
  }
  if (!visibleRows.length) return null;

  if (!hint) return visibleRows[0];

  let best: Element | null = null;
  let bestScore = -Infinity;

  for (const row of visibleRows) {
    const t = (row.textContent ?? "").trim().toLowerCase();
    let s = -Infinity;

    if (t.includes(hint)) {
      s = t === hint ? 1_000_000 : 500_000 - t.length;
    } else {
      const raw = row.getAttribute("data-cf-dnd-payload");
      if (raw) {
        try {
          const p = JSON.parse(raw) as { currentApplication?: { providerName?: string } };
          const pn = (p?.currentApplication?.providerName ?? "").toLowerCase();
          const display = (getCloudName(p?.currentApplication?.providerName ?? "") ?? "").toLowerCase();
          if (
            pn.includes(hint) ||
            hint.includes(pn) ||
            display.includes(hint) ||
            (hint.length >= 3 && display.includes(hint))
          ) {
            s = 400_000;
          }
        } catch {
          /* ignore */
        }
      }
    }

    if (s > bestScore) {
      bestScore = s;
      best = row;
    }
  }

  if (best && bestScore > -Infinity) return best;
  return visibleRows[0];
}

/**
 * Applies the same JSON as a real drag/drop by dispatching `cf:workflowDrop` — NewFlowV4 calls `handleDrop`
 * with a synthetic `dataTransfer` (native `DragEvent` does not reliably reach React’s `onDrop`).
 */
export function dispatchWorkflowCanvasDropFromPayloadJson(jsonString: string): boolean {
  if (typeof window === "undefined") return false;
  window.dispatchEvent(new CustomEvent("cf:workflowDrop", { detail: { jsonString } }));
  return true;
}

/**
 * Find an input element by placeholder text or associated label text.
 */
export function findInput(opts: { placeholder?: string; labelText?: string }): HTMLInputElement | null {
  if (opts.placeholder) {
    // Try exact match first, then partial
    const exact = document.querySelector<HTMLInputElement>(
      `input[placeholder="${opts.placeholder}"], textarea[placeholder="${opts.placeholder}"]`
    );
    if (exact && isVisible(exact)) return exact;

    // Case-insensitive partial match
    const all = document.querySelectorAll<HTMLInputElement>('input, textarea');
    for (const el of all) {
      const ph = el.placeholder?.toLowerCase() ?? '';
      if (ph.includes(opts.placeholder.toLowerCase()) && isVisible(el)) return el;
    }
  }

  if (opts.labelText) {
    const lower = opts.labelText.toLowerCase();
    // Find label elements containing the text
    const labels = document.querySelectorAll('label');
    for (const label of labels) {
      if (label.textContent?.toLowerCase().includes(lower)) {
        // Try htmlFor attribute first
        if (label.htmlFor) {
          const inp = document.getElementById(label.htmlFor) as HTMLInputElement | null;
          if (inp && isVisible(inp)) return inp;
        }
        // Try sibling input
        const sibling = label.nextElementSibling;
        if (sibling && (sibling.tagName === 'INPUT' || sibling.tagName === 'TEXTAREA') && isVisible(sibling)) {
          return sibling as HTMLInputElement;
        }
        // Try parent's input child
        const parentInp = label.closest('div, form')?.querySelector<HTMLInputElement>('input, textarea');
        if (parentInp && isVisible(parentInp)) return parentInp;
      }
    }

    // Try aria-label
    const ariaMatch = document.querySelector<HTMLInputElement>(
      `input[aria-label*="${opts.labelText}" i], textarea[aria-label*="${opts.labelText}" i]`
    );
    if (ariaMatch && isVisible(ariaMatch)) return ariaMatch;
  }

  return null;
}

/**
 * Find a nav item in the CloudFuze sidebar (`.cf_sideNav_div`) by its title text.
 * Returns the <a> link inside the matching <li> so clicking it triggers React Router navigation.
 * Scoped to the sidebar only — prevents false matches elsewhere in the DOM.
 */
export function findSidebarItem(titleText: string): HTMLAnchorElement | null {
  const sidebar = document.querySelector('.cf_sideNav_div');
  if (!sidebar) return null;
  const lower = titleText.toLowerCase();
  const items = sidebar.querySelectorAll('li');
  for (const li of items) {
    const text = (li as HTMLElement).innerText?.toLowerCase() ?? '';
    if (text.includes(lower) && isVisible(li)) {
      // Return the <a> inside so clicking it triggers React Router's Link
      const link = li.querySelector<HTMLAnchorElement>('a');
      return link ?? null;
    }
  }
  return null;
}

/**
 * Add a glowing blue ring around an element as a highlight.
 * Returns a cleanup function that removes the highlight.
 */
export function highlightElement(el: Element): () => void {
  const htmlEl = el as HTMLElement;
  const prevOutline = htmlEl.style.outline;
  const prevBoxShadow = htmlEl.style.boxShadow;
  const prevPosition = htmlEl.style.position;
  const prevZIndex = htmlEl.style.zIndex;

  htmlEl.style.outline = '2.5px solid #2563eb';
  htmlEl.style.boxShadow = '0 0 0 4px rgba(37,99,235,0.35), 0 0 16px 4px rgba(37,99,235,0.25)';
  htmlEl.style.zIndex = '99999';
  if (!prevPosition || prevPosition === 'static') {
    htmlEl.style.position = 'relative';
  }

  // Inject pulse animation if not already present
  const STYLE_ID = 'cf-highlight-pulse-style';
  if (!document.getElementById(STYLE_ID)) {
    const s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = `
      @keyframes cf-highlight-pulse {
        0%, 100% { box-shadow: 0 0 0 4px rgba(37,99,235,0.35), 0 0 16px 4px rgba(37,99,235,0.25); }
        50% { box-shadow: 0 0 0 6px rgba(37,99,235,0.55), 0 0 24px 8px rgba(37,99,235,0.4); }
      }
      .cf-el-highlight { animation: cf-highlight-pulse 1.2s ease-in-out infinite !important; }
    `;
    document.head.appendChild(s);
  }
  htmlEl.classList.add('cf-el-highlight');

  return () => {
    htmlEl.style.outline = prevOutline;
    htmlEl.style.boxShadow = prevBoxShadow;
    htmlEl.style.position = prevPosition;
    htmlEl.style.zIndex = prevZIndex;
    htmlEl.classList.remove('cf-el-highlight');
  };
}

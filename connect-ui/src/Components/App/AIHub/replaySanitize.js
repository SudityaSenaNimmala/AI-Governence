// Strips every outbound-network reference out of an rrweb event stream before it
// is handed to the Replayer.
//
// This is the PRIMARY control behind the "a replay must not phone home" rule
// (see rrwebHost.js for the CSP container, which is the second, independent
// layer). It is primary because it is deterministic and browser-independent: if
// there is no http(s) URL left in the reconstructed DOM, there is nothing for
// any engine to fetch, regardless of how well it enforces a meta CSP.
//
// The recorder runs with inlineImages:false, so a full snapshot legitimately
// contains things like <img src="https://cdn.oaistatic.com/...">. Assets the
// recorder DID inline arrive as data: URLs and are left completely alone, so
// anything that was captured still renders.
//
// Everything here mutates a deep copy — the caller keeps the untouched parse of
// the NDJSON payload, so nothing is silently destroyed on the way in.

// rrweb serialized node types (rrweb-snapshot NodeType).
const NODE_DOCUMENT = 0;
const NODE_ELEMENT = 2;
const NODE_TEXT = 3;

// rrweb EventType / IncrementalSource values we need to reach into.
const EVENT_FULL_SNAPSHOT = 2;
const EVENT_INCREMENTAL = 3;
const SRC_MUTATION = 0;
const SRC_STYLESHEET_RULE = 8;
const SRC_FONT = 10;
const SRC_STYLE_DECLARATION = 13;
const SRC_ADOPTED_STYLESHEET = 15;

// 1x1 transparent GIF. Images become this rather than losing their src entirely,
// so the element still occupies its recorded box and the layout of the replay
// matches what the user actually saw.
const BLANK_PIXEL = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
// A syntactically valid, empty data: URL — safe inside a CSS url().
const BLANK_URL = "data:,";

// Attributes whose value the browser dereferences. `href` is handled separately
// because stripping it from <a> would pointlessly break the look of the page.
const FETCHING_ATTRS = new Set([
  "src", "srcset", "poster", "background", "lowsrc", "data",
  "xlink:href", "action", "formaction", "ping", "imagesrcset",
]);
// Tags where a neutralised src should become a pixel instead of disappearing.
const PIXEL_TAGS = new Set(["img", "image", "input", "source"]);

function isInert(value) {
  const v = String(value || "").trim().toLowerCase();
  return v === "" || v.startsWith("data:") || v.startsWith("blob:") || v.startsWith("about:");
}

// Rewrites url(...) and drops @import in any CSS text. Both are network
// vectors: @import fetches a stylesheet, url() fetches images/fonts/cursors.
function sanitizeCss(css) {
  if (typeof css !== "string" || !css) return { value: css, blocked: 0 };
  let blocked = 0;
  let out = css.replace(/@import\s+[^;}]*;?/gi, () => { blocked++; return ""; });
  out = out.replace(/url\(\s*(['"]?)([^'")]*)\1\s*\)/gi, (whole, quote, url) => {
    if (isInert(url)) return whole;
    blocked++;
    return `url("${BLANK_URL}")`;
  });
  return { value: out, blocked };
}

// An attribute mutation can carry `style` as a CSSOM-ish object, e.g.
// { "background-image": ["url(https://...)", "important"] }. Walk it for strings.
function sanitizeStyleValue(value) {
  if (typeof value === "string") return sanitizeCss(value);
  if (Array.isArray(value)) {
    let blocked = 0;
    const next = value.map((v) => { const r = sanitizeStyleValue(v); blocked += r.blocked; return r.value; });
    return { value: next, blocked };
  }
  if (value && typeof value === "object") {
    let blocked = 0;
    for (const k of Object.keys(value)) {
      const r = sanitizeStyleValue(value[k]);
      blocked += r.blocked;
      value[k] = r.value;
    }
    return { value, blocked };
  }
  return { value, blocked: 0 };
}

// Neutralises one element's attribute bag in place. Returns how many live
// references were removed, which the UI reports so a reviewer can tell the
// difference between "nothing was blocked" and "this control silently did
// nothing".
function sanitizeAttributes(tagName, attrs) {
  if (!attrs || typeof attrs !== "object") return 0;
  const tag = String(tagName || "").toLowerCase();
  let blocked = 0;

  for (const name of Object.keys(attrs)) {
    const lower = name.toLowerCase();
    const value = attrs[name];

    // Captured stylesheet/inline-style text.
    if (lower === "_csstext" || lower === "style") {
      const r = sanitizeStyleValue(value);
      attrs[name] = r.value;
      blocked += r.blocked;
      continue;
    }
    // <base href> rewrites the resolution of every relative URL in the
    // document, so it can resurrect fetches the rest of this pass removed.
    if (tag === "base" && lower === "href") { delete attrs[name]; blocked++; continue; }
    // <link> is a fetch in every useful rel (stylesheet, preload, prefetch,
    // icon, manifest). When rrweb captured the CSS it lives in _cssText and the
    // tag is rebuilt as <style>, so dropping href never loses styling.
    if (tag === "link" && lower === "href") {
      if (!isInert(value)) { delete attrs[name]; blocked++; }
      continue;
    }
    // A recorded <meta http-equiv="refresh"> would try to navigate the frame.
    if (tag === "meta" && lower === "content" && String(attrs["http-equiv"] || "").toLowerCase() === "refresh") {
      delete attrs[name]; blocked++; continue;
    }
    if (!FETCHING_ATTRS.has(lower)) continue;
    if (typeof value !== "string") continue;
    if (isInert(value)) continue;

    // srcset holds a list; there is no single safe rewrite, so it goes.
    if (lower === "srcset" || lower === "imagesrcset") { delete attrs[name]; blocked++; continue; }
    if (lower === "src" && PIXEL_TAGS.has(tag)) { attrs[name] = BLANK_PIXEL; blocked++; continue; }
    delete attrs[name];
    blocked++;
  }
  return blocked;
}

function sanitizeNode(node) {
  if (!node || typeof node !== "object") return 0;
  let blocked = 0;
  if (node.type === NODE_ELEMENT) blocked += sanitizeAttributes(node.tagName, node.attributes);
  // rrweb flags text inside <style> with isStyle so it can re-adapt the CSS.
  if (node.type === NODE_TEXT && node.isStyle) {
    const r = sanitizeCss(node.textContent);
    node.textContent = r.value;
    blocked += r.blocked;
  }
  if ((node.type === NODE_ELEMENT || node.type === NODE_DOCUMENT) && Array.isArray(node.childNodes)) {
    for (const child of node.childNodes) blocked += sanitizeNode(child);
  }
  return blocked;
}

function sanitizeRuleList(list) {
  if (!Array.isArray(list)) return 0;
  let blocked = 0;
  for (const entry of list) {
    if (!entry || typeof entry !== "object" || typeof entry.rule !== "string") continue;
    const r = sanitizeCss(entry.rule);
    entry.rule = r.value;
    blocked += r.blocked;
  }
  return blocked;
}

// Returns { keep, blocked }. A Font event is dropped outright when its source is
// a URL: replay applies it with new FontFace(family, src), and there is no way
// to rewrite that into something inert while keeping the glyphs.
function sanitizeIncremental(data) {
  let blocked = 0;
  switch (data.source) {
    case SRC_MUTATION: {
      if (Array.isArray(data.adds)) for (const add of data.adds) blocked += sanitizeNode(add && add.node);
      if (Array.isArray(data.attributes)) {
        for (const mut of data.attributes) {
          if (!mut || !mut.attributes) continue;
          blocked += sanitizeAttributes(mut.tagName, mut.attributes);
        }
      }
      return { keep: true, blocked };
    }
    case SRC_STYLESHEET_RULE:
      blocked += sanitizeRuleList(data.adds);
      return { keep: true, blocked };
    case SRC_STYLE_DECLARATION: {
      if (data.set && typeof data.set.value === "string") {
        const r = sanitizeCss(data.set.value);
        data.set.value = r.value;
        blocked += r.blocked;
      }
      return { keep: true, blocked };
    }
    case SRC_ADOPTED_STYLESHEET: {
      if (Array.isArray(data.styles)) for (const s of data.styles) blocked += sanitizeRuleList(s && s.rules);
      return { keep: true, blocked };
    }
    case SRC_FONT: {
      if (!isInert(data.fontSource)) return { keep: false, blocked: blocked + 1 };
      return { keep: true, blocked };
    }
    default:
      return { keep: true, blocked };
  }
}

/**
 * @param {Array} events parsed rrweb events, in order
 * @returns {{ events: Array, blocked: number, dropped: number }}
 *   events  — a deep copy, safe to hand to the Replayer
 *   blocked — external references neutralised (0 means the stream was already clean)
 *   dropped — whole events removed because they could not be neutralised (web fonts)
 */
export function sanitizeReplayEvents(events) {
  if (!Array.isArray(events)) return { events: [], blocked: 0, dropped: 0 };
  let blocked = 0;
  let dropped = 0;
  const out = [];

  for (const original of events) {
    if (!original || typeof original !== "object") continue;
    let event;
    try {
      // structuredClone would be faster but chokes on nothing here — JSON is
      // used because every event came from JSON in the first place, so the
      // round trip is lossless by construction.
      event = JSON.parse(JSON.stringify(original));
    } catch {
      dropped++;
      continue;
    }
    const data = event.data;
    if (event.type === EVENT_FULL_SNAPSHOT && data) {
      blocked += sanitizeNode(data.node);
    } else if (event.type === EVENT_INCREMENTAL && data) {
      const r = sanitizeIncremental(data);
      blocked += r.blocked;
      if (!r.keep) { dropped++; continue; }
    }
    out.push(event);
  }
  return { events: out, blocked, dropped };
}

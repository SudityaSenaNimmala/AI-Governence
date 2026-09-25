// The in-page toast builds its markup with innerHTML. Everything interpolated
// into it must be escaped first.
//
// THE DEFECT. showWarning() interpolated `title`, `m.pattern` and `m.severity`
// raw. That was defensible exactly as long as every caller passed a pattern NAME
// out of content/patterns.js — a fixed set of strings this repo authors. The
// per-agent block broke that: showBlockedAgentPopup() falls back to
//
//     showWarning([{ pattern: 'Blocked agent: ' + agent.agent_name, … }], …)
//
// and agent_name is free text an admin typed into AI Hub (or, for a discovered
// agent, a name that came from the tenant's own directory). One `<img onerror>`
// in that field is script execution in EVERY page the extension is injected
// into — which is all of them — with the content script's DOM access. The sister
// renderer showCfaiPopup() has used escapeHtml() on exactly these fields since it
// shipped; this pins the same treatment here.
//
// The region is sliced out of content/content.js the same way the other loaders
// here do it: the file is one classic-script IIFE that cannot be imported. Its
// free variables are document, escapeHtml and setTimeout — and escapeHtml is the
// REAL one, also sliced from content.js, because a stub would let an escaping
// change that breaks the helper pass here.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(here, '..', 'content', 'content.js'), 'utf8');

const START = '// ---- UI: subtle in-page toast ----';
const END = '// ---- Event wiring ----';

function toastRegion() {
  const from = src.indexOf(START);
  const to = src.indexOf(END);
  if (from < 0) throw new Error(`content.js sentinel not found: ${START}`);
  if (to <= from) throw new Error('content.js toast sentinels are missing or out of order');
  return src.slice(from, to);
}

function escapeHtmlRegion() {
  const at = src.indexOf('function escapeHtml(s) {');
  if (at < 0) throw new Error('content.js escapeHtml() not found');
  return src.slice(at, src.indexOf('\n  }', at) + 4);
}

/** A DOM stub that records the toast's markup. */
function load() {
  const removed = [];
  const appended = [];

  const makeEl = () => {
    const el = {
      className: '',
      innerHTML: '',
      listeners: [],
      contains: () => false,
      remove() { removed.push(el); },
      addEventListener(type, fn) { el.listeners.push([type, fn]); },
      querySelector: () => makeEl(),
    };
    return el;
  };

  const document = {
    querySelector: () => null,          // no pre-existing toast
    createElement: () => makeEl(),
    body: { appendChild: (el) => appended.push(el) },
    addEventListener: () => {},
    removeEventListener: () => {},
  };

  const body = toastRegion() + '\n' + escapeHtmlRegion()
    + '\n  return { showWarning, tagSeverity };';
  // eslint-disable-next-line no-new-func
  const api = new Function('document', 'setTimeout', body)(document, () => 0);

  return {
    ...api,
    /** The markup of the most recently rendered toast. */
    html: () => (appended.length ? appended[appended.length - 1].innerHTML : ''),
  };
}

const XSS = '<img src=x onerror="alert(1)">';

test('a hostile agent name cannot inject markup through the tag body', () => {
  const t = load();
  t.showWarning([{ pattern: 'Blocked agent: ' + XSS, severity: 'critical', count: 1 }],
    'Agent blocked by organization policy');

  const html = t.html();
  assert.ok(!html.includes('<img'), 'the raw tag must not survive into the toast markup');
  assert.ok(!html.includes('onerror="'), 'nor the raw event-handler attribute');
  assert.ok(html.includes('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;'),
    'it must appear as escaped text instead');
  // …and the structure the CSS depends on is still real markup, not escaped.
  assert.ok(html.includes('<span class="cfai-tag cfai-critical">'),
    'escaping must not flatten the nested spans the stylesheet targets');
});

test('the title is escaped too', () => {
  const t = load();
  t.showWarning([{ pattern: 'SSN', severity: 'high', count: 1 }], XSS);
  const html = t.html();
  assert.ok(!html.includes('<img'));
  assert.ok(html.includes('<div class="cfai-toast-title">&lt;img'),
    'the title sits in the same innerHTML template and is no more trusted');
});

test('a hostile severity cannot break out of the class attribute', () => {
  const t = load();
  t.showWarning([{ pattern: 'SSN', severity: 'low" onmouseover="alert(1)', count: 1 }], 'Title');
  const html = t.html();
  assert.ok(!html.includes('onmouseover'),
    'severity is interpolated INSIDE an attribute, where escaping alone is not the whole story');
  assert.ok(html.includes('<span class="cfai-tag cfai-low">'),
    'an unrecognised severity falls back to the lowest one');
});

test('the four severities the stylesheet defines pass through unchanged', () => {
  for (const sev of ['critical', 'high', 'moderate', 'low']) {
    assert.equal(load().tagSeverity(sev), sev);
  }
  assert.equal(load().tagSeverity('CRITICAL'), 'critical', 'case is normalised, not rejected');
  for (const junk of ['', null, undefined, 'unknown', 'severe']) {
    assert.equal(load().tagSeverity(junk), 'low');
  }
});

test('an ordinary pattern name still renders exactly as before', () => {
  const t = load();
  t.showWarning([
    { pattern: 'US SSN', severity: 'critical', count: 1 },
    { pattern: 'AWS Access Key', severity: 'high', count: 1 },
  ]);
  const html = t.html();
  assert.ok(html.includes('<span class="cfai-tag cfai-critical">US SSN</span>'));
  assert.ok(html.includes('<span class="cfai-tag cfai-high">AWS Access Key</span>'));
  assert.ok(html.includes('<div class="cfai-toast-title">Sensitive data detected</div>'));
});

// ── Pinned on shipped source ────────────────────────────────────────────────

test('no value reaches the toast template unescaped', () => {
  const region = toastRegion();
  const template = region.slice(region.indexOf('toast.innerHTML'), region.indexOf('document.body.appendChild'));
  const interpolations = template.match(/\$\{[^}]*\}/g) || [];
  assert.ok(interpolations.length >= 3, 'the template should still be building the toast');
  for (const expr of interpolations) {
    assert.ok(/escapeHtml\(|tagSeverity\(|\.join\(/.test(expr),
      `every interpolation must be escaped or constrained — found ${expr}`);
  }
});

// Behavioural coverage for the keystroke enforcer's BROWSER (web-surface) path.
//
// TWO classes of assertion live here, and both matter:
//
//   1. SOURCE INVARIANTS, asserted by parsing enforcer-win.ps1 — the same
//      technique os-monitor-safety.test.mjs uses. These pin the things that
//      cannot be observed from outside: that the keyboard hook never resolves a
//      URL, that no URL or window title can reach an emitter, that a browser
//      never lands in the AI-process set.
//
//   2. BEHAVIOUR, driven through tests/helpers/browser-block-harness.ps1, which
//      compiles the REAL C# out of the .ps1 and drives the REAL poll-thread
//      state machine (ApplyForegroundTick / CheckFgBlocked / UpdateBrowserNav)
//      and the REAL Enter predicate (EnterBlockActive). Nothing installs a
//      keyboard hook. The only things substituted are the two READS — the
//      omnibox URL and AutomationElement.FocusedElement — and even those are
//      fed through the production classifiers (HostFromBrowserUrl,
//      MatchWebSurface, NameLooksLikeBrowserChrome), so the normalisation, the
//      dot-boundary suffix rule and the omnibox exclusion are all production
//      code here.
//
// THE MOST IMPORTANT TEST IN THIS FILE is 'the shipped catalog is completely
// inert': every WEB_SURFACES entry ships enforce:false, verified:false, and
// with those flags nothing in a browser is captured, scanned, offered or
// blocked. Every scenario below that shows blocking runs against a TEST-ONLY
// flip of claude.ai's pair, which is what lets the behaviour be exercised
// without arming it for anyone.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const AGENT_DIR = join(HERE, '..');
const ENFORCER = join(AGENT_DIR, 'src', 'os_monitor', 'enforcer-win.ps1');
const HARNESS = join(HERE, 'helpers', 'browser-block-harness.ps1');

const win = process.platform === 'win32';

let cached = null;
function runHarness() {
  if (cached) return cached;
  cached = new Promise((resolve, reject) => {
    const child = spawn('powershell', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', HARNESS, '-Ps1', ENFORCER,
    ], { windowsHide: true });
    let out = '';
    let err = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (c) => { out += c; });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (c) => { err += c; });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code !== 0) return reject(new Error(`harness exited ${code}: ${err.slice(0, 2000)}`));
      const rows = [];
      const gov = [];
      for (const line of out.split(/\r?\n/)) {
        const s = line.trim();
        if (!s.startsWith('{')) continue;
        let ev;
        try { ev = JSON.parse(s); } catch { continue; }
        if (ev.kind === 'govstate') gov.push(ev);
        else rows.push(ev);
      }
      if (!rows.length) return reject(new Error(`harness produced no observations: ${err.slice(0, 2000)}`));
      resolve({ rows, gov });
    });
  });
  return cached;
}

async function scenario(name) {
  const { rows } = await runHarness();
  const hit = rows.filter((r) => r.scenario === name);
  assert.ok(hit.length > 0, `no observations for scenario ${name}`);
  return hit;
}

async function enforcerSrc() {
  return readFile(ENFORCER, 'utf8');
}
function codeOnly(src) {
  return src.split(/\r?\n/).filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('#')).join('\n');
}

// ── SOURCE INVARIANTS ───────────────────────────────────────────────────────

test('the keyboard hook never resolves a URL, walks a tree, or scans', async () => {
  // The hook must decide SYNCHRONOUSLY. Resolving a URL means walking another
  // process's accessibility tree — measured 72-189ms for FindAll(Edit) on a
  // browser window — so the hook may read only pre-computed booleans the poll
  // thread published, and never an AutomationElement.
  const src = await enforcerSrc();
  const hook = src.slice(src.indexOf('static IntPtr HookCallback('), src.indexOf('// Scans the typed buffer'));
  assert.ok(hook.length > 0, 'expected a HookCallback body');
  for (const forbidden of [
    'GetCachedBrowserUrl', 'HostFromBrowserUrl', 'ReadFocusedWebComposer', 'MatchWebSurface',
    'EnforcingWebSurface', 'CurrentWebSurface', 'SearchOmniboxBackground', 'UpdateBrowserNav',
    'ReadTitleRaw', 'TitleFingerprint', 'AutomationElement', 'FindAll', 'TreeWalker',
    'Rescan()', 'ScanNames(', 'new Regex',
  ]) {
    assert.equal(hook.includes(forbidden), false, `the hook must not reach ${forbidden}`);
  }
  // What it MAY read: two pre-computed booleans and a timestamp it writes.
  assert.match(hook, /if \(_fgIsBrowser\)/);
  assert.match(hook, /\(vk == VK_RETURN && _fgWebChromeFocused\)/);
  // A TIMESTAMP only — never which key, and never our own synthetic input.
  assert.match(hook, /if \(\(navFlags & LLKHF_INJECTED\) == 0\) _browserNavInputTicks = DateTime\.UtcNow\.Ticks;/);
  // …and it is a SEPARATE field from the panel machinery's focus-move stamp, so
  // nothing about the panel latch changes.
  assert.notEqual(src.indexOf('static long _lastFocusMoveInputTicks = 0;'), -1);
  assert.notEqual(src.indexOf('static long _browserNavInputTicks = 0;'), -1);
});

test('a browser process never lands in the AI, IDE or host-app sets', async () => {
  // The single worst failure mode of this whole feature. A browser in _aiProcs
  // makes the ENTIRE browser an AI surface, so FgIsAiNow() is true in every tab
  // and the Enter decision runs over a keystroke buffer reconstructed from the
  // user's Gmail, their wiki edits and their web logins.
  const src = await enforcerSrc();
  const code = codeOnly(src);
  assert.match(code, /static HashSet<string> _browserProcs = new HashSet<string>\(StringComparer\.OrdinalIgnoreCase\);/);
  // Written in exactly one place, from the catalog payload.
  assert.equal((code.match(/_browserProcs = procs;/g) || []).length, 1, 'exactly one place may write the browser set');
  assert.equal((code.match(/^\s*_browserProcs = /gm) || []).length, 1, 'no second assignment site may exist');
  // The loader adds ONLY to its own set.
  const load = src.slice(src.indexOf('static void LoadBrowserProcesses(string[] names)'), src.indexOf('static void LoadWebSurfaces(string json)'));
  assert.ok(load.length > 0, 'expected a LoadBrowserProcesses body');
  for (const forbidden of ['_aiProcs', '_ideProcs', '_hostAppProcs', '_agentScopedProcs', '_dlpScopedProcs']) {
    assert.equal(load.includes(forbidden), false, `LoadBrowserProcesses must not touch ${forbidden}`);
  }
  // …and the browser PAYLOAD reaches none of the other three sets. Start()
  // hands each list to exactly one loader, and the browser one is its own.
  const startIdx = src.indexOf('public static void Start(');
  const startEnd = src.indexOf('static string StripExe(');
  assert.ok(startIdx >= 0 && startEnd > startIdx, 'could not locate the Start body');
  const start = src.slice(startIdx, startEnd);
  assert.match(start, /LoadBrowserProcesses\(browserProcs\);/);
  assert.equal((start.match(/\bbrowserProcs\b/g) || []).length, 2,
    'the browser process list may reach exactly one loader (the parameter and the call)');
  assert.equal((start.match(/\bwebSurfacesJson\b/g) || []).length, 3,
    'the web-surface payload may reach exactly one loader (the parameter, its guard and the call)');
  // The AI set is still built only from its own parameter.
  assert.match(start, /foreach \(var p in aiProcs\) \{ if \(!string\.IsNullOrEmpty\(p\)\) _aiProcs\.Add\(p\.Replace\("\.exe", ""\)\); \}/);
  assert.equal((code.match(/_aiProcs\.Add\(/g) || []).length, 1, 'the AI set has exactly one build site');
  // PLATFORM_PROCS — the hand-maintained twin of ai-processes.js's copy, held in
  // lockstep by ai-processes.test.mjs — must gain NO browser entry. The
  // platform-to-host pairing travels inside CFAI_WEB_SURFACES instead.
  const platform = src.slice(src.indexOf('PLATFORM_PROCS = new Dictionary'), src.indexOf('// Typed-buffer block.'));
  for (const b of ['chrome', 'msedge', 'brave', 'vivaldi', 'opera', 'firefox']) {
    assert.equal(new RegExp(`"${b}"`, 'i').test(platform), false, `${b} must not be in PLATFORM_PROCS`);
  }
});

test('no URL, path, query string or window title can reach an emitter', async () => {
  // A query string on an AI URL routinely CONTAINS THE PROMPT, so a URL-shaped
  // field on any event would be prompt content wearing a governance label.
  const src = await enforcerSrc();
  // STRUCTURAL, not a matter of care: GetCachedBrowserUrl hands its caller a
  // HOST through an out parameter and lets the URL die as a local, so there is
  // no expression anywhere in the file that evaluates to a URL.
  const resolver = src.slice(src.indexOf('static WebReadOutcome GetCachedBrowserUrl('), src.indexOf('// ---- The window-title fingerprint'));
  assert.ok(resolver.length > 0, 'expected a GetCachedBrowserUrl body');
  assert.match(resolver, /static WebReadOutcome GetCachedBrowserUrl\(IntPtr fg, out string host\)/);
  assert.equal(/Emit|Console\.Out/.test(resolver), false, 'the URL resolver must emit nothing');
  // The raw value is a LOCAL, and the only thing derived from it that escapes is
  // a host.
  assert.match(resolver, /string h = HostFromBrowserUrl\(raw\);/);
  assert.equal(/= raw;|_\w+ = raw\b/.test(resolver), false, 'the raw URL must never be stored in a field');
  // Every emitter: no URL, no path, no query, no title.
  for (const [name, from, to] of [
    ['Emit', 'static void Emit(string kind', 'static string Esc(string s)'],
    ['EmitBlock', 'static void EmitBlock(', 'static void EmitRewrite('],
    ['EmitRewrite', 'static void EmitRewrite(', 'static void OfferAccessRequest('],
    ['EmitGovState', 'static void EmitGovState(', 'static void UpdateForeground()'],
    ['EmitBlockState', 'static void EmitBlockState(', 'static void ClearFgBlocked()'],
    ['EmitRoute', 'static void EmitRoute(', 'static readonly object _routeLock'],
  ]) {
    const body = src.slice(src.indexOf(from), src.indexOf(to));
    assert.ok(body.length > 0, `expected a ${name} body`);
    for (const forbidden of [
      'GetCachedBrowserUrl', 'HostFromBrowserUrl', '_browserUrlHost', 'raw',
      'AbsolutePath', '.Query', 'Uri', 'ReadTitleRaw', 'GetWindowText',
      'TitleFingerprint', '_browserTitleFingerprint', '_omniboxCached',
    ]) {
      assert.equal(body.includes(forbidden), false, `${name} must not carry ${forbidden}`);
    }
  }
  // The ONE browser field that travels is built in ONE place, from the catalog.
  const field = src.slice(src.indexOf('static string BrowserHostField()'), src.indexOf('static void Emit(string kind'));
  assert.ok(field.length > 0, 'expected a BrowserHostField body');
  assert.match(field, /string host = _blockedBrowserHost \?\? "";/);
  assert.match(field, /WebSurface web = CurrentWebSurface\(\);/);
  assert.match(field, /if \(web != null\) host = web\.Host \?\? "";/);
  // …and the two sources are themselves catalog values: the block arm assigns
  // _blockedBrowserHost from web.Host, and CurrentWebSurface returns a catalog
  // entry. Neither can be a subdomain, a URL or a title.
  const check = src.slice(src.indexOf('static void CheckFgBlocked()'), src.indexOf('static string BlockScope()'));
  assert.match(check, /_blockedBrowserHost = web\.Host;/);
  assert.equal((codeOnly(src).match(/_blockedBrowserHost = (?!"";)/g) || []).length, 1,
    'the blocked browser host may only be assigned from the catalog entry');
});

test('the omnibox finder and the composer exclusion are THE SAME test', async () => {
  // THE INVARIANT. Anything the finder is willing to read a URL out of must
  // never be read as a composer — a narrower exclusion than the finder leaves a
  // gap by construction, and the gap is the ADDRESS BAR, where people paste
  // internal hostnames, signed S3 links and password-reset URLs.
  const src = await enforcerSrc();
  assert.match(src, /static bool NameLooksLikeBrowserChrome\(string name\)/);
  const finder = src.slice(src.indexOf('static void SearchOmniboxBackground('), src.indexOf('// ---- FAST PATH'));
  const reader = src.slice(src.indexOf('static bool ReadFocusedWebComposer('), src.indexOf('// Is a "web"-scoped block allowed'));
  assert.ok(finder.length > 0 && reader.length > 0);
  // ONE function, used by BOTH. Not two lists that could drift.
  assert.match(finder, /if \(!NameLooksLikeBrowserChrome\(name\)\) continue;/);
  assert.match(reader, /chromeFocused = NameLooksLikeBrowserChrome\(name\);/);
  assert.match(reader, /if \(chromeFocused\) return false;/);
  // The CACHED composer is re-checked against the same predicate on every read
  // (see CachedWebComposer): the element passed the test when it was focused,
  // and a site that relabels it into something chrome-shaped must not keep
  // being read. So: one definition and THREE callers — the finder, the
  // focused-element exclusion, and the cache re-verification.
  const reverify = src.slice(src.indexOf('static AutomationElement VerifiedWebComposer('), src.indexOf('static void SearchWebComposerBackground('));
  assert.match(reverify, /if \(NameLooksLikeBrowserChrome\(name\)\) \{ DropWebComposer\(\); return null; \}/,
    'the cached composer must be re-checked against the chrome predicate');
  assert.equal((codeOnly(src).match(/NameLooksLikeBrowserChrome\(/g) || []).length, 7,
    'one definition and exactly six callers — the finder, the focused-element exclusion, '
    + 'the cache re-verify, the composer background search, and (AI-216) the model '
    + 'picker background search and its route-thread re-find');
  // THE FIFTH AND SIXTH CALLERS (AI-216). The picker search matches on the
  // catalog's live-probed name PREFIX ("Model:"), which is a weaker signal than
  // an exact composer name — so a catalog typo naming something chrome-shaped
  // would otherwise point a descendant walk straight at the address bar. Both
  // the background search and the route thread's fresh re-find refuse on the
  // same shared predicate as everything else.
  for (const [what, from, to] of [
    ['SearchWebPickerBackground', 'static void SearchWebPickerBackground(', 'static void MaybeSearchWebPicker('],
    ['FindWebPickerButton', 'static AutomationElement FindWebPickerButton(', 'static AutomationElement FindWebPickerItemUnique('],
  ]) {
    const body = src.slice(src.indexOf(from), src.indexOf(to));
    assert.ok(body.length > 0, `expected a ${what} body`);
    assert.match(body, /NameLooksLikeBrowserChrome\(name\)/,
      `${what} must refuse on the shared browser-chrome predicate`);
  }
  // THE FOURTH CALLER. The background search matches on the catalog's composer
  // name, so a catalog typo naming something chrome-shaped would otherwise point
  // it straight at the address bar — the exact gap this invariant exists to
  // close. It refuses on the shared predicate like everything else.
  const composerSearch = src.slice(
    src.indexOf('static void SearchWebComposerBackground('),
    src.indexOf('static void MaybeSearchWebComposer('));
  assert.ok(composerSearch.length > 0, 'expected a SearchWebComposerBackground body');
  assert.match(composerSearch, /if \(NameLooksLikeBrowserChrome\(name\)\) continue;/);
  // An UNREADABLE name is treated as chrome: the failure direction is a MISS,
  // never a leak.
  const fn = src.slice(src.indexOf('static bool NameLooksLikeBrowserChrome(string name)'), src.indexOf('// ---- URL -> host'));
  assert.match(fn, /if \(name == null\) return true;/);
  // And the reader keeps the Name NULL on a failed read, so that null is
  // load-bearing rather than incidental.
  assert.match(reader, /try \{ name = el\.Current\.Name; \} catch \{ name = null; \}/);
  // The token list covers the two measured omnibox names.
  assert.match(src, /BROWSER_CHROME_NAME_TOKENS = new string\[\] \{ "address", "url", "search bar", "location" \};/);
  for (const measured of ['Address and search bar', 'Search with Google or enter address']) {
    const n = measured.toLowerCase();
    assert.ok(['address', 'url', 'search bar', 'location'].some((t) => n.includes(t)),
      `the measured omnibox name ${JSON.stringify(measured)} is not covered`);
  }
});

test('a password field and a non-composer element are refused, fail-closed on a throw', async () => {
  // A web login form is the single worst thing a keystroke buffer could
  // reconstruct, and IsPassword is the one property that names it.
  const src = await enforcerSrc();
  const reader = src.slice(src.indexOf('static bool ReadFocusedWebComposer('), src.indexOf('// Is a "web"-scoped block allowed'));
  assert.match(reader, /if \(isPassword\) return false;/);
  assert.match(reader, /if \(!focusable\) return false;/);
  // Both default to the REFUSING value, so a property that throws refuses the
  // composer rather than being assumed benign.
  assert.match(reader, /bool isPassword = true, focusable = false;/);
  assert.match(reader, /try \{ isPassword = el\.Current\.IsPassword; \} catch \{ isPassword = true; \}/);
  assert.match(reader, /try \{ focusable = el\.Current\.IsKeyboardFocusable; \} catch \{ focusable = false; \}/);
  // EDIT ONLY — narrowed further than it started (Document was dropped), and
  // narrower than the capture watcher's rule, because the failure direction for
  // something that swallows keystrokes must be a MISS. A composer that reports
  // as Document is therefore ungoverned rather than governed-by-guess.
  // AI-219: the type is CATALOG DATA now, defaulted to "Edit" for every surface
  // that declares none -- so this demand is byte-for-byte what it was on the
  // four surfaces that predate the field. Gemini Enterprise's composer is a
  // [Group]; a hard-coded "Edit" here would silently ungovern it.
  assert.match(reader, /if \(!string\.Equals\(ctName, WebComposerControlType\(host\), StringComparison\.OrdinalIgnoreCase\)\) return false;/);
  assert.equal(/"Document"/.test(reader), false,
    'Document must not be accepted as a composer — it widens what can swallow keystrokes');
  // And the SAME control-type test guards the cached re-read, so a cached
  // element cannot outlive its own eligibility.
  const reverify2 = src.slice(src.indexOf('static AutomationElement VerifiedWebComposer('), src.indexOf('static void DropWebComposer('));
  // AI-219: same substitution and the same default as the focused read. The
  // two must make the IDENTICAL demand, or an element the focused read accepted
  // would be dropped by the re-verify on the very next tick.
  assert.match(reverify2, /if \(!string\.Equals\(ctName, WebComposerControlType\(host\), StringComparison\.OrdinalIgnoreCase\)\) \{ DropWebComposer\(\); return null; \}/);
  // ONE property read, never a tree walk — the same discipline as the panel and
  // agent reads. Scoped to the FUNCTION, not to everything up to a section
  // comment several functions later: SearchWebComposerBackground now sits
  // between the two, and a slice that swept it up would report the search's
  // descendant walk as this function's.
  const readerFn = src.slice(src.indexOf('static bool ReadFocusedWebComposer('),
                             src.indexOf('// ---- Re-verify the cached composer'));
  assert.ok(readerFn.length > 0, 'expected a ReadFocusedWebComposer body');
  assert.match(readerFn, /AutomationElement\.FocusedElement/);
  assert.equal(/FindAll|TreeWalker|GetFirstChild/.test(readerFn), false,
    'the FOCUSED composer read must not walk the tree — its proof is the caret, not a search');
  assert.equal(/Emit\(|EmitBlock\(|Console\.Out/.test(readerFn), false, 'the composer read must emit nothing');
});

test('the omnibox search runs OFF the poll thread and is throttled', async () => {
  // FindAll(Edit) over a browser window was measured at 72-189ms live — a large
  // fraction of the 150ms poll tick, whose other jobs (UpdateUia's content scan
  // above all) must never queue behind it.
  const src = await enforcerSrc();
  const getter = src.slice(src.indexOf('static WebReadOutcome GetCachedBrowserUrl('), src.indexOf('// ---- The window-title fingerprint'));
  assert.match(getter, /var t = new Thread\(\(\) => SearchOmniboxBackground\(fg\)\);/);
  assert.match(getter, /t\.SetApartmentState\(ApartmentState\.STA\);/);
  assert.match(getter, /t\.IsBackground = true;/);
  // A reentrancy guard, released in a finally so a throwing search cannot wedge
  // the mechanism permanently.
  assert.match(getter, /if \(string\.IsNullOrEmpty\(raw\) && !_omniboxSearchInProgress/);
  const search = src.slice(src.indexOf('static void SearchOmniboxBackground('), src.indexOf('// ---- FAST PATH'));
  assert.match(search, /finally \{ _omniboxSearchInProgress = false; \}/);
  // The empty-run backoff, the same shape the heading search uses.
  assert.match(src, /const int OMNIBOX_EMPTY_RUNS_BEFORE_BACKOFF = 3;/);
  assert.match(src, /OMNIBOX_SEARCH_MIN_INTERVAL = TimeSpan\.FromSeconds\(1\)\.Ticks;/);
  assert.match(src, /OMNIBOX_SEARCH_BACKOFF_INTERVAL = TimeSpan\.FromSeconds\(5\)\.Ticks;/);
  // The FAST path is a value re-read off the CACHED element — no tree walk on
  // the poll thread at all.
  assert.match(getter, /if \(cached\.TryGetCurrentPattern\(ValuePattern\.Pattern, out pattern\)\)/);
  assert.equal(/FindAll|TreeWalker/.test(getter), false, 'the poll-thread path must not walk the tree');
  // 2s, not 3s, because THIS cache gates a block.
  assert.match(src, /BROWSER_URL_TTL = TimeSpan\.FromSeconds\(2\)\.Ticks;/);
});

test('the browser path adds no Regex, and the send-rect hunt is skipped', async () => {
  const src = await enforcerSrc();
  const section = src.slice(src.indexOf('// ======================= BROWSER SURFACES'), src.indexOf('static void StdinLoop()'));
  assert.ok(section.length > 0, 'expected the browser section');
  // ONE Regex lives in the browser path since AI-219, and it is the only one
  // that may: the catalog-supplied agent-id extractor. It is here rather than
  // hand-rolled because the pattern is DATA (a surface declares its own), and
  // it is bounded by the same 25ms REGEX_TIMEOUT every other rule in this file
  // carries. Everything the original invariant was protecting still holds --
  // no regex on the hook path (asserted separately), no ad-hoc regex parsing of
  // a URL, and no untimed pattern anywhere.
  const regexes = section.match(/new Regex\([^;]*\)/g) || [];
  assert.equal(regexes.length, 1, `the browser path may build exactly one Regex, found ${regexes.length}`);
  assert.match(regexes[0], /new Regex\(pattern, RegexOptions\.CultureInvariant, REGEX_TIMEOUT\)/);
  const extractor = section.slice(section.indexOf('static string AgentIdFromBrowserUrl('));
  assert.ok(extractor.indexOf('new Regex(') > 0 && extractor.indexOf('new Regex(') < 2000,
    'the only browser-path Regex must be the agent-id extractor');
  assert.equal(/Regex\.(IsMatch|Replace)/.test(section), false, 'no static Regex helpers in the browser path');
  // …and the global invariant still holds.
  for (const c of src.match(/new Regex\([^)]*\)/g) || []) {
    assert.match(c, /REGEX_TIMEOUT/, `Regex built without a timeout: ${c}`);
  }
  // A browser is diverted away from UpdateSendRect's two GENERIC attempts --
  // the "name contains send/submit" descendant search, which across a whole
  // website is a lottery, and the bottom-right-corner heuristic, which in a
  // browser points at ARBITRARY PAGE CONTENT. It is no longer excluded from
  // click blocking altogether: it gets a narrower catalog-driven path of its
  // own. The ORDERING that guarantees it never reaches either generic attempt
  // is asserted in 'the click path is gated on BOTH catalog fields'.
  assert.match(src, /if \(ForegroundIsBrowser\(\)\) \{ UpdateWebSendRect\(\); return; \}/);
  assert.match(src, /if \(_ideProcs\.Contains\(_app\) \|\| _hostAppProcs\.Contains\(_app\)\) \{ _hasRect = false; return; \}/);
});

test('both browser flags are read in exactly one place', async () => {
  // EnforcingWebSurface is the twin of EnforcingAgentSurface: one gate, both
  // flags, so no call site can consult one and forget the other — and arming a
  // host live is a data change in ai-processes.js with no code change anywhere.
  const src = await enforcerSrc();
  const code = codeOnly(src);
  const gate = src.slice(src.indexOf('static WebSurface EnforcingWebSurface(string host)'), src.indexOf('// The surface the CURRENT tick is on'));
  assert.ok(gate.length > 0, 'expected an EnforcingWebSurface body');
  assert.match(gate, /return \(s\.Verified && s\.Enforce\) \? s : null;/);
  // Read NOWHERE else. Counted so a second reader has to be re-reviewed.
  // THREE gates now, not two. AI-216 added the model picker's OWN pair, read in
  // exactly one place (EnforcingWebPicker) for the same reason the surface's own
  // pair and agentRead's are: no call site may consult one flag and forget the
  // other. Counted so a FOURTH reader has to be re-reviewed.
  // FIVE since the composer census (2026-09-28): its per-surface
  // attachCensus {enforce, verified} pair is read twice -- once to decide a
  // hold may be armed from a fresh census, once to stamp the census line's own
  // "enforce" flag -- both requiring Enforce && Verified together.
  assert.equal((code.match(/\.Verified/g) || []).length, 5,
    'Verified is read in the two surface gates, the model-picker gate and the census gate only');
  const pickerGate = src.slice(src.indexOf('static WebPicker EnforcingWebPicker(WebSurface web)'),
                               src.indexOf('// The menu-item label this surface uses for a tier number'));
  assert.ok(pickerGate.length > 0, 'expected an EnforcingWebPicker body');
  assert.match(pickerGate, /if \(!p\.Enforce \|\| !p\.Verified\) return null;/,
    'the picker gate must read BOTH of its flags, in one place');
  // It takes the SURFACE, not a host: the caller must already hold a surface
  // that passed EnforcingWebSurface, so routing can never be reached on a host
  // that is not itself cleared to enforce. Two gates in series.
  assert.match(pickerGate, /static WebPicker EnforcingWebPicker\(WebSurface web\)/);
  const enforceReads = (code.match(/\bEnforce\b/g) || []);
  assert.ok(enforceReads.length > 0);
  assert.equal(/web\.Enforce|s\.Enforce &&/.test(code.replace('(s.Verified && s.Enforce)', '')), false,
    'the browser enforce flag may only be read inside EnforcingWebSurface');
  // The whole-feature inert gate: with no surface past its flags, not one read
  // happens.
  assert.match(code, /static volatile bool _anyWebSurfaceEnforcing = false;/);
  assert.equal((code.match(/_anyWebSurfaceEnforcing = /g) || []).length, 2, 'set at its declaration and in the loader only');
  const fg = src.slice(src.indexOf('static void UpdateForeground()'), src.indexOf('// Everything UpdateForeground does once the focused-element read is in.'));
  assert.match(fg, /bool browserArmed = !isIde && proc != null && _browserProcs\.Contains\(proc\) && _anyWebSurfaceEnforcing;/);
  const armedIdx = fg.indexOf('bool browserArmed =');
  assert.ok(armedIdx >= 0 && armedIdx < fg.indexOf('GetCachedBrowserUrl('),
    'the inert gate must be decided before any browser read happens');
  // The element read additionally requires THIS host to be past its flags.
  assert.match(fg, /if \(webOutcome == WebReadOutcome\.Surface && EnforcingWebSurface\(webHost\) != null\)/);
  const urlIdx = fg.indexOf('GetCachedBrowserUrl(fg, out webHost)');
  const elIdx = fg.indexOf('ReadFocusedWebComposer(');
  assert.ok(urlIdx >= 0 && elIdx > urlIdx, 'the URL must be resolved BEFORE any element is touched');
});

// Hosts a human has signed off with a recorded live pass. An ALLOW-LIST, not a
// blanket "everything is disarmed": arming must stay a conscious edit in two
// places, so a flag flipped by accident or by a refactor still fails here.
// Kept in step with the same list in web-surfaces.test.mjs.
// All re-armed 2026-09-09 post-audit; m365.cloud.microsoft added 2026-09-21
// (AI-218) after its own live pass in Chrome — composer AutomationId
// 'm365-chat-editor-target-element', Name 'Message <agent>', [Button] 'Send'.
// vertexaisearch.cloud.google.com added 2026-09-22 (AI-219) after its own live
// UIA probe: composer [Group] Name='Search' AutomationId
// 'agent-search-prosemirror-editor', send [Button] Name='Submit', and two
// different agents measured producing two different ids in the URL path.
const LIVE_PASSED_HOSTS = new Set(['claude.ai', 'chatgpt.com', 'gemini.google.com', 'm365.cloud.microsoft',
                                   'vertexaisearch.cloud.google.com',
                                   // mail.google.com added 2026-09-23 after its own live UIA probe,
                                   // Gemini side panel open, caret in it:
                                   //   panel    [Group]    Name='Gemini'     Class='MxSLJe'
                                   //   composer [ComboBox] Name='Ask Gemini' Class='Pv5YRd TIYGAd VMkJgc'
                                   //            AutomationId='' -- Value AND Text patterns
                                   // The only other text-capable focusable elements in the whole
                                   // window were the page RootWebAreas and [Edit] 'Search mail'.
                                   //
                                   // IT IS ALSO THE FIRST hostApp SURFACE: the user's MAIL with an
                                   // AI panel attached, not an AI tool. Its block is composer-scoped
                                   // rather than host-scoped -- see the hostApp test below.
                                   'mail.google.com',
                                   // docs.google.com added 2026-09-24: same Workspace side panel
                                   // (appsElementsSidekickRoot), composer [ComboBox] 'Ask Gemini',
                                   // send [Button] 'Submit'. One entry covers Docs, Sheets and
                                   // Slides -- all three are this host and this panel.
                                   'docs.google.com',
                                   // outlook.office.com added 2026-09-24: Copilot pane open,
                                   // composer [Edit] 'Message Copilot' AutomationId
                                   // 'm365-chat-editor-target-element', send [Button] 'Send'.
                                   // The same component M365 Copilot web uses.
                                   'outlook.office.com',
                                   // sharepoint.com added 2026-09-24, measured on BOTH a OneDrive
                                   // host and a team-site host: composer [Edit] 'Describe what
                                   // you'd like to edit' AutomationId 'm365-chat-editor-target-
                                   // element', send [Button] 'Send'. One entry, every tenant.
                                   'sharepoint.com']);

test('only a live-passed WEB_SURFACES entry is armed, and the .ps1 clamps the payload', async () => {
  const { WEB_SURFACES, buildWebSurfaceConfig } = await import('../src/os_monitor/ai-processes.js');
  for (const s of WEB_SURFACES) {
    const passed = LIVE_PASSED_HOSTS.has(s.host);
    assert.equal(s.enforce, passed, `${s.id}: enforce must be ${passed} (live-passed: ${passed})`);
    assert.equal(s.verified, passed, `${s.id}: verified must be ${passed} (live-passed: ${passed})`);
  }
  // Every entry asks for the post-send CEILING, and the .ps1 clamps it again
  // rather than trusting an env var it did not build.
  const src = await enforcerSrc();
  for (const row of buildWebSurfaceConfig()) {
    assert.equal(row.postSendVerifyMs, 1500, `${row.id} must allow for the Chromium serialization hop`);
  }
  assert.match(src, /PostSendVerifyMs = JsIntClamped\(d, "postSendVerifyMs",\s*\r?\n?\s*REWRITE_POST_SEND_MS, REWRITE_POST_SEND_MS, REWRITE_POST_SEND_MAX_MS\),/);
  // A host with a PATH in it is refused outright — this catalog is host-only,
  // because a path is one field from a query string.
  const load = src.slice(src.indexOf('static void LoadWebSurfaces(string json)'), src.indexOf('// ---- Host -> surface'));
  assert.match(load, /if \(host\.IndexOf\('\/'\) >= 0\) continue;/);
  // FAIL OPEN on a bad payload: assign only at the end, so a throw leaves the
  // list empty and every browser ungoverned.
  assert.match(load, /_webSurfaces = surfaces;\s*\r?\n\s*_anyWebSurfaceEnforcing = anyEnforcing;/);
});

// ── BEHAVIOUR (driven through the harness) ──────────────────────────────────

test('THE SHIPPED CATALOG IS COMPLETELY INERT', async () => {
  if (!win) return;
  // The single most important assertion in this file. Every WEB_SURFACES entry
  // ships enforce:false, verified:false, and with those flags the browser path
  // does NOTHING: no URL read (so webOutcome never even leaves Unreadable), no
  // element read, no capture, no scan, no Tier B offer, no block, no govstate.
  // Not "reads but does not act" — genuinely nothing.
  for (const name of ['shipped_inert', 'empty_payload']) {
    for (const r of await scenario(name)) {
      assert.equal(r.webOutcome, 'Unreadable', `${name} tick ${r.tick}: a URL was resolved`);
      assert.equal(r.fgWebHost, '', `${name} tick ${r.tick}: a host was resolved`);
      assert.equal(r.fgIsAi, false, `${name} tick ${r.tick}: the tick became an AI surface`);
      assert.equal(r.captureOn, false, `${name} tick ${r.tick}: keystroke capture was on`);
      assert.equal(r.dlpBlocked, false, `${name} tick ${r.tick}: a content block was possible`);
      assert.equal(r.fgIsBlocked, false, `${name} tick ${r.tick}: a block was armed`);
      assert.equal(r.enterBlocked, false, `${name} tick ${r.tick}: Enter would be swallowed`);
      assert.equal(r.typedLen, 0, `${name} tick ${r.tick}: keystrokes were buffered`);
      assert.equal(r.govActive, false, `${name} tick ${r.tick}: a file watcher would be armed`);
      assert.equal(r.hostField, '', `${name} tick ${r.tick}: a host would be emitted`);
    }
  }
  // A blocked row was present in 'shipped_inert' the whole time and still
  // blocked nothing — the flags, not the absence of a policy, are what held it.
});

test('BOTH flags are required: enforce-only and verified-only arm nothing', async () => {
  if (!win) return;
  for (const name of ['enforce_without_verified', 'verified_without_enforce']) {
    for (const r of await scenario(name)) {
      assert.equal(r.fgIsAi, false, `${name}: a half-armed surface became an AI surface`);
      assert.equal(r.captureOn, false, `${name}: a half-armed surface captured keystrokes`);
      assert.equal(r.fgIsBlocked, false, `${name}: a half-armed surface armed a block`);
    }
  }
});

test('THE PRIORITY CASE: a secret typed into the composer swallows Enter', async () => {
  if (!win) return;
  // The behaviour this whole feature exists for, and the one the browser
  // extension used to provide in-page: the user is on claude.ai, types a
  // pattern-matching secret into the PAGE COMPOSER, presses Enter, and the send
  // is swallowed. There is NO blocked_agents row involved at all — this is the
  // pattern-scan path (enforcement_block / keystroke_block), not the platform
  // one.
  const ticks = await scenario('dlp_composer_armed');
  for (const r of ticks) {
    assert.equal(r.webOutcome, 'Surface');
    assert.equal(r.composer, true);
    assert.equal(r.fgWebHost, 'claude.ai');
    // The tick IS an AI surface, so the typed buffer accumulates and is scanned.
    assert.equal(r.fgIsAi, true, `tick ${r.tick}: the composer tick must be an AI surface`);
    assert.equal(r.captureOn, true, `tick ${r.tick}: keystrokes must be captured in the composer`);
    assert.equal(r.uiaOk, true, `tick ${r.tick}: the composer's own text must be readable for Tier B`);
    // THE ASSERTION: with a typed-buffer pattern match, Enter is swallowed.
    assert.equal(r.dlpBlocked, true, `tick ${r.tick}: a matched secret must swallow Enter`);
    // …and it is NOT a platform block, so Tier B stays offerable and the block
    // dialog gets its Tokenize & Send / Override choices.
    assert.equal(r.fgIsBlocked, false, `tick ${r.tick}: no platform block should be armed`);
    assert.equal(r.enterBlocked, false, `tick ${r.tick}: nothing but the content match may block`);
  }
  // The keystrokes really did land in the buffer.
  assert.equal(ticks[0].typedLen, 0);
  assert.equal(ticks[1].typedLen, 'my ssn is 123-45-6789'.length);
  // The block event carries the CATALOG host, which is what index.js's
  // blockToolHost() reads first so Request Access asks against claude.ai.
  assert.match(ticks[1].hostField, /^,"browser_host":"claude\.ai"$/);
  // Tier B's per-surface knobs come from the catalog.
  assert.equal(ticks[1].newlineKeys, 'shift_enter');
  assert.equal(ticks[1].postSendMs, 1500);
});

test('a browser NEVER reads the focused element — only its verified composer', async () => {
  // THE assertion the omnibox test used to make with a stale proxy, stated
  // directly and where it actually lives. UpdateUia branches on the process:
  // a browser reads VerifiedWebComposer(), everything else reads
  // FocusedElement. This is what makes the wider read gate safe — the set of
  // elements whose text a browser can have read is exactly one per window, and
  // it is one that passed the full composer test AND re-passes it every read.
  const src = await enforcerSrc();
  const fn = src.slice(src.indexOf('static void UpdateUia()'), src.indexOf('static void UpdatePendingRewrite()'));
  assert.ok(fn.length > 0, 'expected an UpdateUia body');
  // Whitespace-collapsed before matching: the branch spans lines in the
  // source, and a newline-sensitive pattern breaks on reformatting rather
  // than on a real change.
  const flat = fn.replace(/\s+/g, ' ');
  // ForegroundIsBrowser(), not _browserProcs.Contains(_app): the sticky name
  // made this branch miss entirely for 3s after alt-tabbing out of a desktop AI
  // app into a browser, and FocusedElement was then read over a browser window.
  // The NON-browser branch is EffectiveFocusedElement(), not a bare
  // AutomationElement.FocusedElement: the M365 work wrapped that read to
  // resolve a focused WebView2Holder down to the real composer. It changes
  // nothing this test is about — the browser arm still never reaches it — but
  // the pattern has to name what the code actually says, or this fails on a
  // refactor instead of on a regression.
  assert.match(flat, /el = ForegroundIsBrowser\(\) \? CachedWebComposer\(\) : EffectiveFocusedElement\(\)/,
    'UpdateUia must read the cached composer for a browser and the focused element otherwise');
  // And the cache is gated on the readable flag, so an element that stopped
  // qualifying is not served from it.
  const cached = src.slice(src.indexOf('static AutomationElement CachedWebComposer('), src.indexOf('// Is a "web"-scoped block allowed'));
  assert.match(cached, /if \(!_fgWebComposerReadable\) return null;/);
});

test('THE OMNIBOX: no capture, no scan, and Enter stays ALIVE', async () => {
  if (!win) return;
  // TWO independent reasons this must hold, and either alone is sufficient:
  //   PRIVACY — the address bar also accepts search queries, and is where people
  //     paste internal hostnames, signed S3 links and password-reset URLs.
  //   THE USER MUST BE ABLE TO LEAVE — swallowing Enter in the omnibox while a
  //     site is blocked would stop them navigating AWAY from the blocked site.
  const ticks = await scenario('omnibox_never_captures');
  const composer0 = ticks[0];
  const omni1 = ticks[1];
  const omni2 = ticks[2];
  const composer3 = ticks[3];

  assert.equal(composer0.captureOn, true, 'the composer must capture');
  const typedInComposer = 'secret 123-45-6789'.length;

  for (const r of [omni1, omni2]) {
    assert.equal(r.composer, false, `omnibox tick ${r.tick} was treated as a composer`);
    assert.equal(r.chromeFocused, true, `omnibox tick ${r.tick} was not recognised as browser chrome`);
    assert.equal(r.captureOn, false, `omnibox tick ${r.tick} CAPTURED KEYSTROKES`);
    // NOT asserted: that the UIA read GATE is shut. It is deliberately open
    // here now, and that is the fix for the 2026-09-09 paste bypass — the
    // composer scan has to keep running across a focus move, or a pasted
    // secret has no signal at all (the typed buffer sees no characters from a
    // Ctrl+V). What matters is not whether the gate is open but WHICH ELEMENT
    // is read through it: for a browser that is always VerifiedWebComposer(),
    // never AutomationElement.FocusedElement, so the address bar's own text is
    // unreachable no matter what has focus. That target is asserted at the
    // source level in the UpdateUia test, and the consequences are asserted
    // right here — no capture, no block, no host, buffer untouched.
    assert.equal(r.captureOn, false, `omnibox tick ${r.tick} CAPTURED KEYSTROKES`);
    assert.equal(r.dlpBlocked, false, `omnibox tick ${r.tick} could swallow Enter`);
    assert.equal(r.enterBlocked, false, `omnibox tick ${r.tick} could swallow Enter`);
    assert.equal(r.hostField, '', `omnibox tick ${r.tick} would emit a host`);
    // NOTHING the user typed into the address bar reached the buffer. The
    // buffer is now DISCARDED on the focus move rather than preserved, so the
    // assertion is "never more than what the composer held", not an exact
    // equality — either value is safe, and only growth would mean address-bar
    // text was captured.
    //
    // Discarding here used to be a bypass on its own (type the secret, click
    // the omnibox, click back, empty buffer, send). It is not one any more,
    // because the block no longer depends on the buffer: the UIA composer read
    // arms it from the composer's ACTUAL text. That compensating control is
    // asserted by 'BYPASS 1: a PASTE is blocked, with an empty typed buffer,
    // after a focus round-trip' — if that test is ever deleted or weakened,
    // this relaxation stops being safe.
    assert.ok(r.typedLen <= typedInComposer,
      `omnibox tick ${r.tick} appended address-bar text to the scan buffer (${r.typedLen} > ${typedInComposer})`);
  }
  // Returning to the composer resumes normally.
  assert.equal(composer3.composer, true);
  assert.equal(composer3.captureOn, true);
  assert.equal(composer3.chromeFocused, false);

  // The find bar and the tab-search box are chrome for the same reason.
  for (const r of await scenario('find_bar_is_chrome')) {
    assert.equal(r.chromeFocused, true, `tick ${r.tick}: browser chrome was not recognised`);
    assert.equal(r.captureOn, false, `tick ${r.tick}: browser chrome captured keystrokes`);
  }
});

test('a PASSWORD FIELD on a governed host is never a composer', async () => {
  if (!win) return;
  for (const r of await scenario('password_never_captures')) {
    assert.equal(r.webOutcome, 'Surface', 'the host really is a catalog host here');
    assert.equal(r.composer, false, `tick ${r.tick}: a password field was treated as a composer`);
    assert.equal(r.captureOn, false, `tick ${r.tick}: A PASSWORD WAS BUFFERED`);
    assert.equal(r.typedLen, 0, `tick ${r.tick}: A PASSWORD REACHED THE SCAN BUFFER`);
    // The composite gate both UIA readers apply. A password field's text must
    // never be read for content scanning OR for a Tier B mask candidate.
    assert.equal(r.uiaOk, false, `tick ${r.tick}: A PASSWORD FIELD WOULD HAVE ITS TEXT READ`);
  }
  // A transcript element and a non-focusable field are refused too — readable,
  // and authoritatively not a composer.
  const other = await scenario('non_composer_elements');
  assert.equal(other[1].composer, false);
  assert.equal(other[1].captureOn, false);
});

test('an UNKNOWN host is not an AI surface — FAIL OPEN', async () => {
  if (!win) return;
  // Decided, and not open for reinterpretation. The repo already made this call
  // for Teams ("cannot tell" means NO BLOCK AT ALL), and a browser is the
  // stronger case: fail-closed would freeze Enter browser-wide on one UIA
  // hiccup.
  const t = await scenario('unknown_host');
  const byTick = Object.fromEntries(t.map((r) => [r.tick, r]));
  // Gmail, an internal wiki: not AI surfaces, nothing captured, nothing blocked.
  for (const i of [0, 1]) {
    assert.equal(byTick[i].webOutcome, 'NotSurface');
    assert.equal(byTick[i].fgIsAi, false, `tick ${i}: an ungoverned tab became an AI surface`);
    assert.equal(byTick[i].captureOn, false, `tick ${i}: AN UNGOVERNED TAB CAPTURED KEYSTROKES`);
    assert.equal(byTick[i].enterBlocked, false);
    assert.equal(byTick[i].dlpBlocked, false);
  }
  // THE NEAR MISSES. A suffix that is not on a dot boundary, and an
  // attacker-controlled parent domain, are both NOT claude.ai.
  assert.equal(byTick[2].webOutcome, 'NotSurface', 'notclaude.ai matched claude.ai');
  assert.equal(byTick[2].fgIsAi, false);
  assert.equal(byTick[3].webOutcome, 'NotSurface', 'claude.ai.attacker.example matched claude.ai');
  assert.equal(byTick[3].fgIsAi, false);
  // A real subdomain IS governed, through its parent entry — and it governs as
  // the CATALOG host, not as itself.
  assert.equal(byTick[4].webOutcome, 'Surface');
  assert.equal(byTick[4].fgWebHost, 'claude.ai', 'a subdomain must govern as its catalog parent');
  // Non-web schemes are never a governed surface.
  assert.equal(byTick[5].webOutcome, 'NotSurface', 'chrome:// was treated as web traffic');
  assert.equal(byTick[6].webOutcome, 'NotSurface', 'file:// was treated as web traffic');
  // …and the scheme-less / www forms the omnibox actually shows still resolve.
  assert.equal(byTick[7].fgWebHost, 'claude.ai', 'the scheme-less omnibox form did not resolve');
  assert.equal(byTick[8].fgWebHost, 'claude.ai', 'the www form did not resolve');
});

test('an UNREADABLE URL is not an AI surface either — FAIL OPEN', async () => {
  if (!win) return;
  for (const r of await scenario('unreadable_url')) {
    assert.equal(r.webOutcome, 'Unreadable');
    assert.equal(r.fgIsAi, false, `tick ${r.tick}: an unreadable URL became an AI surface`);
    assert.equal(r.captureOn, false, `tick ${r.tick}: an unreadable URL captured keystrokes`);
    assert.equal(r.typedLen, 0, `tick ${r.tick}: keystrokes were buffered with no resolved host`);
    assert.equal(r.enterBlocked, false);
    assert.equal(r.dlpBlocked, false);
  }
});

test('a blocked_agents browser_host row blocks the tab, element-scoped', async () => {
  if (!win) return;
  const t = await scenario('row_blocks_armed_host');
  for (const i of [0, 1, 3]) {
    const r = t[i];
    assert.equal(r.fgIsBlocked, true, `tick ${i}: the row did not block`);
    assert.equal(r.blockScope, 'web', `tick ${i}: wrong scope`);
    assert.equal(r.blockedByElement, true, `tick ${i}: a browser block must be element-scoped`);
    assert.equal(r.blockedHost, 'claude.ai', `tick ${i}: wrong blocked host`);
    assert.equal(r.latchKey, 'web:claude.ai', `tick ${i}: the latch key must be namespaced`);
    assert.equal(r.enterBlocked, true, `tick ${i}: Enter was not swallowed`);
    assert.match(r.hostField, /^,"browser_host":"claude\.ai"$/);
  }
  // …AND Enter in the OMNIBOX of that very blocked tab still goes through. This
  // is the whole reason WebBlockGateOk exists: a block the user cannot navigate
  // away from is a broken browser, not enforcement.
  assert.equal(t[2].chromeFocused, true);
  assert.equal(t[2].enterBlocked, false, 'ENTER WAS SWALLOWED IN THE ADDRESS BAR OF A BLOCKED TAB');

  // A row for a catalogued-but-UNVERIFIED host blocks nothing, even though the
  // tab really is on that host.
  for (const r of await scenario('row_unverified_host')) {
    assert.equal(r.fgIsBlocked, false, 'an unverified host was blocked');
    assert.equal(r.fgWebHost, '', 'an unverified host resolved a governed host');
    assert.equal(r.captureOn, false, 'an unverified host captured keystrokes');
  }
});

test('a process_name row for a browser is NEVER honoured', async () => {
  if (!win) return;
  // process_name matching is process-WIDE, so honouring `process_name:"chrome"`
  // would swallow Enter in EVERY TAB — Gmail, Jira, the wiki, the address bar.
  // Unsynthesisable by construction (web-surfaces.test.mjs asserts that); this
  // proves the .ps1 refuses it even if one arrived from somewhere else.
  for (const r of await scenario('process_name_row_refused')) {
    assert.equal(r.fgIsBlocked, false, `tick ${r.tick}: A process_name:'chrome' ROW WAS HONOURED`);
    assert.equal(r.blockScope, 'app', 'no block means the default scope');
    assert.equal(r.enterBlocked, false, `tick ${r.tick}: Enter was swallowed by a process-wide row`);
    assert.equal(r.blockedHost, '');
  }
  // A platform-scoped row DOES reach the tab, through the element-scoped web arm
  // and the WEB_SURFACES `platform` field — which is why that field travels at
  // all, and how it avoids PLATFORM_PROCS gaining a browser entry.
  const viaWeb = await scenario('platform_row_via_web_arm');
  assert.equal(viaWeb[0].fgIsBlocked, true, 'a platform row did not reach the browser tab');
  assert.equal(viaWeb[0].blockScope, 'web');
  assert.equal(viaWeb[0].blockedHost, 'claude.ai');
  // …and still not in the omnibox.
  assert.equal(viaWeb[1].enterBlocked, false);
  // The SAME row agent-scoped blocks nothing: nothing in a browser can tell
  // which agent a page has open, and "cannot tell" means NO BLOCK.
  for (const r of await scenario('platform_row_agent_scoped')) {
    assert.equal(r.fgIsBlocked, false, 'an agent-scoped row blocked a browser tab');
  }
});

test('tab switching re-arms against the right host, in BOTH directions', async () => {
  if (!win) return;
  // A -> B -> A with the BLOCKED host first.
  const ab = await scenario('tab_switch_a_to_b');
  assert.deepEqual(ab.map((r) => [r.fgWebHost, r.fgIsBlocked]), [
    ['claude.ai', true], ['claude.ai', true],
    ['chatgpt.com', false], ['chatgpt.com', false],
    ['claude.ai', true], ['claude.ai', true],
  ], 'the block did not follow the tab');
  assert.deepEqual(ab.map((r) => r.latchKey),
    ['web:claude.ai', 'web:claude.ai', '', '', 'web:claude.ai', 'web:claude.ai'],
    'the latch outlived the tab it was armed for');

  // The REVERSE direction, blocked host SECOND — the ordering that would hide a
  // "first host wins" bug.
  const ba = await scenario('tab_switch_b_to_a');
  assert.deepEqual(ba.map((r) => [r.fgWebHost, r.fgIsBlocked]), [
    ['claude.ai', false], ['chatgpt.com', true], ['claude.ai', false],
  ], 'the block did not follow the tab in the reverse direction');

  // BOTH hosts blocked: each tick must re-arm against the host actually open,
  // and the emitted host must follow.
  const both = await scenario('tab_switch_both_blocked');
  assert.deepEqual(both.map((r) => r.blockedHost), ['claude.ai', 'chatgpt.com', 'claude.ai']);
  assert.deepEqual(both.map((r) => r.latchKey), ['web:claude.ai', 'web:chatgpt.com', 'web:claude.ai']);
  for (const r of both) {
    assert.equal(r.enterBlocked, true);
    assert.equal(r.hostField, `,"browser_host":"${r.blockedHost}"`);
  }
});

test('the latch survives ONE unreadable tick and dies on a readable non-match', async () => {
  if (!win) return;
  // Unreadable is NO EVIDENCE. Treating it as "the user left the blocked site"
  // is a read failure dressed up as a fact, and it would tear the block down on
  // the first bad tick while the user sits on the very site an admin blocked.
  const surv = await scenario('latch_survives_unreadable');
  assert.equal(surv[0].fgIsBlocked, true);
  for (const i of [1, 2]) {
    assert.equal(surv[i].webOutcome, 'Unreadable');
    assert.equal(surv[i].fgIsBlocked, true, `tick ${i}: the block died on an unreadable read`);
    assert.equal(surv[i].latchKey, 'web:claude.ai', `tick ${i}: the latch was dropped`);
    assert.equal(surv[i].enterBlocked, true, `tick ${i}: Enter went through on an unreadable read`);
    // …while CAPTURE has already failed open, which is the split that matters.
    assert.equal(surv[i].captureOn, false, `tick ${i}: capture survived a bad read`);
  }
  assert.equal(surv[3].fgIsBlocked, true, 'the block did not recover on a good read');

  // A READABLE non-match is AUTHORITATIVE: the user navigated away, so the block
  // must release at once. Fail OPEN — an Enter left swallowed after navigating
  // away is a dead key in an unrelated website.
  const died = await scenario('latch_dies_on_navigation');
  assert.equal(died[0].fgIsBlocked, true);
  for (const i of [1, 2]) {
    assert.equal(died[i].webOutcome, 'NotSurface');
    assert.equal(died[i].fgIsBlocked, false, `tick ${i}: the block outlived the navigation`);
    assert.equal(died[i].latchKey, '', `tick ${i}: the latch outlived the navigation`);
    assert.equal(died[i].enterBlocked, false, `tick ${i}: ENTER STAYED DEAD AFTER NAVIGATING AWAY`);
  }

  // And the latch is BOUNDED: a browser whose reads never recover cannot leave
  // Enter swallowed forever.
  const bounded = await scenario('latch_is_bounded');
  assert.equal(bounded[1].fgIsBlocked, true, 'the latch should still hold before the TTL');
  assert.equal(bounded[2].fgIsBlocked, false, 'the latch outlived PANEL_BLOCK_LATCH_TTL');
  assert.equal(bounded[2].enterBlocked, false);
});

test('the typed buffer is discarded on every navigation signal', async () => {
  if (!win) return;
  // A buffer that survived a navigation would be a keystroke reconstruction of
  // the PREVIOUS page's typing, scanned and attributed to the new one.
  //
  // (c) A NAVIGATION CHORD, with everything else held constant — same URL, same
  //     host, same title, same window — so the chord is provably what did it.
  const nav = await scenario('buffer_discard_navigation');
  assert.equal(nav[1].typedLen, 'aws key AKIAIOSFODNN7EXAMPLE'.length, 'the buffer did not accumulate');
  assert.equal(nav[2].navGen, nav[1].navGen + 1, 'a navigation chord did not bump the generation');
  assert.equal(nav[3].typedLen, 1, 'THE BUFFER SURVIVED A NAVIGATION CHORD');
  // ONE chord counts ONCE — otherwise the buffer could never accumulate at all.
  assert.equal(nav[4].navGen, nav[2].navGen, 'the chord kept bumping on later ticks');
  assert.equal(nav[5].typedLen, 3, 'the buffer stopped accumulating after a chord');

  // (d) A HOST CHANGE inside one window.
  const host = await scenario('buffer_discard_host_change');
  assert.equal(host[1].typedLen, 'ssn 123-45-6789'.length);
  assert.equal(host[2].navGen, host[1].navGen + 1, 'a host change did not bump the generation');
  assert.equal(host[3].typedLen, 1, 'THE BUFFER SURVIVED A HOST CHANGE');

  // (b) A SAME-HOST TAB SWITCH — two claude.ai conversations, clicked with the
  //     mouse. No host change, no window change, no chord: the WINDOW TITLE is
  //     the only signal, and this is the case it exists for.
  const sameHost = await scenario('buffer_discard_same_host_tab');
  assert.equal(sameHost[1].typedLen, 'ssn 123-45-6789'.length);
  assert.equal(sameHost[2].navGen, sameHost[1].navGen + 1, 'a same-host tab switch was not detected');
  assert.equal(sameHost[3].typedLen, 1, 'ONE CONVERSATION\'S TYPING SURVIVED INTO ANOTHER');

  // (a) A SECOND BROWSER WINDOW — the cheapest signal.
  const win2 = await scenario('buffer_discard_second_window');
  assert.equal(win2[2].navGen, win2[1].navGen + 1, 'a window change did not bump the generation');
  assert.equal(win2[3].typedLen, 1, 'the buffer survived a window change');

  // THE ACKNOWLEDGED RESIDUAL CASE, asserted so it stays visible rather than
  // being discovered later: an SPA route change under an UNCHANGED title is
  // caught by none of the four signals, and the buffer legitimately carries on.
  // BROWSER_URL_TTL is the backstop for the URL itself; the buffer here belongs
  // to the same host and the same composer element, so carrying on is correct —
  // but a same-host route change that genuinely started a NEW conversation with
  // no title change would keep the old text. See the residual-risk note.
  const spa = await scenario('spa_route_same_title');
  assert.equal(spa[1].navGen, spa[0].navGen, 'the SPA case unexpectedly bumped');
  assert.equal(spa[1].typedLen, 'ssn 123-45-6789'.length);

  // Leaving the composer for the omnibox does NOT discard, and that is
  // deliberate: discarding there would be a trivial bypass (type the secret,
  // click the address bar, click back, press Enter). Capture is already off in
  // the omnibox by two independent gates, so nothing is captured either way.
  const focusOut = await scenario('buffer_discard_focus_out');
  assert.equal(focusOut[2].captureOn, false);
  // The buffer is DISCARDED on the focus move now, not preserved. That used to
  // be a bypass on its own (type the secret, visit the omnibox, come back,
  // empty buffer, send) which is why it was preserved before. It is safe now
  // because the block no longer depends on the buffer: the UIA composer read
  // arms it from the composer's ACTUAL text, which is what closed the
  // 2026-09-09 paste bypass. Guarded by 'BYPASS 1: a PASTE is blocked, with an
  // empty typed buffer, after a focus round-trip' — if that test goes, this
  // relaxation is unsafe again.
  assert.ok(focusOut[3].typedLen <= 'ssn 123-45-6789'.length,
    'the omnibox visit GREW the buffer, i.e. address-bar text was captured');
  // Typing in the composer still accumulates afterwards.
  assert.ok(focusOut[5].typedLen >= 1, 'the buffer did not resume after returning to the composer');

  // Leaving the BROWSER entirely: capture stops at once, and text typed in the
  // other app never reaches the buffer.
  const left = await scenario('buffer_discard_leave_browser');
  for (const i of [2, 3]) {
    assert.equal(left[i].captureOn, false, `tick ${i}: capture survived leaving the browser`);
    assert.equal(left[i].fgWebHost, '', `tick ${i}: the resolved host outlived the browser`);
    assert.equal(left[i].typedLen, 'ssn 123-45-6789'.length,
      `tick ${i}: ANOTHER APP'S KEYSTROKES REACHED THE BUFFER`);
  }
});

test('govstate arms per HOST, on transitions only, and carries nothing else', async () => {
  if (!win) return;
  const t = await scenario('govstate_browser');
  assert.equal(t[0].govActive, true, 'a governed browser composer did not arm the watchers');
  assert.equal(t[0].govEmitted, true, 'the arming transition emitted nothing');
  assert.equal(t[1].govEmitted, false, 'a steady state emitted a second line');
  // Switching governed hosts RE-ANNOUNCES rather than silently keeping the
  // first one's host — the identity key carries the host. It is a TWO-TICK
  // transition by design (clear, then arm), the same as switching between two
  // governed Teams conversations: the emitter changes state at one site per tick
  // so it can never write two lines for one transition.
  assert.equal(t[0].govKey.endsWith('claude.ai'), true, `govKey did not carry the host: ${t[0].govKey}`);
  assert.equal(t[2].govActive, false, 'the first host was not disarmed on the switch');
  assert.equal(t[2].govEmitted, true, 'the switch emitted no clear line');
  assert.equal(t[3].govActive, true, 'the second host never armed');
  assert.equal(t[3].govEmitted, true, 'the re-arm emitted no line');
  assert.equal(t[3].govKey.endsWith('chatgpt.com'), true, `govKey did not follow the host: ${t[3].govKey}`);
  // Leaving for an ungoverned tab disarms at once.
  assert.equal(t[4].govActive, false, 'the watchers stayed armed on an ungoverned tab');

  // The panic hotkey disarms it too: an armed watcher whose hold can no longer
  // swallow anything would be capture with no enforcement to justify it.
  const panic = await scenario('govstate_panic');
  assert.equal(panic[0].govActive, true);
  assert.equal(panic[1].govActive, false, 'the panic hotkey left the file watchers armed');

  // THE PAYLOAD, from the REAL emitter. A bool, a scope, a process, a pid and
  // the CATALOG HOST — and for a browser, no agent and no panel at all.
  const { gov } = await runHarness();
  const web = gov.filter((e) => e.scope === 'web');
  assert.ok(web.length >= 4, `expected browser govstate lines, got ${web.length}`);
  for (const ev of web) {
    assert.deepEqual(
      Object.keys(ev).sort(),
      ['active', 'agent', 'agent_id', 'browser_host', 'kind', 'panel', 'pid', 'process', 'scope'],
      'the govstate payload gained or lost a field — every addition must be re-reviewed for PII',
    );
    assert.equal(ev.active, true);
    assert.equal(ev.process, 'chrome');
    assert.equal(ev.agent, '', 'a browser surface has no agent');
    assert.equal(ev.agent_id, '');
    assert.equal(ev.panel, '', 'a browser surface is not an AI_PANELS entry');
    // Derived from the CATALOG, not a hardcoded pair. The hardcoded version
    // went stale the moment a scenario used a third host (the app-switch
    // acceptance test drives gemini.google.com), which failed this test for a
    // reason that had nothing to do with what it guards. What matters is that
    // browser_host is always ONE OF THE CATALOG HOSTS — i.e. a constant from
    // WEB_SURFACES and never a value derived from the URL the harness fed in.
    // The no-URL/no-path/no-title assertions below are the other half of that.
    const { WEB_SURFACES } = await import('../src/os_monitor/ai-processes.js');
    const catalogHosts = WEB_SURFACES.map((w) => w.host);
    assert.ok(catalogHosts.includes(ev.browser_host),
      `browser_host ${JSON.stringify(ev.browser_host)} is not a catalog host — it must be a WEB_SURFACES constant, never URL-derived`);
  }
  // NOTHING from a URL, a path, a query string or a page title may appear on ANY
  // line — every URL the harness fed in carries a distinctive path.
  const blob = JSON.stringify(gov);
  for (const forbidden of ['/chat/', 'http', '?', 'Payroll', 'Holiday', 'inbox', 'Runbook', 'attacker', 'login', 'Write your prompt']) {
    assert.equal(blob.includes(forbidden), false, `govstate carried ${JSON.stringify(forbidden)}: ${blob.slice(0, 400)}`);
  }
  // An INACTIVE line carries no identity at all.
  for (const ev of gov.filter((e) => e.active === false)) {
    assert.deepEqual([ev.process, ev.scope, ev.panel, ev.agent, ev.agent_id, ev.pid, ev.browser_host],
      ['', '', '', '', '', 0, ''], 'an inactive govstate must be empty');
  }
});

test('the panic hotkey releases a browser block outright', async () => {
  if (!win) return;
  const t = await scenario('panic_releases_block');
  assert.equal(t[0].enterBlocked, true);
  assert.equal(t[1].enterBlocked, false, 'the panic hotkey did not release a browser block');
  assert.equal(t[1].dlpBlocked, false, 'the panic hotkey did not release the content path');
});

test('Tier B knobs are per-surface catalog data, and only inside the composer', async () => {
  if (!win) return;
  const t = await scenario('tierb_knobs');
  // Inside the governed composer: the surface's own values.
  assert.equal(t[0].newlineKeys, 'shift_enter');
  assert.equal(t[0].postSendMs, 1500, 'a browser composer must allow for the Chromium serialization hop');
  // In the OMNIBOX, and on an ungoverned tab, the lookups fall back to the
  // defaults — CurrentWebSurface() requires the composer, so an omnibox tick
  // cannot hand the rewrite a per-surface setting.
  assert.equal(t[1].postSendMs, 200, 'the omnibox was handed a browser surface setting');
  assert.equal(t[2].postSendMs, 200, 'an ungoverned tab was handed a browser surface setting');
});
// ── THE SEND-BUTTON CLICK BLOCK ─────────────────────────────────────────────

test('the click path is gated on BOTH catalog fields, and searches off the poll thread', async () => {
  const src = await enforcerSrc();
  // UpdateSendRect DELEGATES for a browser instead of refusing outright, and
  // its own two generic attempts stay excluded: the "name contains send/submit"
  // descendant search is a lottery across a whole website, and the
  // bottom-right-corner heuristic points at arbitrary page content.
  const fn = src.slice(src.indexOf('static void UpdateSendRect()'), src.indexOf('static void UpdateUia()'));
  assert.ok(fn.length > 0, 'expected an UpdateSendRect body');
  const delegate = fn.indexOf('if (ForegroundIsBrowser()) { UpdateWebSendRect(); return; }');
  const genericSearch = fn.indexOf('win.FindAll(TreeScope.Descendants');
  const heuristic = fn.indexOf('_rx = wr.Right - 160;');
  assert.ok(delegate >= 0, 'UpdateSendRect must delegate the browser case');
  assert.ok(genericSearch > delegate, 'the browser must never reach the generic name-contains search');
  assert.ok(heuristic > delegate, 'the browser must never reach the bottom-right heuristic');
  assert.match(fn, /if \(_ideProcs\.Contains\(_app\) \|\| _hostAppProcs\.Contains\(_app\)\) \{ _hasRect = false; return; \}/);

  // BOTH fields required. Either one empty means no search and no rect, which
  // is what keeps an UNPROBED surface on Enter-only blocking rather than
  // handing it a guessed rectangle.
  // Explicit start/end markers, the same discipline the rest of this file
  // uses: an indexOf that misses returns -1, and slice(i, -1) then silently
  // becomes the whole rest of the file.
  const webStart = src.indexOf('static void UpdateWebSendRect()');
  const webEnd = src.indexOf('static void StdinLoop()');
  assert.ok(webStart >= 0 && webEnd > webStart, 'could not locate the UpdateWebSendRect body');
  const webBody = src.slice(webStart, webEnd);
  assert.match(webBody, /if \(ctName\.Length == 0 \|\| wantName\.Length == 0\) \{ _webSendVerifiedTicks = 0; return; \}/);
  // …and an unrecognised control type is refused too, rather than widening the
  // search to every control in the window.
  assert.match(webBody, /if \(WebControlTypeCondition\(ctName\) == null\) \{ _webSendVerifiedTicks = 0; return; \}/);
  // ONE mapper, shared with the composer search since AI-219 (hence the name).
  // A second copy would be a second place for a control type to be missing
  // from, and a missing entry fails silently: no search, no block, no error.
  const cond = src.slice(src.indexOf('static Condition WebControlTypeCondition(string ctName)'), src.indexOf('static string WebComposerControlType(string host)'));
  assert.ok(cond.length > 0, 'expected a WebControlTypeCondition body');
  assert.match(cond, /if \(string\.IsNullOrEmpty\(ctName\)\) return null;/);
  assert.match(cond, /return null;\s*\r?\n\s*\}/, 'an unrecognised control type must yield no condition');

  // EVERY gate clears the freshness stamp on the way out, so "the rect is
  // recent" can never outlive the tick that earned it.
  const gates = (webBody.match(/\{ _webSendVerifiedTicks = 0; return; \}/g) || []).length;
  assert.ok(gates >= 7, `expected every early return to clear the stamp, found ${gates}`);
  assert.match(fn, /\{ _hasRect = false; _webSendVerifiedTicks = 0; return; \}/);

  // The search runs OFF the poll thread — measured 105ms on a plain claude.ai
  // window and 489ms on a 67-tab Edge window, against a 150ms tick.
  assert.match(webBody, /var t = new Thread\(\(\) => SearchWebSendButtonBackground\(fg, searchHost, searchCt, searchName\)\);/);
  assert.match(webBody, /t\.SetApartmentState\(ApartmentState\.STA\);/);
  const search = src.slice(src.indexOf('static void SearchWebSendButtonBackground('), src.indexOf('// ---- FAST PATH: re-verify and publish'));
  assert.ok(search.length > 0, 'expected a SearchWebSendButtonBackground body');
  assert.match(search, /finally \{ _webSendSearchInProgress = false; \}/);
  assert.match(src, /const int WEB_SEND_EMPTY_RUNS_BEFORE_BACKOFF = 3;/);
  // A DESCENDANT search, and a WHOLE-STRING name comparison — a substring test
  // would match "Send message to a new chat" or any other label containing it.
  assert.match(search, /win\.FindAll\(TreeScope\.Descendants, cond\)/);
  assert.match(search, /if \(!string\.Equals\(name\.Trim\(\), wantName, StringComparison\.OrdinalIgnoreCase\)\) continue;/);
  assert.equal(/Contains\(/.test(search), false, 'the send-button name match must not be a substring test');
  // Nothing read by the search is emitted; only the element reference is kept.
  assert.equal(/Emit\(|EmitBlock\(|Console\.Out/.test(search), false, 'the send-button search must emit nothing');
});

test('the mouse hook reads a cached rect only, and requires it to be RECENT', async () => {
  const src = await enforcerSrc();
  const mouse = src.slice(src.indexOf('static IntPtr MouseCallback('), src.indexOf('static IntPtr HookCallback('));
  assert.ok(mouse.length > 0, 'expected a MouseCallback body');
  // No UIA, no regex, no scanning, and no search on the hook path.
  for (const forbidden of [
    'AutomationElement', 'FindAll', 'TreeWalker', 'new Regex', 'ScanNames(',
    'UpdateWebSendRect', 'SearchWebSendButtonBackground', 'WebControlTypeCondition',
    '_webSendCached', 'EnforcingWebSurface', 'GetCachedBrowserUrl',
  ]) {
    assert.equal(mouse.includes(forbidden), false, `the mouse hook must not reach ${forbidden}`);
  }
  // The freshness term is ANDed in, so the desktop and Teams rect semantics are
  // untouched (SendRectFreshEnough returns true for every non-web scope) and
  // only a WEB rect has to be recent.
  //
  // IT NOW LIVES IN ClickInSendRect, not inline in the hook. The M365 work
  // extracted the hit test into that helper so the panel arm could add a
  // root-window check; the freshness term moved in with it. Asserting it HERE
  // as an inline expression would only prove where the code happens to sit, so
  // the guarantee is asserted in two halves instead: the hook decides via the
  // helper, and the helper is the thing that requires freshness.
  assert.match(mouse, /bool inRect = ClickInSendRect\(x, y\);/,
    'the hook must decide through ClickInSendRect, not its own copy of the bounds test');
  const clickIn = src.slice(src.indexOf('static bool ClickInSendRect(int x, int y)'),
                            src.indexOf('// Cache a PANEL-scoped rect'));
  assert.ok(clickIn.length > 0, 'expected a ClickInSendRect body');
  assert.match(clickIn, /if \(!_hasRect\) return false;/);
  assert.match(clickIn, /if \(!SendRectFreshEnough\(\)\) return false;/,
    'a stale rect must never be honoured — see the microphone case');
  assert.match(clickIn, /x >= _rx && x < _rx \+ _rw && y >= _ry && y < _ry \+ _rh/);
  const fresh = src.slice(src.indexOf('static bool SendRectFreshEnough()'), src.indexOf('// The catalog\'s control-type string'));
  assert.ok(fresh.length > 0, 'expected a SendRectFreshEnough body');
  // Keys on _fgIsBrowser, NOT _blockScope. _blockScope is "" for a pattern-based
  // CONTENT block — which is every DLP block this feature exists for — so gating
  // freshness on it exempted exactly those blocks from the check. Same defect
  // WebBlockGateOk carried.
  assert.match(fresh, /if \(!_fgIsBrowser\) return true;/);
  const freshCode = fresh.split(String.fromCharCode(10)).filter((l) => !l.trim().startsWith('//')).join(' ');
  assert.equal(/_blockScope/.test(freshCode), false,
    '_blockScope is "" for a content block, so freshness must not key on it');
  assert.match(fresh, /if \(t == 0\) return false;/);
  assert.match(fresh, /return \(DateTime\.UtcNow\.Ticks - t\) < WEB_SEND_RECT_TTL;/);
  // PURE — the hook calls it, so it may not write any poll-thread state.
  assert.equal(/_\w+ =(?!=)/.test(codeOnly(fresh)), false, 'SendRectFreshEnough must assign to nothing');
  assert.match(src, /WEB_SEND_RECT_TTL = TimeSpan\.FromMilliseconds\(400\)\.Ticks;/);
  // The swallowed click reports itself as a click, and EmitBlock is what puts
  // browser_host on it — so Request Access asks against claude.ai.
  assert.match(mouse, /EmitBlock\(_app, clickPats, "click", clickBlockedNow\);/);
  assert.match(mouse, /OfferAccessRequest\(_app, "click"\);/);
  const emitBlock = src.slice(src.indexOf('static void EmitBlock('), src.indexOf('static void EmitRewrite('));
  assert.match(emitBlock, /\+ BrowserHostField\(\)/);
});

test('THE MICROPHONE PROBLEM: a rect cached for Send message is not honoured for Use voice mode', async () => {
  if (!win) return;
  // THE failure this whole path is shaped around, driven against a REAL UIA
  // element whose Name the harness changes — not against a copy of the logic.
  //
  // Measured on claude.ai: `Send message` exists ONLY while the composer is
  // non-empty. When it is empty, `Use voice mode` occupies the IDENTICAL
  // rectangle (1560,1042 40x41 in both states). A rect cached in the first
  // state and reused in the second would swallow clicks on the microphone.
  const probe = (await scenario('send_probe'))[0];
  assert.equal(probe.probeOk, true, 'the harness could not build a real UIA probe element');

  const t = await scenario('send_reverify');
  const byTick = Object.fromEntries(t.map((r) => [r.tick, r]));

  // 1. Composer has text: the button is the send button, so the rect is
  //    published and a click on it is swallowed.
  assert.equal(byTick[1].buttonName, 'Send message');
  assert.equal(byTick[1].hasRect, true, 'no rect was published for a real send button');
  assert.equal(byTick[1].rectFresh, true);
  assert.equal(byTick[1].clickSwallowed, true, 'a click on the send button was NOT swallowed');
  assert.equal(byTick[1].blockScope, 'web');
  assert.match(byTick[1].hostField, /^,"browser_host":"claude\.ai"$/);
  // A click far outside the rect is never swallowed, whatever else is true.
  assert.equal(byTick[1].farClickSwallowed, false);

  // 2. THE ASSERTION. Composer empties, the same control becomes the
  //    microphone: the rect is withdrawn on THIS VERY TICK, the freshness stamp
  //    is zeroed, and a click at that rectangle is NOT swallowed.
  assert.equal(byTick[2].buttonName, 'Use voice mode');
  assert.equal(byTick[2].hasRect, false, 'A RECT WAS PUBLISHED FOR THE MICROPHONE');
  assert.equal(byTick[2].rectFresh, false, 'the freshness stamp survived the rename');
  assert.equal(byTick[2].verifiedAt, 0, 'the freshness stamp was not cleared');
  assert.equal(byTick[2].clickSwallowed, false, 'A CLICK ON THE MICROPHONE WOULD BE SWALLOWED');
  // …and the block itself is still armed. Withdrawing the rect must not, and
  // does not, release the Enter block.
  assert.equal(byTick[2].fgIsBlocked, true, 'withdrawing the rect released the block');

  // 3. The user types again: the rect comes back. The cache is deliberately
  //    KEPT through a mismatch, so this needs no fresh 105-489ms search.
  assert.equal(byTick[3].buttonName, 'Send message');
  assert.equal(byTick[3].hasRect, true, 'the rect did not recover when the send button returned');
  assert.equal(byTick[3].clickSwallowed, true);
});

test('the send-button name match is whole-string, and nothing else publishes a rect', async () => {
  if (!win) return;
  const t = await scenario('send_name_mismatch');
  const byTick = Object.fromEntries(t.map((r) => [r.tick, r]));
  // A label CONTAINING the catalog string is not a match — a substring test
  // here would grab any control whose name happens to include it.
  assert.equal(byTick[1].buttonName, 'Send message to a new chat');
  assert.equal(byTick[1].hasRect, false, 'a substring match published a rect');
  assert.equal(byTick[1].clickSwallowed, false);
  // Nor is a prefix of it.
  assert.equal(byTick[2].hasRect, false, 'a partial name published a rect');
  // CASE-INSENSITIVE, though — the same discipline nameEquals uses everywhere
  // else in this file, because a provider's casing is not a contract.
  assert.equal(byTick[3].buttonName, 'SEND MESSAGE');
  assert.equal(byTick[3].hasRect, true, 'the name match must be case-insensitive');
});

test('a surface with NO send-button signature gets Enter-only blocking', async () => {
  if (!win) return;
  // chatgpt.com and gemini.google.com ship sendButtonControlType:'' and
  // sendButtonName:'' because nobody has probed them. "Unprobed" must mean NO
  // RECTANGLE — never a guessed one. The fixture arms chatgpt.com's two flags
  // while leaving its signature empty, so this is specifically "armed but
  // unprobed" rather than "not armed".
  for (const r of await scenario('send_no_signature')) {
    assert.equal(r.fgIsBlocked, true, 'the scenario needs an armed block to be meaningful');
    assert.equal(r.blockScope, 'web');
    assert.equal(r.hasRect, false, `tick ${r.tick}: A RECT WAS PUBLISHED FOR AN UNPROBED SURFACE`);
    assert.equal(r.clickSwallowed, false, `tick ${r.tick}: a click was swallowed on an unprobed surface`);
    assert.equal(r.verifiedAt, 0);
    // …and NOT ONE SEARCH was attempted. The gate is structural, not a filter
    // applied to a result.
    assert.equal(r.searchKicked, false, `tick ${r.tick}: a search ran for a surface with no signature`);
  }
});

test('the click block needs an armed web block on a verified surface', async () => {
  if (!win) return;
  // NO BLOCK ARMED: the mechanism is completely inert during ordinary browsing,
  // even with the send button sitting right there.
  for (const r of await scenario('send_no_block')) {
    assert.equal(r.fgIsBlocked, false);
    // THE RECT IS ALLOWED TO BE WARM HERE, and that is the fix for the
    // 2026-09-09 click bypass: the search used to start only AFTER a block
    // armed, so it lost a 105-489ms race against the user's own click and the
    // arrow simply sent. What must stay shut is the DECISION, not the search.
    assert.equal(r.clickSwallowed, false,
      'A CLICK WAS SWALLOWED WITH NO BLOCK ARMED — moving the search earlier loosened the decision');
  }
  // AN UNVERIFIED SURFACE: the shipped catalog. No block, so no rect either.
  for (const r of await scenario('send_unverified')) {
    assert.equal(r.hasRect, false, 'a rect was published for an unverified surface');
    assert.equal(r.clickSwallowed, false);
    assert.equal(r.searchKicked, false);
  }
  // THE OMNIBOX GATE applies to clicks exactly as it applies to Enter: the
  // caret being in the address bar withdraws the click block too.
  const omni = await scenario('send_omnibox_gate');
  assert.equal(omni[0].hasRect, true, 'the composer tick should publish a rect');
  assert.equal(omni[0].clickSwallowed, true);
  // THE RECT IS NOW ALLOWED TO BE WARM HERE, deliberately: only the CARET moved,
  // the page did not, and withdrawing the rect on a chrome-focus tick recreated
  // the bypass one step removed — click the omnibox, then click the send arrow,
  // and there is no rect for the hook to consult. What must stay shut is the
  // DECISION, and WebBlockGateOk() is what shuts it.
  assert.equal(omni[1].clickSwallowed, false, 'A CLICK WAS SWALLOWED WITH THE CARET IN THE ADDRESS BAR');
  // THE PANIC HOTKEY releases the click path with everything else.
  const panic = await scenario('send_panic');
  assert.equal(panic[0].clickSwallowed, true);
  assert.equal(panic[1].hasRect, false, 'the panic hotkey left a send rect published');
  assert.equal(panic[1].clickSwallowed, false, 'the panic hotkey did not release the click path');
  assert.equal(panic[1].verifiedAt, 0);
  // LEAVING THE BROWSER drops the rect, the stamp and the cached element.
  const left = await scenario('send_leave_browser');
  assert.equal(left[0].clickSwallowed, true);
  assert.equal(left[1].hasRect, false, 'the rect outlived the browser');
  assert.equal(left[1].verifiedAt, 0, 'the freshness stamp outlived the browser');
  assert.equal(left[1].clickSwallowed, false);
});

test('a rect nobody re-verified goes COLD rather than being trusted', async () => {
  if (!win) return;
  // The bound that protects the hook when the POLL THREAD STALLS. The hook
  // cannot re-verify anything itself, so it refuses a rect the poll thread has
  // not confirmed recently. Observed WITHOUT running a tick in between,
  // because a tick would legitimately re-verify and re-stamp.
  const t = await scenario('send_rect_ttl');
  const byTick = Object.fromEntries(t.map((r) => [r.tick, r]));
  assert.equal(byTick[1].hasRect, true);
  assert.equal(byTick[1].clickSwallowed, true);
  // Still fresh a moment later with no new tick at all.
  assert.equal(byTick[2].rectFresh, true, 'the rect went cold far too early');
  assert.equal(byTick[2].clickSwallowed, true);
  // Aged past WEB_SEND_RECT_TTL with the poll thread stopped: refused, even
  // though _hasRect is still set and the button is still the send button.
  assert.equal(byTick[3].hasRect, true, 'the scenario needs _hasRect to still be set');
  assert.equal(byTick[3].buttonName, 'Send message');
  assert.equal(byTick[3].rectFresh, false, 'a stale rect was still considered fresh');
  assert.equal(byTick[3].clickSwallowed, false, 'A STALE RECT WOULD STILL SWALLOW A CLICK');
});

test('the send-button signature is catalog data, and every surface ships disarmed', async () => {
  const { WEB_SURFACES, buildWebSurfaceConfig } = await import('../src/os_monitor/ai-processes.js');
  const cfg = buildWebSurfaceConfig();
  // BOTH fields travel, already resolved, so the C# side never has to tell
  // missing from empty.
  for (const row of cfg) {
    assert.equal(typeof row.sendButtonControlType, 'string', `${row.id} sendButtonControlType must travel`);
    assert.equal(typeof row.sendButtonName, 'string', `${row.id} sendButtonName must travel`);
    // Either BOTH are set or NEITHER is: one alone can never produce a search,
    // so a half-filled entry would be a silently dead signature.
    const a = row.sendButtonControlType.length > 0;
    const b = row.sendButtonName.length > 0;
    assert.equal(a, b, `${row.id} has half a send-button signature, which can never match`);
  }
  // All three surfaces are now live-probed, each with its OWN name. The two
  // that share 'Send message' do so by coincidence, not by shared code, so the
  // values are asserted per surface rather than assumed uniform.
  const byId = Object.fromEntries(cfg.map((r) => [r.id, r]));
  assert.equal(byId.claude_web.sendButtonControlType, 'Button');
  assert.equal(byId.claude_web.sendButtonName, 'Send message');
  assert.equal(byId.chatgpt_web.sendButtonControlType, 'Button');
  assert.equal(byId.chatgpt_web.sendButtonName, 'Send prompt', "chatgpt.com's button is 'Send prompt', not 'Send message'");
  assert.equal(byId.gemini_web.sendButtonControlType, 'Button');
  assert.equal(byId.gemini_web.sendButtonName, 'Send message');
  assert.equal(byId.m365_copilot_web.sendButtonControlType, 'Button');
  assert.equal(byId.m365_copilot_web.sendButtonName, 'Send');
  // 2026-09-22: [Button] Name='Submit' AutomationId='button'. The id is the
  // generic word 'button', so the NAME carries the signature here too.
  assert.equal(byId.gemini_enterprise_web.sendButtonControlType, 'Button');
  assert.equal(byId.gemini_enterprise_web.sendButtonName, 'Submit');
  // And a send-button signature does NOT arm anything on its own — the flags do.
  // chatgpt.com carries no signature AND is unarmed; proving the two are
  // independent means checking that an unarmed host stays unarmed regardless.
  for (const s of WEB_SURFACES) {
    if (LIVE_PASSED_HOSTS.has(s.host)) continue;
    assert.equal(s.enforce, false, `${s.id} is armed without a recorded live pass`);
    assert.equal(s.verified, false, `${s.id} is verified without a recorded live pass`);
  }
  // The .ps1 must not carry the signature as a literal — it is data.
  const src = await enforcerSrc();
  const code = codeOnly(src);
  assert.equal(/"Send message"/.test(code), false, 'the send-button name must arrive as data, never as a C# literal');
});
// ── THE 2026-09-09 LIVE BYPASSES ────────────────────────────────────────────
//
// Two separate failures, same shape: state stopped being RESOLVED the moment it
// stopped being NEEDED, so the first real use after any pause was unprotected.
//
//   BYPASS 1 (Enter, paste). gemini.google.com armed. A secret was PASTED into
//     the composer and Enter sent it raw, with NOTHING logged. `isAi` for a
//     browser required the composer to be FOCUSED, so a focus move inside the
//     page dropped the surface -- which switched off the UIA composer read.
//     That read is the ONLY paste detector this file has, because a Ctrl+V
//     contributes no character keystrokes to the typed buffer.
//   BYPASS 2 (send-button click). chatgpt.com and gemini: "Enter is blocked,
//     the arrow sends, every time". UpdateWebSendRect required _fgIsBlocked AND
//     _blockScope == "web" before it would even look for the button -- and
//     _blockScope is set only by CheckFgBlocked's PLATFORM arms, so for a
//     pattern-based CONTENT block it is "" and the second gate could never
//     pass. Total failure, not a race. On top of that the search only started
//     after a block existed, costing 105-489ms plus two poll ticks.

test('the source separates "which surface" from "where is the caret"', async () => {
  const src = await enforcerSrc();
  const tick = src.slice(src.indexOf('static void ApplyForegroundTick('), src.indexOf('// When a block is active, locate the send button'));
  // isAi on HOST RESOLUTION, not composer focus. This one line is bypass 1.
  assert.match(tick, /WebSurface web = \(webOutcome == WebReadOutcome\.Surface\) \? EnforcingWebSurface\(webHost\) : null;/);
  assert.match(tick, /if \(web != null\)\r?\n\s*\{\r?\n\s*isAi = true;/);
  assert.equal(/if \(web != null && webComposer\)/.test(tick), false,
    'isAi must not require composer focus again — that is the 2026-09-09 paste bypass');

  // …while every NARROW gate still keys on the composer having focus.
  const enforce = src.slice(src.indexOf('static bool PanelEnforceOk()'), src.indexOf('static bool PanelUiaOk()'));
  assert.match(enforce, /if \(_browserProcs\.Contains\(_app\)\) return _fgIsWebComposer;/);
  // …and the READ gate keys on the composer being READABLE, which is what
  // survives a focus move.
  const uiaOk = src.slice(src.indexOf('static bool PanelUiaOk()'), src.indexOf('// ── Copilot-tab heading fallback'));
  assert.match(uiaOk, /if \(ForegroundIsBrowser\(\)\) return _fgWebComposerReadable && _fgLeftAiTicks == 0;/);
});

test('a browser reads ONLY its cached composer, never FocusedElement', async () => {
  // This is what makes the wider PanelUiaOk safe. The set of elements whose text
  // can be read in a browser is exactly one per window: the element that passed
  // the full composer test WHILE FOCUSED and re-verified this tick.
  const src = await enforcerSrc();
  for (const [name, from, to] of [
    ['UpdateUia', 'static void UpdateUia()', '// Recomputes the pinned rewrite candidate'],
    ['UpdatePendingRewrite', 'static void UpdatePendingRewrite()', 'static string _pastePatternsValue'],
  ]) {
    const fn = src.slice(src.indexOf(from), src.indexOf(to));
    assert.ok(fn.length > 0, `expected a ${name} body`);
    assert.match(fn, /ForegroundIsBrowser\(\)\r?\n?\s*\?\s*CachedWebComposer\(\)/,
      `${name} must read the cached composer for a browser`);
  }
  // The cache can ONLY be filled by the focused read, i.e. by an element that
  // passed the whole composer test.
  const code = codeOnly(src);
  assert.equal((code.match(/_webComposerCached = /g) || []).length, 4,
    'the composer cache may be assigned only at its declaration, the focused read, '
    + 'the name-gated background search, and DropWebComposer');
  const focused = src.slice(src.indexOf('static bool ReadFocusedWebComposer('), src.indexOf('// ---- Re-verify the cached composer'));
  assert.match(focused, /_webComposerCached = el;/);
  // …and the fill site is AFTER every refusal, so nothing that failed a test
  // can enter the cache.
  const fillIdx = focused.indexOf('_webComposerCached = el;');
  for (const refusal of ['if (chromeFocused) return false;', 'if (isPassword) return false;', 'if (!focusable) return false;']) {
    assert.ok(focused.indexOf(refusal) >= 0 && focused.indexOf(refusal) < fillIdx,
      `the composer cache must be filled only after "${refusal}"`);
  }
  // EDIT ONLY. A Document is the PAGE (and the transcript pane) in a Chromium
  // tree, so accepting it made the whole conversation eligible to be read every
  // 150ms. Found by the harness on 2026-09-09.
  // AI-219: catalog data, defaulted to "Edit" -- see the focused-read test.
  assert.match(focused, /if \(!string\.Equals\(ctName, WebComposerControlType\(host\), StringComparison\.OrdinalIgnoreCase\)\) return false;/);
  assert.equal(/"Document"/.test(codeOnly(src.slice(src.indexOf('// ======================= BROWSER SURFACES'), src.indexOf('static void StdinLoop()')))), false,
    'Document must not be accepted as a browser composer');
  // RE-VERIFY, NEVER REMEMBER: the cached element goes through the same tests
  // before its text may be read, and is dropped on any failure.
  const verify = src.slice(src.indexOf('static AutomationElement VerifiedWebComposer('), src.indexOf('static void SearchWebComposerBackground('));
  assert.ok(verify.length > 0, 'expected a VerifiedWebComposer body');
  assert.match(verify, /if \(isPassword\) \{ DropWebComposer\(\); return null; \}/);
  assert.match(verify, /if \(NameLooksLikeBrowserChrome\(name\)\) \{ DropWebComposer\(\); return null; \}/);
  assert.match(verify, /bool isPassword = true, focusable = false;/);
  assert.equal(/FindAll|TreeWalker/.test(verify), false, 'the re-verify must not walk the tree');
  // A NAVIGATION drops it — the one thing that must not survive.
  const sweep = src.slice(src.indexOf('static void UpdateBrowserNav(IntPtr fg, string host, long titleFp)'), src.indexOf('// ---- Bump the navigation generation'));
  assert.match(sweep, /DropWebComposer\(\);/);
  // The CLIPBOARD read is deliberately NOT widened with isAi.
  const paste = src.slice(src.indexOf('static void UpdatePaste()'), src.indexOf('// Some UIA text providers'));
  assert.match(paste, /if \(ForegroundIsBrowser\(\) && !_fgIsWebComposer\) \{ _blockPaste = false; return; \}/);
  // MODEL ROUTING IN A BROWSER (AI-216). The blanket `|| ForegroundIsBrowser()`
  // exclusion that used to sit here is GONE, deliberately — claude.ai's picker
  // is now live-probed catalog data behind its own enforce/verified pair. What
  // replaced it must be at least as strict about the READ, which is the part
  // this test is about: the browser arm goes through CachedWebComposer(), never
  // FocusedElement, so the set of elements whose text model routing can read in
  // a browser is still exactly one per window.
  const webRouting = src.slice(src.indexOf('static void UpdateWebModelRouting('),
                               src.indexOf('static void ClearPendingRoute()'));
  assert.ok(webRouting.length > 0, 'expected an UpdateWebModelRouting body');
  assert.match(webRouting, /AutomationElement el = CachedWebComposer\(\);/,
    'the browser routing arm must read the cached composer');
  assert.equal(/AutomationElement\.FocusedElement/.test(codeOnly(webRouting)), false,
    'the browser routing arm must NEVER read FocusedElement — in a browser that '
    + 'is whatever text box has the caret');
  // And it can only be reached at all through BOTH gates plus composer FOCUS —
  // routing swallows an Enter, so "the composer is readable" is not enough.
  const routing = src.slice(src.indexOf('static void UpdateModelRouting()'),
                            src.indexOf('static void UpdateWebModelRouting('));
  assert.match(routing, /if \(ForegroundIsBrowser\(\)\)/,
    'the routing arm must ask the PER-TICK browser question');
  assert.match(routing, /WebPicker webPicker = EnforcingWebPicker\(webSurface\);/);
  assert.match(routing, /if \(webPicker == null/);
  assert.match(routing, /\|\| !_fgIsWebComposer/,
    'routing must require the caret IN the composer, not merely a readable one');
  assert.match(routing, /\|\| _fgWebChromeFocused \|\| _fgWebPasswordFocused/,
    'routing must refuse in browser chrome and in a password field');
});

test('the send-button search is WARM, and the swallow decision did not loosen', async () => {
  const src = await enforcerSrc();
  const webStart = src.indexOf('static void UpdateWebSendRect()');
  const webEnd = src.indexOf('static void StdinLoop()');
  const webBody = src.slice(webStart, webEnd);
  // THE WARM GATES. No _fgIsBlocked, no _blockScope — those are decision terms
  // and they belong in the hook, not in the search.
  assert.match(webBody, /if \(!_fgIsAi\) \{ _webSendVerifiedTicks = 0; return; \}/);
  assert.match(webBody, /if \(Disarmed\(\)\) \{ _webSendVerifiedTicks = 0; return; \}/);
  // READABLE + FIRST-HAND, never FOCUSED. Requiring the caret to be in the
  // composer RIGHT NOW was a total bypass of the click block: clicking the
  // transcript withdrew the rect, so the hook had nothing left to consult.
  assert.match(webBody, /if \(!_fgWebComposerReadable \|\| _fgLeftAiTicks != 0\) \{ _webSendVerifiedTicks = 0; return; \}/);
  // COMMENTS STRIPPED. The comments in this region deliberately NAME the two
  // terms the code must not use ("This used to require `_fgIsBlocked` and
  // `_blockScope == \"web\"`..."), so a raw source match reads the explanation
  // of the bug as the bug. Third time this trap has fired in this suite:
  // assert on CODE, never on prose.
  const gateRegion = webBody.slice(0, webBody.indexOf('IntPtr fg = GetForegroundWindow();'))
    .split(String.fromCharCode(10)).filter((l) => !l.trim().startsWith('//')).join(String.fromCharCode(10));
  assert.equal(/_fgIsBlocked/.test(gateRegion), false,
    'the SEARCH must not wait for a block — that is the 2026-09-09 click bypass');
  assert.equal(/_blockScope/.test(gateRegion), false,
    '_blockScope is "" for a content block, so gating the search on it disabled the click block entirely');
  // …and the delegation happens BEFORE the block-or-typed-text early return,
  // which is what made the failure total for a PASTE (empty typed buffer).
  const fn = src.slice(src.indexOf('static void UpdateSendRect()'), src.indexOf('static void UpdateUia()'));
  const delegate = fn.indexOf('if (ForegroundIsBrowser()) { UpdateWebSendRect(); return; }');
  const earlyReturn = fn.indexOf('if (!_fgIsAi || (!BlockActiveForMouse() && TypedLength() < 1))');
  assert.ok(delegate >= 0 && earlyReturn > delegate,
    'the browser delegation must precede the block-or-typed-text return');
  assert.equal((fn.match(/UpdateWebSendRect\(\)/g) || []).length, 1, 'exactly one delegation site');

  // THE DECISION still carries every term it did. Nothing was removed — the
  // bounds-and-freshness half simply moved into ClickInSendRect (see the
  // dedicated test above for why, and for the assertions on the helper).
  const mouse = src.slice(src.indexOf('static IntPtr MouseCallback('), src.indexOf('static IntPtr HookCallback('));
  assert.match(mouse, /bool inRect = ClickInSendRect\(x, y\);/);
  assert.match(mouse, /if \(_fgIsAi && inRect\)/);
  assert.match(mouse, /if \(BlockActiveForMouse\(\)\)/);
  const forMouse = src.slice(src.indexOf('static bool BlockActiveForMouse()'), src.indexOf('// The Enter-decision predicate'));
  assert.match(forMouse, /if \(Disarmed\(\)\) return false;/);
  assert.match(forMouse, /if \(_fgIsBlocked && !WebBlockGateOk\(\)\) return false;/);
  // The two browser guards now key on _fgIsBrowser, NOT _blockScope — which was
  // "" for a content block and therefore exempted exactly the blocks that matter.
  const fresh = src.slice(src.indexOf('static bool SendRectFreshEnough()'), src.indexOf('// The catalog\'s control-type string'));
  assert.match(fresh, /if \(!_fgIsBrowser\) return true;/);
  const gate = src.slice(src.indexOf('static bool WebBlockGateOk()'), src.indexOf('// Is the latch holding a WEB-scoped block?'));
  assert.match(gate, /if \(!_fgIsBrowser\) return true;/);
  assert.match(gate, /if \(_fgWebPasswordFocused\) return false;/);
  // A warm rect must not turn an ordinary click into a capture event.
  assert.match(mouse, /if \(msg == WM_LBUTTONDOWN && !_fgIsBrowser\)/);
});

test('BYPASS 1: the govstate does NOT flap when focus moves inside the page', async () => {
  if (!win) return;
  // The live log showed ARMED -> disarmed -> ARMED on a 500ms cycle and then 55
  // seconds disarmed, with the raw send inside that window. Focus moving between
  // elements of the SAME governed page must change nothing about the surface.
  const t = await scenario('focus_roundtrip');
  assert.equal(t.length, 5);
  // ONE transition, on the first tick, and never again.
  assert.equal(t[0].govEmitted, true, 'the surface never armed');
  for (const r of t.slice(1)) {
    assert.equal(r.govEmitted, false, `tick ${r.tick}: THE GOVSTATE FLAPPED`);
    assert.equal(r.govActive, true, `tick ${r.tick}: the surface disarmed`);
  }
  // The host stays resolved and the surface stays an AI surface throughout —
  // including on tick 3, where the focused-element read failed entirely.
  for (const r of t) {
    assert.equal(r.fgIsAi, true, `tick ${r.tick}: the surface stopped being an AI surface`);
    assert.equal(r.fgWebHost, 'claude.ai', `tick ${r.tick}: the host stopped being resolved`);
    assert.equal(r.composerReadable, true, `tick ${r.tick}: the composer stopped being readable`);
    assert.equal(r.uiaOk, true, `tick ${r.tick}: the composer scan stopped`);
    // NO background re-search is needed to recover — the element was cached.
    assert.equal(r.navGen, t[0].navGen, `tick ${r.tick}: a focus move bumped the navigation generation`);
  }
  // CAPTURE still follows focus exactly as before: composer only.
  assert.deepEqual(t.map((r) => r.captureOn), [true, false, false, false, true],
    'keystroke capture must remain composer-only');
});

test('BYPASS 1: a PASTE is blocked, with an empty typed buffer, after a focus round-trip', async () => {
  if (!win) return;
  // THE ACCEPTANCE TEST for bypass 1. Nothing is typed, so the keystroke buffer
  // has no characters at all — the composer's UIA text is the only signal there
  // is, and it has to survive focus moving away and back.
  const t = await scenario('paste_after_focus_roundtrip');
  for (const r of t) {
    assert.equal(r.typedLen, 0, `tick ${r.tick}: the scenario must have an EMPTY typed buffer`);
    // The scan is alive on EVERY tick, including the ones where focus is on the
    // transcript. This is what was switched off.
    assert.equal(r.uiaOk, true, `tick ${r.tick}: THE PASTE DETECTOR WAS OFF`);
    assert.equal(r.composerReadable, true, `tick ${r.tick}: the composer was not readable`);
  }
  // Enter is swallowed whenever the caret is in the composer — which is the only
  // place Enter can send — and that includes the very first tick after focus
  // comes back, with no re-scan delay because the scan never stopped.
  assert.equal(t[0].pasteBlocked, true, 'a pasted secret did not block Enter');
  assert.equal(t[3].pasteBlocked, true, 'A PASTED SECRET SENT RAW AFTER A FOCUS ROUND-TRIP');
  // While focus is elsewhere Enter is not swallowed — correct, because Enter
  // cannot send from there either.
  assert.equal(t[1].pasteBlocked, false);
  assert.equal(t[1].captureOn, false);
});

test('BYPASS 1: new sensitive content after a Tokenize & Send blocks again', async () => {
  if (!win) return;
  // RunRewrite clears _blockUia/_blockTyped/_lastBlockFiredTicks right before
  // its synthetic Enter (it must — its own verified-clean masked text would
  // otherwise re-block the send it is performing). The next paste has to re-arm
  // from the composer scan on the following tick, not from the user retyping.
  const t = await scenario('reblock_after_tokenize');
  assert.equal(t[1].uiaOk, true, 'the composer scan did not resume after a rewrite');
  assert.equal(t[1].pasteBlocked, true, 'NEW CONTENT AFTER A TOKENIZE DID NOT RE-BLOCK');
  // …and again after the focus round-trip that is how the user actually hit it.
  assert.equal(t[3].pasteBlocked, true, 'no re-block after a rewrite plus a focus round-trip');
  assert.equal(t[3].composerReadable, true);
});

test('BYPASS 1: the wider scan reads the composer and NOTHING else', async () => {
  if (!win) return;
  // The widening must not make any other element readable. Focus moves to a
  // PASSWORD field on the governed host AFTER the composer was cached.
  const pw = await scenario('password_after_composer');
  for (const i of [1, 2]) {
    assert.equal(pw[i].composer, false, `tick ${i}: a password field was treated as the composer`);
    assert.equal(pw[i].passwordFocused, true, `tick ${i}: the password field was not recognised`);
    // The COMPOSER stays readable — that is the fix — and the password field is
    // simply not what gets read.
    assert.equal(pw[i].composerReadable, true, `tick ${i}: the composer stopped being readable`);
    assert.equal(pw[i].captureOn, false, `tick ${i}: A PASSWORD WOULD BE BUFFERED`);
    // A whole-site block must not leave Enter dead in the login form.
    assert.equal(pw[i].webGateOk, false, `tick ${i}: Enter would be swallowed in a password field`);
    assert.equal(pw[i].enterBlocked, false, `tick ${i}: ENTER WAS SWALLOWED IN A PASSWORD FIELD`);
  }
  assert.equal(pw[3].composer, true, 'the composer did not recover');
  // THE OMNIBOX, same shape: readable composer, and Enter must still navigate.
  const om = await scenario('omnibox_after_composer');
  assert.equal(om[1].chromeFocused, true);
  assert.equal(om[1].composerReadable, true, 'the composer stopped being readable in the omnibox');
  assert.equal(om[1].captureOn, false);
  assert.equal(om[1].enterBlocked, false, 'ENTER WAS SWALLOWED IN THE ADDRESS BAR');
  // A DOCUMENT (the page / the transcript pane) is not a composer at all.
  const nc = await scenario('non_composer_elements');
  assert.equal(nc[0].composer, false, 'a page Document was treated as the composer');
  assert.equal(nc[0].composerReadable, false, 'a page Document entered the composer cache');
  assert.equal(nc[0].uiaOk, false, 'THE WHOLE PAGE WOULD BE SCANNED');
});

test('BYPASS 1: a real navigation still drops the cached composer', async () => {
  if (!win) return;
  // The one thing that must NOT survive. After a tab switch or a navigation the
  // cached element belongs to a page that is no longer in front of the user.
  const t = await scenario('nav_drops_composer');
  assert.equal(t[1].composerReadable, true, 'a mere focus move dropped the cache');
  assert.equal(t[1].navGen, t[0].navGen);
  // Same-host tab switch: the title changes, the generation bumps, the cache goes.
  assert.equal(t[2].navGen, t[1].navGen + 1, 'a same-host tab switch was not detected');
  assert.equal(t[2].composerReadable, false, 'THE COMPOSER CACHE SURVIVED A TAB SWITCH');
  assert.equal(t[2].uiaOk, false, 'the previous page would still be scanned');
  // Off the governed host entirely: everything disarms.
  assert.equal(t[3].composerReadable, false);
  assert.equal(t[3].govActive, false, 'the file watchers stayed armed on an ungoverned tab');
  // A SECOND WINDOW is a different page too.
  const w = await scenario('nav_drops_composer_win');
  assert.equal(w[1].navGen, w[0].navGen + 1);
  assert.equal(w[1].composerReadable, false, 'the composer cache survived a window change');
});

test('BYPASS 2: a click within ONE POLL TICK of the block arming is swallowed', async () => {
  if (!win) return;
  // THE ACCEPTANCE TEST for bypass 2, and the case that failed live. The rect
  // must already be warm from ordinary composer focus, so the instant a block
  // arms — which happens in the keyboard hook, by setting a boolean — a click is
  // swallowed with NO search and NO extra poll tick.
  const probe = (await scenario('send_probe'))[0];
  assert.equal(probe.probeOk, true, 'the harness could not build a real UIA probe element');
  const t = await scenario('click_race');
  const byTick = Object.fromEntries(t.map((r) => [r.tick, r]));

  // 1. NO BLOCK ARMED: the rect is warm (the fix) and the click is NOT swallowed
  //    (the proof that moving the search earlier did not loosen the decision).
  assert.equal(byTick[1].hasRect, true, 'the rect was not warmed by ordinary composer focus');
  assert.equal(byTick[1].rectFresh, true);
  assert.equal(byTick[1].fgIsBlocked, false);
  assert.equal(byTick[1].clickSwallowed, false, 'a click was swallowed with NO BLOCK ARMED');

  // 2. THE BLOCK ARMS, and the click is evaluated with NO poll tick in between —
  //    SendStaleCheck runs only the hook's side. This is what "within one tick"
  //    means, and it is exactly what used to lose the race.
  assert.equal(byTick[2].clickSwallowed, true, 'A CLICK GOT THROUGH WITHIN ONE TICK OF THE BLOCK ARMING');
  assert.equal(byTick[2].hasRect, true);
  assert.equal(byTick[2].searchKicked, false, 'a search was needed — the rect was not warm');

  // 3. TWO CONSECUTIVE CLICKS with the sensitive text still in the composer.
  //    The swallow path stamps a 30s cooldown and does not clear the buffer.
  assert.equal(byTick[3].clickSwallowed, true, 'the first of two clicks was not swallowed');
  assert.equal(byTick[4].clickSwallowed, true, 'THE SECOND CLICK GOT THROUGH');

  // 4. THE RELABEL HAZARD, now that the rect can be warm before any block:
  //    `Send message` -> `Use voice mode` must withdraw it even mid-block.
  assert.equal(byTick[5].buttonName, 'Use voice mode');
  assert.equal(byTick[5].hasRect, false, 'A WARM RECT WAS HONOURED FOR THE MICROPHONE');
  assert.equal(byTick[5].rectFresh, false);
  assert.equal(byTick[5].clickSwallowed, false, 'a click on the microphone would be swallowed');
  assert.equal(byTick[6].clickSwallowed, true, 'the rect did not recover when the send button returned');
});

test('BYPASS 3: the send arrow is swallowed with the composer UNFOCUSED', async () => {
  if (!win) return;
  // THE ACCEPTANCE TEST for the 2026-09-09 unfocused-click bypass, and it is
  // reached with nothing but ordinary user actions: paste a secret into the
  // composer (the block arms), click the transcript or the page margin, click
  // the send arrow. It SENT — for a DLP content block and for a whole-site
  // platform block alike, so "you may not use claude.ai" was defeated by
  // clicking the page first.
  //
  // Two independent gates each caused it, and both are exercised here:
  // UpdateWebSendRect required _fgIsWebComposer so the rect stopped being
  // published at all, and BlockActiveForMouse fell through to PanelEnforceOk(),
  // which answers _fgIsWebComposer for a browser.
  const c = Object.fromEntries((await scenario('unfocused_click_content')).map((r) => [r.tick, r]));
  // The scenario has to be a CONTENT block to be meaningful: a content block
  // sets no _blockedByElement, which is the half the platform arm did not cover.
  assert.equal(c[1].fgIsBlocked, false, 'the scenario must be a CONTENT block');
  assert.equal(c[1].hasRect, true);
  assert.equal(c[1].clickSwallowed, true, 'the focused baseline must swallow');
  // THE BYPASS: the caret is in the TRANSCRIPT. Same page, same tab, same host.
  assert.equal(c[3].hasRect, true, 'THE RECT WAS WITHDRAWN WHEN FOCUS LEFT THE COMPOSER — that IS the bypass');
  assert.equal(c[3].rectFresh, true);
  assert.equal(c[3].buttonName, 'Send message');
  assert.equal(c[3].clickSwallowed, true, 'A CLICK ON THE SEND ARROW WAS LET THROUGH WITH THE COMPOSER UNFOCUSED');
  // …and with an UNREADABLE focused-element read, i.e. the page margin.
  assert.equal(c[5].clickSwallowed, true, 'an unreadable focus read withdrew the click block');
  // A SECOND click, after the first stamped the 30s cooldown.
  assert.equal(c[6].clickSwallowed, true);
  // Back in the composer: no regression.
  assert.equal(c[8].clickSwallowed, true);
  // A click well OUTSIDE the rect is never swallowed on any of these ticks —
  // the RECT, not focus, is what scopes a click.
  for (const t of [1, 3, 5, 6, 8]) {
    assert.equal(c[t].farClickSwallowed, false, `tick ${t}: a click outside the rect was swallowed`);
  }

  // A PLATFORM (whole-site) block, same move. This one was broken by gate 1a
  // alone: the rect stopped being published, so _blockedByElement never got the
  // chance to matter.
  const p = Object.fromEntries((await scenario('unfocused_click_platform')).map((r) => [r.tick, r]));
  assert.equal(p[1].fgIsBlocked, true, 'the scenario needs an armed site block');
  assert.equal(p[1].blockScope, 'web');
  assert.equal(p[1].clickSwallowed, true, 'the focused baseline must swallow');
  assert.equal(p[3].clickSwallowed, true, 'A WHOLE-SITE BLOCK WAS DEFEATED BY CLICKING THE PAGE FIRST');
  assert.equal(p[5].clickSwallowed, true);
});

test('BYPASS 3: the click path stayed shut everywhere it was shut before', async () => {
  if (!win) return;
  // NO BLOCK, composer unfocused. The rect is warm (that is the fix) and the
  // DECISION is shut (that is the proof the fix did not loosen it).
  for (const r of await scenario('unfocused_click_noblock')) {
    assert.equal(r.fgIsBlocked, false);
    assert.equal(r.clickSwallowed, false,
      'A CLICK WAS SWALLOWED WITH NO BLOCK ARMED — the unfocused fix loosened the decision');
  }
  // THE OMNIBOX, with a site block armed. The rect may be warm (the page has
  // not changed), but WebBlockGateOk() still refuses the click while the caret
  // is in browser chrome. That term is the one the mouse path KEEPS.
  const o = Object.fromEntries((await scenario('unfocused_click_omnibox')).map((r) => [r.tick, r]));
  assert.equal(o[1].clickSwallowed, true, 'the focused baseline must swallow');
  assert.equal(o[3].clickSwallowed, false, 'A CLICK WAS SWALLOWED WITH THE CARET IN THE ADDRESS BAR');
  // A PASSWORD FIELD on the governed host, same rule and the same predicate.
  const pw = Object.fromEntries((await scenario('unfocused_click_password')).map((r) => [r.tick, r]));
  assert.equal(pw[1].clickSwallowed, true);
  assert.equal(pw[3].clickSwallowed, false, 'A CLICK WAS SWALLOWED WITH A PASSWORD FIELD FOCUSED');
  // AN UNVERIFIED SURFACE — the shipped catalog. Nothing published, nothing
  // searched, nothing swallowed, focused or not, block armed or not.
  for (const r of await scenario('unfocused_click_unverified')) {
    assert.equal(r.hasRect, false, `tick ${r.tick}: a rect was published for an unverified surface`);
    assert.equal(r.clickSwallowed, false, `tick ${r.tick}: a click was swallowed on an unverified surface`);
    assert.equal(r.searchKicked, false, `tick ${r.tick}: a search ran for an unverified surface`);
    assert.equal(r.verifiedAt, 0);
  }
  // THE BOUND ON "READABLE". The gate now rests on the composer CACHE, so the
  // thing that must still withdraw the rect is a NAVIGATION — otherwise
  // "readable" would quietly come to mean "for ever".
  const n = Object.fromEntries((await scenario('unfocused_click_nav')).map((r) => [r.tick, r]));
  assert.equal(n[1].clickSwallowed, true, 'the baseline must swallow');
  assert.equal(n[3].hasRect, false, 'a same-host tab switch did not withdraw the rect');
  assert.equal(n[3].verifiedAt, 0);
  assert.equal(n[3].clickSwallowed, false);
  assert.equal(n[5].hasRect, false, 'leaving the governed host did not withdraw the rect');
  assert.equal(n[5].clickSwallowed, false);
});

test('BYPASS 3: ENTER still requires composer focus — the click fix did not leak', async () => {
  if (!win) return;
  const c = Object.fromEntries((await scenario('unfocused_enter_content')).map((r) => [r.tick, r]));
  // FOCUSED: a typed or pasted secret swallows Enter. Unchanged.
  assert.equal(c[0].composer, true);
  assert.equal(c[0].dlpBlocked, true);
  assert.equal(c[0].pasteBlocked, true);
  // UNFOCUSED: Enter is NOT swallowed, and that is correct rather than a gap.
  // Enter anywhere else on the page does not send, and swallowing it there would
  // kill Enter in the site's own search box and in every form on it. This is the
  // asymmetry MouseEnforceOk exists to preserve.
  for (const t of [1, 2]) {
    assert.equal(c[t].composer, false);
    assert.equal(c[t].composerReadable, true,
      `tick ${t}: the composer must stay READABLE — that is what keeps the paste detector alive`);
    assert.equal(c[t].dlpBlocked, false,
      `tick ${t}: ENTER WAS SWALLOWED WITH THE COMPOSER UNFOCUSED — the click fix leaked into the keystroke path`);
    assert.equal(c[t].captureOn, false, `tick ${t}: keystrokes were captured with the composer unfocused`);
  }
  // Back in the composer, blocked again.
  assert.equal(c[3].dlpBlocked, true);

  // A PLATFORM block is deliberately DIFFERENT here: it is element-scoped
  // through _blockedByElement, which BlockActiveForMouse and EnterBlockActive
  // both check AHEAD of the enforce predicate, so it survives the focus move for
  // Enter as well. "Not this site" is not the same statement as "not this text
  // in this composer", and flattening the two would break one of them.
  const p = Object.fromEntries((await scenario('unfocused_enter_platform')).map((r) => [r.tick, r]));
  assert.equal(p[0].enterBlocked, true);
  assert.equal(p[1].composer, false);
  assert.equal(p[1].blockedByElement, true);
  assert.equal(p[1].enterBlocked, true, 'a whole-site block must survive a click into the transcript');
  // …and the address bar still navigates, block or no block.
  assert.equal(p[2].chromeFocused, true);
  assert.equal(p[2].webGateOk, false);
  assert.equal(p[2].enterBlocked, false, 'ENTER WAS SWALLOWED IN THE ADDRESS BAR OF A BLOCKED TAB');
});

test('BYPASS 4: the STICKY _app cannot point the desktop paths at a browser', async () => {
  if (!win) return;
  // Alt-tab from Claude Desktop (or ChatGPT Desktop) straight into Chrome. _app
  // is assigned ONLY on a tick that WAS an AI surface, so for FG_STICKY_TTL (3s)
  // it still names the desktop app while the window in front of the user is a
  // browser — and every guard keyed on `_browserProcs.Contains(_app)` was
  // skipped for those three seconds.
  for (const name of ['sticky_app_reads', 'sticky_app_reads_chatgpt']) {
    const [r] = await scenario(name);
    // Prove the scenario still reproduces, rather than asserting against a
    // setup that quietly stopped being the one under test.
    assert.match(r.app, /^(Claude|ChatGPT)$/, 'the scenario needs _app to still name the DESKTOP app');
    assert.equal(r.fgIsAi, true, 'the scenario needs the sticky window to still be open');
    assert.equal(r.fgIsBrowser, true, 'the scenario needs a BROWSER foreground');
    assert.equal(r.sticky, true, 'the scenario needs _fgLeftAiTicks to be running');
    // The predicate the fix turns on.
    assert.equal(r.fgBrowserNow, true, 'ForegroundIsBrowser() must see the browser regardless of _app');
    // UpdateUia and UpdatePendingRewrite are BOTH gated on `_fgIsAi &&
    // PanelUiaOk()`, so a false here means AutomationElement.FocusedElement is
    // never reached — no DLP scan of a bank form, a web login or the omnibox,
    // and no _blockUia armed off unrelated page content.
    assert.equal(r.panelUiaOk, false,
      'PanelUiaOk answered its PERMISSIVE fall-through for a browser foreground');
    assert.equal(r.uiaOk, false, 'a UIA content read was licensed over a browser window');
    // …and the click path is not licensed either.
    assert.equal(r.mouseEnforceOk, false);
  }
  const reads = (await scenario('sticky_app_reads'))[0];
  // UpdatePendingRewrite PINNED NOTHING, asserted as a POSITIVE fact:
  // _pendingFrozen is set true in exactly one place in the .ps1 — inside that
  // guard's early return — so this is evidence the guard fired rather than an
  // absence that could have had any number of causes.
  assert.equal(reads.pendingFrozen, true,
    'UpdatePendingRewrite did not take its guard — it read the browser and re-pinned');
  assert.equal(reads.pendingBlockId, 'sentinel-pin', 'the planted pin was replaced from a browser read');
  // UpdatePaste is NOT asserted behaviourally here, and the reason is worth
  // stating rather than hiding: the harness deliberately loads NO DLP patterns
  // and ReadClipboard() reads the real clipboard, so _blockPaste ends up false
  // whether the refusal fires or not. Verified vacuous by mutation — reverting
  // that one guard alone left this test green. The harm there is that the
  // CLIPBOARD IS READ AT ALL on a tick whose window is an arbitrary web page,
  // and that is not observable from outside without instrumenting the read. It
  // is covered by the source invariant in 'the source separates the ENTER
  // decision from the CLICK decision', which is the honest level for it.
  assert.equal(typeof reads.blockPaste, 'boolean');

  // UpdateSendRect DELEGATED instead of running its generic search. The
  // discriminator is structural: UpdateWebSendRect clears the freshness stamp on
  // every one of its early returns, and the desktop body never touches that
  // stamp once it is past its own first gate — so a stamp that went in FRESH and
  // came out 0 means the delegation happened and FindAll(Descendants) never ran.
  // UpdateModelRouting returned early. Its OWN tick, because the obvious version
  // of this was vacuous: driving it on the tick above proved nothing, since the
  // routing body's `if (pendingRewritable) ClearPendingRoute()` cleared the pin
  // whether the browser exclusion fired or not (confirmed by mutation). On a
  // tick with no block and no pending rewrite, the guard is the ONLY thing that
  // clears the route — and every path past it either returns without clearing or
  // stamps the picker search.
  const [route] = await scenario('sticky_app_routing');
  assert.equal(route.fgIsBrowser, true);
  assert.equal(route.app, 'Claude');
  assert.equal(route.routeArmed, false, 'UpdateModelRouting did not take its browser exclusion');
  assert.equal(route.pickerSearched, false, 'the model-picker descendant search ran over a browser window');
  assert.equal(route.pickerSearchInProgress, false);

  const [rect] = await scenario('sticky_app_sendrect');
  assert.equal(rect.app, 'Claude');
  assert.equal(rect.fgIsBrowser, true);
  assert.equal(rect.fgIsBlocked, true,
    'the scenario needs a block armed, or UpdateSendRect returns before the search either way');
  assert.equal(rect.verifiedAt, 0, 'THE GENERIC SEND-BUTTON SEARCH RAN AGAINST A BROWSER WINDOW');
  assert.equal(rect.hasRect, false, 'the desktop path published a rect for a browser window');
});

test('the source separates the ENTER decision from the CLICK decision', async () => {
  const src = await enforcerSrc();
  const code = codeOnly(src);
  // ONE helper answers "is the foreground a browser right now", and it consults
  // the PER-TICK flag first. _app is the sticky name, and that was the whole of
  // bypass 4.
  assert.match(code, /static bool ForegroundIsBrowser\(\) \{ return _fgIsBrowser \|\| _browserProcs\.Contains\(_app\); \}/);

  // The CLICK predicate is its OWN function, so the two decisions stay visibly
  // separate instead of one being widened into the other.
  const me = src.slice(src.indexOf('static bool MouseEnforceOk()'), src.indexOf('// Block is active for mouse-hook send-button detection'));
  assert.ok(me.length > 0, 'expected a MouseEnforceOk body');
  assert.match(me, /if \(ForegroundIsBrowser\(\)\) return _fgWebComposerReadable && _fgLeftAiTicks == 0;/);
  // …and every NON-browser scope is PanelEnforceOk verbatim, so the
  // detection-only-panel rule and the Teams host-app rule do not move.
  assert.match(me, /return PanelEnforceOk\(\);/);
  // PURE: the hook thread calls it.
  assert.equal(/AutomationElement|FindAll|TreeWalker|ScanNames|new Regex/.test(me), false,
    'MouseEnforceOk must do no UIA and no scanning — the hook thread calls it');

  // THE ASYMMETRY. Asserted on CODE with comments stripped: the comments in both
  // regions deliberately name the other predicate while explaining why it does
  // not belong there, and three tests in this suite have already failed by
  // matching prose instead of code.
  const forMouse = codeOnly(src.slice(src.indexOf('static bool BlockActiveForMouse()'), src.indexOf('// The Enter-decision predicate')));
  assert.match(forMouse, /if \(!MouseEnforceOk\(\)\) return false;/);
  const enterPred = codeOnly(src.slice(src.indexOf('static bool EnterBlockActive('), src.indexOf('static string ActivePatterns()')));
  assert.match(enterPred, /if \(!PanelEnforceOk\(\)\) return false;/);
  assert.equal(/MouseEnforceOk/.test(enterPred), false, 'the ENTER path must not take the click predicate');
  // PanelEnforceOk keeps requiring COMPOSER FOCUS for a browser. Loosening it
  // would swallow Enter in a site's own search box and in every form on it.
  const enforce = codeOnly(src.slice(src.indexOf('static bool PanelEnforceOk()'), src.indexOf('static bool PanelUiaOk()')));
  assert.match(enforce, /if \(_browserProcs\.Contains\(_app\)\) return _fgIsWebComposer;/);
  assert.equal(/_fgWebComposerReadable/.test(enforce), false,
    'PanelEnforceOk must not take the READABLE form — that is the click predicate, not the Enter one');

  // Every REFUSAL guard for a browser asks the PER-TICK question.
  for (const [what, re] of [
    ['UpdateSendRect delegation', /if \(ForegroundIsBrowser\(\)\) \{ UpdateWebSendRect\(\); return; \}/],
    ['UpdateUia element choice', /AutomationElement el = ForegroundIsBrowser\(\)\r?\n?\s*\?\s*CachedWebComposer\(\)/],
    ['UpdatePendingRewrite element choice', /el = ForegroundIsBrowser\(\) \? CachedWebComposer\(\) : AutomationElement\.FocusedElement;/],
    ['UpdatePaste refusal', /if \(ForegroundIsBrowser\(\) && !_fgIsWebComposer\) \{ _blockPaste = false; return; \}/],
    // AI-216: the blanket exclusion became a GATED ARM, but it still asks the
    // per-tick question rather than the sticky _app one — which is what stopped
    // routing running over a browser window for 3s after an alt-tab.
    ['UpdateModelRouting browser arm', /if \(ForegroundIsBrowser\(\)\)\r?\n?\s*\{\r?\n?\s*WebSurface webSurface = EnforcingWebSurface\(_fgWebHost\);/],
    ['PanelUiaOk browser branch', /if \(ForegroundIsBrowser\(\)\) return _fgWebComposerReadable && _fgLeftAiTicks == 0;/],
    ['CurrentWebSurface', /if \(!_fgIsBrowser\) return null;/],
  ]) {
    assert.match(code, re, `${what} must ask the PER-TICK question`);
  }

  // THE TWO SITES THAT KEEP THE STICKY NAME, both deliberate and both documented
  // at the site:
  //   * PanelEnforceOk (above) — its CAPTURE consumer already ANDs
  //     _fgLeftAiTicks == 0, and its BLOCK consumers are sticky on purpose, so
  //     answering `false` for a browser foreground would WITHDRAW a block armed
  //     in the desktop app the user just left;
  //   * CheckFgBlocked's coarse-arm bar — barring MORE there is the fail-OPEN
  //     direction, for the same reason.
  const check = codeOnly(src.slice(src.indexOf('static void CheckFgBlocked()'), src.indexOf('static void ClearFgBlocked()')));
  assert.match(check, /bool browserProc = _browserProcs\.Contains\(_app\);/);
  // …and NO OTHER site reads the sticky name to answer a browser question. The
  // three are the helper's own definition plus those two.
  assert.equal((code.match(/_browserProcs\.Contains\(_app\)/g) || []).length, 3,
    'a new sticky-_app browser guard appeared — use ForegroundIsBrowser() unless the sticky value is deliberate');

  // UpdateWebSendRect's gate is READABLE + FIRST-HAND, never FOCUSED. Asserted
  // on the gate region with comments stripped, because those comments name
  // _fgIsWebComposer precisely in order to explain why it must not be the gate.
  const webStart = src.indexOf('static void UpdateWebSendRect()');
  const webEnd = src.indexOf('static void StdinLoop()');
  assert.ok(webStart >= 0 && webEnd > webStart, 'could not locate the UpdateWebSendRect body');
  const webBody = src.slice(webStart, webEnd);
  const gateRegion = codeOnly(webBody.slice(0, webBody.indexOf('IntPtr fg = GetForegroundWindow();')));
  assert.match(gateRegion, /if \(!_fgWebComposerReadable \|\| _fgLeftAiTicks != 0\) \{ _webSendVerifiedTicks = 0; return; \}/);
  assert.equal(/_fgIsWebComposer/.test(gateRegion), false,
    'requiring composer FOCUS to publish the rect is the unfocused-click bypass');
});

test('the composer background search is identified POSITIVELY, or it caches nothing', async () => {
  // WHY THIS FUNCTION MAY WALK THE TREE WHEN THE FOCUSED READ MAY NOT.
  //
  // The focused read's proof that an element is the composer is THE CARET: the
  // user put it there. A search has no such evidence, so accepting the same set
  // (any non-chrome, non-password, focusable Edit) would cache the first page
  // input it walked past — a site search box, a comment field, a login form's
  // username — and UpdateUia would then read its text every tick.
  //
  // So the search demands an EXACT match on the catalog's live-probed composer
  // name, which is the same discipline prompt-watcher.ps1's
  // Is-BrowserComposerElement already uses on the capture side. The invariant is
  // not "never search", it is "NEVER ACCEPT AN UNIDENTIFIED ELEMENT".
  //
  // It exists because the cache used to be fillable ONLY from a focused tick,
  // and MouseEnforceOk() requires it — so until it was filled, a click on the
  // send button was not swallowed at all and the prompt went.
  const src = await enforcerSrc();
  const fn = src.slice(src.indexOf('static void SearchWebComposerBackground('),
                       src.indexOf('static void MaybeSearchWebComposer('));
  assert.ok(fn.length > 0, 'expected a SearchWebComposerBackground body');

  // THE GATE. The compare itself now lives in WebComposerIdentity, which the
  // search and BOTH read paths share — so a search can never end up laxer than
  // a focused read, which is the property this originally protected.
  assert.match(fn, /WebComposerIdentity\(surfaceForSearch, name, aidS, out ignoredS\) == WEB_ID_NOT_COMPOSER\) continue;/);
  assert.match(fn, /WebSurface surfaceForSearch = MatchWebSurface\(host\);/);
  assert.match(fn, /if \(surfaceForSearch == null\) return;/);
  const identityFn = src.slice(src.indexOf('static int WebComposerIdentity('),
                               src.indexOf('static WebSurface EnforcingWebSurface('));
  assert.ok(identityFn.length > 0, 'expected a WebComposerIdentity body');
  // A FIXED-name surface is still whole-string and Ordinal. A near-miss is
  // exactly what an impostor looks like.
  assert.match(identityFn, /if \(!string\.Equals\(nm, exact, StringComparison\.Ordinal\)\) return WEB_ID_NOT_COMPOSER;/);
  // A STRUCTURAL surface must match the AutomationId ordinally before its
  // prefix is even considered — the prefix alone is not an identity.
  assert.match(identityFn, /if \(wantAid\.Length > 0 && !string\.Equals\(automationId \?\? "", wantAid, StringComparison\.Ordinal\)\)/);
  // The generic filter runs BEFORE any match, so an agent literally named
  // "Copilot" can never be matched by name. Scoped to the PREFIX route, which
  // is the only one that reads a display name at all: AI-219's url_path route
  // returns earlier and matches an opaque id, where there is no name for a
  // generic filter to act on (see the url_path test below).
  const prefixRoute = identityFn.slice(identityFn.indexOf('foreach (string prefix in web.ComposerNamePrefixes)'));
  assert.ok(prefixRoute.length > 0, 'expected the prefix route');
  const genericIdx = prefixRoute.indexOf('web.GenericNames.Contains(remainder)');
  const namedIdx = prefixRoute.indexOf('return WEB_ID_NAMED;');
  assert.ok(genericIdx > 0 && genericIdx < namedIdx, 'the generic filter must precede a named match');
  // And only a NAMED outcome may ever carry an agent name out.
  assert.match(identityFn, /agentName = remainder;\s*\r?\n\s*return WEB_ID_NAMED;/);
  // A name that will not read is refused rather than allowed through.
  assert.match(fn, /if \(name == null\) continue;/);

  // Every refusal the focused read makes, this makes too — and each defaults to
  // the REFUSING value on a throw.
  assert.match(fn, /bool isPassword = true, focusable = false;/);
  assert.match(fn, /if \(isPassword\) continue;/);
  assert.match(fn, /if \(!focusable\) continue;/);
  assert.match(fn, /if \(NameLooksLikeBrowserChrome\(name\)\) continue;/);
  // Ownership goes through the ONE shared rule, never a private parent lookup.
  assert.match(fn, /if \(!ElementPidBelongsToForeground\(el\.Current\.ProcessId, fgPid\)\) continue;/);
  assert.equal(/GetParentProcessId/.test(fn), false);
  // It identifies an element; it never reads content and never emits.
  assert.equal(/ValuePattern|TextPattern|Emit\(|Console\.Out/.test(fn), false,
    'the search must identify an element, never read its content');
  // Never half-applied: the cache is written only on a search that found
  // something, and every field moves together.
  assert.match(fn, /if \(found != null\)\s*\{\s*_webComposerCached = found;/);

  // AND IT ONLY RUNS FOR A SURFACE WITH A PROBED SIGNATURE. Empty means no
  // search — the same discipline SendButtonName uses for the click block, so an
  // unprobed surface keeps its old focus-only behaviour rather than getting a
  // guess.
  const kick = src.slice(src.indexOf('static void MaybeSearchWebComposer('),
                         src.indexOf('static void DropWebComposer('));
  assert.ok(kick.length > 0, 'expected a MaybeSearchWebComposer body');
  assert.match(kick, /bool canIdentify = WebSurfaceCanIdentifyComposer\(web\);/);
  assert.match(kick, /if \(!canIdentify\) return;/);
  // ONE rule, shared by the search and both read paths, so a SEARCH can never
  // end up laxer than a FOCUSED READ. Its three accepted shapes are asserted
  // on the function itself.
  const canId = src.slice(src.indexOf('static bool WebSurfaceCanIdentifyComposer('),
                          src.indexOf('static WebSurface EnforcingWebAgentRead('));
  assert.ok(canId.length > 0, 'expected a WebSurfaceCanIdentifyComposer body');
  assert.match(canId, /if \(\(web\.ComposerName \?\? ""\)\.Length > 0\) return true;/);
  // The AutomationId is REQUIRED for both structural shapes: a prefix alone
  // would be a structural match wearing a name, which is the defect audit
  // finding 4 was about, and a url_path surface with no id has no identity
  // at all.
  assert.match(canId, /if \(\(web\.ComposerAutomationId \?\? ""\)\.Length == 0\) return false;/);
  assert.match(canId, /if \(web\.ComposerNamePrefixes != null && web\.ComposerNamePrefixes\.Count > 0\) return true;/);
  assert.match(canId, /return WebAgentReadIsUrlPath\(web\);/);
  // Off the poll thread, so a heavy page's descendant walk cannot stretch the
  // 150ms tick, and STA because UIA requires it.
  assert.match(kick, /t\.SetApartmentState\(ApartmentState\.STA\);/);
  assert.match(kick, /t\.IsBackground = true;/);
  // One search at a time, with the same backoff shape as the omnibox finder.
  assert.match(kick, /if \(_webComposerSearchInProgress\) return;/);

  // And it is kicked ONLY from the branch that has already established the
  // surface is governed AND enforcing — never speculatively.
  assert.match(src, /if \(!webComposerReadable\) MaybeSearchWebComposer\(fg, pid, webHost, EnforcingWebSurface\(webHost\)\);/);

  // THE NAVIGATION GATE. UpdateBrowserNav is documented as the ONE place that
  // decides something changed, and it drops the composer cache there. This
  // search runs on another thread for up to a few hundred ms, so without a
  // generation check it can complete AFTER a tab switch or an in-page
  // navigation and re-install the previous page's element — undoing that drop,
  // with the pre-navigation host string. VerifiedWebComposer cannot catch it:
  // same window, same host, still an Edit. A same-host SPA navigation (picking
  // another conversation) is exactly the case it misses.
  assert.match(kick, /int navGen = _browserNavGen;/,
    'the generation must be read on the poll thread, before the search is kicked');
  assert.match(fn, /if \(navGen != _browserNavGen\) return;/,
    'a search that outlived its navigation must discard its result, not install it');
  const writeIdx = fn.indexOf('_webComposerCached = found;');
  const gateIdx = fn.indexOf('if (navGen != _browserNavGen) return;');
  assert.ok(gateIdx > 0 && gateIdx < writeIdx, 'the gate must precede the cache write');

  // The latch mirrors the omnibox searcher's, INCLUDING its volatile: it is
  // written by the background thread and read by the poll thread. A stale true
  // silently stops every future search — back to the no-swallow bypass.
  assert.match(src, /static volatile bool _webComposerSearchInProgress = false;/);
  // And a throw before the thread starts must not strand the latch true, which
  // would be a permanent, silent return to that same bypass.
  assert.match(kick, /catch\s*\{\s*_webComposerSearchInProgress = false;\s*\}/);

  // Visibility is a TIEBREAK, never a filter: it may prefer one match over
  // another but must not reject the only one, because IsOffscreen is a layout
  // answer and a composer that reports offscreen spuriously must still be
  // governed.
  assert.match(fn, /found = el;\s*if \(!offscreen\) break;/);
});

test('a web block applies ONLY on the host it was armed for', async () => {
  // THE BUG, seen live twice: a blocked Gemini tab followed by ChatGPT, and a
  // blocked ChatGPT tab followed by claude.ai — which was NOT blocked at all.
  // Both swallowed the send on the NEW tab and logged it against the OLD tab's
  // platform ("BLOCKED send into Claude — [Blocked platform: ChatGPT]").
  //
  // Cause: _blockedBrowserHost was set by CheckFgBlocked's web arm and cleared
  // by ClearFgBlocked, but NOTHING COMPARED IT to the host in front of the user.
  // A web block deliberately survives a foreground change — the latch and the
  // sticky window keep it alive so one bad read cannot tear down a real block —
  // so "still armed" and "still on the blocked site" had become the same
  // question. The mislabel was the visible half; the FALSE BLOCK on an
  // unblocked site was the real damage.
  const src = await enforcerSrc();
  const gate = src.slice(src.indexOf('static bool WebBlockGateOk()'),
                         src.indexOf('static string ActivePatterns()'));
  assert.ok(gate.length > 0, 'expected a WebBlockGateOk body');
  assert.match(gate, /string armedHost = _blockedBrowserHost \?\? "";/);
  assert.match(gate, /string hereHost = _fgWebHost \?\? "";/);
  assert.match(gate, /if \(armedHost\.Length > 0 && hereHost\.Length > 0\s*\r?\n\s*&& !string\.Equals\(armedHost, hereHost, StringComparison\.OrdinalIgnoreCase\)\) return false;/);

  // FAIL DIRECTION. It must refuse only on POSITIVE evidence of a different
  // governed host: an empty hereHost means the read failed or the tab is not a
  // governed surface, and neither proves the user left the blocked site. An
  // unreadable tick therefore KEEPS the block, like every other web term here.
  assert.equal(/if \(armedHost\.Length > 0 && !string\.Equals/.test(gate), false,
    'an unreadable host must not tear down an armed block');

  // And the gate is consulted by BOTH block paths — Enter and the send-button
  // click — or the fix would cover only one of them.
  const code = codeOnly(src);
  assert.equal((code.match(/if \(_fgIsBlocked && !WebBlockGateOk\(\)\) return false;/g) || []).length, 2,
    'both the key path and the mouse path must consult the host gate');
});

test('ClearFgBlocked clears the block DESCRIPTION, not just its identity', async () => {
  // _blockedReason is what ActivePatterns() returns while _fgIsBlocked is true,
  // and that string reaches the log and the audit record as `patterns`. Every
  // other field of the block was cleared here; this one was not, so a cleared
  // block's description outlived the block it described.
  //
  // It also closes a hook/poll race: the hook thread reads ActivePatterns() as
  // it swallows the key, and EmitBlock re-reads _fgIsBlocked a moment later to
  // decide whether this is a platform block. The poll thread can clear the flag
  // in between — which is why the bad line said "send" (platform false) while
  // still carrying a platform block's description. With the string cleared
  // alongside the flag, the worst that race can produce is an EMPTY patterns
  // field, never another surface's name.
  const src = await enforcerSrc();
  const fn = src.slice(src.indexOf('static void ClearFgBlocked()'),
                       src.indexOf('static string ExtractJsonString('));
  assert.ok(fn.length > 0, 'expected a ClearFgBlocked body');
  for (const field of [
    '_fgIsBlocked = false;',
    '_blockedByElement = false;',
    '_blockScope = "";',
    '_blockedPlatform = "";',
    '_blockedAgentName = "";',
    '_blockedAgentId = "";',
    '_blockedReason = "";',
    '_blockedBrowserHost = "";',
  ]) {
    assert.ok(fn.includes(field), `ClearFgBlocked must clear ${field}`);
  }
  // Every field ActivePatterns() can report must be cleared here, or a stale
  // description can outlive its block again.
  assert.match(src, /blockedNow = _fgIsBlocked;\s*\r?\n\s*return blockedNow \? _blockedReason/);
});

test('the block cooldown is scoped to the surface it fired on', async () => {
  // THE SECOND HALF OF THE SAME BUG. Fixing the agent latch to fail open was
  // necessary and not sufficient: blocking "IT Help Desk Agent" still killed
  // Enter in "stone Conversation Agent" twelve seconds later, and the block
  // reported no reason at all because it came from neither _fgIsBlocked nor
  // the latch.
  //
  // It came from this:
  //
  //     bool cooldown = (UtcNow.Ticks - _lastBlockFiredTicks) < BLOCK_COOLDOWN;
  //
  // Thirty seconds, no identity. EnterBlockActive ORs it in after
  // PanelEnforceOk, so for half a minute after ANY block, Enter died in every
  // agent on the host and in every other governed site in that browser.
  //
  // The cooldown covers one narrow race — the poll thread re-reads every 150ms,
  // so a user hammering Enter right after a block could slip a send through the
  // gap where the evidence has gone stale. That only ever applied to the
  // surface the block fired on, so the window is now keyed to it.
  const probe = (await scenario('cooldown_scope'))[0];
  assert.ok(probe, 'expected a cooldown_scope probe row');

  // Still armed where it fired — the protection survives the fix.
  assert.equal(probe.sameAgent, true, 'the cooldown must hold on the blocked agent');
  // THE REGRESSION: same host, same url, same tab; only the agent changed.
  assert.equal(probe.otherAgent, false,
    'a cooldown armed on one agent must not swallow Enter in another');
  // Not a one-way release: coming back re-enters the window.
  assert.equal(probe.backAgain, true, 'returning to the blocked agent re-enters the cooldown');
  // A different governed host in the same browser is a different surface.
  assert.equal(probe.otherHost, false, 'the cooldown must not cross hosts');
  // And it is still a WINDOW, not a latch.
  assert.equal(probe.expired, false, 'the cooldown must still expire');
});

test('a web-agent latch fails OPEN — the opposite direction to every other latch', async () => {
  // READ THIS BEFORE "FIXING" THE ASYMMETRY. The test directly above proves
  // WebBlockGateOk holds an armed block through an UNREADABLE host, and every
  // panel/agent latch in this file does the same: a read that failed is not
  // evidence the user left, so the block stands. That rule is right for those
  // latches and WRONG for this one, and the difference is what each latch
  // guards.
  //
  //   A panel or agent latch guards ONE APPLICATION. Holding through an
  //   unreadable tick costs a dead Enter in the app an admin already blocked.
  //
  //   A web-agent latch guards ONE AGENT on a host carrying dozens of them.
  //   Holding through an unreadable tick means "I cannot tell which agent this
  //   is, so block all of them" — the whole failure AI-218 exists to prevent.
  //
  // Observed live 2026-09-21: blocking "IT Help Desk Agent" on
  // m365.cloud.microsoft also killed Enter in "New Agent123" in the same tab.
  // The composer identified perfectly (Name "Message New Agent123", the
  // expected AutomationId) — the latch simply never released. And because
  // _fgIsBlocked had already cleared while PanelBlockLatchHeld() kept the
  // swallow armed, the block reported NO reason at all.
  const src = await enforcerSrc();
  const retire = src.slice(src.indexOf('// ---- AI-218: retire an AGENT latch on positive evidence'),
                           src.indexOf('// ---- BROWSER ---'));
  assert.ok(retire.length > 0, 'expected the agent-latch retirement block');

  // THE RULE, in one piece: hold ONLY on a positive re-identification of the
  // same agent. Anything else — a different agent, a generic chat, or a
  // composer that would not read — releases.
  assert.match(retire, /bool sameAgentStillOpen = webAgentOutcome == WEB_ID_NAMED\s*\r?\n\s*&& AgentNameMatches\(webAgentName, _blockedAgentName\);/);
  assert.match(retire, /if \(!sameAgentStillOpen\) ClearPanelBlockLatch\(\);/);

  // THE REGRESSION ITSELF. The shipped bug was a retirement condition that
  // treated NOT_COMPOSER as "no evidence, keep blocking". Any condition that
  // makes the unreadable outcome HOLD the latch reintroduces it.
  assert.equal(/webAgentOutcome != WEB_ID_NOT_COMPOSER/.test(retire), false,
    'treating an unreadable composer as grounds to HOLD a web-agent latch blocks every agent on the host');

  // The name must be carried to the decision, not re-derived from whatever the
  // last tick happened to leave behind — so it is a parameter of the tick.
  assert.match(src, /string webAgentName = ""\)/,
    'ApplyForegroundTick must receive the agent name this tick actually read');

  // And only a NAMED outcome can supply one, so the hold can never rest on a
  // name that leaked out of a generic or a failed read.
  const identityFn = src.slice(src.indexOf('static int WebComposerIdentity('),
                               src.indexOf('static WebSurface EnforcingWebSurface('));
  assert.match(identityFn, /agentName = remainder;\s*\r?\n\s*return WEB_ID_NAMED;/);
});

test('the FOCUSED composer read demands positive identity, exactly as the search does', async () => {
  // THE GAP THIS CLOSES. Everything the focused read tested was a REFUSAL —
  // not chrome, not a password, focusable, an Edit. Passing all of them cached
  // the element as THE COMPOSER, and that cache is the only door through which
  // any text in a browser is read. So on a governed host, any focused Edit that
  // was not one of those things had its contents scanned every tick: a site
  // search box ("Search chats") is exactly that shape.
  //
  // The background search has required an exact catalog-name match since it was
  // written, because a search has no evidence the element is the composer. The
  // focused read leaned on the caret as its evidence — but the caret only shows
  // the user is typing SOMEWHERE, not that they are typing in the composer.
  // Both paths now make the same demand.
  const src = await enforcerSrc();
  const readerFn = src.slice(src.indexOf('static bool ReadFocusedWebComposer('),
                             src.indexOf('// ---- Re-verify the cached composer'));
  assert.ok(readerFn.length > 0, 'expected a ReadFocusedWebComposer body');
  assert.match(readerFn, /WebSurface identity = MatchWebSurface\(host\);/);
  // Same shared decision as the search and the re-verify.
  assert.match(readerFn, /WebComposerIdentity\(identity, name, aid, out ignoredAgent\) == WEB_ID_NOT_COMPOSER/);
  // An UNPROBED surface has no opinion rather than refusing everything — the
  // same rule an empty SendButtonName follows. Without this carve-out, adding
  // a catalogued-but-unmeasured host would silently stop capture on it.
  assert.match(readerFn, /bool hasIdentity = WebSurfaceCanIdentifyComposer\(identity\);/);
  assert.match(readerFn, /if \(hasIdentity && WebComposerIdentity/);
  // The gate must sit AFTER the control-type test and BEFORE the cache write,
  // or an element could be cached before being identified.
  const gateIdx = readerFn.indexOf('WebSurface identity = MatchWebSurface(host);');
  const cacheIdx = readerFn.indexOf('_webComposerCached = el;');
  assert.ok(gateIdx > 0 && cacheIdx > gateIdx, 'identity must be checked before the element is cached');

  // An UNPROBED surface (no identity fields at all) keeps its previous
  // behaviour rather than being silently ungoverned — same discipline as
  // SendButtonName. That carve-out now lives in the shared rule, asserted in
  // the search test above.
  const shared = src.slice(src.indexOf('static bool WebSurfaceCanIdentifyComposer('),
                           src.indexOf('static WebSurface EnforcingWebAgentRead('));
  assert.match(shared, /if \(web == null\) return false;/,
    'a surface with no signature must have NO OPINION, never an opinion that allows');

  // And the same demand on the per-tick re-verify: a single-page app can RENAME
  // the composer in place when the user switches agents, and a cache filled
  // while the name matched must not keep being read once it stops matching.
  const verify = src.slice(src.indexOf('static AutomationElement VerifiedWebComposer('),
                           src.indexOf('static void SearchWebComposerBackground('));
  assert.match(verify, /WebSurface identity = MatchWebSurface\(host\);/);
  assert.match(verify, /\{ DropWebComposer\(\); return null; \}/);

  // All three read paths — focused, re-verify, search — now gate on the same
  // catalog field. If a fourth is ever added it must too.
  // Every path into the composer cache goes through the ONE identity function.
  const calls = (codeOnly(src).match(/WebComposerIdentity\(/g) || []).length;
  assert.ok(calls >= 4, 'focused read, re-verify, search and the definition must all be present');
});

test('AI-219: the URL yields ONE capture group, and the URL itself still dies', async () => {
  // THE PRIVACY QUESTION THIS FEATURE HAD TO ANSWER. This file's standing rule
  // is HOST ONLY, because a path is one field away from a query string and a
  // query string on an AI URL routinely contains the prompt itself. Gemini
  // Enterprise puts the agent id in the PATH and nowhere else — the composer is
  // [Group] Name='Search' for every agent — so the choice was "block the whole
  // host" or "read one thing out of the path".
  //
  // What makes the second acceptable is that a CAPTURE GROUP is extracted, not
  // a substring of the URL: a group the catalog defined as [0-9]+ cannot
  // contain a prompt, a customerId or a session id. The measured URL carries
  // both of the latter, which is exactly why this is asserted rather than
  // asserted-by-comment.
  const probe = (await scenario('gemini_enterprise'))[0];
  assert.ok(probe, 'expected a gemini_enterprise probe row');

  // The two agents measured live 2026-09-22, from the two URLs they came from.
  assert.equal(probe.idA, '18007293655158706549');
  assert.equal(probe.idB, '14428384541633907119');
  // Two different agents really did produce two different ids — if they had
  // not, none of this would identify anything.
  assert.notEqual(probe.idA, probe.idB);
  // And nothing else came out with them: no host, no /home/cid/<customerId>,
  // no session segment, no query string.
  for (const id of [probe.idA, probe.idB]) {
    assert.match(id, /^[0-9]+$/, 'only the capture group may survive');
    assert.equal(/vertexaisearch|cloud\.google|home|cid|session|hl=|\/|\?/.test(id), false,
      `a URL fragment escaped into the agent id: ${id}`);
  }
  // The same host with no agent in the path yields "", not a partial match.
  assert.equal(probe.idNone, '');
  // A surface that declares no pattern — every entry but this one — extracts
  // nothing at all, ever. That is what keeps the other four surfaces from
  // acquiring a URL reader as a side effect.
  assert.equal(probe.idNoPattern, '');

  // At the source: the extraction happens INSIDE GetCachedBrowserUrl, before
  // the line that documents `raw` going out of scope, and the only thing that
  // leaves is the capture group.
  const src = await enforcerSrc();
  const fn = src.slice(src.indexOf('static WebReadOutcome GetCachedBrowserUrl('),
                       src.indexOf('// ---- The window-title fingerprint'));
  assert.ok(fn.length > 0, 'expected a GetCachedBrowserUrl body');
  const extractIdx = fn.indexOf('AgentIdFromBrowserUrl(raw,');
  const deadIdx = fn.indexOf('// `raw` goes out of scope here and is never touched again.');
  assert.ok(extractIdx > 0 && deadIdx > extractIdx,
    'the id must be taken before raw dies, and raw must still die');
  // The function still returns a HOST and nothing else. If a future change
  // widens `out host` to a path or a URL, this fails.
  assert.equal(/out string url|out string path/.test(fn), false,
    'GetCachedBrowserUrl must never hand a URL or a path to a caller');

  // The id is retired everywhere the host is: a window change, an unreadable
  // tick past the TTL, and an app switch. A stale agent id is a block on the
  // wrong agent.
  const clears = (codeOnly(src).match(/_fgWebUrlAgentId = "";/g) || []).length;
  assert.ok(clears >= 3, `the agent id must be cleared with the host, found ${clears}`);
  assert.match(codeOnly(src), /static volatile string _fgWebUrlAgentId = "";/);

  // NOTHING EMITS IT AS A URL-SHAPED THING. It may travel only as an agent id,
  // which is what a blocked row already carries.
  const emit = src.slice(src.indexOf('static void EmitBlock('));
  assert.equal(emit.slice(0, emit.indexOf('\n    }')).includes('_fgWebUrlAgentId'), false,
    'the raw per-tick id must not be emitted directly; a block emits its own fields');
});

test('AI-219: a url_path surface identifies the composer structurally, and the agent from the URL', async () => {
  // Gemini Enterprise's composer is [Group] Name='Search' — the SAME string for
  // every agent — so AI-218's composer_name mechanism cannot work here. The two
  // questions WebComposerIdentity answers therefore come apart for the first
  // time: "is this the composer" is answered by the element, "which agent" by
  // the URL.
  const probe = (await scenario('gemini_enterprise'))[0];

  // The URL named an agent and the AutomationId matched: NAMED, carrying the id.
  assert.equal(probe.idNamed, true);
  assert.equal(probe.namedAgent, '18007293655158706549');

  // THE INVARIANT THAT MUST NOT BE WEAKENED. A wrong AutomationId is refused
  // even though the URL names an agent — "never accept an unidentified
  // element" outranks knowing which agent is open. Without this, any Group on
  // the page would be read as the composer while the URL happened to carry an
  // id.
  assert.equal(probe.wrongAid, true, 'a non-matching AutomationId must still be NOT_COMPOSER');

  // No agent in the URL -> GENERIC: a composer we are sure of, on a page that
  // named no agent. Never NAMED, and it carries no agent name out.
  assert.equal(probe.noAgent, true);
  assert.equal(probe.noAgentName, '');

  const src = await enforcerSrc();
  const identityFn = src.slice(src.indexOf('static int WebComposerIdentity('),
                               src.indexOf('static WebSurface EnforcingWebSurface('));
  // The url_path branch sits AFTER the AutomationId compare, which is what
  // makes the refusal above structural rather than incidental.
  const aidIdx = identityFn.indexOf('!string.Equals(automationId ?? "", wantAid, StringComparison.Ordinal)');
  const urlIdx = identityFn.indexOf('if (WebAgentReadIsUrlPath(web))');
  assert.ok(aidIdx > 0 && urlIdx > aidIdx, 'the AutomationId must be matched before the URL is consulted');
  // …and an empty AutomationId on such a surface is no identity at all.
  assert.match(identityFn, /if \(wantAid\.Length == 0\) return WEB_ID_NOT_COMPOSER;/);
  // An empty id is GENERIC, never NAMED: "we could not tell which agent" must
  // never be able to arm an agent block.
  assert.match(identityFn, /if \(urlId\.Length == 0\) return WEB_ID_GENERIC;/);

  // The mode gate is still a gate: EnforcingWebAgentRead accepts exactly the
  // two implemented modes and treats anything else as OFF, so a catalog typo
  // cannot silently pick a mechanism.
  const gate = src.slice(src.indexOf('static WebSurface EnforcingWebAgentRead('),
                         src.indexOf('// ---- AI-218: web composer identity'));
  assert.match(gate, /if \(!web\.AgentReadEnforce \|\| !web\.AgentReadVerified\) return null;/);
  assert.match(gate, /"composer_name"/);
  assert.match(gate, /&& !WebAgentReadIsUrlPath\(web\)\) return null;/);
});

test('AI-219: blocking ONE agent by id leaves the other agent in the same tab alone', async () => {
  // THE WHOLE FEATURE, and the failure it exists to prevent: on a host carrying
  // dozens of agents, "we cannot tell which one this is" must never become
  // "block all of them". AI-218 established that for Microsoft, where the
  // composer's Name carries the agent. Here the composer says 'Search' for
  // every agent, so identity comes from the URL — and the blocked row is
  // matched on its agent_id, not its agent_name.
  //
  // Driven through the REAL CheckFgBlocked with the REAL shipped catalog row
  // for this surface and the REAL Enter predicate.
  const probe = (await scenario('gemini_enterprise'))[0];

  // The blocked agent: blocked, agent-scoped (NOT "web" — one blocked agent is
  // not a blocked site, and the full-screen banner must stay off), and Enter is
  // swallowed.
  assert.equal(probe.blockedAgent.blocked, true, 'the blocked agent must be blocked');
  assert.equal(probe.blockedAgent.scope, 'agent');
  assert.equal(probe.blockedAgent.enter, true, 'Enter must be swallowed for the blocked agent');
  assert.equal(probe.blockedAgent.agentId, '18007293655158706549');
  assert.equal(probe.blockedAgent.reason, 'Blocked agent: Deal Desk Agent');

  // THE OTHER AGENT, same tab, same host, same composer, same AutomationId —
  // only the id in the URL differs. Nothing is blocked and Enter lives.
  assert.equal(probe.otherAgent.blocked, false, 'a different agent must not be blocked');
  assert.equal(probe.otherAgent.enter, false, 'Enter must live in an unblocked agent');

  // No agent in the URL (the surface's home page): nothing to block.
  assert.equal(probe.noAgentBlock.blocked, false);
  // A tick that could not identify the composer blocks nothing either — the
  // same rule AI-218 set, unchanged.
  assert.equal(probe.notComposer.blocked, false);

  // A NAME-ONLY row cannot reach this surface. There is no display name on the
  // page to match, and an id is not derivable from one — so an admin who
  // blocks "Deal Desk Agent" without an id gets NO block rather than a block on
  // a guess. Recorded because it is a real gap, not an accident.
  assert.equal(probe.nameOnlyRow.blocked, false,
    'a row with no agent_id must block nothing on a url_path surface');

  // THE FORM THE DASHBOARD ACTUALLY SENDS. connect-ui's DiscoveryTab blocks
  // with agent.id, and for Gemini Enterprise that is the Discovery Engine
  // RESOURCE NAME the API returned — projects/.../agents/<id> — while the URL
  // carries only its last segment. An exact compare alone would therefore match
  // nothing and this feature would be a silent no-op that looks armed.
  assert.equal(probe.resName.blocked, true,
    'a blocked row carrying the full resource name must still reach the agent');
  assert.equal(probe.resName.scope, 'agent');
  // …and it is still the RIGHT agent. Same engine, same assistant, different id.
  assert.equal(probe.resNameOther.blocked, false,
    'the tail compare must not match a different agent under the same assistant');
  assert.equal(probe.resNameB.blocked, false);
  // THE SUBSTRING TRAP, asserted rather than argued: a row whose id merely ENDS
  // WITH the digits, with no '/agents/' separator, is exactly what a Contains()
  // or a naive EndsWith would wrongly accept.
  assert.equal(probe.suffixOnly.blocked, false,
    'the id compare must be whole-segment, never a substring or a bare suffix');

  // At the source: ONE function decides which field identifies the agent, and
  // both the arm and the latch retirement use it, so they cannot disagree.
  const src = await enforcerSrc();
  const matcher = src.slice(src.indexOf('static bool WebAgentRowMatches('),
                            src.indexOf('// ---- AI-219: is this surface\'s agent identity in the URL PATH?'));
  assert.ok(matcher.length > 0, 'expected a WebAgentRowMatches body');
  // ORDINAL EXACT on the id. An id is an opaque token: case-folding, trimming
  // or prefix-matching it would all be guesses, and two ids differing only in
  // case are two different agents.
  assert.match(matcher, /if \(string\.Equals\(have, want, StringComparison\.Ordinal\)\) return true;/);
  // The resource-name form is a WHOLE-SEGMENT tail compare anchored on a
  // literal separator, done with CompareOrdinal rather than Contains/EndsWith
  // so that "ends with these digits" can never satisfy it.
  assert.match(matcher, /const string AGENT_SEG = "\/agents\/";/);
  assert.equal(/\.Contains\(|\.EndsWith\(/.test(matcher), false,
    'the agent-id compare must not be a substring or a bare suffix test');
  assert.match(matcher, /if \(want\.Length == 0 \|\| have\.Length == 0\) return false;/);
  // A composer_name surface keeps the whole-string NAME rule, untouched.
  assert.match(matcher, /return AgentNameMatches\(evidenceName, rowAgentName\);/);
  // The arm still requires every AI-218 term as well: agent scope, both agent
  // read flags, a POSITIVELY NAMED tick, and the host claiming the platform.
  const arm = src.slice(src.indexOf('bool agentRow = string.Equals(agent["agent_scope"]'));
  const armBody = arm.slice(0, arm.indexOf(';') + 1);
  assert.match(armBody, /EnforcingWebAgentRead\(web\) != null/);
  assert.match(armBody, /_fgWebAgentOutcome == WEB_ID_NAMED/);
  assert.match(armBody, /WebSurfaceClaimsPlatform\(web, agent\["platform"\]\)/);
  assert.match(armBody, /WebAgentRowMatches\(web, _fgWebAgentName, _fgWebUrlAgentId,\s*\r?\n\s*agent\["agent_name"\], agent\["agent_id"\]\)/);
});

test('AI-219: the composer control type is data, and its default preserves every older surface', async () => {
  // Every surface before Gemini Enterprise was an [Edit], and that was a
  // literal in three places: the background search's FindAll condition, the
  // focused read's control-type test and the per-tick re-verify's. Gemini
  // Enterprise's composer is a [Group], so the type had to become catalog data
  // — and the risk of that change is entirely in the DEFAULT. If "absent"
  // stopped meaning "Edit", four armed surfaces would silently stop matching
  // their own composers.
  const probe = (await scenario('gemini_enterprise'))[0];
  assert.equal(probe.ctGemEnt, 'Group', 'the measured type must reach the read paths');
  assert.equal(probe.ctClaude, 'Edit', 'a surface that declares nothing must still be an Edit');
  assert.equal(probe.ctUnknown, 'Edit', 'an unknown host must default, not refuse-by-emptiness');

  // ONE mapper for both catalog control types. A second copy would be a second
  // place for a type to be missing from, and a missing entry fails silently.
  assert.equal(probe.ctGroup, true, 'Group must map to a condition');
  assert.equal(probe.ctEdit, true, 'Edit must map to a condition');
  // FAIL CLOSED on a typo: no condition, therefore no search, rather than a
  // walk over every control in the window.
  assert.equal(probe.ctJunk, true, 'an unrecognised control type must yield no condition');

  const src = await enforcerSrc();
  const code = codeOnly(src);
  // The literal is gone from all three read paths.
  // The literal survives in exactly one place -- the control-type MAPPER,
  // where "Edit" is one of the types it maps rather than a demand it makes.
  assert.equal(/!string\.Equals\(ctName, "Edit", StringComparison\.OrdinalIgnoreCase\)/.test(code), false,
    'a hard-coded "Edit" composer test is back — a Group composer would never match');
  assert.equal((code.match(/WebComposerControlType\(host\)/g) || []).length, 2,
    'the focused read and the re-verify must make the same demand');
  // The search condition comes from the same catalog field, and an unmappable
  // type stops the search rather than widening it.
  const search = src.slice(src.indexOf('static void SearchWebComposerBackground('),
                           src.indexOf('static void MaybeSearchWebComposer('));
  assert.match(search, /Condition cond = WebControlTypeCondition\(surfaceForSearch\.ComposerControlType\);/);
  assert.match(search, /if \(cond == null\) return;/);
  // …and the kick refuses it too, so an unmappable type cannot spin a thread
  // once a second forever.
  const kick = src.slice(src.indexOf('static void MaybeSearchWebComposer('),
                         src.indexOf('static void DropWebComposer('));
  assert.match(kick, /if \(WebControlTypeCondition\(web\.ComposerControlType\) == null\) return;/);
  // The default is a named constant on both sides, held in lockstep.
  assert.match(code, /const string WEB_COMPOSER_CONTROL_TYPE_DEFAULT = "Edit";/);
  const js = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'ai-processes.js'), 'utf8');
  assert.match(js, /export const DEFAULT_COMPOSER_CONTROL_TYPE = 'Edit';/);
});

test('AI-219: the composer is TWO elements — identity on the parent, caret in the child', async () => {
  // THE LIVE FAILURE THIS FIXES. The first build shipped and did nothing: the
  // prompt sent, no block, not one BLOCKED line in the log. Re-probed live
  // 2026-09-22 with the composer empty:
  //
  //   [Group] Name='Search' AutomationId='agent-search-prosemirror-editor'
  //           ClassName='prosemirror-editor   '  IsKeyboardFocusable=FALSE
  //   [Group] Name=''       AutomationId=''      ClassName='ProseMirror'
  //           IsKeyboardFocusable=TRUE  patterns=Text
  //
  // The element carrying the identity CANNOT TAKE THE CARET and the one that
  // can carries NO identity, so no element could satisfy both the exact
  // AutomationId test and `if (!focusable) return false`. Nothing was ever
  // cached, _fgIsWebComposer stayed false, PanelEnforceOk() answered false for
  // the browser, and EnterBlockActive short-circuited.
  const probe = (await scenario('gemini_enterprise_child'))[0];
  assert.ok(probe, 'expected a gemini_enterprise_child probe row');

  // ── half one: the class rule, on the MEASURED strings ──────────────────
  assert.equal(probe.roleChild, true, "the focusable child ('ProseMirror') must be a candidate");
  // The IDENTIFIED PARENT must be refused. It is the element that cannot be
  // typed into — accepting it is the bug that shipped — and its measured class
  // carries the site's own trailing spaces, so only the READ value is trimmed.
  assert.equal(probe.roleParent, true, "the non-focusable parent ('prosemirror-editor   ') must be refused");
  // THE SPELLING THE ENFORCER ACTUALLY SEES. ProseMirror appends its focus
  // class, and this path runs ONLY on the focused element, so the live value is
  // 'ProseMirror ProseMirror-focused'. The first build compared the whole
  // string against the UNFOCUSED spelling a probe had captured from outside the
  // page, refused every real composer, and shipped blocking nothing. This case
  // is the one that would have caught it.
  assert.equal(probe.roleFocused, true,
    "the FOCUSED spelling 'ProseMirror ProseMirror-focused' must be a candidate");
  // Tokens are compared WHOLE: a prefix must not satisfy the rule, or
  // 'ProseMirror-focused' alone would pass as 'ProseMirror'.
  assert.equal(probe.rolePrefixOnly, true, "a prefix ('ProseMirror-focused') must be refused");
  // AND THE LIMIT OF THIS HALF, stated plainly rather than implied: ClassName is
  // a class LIST, so claude.ai's 'tiptap ProseMirror' DOES yield a token hit
  // here. The class was never the protection. What separates them is the anchor
  // AutomationId on the parent (asserted below) and the fact that a surface
  // declaring no descent is NOT_APPLICABLE entirely (asserted above) — claude.ai
  // never reaches this rule at all.
  assert.equal(probe.roleClaudeCls, true,
    "a shared class token is expected — the anchor, not the class, is what refuses");
  assert.equal(probe.roleEmpty, true, 'an unreadable ClassName must refuse, never pass');
  // And a surface that declares NO descent is NOT APPLICABLE for any class —
  // the line all four pre-AI-219 surfaces take, which is what makes this change
  // invisible to them.
  assert.equal(probe.roleClaudeSurface, true, 'a surface with no descent must be unaffected');
  assert.equal(probe.roleClaudeOwn, true, 'a surface with no descent must be unaffected by its own class too');

  // ── half two: the ANCHOR, walked on a REAL UIA parent/child pair ───────
  assert.equal(probe.probeOk, true, 'expected a real parent/child element pair to have been built');
  // The walk found the anchor and returned it, so the child identifies.
  assert.ok(probe.anchorHit.length > 0, 'the ancestor walk must resolve the anchor AutomationId');
  // THE REGRESSION ASKED FOR: same child, same ClassName, but the catalog
  // anchors on a DIFFERENT AutomationId. Refused — matching the child class
  // alone is never enough, which is the "never accept an unidentified element"
  // rule this design exists to protect.
  assert.equal(probe.anchorWrongParent, '',
    'a ProseMirror child whose parent has the WRONG AutomationId must be refused');
  // …and the mirror image: the right anchor, the wrong child class.
  assert.equal(probe.anchorWrongClass, '', 'a class mismatch must be refused before any walk');
  // A surface with no descent gets its element's OWN id back, untouched. This
  // is the pass-through that keeps the other four surfaces byte-identical.
  assert.equal(probe.passthrough, 'its-own-id', 'a non-descent surface must be passed through unchanged');

  // ── end to end through the real identity function ──────────────────────
  // The child's MEASURED Name is EMPTY, which the shipped code refused outright
  // before the empty-name test was moved below the structural gates.
  assert.equal(probe.childIdentityNamed, true,
    'the focusable child, anchored, with an agent in the URL, must read as NAMED');
  assert.equal(probe.wrongParentRefused, true,
    'the same child under the wrong anchor must read as NOT_COMPOSER');

  // ── source invariants ──────────────────────────────────────────────────
  const src = await enforcerSrc();
  const code = codeOnly(src);
  // ONE entry point, used by ALL FOUR paths that identify a composer: the
  // focused read, the per-tick re-verify, the background search and the agent
  // read. A search laxer than a focused read is the bug class this file has
  // already had to fix once.
  assert.equal((code.match(/WebComposerIdentityAid\(/g) || []).length, 5,
    'the definition plus all four identification paths must go through one function');
  const entry = src.slice(src.indexOf('static string WebComposerIdentityAid('),
                          src.indexOf('static int WebComposerIdentity('));
  assert.match(entry, /if \(role == WEB_CHILD_NOT_APPLICABLE\) return own;/,
    'a surface with no descent must get its own id back, unchanged');
  assert.match(entry, /if \(role == WEB_CHILD_REFUSED\) return "";/,
    'a refused element must carry NO id, so the identity test rejects it');

  // The class compare is ORDINAL and WHOLE-TOKEN. ClassName is a CSS class
  // LIST — live, focused, this surface reports 'ProseMirror ProseMirror-focused'
  // — so the rule splits on whitespace and compares each token whole.
  const role = src.slice(src.indexOf('static int WebComposerChildRole('),
                         src.indexOf('// HOW FAR UP, and why a BOUND'));
  assert.match(role, /cls\.Split\(\(char\[\]\)null, StringSplitOptions\.RemoveEmptyEntries\)/,
    'the class list must be split on whitespace, not compared whole-string');
  assert.match(role, /string\.Equals\(tok, want, StringComparison\.Ordinal\)/,
    'each token must be compared ORDINALLY and whole');
  assert.match(role, /if \(!tokenHit\) return WEB_CHILD_REFUSED;/);
  // STILL never a substring test. Whole-string was wrong (it refused the live
  // focused spelling and shipped a no-op), but a substring would be WORSE:
  // 'ProseMirror-focused' would satisfy a want of 'ProseMirror'. Token equality
  // is the only form that is both correct and safe.
  assert.equal(/\.Contains\(|StartsWith\(|EndsWith\(|IndexOf\(/.test(role), false,
    'the child-class test must compare whole tokens, never a substring');
  // A descent with no anchor is not an identity at all.
  assert.match(role, /if \(\(web\.ComposerAutomationId \?\? ""\)\.Length == 0\) return WEB_CHILD_REFUSED;/);

  // The ancestor search is BOUNDED. An unbounded walk reaches the document,
  // where any AutomationId could be found.
  assert.match(code, /const int WEB_COMPOSER_ANCHOR_MAX_HOPS = 2;/);
  const anchor = src.slice(src.indexOf('static string WebComposerAnchorAid('),
                           src.indexOf('// THE ONE ENTRY POINT'));
  assert.match(anchor, /for \(int i = 0; i < WEB_COMPOSER_ANCHOR_MAX_HOPS; i\+\+\)/);
  // Every candidate ancestor is still matched EXACTLY and ORDINALLY. Widening
  // the search for the anchor is not the same as weakening the anchor.
  assert.equal((anchor.match(/string\.Equals\(paid, wantAid, StringComparison\.Ordinal\)/g) || []).length, 2,
    'both the ControlView and the Raw candidate must be matched ordinally');
  assert.equal(/StartsWith|Contains|IgnoreCase/.test(anchor), false,
    'the anchor compare must never be loosened');

  // THE EMPTY-NAME REFUSAL moved below the structural gates rather than being
  // deleted — the name routes still require a name.
  const identityFn = src.slice(src.indexOf('static int WebComposerIdentity('),
                               src.indexOf('static WebSurface EnforcingWebSurface('));
  const urlIdx = identityFn.indexOf('if (WebAgentReadIsUrlPath(web))');
  const emptyIdx = identityFn.indexOf('if (nm.Length == 0) return WEB_ID_NOT_COMPOSER;');
  assert.ok(urlIdx > 0 && emptyIdx > urlIdx,
    'the empty-name refusal must sit below the url_path branch, or the child is refused outright');
  assert.ok(identityFn.indexOf('foreach (string prefix in web.ComposerNamePrefixes)') > emptyIdx,
    'the prefix route must still require a non-empty name');

  // READING THE CHILD. It exposes TextPattern and NO ValuePattern, so the
  // composer read has to fall back — ReadText already does, unconditionally and
  // for whatever element is cached, and it is the ONLY door to the composer's
  // text in a browser.
  assert.match(code, /AutomationElement el = ForegroundIsBrowser\(\)\s*\r?\n?\s*\? CachedWebComposer\(\)/,
    'a browser must read its cached composer and nothing else');
  const readText = src.slice(src.indexOf('static string ReadText(AutomationElement el)'),
                             src.indexOf('static string ReadClipboard()'));
  const vpIdx = readText.indexOf('ValuePattern.Pattern');
  const tpIdx = readText.indexOf('TextPattern.Pattern');
  assert.ok(vpIdx > 0 && tpIdx > vpIdx, 'ValuePattern stays preferred, TextPattern is the fallback');
  assert.match(readText, /\(\(TextPattern\)tp\)\.DocumentRange\.GetText\(/);
  // An element with NEITHER pattern still yields nothing — never a guess.
  assert.match(readText, /return null;\s*\r?\n\s*\}/);

  // The hook is untouched by any of this: no new field, no UIA, no allocation.
  const hook = src.slice(src.indexOf('static IntPtr HookCallback('), src.indexOf('// Scans the typed buffer'));
  for (const forbidden of ['WebComposerIdentityAid', 'WebComposerAnchorAid', 'WebComposerChildRole',
                           'TreeWalker', '_fgWebUrlAgentId']) {
    assert.equal(hook.includes(forbidden), false, `the hook must not reach ${forbidden}`);
  }
});


test('AI: a hostApp web surface is blocked at the COMPOSER, never at the host', async () => {
  // THE RISK THIS CLOSES. Every arm in CheckFgBlocked sets _blockedByElement,
  // and EnterBlockActive's `_blockedByElement || PanelEnforceOk()` then holds
  // the block through a tick whose focused-element read landed elsewhere. On
  // claude.ai that is correct: the whole site IS the AI tool, and a flickering
  // read must not let a blocked Enter through.
  //
  // On mail.google.com the SAME term would swallow Enter ANYWHERE in the
  // window -- replying, sending, the search box. Blocking "Gemini in Gmail"
  // would stop the user sending email. That is not a governance outcome
  // anybody asked for, and it is the reason hostApp exists.
  const src = await enforcerSrc();

  // The guard must run BEFORE the _blockedByElement term or it cannot override
  // it. Order IS the mechanism here, so it is asserted rather than assumed.
  const fn = src.slice(src.indexOf('static bool EnterBlockActive('),
                       src.indexOf('static string ActivePatterns()'));
  assert.ok(fn.length > 0, 'expected an EnterBlockActive body');
  const guardAt = fn.indexOf('WebBlockIsComposerScoped() && !_fgIsWebComposer');
  const elemAt = fn.indexOf('_blockedByElement || PanelEnforceOk()');
  assert.ok(guardAt > 0, 'the composer-scoping guard must exist');
  assert.ok(guardAt < elemAt,
    'the guard must precede the _blockedByElement term, or it cannot scope it down');

  // It reads the host the block was ARMED FOR, never the current foreground: a
  // tab switch must not change the answer for an already-armed block.
  const helper = src.slice(src.indexOf('static bool WebBlockIsComposerScoped()'),
                           src.indexOf('static bool EnterBlockActive('));
  assert.match(helper, /_blockedBrowserHost/);
  assert.equal(/_fgWebHost/.test(helper), false,
    'scoping must follow the ARMED host, not wherever the user happens to be now');

  // And the catalog decides which surfaces this applies to.
  const { WEB_SURFACES } = await import('../src/os_monitor/ai-processes.js');
  const hostApps = WEB_SURFACES.filter((s) => s.hostApp).map((s) => s.host);
  assert.deepEqual(hostApps, ['mail.google.com', 'docs.google.com', 'outlook.office.com', 'sharepoint.com'],
    'the general-purpose apps with an AI panel. Adding a host here NARROWS its '
    + 'block scope to the AI composer; MISSING one would silently widen a block '
    + 'to a whole application -- blocking Gemini would stop the user sending '
    + 'email or editing a document.');
  // A dedicated AI host must NOT be hostApp: narrowing claude.ai to its composer
  // would let a blocked user send from some other element on the page.
  const generalPurpose = new Set(['mail.google.com', 'docs.google.com', 'sharepoint.com', 'outlook.office.com']);
  for (const s of WEB_SURFACES) {
    if (generalPurpose.has(s.host)) continue;
    assert.notEqual(s.hostApp, true, s.host + ' is a dedicated AI tool, not a host app');
  }
});

test('AI: capture reads the composer CONTROL TYPE from the catalog', async () => {
  // It was hard-coded to Edit, which silently excluded every surface whose
  // composer is not one -- Gemini Enterprise's is a Group, the Gemini panel in
  // Gmail is a ComboBox. Those surfaces could BLOCK but never produce a DLP
  // record, so "every feature works here" was quietly false.
  const { readFile } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  const { dirname, join } = await import('node:path');
  const here = dirname(fileURLToPath(import.meta.url));
  const pw = await readFile(join(here, '..', 'src', 'os_monitor', 'prompt-watcher.ps1'), 'utf8');
  const at = pw.indexOf('function Is-BrowserComposerElement');
  assert.ok(at > 0, 'expected Is-BrowserComposerElement');
  // The function grew when it learned the other two identity shapes; slice
  // generously rather than pinning a length that silently truncates the
  // assertions below into vacuity.
  const fn = pw.slice(at, at + 9000);
  assert.ok(fn.includes('$surface.composerControlType'),
    'the control type must come from the catalog, not be hard-coded');
  assert.ok(fn.includes('default    { return $false }'),
    'an unrecognised control type must REFUSE, never fall back to "any type"');
  // Capture must know ALL THREE identity shapes the enforcer allows, or the two
  // disagree about what "the composer" is -- which is how m365.cloud.microsoft
  // and Office web ended up blockable but never captured: their composerName is
  // deliberately empty and they identify by AutomationId.
  assert.ok(fn.includes('$surface.composerAutomationId'),
    'capture must know the AutomationId shape');
  assert.ok(fn.includes('$surface.composerNamePrefixes'),
    'capture must know the name-prefix shape');
  // And the fail direction is unchanged: no name AND no AutomationId refuses.
  assert.ok(fn.includes('if (-not $wantAid) { return $false }'),
    'a surface identifying nothing must still get no capture');
});

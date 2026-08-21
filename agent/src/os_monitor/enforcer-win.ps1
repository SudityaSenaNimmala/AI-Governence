# Desktop send-blocker (Windows).
#
# Actually BLOCKS a sensitive prompt from being sent in a vendor-sealed AI
# desktop app (Claude Desktop, ChatGPT Desktop, Gemini, ...) — the apps we
# cannot block any other way because they pin TLS (proxy is blind) and enforce
# ASAR integrity (DOM hook bricks them).
#
# Mechanism (no app modification, no network):
#   - A low-level keyboard hook (WH_KEYBOARD_LL) sees every keystroke.
#   - TYPED secrets: the hook reconstructs the text being typed into the focused
#     AI app from the keystrokes themselves (a per-app buffer) and scans it on
#     every key. This does NOT depend on UI Automation — Chromium/Electron apps
#     like Claude/ChatGPT don't reliably expose their composer text to UIA, so
#     reading the box was unreliable; reading the keys is not.
#   - PASTED secrets: a background poller reads the clipboard; if it holds a
#     blocked pattern while an AI app is focused, Ctrl+V is swallowed.
#   - When the user presses Enter (no Shift) while the typed buffer (or, as a
#     bonus, a UIA read) contains a high/critical pattern, the hook SWALLOWS the
#     Enter — the app never receives it, so the prompt is not sent.
#   - Override: Ctrl+Alt+Enter sends anyway (logged as an override).
#   - Panic hotkey: Ctrl+Alt+Shift+F12 disarms ALL blocking for 10 minutes.
#
# Tier B — mask and auto-send (Ctrl+Alt+T, or the block dialog's Tokenize &
# Send button over stdin):
#   While a block is active, the poll thread continuously reads the ACTUAL
#   composer text via UIA (never the lossy keystroke buffer — see
#   ComputeMaskCandidate/UpdatePendingRewrite) and pins a masked candidate
#   {block_id, original, masked, RuntimeId, HWND, PID}, valid for 15s.
#   Confirming (hotkey or dialog click) re-verifies every pinned fact still
#   holds, then synthesizes Ctrl+A, Delete, and the masked text via SendInput.
#   Once the read-back positively confirms the composer holds exactly that
#   masked text and nothing else, it sends Enter too — an explicit, twice-
#   confirmed user decision, not the original design (which stopped short of
#   sending and left that to the user). A second read-back after Enter
#   confirms the composer actually cleared before reporting success; if it
#   didn't, that's reported as a failure rather than a false "sent". Any
#   mismatch at any step (focus changed, element changed, text changed, a
#   real keystroke/click arrived mid-write, the read-back doesn't exactly
#   match) aborts with the block still armed — never a partial, silent write.
#   This is the only way this process ever writes into another app; there is
#   no general "type this text" entry point anywhere in this file.
#
# Safety properties (do not regress these):
#   - NO regex ever runs on the keyboard-hook thread. The hook only classifies
#     the key and sets a dirty flag; the poll thread does the scanning.
#   - Every rule has a 25ms match timeout, and a rule that times out is skipped
#     individually (fail open for that rule, not for the whole scan).
#   - Deadman: if the Node parent stops writing its heartbeat file for 30s the
#     helper unhooks itself and exits, so a hung parent can't leave a system
#     wide keyboard hook installed.
#   - Tier B rewrite: reachable ONLY via a pinned block_id (single-use, 15s
#     TTL, bound to the exact element/window/text it was computed from); the
#     only string it can ever type is the masked transform of text it read
#     itself, never new content and never the original secret.
#
# Emits NDJSON on stdout for the Node orchestrator:
#   {"kind":"ready"}
#   {"kind":"block","reason":"send"|"paste"|"click"|"attachment","process":"claude","patterns":"aws-access-key","block_id":"...","rewritable":true,"preview":"[AWS-KEY]"}
#   {"kind":"block","reason":"attachment","filename":"payroll.xlsx",...} — a sensitive file is attached; never rewritable (Tokenize & Send masks text, not files)
#   {"kind":"override","process":"claude","patterns":"..."}
#   {"kind":"rewrite","block_id":"...","result":"ok"|"aborted"|"failed","reason":"..."}
#   {"kind":"enforcement_disarmed","reason":"panic_hotkey","seconds":600}
#   {"kind":"error","message":"..."}
#
# Limitations (told to the user): blocks Enter-to-send and Ctrl+V; clicking the
# send button with the mouse is not swallowed. The typed buffer is a best-effort
# reconstruction (mouse-editing mid-string can desync) but errs toward catching
# the secret. Charset covers the secret patterns (A-Za-z0-9 _ - . /). Tier B
# rewrite only offers itself for single-line, non-IDE, maskable text under 2000
# chars — anything else stays block-only with no Ctrl+Alt+T offer at all.

$ErrorActionPreference = 'Stop'
$ProgressPreference    = 'SilentlyContinue'
$WarningPreference     = 'SilentlyContinue'

$aiProcs = if ($env:CFAI_AI_PROCESSES) { $env:CFAI_AI_PROCESSES } else { 'ChatGPT,Claude,Cursor,Copilot,M365Copilot,Comet,Gemini,Poe' }
# CFAI_BLOCK_PATTERNS is a JSON array of {name, source, severity, label}.
# Parse to parallel arrays we can hand to the C# enforcer. `label` is empty
# for guardrail patterns (nothing to mask) — see classifier.js's REDACT_LABELS.
$patNames   = New-Object System.Collections.ArrayList
$patSources = New-Object System.Collections.ArrayList
$patSevs    = New-Object System.Collections.ArrayList
$patLabels  = New-Object System.Collections.ArrayList
if ($env:CFAI_BLOCK_PATTERNS) {
    try {
        $parsed = $env:CFAI_BLOCK_PATTERNS | ConvertFrom-Json
        foreach ($p in $parsed) {
            [void]$patNames.Add([string]$p.name)
            [void]$patSources.Add([string]$p.source)
            [void]$patSevs.Add([string]$p.severity)
            [void]$patLabels.Add([string]$p.label)
        }
    } catch {}
}
# Deadman heartbeat file — the Node monitor rewrites it every 5s while alive.
# Empty (env var unset) disables the deadman, which is what you want when
# running this script by hand for debugging with no parent to watch.
$hbPath = if ($env:CFAI_ENFORCER_HEARTBEAT) { $env:CFAI_ENFORCER_HEARTBEAT } else { '' }

# Model routing (desktop) — off by default. CFAI_MODEL_ROUTER_CONFIG is the
# JSON payload agent/src/os_monitor/model-router-config.js builds (lexicon +
# thresholds extracted from the browser extension's complexity.js, plus tier-
# detection rules ported from content.js) — passed through UNPARSED here and
# deserialized on the C# side via JavaScriptSerializer, unlike
# CFAI_BLOCK_PATTERNS above: that payload is a flat list the PowerShell layer
# flattens into parallel arrays, but this one nests categories inside
# categories, and re-flattening a nested shape by hand here would just move
# the parsing problem rather than solve it.
$modelRouterEnabled = ($env:CFAI_MODEL_ROUTER_ENABLED -eq 'true')
$mrConfigJson = if ($modelRouterEnabled -and $env:CFAI_MODEL_ROUTER_CONFIG) { $env:CFAI_MODEL_ROUTER_CONFIG } else { '' }

$source = @'
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Collections;
using System.Collections.Generic;
using System.Windows.Automation;
using System.Web.Script.Serialization;

public static class CfaiEnforcer
{
    delegate IntPtr LowLevelKeyboardProc(int nCode, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll", SetLastError = true)]
    static extern IntPtr SetWindowsHookEx(int idHook, LowLevelKeyboardProc lpfn, IntPtr hMod, uint dwThreadId);
    [DllImport("user32.dll", SetLastError = true)]
    static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll", SetLastError = true)]
    static extern bool UnhookWindowsHookEx(IntPtr hhk);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Auto)]
    static extern IntPtr GetModuleHandle(string lpModuleName);
    [DllImport("user32.dll")]
    static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")]
    static extern bool SetCursorPos(int x, int y);
    [StructLayout(LayoutKind.Sequential)]
    struct POINT { public int X; public int Y; }
    [DllImport("user32.dll")]
    static extern bool GetCursorPos(out POINT lpPoint);
    [DllImport("user32.dll", SetLastError = true)]
    static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
    [DllImport("user32.dll")]
    static extern short GetAsyncKeyState(int vKey);
    [DllImport("user32.dll")]
    static extern short GetKeyState(int nVirtKey);
    [DllImport("user32.dll")]
    static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
    [StructLayout(LayoutKind.Sequential)]
    struct RECT { public int Left, Top, Right, Bottom; }

    [StructLayout(LayoutKind.Sequential)]
    struct MSG { public IntPtr hwnd; public uint message; public IntPtr wParam; public IntPtr lParam; public uint time; public int x; public int y; }
    [DllImport("user32.dll")]
    static extern int GetMessage(out MSG lpMsg, IntPtr hWnd, uint wMsgFilterMin, uint wMsgFilterMax);
    [DllImport("user32.dll")]
    static extern bool SetProcessDPIAware();

    // ── Synthetic input (Tier B: mask-and-rewrite, auto-send after verify) ───
    // The ONLY writer this process has into another app's composer. Reachable
    // only via StartRewrite(), which requires a pinned block_id minted by the
    // poll thread's UpdatePendingRewrite() — never a general "type anything"
    // primitive. See RunRewrite() for the full pre-flight/abort/verify story.
    [StructLayout(LayoutKind.Sequential)]
    struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
    // Real Windows INPUT is a union of MOUSEINPUT/KEYBDINPUT/HARDWAREINPUT —
    // its size is fixed by the LARGEST member (MOUSEINPUT), 40 bytes on x64,
    // even though only the KEYBDINPUT arm is ever populated here. Confirmed
    // live: without the explicit Size, this struct naturally sizes to only 32
    // bytes (just enough for KEYBDINPUT), so both Marshal.SizeOf and the
    // array's own element stride were 8 bytes short of what SendInput
    // validates against — every call was silently rejected, with no visible
    // error since the return value wasn't being checked either.
    [StructLayout(LayoutKind.Explicit, Size = 40)]
    struct INPUT { [FieldOffset(0)] public int type; [FieldOffset(8)] public KEYBDINPUT ki; }
    [DllImport("user32.dll", SetLastError = true)]
    static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

    const int WH_KEYBOARD_LL = 13;
    const int WH_MOUSE_LL = 14;
    const int WM_KEYDOWN = 0x0100;
    const int WM_SYSKEYDOWN = 0x0104;
    const int WM_MOUSEMOVE = 0x0200;
    const int WM_LBUTTONDOWN = 0x0201;
    const int WM_LBUTTONUP = 0x0202;
    const int VK_BACK = 0x08;
    const int VK_RETURN = 0x0D;
    const int VK_SHIFT = 0x10;
    const int VK_CONTROL = 0x11;
    const int VK_MENU = 0x12;     // Alt
    const int VK_CAPITAL = 0x14;
    const int VK_ESCAPE = 0x1B;
    const int VK_DELETE = 0x2E;
    const int VK_A = 0x41;
    const int VK_T = 0x54;
    const int VK_V = 0x56;
    const int VK_F12 = 0x7B;

    // KBDLLHOOKSTRUCT.flags is at byte offset 8 ({vkCode,scanCode,flags,...}),
    // MSLLHOOKSTRUCT.flags is at offset 12 ({pt(8),mouseData,flags,...}).
    // Used only to tell our own synthetic input apart from the user's during a
    // rewrite — never as an authorization signal (both flags are spoofable by
    // any process; they gate an abort, not a permission).
    const uint LLKHF_INJECTED = 0x10;
    const uint LLMHF_INJECTED = 0x1;

    const int INPUT_KEYBOARD = 1;
    const uint KEYEVENTF_KEYUP = 0x0002;
    const uint KEYEVENTF_UNICODE = 0x0004;

    // Rewrite tuning. Chunked typing + a foreground re-check between chunks
    // bounds how much masked text could land in a wrongly-focused window if
    // focus changes mid-write; a hard total time budget bounds a runaway
    // write. See RunRewrite().
    const int REWRITE_MAX_CHARS = 2000;
    const int REWRITE_CHUNK = 24;
    static readonly long REWRITE_TTL = TimeSpan.FromSeconds(15).Ticks;
    // Sized for the worst case now that SendUnicodeChunk paces individual
    // characters (4ms apart) instead of bursting a whole chunk at once:
    // REWRITE_MAX_CHARS(2000) * 4ms = 8s, plus margin. Still comfortably
    // inside REWRITE_TTL (15s) alongside the verify (<=400ms) and settle
    // (150ms) delays that follow.
    static readonly long REWRITE_WRITE_BUDGET = TimeSpan.FromSeconds(9).Ticks;

    static IntPtr _hook = IntPtr.Zero;
    static IntPtr _mouseHook = IntPtr.Zero;
    static LowLevelKeyboardProc _proc = HookCallback;        // keep alive (no GC)
    static LowLevelKeyboardProc _mouseProc = MouseCallback;  // keep alive (no GC)

    // Send-button screen rectangle — located by the STA poll thread (via UIA)
    // while a block is active, read by the mouse hook. Caching the rect keeps
    // the mouse hook fast (no UIA on the hot path). Process is made DPI-aware so
    // the UIA rect and the hook's screen coords are both physical pixels.
    static volatile bool _hasRect = false;
    static volatile int _rx = 0, _ry = 0, _rw = 0, _rh = 0;

    // Foreground state — written only by the poll thread.
    static volatile bool _fgIsAi = false;
    static volatile uint _fgPid = 0;
    static string _app = "";
    // Sticky timer: when focus leaves an AI app, keep _fgIsAi true for 3s
    // so toast-dismiss-then-quick-send can't bypass the block.
    static long _fgLeftAiTicks = 0;
    static readonly long FG_STICKY_TTL = TimeSpan.FromSeconds(3).Ticks;

    // Blocked agents — the foreground process is fully blocked (all Enter +
    // send button swallowed) when it matches a platform in the blocklist.
    // Updated every 30s by reading ~/.cloudfuze-aigov/blocked-agents.json.
    static volatile bool _fgIsBlocked = false;
    static string _blockedReason = "";
    static string _blockedAgentFile = "";
    static long _lastBlockedCheck = 0;
    static readonly long BLOCKED_CHECK_INTERVAL = TimeSpan.FromSeconds(10).Ticks;

    // Attachment hold — armed over stdin ("attach_hold") when a file attached
    // to the composer is being (or has been found) sensitive. ORed into the
    // same Enter/send-click decisions as _fgIsBlocked below, so a flagged
    // attachment blocks the send exactly like a flagged prompt does.
    //
    // Node runs this in TWO stages, but this side only ever sees "hold is on
    // until told otherwise or this TTL lapses" — the state-machine timing
    // lives in index.js, not here:
    //   1. PROVISIONAL — armed the instant a scannable filename appears,
    //      before the content scan finishes. Short TTL (~3s). Beating the
    //      race against a fast Enter is the whole point: the hook checks
    //      this flag at keypress time, so arming it before the scan result
    //      is known is what stops a fast send from winning while a slow
    //      PDF/OCR extraction is still running.
    //   2. CONFIRMED — re-armed with a longer TTL once the scan actually
    //      finds a high/critical match; refreshed by Node while the flagged
    //      attachment chip is still present, released on attachment_disappeared,
    //      a clean scan, or TTL expiry (see CheckAttachHoldExpiry, called from
    //      the poll loop) if a crashed/hung parent stops refreshing it.
    static volatile bool _attachHoldActive = false;
    static string _attachHoldFilename = "";
    static string _attachHoldPatterns = "";
    static long _attachHoldExpiresAt = 0;
    // Platform → process name mapping for desktop enforcement.
    static readonly Dictionary<string, HashSet<string>> PLATFORM_PROCS = new Dictionary<string, HashSet<string>>(StringComparer.OrdinalIgnoreCase) {
        { "copilot_studio",    new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "Copilot", "M365Copilot" } },
        { "personal_agent",    new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "Copilot", "M365Copilot" } },
        { "openai_assistant",  new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "ChatGPT" } },
        { "custom_gpt",        new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "ChatGPT" } },
        { "claude_ai_project", new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "Claude" } },
        { "gemini",            new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "Gemini" } },
        { "vertex_ai",         new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "Gemini" } },
    };

    // Typed-buffer block. The BUFFER is written by the hook thread; the block
    // VERDICT (_blockTyped/_typedPatterns) is written by the poll thread, which
    // is the only thread allowed to run regexes — see Rescan()/PollLoop().
    static volatile bool _blockTyped = false;
    static string _typedPatterns = "";
    static readonly StringBuilder _typed = new StringBuilder();
    static uint _typedOwnerPid = 0;
    // Buffer caps. TYPED_MAX is what we retain; SCAN_TAIL is what we actually
    // scan each pass. A prompt about to be sent ends at the tail, so scanning
    // the last 512 chars finds the same secrets as scanning all 4096 at an
    // eighth of the regex cost.
    const int TYPED_MAX = 4096;
    const int SCAN_TAIL = 512;
    // Guards _typed only. Held for a few microseconds (append one char / copy
    // the tail) and NEVER while a regex runs, so the hook thread can never be
    // parked behind a slow scan.
    static readonly object _typedLock = new object();
    // Set by the hook thread when _typed changes; cleared by the poll thread
    // when it rescans. This is the entire hook->scanner handoff.
    static volatile bool _typedDirty = false;
    // Timestamp of the last keystroke that triggered a pattern match.
    // Used to expire the block: in multi-panel apps (Cursor), keystrokes
    // in the editor can pollute the buffer, so we expire after 60s of
    // no new matching keystrokes — the user moved on to something else.
    static long _typedBlockTicks = 0;
    static readonly long TYPED_BLOCK_TTL = TimeSpan.FromSeconds(60).Ticks;

    // UIA block — used ONLY for send-button rect detection (tells us a
    // block is active so we should look for the button), NOT for the
    // Enter-to-send decision.  UIA reads from whatever element has focus,
    // which in multi-panel apps (Cursor) can be the editor, terminal, or
    // AI response panel — all of which routinely contain displayed API
    // keys, JWTs, etc.  Using it for Enter would false-block every
    // keystroke in the entire IDE.
    static volatile bool _blockUia = false;
    static string _uiaPatterns = "";

    // Clipboard/paste block — written only by the poll thread.
    static volatile bool _blockPaste = false;

    // Timestamp of last Ctrl+V press.
    static long _lastPasteTicks = 0;
    static readonly long PASTE_WINDOW = TimeSpan.FromSeconds(5).Ticks;

    // Block cooldown: once a block fires, keep blocking for 30s so the
    // user can't dismiss the toast and immediately re-send.
    static long _lastBlockFiredTicks = 0;
    static string _lastBlockPatterns = "";
    static readonly long BLOCK_COOLDOWN = TimeSpan.FromSeconds(30).Ticks;

    // Panic hotkey (Ctrl+Alt+Shift+F12): disarms every block decision for 10
    // minutes, then blocking resumes on its own with no user action. This is
    // the "the enforcer is wrong and I need my keyboard back" escape hatch —
    // broader than the Ctrl+Alt+Enter override, which lets exactly one send
    // through. Written by the hook thread, read everywhere.
    static long _disarmedUntilTicks = 0;
    const int DISARM_SECONDS = 600;
    static readonly long DISARM_DURATION = TimeSpan.FromSeconds(DISARM_SECONDS).Ticks;

    // Regex hard timeout. Applied to EVERY rule at construction, so a rule with
    // catastrophic backtracking can burn at most 25ms instead of wedging the
    // scanner (and, before the hook was taken off the scan path, the user's
    // entire keyboard) forever.
    static readonly TimeSpan REGEX_TIMEOUT = TimeSpan.FromMilliseconds(25);
    // Rate limit for regex-timeout reports so a permanently pathological rule
    // can't flood stdout at poll cadence. Rule NAMES only — never the text.
    static readonly Dictionary<string, long> _timeoutEmitAt = new Dictionary<string, long>();
    static readonly long TIMEOUT_EMIT_THROTTLE = TimeSpan.FromSeconds(60).Ticks;

    // Deadman — see CheckHeartbeat().
    static string _heartbeatFile = "";
    static long _startTicks = 0;
    static long _lastHeartbeatCheck = 0;
    static readonly long HEARTBEAT_CHECK_INTERVAL = TimeSpan.FromSeconds(5).Ticks;
    static readonly long HEARTBEAT_MAX_STALE = TimeSpan.FromSeconds(30).Ticks;

    static HashSet<string> _aiProcs;
    // IDE-type apps where UIA reads code/terminal/output, not just the AI
    // prompt.  For these, UIA is excluded from the Enter-block decision to
    // avoid false positives.  Pure chat apps (Claude, ChatGPT, Gemini) keep
    // UIA in the Enter check because the focused element IS the composer.
    static readonly HashSet<string> _ideApps = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        { "Cursor", "Code", "VSCode", "Copilot" };

    // One entry per active block pattern. Label is empty for guardrail
    // patterns (prompt-injection, jailbreak, ...) — there is no value to
    // substitute for those, only PII/secret patterns are ever maskable.
    class PatInfo { public string Name; public Regex Rx; public string Label; public int SevRank; }
    static List<PatInfo> _patInfos;
    static readonly object _emitLock = new object();

    // ── Tier B pending-rewrite state ──────────────────────────────────────
    // Recomputed by the poll thread (UpdatePendingRewrite, off the hook
    // thread — same discipline as every other UIA/regex path here) so that
    // by the time Enter is pressed and swallowed, a masked candidate is
    // already pinned and ready. Guarded by _pendingLock; never touched from
    // the hook thread except as a fast read of _pendingRewritable.
    static readonly object _pendingLock = new object();
    static volatile bool _pendingRewritable = false;
    static string _pendingBlockId = "";
    static string _pendingWhyNot = "";
    static string _pendingPreview = "";
    // Full original/masked text, kept in memory only for the pre-flight
    // exact-match check and the rewrite itself — never emitted, logged, or
    // written anywhere except back into the composer it came from.
    static string _pendingOriginalFull = "";
    static string _pendingMaskedFull = "";
    static int[] _pendingRuntimeId = null;
    static IntPtr _pendingHwnd = IntPtr.Zero;
    static uint _pendingPid = 0;
    static long _pendingExpiresAt = 0;
    // Debug-only telemetry (length/count, never content) surfaced via the
    // confirm hotkey's "not_offered" event so a refusal reason is diagnosable
    // without ever logging the actual text.
    static int _pendingReadLen = -1;
    static int _pendingLabeledPatterns = -1;

    // One rewrite at a time. _rewriteAbort is set by the hook/mouse callbacks
    // when they see a REAL (non-injected) keystroke or click while a rewrite
    // is in flight — the user touched something, so the write must stop.
    static volatile bool _rewriteInProgress = false;
    static volatile bool _rewriteAbort = false;

    public static void Start(string[] aiProcs, string[] patNames, string[] patSources, string[] patSevs, string[] patLabels, string heartbeatFile, bool modelRouterEnabled, string modelRouterConfigJson)
    {
        try { SetProcessDPIAware(); } catch { }   // align UIA rect with hook screen coords
        _startTicks = DateTime.UtcNow.Ticks;
        _heartbeatFile = heartbeatFile ?? "";
        _blockedAgentFile = System.IO.Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
            ".cloudfuze-aigov", "blocked-agents.json");
        _aiProcs = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var p in aiProcs) { if (!string.IsNullOrEmpty(p)) _aiProcs.Add(p.Replace(".exe", "")); }
        _patInfos = new List<PatInfo>();
        for (int i = 0; i < patSources.Length; i++)
        {
            // Server-supplied rule sources are untrusted input as far as CPU is
            // concerned: always construct with the match timeout.
            try
            {
                var rx = new Regex(patSources[i], RegexOptions.CultureInvariant, REGEX_TIMEOUT);
                string sev = (patSevs != null && i < patSevs.Length) ? patSevs[i] : "";
                string label = (patLabels != null && i < patLabels.Length) ? patLabels[i] : "";
                int sevRank = string.Equals(sev, "critical", StringComparison.OrdinalIgnoreCase) ? 4 : 3;
                _patInfos.Add(new PatInfo { Name = patNames[i], Rx = rx, Label = label, SevRank = sevRank });
            }
            catch { }
        }
        // Model routing config — a bad/missing payload must never take the
        // whole helper down; it just leaves _modelRouterEnabled effectively
        // inert (UpdateModelRouting's positive-category list stays empty, so
        // it can never compute a route).
        if (modelRouterEnabled && !string.IsNullOrEmpty(modelRouterConfigJson))
        {
            try { LoadModelRouterConfig(modelRouterConfigJson); _modelRouterEnabled = true; }
            catch (Exception ex) { Emit("error", "", "", "model_router_config_load_failed", -1, -1, ex.GetType().Name); }
        }
        // The poll thread MUST be STA: UI Automation's FocusedElement read
        // returns null from an MTA thread for Chromium/Electron apps (Claude,
        // ChatGPT), which is why an earlier MTA version detected nothing in the
        // box. The working prompt-watcher.ps1 runs -Sta for the same reason.
        var poll = new Thread(PollLoop); poll.IsBackground = true;
        poll.SetApartmentState(ApartmentState.STA); poll.Start();
        var pump = new Thread(PumpLoop); pump.IsBackground = true; pump.Start();
        var stdin = new Thread(StdinLoop); stdin.IsBackground = true; stdin.Start();
    }

    // ── Model routing (Smart Model Router, desktop) ──────────────────────────
    // Phase 2: OBSERVE ONLY. Detects the current model-picker label, classifies
    // the composer's prompt complexity, and computes what tier this WOULD
    // switch to — emitted as a "route" event with result:"observed". Nothing
    // here ever touches the picker or the composer, and nothing here ever
    // swallows Enter; that is Phase 3's job, gated on a second, still-unshipped
    // write path.
    //
    // Mirrors the browser extension's classify() + detectModelInfo() +
    // smartRoute() (browser-extension/content/complexity.js and content.js),
    // with the SAME split the PII-mask port already uses elsewhere in this
    // file: the ~80-line scoring ALGORITHM is re-implemented here; the ~200-
    // term LEXICON is shipped as data (CFAI_MODEL_ROUTER_CONFIG, built by
    // agent/src/os_monitor/model-router-config.js by slicing it straight out
    // of complexity.js's source — never hand-retyped, see that file's header).

    class LexTerm { public string Term; public int Weight; public Regex StemMatch; }
    class StructSignal { public string Key; public int Weight; public Regex Rx; }
    class LexCategory
    {
        public string Name;
        public Regex Combined;
        public Dictionary<string, int> Exact = new Dictionary<string, int>(StringComparer.Ordinal);
        public List<LexTerm> Stems = new List<LexTerm>();
        public List<StructSignal> Structural = new List<StructSignal>();
    }
    class TierRule { public string Provider; public string Tier; public bool IsRegex; public string Keyword; public Regex Rx; }
    class MrModelInfo { public string Provider; public string Tier; }
    class CategoryScore { public int Sum; public bool Strong; public bool Hit; }
    class RouteDecision { public string ToTier; public string ToLabel; }

    static volatile bool _modelRouterEnabled = false;
    static List<LexCategory> _mrPositive = new List<LexCategory>();
    static LexCategory _mrSimpleTask, _mrSimplicityRequest, _mrTrivialIntent;
    static HashSet<string> _mrTrivialTokens = new HashSet<string>(StringComparer.Ordinal);
    static List<TierRule> _mrTierRules = new List<TierRule>();
    static Dictionary<string, Dictionary<int, string>> _mrTierUiNames =
        new Dictionary<string, Dictionary<int, string>>(StringComparer.OrdinalIgnoreCase);
    static int _mrComplexAt = 6, _mrSimpleAt = -3, _mrStrongWeight = 4, _mrCapPerCategory = 2;
    static int _mrWindowHead = 3000, _mrWindowTail = 1000, _mrMaxTrivialTokens = 4, _mrMaxFillerContentTokens = 2;
    static readonly Regex _mrLetterRe = new Regex("\\p{L}", RegexOptions.None, REGEX_TIMEOUT);

    static readonly HashSet<char> _mrRegexSpecial =
        new HashSet<char> { '.', '*', '+', '?', '^', '$', '{', '}', '(', ')', '|', '[', ']', '\\' };

    static string MrEscapeRegex(string s)
    {
        var sb = new StringBuilder();
        foreach (char c in s) { if (_mrRegexSpecial.Contains(c)) sb.Append('\\'); sb.Append(c); }
        return sb.ToString();
    }

    // Mirrors complexity.js's phraseSource(): every literal space becomes
    // \s+ so a multi-word term survives a line-broken paste the same way it
    // does in the browser extension.
    static string MrPhraseSource(string term)
    {
        return Regex.Replace(MrEscapeRegex(term), " +", "\\s+", RegexOptions.None, REGEX_TIMEOUT);
    }

    static List<object> MrListOf(object arrList)
    {
        var o = new List<object>();
        if (arrList != null) foreach (var x in (IEnumerable)arrList) o.Add(x);
        return o;
    }

    // Mirrors complexity.js's compileCategory(): one alternation regex per
    // category (longest term first — alternation is first-match-wins, so
    // "trade-offs" must be offered before "trade-off"), exact terms in a
    // dictionary, stems as their own standalone match-back regex.
    static LexCategory CompileLexCategory(string name, List<object> rawTerms, List<object> rawStructural)
    {
        var cat = new LexCategory { Name = name };
        var ordered = new List<Dictionary<string, object>>();
        foreach (var raw in rawTerms) ordered.Add((Dictionary<string, object>)raw);
        ordered.Sort((a, b) => ((string)b["term"]).Length.CompareTo(((string)a["term"]).Length));

        var sources = new List<string>();
        foreach (var t in ordered)
        {
            string term = (string)t["term"];
            int weight = Convert.ToInt32(t["weight"]);
            if (term.EndsWith("*"))
            {
                string stem = MrPhraseSource(term.Substring(0, term.Length - 1));
                sources.Add("\\b" + stem + "\\w*");
                cat.Stems.Add(new LexTerm
                {
                    Term = term,
                    Weight = weight,
                    StemMatch = new Regex("^" + stem + "\\w*$", RegexOptions.IgnoreCase, REGEX_TIMEOUT),
                });
            }
            else
            {
                sources.Add("\\b" + MrPhraseSource(term) + "\\b");
                cat.Exact[term] = weight;
            }
        }
        string combinedSource = string.Join("|", sources);
        cat.Combined = new Regex(combinedSource, RegexOptions.IgnoreCase, REGEX_TIMEOUT);

        if (rawStructural != null)
        {
            foreach (var raw in rawStructural)
            {
                var s = (Dictionary<string, object>)raw;
                string flags = s.ContainsKey("flags") ? (string)s["flags"] : "";
                RegexOptions opts = (flags != null && flags.IndexOf('i') >= 0) ? RegexOptions.IgnoreCase : RegexOptions.None;
                string sigSource = (string)s["source"];
                cat.Structural.Add(new StructSignal
                {
                    Key = (string)s["key"],
                    Weight = Convert.ToInt32(s["weight"]),
                    Rx = new Regex(sigSource, opts, REGEX_TIMEOUT),
                });
            }
        }
        return cat;
    }

    // Parses CFAI_MODEL_ROUTER_CONFIG (built by model-router-config.js) via
    // JavaScriptSerializer rather than flattening its nested shape into
    // parallel string arrays the way CFAI_BLOCK_PATTERNS is above — that
    // payload is a flat list; this one nests terms inside categories, and
    // re-flattening a nested shape by hand in PowerShell would just move the
    // parsing problem rather than solve it.
    static void LoadModelRouterConfig(string json)
    {
        var serializer = new JavaScriptSerializer();
        serializer.MaxJsonLength = 5 * 1024 * 1024;
        var root = (Dictionary<string, object>)serializer.DeserializeObject(json);

        var positive = new List<LexCategory>();
        foreach (var raw in (IEnumerable)root["positiveCategories"])
        {
            var cat = (Dictionary<string, object>)raw;
            object structuralRaw = cat.ContainsKey("structural") ? cat["structural"] : null;
            positive.Add(CompileLexCategory((string)cat["name"], MrListOf(cat["terms"]), MrListOf(structuralRaw)));
        }
        _mrPositive = positive;

        LexCategory simpleTask = null, simplicityRequest = null, trivialIntent = null;
        foreach (var raw in (IEnumerable)root["negativeCategories"])
        {
            var cat = (Dictionary<string, object>)raw;
            string name = (string)cat["name"];
            var compiled = CompileLexCategory(name, MrListOf(cat["terms"]), null);
            if (name == "SIMPLE_TASK") simpleTask = compiled;
            else if (name == "SIMPLICITY_REQUEST") simplicityRequest = compiled;
            else if (name == "TRIVIAL_INTENT") trivialIntent = compiled;
        }
        _mrSimpleTask = simpleTask; _mrSimplicityRequest = simplicityRequest; _mrTrivialIntent = trivialIntent;

        // Derived from TRIVIAL_INTENT so the two can never drift — same
        // reasoning as complexity.js's own TRIVIAL_TOKENS.
        var trivialTokens = new HashSet<string>(StringComparer.Ordinal);
        if (trivialIntent != null)
        {
            foreach (var term in trivialIntent.Exact.Keys)
                foreach (var w in term.Split(' ')) if (w.Length > 0) trivialTokens.Add(w);
        }
        _mrTrivialTokens = trivialTokens;

        var thresholds = (Dictionary<string, object>)root["thresholds"];
        _mrComplexAt = Convert.ToInt32(thresholds["COMPLEX_AT"]);
        _mrSimpleAt = Convert.ToInt32(thresholds["SIMPLE_AT"]);
        _mrStrongWeight = Convert.ToInt32(thresholds["STRONG_WEIGHT"]);
        _mrCapPerCategory = Convert.ToInt32(thresholds["CAP_PER_CATEGORY"]);
        _mrWindowHead = Convert.ToInt32(thresholds["WINDOW_HEAD"]);
        _mrWindowTail = Convert.ToInt32(thresholds["WINDOW_TAIL"]);
        _mrMaxTrivialTokens = Convert.ToInt32(thresholds["MAX_TRIVIAL_TOKENS"]);
        _mrMaxFillerContentTokens = Convert.ToInt32(thresholds["MAX_FILLER_CONTENT_TOKENS"]);

        var tierRules = new List<TierRule>();
        foreach (var raw in (IEnumerable)root["tierKeywordRules"])
        {
            var rule = (Dictionary<string, object>)raw;
            string provider = (string)rule["provider"];
            string tier = (string)rule["tier"];
            if (rule.ContainsKey("any") && rule["any"] != null)
            {
                foreach (var kw in (IEnumerable)rule["any"])
                    tierRules.Add(new TierRule { Provider = provider, Tier = tier, IsRegex = false, Keyword = ((string)kw).ToLowerInvariant() });
            }
            if (rule.ContainsKey("anyRegex") && rule["anyRegex"] != null)
            {
                foreach (var kw in (IEnumerable)rule["anyRegex"])
                {
                    string kwSource = (string)kw;
                    tierRules.Add(new TierRule { Provider = provider, Tier = tier, IsRegex = true, Rx = new Regex(kwSource, RegexOptions.None, REGEX_TIMEOUT) });
                }
            }
        }
        _mrTierRules = tierRules;

        var tierUiNames = new Dictionary<string, Dictionary<int, string>>(StringComparer.OrdinalIgnoreCase);
        var rawTierUiNames = (Dictionary<string, object>)root["tierUiNames"];
        foreach (var providerKv in rawTierUiNames)
        {
            var perTier = new Dictionary<int, string>();
            foreach (var tierKv in (Dictionary<string, object>)providerKv.Value) perTier[int.Parse(tierKv.Key)] = (string)tierKv.Value;
            tierUiNames[providerKv.Key] = perTier;
        }
        _mrTierUiNames = tierUiNames;
    }

    // Mirrors complexity.js's scoreCategory(): match the alternation, resolve
    // each match back to its lexicon-entry IDENTITY (not the matched surface
    // form — every inflection of a stem is the SAME entry, so inflecting or
    // repeating a term can't buy extra score), then sum only the top
    // CAP_PER_CATEGORY distinct entries by absolute weight.
    static CategoryScore ScoreLexCategory(LexCategory cat, string sample)
    {
        var hits = new Dictionary<string, int>(StringComparer.Ordinal);
        foreach (Match m in cat.Combined.Matches(sample))
        {
            string matched = Regex.Replace(m.Value.ToLowerInvariant(), "\\s+", " ", RegexOptions.None, REGEX_TIMEOUT);
            string term = null; int weight = 0;
            if (cat.Exact.TryGetValue(matched, out weight)) { term = matched; }
            else
            {
                foreach (var stem in cat.Stems)
                {
                    if (stem.StemMatch.IsMatch(matched)) { term = stem.Term; weight = stem.Weight; break; }
                }
            }
            if (term == null || weight == 0 || hits.ContainsKey(term)) continue;
            hits[term] = weight;
        }
        foreach (var sig in cat.Structural)
        {
            if (!hits.ContainsKey(sig.Key) && sig.Rx.IsMatch(sample)) hits[sig.Key] = sig.Weight;
        }
        var weights = new List<int>(hits.Values);
        weights.Sort((a, b) => Math.Abs(b).CompareTo(Math.Abs(a)));
        int sum = 0; bool strong = false;
        for (int i = 0; i < weights.Count; i++)
        {
            if (weights[i] >= _mrStrongWeight) strong = true;   // uncapped — see step 5 of Classify
            if (i < _mrCapPerCategory) sum += weights[i];
        }
        return new CategoryScore { Sum = sum, Strong = strong, Hit = hits.Count > 0 };
    }

    static void MrTallyTokens(string sample, out int tokens, out int trivial, out int content)
    {
        tokens = 0; trivial = 0; content = 0;
        foreach (var tok in sample.Split((char[])null, StringSplitOptions.RemoveEmptyEntries))
        {
            tokens++;
            string word = Regex.Replace(tok.ToLowerInvariant(), "[^a-z0-9']+", "", RegexOptions.None, REGEX_TIMEOUT);
            if (word.Length > 0 && _mrTrivialTokens.Contains(word)) trivial++;
            else if (word.Length > 0 || _mrLetterRe.IsMatch(tok)) content++;
        }
    }

    static bool MrIsAllTrivialTokens(string sample)
    {
        int tokens, trivial, content;
        MrTallyTokens(sample, out tokens, out trivial, out content);
        if (tokens == 0 || tokens > _mrMaxTrivialTokens) return false;
        return content == 0 && trivial > 0;
    }

    static bool MrTrivialDominates(string sample)
    {
        int tokens, trivial, content;
        MrTallyTokens(sample, out tokens, out trivial, out content);
        return trivial > content && content <= _mrMaxFillerContentTokens;
    }

    // CPU/latency guard only, never a complexity signal — same rule
    // complexity.js's boundWindow() documents. Head + tail, not head alone,
    // because the actual ask is very often the last line under a large paste.
    static string MrBoundWindow(string text)
    {
        if (text.Length <= _mrWindowHead + _mrWindowTail) return text;
        return text.Substring(0, _mrWindowHead) + "\n" + text.Substring(text.Length - _mrWindowTail);
    }

    // Mirrors complexity.js's classify(). A classifier fault must never break
    // anything on the caller's side, and must never silently downgrade a
    // prompt either — 'moderate' is the safe default on any failure, same as
    // the empty-text case.
    static string ClassifyComplexity(string text)
    {
        try
        {
            if (text == null) text = "";
            string trimmed = text.Trim();
            if (trimmed.Length == 0) return "moderate";
            string sample = MrBoundWindow(trimmed);
            if (MrIsAllTrivialTokens(sample)) return "simple";

            int positive = 0; bool strongHit = false;
            foreach (var cat in _mrPositive)
            {
                var r = ScoreLexCategory(cat, sample);
                positive += r.Sum;
                if (r.Strong) strongHit = true;
            }
            var simpleTask = _mrSimpleTask != null ? ScoreLexCategory(_mrSimpleTask, sample) : new CategoryScore();
            var simplicity = _mrSimplicityRequest != null ? ScoreLexCategory(_mrSimplicityRequest, sample) : new CategoryScore();
            var trivial = _mrTrivialIntent != null ? ScoreLexCategory(_mrTrivialIntent, sample) : new CategoryScore();
            int negative = simpleTask.Sum + simplicity.Sum + (MrTrivialDominates(sample) ? trivial.Sum : 0);
            int score = positive + negative;

            if (simplicity.Hit && !strongHit) return "simple";
            if (score >= _mrComplexAt) return "complex";
            if (score <= _mrSimpleAt) return "simple";
            return "moderate";
        }
        catch { return "moderate"; }
    }

    static MrModelInfo DetectModelInfo(string text)
    {
        string t = (text ?? "").ToLowerInvariant();
        foreach (var rule in _mrTierRules)
        {
            if (!rule.IsRegex) { if (t.Contains(rule.Keyword)) return new MrModelInfo { Provider = rule.Provider, Tier = rule.Tier }; }
            else { try { if (rule.Rx.IsMatch(t)) return new MrModelInfo { Provider = rule.Provider, Tier = rule.Tier }; } catch { } }
        }
        return null;
    }

    static int MrTierNum(string tier)
    {
        if (tier == "premium") return 3;
        if (tier == "standard") return 2;
        if (tier == "economy") return 1;
        return 2;
    }
    static string MrTierName(int num) { if (num >= 3) return "premium"; if (num == 2) return "standard"; return "economy"; }

    // In-memory only, per this repo's v1 decision — resets on every helper
    // restart (a policy update, a settings change). Mirrors content.js's
    // _userCeiling: "the most expensive model the user manually selected;
    // routing down never lowers it."
    static string _mrCeilingProvider = null;
    static string _mrCeilingTier = null;

    static void UpdateCeiling(MrModelInfo current)
    {
        int newNum = MrTierNum(current.Tier);
        int oldNum = _mrCeilingTier != null ? MrTierNum(_mrCeilingTier) : 0;
        if (newNum > oldNum || _mrCeilingTier == null || _mrCeilingProvider != current.Provider)
        {
            _mrCeilingProvider = current.Provider; _mrCeilingTier = current.Tier;
        }
    }

    // Mirrors content.js's smartRoute() tier arithmetic exactly (simple ->
    // economy; complex -> at least standard, or the ceiling if higher;
    // moderate -> standard; capped at the ceiling for anything but complex).
    static RouteDecision ComputeRoute(MrModelInfo current, string complexity)
    {
        if (_mrCeilingTier == null) { _mrCeilingProvider = current.Provider; _mrCeilingTier = current.Tier; }
        string ceilingTier = (_mrCeilingProvider == current.Provider) ? _mrCeilingTier : "standard";
        int ceilingNum = MrTierNum(ceilingTier);
        int currentNum = MrTierNum(current.Tier);

        int targetNum;
        if (complexity == "simple") targetNum = 1;
        else if (complexity == "complex") targetNum = Math.Max(ceilingNum, 2);
        else targetNum = 2;
        if (complexity != "complex") targetNum = Math.Min(targetNum, Math.Max(ceilingNum, 2));

        if (targetNum == currentNum) return null;
        string targetTierName = MrTierName(targetNum);
        Dictionary<int, string> uiNames;
        if (!_mrTierUiNames.TryGetValue(current.Provider, out uiNames)) return null;
        string uiName;
        if (!uiNames.TryGetValue(targetNum, out uiName)) return null;
        return new RouteDecision { ToTier = targetTierName, ToLabel = uiName };
    }

    static volatile bool _mrPickerSearchInProgress = false;
    static AutomationElement _mrCachedPicker = null;
    static IntPtr _mrCachedPickerHwnd = IntPtr.Zero;
    static long _mrLastPickerSearchTicks = 0;
    static readonly long MR_PICKER_SEARCH_MIN_INTERVAL = TimeSpan.FromSeconds(2).Ticks;
    static string _mrLastObservedKey = "";

    // Runs on its OWN background thread, never the poll thread. A full
    // FindAll(Descendants) tree walk measured 1.4-5.8s live against Claude
    // Desktop (Phase 0's probe) — an order of magnitude too slow to ever run
    // inline in the 150ms poll loop, whose OTHER jobs (UpdateUia's PII scan,
    // in particular) must never be delayed behind it. The poll thread only
    // ever reads whatever is currently cached; it never waits on a search.
    static void SearchModelPickerBackground(IntPtr fg)
    {
        try
        {
            AutomationElement win = AutomationElement.FromHandle(fg);
            if (win != null)
            {
                var cond = new OrCondition(
                    new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Button),
                    new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Custom));
                AutomationElementCollection found = win.FindAll(TreeScope.Descendants, cond);
                foreach (AutomationElement el in found)
                {
                    string name = null;
                    try { name = el.Current.Name; } catch { }
                    // "Model: " prefix confirmed live against Claude Desktop's
                    // real button text (Phase 0 probe). Claude-only for v1 —
                    // ChatGPT/Gemini need their own probe data before a
                    // picker signature for them can be added here.
                    if (!string.IsNullOrEmpty(name) && name.StartsWith("Model:", StringComparison.OrdinalIgnoreCase))
                    {
                        _mrCachedPicker = el; _mrCachedPickerHwnd = fg;
                        break;
                    }
                }
            }
        }
        catch { }
        finally { _mrPickerSearchInProgress = false; }
    }

    static AutomationElement GetCachedModelPicker(IntPtr fg)
    {
        if (_mrCachedPicker != null && _mrCachedPickerHwnd == fg)
        {
            try { var probe = _mrCachedPicker.Current.Name; return _mrCachedPicker; }
            catch { _mrCachedPicker = null; }   // stale reference — fall through to a fresh search
        }
        long now = DateTime.UtcNow.Ticks;
        if (!_mrPickerSearchInProgress && (now - _mrLastPickerSearchTicks) > MR_PICKER_SEARCH_MIN_INTERVAL)
        {
            _mrLastPickerSearchTicks = now;
            _mrPickerSearchInProgress = true;
            var t = new Thread(() => SearchModelPickerBackground(fg));
            t.IsBackground = true;
            t.SetApartmentState(ApartmentState.STA);   // UIA requires STA, same as the poll thread
            t.Start();
        }
        return null;   // not available this tick — will be cached once the background search finishes
    }

    static void EmitRoute(string process, string provider, string fromTier, string toTier, string toLabel, string complexity, string result, int len, string reason = null)
    {
        string json = "{\"kind\":\"route\""
            + ",\"process\":\"" + Esc(process ?? "") + "\""
            + ",\"provider\":\"" + Esc(provider ?? "") + "\""
            + ",\"from_tier\":\"" + Esc(fromTier ?? "") + "\""
            + ",\"to_tier\":\"" + Esc(toTier ?? "") + "\""
            + ",\"to_label\":\"" + Esc(toLabel ?? "") + "\""
            + ",\"complexity\":\"" + Esc(complexity ?? "") + "\""
            + ",\"result\":\"" + Esc(result) + "\""
            + ",\"len\":" + len
            + (!string.IsNullOrEmpty(reason) ? ",\"reason\":\"" + Esc(reason) + "\"" : "")
            + "}";
        lock (_emitLock) { Console.Out.WriteLine(json); Console.Out.Flush(); }
    }

    // Phase 2 entry point — OBSERVE ONLY, see the section header above. Never
    // swallows Enter, never writes anything; only ever emits a "route" event
    // describing what a future write path WOULD do.
    // ── Phase 3: pinned route + write path ───────────────────────────────────
    // Same shape as the pending-rewrite pin (_pendingBlockId/_pendingRewritable):
    // the poll thread continuously computes and PINS the current best routing
    // decision here; only Enter (on the hook thread) ever consumes it, via
    // StartRoute(). Nothing here writes anything — UpdateModelRouting only
    // decides and pins.
    static readonly object _routeLock = new object();
    static string _pendingRouteId = "";
    static bool _pendingRouteArmed = false;
    static string _pendingRouteFromTier = "", _pendingRouteToTier = "", _pendingRouteToLabel = "", _pendingRouteProvider = "", _pendingRouteComplexity = "";
    static string _pendingRouteOriginalText = "";
    static int[] _pendingRouteComposerRid = null;
    static IntPtr _pendingRouteHwnd = IntPtr.Zero;
    static long _pendingRouteExpiresAt = 0;
    static readonly long ROUTE_TTL = TimeSpan.FromSeconds(15).Ticks;

    static volatile bool _routeInProgress = false;
    static volatile bool _routeAbort = false;

    static void UpdateModelRouting()
    {
        if (!_modelRouterEnabled) return;
        if (!_fgIsAi || _ideApps.Contains(_app) || Disarmed()) { ClearPendingRoute(); return; }
        // Block always wins, and a live Tokenize & Send offer must never be
        // disturbed — same precedence RunRewrite's callers already respect.
        if (_fgIsBlocked || _blockUia || _blockTyped) { ClearPendingRoute(); return; }
        if (_rewriteInProgress || _routeInProgress) return;   // leave any existing pin alone mid-write
        bool pendingRewritable;
        lock (_pendingLock) { pendingRewritable = _pendingRewritable; }
        if (pendingRewritable) { ClearPendingRoute(); return; }

        IntPtr fg = GetForegroundWindow();
        if (fg == IntPtr.Zero) return;

        // Transient UIA read failures must not wipe a still-valid pin out from
        // under a route that is about to fire on the next Enter — same "why"
        // as UpdatePendingRewrite's identical protection (confirmed live:
        // Claude Desktop's own re-renders cause occasional blip reads that
        // have nothing to do with the actual composer content changing).
        AutomationElement el;
        try { el = AutomationElement.FocusedElement; } catch { el = null; }
        if (el == null) return;
        string text = null;
        try { text = ReadText(el); } catch { }
        if (string.IsNullOrEmpty(text)) return;
        int[] composerRid = null;
        try { composerRid = el.GetRuntimeId(); } catch { }
        if (composerRid == null) return;

        AutomationElement picker = GetCachedModelPicker(fg);
        if (picker == null) return;   // not found yet, or a background search is still running
        string label = null;
        try { label = picker.Current.Name; } catch { _mrCachedPicker = null; return; }
        if (string.IsNullOrEmpty(label)) return;

        var current = DetectModelInfo(label);
        if (current == null) return;
        UpdateCeiling(current);

        // Dedup against the poll thread's own ~150ms cadence — nothing about
        // the prompt or the picker changed, so there is nothing new to compute.
        string dedupKey = NormalizeWs(text) + "|" + label;
        if (dedupKey == _mrLastObservedKey) return;
        _mrLastObservedKey = dedupKey;

        string complexity = ClassifyComplexity(text);
        var decision = ComputeRoute(current, complexity);
        if (decision == null) { ClearPendingRoute(); return; }   // already at the right tier

        lock (_routeLock)
        {
            // Reuse the existing route id when the underlying (text, label)
            // pair hasn't actually changed — same "why" as the rewrite pin's
            // samePrompt check: rotating the id under a route that's about to
            // fire on the very next Enter would make StartRoute silently
            // no-op on the mismatch.
            bool samePrompt = _pendingRouteArmed && _pendingRouteOriginalText == text
                && string.Equals(_pendingRouteToLabel, decision.ToLabel, StringComparison.Ordinal);
            if (!samePrompt) _pendingRouteId = Guid.NewGuid().ToString("N");
            _pendingRouteArmed = true;
            _pendingRouteFromTier = current.Tier;
            _pendingRouteToTier = decision.ToTier;
            _pendingRouteToLabel = decision.ToLabel;
            _pendingRouteProvider = current.Provider;
            _pendingRouteComplexity = complexity;
            _pendingRouteOriginalText = text;
            _pendingRouteComposerRid = composerRid;
            _pendingRouteHwnd = fg;
            _pendingRouteExpiresAt = DateTime.UtcNow.Ticks + ROUTE_TTL;
        }
    }

    static void ClearPendingRoute()
    {
        lock (_routeLock) { _pendingRouteId = ""; _pendingRouteArmed = false; }
    }

    // Locates every currently-visible model-choice item in the foreground
    // window (RadioButton/MenuItem — the shapes Phase 0's probe found live
    // against Claude Desktop) and returns the first whose Name starts with
    // the given label. Called AFTER the picker's dropdown has been expanded,
    // never before — the popover's items don't exist in the UIA tree until
    // then, so nothing here can be pre-cached the way the picker button is.
    // A depth-capped TreeWalker walk, NOT FindAll(Descendants, condition) —
    // confirmed live against Claude Desktop's real "More models" submenu:
    // FindAll with an OrCondition(RadioButton, MenuItem) filter found nothing
    // at all (four real attempts, all target_item_not_found), while a plain
    // TreeWalker walk over the SAME open popover found "Haiku 4.5" without
    // difficulty. Chromium's UIA bridge is not reliable at server-side
    // condition filtering for its own web-rendered controls; visiting every
    // node and checking ControlType ourselves is the same tradeoff
    // attachment-watcher.ps1 already made for exactly this reason.
    static AutomationElement FindMenuItemByLabel(AutomationElement win, string label)
    {
        try
        {
            var walker = TreeWalker.ControlViewWalker;
            var stack = new Stack<KeyValuePair<AutomationElement, int>>();
            stack.Push(new KeyValuePair<AutomationElement, int>(win, 0));
            while (stack.Count > 0)
            {
                var cur = stack.Pop();
                if (cur.Value > 30) continue;   // same depth cap the probe/attachment-watcher use
                AutomationElement el = cur.Key;
                try
                {
                    ControlType ct = el.Current.ControlType;
                    if (ct == ControlType.RadioButton || ct == ControlType.MenuItem)
                    {
                        string name = null;
                        try { name = el.Current.Name; } catch { }
                        if (!string.IsNullOrEmpty(name) && name.StartsWith(label, StringComparison.OrdinalIgnoreCase))
                            return el;
                    }
                }
                catch { }
                try
                {
                    AutomationElement child = walker.GetFirstChild(el);
                    while (child != null)
                    {
                        stack.Push(new KeyValuePair<AutomationElement, int>(child, cur.Value + 1));
                        child = walker.GetNextSibling(child);
                    }
                }
                catch { }
            }
        }
        catch { }
        return null;
    }

    // Same TreeWalker technique as FindMenuItemByLabel, scoped to the picker
    // button itself. Used to re-find it FRESH for post-switch verification
    // rather than trusting the cached reference still points at a live,
    // current element — a nested "More models" selection re-renders more of
    // the surrounding UI than a top-level one does, and a stale reference
    // can keep returning its last-known (pre-switch) value without ever
    // throwing, which would make verification wait out its whole deadline
    // for a switch that already happened.
    static AutomationElement FindModelPickerButton(AutomationElement win)
    {
        try
        {
            var walker = TreeWalker.ControlViewWalker;
            var stack = new Stack<KeyValuePair<AutomationElement, int>>();
            stack.Push(new KeyValuePair<AutomationElement, int>(win, 0));
            while (stack.Count > 0)
            {
                var cur = stack.Pop();
                if (cur.Value > 30) continue;
                AutomationElement el = cur.Key;
                try
                {
                    ControlType ct = el.Current.ControlType;
                    if (ct == ControlType.Button)
                    {
                        string name = null;
                        try { name = el.Current.Name; } catch { }
                        if (!string.IsNullOrEmpty(name) && name.StartsWith("Model:", StringComparison.OrdinalIgnoreCase))
                            return el;
                    }
                }
                catch { }
                try
                {
                    AutomationElement child = walker.GetFirstChild(el);
                    while (child != null)
                    {
                        stack.Push(new KeyValuePair<AutomationElement, int>(child, cur.Value + 1));
                        child = walker.GetNextSibling(child);
                    }
                }
                catch { }
            }
        }
        catch { }
        return null;
    }

    static void TryCollapsePicker(AutomationElement picker)
    {
        try
        {
            object patObj;
            if (picker.TryGetCurrentPattern(ExpandCollapsePattern.Pattern, out patObj))
            {
                var pat = (ExpandCollapsePattern)patObj;
                if (pat.Current.ExpandCollapseState != ExpandCollapseState.Collapsed) pat.Collapse();
            }
        }
        catch { }
    }

    static void StartRoute(string routeId)
    {
        // Every rejection is reported, mirroring StartRewrite — a swallowed
        // Enter that produces no visible outcome at all is indistinguishable
        // from a hang.
        if (_routeInProgress || _rewriteInProgress) { EmitRoute(_app, "", "", "", "", "", "aborted", -1, "route_or_rewrite_already_in_progress"); return; }
        if (string.IsNullOrEmpty(routeId)) return;
        string fromTier, toTier, toLabel, provider, complexity, originalText;
        int[] composerRid; IntPtr hwnd; long expiresAt;
        lock (_routeLock)
        {
            if (_pendingRouteId != routeId || !_pendingRouteArmed) { EmitRoute(_app, "", "", "", "", "", "aborted", -1, "stale_route_id"); return; }
            fromTier = _pendingRouteFromTier; toTier = _pendingRouteToTier; toLabel = _pendingRouteToLabel;
            provider = _pendingRouteProvider; complexity = _pendingRouteComplexity;
            originalText = _pendingRouteOriginalText; composerRid = _pendingRouteComposerRid;
            hwnd = _pendingRouteHwnd; expiresAt = _pendingRouteExpiresAt;
        }
        if (DateTime.UtcNow.Ticks > expiresAt) { ClearPendingRoute(); EmitRoute(_app, provider, fromTier, toTier, toLabel, complexity, "failed", -1, "expired"); return; }

        _routeInProgress = true;
        _routeAbort = false;
        var t = new Thread(() => RunRoute(routeId, fromTier, toTier, toLabel, provider, complexity, originalText, composerRid, hwnd));
        t.IsBackground = true;
        t.SetApartmentState(ApartmentState.STA);
        t.Start();
    }

    // The ONLY place model routing ever sends unrouted. Switching models
    // carries no security/privacy risk the way an unmasked rewrite would —
    // the prompt text itself is never touched by this feature — so unlike
    // RunRewrite's failure paths (which must never send unverified content),
    // every routing failure that leaves the composer verifiably intact and
    // focused falls back to sending the prompt with whatever model is
    // currently selected, rather than leaving the user's Enter swallowed
    // with nothing having happened. Only a genuine change of focus or
    // content declines the fallback — sending into a window the user has
    // since moved away from would be actively wrong, not just suboptimal.
    static void FallbackSendOrReport(string routeId, string provider, string fromTier, string toTier, string toLabel, string complexity,
        IntPtr pinnedHwnd, int[] pinnedComposerRid, string originalText, string reason)
    {
        // Clear the pin unconditionally, BEFORE anything else — regardless
        // of whether the fallback send below succeeds. Confirmed live: when
        // this only cleared on the success path, a failure here left the
        // SAME pin armed, and Windows key-repeat on a held Enter (auto-fires
        // every ~30-50ms) re-triggered StartRoute over and over on the exact
        // same stale attempt — the dropdown visibly flickering open/closed
        // in a loop with nothing else happening. One attempt per Enter,
        // always, whether it works or not.
        ClearPendingRoute();

        if (GetForegroundWindow() != pinnedHwnd) { EmitRoute(_app, provider, fromTier, toTier, toLabel, complexity, "failed", -1, reason + "_no_fallback_focus_changed"); return; }
        AutomationElement el;
        try { el = AutomationElement.FocusedElement; } catch { el = null; }
        if (el == null) { EmitRoute(_app, provider, fromTier, toTier, toLabel, complexity, "failed", -1, reason + "_no_fallback_no_element"); return; }
        int[] rid = null; string text = null;
        try { rid = el.GetRuntimeId(); } catch { }
        try { text = ReadText(el); } catch { }
        if (!RuntimeIdEquals(rid, pinnedComposerRid) || NormalizeWs(text) != NormalizeWs(originalText))
        { EmitRoute(_app, provider, fromTier, toTier, toLabel, complexity, "failed", -1, reason + "_no_fallback_text_changed"); return; }

        Emit("prompt", _app, "", "send", originalText.Length);
        TypedClear(); _blockTyped = false; _typedPatterns = ""; _lastBlockFiredTicks = 0;
        _blockUia = false; _uiaPatterns = "";
        _blockPaste = false; _lastPasteTicks = 0;
        _mrLastObservedKey = "";

        SendKeyPress(VK_RETURN);
        Thread.Sleep(200);
        string postSend = null;
        try { postSend = ReadText(el); } catch { }
        bool stillThere = NormalizeWs(postSend) == NormalizeWs(originalText);
        if (stillThere) { EmitRoute(_app, provider, fromTier, toTier, toLabel, complexity, "failed", -1, reason + "_fallback_not_submitted"); return; }

        EmitRoute(_app, provider, fromTier, toTier, toLabel, complexity, "sent_unrouted", originalText.Length, reason);
    }

    static void RunRoute(string routeId, string fromTier, string toTier, string toLabel, string provider, string complexity,
        string originalText, int[] pinnedComposerRid, IntPtr pinnedHwnd)
    {
        try
        {
            // Pre-flight: everything pinned at Enter-press time must still
            // hold. Any mismatch here still tries the fallback send — see
            // FallbackSendOrReport's own header for why that is safe for
            // routing specifically, unlike a PII rewrite.
            if (GetForegroundWindow() != pinnedHwnd)
            { FallbackSendOrReport(routeId, provider, fromTier, toTier, toLabel, complexity, pinnedHwnd, pinnedComposerRid, originalText, "focus_changed"); return; }
            AutomationElement composerEl;
            try { composerEl = AutomationElement.FocusedElement; } catch { composerEl = null; }
            if (composerEl == null)
            { FallbackSendOrReport(routeId, provider, fromTier, toTier, toLabel, complexity, pinnedHwnd, pinnedComposerRid, originalText, "no_focused_element"); return; }
            int[] curRid = null;
            try { curRid = composerEl.GetRuntimeId(); } catch { }
            if (!RuntimeIdEquals(curRid, pinnedComposerRid))
            { FallbackSendOrReport(routeId, provider, fromTier, toTier, toLabel, complexity, pinnedHwnd, pinnedComposerRid, originalText, "element_changed"); return; }
            string curText = null;
            try { curText = ReadText(composerEl); } catch { }
            if (NormalizeWs(curText) != NormalizeWs(originalText))
            { FallbackSendOrReport(routeId, provider, fromTier, toTier, toLabel, complexity, pinnedHwnd, pinnedComposerRid, originalText, "text_changed"); return; }

            long waitStart = DateTime.UtcNow.Ticks;
            while (Down(VK_CONTROL) || Down(VK_MENU) || Down(VK_SHIFT) || Down(VK_RETURN))
            {
                if ((DateTime.UtcNow.Ticks - waitStart) > TimeSpan.FromMilliseconds(2500).Ticks)
                { FallbackSendOrReport(routeId, provider, fromTier, toTier, toLabel, complexity, pinnedHwnd, pinnedComposerRid, originalText, "modifiers_stuck"); return; }
                Thread.Sleep(20);
            }

            AutomationElement picker = _mrCachedPicker;
            if (picker == null || _mrCachedPickerHwnd != pinnedHwnd)
            { FallbackSendOrReport(routeId, provider, fromTier, toTier, toLabel, complexity, pinnedHwnd, pinnedComposerRid, originalText, "picker_not_found"); return; }
            string labelBefore = null;
            try { labelBefore = picker.Current.Name; } catch { }
            if (string.IsNullOrEmpty(labelBefore))
            { FallbackSendOrReport(routeId, provider, fromTier, toTier, toLabel, complexity, pinnedHwnd, pinnedComposerRid, originalText, "picker_unreadable"); return; }
            var currentCheck = DetectModelInfo(labelBefore);
            if (currentCheck == null || currentCheck.Tier != fromTier)
            { FallbackSendOrReport(routeId, provider, fromTier, toTier, toLabel, complexity, pinnedHwnd, pinnedComposerRid, originalText, "model_changed"); return; }

            object expandObj;
            if (!picker.TryGetCurrentPattern(ExpandCollapsePattern.Pattern, out expandObj))
            { FallbackSendOrReport(routeId, provider, fromTier, toTier, toLabel, complexity, pinnedHwnd, pinnedComposerRid, originalText, "no_expand_pattern"); return; }
            var expandPattern = (ExpandCollapsePattern)expandObj;
            try { expandPattern.Expand(); }
            catch { FallbackSendOrReport(routeId, provider, fromTier, toTier, toLabel, complexity, pinnedHwnd, pinnedComposerRid, originalText, "expand_failed"); return; }

            if (_routeAbort || GetForegroundWindow() != pinnedHwnd)
            { TryCollapsePicker(picker); FallbackSendOrReport(routeId, provider, fromTier, toTier, toLabel, complexity, pinnedHwnd, pinnedComposerRid, originalText, "interrupted_after_expand"); return; }

            Thread.Sleep(150);   // let the popover render its items

            AutomationElement win = null;
            try { win = AutomationElement.FromHandle(pinnedHwnd); } catch { }
            AutomationElement targetItem = win != null ? FindMenuItemByLabel(win, toLabel) : null;
            if (targetItem == null && win != null)
            {
                // Some tiers only appear behind a "More models" submenu
                // (confirmed live: Claude Desktop's Opus variants). Only
                // searched when the direct label lookup misses.
                AutomationElement moreModels = FindMenuItemByLabel(win, "More models");
                if (moreModels != null)
                {
                    // ExpandCollapsePattern.Expand() alone does not render
                    // this specific flyout's contents — confirmed live: the
                    // ARIA-level expanded state changes but "Haiku" never
                    // appears in the tree afterward. Claude Desktop's "More
                    // models" submenu is a hover flyout wired to actual
                    // pointer position, not just the accessibility state, so
                    // a real cursor move over it is required — Expand() is
                    // still called too, in case it helps on some other
                    // build, but the hover is what actually works. The
                    // cursor is restored to wherever it was afterward,
                    // whether this succeeds or not.
                    POINT savedPos;
                    bool hadPos = GetCursorPos(out savedPos);
                    try
                    {
                        System.Windows.Rect r = moreModels.Current.BoundingRectangle;
                        if (!r.IsEmpty && r.Width > 0 && r.Height > 0)
                        {
                            int cx = (int)(r.Left + r.Width / 2);
                            int cy = (int)(r.Top + r.Height / 2);
                            SetCursorPos(cx, cy);
                        }
                    }
                    catch { }
                    object mmExpandObj;
                    if (moreModels.TryGetCurrentPattern(ExpandCollapsePattern.Pattern, out mmExpandObj))
                    {
                        try { ((ExpandCollapsePattern)mmExpandObj).Expand(); } catch { }
                    }
                    Thread.Sleep(200);
                    targetItem = FindMenuItemByLabel(win, toLabel);
                    if (hadPos) { try { SetCursorPos(savedPos.X, savedPos.Y); } catch { } }
                }
            }
            if (targetItem == null)
            { TryCollapsePicker(picker); FallbackSendOrReport(routeId, provider, fromTier, toTier, toLabel, complexity, pinnedHwnd, pinnedComposerRid, originalText, "target_item_not_found"); return; }

            if (_routeAbort || GetForegroundWindow() != pinnedHwnd)
            { TryCollapsePicker(picker); FallbackSendOrReport(routeId, provider, fromTier, toTier, toLabel, complexity, pinnedHwnd, pinnedComposerRid, originalText, "interrupted_before_select"); return; }

            bool selected = false;
            object selObj;
            if (targetItem.TryGetCurrentPattern(SelectionItemPattern.Pattern, out selObj))
            { try { ((SelectionItemPattern)selObj).Select(); selected = true; } catch { } }
            if (!selected && targetItem.TryGetCurrentPattern(InvokePattern.Pattern, out selObj))
            { try { ((InvokePattern)selObj).Invoke(); selected = true; } catch { } }
            if (!selected)
            { TryCollapsePicker(picker); FallbackSendOrReport(routeId, provider, fromTier, toTier, toLabel, complexity, pinnedHwnd, pinnedComposerRid, originalText, "select_failed"); return; }

            // A settle delay before even starting to poll: a NESTED selection
            // (behind "More models") re-renders more of the surrounding menu
            // chrome than a top-level one, and needs more than the roughly
            // 40-80ms a top-level switch settles in.
            Thread.Sleep(300);
            TryCollapsePicker(picker);   // best-effort — selecting usually closes it on its own

            // Re-find the button FRESH once, rather than trusting the cached
            // `picker` reference — see FindModelPickerButton's comment for
            // why a stale reference can silently mask a switch that already
            // happened. One extra tree walk here, not one per poll: cheap
            // relative to the rest of this operation, and this thread is
            // never the one guarding the critical DLP block path.
            AutomationElement verifyEl = FindModelPickerButton(win) ?? picker;
            // Keep the poll thread's cache current too, so the NEXT tick of
            // UpdateModelRouting doesn't keep reading whatever went stale.
            if (verifyEl != null) { _mrCachedPicker = verifyEl; _mrCachedPickerHwnd = pinnedHwnd; }

            string labelAfter = null;
            bool switched = false;
            long verifyDeadline = DateTime.UtcNow.Ticks + TimeSpan.FromMilliseconds(1500).Ticks;
            do
            {
                try { labelAfter = verifyEl.Current.Name; } catch { }
                if (!string.IsNullOrEmpty(labelAfter) && !string.Equals(labelAfter, labelBefore, StringComparison.Ordinal)) { switched = true; break; }
                Thread.Sleep(60);
            } while (DateTime.UtcNow.Ticks < verifyDeadline);
            if (!switched)
            { FallbackSendOrReport(routeId, provider, fromTier, toTier, toLabel, complexity, pinnedHwnd, pinnedComposerRid, originalText, "switch_not_verified"); return; }

            // The dropdown interaction moves keyboard focus into the popover
            // and, confirmed live, it does NOT return to the composer on its
            // own once the menu closes — Chromium keeps focus wherever the
            // selection landed. Ask UIA to put it back on the SAME element
            // we pinned before the switch (still a live reference — the
            // composer itself was never touched by any of this) rather than
            // assuming it will happen by itself.
            try { composerEl.SetFocus(); } catch { }
            Thread.Sleep(150);

            AutomationElement composerAfter;
            try { composerAfter = AutomationElement.FocusedElement; } catch { composerAfter = null; }
            int[] afterRid = null; string afterText = null;
            if (composerAfter != null)
            {
                try { afterRid = composerAfter.GetRuntimeId(); } catch { }
                try { afterText = ReadText(composerAfter); } catch { }
            }
            bool composerOk = composerAfter != null && RuntimeIdEquals(afterRid, pinnedComposerRid) && NormalizeWs(afterText) == NormalizeWs(originalText);
            if (!composerOk)
            { FallbackSendOrReport(routeId, provider, fromTier, toTier, toLabel, complexity, pinnedHwnd, pinnedComposerRid, originalText, "focus_lost_after_switch"); return; }

            if (GetForegroundWindow() != pinnedHwnd)
            { FallbackSendOrReport(routeId, provider, fromTier, toTier, toLabel, complexity, pinnedHwnd, pinnedComposerRid, originalText, "focus_changed_before_send"); return; }

            // Release state before Enter — our own synthetic Enter passes
            // back through this same keyboard hook. See RunRewrite's
            // identical comment for the full reasoning, including why
            // _blockUia/_blockPaste specifically must also be cleared here.
            Emit("prompt", _app, "", "send", originalText.Length);
            TypedClear(); _blockTyped = false; _typedPatterns = ""; _lastBlockFiredTicks = 0;
            _blockUia = false; _uiaPatterns = "";
            _blockPaste = false; _lastPasteTicks = 0;
            ClearPendingRoute();
            _mrLastObservedKey = "";

            SendKeyPress(VK_RETURN);

            Thread.Sleep(200);
            string postSend = null;
            try { postSend = ReadText(composerAfter); } catch { }
            bool stillThere = NormalizeWs(postSend) == NormalizeWs(originalText);
            if (stillThere) { EmitRoute(_app, provider, toTier /* now-current */, toTier, toLabel, complexity, "failed", originalText.Length, "not_submitted"); return; }

            EmitRoute(_app, provider, fromTier, toTier, toLabel, complexity, "ok", originalText.Length);
        }
        catch (Exception)
        {
            FallbackSendOrReport(routeId, provider, fromTier, toTier, toLabel, complexity, pinnedHwnd, pinnedComposerRid, originalText, "exception");
        }
        finally
        {
            _routeInProgress = false;
        }
    }

    // Control channel from the Node parent (ultimately the Electron dialog).
    // The ONLY accepted command is {"cmd":"tokenize","block_id":"..."} — no
    // text ever arrives here, just an id StartRewrite independently validates
    // against its own pinned state. Anything else is ignored.
    static void StdinLoop()
    {
        string line;
        try
        {
            while ((line = Console.In.ReadLine()) != null)
            {
                line = line.Trim();
                if (line.Length == 0) continue;
                try
                {
                    string cmd = ExtractJsonString(line, "cmd");
                    if (cmd == "tokenize")
                    {
                        string bid = ExtractJsonString(line, "block_id");
                        if (!string.IsNullOrEmpty(bid)) StartRewrite(bid);
                    }
                    else if (cmd == "attach_hold")
                    {
                        string state = ExtractJsonString(line, "state");
                        if (state == "on")
                        {
                            _attachHoldFilename = ExtractJsonString(line, "filename");
                            _attachHoldPatterns = ExtractJsonString(line, "patterns");
                            long ttlMs = ExtractJsonNumber(line, "ttl_ms", 3000);
                            _attachHoldExpiresAt = DateTime.UtcNow.Ticks + TimeSpan.FromMilliseconds(ttlMs).Ticks;
                            _attachHoldActive = true;
                        }
                        else if (state == "off")
                        {
                            _attachHoldActive = false;
                            _attachHoldFilename = ""; _attachHoldPatterns = "";
                        }
                    }
                }
                catch { }
            }
        }
        catch { }
        // stdin closed (parent gone) — the heartbeat deadman already covers
        // a dead/hung parent; this just means no more commands can arrive.
    }

    static void PumpLoop()
    {
        using (Process cur = Process.GetCurrentProcess())
        using (ProcessModule mod = cur.MainModule)
        {
            IntPtr h = GetModuleHandle(mod.ModuleName);
            _hook = SetWindowsHookEx(WH_KEYBOARD_LL, _proc, h, 0);
            _mouseHook = SetWindowsHookEx(WH_MOUSE_LL, _mouseProc, h, 0);
        }
        Emit("ready", "", "", "");
        MSG msg;
        // Blocking message pump — required to service the low-level hook.
        while (GetMessage(out msg, IntPtr.Zero, 0, 0) > 0) { }
    }

    static bool Down(int vk) { return (GetAsyncKeyState(vk) & 0x8000) != 0; }

    // Panic-hotkey window. Checked before ANY block decision is armed; when it
    // lapses (10 min) blocking resumes automatically.
    static bool Disarmed() { return DateTime.UtcNow.Ticks < _disarmedUntilTicks; }

    // ── Typed buffer accessors ────────────────────────────────────────────────
    // Every touch of _typed goes through these. The hook thread appends and
    // clears; the poll thread copies the tail out to scan it. Without the lock
    // a StringBuilder.ToString() racing an Append() can throw or return torn
    // text — which used to be impossible only because Rescan() ran on the hook
    // thread itself, the very thing we moved off it.
    static void TypedAppend(char c)
    {
        lock (_typedLock)
        {
            if (_typed.Length > TYPED_MAX) _typed.Remove(0, _typed.Length - TYPED_MAX);
            _typed.Append(c);
        }
    }
    static void TypedBackspace()
    {
        lock (_typedLock) { if (_typed.Length > 0) _typed.Length = _typed.Length - 1; }
    }
    // Bumped on every clear. A scan that started before a clear must not
    // publish its verdict afterwards, or a secret typed-then-sent inside the
    // scan window would arm a block against the user's NEXT, innocent message.
    static int _typedGen = 0;
    static void TypedClear() { lock (_typedLock) { _typed.Length = 0; _typedGen++; } }
    static int TypedLength() { lock (_typedLock) { return _typed.Length; } }
    // Tail window actually handed to the regexes.
    static string TypedTail(out int gen)
    {
        lock (_typedLock)
        {
            gen = _typedGen;
            int n = _typed.Length;
            if (n == 0) return "";
            int start = (n > SCAN_TAIL) ? n - SCAN_TAIL : 0;
            return _typed.ToString(start, n - start);
        }
    }

    // Is the typed-buffer block still fresh? Expires after 60s of no new
    // matching keystrokes so stale buffers from editor typing don't
    // permanently block sends in a different panel.
    static bool TypedBlockFresh()
    {
        return _blockTyped && (DateTime.UtcNow.Ticks - _typedBlockTicks) < TYPED_BLOCK_TTL;
    }

    // Block is active for Enter/send decisions: typed-buffer (fresh) or
    // paste-in-session.  UIA is intentionally excluded — see comment above.
    static bool BlockActiveForSend(bool pastedThisSession, bool clipBlock)
    {
        if (Disarmed()) return false;
        return TypedBlockFresh() || (pastedThisSession && clipBlock);
    }

    // Block is active for mouse-hook send-button detection: includes UIA
    // and the paste-window clipboard check so pasted secrets also block
    // the send button click.
    static bool BlockActiveForMouse()
    {
        if (Disarmed()) return false;
        bool recentPaste = (DateTime.UtcNow.Ticks - _lastPasteTicks) < PASTE_WINDOW;
        bool cooldown = (DateTime.UtcNow.Ticks - _lastBlockFiredTicks) < BLOCK_COOLDOWN;
        return _fgIsBlocked || _attachHoldActive || TypedBlockFresh() || _blockUia || (recentPaste && _blockPaste) || cooldown;
    }

    static string ActivePatterns() { return _attachHoldActive ? _attachHoldPatterns : _blockTyped ? _typedPatterns : _blockUia ? _uiaPatterns : ""; }

    // Mouse hook — swallows a click on the send button while a block is active.
    // Only acts on left-button down/up that land inside the cached send-button
    // rectangle (located by the poll thread). Everything else passes straight
    // through, so normal clicking/editing is unaffected.
    static IntPtr MouseCallback(int nCode, IntPtr wParam, IntPtr lParam)
    {
        try
        {
            if (nCode >= 0)
            {
                int msg = wParam.ToInt32();
                // Real (non-injected) mouse activity aborts an in-progress
                // rewrite EXCEPT plain movement. The trigger for a rewrite is
                // now a mouse click on the dialog's Tokenize & Send button —
                // the user's hand almost always drifts the cursor slightly in
                // the moment right after that click, and treating movement
                // itself as "the user is doing something else" aborted the
                // write mid-way nearly every time, leaving the composer
                // blanked (Ctrl+A+Delete already ran, the retype never
                // finished). Actual clicks elsewhere still abort correctly.
                if ((_rewriteInProgress || _routeInProgress) && msg != WM_MOUSEMOVE)
                {
                    uint mflags = (uint)Marshal.ReadInt32(lParam, 12);   // MSLLHOOKSTRUCT.flags
                    if ((mflags & LLMHF_INJECTED) == 0)
                    {
                        if (_rewriteInProgress) _rewriteAbort = true;
                        if (_routeInProgress) _routeAbort = true;
                    }
                }
                if (msg == WM_LBUTTONDOWN || msg == WM_LBUTTONUP)
                {
                    int x = Marshal.ReadInt32(lParam);        // MSLLHOOKSTRUCT.pt.x
                    int y = Marshal.ReadInt32(lParam, 4);     // MSLLHOOKSTRUCT.pt.y
                    bool inRect = _hasRect && x >= _rx && x < _rx + _rw && y >= _ry && y < _ry + _rh;
                    if (_fgIsAi && inRect)
                    {
                        if (BlockActiveForMouse())
                        {
                            if (msg == WM_LBUTTONDOWN) EmitBlock(_app, ActivePatterns(), "click");
                            return (IntPtr)1;   // swallow both down and up on the send button
                        }
                        // Benign send-button click — capture the prompt (LENGTH ONLY),
                        // then let the click through so the prompt actually sends. Mirrors
                        // the Enter path so click-to-send is counted on sealed apps too.
                        if (msg == WM_LBUTTONDOWN)
                        {
                            int len = TypedLength();
                            if (len >= 1)
                            {
                                Emit("prompt", _app, "", "click", len);
                                TypedClear(); _blockTyped = false; _typedPatterns = "";
                            }
                        }
                    }
                }
            }
        }
        catch { }
        return CallNextHookEx(_mouseHook, nCode, wParam, lParam);
    }

    static IntPtr HookCallback(int nCode, IntPtr wParam, IntPtr lParam)
    {
        try
        {
            if (nCode >= 0)
            {
                int msg = wParam.ToInt32();
                if (msg == WM_KEYDOWN || msg == WM_SYSKEYDOWN)
                {
                    int vk = Marshal.ReadInt32(lParam);   // KBDLLHOOKSTRUCT.vkCode (first field)
                    bool shift = Down(VK_SHIFT);
                    bool ctrl = Down(VK_CONTROL);
                    bool alt = Down(VK_MENU);
                    bool caps = (GetKeyState(VK_CAPITAL) & 1) != 0;

                    if (_rewriteInProgress || _routeInProgress)
                    {
                        uint kflags = (uint)Marshal.ReadInt32(lParam, 8);   // KBDLLHOOKSTRUCT.flags
                        if ((kflags & LLKHF_INJECTED) == 0)
                        {
                            if (_rewriteInProgress) _rewriteAbort = true;
                            if (_routeInProgress) _routeAbort = true;
                        }
                    }

                    // Confirm hotkey — Ctrl+Alt+T. Masks the pinned block's
                    // composer text and rewrites it in place; NEVER sends —
                    // the user still presses Enter themselves.
                    //
                    // Swallowed whenever an AI app is focused, REGARDLESS of
                    // whether a rewrite is currently offered. Some keyboard
                    // layouts map Ctrl+Alt (AltGr) + a letter to a special
                    // character (confirmed live: this produced literal "ţ" on
                    // a layout with that mapping) — letting that leak into
                    // the composer whenever nothing is rewritable (multi-line
                    // text, no focused element, etc.) would be exactly the
                    // kind of silent corruption this feature exists to avoid.
                    if (_fgIsAi && vk == VK_T && ctrl && alt && !shift)
                    {
                        string bid; bool rewritable; string whyNot; int readLen; int labeled;
                        lock (_pendingLock) {
                            bid = _pendingBlockId; rewritable = _pendingRewritable; whyNot = _pendingWhyNot;
                            readLen = _pendingReadLen; labeled = _pendingLabeledPatterns;
                        }
                        if (rewritable && !string.IsNullOrEmpty(bid)) StartRewrite(bid);
                        // Nothing to rewrite right now — report why instead of a
                        // silent no-op, same reason code UpdatePendingRewrite set.
                        // Length/count only, never content.
                        else EmitRewrite("", "not_offered", whyNot + " read_len=" + readLen + " labeled_patterns=" + labeled);
                        return (IntPtr)1;
                    }

                    // Panic hotkey — Ctrl+Alt+Shift+F12. Detected exactly like the
                    // Ctrl+Alt+Enter override below (modifier state via
                    // GetAsyncKeyState on the key-down), but global: it works even
                    // when the foreground app is not an AI app, because the whole
                    // point is to get the keyboard back when we are misbehaving.
                    // Never swallowed — F12 still reaches the app.
                    if (vk == VK_F12 && ctrl && alt && shift)
                    {
                        _disarmedUntilTicks = DateTime.UtcNow.Ticks + DISARM_DURATION;
                        _lastBlockFiredTicks = 0;   // drop any armed cooldown too
                        Emit("enforcement_disarmed", _app, "", "panic_hotkey", -1, DISARM_SECONDS);
                        return CallNextHookEx(_hook, nCode, wParam, lParam);
                    }

                    if (_fgIsAi)
                    {
                        // Reset the typed buffer when focus moves to a different
                        // process.
                        if (_fgPid != _typedOwnerPid)
                        {
                            TypedClear(); _typedOwnerPid = _fgPid;
                            _blockTyped = false; _typedPatterns = "";
                        }

                        // Track Ctrl+V — record timestamp so clipboard is checked
                        // in the Enter decision only within a short window.
                        if (vk == VK_V && ctrl && !alt)
                        {
                            _lastPasteTicks = DateTime.UtcNow.Ticks;
                        }

                        // Enter-to-send decision.
                        //   1. Typed buffer — user typed a secret (fresh 60s).
                        //   2. UIA focused element — for pure chat apps only
                        //      (Claude Desktop, ChatGPT, Gemini). Excluded for
                        //      IDEs (Cursor) where UIA reads code/terminal.
                        //   3. Clipboard — ONLY within 5s of a Ctrl+V press.
                        //      Prevents stale clipboard from false-blocking
                        //      while still catching paste-then-Enter.
                        if (vk == VK_RETURN && !shift)
                        {
                            bool isIde = _ideApps.Contains(_app);
                            bool uiaBlock = !isIde && _blockUia;
                            bool recentPaste = (DateTime.UtcNow.Ticks - _lastPasteTicks) < PASTE_WINDOW;
                            bool clipBlock = recentPaste && _blockPaste;
                            // A sensitive-file attachment holds the send exactly
                            // like a flagged prompt does — see _attachHoldActive's
                            // own comment for the provisional/confirmed story.
                            bool attachHold = _attachHoldActive;
                            // Cooldown: if a block fired recently, keep blocking
                            bool cooldown = (DateTime.UtcNow.Ticks - _lastBlockFiredTicks) < BLOCK_COOLDOWN;
                            // Panic hotkey wins over every other signal: while
                            // disarmed nothing is ever swallowed.
                            bool block = !Disarmed() &&
                                (_fgIsBlocked || attachHold || TypedBlockFresh() || uiaBlock || clipBlock || cooldown);
                            string pats = _fgIsBlocked ? _blockedReason
                                        : attachHold ? _attachHoldPatterns
                                        : TypedBlockFresh() ? _typedPatterns
                                        : uiaBlock ? _uiaPatterns
                                        : cooldown ? _lastBlockPatterns
                                        : _pastePatterns();
                            if (block)
                            {
                                _lastBlockFiredTicks = DateTime.UtcNow.Ticks;
                                _lastBlockPatterns = pats;
                                // Ctrl+Alt+Enter override is intentionally NOT
                                // honored for an attachment hold — that hotkey's
                                // existing semantics are "send this prompt text
                                // anyway, logged," which doesn't make sense for
                                // "detach this file first." Falling through to the
                                // ordinary block keeps the composer's Enter dead
                                // either way, same outcome, simpler than adding a
                                // second override meaning.
                                if (ctrl && alt && !attachHold) { Emit("override", _app, pats, ""); }  // allow, logged
                                else { EmitBlock(_app, pats, attachHold ? "attachment" : "send"); return (IntPtr)1; }  // swallow
                            }
                            else
                            {
                                // Model routing — only when nothing is blocked
                                // (checked above) and a fresh decision is
                                // pinned. Swallow this Enter and let RunRoute
                                // do the switch + its OWN resend; it reports
                                // the prompt-sent telemetry itself once it
                                // actually sends, same as the clean-send path
                                // below would have.
                                string routeId; bool routeArmed;
                                lock (_routeLock) { routeId = _pendingRouteId; routeArmed = _pendingRouteArmed; }
                                if (routeArmed && !string.IsNullOrEmpty(routeId) && !_rewriteInProgress)
                                {
                                    StartRoute(routeId);
                                    return (IntPtr)1;
                                }

                                // Clean send — capture the prompt (LENGTH ONLY, no
                                // content) for per-user usage/attribution, then reset.
                                // This is the SAME reconstructed keystroke buffer we
                                // use to block sensitive sends, which is why it works
                                // on Claude Desktop where UIA can't read the composer.
                                int len = TypedLength();
                                if (len >= 1) { Emit("prompt", _app, "", "send", len); }
                                TypedClear(); _blockTyped = false; _typedPatterns = "";
                            }
                        }
                        else if (vk == VK_ESCAPE)
                        {
                            TypedClear(); _blockTyped = false; _typedPatterns = "";
                        }
                        else if (vk == VK_BACK)
                        {
                            TypedBackspace();
                            _typedDirty = true;   // poll thread rescans; no regex here
                        }
                        else if (!ctrl && !alt)
                        {
                            // Accumulate printable characters (ignore Ctrl/Alt combos
                            // like Ctrl+A/Ctrl+C so they don't pollute the buffer).
                            char c = MapKey(vk, shift, caps);
                            if (c != '\0')
                            {
                                TypedAppend(c);
                                _typedDirty = true;   // poll thread rescans; no regex here
                            }
                        }
                    }
                }
            }
        }
        catch { }
        return CallNextHookEx(_hook, nCode, wParam, lParam);
    }

    // Scans the typed buffer and publishes the verdict. MUST only ever be
    // called from the poll thread — it is the expensive half of what used to
    // run inline in the keyboard hook on every single keystroke.
    static void Rescan()
    {
        int gen;
        string tail = TypedTail(out gen);
        // Scan OUTSIDE the lock — the hook thread must never wait on a regex.
        string hits = ScanNames(tail);
        lock (_typedLock)
        {
            // Buffer was cleared (send / Escape / focus change) while we were
            // scanning: the verdict describes text that is already gone.
            if (gen != _typedGen) return;
            bool wasBlocked = _blockTyped;
            _typedPatterns = hits;
            _blockTyped = hits.Length > 0;
            if (_blockTyped) _typedBlockTicks = DateTime.UtcNow.Ticks;
            // Fix: a rescan that finds the buffer clean after the user edited
            // out the flagged text must also release the 30s cooldown, or
            // "delete the secret and press Enter" still gets swallowed for up
            // to 30s — the ONLY remediation path a non-rewritable block has.
            else if (wasBlocked) _lastBlockFiredTicks = 0;
        }
    }

    // Manual VK -> char mapping for the charset our secret patterns use:
    // A-Za-z0-9, space, '-', '_', '.', '/'. Layout-agnostic for letters/digits;
    // good enough for detection without ToUnicode reentrancy concerns.
    static char MapKey(int vk, bool shift, bool caps)
    {
        if (vk >= 0x41 && vk <= 0x5A)
        {
            char b = (char)('a' + (vk - 0x41));
            bool upper = shift ^ caps;
            return upper ? (char)(b - 32) : b;
        }
        if (vk >= 0x30 && vk <= 0x39) { return shift ? '\0' : (char)('0' + (vk - 0x30)); }
        if (vk >= 0x60 && vk <= 0x69) { return (char)('0' + (vk - 0x60)); }  // numpad
        if (vk == 0xBD) return shift ? '_' : '-';   // OEM_MINUS
        if (vk == 0xBE) return '.';                  // OEM_PERIOD
        if (vk == 0x6E) return '.';                  // VK_DECIMAL
        if (vk == 0x6F) return '/';                  // VK_DIVIDE
        if (vk == 0xBF) return shift ? '?' : '/';    // OEM_2
        if (vk == 0x20) return ' ';                  // space
        return '\0';
    }

    static void PollLoop()
    {
        while (true)
        {
            // UpdateModelRouting is last and returns in one line when the
            // feature is off (the default) — zero added latency for every
            // user who hasn't enabled it. See its own comment for why the
            // expensive part of what it does runs on a separate thread.
            try { UpdateForeground(); UpdateBlockedAgents(); UpdatePaste(); UpdateUia(); UpdateSendRect(); UpdatePendingRewrite(); CheckHeartbeat(); CheckAttachHoldExpiry(); UpdateModelRouting(); }
            catch { }
            // The 150ms cadence above is unchanged; inside it we look at the
            // typed-buffer dirty flag every 30ms so the verdict trails the last
            // keystroke by ~30ms instead of being computed on the hook thread.
            // ALL regex work for typed text happens here, on this thread.
            for (int i = 0; i < 5; i++)
            {
                if (_typedDirty)
                {
                    _typedDirty = false;
                    try { Rescan(); } catch { }
                }
                Thread.Sleep(30);
            }
        }
    }

    // Deadman switch. The Node monitor rewrites _heartbeatFile every 5s while
    // it is healthy. The PID watchdog on the Node side cannot see a HUNG parent
    // (process.kill(pid, 0) succeeds for a wedged process just as it does for a
    // healthy one), so the helper also polices its own parent: no fresh
    // heartbeat for 30s and we release the keyboard hook and exit rather than
    // keep swallowing keys on behalf of something that can no longer be told to
    // stop. Disabled when the path is empty (manual debugging run).
    // Auto-release safety net: if Node crashes or hangs after arming a hold
    // (provisional or confirmed) and stops refreshing/releasing it, this
    // guarantees Enter is never left permanently dead. Checked every poll
    // tick — cheap (one volatile read + one comparison) when inactive.
    static void CheckAttachHoldExpiry()
    {
        if (!_attachHoldActive) return;
        if (DateTime.UtcNow.Ticks > _attachHoldExpiresAt)
        {
            _attachHoldActive = false;
            _attachHoldFilename = ""; _attachHoldPatterns = "";
        }
    }

    static void CheckHeartbeat()
    {
        if (string.IsNullOrEmpty(_heartbeatFile)) return;
        long now = DateTime.UtcNow.Ticks;
        if (now - _lastHeartbeatCheck < HEARTBEAT_CHECK_INTERVAL) return;
        _lastHeartbeatCheck = now;

        DateTime beat;
        try
        {
            if (!System.IO.File.Exists(_heartbeatFile))
            {
                // Missing file only counts as dead once we're past the staleness
                // window from startup, so a spawn-time race can't kill us.
                if ((now - _startTicks) > HEARTBEAT_MAX_STALE) Shutdown("parent heartbeat file missing");
                return;
            }
            string raw = System.IO.File.ReadAllText(_heartbeatFile).Trim();
            long ms;
            if (long.TryParse(raw, out ms))
                beat = new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc).AddMilliseconds(ms);
            else
                beat = System.IO.File.GetLastWriteTimeUtc(_heartbeatFile);
        }
        catch { return; }   // transient read error (caught mid-write) — retry next tick

        if ((DateTime.UtcNow - beat).Ticks > HEARTBEAT_MAX_STALE) Shutdown("parent heartbeat stale");
    }

    // Release the hooks and quit. Unhooking explicitly (rather than relying on
    // process teardown) is what guarantees the user's keyboard is normal again
    // the instant we decide to stop.
    static void Shutdown(string why)
    {
        try { if (_hook != IntPtr.Zero) { UnhookWindowsHookEx(_hook); _hook = IntPtr.Zero; } } catch { }
        try { if (_mouseHook != IntPtr.Zero) { UnhookWindowsHookEx(_mouseHook); _mouseHook = IntPtr.Zero; } } catch { }
        try { Emit("error", "", "", "deadman", -1, -1, "released keyboard hook: " + why); } catch { }
        Environment.Exit(0);
    }

    // Read blocked-agents.json and check if the foreground process matches
    // a blocked platform. Updated every 10s (file I/O is cheap).
    static List<Dictionary<string, string>> _blockedList = new List<Dictionary<string, string>>();

    static void UpdateBlockedAgents()
    {
        // Only re-read the file every 10s
        long now = DateTime.UtcNow.Ticks;
        if (now - _lastBlockedCheck < BLOCKED_CHECK_INTERVAL) {
            // Just re-check foreground against cached list
            CheckFgBlocked();
            return;
        }
        _lastBlockedCheck = now;
        try {
            if (!System.IO.File.Exists(_blockedAgentFile)) { _blockedList.Clear(); _fgIsBlocked = false; return; }
            string json = System.IO.File.ReadAllText(_blockedAgentFile);
            // Minimal JSON parse — extract platform and agent_name fields
            var list = new List<Dictionary<string, string>>();
            // Simple parse: the file is an array of {agent_id, agent_name, platform, reason}
            json = json.Trim();
            if (json.StartsWith("[")) {
                // Split by },{ pattern
                foreach (string item in SplitJsonArray(json)) {
                    var d = new Dictionary<string, string>();
                    d["platform"] = ExtractJsonString(item, "platform");
                    d["agent_name"] = ExtractJsonString(item, "agent_name");
                    d["reason"] = ExtractJsonString(item, "reason");
                    if (!string.IsNullOrEmpty(d["platform"])) list.Add(d);
                }
            }
            _blockedList = list;
        } catch { }
        CheckFgBlocked();
    }

    static void CheckFgBlocked()
    {
        if (!_fgIsAi || _blockedList.Count == 0) { _fgIsBlocked = false; return; }
        foreach (var agent in _blockedList) {
            HashSet<string> procs;
            if (PLATFORM_PROCS.TryGetValue(agent["platform"], out procs)) {
                if (procs.Contains(_app)) {
                    _fgIsBlocked = true;
                    _blockedReason = "Blocked agent: " + (agent["agent_name"] ?? agent["platform"]);
                    return;
                }
            }
        }
        _fgIsBlocked = false;
    }

    static string ExtractJsonString(string json, string key)
    {
        string search = "\"" + key + "\":\"";
        int i = json.IndexOf(search, StringComparison.OrdinalIgnoreCase);
        if (i < 0) return "";
        int start = i + search.Length;
        int end = json.IndexOf("\"", start);
        if (end < 0) return "";
        return json.Substring(start, end - start);
    }

    // Bare (unquoted) numeric field, e.g. "ttl_ms":60000 — ExtractJsonString
    // only handles quoted string values. Returns fallback on anything
    // malformed or missing rather than throwing, since a bad/attacker-
    // influenced ttl_ms must never take the parent process down.
    static long ExtractJsonNumber(string json, string key, long fallback)
    {
        string search = "\"" + key + "\":";
        int i = json.IndexOf(search, StringComparison.OrdinalIgnoreCase);
        if (i < 0) return fallback;
        int start = i + search.Length;
        int end = start;
        if (end < json.Length && (json[end] == '-')) end++;
        while (end < json.Length && char.IsDigit(json[end])) end++;
        long val;
        if (end > start && long.TryParse(json.Substring(start, end - start), out val)) return val;
        return fallback;
    }

    static List<string> SplitJsonArray(string json)
    {
        var items = new List<string>();
        int depth = 0; int start = -1;
        for (int i = 0; i < json.Length; i++) {
            if (json[i] == '{') { if (depth == 0) start = i; depth++; }
            else if (json[i] == '}') { depth--; if (depth == 0 && start >= 0) { items.Add(json.Substring(start, i - start + 1)); start = -1; } }
        }
        return items;
    }

    static string ProcName(uint pid)
    {
        try { using (Process p = Process.GetProcessById((int)pid)) return p.ProcessName; }
        catch { return null; }
    }

    static void UpdateForeground()
    {
        IntPtr fg = GetForegroundWindow();
        if (fg == IntPtr.Zero) return; // don't change state on null window
        uint pid; GetWindowThreadProcessId(fg, out pid);
        string proc = ProcName(pid);
        _fgPid = pid;
        if (proc != null && _aiProcs.Contains(proc))
        {
            _fgIsAi = true;
            _app = proc;
            _fgLeftAiTicks = 0; // reset sticky timer
        }
        else
        {
            // Focus left the AI app — start sticky timer instead of
            // immediately clearing. This prevents toast notifications
            // from creating a bypass window.
            if (_fgIsAi && _fgLeftAiTicks == 0)
            {
                _fgLeftAiTicks = DateTime.UtcNow.Ticks;
            }
            // Only clear after the sticky TTL expires
            if (_fgLeftAiTicks > 0 && (DateTime.UtcNow.Ticks - _fgLeftAiTicks) > FG_STICKY_TTL)
            {
                _fgIsAi = false;
                _fgLeftAiTicks = 0;
            }
            // During the sticky window, _fgIsAi stays true
        }
    }

    // When a block is active, locate the send button so the mouse hook can
    // swallow clicks on it.  Strategy:
    //   1. Try UIA — look for a Button/Custom/Image with a send-related label.
    //   2. Fallback — Electron/Chromium apps don't expose DOM buttons to UIA,
    //      so use a heuristic: the bottom-right 120x80 px of the window is
    //      where every AI chat app puts its send button.
    // Cleared when no block is active so normal clicks are never swallowed.
    static void UpdateSendRect()
    {
        // Locate the send button when a block is active (to swallow the click)
        // OR when there's a pending typed prompt (to capture a benign click-send).
        // Cleared otherwise so normal clicks are never swallowed or captured.
        if (!_fgIsAi || (!BlockActiveForMouse() && TypedLength() < 1)) { _hasRect = false; return; }
        try
        {
            IntPtr fg = GetForegroundWindow();
            if (fg == IntPtr.Zero) { _hasRect = false; return; }

            // --- Attempt 1: UIA button search ---
            try
            {
                AutomationElement win = AutomationElement.FromHandle(fg);
                if (win != null)
                {
                    var cond = new OrCondition(
                        new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Button),
                        new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Custom)
                    );
                    AutomationElementCollection btns = win.FindAll(TreeScope.Descendants, cond);
                    foreach (AutomationElement b in btns)
                    {
                        string name = "", aid = "", help = "";
                        try { name = b.Current.Name ?? ""; } catch { }
                        try { aid = b.Current.AutomationId ?? ""; } catch { }
                        try { help = b.Current.HelpText ?? ""; } catch { }
                        string hay = (name + " " + aid + " " + help).ToLowerInvariant();
                        if (hay.Contains("send") || hay.Contains("submit"))
                        {
                            System.Windows.Rect r = b.Current.BoundingRectangle;
                            if (!r.IsEmpty && r.Width > 0 && r.Height > 0)
                            {
                                _rx = (int)r.Left; _ry = (int)r.Top;
                                _rw = (int)r.Width; _rh = (int)r.Height;
                                _hasRect = true;
                                return;
                            }
                        }
                    }
                }
            }
            catch { /* UIA failed — fall through to heuristic */ }

            // --- Attempt 2: heuristic bottom-right zone ---
            // Every major AI chat app (Claude, ChatGPT, Gemini, Cursor,
            // Copilot) places the send button in the bottom-right corner
            // of the window, inside the composer area.  Block a generous
            // zone there.  This is the ONLY way to catch send-button
            // clicks in Electron apps where UIA sees the whole web view
            // as one opaque element.
            RECT wr;
            if (GetWindowRect(fg, out wr))
            {
                int winW = wr.Right - wr.Left;
                int winH = wr.Bottom - wr.Top;
                // Bottom-right zone: 150px wide, 100px tall from the
                // bottom-right corner, offset 10px from the edge.
                _rx = wr.Right - 160;
                _ry = wr.Bottom - 110;
                _rw = 150;
                _rh = 100;
                _hasRect = true;
                return;
            }
            _hasRect = false;
        }
        catch { _hasRect = false; }
    }

    static void UpdateUia()
    {
        if (!_fgIsAi) { _blockUia = false; return; }
        string text = null;
        try
        {
            AutomationElement el = AutomationElement.FocusedElement;
            if (el != null) text = ReadText(el);
        }
        catch { }
        string hits = (text != null) ? ScanNames(text) : "";
        _uiaPatterns = hits;
        _blockUia = hits.Length > 0;
    }

    // Recomputes the pinned rewrite candidate from the ACTUAL composer text
    // (UIA), never the keystroke buffer — the buffer drops commas, shifted
    // symbols, pasted text and multi-line content, so it is a fine detector
    // but would silently corrupt a rewrite. Runs on the poll thread, same as
    // every other UIA/regex path; the hook thread only ever reads the result.
    static void UpdatePendingRewrite()
    {
        if (!_fgIsAi || _ideApps.Contains(_app) || Disarmed())
        {
            lock (_pendingLock) { _pendingRewritable = false; _pendingBlockId = ""; }
            return;
        }
        AutomationElement el;
        try { el = AutomationElement.FocusedElement; } catch { el = null; }
        if (el == null)
        {
            // A transient UIA read failure, not a confirmed content change —
            // reading another process's accessibility tree every ~150ms
            // occasionally hiccups on its own, with no relation to whether
            // the actual composer text changed. Confirmed live against
            // Claude Desktop: a single bad tick between block-fire and the
            // user clicking Tokenize wiped _pendingBlockId out from under a
            // dialog that was still showing the old (still valid) id —
            // StartRewrite then silently no-ops on the id mismatch, with
            // zero emitted feedback. Leave a still-unexpired candidate as-is
            // and let the next successful read (or the TTL) resolve it.
            lock (_pendingLock)
            {
                if (!_pendingRewritable || DateTime.UtcNow.Ticks > _pendingExpiresAt)
                { _pendingRewritable = false; _pendingWhyNot = "no_focused_element"; _pendingBlockId = ""; }
            }
            return;
        }
        string text = null;
        try { text = ReadText(el); } catch { }
        if (string.IsNullOrEmpty(text))
        {
            // Same transient-failure reasoning as above.
            lock (_pendingLock)
            {
                if (!_pendingRewritable || DateTime.UtcNow.Ticks > _pendingExpiresAt)
                { _pendingRewritable = false; _pendingWhyNot = "empty_read"; _pendingBlockId = ""; }
            }
            return;
        }
        var mask = ComputeMaskCandidate(text);
        int[] rid = null;
        try { rid = el.GetRuntimeId(); } catch { }
        IntPtr fg = GetForegroundWindow();
        lock (_pendingLock)
        {
            _pendingReadLen = text.Length;
            int labeled = 0;
            foreach (var p in _patInfos) if (!string.IsNullOrEmpty(p.Label)) labeled++;
            _pendingLabeledPatterns = labeled;
            if (mask.Ok && rid != null)
            {
                // Reuse the existing block_id when the underlying text hasn't
                // actually changed, instead of always minting a fresh one.
                // Confirmed live: this ran every ~150ms unconditionally, so a
                // dialog built from the FIRST id was already stale by the
                // time a human read it and clicked Tokenize a few seconds
                // later — StartRewrite silently no-ops on an id mismatch,
                // which looked exactly like a permanently stuck "Masking…"
                // button with no error at all.
                // NormalizeWs, not exact ==: confirmed live against Claude
                // Desktop, a React-rendered composer can reflow the read-back
                // text (whitespace-only) between two polls of the SAME
                // underlying prompt with nothing the user did in between.
                // Exact string equality treated that as "the prompt changed"
                // and rotated block_id out from under a dialog that was
                // still showing the previous (still-correct) one — the same
                // "StartRewrite silently no-ops on an id mismatch" failure
                // mode this whole samePrompt check exists to prevent, just
                // reached through a different door.
                bool samePrompt = _pendingRewritable && NormalizeWs(_pendingOriginalFull) == NormalizeWs(text);
                if (!samePrompt) _pendingBlockId = Guid.NewGuid().ToString("N");
                _pendingRewritable = true;
                _pendingWhyNot = "";
                _pendingOriginalFull = text;
                _pendingMaskedFull = mask.Masked;
                _pendingPreview = mask.Masked.Length > 300 ? mask.Masked.Substring(0, 300) : mask.Masked;
                _pendingRuntimeId = rid;
                _pendingHwnd = fg;
                _pendingPid = _fgPid;
                _pendingExpiresAt = DateTime.UtcNow.Ticks + REWRITE_TTL;
            }
            else
            {
                _pendingRewritable = false;
                _pendingWhyNot = mask.Ok ? "no_runtime_id" : mask.Reason;
                _pendingBlockId = "";
            }
        }
    }

    static string _pastePatternsValue = "";
    static string _pastePatterns() { return _pastePatternsValue; }

    static void UpdatePaste()
    {
        if (!_fgIsAi) { _blockPaste = false; return; }
        string clip = ReadClipboard();
        string hits = (clip != null) ? ScanNames(clip) : "";
        _pastePatternsValue = hits;
        _blockPaste = hits.Length > 0;
    }

    // Some UIA text providers (confirmed live: Windows 11 Notepad's
    // TextPattern) always include a final line terminator even for
    // single-line content — without trimming it, ComputeMaskCandidate's
    // multiline check would reject every single-line prompt, not just
    // genuinely multi-line ones. Trim ONLY a trailing terminator, never an
    // embedded one — that preserves the real multiline signal.
    static string ReadText(AutomationElement el)
    {
        try
        {
            object vp;
            if (el.TryGetCurrentPattern(ValuePattern.Pattern, out vp))
            {
                string v = ((ValuePattern)vp).Current.Value;
                if (!string.IsNullOrEmpty(v)) return v.TrimEnd('\r', '\n');
            }
        }
        catch { }
        try
        {
            object tp;
            if (el.TryGetCurrentPattern(TextPattern.Pattern, out tp))
            {
                string t = ((TextPattern)tp).DocumentRange.GetText(16000);
                if (!string.IsNullOrEmpty(t)) return t.TrimEnd('\r', '\n');
            }
        }
        catch { }
        return null;
    }

    static string ReadClipboard()
    {
        // System.Windows.Forms.Clipboard requires STA; the poll thread is MTA,
        // so marshal the read onto a short-lived STA thread.
        string result = null;
        var t = new Thread(() =>
        {
            try
            {
                if (System.Windows.Forms.Clipboard.ContainsText())
                    result = System.Windows.Forms.Clipboard.GetText();
            }
            catch { }
        });
        t.SetApartmentState(ApartmentState.STA);
        t.Start();
        t.Join(200);
        return result;
    }

    static string ScanNames(string text)
    {
        if (string.IsNullOrEmpty(text) || text.Length < 4) return "";
        var hits = new List<string>();
        foreach (var p in _patInfos)
        {
            try { if (p.Rx.IsMatch(text)) hits.Add(p.Name); }
            catch (RegexMatchTimeoutException)
            {
                // Fail open for THIS RULE ONLY — the remaining rules still run,
                // so one pathological pattern can't silently disable the whole
                // scan (and with it every block decision).
                NoteRegexTimeout(p.Name);
            }
            catch { }
        }
        return string.Join(",", hits.ToArray());
    }

    // ── Tier B masking ───────────────────────────────────────────────────────
    // Fixed-label, one-way masking — mirrors the browser extension's redact()
    // (browser-extension/content/patterns.js): collect every match span,
    // merge overlapping spans into one region (never drop the loser — a
    // dropped overlap is exactly how a card's tail digits used to survive
    // behind a winning SSN label), splice once. Guardrail patterns (no Label)
    // are never candidates for masking — see PatInfo above.
    class MaskSpan { public int Start; public int End; public string Pattern; public string Label; public int SevRank; }
    class MaskRegion { public int Start; public int End; public string Label; }
    class MaskResult { public bool Ok; public string Masked; public string Reason; }

    static List<MaskSpan> CollectMaskSpans(string text)
    {
        var spans = new List<MaskSpan>();
        foreach (var p in _patInfos)
        {
            if (string.IsNullOrEmpty(p.Label)) continue;
            MatchCollection ms;
            try { ms = p.Rx.Matches(text); }
            catch (RegexMatchTimeoutException) { NoteRegexTimeout(p.Name); continue; }
            catch { continue; }
            foreach (Match m in ms)
            {
                if (m.Length == 0) continue;
                spans.Add(new MaskSpan { Start = m.Index, End = m.Index + m.Length, Pattern = p.Name, Label = p.Label, SevRank = p.SevRank });
            }
        }
        return spans;
    }

    static int CompareSpanPrecedence(MaskSpan a, MaskSpan b)
    {
        if (a.SevRank != b.SevRank) return b.SevRank - a.SevRank;           // severity desc
        int la = a.End - a.Start, lb = b.End - b.Start;
        if (la != lb) return lb - la;                                      // longest span wins
        if (a.Start != b.Start) return a.Start - b.Start;                  // earliest start
        return string.CompareOrdinal(a.Pattern, b.Pattern);
    }

    static List<MaskRegion> ResolveMaskRegions(List<MaskSpan> spans)
    {
        var regions = new List<MaskRegion>();
        if (spans.Count == 0) return regions;
        spans.Sort((a, b) => {
            int c = a.Start - b.Start; if (c != 0) return c;
            c = a.End - b.End; if (c != 0) return c;
            return string.CompareOrdinal(a.Pattern, b.Pattern);
        });
        var cluster = new List<MaskSpan> { spans[0] };
        int clusterEnd = spans[0].End;
        for (int i = 1; i < spans.Count; i++)
        {
            var s = spans[i];
            if (s.Start < clusterEnd)
            {
                cluster.Add(s);
                if (s.End > clusterEnd) clusterEnd = s.End;
            }
            else
            {
                regions.Add(FlushMaskCluster(cluster, clusterEnd));
                cluster = new List<MaskSpan> { s };
                clusterEnd = s.End;
            }
        }
        regions.Add(FlushMaskCluster(cluster, clusterEnd));
        return regions;
    }

    static MaskRegion FlushMaskCluster(List<MaskSpan> cluster, int clusterEnd)
    {
        MaskSpan winner = cluster[0];
        for (int i = 1; i < cluster.Count; i++) if (CompareSpanPrecedence(cluster[i], winner) < 0) winner = cluster[i];
        return new MaskRegion { Start = cluster[0].Start, End = clusterEnd, Label = winner.Label };
    }

    static string SpliceMaskRegions(string text, List<MaskRegion> regions)
    {
        if (regions.Count == 0) return text;
        var sb = new StringBuilder();
        int cursor = 0;
        foreach (var r in regions)
        {
            if (r.Start > cursor) sb.Append(text, cursor, r.Start - cursor);
            sb.Append(r.Label);
            cursor = r.End;
        }
        if (cursor < text.Length) sb.Append(text, cursor, text.Length - cursor);
        return sb.ToString();
    }

    // Fail-closed at every step: no maskable span, no rewrite offered; masked
    // output identical to input, no rewrite offered; masked output still
    // matching ANY active pattern on a full rescan, no rewrite offered. A
    // read failure or empty text can never be mistaken for "safe to write" —
    // only an explicit Ok=true is.
    static MaskResult ComputeMaskCandidate(string text)
    {
        var result = new MaskResult { Ok = false, Masked = text, Reason = "" };
        if (string.IsNullOrEmpty(text)) { result.Reason = "empty"; return result; }
        if (text.IndexOf('\n') >= 0 || text.IndexOf('\r') >= 0) { result.Reason = "multiline"; return result; }
        if (text.Length > REWRITE_MAX_CHARS) { result.Reason = "too_long"; return result; }

        var spans = CollectMaskSpans(text);
        if (spans.Count == 0) { result.Reason = "nothing_to_mask"; return result; }
        var regions = ResolveMaskRegions(spans);

        // No fraction-of-text ceiling here (deliberately removed after live
        // testing): the catalog's patterns are specific value-shapes (an
        // AKIA-prefixed key, an sk-proj- key, ...), not broad wildcards, so
        // the only way one legitimately matches nearly all of a short message
        // is that the message basically IS the secret — e.g. pasting just an
        // API key with nothing else, the single most common real case. That
        // is indistinguishable from a hypothetical hostile ".+"-style pattern
        // by fraction alone, so fraction was never actually discriminating
        // between them; a genuinely overbroad server-pushed pattern is better
        // caught by reviewing the pattern itself than by refusing every
        // legitimate whole-secret paste.

        string masked = SpliceMaskRegions(text, regions);
        if (masked == text) { result.Reason = "masked_equals_original"; return result; }

        string residual = ScanNames(masked);
        if (residual.Length > 0) { result.Reason = "residual_match"; return result; }

        result.Ok = true; result.Masked = masked;
        return result;
    }

    // Report a timed-out rule by NAME only. The scanned text is never emitted,
    // logged, or persisted anywhere — it is the user's prompt.
    static void NoteRegexTimeout(string rule)
    {
        long now = DateTime.UtcNow.Ticks;
        lock (_timeoutEmitAt)
        {
            long last;
            if (_timeoutEmitAt.TryGetValue(rule, out last) && (now - last) < TIMEOUT_EMIT_THROTTLE) return;
            _timeoutEmitAt[rule] = now;
        }
        Emit("error", "", "", "regex_timeout", -1, -1, "regex match timeout — rule skipped: " + rule);
    }

    static void Emit(string kind, string app, string patterns, string reason, int len = -1, int seconds = -1, string message = null)
    {
        string json = "{\"kind\":\"" + kind + "\""
            + (reason.Length > 0 ? ",\"reason\":\"" + Esc(reason) + "\"" : "")
            + (app.Length > 0 ? ",\"process\":\"" + Esc(app) + "\"" : "")
            + (patterns.Length > 0 ? ",\"patterns\":\"" + Esc(patterns) + "\"" : "")
            + (len >= 0 ? ",\"len\":" + len : "")
            + (seconds >= 0 ? ",\"seconds\":" + seconds : "")
            + (message != null ? ",\"message\":\"" + Esc(message) + "\"" : "")
            + "}";
        lock (_emitLock) { Console.Out.WriteLine(json); Console.Out.Flush(); }
    }

    static string Esc(string s) { return s.Replace("\\", "\\\\").Replace("\"", "\\\""); }

    // Extended "block" event carrying the Tier B rewrite offer, if any. Reads
    // the pending state the poll thread already prepared — no new UIA/regex
    // work happens here, this runs on the hook/mouse thread.
    static void EmitBlock(string app, string patterns, string reason)
    {
        string blockId, preview, whyNot;
        bool rewritable;
        lock (_pendingLock)
        {
            blockId = _pendingBlockId;
            rewritable = _pendingRewritable && blockId.Length > 0;
            preview = _pendingPreview;
            whyNot = _pendingWhyNot;
        }
        // An attachment hold is never rewritable — Tokenize & Send only ever
        // masks TEXT, never removes a file. _pendingRewritable/_pendingBlockId
        // are a fully independent pin (the composer TEXT might separately be
        // maskable), so without this override a dialog could offer "Tokenize &
        // Send" for text while the actual thing holding the send is the
        // attached file — masking the text would do nothing to unblock it.
        if (reason == "attachment") { rewritable = false; blockId = ""; }
        string json = "{\"kind\":\"block\""
            + ",\"reason\":\"" + Esc(reason) + "\""
            + (app.Length > 0 ? ",\"process\":\"" + Esc(app) + "\"" : "")
            + (patterns.Length > 0 ? ",\"patterns\":\"" + Esc(patterns) + "\"" : "")
            + ",\"block_id\":\"" + Esc(blockId) + "\""
            + ",\"rewritable\":" + (rewritable ? "true" : "false")
            + (rewritable ? ",\"preview\":\"" + Esc(preview) + "\"" : (whyNot.Length > 0 ? ",\"why_not\":\"" + Esc(whyNot) + "\"" : ""))
            + (reason == "attachment" ? ",\"filename\":\"" + Esc(_attachHoldFilename) + "\"" : "")
            + "}";
        lock (_emitLock) { Console.Out.WriteLine(json); Console.Out.Flush(); }
    }

    static void EmitRewrite(string blockId, string result, string reason)
    {
        string json = "{\"kind\":\"rewrite\""
            + ",\"block_id\":\"" + Esc(blockId ?? "") + "\""
            + ",\"result\":\"" + Esc(result) + "\""
            + (!string.IsNullOrEmpty(reason) ? ",\"reason\":\"" + Esc(reason) + "\"" : "")
            + "}";
        lock (_emitLock) { Console.Out.WriteLine(json); Console.Out.Flush(); }
    }

    // ── Tier B rewrite ────────────────────────────────────────────────────────
    // Triggered by the confirm hotkey (Ctrl+Alt+T) within the pending block's
    // TTL. Never reachable any other way: no general "type this text" verb
    // exists anywhere in this file. Spawns a dedicated STA thread (needed for
    // UIA) so the hook thread returns immediately.
    static bool RuntimeIdEquals(int[] a, int[] b)
    {
        if (a == null || b == null) return false;
        if (a.Length != b.Length) return false;
        for (int i = 0; i < a.Length; i++) if (a[i] != b[i]) return false;
        return true;
    }

    // Rich editors legitimately reflow whitespace on read-back (same allowance
    // the browser extension's redact() makes) — normalize before comparing.
    static string NormalizeWs(string s)
    {
        if (s == null) return "";
        return Regex.Replace(s.Trim(), "\\s+", " ");
    }

    static void StartRewrite(string blockId)
    {
        // Every rejection here is reported, never silently dropped — a
        // dialog that got no response at all (stuck on "Masking…" until its
        // own 16s client-side timeout) was indistinguishable from "nothing
        // happened" and impossible to diagnose from the outside. A wrong or
        // late click still gets a real answer.
        if (_rewriteInProgress) { EmitRewrite(blockId, "aborted", "rewrite_already_in_progress"); return; }
        if (_routeInProgress) { EmitRewrite(blockId, "aborted", "route_in_progress"); return; }
        if (string.IsNullOrEmpty(blockId)) return;
        string original, masked; int[] rid; IntPtr hwnd; uint pid; long expiresAt;
        lock (_pendingLock)
        {
            if (_pendingBlockId != blockId || !_pendingRewritable)
            { EmitRewrite(blockId, "aborted", "stale_block_id"); return; }
            original = _pendingOriginalFull; masked = _pendingMaskedFull;
            rid = _pendingRuntimeId; hwnd = _pendingHwnd; pid = _pendingPid; expiresAt = _pendingExpiresAt;
        }
        if (DateTime.UtcNow.Ticks > expiresAt) { EmitRewrite(blockId, "failed", "expired"); return; }

        _rewriteInProgress = true;
        _rewriteAbort = false;
        var t = new Thread(() => RunRewrite(blockId, original, masked, rid, hwnd, pid));
        t.IsBackground = true;
        t.SetApartmentState(ApartmentState.STA);
        t.Start();
    }

    static void RunRewrite(string blockId, string original, string masked, int[] pinnedRid, IntPtr pinnedHwnd, uint pinnedPid)
    {
        try
        {
            // Pre-flight: everything pinned at block time must still hold.
            if (GetForegroundWindow() != pinnedHwnd) { EmitRewrite(blockId, "aborted", "focus_changed"); return; }
            AutomationElement el;
            try { el = AutomationElement.FocusedElement; } catch { el = null; }
            if (el == null) { EmitRewrite(blockId, "aborted", "no_focused_element"); return; }
            int[] curRid = null;
            try { curRid = el.GetRuntimeId(); } catch { }
            if (!RuntimeIdEquals(curRid, pinnedRid)) { EmitRewrite(blockId, "aborted", "element_changed"); return; }
            string curText = null;
            try { curText = ReadText(el); } catch { }
            if (NormalizeWs(curText) != NormalizeWs(original)) { EmitRewrite(blockId, "aborted", "text_changed"); return; }

            // The user may still be holding Ctrl+Alt (from the confirm
            // hotkey) or Enter (from the block itself) — wait briefly for a
            // clean keyboard state before synthesizing anything.
            long waitStart = DateTime.UtcNow.Ticks;
            while (Down(VK_CONTROL) || Down(VK_MENU) || Down(VK_SHIFT) || Down(VK_RETURN))
            {
                // A real 3-key combo can plausibly stay physically held for
                // over half a second — 500ms was too tight and aborted valid
                // presses. 2.5s is still well inside the 15s pin TTL.
                if ((DateTime.UtcNow.Ticks - waitStart) > TimeSpan.FromMilliseconds(2500).Ticks)
                { EmitRewrite(blockId, "aborted", "modifiers_stuck"); return; }
                Thread.Sleep(20);
            }

            SendKeyCombo(VK_CONTROL, VK_A);
            Thread.Sleep(30);
            SendKeyPress(VK_DELETE);
            Thread.Sleep(30);

            long budgetEnd = DateTime.UtcNow.Ticks + REWRITE_WRITE_BUDGET;
            for (int i = 0; i < masked.Length; i += REWRITE_CHUNK)
            {
                if (_rewriteAbort || DateTime.UtcNow.Ticks > budgetEnd || GetForegroundWindow() != pinnedHwnd)
                { EmitRewrite(blockId, "aborted", "interrupted_mid_write"); return; }
                int len = Math.Min(REWRITE_CHUNK, masked.Length - i);
                SendUnicodeChunk(masked.Substring(i, len));
                Thread.Sleep(10);
            }

            // Verify by positive identification, not absence: the read-back
            // must come from the SAME element and match the masked text
            // exactly, AND a full rescan of it must find nothing. A failed or
            // empty read can never be mistaken for success here.
            //
            // Polled rather than a single fixed-delay read: confirmed live
            // that a one-shot read at +60ms can catch the composer mid-write
            // (missing its last couple of characters) even though the write
            // completes correctly a moment later — that raced false negative
            // left a perfectly good rewrite reported as "failed". Polling up
            // to 400ms only ever helps a genuinely successful write catch up;
            // a truly wrong result stays wrong for the whole window and is
            // still reported as failed.
            // Read-before-sleep, not sleep-before-read: by the time the last
            // chunk's own 10ms settle has passed, the composer has usually
            // already caught up, so checking immediately closes the dialog
            // that much sooner in the common case. The 400ms deadline and
            // polling behavior for the slow case are unchanged.
            string after = null;
            bool matches = false, clean = false;
            long verifyDeadline = DateTime.UtcNow.Ticks + TimeSpan.FromMilliseconds(400).Ticks;
            do
            {
                try { after = ReadText(el); } catch { }
                matches = NormalizeWs(after) == NormalizeWs(masked);
                clean = string.IsNullOrEmpty(ScanNames(after ?? ""));
                if (matches && clean) break;
                Thread.Sleep(40);
            } while (DateTime.UtcNow.Ticks < verifyDeadline);
            if (!matches || !clean) { EmitRewrite(blockId, "failed", "verify_mismatch"); return; }

            // Verified clean — the composer holds exactly the masked text we
            // confirmed by reading it back, nothing else. Auto-send (explicit
            // user decision, not the original default): only ever fires after
            // that positive verification, never on an unverified write.
            //
            // Settle delay before Enter. Many chat composers (confirmed live
            // against Claude Desktop) update their own "is there something to
            // send" state asynchronously after the last keystroke — sending
            // Enter immediately after the verify read can arrive before that
            // internal state has caught up to the text we just confirmed is
            // there, so the app never treats it as a submit. 150ms was
            // sometimes not enough (confirmed live: masked text left sitting
            // in the composer, unsent, while this method still reported
            // "ok"); 300ms leaves more margin.
            Thread.Sleep(300);

            // Pin check closest to the actual send — if focus moved during
            // verify or the settle delay, do not send Enter into whatever is
            // there now.
            if (GetForegroundWindow() != pinnedHwnd) { EmitRewrite(blockId, "failed", "focus_changed_before_send"); return; }

            // Release the block state BEFORE sending Enter — our own
            // synthetic Enter passes back through this same keyboard hook
            // (WH_KEYBOARD_LL sees all input, including our own), so if the
            // block were still armed at that moment the hook would swallow
            // its own auto-send. Preserve the usage/attribution length
            // telemetry that clearing the buffer would otherwise lose.
            //
            // _blockUia also has to be cleared here, not just the typed-buffer
            // state: it's set independently by UpdateUia() on the poll thread,
            // which samples the focused element's text on its own ~150ms
            // cadence with no knowledge of our Ctrl+A/Delete/retype sequence.
            // If a poll tick lands mid-sequence — after Ctrl+A+Delete cleared
            // the field but before the masked text was fully retyped, or on
            // the still-unmasked original — it latches _blockUia=true and
            // nothing else in this method resets it, so our own auto-send
            // Enter gets swallowed by the same hook as a fresh block.
            // _blockPaste/_lastPasteTicks are a THIRD independent latch,
            // separate from both the typed buffer and _blockUia: if the
            // original secret was pasted (common for API/access keys, unlike
            // a hand-typed SSN) rather than typed, clipBlock stays true for a
            // full 5s window (PASTE_WINDOW) regardless of what the composer
            // now holds. Confirmed live: this is why the SSN case (typed)
            // auto-sent fine while an AWS key case (pasted) kept swallowing
            // our own Enter and re-blocking on the verified-clean masked
            // text. We've already independently confirmed via UIA that the
            // composer holds exactly the masked, clean text, which
            // supersedes the stale clipboard signal this window exists to
            // catch — safe to clear it here.
            Emit("prompt", _app, "", "send", masked.Length);
            TypedClear(); _blockTyped = false; _typedPatterns = ""; _lastBlockFiredTicks = 0;
            _blockUia = false; _uiaPatterns = "";
            _blockPaste = false; _lastPasteTicks = 0;
            lock (_pendingLock) { _pendingBlockId = ""; _pendingRewritable = false; }

            SendKeyPress(VK_RETURN);

            // Verify the send actually landed, not just that we pressed the
            // key. Confirmed live: the Enter can silently fail to register —
            // composer left showing exactly the masked text, unsent — while
            // this method still went on to report "ok" and the dialog closed
            // having told the user their prompt was sent when it was not.
            // That is the worst failure mode available here, worse than
            // reporting a false failure. A real send clears the composer; if
            // it still holds precisely what we just typed after a beat,
            // treat that as not sent rather than assume success.
            Thread.Sleep(200);
            string postSend = null;
            try { postSend = ReadText(el); } catch { }
            bool stillThere = NormalizeWs(postSend) == NormalizeWs(masked);
            if (stillThere) { EmitRewrite(blockId, "failed", "not_submitted"); return; }

            EmitRewrite(blockId, "ok", "sent");
        }
        catch (Exception ex)
        {
            try { EmitRewrite(blockId, "failed", "exception:" + ex.GetType().Name); } catch { }
        }
        finally { _rewriteInProgress = false; }
    }

    // SendInput's return value is the count of events it actually accepted —
    // silently ignoring it is exactly how the Size=40 struct-layout bug above
    // went undetected. Any shortfall is reported (throttled, like regex
    // timeouts) so a future regression here is visible instead of a no-op.
    static long _lastSendInputWarnAt = 0;
    static void CheckSendInputResult(uint requested, uint accepted)
    {
        if (accepted == requested) return;
        long now = DateTime.UtcNow.Ticks;
        if (now - _lastSendInputWarnAt < TIMEOUT_EMIT_THROTTLE) return;
        _lastSendInputWarnAt = now;
        Emit("error", "", "", "sendinput_shortfall", -1, -1,
            "SendInput accepted " + accepted + "/" + requested + " events — GetLastError=" + Marshal.GetLastWin32Error());
    }

    static void SendKeyEvent(int vk, bool up)
    {
        var inp = new INPUT[1];
        inp[0].type = INPUT_KEYBOARD;
        inp[0].ki.wVk = (ushort)vk;
        inp[0].ki.wScan = 0;
        inp[0].ki.dwFlags = up ? KEYEVENTF_KEYUP : 0;
        inp[0].ki.time = 0;
        inp[0].ki.dwExtraInfo = IntPtr.Zero;
        uint sent = SendInput(1, inp, Marshal.SizeOf(typeof(INPUT)));
        CheckSendInputResult(1, sent);
    }
    static void SendKeyPress(int vk) { SendKeyEvent(vk, false); Thread.Sleep(5); SendKeyEvent(vk, true); }
    static void SendKeyCombo(int vkMod, int vkKey)
    {
        SendKeyEvent(vkMod, false); Thread.Sleep(5);
        SendKeyEvent(vkKey, false); Thread.Sleep(5);
        SendKeyEvent(vkKey, true); Thread.Sleep(5);
        SendKeyEvent(vkMod, true);
    }
    static void SendUnicodeChunk(string chunk)
    {
        // One SendInput call per character, not one call for the whole
        // chunk. Confirmed live: batching many KEYEVENTF_UNICODE down/up
        // pairs into a single SendInput array with zero inter-character
        // delay corrupted the result in the target app — e.g. "my ssn is
        // [SSN]" landed as "my ssn ]]]]", the tail collapsing into repeats
        // of the last character. The target's input pipeline (raw input
        // thread, IME/dead-key state, or its own message-loop coalescing)
        // can't keep up with an instantaneous burst. A few ms between
        // characters costs nothing against the 3s write budget and is the
        // standard fix for this exact class of synthetic-input corruption.
        foreach (char c in chunk)
        {
            var pair = new INPUT[2];
            pair[0] = new INPUT(); pair[0].type = INPUT_KEYBOARD; pair[0].ki.wVk = 0; pair[0].ki.wScan = (ushort)c; pair[0].ki.dwFlags = KEYEVENTF_UNICODE; pair[0].ki.dwExtraInfo = IntPtr.Zero;
            pair[1] = new INPUT(); pair[1].type = INPUT_KEYBOARD; pair[1].ki.wVk = 0; pair[1].ki.wScan = (ushort)c; pair[1].ki.dwFlags = KEYEVENTF_UNICODE | KEYEVENTF_KEYUP; pair[1].ki.dwExtraInfo = IntPtr.Zero;
            uint sent = SendInput(2, pair, Marshal.SizeOf(typeof(INPUT)));
            CheckSendInputResult(2, sent);
            Thread.Sleep(15);
        }
    }
}
'@

Add-Type -TypeDefinition $source -ReferencedAssemblies @(
    'System.Windows.Forms',
    'UIAutomationClient',
    'UIAutomationTypes',
    'WindowsBase',
    'System.Web.Extensions'
) -ErrorAction Stop

[CfaiEnforcer]::Start(($aiProcs -split ','), $patNames.ToArray(), $patSources.ToArray(), $patSevs.ToArray(), $patLabels.ToArray(), $hbPath, $modelRouterEnabled, $mrConfigJson)

# Keep the process alive — the C# background threads (poll + message pump) do
# the work and write events to stdout. Node reads them.
while ($true) { Start-Sleep -Seconds 3600 }

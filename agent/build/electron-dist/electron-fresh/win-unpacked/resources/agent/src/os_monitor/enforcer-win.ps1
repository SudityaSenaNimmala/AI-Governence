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
#   holds, then synthesizes Ctrl+A, Delete, and the masked text via SendInput —
#   line by line for multi-line text, with the surface's own newline key
#   combination (never a literal newline) between the segments.
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
#   {"kind":"rewrite","block_id":"...","result":"ok"|"aborted"|"failed","reason":"...","masked":"my ssn is [SSN]"}
#     — `masked` is present ONLY on result:"ok", and is the MASKED text that was
#       verified and sent, never the original. It is the one field on any event
#       from this file that carries prompt content, on purpose: the tokenization
#       audit trail matches the browser extension's. See EmitRewrite.
#   {"kind":"enforcement_disarmed","reason":"panic_hotkey","seconds":600}
#   {"kind":"error","message":"..."}
#
# IDE-hosted panels (Claude Code / GitHub Copilot Chat in VS Code, Cursor's own
# composer): enforcement follows the focused ELEMENT, not the process. See the
# "IDE-hosted AI panels" section below — a UIA signature match on
# AutomationElement.FocusedElement is what makes an IDE count as an AI surface at
# all, so code editing and terminal use are untouched. Model routing is excluded
# from every IDE panel, and mouse/send-button detection is skipped there.
#
# Limitations (told to the user): blocks Enter-to-send and Ctrl+V; clicking the
# send button with the mouse is not swallowed. The typed buffer is a best-effort
# reconstruction (mouse-editing mid-string can desync) but errs toward catching
# the secret. Charset covers the secret patterns (A-Za-z0-9 _ - . /). Tier B
# rewrite only offers itself for maskable text short enough to actually TYPE
# inside its write budget — 456 chars, and fewer when the text has many line
# breaks, because the write is paced keystroke by keystroke (see
# REWRITE_MAX_CHARS / EstimateWriteMs, which are computed from that pacing
# rather than written down beside it) — in a surface
# where UIA can be trusted (a chat app, an IDE panel that actually has focus, or
# a DLP-governed host-app conversation — see PanelUiaOk and _fgDlpGoverned) —
# anything else stays block-only with no Ctrl+Alt+T offer at all. MULTI-LINE text
# is maskable: the write types each line and sends the surface's own newline key
# combination (AI_PANELS' `newlineKeys`, default Shift+Enter) between them, never
# a literal newline, which in a chat composer would submit the message
# half-written. A surface whose declared combination this file cannot synthesize
# gets no multi-line offer at all.

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
$patIgnoreCase = New-Object System.Collections.ArrayList
if ($env:CFAI_BLOCK_PATTERNS) {
    try {
        $parsed = $env:CFAI_BLOCK_PATTERNS | ConvertFrom-Json
        foreach ($p in $parsed) {
            [void]$patNames.Add([string]$p.name)
            [void]$patSources.Add([string]$p.source)
            [void]$patSevs.Add([string]$p.severity)
            [void]$patLabels.Add([string]$p.label)
            [void]$patIgnoreCase.Add([bool]$p.ignoreCase)
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

# IDE-hosted AI panels. Same treatment as CFAI_MODEL_ROUTER_CONFIG directly
# above (passed through UNPARSED, deserialized on the C# side with
# JavaScriptSerializer) rather than the parallel-array flattening
# CFAI_BLOCK_PATTERNS gets: each panel entry carries a nested `procs` array, and
# re-flattening that by hand here would just move the parsing problem.
#
# Empty (env unset) means no IDE panel support at all — which is the right
# default for a by-hand debugging run of this script, and leaves every
# pre-existing chat-app code path untouched.
$ideProcsJson = if ($env:CFAI_IDE_PROCESSES) { $env:CFAI_IDE_PROCESSES } else { '' }
$aiPanelsJson = if ($env:CFAI_AI_PANELS)     { $env:CFAI_AI_PANELS }     else { '' }
$agentSurfacesJson = if ($env:CFAI_AGENT_SURFACES) { $env:CFAI_AGENT_SURFACES } else { '' }

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

    // The foreground window's TITLE, for a `read:"window_title"` agent surface
    // (Microsoft Teams — its composer's UIA Name is the same literal "Type a
    // message" in every conversation, so the title is the only signal that says
    // WHICH conversation is open). Same signature pair win-poller.ps1 already
    // uses; a bigger buffer, because a Teams title is "<kind> | <name> | <org> |
    // <email> | Microsoft Teams" and a long group-chat name plus a long tenant
    // and address can run past that file's 512 before reaching the suffix this
    // parse requires.
    //
    // NOTHING read through here is ever emitted, logged or persisted. The string
    // is parsed by ExtractAgentName, compared against the blocklist, and dropped
    // — the same rule the composer-Name read already follows, asserted in
    // agent/tests/os-monitor-safety.test.mjs.
    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    static extern int GetWindowTextLength(IntPtr hWnd);
    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
    const int WINDOW_TITLE_MAX = 1024;

    // For ReadFocusedAgentName's parent-process check: a WebView2-hosted app
    // (M365Copilot.exe, confirmed live) puts its actual UI content — and
    // therefore the focused UIA element — in a CHILD msedgewebview2.exe
    // process, not the process GetWindowThreadProcessId returns for the
    // window itself. An exact pid match against the foreground window's
    // process is correct for a single-process app but wrongly reads
    // "Unreadable" on every tick for a multi-process host. Walking to find one
    // specific pid's parent is the minimal fix — no full tree, no repeated
    // snapshot each tick beyond the single lookup this needs.
    [StructLayout(LayoutKind.Sequential)]
    struct PROCESSENTRY32
    {
        public uint dwSize;
        public uint cntUsage;
        public uint th32ProcessID;
        public IntPtr th32DefaultHeapID;
        public uint th32ModuleID;
        public uint cntThreads;
        public uint th32ParentProcessID;
        public int pcPriClassBase;
        public uint dwFlags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)]
        public string szExeFile;
    }
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern IntPtr CreateToolhelp32Snapshot(uint dwFlags, uint th32ProcessID);
    [DllImport("kernel32.dll")]
    static extern bool Process32First(IntPtr hSnapshot, ref PROCESSENTRY32 lppe);
    [DllImport("kernel32.dll")]
    static extern bool Process32Next(IntPtr hSnapshot, ref PROCESSENTRY32 lppe);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool CloseHandle(IntPtr hObject);
    const uint TH32CS_SNAPPROCESS = 0x00000002;

    // Does a focused element owned by `elPid` belong to the FOREGROUND surface
    // whose window process is `fgPid`?
    //
    // Its own method (rather than an inline condition in ReadFocusedAgentName)
    // because it is the one part of that read the panel-block harness can drive
    // for real: the FocusedElement lookup has to be substituted in a test, this
    // rule does not.
    //
    // Accepts the process itself, or a DIRECT CHILD of it — nothing else. One
    // generation only, deliberately: a WebView2/Chromium host puts its UI content
    // exactly one process down, and walking further would start accepting
    // whatever an unrelated app happened to launch. The direction matters too —
    // the PARENT of the foreground process is NOT the foreground surface.
    static bool ElementPidBelongsToForeground(int elPid, uint fgPid)
    {
        if (elPid == (int)fgPid) return true;
        return GetParentProcessId(elPid) == (int)fgPid;
    }

    // Returns the parent pid of `pid`, or -1 if not found/on any error. Never
    // throws — a failure here must fall back to the exact-match behavior, not
    // take the poll thread down.
    static int GetParentProcessId(int pid)
    {
        IntPtr snap = IntPtr.Zero;
        try
        {
            snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
            if (snap == IntPtr.Zero) return -1;
            PROCESSENTRY32 pe = new PROCESSENTRY32();
            pe.dwSize = (uint)Marshal.SizeOf(typeof(PROCESSENTRY32));
            if (!Process32First(snap, ref pe)) return -1;
            do
            {
                if ((int)pe.th32ProcessID == pid) return (int)pe.th32ParentProcessID;
            } while (Process32Next(snap, ref pe));
            return -1;
        }
        catch { return -1; }
        finally { if (snap != IntPtr.Zero) CloseHandle(snap); }
    }

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
    //
    // StartRewrite does now accept a caller-supplied string (the user's own
    // hand-edited replacement, from the Tokenize popup's "Edit manually" box),
    // and that is still not a "type anything" primitive: it types only into the
    // composer a pinned block was computed on, only while that composer still
    // holds the exact original text, and only after the same read-back
    // verification and rescan every computed mask goes through.
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
    // Non-left button DOWNs. Never swallowed and never inspected for content —
    // they exist only as "the user clicked something, so keyboard focus could
    // have moved". See _lastFocusMoveInputTicks.
    const int WM_RBUTTONDOWN = 0x0204;
    const int WM_MBUTTONDOWN = 0x0207;
    const int WM_XBUTTONDOWN = 0x020B;
    const int VK_BACK = 0x08;
    const int VK_TAB = 0x09;
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
    const int VK_F1 = 0x70;
    const int VK_F12 = 0x7B;
    const int VK_F24 = 0x87;

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

    // ── Rewrite tuning: ONE set of timing facts, everything else derived ─────
    //
    // Chunked typing + a foreground re-check between chunks bounds how much
    // masked text could land in a wrongly-focused window if focus changes
    // mid-write; a hard total time budget bounds a runaway write. See
    // RunRewrite().
    //
    // WHY THESE ARE CONSTANTS RATHER THAN LITERALS AT THE SLEEP SITES. They used
    // to be literals, and the character cap was a hand-written number derived
    // from a pacing that no longer existed: the comment here said "4ms apart, so
    // 2000 chars = 8s", while SendUnicodeChunk had since been changed to 15ms
    // per character. The real cap at 15ms was about 580 characters, so any
    // masked prompt longer than that aborted with "interrupted_mid_write" AFTER
    // Ctrl+A/Delete had already cleared the composer — a partially retyped
    // message, from a limit the file documented as 2000. The numbers below are
    // now used BY the write loop (Thread.Sleep(REWRITE_CHAR_DELAY_MS), …) and
    // the cap and the admission check are computed FROM them, so the arithmetic
    // cannot go stale again while the behaviour changes underneath it.
    //
    // MEASURED, not tuned by taste:
    //   REWRITE_CHAR_DELAY_MS — one SendInput per character with a pause
    //     between. Batching a chunk into one SendInput with no pause corrupted
    //     the result in the target app (confirmed live: "my ssn is [SSN]" landed
    //     as "my ssn ]]]]" — the target's input pipeline cannot keep up with an
    //     instantaneous burst). This is the delay that makes the read-back
    //     verification reliable, so it is NOT a knob to turn down for speed:
    //     doing that trades a refused long prompt for corrupted text typed into
    //     someone's composer.
    //   REWRITE_CHUNK_DELAY_MS — the per-chunk settle, alongside the abort /
    //     budget / foreground re-check that runs between chunks.
    //   REWRITE_KEY_DELAY_MS — spacing between the key events of a synthetic
    //     combination (Ctrl+A, Delete, Enter, and a newline combo).
    const int REWRITE_CHAR_DELAY_MS = 15;
    const int REWRITE_CHUNK_DELAY_MS = 10;
    const int REWRITE_KEY_DELAY_MS = 5;
    const int REWRITE_CHUNK = 24;
    static readonly long REWRITE_TTL = TimeSpan.FromSeconds(15).Ticks;

    // ── How long a pin may be HELD while the user rewrites the prompt by hand ─
    // The Tokenize popup's second view ("Edit manually") is a text box the user
    // types their own replacement into, and 15s is not a sane budget for typing
    // a sentence. Requested explicitly, per block, over the control channel
    // ({"cmd":"tokenize_edit"}) — never the default, and never for the plain
    // Tokenize & Send path, which still answers inside REWRITE_TTL.
    //
    // WHY A LONGER PIN IS NOT A LONGER LICENCE. The TTL is not what makes a
    // rewrite safe; RunRewrite's pre-flight is. An older pin still has to find
    // the SAME foreground window, the SAME focused element by runtime id and
    // the SAME unchanged composer text before a single character is typed, and
    // it still has to pass read-back verification and post-send confirmation
    // afterwards. What the TTL bounds is how long a pin can sit around waiting
    // for an answer that may never come, and the answer this one waits for is a
    // human typing into a box that closes itself first (see
    // CfaiTokenizeDialog.EditTimeoutMs in toast-helper.ps1, 90s) — with the
    // Node-side backstop between the two (TOKENIZE_EDIT_TIMEOUT_MS, 100s), so
    // every client clock lapses before this one does.
    static readonly long REWRITE_EDIT_TTL = TimeSpan.FromSeconds(120).Ticks;

    // THE CEILING THE BUDGET ANSWERS TO. Tier B is confirmed from a dialog that
    // closes ITSELF after 16s (block-dialog.js's `setTimeout(() => window.close(),
    // 16000)`), so a rewrite that has not reported by then leaves the user with
    // no answer at all. Working backwards from that 16s: the pre-write wait for
    // the user's fingers to come off the confirm chord is up to 2.5s
    // ("modifiers_stuck"), Ctrl+A + Delete cost ~80ms, and the tail after the
    // write is the verify poll (<=400ms) + settle (300ms) + the post-send
    // CONFIRMATION WINDOW — REWRITE_POST_SEND_MS (200ms) by default, and at most
    // REWRITE_POST_SEND_MAX_MS (1500ms) on a surface the catalog gives a longer
    // one. So the tail is ~0.9s by default and ~2.2s at the ceiling: 9s of
    // writing lands at ~12.6s in the default case and ~13.8s in the worst case,
    // both inside REWRITE_TTL (15s) and inside the dialog's own 16s timeout
    // (~3.4s / ~2.2s of margin respectively).
    //
    // NOT RAISED to buy a bigger cap, deliberately. It could go to ~11s on this
    // arithmetic, which would buy ~120 more characters and spend the entire
    // remaining margin — and this window is the one during which this process is
    // synthesizing keystrokes into another application. The limit that was wrong
    // was the character cap, so that is the one that moved.
    const int REWRITE_WRITE_BUDGET_MS = 9000;
    static readonly long REWRITE_WRITE_BUDGET = TimeSpan.FromMilliseconds(REWRITE_WRITE_BUDGET_MS).Ticks;

    // Wall time one FULL chunk of typing costs: every character's pace plus the
    // chunk settle. 24 * 15 + 10 = 370ms, i.e. ~15.4ms per character.
    const int REWRITE_CHUNK_MS = REWRITE_CHUNK * REWRITE_CHAR_DELAY_MS + REWRITE_CHUNK_DELAY_MS;

    // Slow-clock margin, applied to every estimate rather than baked into the
    // constants. Thread.Sleep(n) guarantees only "at least n": on a machine
    // whose timer resolution has not been raised, a 15ms sleep routinely takes
    // ~15.6ms, and a loaded box is worse. 4/5 (a 25% allowance) is what keeps a
    // write that the admission check accepted from aborting mid-way on a slow
    // tick — the failure this whole correction is about.
    const int REWRITE_BUDGET_MARGIN_NUM = 4;
    const int REWRITE_BUDGET_MARGIN_DEN = 5;
    const int REWRITE_USABLE_BUDGET_MS = REWRITE_WRITE_BUDGET_MS * REWRITE_BUDGET_MARGIN_NUM / REWRITE_BUDGET_MARGIN_DEN;

    // The character cap, DERIVED: the most characters the write loop can pace
    // out inside the usable budget, rounded down to a whole chunk because whole
    // chunks are what the loop actually types.
    //   (9000 * 4/5) / 370 = 19 chunks  ->  19 * 24 = 456 characters.
    // This is a coarse pre-filter with a second job: it bounds the cost of
    // running every pattern over the text at all, before any masking happens.
    // The ACCURATE gate is EstimateWriteMs/WriteFitsBudget below, which is
    // computed from the masked text's real shape — a line break costs more than
    // a character, so a 456-character prompt full of them is refused by that
    // check even though it passes this one.
    const int REWRITE_MAX_CHARS = REWRITE_CHUNK * (REWRITE_USABLE_BUDGET_MS / REWRITE_CHUNK_MS);

    // ── Confirming the SEND actually landed ──────────────────────────────────
    // Pressing Enter is not evidence that the message went, so RunRewrite reads
    // the composer back afterwards and treats "it still holds exactly what we
    // typed" as NOT SENT. WHEN to read is the subtle part, and the reason these
    // are constants rather than a literal at the read site.
    //
    // REWRITE_POST_SEND_MS is the FIRST read, and it is unchanged: a native
    // composer (M365 Copilot, Claude Desktop) has cleared well inside 200ms.
    //
    // THE BUG THAT PUT A POLL HERE. That first read used to be the ONLY read —
    // one shot at +200ms, and anything still present was reported
    // "failed"/"not_submitted". Confirmed live against Microsoft Teams: the
    // masked message WAS sent (it is in the conversation, with the value
    // masked) and the rewrite was still reported as failed, so index.js's
    // 'rewrite' handler took its `ev.result !== 'ok'` early return and NO
    // enforcement_redact audit event was ever recorded for a governed send that
    // really happened — a governance gap, not a cosmetic one. Teams hosts both
    // of its composers in a WebView2 CHILD PROCESS (see the ms-teams notes in
    // ai-processes.js and the child-process walk in this file), so "the
    // composer is empty now" has to cross a Chromium accessibility
    // serialization before UIA can report it. That is the same class of lag the
    // read-back verify poll above was already added for, after a one-shot read
    // at +60ms was confirmed to catch a mid-write composer.
    //
    // So the post-send check polls as well, and the WINDOW is catalog data
    // (AI_PANELS' `postSendVerifyMs`, read via PostSendVerifyMsFor) rather than
    // a longer wait imposed on every app. A surface that states nothing keeps
    // exactly today's single read at +200ms, byte for byte.
    //
    // POLLING CANNOT WEAKEN THE CHECK. It only ever lets a composer that
    // genuinely did clear be SEEN to have cleared; a message that really was
    // not submitted sits in the composer for the whole window and is still
    // reported "not_submitted". Identical argument to the verify poll's.
    const int REWRITE_POST_SEND_MS = 200;
    const int REWRITE_POST_SEND_POLL_MS = 40;
    // The CEILING on any catalog value, applied at load time (LoadAiPanels) so
    // the budget arithmetic above cannot be invalidated by a payload: an entry
    // asking for 30s would leave the user's dialog timing out before the rewrite
    // reported anything at all. 2.5s + 9s + 0.4s + 0.3s + this lands at ~13.8s,
    // inside both REWRITE_TTL and the dialog's 16s.
    const int REWRITE_POST_SEND_MAX_MS = 1500;

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

    // ── IDE-hosted AI panel state (written only by the poll thread) ─────────
    // True when the foreground process is an IDE (VS Code / Cursor) AND the
    // focused element matched an AI_PANELS signature — i.e. the caret is in an
    // AI composer, not in the code editor or a terminal. _fgIsAi is set for
    // these too, so every existing block path applies unchanged; these fields
    // are what scope it to the panel.
    static volatile bool _fgIsPanel = false;
    static volatile string _fgPanelId = "";
    // The matched panel's `enforce` flag. FALSE means detection-only: the panel
    // is identified (so events can be attributed to it) but NOTHING may ever be
    // blocked or captured because of it — see PanelEnforceOk/PanelUiaOk and the
    // panel branch of CheckFgBlocked, which all consult this.
    static volatile bool _fgPanelEnforce = false;
    // ── "This HOST-APP tick is DLP-GOVERNED, and is NOT blocked" ─────────────
    // The third state a Microsoft Teams conversation can be in. The other two
    // are unchanged: BLOCKED (a named blocked-agents.json row — everything
    // swallowed) and UNTOUCHED (no capture at all, the overwhelming majority of
    // Teams use). This flag marks the middle one: an agent the org asked to
    // DLP-MONITOR but explicitly did NOT block, so its prompts are scanned and
    // Tokenize & Send is offered, while every Enter still goes through.
    //
    // Set ONLY by ApplyForegroundTick's host-app branch, and only for a tick
    // that is not blockGoverned. Read in ONE place — UpdatePendingRewrite, to
    // lift the blanket host-app exclusion from Tier B. It is deliberately NOT
    // read by any block decision: nothing in CheckFgBlocked, EnterBlockActive or
    // the hook consults it, so a governed-only tick cannot swallow a keystroke
    // through it even if a future change forgot the host-app guards.
    static volatile bool _fgDlpGoverned = false;
    // Composite identity of "whose keystrokes are in the typed buffer":
    // pid + panel id (or "none") + the focused element's RuntimeId. Moving
    // between two panels, or between a panel and the editor, INSIDE one process
    // leaves the pid unchanged — so a pid-only key let editor/terminal
    // keystrokes stay buffered across a panel visit and be scanned as part of
    // an AI prompt. Built here on the poll thread (never in the hook, which
    // only ever compares two strings). Contains no text — ints and our own
    // catalog ids only.
    static volatile string _fgOwnerKey = "";
    // Sticky timer: when focus leaves an AI app, keep _fgIsAi true for 3s
    // so toast-dismiss-then-quick-send can't bypass the block.
    static long _fgLeftAiTicks = 0;
    static readonly long FG_STICKY_TTL = TimeSpan.FromSeconds(3).Ticks;

    // Blocked agents — the foreground process is fully blocked (all Enter +
    // send button swallowed) when it matches a platform in the blocklist.
    // Updated every 30s by reading ~/.cloudfuze-aigov/blocked-agents.json.
    static volatile bool _fgIsBlocked = false;
    // Was _fgIsBlocked armed from a FOCUSED-ELEMENT read (true) or from a
    // process-name match (false)?
    //
    // True for both element-scoped block kinds now: an IDE-hosted AI PANEL
    // (claude_code / cursor_composer) and a named AGENT inside a chat app
    // (agent_scope:'agent'). Both are established by reading which element/agent
    // has focus, so both must be exempt from re-gating on THIS tick's read —
    // which is what the flag is for. _blockScope below is the field that says
    // WHICH of the two (or neither) it was; this one only says "not process-wide".
    //
    // The distinction exists because PanelEnforceOk() answers a question about
    // the CURRENT poll tick's focused element ("is the surface focused right now
    // allowed to enforce?"), and using that to re-gate a block that a DIFFERENT,
    // enforcing panel already established is wrong in a way that silently
    // un-blocks a blocked app: the moment one tick's focused-element read lands
    // on the detection-only Copilot Chat composer that shares the same VS Code
    // window, PanelEnforceOk() goes false and the Enter the org disallowed is
    // let through. "Detection-only" has to mean "this panel never CAUSES a
    // block" — it cannot also mean "this panel CANCELS other panels' blocks".
    //
    // Set only by the panel branch (which already requires _fgPanelEnforce) and
    // the agent-scoped branch (which already requires a verified AND enforcing
    // AGENT_SURFACES entry), so a detection-only surface of either kind can still
    // never arm a block through it. The process-keyed branches leave it false and
    // stay fully subject to PanelEnforceOk(), because those are process-WIDE and
    // an IDE with no enforcing panel focused is exactly the code-editor false
    // positive the panel feature exists to avoid.
    static volatile bool _blockedByElement = false;
    // The AUTHORITATIVE scope of the current block, and the single source of
    // truth for both reporting (block_scope / the bar's scope field) and the
    // banner gate:
    //   "app"    — the whole foreground process is disallowed.
    //   "panel"  — one AI composer inside an IDE is.
    //   "agent"  — one named agent inside a chat app is.
    //   ""       — nothing is blocked.
    // Scope must NEVER be inferred from the `panel` attribution field: that field
    // falls back to PanelField(), so an app-scoped block can legitimately carry a
    // panel id, and anything keyed on its presence silently flips.
    static volatile string _blockScope = "";
    static string _blockedReason = "";
    // Which blocked row matched, so the "Request Access" dialog can name the
    // platform an exception would have to be granted for. Fields come straight
    // from blocked-agents.json (platform / agent_name / agent_id — the shape
    // monitor-runner.mjs writes and UpdateBlockedAgents parses); nothing here is
    // synthesised, so an admin's row and the request the user files agree.
    static string _blockedPlatform = "";
    static string _blockedAgentName = "";
    static string _blockedAgentId = "";
    static string _blockedAgentFile = "";
    static long _lastBlockedCheck = 0;
    static readonly long BLOCKED_CHECK_INTERVAL = TimeSpan.FromSeconds(10).Ticks;

    // ── The GOVERNED (DLP-monitored, NOT blocked) list ───────────────────────
    // ~/.cloudfuze-aigov/governed-agents.json, written by
    // blocked-agents-sync.js from GET /api/lifecycle/governed-agents. Same row
    // shape as blocked-agents.json (deliberately — normalizeGovernedRows runs
    // the rows through the same sanitiser), so the same hand-rolled parser reads
    // both and there is no second convention to learn.
    //
    // WHAT IT CAN AND CANNOT DO. It can make a host-app tick DLP-GOVERNED:
    // prompts scanned, Tokenize & Send offered. It can NEVER arm a block — no
    // code path reads this list from CheckFgBlocked, EnterBlockActive or the
    // hook, and the arm sites all require a row from _blockedList.
    //
    // MISSING FILE = nothing is governed (the sync has not completed yet), the
    // same convention an unreadable blocked list follows. An EMPTY ARRAY is
    // meaningful and different in intent ("nothing is currently monitored") but
    // identical in effect, so both land in the same place: an empty list.
    //
    // PRECEDENCE IS NOT RE-DERIVED HERE. The sync layer guarantees, at write
    // time, that an agent on the blocked list never reaches this file
    // (filterGovernedAgents, asserted in os-monitor-safety.test.mjs). The
    // enforcer still cannot produce "blocked AND governed" even if that
    // guarantee broke, because ApplyForegroundTick computes blockGoverned first
    // and dlpGoverned only for a tick that is not blockGoverned.
    static string _governedAgentFile = "";
    static List<Dictionary<string, string>> _governedList = new List<Dictionary<string, string>>();

    // ── Request Access offer ──────────────────────────────────────────────────
    // The moment a platform/agent/panel block actually swallows a send is the
    // ONLY moment this process offers the ephemeral Request Access dialog — the
    // same instant the browser extension shows its own. There is no window, no
    // tray icon and no standing UI on this path: Node opens a form, the user
    // submits or cancels, it disappears.
    //
    // NO STATE LIVES HERE, deliberately. This used to hold a
    // one-offer-per-block-session key plus a 60s floor, and live use killed it:
    // a user whose request was DECLINED (or who cancelled) then typed the next
    // message, pressed Enter, was blocked again — and got nothing, because the
    // latch said "already offered for this block". The block is still in force
    // and they are still stuck, so every blocked send attempt must be able to
    // offer again. See OfferAccessRequest, which is now stateless.
    //
    // The only duplicate-suppression left is CONCURRENCY, and it lives where the
    // dialog actually is: toast-helper.ps1's `Open` dictionary refuses a second
    // form for a key already on screen (and replies action:"suppressed"), and
    // index.js drops an offer for a block it is already mid-flight on. Both
    // release as soon as the dialog closes, so the next Enter offers at once.

    // ── Standing "this app is blocked" bar (presentation state only) ──────────
    // Feeds the desktop overlay bar — the counterpart of the browser
    // extension's showPlatformBanner(). PURELY DERIVED, and READ-ONLY with
    // respect to every enforcement field above: nothing in UpdateBannerState /
    // EmitBlockState may write _fgIsBlocked, _blockedByElement, the panel latch,
    // or call ClearFgBlocked(). Those release deliberately SLOWLY (FG_STICKY_TTL,
    // PANEL_BLOCK_LATCH_TTL) for correctness reasons the bar does not share.
    //
    // _bannerPid is its own copy of "which process the bar is up for", kept
    // separate from _panelBlockPid for exactly that reason: the bar must clear
    // the instant the foreground pid changes, with NO grace period at all. If it
    // borrowed the enforcement sticky window, alt-tabbing from a blocked app to
    // Outlook would leave a red "blocked" bar sitting over Outlook for 3s —
    // reproducing, on the desktop, the "the whole Gmail is blocked" bug the
    // extension's own IS_EMBEDDED_AI exclusion exists to prevent.
    static volatile bool _bannerActive = false;
    static volatile uint _bannerPid = 0;
    static string _bannerAgent = "";

    // ── Standing "a governed agent conversation is open" state (host apps) ────
    // Same shape and the same discipline as the bar state above — PURELY
    // DERIVED, READ-ONLY with respect to every enforcement field, one line per
    // real transition — for a completely different consumer.
    //
    // WHAT IT IS FOR. index.js ARMS the three file watchers (drag-drop chip,
    // file-picker dialog, clipboard file paste) for Microsoft Teams for exactly
    // as long as this says a governed or blocked agent conversation is the open
    // one, and disarms them the instant it stops saying so. Teams is absent from
    // watcherProcessNames() and must stay absent — a passive watcher on a
    // company's chat client would see every DM. This event is what lets the
    // narrow, already-verified governed window be covered without widening that
    // list.
    //
    // WHY IT IS NOT _fgDlpGoverned. That flag is the DLP-only MIDDLE state
    // ("governed and explicitly NOT blocked") and has exactly one reader by
    // design. This one is the UNION of governed and blocked, because a file
    // attached inside a BLOCKED conversation is the stronger case, not an
    // exemption from scanning.
    static volatile bool _govActive = false;
    static volatile uint _govPid = 0;
    static string _govKey = "";

    // What THIS tick's host-app branch decided, handed to UpdateGovState a few
    // microseconds later in the same poll tick. Assigned on EVERY branch of
    // ApplyForegroundTick (exactly as _fgDlpGoverned is) so a governed tick's
    // state can never outlive the tick that earned it.
    //
    // The agent name/id are the ADMIN-TYPED row values (GovernedRowIdentity),
    // never the name read off the other app's title or accessibility tree.
    static volatile bool _fgHostGoverned = false;
    static volatile string _fgHostGovPanel = "";
    static volatile string _fgHostGovAgent = "";
    static volatile string _fgHostGovAgentId = "";

    // ── Platform-block latch for IDE-hosted panels ───────────────────────────
    // Fixes a real, reproduced race (2 of 3 Enters blocked, the third sent).
    //
    // For a PURE CHAT APP _fgIsAi comes from "is this PROCESS the foreground
    // window" — a signal that cannot flicker. For an IDE PANEL it comes from
    // "does the FOCUSED UIA ELEMENT match a panel signature right now", and on
    // an Electron host that read is routinely unresolvable — most of all during
    // the panel's own send transition, which is exactly when it matters. Live
    // testing showed VS Code still in the foreground (the process never
    // changed) while the panel read came back empty for longer than
    // FG_STICKY_TTL; UpdateForeground then tore down _fgIsAi/_fgIsPanel,
    // CheckFgBlocked cleared _fgIsBlocked, and the next Enter in a panel an
    // admin had BLOCKED went through unswallowed.
    //
    // Same principle the sticky window already encodes, applied one level
    // deeper: CAPTURE may fail open on the first bad read — and still does,
    // FgIsAiNow/PanelUiaOk go false immediately and nothing below changes that
    // — but a platform BLOCK DECISION that was already correctly established
    // must not be torn down by a bad read. So that decision is latched, and the
    // latch is deliberately narrow:
    //   * platform blocks only, never a typed/UIA/clipboard content block;
    //   * armed only by the panel branch of CheckFgBlocked, and only on a tick
    //     whose panel read actually succeeded (_fgLeftAiTicks == 0);
    //   * dropped the instant a SUCCESSFUL panel read says "not a panel" — so
    //     genuinely clicking into the code editor behaves exactly as it does
    //     today (the 3s sticky, then clear), with no added collateral;
    //   * dropped the instant the foreground pid changes — a real app switch;
    //   * bounded by PANEL_BLOCK_LATCH_TTL, so a host whose UIA never recovers
    //     cannot leave Enter dead in the editor indefinitely;
    //   * still under Disarmed(), so the panic hotkey releases it like
    //     everything else.
    static volatile bool _panelBlockLatch = false;
    static volatile uint _panelBlockPid = 0;
    // WHICH panel the latch was armed for. Needed because a single IDE window
    // hosts several AI composers at once — a real VS Code window was measured
    // with two live Claude Code composers AND a GitHub Copilot Chat input, all
    // three matching the signature table, all three reporting keyboard focus
    // within their own webview — and AutomationElement.FocusedElement is a
    // GLOBAL read that is not scoped to the surface the user is typing into
    // (measured returning an element from a different window, and a different
    // process, than the foreground one). So "this tick matched some panel that
    // no blocklist row covers" is NOT evidence that the latched panel lost
    // focus, and must not tear its block down. See CheckFgBlocked's fall-through.
    //
    // GENERALISED, not duplicated. The same state machine now latches two kinds
    // of element-scoped block, so the field holds an opaque NAMESPACED key rather
    // than a bare panel id:
    //   "panel:claude_code"    — an IDE-hosted AI composer
    //   "agent:m365_copilot"   — a named agent inside a chat app
    // The namespace matters: a panel id and an agent-surface id come from
    // different catalogs and could in principle collide, and the two are
    // retired by different evidence. Everything else about the latch — the pid
    // check, the TTL, the arm-only-on-a-first-hand-tick rule, Disarmed()
    // releasing it — is unchanged and shared. The surrounding
    // _panelBlockLatch/_panelBlockPid/PanelBlockLatchHeld names are kept as they
    // were to hold the diff of this change down; read "panel" in them as
    // "focused element".
    static volatile string _elementBlockKey = "";
    static long _panelBlockLatchTicks = 0;
    static readonly long PANEL_BLOCK_LATCH_TTL = TimeSpan.FromSeconds(10).Ticks;

    // ── Could keyboard focus actually have MOVED? ────────────────────────────
    // The second half of the same story, and what the Cursor composer needed.
    //
    // The neighbour-panel fix above scopes the "no row matched" fall-through by
    // PANEL id — which only helps when the read that stole the tick MATCHED some
    // panel. Cursor's window has no second AI panel in it at all: the element
    // sitting next to `aislash-editor-input` is Cursor's own Monaco editor input
    // ("inputarea monaco-mouse-cursor-text"), which matches nothing. A global
    // FocusedElement read landing on THAT is a readable NON-match, and a readable
    // non-match was treated as the authoritative "the user left the panel"
    // answer, unconditionally and with no grace period — ApplyForegroundTick
    // retired the latch on that single tick, before CheckFgBlocked's panel-id
    // scoping ever ran. 3s later the sticky window lapsed and the Enter an admin
    // had blocked went through.
    //
    // The fact that separates the two cases is not in the accessibility tree at
    // all: KEYBOARD FOCUS DOES NOT MOVE ON ITS OWN. A click, or a chorded /
    // navigation key (Ctrl or Alt held, Tab, Escape, an F-key) can move it; a
    // plain character key typed into a text box cannot. So a readable "you are
    // not in the panel any more" arriving when no such input has happened is not
    // a fact about the user — it is a bad read, and belongs in the same
    // "no evidence" bucket as an unreadable one.
    //
    // Deliberately narrow, same as the latch itself:
    //   * consulted ONLY when deciding whether to retire an armed panel platform
    //     block. Capture still fails open on the first bad read (FgIsAiNow /
    //     PanelUiaOk go false immediately and nothing here changes that), and no
    //     content block can be manufactured from it.
    //   * still bounded by PANEL_BLOCK_LATCH_TTL, so focus moved by something
    //     this list does not model (an extension stealing it with no input)
    //     costs at most that, not forever — and the panic hotkey still releases
    //     it like everything else.
    // Written by the hook/mouse threads: a TIMESTAMP only. Which key, which
    // button and where are never recorded.
    static long _lastFocusMoveInputTicks = 0;
    // One poll tick is 150ms, and UpdateForeground runs first in it, so the read
    // that observes a genuine click into the editor always lands well inside
    // this. Wide enough to absorb a slow tick; far too narrow to be satisfied by
    // the quiet moment before an Enter.
    static readonly long PANEL_LEAVE_INPUT_WINDOW = TimeSpan.FromMilliseconds(1500).Ticks;

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
    // WHICH APP the hold belongs to, as a bare process name.
    //
    // The flag above used to be the whole state, with no process identity in it
    // at all — so a hold armed for a flagged attachment in one app swallowed the
    // next Enter in whatever app the user alt-tabbed to. A dead Enter in an
    // unrelated window, with no toast and nothing on screen to explain it: the
    // worst failure mode this file has, because it looks like the keyboard
    // broke. AttachHoldActive() is the gate; every read of the raw flag that
    // participates in a keystroke decision goes through it.
    //
    // EMPTY means "unbound", and unbound still counts. That is the fail-CLOSED
    // direction and it is only reachable from a command that omitted the field
    // (index.js always sends it): the alternative would be to silently stop
    // holding a sensitive attachment because a field was missing.
    static string _attachHoldProcess = "";
    // Platform → process name mapping for desktop enforcement.
    // MIRRORS ai-processes.js's PLATFORM_PROCS byte for byte; the two are held
    // in lockstep by agent/tests/ai-processes.test.mjs, which parses this block.
    // "ms-teams" is a HOST APP (see _hostAppProcs): its membership here is what
    // lets an agent-scoped row cover the Teams process at all, and it can never
    // produce a whole-app block — CheckFgBlocked excludes a host app from all
    // three coarse arms.
    static readonly Dictionary<string, HashSet<string>> PLATFORM_PROCS = new Dictionary<string, HashSet<string>>(StringComparer.OrdinalIgnoreCase) {
        { "copilot_studio",    new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "Copilot", "M365Copilot", "ms-teams" } },
        { "personal_agent",    new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "Copilot", "M365Copilot", "ms-teams" } },
        { "teams_chat_agent",  new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "ms-teams" } },
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
    // Owner of the buffer's current contents — compared against _fgOwnerKey.
    // See _fgOwnerKey for why this is a composite key and not just a pid.
    static string _typedOwnerKey = "";
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

    // ── IDE processes + panel signatures (CFAI_IDE_PROCESSES / CFAI_AI_PANELS) ─
    // Replaces the old hardcoded IDE-app name set (Cursor, Code, VSCode and
    // Copilot, as C# literals), which was both too wide and too narrow:
    //   - "Copilot" is Microsoft Copilot STANDALONE, a pure chat app, not an IDE.
    //     Including it denied Tokenize & Send and model routing to that app for
    //     no reason — a pre-existing bug, fixed as a side effect by not carrying
    //     it here.
    //   - "VSCode" is not a real shipping process name (VS Code's is "Code"), so
    //     it never matched anything; dropped rather than kept as an alias.
    //   - And the set only ever excluded UIA-based checks. It did NOT scope the
    //     keystroke-buffer scan, which is the actual detection mechanism — so
    //     Cursor was scanned everywhere (editor, terminal, AI panel alike) while
    //     VS Code, absent from every catalog, was not scanned at all.
    // Both payloads are data from ai-processes.js; the comparison code lives
    // here and only here (see MatchPanelSignature).
    static HashSet<string> _ideProcs = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
    // IDE processes that fall back to whole-app treatment when no panel matches
    // — see ai-processes.js's panelFallback. Empty today: an explicit decision
    // (2026-08-25) scoped Cursor down to its composer only, same as Claude
    // Code, giving up the whole-app coverage it used to have from being in
    // _aiProcs. The mechanism stays here — a future entry can set
    // panelFallback:true again if a whole-app safety net is ever wanted.
    static HashSet<string> _ideFallbackProcs = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

    class PanelSig
    {
        public string Id;
        public HashSet<string> Procs;
        public string ControlType;
        public string NameEquals;
        public string NamePrefix;
        public string ClassEquals;
        public string ClassPrefix;
        public bool Enforce;
        // What a HOST APP must prove before this composer is DLP-GOVERNED
        // (scanned + Tokenize & Send eligible). Data from ai-processes.js's
        // `dlpMatch`; the comparison lives in PanelDlpMatchesOnPanelAlone.
        //   "agent" (the default) — the open conversation must ALSO be named by
        //                           a governed-agents.json row.
        //   "panel"               — the panel match alone is enough, because the
        //                           composer has no non-AI use (Teams' embedded
        //                           Copilot tab).
        // NEVER consulted by any block decision — see CheckFgBlocked, which bars
        // a host app from all three coarse arms whatever this says.
        public string DlpMatch;
        // Which key combination inserts a LINE BREAK here without submitting.
        // Read only by Tier B's rewrite; see NewlineKeysFor/ResolveNewlineKeys.
        public string NewlineKeys;
        // How long to keep confirming that a rewrite's synthetic Enter actually
        // submitted, for THIS composer. Data from ai-processes.js's
        // `postSendVerifyMs`, already clamped by LoadAiPanels; read only by
        // RunRewrite's post-send check, via PostSendVerifyMsFor. Teams' two
        // composers are the surfaces that need more than the default — their UI
        // lives in a WebView2 child process, so the composer clearing has to
        // cross a Chromium accessibility hop before UIA can see it.
        public int PostSendVerifyMs;
    }
    static List<PanelSig> _panels = new List<PanelSig>();

    // ── Agent surfaces (CFAI_AGENT_SURFACES) ────────────────────────────────
    // "WHICH named agent is open inside this app", for agent_scope:'agent'
    // blocked rows. Data from ai-processes.js's AGENT_SURFACES; the comparison
    // code lives here and only here (ExtractAgentName / AgentNameMatches).
    //
    // FAIL CLOSED on an empty or malformed payload, which is the OPPOSITE
    // direction from _panels — and correctly so. An empty PANEL catalog means
    // "do not scan an editor", which is safe. An empty AGENT-SURFACE catalog
    // means "do not NARROW a block", which is also safe: an agent-scoped row
    // falls back to today's whole-app block rather than enforcing nothing.
    class AgentSurface
    {
        public string Id;
        public HashSet<string> Procs;
        public string ControlType;
        public List<string> NamePrefixes;
        public HashSet<string> GenericNames;
        // WHICH signal names the open agent. "" / "composer_name" is the
        // original behaviour (strip a known prefix off the focused composer's
        // UIA Name) and is what m365_copilot and every pre-Teams entry get.
        // "window_title" parses the foreground window's title instead — see
        // ExtractAgentNameFromTitle and the teams_desktop entry in
        // ai-processes.js for why Teams cannot use the composer name.
        public string ReadFrom;
        public string TitleSeparator;
        public string TitleSuffix;
        public HashSet<string> TitleKinds;
        // A HOST APP: a general-purpose application (Microsoft Teams) that is
        // AI-relevant only inside one specific, separately-gated conversation.
        // It NEVER falls back to a whole-app block — see CheckFgBlocked. For an
        // AI-only app "cannot tell which agent is open" safely means "block the
        // app"; for a company's communications client it must mean "block
        // nothing".
        public bool HostApp;
        public bool Enforce;
        public bool Verified;
        // ── The nested SECOND UI ROUTE (`fallbackRead` in ai-processes.js) ──
        // Microsoft Teams' embedded "Copilot" tab keeps a GENERIC, CONSTANT
        // window title regardless of which agent is open, so the title parse
        // above correctly reads NO EVIDENCE there and the whole Chat-list
        // mechanism is blind to that route. The agent's name lives in the PANE
        // instead, on an accessible heading. These fields describe how to read
        // it; see ExtractAgentNameFromHeading and GetCachedCopilotHeadings.
        //
        // FallbackMode is the opt-in: anything other than "message_heading"
        // (including the empty string a surface with no fallback block gets)
        // means NO FALLBACK EXISTS and nothing below is ever consulted, so
        // m365_copilot — whose payload never carries this block at all — is
        // completely unaffected by these fields existing.
        //
        // FallbackPaneKinds is checked against the title's KIND segment only,
        // and is deliberately NOT TitleKinds: on this route the title's second
        // segment is the tenant/org name, not a conversation name, so folding
        // 'Copilot' into TitleKinds would make the primary parse read the ORG
        // NAME as the open agent. Two different questions, one shared answer
        // (TitleKindOf) about which view is open.
        //
        // Its OWN Enforce/Verified pair, separate from the entry's. The entry
        // itself is live-verified and enforcing for the Chat-list route; this
        // route has had no live pass, and bolting it onto the entry's pair
        // would ship it armed on day one.
        public string FallbackMode;
        public HashSet<string> FallbackPaneKinds;
        public string FallbackHeadingClass;
        public string FallbackHeadingSuffix;
        public string FallbackLandingInfix;
        public HashSet<string> FallbackGenericNames;
        public bool FallbackEnforce;
        public bool FallbackVerified;
    }
    static List<AgentSurface> _agentSurfaces = new List<AgentSurface>();

    // The process names covered by a HostApp surface. Mirrors _agentScopedProcs'
    // shape and rebuild discipline: recomputed only where the surfaces are
    // loaded, so every consumer is a HashSet lookup on the poll path.
    //
    // Read in five places, all of them EXCLUSIONS that keep a general-purpose
    // app from being treated as a chat app: CheckFgBlocked (no whole-app block),
    // PanelEnforceOk / PanelUiaOk (element-scoped, like an IDE), UpdateSendRect
    // (no send-button hunt), UpdateModelRouting (no model routing) and
    // UpdatePendingRewrite (no Tokenize & Send offer — the one exclusion that is
    // now governance-scoped rather than blanket: it stands for every host-app
    // tick except a DLP-GOVERNED one, see _fgDlpGoverned). ApplyForegroundTick's
    // own host-app branch is the single place a host app can be treated as an AI
    // surface at all, and only for the exact tick an agent the org has a policy
    // about is provably open.
    static HashSet<string> _hostAppProcs = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

    // What one ReadFocusedAgentName() call established. Getting this taxonomy
    // right IS the reliability of the feature:
    //   Unreadable   — FocusedElement threw/was null, or belonged to another
    //                  process, or carried no usable properties. NO EVIDENCE.
    //   NotComposer  — readable, but not a composer this catalog can read an
    //                  agent name off (wrong control type, no known prefix).
    //                  NO EVIDENCE either.
    //   Generic      — a composer, and what follows the prefix is a generic app
    //                  name. AUTHORITATIVE: no specific agent is open.
    //   Named        — AUTHORITATIVE: that named agent is open.
    // The two NO EVIDENCE outcomes are what the latch survives; the two
    // AUTHORITATIVE ones retire it on the tick they arrive.
    enum AgentReadOutcome { Unreadable = 0, NotComposer = 1, Generic = 2, Named = 3 }

    // THIS TICK's agent read. Always mirrors the read UpdateForeground actually
    // performed — Unreadable whenever it performed none — so a stale Named can
    // never leak into a later tick's block decision.
    //
    // _fgAgentName holds a display string read out of ANOTHER APP's accessibility
    // tree. It is compared against the blocklist and nothing else: it is never
    // emitted, logged, persisted or put in a block event. Every name that reaches
    // stdout comes from the blocked ROW (admin-typed), never from here.
    static volatile AgentReadOutcome _fgAgentOutcome = AgentReadOutcome.Unreadable;
    static volatile string _fgAgentName = "";
    // PRIVACY GATE. The process names for which the CURRENT blocklist holds an
    // agent-scoped row — recomputed by UpdateBlockedAgents. Without a policy that
    // actually needs to know which agent is open, we never read another app's
    // accessibility tree to find out. Keyed by PROCESS (not by the sticky _app)
    // so a tick can decide about the process it is actually looking at, with no
    // one-tick lag that would read the wrong app.
    static HashSet<string> _agentScopedProcs = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
    // The SAME privacy gate for the GOVERNED list: the process names the current
    // governed-agents.json holds an agent-scoped row for. Recomputed with that
    // list and only there, so the poll path stays a HashSet lookup.
    //
    // Why it is a second set rather than being folded into _agentScopedProcs:
    // that set is also the gate for a whole-app fail-CLOSED block on a chat app
    // (CheckFgBlocked's coarse arm reads the blocklist it is derived from), and
    // adding DLP-monitored processes to it would mean a monitor-only policy
    // started licensing block decisions. This one licenses exactly one thing —
    // reading, on a tick, whether a governed conversation is open.
    static HashSet<string> _dlpScopedProcs = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

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
    // ── The pin is HELD, not being refreshed ─────────────────────────────────
    // True on any tick where UpdatePendingRewrite could not recompute the
    // candidate because the foreground is no longer the AI surface it was
    // computed on — the user is looking at something else. The pin is kept
    // (until _pendingExpiresAt) rather than dropped, which is what lets the
    // Tokenize popup's "Edit manually" view take keyboard focus without
    // destroying the very block it is editing; see UpdatePendingRewrite's own
    // note, and HoldPendingRewrite for the expiry side of it.
    //
    // A FROZEN PIN IS NOT AN OFFER. EmitBlock and the confirm hotkey both
    // refuse it, because a frozen pin's preview/id describe the composer of
    // whatever surface it was computed on — offering it against a block that
    // fired somewhere else would show one app's masked text in the other's
    // popup. What a frozen pin can still do is answer the ONE tokenize command
    // that was already issued for its own id, which RunRewrite then re-verifies
    // against the pinned window, element and text exactly as always.
    static bool _pendingFrozen = false;
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

    public static void Start(string[] aiProcs, string[] patNames, string[] patSources, string[] patSevs, string[] patLabels, bool[] patIgnoreCase, string heartbeatFile, bool modelRouterEnabled, string modelRouterConfigJson, string ideProcsJson, string aiPanelsJson, string agentSurfacesJson)
    {
        try { SetProcessDPIAware(); } catch { }   // align UIA rect with hook screen coords
        _startTicks = DateTime.UtcNow.Ticks;
        _heartbeatFile = heartbeatFile ?? "";
        _blockedAgentFile = System.IO.Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
            ".cloudfuze-aigov", "blocked-agents.json");
        // The DLP-monitored-but-not-blocked list. A SEPARATE file on purpose —
        // see _governedList: one wrong parse of a merged file would either block
        // a monitored agent or monitor a blocked one.
        _governedAgentFile = System.IO.Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
            ".cloudfuze-aigov", "governed-agents.json");
        _aiProcs = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var p in aiProcs) { if (!string.IsNullOrEmpty(p)) _aiProcs.Add(p.Replace(".exe", "")); }
        _patInfos = new List<PatInfo>();
        for (int i = 0; i < patSources.Length; i++)
        {
            // Server-supplied rule sources are untrusted input as far as CPU is
            // concerned: always construct with the match timeout.
            try
            {
                // ignoreCase travels per-pattern from classifier.js's p.regex.ignoreCase:
                // .source alone drops the JS /i flag, so guardrail patterns (authored
                // case-insensitive) need it restored here or a naturally-capitalized
                // sentence ("Ignore all previous instructions") silently fails to match.
                // Key/secret patterns (AWS, API keys) never set /i and must stay
                // case-sensitive — their format is fixed-case by definition.
                bool ic = (patIgnoreCase != null && i < patIgnoreCase.Length) && patIgnoreCase[i];
                var opts = RegexOptions.CultureInvariant | (ic ? RegexOptions.IgnoreCase : RegexOptions.None);
                var rx = new Regex(patSources[i], opts, REGEX_TIMEOUT);
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
        // IDE panels — same "a bad payload must never take the helper down"
        // rule. A load failure leaves _panels empty, which means no IDE process
        // ever detects a panel: VS Code goes back to being unmonitored, and
        // Cursor falls back to the whole-app behavior it has today. Fail OPEN on
        // capture, never a false block.
        if (!string.IsNullOrEmpty(ideProcsJson))
        {
            try { LoadIdeProcesses(ideProcsJson); }
            catch (Exception ex) { Emit("error", "", "", "ide_processes_load_failed", -1, -1, ex.GetType().Name); }
        }
        if (!string.IsNullOrEmpty(aiPanelsJson))
        {
            try { LoadAiPanels(aiPanelsJson); }
            catch (Exception ex) { Emit("error", "", "", "ai_panels_load_failed", -1, -1, ex.GetType().Name); }
        }
        // Agent surfaces — same "a bad payload must never take the helper down"
        // rule, opposite fail direction: a load failure leaves _agentSurfaces
        // empty, which means no agent-scoped row can ever narrow a block, so
        // every such row falls back to the whole-app block it produces today.
        if (!string.IsNullOrEmpty(agentSurfacesJson))
        {
            try { LoadAgentSurfaces(agentSurfacesJson); }
            catch (Exception ex) { Emit("error", "", "", "agent_surfaces_load_failed", -1, -1, ex.GetType().Name); }
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

    // ── IDE-hosted AI panels ────────────────────────────────────────────────
    // Detection for AI composers that live INSIDE an IDE (Claude Code and
    // GitHub Copilot Chat as VS Code extensions, Cursor's own composer).
    //
    // The problem this solves: every block decision below gates on _fgIsAi,
    // which was true only when the foreground PROCESS NAME was in the AI
    // catalog. VS Code's ("Code") was in no catalog, so nothing in it was ever
    // scanned; Cursor's was, so EVERY keystroke anywhere in Cursor was scanned.
    // Neither is what we want: enforcement has to follow the focused ELEMENT.
    //
    // Detection is a single property read of AutomationElement.FocusedElement
    // on the poll thread — the exact pattern UpdateUia/UpdatePendingRewrite
    // already use — never a tree walk. SetFocus() on these elements was
    // confirmed live to update the system's global FocusedElement, so the
    // existing poll-based read sees them with no new machinery.

    static string StripExe(string s)
    {
        if (string.IsNullOrEmpty(s)) return "";
        return s.EndsWith(".exe", StringComparison.OrdinalIgnoreCase) ? s.Substring(0, s.Length - 4) : s;
    }

    static string JsStr(Dictionary<string, object> d, string key)
    {
        object v;
        if (d != null && d.TryGetValue(key, out v) && v != null) return Convert.ToString(v);
        return "";
    }

    static bool JsBool(Dictionary<string, object> d, string key)
    {
        object v;
        if (d != null && d.TryGetValue(key, out v) && v is bool) return (bool)v;
        return false;
    }

    // A numeric catalog field, CLAMPED here rather than trusted. Absent, null,
    // non-numeric and out-of-range all land on a value inside [min, max], so no
    // payload — an older build, a typo, a hand-edited env var — can push a
    // timing constant outside the range the surrounding arithmetic was reasoned
    // about. Same fail-safe direction as JsBool's `false` and JsStr's "".
    static int JsIntClamped(Dictionary<string, object> d, string key, int fallback, int min, int max)
    {
        object v;
        if (d == null || !d.TryGetValue(key, out v) || v == null) return fallback;
        int parsed;
        // Invariant culture explicitly: the payload is JSON, not localized text.
        if (!int.TryParse(Convert.ToString(v, System.Globalization.CultureInfo.InvariantCulture),
                          System.Globalization.NumberStyles.Integer,
                          System.Globalization.CultureInfo.InvariantCulture, out parsed)) return fallback;
        if (parsed < min) return min;
        if (parsed > max) return max;
        return parsed;
    }

    static void LoadIdeProcesses(string json)
    {
        var serializer = new JavaScriptSerializer();
        var raw = (object[])serializer.DeserializeObject(json);
        var procs = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var fallback = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var item in raw)
        {
            var d = (Dictionary<string, object>)item;
            string name = StripExe(JsStr(d, "name")).Trim();
            if (name.Length == 0) continue;
            procs.Add(name);
            if (JsBool(d, "panelFallback")) fallback.Add(name);
        }
        _ideProcs = procs;
        _ideFallbackProcs = fallback;
    }

    static void LoadAiPanels(string json)
    {
        var serializer = new JavaScriptSerializer();
        var raw = (object[])serializer.DeserializeObject(json);
        var panels = new List<PanelSig>();
        foreach (var item in raw)
        {
            var d = (Dictionary<string, object>)item;
            string id = JsStr(d, "id");
            string ct = JsStr(d, "controlType");
            if (id.Length == 0 || ct.Length == 0) continue;
            var procs = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            object rawProcs;
            if (d.TryGetValue("procs", out rawProcs) && rawProcs != null)
            {
                foreach (var p in (IEnumerable)rawProcs)
                {
                    string name = Convert.ToString(p);
                    if (!string.IsNullOrEmpty(name)) procs.Add(StripExe(name).Trim());
                }
            }
            if (procs.Count == 0) continue;   // a signature with no host process can never match
            panels.Add(new PanelSig
            {
                Id = id,
                Procs = procs,
                ControlType = ct,
                NameEquals = JsStr(d, "nameEquals"),
                NamePrefix = JsStr(d, "namePrefix"),
                ClassEquals = JsStr(d, "classEquals"),
                ClassPrefix = JsStr(d, "classPrefix"),
                Enforce = JsBool(d, "enforce"),
                // Absent / anything but the one literal means the STRICT
                // "a named agent row is required" rule, so a payload from an
                // older build (or a malformed entry) can never widen DLP
                // governance by accident.
                DlpMatch = string.Equals(JsStr(d, "dlpMatch"), "panel", StringComparison.OrdinalIgnoreCase) ? "panel" : "agent",
                // Absent means the default combo; a value this side does not
                // recognise is kept VERBATIM so ResolveNewlineKeys can refuse it
                // rather than fall back to a combo the app might treat as send.
                NewlineKeys = JsStr(d, "newlineKeys"),
                // Absent means the DEFAULT single read at +200ms — i.e. exactly
                // the behaviour that shipped before this field existed. Clamped
                // to [REWRITE_POST_SEND_MS, REWRITE_POST_SEND_MAX_MS] so an
                // entry can only ever lengthen the confirmation window, never
                // shorten it below the read that native composers rely on, and
                // never past the point where the rewrite would outlive the
                // dialog waiting for its answer.
                PostSendVerifyMs = JsIntClamped(d, "postSendVerifyMs",
                    REWRITE_POST_SEND_MS, REWRITE_POST_SEND_MS, REWRITE_POST_SEND_MAX_MS),
            });
        }
        _panels = panels;
    }

    // CFAI_AGENT_SURFACES → _agentSurfaces. Same try/catch shape as LoadAiPanels
    // (the caller catches, so a malformed payload cannot take the helper down),
    // and the same "assign only at the end" discipline — which here means a
    // failure leaves the list EMPTY, i.e. no block is ever narrowed. Fail closed.
    static void LoadAgentSurfaces(string json)
    {
        var serializer = new JavaScriptSerializer();
        var raw = (object[])serializer.DeserializeObject(json);
        var surfaces = new List<AgentSurface>();
        var hostApps = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var item in raw)
        {
            var d = (Dictionary<string, object>)item;
            string id = JsStr(d, "id");
            string ct = JsStr(d, "controlType");
            // Only the id is required of EVERY entry now. The control type is
            // required of a composer-name surface (it identifies the composer
            // element) and meaningless to a window-title one, so it moved down
            // into that mode's own validation rather than staying a blanket
            // guard here.
            if (id.Length == 0) continue;
            var procs = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            object rawProcs;
            if (d.TryGetValue("procs", out rawProcs) && rawProcs != null)
            {
                foreach (var p in (IEnumerable)rawProcs)
                {
                    string name = Convert.ToString(p);
                    if (!string.IsNullOrEmpty(name)) procs.Add(StripExe(name).Trim());
                }
            }
            if (procs.Count == 0) continue;   // a surface with no host process can never match
            // Absent / anything unrecognised means the ORIGINAL composer-name
            // mode, so m365_copilot's payload is completely unaffected by this
            // field existing. Only the one literal opts into the title parse.
            string readFrom = JsStr(d, "read");
            bool titleMode = string.Equals(readFrom, "window_title", StringComparison.OrdinalIgnoreCase);
            var prefixes = new List<string>();
            object rawPrefixes;
            if (d.TryGetValue("composerNamePrefixes", out rawPrefixes) && rawPrefixes != null)
            {
                foreach (var x in (IEnumerable)rawPrefixes)
                {
                    string pre = Convert.ToString(x);
                    if (!string.IsNullOrEmpty(pre)) prefixes.Add(pre);
                }
            }
            string titleSep = JsStr(d, "titleSeparator");
            string titleSuffix = NormalizeAgentName(JsStr(d, "titleSuffix"));
            var titleKinds = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            object rawKinds;
            if (d.TryGetValue("titleKinds", out rawKinds) && rawKinds != null)
            {
                foreach (var x in (IEnumerable)rawKinds)
                {
                    string k = NormalizeAgentName(Convert.ToString(x));
                    if (k.Length > 0) titleKinds.Add(k);
                }
            }
            // Each mode validates on the fields IT can read a name with. A
            // half-configured entry is dropped rather than kept, in both modes:
            // a surface that can never read a name would silently narrow
            // nothing (composer mode) or gate nothing (title mode).
            if (titleMode)
            {
                if (titleSep.Length == 0 || titleSuffix.Length == 0 || titleKinds.Count == 0) continue;
            }
            else
            {
                if (ct.Length == 0) continue;         // no control type → cannot identify the composer
                if (prefixes.Count == 0) continue;    // nothing to strip → nothing readable
            }
            var generics = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            object rawGenerics;
            if (d.TryGetValue("genericNames", out rawGenerics) && rawGenerics != null)
            {
                foreach (var x in (IEnumerable)rawGenerics)
                {
                    string g = NormalizeAgentName(Convert.ToString(x));
                    if (g.Length > 0) generics.Add(g);
                }
            }
            bool hostApp = JsBool(d, "hostApp");
            if (hostApp) { foreach (string p in procs) hostApps.Add(p); }
            // ── The nested SECOND-ROUTE block, when the entry declares one ──
            //
            // ABSENT is the normal case and must cost nothing: every field stays
            // null/empty/false, FallbackConfigured() is false, and not one line
            // of the fallback path can ever run. m365_copilot's payload never
            // carries this key, so its behaviour here is byte-for-byte what it
            // has always been.
            //
            // MALFORMED / PARTIAL is DROPPED ENTIRELY rather than partially
            // applied — same "build locals, assign only at the end" discipline
            // the rest of this parser uses, and the same fail direction: a
            // half-configured fallback that could read a name from one signal
            // but not the other is exactly the kind of thing that silently
            // half-works. Anything missing means the route simply does not
            // exist on this surface.
            //
            // NOTE the two literal strings are NOT normalized here. " said:"
            // and " Created by " carry leading/trailing spaces that ARE the
            // delimiter; running them through NormalizeAgentName (as the title
            // suffix and the kinds legitimately are) would trim exactly the
            // characters that make them work.
            string fbMode = "";
            var fbPaneKinds = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            string fbHeadingClass = "", fbHeadingSuffix = "", fbLandingInfix = "";
            var fbGenerics = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            bool fbEnforce = false, fbVerified = false;
            object rawFallback;
            if (d.TryGetValue("fallbackRead", out rawFallback) && rawFallback is Dictionary<string, object>)
            {
                var fb = (Dictionary<string, object>)rawFallback;
                string mode = JsStr(fb, "mode");
                string headingClass = JsStr(fb, "headingClass");
                string headingSuffix = JsStr(fb, "headingSuffix");
                string landingInfix = JsStr(fb, "landingInfix");
                var paneKinds = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                object rawPaneKinds;
                if (fb.TryGetValue("paneKinds", out rawPaneKinds) && rawPaneKinds != null)
                {
                    foreach (var x in (IEnumerable)rawPaneKinds)
                    {
                        string k = NormalizeAgentName(Convert.ToString(x));
                        if (k.Length > 0) paneKinds.Add(k);
                    }
                }
                var fbGen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                object rawFbGenerics;
                if (fb.TryGetValue("genericNames", out rawFbGenerics) && rawFbGenerics != null)
                {
                    foreach (var x in (IEnumerable)rawFbGenerics)
                    {
                        string g = NormalizeAgentName(Convert.ToString(x));
                        if (g.Length > 0) fbGen.Add(g);
                    }
                }
                // Every field this mode needs, or the whole block is dropped.
                // A pane-kind list is required too: without it the gate would be
                // "attempt the walk in EVERY Teams view", which is precisely the
                // cost and privacy expansion the gate exists to prevent.
                bool ok = string.Equals(mode, "message_heading", StringComparison.OrdinalIgnoreCase)
                    && paneKinds.Count > 0
                    && headingClass.Length > 0
                    && headingSuffix.Length > 0
                    && landingInfix.Length > 0;
                if (ok)
                {
                    fbMode = "message_heading";
                    fbPaneKinds = paneKinds;
                    fbHeadingClass = headingClass;
                    fbHeadingSuffix = headingSuffix;
                    fbLandingInfix = landingInfix;
                    fbGenerics = fbGen;
                    fbEnforce = JsBool(fb, "enforce");
                    fbVerified = JsBool(fb, "verified");
                }
            }
            surfaces.Add(new AgentSurface
            {
                Id = id,
                Procs = procs,
                ControlType = ct,
                NamePrefixes = prefixes,
                GenericNames = generics,
                ReadFrom = titleMode ? "window_title" : "composer_name",
                TitleSeparator = titleSep,
                TitleSuffix = titleSuffix,
                TitleKinds = titleKinds,
                HostApp = hostApp,
                Enforce = JsBool(d, "enforce"),
                Verified = JsBool(d, "verified"),
                FallbackMode = fbMode,
                FallbackPaneKinds = fbPaneKinds,
                FallbackHeadingClass = fbHeadingClass,
                FallbackHeadingSuffix = fbHeadingSuffix,
                FallbackLandingInfix = fbLandingInfix,
                FallbackGenericNames = fbGenerics,
                FallbackEnforce = fbEnforce,
                FallbackVerified = fbVerified,
            });
        }
        // The HostApp process set travels with the surfaces it is derived from,
        // and is assigned in the same "only at the very end" style: a throw
        // anywhere above leaves BOTH untouched, so a malformed payload can
        // never half-arm a host app.
        _hostAppProcs = hostApps;
        _agentSurfaces = surfaces;
    }

    // Which AGENT_SURFACES entry hosts this process name, or null.
    static AgentSurface MatchAgentSurface(string proc)
    {
        if (_agentSurfaces == null || _agentSurfaces.Count == 0) return null;
        if (proc == null) return null;
        string name = StripExe(proc).Trim();
        if (name.Length == 0) return null;
        foreach (var s in _agentSurfaces)
        {
            if (s.Procs != null && s.Procs.Contains(name)) return s;
        }
        return null;
    }

    // May a block be NARROWED to one named agent inside this process right now?
    //
    // Requires a surface that is BOTH Verified and Enforce. m365_copilot passed
    // its live verification pass (2026-08-27) and ships with both flags true, so
    // this returns the surface and an agent-scoped row really does narrow to one
    // named agent. Any FUTURE entry ships both false until its own live pass:
    // this then returns null and that row keeps producing the whole-app block it
    // produced before the feature existed. Nothing else in this file has to
    // change either way — this is the only place both flags are read.
    static AgentSurface EnforcingAgentSurface(string proc)
    {
        AgentSurface s = MatchAgentSurface(proc);
        if (s == null) return null;
        return (s.Verified && s.Enforce) ? s : null;
    }

    // Trim + collapse internal whitespace. C# port of ai-processes.js's
    // normalizeAgentName(), applied to BOTH sides of every comparison: a UIA Name
    // can carry a non-breaking space or a doubled space the admin's typed name
    // does not have, and that is not a different agent.
    //
    // char.IsWhiteSpace rather than a hand-written character list, so the Unicode
    // spaces a JS whitespace class also covers (U+00A0 above all - routine in a
    // web-hosted UI's ARIA label) are covered on both sides without the two
    // implementations drifting over a missing entry. No Regex, same reason the
    // panel matcher has none.
    static string NormalizeAgentName(string s)
    {
        if (string.IsNullOrEmpty(s)) return "";
        var sb = new StringBuilder(s.Length);
        bool pendingSpace = false;
        foreach (char c in s)
        {
            if (char.IsWhiteSpace(c)) { if (sb.Length > 0) pendingSpace = true; continue; }
            if (pendingSpace) { sb.Append(' '); pendingSpace = false; }
            sb.Append(c);
        }
        return sb.ToString();
    }

    // C# port of extractAgentName() in ai-processes.js. PURE: given the surface and
    // the focused element's Name, decide NotComposer / Generic / Named(X).
    // "Unreadable" is not decided here — only the read site knows that.
    //
    // Keep in lockstep with the JS side, which is the single source of truth for
    // the catalog and is unit-tested in agent/tests/ai-processes.test.mjs.
    static AgentReadOutcome ExtractAgentName(AgentSurface surface, string controlType, string name, out string agentName)
    {
        agentName = "";
        if (surface == null) return AgentReadOutcome.NotComposer;
        // DISPATCH on how this surface names its agent, mirroring the JS side.
        // A window-title surface gets the TITLE in `name` (the read site puts it
        // there) and ignores controlType, which describes an element it does not
        // read. Every other surface — m365_copilot included — falls through to
        // the composer-Name path below, byte-for-byte unchanged.
        if (string.Equals(surface.ReadFrom, "window_title", StringComparison.OrdinalIgnoreCase))
        {
            return ExtractAgentNameFromTitle(surface, name, out agentName);
        }
        string ct = (controlType ?? "").Trim();
        if (ct.Length == 0) return AgentReadOutcome.NotComposer;
        if (!string.Equals(ct, surface.ControlType, StringComparison.OrdinalIgnoreCase)) return AgentReadOutcome.NotComposer;
        string nm = (name ?? "").Trim();
        if (nm.Length == 0) return AgentReadOutcome.NotComposer;
        if (surface.NamePrefixes == null) return AgentReadOutcome.NotComposer;
        foreach (string pre in surface.NamePrefixes)
        {
            if (string.IsNullOrEmpty(pre)) continue;
            if (nm.Length <= pre.Length) continue;
            if (!nm.StartsWith(pre, StringComparison.OrdinalIgnoreCase)) continue;
            string remainder = NormalizeAgentName(nm.Substring(pre.Length));
            if (remainder.Length == 0) return AgentReadOutcome.NotComposer;
            // The Generic filter runs BEFORE any matching, so an agent literally
            // named "Copilot" can never be matched through this mechanism. That is
            // intentional: a platform-scoped row is the right tool for "block all
            // of Copilot".
            if (surface.GenericNames != null && surface.GenericNames.Contains(remainder)) return AgentReadOutcome.Generic;
            agentName = remainder;
            return AgentReadOutcome.Named;
        }
        return AgentReadOutcome.NotComposer;
    }

    // ── Window-title agent reads (host apps) ────────────────────────────────
    // Bound on the title we will parse. Well past the longest measured Teams
    // title; a window title is set by another process and must never be able to
    // make this loop expensive.
    const int TITLE_PARSE_MAX = 512;
    const int PARTICIPANT_MAX_SEGMENT = 40;
    const int PARTICIPANT_MAX_WORD = 20;
    const int PARTICIPANT_MAX_WORDS = 3;
    static readonly string PARTICIPANT_SEP = ", ";

    // One character of a plausible person display-name fragment. char.IsLetter
    // (the Unicode letter CATEGORY, so accented and non-Latin names count), plus
    // space/tab, apostrophe (both the ASCII and the typographic one), hyphen and
    // period. ANY digit disqualifies outright.
    static bool IsNameChar(char c)
    {
        if (c >= '0' && c <= '9') return false;
        if (c == ' ' || c == '\t') return true;
        // ’ (the typographic apostrophe) written as an escape, not as a
        // literal: this C# lives inside a PowerShell here-string, and a
        // non-ASCII character literal would depend on how the .ps1 file is
        // decoded at load time.
        if (c == '\'' || c == '\u2019') return true;
        if (c == '-' || c == '.') return true;
        return char.IsLetter(c);
    }

    // C# port of looksLikeParticipantList() in ai-processes.js — Microsoft
    // Teams' OWN default name for a multi-person group chat, the participants'
    // display names comma+space joined ("alex, max").
    //
    // A group chat and an agent conversation give IDENTICALLY-shaped titles, so
    // the kind segment alone cannot separate them; this recognises the
    // no-deliberate-intent case. It does NOT stop a deliberate rename of a chat
    // to a string that exactly equals a blocked agent's name — that residual
    // risk is accepted, not solved. Defence in depth, and its failure direction
    // is the safe one: a false positive here only ever means "do not block".
    //
    // No Regex, same rule as every other comparison in this path, and a plain
    // character loop like NormalizeAgentName's.
    static bool LooksLikeParticipantList(string name)
    {
        string value = name ?? "";
        // No comma+space anywhere → not Teams' joined form at all.
        if (value.IndexOf(PARTICIPANT_SEP, StringComparison.Ordinal) < 0) return false;
        string[] segments = value.Split(new string[] { PARTICIPANT_SEP }, StringSplitOptions.None);
        int nonEmpty = 0;
        foreach (string s in segments) { if (s.Trim().Length > 0) nonEmpty++; }
        if (nonEmpty < 2) return false;   // one segment is a name, not a list
        foreach (string segment in segments)
        {
            if (segment.Length > PARTICIPANT_MAX_SEGMENT) return false;
            int words = 0, wordLen = 0;
            // i == segment.Length feeds a virtual trailing space, so the last
            // word is counted without duplicating the tally after the loop.
            for (int i = 0; i <= segment.Length; i++)
            {
                char c = (i < segment.Length) ? segment[i] : ' ';
                if (i < segment.Length && !IsNameChar(c)) return false;
                if (c == ' ' || c == '\t')
                {
                    if (wordLen > 0) { words++; if (wordLen > PARTICIPANT_MAX_WORD) return false; }
                    wordLen = 0;
                }
                else wordLen++;
            }
            if (words < 1 || words > PARTICIPANT_MAX_WORDS) return false;
        }
        return true;
    }

    // C# port of extractAgentNameFromTitle() in ai-processes.js. PURE: given the
    // surface and the foreground window's TITLE, decide NotComposer / Generic /
    // Named(X). "Unreadable" is not decided here — only the read site knows it.
    //
    // Keep in lockstep with the JS side, which is the single source of truth and
    // is unit-tested against the measured live titles in
    // agent/tests/ai-processes.test.mjs.
    //
    // The title is parsed, compared against the blocklist and dropped. It is
    // never emitted, logged or persisted — the same rule the composer-Name read
    // follows, and the stricter one here, because a Teams title carries a
    // colleague's name and the signed-in user's email address.
    // C# port of titleSegments() in ai-processes.js. Splits a window title into
    // its normalized segments, or returns null when the string is not this
    // surface's title at all. Written down ONCE so TitleKindOf and
    // ExtractAgentNameFromTitle cannot disagree about what a title even is.
    static string[] TitleParts(AgentSurface surface, string title)
    {
        if (surface == null) return null;
        string raw = title ?? "";
        if (raw.Length == 0) return null;
        if (raw.Length > TITLE_PARSE_MAX) raw = raw.Substring(0, TITLE_PARSE_MAX);
        // Strip a leading unread-count decoration, e.g. "(3) Chat | ...".
        // HYPOTHESISED, not live-measured — done defensively because it costs
        // nothing if it never fires and a missed strip would disable the read.
        if (raw[0] == '(')
        {
            int i = 1;
            while (i < raw.Length && raw[i] >= '0' && raw[i] <= '9') i++;
            if (i > 1 && i < raw.Length && raw[i] == ')')
            {
                i++;
                while (i < raw.Length && (raw[i] == ' ' || raw[i] == '\t')) i++;
                raw = raw.Substring(i);
            }
        }
        string normalized = NormalizeAgentName(raw);
        if (normalized.Length == 0) return null;
        string sep = surface.TitleSeparator ?? "";
        string suffix = NormalizeAgentName(surface.TitleSuffix);
        if (sep.Length == 0 || suffix.Length == 0) return null;
        string[] parts = normalized.Split(new string[] { sep }, StringSplitOptions.None);
        // The LAST segment must be the app's own suffix, exactly. This is what
        // stops any other window in any other app being parsed as a Teams title.
        if (!string.Equals(NormalizeAgentName(parts[parts.Length - 1]), suffix, StringComparison.OrdinalIgnoreCase))
            return null;
        // Fewer than three segments cannot name anything: no room for a kind, a
        // name and the app suffix.
        if (parts.Length < 3) return null;
        return parts;
    }

    // C# port of titleKindOf() in ai-processes.js. WHICH VIEW of the app the
    // title says is open — its first ("kind") segment, normalized — or "" when
    // the string is not this surface's title at all.
    //
    // THE single definition of "which Teams view is this", with two consumers
    // that must never disagree: the primary title parse (which requires a
    // TitleKinds match before it will read a conversation NAME out of segment 1)
    // and the Copilot-tab heading fallback's gate (which requires a
    // FallbackPaneKinds match before it will attempt anything at all). Different
    // lists on purpose; one answer about the view.
    //
    // The value is only ever COMPARED against a catalog list — never used as a
    // name, never retained, never emitted.
    static string TitleKindOf(AgentSurface surface, string title)
    {
        string[] parts = TitleParts(surface, title);
        if (parts == null) return "";
        return NormalizeAgentName(parts[0]);
    }

    static AgentReadOutcome ExtractAgentNameFromTitle(AgentSurface surface, string title, out string agentName)
    {
        agentName = "";
        if (surface == null) return AgentReadOutcome.NotComposer;
        string[] parts = TitleParts(surface, title);
        if (parts == null) return AgentReadOutcome.NotComposer;
        // The FIRST segment must be a kind that introduces a NAMEABLE
        // conversation. A plain 1:1 DM has no kind segment at all, so it lands
        // here as no evidence rather than as an agent named after a colleague;
        // so do a channel view, the Activity tab and the generic Copilot panel
        // (whose second segment is the TENANT, not a conversation name — which
        // is why 'Copilot' must never be a TitleKind, and why the Copilot tab
        // needs the separate heading fallback instead).
        string kind = TitleKindOf(surface, title);
        if (surface.TitleKinds == null || !surface.TitleKinds.Contains(kind)) return AgentReadOutcome.NotComposer;
        // The conversation name is the SECOND segment. Everything between it and
        // the suffix (org, tenant, the signed-in email) identifies the USER, not
        // the conversation, and is ignored and never retained.
        string name = NormalizeAgentName(parts[1]);
        if (name.Length == 0) return AgentReadOutcome.NotComposer;
        if (LooksLikeParticipantList(name)) return AgentReadOutcome.Generic;
        if (surface.GenericNames != null && surface.GenericNames.Contains(name)) return AgentReadOutcome.Generic;
        agentName = name;
        return AgentReadOutcome.Named;
    }

    // ── Copilot-tab heading reads (the SECOND Teams UI route) ───────────────
    //
    // C# port of extractAgentNameFromHeading() in ai-processes.js. PURE: given
    // the surface and a set of ALREADY-COLLECTED heading candidates, decide
    // NotComposer / Generic / Named(X). It does no walking and no reading of its
    // own — exactly like ExtractAgentNameFromTitle takes a title string rather
    // than fetching one. The collecting is GetCachedCopilotHeadings' job, on a
    // background thread, and lives well away from here.
    //
    // Candidates arrive as two PARALLEL ARRAYS rather than a struct list: same
    // shape Start() already uses for the pattern table, and it is what lets the
    // offline harness drive this function by reflection with no type plumbing.
    //
    // Keep in lockstep with the JS side, which is the single source of truth and
    // is unit-tested against the measured live strings in
    // agent/tests/ai-processes.test.mjs.
    //
    // AMBIGUITY IS NO EVIDENCE. Two headings that disagree about the agent's
    // name (a mixed or stale transcript, a pane that re-rendered mid-walk) yield
    // NotComposer, never a block. For a HOST APP the fail direction is inverted
    // — "cannot tell which agent is open" must never mean "block anyway" when
    // the app is a company's communications client.
    //
    // Nothing read here is ever emitted, logged or persisted.
    static AgentReadOutcome ExtractAgentNameFromHeading(AgentSurface surface, string[] headingClasses, string[] headingNames, out string agentName)
    {
        agentName = "";
        if (surface == null) return AgentReadOutcome.NotComposer;
        if (!string.Equals(surface.FallbackMode, "message_heading", StringComparison.OrdinalIgnoreCase))
            return AgentReadOutcome.NotComposer;
        if (headingNames == null || headingNames.Length == 0) return AgentReadOutcome.NotComposer;
        string headingClass = surface.FallbackHeadingClass ?? "";
        string suffix = surface.FallbackHeadingSuffix ?? "";
        string infix = surface.FallbackLandingInfix ?? "";

        string found = "";
        bool conflict = false;

        // 1+2. The agent's OWN message headings, identified by CLASS. The user's
        // own headings carry a DIFFERENT class (measured live), so this filter is
        // what makes it impossible to read a human's message as the agent's.
        // Token matching via the existing ClassRuleMatches — a web-hosted
        // element's ClassName is the DOM class ATTRIBUTE and carries build hashes
        // alongside the semantic token.
        if (headingClass.Length > 0 && suffix.Length > 0)
        {
            for (int i = 0; i < headingNames.Length; i++)
            {
                string cls = (headingClasses != null && i < headingClasses.Length) ? (headingClasses[i] ?? "") : "";
                if (cls.Length == 0 || !ClassRuleMatches(cls, headingClass, false)) continue;
                string nm = NormalizeAgentName(headingNames[i]);
                if (nm.Length <= suffix.Length) continue;
                if (!nm.EndsWith(suffix, StringComparison.OrdinalIgnoreCase)) continue;
                string cand = NormalizeAgentName(nm.Substring(0, nm.Length - suffix.Length));
                if (cand.Length == 0) continue;
                if (found.Length == 0) found = cand;
                else if (!string.Equals(found, cand, StringComparison.OrdinalIgnoreCase)) conflict = true;
            }
        }

        // 3. Only when NO message heading matched at all: the landing heading of
        // a freshly-opened conversation ("<Agent> Created by <author>").
        // Deliberately NOT class-filtered — it is a different element entirely,
        // whose class is a generic Fluent heading style shared with other titles,
        // so the infix is the whole signal.
        if (found.Length == 0 && !conflict && infix.Length > 0)
        {
            for (int i = 0; i < headingNames.Length; i++)
            {
                string nm = NormalizeAgentName(headingNames[i]);
                int at = nm.IndexOf(infix, StringComparison.OrdinalIgnoreCase);
                if (at <= 0) continue;
                string cand = NormalizeAgentName(nm.Substring(0, at));
                if (cand.Length == 0) continue;
                if (found.Length == 0) found = cand;
                else if (!string.Equals(found, cand, StringComparison.OrdinalIgnoreCase)) conflict = true;
            }
        }

        if (conflict) return AgentReadOutcome.NotComposer;   // cannot tell → no evidence
        if (found.Length == 0) return AgentReadOutcome.NotComposer;
        // Same ordering as every other reader here: the Generic filter runs
        // BEFORE any matching, so an agent literally named "Copilot" (or a
        // heading that says "You said:") can never be matched through this route.
        if (surface.FallbackGenericNames != null && surface.FallbackGenericNames.Contains(found))
            return AgentReadOutcome.Generic;
        agentName = found;
        return AgentReadOutcome.Named;
    }

    // C# port of agentNameMatches() in ai-processes.js. WHOLE-STRING equality after
    // normalisation, deliberately NOT the substring test the browser extension
    // uses: its signal (a name found somewhere in a page header) is much messier
    // than this one (an exact composer label), and a substring test here would
    // only add false positives — a row for "Advisor" blocking "AI Learning
    // Advisor".
    static bool AgentNameMatches(string extracted, string blockedName)
    {
        string a = NormalizeAgentName(extracted);
        string b = NormalizeAgentName(blockedName);
        if (a.Length == 0 || b.Length == 0) return false;
        return string.Equals(a, b, StringComparison.OrdinalIgnoreCase);
    }

    // A SINGLE property read of the currently-focused element, turned into which
    // named agent is open. Same single-read discipline as ReadFocusedPanel — no
    // tree walk, ever — and the same non-negotiable pid check, for the same
    // measured reason: FocusedElement is a GLOBAL read that routinely returns an
    // element from another window in another process, and nothing it says is
    // evidence about the foreground surface unless the element belongs to it.
    //
    // NOTHING read here is ever emitted, logged or persisted.
    //
    // `fgHwnd` is the SAME handle UpdateForeground already fetched for this tick
    // — no second GetForegroundWindow() call — and is used only by the
    // window-title mode below.
    //
    // `panelId` is the panel THIS tick's panel read already matched (or "" for
    // none). It is not a gate and it is not evidence — the only thing it does is
    // key the Copilot-tab heading cache, which needs it now that both Teams
    // routes can present the same title kind in the same window. See
    // _copilotCachePane.
    static AgentReadOutcome ReadFocusedAgentName(AgentSurface surface, uint fgPid, IntPtr fgHwnd, string panelId, out string agentName)
    {
        agentName = "";
        if (surface == null) return AgentReadOutcome.Unreadable;
        // WINDOW-TITLE MODE (Microsoft Teams). No accessibility read at all:
        // Teams' composer Name is the same literal "Type a message" in every
        // conversation, so the title is the only thing that says which
        // conversation is open. It sits behind the identical privacy gate as the
        // composer read — the caller only reaches here when the current
        // blocklist holds an agent-scoped row covering this process AND the
        // surface has passed its live pass — and an empty/failed read is
        // Unreadable (no evidence), never "no agent open".
        if (string.Equals(surface.ReadFrom, "window_title", StringComparison.OrdinalIgnoreCase))
        {
            if (fgHwnd == IntPtr.Zero) return AgentReadOutcome.Unreadable;
            string title = "";
            try
            {
                int len = GetWindowTextLength(fgHwnd);
                if (len <= 0) return AgentReadOutcome.Unreadable;
                // +1 for the terminator, then capped: a Teams title runs long
                // (kind, name, org, signed-in address, suffix) but never near
                // this, and an unbounded allocation off another process's window
                // is not something this loop should be able to be handed.
                int cap = len + 1;
                if (cap > WINDOW_TITLE_MAX) cap = WINDOW_TITLE_MAX;
                var sb = new StringBuilder(cap);
                if (GetWindowText(fgHwnd, sb, cap) <= 0) return AgentReadOutcome.Unreadable;
                title = sb.ToString();
            }
            catch { return AgentReadOutcome.Unreadable; }
            if (title.Trim().Length == 0) return AgentReadOutcome.Unreadable;
            // Not ExtractAgentName directly any more: a title-mode surface may
            // declare a SECOND UI route whose title carries no conversation name
            // at all (Teams' embedded Copilot tab). ReadTitleModeAgentName runs
            // the primary title parse first and only then, on no evidence and
            // behind that route's own two-flag gate, consults the cached pane
            // headings. With the route unconfigured or unarmed — which is how it
            // ships — it is exactly the ExtractAgentName call this line was.
            return ReadTitleModeAgentName(surface, fgHwnd, title, panelId, out agentName);
        }
        AutomationElement el;
        try { el = AutomationElement.FocusedElement; } catch { return AgentReadOutcome.Unreadable; }
        if (el == null) return AgentReadOutcome.Unreadable;
        try
        {
            // The foreground window's own process, or a DIRECT CHILD of it — a
            // WebView2/Chromium-hosted app (confirmed live: M365Copilot.exe's
            // composer is UIA-owned by a child msedgewebview2.exe, not
            // M365Copilot.exe itself) puts real UI content one process down.
            // Anything else is still rejected, so a genuinely unrelated app's
            // focused element — the entire reason this check exists — is still
            // caught.
            if (!ElementPidBelongsToForeground(el.Current.ProcessId, fgPid)) return AgentReadOutcome.Unreadable;
        }
        catch { return AgentReadOutcome.Unreadable; }

        string ctName = "", name = "";
        try
        {
            string pn = el.Current.ControlType.ProgrammaticName ?? "";
            int dot = pn.LastIndexOf('.');
            ctName = (dot >= 0) ? pn.Substring(dot + 1) : pn;
        }
        catch { }
        try { name = el.Current.Name ?? ""; } catch { }
        // No control type or no Name at all is a READ FAILURE, not a fact about
        // which agent is open: this catalog can only ever conclude anything from
        // those two properties, so their absence is the "no evidence" state the
        // latch deliberately survives — never the authoritative "no agent open".
        if (ctName.Trim().Length == 0 || name.Trim().Length == 0) return AgentReadOutcome.Unreadable;
        return ExtractAgentName(surface, ctName, name, out agentName);
    }

    static readonly char[] CLASS_TOKEN_SEP = new char[] { ' ', '\t', '\r', '\n', '\f' };

    // A className rule matched against the whole string AND against each
    // whitespace-separated TOKEN of it, the way a CSS selector would.
    //
    // Not cosmetic. For a web-hosted element the UIA ClassName IS the DOM class
    // ATTRIBUTE, which routinely holds more than one class — Cursor's own Monaco
    // editor input reports "inputarea monaco-mouse-cursor-text", two classes in
    // one string, measured. `cursor_composer` is the one signature in the catalog
    // with NOTHING to fall back on: an empty Name, no namePrefix, no classPrefix,
    // just its one exact ClassName. So the moment Cursor's
    // composer carries a second class (a state class while it holds text, during
    // its send transition, in a different composer mode) an exact whole-string
    // compare stops matching a composer that is genuinely focused and genuinely
    // stable — and a readable NON-match is what tears a platform block down.
    // claude_code never showed this because its ARIA-driven Name matches
    // independently of any class at all.
    //
    // Still plain string comparison, still no Regex, and still not a substring
    // test: a class that merely CONTAINS a rule must not satisfy it, and neither
    // Cursor's agent-history search input nor a wrapper class around the
    // composer may ever match the composer's own rule. The catalog side of that
    // is asserted case by case in agent/tests/ai-panels.test.mjs.
    static bool ClassRuleMatches(string cls, string want, bool prefix)
    {
        if (string.IsNullOrEmpty(want) || string.IsNullOrEmpty(cls)) return false;
        if (prefix ? cls.StartsWith(want, StringComparison.OrdinalIgnoreCase)
                   : string.Equals(cls, want, StringComparison.OrdinalIgnoreCase)) return true;
        if (cls.IndexOfAny(CLASS_TOKEN_SEP) < 0) return false;
        foreach (string tok in cls.Split(CLASS_TOKEN_SEP))
        {
            if (tok.Length == 0) continue;
            if (prefix ? tok.StartsWith(want, StringComparison.OrdinalIgnoreCase)
                       : string.Equals(tok, want, StringComparison.OrdinalIgnoreCase)) return true;
        }
        return false;
    }

    // Port of ai-processes.js's matchPanelSignature(). Plain string comparison
    // only — no Regex, deliberately: these are fixed literals, and every regex
    // in this file has to carry REGEX_TIMEOUT for a reason that does not need to
    // apply here. Keep the comparison ORDER identical to the JS side, which is
    // unit-tested in agent/tests/ai-panels.test.mjs.
    //
    // Matching is independent of Enforce on purpose: a detection-only panel must
    // still be identified (that is the point of shipping it detection-first);
    // the ENFORCEMENT gates are what consult it.
    static PanelSig MatchPanelSignature(string proc, string controlType, string name, string className)
    {
        if (_panels == null || _panels.Count == 0) return null;
        if (proc == null) return null;
        // Trailing ".exe" only, case-insensitively — matching the JS side's
        // /\.exe$/i exactly. GetForegroundWindow's ProcName() never carries the
        // suffix on Windows, so this is parity insurance rather than a live
        // need; agent/tests verifies the two implementations agree case by case,
        // and it caught this being missing.
        proc = StripExe(proc).Trim();
        if (proc.Length == 0) return null;
        string ct = (controlType ?? "").Trim();
        if (ct.Length == 0) return null;
        string nm = (name ?? "").Trim();
        string cls = (className ?? "").Trim();
        foreach (var p in _panels)
        {
            if (!string.Equals(ct, p.ControlType, StringComparison.OrdinalIgnoreCase)) continue;
            if (p.Procs == null || !p.Procs.Contains(proc)) continue;
            bool hit = false;
            if (p.NameEquals.Length > 0 && nm.Length > 0 && string.Equals(nm, p.NameEquals, StringComparison.OrdinalIgnoreCase)) hit = true;
            if (!hit && p.NamePrefix.Length > 0 && nm.Length > 0 && nm.StartsWith(p.NamePrefix, StringComparison.OrdinalIgnoreCase)) hit = true;
            if (!hit && p.ClassEquals.Length > 0 && cls.Length > 0 && ClassRuleMatches(cls, p.ClassEquals, false)) hit = true;
            if (!hit && p.ClassPrefix.Length > 0 && cls.Length > 0 && ClassRuleMatches(cls, p.ClassPrefix, true)) hit = true;
            if (hit) return p;
        }
        return null;
    }

    // ONE property read of the currently-focused element, matched against the
    // signature table. Returns the matched panel (or null) and, on a match, a
    // stable string form of the element's RuntimeId for the typed-buffer owner
    // key. Runs on the poll thread only — same STA requirement as every other
    // UIA read here.
    //
    // NOTHING read here is ever emitted, logged or persisted: an element Name
    // or ClassName in an IDE can carry a file path or a workspace name.
    //
    // `readable` reports whether this read produced enough evidence to call a
    // non-match AUTHORITATIVE. It is false when FocusedElement threw or was
    // null, and when the properties MatchPanelSignature needs came back empty —
    // an element with no ControlType, or with neither a Name nor a ClassName,
    // could not have matched even if it WERE the composer, so treating it as
    // "the user left the panel" is a read failure dressed up as a fact. That
    // distinction is what the platform-block latch keys on: see
    // PanelBlockLatchHeld and the IDE branch of UpdateForeground.
    //
    // `allowChildProcess` widens the pid rule from "this exact process" to
    // "this process or a DIRECT CHILD of it", via the same
    // ElementPidBelongsToForeground the agent read already uses. FALSE for every
    // IDE — VS Code and Cursor were verified live with the exact-match rule and
    // widening a code editor's read is a separate decision with its own
    // false-positive surface. TRUE only for a HOST APP: new Teams (ms-teams.exe)
    // hosts its real UI in a child msedgewebview2.exe, confirmed live via
    // Win32_Process ParentProcessId, exactly as M365Copilot does — so with the
    // exact rule its composer could never be matched at all.
    static PanelSig ReadFocusedPanel(string proc, uint fgPid, out string runtimeIdKey, out bool readable, bool allowChildProcess)
    {
        runtimeIdKey = "";
        readable = false;
        if (_panels == null || _panels.Count == 0) return null;
        AutomationElement el;
        try { el = AutomationElement.FocusedElement; } catch { return null; }
        if (el == null) return null;

        // AutomationElement.FocusedElement is a GLOBAL read, and it is NOT
        // reliably scoped to the foreground window. Measured live: with a plain
        // console window in the foreground it returned a terminal element
        // belonging to a background VS Code window, in a different process —
        // while three separate elements in three different windows all
        // simultaneously reported HasKeyboardFocus.
        //
        // Nothing that read says is evidence about the foreground surface unless
        // the element actually belongs to it, and both directions of getting
        // this wrong are real bugs:
        //   * a MATCH on a background window's composer would report a panel as
        //     focused while the user is typing in the foreground window's code
        //     editor — the exact false positive panel scoping exists to prevent;
        //   * a readable NON-match on a background window's terminal was being
        //     taken as the authoritative "the user left the panel" answer, and
        //     that is what retires the platform-block latch.
        // So an element we cannot attribute to the foreground process is treated
        // as a read FAILURE (readable stays false, no panel), which is the
        // "no evidence" state the latch already survives.
        try
        {
            if (allowChildProcess) { if (!ElementPidBelongsToForeground(el.Current.ProcessId, fgPid)) return null; }
            else if (el.Current.ProcessId != (int)fgPid) return null;
        }
        catch { return null; }

        string ctName = "", name = "", cls = "";
        try
        {
            // ProgrammaticName is "ControlType.Edit" — stable and culture
            // independent, unlike LocalizedControlType. Take the last segment so
            // the catalog can say plain "Edit".
            string pn = el.Current.ControlType.ProgrammaticName ?? "";
            int dot = pn.LastIndexOf('.');
            ctName = (dot >= 0) ? pn.Substring(dot + 1) : pn;
        }
        catch { }
        try { name = el.Current.Name ?? ""; } catch { }
        try { cls = el.Current.ClassName ?? ""; } catch { }

        // Mirrors MatchPanelSignature's own preconditions exactly — it bails on
        // an empty control type, and can only ever hit on a non-empty Name or
        // ClassName. No property value is stored or emitted here, only whether
        // there was one.
        readable = ctName.Trim().Length > 0 && (name.Trim().Length > 0 || cls.Trim().Length > 0);

        PanelSig hit = MatchPanelSignature(proc, ctName, name, cls);
        if (hit == null) return null;
        try
        {
            int[] rid = el.GetRuntimeId();
            if (rid != null) runtimeIdKey = string.Join(".", Array.ConvertAll(rid, delegate(int i) { return i.ToString(); }));
        }
        catch { }
        return hit;
    }

    // Is the CURRENT foreground surface allowed to enforce at all?
    //
    // Only ever false for a detection-only panel (AI_PANELS enforce:false —
    // today just GitHub Copilot Chat, whose signature is unverified). Gating
    // both capture (FgIsAiNow) and blocking (CheckFgBlocked's panel branch,
    // PanelUiaOk) on this is what makes "detection-only" mean genuinely zero
    // live effect rather than "no effect in one of the two places".
    //
    // A HOST APP (Microsoft Teams) is stated POSITIVELY rather than inheriting
    // the "not a panel → fine" default: a host app is only ever an AI surface
    // while the one governed conversation's composer is focused, so if that is
    // not what this tick is looking at, nothing about it may enforce or capture.
    // ApplyForegroundTick already refuses to set _fgIsAi otherwise, so this is
    // belt-and-braces — but it is the kind of default a future change must have
    // to opt out of deliberately, not fall out of by accident.
    static bool PanelEnforceOk()
    {
        if (_hostAppProcs.Contains(_app)) return _fgIsPanel && _fgPanelEnforce;
        if (!_fgIsPanel) return true;   // pure chat app, or an IDE whole-app fallback
        return _fgPanelEnforce;
    }

    // May the UIA-derived signals (_blockUia, the pending-rewrite candidate) be
    // trusted for the current foreground?
    //
    // For a pure chat app: yes whenever _fgIsAi, exactly as before — the focused
    // element IS the composer.
    //
    // For an IDE: only while a panel is focused RIGHT NOW. Not "was focused
    // within the sticky window" — during those 3s the caret may already be back
    // in the code editor, and a UIA read then reflects source code or terminal
    // output (routinely full of real keys and tokens), which is precisely the
    // false-positive the old blanket IDE-name exclusion existed to avoid.
    //
    // A HOST APP (Microsoft Teams) gets the IDE treatment for exactly the same
    // reason: the foreground process being Teams says nothing about whether the
    // focused element is the one governed conversation's composer. Between them
    // sit every DM, every channel and every meeting chat, whose content this
    // must never read. Only while the governed composer is focused RIGHT NOW —
    // which, for a host app, ApplyForegroundTick only ever sets on a tick that
    // is blockGoverned or dlpGoverned — may a UIA-derived signal be trusted.
    static bool PanelUiaOk()
    {
        if (!_ideProcs.Contains(_app) && !_hostAppProcs.Contains(_app)) return true;
        return _fgIsPanel && _fgPanelEnforce && _fgLeftAiTicks == 0;
    }

    // ── Copilot-tab heading fallback: background search + cache ──────────────
    //
    // WHAT THIS IS FOR. Microsoft Teams has TWO routes to an agent. The Chat-list
    // route names the open conversation in the WINDOW TITLE ("Chat | <agent> |
    // …") and is what the title parse above reads; that route is live-verified
    // and enforcing. The embedded "Copilot" tab does not: its title is the
    // generic, CONSTANT "Copilot | <tenant> | <email> | Microsoft Teams" no
    // matter which agent is open (measured live 2026-09), so the title parse
    // correctly returns NO EVIDENCE and the agent is invisible to it. The name is
    // in the PANE instead, on an accessible heading — which means finding it
    // costs a tree walk, and a tree walk is exactly what the read path above
    // must never do.
    //
    // WHY IT LOOKS LIKE THE MODEL PICKER'S MACHINERY. Because it is the same
    // problem, and this file already solved it once: an expensive UIA search that
    // cannot run on the 150ms poll thread. SearchModelPickerBackground /
    // GetCachedModelPicker are the pattern — background STA thread, a
    // reentrancy guard, a minimum interval between searches, and a poll thread
    // that only ever reads whatever is currently cached and NEVER waits. This is
    // deliberately the same shape rather than a second invention.
    //
    // WHY A MANUAL TreeWalker AND NOT FindAll. Both measured facts in this file
    // apply here and point the same way:
    //   * a full FindAll(Descendants) tree walk measured 1.4-5.8s live against a
    //     real chat app — an order of magnitude too slow for the poll loop, which
    //     is why this runs on its own thread at all;
    //   * FindAll with a PropertyCondition/OrCondition filter against a
    //     Chromium/WebView2-hosted app's OWN web-rendered controls was measured
    //     finding NOTHING (four real attempts) while a plain TreeWalker walk over
    //     the same content found the target without difficulty. Teams' Copilot
    //     tab is exactly such a surface, so a property-filtered FindAll is not an
    //     option here — see FindMenuItemByLabel, which made the same call.
    //
    // WALK TIMING — exercised live, not instrumented. The two strategies below
    // (parent-hop-then-bounded-walk, and the window-rooted depth-capped walk)
    // were exercised live on 2026-09-02, multiple times across multiple
    // scenarios, against this specific Teams pane: the block armed and the send
    // was stopped each time it should have been, and released each time it
    // should not, with no perceptible lag during real interactive use. That is
    // the practical thing this note was gating on — the background search +
    // cache resolves fast enough for the block to arm before the user sends —
    // and it is satisfied.
    //
    // WHAT WAS NOT MEASURED, stated plainly: no instrumented per-walk duration
    // was captured, so there is no millisecond figure for either strategy and
    // none is claimed here. The bounds remain structural (a hop limit, a depth
    // cap, a node cap) and the walk still runs off the poll thread, so a slow
    // walk can only ever delay the cache, never stall the loop. Adding real
    // duration logging around both strategies is a genuine open improvement and
    // the only way this gets a number.
    //
    // THE PRIVACY RULE, enforced in code and not by convention — see
    // CollectCopilotHeadings.
    //
    // ── WHY THE ANCESTOR SEARCH COLLECTS AT EVERY HOP (changed 2026-09-04) ──
    // This mechanism was built for, and measured against, the Copilot TAB, where
    // the focused composer sits a known distance below the conversation pane.
    // Then Teams was observed live serving the Copilot-shaped title
    // ("Copilot | <tenant> | <email> | Microsoft Teams") for a CHAT-LIST
    // conversation — see the pane-key note on _copilotCachePane — which routes a
    // COMPLETELY DIFFERENT composer (CKEditor, nested to its own depth) into this
    // same search. "Hop exactly N parents, then collect from there" encodes an
    // assumption about one route's DOM nesting, and there is no measurement for
    // the other's. Collecting at EACH hop from the nearest outward and stopping
    // at the first ancestor whose subtree yields a heading makes the strategy
    // depth-agnostic instead: it finds the nearest ancestor that actually
    // contains the transcript, whatever route put focus where it is.
    //
    // It is not more expensive. The node budget is now SHARED across the hops
    // (CollectCopilotHeadings takes `ref int visited`), so the total node count
    // for the whole ancestor search is the same COPILOT_WALK_MAX_NODES a single
    // walk was already capped at — and the inner subtrees are strict subsets of
    // the outer ones, so the common case (headings found close by) is cheaper
    // than before, never dearer.
    const int COPILOT_PANE_PARENT_HOPS = 6;
    // The same depth cap FindMenuItemByLabel / FindModelPickerButton already use
    // (and the same one the probe and attachment-watcher use), not a new number.
    const int COPILOT_WALK_MAX_DEPTH = 30;
    // A second, independent bound: depth alone does not bound a WIDE tree, and a
    // long transcript is wide. Whichever limit is hit first stops the walk.
    const int COPILOT_WALK_MAX_NODES = 4000;
    // Headings ACCUMULATE in this pane (confirmed live: a second message did not
    // replace the first message's heading), so the collection is capped too.
    const int COPILOT_MAX_HEADINGS = 32;
    static readonly long COPILOT_SEARCH_MIN_INTERVAL = TimeSpan.FromSeconds(1).Ticks;
    // Back off hard once the pane has repeatedly yielded nothing — an idle
    // Copilot home/history view with no conversation in it must not spin.
    static readonly long COPILOT_SEARCH_BACKOFF_INTERVAL = TimeSpan.FromSeconds(5).Ticks;
    const int COPILOT_EMPTY_RUNS_BEFORE_BACKOFF = 3;
    // The cached answer EXPIRES. This is the fail-OPEN bound: for a host app a
    // stale "the blocked agent is open" must never outlive the evidence for it,
    // and switching agents inside the Copilot tab changes neither the window
    // handle nor the title kind, so the TTL is what bounds that case.
    static readonly long COPILOT_CACHE_TTL = TimeSpan.FromSeconds(5).Ticks;

    static volatile bool _copilotSearchInProgress = false;
    static IntPtr _copilotCacheHwnd = IntPtr.Zero;
    // WHICH PANE the cached headings came from. The title's KIND SEGMENT ALONE
    // used to be this key, and on 2026-09-04 that stopped identifying a pane.
    //
    // THE OBSERVATION. Teams was seen live serving the four-segment Copilot-tab
    // title shape — "Copilot | <tenant> | <email> | Microsoft Teams", no
    // conversation name at all — for a CHAT-LIST conversation the user had not
    // navigated away from. Teams chose that; nothing here can prevent it, and
    // the fallback is right to fire on it (that is what recovers the agent's
    // name when the title no longer carries it).
    //
    // WHAT IT BROKE. Both Teams routes live in ONE window, so with kind alone as
    // the key (hwnd, kind) is now the SAME key for two genuinely different panes:
    // the Copilot tab's conversation and a re-titled Chat-list conversation. A
    // cache filled from one could be served to the other for up to the TTL, in
    // either direction — a stale name for the pane actually open. In a
    // governance product that is a false NEGATIVE and a false POSITIVE from the
    // same defect: the wrong agent named is as wrong as no agent named.
    //
    // THE FIX is to key on the focused PANEL ID as well (PaneKeyOf), because
    // that is the one signal that still separates the two routes now that the
    // title does not: teams_composer is the Chat-list CKEditor,
    // teams_copilot_composer is the Copilot tab's Fluent editor, and they can
    // never match the same element (measured — no shared class token). Switching
    // between them is therefore a NEW pane again: the cache does not apply, the
    // empty-runs backoff resets, and a search starts at once.
    static string _copilotCachePane = "";
    static string[] _copilotCacheClasses = null;
    static string[] _copilotCacheNames = null;
    static long _copilotCacheTicks = 0;
    // The key the LAST search was started for, kept apart from the cache's own
    // key so that "we have never searched this pane" and "we searched it and
    // found nothing" stay distinguishable — the first must search at once, the
    // second must back off.
    static IntPtr _copilotSearchHwnd = IntPtr.Zero;
    static string _copilotSearchPane = "";
    static long _copilotLastSearchTicks = 0;
    static int _copilotEmptyRuns = 0;

    // The cache/search key for "which pane are we looking at": the title's kind
    // segment AND the focused panel id. See _copilotCachePane for why the kind
    // alone stopped being enough.
    //
    // Neither half is a name and neither is ever retained beyond the key: the
    // kind is a view label compared against the catalog, the panel id is our own
    // AI_PANELS identifier.
    static string PaneKeyOf(string kind, string panelId)
    {
        return (kind ?? "") + "|" + (panelId ?? "");
    }

    // Is this surface's SECOND ROUTE configured, past its OWN two-flag gate, and
    // relevant to the view the title says is open?
    //
    // Its own pair, NOT the entry's. teams_desktop is Verified+Enforce for the
    // Chat-list route; this route has had no live pass of its own and ships
    // false/false. Mirrors EnforcingAgentSurface's discipline — both flags, read
    // in ONE place — so no call site can forget one.
    static bool FallbackReadArmed(AgentSurface surface, string kind)
    {
        if (surface == null) return false;
        if (!string.Equals(surface.FallbackMode, "message_heading", StringComparison.OrdinalIgnoreCase)) return false;
        if (!(surface.FallbackVerified && surface.FallbackEnforce)) return false;
        if (surface.FallbackPaneKinds == null || string.IsNullOrEmpty(kind)) return false;
        // The KIND segment only. Never the name segment — on this route that is
        // the tenant, not a conversation.
        return surface.FallbackPaneKinds.Contains(kind);
    }

    // The title-mode read, in two stages.
    //
    // STAGE A is the primary title parse, byte-for-byte what this used to be.
    // Anything AUTHORITATIVE (Named/Generic) returns immediately; the fallback is
    // only ever reached from NO EVIDENCE, so it can add coverage and can never
    // override or contradict a title that did name a conversation.
    //
    // STAGE B is the Copilot-tab heading fallback, and it is gated three ways:
    // the route must be configured, past its own two flags, and the title's kind
    // must be one this route applies to. With the flags false — how it ships —
    // FallbackReadArmed returns false before anything else happens, so NOT ONE
    // UIA call, thread or cache write occurs. That is what "inert" means here.
    //
    // THE GATE IS THE TITLE'S KIND, NEVER "the title named nothing". That
    // distinction is the whole safety boundary of this route and it is worth
    // stating at the call site, because 2026-09-04 made it load-bearing in a way
    // it was not before: Teams was observed serving the Copilot-shaped title for
    // a CHAT-LIST conversation, so the fallback now legitimately fires on the
    // Chat-list composer too — and it must STILL never fire for a 1:1 DM (no
    // kind segment), a renamed human group chat or a channel post, all of which
    // also reach here with NotComposer. They keep their own kinds, none of which
    // is in FallbackPaneKinds, so no walk of a colleague conversation's pane is
    // ever attempted. Widening this gate to "any no-evidence title" would put a
    // human conversation's transcript under the walk, which is exactly what the
    // host-app design exists to prevent.
    //
    // `panelId` is the focused panel's id (or "" when nothing matched) and is
    // used ONLY as part of the pane cache key — see _copilotCachePane. It is
    // deliberately not a gate: the gate is the kind, and adding a panel-id
    // condition here would silently narrow the route rather than key its cache.
    static AgentReadOutcome ReadTitleModeAgentName(AgentSurface surface, IntPtr fgHwnd, string title, string panelId, out string agentName)
    {
        AgentReadOutcome outcome = ExtractAgentName(surface, "", title, out agentName);
        if (outcome != AgentReadOutcome.NotComposer) return outcome;
        string kind = TitleKindOf(surface, title);
        if (!FallbackReadArmed(surface, kind)) return outcome;
        string[] classes, names;
        if (!GetCachedCopilotHeadings(surface, fgHwnd, PaneKeyOf(kind, panelId), out classes, out names)) return outcome;
        return ExtractAgentNameFromHeading(surface, classes, names, out agentName);
    }

    // The poll thread's half: read the cache, never wait on a search.
    //
    // Modelled on GetCachedModelPicker. The difference is what gets cached —
    // there, a live AutomationElement whose Name is re-read each tick; here, the
    // already-extracted heading STRINGS, because re-walking a subtree per tick is
    // the cost this whole mechanism exists to avoid. The liveness probe a cached
    // element gives for free is replaced by an explicit key + TTL:
    //   * a different window handle, or a different PANE KEY, is a different
    //     pane — the cache does not apply and a search starts AT ONCE;
    //   * an expired cache is dropped rather than served, which is the fail-OPEN
    //     direction a host app requires.
    //
    // The pane key is (title kind, focused panel id) — see _copilotCachePane for
    // why the kind alone stopped being enough on 2026-09-04. Including the panel
    // id also fixes the SECOND half of that defect: `newPane` is what resets
    // _copilotEmptyRuns, so with kind alone as the key, sitting in an idle
    // Copilot home view (three empty runs → the 5s backoff) and then opening a
    // re-titled Chat-list agent conversation looked like the SAME pane, kept the
    // backoff, and delayed the block by up to 5s in the conversation that
    // actually needed it.
    //
    // NOT keyed on the focused element's runtime identity, and this is a
    // deliberate, documented limitation rather than an oversight: the per-tick
    // element key this file already computes (_fgOwnerKey) is only maintained on
    // ticks where the app IS a governed AI surface, which — on this route, by
    // construction — is exactly what has not been established yet. The (handle,
    // kind, panel id) key plus the TTL is what bounds staleness instead, and the
    // TTL is still what covers switching agents WITHIN one pane.
    static bool GetCachedCopilotHeadings(AgentSurface surface, IntPtr fg, string paneKey, out string[] classes, out string[] names)
    {
        classes = null;
        names = null;
        if (fg == IntPtr.Zero) return false;
        long now = DateTime.UtcNow.Ticks;
        if (_copilotCacheNames != null
            && _copilotCacheHwnd == fg
            && string.Equals(_copilotCachePane ?? "", paneKey ?? "", StringComparison.OrdinalIgnoreCase)
            && (now - _copilotCacheTicks) <= COPILOT_CACHE_TTL)
        {
            classes = _copilotCacheClasses;
            names = _copilotCacheNames;
        }
        else
        {
            _copilotCacheClasses = null;
            _copilotCacheNames = null;
            _copilotCacheHwnd = IntPtr.Zero;
            _copilotCachePane = "";
            _copilotCacheTicks = 0;
        }
        bool newPane = _copilotSearchHwnd != fg
            || !string.Equals(_copilotSearchPane ?? "", paneKey ?? "", StringComparison.OrdinalIgnoreCase);
        if (newPane) _copilotEmptyRuns = 0;
        long interval = (_copilotEmptyRuns >= COPILOT_EMPTY_RUNS_BEFORE_BACKOFF)
            ? COPILOT_SEARCH_BACKOFF_INTERVAL : COPILOT_SEARCH_MIN_INTERVAL;
        if (!_copilotSearchInProgress && (newPane || (now - _copilotLastSearchTicks) > interval))
        {
            _copilotSearchHwnd = fg;
            _copilotSearchPane = paneKey ?? "";
            _copilotLastSearchTicks = now;
            _copilotSearchInProgress = true;
            var t = new Thread(() => SearchCopilotHeadingsBackground(surface, fg, paneKey));
            t.IsBackground = true;
            t.SetApartmentState(ApartmentState.STA);   // UIA requires STA, same as the poll thread
            t.Start();
        }
        return names != null && names.Length > 0;
    }

    // Runs on its OWN background STA thread, never the poll thread — see the
    // section header for the two measured reasons.
    //
    // Two strategies, in order:
    //   1. ANCESTOR SEARCH. Start at the focused element (a Teams message
    //      composer — either route's), walk up a bounded number of parents and
    //      collect downwards FROM EACH ONE, nearest first, stopping at the first
    //      ancestor whose subtree yields a heading. Cheap, keeps the walk off the
    //      rest of the window, and — unlike the "hop exactly N then collect"
    //      shape this replaced — encodes no assumption about how deeply a
    //      particular route nests its composer. See COPILOT_PANE_PARENT_HOPS for
    //      why that mattered from 2026-09-04, and for why the shared node budget
    //      means this is not more expensive.
    //   2. WINDOW-ROOTED, depth-capped. Used only when (1) found nothing, e.g.
    //      because focus is not in the composer at all.
    // A wrong root is harmless rather than dangerous: CollectCopilotHeadings only
    // ever keeps nodes whose CLASS says they are headings, so an unhelpful
    // subtree simply yields nothing and the search moves outward, then to (2).
    static void SearchCopilotHeadingsBackground(AgentSurface surface, IntPtr fg, string paneKey)
    {
        try
        {
            var classes = new List<string>();
            var names = new List<string>();

            // ONE node budget for the whole ancestor search, so walking several
            // ancestors costs no more in total than the single walk this
            // replaced. Strategy 2 gets its own, since it discards (1)'s result.
            int visited = 0;
            try
            {
                AutomationElement el = AutomationElement.FocusedElement;
                if (el != null)
                {
                    uint fgPid = 0;
                    GetWindowThreadProcessId(fg, out fgPid);
                    // The SAME non-negotiable ownership rule every other read in
                    // this file applies. FocusedElement is a GLOBAL read that was
                    // measured returning elements from other windows in other
                    // processes; and Teams hosts its UI in a CHILD WebView2
                    // process, which is why the one-generation rule is used here
                    // rather than an exact pid compare.
                    if (ElementPidBelongsToForeground(el.Current.ProcessId, fgPid))
                    {
                        var up = TreeWalker.ControlViewWalker;
                        AutomationElement cur = el;
                        for (int i = 0; i < COPILOT_PANE_PARENT_HOPS && names.Count == 0; i++)
                        {
                            cur = up.GetParent(cur);
                            if (cur == null) break;
                            CollectCopilotHeadings(surface, cur, classes, names, ref visited);
                        }
                    }
                }
            }
            catch { }

            if (names.Count == 0)
            {
                AutomationElement win = null;
                try { win = AutomationElement.FromHandle(fg); } catch { }
                if (win != null)
                {
                    classes.Clear();
                    names.Clear();
                    int winVisited = 0;
                    CollectCopilotHeadings(surface, win, classes, names, ref winVisited);
                }
            }

            // Assigned only at the END, and only on a search that actually found
            // something — same "never half-apply a result" discipline the catalog
            // parsers use. A search that found nothing leaves the previous cache
            // (and its TTL) exactly as it was and counts toward the backoff.
            if (names.Count > 0)
            {
                _copilotCacheClasses = classes.ToArray();
                _copilotCacheNames = names.ToArray();
                _copilotCacheHwnd = fg;
                _copilotCachePane = paneKey ?? "";
                _copilotCacheTicks = DateTime.UtcNow.Ticks;
                _copilotEmptyRuns = 0;
            }
            else if (_copilotEmptyRuns < COPILOT_EMPTY_RUNS_BEFORE_BACKOFF)
            {
                _copilotEmptyRuns++;
            }
        }
        catch { }
        finally { _copilotSearchInProgress = false; }
    }

    // A depth- and node-capped TreeWalker walk that collects HEADING candidates.
    //
    // THE PRIVACY RULE OF THIS WHOLE MECHANISM, and it is enforced here in code
    // rather than left to the caller's good behaviour. In a Chromium
    // accessibility tree an ordinary message body's Name IS the message text. So:
    //
    //   * ClassName is read FIRST, for every node, always.
    //   * A node's Name is read ONLY when its class already says it is the
    //     agent's message heading, or — for the landing heading, whose class is a
    //     generic Fluent title style and cannot be filtered on — when the node is
    //     a Text control and the value is being tested against the landing infix
    //     and nothing else.
    //   * A Name that fails that test is a LOCAL that goes out of scope. It is
    //     never appended to the lists, never cached, never returned, and there is
    //     no Emit/Console path anywhere in this file's fallback section at all.
    //
    // So what leaves this function is only ever strings of the shape
    // "<Agent> said:" / "<Agent> Created by <author>" — the same class of value
    // the title read already handles, subject to the same rule: compared against
    // the blocklist and dropped.
    //
    // `visited` is passed by REFERENCE so a caller that walks several roots (the
    // ancestor search) spends ONE COPILOT_WALK_MAX_NODES budget across all of
    // them rather than one each. The node cap is what bounds this walk's cost
    // against a long transcript, and it would stop bounding anything if walking
    // N roots meant N times the cap.
    static void CollectCopilotHeadings(AgentSurface surface, AutomationElement root, List<string> classes, List<string> names, ref int visited)
    {
        if (surface == null || root == null) return;
        string headingClass = surface.FallbackHeadingClass ?? "";
        string infix = surface.FallbackLandingInfix ?? "";
        if (headingClass.Length == 0 && infix.Length == 0) return;
        try
        {
            var walker = TreeWalker.ControlViewWalker;
            var stack = new Stack<KeyValuePair<AutomationElement, int>>();
            stack.Push(new KeyValuePair<AutomationElement, int>(root, 0));
            while (stack.Count > 0)
            {
                var cur = stack.Pop();
                if (cur.Value > COPILOT_WALK_MAX_DEPTH) continue;
                if (++visited > COPILOT_WALK_MAX_NODES) break;
                AutomationElement el = cur.Key;
                if (names.Count < COPILOT_MAX_HEADINGS)
                {
                    string cls = "";
                    try { cls = el.Current.ClassName ?? ""; } catch { }
                    bool isHeading = headingClass.Length > 0 && cls.Length > 0
                        && ClassRuleMatches(cls, headingClass, false);
                    bool isText = false;
                    if (!isHeading && infix.Length > 0)
                    {
                        try { isText = (el.Current.ControlType == ControlType.Text); } catch { }
                    }
                    if (isHeading || isText)
                    {
                        string nm = "";
                        try { nm = el.Current.Name ?? ""; } catch { }
                        // isHeading — the class already identified this node, keep
                        // it and let the pure extractor decide.
                        // isText     — keep it ONLY if it carries the landing
                        // infix. Every other message-body Name ends here, unread
                        // by anything and unreferenced after this line.
                        if (nm.Length > 0
                            && (isHeading || nm.IndexOf(infix, StringComparison.OrdinalIgnoreCase) > 0))
                        {
                            classes.Add(cls);
                            names.Add(nm);
                        }
                    }
                }
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
        // IDE processes are excluded ENTIRELY — not panel-scoped like the DLP
        // paths below. Model routing is deliberately out of scope for every IDE
        // panel (Claude Code, Copilot Chat, Cursor's composer alike): there is
        // no probed picker signature for any of them, and switching a model in
        // an IDE panel would mean driving UI this feature has never been tested
        // against. _ideProcs replaces the old hardcoded name set here with no
        // behavior change for Cursor/Code; standalone Microsoft Copilot, which
        // that set wrongly contained, now gets routing like the chat app it is.
        //
        // HOST APPS are excluded on the same terms and for a stronger reason:
        // there is no model picker in Microsoft Teams to detect or drive, and
        // the picker search (FindModelPickerButton) is a descendant-wide UIA
        // walk of the foreground window that has no business running over a
        // chat client's tree on the poll thread.
        if (!_fgIsAi || _ideProcs.Contains(_app) || _hostAppProcs.Contains(_app) || Disarmed()) { ClearPendingRoute(); return; }
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

    // Control channel from the Node parent (the Electron dialog, or the CLI
    // agent's own Tokenize popup). Three commands, and nothing else is read:
    //
    //   {"cmd":"tokenize","block_id":"…"}
    //       Mask-and-send the pinned block. An id, which StartRewrite validates
    //       against its own pinned state.
    //
    //   {"cmd":"tokenize","block_id":"…","text":"…"}
    //       The SAME command with the user's own hand-edited replacement, from
    //       the popup's "Edit manually" view. `text` is THE ONLY FREE TEXT THIS
    //       CHANNEL ACCEPTS, and it is text the user typed into our own dialog
    //       — not anything read off a screen, a clipboard or another process.
    //       It cannot widen what a rewrite may do: StartRewrite still requires
    //       the pinned id, still re-runs every length/write-budget gate against
    //       this text, and RunRewrite still re-verifies window, element and
    //       composer contents before typing and still verifies the read-back
    //       (including a full pattern rescan) before sending. What it replaces
    //       is only WHICH string gets typed — the enforcer's own masked
    //       candidate, or the user's edit of it.
    //
    //   {"cmd":"tokenize_edit","block_id":"…","state":"on"|"off"}
    //       Hold the pinned block while that text box is open. Extends an
    //       EXISTING pin's expiry and nothing else — see HoldPendingRewrite.
    //
    //   {"cmd":"attach_hold","state":"on"|"off","filename":"…","patterns":"…",
    //    "ttl_ms":N,"process":"…"}
    //       The attachment send-hold. `process` BINDS the hold to one app, so a
    //       hold armed for an attachment in one window can no longer swallow the
    //       next Enter in an unrelated one — see _attachHoldProcess. Still no
    //       free text: a filename, pattern NAMES, a process name and a number.
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
                        // ExtractJsonStringUnescaped, not ExtractJsonString: an
                        // edited prompt legitimately contains quotes, newlines
                        // and backslashes, all of which arrive JSON-escaped and
                        // would be truncated or typed literally by the plain
                        // extractor. NULL when the field is absent, which is
                        // how "no edit, use the enforcer's own mask" is told
                        // apart from "the user cleared the box" (refused).
                        string edited = ExtractJsonStringUnescaped(line, "text");
                        if (!string.IsNullOrEmpty(bid)) StartRewrite(bid, edited);
                    }
                    else if (cmd == "tokenize_edit")
                    {
                        string bid = ExtractJsonString(line, "block_id");
                        string state = ExtractJsonString(line, "state");
                        if (!string.IsNullOrEmpty(bid)) HoldPendingRewrite(bid, state == "on");
                    }
                    else if (cmd == "attach_hold")
                    {
                        string state = ExtractJsonString(line, "state");
                        if (state == "on")
                        {
                            _attachHoldFilename = ExtractJsonString(line, "filename");
                            _attachHoldPatterns = ExtractJsonString(line, "patterns");
                            // A bare PROCESS NAME, and the only new field on this
                            // command. It binds the hold to one app — see
                            // _attachHoldProcess / AttachHoldActive.
                            _attachHoldProcess = ExtractJsonString(line, "process");
                            long ttlMs = ExtractJsonNumber(line, "ttl_ms", 3000);
                            _attachHoldExpiresAt = DateTime.UtcNow.Ticks + TimeSpan.FromMilliseconds(ttlMs).Ticks;
                            _attachHoldActive = true;
                        }
                        else if (state == "off")
                        {
                            _attachHoldActive = false;
                            _attachHoldFilename = ""; _attachHoldPatterns = ""; _attachHoldProcess = "";
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
    // "An AI app is the foreground window RIGHT NOW" — as opposed to _fgIsAi,
    // which stays true for FG_STICKY_TTL after focus leaves one. Used only to
    // gate keystroke CAPTURE, never a block decision: see the call site in
    // HookCallback for why those two want different answers.
    // PanelEnforceOk() is part of the CAPTURE gate, not just the block gate: a
    // detection-only panel must not even accumulate keystrokes into the scan
    // buffer, or "no enforcement" would still mean "scanned, and blocked via
    // TypedBlockFresh a moment later".
    static bool FgIsAiNow() { return _fgIsAi && _fgLeftAiTicks == 0 && PanelEnforceOk(); }

    static bool TypedBlockFresh()
    {
        return _blockTyped && (DateTime.UtcNow.Ticks - _typedBlockTicks) < TYPED_BLOCK_TTL;
    }

    // Is the attachment hold in force FOR THE APP THAT HAS FOCUS?
    //
    // The process check is the whole point — see _attachHoldProcess. Compared
    // against _app (the sticky foreground app name, the same field every other
    // block decision in this file is attributed to) case-insensitively, because
    // a process name arrives from Get-Process on one side and from
    // Process.ProcessName on the other and neither promises a casing.
    //
    // Every keystroke decision that consults the hold goes through this, so the
    // binding cannot be forgotten at one call site: the Enter path
    // (HookCallback), the send-button path (BlockActiveForMouse) and the
    // patterns attribution (ActivePatterns).
    static bool AttachHoldActive()
    {
        if (!_attachHoldActive) return false;
        string owner = _attachHoldProcess ?? "";
        if (owner.Length == 0) return true;   // unbound — see _attachHoldProcess
        return string.Equals(owner, _app ?? "", StringComparison.OrdinalIgnoreCase);
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
        // Same split the Enter decision makes, for the same reason: a platform
        // block armed by an enforcing panel survives a tick whose focused-element
        // read landed on a detection-only panel sharing the window, while every
        // CONTENT signal stays gated on the current surface. See _blockedByElement.
        if (_fgIsBlocked && (_blockedByElement || PanelEnforceOk())) return true;
        if (!PanelEnforceOk()) return false;   // detection-only panel — zero live effect
        bool recentPaste = (DateTime.UtcNow.Ticks - _lastPasteTicks) < PASTE_WINDOW;
        bool cooldown = (DateTime.UtcNow.Ticks - _lastBlockFiredTicks) < BLOCK_COOLDOWN;
        return AttachHoldActive() || TypedBlockFresh() || _blockUia || (recentPaste && _blockPaste) || cooldown;
    }

    // The Enter-decision predicate, factored out of HookCallback so the offline
    // harness in agent/tests can assert the REAL decision instead of a copy of
    // it (that harness must never install a hook). Pure: reads state, writes
    // none. The caller passes the four signals it already computed for `pats`.
    //
    // A platform block armed BY AN ENFORCING PANEL is the one signal NOT
    // re-gated on the current tick's PanelEnforceOk(). That flag describes
    // whatever element this tick's global focused-element read happened to land
    // on, and a single read landing on the detection-only Copilot Chat composer
    // that shares the same VS Code window used to let the blocked Enter
    // straight through. CheckFgBlocked's panel branch already refuses to ARM a
    // block for a detection-only panel, so nothing here widens what such a
    // panel can cause — it only stops one from CANCELLING another panel's
    // block. See _blockedByElement.
    static bool EnterBlockActive(bool attachHold, bool uiaBlock, bool clipBlock, bool cooldown)
    {
        if (Disarmed()) return false;
        if (_fgIsBlocked && (_blockedByElement || PanelEnforceOk())) return true;
        if (!PanelEnforceOk()) return false;
        return attachHold || TypedBlockFresh() || uiaBlock || clipBlock || cooldown;
    }

    // Precedence matches the Enter path's `pats` chain, platform block first —
    // otherwise a send-button click on a fully blocked app emitted a block with
    // an empty patterns field and no way for the Node side to tell what it was.
    static string ActivePatterns() { return _fgIsBlocked ? _blockedReason : AttachHoldActive() ? _attachHoldPatterns : _blockTyped ? _typedPatterns : _blockUia ? _uiaPatterns : ""; }

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
                // Focus-move evidence — see _lastFocusMoveInputTicks. A button
                // DOWN anywhere is the one thing that most obviously moves
                // keyboard focus, so it is recorded before any of the send-button
                // logic below (which is scoped to one cached rectangle and to AI
                // apps, and would therefore miss the click that took the user into
                // their code editor — precisely the click that matters here).
                // Movement and wheel are not focus changes and are ignored. Our
                // own synthetic input is excluded. A timestamp only — never the
                // coordinates.
                if (msg == WM_LBUTTONDOWN || msg == WM_RBUTTONDOWN || msg == WM_MBUTTONDOWN || msg == WM_XBUTTONDOWN)
                {
                    uint fmFlags = (uint)Marshal.ReadInt32(lParam, 12);   // MSLLHOOKSTRUCT.flags
                    if ((fmFlags & LLMHF_INJECTED) == 0) _lastFocusMoveInputTicks = DateTime.UtcNow.Ticks;
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
                            if (msg == WM_LBUTTONDOWN)
                            {
                                EmitBlock(_app, ActivePatterns(), "click");
                                // Clicking the send arrow IS a send attempt — in
                                // Teams and Copilot it is the common one — so it
                                // gets the same Request Access offer the Enter
                                // path does, from the same instant. Both sites
                                // call the same stateless function: a click while
                                // a dialog is already open is dropped by the
                                // helper's own concurrency guard, and a click
                                // after one was answered offers again.
                                //
                                // The reason stays "click" rather than gaining an
                                // attachment variant. This path has never drawn
                                // that distinction (ActivePatterns() is what
                                // carries an attachment hold's patterns here), and
                                // changing the literal would change the
                                // blocked_for/how that index.js reports. It costs
                                // nothing: on this path EmitBlock's own
                                // platformBlock term reduces to _fgIsBlocked,
                                // which is exactly OfferAccessRequest's first
                                // gate — so the offer fires precisely when the
                                // block being reported is platform_block:true, and
                                // an attachment-only hold still offers nothing.
                                OfferAccessRequest(_app, "click");
                            }
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

                    // Focus-move evidence — see _lastFocusMoveInputTicks. A plain
                    // character key cannot move keyboard focus out of a text box;
                    // a chord (Ctrl/Alt held), Tab, Escape or an F-key can.
                    // Recorded for every foreground app, AI or not, because the
                    // only question it answers is "could focus have left the
                    // panel at all". Our OWN synthetic input is excluded: Tier B's
                    // rewrite types Ctrl+A, and that must never read as the user
                    // navigating away. A timestamp only — never the key.
                    if (ctrl || alt || vk == VK_TAB || vk == VK_ESCAPE || (vk >= VK_F1 && vk <= VK_F24))
                    {
                        uint fmFlags = (uint)Marshal.ReadInt32(lParam, 8);   // KBDLLHOOKSTRUCT.flags
                        if ((fmFlags & LLKHF_INJECTED) == 0) _lastFocusMoveInputTicks = DateTime.UtcNow.Ticks;
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
                            bid = _pendingBlockId;
                            // Same refusal EmitBlock makes: a FROZEN pin belongs
                            // to a surface that no longer has the foreground, so
                            // it is not an offer this hotkey may take up.
                            rewritable = _pendingRewritable && !_pendingFrozen;
                            whyNot = _pendingFrozen ? "surface_changed" : _pendingWhyNot;
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

                    // PanelBlockLatchHeld() is ORed in, not folded into _fgIsAi,
                    // so this is the ONLY thing it widens: the block-decision
                    // branch below. Everything inside that still needs a live AI
                    // surface asks separately and gets the old answer — capture
                    // goes through FgIsAiNow() (false during the latch, so no
                    // editor keystroke is ever buffered), the UIA and clipboard
                    // signals through PanelUiaOk()/_fgIsAi (both false, so no
                    // content block can be manufactured out of source code).
                    // What survives is _fgIsBlocked: a platform block already
                    // established in an enforcing panel. See _panelBlockLatch.
                    if (_fgIsAi || PanelBlockLatchHeld())
                    {
                        // Reset the typed buffer when the OWNER of its contents
                        // changes. The owner key is a composite (pid + panel id +
                        // focused-element RuntimeId), not just the pid, because
                        // an IDE hosts several surfaces in ONE process: moving
                        // Claude Code panel → code editor → back to the panel
                        // never changes the pid, so a pid-only comparison left
                        // whatever was typed in between sitting in the scan
                        // buffer, to be treated as part of the next AI prompt (or
                        // to keep a stale block armed against it). Composed on
                        // the poll thread — this is a string compare, nothing
                        // more, on the hook thread.
                        if (_fgOwnerKey != _typedOwnerKey)
                        {
                            TypedClear(); _typedOwnerKey = _fgOwnerKey;
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
                        //   2. UIA focused element — for pure chat apps always
                        //      (Claude Desktop, ChatGPT, Gemini), and for an IDE
                        //      only while an enforcing AI panel is the focused
                        //      element right now. See PanelUiaOk: in an IDE, UIA
                        //      otherwise reads code/terminal/output.
                        //   3. Clipboard — ONLY within 5s of a Ctrl+V press.
                        //      Prevents stale clipboard from false-blocking
                        //      while still catching paste-then-Enter.
                        if (vk == VK_RETURN && !shift)
                        {
                            bool uiaBlock = PanelUiaOk() && _blockUia;
                            bool recentPaste = (DateTime.UtcNow.Ticks - _lastPasteTicks) < PASTE_WINDOW;
                            bool clipBlock = recentPaste && _blockPaste;
                            // A sensitive-file attachment holds the send exactly
                            // like a flagged prompt does — see _attachHoldActive's
                            // own comment for the provisional/confirmed story.
                            bool attachHold = AttachHoldActive();
                            // Cooldown: if a block fired recently, keep blocking
                            bool cooldown = (DateTime.UtcNow.Ticks - _lastBlockFiredTicks) < BLOCK_COOLDOWN;
                            // Panic hotkey wins over every other signal: while
                            // disarmed nothing is ever swallowed. PanelEnforceOk
                            // sits at the same level for the same reason: a
                            // detection-only panel must never swallow an Enter
                            // through ANY of the signals below — including the
                            // 30s cooldown or an attachment hold armed while a
                            // different, enforcing surface had focus.
                            bool block = EnterBlockActive(attachHold, uiaBlock, clipBlock, cooldown);
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
                                //
                                // Nor for a FULL PLATFORM BLOCK (_fgIsBlocked).
                                // The override exists so a user with a false
                                // positive on ONE message is not stuck; a
                                // platform block is not a false positive about a
                                // message, it is the org disallowing the whole
                                // app, and there is now a sanctioned way to ask
                                // for it back (Request Access → a time-boxed,
                                // admin-approved exception). Leaving a hotkey
                                // that silently walks through it would make that
                                // approval optional. The panic hotkey is
                                // untouched and still disarms everything.
                                if (ctrl && alt && !attachHold && !_fgIsBlocked) { Emit("override", _app, pats, ""); }  // allow, logged
                                else {
                                    string blockReason = attachHold ? "attachment" : "send";
                                    EmitBlock(_app, pats, blockReason);
                                    // The blocked send just happened — this is the
                                    // one moment the Request Access dialog is
                                    // offered, and it is a SECOND line alongside
                                    // EmitBlock rather than a change to it: the
                                    // block itself is reported, cooled down and
                                    // toasted exactly as before. Self-gating (a
                                    // platform/agent/panel block only) and
                                    // stateless — EVERY blocked send offers, so
                                    // a user who was declined can ask again on
                                    // their next attempt. See OfferAccessRequest.
                                    OfferAccessRequest(_app, blockReason);
                                    return (IntPtr)1;
                                }  // swallow
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
                            if (FgIsAiNow()) { TypedBackspace(); _typedDirty = true; }   // poll thread rescans; no regex here
                        }
                        else if (!ctrl && !alt)
                        {
                            // Accumulate printable characters (ignore Ctrl/Alt combos
                            // like Ctrl+A/Ctrl+C so they don't pollute the buffer).
                            //
                            // FgIsAiNow(), not _fgIsAi: capture requires an AI app to
                            // REALLY be in the foreground, not merely to have been
                            // there within the 3s sticky window. Every block DECISION
                            // above deliberately still uses the sticky flag — that is
                            // what closes the dismiss-toast-then-quick-send bypass —
                            // but a keystroke landing in some OTHER window is by
                            // definition not part of an AI prompt, and reconstructing
                            // it into the scan buffer captured text from whatever the
                            // user alt-tabbed to.
                            //
                            // Concretely: the Request Access dialog opens the instant
                            // an app is platform-blocked, i.e. squarely inside that
                            // 3s window, so the reason the user types into it was
                            // being appended here and regex-scanned (and its LENGTH
                            // reported as a prompt into the AI app, on Enter). Nothing
                            // is lost by the gate: you cannot type into an AI app
                            // while a different window has focus.
                            if (FgIsAiNow())
                            {
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
            // UpdateBannerState runs immediately after UpdateBlockedAgents (the
            // only caller of CheckFgBlocked) so the bar's state is derived from
            // this tick's block decision, not the previous one's. It emits at
            // most one line per real transition and nothing at all while idle.
            // UpdateGovState sits immediately after UpdateBannerState and for the
            // same reason: both observe the block decision UpdateBlockedAgents
            // just made, and both emit at most one line per real transition.
            try { UpdateForeground(); UpdateBlockedAgents(); UpdateBannerState(); UpdateGovState(); UpdatePaste(); UpdateUia(); UpdateSendRect(); UpdatePendingRewrite(); CheckHeartbeat(); CheckAttachHoldExpiry(); UpdateModelRouting(); }
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
            _attachHoldFilename = ""; _attachHoldPatterns = ""; _attachHoldProcess = "";
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
        // The GOVERNED list rides the same 10s tick, and is refreshed BEFORE the
        // blocked read rather than after it: the blocked read's own
        // file-missing path returns early, and DLP monitoring must not depend on
        // blocked-agents.json existing. Fully independent otherwise — it decides
        // nothing about blocking and CheckFgBlocked never reads it.
        UpdateGovernedAgents();
        try {
            if (!System.IO.File.Exists(_blockedAgentFile)) { _blockedList.Clear(); RebuildAgentScopedProcs(); ClearFgBlocked(); return; }
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
                    d["agent_id"] = ExtractJsonString(item, "agent_id");
                    d["reason"] = ExtractJsonString(item, "reason");
                    // Host-keyed platform blocks (admin Inventory "blocked"
                    // toggle) name their process directly instead of going
                    // through PLATFORM_PROCS — see CheckFgBlocked. Empty on
                    // ordinary per-agent rows, which is why the non-empty
                    // platform guard below is left exactly as it was: the
                    // synthesised rows carry the "ai_platform" sentinel there.
                    d["process_name"] = ExtractJsonString(item, "process_name");
                    // Panel-keyed platform blocks (an Inventory host that maps
                    // to an IDE-hosted AI panel rather than, or as well as, a
                    // standalone process) — see the panel branch in
                    // CheckFgBlocked. Empty on every other row shape.
                    d["panel"] = ExtractJsonString(item, "panel");
                    // 'agent' narrows this row to the ONE named agent in
                    // agent_name, instead of the whole process set its platform
                    // maps to. Absent / 'platform' / anything else means today's
                    // whole-process behaviour, unchanged — see CheckFgBlocked.
                    d["agent_scope"] = ExtractJsonString(item, "agent_scope");
                    if (!string.IsNullOrEmpty(d["platform"])) list.Add(d);
                }
            }
            _blockedList = list;
            RebuildAgentScopedProcs();
        } catch { }
        CheckFgBlocked();
    }

    // The PRIVACY GATE's data: which foreground processes the current blocklist
    // actually holds an agent-scoped row for. Recomputed with the list, and only
    // there, so the poll path is a HashSet lookup.
    //
    // Without a policy that needs to know which agent is open, we never read
    // another app's accessibility tree to find out. Deliberately NOT keyed on the
    // sticky _app: a row's coverage is a property of the PROCESS, so a tick can
    // ask about the process it is actually looking at rather than the one the
    // previous tick decided about.
    static void RebuildAgentScopedProcs()
    {
        var procs = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var agent in _blockedList)
        {
            if (!string.Equals(agent["agent_scope"], "agent", StringComparison.OrdinalIgnoreCase)) continue;
            HashSet<string> mapped;
            if (PLATFORM_PROCS.TryGetValue(agent["platform"], out mapped))
            {
                foreach (string p in mapped) procs.Add(p);
            }
            if (!string.IsNullOrEmpty(agent["process_name"])) procs.Add(agent["process_name"]);
        }
        _agentScopedProcs = procs;
    }

    // Read governed-agents.json — the DLP-monitored-but-NOT-blocked list.
    //
    // Deliberately a near-copy of the blocked read above rather than a shared
    // generic reader: the two differ in the one place that matters (this one
    // never touches _fgIsBlocked, never calls ClearFgBlocked, and never rebuilds
    // the blocked gate), and a shared reader parameterised by "which file" would
    // put those differences behind a flag. Same parser, same row shape, same
    // "assign only at the end" discipline.
    //
    // FAIL CLOSED IN THE DLP DIRECTION: a missing file, an unparseable file or
    // any exception leaves the list EMPTY, which means nothing is DLP-governed —
    // i.e. Teams goes back to being completely untouched. That is the safe
    // direction here: the failure mode of guessing wrong is capturing prompt
    // content the org did not ask for.
    static void UpdateGovernedAgents()
    {
        try {
            if (string.IsNullOrEmpty(_governedAgentFile) || !System.IO.File.Exists(_governedAgentFile))
            { _governedList.Clear(); RebuildDlpScopedProcs(); return; }
            string json = System.IO.File.ReadAllText(_governedAgentFile).Trim();
            var list = new List<Dictionary<string, string>>();
            if (json.StartsWith("[")) {
                foreach (string item in SplitJsonArray(json)) {
                    var d = new Dictionary<string, string>();
                    d["platform"] = ExtractJsonString(item, "platform");
                    d["agent_name"] = ExtractJsonString(item, "agent_name");
                    d["agent_id"] = ExtractJsonString(item, "agent_id");
                    // Only 'agent' scope is honoured, exactly as the blocked
                    // list's narrowing branch does. A platform-scoped (or
                    // scope-less) governed row would mean "DLP-monitor every
                    // prompt typed anywhere in this app", which for a HOST APP
                    // is the whole-app capture this feature exists to prevent —
                    // so such a row governs nothing at all.
                    d["agent_scope"] = ExtractJsonString(item, "agent_scope");
                    if (!string.IsNullOrEmpty(d["platform"])) list.Add(d);
                }
            }
            _governedList = list;
            RebuildDlpScopedProcs();
        } catch {
            // A read caught mid-write, or a malformed file: govern nothing this
            // tick rather than half of it. The next tick re-reads.
            _governedList = new List<Dictionary<string, string>>();
            RebuildDlpScopedProcs();
        }
    }

    // The GOVERNED privacy gate's data — which processes the current governed
    // list holds an agent-scoped row for. Mirrors RebuildAgentScopedProcs' shape
    // and rebuild discipline exactly, over the other list.
    static void RebuildDlpScopedProcs()
    {
        var procs = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var agent in _governedList)
        {
            if (!string.Equals(agent["agent_scope"], "agent", StringComparison.OrdinalIgnoreCase)) continue;
            HashSet<string> mapped;
            if (PLATFORM_PROCS.TryGetValue(agent["platform"], out mapped))
            {
                foreach (string p in mapped) procs.Add(p);
            }
        }
        _dlpScopedProcs = procs;
    }

    // Does the CURRENT governed list hold an agent-scoped row that names THIS
    // agent inside THIS process? Read-only, and the exact counterpart of
    // BlockedListHasMatchingAgentRow below — same PLATFORM_PROCS coverage test,
    // same AgentNameMatches comparison, no new matching semantics.
    //
    // Used by ApplyForegroundTick's host-app branch for the Chat-list route,
    // where a panel match alone cannot distinguish an agent conversation from a
    // renamed human group chat, so the NAME is the only available evidence.
    // Never consulted by any block decision.
    static bool GovernedListHasMatchingAgentRow(string proc, string agentName)
    {
        if (_governedList == null || _governedList.Count == 0) return false;
        if (string.IsNullOrEmpty(proc) || string.IsNullOrEmpty(agentName)) return false;
        string name = StripExe(proc).Trim();
        if (name.Length == 0) return false;
        foreach (var agent in _governedList)
        {
            if (!string.Equals(agent["agent_scope"], "agent", StringComparison.OrdinalIgnoreCase)) continue;
            HashSet<string> procs;
            if (!PLATFORM_PROCS.TryGetValue(agent["platform"], out procs)) continue;
            if (procs == null || !procs.Contains(name)) continue;
            if (AgentNameMatches(agentName, agent["agent_name"])) return true;
        }
        return false;
    }

    // Is this panel one whose DLP governance needs NO name-list match — i.e. a
    // composer with no non-AI use at all? Data from ai-processes.js's `dlpMatch`
    // (see PanelSig.DlpMatch); the comparison is here and only here.
    //
    // Positive-only by construction: anything other than the one literal is the
    // strict "a named row is required" rule, so a null panel, an older payload
    // or a typo can never widen governance.
    static bool PanelDlpMatchesOnPanelAlone(PanelSig hit)
    {
        return hit != null && string.Equals(hit.DlpMatch, "panel", StringComparison.OrdinalIgnoreCase);
    }

    // Does the CURRENT blocklist hold an agent-scoped row that names THIS agent
    // inside THIS process? Read-only: it decides nothing and writes nothing.
    //
    // Used by ApplyForegroundTick's host-app branch to answer "is there a policy
    // reason to treat this general-purpose app as an AI surface on this tick",
    // BEFORE any capture is enabled. CheckFgBlocked runs the same test again a
    // moment later to actually arm the block — deliberately not shared state:
    // this one gates whether the app counts as a surface at all, that one gates
    // the block, and collapsing them would let a capture decision ride on a
    // block decision's side effects.
    //
    // Matching is exactly the existing pair: PLATFORM_PROCS for "does this row's
    // platform cover this process" and AgentNameMatches for the name. No new
    // comparison semantics.
    static bool BlockedListHasMatchingAgentRow(string proc, string agentName)
    {
        if (_blockedList == null || _blockedList.Count == 0) return false;
        if (string.IsNullOrEmpty(proc) || string.IsNullOrEmpty(agentName)) return false;
        string name = StripExe(proc).Trim();
        if (name.Length == 0) return false;
        foreach (var agent in _blockedList)
        {
            if (!string.Equals(agent["agent_scope"], "agent", StringComparison.OrdinalIgnoreCase)) continue;
            HashSet<string> procs;
            if (!PLATFORM_PROCS.TryGetValue(agent["platform"], out procs)) continue;
            if (procs == null || !procs.Contains(name)) continue;
            if (AgentNameMatches(agentName, agent["agent_name"])) return true;
        }
        return false;
    }

    // The ADMIN-TYPED identity of the policy row that covers this agent inside
    // this process, for the govstate event and for nothing else.
    //
    // `blocked` selects which list to consult and mirrors ApplyForegroundTick's
    // own precedence — a blocked conversation is decided first, so its row is
    // the one that names it. Read-only: decides nothing, writes nothing, and is
    // never consulted by a block decision.
    //
    // WHY NOT THE READ NAME. `agentName` here is a string read out of ANOTHER
    // APP's window title or accessibility tree, which is exactly what every
    // emitter in this file refuses to put on the wire. The row's own
    // agent_name / agent_id are values an ADMINISTRATOR typed into the
    // dashboard — the same two values EmitBlock and OfferAccessRequest already
    // carry — so govstate carries no new class of data.
    //
    // ("","") when no row names this agent, which is the NORMAL outcome for the
    // panel-alone route: there, governance comes from the composer signature and
    // there is no named row to quote.
    //
    // Matching is the existing pair, unchanged: PLATFORM_PROCS for "does this
    // row's platform cover this process" and AgentNameMatches for the name.
    static void GovernedRowIdentity(bool blocked, string proc, string agentName, out string rowName, out string rowId)
    {
        rowName = ""; rowId = "";
        List<Dictionary<string, string>> list = blocked ? _blockedList : _governedList;
        if (list == null || list.Count == 0) return;
        if (string.IsNullOrEmpty(proc) || string.IsNullOrEmpty(agentName)) return;
        string name = StripExe(proc).Trim();
        if (name.Length == 0) return;
        foreach (var agent in list)
        {
            if (!string.Equals(agent["agent_scope"], "agent", StringComparison.OrdinalIgnoreCase)) continue;
            HashSet<string> procs;
            if (!PLATFORM_PROCS.TryGetValue(agent["platform"], out procs)) continue;
            if (procs == null || !procs.Contains(name)) continue;
            if (!AgentNameMatches(agentName, agent["agent_name"])) continue;
            rowName = agent["agent_name"] ?? "";
            rowId = agent["agent_id"] ?? "";
            return;
        }
    }

    // Arm the platform-block latch — called only from the two ELEMENT-scoped
    // branches of CheckFgBlocked, and only on a tick whose focused-element read
    // really succeeded, so the TTL below is measured from "the last time an
    // enforcing blocked surface was genuinely observed to have focus", not from
    // the end of the sticky window.
    //
    // `key` is the namespaced surface key ("panel:<id>" / "agent:<id>") — see
    // _elementBlockKey. Passed in rather than derived here because the two
    // branches know different things: the panel branch has _fgPanelId, the agent
    // branch has an AGENT_SURFACES id that is not foreground-panel state at all.
    static void ArmPanelBlockLatch(string key)
    {
        _panelBlockPid = _fgPid;
        _elementBlockKey = key ?? "";
        _panelBlockLatchTicks = DateTime.UtcNow.Ticks;
        _panelBlockLatch = true;
    }

    // The latched PANEL id, or "" when the latch is not a panel latch. Keeps
    // every panel-specific consumer (attribution, the same-surface fall-through)
    // from ever reading an agent key as a panel id.
    static string LatchedPanelId()
    {
        string k = _elementBlockKey ?? "";
        return k.StartsWith("panel:", StringComparison.Ordinal) ? k.Substring(6) : "";
    }

    // Is the latch holding an AGENT-scoped block? Its retirement rules differ
    // from a panel's: see the agent-evidence guard in CheckFgBlocked.
    static bool AgentBlockLatched()
    {
        string k = _elementBlockKey ?? "";
        return k.StartsWith("agent:", StringComparison.Ordinal);
    }

    static void ClearPanelBlockLatch()
    {
        _panelBlockLatch = false;
        _panelBlockPid = 0;
        _elementBlockKey = "";
        _panelBlockLatchTicks = 0;
    }

    // Is a previously-established IDE-panel platform block still in force?
    //
    // Pure and side-effect free on purpose: the keyboard hook thread calls this
    // (see the HookCallback gate), and the hook must never write poll-thread
    // state. Expiry is therefore observed here and actually reset by the poll
    // thread in CheckFgBlocked.
    // Has the user done something that could actually have moved keyboard focus,
    // recently enough to explain a focused-element read that says they left the
    // panel? See _lastFocusMoveInputTicks. Pure and side-effect free — the poll
    // thread calls it, but it reads a field the hook threads write.
    static bool FocusCouldHaveMoved()
    {
        long t = _lastFocusMoveInputTicks;
        if (t == 0) return false;
        return (DateTime.UtcNow.Ticks - t) < PANEL_LEAVE_INPUT_WINDOW;
    }

    static bool PanelBlockLatchHeld()
    {
        if (!_panelBlockLatch) return false;
        long armed = _panelBlockLatchTicks;
        if (armed == 0) return false;
        // Bounded: a host whose focused-element reads never recover must not be
        // able to leave Enter swallowed forever.
        if ((DateTime.UtcNow.Ticks - armed) > PANEL_BLOCK_LATCH_TTL) return false;
        // Same host process still in the foreground. _fgPid is refreshed on
        // every poll tick regardless of AI state (unlike _app, which is sticky
        // by design), so a genuine app switch drops the latch on the next tick.
        if (_fgPid != _panelBlockPid) return false;
        return true;
    }

    static void CheckFgBlocked()
    {
        // An admin un-blocking must take effect at once, so an empty/absent
        // blocklist drops the latch rather than letting it outlive its own row.
        if (_blockedList.Count == 0) { ClearPanelBlockLatch(); ClearFgBlocked(); return; }
        if (!_fgIsAi) {
            // NOT necessarily "the user left the AI surface". For an IDE panel
            // this is routinely an unresolvable focused-element read while the
            // same host window is still in the foreground — the race the latch
            // exists for. Capture has already failed open by this point
            // (FgIsAiNow/PanelUiaOk went false on the first bad read and stay
            // false); the platform block decision is what must not be torn down
            // by it. UpdateForeground drops the latch as soon as a SUCCESSFUL
            // read says the focused element is not a panel, so a real
            // navigation away still clears here on the very next tick.
            if (PanelBlockLatchHeld()) return;
            ClearPanelBlockLatch();
            ClearFgBlocked();
            return;
        }
        // A HOST APP NEVER PRODUCES AN APP-SCOPED BLOCK. Not from a platform
        // row, not from a host-keyed process_name row, not from a panel row.
        //
        // Every coarse arm below exists as a FAIL-CLOSED fallback: "we cannot
        // tell which agent is open, so block the whole app". That is safe when
        // the app is an AI product — the user loses an AI tool. It is not safe
        // when the app is Microsoft Teams, where it means the user cannot send a
        // message to a colleague, post in a channel or reply in a meeting,
        // because one agent inside the app is blocked. For a host app the
        // correct direction is fail-OPEN: no block at all.
        //
        // This is deliberately keyed on the PROCESS being a host app, not on the
        // surface being verified: an UNVERIFIED host-app surface must produce no
        // block either, which is the opposite of what an unverified chat-app
        // surface does. tests/enforcer-panel-block.test.mjs asserts exactly that
        // — it is the single most important behavioural test of this feature.
        bool hostApp = _hostAppProcs.Contains(_app);
        foreach (var agent in _blockedList) {
            HashSet<string> procs;
            if (PLATFORM_PROCS.TryGetValue(agent["platform"], out procs)) {
                if (procs.Contains(_app)) {
                    // AGENT-SCOPED NARROWING. A MODIFIER on this branch, not a
                    // fourth independent branch: the row still has to name a
                    // platform whose process set covers the foreground app. All
                    // agent_scope:'agent' changes is WHICH agent inside that app
                    // is blocked.
                    //
                    // It applies only when the foreground process has an
                    // AGENT_SURFACES entry that is both verified and enforcing —
                    // m365_copilot since its 2026-08-27 live pass. For an
                    // unverified future entry (and for any process this catalog
                    // knows nothing about) EnforcingAgentSurface() returns null,
                    // `narrowed` stays false, and the coarse whole-app arm below
                    // runs exactly as it did before this feature existed. That is
                    // the fail-closed direction: no way to tell which agent is
                    // open must never mean "block nothing".
                    bool narrowed = false;
                    if (string.Equals(agent["agent_scope"], "agent", StringComparison.OrdinalIgnoreCase)) {
                        AgentSurface surface = EnforcingAgentSurface(_app);
                        if (surface != null) {
                            narrowed = true;
                            // Only a Named read can arm: Generic ("no specific
                            // agent open") and the two no-evidence outcomes must
                            // never manufacture a block for a named agent.
                            if (_fgAgentOutcome == AgentReadOutcome.Named
                                && AgentNameMatches(_fgAgentName, agent["agent_name"])) {
                                _fgIsBlocked = true;
                                _blockedByElement = true;   // see _blockedByElement
                                _blockScope = "agent";
                                _blockedPlatform = agent["platform"] ?? "";
                                _blockedAgentName = string.IsNullOrEmpty(agent["agent_name"]) ? (agent["platform"] ?? "") : agent["agent_name"];
                                _blockedAgentId = agent["agent_id"] ?? "";
                                _blockedReason = "Blocked agent: " + _blockedAgentName;
                                // Same latch, same rule as the panel branch: arm
                                // only on a tick whose read was first-hand, so the
                                // TTL is not stacked on top of the sticky window.
                                if (_fgLeftAiTicks == 0) ArmPanelBlockLatch("agent:" + surface.Id);
                                return;
                            }
                        }
                    }
                    // When narrowing DOES apply and this row's agent is not the
                    // one open, today's coarse whole-app arm must NOT fire for
                    // this row — that is the entire point. Not a `continue`
                    // either: fall through to this row's other branches (and then
                    // the next row), because another row may still cover this
                    // foreground some other way. Same reasoning as the
                    // detection-only panel fall-through below.
                    if (!narrowed && !hostApp) {
                        _fgIsBlocked = true;
                        _blockedByElement = false;   // process-keyed — see _blockedByElement
                        _blockScope = "app";
                        _blockedPlatform = agent["platform"] ?? "";
                        _blockedAgentName = string.IsNullOrEmpty(agent["agent_name"]) ? (agent["platform"] ?? "") : agent["agent_name"];
                        _blockedAgentId = agent["agent_id"] ?? "";
                        _blockedReason = "Blocked agent: " + _blockedAgentName;
                        return;
                    }
                }
            }
            // Host-keyed platform block: the row names its process outright, so
            // no PLATFORM_PROCS entry is needed (and the "ai_platform" sentinel
            // deliberately has none). Checked in the SAME iteration as the
            // lookup above so first-match-wins ordering across the file is
            // unchanged — a per-agent row earlier in the array still wins.
            if (!string.IsNullOrEmpty(agent["process_name"])) {
                // …and never for a host app. ai-processes.js's processesForHost
                // already refuses to synthesize such a row, so this should be
                // unreachable; it is stated anyway because "unreachable" here
                // depends on a rule in a different file, and the failure mode is
                // swallowing Enter across a company's whole chat client.
                if (!hostApp && string.Equals(agent["process_name"], _app, StringComparison.OrdinalIgnoreCase)) {
                    _fgIsBlocked = true;
                    _blockedByElement = false;   // process-keyed — see _blockedByElement
                    _blockScope = "app";
                    _blockedPlatform = "ai_platform";
                    _blockedAgentName = string.IsNullOrEmpty(agent["agent_name"]) ? "ai_platform" : agent["agent_name"];
                    _blockedAgentId = agent["agent_id"] ?? "";
                    _blockedReason = "Blocked platform: " + _blockedAgentName;
                    return;
                }
            }
            // Panel-keyed platform block: matched against the AI PANEL that has
            // focus, not the process. Keyed this way precisely because
            // process_name matching above is process-WIDE — a row saying
            // process_name:"Code" would block plain code editing and every other
            // panel in the same window, which is the false positive this whole
            // feature exists to avoid. Checked in the SAME iteration as the two
            // branches above so first-match-wins ordering across the file is
            // unchanged.
            if (_fgIsPanel && !string.IsNullOrEmpty(agent["panel"])) {
                // Excluded for a host app for the same reason its panel entry
                // carries host:null in ai-processes.js — a panel-keyed row
                // against teams_composer would disable the composer in EVERY
                // Teams conversation, which is "disable all of Teams" reached by
                // a different route. panelForHost() cannot produce such a row;
                // this makes sure nothing else can either.
                if (!hostApp && string.Equals(agent["panel"], _fgPanelId, StringComparison.OrdinalIgnoreCase)) {
                    // A detection-only panel (AI_PANELS enforce:false) never
                    // blocks, even with a matching row present. This is the same
                    // gate FgIsAiNow/PanelUiaOk apply on the capture side; both
                    // are needed, or "detection-only" would still swallow Enter
                    // for a platform block. Not a `continue`: falling through to
                    // the next row is exactly right, since another row may still
                    // match this foreground some other way.
                    if (_fgPanelEnforce) {
                        _fgIsBlocked = true;
                        _blockedByElement = true;   // see _blockedByElement
                        _blockScope = "panel";
                        _blockedPlatform = "ai_platform";
                        _blockedAgentName = string.IsNullOrEmpty(agent["agent_name"]) ? "ai_platform" : agent["agent_name"];
                        _blockedAgentId = agent["agent_id"] ?? "";
                        _blockedReason = "Blocked platform: " + _blockedAgentName;
                        // Only the two ELEMENT-scoped branches arm the latch (this
                        // one and the agent-scoped modifier above): the
                        // process-keyed ones do not need it, because a foreground
                        // PROCESS cannot flicker the way a focused ELEMENT does.
                        // _fgLeftAiTicks == 0 is the existing "this tick's read
                        // succeeded" signal — arming inside the sticky window
                        // instead would stack the two grace periods.
                        if (_fgLeftAiTicks == 0) ArmPanelBlockLatch("panel:" + _fgPanelId);
                        return;
                    }
                }
            }
        }
        // No row matched. "A tick whose panel read succeeded is authoritative"
        // used to be the whole test here, and it collapsed two situations that
        // are not remotely the same:
        //
        //   a) The read is about the SAME panel the latch was armed for, and no
        //      row covers it any more — an admin lifted the block. Genuinely
        //      authoritative: clear at once, so un-blocking stays immediate.
        //
        //   b) The read is about a DIFFERENT panel in the same host process.
        //      This is the case that let a blocked panel's Enter through, and it
        //      had NO grace period whatsoever: a different panel is still an AI
        //      surface, so UpdateForeground sets isAi and RESETS _fgLeftAiTicks
        //      to 0 — the sticky window never even starts, and this line then
        //      read that reset as proof the block should die. One single 150ms
        //      tick was enough to clear both _fgIsBlocked and the latch.
        //      It is not proof of anything: one VS Code window was measured
        //      hosting two Claude Code composers AND a Copilot Chat input, all
        //      matching the signature table, while FocusedElement — a GLOBAL
        //      read — was measured returning elements from other windows and
        //      other processes entirely. A read about another surface says
        //      nothing about the latched one.
        bool sameSurface = !_fgIsPanel
            || string.Equals(_fgPanelId ?? "", LatchedPanelId(), StringComparison.OrdinalIgnoreCase);
        if (!sameSurface && PanelBlockLatchHeld()) return;
        // The same principle for an AGENT-scoped latch, keyed on the OUTCOME of
        // this tick's agent read rather than on a surface id.
        //
        //   Generic / Named(some other agent) come from the composer itself,
        //   correctly pid-attributed, and are AUTHORITATIVE: the latch was
        //   already retired for them, in ApplyForegroundTick, on the tick they
        //   arrived — so control reaches here with nothing held and the block
        //   clears immediately. (That is also why this path needs no
        //   could-focus-have-moved gate: unlike the Cursor case, a read saying "a
        //   different agent is open" is positive evidence about the composer
        //   itself, not a stolen read about an unrelated element.)
        //
        //   Unreadable / NotComposer are NO EVIDENCE — the element was gone, or
        //   belonged to another process, or was a transcript rather than the
        //   composer. Treating those as "no blocked agent is open" is a read
        //   failure dressed up as a fact, and it would tear the block down on the
        //   first bad read while the user sits in the very agent an admin blocked.
        bool noAgentEvidence = _fgAgentOutcome == AgentReadOutcome.Unreadable
                            || _fgAgentOutcome == AgentReadOutcome.NotComposer;
        if (noAgentEvidence && AgentBlockLatched() && PanelBlockLatchHeld()) return;
        // Inside the sticky window the state is second-hand, and the latch keeps
        // its say — unchanged.
        if (_fgLeftAiTicks != 0 && PanelBlockLatchHeld()) return;
        ClearPanelBlockLatch();
        ClearFgBlocked();
    }

    // The AUTHORITATIVE scope of the current block, for reporting and for the
    // banner gate. "app" when nothing has set a scope, which is both the
    // pre-existing default and the safe one: every arm site sets it explicitly,
    // so this fallback can only ever be reached with no block in force.
    static string BlockScope()
    {
        string s = _blockScope;
        return (s != null && s.Length > 0) ? s : "app";
    }

    // Recompute the standing bar's state and emit ONE line per real transition.
    // Called from the poll tick straight after UpdateBlockedAgents (the only
    // caller of CheckFgBlocked), so it always reads a freshly-decided block.
    //
    // Deliberately observes, never decides: no field CheckFgBlocked owns is
    // written here. See the _bannerActive/_bannerPid comments above.
    static void UpdateBannerState()
    {
        // WHOLE-APP blocks only — BlockScope() == "app". A panel-scoped block (a
        // Claude Code / Cursor composer inside an IDE) gets no bar: the block
        // covers one surface inside an editor, not the editor, and a bar
        // spanning the whole display would state something false. Same
        // exclusion, same reason, as showPlatformBanner()'s IS_EMBEDDED_AI
        // early-return in the browser extension. An AGENT-scoped block is
        // excluded by exactly the same rule and for exactly the same reason:
        // blocking one agent inside Microsoft 365 Copilot is not blocking
        // Microsoft 365 Copilot. Tested against the positive scope rather than
        // against !_blockedByElement so that a future third element-scoped kind
        // has to state its intent here instead of inheriting "no bar" silently.
        //
        // !Disarmed() is REQUIRED here and is not redundant with anything.
        // Disarmed() (the panic hotkey) is checked inside the block DECISION
        // functions — EnterBlockActive / BlockActiveForMouse — and never inside
        // CheckFgBlocked, so _fgIsBlocked stays true across a disarm. Without
        // this term the bar would keep asserting that prompts are being stopped
        // while every Enter is in fact going through.
        // _fgLeftAiTicks == 0 is the existing "this tick's read is FIRST-HAND"
        // signal (ApplyForegroundTick resets it whenever the foreground really is
        // an AI surface, and stamps it the moment focus leaves one) — the same
        // signal ArmPanelBlockLatch gates on. It is what actually keeps the bar
        // off the 3s sticky window, and it is load-bearing in BOTH directions:
        //
        //   * as a clear term, it drops the bar the instant focus leaves a
        //     blocked app for something that is not an AI surface at all, while
        //     _fgIsBlocked is still (correctly, stickily) true;
        //   * as an ARM term, it stops the bar from immediately coming back. A
        //     pid check alone cleared the bar and then re-armed it on the very
        //     next tick — over Outlook, with Outlook's pid — because the sticky
        //     _fgIsBlocked still said "blocked". Measured in the offline
        //     transition harness; exactly the bug the fast clear exists to
        //     prevent, one tick later.
        bool firstHand = _fgLeftAiTicks == 0;
        bool want = _fgIsBlocked && BlockScope() == "app" && !Disarmed() && firstHand;
        uint pid = _fgPid;
        if (_bannerActive)
        {
            // FAST CLEAR. _fgPid is refreshed on every poll tick unconditionally
            // (unlike _app, which is sticky by design), so a genuine app switch
            // drops the bar on the very next tick — no new read, and no share of
            // FG_STICKY_TTL. Deliberate: see the field comments.
            if (!want
                || pid != _bannerPid
                || !string.Equals(_bannerAgent, _blockedAgentName, StringComparison.Ordinal))
            {
                _bannerActive = false;
                _bannerPid = 0;
                _bannerAgent = "";
                EmitBlockState(false, "", "", "", "", 0);
            }
            return;
        }
        if (!want) return;
        _bannerActive = true;
        _bannerPid = pid;
        _bannerAgent = _blockedAgentName;
        EmitBlockState(true, _blockedPlatform, _blockedAgentName, _blockedAgentId, _app, pid);
    }

    // The bar's whole payload. PII discipline, tighter than any other emit in
    // this file because a BrowserWindow consumes it: a bool, the fixed scope
    // enum, the admin-typed platform/agent name + id, a process name, a pid, and
    // a window rect. NEVER a window title, NEVER a UIA element Name, NEVER
    // `patterns`, NEVER a prompt preview — there is no route from this event to
    // anything the user typed, and there must never be one.
    static void EmitBlockState(bool active, string platform, string agent, string agentId, string process, uint pid)
    {
        int wx = 0, wy = 0, ww = 0, wh = 0;
        if (active)
        {
            // The SAME Win32 pair UpdateSendRect already uses — no new interop.
            // Read ONCE, at the transition, and used by Electron only to decide
            // which MONITOR the bar belongs on. Nothing tracks this window
            // afterwards; the bar is display-anchored, not window-docked.
            try
            {
                IntPtr fg = GetForegroundWindow();
                RECT wr;
                if (fg != IntPtr.Zero && GetWindowRect(fg, out wr))
                {
                    wx = wr.Left; wy = wr.Top;
                    ww = wr.Right - wr.Left; wh = wr.Bottom - wr.Top;
                }
            }
            catch { }
        }
        // The REAL scope, never a hardcoded "app". UpdateBannerState refuses to
        // arm for anything but an app-scoped block, so in practice an active
        // event always carries "app" — but emitting the truth is what makes
        // main.js's `parsed.scope === 'app'` guard a genuine second line of
        // defence rather than a check against a constant. If a scope ever leaks
        // through, the consumer drops it instead of rendering a display-wide red
        // bar for one blocked agent.
        string json = "{\"kind\":\"blockstate\""
            + ",\"active\":" + (active ? "true" : "false")
            + ",\"scope\":\"" + Esc(BlockScope()) + "\""
            + ",\"platform\":\"" + Esc(platform ?? "") + "\""
            + ",\"agent\":\"" + Esc(agent ?? "") + "\""
            + ",\"agent_id\":\"" + Esc(agentId ?? "") + "\""
            + ",\"process\":\"" + Esc(process ?? "") + "\""
            + ",\"pid\":" + pid
            + ",\"win_x\":" + wx + ",\"win_y\":" + wy
            + ",\"win_w\":" + ww + ",\"win_h\":" + wh
            + "}";
        lock (_emitLock) { Console.Out.WriteLine(json); Console.Out.Flush(); }
    }

    // Cleared together with the flag: a stale platform/agent name outliving the
    // block it described would let EmitBlock attribute an unrelated block to it.
    static void ClearFgBlocked()
    {
        _fgIsBlocked = false;
        _blockedByElement = false;
        _blockScope = "";
        _blockedPlatform = "";
        _blockedAgentName = "";
        _blockedAgentId = "";
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

    // The same lookup, but ESCAPE-AWARE, for the one field on the control
    // channel that carries free text (the "Edit manually" replacement — see
    // StdinLoop). ExtractJsonString above stops at the first '"' and returns
    // the raw slice, which is exactly right for the ids, names and enum-ish
    // values every other caller reads and exactly wrong here: a prompt
    // containing a quote would be truncated mid-word, and one containing a
    // newline would have the two characters '\' and 'n' typed into the
    // composer.
    //
    // Returns NULL when the key is absent, so a caller can tell "no such field"
    // from "the field was an empty string" — the difference between "use the
    // enforcer's own masked candidate" and "the user submitted an empty box",
    // which are opposite decisions.
    //
    // Deliberately NOT a JSON parser: it finds one key at the top level, reads
    // one string value, and understands only the escapes Esc() and
    // JSON.stringify actually produce. Anything malformed ends the value rather
    // than throwing — this runs on the stdin thread, and a bad line must never
    // take the enforcer down.
    static string ExtractJsonStringUnescaped(string json, string key)
    {
        if (json == null) return null;
        string search = "\"" + key + "\":\"";
        int i = json.IndexOf(search, StringComparison.OrdinalIgnoreCase);
        if (i < 0) return null;
        int p = i + search.Length;
        var sb = new StringBuilder();
        while (p < json.Length)
        {
            char c = json[p];
            if (c == '"') break;                       // end of the value
            if (c != '\\') { sb.Append(c); p++; continue; }
            p++;
            if (p >= json.Length) break;               // trailing backslash
            char e = json[p++];
            if (e == 'n') sb.Append('\n');
            else if (e == 'r') sb.Append('\r');
            else if (e == 't') sb.Append('\t');
            else if (e == 'b') sb.Append('\b');
            else if (e == 'f') sb.Append('\f');
            else if (e == '"' || e == '\\' || e == '/') sb.Append(e);
            else if (e == 'u')
            {
                if (p + 4 > json.Length) break;
                int cp;
                if (!int.TryParse(json.Substring(p, 4),
                                  System.Globalization.NumberStyles.HexNumber,
                                  System.Globalization.CultureInfo.InvariantCulture, out cp)) break;
                sb.Append((char)cp);
                p += 4;
            }
            // Anything else is not an escape this side produces; drop the
            // backslash and keep the character rather than guessing.
            else sb.Append(e);
        }
        return sb.ToString();
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

    // Recompute "a governed or blocked agent conversation is open in a host
    // app" and emit ONE line per real transition. Called from the poll tick
    // straight after UpdateBannerState, so it reads BOTH this tick's foreground
    // decision (ApplyForegroundTick, via the _fgHostGov* fields) and this tick's
    // freshly decided block (CheckFgBlocked, for the blocked row's identity).
    //
    // Deliberately observes, never decides — modelled line for line on
    // UpdateBannerState, including its fast clear.
    static void UpdateGovState()
    {
        // FIRST-HAND ONLY, and it is the SAME term UpdateBannerState uses for
        // the same reason. _fgLeftAiTicks == 0 means "this tick's read really is
        // of the surface in front of the user"; the tick on which focus leaves a
        // governed surface stamps it, and it stays stamped for FG_STICKY_TTL.
        //
        // It is load-bearing in a way it is not even for the bar. Inside that
        // sticky window _fgIsAi is still (correctly) true, so without this term
        // a govstate would stay "active" after the user alt-tabbed out of the
        // governed conversation — leaving Teams' file watchers armed over
        // whatever they moved to. That is capture outside a governed
        // conversation, i.e. the one outcome this entire design exists to
        // prevent. It is also what makes "the surface held for a full tick"
        // true: a tick cannot be both first-hand and mid-sticky.
        bool firstHand = _fgLeftAiTicks == 0;
        // !Disarmed() for the same reason the bar carries it: the panic hotkey
        // means "stop", and an armed file watcher whose hold can no longer
        // swallow anything would be capture with no enforcement to justify it.
        bool want = _fgHostGoverned && firstHand && !Disarmed();
        uint pid = _fgPid;
        // Blocked row first, mirroring ApplyForegroundTick's precedence.
        // CheckFgBlocked has already run this tick, so for a blocked
        // conversation these are the current block's own admin-typed values —
        // the same pair EmitBlock and OfferAccessRequest carry.
        bool blockedAgent = _fgIsBlocked && BlockScope() == "agent";
        string agent = blockedAgent ? _blockedAgentName : _fgHostGovAgent;
        string agentId = blockedAgent ? _blockedAgentId : _fgHostGovAgentId;
        // "agent" when a named policy row is what governs this conversation,
        // "panel" when the composer signature alone is (the Copilot tab, whose
        // dlpMatch is 'panel' — see PanelDlpMatchesOnPanelAlone). Emitting the
        // truth rather than a constant is what keeps the enum worth reading.
        string scope = (agent != null && agent.Length > 0) ? "agent" : "panel";
        // Identity of the CURRENT state, so switching between two governed
        // conversations re-announces instead of silently keeping the first one's
        // agent name. Same idea as _bannerAgent, one field wider.
        string key = (agent ?? "") + "|" + (agentId ?? "") + "|" + (_fgHostGovPanel ?? "");
        if (_govActive)
        {
            if (!want || pid != _govPid || !string.Equals(_govKey, key, StringComparison.Ordinal))
            {
                _govActive = false;
                _govPid = 0;
                _govKey = "";
                EmitGovState(false, "", "", "", "", "", 0);
            }
            return;
        }
        if (!want) return;
        _govActive = true;
        _govPid = pid;
        _govKey = key;
        EmitGovState(true, _app, scope, _fgHostGovPanel, agent, agentId, pid);
    }

    // The govstate payload. PII discipline identical to EmitBlockState's, and
    // one field TIGHTER — no window rect, because nothing renders from this.
    //
    // What may travel: a bool, a fixed scope enum, OUR OWN catalog panel id, the
    // admin-typed agent name + id (the same pair the block and request-access
    // lines already carry), a process name and a pid.
    //
    // What may NEVER travel, and the reason the rule is stricter here than
    // anywhere else in this file: a window title, a UIA element Name, a message
    // heading, a filename, a path, `patterns`, or a prompt preview. This event's
    // whole job is to ARM a file watcher inside a company's chat client — if it
    // could carry any of those, the act of arming would itself be the leak it is
    // supposed to make unnecessary.
    static void EmitGovState(bool active, string process, string scope, string panel, string agent, string agentId, uint pid)
    {
        string json = "{\"kind\":\"govstate\""
            + ",\"active\":" + (active ? "true" : "false")
            + ",\"process\":\"" + Esc(process ?? "") + "\""
            + ",\"pid\":" + pid
            + ",\"scope\":\"" + Esc(scope ?? "") + "\""
            + ",\"panel\":\"" + Esc(panel ?? "") + "\""
            + ",\"agent\":\"" + Esc(agent ?? "") + "\""
            + ",\"agent_id\":\"" + Esc(agentId ?? "") + "\""
            + "}";
        lock (_emitLock) { Console.Out.WriteLine(json); Console.Out.Flush(); }
    }

    static void UpdateForeground()
    {
        IntPtr fg = GetForegroundWindow();
        if (fg == IntPtr.Zero) return; // don't change state on null window
        uint pid; GetWindowThreadProcessId(fg, out pid);
        string proc = ProcName(pid);

        bool isIde = (proc != null && _ideProcs.Contains(proc));
        // A HOST APP whose governed path is FULLY ARMED for this tick. Three
        // conditions, and every one of them is a gate, not a convenience:
        //   * the process carries a HostApp agent surface;
        //   * the CURRENT policy holds an agent-scoped row covering it — the
        //     same privacy gate the composer read uses. NO agent policy for
        //     Teams means Teams is never looked at, at all. "Policy" is now
        //     either list: a BLOCKED row (swallow every keystroke in that
        //     conversation) or a GOVERNED row (scan its prompts and offer to
        //     tokenize). Both are an org instruction about an agent inside this
        //     app, and either one is what justifies the read; neither list being
        //     interested in Teams still means nothing is read;
        //   * that surface is BOTH verified and enforcing. Unlike a chat app —
        //     where an unverified surface still has the pre-existing whole-app
        //     block to fall back to, so the reads have to happen — a host app
        //     that has not passed its live pass must do NOTHING WHATSOEVER: no
        //     title read, no accessibility read, no state. That is what makes an
        //     unverified host-app surface completely inert rather than merely
        //     non-blocking.
        bool hostAppArmed = !isIde && proc != null && _hostAppProcs.Contains(proc)
            && (_agentScopedProcs.Contains(proc) || _dlpScopedProcs.Contains(proc))
            && EnforcingAgentSurface(proc) != null;
        string panelRid = "";
        bool panelReadable = false;
        PanelSig hit = null;
        // The ONE UIA call. Everything that interprets its result lives in
        // ApplyForegroundTick, so the offline harness can drive the real state
        // machine with a substituted read instead of re-implementing it.
        //
        // A host app needs the SAME read for the opposite reason an IDE does:
        // one Teams window holds every conversation the user has open, so only
        // the focused ELEMENT can say the composer is what has focus — and the
        // composer lives in a child WebView2 process, hence allowChildProcess.
        if (isIde) hit = ReadFocusedPanel(proc, pid, out panelRid, out panelReadable, false);
        else if (hostAppArmed) hit = ReadFocusedPanel(proc, pid, out panelRid, out panelReadable, true);

        // The SECOND (and only other) UIA call, for "which named agent is open".
        //
        // PRIVACY GATE, and it is the whole reason this is not read
        // unconditionally: reading another app's accessibility tree to learn
        // which agent someone has open is only justified by a policy that needs
        // the answer. Three conditions, all required:
        //   * the process is an AI app (not an IDE — an agent surface is a chat
        //     app, and the IDE branch above owns that case);
        //   * this catalog knows how to read an agent name out of it at all;
        //   * the CURRENT blocklist holds an agent-scoped row covering it.
        // Any one missing and no read happens, the outcome stays Unreadable, and
        // an agent-scoped row behaves exactly as it does today.
        //
        // A HOST APP reaches this read through hostAppArmed instead of _aiProcs
        // — it is deliberately absent from that set (ai-processes.js keeps every
        // hostApp entry out of the watcher list), and hostAppArmed is the
        // STRICTER gate of the two: it additionally requires the surface to have
        // passed its live pass.
        AgentReadOutcome agentOutcome = AgentReadOutcome.Unreadable;
        string agentName = "";
        if ((!isIde && proc != null && _aiProcs != null && _aiProcs.Contains(proc)
            && _agentScopedProcs.Contains(proc)) || hostAppArmed)
        {
            AgentSurface surface = MatchAgentSurface(proc);
            // `hit` comes from the panel read above, on this same tick. It is
            // handed down ONLY as part of the Copilot-tab heading cache's pane
            // key — see _copilotCachePane — never as a gate or as evidence; the
            // gating on `hit` happens once, in ApplyForegroundTick.
            if (surface != null) agentOutcome = ReadFocusedAgentName(surface, pid, fg, hit != null ? hit.Id : "", out agentName);
        }
        ApplyForegroundTick(pid, proc, isIde, hit, panelRid, panelReadable, agentOutcome, agentName);
    }

    // Everything UpdateForeground does once the focused-element read is in.
    //
    // Split out for testability, and for a specific reason: the transitions
    // below are where every panel-scoping bug so far has lived, and a test that
    // re-implements them in PowerShell or JS is testing its own copy. The
    // harness in agent/tests drives THIS method with reads built from real,
    // measured UIA property values (fed through the real MatchPanelSignature),
    // so the only thing it substitutes is the AutomationElement lookup itself.
    static void ApplyForegroundTick(uint pid, string proc, bool isIde, PanelSig hit, string panelRid, bool panelReadable, AgentReadOutcome agentOutcome, string agentName)
    {
        _fgPid = pid;

        bool isAi = false, isPanel = false, panelEnforce = false;
        // "This tick is DLP-governed and NOT blocked" — see _fgDlpGoverned.
        // Declared with the other per-tick locals so EVERY branch leaves it
        // false and only the host-app branch can ever set it.
        bool dlpGoverned = false;
        // "This HOST-APP tick is governed, by EITHER policy" — the union that
        // arms Teams file scanning. Declared with the other per-tick locals for
        // the same reason: every branch leaves it false, and only the host-app
        // branch can set it. See _fgHostGoverned.
        bool hostGoverned = false;
        string hostGovPanel = "", hostGovAgent = "", hostGovAgentId = "";
        string panelId = "";
        if (panelRid == null) panelRid = "";
        // Always mirrors THIS tick's read — Unreadable whenever UpdateForeground
        // performed none — so a stale Named outcome can never leak forward into a
        // later tick's block decision. Never emitted; see the field comments.
        _fgAgentOutcome = agentOutcome;
        _fgAgentName = agentName ?? "";

        // A real app switch retires the IDE-panel platform-block latch straight
        // away — the pid check in PanelBlockLatchHeld already fails at this
        // point, this just resets the flag on the thread that owns it.
        if (_panelBlockLatch && pid != _panelBlockPid) ClearPanelBlockLatch();

        if (isIde)
        {
            // An IDE. Whether this counts as an AI surface depends on the
            // focused ELEMENT, not the process — checked BEFORE the _aiProcs
            // branch below so an IDE that is ALSO in AI_PROCESSES (Cursor is,
            // for its host/exception-chain entry) gets panel scoping instead
            // of falling through to whole-app treatment.
            if (hit != null)
            {
                isAi = true; isPanel = true; panelId = hit.Id; panelEnforce = hit.Enforce;
            }
            else if (panelReadable)
            {
                // A read that SUCCEEDED and did not match looks like the
                // authoritative "the caret is in the editor / a terminal / some
                // other panel" answer — and when the user really did move it, it
                // is: the latch is retired here and this tick falls through to
                // the ordinary sticky-expiry path below, so behaviour for
                // genuinely leaving a panel is unchanged.
                //
                // But only when they COULD have moved it. Focus does not move on
                // its own, so a readable non-match with no click and no
                // chorded/navigation key behind it is a bad READ, not a fact —
                // the same "no evidence" state an UNREADABLE read (element gone,
                // no control type, no name and no class) already lands in, and
                // the state the latch deliberately survives.
                //
                // This is the cursor_composer leak. Its window holds no second AI
                // panel for the panel-id scoping in CheckFgBlocked to catch — the
                // element next to the composer is Cursor's own Monaco editor
                // input, which matches nothing — so a stolen tick arrived here as
                // a readable non-match and killed the block outright, mid-way
                // through a 4.5s wait in which the user had touched nothing at
                // all. See _lastFocusMoveInputTicks and _panelBlockLatch.
                if (FocusCouldHaveMoved()) ClearPanelBlockLatch();
            }
            if (hit == null && proc != null && _ideFallbackProcs != null && _ideFallbackProcs.Contains(proc)
                && _aiProcs != null && _aiProcs.Contains(proc))
            {
                // Whole-app fallback — nothing uses this today (_ideFallbackProcs
                // is empty; see its own comment above), reachable again only if a
                // future entry sets panelFallback:true. Both conditions are
                // required even then: a panelFallback flag on a process this
                // catalog has no AI entry for would silently mean "no coverage",
                // so the AI_PROCESSES membership that actually provides the
                // coverage is checked too.
                isAi = true;
            }
            // Otherwise: not an AI surface. A failed/absent panel match — the
            // caret is in the editor or a terminal, or the UIA read threw — is
            // treated exactly like switching away from a chat app, i.e. it falls
            // into the sticky-expiry branch below. That is deliberately fail-OPEN
            // for capture (FgIsAiNow goes false immediately, so no keystroke in
            // the editor is ever buffered) while block DECISIONS still hold for
            // the existing 3s, which is the same separation the sticky window
            // already draws for every other app.
            //
            // The one thing this branch no longer collapses: "the read said the
            // caret is elsewhere" and "the read said nothing at all". A platform
            // block established in an enforcing panel outlives the second for up
            // to PANEL_BLOCK_LATCH_TTL, because 3s of unreadable reads while the
            // SAME host window stays in the foreground used to tear the block
            // down and let the next Enter through. See _panelBlockLatch.
        }
        else if (proc != null && _hostAppProcs.Contains(proc))
        {
            // ── HOST APP (Microsoft Teams) ──────────────────────────────────
            //
            // THE CORE PRIVACY PROPERTY OF THIS FEATURE. A host app is a
            // general-purpose application — the company's chat client — and it
            // is treated as an AI surface for EXACTLY the ticks on which an
            // agent the org has a policy about is provably the open
            // conversation. On every other tick isAi stays false, so FgIsAiNow()
            // is false, so no keystroke is buffered, no clipboard/UIA content is
            // scanned and no block decision is even evaluated. Capture is
            // confined to those conversations and to nowhere else in Teams: not
            // a DM, not a channel, not a meeting chat, not the Activity tab.
            //
            // THERE ARE NOW TWO KINDS OF POLICY, and the split below is the
            // whole point:
            //
            //   blockGoverned — EXACTLY the pre-existing rule, unchanged. Drives
            //                   _fgIsBlocked via CheckFgBlocked: every Enter and
            //                   every send-button click in that conversation is
            //                   swallowed.
            //   dlpGoverned   — NEW, and STRICTLY WEAKER. The agent is one the
            //                   org asked to DLP-MONITOR and explicitly did NOT
            //                   block. It makes the tick an AI surface — so
            //                   prompts are scanned and Tokenize & Send is
            //                   offered — and NOTHING ELSE. It cannot arm a
            //                   platform/agent/panel block: it is never read by
            //                   CheckFgBlocked, it supplies no blocklist row,
            //                   and a host app is barred from all three coarse
            //                   arms there anyway.
            //
            // They are computed in that order and dlpGoverned requires
            // !blockGoverned, so BLOCKED WINS structurally. The sync layer
            // already guarantees the two lists are disjoint on disk; this makes
            // "blocked and governed at once" unrepresentable here regardless.
            //
            // Four independent conditions for blockGoverned, ALL required:
            //   surface   — a HostApp AGENT_SURFACES entry that is BOTH verified
            //               and enforcing. Teams' entry now ships true/true
            //               (live pass 2026-08-30), so this branch is live; the
            //               two-flag check stays because it is what keeps any
            //               future host-app entry inert until its own pass.
            //   hit       — the focused ELEMENT matched the app's composer
            //               signature (teams_composer) and that panel is itself
            //               past the same two-flag gate. The process being in
            //               the foreground is not evidence; only the element is.
            //   Named     — the read produced an AUTHORITATIVE conversation name.
            //               Generic ("Teams named this group chat after its
            //               participants") and the two no-evidence outcomes can
            //               never satisfy this.
            //   row match — the CURRENT blocklist really holds an agent-scoped
            //               row for that name on a platform covering this
            //               process. Without it there is no policy reason to
            //               look at this app, so there is no reason to treat it
            //               as one.
            AgentSurface hostSurface = EnforcingAgentSurface(proc);
            // The shared preconditions of BOTH kinds of governance: a host-app
            // surface past its two-flag gate, and a focused ELEMENT that matched
            // an ENFORCING composer signature. The process being in the
            // foreground is never evidence; only the element is.
            bool hostSurfaceOk = hostSurface != null && hit != null && hit.Enforce;
            bool blockGoverned = hostSurfaceOk
                && agentOutcome == AgentReadOutcome.Named
                && BlockedListHasMatchingAgentRow(proc, agentName);
            // The DLP-only state. Two routes into it, and they differ in exactly
            // one thing — whether the agent has to be NAMED:
            //
            //   the Chat-list composer (dlpMatch 'agent', the default) — the
            //     conversation must be Named AND present in governed-agents.json.
            //     ONE composer element serves every conversation in Teams' Chat
            //     list, so a panel match there is equally true of a DM, a channel
            //     post and a renamed human group chat. The name is the only
            //     signal that can tell an agent conversation from a colleague's,
            //     and without it this would capture colleague conversations —
            //     precisely what the host-app design exists to prevent.
            //
            //   the embedded Copilot tab (dlpMatch 'panel') — PANEL MATCH ALONE,
            //     with no name-list check at all, so ANY conversation in that
            //     tab is DLP-governed, including the generic unnamed Copilot
            //     assistant. Safe here and only here because that composer has
            //     no non-AI use whatsoever: there is no DM, no channel and no
            //     meeting chat behind it, so "the caret is in this element"
            //     already means "the user is typing at an AI". The privacy gate
            //     upstream still applies — hostAppArmed requires the org to hold
            //     SOME agent policy for Teams before anything here is read.
            //
            // !blockGoverned is what makes blocked take precedence; see above.
            dlpGoverned = !blockGoverned && hostSurfaceOk
                && (PanelDlpMatchesOnPanelAlone(hit)
                    || (agentOutcome == AgentReadOutcome.Named
                        && GovernedListHasMatchingAgentRow(proc, agentName)));
            if (blockGoverned || dlpGoverned)
            {
                // Identical surface state for both. isAi/isPanel are what make
                // capture, DLP scanning and Tier B masking eligible — and for a
                // host app they are also what PanelUiaOk/PanelEnforceOk demand
                // before any content may be read. What the two states do NOT
                // share is any input to a block decision: that comes solely from
                // a matching blocked-agents.json row inside CheckFgBlocked.
                isAi = true; isPanel = true; panelId = hit.Id; panelEnforce = hit.Enforce;
                // ── The FILE-SCANNING arm signal (govstate) ─────────────────
                // Set for BOTH kinds of governance, and that is deliberate: a
                // sensitive file attached inside a BLOCKED conversation is the
                // stronger case for scanning it, not an exemption. Nothing here
                // is a block input — it is read only by UpdateGovState, which
                // emits state to the Node side and decides nothing itself.
                hostGoverned = true;
                hostGovPanel = hit.Id;
                // The ADMIN-TYPED row identity, blocked list first to match the
                // precedence computed above. Empty for the panel-alone route,
                // where there is no named row — see GovernedRowIdentity.
                GovernedRowIdentity(blockGoverned, proc, agentName, out hostGovAgent, out hostGovAgentId);
            }
            // The latch rule, and it is WIDER here than in the chat-app branch
            // below. There, NotComposer is a no-evidence outcome the latch must
            // survive: it means the global focused-element read landed on the
            // transcript, or on some unrelated window, and says nothing about
            // which agent is open.
            //
            // In WINDOW-TITLE mode it means something completely different.
            // NotComposer there comes from a title that WAS read successfully
            // and simply is not a nameable Chat conversation — a channel view,
            // the Activity tab, a 1:1 DM, the generic Copilot panel. That is
            // positive evidence that the blocked conversation is NOT open, and
            // treating it as "no evidence" would keep Enter swallowed after the
            // user navigated away, in a general-purpose chat client. So only a
            // genuine read FAILURE (Unreadable — no window handle, GetWindowText
            // returned nothing) survives here.
            //
            // This is the fail-OPEN direction, which is the correct one for a
            // host app throughout: an ambiguous tick must release the block, not
            // hold it. CheckFgBlocked re-arms on the very next tick that proves
            // the blocked agent is open again.
            if (AgentBlockLatched() && agentOutcome != AgentReadOutcome.Unreadable)
            {
                ClearPanelBlockLatch();
            }
        }
        else if (proc != null && _aiProcs != null && _aiProcs.Contains(proc))
        {
            isAi = true;
            // A chat app that MAY also be an agent surface. isAi stays true and
            // isPanel stays FALSE — an agent surface is not an IDE panel, and
            // making it one would change PanelUiaOk()/PanelEnforceOk() for
            // M365Copilot and so silently alter its existing UIA content scanning
            // and typed-buffer capture. Nothing about capture changes here; the
            // agent read only ever narrows a platform BLOCK.
            //
            // What does happen: an AUTHORITATIVE outcome retires an agent-scoped
            // latch on this very tick.
            //   Generic     — no specific agent is open, so no agent-scoped block
            //                 can be in force.
            //   Named       — including Named(the same agent): CheckFgBlocked
            //                 re-arms it in the same tick if a row still covers
            //                 it, which also refreshes the TTL from genuinely
            //                 current evidence. If no row covers the agent now
            //                 (a different agent, or an admin lifted the block)
            //                 the block correctly ends here.
            // Unreadable / NotComposer are NO EVIDENCE and deliberately do
            // nothing — that is the state the latch exists to survive.
            //
            // No FocusCouldHaveMoved() gate, unlike the IDE branch: there, a
            // readable non-match came from an unrelated element and said nothing
            // about the composer. Here Generic/Named come FROM the composer,
            // correctly pid-attributed, and are positive evidence.
            if (AgentBlockLatched()
                && (agentOutcome == AgentReadOutcome.Generic || agentOutcome == AgentReadOutcome.Named))
            {
                ClearPanelBlockLatch();
            }
        }

        // Always mirrors THIS tick's decision, on every branch — a host-app tick
        // that stopped being governed, an IDE tick, a chat-app tick and a tick
        // with no AI surface at all all assign false here. So the flag can never
        // outlive the tick that earned it and leak a Tier B offer into the sticky
        // window, where the state is second-hand by definition.
        _fgDlpGoverned = dlpGoverned;
        // Same rule, same reason, for the file-scanning arm signal: assigned on
        // every branch, so a tick that stopped being governed cannot leave Teams'
        // file watchers armed. UpdateGovState adds the first-hand guard on top.
        _fgHostGoverned = hostGoverned;
        _fgHostGovPanel = hostGovPanel;
        _fgHostGovAgent = hostGovAgent;
        _fgHostGovAgentId = hostGovAgentId;

        if (isAi)
        {
            _fgIsAi = true;
            _app = proc;
            _fgLeftAiTicks = 0; // reset sticky timer
            _fgIsPanel = isPanel;
            _fgPanelId = isPanel ? panelId : "";
            _fgPanelEnforce = isPanel ? panelEnforce : true;   // non-panel surfaces enforce as before
            // Composite owner key for the typed buffer — see _fgOwnerKey.
            _fgOwnerKey = pid.ToString() + "|" + (isPanel ? panelId : "none") + "|" + panelRid;
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
                // Panel identity outlives _fgIsAi through the sticky window on
                // purpose (a block armed in a panel stays attributed to it), but
                // must not outlive the block itself — a stale panel id would let
                // CheckFgBlocked's panel branch match a surface nobody is in.
                _fgIsPanel = false;
                _fgPanelId = "";
                _fgPanelEnforce = false;
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
        // IDE processes are skipped outright — panel or not. Two independent
        // reasons, either one sufficient:
        //   1. Cost. Attempt 1 below is a descendant-wide UIA search over the
        //      whole foreground window. Against a VS Code / Cursor accessibility
        //      tree that is orders of magnitude larger than a chat window's, and
        //      it would run on the 150ms poll thread that also guards the DLP
        //      scan path.
        //   2. Meaning. Attempt 2's heuristic — "the bottom-right corner of the
        //      window is the send button" — is true of every chat app and false
        //      of every IDE, where that rectangle is the status bar or the
        //      terminal. Caching a rect there would swallow ordinary clicks.
        // Consequence, accepted for this pass: no mouse-click blocking for an
        // IDE panel's Send button, and no click-to-send prompt capture there.
        // Enter-to-send is fully blocked via the keystroke hook, which is the
        // separate and primary path.
        //
        // A HOST APP is skipped on both counts as well. Teams' accessibility
        // tree is a chat client's, not an editor's, but attempt 2's "the
        // bottom-right corner is the send button" heuristic is just as wrong
        // there: which composer that corner belongs to depends on which
        // conversation is open, and caching a rect across a conversation switch
        // would swallow an ordinary click in an ordinary chat.
        if (_ideProcs.Contains(_app) || _hostAppProcs.Contains(_app)) { _hasRect = false; return; }
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
        // PanelUiaOk, not just _fgIsAi: in an IDE with no panel focused, the
        // focused element IS the code editor or the terminal, and reading it
        // here would run every PII/secret pattern over the user's source code
        // on a 150ms loop. That is both the false-positive source the old
        // blanket IDE exclusion existed to avoid and a scan of content nobody is
        // sending anywhere. Gating at the read means _blockUia is never even
        // computed from it, rather than being computed and then filtered out at
        // each consumer — one of which (BlockActiveForMouse) does not filter.
        if (!_fgIsAi || !PanelUiaOk()) { _blockUia = false; _uiaPatterns = ""; return; }
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
        // PanelUiaOk replaces the old blanket IDE-name exclusion. Tokenize &
        // Send was NEVER offered in an IDE before; it is now offered while an
        // enforcing AI panel actually has focus, and still refused in the editor
        // or the terminal (where the "composer text" this reads would be source
        // code). Multi-line prompts are now maskable too (see
        // ComputeMaskCandidate and RunRewrite's line-break handling), which is
        // what makes the offer useful in an IDE panel and in a chat client at
        // all — a Teams message is routinely more than one line.
        //
        // A HOST APP is still excluded, but the exclusion is now GOVERNANCE-
        // SCOPED rather than blanket. Tokenize & Send is the one path in this
        // file that WRITES into another app's composer, and offering that inside
        // a general-purpose chat client would be unacceptable if the "composer"
        // could be a message to a colleague — so it is offered on exactly the
        // ticks where it provably cannot be: a DLP-GOVERNED tick, i.e. one where
        // ApplyForegroundTick has already established (from the focused element
        // plus either a named governed-agents.json row or a composer with no
        // non-AI use at all) that the user is typing at an AI. Every other Teams
        // tick — DM, channel, meeting chat, an ungoverned agent — is refused
        // exactly as before.
        //
        // A BLOCKED host-app tick is refused too, and by two independent
        // mechanisms: _fgDlpGoverned is false whenever blockGoverned is true (so
        // this line refuses it), and EmitBlock separately forces rewritable=false
        // for any _fgIsBlocked tick because RunRewrite ends in a synthetic Enter
        // the hook would swallow. Neither relies on the other.
        //
        // A SURFACE CHANGE FREEZES THE PIN, IT NO LONGER DESTROYS IT. Same
        // reasoning as the two transient-read branches below, which already
        // leave a still-unexpired candidate alone rather than believing one bad
        // tick: dropping it here made the Tokenize popup's "Edit manually" text
        // box impossible, because a box the user can type into has to hold
        // keyboard focus, and the instant it did, this tick saw a non-AI
        // foreground and wiped the pin out from under the very block being
        // edited (StartRewrite then answers "stale_block_id"). The pin now
        // survives its own expiry instead — REWRITE_TTL normally, and
        // REWRITE_EDIT_TTL while HoldPendingRewrite says a text box is open.
        //
        // This is not a licence to rewrite anything later. It only preserves an
        // ANSWER to a question already asked: nothing new is offered off a
        // frozen pin (_pendingFrozen, refused by EmitBlock and by the confirm
        // hotkey), and the tokenize command that can consume it still has to
        // get past RunRewrite's pre-flight — the same foreground window, the
        // same focused element by runtime id, the same unchanged composer text
        // — before one character is typed. A user who walked away to another
        // window cannot have their old prompt typed into it.
        //
        // THE PANIC HOTKEY STILL CLEARS OUTRIGHT. Disarmed() is the one term
        // here that means "stop touching the keyboard", so it may not freeze.
        if (!_fgIsAi || !PanelUiaOk() || (_hostAppProcs.Contains(_app) && !_fgDlpGoverned) || Disarmed())
        {
            lock (_pendingLock)
            {
                if (!_pendingRewritable || Disarmed() || DateTime.UtcNow.Ticks > _pendingExpiresAt)
                { _pendingRewritable = false; _pendingBlockId = ""; _pendingFrozen = false; }
                else _pendingFrozen = true;
            }
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
            // MULTI-LINE PRE-CHECK, decided HERE rather than inside
            // ComputeMaskCandidate: whether a line break can be typed at all is
            // a property of the SURFACE (which key combination inserts a newline
            // without submitting), not of the text, and ComputeMaskCandidate is
            // deliberately pure over the text. A surface whose catalog entry
            // declares a combo this file cannot synthesize gets no offer for
            // multi-line text — fail closed, and reported with its own reason
            // rather than a silent refusal. Single-line text is unaffected.
            bool newlineOk = !HasLineBreak(mask.Masked) || CanInsertNewline();
            if (mask.Ok && rid != null && newlineOk)
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
                // Recomputed on the surface it belongs to, so it is a live
                // offer again — and its expiry goes back to REWRITE_TTL below,
                // discarding any edit hold that was extending it.
                _pendingFrozen = false;
                _pendingWhyNot = "";
                _pendingOriginalFull = text;
                _pendingMaskedFull = mask.Masked;
                // THE WHOLE masked candidate, not a 300-char slice of it. The
                // slice was fine while `preview` only ever had to be READ ("this
                // is what gets sent"); it stopped being fine the moment the CLI
                // popup grew an "Edit manually" box, because that box is
                // PRE-FILLED from this field and its contents are what gets
                // typed — a truncated pre-fill would let the user send half a
                // message without necessarily noticing. Display truncation
                // belongs in the thing doing the displaying, and that is where
                // it now lives (toast-helper.ps1's PreviewMax).
                //
                // This is not unbounded: the candidate is already capped by
                // ComputeMaskCandidate's REWRITE_MAX_CHARS pre-filter and, more
                // tightly, by WriteFitsBudget — a masked string that cannot be
                // typed inside the write budget is never pinned at all. The cap
                // below is therefore belt-and-braces, and it is the same number
                // the enforcer would refuse to type past.
                _pendingPreview = mask.Masked.Length > REWRITE_MAX_CHARS
                    ? mask.Masked.Substring(0, REWRITE_MAX_CHARS) : mask.Masked;
                _pendingRuntimeId = rid;
                _pendingHwnd = fg;
                _pendingPid = _fgPid;
                _pendingExpiresAt = DateTime.UtcNow.Ticks + REWRITE_TTL;
            }
            else
            {
                _pendingRewritable = false;
                _pendingFrozen = false;
                _pendingWhyNot = !mask.Ok ? mask.Reason
                               : rid == null ? "no_runtime_id"
                               : "multiline_no_newline_key";
                _pendingBlockId = "";
            }
        }
    }

    // ── Holding the pin while the user retypes the prompt by hand ────────────
    // Driven by {"cmd":"tokenize_edit","block_id":"…","state":"on"|"off"} — the
    // CLI agent's Tokenize popup sends "on" the moment its "Edit manually" text
    // box opens and "off" if the user cancels or it lapses.
    //
    // ALL IT CAN DO IS MOVE ONE EXPIRY. It cannot create a pin, cannot make an
    // unrewritable block rewritable, and cannot change the window, element,
    // text or id a pin was computed from — it returns without touching anything
    // unless the block id it names is ALREADY the pinned, already-rewritable
    // one. So a wrong, replayed or invented id is a no-op, which is the same
    // answer StartRewrite gives one.
    //
    // Nothing is emitted from here. The command is a hint about how long a
    // human is likely to take; whether the rewrite is allowed at all is still
    // decided entirely by StartRewrite and RunRewrite when it is asked for.
    static void HoldPendingRewrite(string blockId, bool on)
    {
        if (string.IsNullOrEmpty(blockId)) return;
        lock (_pendingLock)
        {
            if (!_pendingRewritable || _pendingBlockId != blockId) return;
            _pendingExpiresAt = DateTime.UtcNow.Ticks + (on ? REWRITE_EDIT_TTL : REWRITE_TTL);
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
    // single-line content. Trimming it mattered when ComputeMaskCandidate
    // rejected every multi-line prompt (it made single-line content read as
    // multi-line); it still matters now that multi-line IS maskable, for a
    // different reason: a phantom trailing terminator would make RunRewrite
    // type one extra newline key the user never typed, and would put a
    // difference into the read-back comparison. Trim ONLY a trailing
    // terminator, never an embedded one — the real line structure is content.
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
        // MULTI-LINE TEXT IS MASKABLE. This used to reject any text containing
        // \n or \r outright, which made the whole feature nearly inert in a chat
        // client (a Teams message is routinely more than one line) and in an IDE
        // panel (where prompts almost always are). Nothing about the masking
        // itself needed the restriction: span collection, cluster resolution and
        // the splice are ordinary string/regex operations over the text, and .NET
        // regexes without RegexOptions.Singleline do not let `.` cross a line
        // break — so a pattern still cannot match across two lines, which is the
        // conservative direction.
        //
        // What genuinely could not handle it was the WRITE path: typing a literal
        // newline into a chat composer submits the message half-written. That is
        // fixed where it belongs, in RunRewrite (line segments plus the surface's
        // own newline key combination), and gated by the surface's catalog entry
        // in UpdatePendingRewrite — not by refusing to mask.
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

        // THE ACCURATE LENGTH GATE, on the text that will actually be TYPED.
        // The REWRITE_MAX_CHARS check above is a coarse pre-filter on the input
        // (it also bounds the regex cost); this one models the write loop's real
        // wall time — see EstimateWriteMs — and is what keeps the promise the old
        // hand-written cap broke: a rewrite this file OFFERS is a rewrite it can
        // finish. Two reasons why the two checks are not the same number:
        //   * a mask can make the text LONGER (a short match, a longer label),
        //     and it is the masked text that gets typed;
        //   * a line break costs ~25ms where a typed character costs ~15.4ms, so
        //     456 characters of prose fit and 456 characters full of line breaks
        //     do not.
        // Refusing here costs the user an offer they never had; getting it wrong
        // costs them a cleared composer holding half a message.
        if (!WriteFitsBudget(masked)) { result.Reason = "too_long_to_write"; return result; }

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

    // `panel` names WHICH AI surface inside an IDE this event came from, when
    // the foreground was an IDE panel. It is a catalog id ("claude_code"), never
    // anything read out of the app: an element Name or a window title in VS Code
    // can carry a file path or a workspace name, and neither is ever emitted
    // from anywhere in this file. index.js prefers it over `process` when
    // resolving service/vendor/tool_host, because the process ("Code") does not
    // identify a product on its own.
    static string PanelField()
    {
        return (_fgIsPanel && !string.IsNullOrEmpty(_fgPanelId)) ? ",\"panel\":\"" + Esc(_fgPanelId) + "\"" : "";
    }

    // Same field, but for a PLATFORM BLOCK: attribute it to the panel the block
    // was actually established for, not to whatever surface this tick's global
    // focused-element read happened to land on. index.js resolves tool_host from
    // `panel`, and tool_host is what the Request Access dialog asks for an
    // exception against — so reporting a neighbouring panel here (Copilot Chat
    // in the same VS Code window → github.com) made the user file a request that
    // could never lift the claude.ai block they were actually hitting.
    // An AGENT-scoped block deliberately falls through to PanelField() (which is
    // empty for a chat app): there is no `panel` to attribute it to, and putting
    // an agent-surface id in a field index.js resolves a tool_host from would
    // send the user's Request Access at the wrong key. LatchedPanelId() is what
    // keeps the two namespaces apart.
    static string PlatformBlockPanelField()
    {
        if (_blockedByElement)
        {
            string panelId = LatchedPanelId();
            if (panelId.Length > 0) return ",\"panel\":\"" + Esc(panelId) + "\"";
        }
        return PanelField();
    }

    static void Emit(string kind, string app, string patterns, string reason, int len = -1, int seconds = -1, string message = null)
    {
        string json = "{\"kind\":\"" + kind + "\""
            + (reason.Length > 0 ? ",\"reason\":\"" + Esc(reason) + "\"" : "")
            + (app.Length > 0 ? ",\"process\":\"" + Esc(app) + "\"" : "")
            + (app.Length > 0 ? PanelField() : "")
            + (patterns.Length > 0 ? ",\"patterns\":\"" + Esc(patterns) + "\"" : "")
            + (len >= 0 ? ",\"len\":" + len : "")
            + (seconds >= 0 ? ",\"seconds\":" + seconds : "")
            + (message != null ? ",\"message\":\"" + Esc(message) + "\"" : "")
            + "}";
        lock (_emitLock) { Console.Out.WriteLine(json); Console.Out.Flush(); }
    }

    // JSON string escaping for every field this file emits.
    //
    // Backslash and quote were the whole of it, which was sufficient only while
    // nothing emitted here could contain a CONTROL CHARACTER. Multi-line masked
    // text can (that is the point of it), and an unescaped newline in a value
    // does not merely produce invalid JSON — it splits the NDJSON line in two,
    // so the Node side sees a truncated event followed by a garbage line. Every
    // field routes through here, so fixing it here fixes `preview` (a masked
    // substring), the rewrite's `masked`, and any future field at once.
    //
    // \u escapes rather than the short forms for the rare ones: one branch,
    // valid JSON for every C0 character including the ones with no short form.
    static string Esc(string s)
    {
        if (string.IsNullOrEmpty(s)) return "";
        var sb = new StringBuilder(s.Length + 8);
        foreach (char c in s)
        {
            if (c == '\\') sb.Append("\\\\");
            else if (c == '"') sb.Append("\\\"");
            else if (c == '\n') sb.Append("\\n");
            else if (c == '\r') sb.Append("\\r");
            else if (c == '\t') sb.Append("\\t");
            else if (c < ' ' || c == (char)0x7f) sb.Append("\\u").Append(((int)c).ToString("x4"));
            else sb.Append(c);
        }
        return sb.ToString();
    }

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
            // A FROZEN pin is never offered. It was computed on a surface that
            // no longer has the foreground (see _pendingFrozen), so its id and
            // its preview describe some other composer than the one this block
            // just fired on — offering it would put one app's masked text in a
            // popup labelled with another's, and the rewrite would abort on
            // RunRewrite's foreground check anyway. The next poll tick on the
            // real surface unfreezes it and this block becomes offerable again.
            rewritable = _pendingRewritable && !_pendingFrozen && blockId.Length > 0;
            preview = _pendingPreview;
            whyNot = _pendingFrozen ? "surface_changed" : _pendingWhyNot;
        }
        if (!rewritable) blockId = "";
        // An attachment hold is never rewritable — Tokenize & Send only ever
        // masks TEXT, never removes a file. _pendingRewritable/_pendingBlockId
        // are a fully independent pin (the composer TEXT might separately be
        // maskable), so without this override a dialog could offer "Tokenize &
        // Send" for text while the actual thing holding the send is the
        // attached file — masking the text would do nothing to unblock it.
        if (reason == "attachment") { rewritable = false; blockId = ""; }
        // A FULL PLATFORM BLOCK is never rewritable either, for a mechanical
        // reason rather than a UX one: RunRewrite finishes by synthesizing an
        // Enter, and the Enter-decision code swallows every Enter while
        // _fgIsBlocked is set — including an injected one, since it does not
        // exempt injected keys. So "Tokenize & Send" on a platform-blocked app
        // wiped the composer, retyped the masked text and then silently failed
        // with not_submitted. The user's actual remediation here is Request
        // Access (the fields below), not masking: the org disallowed the whole
        // app, not this one sentence.
        bool platformBlock = _fgIsBlocked && reason != "attachment";
        if (platformBlock) { rewritable = false; blockId = ""; }
        string json = "{\"kind\":\"block\""
            + ",\"reason\":\"" + Esc(reason) + "\""
            + (app.Length > 0 ? ",\"process\":\"" + Esc(app) + "\"" : "")
            + (platformBlock ? PlatformBlockPanelField() : PanelField())
            + (patterns.Length > 0 ? ",\"patterns\":\"" + Esc(patterns) + "\"" : "")
            + ",\"block_id\":\"" + Esc(blockId) + "\""
            + ",\"rewritable\":" + (rewritable ? "true" : "false")
            + (rewritable ? ",\"preview\":\"" + Esc(preview) + "\"" : (whyNot.Length > 0 ? ",\"why_not\":\"" + Esc(whyNot) + "\"" : ""))
            + (reason == "attachment" ? ",\"filename\":\"" + Esc(_attachHoldFilename) + "\"" : "")
            // Identity of the block, for the Request Access dialog. No prompt
            // content — a platform id, a display name and an agent id, all of
            // them values an admin typed into the blocklist.
            // block_scope is the AUTHORITATIVE scope of the block: "app" = the
            // whole process is disallowed, "panel" = one AI composer inside an
            // IDE is, "agent" = one named agent inside a chat app is. It comes
            // straight from _blockScope, i.e. from the branch of CheckFgBlocked
            // that armed the block. Consumers must NOT infer scope from the
            // `panel` field above — that field is ATTRIBUTION
            // (PlatformBlockPanelField falls back to PanelField, so any
            // panelFallback:true IDE entry can put a panel id on an app-scoped
            // block, and an agent-scoped block carries no panel at all) and
            // answers a different question entirely.
            + (platformBlock ? ",\"platform_block\":true"
                 + ",\"block_scope\":\"" + Esc(BlockScope()) + "\""
                 + ",\"blocked_platform\":\"" + Esc(_blockedPlatform) + "\""
                 + ",\"blocked_agent\":\"" + Esc(_blockedAgentName) + "\""
                 + ",\"blocked_agent_id\":\"" + Esc(_blockedAgentId) + "\"" : "")
            + "}";
        lock (_emitLock) { Console.Out.WriteLine(json); Console.Out.Flush(); }
    }

    // The Tier B outcome line.
    //
    // ── `masked`: THE ONE PLACE PROMPT TEXT LEAVES THIS PROCESS ──────────────
    // A deliberate, reviewed change to this channel's contract, made so the
    // tokenization audit trail matches the browser extension's, which has always
    // recorded the masked prompt for an `enforcement_redact` event. Everything
    // about it is narrow:
    //
    //   * MASKED ONLY. The caller passes the exact string that was typed and
    //     sent — either the output of ComputeMaskCandidate, whose every
    //     sensitive span has been replaced by a fixed category label, or the
    //     user's own hand-edited replacement from the Tokenize popup's "Edit
    //     manually" box. EITHER WAY it is the string RunRewrite read back out of
    //     the composer and RESCANNED to prove no active pattern still matches
    //     it, which is the property this field's contract actually rests on —
    //     an "edit" that still carried the secret never reaches this line at
    //     all, it fails "verify_mismatch". The original text exists in this file
    //     as `original`/_pendingOriginalFull and is never passed here; there is
    //     no parameter it could arrive through.
    //   * ONLY ON A VERIFIED SEND. Every abort/failure path calls this with no
    //     masked argument at all, so a rewrite that did not complete carries
    //     nothing. The one call site that passes it is the final "ok"/"sent"
    //     line, reached only after the composer was read back and confirmed to
    //     hold exactly that text and after the send was confirmed to have
    //     cleared it.
    //   * OMITTED, NOT EMPTY, when absent — so a consumer can tell "no content
    //     on this event" from "an empty prompt", and every existing
    //     abort/failure line stays byte-for-byte what it was.
    // Esc() escapes control characters (see its own comment), which is what
    // makes a multi-line masked prompt safe to put on an NDJSON line at all.
    static void EmitRewrite(string blockId, string result, string reason, string masked = null)
    {
        string json = "{\"kind\":\"rewrite\""
            + ",\"block_id\":\"" + Esc(blockId ?? "") + "\""
            + ",\"result\":\"" + Esc(result) + "\""
            + (!string.IsNullOrEmpty(reason) ? ",\"reason\":\"" + Esc(reason) + "\"" : "")
            + (masked != null ? ",\"masked\":\"" + Esc(masked) + "\"" : "")
            + "}";
        lock (_emitLock) { Console.Out.WriteLine(json); Console.Out.Flush(); }
    }

    // ── Request Access offer ──────────────────────────────────────────────────
    // Called from the two swallow branches that stop a send — the Enter decision
    // in the keyboard hook and the send-button click in the mouse hook —
    // immediately AFTER EmitBlock and without changing a single thing about it:
    // the toast, the `block` line, the cooldown stamp and the latch bookkeeping
    // all happen exactly as they did. This is a second, independent line that
    // says "a blocked send just happened, offer the user a way to ask for
    // access".
    //
    // STATELESS, AND EVERY BLOCKED SEND OFFERS. There is no per-session latch
    // and no minimum interval; both existed and both were wrong. A user whose
    // request was declined — or who cancelled, or mistyped their reason — is
    // still blocked, and the next message they try is exactly when they need the
    // dialog again. Suppressing it there left them stuck with no visible way to
    // ask.
    //
    // What stops a DUPLICATE is concurrency-scoped and lives with the dialog,
    // not here: toast-helper.ps1 refuses a second form while one is on screen
    // for the same key, and index.js drops an offer for a block it is already
    // mid-flight on. Both release the moment the dialog closes. So holding Enter
    // down cannot stack windows, while pressing it again after answering offers
    // again straight away — which is the whole point.
    //
    // GATES, and only these two. The first mirrors EmitBlock's own
    // `platformBlock`: a real platform/agent/panel block, never a pattern-based
    // content block. The second excludes an attachment hold. Asking an admin for
    // "access" makes no sense for either of those — the remedy there is removing
    // the sensitive data or detaching the file, which the block toast already
    // says.
    //
    // PII: every value below comes from the ARMED BLOCKLIST ROW (admin-typed
    // agent name, server-issued agent id, platform id) or from the process /
    // panel catalog. Nothing parsed out of a window title or a UIA element can
    // reach this line — that is the same discipline EmitBlock and EmitBlockState
    // hold, and the reason the name emitted here is _blockedAgentName rather
    // than the read one.
    static void OfferAccessRequest(string app, string reason)
    {
        if (!_fgIsBlocked) return;
        if (reason == "attachment") return;
        string scope = BlockScope();
        string json = "{\"kind\":\"request_access_offer\""
            + ",\"block_scope\":\"" + Esc(scope) + "\""
            + (app.Length > 0 ? ",\"process\":\"" + Esc(app) + "\"" : "")
            + PlatformBlockPanelField()
            + ",\"blocked_platform\":\"" + Esc(_blockedPlatform) + "\""
            + ",\"blocked_agent\":\"" + Esc(_blockedAgentName) + "\""
            + ",\"blocked_agent_id\":\"" + Esc(_blockedAgentId) + "\""
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
    //
    // This is ALSO what makes the multi-line read-back comparison work, with no
    // change needed: "\s+" already collapses every line terminator, so a
    // composer that reports "\r\n" where we typed a Shift+Enter, or "\n" where
    // it stores " ", compares equal to the masked text we pinned. The
    // allowance is deliberately no wider than it already was for single-line
    // text — it is the same one call, applied to both sides of every comparison.
    static string NormalizeWs(string s)
    {
        if (s == null) return "";
        return Regex.Replace(s.Trim(), "\\s+", " ");
    }

    // ── Line breaks in a masked rewrite ──────────────────────────────────────
    // Typing a literal '\n' with SendInput submits the message in every chat
    // composer this feature targets (that is exactly what the Enter-swallow
    // exists to intercept), so a multi-line rewrite may never do it. It types
    // each line as text and sends the SURFACE'S OWN newline combination between
    // the segments instead.
    //
    // WHICH combination is a catalog fact, not an assumption baked in here: it
    // travels per AI_PANELS entry as `newlineKeys` (see PanelSig.NewlineKeys).
    // NEWLINE_KEYS_DEFAULT is the fallback for a surface with no panel entry at
    // all — a pure chat app like Claude Desktop, which has no AI_PANELS row —
    // and MIRRORS ai-processes.js's DEFAULT_NEWLINE_KEYS. The two are held in
    // lockstep by agent/tests/os-monitor-safety.test.mjs, the same way
    // PLATFORM_PROCS is.
    const string NEWLINE_KEYS_DEFAULT = "shift_enter";

    static bool HasLineBreak(string s)
    {
        return !string.IsNullOrEmpty(s) && (s.IndexOf('\n') >= 0 || s.IndexOf('\r') >= 0);
    }

    // The newline combination declared for the surface that has focus right now.
    // A matched panel's entry wins; anything else gets the default.
    static string NewlineKeysFor()
    {
        if (_fgIsPanel && !string.IsNullOrEmpty(_fgPanelId))
        {
            var panels = _panels;
            if (panels != null)
            {
                foreach (var p in panels)
                {
                    if (!string.Equals(p.Id, _fgPanelId, StringComparison.OrdinalIgnoreCase)) continue;
                    // An entry that states nothing gets the default; an entry
                    // that states something unrecognised keeps saying it, so
                    // ResolveNewlineKeys can refuse rather than silently
                    // substitute a combo the app might treat as send.
                    return string.IsNullOrEmpty(p.NewlineKeys) ? NEWLINE_KEYS_DEFAULT : p.NewlineKeys;
                }
            }
        }
        return NEWLINE_KEYS_DEFAULT;
    }

    // Map a catalog value to a modifier+key pair. FALSE for anything this file
    // does not know how to synthesize — the caller then refuses the multi-line
    // rewrite instead of guessing, because the wrong guess here sends a
    // half-written message rather than inserting a line.
    static bool ResolveNewlineKeys(string keys, out int vkMod, out int vkKey)
    {
        vkMod = 0; vkKey = 0;
        if (string.IsNullOrEmpty(keys)) return false;
        if (string.Equals(keys, "shift_enter", StringComparison.OrdinalIgnoreCase))
        { vkMod = VK_SHIFT; vkKey = VK_RETURN; return true; }
        if (string.Equals(keys, "ctrl_enter", StringComparison.OrdinalIgnoreCase))
        { vkMod = VK_CONTROL; vkKey = VK_RETURN; return true; }
        return false;
    }

    static bool CanInsertNewline()
    {
        int mod, key;
        return ResolveNewlineKeys(NewlineKeysFor(), out mod, out key);
    }

    // Split masked text into the segments between line breaks. "\r\n", "\n" and
    // a bare "\r" are all one break; the terminators themselves are dropped,
    // because they are what the newline KEY replaces. An empty segment is kept
    // (a blank line in the middle of a prompt is content), so the reconstructed
    // line count always matches what was read.
    static List<string> SplitMaskedLines(string masked)
    {
        var lines = new List<string>();
        if (masked == null) { lines.Add(""); return lines; }
        int start = 0;
        for (int i = 0; i < masked.Length; i++)
        {
            char c = masked[i];
            if (c != '\n' && c != '\r') continue;
            lines.Add(masked.Substring(start, i - start));
            if (c == '\r' && i + 1 < masked.Length && masked[i + 1] == '\n') i++;
            start = i + 1;
        }
        lines.Add(masked.Substring(start));
        return lines;
    }

    // ── How long the write will actually take ────────────────────────────────
    // An EXACT model of RunRewrite's write loop, built from the same constants
    // the loop sleeps on:
    //   * every character of a segment costs REWRITE_CHAR_DELAY_MS
    //     (SendUnicodeChunk paces one SendInput per character);
    //   * every chunk of a segment costs REWRITE_CHUNK_DELAY_MS on top
    //     (the settle after each SendUnicodeChunk call);
    //   * every line break between segments costs a SendKeyCombo — three
    //     inter-event pauses — plus that same settle.
    //
    // A LINE BREAK IS THE EXPENSIVE CHARACTER: 3*5+10 = 25ms against ~15.4ms
    // for a typed one. That is precisely why a pure character cap cannot answer
    // this question on its own, and why multi-line support is what made the
    // stale arithmetic worth correcting rather than just documenting.
    //
    // Deliberately an OVER-estimate where it is not exact: the ceil() on chunks
    // charges a partial chunk as a whole settle, and the margin below assumes
    // every sleep overshoots. Erring long means a write the check accepted
    // finishes; erring short means the composer is cleared and half retyped.
    static int EstimateWriteMs(string masked)
    {
        var segments = SplitMaskedLines(masked);
        int ms = 0;
        for (int i = 0; i < segments.Count; i++)
        {
            // The newline combination between two segments.
            if (i > 0) ms += 3 * REWRITE_KEY_DELAY_MS + REWRITE_CHUNK_DELAY_MS;
            int len = segments[i].Length;
            ms += len * REWRITE_CHAR_DELAY_MS;
            ms += ((len + REWRITE_CHUNK - 1) / REWRITE_CHUNK) * REWRITE_CHUNK_DELAY_MS;
        }
        return ms;
    }

    // Will typing this masked text finish inside the write budget, with the
    // slow-clock margin? Compared against REWRITE_USABLE_BUDGET_MS rather than
    // inflating the estimate, so the margin lives in exactly one place.
    static bool WriteFitsBudget(string masked)
    {
        return EstimateWriteMs(masked) <= REWRITE_USABLE_BUDGET_MS;
    }

    // How long to keep confirming the send for the surface that has focus right
    // now. Deliberately the SAME shape as NewlineKeysFor: a matched panel's
    // catalog entry wins, and anything else — a pure chat app with no AI_PANELS
    // row, an unknown panel id, no panel at all — gets the default, which is one
    // read at +REWRITE_POST_SEND_MS and therefore the pre-existing behaviour.
    //
    // The entry's value is already clamped by LoadAiPanels, so this returns a
    // number inside [REWRITE_POST_SEND_MS, REWRITE_POST_SEND_MAX_MS] whatever
    // the payload said.
    static int PostSendVerifyMsFor()
    {
        if (_fgIsPanel && !string.IsNullOrEmpty(_fgPanelId))
        {
            var panels = _panels;
            if (panels != null)
            {
                foreach (var p in panels)
                {
                    if (!string.Equals(p.Id, _fgPanelId, StringComparison.OrdinalIgnoreCase)) continue;
                    return p.PostSendVerifyMs < REWRITE_POST_SEND_MS ? REWRITE_POST_SEND_MS : p.PostSendVerifyMs;
                }
            }
        }
        return REWRITE_POST_SEND_MS;
    }

    // `editedText` is the user's OWN replacement, typed into the Tokenize
    // popup's "Edit manually" box, and NULL on every pre-existing path (the
    // confirm hotkey and a plain {"cmd":"tokenize"}), which keeps this file's own
    // masked candidate the default.
    //
    // WHAT IT DOES NOT CHANGE — every one of these is re-run or re-verified for
    // the edited text exactly as for a computed mask:
    //   * the pinned-id check and the pin's expiry, below;
    //   * the length gate and the WRITE BUDGET, both recomputed FROM THIS TEXT
    //     rather than inherited from the mask that was pinned — an edit can be
    //     longer, shorter, or turn a one-line prompt into five, and a line break
    //     costs more wall time to type than a character does (EstimateWriteMs);
    //   * RunRewrite's whole pre-flight: same foreground window, same focused
    //     element by runtime id, and a composer still holding the ORIGINAL
    //     unchanged text — an edit is a replacement for what the user typed at
    //     the AI, so the thing being replaced still has to be there;
    //   * the newline-key gate, which RunRewrite already resolves against the
    //     text it is handed, so a multi-line edit on a surface with no usable
    //     combination is refused ("no_newline_key") rather than typed;
    //   * read-back verification, INCLUDING the full pattern rescan of what
    //     landed in the composer. That is what keeps this honest without a
    //     second content scan here: an "edit" that still carries the secret
    //     fails "verify_mismatch" and is never sent.
    //
    // WHAT IT DELIBERATELY DOES NOT DO is re-run masking. The user has just
    // hand-edited this text for the express purpose of removing the sensitive
    // part; the job here is "type exactly this and send it", with the same
    // reliability guarantees, not a second opinion about their wording.
    static void StartRewrite(string blockId, string editedText = null)
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

        if (editedText != null)
        {
            // FAIL CLOSED, LOUDLY, on anything the write loop could not finish.
            // Never truncate: a silently shortened prompt is a message the user
            // did not write, sent under their name — strictly worse than
            // refusing and leaving the block standing, which is what every
            // other rejection on this path does. Same two gates
            // ComputeMaskCandidate applies, in the same order, against THIS
            // string: the coarse character cap first, then the accurate model
            // of the write loop's real wall time.
            if (editedText.Trim().Length == 0) { EmitRewrite(blockId, "aborted", "edit_empty"); return; }
            if (editedText.Length > REWRITE_MAX_CHARS) { EmitRewrite(blockId, "aborted", "edit_too_long"); return; }
            if (!WriteFitsBudget(editedText)) { EmitRewrite(blockId, "aborted", "edit_too_long_to_write"); return; }
            masked = editedText;
        }

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

            // Multi-line pre-flight, and it happens BEFORE Ctrl+A/Delete so a
            // refusal costs nothing: the composer is untouched and the block is
            // still armed. UpdatePendingRewrite already refuses to pin such a
            // candidate, so this is the second, independent statement of the
            // same rule — the write path must never be able to type a line
            // break it cannot type safely, whatever the pin says.
            int nlMod = 0, nlKey = 0;
            bool multiline = HasLineBreak(masked);
            if (multiline && !ResolveNewlineKeys(NewlineKeysFor(), out nlMod, out nlKey))
            { EmitRewrite(blockId, "aborted", "no_newline_key"); return; }

            // How long the post-send confirmation at the very end of this method
            // may keep re-reading the composer, for THIS surface. Captured HERE,
            // in the pre-flight, for the same reason the newline combination is:
            // both are read off the panel state the poll thread maintains, and
            // that thread keeps sampling while we clear and retype the composer.
            // One read of it, pinned, so the window cannot change underneath the
            // confirmation it governs.
            int postSendMs = PostSendVerifyMsFor();

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

            // The write. One segment per line, with the surface's newline
            // combination between segments instead of a typed '\n' — see
            // SplitMaskedLines and NewlineKeysFor.
            //
            // Single-line text takes exactly the path it always did: one segment,
            // the same chunk loop, the same per-chunk abort/budget/foreground
            // re-check, no key combination sent at all.
            //
            // BUDGET. The newline combinations ARE accounted for, and not by
            // hand: EstimateWriteMs models this exact loop — every character's
            // pace, every chunk's settle, and 3*REWRITE_KEY_DELAY_MS +
            // REWRITE_CHUNK_DELAY_MS (25ms) for every break — and
            // ComputeMaskCandidate refuses to offer a rewrite whose estimate
            // does not fit REWRITE_USABLE_BUDGET_MS. A break is the EXPENSIVE
            // character (25ms vs ~15.4ms), so the estimate is what decides, not
            // the coarse character cap.
            // The check below therefore should not fire for an offered rewrite
            // at all; it stays as the runtime backstop it always was, for a
            // machine slower than the margin allows for. When it does fire the
            // outcome is unchanged: abort, block still armed, nothing sent.
            long budgetEnd = DateTime.UtcNow.Ticks + REWRITE_WRITE_BUDGET;
            var segments = SplitMaskedLines(masked);
            for (int seg = 0; seg < segments.Count; seg++)
            {
                if (seg > 0)
                {
                    // Same three abort conditions as a chunk, checked before the
                    // combination as well as before each chunk: a line break is
                    // input into the target app just as much as a character is.
                    if (_rewriteAbort || DateTime.UtcNow.Ticks > budgetEnd || GetForegroundWindow() != pinnedHwnd)
                    { EmitRewrite(blockId, "aborted", "interrupted_mid_write"); return; }
                    SendKeyCombo(nlMod, nlKey);
                    Thread.Sleep(REWRITE_CHUNK_DELAY_MS);
                }
                string line = segments[seg];
                for (int i = 0; i < line.Length; i += REWRITE_CHUNK)
                {
                    if (_rewriteAbort || DateTime.UtcNow.Ticks > budgetEnd || GetForegroundWindow() != pinnedHwnd)
                    { EmitRewrite(blockId, "aborted", "interrupted_mid_write"); return; }
                    int len = Math.Min(REWRITE_CHUNK, line.Length - i);
                    SendUnicodeChunk(line.Substring(i, len));
                    Thread.Sleep(REWRITE_CHUNK_DELAY_MS);
                }
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
            //
            // POLLED, not a single read — this was the last one-shot read left
            // in the rewrite flow and it was producing false failures. The first
            // read is still at +REWRITE_POST_SEND_MS, which is all a native
            // composer ever needed; after that it re-reads every
            // REWRITE_POST_SEND_POLL_MS until this surface's own window closes
            // (REWRITE_POST_SEND_MS by default, so a surface with no catalog
            // value takes exactly one read and behaves as it always did).
            //
            // Confirmed live against Microsoft Teams: the masked message was in
            // the conversation and this check still said "not_submitted", which
            // cost the enforcement_redact audit event for a real governed send
            // (index.js's 'rewrite' handler returns early on any non-"ok"
            // result). Teams renders its composers in a WebView2 child process,
            // so the cleared composer has to cross a Chromium accessibility
            // serialization before UIA reports it — see REWRITE_POST_SEND_MS.
            //
            // Waiting longer cannot turn a genuine failure into a success: text
            // that was never submitted stays in the composer for the whole
            // window and still reports "not_submitted". The loop exits the
            // instant the composer no longer holds the masked text, so the
            // common case costs nothing extra.
            Thread.Sleep(REWRITE_POST_SEND_MS);
            long postSendDeadline = DateTime.UtcNow.Ticks
                + TimeSpan.FromMilliseconds(postSendMs - REWRITE_POST_SEND_MS).Ticks;
            string postSend = null;
            try { postSend = ReadText(el); } catch { }
            bool stillThere = NormalizeWs(postSend) == NormalizeWs(masked);
            while (stillThere && DateTime.UtcNow.Ticks < postSendDeadline)
            {
                Thread.Sleep(REWRITE_POST_SEND_POLL_MS);
                postSend = null;
                try { postSend = ReadText(el); } catch { }
                stillThere = NormalizeWs(postSend) == NormalizeWs(masked);
            }
            if (stillThere) { EmitRewrite(blockId, "failed", "not_submitted"); return; }

            // The ONE call that carries content, and only after: the read-back
            // proved the composer held exactly this masked text, a full rescan of
            // it found no active pattern, and the post-send read proved it
            // actually left the composer. `masked` — never `original`.
            EmitRewrite(blockId, "ok", "sent", masked);
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
    // The inter-event pauses are REWRITE_KEY_DELAY_MS, not a literal, because
    // EstimateWriteMs charges a newline combination exactly three of them — see
    // that method for why the arithmetic and the sleeps must share one constant.
    static void SendKeyPress(int vk) { SendKeyEvent(vk, false); Thread.Sleep(REWRITE_KEY_DELAY_MS); SendKeyEvent(vk, true); }
    static void SendKeyCombo(int vkMod, int vkKey)
    {
        SendKeyEvent(vkMod, false); Thread.Sleep(REWRITE_KEY_DELAY_MS);
        SendKeyEvent(vkKey, false); Thread.Sleep(REWRITE_KEY_DELAY_MS);
        SendKeyEvent(vkKey, true); Thread.Sleep(REWRITE_KEY_DELAY_MS);
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
        // can't keep up with an instantaneous burst. Pacing individual
        // characters is the standard fix for this exact class of
        // synthetic-input corruption.
        //
        // THE PACE IS THE CONSTANT, and it is what the character cap is computed
        // from — REWRITE_CHAR_DELAY_MS(15) * REWRITE_MAX_CHARS(456) plus the
        // per-chunk settles is the write budget's usable 7.2s. It used to be a
        // literal here while a comment beside the cap claimed 4ms, which is
        // exactly how a documented 2000-character limit came to abort at ~580.
        // Changing this value changes REWRITE_MAX_CHARS automatically; changing
        // it DOWN to buy a bigger cap would trade a refused long prompt for the
        // corruption above, which is not a trade this feature makes.
        foreach (char c in chunk)
        {
            var pair = new INPUT[2];
            pair[0] = new INPUT(); pair[0].type = INPUT_KEYBOARD; pair[0].ki.wVk = 0; pair[0].ki.wScan = (ushort)c; pair[0].ki.dwFlags = KEYEVENTF_UNICODE; pair[0].ki.dwExtraInfo = IntPtr.Zero;
            pair[1] = new INPUT(); pair[1].type = INPUT_KEYBOARD; pair[1].ki.wVk = 0; pair[1].ki.wScan = (ushort)c; pair[1].ki.dwFlags = KEYEVENTF_UNICODE | KEYEVENTF_KEYUP; pair[1].ki.dwExtraInfo = IntPtr.Zero;
            uint sent = SendInput(2, pair, Marshal.SizeOf(typeof(INPUT)));
            CheckSendInputResult(2, sent);
            Thread.Sleep(REWRITE_CHAR_DELAY_MS);
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

[CfaiEnforcer]::Start(($aiProcs -split ','), $patNames.ToArray(), $patSources.ToArray(), $patSevs.ToArray(), $patLabels.ToArray(), [bool[]]($patIgnoreCase.ToArray()), $hbPath, $modelRouterEnabled, $mrConfigJson, $ideProcsJson, $aiPanelsJson, $agentSurfacesJson)

# Keep the process alive — the C# background threads (poll + message pump) do
# the work and write events to stdout. Node reads them.
while ($true) { Start-Sleep -Seconds 3600 }

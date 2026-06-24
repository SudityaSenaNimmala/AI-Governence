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
#
# Emits NDJSON on stdout for the Node orchestrator:
#   {"kind":"ready"}
#   {"kind":"block","reason":"send"|"paste","process":"claude","patterns":"aws-access-key"}
#   {"kind":"override","process":"claude","patterns":"..."}
#   {"kind":"error","message":"..."}
#
# Limitations (told to the user): blocks Enter-to-send and Ctrl+V; clicking the
# send button with the mouse is not swallowed. The typed buffer is a best-effort
# reconstruction (mouse-editing mid-string can desync) but errs toward catching
# the secret. Charset covers the secret patterns (A-Za-z0-9 _ - . /).

$ErrorActionPreference = 'Stop'
$ProgressPreference    = 'SilentlyContinue'
$WarningPreference     = 'SilentlyContinue'

$aiProcs = if ($env:CFAI_AI_PROCESSES) { $env:CFAI_AI_PROCESSES } else { 'ChatGPT,Claude,Cursor,Copilot,M365Copilot,Comet,Gemini,Poe' }
# CFAI_BLOCK_PATTERNS is a JSON array of {name, source}. Parse to two parallel
# arrays we can hand to the C# enforcer.
$patNames   = New-Object System.Collections.ArrayList
$patSources = New-Object System.Collections.ArrayList
if ($env:CFAI_BLOCK_PATTERNS) {
    try {
        $parsed = $env:CFAI_BLOCK_PATTERNS | ConvertFrom-Json
        foreach ($p in $parsed) { [void]$patNames.Add([string]$p.name); [void]$patSources.Add([string]$p.source) }
    } catch {}
}

$source = @'
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Collections.Generic;
using System.Windows.Automation;

public static class CfaiEnforcer
{
    delegate IntPtr LowLevelKeyboardProc(int nCode, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll", SetLastError = true)]
    static extern IntPtr SetWindowsHookEx(int idHook, LowLevelKeyboardProc lpfn, IntPtr hMod, uint dwThreadId);
    [DllImport("user32.dll", SetLastError = true)]
    static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Auto)]
    static extern IntPtr GetModuleHandle(string lpModuleName);
    [DllImport("user32.dll")]
    static extern IntPtr GetForegroundWindow();
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

    const int WH_KEYBOARD_LL = 13;
    const int WH_MOUSE_LL = 14;
    const int WM_KEYDOWN = 0x0100;
    const int WM_SYSKEYDOWN = 0x0104;
    const int WM_LBUTTONDOWN = 0x0201;
    const int WM_LBUTTONUP = 0x0202;
    const int VK_BACK = 0x08;
    const int VK_RETURN = 0x0D;
    const int VK_SHIFT = 0x10;
    const int VK_CONTROL = 0x11;
    const int VK_MENU = 0x12;     // Alt
    const int VK_CAPITAL = 0x14;
    const int VK_ESCAPE = 0x1B;
    const int VK_V = 0x56;

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

    // Blocked agents — the foreground process is fully blocked (all Enter +
    // send button swallowed) when it matches a platform in the blocklist.
    // Updated every 30s by reading ~/.cloudfuze-aigov/blocked-agents.json.
    static volatile bool _fgIsBlocked = false;
    static string _blockedReason = "";
    static string _blockedAgentFile = "";
    static long _lastBlockedCheck = 0;
    static readonly long BLOCKED_CHECK_INTERVAL = TimeSpan.FromSeconds(10).Ticks;
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

    // Typed-buffer block — written only by the hook thread.
    static volatile bool _blockTyped = false;
    static string _typedPatterns = "";
    static readonly StringBuilder _typed = new StringBuilder();
    static uint _typedOwnerPid = 0;
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

    // Timestamp of last Ctrl+V press.  Clipboard is only checked in the
    // Enter decision within a short window after a paste — long enough for
    // the user to paste and immediately hit Enter, short enough that stale
    // clipboard from minutes ago doesn't false-block.
    static long _lastPasteTicks = 0;
    static readonly long PASTE_WINDOW = TimeSpan.FromSeconds(5).Ticks;

    static HashSet<string> _aiProcs;
    // IDE-type apps where UIA reads code/terminal/output, not just the AI
    // prompt.  For these, UIA is excluded from the Enter-block decision to
    // avoid false positives.  Pure chat apps (Claude, ChatGPT, Gemini) keep
    // UIA in the Enter check because the focused element IS the composer.
    static readonly HashSet<string> _ideApps = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        { "Cursor", "Code", "VSCode", "Copilot" };
    static List<KeyValuePair<string, Regex>> _regexes;
    static readonly object _emitLock = new object();

    public static void Start(string[] aiProcs, string[] patNames, string[] patSources)
    {
        try { SetProcessDPIAware(); } catch { }   // align UIA rect with hook screen coords
        _blockedAgentFile = System.IO.Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
            ".cloudfuze-aigov", "blocked-agents.json");
        _aiProcs = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var p in aiProcs) { if (!string.IsNullOrEmpty(p)) _aiProcs.Add(p.Replace(".exe", "")); }
        _regexes = new List<KeyValuePair<string, Regex>>();
        for (int i = 0; i < patSources.Length; i++)
        {
            try { _regexes.Add(new KeyValuePair<string, Regex>(patNames[i], new Regex(patSources[i], RegexOptions.CultureInvariant))); }
            catch { }
        }
        // The poll thread MUST be STA: UI Automation's FocusedElement read
        // returns null from an MTA thread for Chromium/Electron apps (Claude,
        // ChatGPT), which is why an earlier MTA version detected nothing in the
        // box. The working prompt-watcher.ps1 runs -Sta for the same reason.
        var poll = new Thread(PollLoop); poll.IsBackground = true;
        poll.SetApartmentState(ApartmentState.STA); poll.Start();
        var pump = new Thread(PumpLoop); pump.IsBackground = true; pump.Start();
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
        return TypedBlockFresh() || (pastedThisSession && clipBlock);
    }

    // Block is active for mouse-hook send-button detection: includes UIA
    // and the paste-window clipboard check so pasted secrets also block
    // the send button click.
    static bool BlockActiveForMouse()
    {
        bool recentPaste = (DateTime.UtcNow.Ticks - _lastPasteTicks) < PASTE_WINDOW;
        return _fgIsBlocked || TypedBlockFresh() || _blockUia || (recentPaste && _blockPaste);
    }

    static string ActivePatterns() { return _blockTyped ? _typedPatterns : _blockUia ? _uiaPatterns : ""; }

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
                if (msg == WM_LBUTTONDOWN || msg == WM_LBUTTONUP)
                {
                    if (_fgIsAi && BlockActiveForMouse() && _hasRect)
                    {
                        int x = Marshal.ReadInt32(lParam);        // MSLLHOOKSTRUCT.pt.x
                        int y = Marshal.ReadInt32(lParam, 4);     // MSLLHOOKSTRUCT.pt.y
                        if (x >= _rx && x < _rx + _rw && y >= _ry && y < _ry + _rh)
                        {
                            if (msg == WM_LBUTTONDOWN) Emit("block", _app, ActivePatterns(), "click");
                            return (IntPtr)1;   // swallow both down and up on the send button
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

                    if (_fgIsAi)
                    {
                        // Reset the typed buffer when focus moves to a different
                        // process (single-writer: only this hook touches _typed).
                        if (_fgPid != _typedOwnerPid)
                        {
                            _typed.Length = 0; _typedOwnerPid = _fgPid;
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
                            bool block = _fgIsBlocked || TypedBlockFresh() || uiaBlock || clipBlock;
                            string pats = _fgIsBlocked ? _blockedReason
                                        : TypedBlockFresh() ? _typedPatterns
                                        : uiaBlock ? _uiaPatterns
                                        : _pastePatterns();
                            if (block)
                            {
                                if (ctrl && alt) { Emit("override", _app, pats, ""); }  // allow, logged
                                else { Emit("block", _app, pats, "send"); return (IntPtr)1; }  // swallow
                            }
                            else
                            {
                                // Clean send — reset the buffer for the next prompt.
                                _typed.Length = 0; _blockTyped = false; _typedPatterns = "";
                            }
                        }
                        else if (vk == VK_ESCAPE)
                        {
                            _typed.Length = 0; _blockTyped = false; _typedPatterns = "";
                        }
                        else if (vk == VK_BACK)
                        {
                            if (_typed.Length > 0) _typed.Length = _typed.Length - 1;
                            Rescan();
                        }
                        else if (!ctrl && !alt)
                        {
                            // Accumulate printable characters (ignore Ctrl/Alt combos
                            // like Ctrl+A/Ctrl+C so they don't pollute the buffer).
                            char c = MapKey(vk, shift, caps);
                            if (c != '\0')
                            {
                                if (_typed.Length > 4096) _typed.Remove(0, _typed.Length - 4096);
                                _typed.Append(c);
                                Rescan();
                            }
                        }
                    }
                }
            }
        }
        catch { }
        return CallNextHookEx(_hook, nCode, wParam, lParam);
    }

    static void Rescan()
    {
        string hits = ScanNames(_typed.ToString());
        _typedPatterns = hits;
        bool wasBlocked = _blockTyped;
        _blockTyped = hits.Length > 0;
        if (_blockTyped) _typedBlockTicks = DateTime.UtcNow.Ticks;
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
            try { UpdateForeground(); UpdateBlockedAgents(); UpdatePaste(); UpdateUia(); UpdateSendRect(); }
            catch { }
            Thread.Sleep(150);
        }
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
        if (fg == IntPtr.Zero) { _fgIsAi = false; return; }
        uint pid; GetWindowThreadProcessId(fg, out pid);
        string proc = ProcName(pid);
        _fgPid = pid;
        if (proc != null && _aiProcs.Contains(proc)) { _fgIsAi = true; _app = proc; }
        else { _fgIsAi = false; }
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
        if (!_fgIsAi || !BlockActiveForMouse()) { _hasRect = false; return; }
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

    static string ReadText(AutomationElement el)
    {
        try
        {
            object vp;
            if (el.TryGetCurrentPattern(ValuePattern.Pattern, out vp))
            {
                string v = ((ValuePattern)vp).Current.Value;
                if (!string.IsNullOrEmpty(v)) return v;
            }
        }
        catch { }
        try
        {
            object tp;
            if (el.TryGetCurrentPattern(TextPattern.Pattern, out tp))
            {
                string t = ((TextPattern)tp).DocumentRange.GetText(16000);
                if (!string.IsNullOrEmpty(t)) return t;
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
        foreach (var kv in _regexes)
        {
            try { if (kv.Value.IsMatch(text)) hits.Add(kv.Key); } catch { }
        }
        return string.Join(",", hits.ToArray());
    }

    static void Emit(string kind, string app, string patterns, string reason)
    {
        string json = "{\"kind\":\"" + kind + "\""
            + (reason.Length > 0 ? ",\"reason\":\"" + Esc(reason) + "\"" : "")
            + (app.Length > 0 ? ",\"process\":\"" + Esc(app) + "\"" : "")
            + (patterns.Length > 0 ? ",\"patterns\":\"" + Esc(patterns) + "\"" : "")
            + "}";
        lock (_emitLock) { Console.Out.WriteLine(json); Console.Out.Flush(); }
    }

    static string Esc(string s) { return s.Replace("\\", "\\\\").Replace("\"", "\\\""); }
}
'@

Add-Type -TypeDefinition $source -ReferencedAssemblies @(
    'System.Windows.Forms',
    'UIAutomationClient',
    'UIAutomationTypes',
    'WindowsBase'
) -ErrorAction Stop

[CfaiEnforcer]::Start(($aiProcs -split ','), $patNames.ToArray(), $patSources.ToArray())

# Keep the process alive — the C# background threads (poll + message pump) do
# the work and write events to stdout. Node reads them.
while ($true) { Start-Sleep -Seconds 3600 }

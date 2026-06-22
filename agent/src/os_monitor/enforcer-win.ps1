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

$aiProcs = if ($env:CFAI_AI_PROCESSES) { $env:CFAI_AI_PROCESSES } else { 'ChatGPT,Claude,Cursor,Copilot,Comet,Gemini,Poe' }
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

    // Did the user actually paste (Ctrl+V) into this prompt session?  Only
    // then do we include the clipboard check in the Enter decision.  Without
    // this gate, stale clipboard contents from hours ago false-block Enter in
    // apps like Cursor where the foreground process is always an AI surface.
    static volatile bool _pastedThisSession = false;

    static HashSet<string> _aiProcs;
    static List<KeyValuePair<string, Regex>> _regexes;
    static readonly object _emitLock = new object();

    public static void Start(string[] aiProcs, string[] patNames, string[] patSources)
    {
        try { SetProcessDPIAware(); } catch { }   // align UIA rect with hook screen coords
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
    // as a secondary signal since clicking a send button is a deliberate
    // action (lower false-positive cost than blocking every Enter).
    static bool BlockActiveForMouse() { return TypedBlockFresh() || _blockUia; }

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
                            _pastedThisSession = false;
                        }

                        // Track Ctrl+V — mark that a paste happened in this prompt
                        // session so we can include clipboard in the Enter check.
                        if (vk == VK_V && ctrl && !alt)
                        {
                            _pastedThisSession = true;
                        }

                        // Enter-to-send decision.
                        // Only block if the user actually TYPED a pattern (fresh)
                        // or PASTED one this session.  UIA is excluded — it reads
                        // from whatever element has focus, which in IDEs like
                        // Cursor can be code/terminal/AI-response text full of
                        // displayed patterns that have nothing to do with the
                        // current prompt.
                        if (vk == VK_RETURN && !shift)
                        {
                            bool clipBlock = _pastedThisSession && _blockPaste;
                            bool block = TypedBlockFresh() || clipBlock;
                            string pats = TypedBlockFresh() ? _typedPatterns
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
                                _pastedThisSession = false;
                            }
                        }
                        else if (vk == VK_ESCAPE)
                        {
                            _typed.Length = 0; _blockTyped = false; _typedPatterns = "";
                            _pastedThisSession = false;
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
            try { UpdateForeground(); UpdatePaste(); UpdateUia(); UpdateSendRect(); }
            catch { }
            Thread.Sleep(150);
        }
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

    // When a block is active, find the send button in the foreground AI window
    // and cache its screen rectangle so the mouse hook can swallow clicks on it.
    // Matches buttons whose Name/AutomationId/HelpText mentions send/submit
    // (Claude/ChatGPT expose the composer send control with an aria-label that
    // surfaces as the UIA Name). Cleared when no block is active so normal
    // clicks are never swallowed.
    static void UpdateSendRect()
    {
        if (!_fgIsAi || !BlockActiveForMouse()) { _hasRect = false; return; }
        try
        {
            IntPtr fg = GetForegroundWindow();
            if (fg == IntPtr.Zero) { _hasRect = false; return; }
            AutomationElement win = AutomationElement.FromHandle(fg);
            if (win == null) { _hasRect = false; return; }
            var cond = new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Button);
            AutomationElementCollection btns = win.FindAll(TreeScope.Descendants, cond);
            foreach (AutomationElement b in btns)
            {
                string name = "", aid = "", help = "";
                try { name = b.Current.Name ?? ""; } catch { }
                try { aid = b.Current.AutomationId ?? ""; } catch { }
                try { help = b.Current.HelpText ?? ""; } catch { }
                string hay = (name + " " + aid + " " + help).ToLowerInvariant();
                // Match send/submit buttons across AI apps: Cursor uses "ask"
                // or "chat", ChatGPT/Claude use "send message", Copilot uses
                // "submit". Also match generic arrow icons via common IDs.
                if (hay.Contains("send") || hay.Contains("submit")
                    || hay.Contains("ask ") || hay.Contains("ask\t") || hay == "ask"
                    || hay.Contains("chat") || hay.Contains("run ")
                    || hay.Contains("composer") || hay.Contains("generate"))
                {
                    try
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
                    catch { }
                }
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

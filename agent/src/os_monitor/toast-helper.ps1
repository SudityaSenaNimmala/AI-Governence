# Persistent toast helper for the OS monitor.
#
# Spawned once at startup by Node (os_monitor/notify.js). Stays alive for the
# lifetime of the agent. Reads JSON commands from stdin, one per line, and
# fires a Windows toast for each. Avoids the 500-1500ms cold-start penalty
# of spawning a fresh powershell.exe per notification.
#
# Also performs first-time AUMID registration in HKCU so toasts are
# attributed to "CloudFuze AI Governance" instead of "Windows PowerShell".
#
# Protocol: one JSON object per stdin line, e.g.
#   {"cmd":"show","title":"ChatGPT — CRITICAL","message":"Paste: us-ssn, openai-api-key"}
#   {"cmd":"ping"}
#   {"cmd":"show_request_dialog","request_id":"…","dedupe_key":"…","agent_name":"IT Help Desk Agent","app_name":"Microsoft Teams"}
#   {"cmd":"show_tokenize_dialog","request_id":"…","dedupe_key":"<block_id>","app_name":"Claude","categories":"us-ssn","preview":"my ssn is [SSN]"}
#   {"cmd":"shutdown"}
#
# …and one JSON object per stdout line back:
#   {"kind":"ready","aumid":"CloudFuze.AIGovernance"}
#   {"kind":"pong"}
#   {"kind":"scrubbed"}
#   {"kind":"access_request_result","request_id":"…","action":"submit","reason":"…"}
#   {"kind":"tokenize_dialog_editing","request_id":"…"}
#   {"kind":"tokenize_dialog_result","request_id":"…","action":"tokenize"|"edit"|"edit_send"|"timeout"|"suppressed"|"unavailable"}
#   {"kind":"tokenize_dialog_result","request_id":"…","action":"edit_send","text":"…"}
#
# THIS PROCESS HAS NO VISIBLE WINDOW. It is spawned windowsHide:true and owns no
# tray icon, no taskbar entry and no standing UI. The only exceptions are the two
# ephemeral dialogs below, each of which exists for the length of a single blocked
# send-attempt and closes when the user answers it — see Show-CFAIRequestDialog
# and Show-CFAITokenizeDialog.

[Console]::InputEncoding  = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$ErrorActionPreference = 'Stop'
$ProgressPreference    = 'SilentlyContinue'
$WarningPreference     = 'SilentlyContinue'

# ---- AUMID registration (one-time, HKCU, no admin needed) ----
$Aumid       = 'CloudFuze.AIGovernance'
$DisplayName = 'CloudFuze AI Governance'

try {
    $key = "HKCU:\Software\Classes\AppUserModelId\$Aumid"
    if (-not (Test-Path $key)) {
        New-Item -Path $key -Force | Out-Null
    }
    Set-ItemProperty -Path $key -Name 'DisplayName' -Value $DisplayName -Type String
    # Use a warning-style background color so toasts visually code as security.
    Set-ItemProperty -Path $key -Name 'IconBackgroundColor' -Value 'FFB22222' -Type String -ErrorAction SilentlyContinue
} catch {
    # Non-fatal — toast still fires, just with default attribution.
    [Console]::Error.WriteLine("aumid-register-failed: $($_.Exception.Message)")
}

# ---- Load WinRT once ----
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType=WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType=WindowsRuntime] | Out-Null
Add-Type -AssemblyName System.Windows.Forms                # for narrow clipboard-scrub path + the Request Access dialog
Add-Type -AssemblyName System.Drawing

# ── Request Access dialog (C#, its own STA thread) ──────────────────────────
#
# WHY C# AND NOT A POWERSHELL SCRIPTBLOCK. The main thread of this process sits
# blocked in [Console]::In.ReadLine() for the agent's whole lifetime, and it must
# STAY there: a toast queued while a dialog is open has to fire immediately, not
# after the user finishes typing. So the dialog cannot be a ShowDialog() on this
# thread. It needs a real second thread with its own STA apartment and its own
# message loop, and running a PowerShell scriptblock on a bare
# System.Threading.Thread means running it against this thread's runspace, which
# is not thread-safe. A compiled type owns the thread instead — the same
# arrangement enforcer-win.ps1 already uses for everything that must not run on
# the poll thread.
#
# STDOUT IS SHARED, so there is exactly ONE writer path: CfaiRequestDialog.Write.
# Both the dialog thread and the main loop below go through it, under one lock,
# so a result line can never interleave with a {"kind":"pong"} or land inside a
# toast acknowledgement.
#
# PII: the dialog is handed an agent name and an app name (both admin-typed
# blocklist values relayed by the enforcer) and it sends back only what the user
# typed into the reason box. It reads nothing from the screen, the clipboard or
# any other process, and it never sees prompt text.
$dialogSource = @'
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Text;
using System.Threading;
using System.Windows.Forms;

// ── The look ────────────────────────────────────────────────────────────────
//
// These are the DASHBOARD's colours (connect-ui), not invented ones, so the
// prompt a user gets on their desktop reads as the same product as the console
// their admin answers it in. Kept as one palette because two dialogs draw from
// it and a second copy would drift.
public static class CfaiTheme
{
    public static readonly Color Accent      = ColorTranslator.FromHtml("#0052e0");
    public static readonly Color AccentHover = ColorTranslator.FromHtml("#0041b3");
    public static readonly Color AccentSoft  = ColorTranslator.FromHtml("#eef3ff");
    public static readonly Color Ink         = ColorTranslator.FromHtml("#1f2129");
    public static readonly Color Muted       = ColorTranslator.FromHtml("#64748b");
    public static readonly Color Line        = ColorTranslator.FromHtml("#e2e8f0");
    public static readonly Color Surface     = Color.White;
    public static readonly Color SurfaceSoft = ColorTranslator.FromHtml("#f8fafc");
    // The alert/tokenize family, matching the browser extension's own modal so
    // the desktop popup and the in-page one read as the same product.
    public static readonly Color AlertSoft   = ColorTranslator.FromHtml("#fde8e8");
    public static readonly Color AlertInk    = ColorTranslator.FromHtml("#c5303a");
    public static readonly Color Warn        = ColorTranslator.FromHtml("#f5a623");
    public static readonly Color SafeSoft    = ColorTranslator.FromHtml("#f0fdf4");
    public static readonly Color SafeLine    = ColorTranslator.FromHtml("#bbf7d0");
    public static readonly Color SafeInk     = ColorTranslator.FromHtml("#15803d");
    public static readonly Color Go          = ColorTranslator.FromHtml("#0f9d58");
    public static readonly Color GoHover     = ColorTranslator.FromHtml("#0c7f47");
    public static readonly Color Alt         = ColorTranslator.FromHtml("#4f46e5");
    public static readonly Color AltHover    = ColorTranslator.FromHtml("#4338ca");

    // Monospace for the masked preview: the whole point of that box is that the
    // user can read a label like [API-KEY] exactly as it will be sent.
    public static Font Mono(float size, FontStyle style)
    {
        try { return new Font("Consolas", size, style); }
        catch { return new Font(FontFamily.GenericMonospace, size, style); }
    }

    // Segoe UI is present on every supported Windows; the fallback keeps a
    // missing-font machine legible rather than throwing.
    public static Font Ui(float size, FontStyle style)
    {
        try { return new Font("Segoe UI", size, style); }
        catch { return new Font(SystemFonts.MessageBoxFont.FontFamily, size, style); }
    }
}

// A flat button that owns its own paint, because the stock WinForms button is
// the single thing that makes a dialog look twenty years old. Two variants:
// PRIMARY (filled accent) and SECONDARY (quiet outline).
public class CfaiButton : Button
{
    public bool Primary = false;
    // When set, these win over Primary. Two filled buttons of DIFFERENT colours
    // sit side by side in the tokenize popup, so "primary or not" is not enough
    // to describe them.
    public Color Fill = Color.Empty;
    public Color FillHover = Color.Empty;
    bool _hover = false;

    public CfaiButton()
    {
        SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.UserPaint
               | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
        FlatStyle = FlatStyle.Flat;
        FlatAppearance.BorderSize = 0;
        BackColor = Color.Transparent;
        Cursor = Cursors.Hand;
        Font = CfaiTheme.Ui(9.75f, FontStyle.Regular);
        MouseEnter += delegate(object s, EventArgs e) { _hover = true; Invalidate(); };
        MouseLeave += delegate(object s, EventArgs e) { _hover = false; Invalidate(); };
        EnabledChanged += delegate(object s, EventArgs e) { Invalidate(); };
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        Graphics g = e.Graphics;
        g.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
        Rectangle r = new Rectangle(0, 0, Width - 1, Height - 1);
        using (System.Drawing.Drawing2D.GraphicsPath path = CfaiDraw.Rounded(r, 6))
        {
            Color fill, text;
            if (Fill != Color.Empty)
            {
                fill = Enabled ? (_hover && FillHover != Color.Empty ? FillHover : Fill)
                               : ControlPaint.Light(Fill, 0.55f);
                text = Color.White;
                using (SolidBrush b = new SolidBrush(fill)) g.FillPath(b, path);
            }
            else if (Primary)
            {
                // A disabled primary button must still read as the primary
                // action, just unavailable -- greying it to the secondary's
                // colours would hide where the user is meant to go.
                if (!Enabled) { fill = ColorTranslator.FromHtml("#b9ccf5"); text = Color.White; }
                else { fill = _hover ? CfaiTheme.AccentHover : CfaiTheme.Accent; text = Color.White; }
                using (SolidBrush b = new SolidBrush(fill)) g.FillPath(b, path);
            }
            else
            {
                fill = _hover ? CfaiTheme.SurfaceSoft : CfaiTheme.Surface;
                text = Enabled ? CfaiTheme.Ink : CfaiTheme.Muted;
                using (SolidBrush b = new SolidBrush(fill)) g.FillPath(b, path);
                using (Pen pen = new Pen(CfaiTheme.Line)) g.DrawPath(pen, path);
            }
            TextRenderer.DrawText(g, Text, Font, r, text,
                TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter
                | TextFormatFlags.EndEllipsis | TextFormatFlags.NoPrefix);
        }
    }
}

// Rounded-rectangle geometry, shared by the button and the card.
// A filled circle with a glyph in it — the alert mark at the top of the card.
// Painted rather than an image so it scales with DPI and ships no assets.
public class CfaiBadge : Control
{
    public Color Fill = Color.White;
    public Color Glyph = Color.Black;
    public string Mark = "!";
    public float MarkSize = 22f;
    // Draw a "no entry" ring-and-slash instead of a text glyph. The natural
    // character for this is U+1F6AB, which is ASTRAL -- C# \u takes exactly four
    // hex digits, so it cannot be written as a single escape, and the four-digit
    // truncation is what turned an earlier badge into mojibake. Painting it
    // sidesteps both that and any question of font coverage.
    public bool Ban = false;

    public CfaiBadge()
    {
        SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.UserPaint
               | ControlStyles.OptimizedDoubleBuffer | ControlStyles.SupportsTransparentBackColor, true);
        BackColor = Color.Transparent;
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        Graphics g = e.Graphics;
        g.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
        using (SolidBrush b = new SolidBrush(Fill)) g.FillEllipse(b, 0, 0, Width - 1, Height - 1);
        if (Ban)
        {
            // A ring with a diagonal bar, inset from the pastel disc.
            float inset = Width * 0.28f;
            float d = Width - inset * 2;
            using (Pen pen = new Pen(Glyph, Math.Max(2f, Width * 0.055f)))
            {
                g.DrawEllipse(pen, inset, inset, d, d);
                double a = Math.PI / 4;   // 45 degrees
                float r = d / 2f, cx = Width / 2f, cy = Height / 2f;
                g.DrawLine(pen,
                    cx - (float)(r * Math.Cos(a)), cy + (float)(r * Math.Sin(a)),
                    cx + (float)(r * Math.Cos(a)), cy - (float)(r * Math.Sin(a)));
            }
            return;
        }
        using (Font f = CfaiTheme.Ui(MarkSize, FontStyle.Bold))
            TextRenderer.DrawText(g, Mark, f, new Rectangle(0, 0, Width, Height), Glyph,
                TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPrefix);
    }
}

// The category chip: a rounded pill, one per detected pattern name.
public class CfaiPill : Control
{
    public Color Fill = Color.White;
    public Color Ink = Color.Black;

    public CfaiPill()
    {
        SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.UserPaint
               | ControlStyles.OptimizedDoubleBuffer | ControlStyles.SupportsTransparentBackColor, true);
        BackColor = Color.Transparent;
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        Graphics g = e.Graphics;
        g.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
        Rectangle r = new Rectangle(0, 0, Width - 1, Height - 1);
        using (System.Drawing.Drawing2D.GraphicsPath path = CfaiDraw.Rounded(r, Height / 2))
        using (SolidBrush b = new SolidBrush(Fill)) g.FillPath(b, path);
        TextRenderer.DrawText(g, Text, Font, r, Ink,
            TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter
            | TextFormatFlags.EndEllipsis | TextFormatFlags.NoPrefix);
    }
}

// A rounded, tinted, bordered box — the "this is what gets sent" panel.
public class CfaiRoundPanel : Panel
{
    public Color Line = Color.Gainsboro;
    public int Radius = 8;

    public CfaiRoundPanel()
    {
        SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.UserPaint
               | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        Graphics g = e.Graphics;
        g.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
        g.Clear(Parent != null ? Parent.BackColor : CfaiTheme.Surface);
        Rectangle r = new Rectangle(0, 0, Width - 1, Height - 1);
        using (System.Drawing.Drawing2D.GraphicsPath path = CfaiDraw.Rounded(r, Radius))
        {
            using (SolidBrush b = new SolidBrush(BackColor)) g.FillPath(b, path);
            using (Pen pen = new Pen(Line)) g.DrawPath(pen, path);
        }
    }
}

public static class CfaiDraw
{
    public static System.Drawing.Drawing2D.GraphicsPath Rounded(Rectangle r, int radius)
    {
        var p = new System.Drawing.Drawing2D.GraphicsPath();
        int d = radius * 2;
        if (d <= 0 || r.Width <= d || r.Height <= d) { p.AddRectangle(r); return p; }
        p.AddArc(r.X, r.Y, d, d, 180, 90);
        p.AddArc(r.Right - d, r.Y, d, d, 270, 90);
        p.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
        p.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
        p.CloseFigure();
        return p;
    }
}

// ── The Request Access dialog's window ──────────────────────────────────────
// WS_EX_TOPMOST comes from CreateParams for exactly the reason CfaiNoActivateForm
// (further down) already sets it there: this process never owns the foreground,
// so WinForms' Form.TopMost is not reliably applied to the live window when the
// form is shown from a background STA thread. A dialog that loses that race sits
// BEHIND the browser, and with no taskbar button it is invisible — the user
// presses send, is blocked, and sees nothing. Observed in the field: exstyle on
// the live handle came back 0x10101, i.e. without WS_EX_TOPMOST, even though
// form.TopMost had been set to true.
//
// WS_EX_TOOLWINDOW keeps it out of the taskbar and Alt-Tab, which is what
// ShowInTaskbar=false was asking for anyway.
//
// It deliberately does NOT set WS_EX_NOACTIVATE: unlike the tokenize popup's
// first view, this dialog is a text box the user has to type a reason into.
public class CfaiTopForm : Form
{
    [System.Runtime.InteropServices.DllImport("dwmapi.dll")]
    static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int val, int size);
    [System.Runtime.InteropServices.DllImport("user32.dll")]
    static extern bool ReleaseCapture();
    [System.Runtime.InteropServices.DllImport("user32.dll")]
    static extern IntPtr SendMessage(IntPtr hWnd, int msg, IntPtr wp, IntPtr lp);

    protected override CreateParams CreateParams
    {
        get
        {
            CreateParams cp = base.CreateParams;
            cp.ExStyle |= 0x8 /* WS_EX_TOPMOST */ | 0x80 /* WS_EX_TOOLWINDOW */;
            return cp;
        }
    }

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        // Windows 11 rounds the corners for us when asked; on Windows 10 the
        // call simply fails and the card stays square, which is the correct
        // fallback -- a hand-clipped Region there costs anti-aliasing on every
        // resize and looks worse than square.
        try { int pref = 2 /* DWMWCP_ROUND */; DwmSetWindowAttribute(Handle, 33, ref pref, 4); } catch { }
    }

    // A borderless window has no title bar to drag, so the header does it. This
    // is the standard ReleaseCapture + WM_NCLBUTTONDOWN(HTCAPTION) handoff: the
    // window manager takes over the drag, so there is no mouse-move bookkeeping
    // here and the drag behaves exactly like a real title bar.
    public void DragBy(Control handle)
    {
        handle.MouseDown += delegate(object s, MouseEventArgs e)
        {
            if (e.Button != MouseButtons.Left) return;
            try { ReleaseCapture(); SendMessage(Handle, 0xA1 /* WM_NCLBUTTONDOWN */, (IntPtr)2 /* HTCAPTION */, IntPtr.Zero); } catch { }
        };
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        base.OnPaint(e);
        // A 1px hairline so the card separates from whatever is behind it. It is
        // drawn rather than borrowed from FormBorderStyle because the form is
        // borderless -- that is what removes the grey 1990s chrome.
        using (Pen pen = new Pen(CfaiTheme.Line))
            e.Graphics.DrawRectangle(pen, 0, 0, Width - 1, Height - 1);
    }
}

public static class CfaiRequestDialog
{
    // Mirrors REASON_MAX in server/src/routes/access-requests.js — the server
    // truncates past this, so the box refuses past it and the user can see that
    // happen instead of silently losing the end of a sentence.
    public const int ReasonMax = 500;

    // Mirrors REQUEST_DIALOG_TIMEOUT_MS in notify.js. The window closes itself on
    // the same schedule Node gives up on, so a dialog can never outlive its
    // caller and hold its dedupe key open against every future block.
    public const int TimeoutMs = 5 * 60 * 1000;

    // How often the dismissal guard asks whether this dialog's moment has
    // passed. Fast enough that the window is gone before the user has finished
    // clicking away, slow enough to be free.
    public const int GuardIntervalMs = 400;

    static readonly object OutLock = new object();
    // dedupe_key -> open. ONE DIALOG AT A TIME per block, and this is the only
    // duplicate guard in the whole path: the enforcer offers on every blocked
    // send (no per-session latch), so without this, holding Enter down would
    // stack a window per keystroke. The key is released the moment the form
    // closes, so the very next blocked send opens a fresh dialog — which is the
    // point, for a user who was declined or who cancelled.
    // The value is the LIVE WINDOW HANDLE (IntPtr.Zero until the form is shown),
    // so a second blocked send can pull the window that is already up back to the
    // front instead of being answered with silence.
    static readonly Dictionary<string, IntPtr> Open = new Dictionary<string, IntPtr>(StringComparer.OrdinalIgnoreCase);

    [System.Runtime.InteropServices.DllImport("user32.dll")]
    static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndAfter, int x, int y, int cx, int cy, uint flags);
    [System.Runtime.InteropServices.DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();
    [System.Runtime.InteropServices.DllImport("user32.dll")]
    public static extern bool IsWindow(IntPtr hWnd);
    [System.Runtime.InteropServices.DllImport("user32.dll")]
    static extern bool SetForegroundWindow(IntPtr hWnd);
    [System.Runtime.InteropServices.DllImport("user32.dll")]
    static extern bool BringWindowToTop(IntPtr hWnd);
    [System.Runtime.InteropServices.DllImport("user32.dll")]
    static extern uint GetWindowThreadProcessId(IntPtr hWnd, IntPtr pid);
    [System.Runtime.InteropServices.DllImport("user32.dll")]
    static extern bool AttachThreadInput(uint attach, uint attachTo, bool fAttach);
    [System.Runtime.InteropServices.DllImport("kernel32.dll")]
    static extern uint GetCurrentThreadId();
    static readonly IntPtr HWND_TOPMOST = new IntPtr(-1);
    const uint SWP_NOSIZE = 0x1, SWP_NOMOVE = 0x2, SWP_NOACTIVATE = 0x10, SWP_SHOWWINDOW = 0x40;

    // Re-assert topmost on a LIVE handle. CreateParams covers the moment the
    // window is created; this covers every moment after it, and it is also the
    // only thing that can help a window the browser has since covered. It never
    // takes the foreground (SWP_NOACTIVATE), so it cannot disturb the composer
    // the enforcer pinned at block time. Both dialogs use it.
    public static void ForceOnTop(IntPtr hWnd)
    {
        if (hWnd == IntPtr.Zero) return;
        try { SetWindowPos(hWnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW); } catch { }
    }

    // A duplicate request for a dialog that is already up: nothing new is
    // opened, the existing window is raised. SHARED WITH THE TOKENIZE POPUP, so
    // it must never focus or activate — that popup's entire contract is that it
    // does not hold the foreground, because the enforcer re-checks
    // GetForegroundWindow() against the window it pinned at block time before it
    // types the rewrite. CfaiRequestDialog adds TakeForeground() on top of this
    // for its own window only.
    //
    // It also does NOT flash. FlashWindow(h, true) inverts the caption and
    // leaves it inverted; on a window that is raised repeatedly that reads as a
    // blinking dialog, which is what it was reported as.
    public static void Resurface(IntPtr hWnd)
    {
        if (hWnd == IntPtr.Zero) return;
        ForceOnTop(hWnd);
    }

    // ── Taking the foreground, and why this dialog is allowed to ─────────────
    //
    // ONLY CfaiRequestDialog calls this. Its reason box is a text box the user
    // has to type a sentence into, and a window that does not hold the
    // foreground DOES NOT RECEIVE KEYBOARD INPUT — the keystrokes go to whatever
    // does, which is the AI composer the block just came from. That is exactly
    // what was reported: the dialog was up and the typing landed in ChatGPT.
    //
    // form.Activate() alone cannot fix it. Windows refuses SetForegroundWindow
    // to a process that does not own the foreground or the last input event, and
    // this process owns neither: the block was triggered by the user's keypress
    // in the BROWSER. The documented way through is to attach our input queue to
    // the foreground thread for the duration of the call, which makes the two
    // threads share a foreground state, and detach immediately after.
    //
    // This is safe here in a way it would NOT be for the tokenize popup: this
    // dialog never types into a composer, so nothing downstream re-checks the
    // foreground against a pinned window. It submits to the server and closes.
    public static void TakeForeground(IntPtr hWnd)
    {
        if (hWnd == IntPtr.Zero) return;
        uint us = GetCurrentThreadId();
        uint fgThread = 0;
        bool attached = false;
        try
        {
            IntPtr fg = GetForegroundWindow();
            if (fg != IntPtr.Zero) fgThread = GetWindowThreadProcessId(fg, IntPtr.Zero);
            if (fgThread != 0 && fgThread != us) attached = AttachThreadInput(fgThread, us, true);
            try { BringWindowToTop(hWnd); } catch { }
            SetForegroundWindow(hWnd);
        }
        catch { }
        finally
        {
            // Detaching is not optional: a leaked attachment ties this process's
            // input queue to another app's thread, so that app stalls whenever
            // we do.
            if (attached) { try { AttachThreadInput(fgThread, us, false); } catch { } }
        }
    }

    // The single stdout writer for this whole process.
    public static void Write(string line)
    {
        lock (OutLock)
        {
            Console.Out.WriteLine(line);
            Console.Out.Flush();
        }
    }

    // public: CfaiTokenizeDialog escapes through this one implementation too, so
    // the two dialogs can never disagree about what makes a value safe to put on
    // an NDJSON line.
    public static string Esc(string s)
    {
        if (s == null) return "";
        StringBuilder sb = new StringBuilder(s.Length + 8);
        foreach (char c in s)
        {
            if (c == '\\') sb.Append("\\\\");
            else if (c == '"') sb.Append("\\\"");
            else if (c == '\n') sb.Append("\\n");
            else if (c == '\r') sb.Append("\\r");
            else if (c == '\t') sb.Append("\\t");
            // Every other control character (and DEL) becomes a space: the
            // server's own clean() strips them, and an unescaped one here would
            // make the line unparseable JSON for Node.
            else if (c < ' ' || c == '\u007f') sb.Append(' ');
            else sb.Append(c);
        }
        return sb.ToString();
    }

    // Returns false when a dialog for this dedupe key is already on screen.
    public static bool Show(string requestId, string dedupeKey, string agentName, string appName)
    {
        string key = string.IsNullOrEmpty(dedupeKey) ? requestId : dedupeKey;
        IntPtr existing = IntPtr.Zero;
        bool dup = false;
        lock (Open)
        {
            if (Open.TryGetValue(key, out existing)) dup = true;
            else Open[key] = IntPtr.Zero;
        }
        if (dup) { Resurface(existing); TakeForeground(existing); return false; }
        // THE WINDOW THIS DIALOG IS ABOUT. Captured here, on the stdin thread, at
        // the moment the command arrives — i.e. whatever the user is actually
        // looking at when the dialog is about to appear over it. The guard timer
        // in Run() closes the dialog when this window is destroyed, which is what
        // stops a closed browser from leaving an orphaned prompt on screen.
        //
        // Deliberately read HERE rather than plumbed from the enforcer's block:
        // index.js awaits a server round-trip between the block and this command,
        // so the block-time window may no longer be the one on screen, and a
        // dialog should belong to the window it actually appears over.
        IntPtr owner = IntPtr.Zero;
        try { owner = GetForegroundWindow(); } catch { }
        Thread t = new Thread(delegate() { Run(requestId, key, agentName, appName, owner); });
        t.SetApartmentState(ApartmentState.STA);
        // Background: a dialog left open must never keep this process — or the
        // agent's shutdown — waiting.
        t.IsBackground = true;
        t.Name = "cfai-request-dialog";
        t.Start();
        return true;
    }

    static void Run(string requestId, string key, string agentName, string appName, IntPtr owner)
    {
        string action = "cancel";
        string reason = "";
        try
        {
            string subject = string.IsNullOrEmpty(agentName) ? appName : agentName;
            if (!string.IsNullOrEmpty(agentName) && !string.IsNullOrEmpty(appName)
                && !string.Equals(agentName, appName, StringComparison.OrdinalIgnoreCase))
            {
                // The em dash is a \u escape, not a literal: this .ps1 has no BOM,
                // so PowerShell 5.1 reads it in the system ANSI codepage and a
                // literal em dash would reach the label as mojibake.
                subject = agentName + " \u2014 " + appName;
            }

            const int CardW = 520;
            const int Pad = 32;

            CfaiTopForm form = new CfaiTopForm();
            form.Text = "CloudFuze AI Governance";
            // BORDERLESS: the grey system title bar is most of what made this
            // look dated. The window is still a real top-level window, so the
            // topmost style, the no-taskbar rule, Esc-to-cancel and taking the
            // foreground are all unaffected.
            form.FormBorderStyle = FormBorderStyle.None;
            form.StartPosition = FormStartPosition.CenterScreen;
            form.MinimizeBox = false;
            form.MaximizeBox = false;
            // NO TASKBAR ENTRY. This process must never look like an app that is
            // running; the dialog is a momentary prompt, not a window the user
            // owns or can go back to.
            form.ShowInTaskbar = false;
            form.TopMost = true;
            form.BackColor = CfaiTheme.Surface;
            form.Font = CfaiTheme.Ui(9.75f, FontStyle.Regular);
            form.ClientSize = new Size(CardW, 524);

            // The blocked thing's own name, for the title and the chip. `subject`
            // already folds agent-vs-app naming; this is the SHORT form for
            // places where a sentence would not fit.
            string shortName = string.IsNullOrEmpty(agentName) ? appName : agentName;
            if (string.IsNullOrEmpty(shortName)) shortName = "This AI app";

            CfaiBadge badge = new CfaiBadge();
            badge.SetBounds((CardW - 72) / 2, Pad, 72, 72);
            badge.Fill = CfaiTheme.AlertSoft;
            badge.Glyph = CfaiTheme.AlertInk;
            badge.Ban = true;
            // The header is also the drag handle: a borderless window has no
            // title bar, so something has to move it.
            form.DragBy(badge);

            Label head = new Label();
            head.Text = shortName + " is blocked";
            head.Font = CfaiTheme.Ui(15f, FontStyle.Bold);
            head.ForeColor = CfaiTheme.Ink;
            head.TextAlign = ContentAlignment.MiddleCenter;
            head.AutoEllipsis = true;
            head.SetBounds(Pad, 112, CardW - Pad * 2, 30);
            form.DragBy(head);

            Label body = new Label();
            body.Text = "Your organization has disallowed this AI app on this device. "
                      + "Nothing you type here can be sent.";
            body.ForeColor = CfaiTheme.Muted;
            body.Font = CfaiTheme.Ui(10f, FontStyle.Regular);
            body.TextAlign = ContentAlignment.TopCenter;
            body.SetBounds(Pad, 148, CardW - Pad * 2, 44);
            form.DragBy(body);

            CfaiPill pill = new CfaiPill();
            pill.Text = shortName;
            pill.Font = CfaiTheme.Ui(9f, FontStyle.Bold);
            pill.Fill = CfaiTheme.AlertSoft;
            pill.Ink = CfaiTheme.AlertInk;
            int pillW;
            using (Graphics mg = form.CreateGraphics())
                pillW = Math.Min(TextRenderer.MeasureText(mg, pill.Text, pill.Font).Width + 28, CardW - Pad * 2);
            pill.SetBounds((CardW - pillW) / 2, 200, pillW, 28);

            Label boxLabel = new Label();
            // OPTIONAL, and it means it: the server requires only machine_id and
            // tool_host, so a request with no reason is a valid request. Saying
            // "optional" while disabling the button until something is typed
            // would be the dialog lying about its own rule.
            boxLabel.Text = "WHY DO YOU NEED ACCESS? (OPTIONAL)";
            boxLabel.Font = CfaiTheme.Ui(8.25f, FontStyle.Bold);
            boxLabel.ForeColor = CfaiTheme.Muted;
            boxLabel.SetBounds(Pad, 244, CardW - Pad * 2, 16);

            Panel boxFrame = new Panel();
            boxFrame.SetBounds(Pad, 264, CardW - Pad * 2, 104);
            boxFrame.BackColor = CfaiTheme.Line;
            boxFrame.Padding = new Padding(1);

            Panel boxPad = new Panel();
            boxPad.Dock = DockStyle.Fill;
            boxPad.BackColor = CfaiTheme.SurfaceSoft;
            boxPad.Padding = new Padding(10, 9, 5, 9);

            TextBox box = new TextBox();
            box.Multiline = true;
            box.ScrollBars = ScrollBars.Vertical;
            box.MaxLength = ReasonMax;
            box.BorderStyle = BorderStyle.None;
            box.Dock = DockStyle.Fill;
            box.BackColor = CfaiTheme.SurfaceSoft;
            box.ForeColor = CfaiTheme.Ink;
            box.Font = CfaiTheme.Ui(9.75f, FontStyle.Regular);

            // A cue banner (EM_SETCUEBANNER) does not work on a MULTILINE text
            // box, so the placeholder is a label drawn over the box and hidden
            // the moment there is real text. It stays visible while focused and
            // empty, which is what makes it read as guidance rather than as a
            // value someone typed.
            Label hintText = new Label();
            hintText.Text = "e.g. Drafting the customer migration runbook \u2014 no customer data involved.";
            hintText.Font = CfaiTheme.Ui(9.75f, FontStyle.Regular);
            hintText.ForeColor = ColorTranslator.FromHtml("#94a3b8");
            hintText.BackColor = Color.Transparent;
            hintText.SetBounds(12, 10, boxFrame.Width - 26, 40);
            // Clicking the placeholder must put the caret where it looks like it
            // will go -- the label is on top, so the box never sees the click.
            hintText.Click += delegate(object s, EventArgs e) { try { box.Focus(); } catch { } };

            boxPad.Controls.Add(hintText);
            boxPad.Controls.Add(box);
            hintText.BringToFront();
            boxFrame.Controls.Add(boxPad);
            box.GotFocus += delegate(object s, EventArgs e) { boxFrame.BackColor = CfaiTheme.Accent; };
            box.LostFocus += delegate(object s, EventArgs e) { boxFrame.BackColor = CfaiTheme.Line; };

            Label count = new Label();
            count.SetBounds(CardW - Pad - 200, 374, 200, 16);
            count.ForeColor = CfaiTheme.Muted;
            count.Font = CfaiTheme.Ui(8.25f, FontStyle.Regular);
            count.TextAlign = ContentAlignment.MiddleRight;
            count.Text = "0 / " + ReasonMax;

            int btnGap = 12, submitW = 184, laterW = 128;
            int btnX = (CardW - (submitW + laterW + btnGap)) / 2;

            CfaiButton submit = new CfaiButton();
            submit.Text = "Request access";
            submit.Font = CfaiTheme.Ui(10f, FontStyle.Bold);
            submit.Fill = CfaiTheme.Go;
            submit.FillHover = CfaiTheme.GoHover;
            submit.SetBounds(btnX, 404, submitW, 44);

            CfaiButton cancel = new CfaiButton();
            cancel.Text = "Not now";
            cancel.Font = CfaiTheme.Ui(10f, FontStyle.Bold);
            cancel.Fill = CfaiTheme.Alt;
            cancel.FillHover = CfaiTheme.AltHover;
            cancel.SetBounds(btnX + submitW + btnGap, 404, laterW, 44);

            Label foot = new Label();
            foot.Text = "Your administrator decides, and any access they grant expires automatically.";
            foot.ForeColor = CfaiTheme.Muted;
            foot.Font = CfaiTheme.Ui(8.5f, FontStyle.Regular);
            foot.TextAlign = ContentAlignment.TopCenter;
            foot.SetBounds(Pad, 462, CardW - Pad * 2, 34);

            box.TextChanged += delegate(object s, EventArgs e)
            {
                count.Text = box.Text.Length + " / " + ReasonMax;
                hintText.Visible = box.Text.Length == 0;
            };
            submit.Click += delegate(object s, EventArgs e)
            {
                action = "submit";
                reason = box.Text.Trim();
                if (reason.Length > ReasonMax) reason = reason.Substring(0, ReasonMax);
                form.Close();
            };
            cancel.Click += delegate(object s, EventArgs e) { form.Close(); };
            // Esc cancels; Enter does not submit, because the reason box is
            // multi-line and owns that key.
            form.CancelButton = cancel;
            form.Shown += delegate(object s, EventArgs e)
            {
                // Publish the live handle so a second blocked send raises THIS
                // window rather than being silently suppressed.
                try { lock (Open) { Open[key] = form.Handle; } } catch { }
                ForceOnTop(form.Handle);
                // Then TAKE the foreground, because form.Activate() cannot from a
                // process that owns neither the foreground nor the last input
                // event — see TakeForeground. Without it the reason box gets no
                // keystrokes and the user's typing lands in the AI composer.
                TakeForeground(form.Handle);
                try { form.Activate(); box.Focus(); } catch { }
            };

            form.Controls.Add(badge);
            form.Controls.Add(head);
            form.Controls.Add(body);
            form.Controls.Add(pill);
            form.Controls.Add(boxLabel);
            form.Controls.Add(boxFrame);
            form.Controls.Add(count);
            form.Controls.Add(foot);
            form.Controls.Add(cancel);
            form.Controls.Add(submit);

            // ── The window's own clock ──────────────────────────────────────
            // Without this a dialog nobody answers stays on screen FOREVER, and
            // its dedupe key is only released when the form closes — so every
            // later block for the same host resolves to "suppressed" and the
            // user can never get a fresh dialog again. notify.js abandons its
            // side at REQUEST_DIALOG_TIMEOUT_MS; this closes the window on the
            // same schedule so the two cannot disagree. Matches the tokenize
            // popup, which has had a self-close from the start.
            // ── The dismissal guard ─────────────────────────────────────────
            // This dialog is a MOMENTARY PROMPT about one blocked send, not a
            // window the user owns. Two ways that moment ends, and both were
            // reported as bugs when neither was handled:
            //
            //   * the window it is about goes away  — "I closed the browser and
            //     the dialog was still there".
            //   * the user moves on                 — "if we go to another tab
            //     the dialog must be disabled". Switching tab, switching window
            //     and switching app are all the same event from here: THIS
            //     WINDOW STOPS BEING THE FOREGROUND ONE. Keying on that rather
            //     than on the tab/host is what makes the rule generic — the
            //     helper needs to know nothing about browsers or sites, and the
            //     next blocked send simply opens a fresh dialog.
            //
            // The foreground rule ARMS ONLY ONCE WE HAVE HELD THE FOREGROUND. If
            // TakeForeground lost its race the dialog never becomes foreground,
            // and an unarmed rule would then close it instantly — turning a
            // recoverable focus failure into no dialog at all. Until it arms,
            // the owner check and the timeout below still apply.
            bool[] wasForeground = new bool[1];
            System.Windows.Forms.Timer guard = new System.Windows.Forms.Timer();
            guard.Interval = GuardIntervalMs;
            guard.Tick += delegate(object s5, EventArgs e5)
            {
                try
                {
                    if (owner != IntPtr.Zero && !IsWindow(owner)) { guard.Stop(); form.Close(); return; }
                    IntPtr fg = GetForegroundWindow();
                    if (fg == form.Handle) { wasForeground[0] = true; return; }
                    if (wasForeground[0]) { guard.Stop(); form.Close(); }
                }
                catch { }
            };
            guard.Start();

            System.Windows.Forms.Timer life = new System.Windows.Forms.Timer();
            life.Interval = TimeoutMs;
            life.Tick += delegate(object s3, EventArgs e3) { life.Stop(); form.Close(); };
            life.Start();
            form.FormClosed += delegate(object s4, FormClosedEventArgs e4)
            {
                try { life.Stop(); life.Dispose(); } catch { }
                try { guard.Stop(); guard.Dispose(); } catch { }
            };

            // The message loop for THIS thread only. The main thread stays in
            // its stdin read the whole time this is up.
            Application.Run(form);
            form.Dispose();
        }
        catch (Exception ex)
        {
            action = "error";
            Console.Error.WriteLine("request-dialog-failed: " + ex.Message);
        }
        finally
        {
            lock (Open) { Open.Remove(key); }
        }

        Write("{\"kind\":\"access_request_result\""
            + ",\"request_id\":\"" + Esc(requestId) + "\""
            + ",\"action\":\"" + Esc(action) + "\""
            + (action == "submit" ? ",\"reason\":\"" + Esc(reason) + "\"" : "")
            + "}");
    }
}

// A form that NEVER takes the foreground. WS_EX_NOACTIVATE plus
// ShowWithoutActivation is the WinForms equivalent of the Electron popup's
// focusable:false + showInactive(), and it is a HARD REQUIREMENT of Tokenize &
// Send, not a politeness: the enforcer re-verifies GetForegroundWindow() against
// the window it pinned at block time before it types anything (see RunRewrite's
// "focus_changed" abort), and it drops a pending rewrite a few seconds after
// focus leaves the AI app. A dialog that stole focus would therefore guarantee
// that clicking its own primary button does nothing.
//
// Buttons still work: a WS_EX_NOACTIVATE window receives mouse input normally.
// What it does NOT get is keyboard input — which is why the tokenize dialog's
// FIRST view is mouse-only by construction. That is the safer default anyway:
// this popup opens from the user's own swallowed Enter press, and the browser
// extension had to add a deliberate arming delay (TOKENIZE_KEY_ARM_MS in
// content/content.js) to stop OS key-repeat from that same keypress activating
// "Tokenize & Send" before the preview had been read. Here that class of bug
// cannot happen at all.
//
// ── AllowActivation(): the ONE exception, and why it is safe ────────────────
// The popup's second view is a text box the user types their own replacement
// into, and a text box that cannot hold keyboard focus is not a text box. So
// that view — and only that view — drops WS_EX_NOACTIVATE and activates.
//
// This does not break the rewrite it is offering, because of WHEN each thing
// happens. The rule above is about the moment RunRewrite starts typing: it
// compares GetForegroundWindow() against the window pinned at block time and
// aborts ("focus_changed") if they differ. That moment comes AFTER the user
// clicks Send and this window has gone away — the edit view hides itself and
// waits ReturnFocusMs before closing precisely so Windows has handed the
// foreground back to the AI app before Node has even been told the answer.
//
// The other thing that used to break is fixed on the enforcer side rather than
// papered over here: its poll thread used to DELETE the pending-rewrite pin the
// instant the foreground stopped being the AI app, so a dialog that took focus
// destroyed the block it was editing. It now freezes that pin instead
// (enforcer-win.ps1's _pendingFrozen / HoldPendingRewrite), while keeping every
// pre-flight check that decides whether the rewrite may proceed. If the
// foreground does NOT come back in time, RunRewrite still refuses — the net is
// unchanged, this only makes the common case land.
public class CfaiNoActivateForm : Form
{
    const int WS_EX_TOPMOST    = 0x00000008;
    const int WS_EX_TOOLWINDOW = 0x00000080;
    const int WS_EX_NOACTIVATE = 0x08000000;
    const int GWL_EXSTYLE      = -20;

    [System.Runtime.InteropServices.DllImport("user32.dll", SetLastError = true)]
    static extern int GetWindowLong(IntPtr hWnd, int nIndex);
    [System.Runtime.InteropServices.DllImport("user32.dll", SetLastError = true)]
    static extern int SetWindowLong(IntPtr hWnd, int nIndex, int dwNewLong);
    [System.Runtime.InteropServices.DllImport("user32.dll")]
    static extern bool SetForegroundWindow(IntPtr hWnd);

    // One-way: a form that has been allowed to activate is never put back, so
    // there is no state a later code path could re-enter the no-activate mode
    // from and get it wrong.
    bool _noActivate = true;

    protected override bool ShowWithoutActivation { get { return _noActivate; } }

    protected override CreateParams CreateParams
    {
        get
        {
            CreateParams cp = base.CreateParams;
            if (_noActivate) cp.ExStyle |= WS_EX_NOACTIVATE;
            cp.ExStyle |= WS_EX_TOPMOST | WS_EX_TOOLWINDOW;
            return cp;
        }
    }

    // Drop WS_EX_NOACTIVATE and take the foreground. The style has to come off
    // the LIVE window, not just the CreateParams flag: CreateParams is only read
    // when a handle is created, and this form's handle already exists — the flag
    // is set as well so a WinForms handle recreation cannot silently put the
    // style back.
    public void AllowActivation()
    {
        if (!_noActivate) return;
        _noActivate = false;
        try
        {
            IntPtr h = Handle;
            int ex = GetWindowLong(h, GWL_EXSTYLE);
            SetWindowLong(h, GWL_EXSTYLE, ex & ~WS_EX_NOACTIVATE);
            // Permitted here specifically: the user has just clicked this
            // window, so this process owns the last input event and Windows
            // grants it the foreground. Failure is non-fatal — the box simply
            // needs a click before it can be typed into.
            SetForegroundWindow(h);
        }
        catch { }
        try { Activate(); } catch { }
    }
}

// ── Tokenize & Send dialog (C#, its own STA thread) ─────────────────────────
//
// Same arrangement as CfaiRequestDialog above and for the same reasons: a
// dedicated STA thread with its own message loop (never ShowDialog() on the
// thread that owns the stdin read), a compiled type rather than a scriptblock,
// one-at-a-time per block, and every stdout line routed through
// CfaiRequestDialog.Write so the process keeps exactly ONE writer under ONE lock.
//
// TWO VIEWS, ONE WINDOW. The first asks the question (Tokenize & Send / Edit
// manually) and is mouse-only. The second — reached by "Edit manually" — swaps
// the same form's controls for a text box pre-filled with the MASKED text, so
// the user can reword it and send it themselves instead of being sent back to
// the app to retype the whole message from memory. No second window is opened;
// see EnterEditMode.
//
// PII: the two values shown are handed in by the caller and are BOTH already
// safe. `categories` is a list of pattern NAMES ("us-ssn"), and `preview` is the
// text the enforcer computed as the MASKED replacement — the same string it
// would type into the composer, with every sensitive span already replaced by a
// fixed label. The original prompt does not exist on this side of the pipe, and
// this type never reads the screen, the clipboard or any other process.
//
// The edit box's contents are that same masked text plus whatever the user
// typed over it, and they leave here on exactly one line, as the "text" field of
// an action:"edit_send" result — the thing that gets typed. They are not logged,
// not echoed anywhere else, and no other action carries them.
//
// STALENESS is deliberately NOT re-checked here. The enforcer owns that: a
// tokenize command is validated against its own single-use pinned block
// (_pendingBlockId + _pendingExpiresAt), and StartRewrite answers a wrong or
// late id with an explicit "stale_block_id"/"expired" rewrite line instead of
// touching the composer. A second, independent expiry clock here could only
// disagree with that one. The timeouts below are therefore about the SCREEN — do
// not leave a popup up for a block the user has long since walked away from —
// and not about safety.
public static class CfaiTokenizeDialog
{
    // Mirrors the Electron popup's own 16s self-close, which was derived from
    // REWRITE_TTL (15s) in enforcer-win.ps1. THE CHOICE VIEW ONLY.
    public const int TimeoutMs = 16000;

    // Card geometry. One place, because the choice view and the edit view share
    // the same window and must agree about its width and gutter.
    const int CardW = 480;
    const int Pad = 28;

    // ── The edit view's own clock ────────────────────────────────────────────
    // 16s is a fine budget for reading two buttons and clicking one. It is not a
    // budget for typing a sentence, so the edit view gets its own, and the
    // enforcer holds its pin for the same reason (REWRITE_EDIT_TTL, 120s, asked
    // for over {"cmd":"tokenize_edit"}). The three clocks are deliberately
    // ordered so the SCREEN gives up first and the pin last:
    //   this 90s  <  notify.js's TOKENIZE_EDIT_TIMEOUT_MS (100s)
    //             <  enforcer-win.ps1's REWRITE_EDIT_TTL (120s)
    // — i.e. the Node-side backstop can only fire after this form has already
    // failed to write its own result line, and the pin outlives both.
    public const int EditTimeoutMs = 90000;

    // How long after "Edit manually" this window waits before it takes the
    // foreground. Nothing about the UI needs the delay; the ENFORCER does. The
    // click writes a tokenize_dialog_editing line first, Node turns that into a
    // {"cmd":"tokenize_edit","state":"on"} on the enforcer's control channel,
    // and this pause is the round trip's headroom, so the pin is already held
    // before its poll thread sees a non-AI foreground. Losing that race is not
    // dangerous — the enforcer answers a dropped pin with "stale_block_id" and
    // types nothing — it just wastes the user's edit.
    public const int ActivateEditMs = 250;

    // How long the window stays hidden-but-open after Send before it actually
    // closes. Hiding hands the foreground back to the AI app; only then is the
    // result line written, so by the time RunRewrite re-checks
    // GetForegroundWindow() against the window it pinned at block time, the
    // answer is the app again rather than this popup. RunRewrite still aborts
    // ("focus_changed") if it is not — this makes the common case work, it does
    // not remove the check.
    public const int ReturnFocusMs = 250;

    // DISPLAY cap for the read-only preview label. The caller's `preview` is the
    // WHOLE masked candidate (the enforcer stopped slicing it when this view
    // started pre-filling an editable box from it), and a label 76px tall cannot
    // show 456 characters anyway.
    public const int PreviewMax = 300;

    // Cap on the edit box, mirroring REWRITE_MAX_CHARS in enforcer-win.ps1 —
    // the most characters that file's write loop can pace out inside its budget.
    // Held in lockstep by agent/tests/os-monitor-tokenize-dialog.test.mjs, which
    // recomputes it from the .ps1's own constants. Refusing the 457th keystroke
    // here is visible; the enforcer's fail-closed "edit_too_long" is the real
    // gate, and the budget check behind it can still refuse a shorter string
    // that is full of line breaks.
    public const int EditMax = 456;

    // block_id -> open. ONE POPUP AT A TIME PER BLOCK: the enforcer emits a block
    // event for every swallowed send, so holding Enter down would otherwise stack
    // a window per keystroke. The key is the block id, which the enforcer keeps
    // stable while the composer text is unchanged — so repeated attempts at the
    // same prompt all resolve to the one popup, and a genuinely new prompt (new
    // id) gets a fresh one. Released when the form closes.
    // Value is the live window handle, as in CfaiRequestDialog: a repeat of the
    // same blocked send raises the popup that is already up.
    static readonly Dictionary<string, IntPtr> Open = new Dictionary<string, IntPtr>(StringComparer.OrdinalIgnoreCase);

    // Returns false when a popup for this block is already on screen.
    public static bool Show(string requestId, string dedupeKey, string appName, string categories, string preview)
    {
        string key = string.IsNullOrEmpty(dedupeKey) ? requestId : dedupeKey;
        IntPtr existing = IntPtr.Zero;
        bool dup = false;
        lock (Open)
        {
            if (Open.TryGetValue(key, out existing)) dup = true;
            else Open[key] = IntPtr.Zero;
        }
        if (dup) { CfaiRequestDialog.Resurface(existing); return false; }
        Thread t = new Thread(delegate() { Run(requestId, key, appName, categories, preview); });
        t.SetApartmentState(ApartmentState.STA);
        // Background: a popup left on screen must never keep this process — or
        // the agent's shutdown — waiting.
        t.IsBackground = true;
        t.Name = "cfai-tokenize-dialog";
        t.Start();
        return true;
    }

    static void Run(string requestId, string key, string appName, string categories, string preview)
    {
        // "edit" is the default and it is also the SAFE default: the block stands
        // and the user fixes the prompt themselves, which is exactly what happens
        // when no popup is shown at all. Closing the window produces it too (the
        // result is written after Application.Run returns).
        string action = "edit";
        // What the user typed into the edit view, and ONLY set by its Send
        // button. Empty for every other outcome, so no other action can carry
        // text on the result line.
        string editedText = "";
        try
        {
            if (preview == null) preview = "";
            // Two different caps on two different things. `preview` keeps the
            // WHOLE masked candidate because the edit box is pre-filled from it
            // and its contents are what gets typed — slicing it here would let
            // the user send half a message. `shownPreview` is the read-only
            // label's version, truncated with three ASCII dots so a long prompt
            // does not silently clip at the label's edge. ASCII deliberately:
            // this .ps1 has no BOM, so a literal U+2026 would reach the label as
            // mojibake.
            string shownPreview = preview.Length > PreviewMax
                ? preview.Substring(0, PreviewMax) + "..." : preview;
            string app = string.IsNullOrEmpty(appName) ? "this app" : appName;
            string cats = string.IsNullOrEmpty(categories) ? "sensitive data" : categories;

            CfaiNoActivateForm form = new CfaiNoActivateForm();
            form.Text = "CloudFuze AI Governance";
            // BORDERLESS, like the Request Access dialog and for the same reason:
            // the grey system title bar is most of what made this look dated.
            // The window is still a real top-level window, so WS_EX_NOACTIVATE,
            // the topmost style and the no-taskbar rule are all unaffected.
            form.FormBorderStyle = FormBorderStyle.None;
            form.StartPosition = FormStartPosition.CenterScreen;
            form.MinimizeBox = false;
            form.MaximizeBox = false;
            // NO TASKBAR ENTRY, same standing rule as the Request Access dialog.
            form.ShowInTaskbar = false;
            form.TopMost = true;
            form.BackColor = CfaiTheme.Surface;
            form.Font = CfaiTheme.Ui(9.75f, FontStyle.Regular);
            form.ClientSize = new Size(CardW, 500);
            // Publish the live handle so a repeat of the same blocked send raises
            // this popup instead of being silently suppressed. CreateParams
            // already gives this form WS_EX_TOPMOST, so unlike the Request Access
            // dialog it does not also need ForceOnTop at show time.
            form.Shown += delegate(object s2, EventArgs e2)
            {
                try { lock (Open) { Open[key] = form.Handle; } } catch { }
            };

            // ── The alert mark ──────────────────────────────────────────────
            CfaiBadge badge = new CfaiBadge();
            badge.SetBounds((CardW - 72) / 2, 28, 72, 72);
            badge.Fill = CfaiTheme.AlertSoft;
            badge.Glyph = CfaiTheme.Warn;
            // A warning triangle. A \u escape rather than a literal, because this
            // .ps1 has no BOM and PowerShell 5.1 would read a literal glyph in the
            // system ANSI codepage and hand the label mojibake.
            badge.Mark = "\u26A0";
            badge.MarkSize = 26f;

            Label head = new Label();
            head.Text = "This prompt can't be sent";
            head.Font = CfaiTheme.Ui(15f, FontStyle.Bold);
            head.ForeColor = CfaiTheme.Ink;
            head.TextAlign = ContentAlignment.MiddleCenter;
            head.SetBounds(Pad, 116, CardW - Pad * 2, 30);

            // The app name is bold INSIDE the sentence, which a Label cannot do —
            // hence a borderless read-only RichTextBox. It is not an input: it
            // cannot be tabbed to, shows no caret and ignores the mouse, so it
            // behaves exactly like the label it replaces.
            RichTextBox body = new RichTextBox();
            body.BorderStyle = BorderStyle.None;
            body.ReadOnly = true;
            body.BackColor = CfaiTheme.Surface;
            body.ForeColor = CfaiTheme.Muted;
            body.Font = CfaiTheme.Ui(10f, FontStyle.Regular);
            body.TabStop = false;
            body.Cursor = Cursors.Default;
            body.ScrollBars = RichTextBoxScrollBars.None;
            body.SetBounds(Pad, 152, CardW - Pad * 2, 46);
            body.SelectionAlignment = HorizontalAlignment.Center;
            body.AppendText("CloudFuze AI Governance blocked this message in ");
            body.SelectionFont = CfaiTheme.Ui(10f, FontStyle.Bold);
            body.SelectionColor = CfaiTheme.Ink;
            body.AppendText(app);
            body.SelectionFont = CfaiTheme.Ui(10f, FontStyle.Regular);
            body.SelectionColor = CfaiTheme.Muted;
            body.AppendText(" because it contains sensitive data:");
            body.SelectAll();
            body.SelectionAlignment = HorizontalAlignment.Center;
            body.Select(0, 0);
            // A read-only box still takes focus on click and shows a selection;
            // neither belongs on what is really a paragraph of text.
            body.Enter += delegate(object s3, EventArgs e3) { try { form.ActiveControl = null; } catch { } };

            // ── One pill per detected pattern, centred as a row ─────────────
            // `cats` is a comma-separated list of pattern NAMES (never content),
            // so splitting it is safe and gives the design's chips.
            List<CfaiPill> pills = new List<CfaiPill>();
            string[] catNames = (cats ?? "").Split(new char[] { ',' }, StringSplitOptions.RemoveEmptyEntries);
            int pillY = 206, pillH = 26, gap = 8, totalW = 0;
            using (Graphics mg = form.CreateGraphics())
            {
                foreach (string raw in catNames)
                {
                    string name = raw.Trim();
                    if (name.Length == 0) continue;
                    CfaiPill pill = new CfaiPill();
                    pill.Text = name;
                    pill.Font = CfaiTheme.Ui(9f, FontStyle.Bold);
                    pill.Fill = CfaiTheme.AlertSoft;
                    pill.Ink = CfaiTheme.AlertInk;
                    Size sz = TextRenderer.MeasureText(mg, name, pill.Font);
                    pill.Height = pillH;
                    pill.Width = Math.Min(sz.Width + 26, CardW - Pad * 2);
                    pills.Add(pill);
                    totalW += pill.Width + gap;
                }
            }
            if (totalW > 0) totalW -= gap;
            int pillX = (CardW - totalW) / 2;
            foreach (CfaiPill pill in pills)
            {
                pill.SetBounds(pillX, pillY, pill.Width, pillH);
                pillX += pill.Width + gap;
            }

            // ── What actually gets sent ─────────────────────────────────────
            CfaiRoundPanel previewBox = new CfaiRoundPanel();
            previewBox.SetBounds(Pad, 244, CardW - Pad * 2, 80);
            previewBox.BackColor = CfaiTheme.SafeSoft;
            previewBox.Line = CfaiTheme.SafeLine;

            Label previewLabel = new Label();
            // Same words the browser extension's own modal uses, so the desktop
            // and browser experiences read as one product.
            previewLabel.Text = "THIS IS WHAT GETS SENT";
            previewLabel.Font = CfaiTheme.Ui(7.75f, FontStyle.Bold);
            previewLabel.ForeColor = CfaiTheme.SafeInk;
            previewLabel.BackColor = Color.Transparent;
            previewLabel.SetBounds(14, 10, previewBox.Width - 28, 14);

            Label previewText = new Label();
            previewText.Text = shownPreview;
            previewText.Font = CfaiTheme.Mono(9.5f, FontStyle.Regular);
            previewText.ForeColor = CfaiTheme.Ink;
            previewText.BackColor = Color.Transparent;
            previewText.UseMnemonic = false;
            previewText.SetBounds(14, 28, previewBox.Width - 28, 44);
            previewBox.Controls.Add(previewLabel);
            previewBox.Controls.Add(previewText);

            Label hint = new Label();
            hint.Text = "Tokenize & Send replaces each detected value with a fixed label "
                      + "before sending. The original values are never sent, and cannot be "
                      + "recovered from the label.";
            // '&' in "Tokenize & Send" is literal text here, not an access key.
            hint.UseMnemonic = false;
            hint.ForeColor = CfaiTheme.Muted;
            hint.Font = CfaiTheme.Ui(9.5f, FontStyle.Regular);
            hint.TextAlign = ContentAlignment.TopCenter;
            hint.SetBounds(Pad, 336, CardW - Pad * 2, 56);

            // ── The two actions, centred as a pair ──────────────────────────
            int btnW = 176, btnH = 44, btnGap = 12;
            int btnX = (CardW - (btnW * 2 + btnGap)) / 2;

            CfaiButton tokenize = new CfaiButton();
            tokenize.Text = "Tokenize & Send";
            tokenize.Font = CfaiTheme.Ui(10f, FontStyle.Bold);
            tokenize.Fill = CfaiTheme.Go;
            tokenize.FillHover = CfaiTheme.GoHover;
            tokenize.SetBounds(btnX, 400, btnW, btnH);

            CfaiButton edit = new CfaiButton();
            edit.Text = "Edit manually";
            edit.Font = CfaiTheme.Ui(10f, FontStyle.Bold);
            edit.Fill = CfaiTheme.Alt;
            edit.FillHover = CfaiTheme.AltHover;
            edit.SetBounds(btnX + btnW + btnGap, 400, btnW, btnH);

            Label foot = new Label();
            foot.Text = "This event was reported to the security team.";
            foot.ForeColor = CfaiTheme.Muted;
            foot.Font = CfaiTheme.Ui(8.5f, FontStyle.Regular);
            foot.TextAlign = ContentAlignment.MiddleCenter;
            foot.SetBounds(Pad, 456, CardW - Pad * 2, 18);

            // ── The edit view's controls ────────────────────────────────────
            // Built now and hidden, rather than created on the click: the swap
            // is then a Visible flip on nine controls with no layout work, no
            // handle churn and nothing that could throw halfway through and
            // leave a half-built window on screen.
            Label editLabel = new Label();
            editLabel.Text = "Edit the message, then send it";
            editLabel.SetBounds(14, 38, 442, 18);
            editLabel.Visible = false;

            Label editHint = new Label();
            editHint.Text = "The detected values have already been replaced with labels. "
                          + "Only what is in this box gets sent.";
            editHint.ForeColor = SystemColors.GrayText;
            editHint.SetBounds(14, 58, 442, 32);
            editHint.Visible = false;

            TextBox editBox = new TextBox();
            editBox.Multiline = true;
            editBox.ScrollBars = ScrollBars.Vertical;
            editBox.MaxLength = EditMax;
            // PRE-FILLED WITH THE MASKED TEXT, never the original — this side of
            // the pipe has never held the original (see the type comment).
            editBox.Text = preview;
            editBox.SetBounds(14, 94, 442, 138);
            editBox.Visible = false;

            Label editCount = new Label();
            editCount.ForeColor = SystemColors.GrayText;
            editCount.SetBounds(14, 238, 240, 16);
            editCount.Text = editBox.Text.Length + " / " + EditMax;
            editCount.Visible = false;

            Button send = new Button();
            send.Text = "Send";
            send.SetBounds(346, 274, 110, 30);
            send.Visible = false;
            // An empty box has nothing to type; the enforcer refuses it too
            // ("edit_empty"), so this is the visible half of one rule.
            send.Enabled = editBox.Text.Trim().Length > 0;

            Button cancel = new Button();
            cancel.Text = "Cancel";
            cancel.SetBounds(250, 274, 88, 30);
            cancel.Visible = false;

            // The primary action, marked as such VISUALLY only — in the choice
            // view this window can never hold keyboard focus (see
            // CfaiNoActivateForm), so AcceptButton is about which button reads
            // as the default, not about a keystroke that could ever reach it.
            // Cleared on the way into the edit view, where the multi-line box
            // owns Enter.
            form.AcceptButton = tokenize;

            // SCREEN hygiene, not a safety check — see the type comment. A popup
            // for a send the user abandoned should not sit there indefinitely.
            // Two of them: the choice view's TimeoutMs, and the edit view's much
            // longer EditTimeoutMs, which replaces it.
            System.Windows.Forms.Timer expiry = new System.Windows.Forms.Timer();
            expiry.Interval = TimeoutMs;
            expiry.Tick += delegate(object s, EventArgs e)
            {
                expiry.Stop();
                if (action == "edit") action = "timeout";
                form.Close();
            };
            expiry.Start();

            // One-shot: takes the foreground for the edit box, ActivateEditMs
            // after the view opens. See ActivateEditMs for why it waits.
            System.Windows.Forms.Timer activate = new System.Windows.Forms.Timer();
            activate.Interval = ActivateEditMs;
            activate.Tick += delegate(object s, EventArgs e)
            {
                activate.Stop();
                form.AllowActivation();
                try { editBox.Focus(); editBox.SelectionStart = editBox.Text.Length; } catch { }
            };

            // One-shot: closes the window ReturnFocusMs after Send/Cancel hid
            // it, so the AI app is back in the foreground before Node — and
            // therefore the enforcer — is told anything. See ReturnFocusMs.
            System.Windows.Forms.Timer closer = new System.Windows.Forms.Timer();
            closer.Interval = ReturnFocusMs;
            closer.Tick += delegate(object s, EventArgs e) { closer.Stop(); form.Close(); };

            form.FormClosed += delegate(object s, FormClosedEventArgs e)
            {
                expiry.Stop(); expiry.Dispose();
                activate.Stop(); activate.Dispose();
                closer.Stop(); closer.Dispose();
            };

            tokenize.Click += delegate(object s, EventArgs e)
            {
                action = "tokenize";
                // Closed immediately rather than showing a "Masking…" state: the
                // rewrite happens in another process against a composer this
                // popup must not be covering, and its outcome is reported on the
                // enforcer's own rewrite line, not here.
                form.Close();
            };

            // "EDIT IN THE APP" — closes this window and hands the user back to
            // the AI tool's OWN composer, where their text is still sitting
            // untouched (the send was swallowed; nothing was cleared).
            //
            // CHANGED 2026-09-09 at the user's request. This button used to swap
            // the window over to an in-dialog edit box, which was itself added
            // because live testing found people going back to the app and
            // retyping a whole message from memory. The complaint with the
            // in-dialog box is that it edits a COPY: you fix the text in a
            // CloudFuze window rather than in the composer you were already
            // typing in, and the thing that then gets sent is typed back in by
            // us. Editing in place is the more natural gesture and keeps the
            // user in one context.
            //
            // WHAT MAKES THIS SAFE, and it is not the dialog: the block is NOT
            // lifted by closing this window. `action` stays "edit", so nothing
            // downstream acts, the composer keeps its text, and the enforcer
            // keeps scanning it every 150ms. So the outcome is decided by what
            // the user leaves in the box:
            //   * still sensitive -> the next send is swallowed again
            //   * edited clean    -> the UIA rescan drops _blockUia AND releases
            //                        the 30s cooldown (see UpdateUia in
            //                        enforcer-win.ps1), so the send goes through
            // That cooldown release had to be added for this to work at all: it
            // existed only on the typed-buffer rescan, which is empty after a
            // paste and discarded on focus-out, so on a web surface "delete the
            // secret and press Enter" was swallowed for up to 30 seconds.
            //
            // The in-dialog edit view's controls are still built above and are
            // now unreachable. Left in place deliberately rather than deleted:
            // the `edit_send` path they drive is live, tested and reported as
            // `enforcement_redact` with the user's own text, and re-pointing a
            // button at it is a one-line change if this decision is revisited.
            edit.Click += delegate(object s, EventArgs e)
            {
                // Same outcome as Cancel: stop the expiry and close, leaving
                // `action` as "edit". No `tokenize_dialog_editing` line is
                // written — that told the enforcer to HOLD its pin for a text
                // box that was about to open, and no box opens now. Holding it
                // would keep a block pinned for the hold's full window while the
                // user edits in the app, which is exactly what we do not want:
                // the pin is what a rewrite consumes, and there is no rewrite
                // on this path.
                expiry.Stop();
                form.Close();
            };

            // Unreachable while "Edit in the app" closes instead of swapping.
            // See the note above.
            Action swapToEditView = delegate()
            {
                expiry.Stop();

                badge.Visible = false;
                head.Visible = false;
                body.Visible = false;
                foreach (CfaiPill p in pills) p.Visible = false;
                previewBox.Visible = false;
                hint.Visible = false;
                foot.Visible = false;
                tokenize.Visible = false;
                edit.Visible = false;

                editLabel.Visible = true;
                editHint.Visible = true;
                editBox.Visible = true;
                editCount.Visible = true;
                send.Visible = true;
                cancel.Visible = true;

                // Enter belongs to the multi-line box now, exactly as it does in
                // the Request Access dialog's reason box; Esc cancels.
                form.AcceptButton = null;
                form.CancelButton = cancel;

                expiry.Interval = EditTimeoutMs;
                expiry.Start();
                activate.Start();
            };
            // Referenced so the compiler does not warn it is unused.
            if (swapToEditView == null) { }

            editBox.TextChanged += delegate(object s, EventArgs e)
            {
                editCount.Text = editBox.Text.Length + " / " + EditMax;
                send.Enabled = editBox.Text.Trim().Length > 0;
            };

            send.Click += delegate(object s, EventArgs e)
            {
                if (editBox.Text.Trim().Length == 0) return;
                action = "edit_send";
                editedText = editBox.Text;
                // Hide now, close on the timer — the hide is what hands the
                // foreground back to the AI app before the result line goes out.
                //
                // The edit expiry is deliberately LEFT RUNNING as the backstop:
                // if `closer` somehow never ticked, this form would sit hidden
                // with Application.Run never returning — no result line, and the
                // per-block dedupe key never released, so the next blocked send
                // would get no popup at all. The expiry closes it in that case,
                // and it cannot change the answer (its Tick only rewrites
                // `action` while it is still "edit").
                try { form.Hide(); } catch { }
                closer.Start();
            };

            // Same outcome "Edit manually" used to have: action stays "edit", so
            // the block stands and nothing downstream acts on it.
            cancel.Click += delegate(object s, EventArgs e) { expiry.Stop(); form.Close(); };

            form.Controls.Add(badge);
            form.Controls.Add(head);
            form.Controls.Add(body);
            foreach (CfaiPill p in pills) form.Controls.Add(p);
            form.Controls.Add(previewBox);
            form.Controls.Add(hint);
            form.Controls.Add(foot);
            form.Controls.Add(edit);
            form.Controls.Add(tokenize);
            form.Controls.Add(editLabel);
            form.Controls.Add(editHint);
            form.Controls.Add(editBox);
            form.Controls.Add(editCount);
            form.Controls.Add(cancel);
            form.Controls.Add(send);

            // The message loop for THIS thread only. The main thread stays in its
            // stdin read the whole time this is up.
            Application.Run(form);
            form.Dispose();
        }
        catch (Exception ex)
        {
            action = "error";
            editedText = "";
            Console.Error.WriteLine("tokenize-dialog-failed: " + ex.Message);
        }
        finally
        {
            lock (Open) { Open.Remove(key); }
        }

        // The correlation id, the choice, and — for action:"edit_send" ONLY — the
        // text the user typed into our own box, which is the whole point of that
        // action: it is what the enforcer is being asked to type. The masked
        // `preview` is still never echoed back for any other action (it is
        // content, and the caller already has it), and no other field is added.
        CfaiRequestDialog.Write("{\"kind\":\"tokenize_dialog_result\""
            + ",\"request_id\":\"" + CfaiRequestDialog.Esc(requestId) + "\""
            + ",\"action\":\"" + CfaiRequestDialog.Esc(action) + "\""
            + (action == "edit_send" ? ",\"text\":\"" + CfaiRequestDialog.Esc(editedText) + "\"" : "")
            + "}");
    }
}
'@

# Compile failure must not take the toast helper down with it — toasts are the
# more important job. $DialogReady false means show_request_dialog and
# show_tokenize_dialog both answer 'unavailable'; Node then falls back to a toast
# (tells the user how to ask through the dashboard / to edit the prompt by hand).
# BOTH dialog types are compiled in the ONE Add-Type call below, deliberately: a
# second call would mean a second stdout lock, and this process must keep exactly
# one writer — see CfaiRequestDialog.Write, which CfaiTokenizeDialog also uses.
$DialogReady = $false
try {
    Add-Type -TypeDefinition $dialogSource -ReferencedAssemblies @('System.Windows.Forms', 'System.Drawing') -ErrorAction Stop
    $DialogReady = $true
} catch {
    [Console]::Error.WriteLine("request-dialog-unavailable: $($_.Exception.Message)")
}

# THE ONE STDOUT WRITER. Routed through the compiled type's lock when it is
# available, so the dialog thread and this thread can never interleave a line.
function Write-CFAILine([string]$line) {
    if ($DialogReady) { [CfaiRequestDialog]::Write($line) }
    else { [Console]::Out.WriteLine($line); [Console]::Out.Flush() }
}

$notifier = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($Aumid)

function Show-CFAIToast([string]$title, [string]$message) {
    function Esc([string]$s) {
        if ($null -eq $s) { return '' }
        return ($s -replace '&','&amp;' -replace '<','&lt;' -replace '>','&gt;' -replace '"','&quot;' -replace "'",'&apos;')
    }
    $xml = @"
<toast scenario="reminder">
  <visual>
    <binding template="ToastGeneric">
      <text>$(Esc $title)</text>
      <text>$(Esc $message)</text>
      <text placement="attribution">CloudFuze AI Governance</text>
    </binding>
  </visual>
  <audio src="ms-winsoundevent:Notification.Default" />
</toast>
"@
    $doc = New-Object Windows.Data.Xml.Dom.XmlDocument
    $doc.LoadXml($xml)
    $toast = [Windows.UI.Notifications.ToastNotification]::new($doc)
    $notifier.Show($toast)
}

# The ephemeral Request Access dialog. Hands off to the compiled type, which
# starts its own STA thread and writes the result line itself — this returns
# immediately so the stdin loop keeps pumping.
function Show-CFAIRequestDialog($cmd) {
    $requestId = [string]$cmd.request_id
    if ([string]::IsNullOrEmpty($requestId)) {
        [Console]::Error.WriteLine('request-dialog-skipped: no request_id')
        return
    }
    if (-not $DialogReady) {
        Write-CFAILine ('{"kind":"access_request_result","request_id":"' + ($requestId -replace '[\\"]','') + '","action":"unavailable"}')
        return
    }
    $opened = [CfaiRequestDialog]::Show(
        $requestId,
        [string]$cmd.dedupe_key,
        [string]$cmd.agent_name,
        [string]$cmd.app_name)
    if (-not $opened) {
        # A dialog for this block session is already on screen. NOTHING new is
        # shown — the answer is only so the caller can drop its correlation
        # entry instead of waiting for a reply that will never come.
        Write-CFAILine ('{"kind":"access_request_result","request_id":"' + ($requestId -replace '[\\"]','') + '","action":"suppressed"}')
    }
}

# The ephemeral Tokenize & Send popup. Same hand-off as the Request Access
# dialog above: the compiled type owns its own STA thread and writes the result
# line itself, so this returns immediately and the stdin loop keeps pumping.
#
# `preview` is the ALREADY-MASKED text the enforcer computed, and `categories` is
# a list of pattern names. Neither is logged here, and the original prompt never
# reaches this process at all.
function Show-CFAITokenizeDialog($cmd) {
    $requestId = [string]$cmd.request_id
    if ([string]::IsNullOrEmpty($requestId)) {
        [Console]::Error.WriteLine('tokenize-dialog-skipped: no request_id')
        return
    }
    if (-not $DialogReady) {
        Write-CFAILine ('{"kind":"tokenize_dialog_result","request_id":"' + ($requestId -replace '[\\"]','') + '","action":"unavailable"}')
        return
    }
    $opened = [CfaiTokenizeDialog]::Show(
        $requestId,
        [string]$cmd.dedupe_key,
        [string]$cmd.app_name,
        [string]$cmd.categories,
        [string]$cmd.preview)
    if (-not $opened) {
        # A popup for this same block is already on screen. NOTHING new is shown —
        # the answer only exists so the caller can drop its correlation entry
        # instead of waiting for a reply that will never come.
        Write-CFAILine ('{"kind":"tokenize_dialog_result","request_id":"' + ($requestId -replace '[\\"]','') + '","action":"suppressed"}')
    }
}

# Signal ready
Write-CFAILine ('{"kind":"ready","aumid":"' + $Aumid + '","dialog":' + $(if ($DialogReady) { 'true' } else { 'false' }) + '}')

# Main loop: blocking read on stdin, one JSON line per command. This thread must
# never block on anything else — see the dialog note above.
while ($true) {
    $line = $null
    try { $line = [Console]::In.ReadLine() } catch { break }
    if ($null -eq $line) { break }              # stdin closed (Node exited)
    $line = $line.Trim()
    if ($line.Length -eq 0) { continue }

    try {
        $cmd = $line | ConvertFrom-Json
        switch ($cmd.cmd) {
            'show'     { Show-CFAIToast $cmd.title $cmd.message }
            'ping'     { Write-CFAILine '{"kind":"pong"}' }
            'scrub_clipboard' {
                # Replace clipboard contents with a sanitized notice. STA
                # thread (set on the powershell.exe -Sta flag in notify.js)
                # is required for Windows Forms Clipboard access.
                try {
                    [System.Windows.Forms.Clipboard]::SetText($cmd.replacement)
                    Write-CFAILine '{"kind":"scrubbed"}'
                } catch {
                    [Console]::Error.WriteLine("scrub-failed: $($_.Exception.Message)")
                }
            }
            'show_request_dialog' { Show-CFAIRequestDialog $cmd }
            'show_tokenize_dialog' { Show-CFAITokenizeDialog $cmd }
            'shutdown' { break }
            default    { [Console]::Error.WriteLine("unknown-cmd: $($cmd.cmd)") }
        }
    } catch {
        [Console]::Error.WriteLine("toast-error: $($_.Exception.Message)")
    }
}

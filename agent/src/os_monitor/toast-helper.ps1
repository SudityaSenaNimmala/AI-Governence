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

public static class CfaiRequestDialog
{
    // Mirrors REASON_MAX in server/src/routes/access-requests.js — the server
    // truncates past this, so the box refuses past it and the user can see that
    // happen instead of silently losing the end of a sentence.
    public const int ReasonMax = 500;

    static readonly object OutLock = new object();
    // dedupe_key -> open. ONE DIALOG AT A TIME per block, and this is the only
    // duplicate guard in the whole path: the enforcer offers on every blocked
    // send (no per-session latch), so without this, holding Enter down would
    // stack a window per keystroke. The key is released the moment the form
    // closes, so the very next blocked send opens a fresh dialog — which is the
    // point, for a user who was declined or who cancelled.
    static readonly Dictionary<string, bool> Open = new Dictionary<string, bool>(StringComparer.OrdinalIgnoreCase);

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
        lock (Open)
        {
            if (Open.ContainsKey(key)) return false;
            Open[key] = true;
        }
        Thread t = new Thread(delegate() { Run(requestId, key, agentName, appName); });
        t.SetApartmentState(ApartmentState.STA);
        // Background: a dialog left open must never keep this process — or the
        // agent's shutdown — waiting.
        t.IsBackground = true;
        t.Name = "cfai-request-dialog";
        t.Start();
        return true;
    }

    static void Run(string requestId, string key, string agentName, string appName)
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

            Form form = new Form();
            form.Text = "CloudFuze AI Governance";
            form.FormBorderStyle = FormBorderStyle.FixedDialog;
            form.StartPosition = FormStartPosition.CenterScreen;
            form.MinimizeBox = false;
            form.MaximizeBox = false;
            // NO TASKBAR ENTRY. This process must never look like an app that is
            // running; the dialog is a momentary prompt, not a window the user
            // owns or can go back to.
            form.ShowInTaskbar = false;
            form.TopMost = true;
            form.ClientSize = new Size(430, 250);
            form.Padding = new Padding(14);

            Label head = new Label();
            head.Text = subject;
            head.Font = new Font(SystemFonts.MessageBoxFont.FontFamily, 10.5f, FontStyle.Bold);
            head.AutoEllipsis = true;
            head.SetBounds(14, 14, 400, 22);

            Label body = new Label();
            body.Text = "Your organization has blocked this on this device. Tell your "
                      + "administrator why you need it and they can grant temporary access.";
            body.SetBounds(14, 40, 400, 38);

            TextBox box = new TextBox();
            box.Multiline = true;
            box.ScrollBars = ScrollBars.Vertical;
            box.MaxLength = ReasonMax;
            box.SetBounds(14, 86, 400, 96);

            Label count = new Label();
            count.SetBounds(14, 186, 200, 16);
            count.ForeColor = SystemColors.GrayText;
            count.Text = "0 / " + ReasonMax;

            Button submit = new Button();
            submit.Text = "Request access";
            submit.SetBounds(258, 206, 156, 28);
            submit.Enabled = false;
            submit.DialogResult = DialogResult.OK;

            Button cancel = new Button();
            cancel.Text = "Cancel";
            cancel.SetBounds(170, 206, 80, 28);
            cancel.DialogResult = DialogResult.Cancel;

            box.TextChanged += delegate(object s, EventArgs e)
            {
                count.Text = box.Text.Length + " / " + ReasonMax;
                submit.Enabled = box.Text.Trim().Length > 0;
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
                try { form.Activate(); box.Focus(); } catch { }
            };

            form.Controls.Add(head);
            form.Controls.Add(body);
            form.Controls.Add(box);
            form.Controls.Add(count);
            form.Controls.Add(cancel);
            form.Controls.Add(submit);

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
    static readonly Dictionary<string, bool> Open = new Dictionary<string, bool>(StringComparer.OrdinalIgnoreCase);

    // Returns false when a popup for this block is already on screen.
    public static bool Show(string requestId, string dedupeKey, string appName, string categories, string preview)
    {
        string key = string.IsNullOrEmpty(dedupeKey) ? requestId : dedupeKey;
        lock (Open)
        {
            if (Open.ContainsKey(key)) return false;
            Open[key] = true;
        }
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
            form.FormBorderStyle = FormBorderStyle.FixedDialog;
            form.StartPosition = FormStartPosition.CenterScreen;
            form.MinimizeBox = false;
            form.MaximizeBox = false;
            // NO TASKBAR ENTRY, same standing rule as the Request Access dialog.
            form.ShowInTaskbar = false;
            form.TopMost = true;
            form.ClientSize = new Size(470, 322);

            Label head = new Label();
            // The em dash is a \u escape, not a literal: this .ps1 has no BOM, so
            // PowerShell 5.1 reads it in the system ANSI codepage and a literal
            // em dash would reach the label as mojibake.
            head.Text = "Sensitive data detected — " + app;
            head.Font = new Font(SystemFonts.MessageBoxFont.FontFamily, 10.5f, FontStyle.Bold);
            head.AutoEllipsis = true;
            head.SetBounds(14, 12, 442, 22);

            Label body = new Label();
            body.Text = "This message was not sent. It matched:";
            body.SetBounds(14, 38, 442, 18);

            Label chip = new Label();
            chip.Text = cats;
            chip.Font = new Font(SystemFonts.MessageBoxFont.FontFamily, 9f, FontStyle.Bold);
            chip.ForeColor = Color.FromArgb(178, 34, 34);
            chip.AutoEllipsis = true;
            chip.SetBounds(14, 58, 442, 18);

            Label previewLabel = new Label();
            // Same words the browser extension's own modal uses, so the desktop
            // and browser experiences read as one product.
            previewLabel.Text = "This is what gets sent";
            previewLabel.ForeColor = SystemColors.GrayText;
            previewLabel.SetBounds(14, 82, 442, 16);

            Label previewText = new Label();
            previewText.Text = shownPreview;
            previewText.BorderStyle = BorderStyle.FixedSingle;
            previewText.BackColor = Color.FromArgb(248, 248, 248);
            previewText.Padding = new Padding(6);
            previewText.SetBounds(14, 100, 442, 76);

            Label hint = new Label();
            hint.Text = "Tokenize & Send replaces each detected value with a fixed label such as "
                      + "[SSN] before sending. The original values are never sent, and cannot be "
                      + "recovered from the label.";
            // '&' in "Tokenize & Send" is literal text here, not an access key.
            hint.UseMnemonic = false;
            hint.SetBounds(14, 184, 442, 62);

            Label foot = new Label();
            foot.Text = "This event was reported to the security team.";
            foot.ForeColor = SystemColors.GrayText;
            foot.SetBounds(14, 250, 442, 16);

            Button tokenize = new Button();
            tokenize.Text = "Tokenize && Send";
            tokenize.SetBounds(316, 274, 140, 30);

            Button edit = new Button();
            edit.Text = "Edit manually";
            edit.SetBounds(206, 274, 104, 30);

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

            // "Edit manually" no longer just closes. It swaps this same window
            // over to the edit view — the user was otherwise sent back to the app
            // to retype a whole message from memory, which is what live testing
            // found people actually doing.
            edit.Click += delegate(object s, EventArgs e)
            {
                // FIRST, before anything visual and before this window takes the
                // foreground: tell the caller the edit box is opening, so the
                // enforcer's pin can be held. Correlation id only — no content.
                CfaiRequestDialog.Write("{\"kind\":\"tokenize_dialog_editing\""
                    + ",\"request_id\":\"" + CfaiRequestDialog.Esc(requestId) + "\""
                    + "}");

                expiry.Stop();

                body.Visible = false;
                chip.Visible = false;
                previewLabel.Visible = false;
                previewText.Visible = false;
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

            form.Controls.Add(head);
            form.Controls.Add(body);
            form.Controls.Add(chip);
            form.Controls.Add(previewLabel);
            form.Controls.Add(previewText);
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

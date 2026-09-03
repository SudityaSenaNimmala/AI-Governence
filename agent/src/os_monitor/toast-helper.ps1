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
#   {"cmd":"shutdown"}
#
# …and one JSON object per stdout line back:
#   {"kind":"ready","aumid":"CloudFuze.AIGovernance"}
#   {"kind":"pong"}
#   {"kind":"scrubbed"}
#   {"kind":"access_request_result","request_id":"…","action":"submit","reason":"…"}
#
# THIS PROCESS HAS NO VISIBLE WINDOW. It is spawned windowsHide:true and owns no
# tray icon, no taskbar entry and no standing UI. The ONE exception is the
# Request Access dialog below, which exists for the length of a single blocked
# send-attempt and closes on submit/cancel — see Show-CFAIRequestDialog.

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

    static string Esc(string s)
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
'@

# Compile failure must not take the toast helper down with it — toasts are the
# more important of the two jobs. $DialogReady false means show_request_dialog
# answers 'unavailable' and Node falls back to a toast that tells the user how
# to ask through the dashboard instead.
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
            'shutdown' { break }
            default    { [Console]::Error.WriteLine("unknown-cmd: $($cmd.cmd)") }
        }
    } catch {
        [Console]::Error.WriteLine("toast-error: $($_.Exception.Message)")
    }
}

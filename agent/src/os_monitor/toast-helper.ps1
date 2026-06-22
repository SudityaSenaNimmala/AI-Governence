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
#   {"cmd":"shutdown"}

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
Add-Type -AssemblyName System.Windows.Forms                # for narrow clipboard-scrub path

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

# Signal ready
[Console]::Out.WriteLine('{"kind":"ready","aumid":"' + $Aumid + '"}')
[Console]::Out.Flush()

# Main loop: blocking read on stdin, one JSON line per command.
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
            'ping'     { [Console]::Out.WriteLine('{"kind":"pong"}'); [Console]::Out.Flush() }
            'scrub_clipboard' {
                # Replace clipboard contents with a sanitized notice. STA
                # thread (set on the powershell.exe -Sta flag in notify.js)
                # is required for Windows Forms Clipboard access.
                try {
                    [System.Windows.Forms.Clipboard]::SetText($cmd.replacement)
                    [Console]::Out.WriteLine('{"kind":"scrubbed"}')
                    [Console]::Out.Flush()
                } catch {
                    [Console]::Error.WriteLine("scrub-failed: $($_.Exception.Message)")
                }
            }
            'shutdown' { break }
            default    { [Console]::Error.WriteLine("unknown-cmd: $($cmd.cmd)") }
        }
    } catch {
        [Console]::Error.WriteLine("toast-error: $($_.Exception.Message)")
    }
}

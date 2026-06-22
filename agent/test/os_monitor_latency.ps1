# Measures paste-to-toast latency. Same as os_monitor_e2e.ps1 but with timing.

param(
    [string]$Process = 'ChatGPT',
    [string]$ServerUrl = 'http://localhost:8787',
    [string]$AdminToken = 'dev-admin-token'
)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -Namespace E2E2 -Name Win32 -MemberDefinition @'
    [System.Runtime.InteropServices.DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(System.IntPtr hWnd);
    [System.Runtime.InteropServices.DllImport("user32.dll")]
    public static extern bool ShowWindow(System.IntPtr hWnd, int nCmdShow);
'@

$proc = Get-Process -Name $Process -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $proc) { "ERROR: no $Process window"; exit 1 }
"Focusing $Process pid=$($proc.Id)"
[void][E2E2.Win32]::ShowWindow($proc.MainWindowHandle, 9)
[void][E2E2.Win32]::SetForegroundWindow($proc.MainWindowHandle)
Start-Sleep -Milliseconds 800

$beforeTs = Get-Date
$payload = "SSN: 987-65-4321 and AWS key AKIAIOSFODNN7EXAMPLE - please review this customer record"
[System.Windows.Forms.Clipboard]::SetText($payload)
"Clipboard set at $($beforeTs.ToString('HH:mm:ss.fff')) - watch for toast..."

# Poll the server for the new event to land
$found = $null
$deadline = $beforeTs.AddSeconds(35)
while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 250
    $events = Invoke-RestMethod "$ServerUrl/api/v1/dlp?limit=5" -Headers @{ Authorization = "Bearer $AdminToken" }
    $found = $events | Where-Object {
        $_.source -eq 'os_monitor' -and
        $_.event_kind -eq 'prompt_paste' -and
        ([datetime]$_.occurred_at) -gt $beforeTs
    } | Select-Object -First 1
    if ($found) { break }
}

if ($found) {
    $occurredAt = [datetime]$found.occurred_at
    $detectionLagMs = [int]($occurredAt - $beforeTs).TotalMilliseconds
    "`n--- Event captured ---"
    "  paste->detect lag (poller tick):     $detectionLagMs ms"
    "  patterns:                            $($found.pattern_matched)"
    "  severity:                            $($found.secret_class)"
    "  source:                              $($found.source)"
} else {
    "ERROR: event never landed within 35s"
}

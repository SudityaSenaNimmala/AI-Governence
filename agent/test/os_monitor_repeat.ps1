# Test the new detection model:
#  Scenario A: copy sensitive content, focus ChatGPT, paste (fires)
#  Scenario B: paste same clipboard again into same ChatGPT (suppressed by dedup)
#  Scenario C: focus away to Notepad
#  Scenario D: focus back to ChatGPT (still within 30s dedup window - suppressed)
#  Scenario E: copy NEW content, focus ChatGPT (fires - new seq)
#
# We expect 2 server events: one for Scenario A, one for Scenario E.

param(
    [string]$ServerUrl = 'http://localhost:8787',
    [string]$AdminToken = 'dev-admin-token'
)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -Namespace Repeat -Name Win32 -MemberDefinition @'
    [System.Runtime.InteropServices.DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(System.IntPtr hWnd);
    [System.Runtime.InteropServices.DllImport("user32.dll")]
    public static extern bool ShowWindow(System.IntPtr hWnd, int nCmdShow);
'@

function Focus-Process([string]$name) {
    $p = Get-Process -Name $name -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
    if (-not $p) { return $false }
    [void][Repeat.Win32]::ShowWindow($p.MainWindowHandle, 9)
    [void][Repeat.Win32]::SetForegroundWindow($p.MainWindowHandle)
    return $true
}

$startTs = (Get-Date).ToUniversalTime()  # server stores UTC; compare like-with-like

"--- Scenario A: copy SSN, focus ChatGPT (should fire) ---"
if (-not (Focus-Process 'ChatGPT')) { "ERROR: no ChatGPT window"; exit 1 }
Start-Sleep -Milliseconds 600
[System.Windows.Forms.Clipboard]::SetText("SSN: 111-22-3333 employee record review please")
Start-Sleep -Seconds 2

"--- Scenario B: same clipboard, still ChatGPT (dedup should suppress) ---"
[System.Windows.Forms.Clipboard]::SetText("SSN: 111-22-3333 employee record review please")  # same content but new seq
Start-Sleep -Seconds 2

"--- Scenario C+D: switch to Notepad and back to ChatGPT (still within 30s - suppressed) ---"
# Open notepad
$np = Get-Process -Name notepad -ErrorAction SilentlyContinue
if (-not $np) { Start-Process notepad ; Start-Sleep -Seconds 1 ; $np = Get-Process -Name notepad | Select-Object -First 1 }
[void][Repeat.Win32]::SetForegroundWindow($np.MainWindowHandle)
Start-Sleep -Milliseconds 800
Focus-Process 'ChatGPT' | Out-Null
Start-Sleep -Seconds 2

"--- Scenario E: copy NEW content with different secret (should fire) ---"
[System.Windows.Forms.Clipboard]::SetText("AWS key AKIAIOSFODNN7EXAMPLE and credit card 4532015112830366")
Start-Sleep -Seconds 5    # give the reporter's debounced flush (2s) time to land

"`n=== Querying server for events since test started ($($startTs.ToString('HH:mm:ss'))) ==="
$events = Invoke-RestMethod "$ServerUrl/api/v1/dlp?limit=20" -Headers @{ Authorization = "Bearer $AdminToken" }
$matching = $events | Where-Object {
    $_.source -eq 'os_monitor' -and
    ([datetime]::Parse($_.occurred_at).ToUniversalTime()) -gt $startTs
} | Sort-Object occurred_at
"Events captured: $($matching.Count)  (expected: 2)"
$matching | Select-Object @{N='time';E={ ([datetime]$_.occurred_at).ToString('HH:mm:ss.fff') }}, ai_service, pattern_matched, secret_class | Format-Table -AutoSize

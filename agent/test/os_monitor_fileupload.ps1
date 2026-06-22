# E2E test for OS monitor file-upload detection via CF_HDROP.
#
# Setup:
#   1. Creates a temp .env file with fake secrets
#   2. Focuses the running ChatGPT Store window
#   3. Sets the clipboard to a file-drop list containing the .env path
#      (simulating "right-click file in Explorer -> Copy")
#   4. Polls the server for a new file_upload event with our test patterns
#
# Expected: source=os_monitor, kind=file_upload, file_class=env_file,
# severity=critical, content_scan.matches includes our fake patterns.

param(
    [string]$ServerUrl  = 'http://localhost:8787',
    [string]$AdminToken = 'dev-admin-token'
)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -Namespace FUTest -Name Win32 -MemberDefinition @'
    [System.Runtime.InteropServices.DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(System.IntPtr hWnd);
    [System.Runtime.InteropServices.DllImport("user32.dll")]
    public static extern bool ShowWindow(System.IntPtr hWnd, int nCmdShow);
'@

# 1) Build a fake .env file with secrets the patterns will match
$tempDir  = Join-Path $env:TEMP "cfai-fileupload-test"
New-Item -ItemType Directory -Path $tempDir -Force -ErrorAction SilentlyContinue | Out-Null
$envPath  = Join-Path $tempDir ".env.production"
@(
    "# Production secrets - DO NOT COMMIT",
    "OPENAI_API_KEY=sk-proj-test1234567890abcdefghijklmnopqrstuvwxyz",
    "AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE",
    "ADMIN_SSN=555-12-3456",
    "DB_PASSWORD=super-secret-pw-xyz"
) | Set-Content -Path $envPath -Encoding UTF8
"Created test file: $envPath ($((Get-Item $envPath).Length) bytes)"

$startTs = (Get-Date).ToUniversalTime()

# 2) Focus ChatGPT
$cg = Get-Process -Name ChatGPT -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $cg) { "ERROR: ChatGPT not running"; exit 1 }
[void][FUTest.Win32]::ShowWindow($cg.MainWindowHandle, 9)
[void][FUTest.Win32]::SetForegroundWindow($cg.MainWindowHandle)
Start-Sleep -Milliseconds 800
"Focused ChatGPT pid=$($cg.Id)"

# 3) Set CF_HDROP clipboard (file list, not text)
$paths = New-Object System.Collections.Specialized.StringCollection
$paths.Add($envPath) | Out-Null
[System.Windows.Forms.Clipboard]::SetFileDropList($paths)
"Clipboard set to CF_HDROP with 1 file"

# 4) Wait for capture + flush (debounce is 2s, give 5s headroom)
Start-Sleep -Seconds 6

"`n=== Querying server for new os_monitor file_upload events ==="
$events = Invoke-RestMethod "$ServerUrl/api/v1/dlp?limit=20" -Headers @{ Authorization = "Bearer $AdminToken" }
$matching = $events | Where-Object {
    $_.source -eq 'os_monitor' -and
    $_.event_kind -eq 'file_upload' -and
    ([datetime]::Parse($_.occurred_at).ToUniversalTime()) -gt $startTs
} | Sort-Object occurred_at

"Events captured: $($matching.Count)  (expected: 1)"
foreach ($e in $matching) {
    "---"
    "  time:        $(([datetime]::Parse($e.occurred_at).ToLocalTime()).ToString('HH:mm:ss.fff'))"
    "  ai_service:  $($e.ai_service)"
    "  file_class:  $($e.pattern_matched)"      # for file_upload events, pattern_matched holds file_class
    "  severity:    $($e.secret_class)"
    "  filename:    $($e.metadata.filename)"
    "  size:        $($e.metadata.size) bytes"
    if ($e.metadata.content_scan) {
        $cs = $e.metadata.content_scan
        "  scan via:    $($cs.via)"
        "  matchCount:  $($cs.matchCount)"
        "  matches:     $(($cs.matches | ForEach-Object { $_.pattern }) -join ', ')"
    }
}

# Clean up
Remove-Item $envPath -Force -ErrorAction SilentlyContinue

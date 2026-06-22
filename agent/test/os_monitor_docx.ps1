# E2E test: docx file containing API keys → CF_HDROP → server.
# Generates a real (not fake) .docx using Word automation, or falls back
# to a hand-built minimal docx if Word isn't installed.

param(
    [string]$ServerUrl  = 'http://localhost:8787',
    [string]$AdminToken = 'dev-admin-token'
)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

Add-Type -Namespace DocxTest -Name Win32 -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern bool SetForegroundWindow(System.IntPtr hWnd);
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern bool ShowWindow(System.IntPtr hWnd, int nCmdShow);
'@

# Build a properly-structured .docx via Node + JSZip. PowerShell's
# ZipFile.CreateFromDirectory uses backslashes for entry names on Windows
# which mammoth rejects ("Could not find main document part") — JSZip uses
# forward slashes as the zip spec requires.
$tempDir = Join-Path $env:TEMP "cfai-docx-test"
New-Item -ItemType Directory -Path $tempDir -Force -ErrorAction SilentlyContinue | Out-Null
$docxPath = Join-Path $tempDir "Customer_Credentials_Q4.docx"
Remove-Item $docxPath -Force -ErrorAction SilentlyContinue

$builderScript = "C:\Users\SatyaPinniti\OneDrive - CloudFuze, Inc\Desktop\agent team\agent\test\build-test-docx.mjs"
$null = & node $builderScript 2>&1
if (-not (Test-Path $docxPath)) { "ERROR: docx build failed"; exit 1 }
$size = (Get-Item $docxPath).Length
"Created test docx: $docxPath ($size bytes)"

$startTs = (Get-Date).ToUniversalTime()

# Focus Cursor
$cg = Get-Process -Name Cursor -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $cg) { "ERROR: Cursor not running"; exit 1 }
[void][DocxTest.Win32]::ShowWindow($cg.MainWindowHandle, 9)
[void][DocxTest.Win32]::SetForegroundWindow($cg.MainWindowHandle)
Start-Sleep -Milliseconds 800
"Focused Cursor pid=$($cg.Id)"

# CF_HDROP the docx
$paths = New-Object System.Collections.Specialized.StringCollection
$paths.Add($docxPath) | Out-Null
[System.Windows.Forms.Clipboard]::SetFileDropList($paths)
"Clipboard set to CF_HDROP with the docx"

# DOCX extraction takes longer than UTF-8 read; allow up to 15s
Start-Sleep -Seconds 8

"`n=== Querying server for new os_monitor docx events ==="
$events = Invoke-RestMethod "$ServerUrl/api/v1/dlp?limit=20" -Headers @{ Authorization = "Bearer $AdminToken" }
$matching = $events | Where-Object {
    $_.source -eq 'os_monitor' -and
    $_.event_kind -eq 'file_upload' -and
    $_.metadata.filename -match '\.docx$' -and
    ([datetime]::Parse($_.occurred_at).ToUniversalTime()) -gt $startTs
} | Sort-Object occurred_at

"Events captured: $($matching.Count)  (expected: 1)"
foreach ($e in $matching) {
    "---"
    "  ai_service:  $($e.ai_service)"
    "  filename:    $($e.metadata.filename)"
    "  file_class:  $($e.pattern_matched)"
    "  severity:    $($e.secret_class)"
    "  size:        $($e.metadata.size) bytes"
    if ($e.metadata.content_scan) {
        $cs = $e.metadata.content_scan
        "  scanned:     $($cs.scanned)"
        if ($cs.scanned) {
            "  via:         $($cs.via)"
            "  matchCount:  $($cs.matchCount)"
            "  matches:     $(($cs.matches | ForEach-Object { $_.pattern }) -join ', ')"
        } else {
            "  reason:      $($cs.reason)"
            "  error:       $($cs.error)"
        }
    }
}

Remove-Item $docxPath -Force -ErrorAction SilentlyContinue

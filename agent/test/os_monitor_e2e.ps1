# End-to-end smoke test for the OS monitor.
#   1. Finds the running ChatGPT process (any install method)
#   2. Brings its main window to foreground
#   3. Writes a string with an SSN + API key to the clipboard
#   4. Sleeps so the monitor's 500ms polling tick catches it
#   5. Queries the governance server and prints the most recent matching event

param(
    [string]$Process = 'ChatGPT',
    [string]$ServerUrl = 'http://localhost:8787',
    [string]$AdminToken = 'dev-admin-token'
)

Add-Type -AssemblyName System.Windows.Forms

Add-Type -Namespace E2E -Name Win32 -MemberDefinition @'
    [System.Runtime.InteropServices.DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(System.IntPtr hWnd);
    [System.Runtime.InteropServices.DllImport("user32.dll")]
    public static extern bool ShowWindow(System.IntPtr hWnd, int nCmdShow);
'@

$proc = Get-Process -Name $Process -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $proc) {
    "ERROR: no $Process process with a main window. Is the app running?"
    exit 1
}
"Found $Process pid=$($proc.Id) hWnd=$($proc.MainWindowHandle) title='$($proc.MainWindowTitle)'"

# Restore and focus
[void][E2E.Win32]::ShowWindow($proc.MainWindowHandle, 9)  # SW_RESTORE
[void][E2E.Win32]::SetForegroundWindow($proc.MainWindowHandle)
Start-Sleep -Milliseconds 800   # let the poller's 500ms tick register the focus change

$payload = "Customer SSN is 123-45-6789 and the OpenAI key sk-testXXXX1234567890abcdefghijklmnop. Please help."
[System.Windows.Forms.Clipboard]::SetText($payload)
"Clipboard set with sensitive payload (len=$($payload.Length))"

Start-Sleep -Seconds 2    # poller ticks once at 500ms, plus 80ms read delay, plus reporter latency

"`n=== Recent prompt events on server ==="
$resp = Invoke-RestMethod "$ServerUrl/api/v1/dlp?limit=10" -Headers @{ Authorization = "Bearer $AdminToken" }
$resp | Where-Object { $_.event_kind -eq 'prompt_paste' } | Select-Object -First 5 occurred_at, ai_service, source, event_kind, pattern_matched, secret_class | Format-List

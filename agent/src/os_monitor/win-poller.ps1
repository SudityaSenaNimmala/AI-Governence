# Long-running poller for the OS-level AI monitor.
#
# Polls every 500ms:
#   - Foreground window: which process owns it, its window title
#   - Clipboard sequence number: changed = clipboard was written since last tick
#
# Emits NDJSON on stdout (one event per line). Node reads + parses these.
#
# Must run STA so [System.Windows.Forms.Clipboard]::GetText() works:
#   powershell -NoProfile -Sta -File win-poller.ps1
#
# Output schema (one JSON object per stdout line):
#   {"t":"<ISO>","kind":"focus", "pid":1234, "process":"chatgpt", "title":"ChatGPT"}
#   {"t":"<ISO>","kind":"clipboard","pid":1234,"process":"chatgpt","title":"ChatGPT","text":"<full text>","seq":42}
#   {"t":"<ISO>","kind":"heartbeat","tick":N}
#   {"t":"<ISO>","kind":"error","message":"..."}
#
# We emit the full clipboard text — Node side runs the patterns and decides what
# to do. The text never leaves the local machine; only pattern names + counts
# are sent to the governance server.

$ErrorActionPreference = 'Stop'

# Suppress prompts and progress bars (we redirect to stdout, must stay clean)
$ProgressPreference = 'SilentlyContinue'
$WarningPreference  = 'SilentlyContinue'

Add-Type -AssemblyName System.Windows.Forms

Add-Type -Namespace CFAI -Name Win32 -MemberDefinition @'
    [System.Runtime.InteropServices.DllImport("user32.dll")]
    public static extern System.IntPtr GetForegroundWindow();

    [System.Runtime.InteropServices.DllImport("user32.dll", SetLastError=true)]
    public static extern uint GetWindowThreadProcessId(System.IntPtr hWnd, out uint lpdwProcessId);

    [System.Runtime.InteropServices.DllImport("user32.dll", CharSet=System.Runtime.InteropServices.CharSet.Auto, SetLastError=true)]
    public static extern int GetWindowText(System.IntPtr hWnd, System.Text.StringBuilder lpString, int nMaxCount);

    [System.Runtime.InteropServices.DllImport("user32.dll")]
    public static extern uint GetClipboardSequenceNumber();

    [System.Runtime.InteropServices.DllImport("user32.dll")]
    public static extern short GetAsyncKeyState(int vKey);
'@

function Emit-Json($obj) {
    # Compact single-line JSON; -Depth 5 is plenty for our shallow payloads.
    $line = $obj | ConvertTo-Json -Compress -Depth 5
    [Console]::Out.WriteLine($line)
    [Console]::Out.Flush()
}

# Per-hwnd cache: { hwnd_int = { pid; process; title; capturedAt } }
# Avoids re-running Get-Process (the slowest call) on every 200ms tick. The
# process name for a given window handle never changes during the window's
# lifetime, so caching by hwnd is safe.
$ForegroundCache = @{}

function Get-ForegroundInfo {
    $hwnd = [CFAI.Win32]::GetForegroundWindow()
    if ($hwnd -eq [System.IntPtr]::Zero) { return $null }
    $hwndKey = [int64]$hwnd

    # Window title can change (e.g. document name) — always re-read it; it's cheap.
    $sb = New-Object System.Text.StringBuilder 512
    [void][CFAI.Win32]::GetWindowText($hwnd, $sb, 512)
    $title = $sb.ToString()

    if ($ForegroundCache.ContainsKey($hwndKey)) {
        $cached = $ForegroundCache[$hwndKey]
        return [pscustomobject]@{
            pid     = $cached.pid
            process = $cached.process
            title   = $title
        }
    }

    # First time we see this hwnd — resolve owning process.
    $procId = 0
    [void][CFAI.Win32]::GetWindowThreadProcessId($hwnd, [ref]$procId)
    if ($procId -eq 0) { return $null }

    $proc = $null
    try { $proc = Get-Process -Id $procId -ErrorAction Stop } catch { return $null }

    $info = @{ pid = $procId; process = $proc.ProcessName }
    $ForegroundCache[$hwndKey] = $info
    return [pscustomobject]@{ pid = $procId; process = $proc.ProcessName; title = $title }
}

function Read-ClipboardText {
    try {
        if ([System.Windows.Forms.Clipboard]::ContainsText()) {
            return [System.Windows.Forms.Clipboard]::GetText()
        }
    } catch {
        # Clipboard access can transiently fail if another process has it locked.
        # We swallow and retry on the next tick.
        return $null
    }
    return $null
}

# Read CF_HDROP — the clipboard format set when the user does "Copy" on one
# or more files in Explorer. The user can then paste those files into an AI
# app's attach control (ChatGPT, Claude Desktop, etc.). We capture the list
# of paths so Node can classify + content-scan each one.
function Read-ClipboardFiles {
    try {
        if ([System.Windows.Forms.Clipboard]::ContainsFileDropList()) {
            $list = [System.Windows.Forms.Clipboard]::GetFileDropList()
            if ($list -and $list.Count -gt 0) {
                return @($list)
            }
        }
    } catch {
        return $null
    }
    return $null
}

# Tell Node we are alive and STA
Emit-Json @{
    t       = (Get-Date).ToUniversalTime().ToString('o')
    kind    = 'ready'
    pid     = $PID
    ps_edition = $PSVersionTable.PSEdition
    sta     = ([Threading.Thread]::CurrentThread.ApartmentState -eq 'STA')
}

$tick = 0
$lastSeq = [CFAI.Win32]::GetClipboardSequenceNumber()
$lastFocusKey = $null
# Paste-gesture edge tracking (see paste detection in the loop).
$lastVDown = $false
$lastInsDown = $false

while ($true) {
    $tick++
    try {
        $fg = Get-ForegroundInfo
        $focusKey = if ($fg) { "$($fg.pid)|$($fg.process)" } else { $null }
        $seq = [CFAI.Win32]::GetClipboardSequenceNumber()

        # Detect what changed since last tick.
        $focusChanged = ($focusKey -ne $lastFocusKey)
        $seqChanged   = ($seq -ne $lastSeq)

        # Emit focus event only when focus changes — bandwidth-friendly.
        if ($focusChanged -and $fg) {
            Emit-Json @{
                t       = (Get-Date).ToUniversalTime().ToString('o')
                kind    = 'focus'
                pid     = $fg.pid
                process = $fg.process
                title   = $fg.title
            }
        }

        # PASTE DETECTION — only sample the clipboard when the user actually
        # PASTES (Ctrl+V or Shift+Insert) while a window is focused. We do NOT
        # fire on a mere copy (seq change) or on refocusing an AI window that
        # happens to hold clipboard content — those produced notifications even
        # though nothing was pasted into the AI app, which is exactly the
        # false-positive behavior we're removing here. Node still filters the
        # emitted event down to AI processes before notifying.
        #
        # VK codes: CONTROL=0x11, SHIFT=0x10, V=0x56, INSERT=0x2D.
        # GetAsyncKeyState high bit (0x8000) = key currently down; low bit
        # (0x0001) = key was pressed since our previous call (catches a quick
        # tap that began and ended between two 200ms polls).
        $ctrlDown  = ([CFAI.Win32]::GetAsyncKeyState(0x11) -band 0x8000) -ne 0
        $shiftDown = ([CFAI.Win32]::GetAsyncKeyState(0x10) -band 0x8000) -ne 0
        $vState    = [CFAI.Win32]::GetAsyncKeyState(0x56)
        $insState  = [CFAI.Win32]::GetAsyncKeyState(0x2D)
        $vDownNow   = ($vState -band 0x8000) -ne 0
        $insDownNow = ($insState -band 0x8000) -ne 0
        $vEdge   = ((($vState -band 0x1) -ne 0) -or ($vDownNow -and -not $lastVDown))
        $insEdge = ((($insState -band 0x1) -ne 0) -or ($insDownNow -and -not $lastInsDown))
        $pasteGesture = (($ctrlDown -and $vEdge) -or ($shiftDown -and $insEdge))
        $lastVDown   = $vDownNow
        $lastInsDown = $insDownNow

        if ($pasteGesture -and $fg) {
            # Check both text AND file-drop formats — they're mutually
            # exclusive on the clipboard in practice (a copy operation sets
            # one or the other, not both).
            $text = Read-ClipboardText
            if ($text -and $text.Length -ge 4) {
                Emit-Json @{
                    t       = (Get-Date).ToUniversalTime().ToString('o')
                    kind    = 'clipboard'
                    pid     = $fg.pid
                    process = $fg.process
                    title   = $fg.title
                    seq     = $seq
                    text    = $text
                    len     = $text.Length
                    cause   = 'paste'
                }
            } else {
                $files = Read-ClipboardFiles
                if ($files -and $files.Count -gt 0) {
                    # CF_HDROP path — user copied files in Explorer then pasted
                    # into the AI app. Emit so Node can stat, classify, and
                    # (for text-readable files) scan contents.
                    Emit-Json @{
                        t       = (Get-Date).ToUniversalTime().ToString('o')
                        kind    = 'clipboard_files'
                        pid     = $fg.pid
                        process = $fg.process
                        title   = $fg.title
                        seq     = $seq
                        paths   = @($files)
                        count   = $files.Count
                        cause   = 'paste'
                    }
                }
            }
        }

        $lastSeq      = $seq
        $lastFocusKey = $focusKey

        # Heartbeat every ~30s (150 ticks x 200ms) so Node knows we're alive.
        if ($tick % 150 -eq 0) {
            Emit-Json @{
                t    = (Get-Date).ToUniversalTime().ToString('o')
                kind = 'heartbeat'
                tick = $tick
            }
        }
    } catch {
        Emit-Json @{
            t       = (Get-Date).ToUniversalTime().ToString('o')
            kind    = 'error'
            message = $_.Exception.Message
            where   = 'main_loop'
        }
    }

    Start-Sleep -Milliseconds 200
}

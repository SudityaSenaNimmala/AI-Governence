# Attachment-chip watcher.
#
# Catches drag-drop file uploads into AI windows — which our CF_HDROP path
# can't see (no clipboard write) and our OpenFileDialog watcher can't see
# (no separate dialog window). The insight: ChatGPT, Claude Desktop, Cursor
# etc. all show the dropped file's NAME as a UI chip below the prompt
# immediately. That accessible name is exposed via UI Automation.
#
# Mechanism: every 800ms, walk the focused AI window's UIA descendants and
# collect any element whose Name matches a filename pattern (*.ext). When
# the set of currently-shown filenames grows compared to the last tick AND
# the new filename has been recently modified in a common user dir,
# emit an attachment_appeared event with the resolved path.
#
# Node side then runs the standard content_scan on that file.
#
# Output schema (NDJSON on stdout):
#   {"kind":"ready","ai_processes":[...]}
#   {"kind":"attachment_appeared","process":"ChatGPT","filename":"foo.csv","path":"C:\\...\\foo.csv"}
#   {"kind":"heartbeat"}
#   {"kind":"error","message":"..."}

$ErrorActionPreference = 'Stop'
$ProgressPreference    = 'SilentlyContinue'

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

Add-Type -Namespace AttWatch -Name Win32 -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern System.IntPtr GetForegroundWindow();
[System.Runtime.InteropServices.DllImport("user32.dll", SetLastError=true)]
public static extern uint GetWindowThreadProcessId(System.IntPtr hWnd, out uint lpdwProcessId);
'@

$AiProcesses = if ($env:CFAI_AI_PROCESSES) {
    $env:CFAI_AI_PROCESSES -split ','
} else {
    @('ChatGPT', 'Claude', 'Cursor', 'Copilot', 'Comet', 'Gemini', 'Poe')
}

# Directories we'll search when resolving a filename → full path. Most user
# uploads come from one of these. We search by basename (no glob) so this
# stays cheap.
$SearchDirs = @(
    [Environment]::GetFolderPath('Desktop'),
    [Environment]::GetFolderPath('MyDocuments'),
    "$env:USERPROFILE\Downloads",
    "$env:USERPROFILE\OneDrive",
    "$env:USERPROFILE\OneDrive - CloudFuze, Inc"
) | Where-Object { $_ -and (Test-Path $_) }

# Extensions we care about — same set the Node-side classifier scans.
$FilenameRegex = '\.(?:env|csv|tsv|xlsx?|sql|sqlite|db|dump|bak|har|pdf|docx?|odt|rtf|pages|zip|7z|rar|tar|tar\.gz|tgz|json|ya?ml|toml|ini|conf|config|cfg|js|ts|tsx|jsx|mjs|cjs|py|rb|go|rs|java|cs|cpp|c|h|swift|kt|php|md|markdown|txt|log|html?|xml|pem|key|pfx|p12|jks|keystore|png|jpe?g|gif|webp|bmp|ico|svg)$'

function Emit-Json($obj) {
    $line = $obj | ConvertTo-Json -Compress -Depth 5
    [Console]::Out.WriteLine($line)
    [Console]::Out.Flush()
}

function Is-AiProcess([string]$name) {
    if (-not $name) { return $false }
    $base = $name -replace '\.exe$',''
    foreach ($p in $AiProcesses) { if ($base -ieq $p) { return $true } }
    return $false
}

function Get-ForegroundAiWindow {
    $hwnd = [AttWatch.Win32]::GetForegroundWindow()
    if ($hwnd -eq [System.IntPtr]::Zero) { return $null }
    $procId = 0
    [void][AttWatch.Win32]::GetWindowThreadProcessId($hwnd, [ref]$procId)
    if ($procId -eq 0) { return $null }
    $proc = $null
    try { $proc = Get-Process -Id $procId -ErrorAction Stop } catch { return $null }
    if (-not (Is-AiProcess $proc.ProcessName)) { return $null }
    try {
        $el = [System.Windows.Automation.AutomationElement]::FromHandle($hwnd)
        return [pscustomobject]@{ Element = $el; Process = $proc.ProcessName; Pid = $procId; Hwnd = $hwnd }
    } catch { return $null }
}

function Collect-FilenameLikeNames($element) {
    $names = New-Object System.Collections.Generic.HashSet[string]
    try {
        # Walk a bounded subtree — too deep can be expensive for huge windows.
        # AI windows are mostly Chrome_WidgetWin_1; a depth-limited walk is fine.
        $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
        $stack  = New-Object System.Collections.Generic.Stack[object]
        $stack.Push(@{ El = $element; Depth = 0 })
        while ($stack.Count -gt 0) {
            $cur = $stack.Pop()
            if ($cur.Depth -gt 25) { continue }   # cap depth
            $el = $cur.El
            try {
                $name = $null
                try { $name = $el.Current.Name } catch {}
                if ($name -and $name.Length -lt 260 -and $name -match $FilenameRegex) {
                    $names.Add($name) | Out-Null
                }
            } catch {}
            try {
                $child = $walker.GetFirstChild($el)
                while ($child) {
                    $stack.Push(@{ El = $child; Depth = ($cur.Depth + 1) })
                    $child = $walker.GetNextSibling($child)
                }
            } catch {}
        }
    } catch {}
    return $names
}

function Resolve-Path-ByBasename([string]$basename) {
    foreach ($dir in $SearchDirs) {
        $candidate = Join-Path $dir $basename
        if (Test-Path -LiteralPath $candidate -PathType Leaf) { return $candidate }
    }
    # Recursive search bounded to a couple known dirs (Downloads + Desktop)
    foreach ($dir in @([Environment]::GetFolderPath('Desktop'), "$env:USERPROFILE\Downloads")) {
        if (-not $dir -or -not (Test-Path $dir)) { continue }
        $hit = Get-ChildItem -LiteralPath $dir -Filter $basename -Recurse -ErrorAction SilentlyContinue -File | Select-Object -First 1
        if ($hit) { return $hit.FullName }
    }
    return $null
}

Emit-Json @{ kind = 'ready'; pid = $PID; ai_processes = $AiProcesses; search_dirs = $SearchDirs }

# Per-process previously-seen set, so we only emit on NEW filenames.
$Seen = @{}
$tick = 0
while ($true) {
    $tick++
    try {
        $fg = Get-ForegroundAiWindow
        if ($fg) {
            $current = Collect-FilenameLikeNames $fg.Element
            $prev = $Seen[$fg.Hwnd]
            if (-not $prev) { $prev = New-Object System.Collections.Generic.HashSet[string] }
            foreach ($name in $current) {
                if (-not $prev.Contains($name)) {
                    $resolved = Resolve-Path-ByBasename $name
                    if ($resolved) {
                        Emit-Json @{
                            t        = (Get-Date).ToUniversalTime().ToString('o')
                            kind     = 'attachment_appeared'
                            process  = $fg.Process
                            pid      = $fg.Pid
                            filename = $name
                            path     = $resolved
                        }
                    } else {
                        # Filename appeared but couldn't be resolved — still
                        # interesting; emit filename-only so the dashboard
                        # reflects something happened.
                        Emit-Json @{
                            t        = (Get-Date).ToUniversalTime().ToString('o')
                            kind     = 'attachment_appeared'
                            process  = $fg.Process
                            pid      = $fg.Pid
                            filename = $name
                            path     = $null
                        }
                    }
                }
            }
            $Seen[$fg.Hwnd] = $current
        }
        if ($tick % 50 -eq 0) {
            Emit-Json @{ t = (Get-Date).ToUniversalTime().ToString('o'); kind = 'heartbeat'; tick = $tick; tracked = $Seen.Count }
        }
    } catch {
        Emit-Json @{ t = (Get-Date).ToUniversalTime().ToString('o'); kind = 'error'; message = $_.Exception.Message }
    }
    Start-Sleep -Milliseconds 800
}

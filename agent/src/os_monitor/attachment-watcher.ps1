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
#   {"kind":"attachment_disappeared","process":"ChatGPT","filename":"foo.csv"}
#   {"kind":"heartbeat"}
#   {"kind":"error","message":"..."}
#
# Input schema (NDJSON on stdin), one command:
#   {"cmd":"host_arm","process":"ms-teams","state":"on"|"off"}
#       Temporarily add a HOST APP (Microsoft Teams) to the set of processes this
#       watcher looks at — see $ArmedHostProcs. Sent by index.js only while the
#       enforcer says a governed or blocked agent conversation is the open one,
#       and withdrawn the moment it stops saying so.

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

# ── Runtime-armed HOST APPS ─────────────────────────────────────────────────
#
# EMPTY AT STARTUP, always. $AiProcesses above is built by watcherProcessNames(),
# which deliberately excludes every `hostApp: true` catalog entry — Microsoft
# Teams — because a passive watcher on a company's chat client would see the
# filename of every attachment in every DM and channel. That exclusion is the
# privacy property of the host-app design and it is NOT relaxed here: this set is
# a SEPARATE one, $AiProcesses is never modified, and nothing puts a name in here
# except an explicit host_arm command from the Node side.
#
# index.js sends that command only while the enforcer's govstate says a governed
# or blocked agent conversation is the open one in that app, and sends "off" the
# instant it stops. So the window in which Teams is watched at all is exactly the
# window in which the org already asked for that conversation to be governed.
$ArmedHostProcs = New-Object 'System.Collections.Generic.HashSet[string]' -ArgumentList @([System.StringComparer]::OrdinalIgnoreCase)

# Non-blocking stdin. The main loop must keep polling UIA on its 800ms cadence,
# so it cannot sit in a blocking ReadLine() the way toast-helper.ps1's command
# loop does. One outstanding ReadLineAsync task, checked for completion each
# tick; a completed task with a null result means stdin closed (parent gone) and
# no further command can arrive.
$StdinReader = [Console]::In
$StdinPending = $null
function Read-StdinLine {
    if ($null -eq $script:StdinPending) { $script:StdinPending = $script:StdinReader.ReadLineAsync() }
    if (-not $script:StdinPending.IsCompleted) { return $null }
    $line = $script:StdinPending.Result
    $script:StdinPending = $null
    return $line
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
    # …OR a host app that is armed RIGHT NOW. Second set, checked second, and
    # $AiProcesses itself is untouched — so the default (unarmed) answer for
    # Microsoft Teams is still a flat no. See $ArmedHostProcs.
    if ($ArmedHostProcs.Contains($base)) { return $true }
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
# Which process each tracked hwnd belongs to. Kept alongside $Seen (rather than
# folded into it) purely to hold this change's diff down: it exists so an
# arm/disarm can drop the BASELINE for the app it concerns and nothing else.
$SeenProc = @{}

# Forget every baseline belonging to $proc.
#
# Run on BOTH host_arm transitions, and it is what stops the one false positive
# this feature could otherwise produce. $Seen is a per-hwnd snapshot of the
# filename-shaped elements the window showed last tick; ONE Teams window holds
# every conversation the user has open, so a baseline taken while an ungoverned
# conversation was on screen describes that conversation's chat history. Diffing
# a newly-governed conversation against it would report every filename in the new
# view as a brand-new attachment — files the user never touched, from a
# conversation nobody governed.
#
# Dropping it instead makes the next armed tick take a fresh SILENT baseline (the
# `-not $Seen.ContainsKey` seed step below), so only files attached from that
# point on are ever reported.
function Reset-Baseline([string]$proc) {
    if (-not $proc) { return }
    $stale = @($SeenProc.Keys | Where-Object { $SeenProc[$_] -ieq $proc })
    foreach ($h in $stale) { $Seen.Remove($h); $SeenProc.Remove($h) }
}

$tick = 0
while ($true) {
    $tick++
    # ── Drain stdin: host_arm, and nothing else ─────────────────────────────
    # Deliberately the only command this watcher accepts, and it carries only a
    # process name and an on/off — no path, no filename, no free text.
    while ($true) {
        $cmdLine = Read-StdinLine
        if ($null -eq $cmdLine) { break }
        $cmdLine = $cmdLine.Trim()
        if ($cmdLine.Length -eq 0) { continue }
        try {
            $cmd = $cmdLine | ConvertFrom-Json
            if ($cmd.cmd -eq 'host_arm' -and $cmd.process) {
                $procName = ([string]$cmd.process) -replace '\.exe$',''
                if ($cmd.state -eq 'on') {
                    $null = $ArmedHostProcs.Add($procName)
                } else {
                    $null = $ArmedHostProcs.Remove($procName)
                }
                Reset-Baseline $procName
            }
        } catch {
            Emit-Json @{ t = (Get-Date).ToUniversalTime().ToString('o'); kind = 'error'; message = 'bad stdin command' }
        }
    }
    try {
        $fg = Get-ForegroundAiWindow
        if ($fg) {
            $current = Collect-FilenameLikeNames $fg.Element
            # First time we ever see this hwnd (fresh watcher start, or a
            # window we haven't polled before): seed the baseline silently
            # instead of diffing against empty. Otherwise every restart
            # treats whatever filename-shaped chip already sits in chat
            # history (or a stuck composer attachment from a prior session)
            # as a brand-new attachment and fires a false attachment_appeared.
            if (-not $Seen.ContainsKey($fg.Hwnd)) {
                $Seen[$fg.Hwnd] = $current
                $SeenProc[$fg.Hwnd] = $fg.Process
                if ($tick % 50 -eq 0) {
                    Emit-Json @{ t = (Get-Date).ToUniversalTime().ToString('o'); kind = 'heartbeat'; tick = $tick; tracked = $Seen.Count }
                }
                Start-Sleep -Milliseconds 800
                continue
            }
            $prev = $Seen[$fg.Hwnd]
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
            # A filename that was present last tick and is gone this tick —
            # the user removed the attachment (or it scrolled out of the UIA
            # tree, a known false-disappear risk in a long chat; the Node
            # side's attachment-hold consumer treats this as best-effort
            # release, not proof the file is truly gone, since a stale hold
            # auto-expires via its own TTL regardless).
            foreach ($name in $prev) {
                if (-not $current.Contains($name)) {
                    Emit-Json @{
                        t        = (Get-Date).ToUniversalTime().ToString('o')
                        kind     = 'attachment_disappeared'
                        process  = $fg.Process
                        pid      = $fg.Pid
                        filename = $name
                    }
                }
            }
            $Seen[$fg.Hwnd] = $current
            $SeenProc[$fg.Hwnd] = $fg.Process
        }
        if ($tick % 50 -eq 0) {
            Emit-Json @{ t = (Get-Date).ToUniversalTime().ToString('o'); kind = 'heartbeat'; tick = $tick; tracked = $Seen.Count }
        }
    } catch {
        Emit-Json @{ t = (Get-Date).ToUniversalTime().ToString('o'); kind = 'error'; message = $_.Exception.Message }
    }
    Start-Sleep -Milliseconds 800
}

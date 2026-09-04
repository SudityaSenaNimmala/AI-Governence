# File-open dialog watcher.
#
# Detects when the user clicks "attach" / "upload" in an AI app, picks a
# file in the resulting Open File dialog, and confirms. Emits the selected
# file path(s) as NDJSON on stdout for the Node orchestrator to classify
# and content-scan.
#
# Mechanism: poll the desktop tree every 400ms looking for visible Win32
# common dialogs (classname '#32770') OR modern WinUI file pickers. When
# a matching dialog is owned by a process in our AI catalog, capture its
# current FileName edit text on every tick. When the dialog disappears,
# emit the last-captured path(s). Only emits if path looks like a file
# (drive letter prefix or UNC).
#
# Runs as a separate STA helper alongside win-poller.ps1. Output schema:
#   {"kind":"ready"}
#   {"kind":"file_dialog_pick","process":"ChatGPT","pid":1234,"path":"C:\\Users\\foo\\bar.csv"}
#   {"kind":"heartbeat","tick":N}
#   {"kind":"error","message":"..."}
#
# Input schema (NDJSON on stdin), one command:
#   {"cmd":"host_arm","process":"ms-teams","state":"on"|"off"}
#       Temporarily add a HOST APP (Microsoft Teams) to the set of processes
#       whose file pickers this watcher tracks — see $ArmedHostProcs and
#       $HostDisarmedAt.
#
# Limitations:
#   - WinUI 3 file pickers (modern XAML islands used by some Store apps)
#     don't expose their FileName edit via UIA. For those we still emit
#     a dialog_seen event so Node knows an upload likely happened.
#   - Drag-and-drop into a Store AI window from File Explorer is NOT
#     covered by this watcher (no dialog appears). CF_HDROP path in
#     win-poller.ps1 catches the "Copy then paste" variant.

$ErrorActionPreference = 'Stop'
$ProgressPreference    = 'SilentlyContinue'
$WarningPreference     = 'SilentlyContinue'

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

# Same AI process catalog as win-poller. We pass the JSON in via env var
# so we don't duplicate the list in two places.
$AiProcesses = if ($env:CFAI_AI_PROCESSES) {
    $env:CFAI_AI_PROCESSES -split ','
} else {
    @('ChatGPT', 'Claude', 'Cursor', 'Copilot', 'Comet', 'Gemini', 'Poe')
}

# ── Runtime-armed HOST APPS ─────────────────────────────────────────────────
#
# EMPTY AT STARTUP, always. See attachment-watcher.ps1's copy of this comment for
# the full reasoning: $AiProcesses comes from watcherProcessNames(), which
# excludes every `hostApp: true` entry, and that exclusion is not relaxed here —
# this is a SECOND set, armed only by an explicit host_arm command.
$ArmedHostProcs = New-Object 'System.Collections.Generic.HashSet[string]' -ArgumentList @([System.StringComparer]::OrdinalIgnoreCase)

# ── Why arming alone is not enough on THIS watcher ──────────────────────────
#
# A file picker STEALS FOCUS from the app that opened it. The enforcer decides
# "a governed agent conversation is open" from the focused ELEMENT of the
# foreground window, so the instant the picker appears that becomes false, a
# govstate(active:false) is emitted, and index.js sends host_arm off — all of it
# before this watcher has necessarily even observed the dialog once (it polls
# every 400ms; the enforcer every 150ms).
#
# Re-checking "is it armed?" at the CLOSE event is therefore always wrong: by
# then the answer is no, for every picker ever opened from Teams. What matters is
# whether the app was governed when the picker OPENED, so the arm state is
# latched onto the per-dialog $Tracked entry at the moment the dialog is first
# seen, and never consulted again for that dialog.
#
# HOST_ARM_GRACE_MS closes the last gap: "armed right now" can already be false
# by the first sighting, so a process counts as armed-for-a-new-dialog if it was
# disarmed within this window. The window is deliberately short — the disarm and
# the first sighting are at most a tick or two apart — and its only cost is that
# a picker opened in Teams within 5s of leaving a governed conversation is also
# tracked. Anything longer would start covering ordinary "send a colleague a
# file" pickers, which is not what the org asked to govern.
$HostDisarmedAt = @{}
$HOST_ARM_GRACE_MS = 5000

# Non-blocking stdin — same arrangement, and the same reason, as
# attachment-watcher.ps1: the poll loop cannot sit in a blocking ReadLine().
$StdinReader = [Console]::In
$StdinPending = $null
function Read-StdinLine {
    if ($null -eq $script:StdinPending) { $script:StdinPending = $script:StdinReader.ReadLineAsync() }
    if (-not $script:StdinPending.IsCompleted) { return $null }
    $line = $script:StdinPending.Result
    $script:StdinPending = $null
    return $line
}

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

# May a NEWLY-SEEN dialog owned by this process be tracked? True for an ordinary
# AI app (unchanged), and for a host app that is armed now or was armed within
# HOST_ARM_GRACE_MS. Consulted ONLY when a $Tracked entry is created.
function Is-HostArmedForNewDialog([string]$name) {
    if (-not $name) { return $false }
    $base = $name -replace '\.exe$',''
    if ($ArmedHostProcs.Contains($base)) { return $true }
    foreach ($k in $HostDisarmedAt.Keys) {
        if ($k -ieq $base) {
            $age = ([DateTime]::UtcNow - $HostDisarmedAt[$k]).TotalMilliseconds
            if ($age -ge 0 -and $age -le $HOST_ARM_GRACE_MS) { return $true }
        }
    }
    return $false
}

function Get-DialogFileNames($dialogElement) {
    # Walk the dialog tree looking for Edit / ComboBox controls whose
    # nearby label says "File name". Return any text we find.
    $candidates = New-Object System.Collections.Generic.List[string]
    try {
        $editCond = New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
            [System.Windows.Automation.ControlType]::Edit)
        $comboCond = New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
            [System.Windows.Automation.ControlType]::ComboBox)
        $orCond = New-Object System.Windows.Automation.OrCondition($editCond, $comboCond)
        $children = $dialogElement.FindAll([System.Windows.Automation.TreeScope]::Descendants, $orCond)
        foreach ($c in $children) {
            try {
                $vp = $null
                if ($c.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$vp)) {
                    $v = $vp.Current.Value
                    if ($v -and $v.Length -gt 2) { $candidates.Add($v) }
                }
            } catch {}
        }
    } catch {}
    return $candidates
}

function Looks-LikePath([string]$s) {
    if (-not $s) { return $false }
    # Match drive-letter path (C:\...) or UNC (\\server\share\...)
    return ($s -match '^[A-Za-z]:\\' -or $s -match '^\\\\')
}

# Signal ready
Emit-Json @{ kind = 'ready'; pid = $PID; ai_processes = $AiProcesses }

# Track open dialogs we've already seen so we emit at most once per dialog,
# at the moment it closes. Key: hwnd (int64). Value: hashtable with last
# captured FileName candidates and process info.
$Tracked = @{}
$tick = 0

while ($true) {
    $tick++
    # ── Drain stdin: host_arm, and nothing else ─────────────────────────────
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
                    $HostDisarmedAt.Remove($procName)
                } else {
                    $null = $ArmedHostProcs.Remove($procName)
                    # Stamped, not forgotten — the grace window above is measured
                    # from here. See $HostDisarmedAt.
                    $HostDisarmedAt[$procName] = [DateTime]::UtcNow
                }
            }
        } catch {
            Emit-Json @{ t = (Get-Date).ToUniversalTime().ToString('o'); kind = 'error'; message = 'bad stdin command' }
        }
    }
    try {
        $root = [System.Windows.Automation.AutomationElement]::RootElement

        # Find all top-level #32770 dialogs (Win32 common dialog class).
        $cond = New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::ClassNameProperty, '#32770')
        $dialogs = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $cond)

        $currentHwnds = New-Object System.Collections.Generic.HashSet[int64]

        foreach ($d in $dialogs) {
            try {
                $hwnd = [int64]$d.Current.NativeWindowHandle
                $currentHwnds.Add($hwnd) | Out-Null

                # Resolve owning process — if not an AI app, skip.
                $procId = $d.Current.ProcessId
                if (-not $procId) { continue }
                $proc = $null
                try { $proc = Get-Process -Id $procId -ErrorAction Stop } catch { continue }
                # An ALREADY-TRACKED dialog is never re-gated. Its arm state was
                # latched when it was first seen and the picker has held focus
                # ever since, so re-asking would only ever answer "no" — see
                # $HostDisarmedAt.
                $known = $Tracked.ContainsKey($hwnd)
                if (-not $known -and -not (Is-AiProcess $proc.ProcessName) `
                    -and -not (Is-HostArmedForNewDialog $proc.ProcessName)) { continue }

                # Capture current FileName text. We refresh every tick — the
                # last value seen before the dialog closes is what the user
                # confirmed.
                $names = Get-DialogFileNames $d
                $entry = $Tracked[$hwnd]
                if (-not $entry) {
                    $entry = @{
                        process = $proc.ProcessName
                        pid     = $procId
                        title   = $d.Current.Name
                        names   = @()
                        # WAS this dialog opened out of an armed host app? Latched
                        # here, at first sighting, and read nowhere except the
                        # emit below. False for every ordinary AI app, whose
                        # coverage does not depend on arming at all.
                        hostArmed = (-not (Is-AiProcess $proc.ProcessName))
                    }
                    $Tracked[$hwnd] = $entry
                }
                if ($names.Count -gt 0) { $entry.names = @($names) }
            } catch {
                # Dialog may have closed mid-traversal — ignore.
            }
        }

        # Detect dialogs that disappeared since last tick → user confirmed
        # or cancelled. Emit the last captured paths.
        $closedHwnds = @($Tracked.Keys | Where-Object { -not $currentHwnds.Contains($_) })
        foreach ($h in $closedHwnds) {
            $entry = $Tracked[$h]
            foreach ($n in $entry.names) {
                if (Looks-LikePath $n) {
                    Emit-Json @{
                        t       = (Get-Date).ToUniversalTime().ToString('o')
                        kind    = 'file_dialog_pick'
                        process = $entry.process
                        pid     = $entry.pid
                        title   = $entry.title
                        path    = $n
                        # The latched arm state, so the Node side knows this pick
                        # came from a host app's governed conversation rather than
                        # from an ordinary AI app — and can attribute it to the
                        # agent that was open, which it tracks itself.
                        host_armed = [bool]$entry.hostArmed
                    }
                }
            }
            $Tracked.Remove($h)
        }

        if ($tick % 75 -eq 0) {
            Emit-Json @{ t = (Get-Date).ToUniversalTime().ToString('o'); kind = 'heartbeat'; tick = $tick }
        }
    } catch {
        Emit-Json @{ t = (Get-Date).ToUniversalTime().ToString('o'); kind = 'error'; message = $_.Exception.Message }
    }

    Start-Sleep -Milliseconds 400
}

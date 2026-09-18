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
#   {"cmd":"host_arm","process":"ms-teams","state":"on"|"off","key":"<opaque>"}
#       Temporarily add a HOST APP (Microsoft Teams) to the set of processes
#       whose file pickers this watcher tracks — see $ArmedHostProcs and
#       $HostDisarmedAt. `key` is accepted and ignored here: this watcher holds no
#       per-conversation baseline to invalidate. It is on the command so both
#       watchers take the identical line — see attachment-watcher.ps1.
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

Add-Type -TypeDefinition @'
namespace FileDlgWatch {
  public class Win32 {
    [System.Runtime.InteropServices.DllImport("user32.dll")]
    public static extern System.IntPtr GetWindow(System.IntPtr hWnd, uint uCmd);
    [System.Runtime.InteropServices.DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(System.IntPtr hWnd, out uint lpdwProcessId);
  }
}
'@

# Same AI process catalog as win-poller. We pass the JSON in via env var
# so we don't duplicate the list in two places.
# The fallback is only reached if the wrapper failed to pass the env var, but it
# had drifted from watcherProcessNames(): 'M365Copilot' — the actual process name
# of the Microsoft 365 Copilot desktop app, and the one this whole path exists
# for — was missing, so a fallback run was blind to it.
$AiProcesses = if ($env:CFAI_AI_PROCESSES) {
    $env:CFAI_AI_PROCESSES -split ','
} else {
    @('ChatGPT', 'Claude', 'Cursor', 'Copilot', 'M365Copilot', 'Comet', 'Gemini', 'Poe')
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

# How often the poll loop says it is alive. Tick 1 always, then every Nth.
# Overridable so a test can prove liveness in seconds instead of the 30s the
# default cadence would take — see os-monitor-host-files.test.mjs.
$HeartbeatTicks = 75
if ($env:CFAI_WATCHER_HEARTBEAT_TICKS) {
    $n = 0
    if ([int]::TryParse($env:CFAI_WATCHER_HEARTBEAT_TICKS, [ref]$n) -and $n -gt 0) { $HeartbeatTicks = $n }
}

# Non-blocking stdin — same arrangement, and the same reason, as
# attachment-watcher.ps1: the poll loop cannot sit in a blocking read.
#
# And for the same reason it is NOT [Console]::In.ReadLineAsync(): that reader is
# a SyncTextReader whose ReadLineAsync is `Task.FromResult(ReadLine())`, so it
# blocks the caller and this loop's dialog scan never ran at all. See the long
# note in attachment-watcher.ps1. Console.OpenStandardInput() returns a
# __ConsoleStream that inherits the real Stream.ReadAsync, which does not.
$StdinStream  = [Console]::OpenStandardInput()
$StdinBuf     = New-Object byte[] 8192
$StdinPending = $null
$StdinAcc     = ''
$StdinLines   = New-Object 'System.Collections.Generic.Queue[string]'
$StdinClosed  = $false
function Read-StdinLine {
    if ($script:StdinLines.Count -gt 0) { return $script:StdinLines.Dequeue() }
    if ($script:StdinClosed) { return $null }
    if ($null -eq $script:StdinPending) {
        try { $script:StdinPending = $script:StdinStream.ReadAsync($script:StdinBuf, 0, $script:StdinBuf.Length) }
        catch { $script:StdinClosed = $true; return $null }
    }
    if (-not $script:StdinPending.IsCompleted) { return $null }
    $n = 0
    try { $n = $script:StdinPending.Result } catch { $script:StdinClosed = $true; $script:StdinPending = $null; return $null }
    $script:StdinPending = $null
    if ($n -le 0) { $script:StdinClosed = $true; return $null }
    $script:StdinAcc += [System.Text.Encoding]::UTF8.GetString($script:StdinBuf, 0, $n)
    while (($i = $script:StdinAcc.IndexOf("`n")) -ge 0) {
        $script:StdinLines.Enqueue($script:StdinAcc.Substring(0, $i))
        $script:StdinAcc = $script:StdinAcc.Substring($i + 1)
    }
    if ($script:StdinLines.Count -gt 0) { return $script:StdinLines.Dequeue() }
    return $null
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

# ── Who really owns this dialog? ────────────────────────────────────────────
#
# NOT the app, in the case that matters most. Microsoft 365 Copilot and Microsoft
# Teams are both WebView2 shells: M365Copilot.exe(9476) spawns
# msedgewebview2.exe(10940) as a direct child, and the file picker behind the
# paperclip button is an ordinary `<input type=file>` — which Chromium shows from
# its BROWSER process. So the #32770 that appears belongs to msedgewebview2, and
# the old `Is-AiProcess $proc.ProcessName` gate rejected it and `continue`d,
# every single time. That is not a theory: Windows itself records the executable
# that opened each common dialog in
#   HKCU\...\Explorer\ComDlg32\LastVisitedPidlMRU
# and on the box where this was diagnosed the most-recent entry was
# msedgewebview2.exe, written at the exact second the shell wrote Recent\Test.lnk
# and the picked .docx got its LastAccessTime.
#
# So resolve the governed app rather than assuming it opened the dialog itself:
#   1. the dialog's own process        — a plain native app (ChatGPT, Cursor)
#   2. the dialog's OWNER window       — a brokered picker (PickerHost.exe for a
#                                        packaged app) leaves the requesting
#                                        window as the modal owner
#   3. ancestors of 1, then of 2       — the WebView2 case above
# First hit wins, and the event is attributed to THAT process, not to the
# helper — index.js feeds ev.process straight to identifyAiProcess(), which
# answers null for 'msedgewebview2' and would drop the event anyway.
#
# Four hops, not unlimited: WebView2 is one hop, a packaged-app launcher shim is
# two, and stopping short keeps the walk from ever reaching services.exe and
# attributing some unrelated dialog to whatever sits above it. PIDs <= 4 are the
# Idle/System pseudo-processes and end the walk.
$PROC_WALK_MAX = 4

# Parent-PID lookups are a CIM round-trip, so they are memoised — but PIDs get
# recycled, so the cache is dropped wholesale on a cadence rather than trusted
# for the life of the process. Cheap either way: the walk only runs for a dialog
# whose own process is not already a governed app, and dialogs are rare.
$ParentPidCache = @{}
function Get-ParentProcessId([int]$processId) {
    if ($processId -le 4) { return 0 }
    if ($script:ParentPidCache.ContainsKey($processId)) { return $script:ParentPidCache[$processId] }
    $ppid = 0
    try {
        $ci = Get-CimInstance Win32_Process -Filter "ProcessId=$processId" -ErrorAction Stop
        if ($ci) { $ppid = [int]$ci.ParentProcessId }
    } catch {}
    $script:ParentPidCache[$processId] = $ppid
    return $ppid
}

function Get-ProcessNameById([int]$processId) {
    if ($processId -le 4) { return $null }
    try { return (Get-Process -Id $processId -ErrorAction Stop).ProcessName } catch { return $null }
}

function Get-OwnerWindowProcessId([int64]$hwnd) {
    if ($hwnd -eq 0) { return 0 }
    try {
        $owner = [FileDlgWatch.Win32]::GetWindow([System.IntPtr]$hwnd, 4)  # GW_OWNER
        if ($owner -eq [System.IntPtr]::Zero) { return 0 }
        $op = 0
        [void][FileDlgWatch.Win32]::GetWindowThreadProcessId($owner, [ref]$op)
        return [int]$op
    } catch { return 0 }
}

# Returns @{ Name; Pid; Catalog } for the governed app this dialog belongs to, or
# $null if it belongs to nothing we govern. `Catalog` is true for an ordinary AI
# app and false for an armed host app — the same distinction the old inline
# `hostArmed = (-not (Is-AiProcess ...))` drew, computed once here.
function Resolve-GovernedProcess([int64]$hwnd, [int]$procId) {
    $seeds = New-Object System.Collections.Generic.List[int]
    if ($procId -gt 4) { $seeds.Add($procId) }
    $ownerPid = Get-OwnerWindowProcessId $hwnd
    if ($ownerPid -gt 4 -and $ownerPid -ne $procId) { $seeds.Add($ownerPid) }

    foreach ($seed in $seeds) {
        $cur = $seed
        for ($hop = 0; $hop -le $PROC_WALK_MAX -and $cur -gt 4; $hop++) {
            $name = Get-ProcessNameById $cur
            if (-not $name) { break }
            if (Is-AiProcess $name) { return @{ Name = $name; Pid = $cur; Catalog = $true } }
            if (Is-HostArmedForNewDialog $name) { return @{ Name = $name; Pid = $cur; Catalog = $false } }
            $cur = Get-ParentProcessId $cur
        }
    }
    return $null
}

# ── Reading the picked file out of the dialog ───────────────────────────────
#
# The previous implementation asked for descendants whose CONTROL TYPE is Edit or
# ComboBox and read their ValuePattern. On Windows 11 that finds the file LIST's
# grid cells — 'Name', 'Status', 'Date modified', 'Type', 'Size' for every visible
# row, 41 of them in a measured run — and does not find the File name field at
# all. Verified by walking a real Open dialog: the field is
#
#   [Pane] aid='1090' cls='Static'       name='File name:'
#   [Pane] aid='1148' cls='ComboBoxEx32' name='Test'
#     [Pane] aid='1148' cls='ComboBox'   name=''
#       [Pane] aid='1148' cls='Edit'     name='Test'
#
# — ControlType **Pane**, not Edit, and it supports no ValuePattern, no
# TextPattern and no LegacyIAccessible pattern. Its text is readable ONLY from the
# Name property. AutomationId 1148 is the classic FileName control id and is what
# we match on instead; ValuePattern is still tried first for the dialogs that do
# expose it.
#
# Note also what the Name says: 'Test', not 'Test.docx' and never a full path.
# Explorer hides known extensions, and the folder lives somewhere else entirely —
# in the address breadcrumb (a ToolbarWindow32 named 'Address: C:\...\Desktop').
# So the old `Looks-LikePath` gate could not have passed either. Three
# independent defects, each sufficient on its own to emit nothing; none of them
# had ever been reached because the poll loop was wedged on a blocking stdin read
# until it was fixed.
$FILENAME_FIELD_ID = '1148'

# Returns @{ Names = List[string]; Folder = string }.
function Get-DialogSelection($dialogElement) {
    $result = @{ Names = (New-Object System.Collections.Generic.List[string]); Folder = '' }
    try {
        $idCond = New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::AutomationIdProperty, $FILENAME_FIELD_ID)
        $hits = $dialogElement.FindAll([System.Windows.Automation.TreeScope]::Descendants, $idCond)
        $raw = ''
        foreach ($h in $hits) {
            try {
                $v = $null
                $vp = $null
                try {
                    if ($h.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$vp)) { $v = $vp.Current.Value }
                } catch {}
                if (-not $v) { try { $v = $h.Current.Name } catch {} }
                # The ComboBoxEx32 and its inner Edit report the same text; the
                # bare ComboBox in between reports ''. Take the longest non-empty.
                if ($v -and $v.Length -gt $raw.Length) { $raw = $v }
            } catch {}
        }
        foreach ($n in (Split-FileNameField $raw)) { $result.Names.Add($n) | Out-Null }
    } catch {}

    # Folder, from the address breadcrumb. Matched on SHAPE, not on the English
    # word 'Address' — the Name is localised, so anything of the form
    # '<label>: <path>' (or a bare path) is accepted and only the path kept.
    try {
        $tbCond = New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::ClassNameProperty, 'ToolbarWindow32')
        $bars = $dialogElement.FindAll([System.Windows.Automation.TreeScope]::Descendants, $tbCond)
        foreach ($b in $bars) {
            try {
                $n = $b.Current.Name
                if (-not $n) { continue }
                $cand = $n -replace '^[^:]{0,40}:\s*', ''
                if (Looks-LikePath $cand) { $result.Folder = $cand; break }
                if (Looks-LikePath $n)    { $result.Folder = $n;    break }
            } catch {}
        }
    } catch {}
    return $result
}

# The File name field holds either one bare name, or several in quotes when the
# dialog is multi-select: "a.docx" "b.xlsx". Returns an array either way.
function Split-FileNameField([string]$raw) {
    $out = New-Object System.Collections.Generic.List[string]
    if (-not $raw) { return ,$out.ToArray() }
    $raw = $raw.Trim()
    if ($raw -match '"') {
        foreach ($m in [regex]::Matches($raw, '"([^"]+)"')) {
            $v = $m.Groups[1].Value.Trim()
            if ($v) { $out.Add($v) | Out-Null }
        }
    }
    if ($out.Count -eq 0 -and $raw.Length -gt 0) { $out.Add($raw) | Out-Null }
    return ,$out.ToArray()
}

# Turn what the field actually holds into a real path on disk, or $null.
#
# Three shapes, in order: an already-absolute path (typed or pasted); a name that
# joins onto the breadcrumb folder; and — the normal case, because Explorer hides
# known extensions — a name with its extension missing, which only resolves by
# globbing '<name>.*' in that folder. Emitting is gated on the result EXISTING, so
# a half-typed name in a dialog the user then cancelled reports nothing.
function Resolve-DialogPath([string]$folder, [string]$name) {
    if (-not $name) { return $null }
    if (Looks-LikePath $name) {
        if (Test-Path -LiteralPath $name -PathType Leaf) { return $name }
        # Absolute but extension-hidden, e.g. C:\...\Desktop\Test
        $parent = Split-Path -Parent $name
        $leaf   = Split-Path -Leaf $name
        return (Resolve-ByGlob $parent $leaf)
    }
    if (-not $folder) { return $null }
    $joined = Join-Path $folder $name
    if (Test-Path -LiteralPath $joined -PathType Leaf) { return $joined }
    return (Resolve-ByGlob $folder $name)
}

# '<basename>.*' in one folder. Exactly one match is the answer; several means the
# hidden extension is genuinely ambiguous (Test.docx AND Test.txt both sitting
# there), and the most recently written one is the best available guess — the
# dialog was showing the folder the user had just been browsing.
function Resolve-ByGlob([string]$folder, [string]$leaf) {
    if (-not $folder -or -not $leaf) { return $null }
    if ($leaf -match '[\*\?]') { return $null }
    try {
        if (-not (Test-Path -LiteralPath $folder -PathType Container)) { return $null }
        $hits = @(Get-ChildItem -LiteralPath $folder -Filter ($leaf + '.*') -File -ErrorAction SilentlyContinue)
        if ($hits.Count -eq 0) { return $null }
        if ($hits.Count -eq 1) { return $hits[0].FullName }
        return (($hits | Sort-Object LastWriteTime -Descending)[0]).FullName
    } catch { return $null }
}

# Enumerate the visible top-level Win32 common dialogs. Split out of the poll loop
# so the loop body can be lifted verbatim into a test harness with this one
# function stubbed — the same arrangement Get-ForegroundAiWindow gives
# attachment-watcher.ps1. See tests/helpers/file-dialog-poll-harness.ps1.
function Get-OpenCommonDialogs {
    $out = New-Object System.Collections.Generic.List[object]
    try {
        $root = [System.Windows.Automation.AutomationElement]::RootElement
        $cond = New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::ClassNameProperty, '#32770')
        $dialogs = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $cond)
        foreach ($d in $dialogs) {
            try {
                $out.Add([pscustomobject]@{
                    Hwnd      = [int64]$d.Current.NativeWindowHandle
                    ProcessId = [int]$d.Current.ProcessId
                    Title     = $d.Current.Name
                    Element   = $d
                }) | Out-Null
            } catch {}
        }
    } catch {}
    return ,$out
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
        # PID reuse would otherwise let a stale parent edge survive forever. See
        # $ParentPidCache.
        if ($tick % 500 -eq 0) { $ParentPidCache.Clear() }

        $dialogs = Get-OpenCommonDialogs
        $currentHwnds = New-Object System.Collections.Generic.HashSet[int64]

        foreach ($d in $dialogs) {
            try {
                $hwnd = [int64]$d.Hwnd
                $currentHwnds.Add($hwnd) | Out-Null
                if (-not $d.ProcessId) { continue }

                # An ALREADY-TRACKED dialog is never re-gated. Its arm state was
                # latched when it was first seen and the picker has held focus
                # ever since, so re-asking would only ever answer "no" — see
                # $HostDisarmedAt.
                $entry = $Tracked[$hwnd]
                if (-not $entry) {
                    # Resolve the governed app, which is NOT necessarily the
                    # dialog's own process — see Resolve-GovernedProcess.
                    $owner = Resolve-GovernedProcess $hwnd ([int]$d.ProcessId)
                    if (-not $owner) { continue }
                    $entry = @{
                        process = $owner.Name
                        pid     = $owner.Pid
                        title   = $d.Title
                        names   = @()
                        folder  = ''
                        # WAS this dialog opened out of an armed host app? Latched
                        # here, at first sighting, and read nowhere except the
                        # emit below. False for every ordinary AI app, whose
                        # coverage does not depend on arming at all.
                        hostArmed = (-not $owner.Catalog)
                    }
                    $Tracked[$hwnd] = $entry
                }

                # Capture the current selection. We refresh every tick — the last
                # value seen before the dialog closes is what the user confirmed.
                $sel = Get-DialogSelection $d.Element
                if ($sel.Names.Count -gt 0) { $entry.names = @($sel.Names) }
                if ($sel.Folder) { $entry.folder = $sel.Folder }
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
                # The field holds a bare, extension-hidden basename far more often
                # than a path, so the old `if (Looks-LikePath $n)` gate is now
                # inside Resolve-DialogPath, which reassembles it against the
                # breadcrumb folder and confirms the result exists on disk.
                $resolved = Resolve-DialogPath $entry.folder $n
                if ($resolved) {
                    Emit-Json @{
                        t       = (Get-Date).ToUniversalTime().ToString('o')
                        kind    = 'file_dialog_pick'
                        process = $entry.process
                        pid     = $entry.pid
                        title   = $entry.title
                        path    = $resolved
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

        # tick 1 as well as every 75th. `ready` proves the process started; only a
        # heartbeat proves THIS loop is running, and the SyncTextReader bug above
        # was invisible for exactly that reason — a helper wedged in the drain
        # loop said ready and then nothing, forever. The Node side logs the first
        # one, so "the poll loop never came up" is now a visible line rather than
        # an absence of lines.
        if ($tick -eq 1 -or $tick % $HeartbeatTicks -eq 0) {
            Emit-Json @{ t = (Get-Date).ToUniversalTime().ToString('o'); kind = 'heartbeat'; tick = $tick }
        }
    } catch {
        Emit-Json @{ t = (Get-Date).ToUniversalTime().ToString('o'); kind = 'error'; message = $_.Exception.Message }
    }

    Start-Sleep -Milliseconds 400
}

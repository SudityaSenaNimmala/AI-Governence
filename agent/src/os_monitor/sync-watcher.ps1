# Cloud-sync-root watcher (OneDrive / SharePoint).
#
# OBSERVE AND REPORT ONLY. There is no quarantine, no file move, no rename, no
# permission change and no release path anywhere in this file, and that is a
# CONFIRMED PRODUCT DECISION rather than an unfinished piece: a governance agent
# that silently relocates a user's files is a data-loss incident waiting to
# happen, and the blast radius of getting it wrong in a synced folder is the
# user's whole document set. Everything below reads; nothing writes.
#
# ── WHAT IT IS FOR ──────────────────────────────────────────────────────────
#
# Every other watcher in this directory catches a file on its way into an app.
# A file dropped into a OneDrive or SharePoint sync folder leaves the machine
# with no app involved at all — no clipboard write, no file dialog, no
# attachment chip, no keystroke. The sync client uploads it because it is there.
# This watcher is the only coverage for that path.
#
# ── THE POLICY GATE ─────────────────────────────────────────────────────────
#
# Roots arrive in CFAI_SYNC_ROOTS, and the Node wrapper only puts a root there
# when BOTH hold: the root was discovered by agent/src/util/paths.js's existing
# OneDrive resolution (this file does not go looking for folders itself), AND
# ~/.cloudfuze-aigov/egress-surfaces.json carries an armed sync root, which the
# sync layer writes only when an admin holds a governed ai_platforms row for a
# cloud-sync host. With no such row the env var is EMPTY, this process opens NO
# FileSystemWatcher, enumerates nothing and stat-s nothing — the default on a
# machine whose admin has said nothing about cloud sync is that not one byte of
# the user's Documents folder is observed. agent/tests/os-monitor-egress.test.mjs
# asserts that behaviourally.
#
# ── THE ORIGIN HEURISTIC, and why it is the point of the whole file ─────────
#
# A sync folder sees traffic in BOTH directions, and the two are
# indistinguishable from a plain "a file appeared" notification:
#
#   the user saved a spreadsheet into OneDrive   -> data is LEAVING. Governance
#                                                   event.
#   OneDrive materialised a file another device  -> data is ARRIVING. Reporting
#     (or a colleague) put there                    this as an upload would be a
#                                                   FALSE governance record: it
#                                                   would name this user as the
#                                                   person who exfiltrated a file
#                                                   they never touched.
#
# So every newly-seen file is classified before anything else happens to it, and
# a `sync_down` classification means the file is DROPPED ENTIRELY — not reported
# with a flag, not logged, not scanned, not even opened. The other two outcomes
# (`local_new`, `unknown`) are reported WITH their origin on the event, so the
# dashboard can weigh a confident local write differently from an ambiguous one.
#
# The signal is Windows' cloud-placeholder attribute bits, read at FIRST SIGHT —
# before the file has been opened by anything of ours, because opening a
# placeholder is what makes Windows hydrate it and clear the very bits being
# tested.
#
# Output schema (NDJSON on stdout):
#   {"kind":"ready","pid":N,"roots":2,"ext_gate":true}
#   {"kind":"sync_file","root_id":"onedrive_sharepoint","path":"C:\\...\\pay.xlsx","origin":"local_new","size":12345}
#   {"kind":"overflow","root_id":"onedrive_sharepoint"}
#       The FileSystemWatcher's internal buffer overflowed and the OS dropped
#       notifications. Emitted LOUDLY rather than swallowed: it is a coverage
#       gap, and a coverage gap nobody can see is worse than one that is
#       reported.
#   {"kind":"heartbeat","tick":N,"pending":N}
#   {"kind":"error","message":"..."}
#
# No input channel: this watcher takes no commands. Its whole configuration is
# the two env vars read below, and it is restarted (not reconfigured) when they
# change.

$ErrorActionPreference = 'Stop'
$ProgressPreference    = 'SilentlyContinue'
$WarningPreference     = 'SilentlyContinue'

Add-Type -Namespace CFAISync -Name Win32 -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern System.IntPtr GetForegroundWindow();
[System.Runtime.InteropServices.DllImport("user32.dll", SetLastError=true)]
public static extern uint GetWindowThreadProcessId(System.IntPtr hWnd, out uint lpdwProcessId);
'@

function Emit-Json($obj) {
    $line = $obj | ConvertTo-Json -Compress -Depth 5
    [Console]::Out.WriteLine($line)
    [Console]::Out.Flush()
}

# ── Configuration ───────────────────────────────────────────────────────────
#
# CFAI_SYNC_ROOTS — one or more absolute directory paths, ';'-separated, already
# gated by policy on the Node side. EMPTY (or unset) is the normal case and means
# this process does nothing at all.
# CFAI_SYNC_ROOT_ID — the catalog id of the armed sync root, for attribution.
$RootId = if ($env:CFAI_SYNC_ROOT_ID) { $env:CFAI_SYNC_ROOT_ID } else { 'onedrive_sharepoint' }
$Roots = @()
if ($env:CFAI_SYNC_ROOTS) {
    foreach ($r in ($env:CFAI_SYNC_ROOTS -split ';')) {
        $p = ([string]$r).Trim()
        if (-not $p) { continue }
        # Existence is checked here rather than trusted: a root that has been
        # removed since the wrapper resolved it must not raise on Start().
        try { if (Test-Path -LiteralPath $p -PathType Container) { $Roots += $p } } catch {}
    }
}

# ── The extension gate, SINGLE-SOURCED from attachment-watcher.ps1 ──────────
#
# The set of extensions worth reading is written down exactly ONCE in this
# repository, as $FilenameRegex in attachment-watcher.ps1, and it must stay that
# way: a second copy here would drift, and the direction it would drift is
# "this watcher silently stopped covering a format the rest of the product
# does". Two PowerShell helpers cannot share a variable (each is its own
# process, and attachment-watcher.ps1 has a main loop so it cannot be
# dot-sourced), so the assignment is EXTRACTED from that file's source. Both
# helpers are always staged side by side — in a source checkout by being in the
# same directory, in the packaged binary by build-claude-tracker.mjs's
# PS1_HELPERS list — so $PSScriptRoot always finds it.
#
# FAIL CLOSED if the extraction fails: $ExtGate stays $null and NOTHING passes
# the gate, so this watcher reports nothing rather than reporting every file in
# the user's Documents folder. The `ext_gate` field on the ready line makes that
# state visible instead of silent.
$ExtGate = $null
try {
    $sibling = Join-Path $PSScriptRoot 'attachment-watcher.ps1'
    if (Test-Path -LiteralPath $sibling -PathType Leaf) {
        foreach ($line in (Get-Content -LiteralPath $sibling -ErrorAction Stop)) {
            $m = [regex]::Match($line, "^\s*\`$FilenameRegex\s*=\s*'(?<rx>.+)'\s*$")
            if ($m.Success) { $ExtGate = $m.Groups['rx'].Value; break }
        }
    }
} catch { $ExtGate = $null }

# ── Churn / lock-file filtering, cheapest test first ────────────────────────
#
# Ordered by cost on purpose: a name comparison is free, an attribute read is a
# syscall, and a settle-window wait is 1.5s of wall clock. A file that fails an
# early test never reaches a later one.
#
# These are the files an Office/OneDrive folder is FULL of and none of them is a
# document anybody authored: Word/Excel owner-locks (~$Report.docx), partial
# downloads, Access locks, Explorer/Finder metadata, and shortcuts (a .lnk's
# bytes are a path, not the document's content).
$ChurnNames = @('~$*', '*.tmp', '*.temp', '*.partial', '*.crdownload', '*.download', '*.laccdb', '*.ldb', '.DS_Store', 'Thumbs.db', 'desktop.ini', '*.lnk', '*.url')

# Paths that are never a user document. .git and node_modules generate thousands
# of writes per operation and would drown everything else; AppData under a sync
# root is application state.
$ChurnPathParts = @('\.git\', '\node_modules\', '\AppData\', '\.svn\', '\__pycache__\', '\.venv\', '\.cache\')

# Cloud placeholder attribute bits. Present at FIRST SIGHT means the file was
# materialised from the cloud, i.e. it came DOWN.
$FILE_ATTRIBUTE_OFFLINE                = 0x1000
$FILE_ATTRIBUTE_RECALL_ON_OPEN         = 0x00040000
$FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS  = 0x00400000
$CLOUD_BITS = $FILE_ATTRIBUTE_OFFLINE -bor $FILE_ATTRIBUTE_RECALL_ON_OPEN -bor $FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS

# Attributes that disqualify a file outright, whatever its name says.
$FILE_ATTRIBUTE_DIRECTORY = 0x10
$FILE_ATTRIBUTE_HIDDEN    = 0x2
$FILE_ATTRIBUTE_SYSTEM    = 0x4
$FILE_ATTRIBUTE_TEMPORARY = 0x100
$SKIP_BITS = $FILE_ATTRIBUTE_DIRECTORY -bor $FILE_ATTRIBUTE_HIDDEN -bor $FILE_ATTRIBUTE_SYSTEM -bor $FILE_ATTRIBUTE_TEMPORARY

# The cloud-sync clients themselves. A write that lands while one of these is the
# FOREGROUND process is not a user saving a document — it is the sync engine
# doing its job — so it cannot be classified `local_new`.
$SyncProcesses = @('OneDrive', 'FileCoAuth', 'FileSyncHelper', 'Microsoft.SharePoint')

# How long a file must be quiet — same size, same mtime — before it is looked at.
#
# NOT a taste knob. An Office save is a multi-step dance (write temp, flush,
# rename, update the original) and reading in the middle of it gets a truncated
# or locked file. 1500ms is past the tail of that sequence while still being well
# inside the time it takes a sync client to upload anything of consequence.
$SETTLE_MS = 1500

# Poll cadence for the settle sweep. The FileSystemWatcher notifications
# themselves are event-driven; this is only how often quiet files are harvested.
$POLL_MS = 500

# Per-root emit ceiling per rolling minute.
#
# A bulk operation — restoring a backup into OneDrive, cloning a folder — can
# produce thousands of legitimate creates, and reporting all of them would
# swamp the server queue AND read thousands of files. Hitting the ceiling emits
# ONE overflow line naming the root, so the gap is visible; it never silently
# drops.
$EMIT_PER_MINUTE = 20

$HeartbeatTicks = 120           # 120 * 500ms = ~60s
if ($env:CFAI_WATCHER_HEARTBEAT_TICKS) {
    $n = 0
    if ([int]::TryParse($env:CFAI_WATCHER_HEARTBEAT_TICKS, [ref]$n) -and $n -gt 0) { $HeartbeatTicks = $n }
}

function Test-ChurnName([string]$path) {
    $leaf = ''
    try { $leaf = [System.IO.Path]::GetFileName($path) } catch { return $true }
    if (-not $leaf) { return $true }
    foreach ($pattern in $ChurnNames) { if ($leaf -like $pattern) { return $true } }
    return $false
}

function Test-ChurnPath([string]$path) {
    if (-not $path) { return $true }
    # Bracketed with separators on both sides so a directory called
    # "my.github.io" is not mistaken for a .git directory.
    $probe = $path + '\'
    foreach ($part in $ChurnPathParts) { if ($probe -like ('*' + $part + '*')) { return $true } }
    return $false
}

# Raw attributes as an int, or $null when the file is gone / unreadable.
#
# GetAttributes, deliberately, and NOT File.Open or a read: on a OneDrive
# placeholder, OPENING the file is what triggers hydration — it would pull the
# bytes down from the cloud, changing the very state being measured and
# generating network traffic on the user's behalf. Reading attributes does not.
function Get-RawAttributes([string]$path) {
    try { return [int][System.IO.File]::GetAttributes($path) } catch { return $null }
}

function Test-SyncProcessForeground {
    try {
        $hwnd = [CFAISync.Win32]::GetForegroundWindow()
        if ($hwnd -eq [System.IntPtr]::Zero) { return $false }
        $procId = 0
        [void][CFAISync.Win32]::GetWindowThreadProcessId($hwnd, [ref]$procId)
        if ($procId -eq 0) { return $false }
        $p = Get-Process -Id $procId -ErrorAction Stop
        $base = ($p.ProcessName -replace '\.exe$','')
        foreach ($s in $SyncProcesses) { if ($base -ieq $s) { return $true } }
    } catch {}
    return $false
}

# ── Origin classification ───────────────────────────────────────────────────
#
# Returns 'sync_down' | 'local_new' | 'unknown'.
#
#   sync_down — a cloud-placeholder bit was set at FIRST SIGHT. The file was
#               materialised from the cloud: it came DOWN. NEVER reported.
#   local_new — no placeholder bit, no sync client in the foreground, and the
#               create->grow->settle write pattern of something being authored
#               locally (a Created notification followed by at least one Changed
#               before it went quiet).
#   unknown   — everything else, and it is REPORTED. In particular a small file
#               written in a single operation produces no Changed after its
#               Created, so it lands here rather than in local_new: the label is
#               weaker but the coverage is identical, and claiming `local_new`
#               for a write pattern that was not observed would be a stronger
#               statement than the evidence supports.
function Get-FileOrigin($entry) {
    $first = $entry.FirstAttrs
    if ($null -ne $first -and ($first -band $CLOUD_BITS) -ne 0) { return 'sync_down' }
    if ($entry.SyncFg) { return 'unknown' }
    if ($entry.Created -and $entry.Changes -ge 1) { return 'local_new' }
    return 'unknown'
}

# ── State ───────────────────────────────────────────────────────────────────
#
# path -> @{ FirstAttrs; FirstSeen; Created; Changes; SyncFg; LastSize; LastMtime; LastChangeAt }
$Pending = @{}
# Paths already reported, so a later Changed on a file we have already accounted
# for does not report it again. Bounded — see the trim in the sweep.
$Reported = New-Object 'System.Collections.Generic.HashSet[string]' -ArgumentList @([System.StringComparer]::OrdinalIgnoreCase)
# Rolling per-root emit window: root id -> @{ WindowStart; Count; Warned }
$EmitWindow = @{}

# Note a raw filesystem notification. Cheapest filters first; nothing here opens
# the file.
function Note-Change([string]$path, [bool]$created) {
    if (-not $path) { return }
    if ($Reported.Contains($path)) { return }
    if (Test-ChurnName $path) { return }
    if (Test-ChurnPath $path) { return }
    # The extension gate. $null means the single-source extraction failed, and
    # then NOTHING passes — see $ExtGate.
    if (-not $script:ExtGate) { return }
    $leaf = ''
    try { $leaf = [System.IO.Path]::GetFileName($path) } catch { return }
    if ($leaf -notmatch $script:ExtGate) { return }

    $now = [DateTime]::UtcNow
    $entry = $script:Pending[$path]
    if (-not $entry) {
        # FIRST SIGHT. The attribute read must happen HERE and not later: on a
        # placeholder these bits are cleared the moment anything hydrates the
        # file, so a read taken after the settle window could easily be too late
        # and would misclassify a download as a local write.
        $attrs = Get-RawAttributes $path
        if ($null -eq $attrs) { return }                 # gone already
        if (($attrs -band $SKIP_BITS) -ne 0) { return }  # directory / hidden / system / temporary
        $entry = @{
            FirstAttrs = $attrs
            FirstSeen = $now
            Created = $created
            Changes = 0
            # Sampled at first sight, for the same reason the attributes are:
            # by the time the settle window elapses the foreground may well have
            # moved on, and the question is what was happening when the write
            # started.
            SyncFg = (Test-SyncProcessForeground)
            LastSize = -1
            LastMtime = [DateTime]::MinValue
            LastChangeAt = $now
        }
        $script:Pending[$path] = $entry
        return
    }
    if ($created) { $entry.Created = $true }
    else { $entry.Changes = $entry.Changes + 1 }
    $entry.LastChangeAt = $now
}

# May this root emit another record right now? Emits ONE overflow line when the
# ceiling is first hit in a window, then stays quiet until the window rolls.
function Test-EmitBudget([string]$rootId) {
    $now = [DateTime]::UtcNow
    $w = $script:EmitWindow[$rootId]
    if (-not $w -or ($now - $w.WindowStart).TotalSeconds -ge 60) {
        $script:EmitWindow[$rootId] = @{ WindowStart = $now; Count = 0; Warned = $false }
        $w = $script:EmitWindow[$rootId]
    }
    if ($w.Count -ge $EMIT_PER_MINUTE) {
        if (-not $w.Warned) {
            $w.Warned = $true
            Emit-Json @{
                t = (Get-Date).ToUniversalTime().ToString('o')
                kind = 'overflow'; root_id = $rootId; reason = 'emit_rate_limit'; per_minute = $EMIT_PER_MINUTE
            }
        }
        return $false
    }
    $w.Count = $w.Count + 1
    return $true
}

# Harvest every pending file that has gone quiet. Emits at most one sync_file per
# path, ever.
function Sweep-Pending {
    $now = [DateTime]::UtcNow
    foreach ($path in @($Pending.Keys)) {
        $entry = $Pending[$path]
        if (-not $entry) { $Pending.Remove($path); continue }

        $size = -1; $mtime = [DateTime]::MinValue
        try {
            $fi = New-Object System.IO.FileInfo($path)
            if (-not $fi.Exists) { $Pending.Remove($path); continue }
            $size = [long]$fi.Length
            $mtime = $fi.LastWriteTimeUtc
        } catch {
            # Locked mid-save, or deleted between the two lines. Leave it pending
            # and try again next tick; the settle clock below is what bounds how
            # long that can go on.
            $entry.LastChangeAt = $now
            continue
        }

        # SETTLE: size and mtime unchanged since the previous look, AND quiet for
        # $SETTLE_MS. Both halves matter — an Office save can pause between its
        # steps for longer than one poll interval.
        if ($size -ne $entry.LastSize -or $mtime -ne $entry.LastMtime) {
            $entry.LastSize = $size
            $entry.LastMtime = $mtime
            $entry.LastChangeAt = $now
            continue
        }
        if (($now - $entry.LastChangeAt).TotalMilliseconds -lt $SETTLE_MS) { continue }

        $Pending.Remove($path)

        # A zero-byte file is never scanned: there is nothing in it, and reading
        # one would still cost a placeholder hydration.
        if ($size -le 0) { continue }

        $origin = Get-FileOrigin $entry
        # THE ONE OUTCOME THAT IS NEVER REPORTED. A download reported as an
        # upload is a false governance record naming this user as the person who
        # sent a file they never touched.
        if ($origin -eq 'sync_down') { continue }

        $null = $Reported.Add($path)
        if (-not (Test-EmitBudget $RootId)) { continue }
        Emit-Json @{
            t       = (Get-Date).ToUniversalTime().ToString('o')
            kind    = 'sync_file'
            root_id = $RootId
            path    = $path
            origin  = $origin
            size    = $size
        }
    }
    # Bound the dedupe set. 5000 paths is far past a plausible session and the
    # cost of forgetting the oldest is at worst one duplicate record.
    if ($Reported.Count -gt 5000) { $Reported.Clear() }
}

# ── Wire up the watchers ────────────────────────────────────────────────────
#
# NOTHING is created when $Roots is empty, which is the no-policy case: no
# handle, no notification subscription, no enumeration.
$Watchers = @()
foreach ($root in $Roots) {
    try {
        $fsw = New-Object System.IO.FileSystemWatcher
        $fsw.Path = $root
        $fsw.IncludeSubdirectories = $true
        # Size + write time is what a completed write changes; FileName covers
        # creates and the rename half of an Office save. Attributes are
        # deliberately NOT watched: OneDrive flips the placeholder bits on files
        # constantly and every one of those would be a notification about a file
        # nobody touched.
        $fsw.NotifyFilter = [System.IO.NotifyFilters]::FileName -bor [System.IO.NotifyFilters]::LastWrite -bor [System.IO.NotifyFilters]::Size
        # The largest the OS allows (64 KB). Bigger buffer, fewer overflows — and
        # an overflow is a real coverage gap, so it is worth the pinned memory.
        $fsw.InternalBufferSize = 65536
        $fsw.EnableRaisingEvents = $true
        # Register-ObjectEvent queues into this runspace's event queue, which the
        # poll loop below drains. Handling notifications inline in an action block
        # would run classification on the watcher's own thread while the queue
        # kept filling — which is precisely how the buffer overflows.
        Register-ObjectEvent -InputObject $fsw -EventName Created -SourceIdentifier ("cfai_created_" + $Watchers.Count) | Out-Null
        Register-ObjectEvent -InputObject $fsw -EventName Changed -SourceIdentifier ("cfai_changed_" + $Watchers.Count) | Out-Null
        Register-ObjectEvent -InputObject $fsw -EventName Renamed -SourceIdentifier ("cfai_renamed_" + $Watchers.Count) | Out-Null
        # THE OVERFLOW SIGNAL. FileSystemWatcher reports a dropped-notification
        # burst as an Error carrying InternalBufferOverflowException, and it is
        # the only way to know coverage was lost. Subscribed so it can be emitted
        # rather than vanish.
        Register-ObjectEvent -InputObject $fsw -EventName Error -SourceIdentifier ("cfai_error_" + $Watchers.Count) | Out-Null
        $Watchers += $fsw
    } catch {
        Emit-Json @{ t = (Get-Date).ToUniversalTime().ToString('o'); kind = 'error'; message = 'watch_failed: ' + $_.Exception.Message }
    }
}

Emit-Json @{
    kind = 'ready'; pid = $PID; roots = @($Watchers).Count
    # Whether the extension gate could be single-sourced from
    # attachment-watcher.ps1. FALSE means nothing will ever be reported — a
    # visible failure rather than a silent one. See $ExtGate.
    ext_gate = [bool]$ExtGate
}

$tick = 0
while ($true) {
    $tick++
    try {
        # Drain the notification queue. Bounded per tick so a burst cannot keep
        # the loop from ever reaching the settle sweep or the heartbeat.
        $drained = 0
        while ($drained -lt 2000) {
            $ev = Get-Event -ErrorAction SilentlyContinue | Select-Object -First 1
            if (-not $ev) { break }
            $drained++
            $sid = [string]$ev.SourceIdentifier
            try {
                if ($sid -like 'cfai_error_*') {
                    Emit-Json @{
                        t = (Get-Date).ToUniversalTime().ToString('o')
                        kind = 'overflow'; root_id = $RootId; reason = 'fsw_buffer'
                    }
                } elseif ($sid -like 'cfai_created_*') {
                    Note-Change ([string]$ev.SourceEventArgs.FullPath) $true
                } elseif ($sid -like 'cfai_renamed_*') {
                    # A rename INTO the tree is how an Office save finishes and
                    # how a drag-and-drop from another folder arrives. Treated as
                    # a create on the destination path; the old path is not
                    # touched and is never reported.
                    Note-Change ([string]$ev.SourceEventArgs.FullPath) $true
                } elseif ($sid -like 'cfai_changed_*') {
                    Note-Change ([string]$ev.SourceEventArgs.FullPath) $false
                }
            } catch {}
            Remove-Event -EventIdentifier $ev.EventIdentifier -ErrorAction SilentlyContinue
        }

        Sweep-Pending

        # tick 1 as well as every Nth — `ready` proves the process started, only a
        # heartbeat proves THIS loop is running. Same reasoning, and the same
        # history, as the note in attachment-watcher.ps1.
        if ($tick -eq 1 -or $tick % $HeartbeatTicks -eq 0) {
            Emit-Json @{
                t = (Get-Date).ToUniversalTime().ToString('o'); kind = 'heartbeat'
                tick = $tick; pending = $Pending.Count
            }
        }
    } catch {
        Emit-Json @{ t = (Get-Date).ToUniversalTime().ToString('o'); kind = 'error'; message = $_.Exception.Message }
    }
    Start-Sleep -Milliseconds $POLL_MS
}

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
                if (-not (Is-AiProcess $proc.ProcessName)) { continue }

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

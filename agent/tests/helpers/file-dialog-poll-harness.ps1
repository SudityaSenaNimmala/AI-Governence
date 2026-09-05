# Behavioural harness for file-dialog-watcher.ps1's POLL LOOP.
#
# Sibling to attachment-poll-harness.ps1, same construction and the same reason:
# it lifts the loop BODY VERBATIM out of the .ps1 and runs it a tick at a time, so
# the assertions are about the real loop rather than a paraphrase of it.
#
# WHY IT EXISTS. Microsoft 365 Copilot's paperclip button DOES open a genuine
# Win32 #32770 common dialog — but Copilot is a WebView2 shell, so the dialog is
# created by msedgewebview2.exe, a CHILD of M365Copilot.exe, and the old gate
#   if (-not (Is-AiProcess $proc.ProcessName)) { continue }
# rejected it every time. Windows records the executable that opened each common
# dialog in HKCU\...\Explorer\ComDlg32\LastVisitedPidlMRU; on the box where this
# was diagnosed the most-recent entry was msedgewebview2.exe, written at the same
# second as Recent\Test.lnk and the picked file's LastAccessTime.
#
# Two further defects sat behind that one, each on its own enough to emit nothing:
#   * the File name field's UIA ControlType is Pane, not Edit/ComboBox, so the old
#     ControlType query found only the file LIST's grid cells and never the field;
#   * the field holds a bare, extension-hidden basename ('Test'), never a path, so
#     the old Looks-LikePath gate rejected it anyway. The folder is only in the
#     address breadcrumb.
# None had ever been reached, because the loop was wedged on a blocking stdin read
# until that was fixed.
#
# Stubbed here — the environment, never the logic under test:
#   * Get-OpenCommonDialogs  — no real dialogs on a test box.
#   * Get-ProcessNameById / Get-ParentProcessId / Get-OwnerWindowProcessId —
#     a scripted process table, so the real Resolve-GovernedProcess walk runs.
# Real, and under test: Resolve-GovernedProcess, Get-DialogSelection (driven by a
# fake element that answers FindAll the way the measured live dialog does),
# Split-FileNameField, Resolve-DialogPath, Resolve-ByGlob (against real files in a
# real temp dir), the tracking/close diff, and Emit-Json.
#
# Emits NDJSON on stdout — the harness's own `obs` lines plus every line the
# production loop emits. agent/tests asserts on both.
param([Parameter(Mandatory = $true)][string]$Ps1)

$ErrorActionPreference = 'Stop'

$raw = Get-Content -Raw -LiteralPath $Ps1

$cut = $raw.IndexOf('$tick = 0')
if ($cut -lt 0) { throw 'could not find the poll loop preamble ($tick = 0) in file-dialog-watcher.ps1' }
$preLoop = $raw.Substring(0, $cut)
foreach ($needed in @(
    'function Resolve-GovernedProcess', 'function Get-DialogSelection',
    'function Resolve-DialogPath', 'function Split-FileNameField',
    'function Get-OpenCommonDialogs', 'function Is-AiProcess')) {
    if ($preLoop.IndexOf($needed) -lt 0) { throw "the harness needs $needed to sit ABOVE the poll loop" }
}

# ── lift the loop body, verbatim ────────────────────────────────────────────
$loopSrc = $raw.Substring($cut)
$openTok = 'while ($true) {'
$open = $loopSrc.IndexOf($openTok)
if ($open -lt 0) { throw 'could not find the poll loop itself (while ($true) {)' }
$body = $loopSrc.Substring($open + $openTok.Length).TrimEnd()
if (-not $body.EndsWith('}')) { throw 'poll loop does not end where expected; harness would run a truncated body' }
$body = $body.Substring(0, $body.Length - 1)
$tickFn = "function Invoke-Tick {`r`n foreach (`$__once in 1) {`r`n$body`r`n }`r`n}"

# Stated explicitly rather than left to the .ps1's fallback list, because this is
# what the wrapper really passes — file-dialog-watcher.js sends
# watcherProcessNames(), and 'm365copilot' is in it. Matching case is deliberately
# NOT used: Is-AiProcess compares with -ieq, and the wrapper sends lower case.
$env:CFAI_AI_PROCESSES = 'chatgpt,claude,cursor,copilot,m365copilot,comet,gemini,poe'

Invoke-Expression $preLoop
Invoke-Expression $tickFn

function Start-Sleep { param([int]$Milliseconds, [int]$Seconds) }

# ── scripted process table ──────────────────────────────────────────────────
# pid -> @{ Name; Parent }. Mirrors the REAL topology measured on the box:
#   M365Copilot(9476) -> msedgewebview2(10940)   [the Copilot paperclip case]
#   ms-teams(15176)   -> msedgewebview2(15600)   [the Teams case]
$script:ProcTable = @{
    9476  = @{ Name = 'M365Copilot';    Parent = 1000 }
    10940 = @{ Name = 'msedgewebview2'; Parent = 9476 }
    15176 = @{ Name = 'ms-teams';       Parent = 1000 }
    15600 = @{ Name = 'msedgewebview2'; Parent = 15176 }
    7000  = @{ Name = 'ChatGPT';        Parent = 1000 }
    6000  = @{ Name = 'notepad';        Parent = 1000 }
    5000  = @{ Name = 'msedge';         Parent = 1000 }
    1000  = @{ Name = 'explorer';       Parent = 800  }
    800   = @{ Name = 'services';       Parent = 0    }
    # PickerHost is brokered: its PARENT is a service, not the requesting app.
    # Only the dialog's OWNER WINDOW leads back to the app.
    3100  = @{ Name = 'PickerHost';     Parent = 800  }
    # A governed app buried deeper than the walk cap allows.
    2005  = @{ Name = 'deepshim5';      Parent = 2004 }
    2004  = @{ Name = 'deepshim4';      Parent = 2003 }
    2003  = @{ Name = 'deepshim3';      Parent = 2002 }
    2002  = @{ Name = 'deepshim2';      Parent = 2001 }
    2001  = @{ Name = 'deepshim1';      Parent = 7000 }
}
function Get-ProcessNameById([int]$processId) {
    if ($script:ProcTable.ContainsKey($processId)) { return $script:ProcTable[$processId].Name }
    return $null
}
function Get-ParentProcessId([int]$processId) {
    if ($script:ProcTable.ContainsKey($processId)) { return [int]$script:ProcTable[$processId].Parent }
    return 0
}
# hwnd -> owning-window pid, for the brokered-picker case.
$script:OwnerPids = @{}
function Get-OwnerWindowProcessId([int64]$hwnd) {
    if ($script:OwnerPids.ContainsKey($hwnd)) { return [int]$script:OwnerPids[$hwnd] }
    return 0
}

# ── a fake dialog element shaped like the REAL measured one ─────────────────
#
# Measured by walking a live Open dialog on Windows 11 26200:
#   [Pane] aid='1090' cls='Static'       name='File name:'
#   [Pane] aid='1148' cls='ComboBoxEx32' name='Test'
#     [Pane] aid='1148' cls='ComboBox'   name=''
#       [Pane] aid='1148' cls='Edit'     name='Test'
#   ...ToolbarWindow32 aid='1001' name='Address: C:\...\Desktop'
# NONE of the 1148 nodes supports ValuePattern/TextPattern/LegacyIAccessible, so
# the Name property is the only readable source — which is why TryGetCurrentPattern
# here always answers $false, exactly as the real dialog does.
function New-FakeNode([string]$name) {
    $n = [pscustomobject]@{ Current = [pscustomobject]@{ Name = $name } }
    $n | Add-Member -MemberType ScriptMethod -Name TryGetCurrentPattern -Value { param($p, $r) return $false }
    return $n
}
function New-FakeDialog([string]$fieldText, [string]$addressBarName) {
    # Three nodes carry AutomationId 1148, two of them with the text and the bare
    # ComboBox with ''. Get-DialogSelection must take the longest, not the first.
    $fieldNodes = @((New-FakeNode $fieldText), (New-FakeNode ''), (New-FakeNode $fieldText))
    $barNodes = @()
    foreach ($b in @('Navigation buttons', 'Up band', $addressBarName, 'Address band')) {
        $barNodes += (New-FakeNode $b)
    }
    $el = [pscustomobject]@{ Current = [pscustomobject]@{ Name = 'Open' } }
    $el | Add-Member -MemberType NoteProperty -Name FieldNodes -Value $fieldNodes
    $el | Add-Member -MemberType NoteProperty -Name BarNodes   -Value $barNodes
    $el | Add-Member -MemberType ScriptMethod -Name FindAll -Value {
        param($scope, $cond)
        # Branch on which PropertyCondition the production code passed.
        $prop = $cond.Property.ProgrammaticName
        if ($prop -match 'AutomationId') { return $this.FieldNodes }
        if ($prop -match 'ClassName')    { return $this.BarNodes }
        return @()
    }
    return $el
}

# ── the scripted desktop ────────────────────────────────────────────────────
$script:OpenDialogs = New-Object System.Collections.Generic.List[object]
function Get-OpenCommonDialogs { return ,$script:OpenDialogs }

function Set-Dialogs($list) {
    $script:OpenDialogs = New-Object System.Collections.Generic.List[object]
    foreach ($d in $list) { $script:OpenDialogs.Add($d) | Out-Null }
}

function New-Dialog([int64]$hwnd, [int]$procId, [string]$fieldText, [string]$addressBarName) {
    return [pscustomobject]@{
        Hwnd      = $hwnd
        ProcessId = $procId
        Title     = 'Open'
        Element   = (New-FakeDialog $fieldText $addressBarName)
    }
}

function Tick([string]$step) {
    $script:tick = 1
    $threw = $null
    try { Invoke-Tick } catch { $threw = $_.Exception.Message }
    Emit-Json @{ obs = $step; threw = $threw; tracked = [int]$Tracked.Count }
}

# ── a real folder with a real, extension-hidden file ────────────────────────
$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("cfai-fdw-" + [Guid]::NewGuid().ToString('N').Substring(0, 8))
$null = New-Item -ItemType Directory -Path $tmp
Set-Content -LiteralPath (Join-Path $tmp 'Test.docx') -Value 'x'
Set-Content -LiteralPath (Join-Path $tmp 'Second.xlsx') -Value 'x'
$addr = 'Address: ' + $tmp
Emit-Json @{ obs = 'tmpdir'; path = $tmp }

# ── SCENARIO A: THE LIVE MISS — Copilot's paperclip ─────────────────────────
#
# The dialog belongs to msedgewebview2(10940); the governed app is its parent
# M365Copilot(9476). Old code: Is-AiProcess 'msedgewebview2' is false -> continue,
# nothing tracked, nothing emitted, which is exactly what the live log showed
# (zero file_dialog_pick lines for an attach that demonstrably happened).
Emit-Json @{ obs = 'old-gate-msedgewebview2'; is_ai = [bool](Is-AiProcess 'msedgewebview2') }
Set-Dialogs @((New-Dialog 501 10940 'Test' $addr))
Tick 'A1-webview2-dialog-open'
Set-Dialogs @()
Tick 'A2-webview2-dialog-closed'

# ── SCENARIO B: a plain native AI app still works ───────────────────────────
Set-Dialogs @((New-Dialog 502 7000 'Test' $addr))
Tick 'B1-native-dialog-open'
Set-Dialogs @()
Tick 'B2-native-dialog-closed'

# ── SCENARIO C: an unrelated app is still ignored ───────────────────────────
Set-Dialogs @((New-Dialog 503 6000 'Test' $addr))
Tick 'C1-notepad-open'
Set-Dialogs @()
Tick 'C2-notepad-closed'

# ── SCENARIO D: the walk is bounded ─────────────────────────────────────────
# deepshim5(2005) sits five hops under ChatGPT(7000); PROC_WALK_MAX is 4, so this
# must NOT resolve. Guards against the walk creeping up to services.exe and
# attributing arbitrary dialogs to whatever sits above them.
Set-Dialogs @((New-Dialog 504 2005 'Test' $addr))
Tick 'D1-too-deep-open'
Set-Dialogs @()
Tick 'D2-too-deep-closed'

# ── SCENARIO E: the brokered picker, resolved by OWNER WINDOW ───────────────
# PickerHost(3100)'s parent is a service, so only the dialog's owner window leads
# back to M365Copilot(9476).
$script:OwnerPids[[int64]505] = 9476
Set-Dialogs @((New-Dialog 505 3100 'Test' $addr))
Tick 'E1-pickerhost-open'
Set-Dialogs @()
Tick 'E2-pickerhost-closed'

# ── SCENARIO F: multi-select, quoted ────────────────────────────────────────
Set-Dialogs @((New-Dialog 506 10940 '"Test.docx" "Second.xlsx"' $addr))
Tick 'F1-multiselect-open'
Set-Dialogs @()
Tick 'F2-multiselect-closed'

# ── SCENARIO G: a name that resolves to nothing on disk emits nothing ───────
# A half-typed name in a dialog the user then cancelled must not be reported.
Set-Dialogs @((New-Dialog 507 10940 'NoSuchFileAnywhere' $addr))
Tick 'G1-bogus-open'
Set-Dialogs @()
Tick 'G2-bogus-closed'

# ── SCENARIO H: Microsoft Teams, armed, through its WebView2 child ──────────
# Unarmed first: a Teams picker must be invisible by default.
Set-Dialogs @((New-Dialog 508 15600 'Test' $addr))
Tick 'H1-teams-unarmed-open'
Set-Dialogs @()
Tick 'H2-teams-unarmed-closed'

$null = $ArmedHostProcs.Add('ms-teams')
Set-Dialogs @((New-Dialog 509 15600 'Test' $addr))
Tick 'H3-teams-armed-open'
Set-Dialogs @()
Tick 'H4-teams-armed-closed'

Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
Emit-Json @{ obs = 'done' }

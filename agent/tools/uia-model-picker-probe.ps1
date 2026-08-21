<#
.SYNOPSIS
  Dev-only, read-only diagnostic probe for the model-routing feasibility
  question: can Windows UI Automation find a desktop AI app's model-picker
  element (and its dropdown items) WITHOUT that element being keyboard-
  focused? See the model-routing design doc, section 7, for why this has to
  be answered empirically before any product code gets written.

.DESCRIPTION
  This is NOT part of the shipped product. It is never spawned by the
  monitor, installs no keyboard/mouse hook, and sends no synthetic input -
  it only reads. It dumps a snapshot of the foreground window's UIA tree via
  two independent strategies (mirroring the two approaches already used
  elsewhere in this codebase: enforcer-win.ps1's UpdateSendRect FindAll
  probe, and attachment-watcher.ps1's depth-capped TreeWalker walk) and
  writes the results to a local NDJSON file, plus prints anything that looks
  model-related straight to the console.

  Operator flow (per the design doc): run this three times against the same
  app - once with the model picker closed, once with it open, once right
  after picking a different model - to see whether a picker element is
  discoverable in each state and whether its reported Name updates after a
  switch.

  PRIVACY: the dump includes accessible Names/HelpText from a live AI app,
  which can include visible on-screen text (e.g. a truncated prompt fragment
  used as a tab title). The output file is written locally only and this
  script never uploads or transmits it anywhere - keep it that way, and
  don't attach these files to tickets/chats without checking their content
  first.

.PARAMETER ProcessName
  Only proceed if the current foreground window belongs to this process
  (e.g. 'Claude', 'ChatGPT', 'Gemini'). Omit to snapshot whatever is
  currently in the foreground, whatever it is.

.PARAMETER Label
  A short label for this run (e.g. "menu-closed", "menu-open",
  "after-switch"), appended to the output filename so a series of probes
  against the same app stays organized on disk.

.PARAMETER MaxDepth
  Depth cap for the TreeWalker strategy, matching the cap
  attachment-watcher.ps1 already uses for the same reason (unbounded walks
  over a full Chromium accessibility tree can be expensive).

.PARAMETER OutDir
  Where NDJSON dumps are written. Defaults under %TEMP%, well outside the
  repo and outside anything the agent itself reads or uploads.

.EXAMPLE
  # Alt-tab to Claude Desktop with its model picker closed, then:
  .\uia-model-picker-probe.ps1 -ProcessName Claude -Label menu-closed

.EXAMPLE
  # Open the model picker in the same app, then:
  .\uia-model-picker-probe.ps1 -ProcessName Claude -Label menu-open
#>
param(
    [string]$ProcessName = '',
    [string]$Label = 'snapshot',
    [int]$MaxDepth = 30,
    [string]$OutDir = "$env:TEMP\cfai-uia-probe",
    [int]$DelaySeconds = 4
)

$ErrorActionPreference = 'Stop'
$ProgressPreference    = 'SilentlyContinue'

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

if (-not ('UiaProbe.Win32' -as [type])) {
    Add-Type -Namespace UiaProbe -Name Win32 -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern System.IntPtr GetForegroundWindow();
[System.Runtime.InteropServices.DllImport("user32.dll", SetLastError=true)]
public static extern uint GetWindowThreadProcessId(System.IntPtr hWnd, out uint lpdwProcessId);
'@
}

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMdd-HHmmss')
$safeLabel = ($Label -replace '[^a-zA-Z0-9_-]', '_')
$outFile = Join-Path $OutDir "$stamp-$safeLabel.ndjson"

# The moment you press Enter on this command, THIS terminal window is the
# foreground window - not the app you want probed. Give a countdown so you
# can Alt-Tab (or click) over to the target app before the snapshot is taken.
if ($DelaySeconds -gt 0) {
    Write-Host "Switch to the target app now - probing in $DelaySeconds seconds..." -ForegroundColor Yellow
    for ($s = $DelaySeconds; $s -ge 1; $s--) {
        Write-Host "  $s..."
        Start-Sleep -Seconds 1
    }
}

$hwnd = [UiaProbe.Win32]::GetForegroundWindow()
if ($hwnd -eq [System.IntPtr]::Zero) { Write-Host "No foreground window - nothing to probe."; exit 1 }

$procId = 0
[void][UiaProbe.Win32]::GetWindowThreadProcessId($hwnd, [ref]$procId)
$proc = $null
try { $proc = Get-Process -Id $procId -ErrorAction Stop } catch {}
$procNameActual = if ($proc) { $proc.ProcessName } else { '<unknown>' }

if ($ProcessName -and $procNameActual -ne $ProcessName) {
    Write-Host "Foreground window belongs to '$procNameActual', not '$ProcessName' - switch focus to that app and re-run."
    exit 1
}

Write-Host "Probing foreground window: process=$procNameActual  hwnd=$hwnd  label=$Label"

$win = $null
try { $win = [System.Windows.Automation.AutomationElement]::FromHandle($hwnd) } catch {}
if (-not $win) { Write-Host "AutomationElement.FromHandle returned null for this window."; exit 1 }

# Pattern IDs (UIA_xPatternId constants) rather than the typed wrapper
# classes — LookupById works even when a given wrapper type isn't resolvable
# in this environment's UIAutomationClient build (confirmed live: the
# LegacyIAccessiblePattern type failed to resolve and, since the check list
# used to be one eagerly-evaluated array literal, that single bad reference
# threw before a single element was ever dumped, silently zeroing out both
# strategies). Each lookup is now independent, so one missing pattern can't
# take out every other check.
$script:PatternIdMap = @{
    Invoke            = 10000
    Selection         = 10001
    Value             = 10002
    ExpandCollapse    = 10005
    SelectionItem     = 10010
    LegacyIAccessible = 10018
}

function Get-PatternFlags($el) {
    $flags = New-Object System.Collections.Generic.List[string]
    foreach ($name in $script:PatternIdMap.Keys) {
        try {
            $pat = [System.Windows.Automation.AutomationPattern]::LookupById($script:PatternIdMap[$name])
            $out = $null
            if ($el.TryGetCurrentPattern($pat, [ref]$out)) { [void]$flags.Add($name) }
        } catch {}
    }
    return ,$flags
}

function New-ElementRecord($el, $depth, $strategy) {
    $ct = $null;   try { $ct = $el.Current.ControlType.ProgrammaticName } catch {}
    $name = $null; try { $name = $el.Current.Name } catch {}
    $aid = $null;  try { $aid = $el.Current.AutomationId } catch {}
    $help = $null; try { $help = $el.Current.HelpText } catch {}
    $kbf = $null;  try { $kbf = $el.Current.IsKeyboardFocusable } catch {}
    $rect = $null
    try {
        $r = $el.Current.BoundingRectangle
        if (-not $r.IsEmpty) { $rect = @{ x = [int]$r.Left; y = [int]$r.Top; w = [int]$r.Width; h = [int]$r.Height } }
    } catch {}
    $patterns = Get-PatternFlags $el
    return [pscustomobject]@{
        kind = 'element'; strategy = $strategy; depth = $depth
        control_type = $ct; name = $name; automation_id = $aid; help_text = $help
        keyboard_focusable = $kbf; rect = $rect; patterns = $patterns
    }
}

$records = New-Object System.Collections.Generic.List[object]

# Strategy A: FindAll(Descendants, Button|Custom) - the same probe
# enforcer-win.ps1's UpdateSendRect already uses to locate the send button.
# Chromium often maps a clickable model-picker button to ControlType.Custom
# when it has no native button semantics, so both types are included.
$swA = [System.Diagnostics.Stopwatch]::StartNew()
try {
    $cond = New-Object System.Windows.Automation.OrCondition(
        (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button)),
        (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Custom))
    )
    $found = $win.FindAll([System.Windows.Automation.TreeScope]::Descendants, $cond)
    foreach ($el in $found) { $records.Add((New-ElementRecord $el -1 'findall_button_custom')) }
} catch {
    $records.Add([pscustomobject]@{ kind = 'error'; strategy = 'findall_button_custom'; message = $_.Exception.Message })
}
$swA.Stop()
$countA = ($records | Where-Object { $_.strategy -eq 'findall_button_custom' -and $_.kind -eq 'element' }).Count
Write-Host ("  Strategy A (FindAll Button|Custom): {0} elements in {1}ms" -f $countA, $swA.ElapsedMilliseconds)

# Strategy B: depth-capped TreeWalker walk - same shape as
# attachment-watcher.ps1's Collect-FilenameLikeNames, but dumping every
# element instead of filtering by filename, since we don't yet know what a
# model-picker element looks like in each app.
$swB = [System.Diagnostics.Stopwatch]::StartNew()
try {
    $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
    $stack = New-Object System.Collections.Generic.Stack[object]
    $stack.Push(@{ El = $win; Depth = 0 })
    while ($stack.Count -gt 0) {
        $cur = $stack.Pop()
        if ($cur.Depth -gt $MaxDepth) { continue }
        $records.Add((New-ElementRecord $cur.El $cur.Depth 'treewalker'))
        try {
            $child = $walker.GetFirstChild($cur.El)
            while ($child) {
                $stack.Push(@{ El = $child; Depth = ($cur.Depth + 1) })
                $child = $walker.GetNextSibling($child)
            }
        } catch {}
    }
} catch {
    $records.Add([pscustomobject]@{ kind = 'error'; strategy = 'treewalker'; message = $_.Exception.Message })
}
$swB.Stop()
$countB = ($records | Where-Object { $_.strategy -eq 'treewalker' -and $_.kind -eq 'element' }).Count
Write-Host ("  Strategy B (TreeWalker depth<={0}): {1} elements in {2}ms" -f $MaxDepth, $countB, $swB.ElapsedMilliseconds)

# Write the full dump - one JSON object per line, plus a meta header and two
# strategy summaries so the file is self-describing without this script.
$writer = New-Object System.IO.StreamWriter($outFile, $false)
try {
    $meta = [pscustomobject]@{
        kind = 'meta'; t = (Get-Date).ToUniversalTime().ToString('o')
        process = $procNameActual; pid = $procId; hwnd = $hwnd.ToString(); label = $Label
    }
    $writer.WriteLine(($meta | ConvertTo-Json -Compress -Depth 6))
    $writer.WriteLine((([pscustomobject]@{ kind = 'strategy_summary'; strategy = 'findall_button_custom'; elements = $countA; ms = $swA.ElapsedMilliseconds }) | ConvertTo-Json -Compress -Depth 6))
    $writer.WriteLine((([pscustomobject]@{ kind = 'strategy_summary'; strategy = 'treewalker'; elements = $countB; ms = $swB.ElapsedMilliseconds }) | ConvertTo-Json -Compress -Depth 6))
    foreach ($rec in $records) { $writer.WriteLine(($rec | ConvertTo-Json -Compress -Depth 6)) }
} finally {
    $writer.Close()
}

# Immediate console signal: anything whose Name/AutomationId/HelpText looks
# model-related, without the operator having to open and parse the file.
$modelKeywords = 'sonnet|opus|haiku|fable|gpt|chatgpt|gemini|flash|thinking|model|claude'
$hits = @($records | Where-Object {
    $_.kind -eq 'element' -and (
        ($_.name -and $_.name -match $modelKeywords) -or
        ($_.automation_id -and $_.automation_id -match $modelKeywords) -or
        ($_.help_text -and $_.help_text -match $modelKeywords)
    )
})

Write-Host ""
if ($hits.Count -eq 0) {
    Write-Host "No model-related element name/id/help-text found by either strategy."
} else {
    Write-Host "Model-related elements found ($($hits.Count)):"
    foreach ($h in $hits) {
        $pats = ($h.patterns -join ',')
        Write-Host ("  [{0} depth={1}] type={2} name='{3}' aid='{4}' focusable={5} patterns=[{6}]" -f `
            $h.strategy, $h.depth, $h.control_type, $h.name, $h.automation_id, $h.keyboard_focusable, $pats)
    }
}

Write-Host ""
Write-Host "Full dump written to: $outFile"
Write-Host "This file can contain visible on-screen text from the AI app (element names/labels). Local-only - do not upload it."

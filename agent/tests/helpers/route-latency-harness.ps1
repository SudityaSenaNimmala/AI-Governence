# Harness: how long a route holds the user's prompt, Enter -> switch -> send
# (and -> the route's report), on the web arm and the desktop arm.
#
# Live (2026-10-07, Gemini in Edge, desktop web arm): "there is a lag for each
# model routing change"; the route's model_routed event landed 1.5s after its
# own send. This harness measures the route's WAITS -- every fixed sleep on
# the path and every poll loop -- against a scripted, typical world, so the
# number moves only when the code's waiting changes:
#   * the menu's items are in the tree 20ms after Expand();
#   * the picker reads the target tier 100ms after the item is selected;
#   * the menu is gone 30ms after Collapse();
#   * focus is already on the composer (the gate's one re-check), or -- the
#     refocus rows -- was handed to the picker trigger and a SetFocus lands
#     20ms later;
#   * the composer empties 120ms after the Enter (an accessibility hop).
# UIA call COSTS are not modelled (they are the same before and after); this is
# the time the route spends WAITING. The loops are the REAL C# (compiled out of
# -Ps1, driven by reflection with a fake clock); the fixed sleeps are read out
# of the same -Ps1 source, so the harness can be pointed at an older enforcer
# to get the "before" numbers.
#
# Output: one NDJSON line per observation (`t` field). Ends with {"t":"done"}.
param(
  [Parameter(Mandatory=$true)][string]$Ps1,
  [string]$RouterConfig = ''
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

$raw = Get-Content -Raw -LiteralPath $Ps1
$startIdx = $raw.IndexOf("`$source = @'")
if ($startIdx -lt 0) { throw 'could not find the $source here-string in enforcer-win.ps1' }
$bodyStart = $raw.IndexOf("`n", $startIdx) + 1
$endIdx = $raw.IndexOf("`n'@", $bodyStart)
if ($endIdx -lt 0) { throw 'could not find the end of the $source here-string' }
$source = $raw.Substring($bodyStart, $endIdx - $bodyStart)

Add-Type -TypeDefinition $source -ReferencedAssemblies @(
    'System.Windows.Forms','UIAutomationClient','UIAutomationTypes','WindowsBase','System.Web.Extensions'
) -ErrorAction Stop

$T = [CfaiEnforcer]
$FLAGS = [System.Reflection.BindingFlags]'NonPublic,Public,Static'
function GetF([string]$n) { $f = $T.GetField($n, $FLAGS); if (-not $f) { throw "no field $n" }; $f.GetValue($null) }
function Has([string]$n) { return [bool]($T.GetMethod($n, $FLAGS)) }
function Call([string]$n, [object[]]$a = @()) {
  $m = $T.GetMethod($n, $FLAGS)
  if (-not $m) { throw "no method $n" }
  $args2 = New-Object 'object[]' $a.Count
  for ($i = 0; $i -lt $a.Count; $i++) { $v = $a[$i]; if ($null -ne $v) { $v = $v.psobject.BaseObject }; $args2[$i] = $v }
  try { return $m.Invoke($null, $args2) } catch { throw $_.Exception.InnerException }
}
function Emit($obj) { [Console]::Out.WriteLine(($obj | ConvertTo-Json -Compress -Depth 6)); [Console]::Out.Flush() }
function Nested([string]$n) { $t = $T.GetNestedType($n, $FLAGS); if (-not $t) { throw "no nested type $n" }; $t }
function SetDel($type, $obj, [string]$field, [scriptblock]$sb) {
  $f = $type.GetField($field)
  if (-not $f) { return }
  $f.SetValue($obj, [System.Management.Automation.LanguagePrimitives]::ConvertTo($sb, $f.FieldType))
}

# ---- the source's fixed sleeps on the routed path ----------------------------
function Slice([string]$from, [string]$to) {
  $a = $raw.IndexOf($from); if ($a -lt 0) { return '' }
  $b = $raw.IndexOf($to, $a + $from.Length); if ($b -lt 0) { return '' }
  return $raw.Substring($a, $b - $a)
}
function CodeOnly([string]$s) { (($s -split "`r?`n") | ForEach-Object { $_ -replace '//.*$', '' }) -join "`n" }
function SumSleeps([string]$s) { $n = 0; foreach ($m in [regex]::Matches((CodeOnly $s), 'Thread\.Sleep\((\d+)\)')) { $n += [int]$m.Groups[1].Value }; return $n }

$webRun = Slice 'static void RunWebRoute(' 'static string WebTierOfLabel('
$deskRun = Slice 'static void RunRoute(' '// ════ THE WEB ARM ON THE DESKTOP'
foreach ($arm in @(@('web', $webRun), @('desktop', $deskRun))) {
  $body = $arm[1]
  # Expand() -> the item search: a fixed sleep, or (now) a poll.
  $iExpand = $body.IndexOf('.Expand();')
  $iFind = $body.IndexOf('RouteCheckpoint("find_item")')
  $expandFixed = if ($iExpand -ge 0 -and $iFind -gt $iExpand) { SumSleeps $body.Substring($iExpand, $iFind - $iExpand) } else { -1 }
  $expandPolled = ($iExpand -ge 0 -and $iFind -gt $iExpand -and $body.Substring($iExpand, $iFind - $iExpand).Contains('RouteAwaitMenuItems('))
  # Select() -> the switch wait (the happy path only: up to the verify setup,
  # so a delegate's sleep -- DismissConfirm, a failure path -- is not counted).
  $iSel = $body.IndexOf('"select_failed"')
  $iAwait = $body.IndexOf('AutomationElement verifyEl')
  $preAwait = if ($iSel -ge 0 -and $iAwait -gt $iSel) { SumSleeps $body.Substring($iSel, $iAwait - $iSel) } else { -1 }
  Emit @{ t = 'fixed'; arm = $arm[0]; expandFixedMs = $expandFixed; expandPolled = $expandPolled; preAwaitFixedMs = $preAwait }
}

# ---- 1. Expand() -> the menu's items: poll (new) or the fixed sleep (old) ------
$menuMs = $null
if (Has 'RouteAwaitMenuItems') {
  $script:M = @{ now = 0 }
  $showing = [Func[bool]] { [bool]($script:M.now -ge 20) }
  $sleep = [Action[int]] { param([int]$ms) $script:M.now += $ms }
  $menuMs = [int](Call 'RouteAwaitMenuItems' @($showing, $sleep, 600))
}
Emit @{ t = 'loop'; name = 'menu_render'; polled = ($null -ne $menuMs); ms = $(if ($null -ne $menuMs) { $menuMs } else { -1 }) }

# ---- 2. the switch wait (RouteAwaitSwitch, no confirm dialog: gemini) --------
$sIo = Nested 'RouteSwitchIo'
$script:S = @{ now = 0 }
$io = [Activator]::CreateInstance($sIo, $true)
SetDel $sIo $io 'ReadLabel' { if ($script:S.now -ge 100) { 'Open mode picker, currently 3.5 Flash-Lite' } else { 'Open mode picker, currently 3.1 Pro' } }
SetDel $sIo $io 'TierOf' { param([string]$l) if ($l -like '*Flash-Lite*') { 'economy' } else { 'premium' } }
SetDel $sIo $io 'RetryActivate' { }
SetDel $sIo $io 'ProbeConfirm' { $null }
SetDel $sIo $io 'InvokeConfirm' { param([string]$n) $false }
SetDel $sIo $io 'DismissConfirm' { }
SetDel $sIo $io 'NowMs' { [long]$script:S.now }
SetDel $sIo $io 'Sleep' { param([int]$ms) $script:S.now += $ms }
$labels = New-Object 'System.Collections.Generic.List[string]'; $labels.Add('3.5 Flash-Lite')
$o = Call 'RouteAwaitSwitch' @($io, $null, $labels, 'economy', 'Open mode picker, currently 3.1 Pro', $true, $false)
$sOut = Nested 'RouteSwitchOutcome'
Emit @{ t = 'loop'; name = 'switch_wait'; switched = [bool]$sOut.GetField('Switched').GetValue($o); ms = [int]$script:S.now }

# ---- 3. closing the menu after the switch (RouteCollapseMenu) ----------------
$cIo = Nested 'RouteCollapseIo'
$script:C = @{ now = 0; collapsedAt = -1 }
$io = [Activator]::CreateInstance($cIo, $true)
SetDel $cIo $io 'MenuOpen' { if ($script:C.collapsedAt -lt 0) { $true } else { [bool]($script:C.now -lt $script:C.collapsedAt + 30) } }
SetDel $cIo $io 'CollapsePattern' { $script:C.collapsedAt = $script:C.now }
SetDel $cIo $io 'WindowOk' { $true }
SetDel $cIo $io 'SendEscape' { }
SetDel $cIo $io 'Sleep' { param([int]$ms) $script:C.now += $ms }
$o = Call 'RouteCollapseMenu' @($io)
Emit @{ t = 'loop'; name = 'collapse'; closed = [bool](Nested 'RouteCollapseOutcome').GetField('Closed').GetValue($o); ms = [int]$script:C.now }

# ---- 4. the pre-Enter gate (RouteFocusGate), focus already right -------------
$gIo = Nested 'RouteGateIo'
$script:G = @{ now = 0 }
$io = [Activator]::CreateInstance($gIo, $true)
SetDel $gIo $io 'WindowOk' { $true }
SetDel $gIo $io 'MenuOpen' { $false }
SetDel $gIo $io 'CollapseMenu' { $null }
SetDel $gIo $io 'FocusVerdict' { $null }
SetDel $gIo $io 'DialogHoldsFocus' { $false }
SetDel $gIo $io 'DismissDialog' { }
SetDel $gIo $io 'Refocus' { $null }
SetDel $gIo $io 'Sleep' { param([int]$ms) $script:G.now += $ms }
$o = Call 'RouteFocusGate' @($io)
Emit @{ t = 'loop'; name = 'gate'; ok = [bool](Nested 'RouteGateOutcome').GetField('Ok').GetValue($o); ms = [int]$script:G.now }

# ---- 4b. putting focus back on the composer after the switch (RouteRefocusComposer)
# Two worlds: focus already on the composer (nothing to do), and the common
# Gemini / Claude case -- the closing menu handed focus to the picker trigger,
# and a SetFocus on the composer lands 20ms later.
$rIo = Nested 'RouteRefocusIo'
foreach ($case in @(@('refocus_ok', 0), @('refocus_handback', 1))) {
  $script:R = @{ now = 0; focusAt = $(if ($case[1] -eq 0) { 0 } else { [long]::MaxValue }); focuses = 0; clicks = 0 }
  $io = [Activator]::CreateInstance($rIo, $true)
  SetDel $rIo $io 'WindowState' { 'same' }
  SetDel $rIo $io 'RestoreForeground' { }
  SetDel $rIo $io 'FocusVerdict' { if ($script:R.now -ge $script:R.focusAt) { $null } else { 'focus_not_in_composer' } }
  SetDel $rIo $io 'CandidateVerdict' { $null }
  SetDel $rIo $io 'FocusCandidate' { $script:R.focuses++; if ($script:R.focusAt -eq [long]::MaxValue) { $script:R.focusAt = $script:R.now + 20 }; $true }
  SetDel $rIo $io 'ClickCandidate' { $script:R.clicks++; $true }
  SetDel $rIo $io 'NowMs' { [long]$script:R.now }
  SetDel $rIo $io 'Sleep' { param([int]$ms) $script:R.now += $ms }
  $o = Call 'RouteRefocusComposer' @($io)
  Emit @{ t = 'loop'; name = $case[0]; ok = [bool](Nested 'RouteRefocusOutcome').GetField('Ok').GetValue($o); ms = [int]$script:R.now;
          focuses = $script:R.focuses; clicks = $script:R.clicks }
}

# ---- 5. after the ONE Enter (RouteAfterEnter): web 1500ms window, desktop 200 --
$aIo = Nested 'RouteAfterEnterIo'
foreach ($w in @(@('web', 1500), @('desktop', 200))) {
  $script:A = @{ now = 0 }
  $io = [Activator]::CreateInstance($aIo, $true)
  $aIo.GetField('VerifyMs').SetValue($io, [int]$w[1])
  SetDel $aIo $io 'Sleep' { param([int]$ms) $script:A.now += $ms }
  SetDel $aIo $io 'StillThere' { [bool]($script:A.now -lt 120) }
  SetDel $aIo $io 'MenuOpen' { $false }
  SetDel $aIo $io 'FocusInComposer' { $true }
  SetDel $aIo $io 'CollapseMenu' { $null }
  SetDel $aIo $io 'Gate' { $null }
  SetDel $aIo $io 'ClaimResend' { $false }
  SetDel $aIo $io 'SendEnter' { }
  SetDel $aIo $io 'RestoreFocus' { }
  $o = Call 'RouteAfterEnter' @($io)
  Emit @{ t = 'loop'; name = ('after_enter_' + $w[0]); submitted = [bool](Nested 'RouteAfterEnterOutcome').GetField('Submitted').GetValue($o); ms = [int]$script:A.now }
}

# ---- 6. the held decision (new): stable read + the real classifier ------------
if ((Has 'RunHeldEnter') -and $RouterConfig) {
  [void](Call 'LoadModelRouterConfig' @([System.IO.File]::ReadAllText($RouterConfig, [System.Text.UTF8Encoding]::new($false))))
  [void](Call 'ClassifyComplexity' @('warm up'))
  $samples = @()
  foreach ($p in @('hi', 'hello', 'what is 2+2', 'summarise this paragraph for me please', 'design a multi-region failover architecture for our payments service with RPO under 5s')) {
    $sw = [Diagnostics.Stopwatch]::StartNew()
    for ($i = 0; $i -lt 20; $i++) { [void](Call 'ClassifyComplexity' @($p)) }
    $samples += [math]::Round($sw.Elapsed.TotalMilliseconds / 20, 2)
  }
  $stable = [int](GetF 'MR_HELD_STABLE_READ_MS')
  Emit @{ t = 'held'; classifyMsPerPrompt = $samples; classifyMaxMs = ($samples | Measure-Object -Maximum).Maximum; stableReadMs = $stable;
          budgetMs = [int](GetF 'MR_HELD_DECIDE_BUDGET_MS') }
}

Emit @{ t = 'done' }

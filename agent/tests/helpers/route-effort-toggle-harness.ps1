# Harness for the Gemini "Extended thinking" EFFORT TOGGLE (enforcer-win.ps1,
# web arm: WebRoutePlan + RouteApplyEffortToggle + the label/effort readers).
#
# Live evidence (2026-10-07, agent 6323ae9 / version 1f88c414, desktop agent web
# arm on gemini.google.com): routing switched the MODEL correctly but never
# touched "Extended thinking", so the button read "Flash Extended" and complex
# prompts looked like they landed on "flash extended".
#
# NOTHING HERE INSTALLS A HOOK, presses a key or touches a real window. The C#
# is lifted out of the .ps1 and compiled; the pure loop is driven with a
# scripted menu world and a fake clock.
#
# Output: one NDJSON line per observation (`t` field). Ends with {"t":"done"}.
param(
  [Parameter(Mandatory=$true)][string]$Ps1,
  [Parameter(Mandatory=$true)][string]$Catalog
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
function SetF([string]$n, $v) { $f = $T.GetField($n, $FLAGS); if (-not $f) { throw "no field $n" }; $f.SetValue($null, $v) }
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
  $f.SetValue($obj, [System.Management.Automation.LanguagePrimitives]::ConvertTo($sb, $f.FieldType))
}

$catalogJson = [System.IO.File]::ReadAllText($Catalog)
$ser = New-Object System.Web.Script.Serialization.JavaScriptSerializer
$ser.MaxJsonLength = 5 * 1024 * 1024
SetF '_mrCatalog' ($ser.DeserializeObject($catalogJson))
[void](Call 'ApplyRouterPolicyLine' @('{"cmd":"router_policy","policy":{"version":"p1","rules":[],"catalog_overrides":[],"settings":{"allow_upgrade":true},"fleet_enabled":true}}'))

foreach ($n in @('RouteApplyEffortToggle', 'WebRoutePlan', 'ToggleStateOfLabel', 'WebEffortFromLabel', 'MrEffortToggleCfg',
                 'WebApplyEffortToggleUia', 'WebActivateToggleItem', 'WebToggleItemState')) {
  Emit @{ t = 'has'; name = $n; present = (Has $n) }
}

# ---- 1. reading the toggle off the button label ------------------------------
$PFX = 'Open mode picker,'
foreach ($lbl in @('Open mode picker, currently Flash Extended', 'Open mode picker, currently Flash',
                   'Open mode picker, currently Pro Extended', 'Open mode picker, currently Pro',
                   'Open mode picker, currently Flash-Lite', 'Flash Extended', 'Flash-Lite',
                   'Open mode picker, currently Flash Extendedx', '')) {
  Emit @{ t = 'labelstate'; label = $lbl; state = [int](Call 'ToggleStateOfLabel' @($lbl, $PFX, 'Extended'));
          effort = [string](Call 'WebEffortFromLabel' @('gemini.google.com', $lbl, $PFX));
          tier = [string](Call 'MrTierOfLabel' @('browser', 'gemini.google.com', $lbl)) }
}
# Claude's web effort token is read exactly as before (no toggle there).
Emit @{ t = 'claudeeffort'; effort = [string](Call 'WebEffortFromLabel' @('claude.ai', 'Model: Opus 5.5 High', 'Model:')) }
Emit @{ t = 'togglecfg'; host = 'gemini.google.com'; present = ($null -ne (Call 'MrEffortToggleCfg' @('browser', 'gemini.google.com'))) }
Emit @{ t = 'togglecfg'; host = 'claude.ai'; present = ($null -ne (Call 'MrEffortToggleCfg' @('browser', 'claude.ai'))) }
Emit @{ t = 'togglecfg'; host = 'aistudio.google.com'; present = ($null -ne (Call 'MrEffortToggleCfg' @('browser', 'aistudio.google.com'))) }
Emit @{ t = 'togglecfg'; host = 'claude_desktop'; present = ($null -ne (Call 'MrEffortToggleCfg' @('desktop_app', 'claude_desktop'))) }

# ---- 2. the plan --------------------------------------------------------------
# (tierNeeded, hasToggle, labelToggle, wantOn)
$plans = @(
  @('switch_and_toggle',          $true,  $true,  1, $false),
  @('switch_toggle_already_ok',   $true,  $true,  0, $false),
  @('switch_no_toggle_surface',   $true,  $false, -1, $false),
  @('toggle_only_on_to_off',      $false, $true,  1, $false),
  @('toggle_only_off_to_on',      $false, $true,  0, $true),
  @('both_on_target_off',         $false, $true,  0, $false),
  @('both_on_target_on',          $false, $true,  1, $true),
  @('toggle_label_unreadable',    $false, $true,  -1, $true),
  @('no_toggle_on_target',        $false, $false, -1, $false)
)
foreach ($p in $plans) {
  Emit @{ t = 'plan'; case = $p[0]; plan = [string](Call 'WebRoutePlan' @($p[1], $p[2], [int]$p[3], $p[4])) }
}

# ---- 3. RouteApplyEffortToggle against a scripted Gemini menu ----------------
# World:
#   toggle      1 on / 0 off (the real state)
#   menu        is the mode menu showing
#   labelReads  the button label reflects the toggle ('Extended' suffix); when
#               false the label always reads "off" (a build whose label lags)
#   labelLagMs  after a click the label keeps the OLD state this long
#   item        'none' (Invoke-only item, no state -- measured Gemini shape),
#               'toggle' (TogglePattern / Selected prefix -- state readable)
#   activate    'flips' | 'nothing' (the click lands but nothing changes) | 'missing'
#   closeOnClick  Material closes the menu when an item is clicked
#   opens       OpenMenu works
#   closes      CloseMenu works
#   labelAfterClose  the label keeps the OLD state until the menu closes
$tIo = Nested 'RouteToggleIo'
$tOut = Nested 'RouteToggleOutcome'
function RunToggle([string]$case, [bool]$wantOn, [hashtable]$world) {
  $script:W = @{ now = 0; toggle = 1; menu = $false; labelReads = $true; labelLagMs = 0; labelAfterClose = $false; item = 'none';
                 activate = 'flips'; closeOnClick = $false; opens = $true; closes = $true;
                 clickedAt = -1; oldState = -1; activations = 0; opensCalled = 0; closesCalled = 0 }
  foreach ($k in $world.Keys) { $script:W[$k] = $world[$k] }
  $io = [Activator]::CreateInstance($tIo, $true)
  SetDel $tIo $io 'LabelState' {
    if (-not $script:W.labelReads) { return 0 }
    if ($script:W.clickedAt -ge 0 -and ($script:W.now - $script:W.clickedAt) -lt $script:W.labelLagMs) { return [int]$script:W.oldState }
    if ($script:W.labelAfterClose -and $script:W.clickedAt -ge 0 -and $script:W.menu) { return [int]$script:W.oldState }
    return [int]$script:W.toggle
  }
  SetDel $tIo $io 'ItemState' {
    if (-not $script:W.menu) { return -1 }
    if ($script:W.item -eq 'toggle') { return [int]$script:W.toggle }
    return -1
  }
  SetDel $tIo $io 'MenuOpen' { [bool]$script:W.menu }
  SetDel $tIo $io 'OpenMenu' { $script:W.opensCalled++; if ($script:W.opens) { $script:W.menu = $true; return $true }; return $false }
  SetDel $tIo $io 'ActivateItem' {
    if (-not $script:W.menu -or $script:W.activate -eq 'missing') { return $false }
    $script:W.activations++
    $script:W.oldState = $script:W.toggle
    $script:W.clickedAt = $script:W.now
    if ($script:W.activate -eq 'flips') { $script:W.toggle = 1 - $script:W.toggle }
    if ($script:W.closeOnClick) { $script:W.menu = $false }
    return $true
  }
  SetDel $tIo $io 'CloseMenu' { $script:W.closesCalled++; if ($script:W.closes) { $script:W.menu = $false; return $null }; return 'menu_still_open' }
  SetDel $tIo $io 'Sleep' { param([int]$ms) $script:W.now += $ms }
  $o = Call 'RouteApplyEffortToggle' @($io, $wantOn)
  Emit @{ t = 'toggle'; case = $case;
          ok = [bool]$tOut.GetField('Ok').GetValue($o); clicked = [bool]$tOut.GetField('Clicked').GetValue($o);
          opened = [bool]$tOut.GetField('Opened').GetValue($o);
          reason = [string]$tOut.GetField('Reason').GetValue($o); stateAfter = [int]$tOut.GetField('StateAfter').GetValue($o);
          closeReason = [string]$tOut.GetField('CloseReason').GetValue($o);
          activations = $script:W.activations; opensCalled = $script:W.opensCalled; closesCalled = $script:W.closesCalled;
          menuOpenAtEnd = [bool]$script:W.menu; toggleAtEnd = [int]$script:W.toggle; elapsed = $script:W.now }
}

# Model switch landed (menu still showing -- the SAME session), toggle on -> off.
RunToggle 'after_switch_menu_open_on_to_off'   $false @{ toggle = 1; menu = $true }
# Model switch landed and Material closed the menu: reopen, then on -> off.
RunToggle 'after_switch_menu_closed_on_to_off' $false @{ toggle = 1; menu = $false }
# Complex: off -> on, verified by the 'Extended' suffix appearing on the label.
RunToggle 'off_to_on_verified_by_suffix'       $true  @{ toggle = 0; menu = $true; labelLagMs = 200 }
# Toggle-only route: the model is right, the toggle is not (menu opened by the route).
RunToggle 'toggle_only_on_to_off'              $false @{ toggle = 1; menu = $true; closeOnClick = $true }
# Already right with the menu closed: nothing opened, nothing clicked.
RunToggle 'already_off_menu_closed'            $false @{ toggle = 0; menu = $false }
# Already right with the menu open (a switch that carried the toggle): no click, menu closed.
RunToggle 'already_on_menu_open'               $true  @{ toggle = 1; menu = $true }
# The item says the state even when the label cannot (TogglePattern / Selected prefix).
RunToggle 'item_state_wins_over_silent_label'  $false @{ toggle = 1; menu = $true; item = 'toggle'; labelReads = $false }
# The click landed but nothing changed: ONE click only, never a second; reported.
RunToggle 'click_does_nothing'                 $false @{ toggle = 1; menu = $true; activate = 'nothing' }
# The label only re-renders after the menu closes: verified after close.
RunToggle 'label_updates_only_after_close'     $true  @{ toggle = 0; menu = $true; labelAfterClose = $true }
# No toggle item in the menu.
RunToggle 'item_missing'                       $true  @{ toggle = 0; menu = $true; activate = 'missing' }
# The picker will not open.
RunToggle 'menu_will_not_open'                 $true  @{ toggle = 0; menu = $false; opens = $false }
# The menu will not close: reported, never hidden.
RunToggle 'menu_will_not_close'                $false @{ toggle = 1; menu = $true; closes = $false }

# ---- 4. the pin decision on gemini: a toggle-only change ARMS ----------------
function NewMeta([string]$surface, [string]$hoa, [string]$conv) {
  $mt = Nested 'RouteMeta'
  $m = [Activator]::CreateInstance($mt, $true)
  $mt.GetField('Surface').SetValue($m, $surface)
  $mt.GetField('HostOrApp').SetValue($m, $hoa)
  $mt.GetField('ChoiceKey').SetValue($m, "$surface|$hoa|x")
  $mt.GetField('ConvKey').SetValue($m, "$surface|$hoa|$conv")
  return $m
}
function Pin([string]$case, [string]$surface, [string]$hoa, [string]$tier, [string]$complexity, [string]$effortToken) {
  [void](Call 'ClearRouteNote')
  $meta = NewMeta $surface $hoa $case
  $d = Call 'MrDecideForPin' @($meta, 'msedge', $tier, $complexity, $effortToken, 42)
  $mt = Nested 'RouteMeta'
  $note = [string](GetF '_routeNoteLine')
  Emit @{ t = 'pin'; case = $case; armed = ($null -ne $d);
          reason = $(if ($d) { [string]$d.Reason } elseif ($note) { [string](($note | ConvertFrom-Json).reason) } else { '' });
          toTier = $(if ($d) { [string]$d.TargetTier } else { '' });
          effort = $(if ($d) { [string]$d.Effort } else { '' });
          targetEffort = [string]$mt.GetField('TargetEffort').GetValue($meta) }
}
Pin 'gemini_moderate_flash_extended_toggle_only' 'browser' 'gemini.google.com' 'standard' 'moderate' 'High'
Pin 'gemini_complex_pro_off_toggle_only'         'browser' 'gemini.google.com' 'premium'  'complex'  'Low'
Pin 'gemini_moderate_flash_off_noop'             'browser' 'gemini.google.com' 'standard' 'moderate' 'Low'
Pin 'gemini_complex_flash_extended_switch'       'browser' 'gemini.google.com' 'standard' 'complex'  'High'
Pin 'gemini_simple_flash_extended_switch'        'browser' 'gemini.google.com' 'standard' 'simple'   'High'
# Claude keeps its effort read-only: an effort-only change is still a noop.
Pin 'claude_desktop_effort_only_still_noop'      'desktop_app' 'claude_desktop' 'premium' 'complex' 'Medium'
Pin 'claude_web_effort_only_still_noop'          'browser' 'claude.ai' 'premium' 'complex' 'Medium'

Emit @{ t = 'done' }

# Harness for the DESKTOP model-route RECOVERY fixes (Claude Desktop, RunRoute).
#
# Live evidence it reproduces (Windows, build 8788646, Claude Desktop, v2 policy,
# a moderate prompt on Opus routed to Sonnet). Every attempt failed:
#   element_changed_no_fallback_text_changed
#   route_or_rewrite_already_in_progress   (complexity null, tiers undefined)
#   interrupted_before_select_no_fallback_text_changed
#   switch_not_verified_no_fallback_text_changed
#
# NOTHING HERE INSTALLS A KEYBOARD HOOK, and nothing here touches a real window.
# The C# source is lifted out of the .ps1 and compiled on its own, then the
# REAL functions are driven by reflection -- the same shape and rules as
# model-routing-harness.ps1 and routing-decide-harness.ps1. The UIA reads RunRoute
# makes (FocusedElement, the picker's Name) cannot be faked, so the decisions they
# feed were made PURE and are driven here with the values the live run produced.
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
  try { return $m.Invoke($null, $a) } catch { throw $_.Exception.InnerException }
}
function Emit($obj) { [Console]::Out.WriteLine(($obj | ConvertTo-Json -Compress -Depth 6)); [Console]::Out.Flush() }

# Production code writes its events to Console.Out. Capture them per call so a
# test can assert on exactly what ONE call emitted.
function Capture([scriptblock]$body) {
  $orig = [Console]::Out
  $sw = New-Object System.IO.StringWriter
  [Console]::SetOut($sw)
  $ret = $null
  try { $ret = & $body } finally { [Console]::SetOut($orig) }
  $lines = @($sw.ToString() -split "`r?`n" | Where-Object { $_.Trim().StartsWith('{') })
  return @{ ret = $ret; lines = $lines }
}

# ---- live router state: the real catalog + a v2 policy ----------------------
$catalogJson = [System.IO.File]::ReadAllText($Catalog)
$ser = New-Object System.Web.Script.Serialization.JavaScriptSerializer
$ser.MaxJsonLength = 5 * 1024 * 1024
SetF '_mrCatalog' ($ser.DeserializeObject($catalogJson))
$apps = New-Object 'System.Collections.Generic.Dictionary[string,string]' ([StringComparer]::OrdinalIgnoreCase)
$apps['claude'] = 'claude_desktop'
SetF '_mrDesktopApps' $apps
[void](Call 'ApplyRouterPolicyLine' @('{"cmd":"router_policy","policy":{"version":"p1","rules":[],"catalog_overrides":[],"settings":{"allow_upgrade":true,"respect_user_override":true},"fleet_enabled":true}}'))

$RID_A = [int[]]@(42, 1001, 7)
$RID_B = [int[]]@(42, 1001, 9)   # the SAME composer after Claude Desktop re-rendered it
$PROMPT = 'Compare these two approaches and explain the tradeoffs in detail'
$ZW = [string][char]0x200B
$NBSP = [string][char]0x00A0

# ---- 1. the composer verdict -------------------------------------------------
# RouteComposerVerdict(pinnedRid, curRid, pinnedText, curText, curEditable)
#   null  -> this IS the user's composer with the user's prompt: proceed/send
#   else  -> the reason it is not
$hasVerdict = Has 'RouteComposerVerdict'
Emit @{ t = 'has'; name = 'RouteComposerVerdict'; present = $hasVerdict }
if ($hasVerdict) {
  $cases = @(
    @('same_element_same_text',      $RID_A, $PROMPT, $true),
    @('same_element_ws_zw_nbsp',     $RID_A, ("  " + $PROMPT.Replace(' ', $NBSP + ' ') + $ZW + "`r`n"), $true),
    @('rerendered_same_text',        $RID_B, $PROMPT, $true),
    @('rerendered_ws_differs',       $RID_B, ($PROMPT.Replace(' ', "`n") + $ZW), $true),
    @('focus_on_menu_item',          $RID_B, 'Sonnet 5', $false),
    @('focus_on_menu_item_no_text',  $RID_B, $null, $false),
    @('user_edited_same_element',    $RID_A, ($PROMPT + ' please'), $true),
    @('other_textbox_other_text',    $RID_B, 'search chats', $true),
    @('composer_emptied',            $RID_A, '', $true),
    @('no_runtime_id',               $null,  $PROMPT, $true)
  )
  foreach ($c in $cases) {
    $v = Call 'RouteComposerVerdict' @($RID_A, $c[1], $PROMPT, $c[2], $c[3])
    Emit @{ t = 'verdict'; case = $c[0]; reason = [string]$v; ok = ($v -eq $null) }
  }
}

# ---- 2. the switch verification ---------------------------------------------
# What the catalog reads off the REAL Claude Desktop button shapes, including the
# effort suffix and separators a build might render.
# (The middle dot is built from its code point: Windows PowerShell 5.1 reads a
# BOM-less .ps1 as ANSI, which would mangle a literal one.)
$MIDDOT = [string][char]0x00B7
foreach ($lbl in @('Model: Sonnet 5 Medium', 'Model: Sonnet 5 High', ('Model: Sonnet 5 ' + $MIDDOT + ' High'),'Model: Sonnet 5, Extended thinking', 'Model: Opus 5 High', 'Model: Haiku 4.5', 'Model: Claude Sonnet 5')) {
  Emit @{ t = 'tierof'; label = $lbl; tier = [string](Call 'MrTierOfLabel' @('desktop_app', 'claude_desktop', $lbl)) }
}
$hasSwitch = Has 'RouteSwitchVerified'
Emit @{ t = 'has'; name = 'RouteSwitchVerified'; present = $hasSwitch }
if ($hasSwitch) {
  # (afterTier, toTier, labelAfter, labelBefore)
  $sw = @(
    @('switched_to_target',     'standard', 'standard', 'Model: Sonnet 5 High',  'Model: Opus 5 High'),
    @('label_unchanged',        'premium',  'standard', 'Model: Opus 5 High',    'Model: Opus 5 High'),
    @('effort_only_change',     'premium',  'standard', 'Model: Opus 5 Medium',  'Model: Opus 5 High'),
    @('unreadable_but_changed', $null,      'standard', 'Model: Something new',  'Model: Opus 5 High'),
    @('unreadable_unchanged',   $null,      'standard', 'Model: Opus 5 High',    'Model: Opus 5 High'),
    @('empty_label',            $null,      'standard', '',                      'Model: Opus 5 High')
  )
  foreach ($c in $sw) {
    Emit @{ t = 'switch'; case = $c[0]; verified = [bool](Call 'RouteSwitchVerified' @($c[1], $c[2], $c[3], $c[4])) }
  }
}

# ---- 3. StartRoute: a second Enter WHILE a route is running -----------------
# Live: 'route_or_rewrite_already_in_progress' with complexity null and tiers
# undefined. The in-flight route reports its own outcome; this Enter must be
# swallowed (the hook keeps it away from an open model menu) and emit NOTHING.
function ArmPin([string]$id, [long]$expiresAt) {
  SetF '_pendingRouteId' $id
  SetF '_pendingRouteArmed' $true
  SetF '_pendingRouteFromTier' 'premium'
  SetF '_pendingRouteToTier' 'standard'
  SetF '_pendingRouteToLabel' 'Sonnet 5'
  SetF '_pendingRouteProvider' 'anthropic'
  SetF '_pendingRouteComplexity' 'moderate'
  SetF '_pendingRouteOriginalText' $PROMPT
  SetF '_pendingRouteComposerRid' $RID_A
  SetF '_pendingRouteHwnd' ([IntPtr]::new(0x4242))
  SetF '_pendingRouteExpiresAt' $expiresAt
  SetF '_pendingRouteCtx' $null
}
$future = [DateTime]::UtcNow.Ticks + [TimeSpan]::FromSeconds(15).Ticks
$past = [DateTime]::UtcNow.Ticks - [TimeSpan]::FromSeconds(1).Ticks

ArmPin 'route-1' $future
SetF '_routeInProgress' $true
$r = Capture { Call 'StartRoute' @('route-1') }
Emit @{ t = 'start'; case = 'second_enter_in_progress'; ret = [string]$r.ret; events = $r.lines.Count; lines = $r.lines; armedAfter = [bool](GetF '_pendingRouteArmed') }
SetF '_routeInProgress' $false

# An EXPIRED pin must not eat the Enter: the hook lets it through as an
# ordinary (unrouted) send. Before the fix StartRoute reported 'expired' and the
# hook swallowed the Enter anyway -- the user's prompt just sat there.
ArmPin 'route-2' $past
$r = Capture { Call 'StartRoute' @('route-2') }
Emit @{ t = 'start'; case = 'expired_pin'; ret = [string]$r.ret; events = $r.lines.Count; lines = $r.lines; inProgress = [bool](GetF '_routeInProgress') }

# A stale id (the pin rotated between the hook's read and StartRoute) likewise.
ArmPin 'route-3' $future
$r = Capture { Call 'StartRoute' @('some-older-id') }
Emit @{ t = 'start'; case = 'stale_id'; ret = [string]$r.ret; events = $r.lines.Count; inProgress = [bool](GetF '_routeInProgress') }
SetF '_routeInProgress' $false

# ---- 4. the hook's Enter rule while a route runs -----------------------------
$hasHook = Has 'RouteHookSwallowsEnter'
Emit @{ t = 'has'; name = 'RouteHookSwallowsEnter'; present = $hasHook }
if ($hasHook) {
  $VK_RETURN = 0x0D
  # (vk, ctrl, alt, shift, injected, routeInProgress, rewriteInProgress, fgIsRouteWindow)
  $hk = @(
    @('repeat_enter_same_window',  $VK_RETURN, $false, $false, $false, $false, $true,  $false, $true),
    @('our_own_synthetic_enter',   $VK_RETURN, $false, $false, $false, $true,  $true,  $false, $true),
    @('shift_enter_newline',       $VK_RETURN, $false, $false, $true,  $false, $true,  $false, $true),
    @('enter_in_another_window',   $VK_RETURN, $false, $false, $false, $false, $true,  $false, $false),
    @('enter_no_route_running',    $VK_RETURN, $false, $false, $false, $false, $false, $false, $true),
    @('enter_during_rewrite',      $VK_RETURN, $false, $false, $false, $false, $true,  $true,  $true),
    @('letter_key_during_route',   0x41,       $false, $false, $false, $false, $true,  $false, $true)
  )
  foreach ($c in $hk) {
    Emit @{ t = 'hook'; case = $c[0]; swallow = [bool](Call 'RouteHookSwallowsEnter' @([int]$c[1], $c[2], $c[3], $c[4], $c[5], $c[6], $c[7], $c[8])) }
  }
}

# ---- 5. the pin follows a re-rendered composer -------------------------------
# The poll thread's dedup (same text + same label -> return) used to keep the
# RuntimeId captured at the FIRST tick, so a composer Claude Desktop re-rendered
# while the prompt sat unchanged was pinned under a dead id, and Enter failed
# 'element_changed'. It also never refreshed the TTL, so a prompt left >15s
# expired and its Enter was eaten.
$hasRefresh = Has 'MrRefreshPinOnDedup'
Emit @{ t = 'has'; name = 'MrRefreshPinOnDedup'; present = $hasRefresh }
if ($hasRefresh) {
  $soon = [DateTime]::UtcNow.Ticks + [TimeSpan]::FromSeconds(1).Ticks
  $HW = [IntPtr]::new(0x4242)
  ArmPin 'route-4' $soon
  Call 'MrRefreshPinOnDedup' @($PROMPT, $RID_B, $null, $HW) | Out-Null
  $rid = GetF '_pendingRouteComposerRid'
  Emit @{ t = 'refresh'; case = 'same_text_new_rid'; rid = @($rid); ttlExtended = ([long](GetF '_pendingRouteExpiresAt') -gt $soon); id = [string](GetF '_pendingRouteId') }

  ArmPin 'route-5' $soon
  Call 'MrRefreshPinOnDedup' @(($PROMPT + ' x'), $RID_B, $null, $HW) | Out-Null
  Emit @{ t = 'refresh'; case = 'different_text_untouched'; rid = @(GetF '_pendingRouteComposerRid'); ttlExtended = ([long](GetF '_pendingRouteExpiresAt') -gt $soon) }

  # Same text, but in ANOTHER window: never carried over.
  ArmPin 'route-6' $soon
  Call 'MrRefreshPinOnDedup' @($PROMPT, $RID_B, $null, [IntPtr]::new(0x5151)) | Out-Null
  Emit @{ t = 'refresh'; case = 'other_window_untouched'; rid = @(GetF '_pendingRouteComposerRid'); ttlExtended = ([long](GetF '_pendingRouteExpiresAt') -gt $soon) }

  SetF '_pendingRouteArmed' $false
  SetF '_pendingRouteComposerRid' $RID_A
  Call 'MrRefreshPinOnDedup' @($PROMPT, $RID_B, $null, $HW) | Out-Null
  Emit @{ t = 'refresh'; case = 'unarmed_untouched'; rid = @(GetF '_pendingRouteComposerRid'); armed = [bool](GetF '_pendingRouteArmed') }
}

# ---- 6. Claude's own "Switch model?" confirmation dialog --------------------
# Live 2026-10-05: an existing conversation on "Opus 5.5 Medium", picker set to
# Sonnet -> Claude Desktop showed "Switch model?" with "Cancel" and "Switch to
# Sonnet 5.5" (focused); the route failed
# switch_not_verified_no_fallback_focus_not_in_composer and nothing was sent.
# The REAL RouteAwaitSwitch loop is driven against a scripted dialog and a fake
# clock; every UIA touch it makes goes through the RouteSwitchIo delegates.
foreach ($lbl in @('Model: Opus 5.5 Medium', 'Model: Sonnet 5.5 Medium', 'Model: Sonnet 5.5', 'Opus 5.5 Medium', 'Model: Sonnet 5.5 High', 'Model: Haiku 4.5')) {
  Emit @{ t = 'tierof'; label = $lbl; tier = [string](Call 'MrTierOfLabel' @('desktop_app', 'claude_desktop', $lbl)) }
  Emit @{ t = 'effort'; label = $lbl; effort = [string](Call 'ModelEffortFromLabel' @($lbl, 'Model:')) }
}

$hasAwait = (Has 'RouteAwaitSwitch') -and (Has 'RouteConfirmButtonMatches') -and (Has 'MrConfirmDialogCfg')
Emit @{ t = 'has'; name = 'RouteAwaitSwitch'; present = $hasAwait }
if ($hasAwait) {
  $cfg = Call 'MrConfirmDialogCfg' @('desktop_app', 'claude_desktop')
  $cfgType = $T.GetNestedType('RouteConfirmCfg', $FLAGS)
  Emit @{ t = 'cfg'; app = 'claude_desktop'; present = ($cfg -ne $null);
          prefix = $(if ($cfg) { [string]$cfgType.GetField('ButtonPrefix').GetValue($cfg) } else { '' });
          title = $(if ($cfg) { [string]$cfgType.GetField('TitleContains').GetValue($cfg) } else { '' });
          cancel = $(if ($cfg) { [string]$cfgType.GetField('CancelName').GetValue($cfg) } else { '' }) }
  Emit @{ t = 'cfg'; app = 'chatgpt_desktop'; present = ((Call 'MrConfirmDialogCfg' @('desktop_app', 'chatgpt_desktop')) -ne $null) }
  Emit @{ t = 'cfg'; app = 'browser_claude_ai'; present = ((Call 'MrConfirmDialogCfg' @('browser', 'claude.ai')) -ne $null) }

  $SONNET = New-Object 'System.Collections.Generic.List[string]'
  foreach ($x in @('Sonnet 5.5', 'Sonnet 5', 'Sonnet')) { $SONNET.Add($x) }
  $SONNET_OLD = New-Object 'System.Collections.Generic.List[string]'
  $SONNET_OLD.Add('Sonnet 5')
  foreach ($c in @(
      @('target_55',          'Switch to Sonnet 5.5', $SONNET),
      @('target_family_only', 'Switch to Sonnet',     $SONNET),
      @('lowercase',          'switch to sonnet 5.5', $SONNET),
      @('other_model',        'Switch to Opus 5.5',   $SONNET),
      @('cancel',             'Cancel',               $SONNET),
      @('no_prefix_boundary', 'Switch toSonnet 5.5',  $SONNET),
      @('override_label_old', 'Switch to Sonnet 5.5', $SONNET_OLD),
      @('bare_prefix',        'Switch to ',           $SONNET))) {
    Emit @{ t = 'btn'; case = $c[0]; match = [bool](Call 'RouteConfirmButtonMatches' @($c[1], 'Switch to ', ([System.Collections.Generic.List[string]]$c[2].psobject.BaseObject))) }
  }

  $ioType = $T.GetNestedType('RouteSwitchIo', $FLAGS)
  $seenType = $T.GetNestedType('RouteConfirmSeen', $FLAGS)
  $outType = $T.GetNestedType('RouteSwitchOutcome', $FLAGS)
  function SetDelegate($obj, [string]$field, [scriptblock]$sb) {
    $f = $ioType.GetField($field)
    $f.SetValue($obj, [System.Management.Automation.LanguagePrimitives]::ConvertTo($sb, $f.FieldType))
  }
  function OutF($o, [string]$n) { $outType.GetField($n).GetValue($o) }

  # One scripted Claude Desktop. $script:W is the world the delegates read.
  function RunWorld([string]$case, [hashtable]$world, $useCfg, [bool]$usedSelect) {
    $script:W = @{
      now = 0; label = 'Model: Opus 5.5 Medium'; target = 'Model: Sonnet 5.5 Medium';
      switchAt = $null; dialogAt = $null; closed = $false; title = $true;
      buttons = @('Switch to Sonnet 5.5'); confirmWorks = $true; dialogOnRetry = $false;
      invokes = 0; invokedNames = @(); dismissals = 0; retries = 0; probes = 0
    }
    foreach ($k in $world.Keys) { $script:W[$k] = $world[$k] }
    $io = [Activator]::CreateInstance($ioType, $true)
    SetDelegate $io 'NowMs' { [long]$script:W.now }
    SetDelegate $io 'Sleep' { param([int]$ms) $script:W.now += $ms }
    SetDelegate $io 'ReadLabel' {
      if ($script:W.switchAt -ne $null -and $script:W.now -ge $script:W.switchAt) { return [string]$script:W.target }
      return [string]$script:W.label
    }
    SetDelegate $io 'TierOf' { param([string]$l) [string](Call 'MrTierOfLabel' @('desktop_app', 'claude_desktop', $l)) }
    SetDelegate $io 'RetryActivate' {
      $script:W.retries++
      if ($script:W.dialogOnRetry) { $script:W.dialogAt = $script:W.now + 200 }
    }
    SetDelegate $io 'ProbeConfirm' {
      $script:W.probes++
      $s = [Activator]::CreateInstance($seenType, $true)
      if ($script:W.dialogAt -ne $null -and $script:W.now -ge $script:W.dialogAt -and -not $script:W.closed) {
        $seenType.GetField('Title').SetValue($s, [bool]$script:W.title)
        $list = $seenType.GetField('Buttons').GetValue($s)
        foreach ($b in $script:W.buttons) { $list.Add([string]$b) }
      }
      return $s
    }
    SetDelegate $io 'InvokeConfirm' {
      param([string]$name)
      $script:W.invokes++
      $script:W.invokedNames += $name
      if ($script:W.confirmWorks) { $script:W.closed = $true; $script:W.switchAt = $script:W.now + 150 }
      return $true
    }
    SetDelegate $io 'DismissConfirm' { $script:W.dismissals++; $script:W.closed = $true }

    $o = Call 'RouteAwaitSwitch' @($io, $useCfg, ([System.Collections.Generic.List[string]]$SONNET), 'standard', 'Model: Opus 5.5 Medium', $usedSelect, $false)
    $switched = [bool](OutF $o 'Switched')
    # What RunRoute does with the outcome: Switched -> its ONE routed Enter;
    # otherwise FallbackSendOrReport's ONE Enter (with the composer refocused,
    # possible only because a dialog still up was dismissed first).
    Emit @{ t = 'await'; case = $case; switched = $switched; reason = [string](OutF $o 'Reason');
            dialogSeen = [bool](OutF $o 'DialogSeen'); confirmInvokes = [int](OutF $o 'ConfirmInvokes');
            dismissals = [int](OutF $o 'Dismissals'); retries = [int](OutF $o 'Retries');
            invokedNames = @($script:W.invokedNames); worldInvokes = $script:W.invokes; worldDismissals = $script:W.dismissals;
            worldRetries = $script:W.retries; probes = $script:W.probes; elapsed = $script:W.now;
            dialogOpenAtEnd = ($script:W.dialogAt -ne $null -and -not $script:W.closed);
            labelAfter = [string](OutF $o 'LabelAfter'); sendPath = $(if ($switched) { 'routed' } else { 'fallback' }) }
  }

  RunWorld 'no_dialog_switches'      @{ switchAt = 200 }                                    $cfg $true
  RunWorld 'dialog_confirmed'        @{ dialogAt = 120 }                                    $cfg $true
  RunWorld 'dialog_after_retry'      @{ dialogOnRetry = $true }                             $cfg $true
  RunWorld 'dialog_never_confirms'   @{ dialogAt = 120; confirmWorks = $false }             $cfg $true
  RunWorld 'dialog_wrong_target'     @{ dialogAt = 120; buttons = @('Switch to Opus 5.5') } $cfg $true
  RunWorld 'dialog_title_only'       @{ dialogAt = 120; buttons = @() }                     $cfg $true
  RunWorld 'unrelated_switch_button' @{ dialogAt = 0; title = $false; buttons = @('Switch to dark mode') } $cfg $true
  RunWorld 'no_dialog_no_switch'     @{ }                                                   $cfg $true
  RunWorld 'late_dialog_dismissed'   @{ dialogAt = 2000 }                                   $cfg $true
  RunWorld 'no_cfg_app'              @{ dialogAt = 120 }                                    $null $true
}

# ---- 7. focus back on the composer before the ONE Enter ---------------------
# Live (e32cf4d): the dialog was confirmed and the model switched, then
# focus_lost_after_switch_no_fallback_focus_not_in_composer -- the prompt was
# never sent. The REAL RouteRefocusComposer loop, scripted world + fake clock.
$hasRefocus = Has 'RouteRefocusComposer'
Emit @{ t = 'has'; name = 'RouteRefocusComposer'; present = $hasRefocus }
if ($hasRefocus) {
  $rIoType = $T.GetNestedType('RouteRefocusIo', $FLAGS)
  $rOutType = $T.GetNestedType('RouteRefocusOutcome', $FLAGS)
  function SetRDelegate($obj, [string]$field, [scriptblock]$sb) {
    $f = $rIoType.GetField($field)
    $f.SetValue($obj, [System.Management.Automation.LanguagePrimitives]::ConvertTo($sb, $f.FieldType))
  }
  function RunRefocus([string]$case, [hashtable]$world) {
    $script:R = @{
      now = 0; window = 'same'; restoreFixes = $true; focusOk = $false;
      setFocusWorks = $false; clickWorks = $false; candidate = $null; userEdited = $false;
      focuses = 0; clicks = 0; restores = 0
    }
    foreach ($k in $world.Keys) { $script:R[$k] = $world[$k] }
    $io = [Activator]::CreateInstance($rIoType, $true)
    SetRDelegate $io 'NowMs' { [long]$script:R.now }
    SetRDelegate $io 'Sleep' { param([int]$ms) $script:R.now += $ms }
    SetRDelegate $io 'WindowState' { [string]$script:R.window }
    SetRDelegate $io 'RestoreForeground' { $script:R.restores++; if ($script:R.restoreFixes) { $script:R.window = 'same' } }
    SetRDelegate $io 'FocusVerdict' {
      if ($script:R.userEdited) { return 'text_changed' }
      if ($script:R.focusOk) { return $null }
      return 'focus_not_in_composer'
    }
    SetRDelegate $io 'CandidateVerdict' { if ($script:R.candidate) { return [string]$script:R.candidate }; return $null }
    SetRDelegate $io 'FocusCandidate' { $script:R.focuses++; if ($script:R.setFocusWorks) { $script:R.focusOk = $true }; return $true }
    SetRDelegate $io 'ClickCandidate' { $script:R.clicks++; if ($script:R.clickWorks) { $script:R.focusOk = $true }; return $true }
    $o = Call 'RouteRefocusComposer' @($io)
    $ok = [bool]$rOutType.GetField('Ok').GetValue($o)
    Emit @{ t = 'refocus'; case = $case; ok = $ok; reason = [string]$rOutType.GetField('Reason').GetValue($o);
            focuses = $script:R.focuses; clicks = $script:R.clicks; restores = $script:R.restores; elapsed = $script:R.now;
            # What RunRoute does: ok -> its ONE Enter; otherwise no Enter at all.
            enters = $(if ($ok) { 1 } else { 0 }) }
  }
  RunRefocus 'already_focused'            @{ focusOk = $true }
  RunRefocus 'focus_in_menu_setfocus_ok'  @{ setFocusWorks = $true }
  RunRefocus 'setfocus_ignored_click_ok'  @{ clickWorks = $true }
  RunRefocus 'refocus_never_works'        @{ }
  RunRefocus 'user_edited'                @{ userEdited = $true }
  RunRefocus 'composer_text_changed'      @{ candidate = 'text_changed' }
  RunRefocus 'composer_gone'              @{ candidate = 'no_element' }
  RunRefocus 'other_app_foreground'       @{ window = 'other'; setFocusWorks = $true }
  RunRefocus 'same_process_modal'         @{ window = 'same_process'; setFocusWorks = $true }
  RunRefocus 'same_process_stuck'         @{ window = 'same_process'; restoreFixes = $false; setFocusWorks = $true }
}

Emit @{ t = 'done' }

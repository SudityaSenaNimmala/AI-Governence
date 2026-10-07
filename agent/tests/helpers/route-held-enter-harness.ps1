# Harness for "NEVER SEND BEFORE THE DECISION" and the opt-in user override
# (enforcer-win.ps1, 2026-10-07).
#
# Live evidence (agent 35419d9f = 74e47cc, Gemini in Edge, desktop web arm, no
# extension), UTC:
#   04:47:40.601 prompt (send)  Gemini      <- "hi"/"hello" on 3.1 Pro
#   04:47:42.127 model_routed applied simple 3.1 Pro -> 3.5 Flash-Lite
#   04:47:48.299 model_routed user_override  <- the user picked a model by hand
#   04:47:50/53  prompt, no routing          <- routing stood down for the conversation
#
# Driven through the REAL C# (lifted out of the .ps1, compiled, called by
# reflection). NOTHING HERE INSTALLS A HOOK, presses a key or touches a window:
# the hook's routing decision is the pure RouteEnterPlan, fed the same counters
# the hook reads; the held run's decision is the pure HeldEnterVerdict fed what
# the route thread would have read, plus the real classifier and the real
# decideRoute port.
#
# Output: one NDJSON line per observation (`t` field). Ends with {"t":"done"}.
param(
  [Parameter(Mandatory=$true)][string]$Ps1,
  [Parameter(Mandatory=$true)][string]$Catalog,
  # The REAL CFAI_MODEL_ROUTER_CONFIG payload (model-router-config.js buildLexiconConfig):
  # without it the classifier has no lexicon and answers 'unknown'.
  [Parameter(Mandatory=$true)][string]$RouterConfig
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

foreach ($n in @('RouteEnterPlan', 'MrKeyMayEdit', 'MrEligibleNow', 'MrPublishEligible', 'MrTouchEligible', 'StartHeldRoute',
                 'RunHeldEnter', 'HeldEnterVerdict', 'HeldSendUnrouted', 'HeldReleaseEnter', 'MrIsSubmittedText',
                 'MrDedupSeq', 'MrMarkNoRoute', 'MrNoteSubmitted', 'MrNoteSubmittedFromHook', 'RunPinnedRoute')) {
  Emit @{ t = 'has'; name = $n; present = (Has $n) }
}

$PASS = 0; $PIN = 1; $HOLD = 2
function PlanName([int]$p) { switch ($p) { 0 { 'pass' } 1 { 'pin' } 2 { 'hold' } default { "?$p" } } }
function Plan([string]$case, [bool]$injected, [bool]$eligible, [bool]$pinArmed, [long]$pinSeq, [long]$decidedSeq, [long]$curSeq, [long]$sentSeq) {
  $p = [int](Call 'RouteEnterPlan' @($injected, $eligible, $pinArmed, $pinSeq, $decidedSeq, $curSeq, $sentSeq))
  Emit @{ t = 'plan'; case = $case; plan = (PlanName $p) }
}

# ---- 1. THE HOOK'S PLAN (pure) ----------------------------------------------
# A fast "hi" + Enter from an empty composer: the poll thread never decided for
# seq 2 (its last read was the empty composer). Before: no pin -> unrouted send.
Plan 'enter_before_any_pin'              $false $true  $false -2 -2  2 -1
# The pin is for the text BEFORE the last keystrokes.
Plan 'pin_for_previous_text'             $false $true  $true   5 -2  7 -1
# The pin is for exactly this text.
Plan 'pin_for_this_text'                 $false $true  $true   7 -2  7 -1
# The poll thread decided NOT to route exactly this text (noop / already there).
Plan 'no_route_decided_for_this_text'    $false $true  $false -2  7  7 -1
# A no-route decision for an OLDER text: decide again.
Plan 'no_route_decided_for_older_text'   $false $true  $false -2  6  7 -1
# Nothing typed since the last send: never routed, never held.
Plan 'nothing_typed_since_send'          $false $true  $false -2 -2  9  9
# Our own (injected) Enter, and another program's: never held.
Plan 'injected_enter_no_pin'             $true  $true  $false -2 -2  7 -1
Plan 'injected_enter_with_pin'           $true  $true  $true   7 -2  7 -1
# A surface that is not routing-eligible right now: the old behaviour exactly.
Plan 'not_eligible_no_pin'               $false $false $false -2 -2  7 -1
Plan 'not_eligible_with_pin'             $false $false $true   5 -2  7 -1

# ---- 2. which keys move the edit sequence ------------------------------------
foreach ($c in @(@('letter', 0x48, $false), @('enter', 0x0D, $false), @('shift_enter', 0x0D, $true), @('backspace', 0x08, $false),
                 @('shift', 0x10, $false), @('lshift', 0xA0, $false), @('ctrl', 0x11, $false), @('alt', 0x12, $false),
                 @('win', 0x5B, $false), @('capslock', 0x14, $false), @('v_for_paste', 0x56, $false), @('delete', 0x2E, $false))) {
  Emit @{ t = 'key'; case = $c[0]; edits = [bool](Call 'MrKeyMayEdit' @([int]$c[1], [bool]$c[2])) }
}

# ---- 3. eligibility: published by the poll thread, read by the hook ----------
$HW = [IntPtr]0x5A5A
$OTHER = [IntPtr]0x6B6B
SetF '_mrEligible' $null
Emit @{ t = 'eligible'; case = 'nothing_published'; eligible = [bool](Call 'MrEligibleNow' @($HW)) }
[void](Call 'MrPublishEligible' @($false, $HW, '', 0, $null, 'claude_desktop'))
Emit @{ t = 'eligible'; case = 'published_same_window'; eligible = [bool](Call 'MrEligibleNow' @($HW)) }
Emit @{ t = 'eligible'; case = 'published_other_window'; eligible = [bool](Call 'MrEligibleNow' @($OTHER)) }
# Stale: the poll thread stopped refreshing it (stalled, or the surface stopped qualifying).
$snap = GetF '_mrEligible'
$snapT = $T.GetNestedType('MrSurfaceSnap', $FLAGS)
$snapT.GetField('AtMs').SetValue($snap, [long](Call 'RouteNowMs') - 5000)
Emit @{ t = 'eligible'; case = 'stale'; eligible = [bool](Call 'MrEligibleNow' @($HW)) }
# The composer is empty this tick (the moment before a fast "hi"): still eligible.
[void](Call 'MrTouchEligible' @($HW))
Emit @{ t = 'eligible'; case = 'touched_on_empty_composer'; eligible = [bool](Call 'MrEligibleNow' @($HW)) }

# ---- 4. live router state: catalog + policy ----------------------------------
# The router config FIRST: loading it resets the router's catalog/policy state.
[void](Call 'LoadModelRouterConfig' @([System.IO.File]::ReadAllText($RouterConfig, [System.Text.UTF8Encoding]::new($false))))
Emit @{ t = 'lexicon'; loaded = [bool](GetF '_mrLexiconLoaded') }
$catalogJson = [System.IO.File]::ReadAllText($Catalog)
$ser = New-Object System.Web.Script.Serialization.JavaScriptSerializer
$ser.MaxJsonLength = 5 * 1024 * 1024
SetF '_mrCatalog' ($ser.DeserializeObject($catalogJson))
$SERVER_DEFAULT = '{"cmd":"router_policy","policy":{"version":"p-sd","rules":[],"catalog_overrides":[],"settings":{"allow_upgrade":true,"respect_user_override":false},"fleet_enabled":true}}'
$NO_SETTINGS    = '{"cmd":"router_policy","policy":{"version":"p-ns","rules":[],"catalog_overrides":[],"fleet_enabled":true}}'
$RESPECT        = '{"cmd":"router_policy","policy":{"version":"p-rs","rules":[],"catalog_overrides":[],"settings":{"allow_upgrade":true,"respect_user_override":true},"fleet_enabled":true}}'
[void](Call 'ApplyRouterPolicyLine' @($SERVER_DEFAULT))

$metaT = $T.GetNestedType('RouteMeta', $FLAGS)
function GeminiMeta([string]$conv) {
  $m = [Activator]::CreateInstance($metaT)
  $m.Surface = 'browser'; $m.HostOrApp = 'gemini.google.com'
  $m.ChoiceKey = 'browser|gemini.google.com|google'; $m.ConvKey = $conv
  return $m
}
$PRO = 'Open mode picker, currently 3.1 Pro'
$proTier = [string](Call 'MrTierOfLabel' @('browser', 'gemini.google.com', $PRO))
Emit @{ t = 'tierof'; case = 'gemini_pro'; tier = $proTier }

# ---- 5. THE HELD ENTER, decided at send time ---------------------------------
# What the route thread does after the hook held the Enter: classify the LIVE
# text, decide, and pick one outcome. The classifier is timed for real.
# NOTE: no [string] casts on the nullable arguments -- PowerShell turns $null
# into '' for a [string] parameter, and '' is not 'nothing read wrong'.
function HeldCase([string]$case, [string]$text, [string]$curTier, $sentText, [bool]$sentRecently, $readWhy, [int]$extraMs) {
  $sw = [Diagnostics.Stopwatch]::StartNew()
  $complexity = ''
  $routed = $false; $to = ''; $toLabel = ''
  if (-not $readWhy -and $text.Trim().Length -gt 0) {
    $complexity = [string](Call 'ClassifyComplexity' @($text))
    $d = Call 'MrDecideForPin' @((GeminiMeta 'held-1'), 'msedge', $curTier, $complexity, '', $text.Length)
    if ($null -ne $d) { $routed = $true; $to = [string]$d.TargetTier; $toLabel = [string]$d.ToLabel }
  }
  $decideMs = [int]$sw.ElapsedMilliseconds
  $v = [string](Call 'HeldEnterVerdict' @($readWhy, $text, $sentText, $sentRecently, $routed, [long]($decideMs + $extraMs), 400))
  Emit @{ t = 'held'; case = $case; verdict = $v; complexity = $complexity; toTier = $to; toLabel = $toLabel; decideMs = $decideMs }
}
# Warm the classifier once (JIT + regex construction are a one-time cost in
# the agent process, paid long before the first Enter).
[void](Call 'ClassifyComplexity' @('warm up'))
HeldCase 'hi_on_pro_routes_down'         'hi'    $proTier $null $false $null 0
HeldCase 'hello_on_pro_routes_down'      'hello' $proTier $null $false $null 0
HeldCase 'already_on_target_sends_once'  'hi'    'economy' $null $false $null 0
HeldCase 'submitted_prompt_never_routed' 'hello' $proTier 'hello' $true $null 0
HeldCase 'same_words_long_after_send'    'hello' $proTier 'hello' $false $null 0
HeldCase 'decided_too_late_sends_unrouted' 'hi'  $proTier $null $false $null 1000
HeldCase 'empty_composer_releases_enter' ''      $proTier $null $false $null 0
HeldCase 'unreadable_releases_enter'     'hi'    $proTier $null $false 'composer_not_readable' 0
HeldCase 'extension_owned_releases'      'hi'    $proTier $null $false 'extension_owned' 0
HeldCase 'window_changed_abandons'       'hi'    $proTier $null $false 'focus_changed' 0
HeldCase 'navigated_abandons'            'hi'    $proTier $null $false 'navigated' 0

# ---- 6. never route a prompt that has already gone out -----------------------
SetF '_mrEditSeq' ([long]40)
SetF '_mrSentSeq' ([long]-1)
SetF '_mrSentText' $null
SetF '_mrLastReadText' 'hello'
SetF '_pendingRouteId' 'pin-1'
SetF '_pendingRouteArmed' $true
SetF '_pendingRouteSeq' ([long]40)
$before = [int](Call 'RouteEnterPlan' @($false, $true, $true, [long]40, [long]-2, [long]40, [long](GetF '_mrSentSeq')))
# The user's own Enter went through (the pin was not taken -- e.g. it expired).
[void](Call 'MrNoteSubmittedFromHook')
$after = [int](Call 'RouteEnterPlan' @($false, $true, [bool](GetF '_pendingRouteArmed'), [long](GetF '_pendingRouteSeq'), [long]-2, [long](GetF '_mrEditSeq'), [long](GetF '_mrSentSeq')))
Emit @{ t = 'submitted'; case = 'hook_send_drops_pin'; planBefore = (PlanName $before); pinArmedAfter = [bool](GetF '_pendingRouteArmed');
        planAfter = (PlanName $after); sentSeq = [long](GetF '_mrSentSeq') }
# The poll thread reads the composer before the page has emptied it: the
# submitted text, no key since -> never pinned.
Emit @{ t = 'submitted'; case = 'lagging_read_not_pinned'; isSubmitted = [bool](Call 'MrIsSubmittedText' @('hello', [long]40)) }
# A key pressed since: a NEW prompt (even if it reads the same).
Emit @{ t = 'submitted'; case = 'typed_since_is_new'; isSubmitted = [bool](Call 'MrIsSubmittedText' @('hello', [long]41)) }
Emit @{ t = 'submitted'; case = 'different_text_is_new'; isSubmitted = [bool](Call 'MrIsSubmittedText' @('hello there', [long]40)) }

# ---- 7. the poll thread's dedup keeps the decision exact ---------------------
SetF '_pendingRouteArmed' $false
SetF '_mrDecidedSeq' ([long]-2)
[void](Call 'MrMarkNoRoute' @([long]50))
[void](Call 'MrDedupSeq' @('hi', $HW, [long]52))
Emit @{ t = 'dedup'; case = 'no_route_decision_carries'; decidedSeq = [long](GetF '_mrDecidedSeq') }
# A ROUTED decision whose pin is gone (consumed / cleared) covers nothing.
SetF '_mrLastDecisionRouted' $true
SetF '_mrDecidedSeq' ([long]50)
[void](Call 'MrDedupSeq' @('hi', $HW, [long]53))
$p = [int](Call 'RouteEnterPlan' @($false, $true, $false, [long]-2, [long](GetF '_mrDecidedSeq'), [long]53, [long]-1))
Emit @{ t = 'dedup'; case = 'routed_without_pin_holds'; decidedSeq = [long](GetF '_mrDecidedSeq'); plan = (PlanName $p) }
# An armed pin for the same text in the same window follows the sequence.
SetF '_pendingRouteArmed' $true
SetF '_pendingRouteHwnd' $HW
SetF '_pendingRouteOriginalText' 'hi'
SetF '_pendingRouteSeq' ([long]50)
[void](Call 'MrDedupSeq' @('hi', $HW, [long]54))
Emit @{ t = 'dedup'; case = 'pin_follows_sequence'; pinSeq = [long](GetF '_pendingRouteSeq') }
SetF '_pendingRouteArmed' $false

# ---- 8. a manual model switch, then "hi" -------------------------------------
# The user's pick is recorded (user choice + the override), but with the
# default policy it no longer stands routing down: the next prompt is routed
# FROM the user's pick.
$ck = 'browser|gemini.google.com|google'
function Track([string]$conv, [string]$tier) {
  $args2 = [object[]]@($ck, $conv, $tier, $null)
  $r = [bool]$T.GetMethod('MrTrackPicker', $FLAGS).Invoke($null, $args2)
  return $r
}
[void](Track 'conv-G' 'premium')                       # first reading: 3.1 Pro
[void](Call 'MrNoteOurSwitch' @($ck, 'economy'))       # our route to Flash-Lite
[void](Track 'conv-G' 'economy')
[void](Call 'MrNoteRouted' @($ck, 'conv-G', 'economy'))
$overridden = Track 'conv-G' 'premium'                 # the user picks 3.1 Pro by hand
function DecideHi([string]$case) {
  $c = [string](Call 'ClassifyComplexity' @('hi'))
  $d = Call 'MrDecideForPin' @((GeminiMeta 'conv-G'), 'msedge', 'premium', $c, '', 2)
  Emit @{ t = 'manual'; case = $case; complexity = $c; routed = ($d -ne $null);
          toTier = $(if ($d) { [string]$d.TargetTier } else { '' }); toLabel = $(if ($d) { [string]$d.ToLabel } else { '' });
          convOverridden = [bool](Call 'MrConvOverridden' @('conv-G')); reportsOverride = [bool](Call 'MrReportOverride') }
}
Emit @{ t = 'manual'; case = 'switch_recorded'; overridden = $overridden; userTier = [string](Call 'MrUserTier' @($ck)) }
DecideHi 'server_default_routes_down'
[void](Call 'ApplyRouterPolicyLine' @($NO_SETTINGS))
DecideHi 'settings_missing_routes_down'
[void](Call 'ApplyRouterPolicyLine' @($RESPECT))
DecideHi 'explicit_respect_still_suppresses'
[void](Call 'ApplyRouterPolicyLine' @($SERVER_DEFAULT))

Emit @{ t = 'done' }

# Behavioural harness for enforcer-win.ps1's AI-216 WEB MODEL ROUTING path.
#
# NOTHING HERE INSTALLS A KEYBOARD HOOK. [CfaiEnforcer]::Start() is never
# called, so no hook, no mouse hook, no threads, no message pump. The C# source
# is lifted out of the .ps1 and compiled on its own, then the real functions are
# driven directly by reflection. Same shape and the same rules as
# tests/helpers/browser-block-harness.ps1, which is the reference.
#
# WHAT IS SUBSTITUTED, and it is only ever the READS:
#   1. the PICKER ELEMENT. SearchWebPickerBackground walks a browser's UIA tree,
#      so the harness supplies the OUTCOME it would have produced by setting (or
#      deliberately NOT setting) the element cache. "Picker absent" is modelled
#      as the cache being empty, which is exactly what a Free/Go account
#      produces at runtime.
#   2. the FOREGROUND WINDOW HANDLE, by calling UpdateWebModelRouting directly
#      with a synthetic hwnd instead of going through GetForegroundWindow.
# Everything that INTERPRETS a read is production code: the catalog parser
# (LoadWebSurfaces / ParseWebPicker), both flag gates (EnforcingWebSurface,
# EnforcingWebPicker), the pure matchers (ModelItemNameMatches,
# ModelEffortFromLabel), the search throttle (MaybeSearchWebPicker) and the pin
# logic itself.
#
# Emits one NDJSON line per observation on stdout; agent/tests asserts on them.
param([Parameter(Mandatory=$true)][string]$Ps1)

$ErrorActionPreference = 'Stop'

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
function Call([string]$n, [object[]]$a = @()) {
  $m = $T.GetMethod($n, $FLAGS)
  if (-not $m) { throw "no method $n" }
  try { return $m.Invoke($null, $a) } catch { throw $_.Exception.InnerException }
}
function Emit($obj) { Write-Output ($obj | ConvertTo-Json -Compress -Depth 6) }

# ---- the REAL shipped catalog payload ---------------------------------------
#
# Written out verbatim rather than trimmed, so what is under test is the
# payload buildWebSurfaceConfig() actually produces -- including claude.ai's
# ARMED modelPicker block and chatgpt.com's complete ABSENCE of one.
$WS_CLAUDE = '{"id":"claude_web","host":"claude.ai","product":"Claude","vendor":"Anthropic","platform":"claude_ai_project","newlineKeys":"shift_enter","postSendVerifyMs":1500,"sendButtonControlType":"Button","sendButtonName":"Send message","composerName":"Write your prompt to Claude","composerControlType":"Edit","composerNamePrefixes":[],"composerAutomationId":"","composerFocusableChildClassName":"","genericNames":[],"platforms":[],"agentReadMode":"","agentReadUrlPattern":"","agentReadEnforce":false,"agentReadVerified":false,"modelPickerControlType":"Button","modelPickerNamePrefix":"Model:","modelPickerItemControlTypes":["RadioButton","MenuItem"],"modelPickerTier3Label":"Opus 5.5","modelPickerTier2Label":"Sonnet 5.5","modelPickerTier1Label":"Haiku 4.5","modelPickerProvider":"anthropic","modelPickerFromTier":"button_label","modelPickerEnforce":true,"modelPickerVerified":true,"enforce":true,"verified":true}'
$WS_CHATGPT = '{"id":"chatgpt_web","host":"chatgpt.com","product":"ChatGPT","vendor":"OpenAI","platform":"openai_assistant","newlineKeys":"shift_enter","postSendVerifyMs":1500,"sendButtonControlType":"Button","sendButtonName":"Send prompt","composerName":"Chat with ChatGPT","composerControlType":"Edit","composerNamePrefixes":[],"composerAutomationId":"","composerFocusableChildClassName":"","genericNames":[],"platforms":[],"agentReadMode":"","agentReadUrlPattern":"","agentReadEnforce":false,"agentReadVerified":false,"modelPickerControlType":"","modelPickerNamePrefix":"","modelPickerItemControlTypes":[],"modelPickerTier3Label":"","modelPickerTier2Label":"","modelPickerTier1Label":"","modelPickerProvider":"","modelPickerFromTier":"","modelPickerEnforce":false,"modelPickerVerified":false,"enforce":true,"verified":true}'
# claude.ai with the picker's OWN pair half-down. The surface stays fully armed
# in both, which is what proves the two gates are independent.
$WS_CLAUDE_HALF1 = $WS_CLAUDE.Replace('"modelPickerVerified":true', '"modelPickerVerified":false')
$WS_CLAUDE_HALF2 = $WS_CLAUDE.Replace('"modelPickerEnforce":true', '"modelPickerEnforce":false')
# claude.ai with NO picker block at all in the payload -- the shape every other
# surface ships, and the shape a rolled-back flag flip would produce.
$WS_CLAUDE_NOPICKER = $WS_CLAUDE.Replace('"modelPickerNamePrefix":"Model:"', '"modelPickerNamePrefix":""')

Call 'LoadWebSurfaces' @('[' + $WS_CLAUDE + ',' + $WS_CHATGPT + ']') | Out-Null
Call 'LoadBrowserProcesses' @(,[string[]]@('chrome','msedge','brave','vivaldi','opera','firefox')) | Out-Null

# ---- 1. the constants, for the JS lockstep test -----------------------------
Emit @{
  t = 'constants'
  namePrefix = $T.GetField('MODEL_PICKER_NAME_PREFIX_DEFAULT', $FLAGS).GetRawConstantValue()
  controlType = $T.GetField('MODEL_PICKER_CONTROL_TYPE_DEFAULT', $FLAGS).GetRawConstantValue()
  itemTypes = $T.GetField('MODEL_PICKER_ITEM_CONTROL_TYPES_DEFAULT', $FLAGS).GetRawConstantValue()
  giveUp = $T.GetField('WEB_PICKER_EMPTY_RUNS_BEFORE_GIVE_UP', $FLAGS).GetRawConstantValue()
  backoff = $T.GetField('WEB_PICKER_EMPTY_RUNS_BEFORE_BACKOFF', $FLAGS).GetRawConstantValue()
  effortTokens = (GetF 'MODEL_EFFORT_TOKENS')
}

# ---- 2. ModelItemNameMatches, against the JS twin's own table ---------------
$matchCases = @(
  @('Opus 5 For complex tasks', 'Opus 5'),
  @('Sonnet 5 Most efficient for everyday tasks', 'Sonnet 5'),
  @('Haiku 4.5 Fastest for quick answers', 'Haiku 4.5'),
  @('Sonnet 5.5 Something', 'Sonnet 5'),
  @('Sonnet 50 Something', 'Sonnet 5'),
  @('Opus 5x Experimental', 'Opus 5'),
  @('Opus 5-preview', 'Opus 5'),
  @('Haiku 4.55 Faster', 'Haiku 4.5'),
  @('Sonnet 5', 'Sonnet 5'),
  @('sonnet 5 whatever', 'Sonnet 5'),
  @('', 'Sonnet 5'),
  @('Sonnet 5 x', ''),
  @('Effort High', 'Opus 5'),
  @('More models', 'Opus 5')
)
foreach ($c in $matchCases) {
  Emit @{ t = 'match'; name = $c[0]; label = $c[1]; result = [bool](Call 'ModelItemNameMatches' @($c[0], $c[1])) }
}

# ---- 3. ModelEffortFromLabel, against the JS twin ---------------------------
$effortCases = @('Model: Opus 5 High','Model: Sonnet 5 Medium','Model: Haiku 4.5 Low','Model: Opus 5 Turbo','Model: Opus 5','Model:  Opus 5  High')
foreach ($lbl in $effortCases) {
  Emit @{ t = 'effort'; label = $lbl; result = [string](Call 'ModelEffortFromLabel' @($lbl, 'Model:')) }
}

# ---- 4. EnforcingWebPicker: BOTH flags, and it takes the SURFACE ------------
function PickerFor([string]$siteHost) {
  $surface = Call 'MatchWebSurface' @($siteHost)
  if (-not $surface) { return $null }
  return Call 'EnforcingWebPicker' @($surface)
}
Emit @{ t = 'gate'; case = 'claude_armed';  found = ((PickerFor 'claude.ai') -ne $null) }
Emit @{ t = 'gate'; case = 'chatgpt_none';  found = ((PickerFor 'chatgpt.com') -ne $null) }
Emit @{ t = 'gate'; case = 'unknown_host';  found = ((PickerFor 'example.com') -ne $null) }

Call 'LoadWebSurfaces' @('[' + $WS_CLAUDE_HALF1 + ',' + $WS_CHATGPT + ']') | Out-Null
Emit @{ t = 'gate'; case = 'enforce_only';  found = ((PickerFor 'claude.ai') -ne $null); surfaceStillArmed = ((Call 'EnforcingWebSurface' @('claude.ai')) -ne $null) }
Call 'LoadWebSurfaces' @('[' + $WS_CLAUDE_HALF2 + ',' + $WS_CHATGPT + ']') | Out-Null
Emit @{ t = 'gate'; case = 'verified_only'; found = ((PickerFor 'claude.ai') -ne $null); surfaceStillArmed = ((Call 'EnforcingWebSurface' @('claude.ai')) -ne $null) }
Call 'LoadWebSurfaces' @('[' + $WS_CLAUDE_NOPICKER + ',' + $WS_CHATGPT + ']') | Out-Null
Emit @{ t = 'gate'; case = 'no_signature';  found = ((PickerFor 'claude.ai') -ne $null); surfaceStillArmed = ((Call 'EnforcingWebSurface' @('claude.ai')) -ne $null) }

# Back to the real shipped payload for everything below.
Call 'LoadWebSurfaces' @('[' + $WS_CLAUDE + ',' + $WS_CHATGPT + ']') | Out-Null

# ---- 5. the tier-label lookup ----------------------------------------------
$claudePicker = PickerFor 'claude.ai'
foreach ($n in @(3,2,1)) {
  Emit @{ t = 'tierlabel'; tier = $n; label = [string](Call 'WebPickerTierLabel' @($claudePicker, $n)) }
}

# ---- 6. THE PIN-CLEARING FIX ------------------------------------------------
#
# The picker read is substituted as ABSENT by leaving the element cache empty --
# which is precisely what an account with no picker produces at runtime. The
# search's give-up counter is pre-loaded so MaybeSearchWebPicker returns without
# starting a background thread, which makes this deterministic.
$HWND = [IntPtr]::new(0x4242)
$claudeSurface = Call 'MatchWebSurface' @('claude.ai')

function ResetRouteState {
  SetF '_webPickerCached' $null
  SetF '_webPickerHwnd' ([IntPtr]::Zero)
  SetF '_webPickerHost' ''
  SetF '_webPickerSearchInProgress' $false
  SetF '_fgWebHost' 'claude.ai'
  SetF '_browserNavGen' 7
  # Park the search on the SAME (hwnd, host, navGen) triple and at the give-up
  # count, so no background thread is started by these observations.
  SetF '_webPickerSearchHwnd' $HWND
  SetF '_webPickerSearchHost' 'claude.ai'
  SetF '_webPickerSearchNavGen' 7
  SetF '_webPickerEmptyRuns' 3
}

function ArmPin([string]$id) {
  SetF '_pendingRouteId' $id
  SetF '_pendingRouteArmed' $true
  SetF '_pendingRouteFromTier' 'premium'
  SetF '_pendingRouteToTier' 'standard'
  SetF '_pendingRouteToLabel' 'Sonnet 5'
  SetF '_pendingRouteOriginalText' 'some prompt'
  SetF '_pendingRouteExpiresAt' ([DateTime]::UtcNow.Ticks + [TimeSpan]::FromSeconds(15).Ticks)
}

# (a) NO pin armed when the picker is absent.
ResetRouteState
SetF '_pendingRouteId' ''
SetF '_pendingRouteArmed' $false
Call 'UpdateWebModelRouting' @($HWND, [uint32]1234, $claudeSurface, $claudePicker) | Out-Null
Emit @{ t = 'pin'; case = 'absent_no_arm'; armed = [bool](GetF '_pendingRouteArmed'); id = [string](GetF '_pendingRouteId') }

# (b) A pin armed on an EARLIER tick is CLEARED. This is the bug: without the
# fix the pin survives, the hook keeps swallowing Enter for the full 15s TTL,
# and every one of those Enters becomes a synthetic re-send on a page with no
# picker to drive.
ResetRouteState
ArmPin 'stale-route-id-from-an-earlier-tick'
$armedBefore = [bool](GetF '_pendingRouteArmed')
Call 'UpdateWebModelRouting' @($HWND, [uint32]1234, $claudeSurface, $claudePicker) | Out-Null
Emit @{
  t = 'pin'; case = 'absent_clears_stale'
  armedBefore = $armedBefore
  armedAfter = [bool](GetF '_pendingRouteArmed')
  idAfter = [string](GetF '_pendingRouteId')
  ctxAfter = ((GetF '_pendingRouteCtx') -ne $null)
}

# (c) The HOOK's route branch is not taken, so the clean-send path runs. The
# hook reads exactly these two fields under _routeLock and takes its branch on
# `routeArmed && routeId != ""`. Reproduced here as the hook reads it.
$hookRouteId = [string](GetF '_pendingRouteId')
$hookArmed = [bool](GetF '_pendingRouteArmed')
Emit @{
  t = 'hook'; case = 'absent_branch_not_taken'
  routeBranchTaken = ($hookArmed -and -not [string]::IsNullOrEmpty($hookRouteId))
}

# ---- 7. the GIVE-UP threshold ----------------------------------------------
#
# Drive MaybeSearchWebPicker directly and watch the counter. The background
# thread it would start immediately fails on a synthetic hwnd
# (AutomationElement.FromHandle throws, and the search swallows it), so what is
# observed here is the THROTTLE and the GIVE-UP, which is what the test is about.
#
# THE "DID IT SEARCH" SIGNAL is _webPickerLastSearchTicks, not the in-progress
# latch. The latch is cleared by the background thread's own `finally`, and on a
# synthetic hwnd that thread fails and finishes in microseconds -- so reading the
# latch is a race that reports a search which certainly happened as not having
# happened. The timestamp is assigned by MaybeSearchWebPicker itself, on THIS
# thread, immediately before the thread is spawned, and is never cleared. Zeroed
# before each probe, so non-zero afterwards means "a search was kicked" with no
# race at all. Zeroing it also disables the time throttle, which is not what any
# of these cases is testing.
function SearchProbe([string]$label, [IntPtr]$hwnd, [string]$siteHost, [int]$navGen, [int]$emptyRuns, [bool]$sameKey) {
  SetF '_webPickerCached' $null
  SetF '_webPickerSearchInProgress' $false
  SetF '_webPickerEmptyRuns' $emptyRuns
  SetF '_webPickerLastSearchTicks' ([long]0)
  SetF '_browserNavGen' $navGen
  SetF '_fgWebHost' $siteHost
  if ($sameKey) {
    SetF '_webPickerSearchHwnd' $hwnd
    SetF '_webPickerSearchHost' $siteHost
    SetF '_webPickerSearchNavGen' $navGen
  } else {
    SetF '_webPickerSearchHwnd' ([IntPtr]::new(0x9999))
    SetF '_webPickerSearchHost' 'other.example'
    SetF '_webPickerSearchNavGen' (-1)
  }
  Call 'MaybeSearchWebPicker' @($hwnd, [uint32]1234, $siteHost, $claudeSurface) | Out-Null
  $started = ([long](GetF '_webPickerLastSearchTicks') -ne 0)
  Emit @{ t = 'search'; case = $label; started = $started }
  # Let any spawned thread finish so it cannot race the next observation.
  Start-Sleep -Milliseconds 150
  SetF '_webPickerSearchInProgress' $false
}

# Same triple, at the give-up count -> STOPPED. Not "slower": stopped.
SearchProbe 'giveup_same_key' $HWND 'claude.ai' 7 3 $true
# Same triple, one below the give-up count -> still searching.
SearchProbe 'below_giveup' $HWND 'claude.ai' 7 2 $true
# A NAV-GEN BUMP resumes it, even though the counter is at the give-up value:
# a new page instance genuinely might have a picker.
SearchProbe 'navgen_bump_resumes' $HWND 'claude.ai' 8 3 $false
# A WINDOW CHANGE resumes it for the same reason.
SearchProbe 'window_change_resumes' ([IntPtr]::new(0x5151)) 'claude.ai' 7 3 $false
# A surface whose picker is not past both flags never searches at all.
Call 'LoadWebSurfaces' @('[' + $WS_CLAUDE_HALF1 + ',' + $WS_CHATGPT + ']') | Out-Null
$halfSurface = Call 'MatchWebSurface' @('claude.ai')
SetF '_webPickerSearchInProgress' $false
SetF '_webPickerEmptyRuns' 0
SetF '_webPickerSearchHwnd' ([IntPtr]::Zero)
SetF '_webPickerLastSearchTicks' ([long]0)
Call 'MaybeSearchWebPicker' @($HWND, [uint32]1234, 'claude.ai', $halfSurface) | Out-Null
Emit @{ t = 'search'; case = 'unarmed_picker_never_searches'; started = ([long](GetF '_webPickerLastSearchTicks') -ne 0) }
SetF '_webPickerSearchInProgress' $false

Emit @{ t = 'done' }

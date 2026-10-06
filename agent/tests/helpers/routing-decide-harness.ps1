# Harness for the C# PORT of shared/decide-route.js inside enforcer-win.ps1,
# and the enforcer behaviour built on it.
#
# NOTHING HERE INSTALLS A KEYBOARD HOOK. [CfaiEnforcer]::Start() is never
# called. The C# source is lifted out of the .ps1 and compiled on its own, then
# the real functions are driven by reflection -- the same shape and rules as
# tests/helpers/model-routing-harness.ps1.
#
# Input: -Cases, an NDJSON file the test writes. One line per case:
#   {"kind":"decide","id":"...","ctx":"<json>","policy":"<json>"}
#   {"kind":"label","id":"...","surface":"...","host":"...","policy":"<json>","text":"..."}
# (ctx / policy are JSON STRINGS so they reach the C# side byte-for-byte as the
# vectors file holds them -- no PowerShell object round-trip in between.)
#
# Output: one NDJSON line per observation. A line from the production code
# itself (a {"kind":"route",...} event) carries no `t`.
param(
  [Parameter(Mandatory=$true)][string]$Ps1,
  [Parameter(Mandatory=$true)][string]$Catalog,
  [Parameter(Mandatory=$true)][string]$Cases
)

$ErrorActionPreference = 'Stop'
# Rule names in the vectors carry non-ASCII ('→'); the console's OEM code page
# would turn them into a control byte and break the JSON line.
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
function Call([string]$n, [object[]]$a = @()) {
  $m = $T.GetMethod($n, $FLAGS)
  if (-not $m) { throw "no method $n" }
  try { return $m.Invoke($null, $a) } catch { throw $_.Exception.InnerException }
}
function Emit($obj) { [Console]::Out.WriteLine(($obj | ConvertTo-Json -Compress -Depth 6)); [Console]::Out.Flush() }

$catalogJson = [System.IO.File]::ReadAllText($Catalog)

# ---- 1. LOCKSTEP: every vector through the C# port -------------------------
foreach ($line in [System.IO.File]::ReadAllLines($Cases)) {
  if (-not $line.Trim()) { continue }
  $c = $line | ConvertFrom-Json
  if ($c.kind -eq 'decide') {
    $out = [string](Call 'DrDecideRouteJson' @($c.ctx, $c.policy, $catalogJson))
    Emit @{ t = 'decide'; id = $c.id; json = $out }
  } elseif ($c.kind -eq 'label') {
    $tier = [string](Call 'DrDetectTierJson' @($c.surface, $c.host, $c.policy, $catalogJson, $c.text))
    Emit @{ t = 'label'; id = $c.id; tier = $tier }
  }
}

# ---- 2. Live router state: the catalog and a policy ------------------------
$ser = New-Object System.Web.Script.Serialization.JavaScriptSerializer
$ser.MaxJsonLength = 5 * 1024 * 1024
SetF '_mrCatalog' ($ser.DeserializeObject($catalogJson))
$apps = New-Object 'System.Collections.Generic.Dictionary[string,string]' ([StringComparer]::OrdinalIgnoreCase)
$apps['claude'] = 'claude_desktop'
SetF '_mrDesktopApps' $apps
$DEFAULT_POLICY = '{"cmd":"router_policy","policy":{"version":"p1","rules":[],"catalog_overrides":[],"settings":{"allow_upgrade":true,"respect_user_override":true},"fleet_enabled":true}}'
[void](Call 'ApplyRouterPolicyLine' @($DEFAULT_POLICY))

function NewMeta([string]$surface, [string]$hostOrApp, [string]$conv) {
  $m = [Activator]::CreateInstance($T.GetNestedType('RouteMeta', $FLAGS))
  $m.Surface = $surface; $m.HostOrApp = $hostOrApp
  $m.ChoiceKey = "$surface|$hostOrApp|anthropic"; $m.ConvKey = $conv
  return $m
}
function ArmPin {
  SetF '_pendingRouteId' 'stale-id'
  SetF '_pendingRouteArmed' $true
  SetF '_pendingRouteExpiresAt' ([DateTime]::UtcNow.Ticks + [TimeSpan]::FromSeconds(15).Ticks)
}
function Note { [string](GetF '_routeNoteLine') }
function Decide([string]$label, $meta, [string]$tier, [string]$complexity, [string]$effort) {
  ArmPin
  [void](Call 'ClearRouteNote')
  $d = Call 'MrDecideForPin' @($meta, 'claude', $tier, $complexity, $effort, 42)
  Emit @{
    t = 'pin'; case = $label
    armedDecision = ($d -ne $null)
    toTier = $(if ($d) { [string]$d.TargetTier } else { '' })
    toLabel = $(if ($d) { [string]$d.ToLabel } else { '' })
    clickLabels = $(if ($d) { @($d.ClickLabels) } else { @() })
    pinArmed = [bool](GetF '_pendingRouteArmed')
    note = (Note)
  }
}

# ---- 3. NO-OP: already on the target tier arms nothing ----------------------
# Desktop: 'Model: Sonnet 5 Medium' is standard; a moderate prompt wants
# standard. Before the port, a server rule naming a label returned BEFORE any
# tier arithmetic and the picker was opened anyway.
$tierDesktop = [string](Call 'MrTierOfLabel' @('desktop_app', 'claude_desktop', 'Model: Sonnet 5 Medium'))
Emit @{ t = 'tierof'; case = 'desktop_sonnet'; tier = $tierDesktop }
Emit @{ t = 'tierof'; case = 'gemini_flash'; tier = [string](Call 'MrTierOfLabel' @('browser', 'gemini.google.com', 'Open mode picker, currently Flash')) }
Emit @{ t = 'tierof'; case = 'gemini_flash_lite'; tier = [string](Call 'MrTierOfLabel' @('browser', 'gemini.google.com', 'Open mode picker, currently Flash-Lite')) }
Emit @{ t = 'tierof'; case = 'desktop_app_key'; key = [string](Call 'DesktopAppKey' @('Claude.exe')) }

Decide 'desktop_noop_moderate_on_sonnet' (NewMeta 'desktop_app' 'claude_desktop' 'c1') $tierDesktop 'moderate' 'Medium'
# Same tier, but a rule naming a LABEL of that tier (the old early-return bug).
$RULE_LABEL_POLICY = '{"cmd":"router_policy","policy":{"version":"p2","rules":[{"id":"r-label","name":"moderate to Sonnet","enabled":true,"priority":1,"conditions":{"provider":["anthropic"],"complexity":["moderate"]},"action":{"ui_name":"Sonnet","model":"claude-sonnet-5"}}],"catalog_overrides":[],"settings":{"allow_upgrade":true,"respect_user_override":true},"fleet_enabled":true}}'
$applied = [bool](Call 'ApplyRouterPolicyLine' @($RULE_LABEL_POLICY))
Emit @{ t = 'reload'; case = 'rule_label_policy_applied'; applied = $applied }
Decide 'desktop_noop_rule_label_same_tier' (NewMeta 'desktop_app' 'claude_desktop' 'c1') 'standard' 'moderate' 'Medium'
[void](Call 'ApplyRouterPolicyLine' @($DEFAULT_POLICY))

# A real change still arms, with the catalog's labels, most specific first.
Decide 'desktop_routes_simple_to_haiku' (NewMeta 'desktop_app' 'claude_desktop' 'c2') 'premium' 'simple' 'High'
Decide 'web_gemini_simple_from_flash' (NewMeta 'browser' 'gemini.google.com' 'w1') 'standard' 'simple' ''
# Complex on Opus with effort read as Medium: tier unchanged, effort-only -> NOT armed.
Decide 'desktop_effort_only_not_armed' (NewMeta 'desktop_app' 'claude_desktop' 'c3') 'premium' 'complex' 'Medium'

# ---- 4. CONFIG RELOAD: a new policy changes the next decision, in place -----
$SIMPLE_TO_STANDARD = '{"cmd":"router_policy","policy":{"version":"p3","rules":[{"id":"r-floor","name":"simple stays on Sonnet","enabled":true,"priority":5,"schema_version":2,"scope":{"surfaces":["desktop_app"],"apps":["claude_desktop"]},"conditions":{"complexity":["simple"]},"action":{"type":"set_tier","target_tier":"standard"},"mode":"enforce"}],"catalog_overrides":[],"settings":{"allow_upgrade":true,"respect_user_override":true},"fleet_enabled":true}}'
SetF '_mrLastObservedKey' 'some-dedup-key'
$applied = [bool](Call 'ApplyRouterPolicyLine' @($SIMPLE_TO_STANDARD))
Emit @{ t = 'reload'; case = 'v2_applied'; applied = $applied; dedupReset = ([string](GetF '_mrLastObservedKey') -eq '') }
Decide 'reload_rule_now_applies' (NewMeta 'desktop_app' 'claude_desktop' 'c4') 'premium' 'simple' 'High'
# A malformed line keeps the policy it had.
$applied = [bool](Call 'ApplyRouterPolicyLine' @('{"cmd":"router_policy","policy":"not a policy"}'))
Emit @{ t = 'reload'; case = 'malformed_refused'; applied = $applied }
$applied = [bool](Call 'ApplyRouterPolicyLine' @('{"cmd":"router_policy"'))
Emit @{ t = 'reload'; case = 'truncated_refused'; applied = $applied }
Decide 'reload_kept_after_malformed' (NewMeta 'desktop_app' 'claude_desktop' 'c4') 'premium' 'simple' 'High'
# The legacy v1 array is accepted too.
$applied = [bool](Call 'ApplyRouterPolicyLine' @('{"cmd":"router_policy","policy":[{"id":"v1","name":"legacy","enabled":true,"conditions":{"provider":["anthropic"],"complexity":["simple"]},"action":{"ui_name":"Haiku","model":"claude-haiku-4-5"}}]}'))
Emit @{ t = 'reload'; case = 'legacy_array_applied'; applied = $applied }
Decide 'legacy_array_routes' (NewMeta 'desktop_app' 'claude_desktop' 'c5') 'premium' 'simple' 'High'
[void](Call 'ApplyRouterPolicyLine' @($DEFAULT_POLICY))

# ---- 5. FLEET FLAG ---------------------------------------------------------
SetF '_mrFleetEnabled' $false
Decide 'fleet_off_agent_flag' (NewMeta 'desktop_app' 'claude_desktop' 'c6') 'premium' 'simple' 'High'
SetF '_mrFleetEnabled' $true
[void](Call 'ApplyRouterPolicyLine' @($DEFAULT_POLICY.Replace('"fleet_enabled":true', '"fleet_enabled":false')))
Decide 'fleet_off_policy' (NewMeta 'desktop_app' 'claude_desktop' 'c6') 'premium' 'simple' 'High'
[void](Call 'ApplyRouterPolicyLine' @($DEFAULT_POLICY))
Decide 'fleet_back_on' (NewMeta 'desktop_app' 'claude_desktop' 'c6') 'premium' 'simple' 'High'

# ---- 6. USER CHOICE + USER OVERRIDE ----------------------------------------
$ck = 'desktop_app|claude_desktop|anthropic'
function Track([string]$label, [string]$conv, [string]$tier) {
  $routed = $null
  $args2 = [object[]]@($ck, $conv, $tier, $routed)
  $r = $T.GetMethod('MrTrackPicker', $FLAGS).Invoke($null, $args2)
  Emit @{ t = 'track'; case = $label; overridden = [bool]$r; routedTier = [string]$args2[3]; userTier = [string](Call 'MrUserTier' @($ck)) }
}
Track 'seed_first_reading' 'conv-A' 'premium'
# OUR route to economy: noted before the click, then verified.
[void](Call 'MrNoteOurSwitch' @($ck, 'economy'))
Track 'our_switch_not_user_choice' 'conv-A' 'economy'
[void](Call 'MrNoteRouted' @($ck, 'conv-A', 'economy'))
# The user puts it back: an override, once, and the user's choice moves.
Track 'user_switches_back' 'conv-A' 'premium'
Emit @{ t = 'override'; case = 'conv_suppressed'; overridden = [bool](Call 'MrConvOverridden' @('conv-A')); other = [bool](Call 'MrConvOverridden' @('conv-B')) }
Decide 'override_suppresses_routing' (NewMeta 'desktop_app' 'claude_desktop' 'conv-A') 'premium' 'simple' 'High'
Decide 'other_conversation_still_routes' (NewMeta 'desktop_app' 'claude_desktop' 'conv-B') 'premium' 'simple' 'High'

# ---- 7. EXTENSION OWNERSHIP of a browser ------------------------------------
[void](Call 'ApplyRoutingOwner' @('chrome', [long]90000))
Emit @{ t = 'owner'; case = 'chrome_owned'; chrome = [bool](Call 'RoutingOwnedByExtension' @('chrome')); chromeExe = [bool](Call 'RoutingOwnedByExtension' @('chrome.exe')); edge = [bool](Call 'RoutingOwnedByExtension' @('msedge')); claude = [bool](Call 'RoutingOwnedByExtension' @('claude')) }
[void](Call 'ApplyRoutingOwner' @('bad name;', [long]90000))
[void](Call 'ApplyRoutingOwner' @('msedge', [long]999999999))
$until = (GetF '_routingOwnedUntil')['msedge']
Emit @{ t = 'owner'; case = 'ttl_capped'; badRejected = (-not [bool](Call 'RoutingOwnedByExtension' @('bad name;'))); cappedOk = ($until -le ([DateTime]::UtcNow.Ticks + [TimeSpan]::FromSeconds(121).Ticks)) }
[void](Call 'ApplyRoutingOwner' @('msedge', [long]0))
Emit @{ t = 'owner'; case = 'released'; edge = [bool](Call 'RoutingOwnedByExtension' @('msedge')) }

# The WEB ARM stands down in an owned browser: UpdateModelRouting is driven with
# every browser-arm gate open, and whether it reached the picker search is read
# off _webPickerLastSearchTicks (set on THIS thread, never cleared).
$WS_CLAUDE = '{"id":"claude_web","host":"claude.ai","product":"Claude","vendor":"Anthropic","platform":"claude_ai_project","newlineKeys":"shift_enter","postSendVerifyMs":1500,"sendButtonControlType":"Button","sendButtonName":"Send message","composerName":"Write your prompt to Claude","composerControlType":"Edit","composerNamePrefixes":[],"composerAutomationId":"","composerFocusableChildClassName":"","genericNames":[],"platforms":[],"agentReadMode":"","agentReadUrlPattern":"","agentReadEnforce":false,"agentReadVerified":false,"modelPickerControlType":"Button","modelPickerNamePrefix":"Model:","modelPickerItemControlTypes":["RadioButton","MenuItem"],"modelPickerTier3Label":"Opus 5.5","modelPickerTier2Label":"Sonnet 5.5","modelPickerTier1Label":"Haiku 4.5","modelPickerProvider":"anthropic","modelPickerFromTier":"button_label","modelPickerEnforce":true,"modelPickerVerified":true,"enforce":true,"verified":true}'
Call 'LoadWebSurfaces' @('[' + $WS_CLAUDE + ']') | Out-Null
Call 'LoadBrowserProcesses' @(,[string[]]@('chrome','msedge')) | Out-Null
function BrowserTick([string]$label, [bool]$owned) {
  SetF '_modelRouterEnabled' $true
  SetF '_fgIsAi' $true
  SetF '_app' 'chrome'
  SetF '_fgIsBrowser' $true
  SetF '_fgWebHost' 'claude.ai'
  SetF '_fgIsWebComposer' $true
  SetF '_fgWebComposerReadable' $true
  SetF '_fgLeftAiTicks' 0
  SetF '_fgWebChromeFocused' $false
  SetF '_fgWebPasswordFocused' $false
  SetF '_webPickerCached' $null
  SetF '_webPickerSearchInProgress' $false
  SetF '_webPickerSearchHost' 'sentinel.invalid'
  SetF '_webPickerEmptyRuns' 0
  if ($owned) { [void](Call 'ApplyRoutingOwner' @('chrome', [long]90000)) } else { [void](Call 'ApplyRoutingOwner' @('chrome', [long]0)) }
  ArmPin
  Call 'UpdateModelRouting' | Out-Null
  Emit @{
    t = 'webarm'; case = $label
    pinArmed = [bool](GetF '_pendingRouteArmed')
    # Reaching the web arm with no cached picker kicks MaybeSearchWebPicker,
    # which stamps the search key with THIS host on this thread. The owned gate
    # returns before any of that.
    reachedWebArm = ([string](GetF '_webPickerSearchHost') -eq 'claude.ai')
  }
  # Let a kicked background search (over whatever window is in front) finish.
  Start-Sleep -Milliseconds 400
  SetF '_webPickerSearchInProgress' $false
}
BrowserTick 'owned_stands_down' $true
BrowserTick 'not_owned_proceeds' $false

Emit @{ t = 'done' }

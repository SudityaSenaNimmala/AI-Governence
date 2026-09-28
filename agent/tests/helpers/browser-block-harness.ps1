# Behavioural harness for enforcer-win.ps1's BROWSER (web-surface) path.
#
# NOTHING HERE INSTALLS A KEYBOARD HOOK. [CfaiEnforcer]::Start() is never
# called, so no hook, no mouse hook, no threads, no message pump. The C# source
# is lifted out of the .ps1 and compiled on its own, then the poll-thread state
# machine (ApplyForegroundTick / CheckFgBlocked) and the Enter predicate
# (EnterBlockActive) are driven directly by reflection. Same shape and the same
# rules as tests/helpers/panel-block-harness.ps1, which is the reference.
#
# WHAT IS SUBSTITUTED, and it is only ever the READS:
#   1. the omnibox URL. GetCachedBrowserUrl walks a browser's UIA tree, so the
#      harness supplies the OUTCOME + HOST it would have produced. The
#      catalog comparison itself is NOT substituted: the host is fed through the
#      REAL MatchWebSurface to decide Surface vs NotSurface, so the
#      normalisation and the dot-boundary suffix rule stay under test.
#   2. AutomationElement.FocusedElement. The harness supplies measured UIA
#      property values and runs the REAL NameLooksLikeBrowserChrome over the
#      Name, so the omnibox exclusion is production code here.
# Everything that INTERPRETS a read is production code, including every flag
# gate (EnforcingWebSurface), the whole latch, and the Enter predicate.
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

$WEBOUT_T = $T.GetNestedType('WebReadOutcome', $FLAGS)
if (-not $WEBOUT_T) { throw 'no nested WebReadOutcome enum' }
$WEB_UNREADABLE = [Enum]::Parse($WEBOUT_T, 'Unreadable')
$WEB_NOTSURFACE = [Enum]::Parse($WEBOUT_T, 'NotSurface')
$WEB_SURFACE    = [Enum]::Parse($WEBOUT_T, 'Surface')

$OUTCOME_T = $T.GetNestedType('AgentReadOutcome', $FLAGS)
$OUT_UNREADABLE = [Enum]::Parse($OUTCOME_T, 'Unreadable')

# ---- real catalog payloads ---------------------------------------------------
#
# $WEB_SHIPPED is byte-identical to what buildWebSurfaceConfig() ships TODAY:
# every entry enforce:false, verified:false. It is what proves the whole path is
# INERT as delivered.
#
# $WEB_CLAUDE_ARMED is a TEST-ONLY flip of claude.ai's pair, and nothing else.
# It exists because no shipped entry is an example of an armed surface, and the
# blocking behaviour still has to be exercised. chatgpt.com is deliberately left
# false/false in the same payload, so ONE tick sequence shows an armed host
# blocking and an unarmed one not -- per host, not per engine, which is the
# whole point of the flags being per entry.
$WS_CLAUDE_OFF   = '{"id":"claude_web","host":"claude.ai","product":"Claude","vendor":"Anthropic","platform":"claude_ai_project","newlineKeys":"shift_enter","postSendVerifyMs":1500,"sendButtonControlType":"Button","sendButtonName":"Send message","enforce":false,"verified":false}'
$WS_CLAUDE_ON    = '{"id":"claude_web","host":"claude.ai","product":"Claude","vendor":"Anthropic","platform":"claude_ai_project","newlineKeys":"shift_enter","postSendVerifyMs":1500,"sendButtonControlType":"Button","sendButtonName":"Send message","enforce":true,"verified":true}'
# enforce WITHOUT verified, and verified WITHOUT enforce. Neither may arm --
# both flags travel and both are read, in one place.
$WS_CLAUDE_HALF1 = '{"id":"claude_web","host":"claude.ai","product":"Claude","vendor":"Anthropic","platform":"claude_ai_project","newlineKeys":"shift_enter","postSendVerifyMs":1500,"enforce":true,"verified":false}'
$WS_CLAUDE_HALF2 = '{"id":"claude_web","host":"claude.ai","product":"Claude","vendor":"Anthropic","platform":"claude_ai_project","newlineKeys":"shift_enter","postSendVerifyMs":1500,"enforce":false,"verified":true}'
$WS_CHATGPT_OFF  = '{"id":"chatgpt_web","host":"chatgpt.com","product":"ChatGPT","vendor":"OpenAI","platform":"openai_assistant","newlineKeys":"shift_enter","postSendVerifyMs":1500,"sendButtonControlType":"","sendButtonName":"","enforce":false,"verified":false}'
# ARMED but UNPROBED: both flags true, both send-button fields EMPTY. This is a
# real shipping state -- a host that passed its Enter-blocking live pass but
# whose send button nobody has probed -- and it is what proves an empty
# signature means ENTER-ONLY blocking rather than a guessed rectangle.
$WS_CHATGPT_ON   = '{"id":"chatgpt_web","host":"chatgpt.com","product":"ChatGPT","vendor":"OpenAI","platform":"openai_assistant","newlineKeys":"shift_enter","postSendVerifyMs":1500,"sendButtonControlType":"","sendButtonName":"","enforce":true,"verified":true}'
$WS_GEMINI_OFF   = '{"id":"gemini_web","host":"gemini.google.com","product":"Gemini","vendor":"Google","platform":"gemini","newlineKeys":"shift_enter","postSendVerifyMs":1500,"sendButtonControlType":"","sendButtonName":"","enforce":false,"verified":false}'
# ARMED GEMINI, WITH A SEND-BUTTON SIGNATURE, and both halves of that are
# FIXTURE-ONLY. gemini.google.com ships enforce:false/verified:false AND with
# both send-button fields EMPTY because nobody has probed it -- so the
# signature below is INVENTED for this fixture and says nothing whatever about
# Gemini's real DOM. It exists so the app-switch scenarios run against a
# SECOND host, which is what proves the composer-cache fix is host-agnostic
# rather than something that happens to work on claude.ai.
$WS_GEMINI_ON    = '{"id":"gemini_web","host":"gemini.google.com","product":"Gemini","vendor":"Google","platform":"gemini","newlineKeys":"shift_enter","postSendVerifyMs":1500,"sendButtonControlType":"Button","sendButtonName":"Send message","enforce":true,"verified":true}'

$WEB_SHIPPED       = '[' + $WS_CLAUDE_OFF + ',' + $WS_CHATGPT_OFF + ',' + $WS_GEMINI_OFF + ']'
$WEB_CLAUDE_ARMED  = '[' + $WS_CLAUDE_ON  + ',' + $WS_CHATGPT_OFF + ',' + $WS_GEMINI_OFF + ']'
$WEB_BOTH_ARMED    = '[' + $WS_CLAUDE_ON  + ',' + $WS_CHATGPT_ON  + ',' + $WS_GEMINI_OFF + ']'
$WEB_HALF1         = '[' + $WS_CLAUDE_HALF1 + ',' + $WS_CHATGPT_OFF + ',' + $WS_GEMINI_OFF + ']'
$WEB_HALF2         = '[' + $WS_CLAUDE_HALF2 + ',' + $WS_CHATGPT_OFF + ',' + $WS_GEMINI_OFF + ']'
$WEB_GEMINI_ARMED  = '[' + $WS_CLAUDE_OFF + ',' + $WS_CHATGPT_OFF + ',' + $WS_GEMINI_ON + ']'
$WEB_EMPTY         = '[]'

function LoadWeb([string]$json) { Call 'LoadWebSurfaces' @($json) | Out-Null }
# Exactly what enforcer.js ships: browserProcNames().
Call 'LoadBrowserProcesses' @(,[string[]]@('chrome','msedge','brave','vivaldi','opera','firefox')) | Out-Null

# Start() is never called, so these are null and every path that touches them
# would throw a NullReferenceException instead of answering. Supplied exactly as
# enforcer.js would (minus a browser, which must NEVER be in the AI set).
$aiProcSet = New-Object 'System.Collections.Generic.HashSet[string]' -ArgumentList @([System.StringComparer]::OrdinalIgnoreCase)
foreach ($p in @('M365Copilot','Copilot','ChatGPT','Claude','Gemini')) { $null = $aiProcSet.Add($p) }
SetF '_aiProcs' $aiProcSet
$PATINFO_T = $T.GetNestedType('PatInfo', $FLAGS)
$patListType = [System.Collections.Generic.List`1].MakeGenericType($PATINFO_T)
SetF '_patInfos' ([Activator]::CreateInstance($patListType))
# No AI_PANELS and no AGENT_SURFACES at all: a browser must be governed with
# neither, and leaving both empty proves the browser path borrows nothing from
# them. _hostAppProcs stays empty too, so `hostApp` is false everywhere here.
Call 'LoadAiPanels' @('[]') | Out-Null

# ---- blocked-row fixtures ---------------------------------------------------
#
# Exactly what synthesizePlatformBlocks([{host:'claude.ai', ..., blocked:true}])
# now emits for the browser: a row keyed on browser_host, carrying `host` so an
# approved exception can subtract it, and carrying NO process_name.
$ROWS_CLAUDE_WEB = '[{"platform":"ai_platform","browser_host":"claude.ai","agent_name":"Claude","agent_id":"","host":"claude.ai","reason":"Blocked by organization policy"}]'
$ROWS_CHATGPT_WEB = '[{"platform":"ai_platform","browser_host":"chatgpt.com","agent_name":"ChatGPT","agent_id":"","host":"chatgpt.com","reason":"Blocked by organization policy"}]'
$ROWS_BOTH_WEB = '[{"platform":"ai_platform","browser_host":"claude.ai","agent_name":"Claude","agent_id":"","host":"claude.ai","reason":"Blocked by organization policy"},{"platform":"ai_platform","browser_host":"chatgpt.com","agent_name":"ChatGPT","agent_id":"","host":"chatgpt.com","reason":"Blocked by organization policy"}]'
# THE ROW THAT MUST NEVER BE HONOURED. process_name:'chrome' is matched
# process-WIDE by the enforcer, so honouring it would swallow Enter in every tab
# of the browser -- Gmail, Jira, the wiki, the address bar. It is unsynthesisable
# by construction (asserted in web-surfaces.test.mjs); this proves the .ps1
# refuses it even if one appeared from somewhere else.
$ROWS_CHROME_PROCESS = '[{"platform":"ai_platform","process_name":"chrome","agent_name":"Chrome","agent_id":"","host":"claude.ai","reason":"Blocked by organization policy"}]'
# The same idea through PLATFORM_PROCS: claude_ai_project maps to the Claude
# DESKTOP process and to nothing else, so it must not reach a browser through the
# coarse arm. A browser is reachable ONLY through the element-scoped web arm.
$ROWS_PLATFORM_DESKTOP = '[{"platform":"claude_ai_project","agent_name":"Claude","agent_id":"","reason":"Blocked by admin"}]'
# A platform-scoped row whose platform the claude.ai WEB surface claims. This is
# what WEB_SURFACES.platform exists for -- it lets such a row reach a TAB without
# PLATFORM_PROCS gaining a browser entry.
$ROWS_PLATFORM_WEB = '[{"platform":"claude_ai_project","agent_name":"Claude","agent_id":"","reason":"Blocked by admin"}]'
# The SAME platform row, agent-scoped. Nothing in a browser can tell which agent
# a page has open, so "cannot tell" must mean NO BLOCK.
$ROWS_PLATFORM_WEB_AGENT = '[{"platform":"claude_ai_project","agent_name":"Some Agent","agent_id":"a1","reason":"Blocked by admin","agent_scope":"agent"}]'
# A browser_host row for the armed Gemini fixture -- the same shape
# synthesizePlatformBlocks emits for an Inventory host toggle.
$ROWS_GEMINI_WEB = '[{"platform":"ai_platform","browser_host":"gemini.google.com","agent_name":"Gemini","agent_id":"","host":"gemini.google.com","reason":"Blocked by organization policy"}]'
$ROWS_EMPTY = '[]'

function LoadRows([string]$json) {
  $script:tmpFile = Join-Path ([System.IO.Path]::GetTempPath()) ("cfai-web-harness-" + [guid]::NewGuid().ToString('N') + '.json')
  Set-Content -LiteralPath $script:tmpFile -Value $json -Encoding UTF8
  SetF '_blockedAgentFile' $script:tmpFile
  SetF '_lastBlockedCheck' ([long]0)
  Call 'UpdateBlockedAgents' | Out-Null
}
# The governed list is never populated here: a browser surface has no DLP-agent
# route at all, and pointing at an absent file is the "nothing is governed" state.
SetF '_governedAgentFile' (Join-Path ([System.IO.Path]::GetTempPath()) ("cfai-web-gov-absent-" + [guid]::NewGuid().ToString('N') + '.json'))

# ---- MEASURED browser UIA values -------------------------------------------
#
# (controlType, name) pairs. Probed live on this machine 2026-09.
$CHROME_PID = [uint32]4242
# claude.ai's prompt composer. An Edit named "Write your prompt to Claude" with
# ClassName "tiptap ProseMirror", readable via both ValuePattern and TextPattern.
$FOCUS_CLAUDE_COMPOSER = @('Edit', 'Write your prompt to Claude', $false, $true)
# THE OMNIBOX. Edge's accessible Name is exactly this string. It is an Edit in
# the same window as the composer, and Enter in it is a NAVIGATION -- swallowing
# that would stop the user leaving a blocked site.
$FOCUS_OMNIBOX = @('Edit', 'Address and search bar', $false, $true)
# Chromium's find-in-page bar and the tab-search box: browser chrome for the same
# reason, covered by the exact-name list.
$FOCUS_FIND_BAR = @('Edit', 'Find', $false, $true)
$FOCUS_TAB_SEARCH = @('Edit', 'Search tabs', $false, $true)
# A PASSWORD field on a web login form -- the single worst thing a keystroke
# buffer could reconstruct. IsPassword is the one property that names it.
$FOCUS_PASSWORD = @('Edit', 'Password', $true, $true)
# An ordinary web page composer that is NOT on a governed host: a Gmail compose
# body. Identical in shape to the Claude composer, which is exactly why the URL
# has to be the gate rather than the element.
$FOCUS_GMAIL_BODY = @('Document', 'Message Body', $false, $true)
# A non-editable element in the page (the transcript). Readable, and not a
# composer -- no evidence about anything, and no capture.
# A Document, which is what Chromium reports for the PAGE and for the transcript
# pane. Deliberately NOT a composer any more (see ReadFocusedWebComposer): if it
# were, the cached-composer read would scan the whole conversation transcript
# every 150ms. This fixture is what caught that.
$FOCUS_TRANSCRIPT = @('Document', 'Chat messages', $false, $true)
# A disabled/decorative element that reports a control type but cannot take the
# caret. Must not be mistaken for a composer.
$FOCUS_NOT_FOCUSABLE = @('Edit', 'Read only field', $false, $false)
# Gemini's prompt composer. NOT a live measurement -- unlike the fixtures
# above, this one is constructed, and it has to be said plainly: nobody has
# probed gemini.google.com, which is exactly why it ships with no send-button
# signature. What matters for the scenarios that use it is only the SHAPE the
# production rules test -- an Edit that is neither browser chrome nor a
# password field and can take the caret -- and that shape is real. The Name is
# fed through the REAL NameLooksLikeBrowserChrome either way.
$FOCUS_GEMINI_COMPOSER = @('Edit', 'Enter a prompt here', $false, $true)

# ---- One poll tick ----------------------------------------------------------
#
# $url is the string the omnibox would have handed back, or $null for an
# UNREADABLE read (no omnibox found, the read threw, an empty value).
# $focus is a (controlType, name, isPassword, isFocusable) tuple, or $null for a
# focused-element read that failed.
#
# The URL -> outcome decision runs the REAL MatchWebSurface and the REAL
# HostFromBrowserUrl, so scheme handling, the http/https restriction, the
# www-stripping and the dot-boundary suffix rule are all production code.
function WebTick([string]$scenario, [int]$n, $url, $focus,
                 [uint32]$fgPid = $CHROME_PID, [string]$proc = 'chrome',
                 [string]$title = 'A tab', [int]$hwnd = 1001,
                 [int]$agentOutcome = 0, [string]$agentName = '') {
  $outcome = $WEB_UNREADABLE
  $urlHost = ''
  $composer = $false
  $chrome = $false
  $readable = $false
  $password = $false
  # Is the CACHED composer readable this tick, whether or not it has focus? The
  # harness models the cache the same way the enforcer does: an element enters it
  # only by passing the full composer test WHILE FOCUSED, and it is dropped by a
  # navigation-generation bump, a window change or a host change. Everything that
  # DECIDES from it -- PanelUiaOk, UpdateUia's element choice, the govstate arm --
  # is production code.
  $composerReadable = $false
  $rid = ''

  # UpdateForeground's browserArmed gate, verbatim, against the REAL sets and
  # the REAL flag reader -- so the inert gate itself is under test rather than
  # assumed. With every shipped entry false/false, _anyWebSurfaceEnforcing is
  # false and NOTHING below runs.
  $isBrowser = [bool](( GetF '_browserProcs' ).Contains($proc))
  $armed = $isBrowser -and [bool](GetF '_anyWebSurfaceEnforcing')
  SetF '_fgIsBrowser' $isBrowser

  if ($armed) {
    if ($null -ne $url) {
      # GetCachedBrowserUrl's own classification, run for real on both halves:
      # the URL is parsed to a HOST by the production parser, and the host is
      # classified by the production catalog matcher.
      $urlHost = [string](Call 'HostFromBrowserUrl' @([string]$url))
      if ($urlHost.Length -eq 0) {
        $outcome = $WEB_NOTSURFACE
      } elseif ($null -ne (Call 'MatchWebSurface' @($urlHost))) {
        $outcome = $WEB_SURFACE
      } else {
        $outcome = $WEB_NOTSURFACE
      }
    }
    # THE INVALIDATION SWEEP, run for real. Only the title's FINGERPRINT crosses
    # the boundary, computed by the production hash -- the sweep never sees a
    # title -- and it is 0 unless the URL already said this tab is on a catalog
    # host, which is the gate that keeps a Gmail title from being read at all.
    $titleFp = [long]0
    if ($outcome -eq $WEB_SURFACE) { $titleFp = [long](Call 'TitleFingerprint' @([string]$title)) }
    Call 'UpdateBrowserNav' @([IntPtr]$hwnd, $(if ($outcome -eq $WEB_SURFACE) { $urlHost } else { '' }), $titleFp) | Out-Null

    # The element read happens ONLY on a catalog host that is past its OWN two
    # flags -- the ordering that IS the privacy gate. A Gmail composer, and the
    # composer of a catalogued-but-unverified host, are never even looked at.
    if ($outcome -eq $WEB_SURFACE -and $null -ne (Call 'EnforcingWebSurface' @($urlHost)) -and $null -ne $focus) {
      $ct = [string]$focus[0]; $nm = [string]$focus[1]
      $isPassword = [bool]$focus[2]; $focusable = [bool]$focus[3]
      $readable = ($ct.Trim().Length -gt 0)
      if ($readable) {
        # ReadFocusedWebComposer's own rules, with the REAL chrome test.
        $chrome = [bool](Call 'NameLooksLikeBrowserChrome' @($nm))
        $password = (-not $chrome) -and $isPassword
        $composer = (-not $chrome) -and (-not $isPassword) -and $focusable `
                    -and ($ct -ieq 'Edit')
        if ($composer) { $rid = '7.4242.4.9.11.5150' }
      }
    }
    # THE CACHE, modelled exactly as ReadFocusedWebComposer fills it: a focused
    # composer ENTERS it, and nothing else ever does. $script:webComposerGen
    # records the navigation generation it was filled at, which is what the
    # enforcer's DropWebComposer-on-bump achieves.
    if ($composer) {
      $script:webComposerCached = $true
      $script:webComposerHwnd = $hwnd
      $script:webComposerHost = $urlHost
      $script:webComposerGen = [int](GetF '_browserNavGen')
    }
    # The RE-VERIFY, and the fact that makes the fix work: it does NOT require
    # focus. A cached composer stays readable across a focus move inside the page
    # -- which is what keeps a paste detectable -- and is dropped by a window
    # change, a host change or a navigation bump.
    if ($script:webComposerCached) {
      if ($script:webComposerHwnd -ne $hwnd -or $script:webComposerHost -ne $urlHost `
          -or $script:webComposerGen -ne [int](GetF '_browserNavGen')) {
        $script:webComposerCached = $false
      } else {
        $composerReadable = $true
      }
    }
    # Only a SUCCESSFUL element read may move the sticky flags.
    if ($readable) { SetF '_fgWebChromeFocused' $chrome; SetF '_fgWebPasswordFocused' $password }
  }
  # UpdateForeground's APP-SWITCH branch, mirrored verbatim -- and the two
  # lines that are NOT here are the point. That branch used to call
  # DropWebComposer() and to null the send-button reference, which left the
  # click block unarmable after alt-tabbing back to the page unless the user
  # happened to click into the composer first: a bypass of the same class as
  # the unfocused click. It now clears the ANSWERS (the sticky flags, the
  # resolved host, the rect freshness stamp) and keeps the two cached
  # ELEMENTS, because in both cases the per-tick RE-VERIFY is the control.
  # $script:webComposerCached therefore SURVIVES here, exactly as
  # _webComposerCached does, and _fgWebComposerReadable is what goes false.
  if (-not $isBrowser) {
    SetF '_fgWebChromeFocused' $false
    SetF '_fgWebPasswordFocused' $false
    SetF '_fgWebHost' ''
    SetF '_webSendVerifiedTicks' ([long]0)
  }
  if ($outcome -ne $WEB_SURFACE) { $urlHost = '' }

  if (-not $isBrowser) { $composerReadable = $false }
  SetF '_fgWebComposerReadable' $composerReadable
  Call 'ApplyForegroundTick' @($fgPid, $proc, $false, $null, '', $false, $OUT_UNREADABLE, '',
                               $outcome, $urlHost, $composer, $rid, $composerReadable, $agentOutcome, $agentName) | Out-Null
  Call 'CheckFgBlocked' | Out-Null
  RunGovState
  Report $scenario $n $outcome $composer $chrome
}

# ---- govstate, run for real on every tick ----------------------------------
$script:govEmitted = $false
function RunGovState() {
  $before = [bool](GetF '_govActive')
  Call 'UpdateGovState' | Out-Null
  $script:govEmitted = ($before -ne [bool](GetF '_govActive'))
}

# ---- The typed buffer, driven exactly as the hook drives it ----------------
#
# The hook's ONE buffer line, reproduced verbatim: when _fgOwnerKey differs from
# _typedOwnerKey the buffer is cleared. The gate on whether a character is
# appended at all is the REAL FgIsAiNow(). Nothing here re-implements a decision;
# it reproduces the two lines of the hook that are not reachable offline.
function TypeChars([string]$s) {
  $ownerKey = [string](GetF '_fgOwnerKey')
  if ($ownerKey -ne [string](GetF '_typedOwnerKey')) {
    Call 'TypedClear' | Out-Null
    SetF '_typedOwnerKey' $ownerKey
    SetF '_blockTyped' $false
    SetF '_typedPatterns' ''
  }
  if ([bool](Call 'FgIsAiNow')) {
    foreach ($c in $s.ToCharArray()) { Call 'TypedAppend' @([char]$c) | Out-Null }
  }
}

function ResetState() {
  SetF '_fgIsAi' $false
  SetF '_fgIsPanel' $false
  SetF '_fgPanelId' ''
  SetF '_fgPanelEnforce' $false
  SetF '_fgLeftAiTicks' ([long]0)
  SetF '_fgPid' ([uint32]0)
  SetF '_app' ''
  SetF '_fgIsBlocked' $false
  SetF '_blockedByElement' $false
  SetF '_blockScope' ''
  SetF '_blockedBrowserHost' ''
  SetF '_fgWebOutcome' $WEB_UNREADABLE
  SetF '_fgWebHost' ''
  SetF '_fgIsWebComposer' $false
  SetF '_fgWebChromeFocused' $false
  SetF '_fgIsBrowser' $false
  SetF '_fgWebGoverned' $false
  SetF '_fgWebGovHost' ''
  SetF '_fgAgentOutcome' $OUT_UNREADABLE
  SetF '_fgAgentName' ''
  Call 'ClearPanelBlockLatch' | Out-Null
  SetF '_disarmedUntilTicks' ([long]0)
  SetF '_lastBlockFiredTicks' ([long]0)
  SetF '_blockTyped' $false
  SetF '_typedPatterns' ''
  SetF '_typedOwnerKey' ''
  Call 'TypedClear' | Out-Null
  SetF '_blockUia' $false
  SetF '_blockPaste' $false
  Call 'ClearAttachHolds' | Out-Null
  SetF '_lastPasteTicks' ([long]0)
  SetF '_lastFocusMoveInputTicks' ([long]0)
  SetF '_browserNavInputTicks' ([long]0)
  SetF '_browserNavSeenTicks' ([long]0)
  SetF '_browserTitleFingerprint' ([long]0)
  SetF '_browserNavHwnd' ([IntPtr]::Zero)
  SetF '_browserNavHost' ''
  SetF '_govActive' $false
  SetF '_govPid' ([uint32]0)
  SetF '_govKey' ''
  SetF '_fgHostGoverned' $false
  SetF '_fgHostGovPanel' ''
  SetF '_fgHostGovAgent' ''
  SetF '_fgHostGovAgentId' ''
  $script:govEmitted = $false
  $script:webComposerCached = $false
  $script:webComposerHwnd = 0
  $script:webComposerHost = ''
  $script:webComposerGen = -1
  SetF '_fgWebComposerReadable' $false
  SetF '_fgWebPasswordFocused' $false
  # AI-219. The agent id the URL named, cleared with every other per-tick
  # answer so no scenario can inherit the previous one's agent.
  SetF '_fgWebUrlAgentId' ''
}

function Report([string]$scenario, [int]$n, $outcome, [bool]$composer, [bool]$chrome) {
  # THE PLATFORM-BLOCK question: the REAL Enter predicate with NO content signal
  # armed, so a True here can only be the blocked-row arm.
  $enterBlocked = Call 'EnterBlockActive' @($false, $false, $false, $false)
  # THE DLP question, and the priority of this whole feature: the REAL Enter
  # predicate asked with a TYPED-BUFFER content match present, exactly as the
  # hook computes it. True means "the user typed a secret into this element and
  # Enter would be swallowed".
  $wasBlockTyped = [bool](GetF '_blockTyped')
  $wasTicks = [long](GetF '_typedBlockTicks')
  SetF '_blockTyped' $true
  SetF '_typedBlockTicks' ([long][DateTime]::UtcNow.Ticks)
  $dlpBlocked = (([bool](GetF '_fgIsAi') -or [bool](Call 'PanelBlockLatchHeld')) `
                 -and [bool](Call 'EnterBlockActive' @($false, $false, $false, $false)))
  SetF '_blockTyped' $wasBlockTyped
  SetF '_typedBlockTicks' $wasTicks

  $obj = [ordered]@{
    scenario     = $scenario
    tick         = $n
    webOutcome   = [string]$outcome
    composer     = $composer
    chromeFocused = [bool](GetF '_fgWebChromeFocused')
    fgIsAi       = [bool](GetF '_fgIsAi')
    fgIsBrowser  = [bool](GetF '_fgIsBrowser')
    fgWebHost    = [string](GetF '_fgWebHost')
    # Would a keystroke be ACCUMULATED into the scan buffer on this tick? The
    # real capture gate. This is the privacy boundary: it must be false in the
    # omnibox, in a password field, on an ungoverned tab and on an unarmed host.
    captureOn    = [bool](Call 'FgIsAiNow')
    # Would a UIA content read be trusted on this tick? The other half of the
    # capture gate, and reported as the COMPOSITE both readers actually apply
    # (`!_fgIsAi || !PanelUiaOk()` in UpdateUia and UpdatePendingRewrite).
    # PanelUiaOk alone keys on the STICKY _app, which is only assigned on a tick
    # that was an AI surface -- so on a tick that never became one it answers the
    # permissive default and says nothing useful on its own.
    uiaOk        = ([bool](GetF '_fgIsAi') -and [bool](Call 'PanelUiaOk'))
    panelUiaOk   = [bool](Call 'PanelUiaOk')
    # Is the composer's own text readable this tick, focused or not? The signal
    # the paste detector depends on.
    composerReadable = [bool](GetF '_fgWebComposerReadable')
    passwordFocused  = [bool](GetF '_fgWebPasswordFocused')
    # WOULD A PASTE BE BLOCKED? The exact hook decision for a Ctrl+V-then-Enter
    # with an EMPTY typed buffer: UpdateUia's own gate decides whether _blockUia
    # can be computed at all, and the Enter predicate is asked with the UIA term
    # exactly as HookCallback computes it (`PanelUiaOk() && _blockUia`). This is
    # the case the live bypass went through.
    pasteBlocked = $(
      $wasUia = [bool](GetF '_blockUia')
      $uiaGate = ([bool](GetF '_fgIsAi') -and [bool](Call 'PanelUiaOk'))
      SetF '_blockUia' $uiaGate
      $r = (([bool](GetF '_fgIsAi') -or [bool](Call 'PanelBlockLatchHeld')) `
            -and [bool](Call 'EnterBlockActive' @($false, ([bool](Call 'PanelUiaOk') -and $uiaGate), $false, $false)))
      SetF '_blockUia' $wasUia
      [bool]$r
    )
    fgIsBlocked  = [bool](GetF '_fgIsBlocked')
    blockedByElement = [bool](GetF '_blockedByElement')
    blockScope   = [string](Call 'BlockScope')
    blockedHost  = [string](GetF '_blockedBrowserHost')
    latchHeld    = [bool](Call 'PanelBlockLatchHeld')
    latchKey     = [string](GetF '_elementBlockKey')
    webGateOk    = [bool](Call 'WebBlockGateOk')
    enterBlocked = [bool]$enterBlocked
    dlpBlocked   = [bool]$dlpBlocked
    # The buffer's OWNER key and its current length. A change of owner is what
    # discards the buffer; the length is how a discard is observed without ever
    # reading the text.
    ownerKey     = [string](GetF '_fgOwnerKey')
    typedLen     = [int](Call 'TypedLength')
    navGen       = [int](GetF '_browserNavGen')
    # The block event's host field, from the REAL emitter's builder. This is what
    # index.js's blockToolHost() reads first.
    hostField    = [string](Call 'BrowserHostField')
    # Tier B's per-surface knobs, from the REAL lookups.
    newlineKeys  = [string](Call 'NewlineKeysFor')
    postSendMs   = [int](Call 'PostSendVerifyMsFor')
    govActive    = [bool](GetF '_govActive')
    govEmitted   = [bool]$script:govEmitted
    govKey       = [string](GetF '_govKey')
  }
  Write-Output ($obj | ConvertTo-Json -Compress)
}

function Age([string]$field, [int]$ms) {
  $v = GetF $field
  if ($v -ne 0) { SetF $field ([long]($v - ([TimeSpan]::FromMilliseconds($ms).Ticks))) }
}

# =============================== SCENARIOS ==================================

# ---- A: THE SHIPPED STATE. Everything false/false => genuinely nothing. -----
LoadWeb $WEB_SHIPPED
LoadRows $ROWS_CLAUDE_WEB
ResetState
WebTick 'shipped_inert' 0 'https://claude.ai/chat/abc' $FOCUS_CLAUDE_COMPOSER
WebTick 'shipped_inert' 1 'https://claude.ai/chat/abc' $FOCUS_CLAUDE_COMPOSER
TypeChars 'my ssn is 123-45-6789'
WebTick 'shipped_inert' 2 'https://claude.ai/chat/abc' $FOCUS_CLAUDE_COMPOSER

# ---- B: an ABSENT payload leaves every browser ungoverned (feature switch) --
LoadWeb $WEB_EMPTY
ResetState
WebTick 'empty_payload' 0 'https://claude.ai/chat/abc' $FOCUS_CLAUDE_COMPOSER

# ---- C: HALF-ARMED. Both flags travel, both are read, in one place. ---------
LoadWeb $WEB_HALF1
ResetState
WebTick 'enforce_without_verified' 0 'https://claude.ai/chat/abc' $FOCUS_CLAUDE_COMPOSER
LoadWeb $WEB_HALF2
ResetState
WebTick 'verified_without_enforce' 0 'https://claude.ai/chat/abc' $FOCUS_CLAUDE_COMPOSER

# ==== From here on claude.ai is ARMED (test-only flip) ======================

# ---- D: THE PRIORITY CASE. A secret typed into the claude.ai composer, with
#         NO blocked row at all -- the pure DLP pattern path.
LoadWeb $WEB_CLAUDE_ARMED
LoadRows $ROWS_EMPTY
ResetState
WebTick 'dlp_composer_armed' 0 'https://claude.ai/chat/abc' $FOCUS_CLAUDE_COMPOSER
TypeChars 'my ssn is 123-45-6789'
WebTick 'dlp_composer_armed' 1 'https://claude.ai/chat/abc' $FOCUS_CLAUDE_COMPOSER

# ---- E: THE OMNIBOX. No capture, no accumulation, and Enter stays ALIVE. ---
ResetState
WebTick 'omnibox_never_captures' 0 'https://claude.ai/chat/abc' $FOCUS_CLAUDE_COMPOSER
TypeChars 'secret 123-45-6789'
WebTick 'omnibox_never_captures' 1 'https://claude.ai/chat/abc' $FOCUS_OMNIBOX
TypeChars 'https://internal.corp/very-secret-path'
WebTick 'omnibox_never_captures' 2 'https://claude.ai/chat/abc' $FOCUS_OMNIBOX
WebTick 'omnibox_never_captures' 3 'https://claude.ai/chat/abc' $FOCUS_CLAUDE_COMPOSER

# The find bar and the tab-search box are chrome for the same reason.
ResetState
WebTick 'find_bar_is_chrome' 0 'https://claude.ai/chat/abc' $FOCUS_FIND_BAR
WebTick 'find_bar_is_chrome' 1 'https://claude.ai/chat/abc' $FOCUS_TAB_SEARCH

# ---- F: A PASSWORD FIELD on a governed host is never a composer. ------------
ResetState
WebTick 'password_never_captures' 0 'https://claude.ai/login' $FOCUS_PASSWORD
TypeChars 'hunter2-correct-horse'
WebTick 'password_never_captures' 1 'https://claude.ai/login' $FOCUS_PASSWORD

# ---- G: non-composer elements: the transcript, and a non-focusable field. ---
ResetState
WebTick 'non_composer_elements' 0 'https://claude.ai/chat/abc' $FOCUS_TRANSCRIPT
WebTick 'non_composer_elements' 1 'https://claude.ai/chat/abc' $FOCUS_NOT_FOCUSABLE

# ---- H: AN UNKNOWN HOST is not an AI surface. FAIL OPEN. -------------------
ResetState
WebTick 'unknown_host' 0 'https://mail.google.com/mail/u/0/#inbox' $FOCUS_GMAIL_BODY
WebTick 'unknown_host' 1 'https://wiki.internal.corp/Runbook' $FOCUS_GMAIL_BODY
# The near-misses that matter: a suffix that is not on a dot boundary, and an
# attacker-controlled parent domain.
WebTick 'unknown_host' 2 'https://notclaude.ai/chat' $FOCUS_CLAUDE_COMPOSER
WebTick 'unknown_host' 3 'https://claude.ai.attacker.example/chat' $FOCUS_CLAUDE_COMPOSER
# A subdomain of a governed host IS governed (registrable-suffix match).
WebTick 'unknown_host' 4 'https://foo.claude.ai/chat' $FOCUS_CLAUDE_COMPOSER
# Non-web schemes are never a governed surface.
WebTick 'unknown_host' 5 'chrome://settings/passwords' $FOCUS_CLAUDE_COMPOSER
WebTick 'unknown_host' 6 'file:///C:/secrets.txt' $FOCUS_CLAUDE_COMPOSER
# The scheme-less form the omnibox actually shows.
WebTick 'unknown_host' 7 'claude.ai/chat/abc' $FOCUS_CLAUDE_COMPOSER
WebTick 'unknown_host' 8 'www.claude.ai/chat/abc' $FOCUS_CLAUDE_COMPOSER

# ---- I: AN UNREADABLE URL is not an AI surface either. FAIL OPEN. ----------
LoadRows $ROWS_EMPTY
ResetState
WebTick 'unreadable_url' 0 $null $FOCUS_CLAUDE_COMPOSER
TypeChars 'my ssn is 123-45-6789'
WebTick 'unreadable_url' 1 $null $FOCUS_CLAUDE_COMPOSER

# ---- J: THE BLOCKED-ROW ARM (item 4). ---------------------------------------
LoadRows $ROWS_CLAUDE_WEB
ResetState
WebTick 'row_blocks_armed_host' 0 'https://claude.ai/chat/abc' $FOCUS_CLAUDE_COMPOSER
WebTick 'row_blocks_armed_host' 1 'https://claude.ai/chat/abc' $FOCUS_CLAUDE_COMPOSER
# ...and Enter in the OMNIBOX of that very blocked tab must still go through.
WebTick 'row_blocks_armed_host' 2 'https://claude.ai/chat/abc' $FOCUS_OMNIBOX
WebTick 'row_blocks_armed_host' 3 'https://claude.ai/chat/abc' $FOCUS_CLAUDE_COMPOSER

# A row for an UNARMED host does not block, even though the tab is on it.
LoadRows $ROWS_CHATGPT_WEB
ResetState
WebTick 'row_unverified_host' 0 'https://chatgpt.com/' $FOCUS_CLAUDE_COMPOSER

# A process_name:'chrome' row must NEVER be honoured.
LoadRows $ROWS_CHROME_PROCESS
ResetState
WebTick 'process_name_row_refused' 0 'https://claude.ai/chat/abc' $FOCUS_CLAUDE_COMPOSER
WebTick 'process_name_row_refused' 1 'https://mail.google.com/' $FOCUS_GMAIL_BODY
WebTick 'process_name_row_refused' 2 $null $null

# A platform row that maps (through PLATFORM_PROCS) to the DESKTOP app only must
# not reach a browser through the coarse arm -- but the WEB surface claims the
# same platform id, so the ELEMENT-SCOPED web arm may honour it.
LoadRows $ROWS_PLATFORM_WEB
ResetState
WebTick 'platform_row_via_web_arm' 0 'https://claude.ai/chat/abc' $FOCUS_CLAUDE_COMPOSER
WebTick 'platform_row_via_web_arm' 1 'https://claude.ai/chat/abc' $FOCUS_OMNIBOX
# The same platform row, AGENT-scoped: nothing in a browser can tell which agent
# is open, so it must block nothing.
LoadRows $ROWS_PLATFORM_WEB_AGENT
ResetState
WebTick 'platform_row_agent_scoped' 0 'https://claude.ai/chat/abc' $FOCUS_CLAUDE_COMPOSER

# ---- K: TAB SWITCH A -> B -> A, both directions, inside the TTL. -----------
LoadWeb $WEB_BOTH_ARMED
LoadRows $ROWS_CLAUDE_WEB
ResetState
WebTick 'tab_switch_a_to_b' 0 'https://claude.ai/chat/abc' $FOCUS_CLAUDE_COMPOSER
TypeChars 'ssn 123-45-6789'
WebTick 'tab_switch_a_to_b' 1 'https://claude.ai/chat/abc' $FOCUS_CLAUDE_COMPOSER
WebTick 'tab_switch_a_to_b' 2 'https://chatgpt.com/c/xyz' $FOCUS_CLAUDE_COMPOSER
WebTick 'tab_switch_a_to_b' 3 'https://chatgpt.com/c/xyz' $FOCUS_CLAUDE_COMPOSER
WebTick 'tab_switch_a_to_b' 4 'https://claude.ai/chat/abc' $FOCUS_CLAUDE_COMPOSER
WebTick 'tab_switch_a_to_b' 5 'https://claude.ai/chat/abc' $FOCUS_CLAUDE_COMPOSER

# The reverse direction: blocked host SECOND.
LoadRows $ROWS_CHATGPT_WEB
ResetState
WebTick 'tab_switch_b_to_a' 0 'https://claude.ai/chat/abc' $FOCUS_CLAUDE_COMPOSER
WebTick 'tab_switch_b_to_a' 1 'https://chatgpt.com/c/xyz' $FOCUS_CLAUDE_COMPOSER
WebTick 'tab_switch_b_to_a' 2 'https://claude.ai/chat/abc' $FOCUS_CLAUDE_COMPOSER

# Both hosts blocked: switching between them must re-arm against the right one.
LoadRows $ROWS_BOTH_WEB
ResetState
WebTick 'tab_switch_both_blocked' 0 'https://claude.ai/chat/abc' $FOCUS_CLAUDE_COMPOSER
WebTick 'tab_switch_both_blocked' 1 'https://chatgpt.com/c/xyz' $FOCUS_CLAUDE_COMPOSER
WebTick 'tab_switch_both_blocked' 2 'https://claude.ai/chat/abc' $FOCUS_CLAUDE_COMPOSER

# ---- L: THE LATCH. Survives ONE unreadable tick; dies on a readable non-match
LoadWeb $WEB_CLAUDE_ARMED
LoadRows $ROWS_CLAUDE_WEB
ResetState
WebTick 'latch_survives_unreadable' 0 'https://claude.ai/chat/abc' $FOCUS_CLAUDE_COMPOSER
WebTick 'latch_survives_unreadable' 1 $null $null
WebTick 'latch_survives_unreadable' 2 $null $null
WebTick 'latch_survives_unreadable' 3 'https://claude.ai/chat/abc' $FOCUS_CLAUDE_COMPOSER

ResetState
WebTick 'latch_dies_on_navigation' 0 'https://claude.ai/chat/abc' $FOCUS_CLAUDE_COMPOSER
WebTick 'latch_dies_on_navigation' 1 'https://mail.google.com/' $FOCUS_GMAIL_BODY
WebTick 'latch_dies_on_navigation' 2 'https://mail.google.com/' $FOCUS_GMAIL_BODY

# The latch is BOUNDED: an unreadable run past PANEL_BLOCK_LATCH_TTL releases.
ResetState
WebTick 'latch_is_bounded' 0 'https://claude.ai/chat/abc' $FOCUS_CLAUDE_COMPOSER
WebTick 'latch_is_bounded' 1 $null $null
Age '_panelBlockLatchTicks' 11000
WebTick 'latch_is_bounded' 2 $null $null

# ---- M: BUFFER DISCARD on navigation, tab switch and focus-out. ------------
LoadWeb $WEB_BOTH_ARMED
LoadRows $ROWS_EMPTY
ResetState
# Everything held CONSTANT except the chord -- same url, same host, same title,
# same window -- so the chord is provably the only thing that discarded.
WebTick 'buffer_discard_navigation' 0 'https://claude.ai/chat/abc' $FOCUS_CLAUDE_COMPOSER $CHROME_PID 'chrome' 'Claude'
TypeChars 'aws key AKIAIOSFODNN7EXAMPLE'
WebTick 'buffer_discard_navigation' 1 'https://claude.ai/chat/abc' $FOCUS_CLAUDE_COMPOSER $CHROME_PID 'chrome' 'Claude'
# A NAVIGATION CHORD the hook stamped (Ctrl+T / Ctrl+W / Ctrl+1-9 / Alt+Left /
# F5 / Enter in the omnibox). The hook writes only a TIMESTAMP -- never which
# key -- and this is that timestamp, written the way the hook writes it.
SetF '_browserNavInputTicks' ([long][DateTime]::UtcNow.Ticks)
WebTick 'buffer_discard_navigation' 2 'https://claude.ai/chat/abc' $FOCUS_CLAUDE_COMPOSER $CHROME_PID 'chrome' 'Claude'
TypeChars 'x'
WebTick 'buffer_discard_navigation' 3 'https://claude.ai/chat/abc' $FOCUS_CLAUDE_COMPOSER $CHROME_PID 'chrome' 'Claude'
# ONE chord counts ONCE: the next tick with no new stamp must not keep bumping,
# or the buffer could never accumulate anything at all.
WebTick 'buffer_discard_navigation' 4 'https://claude.ai/chat/abc' $FOCUS_CLAUDE_COMPOSER $CHROME_PID 'chrome' 'Claude'
TypeChars 'yz'
WebTick 'buffer_discard_navigation' 5 'https://claude.ai/chat/abc' $FOCUS_CLAUDE_COMPOSER $CHROME_PID 'chrome' 'Claude'

# HOST CHANGE inside one browser window.
ResetState
WebTick 'buffer_discard_host_change' 0 'https://claude.ai/chat/abc' $FOCUS_CLAUDE_COMPOSER
TypeChars 'ssn 123-45-6789'
WebTick 'buffer_discard_host_change' 1 'https://claude.ai/chat/abc' $FOCUS_CLAUDE_COMPOSER
WebTick 'buffer_discard_host_change' 2 'https://chatgpt.com/c/xyz' $FOCUS_CLAUDE_COMPOSER
TypeChars 'y'
WebTick 'buffer_discard_host_change' 3 'https://chatgpt.com/c/xyz' $FOCUS_CLAUDE_COMPOSER

# FOCUS LEAVING the composer for the omnibox, then coming back.
ResetState
WebTick 'buffer_discard_focus_out' 0 'https://claude.ai/chat/abc' $FOCUS_CLAUDE_COMPOSER
TypeChars 'ssn 123-45-6789'
WebTick 'buffer_discard_focus_out' 1 'https://claude.ai/chat/abc' $FOCUS_CLAUDE_COMPOSER
WebTick 'buffer_discard_focus_out' 2 'https://claude.ai/chat/abc' $FOCUS_OMNIBOX
TypeChars 'internal.corp'
WebTick 'buffer_discard_focus_out' 3 'https://claude.ai/chat/abc' $FOCUS_OMNIBOX
WebTick 'buffer_discard_focus_out' 4 'https://claude.ai/chat/abc' $FOCUS_CLAUDE_COMPOSER
TypeChars 'z'
WebTick 'buffer_discard_focus_out' 5 'https://claude.ai/chat/abc' $FOCUS_CLAUDE_COMPOSER

# LEAVING THE BROWSER ENTIRELY, then coming back.
ResetState
WebTick 'buffer_discard_leave_browser' 0 'https://claude.ai/chat/abc' $FOCUS_CLAUDE_COMPOSER
TypeChars 'ssn 123-45-6789'
WebTick 'buffer_discard_leave_browser' 1 'https://claude.ai/chat/abc' $FOCUS_CLAUDE_COMPOSER
WebTick 'buffer_discard_leave_browser' 2 $null $null ([uint32]999) 'notepad'
TypeChars 'a shopping list'
WebTick 'buffer_discard_leave_browser' 3 $null $null ([uint32]999) 'notepad'

# ---- M2: SAME-HOST tab switch. The one case only the TITLE can catch. ------
#
# Two claude.ai tabs, two different conversations. The host does not change, the
# window does not change, and no navigation chord is pressed -- the user clicked
# the second tab with the mouse. The WINDOW TITLE is the only signal that says
# anything happened, and a buffer that survived this would be one conversation's
# typing scanned and reported as part of another's.
LoadWeb $WEB_CLAUDE_ARMED
LoadRows $ROWS_EMPTY
ResetState
WebTick 'buffer_discard_same_host_tab' 0 'https://claude.ai/chat/aaa' $FOCUS_CLAUDE_COMPOSER $CHROME_PID 'chrome' 'Payroll question - Claude'
TypeChars 'ssn 123-45-6789'
WebTick 'buffer_discard_same_host_tab' 1 'https://claude.ai/chat/aaa' $FOCUS_CLAUDE_COMPOSER $CHROME_PID 'chrome' 'Payroll question - Claude'
WebTick 'buffer_discard_same_host_tab' 2 'https://claude.ai/chat/bbb' $FOCUS_CLAUDE_COMPOSER $CHROME_PID 'chrome' 'Holiday plans - Claude'
TypeChars 'q'
WebTick 'buffer_discard_same_host_tab' 3 'https://claude.ai/chat/bbb' $FOCUS_CLAUDE_COMPOSER $CHROME_PID 'chrome' 'Holiday plans - Claude'

# An SPA route change under an UNCHANGED title: nothing above catches it, which
# is exactly what BROWSER_URL_TTL is the backstop for. Here the URL DOES change
# and the host does not, so the title is what has to catch it -- and when the
# title has not changed either, the buffer legitimately carries on. Documented
# rather than asserted as a discard: it is the acknowledged residual case.
ResetState
WebTick 'spa_route_same_title' 0 'https://claude.ai/chat/aaa' $FOCUS_CLAUDE_COMPOSER $CHROME_PID 'chrome' 'Claude'
TypeChars 'ssn 123-45-6789'
WebTick 'spa_route_same_title' 1 'https://claude.ai/new' $FOCUS_CLAUDE_COMPOSER $CHROME_PID 'chrome' 'Claude'

# A SECOND BROWSER WINDOW is a different hwnd, so the sweep catches it with the
# cheapest signal it has.
ResetState
WebTick 'buffer_discard_second_window' 0 'https://claude.ai/chat/aaa' $FOCUS_CLAUDE_COMPOSER $CHROME_PID 'chrome' 'Claude' 1001
TypeChars 'ssn 123-45-6789'
WebTick 'buffer_discard_second_window' 1 'https://claude.ai/chat/aaa' $FOCUS_CLAUDE_COMPOSER $CHROME_PID 'chrome' 'Claude' 1001
WebTick 'buffer_discard_second_window' 2 'https://claude.ai/chat/aaa' $FOCUS_CLAUDE_COMPOSER $CHROME_PID 'chrome' 'Claude' 2002
TypeChars 'r'
WebTick 'buffer_discard_second_window' 3 'https://claude.ai/chat/aaa' $FOCUS_CLAUDE_COMPOSER $CHROME_PID 'chrome' 'Claude' 2002

# ---- N: govstate for a browser surface -------------------------------------
LoadWeb $WEB_BOTH_ARMED
LoadRows $ROWS_EMPTY
ResetState
WebTick 'govstate_browser' 0 'https://claude.ai/chat/abc' $FOCUS_CLAUDE_COMPOSER
WebTick 'govstate_browser' 1 'https://claude.ai/chat/abc' $FOCUS_CLAUDE_COMPOSER
# Switching governed hosts is a TWO-TICK transition by design (clear, then arm
# on the next tick), exactly as switching governed Teams conversations is: the
# emitter changes state at one site per tick so it can never write two lines for
# one transition.
WebTick 'govstate_browser' 2 'https://chatgpt.com/c/xyz' $FOCUS_CLAUDE_COMPOSER
WebTick 'govstate_browser' 3 'https://chatgpt.com/c/xyz' $FOCUS_CLAUDE_COMPOSER
WebTick 'govstate_browser' 4 'https://mail.google.com/' $FOCUS_GMAIL_BODY

# The PANIC HOTKEY must disarm the govstate arm too -- an armed watcher whose
# hold can no longer swallow anything would be capture with no enforcement.
ResetState
WebTick 'govstate_panic' 0 'https://claude.ai/chat/abc' $FOCUS_CLAUDE_COMPOSER
SetF '_disarmedUntilTicks' ([long]([DateTime]::UtcNow.Ticks + [TimeSpan]::FromMinutes(10).Ticks))
WebTick 'govstate_panic' 1 'https://claude.ai/chat/abc' $FOCUS_CLAUDE_COMPOSER
SetF '_disarmedUntilTicks' ([long]0)

# ---- O: the panic hotkey releases a browser block outright -----------------
LoadRows $ROWS_CLAUDE_WEB
ResetState
WebTick 'panic_releases_block' 0 'https://claude.ai/chat/abc' $FOCUS_CLAUDE_COMPOSER
SetF '_disarmedUntilTicks' ([long]([DateTime]::UtcNow.Ticks + [TimeSpan]::FromMinutes(10).Ticks))
WebTick 'panic_releases_block' 1 'https://claude.ai/chat/abc' $FOCUS_CLAUDE_COMPOSER
SetF '_disarmedUntilTicks' ([long]0)

# ---- P: Tier B knobs come from the catalog, per surface --------------------
LoadRows $ROWS_EMPTY
ResetState
WebTick 'tierb_knobs' 0 'https://claude.ai/chat/abc' $FOCUS_CLAUDE_COMPOSER
WebTick 'tierb_knobs' 1 'https://claude.ai/chat/abc' $FOCUS_OMNIBOX
WebTick 'tierb_knobs' 2 'https://mail.google.com/' $FOCUS_GMAIL_BODY


# ============================ SEND-BUTTON CLICK PATH =========================
#
# The click block is the one part of this feature that cannot be driven with a
# fabricated read, because the whole safety argument rests on RE-READING a real
# element's Name. So this section builds a REAL UIA element -- a WinForms Button
# in this process -- hands it to the enforcer as its cached send button, and
# then CHANGES ITS NAME to reproduce exactly the measured claude.ai behaviour:
#
#   composer non-empty -> [Button] Name='Send message'   rect R
#   composer EMPTY     -> [Button] Name='Use voice mode' rect R   (identical)
#
# A rect cached in the first state and honoured in the second would swallow
# clicks on the MICROPHONE. That is the failure this whole path is shaped
# around, and this is the only way to test it against a real UIA provider rather
# than against a copy of the logic.
#
# WHAT IS SUBSTITUTED: exactly one thing, and it is the same class of
# substitution as the focused-element read -- WHICH WINDOW the cache belongs to.
# UpdateWebSendRect compares _webSendCachedHwnd against GetForegroundWindow(),
# and the harness's foreground window is a console, not a browser, so the cached
# hwnd is set to whatever GetForegroundWindow() actually returns. Nothing that
# DECIDES is substituted: the gates, the name comparison, the rectangle read,
# the freshness stamp and the hook's own predicate are all production code.
#
# If a window cannot be created (a genuinely headless session), the whole
# section is skipped and one line says so, rather than failing.
$script:sendProbeOk = $false
$script:sendForm = $null
$script:sendBtn = $null
$script:sendBtnEl = $null
try {
  Add-Type -AssemblyName System.Windows.Forms -ErrorAction Stop
  $script:sendForm = New-Object System.Windows.Forms.Form
  $script:sendForm.Text = 'cfai-send-probe'
  $script:sendForm.Width = 320
  $script:sendForm.Height = 160
  $script:sendForm.ShowInTaskbar = $false
  $script:sendBtn = New-Object System.Windows.Forms.Button
  $script:sendBtn.Text = 'Send message'
  $script:sendBtn.SetBounds(20, 20, 160, 40)
  $script:sendForm.Controls.Add($script:sendBtn)
  $script:sendForm.Show()
  [System.Windows.Forms.Application]::DoEvents()
  $script:sendBtnEl = [System.Windows.Automation.AutomationElement]::FromHandle($script:sendBtn.Handle)
  if ($null -ne $script:sendBtnEl) {
    $probe = $script:sendBtnEl.Current.Name
    if ($probe -eq 'Send message') { $script:sendProbeOk = $true }
  }
} catch { $script:sendProbeOk = $false }
Write-Output (([ordered]@{ scenario = 'send_probe'; tick = 0; probeOk = $script:sendProbeOk }) | ConvertTo-Json -Compress)

# GetForegroundWindow is a private extern on the compiled type; reflection can
# invoke a P/Invoke stub exactly as it invokes any other static method.
function FgWindow() { return [IntPtr](Call 'GetForegroundWindow') }

# Rename the probe button, i.e. move the page between "composer has text" and
# "composer is empty". Text -> UIA Name for a WinForms button, so this really
# does change what the enforcer's re-read will see.
function SetButtonName([string]$name) {
  $script:sendBtn.Text = $name
  [System.Windows.Forms.Application]::DoEvents()
  # Confirm the provider actually reports the new name before the tick relies
  # on it, so a slow provider cannot make the test assert against the old one.
  for ($i = 0; $i -lt 50; $i++) {
    try { if ($script:sendBtnEl.Current.Name -eq $name) { break } } catch { break }
    Start-Sleep -Milliseconds 10
    [System.Windows.Forms.Application]::DoEvents()
  }
}

# Hand the probe button to the enforcer as its cached send button. `$attach`
# false models "the background search has not found anything yet".
function AttachSendButton([bool]$attach, [string]$surfaceHost = 'claude.ai') {
  if ($attach) {
    SetF '_webSendCached' $script:sendBtnEl
    SetF '_webSendCachedHwnd' (FgWindow)
    SetF '_webSendCachedHost' $surfaceHost
  } else {
    SetF '_webSendCached' $null
    SetF '_webSendCachedHwnd' ([IntPtr]::Zero)
    SetF '_webSendCachedHost' ''
  }
}

# One poll tick of the REAL entry point. UpdateSendRect is what PollLoop calls,
# and its browser branch is what delegates to UpdateWebSendRect -- so the
# delegation itself is under test, not assumed.
function SendTick([string]$scenario, [int]$n) {
  Call 'UpdateSendRect' | Out-Null
  # THE MOUSE HOOK'S OWN PREDICATE, reproduced line for line from
  # MouseCallback: _hasRect AND SendRectFreshEnough() AND the point is inside
  # the cached rectangle -- then _fgIsAi AND BlockActiveForMouse(). The two
  # predicates are production code; the click coordinate is the substitution.
  $hasRect = [bool](GetF '_hasRect')
  $rx = [int](GetF '_rx'); $ry = [int](GetF '_ry')
  $rw = [int](GetF '_rw'); $rh = [int](GetF '_rh')
  $fresh = [bool](Call 'SendRectFreshEnough')
  # A click at the CENTRE of whatever rectangle is currently published. When
  # nothing is published there is no rectangle to click, which is the point.
  $cx = $rx + [int]($rw / 2); $cy = $ry + [int]($rh / 2)
  $inRect = $hasRect -and $fresh -and ($cx -ge $rx) -and ($cx -lt ($rx + $rw)) -and ($cy -ge $ry) -and ($cy -lt ($ry + $rh))
  $swallowed = $inRect -and [bool](GetF '_fgIsAi') -and [bool](Call 'BlockActiveForMouse')
  # A click well OUTSIDE the rectangle must never be swallowed, whatever else is
  # true -- the control against a rect that accidentally covers the window.
  $outX = $rx - 500; $outY = $ry - 500
  $inRectFar = $hasRect -and $fresh -and ($outX -ge $rx) -and ($outX -lt ($rx + $rw)) -and ($outY -ge $ry) -and ($outY -lt ($ry + $rh))

  $obj = [ordered]@{
    scenario     = $scenario
    tick         = $n
    buttonName   = [string]$(try { $script:sendBtnEl.Current.Name } catch { '' })
    hasRect      = $hasRect
    rectFresh    = $fresh
    rectW        = $rw
    rectH        = $rh
    # Would a click at the centre of the published rect be swallowed?
    clickSwallowed = [bool]$swallowed
    # ...and one far outside it must not be.
    farClickSwallowed = [bool]$inRectFar
    # Was a background search kicked off on this tick? A cheap structural way to
    # assert "no search ever happened" for a surface with no signature.
    searchKicked = [bool](GetF '_webSendSearchInProgress')
    fgIsBlocked  = [bool](GetF '_fgIsBlocked')
    blockScope   = [string](Call 'BlockScope')
    verifiedAt   = [long](GetF '_webSendVerifiedTicks')
    hostField    = [string](Call 'BrowserHostField')
  }
  Write-Output ($obj | ConvertTo-Json -Compress)
}

# Evaluate ONLY the mouse hook's side, with no poll tick in between. The
# freshness TTL exists for the case where the poll thread has STOPPED
# publishing, so a helper that runs a tick first (which re-verifies and
# re-stamps) can never observe it. This is what the hook would decide right now.
function SendStaleCheck([string]$scenario, [int]$n) {
  $hasRect = [bool](GetF '_hasRect')
  $rx = [int](GetF '_rx'); $ry = [int](GetF '_ry')
  $rw = [int](GetF '_rw'); $rh = [int](GetF '_rh')
  $fresh = [bool](Call 'SendRectFreshEnough')
  $cx = $rx + [int]($rw / 2); $cy = $ry + [int]($rh / 2)
  $inRect = $hasRect -and $fresh -and ($cx -ge $rx) -and ($cx -lt ($rx + $rw)) -and ($cy -ge $ry) -and ($cy -lt ($ry + $rh))
  $swallowed = $inRect -and [bool](GetF '_fgIsAi') -and [bool](Call 'BlockActiveForMouse')
  $obj = [ordered]@{
    scenario       = $scenario
    tick           = $n
    buttonName     = [string]$(try { $script:sendBtnEl.Current.Name } catch { '' })
    hasRect        = $hasRect
    rectFresh      = $fresh
    rectW          = $rw
    rectH          = $rh
    clickSwallowed = [bool]$swallowed
    farClickSwallowed = $false
    searchKicked   = [bool](GetF '_webSendSearchInProgress')
    fgIsBlocked    = [bool](GetF '_fgIsBlocked')
    blockScope     = [string](Call 'BlockScope')
    verifiedAt     = [long](GetF '_webSendVerifiedTicks')
    hostField      = [string](Call 'BrowserHostField')
  }
  Write-Output ($obj | ConvertTo-Json -Compress)
}

# Exactly the fields RunRewrite clears just before it synthesizes Enter (it must
# -- its own verified-clean masked text would otherwise re-block the send it is
# performing). The question these scenarios ask is whether the NEXT paste
# re-arms, which has to come from the UIA composer scan on the following tick and
# not from the user retyping.
function ClearAfterRewrite() {
  Call 'TypedClear' | Out-Null
  SetF '_blockTyped' $false
  SetF '_typedPatterns' ''
  SetF '_lastBlockFiredTicks' ([long]0)
  SetF '_blockUia' $false
  SetF '_uiaPatterns' ''
  SetF '_blockPaste' $false
  SetF '_lastPasteTicks' ([long]0)
}

function ResetSendState() {
  SetF '_hasRect' $false
  SetF '_rx' 0; SetF '_ry' 0; SetF '_rw' 0; SetF '_rh' 0
  SetF '_webSendVerifiedTicks' ([long]0)
  SetF '_webSendSearchInProgress' $false
  SetF '_webSendSearchHwnd' ([IntPtr]::Zero)
  SetF '_webSendSearchHost' ''
  SetF '_webSendLastSearchTicks' ([long]0)
  SetF '_webSendEmptyRuns' 0
  AttachSendButton $false
}

if ($script:sendProbeOk) {

  # ---- S1: THE SHARP EDGE. `Send message` -> rect. `Use voice mode` -> NONE.
  LoadWeb $WEB_CLAUDE_ARMED
  LoadRows $ROWS_CLAUDE_WEB
  ResetState; ResetSendState
  WebTick 'send_reverify' 0 'https://claude.ai/chat/abc' $FOCUS_CLAUDE_COMPOSER | Out-Null
  SetButtonName 'Send message'
  AttachSendButton $true
  SendTick 'send_reverify' 1
  # The composer empties. claude.ai relabels the SAME control, at the SAME
  # rectangle, to the microphone. The rect must be withdrawn on this very tick.
  SetButtonName 'Use voice mode'
  SendTick 'send_reverify' 2
  # ...and it must come back when the user types again, WITHOUT a fresh search
  # (the cache was deliberately kept through the mismatch).
  SetButtonName 'Send message'
  SendTick 'send_reverify' 3

  # ---- S2: a NAME MISMATCH of any other kind publishes nothing either. ------
  ResetState; ResetSendState
  WebTick 'send_name_mismatch' 0 'https://claude.ai/chat/abc' $FOCUS_CLAUDE_COMPOSER | Out-Null
  SetButtonName 'Send message to a new chat'
  AttachSendButton $true
  SendTick 'send_name_mismatch' 1
  SetButtonName 'send'
  SendTick 'send_name_mismatch' 2
  # Whole-string, but CASE-INSENSITIVE -- the same discipline nameEquals uses.
  SetButtonName 'SEND MESSAGE'
  SendTick 'send_name_mismatch' 3

  # ---- S3: NO SIGNATURE => no search, no rect. Enter-only blocking. ---------
  # chatgpt.com ships sendButtonControlType:'' / sendButtonName:'' because it
  # has not been probed, and "unprobed" must mean "no rectangle".
  LoadWeb $WEB_BOTH_ARMED
  LoadRows $ROWS_CHATGPT_WEB
  ResetState; ResetSendState
  WebTick 'send_no_signature' 0 'https://chatgpt.com/c/xyz' $FOCUS_CLAUDE_COMPOSER | Out-Null
  SetButtonName 'Send message'
  AttachSendButton $true 'chatgpt.com'
  SendTick 'send_no_signature' 1
  SendTick 'send_no_signature' 2

  # ---- S4: NO BLOCK ARMED => no rect, even with the button right there. -----
  LoadWeb $WEB_CLAUDE_ARMED
  LoadRows $ROWS_EMPTY
  ResetState; ResetSendState
  WebTick 'send_no_block' 0 'https://claude.ai/chat/abc' $FOCUS_CLAUDE_COMPOSER | Out-Null
  SetButtonName 'Send message'
  AttachSendButton $true
  SendTick 'send_no_block' 1

  # ---- S5: AN UNVERIFIED SURFACE => no rect. -------------------------------
  LoadWeb $WEB_SHIPPED
  LoadRows $ROWS_CLAUDE_WEB
  ResetState; ResetSendState
  WebTick 'send_unverified' 0 'https://claude.ai/chat/abc' $FOCUS_CLAUDE_COMPOSER | Out-Null
  SetButtonName 'Send message'
  AttachSendButton $true
  SendTick 'send_unverified' 1

  # ---- S6: THE OMNIBOX GATE applies to clicks too. -------------------------
  LoadWeb $WEB_CLAUDE_ARMED
  LoadRows $ROWS_CLAUDE_WEB
  ResetState; ResetSendState
  WebTick 'send_omnibox_gate' 0 'https://claude.ai/chat/abc' $FOCUS_CLAUDE_COMPOSER | Out-Null
  SetButtonName 'Send message'
  AttachSendButton $true
  SendTick 'send_omnibox_gate' 1
  # Caret moves to the address bar. The click block must go with the Enter block.
  WebTick 'send_omnibox_gate' 2 'https://claude.ai/chat/abc' $FOCUS_OMNIBOX | Out-Null
  SendTick 'send_omnibox_gate' 3

  # ---- S7: THE PANIC HOTKEY releases the click path. -----------------------
  ResetState; ResetSendState
  WebTick 'send_panic' 0 'https://claude.ai/chat/abc' $FOCUS_CLAUDE_COMPOSER | Out-Null
  SetButtonName 'Send message'
  AttachSendButton $true
  SendTick 'send_panic' 1
  SetF '_disarmedUntilTicks' ([long]([DateTime]::UtcNow.Ticks + [TimeSpan]::FromMinutes(10).Ticks))
  SendTick 'send_panic' 2
  SetF '_disarmedUntilTicks' ([long]0)

  # ---- S8: THE FRESHNESS TTL. A rect nobody re-verified goes COLD. ---------
  # This is the bound that protects the hook when the poll thread stalls: it
  # cannot re-verify anything itself, so it refuses a rect that was not verified
  # recently. Aged out rather than slept through.
  ResetState; ResetSendState
  WebTick 'send_rect_ttl' 0 'https://claude.ai/chat/abc' $FOCUS_CLAUDE_COMPOSER | Out-Null
  SetButtonName 'Send message'
  AttachSendButton $true
  SendTick 'send_rect_ttl' 1
  # Still fresh a moment later, with no new tick at all.
  SendStaleCheck 'send_rect_ttl' 2
  # Aged past WEB_SEND_RECT_TTL with the poll thread stopped: the hook must
  # refuse the rect it was previously happy with. No tick in between, because a
  # tick would re-verify and legitimately re-stamp it.
  Age '_webSendVerifiedTicks' 1000
  SendStaleCheck 'send_rect_ttl' 3

  # ---- S9: LEAVING THE BROWSER drops the rect and the cache. ---------------
  ResetState; ResetSendState
  WebTick 'send_leave_browser' 0 'https://claude.ai/chat/abc' $FOCUS_CLAUDE_COMPOSER | Out-Null
  SetButtonName 'Send message'
  AttachSendButton $true
  SendTick 'send_leave_browser' 1
  WebTick 'send_leave_browser' 2 $null $null ([uint32]999) 'notepad' | Out-Null
  SendTick 'send_leave_browser' 3

  LoadWeb $WEB_SHIPPED
}

# ==================== THE 2026-09-09 LIVE BYPASS ============================
#
# Real user, gemini.google.com armed. A secret was PASTED into the composer and
# Enter sent it raw, with NOTHING logged. The monitor log showed the govstate
# arm/disarm flapping every 500ms and then sitting disarmed for 55 seconds; the
# send happened inside that window.
#
# Root cause: `isAi` for a browser required the composer to be FOCUSED, so any
# focus move inside the page dropped the surface -- which switched off the UIA
# read that is the ONLY paste detector (a Ctrl+V contributes no character
# keystrokes, so the typed buffer stays empty). These scenarios are the
# regression coverage, and the harness had no case for any of them.

# ---- Z1: FOCUS ROUND-TRIP with NO navigation. --------------------------------
# The flap itself. Focus leaves the composer for a page element and comes back,
# with no navigation of any kind. The host must stay resolved, the surface must
# stay armed, govstate must NOT toggle, and the composer must stay READABLE the
# whole time.
LoadWeb $WEB_CLAUDE_ARMED
LoadRows $ROWS_EMPTY
ResetState
WebTick 'focus_roundtrip' 0 'https://claude.ai/chat/abc' $FOCUS_CLAUDE_COMPOSER  $CHROME_PID 'chrome' 'Claude'
WebTick 'focus_roundtrip' 1 'https://claude.ai/chat/abc' $FOCUS_TRANSCRIPT      $CHROME_PID 'chrome' 'Claude'
WebTick 'focus_roundtrip' 2 'https://claude.ai/chat/abc' $FOCUS_TRANSCRIPT      $CHROME_PID 'chrome' 'Claude'
# An UNREADABLE focused-element read in the middle of it -- routine, and it must
# not disarm anything either.
WebTick 'focus_roundtrip' 3 'https://claude.ai/chat/abc' $null                  $CHROME_PID 'chrome' 'Claude'
WebTick 'focus_roundtrip' 4 'https://claude.ai/chat/abc' $FOCUS_CLAUDE_COMPOSER $CHROME_PID 'chrome' 'Claude'

# ---- Z2: THE PASTE. Sensitive text in the composer, EMPTY typed buffer. ------
# This is the exact bypass. Nothing is typed, so the keystroke buffer has no
# characters at all; the composer's UIA text is the only signal there is. It
# must survive a focus round-trip.
ResetState
WebTick 'paste_after_focus_roundtrip' 0 'https://claude.ai/chat/abc' $FOCUS_CLAUDE_COMPOSER $CHROME_PID 'chrome' 'Claude'
# The user clicks the response, then pastes into the composer without clicking
# back first (the paste itself restores focus, but the poll tick in between sees
# the transcript focused).
WebTick 'paste_after_focus_roundtrip' 1 'https://claude.ai/chat/abc' $FOCUS_TRANSCRIPT      $CHROME_PID 'chrome' 'Claude'
WebTick 'paste_after_focus_roundtrip' 2 'https://claude.ai/chat/abc' $FOCUS_TRANSCRIPT      $CHROME_PID 'chrome' 'Claude'
WebTick 'paste_after_focus_roundtrip' 3 'https://claude.ai/chat/abc' $FOCUS_CLAUDE_COMPOSER $CHROME_PID 'chrome' 'Claude'

# ---- Z3: AFTER A TOKENIZE & SEND, new pasted content blocks again. -----------
# RunRewrite clears _blockUia/_uiaPatterns/_blockTyped/_lastBlockFiredTicks
# immediately before its synthetic Enter, which it must (its own masked text
# would otherwise re-block it). The question is whether the NEXT paste re-arms.
# Modelled by clearing exactly the fields RunRewrite clears, then running ticks.
ResetState
WebTick 'reblock_after_tokenize' 0 'https://claude.ai/chat/abc' $FOCUS_CLAUDE_COMPOSER $CHROME_PID 'chrome' 'Claude'
ClearAfterRewrite
WebTick 'reblock_after_tokenize' 1 'https://claude.ai/chat/abc' $FOCUS_CLAUDE_COMPOSER $CHROME_PID 'chrome' 'Claude'
# ...and again after a focus round-trip, which is how the user actually hit it.
WebTick 'reblock_after_tokenize' 2 'https://claude.ai/chat/abc' $FOCUS_TRANSCRIPT      $CHROME_PID 'chrome' 'Claude'
WebTick 'reblock_after_tokenize' 3 'https://claude.ai/chat/abc' $FOCUS_CLAUDE_COMPOSER $CHROME_PID 'chrome' 'Claude'

# ---- Z4: the composer stays scanned, but ONLY the composer. -----------------
# The widening must not make any OTHER element readable. Focus moves to a
# PASSWORD field on the governed host after the composer was cached: the
# composer stays readable (that is the fix) and the password field is not what
# gets read (that is the safety). Capture stays off, and a whole-site block must
# not leave Enter dead in the login form.
LoadRows $ROWS_CLAUDE_WEB
ResetState
WebTick 'password_after_composer' 0 'https://claude.ai/chat/abc' $FOCUS_CLAUDE_COMPOSER $CHROME_PID 'chrome' 'Claude'
WebTick 'password_after_composer' 1 'https://claude.ai/chat/abc' $FOCUS_PASSWORD        $CHROME_PID 'chrome' 'Claude'
WebTick 'password_after_composer' 2 'https://claude.ai/chat/abc' $FOCUS_PASSWORD        $CHROME_PID 'chrome' 'Claude'
WebTick 'password_after_composer' 3 'https://claude.ai/chat/abc' $FOCUS_CLAUDE_COMPOSER $CHROME_PID 'chrome' 'Claude'
# The OMNIBOX, same shape: readable composer, and Enter must still navigate.
ResetState
WebTick 'omnibox_after_composer' 0 'https://claude.ai/chat/abc' $FOCUS_CLAUDE_COMPOSER $CHROME_PID 'chrome' 'Claude'
WebTick 'omnibox_after_composer' 1 'https://claude.ai/chat/abc' $FOCUS_OMNIBOX         $CHROME_PID 'chrome' 'Claude'

# ---- Z5: a NAVIGATION still drops the composer cache. -----------------------
# The one thing that must NOT survive: after a tab switch or a navigation the
# cached element belongs to a page that is no longer in front of the user, so
# reading it would be reading the previous page.
LoadRows $ROWS_EMPTY
ResetState
WebTick 'nav_drops_composer' 0 'https://claude.ai/chat/aaa' $FOCUS_CLAUDE_COMPOSER $CHROME_PID 'chrome' 'Payroll - Claude'
WebTick 'nav_drops_composer' 1 'https://claude.ai/chat/aaa' $FOCUS_TRANSCRIPT      $CHROME_PID 'chrome' 'Payroll - Claude'
# Same-host tab switch: the title changes, so the sweep bumps the generation.
WebTick 'nav_drops_composer' 2 'https://claude.ai/chat/bbb' $FOCUS_TRANSCRIPT      $CHROME_PID 'chrome' 'Holiday - Claude'
# A HOST change, off the governed host entirely.
WebTick 'nav_drops_composer' 3 'https://mail.google.com/'   $FOCUS_GMAIL_BODY      $CHROME_PID 'chrome' 'Inbox'
# A SECOND WINDOW.
ResetState
WebTick 'nav_drops_composer_win' 0 'https://claude.ai/chat/aaa' $FOCUS_CLAUDE_COMPOSER $CHROME_PID 'chrome' 'Claude' 1001
WebTick 'nav_drops_composer_win' 1 'https://claude.ai/chat/aaa' $FOCUS_TRANSCRIPT      $CHROME_PID 'chrome' 'Claude' 2002



# ---- Z6: THE CLICK RACE. Block arms, click WITHIN ONE POLL TICK. ------------
#
# THE ACCEPTANCE TEST for the 2026-09-09 click bypass. The rect must already be
# warm from ordinary composer focus, so the very first tick on which a block is
# armed can swallow a click -- no search, no second tick, no race.
LoadWeb $WEB_CLAUDE_ARMED
LoadRows $ROWS_EMPTY
ResetState; ResetSendState
if ($script:sendProbeOk) {
  # A tick with NO block at all: the rect warms anyway (that is the fix), and a
  # click is NOT swallowed (that is the proof the decision did not loosen).
  WebTick 'click_race' 0 'https://claude.ai/chat/abc' $FOCUS_CLAUDE_COMPOSER $CHROME_PID 'chrome' 'Claude' | Out-Null
  SetButtonName 'Send message'
  AttachSendButton $true
  SendTick 'click_race' 1
  # NOW the user finishes typing and the block arms -- instantly, in the hook,
  # by setting a boolean. No new poll tick and no search happen in between: the
  # click must be swallowed off the ALREADY WARM rect.
  SetF '_blockTyped' $true
  SetF '_typedBlockTicks' ([long][DateTime]::UtcNow.Ticks)
  SendStaleCheck 'click_race' 2
  # TWO CONSECUTIVE CLICKS with the sensitive text still in the composer. The
  # swallow path stamps _lastBlockFiredTicks (a 30s cooldown) and does NOT clear
  # the buffer, so the second click must be swallowed too.
  SetF '_lastBlockFiredTicks' ([long][DateTime]::UtcNow.Ticks)
  SendTick 'click_race' 3
  SendTick 'click_race' 4
  # The relabel hazard again, now that the rect can be warm BEFORE any block.
  SetButtonName 'Use voice mode'
  SendTick 'click_race' 5
  SetButtonName 'Send message'
  SendTick 'click_race' 6
  SetF '_blockTyped' $false
  SetF '_lastBlockFiredTicks' ([long]0)
}

# ============ FINDING 1: UNFOCUS THE COMPOSER, CLICK THE SEND ARROW =========
#
# THE ACCEPTANCE TEST for the 2026-09-09 unfocused-click bypass, driven with
# ordinary user actions: paste a secret into the composer (the block arms),
# click the transcript or the page margin (the caret leaves the composer),
# click the send arrow. It sent -- against a DLP content block AND against a
# whole-site platform block, so "you may not use claude.ai" was defeated by
# clicking the page first.
#
# TWO independent gates each caused it and both are exercised here:
#   * UpdateWebSendRect required _fgIsWebComposer, so the rect stopped being
#     published the instant focus moved and the hook never even consulted
#     BlockActiveForMouse();
#   * BlockActiveForMouse fell through to PanelEnforceOk(), which answers
#     _fgIsWebComposer for a browser -- and a CONTENT block sets no
#     _blockedByElement, so it returned false.
if ($script:sendProbeOk) {

  # ---- F1a: a DLP CONTENT BLOCK with the composer UNFOCUSED. ---------------
  LoadWeb $WEB_CLAUDE_ARMED
  LoadRows $ROWS_EMPTY
  ResetState; ResetSendState
  WebTick 'unfocused_click_content' 0 'https://claude.ai/chat/abc' $FOCUS_CLAUDE_COMPOSER $CHROME_PID 'chrome' 'Claude' | Out-Null
  SetButtonName 'Send message'
  AttachSendButton $true
  # The secret goes in. A block arms in the hook by setting a boolean, exactly
  # as the typed-buffer scan does -- no poll tick is needed for that.
  SetF '_blockTyped' $true
  SetF '_typedBlockTicks' ([long][DateTime]::UtcNow.Ticks)
  SetF '_typedPatterns' 'aws_secret_key'
  SendTick 'unfocused_click_content' 1
  # THE BYPASS. The user clicks the TRANSCRIPT. Same page, same window, same
  # tab, same host -- the only thing that changed is where the caret is.
  WebTick 'unfocused_click_content' 2 'https://claude.ai/chat/abc' $FOCUS_TRANSCRIPT $CHROME_PID 'chrome' 'Claude' | Out-Null
  SendTick 'unfocused_click_content' 3
  # ...and the PAGE MARGIN, i.e. a focused-element read that returns nothing at
  # all. Routine, and it must not withdraw the click block either.
  WebTick 'unfocused_click_content' 4 'https://claude.ai/chat/abc' $null $CHROME_PID 'chrome' 'Claude' | Out-Null
  SendTick 'unfocused_click_content' 5
  # A second click with the secret still in the composer, after the first one
  # stamped the cooldown. Still swallowed.
  SetF '_lastBlockFiredTicks' ([long][DateTime]::UtcNow.Ticks)
  SendTick 'unfocused_click_content' 6
  # ...and back in the composer, which must not have regressed.
  WebTick 'unfocused_click_content' 7 'https://claude.ai/chat/abc' $FOCUS_CLAUDE_COMPOSER $CHROME_PID 'chrome' 'Claude' | Out-Null
  SendTick 'unfocused_click_content' 8
  SetF '_blockTyped' $false
  SetF '_typedPatterns' ''
  SetF '_lastBlockFiredTicks' ([long]0)

  # ---- F1b: a PLATFORM BLOCK (whole-site) with the composer UNFOCUSED. -----
  LoadRows $ROWS_CLAUDE_WEB
  ResetState; ResetSendState
  WebTick 'unfocused_click_platform' 0 'https://claude.ai/chat/abc' $FOCUS_CLAUDE_COMPOSER $CHROME_PID 'chrome' 'Claude' | Out-Null
  SetButtonName 'Send message'
  AttachSendButton $true
  SendTick 'unfocused_click_platform' 1
  WebTick 'unfocused_click_platform' 2 'https://claude.ai/chat/abc' $FOCUS_TRANSCRIPT $CHROME_PID 'chrome' 'Claude' | Out-Null
  SendTick 'unfocused_click_platform' 3
  WebTick 'unfocused_click_platform' 4 'https://claude.ai/chat/abc' $null $CHROME_PID 'chrome' 'Claude' | Out-Null
  SendTick 'unfocused_click_platform' 5

  # ---- F1c: STILL SHUT -- NO BLOCK, composer unfocused. --------------------
  # The rect is warm (that is the fix); the DECISION must not have loosened.
  LoadRows $ROWS_EMPTY
  ResetState; ResetSendState
  WebTick 'unfocused_click_noblock' 0 'https://claude.ai/chat/abc' $FOCUS_CLAUDE_COMPOSER $CHROME_PID 'chrome' 'Claude' | Out-Null
  SetButtonName 'Send message'
  AttachSendButton $true
  WebTick 'unfocused_click_noblock' 1 'https://claude.ai/chat/abc' $FOCUS_TRANSCRIPT $CHROME_PID 'chrome' 'Claude' | Out-Null
  SendTick 'unfocused_click_noblock' 2

  # ---- F1d: STILL SHUT -- the OMNIBOX, with a block armed. -----------------
  # The rect may now be warm while the caret is in browser chrome (the page has
  # not changed), but WebBlockGateOk() must still refuse the CLICK, and Enter
  # must still navigate.
  LoadRows $ROWS_CLAUDE_WEB
  ResetState; ResetSendState
  WebTick 'unfocused_click_omnibox' 0 'https://claude.ai/chat/abc' $FOCUS_CLAUDE_COMPOSER $CHROME_PID 'chrome' 'Claude' | Out-Null
  SetButtonName 'Send message'
  AttachSendButton $true
  SendTick 'unfocused_click_omnibox' 1
  WebTick 'unfocused_click_omnibox' 2 'https://claude.ai/chat/abc' $FOCUS_OMNIBOX $CHROME_PID 'chrome' 'Claude' | Out-Null
  SendTick 'unfocused_click_omnibox' 3
  # ---- ...and a PASSWORD FIELD on the governed host, same rule. ------------
  ResetState; ResetSendState
  WebTick 'unfocused_click_password' 0 'https://claude.ai/chat/abc' $FOCUS_CLAUDE_COMPOSER $CHROME_PID 'chrome' 'Claude' | Out-Null
  SetButtonName 'Send message'
  AttachSendButton $true
  SendTick 'unfocused_click_password' 1
  WebTick 'unfocused_click_password' 2 'https://claude.ai/chat/abc' $FOCUS_PASSWORD $CHROME_PID 'chrome' 'Claude' | Out-Null
  SendTick 'unfocused_click_password' 3

  # ---- F1e: STILL SHUT -- an UNVERIFIED surface, composer unfocused. -------
  # The shipped catalog. Nothing may be published and nothing may be searched.
  LoadWeb $WEB_SHIPPED
  LoadRows $ROWS_CLAUDE_WEB
  ResetState; ResetSendState
  WebTick 'unfocused_click_unverified' 0 'https://claude.ai/chat/abc' $FOCUS_CLAUDE_COMPOSER $CHROME_PID 'chrome' 'Claude' | Out-Null
  SetButtonName 'Send message'
  AttachSendButton $true
  SetF '_blockTyped' $true
  SetF '_typedBlockTicks' ([long][DateTime]::UtcNow.Ticks)
  SendTick 'unfocused_click_unverified' 1
  WebTick 'unfocused_click_unverified' 2 'https://claude.ai/chat/abc' $FOCUS_TRANSCRIPT $CHROME_PID 'chrome' 'Claude' | Out-Null
  SendTick 'unfocused_click_unverified' 3
  SetF '_blockTyped' $false

  # ---- F1f: LEAVING THE PAGE withdraws the rect even with focus never in ---
  #          the composer again. A NAVIGATION drops the composer cache, which is
  #          what the readable-not-focused gate now depends on -- so this is the
  #          bound that stops "readable" meaning "forever".
  LoadWeb $WEB_CLAUDE_ARMED
  LoadRows $ROWS_CLAUDE_WEB
  ResetState; ResetSendState
  WebTick 'unfocused_click_nav' 0 'https://claude.ai/chat/aaa' $FOCUS_CLAUDE_COMPOSER $CHROME_PID 'chrome' 'Payroll - Claude' | Out-Null
  SetButtonName 'Send message'
  AttachSendButton $true
  SendTick 'unfocused_click_nav' 1
  # A same-host tab switch: the title changes, so the sweep bumps the
  # navigation generation and the cached composer is dropped.
  WebTick 'unfocused_click_nav' 2 'https://claude.ai/chat/bbb' $FOCUS_TRANSCRIPT $CHROME_PID 'chrome' 'Holiday - Claude' | Out-Null
  SendTick 'unfocused_click_nav' 3
  # ...and off the governed host entirely.
  WebTick 'unfocused_click_nav' 4 'https://mail.google.com/' $FOCUS_GMAIL_BODY $CHROME_PID 'chrome' 'Inbox' | Out-Null
  SendTick 'unfocused_click_nav' 5

  LoadWeb $WEB_SHIPPED
}

# ============ THE APP-SWITCH BYPASS: alt-tab away, come back, click ==========
#
# THE ACCEPTANCE TEST for the residual left open by the unfocused-click fix.
# UpdateForeground's app-switch branch used to call DropWebComposer(), and the
# cache could only be refilled by a read that requires the composer to HAVE
# FOCUS. So:
#
#   block armed -> click the transcript -> alt-tab to another app -> alt-tab
#   back -> click the send arrow  ==>  no rect, no swallow, IT SENT.
#
# Driven on GEMINI rather than claude.ai on purpose: every other scenario in
# this file runs on claude.ai, and the fix is host-agnostic or it is not a fix.
# See $WS_GEMINI_ON for what is fixture-only about that host.
if ($script:sendProbeOk) {
  LoadWeb $WEB_GEMINI_ARMED
  LoadRows $ROWS_GEMINI_WEB
  ResetState; ResetSendState
  WebTick 'appswitch_return_click' 0 'https://gemini.google.com/app' $FOCUS_GEMINI_COMPOSER $CHROME_PID 'chrome' 'Gemini' | Out-Null
  SetButtonName 'Send message'
  AttachSendButton $true 'gemini.google.com'
  # Baseline: composer focused, whole-site block armed, click swallowed.
  SendTick 'appswitch_return_click' 1
  # The caret leaves the composer, still on the same page. Covered by the
  # unfocused-click fix, and re-asserted here so the two fixes are shown to
  # compose rather than being tested in isolation.
  WebTick 'appswitch_return_click' 2 'https://gemini.google.com/app' $FOCUS_TRANSCRIPT $CHROME_PID 'chrome' 'Gemini' | Out-Null
  SendTick 'appswitch_return_click' 3
  # ANOTHER APP, for two ticks. Nothing about the page changed; the user just
  # looked at something else. Everything must go INERT here.
  WebTick 'appswitch_return_click' 4 $null $null ([uint32]999) 'notepad' | Out-Null
  SendTick 'appswitch_return_click' 5
  WebTick 'appswitch_return_click' 6 $null $null ([uint32]999) 'notepad' | Out-Null
  # BACK to the browser, and the caret is STILL NOT in the composer -- which is
  # the whole point. No re-attach: the send-button reference has to have
  # survived too, or the rect costs a fresh 105-489ms search and the click on
  # THIS tick is unprotected.
  WebTick 'appswitch_return_click' 7 'https://gemini.google.com/app' $FOCUS_TRANSCRIPT $CHROME_PID 'chrome' 'Gemini' | Out-Null
  SendTick 'appswitch_return_click' 8
  # ...and clicking into the composer afterwards is still fine.
  WebTick 'appswitch_return_click' 9 'https://gemini.google.com/app' $FOCUS_GEMINI_COMPOSER $CHROME_PID 'chrome' 'Gemini' | Out-Null
  SendTick 'appswitch_return_click' 10

  # ---- THE DROPS THAT MUST REMAIN -----------------------------------------
  #
  # Only the APP SWITCH stopped being a drop. Each of the four signals
  # UpdateBrowserNav watches means the cached element belongs to a page the user
  # is no longer on, and each must still withdraw the rect and leave a
  # subsequent click un-swallowed. Asserted through the CLICK path, because that
  # is what the retained cache now feeds.
  LoadWeb $WEB_CLAUDE_ARMED
  LoadRows $ROWS_CLAUDE_WEB

  # (a) SAME-HOST TAB SWITCH, visible only through the title fingerprint.
  ResetState; ResetSendState
  WebTick 'cache_drop_tabswitch' 0 'https://claude.ai/chat/aaa' $FOCUS_CLAUDE_COMPOSER $CHROME_PID 'chrome' 'Payroll - Claude' | Out-Null
  SetButtonName 'Send message'; AttachSendButton $true
  SendTick 'cache_drop_tabswitch' 1
  WebTick 'cache_drop_tabswitch' 2 'https://claude.ai/chat/bbb' $FOCUS_TRANSCRIPT $CHROME_PID 'chrome' 'Holiday - Claude' | Out-Null
  SendTick 'cache_drop_tabswitch' 3

  # (b) HOST CHANGE, off the governed host entirely.
  ResetState; ResetSendState
  WebTick 'cache_drop_host' 0 'https://claude.ai/chat/aaa' $FOCUS_CLAUDE_COMPOSER $CHROME_PID 'chrome' 'Claude' | Out-Null
  SetButtonName 'Send message'; AttachSendButton $true
  SendTick 'cache_drop_host' 1
  WebTick 'cache_drop_host' 2 'https://mail.google.com/' $FOCUS_GMAIL_BODY $CHROME_PID 'chrome' 'Inbox' | Out-Null
  SendTick 'cache_drop_host' 3

  # (c) WINDOW CHANGE -- a second browser window, same host, same title.
  ResetState; ResetSendState
  WebTick 'cache_drop_window' 0 'https://claude.ai/chat/aaa' $FOCUS_CLAUDE_COMPOSER $CHROME_PID 'chrome' 'Claude' 1001 | Out-Null
  SetButtonName 'Send message'; AttachSendButton $true
  SendTick 'cache_drop_window' 1
  WebTick 'cache_drop_window' 2 'https://claude.ai/chat/aaa' $FOCUS_TRANSCRIPT $CHROME_PID 'chrome' 'Claude' 2002 | Out-Null
  SendTick 'cache_drop_window' 3

  # (d) A NAVIGATION CHORD -- Ctrl+T, Ctrl+W, Alt+Left, F5, Enter in the
  #     omnibox. The hook stamps a TIMESTAMP and nothing else; set here exactly
  #     as HookCallback sets it, since no hook is installed.
  ResetState; ResetSendState
  WebTick 'cache_drop_navchord' 0 'https://claude.ai/chat/aaa' $FOCUS_CLAUDE_COMPOSER $CHROME_PID 'chrome' 'Claude' | Out-Null
  SetButtonName 'Send message'; AttachSendButton $true
  SendTick 'cache_drop_navchord' 1
  SetF '_browserNavInputTicks' ([long][DateTime]::UtcNow.Ticks)
  WebTick 'cache_drop_navchord' 2 'https://claude.ai/chat/aaa' $FOCUS_TRANSCRIPT $CHROME_PID 'chrome' 'Claude' | Out-Null
  SendTick 'cache_drop_navchord' 3

  LoadWeb $WEB_SHIPPED
  LoadRows $ROWS_EMPTY
  ResetState; ResetSendState
}

# ---- F1g: ENTER MUST STILL REQUIRE COMPOSER FOCUS. -------------------------
#
# The proof that loosening the CLICK path did not loosen the KEYSTROKE path.
# Needs no UIA element, so it runs outside the send-probe guard: the same page,
# the same block and the same focus moves, with only the REAL Enter predicate
# asked. A DLP CONTENT block must go quiet the moment the caret leaves the
# composer, because Enter anywhere else on the page does not send -- and
# because swallowing it there would kill Enter in the site's own search box.
LoadWeb $WEB_CLAUDE_ARMED
LoadRows $ROWS_EMPTY
ResetState
WebTick 'unfocused_enter_content' 0 'https://claude.ai/chat/abc' $FOCUS_CLAUDE_COMPOSER $CHROME_PID 'chrome' 'Claude'
WebTick 'unfocused_enter_content' 1 'https://claude.ai/chat/abc' $FOCUS_TRANSCRIPT      $CHROME_PID 'chrome' 'Claude'
WebTick 'unfocused_enter_content' 2 'https://claude.ai/chat/abc' $null                  $CHROME_PID 'chrome' 'Claude'
WebTick 'unfocused_enter_content' 3 'https://claude.ai/chat/abc' $FOCUS_CLAUDE_COMPOSER $CHROME_PID 'chrome' 'Claude'
# ...and with a PLATFORM block, where the answer is deliberately DIFFERENT: a
# whole-site block is element-scoped through _blockedByElement, which is checked
# AHEAD of PanelEnforceOk, so it survives the focus move for Enter as well. That
# asymmetry is the design (a site block means "not this site", a content block
# means "not this text in this composer"), and it is recorded here so a future
# change cannot flatten the two without a test failing.
LoadRows $ROWS_CLAUDE_WEB
ResetState
WebTick 'unfocused_enter_platform' 0 'https://claude.ai/chat/abc' $FOCUS_CLAUDE_COMPOSER $CHROME_PID 'chrome' 'Claude'
WebTick 'unfocused_enter_platform' 1 'https://claude.ai/chat/abc' $FOCUS_TRANSCRIPT      $CHROME_PID 'chrome' 'Claude'
# THE OMNIBOX, with the same site block armed: Enter must still NAVIGATE.
WebTick 'unfocused_enter_platform' 2 'https://claude.ai/chat/abc' $FOCUS_OMNIBOX         $CHROME_PID 'chrome' 'Claude'
LoadWeb $WEB_SHIPPED
LoadRows $ROWS_EMPTY
ResetState

# ==================== THE STICKY _app WINDOW (FINDING 2) ====================
#
# Alt-tab from Claude Desktop (or ChatGPT Desktop) straight into a browser.
# _app is assigned ONLY on a tick that was an AI surface, so for FG_STICKY_TTL
# (3s) it still names the DESKTOP app while the window in front of the user is
# Chrome. Every guard that asked `_browserProcs.Contains(_app)` was therefore
# SKIPPED, and the DESKTOP code paths ran against the browser window.
#
# Driven the way the user hits it, with production code doing the deciding: one
# REAL ApplyForegroundTick for the desktop app (which is the only thing in the
# file that assigns _app), then a REAL browser tick that does NOT re-assign it.
# Nothing here re-implements a guard; the probe below only reads the answers.
function LeaveDesktopAiForBrowser([string]$desktopProc = 'Claude') {
  ResetState; ResetSendState
  # THE ONLY THING THAT ASSIGNS _app: a tick that really is an AI surface.
  Call 'ApplyForegroundTick' @([uint32]777, $desktopProc, $false, $null, '', $false,
                               $OUT_UNREADABLE, '', $WEB_UNREADABLE, '', $false, '', $false, 0, '') | Out-Null
  # ...and now the BROWSER is in front, on an ungoverned tab. isAi is false for
  # this tick, so _app is NOT re-assigned and the sticky timer starts instead --
  # which is the whole state under test. _fgIsBrowser is published by
  # UpdateForeground, exactly as WebTick publishes it.
  SetF '_fgIsBrowser' $true
  Call 'ApplyForegroundTick' @([uint32]$CHROME_PID, 'chrome', $false, $null, '', $false,
                               $OUT_UNREADABLE, '', $WEB_UNREADABLE, '', $false, '', $false, 0, '') | Out-Null
}

function StickyProbe([string]$scenario, [int]$n) {
  $obj = [ordered]@{
    scenario     = $scenario
    tick         = $n
    # The state itself, so a test can prove the scenario is the real one rather
    # than asserting against a setup that quietly stopped reproducing.
    app          = [string](GetF '_app')
    fgIsAi       = [bool](GetF '_fgIsAi')
    fgIsBrowser  = [bool](GetF '_fgIsBrowser')
    sticky       = ([long](GetF '_fgLeftAiTicks') -ne 0)
    # The production predicate the fix turns on.
    fgBrowserNow = [bool](Call 'ForegroundIsBrowser')
    # UpdateUia and UpdatePendingRewrite are BOTH gated on this composite
    # (`!_fgIsAi || !PanelUiaOk()`), so a false here is "FocusedElement is never
    # reached". PanelUiaOk alone is reported too, because the defect was that it
    # answered the PERMISSIVE fall-through for a browser foreground.
    panelUiaOk   = [bool](Call 'PanelUiaOk')
    uiaOk        = ([bool](GetF '_fgIsAi') -and [bool](Call 'PanelUiaOk'))
    # Did UpdatePendingRewrite take its guard's early return? _pendingFrozen is
    # set to true in EXACTLY ONE place in the file -- inside that return -- so
    # this is a POSITIVE marker that the guard fired and nothing was pinned,
    # rather than an absence that could have any number of causes.
    pendingFrozen = [bool](GetF '_pendingFrozen')
    pendingBlockId = [string](GetF '_pendingBlockId')
    # Did UpdateModelRouting return early? The guard clears the pinned route on
    # its way out, and _mrLastPickerSearchTicks stays 0 only if the descendant
    # picker search was never even reached.
    routeArmed   = [bool](GetF '_pendingRouteArmed')
    pickerSearched = ([long](GetF '_mrLastPickerSearchTicks') -ne 0)
    pickerSearchInProgress = [bool](GetF '_mrPickerSearchInProgress')
    # UpdateSendRect: did the BROWSER DELEGATION fire? UpdateWebSendRect clears
    # the freshness stamp on every one of its early returns; the desktop body
    # never touches the stamp once it is past its own first gate. So a stamp
    # that was fresh going in and is 0 coming out means the delegation happened
    # and the generic descendant search never ran.
    fgIsBlocked  = [bool](GetF '_fgIsBlocked')
    hasRect      = [bool](GetF '_hasRect')
    verifiedAt   = [long](GetF '_webSendVerifiedTicks')
    # The paste gate's refusal, and the mouse-path enforce predicate.
    blockPaste   = [bool](GetF '_blockPaste')
    mouseEnforceOk = [bool](Call 'MouseEnforceOk')
  }
  Write-Output ($obj | ConvertTo-Json -Compress)
}

# ---- Y1: no block armed. The four read paths must all stay shut. ------------
LoadWeb $WEB_SHIPPED
LoadRows $ROWS_EMPTY
LeaveDesktopAiForBrowser 'Claude'
# A pin and a route are planted FIRST, so "pinned nothing" and "returned early"
# are observable as positive facts.
SetF '_modelRouterEnabled' $true
SetF '_pendingRewritable' $true
SetF '_pendingBlockId' 'sentinel-pin'
SetF '_pendingExpiresAt' ([long]([DateTime]::UtcNow.Ticks + [TimeSpan]::FromMinutes(5).Ticks))
SetF '_pendingFrozen' $false
SetF '_mrLastPickerSearchTicks' ([long]0)
SetF '_mrPickerSearchInProgress' $false
# The clipboard gate too: it reads the user's actual clipboard, and the window
# in front of them is an arbitrary web page.
SetF '_blockPaste' $true
Call 'UpdateUia' | Out-Null
Call 'UpdatePendingRewrite' | Out-Null
Call 'UpdatePaste' | Out-Null
StickyProbe 'sticky_app_reads' 0
SetF '_modelRouterEnabled' $false
SetF '_pendingRewritable' $false
SetF '_pendingBlockId' ''
SetF '_pendingFrozen' $false

# ---- Y2: the same window with a PLATFORM BLOCK armed in the desktop app. ----
# This is what gets UpdateSendRect past its "is a block active" gate, which is
# what made the generic search reachable in the first place.
LeaveDesktopAiForBrowser 'Claude'
SetF '_fgIsBlocked' $true
SetF '_blockedByElement' $false
SetF '_blockedReason' 'Blocked platform: Claude'
# A bogus rect and a FRESH stamp going in. Both must be gone coming out.
SetF '_hasRect' $true
SetF '_rx' 10; SetF '_ry' 10; SetF '_rw' 40; SetF '_rh' 46
SetF '_webSendVerifiedTicks' ([long][DateTime]::UtcNow.Ticks)
Call 'UpdateSendRect' | Out-Null
StickyProbe 'sticky_app_sendrect' 0
ResetState; ResetSendState

# ---- Y4: MODEL ROUTING, on a tick where NOTHING ELSE would clear the pin. ---
#
# This scenario exists because the obvious version of it was VACUOUS. Driving
# UpdateModelRouting on Y1's tick proved nothing: Y1 plants a pending REWRITE,
# and the routing body's own `if (pendingRewritable) { ClearPendingRoute();
# return; }` then cleared the route whether the browser exclusion fired or not.
# Verified by mutation -- reverting the guard alone left the test green.
#
# So: no block, no pending rewrite, nothing else on the way out. With the
# exclusion in place the guard clears the pinned route and the picker search is
# never reached. Without it, every remaining path either returns WITHOUT
# clearing (fg zero, no focused element, empty text) or reaches
# GetCachedModelPicker and stamps _mrLastPickerSearchTicks -- so one of the two
# observations below flips either way.
LeaveDesktopAiForBrowser 'Claude'
SetF '_modelRouterEnabled' $true
SetF '_pendingRewritable' $false
SetF '_pendingFrozen' $false
SetF '_pendingRouteArmed' $true
SetF '_pendingRouteId' 'sentinel-route'
SetF '_mrLastPickerSearchTicks' ([long]0)
SetF '_mrPickerSearchInProgress' $false
Call 'UpdateModelRouting' | Out-Null
StickyProbe 'sticky_app_routing' 0
SetF '_modelRouterEnabled' $false
SetF '_pendingRouteArmed' $false
SetF '_pendingRouteId' ''
ResetState; ResetSendState

# ---- Y3: CHATGPT DESKTOP, i.e. not just the one process name. ---------------
LeaveDesktopAiForBrowser 'ChatGPT'
SetF '_modelRouterEnabled' $true
SetF '_pendingRouteArmed' $true
SetF '_mrLastPickerSearchTicks' ([long]0)
Call 'UpdateUia' | Out-Null
Call 'UpdateModelRouting' | Out-Null
StickyProbe 'sticky_app_reads_chatgpt' 0
SetF '_modelRouterEnabled' $false
ResetState; ResetSendState

# ---- AI-218: the block cooldown belongs to ONE surface ---------------------
#
# Observed live 2026-09-21: a block on the agent "IT Help Desk Agent" left Enter
# dead in "stone Conversation Agent" twelve seconds later. The agent latch had
# released correctly -- the swallow came from the 30-second cooldown, which was
# an unscoped global, so it applied to every agent the user could reach.
#
# Driven through the REAL BlockCooldownKey/BlockCooldownActive rather than a
# copy of them, because the bug was in the decision, not in its description.
function CooldownProbe() {
  $saveApp   = GetF '_app'
  $saveHost  = GetF '_fgWebHost'
  $saveName  = GetF '_fgWebAgentName'
  $savePanel = GetF '_fgIsPanel'
  $saveTicks = GetF '_lastBlockFiredTicks'
  $saveKey   = GetF '_lastBlockSurfaceKey'

  SetF '_app' 'chrome'
  SetF '_fgIsPanel' $false
  SetF '_fgWebHost' 'm365.cloud.microsoft'
  SetF '_fgWebAgentName' 'IT Help Desk Agent'

  # A block fires HERE, so the cooldown is stamped with THIS surface -- exactly
  # as the Enter path stamps it.
  SetF '_lastBlockFiredTicks' ([DateTime]::UtcNow.Ticks)
  SetF '_lastBlockSurfaceKey' (Call 'BlockCooldownKey')
  $sameAgent = [bool](Call 'BlockCooldownActive')

  # THE REGRESSION. Same tab, same host, same url -- only the agent changed,
  # which is the one thing a host-scoped key cannot see.
  SetF '_fgWebAgentName' 'stone Conversation Agent'
  $otherAgent = [bool](Call 'BlockCooldownActive')

  # Back to the blocked agent: the cooldown must still be in force, or the fix
  # has simply deleted the protection instead of scoping it.
  SetF '_fgWebAgentName' 'IT Help Desk Agent'
  $backAgain = [bool](Call 'BlockCooldownActive')

  # A different governed host in the same browser is a different surface too.
  SetF '_fgWebHost' 'chatgpt.com'
  SetF '_fgWebAgentName' ''
  $otherHost = [bool](Call 'BlockCooldownActive')

  # And the window still expires on the surface it was armed for.
  SetF '_fgWebHost' 'm365.cloud.microsoft'
  SetF '_fgWebAgentName' 'IT Help Desk Agent'
  SetF '_lastBlockFiredTicks' ([long]([DateTime]::UtcNow.Ticks - [TimeSpan]::FromSeconds(31).Ticks))
  $expired = [bool](Call 'BlockCooldownActive')

  Write-Output (([ordered]@{
    scenario   = 'cooldown_scope'
    tick       = 0
    sameAgent  = $sameAgent
    otherAgent = $otherAgent
    backAgain  = $backAgain
    otherHost  = $otherHost
    expired    = $expired
  }) | ConvertTo-Json -Compress)

  SetF '_app' $saveApp
  SetF '_fgWebHost' $saveHost
  SetF '_fgWebAgentName' $saveName
  SetF '_fgIsPanel' $savePanel
  SetF '_lastBlockFiredTicks' $saveTicks
  SetF '_lastBlockSurfaceKey' $saveKey
}
CooldownProbe

# ---- AI-219: Gemini Enterprise, where the agent id is in the URL PATH -------
#
# The catalog payload below is the REAL one buildWebSurfaceConfig() ships for
# this surface -- not a fixture flip like $WS_CLAUDE_ON. It is armed in
# production (live-probed 2026-09-22), so the honest thing is to drive the
# shipped bytes.
$WS_GEMENT_ON = '{"id":"gemini_enterprise_web","host":"vertexaisearch.cloud.google.com","product":"Gemini Enterprise","vendor":"Google","platform":"","newlineKeys":"shift_enter","postSendVerifyMs":1500,"sendButtonControlType":"Button","sendButtonName":"Submit","composerName":"","composerControlType":"Group","composerNamePrefixes":[],"composerAutomationId":"agent-search-prosemirror-editor","composerFocusableChildClassName":"ProseMirror","genericNames":[],"platforms":["gemini_enterprise"],"agentReadMode":"url_path","agentReadUrlPattern":"/r/agent/([0-9]+)","agentReadEnforce":true,"agentReadVerified":true,"enforce":true,"verified":true}'

# THE TWO AGENT IDS MEASURED LIVE 2026-09-22, in the two URLs they came from.
# The customerId is a placeholder: the real one is not recorded anywhere in this
# repo, which is itself the point -- nothing but the capture group survives.
$GE_URL_A = 'vertexaisearch.cloud.google.com/home/cid/C01abc234/r/agent/18007293655158706549/session/-?hl=en_US'
$GE_URL_B = 'vertexaisearch.cloud.google.com/home/cid/C01abc234/r/agent/14428384541633907119/session/-?hl=en_US'
$GE_ID_A  = '18007293655158706549'
$GE_ID_B  = '14428384541633907119'
# One agent blocked BY ID. agent_name is deliberately a string the page never
# shows, because on this surface the name identifies nothing.
$ROWS_GEMENT_AGENT = '[{"platform":"gemini_enterprise","agent_name":"Deal Desk Agent","agent_id":"' + $GE_ID_A + '","reason":"Blocked by admin","agent_scope":"agent"}]'
# The same agent by NAME only, with no id at all -- the shape an admin gets
# wrong. On a url_path surface it must block nothing: there is no name to match.
$ROWS_GEMENT_NAMEONLY = '[{"platform":"gemini_enterprise","agent_name":"Deal Desk Agent","agent_id":"","reason":"Blocked by admin","agent_scope":"agent"}]'
# THE SHAPE THE DASHBOARD ACTUALLY SENDS. connect-ui's DiscoveryTab blocks with
# agent.id, and for Gemini Enterprise that is the Discovery Engine RESOURCE
# NAME the API returned -- the whole path, ending in the numeric id the URL
# carries as its last segment.
$GE_RESNAME = 'projects/p1/locations/global/collections/default_collection/engines/e1/assistants/default_assistant/agents/' + $GE_ID_A
$ROWS_GEMENT_RESNAME = '[{"platform":"gemini_enterprise","agent_name":"Deal Desk Agent","agent_id":"' + $GE_RESNAME + '","reason":"Blocked by admin","agent_scope":"agent"}]'
# A resource name for a DIFFERENT agent, same engine and same assistant. The
# tail compare must not confuse the two.
$ROWS_GEMENT_RESNAME_B = '[{"platform":"gemini_enterprise","agent_name":"Other Agent","agent_id":"projects/p1/locations/global/collections/default_collection/engines/e1/assistants/default_assistant/agents/' + $GE_ID_B + '","reason":"Blocked by admin","agent_scope":"agent"}]'
# A row whose id merely ENDS WITH the digits, without the /agents/ separator --
# the case a substring test would wrongly accept.
$ROWS_GEMENT_SUFFIXONLY = '[{"platform":"gemini_enterprise","agent_name":"Not An Agent","agent_id":"projects/p1/somethingelse-' + $GE_ID_A + '","reason":"Blocked by admin","agent_scope":"agent"}]'

function GeTick([string]$urlAgentId, [int]$outcome) {
  ResetState
  # The URL read runs BEFORE the element read in UpdateForeground, and it is
  # what publishes the id -- so it is set before the tick, and again after,
  # because ApplyForegroundTick is where the latch consults it.
  SetF '_fgWebUrlAgentId' $urlAgentId
  Call 'ApplyForegroundTick' @($CHROME_PID, 'chrome', $false, $null, '', $false, $OUT_UNREADABLE, '',
                               $WEB_SURFACE, 'vertexaisearch.cloud.google.com', $true, '7.4242.4.9.11.5150',
                               $true, $outcome, $urlAgentId) | Out-Null
  SetF '_fgWebUrlAgentId' $urlAgentId
  # UpdateForeground publishes this tick's agent read; the harness substitutes
  # that read exactly as it substitutes the URL and the focused element, and
  # nothing that INTERPRETS it is substituted -- WebComposerIdentity produced
  # the pair being published here, and CheckFgBlocked consumes it for real.
  SetF '_fgWebAgentOutcome' $outcome
  SetF '_fgWebAgentName' $urlAgentId
  Call 'CheckFgBlocked' | Out-Null
  return [ordered]@{
    blocked = [bool](GetF '_fgIsBlocked')
    scope   = [string](GetF '_blockScope')
    reason  = [string](GetF '_blockedReason')
    agentId = [string](GetF '_blockedAgentId')
    enter   = [bool](Call 'EnterBlockActive' @($false, $false, $false, $false))
  }
}

function GeProbe() {
  $WEB_ID_NAMED   = [int](GetF 'WEB_ID_NAMED')
  $WEB_ID_GENERIC = [int](GetF 'WEB_ID_GENERIC')
  $WEB_ID_NOTCOMP = [int](GetF 'WEB_ID_NOT_COMPOSER')

  LoadWeb ('[' + $WS_CLAUDE_ON + ',' + $WS_GEMENT_ON + ']')
  $web = Call 'MatchWebSurface' @('vertexaisearch.cloud.google.com')

  # ---- 1. The URL -> ID extractor, on the two MEASURED urls ---------------
  # What comes back must be the capture group and NOTHING else: no host, no
  # /home/cid/<customerId>, no session segment, no query string.
  $idA = [string](Call 'AgentIdFromBrowserUrl' @($GE_URL_A, $web.AgentUrlPattern))
  $idB = [string](Call 'AgentIdFromBrowserUrl' @($GE_URL_B, $web.AgentUrlPattern))
  # The same host with no agent in the path -- the surface's home page.
  $idNone = [string](Call 'AgentIdFromBrowserUrl' @('vertexaisearch.cloud.google.com/home/cid/C01abc234', $web.AgentUrlPattern))
  # A surface with no pattern (every other entry) extracts nothing, ever.
  $idNoPattern = [string](Call 'AgentIdFromBrowserUrl' @($GE_URL_A, ''))

  # ---- 2. Composer identity, through the REAL shared function -------------
  # name='Search' is the MEASURED composer name and it is identical for every
  # agent, so everything the identity answers here comes from the URL id.
  # Invoked through reflection directly because the agent name is an out param.
  $m = $T.GetMethod('WebComposerIdentity', $FLAGS)
  SetF '_fgWebUrlAgentId' $GE_ID_A
  $argsNamed = [object[]]@($web, 'Search', 'agent-search-prosemirror-editor', '')
  $idNamed = [int]$m.Invoke($null, $argsNamed)
  $namedAgent = [string]$argsNamed[3]
  # THE ELEMENT STILL HAS TO BE THE COMPOSER. A wrong AutomationId is refused
  # even though the URL names an agent: "never accept an unidentified element"
  # is not weakened by the identity being available elsewhere.
  $argsWrong = [object[]]@($web, 'Search', 'some-other-input', '')
  $idWrongAid = [int]$m.Invoke($null, $argsWrong)
  # No agent in the URL -> GENERIC (a composer we are sure of, on a page that
  # named no agent), never NAMED and therefore never an agent block.
  SetF '_fgWebUrlAgentId' ''
  $argsNone = [object[]]@($web, 'Search', 'agent-search-prosemirror-editor', '')
  $idNoAgent = [int]$m.Invoke($null, $argsNone)
  $noAgentName = [string]$argsNone[3]

  # ---- 3. The BLOCK, end to end through the real CheckFgBlocked -----------
  LoadRows $ROWS_GEMENT_AGENT
  $blockedAgent = GeTick $GE_ID_A $WEB_ID_NAMED
  # THE WHOLE FEATURE: the OTHER agent, same tab, same host, same composer.
  $otherAgent   = GeTick $GE_ID_B $WEB_ID_NAMED
  # The surface's home page: no agent in the URL, so nothing to block.
  $noAgentRun   = GeTick '' $WEB_ID_GENERIC
  # A tick that could not identify the composer blocks nothing either.
  $notComposer  = GeTick $GE_ID_A $WEB_ID_NOTCOMP
  # A NAME-ONLY row cannot reach this surface: there is no display name to
  # match here, and an id is not derivable from one.
  LoadRows $ROWS_GEMENT_NAMEONLY
  $nameOnlyRow  = GeTick $GE_ID_A $WEB_ID_NAMED
  # THE FORM THE DASHBOARD SENDS: the whole Discovery Engine resource name,
  # whose last segment is the id in the URL. This must block, or the feature is
  # a no-op that looks armed.
  LoadRows $ROWS_GEMENT_RESNAME
  $resName      = GeTick $GE_ID_A $WEB_ID_NAMED
  # …and it must be the RIGHT agent: the same engine and assistant, a different
  # agent id, must not block.
  $resNameOther = GeTick $GE_ID_B $WEB_ID_NAMED
  LoadRows $ROWS_GEMENT_RESNAME_B
  $resNameB     = GeTick $GE_ID_A $WEB_ID_NAMED
  # A row that merely ENDS WITH the digits, with no /agents/ separator, is what
  # a substring test would wrongly accept.
  LoadRows $ROWS_GEMENT_SUFFIXONLY
  $suffixOnly   = GeTick $GE_ID_A $WEB_ID_NAMED

  Write-Output (([ordered]@{
    scenario      = 'gemini_enterprise'
    tick          = 0
    idA           = $idA
    idB           = $idB
    idNone        = $idNone
    idNoPattern   = $idNoPattern
    idNamed       = ($idNamed -eq $WEB_ID_NAMED)
    namedAgent    = $namedAgent
    wrongAid      = ($idWrongAid -eq $WEB_ID_NOTCOMP)
    noAgent       = ($idNoAgent -eq $WEB_ID_GENERIC)
    noAgentName   = $noAgentName
    blockedAgent  = $blockedAgent
    otherAgent    = $otherAgent
    noAgentBlock  = $noAgentRun
    notComposer   = $notComposer
    nameOnlyRow   = $nameOnlyRow
    resName       = $resName
    resNameOther  = $resNameOther
    resNameB      = $resNameB
    suffixOnly    = $suffixOnly
    # The ONE control-type mapper, now shared by the send button and the
    # composer -- a second copy is a second place for 'Group' to be missing.
    ctGroup       = ($null -ne (Call 'WebControlTypeCondition' @('Group')))
    ctEdit        = ($null -ne (Call 'WebControlTypeCondition' @('Edit')))
    ctJunk        = ($null -eq (Call 'WebControlTypeCondition' @('Documnet')))
    # The default is what keeps the four older surfaces byte-identical.
    ctGemEnt      = [string](Call 'WebComposerControlType' @('vertexaisearch.cloud.google.com'))
    ctClaude      = [string](Call 'WebComposerControlType' @('claude.ai'))
    ctUnknown     = [string](Call 'WebComposerControlType' @('example.com'))
  }) | ConvertTo-Json -Compress -Depth 5)

  SetF '_fgWebUrlAgentId' ''
  ResetState
}
GeProbe

# ---- AI-219 follow-up: THE COMPOSER IS TWO ELEMENTS -------------------------
#
# The first build failed its live test: the element carrying the distinctive
# AutomationId is NOT keyboard-focusable, and the focusable one carries no
# AutomationId, so nothing could ever satisfy both halves of the composer test
# and Enter was never swallowed.
#
# Driven in two parts, because the rule has two halves and they fail
# differently:
#   1. WebComposerChildRole -- PURE, driven with the MEASURED class strings.
#   2. WebComposerAnchorAid / WebComposerIdentityAid -- the UIA half, driven
#      against a REAL parent/child element pair with a real AutomationId on the
#      parent and a real ClassName on the child. Nothing is mocked: the harness
#      builds a window, and the enforcer walks it.
function GeChildProbe() {
  $WEB_CHILD_NA        = [int](GetF 'WEB_CHILD_NOT_APPLICABLE')
  $WEB_CHILD_CANDIDATE = [int](GetF 'WEB_CHILD_CANDIDATE')
  $WEB_CHILD_REFUSED   = [int](GetF 'WEB_CHILD_REFUSED')
  $WEB_ID_NAMED        = [int](GetF 'WEB_ID_NAMED')
  $WEB_ID_NOTCOMP      = [int](GetF 'WEB_ID_NOT_COMPOSER')

  LoadWeb ('[' + $WS_CLAUDE_ON + ',' + $WS_GEMENT_ON + ']')
  $ge = Call 'MatchWebSurface' @('vertexaisearch.cloud.google.com')
  $claude = Call 'MatchWebSurface' @('claude.ai')

  # ---- 1. the PURE class rule, on the measured strings -------------------
  # The focusable child, measured exactly.
  $roleChild  = [int](Call 'WebComposerChildRole' @($ge, 'ProseMirror'))
  # The IDENTIFIED PARENT, measured with its trailing spaces. It must be
  # REFUSED: it is the element that cannot be typed into, and accepting it is
  # the bug that shipped.
  $roleParent = [int](Call 'WebComposerChildRole' @($ge, 'prosemirror-editor   '))
  # claude.ai's composer class. THE WHOLE REASON BOTH HALVES ARE REQUIRED:
  # 'ProseMirror' is the most common rich-text editor class on the web, so the
  # class alone identifies nothing.
  $roleClaudeCls = [int](Call 'WebComposerChildRole' @($ge, 'tiptap ProseMirror'))
  # The spelling the enforcer ACTUALLY sees: ProseMirror appends its focus
  # class, and this path only ever runs on the focused element. Measured live
  # 2026-09-22 from inside the enforcer. A whole-string compare refused this,
  # which is why the first build shipped and blocked nothing.
  $roleFocused = [int](Call 'WebComposerChildRole' @($ge, 'ProseMirror ProseMirror-focused'))
  # A PREFIX must never satisfy the rule -- tokens are compared whole.
  $rolePrefixOnly = [int](Call 'WebComposerChildRole' @($ge, 'ProseMirror-focused'))
  $roleEmpty  = [int](Call 'WebComposerChildRole' @($ge, ''))
  # A surface that declares NO descent is not applicable for ANY class -- this
  # is the line every pre-AI-219 surface takes.
  $roleClaudeSurface = [int](Call 'WebComposerChildRole' @($claude, 'ProseMirror'))
  $roleClaudeOwn     = [int](Call 'WebComposerChildRole' @($claude, 'tiptap ProseMirror'))

  # ---- 2. the UIA half, against a REAL parent/child pair -----------------
  $probeOk = $false
  $anchorHit = ''; $anchorWrongParent = ''; $anchorWrongClass = ''; $passthrough = ''
  $childIdentity = -1; $wrongParentIdentity = -1
  $form = $null
  try {
    Add-Type -AssemblyName System.Windows.Forms -ErrorAction Stop
    $form = New-Object System.Windows.Forms.Form
    $form.Text = 'cfai-anchor-probe'
    $form.Width = 320; $form.Height = 160; $form.ShowInTaskbar = $false
    # The ANCHOR: a container whose UIA AutomationId is its control Name.
    $panel = New-Object System.Windows.Forms.Panel
    $panel.Name = 'agent-search-prosemirror-editor'
    $panel.SetBounds(10, 10, 280, 80)
    # The CHILD: focusable, and with no AutomationId of its own.
    $kid = New-Object System.Windows.Forms.Button
    $kid.Text = ''
    $kid.SetBounds(5, 5, 200, 40)
    $panel.Controls.Add($kid)
    $form.Controls.Add($panel)
    $form.Show()
    [System.Windows.Forms.Application]::DoEvents()
    $kidEl = [System.Windows.Automation.AutomationElement]::FromHandle($kid.Handle)
    $panelEl = [System.Windows.Automation.AutomationElement]::FromHandle($panel.Handle)
    $kidClass = '' + $kidEl.Current.ClassName
    # WinForms reports a control's AutomationId as its HWND, not its designer
    # Name, so the ANCHOR VALUE is read back off the live element rather than
    # being chosen here. What is under test is the ancestor walk and the
    # ordinal compare, not the value itself.
    $panelAid = '' + $panelEl.Current.AutomationId
    if ($kidClass.Length -gt 0 -and $panelAid.Length -gt 0) {
      $probeOk = $true
      # A surface whose declared child class is what this real child actually
      # reports, anchored on what the real parent actually reports.
      $wsHit = '{"id":"probe_hit","host":"probe-hit.example","product":"P","vendor":"V","platforms":["gemini_enterprise"],"newlineKeys":"shift_enter","postSendVerifyMs":1500,"sendButtonControlType":"","sendButtonName":"","composerName":"","composerControlType":"Button","composerNamePrefixes":[],"composerAutomationId":"' + $panelAid + '","composerFocusableChildClassName":"' + $kidClass + '","genericNames":[],"agentReadMode":"url_path","agentReadUrlPattern":"/r/agent/([0-9]+)","agentReadEnforce":true,"agentReadVerified":true,"enforce":true,"verified":true}'
      # THE REGRESSION THE COORDINATOR ASKED FOR: same child, same class, but
      # the catalog anchors on a DIFFERENT AutomationId. The parent walk finds
      # nothing that matches, so the element is refused -- matching the child
      # class alone must never be enough.
      $wsWrong = $wsHit.Replace('"composerAutomationId":"' + $panelAid + '"', '"composerAutomationId":"some-other-editor"').Replace('"id":"probe_hit"', '"id":"probe_wrong"').Replace('probe-hit.example', 'probe-wrong.example')
      # A surface that declares a descent whose class does NOT match this child.
      $wsWrongCls = $wsHit.Replace('"composerFocusableChildClassName":"' + $kidClass + '"', '"composerFocusableChildClassName":"ProseMirror"').Replace('"id":"probe_hit"', '"id":"probe_cls"').Replace('probe-hit.example', 'probe-cls.example')
      LoadWeb ('[' + $WS_CLAUDE_ON + ',' + $WS_GEMENT_ON + ',' + $wsHit + ',' + $wsWrong + ',' + $wsWrongCls + ']')
      $sHit = Call 'MatchWebSurface' @('probe-hit.example')
      $sWrong = Call 'MatchWebSurface' @('probe-wrong.example')
      $sCls = Call 'MatchWebSurface' @('probe-cls.example')

      $anchorHit         = [string](Call 'WebComposerIdentityAid' @($sHit, $kidEl, '', $kidClass))
      $anchorWrongParent = [string](Call 'WebComposerIdentityAid' @($sWrong, $kidEl, '', $kidClass))
      $anchorWrongClass  = [string](Call 'WebComposerIdentityAid' @($sCls, $kidEl, '', $kidClass))
      # A surface with NO descent gets its element's OWN id back, untouched --
      # the line every pre-AI-219 surface takes.
      $passthrough       = [string](Call 'WebComposerIdentityAid' @($claude, $kidEl, 'its-own-id', $kidClass))

      # END TO END through the real identity function, with the child's
      # MEASURED Name (empty) -- which is what the old code refused outright.
      SetF '_fgWebUrlAgentId' $GE_ID_A
      $m = $T.GetMethod('WebComposerIdentity', $FLAGS)
      $a1 = [object[]]@($sHit, '', $anchorHit, '')
      $childIdentity = [int]$m.Invoke($null, $a1)
      $a2 = [object[]]@($sWrong, '', $anchorWrongParent, '')
      $wrongParentIdentity = [int]$m.Invoke($null, $a2)
      SetF '_fgWebUrlAgentId' ''
    }
  } catch { $probeOk = $false }
  try { if ($null -ne $form) { $form.Close(); $form.Dispose() } } catch {}

  Write-Output (([ordered]@{
    scenario           = 'gemini_enterprise_child'
    tick               = 0
    roleChild          = ($roleChild -eq $WEB_CHILD_CANDIDATE)
    roleParent         = ($roleParent -eq $WEB_CHILD_REFUSED)
    roleClaudeCls      = ($roleClaudeCls -eq $WEB_CHILD_CANDIDATE)
    roleFocused        = ($roleFocused -eq $WEB_CHILD_CANDIDATE)
    rolePrefixOnly     = ($rolePrefixOnly -eq $WEB_CHILD_REFUSED)
    roleEmpty          = ($roleEmpty -eq $WEB_CHILD_REFUSED)
    roleClaudeSurface  = ($roleClaudeSurface -eq $WEB_CHILD_NA)
    roleClaudeOwn      = ($roleClaudeOwn -eq $WEB_CHILD_NA)
    probeOk            = $probeOk
    anchorHit          = $anchorHit
    anchorWrongParent  = $anchorWrongParent
    anchorWrongClass   = $anchorWrongClass
    passthrough        = $passthrough
    childIdentityNamed = ($childIdentity -eq $WEB_ID_NAMED)
    wrongParentRefused = ($wrongParentIdentity -eq $WEB_ID_NOTCOMP)
  }) | ConvertTo-Json -Compress)

  LoadWeb ('[' + $WS_CLAUDE_ON + ',' + $WS_GEMENT_ON + ']')
  ResetState
}
GeChildProbe

# The probe window is closed LAST, after every scenario that needs a real UIA
# element -- closing it earlier left the click-race scenarios reading a disposed
# button and silently observing "no rect" for the wrong reason.
try { if ($null -ne $script:sendForm) { $script:sendForm.Close(); $script:sendForm.Dispose() } } catch {}

# Leave the catalog exactly as it SHIPS, so nothing after this point could
# observe a fixture-only payload.
LoadWeb $WEB_SHIPPED
if ($script:tmpFile) { Remove-Item -LiteralPath $script:tmpFile -Force -ErrorAction SilentlyContinue }

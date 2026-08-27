# Behavioural harness for enforcer-win.ps1's IDE-panel platform-block path.
#
# NOTHING HERE INSTALLS A KEYBOARD HOOK. [CfaiEnforcer]::Start() is never
# called, so no hook, no mouse hook, no threads, no message pump. The C# source
# is lifted out of the .ps1 and compiled on its own, then the poll-thread state
# machine (ApplyForegroundTick / CheckFgBlocked) and the Enter predicate
# (EnterBlockActive) are driven directly by reflection.
#
# The ONE thing substituted is the AutomationElement.FocusedElement lookup. Its
# result is built by feeding MEASURED UIA property values — captured from a real
# VS Code window with Claude Code and GitHub Copilot Chat both live (see the
# FOCUS_* constants below) — through the REAL MatchPanelSignature. Everything
# that interprets a read is production code.
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
# Membership test against a static HashSet field. NOT GetF + .Contains(): a
# collection RETURNED from a PowerShell function is enumerated, so an empty set
# comes back as $null and a set of one comes back as a bare string. Keeping the
# set inside this function is what stops the harness from silently testing the
# wrong thing.
function HasProc([string]$field, [string]$name) {
  $f = $T.GetField($field, $FLAGS)
  if (-not $f) { throw "no field $field" }
  $set = $f.GetValue($null)
  if ($null -eq $set) { return $false }
  return [bool]$set.Contains($name)
}
function Call([string]$n, [object[]]$a = @()) {
  $m = $T.GetMethod($n, $FLAGS)
  if (-not $m) { throw "no method $n" }
  try { return $m.Invoke($null, $a) } catch { throw $_.Exception.InnerException }
}

# ── real catalog payloads (byte-identical to what enforcer.js ships) ─────────
$IDE_JSON    = '[{"name":"code","panelFallback":false},{"name":"cursor","panelFallback":false}]'
$PANELS_JSON = '[{"id":"claude_code","procs":["Code","Cursor"],"controlType":"Edit","nameEquals":"Message input","namePrefix":"","classEquals":"","classPrefix":"messageInput_","enforce":true},{"id":"vscode_chat","procs":["Code","Cursor"],"controlType":"Edit","nameEquals":"","namePrefix":"Chat Input","classEquals":"","classPrefix":"","enforce":false},{"id":"cursor_composer","procs":["Cursor"],"controlType":"Edit","nameEquals":"","namePrefix":"","classEquals":"aislash-editor-input","classPrefix":"","enforce":true}]'
# exactly synthesizePlatformBlocks([{ host: 'claude.ai', product: 'Claude', blocked: true }])
$ROWS_CLAUDE = '[{"platform":"ai_platform","process_name":"claude","agent_name":"Claude","agent_id":"","host":"claude.ai","reason":"Blocked by organization policy"},{"platform":"ai_platform","panel":"claude_code","agent_name":"Claude","agent_id":"","host":"claude.ai","reason":"Blocked by organization policy"}]'
# a detection-only panel with a row of its own — must still never block
$ROWS_VSCODE_CHAT = '[{"platform":"ai_platform","panel":"vscode_chat","agent_name":"GitHub Copilot","agent_id":"","host":"github.com","reason":"Blocked by organization policy"}]'
# exactly synthesizePlatformBlocks([{ host: 'cursor.com', product: 'Cursor', blocked: true }])
# — one PANEL row and no process_name row, because blocking the whole Cursor
# process off a browser-inventory toggle would be a catastrophic false positive.
$ROWS_CURSOR = '[{"platform":"ai_platform","panel":"cursor_composer","agent_name":"Cursor","agent_id":"","host":"cursor.com","reason":"Blocked by organization policy"}]'
$ROWS_EMPTY = '[]'

Call 'LoadIdeProcesses' @($IDE_JSON)
Call 'LoadAiPanels'     @($PANELS_JSON)

# ── AGENT SURFACES (agent_scope:'agent') ────────────────────────────────────
#
# Two payloads, and the difference between them is the point.
#
# $SURFACES_SHIPPED is byte-identical to what buildAgentSurfaceConfig() ships
# TODAY: m365_copilot, enforce:true, verified:true. It passed its live
# verification pass on 2026-08-27 against a real Microsoft 365 Copilot install
# with a real added agent, so the narrowing scenarios below are the SHIPPING
# behaviour, not a hypothetical.
#
# $SURFACES_WITH_UNVERIFIED adds a second, still-hypothetical entry for the
# STANDALONE Microsoft Copilot app with both flags false — the shape any future
# surface ships in before its own live pass. It exists to keep the safety GATE
# under test now that m365_copilot is no longer an example of one: an unverified
# surface must never narrow, so an agent-scoped row covering it still produces
# exactly the whole-app block it produced before this feature existed. Both
# entries are present in the same payload, so one tick sequence shows a verified
# surface narrowing and an unverified one not.
$SURFACES_SHIPPED = '[{"id":"m365_copilot","procs":["M365Copilot"],"controlType":"Edit","composerNamePrefixes":["Message "],"genericNames":["Copilot"],"enforce":true,"verified":true}]'
$SURFACES_WITH_UNVERIFIED = '[{"id":"m365_copilot","procs":["M365Copilot"],"controlType":"Edit","composerNamePrefixes":["Message "],"genericNames":["Copilot"],"enforce":true,"verified":true},{"id":"copilot_standalone","procs":["Copilot"],"controlType":"Edit","composerNamePrefixes":["Message "],"genericNames":["Copilot"],"enforce":false,"verified":false}]'

function LoadSurfaces([string]$json) { Call 'LoadAgentSurfaces' @($json) | Out-Null }

# Start() is never called, so _aiProcs (which it builds) is null. The chat-app
# branch of ApplyForegroundTick and CheckFgBlocked's PLATFORM_PROCS branch both
# key on it, so the harness supplies exactly the names enforcer.js would.
$aiProcSet = New-Object 'System.Collections.Generic.HashSet[string]' -ArgumentList @([System.StringComparer]::OrdinalIgnoreCase)
foreach ($p in @('M365Copilot', 'Copilot', 'ChatGPT', 'Claude', 'Gemini')) { $null = $aiProcSet.Add($p) }
SetF '_aiProcs' $aiProcSet

# The AgentReadOutcome enum, and the reflection handle for the real pure
# extractor. The ONE thing substituted for the agent path — exactly as for the
# panel path — is the AutomationElement.FocusedElement lookup: everything that
# interprets its result is production code.
$OUTCOME_T = $T.GetNestedType('AgentReadOutcome', $FLAGS)
if (-not $OUTCOME_T) { throw 'no nested AgentReadOutcome enum' }
$OUT_UNREADABLE = [Enum]::Parse($OUTCOME_T, 'Unreadable')
$M_EXTRACT = $T.GetMethod('ExtractAgentName', $FLAGS)
if (-not $M_EXTRACT) { throw 'no method ExtractAgentName' }

# ── MEASURED M365Copilot composer values ────────────────────────────────────
# Captured live 2026-08 by a read-only UIA probe of a real Microsoft 365 Copilot
# window. The WINDOW TITLE is useless here — it is the static "Microsoft 365
# Copilot" in every case — and is deliberately not used by any of this.
$M365_PID = [uint32]8104
# No specific agent open.
$FOCUS_M365_GENERIC = @('Edit', 'Message Copilot')
# "AI Learning Advisor" open — the agent an admin blocked.
$FOCUS_M365_ADVISOR = @('Edit', 'Message AI Learning Advisor')
# A second blocked agent, for the switch-between-two-blocked-agents case.
$FOCUS_M365_ANALYST = @('Edit', 'Message Finance Analyst')
# An agent nobody blocked.
$FOCUS_M365_HR = @('Edit', 'Message HR Helper')
# The transcript above the composer: a real element in the same window that is
# NOT a composer. Lands in NotComposer — no evidence either way.
$FOCUS_M365_TRANSCRIPT = @('Document', 'Chat message list')
# ChatGPT's composer. No AGENT_SURFACES entry covers ChatGPT at all, which is
# what the fail-closed scenario needs.
$CHATGPT_PID = [uint32]5150
$FOCUS_CHATGPT = @('Edit', 'Message ChatGPT')
# The STANDALONE Microsoft Copilot app — the hypothetical UNVERIFIED surface.
# PLATFORM_PROCS maps personal_agent to both Copilot builds, so the same
# agent-scoped row reaches this process too; the only difference is that its
# surface has not passed a live pass, so nothing may narrow there.
$COPILOT_PID = [uint32]6120
$FOCUS_COPILOT_BOT = @('Edit', 'Message Deal Desk Bot')
$FOCUS_COPILOT_GENERIC = @('Edit', 'Message Copilot')

# One agent-scoped row for "AI Learning Advisor" inside Microsoft 365 Copilot —
# the shape POST /api/lifecycle/block and registry.js's individual-agent path
# now write.
$ROWS_AGENT = '[{"platform":"personal_agent","agent_name":"AI Learning Advisor","agent_id":"agent-advisor","reason":"Blocked by admin","agent_scope":"agent"}]'
# Two blocked agents in the same app.
$ROWS_TWO_AGENTS = '[{"platform":"personal_agent","agent_name":"AI Learning Advisor","agent_id":"agent-advisor","reason":"Blocked by admin","agent_scope":"agent"},{"platform":"personal_agent","agent_name":"Finance Analyst","agent_id":"agent-analyst","reason":"Blocked by admin","agent_scope":"agent"}]'
# The SAME agent, platform-scoped (the pre-existing row shape, and what an
# absent agent_scope means). Must block the whole app, and must trigger NO
# focused-element read at all — the privacy gate.
$ROWS_AGENT_PLATFORM = '[{"platform":"personal_agent","agent_name":"AI Learning Advisor","agent_id":"agent-advisor","reason":"Blocked by admin"}]'
# An agent-scoped row against a process this catalog cannot read an agent name
# out of. Fail CLOSED: whole-app block, exactly as today.
$ROWS_AGENT_CHATGPT = '[{"platform":"openai_assistant","agent_name":"Research Assistant","agent_id":"agent-research","reason":"Blocked by admin","agent_scope":"agent"}]'
# An agent-scoped row whose foreground process resolves to an UNVERIFIED surface.
# The read succeeds and names the very agent the row names — and it must STILL be
# a whole-app block, because the surface has not passed a live pass.
$ROWS_AGENT_UNVERIFIED = '[{"platform":"personal_agent","agent_name":"Deal Desk Bot","agent_id":"agent-dealdesk","reason":"Blocked by admin","agent_scope":"agent"}]'

# ── MEASURED focused-element property values ────────────────────────────────
# Captured 2026-08-25 by a read-only UIA probe of a real VS Code window that had
# TWO live Claude Code composers, a GitHub Copilot Chat input, the code editor
# and an integrated terminal — all Edit controls in one window, all matched
# against the same signature table by the same global FocusedElement read.
$FOCUS_CLAUDE_COMPOSER = @('Edit', 'Message input', 'messageInput_cKsPxg')
$FOCUS_COPILOT_CHAT    = @('Edit', 'Chat Input (Agent), edit files in your workspace. Press Enter to send', 'native-edit-context')
$FOCUS_CODE_EDITOR     = @('Edit', 'The editor is not accessible at this time. To enable screen reader optimized mode', 'native-edit-context')
$FOCUS_TERMINAL        = @('Edit', 'Terminal 2, bash', 'xterm-helper-textarea')

$CODE_PID = [uint32]19616

# ── The Cursor window under test (a disposable instance on an empty folder) ──
# Probed read-only 2026-08-26. It contains exactly TWO Edit controls: Cursor's
# own AI composer and Cursor's Monaco code-editor input. There is no Copilot
# Chat / vscode_chat panel in it at all, so the neighbouring-PANEL fix cannot be
# what covers this window — the element that steals the global FocusedElement
# read here matches NO signature, which lands as a readable NON-match.
$CURSOR_PID = [uint32]27180
$FOCUS_CURSOR_COMPOSER = @('Edit', '', 'aislash-editor-input')
# The same composer carrying a second class. A web-hosted element's UIA
# ClassName is the DOM class ATTRIBUTE — the Monaco input right below proves the
# provider reports the whole list verbatim — so an exact whole-string compare
# stops matching a composer that is genuinely focused and genuinely stable.
$FOCUS_CURSOR_COMPOSER_MULTICLASS = @('Edit', '', 'aislash-editor-input aislash-editor-input-has-text')
$FOCUS_CURSOR_MONACO = @('Edit', 'The editor is not accessible at this time. To enable screen reader optimized mode', 'inputarea monaco-mouse-cursor-text')
# Cursor's agent-session history search box — same ControlType, same process,
# similar shape, and NOT a composer. Here to prove the class-token matching did
# not widen anything.
$FOCUS_CURSOR_AGENT_SEARCH = @('Edit', 'Search Agents…', 'agent-sidebar-search-input')

function LoadRows([string]$json) {
  $script:tmpFile = Join-Path ([System.IO.Path]::GetTempPath()) ("cfai-panel-harness-" + [guid]::NewGuid().ToString('N') + '.json')
  Set-Content -LiteralPath $script:tmpFile -Value $json -Encoding UTF8
  SetF '_blockedAgentFile' $script:tmpFile
  SetF '_lastBlockedCheck' ([long]0)
  Call 'UpdateBlockedAgents' | Out-Null
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
  SetF '_fgAgentOutcome' $OUT_UNREADABLE
  SetF '_fgAgentName' ''
  Call 'ClearPanelBlockLatch' | Out-Null
  SetF '_disarmedUntilTicks' ([long]0)
  SetF '_lastBlockFiredTicks' ([long]0)   # no cooldown may mask the result
  SetF '_blockTyped' $false
  SetF '_blockUia' $false
  SetF '_blockPaste' $false
  SetF '_attachHoldActive' $false
  SetF '_lastPasteTicks' ([long]0)
  # No click and no navigation key — the state a quiet wait before an Enter is
  # actually in. Scenarios that model the user moving the caret set it.
  SetF '_lastFocusMoveInputTicks' ([long]0)
}

# The user just clicked (or hit Tab/Escape/a chord) $msAgo milliseconds ago —
# i.e. keyboard focus COULD have moved. Written the way the hook threads write
# it: a timestamp, nothing else.
function FocusMoveInput([int]$msAgo = 0) {
  SetF '_lastFocusMoveInputTicks' ([long]([DateTime]::UtcNow.Ticks - [TimeSpan]::FromMilliseconds($msAgo).Ticks))
}

# One poll tick. $focus is a (controlType, name, className) triple, or $null for
# an UNREADABLE read (FocusedElement threw / was null / had no usable props).
function Tick([string]$scenario, [int]$n, $focus, [uint32]$fgPid = $CODE_PID, [string]$proc = 'Code') {
  $hit = $null
  $readable = $false
  if ($null -ne $focus) {
    $ct = $focus[0]; $nm = $focus[1]; $cls = $focus[2]
    # exactly ReadFocusedPanel's own `readable` rule
    $readable = ($ct.Trim().Length -gt 0) -and (($nm.Trim().Length -gt 0) -or ($cls.Trim().Length -gt 0))
    $hit = Call 'MatchPanelSignature' @($proc, $ct, $nm, $cls)
  }
  $rid = if ($null -ne $hit) { '42.9047508.4.9.49.164537' } else { '' }
  Call 'ApplyForegroundTick' @($fgPid, $proc, $true, $hit, $rid, $readable, $OUT_UNREADABLE, '') | Out-Null
  Call 'CheckFgBlocked' | Out-Null
  Report $scenario $n $hit $readable
}

# One poll tick with the foreground an AI CHAT app (not an IDE), driving the
# agent-scoped path. $focus is a (controlType, name) pair, or $null for an
# UNREADABLE read (FocusedElement threw / was null / had no usable properties).
#
# $elPid is the pid the focused ELEMENT belongs to; -1 means "the foreground
# process itself", the ordinary single-process case. Whatever it is, the decision
# about it is made by the REAL ElementPidBelongsToForeground — which is why a
# WebView2-style child pid can be modelled here at all, and why the check that
# rejects an unrelated process stays under test rather than being assumed away.
#
# The privacy gate is applied here exactly as UpdateForeground applies it — no
# agent-scoped row covering this process means no read happens at all — so the
# gate itself is under test, not assumed.
function AgentTick([string]$scenario, [int]$n, $focus, [uint32]$fgPid = $M365_PID, [string]$proc = 'M365Copilot', [int]$elPid = -1) {
  $outcome = $OUT_UNREADABLE
  $agentName = ''
  $gate = (HasProc '_aiProcs' $proc) -and (HasProc '_agentScopedProcs' $proc)
  $surface = Call 'MatchAgentSurface' @($proc)
  if ($gate -and $null -ne $surface -and $null -ne $focus) {
    $ownerPid = if ($elPid -lt 0) { [int]$fgPid } else { $elPid }
    # ReadFocusedAgentName's own pid rule, run for real: the element must belong
    # to the foreground process or to a DIRECT CHILD of it. Anything else is
    # Unreadable — no evidence, not "no agent open".
    $owned = [bool](Call 'ElementPidBelongsToForeground' @([int]$ownerPid, [uint32]$fgPid))
    $ct = $focus[0]; $nm = $focus[1]
    # ReadFocusedAgentName's own rule: no control type or no Name at all is a
    # READ FAILURE, never the authoritative "no agent open".
    if ($owned -and $ct.Trim().Length -gt 0 -and $nm.Trim().Length -gt 0) {
      $params = [object[]]@($surface, $ct, $nm, $null)
      $outcome = $M_EXTRACT.Invoke($null, $params)
      $agentName = [string]$params[3]
    }
  }
  Call 'ApplyForegroundTick' @($fgPid, $proc, $false, $null, '', $false, $outcome, $agentName) | Out-Null
  Call 'CheckFgBlocked' | Out-Null
  Report $scenario $n $null $false $outcome
}

function Report([string]$scenario, [int]$n, $hit, [bool]$readable, $agentOutcome = $null) {
  # The REAL Enter predicate, with no content signal armed — so a True here can
  # only be the platform block.
  $enterBlocked = Call 'EnterBlockActive' @($false, $false, $false, $false)
  $matchedId = if ($null -ne $hit) { $hit.GetType().GetField('Id').GetValue($hit) } else { '' }
  if ($null -eq $agentOutcome) { $agentOutcome = GetF '_fgAgentOutcome' }

  $obj = [ordered]@{
    scenario      = $scenario
    tick          = $n
    matched       = $matchedId
    readable      = $readable
    fgIsAi        = [bool](GetF '_fgIsAi')
    fgIsPanel     = [bool](GetF '_fgIsPanel')
    fgPanelId     = [string](GetF '_fgPanelId')
    fgIsBlocked   = [bool](GetF '_fgIsBlocked')
    # Renamed with the field it reads: _blockedByPanel became _blockedByElement
    # when the latch was generalised to cover agent-scoped blocks too.
    blockedByElement = [bool](GetF '_blockedByElement')
    blockScope    = [string](Call 'BlockScope')
    latchHeld     = [bool](Call 'PanelBlockLatchHeld')
    # The latch key is now NAMESPACED ("panel:<id>" / "agent:<id>"), so this
    # column reports the whole key rather than a bare panel id.
    latchKey      = [string](GetF '_elementBlockKey')
    agentOutcome  = [string]$agentOutcome
    blockedAgent  = [string](GetF '_blockedAgentName')
    focusMoved    = [bool](Call 'FocusCouldHaveMoved')
    enterBlocked  = [bool]$enterBlocked
    panelField    = [string](Call 'PlatformBlockPanelField')
  }
  Write-Output ($obj | ConvertTo-Json -Compress)
}

# Rewind a tick counter by N milliseconds, to age out a TTL without sleeping.
function Age([string]$field, [int]$ms) {
  $v = GetF $field
  if ($v -ne 0) { SetF $field ([long]($v - ([TimeSpan]::FromMilliseconds($ms).Ticks))) }
}

# ── A: baseline — the measured live condition, every read matching ───────────
LoadRows $ROWS_CLAUDE
ResetState
for ($i = 0; $i -lt 30; $i++) { Tick 'stable_composer' $i $FOCUS_CLAUDE_COMPOSER }

# ── B: THE REGRESSION — a neighbouring detection-only panel in the same window
# steals the odd focused-element read across a 4.5s window. 30 ticks at the
# real 150ms poll cadence; every third read lands on Copilot Chat.
LoadRows $ROWS_CLAUDE
ResetState
for ($i = 0; $i -lt 30; $i++) {
  $focus = if (($i % 3) -eq 2) { $FOCUS_COPILOT_CHAT } else { $FOCUS_CLAUDE_COMPOSER }
  Tick 'neighbour_panel_steals_read' $i $focus
}

# ── B2: the same, but the neighbouring panel wins EVERY read for the whole
# window — the deterministic form, which no grace period covered at all.
LoadRows $ROWS_CLAUDE
ResetState
Tick 'neighbour_panel_wins_all' 0 $FOCUS_CLAUDE_COMPOSER
for ($i = 1; $i -lt 30; $i++) { Tick 'neighbour_panel_wins_all' $i $FOCUS_COPILOT_CHAT }

# ── C: unreadable reads (the originally-modelled case) — latch must hold ─────
LoadRows $ROWS_CLAUDE
ResetState
Tick 'unreadable_reads' 0 $FOCUS_CLAUDE_COMPOSER
for ($i = 1; $i -lt 30; $i++) {
  # Age the sticky timer past FG_STICKY_TTL so the window really does expire.
  if ($i -eq 25) { Age '_fgLeftAiTicks' 4000 }
  Tick 'unreadable_reads' $i $null
}

# ── C2: …but the latch is BOUNDED. Age it past PANEL_BLOCK_LATCH_TTL. ───────
Age '_panelBlockLatchTicks' 11000
Tick 'latch_expires' 0 $null

# ── D: NO COLLATERAL — the caret really is in the code editor. Enter must work.
# The user got there by CLICKING, which is what makes the readable non-match
# authoritative — see _lastFocusMoveInputTicks. Without an input event a "you
# left the panel" read is a bad read, which is scenario J below.
LoadRows $ROWS_CLAUDE
ResetState
Tick 'moved_to_code_editor' 0 $FOCUS_CLAUDE_COMPOSER
FocusMoveInput 10
Tick 'moved_to_code_editor' 1 $FOCUS_CODE_EDITOR
Age '_fgLeftAiTicks' 4000     # let the pre-existing 3s sticky window lapse
Tick 'moved_to_code_editor' 2 $FOCUS_CODE_EDITOR
Tick 'moved_to_code_editor' 3 $FOCUS_CODE_EDITOR

# ── D2: same for the integrated terminal ────────────────────────────────────
LoadRows $ROWS_CLAUDE
ResetState
Tick 'moved_to_terminal' 0 $FOCUS_CLAUDE_COMPOSER
FocusMoveInput 10
Tick 'moved_to_terminal' 1 $FOCUS_TERMINAL
Age '_fgLeftAiTicks' 4000
Tick 'moved_to_terminal' 2 $FOCUS_TERMINAL

# ── E: a detection-only panel must still never CAUSE a block ────────────────
LoadRows $ROWS_VSCODE_CHAT
ResetState
for ($i = 0; $i -lt 5; $i++) { Tick 'detection_only_never_blocks' $i $FOCUS_COPILOT_CHAT }

# ── F: a genuine app switch retires the latch at once. The pre-existing 3s
# sticky window still holds the block over tick 1 — that is by design and
# unchanged — so tick 2 ages it out to show the block really does end.
LoadRows $ROWS_CLAUDE
ResetState
Tick 'app_switch' 0 $FOCUS_CLAUDE_COMPOSER
Tick 'app_switch' 1 $null ([uint32]4242) 'Code'
Age '_fgLeftAiTicks' 4000
Tick 'app_switch' 2 $null ([uint32]4242) 'Code'

# ── G: an admin lifting the block must take effect at once, not after the TTL
LoadRows $ROWS_CLAUDE
ResetState
Tick 'admin_unblocks' 0 $FOCUS_CLAUDE_COMPOSER
LoadRows $ROWS_EMPTY
Tick 'admin_unblocks' 1 $FOCUS_CLAUDE_COMPOSER

# ── G2: …and so must dropping just the claude_code row while others remain ──
LoadRows $ROWS_CLAUDE
ResetState
Tick 'admin_unblocks_one_row' 0 $FOCUS_CLAUDE_COMPOSER
LoadRows $ROWS_VSCODE_CHAT
Tick 'admin_unblocks_one_row' 1 $FOCUS_CLAUDE_COMPOSER

# ── H: the panic hotkey still releases everything ──────────────────────────
LoadRows $ROWS_CLAUDE
ResetState
Tick 'panic_hotkey' 0 $FOCUS_CLAUDE_COMPOSER
SetF '_disarmedUntilTicks' ([long]([DateTime]::UtcNow.Ticks + [TimeSpan]::FromSeconds(600).Ticks))
Tick 'panic_hotkey' 1 $FOCUS_CLAUDE_COMPOSER

# ═══ Cursor's own composer (cursor_composer) ════════════════════════════════
# A DIFFERENT panel entry from claude_code, in a window with no second AI panel
# in it, so none of the scenarios above cover it. Live: 2 of 3 fully-verified
# rounds leaked (composer emptied on Enter), 1 blocked.
#
# The round, replayed: Ctrl+A, Delete, type a marker phrase, then wait 4.5s
# touching NOTHING, then Enter. 30 ticks at the real 150ms cadence is that wait.

# ── I: baseline — every read matches ────────────────────────────────────────
LoadRows $ROWS_CURSOR
ResetState
for ($i = 0; $i -lt 30; $i++) { Tick 'cursor_stable_composer' $i $FOCUS_CURSOR_COMPOSER $CURSOR_PID 'Cursor' }

# ── J: THE LEAK, intermittent form — Cursor's own Monaco editor input steals
# every third global FocusedElement read. It matches NO signature, so it arrives
# as a readable NON-match, which the panel-id scoping in CheckFgBlocked cannot
# see (there is no second panel) and which ApplyForegroundTick used to treat as
# the authoritative "the user left the panel". Nobody touched anything.
LoadRows $ROWS_CURSOR
ResetState
for ($i = 0; $i -lt 30; $i++) {
  $focus = if (($i % 3) -eq 2) { $FOCUS_CURSOR_MONACO } else { $FOCUS_CURSOR_COMPOSER }
  Tick 'cursor_monaco_steals_read' $i $focus $CURSOR_PID 'Cursor'
}

# ── J2: the deterministic form — Monaco wins EVERY read for the whole 4.5s.
# This is the shape that actually leaked live: one stolen tick retired the latch,
# and 3s later the sticky window lapsed with nothing left holding the block. The
# sticky timer is aged out mid-window so the test really does cover past it.
LoadRows $ROWS_CURSOR
ResetState
Tick 'cursor_monaco_wins_all' 0 $FOCUS_CURSOR_COMPOSER $CURSOR_PID 'Cursor'
for ($i = 1; $i -lt 30; $i++) {
  if ($i -eq 20) { Age '_fgLeftAiTicks' 4000 }
  Tick 'cursor_monaco_wins_all' $i $FOCUS_CURSOR_MONACO $CURSOR_PID 'Cursor'
}

# ── K: the composer carrying a second CSS class must still MATCH. Its ClassName
# is the only signal it has (empty Name, no prefix rule), and the UIA ClassName
# of a web-hosted element is the DOM class attribute — see the Monaco input's
# own two-class value above.
LoadRows $ROWS_CURSOR
ResetState
for ($i = 0; $i -lt 30; $i++) { Tick 'cursor_composer_multiclass' $i $FOCUS_CURSOR_COMPOSER_MULTICLASS $CURSOR_PID 'Cursor' }

# ── L: NO COLLATERAL — the user really clicks into Cursor's code editor. The
# click is what makes the readable non-match authoritative, so the latch retires
# on that very tick and Enter works again once the pre-existing 3s sticky window
# lapses. Behaviour here is exactly what it was before this fix.
LoadRows $ROWS_CURSOR
ResetState
Tick 'cursor_click_into_editor' 0 $FOCUS_CURSOR_COMPOSER $CURSOR_PID 'Cursor'
FocusMoveInput 10
Tick 'cursor_click_into_editor' 1 $FOCUS_CURSOR_MONACO $CURSOR_PID 'Cursor'
Age '_fgLeftAiTicks' 4000
Tick 'cursor_click_into_editor' 2 $FOCUS_CURSOR_MONACO $CURSOR_PID 'Cursor'

# ── L2: …and the input evidence is not open-ended. A click from long before the
# block was even armed must not license retiring it.
LoadRows $ROWS_CURSOR
ResetState
FocusMoveInput 30000
Tick 'cursor_stale_input' 0 $FOCUS_CURSOR_COMPOSER $CURSOR_PID 'Cursor'
Tick 'cursor_stale_input' 1 $FOCUS_CURSOR_MONACO $CURSOR_PID 'Cursor'

# ── L3: the latch is still BOUNDED even with no input at all — a Cursor whose
# reads never recover must not leave Enter dead in the editor forever.
Age '_panelBlockLatchTicks' 11000
Age '_fgLeftAiTicks' 4000
Tick 'cursor_latch_expires' 0 $FOCUS_CURSOR_MONACO $CURSOR_PID 'Cursor'

# ── M: the agent-history SEARCH box is not a composer and must never arm a
# block — the guard that the class-token matching widened nothing.
LoadRows $ROWS_CURSOR
ResetState
for ($i = 0; $i -lt 3; $i++) { Tick 'cursor_search_box' $i $FOCUS_CURSOR_AGENT_SEARCH $CURSOR_PID 'Cursor' }

# ═══ Agent-scoped blocks inside Microsoft 365 Copilot ═══════════════════════
#
# A blocked_agents row names ONE agent; the enforcer matched it against the whole
# PROCESS set its platform maps to, so blocking "AI Learning Advisor" disabled
# the entire M365Copilot app — generic Copilot chat and every other agent
# included. agent_scope:'agent' narrows that, using the composer's UIA Name.
#
# m365_copilot is LIVE-VERIFIED as of 2026-08-27 and ships enforcing, so the
# narrowing group below is the SHIPPING behaviour. The safety GATE it used to be
# the example of is still under test, using the hypothetical unverified
# copilot_standalone entry instead.

# ── N: THE SAFETY GATE — an UNVERIFIED surface still whole-app blocks ────────
# The rule every future entry ships under. The read here succeeds and names the
# very agent the row names, and it must still produce exactly the block it
# produced before this feature existed: the whole app, app scope, no element
# attribution. The catalog loaded also holds the VERIFIED m365_copilot entry, so
# this cannot pass merely because nothing is armed anywhere.
LoadSurfaces $SURFACES_WITH_UNVERIFIED
LoadRows $ROWS_AGENT_UNVERIFIED
ResetState
AgentTick 'agent_unverified_surface_whole_app' 0 $FOCUS_COPILOT_BOT $COPILOT_PID 'Copilot'
AgentTick 'agent_unverified_surface_whole_app' 1 $FOCUS_COPILOT_GENERIC $COPILOT_PID 'Copilot'
AgentTick 'agent_unverified_surface_whole_app' 2 $null $COPILOT_PID 'Copilot'
AgentTick 'agent_unverified_surface_whole_app' 3 $FOCUS_M365_HR $COPILOT_PID 'Copilot'

# ── O: PRIVACY GATE — a platform-scoped row triggers no agent read at all ────
# Absent agent_scope is the pre-existing row shape. Nothing may read another
# app's accessibility tree to learn which agent is open when no agent-scoped
# policy exists for it.
LoadSurfaces $SURFACES_SHIPPED
LoadRows $ROWS_AGENT_PLATFORM
ResetState
for ($i = 0; $i -lt 3; $i++) { AgentTick 'agent_no_policy_no_read' $i $FOCUS_M365_ADVISOR }

# ── P: FAIL CLOSED — an agent-scoped row on a process with no surface ────────
# Nothing here can tell which agent is open inside ChatGPT, and "cannot tell"
# must never mean "block nothing".
LoadSurfaces $SURFACES_SHIPPED
LoadRows $ROWS_AGENT_CHATGPT
ResetState
for ($i = 0; $i -lt 3; $i++) { AgentTick 'agent_no_surface_whole_app' $i $FOCUS_CHATGPT $CHATGPT_PID 'ChatGPT' }

# ═══ The narrowing itself — live-verified, shipping behaviour ════════════════

# ── Q: baseline — the blocked agent is open, every read matching ─────────────
LoadSurfaces $SURFACES_SHIPPED
LoadRows $ROWS_AGENT
ResetState
for ($i = 0; $i -lt 30; $i++) { AgentTick 'agent_stable_named' $i $FOCUS_M365_ADVISOR }

# ── R: every third read unreadable — the latch must hold straight through ────
LoadSurfaces $SURFACES_SHIPPED
LoadRows $ROWS_AGENT
ResetState
for ($i = 0; $i -lt 30; $i++) {
  $focus = if (($i % 3) -eq 2) { $null } else { $FOCUS_M365_ADVISOR }
  AgentTick 'agent_intermittent_unreadable' $i $focus
}

# ── S: EVERY read unreadable — held by the latch, and BOUNDED by its TTL ─────
LoadSurfaces $SURFACES_SHIPPED
LoadRows $ROWS_AGENT
ResetState
AgentTick 'agent_all_unreadable' 0 $FOCUS_M365_ADVISOR
for ($i = 1; $i -lt 30; $i++) { AgentTick 'agent_all_unreadable' $i $null }
Age '_panelBlockLatchTicks' 11000
AgentTick 'agent_latch_expires' 0 $null

# ── T: NotComposer holds the latch exactly as Unreadable does ───────────────
# Focus moved to the transcript above the composer: readable, in the right
# process, and says nothing about which agent is open.
LoadSurfaces $SURFACES_SHIPPED
LoadRows $ROWS_AGENT
ResetState
AgentTick 'agent_not_composer' 0 $FOCUS_M365_ADVISOR
for ($i = 1; $i -lt 10; $i++) { AgentTick 'agent_not_composer' $i $FOCUS_M365_TRANSCRIPT }

# ── U: switching to generic Copilot chat clears in ONE tick ─────────────────
# AUTHORITATIVE, and with no grace period: the read came from the composer
# itself, correctly pid-attributed. This is the case the old whole-process match
# got wrong in the other direction — it blocked generic chat too.
LoadSurfaces $SURFACES_SHIPPED
LoadRows $ROWS_AGENT
ResetState
AgentTick 'agent_switch_to_generic' 0 $FOCUS_M365_ADVISOR
AgentTick 'agent_switch_to_generic' 1 $FOCUS_M365_GENERIC
AgentTick 'agent_switch_to_generic' 2 $FOCUS_M365_GENERIC

# ── V: switching to a DIFFERENT agent that is ALSO blocked re-arms under it ──
LoadSurfaces $SURFACES_SHIPPED
LoadRows $ROWS_TWO_AGENTS
ResetState
AgentTick 'agent_switch_to_other_blocked' 0 $FOCUS_M365_ADVISOR
AgentTick 'agent_switch_to_other_blocked' 1 $FOCUS_M365_ANALYST
AgentTick 'agent_switch_to_other_blocked' 2 $FOCUS_M365_ANALYST

# ── W: switching to an agent nobody blocked clears in one tick ──────────────
LoadSurfaces $SURFACES_SHIPPED
LoadRows $ROWS_AGENT
ResetState
AgentTick 'agent_switch_to_unblocked' 0 $FOCUS_M365_ADVISOR
AgentTick 'agent_switch_to_unblocked' 1 $FOCUS_M365_HR
AgentTick 'agent_switch_to_unblocked' 2 $FOCUS_M365_HR

# ── X: an admin lifting the block takes effect at once ──────────────────────
LoadSurfaces $SURFACES_SHIPPED
LoadRows $ROWS_AGENT
ResetState
AgentTick 'agent_admin_unblocks' 0 $FOCUS_M365_ADVISOR
LoadRows $ROWS_EMPTY
AgentTick 'agent_admin_unblocks' 1 $FOCUS_M365_ADVISOR

# ── Y: the panic hotkey still overrides an agent-scoped block ───────────────
LoadSurfaces $SURFACES_SHIPPED
LoadRows $ROWS_AGENT
ResetState
AgentTick 'agent_panic_hotkey' 0 $FOCUS_M365_ADVISOR
SetF '_disarmedUntilTicks' ([long]([DateTime]::UtcNow.Ticks + [TimeSpan]::FromSeconds(600).Ticks))
AgentTick 'agent_panic_hotkey' 1 $FOCUS_M365_ADVISOR

# ── Z: a real app switch retires the agent latch at once ────────────────────
LoadSurfaces $SURFACES_SHIPPED
LoadRows $ROWS_AGENT
ResetState
AgentTick 'agent_app_switch' 0 $FOCUS_M365_ADVISOR
AgentTick 'agent_app_switch' 1 $null ([uint32]4242) 'M365Copilot'

# ── AA: a Generic read from a COLD start never blocks at all ─────────────────
# Live: with "AI Learning Advisor" blocked, generic Copilot chat kept sending
# normally. Scenario U covers the switch away from a live block; this covers
# opening generic chat first, with no latch to retire.
LoadSurfaces $SURFACES_SHIPPED
LoadRows $ROWS_AGENT
ResetState
for ($i = 0; $i -lt 5; $i++) { AgentTick 'agent_generic_never_blocks' $i $FOCUS_M365_GENERIC }

# ── AB: …and so does a DIFFERENT named agent nobody blocked ─────────────────
LoadSurfaces $SURFACES_SHIPPED
LoadRows $ROWS_AGENT
ResetState
for ($i = 0; $i -lt 5; $i++) { AgentTick 'agent_other_named_never_blocks' $i $FOCUS_M365_HR }

# ── AC: THE LIVE-VERIFIED ROUND, replayed ───────────────────────────────────
# What the 2026-08-27 pass actually did, at the real 150ms poll cadence: type in
# the blocked agent's composer, sit idle ~3s (the live read was clean 17/17, and
# two transient misreads are injected here anyway because the latch has to
# survive them), press Enter — blocked throughout — then switch to generic
# Copilot chat and to a different agent, both of which must send immediately with
# no lingering block.
LoadSurfaces $SURFACES_SHIPPED
LoadRows $ROWS_AGENT
ResetState
for ($i = 0; $i -lt 20; $i++) {
  $focus = if ($i -eq 7) { $null } elseif ($i -eq 13) { $FOCUS_M365_TRANSCRIPT } else { $FOCUS_M365_ADVISOR }
  AgentTick 'agent_live_round' $i $focus
}
AgentTick 'agent_live_round' 20 $FOCUS_M365_GENERIC
AgentTick 'agent_live_round' 21 $FOCUS_M365_GENERIC
AgentTick 'agent_live_round' 22 $FOCUS_M365_HR

# ═══ The WebView2 parent-process pid fix ════════════════════════════════════
#
# THE bug found during the live pass. M365Copilot.exe hosts its UI in WebView2:
# the composer element is UIA-owned by a CHILD msedgewebview2.exe process, not by
# the foreground window's own process. ReadFocusedAgentName required an EXACT pid
# match, so every single read came back Unreadable and the narrowing could never
# arm at all.
#
# Modelled with REAL processes rather than invented pid numbers, because the fix
# is a real parent-pid lookup (CreateToolhelp32Snapshot): two genuine child
# processes of this harness stand in for the WebView2 child, and the pid
# relationships between them and the harness itself are what
# ElementPidBelongsToForeground is asked about.
$childA = $null
$childB = $null
try {
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = 'ping.exe'
  # Long enough to still be alive for the snapshot walk, short enough that a
  # harness crash before the finally block cannot leave a long-lived orphan.
  $psi.Arguments = '-n 30 127.0.0.1'
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $psi.RedirectStandardOutput = $true
  $childA = [System.Diagnostics.Process]::Start($psi)
  $childB = [System.Diagnostics.Process]::Start($psi)
  $selfPid = [uint32]$PID

  # ── AD: the fix — a focused element in a DIRECT CHILD of the foreground
  # process reads as Named, exactly as the real WebView2 composer does.
  LoadSurfaces $SURFACES_SHIPPED
  LoadRows $ROWS_AGENT
  ResetState
  for ($i = 0; $i -lt 3; $i++) {
    AgentTick 'agent_webview_child_pid' $i $FOCUS_M365_ADVISOR $selfPid 'M365Copilot' $childA.Id
  }

  # ── AE: the safety check the fix PRESERVES — a genuinely unrelated process is
  # still rejected. FocusedElement is a global read that was measured returning
  # an element from another window in another process, so this is the whole
  # reason the pid check exists. Two shapes, both one generation away from the
  # foreground and neither a child of it:
  #   tick 0 — a SIBLING process (childB's parent is the harness, not childA)
  #   tick 1 — the foreground process's own PARENT (the check is one-directional)
  # Both must land on Unreadable and arm nothing, even though the element's
  # properties would have read as the blocked agent.
  LoadSurfaces $SURFACES_SHIPPED
  LoadRows $ROWS_AGENT
  ResetState
  AgentTick 'agent_unrelated_pid_rejected' 0 $FOCUS_M365_ADVISOR ([uint32]$childA.Id) 'M365Copilot' $childB.Id
  ResetState
  AgentTick 'agent_unrelated_pid_rejected' 1 $FOCUS_M365_ADVISOR ([uint32]$childA.Id) 'M365Copilot' ([int]$selfPid)
}
finally {
  foreach ($c in @($childA, $childB)) {
    if ($null -ne $c) { try { $c.Kill() } catch { } ; try { $c.Dispose() } catch { } }
  }
}

# Leave the catalog exactly as it SHIPS, so nothing after this point could
# accidentally observe a fixture-only payload.
LoadSurfaces $SURFACES_SHIPPED

if ($script:tmpFile) { Remove-Item -LiteralPath $script:tmpFile -Force -ErrorAction SilentlyContinue }

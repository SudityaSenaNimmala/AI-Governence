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
  SetF '_blockedByPanel' $false
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
  Call 'ApplyForegroundTick' @($fgPid, $proc, $true, $hit, $rid, $readable) | Out-Null
  Call 'CheckFgBlocked' | Out-Null

  # The REAL Enter predicate, with no content signal armed — so a True here can
  # only be the platform block.
  $enterBlocked = Call 'EnterBlockActive' @($false, $false, $false, $false)
  $matchedId = if ($null -ne $hit) { $hit.GetType().GetField('Id').GetValue($hit) } else { '' }

  $obj = [ordered]@{
    scenario      = $scenario
    tick          = $n
    matched       = $matchedId
    readable      = $readable
    fgIsAi        = [bool](GetF '_fgIsAi')
    fgIsPanel     = [bool](GetF '_fgIsPanel')
    fgPanelId     = [string](GetF '_fgPanelId')
    fgIsBlocked   = [bool](GetF '_fgIsBlocked')
    blockedByPanel= [bool](GetF '_blockedByPanel')
    latchHeld     = [bool](Call 'PanelBlockLatchHeld')
    latchPanel    = [string](GetF '_panelBlockPanelId')
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

if ($script:tmpFile) { Remove-Item -LiteralPath $script:tmpFile -Force -ErrorAction SilentlyContinue }

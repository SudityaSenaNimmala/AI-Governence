# Behavioural harness for enforcer-win.ps1's POST-SEND CONFIRMATION — the check
# that decides whether a Tier B mask-and-send actually submitted, and the one
# that was reporting a real Microsoft Teams send as "not_submitted".
#
# NOTHING HERE INSTALLS A KEYBOARD HOOK, AND NOTHING HERE TYPES ANYTHING.
# [CfaiEnforcer]::Start() is never called (no hook, no mouse hook, no threads),
# and the write path is never entered — that path synthesizes keystrokes, which
# would type into whatever window happens to be focused on the machine running
# the tests. What IS driven, for real and by reflection, is every PURE decision
# the post-send confirmation makes:
#
#   LoadAiPanels           — the CLAMP applied to the catalog's postSendVerifyMs
#                            on the way in, per entry.
#   PostSendVerifyMsFor    — which window the FOCUSED surface gets, resolved from
#                            that catalog exactly as NewlineKeysFor resolves the
#                            newline combination.
#   NormalizeWs            — "does the composer still hold the masked text",
#                            against the reads a real composer returns once it
#                            has cleared (empty, null, whitespace-only).
#
# Emits NDJSON on stdout; agent/tests asserts on it.
#
# PRE-FIX BEHAVIOUR. Against a source where the post-send check is still a
# single fixed read, PostSendVerifyMsFor and PanelSig.PostSendVerifyMs do not
# exist. Rather than dying, the harness reports available:false and the tests
# fail on that — a diagnosable failure instead of a compile error.
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
$IFLAGS = [System.Reflection.BindingFlags]'NonPublic,Public,Instance'
function GetF([string]$n) { $f = $T.GetField($n, $FLAGS); if (-not $f) { throw "no field $n" }; $f.GetValue($null) }
function SetF([string]$n, $v) { $f = $T.GetField($n, $FLAGS); if (-not $f) { throw "no field $n" }; $f.SetValue($null, $v) }
function HasMethod([string]$n) { return [bool]$T.GetMethod($n, $FLAGS) }
function Call([string]$n, [object[]]$a = @()) {
  $m = $T.GetMethod($n, $FLAGS)
  if (-not $m) { throw "no method $n" }
  try { return $m.Invoke($null, $a) } catch { throw $_.Exception.InnerException }
}
function ConstOf([string]$n) {
  $f = $T.GetField($n, $FLAGS)
  if (-not $f) { return $null }
  return $f.GetValue($null)
}
function Out-Obj($obj) { Write-Output ($obj | ConvertTo-Json -Compress) }

# ── The timing constants the confirmation is built from ─────────────────────
# Absent constants come through as null, which is how a pre-fix source reports
# itself rather than blowing up.
Out-Obj @{ case = 'post_send_constants'
           available     = [bool](($null -ne (ConstOf 'REWRITE_POST_SEND_MS')) -and (HasMethod 'PostSendVerifyMsFor'))
           first_read_ms = (ConstOf 'REWRITE_POST_SEND_MS')
           poll_ms       = (ConstOf 'REWRITE_POST_SEND_POLL_MS')
           max_ms        = (ConstOf 'REWRITE_POST_SEND_MAX_MS')
           # The rest of the rewrite's time budget, so the test can check the
           # tail still fits the ceiling it was reasoned against.
           write_budget_ms = (ConstOf 'REWRITE_WRITE_BUDGET_MS')
           ttl_ticks       = (ConstOf 'REWRITE_TTL') }

# ── The catalog, in buildAiPanelConfig()'s shape ────────────────────────────
# The two shipped Teams entries carry the real postSendVerifyMs. The fixtures
# exist only here, and each one pins one edge of the clamp:
#   fixture_absent   — no field at all: must land on the DEFAULT, i.e. exactly
#                      the single read that shipped before the field existed.
#   fixture_below    — asks for LESS than the default: may not shorten the read
#                      native composers rely on.
#   fixture_zero     — 0, the value a "disable this" typo would produce.
#   fixture_negative — a negative window, which would make the deadline maths
#                      run backwards if it were honoured.
#   fixture_huge     — 30s: would outlive the dialog waiting for the answer, so
#                      it must be capped rather than obeyed.
#   fixture_garbage  — a non-numeric value; must not throw and must not widen.
#   fixture_middle   — a legal in-range value, so the field is proven to be DATA
#                      rather than a hardcoded Teams special case.
$PANELS = @(
  '{"id":"claude_code","procs":["Code","Cursor"],"controlType":"Edit","nameEquals":"Message input","namePrefix":"","classEquals":"","classPrefix":"messageInput_","enforce":true,"dlpMatch":"agent","newlineKeys":"shift_enter"}'
  '{"id":"teams_composer","procs":["ms-teams"],"controlType":"Edit","nameEquals":"","namePrefix":"","classEquals":"ck-editor__editable","classPrefix":"","enforce":true,"dlpMatch":"agent","newlineKeys":"shift_enter","postSendVerifyMs":1500}'
  '{"id":"teams_copilot_composer","procs":["ms-teams"],"controlType":"Edit","nameEquals":"","namePrefix":"","classEquals":"fai-EditorInput__input","classPrefix":"","enforce":true,"dlpMatch":"panel","newlineKeys":"shift_enter","postSendVerifyMs":1500}'
  '{"id":"fixture_absent","procs":["ms-teams"],"controlType":"Edit","nameEquals":"","namePrefix":"","classEquals":"fixture-absent","classPrefix":"","enforce":true,"dlpMatch":"agent","newlineKeys":"shift_enter"}'
  '{"id":"fixture_below","procs":["ms-teams"],"controlType":"Edit","nameEquals":"","namePrefix":"","classEquals":"fixture-below","classPrefix":"","enforce":true,"dlpMatch":"agent","newlineKeys":"shift_enter","postSendVerifyMs":50}'
  '{"id":"fixture_zero","procs":["ms-teams"],"controlType":"Edit","nameEquals":"","namePrefix":"","classEquals":"fixture-zero","classPrefix":"","enforce":true,"dlpMatch":"agent","newlineKeys":"shift_enter","postSendVerifyMs":0}'
  '{"id":"fixture_negative","procs":["ms-teams"],"controlType":"Edit","nameEquals":"","namePrefix":"","classEquals":"fixture-neg","classPrefix":"","enforce":true,"dlpMatch":"agent","newlineKeys":"shift_enter","postSendVerifyMs":-5000}'
  '{"id":"fixture_huge","procs":["ms-teams"],"controlType":"Edit","nameEquals":"","namePrefix":"","classEquals":"fixture-huge","classPrefix":"","enforce":true,"dlpMatch":"agent","newlineKeys":"shift_enter","postSendVerifyMs":30000}'
  '{"id":"fixture_garbage","procs":["ms-teams"],"controlType":"Edit","nameEquals":"","namePrefix":"","classEquals":"fixture-garbage","classPrefix":"","enforce":true,"dlpMatch":"agent","newlineKeys":"shift_enter","postSendVerifyMs":"soon"}'
  '{"id":"fixture_middle","procs":["ms-teams"],"controlType":"Edit","nameEquals":"","namePrefix":"","classEquals":"fixture-middle","classPrefix":"","enforce":true,"dlpMatch":"agent","newlineKeys":"shift_enter","postSendVerifyMs":700}'
) -join ','
Call 'LoadAiPanels' @('[' + $PANELS + ']') | Out-Null

# ── A: the clamp, as LoadAiPanels actually applied it ───────────────────────
$PANELSIG_T = $T.GetNestedType('PanelSig', $FLAGS)
if (-not $PANELSIG_T) { throw 'no nested PanelSig class' }
$msField = $PANELSIG_T.GetField('PostSendVerifyMs', $IFLAGS)
foreach ($p in (GetF '_panels')) {
  $id = [string]$PANELSIG_T.GetField('Id', $IFLAGS).GetValue($p)
  $ms = $null
  if ($null -ne $msField) { $ms = [int]$msField.GetValue($p) }
  Out-Obj @{ case = 'post_send_clamp'; panel = $id
             available = [bool]($null -ne $msField); ms = $ms }
}

# ── B: which window the FOCUSED surface gets ────────────────────────────────
# Driven by setting the panel state a real poll tick would have left behind,
# exactly as the multi-line harness drives NewlineKeysFor.
function WindowFor([bool]$isPanel, [string]$panelId) {
  SetF '_fgIsPanel' $isPanel
  SetF '_fgPanelId' $panelId
  if (-not (HasMethod 'PostSendVerifyMsFor')) { return $null }
  return [int](Call 'PostSendVerifyMsFor')
}
foreach ($panelId in @(
  'teams_composer', 'teams_copilot_composer', 'claude_code',
  'fixture_absent', 'fixture_below', 'fixture_zero', 'fixture_negative',
  'fixture_huge', 'fixture_garbage', 'fixture_middle', 'not_in_catalog'
)) {
  $ms = WindowFor $true $panelId
  Out-Obj @{ case = 'post_send_for_panel'; panel = $panelId
             available = [bool]($null -ne $ms); ms = $ms }
}
# No panel at all — a pure chat app (Claude Desktop, ChatGPT) has no AI_PANELS
# row and must keep the default single read.
$ms = WindowFor $false ''
Out-Obj @{ case = 'post_send_for_panel'; panel = '(none)'
           available = [bool]($null -ne $ms); ms = $ms }
# A panel id set while the surface is NOT a panel must not pick up the panel's
# window either — the same precedence NewlineKeysFor uses.
$ms = WindowFor $false 'teams_composer'
Out-Obj @{ case = 'post_send_for_panel'; panel = '(id_without_panel_flag)'
           available = [bool]($null -ne $ms); ms = $ms }

# ── C: "does the composer STILL hold the masked text" ───────────────────────
# The one comparison the confirmation makes, run for real against the reads a
# composer returns. A cleared composer must NOT look like a failed send, and a
# composer that really still holds the text must NOT look like a success —
# whichever surface it is, and however long we waited.
$masked = "hi team" + "`n" + "the ssn on file is [SSN]" + "`n" + "thanks"
foreach ($read in @(
  @{ name = 'still_the_masked_text'; value = $masked },
  @{ name = 'still_it_reflowed';     value = ($masked -replace "`n", "`r`n") },
  @{ name = 'cleared_empty';         value = '' },
  @{ name = 'cleared_whitespace';    value = "  `r`n " },
  @{ name = 'cleared_null';          value = $null },
  @{ name = 'placeholder';           value = 'Type a message' },
  @{ name = 'next_message_typed';    value = 'ok thanks' }
)) {
  # A FAILED read is a real case — ReadText returns null when neither pattern
  # answers — so null is passed through as null, not as "".
  $arg = $null
  if ($null -ne $read.value) { $arg = [string]$read.value }
  $normalizedRead = [string](Call 'NormalizeWs' @($arg))
  Out-Obj @{ case = 'still_there'; variant = $read.name
             still_there = ($normalizedRead -eq [string](Call 'NormalizeWs' @($masked))) }
}

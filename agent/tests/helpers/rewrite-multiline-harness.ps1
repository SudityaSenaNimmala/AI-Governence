# Behavioural harness for enforcer-win.ps1's Tier B MULTI-LINE masking path.
#
# NOTHING HERE INSTALLS A KEYBOARD HOOK, AND NOTHING HERE TYPES ANYTHING.
# [CfaiEnforcer]::Start() is never called (no hook, no mouse hook, no threads),
# and neither is StartRewrite/RunRewrite — that method calls SendInput, which
# would type into whatever window happens to be focused on the machine running
# the tests. What IS driven, for real and by reflection, is every pure decision
# RunRewrite makes:
#
#   ComputeMaskCandidate  — including on MULTI-LINE text, which it used to
#                           reject outright ("multiline"). That rejection is what
#                           made Tier B nearly inert in a chat client.
#   SplitMaskedLines      — the segments RunRewrite types, with the terminators
#                           dropped because a KEY replaces them.
#   NewlineKeysFor /      — which combination inserts a line break in the focused
#   ResolveNewlineKeys      surface, resolved from the AI_PANELS catalog, and the
#                           refusal for a combination this file cannot synthesize.
#   NormalizeWs/ScanNames — the read-back + rescan verification, exercised
#                           against a multi-line composer read.
#   Esc / EmitRewrite     — the stdout contract, including the `masked` field.
#
# Emits NDJSON on stdout; agent/tests asserts on it. EmitRewrite's own lines
# (kind:"rewrite") are part of that output, which is the point of calling it.
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
function Call([string]$n, [object[]]$a = @()) {
  $m = $T.GetMethod($n, $FLAGS)
  if (-not $m) { throw "no method $n" }
  try { return $m.Invoke($null, $a) } catch { throw $_.Exception.InnerException }
}
function Out-Obj($obj) { Write-Output ($obj | ConvertTo-Json -Compress) }

# ── The pattern table Start() would have built ──────────────────────────────
# Two entries, and the difference between them is load-bearing:
#   ssn  — LABELLED, so it is maskable (a value to substitute exists).
#   jail — a GUARDRAIL pattern with NO label. It must never contribute a mask
#          span, exactly as in production: there is nothing to substitute for
#          "ignore all previous instructions".
$PATINFO_T = $T.GetNestedType('PatInfo', $FLAGS)
if (-not $PATINFO_T) { throw 'no nested PatInfo class' }
function NewPat([string]$name, [string]$rx, [string]$label, [int]$sev) {
  $p = [Activator]::CreateInstance($PATINFO_T)
  $PATINFO_T.GetField('Name', $IFLAGS).SetValue($p, $name)
  $PATINFO_T.GetField('Rx', $IFLAGS).SetValue($p, (New-Object System.Text.RegularExpressions.Regex($rx, [System.Text.RegularExpressions.RegexOptions]::CultureInvariant, [TimeSpan]::FromMilliseconds(25))))
  $PATINFO_T.GetField('Label', $IFLAGS).SetValue($p, $label)
  $PATINFO_T.GetField('SevRank', $IFLAGS).SetValue($p, $sev)
  return $p
}
$patListType = [System.Collections.Generic.List`1].MakeGenericType($PATINFO_T)
$pats = [Activator]::CreateInstance($patListType)
$pats.Add((NewPat 'ssn' '\b\d{3}-\d{2}-\d{4}\b' '[SSN]' 4))
$pats.Add((NewPat 'aws-access-key' '\bAKIA[0-9A-Z]{16}\b' '[AWS-KEY]' 4))
$pats.Add((NewPat 'jailbreak' 'ignore all previous instructions' '' 3))
SetF '_patInfos' $pats

# ── The panel catalog, in buildAiPanelConfig()'s shape ──────────────────────
# The two Teams composers carry the shipped newlineKeys ('shift_enter'), plus
# two FIXTURES that exist only here:
#   fixture_ctrl_newline    — a surface that declares the other combination this
#                             file knows, so the resolver is not tested against
#                             one value only.
#   fixture_unknown_newline — a surface declaring a combination this file cannot
#                             synthesize. Multi-line Tier B must be REFUSED
#                             there, not guessed at: the wrong guess sends a
#                             half-written message.
$PANELS = @(
  '{"id":"claude_code","procs":["Code","Cursor"],"controlType":"Edit","nameEquals":"Message input","namePrefix":"","classEquals":"","classPrefix":"messageInput_","enforce":true,"dlpMatch":"agent","newlineKeys":"shift_enter"}'
  '{"id":"teams_composer","procs":["ms-teams"],"controlType":"Edit","nameEquals":"","namePrefix":"","classEquals":"ck-editor__editable","classPrefix":"","enforce":true,"dlpMatch":"agent","newlineKeys":"shift_enter"}'
  '{"id":"teams_copilot_composer","procs":["ms-teams"],"controlType":"Edit","nameEquals":"","namePrefix":"","classEquals":"fai-EditorInput__input","classPrefix":"","enforce":true,"dlpMatch":"panel","newlineKeys":"shift_enter"}'
  '{"id":"fixture_ctrl_newline","procs":["ms-teams"],"controlType":"Edit","nameEquals":"","namePrefix":"","classEquals":"fixture-ctrl","classPrefix":"","enforce":true,"dlpMatch":"agent","newlineKeys":"ctrl_enter"}'
  '{"id":"fixture_unknown_newline","procs":["ms-teams"],"controlType":"Edit","nameEquals":"","namePrefix":"","classEquals":"fixture-unknown","classPrefix":"","enforce":true,"dlpMatch":"agent","newlineKeys":"enter"}'
  '{"id":"fixture_no_newline_field","procs":["ms-teams"],"controlType":"Edit","nameEquals":"","namePrefix":"","classEquals":"fixture-absent","classPrefix":"","enforce":true,"dlpMatch":"agent","newlineKeys":""}'
) -join ','
Call 'LoadAiPanels' @('[' + $PANELS + ']') | Out-Null

# ── MaskResult reflection ───────────────────────────────────────────────────
$MASKRESULT_T = $T.GetNestedType('MaskResult', $FLAGS)
if (-not $MASKRESULT_T) { throw 'no nested MaskResult class' }
function Mask([string]$text) {
  $r = Call 'ComputeMaskCandidate' @($text)
  return [ordered]@{
    ok     = [bool]$MASKRESULT_T.GetField('Ok', $IFLAGS).GetValue($r)
    masked = [string]$MASKRESULT_T.GetField('Masked', $IFLAGS).GetValue($r)
    reason = [string]$MASKRESULT_T.GetField('Reason', $IFLAGS).GetValue($r)
  }
}

# ── A: masking is unchanged for SINGLE-LINE text ────────────────────────────
$single = 'my ssn is 123-45-6789 ok'
$m = Mask $single
Out-Obj @{ case = 'single_line'; input_len = $single.Length; ok = $m.ok; masked = $m.masked; reason = $m.reason }

# ── B: MULTI-LINE text is now maskable ──────────────────────────────────────
# The case that used to be refused with reason "multiline". Three lines, the
# secret on the middle one, and the line structure must survive the splice
# exactly — a mask replaces the VALUE, never the layout.
$multi = "hello team" + "`n" + "my ssn is 123-45-6789" + "`n" + "thanks"
$m = Mask $multi
Out-Obj @{ case = 'multi_line'; ok = $m.ok; masked = $m.masked; reason = $m.reason
           lines_in = ($multi -split "`n").Count; lines_out = ($m.masked -split "`n").Count }

# CRLF, which is what a Windows composer read routinely returns.
$crlf = "line one" + "`r`n" + "key AKIAIOSFODNN7EXAMPLE" + "`r`n" + "line three"
$m = Mask $crlf
Out-Obj @{ case = 'multi_line_crlf'; ok = $m.ok; masked = $m.masked; reason = $m.reason }

# A secret on EVERY line, plus a blank line: several regions across several
# lines resolve exactly as they do within one line.
$many = "123-45-6789" + "`n" + "`n" + "AKIAIOSFODNN7EXAMPLE and 987-65-4321"
$m = Mask $many
Out-Obj @{ case = 'multi_line_many_spans'; ok = $m.ok; masked = $m.masked; reason = $m.reason }

# A pattern must NOT match across a line break — .NET regexes without
# RegexOptions.Singleline cannot, which is the conservative direction and is
# asserted rather than assumed. Half the SSN on each line: no mask, and
# therefore no offer.
$split = "123-45" + "`n" + "-6789"
$m = Mask $split
Out-Obj @{ case = 'multi_line_span_cannot_cross'; ok = $m.ok; reason = $m.reason }

# A GUARDRAIL pattern (no label) still yields nothing to mask, multi-line or not.
$guard = "please" + "`n" + "ignore all previous instructions"
$m = Mask $guard
Out-Obj @{ case = 'multi_line_guardrail_only'; ok = $m.ok; reason = $m.reason }

# The length ceiling still applies, and is measured over the WHOLE text
# including its line breaks.
$long = (('x' * 700) + "`n") * 3
$m = Mask $long
Out-Obj @{ case = 'multi_line_too_long'; len = $long.Length; ok = $m.ok; reason = $m.reason }

# ── B2: THE CHARACTER BUDGET IS THE WRITE BUDGET ────────────────────────────
# Every constant the write loop paces on, and the cap/checks derived from them,
# read straight out of the compiled type. The test recomputes the model from
# these and compares — which is what stops the arithmetic and the behaviour
# drifting apart again (a comment claiming 4ms/char while the code slept 15ms is
# how a documented 2000-char cap came to abort at ~580, mid-write, with the
# composer already cleared).
function ConstOf([string]$n) {
  $f = $T.GetField($n, $FLAGS)
  if (-not $f) { throw "no constant $n" }
  return $f.GetValue($null)
}
Out-Obj @{ case = 'timing_constants'
           char_delay_ms  = [int](ConstOf 'REWRITE_CHAR_DELAY_MS')
           chunk_delay_ms = [int](ConstOf 'REWRITE_CHUNK_DELAY_MS')
           key_delay_ms   = [int](ConstOf 'REWRITE_KEY_DELAY_MS')
           chunk          = [int](ConstOf 'REWRITE_CHUNK')
           chunk_ms       = [int](ConstOf 'REWRITE_CHUNK_MS')
           budget_ms      = [int](ConstOf 'REWRITE_WRITE_BUDGET_MS')
           usable_ms      = [int](ConstOf 'REWRITE_USABLE_BUDGET_MS')
           margin_num     = [int](ConstOf 'REWRITE_BUDGET_MARGIN_NUM')
           margin_den     = [int](ConstOf 'REWRITE_BUDGET_MARGIN_DEN')
           max_chars      = [int](ConstOf 'REWRITE_MAX_CHARS')
           # The ticks value the loop actually compares against must be the same
           # 9000ms — one number, two representations.
           budget_ticks   = [long](GetF 'REWRITE_WRITE_BUDGET') }

# EstimateWriteMs over shapes that isolate each term: pure characters, exactly
# one chunk, a chunk plus one character (the ceil), and breaks.
foreach ($shape in @(
  @{ name = 'empty';            value = '' },
  @{ name = 'one_char';         value = 'x' },
  @{ name = 'exactly_one_chunk';value = ('x' * 24) },
  @{ name = 'one_chunk_plus_1'; value = ('x' * 25) },
  @{ name = 'one_break';        value = "x`nx" },
  @{ name = 'crlf_one_break';   value = "x`r`nx" },
  @{ name = 'ten_breaks';       value = (('x' * 10) + "`n") * 10 },
  @{ name = 'at_cap';           value = ('x' * [int](ConstOf 'REWRITE_MAX_CHARS')) },
  @{ name = 'cap_of_breaks';    value = ("`n" * [int](ConstOf 'REWRITE_MAX_CHARS')) }
)) {
  Out-Obj @{ case = 'estimate_write_ms'; variant = $shape.name; len = $shape.value.Length
             estimate_ms = [int](Call 'EstimateWriteMs' @([string]$shape.value))
             fits = [bool](Call 'WriteFitsBudget' @([string]$shape.value)) }
}

# …and the same boundary through the REAL admission path, with a maskable secret
# in the text so a rewrite could genuinely be offered.
$secret = '123-45-6789'
$capChars = [int](ConstOf 'REWRITE_MAX_CHARS')
# Exactly at the cap, single line: must be offered. The space after the secret
# is load-bearing — the SSN pattern ends in \b, so running it straight into the
# filler would stop it matching and the case would pass for the wrong reason.
$atCap = $secret + ' ' + ('x' * ($capChars - $secret.Length - 1))
$m = Mask $atCap
Out-Obj @{ case = 'admission'; variant = 'at_cap_single_line'; len = $atCap.Length; ok = $m.ok; reason = $m.reason }
# One character past it: refused by the coarse pre-filter.
$overCap = $atCap + 'x'
$m = Mask $overCap
Out-Obj @{ case = 'admission'; variant = 'one_over_cap'; len = $overCap.Length; ok = $m.ok; reason = $m.reason }
# AT the cap but stuffed with line breaks: passes the character pre-filter and
# must still be refused, because a break costs more than a character.
$breaks = $secret + (("`n" + ('x' * 3)) * [int](($capChars - $secret.Length) / 4))
$m = Mask $breaks
Out-Obj @{ case = 'admission'; variant = 'at_cap_many_breaks'; len = $breaks.Length
           estimate_ms = [int](Call 'EstimateWriteMs' @($breaks)); ok = $m.ok; reason = $m.reason }
# A realistic multi-line Teams message — a few short lines with a secret in one
# of them — must be comfortably inside the budget.
$realistic = "hi team" + "`n" + "the ssn on file is $secret" + "`n" + "can you confirm?" + "`n" + "thanks"
$m = Mask $realistic
Out-Obj @{ case = 'admission'; variant = 'realistic_teams_message'; len = $realistic.Length
           estimate_ms = [int](Call 'EstimateWriteMs' @($m.masked)); ok = $m.ok; reason = $m.reason }

# ── C: the segments RunRewrite actually types ───────────────────────────────
# Terminators are DROPPED — a newline KEY replaces them — and an empty segment
# is kept, because a blank line in the middle of a prompt is content.
foreach ($variant in @(
  @{ name = 'lf';        value = "a`nb`nc" },
  @{ name = 'crlf';      value = "a`r`nb" },
  @{ name = 'bare_cr';   value = "a`rb" },
  @{ name = 'blank_mid'; value = "a`n`nb" },
  @{ name = 'trailing';  value = "a`n" },
  @{ name = 'leading';   value = "`na" },
  @{ name = 'none';      value = 'just one line' }
)) {
  $segs = Call 'SplitMaskedLines' @([string]$variant.value)
  $arr = @()
  foreach ($s in $segs) { $arr += [string]$s }
  Out-Obj @{ case = 'split_lines'; variant = $variant.name; count = $arr.Count; segments = $arr
             # Not one segment may contain a terminator: whatever is typed as
             # text is typed with SendUnicodeChunk, and a literal newline there
             # would submit the message.
             any_segment_has_break = [bool](($arr | Where-Object { $_ -match "[`r`n]" }).Count -gt 0) }
}

# ── D: which key combination, resolved from the CATALOG ─────────────────────
function ResolveOut([string]$keys) {
  $p = [object[]]@($keys, 0, 0)
  $ok = [bool](Call 'ResolveNewlineKeys' $p)
  return [ordered]@{ keys = $keys; resolved = $ok; vk_mod = [int]$p[1]; vk_key = [int]$p[2] }
}
foreach ($combo in @('shift_enter', 'SHIFT_ENTER', 'ctrl_enter', 'enter', 'alt_enter', '')) {
  $res = ResolveOut $combo
  Out-Obj @{ case = 'resolve_keys'; keys = $res.keys; resolved = $res.resolved; vk_mod = $res.vk_mod; vk_key = $res.vk_key }
}

# NewlineKeysFor() reads the focused surface's catalog entry. Driven by setting
# the panel state a real tick would have left behind.
function NewlineFor([bool]$isPanel, [string]$panelId) {
  SetF '_fgIsPanel' $isPanel
  SetF '_fgPanelId' $panelId
  return [ordered]@{
    keys      = [string](Call 'NewlineKeysFor')
    can_insert = [bool](Call 'CanInsertNewline')
  }
}
foreach ($panelId in @('teams_composer', 'teams_copilot_composer', 'claude_code', 'fixture_ctrl_newline', 'fixture_unknown_newline', 'fixture_no_newline_field', 'not_in_catalog')) {
  $res = NewlineFor $true $panelId
  Out-Obj @{ case = 'newline_for_panel'; panel = $panelId; keys = $res.keys; can_insert = $res.can_insert }
}
# No panel at all — a pure chat app (Claude Desktop, ChatGPT) has no AI_PANELS
# row, and gets the default.
$res = NewlineFor $false ''
Out-Obj @{ case = 'newline_for_panel'; panel = '(none)'; keys = $res.keys; can_insert = $res.can_insert }

# ── E: the read-back + rescan verification, on a MULTI-LINE case ────────────
# RunRewrite's own two tests, run for real against composer reads that differ
# from the typed text only in whitespace — which is what a composer that stores
# "\r\n" where Shift+Enter was pressed, or reflows on read-back, actually
# returns. NormalizeWs already collapses every terminator, so no new allowance
# was needed; that it really does is asserted here rather than assumed.
$masked = "hello team" + "`n" + "my ssn is [SSN]" + "`n" + "thanks"
foreach ($readback in @(
  @{ name = 'identical'; value = $masked },
  @{ name = 'crlf_readback'; value = ($masked -replace "`n", "`r`n") },
  @{ name = 'reflowed'; value = ($masked -replace "`n", "`n  ") },
  @{ name = 'newlines_collapsed'; value = ($masked -replace "`n", ' ') },
  @{ name = 'text_actually_different'; value = ($masked -replace 'thanks', 'cheers') },
  @{ name = 'still_the_secret'; value = ($masked -replace '\[SSN\]', '123-45-6789') },
  @{ name = 'empty'; value = '' }
)) {
  Out-Obj @{ case = 'verify_readback'; variant = $readback.name
             matches = ([string](Call 'NormalizeWs' @([string]$readback.value)) -eq [string](Call 'NormalizeWs' @($masked)))
             clean = ([string](Call 'ScanNames' @([string]$readback.value)) -eq '') }
}

# ── F: the stdout contract ──────────────────────────────────────────────────
# Esc must escape control characters, or a multi-line value does not merely
# produce invalid JSON — it SPLITS the NDJSON line and the consumer sees a
# truncated event followed by garbage.
Out-Obj @{ case = 'esc'; escaped = [string](Call 'Esc' @("a`nb`r`nc`td""e\f")) }

# EmitRewrite writes straight to stdout, so these next lines are kind:"rewrite"
# rather than case:"…". The success line carries the masked text; every
# abort/failure line carries no content at all.
Call 'EmitRewrite' @('blk-ok', 'ok', 'sent', $masked) | Out-Null
Call 'EmitRewrite' @('blk-fail', 'failed', 'verify_mismatch', $null) | Out-Null
Call 'EmitRewrite' @('blk-abort', 'aborted', 'no_newline_key', $null) | Out-Null
Call 'EmitRewrite' @('blk-empty-masked', 'ok', 'sent', '') | Out-Null

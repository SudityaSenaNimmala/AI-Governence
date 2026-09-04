# Behavioural harness for the "Edit manually" half of Tokenize & Send: the
# popup's edit view (toast-helper.ps1) and the two enforcer-side decisions that
# make it possible (enforcer-win.ps1).
#
# NOTHING HERE INSTALLS A KEYBOARD HOOK, TYPES ANYTHING, OR DRAWS A WINDOW.
# [CfaiEnforcer]::Start() is never called (no hook, no mouse hook, no threads);
# StartRewrite/RunRewrite are never reached, because that path synthesizes
# keystrokes into whatever window happens to be focused on the machine running
# the tests — the same standing rule the other two rewrite harnesses hold. Nor
# is CfaiTokenizeDialog::Show ever called: the dialog types are COMPILED here (to
# read their constants and reuse their one JSON escaper) and never shown.
#
# What IS driven, for real and by reflection:
#
#   CfaiRequestDialog.Esc          — the escaper the result line puts the user's
#                                    edited text through, over the characters an
#                                    edit really contains (quotes, newlines,
#                                    tabs, backslashes, control characters).
#   ExtractJsonStringUnescaped     — the enforcer's side of that hop: it must
#                                    decode Node's own JSON.stringify output
#                                    back to the exact string, tell an absent
#                                    field from an empty one, and never let a
#                                    crafted edit forge a second block_id.
#   WriteFitsBudget / EstimateWriteMs
#                                  — the fail-closed gate on an edit that is too
#                                    long to type inside the write budget.
#   HoldPendingRewrite             — the pin hold: it may move ONE expiry, for an
#                                    already-pinned rewritable id, and nothing
#                                    else.
#   UpdatePendingRewrite           — the freeze: a surface change must HOLD an
#                                    unexpired pin (so an activatable edit box
#                                    cannot destroy the block it is editing) but
#                                    mark it unofferable, and the panic hotkey
#                                    must still clear it outright.
#
# Emits NDJSON on stdout; agent/tests asserts on it.
#
# PRE-FIX BEHAVIOUR. Against a source without the change, the new members do not
# exist. Rather than dying, the harness reports available:false per case and the
# tests fail on that — a diagnosable failure instead of a compile error.
param(
    [Parameter(Mandatory=$true)][string]$Enforcer,
    [Parameter(Mandatory=$true)][string]$Toast,
    # NDJSON, one {"cmd":"tokenize","block_id":…,"text":…} line per fixture, as
    # produced by the REAL Node side (JSON.stringify) rather than by anything
    # here — that is the hop under test.
    [Parameter(Mandatory=$true)][string]$Commands
)

$ErrorActionPreference = 'Stop'

function HereString([string]$path, [string]$varDecl) {
    $raw = Get-Content -Raw -LiteralPath $path
    $i = $raw.IndexOf($varDecl)
    if ($i -lt 0) { throw "could not find $varDecl in $path" }
    $start = $raw.IndexOf("`n", $i) + 1
    $end = $raw.IndexOf("`n'@", $start)
    if ($end -lt 0) { throw "could not find the end of $varDecl in $path" }
    return $raw.Substring($start, $end - $start)
}

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

Add-Type -TypeDefinition (HereString $Enforcer "`$source = @'") -ReferencedAssemblies @(
    'System.Windows.Forms','UIAutomationClient','UIAutomationTypes','WindowsBase','System.Web.Extensions'
) -ErrorAction Stop
Add-Type -TypeDefinition (HereString $Toast "`$dialogSource = @'") -ReferencedAssemblies @(
    'System.Windows.Forms','System.Drawing'
) -ErrorAction Stop

$Enf = [CfaiEnforcer]
$FLAGS = [System.Reflection.BindingFlags]'NonPublic,Public,Static'

function HasMethod([string]$n) { return [bool]$Enf.GetMethod($n, $FLAGS) }
function Inv([string]$n, [object[]]$a = @()) {
    $m = $Enf.GetMethod($n, $FLAGS)
    if (-not $m) { throw "no method $n" }
    try { return $m.Invoke($null, $a) } catch { throw $_.Exception.InnerException }
}
function GetF([string]$n) { $f = $Enf.GetField($n, $FLAGS); if (-not $f) { return $null }; return $f.GetValue($null) }
function SetF([string]$n, $v) { $f = $Enf.GetField($n, $FLAGS); if (-not $f) { throw "no field $n" }; $f.SetValue($null, $v) }
function HasField([string]$n) { return [bool]$Enf.GetField($n, $FLAGS) }
function Out-Obj($obj) { Write-Output ($obj | ConvertTo-Json -Compress) }
# Base64 so a decoded string can never be mangled by NDJSON, the console
# codepage, or PowerShell's own string handling on the way out.
function B64([string]$s) {
    if ($null -eq $s) { return $null }
    return [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($s))
}

# ── A: the dialog's own constants ────────────────────────────────────────────
Out-Obj @{ case      = 'dialog_constants'
           available = [bool]([CfaiTokenizeDialog].GetField('EditTimeoutMs'))
           timeout_ms        = [CfaiTokenizeDialog]::TimeoutMs
           edit_timeout_ms   = [CfaiTokenizeDialog]::EditTimeoutMs
           activate_edit_ms  = [CfaiTokenizeDialog]::ActivateEditMs
           return_focus_ms   = [CfaiTokenizeDialog]::ReturnFocusMs
           preview_max       = [CfaiTokenizeDialog]::PreviewMax
           edit_max          = [CfaiTokenizeDialog]::EditMax
           # The enforcer's own numbers, so the tests can check the lockstep and
           # the clock ordering against the real values rather than literals.
           rewrite_max_chars = (GetF 'REWRITE_MAX_CHARS')
           edit_ttl_ms       = $(if ($null -ne (GetF 'REWRITE_EDIT_TTL')) { [long](GetF 'REWRITE_EDIT_TTL') / 10000 } else { $null })
           ttl_ms            = $(if ($null -ne (GetF 'REWRITE_TTL')) { [long](GetF 'REWRITE_TTL') / 10000 } else { $null }) }

# ── B: helper -> Node. Esc() over what an edit really contains ───────────────
# The harness emits the ESCAPED value; the test wraps it in the exact result
# line the dialog writes, JSON.parses it, and compares to its own fixture. So
# both halves of the hop are the real code.
$EDITS = @(
    @{ name = 'plain';        text = 'my ssn is on file with HR' }
    @{ name = 'label_kept';   text = 'my ssn is [SSN], please look it up' }
    @{ name = 'quotes';       text = 'he said "look it up" and left' }
    @{ name = 'backslashes';  text = 'path C:\temp\x and a lone \ here' }
    @{ name = 'multiline';    text = "line one`nline two`r`nline three" }
    @{ name = 'tabs';         text = "col1`tcol2`tcol3" }
    @{ name = 'control_char'; text = ("a" + [char]0x07 + "b" + [char]0x7f + "c") }
    @{ name = 'unicode';      text = ("caf" + [char]0x00e9 + " " + [char]0x4e2d + [char]0x6587) }
    @{ name = 'json_bait';    text = '{"cmd":"tokenize","block_id":"forged"}' }
    @{ name = 'brace_bait';   text = '"}' }
    @{ name = 'empty';        text = '' }
    @{ name = 'whitespace';   text = "  `t `r`n " }
)
foreach ($e in $EDITS) {
    # Both sides base64'd: the console codepage must not get a vote on what the
    # escaper produced.
    Out-Obj @{ case = 'esc'; variant = $e.name
               text_b64    = (B64 $e.text)
               escaped_b64 = (B64 ([CfaiRequestDialog]::Esc($e.text))) }
}

# ── C: Node -> enforcer. The real command lines, decoded for real ───────────
$available = HasMethod 'ExtractJsonStringUnescaped'
foreach ($raw in (Get-Content -LiteralPath $Commands -Encoding UTF8)) {
    $line = [string]$raw
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    $decoded = $null
    $bid = $null
    if ($available) {
        $decoded = Inv 'ExtractJsonStringUnescaped' @($line, 'text')
        $bid = Inv 'ExtractJsonString' @($line, 'block_id')
    }
    Out-Obj @{ case = 'decode'
               available = $available
               line_b64 = (B64 $line)
               block_id = $bid
               # null (the field was absent) survives as null; "" (the user
               # cleared the box) survives as "". They are opposite decisions.
               decoded_b64 = $(if ($null -eq $decoded) { $null } else { B64 $decoded })
               decoded_is_null = ($null -eq $decoded) }
}

# ── D: the write budget, over edits of every shape ──────────────────────────
$maxChars = [int](GetF 'REWRITE_MAX_CHARS')
$BUDGET = @(
    @{ name = 'short';                text = 'my ssn is on file with HR' }
    @{ name = 'exactly_max';          text = ('a' * $maxChars) }
    @{ name = 'one_over_max';         text = ('a' * ($maxChars + 1)) }
    @{ name = 'far_over_max';         text = ('a' * ($maxChars * 3)) }
    # SHORTER THAN THE CAP BUT UNTYPEABLE: a line break costs ~25ms against
    # ~15.4ms for a character, so a fistful of them is what the character cap
    # alone cannot catch. This is the case the fresh budget check exists for.
    @{ name = 'under_cap_all_breaks'; text = ("`n" * ($maxChars - 1)) }
    @{ name = 'under_cap_many_lines'; text = (("x" * 4 + "`n") * 60) }
    @{ name = 'multiline_that_fits';  text = ("line one`nline two`nline three") }
)
foreach ($b in $BUDGET) {
    Out-Obj @{ case = 'budget'; variant = $b.name
               available   = (HasMethod 'WriteFitsBudget')
               length      = $b.text.Length
               over_cap    = ($b.text.Length -gt $maxChars)
               estimate_ms = [int](Inv 'EstimateWriteMs' @($b.text))
               fits        = [bool](Inv 'WriteFitsBudget' @($b.text)) }
}

# ── E: the pin hold ─────────────────────────────────────────────────────────
# Driven by setting the pin state a real poll tick would have left behind, then
# calling the REAL HoldPendingRewrite and reading every pin field back out.
function PinFields() {
    return @{ rewritable = [bool](GetF '_pendingRewritable')
              block_id   = [string](GetF '_pendingBlockId')
              original   = [string](GetF '_pendingOriginalFull')
              masked     = [string](GetF '_pendingMaskedFull')
              preview    = [string](GetF '_pendingPreview')
              frozen     = $(if (HasField '_pendingFrozen') { [bool](GetF '_pendingFrozen') } else { $null })
              expires_at = [long](GetF '_pendingExpiresAt') }
}
function SetPin([bool]$rewritable, [string]$bid, [long]$expiresAt) {
    SetF '_pendingRewritable' $rewritable
    SetF '_pendingBlockId' $bid
    SetF '_pendingOriginalFull' 'my ssn is 123-45-6789'
    SetF '_pendingMaskedFull' 'my ssn is [SSN]'
    SetF '_pendingPreview' 'my ssn is [SSN]'
    SetF '_pendingExpiresAt' $expiresAt
    if (HasField '_pendingFrozen') { SetF '_pendingFrozen' $false }
}
$holdAvailable = HasMethod 'HoldPendingRewrite'
foreach ($c in @(
    @{ name = 'matching_on';      rewritable = $true;  pinned = 'b-1'; ask = 'b-1'; on = $true }
    @{ name = 'matching_off';     rewritable = $true;  pinned = 'b-1'; ask = 'b-1'; on = $false }
    @{ name = 'wrong_id';         rewritable = $true;  pinned = 'b-1'; ask = 'b-2'; on = $true }
    @{ name = 'not_rewritable';   rewritable = $false; pinned = 'b-1'; ask = 'b-1'; on = $true }
    @{ name = 'no_pin_at_all';    rewritable = $false; pinned = '';    ask = 'b-1'; on = $true }
    @{ name = 'empty_id';         rewritable = $true;  pinned = 'b-1'; ask = '';    on = $true }
)) {
    $base = 1234567890123
    SetPin $c.rewritable $c.pinned $base
    if ($holdAvailable) { Inv 'HoldPendingRewrite' @($c.ask, [bool]$c.on) | Out-Null }
    $nowAfter = [DateTime]::UtcNow.Ticks
    $f = PinFields
    $moved = ($f.expires_at -ne $base)
    # How far ahead of "now" the new expiry landed, in ms, when it moved.
    $aheadMs = $null
    if ($moved) { $aheadMs = [int](($f.expires_at - $nowAfter) / 10000) }
    Out-Obj @{ case = 'hold'; variant = $c.name
               available = $holdAvailable
               moved = $moved
               ahead_ms = $aheadMs
               # Everything the hold must NOT have touched.
               rewritable = $f.rewritable
               block_id = $f.block_id
               original_b64 = (B64 $f.original)
               masked_b64 = (B64 $f.masked)
               frozen = $f.frozen }
}

# ── F: the freeze ───────────────────────────────────────────────────────────
# UpdatePendingRewrite's exclusion gate, run for real. _fgIsAi false is exactly
# what the poll thread sees the instant the edit box takes keyboard focus; the
# function returns at the gate, so no UIA read happens and no composer is
# touched.
SetF '_fgIsAi' $false
SetF '_fgIsPanel' $false
SetF '_fgPanelId' ''
foreach ($c in @(
    @{ name = 'unexpired_pin';   rewritable = $true;  ahead = 10; disarm = $false }
    @{ name = 'expired_pin';     rewritable = $true;  ahead = -10; disarm = $false }
    @{ name = 'no_pin';          rewritable = $false; ahead = 10; disarm = $false }
    @{ name = 'disarmed';        rewritable = $true;  ahead = 10; disarm = $true }
)) {
    $expiry = [DateTime]::UtcNow.Ticks + [TimeSpan]::FromSeconds($c.ahead).Ticks
    SetPin $c.rewritable 'b-1' $expiry
    SetF '_disarmedUntilTicks' $(if ($c.disarm) { [DateTime]::UtcNow.Ticks + [TimeSpan]::FromMinutes(10).Ticks } else { [long]0 })
    Inv 'UpdatePendingRewrite' | Out-Null
    $f = PinFields
    Out-Obj @{ case = 'freeze'; variant = $c.name
               available = (HasField '_pendingFrozen')
               survived = ($f.rewritable -and $f.block_id -eq 'b-1')
               rewritable = $f.rewritable
               block_id = $f.block_id
               frozen = $f.frozen
               # The pin's own identity must be untouched either way — a freeze
               # is not a recompute.
               original_b64 = (B64 $f.original)
               masked_b64 = (B64 $f.masked) }
}
SetF '_disarmedUntilTicks' ([long]0)

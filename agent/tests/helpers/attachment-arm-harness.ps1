# Behavioural harness for attachment-watcher.ps1's host_arm / baseline state
# machine.
#
# NOTHING HERE POLLS UI AUTOMATION. The watcher's main `while ($true)` loop is
# deliberately NOT lifted — only everything above it, which is where the arm set,
# the per-window filename baseline and the functions over them live. The real
# Apply-StdinCommand / Sync-BaselineForArm / Reset-Baseline are then driven
# directly with the exact NDJSON lines index.js sends, so what is under test is
# production code and not a paraphrase of it.
#
# The baseline itself is seeded the way the poll loop seeds it (a HashSet of
# filename-shaped UIA element Names, keyed by window handle), and the diff the
# loop would take is recomputed here — that diff is the thing the live bug
# silently emptied.
#
# Emits one NDJSON observation per step on stdout; agent/tests asserts on them.
param([Parameter(Mandatory = $true)][string]$Ps1)

$ErrorActionPreference = 'Stop'

$raw = Get-Content -Raw -LiteralPath $Ps1
# Everything before the poll loop. The marker is the loop's own preamble, so if
# the file is restructured this throws rather than silently testing half of it.
$marker = "`$tick = 0`r`n while (`$true) {"
$cut = $raw.IndexOf("`$tick = 0")
if ($cut -lt 0) { throw 'could not find the poll loop preamble ($tick = 0) in attachment-watcher.ps1' }
$preLoop = $raw.Substring(0, $cut)
foreach ($needed in @('function Apply-StdinCommand', 'function Sync-BaselineForArm', 'function Reset-Baseline')) {
    if ($preLoop.IndexOf($needed) -lt 0) { throw "the harness needs $needed to sit ABOVE the poll loop" }
}
Invoke-Expression $preLoop

# ── the poll loop's baseline bookkeeping, replicated ────────────────────────
# One Teams window, one hwnd — which is the whole point: ONE window holds every
# conversation the user has open.
$HWND = 42

function Seed-Baseline([string]$proc, [string[]]$names) {
    $set = New-Object System.Collections.Generic.HashSet[string]
    foreach ($n in $names) { $null = $set.Add($n) }
    $script:Seen[$script:HWND] = $set
    $script:SeenProc[$script:HWND] = $proc
}

function Has-Baseline { return [bool]$script:Seen.ContainsKey($script:HWND) }

function Baseline-Names {
    if (-not (Has-Baseline)) { return @() }
    return @($script:Seen[$script:HWND] | Sort-Object)
}

# Exactly the comparison the poll loop makes: names present now that were not in
# the baseline are the new attachments. An ABSENT baseline is the seed case — the
# loop takes a fresh silent snapshot and reports nothing at all.
function New-Since-Baseline([string[]]$currentNames) {
    if (-not (Has-Baseline)) { return @() }
    $prev = $script:Seen[$script:HWND]
    $out = New-Object System.Collections.Generic.List[string]
    foreach ($n in $currentNames) { if (-not $prev.Contains($n)) { $out.Add($n) } }
    return @($out | Sort-Object)
}

function Is-Armed([string]$name) {
    if ($null -eq $script:ArmedHostProcs) { return $false }
    return [bool]$script:ArmedHostProcs.Contains($name)
}

function Obs([string]$step, [hashtable]$extra) {
    $o = @{ obs = $step; armed = (Is-Armed 'ms-teams'); has_baseline = (Has-Baseline); baseline = (Baseline-Names) }
    foreach ($k in $extra.Keys) { $o[$k] = $extra[$k] }
    Emit-Json $o
}

function Arm([string]$proc, [string]$key) {
    Apply-StdinCommand ('{"cmd":"host_arm","process":"' + $proc + '","state":"on","key":"' + $key + '"}')
}
function Arm-NoKey([string]$proc) {
    Apply-StdinCommand ('{"cmd":"host_arm","process":"' + $proc + '","state":"on"}')
}
function Disarm([string]$proc) {
    Apply-StdinCommand ('{"cmd":"host_arm","process":"' + $proc + '","state":"off","key":"ignored"}')
}

$K1 = 'aaaaaaaaaaaaaaaa'   # "IT Help Desk Agent"
$K2 = 'bbbbbbbbbbbbbbbb'   # some other governed conversation

# ── SCENARIO A: the live bug ────────────────────────────────────────────────
#
# A governed conversation is open, the user attaches a file, and doing so bounces
# focus off the composer — which is a disarm followed by a re-arm for the SAME
# conversation. The baseline has to survive that, or the chip that appeared while
# focus was away is already in the fresh baseline and is never new.
Arm 'ms-teams' $K1
# The conversation's existing chat history, as the first armed tick would snapshot
# it: one filename-shaped element that is NOT a new attachment.
Seed-Baseline 'ms-teams' @('Policy.pdf')
Obs 'A1-armed-and-seeded' @{}

Disarm 'ms-teams'
Obs 'A2-focus-left-composer' @{}

Arm 'ms-teams' $K1
Obs 'A3-focus-returned-same-conversation' @{}

# The user dropped Test.docx while focus was away. This is the assertion the
# whole feature rests on.
Obs 'A4-diff-after-attachment' @{ new_files = (New-Since-Baseline @('Policy.pdf', 'Test.docx')) }

# Several flickers in a row (observed live as sub-second ARMED/disarmed pairs)
# must not erode it either.
Disarm 'ms-teams'; Arm 'ms-teams' $K1
Disarm 'ms-teams'; Arm 'ms-teams' $K1
Disarm 'ms-teams'; Arm 'ms-teams' $K1
Obs 'A5-after-three-flickers' @{ new_files = (New-Since-Baseline @('Policy.pdf', 'Test.docx')) }

# ── SCENARIO B: a real conversation switch still resets ─────────────────────
#
# The false positive the reset exists to prevent: one Teams window holds every
# conversation, so conversation A's baseline diffed against conversation B's view
# would report every filename in B as a brand-new attachment.
Disarm 'ms-teams'
Arm 'ms-teams' $K2
Obs 'B1-different-conversation' @{ new_files = (New-Since-Baseline @('Someone-elses-report.xlsx')) }

# ── SCENARIO C: no key at all falls back to always-reset ───────────────────
Arm 'ms-teams' $K1
Seed-Baseline 'ms-teams' @('Policy.pdf')
Arm-NoKey 'ms-teams'
Obs 'C1-arm-without-a-key' @{}

# ── SCENARIO D: an arm for another process leaves this baseline alone ──────
Arm 'ms-teams' $K1
Seed-Baseline 'ms-teams' @('Policy.pdf')
Arm 'some-other-host' $K2
Obs 'D1-other-process-armed' @{ other_armed = ([bool]$ArmedHostProcs.Contains('some-other-host')) }

# ── SCENARIO E: garbage on the channel is reported, not fatal ──────────────
Apply-StdinCommand '{not json at all'
Apply-StdinCommand ''
Apply-StdinCommand '{"cmd":"something_else","process":"ms-teams","state":"on"}'
Obs 'E1-survived-garbage' @{}

Emit-Json @{ obs = 'done' }

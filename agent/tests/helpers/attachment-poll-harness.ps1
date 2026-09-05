# Behavioural harness for attachment-watcher.ps1's POLL LOOP.
#
# Sibling to attachment-arm-harness.ps1, and it exists because of what that one
# does NOT cover. The arm harness deliberately stops at `$tick = 0` and then
# RE-IMPLEMENTS the loop's baseline bookkeeping (its Seed-Baseline builds a
# HashSet by hand; its New-Since-Baseline recomputes the diff). Every assertion
# it makes is therefore about a paraphrase of the loop rather than the loop — and
# the live crash lived exactly in the gap between the two. The real loop gets its
# baseline from Collect-FilenameLikeNames, whose return value PowerShell
# ENUMERATES, so an empty result stored $null where the paraphrase stored an empty
# HashSet. The next tick's `$prev.Contains(...)` threw, and went on throwing every
# 800ms because the throw lands before the loop's own baseline write.
#
# So this harness lifts the loop BODY VERBATIM out of the .ps1 and runs it one
# tick at a time. Real Collect-FilenameLikeNames, real ConvertTo-NameSet, real
# $Seen / $SeenProc writes, real Emit-Json, real diff. Two things are stubbed,
# neither of them under test:
#   * Get-ForegroundAiWindow — replaced by a scripted window, since there is no
#     focused AI app on a test box.
#   * Resolve-Path-ByBasename — the recursive Desktop/Downloads scan, which is
#     slow and answers a question this harness is not asking.
# Start-Sleep is neutered so a tick costs nothing.
#
# NOTHING HERE SENDS host_arm. That is the entire point: this is the DEFAULT path
# — an ordinary catalog AI app (Microsoft Copilot), no Teams, no arming, ever.
#
# One filename-shaped element per window, deliberately: the real collector reads
# $el.Current.Name first-hand and only then asks the real TreeWalker for children,
# which throws on anything that is not an AutomationElement and is swallowed by
# its own `catch {}`. A single-node fake tree is therefore all it will read — and
# all that is needed, because 0 names and 1 name ARE the two shapes the
# enumeration bug produced ($null and a bare [string]).
#
# Emits NDJSON on stdout — the harness's own `obs` lines plus every line the
# production loop emits. agent/tests asserts on both.
param([Parameter(Mandatory = $true)][string]$Ps1)

$ErrorActionPreference = 'Stop'

$raw = Get-Content -Raw -LiteralPath $Ps1

$cut = $raw.IndexOf('$tick = 0')
if ($cut -lt 0) { throw 'could not find the poll loop preamble ($tick = 0) in attachment-watcher.ps1' }
$preLoop = $raw.Substring(0, $cut)
foreach ($needed in @('function Collect-FilenameLikeNames', 'function ConvertTo-NameSet', 'function Is-CatalogAiProcess', 'function Get-FilenameFromAccessibleName', 'function Resolve-AttachmentFile', 'function Get-DisambiguatedBasename')) {
    if ($preLoop.IndexOf($needed) -lt 0) { throw "the harness needs $needed to sit ABOVE the poll loop" }
}

# ── lift the loop body, verbatim ────────────────────────────────────────────
$loopSrc = $raw.Substring($cut)
$openTok = 'while ($true) {'
$open = $loopSrc.IndexOf($openTok)
if ($open -lt 0) { throw 'could not find the poll loop itself (while ($true) {)' }
$body = $loopSrc.Substring($open + $openTok.Length).TrimEnd()
if (-not $body.EndsWith('}')) { throw 'poll loop does not end where expected; harness would run a truncated body' }
$body = $body.Substring(0, $body.Length - 1)
# `continue` in the baseline-seed branch needs an enclosing loop to belong to, and
# one iteration of `foreach` is precisely "skip the rest of this tick".
$tickFn = "function Invoke-Tick {`r`n foreach (`$__once in 1) {`r`n$body`r`n }`r`n}"

Invoke-Expression $preLoop
Invoke-Expression $tickFn

# ── stubs ───────────────────────────────────────────────────────────────────
function Start-Sleep { param([int]$Milliseconds, [int]$Seconds) }

# A FAKE DISK, one flat directory of basenames, standing in for the real
# Test-Path sweep plus the recursive Desktop/Downloads scan — which is slow and
# answers a question this harness is not asking.
#
# Only the LOWEST level is stubbed. Resolve-AttachmentFile itself, which is what
# decides literal-first-then-disambiguation-fallback, is the production one lifted
# out of the .ps1 above, so the ordering that keeps a real "Report 1.docx" from
# being redirected to "Report.docx" is genuinely under test here.
#
# Empty by default, which is byte-for-byte the old `return $null` behaviour every
# pre-existing scenario below was written against.
$script:FakeDisk = New-Object 'System.Collections.Generic.HashSet[string]' -ArgumentList @([System.StringComparer]::OrdinalIgnoreCase)
function Set-Disk([string[]]$names) {
    $script:FakeDisk.Clear()
    foreach ($n in $names) { if ($n) { $null = $script:FakeDisk.Add($n) } }
}
function Resolve-Path-ByBasename([string]$basename) {
    if ($basename -and $script:FakeDisk.Contains($basename)) { return "C:\FakeDisk\$basename" }
    return $null
}

$script:NextWindow = $null
function Get-ForegroundAiWindow { return $script:NextWindow }

# $name is either a filename-shaped element name or an ordinary window title; the
# regex in the production collector is what decides which, and that is the point.
function Set-Window([string]$proc, [int64]$hwnd, [string]$name) {
    $root = [pscustomobject]@{ Current = [pscustomobject]@{ Name = $name } }
    $script:NextWindow = [pscustomobject]@{ Element = $root; Process = $proc; Pid = 4242; Hwnd = $hwnd }
}

function Tick([string]$step, [string]$proc, [int64]$hwnd, [string]$name) {
    Set-Window $proc $hwnd $name
    $script:tick = 0
    $threw = $null
    try { Invoke-Tick } catch { $threw = $_.Exception.Message }
    $base = @()
    if ($Seen.ContainsKey($hwnd) -and $null -ne $Seen[$hwnd]) { $base = @($Seen[$hwnd]) | Sort-Object }
    Emit-Json @{
        obs           = $step
        threw         = $threw
        armed         = [int]$ArmedHostProcs.Count
        arm_keys      = [int]$ArmedHostKey.Count
        baseline      = @($base)
        baseline_null = [bool]($Seen.ContainsKey($hwnd) -and $null -eq $Seen[$hwnd])
    }
}

# ── SCENARIO A: THE LIVE CRASH ──────────────────────────────────────────────
#
# Microsoft Copilot — an ordinary catalog AI app. No host_arm is ever sent for it,
# because host_arm is a Teams-only mechanism. The window is focused showing
# nothing filename-shaped (the normal state of a freshly-focused AI window), and
# then the user attaches Test.docx.
#
# Before the fix: tick A1 stored $null as the baseline, and tick A2 died on
# $prev.Contains() — emitting `error: You cannot call a method on a null-valued
# expression.` and then doing it again on every following tick, because the throw
# happens before the loop's `$Seen[...] = $current` write so the $null baseline is
# never replaced. Which is exactly what was seen live: ~1/s, from the instant of
# the attach, and the file never scanned.
Tick 'A1-focused-nothing-attached' 'Copilot' 100 'Copilot'
Tick 'A2-user-attaches-Test.docx'  'Copilot' 100 'Test.docx'
Tick 'A3-still-attached'           'Copilot' 100 'Test.docx'
Tick 'A4-user-removes-it'          'Copilot' 100 'Copilot'

# ── SCENARIO B: the single-name baseline ────────────────────────────────────
#
# Same root cause, quieter symptom. A baseline of exactly ONE name enumerated to a
# bare [string], and [string]::Contains is SUBSTRING matching — so a new chip
# whose name is a substring of the one already in the baseline read as "already
# seen" and was silently never reported. A miss rather than a crash, and nothing
# in the suite would ever have noticed.
Tick 'B1-one-file-on-screen'  'ChatGPT' 200 'Quarterly-Report.pdf'
Tick 'B2-substring-named-new' 'ChatGPT' 200 'Report.pdf'

# ── SCENARIO D: the chip name wrapped in UI chrome ──────────────────────────
#
# Observed live in Microsoft Copilot, attaching Test.docx by drag-drop. Detection
# fired, but the name it captured was the accessible name of the chip's REMOVE
# BUTTON — Fluent UI labels it "Remove attachment <filename>" — so the watcher
# went looking for a file literally called "Remove attachment Test.docx" and
# logged `appeared … but not found on disk`. The attachment was never scanned.
#
# D3 shows the other half of it: the SAME attachment also exposes a plain
# "Test.docx" element, and once both extract to the same filename the set dedupes
# them, so a chip is one event and not two.
Tick 'D1-copilot-idle'          'Cursor' 300 'Microsoft Copilot'
Tick 'D2-remove-button-chrome'  'Cursor' 300 'Remove attachment Test.docx'
Tick 'D3-same-chip-plain-label' 'Cursor' 300 'Test.docx'
Tick 'D4-user-removes-it'       'Cursor' 300 'Microsoft Copilot'

# ── SCENARIO E: a real filename that STARTS with a chrome-ish word ───────────
#
# The guard on the fix above. Stripping is the dangerous direction: rewriting a
# real filename into a shorter one would send the scanner at a different file, or
# at none. "Quarterly Report.docx" is a bare chip name with a space in it and
# must survive byte-for-byte.
Tick 'E1-claude-idle'      'Claude' 400 'Claude'
Tick 'E2-spaced-filename'  'Claude' 400 'Quarterly Report.docx'

# ── SCENARIO F: Teams' DISPLAY-NAME disambiguation suffix ───────────────────
#
# Live, Microsoft Teams, the "IT Help Desk Agent" governed conversation, the same
# Test.docx that Microsoft Copilot had just blocked end-to-end:
#
#     attachment-watcher: filename "Test 1.docx" appeared in Microsoft Teams
#     but not found on disk
#     os_monitor: prompt sent into Microsoft Teams (7 chars)      <- UNBLOCKED
#
# ONLY Test.docx exists on disk — Teams appends a counter to the DISPLAYED name
# because that filename already appeared earlier in this conversation. Nothing
# resolved, so nothing was scanned and nothing was held.
#
# F3 is the other half: the release has to name the file the hold was ARMED
# under (the real Test.docx), not the display name, or Enter stays dead.
Set-Disk @('Test.docx')
Tick 'F1-teams-idle'            'ms-teams' 500 'Microsoft Teams'
Tick 'F2-disambiguated-chip'    'ms-teams' 500 'Test 1.docx'
Tick 'F3-user-removes-it'       'ms-teams' 500 'Microsoft Teams'

# ── SCENARIO G: Teams' share-confirmation chrome ────────────────────────────
#
# The third string the same chip produced in the same tick. "shared" is not a
# removal verb, so the Copilot-era $ChromeVerbRegex left the whole phrase intact
# and it went to disk lookup as a filename.
Set-Disk @('Test.docx')
Tick 'G1-teams-idle'            'ms-teams' 600 'Microsoft Teams'
Tick 'G2-youve-shared-chrome'   'ms-teams' 600 "You've shared Test 1.docx"

# ── SCENARIO H: a file REALLY called "Report 1.docx" ────────────────────────
#
# The guard on the fallback. Both files exist side by side; the exact name must
# win outright, and the strip must never be preferred over it. Getting this wrong
# scans a DIFFERENT document than the one the user attached and records it under
# the wrong name — the worst outcome available to this code.
Set-Disk @('Report 1.docx', 'Report.docx')
Tick 'H1-teams-idle'            'ms-teams' 700 'Microsoft Teams'
Tick 'H2-genuine-trailing-num'  'ms-teams' 700 'Report 1.docx'

# ── SCENARIO I: the percent-encoded sibling element ─────────────────────────
#
# "Test%201.docx" — the same disambiguated name exposed href-style by a different
# UIA element on the same chip. Deliberately NOT decoded: `%` is legal in a
# Windows filename, and decoding would resolve the SAME file twice. What matters
# is that its failure is inert — the sibling element that DOES resolve is
# unaffected, because each name in the diff is handled independently.
Set-Disk @('Test.docx')
Tick 'I1-teams-idle'            'ms-teams' 800 'Microsoft Teams'
Tick 'I2-percent-encoded'       'ms-teams' 800 'Test%201.docx'
Tick 'I3-plain-sibling'         'ms-teams' 800 'Test 1.docx'

# ── SCENARIO J: real filenames that START with a share verb ─────────────────
#
# The guard on the chrome widening. "Sent"/"Shared" are ordinary English words
# and ordinary first words of ordinary filenames, so a bare verb only strips when
# an explicit generic noun follows it. Neither of these may be touched.
Set-Disk @()
Tick 'J1-gemini-idle'           'Gemini' 900 'Gemini'
Tick 'J2-sent-items'            'Gemini' 900 'Sent Items.pdf'
Tick 'J3-shared-drive-map'      'Gemini' 900 'Shared Drive Map.xlsx'
Set-Disk @()

# ── SCENARIO C: a non-AI foreground window ──────────────────────────────────
# Get-ForegroundAiWindow answers $null for everything that is not an AI app, which
# is most ticks on a real desktop. Must be a quiet no-op.
$script:NextWindow = $null
$script:tick = 0
$cThrew = $null
try { Invoke-Tick } catch { $cThrew = $_.Exception.Message }
Emit-Json @{ obs = 'C1-no-ai-window'; threw = $cThrew }

Emit-Json @{ obs = 'done' }

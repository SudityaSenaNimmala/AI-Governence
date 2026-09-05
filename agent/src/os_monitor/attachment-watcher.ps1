# Attachment-chip watcher.
#
# Catches drag-drop file uploads into AI windows — which our CF_HDROP path
# can't see (no clipboard write) and our OpenFileDialog watcher can't see
# (no separate dialog window). The insight: ChatGPT, Claude Desktop, Cursor
# etc. all show the dropped file's NAME as a UI chip below the prompt
# immediately. That accessible name is exposed via UI Automation.
#
# Mechanism: every 800ms, walk the focused AI window's UIA descendants and
# collect any element whose Name matches a filename pattern (*.ext). When
# the set of currently-shown filenames grows compared to the last tick AND
# the new filename has been recently modified in a common user dir,
# emit an attachment_appeared event with the resolved path.
#
# Node side then runs the standard content_scan on that file.
#
# Output schema (NDJSON on stdout):
#   {"kind":"ready","ai_processes":[...]}
#   {"kind":"attachment_appeared","process":"ChatGPT","filename":"foo.csv","path":"C:\\...\\foo.csv","host_armed":false}
#   {"kind":"attachment_disappeared","process":"ChatGPT","filename":"foo.csv","host_armed":false}
#   {"kind":"heartbeat"}
#   {"kind":"error","message":"..."}
#
# Input schema (NDJSON on stdin), one command:
#   {"cmd":"host_arm","process":"ms-teams","state":"on"|"off","key":"<opaque>"}
#       Temporarily add a HOST APP (Microsoft Teams) to the set of processes this
#       watcher looks at — see $ArmedHostProcs. Sent by index.js only while the
#       enforcer says a governed or blocked agent conversation is the open one,
#       and withdrawn the moment it stops saying so.
#
#       `key` is an OPAQUE, non-reversible digest of which governed conversation
#       this arm is for (index.js hashes the admin-typed agent name + id + our own
#       panel id; no title, no filename, no free text ever reaches this channel).
#       It exists so a re-arm can tell "same conversation, focus just bounced" from
#       "a different conversation is now open" — see Reset-Baseline.

$ErrorActionPreference = 'Stop'
$ProgressPreference    = 'SilentlyContinue'

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

Add-Type -Namespace AttWatch -Name Win32 -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern System.IntPtr GetForegroundWindow();
[System.Runtime.InteropServices.DllImport("user32.dll", SetLastError=true)]
public static extern uint GetWindowThreadProcessId(System.IntPtr hWnd, out uint lpdwProcessId);
'@

$AiProcesses = if ($env:CFAI_AI_PROCESSES) {
    $env:CFAI_AI_PROCESSES -split ','
} else {
    @('ChatGPT', 'Claude', 'Cursor', 'Copilot', 'Comet', 'Gemini', 'Poe')
}

# ── Runtime-armed HOST APPS ─────────────────────────────────────────────────
#
# EMPTY AT STARTUP, always. $AiProcesses above is built by watcherProcessNames(),
# which deliberately excludes every `hostApp: true` catalog entry — Microsoft
# Teams — because a passive watcher on a company's chat client would see the
# filename of every attachment in every DM and channel. That exclusion is the
# privacy property of the host-app design and it is NOT relaxed here: this set is
# a SEPARATE one, $AiProcesses is never modified, and nothing puts a name in here
# except an explicit host_arm command from the Node side.
#
# index.js sends that command only while the enforcer's govstate says a governed
# or blocked agent conversation is the open one in that app, and sends "off" the
# instant it stops. So the window in which Teams is watched at all is exactly the
# window in which the org already asked for that conversation to be governed.
$ArmedHostProcs = New-Object 'System.Collections.Generic.HashSet[string]' -ArgumentList @([System.StringComparer]::OrdinalIgnoreCase)

# ── Non-blocking stdin ──────────────────────────────────────────────────────
#
# The main loop must keep polling UIA on its 800ms cadence, so it cannot sit in a
# blocking read the way toast-helper.ps1's command loop does.
#
# NOT [Console]::In.ReadLineAsync(), which this used to be and which is a trap:
# [Console]::In is a System.IO.TextReader+SyncTextReader, and SyncTextReader's
# override is literally `Task.FromResult(ReadLine())` — the read happens on the
# CALLING thread and only then is a Task handed back, already completed. So the
# "not finished yet, carry on polling" branch was unreachable, and the drain loop
# below blocked on its FIRST iteration until a line arrived, processed it, and
# blocked again on the next read. The UIA poll body underneath it ran ZERO times
# for the life of the process. The helper still printed `ready` and still applied
# every host_arm it was sent, which is exactly why this survived a test that only
# checked the command channel: the channel worked, nothing was ever watched.
#
# The RAW stream has no such override. Console.OpenStandardInput() returns a
# __ConsoleStream, which inherits Stream.ReadAsync — a genuine threadpool-backed
# read that returns an INCOMPLETE Task immediately — so one outstanding read plus
# our own byte→line assembly gives a poll that never blocks. A completed read of
# 0 bytes means the write end closed (parent gone) and no command can ever
# arrive again, so we stop re-issuing.
$StdinStream  = [Console]::OpenStandardInput()
$StdinBuf     = New-Object byte[] 8192
$StdinPending = $null
$StdinAcc     = ''
$StdinLines   = New-Object 'System.Collections.Generic.Queue[string]'
$StdinClosed  = $false
function Read-StdinLine {
    if ($script:StdinLines.Count -gt 0) { return $script:StdinLines.Dequeue() }
    if ($script:StdinClosed) { return $null }
    if ($null -eq $script:StdinPending) {
        try { $script:StdinPending = $script:StdinStream.ReadAsync($script:StdinBuf, 0, $script:StdinBuf.Length) }
        catch { $script:StdinClosed = $true; return $null }
    }
    if (-not $script:StdinPending.IsCompleted) { return $null }
    $n = 0
    try { $n = $script:StdinPending.Result } catch { $script:StdinClosed = $true; $script:StdinPending = $null; return $null }
    $script:StdinPending = $null
    if ($n -le 0) { $script:StdinClosed = $true; return $null }
    $script:StdinAcc += [System.Text.Encoding]::UTF8.GetString($script:StdinBuf, 0, $n)
    while (($i = $script:StdinAcc.IndexOf("`n")) -ge 0) {
        $script:StdinLines.Enqueue($script:StdinAcc.Substring(0, $i))
        $script:StdinAcc = $script:StdinAcc.Substring($i + 1)
    }
    if ($script:StdinLines.Count -gt 0) { return $script:StdinLines.Dequeue() }
    return $null
}

# Directories we'll search when resolving a filename → full path. Most user
# uploads come from one of these. We search by basename (no glob) so this
# stays cheap.
$SearchDirs = @(
    [Environment]::GetFolderPath('Desktop'),
    [Environment]::GetFolderPath('MyDocuments'),
    "$env:USERPROFILE\Downloads",
    "$env:USERPROFILE\OneDrive",
    "$env:USERPROFILE\OneDrive - CloudFuze, Inc"
) | Where-Object { $_ -and (Test-Path $_) }

# How often the poll loop says it is alive. Tick 1 always, then every Nth.
# Overridable so a test can prove liveness in seconds instead of the 40s the
# default cadence would take — see os-monitor-host-files.test.mjs.
$HeartbeatTicks = 50
if ($env:CFAI_WATCHER_HEARTBEAT_TICKS) {
    $n = 0
    if ([int]::TryParse($env:CFAI_WATCHER_HEARTBEAT_TICKS, [ref]$n) -and $n -gt 0) { $HeartbeatTicks = $n }
}

# Extensions we care about — same set the Node-side classifier scans.
$FilenameRegex = '\.(?:env|csv|tsv|xlsx?|sql|sqlite|db|dump|bak|har|pdf|docx?|odt|rtf|pages|zip|7z|rar|tar|tar\.gz|tgz|json|ya?ml|toml|ini|conf|config|cfg|js|ts|tsx|jsx|mjs|cjs|py|rb|go|rs|java|cs|cpp|c|h|swift|kt|php|md|markdown|txt|log|html?|xml|pem|key|pfx|p12|jks|keystore|png|jpe?g|gif|webp|bmp|ico|svg)$'

function Emit-Json($obj) {
    $line = $obj | ConvertTo-Json -Compress -Depth 5
    [Console]::Out.WriteLine($line)
    [Console]::Out.Flush()
}

# The CATALOG answer, and only that: is this one of the always-watched AI apps?
# Never true for a host app, armed or not. Split out from Is-AiProcess so an
# emitted event can say WHICH of the two rules let it through — see `host_armed`.
function Is-CatalogAiProcess([string]$name) {
    if (-not $name) { return $false }
    $base = $name -replace '\.exe$',''
    foreach ($p in $AiProcesses) { if ($base -ieq $p) { return $true } }
    return $false
}

function Is-AiProcess([string]$name) {
    if (Is-CatalogAiProcess $name) { return $true }
    if (-not $name) { return $false }
    $base = $name -replace '\.exe$',''
    # …OR a host app that is armed RIGHT NOW. Second set, checked second, and
    # $AiProcesses itself is untouched — so the default (unarmed) answer for
    # Microsoft Teams is still a flat no. See $ArmedHostProcs.
    if ($ArmedHostProcs.Contains($base)) { return $true }
    return $false
}

function Get-ForegroundAiWindow {
    $hwnd = [AttWatch.Win32]::GetForegroundWindow()
    if ($hwnd -eq [System.IntPtr]::Zero) { return $null }
    $procId = 0
    [void][AttWatch.Win32]::GetWindowThreadProcessId($hwnd, [ref]$procId)
    if ($procId -eq 0) { return $null }
    $proc = $null
    try { $proc = Get-Process -Id $procId -ErrorAction Stop } catch { return $null }
    if (-not (Is-AiProcess $proc.ProcessName)) { return $null }
    try {
        $el = [System.Windows.Automation.AutomationElement]::FromHandle($hwnd)
        return [pscustomobject]@{ Element = $el; Process = $proc.ProcessName; Pid = $procId; Hwnd = $hwnd }
    } catch { return $null }
}

# Pull the FILENAME out of a UIA element's accessible Name.
#
# The name on an attachment chip is very often not the bare filename. Observed
# live in Microsoft Copilot, attaching Test.docx by drag-drop:
#
#     attachment-watcher: filename "Remove attachment Test.docx" appeared in
#     Microsoft Copilot but not found on disk
#
# — because Fluent UI labels the chip's REMOVE BUTTON "Remove attachment
# <filename>" for screen readers, and that whole string was handed to
# Resolve-Path-ByBasename as if it were the filename. It ended in `.docx` so
# $FilenameRegex was happy; no such file exists on disk, so every attachment
# made this way resolved to $null and was never scanned.
#
# The rule here is deliberately narrow, because over-stripping is the worse
# failure: it would silently rewrite a REAL filename into a different one and
# then scan (or fail to scan) the wrong file. So only three things are removed,
# each justified by something that cannot legally appear in a Windows filename
# or by a closed vocabulary:
#
#   1. A trailing chrome word ("Test.docx, attached").
#   2. Everything up to and including the last ':' — a colon is ILLEGAL in a
#      Windows filename, so it is always chrome ("Attachment: Test.docx"), and
#      the same step harmlessly de-prefixes a drive letter.
#   3. A leading REMOVAL VERB, optionally followed by one generic noun. Verbs
#      only, and only the remove-a-chip vocabulary — not "Open"/"Document"/
#      "Image", which are ordinary first words of ordinary filenames
#      ("Document Review.docx" must survive intact).
#   4. A leading SHARE ANNOUNCEMENT — Teams' own confirmation label. Observed
#      live in Microsoft Teams:
#
#          attachment-watcher: filename "You've shared Test 1.docx" appeared in
#          Microsoft Teams but not found on disk
#
#      This is a different shape from Copilot's remove-button label: the verb
#      ("shared") is not a removal verb and it comes after a PRONOUN. Two
#      patterns rather than one widened verb list, because the pronoun is what
#      makes it safe:
#        * $ChromeSharePhraseRegex requires the pronoun ("You've shared X",
#          "You shared X", "I sent X"). Nothing that starts that way is a real
#          filename.
#        * $ChromeShareNounRegex allows a bare verb ONLY when an explicit
#          generic noun follows it ("Shared file X", "Attached document X").
#          Without that noun requirement a real "Sent Items.pdf" or "Shared
#          Drive Map.xlsx" would be silently rewritten — over-stripping is the
#          worse failure, per the rule above.
#
# Path separators are illegal in a filename too, so what is left is reduced to
# its basename, and the result only counts if it still looks like a file.
# A bare "Test.docx" passes through all of it unchanged, which is the case every
# other AI app already relied on.
$ChromeSuffixRegex     = '(?i)[\s,;•|]+(?:attached|attachment|selected|uploaded|added|shared|sent)\s*$'
$ChromeVerbRegex       = '(?i)^(?:remove|delete|dismiss|discard|detach|unattach|clear|cancel)\s+(?:(?:the|this)\s+)?(?:attachment|attached\s+file|uploaded\s+file|file|upload|image|document|photo|item)?\s*'
# Pronoun REQUIRED. Curly apostrophe as well as straight — Fluent UI ships the
# typographic one ("You’ve shared") in plenty of strings.
$ChromeSharePhraseRegex = '(?i)^(?:you|we|i)(?:[''’](?:ve|re)|\s+(?:have|has|had))?\s+(?:just\s+)?(?:shared|sent|attached|uploaded|added|posted)\s+(?:(?:the|this|a|an|your|my)\s+)?(?:attachment|attached\s+file|uploaded\s+file|file|upload|image|document|photo|item)?\s*'
# No pronoun — so a generic NOUN is mandatory, and the filename starts after it.
$ChromeShareNounRegex   = '(?i)^(?:shared|sent|attached|uploaded|added|posted)\s+(?:(?:the|this|a|an)\s+)?(?:attachment|attached\s+file|uploaded\s+file|file|upload|image|document|photo|item)\s+'

function Get-FilenameFromAccessibleName([string]$name) {
    if (-not $name) { return $null }
    $s = $name.Trim()
    if ($s.Length -eq 0 -or $s.Length -ge 260) { return $null }
    $s = [regex]::Replace($s, $ChromeSuffixRegex, '')
    $ci = $s.LastIndexOf(':')
    if ($ci -ge 0) { $s = $s.Substring($ci + 1) }
    $s = ($s -replace '^.*[\\/]', '').Trim()
    $s = [regex]::Replace($s, $ChromeVerbRegex, '').Trim()
    $s = [regex]::Replace($s, $ChromeSharePhraseRegex, '').Trim()
    $s = [regex]::Replace($s, $ChromeShareNounRegex, '').Trim()
    # No trimming of dots anywhere above: a LEADING dot is meaningful (.env).
    if (-not $s -or $s.Length -ge 260) { return $null }
    if ($s -match $FilenameRegex) { return $s }
    return $null
}

# Returns a HashSet[string] — ALWAYS, including when it found nothing.
#
# The `,` on the return is load-bearing, not style. PowerShell ENUMERATES a
# collection that a function returns, so a plain `return $names` hands the caller
# the set's CONTENTS: $null for an empty set, a bare [string] for one name, an
# [Object[]] for several. The caller stores that in $Seen as the per-window
# baseline and calls .Contains() on it next tick — and .Contains() on $null is
# "You cannot call a method on a null-valued expression."
#
# That is a live crash, not a theoretical one: an AI window with no filename-
# shaped element yet (the normal state of a freshly-focused Copilot/ChatGPT
# window) seeds a $null baseline, and the very first file the user attaches makes
# the diff below dereference it. The throw lands before the `$Seen[...] = $current`
# write at the bottom of the loop, so the baseline stays $null and the poll loop
# re-throws every 800ms for the life of the process — which is exactly how it was
# observed: `attachment-watcher error: You cannot call a method on a null-valued
# expression.` repeating ~1/s from the moment of the attach, with the file never
# scanned.
#
# It was unreachable until the SyncTextReader wedge above was fixed, because
# until then this loop body never executed at all. `,$names` wraps the set in a
# one-element array; the enumeration unwraps THAT and the set itself survives.
function Collect-FilenameLikeNames($element) {
    $names = New-Object System.Collections.Generic.HashSet[string]
    try {
        # Walk a bounded subtree — too deep can be expensive for huge windows.
        # AI windows are mostly Chrome_WidgetWin_1; a depth-limited walk is fine.
        $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
        $stack  = New-Object System.Collections.Generic.Stack[object]
        $stack.Push(@{ El = $element; Depth = 0 })
        while ($stack.Count -gt 0) {
            $cur = $stack.Pop()
            if ($cur.Depth -gt 25) { continue }   # cap depth
            $el = $cur.El
            try {
                $name = $null
                try { $name = $el.Current.Name } catch {}
                # The EXTRACTED filename goes in the set, never the raw
                # accessible name — see Get-FilenameFromAccessibleName. That is
                # also what makes the set dedupe a chip that exposes itself
                # twice (its label "Test.docx" and its remove button "Remove
                # attachment Test.docx" are one attachment, one event).
                $fn = Get-FilenameFromAccessibleName $name
                if ($fn) { $names.Add($fn) | Out-Null }
            } catch {}
            try {
                $child = $walker.GetFirstChild($el)
                while ($child) {
                    $stack.Push(@{ El = $child; Depth = ($cur.Depth + 1) })
                    $child = $walker.GetNextSibling($child)
                }
            } catch {}
        }
    } catch {}
    return ,$names
}

# Coerce anything that could be sitting where a name-set is expected — $null, a
# bare string, an object array, or an actual set — into a HashSet.
#
# Second line of defence behind the `,` above, and the reason it is worth having
# is the failure mode: getting this wrong does not degrade detection, it throws
# out of the poll loop before the baseline write and wedges the watcher into a
# permanent error loop. A baseline is also a value that survives ticks, so one
# bad write poisons every later tick. Cheap to normalise, expensive to skip.
function ConvertTo-NameSet($value) {
    if ($value -is [System.Collections.Generic.HashSet[string]]) { return ,$value }
    $set = New-Object System.Collections.Generic.HashSet[string]
    if ($null -ne $value) {
        foreach ($v in @($value)) { if ($v) { $null = $set.Add([string]$v) } }
    }
    return ,$set
}

function Resolve-Path-ByBasename([string]$basename) {
    foreach ($dir in $SearchDirs) {
        $candidate = Join-Path $dir $basename
        if (Test-Path -LiteralPath $candidate -PathType Leaf) { return $candidate }
    }
    # Recursive search bounded to a couple known dirs (Downloads + Desktop)
    foreach ($dir in @([Environment]::GetFolderPath('Desktop'), "$env:USERPROFILE\Downloads")) {
        if (-not $dir -or -not (Test-Path $dir)) { continue }
        $hit = Get-ChildItem -LiteralPath $dir -Filter $basename -Recurse -ErrorAction SilentlyContinue -File | Select-Object -First 1
        if ($hit) { return $hit.FullName }
    }
    return $null
}

# ── Teams' DISPLAY-NAME disambiguation suffix ───────────────────────────────
#
# Observed live in Microsoft Teams, attaching the same file the second time in
# one conversation:
#
#     attachment-watcher: filename "Test 1.docx" appeared in Microsoft Teams
#     but not found on disk
#
# The real file is and always was `Test.docx` — the only Test* file on disk.
# Teams renames the CHIP, not the bytes: when a filename has already appeared in
# the conversation history it shows the next one as "<base> <N><ext>" so the two
# are tellable apart in the transcript. Resolve-Path-ByBasename went looking for
# a literal "Test 1.docx", found nothing, and the attachment was reported
# path-less — never scanned, never held, and the send went straight through
# (`os_monitor: prompt sent into Microsoft Teams`) with the file attached.
#
# The parenthesised "<base> (<N>)<ext>" form is accepted too — that is Explorer's
# own copy-collision convention and cheap to cover — but the bare form is what
# was actually observed and it is what the regex is written around.
#
# ONE trailing counter, immediately before ONE extension, and nothing else. This
# never runs unless the literal name has already failed to resolve (see
# Resolve-AttachmentFile), so a file genuinely called "Report 1.docx" that
# exists on disk is found by its real name and this is not consulted at all.
$DisambigSuffixRegex = '^(?<base>.+?)[ ]+(?:\((?<pn>\d{1,4})\)|(?<bn>\d{1,4}))(?<ext>\.[^.\\/]{1,12})$'

function Get-DisambiguatedBasename([string]$basename) {
    if (-not $basename) { return $null }
    $m = [regex]::Match($basename, $DisambigSuffixRegex)
    if (-not $m.Success) { return $null }
    $cand = ($m.Groups['base'].Value).TrimEnd() + $m.Groups['ext'].Value
    if (-not $cand -or $cand -eq $basename) { return $null }
    # The shortened name still has to look like a file we would have collected.
    if ($cand -notmatch $FilenameRegex) { return $null }
    return $cand
}

# Resolve a collected chip name to a real file, and say what that file is
# ACTUALLY called on disk.
#
# EXACT MATCH ALWAYS WINS. The literal name is tried across every search dir,
# including the recursive Desktop/Downloads sweep, before the disambiguation
# fallback is even computed — so "Report 1.docx", a file whose real name simply
# ends in a number, resolves to itself and can never be silently redirected to a
# different "Report.docx" sitting beside it.
#
# Returns $null, or an object carrying the resolved Path and the TRUE on-disk
# Filename. The true name is what goes on the event: it is the file the scan
# actually reads, so it is the name the governance record has to carry.
function Resolve-AttachmentFile([string]$basename) {
    if (-not $basename) { return $null }
    $hit = Resolve-Path-ByBasename $basename
    if (-not $hit) {
        $alt = Get-DisambiguatedBasename $basename
        if ($alt) { $hit = Resolve-Path-ByBasename $alt }
    }
    if (-not $hit) { return $null }
    return [pscustomobject]@{ Path = $hit; Filename = [System.IO.Path]::GetFileName($hit) }
}

Emit-Json @{ kind = 'ready'; pid = $PID; ai_processes = $AiProcesses; search_dirs = $SearchDirs }

# Per-process previously-seen set, so we only emit on NEW filenames.
$Seen = @{}
# Which process each tracked hwnd belongs to. Kept alongside $Seen (rather than
# folded into it) purely to hold this change's diff down: it exists so an
# arm/disarm can drop the BASELINE for the app it concerns and nothing else.
$SeenProc = @{}

# Which governed conversation each host app's current baseline belongs to — the
# opaque `key` off the last host_arm that reset it. See Reset-Baseline.
$ArmedHostKey = @{}

# Chip DISPLAY name → the TRUE on-disk filename it resolved to.
#
# The baseline ($Seen) has to keep holding the display name, because that is what
# the next tick's UIA read produces and the diff has to compare like with like.
# But the EVENTS have to carry the real filename — and the Node side keys its
# attachment-hold map on exactly that string, arming on `attachment_appeared`
# and releasing on `attachment_disappeared`. Without this map the two would
# disagree the moment Teams disambiguates a name: armed under "Test.docx",
# released under "Test 1.docx", matching nothing. The hold's own TTL would not
# save it either — #syncAttachHold keeps refreshing a hold for as long as it is
# in the map — so Enter would stay dead in that app until the agent restarted.
$ResolvedName = @{}

# Forget every baseline belonging to $proc.
#
# It is what stops the one false positive this feature could otherwise produce.
# $Seen is a per-hwnd snapshot of the filename-shaped elements the window showed
# last tick; ONE Teams window holds every conversation the user has open, so a
# baseline describing conversation A's chat history, diffed against a
# newly-opened conversation B, would report every filename in B's view as a
# brand-new attachment — files the user never touched.
#
# Dropping it instead makes the next armed tick take a fresh SILENT baseline (the
# `-not $Seen.ContainsKey` seed step below), so only files attached from that
# point on are ever reported.
#
# ── Why this is NOT run on every arm/disarm any more ────────────────────────
#
# It used to be, and that made a Teams attachment IMPOSSIBLE to detect. govstate
# is deliberately edge-triggered on the FOCUSED ELEMENT (enforcer-win.ps1's
# UpdateGovState requires _fgLeftAiTicks == 0, i.e. a first-hand read of the
# composer this very tick), so it drops the instant focus leaves the composer and
# returns when focus comes back. Every way of attaching a file does exactly that:
# a drag from Explorer makes Explorer the foreground window, and the paperclip
# opens a flyout or a file picker that takes focus. Observed live as ARMED/
# disarmed pairs under 1s apart.
#
# So the sequence for EVERY attachment was: arm (baseline seeded, no chip) →
# user starts attaching → disarm → chip appears → focus returns → arm → baseline
# RESET → next tick seeds a fresh silent baseline that already CONTAINS the chip
# → the chip is never new, and is never reported. The reset was erasing the one
# piece of evidence the diff needed, at precisely the moment it appeared.
#
# The fix is to reset on a change of CONVERSATION rather than on a change of arm
# state, which is what the false positive was ever about. $key is index.js's
# opaque digest of the governed conversation; a re-arm carrying the key the
# baseline was taken under is focus bouncing inside one conversation and KEEPS
# it, and any other key (or no key at all) resets as before. A disarm keeps the
# baseline too — while disarmed the loop takes no reads at all, so the baseline
# cannot drift, and it is what the chip has to be diffed against when focus
# returns.
function Reset-Baseline([string]$proc) {
    if (-not $proc) { return }
    $stale = @($SeenProc.Keys | Where-Object { $SeenProc[$_] -ieq $proc })
    foreach ($h in $stale) { $Seen.Remove($h); $SeenProc.Remove($h) }
}

# Reset only if this arm is for a DIFFERENT governed conversation than the one
# the current baseline was taken under.
function Sync-BaselineForArm([string]$proc, [string]$key) {
    if (-not $proc) { return }
    $prevKey = if ($ArmedHostKey.ContainsKey($proc)) { [string]$ArmedHostKey[$proc] } else { $null }
    # No key on the command — an older/unknown caller. Fall back to the old
    # always-reset behaviour, which is the conservative direction (a miss, not a
    # false report).
    if (-not $key) { Reset-Baseline $proc; $ArmedHostKey.Remove($proc); return }
    if ($prevKey -eq $key) { return }
    Reset-Baseline $proc
    $ArmedHostKey[$proc] = $key
}

# ── The one command this watcher accepts ────────────────────────────────────
#
# host_arm, and nothing else. It carries a process name, an on/off and the opaque
# conversation key — no path, no filename, no free text.
#
# A named function rather than an inline block in the poll loop so the arm/baseline
# state machine can be driven directly by tests. See
# agent/tests/helpers/attachment-arm-harness.ps1.
function Apply-StdinCommand([string]$cmdLine) {
    if ($null -eq $cmdLine) { return }
    $cmdLine = $cmdLine.Trim()
    if ($cmdLine.Length -eq 0) { return }
    try {
        $cmd = $cmdLine | ConvertFrom-Json
        if ($cmd.cmd -eq 'host_arm' -and $cmd.process) {
            $procName = ([string]$cmd.process) -replace '\.exe$',''
            if ($cmd.state -eq 'on') {
                $null = $ArmedHostProcs.Add($procName)
                # Only an arm may touch the baseline, and only when the
                # conversation it names is not the one the baseline was taken
                # under. See Sync-BaselineForArm.
                Sync-BaselineForArm $procName ([string]$cmd.key)
            } else {
                $null = $ArmedHostProcs.Remove($procName)
                # …and a DISARM deliberately leaves it alone. Dropping it here
                # is what made a Teams attachment undetectable: focus leaving
                # the composer to attach a file is a disarm, and the baseline
                # is exactly what the chip that appears next has to be diffed
                # against when focus returns.
            }
        }
    } catch {
        Emit-Json @{ t = (Get-Date).ToUniversalTime().ToString('o'); kind = 'error'; message = 'bad stdin command' }
    }
}

$tick = 0
while ($true) {
    $tick++
    # ── Drain stdin ─────────────────────────────────────────────────────────
    while ($true) {
        $cmdLine = Read-StdinLine
        if ($null -eq $cmdLine) { break }
        Apply-StdinCommand $cmdLine
    }
    try {
        $fg = Get-ForegroundAiWindow
        if ($fg) {
            $current = ConvertTo-NameSet (Collect-FilenameLikeNames $fg.Element)
            # First time we ever see this hwnd (fresh watcher start, or a
            # window we haven't polled before): seed the baseline silently
            # instead of diffing against empty. Otherwise every restart
            # treats whatever filename-shaped chip already sits in chat
            # history (or a stuck composer attachment from a prior session)
            # as a brand-new attachment and fires a false attachment_appeared.
            if (-not $Seen.ContainsKey($fg.Hwnd)) {
                $Seen[$fg.Hwnd] = $current
                $SeenProc[$fg.Hwnd] = $fg.Process
                if ($tick -eq 1 -or $tick % $HeartbeatTicks -eq 0) {
                    Emit-Json @{ t = (Get-Date).ToUniversalTime().ToString('o'); kind = 'heartbeat'; tick = $tick; tracked = $Seen.Count }
                }
                Start-Sleep -Milliseconds 800
                continue
            }
            # Normalised on the way out as well as on the way in, so a baseline
            # written by an older build (or by any future path that forgets) can
            # never be the thing .Contains() is called on.
            $prev = ConvertTo-NameSet $Seen[$fg.Hwnd]
            # Did $ArmedHostProcs — rather than the catalog — let this window be
            # looked at? Stated on the event for the same reason
            # file-dialog-watcher.ps1 latches `host_armed` onto each dialog: by the
            # time the Node side handles this, govstate may already have gone false
            # (focus moves off the composer constantly, see Reset-Baseline), and
            # re-deriving "was it governed?" there would answer no for attachments
            # that were made inside a governed conversation. This is the answer
            # from the moment the chip was actually seen.
            $hostArmed = -not (Is-CatalogAiProcess $fg.Process)
            # One name at a time, and each one INDEPENDENTLY. One chip is often
            # visible through several UIA elements at once, and they do not all
            # carry the same string: Teams showed the same attachment as
            # "Test 1.docx" (the label), "Test%201.docx" (an href-shaped
            # exposure of the same disambiguated name) and "You've shared
            # Test 1.docx" (the confirmation) in a single tick. Only the ones
            # that resolve are scanned; a sibling that does not resolve emits its
            # path-less event and changes nothing about the others — there is no
            # shared state between iterations and no early exit. So ONE element
            # resolving is enough for the file to be held and scanned, which is
            # why the percent-encoded variant is deliberately left to fail
            # rather than being URL-decoded: decoding it would resolve the SAME
            # file a second time and scan, record and hold it twice, and `%` is
            # a perfectly legal character in a real Windows filename.
            foreach ($name in $current) {
                if (-not $prev.Contains($name)) {
                    $resolved = Resolve-AttachmentFile $name
                    if ($resolved) {
                        # The TRUE on-disk name, not the display name — the scan
                        # reads that file, so that is the name the record and the
                        # hold have to be about. See $ResolvedName.
                        $ResolvedName[$name] = $resolved.Filename
                        Emit-Json @{
                            t          = (Get-Date).ToUniversalTime().ToString('o')
                            kind       = 'attachment_appeared'
                            process    = $fg.Process
                            pid        = $fg.Pid
                            filename   = $resolved.Filename
                            path       = $resolved.Path
                            host_armed = [bool]$hostArmed
                        }
                    } else {
                        # Filename appeared but couldn't be resolved — still
                        # interesting; emit filename-only so the dashboard
                        # reflects something happened.
                        $ResolvedName.Remove($name)
                        Emit-Json @{
                            t          = (Get-Date).ToUniversalTime().ToString('o')
                            kind       = 'attachment_appeared'
                            process    = $fg.Process
                            pid        = $fg.Pid
                            filename   = $name
                            path       = $null
                            host_armed = [bool]$hostArmed
                        }
                    }
                }
            }
            # A filename that was present last tick and is gone this tick —
            # the user removed the attachment (or it scrolled out of the UIA
            # tree, a known false-disappear risk in a long chat; the Node
            # side's attachment-hold consumer treats this as best-effort
            # release, not proof the file is truly gone, since a stale hold
            # auto-expires via its own TTL regardless).
            foreach ($name in $prev) {
                if (-not $current.Contains($name)) {
                    # Released under the SAME name it was armed under — the true
                    # on-disk one where we have it. See $ResolvedName.
                    $releaseName = if ($ResolvedName.ContainsKey($name)) { [string]$ResolvedName[$name] } else { $name }
                    $ResolvedName.Remove($name)
                    Emit-Json @{
                        t          = (Get-Date).ToUniversalTime().ToString('o')
                        kind       = 'attachment_disappeared'
                        process    = $fg.Process
                        pid        = $fg.Pid
                        filename   = $releaseName
                        host_armed = [bool]$hostArmed
                    }
                }
            }
            $Seen[$fg.Hwnd] = $current
            $SeenProc[$fg.Hwnd] = $fg.Process
        }
        # tick 1 as well as every 50th — `ready` proves the process started, only a
        # heartbeat proves THIS loop is running. See the same note in
        # file-dialog-watcher.ps1: the SyncTextReader wedge produced a helper that
        # said ready and then never emitted another line, and nothing noticed.
        if ($tick -eq 1 -or $tick % $HeartbeatTicks -eq 0) {
            Emit-Json @{ t = (Get-Date).ToUniversalTime().ToString('o'); kind = 'heartbeat'; tick = $tick; tracked = $Seen.Count }
        }
    } catch {
        Emit-Json @{ t = (Get-Date).ToUniversalTime().ToString('o'); kind = 'error'; message = $_.Exception.Message }
    }
    Start-Sleep -Milliseconds 800
}

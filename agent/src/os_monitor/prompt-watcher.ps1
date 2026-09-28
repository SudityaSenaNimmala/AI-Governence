# Typed-prompt watcher.
#
# Reads the text the user has TYPED into an AI desktop app's prompt box —
# without injecting into the app — using Windows UI Automation. This is the
# only way to see typed (not pasted) secrets in vendor-sealed apps like
# Claude Desktop and ChatGPT Desktop, which pin TLS (proxy can't read traffic)
# and enforce ASAR integrity (DOM hook can't be injected).
#
# Mechanism: every ~1.2s, if the foreground window belongs to an AI app, grab
# the focused UIA element (the composer the caret is in) and read its current
# text via ValuePattern (textarea/input) or TextPattern (contenteditable, which
# is what Chromium/Electron expose for rich editors). Emit the text as NDJSON;
# Node runs the pattern catalog, dedupes, notifies, and reports.
#
# We read the FOCUSED element only, so we get the prompt box the user is typing
# in — NOT the whole conversation transcript.
#
# IDE processes (VS Code, Cursor) are a special case: "the focused element" in an
# IDE is usually a source file or a terminal, not a prompt box, so for those the
# element must FIRST match a known AI-composer signature (CFAI_AI_PANELS) or
# nothing is read at all. See the panel-scoping block below.
#
# Runs as a separate STA helper alongside win-poller.ps1. Output schema:
#   {"kind":"ready"}
#   {"kind":"prompt_text","process":"claude","pid":1234,"title":"Claude","text":"...","len":42,"panel":""}
#   {"kind":"egress_body","surface":"outlook_classic","process":"OUTLOOK","pid":1234,"text":"...","len":42,"truncated":false,"recipient_domains":["@gmail.com"]}
#       The body of an email, captured EXACTLY ONCE at the send transition — see
#       the "EGRESS body capture" section below. Carries recipient DOMAINS only,
#       never a full address, and never a subject line. A separate kind from
#       prompt_text because it is not a prompt: nothing about it goes through the
#       AI catalog, the panel gate or Is-AiProcess.
#   {"kind":"heartbeat","tick":N}
#   {"kind":"error","message":"..."}
#
# Limitations:
#   - Some WinUI 3 / heavily-custom editors don't expose Value or Text patterns;
#     those yield nothing (no false data, just no coverage).
#   - We can DETECT + NOTIFY only — UIA can't block another app's send.

$ErrorActionPreference = 'Stop'
$ProgressPreference    = 'SilentlyContinue'
$WarningPreference     = 'SilentlyContinue'

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

Add-Type -Namespace CFAIP -Name Win32 -MemberDefinition @'
    [System.Runtime.InteropServices.DllImport("user32.dll")]
    public static extern System.IntPtr GetForegroundWindow();
    [System.Runtime.InteropServices.DllImport("user32.dll", SetLastError=true)]
    public static extern uint GetWindowThreadProcessId(System.IntPtr hWnd, out uint lpdwProcessId);
'@

# A SECOND, additive namespace rather than an extra member on CFAIP.Win32 above,
# so the existing type — which every AI code path in this file depends on — is
# left exactly as it is.
#
# IsWindow is what detects the "the compose window was CLOSED" send transition.
# A chat composer never needs it (it stays on screen and simply goes empty, which
# is the transition tracker mode already keys on), but an email is very often
# sent by a window disappearing while its body still held text — and that copy of
# the body is sitting in $EgressBody at that moment. Without this the record for
# every such send would simply never be emitted. A window handle only; no title,
# no class, no content.
Add-Type -Namespace CFAIE -Name Win32 -MemberDefinition @'
    [System.Runtime.InteropServices.DllImport("user32.dll")]
    public static extern bool IsWindow(System.IntPtr hWnd);
'@

$AiProcesses = if ($env:CFAI_AI_PROCESSES) {
    $env:CFAI_AI_PROCESSES -split ','
} else {
    @('ChatGPT', 'Claude', 'Cursor', 'Copilot', 'Comet', 'Gemini', 'Poe')
}

# ── IDE panel scoping (CFAI_IDE_PROCESSES / CFAI_AI_PANELS) ───────────────────
#
# Cursor is in AI_PROCESSES (it needs a host/exception mapping like every other
# vendor app), which used to mean this watcher read the full text of WHATEVER
# element had focus in Cursor every ~1.2s and emitted it as a typed prompt —
# source files and terminal output included. That is the exact false capture the
# keystroke enforcer's panel scoping exists to prevent, so the same data drives
# the same decision here: for a process in CFAI_IDE_PROCESSES, the focused
# element must match a CFAI_AI_PANELS signature before a single character is
# read. Apps that are not IDEs (Claude Desktop, ChatGPT, …) are untouched by
# this — their composer IS the whole relevant surface.
#
# Deliberately NOT implemented here: ai-processes.js's `panelFallback` flag. In
# the keystroke enforcer that flag means "scan the reconstructed typed buffer
# process-wide", which is content the user typed at that app anyway. Here it
# would mean "read and transmit the full text of any focused element in an IDE",
# which must never happen on a fallback. No panel match => no read, always.
#
# Both payloads are DATA from ai-processes.js; the comparison code below is the
# PowerShell twin of enforcer-win.ps1's MatchPanelSignature (same field order,
# same "any one field is enough" rule), and no signature literal appears here.
$IdeProcesses = @()
if ($env:CFAI_IDE_PROCESSES) {
    try {
        foreach ($e in (ConvertFrom-Json $env:CFAI_IDE_PROCESSES)) {
            $n = (('' + $e.name) -replace '\.exe$','').Trim()
            if ($n) { $IdeProcesses += $n }
        }
    } catch { $IdeProcesses = @() }
}
# Fail CLOSED when the payload is missing or unparseable: an older launcher that
# knows nothing about these env vars must not get the old read-everything-in-
# Cursor behaviour back. Same "hardcoded default list" convention $AiProcesses
# above uses; agent/tests asserts it matches IDE_PROCESSES.
#
# The Office names are here for the SAME fail-closed reason, not because Word is
# an IDE: they host the Microsoft 365 Copilot side pane, and a missing payload
# must mean "no element in Word/Excel/PowerPoint/OneNote may be read unless it
# matches a panel signature", never "read whatever has focus". Note these apps
# are not in AI_PROCESSES at all, so this watcher never even looks at their
# windows today — the entry is what keeps the gate closed if that ever changes.
if (@($IdeProcesses).Count -eq 0) { $IdeProcesses = @('Code', 'Cursor', 'WINWORD', 'EXCEL', 'POWERPNT', 'ONENOTE', 'ONENOTEIM', 'OUTLOOK', 'olk') }

$Panels = @()
if ($env:CFAI_AI_PANELS) {
    try {
        foreach ($p in (ConvertFrom-Json $env:CFAI_AI_PANELS)) {
            if (-not $p.id -or -not $p.controlType) { continue }
            $procs = @()
            foreach ($sp in @($p.procs)) {
                $n = (('' + $sp) -replace '\.exe$','').Trim()
                if ($n) { $procs += $n }
            }
            if (@($procs).Count -eq 0) { continue }   # a signature with no host process can never match
            $Panels += [pscustomobject]@{
                id          = '' + $p.id
                procs       = $procs
                controlType = '' + $p.controlType
                nameEquals  = '' + $p.nameEquals
                namePrefix  = '' + $p.namePrefix
                classEquals = '' + $p.classEquals
                classPrefix = '' + $p.classPrefix
            }
        }
    } catch { $Panels = @() }
}
# An empty table means no IDE element can ever match, i.e. no capture inside an
# IDE at all. That is the safe direction: the cost is lost coverage, not a leak.

# ── EGRESS body capture (a mail client's compose window) ────────────────────
#
# A SIBLING ARM, not an extension of the AI arms below. Nothing an egress process
# does can reach $AiProcesses / Is-AiProcess / Get-CaptureGate: a mail client is
# not in the AI catalog and never will be (agent/tests/ai-processes.test.mjs
# asserts it), so the two existing loop branches are unreachable for it and are
# left byte-for-byte alone.
#
# THREE independent gates, all required before one character is read:
#   1. POLICY — the process must be named by ~/.cloudfuze-aigov/egress-
#      surfaces.json, which happens only when an admin holds a governed
#      ai_platforms row for its host. No policy row: $EgressBySig is empty, the
#      arm never runs, and no property of a mail window is read.
#   2. captureBody — the surface must opt in ('full'). 'none' disables the arm
#      for that surface regardless of everything else.
#   3. bodySig — the FOCUSED element must match the compose-body signature,
#      through the EXISTING Match-PanelSignature (see $EgressBodyIds for how
#      that reuse works). The caret being somewhere in Outlook is not evidence;
#      only the element is. Every EGRESS_SURFACES entry ships bodySig:null
#      pending a live UIA probe, so this arm is inert as shipped.
#
# CAPTURE HAPPENS EXACTLY ONCE PER EMAIL, at the SEND transition. This is the
# single most important property of this arm. The naive shape — emit whatever the
# body holds on every poll tick — would produce roughly one record per 1.2s for
# the whole time someone drafts a message, each a growing prefix of the last:
# ~100 near-duplicate copies of one email, every one of them carrying its full
# text. It is modelled on the tracker-mode submit detection in this same file
# (non-empty -> empty means "it was sent"), with a second trigger for the case a
# chat composer does not have: the compose window CLOSING while the body still
# had text in it. See $EgressBody.
$EgressPath = if ($env:CFAI_EGRESS_PATH) { $env:CFAI_EGRESS_PATH } else {
    Join-Path $env:USERPROFILE '.cloudfuze-aigov\egress-surfaces.json'
}
# 8 * 1200ms is ~10s, matching blocked-agents-sync.js's write cadence.
$EgressReloadTicks = 8

# proc (lower) -> @{ Id; CaptureBody; RecipientSig }
$EgressBySig = @{}
# The surface ids whose bodySig was appended to $Panels. Membership is how a
# Match-PanelSignature hit is recognised as an EGRESS BODY rather than an AI
# panel — see Load-EgressSurfaces.
$EgressBodyIds = New-Object 'System.Collections.Generic.HashSet[string]' -ArgumentList @([System.StringComparer]::OrdinalIgnoreCase)

# Read the policy file and rebuild the egress locals.
#
# ── WHY THE BODY SIGNATURES GO INTO $Panels ─────────────────────────────────
#
# So that Match-PanelSignature — the existing, already-tested port of
# ai-processes.js's matchPanelSignature — is REUSED VERBATIM rather than
# duplicated with a second comparison that could drift from it. A bodySig has the
# identical shape as a panel signature (controlType + the four name/class rules),
# so appending it as a table row is a DATA change and the comparison code is
# untouched.
#
# This widens nothing. Match-PanelSignature is reached from exactly one place
# today — Get-CaptureGate — which returns allowed:true WITHOUT calling it for any
# non-IDE process, and an egress process is not an IDE process. So the added rows
# are invisible to every existing caller and are consulted only by the egress arm,
# which additionally checks $EgressBodyIds so an AI panel id can never be
# mistaken for a compose body (or the reverse).
#
# FAIL CLOSED on every failure mode by leaving the locals EMPTY: no surface
# armed, no body read. Built into fresh locals and assigned at the very end, so a
# payload that throws part-way cannot half-arm anything — and $Panels is rebuilt
# from a snapshot of the AI-panel rows rather than appended to in place, so a
# reload can never accumulate duplicate or stale egress rows across ticks.
$PanelsAiOnly = @($Panels)
function Load-EgressSurfaces {
    $bySig = @{}
    $bodyIds = New-Object 'System.Collections.Generic.HashSet[string]' -ArgumentList @([System.StringComparer]::OrdinalIgnoreCase)
    $panels = @($script:PanelsAiOnly)
    try {
        if (Test-Path -LiteralPath $script:EgressPath -PathType Leaf) {
            $raw = Get-Content -LiteralPath $script:EgressPath -Raw -ErrorAction Stop
            if ($raw) {
                $cfg = $raw | ConvertFrom-Json
                foreach ($s in @($cfg.surfaces)) {
                    if (-not $s -or -not $s.id) { continue }
                    # THE arming gate — see the identical check and comment in
                    # file-dialog-watcher.ps1's Load-EgressSurfaces. A governed
                    # ai_platforms row is policy, not a live-probe result, and a
                    # captureBody:'full' entry reads a compose body — this must
                    # never ride on the governed check alone.
                    if (($s.verified -isnot [bool]) -or ($s.verified -ne $true) -or ($s.enforce -isnot [bool]) -or ($s.enforce -ne $true)) { continue }
                    $captureBody = if (([string]$s.captureBody) -eq 'full') { 'full' } else { 'none' }
                    foreach ($p in @($s.procs)) {
                        $name = (([string]$p) -replace '\.exe$','').Trim()
                        if (-not $name) { continue }
                        $bySig[$name.ToLowerInvariant()] = @{
                            Id = [string]$s.id
                            CaptureBody = $captureBody
                            RecipientSig = $s.recipientSig
                        }
                    }
                    # Only a surface that BOTH opts into body capture and carries
                    # a real signature contributes a row. A null bodySig (every
                    # entry as shipped, pending its live probe) means the arm can
                    # never match and therefore never reads anything.
                    if ($captureBody -ne 'full') { continue }
                    $sig = $s.bodySig
                    if (-not $sig -or -not $sig.controlType) { continue }
                    $procs = @()
                    foreach ($p in @($s.procs)) {
                        $n = (([string]$p) -replace '\.exe$','').Trim()
                        if ($n) { $procs += $n }
                    }
                    if (@($procs).Count -eq 0) { continue }
                    $panels += [pscustomobject]@{
                        id          = '' + $s.id
                        procs       = $procs
                        controlType = '' + $sig.controlType
                        nameEquals  = '' + $sig.nameEquals
                        namePrefix  = '' + $sig.namePrefix
                        classEquals = '' + $sig.classEquals
                        classPrefix = '' + $sig.classPrefix
                    }
                    $null = $bodyIds.Add([string]$s.id)
                }
            }
        }
    } catch {
        $bySig = @{}
        $bodyIds = New-Object 'System.Collections.Generic.HashSet[string]' -ArgumentList @([System.StringComparer]::OrdinalIgnoreCase)
        $panels = @($script:PanelsAiOnly)
    }
    $script:EgressBySig = $bySig
    $script:EgressBodyIds = $bodyIds
    $script:Panels = $panels
}

function Is-IdeProcess([string]$name) {
    if (-not $name) { return $false }
    $base = $name -replace '\.exe$',''
    foreach ($p in $IdeProcesses) { if ($base -ieq ('' + $p).Trim()) { return $true } }
    return $false
}

# Port of ai-processes.js's matchPanelSignature() / enforcer-win.ps1's
# MatchPanelSignature(). Plain string comparison only, and an empty read never
# satisfies a non-empty rule (so a blank Name cannot prefix-match a namePrefix).
# Returns the panel id, or '' for no match.
function Match-PanelSignature([string]$proc, [string]$controlType, [string]$name, [string]$className) {
    if (@($Panels).Count -eq 0) { return '' }
    $p = (('' + $proc) -replace '\.exe$','').Trim()
    if (-not $p) { return '' }
    $ct = ('' + $controlType).Trim()
    if (-not $ct) { return '' }
    $nm  = ('' + $name).Trim()
    $cls = ('' + $className).Trim()
    foreach ($sig in $Panels) {
        if ($sig.controlType -ine $ct) { continue }
        $procHit = $false
        foreach ($sp in $sig.procs) { if ($sp -ieq $p) { $procHit = $true; break } }
        if (-not $procHit) { continue }
        $hit = $false
        if ($sig.nameEquals  -and $nm  -and ($nm -ieq $sig.nameEquals))  { $hit = $true }
        if (-not $hit -and $sig.namePrefix  -and $nm  -and $nm.StartsWith($sig.namePrefix,  'OrdinalIgnoreCase')) { $hit = $true }
        if (-not $hit -and $sig.classEquals -and $cls -and ($cls -ieq $sig.classEquals))  { $hit = $true }
        if (-not $hit -and $sig.classPrefix -and $cls -and $cls.StartsWith($sig.classPrefix, 'OrdinalIgnoreCase')) { $hit = $true }
        if ($hit) { return $sig.id }
    }
    return ''
}

# May this focused element's TEXT be read at all, and if so which panel is it?
#
# Non-IDE app  -> yes, no panel attribution (unchanged behaviour).
# IDE process  -> only when the element matches a panel signature.
#
# The ControlType/Name/ClassName read here is never emitted, logged or kept: an
# element name in an IDE can carry a file path or a workspace name.
function Get-CaptureGate($el, [string]$proc) {
    if (-not (Is-IdeProcess $proc)) {
        return [pscustomobject]@{ allowed = $true; panel = '' }
    }
    $ctName = ''; $nm = ''; $cls = ''
    try {
        # "ControlType.Edit" — take the last segment so the catalog can say
        # plain "Edit". Culture independent, unlike LocalizedControlType.
        $pn = '' + $el.Current.ControlType.ProgrammaticName
        $ctName = $pn.Substring($pn.LastIndexOf('.') + 1)
    } catch {}
    try { $nm  = '' + $el.Current.Name } catch {}
    try { $cls = '' + $el.Current.ClassName } catch {}
    $panelId = Match-PanelSignature $proc $ctName $nm $cls
    if ($panelId) { return [pscustomobject]@{ allowed = $true; panel = $panelId } }
    return [pscustomobject]@{ allowed = $false; panel = '' }
}

# ── Claude-tracker mode (opt-in) ───────────────────────────────────────────────
# Set CFAI_CLAUDE_TRACKER=1 to enable browser coverage and submit detection.
# When unset, the loop below behaves exactly as it always has, so the full agent
# is unaffected by anything in this block.
$TrackerMode = ($env:CFAI_CLAUDE_TRACKER -eq '1')

$BrowserProcesses = if ($env:CFAI_BROWSER_PROCESSES) {
    $env:CFAI_BROWSER_PROCESSES -split ','
} else {
    @('chrome', 'msedge', 'brave', 'firefox')
}

function Is-BrowserProcess([string]$name) {
    if (-not $name) { return $false }
    $base = $name -replace '\.exe$',''
    foreach ($p in $BrowserProcesses) { if ($base -ieq $p.Trim()) { return $true } }
    return $false
}

# Read the browser's address bar. This is the privacy gate: we resolve the URL
# BEFORE touching any text box, so a Gmail or Jira composer is never read at all
# — only a focused composer on claude.ai is.
function Get-BrowserUrl([System.IntPtr]$hwnd) {
    try {
        $win = [System.Windows.Automation.AutomationElement]::FromHandle($hwnd)
        if (-not $win) { return $null }
        $cond = New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
            [System.Windows.Automation.ControlType]::Edit)
        $edits = $win.FindAll([System.Windows.Automation.TreeScope]::Descendants, $cond)
        foreach ($e in $edits) {
            $nm = ''
            try { $nm = $e.Current.Name } catch {}
            # Chromium: "Address and search bar". Firefox: "Search with ... or enter address".
            if ($nm -match 'address|url|search bar|location') {
                $vp = $null
                if ($e.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$vp)) {
                    $v = $vp.Current.Value
                    if ($v) { return $v }
                }
            }
        }
    } catch {}
    return $null
}

# Walking the browser's UIA tree isn't free, so cache per-window for a few ticks.
$UrlCache = @{}
$UrlCacheTtlSec = 3

function Get-BrowserUrlCached([System.IntPtr]$hwnd) {
    $k = $hwnd.ToString()
    $now = Get-Date
    $hit = $UrlCache[$k]
    if ($hit -and (($now - $hit.at).TotalSeconds -lt $UrlCacheTtlSec)) { return $hit.url }
    $url = Get-BrowserUrl $hwnd
    $UrlCache[$k] = [pscustomobject]@{ url = $url; at = $now }
    return $url
}

# claude.ai -> which Claude surface. Anything else returns $null, which means
# "don't look at this window".
function Classify-ClaudeUrl([string]$u) {
    if (-not $u) { return $null }
    $s = $u.Trim()
    if ($s -notmatch '^[a-zA-Z]+://') { $s = 'https://' + $s }   # omnibox hides the scheme
    try { $uri = [Uri]$s } catch { return $null }
    $h = ($uri.Host).ToLower() -replace '^www\.',''
    if ($h -ne 'claude.ai') { return $null }
    if ($uri.AbsolutePath -match '^/code') { return 'Claude Code (web)' }
    return 'Claude'
}

# ── Governed web surfaces (CFAI_WEB_SURFACES) ─────────────────────────────────
#
# The catalog-driven successor to Classify-ClaudeUrl, for the FULL agent rather
# than the Claude tracker. ai-processes.js owns the data (WEB_SURFACES); this
# side owns only the comparison, exactly as CFAI_AI_PANELS works.
#
# An empty/absent payload leaves every browser ungoverned, which is what keeps
# this whole block inert for any caller that has not opted in.
#
# Parsed with a DIRECT ConvertFrom-Json call inside foreach, matching the
# CFAI_IDE_PROCESSES / CFAI_AI_PANELS loaders above. This is not a style
# preference: in Windows PowerShell 5.1 ConvertFrom-Json hands a JSON array to
# the PIPELINE as one un-enumerated object, so `@($env:X | ConvertFrom-Json)`
# yields a single element containing all the rows. Every host comparison then
# runs against an array instead of a string and silently matches nothing —
# i.e. it fails to the "no surface" side and governs nothing at all.
$WebSurfaces = @()
if ($env:CFAI_WEB_SURFACES) {
    try {
        foreach ($s in (ConvertFrom-Json $env:CFAI_WEB_SURFACES)) {
            $h = (('' + $s.host).Trim()).ToLower() -replace '^www\.',''
            # A row with no host can never match a URL; drop it rather than
            # carry an entry whose comparison is guaranteed to be dead.
            if (-not $h) { continue }
            $WebSurfaces += [pscustomobject]@{
                id       = '' + $s.id
                host     = $h
                product  = '' + $s.product
                vendor   = '' + $s.vendor
                platform = '' + $s.platform
                composerName = '' + $s.composerName
                # THE OTHER TWO IDENTITY SHAPES. Capture knew only the exact
                # composerName, so every surface that identifies by
                # AutomationId -- m365.cloud.microsoft and Office web, whose
                # composerName is deliberately empty -- was refused here and
                # produced NO DLP record while blocking worked fine. Same
                # class of gap as the hard-coded Edit control type.
                composerNamePrefixes = @($s.composerNamePrefixes | Where-Object { $_ })
                composerAutomationId = '' + $s.composerAutomationId
                agentReadMode = '' + $s.agentReadMode
                # The composer's CONTROL TYPE, catalog data since AI-219.
                # It was hard-coded to Edit here, which silently excluded
                # every surface whose composer is not one: Gemini
                # Enterprise's is a Group, and the Gemini panel in Gmail is
                # a ComboBox. Capture saw neither, so those surfaces could
                # block but never produce a DLP record. Empty defaults to
                # Edit, so every older surface is unchanged.
                composerControlType = '' + $s.composerControlType
                # Both flags travel and are read as strict booleans. Phase 1
                # reads neither — capture does not consult them — but they must
                # arrive intact for the blocking arm that will.
                enforce  = ($s.enforce -eq $true)
                verified = ($s.verified -eq $true)
            }
        }
    } catch {
        $WebSurfaces = @()
    }
}

# URL -> the governed surface it belongs to, or $null for "don't look at this
# window". HOST ONLY: unlike Classify-ClaudeUrl above, no path is ever
# inspected, because a path is one field away from a query string and a query
# string on an AI URL routinely contains the prompt itself.
#
# Normalisation must match webSurfaceForHost() in ai-processes.js: lowercase,
# strip a leading "www.", exact match, then registrable-suffix match.
function Classify-WebSurface([string]$u) {
    if (-not $u) { return $null }
    if (@($WebSurfaces).Count -eq 0) { return $null }
    $s = $u.Trim()
    if (-not $s) { return $null }
    # The omnibox hides the scheme, so a bare "claude.ai/chat" must still parse.
    if ($s -notmatch '^[a-zA-Z][a-zA-Z0-9+.-]*://') { $s = 'https://' + $s }
    try { $uri = [Uri]$s } catch { return $null }
    # Only real web traffic. about:, chrome://, file:, view-source: and friends
    # are never a governed AI surface and must not be coerced into one.
    if ($uri.Scheme -ne 'http' -and $uri.Scheme -ne 'https') { return $null }
    $h = ''
    try { $h = ('' + $uri.Host).ToLower() -replace '^www\.','' } catch { return $null }
    if (-not $h) { return $null }
    foreach ($ws in $WebSurfaces) { if ($h -eq ('' + $ws.host).ToLower()) { return $ws } }
    foreach ($ws in $WebSurfaces) { if ($h.EndsWith('.' + ('' + $ws.host).ToLower())) { return $ws } }
    return $null
}

# ── The omnibox exclusion ─────────────────────────────────────────────────────
#
# THIS IS A PRIVACY GATE, NOT AN OPTIMISATION, AND IT MUST NEVER BE REMOVED.
#
# Once the URL says the tab is a governed AI host, the code below reads whatever
# editable element holds focus. In a browser that set INCLUDES THE ADDRESS BAR:
# a user on claude.ai who hits Ctrl+L and starts typing a URL — or a search
# query, which the omnibox also accepts — would have that text read and reported
# as a prompt. The URL bar is where people paste internal hostnames, signed
# S3 links and password-reset links.
#
# The exclusion regex is deliberately THE SAME ONE Get-BrowserUrl uses to FIND
# the address bar. That identity is the invariant: anything the finder is
# willing to call an address bar must never be read as a composer. A narrower
# exclusion than the finder would leave a gap by construction.
#
# It also covers the find-in-page bar and the tab-search box, which are browser
# chrome for the same reason. The failure direction is a MISS, never a leak: a
# composer whose accessible name happens to contain "search bar" is skipped
# rather than read, which is the correct way for this to break.
function Is-BrowserChromeElement($el) {
    if (-not $el) { return $false }
    $nm = ''
    try { $nm = '' + $el.Current.Name } catch { return $true }  # unreadable ⇒ treat as chrome
    if (-not $nm) { return $false }
    if ($nm -match 'address|url|search bar|location') { return $true }
    if ($nm -match '^(find|search tabs|find in page)$') { return $true }
    # Edge's TOOLBAR search box, found by live UIA probe (2026-09-08):
    #   name='Search for tools, help, and more (Alt + Q)'  class='input-337'
    # It is browser chrome, it accepts typed text, and it matches none of the
    # address-bar alternations above — so on a claude.ai tab it was being read
    # and reported as a prompt. Matched on the distinctive leading phrase rather
    # than the whole string, because the "(Alt + Q)" accelerator hint varies.
    if ($nm -match '(?i)^search for tools') { return $true }
    return $false
}

# WHY THIS IS A NAME LIST AND NOT A STRUCTURAL TEST.
#
# The obvious better idea is to ask "is the focused element inside the web
# page?" — walk up the UIA tree and require a ControlType.Document ancestor,
# since a page composer is in the document and browser chrome is not. That idea
# was implemented, probed against live browsers, and REVERTED. It does not work:
#
#   Edge toolbar search box  -> Document ancestor at depth 24
#   Excel Online 'grid'      -> Document ancestor at depth 14
#   Excel Online 'formula bar'-> Document ancestor at depth 15
#
# Edge renders parts of its OWN toolbar as web content, so browser chrome has a
# Document ancestor exactly like page content does. There is no depth bound that
# separates the two — a bound tight enough to reject Edge's toolbar (24) also
# rejects genuine composers in deeply-nested web apps, and a bound loose enough
# to keep those accepts the toolbar. The apparent success of a depth-14 bound
# was a coincidence of those two numbers, not a principle.
#
# So the name list stays, with its known cost stated plainly: these strings are
# English-UI-specific and vendor-owned, a browser build or a locale can add a
# box we do not match, and the failure mode is reading typed text from a browser
# widget while the user is on a governed AI host. The URL gate bounds the
# exposure to governed hosts only. This is the same tradeoff the catalog already
# accepts for composerNamePrefixes in ai-processes.js ("Message " is
# English-only, a non-English UI matches nothing) — documented rather than
# pretended away.


function Get-DesktopService([string]$procName) {
    $base = $procName -replace '\.exe$',''
    # 'Claude Desktop', not 'Claude' — the server needs to tell the desktop app
    # apart from claude.ai in a browser, and both arrive from the same tracker.
    if ($base -ieq 'claude') { return 'Claude Desktop' }
    return $base
}

# Cap how much text we pull from a control — a prompt box won't be huge, and
# this bounds the cost of reading a large TextPattern document.
$MaxChars = 16000

function Emit-Json($obj) {
    $line = $obj | ConvertTo-Json -Compress -Depth 5
    [Console]::Out.WriteLine($line)
    [Console]::Out.Flush()
}

function Is-AiProcess([string]$name) {
    if (-not $name) { return $false }
    $base = $name -replace '\.exe$',''
    foreach ($p in $AiProcesses) { if ($base -ieq $p) { return $true } }
    return $false
}

function Get-ForegroundProc {
    $hwnd = [CFAIP.Win32]::GetForegroundWindow()
    if ($hwnd -eq [System.IntPtr]::Zero) { return $null }
    $procId = 0
    [void][CFAIP.Win32]::GetWindowThreadProcessId($hwnd, [ref]$procId)
    if ($procId -eq 0) { return $null }
    try {
        $proc = Get-Process -Id $procId -ErrorAction Stop
        return [pscustomobject]@{ pid = $procId; process = $proc.ProcessName; hwnd = $hwnd }
    } catch { return $null }
}

# Read the editable text out of a focused UIA element. Prefers ValuePattern
# (plain textarea/input), falls back to TextPattern (contenteditable / rich
# editors, which is what Electron/Chromium expose for chat composers).
function Read-FocusedText($el) {
    if (-not $el) { return $null }
    try {
        # ValuePattern — textarea / input.
        $vp = $null
        if ($el.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$vp)) {
            $v = $vp.Current.Value
            if ($v -and $v.Length -ge 1) { return $v }
        }
    } catch {}
    try {
        # TextPattern — contenteditable / document editors.
        $tp = $null
        if ($el.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern, [ref]$tp)) {
            $range = $tp.DocumentRange
            if ($range) {
                $txt = $range.GetText($MaxChars)
                if ($txt -and $txt.Length -ge 1) { return $txt }
            }
        }
    } catch {}
    return $null
}

# Only treat an element as a prompt box if it's an editable control type. This
# avoids reading button labels, menu items, etc. that may hold focus.
# ── The BROWSER composer test: stricter than Is-EditableControl below ────────
#
# SECURITY FIX (2026-09-09, found by audit). Is-EditableControl was written for
# DESKTOP AI apps and then inherited by the browser path, where two of its rules
# are actively dangerous:
#
#   1. It accepts ControlType.Document. In a Chromium accessibility tree THE
#      PAGE ITSELF is a Document and so is the transcript pane — so clicking the
#      page background on claude.ai made "the focused editable element" the whole
#      conversation, and Read-FocusedText would return up to $MaxChars (16,000)
#      characters of it: every earlier prompt AND every model response. On a
#      pattern match that text is emitted as `content_text` and persisted
#      verbatim server-side.
#   2. Its IsPassword guard only covers the Custom/Group fallback branch, NOT
#      the Edit branch — so a web login form's password field, which reports as
#      a plain Edit, was readable.
#
# The keystroke enforcer already refuses both (it is Edit-only and checks
# IsPassword first), so the READING path was more permissive than the BLOCKING
# path — exactly backwards. This predicate brings the browser read in line with
# it and is applied ONLY to a browser foreground, so desktop-app coverage is
# byte-for-byte unchanged (an Electron composer that reports as Document still
# reads, as it always has).
#
# Fails CLOSED on a throw: an element whose ControlType or IsPassword cannot be
# read is not eligible. The cost of that is a missed prompt; the cost of the
# other direction is reading a password.
function Is-BrowserComposerElement($el, $surface) {
    if (-not $el) { return $false }
    try {
        if ($el.Current.IsPassword) { return $false }
        # The control type is CATALOG DATA, defaulting to Edit. An unknown
        # value REFUSES rather than falling back to 'any type': a surface
        # whose composer type we cannot name gets no capture, which is the
        # miss-not-leak direction every gate in this file takes.
        $wantCt = 'Edit'
        if ($surface -and ('' + $surface.composerControlType).Trim()) {
            $wantCt = ('' + $surface.composerControlType).Trim()
        }
        $ctObj = $null
        switch ($wantCt) {
            'Edit'     { $ctObj = [System.Windows.Automation.ControlType]::Edit }
            'ComboBox' { $ctObj = [System.Windows.Automation.ControlType]::ComboBox }
            'Group'    { $ctObj = [System.Windows.Automation.ControlType]::Group }
            # 'Document' IS DELIBERATELY ABSENT. On a web page that control type
            # is the RootWebArea -- the WHOLE DOCUMENT -- so accepting it would
            # read the entire page every tick instead of one composer. There is
            # an existing test asserting exactly this, and it caught the case
            # being added here by reflex while widening the set for ComboBox.
            default    { return $false }
        }
        if ($el.Current.ControlType -ne $ctObj) { return $false }
        # POSITIVE IDENTITY, not merely "an Edit that isn't chrome".
        #
        # Security audit finding 4: the structural test alone matched ANY
        # non-password Edit on a governed host -- a "Search chats" box, a rename
        # field, and most seriously an Edit inside a CROSS-ORIGIN IFRAME, since
        # the omnibox only reveals the TOP-LEVEL url. A payment iframe's
        # card-number field is an Edit, is not IsPassword, and matches no chrome
        # name, so it was read every tick and its raw value persisted.
        #
        # The composer's accessible name is live-probed per site and travels in
        # the catalog. An empty/absent name REFUSES (rather than allowing any
        # Edit): a surface whose composer has not been identified gets no
        # capture, which is the miss-not-leak direction every gate here takes.
        # THREE SHAPES, the same three the enforcer's WebSurfaceCanIdentifyComposer
        # allows, so capture and blocking agree on what "the composer" is. They
        # used to disagree: capture knew only shape (a), which silently excluded
        # every AutomationId-identified surface.
        #
        #   (a) exact composerName
        #   (b) exact composerAutomationId AND a name prefix
        #   (c) exact composerAutomationId alone -- ONLY on a url_path surface,
        #       where the agent identity comes from the URL and the element has
        #       no usable name of its own
        #
        # A surface matching none of the three REFUSES: no capture, which is the
        # miss-not-leak direction every gate in this file takes.
        $nm = ''
        try { $nm = ('' + $el.Current.Name).Trim() } catch { return $false }
        $wantName = ''
        $wantAid  = ''
        $prefixes = @()
        $mode     = ''
        if ($surface) {
            $wantName = ('' + $surface.composerName).Trim()
            $wantAid  = ('' + $surface.composerAutomationId).Trim()
            $prefixes = @($surface.composerNamePrefixes | Where-Object { $_ })
            $mode     = ('' + $surface.agentReadMode).Trim()
        }
        # (a) -- an exact name is sufficient on its own.
        if ($wantName) { return ($nm -ieq $wantName) }
        # Both remaining shapes REQUIRE the AutomationId, exactly.
        if (-not $wantAid) { return $false }
        $aid = ''
        try { $aid = ('' + $el.Current.AutomationId).Trim() } catch { return $false }
        if ($aid -cne $wantAid) { return $false }
        # (b) -- AutomationId plus a name prefix.
        if ($prefixes.Count -gt 0) {
            foreach ($pfx in $prefixes) {
                $p2 = ('' + $pfx)
                if ($p2 -and $nm.Length -ge $p2.Length -and
                    $nm.Substring(0, $p2.Length) -ieq $p2) { return $true }
            }
            return $false
        }
        # (c) -- AutomationId alone, and ONLY where the agent identity comes from
        # the URL instead of the element.
        return ($mode -ieq 'url_path')
    } catch { return $false }
}

# ── Does this element actually belong to the foreground app? ──────────────────
#
# SECURITY FIX (2026-09-09, found by audit). `AutomationElement::FocusedElement`
# is a GLOBAL read: it routinely returns an element belonging to a DIFFERENT
# window in a DIFFERENT process from the one in the foreground. enforcer-win.ps1
# calls its own equivalent of this check non-negotiable for exactly that
# measured reason.
#
# This watcher had no such check. So while a browser was foreground on a
# governed host, a stolen focused element from Outlook, Teams, a password
# manager or Notepad could be read, DLP-scanned, and — on a pattern match —
# emitted verbatim as `content_text` mislabelled as an AI prompt on claude.ai.
# Pre-existing for AI processes, but a browser is in the foreground far more
# often than Claude Desktop is, so extending capture to browsers multiplied how
# often the window is open.
#
# A Chromium page element belongs to a RENDERER child process, not to the
# browser process itself, so an exact pid match is not enough — the parent pid
# is accepted too, mirroring the enforcer. One level only: a grandchild is not
# accepted, because that would re-admit an arbitrary process launched by the
# browser.
#
# Fails CLOSED: a pid that cannot be read, or a parent lookup that fails, means
# the element is not eligible. Cost is a missed prompt.
function Get-ParentPid([int]$procId) {
    try {
        $p = Get-CimInstance Win32_Process -Filter "ProcessId=$procId" -ErrorAction Stop
        if ($p -and $p.ParentProcessId) { return [int]$p.ParentProcessId }
    } catch {}
    return -1
}

function Element-BelongsToForeground($el, [int]$fgPid) {
    if (-not $el) { return $false }
    if ($fgPid -le 0) { return $false }
    $elPid = -1
    try { $elPid = [int]$el.Current.ProcessId } catch { return $false }
    if ($elPid -le 0) { return $false }
    if ($elPid -eq $fgPid) { return $true }
    return ((Get-ParentPid $elPid) -eq $fgPid)
}

function Is-EditableControl($el) {
    try {
        $ct = $el.Current.ControlType
        if ($ct -eq [System.Windows.Automation.ControlType]::Edit)     { return $true }
        if ($ct -eq [System.Windows.Automation.ControlType]::Document) { return $true }
        # Some editors report as Custom/Group but still expose a keyboard caret.
        if ($el.Current.IsKeyboardFocusable -and -not $el.Current.IsPassword) {
            $tp = $null
            if ($el.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern, [ref]$tp)) { return $true }
            $vp = $null
            if ($el.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$vp)) { return $true }
        }
    } catch {}
    return $false
}

# ── Recipient DOMAINS, and nothing else ─────────────────────────────────────
#
# Reduce an arbitrary recipient string to bare @domain tokens, de-duplicated,
# capped. PURE, no I/O, never throws — the input comes from another process's
# accessibility tree and can be anything.
#
# THE PRIVACY CONTRACT, stated where it is enforced: the value that reaches an
# event is "@gmail.com", never "someone@gmail.com" and never a display name. The
# local part is dropped here, character-wise, before the value is returned — so
# the caller has no way to obtain it even by accident, and there is no code path
# on which a full address is emitted, logged or persisted.
#
# The cap exists because a To/Cc field can legitimately hold dozens of
# recipients, and a governance record needs to know WHICH DOMAINS were involved,
# not to enumerate a distribution list.
$EgressMaxDomains = 8
function Get-DomainsOnly([string]$raw) {
    $out = New-Object System.Collections.Generic.List[string]
    if (-not $raw) { return ,$out.ToArray() }
    try {
        # Bound the work before touching it: this string is whatever the app's
        # accessibility tree reports.
        $s = $raw
        if ($s.Length -gt 4000) { $s = $s.Substring(0, 4000) }
        foreach ($m in [regex]::Matches($s, '@([A-Za-z0-9]([A-Za-z0-9-]{0,62}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,62}[A-Za-z0-9])?)+)')) {
            $d = '@' + $m.Groups[1].Value.ToLowerInvariant()
            if (-not $out.Contains($d)) { $out.Add($d) | Out-Null }
            if ($out.Count -ge $EgressMaxDomains) { break }
        }
    } catch {}
    return ,$out.ToArray()
}

# Read the To/Cc field of the compose window and return DOMAINS ONLY.
#
# The full recipient string exists as `$v` inside this function and nowhere else:
# it is handed straight to Get-DomainsOnly, whose return value is the only thing
# that escapes. It is never assigned to a script-scope variable, never emitted
# and never logged.
#
# $null recipientSig (every EGRESS_SURFACES entry as shipped, pending its live
# UIA probe) means no recipient read happens at all and the event carries an
# empty domain list. That is the honest outcome: "we do not know where it went"
# is a different and better claim than a guessed domain.
function Get-EgressRecipientDomains($windowElement, $sig) {
    $none = New-Object System.Collections.Generic.List[string]
    if (-not $sig -or -not $windowElement -or -not $sig.controlType) { return ,$none.ToArray() }
    try {
        $cond = New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
            [System.Windows.Automation.ControlType]::Edit)
        $edits = $windowElement.FindAll([System.Windows.Automation.TreeScope]::Descendants, $cond)
        foreach ($e in $edits) {
            $nm = ''; $cls = ''
            try { $nm  = ('' + $e.Current.Name).Trim() } catch {}
            try { $cls = ('' + $e.Current.ClassName).Trim() } catch {}
            $hit = $false
            if ($sig.nameEquals  -and $nm  -and ($nm  -ieq ('' + $sig.nameEquals)))  { $hit = $true }
            if ($sig.classEquals -and $cls -and ($cls -ieq ('' + $sig.classEquals))) { $hit = $true }
            if ($sig.namePrefix  -and $nm  -and $nm.StartsWith(('' + $sig.namePrefix),  'OrdinalIgnoreCase')) { $hit = $true }
            if ($sig.classPrefix -and $cls -and $cls.StartsWith(('' + $sig.classPrefix), 'OrdinalIgnoreCase')) { $hit = $true }
            if (-not $hit) { continue }
            $v = Read-FocusedText $e
            # REDUCED IN THE SAME EXPRESSION THAT READS IT. $v goes out of scope
            # with the function; only domains are returned.
            return ,(Get-DomainsOnly $v)
        }
    } catch {}
    return ,$none.ToArray()
}

# ai_count is emitted alongside the list because ConvertTo-Json collapses a
# single-element array to a bare string, which made the consumer log a string
# length instead of a process count.
Load-EgressSurfaces
Emit-Json @{
    kind         = 'ready'
    pid          = $PID
    ai_processes = $AiProcesses
    ai_count     = @($AiProcesses).Count
    tracker      = $TrackerMode
    # Counts only — the signatures themselves are never echoed back.
    ide_count    = @($IdeProcesses).Count
    panel_count  = @($Panels).Count
    # How many egress surfaces are armed with a usable body signature. Zero as
    # shipped (every bodySig is null pending a live probe), and zero on any
    # machine whose admin governs no mail host.
    egress_count = $EgressBodyIds.Count
    # A web_count of 0 is the diagnostic that matters: it means no browser
    # window can be read at all, so browser AI usage going unseen has an
    # explanation in the log rather than looking like a broken URL read. Same
    # reasoning as panel_count. A COUNT, never the host list.
    web_count    = @($WebSurfaces).Count
    browser_count = @($BrowserProcesses).Count
}

# ── EGRESS send-transition state ────────────────────────────────────────────
#
# Keyed on the COMPOSE WINDOW handle, not the process: a user can have several
# draft windows open at once in Outlook, and one slot per process would make the
# second draft overwrite the first (losing it entirely) and then attribute
# whichever text survived to whichever window closed first.
#
# Value: @{ Text; Truncated; Domains; Surface; Process; Pid; Hwnd }. Hwnd is not
# decoration: it is what the window-closed sweep below tests with IsWindow, so a
# slot written without it would never reach transition 2 and its body would sit
# in this table until the helper exits.
#
# The body text is held here between the last tick that saw it and the send that
# consumes it. It is never written to disk and never logged; the ONE place it
# leaves this process is the single egress_body line emitted at the transition.
$EgressBody = @{}

# Per-process last text we emitted — only emit on change, so we don't spam a
# line every tick while the user pauses. Node dedupes further by match set.
$LastTextByProc = @{}
$tick = 0

# Emit the one egress_body record for a compose window and forget it.
#
# The SINGLE emit site for this arm, so "exactly once per email" is a property of
# there being one function that also deletes the slot, rather than a rule two
# call sites have to remember. Called from the two send transitions (body goes
# empty; window closes) and from nowhere else.
function Emit-EgressBody([string]$key) {
    $held = $script:EgressBody[$key]
    $script:EgressBody.Remove($key)      # BEFORE the emit: an exception below
                                         # must not leave a slot that emits again
    if (-not $held) { return }
    $text = [string]$held.Text
    if (-not $text -or $text.Length -lt 2) { return }
    Emit-Json @{
        t       = (Get-Date).ToUniversalTime().ToString('o')
        kind    = 'egress_body'
        surface = [string]$held.Surface
        process = [string]$held.Process
        pid     = $held.Pid
        text    = $text
        len     = $text.Length
        # Did the read hit $MaxChars? The Node side puts this on the record so a
        # preview is never presented as the whole message.
        truncated = [bool]$held.Truncated
        # DOMAINS ONLY — see Get-EgressRecipientDomains. Never a full address,
        # and there is no field here for a subject line because the subject is
        # never read by any path.
        recipient_domains = @($held.Domains)
    }
}

while ($true) {
    $tick++
    # Re-read the egress policy on roughly the sync's own 10s cadence. Outside
    # the try below so a policy read is never reported as a main_loop error;
    # Load-EgressSurfaces swallows its own failures into "nothing armed".
    if ($tick % $EgressReloadTicks -eq 0) { Load-EgressSurfaces }

    # ── EGRESS: capture the compose body ONCE, at the send transition ────────
    #
    # Its own try/catch and its own state — an exception here must not cost the
    # AI arms below their tick, and nothing here can reach them.
    try {
        # TRANSITION 2 FIRST: a compose window that no longer exists was sent (or
        # discarded — indistinguishable from outside the app, and the honest
        # reading is that a message whose body held a critical pattern and whose
        # window then vanished is worth a record either way). Swept on EVERY
        # tick, whatever has the foreground, because by definition the window is
        # gone and will never be the foreground again.
        foreach ($k in @($EgressBody.Keys)) {
            $held = $EgressBody[$k]
            $h = [System.IntPtr]$held.Hwnd
            if ($h -ne [System.IntPtr]::Zero -and [CFAIE.Win32]::IsWindow($h)) { continue }
            Emit-EgressBody $k
        }

        $fgE = Get-ForegroundProc
        if ($fgE) {
            $base = ($fgE.process -replace '\.exe$','')
            $surface = $EgressBySig[$base.ToLowerInvariant()]
            # GATE 1+2: policy armed this process, and the surface opts into body
            # capture. Both false for every process on a machine with no egress
            # policy, so the read below never happens there.
            if ($surface -and $surface.CaptureBody -eq 'full' -and $EgressBodyIds.Count -gt 0) {
                $focused = $null
                try { $focused = [System.Windows.Automation.AutomationElement]::FocusedElement } catch {}
                if ($focused -and (Is-EditableControl $focused)) {
                    # GATE 3: the FOCUSED ELEMENT must match the compose-body
                    # signature, through the existing Match-PanelSignature. The
                    # caret being somewhere in Outlook is not evidence.
                    $ctName = ''; $nm = ''; $cls = ''
                    try {
                        $pn = '' + $focused.Current.ControlType.ProgrammaticName
                        $ctName = $pn.Substring($pn.LastIndexOf('.') + 1)
                    } catch {}
                    try { $nm  = '' + $focused.Current.Name } catch {}
                    try { $cls = '' + $focused.Current.ClassName } catch {}
                    $matchedId = Match-PanelSignature $base $ctName $nm $cls
                    # …and the match must be an EGRESS BODY, not an AI panel that
                    # happens to share the table. See $EgressBodyIds.
                    if ($matchedId -and $EgressBodyIds.Contains($matchedId)) {
                        $key = 'egress|' + $fgE.hwnd.ToString()
                        $text = Read-FocusedText $focused
                        $truncated = $false
                        if ($text -and $text.Length -gt $MaxChars) {
                            # The SAME 16000 cap every other read in this file
                            # uses, deliberately not raised for email: it bounds
                            # the cost of a TextPattern read of a large document
                            # and the size of what crosses the pipe.
                            $text = $text.Substring(0, $MaxChars)
                            $truncated = $true
                        }
                        if ($text -and $text.Length -ge 2) {
                            # STILL COMPOSING. Remember the latest text — and
                            # emit NOTHING. This is the whole difference between
                            # one record per email and ~100 growing-prefix
                            # records per email.
                            $prev = $EgressBody[$key]
                            $domains = if ($prev) { @($prev.Domains) } else { @() }
                            # Read the recipients at most once per draft: the
                            # field is stable while composing, and a
                            # descendant-wide UIA search per tick is exactly the
                            # cost UpdateSendRect refuses to pay for a host app.
                            if (-not $prev -or @($domains).Count -eq 0) {
                                $win = $null
                                try { $win = [System.Windows.Automation.AutomationElement]::FromHandle($fgE.hwnd) } catch {}
                                if ($win) { $domains = @(Get-EgressRecipientDomains $win $surface.RecipientSig) }
                            }
                            $EgressBody[$key] = @{
                                Text = $text; Truncated = $truncated; Domains = $domains
                                Surface = [string]$surface.Id; Process = $fgE.process
                                Pid = $fgE.pid; Hwnd = $fgE.hwnd
                            }
                        } elseif ($EgressBody.ContainsKey($key)) {
                            # TRANSITION 1: the body went non-empty -> empty. The
                            # message was sent. Exactly the signal tracker mode
                            # already uses for a chat composer, applied to a
                            # compose body.
                            Emit-EgressBody $key
                        }
                    }
                }
            }
        }
    } catch {
        Emit-Json @{ t = (Get-Date).ToUniversalTime().ToString('o'); kind = 'error'; message = $_.Exception.Message; where = 'egress_arm' }
    }

    try {
        $fg = Get-ForegroundProc

        if ($TrackerMode) {
            # ── Claude tracker: resolve the surface FIRST, then read text ──────
            $service = $null
            $isBrowserFg = $false
            if ($fg) {
                if (Is-BrowserProcess $fg.process) {
                    $isBrowserFg = $true
                    $service = Classify-ClaudeUrl (Get-BrowserUrlCached $fg.hwnd)
                } elseif (Is-AiProcess $fg.process) {
                    $service = Get-DesktopService $fg.process
                }
            }

            if ($service) {
                $focused = $null
                try { $focused = [System.Windows.Automation.AutomationElement]::FocusedElement } catch {}
                # The panel gate applies here too: an IDE's code editor going
                # from non-empty to empty is not a prompt submit, so reading it
                # would invent usage as well as read source.
                $gate = Get-CaptureGate $focused $fg.process
                # Browser chrome is never a composer. Applied only to a browser
                # foreground so a desktop app whose composer Name cannot be read
                # keeps behaving exactly as it did before this gate existed.
                # TRACKER MODE ONLY. The composer-IDENTITY gate is deliberately NOT
                # applied here: this branch resolves its surface with
                # Classify-ClaudeUrl (claude.ai only) and has no $webSurface, and it
                # reports LENGTH ONLY -- no text is ever emitted or persisted, so the
                # finding-4 harm (a card number from a payment iframe reaching
                # dlp_content) cannot occur on this path. The chrome-name exclusion
                # and the pid check DO apply, since both are pure improvements. This
                # keeps the shipped Claude tracker byte-for-byte in behaviour.
                $chromeBlocked = $isBrowserFg -and ((Is-BrowserChromeElement $focused) -or -not (Element-BelongsToForeground $focused $fg.pid))
                if ($focused -and (Is-EditableControl $focused) -and $gate.allowed -and -not $chromeBlocked) {
                    $text = Read-FocusedText $focused
                    if ($text -and $text.Length -gt $MaxChars) { $text = $text.Substring(0, $MaxChars) }
                    $key = "$($fg.process)|$service"
                    $prev = $LastTextByProc[$key]

                    if ($text -and $text.Length -ge 2) {
                        # Still composing — remember it so we can size the prompt on submit.
                        if ($text -ne $prev) { $LastTextByProc[$key] = $text }
                    } elseif ($prev) {
                        # Composer went from non-empty to empty: the prompt was sent.
                        # We report only its LENGTH, never the text.
                        $LastTextByProc.Remove($key)
                        Emit-Json @{
                            t       = (Get-Date).ToUniversalTime().ToString('o')
                            kind    = 'prompt_submit'
                            pid     = $fg.pid
                            process = $fg.process
                            service = $service
                            len     = $prev.Length
                        }
                    }
                }
            }

            if ($tick % 50 -eq 0) {
                Emit-Json @{ t = (Get-Date).ToUniversalTime().ToString('o'); kind = 'heartbeat'; tick = $tick }
            }
            Start-Sleep -Milliseconds 1200
            continue
        }

        # ── Resolve the browser surface FIRST, before any text box is touched ──
        #
        # Same ordering discipline as the tracker branch, and for the same
        # reason: on a browser foreground the URL decides whether we are allowed
        # to look at the focused element AT ALL. A Gmail, Jira or Confluence
        # composer must never be read, so "is this a governed AI host" is
        # answered before "what is in the text box", never after.
        #
        # $null (unknown or non-AI host) means the browser is treated as not an
        # AI surface — no capture. That is the fail-open direction the design
        # settled on, and here capture and blocking agree: reading an unknown
        # tab would be the privacy leak, blocking it would freeze Enter in Gmail.
        $webSurface = $null
        $isBrowserFg = $false
        if ($fg -and (Is-BrowserProcess $fg.process)) {
            $isBrowserFg = $true
            $webSurface = Classify-WebSurface (Get-BrowserUrlCached $fg.hwnd)
        }

        if ($fg -and ((Is-AiProcess $fg.process) -or $webSurface)) {
            $focused = $null
            try { $focused = [System.Windows.Automation.AutomationElement]::FocusedElement } catch {}
            # Panel gate BEFORE Read-FocusedText: in an IDE, "the focused
            # editable element" is a source file or a terminal far more often
            # than it is an AI composer, and reading one character of it would
            # already be the leak. Non-IDE apps are unaffected (allowed = true).
            $gate = Get-CaptureGate $focused $fg.process
            # And in a browser, "the focused editable element" is the ADDRESS BAR
            # far more often than people assume. See Is-BrowserChromeElement.
            $chromeBlocked = $isBrowserFg -and ((Is-BrowserChromeElement $focused) -or -not (Is-BrowserComposerElement $focused $webSurface) -or -not (Element-BelongsToForeground $focused $fg.pid))
            if ($focused -and (Is-EditableControl $focused) -and $gate.allowed -and -not $chromeBlocked) {
                $text = Read-FocusedText $focused
                if ($text) {
                    if ($text.Length -gt $MaxChars) { $text = $text.Substring(0, $MaxChars) }
                    # Keyed per panel as well as per process: two panels can live
                    # in one IDE, and sharing a dedup key across them would drop
                    # the second one's first prompt. A browser is keyed per HOST
                    # for the same reason — one chrome.exe serves every surface,
                    # so a process-only key would let a claude.ai prompt suppress
                    # an identical first prompt on chatgpt.com.
                    $key = if ($webSurface) { "$($fg.process)|$($webSurface.host)" }
                           elseif ($gate.panel) { "$($fg.process)|$($gate.panel)" }
                           else { $fg.process }
                    $last = $LastTextByProc[$key]
                    if ($text.Length -ge 4 -and $text -ne $last) {
                        $LastTextByProc[$key] = $text
                        # The element Name is a useful label for a desktop app
                        # ("Message Claude") but on a web page it is
                        # site-authored and can carry the document or
                        # conversation title, so it is NOT collected for a
                        # browser surface. Nothing downstream needs it there:
                        # the product comes from the catalog, not the label.
                        $title = $null
                        if (-not $isBrowserFg) {
                            try { $title = $focused.Current.Name } catch {}
                        }
                        Emit-Json @{
                            t       = (Get-Date).ToUniversalTime().ToString('o')
                            kind    = 'prompt_text'
                            pid     = $fg.pid
                            process = $fg.process
                            title   = $title
                            text    = $text
                            len     = $text.Length
                            # A catalog id ('' for a non-IDE app), so index.js can
                            # attribute an in-IDE prompt to the panel's product
                            # (Claude Code) instead of the host editor (Cursor).
                            panel   = $gate.panel
                            # THE CATALOG-MATCHED HOST ONLY — never the URL, never
                            # a path, never a query string. index.js uses it to
                            # attribute the prompt to the right product and to
                            # set tab_host on the event. '' for a desktop app,
                            # so every existing consumer is unchanged.
                            browser_host = if ($webSurface) { '' + $webSurface.host } else { '' }
                            service      = if ($webSurface) { '' + $webSurface.product } else { '' }
                        }
                    }
                }
            }
        }

        if ($tick % 50 -eq 0) {
            Emit-Json @{ t = (Get-Date).ToUniversalTime().ToString('o'); kind = 'heartbeat'; tick = $tick }
        }
    } catch {
        Emit-Json @{ t = (Get-Date).ToUniversalTime().ToString('o'); kind = 'error'; message = $_.Exception.Message; where = 'main_loop' }
    }

    Start-Sleep -Milliseconds 1200
}

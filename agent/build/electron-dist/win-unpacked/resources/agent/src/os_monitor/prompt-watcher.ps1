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
if (@($IdeProcesses).Count -eq 0) { $IdeProcesses = @('Code', 'Cursor') }

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

# ai_count is emitted alongside the list because ConvertTo-Json collapses a
# single-element array to a bare string, which made the consumer log a string
# length instead of a process count.
Emit-Json @{
    kind         = 'ready'
    pid          = $PID
    ai_processes = $AiProcesses
    ai_count     = @($AiProcesses).Count
    tracker      = $TrackerMode
    # Counts only — the signatures themselves are never echoed back.
    ide_count    = @($IdeProcesses).Count
    panel_count  = @($Panels).Count
}

# Per-process last text we emitted — only emit on change, so we don't spam a
# line every tick while the user pauses. Node dedupes further by match set.
$LastTextByProc = @{}
$tick = 0

while ($true) {
    $tick++
    try {
        $fg = Get-ForegroundProc

        if ($TrackerMode) {
            # ── Claude tracker: resolve the surface FIRST, then read text ──────
            $service = $null
            if ($fg) {
                if (Is-BrowserProcess $fg.process) {
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
                if ($focused -and (Is-EditableControl $focused) -and $gate.allowed) {
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

        if ($fg -and (Is-AiProcess $fg.process)) {
            $focused = $null
            try { $focused = [System.Windows.Automation.AutomationElement]::FocusedElement } catch {}
            # Panel gate BEFORE Read-FocusedText: in an IDE, "the focused
            # editable element" is a source file or a terminal far more often
            # than it is an AI composer, and reading one character of it would
            # already be the leak. Non-IDE apps are unaffected (allowed = true).
            $gate = Get-CaptureGate $focused $fg.process
            if ($focused -and (Is-EditableControl $focused) -and $gate.allowed) {
                $text = Read-FocusedText $focused
                if ($text) {
                    if ($text.Length -gt $MaxChars) { $text = $text.Substring(0, $MaxChars) }
                    # Keyed per panel as well as per process: two panels can live
                    # in one IDE, and sharing a dedup key across them would drop
                    # the second one's first prompt.
                    $key = if ($gate.panel) { "$($fg.process)|$($gate.panel)" } else { $fg.process }
                    $last = $LastTextByProc[$key]
                    if ($text.Length -ge 4 -and $text -ne $last) {
                        $LastTextByProc[$key] = $text
                        $title = $null
                        try { $title = $focused.Current.Name } catch {}
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

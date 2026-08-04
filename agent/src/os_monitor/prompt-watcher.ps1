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
# Runs as a separate STA helper alongside win-poller.ps1. Output schema:
#   {"kind":"ready"}
#   {"kind":"prompt_text","process":"claude","pid":1234,"title":"Claude","text":"...","len":42}
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
Emit-Json @{ kind = 'ready'; pid = $PID; ai_processes = $AiProcesses; ai_count = @($AiProcesses).Count; tracker = $TrackerMode }

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
                if ($focused -and (Is-EditableControl $focused)) {
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
            if ($focused -and (Is-EditableControl $focused)) {
                $text = Read-FocusedText $focused
                if ($text) {
                    if ($text.Length -gt $MaxChars) { $text = $text.Substring(0, $MaxChars) }
                    $key = $fg.process
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

# Harness for "MODEL ROUTING CAN NEVER GET STUCK" (enforcer-win.ps1).
#
# Live evidence (2026-10-06, agent 35d74860, desktop agent web arm, no extension):
#   07:24:11Z gemini.google.com failed complex 3.5 Flash-Lite -> 3.1 Pro  "not_submitted"
#   05:58:03Z gemini failed interrupted_after_expand_no_fallback_navigated
#   User: "it just opens the model window but doesn't change, and gets stuck there."
#
# Every stuck mode is driven through the REAL C# (lifted out of the .ps1 and
# compiled, called by reflection), with scripted worlds and fake clocks for the
# pure loops, and real threads for the watchdog:
#   1. RouteFocusGate   -- the pre-Enter gate (menu never closes, Material's
#                          focus hand-back to the trigger, a refocus that opened
#                          the menu, an upsell/limit dialog holding focus, ...)
#   2. RouteAfterEnter  -- after the ONE Enter (sent; Enter landed on the
#                          picker trigger and reopened the menu; switch landed
#                          but the page would not send; ...)
#   3. RouteClickInto's point choice -- Gemini's picker at the composer's right
#   4. The watchdog     -- a UIA call that hangs past the budget, an exception
#                          mid-route, a hang AFTER the send, a fast route; the
#                          hook's own staleness backstop.
#
# NOTHING HERE INSTALLS A HOOK, presses a key or touches a real window: every
# run's Hwnd is IntPtr.Zero, so the watchdog's cleanup refuses at its very first
# check (the foreground is never window 0).
#
# Output: one NDJSON line per observation (`t` field). Ends with {"t":"done"}.
param(
  [Parameter(Mandatory=$true)][string]$Ps1,
  [Parameter(Mandatory=$true)][string]$Catalog
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

$raw = Get-Content -Raw -LiteralPath $Ps1
$startIdx = $raw.IndexOf("`$source = @'")
if ($startIdx -lt 0) { throw 'could not find the $source here-string in enforcer-win.ps1' }
$bodyStart = $raw.IndexOf("`n", $startIdx) + 1
$endIdx = $raw.IndexOf("`n'@", $bodyStart)
if ($endIdx -lt 0) { throw 'could not find the end of the $source here-string' }
$source = $raw.Substring($bodyStart, $endIdx - $bodyStart)

# Route-thread BODIES for the watchdog cases. They must be C#: a PowerShell
# scriptblock cannot run on a thread without a runspace. They reach the
# enforcer's private statics by reflection, exactly as the harness does.
$bodies = @'
public static class RouteHarnessBodies
{
    static readonly System.Reflection.BindingFlags F =
        System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Static;
    static object Call(string n, params object[] a)
    {
        var m = typeof(CfaiEnforcer).GetMethod(n, F);
        try { return m.Invoke(null, a); }
        catch (System.Reflection.TargetInvocationException e) { throw e.InnerException; }
    }
    static void Emit(string result, string reason)
    {
        Call("EmitRoute", "gemini", "google", "economy", "premium", "3.1 Pro", "complex", result, 10, reason,
            System.Type.Missing, System.Type.Missing, System.Type.Missing);
    }
    static readonly object _lock = new object();
    static System.Text.StringBuilder _log = new System.Text.StringBuilder();
    static void Log(string s) { lock (_lock) { _log.Append(s).Append(';'); } }
    public static string TakeLog() { lock (_lock) { string s = _log.ToString(); _log.Clear(); return s; } }

    // A UIA call that never comes back within the budget (the switch wait),
    // then the thread wakes up and tries to finish the route as if nothing
    // happened: claim the send, report.
    public static System.Action HangThenTrySend(int hangMs)
    {
        return () =>
        {
            Call("RouteCheckpoint", "await_switch");
            System.Threading.Thread.Sleep(hangMs);
            bool claimed = (bool)Call("RouteClaimSend");
            Log(claimed ? "sent" : "send_refused");
            bool owned = (bool)Call("RouteOwned");
            Log(owned ? "owned" : "not_owned");
            Emit(claimed ? "ok" : "failed", claimed ? null : "zombie_report");
            try { Call("RouteCheckpoint", "after_hang"); Log("checkpoint_passed"); }
            catch (System.Exception ex) { Log("checkpoint_threw_" + ex.GetType().Name); throw; }
        };
    }

    // An exception in the middle of the route that nothing inside catches.
    public static System.Action ThrowsMidRoute()
    {
        return () =>
        {
            Call("RouteCheckpoint", "select");
            throw new System.InvalidOperationException("boom");
        };
    }

    // The send is claimed (the Enter went out), then the post-send read-back
    // hangs past the budget.
    public static System.Action SendThenHang(int hangMs)
    {
        return () =>
        {
            bool claimed = (bool)Call("RouteClaimSend");
            Log(claimed ? "sent" : "send_refused");
            System.Threading.Thread.Sleep(hangMs);
            Emit("ok", null);
        };
    }

    // A route that just works, well inside the budget.
    public static System.Action Fast()
    {
        return () =>
        {
            Call("RouteCheckpoint", "await_switch");
            bool claimed = (bool)Call("RouteClaimSend");
            Log(claimed ? "sent" : "send_refused");
            Emit("ok", null);
            bool second = (bool)Call("RouteClaimSend");
            Log(second ? "second_send_claimed" : "second_send_refused");
            Emit("ok", "duplicate_report");
        };
    }
}
'@

Add-Type -TypeDefinition ($source + "`n" + $bodies) -ReferencedAssemblies @(
    'System.Windows.Forms','UIAutomationClient','UIAutomationTypes','WindowsBase','System.Web.Extensions'
) -ErrorAction Stop

$T = [CfaiEnforcer]
$FLAGS = [System.Reflection.BindingFlags]'NonPublic,Public,Static'
function GetF([string]$n) { $f = $T.GetField($n, $FLAGS); if (-not $f) { throw "no field $n" }; $f.GetValue($null) }
function SetF([string]$n, $v) { $f = $T.GetField($n, $FLAGS); if (-not $f) { throw "no field $n" }; $f.SetValue($null, $v) }
function Has([string]$n) { return [bool]($T.GetMethod($n, $FLAGS)) }
function Call([string]$n, [object[]]$a = @()) {
  $m = $T.GetMethod($n, $FLAGS)
  if (-not $m) { throw "no method $n" }
  # Unwrap PowerShell's PSObject wrappers (a List built in a function comes
  # back wrapped, and reflection cannot convert the wrapper).
  $args2 = New-Object 'object[]' $a.Count
  for ($i = 0; $i -lt $a.Count; $i++) { $v = $a[$i]; if ($null -ne $v) { $v = $v.psobject.BaseObject }; $args2[$i] = $v }
  try { return $m.Invoke($null, $args2) } catch { throw $_.Exception.InnerException }
}
function Emit($obj) { [Console]::Out.WriteLine(($obj | ConvertTo-Json -Compress -Depth 6)); [Console]::Out.Flush() }
function Nested([string]$n) { $t = $T.GetNestedType($n, $FLAGS); if (-not $t) { throw "no nested type $n" }; $t }
function SetDel($type, $obj, [string]$field, [scriptblock]$sb) {
  $f = $type.GetField($field)
  $f.SetValue($obj, [System.Management.Automation.LanguagePrimitives]::ConvertTo($sb, $f.FieldType))
}

$catalogJson = [System.IO.File]::ReadAllText($Catalog)
$ser = New-Object System.Web.Script.Serialization.JavaScriptSerializer
$ser.MaxJsonLength = 5 * 1024 * 1024
SetF '_mrCatalog' ($ser.DeserializeObject($catalogJson))

foreach ($n in @('RouteFocusGate', 'RouteAfterEnter', 'RoutePostSendVerdict', 'RouteResendAllowed', 'RouteClickCandidates',
                 'RouteHitIsComposer', 'RouteClaimSend', 'RouteClaimResend', 'RouteCheckpoint', 'RouteOwned',
                 'StartRouteThread', 'RouteWatchdogFire', 'RouteStale', 'RouteInProgressLive', 'RouteRelease')) {
  Emit @{ t = 'has'; name = $n; present = (Has $n) }
}

# ---- 1. the pre-Enter FOCUS GATE ---------------------------------------------
# The world: a menu with `menu` open levels, the focus `focus` ('composer' |
# 'trigger' | 'menu' | 'dialog' | 'edited'), and scripted reactions.
$gIo = Nested 'RouteGateIo'
$gOut = Nested 'RouteGateOutcome'
function RunGate([string]$case, [hashtable]$world) {
  $script:G = @{
    now = 0; window = $true; menu = 0; escapeCloses = $true; focus = 'composer';
    handBackAfterSettle = 0;       # how many times focus jumps to the trigger right after a settle
    refocusWorks = $true; refocusOpensMenu = 0; dialog = $false; dismissCloses = $true;
    collapses = 0; refocuses = 0; dismissals = 0; settles = 0
  }
  foreach ($k in $world.Keys) { $script:G[$k] = $world[$k] }
  $io = [Activator]::CreateInstance($gIo, $true)
  SetDel $gIo $io 'WindowOk' { [bool]$script:G.window }
  SetDel $gIo $io 'MenuOpen' { [bool]($script:G.menu -gt 0) }
  SetDel $gIo $io 'CollapseMenu' {
    $script:G.collapses++
    if ($script:G.escapeCloses) { $script:G.menu = 0; if ($script:G.focus -eq 'menu') { $script:G.focus = 'trigger' }; return $null }
    return 'menu_still_open'
  }
  SetDel $gIo $io 'FocusVerdict' {
    switch ($script:G.focus) { 'composer' { return $null } 'edited' { return 'text_changed' } default { return 'focus_not_in_composer' } }
  }
  SetDel $gIo $io 'DialogHoldsFocus' { [bool]($script:G.dialog -and $script:G.focus -eq 'dialog') }
  SetDel $gIo $io 'DismissDialog' { $script:G.dismissals++; if ($script:G.dismissCloses) { $script:G.dialog = $false; $script:G.focus = 'trigger' } }
  SetDel $gIo $io 'Refocus' {
    $script:G.refocuses++
    if ($script:G.focus -eq 'edited') { return 'text_changed' }
    if ($script:G.dialog) { return 'focus_not_in_composer' }   # a modal dialog intercepts the click
    if ($script:G.refocusOpensMenu -gt 0) { $script:G.refocusOpensMenu--; $script:G.menu = 1 }
    if ($script:G.refocusWorks) { $script:G.focus = 'composer'; return $null }
    return 'focus_not_in_composer'
  }
  SetDel $gIo $io 'Sleep' {
    param([int]$ms)
    $script:G.now += $ms
    if ($ms -eq 150) {
      $script:G.settles++
      if ($script:G.handBackAfterSettle -gt 0 -and $script:G.focus -eq 'composer') { $script:G.handBackAfterSettle--; $script:G.focus = 'trigger' }
    }
  }
  $o = Call 'RouteFocusGate' @($io)
  $ok = [bool]$gOut.GetField('Ok').GetValue($o)
  Emit @{ t = 'gate'; case = $case; ok = $ok; reason = [string]$gOut.GetField('Reason').GetValue($o);
          collapses = $script:G.collapses; refocuses = $script:G.refocuses; dismissals = $script:G.dismissals;
          settles = $script:G.settles; menuOpenAtEnd = ($script:G.menu -gt 0); focusAtEnd = [string]$script:G.focus;
          elapsed = $script:G.now; enters = $(if ($ok) { 1 } else { 0 }) }
}
RunGate 'focus_ok_stable'           @{ }
RunGate 'menu_left_open_closes'     @{ menu = 1; focus = 'menu'; }
RunGate 'menu_never_closes'         @{ menu = 1; focus = 'menu'; escapeCloses = $false }
RunGate 'material_handback'         @{ handBackAfterSettle = 1 }
RunGate 'handback_every_time'       @{ handBackAfterSettle = 99 }
RunGate 'refocus_opened_the_menu'   @{ focus = 'trigger'; refocusOpensMenu = 1 }
RunGate 'upsell_dialog_holds_focus' @{ focus = 'dialog'; dialog = $true }
RunGate 'dialog_will_not_close'     @{ focus = 'dialog'; dialog = $true; dismissCloses = $false }
RunGate 'user_edited'               @{ focus = 'edited' }
RunGate 'window_changed'            @{ window = $false; menu = 1 }
RunGate 'focus_never_returns'       @{ focus = 'trigger'; refocusWorks = $false }

# ---- 2. after the ONE Enter --------------------------------------------------
$aIo = Nested 'RouteAfterEnterIo'
$aOut = Nested 'RouteAfterEnterOutcome'
$gateOk = [Activator]::CreateInstance($gOut, $true); $gOut.GetField('Ok').SetValue($gateOk, $true)
$gateNo = [Activator]::CreateInstance($gOut, $true); $gOut.GetField('Reason').SetValue($gateNo, 'focus_not_in_composer')
function RunAfter([string]$case, [hashtable]$world) {
  # enterGoes: what each Enter does, in order: 'send' | 'menu' (opens the menu) | 'nothing'
  $script:A = @{ now = 0; enterGoes = @('send'); enters = 1; sent = 0; menu = 0; focusIn = $true;
                 escapeCloses = $true; claim = $true; gate = 'ok'; restores = 0; collapses = 0 }
  foreach ($k in $world.Keys) { $script:A[$k] = $world[$k] }
  # The caller's ONE Enter has just gone out.
  $first = $script:A.enterGoes[0]
  if ($first -eq 'send') { $script:A.sent++ } elseif ($first -eq 'menu') { $script:A.menu = 1; $script:A.focusIn = $false }
  $io = [Activator]::CreateInstance($aIo, $true)
  $aIo.GetField('VerifyMs').SetValue($io, 1500)
  SetDel $aIo $io 'Sleep' { param([int]$ms) $script:A.now += $ms }
  SetDel $aIo $io 'StillThere' { [bool]($script:A.sent -eq 0) }
  SetDel $aIo $io 'MenuOpen' { [bool]($script:A.menu -gt 0) }
  SetDel $aIo $io 'FocusInComposer' { [bool]$script:A.focusIn }
  SetDel $aIo $io 'CollapseMenu' { $script:A.collapses++; if ($script:A.escapeCloses) { $script:A.menu = 0; return $null }; return 'menu_still_open' }
  SetDel $aIo $io 'Gate' { if ($script:A.gate -eq 'ok') { $script:A.focusIn = $true; return $gateOk }; return $gateNo }
  SetDel $aIo $io 'ClaimResend' { [bool]$script:A.claim }
  SetDel $aIo $io 'SendEnter' {
    $i = $script:A.enters
    $script:A.enters++
    $goes = $(if ($i -lt $script:A.enterGoes.Count) { $script:A.enterGoes[$i] } else { 'nothing' })
    if ($goes -eq 'send') { $script:A.sent++ } elseif ($goes -eq 'menu') { $script:A.menu = 1; $script:A.focusIn = $false }
  }
  SetDel $aIo $io 'RestoreFocus' { $script:A.restores++; $script:A.focusIn = $true }
  $o = Call 'RouteAfterEnter' @($io)
  Emit @{ t = 'after'; case = $case; submitted = [bool]$aOut.GetField('Submitted').GetValue($o);
          verdict = [string]$aOut.GetField('Verdict').GetValue($o); resends = [int]$aOut.GetField('Resends').GetValue($o);
          menuLeftOpen = [bool]$aOut.GetField('MenuLeftOpen').GetValue($o);
          enters = $script:A.enters; sends = $script:A.sent; menuOpenAtEnd = ($script:A.menu -gt 0);
          restores = $script:A.restores; collapses = $script:A.collapses; elapsed = $script:A.now }
}
RunAfter 'sent_first_time'             @{ }
RunAfter 'enter_hit_trigger_then_sent' @{ enterGoes = @('menu', 'send') }
RunAfter 'menu_reopened_twice'         @{ enterGoes = @('menu', 'menu') }
RunAfter 'switch_landed_send_blocked'  @{ enterGoes = @('nothing') }
RunAfter 'enter_went_elsewhere'        @{ enterGoes = @('nothing'); focusIn = $false }
RunAfter 'menu_reopened_cannot_close'  @{ enterGoes = @('menu'); escapeCloses = $false }
RunAfter 'resend_not_claimable'        @{ enterGoes = @('menu'); claim = $false }
RunAfter 'resend_gate_fails'           @{ enterGoes = @('menu'); gate = 'no' }

# Pure verdicts.
foreach ($c in @(@('sent', $false, $false, $false), @('menu', $true, $true, $false), @('elsewhere', $true, $false, $false), @('composer', $true, $false, $true))) {
  Emit @{ t = 'postverdict'; case = $c[0]; verdict = [string](Call 'RoutePostSendVerdict' @([bool]$c[1], [bool]$c[2], [bool]$c[3])) }
}
foreach ($c in @(@('menu_first', 'menu_reopened', 0), @('menu_second', 'menu_reopened', 1), @('in_composer', 'in_composer', 0), @('elsewhere', 'focus_not_in_composer', 0))) {
  Emit @{ t = 'resendallowed'; case = $c[0]; allowed = [bool](Call 'RouteResendAllowed' @([string]$c[1], [int]$c[2])) }
}

# ---- 3. the refocus click only lands on the composer -------------------------
# A Gemini-shaped composer row: the composer's rectangle is 600x48 at (100,500);
# the mode picker ("Flash-Lite v") is drawn over its right end (x >= 640).
$pts = Call 'RouteClickCandidates' @([double]100, [double]500, [double]600, [double]48)
$list = @(); foreach ($p in $pts) { $list += ,@([int]$p.X, [int]$p.Y) }
Emit @{ t = 'clickpoints'; points = $list }
Emit @{ t = 'clickpoints_tiny'; count = @(Call 'RouteClickCandidates' @([double]0, [double]0, [double]3, [double]40)).Count }

$COMPOSER = [int[]]@(42, 7, 1)
$CHILD = [int[]]@(42, 7, 2)            # the paragraph inside the contenteditable
$WRAP = [int[]]@(42, 7, 0)             # rich-textarea wrapper (the composer's parent)
$ROW = [int[]]@(42, 6, 0)              # the input row holding composer AND picker
$PICKER = [int[]]@(42, 9, 5)           # the mode picker button
$MENUITEM = [int[]]@(42, 11, 3)        # an item of the open menu, drawn over the composer
function Chain([object[]]$rids) { $l = New-Object 'System.Collections.Generic.List[int[]]'; foreach ($r in $rids) { $l.Add([int[]]$r) }; return ,$l }
$anc = Chain @($WRAP, $ROW)
foreach ($c in @(
    @('composer_itself', @($COMPOSER, $WRAP, $ROW)),
    @('inside_composer', @($CHILD, $COMPOSER, $WRAP)),
    @('composer_wrapper', @($WRAP, $ROW)),
    @('picker_button', @($PICKER, $ROW)),
    @('menu_item_overlay', @($MENUITEM, [int[]]@(42, 11, 0))))) {
  Emit @{ t = 'hit'; case = $c[0]; ok = [bool](Call 'RouteHitIsComposer' @((Chain $c[1]), $COMPOSER, $anc)) }
}
# RouteClickInto's choice over the candidates, with the Gemini hit-test map.
function HitAt([int]$x) { if ($x -ge 640) { $l = Chain @($PICKER, $ROW) } else { $l = Chain @($CHILD, $COMPOSER, $WRAP) }; return ,$l }
$chosen = $null
foreach ($p in $pts) {
  $x = [int]$p.X
  if ([bool](Call 'RouteHitIsComposer' @((HitAt $x), $COMPOSER, $anc))) { $chosen = $x; break }
}
Emit @{ t = 'clickchoice'; case = 'gemini_picker_at_right'; x = $chosen; clickedPicker = ($chosen -ne $null -and $chosen -ge 640) }
$chosen2 = $null
$miChain = Chain (,$MENUITEM)
foreach ($p in $pts) {
  $x = [int]$p.X
  if ([bool](Call 'RouteHitIsComposer' @($miChain, $COMPOSER, $anc))) { $chosen2 = $x; break }
}
Emit @{ t = 'clickchoice'; case = 'menu_covers_composer'; x = $chosen2; clicked = ($chosen2 -ne $null) }

# ---- 4. the WATCHDOG: real threads, a short budget ---------------------------
$runType = Nested 'RouteRun'
SetF '_routeWatchdogMs' 300
SetF '_routeWatchdogEmitGraceMs' 200
SetF '_app' 'gemini'

function NewRun([string]$stage) {
  $r = [Activator]::CreateInstance($runType, $true)
  $runType.GetField('Provider').SetValue($r, 'google')
  $runType.GetField('FromTier').SetValue($r, 'economy')
  $runType.GetField('ToTier').SetValue($r, 'premium')
  $runType.GetField('ToLabel').SetValue($r, '3.1 Pro')
  $runType.GetField('Complexity').SetValue($r, 'complex')
  $runType.GetField('Hwnd').SetValue($r, [IntPtr]::Zero)
  $runType.GetField('StartedMs').SetValue($r, [long](Call 'RouteNowMs'))
  return $r
}
function RunField($r, [string]$n) { $runType.GetField($n).GetValue($r) }

# Every route event the background threads write goes to this writer.
$script:sw = New-Object System.IO.StringWriter
$orig = [Console]::Out
function Lines() { @($script:sw.ToString() -split "`r?`n" | Where-Object { $_.Trim().StartsWith('{') }) }
function ResetLines() { $script:sw.GetStringBuilder().Clear() | Out-Null }
function WaitFinished($r, [int]$maxMs) {
  $sw2 = [Diagnostics.Stopwatch]::StartNew()
  while (-not [bool](RunField $r 'Finished') -and $sw2.ElapsedMilliseconds -lt $maxMs) { Start-Sleep -Milliseconds 20 }
}

function WatchCase([string]$case, [System.Action]$body, [int]$observeAtMs, [int]$finishMaxMs) {
  [Console]::SetOut($script:sw)
  try {
    ResetLines
    [RouteHarnessBodies]::TakeLog() | Out-Null
    SetF '_routeInProgress' $true
    SetF '_routeAbort' $false
    $r = NewRun
    $started = [bool](Call 'StartRouteThread' @($r, $body))
    Start-Sleep -Milliseconds $observeAtMs
    $mid = @{ inProgress = [bool](GetF '_routeInProgress'); claim = [int](RunField $r 'Claim'); lines = @(Lines) }
    WaitFinished $r $finishMaxMs
    Start-Sleep -Milliseconds 400   # let a late watchdog report land
    $end = @{ inProgress = [bool](GetF '_routeInProgress'); finished = [bool](RunField $r 'Finished'); lines = @(Lines) }
  } finally { [Console]::SetOut($orig) }
  $evs = @($end.lines | ForEach-Object { $_ | ConvertFrom-Json })
  Emit @{ t = 'watch'; case = $case; started = $started;
          midInProgress = $mid.inProgress; midClaim = $mid.claim; midEvents = $mid.lines.Count;
          endInProgress = $end.inProgress; finished = $end.finished;
          events = $evs.Count; results = @($evs | ForEach-Object { [string]$_.result }); reasons = @($evs | ForEach-Object { [string]$_.reason });
          log = [RouteHarnessBodies]::TakeLog() }
}

WatchCase 'uia_hang_past_budget'   ([RouteHarnessBodies]::HangThenTrySend(1200)) 700 3000
WatchCase 'exception_mid_route'    ([RouteHarnessBodies]::ThrowsMidRoute()) 150 2000
WatchCase 'hang_after_send'        ([RouteHarnessBodies]::SendThenHang(1500)) 700 3000
WatchCase 'fast_route'             ([RouteHarnessBodies]::Fast()) 150 2000

# The hook's own backstop: a route "in progress" with NO watchdog at all.
SetF '_activeRun' $null
SetF '_routeInProgress' $true
SetF '_routeStartedMs' ([long](Call 'RouteNowMs') - 300 - 1500 - 50)
$live = [bool](Call 'RouteInProgressLive')
Emit @{ t = 'stale'; case = 'no_watchdog_ran'; live = $live; inProgressAfter = [bool](GetF '_routeInProgress') }
SetF '_routeInProgress' $true
SetF '_routeStartedMs' ([long](Call 'RouteNowMs'))
Emit @{ t = 'stale'; case = 'fresh_route'; live = [bool](Call 'RouteInProgressLive'); inProgressAfter = [bool](GetF '_routeInProgress') }
SetF '_routeInProgress' $false
Emit @{ t = 'stale'; case = 'pure'; fresh = [bool](Call 'RouteStale' @([long]1000, [long]900)); old = [bool](Call 'RouteStale' @([long]100000, [long]900)); never = [bool](Call 'RouteStale' @([long]100000, [long]0)) }

# Off a route thread (no RouteRun) the send claim is always granted and a
# re-send never is -- the legacy/harness callers above have no watchdog to race.
Emit @{ t = 'claims'; case = 'off_route_thread'; send = [bool](Call 'RouteClaimSend'); resend = [bool](Call 'RouteClaimResend'); owned = [bool](Call 'RouteOwned') }

Emit @{ t = 'done' }

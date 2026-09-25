# Behavioural harness for "every agent chat in the Microsoft 365 desktop apps
# gets the ChatGPT/Claude treatment" (2026-09-24), after the security review of
# the same day: the Teams 1:1 agent-chat EVIDENCE route, the Teams Copilot tab,
# the M365 Copilot app, and the Copilot panes in Word / Excel / PowerPoint /
# OneNote / Outlook.
#
# NOTHING HERE INSTALLS A KEYBOARD HOOK AND NOTHING HERE TYPES ANYTHING.
# [CfaiEnforcer]::Start() is never called. The catalog payloads are the REAL
# ones — the test writes buildIdeProcessConfig / buildAiPanelConfig /
# buildAgentSurfaceConfig output to files and this harness loads them through
# the real loaders.
#
# What is substituted, and only this:
#   * AutomationElement.FocusedElement for the PANEL read — a (controlType,
#     name, className) triple fed through the REAL MatchPanelSignature (the
#     Name only when the REAL PanelUsesNameRule says so).
#   * the Teams pane SNAPSHOT — FakePane, installed as the helper's
#     _teamsPaneReader. EVERYTHING ELSE on the evidence path is production code
#     running for real: ComputeTickTeamsEvidence → TeamsEvidenceFor (key, TTL,
#     keep-last-good, watchdog, generation) → a real background STA thread →
#     SearchTeamsEvidenceBackground → TeamsAgentChatVerdict → the published
#     immutable TeamsEvidence. The harness never sets _tickAgentChatEvidence.
# UpdateForeground's two host-app gates are reproduced verbatim from the real
# sets, so the privacy gate stays under test.
#
# Emits NDJSON on stdout; agent/tests asserts on it.
param(
  [Parameter(Mandatory=$true)][string]$Ps1,
  [Parameter(Mandatory=$true)][string]$PayloadDir
)

$ErrorActionPreference = 'Stop'

$raw = Get-Content -Raw -LiteralPath $Ps1
$startIdx = $raw.IndexOf("`$source = @'")
$bodyStart = $raw.IndexOf("`n", $startIdx) + 1
$endIdx = $raw.IndexOf("`n'@", $bodyStart)
$source = $raw.Substring($bodyStart, $endIdx - $bodyStart)

$fakeSource = @'
public static class FakePane
{
    public static bool Owned = true, PaneFound = true, CapHit = false;
    public static string Rid = "", Aid = "";
    public static string[] Headers = new string[0], Messages = new string[0], Feedback = new string[0];
    public static int DelayMs = 0;
    public static int Calls = 0;
    public static void Set(string rid, string aid, string[] headers, string[] messages, string[] feedback, bool capHit)
    {
        Rid = rid; Aid = aid; Headers = headers ?? new string[0]; Messages = messages ?? new string[0];
        Feedback = feedback ?? new string[0]; CapHit = capHit; Owned = true; PaneFound = true;
    }
    internal static CfaiEnforcer.TeamsPaneSnapshot Read(System.IntPtr fg)
    {
        System.Threading.Interlocked.Increment(ref Calls);
        // Captured at CALL time, so a later Set() cannot change what a slow
        // (hung) search eventually reports — that is what the watchdog test needs.
        var snap = new CfaiEnforcer.TeamsPaneSnapshot();
        snap.Owned = Owned; snap.PaneFound = PaneFound; snap.CapHit = CapHit;
        snap.FocusedRid = Rid; snap.FocusedAid = Aid;
        snap.HeaderAids.AddRange(Headers); snap.MessageAids.AddRange(Messages); snap.FeedbackAids.AddRange(Feedback);
        int delay = DelayMs;
        if (delay > 0) System.Threading.Thread.Sleep(delay);
        return snap;
    }
    public static void Install()
    {
        typeof(CfaiEnforcer).GetField("_teamsPaneReader",
            System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Static)
            .SetValue(null, new CfaiEnforcer.TeamsPaneReader(Read));
    }
    // The published verdict, read out for reporting.
    public static string Describe()
    {
        object ev = typeof(CfaiEnforcer).GetField("_teamsEv",
            System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Static).GetValue(null);
        if (ev == null) return "none";
        var t = ev.GetType();
        return (((bool)t.GetField("Agent").GetValue(ev)) ? "agent" : "not_agent") + ":" + t.GetField("Kind").GetValue(ev).ToString();
    }
}

public static class FakeWebView
{
    public static bool Present = false;
    public static string ControlType = "Edit", ClassName = "", AutomationId = "";
    public static int Pid = -1;
    public static int Calls = 0;
    internal static CfaiEnforcer.FocusProps Find(uint hostPid)
    {
        Calls++;
        if (!Present) return null;
        var f = new CfaiEnforcer.FocusProps();
        f.ControlType = ControlType; f.ClassName = ClassName; f.AutomationId = AutomationId; f.Pid = Pid; f.Rid = "7.7.7";
        return f;
    }
    public static void Install()
    {
        typeof(CfaiEnforcer).GetField("_webViewFocusFinder",
            System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Static)
            .SetValue(null, new CfaiEnforcer.WebViewFocusFinder(Find));
    }
    // Drives the REAL ResolveEffectiveFocus, then the REAL MatchPanelSignature
    // on whatever it returns. "unchanged" = the focused element itself came back.
    public static string Resolve(string ct, string cls, int pid, uint hostPid, string proc)
    {
        var t = typeof(CfaiEnforcer);
        var fl = System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Static;
        var focused = new CfaiEnforcer.FocusProps();
        focused.ControlType = ct; focused.ClassName = cls; focused.Pid = pid;
        Calls = 0;
        var r = (CfaiEnforcer.FocusProps)t.GetMethod("ResolveEffectiveFocus", fl).Invoke(null, new object[] { focused, hostPid, proc });
        if (r == null) return "null;calls=" + Calls;
        string kind = object.ReferenceEquals(r, focused) ? "unchanged" : "resolved";
        object hit = t.GetMethod("MatchPanelSignature", fl).Invoke(null, new object[] { proc, r.ControlType, r.Name, r.ClassName });
        string id = hit == null ? "" : (string)hit.GetType().GetField("Id").GetValue(hit);
        return kind + ";calls=" + Calls + ";match=" + id;
    }
}

public class TeamsNode
{
    public string Aid = "", Cls = "";
    public TeamsNode First, Next;
    public TeamsNode(string aid, string cls) { Aid = aid ?? ""; Cls = cls ?? ""; }
    public TeamsNode Kids(params TeamsNode[] kids)
    {
        First = kids.Length > 0 ? kids[0] : null;
        for (int i = 0; i + 1 < kids.Length; i++) kids[i].Next = kids[i + 1];
        return this;
    }
    public static System.Func<object, object> FirstFn = n => ((TeamsNode)n).First;
    public static System.Func<object, object> NextFn = n => ((TeamsNode)n).Next;
    public static System.Func<object, string> AidFn = n => ((TeamsNode)n).Aid;
    public static System.Func<object, string> ClsFn = n => ((TeamsNode)n).Cls;
    // Runs the REAL collector + verdict over a synthetic tree and describes it.
    public static string CollectAndDecide(TeamsNode root, int maxNodes)
    {
        var snap = new CfaiEnforcer.TeamsPaneSnapshot();
        var t = typeof(CfaiEnforcer);
        var f = System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Static;
        t.GetMethod("CollectTeamsPane", f).Invoke(null, new object[] { root, FirstFn, NextFn, AidFn, ClsFn, maxNodes, snap });
        object[] args = new object[] { snap.HeaderAids, snap.MessageAids, snap.FeedbackAids, snap.CapHit, null, null };
        bool agent = (bool)t.GetMethod("TeamsAgentChatVerdict", f).Invoke(null, args);
        return "headers=" + snap.HeaderAids.Count + ";messages=" + snap.MessageAids.Count + ";feedback=" + snap.FeedbackAids.Count
            + ";cap=" + snap.CapHit + ";agent=" + agent + ";kind=" + args[5];
    }
}
// Drives the REAL MouseCallback / HookCallback with synthetic hook structs.
// Never installs a hook: _mouseHook/_hook stay zero, so CallNextHookEx is a
// no-op. The top-level-window hit test and the modifier state are scripted
// through the enforcer's own seams (_rootAtPoint, _keyDownProbe).
public static class FakeInput
{
    public static long AppRoot = 0x7001, OtherRoot = 0x7002;
    public static int OtherL = -1, OtherT = -1, OtherR = -1, OtherB = -1;   // a window over the app
    public static bool Ctrl = false, Shift = false, Alt = false;
    static System.IntPtr Root(int x, int y)
    {
        if (x >= OtherL && x < OtherR && y >= OtherT && y < OtherB) return new System.IntPtr(OtherRoot);
        return new System.IntPtr(AppRoot);
    }
    static bool KeyDown(int vk)
    {
        if (vk == 0x11) return Ctrl;
        if (vk == 0x10) return Shift;
        if (vk == 0x12) return Alt;
        return false;
    }
    const System.Reflection.BindingFlags F = System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Static;
    public static void Install()
    {
        typeof(CfaiEnforcer).GetField("_rootAtPoint", F).SetValue(null, new CfaiEnforcer.RootAtPointFn(Root));
        typeof(CfaiEnforcer).GetField("_keyDownProbe", F).SetValue(null, new CfaiEnforcer.KeyDownProbe(KeyDown));
    }
    public static void Uninstall()
    {
        typeof(CfaiEnforcer).GetField("_keyDownProbe", F).SetValue(null, null);
    }
    public static bool Cache(double l, double t, double w, double h)
    {
        return (bool)typeof(CfaiEnforcer).GetMethod("CachePanelRect", F).Invoke(null, new object[] { new System.Windows.Rect(l, t, w, h) });
    }
    // 1 = swallowed. MSLLHOOKSTRUCT: pt.x @0, pt.y @4, mouseData @8, flags @12.
    public static int Mouse(int msg, int x, int y)
    {
        System.IntPtr lp = System.Runtime.InteropServices.Marshal.AllocHGlobal(32);
        try
        {
            for (int i = 0; i < 32; i += 4) System.Runtime.InteropServices.Marshal.WriteInt32(lp, i, 0);
            System.Runtime.InteropServices.Marshal.WriteInt32(lp, 0, x);
            System.Runtime.InteropServices.Marshal.WriteInt32(lp, 4, y);
            object r = typeof(CfaiEnforcer).GetMethod("MouseCallback", F).Invoke(null, new object[] { 0, new System.IntPtr(msg), lp });
            return ((System.IntPtr)r).ToInt64() == 1 ? 1 : 0;
        }
        finally { System.Runtime.InteropServices.Marshal.FreeHGlobal(lp); }
    }
    // 1 = swallowed. KBDLLHOOKSTRUCT: vkCode @0, scanCode @4, flags @8.
    public static int Key(int vk, bool ctrl, bool shift, bool alt)
    {
        Ctrl = ctrl; Shift = shift; Alt = alt;
        System.IntPtr lp = System.Runtime.InteropServices.Marshal.AllocHGlobal(32);
        try
        {
            for (int i = 0; i < 32; i += 4) System.Runtime.InteropServices.Marshal.WriteInt32(lp, i, 0);
            System.Runtime.InteropServices.Marshal.WriteInt32(lp, 0, vk);
            object r = typeof(CfaiEnforcer).GetMethod("HookCallback", F).Invoke(null, new object[] { 0, new System.IntPtr(0x0100), lp });
            return ((System.IntPtr)r).ToInt64() == 1 ? 1 : 0;
        }
        finally { System.Runtime.InteropServices.Marshal.FreeHGlobal(lp); Ctrl = false; Shift = false; Alt = false; }
    }
}
// Scripted Office Copilot pane-heading read (the _paneHeadingSource seam).
public static class FakePaneHeading
{
    public static bool Ok = true, Found = true;
    public static string Heading = "";
    public static int Calls = 0;
    public static string LastContainer = "", LastTranscript = "", LastHeadingClass = "";
    static bool Read(string containerAid, string transcriptClass, string headingClass, out bool found, out string heading)
    {
        Calls++;
        LastContainer = containerAid; LastTranscript = transcriptClass; LastHeadingClass = headingClass;
        found = Found; heading = Heading;
        return Ok;
    }
    public static void Install()
    {
        typeof(CfaiEnforcer).GetField("_paneHeadingSource",
            System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Static)
            .SetValue(null, new CfaiEnforcer.PaneHeadingSource(Read));
    }
}
'@

Add-Type -TypeDefinition ($source + "`n" + $fakeSource) -ReferencedAssemblies @(
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
# Membership against a static HashSet field, read INSIDE this function: a
# collection RETURNED from a PowerShell function is enumerated into an array,
# which silently drops the set's case-insensitive comparer.
function HasProc([string]$field, [string]$name) {
  $f = $T.GetField($field, $FLAGS)
  if (-not $f) { throw "no field $field" }
  $set = $f.GetValue($null)
  if ($null -eq $set) { return $false }
  return [bool]$set.Contains($name)
}
function Out-Obj($obj) { Write-Output ($obj | ConvertTo-Json -Compress -Depth 6) }

$available = (HasMethod 'ComputeTickTeamsEvidence') -and (HasMethod 'TeamsAgentChatVerdict') -and (HasMethod 'CollectTeamsPane') `
  -and (HasMethod 'EmitEvidencePrompt') -and (HasMethod 'EvidencePromptRoute') -and (HasMethod 'PanelUsesNameRule')
Out-Obj @{ case = 'available'; available = $available }
if (-not $available) { return }
[FakePane]::Install()

# ── real payloads ────────────────────────────────────────────────────────────
Call 'LoadIdeProcesses' @([string](Get-Content -Raw -LiteralPath (Join-Path $PayloadDir 'ide.json'))) | Out-Null
Call 'LoadAiPanels' @([string](Get-Content -Raw -LiteralPath (Join-Path $PayloadDir 'panels.json'))) | Out-Null
Call 'LoadAgentSurfaces' @([string](Get-Content -Raw -LiteralPath (Join-Path $PayloadDir 'surfaces.json'))) | Out-Null
$aiProcSet = New-Object 'System.Collections.Generic.HashSet[string]' -ArgumentList @([System.StringComparer]::OrdinalIgnoreCase)
foreach ($p in ([string](Get-Content -Raw -LiteralPath (Join-Path $PayloadDir 'aiprocs.txt'))).Split(',')) { if ($p.Trim()) { $null = $aiProcSet.Add($p.Trim()) } }
SetF '_aiProcs' $aiProcSet

$PATINFO_T = $T.GetNestedType('PatInfo', $FLAGS)
$patListType = [System.Collections.Generic.List`1].MakeGenericType($PATINFO_T)
$pats = [Activator]::CreateInstance($patListType)
$ssn = [Activator]::CreateInstance($PATINFO_T)
$PATINFO_T.GetField('Name', $IFLAGS).SetValue($ssn, 'ssn')
$PATINFO_T.GetField('Rx', $IFLAGS).SetValue($ssn, (New-Object System.Text.RegularExpressions.Regex('\b\d{3}-\d{2}-\d{4}\b', [System.Text.RegularExpressions.RegexOptions]::CultureInvariant, [TimeSpan]::FromMilliseconds(25))))
$PATINFO_T.GetField('Label', $IFLAGS).SetValue($ssn, '[SSN]')
$PATINFO_T.GetField('SevRank', $IFLAGS).SetValue($ssn, 4)
$pats.Add($ssn)
SetF '_patInfos' $pats

function LoadRows([string]$json) {
  $f = Join-Path ([System.IO.Path]::GetTempPath()) ("cfai-m365-rows-" + [guid]::NewGuid().ToString('N') + '.json')
  Set-Content -LiteralPath $f -Value $json -Encoding UTF8
  SetF '_blockedAgentFile' $f
  SetF '_lastBlockedCheck' ([long]0)
  Call 'UpdateBlockedAgents' | Out-Null
}
function LoadGoverned([string]$json) {
  $f = Join-Path ([System.IO.Path]::GetTempPath()) ("cfai-m365-gov-" + [guid]::NewGuid().ToString('N') + '.json')
  Set-Content -LiteralPath $f -Value $json -Encoding UTF8
  SetF '_governedAgentFile' $f
  Call 'UpdateGovernedAgents' | Out-Null
}
LoadRows '[]'
LoadGoverned '[]'

$OUTCOME_T = $T.GetNestedType('AgentReadOutcome', $FLAGS)
$OUT_UNREADABLE = [Enum]::Parse($OUTCOME_T, 'Unreadable')
$OUT_NAMED = [Enum]::Parse($OUTCOME_T, 'Named')

function ResetState() {
  foreach ($b in @('_fgIsAi','_fgIsPanel','_fgPanelEnforce','_fgIsBlocked','_blockedByElement','_blockTyped','_blockUia','_blockPaste',
                   '_attachHoldActive','_govActive','_fgHostGoverned','_fgDlpGoverned','_tickAgentChatEvidence','_tickChatIsGroup',
                   '_fgAgentChatEvidence','_teamsEvSearchInProgress')) { SetF $b $false }
  SetF '_fgContentOk' $true
  SetF '_fgPanelId' ''; SetF '_app' ''; SetF '_blockScope' ''
  SetF '_fgLeftAiTicks' ([long]0); SetF '_fgPid' ([uint32]0)
  SetF '_disarmedUntilTicks' ([long]0); SetF '_lastBlockFiredTicks' ([long]0); SetF '_lastPasteTicks' ([long]0)
  SetF '_lastFocusMoveInputTicks' ([long]0)
  Call 'ClearPanelBlockLatch' | Out-Null
  SetF '_fgAgentOutcome' $OUT_UNREADABLE; SetF '_fgAgentName' ''
  SetF '_teamsEv' $null; SetF '_teamsEvSearchKey' $null; SetF '_teamsEvSearchStartTicks' ([long]0)
  SetF '_evidenceDlpOn' $true
  [FakePane]::DelayMs = 0
  [FakePane]::Calls = 0
}
function WaitSearch([int]$maxMs = 3000) {
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  while ([bool](GetF '_teamsEvSearchInProgress') -and $sw.ElapsedMilliseconds -lt $maxMs) { Start-Sleep -Milliseconds 20 }
}

function TierBReached() {
  SetF '_pendingWhyNot' 'HARNESS_SENTINEL'
  SetF '_pendingRewritable' $false
  SetF '_pendingExpiresAt' ([long]0)
  Call 'UpdatePendingRewrite' | Out-Null
  return ([string](GetF '_pendingWhyNot') -ne 'HARNESS_SENTINEL')
}
# The block line a sensitive Enter would produce, with the Tier B pin in the
# state UpdatePendingRewrite leaves it in for a maskable composer (its UIA read
# of a real composer cannot run offline). What this proves is that NOTHING on
# the EmitBlock path suppresses `rewritable` on the route.
function CaptureBlock() {
  SetF '_pendingRewritable' $true; SetF '_pendingBlockId' 'blk-route'; SetF '_pendingPreview' 'my ssn is [SSN]'
  SetF '_pendingWhyNot' ''; SetF '_pendingFrozen' $false
  $orig = [Console]::Out; $sw = New-Object System.IO.StringWriter
  [Console]::SetOut($sw)
  try { Call 'EmitBlock' @([string](GetF '_app'), 'ssn', 'send') | Out-Null } finally { [Console]::SetOut($orig) }
  SetF '_pendingRewritable' $false; SetF '_pendingBlockId' ''
  return $sw.ToString().Trim()
}
function CaptureEvidencePrompt() {
  $orig = [Console]::Out; $sw = New-Object System.IO.StringWriter
  [Console]::SetOut($sw)
  try { Call 'EmitEvidencePrompt' @([string](GetF '_app'), [string](GetF '_fgPanelId'), 'my ssn is 123-45-6789', 'typed') | Out-Null }
  finally { [Console]::SetOut($orig) }
  return $sw.ToString().Trim()
}

$HWND = [System.IntPtr]::new(4242)

# One poll tick. For Teams, the evidence goes through the REAL
# ComputeTickTeamsEvidence; -Settle waits for the background search it started
# and then runs the tick's evidence step again (what the next 150ms poll does).
function Tick([string]$scenario, [string]$proc, [uint32]$fgPid, $focus, [string]$rid = '', [string]$aid = '',
              [switch]$Settle, [switch]$Capture, $outcome = $null, [string]$agentName = '') {
  if ($null -eq $outcome) { $outcome = $OUT_UNREADABLE }
  $isIde = HasProc '_ideProcs' $proc
  $isHost = HasProc '_hostAppProcs' $proc
  $surfaceOk = $null -ne (Call 'EnforcingAgentSurface' @($proc))
  $hostAppArmed = (-not $isIde) -and $isHost -and ((HasProc '_agentScopedProcs' $proc) -or (HasProc '_dlpScopedProcs' $proc)) -and $surfaceOk
  $hostEvidenceArmed = (-not $isIde) -and $isHost -and [bool](GetF '_evidenceDlpOn') -and $surfaceOk
  $hit = $null; $readable = $false; $nameRead = $false
  if ($null -ne $focus -and ($isIde -or $hostAppArmed -or $hostEvidenceArmed)) {
    $nameRead = [bool](Call 'PanelUsesNameRule' @($proc))
    $nm = if ($nameRead) { $focus[1] } else { '' }
    $readable = ($focus[0].Trim().Length -gt 0) -and (($nm.Trim().Length -gt 0) -or ($focus[2].Trim().Length -gt 0))
    $hit = Call 'MatchPanelSignature' @($proc, $focus[0], $nm, $focus[2])
  }
  if (-not $isIde) {
    Call 'ComputeTickTeamsEvidence' @($HWND, [bool]($hostAppArmed -or $hostEvidenceArmed), $hit, $rid, $aid) | Out-Null
    if ($Settle) { WaitSearch; Call 'ComputeTickTeamsEvidence' @($HWND, [bool]($hostAppArmed -or $hostEvidenceArmed), $hit, $rid, $aid) | Out-Null }
  }
  $panelRid = if ($null -ne $hit) { if ($rid) { $rid } else { '42.1.2.3' } } else { '' }
  Call 'ApplyForegroundTick' @($fgPid, $proc, $isIde, $hit, $panelRid, $readable, $outcome, $agentName) | Out-Null
  Call 'CheckFgBlocked' | Out-Null

  $matched = if ($null -ne $hit) { [string]$hit.GetType().GetField('Id').GetValue($hit) } else { '' }
  # A SENSITIVE Enter, modelled as the hook computes it: the UIA content signal
  # exists only when UpdateUia's gate passes (PanelUiaOk AND _fgContentOk).
  $uiaPossible = [bool](Call 'PanelUiaOk') -and [bool](GetF '_fgContentOk')
  $contentBlock = (([bool](GetF '_fgIsAi') -or [bool](Call 'PanelBlockLatchHeld')) `
                   -and [bool](Call 'EnterBlockActive' @($false, $uiaPossible, $false, $false)))
  $obj = [ordered]@{
    case = 'tick'; scenario = $scenario; proc = $proc; matched = $matched; nameRead = $nameRead
    hostAppArmed = $hostAppArmed; hostEvidenceArmed = $hostEvidenceArmed
    verdict = [FakePane]::Describe(); searches = [int][FakePane]::Calls
    agentChatEvidence = [bool](GetF '_tickAgentChatEvidence'); chatIsGroup = [bool](GetF '_tickChatIsGroup')
    fgIsAi = [bool](GetF '_fgIsAi'); fgIsPanel = [bool](GetF '_fgIsPanel'); fgPanelId = [string](GetF '_fgPanelId')
    dlpGoverned = [bool](GetF '_fgDlpGoverned'); fgIsBlocked = [bool](GetF '_fgIsBlocked')
    contentOk = [bool](GetF '_fgContentOk')
    contentBlock = [bool]$contentBlock
    evidenceRoute = [bool](Call 'EvidencePromptRoute')
    tierBReached = [bool](TierBReached)
  }
  if ($Capture) {
    $obj.blockLine = CaptureBlock
    $obj.promptLine = if ($obj.evidenceRoute) { CaptureEvidencePrompt } else { '' }
  }
  Out-Obj $obj
}

# ── Teams fixtures (shapes measured live 2026-09-24) ────────────────────────
$COMPOSER = @('Edit', 'Type a message', 'ck ck-content ck-editor__editable ck-rounded-corners ck-editor__editable_inline ___1czdayc f1poobt0')
$COPILOT_TAB = @('Edit', 'Message Copilot', 'fai-EditorInput__input r18fti29 r18aquq2 ___10kbave')
$TID  = '19:5d7e2a1c-0000-4a4a-9b9b-1234567890ab_9e8d7c6b-1111-4c4c-8d8d-0987654321ba@unq.gbl.spaces'
$TID2 = '19:0f0f0f0f-2222-4b4b-9c9c-aaaaaaaaaaaa_1e1e1e1e-3333-4d4d-8e8e-bbbbbbbbbbbb@unq.gbl.spaces'
$GTID = '19:a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6@thread.v2'
function Hdr([string]$t) { return 'chat-header-' + $t }
function Fb([string]$t, [string]$ts) { return @(($t + '-' + $ts + '-positive-feedback'), ($t + '-' + $ts + '-negative-feedback')) }
$MSGS = @('message-body-1727170000001', 'message-body-1727170000002')
$FB_ALL = @((Fb $TID '1727170000001') + (Fb $TID '1727170000002'))
$TEAMS_PID = [uint32]13472
$R1 = '42.7.100'; $A1 = 'new-message-11111111-aaaa-4bbb-8ccc-000000000001'
$R2 = '42.7.200'; $A2 = 'new-message-22222222-aaaa-4bbb-8ccc-000000000002'
function AgentPane([string]$rid, [string]$aid) { [FakePane]::Set($rid, $aid, [string[]]@((Hdr $TID)), [string[]]$MSGS, [string[]]$FB_ALL, $false) }

$ROWS_TEAMS_BLOCK = '[{"platform":"teams_chat_agent","agent_name":"IT Help Desk Agent","agent_id":"agent-ithelp","reason":"Blocked by admin","agent_scope":"agent"}]'
$GOV_TEAMS = '[{"agent_id":"ag-gov-1","agent_name":"Expenses Helper","platform":"teams_chat_agent","reason":"DLP monitored","agent_scope":"agent","dlp_monitor":true}]'

# E1: the agent 1:1 — every incoming message has its positive-feedback button.
ResetState; AgentPane $R1 $A1
Tick 'teams_agent_first_tick' 'ms-teams' $TEAMS_PID $COMPOSER $R1 $A1     # before the search completes
Tick 'teams_agent_1to1' 'ms-teams' $TEAMS_PID $COMPOSER $R1 $A1 -Settle -Capture

# E2: a human 1:1 containing ONE agent-marked reply and unmarked human messages.
ResetState
[FakePane]::Set($R1, $A1, [string[]]@((Hdr $TID)), [string[]]@('message-body-100', 'message-body-101', 'message-body-102'),
  [string[]](Fb $TID '101'), $false)
Tick 'teams_human_1to1_one_agent_reply' 'ms-teams' $TEAMS_PID $COMPOSER $R1 $A1 -Settle -Capture

# E3: feedback buttons whose thread id does not match the header.
ResetState
[FakePane]::Set($R1, $A1, [string[]]@((Hdr $TID)), [string[]]$MSGS, [string[]]@((Fb $TID2 '1727170000001') + (Fb $TID2 '1727170000002')), $false)
Tick 'teams_feedback_thread_mismatch' 'ms-teams' $TEAMS_PID $COMPOSER $R1 $A1 -Settle
# …and one stray foreign-thread button among otherwise matching ones.
ResetState
[FakePane]::Set($R1, $A1, [string[]]@((Hdr $TID)), [string[]]$MSGS, [string[]]@($FB_ALL + @(($TID2 + '-9-positive-feedback'))), $false)
Tick 'teams_feedback_one_foreign' 'ms-teams' $TEAMS_PID $COMPOSER $R1 $A1 -Settle

# E4: two conversation headers in scope.
ResetState
[FakePane]::Set($R1, $A1, [string[]]@((Hdr $TID), (Hdr $TID2)), [string[]]$MSGS, [string[]]$FB_ALL, $false)
Tick 'teams_two_headers' 'ms-teams' $TEAMS_PID $COMPOSER $R1 $A1 -Settle

# E5: a group chat that even carries feedback buttons for every message.
ResetState
[FakePane]::Set($R1, $A1, [string[]]@((Hdr $GTID)), [string[]]$MSGS, [string[]]@((Fb $GTID '1727170000001') + (Fb $GTID '1727170000002')), $false)
Tick 'teams_group_chat_with_markers' 'ms-teams' $TEAMS_PID $COMPOSER $R1 $A1 -Settle -Capture

# E6: no header / no pane / no incoming messages / cap hit / focus moved.
ResetState; [FakePane]::Set($R1, $A1, [string[]]@(), [string[]]$MSGS, [string[]]$FB_ALL, $false)
Tick 'teams_missing_header' 'ms-teams' $TEAMS_PID $COMPOSER $R1 $A1 -Settle
ResetState; AgentPane $R1 $A1; [FakePane]::PaneFound = $false
Tick 'teams_pane_not_found' 'ms-teams' $TEAMS_PID $COMPOSER $R1 $A1 -Settle
ResetState; [FakePane]::Set($R1, $A1, [string[]]@((Hdr $TID)), [string[]]@(), [string[]]@(), $false)
Tick 'teams_no_messages' 'ms-teams' $TEAMS_PID $COMPOSER $R1 $A1 -Settle
ResetState; [FakePane]::Set($R1, $A1, [string[]]@((Hdr $TID)), [string[]]$MSGS, [string[]]$FB_ALL, $true)
Tick 'teams_cap_hit' 'ms-teams' $TEAMS_PID $COMPOSER $R1 $A1 -Settle
ResetState; AgentPane $R2 $A2       # the snapshot describes ANOTHER composer
Tick 'teams_focus_moved_mid_search' 'ms-teams' $TEAMS_PID $COMPOSER $R1 $A1 -Settle

# E7: conversation switch agent → human 1:1 within the TTL.
ResetState; AgentPane $R1 $A1
Tick 'teams_switch_agent_to_human' 'ms-teams' $TEAMS_PID $COMPOSER $R1 $A1 -Settle
[FakePane]::Set($R2, $A2, [string[]]@((Hdr $TID2)), [string[]]@('message-body-7'), [string[]]@(), $false)
Tick 'teams_switch_agent_to_human' 'ms-teams' $TEAMS_PID $COMPOSER $R2 $A2              # immediately after the switch
Tick 'teams_switch_agent_to_human' 'ms-teams' $TEAMS_PID $COMPOSER $R2 $A2 -Settle      # after its own search

# E8: focus leaves the composer (hit null) — the published verdict is cleared.
ResetState; AgentPane $R1 $A1
Tick 'teams_focus_leaves_composer' 'ms-teams' $TEAMS_PID $COMPOSER $R1 $A1 -Settle
Tick 'teams_focus_leaves_composer' 'ms-teams' $TEAMS_PID @('Group', '', 'fui-ChatMessage__body') '' ''
Tick 'teams_focus_leaves_composer' 'ms-teams' $TEAMS_PID $COMPOSER $R1 $A1              # back: re-established only by a new search

# E9 (L5): keep the last good verdict during a same-key re-check; a FAILED
# re-check clears it.
ResetState; AgentPane $R1 $A1
Tick 'teams_keep_last_good' 'ms-teams' $TEAMS_PID $COMPOSER $R1 $A1 -Settle
Start-Sleep -Milliseconds 3300                   # past TEAMS_EV_CACHE_TTL
[FakePane]::Set($R1, $A1, [string[]]@((Hdr $TID)), [string[]]@('message-body-100', 'message-body-101'), [string[]](Fb $TID '101'), $false)
[FakePane]::DelayMs = 800
Tick 'teams_keep_last_good' 'ms-teams' $TEAMS_PID $COMPOSER $R1 $A1                      # re-check running: still governed
Tick 'teams_keep_last_good' 'ms-teams' $TEAMS_PID $COMPOSER $R1 $A1 -Settle              # re-check failed: cleared

# E10 (L5): the watchdog abandons a hung search and discards its late result.
ResetState
[FakePane]::Set($R1, $A1, [string[]]@((Hdr $TID)), [string[]]@('message-body-100'), [string[]]@(), $false)   # the hung one would say "not agent"
[FakePane]::DelayMs = 5000
Tick 'teams_watchdog' 'ms-teams' $TEAMS_PID $COMPOSER $R1 $A1                            # search A starts, hangs
Start-Sleep -Milliseconds 3300
AgentPane $R1 $A1; [FakePane]::DelayMs = 0
Tick 'teams_watchdog' 'ms-teams' $TEAMS_PID $COMPOSER $R1 $A1 -Settle                    # watchdog → search B → agent
Start-Sleep -Milliseconds 2200                                                            # A finishes now — discarded
Tick 'teams_watchdog' 'ms-teams' $TEAMS_PID $COMPOSER $R1 $A1

# E11 (H1): a GROUP chat renamed to a BLOCKED / GOVERNED agent's name. The title
# route says Named; the header says @thread.v2 — no block, no scan, no upload.
ResetState; LoadRows $ROWS_TEAMS_BLOCK
[FakePane]::Set($R1, $A1, [string[]]@((Hdr $GTID)), [string[]]$MSGS, [string[]]@(), $false)
Tick 'teams_renamed_group_as_blocked_agent' 'ms-teams' $TEAMS_PID $COMPOSER $R1 $A1 -Settle -Capture $OUT_NAMED 'IT Help Desk Agent'
# control: the same Named blocked agent in a real agent 1:1 still blocks
ResetState; LoadRows $ROWS_TEAMS_BLOCK; AgentPane $R1 $A1
Tick 'teams_named_blocked_agent_control' 'ms-teams' $TEAMS_PID $COMPOSER $R1 $A1 -Settle -Capture $OUT_NAMED 'IT Help Desk Agent'
LoadRows '[]'
ResetState; LoadGoverned $GOV_TEAMS
[FakePane]::Set($R1, $A1, [string[]]@((Hdr $GTID)), [string[]]$MSGS, [string[]]@(), $false)
Tick 'teams_renamed_group_as_governed_agent' 'ms-teams' $TEAMS_PID $COMPOSER $R1 $A1 -Settle -Capture $OUT_NAMED 'Expenses Helper'
# the Named GOVERNED route without evidence: scanned (name route) but NO upload
ResetState; LoadGoverned $GOV_TEAMS
[FakePane]::Set($R1, $A1, [string[]]@((Hdr $TID)), [string[]]@('message-body-5'), [string[]]@(), $false)
Tick 'teams_named_governed_no_evidence' 'ms-teams' $TEAMS_PID $COMPOSER $R1 $A1 -Settle -Capture $OUT_NAMED 'Expenses Helper'
LoadGoverned '[]'

# E12 (H3): dlp OFF with a Teams policy row — the evidence routes do nothing.
ResetState; LoadGoverned $GOV_TEAMS; SetF '_evidenceDlpOn' $false; AgentPane $R1 $A1
Tick 'teams_dlp_off_with_row' 'ms-teams' $TEAMS_PID $COMPOSER $R1 $A1 -Settle -Capture
ResetState; LoadGoverned $GOV_TEAMS; SetF '_evidenceDlpOn' $false
Tick 'teams_copilot_tab_dlp_off_with_row' 'ms-teams' $TEAMS_PID $COPILOT_TAB '42.9.9' 'm365-chat-editor-target-element' -Capture
LoadGoverned '[]'
ResetState; SetF '_evidenceDlpOn' $false; AgentPane $R1 $A1
Tick 'teams_dlp_off_no_rows' 'ms-teams' $TEAMS_PID $COMPOSER $R1 $A1 -Settle

# E13: the Copilot tab with dlp on and no rows.
ResetState
Tick 'teams_copilot_tab_no_rows' 'ms-teams' $TEAMS_PID $COPILOT_TAB '42.9.9' 'm365-chat-editor-target-element' -Capture

# ── M365 Copilot app (a chat app) ───────────────────────────────────────────
ResetState
Tick 'm365_copilot_app' 'M365Copilot' ([uint32]8104) @('Edit', 'Message Copilot', 'fai-EditorInput__input r18fti29') -Capture

# ── Office / Outlook Copilot panes, dlp ON and OFF ──────────────────────────
$PANE = @('Edit', 'Message Copilot', 'fai-EditorInput__input r18fti29 r18aquq2 ___10kbave f1pha7fy')
$i = 0
foreach ($app in @('WINWORD', 'EXCEL', 'POWERPNT', 'ONENOTE', 'OUTLOOK', 'olk')) {
  ResetState
  Tick ("pane_" + $app) $app ([uint32](9000 + $i)) $PANE -Capture
  ResetState; SetF '_evidenceDlpOn' $false
  Tick ("pane_dlp_off_" + $app) $app ([uint32](9000 + $i)) $PANE -Capture
  $i++
}
# dlp OFF: a panel-keyed BLOCK ROW (Inventory block on m365.cloud.microsoft) still blocks.
ResetState; SetF '_evidenceDlpOn' $false
LoadRows '[{"platform":"ai_platform","panel":"office_copilot_pane","agent_name":"Microsoft 365 Copilot","agent_id":"","host":"m365.cloud.microsoft","reason":"Blocked by organization policy"}]'
Tick 'pane_dlp_off_row_still_blocks' 'WINWORD' ([uint32]9050) $PANE
LoadRows '[]'

# ── Collisions: native Office / Outlook editing surfaces never match ────────
$COLLIDE = @(
  @('EXCEL',    @('Edit', 'Formula Bar', 'EXCEL<')),
  @('EXCEL',    @('Edit', '', 'EXCEL6')),
  @('EXCEL',    @('DataItem', 'A1', 'EXCEL7')),
  @('POWERPNT', @('Document', 'Slide Notes', 'mdiClass')),
  @('POWERPNT', @('Edit', 'Search', 'NetUITextbox')),
  @('ONENOTE',  @('Document', 'Page content', 'NetUIHWND')),
  @('ONENOTE',  @('Edit', 'Search notebooks', 'NetUITextbox')),
  @('WINWORD',  @('Document', 'Document', '_WwG')),
  @('WINWORD',  @('Edit', 'Search document', 'NetUITextbox')),
  @('OUTLOOK',  @('Document', 'Message body', '_WwG')),
  @('OUTLOOK',  @('Edit', 'Subject', 'RichEdit20WPT')),
  @('OUTLOOK',  @('Edit', 'Search', 'NetUITextbox')),
  @('olk',      @('Edit', 'Message body', 'ms-rte-Editor elementToProof')),
  @('olk',      @('Edit', 'Add a subject', 'fui-Input__input'))
)
$j = 0
foreach ($c in $COLLIDE) { ResetState; Tick ("collide_" + $j + "_" + $c[0]) $c[0] ([uint32](9500 + $j)) $c[1]; $j++ }

# ── Outlook: pane → compose body. The compose-body Enter is never swallowed. ─
ResetState
Tick 'outlook_pane_then_body' 'OUTLOOK' ([uint32]9100) $PANE
Tick 'outlook_pane_then_body' 'OUTLOOK' ([uint32]9100) @('Document', 'Message body', '_WwG')
ResetState; Tick 'outlook_body_cold' 'OUTLOOK' ([uint32]9100) @('Document', 'Message body', '_WwG')
ResetState; Tick 'olk_body_cold' 'olk' ([uint32]9101) @('Edit', 'Message body', 'ms-rte-Editor elementToProof')

# ── The REAL collector over synthetic trees ─────────────────────────────────
function N([string]$aid, [string]$cls) { return New-Object TeamsNode($aid, $cls) }
function Tree([string]$hdr, [object[]]$items) {
  $root = N 'chat-pane-root' ''
  $pane = N 'message-pane-layout-a11y' 'fui-Flex'
  $list = N '' 'fui-ChatMessageList'
  $list.Kids([TeamsNode[]]$items) | Out-Null
  $pane.Kids($list) | Out-Null
  if ($hdr) { $root.Kids((N $hdr 'fui-Flex'), $pane) | Out-Null } else { $root.Kids($pane) | Out-Null }
  return $root
}
$BODY = 'fui-ChatMessage__body ___x'
$POS = 'fui-Button fai-FeedbackButtons__positiveFeedbackButton ___a'
$NEG = 'fui-Button fai-FeedbackButtons__negativeFeedbackButton ___b'
$trees = @(
  @{ name = 'agent'; root = (Tree (Hdr $TID) @((N 'message-body-1' $BODY), (N ($TID + '-1-positive-feedback') $POS), (N ($TID + '-1-negative-feedback') $NEG),
                                                (N 'badge-9' 'fui-ChatMessage__decorationIcon'), (N 'x' 'fai-AiGeneratedDisclaimer'))) }
  @{ name = 'human_mixed'; root = (Tree (Hdr $TID) @((N 'message-body-1' $BODY), (N ($TID + '-1-positive-feedback') $POS), (N 'message-body-2' $BODY))) }
  @{ name = 'group'; root = (Tree (Hdr $GTID) @((N 'message-body-1' $BODY), (N ($GTID + '-1-positive-feedback') $POS))) }
  @{ name = 'disclaimer_only'; root = (Tree (Hdr $TID) @((N 'message-body-1' $BODY), (N 'x' 'fai-AiGeneratedDisclaimer'))) }
)
foreach ($t in $trees) {
  Out-Obj @{ case = 'collect'; variant = $t.name; result = [TeamsNode]::CollectAndDecide($t.root.psobject.BaseObject, 2500) }
}
# the cap: 3000 plain nodes before the feedback → cap hit → not an agent
$many = @(); for ($k = 0; $k -lt 3000; $k++) { $many += (N ('x' + $k) 'fui-Flex') }
$many += (N 'message-body-1' $BODY); $many += (N ($TID + '-1-positive-feedback') $POS)
Out-Obj @{ case = 'collect'; variant = 'cap'; result = [TeamsNode]::CollectAndDecide((Tree (Hdr $TID) $many).psobject.BaseObject, 2500) }

# -- BUG A: the Office / Outlook WebView2Holder resolver ---------------------
# REAL pids, so the direct-child rule runs against the OS: the "host" is this
# harness's parent process and the "webview" is this harness itself.
[FakeWebView]::Install()
$me = [uint32]$PID
$parent = [uint32]((Get-CimInstance Win32_Process -Filter "ProcessId=$PID").ParentProcessId)
$FAI = 'fai-EditorInput__input r18fti29 r18aquq2'
function Wv([string]$name, [bool]$present, [string]$ct, [string]$cls, [int]$wvPid, [string]$fct, [string]$fcls, [int]$fpid, [uint32]$hostPid, [string]$proc) {
  [FakeWebView]::Present = $present; [FakeWebView]::ControlType = $ct; [FakeWebView]::ClassName = $cls; [FakeWebView]::Pid = $wvPid
  Out-Obj @{ case = 'webview'; variant = $name; result = [FakeWebView]::Resolve($fct, $fcls, $fpid, $hostPid, $proc) }
}
foreach ($proc in @('WINWORD', 'EXCEL', 'POWERPNT', 'ONENOTE', 'OUTLOOK', 'olk')) {
  Wv ("holder_composer_" + $proc) $true 'Edit' $FAI ([int]$me) 'Pane' 'WebView2Holder' ([int]$parent) $parent $proc
}
Wv 'holder_no_focused_edit' $false 'Edit' $FAI ([int]$me) 'Pane' 'WebView2Holder' ([int]$parent) $parent 'WINWORD'
Wv 'holder_found_non_edit' $true 'Document' $FAI ([int]$me) 'Pane' 'WebView2Holder' ([int]$parent) $parent 'WINWORD'
Wv 'holder_found_in_host_pid' $true 'Edit' $FAI ([int]$parent) 'Pane' 'WebView2Holder' ([int]$parent) $parent 'WINWORD'
Wv 'holder_found_unrelated_pid' $true 'Edit' $FAI 4 'Pane' 'WebView2Holder' ([int]$parent) $parent 'WINWORD'
Wv 'holder_focused_other_webview_edit' $true 'Edit' 'ms-rte-Editor elementToProof' ([int]$me) 'Pane' 'WebView2Holder' ([int]$parent) $parent 'WINWORD'
Wv 'non_holder_document' $true 'Edit' $FAI ([int]$me) 'Document' '_WwG' ([int]$parent) $parent 'WINWORD'
Wv 'holder_in_non_office_process' $true 'Edit' $FAI ([int]$me) 'Pane' 'WebView2Holder' ([int]$parent) $parent 'Code'
Wv 'holder_in_teams' $true 'Edit' $FAI ([int]$me) 'Pane' 'WebView2Holder' ([int]$parent) $parent 'ms-teams'
Wv 'holder_not_owned_by_host' $true 'Edit' $FAI ([int]$me) 'Pane' 'WebView2Holder' 4 $parent 'WINWORD'

# -- LIVE 2026-09-24 16:09: a blocked Copilot Studio agent in a Teams 1:1 -----
# The EXACT blocked-agents.json on the test machine (nulls and all) and the
# measured title SHAPE: Teams titled the IT Help Desk Agent 1:1 (Chat-list
# CKEditor composer, "@unq.gbl.spaces" header, feedback buttons on every reply)
# "Copilot | <agent> | <tenant> | <account> | Microsoft Teams". With only 'Chat'
# as a title kind the agent was never Named, the block never armed, and the
# fleet evidence route merely DLP-governed the chat (the attach-hold events).
# The collect loop above reuses $t, and PowerShell names are case-insensitive:
# restore the type handle GetF/SetF/Call use.
$T = [CfaiEnforcer]
$LIVE_ROWS = '[{"agent_id":"b2db5c7d-c111-43d3-87ab-30106bff186e","agent_name":"Gemini Conversation Agent 1","blocked_at":"2026-09-03T05:02:29.502Z","platform":"personal_agent","reason":"Blocked by admin from AI Systems","agent_scope":"agent","oauth_key_id":null,"orphaned":false,"unenforceable":false,"unenforceable_reason":null,"agent_aliases":"Gemini Conversation Agent 1"},{"agent_id":"44ba298c-c12d-f111-88b4-6045bd08b5e6","agent_name":"IT Help Desk Agent","agent_scope":"agent","blocked_at":"2026-09-24T10:38:35.626Z","oauth_key_id":null,"platform":"copilot_studio","reason":"Blocked by admin from AI Systems","orphaned":false,"unenforceable":false,"unenforceable_reason":null,"agent_aliases":"IT Help Desk Agent"},{"platform":"ai_platform","process_name":"chatgpt","agent_name":"OpenAI API","agent_id":"","host":"chatgpt.com","reason":"Blocked by organization policy"},{"platform":"ai_platform","process_name":"chatgpt classic","agent_name":"OpenAI API","agent_id":"","host":"chatgpt.com","reason":"Blocked by organization policy"}]'
$T_COPILOT_AGENT = 'Copilot | IT Help Desk Agent | filefuze | erik@filefuze.co | Microsoft Teams'
$T_CHAT_AGENT    = 'Chat | IT Help Desk Agent | filefuze | erik@filefuze.co | Microsoft Teams'
$T_COPILOT_HOME  = 'Copilot | filefuze | erik@filefuze.co | Microsoft Teams'
$T_COPILOT_GEN   = 'Copilot | Copilot | filefuze | erik@filefuze.co | Microsoft Teams'
$T_DM            = 'Sruthi Chimata | CloudFuze, Inc | p@cloudfuze.com | Microsoft Teams'
$M_EXTRACT = [CfaiEnforcer].GetMethod('ExtractAgentName', $FLAGS)
$TEAMS_SURFACE = Call 'MatchAgentSurface' @('ms-teams')
function TitleRead([string]$title) {
  $params = [object[]]@($TEAMS_SURFACE, '', $title, $null)
  $o = $M_EXTRACT.Invoke($null, $params)
  return ,@([string]$o, [string]$params[3], $o)
}
foreach ($tt in @(@('copilot_agent', $T_COPILOT_AGENT), @('chat_agent', $T_CHAT_AGENT), @('copilot_home', $T_COPILOT_HOME),
                 @('copilot_generic', $T_COPILOT_GEN), @('dm', $T_DM))) {
  $r = TitleRead $tt[1]
  Out-Obj @{ case = 'title'; variant = $tt[0]; outcome = $r[0]; namedAgent = ($r[1] -eq 'IT Help Desk Agent') }
}
[FakeInput]::Install()
function Capture([scriptblock]$body) {
  $orig = [Console]::Out; $sw = New-Object System.IO.StringWriter
  [Console]::SetOut($sw)
  $ret = $null
  try { $ret = & $body } finally { [Console]::SetOut($orig) }
  return ,@($ret, ($sw.ToString().Trim() -split "`r?`n" | Where-Object { $_ }))
}
function LiveState([string]$scenario, $extra = @{}) {
  $o = [ordered]@{
    case = 'live'; scenario = $scenario
    fgIsAi = [bool](GetF '_fgIsAi'); fgIsBlocked = [bool](GetF '_fgIsBlocked'); blockScope = [string](Call 'BlockScope')
    dlpGoverned = [bool](GetF '_fgDlpGoverned')
    enterBlocked = [bool](Call 'EnterBlockActive' @($false, $false, $false, $false))
    mouseBlocked = [bool](Call 'BlockActiveForMouse')
    sendRectGate = [bool](Call 'PanelSendRectSearchAllowed')
    hasRect = [bool](GetF '_hasRect')
  }
  foreach ($k in $extra.Keys) { $o[$k] = $extra[$k] }
  Out-Obj $o
}
function LiveTick([string]$scenario, [string]$title, [string]$rid = $R1, [string]$aid = $A1) {
  $r = TitleRead $title
  Tick $scenario 'ms-teams' $TEAMS_PID $COMPOSER $rid $aid -Settle -outcome $r[2] -agentName $r[1]
}
$ARROW = @(1737, 941, 41, 41)       # measured: the real send arrow
$POPUP_PT = @(1660, 960)            # measured: the message-extensions popup, 91px left
$IN = @(1757, 961)

function Age([string]$field, [int]$ms) {
  $v = [long](GetF $field)
  if ($v -ne 0) { SetF $field ([long]($v - ([TimeSpan]::FromMilliseconds($ms).Ticks))) }
}
# L1: the Copilot-kind title -> Named -> the agent block arms.
ResetState; Call 'DropHeldRect' | Out-Null; LoadRows $LIVE_ROWS; AgentPane $R1 $A1
LiveTick 'live_copilot_title' $T_COPILOT_AGENT
SetF '_hasRect' $false
$cached = [FakeInput]::Cache($ARROW[0], $ARROW[1], $ARROW[2], $ARROW[3])
$enter = Capture { [FakeInput]::Key(0x0D, $false, $false, $false) }
SetF '_lastBlockFiredTicks' ([long]0)
$ctrlEnter = Capture { [FakeInput]::Key(0x0D, $true, $false, $false) }
SetF '_lastBlockFiredTicks' ([long]0)
$shiftEnter = Capture { [FakeInput]::Key(0x0D, $false, $true, $false) }
$ctrlAltEnter = Capture { [FakeInput]::Key(0x0D, $true, $false, $true) }
$down = Capture { [FakeInput]::Mouse(0x0201, $IN[0], $IN[1]) }
$up = Capture { [FakeInput]::Mouse(0x0202, $IN[0], $IN[1]) }
$popup = Capture { [FakeInput]::Mouse(0x0201, $POPUP_PT[0], $POPUP_PT[1]) }
function Lines($c) { return @($c[1]) -join "`n" }
LiveState 'live_copilot_title' @{
  cached = [bool]$cached
  enter = [int]$enter[0]; enterLines = (Lines $enter)
  ctrlEnter = [int]$ctrlEnter[0]; ctrlEnterLines = (Lines $ctrlEnter)
  shiftEnter = [int]$shiftEnter[0]; ctrlAltEnter = [int]$ctrlAltEnter[0]; ctrlAltEnterLines = (Lines $ctrlAltEnter)
  clickDown = [int]$down[0]; clickDownLines = (Lines $down); clickUp = [int]$up[0]
  clickPopup = [int]$popup[0]
  rankPopup = [int](Call 'SendButtonRank' @('', 'sendMessageCommands-popup-semo', ''))
  rankArrow = [int](Call 'SendButtonRank' @('Send (Ctrl+Enter)', '', ''))
  rankWordSend = [int](Call 'SendButtonRank' @('Send', '', 'Send'))
  rankNone = [int](Call 'SendButtonRank' @('Attach file', 'attach', ''))
}

# L2: the Request Access dialog (focusable) takes the foreground. The blocked
# conversation's arrow stays covered by the HELD rect -- inside the 3s sticky
# window AND after it -- but never a click on a window OVER the arrow. The
# cooldown is zeroed first so nothing else can be what swallows.
Call 'UpdateHeldRect' | Out-Null
$heldAfterBlockedTick = [long](GetF '_heldUntilTicks') -ne 0
$DIALOG_PID = [uint32]77001
function DialogTick() {
  Call 'ApplyForegroundTick' @($DIALOG_PID, 'CloudFuze AI Governance', $false, $null, '', $false, $OUT_UNREADABLE, '') | Out-Null
  Call 'CheckFgBlocked' | Out-Null
  Call 'UpdateSendRect' | Out-Null
  Call 'UpdateHeldRect' | Out-Null
}
DialogTick
SetF '_lastBlockFiredTicks' ([long]0)
$stickyDown = Capture { [FakeInput]::Mouse(0x0201, $IN[0], $IN[1]) }
$stickyUp = Capture { [FakeInput]::Mouse(0x0202, $IN[0], $IN[1]) }
[FakeInput]::OtherL = 1700; [FakeInput]::OtherT = 900; [FakeInput]::OtherR = 1900; [FakeInput]::OtherB = 1100
$overDown = Capture { [FakeInput]::Mouse(0x0201, $IN[0], $IN[1]) }
[FakeInput]::OtherL = -1; [FakeInput]::OtherT = -1; [FakeInput]::OtherR = -1; [FakeInput]::OtherB = -1
$popupHeld = Capture { [FakeInput]::Mouse(0x0201, $POPUP_PT[0], $POPUP_PT[1]) }
LiveState 'live_sticky_dialog' @{ heldAfterBlockedTick = [bool]$heldAfterBlockedTick; clickDown = [int]$stickyDown[0]; clickUp = [int]$stickyUp[0]
  clickDownLines = (Lines $stickyDown); clickOverOther = [int]$overDown[0]; clickPopup = [int]$popupHeld[0] }
Age '_fgLeftAiTicks' 4000
DialogTick
$lateDown = Capture { [FakeInput]::Mouse(0x0201, $IN[0], $IN[1]) }
LiveState 'live_dialog_after_sticky' @{ clickDown = [int]$lateDown[0]; held = ([long](GetF '_heldUntilTicks') -ne 0) }

# L3: back in Teams, now on a human DM -> the hold is dropped at once.
$r = TitleRead $T_DM
Tick 'live_back_to_dm' 'ms-teams' $TEAMS_PID $COMPOSER $R2 $A2 -outcome $r[2] -agentName $r[1]
Call 'UpdateSendRect' | Out-Null
Call 'UpdateHeldRect' | Out-Null
$dmDown = Capture { [FakeInput]::Mouse(0x0201, $IN[0], $IN[1]) }
# ...and it does not come back when the dialog is raised again afterwards.
DialogTick
$dmDialogDown = Capture { [FakeInput]::Mouse(0x0201, $IN[0], $IN[1]) }
LiveState 'live_back_to_dm' @{ clickDown = [int]$dmDown[0]; clickDownDialogAgain = [int]$dmDialogDown[0]; held = ([long](GetF '_heldUntilTicks') -ne 0) }

# L4: the Chat-kind title still blocks.
ResetState; Call 'DropHeldRect' | Out-Null; LoadRows $LIVE_ROWS; AgentPane $R1 $A1
LiveTick 'live_chat_title' $T_CHAT_AGENT
LiveState 'live_chat_title'

# L5: the four-segment Copilot home (tenant in segment 1) -> nothing.
ResetState; Call 'DropHeldRect' | Out-Null; LoadRows $LIVE_ROWS; AgentPane $R1 $A1
LiveTick 'live_copilot_home' $T_COPILOT_HOME
LiveState 'live_copilot_home'

# L6: a "@thread.v2" GROUP chat renamed to the agent, under the Copilot title
# shape -> never blocked, no rect.
ResetState; Call 'DropHeldRect' | Out-Null; LoadRows $LIVE_ROWS
[FakePane]::Set($R1, $A1, [string[]]@((Hdr $GTID)), [string[]]$MSGS, [string[]]@((Fb $GTID '1727170000001') + (Fb $GTID '1727170000002')), $false)
SetF '_hasRect' $true; SetF '_rectRoot' ([System.IntPtr]::new(0x7001))
LiveTick 'live_group_renamed' $T_COPILOT_AGENT
Call 'UpdateSendRect' | Out-Null
$grpDown = Capture { [FakeInput]::Mouse(0x0201, $IN[0], $IN[1]) }
LiveState 'live_group_renamed' @{ clickDown = [int]$grpDown[0] }

# L7: a human 1:1 DM (no kind segment) -> never blocked, no rect.
ResetState; Call 'DropHeldRect' | Out-Null; LoadRows $LIVE_ROWS
[FakePane]::Set($R2, $A2, [string[]]@((Hdr $TID2)), [string[]]@('message-body-7'), [string[]]@(), $false)
SetF '_hasRect' $true; SetF '_rectRoot' ([System.IntPtr]::new(0x7001))
LiveTick 'live_human_dm' $T_DM $R2 $A2
Call 'UpdateSendRect' | Out-Null
$hdDown = Capture { [FakeInput]::Mouse(0x0201, $IN[0], $IN[1]) }
$hdEnter = Capture { [FakeInput]::Key(0x0D, $false, $false, $false) }
LiveState 'live_human_dm' @{ clickDown = [int]$hdDown[0]; enter = [int]$hdEnter[0] }
[FakeInput]::Uninstall()


# -- LIVE 2026-09-24 ~16:40: IT Help Desk Agent (blocked) in Word's Copilot pane --
# The composer is always Named "Message Copilot"; the selected agent is the LAST
# fai-CopilotMessage__accessibleHeading ("<agent> said:") in the pane's
# fai-CopilotChat transcript under the "mainChat" container. The pane walk is
# scripted; the gate, the parse, the cache, the block and the emitters are real.
$T = [CfaiEnforcer]
[FakePaneHeading]::Install()
$M_PANE = [CfaiEnforcer].GetMethod('ReadOfficePaneAgent', $FLAGS)
$WORD_PID = [uint32]9101
$WORD_RID = '42.9101.7'
function WordTick([string]$scenario, [bool]$found, [string]$heading, [string]$proc = 'WINWORD', [string]$rid = $WORD_RID) {
  [FakePaneHeading]::Found = $found; [FakePaneHeading]::Heading = $heading
  SetF '_paneAgentTicks' ([long]0)          # a fresh read (the 1s cache is tested separately)
  $hit = Call 'MatchPanelSignature' @($proc, $PANE[0], $PANE[1], $PANE[2])
  $armed = [bool](Call 'OfficePaneAgentReadArmed' @($proc, $hit))
  $outcome = $OUT_UNREADABLE; $name = ''
  if ($armed) {
    $params = [object[]]@((Call 'MatchAgentSurface' @($proc)), $rid, $null)
    $outcome = $M_PANE.Invoke($null, $params); $name = [string]$params[2]
  }
  Call 'ApplyForegroundTick' @([uint32]$WORD_PID, $proc, $true, $hit, $rid, $true, $outcome, $name) | Out-Null
  Call 'CheckFgBlocked' | Out-Null
  $enter = Capture { [FakeInput]::Key(0x0D, $false, $false, $false) }
  SetF '_lastBlockFiredTicks' ([long]0)
  $ctrlEnter = Capture { [FakeInput]::Key(0x0D, $true, $false, $false) }
  SetF '_lastBlockFiredTicks' ([long]0)
  SetF '_hasRect' $false
  $cached = $false
  if ([bool](Call 'PanelSendRectSearchAllowed')) { $cached = [FakeInput]::Cache(1821, 893, 28, 29) }   # measured Word "Send"
  $click = Capture { [FakeInput]::Mouse(0x0201, 1830, 900) }
  [FakeInput]::Mouse(0x0202, 1830, 900) | Out-Null
  SetF '_lastBlockFiredTicks' ([long]0)
  Out-Obj ([ordered]@{
    case = 'word'; scenario = $scenario; armed = $armed; outcome = [string]$outcome
    namedIsAgent = ($name -eq 'IT Help Desk Agent')
    fgIsBlocked = [bool](GetF '_fgIsBlocked'); blockScope = [string](Call 'BlockScope')
    enter = [int]$enter[0]; enterLines = (Lines $enter); ctrlEnter = [int]$ctrlEnter[0]
    cached = [bool]$cached; click = [int]$click[0]; clickLines = (Lines $click)
    walkArgs = ([FakePaneHeading]::LastContainer + '|' + [FakePaneHeading]::LastTranscript + '|' + [FakePaneHeading]::LastHeadingClass)
  })
}
ResetState; Call 'DropHeldRect' | Out-Null; LoadRows $LIVE_ROWS
WordTick 'word_agent_blocked' $true 'IT Help Desk Agent said:'
# The user switches the pane back to Copilot -> released on the same tick.
WordTick 'word_back_to_copilot' $true 'Copilot said:'
ResetState; Call 'DropHeldRect' | Out-Null; LoadRows $LIVE_ROWS
WordTick 'word_copilot_reply' $true 'Copilot said:'
WordTick 'word_new_chat' $true ''
WordTick 'word_no_container' $false ''
WordTick 'word_other_agent' $true 'Expenses Helper said:'
WordTick 'word_unknown_shape' $true 'IT Help Desk Agent'
# Excel carries the same pane but was never measured: inert.
ResetState; Call 'DropHeldRect' | Out-Null; LoadRows $LIVE_ROWS
WordTick 'excel_not_verified' $true 'IT Help Desk Agent said:' 'EXCEL'
# No agent-scoped row covering Word -> the pane is never walked at all.
ResetState; Call 'DropHeldRect' | Out-Null; LoadRows '[{"platform":"ai_platform","process_name":"chatgpt","agent_name":"OpenAI API","agent_id":"","host":"chatgpt.com","reason":"x"}]'
[FakePaneHeading]::Calls = 0
WordTick 'word_no_agent_row' $true 'IT Help Desk Agent said:'
Out-Obj @{ case = 'word_calls'; variant = 'no_agent_row'; calls = [int][FakePaneHeading]::Calls }
# The per-composer cache: a second read inside 1s does not re-walk.
ResetState; LoadRows $LIVE_ROWS
[FakePaneHeading]::Calls = 0; [FakePaneHeading]::Found = $true; [FakePaneHeading]::Heading = 'IT Help Desk Agent said:'
SetF '_paneAgentTicks' ([long]0)
$sf = Call 'MatchAgentSurface' @('WINWORD')
$pa = [object[]]@($sf, 'rid-cache', $null); $M_PANE.Invoke($null, $pa) | Out-Null
$pb = [object[]]@($sf, 'rid-cache', $null); $M_PANE.Invoke($null, $pb) | Out-Null
$pc = [object[]]@($sf, 'rid-other', $null); $M_PANE.Invoke($null, $pc) | Out-Null
Out-Obj @{ case = 'word_calls'; variant = 'cache'; calls = [int][FakePaneHeading]::Calls }
LoadRows '[]'
[FakeInput]::Uninstall()

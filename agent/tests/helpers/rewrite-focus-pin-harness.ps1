# Behavioural harness for Tier B's FOCUSED-ELEMENT PIN, its PRE-ENTER GATE and
# the RICH-CONTENT refusal in enforcer-win.ps1.
#
# NOTHING HERE INSTALLS A KEYBOARD HOOK, AND NOTHING HERE TYPES ANYTHING.
# [CfaiEnforcer]::Start() is never called. The write path IS driven — that is
# the point, because "focus moved during the modifier wait, so Ctrl+A was never
# sent" is a claim about what the write path DOES — but it is driven through
# RunRewriteCore with a SCRIPTED FAKE of its I/O seam (IRewriteIo), compiled
# below into the same assembly. The fake records every key it is asked to send
# and sends none; LiveRewriteIo (the only implementation that reaches
# SendInput) is never constructed here, and the test asserts this file never
# names it. agent/tests separately pins that RunRewriteCore makes no direct
# SendInput / SendKey* / Thread.Sleep / GetForegroundWindow / AutomationElement
# call, so the fake sees every side effect there is.
#
# Also driven, by reflection: SubtreeHasRichContent (the bounded walk behind the
# rich-content refusal) over synthetic trees, and EstimateWriteMs /
# WriteFitsBudget.
#
# Emits NDJSON on stdout; agent/tests asserts on it.
param([Parameter(Mandatory=$true)][string]$Ps1)

$ErrorActionPreference = 'Stop'

$raw = Get-Content -Raw -LiteralPath $Ps1
$startIdx = $raw.IndexOf("`$source = @'")
if ($startIdx -lt 0) { throw 'could not find the $source here-string in enforcer-win.ps1' }
$bodyStart = $raw.IndexOf("`n", $startIdx) + 1
$endIdx = $raw.IndexOf("`n'@", $bodyStart)
if ($endIdx -lt 0) { throw 'could not find the end of the $source here-string' }
$source = $raw.Substring($bodyStart, $endIdx - $bodyStart)

# The fake seam and a synthetic tree node, compiled INTO the same assembly so
# they can implement / reach the enforcer's internal interface.
$fakeSource = @'
public class FakeRewriteIo : CfaiEnforcer.IRewriteIo
{
    public System.IntPtr Hwnd = new System.IntPtr(4242);
    public int[] Rid = new int[] { 42, 7, 1 };
    public int[] OtherRid = new int[] { 42, 7, 99 };
    public bool HasElement = true;
    public bool Rich = false;
    // How many fresh FocusedRuntimeId() reads return the pinned id before
    // focus "moves" (-1 = never moves).
    public int GoodReads = -1;
    // Fresh reads (0-based) that return null — an unreadable UIA read.
    public System.Collections.Generic.HashSet<int> NullReads = new System.Collections.Generic.HashSet<int>();
    // How many KeysHeld() polls report the confirm chord still held.
    public int HeldPolls = 0;
    // After this many KeysHeld() polls the foreground window changes (-1 = never).
    public int FgChangesAfterHeldPolls = -1;
    public string Composer = "";
    public bool EnterClears = true;
    // Model a REAL keystroke/click arriving (the hook sets _rewriteAbort) at
    // the n-th KeysHeld() poll or the n-th fresh pin read (-1 = never).
    public int AbortAtHeldPoll = -1;
    public int AbortAtRidRead = -1;
    // Model a paste / script input landing in the composer at the n-th fresh
    // pin read — i.e. after the verify, before the Enter (-1 = never).
    public int ChangeAtRidRead = -1;
    public string ChangeTo = null;
    public System.Collections.Generic.List<string> Log = new System.Collections.Generic.List<string>();
    int _reads = 0, _held = 0;
    bool _fgMoved = false;

    static void SetAbort()
    {
        typeof(CfaiEnforcer).GetField("_rewriteAbort",
            System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Static).SetValue(null, true);
    }

    public System.IntPtr ForegroundWindow() { return _fgMoved ? new System.IntPtr(777) : Hwnd; }
    public bool PinFocused(out int[] runtimeId) { runtimeId = HasElement ? Rid : null; return HasElement; }
    public int[] FocusedRuntimeId()
    {
        int n = _reads++;
        Log.Add("rid_read");
        if (n == AbortAtRidRead) SetAbort();
        if (n == ChangeAtRidRead && ChangeTo != null) Composer = ChangeTo;
        if (NullReads.Contains(n)) return null;
        if (GoodReads >= 0 && n >= GoodReads) return OtherRid;
        return Rid;
    }
    // Invisible editor bookkeeping characters a real composer read carries
    // (CKEditor inline filler U+2060 x7 in Teams, U+FFFC in M365 Copilot),
    // inserted at FillerAt (-1 = end) of EVERY read.
    public string Filler = "";
    public int FillerAt = -1;
    public string ReadPinned()
    {
        if (Filler.Length == 0) return Composer;
        int at = (FillerAt < 0 || FillerAt > Composer.Length) ? Composer.Length : FillerAt;
        return Composer.Substring(0, at) + Filler + Composer.Substring(at);
    }
    public bool PinnedHasRichContent() { return Rich; }
    public bool KeysHeld()
    {
        _held++;
        if (_held == AbortAtHeldPoll) SetAbort();
        if (FgChangesAfterHeldPolls >= 0 && _held > FgChangesAfterHeldPolls) _fgMoved = true;
        return _held <= HeldPolls;
    }
    public void KeyCombo(int vkMod, int vkKey)
    {
        Log.Add("combo:" + vkMod + ":" + vkKey);
        if (vkMod == 0x11 && vkKey == 0x41) Log.Add("selectall");
        else Composer += "\n";
    }
    public void KeyPress(int vk)
    {
        Log.Add("press:" + vk);
        if (vk == 0x2E) Composer = "";
        if (vk == 0x0D && EnterClears) Composer = "";
    }
    public void TypeChunk(string chunk) { Log.Add("type:" + chunk); Composer += chunk; }
    public void Sleep(int ms) { }
}

public class FakeNode
{
    public int TypeId;
    public FakeNode FirstChild;
    public FakeNode Next;
    public FakeNode(int typeId) { TypeId = typeId; }
    public static System.Func<object, object> FirstChildFn = n => ((FakeNode)n).FirstChild;
    public static System.Func<object, object> NextFn = n => ((FakeNode)n).Next;
    public static System.Func<object, int> TypeFn = n => ((FakeNode)n).TypeId;
    // Children in order, returning the parent for chaining.
    public FakeNode Kids(params FakeNode[] kids)
    {
        FirstChild = kids.Length > 0 ? kids[0] : null;
        for (int i = 0; i + 1 < kids.Length; i++) kids[i].Next = kids[i + 1];
        return this;
    }
    public static int Id(string name)
    {
        switch (name)
        {
            case "Edit": return System.Windows.Automation.ControlType.Edit.Id;
            case "Text": return System.Windows.Automation.ControlType.Text.Id;
            case "Group": return System.Windows.Automation.ControlType.Group.Id;
            case "Document": return System.Windows.Automation.ControlType.Document.Id;
            case "Button": return System.Windows.Automation.ControlType.Button.Id;
            case "Hyperlink": return System.Windows.Automation.ControlType.Hyperlink.Id;
            case "Image": return System.Windows.Automation.ControlType.Image.Id;
            case "Table": return System.Windows.Automation.ControlType.Table.Id;
            case "List": return System.Windows.Automation.ControlType.List.Id;
        }
        throw new System.ArgumentException(name);
    }
}
'@

Add-Type -TypeDefinition ($source + "`n" + $fakeSource) -ReferencedAssemblies @(
    'System.Windows.Forms','UIAutomationClient','UIAutomationTypes','WindowsBase','System.Web.Extensions'
) -ErrorAction Stop

$T = [CfaiEnforcer]
$FLAGS = [System.Reflection.BindingFlags]'NonPublic,Public,Static'
$IFLAGS = [System.Reflection.BindingFlags]'NonPublic,Public,Instance'
function GetF([string]$n) { $f = $T.GetField($n, $FLAGS); if (-not $f) { return $null }; $f.GetValue($null) }
function SetF([string]$n, $v) { $f = $T.GetField($n, $FLAGS); if (-not $f) { throw "no field $n" }; $f.SetValue($null, $v) }
function HasMethod([string]$n) { return [bool]$T.GetMethod($n, $FLAGS) }
function Call([string]$n, [object[]]$a = @()) {
  $m = $T.GetMethod($n, $FLAGS)
  if (-not $m) { throw "no method $n" }
  try { return $m.Invoke($null, $a) } catch { throw $_.Exception.InnerException }
}
function Out-Obj($obj) { Write-Output ($obj | ConvertTo-Json -Compress -Depth 5) }

# Start() builds the pattern table; ScanNames iterates it. ONE real pattern
# (SSN, the same regex the multi-line harness uses), so the read-back rescan and
# the final pre-Enter rescan are real: the masked "[SSN]" is clean, and a
# pasted SSN is not.
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
SetF '_app' 'Claude'
SetF '_fgIsPanel' $false
SetF '_fgPanelId' ''

$available = (HasMethod 'RunRewriteCore') -and (HasMethod 'FocusStillPinned') -and (HasMethod 'SubtreeHasRichContent')
Out-Obj @{ case = 'constants'; available = $available
           pin_read_ms = (GetF 'REWRITE_FOCUS_PIN_READ_MS')
           pin_every_chunks = (GetF 'REWRITE_FOCUS_PIN_EVERY_CHUNKS')
           chunk = (GetF 'REWRITE_CHUNK')
           rich_max_nodes = (GetF 'RICH_WALK_MAX_NODES')
           usable_ms = (GetF 'REWRITE_USABLE_BUDGET_MS')
           max_chars = (GetF 'REWRITE_MAX_CHARS') }

# One scripted rewrite. Everything EmitRewrite / Emit write to Console.Out is
# captured and returned alongside the fake's log.
function Rewrite([string]$name, [string]$original, [string]$masked, [scriptblock]$setup) {
  $io = New-Object FakeRewriteIo
  $io.Composer = $original
  if ($setup) { & $setup $io }
  SetF '_rewriteAbort' $false
  SetF '_blockUia' $false
  SetF '_uiaPatterns' ''
  $orig = [Console]::Out
  $sw = New-Object System.IO.StringWriter
  [Console]::SetOut($sw)
  try { Call 'RunRewriteCore' @($io.psobject.BaseObject, "blk-$name", $original, $masked, [int[]]$io.Rid, $io.Hwnd) | Out-Null }
  finally { [Console]::SetOut($orig) }
  $lines = @($sw.ToString() -split "`r?`n" | Where-Object { $_.Trim().Length -gt 0 })
  $rewrite = $null
  foreach ($l in $lines) { $o = $l | ConvertFrom-Json; if ($o.kind -eq 'rewrite') { $rewrite = $o } }
  Out-Obj @{ case = 'rewrite'; variant = $name
             result = $(if ($rewrite) { [string]$rewrite.result } else { $null })
             reason = $(if ($rewrite) { [string]$rewrite.reason } else { $null })
             log = @($io.Log)
             prompt_emitted = [bool](@($lines | Where-Object { $_ -match '"kind":"prompt"' }).Count -gt 0)
             block_uia = [bool](GetF '_blockUia')
             uia_patterns = [string](GetF '_uiaPatterns')
             composer = $io.Composer }
}

$ORIG = 'my ssn is 123-45-6789'
$MASK = 'my ssn is [SSN]'
$ORIG_ML = "hello team`nmy ssn is 123-45-6789`nthanks"
$MASK_ML = "hello team`nmy ssn is [SSN]`nthanks"
# 130 characters on one line: 6 chunks of 24, so the in-segment pin check
# fires before chunk index 4.
$LONG_ORIG = ('a' * 100) + ' ssn 123-45-6789 ' + ('b' * 13)
$LONG_MASK = ('a' * 100) + ' ssn [SSN] ' + ('b' * 19)

if ($available) {
  # The happy path: every pin read agrees, the send lands.
  Rewrite 'happy_single' $ORIG $MASK { param($io) $io.HeldPolls = 3 }
  Rewrite 'happy_multiline' $ORIG_ML $MASK_ML { param($io) }
  Rewrite 'happy_long_line' $LONG_ORIG $LONG_MASK { param($io) }
  # (a) Focus moves to another element in the SAME window while the user is
  # still releasing the confirm chord. The first fresh read already disagrees.
  Rewrite 'focus_moves_during_modifier_wait' $ORIG $MASK { param($io) $io.HeldPolls = 10; $io.GoodReads = 0 }
  # (a) An unreadable read, twice in a row — not provably the same element.
  Rewrite 'unreadable_twice_before_ctrl_a' $ORIG $MASK { param($io) [void]$io.NullReads.Add(0); [void]$io.NullReads.Add(1) }
  # (a) A single UIA hiccup, retried once — the rewrite proceeds.
  Rewrite 'unreadable_once_then_ok' $ORIG $MASK { param($io) [void]$io.NullReads.Add(0) }
  # The WINDOW changes during the modifier wait.
  Rewrite 'window_changes_during_modifier_wait' $ORIG $MASK { param($io) $io.HeldPolls = 5; $io.FgChangesAfterHeldPolls = 2 }
  # (a) A REAL keystroke during the modifier wait (the hook sets _rewriteAbort).
  Rewrite 'keypress_during_modifier_wait' $ORIG $MASK { param($io) $io.HeldPolls = 5; $io.AbortAtHeldPoll = 2 }
  # After the verified write: a keystroke / a paste lands before Enter. Reads
  # for a single segment: 0 = (a), 1 = segment, 2 = (c).
  Rewrite 'keypress_before_enter' $ORIG $MASK { param($io) $io.AbortAtRidRead = 2 }
  Rewrite 'sensitive_paste_before_enter' $ORIG $MASK { param($io) $io.ChangeAtRidRead = 2; $io.ChangeTo = 'my ssn is [SSN] 987-65-4321' }
  Rewrite 'benign_change_before_enter' $ORIG $MASK { param($io) $io.ChangeAtRidRead = 2; $io.ChangeTo = 'my ssn is [SSN] thanks' }
  # (b) Focus moves between line segments: reads (a) and segment 0 agree, the
  # segment-1 read does not.
  Rewrite 'focus_moves_mid_write_multiline' $ORIG_ML $MASK_ML { param($io) $io.GoodReads = 2 }
  # (b) Focus moves inside one long line: (a) and segment 0 agree, the
  # every-N-chunks read disagrees.
  Rewrite 'focus_moves_mid_write_long_line' $LONG_ORIG $LONG_MASK { param($io) $io.GoodReads = 2 }
  # (c) Focus moves after the verified write, before Enter.
  Rewrite 'focus_moves_before_enter' $ORIG $MASK { param($io) $io.GoodReads = 2 }
  # Rich content in the composer: refused before anything is cleared.
  Rewrite 'rich_content_composer' $ORIG $MASK { param($io) $io.Rich = $true }
  # BUG B (2026-09-24): the Teams CKEditor inline filler (U+2060 x7) and the
  # M365 Copilot U+FFFC in every composer read must not stop the send.
  Rewrite 'teams_ckeditor_inline_filler' $ORIG $MASK { param($io) $io.Filler = ([string][char]0x2060) * 7; $io.FillerAt = 10 }
  Rewrite 'teams_ckeditor_filler_at_end' $ORIG $MASK { param($io) $io.Filler = ([string][char]0x2060) * 7 }
  Rewrite 'm365_object_replacement_char' $ORIG $MASK { param($io) $io.Filler = [string][char]0xFFFC }
  Rewrite 'zero_width_mix' $ORIG $MASK { param($io) $io.Filler = ([string][char]0x200B) + ([string][char]0xFEFF) + ([string][char]0x00AD); $io.FillerAt = 3 }
}

# ── The bounded rich-content walk, over synthetic trees ─────────────────────
function N([string]$t) { return New-Object FakeNode ([FakeNode]::Id($t)) }
function Walk([string]$name, $root, [int]$max = -1) {
  if (-not $available) { Out-Obj @{ case = 'rich_walk'; variant = $name; available = $false }; return }
  if ($max -lt 0) { $max = [int](GetF 'RICH_WALK_MAX_NODES') }
  $params = [object[]]@($root.psobject.BaseObject, [FakeNode]::FirstChildFn, [FakeNode]::NextFn, [FakeNode]::TypeFn, $max, 0)
  $m = $T.GetMethod('SubtreeHasRichContent', $FLAGS)
  $rich = [bool]$m.Invoke($null, $params)
  Out-Obj @{ case = 'rich_walk'; variant = $name; available = $true; rich = $rich; visited = [int]$params[5] }
}
function Flat([int]$count, [string]$type) {
  $kids = @(); for ($i = 0; $i -lt $count; $i++) { $kids += (N $type) }
  return ,$kids
}

Walk 'plain_composer' ((N 'Edit').Kids((N 'Text'), (N 'Text'), (N 'Group').Kids((N 'Text'))))
Walk 'empty_composer' (N 'Edit')
Walk 'mention_pill_hyperlink' ((N 'Edit').Kids((N 'Text'), (N 'Hyperlink'), (N 'Text')))
Walk 'inline_image' ((N 'Document').Kids((N 'Group').Kids((N 'Text'), (N 'Image'))))
Walk 'table' ((N 'Edit').Kids((N 'Table').Kids((N 'Text'))))
Walk 'code_block_list' ((N 'Edit').Kids((N 'Group').Kids((N 'Group').Kids((N 'List')))))
# The ROOT is the composer and is never classified — a composer that is itself
# a List (it is not, but the rule must not depend on that) is not "rich".
Walk 'root_itself_is_list' ((N 'List').Kids((N 'Text')))
# The BOUND: 60 plain nodes and a Hyperlink as the 61st — never reached, but
# the cap is hit with nodes unvisited, so it is refused anyway (fail closed).
$kids = Flat 60 'Text'; $kids += (N 'Hyperlink')
Walk 'rich_beyond_cap' ((N 'Edit').Kids([FakeNode[]]$kids))
# …and one AT the cap (the 50th descendant) IS reached.
$kids = Flat 49 'Text'; $kids += (N 'Image')
Walk 'rich_at_cap' ((N 'Edit').Kids([FakeNode[]]$kids))
# A long plain composer hits the cap WITHOUT a verdict: fail closed, rich.
Walk 'plain_hits_cap' ((N 'Edit').Kids([FakeNode[]](Flat 200 'Text')))
# Exactly the cap and nothing more: every node was seen, so plain is plain.
Walk 'plain_exactly_cap' ((N 'Edit').Kids([FakeNode[]](Flat 50 'Text')))
# Deep nesting is walked depth-first within the same bound.
$deep = N 'Edit'; $cur = $deep
for ($i = 0; $i -lt 30; $i++) { $g = N 'Group'; $cur.Kids($g) | Out-Null; $cur = $g }
$cur.Kids((N 'Hyperlink')) | Out-Null
Walk 'deep_hyperlink' $deep

# ── EstimateWriteMs charges the pin reads the loop makes ────────────────────
foreach ($s in @(
  @{ name = 'one_char'; text = 'x' }
  @{ name = 'five_chunks'; text = ('x' * 120) }
  @{ name = 'six_chunks'; text = ('x' * 130) }
  @{ name = 'three_lines'; text = "a`nb`nc" }
  # The derived cap on one line — the offer the pin reads must not have lost.
  @{ name = 'max_chars_line'; text = ('x' * [int](GetF 'REWRITE_MAX_CHARS')) }
)) {
  Out-Obj @{ case = 'estimate'; variant = $s.name; len = $s.text.Length
             estimate_ms = [int](Call 'EstimateWriteMs' @($s.text))
             fits = [bool](Call 'WriteFitsBudget' @($s.text)) }
}

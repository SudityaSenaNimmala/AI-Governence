# Behavioural harness for enforcer-win.ps1's IDE-panel platform-block path.
#
# NOTHING HERE INSTALLS A KEYBOARD HOOK. [CfaiEnforcer]::Start() is never
# called, so no hook, no mouse hook, no threads, no message pump. The C# source
# is lifted out of the .ps1 and compiled on its own, then the poll-thread state
# machine (ApplyForegroundTick / CheckFgBlocked) and the Enter predicate
# (EnterBlockActive) are driven directly by reflection.
#
# The ONE thing substituted is the AutomationElement.FocusedElement lookup. Its
# result is built by feeding MEASURED UIA property values — captured from a real
# VS Code window with Claude Code and GitHub Copilot Chat both live (see the
# FOCUS_* constants below) — through the REAL MatchPanelSignature. Everything
# that interprets a read is production code.
#
# Emits one NDJSON line per observation on stdout; agent/tests asserts on them.
param([Parameter(Mandatory=$true)][string]$Ps1)

$ErrorActionPreference = 'Stop'

$raw = Get-Content -Raw -LiteralPath $Ps1
$startIdx = $raw.IndexOf("`$source = @'")
if ($startIdx -lt 0) { throw 'could not find the $source here-string in enforcer-win.ps1' }
$bodyStart = $raw.IndexOf("`n", $startIdx) + 1
$endIdx = $raw.IndexOf("`n'@", $bodyStart)
if ($endIdx -lt 0) { throw 'could not find the end of the $source here-string' }
$source = $raw.Substring($bodyStart, $endIdx - $bodyStart)

Add-Type -TypeDefinition $source -ReferencedAssemblies @(
    'System.Windows.Forms','UIAutomationClient','UIAutomationTypes','WindowsBase','System.Web.Extensions'
) -ErrorAction Stop

$T = [CfaiEnforcer]
$FLAGS = [System.Reflection.BindingFlags]'NonPublic,Public,Static'
function GetF([string]$n) { $f = $T.GetField($n, $FLAGS); if (-not $f) { throw "no field $n" }; $f.GetValue($null) }
function SetF([string]$n, $v) { $f = $T.GetField($n, $FLAGS); if (-not $f) { throw "no field $n" }; $f.SetValue($null, $v) }
# Membership test against a static HashSet field. NOT GetF + .Contains(): a
# collection RETURNED from a PowerShell function is enumerated, so an empty set
# comes back as $null and a set of one comes back as a bare string. Keeping the
# set inside this function is what stops the harness from silently testing the
# wrong thing.
function HasProc([string]$field, [string]$name) {
  $f = $T.GetField($field, $FLAGS)
  if (-not $f) { throw "no field $field" }
  $set = $f.GetValue($null)
  if ($null -eq $set) { return $false }
  return [bool]$set.Contains($name)
}
function Call([string]$n, [object[]]$a = @()) {
  $m = $T.GetMethod($n, $FLAGS)
  if (-not $m) { throw "no method $n" }
  try { return $m.Invoke($null, $a) } catch { throw $_.Exception.InnerException }
}

# ── real catalog payloads (byte-identical to what enforcer.js ships) ─────────
$IDE_JSON    = '[{"name":"code","panelFallback":false},{"name":"cursor","panelFallback":false}]'
# The three IDE panels, byte-identical to buildAiPanelConfig()'s output, plus
# teams_composer — which ships enforce:false, exactly as the catalog has it.
# $PANELS_TEAMS_ARMED is the TEST-ONLY flip, paired with $SURFACES_TEAMS_ARMED
# below; both flags have to be on for a host app to gate anything.
#
# `dlpMatch` / `newlineKeys` travel on every entry, exactly as
# buildAiPanelConfig() ships them: 'agent' is the strict default (a named
# governed/blocked row is required before a HOST-APP tick is governed), and only
# teams_copilot_composer carries 'panel'.
$IDE_PANELS = '{"id":"claude_code","procs":["Code","Cursor"],"controlType":"Edit","nameEquals":"Message input","namePrefix":"","classEquals":"","classPrefix":"messageInput_","enforce":true,"dlpMatch":"agent","newlineKeys":"shift_enter"},{"id":"vscode_chat","procs":["Code","Cursor"],"controlType":"Edit","nameEquals":"","namePrefix":"Chat Input","classEquals":"","classPrefix":"","enforce":false,"dlpMatch":"agent","newlineKeys":"shift_enter"},{"id":"cursor_composer","procs":["Cursor"],"controlType":"Edit","nameEquals":"","namePrefix":"","classEquals":"aislash-editor-input","classPrefix":"","enforce":true,"dlpMatch":"agent","newlineKeys":"shift_enter"}'
$TEAMS_PANEL_OFF = '{"id":"teams_composer","procs":["ms-teams"],"controlType":"Edit","nameEquals":"","namePrefix":"","classEquals":"ck-editor__editable","classPrefix":"","enforce":false,"dlpMatch":"agent","newlineKeys":"shift_enter"}'
$TEAMS_PANEL_ON  = '{"id":"teams_composer","procs":["ms-teams"],"controlType":"Edit","nameEquals":"","namePrefix":"","classEquals":"ck-editor__editable","classPrefix":"","enforce":true,"dlpMatch":"agent","newlineKeys":"shift_enter"}'
# The SECOND Teams composer: the one inside the embedded "Copilot" tab. A
# genuinely different editor implementation from the CKEditor above (measured
# live 2026-09 — no ck-editor__editable token anywhere in its ClassName), so it
# needs its own signature. Ships enforce:false, exactly as the catalog has it;
# $TEAMS_COPILOT_PANEL_ON is the TEST-ONLY flip.
$TEAMS_COPILOT_PANEL_OFF = '{"id":"teams_copilot_composer","procs":["ms-teams"],"controlType":"Edit","nameEquals":"","namePrefix":"","classEquals":"fai-EditorInput__input","classPrefix":"","enforce":false,"dlpMatch":"panel","newlineKeys":"shift_enter"}'
$TEAMS_COPILOT_PANEL_ON  = '{"id":"teams_copilot_composer","procs":["ms-teams"],"controlType":"Edit","nameEquals":"","namePrefix":"","classEquals":"fai-EditorInput__input","classPrefix":"","enforce":true,"dlpMatch":"panel","newlineKeys":"shift_enter"}'
# The SAME Copilot-tab composer with the STRICT default instead of 'panel'. Not
# a shipped shape — a fixture, and the control for the panel-alone scenarios: it
# proves those pass because of the catalog field and not because the Copilot tab
# is special-cased anywhere in the C#.
$TEAMS_COPILOT_PANEL_STRICT = '{"id":"teams_copilot_composer","procs":["ms-teams"],"controlType":"Edit","nameEquals":"","namePrefix":"","classEquals":"fai-EditorInput__input","classPrefix":"","enforce":true,"dlpMatch":"agent","newlineKeys":"shift_enter"}'
$PANELS_JSON        = '[' + $IDE_PANELS + ',' + $TEAMS_PANEL_OFF + ',' + $TEAMS_COPILOT_PANEL_OFF + ']'
$PANELS_TEAMS_ARMED = '[' + $IDE_PANELS + ',' + $TEAMS_PANEL_ON + ',' + $TEAMS_COPILOT_PANEL_OFF + ']'
# Both Teams composers armed — what the Copilot-tab scenarios need, since that
# route's block has to come through ITS panel, not the Chat-list one.
$PANELS_COPILOT_ARMED = '[' + $IDE_PANELS + ',' + $TEAMS_PANEL_ON + ',' + $TEAMS_COPILOT_PANEL_ON + ']'
# Both armed, but the Copilot tab held at the strict 'agent' rule — the control
# for the panel-alone DLP scenarios.
$PANELS_COPILOT_STRICT = '[' + $IDE_PANELS + ',' + $TEAMS_PANEL_ON + ',' + $TEAMS_COPILOT_PANEL_STRICT + ']'
# exactly synthesizePlatformBlocks([{ host: 'claude.ai', product: 'Claude', blocked: true }])
$ROWS_CLAUDE = '[{"platform":"ai_platform","process_name":"claude","agent_name":"Claude","agent_id":"","host":"claude.ai","reason":"Blocked by organization policy"},{"platform":"ai_platform","panel":"claude_code","agent_name":"Claude","agent_id":"","host":"claude.ai","reason":"Blocked by organization policy"}]'
# a detection-only panel with a row of its own — must still never block
$ROWS_VSCODE_CHAT = '[{"platform":"ai_platform","panel":"vscode_chat","agent_name":"GitHub Copilot","agent_id":"","host":"github.com","reason":"Blocked by organization policy"}]'
# exactly synthesizePlatformBlocks([{ host: 'cursor.com', product: 'Cursor', blocked: true }])
# — one PANEL row and no process_name row, because blocking the whole Cursor
# process off a browser-inventory toggle would be a catastrophic false positive.
$ROWS_CURSOR = '[{"platform":"ai_platform","panel":"cursor_composer","agent_name":"Cursor","agent_id":"","host":"cursor.com","reason":"Blocked by organization policy"}]'
$ROWS_EMPTY = '[]'

Call 'LoadIdeProcesses' @($IDE_JSON)
Call 'LoadAiPanels'     @($PANELS_JSON)

# ── AGENT SURFACES (agent_scope:'agent') ────────────────────────────────────
#
# Two payloads, and the difference between them is the point.
#
# $SURFACES_SHIPPED is byte-identical to what buildAgentSurfaceConfig() ships
# TODAY: m365_copilot, enforce:true, verified:true. It passed its live
# verification pass on 2026-08-27 against a real Microsoft 365 Copilot install
# with a real added agent, so the narrowing scenarios below are the SHIPPING
# behaviour, not a hypothetical.
#
# $SURFACES_WITH_UNVERIFIED adds a second, still-hypothetical entry for the
# STANDALONE Microsoft Copilot app with both flags false — the shape any future
# surface ships in before its own live pass. It exists to keep the safety GATE
# under test now that m365_copilot is no longer an example of one: an unverified
# surface must never narrow, so an agent-scoped row covering it still produces
# exactly the whole-app block it produced before this feature existed. Both
# entries are present in the same payload, so one tick sequence shows a verified
# surface narrowing and an unverified one not.
#
# NONE of the *_OFF fixtures below describe the shipped catalog any more. Every
# pair in the real catalog is now past its gate — teams_desktop's own pair since
# its 2026-08-30 live pass, the nested fallbackRead pair since its own pass on
# 2026-09-02 — and ai-processes.test.mjs is what pins those shipped values. The
# false/false variants here are DELIBERATE FIXTURES, kept precisely because no
# shipped entry is an example of an unverified surface any more, and the safety
# gate still has to be exercised:
#   $TEAMS_SURFACE_OFF — the shape teams_desktop had before 2026-08-30. Keeps the
#                        "an unverified HOST-APP surface blocks nothing at all"
#                        inversion under test.
#   $TEAMS_FB_OFF      — the same idea for the SECOND UI route (Teams' embedded
#                        Copilot tab, whose window title names no conversation).
#                        It carries its OWN enforce/verified pair; this fixture
#                        holds that pair at false to test the "route not yet
#                        verified" scenario specifically.
#   $TEAMS_FB_ON       — that pair at its shipped true/true, used to drive the
#                        mechanism.
# So the payload matching buildAgentSurfaceConfig()'s current output is
# $TEAMS_SURFACE_COPILOT_ON (both pairs true), not $TEAMS_SURFACE_ON. The
# variable names are historical; the flags in each string are what matters, and
# setting them here is never a catalog change.
$TEAMS_FB_OFF = '"fallbackRead":{"mode":"message_heading","paneKinds":["Copilot"],"headingClass":"fai-CopilotMessage__accessibleHeading","headingSuffix":" said:","landingInfix":" Created by ","genericNames":["Copilot","Microsoft 365 Copilot","You"],"enforce":false,"verified":false}'
$TEAMS_FB_ON  = '"fallbackRead":{"mode":"message_heading","paneKinds":["Copilot"],"headingClass":"fai-CopilotMessage__accessibleHeading","headingSuffix":" said:","landingInfix":" Created by ","genericNames":["Copilot","Microsoft 365 Copilot","You"],"enforce":true,"verified":true}'
$TEAMS_SURFACE_HEAD = '{"id":"teams_desktop","procs":["ms-teams"],"controlType":"Edit","composerNamePrefixes":[],"genericNames":["Copilot","Chat","Microsoft Teams","Meeting chat"],"read":"window_title","titleSeparator":" | ","titleSuffix":"Microsoft Teams","titleKinds":["Chat"],"hostApp":true,'
$TEAMS_SURFACE_OFF = $TEAMS_SURFACE_HEAD + '"enforce":false,"verified":false,' + $TEAMS_FB_OFF + '}'
$TEAMS_SURFACE_ON  = $TEAMS_SURFACE_HEAD + '"enforce":true,"verified":true,' + $TEAMS_FB_OFF + '}'
# The Chat-list route armed AND the Copilot-tab fallback armed. Two independent
# gates, so this is the only payload under which the fallback can do anything.
$TEAMS_SURFACE_COPILOT_ON = $TEAMS_SURFACE_HEAD + '"enforce":true,"verified":true,' + $TEAMS_FB_ON + '}'
$M365_SURFACE      = '{"id":"m365_copilot","procs":["M365Copilot"],"controlType":"Edit","composerNamePrefixes":["Message "],"genericNames":["Copilot"],"read":"composer_name","titleSeparator":"","titleSuffix":"","titleKinds":[],"hostApp":false,"enforce":true,"verified":true}'
$COPILOT_SURFACE   = '{"id":"copilot_standalone","procs":["Copilot"],"controlType":"Edit","composerNamePrefixes":["Message "],"genericNames":["Copilot"],"read":"composer_name","titleSeparator":"","titleSuffix":"","titleKinds":[],"hostApp":false,"enforce":false,"verified":false}'

$SURFACES_SHIPPED = '[' + $M365_SURFACE + ',' + $TEAMS_SURFACE_OFF + ']'
$SURFACES_WITH_UNVERIFIED = '[' + $M365_SURFACE + ',' + $COPILOT_SURFACE + ',' + $TEAMS_SURFACE_OFF + ']'
$SURFACES_TEAMS_ARMED = '[' + $M365_SURFACE + ',' + $TEAMS_SURFACE_ON + ']'
$SURFACES_COPILOT_ARMED = '[' + $M365_SURFACE + ',' + $TEAMS_SURFACE_COPILOT_ON + ']'

function LoadSurfaces([string]$json) { Call 'LoadAgentSurfaces' @($json) | Out-Null }
function LoadPanels([string]$json) { Call 'LoadAiPanels' @($json) | Out-Null }

# Start() is never called, so _aiProcs (which it builds) is null. The chat-app
# branch of ApplyForegroundTick and CheckFgBlocked's PLATFORM_PROCS branch both
# key on it, so the harness supplies exactly the names enforcer.js would.
$aiProcSet = New-Object 'System.Collections.Generic.HashSet[string]' -ArgumentList @([System.StringComparer]::OrdinalIgnoreCase)
foreach ($p in @('M365Copilot', 'Copilot', 'ChatGPT', 'Claude', 'Gemini')) { $null = $aiProcSet.Add($p) }
SetF '_aiProcs' $aiProcSet

# Start() also builds _patInfos (the compiled pattern table). Left null it would
# make any call into the masking path throw a NullReferenceException instead of
# answering, so the harness supplies an EMPTY table: enough for
# UpdatePendingRewrite to run for real, and it deliberately masks nothing — the
# only thing asserted through it here is whether the tick got PAST the host-app
# exclusion gate, never what a mask would have produced. (The masking itself is
# driven, with real patterns, by tests/helpers/rewrite-multiline-harness.ps1.)
$PATINFO_T = $T.GetNestedType('PatInfo', $FLAGS)
if (-not $PATINFO_T) { throw 'no nested PatInfo class' }
$patListType = [System.Collections.Generic.List`1].MakeGenericType($PATINFO_T)
SetF '_patInfos' ([Activator]::CreateInstance($patListType))

# The AgentReadOutcome enum, and the reflection handle for the real pure
# extractor. The ONE thing substituted for the agent path — exactly as for the
# panel path — is the AutomationElement.FocusedElement lookup: everything that
# interprets its result is production code.
$OUTCOME_T = $T.GetNestedType('AgentReadOutcome', $FLAGS)
if (-not $OUTCOME_T) { throw 'no nested AgentReadOutcome enum' }
$OUT_UNREADABLE = [Enum]::Parse($OUTCOME_T, 'Unreadable')
$M_EXTRACT = $T.GetMethod('ExtractAgentName', $FLAGS)
if (-not $M_EXTRACT) { throw 'no method ExtractAgentName' }
# The SECOND Teams route's pure extractor. Same deal: the only thing substituted
# for it is the tree walk that COLLECTS the heading candidates — the decision
# about what those candidates mean is production code, and so is the gate
# (FallbackReadArmed) that decides whether a walk may happen at all.
$M_EXTRACT_HEADING = $T.GetMethod('ExtractAgentNameFromHeading', $FLAGS)
if (-not $M_EXTRACT_HEADING) { throw 'no method ExtractAgentNameFromHeading' }

# ── MEASURED M365Copilot composer values ────────────────────────────────────
# Captured live 2026-08 by a read-only UIA probe of a real Microsoft 365 Copilot
# window. The WINDOW TITLE is useless here — it is the static "Microsoft 365
# Copilot" in every case — and is deliberately not used by any of this.
$M365_PID = [uint32]8104
# No specific agent open.
$FOCUS_M365_GENERIC = @('Edit', 'Message Copilot')
# "AI Learning Advisor" open — the agent an admin blocked.
$FOCUS_M365_ADVISOR = @('Edit', 'Message AI Learning Advisor')
# A second blocked agent, for the switch-between-two-blocked-agents case.
$FOCUS_M365_ANALYST = @('Edit', 'Message Finance Analyst')
# An agent nobody blocked.
$FOCUS_M365_HR = @('Edit', 'Message HR Helper')
# The transcript above the composer: a real element in the same window that is
# NOT a composer. Lands in NotComposer — no evidence either way.
$FOCUS_M365_TRANSCRIPT = @('Document', 'Chat message list')
# ChatGPT's composer. No AGENT_SURFACES entry covers ChatGPT at all, which is
# what the fail-closed scenario needs.
$CHATGPT_PID = [uint32]5150
$FOCUS_CHATGPT = @('Edit', 'Message ChatGPT')
# The STANDALONE Microsoft Copilot app — the hypothetical UNVERIFIED surface.
# PLATFORM_PROCS maps personal_agent to both Copilot builds, so the same
# agent-scoped row reaches this process too; the only difference is that its
# surface has not passed a live pass, so nothing may narrow there.
$COPILOT_PID = [uint32]6120
$FOCUS_COPILOT_BOT = @('Edit', 'Message Deal Desk Bot')
$FOCUS_COPILOT_GENERIC = @('Edit', 'Message Copilot')

# One agent-scoped row for "AI Learning Advisor" inside Microsoft 365 Copilot —
# the shape POST /api/lifecycle/block and registry.js's individual-agent path
# now write.
$ROWS_AGENT = '[{"platform":"personal_agent","agent_name":"AI Learning Advisor","agent_id":"agent-advisor","reason":"Blocked by admin","agent_scope":"agent"}]'
# Two blocked agents in the same app.
$ROWS_TWO_AGENTS = '[{"platform":"personal_agent","agent_name":"AI Learning Advisor","agent_id":"agent-advisor","reason":"Blocked by admin","agent_scope":"agent"},{"platform":"personal_agent","agent_name":"Finance Analyst","agent_id":"agent-analyst","reason":"Blocked by admin","agent_scope":"agent"}]'
# The SAME agent, platform-scoped (the pre-existing row shape, and what an
# absent agent_scope means). Must block the whole app, and must trigger NO
# focused-element read at all — the privacy gate.
$ROWS_AGENT_PLATFORM = '[{"platform":"personal_agent","agent_name":"AI Learning Advisor","agent_id":"agent-advisor","reason":"Blocked by admin"}]'
# An agent-scoped row against a process this catalog cannot read an agent name
# out of. Fail CLOSED: whole-app block, exactly as today.
$ROWS_AGENT_CHATGPT = '[{"platform":"openai_assistant","agent_name":"Research Assistant","agent_id":"agent-research","reason":"Blocked by admin","agent_scope":"agent"}]'
# An agent-scoped row whose foreground process resolves to an UNVERIFIED surface.
# The read succeeds and names the very agent the row names — and it must STILL be
# a whole-app block, because the surface has not passed a live pass.
$ROWS_AGENT_UNVERIFIED = '[{"platform":"personal_agent","agent_name":"Deal Desk Bot","agent_id":"agent-dealdesk","reason":"Blocked by admin","agent_scope":"agent"}]'

# ── MEASURED focused-element property values ────────────────────────────────
# Captured 2026-08-25 by a read-only UIA probe of a real VS Code window that had
# TWO live Claude Code composers, a GitHub Copilot Chat input, the code editor
# and an integrated terminal — all Edit controls in one window, all matched
# against the same signature table by the same global FocusedElement read.
$FOCUS_CLAUDE_COMPOSER = @('Edit', 'Message input', 'messageInput_cKsPxg')
$FOCUS_COPILOT_CHAT    = @('Edit', 'Chat Input (Agent), edit files in your workspace. Press Enter to send', 'native-edit-context')
$FOCUS_CODE_EDITOR     = @('Edit', 'The editor is not accessible at this time. To enable screen reader optimized mode', 'native-edit-context')
$FOCUS_TERMINAL        = @('Edit', 'Terminal 2, bash', 'xterm-helper-textarea')

$CODE_PID = [uint32]19616

# ── The Cursor window under test (a disposable instance on an empty folder) ──
# Probed read-only 2026-08-26. It contains exactly TWO Edit controls: Cursor's
# own AI composer and Cursor's Monaco code-editor input. There is no Copilot
# Chat / vscode_chat panel in it at all, so the neighbouring-PANEL fix cannot be
# what covers this window — the element that steals the global FocusedElement
# read here matches NO signature, which lands as a readable NON-match.
$CURSOR_PID = [uint32]27180
$FOCUS_CURSOR_COMPOSER = @('Edit', '', 'aislash-editor-input')
# The same composer carrying a second class. A web-hosted element's UIA
# ClassName is the DOM class ATTRIBUTE — the Monaco input right below proves the
# provider reports the whole list verbatim — so an exact whole-string compare
# stops matching a composer that is genuinely focused and genuinely stable.
$FOCUS_CURSOR_COMPOSER_MULTICLASS = @('Edit', '', 'aislash-editor-input aislash-editor-input-has-text')
$FOCUS_CURSOR_MONACO = @('Edit', 'The editor is not accessible at this time. To enable screen reader optimized mode', 'inputarea monaco-mouse-cursor-text')
# Cursor's agent-session history search box — same ControlType, same process,
# similar shape, and NOT a composer. Here to prove the class-token matching did
# not widen anything.
$FOCUS_CURSOR_AGENT_SEARCH = @('Edit', 'Search Agents…', 'agent-sidebar-search-input')

# ── MEASURED Microsoft Teams values (new Teams, MSIX) ───────────────────────
# Probed live 2026-08 against a real install with a real Copilot Studio agent
# ("IT Help Desk Agent") added to Teams.
$TEAMS_PID = [uint32]13472
# The composer element. Its Name is the literal "Type a message" in EVERY
# conversation — a DM, a group chat, an agent chat and the Copilot panel all
# report it identically — so it says nothing about which conversation is open
# and is deliberately not a signal. The ClassName is the verbatim token list:
# stable CKEditor semantic classes mixed with Fluent-UI build hashes.
$FOCUS_TEAMS_COMPOSER = @('Edit', 'Type a message', 'ck ck-content ck-editor__editable ck-rounded-corners ck-editor__editable_inline ck-blurred ___1czdayc f1poobt0 f1cktdmf f13htf1t f1ubnyt4 f1couhl3 f1ahpp82 f11qra4b f6dzj5z f1p9o1ba fokg9q4')
# The message list above the composer — a real element in the same window that
# is NOT the composer, so no host-app tick may ever be governed while it holds
# focus.
$FOCUS_TEAMS_MESSAGE_LIST = @('List', 'Message list', 'fui-ChatList')

# VERBATIM window titles, all six measured live.
$TITLE_TEAMS_AGENT    = 'Chat | IT Help Desk Agent | filefuze | erik@filefuze.co | Microsoft Teams'
$TITLE_TEAMS_GROUP    = 'Chat | alex, max | filefuze | erik@filefuze.co | Microsoft Teams'
$TITLE_TEAMS_DM       = 'Sruthi Chimata | CloudFuze, Inc | Pravallika.Punumalli@cloudfuze.com | Microsoft Teams'
$TITLE_TEAMS_COPILOT  = 'Copilot | filefuze | erik@filefuze.co | Microsoft Teams'
$TITLE_TEAMS_CHANNEL  = 'Teams and Channels | CFQMSG END-END Sanity testing for public channel-ivy2 | General | filefuze | erik@filefuze.co | Microsoft Teams'
$TITLE_TEAMS_ACTIVITY = 'Activity | Workflows | filefuze | erik@filefuze.co | Microsoft Teams'

# ── MEASURED Microsoft Teams COPILOT-TAB values (the second UI route) ───────
# Probed live 2026-09 against the same install, with the same blocked agent, in
# the embedded "Copilot" tab rather than the Chat list.
#
# The composer. A genuinely DIFFERENT editor from the CKEditor one above — no
# ck-editor__editable token anywhere in its ClassName — which is why it needs
# its own AI_PANELS signature. Its Name is generic ("Message Copilot" with no
# agent selected) and is deliberately not a signal.
$FOCUS_TEAMS_COPILOT_COMPOSER = @('Edit', 'Message Copilot', 'fai-EditorInput__input r18fti29 r18aquq2 ___10kbave f1pha7fy f1immsc2 f1mk8lai')
# The pane headings the background walk collects, as (className, name) pairs.
# THE landing heading of a freshly-opened conversation, before any message —
# and, since re-opening resets the conversation, the common state right after
# opening an agent.
# NOTE the unary comma on every SINGLE-element list below: @( @('a','b') )
# collapses to a flat two-string array in PowerShell, which would silently feed
# this harness one character per "heading". @( ,@('a','b') ) is the one-element
# list of pairs actually intended.
$HEAD_LANDING = @(
  ,@('fui-Title1 fui-Text ___4t6usk0 fk6fouc fccw675 f1ebx5kk flh3ekv f17mccla f1w7gpdv f6juhto f1gl81tg f2jf649 f19n0e5 f1pnz6pm f1jsk80 ffay0gz f1mix7af f138trxt fhvk2gl f1trf6pf',
    'IT Help Desk Agent Created by Your developer name')
)
# One exchange: the agent's own message heading plus the user's. The two carry
# DIFFERENT classes (measured), which is what makes it impossible to read a
# human's own message as the agent's.
$HEAD_ONE_MESSAGE = @(
  @('fai-CopilotMessage__accessibleHeading rhgro0h', 'IT Help Desk Agent said:'),
  @('fai-UserMessage__accessibleHeading r183b29h', 'You said:')
)
# Headings ACCUMULATE — confirmed live that a second exchange did not replace
# the first message's heading. Two that agree are one confirmed answer.
$HEAD_TWO_MESSAGES = @(
  @('fai-CopilotMessage__accessibleHeading rhgro0h', 'IT Help Desk Agent said:'),
  @('fai-UserMessage__accessibleHeading r183b29h', 'You said:'),
  @('fai-CopilotMessage__accessibleHeading rhgro0h', 'IT Help Desk Agent said:'),
  @('fai-UserMessage__accessibleHeading r183b29h', 'You said:')
)
# SYNTHETIC (not measured): headings that DISAGREE — a mixed or stale
# transcript, or a pane that re-rendered mid-walk. Must be no evidence, never a
# block: for a host app "cannot tell which agent is open" can never mean "block
# anyway".
$HEAD_DISAGREE = @(
  @('fai-CopilotMessage__accessibleHeading rhgro0h', 'IT Help Desk Agent said:'),
  @('fai-CopilotMessage__accessibleHeading rhgro0h', 'Expenses Helper said:')
)
# Only the user has spoken — no agent heading at all.
$HEAD_USER_ONLY = @(
  ,@('fai-UserMessage__accessibleHeading r183b29h', 'You said:')
)

# One agent-scoped row for the Teams agent. teams_chat_agent is the Teams-only
# platform id; PLATFORM_PROCS maps it to ms-teams and to nothing else.
$ROWS_TEAMS_AGENT = '[{"platform":"teams_chat_agent","agent_name":"IT Help Desk Agent","agent_id":"agent-ithelp","reason":"Blocked by admin","agent_scope":"agent"}]'
# The SAME agent, reached through copilot_studio instead — a Copilot Studio
# agent added to Teams. PLATFORM_PROCS maps that platform to both Copilot builds
# AND to ms-teams, so the row must cover Teams too.
$ROWS_TEAMS_VIA_COPILOT_STUDIO = '[{"platform":"copilot_studio","agent_name":"IT Help Desk Agent","agent_id":"agent-ithelp","reason":"Blocked by admin","agent_scope":"agent"}]'
# The SAME agent, PLATFORM-scoped (no agent_scope). For a chat app this is a
# whole-app block. For a HOST APP it must be no block at all — the inversion.
$ROWS_TEAMS_PLATFORM = '[{"platform":"teams_chat_agent","agent_name":"IT Help Desk Agent","agent_id":"agent-ithelp","reason":"Blocked by admin"}]'
# The row shape an Inventory host toggle would produce IF processesForHost did
# not exclude a host app. It cannot be synthesised (asserted in
# ai-processes.test.mjs) — this proves the .ps1 refuses it even if one appeared.
$ROWS_TEAMS_PROCESS_NAME = '[{"platform":"ai_platform","process_name":"ms-teams","agent_name":"Microsoft Teams","agent_id":"","host":"teams.microsoft.com","reason":"Blocked by organization policy"}]'
# Likewise for a panel-keyed row against teams_composer — panelForHost() returns
# null for it (host:null), so this too is unsynthesisable by construction.
$ROWS_TEAMS_PANEL = '[{"platform":"ai_platform","panel":"teams_composer","agent_name":"Microsoft Teams","agent_id":"","host":"teams.microsoft.com","reason":"Blocked by organization policy"}]'

function LoadRows([string]$json) {
  $script:tmpFile = Join-Path ([System.IO.Path]::GetTempPath()) ("cfai-panel-harness-" + [guid]::NewGuid().ToString('N') + '.json')
  Set-Content -LiteralPath $script:tmpFile -Value $json -Encoding UTF8
  SetF '_blockedAgentFile' $script:tmpFile
  SetF '_lastBlockedCheck' ([long]0)
  Call 'UpdateBlockedAgents' | Out-Null
}

# ── The GOVERNED (DLP-monitored, NOT blocked) list ──────────────────────────
# ~/.cloudfuze-aigov/governed-agents.json, written by blocked-agents-sync.js.
# Loaded exactly the way the blocked rows are — a real file on disk, read by the
# REAL UpdateGovernedAgents (and therefore the real hand-rolled parser and the
# real RebuildDlpScopedProcs) — so nothing about the parse or the privacy gate
# is reimplemented here.
#
# $null means "the file does not exist", which is the state before the first
# successful sync and must mean "nothing is governed".
function LoadGoverned($json) {
  if ($null -eq $json) {
    SetF '_governedAgentFile' (Join-Path ([System.IO.Path]::GetTempPath()) ("cfai-governed-absent-" + [guid]::NewGuid().ToString('N') + '.json'))
  } else {
    $script:tmpGovFile = Join-Path ([System.IO.Path]::GetTempPath()) ("cfai-governed-harness-" + [guid]::NewGuid().ToString('N') + '.json')
    Set-Content -LiteralPath $script:tmpGovFile -Value $json -Encoding UTF8
    SetF '_governedAgentFile' $script:tmpGovFile
  }
  Call 'UpdateGovernedAgents' | Out-Null
}

function ResetState() {
  SetF '_fgIsAi' $false
  SetF '_fgIsPanel' $false
  SetF '_fgPanelId' ''
  SetF '_fgPanelEnforce' $false
  SetF '_fgLeftAiTicks' ([long]0)
  SetF '_fgPid' ([uint32]0)
  SetF '_app' ''
  SetF '_fgIsBlocked' $false
  SetF '_blockedByElement' $false
  SetF '_blockScope' ''
  SetF '_fgAgentOutcome' $OUT_UNREADABLE
  SetF '_fgAgentName' ''
  Call 'ClearPanelBlockLatch' | Out-Null
  SetF '_disarmedUntilTicks' ([long]0)
  SetF '_lastBlockFiredTicks' ([long]0)   # no cooldown may mask the result
  SetF '_blockTyped' $false
  SetF '_blockUia' $false
  SetF '_blockPaste' $false
  SetF '_attachHoldActive' $false
  SetF '_attachHoldProcess' ''
  SetF '_lastPasteTicks' ([long]0)
  # The govstate machine, and the per-tick host-governance fields
  # ApplyForegroundTick owns. Reset so each scenario starts from "nothing is
  # governed" and its first armed tick is a genuine transition.
  SetF '_govActive' $false
  SetF '_govPid' ([uint32]0)
  SetF '_govKey' ''
  SetF '_fgHostGoverned' $false
  SetF '_fgHostGovPanel' ''
  SetF '_fgHostGovAgent' ''
  SetF '_fgHostGovAgentId' ''
  $script:govEmitted = $false
  # No click and no navigation key — the state a quiet wait before an Enter is
  # actually in. Scenarios that model the user moving the caret set it.
  SetF '_lastFocusMoveInputTicks' ([long]0)
}

# The user just clicked (or hit Tab/Escape/a chord) $msAgo milliseconds ago —
# i.e. keyboard focus COULD have moved. Written the way the hook threads write
# it: a timestamp, nothing else.
function FocusMoveInput([int]$msAgo = 0) {
  SetF '_lastFocusMoveInputTicks' ([long]([DateTime]::UtcNow.Ticks - [TimeSpan]::FromMilliseconds($msAgo).Ticks))
}

# ── govstate, run for real on every tick ────────────────────────────────────
#
# UpdateGovState is what tells the Node side "a governed or blocked agent
# conversation is open in a host app right now", which is the ONE thing that
# arms Teams' file watchers. Called here in the same position PollLoop calls it:
# immediately after CheckFgBlocked, so it reads this tick's freshly decided
# block and this tick's foreground decision.
#
# It emits at most one line per real transition, straight to stdout — those
# {"kind":"govstate",...} lines land in this harness's own output and the tests
# read them there, which is how the PII discipline of the payload is asserted
# against the REAL emitter rather than a copy of it.
#
# $script:govEmitted records whether THIS tick emitted. _govActive changes value
# at exactly the two emit sites and nowhere else, so a change is precisely
# equivalent to "a line was written" — that is what makes "transitions only"
# assertable without parsing interleaved output.
$script:govEmitted = $false
function RunGovState() {
  $before = [bool](GetF '_govActive')
  Call 'UpdateGovState' | Out-Null
  $script:govEmitted = ($before -ne [bool](GetF '_govActive'))
}

# One poll tick. $focus is a (controlType, name, className) triple, or $null for
# an UNREADABLE read (FocusedElement threw / was null / had no usable props).
function Tick([string]$scenario, [int]$n, $focus, [uint32]$fgPid = $CODE_PID, [string]$proc = 'Code') {
  $hit = $null
  $readable = $false
  if ($null -ne $focus) {
    $ct = $focus[0]; $nm = $focus[1]; $cls = $focus[2]
    # exactly ReadFocusedPanel's own `readable` rule
    $readable = ($ct.Trim().Length -gt 0) -and (($nm.Trim().Length -gt 0) -or ($cls.Trim().Length -gt 0))
    $hit = Call 'MatchPanelSignature' @($proc, $ct, $nm, $cls)
  }
  $rid = if ($null -ne $hit) { '42.9047508.4.9.49.164537' } else { '' }
  Call 'ApplyForegroundTick' @($fgPid, $proc, $true, $hit, $rid, $readable, $OUT_UNREADABLE, '') | Out-Null
  Call 'CheckFgBlocked' | Out-Null
  RunGovState
  Report $scenario $n $hit $readable
}

# One poll tick with the foreground an AI CHAT app (not an IDE), driving the
# agent-scoped path. $focus is a (controlType, name) pair, or $null for an
# UNREADABLE read (FocusedElement threw / was null / had no usable properties).
#
# $elPid is the pid the focused ELEMENT belongs to; -1 means "the foreground
# process itself", the ordinary single-process case. Whatever it is, the decision
# about it is made by the REAL ElementPidBelongsToForeground — which is why a
# WebView2-style child pid can be modelled here at all, and why the check that
# rejects an unrelated process stays under test rather than being assumed away.
#
# The privacy gate is applied here exactly as UpdateForeground applies it — no
# agent-scoped row covering this process means no read happens at all — so the
# gate itself is under test, not assumed.
function AgentTick([string]$scenario, [int]$n, $focus, [uint32]$fgPid = $M365_PID, [string]$proc = 'M365Copilot', [int]$elPid = -1) {
  $outcome = $OUT_UNREADABLE
  $agentName = ''
  $gate = (HasProc '_aiProcs' $proc) -and (HasProc '_agentScopedProcs' $proc)
  $surface = Call 'MatchAgentSurface' @($proc)
  if ($gate -and $null -ne $surface -and $null -ne $focus) {
    $ownerPid = if ($elPid -lt 0) { [int]$fgPid } else { $elPid }
    # ReadFocusedAgentName's own pid rule, run for real: the element must belong
    # to the foreground process or to a DIRECT CHILD of it. Anything else is
    # Unreadable — no evidence, not "no agent open".
    $owned = [bool](Call 'ElementPidBelongsToForeground' @([int]$ownerPid, [uint32]$fgPid))
    $ct = $focus[0]; $nm = $focus[1]
    # ReadFocusedAgentName's own rule: no control type or no Name at all is a
    # READ FAILURE, never the authoritative "no agent open".
    if ($owned -and $ct.Trim().Length -gt 0 -and $nm.Trim().Length -gt 0) {
      $params = [object[]]@($surface, $ct, $nm, $null)
      $outcome = $M_EXTRACT.Invoke($null, $params)
      $agentName = [string]$params[3]
    }
  }
  Call 'ApplyForegroundTick' @($fgPid, $proc, $false, $null, '', $false, $outcome, $agentName) | Out-Null
  Call 'CheckFgBlocked' | Out-Null
  RunGovState
  Report $scenario $n $null $false $outcome
}

# One poll tick with the foreground a HOST APP (Microsoft Teams) — the
# agent-scoped path driven by a WINDOW TITLE rather than a composer name.
#
# Everything that DECIDES is production code. The harness reproduces exactly two
# things UpdateForeground does that cannot run offline:
#   1. the hostAppArmed gate, evaluated against the REAL _hostAppProcs /
#      _agentScopedProcs sets and the REAL EnforcingAgentSurface — so the gate
#      itself is under test, not assumed. No agent policy for Teams, or an
#      unverified surface, and nothing is read at all;
#   2. the two substituted reads: AutomationElement.FocusedElement (fed through
#      the REAL MatchPanelSignature, with the REAL ElementPidBelongsToForeground
#      deciding ownership) and GetWindowText (fed through the REAL
#      ExtractAgentName, in its window_title mode).
#
# $focus is the focused-element triple, or $null for an unreadable/absent read.
# $title is the window title, or $null for a failed GetWindowText.
# $elPid is the pid the ELEMENT belongs to; -1 means the foreground process
# itself. Teams' composer really lives in a child WebView2 process, so this is
# what models that.
function TeamsTick([string]$scenario, [int]$n, $focus, [string]$title,
                   [uint32]$fgPid = $TEAMS_PID, [string]$proc = 'ms-teams', [int]$elPid = -1) {
  $hit = $null
  $readable = $false
  $outcome = $OUT_UNREADABLE
  $agentName = ''
  # UpdateForeground's hostAppArmed, verbatim. Note it does NOT consult _aiProcs:
  # a host app is deliberately absent from that set (ai-processes.js keeps every
  # hostApp entry out of the watcher list), which is why the harness's own
  # $aiProcSet has no ms-teams in it either.
  #
  # EITHER policy list satisfies the middle term — a BLOCKED agent-scoped row or
  # a GOVERNED (DLP-monitor) one. Both sets are the REAL ones, rebuilt by the
  # real loaders from the real files, so the privacy gate stays under test: with
  # neither list naming Teams, nothing is read at all.
  $armed = (HasProc '_hostAppProcs' $proc) `
           -and ((HasProc '_agentScopedProcs' $proc) -or (HasProc '_dlpScopedProcs' $proc)) `
           -and ($null -ne (Call 'EnforcingAgentSurface' @($proc)))
  if ($armed) {
    if ($null -ne $focus) {
      $ownerPid = if ($elPid -lt 0) { [int]$fgPid } else { $elPid }
      $owned = [bool](Call 'ElementPidBelongsToForeground' @([int]$ownerPid, [uint32]$fgPid))
      if ($owned) {
        $ct = $focus[0]; $nm = $focus[1]; $cls = $focus[2]
        $readable = ($ct.Trim().Length -gt 0) -and (($nm.Trim().Length -gt 0) -or ($cls.Trim().Length -gt 0))
        $hit = Call 'MatchPanelSignature' @($proc, $ct, $nm, $cls)
      }
    }
    # ReadFocusedAgentName's own rule for the title read: an empty/failed
    # GetWindowText is Unreadable — no evidence — never "no agent open".
    $surface = Call 'MatchAgentSurface' @($proc)
    if ($null -ne $surface -and $null -ne $title -and $title.Trim().Length -gt 0) {
      $params = [object[]]@($surface, '', $title, $null)
      $outcome = $M_EXTRACT.Invoke($null, $params)
      $agentName = [string]$params[3]
    }
  }
  $rid = if ($null -ne $hit) { '7.3311.4.9.31.90210' } else { '' }
  Call 'ApplyForegroundTick' @($fgPid, $proc, $false, $hit, $rid, $readable, $outcome, $agentName) | Out-Null
  Call 'CheckFgBlocked' | Out-Null
  RunGovState
  Report $scenario $n $hit $readable $outcome
}

# One poll tick with the foreground Teams' embedded COPILOT TAB — the second UI
# route, where the window title names no conversation at all.
#
# Everything that DECIDES is production code. The harness reproduces the same two
# things TeamsTick does (the hostAppArmed gate and the two substituted reads),
# plus exactly one more: the TREE WALK that collects the pane's heading
# candidates. What those candidates MEAN is decided by the real
# ExtractAgentNameFromHeading, and whether a walk may be attempted AT ALL is
# decided by the real FallbackReadArmed + TitleKindOf — so the inert-by-default
# gate is under test rather than assumed.
#
# $headings is an array of (className, name) pairs — whatever the walk would have
# found — or $null for a pane where it found nothing.
#
# The reported `searchAttempted` is FallbackReadArmed's real answer, which is how
# a scenario can assert STRUCTURALLY that no search is ever attempted (an
# unverified route, or a title kind this route does not apply to).
function TeamsCopilotTick([string]$scenario, [int]$n, $focus, [string]$title, $headings,
                          [uint32]$fgPid = $TEAMS_PID, [string]$proc = 'ms-teams', [int]$elPid = -1) {
  $hit = $null
  $readable = $false
  $outcome = $OUT_UNREADABLE
  $agentName = ''
  $searchAttempted = $false
  # hostAppArmed, verbatim — see TeamsTick's copy for why either policy list
  # satisfies the middle term.
  $armed = (HasProc '_hostAppProcs' $proc) `
           -and ((HasProc '_agentScopedProcs' $proc) -or (HasProc '_dlpScopedProcs' $proc)) `
           -and ($null -ne (Call 'EnforcingAgentSurface' @($proc)))
  if ($armed) {
    if ($null -ne $focus) {
      $ownerPid = if ($elPid -lt 0) { [int]$fgPid } else { $elPid }
      $owned = [bool](Call 'ElementPidBelongsToForeground' @([int]$ownerPid, [uint32]$fgPid))
      if ($owned) {
        $ct = $focus[0]; $nm = $focus[1]; $cls = $focus[2]
        $readable = ($ct.Trim().Length -gt 0) -and (($nm.Trim().Length -gt 0) -or ($cls.Trim().Length -gt 0))
        $hit = Call 'MatchPanelSignature' @($proc, $ct, $nm, $cls)
      }
    }
    $surface = Call 'MatchAgentSurface' @($proc)
    if ($null -ne $surface -and $null -ne $title -and $title.Trim().Length -gt 0) {
      # STAGE A — the primary title parse, unchanged. On this route it always
      # lands in NotComposer, because the title names no conversation.
      $params = [object[]]@($surface, '', $title, $null)
      $outcome = $M_EXTRACT.Invoke($null, $params)
      $agentName = [string]$params[3]
      if ("$outcome" -eq 'NotComposer') {
        # STAGE B — the real gate, then the substituted walk.
        $kind = [string](Call 'TitleKindOf' @($surface, $title))
        $searchAttempted = [bool](Call 'FallbackReadArmed' @($surface, $kind))
        if ($searchAttempted -and $null -ne $headings) {
          # Built as genuine string[] (not PowerShell object arrays) because the
          # C# side takes two PARALLEL string arrays — the same shape Start()
          # already uses for the pattern table.
          $classes = [string[]]::new($headings.Count)
          $names = [string[]]::new($headings.Count)
          for ($h = 0; $h -lt $headings.Count; $h++) {
            $classes[$h] = [string]$headings[$h][0]
            $names[$h] = [string]$headings[$h][1]
          }
          $hp = [object[]]@($surface, [string[]]$classes, [string[]]$names, $null)
          $outcome = $M_EXTRACT_HEADING.Invoke($null, $hp)
          $agentName = [string]$hp[3]
        }
      }
    }
  }
  $rid = if ($null -ne $hit) { '7.3311.4.9.31.90211' } else { '' }
  Call 'ApplyForegroundTick' @($fgPid, $proc, $false, $hit, $rid, $readable, $outcome, $agentName) | Out-Null
  Call 'CheckFgBlocked' | Out-Null
  RunGovState
  Report $scenario $n $hit $readable $outcome $searchAttempted
}

# Did UpdatePendingRewrite get PAST its exclusion gate on the state this tick
# left behind — i.e. is Tier B (Tokenize & Send) eligible here at all?
#
# The REAL function, run for real. The gate is its first statement, and the
# branch it guards returns WITHOUT touching _pendingWhyNot; everything past it
# writes that field. So a sentinel is the exact observation: still there means
# the tick was excluded, overwritten means it reached the composer read (which
# offline has no composer to read, hence "empty_read"/"no_focused_element" — and
# that is fine, because eligibility is the question, not the mask).
#
# This is why the host-app relaxation can be tested behaviourally at all: no
# UIA composer is needed to establish which side of the gate a tick lands on.
function TierBReached() {
  SetF '_pendingWhyNot' 'HARNESS_SENTINEL'
  SetF '_pendingRewritable' $false
  SetF '_pendingExpiresAt' ([long]0)
  Call 'UpdatePendingRewrite' | Out-Null
  return ([string](GetF '_pendingWhyNot') -ne 'HARNESS_SENTINEL')
}

function Report([string]$scenario, [int]$n, $hit, [bool]$readable, $agentOutcome = $null, [bool]$searchAttempted = $false) {
  # The REAL Enter predicate, with no content signal armed — so a True here can
  # only be the platform block.
  $enterBlocked = Call 'EnterBlockActive' @($false, $false, $false, $false)
  $matchedId = if ($null -ne $hit) { $hit.GetType().GetField('Id').GetValue($hit) } else { '' }
  if ($null -eq $agentOutcome) { $agentOutcome = GetF '_fgAgentOutcome' }

  $obj = [ordered]@{
    scenario      = $scenario
    tick          = $n
    matched       = $matchedId
    readable      = $readable
    fgIsAi        = [bool](GetF '_fgIsAi')
    fgIsPanel     = [bool](GetF '_fgIsPanel')
    fgPanelId     = [string](GetF '_fgPanelId')
    fgIsBlocked   = [bool](GetF '_fgIsBlocked')
    # Renamed with the field it reads: _blockedByPanel became _blockedByElement
    # when the latch was generalised to cover agent-scoped blocks too.
    blockedByElement = [bool](GetF '_blockedByElement')
    blockScope    = [string](Call 'BlockScope')
    latchHeld     = [bool](Call 'PanelBlockLatchHeld')
    # The latch key is now NAMESPACED ("panel:<id>" / "agent:<id>"), so this
    # column reports the whole key rather than a bare panel id.
    latchKey      = [string](GetF '_elementBlockKey')
    agentOutcome  = [string]$agentOutcome
    blockedAgent  = [string](GetF '_blockedAgentName')
    focusMoved    = [bool](Call 'FocusCouldHaveMoved')
    enterBlocked  = [bool]$enterBlocked
    panelField    = [string](Call 'PlatformBlockPanelField')
    # The Copilot-tab route's gate, as the REAL FallbackReadArmed answered it.
    # False on every other tick — nothing else in this harness can attempt a
    # pane search, which is what makes "no search ever happened" assertable.
    searchAttempted = [bool]$searchAttempted
    # ── The DLP-only state (governed, NOT blocked) ─────────────────────────
    # _fgDlpGoverned as ApplyForegroundTick left it. The pair to watch is
    # (dlpGoverned, fgIsBlocked): a governed-only tick must show true/false, a
    # blocked tick false/true, and an untouched Teams tick false/false. There is
    # no state in which both are true.
    dlpGoverned  = [bool](GetF '_fgDlpGoverned')
    # ── The FILE-SCANNING arm signal (govstate) ────────────────────────────
    # The UNION of governed and blocked, unlike dlpGoverned above, because a
    # file attached inside a BLOCKED conversation is the stronger case for
    # scanning it. What to watch:
    #   * false on every untouched Teams tick — a DM, a channel, a meeting
    #     chat, the message list. That is the must-not-regress property: with
    #     it false, index.js never arms a watcher and Teams is never looked at.
    #   * false during the 3s sticky window after leaving a governed surface,
    #     even though _fgIsAi is still (correctly) true there.
    # govEmitted is "this tick wrote a govstate line", so a run of identical
    # ticks must show exactly one.
    govActive    = [bool](GetF '_govActive')
    govEmitted   = [bool]$script:govEmitted
    govKey       = [string](GetF '_govKey')
    # Would a DLP CONTENT match swallow the send on this tick?
    #
    # The hook's Enter decision, modelled exactly: it runs at all only inside
    # `if (_fgIsAi || PanelBlockLatchHeld())`, and it computes its UIA term as
    # `PanelUiaOk() && _blockUia` before calling the predicate. So this is the
    # real predicate, asked with a UIA content match present — the whole point
    # of the governed state: a sensitive prompt in a monitored conversation IS
    # still stopped (and offered Tokenize & Send), while the conversation itself
    # is never blocked. False wherever the surface cannot enforce or capture at
    # all, which is every untouched Teams tick.
    contentBlock = (([bool](GetF '_fgIsAi') -or [bool](Call 'PanelBlockLatchHeld')) `
                    -and [bool](Call 'EnterBlockActive' @($false, [bool](Call 'PanelUiaOk'), $false, $false)))
    # Whether Tier B is eligible on this tick, from the real UpdatePendingRewrite
    # gate. Reported LAST so nothing it touches can affect the columns above.
    tierBReached = [bool](TierBReached)
  }
  Write-Output ($obj | ConvertTo-Json -Compress)
}

# Rewind a tick counter by N milliseconds, to age out a TTL without sleeping.
function Age([string]$field, [int]$ms) {
  $v = GetF $field
  if ($v -ne 0) { SetF $field ([long]($v - ([TimeSpan]::FromMilliseconds($ms).Ticks))) }
}

# ── A: baseline — the measured live condition, every read matching ───────────
LoadRows $ROWS_CLAUDE
ResetState
for ($i = 0; $i -lt 30; $i++) { Tick 'stable_composer' $i $FOCUS_CLAUDE_COMPOSER }

# ── B: THE REGRESSION — a neighbouring detection-only panel in the same window
# steals the odd focused-element read across a 4.5s window. 30 ticks at the
# real 150ms poll cadence; every third read lands on Copilot Chat.
LoadRows $ROWS_CLAUDE
ResetState
for ($i = 0; $i -lt 30; $i++) {
  $focus = if (($i % 3) -eq 2) { $FOCUS_COPILOT_CHAT } else { $FOCUS_CLAUDE_COMPOSER }
  Tick 'neighbour_panel_steals_read' $i $focus
}

# ── B2: the same, but the neighbouring panel wins EVERY read for the whole
# window — the deterministic form, which no grace period covered at all.
LoadRows $ROWS_CLAUDE
ResetState
Tick 'neighbour_panel_wins_all' 0 $FOCUS_CLAUDE_COMPOSER
for ($i = 1; $i -lt 30; $i++) { Tick 'neighbour_panel_wins_all' $i $FOCUS_COPILOT_CHAT }

# ── C: unreadable reads (the originally-modelled case) — latch must hold ─────
LoadRows $ROWS_CLAUDE
ResetState
Tick 'unreadable_reads' 0 $FOCUS_CLAUDE_COMPOSER
for ($i = 1; $i -lt 30; $i++) {
  # Age the sticky timer past FG_STICKY_TTL so the window really does expire.
  if ($i -eq 25) { Age '_fgLeftAiTicks' 4000 }
  Tick 'unreadable_reads' $i $null
}

# ── C2: …but the latch is BOUNDED. Age it past PANEL_BLOCK_LATCH_TTL. ───────
Age '_panelBlockLatchTicks' 11000
Tick 'latch_expires' 0 $null

# ── D: NO COLLATERAL — the caret really is in the code editor. Enter must work.
# The user got there by CLICKING, which is what makes the readable non-match
# authoritative — see _lastFocusMoveInputTicks. Without an input event a "you
# left the panel" read is a bad read, which is scenario J below.
LoadRows $ROWS_CLAUDE
ResetState
Tick 'moved_to_code_editor' 0 $FOCUS_CLAUDE_COMPOSER
FocusMoveInput 10
Tick 'moved_to_code_editor' 1 $FOCUS_CODE_EDITOR
Age '_fgLeftAiTicks' 4000     # let the pre-existing 3s sticky window lapse
Tick 'moved_to_code_editor' 2 $FOCUS_CODE_EDITOR
Tick 'moved_to_code_editor' 3 $FOCUS_CODE_EDITOR

# ── D2: same for the integrated terminal ────────────────────────────────────
LoadRows $ROWS_CLAUDE
ResetState
Tick 'moved_to_terminal' 0 $FOCUS_CLAUDE_COMPOSER
FocusMoveInput 10
Tick 'moved_to_terminal' 1 $FOCUS_TERMINAL
Age '_fgLeftAiTicks' 4000
Tick 'moved_to_terminal' 2 $FOCUS_TERMINAL

# ── E: a detection-only panel must still never CAUSE a block ────────────────
LoadRows $ROWS_VSCODE_CHAT
ResetState
for ($i = 0; $i -lt 5; $i++) { Tick 'detection_only_never_blocks' $i $FOCUS_COPILOT_CHAT }

# ── F: a genuine app switch retires the latch at once. The pre-existing 3s
# sticky window still holds the block over tick 1 — that is by design and
# unchanged — so tick 2 ages it out to show the block really does end.
LoadRows $ROWS_CLAUDE
ResetState
Tick 'app_switch' 0 $FOCUS_CLAUDE_COMPOSER
Tick 'app_switch' 1 $null ([uint32]4242) 'Code'
Age '_fgLeftAiTicks' 4000
Tick 'app_switch' 2 $null ([uint32]4242) 'Code'

# ── G: an admin lifting the block must take effect at once, not after the TTL
LoadRows $ROWS_CLAUDE
ResetState
Tick 'admin_unblocks' 0 $FOCUS_CLAUDE_COMPOSER
LoadRows $ROWS_EMPTY
Tick 'admin_unblocks' 1 $FOCUS_CLAUDE_COMPOSER

# ── G2: …and so must dropping just the claude_code row while others remain ──
LoadRows $ROWS_CLAUDE
ResetState
Tick 'admin_unblocks_one_row' 0 $FOCUS_CLAUDE_COMPOSER
LoadRows $ROWS_VSCODE_CHAT
Tick 'admin_unblocks_one_row' 1 $FOCUS_CLAUDE_COMPOSER

# ── H: the panic hotkey still releases everything ──────────────────────────
LoadRows $ROWS_CLAUDE
ResetState
Tick 'panic_hotkey' 0 $FOCUS_CLAUDE_COMPOSER
SetF '_disarmedUntilTicks' ([long]([DateTime]::UtcNow.Ticks + [TimeSpan]::FromSeconds(600).Ticks))
Tick 'panic_hotkey' 1 $FOCUS_CLAUDE_COMPOSER

# ═══ Cursor's own composer (cursor_composer) ════════════════════════════════
# A DIFFERENT panel entry from claude_code, in a window with no second AI panel
# in it, so none of the scenarios above cover it. Live: 2 of 3 fully-verified
# rounds leaked (composer emptied on Enter), 1 blocked.
#
# The round, replayed: Ctrl+A, Delete, type a marker phrase, then wait 4.5s
# touching NOTHING, then Enter. 30 ticks at the real 150ms cadence is that wait.

# ── I: baseline — every read matches ────────────────────────────────────────
LoadRows $ROWS_CURSOR
ResetState
for ($i = 0; $i -lt 30; $i++) { Tick 'cursor_stable_composer' $i $FOCUS_CURSOR_COMPOSER $CURSOR_PID 'Cursor' }

# ── J: THE LEAK, intermittent form — Cursor's own Monaco editor input steals
# every third global FocusedElement read. It matches NO signature, so it arrives
# as a readable NON-match, which the panel-id scoping in CheckFgBlocked cannot
# see (there is no second panel) and which ApplyForegroundTick used to treat as
# the authoritative "the user left the panel". Nobody touched anything.
LoadRows $ROWS_CURSOR
ResetState
for ($i = 0; $i -lt 30; $i++) {
  $focus = if (($i % 3) -eq 2) { $FOCUS_CURSOR_MONACO } else { $FOCUS_CURSOR_COMPOSER }
  Tick 'cursor_monaco_steals_read' $i $focus $CURSOR_PID 'Cursor'
}

# ── J2: the deterministic form — Monaco wins EVERY read for the whole 4.5s.
# This is the shape that actually leaked live: one stolen tick retired the latch,
# and 3s later the sticky window lapsed with nothing left holding the block. The
# sticky timer is aged out mid-window so the test really does cover past it.
LoadRows $ROWS_CURSOR
ResetState
Tick 'cursor_monaco_wins_all' 0 $FOCUS_CURSOR_COMPOSER $CURSOR_PID 'Cursor'
for ($i = 1; $i -lt 30; $i++) {
  if ($i -eq 20) { Age '_fgLeftAiTicks' 4000 }
  Tick 'cursor_monaco_wins_all' $i $FOCUS_CURSOR_MONACO $CURSOR_PID 'Cursor'
}

# ── K: the composer carrying a second CSS class must still MATCH. Its ClassName
# is the only signal it has (empty Name, no prefix rule), and the UIA ClassName
# of a web-hosted element is the DOM class attribute — see the Monaco input's
# own two-class value above.
LoadRows $ROWS_CURSOR
ResetState
for ($i = 0; $i -lt 30; $i++) { Tick 'cursor_composer_multiclass' $i $FOCUS_CURSOR_COMPOSER_MULTICLASS $CURSOR_PID 'Cursor' }

# ── L: NO COLLATERAL — the user really clicks into Cursor's code editor. The
# click is what makes the readable non-match authoritative, so the latch retires
# on that very tick and Enter works again once the pre-existing 3s sticky window
# lapses. Behaviour here is exactly what it was before this fix.
LoadRows $ROWS_CURSOR
ResetState
Tick 'cursor_click_into_editor' 0 $FOCUS_CURSOR_COMPOSER $CURSOR_PID 'Cursor'
FocusMoveInput 10
Tick 'cursor_click_into_editor' 1 $FOCUS_CURSOR_MONACO $CURSOR_PID 'Cursor'
Age '_fgLeftAiTicks' 4000
Tick 'cursor_click_into_editor' 2 $FOCUS_CURSOR_MONACO $CURSOR_PID 'Cursor'

# ── L2: …and the input evidence is not open-ended. A click from long before the
# block was even armed must not license retiring it.
LoadRows $ROWS_CURSOR
ResetState
FocusMoveInput 30000
Tick 'cursor_stale_input' 0 $FOCUS_CURSOR_COMPOSER $CURSOR_PID 'Cursor'
Tick 'cursor_stale_input' 1 $FOCUS_CURSOR_MONACO $CURSOR_PID 'Cursor'

# ── L3: the latch is still BOUNDED even with no input at all — a Cursor whose
# reads never recover must not leave Enter dead in the editor forever.
Age '_panelBlockLatchTicks' 11000
Age '_fgLeftAiTicks' 4000
Tick 'cursor_latch_expires' 0 $FOCUS_CURSOR_MONACO $CURSOR_PID 'Cursor'

# ── M: the agent-history SEARCH box is not a composer and must never arm a
# block — the guard that the class-token matching widened nothing.
LoadRows $ROWS_CURSOR
ResetState
for ($i = 0; $i -lt 3; $i++) { Tick 'cursor_search_box' $i $FOCUS_CURSOR_AGENT_SEARCH $CURSOR_PID 'Cursor' }

# ═══ Agent-scoped blocks inside Microsoft 365 Copilot ═══════════════════════
#
# A blocked_agents row names ONE agent; the enforcer matched it against the whole
# PROCESS set its platform maps to, so blocking "AI Learning Advisor" disabled
# the entire M365Copilot app — generic Copilot chat and every other agent
# included. agent_scope:'agent' narrows that, using the composer's UIA Name.
#
# m365_copilot is LIVE-VERIFIED as of 2026-08-27 and ships enforcing, so the
# narrowing group below is the SHIPPING behaviour. The safety GATE it used to be
# the example of is still under test, using the hypothetical unverified
# copilot_standalone entry instead.

# ── N: THE SAFETY GATE — an UNVERIFIED surface still whole-app blocks ────────
# The rule every future entry ships under. The read here succeeds and names the
# very agent the row names, and it must still produce exactly the block it
# produced before this feature existed: the whole app, app scope, no element
# attribution. The catalog loaded also holds the VERIFIED m365_copilot entry, so
# this cannot pass merely because nothing is armed anywhere.
LoadSurfaces $SURFACES_WITH_UNVERIFIED
LoadRows $ROWS_AGENT_UNVERIFIED
ResetState
AgentTick 'agent_unverified_surface_whole_app' 0 $FOCUS_COPILOT_BOT $COPILOT_PID 'Copilot'
AgentTick 'agent_unverified_surface_whole_app' 1 $FOCUS_COPILOT_GENERIC $COPILOT_PID 'Copilot'
AgentTick 'agent_unverified_surface_whole_app' 2 $null $COPILOT_PID 'Copilot'
AgentTick 'agent_unverified_surface_whole_app' 3 $FOCUS_M365_HR $COPILOT_PID 'Copilot'

# ── O: PRIVACY GATE — a platform-scoped row triggers no agent read at all ────
# Absent agent_scope is the pre-existing row shape. Nothing may read another
# app's accessibility tree to learn which agent is open when no agent-scoped
# policy exists for it.
LoadSurfaces $SURFACES_SHIPPED
LoadRows $ROWS_AGENT_PLATFORM
ResetState
for ($i = 0; $i -lt 3; $i++) { AgentTick 'agent_no_policy_no_read' $i $FOCUS_M365_ADVISOR }

# ── P: FAIL CLOSED — an agent-scoped row on a process with no surface ────────
# Nothing here can tell which agent is open inside ChatGPT, and "cannot tell"
# must never mean "block nothing".
LoadSurfaces $SURFACES_SHIPPED
LoadRows $ROWS_AGENT_CHATGPT
ResetState
for ($i = 0; $i -lt 3; $i++) { AgentTick 'agent_no_surface_whole_app' $i $FOCUS_CHATGPT $CHATGPT_PID 'ChatGPT' }

# ═══ The narrowing itself — live-verified, shipping behaviour ════════════════

# ── Q: baseline — the blocked agent is open, every read matching ─────────────
LoadSurfaces $SURFACES_SHIPPED
LoadRows $ROWS_AGENT
ResetState
for ($i = 0; $i -lt 30; $i++) { AgentTick 'agent_stable_named' $i $FOCUS_M365_ADVISOR }

# ── R: every third read unreadable — the latch must hold straight through ────
LoadSurfaces $SURFACES_SHIPPED
LoadRows $ROWS_AGENT
ResetState
for ($i = 0; $i -lt 30; $i++) {
  $focus = if (($i % 3) -eq 2) { $null } else { $FOCUS_M365_ADVISOR }
  AgentTick 'agent_intermittent_unreadable' $i $focus
}

# ── S: EVERY read unreadable — held by the latch, and BOUNDED by its TTL ─────
LoadSurfaces $SURFACES_SHIPPED
LoadRows $ROWS_AGENT
ResetState
AgentTick 'agent_all_unreadable' 0 $FOCUS_M365_ADVISOR
for ($i = 1; $i -lt 30; $i++) { AgentTick 'agent_all_unreadable' $i $null }
Age '_panelBlockLatchTicks' 11000
AgentTick 'agent_latch_expires' 0 $null

# ── T: NotComposer holds the latch exactly as Unreadable does ───────────────
# Focus moved to the transcript above the composer: readable, in the right
# process, and says nothing about which agent is open.
LoadSurfaces $SURFACES_SHIPPED
LoadRows $ROWS_AGENT
ResetState
AgentTick 'agent_not_composer' 0 $FOCUS_M365_ADVISOR
for ($i = 1; $i -lt 10; $i++) { AgentTick 'agent_not_composer' $i $FOCUS_M365_TRANSCRIPT }

# ── U: switching to generic Copilot chat clears in ONE tick ─────────────────
# AUTHORITATIVE, and with no grace period: the read came from the composer
# itself, correctly pid-attributed. This is the case the old whole-process match
# got wrong in the other direction — it blocked generic chat too.
LoadSurfaces $SURFACES_SHIPPED
LoadRows $ROWS_AGENT
ResetState
AgentTick 'agent_switch_to_generic' 0 $FOCUS_M365_ADVISOR
AgentTick 'agent_switch_to_generic' 1 $FOCUS_M365_GENERIC
AgentTick 'agent_switch_to_generic' 2 $FOCUS_M365_GENERIC

# ── V: switching to a DIFFERENT agent that is ALSO blocked re-arms under it ──
LoadSurfaces $SURFACES_SHIPPED
LoadRows $ROWS_TWO_AGENTS
ResetState
AgentTick 'agent_switch_to_other_blocked' 0 $FOCUS_M365_ADVISOR
AgentTick 'agent_switch_to_other_blocked' 1 $FOCUS_M365_ANALYST
AgentTick 'agent_switch_to_other_blocked' 2 $FOCUS_M365_ANALYST

# ── W: switching to an agent nobody blocked clears in one tick ──────────────
LoadSurfaces $SURFACES_SHIPPED
LoadRows $ROWS_AGENT
ResetState
AgentTick 'agent_switch_to_unblocked' 0 $FOCUS_M365_ADVISOR
AgentTick 'agent_switch_to_unblocked' 1 $FOCUS_M365_HR
AgentTick 'agent_switch_to_unblocked' 2 $FOCUS_M365_HR

# ── X: an admin lifting the block takes effect at once ──────────────────────
LoadSurfaces $SURFACES_SHIPPED
LoadRows $ROWS_AGENT
ResetState
AgentTick 'agent_admin_unblocks' 0 $FOCUS_M365_ADVISOR
LoadRows $ROWS_EMPTY
AgentTick 'agent_admin_unblocks' 1 $FOCUS_M365_ADVISOR

# ── Y: the panic hotkey still overrides an agent-scoped block ───────────────
LoadSurfaces $SURFACES_SHIPPED
LoadRows $ROWS_AGENT
ResetState
AgentTick 'agent_panic_hotkey' 0 $FOCUS_M365_ADVISOR
SetF '_disarmedUntilTicks' ([long]([DateTime]::UtcNow.Ticks + [TimeSpan]::FromSeconds(600).Ticks))
AgentTick 'agent_panic_hotkey' 1 $FOCUS_M365_ADVISOR

# ── Z: a real app switch retires the agent latch at once ────────────────────
LoadSurfaces $SURFACES_SHIPPED
LoadRows $ROWS_AGENT
ResetState
AgentTick 'agent_app_switch' 0 $FOCUS_M365_ADVISOR
AgentTick 'agent_app_switch' 1 $null ([uint32]4242) 'M365Copilot'

# ── AA: a Generic read from a COLD start never blocks at all ─────────────────
# Live: with "AI Learning Advisor" blocked, generic Copilot chat kept sending
# normally. Scenario U covers the switch away from a live block; this covers
# opening generic chat first, with no latch to retire.
LoadSurfaces $SURFACES_SHIPPED
LoadRows $ROWS_AGENT
ResetState
for ($i = 0; $i -lt 5; $i++) { AgentTick 'agent_generic_never_blocks' $i $FOCUS_M365_GENERIC }

# ── AB: …and so does a DIFFERENT named agent nobody blocked ─────────────────
LoadSurfaces $SURFACES_SHIPPED
LoadRows $ROWS_AGENT
ResetState
for ($i = 0; $i -lt 5; $i++) { AgentTick 'agent_other_named_never_blocks' $i $FOCUS_M365_HR }

# ── AC: THE LIVE-VERIFIED ROUND, replayed ───────────────────────────────────
# What the 2026-08-27 pass actually did, at the real 150ms poll cadence: type in
# the blocked agent's composer, sit idle ~3s (the live read was clean 17/17, and
# two transient misreads are injected here anyway because the latch has to
# survive them), press Enter — blocked throughout — then switch to generic
# Copilot chat and to a different agent, both of which must send immediately with
# no lingering block.
LoadSurfaces $SURFACES_SHIPPED
LoadRows $ROWS_AGENT
ResetState
for ($i = 0; $i -lt 20; $i++) {
  $focus = if ($i -eq 7) { $null } elseif ($i -eq 13) { $FOCUS_M365_TRANSCRIPT } else { $FOCUS_M365_ADVISOR }
  AgentTick 'agent_live_round' $i $focus
}
AgentTick 'agent_live_round' 20 $FOCUS_M365_GENERIC
AgentTick 'agent_live_round' 21 $FOCUS_M365_GENERIC
AgentTick 'agent_live_round' 22 $FOCUS_M365_HR

# ═══ The WebView2 parent-process pid fix ════════════════════════════════════
#
# THE bug found during the live pass. M365Copilot.exe hosts its UI in WebView2:
# the composer element is UIA-owned by a CHILD msedgewebview2.exe process, not by
# the foreground window's own process. ReadFocusedAgentName required an EXACT pid
# match, so every single read came back Unreadable and the narrowing could never
# arm at all.
#
# Modelled with REAL processes rather than invented pid numbers, because the fix
# is a real parent-pid lookup (CreateToolhelp32Snapshot): two genuine child
# processes of this harness stand in for the WebView2 child, and the pid
# relationships between them and the harness itself are what
# ElementPidBelongsToForeground is asked about.
$childA = $null
$childB = $null
try {
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = 'ping.exe'
  # Long enough to still be alive for the snapshot walk, short enough that a
  # harness crash before the finally block cannot leave a long-lived orphan.
  $psi.Arguments = '-n 30 127.0.0.1'
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $psi.RedirectStandardOutput = $true
  $childA = [System.Diagnostics.Process]::Start($psi)
  $childB = [System.Diagnostics.Process]::Start($psi)
  $selfPid = [uint32]$PID

  # ── AD: the fix — a focused element in a DIRECT CHILD of the foreground
  # process reads as Named, exactly as the real WebView2 composer does.
  LoadSurfaces $SURFACES_SHIPPED
  LoadRows $ROWS_AGENT
  ResetState
  for ($i = 0; $i -lt 3; $i++) {
    AgentTick 'agent_webview_child_pid' $i $FOCUS_M365_ADVISOR $selfPid 'M365Copilot' $childA.Id
  }

  # ── AE: the safety check the fix PRESERVES — a genuinely unrelated process is
  # still rejected. FocusedElement is a global read that was measured returning
  # an element from another window in another process, so this is the whole
  # reason the pid check exists. Two shapes, both one generation away from the
  # foreground and neither a child of it:
  #   tick 0 — a SIBLING process (childB's parent is the harness, not childA)
  #   tick 1 — the foreground process's own PARENT (the check is one-directional)
  # Both must land on Unreadable and arm nothing, even though the element's
  # properties would have read as the blocked agent.
  LoadSurfaces $SURFACES_SHIPPED
  LoadRows $ROWS_AGENT
  ResetState
  AgentTick 'agent_unrelated_pid_rejected' 0 $FOCUS_M365_ADVISOR ([uint32]$childA.Id) 'M365Copilot' $childB.Id
  ResetState
  AgentTick 'agent_unrelated_pid_rejected' 1 $FOCUS_M365_ADVISOR ([uint32]$childA.Id) 'M365Copilot' ([int]$selfPid)
}
finally {
  foreach ($c in @($childA, $childB)) {
    if ($null -ne $c) { try { $c.Kill() } catch { } ; try { $c.Dispose() } catch { } }
  }
}

# ═══ HOST APPS: agent-scoped blocks inside Microsoft Teams ══════════════════
#
# Teams is NOT an AI app. It is a general-purpose communications client that
# happens to host one Copilot Studio agent among a company's DMs, channels and
# meetings. Everything below exists to prove ONE property: the enforcement it
# can produce is confined to an already-blocked agent's conversation, and
# ANYTHING it cannot prove results in no block at all — never a whole-app block.
#
# Teams also cannot use the composer-name signal at all: its composer's UIA Name
# is the literal "Type a message" in every conversation, measured. The window
# TITLE is what names the conversation, which is why these ticks drive the
# window_title read mode.

# ── TA: THE SHIPPING STATE — completely inert ───────────────────────────────
# teams_desktop and teams_composer both ship enforce:false/verified:false. With
# a real agent-scoped row present AND the blocked agent's conversation open AND
# its composer focused, absolutely nothing may happen: no block, and no read of
# any kind (agentOutcome stays Unreadable, which is what proves no title was
# ever read and no accessibility call was ever made).
LoadPanels $PANELS_JSON
LoadSurfaces $SURFACES_SHIPPED
LoadRows $ROWS_TEAMS_AGENT
ResetState
for ($i = 0; $i -lt 5; $i++) { TeamsTick 'teams_shipped_is_inert' $i $FOCUS_TEAMS_COMPOSER $TITLE_TEAMS_AGENT }

# ── TB: THE MOST IMPORTANT TEST IN THIS FEATURE ─────────────────────────────
# The same unverified surface, but now asked the question the whole design turns
# on: the row's agent IS open, and the surface cannot narrow to it. For a CHAT
# app (scenario N above) that means a whole-app block — the fail-CLOSED default.
# For a HOST APP it must mean NO BLOCK AT ALL. A whole-app block here would stop
# the user messaging a colleague, posting in a channel or replying in a meeting,
# because one agent inside the app is blocked.
LoadPanels $PANELS_JSON
LoadSurfaces $SURFACES_SHIPPED
LoadRows $ROWS_TEAMS_AGENT
ResetState
TeamsTick 'teams_unverified_never_whole_app' 0 $FOCUS_TEAMS_COMPOSER $TITLE_TEAMS_AGENT
TeamsTick 'teams_unverified_never_whole_app' 1 $FOCUS_TEAMS_COMPOSER $TITLE_TEAMS_DM
TeamsTick 'teams_unverified_never_whole_app' 2 $null $TITLE_TEAMS_AGENT
TeamsTick 'teams_unverified_never_whole_app' 3 $FOCUS_TEAMS_MESSAGE_LIST $TITLE_TEAMS_CHANNEL

# ── TC: …and neither does a PLATFORM-scoped row ─────────────────────────────
# An absent agent_scope is the pre-existing row shape and means "block the whole
# platform". Against a host app that is exactly the outcome this feature exists
# to prevent, so it must produce nothing — armed catalog or not.
LoadPanels $PANELS_TEAMS_ARMED
LoadSurfaces $SURFACES_TEAMS_ARMED
LoadRows $ROWS_TEAMS_PLATFORM
ResetState
for ($i = 0; $i -lt 3; $i++) { TeamsTick 'teams_platform_row_never_blocks' $i $FOCUS_TEAMS_COMPOSER $TITLE_TEAMS_AGENT }

# ── TD: …nor a host-keyed process_name row, nor a panel-keyed one ───────────
# Neither can be synthesised (processesForHost excludes a host app;
# teams_composer carries host:null), so these prove the .ps1 refuses a row that
# could only arrive through a bug in the other file.
LoadPanels $PANELS_TEAMS_ARMED
LoadSurfaces $SURFACES_TEAMS_ARMED
LoadRows $ROWS_TEAMS_PROCESS_NAME
ResetState
for ($i = 0; $i -lt 3; $i++) { TeamsTick 'teams_process_row_never_blocks' $i $FOCUS_TEAMS_COMPOSER $TITLE_TEAMS_AGENT }

LoadPanels $PANELS_TEAMS_ARMED
LoadSurfaces $SURFACES_TEAMS_ARMED
LoadRows $ROWS_TEAMS_PANEL
ResetState
for ($i = 0; $i -lt 3; $i++) { TeamsTick 'teams_panel_row_never_blocks' $i $FOCUS_TEAMS_COMPOSER $TITLE_TEAMS_AGENT }

# ── TE: PRIVACY GATE — no agent policy for Teams means no read at all ───────
# The armed catalog, but the only agent-scoped row is for ChatGPT
# (openai_assistant), a platform PLATFORM_PROCS does not map to ms-teams. Teams
# is therefore absent from _agentScopedProcs, hostAppArmed is false, and NOTHING
# is read — no window title, no accessibility call — even with the blocked
# agent's own composer focused. Reading a company's chat window titles to learn
# what is open is justified only by a policy that needs the answer.
LoadPanels $PANELS_TEAMS_ARMED
LoadSurfaces $SURFACES_TEAMS_ARMED
LoadRows $ROWS_AGENT_CHATGPT
ResetState
for ($i = 0; $i -lt 3; $i++) { TeamsTick 'teams_no_policy_no_read' $i $FOCUS_TEAMS_COMPOSER $TITLE_TEAMS_AGENT }

# ── TE2: …and a PLATFORM-scoped Teams row does not license the read either ──
# Only agent_scope:'agent' puts a process into _agentScopedProcs. This is the
# same gate the composer read has, asserted here because for a host app it is
# the difference between "we look at Teams" and "we do not".
LoadPanels $PANELS_TEAMS_ARMED
LoadSurfaces $SURFACES_TEAMS_ARMED
LoadRows $ROWS_TEAMS_PLATFORM
ResetState
for ($i = 0; $i -lt 3; $i++) { TeamsTick 'teams_platform_row_no_read' $i $FOCUS_TEAMS_COMPOSER $TITLE_TEAMS_AGENT }

# ═══ The mechanism, driven with the TEST-ONLY armed flags ═══════════════════
# Everything below flips teams_desktop and teams_composer to enforce+verified.
# That is NOT a catalog change — ai-processes.test.mjs pins the shipped values
# at false. It is how Stage 1-2 proves the mechanism it builds actually works
# before Stage 3 turns it on for real.

# ── TF: the blocked agent's conversation, composer focused — the ONE block ──
LoadPanels $PANELS_TEAMS_ARMED
LoadSurfaces $SURFACES_TEAMS_ARMED
LoadRows $ROWS_TEAMS_AGENT
ResetState
for ($i = 0; $i -lt 20; $i++) { TeamsTick 'teams_agent_blocked' $i $FOCUS_TEAMS_COMPOSER $TITLE_TEAMS_AGENT }

# ── TF2: the same agent reached through copilot_studio instead ──────────────
# PLATFORM_PROCS maps copilot_studio to both Copilot builds AND to ms-teams, so
# a Copilot Studio agent added to Teams is covered by its own platform id.
LoadPanels $PANELS_TEAMS_ARMED
LoadSurfaces $SURFACES_TEAMS_ARMED
LoadRows $ROWS_TEAMS_VIA_COPILOT_STUDIO
ResetState
for ($i = 0; $i -lt 5; $i++) { TeamsTick 'teams_agent_via_copilot_studio' $i $FOCUS_TEAMS_COMPOSER $TITLE_TEAMS_AGENT }

# ── TG: a 1:1 DM must never be touched ──────────────────────────────────────
# Measured: a plain DM's title has NO leading kind segment at all — segment 0 is
# the colleague's display name. Without the kind check this would read as an
# agent named after a person.
LoadPanels $PANELS_TEAMS_ARMED
LoadSurfaces $SURFACES_TEAMS_ARMED
LoadRows $ROWS_TEAMS_AGENT
ResetState
for ($i = 0; $i -lt 5; $i++) { TeamsTick 'teams_dm_never_blocks' $i $FOCUS_TEAMS_COMPOSER $TITLE_TEAMS_DM }

# ── TH: a default-named human GROUP CHAT must never be touched ──────────────
# Its title has the IDENTICAL 5-segment shape as the agent's, so the kind
# segment cannot separate them. Teams' own participant naming is what does.
LoadPanels $PANELS_TEAMS_ARMED
LoadSurfaces $SURFACES_TEAMS_ARMED
LoadRows $ROWS_TEAMS_AGENT
ResetState
for ($i = 0; $i -lt 5; $i++) { TeamsTick 'teams_group_chat_never_blocks' $i $FOCUS_TEAMS_COMPOSER $TITLE_TEAMS_GROUP }

# ── TI: channels, the Activity tab and the generic Copilot panel likewise ───
LoadPanels $PANELS_TEAMS_ARMED
LoadSurfaces $SURFACES_TEAMS_ARMED
LoadRows $ROWS_TEAMS_AGENT
ResetState
TeamsTick 'teams_other_surfaces_never_block' 0 $FOCUS_TEAMS_COMPOSER $TITLE_TEAMS_CHANNEL
TeamsTick 'teams_other_surfaces_never_block' 1 $FOCUS_TEAMS_COMPOSER $TITLE_TEAMS_ACTIVITY
TeamsTick 'teams_other_surfaces_never_block' 2 $FOCUS_TEAMS_COMPOSER $TITLE_TEAMS_COPILOT

# ── TJ: leaving the blocked conversation RELEASES within one tick ───────────
# The fail-OPEN direction, and the reason a host app's latch rule is wider than
# a chat app's: a successfully-read title that is not a nameable Chat is
# positive evidence the blocked conversation is not open, not a failed read.
# Holding the block past it would leave Enter dead in a channel.
LoadPanels $PANELS_TEAMS_ARMED
LoadSurfaces $SURFACES_TEAMS_ARMED
LoadRows $ROWS_TEAMS_AGENT
ResetState
TeamsTick 'teams_release_to_channel' 0 $FOCUS_TEAMS_COMPOSER $TITLE_TEAMS_AGENT
TeamsTick 'teams_release_to_channel' 1 $FOCUS_TEAMS_COMPOSER $TITLE_TEAMS_CHANNEL
TeamsTick 'teams_release_to_channel' 2 $FOCUS_TEAMS_COMPOSER $TITLE_TEAMS_CHANNEL

LoadPanels $PANELS_TEAMS_ARMED
LoadSurfaces $SURFACES_TEAMS_ARMED
LoadRows $ROWS_TEAMS_AGENT
ResetState
TeamsTick 'teams_release_to_activity' 0 $FOCUS_TEAMS_COMPOSER $TITLE_TEAMS_AGENT
TeamsTick 'teams_release_to_activity' 1 $FOCUS_TEAMS_COMPOSER $TITLE_TEAMS_ACTIVITY
TeamsTick 'teams_release_to_activity' 2 $FOCUS_TEAMS_COMPOSER $TITLE_TEAMS_ACTIVITY

LoadPanels $PANELS_TEAMS_ARMED
LoadSurfaces $SURFACES_TEAMS_ARMED
LoadRows $ROWS_TEAMS_AGENT
ResetState
TeamsTick 'teams_release_to_dm' 0 $FOCUS_TEAMS_COMPOSER $TITLE_TEAMS_AGENT
TeamsTick 'teams_release_to_dm' 1 $FOCUS_TEAMS_COMPOSER $TITLE_TEAMS_DM
TeamsTick 'teams_release_to_dm' 2 $FOCUS_TEAMS_COMPOSER $TITLE_TEAMS_DM

# ── TK: the composer is NOT focused — the block holds, capture does not ─────
# The user is scrolling the blocked agent's transcript. The title still says the
# agent conversation is open, so the block is correct to stand (via the sticky
# window); but _fgIsPanel is false, so PanelUiaOk/PanelEnforceOk deny every
# content read. Tick 2 ages the sticky window out to show it does not stand
# indefinitely on an unfocused composer — the fail-OPEN direction again.
LoadPanels $PANELS_TEAMS_ARMED
LoadSurfaces $SURFACES_TEAMS_ARMED
LoadRows $ROWS_TEAMS_AGENT
ResetState
TeamsTick 'teams_composer_not_focused' 0 $FOCUS_TEAMS_COMPOSER $TITLE_TEAMS_AGENT
TeamsTick 'teams_composer_not_focused' 1 $FOCUS_TEAMS_MESSAGE_LIST $TITLE_TEAMS_AGENT
Age '_fgLeftAiTicks' 4000
TeamsTick 'teams_composer_not_focused' 2 $FOCUS_TEAMS_MESSAGE_LIST $TITLE_TEAMS_AGENT

# ── TL: an unreadable TITLE is no evidence — the latch survives it ──────────
# The one outcome that is a genuine read failure rather than a fact. Bounded by
# the same PANEL_BLOCK_LATCH_TTL every other latch use is.
LoadPanels $PANELS_TEAMS_ARMED
LoadSurfaces $SURFACES_TEAMS_ARMED
LoadRows $ROWS_TEAMS_AGENT
ResetState
TeamsTick 'teams_unreadable_title' 0 $FOCUS_TEAMS_COMPOSER $TITLE_TEAMS_AGENT
for ($i = 1; $i -lt 6; $i++) { TeamsTick 'teams_unreadable_title' $i $FOCUS_TEAMS_COMPOSER $null }
Age '_panelBlockLatchTicks' 11000
Age '_fgLeftAiTicks' 4000
TeamsTick 'teams_latch_expires' 0 $FOCUS_TEAMS_COMPOSER $null

# ── TM: switching to a DIFFERENT, unblocked agent clears in one tick ────────
LoadPanels $PANELS_TEAMS_ARMED
LoadSurfaces $SURFACES_TEAMS_ARMED
LoadRows $ROWS_TEAMS_AGENT
ResetState
TeamsTick 'teams_other_agent_clears' 0 $FOCUS_TEAMS_COMPOSER $TITLE_TEAMS_AGENT
TeamsTick 'teams_other_agent_clears' 1 $FOCUS_TEAMS_COMPOSER 'Chat | Expenses Helper | filefuze | erik@filefuze.co | Microsoft Teams'
TeamsTick 'teams_other_agent_clears' 2 $FOCUS_TEAMS_COMPOSER 'Chat | Expenses Helper | filefuze | erik@filefuze.co | Microsoft Teams'

# ── TN: an admin lifting the block takes effect at once ─────────────────────
LoadPanels $PANELS_TEAMS_ARMED
LoadSurfaces $SURFACES_TEAMS_ARMED
LoadRows $ROWS_TEAMS_AGENT
ResetState
TeamsTick 'teams_admin_unblocks' 0 $FOCUS_TEAMS_COMPOSER $TITLE_TEAMS_AGENT
LoadRows $ROWS_EMPTY
TeamsTick 'teams_admin_unblocks' 1 $FOCUS_TEAMS_COMPOSER $TITLE_TEAMS_AGENT

# ── TO: the panic hotkey still overrides a Teams block ──────────────────────
LoadPanels $PANELS_TEAMS_ARMED
LoadSurfaces $SURFACES_TEAMS_ARMED
LoadRows $ROWS_TEAMS_AGENT
ResetState
TeamsTick 'teams_panic_hotkey' 0 $FOCUS_TEAMS_COMPOSER $TITLE_TEAMS_AGENT
SetF '_disarmedUntilTicks' ([long]([DateTime]::UtcNow.Ticks + [TimeSpan]::FromSeconds(600).Ticks))
TeamsTick 'teams_panic_hotkey' 1 $FOCUS_TEAMS_COMPOSER $TITLE_TEAMS_AGENT

# ── TP: the WebView2 child-process composer, with REAL processes ────────────
# ms-teams.exe hosts its real UI in a child msedgewebview2.exe — confirmed live
# via Win32_Process ParentProcessId, exactly as M365Copilot does. With the
# panel read's default exact-pid rule the composer could never be matched at
# all, so allowChildProcess is what makes the whole feature reachable. Modelled
# with genuine child processes rather than invented pids, same as scenario AD.
$teamsChildA = $null
$teamsChildB = $null
try {
  $psi2 = New-Object System.Diagnostics.ProcessStartInfo
  $psi2.FileName = 'ping.exe'
  $psi2.Arguments = '-n 30 127.0.0.1'
  $psi2.UseShellExecute = $false
  $psi2.CreateNoWindow = $true
  $psi2.RedirectStandardOutput = $true
  $teamsChildA = [System.Diagnostics.Process]::Start($psi2)
  $teamsChildB = [System.Diagnostics.Process]::Start($psi2)
  $selfPid2 = [uint32]$PID

  LoadPanels $PANELS_TEAMS_ARMED
  LoadSurfaces $SURFACES_TEAMS_ARMED
  LoadRows $ROWS_TEAMS_AGENT
  ResetState
  for ($i = 0; $i -lt 3; $i++) {
    TeamsTick 'teams_webview_child_pid' $i $FOCUS_TEAMS_COMPOSER $TITLE_TEAMS_AGENT $selfPid2 'ms-teams' $teamsChildA.Id
  }

  # …and the safety check it PRESERVES: a genuinely unrelated process's element
  # is still rejected, so a global FocusedElement read that lands in another app
  # can never make a Teams tick governed.
  LoadPanels $PANELS_TEAMS_ARMED
  LoadSurfaces $SURFACES_TEAMS_ARMED
  LoadRows $ROWS_TEAMS_AGENT
  ResetState
  TeamsTick 'teams_unrelated_pid_rejected' 0 $FOCUS_TEAMS_COMPOSER $TITLE_TEAMS_AGENT ([uint32]$teamsChildA.Id) 'ms-teams' $teamsChildB.Id
  ResetState
  TeamsTick 'teams_unrelated_pid_rejected' 1 $FOCUS_TEAMS_COMPOSER $TITLE_TEAMS_AGENT ([uint32]$teamsChildA.Id) 'ms-teams' ([int]$selfPid2)
}
finally {
  foreach ($c in @($teamsChildA, $teamsChildB)) {
    if ($null -ne $c) { try { $c.Kill() } catch { } ; try { $c.Dispose() } catch { } }
  }
}

# ═══ THE SECOND UI ROUTE: Teams' embedded Copilot tab ═══════════════════════
# Its window title is the generic, CONSTANT "Copilot | <tenant> | <email> |
# Microsoft Teams" no matter which agent is open, so the primary title parse
# correctly names nothing there and that route was a silent detection gap. The
# agent's name is in the PANE instead. Two independent gates have to be open
# before any of it does anything: teams_desktop's own pair (the Chat-list route)
# AND the nested fallbackRead pair.

# ── TR: THE UNVERIFIED-ROUTE FIXTURE — completely inert ─────────────────────
# The Chat-list route fully ARMED (so this is not "nothing is on"), the
# Copilot-tab fallback held at false/false by the fixture — the shape it shipped
# in before its 2026-09-02 live pass, and the shape any future route ships in.
# This is what the gate has to keep doing forever. The blocked agent's own
# conversation is open in the Copilot tab, its composer focused, and a matching
# message heading is sitting right there — and nothing may happen, including no
# search being attempted at all.
LoadPanels $PANELS_TEAMS_ARMED
LoadSurfaces $SURFACES_TEAMS_ARMED
LoadRows $ROWS_TEAMS_AGENT
ResetState
for ($i = 0; $i -lt 5; $i++) {
  TeamsCopilotTick 'copilot_tab_is_inert' $i $FOCUS_TEAMS_COPILOT_COMPOSER $TITLE_TEAMS_COPILOT $HEAD_ONE_MESSAGE
}

# ═══ The mechanism, driven with BOTH pairs flipped (TEST-ONLY) ══════════════

# ── TS: one exchange — the agent's own message heading names it ─────────────
LoadPanels $PANELS_COPILOT_ARMED
LoadSurfaces $SURFACES_COPILOT_ARMED
LoadRows $ROWS_TEAMS_AGENT
ResetState
for ($i = 0; $i -lt 10; $i++) {
  TeamsCopilotTick 'copilot_tab_message_heading' $i $FOCUS_TEAMS_COPILOT_COMPOSER $TITLE_TEAMS_COPILOT $HEAD_ONE_MESSAGE
}

# ── TS2: two exchanges — headings ACCUMULATE and must still agree ───────────
LoadPanels $PANELS_COPILOT_ARMED
LoadSurfaces $SURFACES_COPILOT_ARMED
LoadRows $ROWS_TEAMS_AGENT
ResetState
for ($i = 0; $i -lt 5; $i++) {
  TeamsCopilotTick 'copilot_tab_two_messages' $i $FOCUS_TEAMS_COPILOT_COMPOSER $TITLE_TEAMS_COPILOT $HEAD_TWO_MESSAGES
}

# ── TT: a FRESH conversation — the landing heading names it ────────────────
# The common state right after opening an agent, since re-opening resets the
# Copilot-tab conversation to empty (confirmed live).
LoadPanels $PANELS_COPILOT_ARMED
LoadSurfaces $SURFACES_COPILOT_ARMED
LoadRows $ROWS_TEAMS_AGENT
ResetState
for ($i = 0; $i -lt 5; $i++) {
  TeamsCopilotTick 'copilot_tab_landing_heading' $i $FOCUS_TEAMS_COPILOT_COMPOSER $TITLE_TEAMS_COPILOT $HEAD_LANDING
}

# ── TU: DISAGREEING headings are NO EVIDENCE, never a block ────────────────
LoadPanels $PANELS_COPILOT_ARMED
LoadSurfaces $SURFACES_COPILOT_ARMED
LoadRows $ROWS_TEAMS_AGENT
ResetState
for ($i = 0; $i -lt 5; $i++) {
  TeamsCopilotTick 'copilot_tab_disagreeing' $i $FOCUS_TEAMS_COPILOT_COMPOSER $TITLE_TEAMS_COPILOT $HEAD_DISAGREE
}

# ── TU2: only the USER has spoken — a different class, so no agent evidence ─
LoadPanels $PANELS_COPILOT_ARMED
LoadSurfaces $SURFACES_COPILOT_ARMED
LoadRows $ROWS_TEAMS_AGENT
ResetState
for ($i = 0; $i -lt 3; $i++) {
  TeamsCopilotTick 'copilot_tab_user_only' $i $FOCUS_TEAMS_COPILOT_COMPOSER $TITLE_TEAMS_COPILOT $HEAD_USER_ONLY
}
# …and a pane the walk found nothing in at all.
LoadPanels $PANELS_COPILOT_ARMED
LoadSurfaces $SURFACES_COPILOT_ARMED
LoadRows $ROWS_TEAMS_AGENT
ResetState
for ($i = 0; $i -lt 3; $i++) {
  TeamsCopilotTick 'copilot_tab_no_headings' $i $FOCUS_TEAMS_COPILOT_COMPOSER $TITLE_TEAMS_COPILOT $null
}

# ── TV: a DM and a group chat NEVER trigger a search at all ────────────────
# Fully armed, and the ONLY thing different is which view the title names. A DM's
# title has no kind segment (segment 0 is the colleague's display name) and a
# group chat's kind is "Chat" — neither is in paneKinds, so FallbackReadArmed is
# false and no walk of a colleague conversation's pane is ever attempted. The
# headings passed here would name the blocked agent if anything looked at them.
LoadPanels $PANELS_COPILOT_ARMED
LoadSurfaces $SURFACES_COPILOT_ARMED
LoadRows $ROWS_TEAMS_AGENT
ResetState
TeamsCopilotTick 'copilot_tab_no_search_off_route' 0 $FOCUS_TEAMS_COPILOT_COMPOSER $TITLE_TEAMS_DM $HEAD_ONE_MESSAGE
TeamsCopilotTick 'copilot_tab_no_search_off_route' 1 $FOCUS_TEAMS_COPILOT_COMPOSER $TITLE_TEAMS_GROUP $HEAD_ONE_MESSAGE
TeamsCopilotTick 'copilot_tab_no_search_off_route' 2 $FOCUS_TEAMS_COPILOT_COMPOSER $TITLE_TEAMS_CHANNEL $HEAD_ONE_MESSAGE
TeamsCopilotTick 'copilot_tab_no_search_off_route' 3 $FOCUS_TEAMS_COPILOT_COMPOSER $TITLE_TEAMS_ACTIVITY $HEAD_ONE_MESSAGE
# …and the Chat-list route's OWN positive case still resolves through the TITLE,
# with no search: stage B is only ever reached from no evidence.
TeamsCopilotTick 'copilot_tab_no_search_off_route' 4 $FOCUS_TEAMS_COMPOSER $TITLE_TEAMS_AGENT $HEAD_ONE_MESSAGE

# ── TW: leaving the Copilot tab RELEASES within one tick ───────────────────
LoadPanels $PANELS_COPILOT_ARMED
LoadSurfaces $SURFACES_COPILOT_ARMED
LoadRows $ROWS_TEAMS_AGENT
ResetState
TeamsCopilotTick 'copilot_tab_release' 0 $FOCUS_TEAMS_COPILOT_COMPOSER $TITLE_TEAMS_COPILOT $HEAD_ONE_MESSAGE
TeamsCopilotTick 'copilot_tab_release' 1 $FOCUS_TEAMS_COMPOSER $TITLE_TEAMS_CHANNEL $null
TeamsCopilotTick 'copilot_tab_release' 2 $FOCUS_TEAMS_COMPOSER $TITLE_TEAMS_CHANNEL $null

# ── TX: switching to a DIFFERENT agent inside the Copilot tab clears ───────
# Same tab, same title, same window — only the pane's headings change. This is
# the case the cache TTL exists to bound in production; here the substituted
# walk simply returns the new pane's headings.
LoadPanels $PANELS_COPILOT_ARMED
LoadSurfaces $SURFACES_COPILOT_ARMED
LoadRows $ROWS_TEAMS_AGENT
ResetState
$HEAD_OTHER_AGENT = @(
  ,@('fai-CopilotMessage__accessibleHeading rhgro0h', 'Expenses Helper said:')
)
TeamsCopilotTick 'copilot_tab_other_agent' 0 $FOCUS_TEAMS_COPILOT_COMPOSER $TITLE_TEAMS_COPILOT $HEAD_ONE_MESSAGE
TeamsCopilotTick 'copilot_tab_other_agent' 1 $FOCUS_TEAMS_COPILOT_COMPOSER $TITLE_TEAMS_COPILOT $HEAD_OTHER_AGENT
TeamsCopilotTick 'copilot_tab_other_agent' 2 $FOCUS_TEAMS_COPILOT_COMPOSER $TITLE_TEAMS_COPILOT $HEAD_OTHER_AGENT

# ── TY: the privacy gate still governs the new route ───────────────────────
# Fully armed catalog, blocked agent open in the Copilot tab — but the only
# agent-scoped row is for ChatGPT, so Teams is absent from _agentScopedProcs and
# nothing about Teams is read or searched.
LoadPanels $PANELS_COPILOT_ARMED
LoadSurfaces $SURFACES_COPILOT_ARMED
LoadRows $ROWS_AGENT_CHATGPT
ResetState
for ($i = 0; $i -lt 3; $i++) {
  TeamsCopilotTick 'copilot_tab_no_policy_no_read' $i $FOCUS_TEAMS_COPILOT_COMPOSER $TITLE_TEAMS_COPILOT $HEAD_ONE_MESSAGE
}

# ── TZ: a PLATFORM-scoped row still blocks nothing on this route either ────
LoadPanels $PANELS_COPILOT_ARMED
LoadSurfaces $SURFACES_COPILOT_ARMED
LoadRows $ROWS_TEAMS_PLATFORM
ResetState
for ($i = 0; $i -lt 3; $i++) {
  TeamsCopilotTick 'copilot_tab_platform_row_never_blocks' $i $FOCUS_TEAMS_COPILOT_COMPOSER $TITLE_TEAMS_COPILOT $HEAD_ONE_MESSAGE
}

# ═══ TEAMS RE-TITLES THE CHAT-LIST ROUTE (live 2026-09-04) ══════════════════
#
# THE OBSERVATION. In the SAME Chat-list agent conversation the user had not
# navigated away from, Teams stopped serving
#   "Chat | IT Help Desk Agent | filefuze | erik@filefuze.co | Microsoft Teams"
# and started serving
#   "Copilot | filefuze | erik@filefuze.co | Microsoft Teams"
# — the four-segment Copilot-tab shape, carrying NO conversation name at all.
# Teams chose that; nothing on our side can prevent it.
#
# WHY THE MECHANISM ALREADY COVERS IT, and why these scenarios PIN that rather
# than change it. ReadTitleModeAgentName's stage-B gate is FallbackReadArmed,
# which keys on the TITLE'S KIND SEGMENT ALONE — never on which composer holds
# focus. So a Copilot-kind title reaches the heading fallback whichever Teams
# composer is focused, the Chat-list CKEditor included. The scenarios below drive
# exactly that: $FOCUS_TEAMS_COMPOSER (ck-editor__editable, the Chat-list route)
# with $TITLE_TEAMS_COPILOT.
#
# WHY THE BOUNDARY IS SAFE, stated as the thing under test rather than as a
# claim. The fallback is NOT reached because "the title failed to name a
# conversation" — it is reached only when the title's kind is one this route
# applies to. A 1:1 DM (no kind segment), a renamed human group chat and a
# channel post all keep their own kinds, so they never reach it; the
# renamed_group_chat_no_search scenario below drives those with headings that
# WOULD name the blocked agent, and nothing may look at them.

# A group chat a human DELIBERATELY renamed to something that is not Teams' own
# participant-list form. looksLikeParticipantList cannot recognise it — that
# residual risk is accepted and documented on the JS side — so the ONLY thing
# keeping it out of the heading walk is its title KIND still being "Chat". That
# is the boundary these scenarios exist to hold.
$TITLE_TEAMS_RENAMED_GROUP = 'Chat | Q4 launch war room | filefuze | erik@filefuze.co | Microsoft Teams'
# The governed (DLP-monitored, NOT blocked) list naming the very agent the
# measured headings name, so the recovered name is what has to make the tick
# governed. Same row shape blocked-agents-sync.js writes.
$GOV_TEAMS_AGENT_ITHELP = '[{"agent_id":"agent-ithelp","agent_name":"IT Help Desk Agent","platform":"teams_chat_agent","reason":"DLP monitored","oauth_key_id":"k1","agent_scope":"agent","dlp_monitor":true,"dlp_monitor_at":"2026-09-04T10:00:00.000Z","orphaned":false}]'

# ── CT1: the re-titled Chat-list conversation, named by its message heading ──
LoadPanels $PANELS_COPILOT_ARMED
LoadSurfaces $SURFACES_COPILOT_ARMED
LoadRows $ROWS_TEAMS_AGENT
ResetState
for ($i = 0; $i -lt 5; $i++) {
  TeamsCopilotTick 'chatlist_retitled_copilot_heading' $i $FOCUS_TEAMS_COMPOSER $TITLE_TEAMS_COPILOT $HEAD_ONE_MESSAGE
}

# ── CT2: the same, freshly opened — the LANDING heading names it ─────────────
LoadPanels $PANELS_COPILOT_ARMED
LoadSurfaces $SURFACES_COPILOT_ARMED
LoadRows $ROWS_TEAMS_AGENT
ResetState
for ($i = 0; $i -lt 3; $i++) {
  TeamsCopilotTick 'chatlist_retitled_copilot_landing' $i $FOCUS_TEAMS_COMPOSER $TITLE_TEAMS_COPILOT $HEAD_LANDING
}

# ── CT3: the re-titled conversation, GOVERNED-for-DLP rather than blocked ────
# The other half of the live report: the agent may be on the governed list, in
# which case the same recovered name has to make the tick DLP-governed (scanned,
# Tier B eligible) and block nothing. teams_composer is dlpMatch:'agent', so a
# panel match alone is NOT enough here — the recovered name is the only thing
# that can make this true, which is precisely what it pins.
LoadPanels $PANELS_COPILOT_ARMED
LoadSurfaces $SURFACES_COPILOT_ARMED
LoadGoverned $GOV_TEAMS_AGENT_ITHELP
LoadRows $ROWS_EMPTY
ResetState
for ($i = 0; $i -lt 3; $i++) {
  TeamsCopilotTick 'chatlist_retitled_copilot_governed' $i $FOCUS_TEAMS_COMPOSER $TITLE_TEAMS_COPILOT $HEAD_ONE_MESSAGE
}
LoadGoverned $null

# ── CT4: THE PROTECTION THAT MUST SURVIVE — a human conversation, never read ─
# Same fully-armed catalog, same Chat-list composer, and headings that name the
# blocked agent sitting right there. The ONLY difference is the title's kind: a
# 1:1 DM (no kind segment at all — segment 0 is the colleague's display name), a
# renamed group chat and Teams' own participant-list naming all keep kind "Chat"
# or no kind, so FallbackReadArmed refuses and no walk of a colleague
# conversation's pane is ever attempted.
LoadPanels $PANELS_COPILOT_ARMED
LoadSurfaces $SURFACES_COPILOT_ARMED
LoadRows $ROWS_TEAMS_AGENT
ResetState
TeamsCopilotTick 'chatlist_human_chat_no_search' 0 $FOCUS_TEAMS_COMPOSER $TITLE_TEAMS_DM $HEAD_ONE_MESSAGE
TeamsCopilotTick 'chatlist_human_chat_no_search' 1 $FOCUS_TEAMS_COMPOSER $TITLE_TEAMS_GROUP $HEAD_ONE_MESSAGE
TeamsCopilotTick 'chatlist_human_chat_no_search' 2 $FOCUS_TEAMS_COMPOSER $TITLE_TEAMS_RENAMED_GROUP $HEAD_ONE_MESSAGE
TeamsCopilotTick 'chatlist_human_chat_no_search' 3 $FOCUS_TEAMS_COMPOSER $TITLE_TEAMS_CHANNEL $HEAD_ONE_MESSAGE

# ── CT5: the MESSAGE LIST focused, not the composer ─────────────────────────
# The re-titled title plus a naming heading is still not enough on its own: the
# focused ELEMENT has to be an enforcing composer. Focus on the transcript must
# leave the tick ungoverned even though the read itself recovers the name.
LoadPanels $PANELS_COPILOT_ARMED
LoadSurfaces $SURFACES_COPILOT_ARMED
LoadRows $ROWS_TEAMS_AGENT
ResetState
for ($i = 0; $i -lt 3; $i++) {
  TeamsCopilotTick 'chatlist_retitled_not_composer' $i $FOCUS_TEAMS_MESSAGE_LIST $TITLE_TEAMS_COPILOT $HEAD_ONE_MESSAGE
}

# ── CT6: the re-title is TRANSIENT — switching shapes must not lose the block ─
# Teams flipped the format mid-conversation, so the two shapes interleave. Both
# have to resolve to the same block, with no ungoverned tick in between.
LoadPanels $PANELS_COPILOT_ARMED
LoadSurfaces $SURFACES_COPILOT_ARMED
LoadRows $ROWS_TEAMS_AGENT
ResetState
TeamsCopilotTick 'chatlist_title_shape_flaps' 0 $FOCUS_TEAMS_COMPOSER $TITLE_TEAMS_AGENT $HEAD_ONE_MESSAGE
TeamsCopilotTick 'chatlist_title_shape_flaps' 1 $FOCUS_TEAMS_COMPOSER $TITLE_TEAMS_COPILOT $HEAD_ONE_MESSAGE
TeamsCopilotTick 'chatlist_title_shape_flaps' 2 $FOCUS_TEAMS_COMPOSER $TITLE_TEAMS_AGENT $HEAD_ONE_MESSAGE
TeamsCopilotTick 'chatlist_title_shape_flaps' 3 $FOCUS_TEAMS_COMPOSER $TITLE_TEAMS_COPILOT $HEAD_ONE_MESSAGE

# ── CT7: re-titled, and the pane names an agent NOBODY has a policy about ────
# The recovered name is authoritative, and it is not on either list. No block, no
# DLP governance, no capture — the fallback widens coverage, never policy.
LoadPanels $PANELS_COPILOT_ARMED
LoadSurfaces $SURFACES_COPILOT_ARMED
LoadRows $ROWS_TEAMS_AGENT
ResetState
$HEAD_UNPOLICED_AGENT = @(
  ,@('fai-CopilotMessage__accessibleHeading rhgro0h', 'Expenses Helper said:')
)
for ($i = 0; $i -lt 3; $i++) {
  TeamsCopilotTick 'chatlist_retitled_unpoliced' $i $FOCUS_TEAMS_COMPOSER $TITLE_TEAMS_COPILOT $HEAD_UNPOLICED_AGENT
}

# ── CT8: re-titled, and the walk found NOTHING in the pane ──────────────────
# The honest limitation of this route, pinned so it cannot be mistaken for
# coverage: when Teams serves the Copilot-shaped title AND the pane yields no
# heading the extractor recognises, there is no signal left anywhere and the
# outcome is no evidence. For a host app that is the correct fail direction
# (open), and it is why the heading classes this route keys on are the thing to
# re-measure if this state is ever observed live on the Chat-list route.
LoadPanels $PANELS_COPILOT_ARMED
LoadSurfaces $SURFACES_COPILOT_ARMED
LoadRows $ROWS_TEAMS_AGENT
ResetState
for ($i = 0; $i -lt 3; $i++) {
  TeamsCopilotTick 'chatlist_retitled_no_headings' $i $FOCUS_TEAMS_COMPOSER $TITLE_TEAMS_COPILOT $null
}

# ═══ GOVERNED-FOR-DLP-ONLY: the third state a Teams conversation can be in ══
#
# Blocked (swallow every send), GOVERNED (scan the prompt, offer Tokenize &
# Send, never swallow anything), or untouched (no capture at all). The pair
# (dlpGoverned, fgIsBlocked) is what every scenario below is really about, and
# the one combination that must never occur is TRUE/TRUE.
#
# The governed list is a SEPARATE file read by the real UpdateGovernedAgents —
# see LoadGoverned. Its rows are the shape blocked-agents-sync.js writes.

# A DLP-monitored (not blocked) Teams agent. Deliberately a DIFFERENT agent from
# the blocked fixture's "IT Help Desk Agent", so a scenario can hold both lists
# at once and show them acting on different conversations.
$GOV_TEAMS_AGENT = '[{"agent_id":"ag-gov-1","agent_name":"Expenses Helper","platform":"teams_chat_agent","reason":"DLP monitored","oauth_key_id":"k1","agent_scope":"agent","dlp_monitor":true,"dlp_monitor_at":"2026-09-01T10:00:00.000Z","orphaned":false}]'
# The SAME agent the blocked fixture names, on BOTH lists. The sync layer
# guarantees this cannot happen on disk (filterGovernedAgents subtracts the
# blocked list); this fixture is the defensive case — if it ever did, blocked
# must win outright, never "both" and never "neither".
$GOV_TEAMS_ALSO_BLOCKED = '[{"agent_id":"agent-ithelp","agent_name":"IT Help Desk Agent","platform":"teams_chat_agent","reason":"DLP monitored","oauth_key_id":"k1","agent_scope":"agent","dlp_monitor":true,"orphaned":false}]'
# A governed row with NO agent scope. For a host app "monitor this whole
# platform" would mean capturing every prompt typed anywhere in Teams, so it
# must govern nothing at all — and must not even license the read.
$GOV_TEAMS_PLATFORM = '[{"agent_id":"ag-gov-2","agent_name":"Expenses Helper","platform":"teams_chat_agent","reason":"DLP monitored","agent_scope":null,"dlp_monitor":true}]'
# A governed row for a platform that does not map to ms-teams — the privacy gate
# again, from the governed side.
$GOV_CHATGPT = '[{"agent_id":"ag-gov-3","agent_name":"Research Assistant","platform":"openai_assistant","reason":"DLP monitored","agent_scope":"agent","dlp_monitor":true}]'
# A governed M365Copilot agent, for the non-host-app regression pin.
$GOV_M365_AGENT = '[{"agent_id":"ag-gov-4","agent_name":"HR Helper","platform":"personal_agent","reason":"DLP monitored","agent_scope":"agent","dlp_monitor":true}]'
$GOV_EMPTY = '[]'

$TITLE_TEAMS_GOV_AGENT = 'Chat | Expenses Helper | filefuze | erik@filefuze.co | Microsoft Teams'

# ── GA: a governed agent, and NOTHING on the blocked list ───────────────────
# The plain case. The conversation is DLP-governed: captured and scanned, Tier B
# eligible — and every Enter still goes through.
LoadPanels $PANELS_TEAMS_ARMED
LoadSurfaces $SURFACES_TEAMS_ARMED
LoadGoverned $GOV_TEAMS_AGENT
LoadRows $ROWS_EMPTY
ResetState
for ($i = 0; $i -lt 10; $i++) {
  TeamsTick 'teams_governed_dlp_only' $i $FOCUS_TEAMS_COMPOSER $TITLE_TEAMS_GOV_AGENT
}

# ── GB: both lists live, acting on two different conversations ──────────────
# Tick 0-1 the governed agent (DLP only), tick 2-3 the blocked one (blocked, and
# NOT Tier B eligible — masking cannot unblock a send the org disallowed), tick
# 4-5 back to the governed one.
LoadPanels $PANELS_TEAMS_ARMED
LoadSurfaces $SURFACES_TEAMS_ARMED
LoadGoverned $GOV_TEAMS_AGENT
LoadRows $ROWS_TEAMS_AGENT
ResetState
TeamsTick 'teams_governed_beside_blocked' 0 $FOCUS_TEAMS_COMPOSER $TITLE_TEAMS_GOV_AGENT
TeamsTick 'teams_governed_beside_blocked' 1 $FOCUS_TEAMS_COMPOSER $TITLE_TEAMS_GOV_AGENT
TeamsTick 'teams_governed_beside_blocked' 2 $FOCUS_TEAMS_COMPOSER $TITLE_TEAMS_AGENT
TeamsTick 'teams_governed_beside_blocked' 3 $FOCUS_TEAMS_COMPOSER $TITLE_TEAMS_AGENT
TeamsTick 'teams_governed_beside_blocked' 4 $FOCUS_TEAMS_COMPOSER $TITLE_TEAMS_GOV_AGENT
TeamsTick 'teams_governed_beside_blocked' 5 $FOCUS_TEAMS_COMPOSER $TITLE_TEAMS_GOV_AGENT

# ── GC: THE PRECEDENCE CASE — the same agent on BOTH lists ──────────────────
# Cannot happen on disk; must be unrepresentable here anyway. BLOCKED WINS: the
# send is swallowed and Tier B is refused, and the tick is never both.
LoadPanels $PANELS_TEAMS_ARMED
LoadSurfaces $SURFACES_TEAMS_ARMED
LoadGoverned $GOV_TEAMS_ALSO_BLOCKED
LoadRows $ROWS_TEAMS_AGENT
ResetState
for ($i = 0; $i -lt 5; $i++) {
  TeamsTick 'teams_governed_and_blocked_same_agent' $i $FOCUS_TEAMS_COMPOSER $TITLE_TEAMS_AGENT
}

# ── GD: THE PRIVACY CASE — a governed policy does not govern the rest of Teams
# A DM, a default-named human group chat, a channel post, the Activity tab, and
# the transcript above a governed composer. Every one of them must be untouched:
# no capture, no Tier B, no block.
LoadPanels $PANELS_TEAMS_ARMED
LoadSurfaces $SURFACES_TEAMS_ARMED
LoadGoverned $GOV_TEAMS_AGENT
LoadRows $ROWS_EMPTY
ResetState
TeamsTick 'teams_governed_leaves_teams_alone' 0 $FOCUS_TEAMS_COMPOSER $TITLE_TEAMS_DM
Age '_fgLeftAiTicks' 4000
TeamsTick 'teams_governed_leaves_teams_alone' 1 $FOCUS_TEAMS_COMPOSER $TITLE_TEAMS_GROUP
Age '_fgLeftAiTicks' 4000
TeamsTick 'teams_governed_leaves_teams_alone' 2 $FOCUS_TEAMS_COMPOSER $TITLE_TEAMS_CHANNEL
Age '_fgLeftAiTicks' 4000
TeamsTick 'teams_governed_leaves_teams_alone' 3 $FOCUS_TEAMS_COMPOSER $TITLE_TEAMS_ACTIVITY
Age '_fgLeftAiTicks' 4000
TeamsTick 'teams_governed_leaves_teams_alone' 4 $FOCUS_TEAMS_MESSAGE_LIST $TITLE_TEAMS_GOV_AGENT

# ── GE: an agent nobody governs, in the Chat list, is untouched ─────────────
# The Chat-list route requires the NAME: one composer element serves every Teams
# conversation, so a panel match there proves nothing on its own.
LoadPanels $PANELS_TEAMS_ARMED
LoadSurfaces $SURFACES_TEAMS_ARMED
LoadGoverned $GOV_TEAMS_AGENT
LoadRows $ROWS_EMPTY
ResetState
for ($i = 0; $i -lt 3; $i++) {
  TeamsTick 'teams_ungoverned_agent_untouched' $i $FOCUS_TEAMS_COMPOSER $TITLE_TEAMS_AGENT
}

# ── GF: the COPILOT TAB is governed by PANEL MATCH ALONE ────────────────────
# dlpMatch:'panel'. ANY conversation in that tab is DLP-governed, including the
# generic assistant with no agent name anywhere: tick 0 has no headings at all
# (nothing names anything), tick 1's heading names an agent on NO list. Both are
# governed, and neither is blocked. Safe because that composer has no non-AI use
# — there is no DM behind it.
LoadPanels $PANELS_COPILOT_ARMED
LoadSurfaces $SURFACES_COPILOT_ARMED
LoadGoverned $GOV_TEAMS_AGENT
LoadRows $ROWS_EMPTY
ResetState
TeamsCopilotTick 'copilot_tab_panel_alone_dlp' 0 $FOCUS_TEAMS_COPILOT_COMPOSER $TITLE_TEAMS_COPILOT $null
TeamsCopilotTick 'copilot_tab_panel_alone_dlp' 1 $FOCUS_TEAMS_COPILOT_COMPOSER $TITLE_TEAMS_COPILOT $HEAD_ONE_MESSAGE
TeamsCopilotTick 'copilot_tab_panel_alone_dlp' 2 $FOCUS_TEAMS_COPILOT_COMPOSER $TITLE_TEAMS_COPILOT $HEAD_USER_ONLY

# ── GF2: the CONTROL for GF — the same tab under the strict 'agent' rule ────
# Identical everything except the catalog field. dlpMatch:'agent' means the
# generic/unnamed conversation is NOT governed, which is what proves GF passes
# because of the catalog and not because the Copilot tab is special-cased in C#.
LoadPanels $PANELS_COPILOT_STRICT
LoadSurfaces $SURFACES_COPILOT_ARMED
LoadGoverned $GOV_TEAMS_AGENT
LoadRows $ROWS_EMPTY
ResetState
TeamsCopilotTick 'copilot_tab_strict_control' 0 $FOCUS_TEAMS_COPILOT_COMPOSER $TITLE_TEAMS_COPILOT $null
TeamsCopilotTick 'copilot_tab_strict_control' 1 $FOCUS_TEAMS_COPILOT_COMPOSER $TITLE_TEAMS_COPILOT $HEAD_ONE_MESSAGE

# ── GG: the blocked Copilot tab is still blocked, and never Tier B eligible ──
LoadPanels $PANELS_COPILOT_ARMED
LoadSurfaces $SURFACES_COPILOT_ARMED
LoadGoverned $GOV_TEAMS_AGENT
LoadRows $ROWS_TEAMS_AGENT
ResetState
for ($i = 0; $i -lt 3; $i++) {
  TeamsCopilotTick 'copilot_tab_blocked_no_tier_b' $i $FOCUS_TEAMS_COPILOT_COMPOSER $TITLE_TEAMS_COPILOT $HEAD_ONE_MESSAGE
}

# ── GH: PRIVACY GATE, from the governed side ────────────────────────────────
# The only governed row is for ChatGPT, so Teams is in NEITHER policy set: no
# title is read, no accessibility call is made, nothing is governed — even in
# the Copilot tab, whose panel-alone rule cannot be reached without the gate.
LoadPanels $PANELS_COPILOT_ARMED
LoadSurfaces $SURFACES_COPILOT_ARMED
LoadGoverned $GOV_CHATGPT
LoadRows $ROWS_EMPTY
ResetState
TeamsTick 'teams_governed_no_policy_no_read' 0 $FOCUS_TEAMS_COMPOSER $TITLE_TEAMS_GOV_AGENT
TeamsCopilotTick 'teams_governed_no_policy_no_read' 1 $FOCUS_TEAMS_COPILOT_COMPOSER $TITLE_TEAMS_COPILOT $HEAD_ONE_MESSAGE

# ── GH2: …and a PLATFORM-scoped governed row licenses nothing either ────────
LoadPanels $PANELS_COPILOT_ARMED
LoadSurfaces $SURFACES_COPILOT_ARMED
LoadGoverned $GOV_TEAMS_PLATFORM
LoadRows $ROWS_EMPTY
ResetState
TeamsTick 'teams_governed_platform_row_no_read' 0 $FOCUS_TEAMS_COMPOSER $TITLE_TEAMS_GOV_AGENT
TeamsCopilotTick 'teams_governed_platform_row_no_read' 1 $FOCUS_TEAMS_COPILOT_COMPOSER $TITLE_TEAMS_COPILOT $HEAD_ONE_MESSAGE

# ── GI: no governed file yet, and an empty one ──────────────────────────────
# A missing file is "the sync has not completed" and an empty array is "nothing
# is currently monitored". Different intent, identical effect: nothing governed.
LoadPanels $PANELS_COPILOT_ARMED
LoadSurfaces $SURFACES_COPILOT_ARMED
LoadGoverned $null
LoadRows $ROWS_EMPTY
ResetState
TeamsTick 'teams_governed_file_absent' 0 $FOCUS_TEAMS_COMPOSER $TITLE_TEAMS_GOV_AGENT
TeamsCopilotTick 'teams_governed_file_absent' 1 $FOCUS_TEAMS_COPILOT_COMPOSER $TITLE_TEAMS_COPILOT $HEAD_ONE_MESSAGE

LoadGoverned $GOV_EMPTY
LoadRows $ROWS_EMPTY
ResetState
TeamsTick 'teams_governed_file_empty' 0 $FOCUS_TEAMS_COMPOSER $TITLE_TEAMS_GOV_AGENT
TeamsCopilotTick 'teams_governed_file_empty' 1 $FOCUS_TEAMS_COPILOT_COMPOSER $TITLE_TEAMS_COPILOT $HEAD_ONE_MESSAGE

# ── GJ: an admin lifting DLP monitoring takes effect at once ────────────────
LoadPanels $PANELS_TEAMS_ARMED
LoadSurfaces $SURFACES_TEAMS_ARMED
LoadGoverned $GOV_TEAMS_AGENT
LoadRows $ROWS_EMPTY
ResetState
TeamsTick 'teams_governed_lifted' 0 $FOCUS_TEAMS_COMPOSER $TITLE_TEAMS_GOV_AGENT
LoadGoverned $GOV_EMPTY
Age '_fgLeftAiTicks' 4000
TeamsTick 'teams_governed_lifted' 1 $FOCUS_TEAMS_COMPOSER $TITLE_TEAMS_GOV_AGENT

# ── GK: REGRESSION PIN — a non-host-app AI app is untouched by all of this ──
# A governed list naming an agent in a CHAT app (M365Copilot). The chat-app
# branch must behave exactly as it always has: isAi from the process, isPanel
# false, dlpGoverned false (the flag is host-app-only), the blocked narrowing
# unchanged, and Tier B eligible exactly as it was — a chat app was never
# excluded from it. Nothing about the DLP list may reach any of it.
LoadPanels $PANELS_JSON
LoadSurfaces $SURFACES_SHIPPED
LoadGoverned $GOV_M365_AGENT
LoadRows $ROWS_AGENT
ResetState
AgentTick 'm365_unaffected_by_dlp_list' 0 $FOCUS_M365_ADVISOR
AgentTick 'm365_unaffected_by_dlp_list' 1 $FOCUS_M365_HR
AgentTick 'm365_unaffected_by_dlp_list' 2 $FOCUS_M365_GENERIC
AgentTick 'm365_unaffected_by_dlp_list' 3 $FOCUS_M365_ADVISOR

# …and a pure chat app with no agent surface at all (Claude Desktop). Tier B
# stays eligible on every tick, which is the property the host-app relaxation
# must not have disturbed anywhere else.
LoadPanels $PANELS_JSON
LoadSurfaces $SURFACES_SHIPPED
LoadGoverned $GOV_M365_AGENT
LoadRows $ROWS_EMPTY
ResetState
for ($i = 0; $i -lt 3; $i++) {
  AgentTick 'chat_app_unaffected_by_dlp_list' $i $FOCUS_CHATGPT ([uint32]7788) 'Claude'
}

# Governed monitoring off again, so nothing after this point observes it.
LoadGoverned $GOV_EMPTY

# ── TQ: an M365Copilot tick is byte-for-byte unaffected by all of the above ─
# The regression guard for the composer-name path. Run LAST, with the shipped
# catalog reloaded, so a fixture-only payload cannot be what makes it pass.
LoadPanels $PANELS_JSON
LoadSurfaces $SURFACES_SHIPPED
LoadRows $ROWS_AGENT
ResetState
AgentTick 'm365_unaffected_by_host_apps' 0 $FOCUS_M365_ADVISOR
AgentTick 'm365_unaffected_by_host_apps' 1 $FOCUS_M365_GENERIC
AgentTick 'm365_unaffected_by_host_apps' 2 $FOCUS_M365_ADVISOR
AgentTick 'm365_unaffected_by_host_apps' 3 $FOCUS_M365_TRANSCRIPT
AgentTick 'm365_unaffected_by_host_apps' 4 $null

# ═══ govstate: the FILE-SCANNING arm signal ═════════════════════════════════
#
# The Node side arms Microsoft Teams' three file-capture routes (drag-drop chip,
# file picker, clipboard file paste) for exactly as long as govstate says a
# governed or blocked agent conversation is the open one, and disarms them the
# instant it stops. Teams is absent from watcherProcessNames() and stays absent,
# so this signal is the only thing that ever lets those routes look at it.
#
# What every scenario below is really asserting is one of two things:
#   * govActive is FALSE wherever the org has not asked for governance — that is
#     the must-not-regress property, because false means no watcher is armed and
#     no file in Teams is ever read;
#   * a line is emitted only on a real TRANSITION, so a conversation left open
#     for minutes produces one line, not one per 150ms tick.

# A governed row whose agent_name is spelled in a DIFFERENT CASE from what the
# window title reads. AgentNameMatches is case-insensitive so it still matches —
# and that is what makes it a PROOF: whatever govstate carries has to be the
# lowercase ADMIN-TYPED spelling from this row, never the "Expenses Helper" the
# title parse produced. The event may carry admin-typed identity only.
$GOV_TEAMS_AGENT_LOWER = '[{"agent_id":"ag-gov-lower","agent_name":"expenses helper","platform":"teams_chat_agent","reason":"DLP monitored","agent_scope":"agent","dlp_monitor":true}]'
# Two governed agents, for the switch-between-conversations case.
$GOV_TEAMS_TWO = '[{"agent_id":"ag-gov-1","agent_name":"Expenses Helper","platform":"teams_chat_agent","reason":"DLP monitored","agent_scope":"agent","dlp_monitor":true},{"agent_id":"ag-gov-5","agent_name":"Travel Desk","platform":"teams_chat_agent","reason":"DLP monitored","agent_scope":"agent","dlp_monitor":true}]'
$TITLE_TEAMS_GOV_AGENT2 = 'Chat | Travel Desk | filefuze | erik@filefuze.co | Microsoft Teams'

# ── GS1: a GOVERNED Chat-list conversation arms, once ───────────────────────
# Ten identical ticks. govActive true on all ten; exactly ONE of them emitted.
# The key carries the row's lowercase spelling, proving the identity is the
# admin's and not the one read out of the window title.
LoadPanels $PANELS_TEAMS_ARMED
LoadSurfaces $SURFACES_TEAMS_ARMED
LoadGoverned $GOV_TEAMS_AGENT_LOWER
LoadRows $ROWS_EMPTY
ResetState
for ($i = 0; $i -lt 10; $i++) {
  TeamsTick 'govstate_governed_chat_list' $i $FOCUS_TEAMS_COMPOSER $TITLE_TEAMS_GOV_AGENT
}

# ── GS2: a BLOCKED Chat-list conversation arms too ─────────────────────────
# The union, not the DLP-only middle state: a file attached inside a conversation
# the org BLOCKED is the stronger case for scanning it, not an exemption. The key
# comes from the blocked row (CheckFgBlocked's own _blockedAgentName/Id).
LoadPanels $PANELS_TEAMS_ARMED
LoadSurfaces $SURFACES_TEAMS_ARMED
LoadGoverned $GOV_EMPTY
LoadRows $ROWS_TEAMS_AGENT
ResetState
for ($i = 0; $i -lt 5; $i++) {
  TeamsTick 'govstate_blocked_chat_list' $i $FOCUS_TEAMS_COMPOSER $TITLE_TEAMS_AGENT
}

# ── GS3: THE PROTECTION — a plain human conversation NEVER arms ────────────
# A 1:1 DM, a renamed human group chat, a channel and the Activity tab, with the
# composer genuinely focused and both policy lists live. Every tick must be
# govActive false and must never have emitted anything at all: nothing arms, so
# no file in any of these conversations is ever read.
LoadPanels $PANELS_TEAMS_ARMED
LoadSurfaces $SURFACES_TEAMS_ARMED
LoadGoverned $GOV_TEAMS_AGENT
LoadRows $ROWS_TEAMS_AGENT
ResetState
TeamsTick 'govstate_human_chat_never_arms' 0 $FOCUS_TEAMS_COMPOSER $TITLE_TEAMS_DM
TeamsTick 'govstate_human_chat_never_arms' 1 $FOCUS_TEAMS_COMPOSER $TITLE_TEAMS_GROUP
TeamsTick 'govstate_human_chat_never_arms' 2 $FOCUS_TEAMS_COMPOSER $TITLE_TEAMS_CHANNEL
TeamsTick 'govstate_human_chat_never_arms' 3 $FOCUS_TEAMS_COMPOSER $TITLE_TEAMS_ACTIVITY

# ── GS4: the STICKY WINDOW must not stay armed ─────────────────────────────
# Tick 0 is the governed composer. Tick 1 focuses the MESSAGE LIST in the same
# window: _fgIsAi is still true (the 3s sticky window is deliberately generous
# for BLOCK decisions) but the state is second-hand, and a govstate that stayed
# active there would leave Teams' file watchers armed over a conversation nobody
# is typing in. It must go false on that very tick.
LoadPanels $PANELS_TEAMS_ARMED
LoadSurfaces $SURFACES_TEAMS_ARMED
LoadGoverned $GOV_TEAMS_AGENT
LoadRows $ROWS_EMPTY
ResetState
TeamsTick 'govstate_sticky_window' 0 $FOCUS_TEAMS_COMPOSER $TITLE_TEAMS_GOV_AGENT
TeamsTick 'govstate_sticky_window' 1 $FOCUS_TEAMS_MESSAGE_LIST $TITLE_TEAMS_GOV_AGENT
TeamsTick 'govstate_sticky_window' 2 $FOCUS_TEAMS_MESSAGE_LIST $TITLE_TEAMS_GOV_AGENT

# ── GS5: the COPILOT TAB arms on PANEL MATCH ALONE ─────────────────────────
# dlpMatch:'panel', no named row required — decision #1. Tick 0 has no headings
# at all, so there is no agent name anywhere: it must STILL arm (that composer
# has no non-AI use), with an empty agent in the key and the panel id present.
LoadPanels $PANELS_COPILOT_ARMED
LoadSurfaces $SURFACES_COPILOT_ARMED
LoadGoverned $GOV_TEAMS_AGENT
LoadRows $ROWS_EMPTY
ResetState
TeamsCopilotTick 'govstate_copilot_tab_panel_alone' 0 $FOCUS_TEAMS_COPILOT_COMPOSER $TITLE_TEAMS_COPILOT $null
TeamsCopilotTick 'govstate_copilot_tab_panel_alone' 1 $FOCUS_TEAMS_COPILOT_COMPOSER $TITLE_TEAMS_COPILOT $null

# ── GS5b: the CONTROL — the same tab under the strict 'agent' rule ─────────
# Identical everything except the catalog's dlpMatch field. Proves GS5 arms
# because of catalog DATA and not because the Copilot tab is special-cased.
LoadPanels $PANELS_COPILOT_STRICT
LoadSurfaces $SURFACES_COPILOT_ARMED
LoadGoverned $GOV_TEAMS_AGENT
LoadRows $ROWS_EMPTY
ResetState
TeamsCopilotTick 'govstate_copilot_tab_strict_control' 0 $FOCUS_TEAMS_COPILOT_COMPOSER $TITLE_TEAMS_COPILOT $null
TeamsCopilotTick 'govstate_copilot_tab_strict_control' 1 $FOCUS_TEAMS_COPILOT_COMPOSER $TITLE_TEAMS_COPILOT $null

# ── GS6: switching between two governed conversations re-announces ─────────
# The key changes, so the helper must drop the old state (one false line) and
# re-arm on the next tick (one true line) rather than silently keep attributing
# files to the first agent.
LoadPanels $PANELS_TEAMS_ARMED
LoadSurfaces $SURFACES_TEAMS_ARMED
LoadGoverned $GOV_TEAMS_TWO
LoadRows $ROWS_EMPTY
ResetState
TeamsTick 'govstate_switch_agents' 0 $FOCUS_TEAMS_COMPOSER $TITLE_TEAMS_GOV_AGENT
TeamsTick 'govstate_switch_agents' 1 $FOCUS_TEAMS_COMPOSER $TITLE_TEAMS_GOV_AGENT
TeamsTick 'govstate_switch_agents' 2 $FOCUS_TEAMS_COMPOSER $TITLE_TEAMS_GOV_AGENT2
TeamsTick 'govstate_switch_agents' 3 $FOCUS_TEAMS_COMPOSER $TITLE_TEAMS_GOV_AGENT2
TeamsTick 'govstate_switch_agents' 4 $FOCUS_TEAMS_COMPOSER $TITLE_TEAMS_GOV_AGENT2

# ── GS7: the PRIVACY GATE still governs the arm signal ─────────────────────
# Neither policy list names Teams, so nothing is read at all — and nothing arms.
LoadPanels $PANELS_TEAMS_ARMED
LoadSurfaces $SURFACES_TEAMS_ARMED
LoadGoverned $GOV_CHATGPT
LoadRows $ROWS_EMPTY
ResetState
for ($i = 0; $i -lt 3; $i++) {
  TeamsTick 'govstate_privacy_gate' $i $FOCUS_TEAMS_COMPOSER $TITLE_TEAMS_GOV_AGENT
}

# ── GS7b: an UNVERIFIED host-app surface arms nothing ──────────────────────
# The two-flag gate. A surface that has not passed its own live pass must do
# NOTHING WHATSOEVER, which includes never arming a file watcher.
LoadPanels $PANELS_TEAMS_ARMED
LoadSurfaces $SURFACES_SHIPPED
LoadGoverned $GOV_TEAMS_AGENT
LoadRows $ROWS_TEAMS_AGENT
ResetState
for ($i = 0; $i -lt 3; $i++) {
  TeamsTick 'govstate_unverified_surface' $i $FOCUS_TEAMS_COMPOSER $TITLE_TEAMS_GOV_AGENT
}

# ── GS8: the PANIC HOTKEY takes the arm signal down ────────────────────────
# Ctrl+Alt+Shift+F12 means "stop". An armed file watcher whose hold can no longer
# swallow anything would be capture with no enforcement to justify it.
LoadPanels $PANELS_TEAMS_ARMED
LoadSurfaces $SURFACES_TEAMS_ARMED
LoadGoverned $GOV_TEAMS_AGENT
LoadRows $ROWS_EMPTY
ResetState
TeamsTick 'govstate_panic_hotkey' 0 $FOCUS_TEAMS_COMPOSER $TITLE_TEAMS_GOV_AGENT
SetF '_disarmedUntilTicks' ([long]([DateTime]::UtcNow.Ticks + [TimeSpan]::FromMinutes(10).Ticks))
TeamsTick 'govstate_panic_hotkey' 1 $FOCUS_TEAMS_COMPOSER $TITLE_TEAMS_GOV_AGENT
SetF '_disarmedUntilTicks' ([long]0)
TeamsTick 'govstate_panic_hotkey' 2 $FOCUS_TEAMS_COMPOSER $TITLE_TEAMS_GOV_AGENT

# ── GS9: a NON-host-app AI app never arms this at all ──────────────────────
# govstate exists to cover a general-purpose chat client narrowly. Copilot and
# M365Copilot already have ordinary, unconditional file coverage through their
# catalog entries, so arming must stay false for them — otherwise the same file
# would be seen twice, by two mechanisms with different scoping rules.
LoadPanels $PANELS_JSON
LoadSurfaces $SURFACES_SHIPPED
LoadGoverned $GOV_M365_AGENT
LoadRows $ROWS_AGENT
ResetState
AgentTick 'govstate_chat_app_never_arms' 0 $FOCUS_M365_ADVISOR
AgentTick 'govstate_chat_app_never_arms' 1 $FOCUS_M365_HR
AgentTick 'govstate_chat_app_never_arms' 2 $FOCUS_M365_GENERIC
# …and an IDE panel, the other element-scoped kind.
LoadRows $ROWS_CLAUDE
ResetState
Tick 'govstate_ide_panel_never_arms' 0 $FOCUS_CLAUDE_COMPOSER
Tick 'govstate_ide_panel_never_arms' 1 $FOCUS_CODE_EDITOR

LoadGoverned $GOV_EMPTY

# Leave the catalog exactly as it SHIPS, so nothing after this point could
# accidentally observe a fixture-only payload.
LoadPanels $PANELS_JSON
LoadSurfaces $SURFACES_SHIPPED

if ($script:tmpFile) { Remove-Item -LiteralPath $script:tmpFile -Force -ErrorAction SilentlyContinue }
if ($script:tmpGovFile) { Remove-Item -LiteralPath $script:tmpGovFile -Force -ErrorAction SilentlyContinue }

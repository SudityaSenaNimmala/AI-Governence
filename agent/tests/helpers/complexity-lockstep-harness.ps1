# Harness for the desktop enforcer's C# PORT of the prompt-complexity
# classifier (browser-extension/content/complexity.js), held in LOCKSTEP by
# agent/tests/complexity-lockstep.test.mjs.
#
# NOTHING HERE INSTALLS A KEYBOARD HOOK. [CfaiEnforcer]::Start() is never
# called. The C# source is lifted out of enforcer-win.ps1 and compiled on its
# own, the REAL CFAI_MODEL_ROUTER_CONFIG lexicon payload is loaded through the
# production LoadModelRouterConfig, and the production ClassifyComplexityDetailed
# is driven by reflection -- the same shape and rules as
# tests/helpers/routing-decide-harness.ps1.
#
# Input:
#   -Configs  NDJSON, one line per config to test: {"name":"...","path":"<json file>"}
#   -Cases    NDJSON, one line per prompt: {"id":"...","b64":"<UTF-8 text, base64>"}
#             (base64 so the text reaches C# byte-for-byte -- no PowerShell JSON
#             round-trip of nbsp / U+2028 / U+FEFF / astral characters.)
# Output: one NDJSON line per (config, prompt): {"t":"classify","config","id","json"}
#   plus {"t":"loaded","config","lexiconLoaded"} once per config.
param(
  [Parameter(Mandatory=$true)][string]$Ps1,
  [Parameter(Mandatory=$true)][string]$Configs,
  [Parameter(Mandatory=$true)][string]$Cases
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

Add-Type -TypeDefinition $source -ReferencedAssemblies @(
    'System.Windows.Forms','UIAutomationClient','UIAutomationTypes','WindowsBase','System.Web.Extensions'
) -ErrorAction Stop

$T = [CfaiEnforcer]
$FLAGS = [System.Reflection.BindingFlags]'NonPublic,Public,Static'
function GetF([string]$n) { $f = $T.GetField($n, $FLAGS); if (-not $f) { throw "no field $n" }; $f.GetValue($null) }
function Call([string]$n, [object[]]$a = @()) {
  $m = $T.GetMethod($n, $FLAGS)
  if (-not $m) { throw "no method $n" }
  try { return $m.Invoke($null, $a) } catch { throw $_.Exception.InnerException }
}
function Emit($obj) { [Console]::Out.WriteLine(($obj | ConvertTo-Json -Compress -Depth 6)); [Console]::Out.Flush() }

$utf8 = [System.Text.UTF8Encoding]::new($false)
$prompts = @()
foreach ($line in [System.IO.File]::ReadAllLines($Cases, $utf8)) {
  if (-not $line.Trim()) { continue }
  $c = $line | ConvertFrom-Json
  $prompts += ,@($c.id, $utf8.GetString([Convert]::FromBase64String($c.b64)))
}

$lastLoaded = $null
foreach ($line in [System.IO.File]::ReadAllLines($Configs, $utf8)) {
  if (-not $line.Trim()) { continue }
  $cfg = $line | ConvertFrom-Json
  [void](Call 'LoadModelRouterConfig' @([System.IO.File]::ReadAllText($cfg.path, $utf8)))
  Emit @{ t = 'loaded'; config = $cfg.name; lexiconLoaded = [bool](GetF '_mrLexiconLoaded') }
  foreach ($p in $prompts) {
    $json = [string](Call 'ClassifyComplexityDetailedJson' @(,[string]$p[1]))
    Emit @{ t = 'classify'; config = $cfg.name; id = $p[0]; json = $json }
  }
  if ([bool](GetF '_mrLexiconLoaded')) { $lastLoaded = $cfg }
}

# TIMEOUT PROBE. With the per-classify budget forced to zero, every prompt
# that gets past the greeting step must come back 'unknown' / 'timeout' --
# never a routable guess and never 'moderate'/'error'. Emitted as config
# 'budget0' so the lockstep assertions above never see it.
if ($lastLoaded) {
  [void](Call 'LoadModelRouterConfig' @([System.IO.File]::ReadAllText($lastLoaded.path, $utf8)))
  $budget = $T.GetField('_mrClassifyBudgetTicks', $FLAGS)
  $saved = $budget.GetValue($null)
  $budget.SetValue($null, [long]0)
  try {
    foreach ($p in $prompts) {
      $json = [string](Call 'ClassifyComplexityDetailedJson' @(,[string]$p[1]))
      Emit @{ t = 'classify'; config = 'budget0'; id = $p[0]; json = $json }
    }
  } finally { $budget.SetValue($null, $saved) }
}

Emit @{ t = 'done' }

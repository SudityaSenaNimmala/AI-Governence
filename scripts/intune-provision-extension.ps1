<#
  CloudFuze AI-Governance — silent browser-extension provisioning for Intune / GPO.

  Deploy this as an Intune Win32 app or a Platform (device) PowerShell script in
  SYSTEM context. It does two things, for BOTH Microsoft Edge and Google Chrome:

    1. Force-installs the extension by its stable ID (user cannot remove it).
    2. Pushes the managed config (serverUrl + enrollSecret) into the browser's
       3rdparty extension policy, which the extension reads via chrome.storage.managed
       and auto-enrolls from — no options page, no user click.

  Identity comes from the DEVICE, not the browser: the script reads the Intune
  enrollment UPN and the machine name and pushes them as managed policy, which the
  extension trusts ahead of any signed-in browser profile. That matters because a
  tester or developer signed into a throwaway Google profile would otherwise be
  reported as the user. Where the desktop agent IS deployed, its identity beacon
  (127.0.0.1:19532) supersedes both.

  Edit the CONFIG block, then let Intune run it. Idempotent — safe to re-run.
#>

# ---- CONFIG (edit these) -----------------------------------------------------
# The extension ID is ASSIGNED BY THE STORE when you first publish. Chrome and Edge
# assign DIFFERENT IDs to the same extension, so set both after publishing.
#   Chrome: chrome://extensions (Developer mode) or the Web Store item URL.
#   Edge:   edge://extensions or the Edge Add-ons item URL.
$ChromeExtensionId = 'REPLACE_WITH_CHROME_STORE_ID'         # 32 chars a-p
$EdgeExtensionId   = 'REPLACE_WITH_EDGE_STORE_ID'           # 32 chars a-p
$ServerUrl    = 'https://agentgovernence.cftools.live'      # governance server
$EnrollSecret = 'REPLACE_WITH_ENROLL_SECRET'               # shared secret from IT
# Store update URLs (force-install fetches the package from here):
$EdgeUpdateUrl   = 'https://edge.microsoft.com/extensionwebstorebase/v1/crx'
$ChromeUpdateUrl = 'https://clients2.google.com/service/update2/crx'

# Corporate email domain. Any signed-in BROWSER profile outside this domain is
# refused as an identity (recorded as profile_domain_mismatch) instead of being
# attributed. Leave blank only if you accept that a tester signed into a personal
# or QA browser profile will be reported as the user.
$IdentityDomain = 'cloudfuze.com'

# $true when the desktop agent is NOT deployed. Skips the extension's five-minute
# wait for an agent identity beacon that will never arrive.
$BrowserOnly = $true
# -----------------------------------------------------------------------------

# ---- Device-sourced identity -------------------------------------------------
# WHY NOT THE BROWSER PROFILE. chrome.identity reports whichever account the
# browser is signed into, and on a developer's or tester's machine that is
# routinely a throwaway Google account. Attributing enterprise AI usage to a
# fictional persona is worse than attributing it to nobody, because a wrong name
# gets acted on.
#
# Intune already knows the answer. The MDM enrollment records the UPN of the user
# the device is enrolled for, and this script runs on the device, so we can read
# ground truth and push it as managed policy — which the extension trusts ahead of
# any browser profile. A test profile in Chrome then changes nothing.
#
# Both lookups are best-effort: an unenrolled or shared device simply gets no
# userEmail, and the extension falls back (guarded by $IdentityDomain).
function Get-EnrolledUpn {
  # Intune writes one key per enrollment; pick the one that actually carries a UPN.
  $roots = @('HKLM:\SOFTWARE\Microsoft\Enrollments')
  foreach ($root in $roots) {
    if (-not (Test-Path $root)) { continue }
    foreach ($k in Get-ChildItem $root -ErrorAction SilentlyContinue) {
      $upn = (Get-ItemProperty -Path $k.PSPath -Name 'UPN' -ErrorAction SilentlyContinue).UPN
      # EnrollmentType 6 = MDM; but older agents vary, so accept any key with a UPN
      # that looks like an address rather than filtering on the type.
      if ($upn -and $upn -like '*@*') { return $upn }
    }
  }
  return $null
}

$EnrolledUpn  = Get-EnrolledUpn
$ComputerName = $env:COMPUTERNAME
if ($EnrolledUpn) {
  Write-Output ("Device identity: {0} on {1}" -f $EnrolledUpn, $ComputerName)
} else {
  Write-Output ("No Intune enrollment UPN found on {0} - extension will fall back to the browser profile (domain-guarded)." -f $ComputerName)
}
# -----------------------------------------------------------------------------

function Set-RegValue([string]$Path, [string]$Name, [string]$Value) {
  if (-not (Test-Path $Path)) { New-Item -Path $Path -Force | Out-Null }
  New-ItemProperty -Path $Path -Name $Name -Value $Value -PropertyType String -Force | Out-Null
}

# Per-browser policy roots under HKLM (each browser has its own store-assigned ID).
$browsers = @(
  @{ Name = 'Edge';   Root = 'HKLM:\SOFTWARE\Policies\Microsoft\Edge'; Update = $EdgeUpdateUrl;   Id = $EdgeExtensionId },
  @{ Name = 'Chrome'; Root = 'HKLM:\SOFTWARE\Policies\Google\Chrome';  Update = $ChromeUpdateUrl; Id = $ChromeExtensionId }
)

foreach ($b in $browsers) {
  if ([string]::IsNullOrWhiteSpace($b.Id) -or $b.Id -like 'REPLACE_*') {
    Write-Output ("Skipping {0}: extension ID not set yet." -f $b.Name); continue
  }

  # 1) Force-install: <root>\ExtensionInstallForcelist\1 = "<id>;<update_url>"
  $forceKey = Join-Path $b.Root 'ExtensionInstallForcelist'
  Set-RegValue -Path $forceKey -Name '1' -Value ("{0};{1}" -f $b.Id, $b.Update)

  # 2) Managed config: <root>\3rdparty\extensions\<id>\policy\{serverUrl,enrollSecret}
  $policyKey = Join-Path $b.Root ("3rdparty\extensions\{0}\policy" -f $b.Id)
  Set-RegValue -Path $policyKey -Name 'serverUrl'    -Value $ServerUrl
  Set-RegValue -Path $policyKey -Name 'enrollSecret' -Value $EnrollSecret

  # Identity, in order of trust. userEmail is what makes attribution independent
  # of which profile the browser happens to be signed into.
  if ($EnrolledUpn)   { Set-RegValue -Path $policyKey -Name 'userEmail'      -Value $EnrolledUpn }
  if ($ComputerName)  { Set-RegValue -Path $policyKey -Name 'computerName'   -Value $ComputerName }
  if ($IdentityDomain){ Set-RegValue -Path $policyKey -Name 'identityDomain' -Value $IdentityDomain }
  if ($BrowserOnly)   { Set-RegValue -Path $policyKey -Name 'browserOnly'    -Value '1' }

  Write-Output ("Provisioned {0}: force-install + managed config for {1}" -f $b.Name, $b.Id)
}

Write-Output 'Done. Users must restart the browser to pick up the policy.'

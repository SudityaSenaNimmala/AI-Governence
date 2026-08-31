<#
  CloudFuze AI-Governance — silent browser-extension provisioning for Intune / GPO.

  Deploy this as an Intune Win32 app or a Platform (device) PowerShell script in
  SYSTEM context. It does two things, for EVERY Chromium-family browser:

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
# SELF-HOSTED, NOT STORE-PUBLISHED. We sign the package ourselves, so the ID is
# derived from our signing key and is the SAME in both browsers — a store would
# have assigned two different ones. Produce the package and this ID with:
#   node scripts/pack-crx.mjs --url https://agentgovernence.cftools.live
$ExtensionId       = 'REPLACE_WITH_ID_FROM_pack-crx'        # 32 chars a-p
$ChromeExtensionId = $ExtensionId
$EdgeExtensionId   = $ExtensionId
$ServerUrl    = 'https://agentgovernence.cftools.live'      # governance server
$EnrollSecret = 'REPLACE_WITH_ENROLL_SECRET'               # shared secret from IT
# Where the browsers fetch the package and poll for updates. This is OUR server,
# not a store. Must be HTTPS and reachable from every managed machine.
$UpdateUrl       = "$ServerUrl/api/v1/extension/update.xml"
$EdgeUpdateUrl   = $UpdateUrl
$ChromeUpdateUrl = $UpdateUrl

# Corporate email domain. Any signed-in BROWSER profile outside this domain is
# refused as an identity (recorded as profile_domain_mismatch) instead of being
# attributed. Leave blank only if you accept that a tester signed into a personal
# or QA browser profile will be reported as the user.
$IdentityDomain = 'cloudfuze.com'

# $true when the desktop agent is NOT deployed. Skips the extension's five-minute
# wait for an agent identity beacon that will never arrive.
#
# $false FOR THIS ROLLOUT (changed 2026-08-31): the desktop agent IS deployed on
# Windows, as an Intune Win32 app that this script is ordered behind. The beacon
# therefore does arrive and the wait is legitimate.
#
# Note the wait is now a safety net rather than the mechanism. Identity comes from
# the UPN pushed below as `userEmail`, which the extension trusts ABOVE the beacon,
# so a machine enrols with the right person's name on its first attempt whether or
# not the agent has started yet. What the beacon still supplies is the real
# hostname, which is what links this browser's enrolment to the agent's machine
# record on the server.
#
# macOS stays browser-only (BROWSER_ONLY=1 in macos-provision-extension.sh) and
# that is not an oversight: the tracker needs Windows UI Automation and refuses to
# run on darwin, so a Mac has no beacon to wait for.
$BrowserOnly = $false

# Private browsing bypasses governance entirely: a force-installed extension is
# disabled in Incognito / InPrivate and NO policy can force it on. Set this to
# $true to remove private windows instead, in every Chromium browser below.
# Off by default because it changes how everyone browses — decide deliberately.
$DisablePrivateBrowsing = $false

# TWO DIFFERENT THINGS ARE CALLED "PROFILES", and they need opposite handling.
#
#   Browser profiles inside one Windows account (Chrome "Profile 1", a test
#   profile, a second work profile) are the SAME HUMAN. They must all report that
#   person, which is exactly what a machine- or user-level policy already does —
#   and it is why a developer's throwaway Chrome profile stops mattering.
#
#   Windows user accounts on one PC are DIFFERENT HUMANS. The Intune enrollment
#   UPN names only the person the DEVICE was enrolled for, so on a shared machine
#   every account would report that one name. That is a wrong name, not a missing
#   one.
#
# $PerUserIdentity = $true fixes the second case: the device-context run stops
# writing userEmail machine-wide, and a second, USER-context run writes each
# logged-on user's own UPN under HKCU.
#
# THE ORDER MATTERS AND IS NOT NEGOTIABLE. Chromium gives HKLM precedence over
# HKCU, so a userEmail left in HKLM would win and the per-user value would be
# silently ignored. Hence "stops writing" above rather than "also writes".
#
# Leave $false for 1:1 assigned laptops — simpler, one Intune assignment.
# Set $true if ANY machine is shared, and assign this script twice in Intune:
# once in device/SYSTEM context, once in user context.
$PerUserIdentity = $false

# CHROME REFUSES AN OFF-STORE FORCE-INSTALL UNLESS THE MACHINE IS "MANAGED", and
# its definition of managed is narrow: joined to an Active Directory domain, or
# enrolled in Chrome Browser Cloud Management. Entra/Azure-AD join and Intune MDM
# are NOT on that list. This estate is Entra-joined with no on-prem AD, so without
# a CBCM token Chrome silently ignores the policy: no extension, no error, nothing
# in the Intune console. Edge is unaffected — it has no such requirement.
#
# The token makes every Chrome on the machine cloud-managed and unblocks the
# install. Get it free from admin.google.com -> Devices -> Chrome -> Managed
# browsers -> Enrollment token. Chrome Browser Cloud Management costs nothing and
# does not require Workspace.
#
# Left empty, this script still provisions everything and REPORTS Chrome as an
# ungoverned gap rather than pretending it worked.
$ChromeCbcmToken = ''

# Report which browsers exist on this machine and whether Chrome can actually be
# governed, so coverage is a fact on the server rather than an assumption. Costs
# one HTTPS POST per run.
$ReportCoverage = $true
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

# The UPN of the person actually signed in — used only by the user-context run.
# whoami /upn is the reliable source on an Entra-joined machine; it fails on a
# local account, in which case there is no work identity to report and we say so
# rather than substituting the machine's enrollment UPN (which would be a
# different person).
function Get-CurrentUserUpn {
  try {
    $upn = (& whoami /upn) 2>$null
    if ($LASTEXITCODE -eq 0 -and $upn -and $upn -like '*@*') { return $upn.Trim() }
  } catch { }
  return $null
}

# SYSTEM does the machine-wide work; a user context does only its own identity.
$RunningAsSystem = ([Security.Principal.WindowsIdentity]::GetCurrent()).IsSystem

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

# EVERY CHROMIUM-FAMILY BROWSER, ONE PACKAGE.
#
# All of these read the same Chromium policy names and accept the same signed CRX,
# so a single extension ID covers the lot — which is only true BECAUSE we sign it
# ourselves. Two stores would have assigned two different IDs and the others would
# have had no route at all.
#
# WRITTEN UNCONDITIONALLY, whether the browser is installed or not. Policy for an
# absent browser is inert, and the alternative — detect, then write — means a
# browser someone installs next week is silently ungoverned until the script next
# runs. Writing all of them makes the machine ready in advance.
#
# HKLM, NOT HKCU: a machine-level policy applies to EVERY user and EVERY profile on
# the device, including profiles created after the policy landed. That is what
# covers "all profiles" — there is nothing per-profile to enumerate.
#
# Opera is included but is the least reliable of these: its Chromium policy support
# has historically lagged, so treat Opera coverage as best-effort and verify it on a
# real machine rather than assuming.
$browsers = @(
  @{ Name = 'Edge';     Root = 'HKLM:\SOFTWARE\Policies\Microsoft\Edge' },
  @{ Name = 'Chrome';   Root = 'HKLM:\SOFTWARE\Policies\Google\Chrome' },
  @{ Name = 'Brave';    Root = 'HKLM:\SOFTWARE\Policies\BraveSoftware\Brave' },
  @{ Name = 'Vivaldi';  Root = 'HKLM:\SOFTWARE\Policies\Vivaldi' },
  @{ Name = 'Opera';    Root = 'HKLM:\SOFTWARE\Policies\Opera Software\Opera' },
  @{ Name = 'Chromium'; Root = 'HKLM:\SOFTWARE\Policies\Chromium' }
) | ForEach-Object {
  $_.Update = $UpdateUrl
  $_.Id     = $ExtensionId
  [pscustomobject]$_
}

# ---- User-context run: this account's identity, and nothing else -------------
# Assigned in Intune as a USER-context script when $PerUserIdentity is set. It
# deliberately does NOT force-install or write serverUrl/enrollSecret — those are
# machine-wide and already done by the SYSTEM run. Writing them again per user
# would put the enroll secret in every user's own hive for no benefit.
if (-not $RunningAsSystem) {
  if (-not $PerUserIdentity) {
    # EXIT NON-ZERO, because doing nothing quietly is the dangerous outcome here.
    # Intune reports a zero exit as success, so an assignment created in the wrong
    # context would show a green tick on every machine while provisioning nothing
    # and installing no extension. Failing loudly makes the misconfiguration
    # visible in the Intune console, which is the only place anyone would look.
    Write-Error ('This script must run in DEVICE (SYSTEM) context, but it is running as ' +
      $env:USERNAME + '. $PerUserIdentity is $false, so there is nothing for a user-context ' +
      'run to do. Re-create the Intune assignment with "Run this script using the logged on ' +
      'credentials" = No.')
    exit 1
  }
  $upn = Get-CurrentUserUpn
  if (-not $upn) {
    Write-Output "No work UPN for $env:USERNAME (local account?) - leaving identity unset so the extension falls back rather than borrowing another user's name."
    return
  }
  foreach ($b in $browsers) {
    if ([string]::IsNullOrWhiteSpace($b.Id) -or $b.Id -like 'REPLACE_*') { continue }
    $userPolicyKey = ('HKCU:\SOFTWARE\Policies\{0}\3rdparty\extensions\{1}\policy' -f
      ($b.Root -replace '^HKLM:\\SOFTWARE\\Policies\\', ''), $b.Id)
    Set-RegValue -Path $userPolicyKey -Name 'userEmail' -Value $upn
  }
  Write-Output ("Per-user identity set for {0}: {1}" -f $env:USERNAME, $upn)
  return
}

foreach ($b in $browsers) {
  if ([string]::IsNullOrWhiteSpace($b.Id) -or $b.Id -like 'REPLACE_*') {
    Write-Output ("Skipping {0}: extension ID not set yet." -f $b.Name); continue
  }

  # 1) Force-install: <root>\ExtensionInstallForcelist\1 = "<id>;<update_url>"
  $forceKey = Join-Path $b.Root 'ExtensionInstallForcelist'
  Set-RegValue -Path $forceKey -Name '1' -Value ("{0};{1}" -f $b.Id, $b.Update)

  # 1b) A self-hosted package is an "external" install, and both browsers refuse
  #     those by default. Without these two the force-install entry above is
  #     accepted and then silently ignored: nothing installs, nothing is logged,
  #     and the admin console shows no error. It is the most common way this
  #     rollout appears to have "not applied".
  Set-RegValue -Path (Join-Path $b.Root 'ExtensionInstallAllowlist') -Name '1' -Value $b.Id
  Set-RegValue -Path (Join-Path $b.Root 'ExtensionInstallSources')   -Name '1' -Value ("{0}/*" -f $ServerUrl)

  # 2) Managed config: <root>\3rdparty\extensions\<id>\policy\{serverUrl,enrollSecret}
  $policyKey = Join-Path $b.Root ("3rdparty\extensions\{0}\policy" -f $b.Id)
  Set-RegValue -Path $policyKey -Name 'serverUrl'    -Value $ServerUrl
  Set-RegValue -Path $policyKey -Name 'enrollSecret' -Value $EnrollSecret

  # Identity, in order of trust. userEmail is what makes attribution independent
  # of which browser profile happens to be signed in.
  #
  # Skipped when $PerUserIdentity: HKLM beats HKCU in Chromium, so leaving a
  # machine-wide value here would override every per-user one and put the
  # enrollment user's name on everybody's activity.
  if ($EnrolledUpn -and -not $PerUserIdentity) {
    Set-RegValue -Path $policyKey -Name 'userEmail' -Value $EnrolledUpn
  }
  if ($ComputerName)  { Set-RegValue -Path $policyKey -Name 'computerName'   -Value $ComputerName }
  if ($IdentityDomain){ Set-RegValue -Path $policyKey -Name 'identityDomain' -Value $IdentityDomain }
  # Written as '1' only when set. When the agent IS deployed we must not write '0'
  # either — the extension reads browserOnly as a boolean and treats the string
  # '0' as absent anyway, but leaving a stale '1' behind from an earlier
  # browser-only push would keep the beacon wait disabled forever. So remove it.
  if ($BrowserOnly) {
    Set-RegValue -Path $policyKey -Name 'browserOnly' -Value '1'
  } else {
    Remove-ItemProperty -Path $policyKey -Name 'browserOnly' -ErrorAction SilentlyContinue
  }

  # PRIVATE BROWSING IS A HOLE, AND THERE IS NO POLICY THAT CLOSES IT DIRECTLY.
  # A force-installed extension is DISABLED in Incognito / InPrivate unless the
  # user opts it in per-extension, and no admin policy can force that opt-in. So
  # AI used in a private window is completely ungoverned: no capture, no blocking,
  # no notice. The only enterprise answer is to remove the window.
  #
  # $DisablePrivateBrowsing is therefore a governance decision, not a technical
  # one, and it is left OFF by default because it changes how everyone browses.
  # Leaving it off means accepting that private browsing bypasses governance.
  if ($DisablePrivateBrowsing) {
    # 1 = disabled. (0 = available, 2 = forced private — never set 2 here.)
    if (-not (Test-Path $b.Root)) { New-Item -Path $b.Root -Force | Out-Null }
    New-ItemProperty -Path $b.Root -Name 'IncognitoModeAvailability' `
      -Value 1 -PropertyType DWord -Force | Out-Null
  }

  # Chrome only: the token that makes this machine cloud-managed, without which
  # Chrome ignores the force-install above. Harmless on the other browsers, so it
  # is written only where it means something.
  if ($b.Name -eq 'Chrome' -and $ChromeCbcmToken) {
    Set-RegValue -Path $b.Root -Name 'CloudManagementEnrollmentToken' -Value $ChromeCbcmToken
  }

  Write-Output ("Provisioned {0}: force-install + managed config for {1}" -f $b.Name, $b.Id)
}

Write-Output 'Done. Users must restart the browser to pick up the policy.'

# ---- Coverage report ---------------------------------------------------------
# WHY REPORT THIS AT ALL. Chrome's off-store rule means a machine can be fully
# provisioned by this script and still have an ungoverned Chrome, with nothing
# anywhere saying so — the policy is written, Intune reports success, and the
# extension simply never appears. The only way that becomes visible is if the
# machine itself says what it found.
#
# So each run reports which browsers exist and whether Chrome is actually
# governable here. A machine with Chrome installed, no AD domain join and no CBCM
# token is a hole, and the server can then list those rather than an admin
# discovering one at a time.
if ($ReportCoverage) {
  $chromeInstalled = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe"
  ) | Where-Object { Test-Path $_ } | Select-Object -First 1

  $domainJoined = (Get-CimInstance Win32_ComputerSystem -EA SilentlyContinue).PartOfDomain -eq $true
  # Chrome accepts AD domain join OR a CBCM token. Entra join is NOT sufficient,
  # which is exactly why it is recorded separately instead of being counted.
  $entraJoined = ((& dsregcmd /status 2>$null) | Select-String 'AzureAdJoined\s*:\s*YES').Count -gt 0
  $chromeGovernable = $domainJoined -or [bool]$ChromeCbcmToken

  $browsers = @()
  foreach ($probe in @(
    @{ n = 'chrome';   p = "$env:ProgramFiles\Google\Chrome\Application\chrome.exe" },
    @{ n = 'edge';     p = "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe" },
    @{ n = 'brave';    p = "$env:ProgramFiles\BraveSoftware\Brave-Browser\Application\brave.exe" },
    @{ n = 'vivaldi';  p = "$env:LOCALAPPDATA\Vivaldi\Application\vivaldi.exe" },
    @{ n = 'opera';    p = "$env:LOCALAPPDATA\Programs\Opera\opera.exe" },
    @{ n = 'firefox';  p = "$env:ProgramFiles\Mozilla Firefox\firefox.exe" }
  )) { if (Test-Path $probe.p) { $browsers += $probe.n } }

  $body = @{
    hostname          = $env:COMPUTERNAME
    os                = 'windows'
    user              = $EnrolledUpn
    extension_id      = $ExtensionId
    browsers          = $browsers
    chrome_installed  = [bool]$chromeInstalled
    chrome_governable = $chromeGovernable
    domain_joined     = $domainJoined
    entra_joined      = $entraJoined
    cbcm_token        = [bool]$ChromeCbcmToken
    private_browsing_blocked = [bool]$DisablePrivateBrowsing
    enrollSecret      = $EnrollSecret
  } | ConvertTo-Json -Compress

  try {
    Invoke-RestMethod -Method Post -Uri "$ServerUrl/api/v1/browser-coverage" `
      -ContentType 'application/json' -Body $body -TimeoutSec 20 | Out-Null
    if ($chromeInstalled -and -not $chromeGovernable) {
      Write-Output 'WARNING: Chrome is installed but NOT governable on this machine (no AD domain join, no CBCM token). Chrome will ignore the force-install. Reported to the server.'
    } else {
      Write-Output ("Coverage reported: {0}" -f ($browsers -join ', '))
    }
  } catch {
    Write-Output ("Coverage report failed (provisioning still applied): {0}" -f $_.Exception.Message)
  }
}

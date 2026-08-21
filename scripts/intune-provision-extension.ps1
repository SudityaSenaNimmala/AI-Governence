<#
  CloudFuze AI-Governance — silent browser-extension provisioning for Intune / GPO.

  Deploy this as an Intune Win32 app or a Platform (device) PowerShell script in
  SYSTEM context. It does two things, for BOTH Microsoft Edge and Google Chrome:

    1. Force-installs the extension by its stable ID (user cannot remove it).
    2. Pushes the managed config (serverUrl + enrollSecret) into the browser's
       3rdparty extension policy, which the extension reads via chrome.storage.managed
       and auto-enrolls from — no options page, no user click.

  The desktop agent's identity beacon (127.0.0.1:19532) then links the extension to
  the same machine/user automatically, so browser usage attributes to the real person.

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
  # Optional: pin identity explicitly instead of relying on the desktop-agent beacon.
  # Set-RegValue -Path $policyKey -Name 'userEmail'  -Value 'user@cloudfuze.com'

  Write-Output ("Provisioned {0}: force-install + managed config for {1}" -f $b.Name, $b.Id)
}

Write-Output 'Done. Users must restart the browser to pick up the policy.'

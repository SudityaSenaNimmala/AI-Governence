# Remove CloudFuze server-monitor from Windows. Must run as Administrator.
# --Purge also removes the enrollment token + the CA from disk.
[CmdletBinding()]
param([switch] $Purge)

$ErrorActionPreference = 'Continue'

$ServiceName = "CloudFuzeServerMonitor"
$InstallDir  = "$env:ProgramFiles\CloudFuze\server-monitor"
$TokenDir    = "$env:ProgramData\CloudFuze"
$CaDir       = Join-Path $env:USERPROFILE ".cloudfuze-aigov"

Write-Host "Stopping + deleting service..."
Stop-Service $ServiceName -ErrorAction SilentlyContinue
& sc.exe delete $ServiceName | Out-Null

Write-Host "Removing CA from LocalMachine\Root..."
$certs = Get-ChildItem 'Cert:\LocalMachine\Root' | Where-Object { $_.Subject -like '*CloudFuze AI Governance*' }
foreach ($c in $certs) { Remove-Item ("Cert:\LocalMachine\Root\" + $c.Thumbprint) -Force -ErrorAction SilentlyContinue }

Write-Host "Clearing Machine-scope proxy env vars..."
[Environment]::SetEnvironmentVariable("HTTPS_PROXY", $null, "Machine")
[Environment]::SetEnvironmentVariable("HTTP_PROXY",  $null, "Machine")
[Environment]::SetEnvironmentVariable("NO_PROXY",    $null, "Machine")

Write-Host "Removing $InstallDir..."
Remove-Item $InstallDir -Recurse -Force -ErrorAction SilentlyContinue

if ($Purge) {
  Remove-Item $TokenDir -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item $CaDir    -Recurse -Force -ErrorAction SilentlyContinue
  Write-Host "Purged enrollment + CA."
}

Write-Host "OK Uninstall complete."
Write-Host "    Existing processes may still be using the proxy until they restart."

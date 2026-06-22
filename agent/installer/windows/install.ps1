<#
.SYNOPSIS
  Install the CloudFuze AI Governance Agent on Windows.

.DESCRIPTION
  Copies the agent binary to %ProgramFiles%\CloudFuze\AIGovAgent, writes the
  config, performs first-time enrollment with the governance server, and
  registers a daily scheduled task that runs the scan.

.PARAMETER ServerUrl
  HTTPS URL of the governance server (e.g. https://aigov.cloudfuze.internal).

.PARAMETER EnrollSecret
  Shared enrollment secret pushed by MDM. Used once to obtain a per-machine
  JWT, then discarded.

.PARAMETER Binary
  Path to the agent executable (.exe) produced by `npm run build:sea`.

.PARAMETER RunDaily
  Time of day to run the scan (HH:mm, 24h). Default: 09:00.

.EXAMPLE
  .\install.ps1 -ServerUrl 'https://aigov.cloudfuze.com' -EnrollSecret 'xyz' -Binary '.\ai-gov-agent.exe'
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)] [string] $ServerUrl,
  [Parameter(Mandatory=$true)] [string] $EnrollSecret,
  [Parameter(Mandatory=$true)] [string] $Binary,
  [string] $RunDaily = '09:00'
)

$ErrorActionPreference = 'Stop'

$installDir = Join-Path $env:ProgramFiles 'CloudFuze\AIGovAgent'
$exePath    = Join-Path $installDir 'ai-gov-agent.exe'
$configDir  = Join-Path $env:ProgramData 'CloudFuze\AIGovAgent'
$configPath = Join-Path $configDir 'config.json'
$logDir     = Join-Path $configDir 'logs'
$taskName   = 'CloudFuze AI Governance — daily scan'

# Require admin
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'install.ps1 must be run from an elevated PowerShell window.'
}

Write-Host "Installing CloudFuze AI Governance Agent..." -ForegroundColor Cyan

# 1. Copy binary
New-Item -ItemType Directory -Force -Path $installDir | Out-Null
Copy-Item -Path $Binary -Destination $exePath -Force
Write-Host "  copied agent to $exePath"

# 2. Write config (with server URL only; enrollment secret used immediately and not stored)
New-Item -ItemType Directory -Force -Path $configDir | Out-Null
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$config = @{
  serverUrl  = $ServerUrl
  installedAt = (Get-Date).ToString('o')
  version    = '0.1.0'
}
$config | ConvertTo-Json | Set-Content -Path $configPath -Encoding utf8
Write-Host "  wrote config to $configPath"

# 3. First-time enrollment (one-shot scan + token persistence)
Write-Host "Performing first-time enrollment..." -ForegroundColor Cyan
& $exePath --server $ServerUrl --enroll-secret $EnrollSecret --dry-run
if ($LASTEXITCODE -ne 0) {
  throw "Enrollment failed (exit $LASTEXITCODE)."
}
Write-Host "  enrolled"

# 4. Register scheduled task — runs as the SYSTEM-installed-per-user shape:
#    we register a task that runs as the interactive user the first time they log in,
#    daily thereafter at the configured time.
$action  = New-ScheduledTaskAction -Execute $exePath -Argument "--server `"$ServerUrl`""
$trigger = New-ScheduledTaskTrigger -Daily -At $RunDaily
$principal = New-ScheduledTaskPrincipal -UserId (whoami) -LogonType Interactive
$settings  = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 10)

if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
}
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings | Out-Null
Write-Host "  scheduled daily task '$taskName' at $RunDaily"

Write-Host ""
Write-Host "Installation complete." -ForegroundColor Green
Write-Host "Run a scan now:  & '$exePath' --server $ServerUrl"

<#
.SYNOPSIS
  Uninstall the CloudFuze AI Governance Agent.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$installDir = Join-Path $env:ProgramFiles 'CloudFuze\AIGovAgent'
$configDir  = Join-Path $env:ProgramData 'CloudFuze\AIGovAgent'
$taskName   = 'CloudFuze AI Governance — daily scan'

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'uninstall.ps1 must be run from an elevated PowerShell window.'
}

Write-Host "Uninstalling CloudFuze AI Governance Agent..." -ForegroundColor Cyan

if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
  Write-Host "  removed scheduled task"
}

if (Test-Path $installDir) {
  Remove-Item -Path $installDir -Recurse -Force
  Write-Host "  removed $installDir"
}

if (Test-Path $configDir) {
  Remove-Item -Path $configDir -Recurse -Force
  Write-Host "  removed $configDir"
}

# Credentials live in the user profile; remove for the current user.
$credPath = Join-Path $env:USERPROFILE '.cloudfuze-aigov'
if (Test-Path $credPath) {
  Remove-Item -Path $credPath -Recurse -Force
  Write-Host "  removed $credPath"
}

Write-Host "Uninstalled." -ForegroundColor Green

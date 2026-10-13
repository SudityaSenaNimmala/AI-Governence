# CloudFuze AI Governance - Post-install configuration
# Called by install.bat after files are copied to Program Files.
# Runs as SYSTEM (Intune) or as admin (manual install).

Set-StrictMode -Off
$ErrorActionPreference = 'SilentlyContinue'

$installDir = 'C:\Program Files\CloudFuze\AI Governance'
$exe = Join-Path $installDir 'CloudFuze AI Governance.exe'

# Unblock the exe
Unblock-File $exe -ErrorAction SilentlyContinue

# Read baked config (serverUrl + enrollSecret baked by the server at download time)
$cfgFile = Join-Path $installDir 'resources\cfai-config.json'
$serverUrl = 'http://localhost:8787'
$enrollSecret = ''
if (Test-Path $cfgFile) {
    $j = Get-Content $cfgFile -Raw | ConvertFrom-Json
    if ($j.serverUrl) { $serverUrl = $j.serverUrl }
    if ($j.enrollSecret) { $enrollSecret = $j.enrollSecret }
}

# Write electron-settings.json to ALL non-special user profiles so the
# agent can auto-enroll on first launch regardless of which user logs in.
# The current app.asar reads electron-settings.json, not cfai-config.json.
$settings = @{
    serverUrl=$serverUrl
    enrollSecret=$enrollSecret
    autoStart=$true
    monitorClipboard=$true
    monitorFileDialogs=$true
    monitorTypedPrompts=$true
    monitorAttachments=$true
    monitorEnforcer=$true
    startMonitorOnLaunch=$true
} | ConvertTo-Json -Compress

Get-CimInstance Win32_UserProfile | Where-Object { -not $_.Special } | ForEach-Object {
    $cfgDir = Join-Path $_.LocalPath '.cloudfuze-aigov'
    New-Item -ItemType Directory -Path $cfgDir -Force -ErrorAction SilentlyContinue | Out-Null
    # Clear stale locks
    'monitor.lock','enforcer.pid','enforcer.parent' | ForEach-Object {
        Remove-Item (Join-Path $cfgDir $_) -Force -ErrorAction SilentlyContinue
    }
    Set-Content (Join-Path $cfgDir 'electron-settings.json') $settings -Encoding UTF8
}

# Create scheduled task for ALL users — fires on any user logon,
# runs as that user. Works on Azure AD, domain-joined, and local machines.
# The Electron app's single-instance lock prevents duplicates.
$action = New-ScheduledTaskAction -Execute $exe -Argument '--hidden'
$trigger = New-ScheduledTaskTrigger -AtLogOn
$stg = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
$principal = New-ScheduledTaskPrincipal -GroupId 'S-1-5-32-545' -RunLevel Limited
Register-ScheduledTask -TaskName 'CloudFuzeAIGovernance' -Action $action -Trigger $trigger -Settings $stg -Principal $principal -Force | Out-Null

# Verify task was created
if (-not (Get-ScheduledTask -TaskName 'CloudFuzeAIGovernance' -ErrorAction SilentlyContinue)) { exit 1 }

# Start now
Start-ScheduledTask -TaskName 'CloudFuzeAIGovernance' -ErrorAction SilentlyContinue

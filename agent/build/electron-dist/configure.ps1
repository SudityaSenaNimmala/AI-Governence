# CloudFuze AI Governance - Post-install configuration
# Called by install.bat after files are copied to Program Files.
# Runs as SYSTEM (Intune) or as admin (manual install).

Set-StrictMode -Off
$ErrorActionPreference = 'Stop'

$installDir = 'C:\Program Files\CloudFuze\AI Governance'
$exe = Join-Path $installDir 'CloudFuze AI Governance.exe'

# Unblock the exe
Unblock-File $exe -ErrorAction SilentlyContinue

# Read baked config
$cfgFile = Join-Path $installDir 'resources\cfai-config.json'
$serverUrl = 'http://localhost:8787'
$enrollSecret = ''
if (Test-Path $cfgFile) {
    $j = Get-Content $cfgFile -Raw | ConvertFrom-Json
    if ($j.serverUrl) { $serverUrl = $j.serverUrl }
    if ($j.enrollSecret) { $enrollSecret = $j.enrollSecret }
}

# Find the logged-in user
$domainUser = (Get-CimInstance Win32_ComputerSystem).UserName
$action = New-ScheduledTaskAction -Execute $exe -Argument '--hidden'
$stg = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)

if (-not $domainUser) {
    # No user logged in (Intune ESP / provisioning / login screen).
    # Create task for ALL users so the agent starts on next logon.
    $trigger = New-ScheduledTaskTrigger -AtLogOn
    $principal = New-ScheduledTaskPrincipal -GroupId 'S-1-5-32-545' -RunLevel Limited
    Register-ScheduledTask -TaskName 'CloudFuzeAIGovernance' -Action $action -Trigger $trigger -Settings $stg -Principal $principal -Force | Out-Null
    # Verify
    if (-not (Get-ScheduledTask -TaskName 'CloudFuzeAIGovernance' -ErrorAction SilentlyContinue)) { exit 1 }
    exit 0
}

$short = ($domainUser -split '\\')[-1]

# Find their profile by exact username match
$prof = (Get-CimInstance Win32_UserProfile | Where-Object {
    (-not $_.Special) -and ($_.LocalPath -match ('\\' + [regex]::Escape($short) + '$'))
}).LocalPath
if (-not $prof) { $prof = "C:\Users\$short" }

# Config directory
$cfgDir = Join-Path $prof '.cloudfuze-aigov'
New-Item -ItemType Directory -Path $cfgDir -Force -ErrorAction SilentlyContinue | Out-Null

# Re-enroll if server URL changed
$credsFile = Join-Path $cfgDir 'credentials.json'
if (Test-Path $credsFile) {
    try {
        $oldUrl = (Get-Content $credsFile -Raw | ConvertFrom-Json).serverUrl
        if ($oldUrl -and $oldUrl -ne $serverUrl) {
            'credentials.json','blocked-agents.json','agent-version' | ForEach-Object {
                Remove-Item (Join-Path $cfgDir $_) -Force -ErrorAction SilentlyContinue
            }
        }
    } catch {}
}

# Clear stale locks
'monitor.lock','enforcer.pid','enforcer.parent' | ForEach-Object {
    Remove-Item (Join-Path $cfgDir $_) -Force -ErrorAction SilentlyContinue
}

# Write settings
@{
    serverUrl=$serverUrl
    enrollSecret=$enrollSecret
    autoStart=$true
    monitorClipboard=$true
    monitorFileDialogs=$true
    monitorTypedPrompts=$true
    monitorAttachments=$true
    monitorEnforcer=$true
    startMonitorOnLaunch=$true
} | ConvertTo-Json -Compress | Set-Content (Join-Path $cfgDir 'electron-settings.json') -Encoding UTF8

# Create scheduled task for THIS user
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $short
$principal = New-ScheduledTaskPrincipal -UserId $domainUser -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName 'CloudFuzeAIGovernance' -Action $action -Trigger $trigger -Settings $stg -Principal $principal -Force | Out-Null

# Verify task was created
if (-not (Get-ScheduledTask -TaskName 'CloudFuzeAIGovernance' -ErrorAction SilentlyContinue)) { exit 1 }

# Start now
Start-ScheduledTask -TaskName 'CloudFuzeAIGovernance' -ErrorAction SilentlyContinue

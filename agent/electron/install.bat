@echo off
setlocal enabledelayedexpansion

REM ============================================================
REM  CloudFuze AI Governance — Silent Installer
REM  Intune / SCCM / GPO / manual. Exits with exit /b 0.
REM ============================================================

set "INSTALL_DIR=C:\Program Files\CloudFuze\AI Governance"
set "SOURCE_DIR=%~dp0win-unpacked"

REM -- Verify source --
if not exist "%SOURCE_DIR%\CloudFuze AI Governance.exe" exit /b 1

REM -- Stop running agent and its child processes --
taskkill /IM "CloudFuze AI Governance.exe" /F >nul 2>&1
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -match 'monitor-runner|enforcer-watchdog' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }" >nul 2>&1
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='powershell.exe'\" | Where-Object { $_.CommandLine -match 'enforcer-win' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }" >nul 2>&1
timeout /t 3 /nobreak >nul 2>&1

REM -- Remove old scheduled task --
schtasks /Delete /TN "CloudFuzeAIGovernance" /F >nul 2>&1

REM -- Copy to permanent location --
if exist "%INSTALL_DIR%" rmdir /s /q "%INSTALL_DIR%" >nul 2>&1
timeout /t 1 /nobreak >nul 2>&1
REM -- Retry rmdir if dir survived (AV lock, slow handle release) --
if exist "%INSTALL_DIR%" (
    timeout /t 2 /nobreak >nul 2>&1
    rmdir /s /q "%INSTALL_DIR%" >nul 2>&1
)
if exist "%INSTALL_DIR%" exit /b 1
mkdir "%INSTALL_DIR%" >nul 2>&1
xcopy "%SOURCE_DIR%\*" "%INSTALL_DIR%\" /E /I /H /Y /Q >nul 2>&1
if errorlevel 1 exit /b 1

REM -- Unblock + configure + create task (all in PowerShell for SYSTEM compat) --
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
 "Set-StrictMode -Off;" ^
 "" ^
 "# Unblock the exe (recursive unblock on thousands of files causes Intune timeout)" ^
 "Unblock-File 'C:\\Program Files\\CloudFuze\\AI Governance\\CloudFuze AI Governance.exe' -ErrorAction SilentlyContinue;" ^
 "" ^
 "# Read baked config" ^
 "$cfgFile = 'C:\\Program Files\\CloudFuze\\AI Governance\\resources\\cfai-config.json';" ^
 "$serverUrl = 'http://localhost:8787'; $enrollSecret = '';" ^
 "if (Test-Path $cfgFile) {" ^
 "  $j = Get-Content $cfgFile -Raw | ConvertFrom-Json;" ^
 "  if ($j.serverUrl) { $serverUrl = $j.serverUrl };" ^
 "  if ($j.enrollSecret) { $enrollSecret = $j.enrollSecret };" ^
 "}" ^
 "" ^
 "# Find the logged-in user" ^
 "$cs = Get-CimInstance Win32_ComputerSystem;" ^
 "$domainUser = $cs.UserName;" ^
 "$exe = 'C:\\Program Files\\CloudFuze\\AI Governance\\CloudFuze AI Governance.exe';" ^
 "$action = New-ScheduledTaskAction -Execute $exe -Argument '--hidden';" ^
 "$stg = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1);" ^
 "" ^
 "if (-not $domainUser) {" ^
 "  # No user logged in (Intune ESP / provisioning / login screen)." ^
 "  # Create task for ALL users so the agent starts on next logon." ^
 "  $trigger = New-ScheduledTaskTrigger -AtLogOn;" ^
 "  $principal = New-ScheduledTaskPrincipal -GroupId 'S-1-5-32-545' -RunLevel Limited;" ^
 "  Register-ScheduledTask -TaskName 'CloudFuzeAIGovernance' -Action $action -Trigger $trigger -Settings $stg -Principal $principal -Force | Out-Null;" ^
 "  # Verify task was created" ^
 "  if (-not (Get-ScheduledTask -TaskName 'CloudFuzeAIGovernance' -ErrorAction SilentlyContinue)) { exit 1 };" ^
 "  exit 0;" ^
 "}" ^
 "" ^
 "$short = ($domainUser -split '\\')[-1];" ^
 "" ^
 "# Find their profile by exact username match" ^
 "$prof = (Get-CimInstance Win32_UserProfile | Where-Object {" ^
 "  (-not $_.Special) -and ($_.LocalPath -match ('\\\\' + [regex]::Escape($short) + '$'))" ^
 "}).LocalPath;" ^
 "if (-not $prof) { $prof = 'C:\\Users\\' + $short };" ^
 "" ^
 "# Config directory" ^
 "$cfgDir = Join-Path $prof '.cloudfuze-aigov';" ^
 "New-Item -ItemType Directory -Path $cfgDir -Force -ErrorAction SilentlyContinue | Out-Null;" ^
 "" ^
 "# Re-enroll if server URL changed" ^
 "$credsFile = Join-Path $cfgDir 'credentials.json';" ^
 "if (Test-Path $credsFile) {" ^
 "  try {" ^
 "    $oldUrl = (Get-Content $credsFile -Raw | ConvertFrom-Json).serverUrl;" ^
 "    if ($oldUrl -and $oldUrl -ne $serverUrl) {" ^
 "      'credentials.json','blocked-agents.json','agent-version' | ForEach-Object { Remove-Item (Join-Path $cfgDir $_) -Force -ErrorAction SilentlyContinue };" ^
 "    }" ^
 "  } catch {}" ^
 "}" ^
 "" ^
 "# Clear stale locks" ^
 "'monitor.lock','enforcer.pid','enforcer.parent' | ForEach-Object { Remove-Item (Join-Path $cfgDir $_) -Force -ErrorAction SilentlyContinue };" ^
 "" ^
 "# Write settings" ^
 "@{serverUrl=$serverUrl;enrollSecret=$enrollSecret;autoStart=$true;monitorClipboard=$true;monitorFileDialogs=$true;monitorTypedPrompts=$true;monitorAttachments=$true;monitorEnforcer=$true;startMonitorOnLaunch=$true} | ConvertTo-Json -Compress | Set-Content (Join-Path $cfgDir 'electron-settings.json') -Encoding UTF8;" ^
 "" ^
 "# Create scheduled task for THIS user" ^
 "$trigger = New-ScheduledTaskTrigger -AtLogOn -User $short;" ^
 "$principal = New-ScheduledTaskPrincipal -UserId $domainUser -LogonType Interactive -RunLevel Limited;" ^
 "Register-ScheduledTask -TaskName 'CloudFuzeAIGovernance' -Action $action -Trigger $trigger -Settings $stg -Principal $principal -Force | Out-Null;" ^
 "" ^
 "# Verify task was created" ^
 "if (-not (Get-ScheduledTask -TaskName 'CloudFuzeAIGovernance' -ErrorAction SilentlyContinue)) { exit 1 };" ^
 "" ^
 "# Start now" ^
 "Start-ScheduledTask -TaskName 'CloudFuzeAIGovernance' -ErrorAction SilentlyContinue;"
if errorlevel 1 exit /b 1

exit /b 0

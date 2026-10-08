@echo off
setlocal enabledelayedexpansion

REM ============================================================
REM  CloudFuze AI Governance — Silent Installer
REM  Works with Intune (SYSTEM context), SCCM, GPO, and manual.
REM  Exits immediately with exit /b 0 so Intune doesn't timeout.
REM ============================================================

set "INSTALL_DIR=C:\Program Files\CloudFuze\AI Governance"
set "SOURCE_DIR=%~dp0win-unpacked"
set "EXE=%INSTALL_DIR%\CloudFuze AI Governance.exe"
set "TASK_NAME=CloudFuzeAIGovernance"

REM -- Verify source --
if not exist "%SOURCE_DIR%\CloudFuze AI Governance.exe" (
    exit /b 1
)

REM -- Stop running agent --
taskkill /IM "CloudFuze AI Governance.exe" /F >nul 2>&1
timeout /t 3 /nobreak >nul 2>&1

REM -- Remove old scheduled task --
schtasks /Delete /TN "%TASK_NAME%" /F >nul 2>&1

REM -- Copy to permanent location --
if exist "%INSTALL_DIR%" rmdir /s /q "%INSTALL_DIR%" >nul 2>&1
mkdir "%INSTALL_DIR%" >nul 2>&1
xcopy "%SOURCE_DIR%\*" "%INSTALL_DIR%\" /E /I /H /Y /Q >nul 2>&1
if errorlevel 1 exit /b 1

REM -- Unblock files --
powershell -NoProfile -Command "Get-ChildItem -Path 'C:\Program Files\CloudFuze\AI Governance' -Recurse | Unblock-File -ErrorAction SilentlyContinue" >nul 2>&1

REM -- Detect logged-in user and their profile --
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$u = (Get-CimInstance Win32_ComputerSystem).UserName;" ^
  "if (-not $u) { exit };" ^
  "$short = $u -replace '.*\\','';" ^
  "$prof = (Get-CimInstance Win32_UserProfile | Where-Object { $_.LocalPath -like \"*$short\" -and -not $_.Special }).LocalPath;" ^
  "if (-not $prof) { $prof = \"C:\Users\$short\" };" ^
  "$cfgDir = Join-Path $prof '.cloudfuze-aigov';" ^
  "if (-not (Test-Path $cfgDir)) { New-Item -ItemType Directory -Path $cfgDir -Force | Out-Null };" ^
  "" ^
  "# Read baked config" ^
  "$cfg = 'C:\Program Files\CloudFuze\AI Governance\resources\cfai-config.json';" ^
  "$serverUrl = 'http://localhost:8787';" ^
  "$enrollSecret = '';" ^
  "if (Test-Path $cfg) {" ^
  "  $j = Get-Content $cfg | ConvertFrom-Json;" ^
  "  if ($j.serverUrl) { $serverUrl = $j.serverUrl };" ^
  "  if ($j.enrollSecret) { $enrollSecret = $j.enrollSecret };" ^
  "}" ^
  "" ^
  "# Delete old credentials if server URL changed" ^
  "$credsFile = Join-Path $cfgDir 'credentials.json';" ^
  "if (Test-Path $credsFile) {" ^
  "  try {" ^
  "    $old = (Get-Content $credsFile | ConvertFrom-Json).serverUrl;" ^
  "    if ($old -and $old -ne $serverUrl) {" ^
  "      Remove-Item (Join-Path $cfgDir 'credentials.json') -Force -ErrorAction SilentlyContinue;" ^
  "      Remove-Item (Join-Path $cfgDir 'blocked-agents.json') -Force -ErrorAction SilentlyContinue;" ^
  "      Remove-Item (Join-Path $cfgDir 'agent-version') -Force -ErrorAction SilentlyContinue;" ^
  "    }" ^
  "  } catch {}" ^
  "}" ^
  "" ^
  "# Clear stale locks" ^
  "Remove-Item (Join-Path $cfgDir 'monitor.lock') -Force -ErrorAction SilentlyContinue;" ^
  "Remove-Item (Join-Path $cfgDir 'enforcer.pid') -Force -ErrorAction SilentlyContinue;" ^
  "" ^
  "# Write settings" ^
  "$settings = @{serverUrl=$serverUrl;enrollSecret=$enrollSecret;autoStart=$true;monitorClipboard=$true;monitorFileDialogs=$true;monitorTypedPrompts=$true;monitorAttachments=$true;monitorEnforcer=$true;startMonitorOnLaunch=$true};" ^
  "$settings | ConvertTo-Json -Compress | Set-Content (Join-Path $cfgDir 'electron-settings.json') -Encoding UTF8;" ^
  "" ^
  "# Create scheduled task as the logged-in user" ^
  "$exe = 'C:\Program Files\CloudFuze\AI Governance\CloudFuze AI Governance.exe';" ^
  "$action = New-ScheduledTaskAction -Execute $exe -Argument '--hidden';" ^
  "$trigger = New-ScheduledTaskTrigger -AtLogOn -User $short;" ^
  "$settings2 = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable;" ^
  "$principal = New-ScheduledTaskPrincipal -UserId $u -LogonType Interactive -RunLevel Limited;" ^
  "Register-ScheduledTask -TaskName 'CloudFuzeAIGovernance' -Action $action -Trigger $trigger -Settings $settings2 -Principal $principal -Force | Out-Null;" ^
  "" ^
  "# Start it now" ^
  "Start-ScheduledTask -TaskName 'CloudFuzeAIGovernance' -ErrorAction SilentlyContinue;"

exit /b 0

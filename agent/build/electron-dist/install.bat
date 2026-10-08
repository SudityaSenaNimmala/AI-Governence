@echo off
setlocal enabledelayedexpansion

REM ============================================================
REM  CloudFuze AI Governance — Silent Installer
REM  Works with Intune, SCCM, GPO, and manual double-click.
REM  Exits immediately with exit /b 0 so Intune doesn't timeout.
REM ============================================================

REM -- Permanent install location --
set "INSTALL_DIR=C:\Program Files\CloudFuze\AI Governance"
set "SOURCE_DIR=%~dp0win-unpacked"
set "EXE=%INSTALL_DIR%\CloudFuze AI Governance.exe"
set "TASK_NAME=CloudFuzeAIGovernance"

REM -- Verify source exists --
if not exist "%SOURCE_DIR%\CloudFuze AI Governance.exe" (
    echo [ERROR] Source not found: %SOURCE_DIR%
    exit /b 1
)

REM -- Stop any running agent --
taskkill /IM "CloudFuze AI Governance.exe" /F >nul 2>&1
timeout /t 3 /nobreak >nul 2>&1

REM -- Clear stale locks --
if exist "%USERPROFILE%\.cloudfuze-aigov\monitor.lock" del "%USERPROFILE%\.cloudfuze-aigov\monitor.lock" >nul 2>&1
if exist "%USERPROFILE%\.cloudfuze-aigov\enforcer.pid" del "%USERPROFILE%\.cloudfuze-aigov\enforcer.pid" >nul 2>&1
if exist "%USERPROFILE%\.cloudfuze-aigov\enforcer.parent" del "%USERPROFILE%\.cloudfuze-aigov\enforcer.parent" >nul 2>&1

REM -- Remove old auto-start entries --
schtasks /Delete /TN "%TASK_NAME%" /F >nul 2>&1
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v CloudFuzeAIGovernance /f >nul 2>&1
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v CloudFuzeAgent /f >nul 2>&1

REM -- Copy to permanent location --
if exist "%INSTALL_DIR%" rmdir /s /q "%INSTALL_DIR%" >nul 2>&1
mkdir "%INSTALL_DIR%" >nul 2>&1
xcopy "%SOURCE_DIR%\*" "%INSTALL_DIR%\" /E /I /H /Y /Q >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Failed to copy files to %INSTALL_DIR%
    exit /b 1
)

REM -- Remove Mark of the Web (no security warnings on boot) --
powershell -NoProfile -Command "Get-ChildItem -Path '%INSTALL_DIR%' -Recurse | Unblock-File -ErrorAction SilentlyContinue" >nul 2>&1

REM -- Create config directory --
if not exist "%USERPROFILE%\.cloudfuze-aigov" mkdir "%USERPROFILE%\.cloudfuze-aigov" >nul 2>&1

REM -- Read baked config (server URL + enroll secret) --
set "BAKED_CONFIG=%INSTALL_DIR%\resources\cfai-config.json"
set "SERVER_URL="
set "ENROLL_SECRET="
if exist "%BAKED_CONFIG%" (
    for /f "tokens=*" %%i in ('powershell -NoProfile -Command "(Get-Content '%BAKED_CONFIG%' | ConvertFrom-Json).serverUrl"') do set "SERVER_URL=%%i"
    for /f "tokens=*" %%i in ('powershell -NoProfile -Command "(Get-Content '%BAKED_CONFIG%' | ConvertFrom-Json).enrollSecret"') do set "ENROLL_SECRET=%%i"
)
if "%SERVER_URL%"=="" set "SERVER_URL=http://localhost:8787"

REM -- Delete old credentials if server URL changed (forces re-enrollment) --
set "OLD_URL="
if exist "%USERPROFILE%\.cloudfuze-aigov\credentials.json" (
    for /f "tokens=*" %%i in ('powershell -NoProfile -Command "try{(Get-Content '%USERPROFILE%\.cloudfuze-aigov\credentials.json' | ConvertFrom-Json).serverUrl}catch{}"') do set "OLD_URL=%%i"
)
if not "%OLD_URL%"=="" if not "%OLD_URL%"=="%SERVER_URL%" (
    del "%USERPROFILE%\.cloudfuze-aigov\credentials.json" >nul 2>&1
    del "%USERPROFILE%\.cloudfuze-aigov\blocked-agents.json" >nul 2>&1
    del "%USERPROFILE%\.cloudfuze-aigov\agent-version" >nul 2>&1
)

REM -- Write Electron settings --
echo {"serverUrl":"%SERVER_URL%","enrollSecret":"%ENROLL_SECRET%","autoStart":true,"monitorClipboard":true,"monitorFileDialogs":true,"monitorTypedPrompts":true,"monitorAttachments":true,"monitorEnforcer":true,"startMonitorOnLaunch":true} > "%USERPROFILE%\.cloudfuze-aigov\electron-settings.json"

REM -- Create Scheduled Task (runs at user logon, as the logged-in user) --
powershell -NoProfile -Command "schtasks /Create /TN '%TASK_NAME%' /TR ('\"' + '%EXE%' + '\" --hidden') /SC ONLOGON /RL LIMITED /F" >nul 2>&1

REM -- Start the agent via the scheduled task (runs as the logged-in user) --
schtasks /Run /TN "%TASK_NAME%" >nul 2>&1

REM -- Exit immediately so Intune doesn't timeout --
exit /b 0
